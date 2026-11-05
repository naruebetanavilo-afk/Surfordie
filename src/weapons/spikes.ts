import * as THREE from "three";
import { G } from "../core/G";
import { hitEnemy } from "../combat/damage";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { VFX, col, SPARK_EMBER, DECAL_SCORCH, DECAL_GLOW, DECAL_CRACK } from "./vfx";
import { weaponToonRamp } from "./vfx/toon";
import { levelLines, easeOutBack } from "./util";
import { evolvedFrame, glow, INK } from "./iconkit";

/**
 * หนามเงามรณะ (Shadow Thorns) — dark violet thorns burst out of the ground in
 * radial lines from the hero, racing outward. Each thorn stabs whatever stands
 * on it (once per volley) and slows it. Evolved (ป่าหนามนรก): giant crimson
 * thorns, plus three concentric rings that erupt after the lines and root
 * enemies in place.
 */
const LV = [
  { lines: 4, dmg: 14, range: 3.2, cd: 2.2, slow: 0.6 },
  { lines: 5, dmg: 14, range: 3.2, cd: 2.2, slow: 0.6 },
  { lines: 5, dmg: 19, range: 3.6, cd: 2.1, slow: 0.55 },
  { lines: 6, dmg: 19, range: 3.6, cd: 2.0, slow: 0.55 },
  { lines: 7, dmg: 25, range: 4.0, cd: 1.9, slow: 0.5 },
  { lines: 7, dmg: 25, range: 4.4, cd: 1.8, slow: 0.5 },
  { lines: 8, dmg: 36, range: 4.8, cd: 1.7, slow: 0.45 },
  { lines: 9, dmg: 48, range: 5.2, cd: 1.6, slow: 0.4 },
];

const MAX_SPIKES = 720;
/** thorn timeline (seconds after eruption) */
const RISE = 0.08;
const HOLD = 0.34;
const END = 0.62;

const VIOLET = "#7a3cff";
const SHADOW = "#1c0830";
const TIP = "#d9b0ff";
const EV_TINT = "#ff5a8a";

/** curved, tapered thorn (≈1.7 tall, bends towards +Z) with a dark-to-glowing gradient */
function thornGeometry(): THREE.BufferGeometry {
  const SEG = 7;
  const SIDES = 6;
  const H = 1.7;
  const BEND = 0.6;
  const R0 = 0.3;
  const pos: number[] = [];
  const colr: number[] = [];
  const idx: number[] = [];
  const stops = [
    { t: 0, c: new THREE.Color("#12051f") },
    { t: 0.45, c: new THREE.Color("#3e1680") },
    { t: 0.8, c: new THREE.Color("#8f4dff") },
    { t: 1, c: new THREE.Color("#f3d6ff") },
  ];
  const tmp = new THREE.Color();
  const grad = (t: number): THREE.Color => {
    for (let k = 1; k < stops.length; k++) {
      if (t <= stops[k].t) {
        const a = stops[k - 1];
        const b = stops[k];
        return tmp.copy(a.c).lerp(b.c, (t - a.t) / (b.t - a.t));
      }
    }
    return tmp.copy(stops[stops.length - 1].c);
  };
  for (let j = 0; j < SEG; j++) {
    const t = j / SEG;
    const cy = t * H;
    const cz = BEND * t * t;
    const r = R0 * Math.pow(1 - t, 1.1) + 0.01;
    const c = grad(t);
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2;
      pos.push(Math.cos(a) * r, cy - Math.sin(a) * r * 0.25 * t, cz + Math.sin(a) * r);
      colr.push(c.r, c.g, c.b);
    }
  }
  // tip
  const tipI = SEG * SIDES;
  pos.push(0, H, BEND);
  const tc = grad(1);
  colr.push(tc.r, tc.g, tc.b);
  for (let j = 0; j < SEG - 1; j++) {
    for (let i = 0; i < SIDES; i++) {
      const a = j * SIDES + i;
      const b = j * SIDES + ((i + 1) % SIDES);
      const c = a + SIDES;
      const d = b + SIDES;
      idx.push(a, c, b, b, c, d);
    }
  }
  const last = (SEG - 1) * SIDES;
  for (let i = 0; i < SIDES; i++) idx.push(last + i, tipI, last + ((i + 1) % SIDES));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

