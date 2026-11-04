import { G } from "../core/G";
import { hitCircle } from "../combat/damage";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import {
  VFX,
  col,
  SPARK_GLOW,
  SPARK_STAR,
  SPARK_EMBER,
  DECAL_VORTEX,
  DECAL_SHOCK,
  DECAL_GLOW,
  DECAL_SCORCH,
  DECAL_TARGET,
} from "./vfx";
import { SpriteBatch } from "./vfx/SpriteBatch";
import { softGlowTex } from "./vfx/textures";
import { levelLines } from "./util";
import { evolvedFrame, glow, orb, star4 } from "./iconkit";

/**
 * ระเบิดวิญญาณ (Soul Bomb) — the signature spectacle.
 * Soul orbs arc from the hero onto the densest enemy clusters on screen and
 * detonate in big magenta blasts: energy dome + spinning vortex + shockwave +
 * star sparks. Evolved (พายุวิญญาณ): +2 orbs, every blast leaves a soul
 * vortex that drags enemies in, burns them, then bursts again.
 */
const LV = [
  { n: 1, dmg: 20, r: 2.0, cd: 2.6 },
  { n: 2, dmg: 20, r: 2.0, cd: 2.6 },
  { n: 2, dmg: 28, r: 2.3, cd: 2.5 },
  { n: 3, dmg: 28, r: 2.3, cd: 2.4 },
  { n: 3, dmg: 38, r: 2.6, cd: 2.3 },
  { n: 4, dmg: 38, r: 2.8, cd: 2.2 },
  { n: 4, dmg: 50, r: 3.0, cd: 2.0 },
  { n: 5, dmg: 64, r: 3.2, cd: 1.9 },
];

const MAGENTA = "#c837ff";
const HOT = "#ff3fd2";
const CORE = "#ffd0fa";
const VIOLET = "#ff78e8";
const SCORCH = "#2a0b3a";
const EV_MAIN = "#ff4fd8";
const EV_ACC = "#6ef3ff";

interface Orb {
  active: boolean;
  launched: boolean;
  delay: number;
  t: number;
  T: number;
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  h: number;
  r: number;
  dmg: number;
  size: number;
}

interface Vortex {
  active: boolean;
  x: number;
  z: number;
  r: number;
  t: number;
  life: number;
  tick: number;
  dmg: number;
}

const MAX_ORBS = 32;
const MAX_VORTEX = 16;

class Bomb extends Weapon {
  private orbs: Orb[] = [];
  private vortices: Vortex[] = [];
  private batch: SpriteBatch | null = null;
  private glowBatch: SpriteBatch | null = null;
  private tx = new Float32Array(MAX_ORBS);
  private tz = new Float32Array(MAX_ORBS);
  private cnt = 0;
  private readonly countCb = (): void => {
    this.cnt++;
  };
  private pullX = 0;
  private pullZ = 0;
  private readonly pullCb = (i: number): void => {
    const em = G.enemies;
    em.knock(i, this.pullX - em.x[i], this.pullZ - em.z[i], 5);
  };
  private shakeCd = 0;
  private boomCd = 0;

  constructor(def: WeaponDef) {
    super(def);
    for (let i = 0; i < MAX_ORBS; i++) {
      this.orbs.push({ active: false, launched: false, delay: 0, t: 0, T: 1, sx: 0, sz: 0, ex: 0, ez: 0, h: 1, r: 1, dmg: 0, size: 1 });
    }
    for (let i = 0; i < MAX_VORTEX; i++) {
      this.vortices.push({ active: false, x: 0, z: 0, r: 1, t: 0, life: 1, tick: 0, dmg: 0 });
    }
    // first volley comes quickly after pick-up
    this.timer = 0.6;
  }

  /** alpha-blended halo: keeps the orb a saturated magenta over the bright grass */
  private halos(): SpriteBatch {
    if (!this.glowBatch) {
      this.glowBatch = new SpriteBatch(G.world.scene, softGlowTex(), MAX_ORBS, {
        facing: "camera",
        additive: false,
        depthTest: false,
        renderOrder: 9,
      });
    }
    return this.glowBatch;
  }

  private sprites(): SpriteBatch {
    if (!this.batch) {
      this.batch = new SpriteBatch(G.world.scene, softGlowTex(), 3 * MAX_ORBS, {
        facing: "camera",
        additive: true,
        depthTest: false,
        renderOrder: 10,
      });
    }
    return this.batch;
  }

