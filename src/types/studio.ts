export type EngineMode = '2d' | '3d';

export type ScreenPreset =
  | 'web'
  | 'phone-portrait'
  | 'phone-landscape'
  | 'tablet'
  | 'manual';

export interface ScreenConfig {
  preset: ScreenPreset;
  width: number;
  height: number;
  showTouchControls: boolean;
}

export type AssetKind = 'image' | 'model3d' | 'audio';

export type AssetFormat =
  | 'png'
  | 'jpg'
  | 'webp'
  | 'svg'
  | 'glb'
  | 'gltf'
  | 'obj'
  | 'stl'
  | 'fbx'
  | 'ply'
  | 'mp3'
  | 'wav'
  | 'ogg'
  | 'synth';

export interface RayanAsset {
  id: string;
  name: string;
  kind: AssetKind;
  format: AssetFormat;
  /** Data URL for images & audio, or base64 for binary 3D models */
  dataUrl: string;
  sizeBytes: number;
  createdAt: number;
}

export type EntityRole =
  | 'player'
  | 'enemy'
  | 'platform'
  | 'collectible'
  | 'prop'
  | 'projectile-template'
  | 'hud-text'
  | 'text-box';

export type EntityKind =
  | 'shape2d'
  | 'sprite2d'
  | 'model3d-preset'
  | 'model3d-asset'
  | 'hud-text'
  | 'text-box';

export type Shape2DType = 'rect' | 'circle' | 'triangle' | 'star';

export type Model3DPresetType =
  | 'hero-bot'
  | 'rover-car'
  | 'crate'
  | 'crystal-gem'
  | 'pine-tree'
  | 'turret'
  | 'platform-block';

export type BoxLayerKind = 'text' | 'image' | 'badge' | 'button' | 'divider' | 'card';

export interface BoxChildLayer {
  id: string;
  name: string;
  kind: BoxLayerKind;
  text: string;
  assetId?: string;
  color: string;
  bgColor: string;
  borderColor?: string;
  fontSize?: number;
  width?: number;
  height?: number;
  clickable?: boolean;
  visible: boolean;
}

export interface TextConfig {
  text: string;
  fontSize: number;
  textColor: string;
  boxBgColor: string;
  boxBorderColor: string;
  boxBorderWidth: number;
  boxBorderRadius: number;
  boxPadding: number;
  scrollable: boolean;
  scrollableX?: boolean;
  fixedOnScreen: boolean;
  clickable: boolean;
  align: 'right' | 'center' | 'left';
  layoutDirection?: 'vertical' | 'horizontal';
  childGap?: number;
  children?: BoxChildLayer[];
}

export interface PhysicsConfig {
  enabled: boolean;
  isStatic: boolean;
  useGravity: boolean;
  mass: number;
  bounce: number;
  friction: number;
  collider: 'box' | 'sphere' | 'none';
}

export type AnimationPreset = 'none' | 'float' | 'spin' | 'pulse' | 'swing';

export interface EntityAnimationConfig {
  preset: AnimationPreset;
  speed: number;
  amplitude: number;
  spriteCols: number;
  spriteRows: number;
  fps: number;
}

export interface GameEntity {
  id: string;
  name: string;
  role: EntityRole;
  kind: EntityKind;
  shape2d?: Shape2DType;
  model3dPreset?: Model3DPresetType;
  assetId?: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  color: string;
  opacity: number;
  visible: boolean;
  locked?: boolean;
  clickable?: boolean;
  physics: PhysicsConfig;
  textConfig?: TextConfig;
  animation?: EntityAnimationConfig;
}

export type ParticlePreset = 'explosion' | 'sparkle' | 'smoke' | 'snow' | 'rain';

export type RuleTriggerType =
  | 'on-start'
  | 'always'
  | 'every-seconds'
  | 'key-hold'
  | 'key-press'
  | 'on-click'
  | 'on-collision'
  | 'on-scroll'
  | 'var-condition'
  | 'on-tile-hazard'
  | 'on-tile-finish';

