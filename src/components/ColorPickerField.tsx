import React, { useEffect, useRef, useState } from 'react';
import { Check, Pipette } from 'lucide-react';

interface ColorPickerFieldProps {
  value: string;
  onChange: (nextColor: string) => void;
  label?: string;
  allowAlpha?: boolean;
}

const PRESET_COLORS = [
  '#F59E0B',
  '#FBBF24',
  '#EF4444',
  '#F97316',
  '#10B981',
  '#22C55E',
  '#38BDF8',
  '#0EA5E9',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#F43F5E',
  '#14B8A6',
  '#F8FAFC',
  '#E2E8F0',
  '#94A3B8',
  '#475569',
  '#334155',
  '#1E293B',
  '#0F172A',
  '#0B0E14',
  '#78350F',
  '#000000',
];

const ALPHA_PRESETS = [
  { label: 'تیره شفاف', value: 'rgba(15, 23, 42, 0.85)' },
  { label: 'مشکی شفاف', value: 'rgba(11, 14, 20, 0.75)' },
  { label: 'کهربایی شفاف', value: 'rgba(245, 158, 11, 0.25)' },
  { label: 'آبی شفاف', value: 'rgba(56, 189, 248, 0.25)' },
  { label: 'بی‌رنگ', value: 'transparent' },
];

function toSafeHex(color: string): string {
  const trimmed = (color || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const rgbaMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    const hex = [rgbaMatch[1], rgbaMatch[2], rgbaMatch[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }
  return '#0F172A';
}

export const ColorPickerField: React.FC<ColorPickerFieldProps> = ({
  value,
  onChange,
  label,
  allowAlpha = false,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || '#F59E0B');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nativeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(value || '#F59E0B');
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDocDown);
    return () => window.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const safeHex = toSafeHex(value);

  const commitDraft = (raw: string) => {
    setDraft(raw);
    const clean = raw.trim();
    if (
      /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(clean) ||
      /^rgba?\(/i.test(clean) ||
      clean === 'transparent'
    ) {
      onChange(clean);
    }
  };

  return (
    <div ref={wrapRef} className="relative space-y-1">
      {label && <label className="text-slate-400 block">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-8 px-2 rounded-lg border border-slate-700 bg-[#0B0E14] hover:border-slate-500 flex items-center justify-between gap-2 text-xs text-slate-200 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span
            className="w-5 h-5 rounded border border-white/20 shrink-0"
            style={{
              backgroundColor: value === 'transparent' ? 'transparent' : value || '#F59E0B',
              backgroundImage:
                value === 'transparent'
                  ? 'linear-gradient(45deg, #334155 25%, transparent 25%, transparent 75%, #334155 75%), linear-gradient(45deg, #334155 25%, transparent 25%, transparent 75%, #334155 75%)'
                  : undefined,
              backgroundSize: '8px 8px',
              backgroundPosition: '0 0, 4px 4px',
            }}
          />
          <span dir="ltr" className="font-mono text-[11px] truncate text-slate-300">
            {value === 'transparent' ? 'شفاف' : safeHex.toUpperCase()}
          </span>
        </span>
        <Pipette className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-slate-700 bg-[#131822] p-2.5 shadow-2xl space-y-2.5 min-w-[220px]">
          <div className="grid grid-cols-6 gap-1.5">
            {PRESET_COLORS.map((hex) => {
              const active = safeHex.toLowerCase() === hex.toLowerCase() && value !== 'transparent';
              return (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onClick={() => {
                    onChange(hex);
                    setDraft(hex);
                  }}
                  style={{ backgroundColor: hex }}
                  className={`w-full aspect-square rounded-md border flex items-center justify-center transition-transform hover:scale-110 cursor-pointer ${
                    active ? 'border-white ring-2 ring-amber-400/70' : 'border-white/15'
                  }`}
                >
                  {active && (
                    <Check
                      className={`w-3 h-3 ${
                        ['#F8FAFC', '#E2E8F0', '#FBBF24', '#F59E0B'].includes(hex)
                          ? 'text-slate-950'
                          : 'text-white'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {allowAlpha && (
            <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800">
              {ALPHA_PRESETS.map((ap) => (
                <button
                  key={ap.value}
                  type="button"
                  onClick={() => {
                    onChange(ap.value);
                    setDraft(ap.value);
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                    value === ap.value
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-slate-700 bg-[#0B0E14] text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {ap.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800">
            <input
              type="text"
              dir="ltr"
              value={draft}
              onChange={(e) => commitDraft(e.target.value)}
              placeholder="#F59E0B"
              className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 font-mono text-[11px] focus:outline-none focus:border-amber-500"
            />
            <label
              title="طیف رنگ دقیق"
              onClick={() => nativeInputRef.current?.click()}
              className="relative px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] hover:border-amber-500 text-[10px] text-slate-300 cursor-pointer shrink-0 flex items-center gap-1"
            >
              <span>طیف</span>
              <input
                ref={nativeInputRef}
                type="color"
                value={safeHex}
                onChange={(e) => {
                  onChange(e.target.value);
                  setDraft(e.target.value);
                }}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
