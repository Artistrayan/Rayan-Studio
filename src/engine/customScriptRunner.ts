/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Custom Script Runner
 * Strictly executes untrusted user JavaScript inside isolated Web Workers (or node:vm in headless tests).
 * Zero main-thread `new Function()` or `eval()` calls.
 */

import type { CodeFileItem } from '../types/studio';
import { runScriptIsolated, type ScriptRunResponse } from '../runtime/scriptRunner';
import { permissionManager } from '../security/permissionManager';
import { validateAndSanitizePath } from '../security/fileSanitizer';
import type { HookCommandBatch } from '../runtime/workers/javascriptWorker';

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

export interface HookSnapshotEntity {
  name: string;
  x: number;
  y: number;
  z?: number;
  vx: number;
  vy: number;
  visible: boolean;
}

export interface GameScriptWorkerSession {
  active: boolean;
  runStart: (
    snapshot: {
      score: number;
      health: number;
      vars: Record<string, number>;
      elapsed: number;
      entities: HookSnapshotEntity[];
    },
    applyBatch: (batch: HookCommandBatch) => void
  ) => void;
  stepUpdate: (
    dt: number,
    snapshot: {
      score: number;
      health: number;
      vars: Record<string, number>;
      elapsed: number;
      entities: HookSnapshotEntity[];
    },
    applyBatch: (batch: HookCommandBatch) => void
  ) => void;
  dispose: () => void;
}

/**
 * Starts an isolated Web Worker script session for Engine2D / Engine3D play mode.
 * Never compiles or evaluates user scripts on the main UI thread.
 */
export function createGameScriptSession(
  codeFiles: CodeFileItem[] | undefined,
  onError?: (fileName: string, errorMessage: string) => void
): GameScriptWorkerSession {
  const noopSession: GameScriptWorkerSession = {
    active: false,
    runStart: () => {},
    stepUpdate: () => {},
    dispose: () => {},
  };

  if (!codeFiles || codeFiles.length === 0) return noopSession;

  const jsFiles = codeFiles.filter(
    (f) => f.enabledInRuntime && (f.language === 'javascript' || f.language === 'typescript')
  );
  if (jsFiles.length === 0) return noopSession;

  if (!permissionManager.hasPermission('script:execute')) {
    onError?.(
      'امنیت استودیو',
      'مجوز اجرای اسکریپت سفارشی (script:execute) توسط کاربر تایید نشده است.'
    );
    return noopSession;
  }

  const validFiles: Array<{ id: string; name: string; content: string }> = [];
  for (const file of jsFiles) {
    const pathCheck = validateAndSanitizePath(file.path || file.name);
    if (!pathCheck.valid) {
      onError?.(file.name, `مسیر نامعتبر یا ناامن: ${pathCheck.error}`);
      continue;
    }
    validFiles.push({ id: file.id, name: file.name, content: file.content });
  }

  if (validFiles.length === 0 || typeof Worker === 'undefined') {
    return noopSession;
  }

  const sessionId = `hooks_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const worker = new Worker(
    new URL('../runtime/workers/javascriptWorker.ts', import.meta.url),
    { type: 'module' }
  );

  let disposed = false;
  let ready = false;
  let inFlight = false;
  let pendingCallback: ((batch: HookCommandBatch) => void) | null = null;
  let pendingStartSnapshot: {
    score: number;
    health: number;
    vars: Record<string, number>;
    elapsed: number;
    entities: HookSnapshotEntity[];
  } | null = null;
  let pendingStartCb: ((batch: HookCommandBatch) => void) | null = null;

  worker.onmessage = (ev: MessageEvent) => {
    if (disposed) return;
    const msg = ev.data;
    if (!msg || msg.sessionId !== sessionId) return;

    if (msg.type === 'HOOK_READY') {
      ready = true;
      if (Array.isArray(msg.errors)) {
        for (const err of msg.errors) {
          onError?.(err.fileName, err.message);
        }
      }
      if (pendingStartSnapshot && pendingStartCb) {
        const snap = pendingStartSnapshot;
        const cb = pendingStartCb;
        pendingStartSnapshot = null;
        pendingStartCb = null;
        inFlight = true;
        pendingCallback = cb;
        worker.postMessage({
          type: 'HOOK_STEP',
          sessionId,
          phase: 'start',
          dt: 0,
          snapshot: snap,
        });
      }
    } else if (msg.type === 'HOOK_RESULT') {
      inFlight = false;
      const cb = pendingCallback;
      pendingCallback = null;
      const batch = msg.batch as HookCommandBatch;
      if (batch.errors?.length) {
        for (const err of batch.errors) {
          onError?.(err.fileName, err.message);
        }
      }
      cb?.(batch);
    }
  };

  worker.onerror = (err) => {
    inFlight = false;
    onError?.('Worker', err.message || 'خطای اجرای اسکریپت در ورکر ایزوله');
  };

  worker.postMessage({
    type: 'HOOK_INIT',
    sessionId,
    files: validFiles,
  });

  return {
    active: true,
    runStart(snapshot, applyBatch) {
      if (disposed) return;
      if (!ready) {
        pendingStartSnapshot = snapshot;
        pendingStartCb = applyBatch;
        return;
      }
      if (inFlight) return;
      inFlight = true;
      pendingCallback = applyBatch;
      worker.postMessage({
        type: 'HOOK_STEP',
        sessionId,
        phase: 'start',
        dt: 0,
        snapshot,
      });
    },
    stepUpdate(dt, snapshot, applyBatch) {
      if (disposed || !ready || inFlight) return;
      inFlight = true;
      pendingCallback = applyBatch;
      worker.postMessage({
        type: 'HOOK_STEP',
        sessionId,
        phase: 'update',
        dt,
        snapshot,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingCallback = null;
      pendingStartCb = null;
      worker.terminate();
    },
  };
}

/**
 * Asynchronously executes a script file in the isolated multi-language Web Worker sandbox.
 */
export async function testExecuteScriptFileAsync(file: CodeFileItem): Promise<ScriptRunResponse> {
  return runScriptIsolated(file);
}
