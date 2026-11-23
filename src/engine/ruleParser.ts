import type { GameEntity, GameRule, ParticlePreset, RayanProject } from '../types/studio';

export interface ParsedRuleDiagnostic {
  lineNumber: number;
  rawLine: string;
  valid: boolean;
  message: string;
  rules: GameRule[];
}

const KEY_ALIASES: Record<string, string> = {
  راست: 'ArrowRight',
  'فلش راست': 'ArrowRight',
  چپ: 'ArrowLeft',
  'فلش چپ': 'ArrowLeft',
  بالا: 'ArrowUp',
  'فلش بالا': 'ArrowUp',
  پایین: 'ArrowDown',
  'فلش پایین': 'ArrowDown',
  فاصله: 'Space',
  اسپیس: 'Space',
  پرش: 'Space',
  space: 'Space',
  w: 'KeyW',
  a: 'KeyA',
  s: 'KeyS',
  d: 'KeyD',
  e: 'KeyE',
  f: 'KeyF',
  enter: 'Enter',
  اینتر: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  shift: 'ShiftLeft',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
  arrowright: 'ArrowRight',
  arrowleft: 'ArrowLeft',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
};

const PARTICLE_MAP: Record<string, ParticlePreset> = {
  انفجار: 'explosion',
  explosion: 'explosion',
  جرقه: 'sparkle',
  sparkle: 'sparkle',
  دود: 'smoke',
  smoke: 'smoke',
  برف: 'snow',
  snow: 'snow',
  باران: 'rain',
  rain: 'rain',
};

function makeId(index: number, sub: number): string {
  return `rule_${index}_${sub}`;
}

function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/٫/g, '.');
}

