/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Comprehensive External Asset Management & Import Engine
 * Integrates with IndexedDB v3 (`binary_assets`, `asset_chunks`, `asset_dependencies`)
 * for chunked large-file storage, SHA-256 versioning, texture/MTL/bin dependency
 * management, scene-asset linkage, DOMPurify SVG sanitization, and ZIP/GLB export.
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import JSZip from 'jszip';
import type {
  AssetDependencyRef,
  AssetFormat,
  AssetKind,
  Model3DMetadata,
  Model3DPresetType,
  RayanAsset,
} from '../types/studio';
import {
  buildProceduralPresetGroup,
  dataUrlToArrayBuffer,
  parseAndInspect3DModelFile,
} from './threeModels';
import { importZipPackage } from './zipHandler';
import {
  arrayBufferToDataUrl,
  bumpAssetVersion,
  getAssetFromDb,
  listAllAssetDependenciesFromDb,
  listAssetsFromDb,
  registerAssetDependency,
  registerBinaryModel,
  retrieveBinaryModel,
  type StoredAssetDependency,
} from '../storage/projectDb';
import { sanitizeSvg, validateFileSize } from '../security/fileSanitizer';

export interface AssetStorageStats {
  totalAssetRecordsInIdb: number;
  totalBytesInIdb: number;
  chunkedAssetsCount: number;
  totalDependenciesCount: number;
  browserQuotaBytes?: number;
  browserUsageBytes?: number;
}

export function detectAssetKindAndFormat(
  filenameOrMime: string,
  mimeHint?: string
): { kind: AssetKind; format: AssetFormat } | null {
  const cleanName = filenameOrMime.split('?')[0].split('#')[0];
  const ext = cleanName.includes('.') ? cleanName.split('.').pop()?.toLowerCase() || '' : '';

  if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) {
    return { kind: 'image', format: (ext === 'jpeg' ? 'jpg' : ext) as AssetFormat };
  }
  if (['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'usd', 'usdz'].includes(ext)) {
    return { kind: 'model3d', format: ext as AssetFormat };
  }
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
    return { kind: 'audio', format: (ext === 'm4a' ? 'mp3' : ext) as AssetFormat };
  }

  if (mimeHint) {
    const m = mimeHint.toLowerCase();
    if (m.includes('model/gltf-binary')) return { kind: 'model3d', format: 'glb' };
    if (m.includes('model/gltf+json')) return { kind: 'model3d', format: 'gltf' };
    if (m.includes('image/png')) return { kind: 'image', format: 'png' };
    if (m.includes('image/jpeg')) return { kind: 'image', format: 'jpg' };
    if (m.includes('image/webp')) return { kind: 'image', format: 'webp' };
    if (m.includes('image/svg+xml')) return { kind: 'image', format: 'svg' };
    if (m.includes('audio/mpeg')) return { kind: 'audio', format: 'mp3' };
    if (m.includes('audio/wav')) return { kind: 'audio', format: 'wav' };
    if (m.includes('audio/ogg')) return { kind: 'audio', format: 'ogg' };
  }

  return null;
}

export function getMimeTypeForAsset(kind: AssetKind, format: AssetFormat): string {
  if (kind === 'image') {
    if (format === 'svg') return 'image/svg+xml';
    if (format === 'jpg') return 'image/jpeg';
    return `image/${format}`;
  }
  if (kind === 'audio') {
    return `audio/${format === 'mp3' ? 'mpeg' : format}`;
  }
  if (format === 'glb') return 'model/gltf-binary';
  if (format === 'gltf') return 'model/gltf+json';
  return 'application/octet-stream';
}

