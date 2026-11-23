/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Production Multi-Model 3D Layout Environment
 * Supports hundreds of concurrent 3D models (GLB, glTF, FBX, OBJ, STL, USD/USDZ),
 * independent selection, TransformControls gizmo, grouping/ungrouping, layers & folders,
 * and complete scene hierarchy panel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Layers,
  Lock,
  Maximize2,
  Move,
  Orbit,
  Play,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Unlock,
  Upload,
  FolderTree,
  Pause,
} from 'lucide-react';
import type { Model3DPresetType, RayanAsset, RayanProject } from '../types/studio';
import {
  buildProceduralPresetGroup,
  loadCustom3DAsset,
  dataUrlToArrayBuffer,
  inspectGLTFMetadata,
} from '../engine/threeModels';

export interface SceneNode3D {
  id: string;
  name: string;
  kind: 'model-asset' | 'model-preset' | 'group' | 'light';
  preset?: Model3DPresetType;
  assetId?: string;
  format?: string;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler angles in degrees
  scale: [number, number, number];
  color: string;
  visible: boolean;
  locked: boolean;
  parentId?: string | null;
  layerId: string;
  folder?: string;
  animations?: string[];
}

export interface Studio3DViewProps {
  project: RayanProject;
  onUpdateProject?: (updater: (prev: RayanProject) => RayanProject) => void;
  onAddAsset?: (asset: RayanAsset) => void;
}

const DEFAULT_LAYERS = [
  { id: 'default', name: 'لایه پیش‌فرض', color: '#94a3b8' },
  { id: 'characters', name: 'شخصیت‌ها و کاراکترها', color: '#38bdf8' },
  { id: 'props', name: 'آیتم‌ها و اشیا (Props)', color: '#fbbf24' },
  { id: 'env', name: 'محیط و معماری', color: '#34d399' },
  { id: 'lighting', name: 'نورپردازی و افکت‌ها', color: '#c084fc' },
];

