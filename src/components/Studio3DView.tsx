/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Multi-Model 3D Studio & Scene Graph Editor
 * Supports hundreds of concurrent models (GLB, glTF, FBX, OBJ, STL, USD/USDZ, PLY),
 * basic 3D primitives, multi-part procedural rigs, PointLights, true recursive
 * Parent-Child Hierarchy, independent multi-object selection & TransformControls gizmos,
 * IndexedDB project persistence, and real GLB scene export.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  AlertCircle,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Focus,
  Folder,
  FolderPlus,
  FolderTree,
  Layers,
  Lightbulb,
  Lock,
  Maximize2,
  Move,
  Pause,
  Play,
  Plus,
  RotateCw,
  Save,
  Search,
  Shapes,
  Trash2,
  Ungroup,
  Unlock,
  Upload,
} from 'lucide-react';
import type {
  AssetFormat,
  Model3DPresetType,
  Primitive3DType,
  RayanAsset,
  RayanProject,
  SceneNode3D,
} from '../types/studio';
import {
  applyColorAndPbrToGroup,
  buildLight3DGroup,
  buildPrimitive3DGroup,
  buildProceduralPresetGroup,
  disposeObject3D,
  loadCustom3DAsset,
} from '../engine/threeModels';
import { importAssetsFromFileList } from '../engine/assetManager';
import { linkAssetToScene, retrieveBinaryModel, unlinkAssetFromScene } from '../storage/projectDb';

export type { SceneNode3D };