function extractNumber(text: string, keywordRegex: RegExp, fallback: number): number {
  const m = normalizeDigits(text).match(keywordRegex);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function findMatchingEntityName(clause: string, entities: GameEntity[], fallback: string): string {
  const candidates: string[] = [];
  for (const entity of entities) {
    if (entity.name) candidates.push(entity.name);
    if (entity.textConfig?.children) {
      for (const child of entity.textConfig.children) {
        if (child.name) candidates.push(child.name);
      }
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  for (const name of candidates) {
    if (clause.includes(name)) {
      return name;
    }
  }
  return fallback;
}

function parseSingleAction(
  actionText: string,
  entities: GameEntity[],
  defaultTarget: string,
  defaultSecondary?: string
): Partial<GameRule> | null {
  const clean = normalizeDigits(actionText).trim();
  if (!clean) return null;

  const targetName = findMatchingEntityName(clean, entities, defaultTarget);

  if (clean.includes('مرحله بعد') || clean.includes('صحنه بعد')) {
    return { actionType: 'next-scene', targetName };
  }
  if (clean.includes('رفتن به صحنه') || clean.includes('شروع صحنه')) {
    const quoted = clean.match(/["«']([^"»']+)["»']/);
    const sceneName =
      quoted?.[1] ||
      clean.replace(/رفتن به صحنه|شروع صحنه/g, '').trim() ||
      'مرحله ۲';
    return { actionType: 'go-to-scene', targetName, paramText: sceneName };
  }
  if (clean.includes('ذخیره پیشرفت') || clean.includes('ذخیره بازی')) {
    return { actionType: 'save-progress', targetName };
  }
  if (clean.includes('بارگذاری پیشرفت') || clean.includes('ادامه بازی')) {
    return { actionType: 'load-progress', targetName };
  }
  if (clean.includes('لرزش دوربین')) {
    const power = extractNumber(clean, /(?:قدرت|شدت|اندازه)?\s*(\d+)/, 10);
    return { actionType: 'camera-shake', targetName, paramNumber: power };
  }
  if (clean.includes('افکت') || clean.includes('ذرات')) {
    let preset: ParticlePreset = 'sparkle';
    for (const [k, v] of Object.entries(PARTICLE_MAP)) {
      if (clean.includes(k)) {
        preset = v;
        break;
      }
    }
    return { actionType: 'spawn-particles', targetName, paramText: preset };
  }
  if (clean.includes('تولید') || clean.includes('ساخت') || clean.includes('اسپاون')) {
    const templateName = findMatchingEntityName(clean, entities, targetName);
    return { actionType: 'spawn-entity', targetName: templateName };
  }
  if (clean.includes('متغیر')) {
    const mEq = clean.match(/متغیر\s+([^\s=+]+)\s*=\s*([+-]?\d+(?:\.\d+)?)/);
    if (mEq) {
      return {
        actionType: 'set-var',
        targetName,
        varName: mEq[1],
        paramNumber: Number(mEq[2]),
      };
    }
    const mAdd = clean.match(/متغیر\s+([^\s+-]+)\s*([+-])\s*(\d+(?:\.\d+)?)/);
    if (mAdd) {
      return {
        actionType: 'add-var',
        targetName,
        varName: mAdd[1],
        paramNumber: Number(`${mAdd[2]}${mAdd[3]}`),
      };
    }
  }

  if (clean.includes('حذف دومی') || (defaultSecondary && clean.includes(`حذف ${defaultSecondary}`))) {
    return { actionType: 'destroy-other', targetName, secondaryName: defaultSecondary };
  }
  if (clean.includes('حذف')) {
    return {
      actionType: 'destroy-self',
      targetName: findMatchingEntityName(clean, entities, defaultSecondary || defaultTarget),
    };
  }
  if (clean.includes('بازگشت') || clean.includes('شروع مجدد')) {
    return { actionType: 'respawn', targetName };
  }
  if (clean.includes('تغییر متن')) {
    const quoted = clean.match(/["«']([^"»']+)["»']/);
    return { actionType: 'set-text', targetName, paramText: quoted ? quoted[1] : 'متن جدید' };
  }
  if (clean.includes('اسکرول')) {
    const amount = extractNumber(clean, /(?:مقدار|اندازه)\s+(-?\d+)/, 60);
    const axis = clean.includes('افقی') ? 'x' : 'y';
    return { actionType: 'scroll-box', targetName, paramNumber: amount, paramText: axis };
  }
  if (clean.includes('امتیاز')) {
    const match = clean.match(/([+-]?\d+)/);
    const amount = match ? Number(match[1]) : 10;
    return { actionType: 'add-score', targetName, paramNumber: amount };
  }
  if (clean.includes('جان') || clean.includes('سلامت')) {
    const match = clean.match(/([+-]?\d+)/);
    const amount = match ? Number(match[1]) : -10;
    return { actionType: 'add-health', targetName, paramNumber: amount };
  }
  if (clean.includes('صدا') || clean.includes('پخش')) {
    const soundMatch = clean.match(/(?:صدا|صدای)\s+([^\s|]+)/);
    const soundName = soundMatch ? soundMatch[1].trim() : 'coin';
    return { actionType: 'play-sound', targetName, paramText: soundName };
  }
  if (clean.includes('پیام') || clean.includes('نمایش')) {
    const quoted = clean.match(/["«']([^"»']+)["»']/);
    const msg = quoted ? quoted[1] : clean.replace(/نمایش|پیام/g, '').trim() || 'مرحله کامل شد!';
    return { actionType: 'show-message', targetName, paramText: msg };
  }
  if (clean.includes('پرتاب خود') || clean.includes('پرتاب شود')) {
    const power = extractNumber(clean, /(?:قدرت|سرعت)\s+(\d+)/, 480);
    const angle = extractNumber(clean, /زاویه\s+(\d+)/, 45);
    return { actionType: 'throw-self', targetName, paramNumber: power, paramAngle: angle };
  }
  if (clean.includes('پرتاب')) {
    const power = extractNumber(clean, /(?:قدرت|سرعت)\s+(\d+)/, 560);
    const angle = extractNumber(clean, /زاویه\s+(\d+)/, 25);
    return { actionType: 'throw-projectile', targetName, paramNumber: power, paramAngle: angle };
  }
  if (clean.includes('پرش') || clean.includes('بپرد')) {
    const power = extractNumber(clean, /(?:قدرت|ارتفاع)\s+(\d+)/, 520);
    return { actionType: 'jump', targetName, paramNumber: power };
  }
  if (clean.includes('رفت و برگشت') || clean.includes('گشت')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 110);
    return { actionType: 'patrol-horizontal', targetName, paramNumber: speed };
  }
  if (clean.includes('تعقیب') || clean.includes('دنبال')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 95);
    const chaseTarget = entities.find((e) => e.name !== targetName && clean.includes(e.name))?.name || 'بازیکن';
    return { actionType: 'chase-target', targetName, secondaryName: chaseTarget, paramNumber: speed };
  }
  if (clean.includes('مدار') || clean.includes('چرخش دور')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 2);
    const centerTarget = entities.find((e) => e.name !== targetName && clean.includes(e.name))?.name || 'بازیکن';
    return { actionType: 'orbit-target', targetName, secondaryName: centerTarget, paramNumber: speed };
  }
  if (clean.includes('جلو')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 240);
    return { actionType: 'move-forward', targetName, paramNumber: speed };
  }
  if (clean.includes('عقب')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 240);
    return { actionType: 'move-backward', targetName, paramNumber: speed };
  }
  if (clean.includes('راست')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 240);
    return { actionType: 'move-right', targetName, paramNumber: speed };
  }
  if (clean.includes('چپ')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 240);
    return { actionType: 'move-left', targetName, paramNumber: speed };
  }
  if (clean.includes('بالا')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 240);
    return { actionType: 'move-up', targetName, paramNumber: speed };
  }
  if (clean.includes('پایین')) {
    const speed = extractNumber(clean, /سرعت\s+(\d+)/, 240);
    return { actionType: 'move-down', targetName, paramNumber: speed };
  }

  return null;
}

