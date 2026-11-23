/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Custom Script Runner
 * Sandboxes in-game runtime scripts, isolates execution scope, and integrates with runtimeManager
 */

import type { CodeFileItem } from '../types/studio';
import { runScriptIsolated, type ScriptRunResponse } from '../runtime/scriptRunner';
import { permissionManager } from '../security/permissionManager';
import { validateAndSanitizePath, isSafeUrl } from '../security/fileSanitizer';

export interface ScriptRuntimeApi {
  readonly score: number;
  setScore: (val: number) => void;
  addScore: (delta: number) => void;
  readonly health: number;
  setHealth: (val: number) => void;
  readonly vars: Record<string, number>;
  setVar: (name: string, val: number) => void;
  readonly elapsed: number;
  findEntity: (name: string) => {
    name: string;
    x: number;
    y: number;
    z?: number;
    vx: number;
    vy: number;
    visible: boolean;
  } | null;
  moveEntity: (name: string, vx: number, vy: number, vz?: number) => void;
  setEntityPosition: (name: string, x: number, y: number, z?: number) => void;
  showMessage: (msg: string) => void;
  playSound: (name: string) => void;
  spawnParticles: (x: number, y: number, preset?: string) => void;
  log: (msg: string) => void;
}

export interface CompiledScriptHandle {
  fileId: string;
  fileName: string;
  onStart?: (api: ScriptRuntimeApi) => void;
  onUpdate?: (api: ScriptRuntimeApi, dt: number) => void;
}

/**
 * Compiles enabled JavaScript/TypeScript CodeFileItems into game runtime handles.
 * Enforces permission checks and shadows dangerous browser primitives.
 */
export function compileRuntimeScripts(
  codeFiles: CodeFileItem[] | undefined,
  onError?: (fileName: string, errorMessage: string) => void
): CompiledScriptHandle[] {
  if (!codeFiles || codeFiles.length === 0) return [];

  // Check explicit permission for script execution
  if (!permissionManager.hasPermission('script:execute')) {
    // If not granted, do not run untrusted scripts
    onError?.('امنیت استودیو', 'مجوز اجرای اسکریپت سفارشی (script:execute) هنوز توسط کاربر تأیید نشده است.');
    return [];
  }

  const handles: CompiledScriptHandle[] = [];

  for (const file of codeFiles) {
    if (!file.enabledInRuntime || (file.language !== 'javascript' && file.language !== 'typescript')) {
      continue;
    }

    const pathCheck = validateAndSanitizePath(file.path || file.name);
    if (!pathCheck.valid) {
      onError?.(file.name, `مسیر نامعتبر یا ناامن: ${pathCheck.error}`);
      continue;
    }

    try {
      // Sandboxed function execution shadowing dangerous main-thread globals
      const fn = new Function(
        'api',
        'console',
        'window',
        'document',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'Worker',
        `
        "use strict";
        ${file.content}
        return {
          onStart: typeof onStart === "function" ? onStart : undefined,
          onUpdate: typeof onUpdate === "function" ? onUpdate : undefined
        };
      `
      ) as (
        api: ScriptRuntimeApi,
        console: { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void },
        ...shadowed: unknown[]
      ) => {
        onStart?: (api: ScriptRuntimeApi) => void;
        onUpdate?: (api: ScriptRuntimeApi, dt: number) => void;
      };

      const stubConsole = {
        log: () => {},
        warn: () => {},
        error: () => {},
      };

      const stubApi: ScriptRuntimeApi = {
        score: 0,
        setScore: () => {},
        addScore: () => {},
        health: 100,
        setHealth: () => {},
        vars: {},
        setVar: () => {},
        elapsed: 0,
        findEntity: () => null,
        moveEntity: () => {},
        setEntityPosition: () => {},
        showMessage: () => {},
        playSound: () => {},
        spawnParticles: () => {},
        log: () => {},
      };

      // Probe syntax safely
      const hooks = fn(
        stubApi,
        stubConsole,
        undefined, // window
        undefined, // document
        undefined, // localStorage
        undefined, // sessionStorage
        undefined, // indexedDB
        undefined, // fetch
        undefined, // XMLHttpRequest
        undefined, // WebSocket
        undefined  // Worker
      );

      handles.push({
        fileId: file.id,
        fileName: file.name,
        onStart: hooks?.onStart,
        onUpdate: hooks?.onUpdate,
      });
    } catch (err) {
      onError?.(file.name, err instanceof Error ? err.message : String(err));
    }
  }
  return handles;
}

