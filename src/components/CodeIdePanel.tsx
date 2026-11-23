import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FileArchive,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Play,
  Plus,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  AlertTriangle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Check,
  X,
  RefreshCw,
} from 'lucide-react';
import type { CodeFileItem, CodeFileLanguage, RayanAsset, RayanProject } from '../types/studio';
import { runScriptIsolated } from '../runtime/scriptRunner';
import { permissionManager, type PermissionScope } from '../security/permissionManager';
import { StudioTestRunner, type FullTestReport } from '../testing/testRunner';
import {
  detectCodeLanguageFromName,
  exportCodeFilesZip,
  exportCompleteProjectZip,
  importZipPackage,
} from '../engine/zipHandler';

interface CodeIdePanelProps {
  project: RayanProject;
  onUpdateCodeFiles: (nextFiles: CodeFileItem[], extraAssets?: RayanAsset[]) => void;
  onOpenImportedProject?: (proj: RayanProject) => void;
}

const LANG_LABELS: Record<CodeFileLanguage, { label: string; color: string }> = {
  javascript: { label: 'JS', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  typescript: { label: 'TS', color: 'text-sky-400 bg-sky-500/15 border-sky-500/30' },
  python: { label: 'PY', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' },
  lua: { label: 'LUA', color: 'text-teal-400 bg-teal-500/15 border-teal-500/30' },
  css: { label: 'CSS', color: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30' },
  html: { label: 'HTML', color: 'text-orange-300 bg-orange-500/15 border-orange-500/30' },
  json: { label: 'JSON', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' },
  text: { label: 'TXT', color: 'text-slate-300 bg-slate-700/40 border-slate-600' },
};

const QUICK_SNIPPETS_JS: Array<{ label: string; code: string }> = [
  {
    label: 'افزایش امتیاز',
    code: `\napi.addScore(10);\napi.playSound('coin');\napi.log('امتیاز جدید: ' + api.score);\n`,
  },
  {
    label: 'حرکت بازیکن',
    code: `\nconst p = api.findEntity('بازیکن');\nif (p) {\n  api.moveEntity('بازیکن', 180, -320);\n}\n`,
  },
  {
    label: 'حلقه onUpdate',
    code: `\nfunction onUpdate(api, dt) {\n  // در هر فریم اجرا می‌شود\n}\n`,
  },
  {
    label: 'پیام و متغیر',
    code: `\napi.setVar('موج', (api.vars['موج'] || 1) + 1);\napi.showMessage('موج جدید آغاز شد!');\n`,
  },
];

const QUICK_SNIPPETS_PY: Array<{ label: string; code: string }> = [
  {
    label: 'امتیاز و خروجی (Python)',
    code: `\napi.add_score(25)\nprint(f"امتیاز جدید پایتون: {api.score}")\n`,
  },
  {
    label: 'تنظیم سلامت (Python)',
    code: `\napi.set_health(100)\nprint("سلامت بازیکن بازیابی شد")\n`,
  },
];

const QUICK_SNIPPETS_LUA: Array<{ label: string; code: string }> = [
  {
    label: 'امتیاز و صدا (Lua)',
    code: `\napi.add_score(30)\nprint("امتیاز جدید لوآ: " .. api.score)\n`,
  },
  {
    label: 'تنظیم متغیر موج (Lua)',
    code: `\napi.set_var("wave", 2)\nprint("موج 2 فعال شد")\n`,
  },
];

function starterContentForLanguage(lang: CodeFileLanguage, name: string): string {
  switch (lang) {
    case 'javascript':
      return `// ${name}\nfunction onStart(api) {\n  api.log('اسکریپت ${name} آماده است');\n}\n\nfunction onUpdate(api, dt) {\n  // منطق فریم‌به‌فریم بازی را اینجا بنویسید\n}\n`;
    case 'typescript':
      return `// ${name}\nexport interface CustomState {\n  wave: number;\n  multiplier: number;\n}\n\nexport const initialState: CustomState = {\n  wave: 1,\n  multiplier: 1,\n};\n`;
    case 'python':
      return `# ${name}\n# Rayan Studio - Python Wasm Script (Pyodide)\nprint("اسکریپت پایتون ${name} اجرا شد")\napi.add_score(10)\n`;
    case 'lua':
      return `-- ${name}\n-- Rayan Studio - Lua 5.4 Wasm Script (Wasmoon)\nprint("اسکریپت لوآ ${name} بارگیری شد")\napi.add_score(15)\n`;
    case 'css':
      return `/* ${name} */\n.hud-box {\n  backdrop-filter: blur(6px);\n}\n`;
    case 'html':
      return `<!-- ${name} -->\n<div class="custom-panel">\n  <h3>استودیو رایان</h3>\n</div>\n`;
    case 'json':
      return `{\n  "name": "${name}",\n  "enabled": true\n}\n`;
    default:
      return `# ${name}\n`;
  }
}

export const CodeIdePanel: React.FC<CodeIdePanelProps> = ({
  project,
  onUpdateCodeFiles,
  onOpenImportedProject,
}) => {
  const files = project.codeFiles || [];
  const [activeId, setActiveId] = useState<string>(files[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFilePath, setNewFilePath] = useState('scripts/playerController.js');
  const [consoleLogs, setConsoleLogs] = useState<Array<{ type: 'info' | 'ok' | 'err'; text: string }>>([
    { type: 'info', text: 'محیط کدنویسی استودیو رایان آماده است. فایل‌های JS/CSS فعال در بازی و خروجی اجرا می‌شوند.' },
  ]);
  const [findText, setFindText] = useState('');
  const [showFindBar, setShowFindBar] = useState(false);
  const [busyZip, setBusyZip] = useState<string | null>(null);

  const codeUploadRef = useRef<HTMLInputElement | null>(null);
  const zipImportRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const activeFile = files.find((f) => f.id === activeId) || files[0] || null;

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    );
  }, [files, searchQuery]);

  const lineCount = activeFile ? Math.max(1, activeFile.content.split('\n').length) : 1;

  const pushConsole = (type: 'info' | 'ok' | 'err', text: string) => {
    setConsoleLogs((prev) => [{ type, text }, ...prev.slice(0, 39)]);
  };

  const updateActiveFile = (patch: Partial<CodeFileItem>) => {
    if (!activeFile) return;
    const next = files.map((f) =>
      f.id === activeFile.id ? { ...f, ...patch, updatedAt: Date.now() } : f
    );
    onUpdateCodeFiles(next);
  };

  const handleCreateFile = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPath = newFilePath.trim().replace(/^\/+/, '') || `scripts/script_${files.length + 1}.js`;
    const baseName = cleanPath.split('/').pop() || cleanPath;
    const lang = detectCodeLanguageFromName(baseName);
    const created: CodeFileItem = {
      id: `code_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: baseName,
      path: cleanPath,
      language: lang,
      content: starterContentForLanguage(lang, baseName),
      enabledInRuntime: lang === 'javascript' || lang === 'css',
      updatedAt: Date.now(),
    };
    onUpdateCodeFiles([...files, created]);
    setActiveId(created.id);
    setShowNewForm(false);
    setNewFilePath('');
    pushConsole('ok', `فایل «${created.path}» ایجاد شد.`);
  };

  const handleUploadCodeFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const added: CodeFileItem[] = [];
    for (const file of Array.from(fileList)) {
      const text = await file.text();
      const lang = detectCodeLanguageFromName(file.name);
      const folder = lang === 'css' ? 'styles' : lang === 'json' ? 'config' : 'scripts';
      added.push({
        id: `code_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        path: `${folder}/${file.name}`,
        language: lang,
        content: text,
        enabledInRuntime: lang === 'javascript' || lang === 'css',
        updatedAt: Date.now(),
      });
    }
    if (added.length > 0) {
      onUpdateCodeFiles([...files, ...added]);
      setActiveId(added[added.length - 1].id);
      pushConsole('ok', `${added.length} فایل کدنویسی اضافه شد.`);
    }
  };

  const handleZipImport = async (file: File) => {
    setBusyZip('import');
    try {
      const res = await importZipPackage(file);
      if (res.importedProject && onOpenImportedProject) {
        const mergedProj: RayanProject = {
          ...res.importedProject,
          codeFiles:
            res.codeFiles.length > 0
              ? res.codeFiles
              : res.importedProject.codeFiles || files,
          assets:
            res.assets.length > 0
              ? [...res.importedProject.assets, ...res.assets]
              : res.importedProject.assets,
        };
        onOpenImportedProject(mergedProj);
        pushConsole(
          'ok',
          `پروژه «${mergedProj.name}» از ZIP بارگذاری شد (${res.codeFiles.length} فایل کد و ${res.assets.length} رسانه).`
        );
        return;
      }

      if (res.codeFiles.length === 0 && res.assets.length === 0) {
        pushConsole('err', `فایل قابل استفاده‌ای درون آرشیو ${file.name} یافت نشد.`);
        return;
      }

      const nextFiles = [...files, ...res.codeFiles];
      onUpdateCodeFiles(nextFiles, res.assets);
      if (res.codeFiles[0]) setActiveId(res.codeFiles[0].id);
      pushConsole(
        'ok',
        `از فایل ZIP استخراج شد: ${res.codeFiles.length} فایل کد و ${res.assets.length} تصویر/صدا/مدل.`
      );
    } catch (err) {
      pushConsole(
        'err',
        `خطا در خواندن فایل ZIP: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusyZip(null);
    }
  };

  const handleDeleteFile = (id: string) => {
    const remaining = files.filter((f) => f.id !== id);
    onUpdateCodeFiles(remaining);
    if (activeFile?.id === id) {
      setActiveId(remaining[0]?.id || '');
    }
    pushConsole('info', 'فایل حذف شد.');
  };

  const handleDuplicateFile = () => {
    if (!activeFile) return;
    const dot = activeFile.name.lastIndexOf('.');
    const copyName =
      dot > 0
        ? `${activeFile.name.slice(0, dot)}_copy${activeFile.name.slice(dot)}`
        : `${activeFile.name}_copy`;
    const copyPath = activeFile.path.includes('/')
      ? `${activeFile.path.slice(0, activeFile.path.lastIndexOf('/') + 1)}${copyName}`
      : copyName;
    const clone: CodeFileItem = {
      ...activeFile,
      id: `code_${Date.now()}_dup`,
      name: copyName,
      path: copyPath,
      updatedAt: Date.now(),
    };
    onUpdateCodeFiles([...files, clone]);
    setActiveId(clone.id);
  };

  const [permissions, setPermissions] = useState<Record<PermissionScope, boolean>>(() =>
    permissionManager.getSnapshot()
  );
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [lastDiagnosticsReport, setLastDiagnosticsReport] = useState<FullTestReport | null>(null);

  useEffect(() => {
    const unsub = permissionManager.subscribe(() => {
      setPermissions(permissionManager.getSnapshot());
    });
    return unsub;
  }, []);

  const handleRunTest = async () => {
    if (!activeFile) return;

    // Check script:execute permission
    if (!permissionManager.hasPermission('script:execute')) {
      setShowPermissionsModal(true);
      pushConsole(
        'err',
        `مجوز اجرای اسکریپت سفارشی (${activeFile.language}) هنوز داده نشده است. لطفاً در پنجره مدیریت دسترسی‌ها آن را فعال کنید.`
      );
      return;
    }

    setIsRunningTest(true);
    pushConsole('info', `[${activeFile.name}] در حال اجرا در ورکر ایزوله (${activeFile.language})...`);

    try {
      const res = await runScriptIsolated(activeFile);
      const timeStr = `${res.durationMs.toFixed(1)}ms`;
      const verStr = res.version ? ` [${res.version}]` : '';

      if (res.ok) {
        pushConsole('ok', `[${activeFile.name}] اجرا بدون خطا در ${timeStr} پایان یافت${verStr}.`);
        res.logs.forEach((log) => pushConsole('ok', `  ${log}`));
      } else {
        pushConsole('err', `[${activeFile.name}] خطای اجرا در ${timeStr}: ${res.error || 'خطای ناشناخته'}`);
        res.logs.forEach((log) => pushConsole('info', `  ${log}`));
      }
    } catch (err) {
      pushConsole('err', `[${activeFile.name}] خطای سیستمی در اجرای ورکر: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunningTest(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    pushConsole('info', 'در حال اجرای 22 آزمون تشخیصی یکپارچگی استودیو (امنیت، دسترسی، رانتایم و قوانین)...');

    try {
      const report = await StudioTestRunner.runAll();
      setLastDiagnosticsReport(report);

      if (report.failed === 0) {
        pushConsole('ok', `تمام ${report.totalTests} آزمون استودیو با موفقیت پاس شدند! زمان کل: ${report.durationMs.toFixed(1)}ms`);
      } else {
        pushConsole('err', `${report.failed} آزمون از ${report.totalTests} آزمون ناموفق بود. زمان کل: ${report.durationMs.toFixed(1)}ms`);
      }

      report.suites.forEach((suite) => {
        const isOk = suite.failed === 0;
        pushConsole(
          isOk ? 'ok' : 'err',
          `${isOk ? '✓' : '✗'} ${suite.name} (${suite.passed}/${suite.cases.length} پاس شد - ${suite.durationMs.toFixed(1)}ms)`
        );
        suite.cases.forEach((c) => {
          if (!c.ok) {
            pushConsole('err', `    خطا در «${c.name}»: ${c.error}`);
          }
        });
      });
    } catch (err) {
      pushConsole('err', `خطای سیستمی اجرای آزمون‌ها: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  const insertAtCursor = (snippet: string) => {
    if (!activeFile || !textareaRef.current) return;
    const ta = textareaRef.current;
    const start = ta.selectionStart ?? activeFile.content.length;
    const end = ta.selectionEnd ?? start;
    const nextContent =
      activeFile.content.slice(0, start) + snippet + activeFile.content.slice(end);
    updateActiveFile({ content: nextContent });
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
    }, 0);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setShowFindBar((s) => !s);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor('  ');
    }
  };

  const downloadSingleFile = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const findMatches = useMemo(() => {
    if (!activeFile || !findText.trim()) return 0;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (activeFile.content.match(new RegExp(escaped, 'gi')) || []).length;
  }, [activeFile, findText]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0B0E14]">
      {/* Hidden File Inputs */}
      <input
        ref={codeUploadRef}
        type="file"
        multiple
        accept=".js,.mjs,.cjs,.ts,.tsx,.jsx,.css,.scss,.html,.htm,.json,.txt,.md,.glsl,.vert,.frag,.xml,.yaml,.yml,.csv"
        className="hidden"
        onChange={(e) => {
          void handleUploadCodeFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={zipImportRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleZipImport(f);
          e.target.value = '';
        }}
      />

      {/* Top IDE Toolbar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-slate-800 bg-[#111622] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-400 pl-2 border-l border-slate-800">
            <Code2 className="w-4 h-4" />
            <span>محیط کدنویسی</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setNewFilePath(`scripts/script_${files.length + 1}.js`);
              setShowNewForm((s) => !s);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            فایل کد جدید
          </button>

          <button
            type="button"
            onClick={() => codeUploadRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 text-xs text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            افزودن فایل کدنویسی
          </button>

          <button
            type="button"
            disabled={busyZip !== null}
            onClick={() => zipImportRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {busyZip === 'import' ? 'در حال استخراج ZIP...' : 'ورودی فایل زیپ (ZIP)'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeFile && (
            <button
              type="button"
              disabled={isRunningTest}
              onClick={handleRunTest}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
            >
              <Play className={`w-3.5 h-3.5 ${isRunningTest ? 'animate-spin' : ''}`} />
              {isRunningTest
                ? 'در حال اجرا در ورکر...'
                : `تست کد (${LANG_LABELS[activeFile.language]?.label || activeFile.language})`}
            </button>
          )}

          <button
            type="button"
            disabled={isRunningDiagnostics}
            onClick={handleRunDiagnostics}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 disabled:opacity-50 cursor-pointer"
            title="اجرای ۲۲ آزمون تشخیصی یکپارچگی استودیو"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRunningDiagnostics ? 'animate-spin' : ''}`} />
            {isRunningDiagnostics ? 'در حال اجرای آزمون‌ها...' : '۲۲ آزمون تشخیصی استودیو'}
          </button>

          <button
            type="button"
            onClick={() => setShowPermissionsModal(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
              permissions['script:execute']
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
            }`}
            title="مدیریت دسترسی‌ها و امنیت استودیو"
          >
            {permissions['script:execute'] ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            )}
            امنیت و دسترسی‌ها
          </button>

          <button
            type="button"
            disabled={busyZip !== null}
            onClick={async () => {
              setBusyZip('code');
              try {
                await exportCodeFilesZip(project);
                pushConsole('ok', 'خروجی ZIP فایل‌های کد با موفقیت دانلود شد.');
              } finally {
                setBusyZip(null);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-200 hover:bg-slate-700 cursor-pointer"
          >
            <FileArchive className="w-3.5 h-3.5 text-amber-400" />
            {busyZip === 'code' ? 'در حال ساخت...' : 'خروجی زیپ کدها'}
          </button>

          <button
            type="button"
            disabled={busyZip !== null}
            onClick={async () => {
              setBusyZip('full');
              try {
                await exportCompleteProjectZip(project);
                pushConsole('ok', 'بسته کامل پروژه (کد + رسانه + بازی HTML) به صورت ZIP دانلود شد.');
              } finally {
                setBusyZip(null);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-400/40 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/30 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            {busyZip === 'full' ? 'در حال بسته‌بندی...' : 'خروجی گرفتن زیپ کامل'}
          </button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Explorer Sidebar */}
        <aside className="w-64 shrink-0 border-l border-slate-800 bg-[#0F131C] flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-slate-800 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی فایل..."
                className="w-full pr-8 pl-2.5 py-1.5 rounded-md border border-slate-800 bg-[#0B0E14] text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
              />
            </div>

            {showNewForm && (
              <form onSubmit={handleCreateFile} className="space-y-1.5 p-2 rounded-lg bg-[#0B0E14] border border-amber-500/40">
                <label className="block text-[11px] text-amber-300">مسیر و نام فایل جدید:</label>
                <input
                  type="text"
                  dir="ltr"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="scripts/myLogic.js"
                  className="w-full px-2 py-1 rounded border border-slate-700 bg-[#131822] text-xs text-slate-100 font-mono text-left"
                />
                <div className="flex flex-wrap gap-1">
                  {['.js', '.css', '.html', '.json', '.ts'].map((ext) => (
                    <button
                      key={ext}
                      type="button"
                      onClick={() => {
                        const folder =
                          ext === '.css' ? 'styles' : ext === '.json' ? 'config' : ext === '.html' ? 'ui' : 'scripts';
                        setNewFilePath(`${folder}/file_${files.length + 1}${ext}`);
                      }}
                      className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300 hover:text-amber-300"
                    >
                      {ext}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5 pt-1">
                  <button
                    type="submit"
                    className="flex-1 py-1 rounded bg-amber-500 text-slate-950 text-[11px] font-bold hover:bg-amber-400"
                  >
                    ایجاد
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewForm(false)}
                    className="px-2 py-1 rounded bg-slate-800 text-[11px] text-slate-300"
                  >
                    لغو
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="px-3 py-2 text-[11px] text-slate-500 flex items-center justify-between border-b border-slate-800/70">
            <span>فایل‌های کد ({filteredFiles.length})</span>
            <button
              type="button"
              onClick={() => {
                setNewFilePath(`scripts/module_${files.length + 1}.js`);
                setShowNewForm(true);
              }}
              className="text-amber-400 hover:text-amber-300 flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" />
              جدید
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {filteredFiles.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 space-y-2">
                <FileCode2 className="w-7 h-7 mx-auto text-slate-600" />
                <p>فایل کدی وجود ندارد.</p>
              </div>
            ) : (
              filteredFiles.map((file) => {
                const isSel = activeFile?.id === file.id;
                const badge = LANG_LABELS[file.language];
                return (
                  <div
                    key={file.id}
                    onClick={() => setActiveId(file.id)}
                    className={`group flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer text-xs transition-colors ${
                      isSel
                        ? 'bg-sky-500/15 border border-sky-500/40 text-slate-100'
                        : 'border border-transparent text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          dir="ltr"
                          className={`px-1 py-0.2 rounded border text-[9px] font-mono shrink-0 ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                        <span dir="ltr" className="font-mono text-[11px] truncate">
                          {file.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span dir="ltr" className="truncate font-mono">
                          {file.path}
                        </span>
                        {file.enabledInRuntime && (
                          <span className="text-emerald-400 shrink-0 mr-1">فعال</span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      title="حذف فایل"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.id);
                      }}
                      className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Center Editor + Console */}
        <section className="flex-1 flex flex-col overflow-hidden">
          {!activeFile ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3 p-6">
              <FileCode2 className="w-12 h-12 text-slate-600" />
              <p className="text-sm">یک فایل جدید بسازید یا فایل کد / ZIP خود را وارد کنید.</p>
            </div>
          ) : (
            <>
              {/* Active File Header */}
              <div className="shrink-0 px-4 py-2 border-b border-slate-800 bg-[#0F131C] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="text"
                    dir="ltr"
                    value={activeFile.path}
                    onChange={(e) => {
                      const nextPath = e.target.value.replace(/^\/+/, '');
                      const nextName = nextPath.split('/').pop() || nextPath || activeFile.name;
                      updateActiveFile({
                        path: nextPath,
                        name: nextName,
                        language: detectCodeLanguageFromName(nextName),
                      });
                    }}
                    className="px-2.5 py-1 rounded border border-slate-700 bg-[#0B0E14] text-xs font-mono text-sky-300 w-56 text-left"
                  />

                  {(activeFile.language === 'javascript' || activeFile.language === 'css') && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer px-2 py-1 rounded bg-slate-800/60 border border-slate-700/70">
                      <input
                        type="checkbox"
                        checked={Boolean(activeFile.enabledInRuntime)}
                        onChange={(e) => updateActiveFile({ enabledInRuntime: e.target.checked })}
                      />
                      <span>اجرا در پیش‌نمایش و خروجی</span>
                    </label>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowFindBar((s) => !s)}
                    className="px-2 py-1 rounded border border-slate-700 bg-slate-800 text-[11px] text-slate-300 hover:text-slate-100"
                  >
                    جستجو در کد
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicateFile}
                    className="p-1.5 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:text-slate-100"
                    title="کپی فایل"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={downloadSingleFile}
                    className="p-1.5 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:text-amber-400"
                    title="دانلود همین فایل"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] text-slate-500 font-mono px-2 tabular-nums">
                    {lineCount} خط
                  </span>
                </div>
              </div>

              {/* Quick Language API Snippets Bar */}
              {(activeFile.language === 'javascript' ||
                activeFile.language === 'typescript' ||
                activeFile.language === 'python' ||
                activeFile.language === 'lua') && (
                <div className="shrink-0 px-4 py-1.5 border-b border-slate-800/80 bg-[#0D111A] flex items-center gap-2 overflow-x-auto">
                  <span className="flex items-center gap-1 text-[11px] text-amber-400 shrink-0">
                    <Sparkles className="w-3 h-3" />
                    تکه کدهای آماده ({LANG_LABELS[activeFile.language]?.label}):
                  </span>
                  {(activeFile.language === 'python'
                    ? QUICK_SNIPPETS_PY
                    : activeFile.language === 'lua'
                      ? QUICK_SNIPPETS_LUA
                      : QUICK_SNIPPETS_JS
                  ).map((sn) => (
                    <button
                      key={sn.label}
                      type="button"
                      onClick={() => insertAtCursor(sn.code)}
                      className="px-2 py-0.5 rounded bg-slate-800/90 border border-slate-700 text-[11px] text-slate-200 hover:border-amber-400 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      + {sn.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Search Bar */}
              {showFindBar && (
                <div className="shrink-0 px-4 py-1.5 border-b border-slate-800 bg-[#131822] flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    dir="ltr"
                    value={findText}
                    onChange={(e) => setFindText(e.target.value)}
                    placeholder="عبارت مورد نظر در کد..."
                    className="px-2.5 py-1 rounded border border-slate-700 bg-[#0B0E14] text-xs font-mono text-slate-100 w-64 text-left"
                  />
                  <span className="text-xs text-slate-400 tabular-nums">
                    {findMatches} مورد پیدا شد
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFindBar(false)}
                    className="mr-auto text-xs text-slate-400 hover:text-slate-200"
                  >
                    بستن
                  </button>
                </div>
              )}

              {/* Code Textarea with Synchronized Line Numbers */}
              <div dir="ltr" className="flex-1 flex overflow-hidden bg-[#090C12] relative">
                <div
                  ref={gutterRef}
                  aria-hidden="true"
                  className="w-12 shrink-0 py-3 px-2 bg-[#0D1119] border-r border-slate-800 text-right font-mono text-xs leading-6 text-slate-500 select-none overflow-hidden"
                >
                  {Array.from({ length: lineCount }, (_, idx) => (
                    <div key={idx}>{idx + 1}</div>
                  ))}
                </div>

                <textarea
                  ref={textareaRef}
                  dir="ltr"
                  spellCheck={false}
                  value={activeFile.content}
                  onChange={(e) => updateActiveFile({ content: e.target.value })}
                  onKeyDown={handleEditorKeyDown}
                  onScroll={(e) => {
                    if (gutterRef.current) {
                      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                    }
                  }}
                  className="flex-1 h-full p-3 bg-transparent text-slate-100 font-mono text-xs leading-6 resize-none focus:outline-none overflow-auto whitespace-pre"
                />
              </div>

              {/* Bottom Output Console */}
              <div className="h-36 shrink-0 border-t border-slate-800 bg-[#0D1119] flex flex-col overflow-hidden">
                <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    کنسول اجرا و بررسی خطا
                  </span>
                  <button
                    type="button"
                    onClick={() => setConsoleLogs([])}
                    className="text-slate-500 hover:text-slate-300"
                  >
                    پاک کردن کنسول
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 font-mono text-xs">
                  {consoleLogs.length === 0 ? (
                    <div className="text-slate-600">خروجی کنسول خالی است.</div>
                  ) : (
                    consoleLogs.map((entry, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 ${
                          entry.type === 'err'
                            ? 'text-red-400'
                            : entry.type === 'ok'
                              ? 'text-emerald-300'
                              : 'text-slate-400'
                        }`}
                      >
                        {entry.type === 'err' ? (
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        )}
                        <span className="break-all">{entry.text}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Permissions & Security Modal */}
      {showPermissionsModal && (
        <div
          dir="rtl"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="w-full max-w-xl bg-[#0F1420] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800 bg-[#141B2A] flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
                <Shield className="w-4 h-4 text-emerald-400" />
                مدیریت دسترسی‌های امنیتی استودیو (Zero-Trust Security)
              </div>
              <button
                type="button"
                onClick={() => setShowPermissionsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 leading-relaxed">
                طبق الزامات امنیتی، کدهای سفارشی کاربر و دسترسی به حافظه، وب‌اسمبلی و خروجی‌ها به طور پیش‌فرض رد می‌شوند (Deny by default) تا کاربر کنترل کامل روی اجرای پروژه‌ها داشته باشد.
              </div>

              {/* Scopes List */}
              <div className="space-y-2">
                {(
                  [
                    'script:execute',
                    'storage:write',
                    'network:fetch',
                    'audio:play',
                    'export:package',
                    'ai:generate',
                  ] as PermissionScope[]
                ).map((scope) => {
                  const meta = permissionManager.getScopeMetadata(scope);
                  const isGranted = Boolean(permissions[scope]);

                  return (
                    <div
                      key={scope}
                      className="p-3 rounded-xl bg-[#141926] border border-slate-800/90 flex items-center justify-between gap-3"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-semibold text-slate-200 flex items-center gap-2">
                          <span>{meta.title}</span>
                          <span dir="ltr" className="font-mono text-[10px] text-slate-500">
                            {scope}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 leading-normal">
                          {meta.desc}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (isGranted) {
                            permissionManager.revokePermission(scope, 'تغییر دستی توسط کاربر در پنجره امنیت');
                          } else {
                            permissionManager.grantPermission(scope, 'تأیید دستی توسط کاربر در پنجره امنیت');
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold text-xs shrink-0 cursor-pointer transition-colors ${
                          isGranted
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-200 hover:bg-slate-700'
                        }`}
                      >
                        {isGranted ? 'فعال (مجاز)' : 'غیرفعال (مسدود)'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Quick Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      (
                        [
                          'script:execute',
                          'storage:write',
                          'network:fetch',
                          'audio:play',
                          'export:package',
                          'ai:generate',
                        ] as PermissionScope[]
                      ).forEach((sc) => permissionManager.grantPermission(sc, 'فعال‌سازی سریع محیط توسعه'));
                      pushConsole('ok', 'تمامی دسترسی‌های استودیو فعال شدند.');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 cursor-pointer"
                  >
                    فعال‌سازی تمام دسترسی‌ها (حالت توسعه)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      permissionManager.resetAllPermissions();
                      pushConsole('info', 'دسترسی‌ها به حالت پیش‌فرض (مسدود) بازنشانی شدند.');
                    }}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-slate-100 cursor-pointer"
                  >
                    بازنشانی به پیش‌فرض
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setShowPermissionsModal(false)}
                  className="px-4 py-1.5 rounded-lg bg-sky-500 text-slate-950 font-bold hover:bg-sky-400 cursor-pointer"
                >
                  بستن
                </button>
              </div>

              {/* Audit Log Preview */}
              <div className="pt-2">
                <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                  آخرین وقایع سیاهه بازرسی امنیت (Security Audit Log):
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1 font-mono text-[10px] bg-[#0A0D14] p-2.5 rounded-lg border border-slate-800/80">
                  {permissionManager.getAuditLog().length === 0 ? (
                    <div className="text-slate-600">هنوز رخدادی ثبت نشده است.</div>
                  ) : (
                    permissionManager
                      .getAuditLog()
                      .slice(-6)
                      .reverse()
                      .map((rec) => (
                        <div key={rec.id} className="text-slate-400 flex items-center justify-between">
                          <span className="text-sky-300 font-semibold">{rec.scope}</span>
                          <span
                            className={
                              rec.action === 'granted'
                                ? 'text-emerald-400'
                                : rec.action === 'revoked' || rec.action === 'denied'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                            }
                          >
                            [{rec.action.toUpperCase()}]
                          </span>
                          <span className="text-slate-500 truncate max-w-[200px]">{rec.reason || '-'}</span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