export function parsePersianRules(
  rulesText: string,
  entities: GameEntity[]
): { rules: GameRule[]; diagnostics: ParsedRuleDiagnostic[] } {
  const lines = rulesText.split('\n');
  const allRules: GameRule[] = [];
  const diagnostics: ParsedRuleDiagnostic[] = [];
  const fallbackPlayer = entities.find((e) => e.role === 'player')?.name || entities[0]?.name || 'بازیکن';

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    let lineToParse = trimmed;
    if (lineToParse.startsWith('اگر ')) {
      lineToParse = lineToParse.slice(4).trim();
    }

    let sepIdx = -1;
    let sepLen = 1;
    if (lineToParse.includes(':')) {
      sepIdx = lineToParse.indexOf(':');
      sepLen = 1;
    } else if (lineToParse.includes('->')) {
      sepIdx = lineToParse.indexOf('->');
      sepLen = 2;
    } else if (lineToParse.includes('آنگاه')) {
      sepIdx = lineToParse.indexOf('آنگاه');
      sepLen = 5;
    } else if (lineToParse.includes('سپس')) {
      sepIdx = lineToParse.indexOf('سپس');
      sepLen = 4;
    }

    if (sepIdx === -1) {
      diagnostics.push({
        lineNumber: idx + 1,
        rawLine: trimmed,
        valid: false,
        message: 'از علامت «:» یا واژه «آنگاه» بین شرط و دستور استفاده کنید (مثال: کلید راست: بازیکن حرکت راست سرعت 250)',
        rules: [],
      });
      return;
    }

    const triggerClause = normalizeDigits(lineToParse.slice(0, sepIdx)).trim();
    const actionClause = normalizeDigits(lineToParse.slice(sepIdx + sepLen)).trim();

    let triggerType: GameRule['triggerType'] = 'always';
    let key: string | undefined;
    let triggerTarget = fallbackPlayer;
    let triggerSecondary: string | undefined;
    let intervalSeconds: number | undefined;
    let varName: string | undefined;
    let operator: '>=' | '<=' | '==' | undefined;
    let varValue: number | undefined;

    if (triggerClause.includes('شروع')) {
      triggerType = 'on-start';
    } else if (triggerClause.includes('همیشه')) {
      triggerType = 'always';
    } else if (triggerClause.includes('هر') && triggerClause.includes('ثانیه')) {
      triggerType = 'every-seconds';
      const secMatch = triggerClause.match(/هر\s*(\d+(?:\.\d+)?)\s*ثانیه/);
      intervalSeconds = secMatch ? Math.max(0.2, Number(secMatch[1])) : 2;
    } else if (triggerClause.includes('تله') || triggerClause.includes('خطر') || triggerClause.includes('گدازه')) {
      triggerType = 'on-tile-hazard';
      triggerTarget = findMatchingEntityName(triggerClause, entities, fallbackPlayer);
    } else if (triggerClause.includes('پایان') || triggerClause.includes('پرچم') || triggerClause.includes('هدف')) {
      triggerType = 'on-tile-finish';
      triggerTarget = findMatchingEntityName(triggerClause, entities, fallbackPlayer);
    } else if (triggerClause.includes('اسکرول')) {
      triggerType = 'on-scroll';
      triggerTarget = findMatchingEntityName(triggerClause, entities, fallbackPlayer);
    } else if (triggerClause.includes('کلیک')) {
      triggerType = 'on-click';
      triggerTarget = findMatchingEntityName(triggerClause, entities, fallbackPlayer);
    } else if (triggerClause.includes('برخورد')) {
      triggerType = 'on-collision';
      const foundNames = entities.filter((e) => triggerClause.includes(e.name)).map((e) => e.name);
      triggerTarget = foundNames[0] || fallbackPlayer;
      triggerSecondary = foundNames[1];
      if (!triggerSecondary) {
        const parts = triggerClause.split(/\s+با\s+/);
        if (parts.length > 1) {
          triggerSecondary = parts[1].trim();
        }
      }
    } else if (
      triggerClause.includes('امتیاز') ||
      triggerClause.includes('جان') ||
      triggerClause.includes('متغیر')
    ) {
      triggerType = 'var-condition';
      if (triggerClause.includes('متغیر')) {
        const m = triggerClause.match(/متغیر\s+([^\s<>=]+)/);
        varName = m ? m[1] : 'score';
      } else {
        varName = triggerClause.includes('جان') ? 'health' : 'score';
      }
      if (triggerClause.includes('<=')) operator = '<=';
      else if (triggerClause.includes('==') || triggerClause.includes('=')) operator = '==';
      else operator = '>=';
      if (triggerClause.includes('>=')) operator = '>=';
      const numMatch = triggerClause.match(/(-?\d+(?:\.\d+)?)/);
      varValue = numMatch ? Number(numMatch[1]) : 30;
    } else if (triggerClause.includes('کلید')) {
      const keyRaw = triggerClause
        .replace(/وقتی|کلید|فشرده شد|نگه داشته شد|زده شد/g, '')
        .trim()
        .toLowerCase();
      key =
        KEY_ALIASES[keyRaw] ||
        (/^\d$/.test(keyRaw)
          ? `Digit${keyRaw}`
          : /^f([1-9]|1[0-2])$/.test(keyRaw)
            ? keyRaw.toUpperCase()
            : /^[a-z]$/.test(keyRaw)
              ? `Key${keyRaw.toUpperCase()}`
              : 'Space');
      triggerType =
        triggerClause.includes('زده شد') ||
        key === 'Space' ||
        key === 'KeyE' ||
        key === 'KeyF' ||
        key === 'Enter' ||
        key.startsWith('F') ||
        key.startsWith('Digit')
          ? 'key-press'
          : 'key-hold';
    } else {
      diagnostics.push({
        lineNumber: idx + 1,
        rawLine: trimmed,
        valid: false,
        message:
          'شرط مشخص نیست (از کلید، هر N ثانیه، کلیک، برخورد، همیشه، شروع، تله، پرچم یا امتیاز/متغیر استفاده کنید)',
        rules: [],
      });
      return;
    }

    const actionSegments = actionClause.split(
      /[|،]+(?=\s*(?:حذف|امتیاز|جان|صدا|پخش|پیام|نمایش|پرش|پرتاب|حرکت|تعقیب|رفت|تغییر|اسکرول|بازگشت|تولید|ساخت|اسپاون|افکت|ذرات|لرزش|رفتن|شروع|مرحله|صحنه|متغیر|ذخیره|بارگذاری))|\|/g
    );
    const created: GameRule[] = [];

    actionSegments.forEach((seg, sIdx) => {
      const parsedAction = parseSingleAction(seg, entities, triggerTarget, triggerSecondary);
      if (parsedAction && parsedAction.actionType) {
        created.push({
          id: makeId(idx, sIdx),
          enabled: true,
          persianLine: trimmed,
          triggerType,
          key,
          targetName: parsedAction.targetName || triggerTarget,
          secondaryName: parsedAction.secondaryName || triggerSecondary,
          intervalSeconds,
          varName: parsedAction.varName || varName,
          operator,
          varValue,
          actionType: parsedAction.actionType,
          paramNumber: parsedAction.paramNumber,
          paramAngle: parsedAction.paramAngle,
          paramText: parsedAction.paramText,
        });
      }
    });

    if (created.length === 0) {
      diagnostics.push({
        lineNumber: idx + 1,
        rawLine: trimmed,
        valid: false,
        message: 'دستور اجرایی تشخیص داده نشد (مثال: حرکت راست، پرش، پرتاب، تولید دشمن، افکت انفجار، امتیاز +10)',
        rules: [],
      });
      return;
    }

    allRules.push(...created);
    diagnostics.push({
      lineNumber: idx + 1,
      rawLine: trimmed,
      valid: true,
      message: `${created.length} دستور فعال آماده اجرا`,
      rules: created,
    });
  });

  return { rules: allRules, diagnostics };
}

