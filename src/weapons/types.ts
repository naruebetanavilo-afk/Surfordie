import { G } from "../core/G";
import type { IconDraw } from "../ui/icons";
import type { PlayerStats } from "../player/stats";
import { VFX } from "./vfx";

export interface WeaponDef {
  id: string;
  /** Thai display name */
  name: string;
  maxLevel: number;
  icon: IconDraw;
  /** accent colour (UI glow, toast) */
  color: string;
  /** card text for reaching `level` (1 = newly acquired) */
  describe: (level: number) => string;
  /**
   * Short stat-change lines for reaching `level`, shown in the left-side skill
   * toast, e.g. ["สปีดโจมตี +20%", "ดาเมจ +30%"]. Optional.
   */
  lines?: (level: number) => string[];
  /** evolution: at max level + owning passive `requires`, a chest evolves it */
  evolution?: { requires: string; name: string; describe: string; icon?: IconDraw };
  create: () => Weapon;
}

export abstract class Weapon {
  level = 1;
  evolved = false;
  /** generic cooldown timer */
  timer = 0;
  constructor(readonly def: WeaponDef) {}

  get stats(): PlayerStats {
    return G.player.stats;
  }
  /** cooldown scaled by the player's attack speed */
  cd(base: number): number {
    return base * G.player.stats.cooldown;
  }
  /** area scaled */
  area(base: number): number {
    return base * G.player.stats.area;
  }
  /** count + player's bonus amount */
  amount(base: number): number {
    return base + G.player.stats.amount;
  }
  duration(base: number): number {
    return base * G.player.stats.duration;
  }
  projSpeed(base: number): number {
    return base * G.player.stats.projSpeed;
  }
  /** display name (evolved name if evolved) */
  get name(): string {
    return this.evolved && this.def.evolution ? this.def.evolution.name : this.def.name;
  }

  abstract update(dt: number): void;
  /** called after level increased */
  onLevelUp(): void {}
  /** called after evolving */
  onEvolve(): void {}
  /**
   * remove any persistent meshes (new run / back to menu). Subclasses that
   * override this must call super.dispose() (it drops shared weapon effects).
   */
  dispose(): void {
    VFX.clear();
  }
}

export interface PassiveDef {
  id: string;
  name: string;
  maxLevel: number;
  icon: IconDraw;
  color: string;
  describe: (level: number) => string;
  /** short line for the toast, e.g. "ดาเมจ +10%" */
  lines?: (level: number) => string[];
  /** add the passive's total effect at `level` into stats */
  apply: (s: PlayerStats, level: number) => void;
}