export const Studio3DView: React.FC<Studio3DViewProps> = ({
  project,
  onUpdateProject,
  onAddAsset,
}) => {
  // --- Multi-Model Scene State ---
  const [nodes, setNodes] = useState<SceneNode3D[]>(() => [
    {
      id: 'node_hero_1',
      name: 'ربات قهرمان (Hero Bot)',
      kind: 'model-preset',
      preset: 'hero-bot',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: '#38bdf8',
      visible: true,
      locked: false,
      parentId: null,
      layerId: 'characters',
      folder: 'شخصیت‌ها',
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
      visible: true,
      locked: false,
      parentId: null,
      layerId: 'props',
      folder: 'تجهیزات',
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
      visible: true,
      locked: false,
      parentId: null,
      layerId: 'props',
      folder: 'آیتم‌ها',
    },
  ]);

  const [selectedId, setSelectedId] = useState<string | null>('node_hero_1');
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [spaceMode, setSpaceMode] = useState<'world' | 'local'>('world');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'شخصیت‌ها': true,
    'تجهیزات': true,
    'آیتم‌ها': true,
    'مدل‌های وارد شده': true,
  });

  // Animation playback
  const [isPlayingAnimations, setIsPlayingAnimations] = useState(true);
  const [animSpeed, setAnimSpeed] = useState(1);

  // Viewport refs
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const modelObjectsRef = useRef<Map<string, THREE.Group>>(new Map());
  const mixersRef = useRef<Map<string, THREE.AnimationMixer>>(new Map());
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Sync TransformControls mode
  useEffect(() => {
    if (transformRef.current) {
      transformRef.current.setMode(transformMode);
      transformRef.current.setSpace(spaceMode);
    }
  }, [transformMode, spaceMode]);

  // Selected Node lookup
  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedId) || null;
  }, [nodes, selectedId]);

  // Toggle folder expansion
  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderName]: !prev[folderName] }));
  };

  // Grouping & organizing
  const groupedNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? nodes.filter((n) => n.name.toLowerCase().includes(q) || (n.folder && n.folder.toLowerCase().includes(q)))
      : nodes;

    const map: Record<string, SceneNode3D[]> = {};
    filtered.forEach((n) => {
      const f = n.folder || 'بدون پوشه';
      if (!map[f]) map[f] = [];
      map[f].push(n);
    });
    return map;
  }, [nodes, searchQuery]);

  // Update node properties
  const updateNode = useCallback((id: string, patch: Partial<SceneNode3D>) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n, ...patch };
        // Sync 3D object if exists
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
        }
        return next;
      })
    );
  }, []);

  // Duplicate model
  const duplicateNode = (node: SceneNode3D) => {
    const nextId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cloned: SceneNode3D = {
      ...node,
      id: nextId,
      name: `${node.name} (کپی)`,
      position: [node.position[0] + 0.8, node.position[1], node.position[2] + 0.8],
    };
    setNodes((prev) => [...prev, cloned]);
    setSelectedId(nextId);
  };

  // Delete model
  const deleteNode = (id: string) => {
    const obj = modelObjectsRef.current.get(id);
    if (obj && sceneRef.current) {
      sceneRef.current.remove(obj);
      modelObjectsRef.current.delete(id);
    }
    const mixer = mixersRef.current.get(id);
    if (mixer) {
      mixer.stopAllAction();
      mixersRef.current.delete(id);
    }
    if (selectedId === id) {
      setSelectedId(null);
      transformRef.current?.detach();
    }
    setNodes((prev) => prev.filter((n) => n.id !== id));
  };

  // Group selected model into new group/folder
  const handleGroupSelection = () => {
    if (!selectedNode) return;
    const folderName = prompt('نام گروه / پوشه جدید را وارد کنید:', 'گروه جدید');
    if (!folderName) return;
    updateNode(selectedNode.id, { folder: folderName });
    setExpandedFolders((prev) => ({ ...prev, [folderName]: true }));
  };

  // Add 3D Preset
  const addPresetModel = (preset: Model3DPresetType, label: string) => {
    const count = nodes.filter((n) => n.preset === preset).length + 1;
    const id = `node_${preset}_${Date.now()}`;
    const newNode: SceneNode3D = {
      id,
      name: `${label} ${count}`,
      kind: 'model-preset',
      preset,
      position: [(Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4],
      rotation: [0, Math.round(Math.random() * 360), 0],
      scale: [1, 1, 1],
      color: '#f59e0b',
      visible: true,
      locked: false,
      parentId: null,
      layerId: 'props',
      folder: 'آیتم‌ها',
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedId(id);
  };

  // Handle uploaded 3D files (GLB, glTF, FBX, OBJ, STL, USD, USDZ)
  const handleImport3DFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['glb', 'gltf', 'fbx', 'obj', 'stl', 'usd', 'usdz', 'ply'].includes(ext)) {
        continue;
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('خطا در خواندن فایل'));
        reader.readAsDataURL(file);
      });

      let modelMeta = undefined;
      if (ext === 'glb' || ext === 'gltf') {
        try {
          const buf = dataUrlToArrayBuffer(dataUrl);
          const meta = await inspectGLTFMetadata(buf);
          modelMeta = { format: ext as any, ...meta };
        } catch {
          // ignore inspection error
        }
      }

      const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newAsset: RayanAsset = {
        id: assetId,
        name: file.name.replace(/\.[^.]+$/, ''),
        kind: 'model3d',
        format: ext as any,
        dataUrl,
        sizeBytes: file.size,
        createdAt: Date.now(),
        modelMeta,
      };

      onAddAsset?.(newAsset);

      // Add to 3D scene nodes
      const nodeId = `node_model_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      const newNode: SceneNode3D = {
        id: nodeId,
        name: file.name.replace(/\.[^.]+$/, ''),
        kind: 'model-asset',
        assetId,
        format: ext.toUpperCase(),
        position: [(Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#38bdf8',
        visible: true,
        locked: false,
        parentId: null,
        layerId: 'characters',
        folder: 'مدل‌های وارد شده',
        animations: modelMeta?.animationNames,
      };

      setNodes((prev) => [...prev, newNode]);
      setSelectedId(nodeId);
      setExpandedFolders((prev) => ({ ...prev, 'مدل‌های وارد شده': true }));
    }
  };

  // --- Main Three.js Scene Initialization ---
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene & Background
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);
    scene.fog = new THREE.FogExp2(0x0b0e14, 0.02);
    sceneRef.current = scene;

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(6, 5, 8);
    cameraRef.current = camera;

    // 3. Renderer with SRGB and Tone Mapping
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    // 4. Studio Environment Lighting (RoomEnvironment)
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // 5. 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.7);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.4);
    dirLight.position.set(8, 12, 6);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.02;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 40;
    dirLight.shadow.camera.left = -10;
    dirLight.shadow.camera.right = 10;
    dirLight.shadow.camera.top = 10;
    dirLight.shadow.camera.bottom = -10;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.4);
    fillLight.position.set(-8, 6, -6);
    scene.add(fillLight);

    // 6. Ground Grid & Contact Floor
    const grid = new THREE.GridHelper(30, 30, 0x38bdf8, 0x1e293b);
    grid.position.y = 0;
    scene.add(grid);

    const floorGeo = new THREE.PlaneGeometry(60, 60);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x090c12,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    // 7. Controls: TransformControls (constructed first) and OrbitControls
    const transformCtrl = new TransformControls(camera, renderer.domElement);
    transformCtrl.setMode('translate');
    transformCtrl.setSize(0.85);
    scene.add(transformCtrl.getHelper());
    transformRef.current = transformCtrl;

    const orbitCtrl = new OrbitControls(camera, renderer.domElement);
    orbitCtrl.enableDamping = true;
    orbitCtrl.dampingFactor = 0.05;
    orbitCtrl.maxPolarAngle = Math.PI / 2 - 0.02;
    orbitCtrl.minDistance = 1;
    orbitCtrl.maxDistance = 50;
    orbitCtrl.target.set(0, 0.8, 0);
    orbitRef.current = orbitCtrl;

    // Orbit/Transform collision avoidance
    transformCtrl.addEventListener('dragging-changed', (event) => {
      orbitCtrl.enabled = !event.value;
    });

    // Update node transform when gizmo is moved
    transformCtrl.addEventListener('objectChange', () => {
      const obj = transformCtrl.object;
      if (!obj || !obj.userData.nodeId) return;
      const id = obj.userData.nodeId;
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          return {
            ...n,
            position: [
              Number(obj.position.x.toFixed(3)),
              Number(obj.position.y.toFixed(3)),
              Number(obj.position.z.toFixed(3)),
            ],
            rotation: [
              Number(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1)),
              Number(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1)),
            ],
            scale: [
              Number(obj.scale.x.toFixed(3)),
              Number(obj.scale.y.toFixed(3)),
              Number(obj.scale.z.toFixed(3)),
            ],
          };
        })
      );
    });

    // 8. Raycasting on Viewport Click to Select Model Independently
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (e: MouseEvent) => {
      // Ignore if user clicked on TransformControls gizmo
      if (transformCtrl.dragging) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);

      // Intersect all model objects
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
          setSelectedId(cur.userData.nodeId);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    // 9. Resize Observer
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // 10. Animation Tick Loop
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const dt = clockRef.current.getDelta();

      // Update animation mixers
      if (isPlayingAnimations) {
        mixersRef.current.forEach((mixer) => {
          mixer.update(dt * animSpeed);
        });
      }

      orbitCtrl.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      transformCtrl.dispose();
      orbitCtrl.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  // --- Sync Three.js Objects when `nodes` state changes ---
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    let isCancelled = false;

    // Load and place every node into the 3D scene
    const syncNodes = async () => {
      const activeIds = new Set(nodes.map((n) => n.id));

      // Remove deleted nodes from Three.js scene
      modelObjectsRef.current.forEach((obj, id) => {
        if (!activeIds.has(id)) {
          scene.remove(obj);
          modelObjectsRef.current.delete(id);
          const mixer = mixersRef.current.get(id);
          if (mixer) {
            mixer.stopAllAction();
            mixersRef.current.delete(id);
          }
        }
      });

      for (const node of nodes) {
        if (isCancelled) return;

        let obj = modelObjectsRef.current.get(node.id);

        if (!obj) {
          // Build new 3D model (Asset or Preset)
          if (node.kind === 'model-asset' && node.assetId) {
            const asset = project.assets.find((a) => a.id === node.assetId);
            if (asset) {
              try {
                obj = await loadCustom3DAsset(asset, node.color);
              } catch {
                obj = buildProceduralPresetGroup('crate', node.color);
              }
            } else {
              obj = buildProceduralPresetGroup('crate', node.color);
            }
          } else {
            obj = buildProceduralPresetGroup(node.preset || 'crate', node.color);
          }

          if (isCancelled) return;

          obj.userData.nodeId = node.id;
          obj.traverse((child) => {
            child.userData.nodeId = node.id;
          });

          // Check and play animations if present
          if (obj.userData.animations && obj.userData.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(obj);
            obj.userData.animations.forEach((clip: THREE.AnimationClip) => {
              mixer.clipAction(clip).play();
            });
            mixersRef.current.set(node.id, mixer);
          }

          modelObjectsRef.current.set(node.id, obj);
          scene.add(obj);
        }

        // Apply transforms and visibility
        obj.position.set(...node.position);
        obj.rotation.set(
          THREE.MathUtils.degToRad(node.rotation[0]),
          THREE.MathUtils.degToRad(node.rotation[1]),
          THREE.MathUtils.degToRad(node.rotation[2])
        );
        obj.scale.set(...node.scale);
        obj.visible = node.visible;
      }
    };

    void syncNodes();

    return () => {
      isCancelled = true;
    };
  }, [nodes, project.assets]);

  // --- Attach / Detach TransformControls based on Selection ---
  useEffect(() => {
    const tc = transformRef.current;
    if (!tc) return;

    if (!selectedId) {
      tc.detach();
      return;
    }

    const node = nodes.find((n) => n.id === selectedId);
    if (!node || node.locked || !node.visible) {
      tc.detach();
      return;
    }

    const obj = modelObjectsRef.current.get(selectedId);
    if (obj) {
      tc.attach(obj);
    } else {
      tc.detach();
    }
  }, [selectedId, nodes]);

  // Keyboard hotkeys for Transform Modes (W = Translate, E = Rotate, R = Scale)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key.toLowerCase() === 'w') setTransformMode('translate');
      if (e.key.toLowerCase() === 'e') setTransformMode('rotate');
      if (e.key.toLowerCase() === 'r') setTransformMode('scale');
      if (e.key.toLowerCase() === 'f' && selectedNode) {
        // Focus camera on selected object
        const obj = modelObjectsRef.current.get(selectedNode.id);
        if (obj && orbitRef.current) {
          orbitRef.current.target.copy(obj.position);
        }
      }
      if (e.key === 'Delete' && selectedId) {
        deleteNode(selectedId);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, selectedNode]);

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full w-full bg-[#0B0E14] text-slate-100 overflow-hidden select-none">
      {/* Hidden File Input for 3D Format Imports */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".glb,.gltf,.fbx,.obj,.stl,.usd,.usdz,.ply"
        className="hidden"
        onChange={(e) => {
          void handleImport3DFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Left / Primary Sidebar: Scene Hierarchy Tree Panel */}
      <aside className="w-full lg:w-80 h-72 lg:h-full shrink-0 border-b lg:border-b-0 lg:border-l border-slate-800 bg-[#0E121B] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-3 border-b border-slate-800/80 bg-[#121723] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-sky-400" />
            <h2 className="text-xs font-bold text-slate-100">سلسله‌مراتب صحنه سه‌بعدی</h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
            {nodes.length} مدل
          </span>
        </div>

        {/* Toolbar in Hierarchy: Add, Search, Group */}
        <div className="p-2 border-b border-slate-800 space-y-2 bg-[#10141F]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute right-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="جستجو در مدل‌ها و لایه‌ها..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-2 pr-8 py-1.5 rounded-lg bg-[#080B10] border border-slate-700/80 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-sky-500 text-slate-950 text-xs font-bold hover:bg-sky-400 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              ورود مدل (GLB/FBX/OBJ/STL/USD)
            </button>
            <button
              type="button"
              onClick={handleGroupSelection}
              disabled={!selectedNode}
              className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-slate-100 disabled:opacity-30 cursor-pointer"
              title="گروه‌بندی مدل انتخاب شده"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Hierarchy Tree List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {Object.entries(groupedNodes).map(([folderName, folderNodes]) => {
            const isExpanded = expandedFolders[folderName] !== false;
            return (
              <div key={folderName} className="space-y-1">
                {/* Folder Header */}
                <div
                  onClick={() => toggleFolder(folderName)}
                  className="flex items-center justify-between px-2 py-1 rounded hover:bg-slate-800/60 cursor-pointer text-slate-400 text-xs font-semibold"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">{folderName}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">({folderNodes.length})</span>
                </div>

                {/* Folder Children */}
                {isExpanded && (
                  <div className="pr-4 space-y-1 border-r border-slate-800 mr-2">
                    {folderNodes.map((node) => {
                      const isSel = node.id === selectedId;
                      return (
                        <div
                          key={node.id}
                          onClick={() => setSelectedId(node.id)}
                          className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                            isSel
                              ? 'bg-sky-500/20 border border-sky-500/40 text-sky-200'
                              : 'border border-transparent text-slate-300 hover:bg-slate-800/70'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <Box
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: node.color || '#38bdf8' }}
                            />
                            <span className="truncate font-medium">{node.name}</span>
                            {node.format && (
                              <span className="text-[9px] font-mono px-1 rounded bg-slate-800 text-slate-400 shrink-0">
                                {node.format}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Visibility Toggle */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateNode(node.id, { visible: !node.visible });
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

                            {/* Lock Toggle */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateNode(node.id, { locked: !node.locked });
                              }}
                              className="p-1 text-slate-400 hover:text-slate-100"
                              title={node.locked ? 'باز کردن قفل' : 'قفل کردن'}
                            >
                              {node.locked ? (
                                <Lock className="w-3 h-3 text-amber-400" />
                              ) : (
                                <Unlock className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100" />
                              )}
                            </button>

                            {/* Duplicate */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                duplicateNode(node);
                              }}
                              className="p-1 text-slate-500 hover:text-sky-300 opacity-0 group-hover:opacity-100"
                              title="کپی مدل"
                            >
                              <Copy className="w-3 h-3" />
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNode(node.id);
                              }}
                              className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100"
                              title="حذف مدل"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick Add 3D Presets Palette */}
        <div className="p-3 border-t border-slate-800 bg-[#0C1018] space-y-2">
          <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
            <span>افزودن مدل‌های پیش‌فرض:</span>
            <span className="text-[10px] text-slate-500">عدم حذف قبلی</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => addPresetModel('hero-bot', 'ربات')}
              className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-sky-300 text-right truncate cursor-pointer"
            >
              + ربات قهرمان
            </button>
            <button
              type="button"
              onClick={() => addPresetModel('rover-car', 'ماشین')}
              className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-amber-300 text-right truncate cursor-pointer"
            >
              + ماشین کاوشگر
            </button>
            <button
              type="button"
              onClick={() => addPresetModel('turret', 'برجک')}
              className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-red-300 text-right truncate cursor-pointer"
            >
              + برجک تدافعی
            </button>
            <button
              type="button"
              onClick={() => addPresetModel('crystal-gem', 'کریستال')}
              className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-emerald-300 text-right truncate cursor-pointer"
            >
              + کریستال
            </button>
            <button
              type="button"
              onClick={() => addPresetModel('pine-tree', 'درخت')}
              className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-teal-300 text-right truncate cursor-pointer"
            >
              + درخت کاج
            </button>
            <button
              type="button"
              onClick={() => addPresetModel('crate', 'جعبه')}
              className="px-2 py-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-[11px] text-orange-300 text-right truncate cursor-pointer"
            >
              + جعبه انبار
            </button>
          </div>
        </div>
      </aside>

      {/* Center: 3D Viewport with Transform Gizmos */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        {/* Top Floating Viewport Control Toolbar */}
        <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex items-center justify-between">
          {/* Gizmo Mode Switcher (Translate W, Rotate E, Scale R) */}
          <div className="pointer-events-auto flex items-center gap-1 p-1 rounded-xl bg-[#0F1420]/90 backdrop-blur-md border border-slate-700/80 shadow-xl">
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
              بزرگ‌نمایی
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
          </div>

          {/* Quick Info Badge */}
          <div className="pointer-events-auto px-3 py-1.5 rounded-xl bg-[#0F1420]/80 backdrop-blur-md border border-slate-800 text-xs text-slate-300 flex items-center gap-3">
            <span>مدل انتخاب شده: <strong className="text-sky-300">{selectedNode ? selectedNode.name : 'هیچ'}</strong></span>
            {selectedNode && (
              <span className="text-[11px] text-slate-500">
                [X: {selectedNode.position[0]}, Y: {selectedNode.position[1]}, Z: {selectedNode.position[2]}]
              </span>
            )}
          </div>
        </div>

        {/* WebGL Canvas Container */}
        <div ref={mountRef} className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing" />

        {/* Bottom Animation & Playback Bar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-2xl bg-[#0F1420]/95 backdrop-blur-md border border-slate-700/80 shadow-2xl flex items-center gap-4 text-xs">
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

      {/* Right / Secondary Sidebar: Selected Model Transform Inspector */}
      {selectedNode && (
        <aside className="w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-r border-slate-800 bg-[#0E121B] p-4 flex flex-col space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-xs font-bold text-slate-100">{selectedNode.name}</h3>
              <p className="text-[10px] text-slate-500 font-mono">{selectedNode.id}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs text-slate-500 hover:text-slate-300"
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
                  <div key={axis} className="flex items-center bg-[#080B10] border border-slate-800 rounded px-1.5 py-1">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-500 ml-1">{axis}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedNode.position[i]}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        const next: [number, number, number] = [...selectedNode.position];
                        next[i] = val;
                        updateNode(selectedNode.id, { position: next });
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
                  <div key={axis} className="flex items-center bg-[#080B10] border border-slate-800 rounded px-1.5 py-1">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-500 ml-1">{axis}</span>
                    <input
                      type="number"
                      step="5"
                      value={selectedNode.rotation[i]}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        const next: [number, number, number] = [...selectedNode.rotation];
                        next[i] = val;
                        updateNode(selectedNode.id, { rotation: next });
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
                  <div key={axis} className="flex items-center bg-[#080B10] border border-slate-800 rounded px-1.5 py-1">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-500 ml-1">{axis}</span>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedNode.scale[i]}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 1;
                        const next: [number, number, number] = [...selectedNode.scale];
                        next[i] = val;
                        updateNode(selectedNode.id, { scale: next });
                      }}
                      className="w-full bg-transparent text-slate-200 text-xs font-mono focus:outline-none text-left"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Layer Assignment */}
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <label className="font-semibold text-slate-300">لایه دسته‌بندی</label>
              <select
                value={selectedNode.layerId}
                onChange={(e) => updateNode(selectedNode.id, { layerId: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#080B10] border border-slate-700 text-xs text-slate-200 focus:outline-none"
              >
                {DEFAULT_LAYERS.map((layer) => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Folder Name */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">پوشه سلسله‌مراتب</label>
              <input
                type="text"
                value={selectedNode.folder || ''}
                onChange={(e) => updateNode(selectedNode.id, { folder: e.target.value })}
                placeholder="نام پوشه..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#080B10] border border-slate-700 text-xs text-slate-200 focus:outline-none"
              />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
};
