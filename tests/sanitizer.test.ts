import { describe, it, expect } from 'vitest';
import {
  validateAndSanitizePath,
  sanitizeHtml,
  sanitizeSvg,
  isSafeUrl,
  validateAndFormatJson,
  validateFileSize,
} from '../src/security/fileSanitizer';

describe('Security & File Sanitizer (P0)', () => {
  it('blocks directory traversal attacks', () => {
    expect(validateAndSanitizePath('../../etc/passwd').valid).toBe(false);
    expect(validateAndSanitizePath('../secret.env').valid).toBe(false);
    expect(validateAndSanitizePath('scripts/../../root').valid).toBe(false);
    expect(validateAndSanitizePath('/etc/shadow').valid).toBe(false);
    expect(validateAndSanitizePath('c:\\windows\\system32').valid).toBe(false);
  });

  it('blocks null byte injection attacks', () => {
    expect(validateAndSanitizePath('test\0.js').valid).toBe(false);
    expect(validateAndSanitizePath('test%00.js').valid).toBe(false);
  });

  it('permits safe canonical project paths', () => {
    const res = validateAndSanitizePath('scripts/playerController.js');
    expect(res.valid).toBe(true);
    expect(res.cleanPath).toBe('scripts/playerController.js');
    expect(res.fileName).toBe('playerController.js');
    expect(res.extension).toBe('js');
  });

  it('strips malicious script tags and inline events using DOMPurify in HTML', () => {
    const dirty = '<div class="banner">سلام</div><script>alert("xss")</script><img src="x" onerror="evil()"/>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('alert');
    expect(clean).not.toContain('onerror');
    expect(clean).toContain('سلام');
  });

  it('cleans SVG files from foreignObjects and script tags', () => {
    const dirty = '<svg><script>alert(1)</script><foreignObject><iframe></iframe></foreignObject><rect width="10" height="10"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('foreignObject');
    expect(clean).toContain('rect');
  });

  it('rejects unsafe URL schemes', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox')).toBe(false);
    expect(isSafeUrl('https://cdn.example.com/sprite.png')).toBe(true);
    expect(isSafeUrl('data:image/png;base64,AAAA')).toBe(true);
  });

  it('validates JSON structure', () => {
    expect(validateAndFormatJson('{"valid": true}').valid).toBe(true);
    expect(validateAndFormatJson('{broken json}').valid).toBe(false);
  });

  it('enforces maximum file sizes for quotas', () => {
    expect(validateFileSize(1024, 'code')).toBe(true);
    expect(validateFileSize(50 * 1024 * 1024, 'code')).toBe(false);
  });
});
