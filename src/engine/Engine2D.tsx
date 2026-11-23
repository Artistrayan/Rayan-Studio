import React, { useEffect, useRef, useState } from 'react';
import type {
  BoxChildLayer,
  GameEntity,
  GameRule,
  GameScene,
  ParticlePreset,
  RayanProject,
  TileType,
} from '../types/studio';
import { audioEngine } from './audioEngine';
import { BoxLayersRenderer } from '../components/BoxLayersRenderer';
import {
  createGameScriptSession,
  type GameScriptWorkerSession,
} from './customScriptRunner';
import type { HookCommandBatch } from '../runtime/workers/javascriptWorker';
import { retrieveBinaryModel } from '../storage/projectDb';
import {
  getDefaultCollisionConfig,
  getSpritesheetFrameCoords,
} from './gameRuntimeHelpers';

export interface RuntimeStatsPayload {
  score: number;
  health: number;
  customVariables: Record<string, number>;
  elapsedSeconds: number;
  fps: number;
  activeEntities: number;
  particleCount: number;
  sceneName: string;
  message: string | null;
  logs: string[];
}

interface Engine2DProps {
  project: RayanProject;
  isPlaying: boolean;
  selectedEntityId: string | null;
  editorTool?: 'select' | 'tile-paint' | 'tile-erase';
  activeTileType?: TileType;
  onPaintTile?: (col: number, row: number, tile: TileType | null) => void;
  onSelectEntity: (id: string | null) => void;
  onUpdateEntity: (id: string, patch: Partial<GameEntity>) => void;
  onRuntimeStats?: (stats: RuntimeStatsPayload) => void;
}

interface SimBody {
  id: string;
  name: string;
  role: GameEntity['role'];
  kind: GameEntity['kind'];
  shape2d?: GameEntity['shape2d'];
  assetId?: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  vx: number;
  vy: number;
  lastStepDx: number;
  lastStepDy: number;
  width: number;
  height: number;
  rotationZ: number;
  baseRotationZ: number;
  color: string;
  opacity: number;
  visible: boolean;
  locked?: boolean;
  clickable?: boolean;
  alive: boolean;
  onGround: boolean;
  facing: number;
  patrolDir: number;
  orbitAngle: number;
  animTime: number;
  physics: GameEntity['physics'];
  textConfig?: GameEntity['textConfig'];
  animation?: GameEntity['animation'];
  behavior?: GameEntity['behavior'];
  collisionConfig?: GameEntity['collisionConfig'];
}

interface Projectile2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
}

interface Particle2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  gravityFactor: number;
}

