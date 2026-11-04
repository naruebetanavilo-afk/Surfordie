// Global game context. Every system registers itself here during boot so that
// modules can reach each other without import cycles at evaluation time.
// Always import with `import { G } from "../core/G"` and only touch fields at
// runtime (inside functions), never at module top level.
import type { World } from "../world/World";
import type { Input } from "./Input";
import type { Player } from "../player/Player";
import type { EnemyManager } from "../enemies/EnemyManager";
import type { Director } from "../director/Director";
import type { Projectiles } from "../combat/Projectiles";
import type { Pickups } from "../pickups/Pickups";
import type { Fx } from "../fx/Fx";
import type { Overlay2D } from "../ui/Overlay2D";
import type { Hud } from "../ui/Hud";
import type { Screens } from "../ui/Screens";
import type { AudioSys } from "../audio/Audio";
import type { WeaponSystem } from "../weapons/WeaponSystem";
import type { Rng } from "./Rng";
import type { EventBus } from "./Events";

export type GameState = "boot" | "menu" | "playing" | "levelup" | "paused" | "chest" | "gameover" | "victory";

export interface RunStats {
  kills: number;
  gold: number;
  /** total damage per weapon id */
  damageBy: Record<string, number>;
  /** kills per weapon id */
  killsBy: Record<string, number>;
  bossesKilled: number;
  maxLevel: number;
}

export interface DebugFlags {
  autoplay: boolean;
  god: boolean;
  skipMenu: boolean;
  showFps: boolean;
  startTime: number;
  allWeapons: number; // 0 = off, otherwise level to grant every weapon at
  hero: string | null;
}

export interface GameContext {
  state: GameState;
  /** seconds of simulated run time (pauses excluded) */
  time: number;
  /** scaled dt of the current simulation step */
  dt: number;
  /** real-time seconds since page load (for UI anims, never paused) */
  realTime: number;
  /** slow-motion factor, 1 = normal */
  timeScale: number;
  /** id of the hero chosen for this run */
  heroId: string;
  stats: RunStats;
  debug: DebugFlags;

  world: World;
  input: Input;
  player: Player;
  enemies: EnemyManager;
  director: Director;
  projectiles: Projectiles;
  pickups: Pickups;
  fx: Fx;
  overlay: Overlay2D;
  hud: Hud;
  screens: Screens;
  audio: AudioSys;
  weapons: WeaponSystem;
  rng: Rng;
  events: EventBus;

  /** performance diagnostics exposed for tests */
  perf: { fps: number; frameMs: number; enemies: number; particles: number; drawCalls: number };
}

export const G = {
  state: "boot",
  time: 0,
  dt: 0,
  realTime: 0,
  timeScale: 1,
  heroId: "knight",
  stats: { kills: 0, gold: 0, damageBy: {}, killsBy: {}, bossesKilled: 0, maxLevel: 1 },
  debug: { autoplay: false, god: false, skipMenu: false, showFps: false, startTime: 0, allWeapons: 0, hero: null },
  perf: { fps: 0, frameMs: 0, enemies: 0, particles: 0, drawCalls: 0 },
} as unknown as GameContext;

export function resetRunStats(): void {
  G.stats = { kills: 0, gold: 0, damageBy: {}, killsBy: {}, bossesKilled: 0, maxLevel: 1 };
}
