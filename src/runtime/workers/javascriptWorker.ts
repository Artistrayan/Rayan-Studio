/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Isolated JavaScript Execution Web Worker
 * Runs user scripts in an isolated worker thread without DOM or main-thread globals.
 * Supports one-shot execution (EXECUTE) and persistent game-loop sessions (HOOK_INIT / HOOK_STEP).
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

export interface WorkerHookInitMessage {
  type: 'HOOK_INIT';
  sessionId: string;
  files: Array<{ id: string; name: string; content: string }>;
}

export interface WorkerHookStepMessage {
  type: 'HOOK_STEP';
  sessionId: string;
  phase: 'start' | 'update';
  dt: number;
  snapshot: {
    score: number;
    health: number;
    vars: Record<string, number>;
    elapsed: number;
    entities: Array<{
      name: string;
      x: number;
      y: number;
      z?: number;
      vx: number;
      vy: number;
      visible: boolean;
    }>;
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
  version?: string;
  state?: {
    score: number;
    health: number;
    vars: Record<string, number>;
  };
  error?: string;
  durationMs: number;
}

export interface HookCommandBatch {
  setScore?: number;
  scoreDelta: number;
  setHealth?: number;
  varPatches: Record<string, number>;
  moves: Array<{ name: string; vx: number; vy: number; vz?: number }>;
  positions: Array<{ name: string; x: number; y: number; z?: number }>;
  messages: string[];
  sounds: string[];
  particles: Array<{ x: number; y: number; preset?: string }>;
  logs: string[];
  errors: Array<{ fileName: string; message: string }>;
}

const RUNTIME_VERSION = 'JavaScript ES2022 (Isolated Web Worker Sandbox)';

interface CompiledHookEntry {
  id: string;
  name: string;
  onStart?: (api: unknown) => void;
  onUpdate?: (api: unknown, dt: number) => void;
}

const sessionHooks = new Map<string, CompiledHookEntry[]>();

function compileSandboxedUserCode(code: string, shadowNames: string[], bodySuffix: string) {
  const fnFactory = new Function(
    'api',
    'console',
    ...shadowNames,
    `"use strict";\n${code}\n${bodySuffix}`
  );
  return fnFactory;
}

const BLOCKED_GLOBALS = [
  'self',
  'globalThis',
  'postMessage',
  'importScripts',
  'Worker',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'BroadcastChannel',
  'indexedDB',
  'caches',
  'navigator',
  'location',
];

self.onmessage = (
  event: MessageEvent<
    | WorkerExecuteMessage
    | WorkerHookInitMessage
    | WorkerHookStepMessage
    | { type: 'GET_VERSION' }
  >
) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'GET_VERSION') {
    self.postMessage({ type: 'VERSION', version: RUNTIME_VERSION });
    return;
  }

  if (data.type === 'HOOK_INIT') {
    const entries: CompiledHookEntry[] = [];
    const errors: Array<{ fileName: string; message: string }> = [];
    const noopConsole = { log: () => {}, warn: () => {}, error: () => {}, info: () => {} };
    const probeApi = {
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

    for (const file of data.files) {
      try {
        const fn = compileSandboxedUserCode(
          file.content,
          BLOCKED_GLOBALS,
          `return {
            onStart: typeof onStart === "function" ? onStart : undefined,
            onUpdate: typeof onUpdate === "function" ? onUpdate : undefined
          };`
        );
        const hooks = fn(probeApi, noopConsole, ...BLOCKED_GLOBALS.map(() => undefined)) as {
          onStart?: (api: unknown) => void;
          onUpdate?: (api: unknown, dt: number) => void;
        };
        entries.push({
          id: file.id,
          name: file.name,
          onStart: hooks?.onStart,
          onUpdate: hooks?.onUpdate,
        });
      } catch (err) {
        errors.push({
          fileName: file.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    sessionHooks.set(data.sessionId, entries);
    self.postMessage({
      type: 'HOOK_READY',
      sessionId: data.sessionId,
      loadedCount: entries.length,
      errors,
    });
    return;
  }

  if (data.type === 'HOOK_STEP') {
    const entries = sessionHooks.get(data.sessionId) || [];
    const batch: HookCommandBatch = {
      scoreDelta: 0,
      varPatches: {},
      moves: [],
      positions: [],
      messages: [],
      sounds: [],
      particles: [],
      logs: [],
      errors: [],
    };

    let currentScore = data.snapshot.score;
    let currentHealth = data.snapshot.health;
    const localVars = { ...data.snapshot.vars };

    const stepApi = {
      get score() {
        return currentScore;
      },
      setScore(val: number) {
        const n = Number(val);
        if (Number.isFinite(n)) {
          currentScore = n;
          batch.setScore = n;
          batch.scoreDelta = 0;
        }
      },
      addScore(delta: number) {
        const d = Number(delta);
        if (Number.isFinite(d)) {
          currentScore += d;
          if (batch.setScore !== undefined) batch.setScore += d;
          else batch.scoreDelta += d;
        }
      },
      get health() {
        return currentHealth;
      },
      setHealth(val: number) {
        const n = Math.max(0, Number(val));
        if (Number.isFinite(n)) {
          currentHealth = n;
          batch.setHealth = n;
        }
      },
      get vars() {
        return localVars;
      },
      setVar(name: string, val: number) {
        const n = Number(val);
        if (Number.isFinite(n)) {
          localVars[name] = n;
          batch.varPatches[name] = n;
        }
      },
      get elapsed() {
        return data.snapshot.elapsed;
      },
      findEntity(name: string) {
        return data.snapshot.entities.find((e) => e.name === name) || null;
      },
      moveEntity(name: string, vx: number, vy: number, vz?: number) {
        batch.moves.push({ name, vx, vy, vz });
      },
      setEntityPosition(name: string, x: number, y: number, z?: number) {
        batch.positions.push({ name, x, y, z });
      },
      showMessage(msg: string) {
        batch.messages.push(String(msg));
      },
      playSound(name: string) {
        batch.sounds.push(String(name));
      },
      spawnParticles(x: number, y: number, preset?: string) {
        batch.particles.push({ x, y, preset });
      },
      log(msg: string) {
        batch.logs.push(String(msg));
      },
    };

    for (const entry of entries) {
      try {
        if (data.phase === 'start') {
          entry.onStart?.(stepApi);
        } else {
          entry.onUpdate?.(stepApi, data.dt);
        }
      } catch (err) {
        batch.errors.push({
          fileName: entry.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    self.postMessage({
      type: 'HOOK_RESULT',
      sessionId: data.sessionId,
      batch,
    });
    return;
  }

  if (data.type !== 'EXECUTE') return;

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
    const runner = compileSandboxedUserCode(
      code,
      BLOCKED_GLOBALS,
      `
      if (typeof onStart === "function") {
        onStart(api);
      }
      if (typeof onUpdate === "function") {
        onUpdate(api, 0.016);
      }
      return true;
      `
    );

    runner(sandboxApi, sandboxConsole, ...BLOCKED_GLOBALS.map(() => undefined));

    const durationMs = performance.now() - startTime;
    self.postMessage({
      type: 'RESULT',
      executionId,
      ok: true,
      version: RUNTIME_VERSION,
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
      version: RUNTIME_VERSION,
      error: errorMsg,
      durationMs,
    } as WorkerResultMessage);
  }
};