  update(dt: number): void {
    const L = LV[this.level - 1];
    this.shakeCd -= dt;
    this.boomCd -= dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.cd(L.cd);
      this.volley(L);
    }
    this.updateOrbs(dt);
    if (this.evolved) this.updateVortices(dt);
  }

  private volley(L: (typeof LV)[number]): void {
    const n = Math.min(MAX_ORBS, this.amount(L.n) + (this.evolved ? 2 : 0));
    const r = this.area(L.r);
    const dmg = L.dmg * (this.evolved ? 1.3 : 1);
    this.pickTargets(n, r);
    let k = 0;
    for (const o of this.orbs) {
      if (k >= n) break;
      if (o.active) continue;
      o.active = true;
      o.launched = false;
      o.delay = k * 0.09;
      o.ex = this.tx[k];
      o.ez = this.tz[k];
      o.r = r;
      o.dmg = dmg;
      o.size = 0.75 + 0.25 * (r / 2);
      k++;
    }
  }

  /** choose up to n blast centres on dense, non-overlapping clusters */
  private pickTargets(n: number, r: number): void {
    const em = G.enemies;
    const p = G.player;
    const sep2 = r * 1.25 * (r * 1.25);
    for (let k = 0; k < n; k++) {
      let best = -1e9;
      let bx = 0;
      let bz = 0;
      let found = false;
      for (let s = 0; s < 9; s++) {
        const i = em.randomVisible();
        if (i < 0) break;
        const x = em.x[i];
        const z = em.z[i];
        let pen = 0;
        for (let j = 0; j < k; j++) {
          const dx = this.tx[j] - x;
          const dz = this.tz[j] - z;
          if (dx * dx + dz * dz < sep2) pen += 40;
        }
        this.cnt = 0;
        em.queryCircle(x, z, r, this.countCb);
        const score = this.cnt - pen;
        if (score > best) {
          best = score;
          bx = x;
          bz = z;
          found = true;
        }
      }
      if (!found) {
        const a = Math.random() * Math.PI * 2;
        const d = 2.5 + Math.random() * 4;
        bx = p.x + Math.cos(a) * d;
        bz = p.z + Math.sin(a) * d;
      }
      this.tx[k] = bx;
      this.tz[k] = bz;
    }
  }

  private launch(o: Orb): void {
    const p = G.player;
    o.launched = true;
    o.t = 0;
    o.sx = p.x;
    o.sz = p.z;
    const dist = Math.hypot(o.ex - o.sx, o.ez - o.sz);
    o.T = (0.42 + dist * 0.028) / Math.max(0.5, G.player.stats.projSpeed);
    o.h = 1.6 + dist * 0.2;
    VFX.decals.spawn(o.ex, o.ez, o.r, o.T + 0.05, col(this.evolved ? EV_MAIN : MAGENTA), DECAL_TARGET, 0.8, 1.5, 1, 0.01);
    VFX.sparkles.burst(p.x, 1.2, p.z, 4, 2.5, 2, 0.35, 0.5, col(HOT), SPARK_GLOW, 0, 3);
    G.audio.sfx("throw", { vol: 0.5, pitch: 1.2 });
  }

  private updateOrbs(dt: number): void {
    const b = this.sprites();
    const hb = this.halos();
    b.begin();
    hb.begin();
    const sp = VFX.sparkles;
    const main = col(this.evolved ? EV_MAIN : MAGENTA);
    const accent = col(this.evolved ? EV_ACC : VIOLET);
    for (const o of this.orbs) {
      if (!o.active) continue;
      if (!o.launched) {
        o.delay -= dt;
        if (o.delay > 0) continue;
        this.launch(o);
      }
      o.t += dt;
      const u = Math.min(1, o.t / o.T);
      const x = o.sx + (o.ex - o.sx) * u;
      const z = o.sz + (o.ez - o.sz) * u;
      const y = 1.3 * (1 - u) + 0.35 * u + 4 * o.h * u * (1 - u);
      const pulse = 1 + 0.12 * Math.sin(o.t * 30);
      hb.add(x, y, z, 2.1 * o.size * pulse, main, 1);
      b.add(x, y, z, 1.2 * o.size, accent, 0.7);
      b.add(x, y, z, 0.75 * o.size * pulse, col(CORE), 1);
      // soul trail
      sp.spawn(
        x + (Math.random() - 0.5) * 0.25,
        y + (Math.random() - 0.5) * 0.25,
        z + (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.8,
        0.6,
        (Math.random() - 0.5) * 0.8,
        0.42,
        0.75 * o.size,
        Math.random() < 0.5 ? main : accent,
        SPARK_GLOW,
        0,
        1.5,
      );
      if (Math.random() < dt * 14) {
        sp.spawn(x, y, z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.35, 0.55, col(CORE), SPARK_STAR, -2, 1, 4);
      }
      if (u >= 1) {
        o.active = false;
        this.detonate(o.ex, o.ez, o.r, o.dmg, this.evolved, 1);
      }
    }
    b.end();
    hb.end();
  }

  /** the blast: damage + layered visuals. `power` scales the visuals (secondary blasts use < 1) */
  private detonate(x: number, z: number, r: number, dmg: number, spawnVortex: boolean, power: number): void {
    hitCircle(x, z, r, dmg, this.def.id, { kb: 8 });
    const ev = this.evolved;
    const main = col(ev ? EV_MAIN : MAGENTA);
    const accent = col(ev ? EV_ACC : HOT);
    const sp = VFX.sparkles;
    VFX.domes.spawn(x, z, r * 0.8, 0.5 * power + 0.1, main, 0.9, 0.62, 10);
    VFX.decals.spawn(x, z, r * 1.15, 1.1 * power, accent, DECAL_VORTEX, 1.2, 5, 0.35, 0.2);
    VFX.decals.spawn(x, z, r * 1.4, 0.5, col(CORE), DECAL_SHOCK, 0.9 * power, 0, 0.12, 0.95);
    VFX.decals.spawn(x, z, r * 1.5, 0.4, main, DECAL_GLOW, 0.7 * power, 0, 0.55, 0.15);
    VFX.dark.spawn(x, z, r * 0.8, 2.8, col(SCORCH), DECAL_SCORCH, 0.5, 0, 0.6, 0.08);
    sp.burst(x, 0.6, z, 5 + r * 1.5, r * 2.6, 5, 0.6, 1.0 * power, col("#ffffff"), SPARK_STAR, -7, 2.4, r * 0.7);
    sp.burst(x, 0.4, z, 12 + r * 4, r * 3.4, 2.5, 0.6, 0.6, main, SPARK_GLOW, -3, 2.6, r * 0.5);
    sp.burst(x, 0.2, z, 4 + r, r * 0.9, 3, 0.8, 0.3, col(ev ? EV_ACC : VIOLET), SPARK_EMBER, 1.2, 1.6, r);
    if (this.shakeCd <= 0) {
      G.world.shake(Math.min(0.4, 0.16 + r * 0.03) * power);
      this.shakeCd = 0.22;
    }
    if (this.boomCd <= 0) {
      G.audio.sfx("boom", { vol: 0.75 * power, pitch: 0.85 + Math.random() * 0.3 });
      this.boomCd = 0.07;
    }
    if (spawnVortex) {
      const v = this.vortices.find((q) => !q.active);
      if (v) {
        v.active = true;
        v.x = x;
        v.z = z;
        v.r = r * 1.05;
        v.t = 0;
        v.life = this.duration(1.7);
        v.tick = 0.15;
        v.dmg = dmg * 0.28;
      }
    }
  }

  private updateVortices(dt: number): void {
    const em = G.enemies;
    const sp = VFX.sparkles;
    const acc = col(EV_ACC);
    const main = col(EV_MAIN);
    for (const v of this.vortices) {
      if (!v.active) continue;
      v.t += dt;
      v.tick -= dt;
      // inward-spiralling motes
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        const rr = v.r * (0.8 + Math.random() * 0.4);
        const px = v.x + Math.cos(a) * rr;
        const pz = v.z + Math.sin(a) * rr;
        // tangential + inward velocity
        const tx = -Math.sin(a);
        const tz = Math.cos(a);
        sp.spawn(px, 0.4, pz, (tx * 1.6 - Math.cos(a)) * rr * 1.2, 0.8, (tz * 1.6 - Math.sin(a)) * rr * 1.2, 0.5, 0.45, Math.random() < 0.5 ? acc : main, SPARK_GLOW, 0, 1.5);
      }
      if (v.tick <= 0) {
        v.tick = 0.3;
        this.pullX = v.x;
        this.pullZ = v.z;
        em.queryCircle(v.x, v.z, v.r * 1.4, this.pullCb);
        hitCircle(v.x, v.z, v.r, v.dmg, this.def.id, { kb: 0 });
        VFX.decals.spawn(v.x, v.z, v.r * 1.1, 0.75, acc, DECAL_VORTEX, 0.8, -7, 0.85, 0.2);
      }
      if (v.t >= v.life) {
        v.active = false;
        this.detonate(v.x, v.z, v.r * 0.85, v.dmg * 3, false, 0.75);
      }
    }
  }

  onEvolve(): void {
    // signal the change with an immediate volley
    this.timer = 0.05;
  }

  dispose(): void {
    super.dispose();
    this.batch?.dispose();
    this.batch = null;
    this.glowBatch?.dispose();
    this.glowBatch = null;
    for (const o of this.orbs) o.active = false;
    for (const v of this.vortices) v.active = false;
  }
}

