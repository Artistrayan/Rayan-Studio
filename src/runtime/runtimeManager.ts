/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Multi-Language Runtime Manager
 * Manages isolated Web Workers for JavaScript, Python (Pyodide), and Lua (Wasmoon).
 * Enforces permission checks, timeouts, stream output, and genuine error reporting.
 * Uses Node.js `node:vm` isolated contexts in server/Vitest environments without Web Workers (zero `new Function` fallback).
 */

import { permissionManager } from '../security/permissionManager';
import type { CodeFileLanguage } from '../types/studio';

export interface ExecutionOptions {
  timeoutMs?: number;
  context?: {
    score: number;
    health: number;
    vars: Record<string, number>;
    elapsed?: number;
  };
  onOutput?: (level: 'log' | 'warn' | 'error', message: string) => void;
}

export interface ExecutionResult {
  executionId: string;
  language: CodeFileLanguage;
  ok: boolean;
  version?: string;
  logs: string[];
  error?: string;
  durationMs: number;
  finalState?: {
    score: number;
    health: number;
    vars: Record<string, number>;
  };
}

class RuntimeManager {
  private activeWorkers: Map<string, Worker> = new Map();
  private defaultTimeoutMs = 5000;

  /**
   * Spawns a dedicated Web Worker based on language.
   */
  private createWorker(language: CodeFileLanguage): Worker {
    if (typeof Worker === 'undefined') {
      throw new Error('محیط اجرای فعلی از Web Worker پشتیبانی نمی‌کند.');
    }

    if (language === 'javascript' || language === 'typescript') {
      return new Worker(new URL('./workers/javascriptWorker.ts', import.meta.url), {
        type: 'module',
      });
    }

    if (language === 'python') {
      return new Worker(new URL('./workers/pythonWorker.ts', import.meta.url), {
        type: 'module',
      });
    }

    if (language === 'lua') {
      return new Worker(new URL('./workers/luaWorker.ts', import.meta.url), {
        type: 'module',
      });
    }

    throw new Error(`زبان «${language}» برای اجرا در ورکر پشتیبانی نمی‌شود.`);
  }

  /**
   * Queries the real runtime version for a language.
   */
  public async getRuntimeVersion(language: CodeFileLanguage): Promise<string> {
    if (language === 'javascript' || language === 'typescript') {
      return 'JavaScript ES2022 (V8 / Isolated Worker)';
    }

    if (typeof Worker === 'undefined') {
      if (language === 'lua') {
        try {
          const { LuaFactory } = await import('wasmoon');
          const factory = new LuaFactory();
          const lua = await factory.createEngine();
          const ver = String(await lua.doString('return _VERSION'));
          lua.global.close();
          return `${ver} (Wasmoon Wasm)`;
        } catch {
          return 'Lua 5.4 (Wasmoon)';
        }
      }
      return `${language} Runtime (Node Sandbox)`;
    }

    try {
      const worker = this.createWorker(language);
      return await new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          worker.terminate();
          resolve(`${language} Wasm Worker`);
        }, 3000);

        worker.onmessage = (e) => {
          if (e.data?.type === 'VERSION') {
            clearTimeout(timer);
            worker.terminate();
            resolve(String(e.data.version));
          }
        };

