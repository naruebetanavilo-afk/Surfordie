import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { G } from "../core/G";
import type { Proj } from "../combat/Projectiles";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { VFX, col, SPARK_GLOW, SPARK_STAR, SPARK_EMBER, DECAL_VORTEX } from "./vfx";
import { SpriteBatch } from "./vfx/SpriteBatch";
import { spinBlurTex } from "./vfx/textures";
import { weaponToonRamp, paint, prep } from "./vfx/toon";
import { levelLines } from "./util";
import { evolvedFrame, glow, star4, INK } from "./iconkit";

/**
 * ขวานบูมเมอแรง (Boomerang Axe) — spinning axes fly out towards the nearest
 * enemy, decelerate, then home back to the hero. They pierce everything and
 * can hit the same enemy again on the way back.
 * Evolved (ขวานพายุคลั่ง): +2 huge blazing axes that stop at the apex and
 * whirl in place as a mini tornado, dragging enemies in, before returning.
 */
const LV = [
  { n: 1, dmg: 16, range: 5.5, cd: 1.5, size: 1.0 },
  { n: 1, dmg: 22, range: 5.5, cd: 1.5, size: 1.0 },
  { n: 2, dmg: 22, range: 6.0, cd: 1.45, size: 1.0 },
  { n: 2, dmg: 28, range: 6.0, cd: 1.4, size: 1.15 },
  { n: 3, dmg: 28, range: 6.5, cd: 1.35, size: 1.15 },
  { n: 3, dmg: 36, range: 6.5, cd: 1.3, size: 1.3 },
  { n: 4, dmg: 36, range: 7.0, cd: 1.25, size: 1.3 },
  { n: 4, dmg: 48, range: 7.5, cd: 1.2, size: 1.4 },
];

const SPIN = 15;

type AxeState = {
  phase: number;
  decel: number;
  ret: number;
  vmax: number;
  whirl: number;
  pullT: number;
  size: number;
};

function axeGeometry(evolved: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // handle + grip wrap + pommel
  parts.push(prep(paint(new THREE.BoxGeometry(0.1, 0.08, 1.05).translate(0, 0, -0.12), evolved ? "#3a2210" : "#8a5a2b")));
  parts.push(prep(paint(new THREE.BoxGeometry(0.13, 0.1, 0.26).translate(0, 0, -0.48), evolved ? "#ffc21f" : "#c0392b")));
  parts.push(prep(paint(new THREE.BoxGeometry(0.15, 0.11, 0.08).translate(0, 0, -0.65), evolved ? "#ffc21f" : "#5a3a1a")));
  // double-bit head (shape in XY, extruded, laid flat)
  const sh = new THREE.Shape();
  sh.moveTo(0.08, 0.1);
  sh.lineTo(0.3, 0.3);
  sh.quadraticCurveTo(0.72, 0, 0.3, -0.3);
  sh.lineTo(0.08, -0.1);
  sh.lineTo(-0.08, -0.1);
  sh.lineTo(-0.3, -0.3);
  sh.quadraticCurveTo(-0.72, 0, -0.3, 0.3);
  sh.lineTo(-0.08, 0.1);
  sh.closePath();
  const head = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 6 });
  head.translate(0, 0, -0.025);
  head.rotateX(-Math.PI / 2);
  head.translate(0, 0, 0.36);
  // steel with bright cutting edges
  const hp = prep(head);
  const pos = hp.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const steel = new THREE.Color(evolved ? "#e8401a" : "#aeb9c8");
  const edge = new THREE.Color(evolved ? "#ffe066" : "#ffffff");
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(pos.getX(i));
    tmp.copy(steel).lerp(edge, Math.min(1, Math.max(0, (ax - 0.32) / 0.25)));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  hp.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  parts.push(hp);
  // socket
  parts.push(prep(paint(new THREE.BoxGeometry(0.2, 0.13, 0.26).translate(0, 0, 0.36), evolved ? "#2a1a14" : "#4a5262")));
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

