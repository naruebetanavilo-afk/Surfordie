/** All player stats. Multipliers are 1 = 100%. */
export interface PlayerStats {
  maxHp: number;
  /** HP regenerated per second */
  regen: number;
  /** flat damage reduction per hit */
  armor: number;
  /** world units / second */
  moveSpeed: number;
  /** damage multiplier ("ดาเมจ") */
  might: number;
  /** cooldown multiplier, lower = faster ("สปีดโจมตี") */
  cooldown: number;
  /** area / size multiplier ("ขอบเขต") */
  area: number;
  /** projectile speed multiplier */
  projSpeed: number;
  /** effect duration multiplier */
  duration: number;
  /** extra projectiles / instances */
  amount: number;
  /** pickup attraction radius (world units) */
  magnet: number;
  /** luck multiplier (drops, crits, rerolls) */
  luck: number;
  /** XP gain multiplier */
  growth: number;
  /** gold gain multiplier */
  greed: number;
  /** 0..1 crit chance */
  critChance: number;
  /** crit damage multiplier */
  critMul: number;
  /** extra lives */
  revives: number;
}

export function baseStats(): PlayerStats {
  return {
    maxHp: 100,
    regen: 0,
    armor: 0,
    moveSpeed: 4.6,
    might: 1,
    cooldown: 1,
    area: 1,
    projSpeed: 1,
    duration: 1,
    amount: 0,
    magnet: 2.4,
    luck: 1,
    growth: 1,
    greed: 1,
    critChance: 0.05,
    critMul: 1.8,
    revives: 0,
  };
}

/** XP required to go from `level` to `level + 1` */
export function xpToNext(level: number): number {
  // one smooth curve (no jumps between bands): 5, 12, 20, 27 ... ~174 at lv 20, ~420 at lv 40
  return Math.floor(5 + (level - 1) * 7 + 0.09 * level * level);
}
