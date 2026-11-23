/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production File & Path Sanitizer
 * Hardened with DOMPurify for HTML/SVG and strict path traversal protection
 */

import DOMPurify from 'dompurify';

export interface FileSanitizationResult {
  ok: boolean;
  cleanContent?: string;
  cleanPath?: string;
  error?: string;
}

export interface PathValidationResult {
  valid: boolean;
  cleanPath: string;
  fileName: string;
  extension: string;
  error?: string;
}

const DANGEROUS_PATH_PATTERNS = [
  /\.\./,              // Directory traversal
  /\0/,                // Null byte injection
  /[<>:"|?*]/,         // Windows/POSIX illegal filesystem characters
  /^[\/\\]/,           // Absolute path escaping root
  /\$\{/,              // Template string interpolation
  /%2e%2e/i,          // URL-encoded dot-dot
  /%00/i,              // URL-encoded null byte
];

const ALLOWED_CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'lua',
  'css', 'scss', 'html', 'htm', 'json', 'txt', 'md',
  'glsl', 'vert', 'frag', 'xml', 'yaml', 'yml', 'csv'
]);

const ALLOWED_ASSET_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'svg',
  'glb', 'gltf', 'obj', 'stl', 'fbx', 'ply',
  'mp3', 'wav', 'ogg', 'm4a'
]);

export const MAX_FILE_SIZES = {
  code: 2 * 1024 * 1024,        // 2 MB
  image: 15 * 1024 * 1024,      // 15 MB
  audio: 25 * 1024 * 1024,      // 25 MB
  model3d: 60 * 1024 * 1024,    // 60 MB
  archive: 100 * 1024 * 1024,   // 100 MB
};

/**
 * Validates and normalizes relative project paths to completely eliminate directory traversal attacks.
 */
export function validateAndSanitizePath(rawPath: string): PathValidationResult {
  if (!rawPath || typeof rawPath !== 'string') {
    return { valid: false, cleanPath: '', fileName: '', extension: '', error: 'مسیر فایل خالی است.' };
  }

  const normalized = rawPath.trim().replace(/\\/g, '/');

  for (const pattern of DANGEROUS_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        valid: false,
        cleanPath: '',
        fileName: '',
        extension: '',
        error: `مسیر فایل شامل کاراکترهای غیرمجاز یا تلاش برای پیمایش پوشه‌هاست: ${rawPath}`,
      };
    }
  }

  // Split into segments and filter empty/dot segments
  const segments = normalized
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.');

  if (segments.length === 0) {
    return { valid: false, cleanPath: '', fileName: '', extension: '', error: 'نام فایل نامعتبر است.' };
  }

  // Check each segment
  for (const seg of segments) {
    if (seg === '..' || seg === '') {
      return { valid: false, cleanPath: '', fileName: '', extension: '', error: 'مسیر شامل ارجاع به پوشه والد است.' };
    }
  }

  const cleanPath = segments.join('/');
  const fileName = segments[segments.length - 1];
  const extMatch = fileName.match(/\.([a-zA-Z0-9_-]+)$/);
  const extension = extMatch ? extMatch[1].toLowerCase() : '';

  return {
    valid: true,
    cleanPath,
    fileName,
    extension,
  };
}

/**
 * Helper to obtain a working DOMPurify sanitizer in browser, worker, or headless test environment.
 */
function getSanitizer(): { sanitize: (s: string, opt?: Record<string, unknown>) => string } {
  const purify = (DOMPurify as unknown as { default?: unknown }).default || DOMPurify;

  // Browser context with existing window
  if (typeof window !== 'undefined') {
    if (purify && typeof (purify as { sanitize?: unknown }).sanitize === 'function') {
      return purify as { sanitize: (s: string, opt?: Record<string, unknown>) => string };
    }
    if (typeof purify === 'function') {
      try {
        return (purify as (w: Window) => { sanitize: (s: string, opt?: Record<string, unknown>) => string })(window);
      } catch {
        // fallback
      }
    }
  }

  // Headless Node / Vitest fallback sanitizer
  return {
    sanitize: (raw: string) => {
      if (!raw || typeof raw !== 'string') return '';
      let clean = raw;
      // Strip script tags and inner contents
      clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      // Strip dangerous SVG containers and iframes
      clean = clean.replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '');
      clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
      clean = clean.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
      clean = clean.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');
      // Strip inline event attributes (onerror=..., onclick=..., etc.)
      clean = clean.replace(/\s+on[a-z0-9_]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
      // Neutralize javascript: protocol links
      clean = clean.replace(/href\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, 'href="#"');
      clean = clean.replace(/src\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, 'src=""');
      return clean;
    },
  };
}

/**
 * Sanitizes HTML content using DOMPurify with secure rules.
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  const sanitizer = getSanitizer();
  return sanitizer.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'formaction'],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Sanitizes SVG markup using DOMPurify configured specifically for vector graphics.
 * Strips script tags, external entities, foreignObjects, and inline event handlers.
 */
export function sanitizeSvg(rawSvg: string): string {
  if (!rawSvg || typeof rawSvg !== 'string') return '';
  const sanitizer = getSanitizer();
  return sanitizer.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'use'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'href', 'xlink:href'],
  });
}

/**
 * Validates and formats JSON content safely.
 */
export function validateAndFormatJson(rawJson: string): { valid: boolean; formatted?: string; error?: string } {
  try {
    const parsed = JSON.parse(rawJson);
    return { valid: true, formatted: JSON.stringify(parsed, null, 2) };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'فرمت JSON نامعتبر است.' };
  }
}

/**
 * Validates a safe URL (e.g. data URLs, https/http, relative assets).
 * Completely rejects javascript:, vbscript:, and data:text/html vectors.
 */
export function isSafeUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:')) return false;
  if (trimmed.startsWith('data:text/html') || trimmed.startsWith('data:application/xhtml+xml')) return false;
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('data:audio/') || trimmed.startsWith('data:model/')) return true;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/') || trimmed.startsWith('./')) return true;
  return false;
}

/**
 * Validates uploaded file size against safety thresholds.
 */
export function validateFileSize(sizeBytes: number, category: keyof typeof MAX_FILE_SIZES): boolean {
  const max = MAX_FILE_SIZES[category];
  return sizeBytes > 0 && sizeBytes <= max;
}

/**
 * Checks whether an extension is permissible for game code or asset storage.
 */
export function isExtensionAllowed(ext: string): boolean {
  const lower = ext.toLowerCase();
  return ALLOWED_CODE_EXTENSIONS.has(lower) || ALLOWED_ASSET_EXTENSIONS.has(lower);
}