/**
 * Asynchronously executes a file in the isolated multi-language Web Worker sandbox.
 */
export async function testExecuteScriptFileAsync(file: CodeFileItem): Promise<ScriptRunResponse> {
  return runScriptIsolated(file);
}

/**
 * Synchronous test runner with strict sandbox fallbacks.
 */
export function testExecuteScriptFile(
  file: CodeFileItem
): { ok: boolean; logs: string[]; error?: string } {
  const logs: string[] = [];

  const pathCheck = validateAndSanitizePath(file.path || file.name);
  if (!pathCheck.valid) {
    return { ok: false, logs, error: pathCheck.error };
  }

  if (file.language === 'json') {
    try {
      const parsed = JSON.parse(file.content);
      const keys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).length : 0;
      logs.push(`فایل JSON معتبر است (${keys} کلید سطح اول).`);
      return { ok: true, logs };
    } catch (err) {
      return {
        ok: false,
        logs,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (file.language !== 'javascript' && file.language !== 'typescript') {
    logs.push(`فایل ${file.name} به زبان ${file.language} ذخیره شد. برای اجرای کامل از دکمه «تست در ورکر ایزوله» استفاده نمایید.`);
    return { ok: true, logs };
  }

  // Shadowed safe execution for JS
  let simScore = 100;
  let simHealth = 100;
  const simVars: Record<string, number> = { موج: 1 };

  const sandboxApi: ScriptRuntimeApi = {
    get score() {
      return simScore;
    },
    setScore: (v) => {
      simScore = v;
      logs.push(`[score = ${v}]`);
    },
    addScore: (d) => {
      simScore += d;
      logs.push(`[score += ${d} -> ${simScore}]`);
    },
    get health() {
      return simHealth;
    },
    setHealth: (v) => {
      simHealth = v;
      logs.push(`[health = ${v}]`);
    },
    get vars() {
      return simVars;
    },
    setVar: (name, val) => {
      simVars[name] = val;
      logs.push(`[var ${name} = ${val}]`);
    },
    elapsed: 0.016,
    findEntity: (name) => ({
      name,
      x: 120,
      y: 300,
      z: 0,
      vx: 0,
      vy: 0,
      visible: true,
    }),
    moveEntity: (name, vx, vy) => {
      logs.push(`[moveEntity(${name}, ${vx}, ${vy})]`);
    },
    setEntityPosition: (name, x, y) => {
      logs.push(`[setEntityPosition(${name}, ${x}, ${y})]`);
    },
    showMessage: (msg) => {
      logs.push(`[showMessage] ${msg}`);
    },
    playSound: (name) => {
      logs.push(`[playSound] ${name}`);
    },
    spawnParticles: (x, y, preset = 'sparkle') => {
      logs.push(`[spawnParticles(${x}, ${y}, ${preset})]`);
    },
    log: (msg) => {
      logs.push(String(msg));
    },
  };

  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => logs.push(`هشدار: ${args.map(String).join(' ')}`),
    error: (...args: unknown[]) => logs.push(`خطا: ${args.map(String).join(' ')}`),
  };

  try {
    const fn = new Function(
      'api',
      'console',
      'window',
      'document',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      'Worker',
      `
      "use strict";
      ${file.content}
      return {
        onStart: typeof onStart === "function" ? onStart : undefined,
        onUpdate: typeof onUpdate === "function" ? onUpdate : undefined
      };
    `
    ) as (
      api: ScriptRuntimeApi,
      console: typeof sandboxConsole,
      ...shadowed: unknown[]
    ) => {
      onStart?: (api: ScriptRuntimeApi) => void;
      onUpdate?: (api: ScriptRuntimeApi, dt: number) => void;
    };

    const hooks = fn(
      sandboxApi,
      sandboxConsole,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );

    if (hooks?.onStart) hooks.onStart(sandboxApi);
    if (hooks?.onUpdate) hooks.onUpdate(sandboxApi, 0.016);
    if (logs.length === 0) {
      logs.push('کد بدون خطای نحوی ارزیابی و کامپایل شد.');
    }
    return { ok: true, logs };
  } catch (err) {
    return {
      ok: false,
      logs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
