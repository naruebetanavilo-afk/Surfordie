import { G } from "../core/G";
import { Weather } from "../world/Weather";

/**
 * Player-side frost effects driven from the enemy side (no Player API yet):
 *
 *  - chill: the hero moves slower for a moment (ice zombie hits, snowballs,
 *    frost breath, frost patches). Applied after Player.update() by giving
 *    back part of this frame's displacement, so stats are never touched.
 *  - blizzard wind: while `Weather` storms the hero drifts gently downwind.
 *
 * `updateFrost(dt)` runs from Director.update (right after the player moved).
 * Visuals: icy sparkles around the hero while chilled, a frost ring and a
 * faint screen flash when a chill starts.
 */

let chillT = 0;
let chillMul = 1;
let fxT = 0;
let flashCd = 0;

/** seconds of chill left (0 = none) */
export function chillLeft(): number {
  return chillT;
}

/**
 * Slow the hero to `mul` (0.6 = 60 % speed) for `time` seconds. Stronger /
 * longer chills override weaker ones; no effect while invulnerable or dead.
 */
export function chillPlayer(time: number, mul = 0.6): void {
  const p = G.player;
  if (p.dead || p.invuln > 0 || G.state !== "playing") return;
  const fresh = chillT <= 0;
  chillT = Math.max(chillT, time);
  chillMul = fresh ? mul : Math.min(chillMul, mul);
  if (fresh) {
    G.fx.ring(p.x, p.z, { radius: 1.3, color: "#9fe8ff", life: 0.35, width: 0.3 });
    G.fx.particles.burst(p.x, 0.7, p.z, { count: 10, color: "#d8f6ff", speed: 3, life: 0.45, size: 0.22, up: 2, gravity: -5 });
    G.audio.sfx("freeze", { vol: 0.55, pitch: 1.25 });
    if (flashCd <= 0) {
      G.overlay.screenFlash("#9fe0ff", 0.22, 0.35);
      flashCd = 1.2;
    }
  }
}

/** after the player moved this frame: apply chill slow + blizzard drift */
export function updateFrost(dt: number): void {
  const p = G.player;
  if (flashCd > 0) flashCd -= dt;
  if (p.dead) {
    chillT = 0;
    return;
  }
  if (chillT > 0) {
    chillT -= dt;
    const k = 1 - chillMul;
    p.x -= p.velX * dt * k;
    p.z -= p.velZ * dt * k;
    fxT -= dt;
    if (fxT <= 0) {
      fxT = 0.11;
      const a = Math.random() * Math.PI * 2;
      G.fx.particles.burst(p.x + Math.cos(a) * 0.45, 0.4 + Math.random() * 0.8, p.z + Math.sin(a) * 0.45, {
        count: 1,
        color: "#c8f2ff",
        speed: 0.4,
        life: 0.5,
        size: 0.2,
        gravity: -1.5,
      });
    }
    if (chillT <= 0) chillMul = 1;
  }
  // blizzard: a gentle push downwind (well below the hero's speed)
  const s = Weather.storm;
  if (s > 0.01) {
    const push = 0.55 * s * dt;
    p.x += Weather.windX * push;
    p.z += Weather.windZ * push;
  }
}

/** new run */
export function resetFrost(): void {
  chillT = 0;
  chillMul = 1;
  fxT = 0;
  flashCd = 0;
}
