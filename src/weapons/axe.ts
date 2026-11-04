import { Weapon, type WeaponDef } from "./types";
import { letterIcon } from "../ui/icons";

/**
 * ขวานบูมเมอแรง — STUB (to be implemented by the weapons pass).
 * Spec: Thrown axe flies out toward nearest enemy/facing, decelerates, returns to the player; pierces everything, can re-hit on the way back; more axes per level.
 */
class Axe extends Weapon {
  update(_dt: number): void {
    // TODO: implement
  }
}

export const axeDef: WeaponDef = {
  id: "axe",
  name: "ขวานบูมเมอแรง",
  maxLevel: 8,
  color: "#e8b23a",
  icon: letterIcon("ข", "#e8b23a"),
  describe: () => "ขว้างขวานที่บินออกไปแล้ววนกลับมา ทะลุศัตรูทุกตัว",
  evolution: { requires: "armor", name: "ขวานพายุคลั่ง", describe: "TODO" },
  create: () => new Axe(axeDef),
};
