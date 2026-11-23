import React, { useRef, useState } from 'react';
import {
  Box,
  Image as ImageIcon,
  Music,
  Plus,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type { AssetFormat, AssetKind, RayanAsset, RayanProject } from '../types/studio';
import { audioEngine } from '../engine/audioEngine';
import { importZipPackage } from '../engine/zipHandler';
import { inspectGLTFMetadata, dataUrlToArrayBuffer } from '../engine/threeModels';

interface AssetsAudioPanelProps {
  project: RayanProject;
  onAddAsset: (asset: RayanAsset) => void;
  onRemoveAsset: (id: string) => void;
  onSetBackgroundImage: (url: string) => void;
  onSpawnAssetToScene: (asset: RayanAsset) => void;
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

export const AssetsAudioPanel: React.FC<AssetsAudioPanelProps> = ({
  project,
  onAddAsset,
  onRemoveAsset,
  onSetBackgroundImage,
  onSpawnAssetToScene,
  onUpdateSoundBindings,
}) => {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const detectKindAndFormat = (filename: string): { kind: AssetKind; format: AssetFormat } | null => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) {
      return { kind: 'image', format: (ext === 'jpeg' ? 'jpg' : ext) as AssetFormat };
    }
    if (['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'usd', 'usdz'].includes(ext)) {
      return { kind: 'model3d', format: ext as AssetFormat };
    }
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
      return { kind: 'audio', format: (ext === 'm4a' ? 'mp3' : ext) as AssetFormat };
    }
    return null;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);

    for (const file of Array.from(files)) {
      if (file.name.toLowerCase().endsWith('.zip')) {
        try {
          const res = await importZipPackage(file);
          res.assets.forEach((a) => onAddAsset(a));
          if (res.assets.length === 0) {
            setUploadError(`درون فایل زیپ «${file.name}» تصویر، مدل سه‌بعدی یا فایل صوتی یافت نشد (برای فایل‌های کد از محیط کدنویسی استفاده کنید).`);
          }
        } catch {
          setUploadError(`خطا در خواندن فایل زیپ «${file.name}».`);
        }
        continue;
      }

      const detected = detectKindAndFormat(file.name);
      if (!detected) {
        setUploadError(
          `فرمت فایل «${file.name}» پشتیبانی نمی‌شود. فرمت‌های مجاز: PNG, JPG, SVG, GLB, GLTF, FBX, OBJ, STL, USD, USDZ, PLY, MP3, WAV, OGG, ZIP`
        );
        continue;
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('خطا در خواندن فایل'));
        reader.readAsDataURL(file);
      });

      let modelMeta = undefined;
      if (detected.kind === 'model3d' && (detected.format === 'glb' || detected.format === 'gltf')) {
        try {
          const buf = dataUrlToArrayBuffer(dataUrl);
          const meta = await inspectGLTFMetadata(buf);
          modelMeta = { format: detected.format, ...meta };
        } catch {
          // ignore inspection error
        }
      }

      const asset: RayanAsset = {
        id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        kind: detected.kind,
        format: detected.format,
        dataUrl,
        sizeBytes: file.size,
        createdAt: Date.now(),
        modelMeta,
      };
      onAddAsset(asset);
    }
  };

  const imageAssets = project.assets.filter((a) => a.kind === 'image');
  const modelAssets = project.assets.filter((a) => a.kind === 'model3d');
  const audioAssets = project.assets.filter((a) => a.kind === 'audio');

  const soundOptions = [
    { value: 'none', label: 'بدون صدا' },
    ...BUILTIN_SFX.map((s) => ({ value: s.id, label: `${s.label} (داخلی)` })),
    ...audioAssets.map((a) => ({ value: a.id, label: `${a.name} (فایل شما)` })),
  ];

  const bgmOptions = [
    { value: 'none', label: 'بدون موسیقی پس‌زمینه' },
    { value: 'adventure', label: 'موسیقی ماجراجویی (سینت‌سایزر داخلی)' },
    { value: 'space', label: 'موسیقی فضایی آرام (سینت‌سایزر داخلی)' },
    { value: 'action', label: 'موسیقی اکشن سریع (سینت‌سایزر داخلی)' },
    ...audioAssets.map((a) => ({ value: a.id, label: `${a.name} (فایل صوتی شما)` })),
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-8">
      {/* File Importer */}
      <section className="rounded-xl border border-slate-800 bg-[#131822] p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-100">افزودن فایل، تصویر، مدل سه‌بعدی و صدا</h2>
            <p className="text-xs text-slate-400">
              پشتیبانی واقعی از تصاویر (PNG, JPG, SVG, WebP)، مدل‌های سه‌بعدی (GLB, glTF, FBX, OBJ, STL, USD/USDZ) و فایل‌های صوتی (MP3, WAV, OGG) به صورت آفلاین.
            </p>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.svg,.glb,.gltf,.obj,.stl,.fbx,.ply,.usd,.usdz,.mp3,.wav,.ogg,.m4a,.zip"
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors whitespace-nowrap"
            >
              <Upload className="w-4 h-4" />
              انتخاب و وارد کردن فایل‌ها
            </button>
          </div>
        </div>

        {uploadError && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
            {uploadError}
          </div>
        )}
      </section>

      {/* Built-in & Uploaded Backgrounds */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold text-slate-100">گالری پس‌زمینه و تصاویر صحنه</h3>
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
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap"
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
                <div className="aspect-video bg-slate-900 overflow-hidden flex items-center justify-center">
                  <img
                    src={asset.dataUrl}
                    alt={asset.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-200 truncate">{asset.name}</span>
                    <span className="text-xs text-slate-500 uppercase">{asset.format}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSpawnAssetToScene(asset)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 text-xs font-semibold hover:bg-sky-500/25"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      افزودن به صحنه
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetBackgroundImage(asset.dataUrl)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs hover:bg-slate-700"
                    >
                      پس‌زمینه
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveAsset(asset.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800"
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

      {/* 3D Models Library */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-base font-semibold text-slate-100">
            مدل‌های سه‌بعدی وارد شده (GLB, glTF, FBX, OBJ, STL, USD/USDZ)
          </h3>
          <span className="text-xs text-slate-400 tabular-nums">{modelAssets.length} مدل</span>
        </div>

        {modelAssets.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex items-center gap-4 text-xs text-slate-400">
            <Box className="w-6 h-6 text-slate-600 shrink-0" />
            <span>
              هنوز مدل سه‌بعدی خارجی وارد نکرده‌اید. از دکمه بالا فایل‌های GLB, glTF, FBX, OBJ, STL یا USD/USDZ را وارد کنید یا در محیط استودیوی سه‌بعدی چیدمان نمایید.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {modelAssets.map((m) => (
              <div key={m.id} className="rounded-xl border border-slate-800 bg-[#131822] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Box className="w-4 h-4 text-sky-400 shrink-0" />
                    <span className="text-sm font-semibold text-slate-100 truncate">{m.name}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 uppercase">
                    {m.format}
                  </span>
                </div>

                <div className="space-y-1 text-xs text-slate-400">
                  <div className="flex items-center justify-between tabular-nums">
                    <span>حجم فایل:</span>
                    <span>{Math.round(m.sizeBytes / 1024)} کیلوبایت</span>
                  </div>

                  {m.modelMeta && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-1 text-[11px]">
                      {m.modelMeta.vertexCount !== undefined && (
                        <div className="flex items-center justify-between text-slate-400">
                          <span>رأس‌ها / مثلث‌ها:</span>
                          <span className="font-mono text-slate-300 tabular-nums">
                            {m.modelMeta.vertexCount.toLocaleString()} / {m.modelMeta.triangleCount?.toLocaleString() || '-'}
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

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSpawnAssetToScene(m)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold hover:bg-amber-500/25"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    قرار دادن در صحنه سه‌بعدی
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveAsset(m.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Music & Sound Effects */}
      <section className="rounded-xl border border-slate-800 bg-[#131822] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-100">موسیقی پس‌زمینه و افکت‌های صوتی</h3>
            <p className="text-xs text-slate-400">
              تنظیم آهنگ بازی و صداهای رویدادها با موتور صوتی داخلی یا فایل‌های MP3/WAV خودتان.
            </p>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">
            {audioAssets.length} فایل صوتی سفارشی
          </span>
        </div>

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
                className="p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:text-amber-400"
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
                  className="p-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:text-amber-400"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {audioAssets.length > 0 && (
          <div className="pt-4 border-t border-slate-800 space-y-2">
            <h4 className="text-xs font-semibold text-slate-300">فایل‌های صوتی وارد شده</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {audioAssets.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#0B0E14] px-3 py-2"
                >
                  <span className="text-xs text-slate-200 truncate">{a.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => audioEngine.playSound(a.id, project.assets)}
                      className="p-1 text-sky-400 hover:text-sky-300"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveAsset(a.id)}
                      className="p-1 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
