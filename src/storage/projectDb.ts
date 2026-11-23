import type {
  AssetFormat,
  AssetKind,
  CodeFileItem,
  GameScene,
  Model3DMetadata,
  RayanProject,
  TileType,
  UIDataRecord,
} from '../types/studio';
import { parsePersianRules } from '../engine/ruleParser';

export function createDefaultCodeFiles(projectName = 'بازی رایان'): CodeFileItem[] {
  const now = Date.now();
  return [
    {
      id: 'code_game_hooks',
      name: 'gameHooks.js',
      path: 'scripts/gameHooks.js',
      language: 'javascript',
      enabledInRuntime: true,
      updatedAt: now,
      content: `// اسکریپت اختصاصی بازی — مستقیماً در موتور بازی و خروجی اجرا می‌شود
// ابزارهای در دسترس روی شیء api:
// api.score, api.addScore(n), api.health, api.setHealth(n)
// api.vars, api.setVar(name, val), api.findEntity(name), api.moveEntity(name, vx, vy)
// api.showMessage(text), api.playSound(name), api.log(text), api.elapsed

function onStart(api) {
  api.log('اسکریپت gameHooks.js برای ${projectName.replace(/'/g, '')} فعال شد');
}

function onUpdate(api, dt) {
  // مثال: هر ۳۰ ثانیه ۱ امتیاز بقا اضافه شود (می‌توانید کد دلخواه خود را بنویسید)
}
`,
    },
    {
      id: 'code_custom_hud',
      name: 'customHud.css',
      path: 'styles/customHud.css',
      language: 'css',
      enabledInRuntime: true,
      updatedAt: now,
      content: `/* استایل‌های سفارشی برای کادرهای متن و دکمه‌های HUD بازی */
.rayan-hud-glow {
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.25);
}
`,
    },
    {
      id: 'code_game_config',
      name: 'gameConfig.json',
      path: 'config/gameConfig.json',
      language: 'json',
      enabledInRuntime: false,
      updatedAt: now,
      content: JSON.stringify(
        {
          studio: 'Rayan Game Studio',
          version: '1.0.0',
          difficulty: 'normal',
          enableCustomScripts: true,
        },
        null,
        2
      ),
    },
  ];
}

const DB_NAME = 'rayan_game_studio_db';
const DB_VERSION = 4;
const STORE_PROJECTS = 'projects';
const STORE_ASSETS = 'binary_assets';
const STORE_LEGACY_ASSETS = 'assets';
const STORE_ASSET_CHUNKS = 'asset_chunks';
const STORE_ASSET_DEPS = 'asset_dependencies';
const STORE_APP_RECORDS = 'app_records';

export const ASSET_CHUNK_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB per chunk for large binary files
const INLINE_DATA_URL_THRESHOLD = 512 * 1024; // 512 KB

export interface StoredAssetRecord {
  id: string;
  name: string;
  kind: AssetKind;
  format: AssetFormat;
  sizeBytes: number;
  createdAt: number;
  updatedAt?: number;
  /** Inline buffer for small files; null/empty when chunked into asset_chunks */
  buffer?: ArrayBuffer | null;
  dataUrl?: string;
  modelMeta?: Model3DMetadata;
  chunked?: boolean;
  chunkCount?: number;
  version?: number;
  checksumSha256?: string;
  versionHistory?: Array<{
    version: number;
    updatedAt: number;
    sizeBytes: number;
    checksumSha256: string;
    note?: string;
  }>;
  linkedSceneIds?: string[];
  linkedSceneNodeIds?: string[];
  dependencyIds?: string[];
}

export interface StoredAssetChunk {
  key: string; // `${assetId}::${chunkIndex}`
  assetId: string;
  chunkIndex: number;
  data: ArrayBuffer;
}

export interface StoredAssetDependency {
  id: string; // `${parentAssetId}::${relativePath}`
  parentAssetId: string;
  relativePath: string;
  kind: 'texture' | 'material' | 'binary';
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  buffer: ArrayBuffer;
  createdAt: number;
}

export interface RetrievedBinaryModel {
  record: StoredAssetRecord;
  buffer: ArrayBuffer;
  dependencies: StoredAssetDependency[];
}

