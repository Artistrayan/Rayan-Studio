import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Box,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  Eye,
  Globe,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type { Model3DPresetType, RayanAsset, RayanProject } from '../types/studio';
import { audioEngine } from '../engine/audioEngine';
import {
  bakeProceduralPresetToGlbAsset,
  downloadAssetToDisk,
  exportAssetsPackZip,
  getAssetStorageStats,
  importAssetFromExternalUrl,
  importAssetsFromFileList,
  updateAssetWithNewFileVersion,
  type AssetStorageStats,
} from '../engine/assetManager';
import {
  verifyProjectAssetIntegrity,
  type ProjectAssetIntegrityReport,
} from '../storage/projectDb';
import { Model3DPreviewModal } from './Model3DPreviewModal';

interface AssetsAudioPanelProps {
  project: RayanProject;
  onAddAsset: (asset: RayanAsset) => void | Promise<void>;
  onRemoveAsset: (id: string) => void | Promise<void>;
  onUpdateAsset?: (updatedAsset: RayanAsset) => void;
  onRenameAsset?: (id: string, name: string) => void;
  onSetBackgroundImage: (url: string) => void;
  onSpawnAssetToScene: (asset: RayanAsset, targetView?: 'editor' | 'studio3d') => void;
  onUpdateSoundBindings: (bindings: RayanProject['soundBindings']) => void;
}

const BUILTIN_BACKGROUNDS = [
  {
    id: 'bg_valley',
    title: 'دره سرسبز کوهستان',
    url: '/src/assets/images/bg_adventure_valley_1795376125872.jpg',
  },
  {
    id: 'bg_scifi',
    title: 'پایگاه مداری آینده',
    url: '/src/assets/images/bg_sci_fi_horizon_1795376126799.jpg',
  },
  {
    id: 'bg_ruins',
    title: 'معبد باستانی',
    url: '/src/assets/images/bg_ancient_ruins_1795376126459.jpg',
  },
];

const BUILTIN_SFX = [
  { id: 'jump', label: 'صدای پرش' },
  { id: 'throw', label: 'صدای پرتاب / شلیک' },
  { id: 'coin', label: 'گرفتن سکه / امتیاز' },
  { id: 'hit', label: 'برخورد / آسیب' },
  { id: 'click', label: 'کلیک دکمه' },
  { id: 'win', label: 'پیروزی مرحله' },
];

