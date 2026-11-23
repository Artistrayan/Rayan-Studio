import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  BoxChildLayer,
  GameEntity,
  GameRule,
  GameScene,
  ParticlePreset,
  RayanProject,
} from '../types/studio';
import { audioEngine } from './audioEngine';
import { buildProceduralPresetGroup, loadCustom3DAsset } from './threeModels';
import type { RuntimeStatsPayload } from './Engine2D';
import { BoxLayersRenderer } from '../components/BoxLayersRenderer';
import {
  compileRuntimeScripts,
  type CompiledScriptHandle,
  type ScriptRuntimeApi,
} from './customScriptRunner';

interface Engine3DProps {
  project: RayanProject;
  isPlaying: boolean;
  selectedEntityId: string | null;
  transformMode: 'translate' | 'rotate' | 'scale';
  onSelectEntity: (id: string | null) => void;
  onUpdateEntity: (id: string, patch: Partial<GameEntity>) => void;
  onRuntimeStats?: (stats: RuntimeStatsPayload) => void;
}

interface Sim3DBody {
  entity: GameEntity;
  object3D: THREE.Object3D;
  baseY: number;
  vx: number;
  vy: number;
  vz: number;
  alive: boolean;
  onGround: boolean;
  facingX: number;
  facingZ: number;
  patrolDir: number;
  orbitAngle: number;
  animTime: number;
}

interface Projectile3D {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

interface Particle3D {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravityFactor: number;
}

const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const Engine3D: React.FC<Engine3DProps> = ({
  project,
  isPlaying,
  selectedEntityId,
  transformMode,
  onSelectEntity,
  onUpdateEntity,
  onRuntimeStats,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const selectedIdRef = useRef(selectedEntityId);
  selectedIdRef.current = selectedEntityId;

  const onSelectRef = useRef(onSelectEntity);
  onSelectRef.current = onSelectEntity;

  const onUpdateRef = useRef(onUpdateEntity);
  onUpdateRef.current = onUpdateEntity;

  const onStatsRef = useRef(onRuntimeStats);
  onStatsRef.current = onRuntimeStats;

  const transformModeRef = useRef(transformMode);
  transformModeRef.current = transformMode;

  const keysHeldRef = useRef<Record<string, boolean>>({});
  const keysJustPressedRef = useRef<Record<string, boolean>>({});
  const virtualKeysRef = useRef<Record<string, boolean>>({});
  const varsRef = useRef({
    score: project.variables.score,
    health: project.variables.health,
    custom: { ...(project.customVariables || {}) },
  });
  const logsRef = useRef<string[]>([]);
  const shakeRef = useRef(0);
  const elapsedRef = useRef(0);
  const runtimeSceneRef = useRef<GameScene>(
    project.scenes.find((s) => s.id === project.activeSceneId) || {
      id: project.activeSceneId || 'scene3d_1',
      name: 'عرصه سه‌بعدی',
      environment: project.environment,
      camera: project.camera,
      tilemap: project.tilemap,
      entities: project.entities,
      rulesText: project.rulesText,
      rules: project.rules,
    }
  );

  const [runtimeVars, setRuntimeVars] = useState({
    score: project.variables.score,
    health: project.variables.health,
    custom: { ...(project.customVariables || {}) },
    time: 0,
    level: 1,
  });
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [virtualKeys, setVirtualKeys] = useState<Record<string, boolean>>({});
  const [clickedBoxId, setClickedBoxId] = useState<string | null>(null);
  const lastScrollRuleRef = useRef<Map<string, number>>(new Map());
  const suppressNextClickRef = useRef(false);
  const compiledScriptsRef = useRef<CompiledScriptHandle[]>([]);
  const scriptsStartedRef = useRef(false);
  const [debugBadge, setDebugBadge] = useState({
    fps: 60,
    entities: project.entities.length,
    particles: 0,
    sceneName: runtimeSceneRef.current.name,
  });

  const transformCtrlRef = useRef<TransformControls | null>(null);
  const orbitCtrlRef = useRef<OrbitControls | null>(null);
  const simMapRef = useRef<Map<string, Sim3DBody>>(new Map());
  const boxHelpersRef = useRef<THREE.BoxHelper[]>([]);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const particles3DRef = useRef<Particle3D[]>([]);
  const particleGeoRef = useRef<THREE.BoxGeometry | null>(null);
  const run3DRuleRef = useRef<((rule: GameRule, dt: number, isContinuous: boolean) => void) | null>(
    null
  );

  useEffect(() => {
    virtualKeysRef.current = virtualKeys;
  }, [virtualKeys]);

  // Sync TransformControls mode
  useEffect(() => {
    if (transformCtrlRef.current) {
      transformCtrlRef.current.setMode(transformMode);
    }
  }, [transformMode]);

  // Attach TransformControls to selected entity in editor mode
  useEffect(() => {
    const tc = transformCtrlRef.current;
    if (!tc) return;
    if (isPlaying || !selectedEntityId) {
      tc.detach();
      if (orbitCtrlRef.current) orbitCtrlRef.current.enabled = true;
      return;
    }
    const sim = simMapRef.current.get(selectedEntityId);
    if (sim && !sim.entity.locked) {
      tc.setMode(transformModeRef.current);
      tc.attach(sim.object3D);
    } else {
      tc.detach();
      if (orbitCtrlRef.current) orbitCtrlRef.current.enabled = true;
    }
  }, [selectedEntityId, isPlaying, project.entities]);

  // Keyboard listeners for 3D play mode
  useEffect(() => {
    if (!isPlaying) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!keysHeldRef.current[e.code]) {
        keysJustPressedRef.current[e.code] = true;
      }
      keysHeldRef.current[e.code] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      keysHeldRef.current = {};
      keysJustPressedRef.current = {};
    };
  }, [isPlaying]);

