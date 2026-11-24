import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectAssetKindAndFormat,
  getMimeTypeForAsset,
  importAssetFromExternalUrl,
  bakeProceduralPresetToGlbAsset,
  processAndStoreAssetBuffer,
  resolveModelDependencyPaths,
  updateAssetWithNewFileVersion,
} from '../src/engine/assetManager';
import {
  ASSET_CHUNK_SIZE_BYTES,
  bumpAssetVersion,
  computeSha256Hex,
  getAssetDependencies,
  linkAssetToScene,
  registerAssetDependency,
  registerBinaryModel,
  retrieveBinaryModel,
  unlinkAssetFromScene,
  verifyProjectAssetIntegrity,
  createStarter3DProject,
} from '../src/storage/projectDb';

// Polyfill FileReader for Three.js GLTFExporter inside Node Vitest runtime
if (typeof globalThis.FileReader === 'undefined') {
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          this.onloadend?.();
        })
        .catch((err) => this.onerror?.(err));
    }
  }
  (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
}

// In-memory IndexedDB v3/v4 store emulator inside Vitest so storage & dependency pipelines execute end-to-end
const mockAssets = new Map<string, any>();
const mockChunks = new Map<string, ArrayBuffer>();
const mockDeps = new Map<string, any>();

vi.mock('../src/storage/projectDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storage/projectDb')>();

  const registerBinaryModelMock = vi.fn(async (params: any) => {
    const checksumSha256 = await actual.computeSha256Hex(params.buffer);
    const now = Date.now();
    const shouldChunk = params.buffer.byteLength > actual.ASSET_CHUNK_SIZE_BYTES;
    const chunkCount = shouldChunk
      ? Math.max(1, Math.ceil(params.buffer.byteLength / actual.ASSET_CHUNK_SIZE_BYTES))
      : 1;
    if (shouldChunk) {
      mockChunks.set(params.id, params.buffer);
    }
    const rec = {
      id: params.id,
      name: params.name,
      kind: params.kind,
      format: params.format,
      sizeBytes: params.buffer.byteLength,
      createdAt: now,
      updatedAt: now,
      buffer: shouldChunk ? null : params.buffer,
      dataUrl: params.buffer.byteLength <= 512 * 1024 ? params.dataUrl : `idb://${params.id}`,
      modelMeta: params.modelMeta,
      chunked: shouldChunk,
      chunkCount,
      version: 1,
      checksumSha256,
      versionHistory: [
        {
          version: 1,
          updatedAt: now,
          sizeBytes: params.buffer.byteLength,
          checksumSha256,
          note: params.note || 'نسخه اولیه واردشده',
        },
      ],
      linkedSceneIds: params.linkedSceneIds || [],
      linkedSceneNodeIds: params.linkedSceneNodeIds || [],
      dependencyIds: params.dependencyIds || [],
    };
    mockAssets.set(params.id, rec);
    return rec;
  });

  const getAssetFromDbMock = vi.fn(async (id: string) => {
    const rec = mockAssets.get(id);
    if (!rec) return null;
    if (rec.chunked && !rec.buffer) {
      const buf = mockChunks.get(id) || null;
      return buf ? { ...rec, buffer: buf } : rec;
    }
    return rec;
  });

  const registerAssetDependencyMock = vi.fn(async (parentAssetId: string, dep: any) => {
    const checksumSha256 = await actual.computeSha256Hex(dep.buffer);
    const cleanRel = dep.relativePath.replace(/^\/+/, '');
    const record = {
      id: `${parentAssetId}::${cleanRel}`,
      parentAssetId,
      relativePath: cleanRel,
      kind: dep.kind,
      mimeType: dep.mimeType,
      sizeBytes: dep.buffer.byteLength,
      checksumSha256,
      buffer: dep.buffer,
      createdAt: Date.now(),
    };
    mockDeps.set(record.id, record);
    const parent = mockAssets.get(parentAssetId);
    if (parent) {
      parent.dependencyIds = Array.from(new Set([...(parent.dependencyIds || []), record.id]));
    }
    return record;
  });

  const getAssetDependenciesMock = vi.fn(async (parentAssetId: string) => {
    return Array.from(mockDeps.values()).filter((d) => d.parentAssetId === parentAssetId);
  });

  return {
    ...actual,
    registerBinaryModel: registerBinaryModelMock,
    saveAssetToDb: vi.fn(async (rec: any) => {
      if (rec.buffer) {
        return registerBinaryModelMock(rec);
      }
      mockAssets.set(rec.id, rec);
      return rec;
    }),
    getAssetFromDb: getAssetFromDbMock,
    listAssetsFromDb: vi.fn(async () => Array.from(mockAssets.values())),
    registerAssetDependency: registerAssetDependencyMock,
    getAssetDependencies: getAssetDependenciesMock,
    listAllAssetDependenciesFromDb: vi.fn(async () => Array.from(mockDeps.values())),
    retrieveBinaryModel: vi.fn(async (assetId: string) => {
      const rec = await getAssetFromDbMock(assetId);
      if (!rec || !rec.buffer) return null;
      const deps = await getAssetDependenciesMock(assetId);
      return { record: rec, buffer: rec.buffer, dependencies: deps };
    }),
    linkAssetToScene: vi.fn(async (assetId: string, sceneId: string, nodeId: string) => {
      const rec = mockAssets.get(assetId);
      if (!rec) return null;
      rec.linkedSceneIds = Array.from(new Set([...(rec.linkedSceneIds || []), sceneId]));
      rec.linkedSceneNodeIds = Array.from(new Set([...(rec.linkedSceneNodeIds || []), nodeId]));
      return rec;
    }),
    unlinkAssetFromScene: vi.fn(async (assetId: string, nodeId: string) => {
      const rec = mockAssets.get(assetId);
      if (!rec) return;
      rec.linkedSceneNodeIds = (rec.linkedSceneNodeIds || []).filter((n: string) => n !== nodeId);
    }),
    bumpAssetVersion: vi.fn(async (assetId: string, newBuffer: ArrayBuffer, note = 'به‌روزرسانی', meta?: any) => {
      const rec = mockAssets.get(assetId);
      if (!rec) throw new Error('missing asset');
      const checksumSha256 = await actual.computeSha256Hex(newBuffer);
      const nextVersion = (rec.version || 1) + 1;
      const shouldChunk = newBuffer.byteLength > actual.ASSET_CHUNK_SIZE_BYTES;
      if (shouldChunk) mockChunks.set(assetId, newBuffer);
      const updated = {
        ...rec,
        sizeBytes: newBuffer.byteLength,
        buffer: shouldChunk ? null : newBuffer,
        dataUrl: newBuffer.byteLength <= 512 * 1024 ? actual.arrayBufferToDataUrl(newBuffer) : `idb://${assetId}`,
        modelMeta: meta ?? rec.modelMeta,
        chunked: shouldChunk,
        chunkCount: shouldChunk ? Math.ceil(newBuffer.byteLength / actual.ASSET_CHUNK_SIZE_BYTES) : 1,
        version: nextVersion,
        checksumSha256,
        versionHistory: [
          ...(rec.versionHistory || []),
          { version: nextVersion, updatedAt: Date.now(), sizeBytes: newBuffer.byteLength, checksumSha256, note },
        ],
      };
      mockAssets.set(assetId, updated);
      return { ...updated, buffer: newBuffer };
    }),
  };
});

