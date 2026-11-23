/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Permission & Consent Manager
 * Deny by default, explicit user consent, immutable audit logging
 */

export type PermissionScope =
  | 'script:execute'   // Execute user custom scripts (JS/Python/Lua in worker sandbox)
  | 'storage:write'    // Write/delete persistent projects in IndexedDB / localStorage
  | 'network:fetch'    // Outbound network requests for external assets / APIs
  | 'audio:play'       // Web Audio Context & BGM playback
  | 'export:package'   // Packaging and downloading ZIP / APK / EXE releases
  | 'ai:generate';     // Outbound AI model inference calls

export interface PermissionRecord {
  scope: PermissionScope;
  granted: boolean;
  timestamp: number;
  reason?: string;
}

export interface PermissionAuditRecord {
  id: string;
  scope: PermissionScope;
  action: 'requested' | 'granted' | 'denied' | 'revoked';
  timestamp: number;
  reason?: string;
}

export interface PermissionRequestPrompt {
  id: string;
  scope: PermissionScope;
  title: string;
  description: string;
  resolve: (granted: boolean) => void;
}

const STORAGE_KEY = 'rayan_studio_permissions_v1';
const AUDIT_STORAGE_KEY = 'rayan_studio_permission_audit_v1';

const SCOPE_DESCRIPTIONS: Record<PermissionScope, { title: string; desc: string }> = {
  'script:execute': {
    title: 'اجرای کدهای اسکریپت سفارشی',
    desc: 'اجرای کدهای JavaScript، Python یا Lua در محیط ایزوله Web Worker برای منطق بازی.',
  },
  'storage:write': {
    title: 'ذخیره‌سازی دائمی پروژه',
    desc: 'ثبت و ذخیره تغییرات پروژه و دارایی‌ها در پایگاه داده محلی مرورگر (IndexedDB).',
  },
  'network:fetch': {
    title: 'ارتباط اینترنتی و بارگیری دارایی‌ها',
    desc: 'دریافت منابع یا تصاویر خارجی و کتابخانه‌های وب‌اسمبلی از شبکه اینترنت.',
  },
  'audio:play': {
    title: 'پخش صدا و موسیقی',
    desc: 'فعال‌سازی موتور صوتی جهت پخش افکت‌ها و آهنگ‌های پس‌زمینه.',
  },
  'export:package': {
    title: 'تولید و دانلود بسته‌های خروجی',
    desc: 'ساخت فایل‌های ZIP، پروژه‌های اندروید، ویندوز و HTML مستقل.',
  },
  'ai:generate': {
    title: 'درخواست تولید محتوا با هوش مصنوعی',
    desc: 'ارسال پرامپت‌ها به سرور جهت تولید یا پیشنهاد قوانین بازی.',
  },
};

class PermissionManager {
  private permissions: Map<PermissionScope, boolean> = new Map();
  private auditLog: PermissionAuditRecord[] = [];
  private listeners: Set<() => void> = new Set();
  private promptHandler: ((prompt: PermissionRequestPrompt) => void) | null = null;

  constructor() {
    this.loadState();
  }

  private loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        Object.entries(parsed).forEach(([k, v]) => {
          this.permissions.set(k as PermissionScope, Boolean(v));
        });
      }
      const auditRaw = localStorage.getItem(AUDIT_STORAGE_KEY);
      if (auditRaw) {
        this.auditLog = JSON.parse(auditRaw);
      }
    } catch {
      // Defaults to all false (deny-by-default)
    }
  }

  private saveState() {
    try {
      const obj: Record<string, boolean> = {};
      this.permissions.forEach((v, k) => {
        obj[k] = v;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.auditLog.slice(-100)));
    } catch {
      // Storage unavailable or disabled
    }
  }

  private logAudit(scope: PermissionScope, action: PermissionAuditRecord['action'], reason?: string) {
    const record: PermissionAuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      scope,
      action,
      timestamp: Date.now(),
      reason,
    };
    this.auditLog.push(record);
    this.saveState();
    this.notify();
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore listener err
      }
    });
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public setPromptHandler(handler: ((prompt: PermissionRequestPrompt) => void) | null) {
    this.promptHandler = handler;
  }

  public hasPermission(scope: PermissionScope): boolean {
    return this.permissions.get(scope) === true;
  }

  public async requestPermission(scope: PermissionScope, reason?: string): Promise<boolean> {
    if (this.hasPermission(scope)) {
      return true;
    }

    this.logAudit(scope, 'requested', reason);

    // If an interactive prompt handler is registered (UI dialog modal)
    if (this.promptHandler) {
      return new Promise<boolean>((resolve) => {
        const meta = SCOPE_DESCRIPTIONS[scope] || { title: scope, desc: reason || '' };
        this.promptHandler!({
          id: `req_${Date.now()}`,
          scope,
          title: meta.title,
          description: meta.desc,
          resolve: (granted: boolean) => {
            if (granted) {
              this.grantPermission(scope, reason);
            } else {
              this.denyPermission(scope, reason);
            }
            resolve(granted);
          },
        });
      });
    }

    // Default policy when prompt handler is not ready: deny by default
    this.logAudit(scope, 'denied', reason || 'رد خودکار: تأییدیه کاربر ثبت نشده است.');
    return false;
  }

  public grantPermission(scope: PermissionScope, reason?: string) {
    this.permissions.set(scope, true);
    this.logAudit(scope, 'granted', reason);
    this.saveState();
  }

  public denyPermission(scope: PermissionScope, reason?: string) {
    this.permissions.set(scope, false);
    this.logAudit(scope, 'denied', reason);
    this.saveState();
  }

  public revokePermission(scope: PermissionScope, reason?: string) {
    this.permissions.set(scope, false);
    this.logAudit(scope, 'revoked', reason);
    this.saveState();
  }

  public resetAllPermissions() {
    this.permissions.clear();
    this.logAudit('storage:write', 'revoked', 'بازنشانی تمامی دسترسی‌ها به حالت پیش‌فرض');
    this.saveState();
  }

  public getSnapshot(): Record<PermissionScope, boolean> {
    const res = {} as Record<PermissionScope, boolean>;
    const allScopes: PermissionScope[] = [
      'script:execute',
      'storage:write',
      'network:fetch',
      'audio:play',
      'export:package',
      'ai:generate',
    ];
    for (const sc of allScopes) {
      res[sc] = this.permissions.get(sc) === true;
    }
    return res;
  }

  public getAuditLog(): PermissionAuditRecord[] {
    return [...this.auditLog];
  }

  public getScopeMetadata(scope: PermissionScope) {
    return SCOPE_DESCRIPTIONS[scope] || { title: scope, desc: '' };
  }
}

export const permissionManager = new PermissionManager();
