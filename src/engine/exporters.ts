import JSZip from 'jszip';
import type { RayanProject } from '../types/studio';

function safeSlug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'rayan-game';
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

async function fetchToDataUrl(url: string): Promise<string> {
  if (!url || url.startsWith('data:')) return url;
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || url));
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

async function resolveProjectForOfflineExport(project: RayanProject): Promise<RayanProject> {
  const cloned: RayanProject = JSON.parse(JSON.stringify(project));
  if (cloned.environment.backgroundType === 'image' && cloned.environment.backgroundImageUrl) {
    cloned.environment.backgroundImageUrl = await fetchToDataUrl(cloned.environment.backgroundImageUrl);
  }
  for (const sc of cloned.scenes) {
    if (sc.environment.backgroundType === 'image' && sc.environment.backgroundImageUrl) {
      sc.environment.backgroundImageUrl = await fetchToDataUrl(sc.environment.backgroundImageUrl);
    }
  }
  return cloned;
}

export async function buildStandaloneGameHtml(project: RayanProject): Promise<string> {
  const resolved = await resolveProjectForOfflineExport(project);
  const serialized = JSON.stringify(resolved).replace(/<\//g, '<\\/');
  const w = resolved.screenConfig.width;
  const h = resolved.screenConfig.height;
  const isTouch =
    resolved.screenConfig.showTouchControls ||
    resolved.screenConfig.preset !== 'web';

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${resolved.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-tap-highlight-color: transparent; }
    html, body { width: 100%; height: 100%; background: #07090e; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    #stage { position: relative; width: 100vw; height: 100vh; max-width: calc(100vh * ${w} / ${h}); max-height: calc(100vw * ${h} / ${w}); aspect-ratio: ${w} / ${h}; background: #0b0e14; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.65); }
    canvas { width: 100%; height: 100%; display: block; }
    #overlay { position: absolute; inset: 0; pointer-events: none; }
    .hud-box { position: absolute; pointer-events: auto; white-space: pre-wrap; line-height: 1.5; }
    #touch-bar { position: absolute; left: 16px; right: 16px; bottom: 16px; display: ${isTouch ? 'flex' : 'none'}; justify-content: space-between; align-items: flex-end; pointer-events: none; z-index: 20; }
    .dpad { display: grid; grid-template-columns: repeat(3, 42px); gap: 4px; pointer-events: auto; }
    .touch-group { display: flex; gap: 10px; pointer-events: auto; }
    .tbtn { min-width: 42px; height: 42px; padding: 0 10px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.35); background: rgba(15,23,42,0.82); color: #f8fafc; font-weight: 700; font-size: 12px; cursor: pointer; }
    .tbtn.primary { min-width: 58px; height: 50px; background: rgba(245,158,11,0.9); color: #0b0e14; border-color: #fcd34d; }
    #msg-box { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); background: rgba(11,14,20,0.95); border: 1px solid #f59e0b; border-radius: 14px; padding: 20px 28px; text-align: center; display: none; z-index: 30; }
    #msg-box button { margin-top: 12px; padding: 8px 18px; border: none; border-radius: 8px; background: #f59e0b; color: #0b0e14; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <div id="stage">
    <canvas id="game" width="${w}" height="${h}"></canvas>
    <div id="overlay"></div>
    <div id="msg-box"><p id="msg-text" style="font-size:18px;font-weight:700;color:#fbbf24"></p><button onclick="document.getElementById('msg-box').style.display='none'">ادامه</button></div>
    <div id="touch-bar">
      <div class="dpad">
        <div></div><button class="tbtn" data-key="ArrowUp">بالا</button><div></div>
        <button class="tbtn" data-key="ArrowRight">راست</button>
        <button class="tbtn" data-key="ArrowDown">پایین</button>
        <button class="tbtn" data-key="ArrowLeft">چپ</button>
      </div>
      <div class="touch-group">
        <button class="tbtn" data-key="KeyE" style="height:50px">پرتاب</button>
        <button class="tbtn primary" data-key="Space">پرش</button>
      </div>
    </div>
  </div>
  <script>
    const PROJECT = ${serialized};
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const overlay = document.getElementById('overlay');
    const W = PROJECT.screenConfig.width;
    const H = PROJECT.screenConfig.height;
    const is3D = PROJECT.engineMode === '3d';

    const state = {
      score: PROJECT.variables.score || 0,
      health: PROJECT.variables.health || 100,
      custom: Object.assign({}, PROJECT.customVariables || {}),
      elapsed: 0,
      keys: {},
      justPressed: {},
      projectiles: [],
      particles: [],
      triggeredOnce: new Set(),
      timers: new Map(),
      cooldowns: new Map(),
      camX: 0,
      camY: 0,
      shake: 0,
      scene: null,
      bodies: []
    };

    function loadScene(sc) {
      state.scene = sc;
      state.projectiles = [];
      state.particles = [];
      state.triggeredOnce.clear();
      state.timers.clear();
      state.cooldowns.clear();
      state.camX = 0; state.camY = 0;
      state.bodies = sc.entities.map(e => ({
        ...e,
        startX: e.x, startY: e.y, startZ: e.z,
        vx: 0, vy: 0, vz: 0,
        baseRotZ: e.rotationZ || 0,
        alive: true, onGround: false, facing: 1, patrolDir: 1, orbitAngle: 0,
        animTime: Math.random() * 2
      }));
    }

    const initialScene = (PROJECT.scenes && PROJECT.scenes.find(s => s.id === PROJECT.activeSceneId)) || {
      id: 'scene_1', name: 'مرحله ۱',
      environment: PROJECT.environment, camera: PROJECT.camera || { worldWidth: W, worldHeight: H, zoom: 1, smoothing: 0.14, followTargetName: '' },
      tilemap: PROJECT.tilemap || { tileSize: 40, tiles: {} },
      entities: PROJECT.entities, rules: PROJECT.rules
    };
    loadScene(initialScene);

    const imgCache = new Map();
    [PROJECT.environment.backgroundImageUrl, ...(PROJECT.scenes || []).map(s => s.environment.backgroundImageUrl)].forEach(u => {
      if (u && !imgCache.has(u)) { const bg = new Image(); bg.src = u; imgCache.set(u, bg); }
    });
    PROJECT.assets.forEach(a => {
      if (a.kind === 'image' && a.dataUrl) { const im = new Image(); im.src = a.dataUrl; imgCache.set(a.id, im); }
    });

    function spawnParticles(x, y, preset, count) {
      const palettes = {
        explosion: ['#EF4444','#F97316','#FACC15'],
        sparkle: ['#FBBF24','#38BDF8','#34D399'],
        smoke: ['#94A3B8','#64748B'],
        snow: ['#F8FAFC','#E0F2FE'],
        rain: ['#38BDF8','#60A5FA']
      };
      const cols = palettes[preset] || palettes.sparkle;
      for (let i = 0; i < (count || 18); i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 80 + Math.random() * 190;
        const life = 0.45 + Math.random() * 0.4;
        state.particles.push({ x, y, vx: Math.cos(ang)*sp, vy: Math.sin(ang)*sp, size: 3 + Math.random()*4, color: cols[i%cols.length], life, maxLife: life });
      }
    }

    let audioCtx = null;
    function playSfx(name) {
      try {
        const custom = PROJECT.assets.find(a => a.kind === 'audio' && (a.id === name || a.name === name));
        if (custom && custom.dataUrl) { new Audio(custom.dataUrl).play().catch(()=>{}); return; }
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        if (name === 'jump') { osc.type = 'triangle'; osc.frequency.setValueAtTime(220, now); osc.frequency.exponentialRampToValueAtTime(560, now + 0.16); }
        else if (name === 'coin') { osc.type = 'sine'; osc.frequency.setValueAtTime(880, now); osc.frequency.setValueAtTime(1180, now + 0.07); }
        else if (name === 'hit') { osc.type = 'square'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.2); }
        else { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(540, now); osc.frequency.exponentialRampToValueAtTime(160, now + 0.14); }
        gain.gain.setValueAtTime(0.18, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now); osc.stop(now + 0.21);
      } catch {}
    }

    const overlayEls = new Map();
    function renderOverlay() {
      const sc = state.scene;
      const lvl = (PROJECT.scenes || []).findIndex(s => s.id === sc.id) + 1 || 1;
      const camZoom = Math.max(0.5, Math.min(2.2, (sc.camera && sc.camera.zoom) || 1));
      const hudBodies = state.bodies.filter(b => b.visible && (b.kind === 'hud-text' || b.kind === 'text-box'));
      const activeIds = new Set(hudBodies.map(b => b.id));
      overlayEls.forEach((el, id) => {
        if (!activeIds.has(id)) { el.remove(); overlayEls.delete(id); }
      });
      hudBodies.forEach(b => {
        const cfg = b.textConfig; if (!cfg) return;
        let div = overlayEls.get(b.id);
        const hasClickRule = sc.rules.some(r => r.enabled && r.triggerType === 'on-click' && r.targetName === b.name);
        const isClickable = Boolean(cfg.clickable || b.clickable || hasClickRule);
        if (!div) {
          div = document.createElement('div');
          div.className = 'hud-box';
          div.style.fontSize = Math.max(11, Math.round(cfg.fontSize * 0.88)) + 'px';
          div.style.color = cfg.textColor;
          div.style.background = cfg.boxBgColor;
          div.style.border = cfg.boxBorderWidth + 'px solid ' + cfg.boxBorderColor;
          div.style.borderRadius = cfg.boxBorderRadius + 'px';
          div.style.padding = cfg.boxPadding + 'px';
          div.style.textAlign = cfg.align;
          div.style.overflowY = cfg.scrollable ? 'auto' : 'hidden';
          div.style.overscrollBehavior = cfg.scrollable ? 'contain' : 'auto';
          if (b.rotationZ) div.style.transform = 'rotate(' + b.rotationZ + 'deg)';
          if (cfg.scrollable) {
            let lastSc = 0;
            div.addEventListener('wheel', ev => ev.stopPropagation(), { passive: true });
            div.addEventListener('scroll', () => {
              const tNow = performance.now();
              if (tNow - lastSc < 220) return;
              lastSc = tNow;
              sc.rules.filter(r => r.enabled && r.triggerType === 'on-scroll' && r.targetName === b.name).forEach(r => runRule(r, 0.016));
            });
          }
          if (isClickable) {
            div.style.cursor = 'pointer';
            div.addEventListener('click', ev => {
              ev.stopPropagation();
              playSfx('click');
              sc.rules.filter(r => r.enabled && r.triggerType === 'on-click' && r.targetName === b.name).forEach(r => runRule(r, 0.016));
            });
          }
          overlay.appendChild(div);
          overlayEls.set(b.id, div);
        }
        const px = cfg.fixedOnScreen ? b.x : (b.x - state.camX) * camZoom;
        const py = cfg.fixedOnScreen ? b.y : (b.y - state.camY) * camZoom;
        const pw = cfg.fixedOnScreen ? b.width : b.width * camZoom;
        const ph = cfg.fixedOnScreen ? b.height : b.height * camZoom;
        div.style.left = (px / W * 100) + '%';
        div.style.top = (py / H * 100) + '%';
        div.style.width = (pw / W * 100) + '%';
        div.style.height = (ph / H * 100) + '%';
        let txt = cfg.text.replace(/\\{score\\}/g, state.score).replace(/\\{health\\}/g, state.health).replace(/\\{time\\}/g, Math.floor(state.elapsed)).replace(/\\{level\\}/g, lvl);
        Object.keys(state.custom).forEach(k => { txt = txt.split('{' + k + '}').join(String(state.custom[k])); });
        if (div.textContent !== txt) div.textContent = txt;
      });
    }

    canvas.addEventListener('pointerdown', ev => {
      if (is3D) return;
      const rect = canvas.getBoundingClientRect();
      const camZoom = Math.max(0.5, Math.min(2.2, (state.scene.camera && state.scene.camera.zoom) || 1));
      const cx = (((ev.clientX - rect.left) / rect.width) * W) / camZoom + state.camX;
      const cy = (((ev.clientY - rect.top) / rect.height) * H) / camZoom + state.camY;
      const hit = [...state.bodies].reverse().find(b => b.alive && b.visible && b.kind !== 'hud-text' && b.kind !== 'text-box' && cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height);
      if (hit) {
        const rules = state.scene.rules.filter(r => r.enabled && r.triggerType === 'on-click' && r.targetName === hit.name);
        if (hit.clickable || rules.length) {
          playSfx('click');
          spawnParticles(hit.x + hit.width/2, hit.y + hit.height/2, 'sparkle', 8);
          rules.forEach(r => runRule(r, 0.016));
        }
      }
    });

    window.addEventListener('keydown', e => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
      if (!state.keys[e.code]) state.justPressed[e.code] = true;
      state.keys[e.code] = true;
    });
    window.addEventListener('keyup', e => { state.keys[e.code] = false; });

    document.querySelectorAll('.tbtn').forEach(btn => {
      const k = btn.getAttribute('data-key');
      btn.addEventListener('pointerdown', () => { state.justPressed[k] = true; state.keys[k] = true; });
      btn.addEventListener('pointerup', () => { state.keys[k] = false; });
      btn.addEventListener('pointerleave', () => { state.keys[k] = false; });
    });

    function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    function runRule(rule, dt) {
      const target = state.bodies.find(b => b.alive && b.name === rule.targetName);
      const sec = rule.secondaryName ? state.bodies.find(b => b.alive && b.name === rule.secondaryName) : null;
      const scale3d = is3D ? 0.03 : 1;
      const worldW = Math.max(W, (state.scene.camera && state.scene.camera.worldWidth) || W);
      switch (rule.actionType) {
        case 'move-right': if (target) { target.vx = (rule.paramNumber || 240) * scale3d; target.facing = 1; } break;
        case 'move-left': if (target) { target.vx = -(rule.paramNumber || 240) * scale3d; target.facing = -1; } break;
        case 'move-up': case 'move-forward': if (target) { if (is3D) target.vz = -(rule.paramNumber || 7); else target.vy = -(rule.paramNumber || 240); } break;
        case 'move-down': case 'move-backward': if (target) { if (is3D) target.vz = (rule.paramNumber || 7); else target.vy = (rule.paramNumber || 240); } break;
        case 'jump': if (target && target.onGround) { target.vy = is3D ? (rule.paramNumber || 10) : -(rule.paramNumber || 540); target.onGround = false; playSfx('jump'); } break;
        case 'throw-projectile': if (target) {
          const sp = (rule.paramNumber || 560) * scale3d;
          const ang = (rule.paramAngle || 25) * Math.PI / 180;
          state.projectiles.push({ x: target.x + (is3D ? 0 : target.width/2), y: target.y + (is3D ? 0.8 : target.height*0.4), z: target.z || 0, vx: Math.cos(ang)*sp*target.facing, vy: (is3D ? 1 : -1)*Math.sin(ang)*sp, vz: 0, life: 3.5 });
          playSfx('throw');
        } break;
        case 'patrol-horizontal': if (target) { target.vx = (rule.paramNumber || 110) * scale3d * target.patrolDir; if (target.x < (is3D ? -10 : 20)) target.patrolDir = 1; if (target.x > (is3D ? 10 : worldW - 70)) target.patrolDir = -1; } break;
        case 'chase-target': if (target && sec) {
          const sp = (rule.paramNumber || 95) * scale3d;
          const dx = sec.x - target.x; const dz = is3D ? (sec.z - target.z) : (sec.y - target.y);
          const d = Math.hypot(dx, dz) || 1;
          target.vx = (dx / d) * sp;
          if (is3D) target.vz = (dz / d) * sp;
        } break;
        case 'add-score': state.score += (rule.paramNumber || 10); break;
        case 'add-health': state.health = Math.max(0, state.health + (rule.paramNumber || -10)); break;
        case 'set-var': if (rule.varName) state.custom[rule.varName] = rule.paramNumber || 0; break;
        case 'add-var': if (rule.varName) state.custom[rule.varName] = (state.custom[rule.varName] || 0) + (rule.paramNumber || 1); break;
        case 'spawn-entity': {
          const tpl = state.scene.entities.find(e => e.name === rule.targetName) || state.scene.entities[0];
          if (tpl) state.bodies.push({ ...tpl, id: tpl.id + '_' + Date.now(), x: state.camX + Math.random() * (W - 60), y: 60, vx: 0, vy: 0, alive: true, visible: true, onGround: false, facing: 1, patrolDir: 1, animTime: 0, startX: tpl.x, startY: tpl.y });
          break;
        }
        case 'spawn-particles': if (target) spawnParticles(target.x + (target.width||20)/2, target.y + (target.height||20)/2, rule.paramText || 'sparkle', 18); break;
        case 'camera-shake': state.shake = Math.max(state.shake, rule.paramNumber || 10); break;
        case 'go-to-scene': {
          const next = (PROJECT.scenes || []).find(s => s.name === rule.paramText);
          if (next) loadScene(next);
          break;
        }
        case 'next-scene': {
          const scenes = PROJECT.scenes || [];
          const idx = scenes.findIndex(s => s.id === state.scene.id);
          if (idx >= 0 && scenes[idx + 1]) loadScene(scenes[idx + 1]);
          else { document.getElementById('msg-text').textContent = 'تبریک! تمام مراحل کامل شد!'; document.getElementById('msg-box').style.display = 'block'; }
          break;
        }
        case 'save-progress': try { localStorage.setItem('rayan_save_' + PROJECT.id, JSON.stringify({ score: state.score, health: state.health, custom: state.custom, sceneId: state.scene.id })); } catch {} break;
        case 'load-progress': try { const sv = JSON.parse(localStorage.getItem('rayan_save_' + PROJECT.id) || 'null'); if (sv) { state.score = sv.score; state.health = sv.health; state.custom = Object.assign({}, state.custom, sv.custom || {}); } } catch {} break;
        case 'destroy-other': if (sec) { sec.alive = false; sec.visible = false; spawnParticles(sec.x + 15, sec.y + 15, 'sparkle', 12); } break;
        case 'destroy-self': if (target) { target.alive = false; target.visible = false; spawnParticles(target.x + 15, target.y + 15, 'explosion', 12); } break;
        case 'respawn': if (target) { target.x = target.startX; target.y = target.startY; target.vx = 0; target.vy = 0; } break;
        case 'play-sound': playSfx(rule.paramText || 'coin'); break;
        case 'show-message': document.getElementById('msg-text').textContent = rule.paramText || ''; document.getElementById('msg-box').style.display = 'block'; break;
        case 'set-text': if (target && target.textConfig) { target.textConfig.text = rule.paramText || ''; } break;
        case 'scroll-box': { const el = target ? overlayEls.get(target.id) : null; if (el) el.scrollTop += (rule.paramNumber || 60); break; }
      }
    }

    let last = performance.now();
    function loop(now) {
      const dt = Math.min((now - last) / 1000, 0.04); last = now;
      state.elapsed += dt;
      const sc = state.scene;
      const worldW = Math.max(W, (sc.camera && sc.camera.worldWidth) || W);
      const worldH = Math.max(H, (sc.camera && sc.camera.worldHeight) || H);
      const camZoom = Math.max(0.5, Math.min(2.2, (sc.camera && sc.camera.zoom) || 1));

      state.bodies.forEach(b => {
        b.animTime += dt;
        if (b.animation && b.animation.preset === 'spin') b.rotationZ = ((b.rotationZ || 0) + (b.animation.speed || 2)*45*dt) % 360;
        if (b.alive && !b.physics.isStatic) { b.vx *= 0.85; if (is3D) b.vz *= 0.85; }
      });

      sc.rules.forEach(r => {
        if (!r.enabled) return;
        if (r.triggerType === 'on-start' && !state.triggeredOnce.has(r.id)) { state.triggeredOnce.add(r.id); runRule(r, dt); }
        else if (r.triggerType === 'every-seconds') {
          const acc = (state.timers.get(r.id) || 0) + dt; const iv = r.intervalSeconds || 2;
          if (acc >= iv) { state.timers.set(r.id, acc - iv); runRule(r, dt); } else state.timers.set(r.id, acc);
        }
        else if (r.triggerType === 'always') runRule(r, dt);
        else if (r.triggerType === 'key-hold' && state.keys[r.key]) runRule(r, dt);
        else if (r.triggerType === 'key-press' && state.justPressed[r.key]) runRule(r, dt);
        else if (r.triggerType === 'var-condition') {
          const val = r.varName === 'health' ? state.health : (r.varName === 'score' || !r.varName) ? state.score : (state.custom[r.varName] || 0);
          const met = r.operator === '<=' ? val <= r.varValue : r.operator === '==' ? val === r.varValue : val >= r.varValue;
          if (met && !state.triggeredOnce.has(r.id)) { state.triggeredOnce.add(r.id); runRule(r, dt); }
        }
      });
      state.justPressed = {};

      const grav = sc.environment.gravity || (is3D ? 24 : 980);
      const solids = state.bodies.filter(b => b.alive && b.physics.enabled && b.physics.isStatic && b.role === 'platform');
      const tileSize = (sc.tilemap && sc.tilemap.tileSize) || 40;
      const tileEntries = Object.entries((sc.tilemap && sc.tilemap.tiles) || {});

      state.bodies.forEach(b => {
        if (!b.alive || !b.physics.enabled || b.physics.isStatic || b.kind === 'hud-text' || b.kind === 'text-box') return;
        if (is3D) {
          if (b.physics.useGravity) b.vy -= grav * dt;
          b.x = Math.max(-24, Math.min(24, b.x + b.vx * dt));
          b.z = Math.max(-24, Math.min(24, b.z + b.vz * dt));
          b.y += b.vy * dt;
          if (b.y <= 0) { b.y = 0; b.vy = 0; b.onGround = true; }
        } else {
          if (b.physics.useGravity) b.vy += grav * dt;
          b.x = Math.max(0, Math.min(worldW - b.width, b.x + b.vx * dt));
          const prevBottom = b.y + b.height;
          b.y += b.vy * dt; b.onGround = false;
          solids.forEach(s => {
            if (overlap(b.x, b.y, b.width, b.height, s.x, s.y, s.width, s.height)) {
              if (b.vy > 0) { b.y = s.y - b.height; b.vy = 0; b.onGround = true; }
              else if (b.vy < 0) { b.y = s.y + s.height; b.vy = 0; }
            }
          });
          tileEntries.forEach(([k, tType]) => {
            const [cs, rs] = k.split(','); const tx = Number(cs)*tileSize; const ty = Number(rs)*tileSize;
            if (!overlap(b.x, b.y, b.width, b.height, tx, ty, tileSize, tileSize)) return;
            if (tType === 'ground' || tType === 'stone') {
              if (b.vy > 0) { b.y = ty - b.height; b.vy = 0; b.onGround = true; }
            } else if (tType === 'platform' && b.vy >= 0 && prevBottom <= ty + 10) {
              b.y = ty - b.height; b.vy = 0; b.onGround = true;
            } else if (tType === 'bounce' && b.role === 'player') {
              b.vy = -700; b.onGround = false; playSfx('jump');
            } else if (tType === 'hazard' && b.role === 'player') {
              if (now - (state.cooldowns.get('haz') || 0) > 750) {
                state.cooldowns.set('haz', now);
                const hrs = sc.rules.filter(r => r.enabled && r.triggerType === 'on-tile-hazard');
                if (hrs.length) hrs.forEach(r => runRule(r, dt));
                else { state.health = Math.max(0, state.health - 20); b.vy = -320; playSfx('hit'); }
              }
            } else if (tType === 'finish' && b.role === 'player' && !state.triggeredOnce.has('fin_' + sc.id)) {
              state.triggeredOnce.add('fin_' + sc.id);
              const frs = sc.rules.filter(r => r.enabled && r.triggerType === 'on-tile-finish');
              if (frs.length) frs.forEach(r => runRule(r, dt));
            }
          });
          if (b.y + b.height >= worldH) { b.y = worldH - b.height; b.vy = 0; b.onGround = true; }
        }
      });

      state.projectiles = state.projectiles.filter(p => {
        p.vy += (is3D ? -grav * 0.5 : grav * 0.55) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        return p.life > 0;
      });
      state.particles = state.particles.filter(pt => { pt.x += pt.vx*dt; pt.y += pt.vy*dt; pt.life -= dt; return pt.life > 0; });

      sc.rules.forEach(r => {
        if (!r.enabled || r.triggerType !== 'on-collision') return;
        const b1 = state.bodies.find(b => b.alive && b.name === r.targetName);
        const b2 = state.bodies.find(b => b.alive && b.name === r.secondaryName);
        if (b1 && b2 && overlap(b1.x, b1.y, b1.width, b1.height, b2.x, b2.y, b2.width, b2.height)) {
          const k = r.id + '_' + b1.id;
          if (now - (state.cooldowns.get(k) || 0) > 600) { state.cooldowns.set(k, now); runRule(r, dt); }
        }
      });

      const follow = sc.camera && sc.camera.followTargetName ? state.bodies.find(b => b.alive && b.name === sc.camera.followTargetName) : null;
      if (follow && !is3D) {
        const vw = W / camZoom; const vh = H / camZoom;
        const tx = Math.max(0, Math.min(worldW - vw, follow.x + follow.width/2 - vw/2));
        const ty = Math.max(0, Math.min(worldH - vh, follow.y + follow.height/2 - vh/2));
        state.camX += (tx - state.camX) * ((sc.camera && sc.camera.smoothing) || 0.14);
        state.camY += (ty - state.camY) * ((sc.camera && sc.camera.smoothing) || 0.14);
      }
      state.shake *= Math.pow(0.05, dt); if (state.shake < 0.2) state.shake = 0;

      ctx.clearRect(0, 0, W, H);
      const bgImg = sc.environment.backgroundImageUrl ? imgCache.get(sc.environment.backgroundImageUrl) : null;
      if (sc.environment.backgroundType === 'image' && bgImg && bgImg.complete) {
        ctx.drawImage(bgImg, 0, 0, W, H);
      } else if (sc.environment.backgroundType === 'gradient') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, sc.environment.backgroundColor || '#0f172a');
        g.addColorStop(1, '#1e293b');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else {
        ctx.fillStyle = sc.environment.backgroundColor || '#0b0e14';
        ctx.fillRect(0, 0, W, H);
      }

      ctx.save();
      if (!is3D) {
        if (camZoom !== 1) ctx.scale(camZoom, camZoom);
        ctx.translate(-state.camX + (Math.random()-0.5)*state.shake, -state.camY + (Math.random()-0.5)*state.shake);
        tileEntries.forEach(([k, tType]) => {
          const [cs, rs] = k.split(','); const px = Number(cs)*tileSize; const py = Number(rs)*tileSize;
          ctx.fillStyle = tType === 'ground' ? '#22c55e' : tType === 'stone' ? '#475569' : tType === 'hazard' ? '#ef4444' : tType === 'bounce' ? '#38bdf8' : tType === 'finish' ? '#10b981' : '#94a3b8';
          ctx.fillRect(px, py, tileSize, tileSize);
        });
      }

      if (is3D) {
        const sorted = [...state.bodies].filter(b => b.alive && b.visible && b.kind !== 'hud-text' && b.kind !== 'text-box').sort((a,b) => a.z - b.z);
        sorted.forEach(b => {
          const sx = W/2 + b.x * 28; const sy = H*0.62 + b.z * 16 - b.y * 28;
          ctx.fillStyle = b.color; ctx.fillRect(sx - 20, sy - 38, 40, 38);
        });
      } else {
        state.bodies.forEach(b => {
          if (!b.alive || !b.visible || b.kind === 'hud-text' || b.kind === 'text-box') return;
          const fy = b.animation && b.animation.preset === 'float' ? Math.sin(b.animTime*(b.animation.speed||3))*(b.animation.amplitude||8) : 0;
          ctx.save();
          ctx.translate(b.x + b.width / 2, b.y + b.height / 2 + fy);
          ctx.rotate(((b.rotationZ || 0) * Math.PI) / 180);
          const spr = b.assetId ? imgCache.get(b.assetId) : null;
          if (spr && spr.complete) {
            const cols = Math.max(1, (b.animation && b.animation.spriteCols) || 1);
            const rows = Math.max(1, (b.animation && b.animation.spriteRows) || 1);
            if (cols > 1 || rows > 1) {
              const f = Math.floor(b.animTime * ((b.animation && b.animation.fps) || 8)) % (cols * rows);
              const sw = spr.naturalWidth / cols; const sh = spr.naturalHeight / rows;
              ctx.drawImage(spr, (f%cols)*sw, Math.floor(f/cols)*sh, sw, sh, -b.width/2, -b.height/2, b.width, b.height);
            } else ctx.drawImage(spr, -b.width / 2, -b.height / 2, b.width, b.height);
          } else {
            ctx.fillStyle = b.color;
            ctx.beginPath();
            ctx.roundRect(-b.width / 2, -b.height / 2, b.width, b.height, b.shape2d === 'circle' ? b.width/2 : 8);
            ctx.fill();
          }
          ctx.restore();
        });
        state.projectiles.forEach(p => { ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI*2); ctx.fill(); });
        state.particles.forEach(pt => { ctx.globalAlpha = Math.max(0, pt.life/pt.maxLife); ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI*2); ctx.fill(); });
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      renderOverlay();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;
}

