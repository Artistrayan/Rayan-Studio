/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Shared General Game Runtime Helpers (2D, 3D, Behaviors, Animations & Scene Sync)
 */

import type {
  EntityAnimationConfig,
  EntityCollisionConfig,
  GameEntity,
  Model3DPresetType,
  SceneNode3D,
} from '../types/studio';

export function getDefaultCollisionConfig(role: GameEntity['role']): EntityCollisionConfig {
  switch (role) {
    case 'platform':
      return { response: 'solid', filterRole: 'any', onCollideAction: 'none' };
    case 'collectible':
      return {
        response: 'trigger',
        filterRole: 'player',
        onCollideAction: 'collect',
        actionAmount: 10,
        sound: 'coin',
      };
    case 'enemy':
      return {
        response: 'trigger',
        filterRole: 'player',
        onCollideAction: 'damage',
        actionAmount: 15,
        sound: 'hit',
      };
    default:
      return { response: 'solid', filterRole: 'any', onCollideAction: 'none' };
  }
}

export function getSpritesheetFrameCoords(
  anim: EntityAnimationConfig | undefined,
  state: 'idle' | 'walk' | 'jump' | 'action',
  animTime: number,
  isPlaying: boolean
): { col: number; row: number; cols: number; rows: number } {
  const cols = Math.max(1, anim?.spriteCols || 1);
  const rows = Math.max(1, anim?.spriteRows || 1);
  const fps = Math.max(1, anim?.fps || 8);

  if (!isPlaying) {
    return { col: 0, row: Math.min(rows - 1, Math.max(0, anim?.idleRow ?? 0)), cols, rows };
  }

  // If explicit state rows are configured or rows > 1 with row hints
  const hasStateRows =
    anim?.idleRow !== undefined ||
    anim?.walkRow !== undefined ||
    anim?.jumpRow !== undefined ||
    anim?.actionRow !== undefined;

  if (hasStateRows) {
    let targetRow = anim?.idleRow ?? 0;
    if (state === 'jump' && anim?.jumpRow !== undefined) targetRow = anim.jumpRow;
    else if (state === 'walk' && anim?.walkRow !== undefined) targetRow = anim.walkRow;
    else if (state === 'action' && anim?.actionRow !== undefined) targetRow = anim.actionRow;
    const clampedRow = Math.min(rows - 1, Math.max(0, targetRow));
    const col = Math.floor(animTime * fps) % cols;
    return { col, row: clampedRow, cols, rows };
  }

  // Legacy flat-sheet iteration across all frames
  const totalFrames = cols * rows;
  const frameIdx = Math.floor(animTime * fps) % totalFrames;
  return {
    col: frameIdx % cols,
    row: Math.floor(frameIdx / cols),
    cols,
    rows,
  };
}

export function pickModel3DAnimationClip(
  anim: EntityAnimationConfig | undefined,
  availableClips: string[],
  state: 'idle' | 'walk' | 'jump' | 'action'
): string | null {
  if (!availableClips || availableClips.length === 0) return null;

  const findExact = (name?: string) =>
    name && availableClips.includes(name) ? name : null;

  if (state === 'jump') {
    const explicit = findExact(anim?.jumpClip);
    if (explicit) return explicit;
    const auto = availableClips.find((n) => /jump|hop|leap|air/i.test(n));
    if (auto) return auto;
  }
  if (state === 'action') {
    const explicit = findExact(anim?.actionClip);
    if (explicit) return explicit;
    const auto = availableClips.find((n) => /attack|action|hit|kick|shoot/i.test(n));
    if (auto) return auto;
  }
  if (state === 'walk') {
    const explicit = findExact(anim?.walkClip);
    if (explicit) return explicit;
    const auto = availableClips.find((n) => /walk|run|move|stride/i.test(n));
    if (auto) return auto;
    return availableClips[0];
  }

  const explicitIdle = findExact(anim?.idleClip);
  if (explicitIdle) return explicitIdle;
  const autoIdle = availableClips.find((n) => /idle|stand|breath|wait/i.test(n));
  return autoIdle || null;
}

/**
 * Converts multi-model 3D Studio Layout (`SceneNode3D[]`) into playable `GameEntity[]`
 * with resolved parent-group offsets, physics colliders, and behavior/collision defaults.
 */
