/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Script Runner
 * Interfaces with runtimeManager, permissionManager, and security checks
 */

import { runtimeManager, type ExecutionResult } from './runtimeManager';
import { permissionManager } from '../security/permissionManager';
import { validateAndSanitizePath, validateAndFormatJson, sanitizeHtml, sanitizeSvg } from '../security/fileSanitizer';
import type { CodeFileItem } from '../types/studio';

export interface ScriptRunResponse {
  ok: boolean;
  logs: string[];
  error?: string;
  durationMs: number;
  version?: string;
}

/**
 * Runs an untrusted user script (JavaScript, Python, or Lua) inside an isolated Web Worker sandbox.
 */
export async function runScriptIsolated(file: CodeFileItem): Promise<ScriptRunResponse> {
  const startTime = performance.now();

  // 1. Sanitize file path
  const pathCheck = validateAndSanitizePath(file.path || file.name);
  if (!pathCheck.valid) {
    return {
      ok: false,
      logs: [],
      error: `خطای مسیر فایل: ${pathCheck.error}`,
      durationMs: performance.now() - startTime,
    };
  }

  // 2. Validate JSON files
  if (file.language === 'json') {
    const jsonCheck = validateAndFormatJson(file.content);
    return {
      ok: jsonCheck.valid,
      logs: jsonCheck.valid ? ['فایل JSON معتبر و استاندارد است.'] : [],
      error: jsonCheck.error,
      durationMs: performance.now() - startTime,
    };
  }

  // 3. HTML / SVG validation
  if (file.language === 'html') {
    const clean = sanitizeHtml(file.content);
    return {
      ok: true,
      logs: [`قالب HTML بررسی و پاکسازی امنیتی شد (${clean.length} بایت).`],
      durationMs: performance.now() - startTime,
    };
  }

  // 4. Multi-language worker execution (JS, Python, Lua)
  const execResult: ExecutionResult = await runtimeManager.executeCode(
    file.language,
    file.content,
    {
      timeoutMs: 4500,
      context: {
        score: 100,
        health: 100,
        vars: { موج: 1 },
      },
    }
  );

  return {
    ok: execResult.ok,
    logs: execResult.logs,
    error: execResult.error,
    durationMs: execResult.durationMs,
    version: execResult.version,
  };
}

export { runtimeManager, permissionManager };