function drawBomb(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  iconBg(c, s, evolved ? "#ff4fd8" : "#c94dff", evolved ? "#1d1030" : "#1b1f2a");
  const cx = s * 0.52;
  const cy = s * 0.54;
  // swirling soul trail
  c.save();
  c.translate(cx, cy);
  c.lineCap = "round";
  const arcs = evolved ? 4 : 3;
  for (let k = 0; k < arcs; k++) {
    const rr = s * (0.2 + k * 0.065);
    const a0 = -Math.PI * 0.15 + k * 0.9;
    c.strokeStyle = k % 2 === 0 ? (evolved ? "#7af7ff" : "#ff8af0") : "#a34dff";
    c.globalAlpha = 0.9 - k * 0.15;
    c.lineWidth = s * (0.055 - k * 0.008);
    c.beginPath();
    c.arc(0, 0, rr, a0, a0 + Math.PI * 1.1);
    c.stroke();
  }
  c.restore();
  glow(c, cx, cy, s * 0.36, evolved ? "rgba(255,90,220,0.9)" : "rgba(214,77,255,0.9)");
  orb(c, cx, cy, s * 0.17, evolved ? "#ff9cf0" : "#f0a0ff", evolved ? "#b0179e" : "#7a1fd6");
  star4(c, s * 0.25, s * 0.28, s * 0.075);
  star4(c, s * 0.78, s * 0.3, s * 0.05);
  star4(c, s * 0.74, s * 0.8, s * 0.06, evolved ? "#bffaff" : "#ffd6fb");
  if (evolved) {
    star4(c, s * 0.3, s * 0.78, s * 0.05, "#bffaff");
    evolvedFrame(c, s);
  }
}