class Spikes extends Weapon {
  private mesh: THREE.InstancedMesh | null = null;
  // struct-of-arrays thorn pool
  private n = 0;
  private sx = new Float32Array(MAX_SPIKES);
  private sz = new Float32Array(MAX_SPIKES);
  private yaw = new Float32Array(MAX_SPIKES);
  private tilt = new Float32Array(MAX_SPIKES);
  private age = new Float32Array(MAX_SPIKES);
  private size = new Float32Array(MAX_SPIKES);
  private vol = new Int32Array(MAX_SPIKES);
  private erupted = new Uint8Array(MAX_SPIKES);
  private ring = new Uint8Array(MAX_SPIKES);
  private volley = 0;
  private volleyDmg = 0;
  private volleySlow = 0.6;
  /** uid → last volley that hit it (each thorn wave hits an enemy once) */
  private hitVol = new Map<number, number>();
  private curVol = 0;
  private curDmg = 0;
  private curRoot = false;
  private readonly hitCb = (i: number): void => {
    const em = G.enemies;
    const uid = em.uid[i];
    if (this.hitVol.get(uid) === this.curVol) return;
    this.hitVol.set(uid, this.curVol);
    const p = G.player;
    hitEnemy(i, this.curDmg, this.def.id, {
      kb: 2.5,
      fromX: p.x,
      fromZ: p.z,
      slow: this.volleySlow,
      slowTime: 1.3,
      freeze: this.curRoot ? 0.4 : undefined,
    });
  };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, "YXZ");
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private white = new THREE.Color(1, 1, 1);
  private evTint = new THREE.Color(EV_TINT).lerp(new THREE.Color(1, 1, 1), 0.35);
  private sfxT = 0;

  private ensureMesh(): THREE.InstancedMesh {
    if (this.mesh) return this.mesh;
    const mat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: weaponToonRamp(),
      emissive: new THREE.Color("#2a0a52"),
    });
    const mesh = new THREE.InstancedMesh(thornGeometry(), mat, MAX_SPIKES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_SPIKES; i++) mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    G.world.scene.add(mesh);
    this.mesh = mesh;
    return mesh;
  }

  private add(x: number, z: number, yaw: number, size: number, delay: number, ring: boolean): void {
    if (this.n >= MAX_SPIKES) return;
    const k = this.n++;
    this.sx[k] = x;
    this.sz[k] = z;
    this.yaw[k] = yaw;
    this.tilt[k] = 0.25 + Math.random() * 0.25;
    this.age[k] = -delay;
    this.size[k] = size;
    this.vol[k] = this.volley;
    this.erupted[k] = 0;
    this.ring[k] = ring ? 1 : 0;
  }

  private fire(L: (typeof LV)[number]): void {
    const p = G.player;
    this.volley++;
    this.volleyDmg = L.dmg * (this.evolved ? 1.5 : 1);
    this.volleySlow = L.slow;
    const lines = this.amount(L.lines);
    const range = this.area(L.range);
    const sz = Math.sqrt(G.player.stats.area) * (this.evolved ? 1.3 : 1);
    const spacing = 0.78 * sz;
    const per = Math.max(2, Math.ceil((range - 0.9) / spacing) + 1);
    // rotate the pattern every volley (golden angle) so gaps get covered
    const a0 = this.volley * 2.39996;
    for (let i = 0; i < lines; i++) {
      const base = a0 + (i / lines) * Math.PI * 2;
      for (let j = 0; j < per; j++) {
        const a = base + (Math.random() - 0.5) * 0.14;
        const d = 0.9 + j * spacing;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const s = sz * (1.15 - 0.3 * (j / per)) * (0.85 + Math.random() * 0.25);
        this.add(p.x + dx * d, p.z + dz * d, Math.atan2(dx, dz), s, j * 0.042 + i * 0.006, false);
      }
    }
    if (this.evolved) {
      // three concentric rings erupt once the lines have run out
      for (let k = 1; k <= 3; k++) {
        const R = range * (0.3 + 0.7 * (k / 3));
        const cnt = Math.floor((Math.PI * 2 * R) / (0.95 * sz));
        const off = Math.random() * Math.PI * 2;
        for (let i = 0; i < cnt; i++) {
          const a = off + (i / cnt) * Math.PI * 2;
          const dx = Math.cos(a);
          const dz = Math.sin(a);
          this.add(p.x + dx * R, p.z + dz * R, Math.atan2(dx, dz), sz * (1.05 + Math.random() * 0.2), 0.3 + k * 0.11, true);
        }
      }
    }
    VFX.dark.spawn(p.x, p.z, 1.6 * sz, 0.9, col(SHADOW), DECAL_SCORCH, 0.65, 0, 0.3, 0.2);
    VFX.decals.spawn(p.x, p.z, 1.8 * sz, 0.4, col(this.evolved ? EV_TINT : VIOLET), DECAL_CRACK, 0.9, 0, 0.4, 0.2);
    G.audio.sfx("spike", { vol: 0.8 });
  }

  update(dt: number): void {
    const L = LV[this.level - 1];
    this.timer -= dt;
    this.sfxT -= dt;
    if (this.timer <= 0) {
      this.timer = this.cd(L.cd);
      this.fire(L);
    }
    const mesh = this.ensureMesh();
    const sp = VFX.sparkles;
    const violet = col(VIOLET);
    const tip = col(this.evolved ? "#ffb3c8" : TIP);
    const shadow = col(SHADOW);
    let w = 0;
    for (let k = 0; k < this.n; k++) {
      this.age[k] += dt;
      const t = this.age[k];
      if (t >= END) continue; // dropped by compaction below
      if (t >= 0 && !this.erupted[k]) {
        this.erupted[k] = 1;
        const x = this.sx[k];
        const z = this.sz[k];
        const s = this.size[k];
        this.curVol = this.vol[k];
        this.curDmg = this.volleyDmg;
        this.curRoot = this.evolved && this.ring[k] === 1;
        G.enemies.queryCircle(x, z, 0.5 * s, this.hitCb);
        if ((k & 1) === 0) VFX.dark.spawn(x, z, 0.6 * s, 1.1, shadow, DECAL_SCORCH, 0.55, 0, 0.5, 0.15);
        if ((k & 3) === 0) VFX.decals.spawn(x, z, 0.75 * s, 0.3, violet, DECAL_GLOW, 0.8, 0, 0.6, 0.2);
        sp.spawn(x, 0.3, z, (Math.random() - 0.5) * 1.5, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.45, 0.4 * s, Math.random() < 0.6 ? violet : tip, SPARK_EMBER, -3, 1);
        if ((k & 7) === 0) {
          G.fx.burst(x, 0.2, z, { count: 3, color: "#2b1a12", speed: 2.5, life: 0.4, size: 0.18, gravity: -12, up: 4, additive: false });
        }
        if (this.sfxT <= 0 && this.ring[k]) {
          G.audio.sfx("spike", { vol: 0.5, pitch: 1.2 });
          this.sfxT = 0.12;
        }
      }
      // keep (compact in place)
      if (w !== k) {
        this.sx[w] = this.sx[k];
        this.sz[w] = this.sz[k];
        this.yaw[w] = this.yaw[k];
        this.tilt[w] = this.tilt[k];
        this.age[w] = this.age[k];
        this.size[w] = this.size[k];
        this.vol[w] = this.vol[k];
        this.erupted[w] = this.erupted[k];
        this.ring[w] = this.ring[k];
      }
      w++;
    }
    this.n = w;
    // render
    let count = 0;
    const ev = this.evolved;
    for (let k = 0; k < this.n; k++) {
      const t = this.age[k];
      if (t < 0) continue;
      let h: number;
      if (t < RISE) h = easeOutBack(t / RISE, 2.2);
      else if (t < HOLD) h = 1 + 0.04 * Math.sin((t - RISE) * 30) * (1 - (t - RISE) / (HOLD - RISE));
      else {
        const u = (t - HOLD) / (END - HOLD);
        h = 1 - u * u;
      }
      const s = this.size[k];
      const sinkY = t > HOLD ? -((t - HOLD) / (END - HOLD)) * 0.9 * s : 0;
      this.e.set(this.tilt[k], this.yaw[k], 0);
      this.q.setFromEuler(this.e);
      this.v.set(this.sx[k], sinkY - 0.05, this.sz[k]);
      const wdt = s * (0.65 + 0.35 * Math.min(1, h));
      this.s.set(wdt, Math.max(0.02, h) * s, wdt);
      this.m.compose(this.v, this.q, this.s);
      mesh.setMatrixAt(count, this.m);
      mesh.setColorAt(count, ev ? this.evTint : this.white);
      count++;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (this.hitVol.size > 4000) this.hitVol.clear();
  }

  onEvolve(): void {
    this.timer = 0.05;
  }

  dispose(): void {
    super.dispose();
    if (this.mesh) {
      G.world.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.dispose();
      this.mesh = null;
    }
    this.n = 0;
  }
}

