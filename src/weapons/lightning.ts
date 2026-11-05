import { G } from "../core/G";
import { hitEnemy, hitCircle } from "../combat/damage";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { VFX, col, SPARK_GLOW, SPARK_STAR, DECAL_CRACK, DECAL_SHOCK, DECAL_GLOW, DECAL_SCORCH } from "./vfx";
import { levelLines } from "./util";
import { evolvedFrame, glow, star4, INK } from "./iconkit";

/**
 * สายฟ้าฟาด (Sky Strike) — bolts fall from the sky onto random enemies on
 * screen (ground flash, cracks, star sparkles), then chain to nearby enemies.
 * Evolved (เทพเจ้าสายฟ้า): golden storm — +2 strikes, wide stunning impacts,
 * +2 chain jumps and extra forks.
 */
const LV = [
  { n: 1, dmg: 18, chain: 1, cd: 2.0 },
  { n: 2, dmg: 18, chain: 1, cd: 2.0 },
  { n: 2, dmg: 24, chain: 2, cd: 1.9 },
  { n: 3, dmg: 24, chain: 2, cd: 1.8 },
  { n: 3, dmg: 32, chain: 3, cd: 1.7 },
  { n: 4, dmg: 32, chain: 3, cd: 1.6 },
  { n: 4, dmg: 42, chain: 4, cd: 1.5 },
  { n: 5, dmg: 55, chain: 4, cd: 1.4 },
];

const GLOW = "#7cc8ff";
const PALE = "#d6f0ff";
const EV_GLOW = "#ffd23f";
const EV_PALE = "#fff3b8";

interface Ev {
  active: boolean;
  t: number;
  /** 0 = sky strike, 1 = chain jump */
  kind: 0 | 1;
  x: number;
  z: number;
  dmg: number;
  jumps: number;
  set: Set<number> | null;
}

const MAX_EV = 64;

class Lightning extends Weapon {
  private evs: Ev[] = [];
  private setPool: Set<number>[] = [];
  /** uids struck by the current volley (spread strikes over different enemies) */
  private struck = new Set<number>();
  private thunderCd = 0;
  private zapCd = 0;

  constructor(def: WeaponDef) {
    super(def);
    for (let i = 0; i < MAX_EV; i++) this.evs.push({ active: false, t: 0, kind: 0, x: 0, z: 0, dmg: 0, jumps: 0, set: null });
    this.timer = 0.8;
  }

  private queue(kind: 0 | 1, t: number, x: number, z: number, dmg: number, jumps: number, set: Set<number> | null): void {
    for (const e of this.evs) {
      if (e.active) continue;
      e.active = true;
      e.kind = kind;
      e.t = t;
      e.x = x;
      e.z = z;
      e.dmg = dmg;
      e.jumps = jumps;
      e.set = set;
      return;
    }
    if (set) this.releaseSet(set);
  }

  private takeSet(): Set<number> {
    const s = this.setPool.pop() ?? new Set<number>();
    s.clear();
    return s;
  }

  private releaseSet(s: Set<number>): void {
    s.clear();
    this.setPool.push(s);
  }