export function studio3dNodesToGameEntities(nodes: SceneNode3D[]): GameEntity[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const resolveWorldPosition = (node: SceneNode3D): [number, number, number] => {
    let x = node.position[0] || 0;
    let y = node.position[1] || 0;
    let z = node.position[2] || 0;
    let curParentId = node.parentId;
    const visited = new Set<string>([node.id]);
    while (curParentId && !visited.has(curParentId)) {
      visited.add(curParentId);
      const p = byId.get(curParentId);
      if (!p) break;
      x += p.position[0] || 0;
      y += p.position[1] || 0;
      z += p.position[2] || 0;
      curParentId = p.parentId;
    }
    return [Number(x.toFixed(2)), Number(y.toFixed(2)), Number(z.toFixed(2))];
  };

  const inferRole = (node: SceneNode3D): GameEntity['role'] => {
    const lower = node.name.toLowerCase();
    if (/بازیکن|قهرمان|ربات|player|hero/.test(lower) || node.preset === 'hero-bot') {
      return 'player';
    }
    if (/دشمن|نگهبان|برجک|enemy|turret|boss/.test(lower) || node.preset === 'turret') {
      return 'enemy';
    }
    if (/سکه|الماس|کریستال|جایزه|gem|coin|collectible/.test(lower) || node.preset === 'crystal-gem') {
      return 'collectible';
    }
    if (
      /سکو|زمین|دیوار|پله|platform|floor|wall|ground/.test(lower) ||
      node.preset === 'platform-block' ||
      node.preset === 'crate' ||
      (node.kind === 'primitive' && (node.scale[0] >= 2.5 || node.primitiveType === 'plane'))
    ) {
      return 'platform';
    }
    return 'prop';
  };

  const presetFallback = (node: SceneNode3D): Model3DPresetType => {
    if (node.preset) return node.preset;
    if (node.primitiveType === 'plane' || (node.scale[0] >= 2.5 && node.scale[1] <= 1)) {
      return 'platform-block';
    }
    return 'crate';
  };

  const out: GameEntity[] = [];
  for (const node of nodes) {
    if (node.kind === 'light' || node.kind === 'group') continue;
    const role = inferRole(node);
    const [wx, wy, wz] = resolveWorldPosition(node);
    const isDynamic = role === 'player' || role === 'enemy';
    const isStatic = role === 'platform' || role === 'prop' || role === 'collectible';

    out.push({
      id: `s3d_${node.id}`,
      name: node.name,
      role,
      kind: node.kind === 'model-asset' && node.assetId ? 'model3d-asset' : 'model3d-preset',
      model3dPreset: node.kind === 'model-asset' ? undefined : presetFallback(node),
      assetId: node.kind === 'model-asset' ? node.assetId : undefined,
      x: wx,
      y: Math.max(0, wy),
      z: wz,
      width: Number(Math.max(0.4, (node.scale[0] || 1) * 1.4).toFixed(2)),
      height: Number(Math.max(0.4, (node.scale[1] || 1) * 1.4).toFixed(2)),
      depth: Number(Math.max(0.4, (node.scale[2] || 1) * 1.4).toFixed(2)),
      rotationX: node.rotation[0] || 0,
      rotationY: node.rotation[1] || 0,
      rotationZ: node.rotation[2] || 0,
      color: node.color || '#38BDF8',
      opacity: 1,
      visible: node.visible,
      locked: node.locked,
      physics: {
        enabled: true,
        isStatic,
        useGravity: isDynamic,
        mass: role === 'enemy' ? 2 : 1,
        bounce: role === 'player' ? 0.1 : 0,
        friction: 0.85,
        collider: role === 'collectible' ? 'sphere' : 'box',
      },
      animation:
        role === 'collectible'
          ? { preset: 'float', speed: 2.5, amplitude: 4, spriteCols: 1, spriteRows: 1, fps: 8 }
          : node.animations && node.animations.length > 0
            ? {
                preset: 'none',
                speed: 1,
                amplitude: 0,
                spriteCols: 1,
                spriteRows: 1,
                fps: 8,
                idleClip: pickModel3DAnimationClip(undefined, node.animations, 'idle') || node.animations[0],
                walkClip: pickModel3DAnimationClip(undefined, node.animations, 'walk') || node.animations[0],
                jumpClip: pickModel3DAnimationClip(undefined, node.animations, 'jump') || undefined,
              }
            : undefined,
      behavior:
        role === 'enemy'
          ? { mode: 'patrol', speed: 2.4, range: 6 }
          : role === 'collectible'
            ? { mode: 'collectible-bob', amount: 15 }
            : undefined,
      collisionConfig: getDefaultCollisionConfig(role),
    });
  }
  return out;
}
