import { Weapon, type WeaponDef } from "./types";
import { letterIcon } from "../ui/icons";

/**
 * ระเบิดวิญญาณ — STUB (to be implemented by the weapons pass).
 * Spec: Purple soul orbs arc from the hero onto the densest enemy cluster on screen (em.densestTarget), then explode in a big AoE with a swirling purple vortex; more bombs, bigger radius per level.
 */
class Bomb extends Weapon {
  update(_dt: number): void {
    // TODO: implement
  }
}

export const bombDef: WeaponDef = {
  id: "bomb",
  name: "ระเบิดวิญญาณ",
  maxLevel: 8,
  color: "#c77dff",
  icon: letterIcon("ร", "#c77dff"),
  describe: () => "ลูกวิญญาณสีม่วงตกใส่กลุ่มศัตรูที่หนาแน่น แล้วระเบิดเป็นวงกว้าง",
  evolution: { requires: "area", name: "พายุวิญญาณ", describe: "TODO" },
  create: () => new Bomb(bombDef),
};
