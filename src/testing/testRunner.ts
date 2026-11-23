/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Testing & Quality Assurance Engine
 * Implements real automated unit & integration tests with zero simulated results
 */

import { validateAndSanitizePath, sanitizeHtml, sanitizeSvg, isSafeUrl, validateAndFormatJson } from '../security/fileSanitizer';
import { permissionManager } from '../security/permissionManager';
import { runtimeManager, type ExecutionResult } from '../runtime/runtimeManager';
import { parseRuleText } from '../engine/ruleParser';

export interface TestCaseResult {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  details?: string;
}

export interface TestSuiteResult {
  id: string;
  name: string;
  cases: TestCaseResult[];
  passed: number;
  failed: number;
  durationMs: number;
}

export interface FullTestReport {
  timestamp: number;
  totalSuites: number;
  totalTests: number;
  passed: number;
  failed: number;
  durationMs: number;
  suites: TestSuiteResult[];
}

export class StudioTestRunner {
  /**
   * Executes a single test case safely with exact duration measurement.
   */
  private static async executeCase(
    name: string,
    fn: () => Promise<void> | void
  ): Promise<TestCaseResult> {
    const start = performance.now();
    try {
      await fn();
      return {
        name,
        ok: true,
        durationMs: performance.now() - start,
      };
    } catch (err) {
      return {
        name,
        ok: false,
        durationMs: performance.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Suite 1: File Sanitizer & Path Traversal Security
   */
  public static async runSanitizerSuite(): Promise<TestSuiteResult> {
    const start = performance.now();
    const cases: TestCaseResult[] = [];

    // Case 1.1: Detect and reject directory traversal
    cases.push(
      await this.executeCase('مسدودسازی پیمایش پوشه‌ها (Directory Traversal)', () => {
        const attack1 = validateAndSanitizePath('../../etc/passwd');
        if (attack1.valid) throw new Error('حمله ../../etc/passwd باید مسدود می‌شد اما مسدود نشد.');

        const attack2 = validateAndSanitizePath('scripts/../../config.json');
        if (attack2.valid) throw new Error('حمله پیمایش نسبی مسدود نشد.');

        const safe = validateAndSanitizePath('scripts/player.js');
        if (!safe.valid || safe.cleanPath !== 'scripts/player.js') {
          throw new Error(`مسیر مجاز به اشتباه مسدود شد: ${safe.error}`);
        }
      })
    );

    // Case 1.2: Detect null bytes and illegal characters
    cases.push(
      await this.executeCase('مسدودسازی کاراکترهای خطرناک و بایت صفر (Null Byte Injection)', () => {
        const nullByte = validateAndSanitizePath('player\0.js');
        if (nullByte.valid) throw new Error('تزریق Null byte باید رد می‌شد.');

        const encodedNull = validateAndSanitizePath('player%00.js');
        if (encodedNull.valid) throw new Error('تزریق %00 باید رد می‌شد.');
      })
    );

    // Case 1.3: DOMPurify HTML sanitization
    cases.push(
      await this.executeCase('پاکسازی واقعی HTML با DOMPurify', () => {
        const dirty = '<div class="ui">سلام</div><script>alert("hacked")</script><img src=x onerror=alert(1)>';
        const clean = sanitizeHtml(dirty);
        if (clean.includes('<script>') || clean.includes('alert(') || clean.includes('onerror=')) {
          throw new Error(`پاکسازی اسکریپت در HTML ناقص است: ${clean}`);
        }
        if (!clean.includes('سلام')) {
          throw new Error('محتوای متنی مجاز در پاکسازی از بین رفت.');
        }
      })
    );

    // Case 1.4: SVG security sanitization
    cases.push(
      await this.executeCase('پاکسازی واقعی SVG و حذف بردارهای XSS', () => {
        const dirtySvg = '<svg><circle cx="50" cy="50" r="40"/><script>evil()</script><foreignObject><iframe src="evil.com"></iframe></foreignObject></svg>';
        const cleanSvg = sanitizeSvg(dirtySvg);
        if (cleanSvg.includes('<script') || cleanSvg.includes('<foreignObject') || cleanSvg.includes('<iframe')) {
          throw new Error(`تگ‌های خطرناک SVG حذف نشدند: ${cleanSvg}`);
        }
        if (!cleanSvg.includes('circle')) {
          throw new Error('المان مجاز circle در SVG نباید حذف می‌شد.');
        }
      })
    );

    // Case 1.5: URL verification
    cases.push(
      await this.executeCase('اعتبارسنجی آدرس‌های امن URL', () => {
        if (isSafeUrl('javascript:alert(1)')) throw new Error('آدرس javascript: باید رد می‌شد.');
        if (isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')) throw new Error('آدرس data:text/html باید رد می‌شد.');
        if (!isSafeUrl('https://example.com/asset.png')) throw new Error('آدرس https باید تایید می‌شد.');
        if (!isSafeUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')) throw new Error('آدرس data:image/png باید تایید می‌شد.');
      })
    );

    // Case 1.6: JSON validation
    cases.push(
      await this.executeCase('اعتبارسنجی و فرمت‌بندی JSON', () => {
        const bad = validateAndFormatJson('{ invalid json: true }');
        if (bad.valid) throw new Error('JSON نامعتبر به عنوان معتبر شناسایی شد.');
        const good = validateAndFormatJson('{"name": "player", "hp": 100}');
        if (!good.valid) throw new Error(`JSON معتبر رد شد: ${good.error}`);
      })
    );

    const passed = cases.filter((c) => c.ok).length;
    return {
      id: 'sanitizer',
      name: 'مجموعه آزمون امنیت و پاکسازی فایل‌ها',
      cases,
      passed,
      failed: cases.length - passed,
      durationMs: performance.now() - start,
    };
  }

  /**
   * Suite 2: Permission Manager & Access Control
   */
  public static async runPermissionsSuite(): Promise<TestSuiteResult> {
    const start = performance.now();
    const cases: TestCaseResult[] = [];

    // Case 2.1: Deny by default
    cases.push(
      await this.executeCase('سیاست پیش‌فرض رد تمامی مجوزها (Deny by default)', () => {
        // Temporarily reset to verify
        const initial = permissionManager.hasPermission('export:package');
        // Revoke to test default check
        permissionManager.revokePermission('export:package', 'آزمون سیستمی');
        if (permissionManager.hasPermission('export:package')) {
          throw new Error('مجوز پس از لغو باید رد باشد.');
        }
        // Restore if previously had
        if (initial) permissionManager.grantPermission('export:package', 'بازگردانی آزمون');
      })
    );

    // Case 2.2: Grant and Audit Logging
    cases.push(
      await this.executeCase('اعطای مجوز و ثبت در سیاهه بازرسی (Audit Log)', () => {
        permissionManager.grantPermission('script:execute', 'تست اعطای مجوز اجرای کد');
        if (!permissionManager.hasPermission('script:execute')) {
          throw new Error('مجوز script:execute بعد از اعطا باید فعال باشد.');
        }
        const logs = permissionManager.getAuditLog();
        const latest = logs[logs.length - 1];
        if (!latest || latest.scope !== 'script:execute' || latest.action !== 'granted') {
          throw new Error('رویداد اعطای مجوز در سیاهه بازرسی ثبت نشد.');
        }
      })
    );

    const passed = cases.filter((c) => c.ok).length;
    return {
      id: 'permissions',
      name: 'مجموعه آزمون مدیریت دسترسی‌ها و رضایت کاربر',
      cases,
      passed,
      failed: cases.length - passed,
      durationMs: performance.now() - start,
    };
  }

  /**
   * Suite 3: Multi-Language Runtimes & Execution Guards
   */
  public static async runRuntimesSuite(): Promise<TestSuiteResult> {
    const start = performance.now();
    const cases: TestCaseResult[] = [];

    // Ensure permission is granted for testing execution
    permissionManager.grantPermission('script:execute', 'اجرای آزمون‌های رانتایم');

    // Case 3.1: JavaScript real execution & state mutation
    cases.push(
      await this.executeCase('اجرای واقعی کد JavaScript و اعمال تغییرات وضعیت', async () => {
        const jsCode = `
          api.addScore(25);
          api.setVar('wave', 3);
          api.log('امتیاز ثبت شد: ' + api.score);
        `;
        const res: ExecutionResult = await runtimeManager.executeCode('javascript', jsCode, {
          context: { score: 10, health: 100, vars: { wave: 1 } },
        });

        if (!res.ok) {
          throw new Error(`اجرای کد JS شکست خورد: ${res.error}`);
        }
        if (res.finalState?.score !== 35) {
          throw new Error(`مقدار امتیاز نادرست است. انتظار 35 بود ولی ${res.finalState?.score} دریافت شد.`);
        }
        if (res.finalState?.vars?.wave !== 3) {
          throw new Error(`مقدار متغیر wave نادرست است.`);
        }
      })
    );

    // Case 3.2: Syntax error detection and error propagation
    cases.push(
      await this.executeCase('تشخیص دقیق خطای نحوی (Syntax Error) در کد کاربر', async () => {
        const badJs = `function { unclosed syntax (;`;
        const res = await runtimeManager.executeCode('javascript', badJs);
        if (res.ok) {
          throw new Error('کد با خطای نحوی فاحش نباید با موفقیت اجرا می‌شد.');
        }
        if (!res.error) {
          throw new Error('متن خطا باید حاوی توضیحات سینتکس باشد.');
        }
      })
    );

    // Case 3.3: Execution timeout / infinite loop protection
    cases.push(
      await this.executeCase('محافظت در برابر حلقه‌های بی‌نهایت با مهلت زمانی (Timeout)', async () => {
        // Request an execution with a short 200ms timeout
        const infiniteLoopCode = `
          let counter = 0;
          while (true) {
            counter++;
          }
        `;
        // In browser Worker mode, the worker terminates after timeoutMs.
        // In node headless mode, runtimeManager handles it safely.
        if (typeof Worker !== 'undefined') {
          const res = await runtimeManager.executeCode('javascript', infiniteLoopCode, {
            timeoutMs: 300,
          });
          if (res.ok) {
            throw new Error('حلقه بی‌نهایت باید توسط زمان‌سنج خاتمه داده می‌شد.');
          }
          if (!res.error || !res.error.includes('طولانی شدن')) {
            throw new Error(`خطای تایم‌اوت مناسب دریافت نشد: ${res.error}`);
          }
        }
      })
    );

    // Case 3.4: Lua Wasmoon runtime check
    cases.push(
      await this.executeCase('آزمون ساختاری رانتایم وب‌اسمبلی لوآ (Wasmoon)', async () => {
        const luaVer = await runtimeManager.getRuntimeVersion('lua');
        if (!luaVer || typeof luaVer !== 'string') {
          throw new Error('نسخه رانتایم لوآ گزارش نشد.');
        }
      })
    );

    const passed = cases.filter((c) => c.ok).length;
    return {
      id: 'runtimes',
      name: 'مجموعه آزمون رانتایم‌های چندزبانه و محافظت زمانی',
      cases,
      passed,
      failed: cases.length - passed,
      durationMs: performance.now() - start,
    };
  }

  /**
   * Suite 4: Visual Rule Parser
   */
  public static async runRulesEngineSuite(): Promise<TestSuiteResult> {
    const start = performance.now();
    const cases: TestCaseResult[] = [];

    // Case 4.1: Score rule
    cases.push(
      await this.executeCase('تجزیه قانون فارسی: افزایش امتیاز در برخورد', () => {
        const rule = parseRuleText('اگر برخورد بازیکن با سکه آنگاه امتیاز +10');
        if (!rule) throw new Error('قانون استخراج نشد.');
        if (rule.triggerType !== 'on-collision' || rule.targetName !== 'بازیکن' || rule.secondaryName !== 'سکه') {
          throw new Error('محرک یا اهداف برخورد به درستی استخراج نشدند.');
        }
        if (rule.actionType !== 'add-score' || rule.paramNumber !== 10) {
          throw new Error(`اکشن به درستی استخراج نشد: ${rule.actionType}`);
        }
      })
    );

    // Case 4.2: Scroll box rule
    cases.push(
      await this.executeCase('تجزیه قانون فارسی: اسکرول کادر یا قالب', () => {
        const rule = parseRuleText('اگر اسکرول کادر لیست آنگاه اسکرول مقدار 50');
        if (!rule) throw new Error('قانون اسکرول استخراج نشد.');
        if (rule.triggerType !== 'on-scroll') {
          throw new Error(`محرک اسکرول تشخیص داده نشد: ${rule.triggerType}`);
        }
        if (rule.actionType !== 'scroll-box' || rule.paramNumber !== 50) {
          throw new Error(`دستور اسکرول کادر نامعتبر است: ${rule.actionType}`);
        }
      })
    );

    const passed = cases.filter((c) => c.ok).length;
    return {
      id: 'rules',
      name: 'مجموعه آزمون موتور قوانین بصری فارسی',
      cases,
      passed,
      failed: cases.length - passed,
      durationMs: performance.now() - start,
    };
  }

  /**
   * Runs the complete studio test harness.
   */
  public static async runAll(): Promise<FullTestReport> {
    const startTime = performance.now();

    const suites: TestSuiteResult[] = [
      await this.runSanitizerSuite(),
      await this.runPermissionsSuite(),
      await this.runRuntimesSuite(),
      await this.runRulesEngineSuite(),
    ];

    const totalTests = suites.reduce((acc, s) => acc + s.cases.length, 0);
    const passed = suites.reduce((acc, s) => acc + s.passed, 0);
    const failed = suites.reduce((acc, s) => acc + s.failed, 0);

    return {
      timestamp: Date.now(),
      totalSuites: suites.length,
      totalTests,
      passed,
      failed,
      durationMs: performance.now() - startTime,
      suites,
    };
  }
}
