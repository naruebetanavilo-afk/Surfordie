import { G } from "../core/G";

export interface HitOpts {
  /** knockback force (world units/sec impulse before mass) */
  kb?: number;
  /** knockback direction; if omitted, uses (enemy - from) or (enemy - player) */
  dirX?: number;
  dirZ?: number;
  fromX?: number;
  fromZ?: number;
  /** disable crit roll */
  noCrit?: boolean;
  /** apply slow: speed multiplier for `slowTime` seconds */
  slow?: number;
  slowTime?: number;
  /** freeze for seconds */
  freeze?: number;
  /** don't spawn a damage number */
  silent?: boolean;
  /** override damage number colour */
  color?: string;
  /** ignore player's might multiplier (already applied) */
  raw?: boolean;
}

let hitSfxT = 0;

/**
 * Damage enemy slot `i` with `base` damage from weapon `source`.
 * Applies might, crit, variance, knockback, flash, number popup and stats.
 * Returns true if the hit killed the enemy.
 */
export function hitEnemy(i: number, base: number, source: string, o: HitOpts = {}): boolean {
  const em = G.enemies;
  if (em.state[i] !== 0) return false;
  const st = G.player.stats;
  let dmg = o.raw ? base : base * st.might;
  let crit = false;
  if (!o.noCrit && G.rng.next() < st.critChance) {
    crit = true;
    dmg *= st.critMul;
  }
  dmg *= 0.92 + G.rng.next() * 0.16;
  dmg = Math.max(1, Math.round(dmg));

  em.hp[i] -= dmg;
  em.flash[i] = 1;
  em.lastHitBy[i] = source;
  G.stats.damageBy[source] = (G.stats.damageBy[source] ?? 0) + dmg;

  if (o.kb) {
    let dx = o.dirX;
    let dz = o.dirZ;
    if (dx === undefined || dz === undefined) {
      dx = em.x[i] - (o.fromX ?? G.player.x);
      dz = em.z[i] - (o.fromZ ?? G.player.z);
    }
    em.knock(i, dx, dz, o.kb);
  }
  if (o.slow !== undefined) em.slow(i, o.slow, o.slowTime ?? 1);
  if (o.freeze) em.freeze(i, o.freeze);

  if (!o.silent) {
    const def = em.def(i);
    G.overlay.damageNumber(em.x[i], def.hpBarY * em.scale[i] / def.scale * 0.9, em.z[i], dmg, crit, o.color);
  }
  const now = G.realTime;
  if (now - hitSfxT > 0.045) {
    hitSfxT = now;
    G.audio.sfx(crit ? "crit" : "hit");
  }
  if (em.hp[i] <= 0) {
    em.kill(i, source);
    return true;
  }
  return false;
}

/** damage all living enemies in a circle. returns number of enemies hit */
export function hitCircle(x: number, z: number, r: number, base: number, source: string, o: HitOpts = {}): number {
  let n = 0;
  const hits: number[] = [];
  G.enemies.queryCircle(x, z, r, (i) => {
    hits.push(i);
  });
  for (const i of hits) {
    hitEnemy(i, base, source, { fromX: x, fromZ: z, ...o });
    n++;
  }
  return n;
}