async function probeImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number } | null> {
  if (typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function probeAudioDuration(buffer: ArrayBuffer): Promise<number | undefined> {
  if (typeof window === 'undefined') return undefined;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return undefined;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    return Number(decoded.duration.toFixed(2));
  } catch {
    return undefined;
  } finally {
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }
}

export interface PendingAssetDependencyInput {
  relativePath: string;
  kind: 'texture' | 'material' | 'binary';
  mimeType: string;
  buffer: ArrayBuffer;
}

/**
 * Validates, sanitizes, extracts real metadata, registers binary chunks in `binary_assets`,
 * and registers any companion texture / MTL / .bin dependencies in `asset_dependencies`.
 */
export async function processAndStoreAssetBuffer(params: {
  name: string;
  kind: AssetKind;
  format: AssetFormat;
  buffer: ArrayBuffer;
  sourceUrl?: string;
  tags?: string[];
  existingMeta?: Model3DMetadata;
  companionDependencies?: PendingAssetDependencyInput[];
}): Promise<RayanAsset> {
  const { name, kind, format, sourceUrl, tags, companionDependencies = [] } = params;
  let buffer = params.buffer;

  if (!buffer || buffer.byteLength === 0) {
    throw new Error(`فایل «${name}» خالی است.`);
  }

  if (!validateFileSize(buffer.byteLength, kind)) {
    throw new Error(`حجم فایل «${name}» بیش از حد مجاز است.`);
  }

  if (kind === 'image' && format === 'svg') {
    const rawSvg = new TextDecoder().decode(new Uint8Array(buffer));
    const cleanSvg = sanitizeSvg(rawSvg);
    if (!cleanSvg || !cleanSvg.includes('<svg')) {
      throw new Error(`فایل SVG «${name}» ساختار معتبر ندارد.`);
    }
    buffer = new TextEncoder().encode(cleanSvg).buffer;
  }

  const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cleanName = name.replace(/\.[^.]+$/, '') || 'asset';
  const mimeType = getMimeTypeForAsset(kind, format);
  const inlineDataUrl =
    buffer.byteLength <= 512 * 1024 ? arrayBufferToDataUrl(buffer, mimeType) : `idb://${assetId}`;

  // Build temporary dependency objects for Three.js parser validation before storing
  const tempDeps: StoredAssetDependency[] = companionDependencies.map((d) => ({
    id: `${assetId}::${d.relativePath}`,
    parentAssetId: assetId,
    relativePath: d.relativePath,
    kind: d.kind,
    mimeType: d.mimeType,
    sizeBytes: d.buffer.byteLength,
    checksumSha256: '',
    buffer: d.buffer,
    createdAt: Date.now(),
  }));

  let modelMeta: Model3DMetadata | undefined = params.existingMeta;
  let width: number | undefined;
  let height: number | undefined;
  let durationSeconds: number | undefined;

  if (kind === 'model3d') {
    const inspected = await parseAndInspect3DModelFile(buffer, format, '#38bdf8', tempDeps);
    modelMeta = inspected.meta;
  } else if (kind === 'image') {
    const previewUrl = inlineDataUrl.startsWith('data:')
      ? inlineDataUrl
      : arrayBufferToDataUrl(buffer, mimeType);
    const dims = await probeImageDimensions(previewUrl);
    if (dims) {
      width = dims.width;
      height = dims.height;
    }
  } else if (kind === 'audio') {
    durationSeconds = await probeAudioDuration(buffer);
  }

  const storedRecord = await registerBinaryModel({
    id: assetId,
    name: cleanName,
    kind,
    format,
    buffer,
    dataUrl: inlineDataUrl,
    modelMeta,
    note: sourceUrl ? `واردشده از URL: ${sourceUrl}` : 'واردشده از دیسک',
  });

  const savedDeps: AssetDependencyRef[] = [];
  for (const dep of companionDependencies) {
    const depRec = await registerAssetDependency(assetId, dep);
    savedDeps.push({
      id: depRec.id,
      relativePath: depRec.relativePath,
      kind: depRec.kind,
      mimeType: depRec.mimeType,
      sizeBytes: depRec.sizeBytes,
      checksumSha256: depRec.checksumSha256,
    });
  }

  return {
    id: assetId,
    name: cleanName,
    kind,
    format,
    dataUrl: storedRecord.dataUrl || inlineDataUrl,
    sizeBytes: buffer.byteLength,
    createdAt: storedRecord.createdAt,
    modelMeta,
    storedInIdb: true,
    sourceUrl,
    tags,
    width,
    height,
    durationSeconds,
    version: storedRecord.version || 1,
    checksumSha256: storedRecord.checksumSha256,
    chunkCount: storedRecord.chunkCount || 1,
    dependencies: savedDeps.length > 0 ? savedDeps : undefined,
    linkedSceneIds: storedRecord.linkedSceneIds || [],
    linkedSceneNodeIds: storedRecord.linkedSceneNodeIds || [],
    versionHistory: storedRecord.versionHistory,
  };
}

export interface BatchAssetImportResult {
  assets: RayanAsset[];
  errors: string[];
}

function normalizeAssetReferencePath(path: string): string {
  let decoded = path.replace(/\\/g, '/').replace(/[?#].*$/, '');
  try { decoded = decodeURIComponent(decoded); } catch { /* retain malformed path */ }
  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/').toLowerCase();
}

/** Resolve model-relative resources without mixing dependencies from other models. */
export function resolveModelDependencyPaths(
  modelPath: string,
  references: string[],
  candidatePaths: string[]
): string[] {
  const candidates = candidatePaths.map((original) => ({
    original,
    normalized: normalizeAssetReferencePath(original),
  }));
  const modelDir = normalizeAssetReferencePath(modelPath).split('/').slice(0, -1).join('/');
  const resolved: string[] = [];
  for (const reference of references) {
    if (!reference || /^(data:|https?:|blob:|\/\/)/i.test(reference)) continue;
    const joined = normalizeAssetReferencePath(modelDir ? modelDir + '/' + reference : reference);
    let match = candidates.find((candidate) => candidate.normalized === joined);
    if (!match) {
      const basename = joined.split('/').pop();
      const matches = candidates.filter((candidate) => candidate.normalized.split('/').pop() === basename);
      if (matches.length === 1) match = matches[0];
    }
    if (match && !resolved.includes(match.original)) resolved.push(match.original);
  }
  return resolved;
}

function extractObjMaterialReferences(source: string): string[] {
  return Array.from(source.matchAll(/^\s*mtllib\s+(.+?)\s*$/gim))
    .flatMap((match) => match[1].trim().split(/\s+/))
    .filter(Boolean);
}

function extractMtlTextureReferences(source: string): string[] {
  const commands = /^(?:map_[a-z0-9_]+|bump|norm|disp|decal)\s+(.+)$/gim;
  return Array.from(source.matchAll(commands))
    .map((match) => match[1].trim().split(/\s+/).pop() || '')
    .filter(Boolean);
}

function extractGltfResourceReferences(source: string): string[] {
  let doc: { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
  try { doc = JSON.parse(source); }
  catch { throw new Error('ساختار JSON فایل glTF معتبر نیست.'); }
  return [...(doc.buffers || []), ...(doc.images || [])]
    .map((resource) => resource.uri || '')
    .filter(Boolean);
}

async function collectModelCompanionDependencies(
  modelFile: File,
  selectedFiles: File[],
  format: AssetFormat
): Promise<PendingAssetDependencyInput[]> {
  const modelPath = modelFile.webkitRelativePath || modelFile.name;
  const candidatePaths = selectedFiles.map((file) => file.webkitRelativePath || file.name);
  let references: string[] = [];
  if (format === 'gltf') {
    references = extractGltfResourceReferences(new TextDecoder().decode(await modelFile.arrayBuffer()));
  } else if (format === 'obj') {
    references = extractObjMaterialReferences(new TextDecoder().decode(await modelFile.arrayBuffer()));
  } else if (format === 'fbx') {
    const source = new TextDecoder().decode(await modelFile.arrayBuffer());
    references = Array.from(source.matchAll(/["']([^"'\r\n]+\.(?:png|jpe?g|webp|tga|bmp|tif|tiff))["']/gi))
      .map((match) => match[1]);
  } else if (format === 'usd') {
    const source = new TextDecoder().decode(await modelFile.arrayBuffer());
    references = Array.from(source.matchAll(/@([^@]+\.(?:png|jpe?g|webp|bin|exr|hdr))@/gi))
      .map((match) => match[1]);
  }

  const selectedPaths = resolveModelDependencyPaths(modelPath, references, candidatePaths);
  const byPath = new Map(selectedFiles.map((file) => [file.webkitRelativePath || file.name, file] as const));
  const dependencies: PendingAssetDependencyInput[] = [];
  for (const path of selectedPaths) {
    const file = byPath.get(path);
    if (!file) continue;
    const lower = path.toLowerCase();
    const isMtl = lower.endsWith('.mtl');
    const isBinary = lower.endsWith('.bin');
    const extension = lower.split('.').pop() || '';
    dependencies.push({
      relativePath: path,
      kind: isMtl ? 'material' : isBinary ? 'binary' : 'texture',
      mimeType: isMtl ? 'text/plain' : isBinary ? 'application/octet-stream'
        : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/' + extension,
      buffer: await file.arrayBuffer(),
    });

    if (isMtl) {
      const mtlText = new TextDecoder().decode(dependencies[dependencies.length - 1].buffer);
      const texturePaths = resolveModelDependencyPaths(path, extractMtlTextureReferences(mtlText), candidatePaths);
      for (const texturePath of texturePaths) {
        if (dependencies.some((dependency) => dependency.relativePath === texturePath)) continue;
        const textureFile = byPath.get(texturePath);
        if (!textureFile) continue;
        const textureExt = texturePath.toLowerCase().split('.').pop() || '';
        dependencies.push({
          relativePath: texturePath,
          kind: 'texture',
          mimeType: textureExt === 'jpg' || textureExt === 'jpeg' ? 'image/jpeg' : 'image/' + textureExt,
          buffer: await textureFile.arrayBuffer(),
        });
      }
    }
  }
  return dependencies;
}

/**
 * Comprehensive multi-file importer:
 * - Pairs .obj with companion .mtl and texture files
 * - Pairs .gltf with companion .bin and texture files
 * - Extracts .zip archives and links companion dependencies
 */
export async function importAssetsFromFileList(
  fileList: FileList | File[]
): Promise<BatchAssetImportResult> {
  const files = Array.from(fileList);
  const assets: RayanAsset[] = [];
  const errors: string[] = [];


  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.mtl') || lower.endsWith('.bin')) continue;

    if (lower.endsWith('.zip')) {
      try {
        const zip = await JSZip.loadAsync(file);
        const res = await importZipPackage(file);

        // Also gather any .mtl / .bin / texture entries inside the ZIP for 3D models
        const zipCompanions: PendingAssetDependencyInput[] = [];
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue;
          const base = entry.name.split('/').pop() || entry.name;
          const ext = base.split('.').pop()?.toLowerCase() || '';
          if (ext === 'mtl') {
            zipCompanions.push({
              relativePath: entry.name,
              kind: 'material',
              mimeType: 'text/plain',
              buffer: await entry.async('arraybuffer'),
            });
          } else if (ext === 'bin') {
            zipCompanions.push({
              relativePath: entry.name,
              kind: 'binary',
              mimeType: 'application/octet-stream',
              buffer: await entry.async('arraybuffer'),
            });
          } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
            zipCompanions.push({
              relativePath: entry.name,
              kind: 'texture',
              mimeType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`,
              buffer: await entry.async('arraybuffer'),
            });
          }
        }

        if (res.assets.length === 0) {
          errors.push(`درون فایل زیپ «${file.name}» دارایی تصویر، مدل سه‌بعدی یا صوتی یافت نشد.`);
          continue;
        }
        for (const zipAsset of res.assets) {
          try {
            const buffer = dataUrlToArrayBuffer(zipAsset.dataUrl);
            const stored = await processAndStoreAssetBuffer({
              name: zipAsset.name,
              kind: zipAsset.kind,
              format: zipAsset.format,
              buffer,
              tags: ['ZIP'],
              companionDependencies: zipAsset.kind === 'model3d' ? zipCompanions : [],
            });
            assets.push(stored);
          } catch (err) {
            errors.push(
              `خطا در دارایی «${zipAsset.name}» از زیپ: ${err instanceof Error ? err.message : 'نامعتبر'}`
            );
          }
        }
      } catch (err) {
        errors.push(
          `خطا در خواندن فایل زیپ «${file.name}»: ${err instanceof Error ? err.message : 'خطای نامشخص'}`
        );
      }
      continue;
    }

    const detected = detectAssetKindAndFormat(file.name, file.type);
    if (!detected) {
      errors.push(
        `فرمت فایل «${file.name}» پشتیبانی نمی‌شود. فرمت‌های مجاز: PNG, JPG, WEBP, SVG, GLB, GLTF(+BIN), FBX, OBJ(+MTL), STL, USD/USDZ, PLY, MP3, WAV, OGG, ZIP`
      );
      continue;
    }

    try {
      const buffer = await file.arrayBuffer();
      const companionDependencies =
        detected.kind === 'model3d'
          ? await collectModelCompanionDependencies(file, files, detected.format)
          : [];
      const imported = await processAndStoreAssetBuffer({
        name: file.name,
        kind: detected.kind,
        format: detected.format,
        buffer,
        tags: companionDependencies.length > 0 ? ['همراه با وابستگی'] : undefined,
        companionDependencies,
      });
      assets.push(imported);
    } catch (err) {
      errors.push(
        `خطا در پردازش «${file.name}»: ${err instanceof Error ? err.message : 'فایل نامعتبر است'}`
      );
    }
  }

  return { assets, errors };
}

/**
 * Replaces an existing asset's binary with a newer file version, validating geometry and recording SHA-256 history.
 */
export async function updateAssetWithNewFileVersion(
  asset: RayanAsset,
  file: File,
  note = 'به‌روزرسانی فایل از دیسک'
): Promise<RayanAsset> {
  const buffer = await file.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('فایل نسخه جدید خالی است.');
  }

  const detected = detectAssetKindAndFormat(file.name, file.type);
  const targetFormat =
    detected && detected.kind === asset.kind ? detected.format : asset.format;

  let updatedMeta = asset.modelMeta;
  if (asset.kind === 'model3d') {
    const retrieved = await retrieveBinaryModel(asset.id).catch(() => null);
    const inspected = await parseAndInspect3DModelFile(
      buffer,
      targetFormat,
      '#38bdf8',
      retrieved?.dependencies || []
    );
    updatedMeta = inspected.meta;
  }

  const updatedRec = await bumpAssetVersion(asset.id, buffer, note, updatedMeta);
  return {
    ...asset,
    format: targetFormat,
    dataUrl: updatedRec.dataUrl || asset.dataUrl,
    sizeBytes: updatedRec.sizeBytes,
    modelMeta: updatedRec.modelMeta,
    version: updatedRec.version,
    checksumSha256: updatedRec.checksumSha256,
    chunkCount: updatedRec.chunkCount,
    versionHistory: updatedRec.versionHistory,
  };
}

/**
 * Fetches an external asset directly from an HTTPS/HTTP URL, validates its binary content,
 * and stores it offline inside IndexedDB `binary_assets`.
 */
export async function importAssetFromExternalUrl(rawUrl: string): Promise<RayanAsset> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error('آدرس URL واردشده معتبر نیست.');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('فقط آدرس‌های http و https پشتیبانی می‌شوند.');
  }

  const response = await fetch(parsedUrl.toString());
  if (!response.ok) {
    throw new Error(`دریافت فایل از سرور ناموفق بود (کد وضعیت ${response.status}).`);
  }

  const contentType = response.headers.get('content-type') || '';
  const pathName = parsedUrl.pathname.split('/').pop() || 'remote_asset';
  const detected = detectAssetKindAndFormat(pathName, contentType);
  if (!detected) {
    throw new Error(
      `فرمت فایل آدرس «${pathName}» قابل تشخیص یا پشتیبانی نیست (نوع محتوا: ${contentType || 'نامشخص'}).`
    );
  }

  const buffer = await response.arrayBuffer();
  return processAndStoreAssetBuffer({
    name: pathName,
    kind: detected.kind,
    format: detected.format,
    buffer,
    sourceUrl: parsedUrl.toString(),
    tags: ['URL'],
  });
}

/**
 * Converts a starter procedural 3D preset into a real binary GLB asset stored in IndexedDB.
 */
export async function bakeProceduralPresetToGlbAsset(
  preset: Model3DPresetType,
  label: string,
  primaryHex = '#38bdf8'
): Promise<RayanAsset> {
  const group = buildProceduralPresetGroup(preset, primaryHex);
  const exporter = new GLTFExporter();

  const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          const jsonBytes = new TextEncoder().encode(JSON.stringify(result));
          resolve(jsonBytes.buffer);
        }
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true }
    );
  });

  return processAndStoreAssetBuffer({
    name: `${label}.glb`,
    kind: 'model3d',
    format: 'glb',
    buffer: glbBuffer,
    tags: ['GLB استاندارد'],
  });
}

/**
 * Downloads an individual asset (including chunked large models) to the user's computer.
 */
export async function downloadAssetToDisk(asset: RayanAsset): Promise<void> {
  let buffer: ArrayBuffer | null = null;
  const retrieved = await retrieveBinaryModel(asset.id).catch(() => null);
  if (retrieved) {
    buffer = retrieved.buffer;
  } else if (asset.dataUrl && !asset.dataUrl.startsWith('idb://')) {
    buffer = dataUrlToArrayBuffer(asset.dataUrl);
  } else {
    const rec = await getAssetFromDb(asset.id);
    if (rec?.buffer) buffer = rec.buffer;
  }

  if (!buffer) {
    throw new Error(`داده باینری «${asset.name}» یافت نشد.`);
  }

  const mime = getMimeTypeForAsset(asset.kind, asset.format);
  const blob = new Blob([buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${asset.name.replace(/[\\/:*?"<>|]/g, '_')}.${asset.format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Packages all project assets + companion texture/MTL/bin dependencies into a downloadable ZIP pack.
 */
export async function exportAssetsPackZip(
  projectName: string,
  assets: RayanAsset[]
): Promise<void> {
  const zip = new JSZip();
  const manifest: Array<Record<string, unknown>> = [];

  for (const asset of assets) {
    let buffer: ArrayBuffer | null = null;
    let deps: StoredAssetDependency[] = [];

    const retrieved = await retrieveBinaryModel(asset.id).catch(() => null);
    if (retrieved) {
      buffer = retrieved.buffer;
      deps = retrieved.dependencies;
    } else if (asset.dataUrl && !asset.dataUrl.startsWith('idb://')) {
      buffer = dataUrlToArrayBuffer(asset.dataUrl);
    }

    if (!buffer) continue;

    const folder =
      asset.kind === 'model3d' ? 'models' : asset.kind === 'image' ? 'images' : 'audio';
    const fileName = `${asset.name.replace(/[\\/:*?"<>|]/g, '_')}.${asset.format}`;
    zip.file(`${folder}/${fileName}`, buffer);

    for (const dep of deps) {
      zip.file(`${folder}/dependencies/${asset.id}/${dep.relativePath}`, dep.buffer);
    }

    manifest.push({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      format: asset.format,
      version: asset.version || 1,
      checksumSha256: asset.checksumSha256,
      sizeBytes: buffer.byteLength,
      path: `${folder}/${fileName}`,
      dependencies: deps.map((d) => ({
        relativePath: d.relativePath,
        kind: d.kind,
        sizeBytes: d.sizeBytes,
        checksumSha256: d.checksumSha256,
      })),
      linkedSceneIds: asset.linkedSceneIds || [],
      linkedSceneNodeIds: asset.linkedSceneNodeIds || [],
      modelMeta: asset.modelMeta,
    });
  }

  zip.file('assets-manifest.json', JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(projectName || 'rayan').replace(/\s+/g, '_')}-assets-pack.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

/**
 * Computes genuine IndexedDB storage telemetry across `binary_assets`, `asset_chunks`, and `asset_dependencies`.
 */
export async function getAssetStorageStats(): Promise<AssetStorageStats> {
  let totalAssetRecordsInIdb = 0;
  let totalBytesInIdb = 0;
  let chunkedAssetsCount = 0;
  let totalDependenciesCount = 0;

  try {
    const [records, deps] = await Promise.all([
      listAssetsFromDb(),
      listAllAssetDependenciesFromDb(),
    ]);
    totalAssetRecordsInIdb = records.length;
    chunkedAssetsCount = records.filter((r) => r.chunked).length;
    totalDependenciesCount = deps.length;
    totalBytesInIdb =
      records.reduce((sum, rec) => sum + (rec.sizeBytes || rec.buffer?.byteLength || 0), 0) +
      deps.reduce((sum, d) => sum + d.sizeBytes, 0);
  } catch {
    // IndexedDB unavailable in non-browser environment
  }

  let browserQuotaBytes: number | undefined;
  let browserUsageBytes: number | undefined;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      browserQuotaBytes = est.quota;
      browserUsageBytes = est.usage;
    } catch {
      // ignore
    }
  }

  return {
    totalAssetRecordsInIdb,
    totalBytesInIdb,
    chunkedAssetsCount,
    totalDependenciesCount,
    browserQuotaBytes,
    browserUsageBytes,
  };
}
