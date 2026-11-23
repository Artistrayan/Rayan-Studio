import React, { useState } from 'react';
import {
  Download,
  FileArchive,
  FileCode2,
  Globe,
  Monitor,
  Smartphone,
} from 'lucide-react';
import type { RayanProject } from '../types/studio';
import {
  exportAndroidProjectZip,
  exportRayanProjectFile,
  exportWebPwaZip,
  exportWebSingleHtml,
  exportWindowsProjectZip,
} from '../engine/exporters';

interface ExportViewProps {
  project: RayanProject;
}

export const ExportView: React.FC<ExportViewProps> = ({ project }) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);

  const runExport = async (key: string, label: string, fn: () => Promise<void> | void) => {
    setBusyKey(key);
    setLastDone(null);
    try {
      await fn();
      setLastDone(`بسته «${label}» با موفقیت تولید و دانلود شد.`);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6">
      <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 space-y-2">
        <h2 className="text-xl font-bold text-slate-100">خروجی و انتشار مستقیم بازی «{project.name}»</h2>
        <p className="text-sm text-slate-400">
          تمامی خروجی‌ها کاملاً آفلاین هستند و تصاویر، مدل‌ها، صداها و موتور فیزیک بازی را درون خود بسته‌بندی می‌کنند.
        </p>
        <div className="pt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400 tabular-nums">
          <span>ابعاد خروجی: {project.screenConfig.width} × {project.screenConfig.height}</span>
          <span aria-hidden="true">·</span>
          <span>موتور: {project.engineMode === '3d' ? 'سه‌بعدی' : 'دو‌بعدی'}</span>
          <span aria-hidden="true">·</span>
          <span>{project.entities.length} آبجکت صحنه</span>
          <span aria-hidden="true">·</span>
          <span>{project.rules.length} قانون اجرایی</span>
        </div>
      </div>

      {lastDone && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {lastDone}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Android Store-Ready Export */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <Smartphone className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">خروجی اندروید (آماده کافه‌بازار، مایکت و گوگل‌پلی)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              پروژه کامل Capacitor / Android Studio شامل فایل بازی آفلاین، تنظیمات مانیفست، کنترل‌های لمسی و اسکریپت ساخت APK و AAB امضاشده برای انتشار در فروشگاه‌های معتبر.
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() => runExport('android', 'اندروید', () => exportAndroidProjectZip(project))}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors"
          >
            <FileArchive className="w-4 h-4" />
            {busyKey === 'android' ? 'در حال ساخت بسته اندروید...' : 'دانلود بسته پروژه اندروید (ZIP)'}
          </button>
        </div>

        {/* Windows Desktop Export */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-sky-400">
              <Monitor className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">خروجی ویندوز (برنامه دسکتاپ آفلاین)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              بسته کامل Electron + Electron Builder با پنجره تنظیم‌شده به ابعاد بازی شما و اسکریپت یک‌کلیک ساخت فایل نصبی و قابل حمل EXE ویندوز.
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() => runExport('windows', 'ویندوز', () => exportWindowsProjectZip(project))}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-sky-500 text-slate-950 text-xs font-bold hover:bg-sky-400 transition-colors"
          >
            <FileArchive className="w-4 h-4" />
            {busyKey === 'windows' ? 'در حال ساخت بسته ویندوز...' : 'دانلود بسته اجرایی ویندوز (ZIP)'}
          </button>
        </div>

        {/* Web Single Offline HTML */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-amber-400">
              <Globe className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">خروجی وب تک‌فایل (اجرا در همه مرورگرها)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              یک فایل HTML کاملاً مستقل و آفلاین که بدون نیاز به سرور در مرورگر کامپیوتر و موبایل اجرا می‌شود.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => runExport('web-html', 'وب HTML', () => exportWebSingleHtml(project))}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
            >
              <Download className="w-4 h-4" />
              دانلود فایل HTML
            </button>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => runExport('web-pwa', 'وب PWA', () => exportWebPwaZip(project))}
              className="py-2.5 px-4 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              بسته PWA (ZIP)
            </button>
          </div>
        </div>

        {/* Project Source Backup */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-slate-300">
              <FileCode2 className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">ذخیره فایل منبع پروژه رایان</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              خروجی گرفتن از فایل کامل پروژه (.rayan.json) برای پشتیبان‌گیری یا انتقال و ویرایش در سیستم‌های دیگر به صورت آفلاین.
            </p>
          </div>
          <button
            type="button"
            onClick={() => runExport('source', 'منبع پروژه', () => exportRayanProjectFile(project))}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-xs font-bold hover:bg-slate-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            دانلود فایل پروژه (.rayan.json)
          </button>
        </div>
      </div>
    </div>
  );
};
