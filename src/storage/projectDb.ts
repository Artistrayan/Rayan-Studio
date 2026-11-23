import type { CodeFileItem, GameScene, RayanProject, TileType } from '../types/studio';
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
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
    codeFiles: Array.isArray(raw.codeFiles) ? raw.codeFiles : createDefaultCodeFiles(raw.name),
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
  return new Promise((resolve, reject) => {
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
}

export async function saveProjectToDb(project: RayanProject): Promise<RayanProject> {
  const updated: RayanProject = normalizeProject({
    ...project,
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