export function ruleToPersianLine(rule: GameRule): string {
  let triggerPart = 'همیشه';
  switch (rule.triggerType) {
    case 'on-start':
      triggerPart = 'شروع بازی';
      break;
    case 'always':
      triggerPart = 'همیشه';
      break;
    case 'every-seconds':
      triggerPart = `هر ${rule.intervalSeconds ?? 2} ثانیه`;
      break;
    case 'on-tile-hazard':
      triggerPart = `برخورد ${rule.targetName} با خطر`;
      break;
    case 'on-tile-finish':
      triggerPart = `رسیدن ${rule.targetName} به پایان`;
      break;
    case 'key-hold':
    case 'key-press': {
      const reverseKey: Record<string, string> = {
        ArrowRight: 'راست',
        ArrowLeft: 'چپ',
        ArrowUp: 'بالا',
        ArrowDown: 'پایین',
        Space: 'فاصله',
        KeyW: 'W',
        KeyA: 'A',
        KeyS: 'S',
        KeyD: 'D',
        KeyE: 'E',
        KeyF: 'F',
      };
      triggerPart = `کلید ${reverseKey[rule.key || 'Space'] || rule.key || 'فاصله'}`;
      break;
    }
    case 'on-click':
      triggerPart = `کلیک روی ${rule.targetName}`;
      break;
    case 'on-scroll':
      triggerPart = `اسکرول روی ${rule.targetName}`;
      break;
    case 'on-collision':
      triggerPart = `برخورد ${rule.targetName} با ${rule.secondaryName || 'سکه'}`;
      break;
    case 'var-condition':
      triggerPart =
        rule.varName === 'health' || rule.varName === 'score'
          ? `اگر ${rule.varName === 'health' ? 'جان' : 'امتیاز'} ${rule.operator || '>='} ${rule.varValue ?? 30}`
          : `اگر متغیر ${rule.varName || 'coins'} ${rule.operator || '>='} ${rule.varValue ?? 1}`;
      break;
  }

  let actionPart = '';
  switch (rule.actionType) {
    case 'move-right':
      actionPart = `${rule.targetName} حرکت راست سرعت ${rule.paramNumber ?? 240}`;
      break;
    case 'move-left':
      actionPart = `${rule.targetName} حرکت چپ سرعت ${rule.paramNumber ?? 240}`;
      break;
    case 'move-up':
      actionPart = `${rule.targetName} حرکت بالا سرعت ${rule.paramNumber ?? 240}`;
      break;
    case 'move-down':
      actionPart = `${rule.targetName} حرکت پایین سرعت ${rule.paramNumber ?? 240}`;
      break;
    case 'move-forward':
      actionPart = `${rule.targetName} حرکت جلو سرعت ${rule.paramNumber ?? 6}`;
      break;
    case 'move-backward':
      actionPart = `${rule.targetName} حرکت عقب سرعت ${rule.paramNumber ?? 6}`;
      break;
    case 'jump':
      actionPart = `${rule.targetName} پرش قدرت ${rule.paramNumber ?? 520}`;
      break;
    case 'throw-projectile':
      actionPart = `${rule.targetName} پرتاب قدرت ${rule.paramNumber ?? 560} زاویه ${rule.paramAngle ?? 30}`;
      break;
    case 'throw-self':
      actionPart = `${rule.targetName} پرتاب خود قدرت ${rule.paramNumber ?? 480} زاویه ${rule.paramAngle ?? 45}`;
      break;
    case 'patrol-horizontal':
      actionPart = `${rule.targetName} حرکت رفت و برگشت سرعت ${rule.paramNumber ?? 110}`;
      break;
    case 'chase-target':
      actionPart = `${rule.targetName} تعقیب ${rule.secondaryName || 'بازیکن'} سرعت ${rule.paramNumber ?? 95}`;
      break;
    case 'orbit-target':
      actionPart = `${rule.targetName} چرخش دور ${rule.secondaryName || 'بازیکن'} سرعت ${rule.paramNumber ?? 2}`;
      break;
    case 'add-score':
      actionPart = `امتیاز ${(rule.paramNumber ?? 10) >= 0 ? '+' : ''}${rule.paramNumber ?? 10}`;
      break;
    case 'add-health':
      actionPart = `جان ${(rule.paramNumber ?? -10) >= 0 ? '+' : ''}${rule.paramNumber ?? -10}`;
      break;
    case 'set-var':
      actionPart = `متغیر ${rule.varName || 'wave'} = ${rule.paramNumber ?? 1}`;
      break;
    case 'add-var':
      actionPart = `متغیر ${rule.varName || 'wave'} ${(rule.paramNumber ?? 1) >= 0 ? '+' : ''}${rule.paramNumber ?? 1}`;
      break;
    case 'spawn-entity':
      actionPart = `تولید ${rule.targetName}`;
      break;
    case 'spawn-particles': {
      const reverseParticle: Record<string, string> = {
        explosion: 'انفجار',
        sparkle: 'جرقه',
        smoke: 'دود',
        snow: 'برف',
        rain: 'باران',
      };
      actionPart = `افکت ${reverseParticle[rule.paramText || 'sparkle'] || 'جرقه'}`;
      break;
    }
    case 'camera-shake':
      actionPart = `لرزش دوربین قدرت ${rule.paramNumber ?? 10}`;
      break;
    case 'go-to-scene':
      actionPart = `رفتن به صحنه "${rule.paramText || 'مرحله ۲'}"`;
      break;
    case 'next-scene':
      actionPart = 'مرحله بعد';
      break;
    case 'save-progress':
      actionPart = 'ذخیره پیشرفت';
      break;
    case 'load-progress':
      actionPart = 'بارگذاری پیشرفت';
      break;
    case 'destroy-other':
      actionPart = `حذف ${rule.secondaryName || 'دومی'}`;
      break;
    case 'destroy-self':
      actionPart = `حذف ${rule.targetName}`;
      break;
    case 'respawn':
      actionPart = `بازگشت ${rule.targetName}`;
      break;
    case 'play-sound':
      actionPart = `صدا ${rule.paramText || 'coin'}`;
      break;
    case 'show-message':
      actionPart = `نمایش پیام "${rule.paramText || 'آفرین!'}"`;
      break;
    case 'set-text':
      actionPart = `تغییر متن ${rule.targetName} "${rule.paramText || 'متن جدید'}"`;
      break;
    case 'scroll-box':
      actionPart =
        rule.paramText === 'x'
          ? `اسکرول افقی ${rule.targetName} مقدار ${rule.paramNumber ?? 60}`
          : `اسکرول ${rule.targetName} مقدار ${rule.paramNumber ?? 60}`;
      break;
  }

  return `${triggerPart}: ${actionPart}`;
}