        worker.postMessage({ type: 'GET_VERSION' });
      });
    } catch {
      return `${language} Wasm Runtime`;
    }
  }

  /**
   * Executes code in an isolated environment after verifying permissions.
   */
  public async executeCode(
    language: CodeFileLanguage,
    code: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startTime = performance.now();
    const logs: string[] = [];
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    // 1. Verify user permission (never auto-granted without consent)
    const hasPerm = await permissionManager.requestPermission(
      'script:execute',
      `اجرای اسکریپت به زبان ${language}`
    );
    if (!hasPerm) {
      return {
        executionId,
        language,
        ok: false,
        logs: ['مجوز اجرای اسکریپت رد شد. برای اجرا، به استودیو اجازه اجرای کد دهید.'],
        error: 'مجوز امنیتی script:execute رد شد.',
        durationMs: performance.now() - startTime,
      };
    }

    // 2. Fast check for empty code
    if (!code || !code.trim()) {
      return {
        executionId,
        language,
        ok: true,
        logs: ['کد خالی است.'],
        durationMs: performance.now() - startTime,
      };
    }

    // 3. Isolated Node VM / Wasm runner when running in Node/Vitest headless tests without Web Worker
    if (typeof Worker === 'undefined') {
      return this.executeInNodeSandbox(executionId, language, code, options);
    }

    // 4. Dedicated Web Worker execution with hard timeout
    let worker: Worker;
    try {
      worker = this.createWorker(language);
      this.activeWorkers.set(executionId, worker);
    } catch (err) {
      return {
        executionId,
        language,
        ok: false,
        logs,
        error: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - startTime,
      };
    }

    return new Promise<ExecutionResult>((resolve) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        this.activeWorkers.delete(executionId);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        const msg = `خطای توقف به دلیل طولانی شدن اجرا (بیش از ${timeoutMs} میلی‌ثانیه - احتمال حلقه بی‌نهایت).`;
        logs.push(msg);
        options.onOutput?.('error', msg);
        resolve({
          executionId,
          language,
          ok: false,
          logs,
          error: msg,
          durationMs: performance.now() - startTime,
        });
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.executionId !== executionId) return;

        if (data.type === 'OUTPUT') {
          logs.push(data.message);
          options.onOutput?.(data.level, data.message);
        } else if (data.type === 'RESULT') {
          cleanup();
          resolve({
            executionId,
            language,
            ok: Boolean(data.ok),
            version: data.version,
            logs,
            error: data.error,
            durationMs: data.durationMs ?? performance.now() - startTime,
            finalState: data.state,
          });
        }
      };

      worker.onerror = (err) => {
        cleanup();
        const errMsg = err.message || 'خطای بحرانی در ورکر اجرا';
        logs.push(`[Worker Error] ${errMsg}`);
        options.onOutput?.('error', errMsg);
        resolve({
          executionId,
          language,
          ok: false,
          logs,
          error: errMsg,
          durationMs: performance.now() - startTime,
        });
      };

      worker.postMessage({
        type: 'EXECUTE',
        executionId,
        code,
        context: options.context,
      });
    });
  }

  /**
   * Cancels a currently running execution by executionId.
   */
  public cancelExecution(executionId: string): boolean {
    const worker = this.activeWorkers.get(executionId);
    if (worker) {
      worker.terminate();
      this.activeWorkers.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Isolated execution for Node.js/Vitest environments using `node:vm` (with real timeout & context isolation)
   * and real Wasmoon engine for Lua—never using main-thread `new Function()`.
   */
  private async executeInNodeSandbox(
    executionId: string,
    language: CodeFileLanguage,
    code: string,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = performance.now();
    const logs: string[] = [];
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const workingContext = {
      score: options.context?.score ?? 0,
      health: options.context?.health ?? 100,
      vars: { ...(options.context?.vars || {}) },
    };

    const sandboxApi = {
      get score() {
        return workingContext.score;
      },
      addScore: (d: number) => {
        workingContext.score += Number(d);
        logs.push(`[score += ${d}]`);
      },
      setScore: (v: number) => {
        workingContext.score = Number(v);
      },
      get health() {
        return workingContext.health;
      },
      setHealth: (h: number) => {
        workingContext.health = Math.max(0, Number(h));
      },
      get vars() {
        return workingContext.vars;
      },
      setVar: (k: string, v: number) => {
        workingContext.vars[k] = Number(v);
      },
      log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
      showMessage: (msg: string) => logs.push(`[پیام بازی]: ${msg}`),
      playSound: (name: string) => logs.push(`[پخش صدا]: ${name}`),
    };

    if (language === 'javascript' || language === 'typescript') {
      try {
        const vm = await import('node:vm');
        const vmContext = vm.createContext(
          {
            api: sandboxApi,
            console: {
              log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
              warn: (...a: unknown[]) => logs.push(`هشدار: ${a.map(String).join(' ')}`),
              error: (...a: unknown[]) => logs.push(`خطا: ${a.map(String).join(' ')}`),
            },
            Math,
            JSON,
            Number,
            String,
            Boolean,
            Array,
            Object,
          },
          {
            codeGeneration: { strings: false, wasm: false },
          }
        );

        const wrapped = `"use strict";\n${code}\nif (typeof onStart === "function") onStart(api);\nif (typeof onUpdate === "function") onUpdate(api, 0.016);`;
        vm.runInContext(wrapped, vmContext, { timeout: timeoutMs, filename: 'user-script.js' });

        return {
          executionId,
          language,
          ok: true,
          version: 'Node VM Isolated Context',
          logs,
          finalState: workingContext,
          durationMs: performance.now() - startTime,
        };
      } catch (err) {
        return {
          executionId,
          language,
          ok: false,
          logs,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          durationMs: performance.now() - startTime,
        };
      }
    }

    if (language === 'lua') {
      try {
        const { LuaFactory } = await import('wasmoon');
        const factory = new LuaFactory();
        const lua = await factory.createEngine();
        try {
          lua.global.set('print', (...args: unknown[]) => {
            logs.push(args.map((a) => String(a)).join('\t'));
          });
          lua.global.set('api', {
            get score() {
              return workingContext.score;
            },
            add_score: (d: number) => sandboxApi.addScore(d),
            set_score: (v: number) => sandboxApi.setScore(v),
            set_health: (h: number) => sandboxApi.setHealth(h),
            set_var: (k: string, v: number) => sandboxApi.setVar(k, v),
            log: (...a: unknown[]) => sandboxApi.log(...a),
          });
          const ver = String(await lua.doString('return _VERSION'));
          await lua.doString(code);
          return {
            executionId,
            language,
            ok: true,
            version: `${ver} (Wasmoon Wasm)`,
            logs,
            finalState: workingContext,
            durationMs: performance.now() - startTime,
          };
        } finally {
          lua.global.close();
        }
      } catch (err) {
        return {
          executionId,
          language,
          ok: false,
          logs,
          error: err instanceof Error ? err.message : String(err),
          durationMs: performance.now() - startTime,
        };
      }
    }

    return {
      executionId,
      language,
      ok: false,
      logs,
      error: `اجرای زبان ${language} نیازمند محیط مرورگر با Web Worker و WebAssembly است.`,
      durationMs: performance.now() - startTime,
    };
  }
}

export const runtimeManager = new RuntimeManager();
