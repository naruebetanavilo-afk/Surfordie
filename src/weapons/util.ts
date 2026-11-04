/** helpers shared by weapon definitions (toast lines, numbers) */

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
