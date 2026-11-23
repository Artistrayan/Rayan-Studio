import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Bug,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Gamepad,
  Grid,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  Move,
  Paintbrush,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Scaling,
  Smartphone,
  Square,
  Tablet,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AnimationPreset,
  BoxChildLayer,
  BoxLayerKind,
  EngineMode,
  EntityKind,
  EntityRole,
  GameEntity,
  GameScene,
  Model3DPresetType,
  RayanAsset,
  RayanProject,
  ScreenPreset,
  Shape2DType,
  TileType,
} from '../types/studio';
import { Engine2D, type RuntimeStatsPayload } from '../engine/Engine2D';
import { Engine3D } from '../engine/Engine3D';
import { audioEngine } from '../engine/audioEngine';
import { parsePersianRules } from '../engine/ruleParser';
import { ColorPickerField } from './ColorPickerField';

interface SceneEditorWorkspaceProps {
  project: RayanProject;
  isPlaying: boolean;
  onTogglePlay: (playing: boolean) => void;
  onUpdateProject: (updater: (prev: RayanProject) => RayanProject) => void;
  onSaveProject: () => void;
  savingState: 'idle' | 'saving' | 'saved';
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

const SCREEN_PRESETS: Array<{
  id: ScreenPreset;
  label: string;
  w: number;
  h: number;
  touch: boolean;
}> = [
  { id: 'web', label: 'وب دسکتاپ', w: 1280, h: 720, touch: false },
  { id: 'phone-portrait', label: 'گوشی عمودی', w: 390, h: 844, touch: true },
  { id: 'phone-landscape', label: 'گوشی افقی', w: 844, h: 390, touch: true },
  { id: 'tablet', label: 'تبلت', w: 768, h: 1024, touch: true },
];

const TILE_PALETTE: Array<{ id: TileType; label: string; color: string }> = [
  { id: 'ground', label: 'زمین چمن', color: '#22C55E' },
  { id: 'stone', label: 'دیوار سنگی', color: '#475569' },
  { id: 'platform', label: 'سکو یک‌طرفه', color: '#94A3B8' },
  { id: 'hazard', label: 'تله / گدازه', color: '#EF4444' },
  { id: 'bounce', label: 'پد پرش', color: '#38BDF8' },
  { id: 'finish', label: 'پرچم پایان', color: '#10B981' },
];

interface NumericInputProps {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (val: number) => void;
  className?: string;
}

const NumericInput: React.FC<NumericInputProps> = ({
  value,
  step = 1,
  min,
  max,
  onChange,
  className = '',
}) => {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  React.useEffect(() => {
    if (!focused) {
      setDraft(String(value));
    }
  }, [value, focused]);

  const commit = (raw: string) => {
    const normalized = raw.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/٫/g, '.');
    const parsed = Number(normalized);
    if (normalized.trim() !== '' && !Number.isNaN(parsed) && Number.isFinite(parsed)) {
      let clamped = parsed;
      if (min !== undefined) clamped = Math.max(min, clamped);
      if (max !== undefined) clamped = Math.min(max, clamped);
      onChange(clamped);
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      dir="ltr"
      value={focused ? draft : String(value)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (next !== '' && next !== '-' && next !== '.' && next !== '-.') {
          commit(next);
        }
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
        setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const next = Number((value + step).toFixed(2));
          onChange(max !== undefined ? Math.min(max, next) : next);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = Number((value - step).toFixed(2));
          onChange(min !== undefined ? Math.max(min, next) : next);
        } else if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className={className}
    />
  );
};

export const SceneEditorWorkspace: React.FC<SceneEditorWorkspaceProps> = ({
  project,
  isPlaying,
  onTogglePlay,
  onUpdateProject,
  onSaveProject,
  savingState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(
    project.entities[0]?.id || null
  );
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [editorTool, setEditorTool] = useState<'select' | 'tile-paint' | 'tile-erase'>('select');
  const [activeTileType, setActiveTileType] = useState<TileType>('ground');
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [muted, setMuted] = useState(audioEngine.isMuted());
  const [newVarName, setNewVarName] = useState('');
  const [newVarVal, setNewVarVal] = useState(0);

  const [runtimeStats, setRuntimeStats] = useState<RuntimeStatsPayload>({
    score: project.variables.score,
    health: project.variables.health,
    customVariables: project.customVariables || {},
    elapsedSeconds: 0,
    fps: 60,
    activeEntities: project.entities.length,
    particleCount: 0,
    sceneName: project.scenes.find((s) => s.id === project.activeSceneId)?.name || 'مرحله ۱',
    message: null,
    logs: [],
  });

  const quickFileRef = useRef<HTMLInputElement | null>(null);
  const selectedEntity = project.entities.find((e) => e.id === selectedEntityId) || null;
  const activeScene = project.scenes.find((s) => s.id === project.activeSceneId) || project.scenes[0];

  const updateEntity = (id: string, patch: Partial<GameEntity>) => {
    onUpdateProject((prev) => ({
      ...prev,
      entities: prev.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      updatedAt: Date.now(),
    }));
  };

  const removeEntity = (id: string) => {
    onUpdateProject((prev) => ({
      ...prev,
      entities: prev.entities.filter((e) => e.id !== id),
      updatedAt: Date.now(),
    }));
    if (selectedEntityId === id) {
      setSelectedEntityId(null);
    }
  };

  const duplicateEntity = (ent: GameEntity) => {
    const newId = `ent_${Date.now()}_copy`;
    const copy: GameEntity = {
      ...JSON.parse(JSON.stringify(ent)),
      id: newId,
      name: `${ent.name} کپی`,
      x: ent.x + (project.engineMode === '3d' ? 1.5 : 28),
      y: ent.y + (project.engineMode === '3d' ? 0 : 28),
      locked: false,
    };
    onUpdateProject((prev) => ({
      ...prev,
      entities: [...prev.entities, copy],
      updatedAt: Date.now(),
    }));
    setSelectedEntityId(newId);
  };

  const moveEntityLayer = (id: string, dir: -1 | 1) => {
    onUpdateProject((prev) => {
      const idx = prev.entities.findIndex((e) => e.id === id);
      const targetIdx = idx + dir;
      if (idx === -1 || targetIdx < 0 || targetIdx >= prev.entities.length) return prev;
      const next = [...prev.entities];
      const [item] = next.splice(idx, 1);
      next.splice(targetIdx, 0, item);
      return { ...prev, entities: next, updatedAt: Date.now() };
    });
  };

  const switchActiveScene = (sceneId: string) => {
    const target = project.scenes.find((s) => s.id === sceneId);
    if (!target || target.id === project.activeSceneId) return;
    onUpdateProject((prev) => ({
      ...prev,
      activeSceneId: target.id,
      environment: target.environment,
      camera: target.camera,
      tilemap: target.tilemap,
      entities: target.entities,
      rulesText: target.rulesText,
      rules: target.rules,
      updatedAt: Date.now(),
    }));
    setSelectedEntityId(target.entities[0]?.id || null);
  };

  const addNewScene = () => {
    const num = project.scenes.length + 1;
    const newId = `scene_${Date.now()}`;
    const baseEntities: GameEntity[] = activeScene.entities
      .filter((e) => e.role === 'player' || e.role === 'platform' || e.role === 'hud-text')
      .map((e, i) => ({
        ...JSON.parse(JSON.stringify(e)),
        id: `ent_${Date.now()}_${i}`,
      }));
    const defaultRulesText =
      project.engineMode === '3d'
        ? 'کلید راست: بازیکن حرکت راست سرعت 7\nکلید چپ: بازیکن حرکت چپ سرعت 7\nکلید فاصله: بازیکن پرش قدرت 10'
        : 'کلید راست: بازیکن حرکت راست سرعت 270\nکلید چپ: بازیکن حرکت چپ سرعت 270\nکلید فاصله: بازیکن پرش قدرت 550\nرسیدن بازیکن به پایان: افکت جرقه | مرحله بعد';
    const newScene: GameScene = {
      id: newId,
      name: `مرحله ${num}`,
      environment: { ...activeScene.environment },
      camera: { ...activeScene.camera },
      tilemap: { tileSize: activeScene.tilemap?.tileSize || 40, tiles: {} },
      entities: baseEntities,
      rulesText: defaultRulesText,
      rules: parsePersianRules(defaultRulesText, baseEntities).rules,
    };
    onUpdateProject((prev) => ({
      ...prev,
      scenes: [...prev.scenes, newScene],
      activeSceneId: newId,
      environment: newScene.environment,
      camera: newScene.camera,
      tilemap: newScene.tilemap,
      entities: newScene.entities,
      rulesText: newScene.rulesText,
      rules: newScene.rules,
      updatedAt: Date.now(),
    }));
    setSelectedEntityId(baseEntities[0]?.id || null);
  };

  const deleteActiveScene = () => {
    if (project.scenes.length <= 1) return;
    const remaining = project.scenes.filter((s) => s.id !== project.activeSceneId);
    const next = remaining[0];
    onUpdateProject((prev) => ({
      ...prev,
      scenes: remaining,
      activeSceneId: next.id,
      environment: next.environment,
      camera: next.camera,
      tilemap: next.tilemap,
      entities: next.entities,
      rulesText: next.rulesText,
      rules: next.rules,
      updatedAt: Date.now(),
    }));
    setSelectedEntityId(next.entities[0]?.id || null);
  };

  const handlePaintTile = (col: number, row: number, tile: TileType | null) => {
    const key = `${col},${row}`;
    onUpdateProject((prev) => {
      const nextTiles = { ...(prev.tilemap?.tiles || {}) };
      if (tile === null) {
        if (!(key in nextTiles)) return prev;
        delete nextTiles[key];
      } else {
        if (nextTiles[key] === tile) return prev;
        nextTiles[key] = tile;
      }
      return {
        ...prev,
        tilemap: {
          tileSize: prev.tilemap?.tileSize || 40,
          tiles: nextTiles,
        },
        updatedAt: Date.now(),
      };
    });
  };

  const addQuickEntity = (opts: {
    name: string;
    role: EntityRole;
    kind: EntityKind;
    shape2d?: Shape2DType;
    model3dPreset?: Model3DPresetType;
    color: string;
    isStatic?: boolean;
    useGravity?: boolean;
    text?: string;
    scrollable?: boolean;
    clickable?: boolean;
  }) => {
    const is3D = project.engineMode === '3d';
    const count = project.entities.length + 1;
    const id = `ent_${Date.now()}_${count}`;
    const isUi = opts.kind === 'hud-text' || opts.kind === 'text-box';

    const newEnt: GameEntity = {
      id,
      name: `${opts.name} ${count}`,
      role: opts.role,
      kind: opts.kind,
      shape2d: opts.shape2d,
      model3dPreset: opts.model3dPreset,
      x: isUi ? 32 : is3D ? (Math.random() - 0.5) * 6 : Math.round(project.screenConfig.width * 0.42),
      y: isUi ? 80 : is3D ? 0.4 : Math.round(project.screenConfig.height * 0.4),
      z: is3D && !isUi ? (Math.random() - 0.5) * 6 : 0,
      width: isUi ? 240 : is3D ? 1.4 : opts.role === 'platform' ? 180 : 48,
      height: isUi ? (opts.scrollable ? 130 : 46) : is3D ? 1.4 : opts.role === 'platform' ? 28 : 48,
      depth: is3D ? 1.4 : 40,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: opts.color,
      opacity: 1,
      visible: true,
      clickable: Boolean(opts.clickable),
      physics: {
        enabled: !isUi,
        isStatic: opts.isStatic ?? opts.role === 'platform',
        useGravity: opts.useGravity ?? (!isUi && opts.role !== 'platform' && opts.role !== 'collectible'),
        mass: 1,
        bounce: opts.role === 'collectible' ? 0 : 0.15,
        friction: 0.85,
        collider: isUi ? 'none' : 'box',
      },
      textConfig: isUi
        ? {
            text: opts.text || 'متن جدید',
            fontSize: opts.kind === 'hud-text' ? 18 : 14,
            textColor: '#F8FAFC',
            boxBgColor: opts.clickable && !opts.scrollable ? '#F59E0B' : 'rgba(15, 23, 42, 0.85)',
            boxBorderColor: opts.clickable && !opts.scrollable ? '#FCD34D' : '#475569',
            boxBorderWidth: 1,
            boxBorderRadius: 10,
            boxPadding: 10,
            scrollable: Boolean(opts.scrollable),
            fixedOnScreen: true,
            clickable: Boolean(opts.clickable),
            align: opts.clickable && !opts.scrollable ? 'center' : 'right',
          }
        : undefined,
    };

    if (opts.clickable && !opts.scrollable && opts.kind === 'text-box' && newEnt.textConfig) {
      newEnt.textConfig.textColor = '#0B0E14';
    }

    onUpdateProject((prev) => {
      const nextEntities = [...prev.entities, newEnt];
      let nextRulesText = prev.rulesText;
      if (opts.clickable && !opts.scrollable) {
        const playerName =
          prev.entities.find((e) => e.role === 'player')?.name || 'بازیکن';
        const jumpPower = prev.engineMode === '3d' ? 10 : 540;
        const clickRule = `کلیک روی ${newEnt.name}: ${playerName} پرش قدرت ${jumpPower} | افکت جرقه | صدا click`;
        nextRulesText = nextRulesText.trim() ? `${nextRulesText.trim()}\n${clickRule}` : clickRule;
      }
      return {
        ...prev,
        entities: nextEntities,
        rulesText: nextRulesText,
        rules: parsePersianRules(nextRulesText, nextEntities).rules,
        updatedAt: Date.now(),
      };
    });
    setEditorTool('select');
    setSelectedEntityId(id);
  };

  const addMultiLayerTemplate = (
    templateId: 'horizontal-shop' | 'dialog-panel' | 'mission-list' | 'hud-bar' | 'scroll-x'
  ) => {
    const count = project.entities.length + 1;
    const now = Date.now();
    const id = `ent_${now}_${count}`;
    let newEnt: GameEntity;
    const autoRules: string[] = [];

    if (templateId === 'scroll-x') {
      newEnt = {
        id,
        name: `اسکرول افقی ${count}`,
        role: 'text-box',
        kind: 'text-box',
        x: 36,
        y: 88,
        z: 0,
        width: 300,
        height: 76,
        depth: 10,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        color: '#E2E8F0',
        opacity: 1,
        visible: true,
        clickable: false,
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
          text: 'نوار اسکرول افقی رایان  ✦  مورد اول: سکه طلایی  ✦  مورد دوم: شمشیر جادویی  ✦  مورد سوم: سپر الماس  ✦  مورد چهارم: اکسیر سرعت  ✦  برای مشاهده بقیه آیتم‌ها به چپ و راست بکشید',
          fontSize: 14,
          textColor: '#F8FAFC',
          boxBgColor: 'rgba(15, 23, 42, 0.88)',
          boxBorderColor: '#38BDF8',
          boxBorderWidth: 1,
          boxBorderRadius: 10,
          boxPadding: 12,
          scrollable: false,
          scrollableX: true,
          fixedOnScreen: true,
          clickable: false,
          align: 'right',
        },
      };
    } else if (templateId === 'horizontal-shop') {
      const btn1 = `خرید سپر ${count}`;
      const btn2 = `خرید سرعت ${count}`;
      const btn3 = `خرید جان ${count}`;
      const children: BoxChildLayer[] = [
        {
          id: `lyr_${now}_1`,
          name: `کارت سپر`,
          kind: 'card',
          text: 'سپر محافظ\nهزینه: ۱۰ امتیاز',
          color: '#F8FAFC',
          bgColor: 'rgba(30, 41, 59, 0.9)',
          borderColor: '#38BDF8',
          width: 145,
          visible: true,
        },
        {
          id: `lyr_${now}_2`,
          name: btn1,
          kind: 'button',
          text: 'خرید سپر (+۱ موج)',
          color: '#0B0E14',
          bgColor: '#38BDF8',
          borderColor: '#7DD3FC',
          clickable: true,
          visible: true,
        },
        {
          id: `lyr_${now}_3`,
          name: `کارت سرعت`,
          kind: 'card',
          text: 'اکسیر سرعت\nافزایش امتیاز +۲۰',
          color: '#F8FAFC',
          bgColor: 'rgba(30, 41, 59, 0.9)',
          borderColor: '#F59E0B',
          width: 145,
          visible: true,
        },
        {
          id: `lyr_${now}_4`,
          name: btn2,
          kind: 'button',
          text: 'دریافت جایزه',
          color: '#0B0E14',
          bgColor: '#F59E0B',
          borderColor: '#FCD34D',
          clickable: true,
          visible: true,
        },
        {
          id: `lyr_${now}_5`,
          name: btn3,
          kind: 'button',
          text: 'افزایش جان (+۲۵)',
          color: '#0B0E14',
          bgColor: '#10B981',
          borderColor: '#6EE7B7',
          clickable: true,
          visible: true,
        },
      ];
      autoRules.push(
        `کلیک روی ${btn1}: امتیاز +10 | افکت جرقه | صدا coin`,
        `کلیک روی ${btn2}: امتیاز +20 | افکت جرقه | صدا coin`,
        `کلیک روی ${btn3}: جان +25 | افکت جرقه | صدا coin`
      );
      newEnt = {
        id,
        name: `فروشگاه افقی ${count}`,
        role: 'text-box',
        kind: 'text-box',
        x: 32,
        y: 86,
        z: 0,
        width: 360,
        height: 112,
        depth: 10,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        color: '#F8FAFC',
        opacity: 1,
        visible: true,
        clickable: false,
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
          text: '',
          fontSize: 13,
          textColor: '#F8FAFC',
          boxBgColor: 'rgba(11, 14, 20, 0.9)',
          boxBorderColor: '#475569',
          boxBorderWidth: 1,
          boxBorderRadius: 12,
          boxPadding: 10,
          scrollable: false,
          scrollableX: true,
          fixedOnScreen: true,
          clickable: false,
          align: 'right',
          layoutDirection: 'horizontal',
          childGap: 10,
          children,
        },
      };
    } else if (templateId === 'dialog-panel') {
      const btnName = `دکمه ادامه ${count}`;
      const children: BoxChildLayer[] = [
        {
          id: `lyr_${now}_1`,
          name: 'نشان گفتگو',
          kind: 'badge',
          text: 'پیام راهنما · مرحله {level}',
          color: '#0B0E14',
          bgColor: '#FBBF24',
          borderColor: '#FDE68A',
          fontSize: 11,
          visible: true,
        },
        {
          id: `lyr_${now}_2`,
          name: 'متن داستان',
          kind: 'text',
          text: 'سلام قهرمان! سکه‌ها را جمع کن و از تله‌ها عبور کن تا به پرچم پایان برسی.',
          color: '#E2E8F0',
          bgColor: 'rgba(15, 23, 42, 0.5)',
          borderColor: '#334155',
          visible: true,
        },
        {
          id: `lyr_${now}_3`,
          name: 'خط جداکننده',
          kind: 'divider',
          text: '',
          color: '#334155',
          bgColor: 'transparent',
          borderColor: '#334155',
          visible: true,
        },
        {
          id: `lyr_${now}_4`,
          name: btnName,
          kind: 'button',
          text: 'تایید و دریافت +۱۰ امتیاز',
          color: '#0B0E14',
          bgColor: '#10B981',
          borderColor: '#6EE7B7',
          clickable: true,
          visible: true,
        },
      ];
      autoRules.push(`کلیک روی ${btnName}: امتیاز +10 | افکت جرقه | صدا coin`);
      newEnt = {
        id,
        name: `پنل گفتگو ${count}`,
        role: 'text-box',
        kind: 'text-box',
        x: 34,
        y: 84,
        z: 0,
        width: 310,
        height: 196,
        depth: 10,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        color: '#F8FAFC',
        opacity: 1,
        visible: true,
        clickable: false,
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
          text: '',
          fontSize: 13,
          textColor: '#F8FAFC',
          boxBgColor: 'rgba(15, 23, 42, 0.92)',
          boxBorderColor: '#F59E0B',
          boxBorderWidth: 1,
          boxBorderRadius: 12,
          boxPadding: 12,
          scrollable: true,
          scrollableX: false,
          fixedOnScreen: true,
          clickable: false,
          align: 'right',
          layoutDirection: 'vertical',
          childGap: 8,
          children,
        },
      };
    } else if (templateId === 'mission-list') {
      const saveBtn = `دکمه ذخیره ${count}`;
      const children: BoxChildLayer[] = [
        {
          id: `lyr_${now}_1`,
          name: 'نشان ماموریت',
          kind: 'badge',
          text: 'ماموریت‌های مرحله {level}',
          color: '#E0F2FE',
          bgColor: 'rgba(14, 165, 233, 0.25)',
          borderColor: '#38BDF8',
          fontSize: 12,
          visible: true,
        },
        {
          id: `lyr_${now}_2`,
          name: 'ماموریت اول',
          kind: 'card',
          text: '۱. جمع‌آوری امتیاز فعلی: {score}\n۲. حفظ سلامت بازیکن: {health}',
          color: '#E2E8F0',
          bgColor: 'rgba(30, 41, 59, 0.85)',
          borderColor: '#475569',
          visible: true,
        },
        {
          id: `lyr_${now}_3`,
          name: 'ماموریت دوم',
          kind: 'card',
          text: '۳. زمان سپری‌شده: {time} ثانیه\n۴. رسیدن به پرچم پایان مرحله',
          color: '#CBD5E1',
          bgColor: 'rgba(30, 41, 59, 0.65)',
          borderColor: '#334155',
          visible: true,
        },
        {
          id: `lyr_${now}_4`,
          name: saveBtn,
          kind: 'button',
          text: 'ذخیره پیشرفت بازی',
          color: '#0B0E14',
          bgColor: '#F59E0B',
          borderColor: '#FCD34D',
          clickable: true,
          visible: true,
        },
      ];
      autoRules.push(`کلیک روی ${saveBtn}: ذخیره پیشرفت | نمایش پیام "پیشرفت ذخیره شد!" | صدا click`);
      newEnt = {
        id,
        name: `لیست ماموریت ${count}`,
        role: 'text-box',
        kind: 'text-box',
        x: 920,
        y: 155,
        z: 0,
        width: 300,
        height: 220,
        depth: 10,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        color: '#F8FAFC',
        opacity: 1,
        visible: true,
        clickable: false,
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
          text: '',
          fontSize: 13,
          textColor: '#F8FAFC',
          boxBgColor: 'rgba(11, 14, 20, 0.9)',
          boxBorderColor: '#38BDF8',
          boxBorderWidth: 1,
          boxBorderRadius: 12,
          boxPadding: 10,
          scrollable: true,
          scrollableX: false,
          fixedOnScreen: true,
          clickable: false,
          align: 'right',
          layoutDirection: 'vertical',
          childGap: 8,
          children,
        },
      };
    } else {
      const helpBtn = `دکمه راهنما ${count}`;
      const children: BoxChildLayer[] = [
        {
          id: `lyr_${now}_1`,
          name: 'نشان امتیاز',
          kind: 'badge',
          text: 'امتیاز: {score}',
          color: '#0B0E14',
          bgColor: '#FBBF24',
          borderColor: '#FDE68A',
          visible: true,
        },
        {
          id: `lyr_${now}_2`,
          name: 'نشان جان',
          kind: 'badge',
          text: 'جان: {health}',
          color: '#FFFFFF',
          bgColor: '#EF4444',
          borderColor: '#FCA5A5',
          visible: true,
        },
        {
          id: `lyr_${now}_3`,
          name: 'نشان مرحله',
          kind: 'badge',
          text: 'مرحله: {level}',
          color: '#0B0E14',
          bgColor: '#38BDF8',
          borderColor: '#7DD3FC',
          visible: true,
        },
        {
          id: `lyr_${now}_4`,
          name: helpBtn,
          kind: 'button',
          text: 'پیام راهنما',
          color: '#F8FAFC',
          bgColor: '#334155',
          borderColor: '#64748B',
          clickable: true,
          visible: true,
        },
      ];
      autoRules.push(`کلیک روی ${helpBtn}: نمایش پیام "با کلیدهای جهت و فاصله حرکت و پرش کنید!" | صدا click`);
      newEnt = {
        id,
        name: `نوار وضعیت ${count}`,
        role: 'text-box',
        kind: 'text-box',
        x: 24,
        y: 78,
        z: 0,
        width: 440,
        height: 60,
        depth: 10,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        color: '#F8FAFC',
        opacity: 1,
        visible: true,
        clickable: false,
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
          text: '',
          fontSize: 13,
          textColor: '#F8FAFC',
          boxBgColor: 'rgba(11, 14, 20, 0.88)',
          boxBorderColor: '#334155',
          boxBorderWidth: 1,
          boxBorderRadius: 12,
          boxPadding: 8,
          scrollable: false,
          scrollableX: true,
          fixedOnScreen: true,
          clickable: false,
          align: 'center',
          layoutDirection: 'horizontal',
          childGap: 8,
          children,
        },
      };
    }

    onUpdateProject((prev) => {
      const nextEntities = [...prev.entities, newEnt];
      let nextRulesText = prev.rulesText;
      if (autoRules.length > 0) {
        nextRulesText = nextRulesText.trim()
          ? `${nextRulesText.trim()}\n${autoRules.join('\n')}`
          : autoRules.join('\n');
      }
      return {
        ...prev,
        entities: nextEntities,
        rulesText: nextRulesText,
        rules: parsePersianRules(nextRulesText, nextEntities).rules,
        updatedAt: Date.now(),
      };
    });
    setEditorTool('select');
    setSelectedEntityId(id);
  };

  const handleQuickUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isImg = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext);
    const is3DModel = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply'].includes(ext);
    if (!isImg && !is3DModel) return;

    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });

    const asset: RayanAsset = {
      id: `asset_${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      kind: isImg ? 'image' : 'model3d',
      format: (ext === 'jpeg' ? 'jpg' : ext) as RayanAsset['format'],
      dataUrl,
      sizeBytes: file.size,
      createdAt: Date.now(),
    };

    const entId = `ent_${Date.now()}_u`;
    const newEnt: GameEntity = {
      id: entId,
      name: asset.name,
      role: 'prop',
      kind: isImg ? 'sprite2d' : 'model3d-asset',
      assetId: asset.id,
      x: project.engineMode === '3d' ? 0 : 240,
      y: project.engineMode === '3d' ? 0 : 240,
      z: 0,
      width: project.engineMode === '3d' ? 1.5 : 84,
      height: project.engineMode === '3d' ? 1.5 : 84,
      depth: 1.5,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
      color: '#F8FAFC',
      opacity: 1,
      visible: true,
      physics: {
        enabled: true,
        isStatic: false,
        useGravity: false,
        mass: 1,
        bounce: 0.1,
        friction: 0.85,
        collider: 'box',
      },
    };

    onUpdateProject((prev) => ({
      ...prev,
      engineMode: is3DModel ? '3d' : prev.engineMode,
      assets: [...prev.assets, asset],
      entities: [...prev.entities, newEnt],
      updatedAt: Date.now(),
    }));
    setSelectedEntityId(entId);
  };

  const applyScreenPreset = (presetId: ScreenPreset) => {
    const found = SCREEN_PRESETS.find((p) => p.id === presetId);
    if (!found) {
      onUpdateProject((prev) => ({
        ...prev,
        screenConfig: { ...prev.screenConfig, preset: 'manual' },
      }));
      return;
    }
    onUpdateProject((prev) => ({
      ...prev,
      screenConfig: {
        preset: found.id,
        width: found.w,
        height: found.h,
        showTouchControls: found.touch,
      },
      updatedAt: Date.now(),
    }));
  };

  const switchEngineMode = (mode: EngineMode) => {
    if (mode === project.engineMode) return;
    setEditorTool('select');
    onUpdateProject((prev) => ({
      ...prev,
      engineMode: mode,
      environment: {
        ...prev.environment,
        gravity: mode === '3d' ? 24 : 980,
      },
      updatedAt: Date.now(),
    }));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Workspace Toolbar */}
      <div className="shrink-0 border-b border-slate-800 bg-[#131822] px-4 py-2 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Engine Mode */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0B0E14] border border-slate-800">
            <button
              type="button"
              disabled={isPlaying}
              onClick={() => switchEngineMode('2d')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                project.engineMode === '2d'
                  ? 'bg-slate-800 text-amber-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              2D
            </button>
            <button
              type="button"
              disabled={isPlaying}
              onClick={() => switchEngineMode('3d')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                project.engineMode === '3d'
                  ? 'bg-slate-800 text-sky-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              3D
            </button>
          </div>

          {/* Undo / Redo */}
          {!isPlaying && (
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0B0E14] border border-slate-800">
              <button
                type="button"
                disabled={!canUndo}
                onClick={onUndo}
                title="واگرد (Ctrl+Z)"
                className="p-1.5 rounded-md text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={onRedo}
                title="ازنو (Ctrl+Y)"
                className="p-1.5 rounded-md text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 2D Tools: Select vs Tilemap Paint / Erase + Grid Snap */}
          {project.engineMode === '2d' && !isPlaying && (
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0B0E14] border border-slate-800">
              <button
                type="button"
                onClick={() => setEditorTool('select')}
                title="ابزار انتخاب و جابجایی"
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                  editorTool === 'select' ? 'bg-slate-800 text-amber-400' : 'text-slate-400'
                }`}
              >
                <MousePointer2 className="w-3.5 h-3.5" />
                انتخاب
              </button>
              <button
                type="button"
                onClick={() => setEditorTool('tile-paint')}
                title="قلم کاشی‌چین نقشه"
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                  editorTool === 'tile-paint' ? 'bg-slate-800 text-emerald-400' : 'text-slate-400'
                }`}
              >
                <Paintbrush className="w-3.5 h-3.5" />
                کاشی‌چین
              </button>
              <button
                type="button"
                onClick={() => setEditorTool('tile-erase')}
                title="پاک‌کن کاشی"
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                  editorTool === 'tile-erase' ? 'bg-slate-800 text-red-400' : 'text-slate-400'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    editorSettings: {
                      ...prev.editorSettings,
                      snapToGrid: !prev.editorSettings.snapToGrid,
                    },
                  }))
                }
                title="چسبیدن به شبکه (Grid Snap)"
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                  project.editorSettings?.snapToGrid ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400'
                }`}
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* 3D Transform Gizmo Selector */}
          {project.engineMode === '3d' && !isPlaying && (
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0B0E14] border border-slate-800">
              <button
                type="button"
                onClick={() => setTransformMode('translate')}
                title="جابجایی با فلش‌های ۳ بعدی"
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                  transformMode === 'translate' ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                <span>انتقال</span>
              </button>
              <button
                type="button"
                onClick={() => setTransformMode('rotate')}
                title="چرخش با حلقه‌های جهت"
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                  transformMode === 'rotate' ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>چرخش</span>
              </button>
              <button
                type="button"
                onClick={() => setTransformMode('scale')}
                title="تغییر اندازه و بزرگنمایی"
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                  transformMode === 'scale' ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Scaling className="w-3.5 h-3.5" />
                <span>اندازه</span>
              </button>
            </div>
          )}

          {/* Screen Size Selector */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#0B0E14] border border-slate-800">
            <button
              type="button"
              onClick={() => applyScreenPreset('web')}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                project.screenConfig.preset === 'web'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              وب
            </button>
            <button
              type="button"
              onClick={() => applyScreenPreset('phone-portrait')}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                project.screenConfig.preset === 'phone-portrait'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              گوشی
            </button>
            <button
              type="button"
              onClick={() => applyScreenPreset('tablet')}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                project.screenConfig.preset === 'tablet'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
              تبلت
            </button>
            <button
              type="button"
              onClick={() => applyScreenPreset('manual')}
              className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                project.screenConfig.preset === 'manual'
                  ? 'bg-slate-800 text-amber-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              دستی
            </button>
          </div>

          {project.screenConfig.preset === 'manual' && (
            <div className="flex items-center gap-1.5 text-xs tabular-nums">
              <NumericInput
                min={240}
                max={2560}
                value={project.screenConfig.width}
                onChange={(w) =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    screenConfig: { ...prev.screenConfig, width: Math.max(240, w) },
                  }))
                }
                className="w-16 px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
              />
              <span className="text-slate-500">×</span>
              <NumericInput
                min={240}
                max={2560}
                value={project.screenConfig.height}
                onChange={(h) =>
                  onUpdateProject((prev) => ({
                    ...prev,
                    screenConfig: { ...prev.screenConfig, height: Math.max(240, h) },
                  }))
                }
                className="w-16 px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
              />
            </div>
          )}
        </div>

        {/* Play / Debug / Save / Audio Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              onUpdateProject((prev) => ({
                ...prev,
                editorSettings: {
                  ...prev.editorSettings,
                  showDebugHitboxes: !prev.editorSettings.showDebugHitboxes,
                },
              }))
            }
            title="نمایش کادرهای برخورد و FPS"
            className={`p-2 rounded-lg border text-xs flex items-center gap-1 ${
              project.editorSettings?.showDebugHitboxes
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-700 bg-[#0B0E14] text-slate-300 hover:text-emerald-300'
            }`}
          >
            <Bug className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              const nextMuted = !muted;
              setMuted(nextMuted);
              audioEngine.setMuted(nextMuted);
            }}
            title={muted ? 'فعال کردن صدا' : 'بی‌صدا'}
            className="p-2 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-300 hover:text-amber-400"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setFullscreenPreview((f) => !f)}
            title="نمایش تمام صفحه صحنه"
            className="p-2 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-300 hover:text-slate-100"
          >
            {fullscreenPreview ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onSaveProject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-xs font-medium text-slate-200 hover:border-slate-500 whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            {savingState === 'saving'
              ? 'در حال ذخیره...'
              : savingState === 'saved'
                ? 'ذخیره شد'
                : 'ذخیره'}
          </button>

          <button
            type="button"
            onClick={() => onTogglePlay(!isPlaying)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
              isPlaying
                ? 'bg-red-500 text-white hover:bg-red-400'
                : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
            }`}
          >
            {isPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? 'توقف پیش‌نمایش' : 'اجرای بازی'}
          </button>
        </div>
      </div>

      {/* Tilemap Palette Bar when Brush/Eraser is Active */}
      {project.engineMode === '2d' && !isPlaying && (editorTool === 'tile-paint' || editorTool === 'tile-erase') && (
        <div className="shrink-0 border-b border-slate-800 bg-[#0F131C] px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400 font-semibold">پالت کاشی‌چین:</span>
            {TILE_PALETTE.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setEditorTool('tile-paint');
                  setActiveTileType(t.id);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors ${
                  editorTool === 'tile-paint' && activeTileType === t.id
                    ? 'border-amber-400 bg-slate-800 text-slate-100'
                    : 'border-slate-800 bg-[#0B0E14] text-slate-300 hover:border-slate-600'
                }`}
              >
                <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              onUpdateProject((prev) => ({
                ...prev,
                tilemap: { ...prev.tilemap, tiles: {} },
              }))
            }
            className="text-xs text-red-400 hover:text-red-300"
          >
            پاک کردن کاشی‌ها
          </button>
        </div>
      )}

      {/* Main 3-Pane Studio Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Right Sidebar (RTL): Scene Hierarchy & Quick Entity Palette */}
        {!fullscreenPreview && (
          <aside className="w-64 shrink-0 border-l border-slate-800 bg-[#131822] flex flex-col min-h-0">
            <div className="p-3 border-b border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">افزودن به صحنه</span>
                <input
                  ref={quickFileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.svg,.glb,.gltf,.obj,.stl,.fbx,.ply"
                  className="hidden"
                  onChange={(e) => {
                    void handleQuickUpload(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => quickFileRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
                >
                  <Upload className="w-3 h-3" />
                  فایل / مدل
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {project.engineMode === '2d' ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'شخصیت',
                          role: 'player',
                          kind: 'shape2d',
                          shape2d: 'rect',
                          color: '#F59E0B',
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-amber-500/60"
                    >
                      <Plus className="w-3 h-3 text-amber-400" />
                      شخصیت
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'سکو',
                          role: 'platform',
                          kind: 'shape2d',
                          shape2d: 'rect',
                          color: '#334155',
                          isStatic: true,
                          useGravity: false,
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-slate-600"
                    >
                      <Plus className="w-3 h-3 text-slate-400" />
                      سکو / دیوار
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'سکه',
                          role: 'collectible',
                          kind: 'shape2d',
                          shape2d: 'star',
                          color: '#FBBF24',
                          isStatic: true,
                          useGravity: false,
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-amber-400/50"
                    >
                      <Plus className="w-3 h-3 text-amber-300" />
                      سکه / جایزه
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'نگهبان',
                          role: 'enemy',
                          kind: 'shape2d',
                          shape2d: 'triangle',
                          color: '#EF4444',
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-red-400/50"
                    >
                      <Plus className="w-3 h-3 text-red-400" />
                      دشمن
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'ربات',
                          role: 'player',
                          kind: 'model3d-preset',
                          model3dPreset: 'hero-bot',
                          color: '#F59E0B',
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-amber-500/60"
                    >
                      <Plus className="w-3 h-3 text-amber-400" />
                      ربات
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'خودرو',
                          role: 'prop',
                          kind: 'model3d-preset',
                          model3dPreset: 'rover-car',
                          color: '#38BDF8',
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-sky-400/50"
                    >
                      <Plus className="w-3 h-3 text-sky-400" />
                      خودرو
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'کریستال',
                          role: 'collectible',
                          kind: 'model3d-preset',
                          model3dPreset: 'crystal-gem',
                          color: '#38BDF8',
                          isStatic: true,
                          useGravity: false,
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-sky-400/50"
                    >
                      <Plus className="w-3 h-3 text-sky-300" />
                      کریستال
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        addQuickEntity({
                          name: 'برجک',
                          role: 'enemy',
                          kind: 'model3d-preset',
                          model3dPreset: 'turret',
                          color: '#EF4444',
                        })
                      }
                      className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-red-400/50"
                    >
                      <Plus className="w-3 h-3 text-red-400" />
                      برجک دشمن
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() =>
                    addQuickEntity({
                      name: 'متن ثابت',
                      role: 'hud-text',
                      kind: 'hud-text',
                      color: '#F8FAFC',
                      text: 'امتیاز: {score}',
                    })
                  }
                  className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-slate-600"
                >
                  <Plus className="w-3 h-3 text-emerald-400" />
                  متن ثابت
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addQuickEntity({
                      name: 'کادر متن',
                      role: 'text-box',
                      kind: 'text-box',
                      color: '#E2E8F0',
                      text: [
                        'راهنمای اسکرول بازی رایان:',
                        '۱. با چرخ ماوس یا کشیدن انگشت داخل این کادر می‌توانید متن را بالا و پایین ببرید.',
                        '۲. برای حرکت بازیکن از کلیدهای جهت یا کلید پرش استفاده کنید.',
                        '۳. سکه‌ها و جوایز امتیاز شما را افزایش می‌دهند.',
                        '۴. با رسیدن به پرچم پایان، وارد مرحله بعدی می‌شوید.',
                        '۵. تمام تنظیمات رنگ، متن، اسکرول و کلیک در خروجی نهایی هم فعال هستند.',
                        '۶. می‌توانید هر متن دلخواه یا داستان مرحله را اینجا بنویسید.',
                      ].join('\n'),
                      scrollable: true,
                      clickable: false,
                    })
                  }
                  className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-slate-600"
                >
                  <Plus className="w-3 h-3 text-emerald-400" />
                  اسکرول عمودی
                </button>
                <button
                  type="button"
                  onClick={() => addMultiLayerTemplate('scroll-x')}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-sky-400/60"
                >
                  <Plus className="w-3 h-3 text-sky-400" />
                  اسکرول افقی
                </button>
                <button
                  type="button"
                  onClick={() =>
                    addQuickEntity({
                      name: 'دکمه پرش',
                      role: 'text-box',
                      kind: 'text-box',
                      color: '#0B0E14',
                      text: 'پرش',
                      scrollable: false,
                      clickable: true,
                    })
                  }
                  className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-xs text-slate-300 hover:border-amber-500/60"
                >
                  <Plus className="w-3 h-3 text-amber-400" />
                  دکمه کلیکی
                </button>
              </div>

              <div className="pt-2 border-t border-slate-800/70 space-y-1.5">
                <div className="text-[11px] font-semibold text-amber-300/90">
                  قالب‌های آماده کادر چندلایه:
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => addMultiLayerTemplate('horizontal-shop')}
                    className="px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-[11px] text-sky-300 hover:border-sky-400/60 text-right truncate"
                  >
                    + فروشگاه افقی
                  </button>
                  <button
                    type="button"
                    onClick={() => addMultiLayerTemplate('dialog-panel')}
                    className="px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-[11px] text-amber-300 hover:border-amber-400/60 text-right truncate"
                  >
                    + پنل گفتگو
                  </button>
                  <button
                    type="button"
                    onClick={() => addMultiLayerTemplate('mission-list')}
                    className="px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-[11px] text-emerald-300 hover:border-emerald-400/60 text-right truncate"
                  >
                    + لیست ماموریت
                  </button>
                  <button
                    type="button"
                    onClick={() => addMultiLayerTemplate('hud-bar')}
                    className="px-2 py-1.5 rounded-md bg-[#0B0E14] border border-slate-800 text-[11px] text-indigo-300 hover:border-indigo-400/60 text-right truncate"
                  >
                    + نوار HUD
                  </button>
                </div>
              </div>
            </div>

            <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span>لایه‌های صحنه</span>
              <span className="tabular-nums">{project.entities.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {project.entities.map((ent, idx) => {
                const isSel = selectedEntityId === ent.id;
                return (
                  <div
                    key={ent.id}
                    onClick={() => setSelectedEntityId(ent.id)}
                    className={`group flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
                      isSel
                        ? 'bg-sky-500/15 text-sky-200 border border-sky-500/40'
                        : 'text-slate-300 hover:bg-slate-800/70 border border-transparent'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{ent.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {ent.kind === 'hud-text'
                          ? 'متن ثابت'
                          : ent.kind === 'text-box'
                            ? 'کادر متن'
                            : ent.role}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveEntityLayer(ent.id, -1);
                        }}
                        title="انتقال به عقب"
                        className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-20"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === project.entities.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveEntityLayer(ent.id, 1);
                        }}
                        title="انتقال به جلو"
                        className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-20"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateEntity(ent);
                        }}
                        title="کپی آبجکت"
                        className="p-1 text-slate-500 hover:text-sky-300"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateEntity(ent.id, { locked: !ent.locked });
                        }}
                        title={ent.locked ? 'باز کردن قفل' : 'قفل موقعیت'}
                        className={`p-1 ${ent.locked ? 'text-amber-400' : 'text-slate-500 hover:text-slate-200'}`}
                      >
                        {ent.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateEntity(ent.id, { visible: !ent.visible });
                        }}
                        className="p-1 text-slate-500 hover:text-slate-200"
                      >
                        {ent.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeEntity(ent.id);
                        }}
                        className="p-1 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* Center Viewport: Multi-Scene Tabs + 2D/3D Game Canvas */}
        <main className="flex-1 bg-[#07090E] p-3 flex flex-col items-center justify-between min-w-0 min-h-0 overflow-hidden gap-2">
          {/* Multi-Scene Switcher Strip */}
          {!isPlaying && (
            <div className="w-full flex items-center justify-between gap-2 px-1 shrink-0 overflow-x-auto">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500 shrink-0">صحنه‌ها / مراحل:</span>
                {project.scenes.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => switchActiveScene(sc.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors border ${
                      sc.id === project.activeSceneId
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                        : 'border-slate-800 bg-[#131822] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sc.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addNewScene}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 bg-[#131822] text-xs text-sky-400 hover:border-sky-500/50 whitespace-nowrap"
                >
                  <Plus className="w-3 h-3" />
                  مرحله جدید
                </button>
              </div>
              {project.scenes.length > 1 && (
                <button
                  type="button"
                  onClick={deleteActiveScene}
                  className="text-[11px] text-red-400 hover:text-red-300 whitespace-nowrap shrink-0"
                >
                  حذف صحنه فعلی
                </button>
              )}
            </div>
          )}

          <div className="w-full flex-1 flex items-center justify-center min-h-0">
            <div
              className="max-w-full max-h-full flex items-center justify-center"
              style={{
                width:
                  project.screenConfig.width >= project.screenConfig.height
                    ? 'min(100%, 1040px)'
                    : 'auto',
                height:
                  project.screenConfig.height > project.screenConfig.width
                    ? 'min(100%, 680px)'
                    : 'auto',
                aspectRatio: `${project.screenConfig.width} / ${project.screenConfig.height}`,
              }}
            >
              {project.engineMode === '3d' ? (
                <Engine3D
                  project={project}
                  isPlaying={isPlaying}
                  selectedEntityId={selectedEntityId}
                  transformMode={transformMode}
                  onSelectEntity={setSelectedEntityId}
                  onUpdateEntity={updateEntity}
                  onRuntimeStats={setRuntimeStats}
                />
              ) : (
                <Engine2D
                  project={project}
                  isPlaying={isPlaying}
                  selectedEntityId={selectedEntityId}
                  editorTool={editorTool}
                  activeTileType={activeTileType}
                  onPaintTile={handlePaintTile}
                  onSelectEntity={setSelectedEntityId}
                  onUpdateEntity={updateEntity}
                  onRuntimeStats={setRuntimeStats}
                />
              )}
            </div>
          </div>

          {/* Quiet status line below canvas */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400 tabular-nums shrink-0">
            {isPlaying ? (
              <>
                <span className="text-amber-400 font-semibold">{runtimeStats.sceneName}</span>
                <span aria-hidden="true">·</span>
                <span>امتیاز: {runtimeStats.score}</span>
                <span aria-hidden="true">·</span>
                <span>جان: {runtimeStats.health}</span>
                <span aria-hidden="true">·</span>
                <span>زمان: {runtimeStats.elapsedSeconds}s</span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400">{runtimeStats.fps} FPS</span>
                {runtimeStats.logs[0] && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-sky-300">{runtimeStats.logs[0]}</span>
                  </>
                )}
              </>
            ) : (
              <>
                <span>صحنه: {activeScene.name}</span>
                <span aria-hidden="true">·</span>
                <span>
                  صفحه: {project.screenConfig.width} × {project.screenConfig.height}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  دنیا: {project.camera?.worldWidth || project.screenConfig.width} ×{' '}
                  {project.camera?.worldHeight || project.screenConfig.height}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {editorTool === 'tile-paint'
                    ? 'برای چیدن کاشی روی صفحه بکشید'
                    : editorTool === 'tile-erase'
                      ? 'برای پاک کردن کاشی روی صفحه کلیک کنید'
                      : project.engineMode === '3d'
                        ? 'برای انتخاب آبجکت کلیک کنید'
                        : 'آبجکت را در صحنه بکشید'}
                </span>
              </>
            )}
          </div>
        </main>

        {/* Left Sidebar (RTL): Inspector & Environment */}
        {!fullscreenPreview && (
          <aside className="w-72 shrink-0 border-r border-slate-800 bg-[#131822] overflow-y-auto p-4 space-y-5">
            {selectedEntity ? (
              <>
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Gamepad className="w-4 h-4 text-amber-400 shrink-0" />
                    <h3 className="text-sm font-bold text-slate-100 truncate">تنظیمات آبجکت</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedEntityId(null)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    تنظیمات صحنه
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="space-y-1">
                    <label className="text-slate-400">نام (برای استفاده در قوانین متنی)</label>
                    <input
                      type="text"
                      value={selectedEntity.name}
                      onChange={(e) => updateEntity(selectedEntity.id, { name: e.target.value })}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-100"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-slate-400">نقش</label>
                      <select
                        value={selectedEntity.role}
                        onChange={(e) =>
                          updateEntity(selectedEntity.id, { role: e.target.value as EntityRole })
                        }
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-100"
                      >
                        <option value="player">بازیکن</option>
                        <option value="enemy">دشمن</option>
                        <option value="platform">سکو / زمین</option>
                        <option value="collectible">سکه / جایزه</option>
                        <option value="prop">دکور / آبجکت</option>
                        <option value="hud-text">متن ثابت</option>
                        <option value="text-box">کادر متن</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <ColorPickerField
                        label="رنگ آبجکت"
                        value={
                          selectedEntity.textConfig
                            ? selectedEntity.textConfig.boxBgColor
                            : selectedEntity.color
                        }
                        allowAlpha={Boolean(selectedEntity.textConfig)}
                        onChange={(nextColor) => {
                          if (selectedEntity.textConfig) {
                            updateEntity(selectedEntity.id, {
                              color: nextColor,
                              textConfig: { ...selectedEntity.textConfig, boxBgColor: nextColor },
                            });
                          } else {
                            updateEntity(selectedEntity.id, { color: nextColor });
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Coordinates */}
                  <div className="space-y-2 tabular-nums">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-slate-400">X</label>
                        <NumericInput
                          step={project.engineMode === '3d' ? 0.5 : 5}
                          value={selectedEntity.x}
                          onChange={(val) => updateEntity(selectedEntity.id, { x: val })}
                          className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-400">Y</label>
                        <NumericInput
                          step={project.engineMode === '3d' ? 0.5 : 5}
                          value={selectedEntity.y}
                          onChange={(val) => updateEntity(selectedEntity.id, { y: val })}
                          className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-slate-400">
                          {project.engineMode === '3d' ? 'Z' : 'زاویه (°)'}
                        </label>
                        <NumericInput
                          step={project.engineMode === '3d' ? 0.5 : 5}
                          value={
                            project.engineMode === '3d'
                              ? selectedEntity.z
                              : selectedEntity.rotationZ
                          }
                          onChange={(val) =>
                            updateEntity(
                              selectedEntity.id,
                              project.engineMode === '3d' ? { z: val } : { rotationZ: val }
                            )
                          }
                          className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                        />
                      </div>
                    </div>

                    {project.engineMode === '2d' ? (
                      <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between text-slate-400">
                          <span>چرخش (زاویه)</span>
                          <span className="font-mono text-slate-200">{selectedEntity.rotationZ}°</span>
                        </div>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={selectedEntity.rotationZ}
                          onChange={(e) =>
                            updateEntity(selectedEntity.id, { rotationZ: Number(e.target.value) })
                          }
                          className="w-full accent-amber-500"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <div className="space-y-1">
                          <label className="text-slate-400">زاویه X</label>
                          <NumericInput
                            step={5}
                            value={selectedEntity.rotationX}
                            onChange={(val) => updateEntity(selectedEntity.id, { rotationX: val })}
                            className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">زاویه Y</label>
                          <NumericInput
                            step={5}
                            value={selectedEntity.rotationY}
                            onChange={(val) => updateEntity(selectedEntity.id, { rotationY: val })}
                            className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">زاویه Z</label>
                          <NumericInput
                            step={5}
                            value={selectedEntity.rotationZ}
                            onChange={(val) => updateEntity(selectedEntity.id, { rotationZ: val })}
                            className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Size */}
                  <div className="grid grid-cols-2 gap-2 tabular-nums">
                    <div className="space-y-1">
                      <label className="text-slate-400">عرض</label>
                      <NumericInput
                        step={project.engineMode === '3d' ? 0.2 : 4}
                        min={project.engineMode === '3d' ? 0.2 : 8}
                        value={selectedEntity.width}
                        onChange={(val) => updateEntity(selectedEntity.id, { width: val })}
                        className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">ارتفاع</label>
                      <NumericInput
                        step={project.engineMode === '3d' ? 0.2 : 4}
                        min={project.engineMode === '3d' ? 0.2 : 8}
                        value={selectedEntity.height}
                        onChange={(val) => updateEntity(selectedEntity.id, { height: val })}
                        className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                      />
                    </div>
                  </div>

                  {/* Animation & Sprite Sheet Engine */}
                  {selectedEntity.kind !== 'hud-text' && selectedEntity.kind !== 'text-box' && (
                    <div className="pt-3 border-t border-slate-800 space-y-2.5">
                      <h4 className="font-bold text-slate-200">انیمیشن و اسپرایت‌شیت</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-slate-400">حرکت انیمیشن</label>
                          <select
                            value={selectedEntity.animation?.preset || 'none'}
                            onChange={(e) =>
                              updateEntity(selectedEntity.id, {
                                animation: {
                                  preset: e.target.value as AnimationPreset,
                                  speed: selectedEntity.animation?.speed ?? 3,
                                  amplitude: selectedEntity.animation?.amplitude ?? 8,
                                  spriteCols: selectedEntity.animation?.spriteCols ?? 1,
                                  spriteRows: selectedEntity.animation?.spriteRows ?? 1,
                                  fps: selectedEntity.animation?.fps ?? 8,
                                },
                              })
                            }
                            className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100"
                          >
                            <option value="none">بدون انیمیشن</option>
                            <option value="float">شناور بالا و پایین</option>
                            <option value="spin">چرخش مداوم</option>
                            <option value="pulse">تپش (بزرگ و کوچک)</option>
                            <option value="swing">نوسان آونگی</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-slate-400">سرعت</label>
                          <NumericInput
                            step={0.5}
                            min={0.5}
                            max={20}
                            value={selectedEntity.animation?.speed ?? 3}
                            onChange={(val) =>
                              updateEntity(selectedEntity.id, {
                                animation: {
                                  preset: selectedEntity.animation?.preset ?? 'none',
                                  speed: val,
                                  amplitude: selectedEntity.animation?.amplitude ?? 8,
                                  spriteCols: selectedEntity.animation?.spriteCols ?? 1,
                                  spriteRows: selectedEntity.animation?.spriteRows ?? 1,
                                  fps: selectedEntity.animation?.fps ?? 8,
                                },
                              })
                            }
                            className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                          />
                        </div>
                      </div>

                      {selectedEntity.kind === 'sprite2d' && (
                        <div className="grid grid-cols-3 gap-2 pt-1 tabular-nums">
                          <div className="space-y-1">
                            <label className="text-slate-400">ستون اسپرایت</label>
                            <NumericInput
                              min={1}
                              max={32}
                              value={selectedEntity.animation?.spriteCols ?? 1}
                              onChange={(val) =>
                                updateEntity(selectedEntity.id, {
                                  animation: {
                                    preset: selectedEntity.animation?.preset ?? 'none',
                                    speed: selectedEntity.animation?.speed ?? 3,
                                    amplitude: selectedEntity.animation?.amplitude ?? 8,
                                    spriteCols: Math.max(1, Math.round(val)),
                                    spriteRows: selectedEntity.animation?.spriteRows ?? 1,
                                    fps: selectedEntity.animation?.fps ?? 8,
                                  },
                                })
                              }
                              className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400">سطر اسپرایت</label>
                            <NumericInput
                              min={1}
                              max={32}
                              value={selectedEntity.animation?.spriteRows ?? 1}
                              onChange={(val) =>
                                updateEntity(selectedEntity.id, {
                                  animation: {
                                    preset: selectedEntity.animation?.preset ?? 'none',
                                    speed: selectedEntity.animation?.speed ?? 3,
                                    amplitude: selectedEntity.animation?.amplitude ?? 8,
                                    spriteCols: selectedEntity.animation?.spriteCols ?? 1,
                                    spriteRows: Math.max(1, Math.round(val)),
                                    fps: selectedEntity.animation?.fps ?? 8,
                                  },
                                })
                              }
                              className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-slate-400">FPS</label>
                            <NumericInput
                              min={1}
                              max={60}
                              value={selectedEntity.animation?.fps ?? 8}
                              onChange={(val) =>
                                updateEntity(selectedEntity.id, {
                                  animation: {
                                    preset: selectedEntity.animation?.preset ?? 'none',
                                    speed: selectedEntity.animation?.speed ?? 3,
                                    amplitude: selectedEntity.animation?.amplitude ?? 8,
                                    spriteCols: selectedEntity.animation?.spriteCols ?? 1,
                                    spriteRows: selectedEntity.animation?.spriteRows ?? 1,
                                    fps: Math.max(1, Math.round(val)),
                                  },
                                })
                              }
                              className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Text & Box Configuration */}
                  {selectedEntity.textConfig && (
                    <div className="pt-3 border-t border-slate-800 space-y-2.5">
                      <h4 className="font-bold text-slate-200">متن، کادر، کلیک و اسکرول</h4>
                      <textarea
                        rows={4}
                        value={selectedEntity.textConfig.text}
                        onChange={(e) =>
                          updateEntity(selectedEntity.id, {
                            textConfig: { ...selectedEntity.textConfig!, text: e.target.value },
                          })
                        }
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-100"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-slate-400">فونت</label>
                          <NumericInput
                            min={10}
                            max={48}
                            value={selectedEntity.textConfig.fontSize}
                            onChange={(val) =>
                              updateEntity(selectedEntity.id, {
                                textConfig: { ...selectedEntity.textConfig!, fontSize: val },
                              })
                            }
                            className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                          />
                        </div>
                        <ColorPickerField
                          label="رنگ متن"
                          value={selectedEntity.textConfig.textColor}
                          onChange={(nextColor) =>
                            updateEntity(selectedEntity.id, {
                              textConfig: {
                                ...selectedEntity.textConfig!,
                                textColor: nextColor,
                              },
                            })
                          }
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <ColorPickerField
                          label="رنگ کادر"
                          allowAlpha
                          value={selectedEntity.textConfig.boxBgColor}
                          onChange={(nextColor) =>
                            updateEntity(selectedEntity.id, {
                              textConfig: {
                                ...selectedEntity.textConfig!,
                                boxBgColor: nextColor,
                              },
                            })
                          }
                        />
                        <ColorPickerField
                          label="رنگ حاشیه"
                          value={selectedEntity.textConfig.boxBorderColor}
                          onChange={(nextColor) =>
                            updateEntity(selectedEntity.id, {
                              textConfig: {
                                ...selectedEntity.textConfig!,
                                boxBorderColor: nextColor,
                              },
                            })
                          }
                        />
                      </div>

                      <div className="space-y-1.5 pt-1">
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEntity.textConfig.fixedOnScreen}
                            onChange={(e) =>
                              updateEntity(selectedEntity.id, {
                                textConfig: {
                                  ...selectedEntity.textConfig!,
                                  fixedOnScreen: e.target.checked,
                                },
                              })
                            }
                          />
                          <span>متن ثابت روی صفحه (HUD)</span>
                        </label>
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEntity.textConfig.scrollable}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              const curText = selectedEntity.textConfig!.text || '';
                              const nextText =
                                checked && !curText.includes('\n') && curText.length < 55
                                  ? `${curText}\nخط دوم: متن اضافی برای تست اسکرول عمودی\nخط سوم: با چرخ ماوس یا کشیدن اسکرول کنید\nخط چهارم: ادامه توضیحات و راهنمای مرحله\nخط پنجم: پایان متن کادر اسکرول`
                                  : curText;
                              updateEntity(selectedEntity.id, {
                                height: checked && selectedEntity.height < 110 ? 120 : selectedEntity.height,
                                textConfig: {
                                  ...selectedEntity.textConfig!,
                                  scrollable: checked,
                                  text: nextText,
                                },
                              });
                            }}
                          />
                          <span>قابلیت اسکرول عمودی متن</span>
                        </label>
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedEntity.textConfig.scrollableX)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              const curText = selectedEntity.textConfig!.text || '';
                              const hasChildren = (selectedEntity.textConfig!.children?.length || 0) > 0;
                              const nextText =
                                checked && !hasChildren && curText.length < 48
                                  ? `${curText}  ✦  آیتم اول: توضیحات گسترده برای اسکرول افقی  ✦  آیتم دوم: چپ و راست بکشید  ✦  آیتم سوم: انتهای کادر`
                                  : curText;
                              updateEntity(selectedEntity.id, {
                                width: checked && selectedEntity.width < 220 ? 260 : selectedEntity.width,
                                textConfig: {
                                  ...selectedEntity.textConfig!,
                                  scrollableX: checked,
                                  text: nextText,
                                },
                              });
                            }}
                          />
                          <span>قابلیت اسکرول افقی (چپ و راست)</span>
                        </label>
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEntity.textConfig.clickable}
                            onChange={(e) =>
                              updateEntity(selectedEntity.id, {
                                clickable: e.target.checked,
                                textConfig: {
                                  ...selectedEntity.textConfig!,
                                  clickable: e.target.checked,
                                },
                              })
                            }
                          />
                          <span>انتخاب و کلیک‌پذیر در بازی</span>
                        </label>
                      </div>

                      {(selectedEntity.textConfig.clickable || selectedEntity.clickable) && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-1.5">
                          <div className="text-[11px] font-semibold text-amber-300">
                            اتصال سریع عمل هنگام کلیک روی «{selectedEntity.name}»:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {[
                              {
                                label: '+۱۰ امتیاز',
                                rule: `کلیک روی ${selectedEntity.name}: امتیاز +10 | افکت جرقه | صدا coin`,
                              },
                              {
                                label: 'پرش بازیکن',
                                rule: `کلیک روی ${selectedEntity.name}: ${
                                  project.entities.find((e) => e.role === 'player')?.name || 'بازیکن'
                                } پرش قدرت ${project.engineMode === '3d' ? 10 : 540} | صدا jump`,
                              },
                              {
                                label: 'نمایش پیام',
                                rule: `کلیک روی ${selectedEntity.name}: نمایش پیام "روی ${selectedEntity.name} کلیک شد!" | صدا click`,
                              },
                              {
                                label: 'مرحله بعد',
                                rule: `کلیک روی ${selectedEntity.name}: مرحله بعد`,
                              },
                            ].map((preset) => (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() =>
                                  onUpdateProject((prev) => {
                                    const nextText = prev.rulesText.trim()
                                      ? `${prev.rulesText.trim()}\n${preset.rule}`
                                      : preset.rule;
                                    return {
                                      ...prev,
                                      rulesText: nextText,
                                      rules: parsePersianRules(nextText, prev.entities).rules,
                                      updatedAt: Date.now(),
                                    };
                                  })
                                }
                                className="px-2 py-1 rounded bg-[#0B0E14] border border-slate-700 text-[10px] text-slate-200 hover:border-amber-400 cursor-pointer"
                              >
                                + {preset.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Nested Multi-Layer Children Inside Box */}
                      <div className="pt-3 border-t border-slate-800 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <h5 className="font-bold text-sky-300 text-xs">
                            لایه‌های داخل کادر ({selectedEntity.textConfig.children?.length || 0})
                          </h5>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateEntity(selectedEntity.id, {
                                  textConfig: {
                                    ...selectedEntity.textConfig!,
                                    layoutDirection: 'vertical',
                                  },
                                })
                              }
                              className={`px-2 py-0.5 rounded text-[10px] border ${
                                (selectedEntity.textConfig.layoutDirection || 'vertical') === 'vertical'
                                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                                  : 'border-slate-700 bg-[#0B0E14] text-slate-400'
                              }`}
                            >
                              چیدمان عمودی
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateEntity(selectedEntity.id, {
                                  textConfig: {
                                    ...selectedEntity.textConfig!,
                                    layoutDirection: 'horizontal',
                                  },
                                })
                              }
                              className={`px-2 py-0.5 rounded text-[10px] border ${
                                selectedEntity.textConfig.layoutDirection === 'horizontal'
                                  ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                                  : 'border-slate-700 bg-[#0B0E14] text-slate-400'
                              }`}
                            >
                              چیدمان افقی
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 items-center">
                          <label className="text-[11px] text-slate-400">فاصله بین لایه‌ها (px)</label>
                          <NumericInput
                            min={0}
                            max={48}
                            value={selectedEntity.textConfig.childGap ?? 8}
                            onChange={(val) =>
                              updateEntity(selectedEntity.id, {
                                textConfig: {
                                  ...selectedEntity.textConfig!,
                                  childGap: val,
                                },
                              })
                            }
                            className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                          />
                        </div>

                        <div className="flex flex-wrap gap-1">
                          {(
                            [
                              { kind: 'text', label: 'متن' },
                              { kind: 'card', label: 'کارت' },
                              { kind: 'button', label: 'دکمه' },
                              { kind: 'image', label: 'تصویر' },
                              { kind: 'badge', label: 'نشان' },
                              { kind: 'divider', label: 'خط' },
                            ] as Array<{ kind: BoxLayerKind; label: string }>
                          ).map((item) => (
                            <button
                              key={item.kind}
                              type="button"
                              onClick={() => {
                                const cur = selectedEntity.textConfig!.children || [];
                                const idxNum = cur.length + 1;
                                const newLayer: BoxChildLayer = {
                                  id: `lyr_${Date.now()}_${idxNum}`,
                                  name: `${item.label} ${idxNum}`,
                                  kind: item.kind,
                                  text:
                                    item.kind === 'divider'
                                      ? ''
                                      : item.kind === 'button'
                                        ? `دکمه ${idxNum}`
                                        : item.kind === 'badge'
                                          ? `نشان: {score}`
                                          : item.kind === 'image'
                                            ? 'تصویر'
                                            : `متن لایه ${idxNum}`,
                                  color: item.kind === 'button' ? '#0B0E14' : '#F8FAFC',
                                  bgColor:
                                    item.kind === 'button'
                                      ? '#F59E0B'
                                      : item.kind === 'badge'
                                        ? '#0284C7'
                                        : item.kind === 'card'
                                          ? 'rgba(30, 41, 59, 0.85)'
                                          : 'rgba(15, 23, 42, 0.45)',
                                  borderColor: item.kind === 'button' ? '#FCD34D' : '#334155',
                                  clickable: item.kind === 'button',
                                  visible: true,
                                };
                                updateEntity(selectedEntity.id, {
                                  height:
                                    selectedEntity.height < 120 ? 150 : selectedEntity.height,
                                  textConfig: {
                                    ...selectedEntity.textConfig!,
                                    children: [...cur, newLayer],
                                  },
                                });
                              }}
                              className="px-2 py-1 rounded bg-[#0B0E14] border border-slate-700 text-[10px] text-slate-200 hover:border-sky-400 cursor-pointer"
                            >
                              + {item.label}
                            </button>
                          ))}
                        </div>

                        <div className="space-y-2 max-h-80 overflow-y-auto pl-1">
                          {(selectedEntity.textConfig.children || []).map((layer, lIdx, arr) => {
                            const patchLayer = (patch: Partial<BoxChildLayer>) => {
                              const nextChildren = arr.map((item) =>
                                item.id === layer.id ? { ...item, ...patch } : item
                              );
                              updateEntity(selectedEntity.id, {
                                textConfig: {
                                  ...selectedEntity.textConfig!,
                                  children: nextChildren,
                                },
                              });
                            };
                            const moveLayer = (dir: -1 | 1) => {
                              const targetIdx = lIdx + dir;
                              if (targetIdx < 0 || targetIdx >= arr.length) return;
                              const nextChildren = [...arr];
                              const [moved] = nextChildren.splice(lIdx, 1);
                              nextChildren.splice(targetIdx, 0, moved);
                              updateEntity(selectedEntity.id, {
                                textConfig: {
                                  ...selectedEntity.textConfig!,
                                  children: nextChildren,
                                },
                              });
                            };
                            const imageAssets = project.assets.filter((a) => a.kind === 'image');

                            return (
                              <div
                                key={layer.id}
                                className="rounded-lg border border-slate-800 bg-[#0B0E14] p-2 space-y-2"
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <input
                                    type="text"
                                    value={layer.name}
                                    onChange={(e) => patchLayer({ name: e.target.value })}
                                    className="px-1.5 py-0.5 rounded border border-slate-700 bg-[#131822] text-[11px] text-slate-100 w-28"
                                  />
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      title="بالا"
                                      onClick={() => moveLayer(-1)}
                                      className="p-1 text-slate-400 hover:text-slate-100"
                                    >
                                      <ArrowUp className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      title="پایین"
                                      onClick={() => moveLayer(1)}
                                      className="p-1 text-slate-400 hover:text-slate-100"
                                    >
                                      <ArrowDown className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      title="کپی لایه"
                                      onClick={() => {
                                        const dup: BoxChildLayer = {
                                          ...layer,
                                          id: `lyr_${Date.now()}_d`,
                                          name: `${layer.name} کپی`,
                                        };
                                        const nextChildren = [...arr];
                                        nextChildren.splice(lIdx + 1, 0, dup);
                                        updateEntity(selectedEntity.id, {
                                          textConfig: {
                                            ...selectedEntity.textConfig!,
                                            children: nextChildren,
                                          },
                                        });
                                      }}
                                      className="p-1 text-slate-400 hover:text-sky-300"
                                    >
                                      <Copy className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      title="نمایش/مخفی"
                                      onClick={() => patchLayer({ visible: !layer.visible })}
                                      className="p-1 text-slate-400 hover:text-slate-100"
                                    >
                                      {layer.visible ? (
                                        <Eye className="w-3 h-3" />
                                      ) : (
                                        <EyeOff className="w-3 h-3" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      title="حذف"
                                      onClick={() => {
                                        updateEntity(selectedEntity.id, {
                                          textConfig: {
                                            ...selectedEntity.textConfig!,
                                            children: arr.filter((x) => x.id !== layer.id),
                                          },
                                        });
                                      }}
                                      className="p-1 text-slate-500 hover:text-red-400"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>

                                {layer.kind !== 'divider' && (
                                  <textarea
                                    rows={2}
                                    value={layer.text}
                                    onChange={(e) => patchLayer({ text: e.target.value })}
                                    placeholder="متن لایه..."
                                    className="w-full px-2 py-1 rounded border border-slate-700 bg-[#131822] text-[11px] text-slate-100"
                                  />
                                )}

                                {layer.kind === 'image' && (
                                  <select
                                    value={layer.assetId || ''}
                                    onChange={(e) =>
                                      patchLayer({ assetId: e.target.value || undefined })
                                    }
                                    className="w-full px-2 py-1 rounded border border-slate-700 bg-[#131822] text-[11px] text-slate-100"
                                  >
                                    <option value="">-- انتخاب تصویر از فایل‌ها --</option>
                                    {imageAssets.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.name}
                                      </option>
                                    ))}
                                  </select>
                                )}

                                {layer.kind !== 'divider' && (
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <ColorPickerField
                                      label="رنگ متن"
                                      value={layer.color || '#F8FAFC'}
                                      onChange={(c) => patchLayer({ color: c })}
                                    />
                                    <ColorPickerField
                                      label="رنگ پس‌زمینه"
                                      allowAlpha
                                      value={layer.bgColor || 'transparent'}
                                      onChange={(c) => patchLayer({ bgColor: c })}
                                    />
                                  </div>
                                )}

                                <div className="grid grid-cols-3 gap-1.5 items-center text-[10px]">
                                  <div>
                                    <span className="text-slate-500 block">عرض</span>
                                    <NumericInput
                                      min={0}
                                      max={800}
                                      value={layer.width ?? 0}
                                      onChange={(v) =>
                                        patchLayer({ width: v > 0 ? v : undefined })
                                      }
                                      className="w-full px-1 py-0.5 rounded border border-slate-700 bg-[#131822] text-slate-100 text-center font-mono"
                                    />
                                  </div>
                                  <div>
                                    <span className="text-slate-500 block">ارتفاع</span>
                                    <NumericInput
                                      min={0}
                                      max={500}
                                      value={layer.height ?? 0}
                                      onChange={(v) =>
                                        patchLayer({ height: v > 0 ? v : undefined })
                                      }
                                      className="w-full px-1 py-0.5 rounded border border-slate-700 bg-[#131822] text-slate-100 text-center font-mono"
                                    />
                                  </div>
                                  <div>
                                    <span className="text-slate-500 block">فونت</span>
                                    <NumericInput
                                      min={9}
                                      max={36}
                                      value={layer.fontSize ?? selectedEntity.textConfig!.fontSize}
                                      onChange={(v) => patchLayer({ fontSize: v })}
                                      className="w-full px-1 py-0.5 rounded border border-slate-700 bg-[#131822] text-slate-100 text-center font-mono"
                                    />
                                  </div>
                                </div>

                                {layer.kind !== 'divider' && (
                                  <div className="space-y-1 pt-0.5">
                                    <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(layer.clickable || layer.kind === 'button')}
                                        onChange={(e) => patchLayer({ clickable: e.target.checked })}
                                      />
                                      <span>کلیک‌پذیر بودن همین لایه</span>
                                    </label>
                                    {(layer.clickable || layer.kind === 'button') && (
                                      <div className="flex flex-wrap gap-1">
                                        {[
                                          {
                                            label: '+۱۰ امتیاز',
                                            rule: `کلیک روی ${layer.name}: امتیاز +10 | افکت جرقه | صدا coin`,
                                          },
                                          {
                                            label: 'پیام',
                                            rule: `کلیک روی ${layer.name}: نمایش پیام "روی ${layer.name} کلیک شد!" | صدا click`,
                                          },
                                          {
                                            label: 'پرش',
                                            rule: `کلیک روی ${layer.name}: ${
                                              project.entities.find((e) => e.role === 'player')?.name ||
                                              'بازیکن'
                                            } پرش قدرت ${project.engineMode === '3d' ? 10 : 540} | صدا jump`,
                                          },
                                        ].map((pr) => (
                                          <button
                                            key={pr.label}
                                            type="button"
                                            onClick={() =>
                                              onUpdateProject((prev) => {
                                                const nextText = prev.rulesText.trim()
                                                  ? `${prev.rulesText.trim()}\n${pr.rule}`
                                                  : pr.rule;
                                                return {
                                                  ...prev,
                                                  rulesText: nextText,
                                                  rules: parsePersianRules(nextText, prev.entities).rules,
                                                  updatedAt: Date.now(),
                                                };
                                              })
                                            }
                                            className="px-1.5 py-0.5 rounded bg-[#131822] border border-slate-700 text-[10px] text-amber-300 hover:border-amber-400"
                                          >
                                            + {pr.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Non-UI Clickable Binding */}
                  {selectedEntity.kind !== 'hud-text' && selectedEntity.kind !== 'text-box' && (
                    <div className="pt-3 border-t border-slate-800 space-y-2">
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedEntity.clickable)}
                          onChange={(e) =>
                            updateEntity(selectedEntity.id, { clickable: e.target.checked })
                          }
                        />
                        <span>کلیک‌پذیر در حین اجرای بازی</span>
                      </label>
                      {selectedEntity.clickable && (
                        <div className="flex flex-wrap gap-1">
                          {[
                            {
                              label: '+۱۰ امتیاز',
                              rule: `کلیک روی ${selectedEntity.name}: امتیاز +10 | افکت جرقه | صدا coin`,
                            },
                            {
                              label: 'انفجار و حذف',
                              rule: `کلیک روی ${selectedEntity.name}: افکت انفجار | حذف ${selectedEntity.name} | صدا hit`,
                            },
                          ].map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() =>
                                onUpdateProject((prev) => {
                                  const nextText = prev.rulesText.trim()
                                    ? `${prev.rulesText.trim()}\n${preset.rule}`
                                    : preset.rule;
                                  return {
                                    ...prev,
                                    rulesText: nextText,
                                    rules: parsePersianRules(nextText, prev.entities).rules,
                                    updatedAt: Date.now(),
                                  };
                                })
                              }
                              className="px-2 py-1 rounded bg-[#0B0E14] border border-slate-700 text-[10px] text-slate-200 hover:border-amber-400 cursor-pointer"
                            >
                              + {preset.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Physics Settings */}
                  {selectedEntity.kind !== 'hud-text' && selectedEntity.kind !== 'text-box' && (
                    <div className="pt-3 border-t border-slate-800 space-y-2.5">
                      <h4 className="font-bold text-slate-200">موتور فیزیک</h4>
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEntity.physics.enabled}
                          onChange={(e) =>
                            updateEntity(selectedEntity.id, {
                              physics: { ...selectedEntity.physics, enabled: e.target.checked },
                            })
                          }
                        />
                        <span>فیزیک و برخورد فعال</span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEntity.physics.isStatic}
                          onChange={(e) =>
                            updateEntity(selectedEntity.id, {
                              physics: { ...selectedEntity.physics, isStatic: e.target.checked },
                            })
                          }
                        />
                        <span>جسم ایستا (سکو / مانع ثابت)</span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedEntity.physics.useGravity}
                          onChange={(e) =>
                            updateEntity(selectedEntity.id, {
                              physics: { ...selectedEntity.physics, useGravity: e.target.checked },
                            })
                          }
                        />
                        <span>تاثیرپذیر از گرانش</span>
                      </label>
                      <div className="space-y-1">
                        <div className="flex justify-between text-slate-400">
                          <span>کشسانی (Bounce)</span>
                          <span className="tabular-nums">{selectedEntity.physics.bounce}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={0.95}
                          step={0.05}
                          value={selectedEntity.physics.bounce}
                          onChange={(e) =>
                            updateEntity(selectedEntity.id, {
                              physics: {
                                ...selectedEntity.physics,
                                bounce: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-amber-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-100">تنظیمات صحنه، دوربین و متغیرها</h3>
                  <p className="text-slate-400 mt-0.5">
                    تنظیمات محیط، ابعاد دنیا، تعقیب دوربین و متغیرهای سفارشی بازی.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-400">نام صحنه / مرحله</label>
                  <input
                    type="text"
                    value={activeScene.name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      onUpdateProject((prev) => ({
                        ...prev,
                        scenes: prev.scenes.map((s) =>
                          s.id === prev.activeSceneId ? { ...s, name: nextName } : s
                        ),
                      }));
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-100"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-400">نام پروژه</label>
                  <input
                    type="text"
                    value={project.name}
                    onChange={(e) =>
                      onUpdateProject((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-slate-400">نوع پس‌زمینه</label>
                    <select
                      value={project.environment.backgroundType}
                      onChange={(e) =>
                        onUpdateProject((prev) => ({
                          ...prev,
                          environment: {
                            ...prev.environment,
                            backgroundType: e.target.value as RayanProject['environment']['backgroundType'],
                          },
                        }))
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-100"
                    >
                      <option value="image">تصویر پس‌زمینه</option>
                      <option value="gradient">گرادیانت</option>
                      <option value="color">رنگ ثابت</option>
                    </select>
                  </div>
                  <ColorPickerField
                    label="رنگ پس‌زمینه"
                    value={project.environment.backgroundColor}
                    onChange={(nextColor) =>
                      onUpdateProject((prev) => ({
                        ...prev,
                        environment: {
                          ...prev.environment,
                          backgroundType:
                            prev.environment.backgroundType === 'image'
                              ? 'color'
                              : prev.environment.backgroundType,
                          backgroundColor: nextColor,
                        },
                      }))
                    }
                  />
                </div>

                {/* Camera & World Bounds */}
                <div className="pt-3 border-t border-slate-800 space-y-2.5">
                  <h4 className="font-bold text-slate-200">دوربین و ابعاد دنیا</h4>
                  <div className="grid grid-cols-2 gap-2 tabular-nums">
                    <div className="space-y-1">
                      <label className="text-slate-400">عرض دنیا</label>
                      <NumericInput
                        min={project.screenConfig.width}
                        max={6000}
                        step={40}
                        value={project.camera?.worldWidth || project.screenConfig.width}
                        onChange={(val) =>
                          onUpdateProject((prev) => ({
                            ...prev,
                            camera: { ...prev.camera, worldWidth: val },
                          }))
                        }
                        className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-slate-400">ارتفاع دنیا</label>
                      <NumericInput
                        min={project.screenConfig.height}
                        max={4000}
                        step={40}
                        value={project.camera?.worldHeight || project.screenConfig.height}
                        onChange={(val) =>
                          onUpdateProject((prev) => ({
                            ...prev,
                            camera: { ...prev.camera, worldHeight: val },
                          }))
                        }
                        className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">تعقیب دوربین روی</label>
                    <select
                      value={project.camera?.followTargetName || ''}
                      onChange={(e) =>
                        onUpdateProject((prev) => ({
                          ...prev,
                          camera: { ...prev.camera, followTargetName: e.target.value },
                        }))
                      }
                      className="w-full px-2 py-1.5 rounded-lg border border-slate-700 bg-[#0B0E14] text-slate-100"
                    >
                      <option value="">دوربین ثابت</option>
                      {project.entities
                        .filter((e) => e.kind !== 'hud-text' && e.kind !== 'text-box')
                        .map((e) => (
                          <option key={e.id} value={e.name}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>بزرگنمایی (Zoom)</span>
                      <span className="font-mono">{project.camera?.zoom ?? 1}x</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.1}
                      value={project.camera?.zoom ?? 1}
                      onChange={(e) =>
                        onUpdateProject((prev) => ({
                          ...prev,
                          camera: { ...prev.camera, zoom: Number(e.target.value) },
                        }))
                      }
                      className="w-full accent-amber-500"
                    />
                  </div>
                </div>

                {/* Gravity & Touch */}
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="flex justify-between text-slate-400">
                    <span>شتاب گرانش محیط</span>
                    <span className="tabular-nums">{project.environment.gravity}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={project.engineMode === '3d' ? 50 : 1800}
                    step={project.engineMode === '3d' ? 1 : 40}
                    value={project.environment.gravity}
                    onChange={(e) =>
                      onUpdateProject((prev) => ({
                        ...prev,
                        environment: { ...prev.environment, gravity: Number(e.target.value) },
                      }))
                    }
                    className="w-full accent-amber-500"
                  />
                </div>

                <label className="flex items-center gap-2 text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={project.screenConfig.showTouchControls}
                    onChange={(e) =>
                      onUpdateProject((prev) => ({
                        ...prev,
                        screenConfig: {
                          ...prev.screenConfig,
                          showTouchControls: e.target.checked,
                        },
                      }))
                    }
                  />
                  <span>نمایش دسته لمسی کامل در پیش‌نمایش</span>
                </label>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                  <div className="space-y-1">
                    <label className="text-slate-400">امتیاز شروع</label>
                    <NumericInput
                      value={project.variables.score}
                      onChange={(val) =>
                        onUpdateProject((prev) => ({
                          ...prev,
                          variables: { ...prev.variables, score: val },
                        }))
                      }
                      className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-slate-400">جان شروع</label>
                    <NumericInput
                      value={project.variables.health}
                      onChange={(val) =>
                        onUpdateProject((prev) => ({
                          ...prev,
                          variables: { ...prev.variables, health: val },
                        }))
                      }
                      className="w-full px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                    />
                  </div>
                </div>

                {/* Custom Variables Manager */}
                <div className="pt-3 border-t border-slate-800 space-y-2">
                  <h4 className="font-bold text-slate-200">متغیرهای سفارشی</h4>
                  <div className="space-y-1.5">
                    {Object.entries(project.customVariables || {}).map(([varName, varVal]) => (
                      <div key={varName} className="flex items-center gap-1.5">
                        <span className="text-slate-300 font-medium flex-1 truncate">{`{${varName}}`}</span>
                        <NumericInput
                          value={varVal}
                          onChange={(val) =>
                            onUpdateProject((prev) => ({
                              ...prev,
                              customVariables: { ...prev.customVariables, [varName]: val },
                            }))
                          }
                          className="w-16 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateProject((prev) => {
                              const next = { ...prev.customVariables };
                              delete next[varName];
                              return { ...prev, customVariables: next };
                            })
                          }
                          className="p-1 text-slate-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={newVarName}
                      onChange={(e) => setNewVarName(e.target.value)}
                      placeholder="نام متغیر..."
                      className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100"
                    />
                    <NumericInput
                      value={newVarVal}
                      onChange={setNewVarVal}
                      className="w-14 px-1.5 py-1 rounded border border-slate-700 bg-[#0B0E14] text-slate-100 text-center font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const clean = newVarName.trim();
                        if (!clean) return;
                        onUpdateProject((prev) => ({
                          ...prev,
                          customVariables: { ...(prev.customVariables || {}), [clean]: newVarVal },
                        }));
                        setNewVarName('');
                        setNewVarVal(0);
                      }}
                      className="px-2 py-1 rounded bg-slate-800 text-amber-400 hover:bg-slate-700 font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};
