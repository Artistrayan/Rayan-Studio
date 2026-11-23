import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Cpu,
  Plus,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { GameRule, RayanProject } from '../types/studio';
import {
  READY_SCRIPT_LIBRARY,
  parsePersianRules,
  ruleToPersianLine,
} from '../engine/ruleParser';

interface RulesAndAiPanelProps {
  project: RayanProject;
  onUpdateRulesText: (text: string) => void;
}

export const RulesAndAiPanel: React.FC<RulesAndAiPanelProps> = ({
  project,
  onUpdateRulesText,
}) => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const { diagnostics } = useMemo(
    () => parsePersianRules(project.rulesText, project.entities),
    [project.rulesText, project.entities]
  );

  const appendRuleLine = (line: string) => {
    const clean = project.rulesText.trim();
    onUpdateRulesText(clean ? `${clean}\n${line}` : line);
  };

  const handleGenerateAiRules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiMessage(null);

    try {
      const resp = await fetch('/api/ai/generate-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          engineMode: project.engineMode,
          entities: project.entities.map((ent) => ({ name: ent.name, role: ent.role })),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAiMessage({ type: 'err', text: data.error || 'خطا در تولید قوانین با هوش مصنوعی' });
        return;
      }

      const generatedRules = (data.rules || []) as Array<
        Partial<GameRule> & { persianLine?: string; intervalSeconds?: number }
      >;
      if (generatedRules.length === 0) {
        setAiMessage({ type: 'err', text: 'قانونی از متن شما استخراج نشد. لطفاً با جزئیات بیشتری بنویسید.' });
        return;
      }

      const newLines = generatedRules
        .map((r) => {
          const fakeRule: GameRule = {
            id: 'ai',
            enabled: true,
            persianLine: r.persianLine || '',
            triggerType: (r.triggerType as GameRule['triggerType']) || 'always',
            key: r.key,
            targetName: r.targetName || project.entities[0]?.name || 'بازیکن',
            secondaryName: r.secondaryName,
            intervalSeconds: r.intervalSeconds,
            varName: r.varName,
            operator: r.operator as '>=' | '<=' | '==' | undefined,
            varValue: r.varValue,
            actionType: (r.actionType as GameRule['actionType']) || 'move-right',
            paramNumber: r.paramNumber,
            paramAngle: r.paramAngle,
            paramText: r.paramText,
          };
          return ruleToPersianLine(fakeRule);
        })
        .join('\n');

      appendRuleLine(newLines);
      setAiMessage({
        type: 'ok',
        text: data.summary || `${generatedRules.length} قانون هوشمند به بازی اضافه شد.`,
      });
      setAiPrompt('');
    } catch {
      setAiMessage({
        type: 'err',
        text: 'ارتباط آنلاین برقرار نیست. می‌توانید از کتابخانه آماده اسکریپت‌نویسی آفلاین در پایین استفاده کنید.',
      });
    } finally {
      setAiLoading(false);
    }
  };

  const quickCommands = [
    { label: 'حرکت راست', line: 'کلید راست: بازیکن حرکت راست سرعت 260' },
    { label: 'حرکت چپ', line: 'کلید چپ: بازیکن حرکت چپ سرعت 260' },
    { label: 'پرش', line: 'کلید فاصله: بازیکن پرش قدرت 540' },
    { label: 'پرتاب', line: 'کلید E: بازیکن پرتاب قدرت 580 زاویه 25' },
    { label: 'تایمر تولید دشمن', line: 'هر 3 ثانیه: تولید نگهبان | متغیر موج +1' },
    { label: 'انفجار + لرزش', line: 'برخورد بازیکن با نگهبان: جان -20 | افکت انفجار | لرزش دوربین قدرت 12 | صدا hit' },
    { label: 'برخورد با سکه', line: 'برخورد بازیکن با سکه: امتیاز +10 | افکت جرقه | حذف سکه | صدا coin' },
    { label: 'پایان و مرحله بعد', line: 'رسیدن بازیکن به پایان: افکت جرقه | ذخیره پیشرفت | مرحله بعد' },
    { label: 'ذخیره پیشرفت', line: 'کلید F: ذخیره پیشرفت | نمایش پیام "پیشرفت ذخیره شد"' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-6xl mx-auto w-full space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Persian Text Rule Editor */}
        <section className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#131822] p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-100">ویرایشگر متنی دستورات و قوانین بازی</h2>
              <p className="text-xs text-slate-400">
                هر خط یک قانون واقعی است که مستقیماً توسط موتور فیزیک، ذرات و مراحل رایان اجرا می‌شود.
              </p>
            </div>
            <span className="text-xs text-slate-400 tabular-nums shrink-0">
              {project.rules.length} قانون فعال
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {quickCommands.map((cmd) => (
              <button
                key={cmd.label}
                type="button"
                onClick={() => appendRuleLine(cmd.line)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-xs text-slate-300 hover:border-amber-500/60 hover:text-amber-300 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3 h-3" />
                {cmd.label}
              </button>
            ))}
          </div>

          <textarea
            value={project.rulesText}
            onChange={(e) => onUpdateRulesText(e.target.value)}
            rows={12}
            dir="rtl"
            spellCheck={false}
            placeholder="مثال:&#10;کلید راست: بازیکن حرکت راست سرعت 260&#10;هر 3 ثانیه: تولید نگهبان&#10;رسیدن بازیکن به پایان: افکت جرقه | مرحله بعد"
            className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] p-4 text-sm text-slate-100 leading-7 focus:outline-none focus:border-amber-500"
          />

          {/* Line-by-line live parser diagnostics */}
          <div className="space-y-1.5 max-h-52 overflow-y-auto pt-2 border-t border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400">بررسی زنده دستورات</h3>
            {diagnostics.length === 0 ? (
              <p className="text-xs text-slate-500">هنوز دستوری نوشته نشده است.</p>
            ) : (
              diagnostics.map((d) => (
                <div
                  key={`${d.lineNumber}_${d.rawLine}`}
                  className="flex items-start gap-2 text-xs py-1 px-2 rounded bg-[#0B0E14]"
                >
                  {d.valid ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <span className="text-slate-500 tabular-nums shrink-0">خط {d.lineNumber}:</span>
                  <span className={d.valid ? 'text-slate-300' : 'text-amber-300'}>{d.message}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right: AI Generator + Offline Ready Scripting Library */}
        <section className="lg:col-span-5 space-y-6">
          {/* Online Gemini AI Assistant */}
          <div className="rounded-xl border border-slate-800 bg-[#131822] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-slate-100">تولید هوشمند قوانین با هوش مصنوعی</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              توضیح دهید چه مکانیسمی می‌خواهید (مثلاً: «هر ۴ ثانیه یک دشمن ساخته شود و با برخورد انفجار و لرزش رخ دهد») تا قوانین اجرایی ساخته شود.
            </p>
            <form onSubmit={handleGenerateAiRules} className="space-y-2.5">
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={3}
                placeholder="رفتار بازی را به فارسی بنویسید..."
                className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] p-3 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={aiLoading || !aiPrompt.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 disabled:opacity-50 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiLoading ? 'در حال تبدیل به قوانین...' : 'تبدیل به قوانین بازی'}
              </button>
            </form>
            {aiMessage && (
              <div
                className={`rounded-lg px-3 py-2 text-xs border ${
                  aiMessage.type === 'ok'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}
              >
                {aiMessage.text}
              </div>
            )}
          </div>

          {/* 100% Offline Ready Script & AI Behavior Library */}
          <div className="rounded-xl border border-slate-800 bg-[#131822] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-bold text-slate-100">کتابخانه آماده اسکریپت‌نویسی و هوش مصنوعی (آفلاین)</h3>
            </div>
            <div className="space-y-2.5">
              {READY_SCRIPT_LIBRARY.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                        <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span>{item.title}</span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        appendRuleLine(
                          project.engineMode === '3d' ? item.persianRules3D : item.persianRules2D
                        )
                      }
                      className="px-3 py-1.5 rounded-md bg-slate-800 text-sky-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
                    >
                      افزودن به قوانین
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateRulesText(
                          project.engineMode === '3d' ? item.persianRules3D : item.persianRules2D
                        )
                      }
                      className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 text-xs hover:bg-slate-800 transition-colors"
                    >
                      جایگزینی کامل
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