export const READY_SCRIPT_LIBRARY = [
  {
    id: 'platformer-controls',
    title: 'کنترل کامل پلتفرمر (چپ، راست، پرش و پرتاب)',
    category: 'movement' as const,
    description: 'حرکت چپ و راست روان، پرش با جاذبه واقعی و پرتاب پرتابه با کلید E.',
    persianRules2D: [
      'کلید راست: بازیکن حرکت راست سرعت 260',
      'کلید چپ: بازیکن حرکت چپ سرعت 260',
      'کلید فاصله: بازیکن پرش قدرت 540',
      'کلید E: بازیکن پرتاب قدرت 560 زاویه 25',
    ].join('\n'),
    persianRules3D: [
      'کلید D: بازیکن حرکت راست سرعت 7',
      'کلید A: بازیکن حرکت چپ سرعت 7',
      'کلید W: بازیکن حرکت جلو سرعت 7',
      'کلید S: بازیکن حرکت عقب سرعت 7',
      'کلید فاصله: بازیکن پرش قدرت 10',
      'کلید E: بازیکن پرتاب قدرت 18 زاویه 20',
    ].join('\n'),
  },
  {
    id: 'spawner-waves',
    title: 'اسپاونر موج دشمن و افکت ذرات + تایمر',
    category: 'ai' as const,
    description: 'هر ۳ ثانیه دشمن جدید می‌سازد، ذرات انفجار و لرزش دوربین ایجاد می‌کند و متغیر موج را می‌شمارد.',
    persianRules2D: [
      'هر 3 ثانیه: تولید نگهبان | متغیر موج +1',
      'برخورد بازیکن با نگهبان: جان -20 | افکت انفجار | لرزش دوربین قدرت 12 | صدا hit',
    ].join('\n'),
    persianRules3D: [
      'هر 4 ثانیه: تولید نگهبان | متغیر موج +1',
      'برخورد بازیکن با نگهبان: جان -20 | افکت انفجار | لرزش دوربین قدرت 12 | صدا hit',
    ].join('\n'),
  },
  {
    id: 'multi-scene-progression',
    title: 'انتقال خودکار به مرحله بعد و ذخیره پیشرفت',
    category: 'physics' as const,
    description: 'با رسیدن به پرچم پایان یا جمع‌آوری سکه به مرحله بعدی می‌رود و امتیاز ذخیره می‌شود.',
    persianRules2D: [
      'رسیدن بازیکن به پایان: افکت جرقه | ذخیره پیشرفت | مرحله بعد',
      'برخورد بازیکن با خطر: جان -25 | افکت انفجار | لرزش دوربین قدرت 10 | بازگشت بازیکن',
    ].join('\n'),
    persianRules3D: [
      'اگر امتیاز >= 40: ذخیره پیشرفت | مرحله بعد',
    ].join('\n'),
  },
  {
    id: 'topdown-4dir',
    title: 'کنترل چهارجهته (بالا، پایین، چپ، راست)',
    category: 'movement' as const,
    description: 'مناسب بازی‌های دو‌بعدی دید از بالا، معمایی و حرکت آزاد در چهار جهت.',
    persianRules2D: [
      'کلید راست: بازیکن حرکت راست سرعت 240',
      'کلید چپ: بازیکن حرکت چپ سرعت 240',
      'کلید بالا: بازیکن حرکت بالا سرعت 240',
      'کلید پایین: بازیکن حرکت پایین سرعت 240',
    ].join('\n'),
    persianRules3D: [
      'کلید راست: بازیکن حرکت راست سرعت 7',
      'کلید چپ: بازیکن حرکت چپ سرعت 7',
      'کلید بالا: بازیکن حرکت جلو سرعت 7',
      'کلید پایین: بازیکن حرکت عقب سرعت 7',
    ].join('\n'),
  },
  {
    id: 'ai-patrol-chase',
    title: 'هوش مصنوعی تعقیب و گشت‌زنی دشمن',
    category: 'ai' as const,
    description: 'دشمن به صورت هوشمند بازیکن را تعقیب می‌کند و هنگام برخورد جان کم می‌شود.',
    persianRules2D: [
      'همیشه: نگهبان تعقیب بازیکن سرعت 95',
      'برخورد بازیکن با نگهبان: جان -20 | صدا hit',
    ].join('\n'),
    persianRules3D: [
      'همیشه: نگهبان تعقیب بازیکن سرعت 3',
      'برخورد بازیکن با نگهبان: جان -20 | صدا hit',
    ].join('\n'),
  },
  {
    id: 'interactive-ui-scroll',
    title: 'کادر متن قابل کلیک و اسکرول + دکمه پرش',
    category: 'ui' as const,
    description: 'تعامل مستقیم کاربر با کادر راهنما و دکمه‌های لمسی داخل صحنه بازی.',
    persianRules2D: [
      'کلیک روی دکمه پرش: بازیکن پرش قدرت 520 | صدا jump',
      'اسکرول روی کادر داستان: صدا click',
    ].join('\n'),
    persianRules3D: [
      'کلیک روی دکمه پرش: بازیکن پرش قدرت 10 | صدا jump',
    ].join('\n'),
  },
];

