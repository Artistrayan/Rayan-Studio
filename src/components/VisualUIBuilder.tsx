/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Professional Visual App & UI Builder
 * Supports exact free-form X/Y/W/H placement, snap-to-grid, zIndex ordering,
 * inline CSS Flexbox & Grid, multi-page routing + Page Graph, responsive breakpoints,
 * external image upload + idb:// hydration, Lucide icons, two-way inputs,
 * live IndexedDB CRUD collections, and standalone offline HTML5/ZIP export.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Database,
  Download,
  Edit3,
  Eye,
  FileArchive,
  GitBranch,
  Grid,
  Heart,
  Home,
  Image as ImageIcon,
  Layout,
  List,
  Magnet,
  Monitor,
  MousePointer,
  Play,
  Plus,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Tablet,
  TextCursorInput,
  Trash2,
  Type,
  Upload,
  Zap,
} from 'lucide-react';
import type {
  BreakpointMode,
  LayoutMode,
  RayanAsset,
  RayanProject,
  UIActionBinding,
  UIDataCollection,
  UIDataRecord,
  UIElement,
  UIElementType,
  UIPage,
} from '../types/studio';
import { audioEngine } from '../engine/audioEngine';
import { importAssetsFromFileList, getMimeTypeForAsset } from '../engine/assetManager';
import {
  clearAppCollection,
  deleteAppRecord,
  listAppRecords,
  putAppRecord,
  retrieveBinaryModel,
} from '../storage/projectDb';
import {
  buildStandaloneUiAppHtml,
  createDefaultUiCollections,
  createDefaultUiPages,
  exportUiAppBundleZip,
  exportUiAppSingleHtml,
} from '../engine/uiAppExporter';

export { buildStandaloneUiAppHtml };

interface VisualUIBuilderProps {
  project: RayanProject;
  onUpdateProject?: (updater: (prev: RayanProject) => RayanProject) => void;
}

const BREAKPOINT_DIMS: Record<BreakpointMode, { width: number; height: number; label: string }> = {
  desktop: { width: 1024, height: 600, label: 'دسکتاپ (1024 × 600)' },
  tablet: { width: 768, height: 580, label: 'تبلت (768 × 580)' },
  mobile: { width: 380, height: 640, label: 'موبایل (380 × 640)' },
};

const ICON_OPTIONS = [
  { id: 'zap', label: 'رعد و برق', Icon: Zap },
  { id: 'heart', label: 'قلب', Icon: Heart },
  { id: 'star', label: 'ستاره', Icon: Star },
  { id: 'shield', label: 'سپر', Icon: Shield },
  { id: 'settings', label: 'تنظیمات', Icon: Settings },
  { id: 'sparkles', label: 'درخشش', Icon: Sparkles },
];