const PROCEDURAL_BAKE_LIST: Array<{ preset: Model3DPresetType; label: string; color: string }> = [
  { preset: 'hero-bot', label: 'ربات قهرمان', color: '#38bdf8' },
  { preset: 'rover-car', label: 'ماشین کاوشگر', color: '#f59e0b' },
  { preset: 'turret', label: 'برجک دفاعی', color: '#ef4444' },
  { preset: 'crystal-gem', label: 'کریستال انرژی', color: '#10b981' },
  { preset: 'pine-tree', label: 'درخت کاج', color: '#14b8a6' },
  { preset: 'crate', label: 'جعبه انبار', color: '#fb923c' },
  { preset: 'platform-block', label: 'سکوی فلزی', color: '#64748b' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AssetsAudioPanel: React.FC<AssetsAudioPanelProps> = ({
  project,
  onAddAsset,
  onRemoveAsset,
  onUpdateAsset,
  onRenameAsset,
  onSetBackgroundImage,
  onSpawnAssetToScene,
  onUpdateSoundBindings,
}) => {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [autoAddTo3DScene, setAutoAddTo3DScene] = useState(true);

  const [externalUrl, setExternalUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'model3d' | 'image' | 'audio'>('all');
  const [previewModelAsset, setPreviewModelAsset] = useState<RayanAsset | null>(null);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [integrityReport, setIntegrityReport] = useState<ProjectAssetIntegrityReport | null>(null);
  const [storageStats, setStorageStats] = useState<AssetStorageStats>({
    totalAssetRecordsInIdb: 0,
    totalBytesInIdb: 0,
    chunkedAssetsCount: 0,
    totalDependenciesCount: 0,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const versionInputRef = useRef<HTMLInputElement | null>(null);
  const versionTargetAssetRef = useRef<RayanAsset | null>(null);

  const refreshStorageStats = useCallback(async () => {
    const stats = await getAssetStorageStats();
    setStorageStats(stats);
  }, []);

  useEffect(() => {
    void refreshStorageStats();
  }, [refreshStorageStats, project.assets.length]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploadNotice(null);
    setIsImporting(true);

    try {
      setUploadNotice(`در حال خواندن و اعتبارسنجی ${files.length} فایل و ذخیره در IndexedDB...`);
      const result = await importAssetsFromFileList(files);

      for (const asset of result.assets) {
        await onAddAsset(asset);
      }

      if (result.errors.length > 0) {
        setUploadError(result.errors.join(' | '));
      }

      const last3D = [...result.assets].reverse().find((a) => a.kind === 'model3d');
      if (result.assets.length > 0) {
        await refreshStorageStats();
        if (autoAddTo3DScene && last3D) {
          setUploadNotice(
            `${result.assets.length} دارایی ذخیره شد و مدل «${last3D.name}» وارد صحنه سه‌بعدی گردید.`
          );
          onSpawnAssetToScene(last3D, 'studio3d');
        } else {
          setUploadNotice(
            `${result.assets.length} دارایی خارجی با موفقیت خوانده شد، اعتبارسنجی شد و در IndexedDB ذخیره گردید.`
          );
        }
      } else if (result.errors.length === 0) {
        setUploadNotice(null);
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!externalUrl.trim()) return;
    setUploadError(null);
    setUploadNotice(`در حال دریافت فایل از آدرس خارجی و اعتبارسنجی...`);
    setIsImporting(true);
    try {
      const asset = await importAssetFromExternalUrl(externalUrl);
      await onAddAsset(asset);
      await refreshStorageStats();
      setExternalUrl('');
      if (autoAddTo3DScene && asset.kind === 'model3d') {
        setUploadNotice(`مدل «${asset.name}» از اینترنت دریافت و وارد صحنه شد.`);
        onSpawnAssetToScene(asset, 'studio3d');
      } else {
        setUploadNotice(`فایل «${asset.name}» از URL دریافت و در IndexedDB ذخیره شد.`);
      }
    } catch (err) {
      setUploadNotice(null);
      setUploadError(
        `خطا در دریافت از URL: ${err instanceof Error ? err.message : 'دریافت یا CORS ناموفق بود'}`
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleBakeProceduralToGlb = async (
    preset: Model3DPresetType,
    label: string,
    color: string
  ) => {
    setUploadError(null);
    setIsImporting(true);
    setUploadNotice(`در حال تبدیل مدل رویه‌ای «${label}» به فایل استاندارد باینری GLB...`);
    try {
      const glbAsset = await bakeProceduralPresetToGlbAsset(preset, label, color);
      await onAddAsset(glbAsset);
      await refreshStorageStats();
      setUploadNotice(`فایل استاندارد «${glbAsset.name}.glb» ساخته و در IndexedDB ذخیره شد.`);
    } catch (err) {
      setUploadNotice(null);
      setUploadError(err instanceof Error ? err.message : 'خطا در ساخت فایل GLB');
    } finally {
      setIsImporting(false);
    }
  };

  const handleVersionReplacementFile = async (files: FileList | null) => {
    const target = versionTargetAssetRef.current;
    if (!target || !files || files.length === 0) return;
    const file = files[0];
    setUploadError(null);
    setIsImporting(true);
    setUploadNotice(`در حال ثبت نسخه جدید برای «${target.name}» و محاسبه SHA-256...`);
    try {
      const updated = await updateAssetWithNewFileVersion(target, file);
      onUpdateAsset?.(updated);
      await refreshStorageStats();
      setUploadNotice(
        `دارایی «${updated.name}» با موفقیت به نسخه v${updated.version} ارتقا یافت (SHA-256: ${updated.checksumSha256?.slice(0, 8)}).`
      );
    } catch (err) {
      setUploadNotice(null);
      setUploadError(err instanceof Error ? err.message : 'خطا در ثبت نسخه جدید');
    } finally {
      versionTargetAssetRef.current = null;
      setIsImporting(false);
    }
  };

  const handleRunIntegrityCheck = async () => {
    setUploadError(null);
    const report = await verifyProjectAssetIntegrity(project);
    setIntegrityReport(report);
  };

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return project.assets.filter((a) => {
      if (categoryFilter !== 'all' && a.kind !== categoryFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.format.toLowerCase().includes(q) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [project.assets, categoryFilter, searchQuery]);

  const imageAssets = filteredAssets.filter((a) => a.kind === 'image');
  const modelAssets = filteredAssets.filter((a) => a.kind === 'model3d');
  const audioAssets = filteredAssets.filter((a) => a.kind === 'audio');

  const soundOptions = [
    { value: 'none', label: 'بدون صدا' },
    ...BUILTIN_SFX.map((s) => ({ value: s.id, label: `${s.label} (داخلی)` })),
    ...project.assets
      .filter((a) => a.kind === 'audio')
      .map((a) => ({ value: a.id, label: `${a.name} (فایل شما)` })),
  ];

  const bgmOptions = [
    { value: 'none', label: 'بدون موسیقی پس‌زمینه' },
    { value: 'adventure', label: 'موسیقی ماجراجویی (سینت‌سایزر داخلی)' },
    { value: 'space', label: 'موسیقی فضایی آرام (سینت‌سایزر داخلی)' },
    { value: 'action', label: 'موسیقی اکشن سریع (سینت‌سایزر داخلی)' },
    ...project.assets
      .filter((a) => a.kind === 'audio')
      .map((a) => ({ value: a.id, label: `${a.name} (فایل صوتی شما)` })),
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-8">
      {/* Live 3D Model Preview Modal */}
      {previewModelAsset && (
        <Model3DPreviewModal
          asset={previewModelAsset}
          onClose={() => setPreviewModelAsset(null)}
          onSpawnToStudio={() => onSpawnAssetToScene(previewModelAsset, 'studio3d')}
        />
      )}

      {/* Comprehensive External Asset Importer & Storage Telemetry */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border p-6 space-y-5 transition-colors ${
          isDraggingOver
            ? 'border-sky-400 bg-sky-500/10'
            : 'border-slate-800 bg-[#131822]'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-slate-100">
                سیستم جامع مدیریت و ورود دارایی‌های خارجی (Asset Manager)
              </h2>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              ورود مستقیم از دیسک، جفت فایل OBJ+MTL، بسته‌های ZIP، یا لینک HTTPS — تحلیل واقعی با Three.js و glTF-Transform، پاک‌سازی SVG با DOMPurify و ذخیره دائمی باینری در IndexedDB.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoAddTo3DScene}
                onChange={(e) => setAutoAddTo3DScene(e.target.checked)}
                className="rounded border-slate-700 bg-[#0B0E14] text-amber-500 focus:ring-amber-500"
              />
              ورود خودکار مدل سه‌بعدی به صحنه
            </label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.svg,.glb,.gltf,.obj,.mtl,.stl,.fbx,.ply,.usd,.usdz,.mp3,.wav,.ogg,.m4a,.zip"
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {isImporting ? 'در حال پردازش...' : 'Import Asset / انتخاب فایل یا ZIP'}
            </button>
          </div>
        </div>

        {/* External URL Fetch Import */}
        <form onSubmit={handleUrlImport} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Globe className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
            <input
              type="url"
              dir="ltr"
              placeholder="https://example.com/character.glb (دریافت مستقیم مدل، تصویر یا صدا از اینترنت)"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              className="w-full pl-3 pr-9 py-2 rounded-xl bg-[#0B0E14] border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            type="submit"
            disabled={isImporting || !externalUrl.trim()}
            className="px-4 py-2 rounded-xl bg-sky-500/20 border border-sky-500/40 text-sky-300 hover:bg-sky-500/30 disabled:opacity-40 text-xs font-bold whitespace-nowrap cursor-pointer"
          >
            دریافت و ذخیره از URL
          </button>
        </form>

        {/* Real IndexedDB Storage Bar + Integrity Check + Export Asset Pack */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80 text-xs">
          <div className="flex flex-wrap items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Database className="w-3.5 h-3.5" />
              رکوردهای binary_assets: <strong className="font-mono">{storageStats.totalAssetRecordsInIdb}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              حجم واقعی: <strong className="font-mono text-slate-200">{formatBytes(storageStats.totalBytesInIdb)}</strong>
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              فایل‌های Chunked: <strong className="font-mono text-slate-200">{storageStats.chunkedAssetsCount}</strong>
            </span>
            <span className="flex items-center gap-1.5 text-slate-400">
              وابستگی‌ها (MTL/Texture/BIN): <strong className="font-mono text-slate-200">{storageStats.totalDependenciesCount}</strong>
            </span>
            {storageStats.browserQuotaBytes && (
              <span className="text-[11px] text-slate-500 hidden xl:inline">
                ظرفیت کل مرورگر: {formatBytes(storageStats.browserQuotaBytes)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRunIntegrityCheck()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-sky-300 hover:border-sky-400 text-xs font-semibold cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              بررسی سلامت وابستگی‌ها و صحنه
            </button>
            {project.assets.length > 0 && (
              <button
                type="button"
                onClick={() => void exportAssetsPackZip(project.name, project.assets)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-200 hover:border-emerald-400 hover:text-emerald-300 text-xs font-semibold cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                خروجی پکیج ZIP تمام دارایی‌ها
              </button>
            )}
          </div>
        </div>

        <input
          ref={versionInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg,.glb,.gltf,.obj,.stl,.fbx,.ply,.usd,.usdz,.mp3,.wav,.ogg,.m4a"
          className="hidden"
          onChange={(e) => {
            void handleVersionReplacementFile(e.target.files);
            e.target.value = '';
          }}
        />

        {integrityReport && (
          <div
            className={`rounded-lg border px-4 py-2.5 text-xs space-y-1 ${
              integrityReport.ok
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {integrityReport.ok
                  ? '✓ تمام ارجاعات صحنه و فایل‌های باینری در IndexedDB سالم هستند.'
                  : `⚠ ${integrityReport.missingAssets.length} مورد ارجاع گمشده در پروژه شناسایی شد.`}
              </span>
              <button
                type="button"
                onClick={() => setIntegrityReport(null)}
                className="text-[11px] opacity-70 hover:opacity-100 cursor-pointer"
              >
                بستن
              </button>
            </div>
            <div className="flex flex-wrap gap-4 text-[11px] opacity-90">
              <span>دارایی‌های متصل به صحنه: {integrityReport.totalReferencedAssets}</span>
              <span>دارایی‌های بدون استفاده در صحنه: {integrityReport.unlinkedAssets.length}</span>
              <span>مدل‌های Chunked: {integrityReport.chunkedModelsCount}</span>
              <span>تعداد کل وابستگی‌ها: {integrityReport.totalDependenciesCount}</span>
            </div>
            {integrityReport.missingAssets.length > 0 && (
              <ul className="list-disc list-inside text-[11px] text-amber-300 pt-1">
                {integrityReport.missingAssets.map((m, idx) => (
                  <li key={`${m.assetId}-${idx}`}>
                    شناسه {m.assetId} (ارجاع در {m.referencedBy})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {uploadNotice && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{uploadNotice}</span>
          </div>
        )}

        {uploadError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
            {uploadError}
          </div>
        )}
      </section>

      {/* Search & Category Filter Toolbar */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `همه دارایی‌ها (${project.assets.length})` },
              {
                id: 'model3d',
                label: `مدل‌های سه‌بعدی (${project.assets.filter((a) => a.kind === 'model3d').length})`,
              },
              {
                id: 'image',
                label: `تصاویر و بافت‌ها (${project.assets.filter((a) => a.kind === 'image').length})`,
              },
              {
                id: 'audio',
                label: `صدا و موسیقی (${project.assets.filter((a) => a.kind === 'audio').length})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCategoryFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                categoryFilter === tab.id
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'bg-[#131822] border border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute right-3 top-2.5" />
          <input
            type="text"
            placeholder="جستجو بر اساس نام یا فرمت..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-3 pr-9 py-1.5 rounded-lg bg-[#131822] border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      </section>

      {/* Imported External 3D Models Library */}
      {(categoryFilter === 'all' || categoryFilter === 'model3d') && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-semibold text-slate-100">
              مدل‌های سه‌بعدی خارجی و ذخیره‌شده (GLB, glTF, FBX, OBJ+MTL, STL, USD/USDZ, PLY)
            </h3>
            <span className="text-xs text-slate-400 tabular-nums">{modelAssets.length} مدل</span>
          </div>

          {modelAssets.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex items-center gap-4 text-xs text-slate-400">
              <Box className="w-6 h-6 text-slate-600 shrink-0" />
              <span>
                هیچ مدل سه‌بعدی در این بخش نیست. فایل‌های GLB/FBX/OBJ/STL/USD را اینجا بکشید و رها کنید یا از آدرس HTTPS وارد نمایید.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {modelAssets.map((m) => (
                <div key={m.id} className="rounded-xl border border-slate-800 bg-[#131822] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Box className="w-4 h-4 text-sky-400 shrink-0" />
                      {editingAssetId === m.id ? (
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => {
                            onRenameAsset?.(m.id, renameDraft);
                            setEditingAssetId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              onRenameAsset?.(m.id, renameDraft);
                              setEditingAssetId(null);
                            }
                            if (e.key === 'Escape') setEditingAssetId(null);
                          }}
                          autoFocus
                          className="w-full px-1.5 py-0.5 rounded bg-[#0B0E14] border border-sky-500 text-xs text-slate-100 focus:outline-none"
                        />
                      ) : (
                        <span className="text-sm font-semibold text-slate-100 truncate">{m.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onRenameAsset && editingAssetId !== m.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAssetId(m.id);
                            setRenameDraft(m.name);
                          }}
                          className="p-1 text-slate-500 hover:text-slate-200 cursor-pointer"
                          title="تغییر نام"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      )}
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 uppercase">
                        {m.format}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-slate-400">
                    <div className="flex items-center justify-between tabular-nums">
                      <span>حجم و نسخه:</span>
                      <span className="flex items-center gap-1.5">
                        <span>{formatBytes(m.sizeBytes)}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-[10px]">
                          v{m.version || 1}
                        </span>
                        {(m.chunkCount || 1) > 1 && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-[10px]">
                            {m.chunkCount} تکه
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-emerald-400">
                      <span className="flex items-center gap-1">
                        <Database className="w-3 h-3" />
                        ذخیره‌سازی binary_assets:
                      </span>
                      <span className="font-mono text-[10px]">
                        {m.checksumSha256 ? `SHA ${m.checksumSha256.slice(0, 8)}` : 'تایید شده'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Link2 className="w-3 h-3 text-sky-400" />
                        اتصال صحنه / وابستگی:
                      </span>
                      <span className="font-mono text-slate-300 text-[10px]">
                        {m.linkedSceneNodeIds?.length || 0} گره • {m.dependencies?.length || 0} فایل همراه
                      </span>
                    </div>

                    {m.modelMeta && (
                      <div className="pt-2 border-t border-slate-800/80 space-y-1 text-[11px]">
                        {m.modelMeta.meshCount !== undefined && (
                          <div className="flex items-center justify-between text-slate-400">
                            <span>مش‌ها / متریال‌ها:</span>
                            <span className="font-mono text-slate-300 tabular-nums">
                              {m.modelMeta.meshCount} / {m.modelMeta.materialCount ?? 1}
                            </span>
                          </div>
                        )}
                        {m.modelMeta.vertexCount !== undefined && (
                          <div className="flex items-center justify-between text-slate-400">
                            <span>رأس‌ها / مثلث‌ها:</span>
                            <span className="font-mono text-slate-300 tabular-nums">
                              {m.modelMeta.vertexCount.toLocaleString()} /{' '}
                              {m.modelMeta.triangleCount?.toLocaleString() || '-'}
                            </span>
                          </div>
                        )}
                        {m.modelMeta.animationCount !== undefined && m.modelMeta.animationCount > 0 && (
                          <div className="flex items-center justify-between text-emerald-400">
                            <span>انیمیشن‌ها:</span>
                            <span className="font-mono tabular-nums">{m.modelMeta.animationCount} ترک</span>
                          </div>
                        )}
                        {m.modelMeta.hasSkeleton && (
                          <div className="text-amber-400 text-[10px]">
                            ✓ اسکلت استخوان‌بندی و ریگ پویا
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPreviewModelAsset(m)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-sky-400" />
                        پیش‌نمایش 3D
                      </button>
                      {onUpdateAsset && (
                        <button
                          type="button"
                          onClick={() => {
                            versionTargetAssetRef.current = m;
                            versionInputRef.current?.click();
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 cursor-pointer"
                          title="ثبت نسخه جدید فایل"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void downloadAssetToDisk(m)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-slate-800 cursor-pointer"
                        title="دانلود فایل اصلی"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveAsset(m.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 cursor-pointer"
                        title="حذف مدل از پروژه و IndexedDB"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSpawnAssetToScene(m, 'studio3d')}
                      className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 text-xs font-semibold hover:bg-sky-500/25 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      چیدمان چندمدلی 3D
                    </button>
                    <button
                      type="button"
                      onClick={() => onSpawnAssetToScene(m, 'editor')}
                      className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      افزودن به صحنه بازی (Editor)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Optional Procedural Preset -> Binary GLB Exporter/Converter */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0F131C] p-4 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>تبدیل مدل‌های رویه‌ای پایه به فایل باینری واقعی GLB (قابل ویرایش و دانلود):</span>
              </div>
              <span className="text-[10px] text-slate-500">
                مدل‌های رویه‌ای به عنوان پیش‌نیاز کمکی به GLB استاندارد تبدیل و در IndexedDB ذخیره می‌شوند
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PROCEDURAL_BAKE_LIST.map((p) => (
                <button
                  key={p.preset}
                  type="button"
                  disabled={isImporting}
                  onClick={() => void handleBakeProceduralToGlb(p.preset, p.label, p.color)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 cursor-pointer disabled:opacity-50"
                >
                  + ساخت {p.label}.glb
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Images & Textures Gallery */}
      {(categoryFilter === 'all' || categoryFilter === 'image') && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-semibold text-slate-100">گالری تصاویر، بافت‌ها و پس‌زمینه‌ها</h3>
            <span className="text-xs text-slate-400 tabular-nums">
              {BUILTIN_BACKGROUNDS.length + imageAssets.length} تصویر
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {BUILTIN_BACKGROUNDS.map((bg) => {
              const active =
                project.environment.backgroundType === 'image' &&
                project.environment.backgroundImageUrl === bg.url;
              return (
                <div
                  key={bg.id}
                  className={`rounded-xl border overflow-hidden bg-[#131822] ${
                    active ? 'border-amber-500' : 'border-slate-800'
                  }`}
                >
                  <div className="aspect-video bg-slate-900 overflow-hidden">
                    <img
                      src={bg.url}
                      alt={bg.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-3.5 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200 truncate">{bg.title}</span>
                    <button
                      type="button"
                      onClick={() => onSetBackgroundImage(bg.url)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      {active ? 'پس‌زمینه فعال' : 'انتخاب پس‌زمینه'}
                    </button>
                  </div>
                </div>
              );
            })}

            {imageAssets.map((asset) => {
              const active =
                project.environment.backgroundType === 'image' &&
                project.environment.backgroundImageUrl === asset.dataUrl;
              return (
                <div
                  key={asset.id}
                  className={`rounded-xl border overflow-hidden bg-[#131822] ${
                    active ? 'border-amber-500' : 'border-slate-800'
                  }`}
                >
                  <div className="aspect-video bg-slate-900 overflow-hidden flex items-center justify-center relative">
                    <img
                      src={asset.dataUrl}
                      alt={asset.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                    {asset.width && asset.height && (
                      <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono text-slate-300">
                        {asset.width}×{asset.height}
                      </span>
                    )}
                  </div>
                  <div className="p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-200 truncate flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        {asset.name}
                      </span>
                      <span className="text-[10px] text-slate-500 uppercase font-mono">
                        {asset.format} • {formatBytes(asset.sizeBytes)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSpawnAssetToScene(asset)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 text-xs font-semibold hover:bg-sky-500/25 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        افزودن به صحنه
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetBackgroundImage(asset.dataUrl)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700 cursor-pointer"
                      >
                        پس‌زمینه
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadAssetToDisk(asset)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-slate-800 cursor-pointer"
                        title="دانلود"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveAsset(asset.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Imported Audio Files & Sound Effects */}
      {(categoryFilter === 'all' || categoryFilter === 'audio') && (
        <section className="rounded-xl border border-slate-800 bg-[#131822] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-100">فایل‌های صوتی و افکت‌های بازی</h3>
              <p className="text-xs text-slate-400">
                پخش واقعی فایل‌های MP3/WAV/OGG واردشده یا تنظیم صداهای رویدادها.
              </p>
            </div>
            <span className="text-xs text-slate-400 tabular-nums">
              {audioAssets.length} فایل صوتی سفارشی
            </span>
          </div>

          {audioAssets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {audioAssets.map((aud) => (
                <div
                  key={aud.id}
                  className="rounded-xl border border-slate-800 bg-[#0B0E14] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-xs font-semibold text-slate-200 truncate">{aud.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 text-[10px] font-mono text-slate-400">
                      {aud.durationSeconds !== undefined && <span>{aud.durationSeconds}s</span>}
                      <span>{aud.format.toUpperCase()}</span>
                      <button
                        type="button"
                        onClick={() => void downloadAssetToDisk(aud)}
                        className="p-1 text-slate-400 hover:text-emerald-300 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveAsset(aud.id)}
                        className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <audio controls src={aud.dataUrl} className="w-full h-8" />
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">موسیقی متن بازی (BGM)</label>
              <div className="flex gap-1.5">
                <select
                  value={project.soundBindings.bgm}
                  onChange={(e) => onUpdateSoundBindings({ ...project.soundBindings, bgm: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-700 bg-[#0B0E14] text-xs text-slate-100"
                >
                  {bgmOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  title="پخش آزمایشی"
                  onClick={() => {
                    audioEngine.startBgm(project.soundBindings.bgm, project.assets);
                    setTimeout(() => audioEngine.stopBgm(), 2800);
                  }}
                  className="p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:text-amber-400 cursor-pointer"
                >
                  <Music className="w-4 h-4" />
                </button>
              </div>
            </div>

            {(
              [
                { key: 'onJump', label: 'صدای پرش' },
                { key: 'onThrow', label: 'صدای پرتاب' },
                { key: 'onCollect', label: 'صدای جمع‌آوری سکه' },
                { key: 'onHit', label: 'صدای برخورد / آسیب' },
                { key: 'onClick', label: 'صدای کلیک دکمه‌ها' },
              ] as const
            ).map((item) => (
              <div key={item.key} className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">{item.label}</label>
                <div className="flex gap-1.5">
                  <select
                    value={project.soundBindings[item.key]}
                    onChange={(e) =>
                      onUpdateSoundBindings({ ...project.soundBindings, [item.key]: e.target.value })
                    }
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-700 bg-[#0B0E14] text-xs text-slate-100"
                  >
                    {soundOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    title="شنیدن صدا"
                    onClick={() => audioEngine.playSound(project.soundBindings[item.key], project.assets)}
                    className="p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:text-amber-400 cursor-pointer"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