  const spawn3DParticles = (
    scene: THREE.Scene,
    pos: THREE.Vector3,
    preset: ParticlePreset,
    count = 16
  ) => {
    const geo = particleGeoRef.current || new THREE.BoxGeometry(0.18, 0.18, 0.18);
    particleGeoRef.current = geo;
    const paletteMap: Record<ParticlePreset, number[]> = {
      explosion: [0xef4444, 0xf97316, 0xfacc15],
      sparkle: [0xfbbf24, 0x38bdf8, 0x34d399],
      smoke: [0x94a3b8, 0x64748b, 0xcbd5e1],
      snow: [0xf8fafc, 0xe0f2fe],
      rain: [0x38bdf8, 0x60a5fa],
    };
    const colors = paletteMap[preset] || paletteMap.sparkle;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0.95,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      if (preset === 'snow' || preset === 'rain') {
        mesh.position.set(
          (Math.random() - 0.5) * 20,
          9 + Math.random() * 4,
          (Math.random() - 0.5) * 20
        );
      }
      scene.add(mesh);
      const speed = preset === 'rain' ? 12 : preset === 'snow' ? 2.5 : 3 + Math.random() * 5;
      const theta = Math.random() * Math.PI * 2;
      const maxLife = preset === 'snow' || preset === 'rain' ? 1.8 : 0.65 + Math.random() * 0.4;
      particles3DRef.current.push({
        mesh,
        vx: preset === 'snow' || preset === 'rain' ? 0 : Math.cos(theta) * speed,
        vy:
          preset === 'rain'
            ? -10
            : preset === 'snow'
              ? -2.5
              : 2 + Math.random() * 4.5,
        vz: preset === 'snow' || preset === 'rain' ? 0 : Math.sin(theta) * speed,
        life: maxLife,
        maxLife,
        gravityFactor: preset === 'explosion' ? 0.5 : preset === 'smoke' ? -0.15 : 0.1,
      });
    }
  };

  const buildSingleEntityMesh = async (ent: GameEntity, currentProject: RayanProject) => {
    let obj3D: THREE.Group;
    if (ent.kind === 'model3d-asset' && ent.assetId) {
      const asset = currentProject.assets.find((a) => a.id === ent.assetId);
      if (asset) {
        try {
          obj3D = await loadCustom3DAsset(asset, ent.color);
        } catch {
          obj3D = buildProceduralPresetGroup('crate', ent.color);
        }
      } else {
        obj3D = buildProceduralPresetGroup('crate', ent.color);
      }
    } else {
      obj3D = buildProceduralPresetGroup(ent.model3dPreset || 'crate', ent.color);
    }

    obj3D.position.set(ent.x, ent.y, ent.z);
    obj3D.rotation.set(
      THREE.MathUtils.degToRad(ent.rotationX),
      THREE.MathUtils.degToRad(ent.rotationY),
      THREE.MathUtils.degToRad(ent.rotationZ)
    );
    obj3D.scale.set(
      Math.max(0.2, ent.width / 1.4),
      Math.max(0.2, ent.height / 1.4),
      Math.max(0.2, ent.depth / 1.4)
    );
    obj3D.visible = ent.visible;
    obj3D.userData.entityId = ent.id;
    obj3D.traverse((c) => {
      c.userData.entityId = ent.id;
    });
    return obj3D;
  };

  // Rebuild 3D entity meshes when entities or scene change
  const syncSceneEntities = async (
    scene: THREE.Scene,
    targetScene: GameScene,
    currentProject: RayanProject
  ) => {
    runtimeSceneRef.current = targetScene;
    simMapRef.current.forEach((sim) => {
      scene.remove(sim.object3D);
    });
    simMapRef.current.clear();
    boxHelpersRef.current.forEach((h) => scene.remove(h));
    boxHelpersRef.current = [];

    for (const ent of targetScene.entities) {
      if (ent.kind === 'hud-text' || ent.kind === 'text-box') continue;
      const obj3D = await buildSingleEntityMesh(ent, currentProject);
      scene.add(obj3D);

      if (currentProject.editorSettings?.showDebugHitboxes && ent.physics.enabled) {
        const helper = new THREE.BoxHelper(
          obj3D,
          ent.role === 'enemy' ? 0xef4444 : ent.role === 'player' ? 0xfbbf24 : 0x10b981
        );
        scene.add(helper);
        boxHelpersRef.current.push(helper);
      }

      simMapRef.current.set(ent.id, {
        entity: { ...ent },
        object3D: obj3D,
        baseY: ent.y,
        vx: 0,
        vy: 0,
        vz: 0,
        alive: true,
        onGround: ent.y <= 0.05,
        facingX: 0,
        facingZ: -1,
        patrolDir: 1,
        orbitAngle: 0,
        animTime: Math.random() * 3,
      });
    }

    const tc = transformCtrlRef.current;
    if (tc && !isPlayingRef.current && selectedIdRef.current) {
      const sel = simMapRef.current.get(selectedIdRef.current);
      if (sel && !sel.entity.locked) {
        tc.setMode(transformModeRef.current);
        tc.attach(sel.object3D);
      } else {
        tc.detach();
        if (orbitCtrlRef.current) orbitCtrlRef.current.enabled = true;
      }
    }
  };

  const lastMeshSigRef = useRef<string>('');

  // Resync entities whenever project entities or play mode toggles
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const activeScene: GameScene =
      project.scenes.find((s) => s.id === project.activeSceneId) || {
        id: project.activeSceneId || 'scene3d_1',
        name: 'عرصه سه‌بعدی',
        environment: project.environment,
        camera: project.camera,
        tilemap: project.tilemap,
        entities: project.entities,
        rulesText: project.rulesText,
        rules: project.rules,
      };
    runtimeSceneRef.current = activeScene;

    varsRef.current = {
      score: project.variables.score,
      health: project.variables.health,
      custom: { ...(project.customVariables || {}) },
    };
    elapsedRef.current = 0;
    logsRef.current = [];
    setBannerMessage(null);
    setRuntimeVars({
      score: varsRef.current.score,
      health: varsRef.current.health,
      custom: { ...varsRef.current.custom },
      time: 0,
      level: project.scenes.findIndex((s) => s.id === activeScene.id) + 1 || 1,
    });

    scene.background = new THREE.Color(activeScene.environment.backgroundColor || '#0F172A');
    if (activeScene.environment.fogEnabled) {
      scene.fog = new THREE.FogExp2(activeScene.environment.fogColor || '#0F172A', 0.022);
    } else {
      scene.fog = null;
    }

    const meshSignature =
      `${isPlaying}_${activeScene.id}_${Boolean(project.editorSettings?.showDebugHitboxes)}_` +
      activeScene.entities
        .filter((e) => e.kind !== 'hud-text' && e.kind !== 'text-box')
        .map((e) => `${e.id}:${e.kind}:${e.model3dPreset || ''}:${e.assetId || ''}:${e.color}`)
        .join('|');

    if (!isPlaying && meshSignature === lastMeshSigRef.current && simMapRef.current.size > 0) {
      if (!transformCtrlRef.current?.dragging) {
        for (const ent of activeScene.entities) {
          const sim = simMapRef.current.get(ent.id);
          if (sim) {
            sim.entity = { ...ent };
            sim.baseY = ent.y;
            sim.object3D.position.set(ent.x, ent.y, ent.z);
            sim.object3D.rotation.set(
              THREE.MathUtils.degToRad(ent.rotationX),
              THREE.MathUtils.degToRad(ent.rotationY),
              THREE.MathUtils.degToRad(ent.rotationZ)
            );
            sim.object3D.scale.set(
              Math.max(0.2, ent.width / 1.4),
              Math.max(0.2, ent.height / 1.4),
              Math.max(0.2, ent.depth / 1.4)
            );
            sim.object3D.visible = ent.visible;
          }
        }
      }
    } else {
      lastMeshSigRef.current = meshSignature;
      void syncSceneEntities(scene, activeScene, project);
    }

    if (isPlaying) {
      audioEngine.startBgm(project.soundBindings.bgm, project.assets);
      compiledScriptsRef.current = compileRuntimeScripts(project.codeFiles, (fname, errMsg) => {
        logsRef.current = [`خطای کد ${fname}: ${errMsg}`, ...logsRef.current.slice(0, 14)];
      });
      scriptsStartedRef.current = false;
    } else {
      audioEngine.stopBgm();
      compiledScriptsRef.current = [];
      scriptsStartedRef.current = false;
    }

    return () => {
      audioEngine.stopBgm();
    };
  }, [
    project.activeSceneId,
    project.entities,
    project.assets,
    project.environment,
    project.camera,
    project.editorSettings,
    project.codeFiles,
    isPlaying,
    project.variables.score,
    project.variables.health,
    project.customVariables,
    project.soundBindings.bgm,
  ]);

  // Mount WebGLRenderer once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;
    renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestored);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(projectRef.current.environment.backgroundColor || '#0F172A');
    if (projectRef.current.environment.fogEnabled) {
      scene.fog = new THREE.FogExp2(projectRef.current.environment.fogColor || '#0F172A', 0.022);
    }

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 220);
    camera.position.set(8, 8, 14);

    // 3-point studio lighting rig
    const hemiLight = new THREE.HemisphereLight(0xcbe5ff, 0x1e293b, 0.75);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.8);
    keyLight.position.set(12, 18, 10);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -20;
    keyLight.shadow.camera.right = 20;
    keyLight.shadow.camera.top = 20;
    keyLight.shadow.camera.bottom = -20;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-10, 8, -12);
    scene.add(rimLight);

    // Ground arena plane + subtle procedural grid
    const groundGeo = new THREE.PlaneGeometry(80, 80);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x161d2b,
      roughness: 0.85,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(60, 30, 0x334155, 0x1e293b);
    grid.position.y = 0.01;
    scene.add(grid);

    // Construct TransformControls BEFORE OrbitControls so gizmo pointer events take strict priority
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode(transformModeRef.current);
    transformControls.setSize(1.2);
    transformCtrlRef.current = transformControls;
    scene.add(transformControls.getHelper());

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbitCtrlRef.current = orbit;
    orbit.enableDamping = !isSoftwareGl;
    orbit.dampingFactor = 0.06;
    orbit.maxPolarAngle = Math.PI / 2 - 0.04;
    orbit.minDistance = 3;
    orbit.maxDistance = 45;

    let suppressNextPointerUp = false;

    transformControls.addEventListener('axis-changed', (event) => {
      if (isPlayingRef.current) return;
      const hoveringAxis = event.value !== null;
      renderer.domElement.style.cursor = hoveringAxis ? 'grab' : 'default';
      orbit.enabled = !hoveringAxis && !transformControls.dragging;
    });

    transformControls.addEventListener('objectChange', () => {
      const obj = transformControls.object;
      if (!obj) return;
      if (obj.position.y < 0) obj.position.y = 0;
      obj.scale.set(
        Math.max(0.2, obj.scale.x),
        Math.max(0.2, obj.scale.y),
        Math.max(0.2, obj.scale.z)
      );
      boxHelpersRef.current.forEach((h) => h.update());
      renderer.render(scene, camera);
    });

    transformControls.addEventListener('dragging-changed', (event) => {
      if (event.value) {
        suppressNextPointerUp = true;
        orbit.enabled = false;
        renderer.domElement.style.cursor = 'grabbing';
      } else {
        orbit.enabled = transformControls.axis === null;
        renderer.domElement.style.cursor = transformControls.axis ? 'grab' : 'default';
        window.setTimeout(() => {
          suppressNextPointerUp = false;
        }, 60);
        if (transformControls.object) {
          const obj = transformControls.object;
          const id = obj.userData.entityId as string | undefined;
          if (id) {
            const sim = simMapRef.current.get(id);
            if (sim) {
              sim.baseY = Number(Math.max(0, obj.position.y).toFixed(2));
            }
            onUpdateRef.current(id, {
              x: Number(obj.position.x.toFixed(2)),
              y: Number(Math.max(0, obj.position.y).toFixed(2)),
              z: Number(obj.position.z.toFixed(2)),
              rotationX: Math.round(THREE.MathUtils.radToDeg(obj.rotation.x)),
              rotationY: Math.round(THREE.MathUtils.radToDeg(obj.rotation.y)),
              rotationZ: Math.round(THREE.MathUtils.radToDeg(obj.rotation.z)),
              width: Number(Math.max(0.28, obj.scale.x * 1.4).toFixed(2)),
              height: Number(Math.max(0.28, obj.scale.y * 1.4).toFixed(2)),
              depth: Number(Math.max(0.28, obj.scale.z * 1.4).toFixed(2)),
            });
          }
        }
      }
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      if (transformControls.dragging || transformControls.axis !== null) {
        suppressNextPointerUp = true;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      if (suppressNextPointerUp || transformControls.dragging || transformControls.axis !== null) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const targets = Array.from(simMapRef.current.values())
        .filter((s) => s.alive && s.object3D.visible)
        .map((s) => s.object3D);

      const hits = raycaster.intersectObjects(targets, true);
      if (hits.length > 0) {
        const hitEntityId = hits[0].object.userData.entityId as string | undefined;
        if (hitEntityId) {
          if (!isPlayingRef.current) {
            onSelectRef.current(hitEntityId);
          } else {
            const hitSim = simMapRef.current.get(hitEntityId);
            if (hitSim) {
              const clickRules = runtimeSceneRef.current.rules.filter(
                (rule) =>
                  rule.enabled &&
                  rule.triggerType === 'on-click' &&
                  rule.targetName === hitSim.entity.name
              );
              if (hitSim.entity.clickable || clickRules.length > 0) {
                audioEngine.playSound(
                  projectRef.current.soundBindings.onClick || 'click',
                  projectRef.current.assets
                );
                spawn3DParticles(scene, hitSim.object3D.position, 'sparkle', 10);
                clickRules.forEach((rule) => run3DRule(rule, 0.016, false));
                if (clickRules.length === 0) {
                  logsRef.current = [
                    `کلیک روی «${hitSim.entity.name}»`,
                    ...logsRef.current.slice(0, 14),
                  ];
                }
              }
            }
          }
        }
      } else if (!isPlayingRef.current) {
        onSelectRef.current(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const projectiles: Projectile3D[] = [];
    const projGeo = new THREE.SphereGeometry(0.22, 12, 10);
    const projMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.7,
      roughness: 0.2,
    });
    const triggeredOnce = new Set<string>();
    const timerAcc = new Map<string, number>();
    const collisionCooldown = new Map<string, number>();

    const run3DRule = (rule: GameRule, dt: number, isContinuous: boolean) => {
      const sims = Array.from(simMapRef.current.values());
      const target = sims.find((s) => s.alive && s.entity.name === rule.targetName);
      const secondary = rule.secondaryName
        ? sims.find((s) => s.alive && s.entity.name === rule.secondaryName)
        : undefined;

      switch (rule.actionType) {
        case 'move-right':
          if (target) {
            const sp = rule.paramNumber ?? 7;
            target.vx = sp > 30 ? sp / 35 : sp;
            target.facingX = 1;
            target.facingZ = 0;
          }
          break;
        case 'move-left':
          if (target) {
            const sp = rule.paramNumber ?? 7;
            target.vx = -(sp > 30 ? sp / 35 : sp);
            target.facingX = -1;
            target.facingZ = 0;
          }
          break;
        case 'move-forward':
        case 'move-up':
          if (target) {
            const sp = rule.paramNumber ?? 7;
            target.vz = -(sp > 30 ? sp / 35 : sp);
            target.facingX = 0;
            target.facingZ = -1;
          }
          break;
        case 'move-backward':
        case 'move-down':
          if (target) {
            const sp = rule.paramNumber ?? 7;
            target.vz = sp > 30 ? sp / 35 : sp;
            target.facingX = 0;
            target.facingZ = 1;
          }
          break;
        case 'jump':
          if (target && target.onGround) {
            const pw = rule.paramNumber ?? 10;
            target.vy = pw > 40 ? pw / 50 : pw;
            target.onGround = false;
            spawn3DParticles(scene, target.object3D.position, 'smoke', 6);
            audioEngine.playSound(projectRef.current.soundBindings.onJump || 'jump', projectRef.current.assets);
          }
          break;
        case 'throw-projectile':
          if (target) {
            const sp = rule.paramNumber ?? 18;
            const speed = sp > 45 ? sp / 30 : sp;
            const angle = ((rule.paramAngle ?? 22) * Math.PI) / 180;
            const mesh = new THREE.Mesh(projGeo, projMat);
            mesh.position.set(
              target.object3D.position.x + target.facingX * 0.9,
              target.object3D.position.y + 0.9,
              target.object3D.position.z + target.facingZ * 0.9
            );
            scene.add(mesh);
            projectiles.push({
              mesh,
              vx: target.facingX * Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              vz: target.facingZ * Math.cos(angle) * speed,
              life: 3.5,
            });
            audioEngine.playSound(projectRef.current.soundBindings.onThrow || 'throw', projectRef.current.assets);
          }
          break;
        case 'patrol-horizontal':
          if (target) {
            const sp = rule.paramNumber ?? 3;
            target.vx = (sp > 20 ? sp / 35 : sp) * target.patrolDir;
            if (target.object3D.position.x < -10) target.patrolDir = 1;
            if (target.object3D.position.x > 10) target.patrolDir = -1;
          }
          break;
        case 'chase-target':
          if (target && secondary) {
            const sp = rule.paramNumber ?? 2.6;
            const speed = sp > 20 ? sp / 35 : sp;
            _vec3A.copy(secondary.object3D.position).sub(target.object3D.position);
            _vec3A.y = 0;
            if (_vec3A.lengthSq() > 0.01) {
              _vec3A.normalize();
              target.vx = _vec3A.x * speed;
              target.vz = _vec3A.z * speed;
              target.object3D.rotation.y = Math.atan2(_vec3A.x, _vec3A.z);
            }
          }
          break;
        case 'orbit-target':
          if (target && secondary) {
            target.orbitAngle += (rule.paramNumber ?? 1.5) * dt;
            target.object3D.position.x = secondary.object3D.position.x + Math.cos(target.orbitAngle) * 4;
            target.object3D.position.z = secondary.object3D.position.z + Math.sin(target.orbitAngle) * 4;
          }
          break;
        case 'add-score':
          varsRef.current.score += rule.paramNumber ?? 10;
          break;
        case 'add-health':
          varsRef.current.health = Math.max(0, varsRef.current.health + (rule.paramNumber ?? -15));
          break;
        case 'set-var':
          if (rule.varName) {
            varsRef.current.custom[rule.varName] = rule.paramNumber ?? 0;
          }
          break;
        case 'add-var':
          if (rule.varName) {
            varsRef.current.custom[rule.varName] =
              (varsRef.current.custom[rule.varName] ?? 0) + (rule.paramNumber ?? 1);
          }
          break;
        case 'spawn-entity': {
          const tpl =
            runtimeSceneRef.current.entities.find((e) => e.name === rule.targetName) ||
            runtimeSceneRef.current.entities.find((e) => e.role === 'enemy' || e.role === 'collectible');
          if (tpl) {
            const clonedEnt: GameEntity = {
              ...tpl,
              id: `${tpl.id}_clone_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              x: (Math.random() - 0.5) * 14,
              y: 1.5,
              z: (Math.random() - 0.5) * 14,
              visible: true,
            };
            void buildSingleEntityMesh(clonedEnt, projectRef.current).then((obj) => {
              scene.add(obj);
              simMapRef.current.set(clonedEnt.id, {
                entity: clonedEnt,
                object3D: obj,
                baseY: clonedEnt.y,
                vx: 0,
                vy: 0,
                vz: 0,
                alive: true,
                onGround: false,
                facingX: 0,
                facingZ: 1,
                patrolDir: 1,
                orbitAngle: 0,
                animTime: 0,
              });
              spawn3DParticles(scene, obj.position, 'sparkle', 10);
            });
          }
          break;
        }
        case 'spawn-particles': {
          const preset = (rule.paramText as ParticlePreset) || 'sparkle';
          const origin = target ? target.object3D.position : new THREE.Vector3(0, 1.5, 0);
          spawn3DParticles(scene, origin, preset, 18);
          break;
        }
        case 'camera-shake':
          shakeRef.current = Math.max(shakeRef.current, (rule.paramNumber ?? 10) * 0.04);
          break;
        case 'go-to-scene': {
          const next = projectRef.current.scenes.find((s) => s.name === rule.paramText);
          if (next && next.id !== runtimeSceneRef.current.id) {
            triggeredOnce.clear();
            timerAcc.clear();
            void syncSceneEntities(scene, next, projectRef.current);
          }
          break;
        }
        case 'next-scene': {
          const idx = projectRef.current.scenes.findIndex((s) => s.id === runtimeSceneRef.current.id);
          const next = projectRef.current.scenes[idx + 1];
          if (next) {
            triggeredOnce.clear();
            timerAcc.clear();
            void syncSceneEntities(scene, next, projectRef.current);
          } else {
            setBannerMessage('تبریک! تمام مراحل سه‌بعدی تکمیل شد!');
          }
          break;
        }
        case 'save-progress':
          try {
            localStorage.setItem(
              `rayan_save_${projectRef.current.id}`,
              JSON.stringify({
                score: varsRef.current.score,
                health: varsRef.current.health,
                custom: varsRef.current.custom,
                sceneId: runtimeSceneRef.current.id,
                savedAt: Date.now(),
              })
            );
          } catch {
            // ignore
          }
          break;
        case 'load-progress':
          try {
            const raw = localStorage.getItem(`rayan_save_${projectRef.current.id}`);
            if (raw) {
              const saved = JSON.parse(raw) as {
                score: number;
                health: number;
                custom?: Record<string, number>;
                sceneId?: string;
              };
              varsRef.current.score = saved.score ?? varsRef.current.score;
              varsRef.current.health = saved.health ?? varsRef.current.health;
              if (saved.custom) varsRef.current.custom = { ...varsRef.current.custom, ...saved.custom };
              if (saved.sceneId && saved.sceneId !== runtimeSceneRef.current.id) {
                const sc = projectRef.current.scenes.find((s) => s.id === saved.sceneId);
                if (sc) void syncSceneEntities(scene, sc, projectRef.current);
              }
            }
          } catch {
            // ignore
          }
          break;
        case 'destroy-other':
          if (secondary) {
            secondary.alive = false;
            secondary.object3D.visible = false;
            spawn3DParticles(scene, secondary.object3D.position, 'sparkle', 14);
          }
          break;
        case 'destroy-self':
          if (target) {
            target.alive = false;
            target.object3D.visible = false;
            spawn3DParticles(scene, target.object3D.position, 'explosion', 14);
          }
          break;
        case 'play-sound':
          if (!isContinuous) {
            audioEngine.playSound(rule.paramText || 'coin', projectRef.current.assets);
          }
          break;
        case 'show-message':
          setBannerMessage(rule.paramText || 'پیام بازی');
          break;
        case 'scroll-box': {
          const box = projectRef.current.entities.find((e) => e.name === rule.targetName);
          if (box) {
            const el = document.getElementById(`rayan-overlay-${box.id}`);
            if (el) {
              if (rule.paramText === 'x') {
                el.scrollLeft += rule.paramNumber ?? 60;
              } else {
                el.scrollTop += rule.paramNumber ?? 60;
              }
            }
          }
          break;
        }
      }
    };
    run3DRuleRef.current = run3DRule;

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 450;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    void syncSceneEntities(scene, runtimeSceneRef.current, projectRef.current);

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    let fpsCounter = 0;
    let fpsTimer = 0;
    let currentFps = 60;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const nowMs = performance.now();

      fpsCounter += 1;
      fpsTimer += dt;
      if (fpsTimer >= 0.5) {
        currentFps = Math.round(fpsCounter / fpsTimer);
        fpsCounter = 0;
        fpsTimer = 0;
        setDebugBadge({
          fps: currentFps,
          entities: Array.from(simMapRef.current.values()).filter((s) => s.alive).length,
          particles: particles3DRef.current.length,
          sceneName: runtimeSceneRef.current.name,
        });
      }

      if (isPlayingRef.current) {
        elapsedRef.current += dt;
        const curScene = runtimeSceneRef.current;
        const sims = Array.from(simMapRef.current.values());

        if (compiledScriptsRef.current.length > 0) {
          const scriptApi: ScriptRuntimeApi = {
            get score() {
              return varsRef.current.score;
            },
            setScore: (val) => {
              varsRef.current.score = val;
            },
            addScore: (delta) => {
              varsRef.current.score += delta;
            },
            get health() {
              return varsRef.current.health;
            },
            setHealth: (val) => {
              varsRef.current.health = Math.max(0, val);
            },
            get vars() {
              return varsRef.current.custom;
            },
            setVar: (name, val) => {
              varsRef.current.custom[name] = val;
            },
            get elapsed() {
              return elapsedRef.current;
            },
            findEntity: (name) => {
              const found = sims.find((s) => s.alive && s.entity.name === name);
              if (!found) return null;
              return {
                name: found.entity.name,
                x: found.object3D.position.x,
                y: found.object3D.position.y,
                z: found.object3D.position.z,
                vx: found.vx,
                vy: found.vy,
                visible: found.object3D.visible,
              };
            },
            moveEntity: (name, vx, vy, vz = 0) => {
              const found = sims.find((s) => s.alive && s.entity.name === name);
              if (found) {
                found.vx = vx;
                found.vy = vy;
                found.vz = vz;
              }
            },
            setEntityPosition: (name, x, y, z = 0) => {
              const found = sims.find((s) => s.alive && s.entity.name === name);
              if (found) {
                found.object3D.position.set(x, y, z);
              }
            },
            showMessage: (msg) => setBannerMessage(String(msg)),
            playSound: (name) => audioEngine.playSound(name, projectRef.current.assets),
            spawnParticles: () => {},
            log: (msg) => {
              logsRef.current = [String(msg), ...logsRef.current.slice(0, 14)];
            },
          };

          if (!scriptsStartedRef.current) {
            scriptsStartedRef.current = true;
            for (const h of compiledScriptsRef.current) {
              try {
                h.onStart?.(scriptApi);
              } catch {
                // ignore
              }
            }
          }
          for (const h of compiledScriptsRef.current) {
            try {
              h.onUpdate?.(scriptApi, dt);
            } catch {
              // ignore
            }
          }
        }

        sims.forEach((s) => {
          if (!s.alive || s.entity.physics.isStatic) return;
          s.vx *= 0.82;
          s.vz *= 0.82;
        });

        const allHeld: Record<string, boolean> = {
          ...keysHeldRef.current,
          ...virtualKeysRef.current,
        };
        curScene.rules.forEach((rule) => {
          if (!rule.enabled) return;
          if (rule.triggerType === 'on-start' && !triggeredOnce.has(rule.id)) {
            triggeredOnce.add(rule.id);
            run3DRule(rule, dt, false);
          } else if (rule.triggerType === 'every-seconds') {
            const acc = (timerAcc.get(rule.id) || 0) + dt;
            const interval = rule.intervalSeconds || 2;
            if (acc >= interval) {
              timerAcc.set(rule.id, acc - interval);
              run3DRule(rule, dt, false);
            } else {
              timerAcc.set(rule.id, acc);
            }
          } else if (rule.triggerType === 'always') {
            run3DRule(rule, dt, true);
          } else if (rule.triggerType === 'key-hold' && rule.key && allHeld[rule.key]) {
            run3DRule(rule, dt, true);
          } else if (rule.triggerType === 'key-press' && rule.key && keysJustPressedRef.current[rule.key]) {
            run3DRule(rule, dt, false);
          } else if (rule.triggerType === 'var-condition') {
            const v =
              rule.varName === 'health'
                ? varsRef.current.health
                : rule.varName === 'score' || !rule.varName
                  ? varsRef.current.score
                  : (varsRef.current.custom[rule.varName] ?? 0);
            const tv = rule.varValue ?? 0;
            const met = rule.operator === '<=' ? v <= tv : rule.operator === '==' ? v === tv : v >= tv;
            if (met && !triggeredOnce.has(rule.id)) {
              triggeredOnce.add(rule.id);
              run3DRule(rule, dt, false);
            }
          }
        });
        keysJustPressedRef.current = {};

        const grav = curScene.environment.gravity || 24;
        sims.forEach((s) => {
          if (!s.alive) return;
          s.animTime += dt;

          if (s.entity.animation?.preset === 'float') {
            s.object3D.position.y =
              s.baseY + Math.sin(s.animTime * (s.entity.animation.speed || 2.5)) * ((s.entity.animation.amplitude || 4) * 0.08);
          } else if (s.entity.animation?.preset === 'spin') {
            s.object3D.rotation.y += dt * (s.entity.animation.speed || 2);
          } else if (s.entity.animation?.preset === 'pulse') {
            const sc =
              1 + Math.sin(s.animTime * (s.entity.animation.speed || 3)) * ((s.entity.animation.amplitude || 6) * 0.015);
            s.object3D.scale.set(
              Math.max(0.2, s.entity.width / 1.4) * sc,
              Math.max(0.2, s.entity.height / 1.4) * sc,
              Math.max(0.2, s.entity.depth / 1.4) * sc
            );
          }

          if (s.entity.role === 'collectible' && !s.entity.animation?.preset) {
            s.object3D.rotation.y += dt * 1.8;
          }
          if (!s.entity.physics.enabled || s.entity.physics.isStatic) return;
          if (s.entity.physics.useGravity) {
            s.vy -= grav * dt;
          }
          s.object3D.position.x = THREE.MathUtils.clamp(s.object3D.position.x + s.vx * dt, -26, 26);
          s.object3D.position.z = THREE.MathUtils.clamp(s.object3D.position.z + s.vz * dt, -26, 26);
          s.object3D.position.y += s.vy * dt;

          if (s.object3D.position.y <= 0) {
            s.object3D.position.y = 0;
            s.vy = 0;
            s.onGround = true;
          }
          if (Math.abs(s.vx) + Math.abs(s.vz) > 0.2 && s.entity.role === 'player') {
            s.object3D.rotation.y = Math.atan2(s.vx, s.vz);
          }
        });

        // Projectiles update
        for (let i = projectiles.length - 1; i >= 0; i--) {
          const p = projectiles[i];
          p.vy -= grav * 0.55 * dt;
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;
          p.life -= dt;
          let remove = p.life <= 0 || p.mesh.position.y < -2;

          if (!remove) {
            for (const s of sims) {
              if (!s.alive || s.entity.role === 'player') continue;
              _vec3B.copy(s.object3D.position);
              _vec3B.y += 0.6;
              if (_vec3B.distanceTo(p.mesh.position) < 1.1) {
                if (s.entity.role === 'enemy') {
                  s.alive = false;
                  s.object3D.visible = false;
                  varsRef.current.score += 15;
                  spawn3DParticles(scene, s.object3D.position, 'explosion', 18);
                  shakeRef.current = Math.max(shakeRef.current, 0.25);
                  audioEngine.playSound(projectRef.current.soundBindings.onHit || 'hit', projectRef.current.assets);
                }
                remove = true;
                break;
              }
            }
          }
          if (remove) {
            scene.remove(p.mesh);
            projectiles.splice(i, 1);
          }
        }

        // Particles update
        for (let i = particles3DRef.current.length - 1; i >= 0; i--) {
          const pt = particles3DRef.current[i];
          pt.vy -= grav * pt.gravityFactor * dt;
          pt.mesh.position.x += pt.vx * dt;
          pt.mesh.position.y += pt.vy * dt;
          pt.mesh.position.z += pt.vz * dt;
          pt.life -= dt;
          const mat = pt.mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = Math.max(0, pt.life / pt.maxLife);
          if (pt.life <= 0) {
            scene.remove(pt.mesh);
            mat.dispose();
            particles3DRef.current.splice(i, 1);
          }
        }

        // Collisions
        curScene.rules.forEach((rule) => {
          if (!rule.enabled || rule.triggerType !== 'on-collision') return;
          const s1s = sims.filter((s) => s.alive && s.entity.name === rule.targetName);
          const s2s = rule.secondaryName
            ? sims.filter((s) => s.alive && s.entity.name === rule.secondaryName)
            : [];
          for (const s1 of s1s) {
            for (const s2 of s2s) {
              const dist = s1.object3D.position.distanceTo(s2.object3D.position);
              if (dist < 1.35) {
                const key = `${rule.id}_${s1.entity.id}_${s2.entity.id}`;
                const last = collisionCooldown.get(key) ?? 0;
                if (nowMs - last > 650) {
                  collisionCooldown.set(key, nowMs);
                  run3DRule(rule, dt, false);
                }
              }
            }
          }
        });

        // Smooth camera follow + zoom + shake in Play Mode
        const camZoom = Math.max(0.5, Math.min(2, curScene.camera?.zoom || 1));
        const followName = curScene.camera?.followTargetName || '';
        const targetBody =
          (followName ? sims.find((s) => s.alive && s.entity.name === followName) : undefined) ||
          sims.find((s) => s.alive && s.entity.role === 'player');
        if (targetBody) {
          const distScale = 1 / camZoom;
          _vec3A.set(
            targetBody.object3D.position.x + (Math.random() - 0.5) * shakeRef.current,
            targetBody.object3D.position.y + 6.5 * distScale + (Math.random() - 0.5) * shakeRef.current,
            targetBody.object3D.position.z + 11.5 * distScale
          );
          camera.position.lerp(_vec3A, 1 - Math.exp(-4 * dt));
          orbit.target.lerp(targetBody.object3D.position, 1 - Math.exp(-6 * dt));
        }
        shakeRef.current *= Math.pow(0.04, dt);
        if (shakeRef.current < 0.01) shakeRef.current = 0;

        setRuntimeVars({
          score: varsRef.current.score,
          health: varsRef.current.health,
          custom: { ...varsRef.current.custom },
          time: Math.floor(elapsedRef.current),
          level: projectRef.current.scenes.findIndex((s) => s.id === curScene.id) + 1 || 1,
        });
        onStatsRef.current?.({
          score: varsRef.current.score,
          health: varsRef.current.health,
          customVariables: { ...varsRef.current.custom },
          elapsedSeconds: Math.floor(elapsedRef.current),
          fps: currentFps,
          activeEntities: sims.filter((s) => s.alive).length,
          particleCount: particles3DRef.current.length,
          sceneName: curScene.name,
          message: null,
          logs: logsRef.current,
        });
      } else {
        triggeredOnce.clear();
        timerAcc.clear();
        collisionCooldown.clear();
      }

      boxHelpersRef.current.forEach((h) => h.update());
      orbit.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      orbit.dispose();
      transformControls.dispose();
      projGeo.dispose();
      projMat.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      particleGeoRef.current?.dispose();
      renderer.dispose();
    };
  }, []);

  const hudBoxes = project.entities.filter((e) => e.kind === 'hud-text' || e.kind === 'text-box');
  const interpolateText = (raw: string) => {
    let out = raw
      .replace(/\{score\}/g, String(runtimeVars.score))
      .replace(/\{health\}/g, String(runtimeVars.health))
      .replace(/\{time\}/g, String(runtimeVars.time))
      .replace(/\{level\}/g, String(runtimeVars.level));
    for (const [k, v] of Object.entries(runtimeVars.custom)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return out;
  };

  const setVirtualKey = (code: string, pressed: boolean) => {
    if (pressed && !virtualKeys[code]) {
      keysJustPressedRef.current[code] = true;
    }
    setVirtualKeys((prev) => ({ ...prev, [code]: pressed }));
  };

  const triggerLayerClick = (layer: BoxChildLayer) => {
    audioEngine.playSound(project.soundBindings.onClick || 'click', project.assets);
    const matchedRules = runtimeSceneRef.current.rules.filter(
      (rule) => rule.enabled && rule.triggerType === 'on-click' && rule.targetName === layer.name
    );
    matchedRules.forEach((rule) => run3DRuleRef.current?.(rule, 0.016, false));
    if (matchedRules.length === 0) {
      logsRef.current = [`کلیک روی لایه «${layer.name}»`, ...logsRef.current.slice(0, 14)];
    }
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-lg border border-slate-700/80 bg-[#0B0E14]"
      style={{ aspectRatio: `${project.screenConfig.width} / ${project.screenConfig.height}` }}
    >
      {isPlaying &&
        (project.codeFiles || [])
          .filter((cf) => cf.enabledInRuntime && cf.language === 'css')
          .map((cf) => <style key={cf.id}>{cf.content}</style>)}
      <div ref={mountRef} className="w-full h-full" />

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0B0E14] text-slate-300 text-sm">
          در حال بازیابی زمینه گرافیکی سه‌بعدی...
        </div>
      )}

      {/* Semantic 2D HUD & Scrollable Text Overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {hudBoxes.map((b) => {
          if (!b.visible || !b.textConfig) return null;
          const cfg = b.textConfig;
          const leftPct = (b.x / project.screenConfig.width) * 100;
          const topPct = (b.y / project.screenConfig.height) * 100;
          const widthPct = (b.width / project.screenConfig.width) * 100;
          const heightPct = (b.height / project.screenConfig.height) * 100;
          const isSelected = selectedEntityId === b.id && !isPlaying;
          const hasClickRule = runtimeSceneRef.current.rules.some(
            (r) => r.enabled && r.triggerType === 'on-click' && r.targetName === b.name
          );
          const isClickable = Boolean(cfg.clickable || b.clickable || hasClickRule);

          const hasScrollX = Boolean(cfg.scrollableX);
          const hasScrollY = Boolean(cfg.scrollable);
          const hasAnyScroll = hasScrollX || hasScrollY;

          return (
            <div
              key={b.id}
              id={`rayan-overlay-${b.id}`}
              onWheel={(e) => {
                if (!hasAnyScroll) return;
                e.stopPropagation();
                if (((hasScrollX && !hasScrollY) || (hasScrollX && e.shiftKey)) && e.deltaY !== 0 && e.deltaX === 0) {
                  e.currentTarget.scrollLeft += e.deltaY;
                }
              }}
              onPointerDown={(e) => {
                if (isPlaying) {
                  if (hasAnyScroll) {
                    const targetEl = e.currentTarget;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startScrollLeft = targetEl.scrollLeft;
                    const startScrollTop = targetEl.scrollTop;
                    let dragged = false;
                    const onPlayMove = (ev: PointerEvent) => {
                      const dx = ev.clientX - startX;
                      const dy = ev.clientY - startY;
                      if (Math.hypot(dx, dy) > 5) {
                        dragged = true;
                        if (hasScrollX) targetEl.scrollLeft = startScrollLeft - dx;
                        if (hasScrollY) targetEl.scrollTop = startScrollTop - dy;
                      }
                    };
                    const onPlayUp = () => {
                      if (dragged) {
                        suppressNextClickRef.current = true;
                        setTimeout(() => {
                          suppressNextClickRef.current = false;
                        }, 80);
                      }
                      window.removeEventListener('pointermove', onPlayMove);
                      window.removeEventListener('pointerup', onPlayUp);
                    };
                    window.addEventListener('pointermove', onPlayMove);
                    window.addEventListener('pointerup', onPlayUp);
                  }
                  return;
                }

                if (b.locked) return;
                if (hasAnyScroll) {
                  const boxRect = e.currentTarget.getBoundingClientRect();
                  const nearVertBar =
                    hasScrollY && (e.clientX <= boxRect.left + 16 || e.clientX >= boxRect.right - 16);
                  const nearHorizBar = hasScrollX && e.clientY >= boxRect.bottom - 16;
                  if (nearVertBar || nearHorizBar) {
                    e.stopPropagation();
                    return;
                  }
                }
                e.stopPropagation();
                onSelectEntity(b.id);
                const containerEl = mountRef.current;
                if (!containerEl) return;
                const rect = containerEl.getBoundingClientRect();
                const startPtX = ((e.clientX - rect.left) / rect.width) * project.screenConfig.width;
                const startPtY = ((e.clientY - rect.top) / rect.height) * project.screenConfig.height;
                const offsetX = startPtX - b.x;
                const offsetY = startPtY - b.y;
                const onMove = (ev: PointerEvent) => {
                  const ptX = ((ev.clientX - rect.left) / rect.width) * project.screenConfig.width;
                  const ptY = ((ev.clientY - rect.top) / rect.height) * project.screenConfig.height;
                  onUpdateRef.current(b.id, {
                    x: Math.round(Math.max(0, Math.min(project.screenConfig.width - b.width, ptX - offsetX))),
                    y: Math.round(Math.max(0, Math.min(project.screenConfig.height - b.height, ptY - offsetY))),
                  });
                };
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isPlaying) {
                  onSelectEntity(b.id);
                  return;
                }
                if (suppressNextClickRef.current) return;
                if (isClickable) {
                  setClickedBoxId(b.id);
                  setTimeout(() => setClickedBoxId((cur) => (cur === b.id ? null : cur)), 160);
                  audioEngine.playSound(project.soundBindings.onClick || 'click', project.assets);
                  const matchedRules = runtimeSceneRef.current.rules.filter(
                    (rule) => rule.enabled && rule.triggerType === 'on-click' && rule.targetName === b.name
                  );
                  matchedRules.forEach((rule) => run3DRuleRef.current?.(rule, 0.016, false));
                  if (matchedRules.length === 0) {
                    logsRef.current = [`کلیک روی «${b.name}»`, ...logsRef.current.slice(0, 14)];
                  }
                }
              }}
              onScroll={() => {
                if (!isPlaying || !hasAnyScroll) return;
                const nowMs = performance.now();
                const last = lastScrollRuleRef.current.get(b.id) ?? 0;
                if (nowMs - last < 220) return;
                lastScrollRuleRef.current.set(b.id, nowMs);
                runtimeSceneRef.current.rules.forEach((rule) => {
                  if (rule.enabled && rule.triggerType === 'on-scroll' && rule.targetName === b.name) {
                    run3DRuleRef.current?.(rule, 0.016, false);
                  }
                });
              }}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
                transform: `${b.rotationZ ? `rotate(${b.rotationZ}deg)` : ''} ${
                  clickedBoxId === b.id ? 'scale(0.95)' : ''
                }`.trim() || undefined,
                fontSize: `${Math.max(11, Math.round(cfg.fontSize * 0.85))}px`,
                color: cfg.textColor,
                backgroundColor: cfg.boxBgColor,
                borderColor:
                  clickedBoxId === b.id ? '#FBBF24' : isSelected ? '#38BDF8' : cfg.boxBorderColor,
                borderWidth: `${isSelected || clickedBoxId === b.id ? 2 : cfg.boxBorderWidth}px`,
                borderStyle: 'solid',
                borderRadius: `${cfg.boxBorderRadius}px`,
                padding: `${cfg.boxPadding}px`,
                textAlign: cfg.align,
                overflowX: hasScrollX ? 'auto' : 'hidden',
                overflowY: hasScrollY ? 'auto' : 'hidden',
                overscrollBehavior: hasAnyScroll ? 'contain' : undefined,
                touchAction:
                  hasScrollX && hasScrollY
                    ? 'pan-x pan-y'
                    : hasScrollX
                      ? 'pan-x'
                      : hasScrollY
                        ? 'pan-y'
                        : undefined,
              }}
              className={`absolute pointer-events-auto leading-relaxed transition-all duration-100 ${
                !isPlaying
                  ? 'cursor-move'
                  : isClickable
                    ? 'cursor-pointer hover:brightness-110 active:scale-95'
                    : hasAnyScroll
                      ? 'cursor-grab active:cursor-grabbing'
                      : ''
              }`}
            >
              <BoxLayersRenderer
                cfg={cfg}
                assets={project.assets}
                isPlaying={isPlaying}
                interpolateText={interpolateText}
                onTriggerLayerClick={triggerLayerClick}
                suppressClickRef={suppressNextClickRef}
              />
            </div>
          );
        })}
      </div>

      {/* Live Debug Telemetry Badge */}
      {project.editorSettings?.showDebugHitboxes && (
        <div
          dir="ltr"
          className="absolute bottom-2 left-2 z-20 rounded bg-slate-950/85 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-mono text-emerald-300 flex items-center gap-3 pointer-events-none"
        >
          <span>FPS: {debugBadge.fps}</span>
          <span>Entities: {debugBadge.entities}</span>
          <span>Particles: {debugBadge.particles}</span>
          <span>{debugBadge.sceneName}</span>
        </div>
      )}

      {isPlaying && bannerMessage && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 bg-slate-950/95 border border-amber-500/60 rounded-xl px-6 py-4 text-center">
          <p className="text-lg font-bold text-amber-400">{bannerMessage}</p>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="mt-3 px-4 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400"
          >
            ادامه
          </button>
        </div>
      )}

      {/* Full 4-Way Touch Controls for Mobile/Tablet 3D */}
      {isPlaying &&
        (project.screenConfig.showTouchControls ||
          project.screenConfig.preset === 'phone-portrait' ||
          project.screenConfig.preset === 'phone-landscape' ||
          project.screenConfig.preset === 'tablet') && (
          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between pointer-events-none z-20">
            <div className="grid grid-cols-3 gap-1 pointer-events-auto">
              <div />
              <button
                type="button"
                onPointerDown={() => setVirtualKey('ArrowUp', true)}
                onPointerUp={() => setVirtualKey('ArrowUp', false)}
                onPointerLeave={() => setVirtualKey('ArrowUp', false)}
                className="w-10 h-10 rounded-lg bg-slate-900/80 border border-slate-600 text-white text-xs font-bold active:bg-amber-500 active:text-slate-950"
              >
                جلو
              </button>
              <div />
              <button
                type="button"
                onPointerDown={() => setVirtualKey('ArrowRight', true)}
                onPointerUp={() => setVirtualKey('ArrowRight', false)}
                onPointerLeave={() => setVirtualKey('ArrowRight', false)}
                className="w-10 h-10 rounded-lg bg-slate-900/80 border border-slate-600 text-white text-xs font-bold active:bg-amber-500 active:text-slate-950"
              >
                راست
              </button>
              <button
                type="button"
                onPointerDown={() => setVirtualKey('ArrowDown', true)}
                onPointerUp={() => setVirtualKey('ArrowDown', false)}
                onPointerLeave={() => setVirtualKey('ArrowDown', false)}
                className="w-10 h-10 rounded-lg bg-slate-900/80 border border-slate-600 text-white text-xs font-bold active:bg-amber-500 active:text-slate-950"
              >
                عقب
              </button>
              <button
                type="button"
                onPointerDown={() => setVirtualKey('ArrowLeft', true)}
                onPointerUp={() => setVirtualKey('ArrowLeft', false)}
                onPointerLeave={() => setVirtualKey('ArrowLeft', false)}
                className="w-10 h-10 rounded-lg bg-slate-900/80 border border-slate-600 text-white text-xs font-bold active:bg-amber-500 active:text-slate-950"
              >
                چپ
              </button>
            </div>
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                type="button"
                onPointerDown={() => setVirtualKey('KeyE', true)}
                onPointerUp={() => setVirtualKey('KeyE', false)}
                onPointerLeave={() => setVirtualKey('KeyE', false)}
                className="px-4 h-12 rounded-xl bg-sky-600/85 border border-sky-400 text-white text-xs font-bold active:bg-sky-400"
              >
                پرتاب
              </button>
              <button
                type="button"
                onPointerDown={() => setVirtualKey('Space', true)}
                onPointerUp={() => setVirtualKey('Space', false)}
                onPointerLeave={() => setVirtualKey('Space', false)}
                className="px-4 h-12 rounded-xl bg-amber-500/90 border border-amber-300 text-slate-950 text-xs font-bold active:bg-amber-300"
              >
                پرش
              </button>
            </div>
          </div>
        )}
    </div>
  );
};