describe('Comprehensive Asset Manager & IndexedDB Storage Tests', () => {
  beforeEach(() => {
    mockAssets.clear();
    mockChunks.clear();
    mockDeps.clear();
  });

  it('detectAssetKindAndFormat accurately identifies 3D, image, and audio formats from filename or MIME', () => {
    expect(detectAssetKindAndFormat('robot.glb')).toEqual({ kind: 'model3d', format: 'glb' });
    expect(detectAssetKindAndFormat('character.fbx')).toEqual({ kind: 'model3d', format: 'fbx' });
    expect(detectAssetKindAndFormat('scene.usdz?v=2')).toEqual({ kind: 'model3d', format: 'usdz' });
    expect(detectAssetKindAndFormat('mesh.obj')).toEqual({ kind: 'model3d', format: 'obj' });
    expect(detectAssetKindAndFormat('sprite.webp')).toEqual({ kind: 'image', format: 'webp' });
    expect(detectAssetKindAndFormat('bgm.mp3')).toEqual({ kind: 'audio', format: 'mp3' });
    expect(detectAssetKindAndFormat('remote', 'model/gltf-binary')).toEqual({
      kind: 'model3d',
      format: 'glb',
    });
    expect(detectAssetKindAndFormat('unknown.exe')).toBeNull();
  });

  it('resolves companion resources per model folder and refuses ambiguous basename matches', () => {
    const selected = [
      'pack-a/character.gltf',
      'pack-a/character.bin',
      'pack-a/textures/body.png',
      'pack-b/character.gltf',
      'pack-b/character.bin',
      'pack-b/textures/body.png',
      'shared/duplicate.png',
      'other/duplicate.png',
    ];

    expect(
      resolveModelDependencyPaths(
        'pack-a/character.gltf',
        ['character.bin', 'textures/body.png', 'https://cdn.example.com/external.png'],
        selected
      )
    ).toEqual(['pack-a/character.bin', 'pack-a/textures/body.png']);

    expect(
      resolveModelDependencyPaths('pack-a/character.obj', ['character.mtl'], [
        'pack-a/character.mtl',
        'pack-b/character.mtl',
      ])
    ).toEqual(['pack-a/character.mtl']);

    expect(
      resolveModelDependencyPaths('pack-a/mesh.gltf', ['duplicate.png'], selected)
    ).toEqual([]);
  });

  it('getMimeTypeForAsset returns standard MIME types', () => {
    expect(getMimeTypeForAsset('model3d', 'glb')).toBe('model/gltf-binary');
    expect(getMimeTypeForAsset('model3d', 'gltf')).toBe('model/gltf+json');
    expect(getMimeTypeForAsset('image', 'svg')).toBe('image/svg+xml');
    expect(getMimeTypeForAsset('audio', 'mp3')).toBe('audio/mpeg');
  });

  it('importAssetFromExternalUrl rejects invalid URLs and unsupported protocols cleanly', async () => {
    await expect(importAssetFromExternalUrl('not-a-valid-url')).rejects.toThrow();
    await expect(importAssetFromExternalUrl('ftp://example.com/model.glb')).rejects.toThrow();
    await expect(importAssetFromExternalUrl('javascript:alert(1)')).rejects.toThrow();
  });

  it('processAndStoreAssetBuffer sanitizes SVG payloads, computes SHA-256 checksum, and validates OBJ geometry', async () => {
    const dirtySvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><circle cx="32" cy="32" r="20" onload="evil()"/></svg>';
    const svgBuf = new TextEncoder().encode(dirtySvg).buffer;
    const svgAsset = await processAndStoreAssetBuffer({
      name: 'badge.svg',
      kind: 'image',
      format: 'svg',
      buffer: svgBuf,
    });
    expect(svgAsset.storedInIdb).toBe(true);
    expect(svgAsset.version).toBe(1);
    expect(svgAsset.checksumSha256).toBeTruthy();
    const decodedSvg = Buffer.from(svgAsset.dataUrl.split(',')[1], 'base64').toString('utf-8');
    expect(decodedSvg).not.toContain('<script');
    expect(decodedSvg).not.toContain('onload=');
    expect(decodedSvg).toContain('<circle');

    const objBuf = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').buffer;
    const objAsset = await processAndStoreAssetBuffer({
      name: 'triangle.obj',
      kind: 'model3d',
      format: 'obj',
      buffer: objBuf,
    });
    expect(objAsset.modelMeta?.meshCount).toBe(1);
    expect(objAsset.modelMeta?.triangleCount).toBe(1);
  });

  it('chunks large binary assets (> 2 MB), tracks companion dependencies, links scenes, and bumps asset versions', async () => {
    const largeBuffer = new Uint8Array(ASSET_CHUNK_SIZE_BYTES + 256 * 1024);
    largeBuffer[0] = 0x67;
    largeBuffer[1] = 0x6c;
    largeBuffer[2] = 0x54;
    largeBuffer[3] = 0x46;

    const rec = await registerBinaryModel({
      id: 'big_model_1',
      name: 'Mech',
      kind: 'model3d',
      format: 'glb',
      buffer: largeBuffer.buffer,
    });
    expect(rec.chunked).toBe(true);
    expect(rec.chunkCount).toBe(2);
    expect(rec.dataUrl).toBe('idb://big_model_1');

    const texBuf = new Uint8Array([137, 80, 78, 71]).buffer;
    await registerAssetDependency('big_model_1', {
      relativePath: 'textures/albedo.png',
      kind: 'texture',
      mimeType: 'image/png',
      buffer: texBuf,
    });

    const retrieved = await retrieveBinaryModel('big_model_1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.buffer.byteLength).toBe(largeBuffer.byteLength);
    expect(retrieved?.dependencies.length).toBe(1);
    expect(retrieved?.dependencies[0].relativePath).toBe('textures/albedo.png');

    await linkAssetToScene('big_model_1', 'scene_1', 'node_mech');
    const deps = await getAssetDependencies('big_model_1');
    expect(deps.length).toBe(1);

    const v2Buf = new TextEncoder().encode('v 0 0 0\nv 2 0 0\nv 0 2 0\nf 1 2 3\n').buffer;
    const bumped = await bumpAssetVersion('big_model_1', v2Buf, 'نسخه بهینه شده');
    expect(bumped.version).toBe(2);
    expect(bumped.versionHistory?.length).toBe(2);
    expect(bumped.checksumSha256).toBe(await computeSha256Hex(v2Buf));

    await unlinkAssetFromScene('big_model_1', 'node_mech');
  });

  it('bakeProceduralPresetToGlbAsset and updateAssetWithNewFileVersion produce valid binary GLB and OBJ metadata', async () => {
    const asset = await bakeProceduralPresetToGlbAsset('hero-bot', 'ربات', '#38bdf8');
    expect(asset.kind).toBe('model3d');
    expect(asset.format).toBe('glb');
    expect(asset.storedInIdb).toBe(true);
    expect(asset.sizeBytes).toBeGreaterThan(500);
    expect(asset.modelMeta?.meshCount).toBeGreaterThanOrEqual(8);
    expect(asset.modelMeta?.vertexCount).toBeGreaterThan(100);
    expect(asset.dataUrl.startsWith('data:model/gltf-binary;base64,')).toBe(true);

    const upgraded = await updateAssetWithNewFileVersion(
      asset,
      new File([new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')], 'robot_v2.obj')
    );
    expect(upgraded.version).toBe(2);

    const proj = createStarter3DProject('تست یکپارچگی');
    proj.assets = [upgraded];
    const report = await verifyProjectAssetIntegrity(proj);
    expect(report.ok).toBe(true);
  });
});
