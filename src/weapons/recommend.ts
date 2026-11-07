import { G } from "../core/G";
import { weaponById } from "./registry";
import { passiveById } from "../upgrades/passives";
import type { Choice } from "./WeaponSystem";

/**
 * Level-up advisor: scores offered cards the way a good player would and
 * picks the best. Used for the "แนะนำ" badge, the 10-second auto pick and the
 * AUTO mode. Pure reads of G.weapons / G.player, no side effects.
 *
 * Priorities (high → low):
 *  1. evolution
 *  2. heal when HP is critically low
 *  3. the passive an owned weapon needs to evolve (more urgent near max level)
 *  4. levelling owned weapons (closer to max and with the catalyst owned first)
 *  5. a new weapon while slots are free (strongly early on)
 *  6. strong passives (might / haste / amount / area) > medium > weak
 *  7. heal when HP is a bit low, gold last
 */

/** passive tiers: damage multipliers first, utility last */
const STRONG = new Set(["might", "haste", "amount", "area"]);
const MEDIUM = new Set(["crit", "duration", "vitality", "armor", "regen"]);

/** passive id → highest "level / max level" of an owned, unevolved weapon that needs it */
function catalystUrgency(id: string): number {
  let u = -1;
  for (const w of G.weapons.weapons) {
    const ev = w.def.evolution;
    if (!ev || w.evolved || ev.requires !== id) continue;
    u = Math.max(u, w.level / w.def.maxLevel);
  }
  return u;
}

/** score of one card; higher is better */
export function scoreChoice(c: Choice): number {
  const ws = G.weapons;
  const p = G.player;
  const hpFrac = p && p.stats.maxHp > 0 ? p.hp / p.stats.maxHp : 1;
  switch (c.kind) {
    case "evolve":
      return 1000;
    case "heal":
      // nearly full HP: the heal restores almost nothing, so gold (1) wins
      return hpFrac < 0.3 ? 120 : hpFrac < 0.55 ? 45 : hpFrac < 0.9 ? 4 : 0;
    case "gold":
      return 1;
    case "weapon": {
      const def = weaponById(c.id);
      if (!def) return 0;
      const owned = ws.get(c.id);
      const catalyst = def.evolution?.requires;
      const hasCatalyst = !!catalyst && ws.passives.has(catalyst);
      if (owned) {
        // closer to max = closer to an evolution / power spike
        const prog = owned.level / def.maxLevel;
        let s = 55 + 25 * prog + (hasCatalyst && !owned.evolved ? 15 : 0);
        // the level that maxes a weapon whose catalyst is owned unlocks the evolution
        if (hasCatalyst && !owned.evolved && c.level >= def.maxLevel) s += 5;
        return s;
      }
      // new weapon: grab them early, less valuable once the build is set
      const n = ws.weapons.length;
      let s = n < 3 ? 80 : n < 5 && G.time < 300 ? 58 : 42;
      if (hasCatalyst) s += 8;
      return s;
    }
    case "passive": {
      const owned = ws.passives.has(c.id);
      const urg = catalystUrgency(c.id);
      // an unowned catalyst unlocks an evolution: very valuable, more so near max
      if (!owned && urg >= 0) return 50 + 40 * urg;
      let s = STRONG.has(c.id) ? 48 : MEDIUM.has(c.id) ? 35 : 24;
      if (owned) s += 4;
      else if (ws.passives.size >= ws.maxPassives - 1) s -= 12; // keep the last slot for something better
      // a heart is worth more while hurting
      if (c.id === "vitality" && hpFrac < 0.5) s += 10;
      // a maxed-out passive is gone from future rolls: tiny bonus to finish it
      const def = passiveById(c.id);
      if (def && c.level >= def.maxLevel) s += 1;
      return s;
    }
  }
  return 0;
}

/** index of the recommended card (first one on ties), -1 for an empty list */
export function recommend(choices: readonly Choice[]): number {
  let best = -1;
  let bs = -Infinity;
  for (let i = 0; i < choices.length; i++) {
    const s = scoreChoice(choices[i]);
    if (s > bs) {
      bs = s;
      best = i;
    }
  }
  return best;
}