async function buildImageAssetPlane(asset: RayanAsset): Promise<THREE.Group> {
  let buffer: ArrayBuffer | null = null;
  if (asset.dataUrl && !asset.dataUrl.startsWith('idb://')) {
    const comma = asset.dataUrl.indexOf(',');
    if (comma >= 0) {
      const binary = atob(asset.dataUrl.slice(comma + 1));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      buffer = bytes.buffer;
    }
  }
  if (!buffer) {
    const stored = await retrieveBinaryModel(asset.id);
    buffer = stored?.buffer || null;
  }
  if (!buffer) throw new Error(`داده تصویر «${asset.name}» در حافظه پیدا نشد.`);

  const mime = asset.format === 'svg' ? 'image/svg+xml'
    : asset.format === 'jpg' ? 'image/jpeg' : `image/${asset.format}`;
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  try {
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(url, resolve, undefined, reject);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const image = texture.image as HTMLImageElement;
    const aspect = image?.naturalWidth && image?.naturalHeight
      ? image.naturalWidth / image.naturalHeight : 1;
    const height = Math.min(3, Math.max(0.25, 2.2 / Math.max(aspect, 0.05)));
    const width = height * aspect;
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: asset.format === 'png' || asset.format === 'webp' || asset.format === 'svg',
      depthWrite: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.y = height / 2;
    mesh.userData.isImportedImage = true;
    group.add(mesh);
    group.userData.assetKind = 'image';
    group.userData.imageAspect = aspect;
    return group;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Studio3DViewProps {
  project: RayanProject;
  onUpdateProject?: (updater: (prev: RayanProject) => RayanProject, skipHistory?: boolean) => void;
  onAddAsset?: (asset: RayanAsset) => void | Promise<void>;
}

const DEFAULT_LAYERS = [
  { id: 'default', name: 'لایه پیش‌فرض', color: '#94a3b8' },
  { id: 'characters', name: 'شخصیت‌ها و کاراکترها', color: '#38bdf8' },
  { id: 'props', name: 'آیتم‌ها و اشیا (Props)', color: '#fbbf24' },
  { id: 'env', name: 'محیط و معماری', color: '#34d399' },
  { id: 'lighting', name: 'نورپردازی و افکت‌ها', color: '#c084fc' },
];

const PRIMITIVE_CATALOG: Array<{ type: Primitive3DType; label: string; color: string }> = [
  { type: 'box', label: 'مکعب (Box)', color: '#38bdf8' },
  { type: 'sphere', label: 'کره (Sphere)', color: '#a855f7' },
  { type: 'cylinder', label: 'استوانه (Cylinder)', color: '#f59e0b' },
  { type: 'cone', label: 'مخروط (Cone)', color: '#ef4444' },
  { type: 'torus', label: 'حلقه (Torus)', color: '#10b981' },
  { type: 'capsule', label: 'کپسول (Capsule)', color: '#ec4899' },
  { type: 'plane', label: 'صفحه (Plane)', color: '#64748b' },
];

const PRESET_CATALOG: Array<{ preset: Model3DPresetType; label: string; color: string; textCls: string }> = [
  { preset: 'hero-bot', label: 'ربات قهرمان', color: '#38bdf8', textCls: 'text-sky-300' },
  { preset: 'rover-car', label: 'ماشین کاوشگر', color: '#f59e0b', textCls: 'text-amber-300' },
  { preset: 'turret', label: 'برجک تدافعی', color: '#ef4444', textCls: 'text-red-300' },
  { preset: 'crystal-gem', label: 'کریستال انرژی', color: '#10b981', textCls: 'text-emerald-300' },
  { preset: 'pine-tree', label: 'درخت کاج', color: '#14b8a6', textCls: 'text-teal-300' },
  { preset: 'crate', label: 'جعبه انبار', color: '#fb923c', textCls: 'text-orange-300' },
  { preset: 'platform-block', label: 'سکوی فلزی', color: '#64748b', textCls: 'text-slate-300' },
];

const DEFAULT_STARTER_NODES: SceneNode3D[] = [
  {
    id: 'node_hero_1',
    name: 'ربات قهرمان (Hero Bot)',
    kind: 'model-preset',
    preset: 'hero-bot',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#38bdf8',
    roughness: 0.42,
    metalness: 0.25,
    visible: true,
    locked: false,
    parentId: null,
    layerId: 'characters',
  },
  {
    id: 'node_group_props',
    name: 'گروه تجهیزات صحنه',
    kind: 'group',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#fbbf24',
    visible: true,
    locked: false,
    parentId: null,
    layerId: 'props',
  },
  {
    id: 'node_turret_1',
    name: 'برجک دفاعی',
    kind: 'model-preset',
    preset: 'turret',
    position: [2.5, 0, -1],
    rotation: [0, -35, 0],
    scale: [1, 1, 1],
    color: '#ef4444',
    roughness: 0.42,
    metalness: 0.25,
    visible: true,
    locked: false,
    parentId: 'node_group_props',
    layerId: 'props',
  },
  {
    id: 'node_gem_1',
    name: 'کریستال انرژی',
    kind: 'model-preset',
    preset: 'crystal-gem',
    position: [-2.2, 0, 1.2],
    rotation: [0, 45, 0],
    scale: [1, 1, 1],
    color: '#10b981',
    roughness: 0.3,
    metalness: 0.35,
    visible: true,
    locked: false,
    parentId: 'node_group_props',
    layerId: 'props',
  },
];

function buildInitialNodesFromProject(proj: RayanProject): SceneNode3D[] {
  if (Array.isArray(proj.studio3dNodes) && proj.studio3dNodes.length > 0) {
    return proj.studio3dNodes;
  }
  const entityAssetNodes: SceneNode3D[] = proj.entities
    .filter((e) => e.kind === 'model3d-asset' && e.assetId)
    .map((e) => {
      const asset = proj.assets.find((a) => a.id === e.assetId);
      return {
        id: `node_${e.id}`,
        name: e.name,
        kind: 'model-asset' as const,
        assetId: e.assetId,
        format: asset?.format?.toUpperCase(),
        position: [e.x, e.y, e.z],
        rotation: [e.rotationX, e.rotationY, e.rotationZ],
        scale: [1, 1, 1],
        color: e.color || '#38bdf8',
        visible: e.visible,
        locked: Boolean(e.locked),
        parentId: null,
        layerId: 'characters',
        animations: asset?.modelMeta?.animationNames,
      };
    });

  return [...DEFAULT_STARTER_NODES, ...entityAssetNodes];
}

function isDescendantOf(
  candidateId: string,
  potentialAncestorId: string,
  nodeMap: Map<string, SceneNode3D>
): boolean {
  let cur = nodeMap.get(candidateId);
  const visited = new Set<string>();
  while (cur && cur.parentId) {
    if (cur.parentId === potentialAncestorId) return true;
    if (visited.has(cur.parentId)) break;
    visited.add(cur.parentId);
    cur = nodeMap.get(cur.parentId);
  }
  return false;
}

function isEffectiveVisible(nodeId: string, nodeMap: Map<string, SceneNode3D>): boolean {
  let cur = nodeMap.get(nodeId);
  const visited = new Set<string>();
  while (cur) {
    if (!cur.visible) return false;
    if (!cur.parentId || visited.has(cur.parentId)) break;
    visited.add(cur.parentId);
    cur = nodeMap.get(cur.parentId);
  }
  return true;
}

function isEffectiveLocked(nodeId: string, nodeMap: Map<string, SceneNode3D>): boolean {
  let cur = nodeMap.get(nodeId);
  const visited = new Set<string>();
  while (cur) {
    if (cur.locked) return true;
    if (!cur.parentId || visited.has(cur.parentId)) break;
    visited.add(cur.parentId);
    cur = nodeMap.get(cur.parentId);
  }
  return false;
}

// Allocate imported models into a predictable, visible grid instead of random
// coordinates. Existing user-authored transforms are never modified.
function getNextImportedModelPosition(
  existingNodes: SceneNode3D[],
  offset = 0
): [number, number, number] {
  // Keep every imported model close to the editor's origin. An ever-growing
  // row/column index pushes later imports outside the initial viewport.
  const occupied = new Set(
    existingNodes
      .filter((node) => node.kind === 'model-asset')
      .map((node) => {
        const [x, , z] = node.position;
        return `${Math.round(x * 100) / 100}:${Math.round(z * 100) / 100}`;
      })
  );
  const spacing = 2.0;
  const candidates: Array<[number, number]> = [
    [0, 0],
    [-spacing, 0],
    [spacing, 0],
    [0, -spacing],
    [0, spacing],
    [-spacing, -spacing],
    [spacing, -spacing],
    [-spacing, spacing],
    [spacing, spacing],
    [-2 * spacing, 0],
    [2 * spacing, 0],
    [0, -2 * spacing],
    [0, 2 * spacing],
    [-2 * spacing, -spacing],
    [2 * spacing, -spacing],
    [-2 * spacing, spacing],
    [2 * spacing, spacing],
  ];
  const startAt = Math.max(0, offset);
  for (let index = startAt; index < candidates.length; index += 1) {
    const [x, z] = candidates[index];
    const key = `${x}:${z}`;
    if (!occupied.has(key)) return [x, 0, z];
  }

  // Beyond the compact viewport grid, continue in a bounded spiral around origin.
  const ring = Math.floor((startAt - candidates.length) / 8) + 2;
  const slot = Math.max(0, startAt - candidates.length) % 8;
  const angle = (slot / 8) * Math.PI * 2;
  return [
    Number((Math.cos(angle) * ring * spacing).toFixed(3)),
    0,
    Number((Math.sin(angle) * ring * spacing).toFixed(3)),
  ];
}

interface MultiDragSnapshot {
  pivotStartInv: THREE.Matrix4;
  items: Array<{
    nodeId: string;
    obj: THREE.Group;
    worldStart: THREE.Matrix4;
    parentWorldInv: THREE.Matrix4;
  }>;
}

const _tmpVec = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();
const _tmpScale = new THREE.Vector3();
const _tmpMatA = new THREE.Matrix4();
const _tmpMatB = new THREE.Matrix4();

export const Studio3DView: React.FC<Studio3DViewProps> = ({
  project,
  onUpdateProject,
  onAddAsset,
}) => {
  const [nodes, setNodes] = useState<SceneNode3D[]>(() => buildInitialNodesFromProject(project));
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const init = buildInitialNodesFromProject(project);
    const firstSelectable = init.find((n) => n.kind !== 'group') || init[0];
    return firstSelectable ? [firstSelectable.id] : [];
  });

  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [spaceMode, setSpaceMode] = useState<'world' | 'local'>('world');
  const [searchQuery, setSearchQuery] = useState('');
  const [paletteTab, setPaletteTab] = useState<'primitives' | 'presets' | 'assets'>('primitives');
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  const [expandedNodeIds, setExpandedNodeIds] = useState<Record<string, boolean>>({
    node_group_props: true,
  });

  // Animation playback
  const [isPlayingAnimations, setIsPlayingAnimations] = useState(true);
  const [animSpeed, setAnimSpeed] = useState(1);
  const isPlayingAnimRef = useRef(true);
  const animSpeedRef = useRef(1);

  useEffect(() => {
    isPlayingAnimRef.current = isPlayingAnimations;
  }, [isPlayingAnimations]);

  useEffect(() => {
    animSpeedRef.current = animSpeed;
  }, [animSpeed]);

  // Sync external additions to project.studio3dNodes (e.g. spawned from AssetsAudioPanel)
  useEffect(() => {
    if (!project.studio3dNodes || project.studio3dNodes.length === 0) return;
    setNodes((prev) => {
      const prevIds = new Set(prev.map((n) => n.id));
      const newOnes = project.studio3dNodes!.filter((n) => !prevIds.has(n.id));
      if (newOnes.length === 0) return prev;
      setSelectedIds([newOnes[newOnes.length - 1].id]);
      return [...prev, ...newOnes];
    });
  }, [project.studio3dNodes]);

  const persistNodesToProject = useCallback(
    (nextNodes: SceneNode3D[], skipHistory = false) => {
      onUpdateProject?.(
        (prev) => ({
          ...prev,
          studio3dNodes: nextNodes,
          updatedAt: Date.now(),
        }),
        skipHistory
      );
    },
    [onUpdateProject]
  );

  // Refs for Three.js scene
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const multiPivotRef = useRef<THREE.Group | null>(null);
  const selectionHelpersRef = useRef<THREE.Group | null>(null);
  const boxHelpersMapRef = useRef<Map<string, THREE.BoxHelper>>(new Map());
  const modelObjectsRef = useRef<Map<string, THREE.Group>>(new Map());
  const mixersRef = useRef<Map<string, THREE.AnimationMixer>>(new Map());
  const autoFramedNodeIdsRef = useRef<Set<string>>(new Set());
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const multiDragSnapshotRef = useRef<MultiDragSnapshot | null>(null);

  const nodesRef = useRef<SceneNode3D[]>(nodes);
  nodesRef.current = nodes;
  // Keep the latest asset metadata without making the async scene-loader effect
  // restart and cancel in-flight model parses on every project.assets update.
  const projectAssetsRef = useRef(project.assets);
  projectAssetsRef.current = project.assets;
  const selectedIdsRef = useRef<string[]>(selectedIds);
  selectedIdsRef.current = selectedIds;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const nodeMap = useMemo(() => {
    const m = new Map<string, SceneNode3D>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const primarySelectedId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
  const selectedNode = useMemo(
    () => (selectedIds.length === 1 ? nodeMap.get(selectedIds[0]) || null : null),
    [selectedIds, nodeMap]
  );

  const project3DAssets = useMemo(
    () => project.assets.filter((a) => a.kind === 'model3d'),
    [project.assets]
  );

  // Build visible flat list order for Shift-range selection in tree
  const { rootNodes, childrenByParent, flattenedTreeIds } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const map = new Map<string, SceneNode3D[]>();
    const roots: SceneNode3D[] = [];

    const matchesQuery = (node: SceneNode3D): boolean => {
      if (!q) return true;
      return (
        node.name.toLowerCase().includes(q) ||
        (node.format && node.format.toLowerCase().includes(q)) ||
        node.kind.toLowerCase().includes(q)
      );
    };

    nodes.forEach((n) => {
      const pid = n.parentId && nodeMap.has(n.parentId) && n.parentId !== n.id ? n.parentId : null;
      if (!pid) {
        roots.push(n);
      } else {
        const arr = map.get(pid) || [];
        arr.push(n);
        map.set(pid, arr);
      }
    });

    const visibleFlat: string[] = [];
    const walk = (list: SceneNode3D[]) => {
      for (const item of list) {
        const children = map.get(item.id) || [];
        const hasMatchDescendant = (id: string): boolean => {
          const ch = map.get(id) || [];
          return ch.some((c) => matchesQuery(c) || hasMatchDescendant(c.id));
        };
        if (!matchesQuery(item) && !hasMatchDescendant(item.id)) continue;
        visibleFlat.push(item.id);
        if ((expandedNodeIds[item.id] ?? true) && children.length > 0) {
          walk(children);
        }
      }
    };
    walk(roots);

    return { rootNodes: roots, childrenByParent: map, flattenedTreeIds: visibleFlat };
  }, [nodes, nodeMap, searchQuery, expandedNodeIds]);

  // Sync TransformControls mode & space
  useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setSpace(spaceMode);
    }
  }, [transformMode, spaceMode]);

  // Helper to attach TransformControls cleanly for either 1 object or N objects via multiPivotRef
  const syncTransformGizmoAttachment = useCallback(() => {
    const tc = transformRef.current;
    const pivot = multiPivotRef.current;
    const scene = sceneRef.current;
    if (!tc || !pivot || !scene) return;

    const currentNodes = nodesRef.current;
    const currentMap = new Map<string, SceneNode3D>();
    currentNodes.forEach((n) => currentMap.set(n.id, n));

    const validIds = selectedIdsRef.current.filter((id) => {
      const n = currentMap.get(id);
      if (!n) return false;
      if (isEffectiveLocked(id, currentMap)) return false;
      if (!isEffectiveVisible(id, currentMap)) return false;
      return modelObjectsRef.current.has(id);
    });

    if (validIds.length === 0) {
      tc.detach();
      return;
    }

    if (validIds.length === 1) {
      const obj = modelObjectsRef.current.get(validIds[0]);
      if (obj) {
        tc.attach(obj);
      } else {
        tc.detach();
      }
      return;
    }

    // Multiple objects selected: ignore any child whose ancestor is also selected
    const selectedSet = new Set(validIds);
    const rootSelectedIds = validIds.filter((id) => {
      let cur = currentMap.get(id);
      while (cur && cur.parentId) {
        if (selectedSet.has(cur.parentId)) return false;
        cur = currentMap.get(cur.parentId);
      }
      return true;
    });

    if (rootSelectedIds.length === 1) {
      const obj = modelObjectsRef.current.get(rootSelectedIds[0]);
      if (obj) tc.attach(obj);
      return;
    }

    // Compute world centroid
    const centroid = new THREE.Vector3();
    let count = 0;
    scene.updateMatrixWorld(true);
    for (const id of rootSelectedIds) {
      const obj = modelObjectsRef.current.get(id);
      if (obj) {
        obj.getWorldPosition(_tmpVec);
        centroid.add(_tmpVec);
        count++;
      }
    }
    if (count === 0) {
      tc.detach();
      return;
    }
    centroid.divideScalar(count);
    pivot.position.copy(centroid);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
    tc.attach(pivot);
  }, []);

  // Update node properties
  const updateNode = useCallback(
    (id: string, patch: Partial<SceneNode3D>, commitHistory = false) => {
      setNodes((prev) => {
        const nextNodes = prev.map((n) => {
          if (n.id !== id) return n;
          const next = { ...n, ...patch };
          const obj = modelObjectsRef.current.get(id);
          if (obj) {
            if (patch.position) obj.position.set(...patch.position);
            if (patch.rotation) {
              obj.rotation.set(
                THREE.MathUtils.degToRad(patch.rotation[0]),
                THREE.MathUtils.degToRad(patch.rotation[1]),
                THREE.MathUtils.degToRad(patch.rotation[2])
              );
            }
            if (patch.scale) obj.scale.set(...patch.scale);
            if (patch.visible !== undefined) obj.visible = patch.visible;
            if (
              patch.color !== undefined ||
              patch.roughness !== undefined ||
              patch.metalness !== undefined ||
              patch.lightIntensity !== undefined
            ) {
              applyColorAndPbrToGroup(
                obj,
                next.color,
                next.roughness,
                next.metalness,
                next.lightIntensity
              );
            }
          }
          return next;
        });
        persistNodesToProject(nextNodes, !commitHistory);
        return nextNodes;
      });
    },
    [persistNodesToProject]
  );

  // Reparent a node while preserving its world transform
  const reparentNode = useCallback(
    (childId: string, newParentId: string | null) => {
      if (childId === newParentId) return;
      setNodes((prev) => {
        const map = new Map<string, SceneNode3D>();
        prev.forEach((n) => map.set(n.id, n));
        const childNode = map.get(childId);
        if (!childNode) return prev;
        if ((childNode.parentId || null) === newParentId) return prev;
        if (newParentId && isDescendantOf(newParentId, childId, map)) {
          setImportError('امکان انتقال یک گروه به درون زیرمجموعه خودش وجود ندارد.');
          return prev;
        }

        const childObj = modelObjectsRef.current.get(childId);
        const newParentObj = newParentId ? modelObjectsRef.current.get(newParentId) : sceneRef.current;

        let localPos = childNode.position;
        let localRot = childNode.rotation;
        let localScale = childNode.scale;

        if (childObj && newParentObj && sceneRef.current) {
          sceneRef.current.updateMatrixWorld(true);
          newParentObj.attach(childObj);
          localPos = [
            Number(childObj.position.x.toFixed(3)),
            Number(childObj.position.y.toFixed(3)),
            Number(childObj.position.z.toFixed(3)),
          ];
          localRot = [
            Number(THREE.MathUtils.radToDeg(childObj.rotation.x).toFixed(1)),
            Number(THREE.MathUtils.radToDeg(childObj.rotation.y).toFixed(1)),
            Number(THREE.MathUtils.radToDeg(childObj.rotation.z).toFixed(1)),
          ];
          localScale = [
            Number(childObj.scale.x.toFixed(3)),
            Number(childObj.scale.y.toFixed(3)),
            Number(childObj.scale.z.toFixed(3)),
          ];
        }

        const next = prev.map((n) =>
          n.id === childId
            ? {
                ...n,
                parentId: newParentId,
                position: localPos,
                rotation: localRot,
                scale: localScale,
              }
            : n
        );
        persistNodesToProject(next);
        return next;
      });

      if (newParentId) {
        setExpandedNodeIds((prev) => ({ ...prev, [newParentId]: true }));
      }
    },
    [persistNodesToProject]
  );

  // Create real Group node around selected items (or empty group)
  const handleGroupSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    const currentNodes = nodesRef.current;
    const map = new Map<string, SceneNode3D>();
    currentNodes.forEach((n) => map.set(n.id, n));

    const groupId = `node_group_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const groupCount = currentNodes.filter((n) => n.kind === 'group').length + 1;

    if (ids.length === 0) {
      const emptyGroup: SceneNode3D = {
        id: groupId,
        name: `گروه ${groupCount}`,
        kind: 'group',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#fbbf24',
        visible: true,
        locked: false,
        parentId: null,
        layerId: 'default',
      };
      setNodes((prev) => {
        const next = [...prev, emptyGroup];
        persistNodesToProject(next);
        return next;
      });
      setSelectedIds([groupId]);
      setExpandedNodeIds((prev) => ({ ...prev, [groupId]: true }));
      return;
    }

    // Group selected nodes at their world centroid
    const selectedSet = new Set(ids);
    const rootSelected = ids.filter((id) => {
      let cur = map.get(id);
      while (cur && cur.parentId) {
        if (selectedSet.has(cur.parentId)) return false;
        cur = map.get(cur.parentId);
      }
      return true;
    });

    const centroid = new THREE.Vector3();
    let cnt = 0;
    if (sceneRef.current) sceneRef.current.updateMatrixWorld(true);
    for (const id of rootSelected) {
      const obj = modelObjectsRef.current.get(id);
      if (obj) {
        obj.getWorldPosition(_tmpVec);
        centroid.add(_tmpVec);
        cnt++;
      } else {
        const n = map.get(id);
        if (n) {
          centroid.add(new THREE.Vector3(...n.position));
          cnt++;
        }
      }
    }
    if (cnt > 0) centroid.divideScalar(cnt);

    const groupNode: SceneNode3D = {
      id: groupId,
      name: `گروه ${groupCount}`,
      kind: 'group',
      position: [
        Number(centroid.x.toFixed(3)),
        Number(centroid.y.toFixed(3)),
        Number(centroid.z.toFixed(3)),
      ],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#fbbf24',
      visible: true,
      locked: false,
      parentId: null,
      layerId: 'default',
    };

    const groupObj = new THREE.Group();
    groupObj.position.copy(centroid);
    groupObj.userData.nodeId = groupId;
    if (sceneRef.current) {
      sceneRef.current.add(groupObj);
      groupObj.updateMatrixWorld(true);
    }
    modelObjectsRef.current.set(groupId, groupObj);

    const nextNodes: SceneNode3D[] = [
      ...currentNodes.map((n) => {
        if (!rootSelected.includes(n.id)) return n;
        const obj = modelObjectsRef.current.get(n.id);
        if (obj) {
          groupObj.attach(obj);
          return {
            ...n,
            parentId: groupId,
            position: [
              Number(obj.position.x.toFixed(3)),
              Number(obj.position.y.toFixed(3)),
              Number(obj.position.z.toFixed(3)),
            ] as [number, number, number],
            rotation: [
              Number(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1)),
            ] as [number, number, number],
            scale: [
              Number(obj.scale.x.toFixed(3)),
              Number(obj.scale.y.toFixed(3)),
              Number(obj.scale.z.toFixed(3)),
            ] as [number, number, number],
          };
        }
        return {
          ...n,
          parentId: groupId,
          position: [
            Number((n.position[0] - centroid.x).toFixed(3)),
            Number((n.position[1] - centroid.y).toFixed(3)),
            Number((n.position[2] - centroid.z).toFixed(3)),
          ] as [number, number, number],
        };
      }),
      groupNode,
    ];

    setNodes(nextNodes);
    persistNodesToProject(nextNodes);
    setSelectedIds([groupId]);
    setExpandedNodeIds((prev) => ({ ...prev, [groupId]: true }));
  }, [persistNodesToProject]);

  // Ungroup a selected group node, preserving children world transforms
  const handleUngroupSelected = useCallback(() => {
    const targetId = primarySelectedId;
    if (!targetId) return;
    const grp = nodeMap.get(targetId);
    if (!grp || grp.kind !== 'group') return;

    const grpParentId = grp.parentId || null;
    const grpParentObj = grpParentId
      ? modelObjectsRef.current.get(grpParentId) || sceneRef.current
      : sceneRef.current;

    if (sceneRef.current) sceneRef.current.updateMatrixWorld(true);

    const releasedChildIds: string[] = [];
    const nextNodes = nodes
      .filter((n) => n.id !== targetId)
      .map((n) => {
        if (n.parentId !== targetId) return n;
        releasedChildIds.push(n.id);
        const childObj = modelObjectsRef.current.get(n.id);
        if (childObj && grpParentObj) {
          grpParentObj.attach(childObj);
          return {
            ...n,
            parentId: grpParentId,
            position: [
              Number(childObj.position.x.toFixed(3)),
              Number(childObj.position.y.toFixed(3)),
              Number(childObj.position.z.toFixed(3)),
            ] as [number, number, number],
            rotation: [
              Number(THREE.MathUtils.radToDeg(childObj.rotation.x).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(childObj.rotation.y).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(childObj.rotation.z).toFixed(1)),
            ] as [number, number, number],
            scale: [
              Number(childObj.scale.x.toFixed(3)),
              Number(childObj.scale.y.toFixed(3)),
              Number(childObj.scale.z.toFixed(3)),
            ] as [number, number, number],
          };
        }
        return { ...n, parentId: grpParentId };
      });

    const grpObj = modelObjectsRef.current.get(targetId);
    if (grpObj) {
      grpObj.parent?.remove(grpObj);
      modelObjectsRef.current.delete(targetId);
    }

    setNodes(nextNodes);
    persistNodesToProject(nextNodes);
    setSelectedIds(releasedChildIds);
  }, [primarySelectedId, nodeMap, nodes, persistNodesToProject]);

  // Duplicate node(s)
  const duplicateNodes = useCallback(
    (idsToClone: string[]) => {
      if (idsToClone.length === 0) return;
      const newIds: string[] = [];
      setNodes((prev) => {
        const map = new Map<string, SceneNode3D>();
        prev.forEach((n) => map.set(n.id, n));
        const clones: SceneNode3D[] = [];

        const cloneSubtree = (id: string, targetParentId: string | null, offset: boolean) => {
          const orig = map.get(id);
          if (!orig) return;
          const nextId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          if (offset) newIds.push(nextId);
          clones.push({
            ...orig,
            id: nextId,
            name: offset ? `${orig.name} (کپی)` : orig.name,
            parentId: targetParentId,
            position: offset
              ? [
                  Number((orig.position[0] + 0.9).toFixed(3)),
                  orig.position[1],
                  Number((orig.position[2] + 0.9).toFixed(3)),
                ]
              : [...orig.position],
            rotation: [...orig.rotation],
            scale: [...orig.scale],
          });
          prev
            .filter((c) => c.parentId === id)
            .forEach((child) => cloneSubtree(child.id, nextId, false));
        };

        const set = new Set(idsToClone);
        const topLevel = idsToClone.filter((id) => {
          let cur = map.get(id);
          while (cur && cur.parentId) {
            if (set.has(cur.parentId)) return false;
            cur = map.get(cur.parentId);
          }
          return true;
        });

        topLevel.forEach((id) => {
          const orig = map.get(id);
          cloneSubtree(id, orig?.parentId ?? null, true);
        });

        const next = [...prev, ...clones];
        persistNodesToProject(next);
        return next;
      });
      if (newIds.length > 0) setSelectedIds(newIds);
    },
    [persistNodesToProject]
  );

  // Delete node(s) + all descendants cleanly
  const deleteNodes = useCallback(
    (idsToDelete: string[]) => {
      if (idsToDelete.length === 0) return;
      const toRemove = new Set<string>(idsToDelete);
      let added = true;
      while (added) {
        added = false;
        nodesRef.current.forEach((n) => {
          if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
            toRemove.add(n.id);
            added = true;
          }
        });
      }

      const removedPairs: Array<{ nodeId: string; assetId: string }> = [];
      nodesRef.current.forEach((n) => {
        if (toRemove.has(n.id) && n.assetId) {
          removedPairs.push({ nodeId: n.id, assetId: n.assetId });
        }
      });

      removedPairs.forEach((pair) => {
        void unlinkAssetFromScene(pair.assetId, pair.nodeId).catch(() => {});
      });

      toRemove.forEach((id) => {
        const obj = modelObjectsRef.current.get(id);
        if (obj) {
          obj.parent?.remove(obj);
          disposeObject3D(obj);
          modelObjectsRef.current.delete(id);
        }
        const mixer = mixersRef.current.get(id);
        if (mixer) {
          mixer.stopAllAction();
          mixersRef.current.delete(id);
        }
      });

      transformRef.current?.detach();
      setSelectedIds((prev) => prev.filter((id) => !toRemove.has(id)));
      setNodes((prev) => {
        const next = prev.filter((n) => !toRemove.has(n.id));
        onUpdateProject?.((proj) => ({
          ...proj,
          studio3dNodes: next,
          assets: proj.assets.map((a) => ({
            ...a,
            linkedSceneNodeIds: (a.linkedSceneNodeIds || []).filter((nid) => !toRemove.has(nid)),
          })),
          updatedAt: Date.now(),
        }));
        return next;
      });
    },
    [onUpdateProject]
  );

  // Add Basic Primitive
  const addPrimitiveNode = (primitiveType: Primitive3DType, label: string, color: string) => {
    const count = nodes.filter((n) => n.primitiveType === primitiveType).length + 1;
    const id = `node_prim_${primitiveType}_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
    const parentForNew =
      selectedNode && selectedNode.kind === 'group' ? selectedNode.id : null;

    const newNode: SceneNode3D = {
      id,
      name: `${label.split(' ')[0]} ${count}`,
      kind: 'primitive',
      primitiveType,
      position: [
        Number(((Math.random() - 0.5) * 3.5).toFixed(2)),
        0,
        Number(((Math.random() - 0.5) * 3.5).toFixed(2)),
      ],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color,
      roughness: 0.4,
      metalness: 0.25,
      visible: true,
      locked: false,
      parentId: parentForNew,
      layerId: 'props',
    };
    setNodes((prev) => {
      const next = [...prev, newNode];
      persistNodesToProject(next);
      return next;
    });
    setSelectedIds([id]);
  };

  // Add PointLight
  const addLightNode = () => {
    const count = nodes.filter((n) => n.kind === 'light').length + 1;
    const id = `node_light_${Date.now()}`;
    const newNode: SceneNode3D = {
      id,
      name: `نور نقطه‌ای ${count}`,
      kind: 'light',
      position: [0, 3, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#fbbf24',
      lightIntensity: 4,
      visible: true,
      locked: false,
      parentId: null,
      layerId: 'lighting',
    };
    setNodes((prev) => {
      const next = [...prev, newNode];
      persistNodesToProject(next);
      return next;
    });
    setSelectedIds([id]);
  };

  // Add 3D Procedural Preset
  const addPresetModel = (preset: Model3DPresetType, label: string, defaultColor: string) => {
    const count = nodes.filter((n) => n.preset === preset).length + 1;
    const id = `node_${preset}_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
    const parentForNew =
      selectedNode && selectedNode.kind === 'group' ? selectedNode.id : null;

    const newNode: SceneNode3D = {
      id,
      name: `${label} ${count}`,
      kind: 'model-preset',
      preset,
      position: [
        Number(((Math.random() - 0.5) * 4).toFixed(2)),
        0,
        Number(((Math.random() - 0.5) * 4).toFixed(2)),
      ],
      rotation: [0, Math.round(Math.random() * 360), 0],
      scale: [1, 1, 1],
      color: defaultColor,
      roughness: 0.42,
      metalness: 0.25,
      visible: true,
      locked: false,
      parentId: parentForNew,
      layerId: 'props',
    };
    setNodes((prev) => {
      const next = [...prev, newNode];
      persistNodesToProject(next);
      return next;
    });
    setSelectedIds([id]);
  };

  // Spawn an existing project 3D asset from IndexedDB / project.assets
  const spawnExistingAssetToScene = (asset: RayanAsset) => {
    const id = `node_asset_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const parentForNew =
      selectedNode && selectedNode.kind === 'group' ? selectedNode.id : null;
    const [spawnX, spawnY, spawnZ] = getNextImportedModelPosition(nodesRef.current);

    const newNode: SceneNode3D = {
      id,
      name: asset.name,
      kind: 'model-asset',
      assetId: asset.id,
      format: asset.format.toUpperCase(),
      position: [spawnX, spawnY, spawnZ],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#38bdf8',
      visible: true,
      locked: false,
      parentId: parentForNew,
      layerId: 'characters',
      animations: asset.modelMeta?.animationNames,
    };

    void linkAssetToScene(asset.id, project.activeSceneId, id).catch(() => {});

    setNodes((prev) => {
      const next = [...prev, newNode];
      onUpdateProject?.((proj) => ({
        ...proj,
        studio3dNodes: next,
        assets: proj.assets.map((a) =>
          a.id === asset.id
            ? {
                ...a,
                linkedSceneIds: Array.from(new Set([...(a.linkedSceneIds || []), proj.activeSceneId])),
                linkedSceneNodeIds: Array.from(new Set([...(a.linkedSceneNodeIds || []), id])),
              }
            : a
        ),
        updatedAt: Date.now(),
      }));
      return next;
    });
    setSelectedIds([id]);
    if (orbitRef.current) {
      orbitRef.current.target.set(spawnX, 0.75, spawnZ);
    }
  };

  // Handle uploaded 3D files & companion textures/MTL/BIN/ZIP via IndexedDB v3 asset pipeline
  const handleImport3DFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImportError(null);
    setImportStatus(`در حال خواندن و ذخیره ${files.length} فایل و وابستگی‌ها در IndexedDB...`);

    const addedNodeIds: string[] = [];
    const newNodes: SceneNode3D[] = [];

    try {
      const result = await importAssetsFromFileList(files);
      if (result.errors.length > 0) {
        setImportError(result.errors.join(' | '));
      }

      for (const asset of result.assets) {
        if (asset.kind === 'audio') {
          await onAddAsset?.(asset);
          continue;
        }

        const nodeId = `node_asset_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        const [spawnX, spawnY, spawnZ] = getNextImportedModelPosition(
          [...nodesRef.current, ...newNodes],
        );

        await linkAssetToScene(asset.id, project.activeSceneId, nodeId).catch(() => {});
        const linkedAsset: RayanAsset = {
          ...asset,
          linkedSceneIds: [project.activeSceneId],
          linkedSceneNodeIds: [nodeId],
        };
        await onAddAsset?.(linkedAsset);

        const newNode: SceneNode3D = {
          id: nodeId,
          name: asset.name,
          kind: 'model-asset',
          assetId: asset.id,
          format: asset.format.toUpperCase(),
          position: [spawnX, spawnY, spawnZ],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          color: '#38bdf8',
          visible: true,
          locked: false,
          parentId: null,
          layerId: 'characters',
          animations: asset.modelMeta?.animationNames,
        };

        addedNodeIds.push(nodeId);
        newNodes.push(newNode);

        if (orbitRef.current) {
          orbitRef.current.target.set(spawnX, 0.75, spawnZ);
        }
      }

      if (newNodes.length > 0) {
        setNodes((prev) => {
          const next = [...prev, ...newNodes];
          persistNodesToProject(next);
          return next;
        });
        setSelectedIds(addedNodeIds);
        const totalVerts = result.assets
          .filter((a) => a.kind === 'model3d')
          .reduce((sum, a) => sum + (a.modelMeta?.vertexCount || 0), 0);
        setImportStatus(
          `${newNodes.length} دارایی (مدل و تصویر) ذخیره و به صحنه اضافه شد؛ ${totalVerts.toLocaleString()} رأس مدل سه‌بعدی.`
        );
      } else if (result.assets.length > 0) {
        setImportStatus(`${result.assets.length} دارایی در کتابخانه ذخیره شد.`);
      } else if (result.errors.length === 0) {
        setImportStatus(null);
      }
    } catch (err) {
      setImportStatus(null);
      setImportError(
        `خطا در بارگذاری مدل: ${err instanceof Error ? err.message : 'فرمت یا ساختار نامعتبر'}`
      );
    }
  };

  // Save scene explicitly to IndexedDB
  const handleExplicitSaveScene = () => {
    persistNodesToProject(nodesRef.current, false);
    setSaveFeedback(`صحنه با ${nodesRef.current.length} آبجکت در پروژه و IndexedDB ذخیره شد.`);
    setTimeout(() => setSaveFeedback(null), 2600);
  };

  // Export composed multi-model scene to binary GLB
  const handleExportSceneGLB = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const exportRoot = new THREE.Group();
    exportRoot.name = `${project.name || 'RayanScene'}`;

    nodesRef.current
      .filter((n) => !n.parentId || !nodeMap.has(n.parentId))
      .forEach((rootNode) => {
        const obj = modelObjectsRef.current.get(rootNode.id);
        if (obj && rootNode.visible) {
          exportRoot.add(obj.clone(true));
        }
      });

    if (exportRoot.children.length === 0) {
      setImportError('هیچ مدل فعالی برای خروجی گرفتن در صحنه وجود ندارد.');
      return;
    }

    const exporter = new GLTFExporter();
    exporter.parse(
      exportRoot,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${(project.name || 'rayan-scene').replace(/\s+/g, '_')}.glb`;
          a.click();
          URL.revokeObjectURL(url);
          setSaveFeedback('خروجی سه‌بعدی GLB کل صحنه با موفقیت تولید و دانلود شد.');
          setTimeout(() => setSaveFeedback(null), 2600);
        }
      },
      (err) => {
        setImportError(`خطا در خروجی GLB: ${err instanceof Error ? err.message : String(err)}`);
      },
      { binary: true }
    );
  };

  // Align selected objects along X or Y=0 or Z
  const handleAlignSelected = (axis: 'ground' | 'centerX' | 'centerZ') => {
    if (selectedIds.length === 0) return;
    setNodes((prev) => {
      const next = prev.map((n) => {
        if (!selectedIds.includes(n.id)) return n;
        const pos: [number, number, number] = [...n.position];
        if (axis === 'ground') pos[1] = 0;
        if (axis === 'centerX') pos[0] = 0;
        if (axis === 'centerZ') pos[2] = 0;
        const obj = modelObjectsRef.current.get(n.id);
        if (obj) obj.position.set(...pos);
        return { ...n, position: pos };
      });
      persistNodesToProject(next);
      return next;
    });
  };

  // --- Main Three.js Scene Initialization ---
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const isSoftwareGl = (() => {
      try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);
    scene.fog = new THREE.FogExp2(0x0b0e14, 0.018);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(7, 5.5, 9);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // Studio Environment Lighting
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.7);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.4);
    dirLight.position.set(8, 12, 6);
    dirLight.castShadow = !isSoftwareGl;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.02;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 45;
    dirLight.shadow.camera.left = -12;
    dirLight.shadow.camera.right = 12;
    dirLight.shadow.camera.top = 12;
    dirLight.shadow.camera.bottom = -12;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    fillLight.position.set(-8, 6, -6);
    scene.add(fillLight);

    // Ground Grid & Floor
    const grid = new THREE.GridHelper(40, 40, 0x38bdf8, 0x1e293b);
    grid.position.y = 0;
    scene.add(grid);

    const floorGeo = new THREE.PlaneGeometry(80, 80);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x090c12,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
    floor.receiveShadow = true;
    scene.add(floor);

    // Multi-selection pivot & BoxHelpers container
    const multiPivot = new THREE.Group();
    multiPivot.name = '__RayanMultiPivot__';
    scene.add(multiPivot);
    multiPivotRef.current = multiPivot;

    const selectionHelpers = new THREE.Group();
    selectionHelpers.name = '__RayanSelectionHelpers__';
    scene.add(selectionHelpers);
    selectionHelpersRef.current = selectionHelpers;

    // Controls
    const transformCtrl = new TransformControls(camera, renderer.domElement);
    transformCtrl.setMode('translate');
    transformCtrl.setSize(0.85);
    scene.add(transformCtrl.getHelper());
    transformRef.current = transformCtrl;

    const orbitCtrl = new OrbitControls(camera, renderer.domElement);
    orbitCtrl.enableDamping = !isSoftwareGl;
    orbitCtrl.dampingFactor = 0.05;
    orbitCtrl.maxPolarAngle = Math.PI / 2 - 0.02;
    orbitCtrl.minDistance = 1;
    orbitCtrl.maxDistance = 60;
    orbitCtrl.target.set(0, 0.8, 0);
    orbitRef.current = orbitCtrl;

    // TransformControls dragging-changed: disable OrbitControls + capture/commit multi-object transforms
    transformCtrl.addEventListener('dragging-changed', (event) => {
      const isDragging = Boolean(event.value);
      orbitCtrl.enabled = !isDragging;

      if (isDragging && transformCtrl.object === multiPivot) {
        scene.updateMatrixWorld(true);
        const pivotStartInv = multiPivot.matrixWorld.clone().invert();
        const currentMap = new Map<string, SceneNode3D>();
        nodesRef.current.forEach((n) => currentMap.set(n.id, n));

        const selectedSet = new Set(selectedIdsRef.current);
        const items: MultiDragSnapshot['items'] = [];

        selectedIdsRef.current.forEach((id) => {
          const n = currentMap.get(id);
          if (!n || isEffectiveLocked(id, currentMap)) return;
          // Skip child if ancestor is also selected
          let cur: SceneNode3D | undefined = n;
          while (cur && cur.parentId) {
            if (selectedSet.has(cur.parentId)) return;
            cur = currentMap.get(cur.parentId);
          }
          const obj = modelObjectsRef.current.get(id);
          if (!obj) return;
          const parentWorldInv = obj.parent
            ? obj.parent.matrixWorld.clone().invert()
            : new THREE.Matrix4().identity();
          items.push({
            nodeId: id,
            obj,
            worldStart: obj.matrixWorld.clone(),
            parentWorldInv,
          });
        });

        multiDragSnapshotRef.current = { pivotStartInv, items };
      } else if (!isDragging) {
        multiDragSnapshotRef.current = null;
        setNodes((latest) => {
          persistNodesToProject(latest);
          return latest;
        });
      }
    });

    // Update node transform(s) while gizmo moves
    transformCtrl.addEventListener('objectChange', () => {
      const targetObj = transformCtrl.object;
      if (!targetObj) return;

      if (targetObj === multiPivot && multiDragSnapshotRef.current) {
        multiPivot.updateMatrixWorld(true);
        const snap = multiDragSnapshotRef.current;
        _tmpMatA.multiplyMatrices(multiPivot.matrixWorld, snap.pivotStartInv);

        const updates = new Map<
          string,
          {
            position: [number, number, number];
            rotation: [number, number, number];
            scale: [number, number, number];
          }
        >();

        for (const item of snap.items) {
          _tmpMatB.multiplyMatrices(_tmpMatA, item.worldStart);
          _tmpMatB.premultiply(item.parentWorldInv);
          _tmpMatB.decompose(_tmpVec, _tmpQuat, _tmpScale);

          item.obj.position.copy(_tmpVec);
          item.obj.quaternion.copy(_tmpQuat);
          item.obj.scale.copy(_tmpScale);
          item.obj.updateMatrixWorld(true);

          _tmpEuler.setFromQuaternion(_tmpQuat, 'XYZ');
          updates.set(item.nodeId, {
            position: [
              Number(_tmpVec.x.toFixed(3)),
              Number(_tmpVec.y.toFixed(3)),
              Number(_tmpVec.z.toFixed(3)),
            ],
            rotation: [
              Number(THREE.MathUtils.radToDeg(_tmpEuler.x).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(_tmpEuler.y).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(_tmpEuler.z).toFixed(1)),
            ],
            scale: [
              Number(_tmpScale.x.toFixed(3)),
              Number(_tmpScale.y.toFixed(3)),
              Number(_tmpScale.z.toFixed(3)),
            ],
          });
        }

        if (updates.size > 0) {
          setNodes((prev) =>
            prev.map((n) => {
              const patch = updates.get(n.id);
              return patch ? { ...n, ...patch } : n;
            })
          );
        }
        return;
      }

      if (targetObj.userData?.nodeId) {
        const id = targetObj.userData.nodeId as string;
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== id) return n;
            return {
              ...n,
              position: [
                Number(targetObj.position.x.toFixed(3)),
                Number(targetObj.position.y.toFixed(3)),
                Number(targetObj.position.z.toFixed(3)),
              ],
              rotation: [
                Number(THREE.MathUtils.radToDeg(targetObj.rotation.x).toFixed(1)),
                Number(THREE.MathUtils.radToDeg(targetObj.rotation.y).toFixed(1)),
                Number(THREE.MathUtils.radToDeg(targetObj.rotation.z).toFixed(1)),
              ],
              scale: [
                Number(targetObj.scale.x.toFixed(3)),
                Number(targetObj.scale.y.toFixed(3)),
                Number(targetObj.scale.z.toFixed(3)),
              ],
            };
          })
        );
      }
    });

    // Raycasting on Viewport Click for Independent & Multi-Object Selection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (transformCtrl.dragging) return;
      const movedDist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (movedDist > 5) return; // Ignore camera orbit drags

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);

      const candidates: THREE.Object3D[] = [];
      modelObjectsRef.current.forEach((obj) => {
        if (obj.visible) candidates.push(obj);
      });

      const hits = raycaster.intersectObjects(candidates, true);
      if (hits.length > 0) {
        let cur: THREE.Object3D | null = hits[0].object;
        while (cur && !cur.userData?.nodeId) {
          cur = cur.parent;
        }
        if (cur && cur.userData.nodeId) {
          const hitId = cur.userData.nodeId as string;
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            setSelectedIds((prev) =>
              prev.includes(hitId) ? prev.filter((id) => id !== hitId) : [...prev, hitId]
            );
          } else {
            setSelectedIds([hitId]);
          }
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        setSelectedIds([]);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Resize Observer
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // Animation & BoxHelper Tick Loop
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const dt = clockRef.current.getDelta();

      if (isPlayingAnimRef.current) {
        mixersRef.current.forEach((mixer) => {
          mixer.update(dt * animSpeedRef.current);
        });
      }

      boxHelpersMapRef.current.forEach((helper) => {
        helper.update();
      });

      orbitCtrl.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      transformCtrl.dispose();
      orbitCtrl.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      modelObjectsRef.current.forEach((obj) => disposeObject3D(obj));
      modelObjectsRef.current.clear();
      boxHelpersMapRef.current.forEach((h) => h.dispose());
      boxHelpersMapRef.current.clear();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [persistNodesToProject]);

  // --- Sync Three.js Scene Graph Objects & Parent/Child Hierarchy ---
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    let isCancelled = false;

    const syncNodes = async () => {
      const activeIds = new Set(nodes.map((n) => n.id));
      const currentMap = new Map<string, SceneNode3D>();
      nodes.forEach((n) => currentMap.set(n.id, n));

      // 1. Remove deleted nodes & dispose GPU resources
      modelObjectsRef.current.forEach((obj, id) => {
        if (!activeIds.has(id)) {
          obj.parent?.remove(obj);
          disposeObject3D(obj);
          modelObjectsRef.current.delete(id);
          const mixer = mixersRef.current.get(id);
          if (mixer) {
            mixer.stopAllAction();
            mixersRef.current.delete(id);
          }
        }
      });

      // 2. Build missing Three.js objects for every node
      for (const node of nodes) {
        if (isCancelled) return;
        let obj = modelObjectsRef.current.get(node.id);

        if (!obj) {
          if (node.kind === 'group') {
            obj = new THREE.Group();
          } else if (node.kind === 'light') {
            obj = buildLight3DGroup(node.color, node.lightIntensity ?? 4);
          } else if (node.kind === 'primitive') {
            obj = buildPrimitive3DGroup(
              node.primitiveType || 'box',
              node.color,
              node.roughness ?? 0.4,
              node.metalness ?? 0.25
            );
          } else if (node.kind === 'model-asset' && node.assetId) {
            const format = (node.format?.toLowerCase() || 'glb') as AssetFormat;
            const imageFormat = ['png', 'jpg', 'webp', 'svg'].includes(format);
            const asset: RayanAsset = projectAssetsRef.current.find((a) => a.id === node.assetId) || {
              id: node.assetId,
              name: node.name,
              kind: imageFormat ? 'image' : 'model3d',
              format,
              dataUrl: `idb://${node.assetId}`,
              sizeBytes: 0,
              createdAt: 0,
              storedInIdb: true,
            };
            try {
              obj = asset.kind === 'image'
                ? await buildImageAssetPlane(asset)
                : await loadCustom3DAsset(asset, node.color);
            } catch (err) {
              setImportError(
                `خطا در رندر مدل «${node.name}»: ${err instanceof Error ? err.message : 'فایل سه‌بعدی نامعتبر است'}`
              );
              continue;
            }
          } else {
            obj = buildProceduralPresetGroup(node.preset || 'crate', node.color);
          }

          if (isCancelled) {
            disposeObject3D(obj);
            return;
          }

          obj.name = node.name;
          obj.userData.nodeId = node.id;
          obj.traverse((child) => {
            child.userData.nodeId = node.id;
          });

          if (obj.userData.animations && obj.userData.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(obj);
            obj.userData.animations.forEach((clip: THREE.AnimationClip) => {
              mixer.clipAction(clip).play();
            });
            mixersRef.current.set(node.id, mixer);
          }

          modelObjectsRef.current.set(node.id, obj);
        }
      }

      if (isCancelled) return;

      // 3. Reconstruct true Parent-Child hierarchy & apply local transforms
      for (const node of nodes) {
        const obj = modelObjectsRef.current.get(node.id);
        if (!obj) continue;

        const validParentId =
          node.parentId &&
          node.parentId !== node.id &&
          modelObjectsRef.current.has(node.parentId) &&
          !isDescendantOf(node.parentId, node.id, currentMap)
            ? node.parentId
            : null;

        const desiredParent: THREE.Object3D = validParentId
          ? modelObjectsRef.current.get(validParentId)!
          : scene;

        if (obj.parent !== desiredParent) {
          desiredParent.add(obj);
        }

        if (!transformRef.current?.dragging) {
          obj.position.set(...node.position);
          obj.rotation.set(
            THREE.MathUtils.degToRad(node.rotation[0]),
            THREE.MathUtils.degToRad(node.rotation[1]),
            THREE.MathUtils.degToRad(node.rotation[2])
          );
          obj.scale.set(...node.scale);
        }
        obj.visible = node.visible;
        obj.name = node.name;
      }

      // Frame every newly imported model/image together. Focusing only the last
      // selected node made the other imported assets appear to be missing.
      scene.updateMatrixWorld(true);
      const pendingFrameNodes = nodes.filter(
        (node) => node.kind === 'model-asset' && !autoFramedNodeIdsRef.current.has(node.id)
      );
      if (pendingFrameNodes.length > 0) {
        const combinedBounds = new THREE.Box3();
        const framedIds: string[] = [];
        for (const node of pendingFrameNodes) {
          const object = modelObjectsRef.current.get(node.id);
          if (!object) continue;
          const bounds = new THREE.Box3().setFromObject(object);
          if (!bounds.isEmpty()) {
            combinedBounds.union(bounds);
            framedIds.push(node.id);
          }
        }
        const camera = cameraRef.current;
        const controls = orbitRef.current;
        if (!combinedBounds.isEmpty() && camera && controls) {
          const sphere = combinedBounds.getBoundingSphere(new THREE.Sphere());
          const center = sphere.center;
          const radius = Math.max(sphere.radius, 0.1);
          const verticalFov = THREE.MathUtils.degToRad(camera.fov);
          const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
          const fitDistance =
            (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.3;
          const viewDirection = camera.position.clone().sub(controls.target);
          if (viewDirection.lengthSq() < 1e-8) viewDirection.set(1, 0.7, 1);
          viewDirection.normalize();
          controls.target.copy(center);
          camera.position.copy(center).addScaledVector(viewDirection, fitDistance);
          camera.near = Math.max(0.01, fitDistance / 100);
          camera.far = Math.max(1000, fitDistance * 20);
          camera.updateProjectionMatrix();
          controls.update();
          framedIds.forEach((id) => autoFramedNodeIdsRef.current.add(id));
        } else if (pendingFrameNodes.length > 0) {
          const failedNames = pendingFrameNodes
            .filter((node) => !modelObjectsRef.current.has(node.id))
            .map((node) => node.name);
          if (failedNames.length > 0) {
            setImportError(`دارایی‌های زیر هنوز در صحنه بارگذاری نشده‌اند: ${failedNames.join('، ')}`);
          }
        }
      }

      syncTransformGizmoAttachment();
    };

    void syncNodes();

    return () => {
      isCancelled = true;
    };
  }, [nodes, syncTransformGizmoAttachment]);

  // --- Sync Selection BoxHelpers & TransformControls Attachment ---
  useEffect(() => {
    const helpersGroup = selectionHelpersRef.current;
    if (helpersGroup) {
      const selectedSet = new Set(selectedIds);
      // Remove stale helpers
      boxHelpersMapRef.current.forEach((helper, id) => {
        if (!selectedSet.has(id) || !modelObjectsRef.current.has(id)) {
          helpersGroup.remove(helper);
          helper.dispose();
          boxHelpersMapRef.current.delete(id);
        }
      });

      // Add or color helpers for every selected object
      selectedIds.forEach((id, idx) => {
        const obj = modelObjectsRef.current.get(id);
        if (!obj) return;
        const isPrimary = idx === selectedIds.length - 1;
        const hex = isPrimary ? 0x38bdf8 : 0xfbbf24;
        let helper = boxHelpersMapRef.current.get(id);
        if (!helper) {
          helper = new THREE.BoxHelper(obj, hex);
          helpersGroup.add(helper);
          boxHelpersMapRef.current.set(id, helper);
        } else {
          (helper.material as THREE.LineBasicMaterial).color.setHex(hex);
          helper.update();
        }
      });
    }

    syncTransformGizmoAttachment();
  }, [selectedIds, nodes, syncTransformGizmoAttachment]);

  // Keyboard hotkeys (W, E, R, F, Delete, Ctrl+G, Ctrl+D, Escape)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'w') setTransformMode('translate');
      else if (key === 'e') setTransformMode('rotate');
      else if (key === 'r') setTransformMode('scale');
      else if (key === 'escape') setSelectedIds([]);
      else if ((e.ctrlKey || e.metaKey) && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) handleUngroupSelected();
        else handleGroupSelected();
      } else if ((e.ctrlKey || e.metaKey) && key === 'd' && selectedIdsRef.current.length > 0) {
        e.preventDefault();
        duplicateNodes(selectedIdsRef.current);
      } else if (key === 'f' && primarySelectedId) {
        const obj = modelObjectsRef.current.get(primarySelectedId);
        if (obj && orbitRef.current && sceneRef.current) {
          sceneRef.current.updateMatrixWorld(true);
          obj.getWorldPosition(_tmpVec);
          orbitRef.current.target.copy(_tmpVec);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length > 0) {
        e.preventDefault();
        deleteNodes(selectedIdsRef.current);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [primarySelectedId, handleGroupSelected, handleUngroupSelected, duplicateNodes, deleteNodes]);

  // Handle Tree Row Click (single, Ctrl/Cmd toggle, Shift range)
  const handleTreeRowClick = (e: React.MouseEvent, nodeId: string) => {
    if (e.shiftKey && primarySelectedId) {
      const startIdx = flattenedTreeIds.indexOf(primarySelectedId);
      const endIdx = flattenedTreeIds.indexOf(nodeId);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeIds = flattenedTreeIds.slice(from, to + 1);
        setSelectedIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) =>
        prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
      );
      return;
    }
    setSelectedIds([nodeId]);
  };

  // Recursive Tree Node Renderer
  const renderHierarchyNode = (node: SceneNode3D, depth = 0): React.ReactNode => {
    const children = childrenByParent.get(node.id) || [];
    const hasChildren = children.length > 0 || node.kind === 'group';
    const isExpanded = expandedNodeIds[node.id] ?? true;
    const isSelected = selectedIds.includes(node.id);
    const effLocked = isEffectiveLocked(node.id, nodeMap);

    const q = searchQuery.trim().toLowerCase();
    const matchesSelf =
      !q ||
      node.name.toLowerCase().includes(q) ||
      (node.format && node.format.toLowerCase().includes(q));
    const hasMatchDescendant = (id: string): boolean => {
      const ch = childrenByParent.get(id) || [];
      return ch.some(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.format && c.format.toLowerCase().includes(q)) ||
          hasMatchDescendant(c.id)
      );
    };
    if (q && !matchesSelf && !hasMatchDescendant(node.id)) return null;

    return (
      <div key={node.id} className="space-y-0.5">
        <div
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            setDraggedNodeId(node.id);
            e.dataTransfer.setData('text/plain', node.id);
          }}
          onDragOver={(e) => {
            if (draggedNodeId && draggedNodeId !== node.id) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggedNodeId && draggedNodeId !== node.id) {
              reparentNode(draggedNodeId, node.id);
            }
            setDraggedNodeId(null);
          }}
          onDragEnd={() => setDraggedNodeId(null)}
          onClick={(e) => handleTreeRowClick(e, node.id)}
          style={{ paddingRight: `${8 + depth * 14}px` }}
          className={`group flex items-center justify-between gap-1 pl-1.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
            isSelected
              ? 'bg-sky-500/20 border border-sky-500/45 text-sky-100'
              : 'border border-transparent text-slate-300 hover:bg-slate-800/70'
          }`}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedNodeIds((prev) => ({ ...prev, [node.id]: !isExpanded }));
                }}
                className="p-0.5 text-slate-400 hover:text-slate-100 shrink-0"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}

            {node.kind === 'group' ? (
              <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : node.kind === 'light' ? (
              <Lightbulb className="w-3.5 h-3.5 text-yellow-300 shrink-0" />
            ) : node.kind === 'primitive' ? (
              <Shapes className="w-3.5 h-3.5 shrink-0" style={{ color: node.color }} />
            ) : (
              <Box className="w-3.5 h-3.5 shrink-0" style={{ color: node.color }} />
            )}

            <span className="truncate font-medium">{node.name}</span>

            {node.format && (
              <span className="text-[9px] font-mono px-1 rounded bg-slate-800 text-slate-400 shrink-0">
                {node.format}
              </span>
            )}
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updateNode(node.id, { visible: !node.visible }, true);
              }}
              className="p-1 text-slate-400 hover:text-slate-100"
              title={node.visible ? 'پنهان کردن' : 'نمایش دادن'}
            >
              {node.visible ? (
                <Eye className="w-3 h-3 text-emerald-400" />
              ) : (
                <EyeOff className="w-3 h-3 text-slate-500" />
              )}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updateNode(node.id, { locked: !node.locked }, true);
              }}
              className="p-1 text-slate-400 hover:text-slate-100"
              title={effLocked ? 'قفل شده' : 'قفل کردن'}
            >
              {node.locked ? (
                <Lock className="w-3 h-3 text-amber-400" />
              ) : (
                <Unlock className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100" />
              )}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                duplicateNodes([node.id]);
              }}
              className="p-1 text-slate-500 hover:text-sky-300 opacity-0 group-hover:opacity-100"
              title="کپی"
            >
              <Copy className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteNodes([node.id]);
              }}
              className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100"
              title="حذف"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {isExpanded && children.length > 0 && (
          <div className="space-y-0.5">{children.map((ch) => renderHierarchyNode(ch, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full w-full bg-[#0B0E14] text-slate-100 overflow-hidden select-none">
      {/* Hidden File Input for 3D Formats */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".glb,.gltf,.fbx,.obj,.mtl,.bin,.stl,.usd,.usdz,.ply,.png,.jpg,.jpeg,.webp,.svg,.zip"
        className="hidden"
        onChange={(e) => {
          void handleImport3DFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Left Sidebar: Real Scene Hierarchy Tree + Creation Palette */}
      <aside className="w-full lg:w-84 h-80 lg:h-full shrink-0 border-b lg:border-b-0 lg:border-l border-slate-800 bg-[#0E121B] flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-800/80 bg-[#121723] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-sky-400" />
            <h2 className="text-xs font-bold text-slate-100">سلسله‌مراتب صحنه (Hierarchy)</h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
            {nodes.length} گره
          </span>
        </div>

        {/* Search + Actions */}
        <div className="p-2 border-b border-slate-800 space-y-2 bg-[#10141F]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute right-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="جستجو در گره‌ها، گروه‌ها و فرمت‌ها..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-2 pr-8 py-1.5 rounded-lg bg-[#080B10] border border-slate-700/80 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-[11px] font-bold hover:bg-sky-400 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              ورود مدل (GLB/FBX/OBJ/STL/USD)
            </button>
            <button
              type="button"
              onClick={handleGroupSelected}
              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-amber-300 hover:text-amber-200 cursor-pointer"
              title="ایجاد گروه / گروه‌بندی انتخاب‌شده‌ها (Ctrl+G)"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            {selectedNode?.kind === 'group' && (
              <button
                type="button"
                onClick={handleUngroupSelected}
                className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-sky-300 hover:text-sky-200 cursor-pointer"
                title="لغو گروه (Ctrl+Shift+G)"
              >
                <Ungroup className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Multi-select quick bar */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
            <span>
              انتخاب‌شده: <strong className="text-sky-300">{selectedIds.length}</strong> (Ctrl/Shift + کلیک)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds(nodes.filter((n) => n.kind !== 'group').map((n) => n.id))}
                className="hover:text-sky-300 cursor-pointer"
              >
                انتخاب همه
              </button>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="hover:text-red-300 cursor-pointer"
                >
                  لغو
                </button>
              )}
            </div>
          </div>

          {importStatus && (
            <div className="p-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[11px] text-emerald-300 flex items-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{importStatus}</span>
            </div>
          )}

          {importError && (
            <div className="p-2 rounded-lg border border-red-500/40 bg-red-500/10 text-[11px] text-red-300 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{importError}</span>
            </div>
          )}
        </div>

        {/* Recursive Tree List with Root Dropzone */}
        <div
          className="flex-1 overflow-y-auto p-2 space-y-1"
          onDragOver={(e) => {
            if (draggedNodeId) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (draggedNodeId) {
              reparentNode(draggedNodeId, null);
              setDraggedNodeId(null);
            }
          }}
        >
          {rootNodes.map((n) => renderHierarchyNode(n, 0))}
          {draggedNodeId && (
            <div className="mt-2 py-2 border border-dashed border-sky-500/50 rounded-lg text-center text-[10px] text-sky-300">
              رها کردن در ریشه صحنه (Root)
            </div>
          )}
        </div>

        {/* Tabbed Creation Palette (Primitives / Procedural / Project Assets) */}
        <div className="border-t border-slate-800 bg-[#0C1018] flex flex-col">
          <div className="grid grid-cols-3 border-b border-slate-800 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setPaletteTab('primitives')}
              className={`py-2 text-center cursor-pointer transition-colors ${
                paletteTab === 'primitives'
                  ? 'bg-[#121826] text-sky-300 border-b-2 border-sky-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              اشکال اولیه
            </button>
            <button
              type="button"
              onClick={() => setPaletteTab('presets')}
              className={`py-2 text-center cursor-pointer transition-colors ${
                paletteTab === 'presets'
                  ? 'bg-[#121826] text-amber-300 border-b-2 border-amber-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              مدل رویه‌ای
            </button>
            <button
              type="button"
              onClick={() => setPaletteTab('assets')}
              className={`py-2 text-center cursor-pointer transition-colors ${
                paletteTab === 'assets'
                  ? 'bg-[#121826] text-emerald-300 border-b-2 border-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              فایل‌ها ({project3DAssets.length})
            </button>
          </div>

          <div className="p-2.5 max-h-44 overflow-y-auto">
            {paletteTab === 'primitives' && (
              <div className="grid grid-cols-2 gap-1.5">
                {PRIMITIVE_CATALOG.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => addPrimitiveNode(item.type, item.label, item.color)}
                    className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-slate-200 text-right truncate cursor-pointer flex items-center gap-1.5"
                  >
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate">+ {item.label.split(' ')[0]}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addLightNode}
                  className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-yellow-300 text-right truncate cursor-pointer flex items-center gap-1.5"
                >
                  <Lightbulb className="w-3 h-3 shrink-0" />
                  <span>+ نور نقطه‌ای</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds([]);
                    setTimeout(handleGroupSelected, 0);
                  }}
                  className="col-span-2 px-2 py-1.5 rounded bg-slate-800/70 hover:bg-slate-700 text-[11px] text-amber-300 text-center cursor-pointer"
                >
                  + ساخت گروه خالی (Group)
                </button>
              </div>
            )}

            {paletteTab === 'presets' && (
              <div className="grid grid-cols-2 gap-1.5">
                {PRESET_CATALOG.map((item) => (
                  <button
                    key={item.preset}
                    type="button"
                    onClick={() => addPresetModel(item.preset, item.label, item.color)}
                    className={`px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] ${item.textCls} text-right truncate cursor-pointer`}
                  >
                    + {item.label}
                  </button>
                ))}
              </div>
            )}

            {paletteTab === 'assets' && (
              <div className="space-y-1.5">
                {project3DAssets.length === 0 ? (
                  <div className="text-[11px] text-slate-500 text-center py-3">
                    هنوز مدل سه‌بعدی وارد نشده است. فایل GLB/FBX/OBJ را آپلود یا روی صحنه رها کنید.
                  </div>
                ) : (
                  project3DAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-slate-800/60 border border-slate-700/60"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-200 font-medium truncate">
                          {asset.name}
                        </div>
                        <div className="text-[9px] text-slate-400 font-mono">
                          {asset.format.toUpperCase()} • {asset.modelMeta?.vertexCount ?? 0} رأس
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => spawnExistingAssetToScene(asset)}
                        className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 text-[10px] font-semibold shrink-0 cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        افزودن
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Center: 3D Viewport with Multi-Object Transform Gizmos & Drag/Drop Import */}
      <main
        className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setIsDraggingFile(true);
          }
        }}
        onDragLeave={() => setIsDraggingFile(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            e.preventDefault();
            setIsDraggingFile(false);
            void handleImport3DFiles(e.dataTransfer.files);
          }
        }}
      >
        {/* Top Floating Viewport Control Toolbar */}
        <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex flex-wrap items-center justify-between gap-2">
          {/* Gizmo Modes */}
          <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-xl bg-[#0F1420]/95 border border-slate-700/80 shadow-xl">
            <button
              type="button"
              onClick={() => setTransformMode('translate')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                transformMode === 'translate'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="انتقال موقعیت (W)"
            >
              <Move className="w-3.5 h-3.5" />
              انتقال
            </button>
            <button
              type="button"
              onClick={() => setTransformMode('rotate')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                transformMode === 'rotate'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="چرخش زاویه (E)"
            >
              <RotateCw className="w-3.5 h-3.5" />
              چرخش
            </button>
            <button
              type="button"
              onClick={() => setTransformMode('scale')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                transformMode === 'scale'
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="تغییر مقیاس (R)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              مقیاس
            </button>

            <div className="w-px h-5 bg-slate-700 mx-1" />

            <button
              type="button"
              onClick={() => setSpaceMode((s) => (s === 'world' ? 'local' : 'world'))}
              className="px-2 py-1 rounded text-[11px] font-mono text-slate-300 hover:bg-slate-800 cursor-pointer"
              title="تغییر دستگاه مختصات جهان / محلی"
            >
              {spaceMode === 'world' ? 'World' : 'Local'}
            </button>

            {primarySelectedId && (
              <button
                type="button"
                onClick={() => {
                  const obj = modelObjectsRef.current.get(primarySelectedId);
                  if (obj && orbitRef.current && sceneRef.current) {
                    sceneRef.current.updateMatrixWorld(true);
                    obj.getWorldPosition(_tmpVec);
                    orbitRef.current.target.copy(_tmpVec);
                  }
                }}
                className="p-1.5 rounded-lg text-slate-300 hover:text-sky-300 hover:bg-slate-800 cursor-pointer"
                title="تمرکز دوربین روی شیء (F)"
              >
                <Focus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Save & Export Scene Actions */}
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-[#0F1420]/95 border border-slate-800 text-xs text-slate-300 hidden md:flex items-center gap-2">
              {selectedIds.length > 1 ? (
                <span>
                  انتخاب چندگانه: <strong className="text-amber-300">{selectedIds.length} شیء</strong>
                </span>
              ) : (
                <span>
                  انتخاب:{' '}
                  <strong className="text-sky-300">{selectedNode ? selectedNode.name : 'هیچ'}</strong>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleExplicitSaveScene}
              className="px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 flex items-center gap-1.5 shadow-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              ذخیره صحنه
            </button>

            <button
              type="button"
              onClick={handleExportSceneGLB}
              className="px-3 py-1.5 rounded-xl bg-[#0F1420]/95 border border-slate-700 text-slate-200 hover:border-sky-400 hover:text-sky-300 text-xs font-semibold flex items-center gap-1.5 shadow-lg cursor-pointer"
              title="خروجی کل صحنه به فایل استاندارد GLB"
            >
              <Download className="w-3.5 h-3.5" />
              خروجی GLB
            </button>
          </div>
        </div>

        {/* Save / Export Toast */}
        {saveFeedback && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-emerald-500/95 text-slate-950 text-xs font-bold shadow-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{saveFeedback}</span>
          </div>
        )}

        {/* Drag-and-Drop File Overlay */}
        {isDraggingFile && (
          <div className="absolute inset-0 z-30 bg-sky-500/15 border-2 border-dashed border-sky-400 flex items-center justify-center pointer-events-none">
            <div className="px-6 py-4 rounded-2xl bg-[#0F1420] border border-sky-400 text-sky-200 text-sm font-bold shadow-2xl">
              فایل سه‌بعدی را برای ورود به صحنه رها کنید (GLB, glTF, FBX, OBJ, STL, USDZ)
            </div>
          </div>
        )}

        {/* WebGL Canvas Container */}
        <div
          ref={mountRef}
          className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing"
        />

        {/* Bottom Animation & Playback Bar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-2xl bg-[#0F1420]/95 border border-slate-700/80 shadow-2xl flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlayingAnimations((p) => !p)}
              className="p-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 cursor-pointer"
              title={isPlayingAnimations ? 'توقف انیمیشن‌ها' : 'پخش انیمیشن‌ها'}
            >
              {isPlayingAnimations ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <span className="text-slate-300">پخش انیمیشن مدل‌ها</span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
            <span>سرعت:</span>
            {[0.5, 1, 2].map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setAnimSpeed(sp)}
                className={`px-2 py-0.5 rounded cursor-pointer ${
                  animSpeed === sp ? 'bg-sky-500/20 text-sky-300 font-bold' : 'hover:bg-slate-800'
                }`}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Right Sidebar: Single or Multi-Selection Inspector */}
      {selectedIds.length > 1 ? (
        <aside className="w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-r border-slate-800 bg-[#0E121B] p-4 flex flex-col space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-xs font-bold text-amber-300">
                انتخاب چندگانه ({selectedIds.length} شیء)
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                با گیزمو می‌توانید همه را هم‌زمان جابه‌جا یا مقیاس کنید
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              بستن
            </button>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleGroupSelected}
              className="w-full py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              گروه‌بندی انتخاب‌شده‌ها (Ctrl+G)
            </button>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handleAlignSelected('ground')}
                className="py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 cursor-pointer"
              >
                تراز زمین (Y=0)
              </button>
              <button
                type="button"
                onClick={() => handleAlignSelected('centerX')}
                className="py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 cursor-pointer"
              >
                هم‌تراز X=0
              </button>
              <button
                type="button"
                onClick={() => handleAlignSelected('centerZ')}
                className="py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 cursor-pointer"
              >
                هم‌تراز Z=0
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => duplicateNodes(selectedIds)}
                className="py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 text-xs font-semibold hover:bg-sky-500/20 flex items-center justify-center gap-1 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                کپی همه
              </button>
              <button
                type="button"
                onClick={() => deleteNodes(selectedIds)}
                className="py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-xs font-semibold hover:bg-red-500/20 flex items-center justify-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                حذف همه
              </button>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400">اقلام انتخاب‌شده:</span>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {selectedIds.map((id) => {
                const n = nodeMap.get(id);
                if (!n) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between px-2 py-1 rounded bg-[#080B10] border border-slate-800 text-[11px]"
                  >
                    <span className="truncate text-slate-200">{n.name}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedIds((prev) => prev.filter((x) => x !== id))}
                      className="text-slate-500 hover:text-red-400 text-[10px] cursor-pointer"
                    >
                      خروج
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      ) : (
        selectedNode && (
          <aside className="w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-r border-slate-800 bg-[#0E121B] p-4 flex flex-col space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 gap-2">
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={selectedNode.name}
                  onChange={(e) => updateNode(selectedNode.id, { name: e.target.value }, true)}
                  className="w-full bg-transparent text-xs font-bold text-slate-100 border-b border-transparent focus:border-sky-500 focus:outline-none"
                />
                <p className="text-[10px] text-slate-500 font-mono truncate">{selectedNode.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer shrink-0"
              >
                بستن
              </button>
            </div>

            {/* Transform Coordinates Inputs */}
            <div className="space-y-3 text-xs">
              {/* Position */}
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-300 flex items-center justify-between">
                  <span>موقعیت (Position)</span>
                  <span className="text-[10px] text-slate-500 font-mono">X, Y, Z</span>
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['x', 'y', 'z'] as const).map((axis, i) => (
                    <div
                      key={axis}
                      className="flex items-center bg-[#080B10] border border-slate-800 rounded px-1.5 py-1"
                    >
                      <span className="text-[10px] uppercase font-mono font-bold text-slate-500 ml-1">
                        {axis}
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedNode.position[i]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const next: [number, number, number] = [...selectedNode.position];
                          next[i] = val;
                          updateNode(selectedNode.id, { position: next }, true);
                        }}
                        className="w-full bg-transparent text-slate-200 text-xs font-mono focus:outline-none text-left"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Rotation */}
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-300 flex items-center justify-between">
                  <span>چرخش زاویه (Rotation)</span>
                  <span className="text-[10px] text-slate-500 font-mono">درجه</span>
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['x', 'y', 'z'] as const).map((axis, i) => (
                    <div
                      key={axis}
                      className="flex items-center bg-[#080B10] border border-slate-800 rounded px-1.5 py-1"
                    >
                      <span className="text-[10px] uppercase font-mono font-bold text-slate-500 ml-1">
                        {axis}
                      </span>
                      <input
                        type="number"
                        step="5"
                        value={selectedNode.rotation[i]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const next: [number, number, number] = [...selectedNode.rotation];
                          next[i] = val;
                          updateNode(selectedNode.id, { rotation: next }, true);
                        }}
                        className="w-full bg-transparent text-slate-200 text-xs font-mono focus:outline-none text-left"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Scale */}
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-300 flex items-center justify-between">
                  <span>مقیاس ابعاد (Scale)</span>
                  <span className="text-[10px] text-slate-500 font-mono">ضریب</span>
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['x', 'y', 'z'] as const).map((axis, i) => (
                    <div
                      key={axis}
                      className="flex items-center bg-[#080B10] border border-slate-800 rounded px-1.5 py-1"
                    >
                      <span className="text-[10px] uppercase font-mono font-bold text-slate-500 ml-1">
                        {axis}
                      </span>
                      <input
                        type="number"
                        step="0.1"
                        value={selectedNode.scale[i]}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 1;
                          const next: [number, number, number] = [...selectedNode.scale];
                          next[i] = val;
                          updateNode(selectedNode.id, { scale: next }, true);
                        }}
                        className="w-full bg-transparent text-slate-200 text-xs font-mono focus:outline-none text-left"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Material / Color / PBR Controls */}
              {selectedNode.kind !== 'group' && (
                <div className="space-y-2.5 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">رنگ متریال / نور</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedNode.color || '#38bdf8'}
                        onChange={(e) => updateNode(selectedNode.id, { color: e.target.value }, true)}
                        className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-slate-400">
                        {selectedNode.color}
                      </span>
                    </div>
                  </div>

                  {selectedNode.kind === 'light' ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>شدت نور</span>
                        <span className="font-mono">{selectedNode.lightIntensity ?? 4}</span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={20}
                        step={0.2}
                        value={selectedNode.lightIntensity ?? 4}
                        onChange={(e) =>
                          updateNode(
                            selectedNode.id,
                            { lightIntensity: parseFloat(e.target.value) },
                            true
                          )
                        }
                        className="w-full accent-amber-400"
                      />
                    </div>
                  ) : (
                    selectedNode.kind !== 'model-asset' && (
                      <>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>زبری سطح (Roughness)</span>
                            <span className="font-mono">
                              {(selectedNode.roughness ?? 0.42).toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0.05}
                            max={1}
                            step={0.05}
                            value={selectedNode.roughness ?? 0.42}
                            onChange={(e) =>
                              updateNode(
                                selectedNode.id,
                                { roughness: parseFloat(e.target.value) },
                                true
                              )
                            }
                            className="w-full accent-sky-400"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>فلزیت (Metalness)</span>
                            <span className="font-mono">
                              {(selectedNode.metalness ?? 0.25).toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={selectedNode.metalness ?? 0.25}
                            onChange={(e) =>
                              updateNode(
                                selectedNode.id,
                                { metalness: parseFloat(e.target.value) },
                                true
                              )
                            }
                            className="w-full accent-sky-400"
                          />
                        </div>
                      </>
                    )
                  )}
                </div>
              )}

              {/* Parent Assignment in Real Hierarchy */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <FolderTree className="w-3.5 h-3.5 text-amber-400" />
                  والد در سلسله‌مراتب (Parent)
                </label>
                <select
                  value={selectedNode.parentId || ''}
                  onChange={(e) => reparentNode(selectedNode.id, e.target.value || null)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#080B10] border border-slate-700 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="">ریشه صحنه (Root)</option>
                  {nodes
                    .filter(
                      (n) =>
                        n.id !== selectedNode.id &&
                        !isDescendantOf(n.id, selectedNode.id, nodeMap)
                    )
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.kind === 'group' ? '📁 ' : ''}
                        {n.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Layer Assignment */}
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  لایه دسته‌بندی
                </label>
                <select
                  value={selectedNode.layerId}
                  onChange={(e) => updateNode(selectedNode.id, { layerId: e.target.value }, true)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#080B10] border border-slate-700 text-xs text-slate-200 focus:outline-none"
                >
                  {DEFAULT_LAYERS.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Group / Ungroup Actions */}
              {selectedNode.kind === 'group' && (
                <button
                  type="button"
                  onClick={handleUngroupSelected}
                  className="w-full py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs font-semibold hover:bg-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Ungroup className="w-3.5 h-3.5" />
                  لغو گروه و آزادسازی فرزندان
                </button>
              )}

              {/* Animation clips metadata if imported model */}
              {selectedNode.animations && selectedNode.animations.length > 0 && (
                <div className="p-2.5 rounded-lg bg-[#080B10] border border-slate-800 space-y-1">
                  <span className="text-[11px] font-semibold text-emerald-400">
                    انیمیشن‌های مدل ({selectedNode.animations.length}):
                  </span>
                  <div className="text-[10px] text-slate-400 space-y-0.5">
                    {selectedNode.animations.map((anim, i) => (
                      <div key={i} className="truncate font-mono">
                        • {anim}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Duplicate & Delete */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => duplicateNodes([selectedNode.id])}
                  className="py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 text-xs font-semibold hover:bg-sky-500/20 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  کپی
                </button>
                <button
                  type="button"
                  onClick={() => deleteNodes([selectedNode.id])}
                  className="py-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-xs font-semibold hover:bg-red-500/20 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  حذف
                </button>
              </div>
            </div>
          </aside>
        )
      )}
    </div>
  );
};
