import { G } from "../core/G";
import { WEAPONS, weaponById } from "./registry";
import { PASSIVES, passiveById } from "../upgrades/passives";
import type { PlayerStats } from "../player/stats";
import type { Weapon } from "./types";
import { iconURL } from "../ui/icons";

export interface Choice {
  kind: "weapon" | "passive" | "evolve" | "gold" | "heal";
  id: string;
  /** level after applying */
  level: number;
  name: string;
  desc: string;
  /** short stat lines for the toast */
  lines: string[];
  /** data URL icon */
  icon: string;
  color: string;
  isNew: boolean;
}

export class WeaponSystem {
  weapons: Weapon[] = [];
  passives = new Map<string, number>();
  readonly maxWeapons = 6;
  readonly maxPassives = 6;

  reset(startWeapon: string): void {
    for (const w of this.weapons) w.dispose();
    this.weapons = [];
    this.passives.clear();
    if (startWeapon) this.addWeapon(startWeapon);
  }

  get(id: string): Weapon | undefined {
    return this.weapons.find((w) => w.def.id === id);
  }

  addWeapon(id: string): Weapon | undefined {
    const ex = this.get(id);
    if (ex) {
      this.upgradeWeapon(id);
      return ex;
    }
    const def = weaponById(id);
    if (!def) return undefined;
    const w = def.create();
    this.weapons.push(w);
    return w;
  }

  upgradeWeapon(id: string): void {
    const w = this.get(id);
    if (!w || w.level >= w.def.maxLevel) return;
    w.level++;
    w.onLevelUp();
  }

  addPassive(id: string): void {
    const def = passiveById(id);
    if (!def) return;
    const l = this.passives.get(id) ?? 0;
    if (l >= def.maxLevel) return;
    this.passives.set(id, l + 1);
    G.player.recalcStats();
  }

  canEvolve(w: Weapon): boolean {
    const ev = w.def.evolution;
    return !!ev && !w.evolved && w.level >= w.def.maxLevel && this.passives.has(ev.requires);
  }

  evolve(w: Weapon): void {
    w.evolved = true;
    w.onEvolve();
  }

  applyPassives(s: PlayerStats): void {
    for (const [id, l] of this.passives) passiveById(id)?.apply(s, l);
  }

  update(dt: number): void {
    for (const w of this.weapons) w.update(dt);
  }

  private weaponChoice(id: string): Choice {
    const def = weaponById(id)!;
    const w = this.get(id);
    const level = w ? w.level + 1 : 1;
    return {
      kind: "weapon",
      id,
      level,
      name: def.name,
      desc: def.describe(level),
      lines: def.lines?.(level) ?? [],
      icon: iconURL("w:" + id, def.icon),
      color: def.color,
      isNew: !w,
    };
  }

  private passiveChoice(id: string): Choice {
    const def = passiveById(id)!;
    const level = (this.passives.get(id) ?? 0) + 1;
    return {
      kind: "passive",
      id,
      level,
      name: def.name,
      desc: def.describe(level),
      lines: def.lines?.(level) ?? [],
      icon: iconURL("p:" + id, def.icon),
      color: def.color,
      isNew: level === 1,
    };
  }

  private evolveChoice(w: Weapon): Choice {
    const ev = w.def.evolution!;
    return {
      kind: "evolve",
      id: w.def.id,
      level: w.level,
      name: ev.name,
      desc: ev.describe,
      lines: ["วิวัฒนาการ!"],
      icon: iconURL("e:" + w.def.id, ev.icon ?? w.def.icon),
      color: "#ffd23f",
      isNew: false,
    };
  }

  private fillerChoices(): Choice[] {
    return [
      {
        kind: "gold",
        id: "gold",
        level: 0,
        name: "ถุงทอง",
        desc: "รับทอง +50",
        lines: ["ทอง +50"],
        icon: iconURL("f:gold", (c, s) => {
          c.fillStyle = "#ffcc33";
          c.beginPath();
          c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
          c.fill();
        }),
        color: "#ffcc33",
        isNew: false,
      },
      {
        kind: "heal",
        id: "heal",
        level: 0,
        name: "ไก่ย่าง",
        desc: "ฟื้นพลังชีวิต 50%",
        lines: ["ฟื้นฟู 50%"],
        icon: iconURL("f:heal", (c, s) => {
          c.fillStyle = "#ff4d6d";
          c.beginPath();
          c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
          c.fill();
        }),
        color: "#ff4d6d",
        isNew: false,
      },
    ];
  }

  /** roll level-up choices */
  rollChoices(count?: number): Choice[] {
    const n = count ?? (G.rng.next() < 0.1 * (G.player.stats.luck - 0.5) ? 4 : 3);
    const pool: { c: () => Choice; w: number }[] = [];
    for (const w of this.weapons) {
      if (w.level < w.def.maxLevel) pool.push({ c: () => this.weaponChoice(w.def.id), w: 1.3 });
    }
    if (this.weapons.length < this.maxWeapons) {
      for (const d of WEAPONS) if (!this.get(d.id)) pool.push({ c: () => this.weaponChoice(d.id), w: 0.9 });
    }
    for (const [id, l] of this.passives) {
      const d = passiveById(id)!;
      if (l < d.maxLevel) pool.push({ c: () => this.passiveChoice(id), w: 1 });
    }
    if (this.passives.size < this.maxPassives) {
      for (const d of PASSIVES) if (!this.passives.has(d.id)) pool.push({ c: () => this.passiveChoice(d.id), w: 0.7 });
    }
    const out: Choice[] = [];
    while (out.length < n && pool.length) {
      const k = G.rng.weighted(pool.map((p) => p.w));
      out.push(pool[k].c());
      pool.splice(k, 1);
    }
    if (out.length === 0) return this.fillerChoices();
    return out;
  }

  applyChoice(c: Choice): void {
    switch (c.kind) {
      case "weapon":
        this.addWeapon(c.id);
        break;
      case "passive":
        this.addPassive(c.id);
        break;
      case "evolve": {
        const w = this.get(c.id);
        if (w) this.evolve(w);
        break;
      }
      case "gold":
        G.stats.gold += 50;
        break;
      case "heal":
        G.player.heal(G.player.stats.maxHp * 0.5);
        break;
    }
    G.events.emit("upgradeApplied", { kind: c.kind, id: c.id, level: c.level });
    G.hud.toast(c);
  }

  /**
   * Treasure chest rewards: an evolution if one is ready, otherwise 1-3 random
   * upgrades of owned weapons/passives. Already applied when returned.
   */
  openChest(): Choice[] {
    const rewards: Choice[] = [];
    const evo = this.weapons.find((w) => this.canEvolve(w));
    if (evo) {
      const c = this.evolveChoice(evo);
      this.applyChoice(c);
      return [c];
    }
    const r = G.rng.next() * G.player.stats.luck;
    const count = r > 0.95 ? 5 : r > 0.7 ? 3 : 1;
    for (let k = 0; k < count; k++) {
      const opts: Choice[] = [];
      for (const w of this.weapons) if (w.level < w.def.maxLevel) opts.push(this.weaponChoice(w.def.id));
      for (const [id, l] of this.passives) if (l < passiveById(id)!.maxLevel) opts.push(this.passiveChoice(id));
      if (!opts.length) {
        const f = this.fillerChoices()[0];
        this.applyChoice(f);
        rewards.push(f);
        continue;
      }
      const c = G.rng.pick(opts);
      this.applyChoice(c);
      rewards.push(c);
    }
    return rewards;
  }
}
