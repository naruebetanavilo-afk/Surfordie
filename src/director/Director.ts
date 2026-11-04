import { G } from "../core/G";
import { ENEMY_DEFS } from "../enemies/defs";

/** length of a full run in seconds; surviving this long = victory */
export const RUN_LENGTH = 10 * 60;

/**
 * Spawn director: decides what spawns, where and when.
 * Core version: steady stream of shamblers that ramps up with time.
 * The roster pass replaces this with a timeline (waves, hordes, bosses).
 */
export class Director {
  private acc = 0;
  private tmp = { x: 0, z: 0 };

  reset(): void {
    this.acc = 0;
  }

  /** HP multiplier for enemies spawned at time t (seconds) */
  hpScale(t: number): number {
    const m = t / 60;
    return 1 + m * 0.45 + m * m * 0.06;
  }

  /** desired number of living enemies at time t */
  targetAlive(t: number): number {
    const m = t / 60;
    return Math.min(650, Math.floor(30 + m * 55 + m * m * 3));
  }

  update(dt: number): void {
    const t = G.time;
    const em = G.enemies;
    const target = this.targetAlive(t);
    const deficit = target - em.alive;
    // spawn faster when far below target
    const rate = 4 + t / 12 + Math.max(0, deficit) * 0.6;
    this.acc += rate * dt;
    let budget = Math.min(30, Math.floor(this.acc));
    this.acc -= budget;
    if (deficit <= 0) budget = 0;
    const hpMul = this.hpScale(t);
    while (budget-- > 0) {
      em.spawnPoint(this.tmp);
      const def = ENEMY_DEFS[Math.floor(Math.random() * ENEMY_DEFS.length)];
      if (def.boss) continue;
      em.spawn(def.id, this.tmp.x, this.tmp.z, { hpMul });
    }
  }
}
