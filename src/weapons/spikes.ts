import { Weapon, type WeaponDef } from "./types";
import { letterIcon } from "../ui/icons";

/**
 * หนามเงามรณะ — STUB (to be implemented by the weapons pass).
 * Spec: Dark thorns/tentacles erupt from the ground in an expanding ring (or radial lines) around the hero, damaging and briefly slowing everything in range; more rings / larger radius per level.
 */
class Spikes extends Weapon {
  update(_dt: number): void {
    // TODO: implement
  }
}

export const spikesDef: WeaponDef = {
  id: "spikes",
  name: "หนามเงามรณะ",
  maxLevel: 8,
  color: "#7a3cff",
  icon: letterIcon("ห", "#7a3cff"),
  describe: () => "หนามเงาพุ่งขึ้นจากพื้นเป็นวงรอบตัว แทงทุกสิ่งที่อยู่ใกล้",
  evolution: { requires: "vitality", name: "ป่าหนามนรก", describe: "TODO" },
  create: () => new Spikes(spikesDef),
};
