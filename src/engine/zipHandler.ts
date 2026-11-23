import JSZip from 'jszip';
import type {
  AssetFormat,
  AssetKind,
  CodeFileItem,
  CodeFileLanguage,
  RayanAsset,
  RayanProject,
} from '../types/studio';
import { normalizeProject } from '../storage/projectDb';
import { buildStandaloneGameHtml } from './exporters';

export interface ZipImportResult {
  importedProject: RayanProject | null;
  codeFiles: CodeFileItem[];
  assets: RayanAsset[];
  skippedFiles: string[];
  totalEntries: number;
}

const CODE_EXT_MAP: Record<string, CodeFileLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  lua: 'lua',
  css: 'css',
  scss: 'css',
  html: 'html',
  htm: 'html',
  json: 'json',
  txt: 'text',
  md: 'text',
  glsl: 'text',
  vert: 'text',
  frag: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  csv: 'text',
};

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'text/plain',
  stl: 'application/octet-stream',
  fbx: 'application/octet-stream',
  ply: 'application/octet-stream',
  usd: 'model/vnd.usd',
  usdz: 'model/vnd.usdz+zip',
};

function detectAssetType(ext: string): { kind: AssetKind; format: AssetFormat } | null {
  if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) {
    return { kind: 'image', format: (ext === 'jpeg' ? 'jpg' : ext) as AssetFormat };
  }
  if (['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'usd', 'usdz'].includes(ext)) {
    return { kind: 'model3d', format: ext as AssetFormat };
  }
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
    return { kind: 'audio', format: (ext === 'm4a' ? 'mp3' : ext) as AssetFormat };
  }
  return null;
}

export function detectCodeLanguageFromName(filename: string): CodeFileLanguage {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return CODE_EXT_MAP[ext] || 'text';
}

function safeSlug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'rayan-game';
}

function triggerZipDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return new Uint8Array();
  const header = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  if (header.includes(';base64')) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

/**
 * Reads any real .zip archive and extracts:
 * - RayanProject (.rayan.json / rayan-project.json) if present
 * - All code/script/markup/config files (.js, .ts, .css, .html, .json, .txt, .md, shaders)
 * - All media assets (images, audio, 3D models)
 */
export async function importZipPackage(file: File): Promise<ZipImportResult> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => {
    if (entry.dir) return false;
    if (entry.name.startsWith('__MACOSX/') || entry.name.endsWith('.DS_Store')) return false;
    return true;
  });

  let importedProject: RayanProject | null = null;
  const codeFiles: CodeFileItem[] = [];
  const assets: RayanAsset[] = [];
  const skippedFiles: string[] = [];

  for (const entry of entries) {
    const cleanPath = entry.name.replace(/^\/+/, '');
    const baseName = cleanPath.split('/').pop() || cleanPath;
    const ext = baseName.split('.').pop()?.toLowerCase() || '';

    // 1. Check if it's a Rayan project manifest
    if (
      ext === 'json' &&
      (baseName.endsWith('.rayan.json') || baseName === 'rayan-project.json' || baseName === 'project.json')
    ) {
      try {
        const text = await entry.async('string');
        const parsed = JSON.parse(text) as Partial<RayanProject>;
        if (Array.isArray(parsed.entities) && parsed.screenConfig) {
          const now = Date.now();
          importedProject = normalizeProject({
            ...(parsed as RayanProject),
            id: `proj_${now}`,
            name: parsed.name || file.name.replace(/\.zip$/i, ''),
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }
      } catch {
        // Fall through to normal code file
      }
    }

    // 2. Check if it's a code/text file
    if (ext in CODE_EXT_MAP) {
      try {
        const content = await entry.async('string');
        const lang = CODE_EXT_MAP[ext];
        codeFiles.push({
          id: `code_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: baseName,
          path: cleanPath,
          language: lang,
          content,
          enabledInRuntime: lang === 'javascript' || lang === 'css',
          updatedAt: Date.now(),
        });
      } catch {
        skippedFiles.push(cleanPath);
      }
      continue;
    }

    // 3. Check if it's a supported asset (image, audio, 3d model)
    const detected = detectAssetType(ext);
    if (detected) {
      try {
        const base64 = await entry.async('base64');
        const mime = MIME_MAP[ext] || 'application/octet-stream';
        const rawBytes = Math.round((base64.length * 3) / 4);
        assets.push({
          id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: baseName.replace(/\.[^.]+$/, ''),
          kind: detected.kind,
          format: detected.format,
          dataUrl: `data:${mime};base64,${base64}`,
          sizeBytes: rawBytes,
          createdAt: Date.now(),
        });
      } catch {
        skippedFiles.push(cleanPath);
      }
      continue;
    }

    skippedFiles.push(cleanPath);
  }

  return {
    importedProject,
    codeFiles,
    assets,
    skippedFiles,
    totalEntries: entries.length,
  };
}

/** Exports the entire project (JSON + playable offline HTML + all code files + decoded assets) as a ZIP */
export async function exportCompleteProjectZip(project: RayanProject): Promise<void> {
  const slug = safeSlug(project.name);
  const zip = new JSZip();

  zip.file('rayan-project.json', JSON.stringify(project, null, 2));

  const playableHtml = await buildStandaloneGameHtml(project);
  zip.file('index.html', playableHtml);

  const codeFiles = project.codeFiles || [];
  codeFiles.forEach((cf) => {
    const cleanPath = (cf.path || cf.name).replace(/^\/+/, '');
    zip.file(cleanPath, cf.content);
  });

  const assetsFolder = zip.folder('assets');
  if (assetsFolder) {
    project.assets.forEach((asset) => {
      const safeName = `${asset.name.replace(/[\\/:*?"<>|]/g, '_')}.${asset.format}`;
      if (asset.dataUrl.startsWith('data:')) {
        assetsFolder.file(safeName, dataUrlToUint8Array(asset.dataUrl));
      }
    });
  }

  zip.file('rules.rayan.txt', project.rulesText || '');
  zip.file(
    'README.md',
    `# ${project.name}

بسته کامل پروژه ساخته شده در **استودیو بازی‌سازی رایان**.

## محتوای بسته ZIP
- \`index.html\`: فایل اجرای مستقل و آفلاین بازی در مرورگر
- \`rayan-project.json\`: فایل پروژه جهت وارد کردن مجدد (Import ZIP) در استودیو رایان
- \`scripts/\`, \`styles/\`, \`config/\`: تمام فایل‌های کدنویسی پروژه (${codeFiles.length} فایل)
- \`assets/\`: تمام تصاویر، مدل‌های سه‌بعدی و صداهای پروژه (${project.assets.length} فایل)
`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerZipDownload(blob, `${slug}-complete.zip`);
}

/** Exports only code files + project config + runnable index.html from the Code IDE */
export async function exportCodeFilesZip(project: RayanProject): Promise<void> {
  const slug = safeSlug(project.name);
  const zip = new JSZip();
  const codeFiles = project.codeFiles || [];

  codeFiles.forEach((cf) => {
    const cleanPath = (cf.path || cf.name).replace(/^\/+/, '');
    zip.file(cleanPath, cf.content);
  });

  const playableHtml = await buildStandaloneGameHtml(project);
  zip.file('index.html', playableHtml);
  zip.file('rayan-project.json', JSON.stringify(project, null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerZipDownload(blob, `${slug}-code.zip`);
}