  update(dt: number): void {
    const L = LV[this.level - 1];
    this.thunderCd -= dt;
    this.zapCd -= dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.cd(L.cd);
      this.struck.clear();
      const n = this.amount(L.n) + (this.evolved ? 2 : 0);
      const dmg = L.dmg * (this.evolved ? 1.25 : 1);
      for (let k = 0; k < n; k++) this.queue(0, k * 0.09, 0, 0, dmg, L.chain + (this.evolved ? 2 : 0), null);
    }
    for (const e of this.evs) {
      if (!e.active) continue;
      e.t -= dt;
      if (e.t > 0) continue;
      e.active = false;
      if (e.kind === 0) this.strike(e.dmg, e.jumps);
      else this.chain(e.x, e.z, e.dmg, e.jumps, e.set!);
    }
  }

  private pickTarget(): number {
    const em = G.enemies;
    let fallback = -1;
    for (let tries = 0; tries < 6; tries++) {
      const i = em.randomVisible();
      if (i < 0) return fallback;
      if (!this.struck.has(em.uid[i])) return i;
      fallback = i;
    }
    return fallback;
  }

  private strike(dmg: number, jumps: number): void {
    const em = G.enemies;
    const i = this.pickTarget();
    if (i < 0) return;
    const ev = this.evolved;
    const x = em.x[i];
    const z = em.z[i];
    const uid = em.uid[i];
    this.struck.add(uid);
    const glowC = ev ? EV_GLOW : GLOW;
    // slanted sky bolt (comes in from the top of the screen) + bright core
    const tx = x - 0.8 + Math.random() * 1.6;
    const tz = z - 5;
    VFX.bolts.spawn(tx, 13, tz, x, 0.15, z, glowC, ev ? 0.75 : 0.55, 0.75, 0.26);
    VFX.bolts.spawn(tx, 13, tz, x, 0.15, z, "#ffffff", 0.22, 0.45, 0.18);
    // ground impact
    const r = this.area(ev ? 2.2 : 1.0);
    hitCircle(x, z, r, dmg, this.def.id, { kb: 3, freeze: ev ? 0.4 : undefined });
    const pale = col(ev ? EV_PALE : PALE);
    VFX.decals.spawn(x, z, Math.max(1.3, r * 1.3), 0.45, col(glowC), DECAL_CRACK, 1.1, 0, 0.5, 0.1);
    VFX.decals.spawn(x, z, r * 1.5, 0.35, pale, DECAL_SHOCK, 0.9, 0, 0.2, 0.9);
    VFX.decals.spawn(x, z, r * 1.6, 0.22, col(glowC), DECAL_GLOW, 1.2, 0, 0.7, 0.1);
    VFX.dark.spawn(x, z, 0.7 + r * 0.25, 1.6, col("#1a1f2e"), DECAL_SCORCH, 0.45, 0, 0.8, 0.05);
    VFX.sparkles.burst(x, 0.7, z, ev ? 8 : 5, 4.5, 4, 0.5, 1.05, col("#ffffff"), SPARK_STAR, -8, 2.2, 0.5);
    VFX.sparkles.burst(x, 0.4, z, 10, 5, 2, 0.4, 0.4, col(glowC), SPARK_GLOW, -4, 3, 0.3);
    if (ev) {
      // ground forks crawling out of the impact
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        const d = r * (0.9 + Math.random() * 0.5);
        VFX.bolts.spawn(x, 0.25, z, x + Math.cos(a) * d, 0.2, z + Math.sin(a) * d, EV_GLOW, 0.22, 0.35, 0.2);
      }
    }
    if (this.thunderCd <= 0) {
      G.audio.sfx("thunder", { vol: 0.7, pitch: 0.9 + Math.random() * 0.25 });
      G.world.shake(ev ? 0.22 : 0.12);
      this.thunderCd = 0.14;
    }
    if (jumps > 0) {
      const set = this.takeSet();
      set.add(uid);
      this.queue(1, 0.07, x, z, dmg * 0.8, jumps, set);
    }
  }

  private chain(x: number, z: number, dmg: number, jumps: number, set: Set<number>): void {
    const em = G.enemies;
    const j = em.nearest(x, z, 5 * Math.sqrt(G.player.stats.area), set);
    if (j < 0) {
      this.releaseSet(set);
      return;
    }
    const ex = em.x[j];
    const ez = em.z[j];
    const ev = this.evolved;
    VFX.bolts.spawn(x, 0.9, z, ex, 0.9, ez, ev ? EV_GLOW : GLOW, 0.32, 0.4, 0.2);
    VFX.bolts.spawn(x, 0.9, z, ex, 0.9, ez, "#ffffff", 0.1, 0.25, 0.14);
    set.add(em.uid[j]);
    hitEnemy(j, dmg, this.def.id, { kb: 2, fromX: x, fromZ: z, freeze: ev ? 0.25 : undefined });
    VFX.sparkles.spawn(ex, 1.0, ez, 0, 1.2, 0, 0.35, 0.9, col("#ffffff"), SPARK_STAR, 0, 0, 3);
    VFX.sparkles.burst(ex, 0.9, ez, 4, 3, 1.5, 0.3, 0.35, col(ev ? EV_GLOW : GLOW), SPARK_GLOW, -3, 3);
    if (this.zapCd <= 0) {
      G.audio.sfx("zap", { vol: 0.45, pitch: 1.3 });
      this.zapCd = 0.06;
    }
    if (jumps > 1) this.queue(1, 0.065, ex, ez, dmg * 0.85, jumps - 1, set);
    else this.releaseSet(set);
  }

  onEvolve(): void {
    this.timer = 0.05;
  }

  dispose(): void {
    super.dispose();
    for (const e of this.evs) {
      if (e.active && e.set) this.releaseSet(e.set);
      e.active = false;
    }
  }
}