function ensureKinds(): void {
  if (G.projectiles.hasKind("axe")) return;
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: weaponToonRamp(), emissive: new THREE.Color("#2a2620") });
  G.projectiles.registerKind("axe", { geometry: axeGeometry(false), material: mat, spin: SPIN, capacity: 64 });
  const evMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: weaponToonRamp(), emissive: new THREE.Color("#7a2000") });
  G.projectiles.registerKind("axeStorm", { geometry: axeGeometry(true), material: evMat, spin: SPIN * 1.3, capacity: 64 });
}

interface Pending {
  t: number;
  a: number;
}

class Axe extends Weapon {
  private pending: Pending[] = [];
  private flying: { p: Proj; st: AxeState }[] = [];
  private blur: SpriteBatch | null = null;
  private pullX = 0;
  private pullZ = 0;
  private readonly pullCb = (i: number): void => {
    const em = G.enemies;
    em.knock(i, this.pullX - em.x[i], this.pullZ - em.z[i], 3.5);
  };

  constructor(def: WeaponDef) {
    super(def);
    this.timer = 0.3;
  }

  private blurBatch(): SpriteBatch {
    if (!this.blur) {
      this.blur = new SpriteBatch(G.world.scene, spinBlurTex(), 64, { facing: "ground", additive: true, renderOrder: 7 });
    }
    return this.blur;
  }

