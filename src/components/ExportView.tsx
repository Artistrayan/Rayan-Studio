import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileCode2,
  Globe,
  Monitor,
  Smartphone,
  Wrench,
} from 'lucide-react';
import type { RayanProject } from '../types/studio';
import {
  exportAndroidProjectZip,
  exportRayanProjectFile,
  exportWebPwaZip,
  exportWebSingleHtml,
  exportWindowsProjectZip,
} from '../engine/exporters';
import { exportCodeFilesZip, exportCompleteProjectZip } from '../engine/zipHandler';

interface ExportViewProps {
  project: RayanProject;
}

interface ExportCapabilities {
  java: { available: boolean; version?: string };
  gradle: { available: boolean; version?: string };
  electron: { available: boolean; version?: string };
  directApkCompiledOnHost: boolean;
}

export const ExportView: React.FC<ExportViewProps> = ({ project }) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [lastDone, setLastDone] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<ExportCapabilities | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/export/capabilities')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ExportCapabilities | null) => {
        if (active && data) setCapabilities(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
      <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 space-y-3">
        <h2 className="text-xl font-bold text-slate-100">خروجی و انتشار پروژه «{project.name}»</h2>
        <p className="text-sm text-slate-400">
          تمامی خروجی‌های وب (HTML و PWA) کاملاً آفلاین و آماده اجرای مستقیم هستند. خروجی‌های اندروید و ویندوز به‌صورت سورس‌کد قابل کامپایل (Capacitor + GitHub Actions CI و Electron Builder) تولید می‌شوند.
        </p>
        <div className="pt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400 tabular-nums">
          <span>ابعاد خروجی: {project.screenConfig.width} × {project.screenConfig.height}</span>
          <span aria-hidden="true">·</span>
          <span>موتور: {project.engineMode === '3d' ? 'سه‌بعدی' : 'دو‌بعدی'}</span>
          <span aria-hidden="true">·</span>
          <span>{project.entities.length} آبجکت صحنه</span>
          <span aria-hidden="true">·</span>
          <span>{project.rules.length} قانون اجرایی</span>
        </div>

        {capabilities && (
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-slate-400">
              <Wrench className="w-3.5 h-3.5 text-amber-400" />
              ابزارهای بیلد روی سرور میزبان:
            </span>
            <span className={capabilities.java.available ? 'text-emerald-400' : 'text-slate-500'}>
              Java JDK: {capabilities.java.available ? 'نصب‌شده' : 'موجود نیست (استفاده از CI یا Android Studio)'}
            </span>
            <span className={capabilities.gradle.available ? 'text-emerald-400' : 'text-slate-500'}>
              Gradle: {capabilities.gradle.available ? 'نصب‌شده' : 'موجود نیست'}
            </span>
            <span className={capabilities.electron.available ? 'text-emerald-400' : 'text-slate-500'}>
              Electron: {capabilities.electron.available ? 'نصب‌شده' : 'نیاز به npm install روی سیستم مقصد'}
            </span>
          </div>
        )}
      </div>

      {lastDone && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {lastDone}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Android Capacitor Source + CI APK Workflow */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <Smartphone className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">
                بسته پروژه آماده کامپایل اندروید (Capacitor Source ZIP + CI APK)
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              پروژه سورس‌کد کامل Capacitor شامل فایل بازی آفلاین، تنظیمات مانیفست، اسکریپت <code className="text-emerald-300">build-apk.sh</code> و فایل <code className="text-emerald-300">.github/workflows/android-apk.yml</code> برای تولید واقعی APK/AAB در Android Studio یا GitHub Actions (فایل ZIP خود باینری APK نیست و برای تبدیل به APK باید بیلد شود).
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() => runExport('android', 'پروژه سورس اندروید (Capacitor ZIP)', () => exportAndroidProjectZip(project))}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors cursor-pointer"
          >
            <FileArchive className="w-4 h-4" />
            {busyKey === 'android' ? 'در حال ساخت بسته اندروید...' : 'دانلود پروژه آماده کامپایل اندروید (ZIP)'}
          </button>
        </div>

        {/* Windows Desktop Electron Source Export */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-sky-400">
              <Monitor className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">
                بسته پروژه دسکتاپ ویندوز (Electron Source ZIP)
              </h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              پروژه آماده Electron + Electron Builder با پنجره تنظیم‌شده به ابعاد بازی شما و اسکریپت <code className="text-sky-300">build-windows.bat</code> جهت کامپایل نسخه نصبی EXE روی ویندوز.
            </p>
          </div>
          <button
            type="button"
            disabled={busyKey !== null}
            onClick={() => runExport('windows', 'پروژه سورس ویندوز (Electron ZIP)', () => exportWindowsProjectZip(project))}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-sky-500 text-slate-950 text-xs font-bold hover:bg-sky-400 transition-colors cursor-pointer"
          >
            <FileArchive className="w-4 h-4" />
            {busyKey === 'windows' ? 'در حال ساخت بسته ویندوز...' : 'دانلود پروژه سورس ویندوز (ZIP)'}
          </button>
        </div>

        {/* Web Single Offline HTML */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-amber-400">
              <Globe className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">خروجی وب تک‌فایل (اجرای مستقیم و آفلاین)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              یک فایل HTML کاملاً مستقل و آماده اجرا بدون نیاز به کامپایل یا سرور که تمام دارایی‌ها و منطق بازی را درون خود دارد.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => runExport('web-html', 'وب HTML', () => exportWebSingleHtml(project))}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              دانلود فایل HTML
            </button>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => runExport('web-pwa', 'وب PWA', () => exportWebPwaZip(project))}
              className="py-2.5 px-4 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              بسته PWA (ZIP)
            </button>
          </div>
        </div>

        {/* Project Source Backup & Complete ZIP */}
        <div className="rounded-xl border border-slate-800 bg-[#131822] p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-slate-300">
              <FileCode2 className="w-5 h-5" />
              <h3 className="text-base font-bold text-slate-100">خروجی ZIP کامل پروژه، کدها و فایل منبع</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              خروجی گرفتن از کل پروژه به صورت فایل ZIP (شامل کدهای JS/CSS/JSON، تصاویر، مدل‌ها، صداها و نسخه اجرایی HTML) یا دانلود فایل تکی .rayan.json.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => runExport('complete-zip', 'بسته کامل ZIP', () => exportCompleteProjectZip(project))}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-400 transition-colors whitespace-nowrap cursor-pointer"
            >
              <FileArchive className="w-4 h-4" />
              {busyKey === 'complete-zip' ? 'در حال بسته‌بندی...' : 'خروجی زیپ کامل (ZIP)'}
            </button>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => runExport('code-zip', 'کدهای پروژه ZIP', () => exportCodeFilesZip(project))}
              className="py-2.5 px-3 rounded-lg border border-slate-700 bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              زیپ کدها
            </button>
            <button
              type="button"
              onClick={() => runExport('source', 'منبع پروژه', () => exportRayanProjectFile(project))}
              className="py-2.5 px-3 rounded-lg border border-slate-700 bg-slate-800 text-slate-100 text-xs font-semibold hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              .rayan.json
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
