/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Real Wasmoon WebAssembly Lua Worker
 * Executes real Lua scripts using Wasmoon WebAssembly, isolates state per run, streams print output
 */

import { LuaFactory } from 'wasmoon';

export interface LuaExecuteMessage {
  type: 'EXECUTE';
  executionId: string;
  code: string;
  context?: {
    score: number;
    health: number;
    vars: Record<string, number>;
  };
}

export interface LuaOutputMessage {
  type: 'OUTPUT';
  executionId: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

export interface LuaResultMessage {
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

let luaFactory: LuaFactory | null = null;

function getLuaFactory(): LuaFactory {
  if (!luaFactory) {
    luaFactory = new LuaFactory();
  }
  return luaFactory;
}

self.onmessage = async (event: MessageEvent<LuaExecuteMessage | { type: 'GET_VERSION' }>) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'GET_VERSION') {
    try {
      const factory = getLuaFactory();
      const engine = await factory.createEngine();
      const ver = (await engine.doString('return _VERSION')) as string;
      engine.global.close();
      self.postMessage({ type: 'VERSION', version: ver });
    } catch {
      self.postMessage({ type: 'VERSION', version: 'Lua 5.4 (Wasmoon Wasm)' });
    }
    return;
  }

  if (data.type !== 'EXECUTE') return;

  const { executionId, code, context } = data;
  const startTime = performance.now();

  const workingContext = {
    score: context?.score ?? 0,
    health: context?.health ?? 100,
    vars: { ...(context?.vars || {}) },
  };

  const sendOutput = (level: 'log' | 'warn' | 'error', message: string) => {
    self.postMessage({
      type: 'OUTPUT',
      executionId,
      level,
      message,
    } as LuaOutputMessage);
  };

  let engine: any = null;
  try {
    const factory = getLuaFactory();
    engine = await factory.createEngine();

    const version = ((await engine.doString('return _VERSION')) as string) || 'Lua 5.4';

    // Redirect print to worker messages
    engine.global.set('print', (...args: unknown[]) => {
      const formatted = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join('\t');
      sendOutput('log', formatted);
    });

    // Provide game API in Lua
    const apiTable = {
      score: workingContext.score,
      health: workingContext.health,
      add_score: (delta: number) => {
        workingContext.score += Number(delta);
        sendOutput('log', `[Lua score += ${delta} -> ${workingContext.score}]`);
      },
      set_score: (val: number) => {
        workingContext.score = Number(val);
        sendOutput('log', `[Lua score = ${workingContext.score}]`);
      },
      set_health: (val: number) => {
        workingContext.health = Math.max(0, Number(val));
        sendOutput('log', `[Lua health = ${workingContext.health}]`);
      },
      set_var: (name: string, val: number) => {
        workingContext.vars[name] = Number(val);
        sendOutput('log', `[Lua var ${name} = ${val}]`);
      },
    };

    engine.global.set('api', apiTable);

    // Execute user Lua script
    await engine.doString(code);

    const durationMs = performance.now() - startTime;
    self.postMessage({
      type: 'RESULT',
      executionId,
      ok: true,
      version: `${version} (Wasmoon Wasm)`,
      state: {
        score: workingContext.score,
        health: workingContext.health,
        vars: workingContext.vars,
      },
      durationMs,
    } as LuaResultMessage);
  } catch (err: unknown) {
    const durationMs = performance.now() - startTime;
    const errorMsg =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    self.postMessage({
      type: 'RESULT',
      executionId,
      ok: false,
      error: errorMsg,
      durationMs,
    } as LuaResultMessage);
  } finally {
    if (engine) {
      try {
        engine.global.close();
      } catch {
        // cleanup error
      }
    }
  }
};