function drawLightning(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  iconBg(c, s, evolved ? "#ffd23f" : "#5ab8ff", evolved ? "#211d12" : "#161c2a");
  // storm cloud
  c.save();
  c.fillStyle = evolved ? "#5a4a2a" : "#3a4660";
  c.strokeStyle = INK;
  c.lineWidth = s * 0.035;
  c.beginPath();
  c.arc(s * 0.36, s * 0.3, s * 0.13, Math.PI * 0.9, Math.PI * 1.95);
  c.arc(s * 0.55, s * 0.24, s * 0.15, Math.PI * 1.1, Math.PI * 1.95);
  c.arc(s * 0.7, s * 0.33, s * 0.11, Math.PI * 1.3, Math.PI * 0.4);
  c.lineTo(s * 0.26, s * 0.42);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
  glow(c, s * 0.5, s * 0.62, s * 0.34, evolved ? "rgba(255,210,63,0.75)" : "rgba(124,200,255,0.75)");
  // bolt
  const g = c.createLinearGradient(0, s * 0.35, 0, s * 0.9);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, evolved ? "#ffd23f" : "#7cc8ff");
  c.save();
  c.fillStyle = g;
  c.strokeStyle = INK;
  c.lineWidth = s * 0.04;
  c.beginPath();
  c.moveTo(s * 0.55, s * 0.36);
  c.lineTo(s * 0.38, s * 0.62);
  c.lineTo(s * 0.5, s * 0.62);
  c.lineTo(s * 0.4, s * 0.9);
  c.lineTo(s * 0.66, s * 0.54);
  c.lineTo(s * 0.54, s * 0.54);
  c.lineTo(s * 0.64, s * 0.36);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
  star4(c, s * 0.24, s * 0.7, s * 0.08);
  star4(c, s * 0.78, s * 0.74, s * 0.06);
  if (evolved) {
    star4(c, s * 0.8, s * 0.52, s * 0.05, "#fff3b8");
    evolvedFrame(c, s);
  }
}

export const lightningDef: WeaponDef = {
  id: "lightning",
  name: "สายฟ้าฟาด",
  maxLevel: 8,
  color: "#8fd3ff",
  icon: (c, s) => drawLightning(c, s, false),
  describe: (l) =>
    [
      "ฟ้าผ่าใส่ศัตรูแบบสุ่มบนจอ แล้วกระโดดต่อไปยังศัตรูใกล้เคียง",
      "สายฟ้า +1",
      "ดาเมจ +33% • กระโดดต่อ +1",
      "สายฟ้า +1 • ผ่าถี่ขึ้น",
      "ดาเมจ +33% • กระโดดต่อ +1",
      "สายฟ้า +1 • ผ่าถี่ขึ้น",
      "ดาเมจ +31% • กระโดดต่อ +1",
      "สายฟ้า +1 • ดาเมจ +31%",
    ][l - 1] ?? "",
  lines: (l) =>
    levelLines(
      LV,
      l,
      [
        { key: "n", label: "สายฟ้า", kind: "add" },
        { key: "dmg", label: "ดาเมจ", kind: "pct" },
        { key: "chain", label: "กระโดดต่อ", kind: "add" },
        { key: "cd", label: "สปีดโจมตี", kind: "cd" },
      ],
      ["ดาเมจ " + LV[0].dmg, "กระโดดต่อ 1 ตัว"],
    ),
  evolution: {
    requires: "crit",
    name: "เทพเจ้าสายฟ้า",
    describe: "สายฟ้าสีทอง +2 สาย ดาเมจ +25% จุดตกกว้างขึ้นและทำให้ศัตรูชะงัก กระโดดต่อ +2 พร้อมสายฟ้าแตกแขนงบนพื้น",
    icon: (c, s) => drawLightning(c, s, true),
  },
  create: () => new Lightning(lightningDef),
};