function drawThorns(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  iconBg(c, s, evolved ? "#ff4f8a" : "#7a3cff", evolved ? "#1f0d1c" : "#1b1f2a");
  glow(c, s * 0.5, s * 0.72, s * 0.34, evolved ? "rgba(255,80,140,0.75)" : "rgba(140,70,255,0.75)");
  // shadow pool
  c.save();
  c.fillStyle = "#12051f";
  c.beginPath();
  c.ellipse(s * 0.5, s * 0.78, s * 0.34, s * 0.09, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  const thorn = (x: number, h: number, lean: number, w: number) => {
    const g = c.createLinearGradient(x, s * 0.78, x + lean, s * 0.78 - h);
    g.addColorStop(0, "#1a0730");
    g.addColorStop(0.55, evolved ? "#a3164f" : "#5521b5");
    g.addColorStop(1, evolved ? "#ffc2d8" : "#e6c7ff");
    c.save();
    c.fillStyle = g;
    c.strokeStyle = INK;
    c.lineWidth = s * 0.035;
    c.beginPath();
    c.moveTo(x - w, s * 0.79);
    c.quadraticCurveTo(x - w * 0.6, s * 0.78 - h * 0.55, x + lean, s * 0.78 - h);
    c.quadraticCurveTo(x + w * 0.4, s * 0.78 - h * 0.5, x + w, s * 0.79);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  };
  thorn(s * 0.27, s * 0.38, -s * 0.1, s * 0.07);
  thorn(s * 0.73, s * 0.42, s * 0.1, s * 0.07);
  thorn(s * 0.5, s * 0.6, s * 0.04, s * 0.1);
  if (evolved) {
    thorn(s * 0.38, s * 0.3, -s * 0.04, s * 0.05);
    thorn(s * 0.62, s * 0.32, s * 0.05, s * 0.05);
    evolvedFrame(c, s);
  }
}

export const spikesDef: WeaponDef = {
  id: "spikes",
  name: "หนามเงามรณะ",
  maxLevel: 8,
  color: "#9a5cff",
  icon: (c, s) => drawThorns(c, s, false),
  describe: (l) =>
    [
      "หนามเงาพุ่งขึ้นจากพื้นเป็นแนวรัศมีรอบตัว แทงศัตรูและทำให้ช้าลง",
      "แนวหนาม +1",
      "ดาเมจ +36% • ระยะ +13% • ช้าลงมากขึ้น",
      "แนวหนาม +1 • ปะทุถี่ขึ้น",
      "แนวหนาม +1 • ดาเมจ +32% • ระยะเพิ่ม",
      "ระยะ +10% • ปะทุถี่ขึ้น",
      "แนวหนาม +1 • ดาเมจ +44%",
      "แนวหนาม +1 • ดาเมจ +33% • ระยะเพิ่ม",
    ][l - 1] ?? "",
  lines: (l) =>
    levelLines(
      LV,
      l,
      [
        { key: "lines", label: "แนวหนาม", kind: "add" },
        { key: "dmg", label: "ดาเมจ", kind: "pct" },
        { key: "range", label: "ระยะ", kind: "pct" },
        { key: "cd", label: "สปีดโจมตี", kind: "cd" },
      ],
      ["ดาเมจ " + LV[0].dmg, "ทำให้ศัตรูช้าลง"],
    ),
  evolution: {
    requires: "vitality",
    name: "ป่าหนามนรก",
    describe: "หนามยักษ์สีเลือด ดาเมจ +50% ปะทุเพิ่มเป็นวงแหวนซ้อน 3 ชั้น ตรึงศัตรูไว้กับที่ชั่วขณะ",
    icon: (c, s) => drawThorns(c, s, true),
  },
  create: () => new Spikes(spikesDef),
};
