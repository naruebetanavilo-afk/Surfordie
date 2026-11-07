import { G } from "../../core/G";

/** shared helpers for the ultimate effects (allocation-free in the hot path) */

const buf: number[] = [];
const collect = (i: number): void => {
  // the spatial grid can hand out a stale slot for one frame after compaction
  const em = G.enemies;
  if (i < em.n && em.state[i] === 0) buf.push(i);
};

/**
 * Living enemy slots overlapping the circle, written into a shared buffer that
 * is only valid until the next call (do not keep it).
 */
export function enemiesIn(x: number, z: number, r: number): readonly number[] {
  buf.length = 0;
  G.enemies.queryCircle(x, z, r, collect);
  return buf;
}

/** uid set that remembers which enemies an expanding wave already hit */
export class HitOnce {
  private set = new Set<number>();
  clear(): void {
    this.set.clear();
  }
  /** true the first time an enemy slot is seen since clear() */
  first(i: number): boolean {
    const u = G.enemies.uid[i];
    if (this.set.has(u)) return false;
    this.set.add(u);
    return true;
  }
}

export function easeOutCubic(t: number): number {
  const u = 1 - (t < 0 ? 0 : t > 1 ? 1 : t);
  return 1 - u * u * u;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** random point on screen around the camera target (fallback target when the screen is empty) */
export function randomScreenPoint(out: { x: number; z: number }, margin = 1.5): void {
  const w = G.world;
  out.x = w.camTarget.x + (Math.random() * 2 - 1) * Math.max(1, w.viewHalfW - margin);
  out.z = w.camTarget.z + (Math.random() * 2 - 1) * Math.max(1, w.viewHalfH - margin);
}
