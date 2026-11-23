/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Real Pyodide WebAssembly Python Worker
 * Loads real WebAssembly Python, streams stdout/stderr, reports true runtime version
 */

declare function importScripts(...urls: string[]): void;
declare function loadPyodide(config?: { indexURL?: string }): Promise<any>;

export interface PythonExecuteMessage {
  type: 'EXECUTE';
  executionId: string;
  code: string;
  context?: {
    score: number;
    health: number;
    vars: Record<string, number>;
  };
}

export interface PythonOutputMessage {
  type: 'OUTPUT';
  executionId: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

export interface PythonResultMessage {
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

let pyodideInstance: any = null;
let pyodideLoadingPromise: Promise<any> | null = null;

async function getPyodide(): Promise<any> {
  if (pyodideInstance) return pyodideInstance;
  if (pyodideLoadingPromise) return pyodideLoadingPromise;

  pyodideLoadingPromise = (async () => {
    try {
      importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.js');
    } catch (err) {
      throw new Error(
        'عدم امکان بارگیری کتابخانه Pyodide از شبکه. لطفاً اتصال اینترنت خود را بررسی نمایید.'
      );
    }
    const py = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.2/full/',
    });
    pyodideInstance = py;
    return py;
  })();

  return pyodideLoadingPromise;
}

self.onmessage = async (event: MessageEvent<PythonExecuteMessage | { type: 'GET_VERSION' }>) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'GET_VERSION') {
    try {
      const py = await getPyodide();
      const ver = py.runPython('import sys; sys.version');
      self.postMessage({ type: 'VERSION', version: ver });
    } catch (err) {
      self.postMessage({ type: 'VERSION', version: 'Pyodide Wasm (بارگیری نشده)' });
    }
    return;
  }

  if (data.type !== 'EXECUTE') return;

  const { executionId, code, context } = data;
  const startTime = performance.now();

  const sendOutput = (level: 'log' | 'warn' | 'error', message: string) => {
    self.postMessage({
      type: 'OUTPUT',
      executionId,
      level,
      message,
    } as PythonOutputMessage);
  };

  try {
    const py = await getPyodide();
    const version = py.runPython('import sys; sys.version.split()[0]');

    // Prepare sandbox state dict in Python
    const workingState = {
      score: context?.score ?? 0,
      health: context?.health ?? 100,
      vars: { ...(context?.vars || {}) },
    };

    py.globals.set('__initial_state__', py.toPy(workingState));

    // Redirect stdout and stderr using Python io.StringIO
    const setupRedirect = `
import sys
import io

class RayanStream:
    def __init__(self, is_err=False):
        self.is_err = is_err
    def write(self, s):
        if s and not s.isspace():
            __post_output__(s, self.is_err)
    def flush(self):
        pass

sys.stdout = RayanStream(False)
sys.stderr = RayanStream(True)
`;

    py.globals.set('__post_output__', (text: string, isErr: boolean) => {
      sendOutput(isErr ? 'error' : 'log', text);
    });

    await py.runPythonAsync(setupRedirect);

    // Provide game api module in Python
    const apiPreamble = `
class GameApi:
    def __init__(self, state):
        self._state = state
    @property
    def score(self):
        return self._state.get("score", 0)
    def set_score(self, val):
        self._state["score"] = int(val)
        print(f"[Python score = {val}]")
    def add_score(self, delta):
        self._state["score"] = self._state.get("score", 0) + int(delta)
        print(f"[Python score += {delta} -> {self._state['score']}]")
    @property
    def health(self):
        return self._state.get("health", 100)
    def set_health(self, val):
        self._state["health"] = max(0, int(val))
        print(f"[Python health = {val}]")

api = GameApi(__initial_state__)
`;
    await py.runPythonAsync(apiPreamble);

    // Run actual user Python code
    await py.runPythonAsync(code);

    // Retrieve modified state
    const finalStatePy = py.globals.get('__initial_state__');
    const finalState = finalStatePy ? finalStatePy.toJs() : workingState;

    const durationMs = performance.now() - startTime;
    self.postMessage({
      type: 'RESULT',
      executionId,
      ok: true,
      version: `Python ${version} (Pyodide Wasm)`,
      state: {
        score: finalState.get ? finalState.get('score') : finalState.score ?? workingState.score,
        health: finalState.get ? finalState.get('health') : finalState.health ?? workingState.health,
        vars: workingState.vars,
      },
      durationMs,
    } as PythonResultMessage);
  } catch (err: unknown) {
    const durationMs = performance.now() - startTime;
    const errorMsg =
      err instanceof Error ? `${err.message}` : String(err);
    self.postMessage({
      type: 'RESULT',
      executionId,
      ok: false,
      error: errorMsg,
      durationMs,
    } as PythonResultMessage);
  }
};
