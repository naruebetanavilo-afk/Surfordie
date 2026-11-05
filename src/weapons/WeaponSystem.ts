import { G } from "../core/G";
import { WEAPONS, weaponById } from "./registry";
import { PASSIVES, passiveById } from "../upgrades/passives";
import type { PlayerStats } from "../player/stats";
import type { Weapon } from "./types";
import { iconURL, iconBg } from "../ui/icons";
import { VFX } from "./vfx";
import { glow, star4, INK } from "./iconkit";

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

  constructor() {
    // G.events is created before the weapon system during boot
    G.events?.on("runEnd", () => this.afterglow());
  }

  /**
   * The simulation stops on game over / victory; let in-flight weapon effects
   * play out in slow motion (like Fx does) instead of freezing mid-air.
   */
  private afterglow(): void {
    let last = performance.now();
    const step = (now: number): void => {
      if (G.state !== "gameover" && G.state !== "victory") return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      VFX.begin(dt * 0.3);
      VFX.flush();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  reset(startWeapon: string): void {
    for (const w of this.weapons) w.dispose();
    VFX.clear();
    this.weapons = [];
    this.passives.clear();
    if (startWeapon) this.addWeapon(startWeapon);
    this.applyDebugLoadout();
  }

  /**
   * Debug: `?wtest=bomb,spikes&wlv=8&wevo=1&wpas=area,might` grants specific
   * weapons (at level wlv, evolved if wevo=1) and passives at max level.
   */
  private applyDebugLoadout(): void {
    const q = new URLSearchParams(location.search);
    const ids = q.get("wtest");
    if (!ids) return;
    const lv = parseInt(q.get("wlv") ?? "8", 10) || 8;
    if (q.get("wonly") === "1") {
      for (const w of this.weapons) w.dispose();
      this.weapons = [];
    }
    for (const id of ids.split(",")) {
      const w = this.get(id) ?? this.addWeapon(id);
      if (!w) continue;
      while (w.level < Math.min(lv, w.def.maxLevel)) this.upgradeWeapon(id);
      if (q.get("wevo") === "1" && w.def.evolution) this.evolve(w);
    }
    for (const id of (q.get("wpas") ?? "").split(",")) {
      const d = passiveById(id);
      if (d) this.passives.set(id, d.maxLevel);
    }
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
    VFX.begin(dt);
    for (const w of this.weapons) w.update(dt);
    VFX.flush();
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
        icon: iconURL("f:gold", drawGoldBag),
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
        icon: iconURL("f:heal", drawDrumstick),
        color: "#ff4d6d",
        isNew: false,
      },
    ];
  }

  /** passive ids that unlock an evolution of an owned weapon */
  private wantedPassives(): Map<string, number> {
    const m = new Map<string, number>();
    for (const w of this.weapons) {
      const ev = w.def.evolution;
      if (!ev || w.evolved) continue;
      // the closer the weapon is to max level, the more we want its catalyst
      const urgency = w.level / w.def.maxLevel;
      m.set(ev.requires, Math.max(m.get(ev.requires) ?? 0, urgency));
    }
    return m;
  }

  /** roll level-up choices */
  rollChoices(count?: number): Choice[] {
    const n = count ?? (G.rng.next() < 0.1 * (G.player.stats.luck - 0.5) ? 4 : 3);
    const pool: { c: () => Choice; w: number; weapon: boolean }[] = [];
    const wanted = this.wantedPassives();
    const few = this.weapons.length < 3;
    for (const w of this.weapons) {
      if (w.level < w.def.maxLevel) {
        // owned weapons are the backbone of a build: favour them, more so close to max
        pool.push({ c: () => this.weaponChoice(w.def.id), w: 1.45 + (w.level >= 5 ? 0.25 : 0), weapon: true });
      }
    }
    if (this.weapons.length < this.maxWeapons) {
      const nw = few ? 1.25 : 0.75;
      for (const d of WEAPONS) if (!this.get(d.id)) pool.push({ c: () => this.weaponChoice(d.id), w: nw, weapon: true });
    }
    for (const [id, l] of this.passives) {
      const d = passiveById(id)!;
      if (l < d.maxLevel) pool.push({ c: () => this.passiveChoice(id), w: 0.95 + (wanted.get(id) ?? 0) * 0.4, weapon: false });
    }
    if (this.passives.size < this.maxPassives) {
      for (const d of PASSIVES) {
        if (this.passives.has(d.id)) continue;
        const want = wanted.get(d.id);
        pool.push({ c: () => this.passiveChoice(d.id), w: want !== undefined ? 0.9 + want * 1.4 : 0.6, weapon: false });
      }
    }
    const out: Choice[] = [];
    let hasWeapon = false;
    while (out.length < n && pool.length) {
      // guarantee at least one weapon card when any is available
      if (out.length === n - 1 && !hasWeapon) {
        const wi = pool.findIndex((p) => p.weapon);
        if (wi >= 0) {
          out.push(pool[wi].c());
          pool.splice(wi, 1);
          hasWeapon = true;
          continue;
        }
      }
      const k = G.rng.weighted(pool.map((p) => p.w));
      if (pool[k].weapon) hasWeapon = true;
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
   * Treasure chest rewards: evolutions first (every ready weapon can evolve
   * from one big chest), then 1-5 random upgrades of owned weapons/passives,
   * biased towards weapons. Already applied when returned.
   */
  openChest(): Choice[] {
    const rewards: Choice[] = [];
    const r = G.rng.next() * G.player.stats.luck;
    const count = r > 0.95 ? 5 : r > 0.7 ? 3 : 1;
    for (let k = 0; k < count; k++) {
      const evo = this.weapons.find((w) => this.canEvolve(w));
      if (evo) {
        const c = this.evolveChoice(evo);
        this.applyChoice(c);
        rewards.push(c);
        continue;
      }
      const opts: Choice[] = [];
      const weights: number[] = [];
      for (const w of this.weapons) {
        if (w.level < w.def.maxLevel) {
          opts.push(this.weaponChoice(w.def.id));
          weights.push(1.6);
        }
      }
      for (const [id, l] of this.passives) {
        if (l < passiveById(id)!.maxLevel) {
          opts.push(this.passiveChoice(id));
          weights.push(1);
        }
      }
      if (!opts.length) {
        const f = this.fillerChoices()[k % 2 === 0 ? 0 : 1];
        this.applyChoice(f);
        rewards.push(f);
        continue;
      }
      const c = opts[G.rng.weighted(weights)];
      this.applyChoice(c);
      rewards.push(c);
    }
    return rewards;
  }
}

function drawGoldBag(c: CanvasRenderingContext2D, s: number): void {
  iconBg(c, s, "#ffcc33");
  glow(c, s * 0.5, s * 0.58, s * 0.38, "rgba(255,204,51,0.6)");
  c.save();
  c.lineWidth = s * 0.045;
  c.strokeStyle = INK;
  // sack
  c.fillStyle = "#c98a3a";
  c.beginPath();
  c.moveTo(s * 0.38, s * 0.36);
  c.bezierCurveTo(s * 0.16, s * 0.5, s * 0.18, s * 0.82, s * 0.5, s * 0.82);
  c.bezierCurveTo(s * 0.82, s * 0.82, s * 0.84, s * 0.5, s * 0.62, s * 0.36);
  c.closePath();
  c.fill();
  c.stroke();
  // tie
  c.fillStyle = "#8a5320";
  c.beginPath();
  c.ellipse(s * 0.5, s * 0.34, s * 0.14, s * 0.05, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  // coin emblem
  c.fillStyle = "#ffd84a";
  c.beginPath();
  c.arc(s * 0.5, s * 0.62, s * 0.11, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = "#b8860b";
  c.font = `900 ${Math.floor(s * 0.13)}px sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("฿", s * 0.5, s * 0.625);
  c.restore();
  star4(c, s * 0.76, s * 0.26, s * 0.07, "#fff3b0");
}

function drawDrumstick(c: CanvasRenderingContext2D, s: number): void {
  iconBg(c, s, "#ff4d6d");
  glow(c, s * 0.5, s * 0.5, s * 0.36, "rgba(255,140,90,0.55)");
  c.save();
  c.translate(s * 0.5, s * 0.5);
  c.rotate(-Math.PI / 4);
  c.lineWidth = s * 0.045;
  c.strokeStyle = INK;
  // bone
  c.fillStyle = "#f4ead7";
  c.beginPath();
  c.roundRect(-s * 0.04, s * 0.08, s * 0.08, s * 0.24, s * 0.03);
  c.fill();
  c.stroke();
  c.beginPath();
  c.arc(-s * 0.05, s * 0.33, s * 0.05, 0, Math.PI * 2);
  c.arc(s * 0.05, s * 0.33, s * 0.05, 0, Math.PI * 2);
  c.fill();
  // meat
  const g = c.createRadialGradient(-s * 0.05, -s * 0.1, s * 0.02, 0, -s * 0.04, s * 0.24);
  g.addColorStop(0, "#ffb46b");
  g.addColorStop(0.6, "#d9772e");
  g.addColorStop(1, "#9c4a17");
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(0, -s * 0.06, s * 0.19, s * 0.22, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.55)";
  c.beginPath();
  c.ellipse(-s * 0.07, -s * 0.13, s * 0.05, s * 0.08, 0.3, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