  update(dt: number): void {
    ensureKinds();
    const L = LV[this.level - 1];
    const p = G.player;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.cd(L.cd);
      let base = Math.atan2(p.faceZ, p.faceX);
      const t = G.enemies.nearest(p.x, p.z, 10);
      if (t >= 0) base = Math.atan2(G.enemies.z[t] - p.z, G.enemies.x[t] - p.x);
      const n = this.amount(L.n) + (this.evolved ? 2 : 0);
      const step = n > 6 ? (Math.PI * 2) / n : 0.42;
      for (let k = 0; k < n; k++) this.pending.push({ t: k * 0.07, a: base + (k - (n - 1) / 2) * step });
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const q = this.pending[i];
      q.t -= dt;
      if (q.t > 0) continue;
      this.pending.splice(i, 1);
      this.throwAxe(L, q.a);
    }
    this.updateFlying(dt);
  }

  private throwAxe(L: (typeof LV)[number], a: number): void {
    const p = G.player;
    const ev = this.evolved;
    const size = L.size * this.area(1) * (ev ? 1.25 : 1);
    const v0 = this.projSpeed(15);
    const range = L.range * (0.6 + 0.4 * this.area(1));
    const st: AxeState = {
      phase: 0,
      decel: (v0 * v0) / (2 * range),
      ret: 0,
      vmax: v0 * 1.15,
      whirl: 0,
      pullT: 0,
      size,
    };
    const pr = G.projectiles.spawn({
      kind: ev ? "axeStorm" : "axe",
      x: p.x + Math.cos(a) * 0.5,
      z: p.z + Math.sin(a) * 0.5,
      y: 0.75,
      vx: Math.cos(a) * v0,
      vz: Math.sin(a) * v0,
      damage: L.dmg * (ev ? 1.5 : 1),
      radius: 0.6 * size,
      life: 6,
      pierce: Infinity,
      rehit: ev ? 0.3 : 0.45,
      source: this.def.id,
      kb: 3.5,
      scale: size,
      data: st,
      update: (pp, d) => this.move(pp, st, d),
      onHit: (pp) => {
        if (Math.random() < 0.5) VFX.sparkles.spawn(pp.x, 0.9, pp.z, 0, 1, 0, 0.28, 0.6 * st.size, col("#ffffff"), SPARK_STAR, 0, 0, 4);
      },
    });
    if (pr) this.flying.push({ p: pr, st });
    G.audio.sfx("throw", { vol: 0.6, pitch: 0.9 + Math.random() * 0.2 });
  }

  /** custom motion: decelerate out → (evolved: whirl) → accelerate home */
  private move(p: Proj, st: AxeState, dt: number): boolean {
    if (st.phase === 0) {
      const sp = Math.hypot(p.vx, p.vz);
      const ns = sp - st.decel * dt;
      if (ns <= 0.8) {
        st.phase = this.evolved ? 1 : 2;
        p.vx *= 0.05;
        p.vz *= 0.05;
        if (st.phase === 1) {
          VFX.decals.spawn(p.x, p.z, 1.6 * st.size, 0.6, col("#ff7a3c"), DECAL_VORTEX, 0.9, 9, 0.5, 0.3);
        }
      } else {
        const k = ns / sp;
        p.vx *= k;
        p.vz *= k;
      }
    } else if (st.phase === 1) {
      st.whirl += dt;
      st.pullT -= dt;
      if (st.pullT <= 0) {
        st.pullT = 0.1;
        this.pullX = p.x;
        this.pullZ = p.z;
        G.enemies.queryCircle(p.x, p.z, 2.4 * st.size, this.pullCb);
        const a = Math.random() * Math.PI * 2;
        const r = 1.6 * st.size;
        VFX.sparkles.spawn(p.x + Math.cos(a) * r, 0.4, p.z + Math.sin(a) * r, -Math.sin(a) * 6 - Math.cos(a) * 3, 2, Math.cos(a) * 6 - Math.sin(a) * 3, 0.45, 0.5, col("#ff9a3c"), SPARK_EMBER, 0, 2);
      }
      if (st.whirl >= this.duration(0.55)) st.phase = 2;
    } else {
      const pl = G.player;
      const dx = pl.x - p.x;
      const dz = pl.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      st.ret = Math.min(st.vmax, st.ret + st.decel * 1.4 * dt);
      p.vx = (dx / d) * st.ret;
      p.vz = (dz / d) * st.ret;
      if (d < 0.7 + st.ret * dt) {
        p.alive = false;
        VFX.sparkles.burst(pl.x, 0.9, pl.z, 3, 2.5, 1.5, 0.25, 0.5, col(this.evolved ? "#ffb35a" : "#e8f0ff"), SPARK_GLOW, 0, 3);
        return true;
      }
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    return true;
  }

  private updateFlying(dt: number): void {
    const b = this.blurBatch();
    b.begin();
    const ev = this.evolved;
    const tint = col(ev ? "#ff8a3c" : "#dfe8ff");
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      const p = f.p;
      // pooled projectiles get recycled: make sure it is still our axe
      if (!p.alive || p.data !== f.st) {
        this.flying.splice(i, 1);
        continue;
      }
      const s = f.st.size;
      b.add(p.x, 0.72, p.z, 1.9 * s, tint, ev ? 0.8 : 0.45, -p.rot);
      if (ev) {
        if (Math.random() < dt * 40) {
          VFX.sparkles.spawn(p.x + (Math.random() - 0.5) * s, 0.7, p.z + (Math.random() - 0.5) * s, 0, 1.5, 0, 0.4, 0.55, col(Math.random() < 0.5 ? "#ff7a2a" : "#ffd23f"), SPARK_EMBER, 1, 1);
        }
      } else if (Math.random() < dt * 6) {
        VFX.sparkles.spawn(p.x, 0.9, p.z, 0, 0.5, 0, 0.25, 0.45, col("#ffffff"), SPARK_STAR, 0, 0, 5);
      }
    }
    b.end();
  }

  onEvolve(): void {
    this.timer = 0.05;
  }

  dispose(): void {
    super.dispose();
    for (const f of this.flying) if (f.p.alive && f.p.data === f.st) f.p.alive = false;
    this.flying.length = 0;
    this.pending.length = 0;
    this.blur?.dispose();
    this.blur = null;
  }
}

