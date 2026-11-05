import type * as THREE from "three";
import type { AnimParams } from "./AnimatedMaterial";
import type { EnemyManager } from "./EnemyManager";

export interface EnemyDef {
  id: string;
  /** Thai display name */
  name: string;
  /** base HP before time scaling */
  hp: number;
  /** move speed (world units / second) */
  speed: number;
  /** contact damage per hit on the player */
  damage: number;
  /** collision radius at scale 1 */
  radius: number;
  /** knockback resistance; 1 = normal, 5 = barely moves, 100 = immovable */
  mass: number;
  /** XP gem value dropped */
  xp: number;
  /** render scale multiplier applied to the built geometry */
  scale: number;
  /** animation playback speed multiplier while walking */
  walkRate: number;
  /** HP bar height above ground at scale 1 */
  hpBarY: number;
  /** main colour used for death particles */
  color: string;
  /** builds the merged model (facing +Z, feet at y=0). Called once at boot. */
  build: () => THREE.BufferGeometry;
  anim?: AnimParams;
  /** max simultaneous instances of this type (render capacity). default 1400 */
  capacity?: number;
  boss?: boolean;
  /** chance (0..1) to drop a coin on death. default 0.03 */
  coinChance?: number;
  /** flies over the horde: skips crowd separation with other enemies */
  flying?: boolean;
  /** return true while freeze/stun must be ignored (e.g. an armed fuse whose warning is already showing) */
  ignoreFreeze?: (em: EnemyManager, i: number) => boolean;
  /**
   * Optional AI hook, called every frame for each living enemy of this type.
   * Return true if you moved the enemy yourself (skips default chase steering).
   * Use em.ai0..ai3[i] for per-enemy state, em.x/z for position, G.player for target.
   */
  update?: (em: EnemyManager, i: number, dt: number) => boolean | void;
  /** called when the enemy dies (before removal). */
  onDeath?: (em: EnemyManager, i: number) => void;
  /** called right after spawning */
  onSpawn?: (em: EnemyManager, i: number) => void;
}

export interface SpawnOpts {
  /** multiplies HP (director time scaling, elites) */
  hpMul?: number;
  /** multiplies contact damage */
  dmgMul?: number;
  /** multiplies speed */
  speedMul?: number;
  elite?: boolean;
  /** extra scale multiplier */
  scaleMul?: number;
}

export const FLAG_ELITE = 1;
export const FLAG_BOSS = 2;
