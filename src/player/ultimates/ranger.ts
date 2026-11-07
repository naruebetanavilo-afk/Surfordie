import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { G } from "../../core/G";
import type { Proj } from "../../combat/Projectiles";
import { VFX, col, SPARK_GLOW, SPARK_STAR, SPARK_EMBER, DECAL_SHOCK, DECAL_VORTEX } from "../../weapons/vfx";
import { SpriteBatch } from "../../weapons/vfx/SpriteBatch";
import { spinBlurTex } from "../../weapons/vfx/textures";
import { iconBg } from "../../ui/icons";
import type { UltCast, UltEffect, UltimateDef } from "./types";

/**
 * ระบำพายุขวาน (Axe Tempest Dance) — the ranger spins into a whirlwind and
 * for ~4 s flings a stream of glowing spirit axes that spiral out from the
 * hero in rotating arms, piercing everything (each axe can re-hit). It ends
 * with a ring of axes hurled outward at once.
 */

const GOLD = "#ffbf2e";
const HOT = "#fff1c4";
const ORANGE = "#ff8a3c";
const KIND = "sfdUltAxe";

/** seconds of axe stream (x duration stat) */
const STREAM = 3.8;
/** seconds between two volleys (one axe per arm) */
const VOLLEY_DT = 0.09;
/** spiral rotation speed (rad/s) */
const ARM_SPIN = 5.2;
/** axe flight */
const SPEED = 10.5;
const TURN = 1.9;
const LIFE = 1.15;
const FINALE_N = 18;

type AxeData = { token: number; turn: number; size: number };

function axeGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry => {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const strip = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "color") g.deleteAttribute(k);
    return g;
  };
  const parts: THREE.BufferGeometry[] = [];
  parts.push(strip(paint(new THREE.BoxGeometry(0.1, 0.08, 1.0).translate(0, 0, -0.1), "#c77a2c")));
  parts.push(strip(paint(new THREE.BoxGeometry(0.14, 0.1, 0.12).translate(0, 0, -0.6), ORANGE)));
  // double-bit crescent head, laid flat
  const sh = new THREE.Shape();
  sh.moveTo(0.08, 0.1);
  sh.lineTo(0.3, 0.32);
  sh.quadraticCurveTo(0.78, 0, 0.3, -0.32);
  sh.lineTo(0.08, -0.1);
  sh.lineTo(-0.08, -0.1);
  sh.lineTo(-0.3, -0.32);
  sh.quadraticCurveTo(-0.78, 0, -0.3, 0.32);
  sh.lineTo(-0.08, 0.1);
  sh.closePath();
  const head = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false, curveSegments: 6 });
  head.translate(0, 0, -0.025);
  head.rotateX(-Math.PI / 2);
  head.translate(0, 0, 0.36);
  const hp = head.index ? head.toNonIndexed() : head;
  const pos = hp.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const mid = new THREE.Color("#ffb21f");
  const edge = new THREE.Color("#fff8e0");
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(pos.getX(i));
    tmp.copy(mid).lerp(edge, Math.min(1, Math.max(0, (ax - 0.25) / 0.3)));
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  hp.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  parts.push(strip(hp));
  const g = mergeGeometries(parts, false)!;
  return g;
}

function ensureKind(): void {
  if (G.projectiles.hasKind(KIND)) return;
  // unlit: the spirit axes glow on their own
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  G.projectiles.registerKind(KIND, { geometry: axeGeometry(), material: mat, spin: 21, capacity: 160 });
}

class AxeTempest implements UltEffect {
  private t = 0;
  private stream = STREAM;
  private volleyT = 0;
  private arms = 3;
  private dmg = 10;
  private size = 1;
  private token = 0;
  private finaleDone = false;
  private c: UltCast = { power: 1, area: 1, amount: 0, duration: 1 };
  private vortex = -1;
  private ringT = 0;
  private soundT = 0;
  private readonly flying: Proj[] = [];
  /** ring of reusable per-axe data (far more slots than axes alive at once) */
  private readonly dataPool: AxeData[] = Array.from({ length: 256 }, () => ({ token: -1, turn: 0, size: 1 }));
  private dataIdx = 0;
  private blur: SpriteBatch | null = null;
  private readonly move = (p: Proj, dt: number): boolean => {
    const d = p.data as AxeData;
    // curl the velocity: every axe traces a spiral away from the hero
    const a = d.turn * dt;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const vx = p.vx * cs - p.vz * sn;
    const vz = p.vx * sn + p.vz * cs;
    p.vx = vx;
    p.vz = vz;
    p.x += vx * dt;
    p.z += vz * dt;
    // grow in, shrink out
    const k = p.age / p.life;
    p.scale = d.size * (k < 0.12 ? 0.4 + k * 5 : k > 0.85 ? Math.max(0.2, (1 - k) / 0.15) : 1);
    return true;
  };
  private readonly onHit = (p: Proj): void => {
    if (Math.random() < 0.35) VFX.sparkles.spawn(p.x, 0.9, p.z, 0, 1, 0, 0.25, 0.6, col(HOT), SPARK_STAR, 0, 0, 5);
  };