export function syncProjectRules(project: RayanProject, newRulesText: string): RayanProject {
  const { rules } = parsePersianRules(newRulesText, project.entities);
  const scenes = project.scenes.map((sc) =>
    sc.id === project.activeSceneId
      ? { ...sc, rulesText: newRulesText, rules }
      : sc
  );
  return {
    ...project,
    rulesText: newRulesText,
    rules,
    scenes,
    updatedAt: Date.now(),
  };
}

/**
 * Parses a single rule line into a structured GameRule for testing or quick lookup.
 */
export function parseRuleText(
  ruleLine: string,
  entities: GameEntity[] = []
): GameRule | null {
  const fallbackEntities: GameEntity[] = entities.length > 0 ? entities : [
    {
      id: 'mock_player',
      name: 'بازیکن',
      role: 'player',
      kind: 'shape2d',
      shape2d: 'rect',
      x: 0,
      y: 0,
      z: 0,
      width: 32,
      height: 32,
      depth: 32,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#ff0000',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: false,
        useGravity: true,
        mass: 1,
        bounce: 0,
        friction: 0.5,
        collider: 'box',
      },
      animation: {
        preset: 'none',
        speed: 1,
        amplitude: 10,
        spriteCols: 1,
        spriteRows: 1,
        fps: 8,
      },
    },
    {
      id: 'mock_coin',
      name: 'سکه',
      role: 'collectible',
      kind: 'shape2d',
      shape2d: 'circle',
      x: 50,
      y: 0,
      z: 0,
      width: 24,
      height: 24,
      depth: 24,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#fbbf24',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 0,
        bounce: 0,
        friction: 0.5,
        collider: 'sphere',
      },
      animation: {
        preset: 'none',
        speed: 1,
        amplitude: 10,
        spriteCols: 1,
        spriteRows: 1,
        fps: 8,
      },
    },
    {
      id: 'mock_hazard',
      name: 'مانع',
      role: 'enemy',
      kind: 'shape2d',
      shape2d: 'rect',
      x: 100,
      y: 0,
      z: 0,
      width: 32,
      height: 32,
      depth: 32,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#ef4444',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 1,
        bounce: 0,
        friction: 0.5,
        collider: 'box',
      },
      animation: {
        preset: 'none',
        speed: 1,
        amplitude: 10,
        spriteCols: 1,
        spriteRows: 1,
        fps: 8,
      },
    },
    {
      id: 'mock_box',
      name: 'کادر لیست',
      role: 'text-box',
      kind: 'text-box',
      x: 100,
      y: 100,
      z: 0,
      width: 200,
      height: 200,
      depth: 10,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#334155',
      opacity: 1,
      visible: true,
      textConfig: {
        text: 'متن کادر',
        fontSize: 14,
        textColor: '#ffffff',
        boxBgColor: '#1e293b',
        boxBorderColor: '#475569',
        boxBorderWidth: 1,
        boxBorderRadius: 8,
        boxPadding: 8,
        scrollable: true,
        fixedOnScreen: false,
        clickable: false,
        align: 'right',
      },
      physics: {
        enabled: false,
        isStatic: true,
        useGravity: false,
        mass: 0,
        bounce: 0,
        friction: 0,
        collider: 'none',
      },
      animation: {
        preset: 'none',
        speed: 1,
        amplitude: 10,
        spriteCols: 1,
        spriteRows: 1,
        fps: 8,
      },
    },
  ];

  const { rules } = parsePersianRules(ruleLine, fallbackEntities);
  return rules[0] || null;
}

