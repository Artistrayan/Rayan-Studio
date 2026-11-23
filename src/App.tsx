import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineMode, RayanAsset, RayanProject } from './types/studio';
import {
  createStarter2DProject,
  createStarter3DProject,
  deleteProjectFromDb,
  listSavedProjects,
  normalizeProject,
  saveProjectToDb,
} from './storage/projectDb';
import { syncProjectRules } from './engine/ruleParser';
import { SceneEditorWorkspace } from './components/SceneEditorWorkspace';
import { ProjectsView } from './components/ProjectsView';
import { RulesAndAiPanel } from './components/RulesAndAiPanel';
import { AssetsAudioPanel } from './components/AssetsAudioPanel';
import { ExportView } from './components/ExportView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { CodeIdePanel } from './components/CodeIdePanel';
import { importZipPackage } from './engine/zipHandler';

type StudioTab = 'editor' | 'code' | 'rules' | 'assets' | 'projects' | 'export';

function synchronizeActiveScene(proj: RayanProject): RayanProject {
  const scenes = proj.scenes.map((sc) =>
    sc.id === proj.activeSceneId
      ? {
          ...sc,
          environment: proj.environment,
          camera: proj.camera,
          tilemap: proj.tilemap,
          entities: proj.entities,
          rulesText: proj.rulesText,
          rules: proj.rules,
        }
      : sc
  );
  return { ...proj, scenes };
}

