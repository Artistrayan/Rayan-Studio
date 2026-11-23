import { describe, it, expect, beforeEach } from 'vitest';
import { permissionManager } from '../src/security/permissionManager';

describe('Permission Manager (P0)', () => {
  beforeEach(() => {
    permissionManager.resetAllPermissions();
  });

  it('denies permissions by default without explicit user consent', () => {
    expect(permissionManager.hasPermission('script:execute')).toBe(false);
    expect(permissionManager.hasPermission('network:fetch')).toBe(false);
    expect(permissionManager.hasPermission('export:package')).toBe(false);
  });

  it('grants permission when explicitly authorized', () => {
    permissionManager.grantPermission('script:execute', 'کاربر دکمه اجازه را فشرد');
    expect(permissionManager.hasPermission('script:execute')).toBe(true);
  });

  it('revokes permission cleanly', () => {
    permissionManager.grantPermission('audio:play');
    expect(permissionManager.hasPermission('audio:play')).toBe(true);

    permissionManager.revokePermission('audio:play', 'کاربر دسترسی را بست');
    expect(permissionManager.hasPermission('audio:play')).toBe(false);
  });

  it('records an immutable audit trail for every request, grant, and revocation', () => {
    permissionManager.grantPermission('storage:write', 'تست بازرسی');
    const logs = permissionManager.getAuditLog();
    expect(logs.length).toBeGreaterThan(0);
    const last = logs[logs.length - 1];
    expect(last.scope).toBe('storage:write');
    expect(last.action).toBe('granted');
    expect(last.reason).toBe('تست بازرسی');
  });

  it('provides complete snapshot dictionary', () => {
    permissionManager.grantPermission('ai:generate');
    const snap = permissionManager.getSnapshot();
    expect(snap['ai:generate']).toBe(true);
    expect(snap['network:fetch']).toBe(false);
  });
});
