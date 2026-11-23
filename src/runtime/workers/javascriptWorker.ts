/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Isolated JavaScript Execution Web Worker
 * Runs user scripts in an isolated worker thread without DOM or main-thread globals
 */

export interface WorkerExecuteMessage {
  type: 'EXECUTE';
  executionId: string;
  code: string;
  context: {
    score: number;
    health: number;
    vars: Record<string, number>;
    elapsed: number;
  };
}

export interface WorkerOutputMessage {
  type: 'OUTPUT';
  executionId: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

export interface WorkerResultMessage {
  type: 'RESULT';
  executionId: string;
  ok: boolean;
  state?: {
    score: number;
    health: number;
    vars: Record<string, number>;
  };
  error?: string;
  durationMs: number;
}

// In standard Web Worker context
self.onmessage = (event: MessageEvent<WorkerExecuteMessage>) => {
  const data = event.data;
  if (!data || data.type !== 'EXECUTE') return;

  const { executionId, code, context } = data;
  const startTime = performance.now();

  const workingContext = {
    score: context?.score ?? 0,
    health: context?.health ?? 100,
    vars: { ...(context?.vars || {}) },
    elapsed: context?.elapsed ?? 0,
  };

  const sendOutput = (level: 'log' | 'warn' | 'error', ...args: unknown[]) => {
    const formatted = args
      .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
      .join(' ');
    self.postMessage({
      type: 'OUTPUT',
      executionId,
      level,
      message: formatted,
    } as WorkerOutputMessage);
  };

  const sandboxApi = {
    get score() {
      return workingContext.score;
    },
    setScore(val: number) {
      workingContext.score = Number(val);
      sendOutput('log', `[score = ${workingContext.score}]`);
    },
    addScore(delta: number) {
      workingContext.score += Number(delta);
      sendOutput('log', `[score += ${delta} -> ${workingContext.score}]`);
    },
    get health() {
      return workingContext.health;
    },
    setHealth(val: number) {
      workingContext.health = Math.max(0, Number(val));
      sendOutput('log', `[health = ${workingContext.health}]`);
    },
    get vars() {
      return workingContext.vars;
    },
    setVar(name: string, val: number) {
      workingContext.vars[name] = Number(val);
      sendOutput('log', `[var ${name} = ${val}]`);
    },
    get elapsed() {
      return workingContext.elapsed;
    },
    log(...args: unknown[]) {
      sendOutput('log', ...args);
    },
    warn(...args: unknown[]) {
      sendOutput('warn', ...args);
    },
    error(...args: unknown[]) {
      sendOutput('error', ...args);
    },
    showMessage(msg: string) {
      sendOutput('log', `[پیام بازی]: ${msg}`);
    },
    playSound(name: string) {
      sendOutput('log', `[پخش صدا]: ${name}`);
    },
  };

  const sandboxConsole = {
    log: (...args: unknown[]) => sendOutput('log', ...args),
    warn: (...args: unknown[]) => sendOutput('warn', ...args),
    error: (...args: unknown[]) => sendOutput('error', ...args),
    info: (...args: unknown[]) => sendOutput('log', ...args),
  };

  try {
    // Restricted scope closure: shadow dangerous Worker globals
    const runner = new Function(
      'api',
      'console',
      'self',
      'postMessage',
      'importScripts',
      'Worker',
      'fetch',
      'XMLHttpRequest',
      'WebSocket',
      `
      "use strict";
      ${code}
      if (typeof onStart === "function") {
        onStart(api);
      }
      if (typeof onUpdate === "function") {
        onUpdate(api, 0.016);
      }
      return true;
      `
    );

    runner(
      sandboxApi,
      sandboxConsole,
      undefined, // self shadowed
      undefined, // postMessage shadowed
      undefined, // importScripts shadowed
      undefined, // Worker shadowed
      undefined, // fetch shadowed
      undefined, // XMLHttpRequest shadowed
      undefined  // WebSocket shadowed
    );

    const durationMs = performance.now() - startTime;
    self.postMessage({
      type: 'RESULT',
      executionId,
      ok: true,
      state: {
        score: workingContext.score,
        health: workingContext.health,
        vars: workingContext.vars,
      },
      durationMs,
    } as WorkerResultMessage);
  } catch (err: unknown) {
    const durationMs = performance.now() - startTime;
    const errorMsg =
      err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack || ''}`
        : String(err);
    self.postMessage({
      type: 'RESULT',
      executionId,
      ok: false,
      error: errorMsg,
      durationMs,
    } as WorkerResultMessage);
  }
};