export const VisualUIBuilder: React.FC<VisualUIBuilderProps> = ({
  project,
  onUpdateProject,
}) => {
  const initialPages = useMemo(
    () =>
      project.uiPages && project.uiPages.length > 0
        ? project.uiPages
        : createDefaultUiPages(project.name),
    [project.id]
  );

  const initialCollections = useMemo(
    () =>
      project.uiCollections && project.uiCollections.length > 0
        ? project.uiCollections
        : createDefaultUiCollections(),
    [project.id]
  );

  const [pages, setPages] = useState<UIPage[]>(initialPages);
  const [activePageId, setActivePageId] = useState<string>(
    project.activeUiPageId && initialPages.some((p) => p.id === project.activeUiPageId)
      ? project.activeUiPageId
      : initialPages[0]?.id || ''
  );
  const [collections, setCollections] = useState<UIDataCollection[]>(initialCollections);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    initialPages[0]?.elements[0]?.id || null
  );
  const [breakpoint, setBreakpoint] = useState<BreakpointMode>('desktop');
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [interactivePreview, setInteractivePreview] = useState<boolean>(false);
  const [showPageGraph, setShowPageGraph] = useState<boolean>(false);
  const [showDbDrawer, setShowDbDrawer] = useState<boolean>(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingPageName, setEditingPageName] = useState<string>('');
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [newCollectionFields, setNewCollectionFields] = useState<string>('title, note');

  const [previewVars, setPreviewVars] = useState<Record<string, number>>({
    score: project.variables.score ?? 120,
    health: project.variables.health ?? 85,
    level: project.variables.level ?? 1,
    ...(project.customVariables || {}),
  });
  const [previewTextVars, setPreviewTextVars] = useState<Record<string, string>>({});
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [recordsByCollection, setRecordsByCollection] = useState<Record<string, UIDataRecord[]>>({});
  const [hydratedAssets, setHydratedAssets] = useState<Record<string, string>>({});
  const [uploadBusy, setUploadBusy] = useState<boolean>(false);
  const [exportBusy, setExportBusy] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeProjectIdRef = useRef<string>(project.id);

  const [interactionState, setInteractionState] = useState<{
    mode: 'drag' | 'resize';
    elemId: string;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialW: number;
    initialH: number;
  } | null>(null);

  // Sync when switching to another RayanProject
  useEffect(() => {
    if (activeProjectIdRef.current !== project.id) {
      activeProjectIdRef.current = project.id;
      const nextPages =
        project.uiPages && project.uiPages.length > 0
          ? project.uiPages
          : createDefaultUiPages(project.name);
      const nextCols =
        project.uiCollections && project.uiCollections.length > 0
          ? project.uiCollections
          : createDefaultUiCollections();
      setPages(nextPages);
      setCollections(nextCols);
      setActivePageId(
        project.activeUiPageId && nextPages.some((p) => p.id === project.activeUiPageId)
          ? project.activeUiPageId
          : nextPages[0]?.id || ''
      );
      setSelectedElementId(nextPages[0]?.elements[0]?.id || null);
    }
  }, [project]);

  const commitUiToProject = useCallback(
    (nextPages: UIPage[], nextActiveId: string, nextCols: UIDataCollection[], extraAssets?: RayanAsset[]) => {
      if (!onUpdateProject) return;
      onUpdateProject((prev) => ({
        ...prev,
        uiPages: nextPages,
        activeUiPageId: nextActiveId,
        uiCollections: nextCols,
        assets: extraAssets && extraAssets.length > 0 ? [...extraAssets, ...prev.assets] : prev.assets,
        updatedAt: Date.now(),
      }));
    },
    [onUpdateProject]
  );

  // Hydrate idb:// image assets into ObjectURLs
  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    const hydrate = async () => {
      const nextMap: Record<string, string> = {};
      for (const asset of project.assets) {
        if (asset.kind !== 'image') continue;
        if (asset.dataUrl && !asset.dataUrl.startsWith('idb://')) {
          nextMap[asset.id] = asset.dataUrl;
        } else {
          try {
            const retrieved = await retrieveBinaryModel(asset.id);
            if (retrieved?.buffer && !cancelled) {
              const blob = new Blob([retrieved.buffer], {
                type: getMimeTypeForAsset(asset.kind, asset.format),
              });
              const objUrl = URL.createObjectURL(blob);
              createdUrls.push(objUrl);
              nextMap[asset.id] = objUrl;
            }
          } catch {
            // ignore missing record
          }
        }
      }
      if (!cancelled) {
        setHydratedAssets(nextMap);
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [project.assets]);

  // Load IndexedDB records for all UI collections
  const refreshCollectionsData = useCallback(async () => {
    const next: Record<string, UIDataRecord[]> = {};
    for (const col of collections) {
      try {
        next[col.id] = await listAppRecords(project.id, col.id);
      } catch {
        next[col.id] = [];
      }
    }
    setRecordsByCollection(next);
  }, [collections, project.id]);

  useEffect(() => {
    void refreshCollectionsData();
  }, [refreshCollectionsData]);

  const activePage = pages.find((p) => p.id === activePageId) || pages[0];
  const selectedElement = activePage?.elements.find((e) => e.id === selectedElementId) || null;
  const imageAssets = useMemo(
    () => project.assets.filter((a) => a.kind === 'image'),
    [project.assets]
  );

  const updatePages = (updater: (prev: UIPage[]) => UIPage[], nextActiveId = activePageId) => {
    setPages((prev) => {
      const updated = updater(prev);
      commitUiToProject(updated, nextActiveId, collections);
      return updated;
    });
  };

  const addElement = (type: UIElementType) => {
    if (!activePage) return;
    const count = activePage.elements.length + 1;
    const newId = `ui_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;

    const defaults: Record<
      UIElementType,
      Partial<UIElement>
    > = {
      button: { label: `دکمه ${count}`, bgColor: '#f59e0b', textColor: '#020617', w: 170, h: 46 },
      text: { label: `تیتر ${count}`, bgColor: 'transparent', textColor: '#38bdf8', w: 240, h: 40, fontSize: 18 },
      image: { label: 'تصویر', bgColor: '#0f172a', textColor: '#94a3b8', w: 180, h: 120, imageAssetId: imageAssets[0]?.id },
      icon: { label: 'آیکون', bgColor: '#1e293b', textColor: '#38bdf8', w: 120, h: 52, iconName: 'zap' },
      card: { label: `کارت اطلاعات ${count}`, bgColor: '#1e293b', textColor: '#e2e8f0', w: 260, h: 120 },
      container: { label: '', bgColor: '#111827', textColor: '#94a3b8', w: 300, h: 180 },
      progressBar: { label: 'سلامت: {health}%', bgColor: '#1e293b', textColor: '#ffffff', w: 240, h: 32, bindVar: 'health' },
      badge: { label: 'امتیاز: {score}', bgColor: '#854d0e', textColor: '#fef08a', w: 150, h: 36, borderRadius: 18 },
      input: { label: `فیلد ${count}`, placeholder: 'مقدار را وارد کنید...', bindVar: `field_${count}`, bgColor: '#0b1120', textColor: '#f8fafc', w: 240, h: 44 },
      list: { label: 'فهرست داده‌ها (IndexedDB)', collectionId: collections[0]?.id || 'col_tasks', bgColor: '#111827', textColor: '#e2e8f0', w: 320, h: 200 },
    };

    const spec = defaults[type];
    const newElement: UIElement = {
      id: newId,
      type,
      label: spec.label ?? `${type} ${count}`,
      x: 40 + (count % 5) * 24,
      y: 40 + (count % 5) * 24,
      w: spec.w ?? 160,
      h: spec.h ?? 44,
      zIndex: activePage.elements.length + 1,
      bgColor: spec.bgColor ?? '#1e293b',
      textColor: spec.textColor ?? '#ffffff',
      borderColor: '#475569',
      borderRadius: spec.borderRadius ?? 10,
      fontSize: spec.fontSize ?? 13,
      padding: 10,
      imageAssetId: spec.imageAssetId,
      iconName: spec.iconName,
      bindVar: spec.bindVar,
      placeholder: spec.placeholder,
      collectionId: spec.collectionId,
    };

    updatePages((prev) =>
      prev.map((p) => (p.id === activePage.id ? { ...p, elements: [...p.elements, newElement] } : p))
    );
    setSelectedElementId(newId);
  };

  const updateElement = (patch: Partial<UIElement>) => {
    if (!activePage || !selectedElement) return;
    updatePages((prev) =>
      prev.map((p) =>
        p.id === activePage.id
          ? { ...p, elements: p.elements.map((el) => (el.id === selectedElement.id ? { ...el, ...patch } : el)) }
          : p
      )
    );
  };

  const deleteElement = (id: string) => {
    if (!activePage) return;
    updatePages((prev) =>
      prev.map((p) =>
        p.id === activePage.id ? { ...p, elements: p.elements.filter((el) => el.id !== id) } : p
      )
    );
    if (selectedElementId === id) setSelectedElementId(null);
  };

  const handleUploadImageAsset = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadBusy(true);
    try {
      const res = await importAssetsFromFileList(files);
      const imgs = res.assets.filter((a) => a.kind === 'image');
      if (imgs.length > 0) {
        let nextPages = pages;
        if (selectedElement && selectedElement.type === 'image') {
          nextPages = pages.map((p) =>
            p.id === activePage.id
              ? {
                  ...p,
                  elements: p.elements.map((el) =>
                    el.id === selectedElement.id ? { ...el, imageAssetId: imgs[0].id } : el
                  ),
                }
              : p
          );
          setPages(nextPages);
        }
        commitUiToProject(nextPages, activePageId, collections, imgs);
        setBannerMessage(`تصویر «${imgs[0].name}» ذخیره و متصل شد.`);
        setTimeout(() => setBannerMessage(null), 2400);
      } else if (res.errors.length > 0) {
        setBannerMessage(res.errors[0]);
        setTimeout(() => setBannerMessage(null), 3000);
      }
    } finally {
      setUploadBusy(false);
    }
  };

  const addPage = () => {
    const newId = `page_${Date.now()}`;
    const newPage: UIPage = {
      id: newId,
      name: `صفحه ${pages.length + 1}`,
      isHome: false,
      layoutMode: 'free',
      gap: 12,
      gridCols: 2,
      bgColor: '#0f172a',
      elements: [],
    };
    updatePages((prev) => [...prev, newPage], newId);
    setActivePageId(newId);
    setSelectedElementId(null);
  };

  const duplicatePage = (p: UIPage) => {
    const newId = `page_${Date.now()}`;
    const clone: UIPage = {
      ...p,
      id: newId,
      isHome: false,
      name: `${p.name} (کپی)`,
      elements: p.elements.map((el) => ({
        ...el,
        id: `ui_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      })),
    };
    updatePages((prev) => [...prev, clone], newId);
    setActivePageId(newId);
  };

  const movePageOrder = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    updatePages((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const deletePage = (id: string) => {
    if (pages.length <= 1) return;
    const remaining = pages.filter((p) => p.id !== id);
    const nextId = activePageId === id ? remaining[0].id : activePageId;
    updatePages(() => remaining, nextId);
    setActivePageId(nextId);
  };

  const commitPageRename = () => {
    if (!editingPageId) return;
    const trimmed = editingPageName.trim();
    if (trimmed) {
      updatePages((prev) =>
        prev.map((p) => (p.id === editingPageId ? { ...p, name: trimmed } : p))
      );
    }
    setEditingPageId(null);
  };

  const handleElementAction = async (el: UIElement) => {
    if (!interactivePreview || !el.actionType) return;

    if (el.actionType === 'navigate' && el.actionParam) {
      setActivePageId(el.actionParam);
      commitUiToProject(pages, el.actionParam, collections);
      audioEngine.playSound('click', project.assets);
    } else if (el.actionType === 'add-var' && el.actionParam) {
      const k = el.actionParam;
      const delta = Number(el.actionValue ?? 1) || 1;
      setPreviewVars((cur) => ({ ...cur, [k]: (cur[k] || 0) + delta }));
      audioEngine.playSound('coin', project.assets);
    } else if (el.actionType === 'set-var' && el.actionParam) {
      const k = el.actionParam;
      const num = Number(el.actionValue ?? 0);
      if (!Number.isNaN(num) && el.actionValue?.trim() !== '') {
        setPreviewVars((cur) => ({ ...cur, [k]: num }));
      } else {
        setPreviewTextVars((cur) => ({ ...cur, [k]: el.actionValue || '' }));
      }
      audioEngine.playSound('click', project.assets);
    } else if (el.actionType === 'db-save') {
      const colId = el.actionParam || collections[0]?.id || 'col_tasks';
      const payload: Record<string, string | number | boolean> = {
        ...previewVars,
        ...previewTextVars,
      };
      await putAppRecord(project.id, colId, payload);
      await refreshCollectionsData();
      audioEngine.playSound('coin', project.assets);
      setBannerMessage('رکورد جدید در پایگاه داده محلی ذخیره شد.');
      setTimeout(() => setBannerMessage(null), 2400);
    } else if (el.actionType === 'db-load') {
      await refreshCollectionsData();
      setBannerMessage('داده‌ها از IndexedDB بارگذاری شد.');
      setTimeout(() => setBannerMessage(null), 2200);
    } else if (el.actionType === 'db-clear') {
      const colId = el.actionParam || collections[0]?.id || 'col_tasks';
      await clearAppCollection(project.id, colId);
      await refreshCollectionsData();
      setBannerMessage('تمام رکوردهای جدول پاک شد.');
      setTimeout(() => setBannerMessage(null), 2200);
    } else if (el.actionType === 'play-sound') {
      audioEngine.playSound(el.actionParam || 'coin', project.assets);
    } else if (el.actionType === 'show-message') {
      setBannerMessage(el.actionParam || el.actionValue || 'پیام اجرا شد!');
      setTimeout(() => setBannerMessage(null), 2600);
    }
  };

  const renderTextContent = (rawText: string) => {
    return rawText.replace(/\{(\w+)\}/g, (_, key) => {
      if (previewTextVars[key] !== undefined) return previewTextVars[key];
      if (previewVars[key] !== undefined) return String(previewVars[key]);
      return `{${key}}`;
    });
  };

  const snapValue = (v: number) => (snapToGrid ? Math.round(v / 8) * 8 : Math.round(v));

  const handlePointerDown = (e: React.PointerEvent, elem: UIElement, mode: 'drag' | 'resize') => {
    if (interactivePreview) return;
    e.stopPropagation();
    setSelectedElementId(elem.id);
    if (activePage.layoutMode !== 'free' && mode === 'drag') return;
    setInteractionState({
      mode,
      elemId: elem.id,
      startX: e.clientX,
      startY: e.clientY,
      initialX: elem.x,
      initialY: elem.y,
      initialW: elem.w,
      initialH: elem.h,
    });
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!interactionState) return;
    const dx = e.clientX - interactionState.startX;
    const dy = e.clientY - interactionState.startY;
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== activePage.id) return p;
        return {
          ...p,
          elements: p.elements.map((el) => {
            if (el.id !== interactionState.elemId) return el;
            if (interactionState.mode === 'resize') {
              return {
                ...el,
                w: Math.max(40, snapValue(interactionState.initialW + dx)),
                h: Math.max(28, snapValue(interactionState.initialH + dy)),
              };
            }
            return {
              ...el,
              x: Math.max(0, snapValue(interactionState.initialX + dx)),
              y: Math.max(0, snapValue(interactionState.initialY + dy)),
            };
          }),
        };
      })
    );
  };

  const handleCanvasPointerUp = () => {
    if (interactionState) {
      commitUiToProject(pages, activePageId, collections);
      setInteractionState(null);
    }
  };

  const currentDims = BREAKPOINT_DIMS[breakpoint];

  const pageEdges = useMemo(() => {
    const edges: Array<{ from: string; to: string; label: string }> = [];
    for (const pg of pages) {
      for (const el of pg.elements) {
        if (el.actionType === 'navigate' && el.actionParam) {
          const target = pages.find((p) => p.id === el.actionParam);
          if (target) {
            edges.push({ from: pg.name, to: target.name, label: el.label });
          }
        }
      }
    }
    return edges;
  }, [pages]);

  const artboardStyle: React.CSSProperties = useMemo(() => {
    const base: React.CSSProperties = {
      width: currentDims.width,
      height: currentDims.height,
      backgroundColor: activePage?.bgColor || '#0f172a',
    };
    if (!activePage) return base;
    if (activePage.layoutMode === 'flex-col') {
      return {
        ...base,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: `${activePage.gap || 12}px`,
        padding: '20px',
        overflowY: 'auto',
      };
    }
    if (activePage.layoutMode === 'flex-row') {
      return {
        ...base,
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        alignContent: 'flex-start',
        gap: `${activePage.gap || 12}px`,
        padding: '20px',
        overflowY: 'auto',
      };
    }
    if (activePage.layoutMode === 'grid') {
      return {
        ...base,
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(1, Math.min(6, activePage.gridCols || 2))}, minmax(0, 1fr))`,
        alignContent: 'start',
        gap: `${activePage.gap || 12}px`,
        padding: '20px',
        overflowY: 'auto',
      };
    }
    return base;
  }, [activePage, currentDims]);

  const handleAddCollection = () => {
    const cleanName = newCollectionName.trim();
    if (!cleanName) return;
    const fields = newCollectionFields
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const nextCol: UIDataCollection = {
      id: `col_${Date.now()}`,
      name: cleanName,
      fields: fields.length > 0 ? fields : ['title', 'note'],
    };
    const nextCols = [...collections, nextCol];
    setCollections(nextCols);
    commitUiToProject(pages, activePageId, nextCols);
    setNewCollectionName('');
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-[#0B0E14] text-slate-100 overflow-hidden select-none">
      {/* Top Toolbar */}
      <header className="px-4 py-2 border-b border-slate-800 bg-[#0E121B] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <Layout className="w-4 h-4 text-amber-400" />
            <h1 className="text-xs sm:text-sm font-bold text-slate-100">
              محیط ساخت برنامه و رابط کاربری
            </h1>
          </div>

          <div className="w-px h-5 bg-slate-800" />

          {/* Breakpoint Selector */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#070A0F] border border-slate-800 text-[11px]">
            {(
              [
                { id: 'desktop', label: 'دسکتاپ', Icon: Monitor },
                { id: 'tablet', label: 'تبلت', Icon: Tablet },
                { id: 'mobile', label: 'موبایل', Icon: Smartphone },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setBreakpoint(id)}
                className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${
                  breakpoint === id
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSnapToGrid((s) => !s)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer ${
              snapToGrid
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title="چسبیدن به شبکه ۸ پیکسلی هنگام جابجایی و تغییر اندازه"
          >
            <Magnet className="w-3.5 h-3.5" />
            شبکه ۸px
          </button>
        </div>

        {/* Right Actions: Graph, Database, Export, Preview */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowPageGraph((s) => !s)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
              showPageGraph
                ? 'bg-indigo-500/20 border-indigo-400 text-indigo-200'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            ارتباط صفحات ({pageEdges.length})
          </button>

          <button
            type="button"
            onClick={() => setShowDbDrawer((s) => !s)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
              showDbDrawer
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            پایگاه داده ({collections.length})
          </button>

          <button
            type="button"
            disabled={exportBusy}
            onClick={async () => {
              setExportBusy(true);
              try {
                await exportUiAppSingleHtml({ project, pages, collections });
                setBannerMessage('خروجی مستقل HTML5 + IndexedDB دانلود شد.');
                setTimeout(() => setBannerMessage(null), 2600);
              } finally {
                setExportBusy(false);
              }
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            خروجی HTML
          </button>

          <button
            type="button"
            disabled={exportBusy}
            onClick={async () => {
              setExportBusy(true);
              try {
                await exportUiAppBundleZip({ project, pages, collections });
                setBannerMessage('بسته ZIP کامل برنامه و دیتابیس دانلود شد.');
                setTimeout(() => setBannerMessage(null), 2600);
              } finally {
                setExportBusy(false);
              }
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            <FileArchive className="w-3.5 h-3.5" />
            ZIP
          </button>

          <button
            type="button"
            onClick={() => setInteractivePreview((p) => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
              interactivePreview
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
            }`}
          >
            {interactivePreview ? <Eye className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {interactivePreview ? 'خروج از اجرا' : 'اجرای تعاملی برنامه'}
          </button>
        </div>
      </header>

      {/* Main 3-Column Studio */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Sidebar: Multi-Page Manager + 10-Component Palette */}
        <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-l border-slate-800 bg-[#0E121B] flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-800 bg-[#121723] flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200">صفحات برنامه ({pages.length})</span>
            <button
              type="button"
              onClick={addPage}
              className="p-1 rounded bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 cursor-pointer"
              title="افزودن صفحه جدید"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-52 overflow-y-auto p-2 space-y-1 border-b border-slate-800">
            {pages.map((p, idx) => (
              <div
                key={p.id}
                onClick={() => {
                  setActivePageId(p.id);
                  setSelectedElementId(p.elements[0]?.id || null);
                  commitUiToProject(pages, p.id, collections);
                }}
                onDoubleClick={() => {
                  setEditingPageId(p.id);
                  setEditingPageName(p.name);
                }}
                className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer ${
                  p.id === activePage?.id
                    ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                {editingPageId === p.id ? (
                  <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      value={editingPageName}
                      onChange={(e) => setEditingPageName(e.target.value)}
                      onBlur={commitPageRename}
                      onKeyDown={(e) => e.key === 'Enter' && commitPageRename()}
                      className="w-full px-1.5 py-0.5 bg-[#070A0F] border border-sky-500 rounded text-[11px] text-white"
                    />
                    <button type="button" onClick={commitPageRename} className="text-emerald-400">
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <span className="truncate flex items-center gap-1">
                    {p.isHome && <Home className="w-3 h-3 text-amber-400 shrink-0" />}
                    {p.name}
                  </span>
                )}

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updatePages((prev) =>
                        prev.map((item) => ({ ...item, isHome: item.id === p.id }))
                      );
                    }}
                    className={`p-0.5 ${p.isHome ? 'text-amber-400' : 'text-slate-400 hover:text-amber-300'}`}
                    title="تنظیم به عنوان صفحه خانه"
                  >
                    <Home className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      movePageOrder(idx, -1);
                    }}
                    className="p-0.5 text-slate-400 hover:text-white"
                    title="بالا"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      movePageOrder(idx, 1);
                    }}
                    className="p-0.5 text-slate-400 hover:text-white"
                    title="پایین"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPageId(p.id);
                      setEditingPageName(p.name);
                    }}
                    className="p-0.5 text-slate-400 hover:text-sky-300"
                    title="تغییر نام"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicatePage(p);
                    }}
                    className="p-0.5 text-slate-400 hover:text-slate-100"
                    title="کپی"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {pages.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePage(p.id);
                      }}
                      className="p-0.5 text-slate-400 hover:text-red-400"
                      title="حذف"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-b border-slate-800 bg-[#121723]">
            <span className="text-xs font-bold text-slate-200">اجزای رابط و داده</span>
          </div>

          <div className="p-2.5 grid grid-cols-2 gap-2 overflow-y-auto flex-1 content-start">
            {(
              [
                { type: 'button', label: 'دکمه اکشن', Icon: Zap, color: 'text-amber-400' },
                { type: 'text', label: 'متن / تیتر', Icon: Type, color: 'text-sky-400' },
                { type: 'input', label: 'ورودی فرم', Icon: TextCursorInput, color: 'text-cyan-400' },
                { type: 'list', label: 'فهرست داده', Icon: List, color: 'text-emerald-400' },
                { type: 'image', label: 'تصویر', Icon: ImageIcon, color: 'text-lime-400' },
                { type: 'icon', label: 'آیکون', Icon: Sparkles, color: 'text-pink-400' },
                { type: 'card', label: 'کارت متن', Icon: Square, color: 'text-indigo-400' },
                { type: 'container', label: 'کادر / پنل', Icon: Layout, color: 'text-purple-400' },
                { type: 'progressBar', label: 'نوار پیشرفت', Icon: Heart, color: 'text-red-400' },
                { type: 'badge', label: 'نشان متغیر', Icon: Star, color: 'text-yellow-400' },
              ] as const
            ).map(({ type, label, Icon, color }) => (
              <button
                key={type}
                type="button"
                onClick={() => addElement(type)}
                className="p-2 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 hover:border-sky-400 flex flex-col items-center gap-1 text-[11px] text-slate-200 cursor-pointer"
              >
                <Icon className={`w-4 h-4 ${color}`} />
                {label}
              </button>
            ))}
          </div>
        </aside>

        {/* Center: Visual Artboard + Optional Drawers */}
        <main
          className="flex-1 bg-[#070A0F] p-4 lg:p-6 overflow-auto flex flex-col items-center justify-center relative"
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
        >
          {bannerMessage && (
            <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-2xl">
              {bannerMessage}
            </div>
          )}

          {/* Page Flow Graph Modal Card */}
          {showPageGraph && (
            <div className="mb-4 w-full max-w-4xl rounded-xl border border-indigo-500/40 bg-[#0E1320] p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                  <GitBranch className="w-4 h-4" />
                  نقشه ارتباط صفحات برنامه
                </span>
                <button
                  type="button"
                  onClick={() => setShowPageGraph(false)}
                  className="text-slate-400 hover:text-white text-[11px]"
                >
                  بستن
                </button>
              </div>
              {pageEdges.length === 0 ? (
                <p className="text-slate-400 text-[11px]">
                  هنوز هیچ دکمه‌ای به عملکرد ناوبری (رفتن به صفحه دیگر) متصل نشده است.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {pageEdges.map((edge, i) => (
                    <div
                      key={i}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 flex items-center gap-2 text-[11px]"
                    >
                      <span className="text-sky-300 font-semibold">{edge.from}</span>
                      <span className="text-amber-400">← [{edge.label}] ←</span>
                      <span className="text-emerald-300 font-semibold">{edge.to}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Live IndexedDB Collections Drawer */}
          {showDbDrawer && (
            <div className="mb-4 w-full max-w-4xl rounded-xl border border-emerald-500/40 bg-[#0E1320] p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                  <Database className="w-4 h-4" />
                  جداول پایگاه داده محلی (IndexedDB: app_records)
                </span>
                <button
                  type="button"
                  onClick={() => setShowDbDrawer(false)}
                  className="text-slate-400 hover:text-white text-[11px]"
                >
                  بستن
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="نام جدول جدید (مثلاً کاربران)"
                  className="px-2.5 py-1.5 rounded bg-[#070A0F] border border-slate-700 text-slate-200 flex-1 min-w-[160px]"
                />
                <input
                  value={newCollectionFields}
                  onChange={(e) => setNewCollectionFields(e.target.value)}
                  placeholder="فیلدها (با ویرگول جدا کنید)"
                  className="px-2.5 py-1.5 rounded bg-[#070A0F] border border-slate-700 text-slate-200 flex-1 min-w-[160px]"
                />
                <button
                  type="button"
                  onClick={handleAddCollection}
                  className="px-3 py-1.5 rounded bg-emerald-500 text-slate-950 font-bold cursor-pointer"
                >
                  ایجاد جدول
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto">
                {collections.map((col) => {
                  const rows = recordsByCollection[col.id] || [];
                  return (
                    <div
                      key={col.id}
                      className="p-2.5 rounded-lg bg-[#070A0F] border border-slate-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200">
                          {col.name} ({rows.length} رکورد)
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await putAppRecord(project.id, col.id, {
                                title: `نمونه ${rows.length + 1}`,
                                note: 'ثبت آزمایشی',
                                score: previewVars.score || 0,
                              });
                              await refreshCollectionsData();
                            }}
                            className="text-sky-400 hover:underline text-[11px]"
                          >
                            + افزودن نمونه
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await clearAppCollection(project.id, col.id);
                              await refreshCollectionsData();
                            }}
                            className="text-red-400 hover:underline text-[11px]"
                          >
                            پاک‌سازی
                          </button>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        فیلدها: {col.fields.join('، ')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Canvas Artboard */}
          <div
            style={artboardStyle}
            onClick={() => !interactivePreview && setSelectedElementId(null)}
            className="relative rounded-2xl border border-slate-800 shadow-2xl overflow-hidden transition-all duration-150 shrink-0"
          >
            {!activePage || activePage.elements.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
                <MousePointer className="w-8 h-8 opacity-40" />
                <span>عناصر را از ستون سمت راست اضافه کنید و در بوم جابجا یا تنظیم کنید.</span>
              </div>
            ) : (
              activePage.elements.map((el) => {
                const isSel = el.id === selectedElementId && !interactivePreview;
                const isFree = activePage.layoutMode === 'free';
                const IconComp =
                  ICON_OPTIONS.find((ic) => ic.id === el.iconName)?.Icon || Zap;
                const imgSrc = el.imageAssetId ? hydratedAssets[el.imageAssetId] : undefined;
                const listRows = el.collectionId
                  ? recordsByCollection[el.collectionId] || []
                  : [];

                const elemStyle: React.CSSProperties = isFree
                  ? {
                      position: 'absolute',
                      left: el.x,
                      top: el.y,
                      width: el.w,
                      height: el.h,
                      zIndex: el.zIndex ?? 1,
                      backgroundColor: el.bgColor,
                      color: el.textColor,
                      borderColor: el.borderColor || '#475569',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: el.borderRadius,
                      fontSize: el.fontSize,
                      padding: el.padding ?? 8,
                      opacity: el.opacity ?? 1,
                    }
                  : {
                      width: el.w,
                      minHeight: el.h,
                      backgroundColor: el.bgColor,
                      color: el.textColor,
                      borderColor: el.borderColor || '#475569',
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderRadius: el.borderRadius,
                      fontSize: el.fontSize,
                      padding: el.padding ?? 8,
                      opacity: el.opacity ?? 1,
                    };

                return (
                  <div
                    key={el.id}
                    style={elemStyle}
                    onPointerDown={(e) => handlePointerDown(e, el, 'drag')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (interactivePreview) {
                        void handleElementAction(el);
                      } else {
                        setSelectedElementId(el.id);
                      }
                    }}
                    className={`relative flex items-center justify-center text-center select-none ${
                      isSel ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-black' : ''
                    } ${
                      interactivePreview
                        ? el.actionType
                          ? 'cursor-pointer hover:brightness-110 active:scale-95 transition-transform'
                          : 'cursor-default'
                        : isFree
                          ? 'cursor-grab active:cursor-grabbing'
                          : 'cursor-pointer'
                    }`}
                  >
                    {el.type === 'progressBar' ? (
                      <div className="w-full h-full bg-slate-800/80 rounded overflow-hidden relative flex items-center justify-center">
                        <div
                          className="absolute inset-y-0 right-0 bg-red-500 transition-all duration-300"
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(100, Number(previewVars[el.bindVar || 'health'] ?? 85))
                            )}%`,
                          }}
                        />
                        <span className="relative z-10 font-bold text-white px-2">
                          {renderTextContent(el.label)}
                        </span>
                      </div>
                    ) : el.type === 'image' ? (
                      imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={el.label}
                          className="w-full h-full object-cover rounded-[inherit] pointer-events-none"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-slate-400 text-[11px] gap-1">
                          <ImageIcon className="w-5 h-5" />
                          <span>{el.label || 'انتخاب تصویر'}</span>
                        </div>
                      )
                    ) : el.type === 'icon' ? (
                      <div className="flex items-center justify-center gap-2">
                        <IconComp className="w-5 h-5" />
                        <span>{renderTextContent(el.label)}</span>
                      </div>
                    ) : el.type === 'input' ? (
                      <input
                        type="text"
                        readOnly={!interactivePreview}
                        value={previewTextVars[el.bindVar || el.id] || ''}
                        onChange={(e) => {
                          const key = el.bindVar || el.id;
                          setPreviewTextVars((prev) => ({ ...prev, [key]: e.target.value }));
                        }}
                        placeholder={el.placeholder || el.label}
                        className="w-full h-full bg-transparent outline-none text-inherit placeholder:text-slate-500"
                      />
                    ) : el.type === 'list' ? (
                      <div className="w-full h-full flex flex-col gap-1.5 text-right overflow-y-auto">
                        <div className="font-bold border-b border-slate-700/80 pb-1 text-[11px] flex items-center justify-between">
                          <span>{el.label}</span>
                          <span className="text-[10px] text-emerald-400">
                            {listRows.length} رکورد
                          </span>
                        </div>
                        {listRows.length === 0 ? (
                          <div className="text-[11px] text-slate-500 py-2">
                            هنوز رکوردی در جدول ذخیره نشده است.
                          </div>
                        ) : (
                          listRows.map((row) => (
                            <div
                              key={row.id}
                              className="px-2 py-1 rounded bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2 text-[11px]"
                            >
                              <span className="truncate">
                                {Object.entries(row.data)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join(' | ')}
                              </span>
                              {interactivePreview && (
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await deleteAppRecord(row.id);
                                    await refreshCollectionsData();
                                  }}
                                  className="text-red-400 hover:text-red-300 text-[10px] shrink-0"
                                >
                                  حذف
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <span className="w-full break-words">{renderTextContent(el.label)}</span>
                    )}

                    {/* Bottom-right resize handle in edit mode */}
                    {isSel && (
                      <div
                        onPointerDown={(e) => handlePointerDown(e, el, 'resize')}
                        className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 rounded-sm bg-sky-400 border border-slate-950 cursor-nwse-resize z-30"
                        title="کشیدن برای تغییر اندازه"
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </main>

        {/* Right Sidebar: Page Layout + Element Properties */}
        <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-r border-slate-800 bg-[#0E121B] p-4 flex flex-col space-y-4 overflow-y-auto">
          {/* Page Layout Mode */}
          {activePage && (
            <div className="space-y-2.5 pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Grid className="w-3.5 h-3.5 text-sky-400" />
                چیدمان صفحه «{activePage.name}»
              </span>
              <div className="grid grid-cols-4 gap-1 text-[11px]">
                {(
                  [
                    { mode: 'free', label: 'آزاد XY' },
                    { mode: 'flex-col', label: 'عمودی' },
                    { mode: 'flex-row', label: 'افقی' },
                    { mode: 'grid', label: 'شبکه Grid' },
                  ] as const
                ).map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      updatePages((prev) =>
                        prev.map((p) => (p.id === activePage.id ? { ...p, layoutMode: mode } : p))
                      )
                    }
                    className={`py-1.5 rounded cursor-pointer ${
                      activePage.layoutMode === mode
                        ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activePage.layoutMode !== 'free' && (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="space-y-1">
                    <label className="text-slate-400">فاصله (Gap px)</label>
                    <input
                      type="number"
                      min={0}
                      max={64}
                      value={activePage.gap}
                      onChange={(e) =>
                        updatePages((prev) =>
                          prev.map((p) =>
                            p.id === activePage.id
                              ? { ...p, gap: parseInt(e.target.value, 10) || 0 }
                              : p
                          )
                        )
                      }
                      className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 text-left"
                    />
                  </div>
                  {activePage.layoutMode === 'grid' && (
                    <div className="space-y-1">
                      <label className="text-slate-400">تعداد ستون Grid</label>
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={activePage.gridCols}
                        onChange={(e) =>
                          updatePages((prev) =>
                            prev.map((p) =>
                              p.id === activePage.id
                                ? { ...p, gridCols: Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 2)) }
                                : p
                            )
                          )
                        }
                        className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 text-left"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Selected Element Inspector */}
          {selectedElement ? (
            <div className="space-y-3 text-xs flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-400 truncate">
                  ویرایش: {selectedElement.type}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateElement({ zIndex: (selectedElement.zIndex ?? 1) + 1 })}
                    className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]"
                    title="آوردن به جلو"
                  >
                    Z+
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateElement({ zIndex: Math.max(1, (selectedElement.zIndex ?? 1) - 1) })
                    }
                    className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]"
                    title="بردن به عقب"
                  >
                    Z-
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteElement(selectedElement.id)}
                    className="p-1 text-slate-500 hover:text-red-400"
                    title="حذف عنصر"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Exact Coordinates */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-mono">X (px)</label>
                  <input
                    type="number"
                    value={selectedElement.x}
                    onChange={(e) => updateElement({ x: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-mono">Y (px)</label>
                  <input
                    type="number"
                    value={selectedElement.y}
                    onChange={(e) => updateElement({ y: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-mono">عرض (W)</label>
                  <input
                    type="number"
                    value={selectedElement.w}
                    onChange={(e) => updateElement({ w: Math.max(20, parseInt(e.target.value, 10) || 40) })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-mono">ارتفاع (H)</label>
                  <input
                    type="number"
                    value={selectedElement.h}
                    onChange={(e) => updateElement({ h: Math.max(20, parseInt(e.target.value, 10) || 30) })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                  />
                </div>
              </div>

              {/* Label / Text */}
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400">متن / برچسب (پشتیبانی از {'{score}'})</label>
                <input
                  type="text"
                  value={selectedElement.label}
                  onChange={(e) => updateElement({ label: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                />
              </div>

              {/* Image Upload & Asset Picker */}
              {selectedElement.type === 'image' && (
                <div className="space-y-2 p-2.5 rounded-lg bg-[#080B10] border border-slate-800">
                  <label className="text-[11px] font-semibold text-emerald-400 block">
                    منبع تصویر خارجی
                  </label>
                  <select
                    value={selectedElement.imageAssetId || ''}
                    onChange={(e) => updateElement({ imageAssetId: e.target.value || undefined })}
                    className="w-full px-2 py-1 bg-[#0E121B] border border-slate-700 rounded text-slate-200"
                  >
                    <option value="">-- انتخاب از دارایی‌ها --</option>
                    {imageAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.format.toUpperCase()})
                      </option>
                    ))}
                  </select>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,.svg"
                    className="hidden"
                    onChange={(e) => void handleUploadImageAsset(e.target.files)}
                  />
                  <button
                    type="button"
                    disabled={uploadBusy}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {uploadBusy ? 'در حال آپلود...' : 'آپلود تصویر مستقیم از دیسک'}
                  </button>
                </div>
              )}

              {/* Icon Picker */}
              {selectedElement.type === 'icon' && (
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">انتخاب آیکون</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ICON_OPTIONS.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => updateElement({ iconName: id })}
                        className={`p-1.5 rounded border flex flex-col items-center gap-1 text-[10px] ${
                          selectedElement.iconName === id
                            ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                            : 'border-slate-700 bg-slate-900 text-slate-300'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Input / Progress Variable Binding */}
              {(selectedElement.type === 'input' || selectedElement.type === 'progressBar') && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400">نام متغیر متصل</label>
                    <input
                      type="text"
                      value={selectedElement.bindVar || ''}
                      onChange={(e) => updateElement({ bindVar: e.target.value })}
                      placeholder="title یا score"
                      className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                    />
                  </div>
                  {selectedElement.type === 'input' && (
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">متن راهنما</label>
                      <input
                        type="text"
                        value={selectedElement.placeholder || ''}
                        onChange={(e) => updateElement({ placeholder: e.target.value })}
                        className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* List Collection Binding */}
              {selectedElement.type === 'list' && (
                <div className="space-y-1">
                  <label className="text-[11px] text-emerald-400">اتصال به جدول IndexedDB</label>
                  <select
                    value={selectedElement.collectionId || ''}
                    onChange={(e) => updateElement({ collectionId: e.target.value })}
                    className="w-full px-2 py-1.5 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                  >
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Colors & Typography */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">پس‌زمینه</label>
                  <div className="flex items-center gap-1.5 bg-[#080B10] p-1 border border-slate-700 rounded">
                    <input
                      type="color"
                      value={selectedElement.bgColor.startsWith('#') ? selectedElement.bgColor : '#1e293b'}
                      onChange={(e) => updateElement({ bgColor: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-slate-300 truncate">
                      {selectedElement.bgColor}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">رنگ متن</label>
                  <div className="flex items-center gap-1.5 bg-[#080B10] p-1 border border-slate-700 rounded">
                    <input
                      type="color"
                      value={selectedElement.textColor.startsWith('#') ? selectedElement.textColor : '#ffffff'}
                      onChange={(e) => updateElement({ textColor: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-slate-300 truncate">
                      {selectedElement.textColor}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Binding */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" />
                  عملکرد دکمه هنگام کلیک
                </span>
                <select
                  value={selectedElement.actionType || ''}
                  onChange={(e) => {
                    const actionType = e.target.value as UIActionBinding;
                    if (!actionType) {
                      updateElement({ actionType: undefined, actionParam: undefined, actionValue: undefined });
                    } else {
                      updateElement({
                        actionType,
                        actionParam:
                          actionType === 'navigate'
                            ? pages.find((p) => p.id !== activePage?.id)?.id || pages[0]?.id
                            : actionType === 'db-save' || actionType === 'db-load' || actionType === 'db-clear'
                              ? collections[0]?.id || 'col_tasks'
                              : actionType === 'play-sound'
                                ? 'coin'
                                : 'score',
                        actionValue: actionType === 'add-var' ? '10' : '',
                      });
                    }
                  }}
                  className="w-full px-2 py-1.5 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                >
                  <option value="">بدون عمل</option>
                  <option value="navigate">رفتن به صفحه دیگر</option>
                  <option value="add-var">افزایش متغیر</option>
                  <option value="set-var">تنظیم مقدار متغیر</option>
                  <option value="db-save">ذخیره فرم در پایگاه داده (IndexedDB)</option>
                  <option value="db-load">بارگذاری لیست از پایگاه داده</option>
                  <option value="db-clear">پاک‌سازی رکوردهای جدول</option>
                  <option value="play-sound">پخش افکت صوتی</option>
                  <option value="show-message">نمایش پیام اعلان</option>
                </select>

                {selectedElement.actionType === 'navigate' && (
                  <select
                    value={selectedElement.actionParam || ''}
                    onChange={(e) => updateElement({ actionParam: e.target.value })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                  >
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}

                {(selectedElement.actionType === 'db-save' ||
                  selectedElement.actionType === 'db-load' ||
                  selectedElement.actionType === 'db-clear') && (
                  <select
                    value={selectedElement.actionParam || ''}
                    onChange={(e) => updateElement({ actionParam: e.target.value })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                  >
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        جدول: {c.name}
                      </option>
                    ))}
                  </select>
                )}

                {(selectedElement.actionType === 'add-var' ||
                  selectedElement.actionType === 'set-var') && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={selectedElement.actionParam || ''}
                      onChange={(e) => updateElement({ actionParam: e.target.value })}
                      placeholder="نام متغیر"
                      className="px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                    />
                    <input
                      type="text"
                      value={selectedElement.actionValue || ''}
                      onChange={(e) => updateElement({ actionValue: e.target.value })}
                      placeholder="مقدار"
                      className="px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                    />
                  </div>
                )}

                {(selectedElement.actionType === 'play-sound' ||
                  selectedElement.actionType === 'show-message') && (
                  <input
                    type="text"
                    value={selectedElement.actionParam || ''}
                    onChange={(e) => updateElement({ actionParam: e.target.value })}
                    placeholder={
                      selectedElement.actionType === 'play-sound'
                        ? 'coin, jump, click, hit'
                        : 'متن پیام...'
                    }
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-xs flex items-center justify-center h-48 text-center">
              یک عنصر را در بوم انتخاب کنید تا موقعیت دقیق، ابعاد، داده‌ها و عملکرد آن را تنظیم کنید.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
