import { G } from "../core/G";
import { hitEnemy, type HitOpts } from "../combat/damage";

/** helpers shared by weapon definitions (toast lines, numbers, safe AoE) */

export type LineKind =
  /** bigger is better, shown as +x% */
  | "pct"
  /** cooldown: smaller is better, shown as attack-speed +x% */
  | "cd"
  /** flat count, shown as +n */
  | "add";

export interface LineSpec<T> {
  key: keyof T;
  label: string;
  kind: LineKind;
}

/**
 * Stat-change lines for reaching `level` from a level table, e.g.
 * ["ดาเมจ +30%", "จำนวน +1"]. Level 1 returns `first`.
 */
export function levelLines<T extends Record<string, number>>(
  table: T[],
  level: number,
  specs: LineSpec<T>[],
  first: string[],
): string[] {
  if (level <= 1) return first;
  const a = table[Math.min(table.length - 1, level - 2)];
  const b = table[Math.min(table.length - 1, level - 1)];
  const out: string[] = [];
  for (const s of specs) {
    const va = a[s.key];
    const vb = b[s.key];
    if (va === vb) continue;
    if (s.kind === "add") out.push(`${s.label} +${vb - va}`);
    else if (s.kind === "cd") out.push(`${s.label} +${Math.round((va / vb - 1) * 100)}%`);
    else out.push(`${s.label} +${Math.round((vb / va - 1) * 100)}%`);
  }
  return out;
}

/** smooth 0..1..0 hump */
export function hump(t: number): number {
  return t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** ease-out-back (overshoot) for snappy pop-ins */
export function easeOutBack(t: number, s = 1.70158): number {
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

/**
 * True if enemy slot `i` is a real, living enemy. The spatial grid is rebuilt
 * before dead slots are compacted, so for one frame it can hand out stale
 * slots past `n` (a ghost copy of a moved enemy). Hitting one would grant a
 * phantom kill and corrupt the alive count, so weapons skip them.
 */
export function liveSlot(i: number): boolean {
  const em = G.enemies;
  return i < em.n && em.state[i] === 0;
}

const aoeBuf: number[] = [];
const aoeCollect = (i: number): void => {
  if (liveSlot(i)) aoeBuf.push(i);
};

/** allocation-free hitCircle that ignores stale grid slots. Returns enemies hit. */
export function aoeHit(x: number, z: number, r: number, base: number, source: string, o: HitOpts = {}): number {
  aoeBuf.length = 0;
  G.enemies.queryCircle(x, z, r, aoeCollect);
  const fx = o.fromX;
  const fz = o.fromZ;
  if (fx === undefined) o.fromX = x;
  if (fz === undefined) o.fromZ = z;
  const n = aoeBuf.length;
  for (let k = 0; k < n; k++) hitEnemy(aoeBuf[k], base, source, o);
  o.fromX = fx;
  o.fromZ = fz;
  return n;
}
