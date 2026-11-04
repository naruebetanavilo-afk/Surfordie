import { Weapon, type WeaponDef } from "./types";
import { letterIcon } from "../ui/icons";

/**
 * วงเพลิงนรก — STUB (to be implemented by the weapons pass).
 * Spec: Permanent fire ring around the player (animated ground decal) dealing damage ticks every ~0.5s to enemies inside and slowing them; radius & damage grow per level.
 */
class Aura extends Weapon {
  update(_dt: number): void {
    // TODO: implement
  }
}

export const auraDef: WeaponDef = {
  id: "aura",
  name: "วงเพลิงนรก",
  maxLevel: 8,
  color: "#ff7a3c",
  icon: letterIcon("ว", "#ff7a3c"),
  describe: () => "วงไฟรอบตัวเผาศัตรูที่อยู่ใกล้อย่างต่อเนื่อง และทำให้ช้าลง",
  evolution: { requires: "regen", name: "สุริยะแผดเผา", describe: "TODO" },
  create: () => new Aura(auraDef),
};