export type RuleActionType =
  | 'move-right'
  | 'move-left'
  | 'move-up'
  | 'move-down'
  | 'move-forward'
  | 'move-backward'
  | 'jump'
  | 'throw-projectile'
  | 'throw-self'
  | 'patrol-horizontal'
  | 'chase-target'
  | 'orbit-target'
  | 'add-score'
  | 'add-health'
  | 'set-var'
  | 'add-var'
  | 'destroy-other'
  | 'destroy-self'
  | 'spawn-entity'
  | 'spawn-particles'
  | 'camera-shake'
  | 'go-to-scene'
  | 'next-scene'
  | 'save-progress'
  | 'load-progress'
  | 'respawn'
  | 'play-sound'
  | 'show-message'
  | 'set-text'
  | 'scroll-box';

export interface GameRule {
  id: string;
  enabled: boolean;
  persianLine: string;
  triggerType: RuleTriggerType;
  key?: string;
  targetName: string;
  secondaryName?: string;
  intervalSeconds?: number;
  varName?: string;
  operator?: '>=' | '<=' | '==';
  varValue?: number;
  actionType: RuleActionType;
  paramNumber?: number;
  paramAngle?: number;
  paramText?: string;
}

export interface EnvironmentConfig {
  backgroundType: 'color' | 'gradient' | 'image';
  backgroundColor: string;
  backgroundGradient: string;
  backgroundImageUrl: string;
  gravity: number;
  fogEnabled: boolean;
  fogColor: string;
  ambientLightIntensity: number;
}

export interface CameraConfig {
  worldWidth: number;
  worldHeight: number;
  followTargetName: string;
  zoom: number;
  smoothing: number;
}

export type TileType = 'ground' | 'stone' | 'platform' | 'hazard' | 'bounce' | 'finish';

export interface TilemapConfig {
  tileSize: number;
  /** Keyed by "col,row" */
  tiles: Record<string, TileType>;
}

export interface GameScene {
  id: string;
  name: string;
  environment: EnvironmentConfig;
  camera: CameraConfig;
  tilemap: TilemapConfig;
  entities: GameEntity[];
  rulesText: string;
  rules: GameRule[];
}

export interface EditorSettings {
  snapToGrid: boolean;
  gridSize: number;
  showDebugHitboxes: boolean;
}

export interface SoundBindings {
  bgm: string;
  onJump: string;
  onThrow: string;
  onCollect: string;
  onHit: string;
  onClick: string;
}

export type CodeFileLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'lua'
  | 'css'
  | 'html'
  | 'json'
  | 'text';

export interface CodeFileItem {
  id: string;
  name: string;
  path: string;
  language: CodeFileLanguage;
  content: string;
  enabledInRuntime?: boolean;
  updatedAt: number;
}

export interface RayanProject {
  id: string;
  name: string;
  description: string;
  engineMode: EngineMode;
  screenConfig: ScreenConfig;
  assets: RayanAsset[];
  /** Custom code files (.js, .ts, .css, .html, .json, etc.) */
  codeFiles?: CodeFileItem[];
  /** Mirrors the active scene for convenience & backward compatibility */
  environment: EnvironmentConfig;
  entities: GameEntity[];
  rulesText: string;
  rules: GameRule[];
  /** Multi-scene level architecture */
  scenes: GameScene[];
  activeSceneId: string;
  camera: CameraConfig;
  tilemap: TilemapConfig;
  editorSettings: EditorSettings;
  variables: {
    score: number;
    health: number;
    level: number;
  };
  customVariables: Record<string, number>;
  soundBindings: SoundBindings;
  createdAt: number;
  updatedAt: number;
}

export interface ScriptTemplateItem {
  id: string;
  title: string;
  category: 'movement' | 'physics' | 'ai' | 'ui';
  description: string;
  persianRules2D: string;
  persianRules3D: string;
}
