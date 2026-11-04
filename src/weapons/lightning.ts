import { Weapon, type WeaponDef } from "./types";
import { letterIcon } from "../ui/icons";

/**
 * สายฟ้าฟาด — STUB (to be implemented by the weapons pass).
 * Spec: Strikes random visible enemies from the sky (vertical bolt + ground flash), then chains to nearby enemies; more strikes & chain jumps per level.
 */
class Lightning extends Weapon {
  update(_dt: number): void {
    // TODO: implement
  }
}

export const lightningDef: WeaponDef = {
  id: "lightning",
  name: "สายฟ้าฟาด",
  maxLevel: 8,
  color: "#8fd3ff",
  icon: letterIcon("ส", "#8fd3ff"),
  describe: () => "ฟ้าผ่าใส่ศัตรูแบบสุ่มบนจอ แล้วกระโดดต่อไปยังศัตรูใกล้เคียง",
  evolution: { requires: "crit", name: "เทพเจ้าสายฟ้า", describe: "TODO" },
  create: () => new Lightning(lightningDef),
};