  prepare(): void {
    ensureKind();
    this.blurBatch();
    void VFX.sparkles;
    void VFX.decals;
  }

  private blurBatch(): SpriteBatch {
    if (!this.blur) this.blur = new SpriteBatch(G.world.scene, spinBlurTex(), 160, { facing: "ground", additive: true, renderOrder: 7 });
    return this.blur;
  }

  start(c: UltCast): void {
    ensureKind();
    this.c = c;
    this.t = 0;
    this.stream = STREAM * c.duration;
    this.volleyT = 0;
    this.arms = Math.min(5, 3 + Math.floor(c.amount / 2));
    this.dmg = 10 * c.power;
    this.size = 1.1 * c.area;
    this.token++;
    this.finaleDone = false;
    this.ringT = 0;
    this.soundT = 0;
    this.flying.length = 0;
    const p = G.player;
    this.vortex = G.fx.vortex(p.x, p.z, 3.6 * c.area, "#c98316", this.stream + 0.3, { spin: 9, arms: 4 });
    VFX.decals.spawn(p.x, p.z, 4.5 * c.area, 0.5, col(HOT), DECAL_SHOCK, 1, 0, 0.1, 0.9);
    VFX.sparkles.burst(p.x, 0.8, p.z, 24, 9, 4, 0.6, 0.6, col(GOLD), SPARK_EMBER, -6, 2, 0.8);
    G.audio.sfx("whoosh", { vol: 1, pitch: 0.8 });
    G.audio.sfx("throw", { vol: 0.9, pitch: 0.7 });
  }

  update(dt: number): boolean {
    this.t += dt;
    const p = G.player;
    if (this.vortex >= 0) G.fx.move(this.vortex, p.x, p.z);
    if (this.t < this.stream) {
      this.volleyT -= dt;
      while (this.volleyT <= 0) {
        this.volleyT += VOLLEY_DT;
        const base = this.t * ARM_SPIN;
        for (let k = 0; k < this.arms; k++) this.throwAxe(base + (k / this.arms) * Math.PI * 2, SPEED, TURN, LIFE);
      }
      // wind rings + whoosh loop
      this.ringT -= dt;
      if (this.ringT <= 0) {
        this.ringT = 0.38;
        G.fx.ring(p.x, p.z, { radius: 3.4 * this.c.area, color: HOT, life: 0.35, width: 0.3, from: 0.3 });
        VFX.decals.spawn(p.x, p.z, 3 * this.c.area, 0.45, col(ORANGE), DECAL_VORTEX, 0.55, 10, 0.4, 0.3);
      }
      this.soundT -= dt;
      if (this.soundT <= 0) {
        this.soundT = 0.3;
        G.audio.sfx("whoosh", { vol: 0.7, pitch: 1 + Math.random() * 0.3 });
        G.audio.sfx("throw", { vol: 0.5, pitch: 1.1 + Math.random() * 0.3 });
      }
      if (Math.random() < dt * 14) {
        const a = Math.random() * Math.PI * 2;
        VFX.sparkles.spawn(p.x + Math.cos(a) * 1.2, 0.3, p.z + Math.sin(a) * 1.2, -Math.sin(a) * 7, 2.5, Math.cos(a) * 7, 0.4, 0.5, col(Math.random() < 0.5 ? GOLD : HOT), SPARK_EMBER, 0, 2);
      }
    } else if (!this.finaleDone) {
      this.finaleDone = true;
      // a full ring of fast axes to close the dance
      for (let k = 0; k < FINALE_N; k++) this.throwAxe((k / FINALE_N) * Math.PI * 2, SPEED * 1.6, 0.6, 0.9);
      G.fx.ring(p.x, p.z, { radius: 7 * this.c.area, color: GOLD, life: 0.5, width: 0.8, from: 0.1 });
      G.fx.flash(p.x, p.z, { radius: 3.5, color: HOT, life: 0.3 });
      G.fx.shake(0.6);
      G.audio.sfx("slash", { vol: 1, pitch: 0.8 });
      G.audio.sfx("whoosh", { vol: 1, pitch: 0.6 });
    }
    const busy = this.drawBlur(dt);
    return this.t < this.stream || !this.finaleDone || busy;
  }

  stop(): void {
    for (const p of this.flying) if (p.alive && (p.data as AxeData).token === this.token) p.alive = false;
    this.flying.length = 0;
    this.token++;
    if (this.vortex >= 0) G.fx.cancel(this.vortex);
    this.vortex = -1;
    const b = this.blurBatch();
    b.begin();
    b.end();
  }