export interface ProjectAssetIntegrityReport {
  ok: boolean;
  totalReferencedAssets: number;
  missingAssets: Array<{ assetId: string; referencedBy: string }>;
  unlinkedAssets: string[];
  chunkedModelsCount: number;
  totalDependenciesCount: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;

      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const assetStore = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        assetStore.createIndex('kind', 'kind', { unique: false });
        assetStore.createIndex('checksumSha256', 'checksumSha256', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_ASSET_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_ASSET_CHUNKS, { keyPath: 'key' });
        chunkStore.createIndex('assetId', 'assetId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_ASSET_DEPS)) {
        const depStore = db.createObjectStore(STORE_ASSET_DEPS, { keyPath: 'id' });
        depStore.createIndex('parentAssetId', 'parentAssetId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_APP_RECORDS)) {
        const recStore = db.createObjectStore(STORE_APP_RECORDS, { keyPath: 'id' });
        recStore.createIndex('collectionKey', ['projectId', 'collectionId'], { unique: false });
      }

      // Migrate legacy v2 'assets' store into 'binary_assets' without data loss
      if (
        event.oldVersion < 3 &&
        tx &&
        db.objectStoreNames.contains(STORE_LEGACY_ASSETS) &&
        db.objectStoreNames.contains(STORE_ASSETS)
      ) {
        const oldStore = tx.objectStore(STORE_LEGACY_ASSETS);
        const newStore = tx.objectStore(STORE_ASSETS);
        const cursorReq = oldStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            newStore.put(cursor.value);
            cursor.continue();
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listAppRecords(
  projectId: string,
  collectionId: string
): Promise<UIDataRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_APP_RECORDS, 'readonly');
    const store = tx.objectStore(STORE_APP_RECORDS);
    const idx = store.index('collectionKey');
    const req = idx.getAll([projectId, collectionId]);
    req.onsuccess = () => {
      const rows = ((req.result as UIDataRecord[]) || []).sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putAppRecord(
  projectId: string,
  collectionId: string,
  data: Record<string, string | number | boolean>,
  existingId?: string
): Promise<UIDataRecord> {
  const db = await openDb();
  const now = Date.now();
  const id = existingId || `rec_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const record: UIDataRecord = {
    id,
    projectId,
    collectionId,
    data: { ...data },
    createdAt: now,
    updatedAt: now,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_APP_RECORDS, 'readwrite');
    tx.objectStore(STORE_APP_RECORDS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return record;
}

export async function deleteAppRecord(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_APP_RECORDS, 'readwrite');
    tx.objectStore(STORE_APP_RECORDS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAppCollection(
  projectId: string,
  collectionId: string
): Promise<void> {
  const rows = await listAppRecords(projectId, collectionId);
  if (rows.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_APP_RECORDS, 'readwrite');
    const store = tx.objectStore(STORE_APP_RECORDS);
    rows.forEach((r) => store.delete(r.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall through to deterministic FNV-1a 64-bit hex digest
    }
  }
  const bytes = new Uint8Array(buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= bytes[i] ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType = 'application/octet-stream'): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function writeChunksForAsset(
  db: IDBDatabase,
  assetId: string,
  buffer: ArrayBuffer
): Promise<number> {
  const totalBytes = buffer.byteLength;
  const chunkCount = Math.max(1, Math.ceil(totalBytes / ASSET_CHUNK_SIZE_BYTES));

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSET_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_ASSET_CHUNKS);
    const idx = store.index('assetId');
    const getKeysReq = idx.getAllKeys(assetId);

    getKeysReq.onsuccess = () => {
      const existingKeys = getKeysReq.result || [];
      existingKeys.forEach((k) => store.delete(k));

      for (let i = 0; i < chunkCount; i++) {
        const start = i * ASSET_CHUNK_SIZE_BYTES;
        const end = Math.min(totalBytes, start + ASSET_CHUNK_SIZE_BYTES);
        const slice = buffer.slice(start, end);
        const chunkRecord: StoredAssetChunk = {
          key: `${assetId}::${i}`,
          assetId,
          chunkIndex: i,
          data: slice,
        };
        store.put(chunkRecord);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return chunkCount;
}

async function readChunksForAsset(db: IDBDatabase, assetId: string): Promise<ArrayBuffer | null> {
  const chunks = await new Promise<StoredAssetChunk[]>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSET_CHUNKS, 'readonly');
    const store = tx.objectStore(STORE_ASSET_CHUNKS);
    const idx = store.index('assetId');
    const req = idx.getAll(assetId);
    req.onsuccess = () => resolve((req.result as StoredAssetChunk[]) || []);
    req.onerror = () => reject(req.error);
  });

  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  const totalLength = chunks.reduce((sum, c) => sum + c.data.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const ch of chunks) {
    combined.set(new Uint8Array(ch.data), offset);
    offset += ch.data.byteLength;
  }
  return combined.buffer;
}

/**
 * Registers or updates a binary asset/3D model in `binary_assets`.
 * Automatically splits large buffers (> 2 MB) into `asset_chunks`, computes SHA-256 checksum,
 * and initializes version tracking.
 */
export async function registerBinaryModel(params: {
  id: string;
  name: string;
  kind: AssetKind;
  format: AssetFormat;
  buffer: ArrayBuffer;
  dataUrl?: string;
  modelMeta?: Model3DMetadata;
  linkedSceneIds?: string[];
  linkedSceneNodeIds?: string[];
  dependencyIds?: string[];
  note?: string;
}): Promise<StoredAssetRecord> {
  const db = await openDb();
  const checksumSha256 = await computeSha256Hex(params.buffer);
  const now = Date.now();
  const shouldChunk = params.buffer.byteLength > ASSET_CHUNK_SIZE_BYTES;
  let chunkCount = 1;

  if (shouldChunk) {
    chunkCount = await writeChunksForAsset(db, params.id, params.buffer);
  }

  const record: StoredAssetRecord = {
    id: params.id,
    name: params.name,
    kind: params.kind,
    format: params.format,
    sizeBytes: params.buffer.byteLength,
    createdAt: now,
    updatedAt: now,
    buffer: shouldChunk ? null : params.buffer,
    dataUrl:
      params.buffer.byteLength <= INLINE_DATA_URL_THRESHOLD
        ? params.dataUrl
        : `idb://${params.id}`,
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

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_ASSETS);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAssetToDb(record: StoredAssetRecord): Promise<StoredAssetRecord> {
  if (record.buffer && record.buffer.byteLength > 0) {
    return registerBinaryModel({
      id: record.id,
      name: record.name,
      kind: record.kind,
      format: record.format,
      buffer: record.buffer,
      dataUrl: record.dataUrl,
      modelMeta: record.modelMeta,
      linkedSceneIds: record.linkedSceneIds,
      linkedSceneNodeIds: record.linkedSceneNodeIds,
      dependencyIds: record.dependencyIds,
    });
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_ASSETS);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function getAssetFromDb(id: string): Promise<StoredAssetRecord | null> {
  const db = await openDb();
  const record = await new Promise<StoredAssetRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const store = tx.objectStore(STORE_ASSETS);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as StoredAssetRecord | undefined) || null);
    req.onerror = () => reject(req.error);
  });

