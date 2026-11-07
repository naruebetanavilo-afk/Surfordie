import type { RunMods } from "../core/G";

/**
 * ระดับคำสาป (curse tiers) 0..10: an opt-in difficulty ladder per stage.
 * Tier N+1 unlocks after winning tier N on that stage (see runSetup.ts).
 *
 * Per tier:  enemy HP +20%, enemy damage +10%, enemy speed +2% (max +10%),
 *            crowd size +3% (max +15%), gold from coins +25%.
 * Tier 10:   HP x3, damage x2, speed x1.1, crowd x1.15, gold x3.5.
 */
export const CURSE_MAX = 10;

const HP_PER = 0.2;
const DMG_PER = 0.1;
const SPEED_PER = 0.02;
const SPEED_CAP = 0.1;
const DENSITY_PER = 0.03;
const DENSITY_CAP = 0.15;
const GOLD_PER = 0.25;

export function clampCurse(t: number): number {
  return Math.max(0, Math.min(CURSE_MAX, Math.floor(Number.isFinite(t) ? t : 0)));
}

/** the run modifiers of a tier (fresh object, 1 = normal) */
export function curseMods(tier: number): RunMods {
  const t = clampCurse(tier);
  return {
    hp: 1 + HP_PER * t,
    dmg: 1 + DMG_PER * t,
    speed: 1 + Math.min(SPEED_CAP, SPEED_PER * t),
    density: 1 + Math.min(DENSITY_CAP, DENSITY_PER * t),
    gold: 1 + GOLD_PER * t,
  };
}

const pct = (m: number): string => `+${Math.round((m - 1) * 100)}%`;

export interface CurseLine {
  key: keyof RunMods;
  /** short Thai label */
  label: string;
  /** "+60%" */
  value: string;
}

/** exact modifier lines of a tier for the UI (empty for tier 0) */
export function curseLines(tier: number): CurseLine[] {
  const t = clampCurse(tier);
  if (t === 0) return [];
  const m = curseMods(t);
  return [
    { key: "hp", label: "พลังชีวิตศัตรู", value: pct(m.hp) },
    { key: "dmg", label: "ดาเมจศัตรู", value: pct(m.dmg) },
    { key: "speed", label: "ความเร็วศัตรู", value: pct(m.speed) },
    { key: "density", label: "จำนวนศัตรู", value: pct(m.density) },
    { key: "gold", label: "ทองที่ได้", value: pct(m.gold) },
  ];
}

/** Thai tier name: "ระดับปกติ" / "คำสาป 3" */
export function curseName(tier: number): string {
  const t = clampCurse(tier);
  return t === 0 ? "ระดับปกติ" : `คำสาป ${t}`;
}

/** accent colour that heats up with the tier (violet -> magenta -> blood red) */
export function curseColor(tier: number): string {
  const t = clampCurse(tier);
  if (t === 0) return "#9d8cc7";
  const ramp = ["#b07bff", "#c86bff", "#e05cf0", "#f04fc8", "#ff4f9e", "#ff4f78", "#ff4a55", "#f0352f", "#d81f1f", "#b80f2a"];
  return ramp[t - 1];
}