export default function App() {
  const [projects, setProjects] = useState<RayanProject[]>([]);
  const [activeProject, setActiveProject] = useState<RayanProject | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>('editor');
  const [isPlaying, setIsPlaying] = useState(false);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loading, setLoading] = useState(true);

  const pastRef = useRef<RayanProject[]>([]);
  const futureRef = useRef<RayanProject[]>([]);
  const [historyMeta, setHistoryMeta] = useState({ canUndo: false, canRedo: false });

  const syncHistoryMeta = () => {
    setHistoryMeta({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    });
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const stored = await listSavedProjects();
        if (!mounted) return;
        if (stored.length > 0) {
          setProjects(stored);
          setActiveProject(stored[0]);
        } else {
          const starter2d = createStarter2DProject();
          const starter3d = createStarter3DProject();
          await saveProjectToDb(starter2d);
          await saveProjectToDb(starter3d);
          if (!mounted) return;
          setProjects([starter2d, starter3d]);
          setActiveProject(starter2d);
        }
      } catch {
        const fallback = createStarter2DProject();
        if (!mounted) return;
        setProjects([fallback]);
        setActiveProject(fallback);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void init();
    return () => {
      mounted = false;
    };
  }, []);

  const handleUpdateActiveProject = useCallback(
    (updater: (prev: RayanProject) => RayanProject, skipHistory = false) => {
      setActiveProject((current) => {
        if (!current) return current;
        if (!skipHistory) {
          pastRef.current = [...pastRef.current.slice(-39), current];
          futureRef.current = [];
          syncHistoryMeta();
        }
        const updated = synchronizeActiveScene(updater(current));
        setProjects((list) => list.map((p) => (p.id === updated.id ? updated : p)));
        setSavingState('idle');
        return updated;
      });
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (pastRef.current.length === 0 || !activeProject) return;
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [activeProject, ...futureRef.current.slice(0, 39)];
    setActiveProject(previous);
    setProjects((list) => list.map((p) => (p.id === previous.id ? previous : p)));
    syncHistoryMeta();
  }, [activeProject]);

  const handleRedo = useCallback(() => {
    if (futureRef.current.length === 0 || !activeProject) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current.slice(-39), activeProject];
    setActiveProject(next);
    setProjects((list) => list.map((p) => (p.id === next.id ? next : p)));
    syncHistoryMeta();
  }, [activeProject]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isPlaying) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, isPlaying]);

  const handleSaveActiveProject = async () => {
    if (!activeProject) return;
    setSavingState('saving');
    try {
      const saved = await saveProjectToDb(synchronizeActiveScene(activeProject));
      setActiveProject(saved);
      setProjects((list) => list.map((p) => (p.id === saved.id ? saved : p)));
      setSavingState('saved');
      setTimeout(() => setSavingState('idle'), 2000);
    } catch {
      setSavingState('idle');
    }
  };

  const resetHistoryForProject = (proj: RayanProject) => {
    pastRef.current = [];
    futureRef.current = [];
    syncHistoryMeta();
    setActiveProject(proj);
  };

  const handleCreateProject = async (name: string, mode: EngineMode) => {
    const created =
      mode === '3d' ? createStarter3DProject(name) : createStarter2DProject(name);
    await saveProjectToDb(created);
    setProjects((prev) => [created, ...prev]);
    resetHistoryForProject(created);
    setIsPlaying(false);
    setActiveTab('editor');
  };

  const handleDuplicateProject = async (proj: RayanProject) => {
    const now = Date.now();
    const copy: RayanProject = normalizeProject({
      ...JSON.parse(JSON.stringify(proj)),
      id: `proj_${now}`,
      name: `${proj.name} (کپی)`,
      createdAt: now,
      updatedAt: now,
    });
    await saveProjectToDb(copy);
    setProjects((prev) => [copy, ...prev]);
    resetHistoryForProject(copy);
  };

  const handleDeleteProject = async (id: string) => {
    await deleteProjectFromDb(id);
    setProjects((prev) => {
      const remaining = prev.filter((p) => p.id !== id);
      if (activeProject?.id === id && remaining.length > 0) {
        resetHistoryForProject(remaining[0]);
      }
      return remaining;
    });
  };

  const handleImportProjectFile = async (file: File) => {
    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const res = await importZipPackage(file);
        if (res.importedProject) {
          const merged = normalizeProject({
            ...res.importedProject,
            codeFiles:
              res.codeFiles.length > 0
                ? res.codeFiles
                : res.importedProject.codeFiles,
            assets:
              res.assets.length > 0
                ? [...res.importedProject.assets, ...res.assets]
                : res.importedProject.assets,
          });
          await saveProjectToDb(merged);
          setProjects((prev) => [merged, ...prev]);
          resetHistoryForProject(merged);
          setActiveTab('editor');
          return;
        }
        if (activeProject && (res.codeFiles.length > 0 || res.assets.length > 0)) {
          handleUpdateActiveProject((prev) => ({
            ...prev,
            codeFiles: [...(prev.codeFiles || []), ...res.codeFiles],
            assets: [...prev.assets, ...res.assets],
            updatedAt: Date.now(),
          }));
          setActiveTab(res.codeFiles.length > 0 ? 'code' : 'assets');
        }
        return;
      }

      const text = await file.text();
      const parsed = JSON.parse(text) as RayanProject;
      if (!parsed.entities || !parsed.screenConfig) return;
      const now = Date.now();
      const imported = normalizeProject({
        ...parsed,
        id: `proj_${now}`,
        name: parsed.name || 'پروژه واردشده',
        createdAt: now,
        updatedAt: now,
      });
      await saveProjectToDb(imported);
      setProjects((prev) => [imported, ...prev]);
      resetHistoryForProject(imported);
      setActiveTab('editor');
    } catch {
      // ignore invalid file
    }
  };

  const handleSpawnAssetToScene = (asset: RayanAsset) => {
    if (!activeProject) return;
    const is3D = asset.kind === 'model3d';
    const id = `ent_${Date.now()}`;
    handleUpdateActiveProject((prev) => ({
      ...prev,
      engineMode: is3D ? '3d' : prev.engineMode,
      entities: [
        ...prev.entities,
        {
          id,
          name: asset.name,
          role: 'prop',
          kind: is3D ? 'model3d-asset' : 'sprite2d',
          assetId: asset.id,
          x: is3D ? 0 : 280,
          y: is3D ? 0 : 240,
          z: 0,
          width: is3D ? 1.5 : 90,
          height: is3D ? 1.5 : 90,
          depth: 1.5,
          rotationX: 0,
          rotationY: 0,
          rotationZ: 0,
          color: '#F8FAFC',
          opacity: 1,
          visible: true,
          physics: {
            enabled: true,
            isStatic: false,
            useGravity: false,
            mass: 1,
            bounce: 0.1,
            friction: 0.85,
            collider: 'box',
          },
        },
      ],
    }));
    setActiveTab('editor');
  };

  if (loading || !activeProject) {
    return (
      <div className="min-h-screen bg-[#0B0E14] text-slate-300 flex items-center justify-center text-sm">
        در حال آماده‌سازی استودیو بازی‌سازی رایان...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0E14] text-slate-100 overflow-hidden">
      {/* 3-Zone Top Bar Contract */}
      <header className="shrink-0 h-14 px-6 border-b border-slate-800 bg-[#0F131C] flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => {
            setIsPlaying(false);
            setActiveTab('editor');
          }}
          className="text-lg font-bold tracking-tight text-amber-400 whitespace-nowrap shrink-0"
        >
          استودیو رایان
        </button>

        {/* Zone 2: Navigation Tabs */}
        <nav className="flex items-center gap-6 text-xs sm:text-sm font-medium overflow-x-auto">
          {(
            [
              { id: 'editor', label: 'ویرایشگر صحنه' },
              { id: 'code', label: 'محیط کدنویسی' },
              { id: 'rules', label: 'قوانین و هوش مصنوعی' },
              { id: 'assets', label: 'فایل‌ها و صدا' },
              { id: 'projects', label: 'پروژه‌ها' },
              { id: 'export', label: 'خروجی و انتشار' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id !== 'editor') setIsPlaying(false);
                setActiveTab(tab.id);
              }}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === tab.id
                  ? 'border-amber-500 text-slate-100 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Primary Action + Offline PWA Install */}
        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            onClick={() => {
              setActiveTab('editor');
              setIsPlaying((p) => !p);
            }}
            className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            {isPlaying ? 'بازگشت به ویرایش' : 'پیش‌نمایش بازی'}
          </button>
        </div>
      </header>

      {/* Active Studio View */}
      {activeTab === 'editor' && (
        <SceneEditorWorkspace
          project={activeProject}
          isPlaying={isPlaying}
          onTogglePlay={setIsPlaying}
          onUpdateProject={handleUpdateActiveProject}
          onSaveProject={() => void handleSaveActiveProject()}
          savingState={savingState}
          canUndo={historyMeta.canUndo}
          canRedo={historyMeta.canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      )}

      {activeTab === 'code' && (
        <CodeIdePanel
          project={activeProject}
          onUpdateCodeFiles={(nextFiles, extraAssets) =>
            handleUpdateActiveProject((prev) => ({
              ...prev,
              codeFiles: nextFiles,
              assets: extraAssets && extraAssets.length > 0 ? [...prev.assets, ...extraAssets] : prev.assets,
              updatedAt: Date.now(),
            }))
          }
          onOpenImportedProject={async (importedProj) => {
            const normalized = normalizeProject(importedProj);
            await saveProjectToDb(normalized);
            setProjects((prev) => [normalized, ...prev]);
            resetHistoryForProject(normalized);
          }}
        />
      )}

      {activeTab === 'rules' && (
        <RulesAndAiPanel
          project={activeProject}
          onUpdateRulesText={(text) =>
            handleUpdateActiveProject((prev) => syncProjectRules(prev, text))
          }
        />
      )}

      {activeTab === 'assets' && (
        <AssetsAudioPanel
          project={activeProject}
          onAddAsset={(asset) =>
            handleUpdateActiveProject((prev) => ({
              ...prev,
              assets: [asset, ...prev.assets],
              updatedAt: Date.now(),
            }))
          }
          onRemoveAsset={(id) =>
            handleUpdateActiveProject((prev) => ({
              ...prev,
              assets: prev.assets.filter((a) => a.id !== id),
              updatedAt: Date.now(),
            }))
          }
          onSetBackgroundImage={(url) =>
            handleUpdateActiveProject((prev) => ({
              ...prev,
              environment: {
                ...prev.environment,
                backgroundType: 'image',
                backgroundImageUrl: url,
              },
              updatedAt: Date.now(),
            }))
          }
          onSpawnAssetToScene={handleSpawnAssetToScene}
          onUpdateSoundBindings={(soundBindings) =>
            handleUpdateActiveProject((prev) => ({
              ...prev,
              soundBindings,
              updatedAt: Date.now(),
            }))
          }
        />
      )}

      {activeTab === 'projects' && (
        <ProjectsView
          projects={projects}
          activeProjectId={activeProject.id}
          onOpenProject={(proj) => {
            resetHistoryForProject(normalizeProject(proj));
            setIsPlaying(false);
            setActiveTab('editor');
          }}
          onCreateProject={(name, mode) => void handleCreateProject(name, mode)}
          onDuplicateProject={(proj) => void handleDuplicateProject(proj)}
          onDeleteProject={(id) => void handleDeleteProject(id)}
          onImportProjectFile={(file) => void handleImportProjectFile(file)}
        />
      )}

      {activeTab === 'export' && <ExportView project={activeProject} />}
    </div>
  );
}