  if (!record) return null;
  if (record.chunked && !record.buffer) {
    const reassembled = await readChunksForAsset(db, id);
    if (reassembled) {
      return { ...record, buffer: reassembled };
    }
  }
  return record;
}

/**
 * Registers a texture, MTL material file, or external .bin buffer dependency linked to a 3D model.
 */
export async function registerAssetDependency(
  parentAssetId: string,
  dep: {
    relativePath: string;
    kind: 'texture' | 'material' | 'binary';
    mimeType: string;
    buffer: ArrayBuffer;
  }
): Promise<StoredAssetDependency> {
  const db = await openDb();
  const checksumSha256 = await computeSha256Hex(dep.buffer);
  const cleanRel = dep.relativePath.replace(/^\/+/, '');
  const record: StoredAssetDependency = {
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

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSET_DEPS, 'readwrite');
    const store = tx.objectStore(STORE_ASSET_DEPS);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Update parent dependencyIds list if parent exists
  const parent = await getAssetFromDb(parentAssetId);
  if (parent) {
    const nextDeps = Array.from(new Set([...(parent.dependencyIds || []), record.id]));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      const store = tx.objectStore(STORE_ASSETS);
      store.put({
        ...parent,
        buffer: parent.chunked ? null : parent.buffer,
        dependencyIds: nextDeps,
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return record;
}

export async function getAssetDependencies(
  parentAssetId: string
): Promise<StoredAssetDependency[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSET_DEPS, 'readonly');
    const store = tx.objectStore(STORE_ASSET_DEPS);
    const idx = store.index('parentAssetId');
    const req = idx.getAll(parentAssetId);
    req.onsuccess = () => resolve((req.result as StoredAssetDependency[]) || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Dedicated retrieval method for 3D models: reassembles chunked binaries and resolves all dependencies.
 */
export async function retrieveBinaryModel(assetId: string): Promise<RetrievedBinaryModel | null> {
  const record = await getAssetFromDb(assetId);
  if (!record || !record.buffer) return null;
  const dependencies = await getAssetDependencies(assetId);
  return {
    record,
    buffer: record.buffer,
    dependencies,
  };
}

/**
 * Links an asset record in `binary_assets` to a specific scene and 3D node/entity ID.
 */
export async function linkAssetToScene(
  assetId: string,
  sceneId: string,
  nodeOrEntityId: string
): Promise<StoredAssetRecord | null> {
  const db = await openDb();
  const record = await new Promise<StoredAssetRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).get(assetId);
    req.onsuccess = () => resolve((req.result as StoredAssetRecord | undefined) || null);
    req.onerror = () => reject(req.error);
  });
  if (!record) return null;

  const updated: StoredAssetRecord = {
    ...record,
    linkedSceneIds: Array.from(new Set([...(record.linkedSceneIds || []), sceneId])),
    linkedSceneNodeIds: Array.from(
      new Set([...(record.linkedSceneNodeIds || []), nodeOrEntityId])
    ),
    updatedAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return updated;
}

export async function unlinkAssetFromScene(
  assetId: string,
  nodeOrEntityId: string
): Promise<void> {
  const db = await openDb();
  const record = await new Promise<StoredAssetRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).get(assetId);
    req.onsuccess = () => resolve((req.result as StoredAssetRecord | undefined) || null);
    req.onerror = () => reject(req.error);
  });
  if (!record) return;

  const updated: StoredAssetRecord = {
    ...record,
    linkedSceneNodeIds: (record.linkedSceneNodeIds || []).filter((id) => id !== nodeOrEntityId),
    updatedAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAssetsLinkedToScene(sceneId: string): Promise<StoredAssetRecord[]> {
  const all = await listAssetsFromDb();
  return all.filter((rec) => (rec.linkedSceneIds || []).includes(sceneId));
}

/**
 * Increments asset version, stores new binary (chunked if large), and appends SHA-256 history.
 */
export async function bumpAssetVersion(
  assetId: string,
  newBuffer: ArrayBuffer,
  note = 'به‌روزرسانی فایل',
  updatedMeta?: Model3DMetadata
): Promise<StoredAssetRecord> {
  const db = await openDb();
  const existing = await getAssetFromDb(assetId);
  if (!existing) {
    throw new Error(`دارایی با شناسه ${assetId} در IndexedDB یافت نشد.`);
  }

  const checksumSha256 = await computeSha256Hex(newBuffer);
  const now = Date.now();
  const nextVersion = (existing.version || 1) + 1;
  const shouldChunk = newBuffer.byteLength > ASSET_CHUNK_SIZE_BYTES;
  let chunkCount = 1;

  if (shouldChunk) {
    chunkCount = await writeChunksForAsset(db, assetId, newBuffer);
  }

  const history = [
    ...(existing.versionHistory || [
      {
        version: existing.version || 1,
        updatedAt: existing.createdAt,
        sizeBytes: existing.sizeBytes,
        checksumSha256: existing.checksumSha256 || 'legacy',
      },
    ]),
    {
      version: nextVersion,
      updatedAt: now,
      sizeBytes: newBuffer.byteLength,
      checksumSha256,
      note,
    },
  ];

  const updated: StoredAssetRecord = {
    ...existing,
    sizeBytes: newBuffer.byteLength,
    updatedAt: now,
    buffer: shouldChunk ? null : newBuffer,
    dataUrl:
      newBuffer.byteLength <= INLINE_DATA_URL_THRESHOLD
        ? arrayBufferToDataUrl(newBuffer)
        : `idb://${assetId}`,
    modelMeta: updatedMeta ?? existing.modelMeta,
    chunked: shouldChunk,
    chunkCount,
    version: nextVersion,
    checksumSha256,
    versionHistory: history,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(updated);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { ...updated, buffer: newBuffer };
}

export async function listAssetsFromDb(): Promise<StoredAssetRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const store = tx.objectStore(STORE_ASSETS);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = ((req.result as StoredAssetRecord[]) || []).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listAllAssetDependenciesFromDb(): Promise<StoredAssetDependency[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSET_DEPS, 'readonly');
    const req = tx.objectStore(STORE_ASSET_DEPS).getAll();
    req.onsuccess = () => resolve((req.result as StoredAssetDependency[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAssetFromDb(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [STORE_ASSETS, STORE_ASSET_CHUNKS, STORE_ASSET_DEPS],
      'readwrite'
    );
    tx.objectStore(STORE_ASSETS).delete(id);

    const chunkIdx = tx.objectStore(STORE_ASSET_CHUNKS).index('assetId');
    const cReq = chunkIdx.getAllKeys(id);
    cReq.onsuccess = () => {
      (cReq.result || []).forEach((k) => tx.objectStore(STORE_ASSET_CHUNKS).delete(k));
    };

    const depIdx = tx.objectStore(STORE_ASSET_DEPS).index('parentAssetId');
    const dReq = depIdx.getAllKeys(id);
    dReq.onsuccess = () => {
      (dReq.result || []).forEach((k) => tx.objectStore(STORE_ASSET_DEPS).delete(k));
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Verifies integrity of all scene-asset references and IndexedDB binary + dependency availability.
 */
export async function verifyProjectAssetIntegrity(
  project: RayanProject
): Promise<ProjectAssetIntegrityReport> {
  const missingAssets: Array<{ assetId: string; referencedBy: string }> = [];
  const referencedIds = new Set<string>();
  const assetIdsInProject = new Set(project.assets.map((a) => a.id));

  project.scenes.forEach((sc) => {
    sc.entities.forEach((ent) => {
      if (ent.assetId) {
        referencedIds.add(ent.assetId);
        if (!assetIdsInProject.has(ent.assetId)) {
          missingAssets.push({ assetId: ent.assetId, referencedBy: `${sc.name} / ${ent.name}` });
        }
      }
    });
  });

  (project.studio3dNodes || []).forEach((node) => {
    if (node.assetId) {
      referencedIds.add(node.assetId);
      if (!assetIdsInProject.has(node.assetId)) {
        missingAssets.push({ assetId: node.assetId, referencedBy: `Studio3D / ${node.name}` });
      }
    }
  });

  let chunkedModelsCount = 0;
  let totalDependenciesCount = 0;

  try {
    const [storedRecords, deps] = await Promise.all([
      listAssetsFromDb(),
      listAllAssetDependenciesFromDb(),
    ]);
    const storedMap = new Map(storedRecords.map((r) => [r.id, r]));
    chunkedModelsCount = storedRecords.filter((r) => r.chunked).length;
    totalDependenciesCount = deps.length;

    for (const asset of project.assets) {
      const hasInline = Boolean(asset.dataUrl && !asset.dataUrl.startsWith('idb://'));
      const inIdb = storedMap.has(asset.id);
      if (!hasInline && !inIdb) {
        missingAssets.push({ assetId: asset.id, referencedBy: `Asset: ${asset.name}` });
      }
    }
  } catch {
    // IndexedDB unavailable in headless tests
  }

  const unlinkedAssets = project.assets
    .filter((a) => !referencedIds.has(a.id))
    .map((a) => a.id);

  return {
    ok: missingAssets.length === 0,
    totalReferencedAssets: referencedIds.size,
    missingAssets,
    unlinkedAssets,
    chunkedModelsCount,
    totalDependenciesCount,
  };
}

/** Upgrades any legacy project record safely so scenes, camera, tilemap & customVariables always exist */
export function normalizeProject(raw: RayanProject): RayanProject {
  const defaultCamera = {
    worldWidth: Math.max(raw.screenConfig?.width || 1280, raw.camera?.worldWidth || 1280),
    worldHeight: Math.max(raw.screenConfig?.height || 720, raw.camera?.worldHeight || 720),
    followTargetName: raw.camera?.followTargetName ?? '',
    zoom: raw.camera?.zoom ?? 1,
    smoothing: raw.camera?.smoothing ?? 0.14,
  };
  const defaultTilemap = {
    tileSize: raw.tilemap?.tileSize ?? 40,
    tiles: raw.tilemap?.tiles ?? {},
  };

  let scenes: GameScene[] = Array.isArray(raw.scenes) && raw.scenes.length > 0 ? raw.scenes : [];
  if (scenes.length === 0) {
    scenes = [
      {
        id: 'scene_1',
        name: 'مرحله ۱',
        environment: raw.environment,
        camera: defaultCamera,
        tilemap: defaultTilemap,
        entities: raw.entities || [],
        rulesText: raw.rulesText || '',
        rules: raw.rules || [],
      },
    ];
  }

  const activeSceneId =
    raw.activeSceneId && scenes.some((s) => s.id === raw.activeSceneId)
      ? raw.activeSceneId
      : scenes[0].id;
  const activeScene = scenes.find((s) => s.id === activeSceneId) || scenes[0];

  return {
    ...raw,
    assets: raw.assets || [],
    studio3dNodes: Array.isArray(raw.studio3dNodes) ? raw.studio3dNodes : undefined,
    codeFiles: Array.isArray(raw.codeFiles) ? raw.codeFiles : createDefaultCodeFiles(raw.name),
    uiPages: Array.isArray(raw.uiPages) ? raw.uiPages : undefined,
    activeUiPageId: typeof raw.activeUiPageId === 'string' ? raw.activeUiPageId : undefined,
    uiCollections: Array.isArray(raw.uiCollections) ? raw.uiCollections : undefined,
    scenes,
    activeSceneId,
    environment: activeScene.environment,
    camera: activeScene.camera || defaultCamera,
    tilemap: activeScene.tilemap || defaultTilemap,
    entities: activeScene.entities,
    rulesText: activeScene.rulesText,
    rules: activeScene.rules,
    editorSettings: raw.editorSettings || {
      snapToGrid: false,
      gridSize: 40,
      showDebugHitboxes: false,
    },
    customVariables: raw.customVariables || { موج: 1 },
  };
}

export async function listSavedProjects(): Promise<RayanProject[]> {
  const db = await openDb();
  const projects = await new Promise<RayanProject[]>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as RayanProject[])
        .map(normalizeProject)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });

  // Hydrate small previews & sync version/dependency metadata from binary_assets
  return Promise.all(projects.map((proj) => hydrateProjectAssetsFromDb(proj)));
}

export async function hydrateProjectAssetsFromDb(project: RayanProject): Promise<RayanProject> {
  if (!project.assets || project.assets.length === 0) return project;
  let changed = false;
  const hydratedAssets = await Promise.all(
    project.assets.map(async (asset) => {
      try {
        const stored = await getAssetFromDb(asset.id);
        if (stored) {
          const needsDataUrl =
            (!asset.dataUrl || asset.dataUrl.startsWith('idb://')) &&
            stored.buffer &&
            stored.buffer.byteLength <= INLINE_DATA_URL_THRESHOLD;
          const nextDataUrl = needsDataUrl
            ? stored.dataUrl || arrayBufferToDataUrl(stored.buffer!)
            : asset.dataUrl;
          if (
            nextDataUrl !== asset.dataUrl ||
            stored.version !== asset.version ||
            stored.checksumSha256 !== asset.checksumSha256
          ) {
            changed = true;
            return {
              ...asset,
              dataUrl: nextDataUrl,
              storedInIdb: true,
              version: stored.version ?? asset.version,
              checksumSha256: stored.checksumSha256 ?? asset.checksumSha256,
              chunkCount: stored.chunkCount ?? asset.chunkCount,
              linkedSceneIds: stored.linkedSceneIds ?? asset.linkedSceneIds,
              linkedSceneNodeIds: stored.linkedSceneNodeIds ?? asset.linkedSceneNodeIds,
              versionHistory: stored.versionHistory ?? asset.versionHistory,
            };
          }
        }
      } catch {
        // ignore missing record
      }
      return asset;
    })
  );
  return changed ? { ...project, assets: hydratedAssets } : project;
}

export async function saveProjectToDb(project: RayanProject): Promise<RayanProject> {
  // Keep STORE_PROJECTS lean by storing `idb://<id>` pointers for large binary assets stored in binary_assets
  const compactAssets = (project.assets || []).map((a) =>
    a.storedInIdb && a.sizeBytes > INLINE_DATA_URL_THRESHOLD
      ? { ...a, dataUrl: `idb://${a.id}` }
      : a
  );
  const updated: RayanProject = normalizeProject({
    ...project,
    assets: compactAssets,
    updatedAt: Date.now(),
  });
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.put(updated);
    req.onsuccess = () => resolve(updated);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProjectFromDb(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    const store = tx.objectStore(STORE_PROJECTS);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function createStarter2DProject(name = 'ماجراجویی دره رایان'): RayanProject {
  const now = Date.now();
  const scene1Entities: RayanProject['entities'] = [
    {
      id: 'ent_player',
      name: 'بازیکن',
      role: 'player',
      kind: 'shape2d',
      shape2d: 'rect',
      x: 110,
      y: 380,
      z: 0,
      width: 48,
      height: 56,
      depth: 48,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#F59E0B',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: false,
        useGravity: true,
        mass: 1,
        bounce: 0.1,
        friction: 0.85,
        collider: 'box',
      },
    },
    {
      id: 'ent_ground',
      name: 'زمین',
      role: 'platform',
      kind: 'shape2d',
      shape2d: 'rect',
      x: 0,
      y: 640,
      z: 0,
      width: 1920,
      height: 80,
      depth: 100,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#1E293B',
      opacity: 1,
      visible: true,
      locked: true,
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 100,
        bounce: 0,
        friction: 0.9,
        collider: 'box',
      },
    },
    {
      id: 'ent_plat1',
      name: 'سکوی سنگی',
      role: 'platform',
      kind: 'shape2d',
      shape2d: 'rect',
      x: 340,
      y: 500,
      z: 0,
      width: 210,
      height: 28,
      depth: 40,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#334155',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 100,
        bounce: 0,
        friction: 0.9,
        collider: 'box',
      },
    },
    {
      id: 'ent_plat2',
      name: 'سکوی بالا',
      role: 'platform',
      kind: 'shape2d',
      shape2d: 'rect',
      x: 680,
      y: 380,
      z: 0,
      width: 220,
      height: 28,
      depth: 40,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#334155',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 100,
        bounce: 0,
        friction: 0.9,
        collider: 'box',
      },
    },
    {
      id: 'ent_coin1',
      name: 'سکه',
      role: 'collectible',
      kind: 'shape2d',
      shape2d: 'star',
      x: 430,
      y: 430,
      z: 0,
      width: 36,
      height: 36,
      depth: 36,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#FBBF24',
      opacity: 1,
      visible: true,
      animation: { preset: 'float', speed: 3, amplitude: 7, spriteCols: 1, spriteRows: 1, fps: 8 },
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 1,
        bounce: 0,
        friction: 0,
        collider: 'sphere',
      },
    },
    {
      id: 'ent_coin2',
      name: 'الماس',
      role: 'collectible',
      kind: 'shape2d',
      shape2d: 'star',
      x: 775,
      y: 315,
      z: 0,
      width: 36,
      height: 36,
      depth: 36,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#38BDF8',
      opacity: 1,
      visible: true,
      animation: { preset: 'pulse', speed: 3.5, amplitude: 8, spriteCols: 1, spriteRows: 1, fps: 8 },
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 1,
        bounce: 0,
        friction: 0,
        collider: 'sphere',
      },
    },
    {
      id: 'ent_enemy',
      name: 'نگهبان',
      role: 'enemy',
      kind: 'shape2d',
      shape2d: 'triangle',
      x: 920,
      y: 570,
      z: 0,
      width: 48,
      height: 54,
      depth: 48,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#EF4444',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: false,
        useGravity: true,
        mass: 1.5,
        bounce: 0.1,
        friction: 0.8,
        collider: 'box',
      },
    },
    {
      id: 'ent_hud',
      name: 'متن امتیاز',
      role: 'hud-text',
      kind: 'hud-text',
      x: 24,
      y: 22,
      z: 0,
      width: 360,
      height: 44,
      depth: 10,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#F8FAFC',
      opacity: 1,
      visible: true,
      physics: {
        enabled: false,
        isStatic: true,
        useGravity: false,
        mass: 1,
        bounce: 0,
        friction: 0,
        collider: 'none',
      },
      textConfig: {
        text: 'امتیاز: {score}  |  جان: {health}  |  زمان: {time}',
        fontSize: 16,
        textColor: '#F8FAFC',
        boxBgColor: 'rgba(11, 14, 20, 0.72)',
        boxBorderColor: '#334155',
        boxBorderWidth: 1,
        boxBorderRadius: 10,
        boxPadding: 10,
        scrollable: false,
        fixedOnScreen: true,
        clickable: false,
        align: 'right',
      },
    },
    {
      id: 'ent_story_box',
      name: 'کادر راهنما',
      role: 'text-box',
      kind: 'text-box',
      x: 980,
      y: 22,
      z: 0,
      width: 270,
      height: 118,
      depth: 10,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#E2E8F0',
      opacity: 1,
      visible: true,
      physics: {
        enabled: false,
        isStatic: true,
        useGravity: false,
        mass: 1,
        bounce: 0,
        friction: 0,
        collider: 'none',
      },
      textConfig: {
        text: 'راهنمای مرحله ۱ (اسکرول کنید):\n۱. با کلیدهای چپ و راست حرکت کنید.\n۲. با فاصله پرش کنید و با E پرتابه شلیک کنید.\n۳. به پرچم پایان در سمت راست برسید تا وارد مرحله ۲ شوید!',
        fontSize: 13,
        textColor: '#E2E8F0',
        boxBgColor: 'rgba(15, 23, 42, 0.84)',
        boxBorderColor: '#475569',
        boxBorderWidth: 1,
        boxBorderRadius: 10,
        boxPadding: 12,
        scrollable: true,
        fixedOnScreen: true,
        clickable: true,
        align: 'right',
      },
    },
  ];

  const scene1RulesText = [
    'کلید راست: بازیکن حرکت راست سرعت 270',
    'کلید چپ: بازیکن حرکت چپ سرعت 270',
    'کلید فاصله: بازیکن پرش قدرت 560',
    'کلید E: بازیکن پرتاب قدرت 620 زاویه 22',
    'همیشه: نگهبان حرکت رفت و برگشت سرعت 120',
    'برخورد بازیکن با سکه: امتیاز +10 | افکت جرقه | حذف سکه | صدا coin',
    'برخورد بازیکن با الماس: امتیاز +20 | افکت جرقه | حذف الماس | صدا coin',
    'برخورد بازیکن با نگهبان: جان -20 | افکت انفجار | لرزش دوربین قدرت 10 | صدا hit',
    'برخورد بازیکن با خطر: جان -25 | افکت انفجار | لرزش دوربین قدرت 12 | بازگشت بازیکن',
    'رسیدن بازیکن به پایان: افکت جرقه | ذخیره پیشرفت | مرحله بعد',
  ].join('\n');

  const scene1Tiles: Record<string, TileType> = {
    '14,15': 'bounce',
    '28,15': 'hazard',
    '29,15': 'hazard',
    '33,13': 'platform',
    '34,13': 'platform',
    '35,13': 'platform',
    '43,15': 'finish',
  };

  const scene1: GameScene = {
    id: 'scene_1',
    name: 'مرحله ۱ - دره رایان',
    environment: {
      backgroundType: 'image',
      backgroundColor: '#0B0E14',
      backgroundGradient: 'linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
      backgroundImageUrl: '/src/assets/images/bg_adventure_valley_1795376125872.jpg',
      gravity: 980,
      fogEnabled: false,
      fogColor: '#0B0E14',
      ambientLightIntensity: 0.7,
    },
    camera: {
      worldWidth: 1920,
      worldHeight: 720,
      followTargetName: 'بازیکن',
      zoom: 1,
      smoothing: 0.14,
    },
    tilemap: {
      tileSize: 40,
      tiles: scene1Tiles,
    },
    entities: scene1Entities,
    rulesText: scene1RulesText,
    rules: parsePersianRules(scene1RulesText, scene1Entities).rules,
  };

  // Scene 2: Ancient Ruins Level
  const scene2Entities: RayanProject['entities'] = [
    {
      ...scene1Entities[0],
      id: 'ent2_player',
      x: 90,
      y: 420,
    },
    {
      ...scene1Entities[1],
      id: 'ent2_ground',
      width: 1280,
    },
    {
      ...scene1Entities[2],
      id: 'ent2_plat1',
      name: 'سکوی باستانی',
      x: 420,
      y: 470,
      width: 260,
    },
    {
      ...scene1Entities[6],
      id: 'ent2_enemy',
      x: 780,
      y: 560,
    },
    {
      ...scene1Entities[7],
      id: 'ent2_hud',
      textConfig: {
        ...scene1Entities[7].textConfig!,
        text: 'مرحله ۲  |  امتیاز: {score}  |  جان: {health}',
      },
    },
  ];
  const scene2RulesText = [
    'کلید راست: بازیکن حرکت راست سرعت 280',
    'کلید چپ: بازیکن حرکت چپ سرعت 280',
    'کلید فاصله: بازیکن پرش قدرت 570',
    'کلید E: بازیکن پرتاب قدرت 650 زاویه 20',
    'همیشه: نگهبان تعقیب بازیکن سرعت 105',
    'برخورد بازیکن با نگهبان: جان -25 | افکت انفجار | لرزش دوربین قدرت 12 | صدا hit',
    'رسیدن بازیکن به پایان: افکت جرقه | نمایش پیام "تبریک! تمام مراحل با موفقیت تمام شد"',
  ].join('\n');

  const scene2: GameScene = {
    id: 'scene_2',
    name: 'مرحله ۲ - ویرانه‌های باستانی',
    environment: {
      backgroundType: 'image',
      backgroundColor: '#0B0E14',
      backgroundGradient: 'linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
      backgroundImageUrl: '/src/assets/images/bg_ancient_ruins_1795376126459.jpg',
      gravity: 980,
      fogEnabled: false,
      fogColor: '#0B0E14',
      ambientLightIntensity: 0.75,
    },
    camera: {
      worldWidth: 1280,
      worldHeight: 720,
      followTargetName: 'بازیکن',
      zoom: 1,
      smoothing: 0.16,
    },
    tilemap: {
      tileSize: 40,
      tiles: {
        '13,15': 'bounce',
        '29,15': 'finish',
      },
    },
    entities: scene2Entities,
    rulesText: scene2RulesText,
    rules: parsePersianRules(scene2RulesText, scene2Entities).rules,
  };

  return {
    id: `proj_${now}`,
    name,
    description: 'بازی پلتفرمر دو‌بعدی چندمرحله‌ای با کاشی‌چین، دوربین هوشمند، ذرات و فیزیک کامل.',
    engineMode: '2d',
    screenConfig: {
      preset: 'web',
      width: 1280,
      height: 720,
      showTouchControls: false,
    },
    assets: [],
    environment: scene1.environment,
    camera: scene1.camera,
    tilemap: scene1.tilemap,
    entities: scene1.entities,
    rulesText: scene1.rulesText,
    rules: scene1.rules,
    scenes: [scene1, scene2],
    activeSceneId: scene1.id,
    editorSettings: {
      snapToGrid: false,
      gridSize: 40,
      showDebugHitboxes: false,
    },
    variables: {
      score: 0,
      health: 100,
      level: 1,
    },
    customVariables: { موج: 1 },
    soundBindings: {
      bgm: 'adventure',
      onJump: 'jump',
      onThrow: 'throw',
      onCollect: 'coin',
      onHit: 'hit',
      onClick: 'click',
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createStarter3DProject(name = 'میدان نبرد سه‌بعدی رایان'): RayanProject {
  const now = Date.now();
  const entities: RayanProject['entities'] = [
    {
      id: 'ent3d_player',
      name: 'بازیکن',
      role: 'player',
      kind: 'model3d-preset',
      model3dPreset: 'hero-bot',
      x: 0,
      y: 0.5,
      z: 4,
      width: 1.2,
      height: 1.8,
      depth: 1.2,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#F59E0B',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: false,
        useGravity: true,
        mass: 1,
        bounce: 0.1,
        friction: 0.85,
        collider: 'box',
      },
    },
    {
      id: 'ent3d_rover',
      name: 'نگهبان',
      role: 'enemy',
      kind: 'model3d-preset',
      model3dPreset: 'turret',
      x: -5,
      y: 0.5,
      z: -3,
      width: 1.5,
      height: 1.6,
      depth: 1.5,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#EF4444',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: false,
        useGravity: true,
        mass: 2,
        bounce: 0.1,
        friction: 0.8,
        collider: 'box',
      },
    },
    {
      id: 'ent3d_gem1',
      name: 'کریستال',
      role: 'collectible',
      kind: 'model3d-preset',
      model3dPreset: 'crystal-gem',
      x: 4,
      y: 0.6,
      z: -2,
      width: 1,
      height: 1.4,
      depth: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#38BDF8',
      opacity: 1,
      visible: true,
      animation: { preset: 'float', speed: 2.5, amplitude: 4, spriteCols: 1, spriteRows: 1, fps: 8 },
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 1,
        bounce: 0,
        friction: 0,
        collider: 'sphere',
      },
    },
    {
      id: 'ent3d_crate',
      name: 'جعبه چوبی',
      role: 'platform',
      kind: 'model3d-preset',
      model3dPreset: 'crate',
      x: -2.5,
      y: 0.75,
      z: 0,
      width: 1.5,
      height: 1.5,
      depth: 1.5,
      rotationX: 0,
      rotationY: 18,
      rotationZ: 0,
      color: '#B45309',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: true,
        useGravity: false,
        mass: 50,
        bounce: 0,
        friction: 0.9,
        collider: 'box',
      },
    },
    {
      id: 'ent3d_tree',
      name: 'درخت کاج',
      role: 'prop',
      kind: 'model3d-preset',
      model3dPreset: 'pine-tree',
      x: 7,
      y: 0,
      z: -6,
      width: 2.2,
      height: 4,
      depth: 2.2,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#16A34A',
      opacity: 1,
      visible: true,
      physics: {
        enabled: false,
        isStatic: true,
        useGravity: false,
        mass: 100,
        bounce: 0,
        friction: 0.9,
        collider: 'box',
      },
    },
    {
      id: 'ent3d_hud',
      name: 'متن وضعیت',
      role: 'hud-text',
      kind: 'hud-text',
      x: 24,
      y: 22,
      z: 0,
      width: 340,
      height: 44,
      depth: 1,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#F8FAFC',
      opacity: 1,
      visible: true,
      physics: {
        enabled: false,
        isStatic: true,
        useGravity: false,
        mass: 1,
        bounce: 0,
        friction: 0,
        collider: 'none',
      },
      textConfig: {
        text: 'امتیاز: {score}  |  جان: {health}  |  زمان: {time}',
        fontSize: 16,
        textColor: '#F8FAFC',
        boxBgColor: 'rgba(11, 14, 20, 0.72)',
        boxBorderColor: '#334155',
        boxBorderWidth: 1,
        boxBorderRadius: 10,
        boxPadding: 10,
        scrollable: false,
        fixedOnScreen: true,
        clickable: false,
        align: 'right',
      },
    },
  ];

  const rulesText = [
    'کلید راست: بازیکن حرکت راست سرعت 7',
    'کلید چپ: بازیکن حرکت چپ سرعت 7',
    'کلید بالا: بازیکن حرکت جلو سرعت 7',
    'کلید پایین: بازیکن حرکت عقب سرعت 7',
    'کلید فاصله: بازیکن پرش قدرت 10',
    'کلید E: بازیکن پرتاب قدرت 18 زاویه 22',
    'همیشه: نگهبان تعقیب بازیکن سرعت 2.4',
    'برخورد بازیکن با کریستال: امتیاز +20 | افکت جرقه | حذف کریستال | صدا coin',
    'برخورد بازیکن با نگهبان: جان -15 | افکت انفجار | لرزش دوربین قدرت 10 | صدا hit',
  ].join('\n');

  const scene1: GameScene = {
    id: 'scene3d_1',
    name: 'عرصه اول سه‌بعدی',
    environment: {
      backgroundType: 'color',
      backgroundColor: '#0F172A',
      backgroundGradient: 'linear-gradient(180deg, #0F172A 0%, #1E293B 100%)',
      backgroundImageUrl: '/src/assets/images/bg_sci_fi_horizon_1795376126799.jpg',
      gravity: 24,
      fogEnabled: true,
      fogColor: '#0F172A',
      ambientLightIntensity: 0.75,
    },
    camera: {
      worldWidth: 1280,
      worldHeight: 720,
      followTargetName: 'بازیکن',
      zoom: 1,
      smoothing: 0.14,
    },
    tilemap: {
      tileSize: 40,
      tiles: {},
    },
    entities,
    rulesText,
    rules: parsePersianRules(rulesText, entities).rules,
  };

  return {
    id: `proj3d_${now}`,
    name,
    description: 'محیط سه‌بعدی تعاملی با مدل‌های چندبخشی، ذرات سه‌بعدی، نورپردازی استودیویی و شبیه‌ساز فیزیک.',
    engineMode: '3d',
    screenConfig: {
      preset: 'web',
      width: 1280,
      height: 720,
      showTouchControls: false,
    },
    assets: [],
    environment: scene1.environment,
    camera: scene1.camera,
    tilemap: scene1.tilemap,
    entities: scene1.entities,
    rulesText: scene1.rulesText,
    rules: scene1.rules,
    scenes: [scene1],
    activeSceneId: scene1.id,
    editorSettings: {
      snapToGrid: false,
      gridSize: 40,
      showDebugHitboxes: false,
    },
    variables: {
      score: 0,
      health: 100,
      level: 1,
    },
    customVariables: { موج: 1 },
    soundBindings: {
      bgm: 'space',
      onJump: 'jump',
      onThrow: 'throw',
      onCollect: 'coin',
      onHit: 'hit',
      onClick: 'click',
    },
    createdAt: now,
    updatedAt: now,
  };
}
