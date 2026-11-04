import type { WeaponDef } from "./types";
import { slashDef } from "./slash";
import { orbitDef } from "./orbit";
import { missileDef } from "./missile";
import { axeDef } from "./axe";
import { bombDef } from "./bomb";
import { lightningDef } from "./lightning";
import { spikesDef } from "./spikes";
import { auraDef } from "./aura";

/** every weapon available in the level-up pool */
export const WEAPONS: WeaponDef[] = [slashDef, orbitDef, missileDef, axeDef, bombDef, lightningDef, spikesDef, auraDef];

export function weaponById(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}