export const bombDef: WeaponDef = {
  id: "bomb",
  name: "ระเบิดวิญญาณ",
  maxLevel: 8,
  color: "#d14dff",
  icon: (c, s) => drawBomb(c, s, false),
  describe: (l) =>
    [
      "ปล่อยลูกวิญญาณโค้งลอยไปตกใส่กลุ่มศัตรูที่หนาแน่นที่สุด แล้วระเบิดเป็นวงกว้าง",
      "ลูกวิญญาณ +1",
      "ดาเมจ +40% • รัศมีระเบิด +15%",
      "ลูกวิญญาณ +1 • ยิงถี่ขึ้น",
      "ดาเมจ +36% • รัศมีระเบิด +13%",
      "ลูกวิญญาณ +1 • รัศมีระเบิดเพิ่ม",
      "ดาเมจ +32% • ยิงถี่ขึ้น",
      "ลูกวิญญาณ +1 • ดาเมจ +28% • รัศมีเพิ่ม",
    ][l - 1] ?? "",
  lines: (l) =>
    levelLines(
      LV,
      l,
      [
        { key: "n", label: "ลูกวิญญาณ", kind: "add" },
        { key: "dmg", label: "ดาเมจ", kind: "pct" },
        { key: "r", label: "ขอบเขต", kind: "pct" },
        { key: "cd", label: "สปีดโจมตี", kind: "cd" },
      ],
      ["ดาเมจ " + LV[0].dmg, "ระเบิดวงกว้าง"],
    ),
  evolution: {
    requires: "area",
    name: "พายุวิญญาณ",
    describe: "ลูกวิญญาณ +2 ดาเมจ +30% ทุกการระเบิดทิ้งวังวนวิญญาณที่ดูดศัตรูเข้าหา เผาผลาญต่อเนื่อง แล้วระเบิดซ้ำอีกครั้ง",
    icon: (c, s) => drawBomb(c, s, true),
  },
  create: () => new Bomb(bombDef),
};
