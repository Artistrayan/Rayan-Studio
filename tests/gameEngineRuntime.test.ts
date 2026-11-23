import { describe, it, expect } from 'vitest';
import {
  getDefaultCollisionConfig,
  getSpritesheetFrameCoords,
  pickModel3DAnimationClip,
  studio3dNodesToGameEntities,
} from '../src/engine/gameRuntimeHelpers';
import { createStarter2DProject, normalizeProject } from '../src/storage/projectDb';
import type { SceneNode3D } from '../src/types/studio';

describe('General Playable Game Runtime Helpers', () => {
  it('converts grouped Studio3D layout nodes into playable entities with world coordinates and clips', () => {
    const nodes: SceneNode3D[] = [
      {
        id: 'grp_1',
        name: 'گروه قهرمان',
        kind: 'group',
        position: [4, 0, -2],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#ffffff',
        visible: true,
        locked: false,
        layerId: 'default',
      },
      {
        id: 'n_player',
        name: 'ربات بازیکن',
        kind: 'model-asset',
        assetId: 'asset_hero_glb',
        parentId: 'grp_1',
        position: [1.5, 0.5, 3],
        rotation: [0, 90, 0],
        scale: [1, 1.2, 1],
        color: '#38bdf8',
        visible: true,
        locked: false,
        layerId: 'characters',
        animations: ['Idle', 'WalkForward', 'JumpAir'],
      },
      {
        id: 'n_plat',
        name: 'سکوی فلزی',
        kind: 'primitive',
        primitiveType: 'box',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [6, 0.5, 6],
        color: '#475569',
        visible: true,
        locked: false,
        layerId: 'environment',
      },
      {
        id: 'n_gem',
        name: 'کریستال الماس',
        kind: 'model-preset',
        preset: 'crystal-gem',
        position: [2, 1, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: '#fbbf24',
        visible: true,
        locked: false,
        layerId: 'items',
      },
    ];

    const entities = studio3dNodesToGameEntities(nodes);
    expect(entities.length).toBe(3);

    const player = entities.find((e) => e.id === 's3d_n_player')!;
    expect(player.role).toBe('player');
    expect(player.kind).toBe('model3d-asset');
    expect(player.x).toBe(5.5);
    expect(player.y).toBe(0.5);
    expect(player.z).toBe(1);
    expect(player.physics.useGravity).toBe(true);
    expect(player.animation?.idleClip).toBe('Idle');
    expect(player.animation?.walkClip).toBe('WalkForward');
    expect(player.animation?.jumpClip).toBe('JumpAir');

    const platform = entities.find((e) => e.id === 's3d_n_plat')!;
    expect(platform.role).toBe('platform');
    expect(platform.physics.isStatic).toBe(true);
    expect(platform.collisionConfig?.response).toBe('solid');

    const gem = entities.find((e) => e.id === 's3d_n_gem')!;
    expect(gem.role).toBe('collectible');
    expect(gem.behavior?.mode).toBe('collectible-bob');
    expect(gem.collisionConfig?.onCollideAction).toBe('collect');
  });

  it('selects spritesheet rows cleanly per movement state', () => {
    const anim = {
      preset: 'none' as const,
      speed: 1,
      amplitude: 0,
      spriteCols: 4,
      spriteRows: 3,
      fps: 8,
      idleRow: 0,
      walkRow: 1,
      jumpRow: 2,
    };

    expect(getSpritesheetFrameCoords(anim, 'idle', 0.5, true).row).toBe(0);
    expect(getSpritesheetFrameCoords(anim, 'walk', 0.5, true).row).toBe(1);
    expect(getSpritesheetFrameCoords(anim, 'jump', 0.5, true).row).toBe(2);
    expect(getSpritesheetFrameCoords(anim, 'walk', 0.5, false)).toEqual({
      col: 0,
      row: 0,
      cols: 4,
      rows: 3,
    });
  });

  it('picks explicit or heuristic 3D AnimationClip names', () => {
    const clips = ['StandPose', 'Hero_Run_Loop', 'SuperJump', 'SwordSlash'];
    expect(pickModel3DAnimationClip(undefined, clips, 'walk')).toBe('Hero_Run_Loop');
    expect(pickModel3DAnimationClip(undefined, clips, 'jump')).toBe('SuperJump');
    expect(
      pickModel3DAnimationClip(
        {
          preset: 'none',
          speed: 1,
          amplitude: 0,
          spriteCols: 1,
          spriteRows: 1,
          fps: 8,
          walkClip: 'SwordSlash',
        },
        clips,
        'walk'
      )
    ).toBe('SwordSlash');
  });

  it('provides sensible default collision policies per role', () => {
    expect(getDefaultCollisionConfig('collectible')).toMatchObject({
      response: 'trigger',
      onCollideAction: 'collect',
    });
    expect(getDefaultCollisionConfig('enemy')).toMatchObject({
      response: 'trigger',
      onCollideAction: 'damage',
    });
    expect(getDefaultCollisionConfig('platform')).toMatchObject({
      response: 'solid',
    });
  });

  it('preserves multi-scene data, uiPages, and uiCollections during normalizeProject', () => {
    const starter = createStarter2DProject('تست چندصحنه‌ای');
    starter.uiPages = [
      {
        id: 'p_1',
        name: 'خانه',
        isHome: true,
        layoutMode: 'free',
        gap: 8,
        gridCols: 2,
        bgColor: '#0f172a',
        elements: [],
      },
    ];
    starter.activeUiPageId = 'p_1';
    starter.uiCollections = [{ id: 'c_1', name: 'امتیازها', fields: ['player', 'score'] }];

    const normalized = normalizeProject(starter);
    expect(normalized.scenes.length).toBeGreaterThanOrEqual(2);
    expect(normalized.uiPages?.length).toBe(1);
    expect(normalized.activeUiPageId).toBe('p_1');
    expect(normalized.uiCollections?.[0].name).toBe('امتیازها');
  });
});