  private throwAxe(a: number, speed: number, turn: number, life: number): void {
    const p = G.player;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const data = this.dataPool[this.dataIdx];
    this.dataIdx = (this.dataIdx + 1) % this.dataPool.length;
    data.token = this.token;
    data.turn = turn;
    data.size = this.size;
    const pr = G.projectiles.spawn({
      kind: KIND,
      x: p.x + ca * 0.6,
      z: p.z + sa * 0.6,
      y: 0.8,
      // outward + a tangential kick so the stream reads as a spiral arm
      vx: ca * speed - sa * speed * 0.35,
      vz: sa * speed + ca * speed * 0.35,
      damage: this.dmg,
      radius: 0.7 * this.size,
      life,
      pierce: Infinity,
      rehit: 0.4,
      source: ultRanger.id,
      kb: 7,
      scale: this.size * 0.4,
      data,
      update: this.move,
      onHit: this.onHit,
    });
    if (pr) this.flying.push(pr);
  }

  /** ground motion-blur discs under every flying axe; returns true while any axe flies */
  private drawBlur(dt: number): boolean {
    const b = this.blurBatch();
    b.begin();
    const tint = col("#ffd88a");
    const sp = VFX.sparkles;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const p = this.flying[i];
      // pooled projectiles get recycled: make sure it is still ours
      if (!p.alive || (p.data as AxeData).token !== this.token) {
        this.flying[i] = this.flying[this.flying.length - 1];
        this.flying.pop();
        continue;
      }
      b.add(p.x, 0.75, p.z, 1.6 * p.scale, tint, 0.4, -p.rot);
      if (Math.random() < dt * 7) sp.spawn(p.x, 0.8, p.z, 0, 0.6, 0, 0.28, 0.42 * p.scale, col(Math.random() < 0.5 ? GOLD : HOT), SPARK_GLOW, 0, 2);
    }
    b.end();
    return this.flying.length > 0;
  }
}

/** icon: three spirit axes whirling around a golden vortex */
function drawIcon(c: CanvasRenderingContext2D, s: number): void {
  iconBg(c, s, "#e8b23a", "#2a1608");
  c.save();
  c.translate(s * 0.5, s * 0.52);
  // swirl
  c.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    c.strokeStyle = `rgba(255,${200 + k * 20},${90 + k * 50},${0.85 - k * 0.2})`;
    c.lineWidth = s * (0.05 - k * 0.012);
    c.beginPath();
    for (let i = 0; i <= 24; i++) {
      const u = i / 24;
      const a = u * Math.PI * 1.6 + (k * Math.PI * 2) / 3;
      const r = s * (0.06 + u * 0.3);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.9;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  const glow = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.18);
  glow.addColorStop(0, "rgba(255,241,196,1)");
  glow.addColorStop(1, "rgba(255,191,46,0)");
  c.fillStyle = glow;
  c.beginPath();
  c.arc(0, 0, s * 0.18, 0, Math.PI * 2);
  c.fill();
  // three small axes at the arm tips
  for (let k = 0; k < 3; k++) {
    const a = Math.PI * 1.6 + (k * Math.PI * 2) / 3;
    const r = s * 0.33;
    c.save();
    c.translate(Math.cos(a) * r, Math.sin(a) * r * 0.9);
    c.rotate(a + Math.PI / 2 + 0.6);
    c.fillStyle = "#8a5a2b";
    c.strokeStyle = "#0d0f14";
    c.lineWidth = s * 0.022;
    c.beginPath();
    c.roundRect(-s * 0.018, -s * 0.12, s * 0.036, s * 0.24, s * 0.015);
    c.fill();
    c.stroke();
    const g = c.createLinearGradient(-s * 0.14, 0, s * 0.14, 0);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, GOLD);
    g.addColorStop(1, "#ffffff");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, -s * 0.12);
    c.quadraticCurveTo(s * 0.16, -s * 0.12, s * 0.12, s * 0.0);
    c.lineTo(0, -s * 0.05);
    c.lineTo(-s * 0.12, s * 0.0);
    c.quadraticCurveTo(-s * 0.16, -s * 0.12, 0, -s * 0.12);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
  c.restore();
}

export const ultRanger: UltimateDef = {
  id: "ultRanger",
  name: "ระบำพายุขวาน",
  desc: "หมุนตัวเป็นพายุ ขว้างขวานวิญญาณหมุนเกลียวออกรอบตัวไม่หยุด 4 วินาที ทะลุทุกตัว",
  color: GOLD,
  flash: "#fff2cc",
  icon: drawIcon,
  duration: 4.3,
  invuln: 0.8,
  pose: "spin",
  create: () => new AxeTempest(),
};