export async function exportWebSingleHtml(project: RayanProject) {
  const html = await buildStandaloneGameHtml(project);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, `${safeSlug(project.name)}.html`);
}

export async function exportWebPwaZip(project: RayanProject) {
  const slug = safeSlug(project.name);
  const html = await buildStandaloneGameHtml(project);
  const zip = new JSZip();

  zip.file('index.html', html);
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        id: '/',
        name: project.name,
        short_name: project.name.slice(0, 12),
        description: project.description,
        start_url: './index.html',
        display: 'standalone',
        background_color: '#0B0E14',
        theme_color: '#0B0E14',
        icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      null,
      2
    )
  );
  zip.file(
    'sw.js',
    `const CACHE = '${slug}-v1';
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './manifest.json']))));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));`
  );
  zip.file(
    'icon.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0B0E14"/><path d="M168 152L364 256L168 360V152Z" fill="#F59E0B"/></svg>`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${slug}-web-pwa.zip`);
}

export async function exportAndroidProjectZip(project: RayanProject) {
  const slug = safeSlug(project.name);
  const appId = `ir.rayanstudio.${slug.replace(/[^a-z0-9]/g, '') || 'game'}`;
  const html = await buildStandaloneGameHtml(project);
  const zip = new JSZip();

  zip.folder('www')?.file('index.html', html);
  zip.file(
    'package.json',
    JSON.stringify(
      {
        name: slug,
        version: '1.0.0',
        description: project.description,
        scripts: {
          'android:init': 'npx cap add android',
          'android:sync': 'npx cap sync android',
          'android:open': 'npx cap open android',
        },
        dependencies: {
          '@capacitor/core': '^6.0.0',
          '@capacitor/android': '^6.0.0',
        },
        devDependencies: {
          '@capacitor/cli': '^6.0.0',
        },
      },
      null,
      2
    )
  );
  zip.file(
    'capacitor.config.json',
    JSON.stringify(
      {
        appId,
        appName: project.name,
        webDir: 'www',
        bundledWebRuntime: false,
        android: {
          allowMixedContent: true,
        },
      },
      null,
      2
    )
  );
  zip.file(
    'build-apk.sh',
    `#!/usr/bin/env bash
set -e
npm install
npx cap add android || true
npx cap sync android
cd android
./gradlew assembleRelease
./gradlew bundleRelease
echo "APK: android/app/build/outputs/apk/release/"
echo "AAB (Google Play / Bazaar / Myket): android/app/build/outputs/bundle/release/"
`
  );
  zip.file(
    'STORE-RELEASE-GUIDE.md',
    `# راهنمای انتشار اندروید (${project.name})

1. پیش‌نیازها: Node.js و Android Studio / JDK 17.
2. در پوشه پروژه دستور \`npm install\` و سپس \`npx cap add android && npx cap sync android\` را اجرا کنید.
3. برای تست روی گوشی: \`npx cap open android\` و دکمه Run را بزنید.
4. برای انتشار در کافه‌بازار، مایکت یا گوگل‌پلی:
   - در Android Studio منوی **Build -> Generate Signed Bundle / APK** را انتخاب کنید.
   - فایل \`app-release.aab\` یا \`app-release.apk\` خروجی کاملاً آفلاین و آماده انتشار است.
`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${slug}-android-store.zip`);
}

export async function exportWindowsProjectZip(project: RayanProject) {
  const slug = safeSlug(project.name);
  const html = await buildStandaloneGameHtml(project);
  const zip = new JSZip();

  zip.folder('app')?.file('index.html', html);
  zip.file(
    'main.js',
    `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: ${project.screenConfig.width},
    height: ${project.screenConfig.height},
    title: ${JSON.stringify(project.name)},
    autoHideMenuBar: true,
    backgroundColor: '#0B0E14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`
  );
  zip.file(
    'package.json',
    JSON.stringify(
      {
        name: slug,
        version: '1.0.0',
        main: 'main.js',
        description: project.description,
        scripts: {
          start: 'electron .',
          'build:win': 'electron-builder --win nsis portable',
        },
        devDependencies: {
          electron: '^33.0.0',
          'electron-builder': '^25.1.8',
        },
        build: {
          appId: `ir.rayanstudio.${slug}`,
          productName: project.name,
          win: {
            target: ['nsis', 'portable'],
          },
        },
      },
      null,
      2
    )
  );
  zip.file(
    'build-windows.bat',
    `@echo off
npm install
npm run build:win
echo Built Windows EXE in dist\\
pause
`
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${slug}-windows-desktop.zip`);
}

export function exportRayanProjectFile(project: RayanProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerDownload(blob, `${safeSlug(project.name)}.rayan.json`);
}