function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function drawTile2D(
  ctx: CanvasRenderingContext2D,
  type: TileType,
  px: number,
  py: number,
  size: number,
  timeSec: number
) {
  switch (type) {
    case 'ground':
      ctx.fillStyle = '#5B3A29';
      ctx.fillRect(px, py, size, size);
      ctx.fillStyle = '#22C55E';
      ctx.fillRect(px, py, size, Math.max(6, size * 0.22));
      break;
    case 'stone':
      ctx.fillStyle = '#475569';
      ctx.fillRect(px, py, size, size);
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
      ctx.beginPath();
      ctx.moveTo(px, py + size * 0.5);
      ctx.lineTo(px + size, py + size * 0.5);
      ctx.stroke();
      break;
    case 'platform':
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(px, py, size, Math.max(8, size * 0.3));
      ctx.fillStyle = '#64748B';
      ctx.fillRect(px + 4, py + size * 0.3, size - 8, 4);
      break;
    case 'hazard': {
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(px, py + size * 0.35, size, size * 0.65);
      ctx.fillStyle = '#F97316';
      const wave = Math.sin(timeSec * 6 + px * 0.05) * 3;
      ctx.beginPath();
      ctx.moveTo(px, py + size * 0.4 + wave);
      ctx.lineTo(px + size * 0.5, py + size * 0.12 - wave);
      ctx.lineTo(px + size, py + size * 0.4 + wave);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bounce':
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(px + 2, py + size * 0.65, size - 4, size * 0.35);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(px + 4, py + size * 0.42, size - 8, size * 0.18);
      break;
    case 'finish':
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(px + size * 0.2, py + 4, 4, size - 4);
      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.moveTo(px + size * 0.2 + 4, py + 4);
      ctx.lineTo(px + size * 0.9, py + size * 0.26);
      ctx.lineTo(px + size * 0.2 + 4, py + size * 0.48);
      ctx.closePath();
      ctx.fill();
      break;
  }
}

export const Engine2D: React.FC<Engine2DProps> = ({
  project,
  isPlaying,
  selectedEntityId,
  editorTool = 'select',
  activeTileType = 'ground',
  onPaintTile,
  onSelectEntity,
  onUpdateEntity,
  onRuntimeStats,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const keysHeldRef = useRef<Record<string, boolean>>({});
  const keysJustPressedRef = useRef<Record<string, boolean>>({});
  const simBodiesRef = useRef<SimBody[]>([]);
  const projectilesRef = useRef<Projectile2D[]>([]);
  const particlesRef = useRef<Particle2D[]>([]);
  const varsRef = useRef({
    score: project.variables.score,
    health: project.variables.health,
    custom: { ...(project.customVariables || {}) },
  });
  const triggeredOnceRef = useRef<Set<string>>(new Set());
  const timerAccRef = useRef<Map<string, number>>(new Map());
  const collisionCooldownRef = useRef<Map<string, number>>(new Map());
  const logsRef = useRef<string[]>([]);
  const cameraPosRef = useRef({ x: 0, y: 0, shake: 0 });
  const editorPanRef = useRef({ x: 0, y: 0 });
  const elapsedRef = useRef(0);
  const fpsRef = useRef({ frames: 0, timer: 0, current: 60 });

  const activeSceneFromProject = (): GameScene =>
    project.scenes.find((s) => s.id === project.activeSceneId) || {
      id: project.activeSceneId || 'scene_1',
      name: 'مرحله ۱',
      environment: project.environment,
      camera: project.camera,
      tilemap: project.tilemap,
      entities: project.entities,
      rulesText: project.rulesText,
      rules: project.rules,
    };

  const runtimeSceneRef = useRef<GameScene>(activeSceneFromProject());
  const dragStateRef = useRef<{
    entityId: string;
    offsetX: number;
    offsetY: number;
    mode: 'move' | 'resize';
  } | null>(null);
  const isPaintingTileRef = useRef(false);

  const [hudOverlayBodies, setHudOverlayBodies] = useState<SimBody[]>([]);
  const [runtimeVars, setRuntimeVars] = useState({
    score: project.variables.score,
    health: project.variables.health,
    custom: { ...(project.customVariables || {}) },
    time: 0,
    level: project.variables.level || 1,
  });
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [virtualKeys, setVirtualKeys] = useState<Record<string, boolean>>({});
  const [hoverClickable, setHoverClickable] = useState(false);
  const [clickedBoxId, setClickedBoxId] = useState<string | null>(null);
  const lastScrollRuleRef = useRef<Map<string, number>>(new Map());
  const suppressNextClickRef = useRef(false);
  const scriptSessionRef = useRef<GameScriptWorkerSession | null>(null);
  const scriptsStartedRef = useRef(false);
  const scriptStepAccRef = useRef(0);
  const idbObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const [debugBadge, setDebugBadge] = useState<{
    fps: number;
    entities: number;
    particles: number;
    sceneName: string;
  }>({ fps: 60, entities: project.entities.length, particles: 0, sceneName: activeSceneFromProject().name });

  const screenW = project.screenConfig.width;
  const screenH = project.screenConfig.height;

  const spawnParticleBurst = (x: number, y: number, preset: ParticlePreset, count = 18) => {
    const paletteMap: Record<ParticlePreset, string[]> = {
      explosion: ['#EF4444', '#F97316', '#FACC15', '#FCA5A5'],
      sparkle: ['#FBBF24', '#38BDF8', '#34D399', '#FDE68A'],
      smoke: ['#94A3B8', '#64748B', '#CBD5E1'],
      snow: ['#F8FAFC', '#E0F2FE', '#BAE6FD'],
      rain: ['#38BDF8', '#60A5FA', '#93C5FD'],
    };
    const colors = paletteMap[preset] || paletteMap.sparkle;
    for (let i = 0; i < count; i++) {
      const angle =
        preset === 'snow' || preset === 'rain'
          ? Math.PI / 2 + (Math.random() - 0.5) * 0.3
          : Math.random() * Math.PI * 2;
      const speed =
        preset === 'rain'
          ? 260 + Math.random() * 140
          : preset === 'snow'
            ? 40 + Math.random() * 50
            : preset === 'smoke'
              ? 35 + Math.random() * 55
              : 90 + Math.random() * 210;
      const maxLife = preset === 'snow' || preset === 'rain' ? 1.8 : 0.45 + Math.random() * 0.45;
      particlesRef.current.push({
        x:
          preset === 'snow' || preset === 'rain'
            ? cameraPosRef.current.x + Math.random() * screenW
            : x,
        y: preset === 'snow' || preset === 'rain' ? cameraPosRef.current.y - 10 : y,
        vx: Math.cos(angle) * speed,
        vy:
          preset === 'smoke'
            ? -Math.abs(Math.sin(angle) * speed) - 25
            : Math.sin(angle) * speed,
        size: preset === 'rain' ? 3 : preset === 'smoke' ? 8 + Math.random() * 6 : 3 + Math.random() * 4,
        color: colors[i % colors.length],
        life: maxLife,
        maxLife,
        gravityFactor: preset === 'explosion' ? 0.45 : preset === 'smoke' ? -0.1 : 0.15,
      });
    }
    if (particlesRef.current.length > 350) {
      particlesRef.current.splice(0, particlesRef.current.length - 350);
    }
  };

  const loadSceneIntoSimulation = (scene: GameScene, resetVars: boolean) => {
    runtimeSceneRef.current = scene;
    simBodiesRef.current = scene.entities.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      kind: e.kind,
      shape2d: e.shape2d,
      assetId: e.assetId,
      x: e.x,
      y: e.y,
      startX: e.x,
      startY: e.y,
      vx: 0,
      vy: 0,
      lastStepDx: 0,
      lastStepDy: 0,
      width: e.width,
      height: e.height,
      rotationZ: e.rotationZ,
      baseRotationZ: e.rotationZ,
      color: e.color,
      opacity: e.opacity,
      visible: e.visible,
      locked: e.locked,
      clickable: e.clickable ?? e.textConfig?.clickable,
      alive: true,
      onGround: false,
      facing: 1,
      patrolDir: 1,
      orbitAngle: 0,
      animTime: Math.random() * 3,
      physics: { ...e.physics },
      textConfig: e.textConfig ? { ...e.textConfig } : undefined,
      animation: e.animation ? { ...e.animation } : undefined,
      behavior: e.behavior ? { ...e.behavior } : undefined,
      collisionConfig: e.collisionConfig
        ? { ...e.collisionConfig }
        : getDefaultCollisionConfig(e.role),
    }));
    projectilesRef.current = [];
    particlesRef.current = [];
    triggeredOnceRef.current.clear();
    timerAccRef.current.clear();
    collisionCooldownRef.current.clear();
    cameraPosRef.current = { x: 0, y: 0, shake: 0 };

    if (resetVars) {
      varsRef.current = {
        score: project.variables.score,
        health: project.variables.health,
        custom: { ...(project.customVariables || {}) },
      };
      elapsedRef.current = 0;
      logsRef.current = [];
      setBannerMessage(null);
    }
    setRuntimeVars({
      score: varsRef.current.score,
      health: varsRef.current.health,
      custom: { ...varsRef.current.custom },
      time: Math.floor(elapsedRef.current),
      level: project.scenes.findIndex((s) => s.id === scene.id) + 1 || 1,
    });
    setHudOverlayBodies(
      simBodiesRef.current.filter((b) => b.kind === 'hud-text' || b.kind === 'text-box')
    );
  };

  // Preload images across all scenes & assets (including idb:// IndexedDB binaries)
  useEffect(() => {
    let cancelled = false;
    const cache = imageCacheRef.current;
    const urls: string[] = [];
    project.scenes.forEach((sc) => {
      if (sc.environment.backgroundType === 'image' && sc.environment.backgroundImageUrl) {
        urls.push(sc.environment.backgroundImageUrl);
      }
    });
    if (project.environment.backgroundType === 'image' && project.environment.backgroundImageUrl) {
      urls.push(project.environment.backgroundImageUrl);
    }

    for (const a of project.assets) {
      if (a.kind !== 'image') continue;
      if (a.dataUrl && !a.dataUrl.startsWith('idb://')) {
        urls.push(a.dataUrl);
      } else if (!idbObjectUrlsRef.current.has(a.id)) {
        void retrieveBinaryModel(a.id).then((model) => {
          if (cancelled || !model || !model.buffer) return;
          const mime =
            a.format === 'svg'
              ? 'image/svg+xml'
              : `image/${a.format === 'jpg' ? 'jpeg' : a.format}`;
          const objUrl = URL.createObjectURL(new Blob([model.buffer], { type: mime }));
          idbObjectUrlsRef.current.set(a.id, objUrl);
          const img = new Image();
          img.src = objUrl;
          cache.set(`idb://${a.id}`, img);
          cache.set(objUrl, img);
        });
      }
    }

    urls.forEach((url) => {
      if (!cache.has(url)) {
        const img = new Image();
        img.src = url;
        cache.set(url, img);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [project.assets, project.environment.backgroundImageUrl, project.environment.backgroundType, project.scenes]);

  useEffect(() => {
    const objectUrlMap = idbObjectUrlsRef.current;
    return () => {
      objectUrlMap.forEach((u) => URL.revokeObjectURL(u));
      objectUrlMap.clear();
    };
  }, []);

  // Initialize simulation when entering/leaving Play Mode or updating scene in Editor
  useEffect(() => {
    const scene = activeSceneFromProject();
    loadSceneIntoSimulation(scene, true);

    scriptSessionRef.current?.dispose();
    scriptSessionRef.current = null;
    scriptsStartedRef.current = false;
    scriptStepAccRef.current = 0;

    if (isPlaying) {
      audioEngine.startBgm(project.soundBindings.bgm, project.assets);
      scriptSessionRef.current = createGameScriptSession(project.codeFiles, (fname, errMsg) => {
        logsRef.current = [`خطای کد ${fname}: ${errMsg}`, ...logsRef.current.slice(0, 14)];
      });
    } else {
      audioEngine.stopBgm();
    }

    return () => {
      audioEngine.stopBgm();
      scriptSessionRef.current?.dispose();
      scriptSessionRef.current = null;
    };
  }, [
    isPlaying,
    project.activeSceneId,
    project.entities,
    project.tilemap,
    project.environment,
    project.camera,
    project.variables.score,
    project.variables.health,
    project.customVariables,
    project.soundBindings.bgm,
    project.assets,
    project.codeFiles,
  ]);

  // Keyboard listeners during play mode
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

  const executeRuleAction = (rule: GameRule, dt: number, isContinuous: boolean) => {
    const scene = runtimeSceneRef.current;
    const worldW = Math.max(screenW, scene.camera?.worldWidth || screenW);
    const target = simBodiesRef.current.find((b) => b.alive && b.name === rule.targetName);
    const secondary = rule.secondaryName
      ? simBodiesRef.current.find((b) => b.alive && b.name === rule.secondaryName)
      : undefined;

    const pushLog = (msg: string) => {
      logsRef.current = [msg, ...logsRef.current.slice(0, 14)];
    };

    switch (rule.actionType) {
      case 'move-right':
        if (target) {
          const speed = rule.paramNumber ?? 240;
          target.vx = speed;
          target.facing = 1;
        }
        break;
      case 'move-left':
        if (target) {
          const speed = rule.paramNumber ?? 240;
          target.vx = -speed;
          target.facing = -1;
        }
        break;
      case 'move-up':
        if (target) {
          const speed = rule.paramNumber ?? 240;
          target.vy = -speed;
        }
        break;
      case 'move-down':
        if (target) {
          const speed = rule.paramNumber ?? 240;
          target.vy = speed;
        }
        break;
      case 'jump':
        if (target && (target.onGround || !target.physics.useGravity)) {
          target.vy = -(rule.paramNumber ?? 540);
          target.onGround = false;
          spawnParticleBurst(target.x + target.width / 2, target.y + target.height, 'smoke', 7);
          audioEngine.playSound(project.soundBindings.onJump || 'jump', project.assets);
        }
        break;
      case 'throw-projectile':
        if (target) {
          const speed = rule.paramNumber ?? 560;
          const angleDeg = rule.paramAngle ?? 25;
          const rad = (angleDeg * Math.PI) / 180;
          projectilesRef.current.push({
            x: target.x + (target.facing > 0 ? target.width + 6 : -6),
            y: target.y + target.height * 0.4,
            vx: Math.cos(rad) * speed * target.facing,
            vy: -Math.sin(rad) * speed,
            radius: 9,
            color: '#38BDF8',
            life: 4,
          });
          audioEngine.playSound(project.soundBindings.onThrow || 'throw', project.assets);
          pushLog(`پرتاب از ${target.name}`);
        }
        break;
      case 'throw-self':
        if (target) {
          const speed = rule.paramNumber ?? 480;
          const angleDeg = rule.paramAngle ?? 50;
          const rad = (angleDeg * Math.PI) / 180;
          target.vx = Math.cos(rad) * speed * target.facing;
          target.vy = -Math.sin(rad) * speed;
          target.onGround = false;
          audioEngine.playSound(project.soundBindings.onThrow || 'throw', project.assets);
        }
        break;
      case 'patrol-horizontal':
        if (target) {
          const speed = rule.paramNumber ?? 110;
          target.vx = speed * target.patrolDir;
          if (target.x <= 24) target.patrolDir = 1;
          if (target.x + target.width >= worldW - 24) target.patrolDir = -1;
        }
        break;
      case 'chase-target':
        if (target && secondary) {
          const speed = rule.paramNumber ?? 95;
          const dx = secondary.x - target.x;
          const dy = secondary.y - target.y;
          const dist = Math.hypot(dx, dy) || 1;
          target.vx = (dx / dist) * speed;
          if (!target.physics.useGravity) {
            target.vy = (dy / dist) * speed;
          }
        }
        break;
      case 'orbit-target':
        if (target && secondary) {
          const speed = rule.paramNumber ?? 2;
          target.orbitAngle += speed * dt;
          const r = 110;
          target.x = secondary.x + Math.cos(target.orbitAngle) * r;
          target.y = secondary.y + Math.sin(target.orbitAngle) * r;
        }
        break;
      case 'add-score':
        varsRef.current.score += rule.paramNumber ?? 10;
        pushLog(`امتیاز: ${varsRef.current.score}`);
        break;
      case 'add-health':
        varsRef.current.health = Math.max(0, varsRef.current.health + (rule.paramNumber ?? -10));
        pushLog(`جان: ${varsRef.current.health}`);
        break;
      case 'set-var':
        if (rule.varName) {
          varsRef.current.custom[rule.varName] = rule.paramNumber ?? 0;
          pushLog(`${rule.varName} = ${varsRef.current.custom[rule.varName]}`);
        }
        break;
      case 'add-var':
        if (rule.varName) {
          varsRef.current.custom[rule.varName] =
            (varsRef.current.custom[rule.varName] ?? 0) + (rule.paramNumber ?? 1);
          pushLog(`${rule.varName}: ${varsRef.current.custom[rule.varName]}`);
        }
        break;
      case 'spawn-entity': {
        const template =
          scene.entities.find((e) => e.name === rule.targetName) ||
          scene.entities.find((e) => e.role === 'enemy' || e.role === 'collectible');
        if (template) {
          const spawnX = Math.max(
            40,
            Math.min(worldW - template.width - 40, cameraPosRef.current.x + Math.random() * (screenW - 80))
          );
          const spawnY = template.role === 'enemy' ? 60 : Math.max(40, template.y - 30 + Math.random() * 60);
          simBodiesRef.current.push({
            id: `${template.id}_clone_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: template.name,
            role: template.role,
            kind: template.kind,
            shape2d: template.shape2d,
            assetId: template.assetId,
            x: spawnX,
            y: spawnY,
            startX: spawnX,
            startY: spawnY,
            vx: 0,
            vy: 0,
            lastStepDx: 0,
            lastStepDy: 0,
            width: template.width,
            height: template.height,
            rotationZ: template.rotationZ,
            baseRotationZ: template.rotationZ,
            color: template.color,
            opacity: template.opacity,
            visible: true,
            alive: true,
            onGround: false,
            facing: 1,
            patrolDir: Math.random() > 0.5 ? 1 : -1,
            orbitAngle: 0,
            animTime: 0,
            physics: { ...template.physics },
            textConfig: template.textConfig ? { ...template.textConfig } : undefined,
            animation: template.animation ? { ...template.animation } : undefined,
            behavior: template.behavior ? { ...template.behavior } : undefined,
            collisionConfig: template.collisionConfig
              ? { ...template.collisionConfig }
              : getDefaultCollisionConfig(template.role),
          });
          spawnParticleBurst(spawnX + template.width / 2, spawnY + template.height / 2, 'sparkle', 10);
          pushLog(`تولید ${template.name}`);
        }
        break;
      }
      case 'spawn-particles': {
        const preset = (rule.paramText as ParticlePreset) || 'sparkle';
        const px = target ? target.x + target.width / 2 : cameraPosRef.current.x + screenW / 2;
        const py = target ? target.y + target.height / 2 : cameraPosRef.current.y + screenH / 2;
        spawnParticleBurst(px, py, preset, 22);
        break;
      }
      case 'camera-shake':
        cameraPosRef.current.shake = Math.max(cameraPosRef.current.shake, rule.paramNumber ?? 10);
        break;
      case 'go-to-scene': {
        const nextScene = project.scenes.find((s) => s.name === rule.paramText);
        if (nextScene && nextScene.id !== scene.id) {
          loadSceneIntoSimulation(nextScene, false);
          pushLog(`ورود به صحنه ${nextScene.name}`);
        }
        break;
      }
      case 'next-scene': {
        const idx = project.scenes.findIndex((s) => s.id === scene.id);
        const nextScene = project.scenes[idx + 1];
        if (nextScene) {
          loadSceneIntoSimulation(nextScene, false);
          pushLog(`مرحله بعد: ${nextScene.name}`);
        } else {
          setBannerMessage('تبریک! تمام مراحل با موفقیت به پایان رسید!');
        }
        break;
      }
      case 'save-progress':
        try {
          localStorage.setItem(
            `rayan_save_${project.id}`,
            JSON.stringify({
              score: varsRef.current.score,
              health: varsRef.current.health,
              custom: varsRef.current.custom,
              sceneId: scene.id,
              savedAt: Date.now(),
            })
          );
          pushLog('پیشرفت بازی ذخیره شد');
        } catch {
          // ignore storage quota errors
        }
        break;
      case 'load-progress':
        try {
          const raw = localStorage.getItem(`rayan_save_${project.id}`);
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
            if (saved.sceneId && saved.sceneId !== scene.id) {
              const targetSc = project.scenes.find((s) => s.id === saved.sceneId);
              if (targetSc) loadSceneIntoSimulation(targetSc, false);
            }
            pushLog('پیشرفت ذخیره شده بارگذاری شد');
          }
        } catch {
          // ignore invalid saved payload
        }
        break;
      case 'destroy-other':
        if (secondary) {
          secondary.alive = false;
          secondary.visible = false;
          spawnParticleBurst(secondary.x + secondary.width / 2, secondary.y + secondary.height / 2, 'sparkle', 14);
          pushLog(`حذف ${secondary.name}`);
        }
        break;
      case 'destroy-self':
        if (target) {
          target.alive = false;
          target.visible = false;
          spawnParticleBurst(target.x + target.width / 2, target.y + target.height / 2, 'explosion', 14);
          pushLog(`حذف ${target.name}`);
        }
        break;
      case 'respawn':
        if (target) {
          target.x = target.startX;
          target.y = target.startY;
          target.vx = 0;
          target.vy = 0;
        }
        break;
      case 'play-sound':
        if (!isContinuous) {
          audioEngine.playSound(rule.paramText || 'coin', project.assets);
        }
        break;
      case 'show-message':
        setBannerMessage(rule.paramText || 'پیام بازی');
        break;
      case 'set-text':
        if (target && target.textConfig) {
          target.textConfig.text = rule.paramText || '';
        }
        break;
      case 'scroll-box': {
        const el = document.getElementById(`rayan-overlay-${target?.id}`);
        if (el) {
          if (rule.paramText === 'x') {
            el.scrollLeft += rule.paramNumber ?? 60;
          } else {
            el.scrollTop += rule.paramNumber ?? 60;
          }
        }
        break;
      }
    }
  };

  // Main render & physics loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.04);
      lastTime = now;

      fpsRef.current.frames += 1;
      fpsRef.current.timer += dt;
      if (fpsRef.current.timer >= 0.5) {
        fpsRef.current.current = Math.round(fpsRef.current.frames / fpsRef.current.timer);
        fpsRef.current.frames = 0;
        fpsRef.current.timer = 0;
        setDebugBadge({
          fps: fpsRef.current.current,
          entities: simBodiesRef.current.filter((b) => b.alive).length,
          particles: particlesRef.current.length,
          sceneName: runtimeSceneRef.current.name,
        });
      }

      const scene = runtimeSceneRef.current;
      const bodies = simBodiesRef.current;
      const worldW = Math.max(screenW, scene.camera?.worldWidth || screenW);
      const worldH = Math.max(screenH, scene.camera?.worldHeight || screenH);
      const camZoom = Math.max(0.5, Math.min(2.2, scene.camera?.zoom || 1));

      if (isPlaying) {
        elapsedRef.current += dt;

        // 0. Custom IDE JS script hooks executed inside isolated Web Worker
        const session = scriptSessionRef.current;
        if (session?.active) {
          const applyHookBatch = (batch: HookCommandBatch) => {
            if (batch.setScore !== undefined) varsRef.current.score = batch.setScore;
            if (batch.scoreDelta) varsRef.current.score += batch.scoreDelta;
            if (batch.setHealth !== undefined) varsRef.current.health = Math.max(0, batch.setHealth);
            for (const [k, v] of Object.entries(batch.varPatches || {})) {
              varsRef.current.custom[k] = Number(v);
            }
            for (const mv of batch.moves || []) {
              const found = bodies.find((b) => b.alive && b.name === mv.name);
              if (found) {
                found.vx = mv.vx;
                found.vy = mv.vy;
              }
            }
            for (const pos of batch.positions || []) {
              const found = bodies.find((b) => b.alive && b.name === pos.name);
              if (found) {
                found.x = pos.x;
                found.y = pos.y;
              }
            }
            for (const pt of batch.particles || []) {
              spawnParticleBurst(pt.x, pt.y, (pt.preset || 'sparkle') as ParticlePreset, 18);
            }
            for (const snd of batch.sounds || []) {
              audioEngine.playSound(snd, project.assets);
            }
            if (batch.messages?.length) {
              setBannerMessage(batch.messages[batch.messages.length - 1]);
            }
            if (batch.logs?.length) {
              logsRef.current = [...batch.logs.slice().reverse(), ...logsRef.current].slice(0, 14);
            }
          };

          const snapshot = {
            score: varsRef.current.score,
            health: varsRef.current.health,
            vars: { ...varsRef.current.custom },
            elapsed: elapsedRef.current,
            entities: bodies
              .filter((b) => b.alive)
              .map((b) => ({
                name: b.name,
                x: b.x,
                y: b.y,
                vx: b.vx,
                vy: b.vy,
                visible: b.visible,
              })),
          };

          if (!scriptsStartedRef.current) {
            scriptsStartedRef.current = true;
            session.runStart(snapshot, applyHookBatch);
          } else {
            scriptStepAccRef.current += dt;
            if (scriptStepAccRef.current >= 0.032) {
              const stepDt = scriptStepAccRef.current;
              scriptStepAccRef.current = 0;
              session.stepUpdate(stepDt, snapshot, applyHookBatch);
            }
          }
        }

        // 1. Run start & timer rules
        scene.rules.forEach((rule) => {
          if (!rule.enabled) return;
          if (rule.triggerType === 'on-start' && !triggeredOnceRef.current.has(rule.id)) {
            triggeredOnceRef.current.add(rule.id);
            executeRuleAction(rule, dt, false);
          } else if (rule.triggerType === 'every-seconds') {
            const acc = (timerAccRef.current.get(rule.id) || 0) + dt;
            const interval = rule.intervalSeconds || 2;
            if (acc >= interval) {
              timerAccRef.current.set(rule.id, acc - interval);
              executeRuleAction(rule, dt, false);
            } else {
              timerAccRef.current.set(rule.id, acc);
            }
          }
        });

        // 2. Apply damping
        bodies.forEach((b) => {
          if (!b.alive || b.physics.isStatic) return;
          if (b.physics.useGravity) {
            b.vx *= Math.pow(1 - Math.min(0.95, b.physics.friction * 0.65), dt * 6);
          } else {
            b.vx *= 0.86;
            b.vy *= 0.86;
          }
        });

        // 3. Key-hold, Key-press, Always, and Variable Condition rules
        const allHeld: Record<string, boolean> = { ...keysHeldRef.current, ...virtualKeys };
        scene.rules.forEach((rule) => {
          if (!rule.enabled) return;
          if (rule.triggerType === 'always') {
            executeRuleAction(rule, dt, true);
          } else if (rule.triggerType === 'key-hold' && rule.key && allHeld[rule.key]) {
            executeRuleAction(rule, dt, true);
          } else if (rule.triggerType === 'key-press' && rule.key && keysJustPressedRef.current[rule.key]) {
            executeRuleAction(rule, dt, false);
          } else if (rule.triggerType === 'var-condition') {
            const val =
              rule.varName === 'health'
                ? varsRef.current.health
                : rule.varName === 'score' || !rule.varName
                  ? varsRef.current.score
                  : (varsRef.current.custom[rule.varName] ?? 0);
            const targetVal = rule.varValue ?? 0;
            const met =
              rule.operator === '<='
                ? val <= targetVal
                : rule.operator === '=='
                  ? val === targetVal
                  : val >= targetVal;
            if (met && !triggeredOnceRef.current.has(rule.id)) {
              triggeredOnceRef.current.add(rule.id);
              executeRuleAction(rule, dt, false);
            }
          }
        });
        keysJustPressedRef.current = {};

        // 3.5 Per-entity declarative Behaviors
        bodies.forEach((b) => {
          b.lastStepDx = 0;
          b.lastStepDy = 0;
          if (!b.alive || !b.behavior || b.behavior.mode === 'none') return;
          const beh = b.behavior;
          const targetObj =
            (beh.targetName
              ? bodies.find((t) => t.alive && t.name === beh.targetName)
              : undefined) || bodies.find((t) => t.alive && t.role === 'player');

          switch (beh.mode) {
            case 'patrol': {
              const sp = beh.speed ?? 110;
              const range = beh.range ?? 160;
              b.vx = sp * b.patrolDir;
              b.facing = b.patrolDir;
              if (b.x <= Math.max(8, b.startX - range)) b.patrolDir = 1;
              if (b.x >= Math.min(worldW - b.width - 8, b.startX + range)) b.patrolDir = -1;
              break;
            }
            case 'moving-platform': {
              const sp = beh.speed ?? 90;
              const range = beh.range ?? 150;
              const prevX = b.x;
              b.x += sp * b.patrolDir * dt;
              if (b.x <= Math.max(0, b.startX - range)) {
                b.x = Math.max(0, b.startX - range);
                b.patrolDir = 1;
              } else if (b.x >= Math.min(worldW - b.width, b.startX + range)) {
                b.x = Math.min(worldW - b.width, b.startX + range);
                b.patrolDir = -1;
              }
              b.lastStepDx = b.x - prevX;
              break;
            }
            case 'chase': {
              if (!targetObj || targetObj.id === b.id) break;
              const range = beh.range ?? 540;
              const dx = targetObj.x - b.x;
              const dy = targetObj.y - b.y;
              const dist = Math.hypot(dx, dy);
              if (dist > 4 && dist <= range) {
                const sp = beh.speed ?? 100;
                b.vx = (dx / dist) * sp;
                b.facing = dx >= 0 ? 1 : -1;
                if (!b.physics.useGravity) {
                  b.vy = (dy / dist) * sp;
                }
              }
              break;
            }
            case 'flee': {
              if (!targetObj || targetObj.id === b.id) break;
              const range = beh.range ?? 280;
              const dx = b.x - targetObj.x;
              const dy = b.y - targetObj.y;
              const dist = Math.hypot(dx, dy) || 1;
              if (dist <= range) {
                const sp = beh.speed ?? 120;
                b.vx = (dx / dist) * sp;
                b.facing = dx >= 0 ? 1 : -1;
                if (!b.physics.useGravity) {
                  b.vy = (dy / dist) * sp;
                }
              }
              break;
            }
            case 'orbit': {
              if (!targetObj || targetObj.id === b.id) break;
              b.orbitAngle += (beh.speed ?? 2) * dt;
              const r = beh.range ?? 110;
              b.x = targetObj.x + targetObj.width / 2 - b.width / 2 + Math.cos(b.orbitAngle) * r;
              b.y = targetObj.y + targetObj.height / 2 - b.height / 2 + Math.sin(b.orbitAngle) * r;
              break;
            }
            case 'turret-shoot': {
              if (!targetObj) break;
              const key = `beh_shoot_${b.id}`;
              const acc = (timerAccRef.current.get(key) || 0) + dt;
              const interval = beh.intervalSeconds || 2;
              if (acc >= interval) {
                timerAccRef.current.set(key, acc - interval);
                const dx = targetObj.x + targetObj.width / 2 - (b.x + b.width / 2);
                const dy = targetObj.y + targetObj.height / 2 - (b.y + b.height / 2);
                const dist = Math.hypot(dx, dy) || 1;
                const sp = beh.speed ?? 360;
                projectilesRef.current.push({
                  x: b.x + b.width / 2,
                  y: b.y + b.height / 2,
                  vx: (dx / dist) * sp,
                  vy: (dy / dist) * sp,
                  radius: 7,
                  color: '#F97316',
                  life: 3.5,
                });
                audioEngine.playSound(project.soundBindings.onThrow || 'throw', project.assets);
              } else {
                timerAccRef.current.set(key, acc);
              }
              break;
            }
          }
        });

        // 4. Physics Integration, Static Solids & Tilemap Collisions
        const gravity = scene.environment.gravity;
        const staticSolids = bodies.filter(
          (b) =>
            b.alive &&
            b.physics.enabled &&
            b.kind !== 'hud-text' &&
            b.kind !== 'text-box' &&
            (b.collisionConfig?.response === 'solid' ||
              (!b.collisionConfig && b.role === 'platform') ||
              b.behavior?.mode === 'moving-platform') &&
            (b.physics.isStatic || b.behavior?.mode === 'moving-platform')
        );
        const tileSize = scene.tilemap?.tileSize || 40;
        const tilesObj = scene.tilemap?.tiles || {};
        const tileEntries = Object.entries(tilesObj);

        bodies.forEach((b) => {
          b.animTime += dt;
          if (b.animation?.preset === 'spin') {
            b.rotationZ = (b.rotationZ + (b.animation.speed || 2) * 45 * dt) % 360;
          } else if (b.animation?.preset === 'swing') {
            b.rotationZ =
              b.baseRotationZ +
              Math.sin(b.animTime * (b.animation.speed || 3)) * (b.animation.amplitude || 14);
          }

          if (!b.alive || !b.physics.enabled || b.physics.isStatic) return;
          if (b.kind === 'hud-text' || b.kind === 'text-box') return;

          if (b.physics.useGravity) {
            b.vy += gravity * dt;
          }

          // Horizontal step
          b.x += b.vx * dt;
          if (b.x < 0) {
            b.x = 0;
            b.vx = -b.vx * b.physics.bounce;
          }
          if (b.x + b.width > worldW) {
            b.x = worldW - b.width;
            b.vx = -b.vx * b.physics.bounce;
          }
          for (const solid of staticSolids) {
            if (solid.id === b.id) continue;
            if (aabbOverlap(b.x, b.y, b.width, b.height, solid.x, solid.y, solid.width, solid.height)) {
              if (b.vx > 0) b.x = solid.x - b.width;
              else if (b.vx < 0) b.x = solid.x + solid.width;
              b.vx = 0;
            }
          }
          for (const [key, tType] of tileEntries) {
            if (tType !== 'ground' && tType !== 'stone') continue;
            const [cs, rs] = key.split(',');
            const tx = Number(cs) * tileSize;
            const ty = Number(rs) * tileSize;
            if (aabbOverlap(b.x, b.y, b.width, b.height, tx, ty, tileSize, tileSize)) {
              if (b.vx > 0) b.x = tx - b.width;
              else if (b.vx < 0) b.x = tx + tileSize;
              b.vx = 0;
            }
          }

          // Vertical step
          const prevBottom = b.y + b.height;
          b.y += b.vy * dt;
          b.onGround = false;

          for (const solid of staticSolids) {
            if (solid.id === b.id) continue;
            if (aabbOverlap(b.x, b.y, b.width, b.height, solid.x, solid.y, solid.width, solid.height)) {
              if (b.vy > 0) {
                b.y = solid.y - b.height;
                if (solid.lastStepDx !== 0) {
                  b.x = Math.max(0, Math.min(worldW - b.width, b.x + solid.lastStepDx));
                }
                if (b.physics.bounce > 0.25 && b.vy > 120) {
                  b.vy = -b.vy * b.physics.bounce;
                } else {
                  b.vy = 0;
                  b.onGround = true;
                }
              } else if (b.vy < 0) {
                b.y = solid.y + solid.height;
                b.vy = 0;
              }
            }
          }

          for (const [key, tType] of tileEntries) {
            const [cs, rs] = key.split(',');
            const tx = Number(cs) * tileSize;
            const ty = Number(rs) * tileSize;
            if (!aabbOverlap(b.x, b.y, b.width, b.height, tx, ty, tileSize, tileSize)) continue;

            if (tType === 'ground' || tType === 'stone') {
              if (b.vy > 0) {
                b.y = ty - b.height;
                b.vy = 0;
                b.onGround = true;
              } else if (b.vy < 0) {
                b.y = ty + tileSize;
                b.vy = 0;
              }
            } else if (tType === 'platform') {
              if (b.vy >= 0 && prevBottom <= ty + 10) {
                b.y = ty - b.height;
                b.vy = 0;
                b.onGround = true;
              }
            } else if (tType === 'bounce' && b.role === 'player') {
              b.vy = -700;
              b.onGround = false;
              spawnParticleBurst(b.x + b.width / 2, b.y + b.height, 'sparkle', 12);
              audioEngine.playSound('jump', project.assets);
            } else if (tType === 'hazard' && b.role === 'player') {
              const cdKey = `hazard_${b.id}`;
              if (now - (collisionCooldownRef.current.get(cdKey) ?? 0) > 750) {
                collisionCooldownRef.current.set(cdKey, now);
                const hazardRules = scene.rules.filter(
                  (r) => r.enabled && r.triggerType === 'on-tile-hazard' && r.targetName === b.name
                );
                if (hazardRules.length > 0) {
                  hazardRules.forEach((r) => executeRuleAction(r, dt, false));
                } else {
                  varsRef.current.health = Math.max(0, varsRef.current.health - 20);
                  spawnParticleBurst(b.x + b.width / 2, b.y + b.height / 2, 'explosion', 16);
                  cameraPosRef.current.shake = 10;
                  audioEngine.playSound('hit', project.assets);
                  b.vy = -340;
                }
              }
            } else if (tType === 'finish' && b.role === 'player') {
              const finKey = `finish_${scene.id}`;
              if (!triggeredOnceRef.current.has(finKey)) {
                triggeredOnceRef.current.add(finKey);
                const finRules = scene.rules.filter(
                  (r) => r.enabled && r.triggerType === 'on-tile-finish' && r.targetName === b.name
                );
                if (finRules.length > 0) {
                  finRules.forEach((r) => executeRuleAction(r, dt, false));
                } else {
                  setBannerMessage(`مرحله «${scene.name}» با موفقیت کامل شد!`);
                  audioEngine.playSound('win', project.assets);
                }
              }
            }
          }

          if (b.y + b.height >= worldH) {
            b.y = worldH - b.height;
            b.vy = 0;
            b.onGround = true;
          }
          if (b.y < 0) {
            b.y = 0;
            b.vy = 0;
          }
        });

        // 5. Projectiles update & collision
        const nextProj: Projectile2D[] = [];
        for (const p of projectilesRef.current) {
          p.vy += gravity * 0.55 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
          let hit = false;
          for (const b of bodies) {
            if (!b.alive || b.role === 'player' || b.kind === 'hud-text' || b.kind === 'text-box') continue;
            if (aabbOverlap(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2, b.x, b.y, b.width, b.height)) {
              if (b.role === 'enemy') {
                b.alive = false;
                b.visible = false;
                varsRef.current.score += 15;
                spawnParticleBurst(b.x + b.width / 2, b.y + b.height / 2, 'explosion', 20);
                cameraPosRef.current.shake = 7;
                audioEngine.playSound(project.soundBindings.onHit || 'hit', project.assets);
                logsRef.current = [`برخورد پرتابه با ${b.name}! (+15 امتیاز)`, ...logsRef.current.slice(0, 14)];
              }
              hit = true;
              break;
            }
          }
          if (!hit && p.life > 0 && p.x > -20 && p.x < worldW + 20 && p.y < worldH + 20) {
            nextProj.push(p);
          }
        }
        projectilesRef.current = nextProj;

        // 6. General CollisionConfig + Behavior Triggers & Entity-to-Entity Collision Rules
        for (const triggerBody of bodies) {
          if (!triggerBody.alive || triggerBody.kind === 'hud-text' || triggerBody.kind === 'text-box') continue;
          const behMode = triggerBody.behavior?.mode;
          const colCfg = triggerBody.collisionConfig;

          const effectiveAction =
            colCfg?.onCollideAction && colCfg.onCollideAction !== 'none'
              ? colCfg.onCollideAction
              : behMode === 'collectible-bob'
                ? 'collect'
                : behMode === 'hazard-damage'
                  ? 'damage'
                  : behMode === 'bounce-pad'
                    ? 'bounce'
                    : behMode === 'scene-portal'
                      ? 'go-to-scene'
                      : 'none';

          if (effectiveAction === 'none' && behMode !== 'checkpoint') continue;

          const filterRole = colCfg?.filterRole || 'player';
          for (const other of bodies) {
            if (!other.alive || other.id === triggerBody.id || other.kind === 'hud-text' || other.kind === 'text-box') continue;
            if (filterRole !== 'any' && other.role !== filterRole) continue;
            if (!aabbOverlap(triggerBody.x, triggerBody.y, triggerBody.width, triggerBody.height, other.x, other.y, other.width, other.height)) {
              continue;
            }

            if (behMode === 'checkpoint') {
              const cpKey = `cp_${triggerBody.id}_${other.id}`;
              if (!triggeredOnceRef.current.has(cpKey)) {
                triggeredOnceRef.current.add(cpKey);
                other.startX = triggerBody.x;
                other.startY = triggerBody.y - other.height;
                spawnParticleBurst(triggerBody.x + triggerBody.width / 2, triggerBody.y + triggerBody.height / 2, 'sparkle', 14);
                audioEngine.playSound('coin', project.assets);
                setBannerMessage(triggerBody.behavior?.message || `نقطه ذخیره «${triggerBody.name}» فعال شد`);
              }
              continue;
            }

            const cdKey = `gcol_${triggerBody.id}_${other.id}`;
            if (now - (collisionCooldownRef.current.get(cdKey) ?? 0) < 600) continue;
            collisionCooldownRef.current.set(cdKey, now);

            const amount = colCfg?.actionAmount ?? triggerBody.behavior?.amount ?? 10;
            if (effectiveAction === 'collect') {
              triggerBody.alive = false;
              triggerBody.visible = false;
              varsRef.current.score += amount;
              spawnParticleBurst(triggerBody.x + triggerBody.width / 2, triggerBody.y + triggerBody.height / 2, 'sparkle', 14);
              audioEngine.playSound(colCfg?.sound || project.soundBindings.onCollect || 'coin', project.assets);
              logsRef.current = [`جمع‌آوری ${triggerBody.name} (+${amount})`, ...logsRef.current.slice(0, 14)];
            } else if (effectiveAction === 'damage') {
              varsRef.current.health = Math.max(0, varsRef.current.health - amount);
              cameraPosRef.current.shake = 9;
              spawnParticleBurst(other.x + other.width / 2, other.y + other.height / 2, 'explosion', 14);
              audioEngine.playSound(colCfg?.sound || project.soundBindings.onHit || 'hit', project.assets);
              other.vy = -260;
              logsRef.current = [`برخورد با ${triggerBody.name} (-${amount} جان)`, ...logsRef.current.slice(0, 14)];
            } else if (effectiveAction === 'bounce') {
              other.vy = -(amount > 100 ? amount : 680);
              other.onGround = false;
              spawnParticleBurst(other.x + other.width / 2, other.y + other.height, 'sparkle', 10);
              audioEngine.playSound(colCfg?.sound || 'jump', project.assets);
            } else if (effectiveAction === 'destroy-other') {
              other.alive = false;
              other.visible = false;
              spawnParticleBurst(other.x + other.width / 2, other.y + other.height / 2, 'explosion', 14);
            } else if (effectiveAction === 'destroy-self') {
              triggerBody.alive = false;
              triggerBody.visible = false;
              spawnParticleBurst(triggerBody.x + triggerBody.width / 2, triggerBody.y + triggerBody.height / 2, 'explosion', 14);
            } else if (effectiveAction === 'next-scene') {
              const idx = project.scenes.findIndex((s) => s.id === scene.id);
              const nextSc = project.scenes[idx + 1];
              if (nextSc) {
                loadSceneIntoSimulation(nextSc, false);
              } else {
                setBannerMessage('تبریک! تمام مراحل با موفقیت به پایان رسید!');
              }
              break;
            } else if (effectiveAction === 'go-to-scene') {
              const targetScId = colCfg?.targetSceneId || triggerBody.behavior?.nextSceneId;
              const targetSc =
                project.scenes.find((s) => s.id === targetScId || s.name === targetScId) ||
                project.scenes[project.scenes.findIndex((s) => s.id === scene.id) + 1];
              if (targetSc && targetSc.id !== scene.id) {
                loadSceneIntoSimulation(targetSc, false);
              }
              break;
            }
          }
        }

        scene.rules.forEach((rule) => {
          if (!rule.enabled || rule.triggerType !== 'on-collision') return;
          const b1s = bodies.filter((b) => b.alive && b.name === rule.targetName);
          const b2s = rule.secondaryName
            ? bodies.filter((b) => b.alive && b.name === rule.secondaryName)
            : [];
          for (const b1 of b1s) {
            for (const b2 of b2s) {
              if (aabbOverlap(b1.x, b1.y, b1.width, b1.height, b2.x, b2.y, b2.width, b2.height)) {
                const cdKey = `${rule.id}_${b1.id}_${b2.id}`;
                const lastHit = collisionCooldownRef.current.get(cdKey) ?? 0;
                if (now - lastHit > 550) {
                  collisionCooldownRef.current.set(cdKey, now);
                  executeRuleAction(rule, dt, false);
                }
              }
            }
          }
        });

        // 7. Particles update
        const nextParticles: Particle2D[] = [];
        for (const pt of particlesRef.current) {
          pt.vy += gravity * pt.gravityFactor * dt;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.life -= dt;
          if (pt.life > 0) nextParticles.push(pt);
        }
        particlesRef.current = nextParticles;

        // 8. Camera Follow & Shake Decay
        const viewW = screenW / camZoom;
        const viewH = screenH / camZoom;
        const followTarget = scene.camera?.followTargetName
          ? bodies.find((b) => b.alive && b.name === scene.camera.followTargetName)
          : undefined;
        if (followTarget) {
          const targetCamX = Math.max(0, Math.min(worldW - viewW, followTarget.x + followTarget.width / 2 - viewW / 2));
          const targetCamY = Math.max(0, Math.min(worldH - viewH, followTarget.y + followTarget.height / 2 - viewH / 2));
          const smooth = Math.min(1, Math.max(0.03, scene.camera?.smoothing || 0.14));
          cameraPosRef.current.x += (targetCamX - cameraPosRef.current.x) * smooth;
          cameraPosRef.current.y += (targetCamY - cameraPosRef.current.y) * smooth;
        } else {
          cameraPosRef.current.x = 0;
          cameraPosRef.current.y = 0;
        }
        cameraPosRef.current.shake *= Math.pow(0.05, dt);
        if (cameraPosRef.current.shake < 0.2) cameraPosRef.current.shake = 0;

        setRuntimeVars({
          score: varsRef.current.score,
          health: varsRef.current.health,
          custom: { ...varsRef.current.custom },
          time: Math.floor(elapsedRef.current),
          level: project.scenes.findIndex((s) => s.id === scene.id) + 1 || 1,
        });
        onRuntimeStats?.({
          score: varsRef.current.score,
          health: varsRef.current.health,
          customVariables: { ...varsRef.current.custom },
          elapsedSeconds: Math.floor(elapsedRef.current),
          fps: fpsRef.current.current,
          activeEntities: bodies.filter((b) => b.alive).length,
          particleCount: particlesRef.current.length,
          sceneName: scene.name,
          message: bannerMessage,
          logs: logsRef.current,
        });
      }

      // Draw frame
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, screenW, screenH);

          // Static Background (Parallax / Backdrop)
          if (scene.environment.backgroundType === 'image' && scene.environment.backgroundImageUrl) {
            const img = imageCacheRef.current.get(scene.environment.backgroundImageUrl);
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, 0, 0, screenW, screenH);
            } else {
              ctx.fillStyle = scene.environment.backgroundColor || '#0B0E14';
              ctx.fillRect(0, 0, screenW, screenH);
            }
          } else if (scene.environment.backgroundType === 'gradient') {
            const grad = ctx.createLinearGradient(0, 0, 0, screenH);
            grad.addColorStop(0, scene.environment.backgroundColor || '#0F172A');
            grad.addColorStop(1, '#1E293B');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, screenW, screenH);
          } else {
            ctx.fillStyle = scene.environment.backgroundColor || '#0B0E14';
            ctx.fillRect(0, 0, screenW, screenH);
          }

          ctx.save();
          const activeCamX = isPlaying ? cameraPosRef.current.x : editorPanRef.current.x;
          const activeCamY = isPlaying ? cameraPosRef.current.y : editorPanRef.current.y;
          const shakeX = isPlaying ? (Math.random() - 0.5) * 2 * cameraPosRef.current.shake : 0;
          const shakeY = isPlaying ? (Math.random() - 0.5) * 2 * cameraPosRef.current.shake : 0;

          if (isPlaying && camZoom !== 1) {
            ctx.scale(camZoom, camZoom);
          }
          ctx.translate(-activeCamX + shakeX, -activeCamY + shakeY);

          // Editor subtle grid
          if (!isPlaying) {
            const gridStep = project.editorSettings?.gridSize || 40;
            ctx.save();
            ctx.strokeStyle = project.editorSettings?.snapToGrid
              ? 'rgba(56, 189, 248, 0.14)'
              : 'rgba(148, 163, 184, 0.08)';
            ctx.lineWidth = 1;
            for (let gx = 0; gx <= worldW; gx += gridStep) {
              ctx.beginPath();
              ctx.moveTo(gx, 0);
              ctx.lineTo(gx, worldH);
              ctx.stroke();
            }
            for (let gy = 0; gy <= worldH; gy += gridStep) {
              ctx.beginPath();
              ctx.moveTo(0, gy);
              ctx.lineTo(worldW, gy);
              ctx.stroke();
            }
            // World boundary outline if larger than viewport
            if (worldW > screenW || worldH > screenH) {
              ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
              ctx.lineWidth = 2;
              ctx.strokeRect(0, 0, worldW, worldH);
            }
            ctx.restore();
          }

          // Painted Tilemap layer
          const tileSize = scene.tilemap?.tileSize || 40;
          const tilesObj = scene.tilemap?.tiles || {};
          for (const [key, tType] of Object.entries(tilesObj)) {
            const [cs, rs] = key.split(',');
            drawTile2D(ctx, tType, Number(cs) * tileSize, Number(rs) * tileSize, tileSize, elapsedRef.current);
          }

          // Entities
          bodies.forEach((b) => {
            if (!b.visible || !b.alive) return;
            if (b.kind === 'hud-text' || b.kind === 'text-box') return;

            const animFloatY =
              isPlaying && (b.animation?.preset === 'float' || b.behavior?.mode === 'collectible-bob')
                ? Math.sin(b.animTime * (b.animation?.speed || 3)) * (b.animation?.amplitude || 7)
                : 0;
            const animScale =
              isPlaying && b.animation?.preset === 'pulse'
                ? 1 + Math.sin(b.animTime * (b.animation.speed || 3.5)) * ((b.animation.amplitude || 8) * 0.015)
                : 1;

            ctx.save();
            ctx.globalAlpha = b.opacity;
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2 + animFloatY;
            ctx.translate(cx, cy);
            ctx.rotate((b.rotationZ * Math.PI) / 180);
            ctx.scale(animScale, animScale);

            if (b.kind === 'sprite2d' && b.assetId) {
              const asset = project.assets.find((a) => a.id === b.assetId);
              const cacheKey = asset
                ? asset.dataUrl.startsWith('idb://')
                  ? idbObjectUrlsRef.current.get(asset.id) || asset.dataUrl
                  : asset.dataUrl
                : '';
              const img = cacheKey ? imageCacheRef.current.get(cacheKey) : undefined;
              if (img && img.complete && img.naturalWidth > 0) {
                ctx.scale(b.facing, 1);
                const cols = Math.max(1, b.animation?.spriteCols || 1);
                const rows = Math.max(1, b.animation?.spriteRows || 1);
                if (cols > 1 || rows > 1) {
                  const spriteState =
                    !b.onGround && b.physics.useGravity
                      ? 'jump'
                      : Math.abs(b.vx) > 15
                        ? 'walk'
                        : 'idle';
                  const coords = getSpritesheetFrameCoords(
                    b.animation,
                    spriteState,
                    b.animTime,
                    isPlaying
                  );
                  const sw = img.naturalWidth / coords.cols;
                  const sh = img.naturalHeight / coords.rows;
                  ctx.drawImage(
                    img,
                    coords.col * sw,
                    coords.row * sh,
                    sw,
                    sh,
                    -b.width / 2,
                    -b.height / 2,
                    b.width,
                    b.height
                  );
                } else {
                  ctx.drawImage(img, -b.width / 2, -b.height / 2, b.width, b.height);
                }
              } else {
                ctx.fillStyle = b.color;
                ctx.fillRect(-b.width / 2, -b.height / 2, b.width, b.height);
              }
            } else {
              ctx.fillStyle = b.color;
              if (b.shape2d === 'circle') {
                ctx.beginPath();
                ctx.ellipse(0, 0, b.width / 2, b.height / 2, 0, 0, Math.PI * 2);
                ctx.fill();
              } else if (b.shape2d === 'triangle') {
                ctx.beginPath();
                ctx.moveTo(0, -b.height / 2);
                ctx.lineTo(b.width / 2, b.height / 2);
                ctx.lineTo(-b.width / 2, b.height / 2);
                ctx.closePath();
                ctx.fill();
              } else if (b.shape2d === 'star') {
                ctx.beginPath();
                const spikes = 5;
                const outerR = Math.min(b.width, b.height) / 2;
                const innerR = outerR * 0.45;
                for (let i = 0; i < spikes * 2; i++) {
                  const r = i % 2 === 0 ? outerR : innerR;
                  const a = (i * Math.PI) / spikes - Math.PI / 2;
                  if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
                  else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                }
                ctx.closePath();
                ctx.fill();
              } else {
                const rad = b.role === 'platform' ? 6 : 10;
                ctx.beginPath();
                ctx.roundRect(-b.width / 2, -b.height / 2, b.width, b.height, rad);
                ctx.fill();
                if (b.role === 'player') {
                  ctx.fillStyle = '#0B0E14';
                  ctx.fillRect(b.facing > 0 ? 4 : -14, -b.height * 0.24, 10, 8);
                }
              }
            }
            ctx.restore();

            // Debug hitbox overlay
            if (project.editorSettings?.showDebugHitboxes && b.physics.enabled) {
              ctx.save();
              ctx.strokeStyle =
                b.role === 'enemy' ? '#EF4444' : b.role === 'player' ? '#FBBF24' : '#10B981';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(b.x, b.y, b.width, b.height);
              if (isPlaying && (Math.abs(b.vx) > 5 || Math.abs(b.vy) > 5)) {
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + b.vx * 0.15, cy + b.vy * 0.15);
                ctx.stroke();
              }
              ctx.restore();
            }

            // Selection outline in Editor Mode
            if (!isPlaying && selectedEntityId === b.id) {
              ctx.save();
              ctx.translate(cx, cy);
              ctx.rotate((b.rotationZ * Math.PI) / 180);
              ctx.strokeStyle = b.locked ? '#94A3B8' : '#38BDF8';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 4]);
              ctx.strokeRect(-b.width / 2 - 2, -b.height / 2 - 2, b.width + 4, b.height + 4);
              ctx.setLineDash([]);
              if (!b.locked) {
                ctx.fillStyle = '#38BDF8';
                ctx.fillRect(b.width / 2 - 5, b.height / 2 - 5, 10, 10);
              }
              ctx.restore();
            }
          });

          // Projectiles
          projectilesRef.current.forEach((p) => {
            ctx.save();
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });

          // Particles
          particlesRef.current.forEach((pt) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });

          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, project, selectedEntityId, screenW, screenH, virtualKeys, bannerMessage, onRuntimeStats]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const activeCamX = isPlaying ? cameraPosRef.current.x : editorPanRef.current.x;
    const activeCamY = isPlaying ? cameraPosRef.current.y : editorPanRef.current.y;
    const camZoom = isPlaying ? Math.max(0.5, Math.min(2.2, runtimeSceneRef.current.camera?.zoom || 1)) : 1;
    return {
      x: (((e.clientX - rect.left) / rect.width) * screenW) / camZoom + activeCamX,
      y: (((e.clientY - rect.top) / rect.height) * screenH) / camZoom + activeCamY,
    };
  };

  const snapValue = (v: number): number => {
    if (!project.editorSettings?.snapToGrid) return Math.round(v);
    const g = project.editorSettings.gridSize || 40;
    return Math.round(v / g) * g;
  };

  const handleTileAtPoint = (pt: { x: number; y: number }) => {
    if (!onPaintTile) return;
    const tileSize = runtimeSceneRef.current.tilemap?.tileSize || 40;
    const col = Math.floor(pt.x / tileSize);
    const row = Math.floor(pt.y / tileSize);
    if (col < 0 || row < 0) return;
    onPaintTile(col, row, editorTool === 'tile-erase' ? null : activeTileType);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getCanvasPoint(e);

    if (isPlaying) {
      const hit = [...simBodiesRef.current]
        .reverse()
        .find(
          (b) =>
            b.alive &&
            b.visible &&
            b.kind !== 'hud-text' &&
            b.kind !== 'text-box' &&
            pt.x >= b.x &&
            pt.x <= b.x + b.width &&
            pt.y >= b.y &&
            pt.y <= b.y + b.height
        );
      if (hit) {
        const clickRules = runtimeSceneRef.current.rules.filter(
          (rule) => rule.enabled && rule.triggerType === 'on-click' && rule.targetName === hit.name
        );
        if (hit.clickable || clickRules.length > 0) {
          audioEngine.playSound(project.soundBindings.onClick || 'click', project.assets);
          spawnParticleBurst(hit.x + hit.width / 2, hit.y + hit.height / 2, 'sparkle', 8);
          clickRules.forEach((rule) => executeRuleAction(rule, 0.016, false));
          if (clickRules.length === 0) {
            logsRef.current = [`کلیک روی «${hit.name}»`, ...logsRef.current.slice(0, 14)];
          }
        }
      }
      return;
    }

    if (editorTool === 'tile-paint' || editorTool === 'tile-erase') {
      isPaintingTileRef.current = true;
      handleTileAtPoint(pt);
      return;
    }

    const selected = project.entities.find((ent) => ent.id === selectedEntityId);
    if (
      selected &&
      !selected.locked &&
      selected.kind !== 'hud-text' &&
      selected.kind !== 'text-box' &&
      pt.x >= selected.x + selected.width - 14 &&
      pt.x <= selected.x + selected.width + 14 &&
      pt.y >= selected.y + selected.height - 14 &&
      pt.y <= selected.y + selected.height + 14
    ) {
      dragStateRef.current = {
        entityId: selected.id,
        offsetX: pt.x,
        offsetY: pt.y,
        mode: 'resize',
      };
      return;
    }

    const hit = [...project.entities]
      .reverse()
      .find(
        (b) =>
          b.kind !== 'hud-text' &&
          b.kind !== 'text-box' &&
          pt.x >= b.x &&
          pt.x <= b.x + b.width &&
          pt.y >= b.y &&
          pt.y <= b.y + b.height
      );

    if (hit) {
      onSelectEntity(hit.id);
      if (!hit.locked) {
        dragStateRef.current = {
          entityId: hit.id,
          offsetX: pt.x - hit.x,
          offsetY: pt.y - hit.y,
          mode: 'move',
        };
      }
    } else {
      onSelectEntity(null);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = getCanvasPoint(e);
    if (isPlaying) {
      const overClickable = simBodiesRef.current.some(
        (b) =>
          b.alive &&
          b.visible &&
          b.kind !== 'hud-text' &&
          b.kind !== 'text-box' &&
          (b.clickable ||
            runtimeSceneRef.current.rules.some(
              (r) => r.enabled && r.triggerType === 'on-click' && r.targetName === b.name
            )) &&
          pt.x >= b.x &&
          pt.x <= b.x + b.width &&
          pt.y >= b.y &&
          pt.y <= b.y + b.height
      );
      if (overClickable !== hoverClickable) setHoverClickable(overClickable);
      return;
    }

    if ((editorTool === 'tile-paint' || editorTool === 'tile-erase') && isPaintingTileRef.current) {
      handleTileAtPoint(pt);
      return;
    }

    if (!dragStateRef.current) return;
    const { entityId, offsetX, offsetY, mode } = dragStateRef.current;
    const entity = project.entities.find((ent) => ent.id === entityId);
    if (!entity || entity.locked) return;

    const worldW = Math.max(screenW, runtimeSceneRef.current.camera?.worldWidth || screenW);
    const worldH = Math.max(screenH, runtimeSceneRef.current.camera?.worldHeight || screenH);

    if (mode === 'move') {
      const nextX = snapValue(Math.max(0, Math.min(worldW - entity.width, pt.x - offsetX)));
      const nextY = snapValue(Math.max(0, Math.min(worldH - entity.height, pt.y - offsetY)));
      onUpdateEntity(entityId, { x: nextX, y: nextY });
    } else {
      const nextW = Math.max(20, snapValue(pt.x - entity.x));
      const nextH = Math.max(20, snapValue(pt.y - entity.y));
      onUpdateEntity(entityId, { width: nextW, height: nextH });
    }
  };

  const handleCanvasPointerUp = () => {
    dragStateRef.current = null;
    isPaintingTileRef.current = false;
  };

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
    matchedRules.forEach((rule) => executeRuleAction(rule, 0.016, false));
    if (matchedRules.length === 0) {
      logsRef.current = [`کلیک روی لایه «${layer.name}»`, ...logsRef.current.slice(0, 14)];
    }
  };

  return (
    <div
      className="relative w-full h-full select-none overflow-hidden rounded-lg border border-slate-700/80 bg-[#0B0E14]"
      style={{ aspectRatio: `${screenW} / ${screenH}` }}
    >
      {isPlaying &&
        (project.codeFiles || [])
          .filter((cf) => cf.enabledInRuntime && cf.language === 'css')
          .map((cf) => <style key={cf.id}>{cf.content}</style>)}
      <canvas
        ref={canvasRef}
        width={screenW}
        height={screenH}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        className={`w-full h-full block ${
          isPlaying
            ? hoverClickable
              ? 'cursor-pointer'
              : 'cursor-default'
            : editorTool === 'tile-paint' || editorTool === 'tile-erase'
              ? 'cursor-cell'
              : 'cursor-crosshair'
        }`}
      />

      {/* Semantic DOM Overlay for Static HUD Text, Framed Text Boxes, Clickable Cards & Scrollable Text */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {hudOverlayBodies.map((b) => {
          if (!b.visible) return null;
          const cfg = b.textConfig;
          if (!cfg) return null;

          const activeCamX = isPlaying ? cameraPosRef.current.x : editorPanRef.current.x;
          const activeCamY = isPlaying ? cameraPosRef.current.y : editorPanRef.current.y;
          const camZoom = isPlaying
            ? Math.max(0.5, Math.min(2.2, runtimeSceneRef.current.camera?.zoom || 1))
            : 1;
          const posX = cfg.fixedOnScreen ? b.x : (b.x - activeCamX) * camZoom;
          const posY = cfg.fixedOnScreen ? b.y : (b.y - activeCamY) * camZoom;

          const leftPct = (posX / screenW) * 100;
          const topPct = (posY / screenH) * 100;
          const widthPct = ((cfg.fixedOnScreen ? b.width : b.width * camZoom) / screenW) * 100;
          const heightPct = ((cfg.fixedOnScreen ? b.height : b.height * camZoom) / screenH) * 100;
          const isSelected = !isPlaying && selectedEntityId === b.id;
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
                // In Editor Mode, let user drag the vertical or horizontal scrollbar thumb without moving the box
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
                const canvas = canvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const startPtX = ((e.clientX - rect.left) / rect.width) * screenW;
                const startPtY = ((e.clientY - rect.top) / rect.height) * screenH;
                const offsetX = startPtX - b.x;
                const offsetY = startPtY - b.y;
                const onMove = (ev: PointerEvent) => {
                  const ptX = ((ev.clientX - rect.left) / rect.width) * screenW;
                  const ptY = ((ev.clientY - rect.top) / rect.height) * screenH;
                  onUpdateEntity(b.id, {
                    x: Math.round(Math.max(0, Math.min(screenW - b.width, ptX - offsetX))),
                    y: Math.round(Math.max(0, Math.min(screenH - b.height, ptY - offsetY))),
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
                  matchedRules.forEach((rule) => executeRuleAction(rule, 0.016, false));
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
                    executeRuleAction(rule, 0.016, false);
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
                fontSize: `${Math.max(11, Math.round(cfg.fontSize * 0.88))}px`,
                color: cfg.textColor,
                backgroundColor: cfg.boxBgColor,
                borderColor:
                  clickedBoxId === b.id
                    ? '#FBBF24'
                    : isSelected
                      ? '#38BDF8'
                      : cfg.boxBorderColor,
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

      {/* Play Mode Banner Message */}
      {isPlaying && bannerMessage && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 bg-slate-950/95 border border-amber-500/60 rounded-xl px-6 py-4 text-center shadow-2xl">
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

      {/* Full 4-Way D-Pad + Action Touch Controls Overlay */}
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
                بالا
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
                پایین
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
