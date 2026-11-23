import { describe, it, expect, beforeEach } from 'vitest';
import { runtimeManager } from '../src/runtime/runtimeManager';
import { permissionManager } from '../src/security/permissionManager';
import { runScriptIsolated } from '../src/runtime/scriptRunner';
import type { CodeFileItem } from '../src/types/studio';

describe('Multi-Language Runtime Manager (P0)', () => {
  beforeEach(() => {
    permissionManager.grantPermission('script:execute', 'تست‌های واحد');
  });

  it('rejects execution if permission script:execute is denied', async () => {
    permissionManager.revokePermission('script:execute', 'لغو برای تست');
    const result = await runtimeManager.executeCode('javascript', 'api.addScore(10);');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('script:execute');
  });

  it('executes JavaScript and safely mutates state', async () => {
    const code = `
      api.addScore(50);
      api.setHealth(80);
      api.setVar('gold', 15);
      api.log('انجام شد');
    `;
    const result = await runtimeManager.executeCode('javascript', code, {
      context: { score: 10, health: 100, vars: {} },
    });

    expect(result.ok).toBe(true);
    expect(result.finalState?.score).toBe(60);
    expect(result.finalState?.health).toBe(80);
    expect(result.finalState?.vars?.gold).toBe(15);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports syntax errors with details and stack trace', async () => {
    const brokenCode = `function invalid( {`;
    const result = await runtimeManager.executeCode('javascript', brokenCode);
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('runs isolated script through runScriptIsolated pipeline', async () => {
    const file: CodeFileItem = {
      id: 'f1',
      name: 'coin.js',
      path: 'scripts/coin.js',
      language: 'javascript',
      content: 'api.addScore(100);',
      enabledInRuntime: true,
      updatedAt: Date.now(),
    };

    const runRes = await runScriptIsolated(file);
    expect(runRes.ok).toBe(true);
  });

  it('blocks dangerous path files before execution', async () => {
    const evilFile: CodeFileItem = {
      id: 'f2',
      name: 'evil.js',
      path: '../../etc/evil.js',
      language: 'javascript',
      content: 'api.addScore(100);',
      enabledInRuntime: true,
      updatedAt: Date.now(),
    };

    const runRes = await runScriptIsolated(evilFile);
    expect(runRes.ok).toBe(false);
    expect(runRes.error).toContain('خطای مسیر فایل');
  });
});
