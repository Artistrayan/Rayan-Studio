import React, { useRef, useState } from 'react';
import {
  Box,
  Copy,
  FolderOpen,
  Gamepad2,
  Layers,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { EngineMode, RayanProject } from '../types/studio';

interface ProjectsViewProps {
  projects: RayanProject[];
  activeProjectId: string;
  onOpenProject: (project: RayanProject) => void;
  onCreateProject: (name: string, mode: EngineMode) => void;
  onDuplicateProject: (project: RayanProject) => void;
  onDeleteProject: (id: string) => void;
  onImportProjectFile: (file: File) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  activeProjectId,
  onOpenProject,
  onCreateProject,
  onDuplicateProject,
  onDeleteProject,
  onImportProjectFile,
}) => {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<EngineMode>('2d');
  const [filterMode, setFilterMode] = useState<'all' | '2d' | '3d'>('all');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = projects.filter((p) => {
    if (filterMode !== 'all' && p.engineMode !== filterMode) return false;
    if (search.trim() && !p.name.includes(search.trim()) && !p.description.includes(search.trim())) {
      return false;
    }
    return true;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newName.trim() || (newMode === '3d' ? 'پروژه سه‌بعدی جدید' : 'پروژه دوبعدی جدید');
    onCreateProject(title, newMode);
    setNewName('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-8">
      {/* Top Create New Project Row */}
      <section className="rounded-xl border border-slate-800 bg-[#131822] p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-slate-100">ساخت پروژه جدید در استودیو رایان</h1>
            <p className="text-sm text-slate-400">
              پروژه‌ها به صورت کاملاً آفلاین در حافظه دستگاه ذخیره می‌شوند و برای وب، اندروید و ویندوز خروجی می‌دهند.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.rayan.json,.zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportProjectFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 bg-slate-800/70 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-4 h-4" />
              ورودی فایل پروژه / زیپ (ZIP)
            </button>
          </div>
        </div>

        <form onSubmit={handleCreate} className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="نام بازی جدید (مثلاً: شوالیه کوهستان)..."
              className="w-full px-4 py-2.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="md:col-span-3 flex items-center gap-1 p-1 rounded-lg bg-[#0B0E14] border border-slate-800">
            <button
              type="button"
              onClick={() => setNewMode('2d')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                newMode === '2d'
                  ? 'bg-slate-800 text-amber-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              موتور دو‌بعدی
            </button>
            <button
              type="button"
              onClick={() => setNewMode('3d')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                newMode === '3d'
                  ? 'bg-slate-800 text-sky-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              موتور سه‌بعدی
            </button>
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              className="w-full h-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 text-slate-950 text-sm font-bold hover:bg-amber-400 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              ساخت پروژه
            </button>
          </div>
        </form>
      </section>

      {/* Saved Projects List */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-semibold text-slate-100">پروژه‌های ذخیره شده</h2>
            <span className="text-xs text-slate-400 tabular-nums">{filtered.length} پروژه</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جستجوی پروژه..."
                className="pr-9 pl-3 py-1.5 rounded-lg border border-slate-800 bg-[#131822] text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-[#131822] border border-slate-800">
              {(['all', '2d', '3d'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFilterMode(mode)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    filterMode === mode
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode === 'all' ? 'همه' : mode === '2d' ? 'دو‌بعدی' : 'سه‌بعدی'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#131822] p-12 text-center space-y-3">
            <Gamepad2 className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-300 font-medium">هیچ پروژه‌ای با این فیلتر پیدا نشد.</p>
            <p className="text-xs text-slate-500">از بخش بالا یک پروژه دو‌بعدی یا سه‌بعدی جدید بسازید.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((proj) => {
              const isCurrent = proj.id === activeProjectId;
              return (
                <div
                  key={proj.id}
                  className={`rounded-xl border bg-[#131822] p-5 flex flex-col justify-between gap-4 transition-colors ${
                    isCurrent ? 'border-amber-500/70' : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold text-slate-100 truncate">{proj.name}</h3>
                      {isCurrent && (
                        <span className="text-xs font-medium text-amber-400 shrink-0">فعال</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {proj.description || 'پروژه بازی‌سازی در استودیو رایان'}
                    </p>
                    <div className="pt-1 flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span>{proj.engineMode === '3d' ? 'موتور سه‌بعدی' : 'موتور دو‌بعدی'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.entities.length} آبجکت</span>
                      <span aria-hidden="true">·</span>
                      <span>{proj.rules.length} قانون</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenProject(proj)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold hover:bg-amber-500/25 transition-colors whitespace-nowrap"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      باز کردن در ویرایشگر
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title="کپی پروژه"
                        onClick={() => onDuplicateProject(proj)}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {projects.length > 1 && (
                        <button
                          type="button"
                          title="حذف پروژه"
                          onClick={() => onDeleteProject(proj.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