function drawAxe(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  iconBg(c, s, evolved ? "#ff7a3c" : "#e8b23a", evolved ? "#24140f" : "#1b1f2a");
  // spin trail
  c.save();
  c.translate(s * 0.5, s * 0.5);
  c.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    c.strokeStyle = evolved ? `rgba(255,${140 + k * 30},60,${0.75 - k * 0.2})` : `rgba(255,236,190,${0.6 - k * 0.15})`;
    c.lineWidth = s * (0.05 - k * 0.012);
    c.beginPath();
    c.arc(0, 0, s * (0.36 - k * 0.04), Math.PI * (0.65 + k * 0.08), Math.PI * (1.35 + k * 0.05));
    c.stroke();
  }
  c.restore();
  if (evolved) glow(c, s * 0.5, s * 0.5, s * 0.34, "rgba(255,110,40,0.65)");
  c.save();
  c.translate(s * 0.52, s * 0.52);
  c.rotate(-Math.PI / 5);
  c.lineWidth = s * 0.035;
  c.strokeStyle = INK;
  // handle
  c.fillStyle = "#8a5a2b";
  c.beginPath();
  c.roundRect(-s * 0.035, -s * 0.26, s * 0.07, s * 0.6, s * 0.03);
  c.fill();
  c.stroke();
  c.fillStyle = evolved ? "#ffd23f" : "#c0392b";
  c.fillRect(-s * 0.04, s * 0.16, s * 0.08, s * 0.1);
  // double-bit head
  const g = c.createLinearGradient(-s * 0.3, 0, s * 0.3, 0);
  const steel = evolved ? "#ff6a3c" : "#aeb9c8";
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.3, steel);
  g.addColorStop(0.7, steel);
  g.addColorStop(1, "#ffffff");
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(s * 0.05, -s * 0.24);
  c.lineTo(s * 0.18, -s * 0.34);
  c.quadraticCurveTo(s * 0.4, -s * 0.2, s * 0.18, -s * 0.04);
  c.lineTo(s * 0.05, -s * 0.14);
  c.lineTo(-s * 0.05, -s * 0.14);
  c.lineTo(-s * 0.18, -s * 0.04);
  c.quadraticCurveTo(-s * 0.4, -s * 0.2, -s * 0.18, -s * 0.34);
  c.lineTo(-s * 0.05, -s * 0.24);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
  star4(c, s * 0.8, s * 0.24, s * 0.06);
  if (evolved) {
    star4(c, s * 0.22, s * 0.78, s * 0.05, "#ffd9a8");
    evolvedFrame(c, s);
  }
}

export const axeDef: WeaponDef = {
  id: "axe",
  name: "ขวานบูมเมอแรง",
  maxLevel: 8,
  color: "#e8b23a",
  icon: (c, s) => drawAxe(c, s, false),
  describe: (l) =>
    [
      "ขว้างขวานหมุนติ้วที่บินออกไปแล้ววนกลับมา ทะลุศัตรูทุกตัว ฟันซ้ำได้ขากลับ",
      "ดาเมจ +38%",
      "ขวาน +1 • บินไกลขึ้น",
      "ดาเมจ +27% • ขวานใหญ่ขึ้น",
      "ขวาน +1 • บินไกลขึ้น",
      "ดาเมจ +29% • ขวานใหญ่ขึ้น",
      "ขวาน +1 • บินไกลขึ้น",
      "ดาเมจ +33% • ขว้างถี่ขึ้น",
    ][l - 1] ?? "",
  lines: (l) =>
    levelLines(
      LV,
      l,
      [
        { key: "n", label: "ขวาน", kind: "add" },
        { key: "dmg", label: "ดาเมจ", kind: "pct" },
        { key: "range", label: "ระยะ", kind: "pct" },
        { key: "size", label: "ขนาด", kind: "pct" },
        { key: "cd", label: "สปีดโจมตี", kind: "cd" },
      ],
      ["ดาเมจ " + LV[0].dmg, "ทะลุทุกตัว"],
    ),
  evolution: {
    requires: "armor",
    name: "ขวานพายุคลั่ง",
    describe: "ขวานลุกเป็นไฟ +2 เล่ม ใหญ่ขึ้น ดาเมจ +50% หยุดหมุนเป็นพายุหมุนที่ปลายทางดูดศัตรูเข้ามาบด ก่อนบินกลับ",
    icon: (c, s) => drawAxe(c, s, true),
  },
  create: () => new Axe(axeDef),
};
