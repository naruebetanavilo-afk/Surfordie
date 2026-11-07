import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { G } from "../../core/G";
import { hitEnemy, type HitOpts } from "../../combat/damage";
import type { Proj } from "../../combat/Projectiles";
import { VFX, col, SPARK_GLOW, SPARK_STAR, SPARK_EMBER, DECAL_GLOW, DECAL_SHOCK, DECAL_SCORCH, DECAL_VORTEX } from "../../weapons/vfx";
import { SpriteBatch } from "../../weapons/vfx/SpriteBatch";
import { softGlowTex } from "../../weapons/vfx/textures";
import { iconBg } from "../../ui/icons";
import { enemiesIn, HitOnce, easeOutCubic, randomScreenPoint } from "./common";
import type { UltCast, UltEffect, UltimateDef } from "./types";

/**
 * พริกเพลิงพันเม็ด (Thousand Fire Chillies) — the street chef heaves the
 * flaming wok skywards: for ~2.6 s blazing chillies arc out of it onto the
 * crowds around the hero, each bursting into a fire splash that leaves a
 * burning patch (damage over time + slow). The wok then flares up: a pillar
 * of flame at the hero and a ring of fire rolling out across the screen.
 */

const RED = "#ff3b1f";
const ORANGE = "#ff8a1f";
const YELLOW = "#ffd23f";
const HOT = "#fff1c4";
const SCORCH = "#2a120a";
const KIND = "sfdUltChili";

/** seconds of chilli rain (x duration stat) */
const RAIN = 2.6;
const MAX_PATCHES = 56;
/** burning patch: life, tick interval, damage per tick (x power), slow */
const PATCH_LIFE = 1.8;
const PATCH_TICK = 0.3;
const PATCH_DMG = 5;
/** chilli splash damage (x power) and radius (x area) */
const SPLASH_DMG = 30;
const SPLASH_R = 1.7;
/** finale ring: radius (x area), expansion time, damage (x power) */
const RING_R = 7.5;
const RING_T = 0.45;
const RING_DMG = 80;

interface ChiliData {
  token: number;
  sx: number;
  sz: number;
  tx: number;
  tz: number;
  y0: number;
  peak: number;
}

interface Patch {
  on: boolean;
  x: number;
  z: number;
  r: number;
  t: number;
  life: number;
  tick: number;
  dmg: number;
}

function chiliGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry => {
    const c = new THREE.Color(hex);
    const ng = g.index ? g.toNonIndexed() : g;
    const n = ng.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    }
    ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
    for (const k of Object.keys(ng.attributes)) if (k !== "position" && k !== "color") ng.deleteAttribute(k);
    return ng;
  };
  // a plump curved pod: two cone halves bent by a small rotation, a round shoulder, stem + calyx
  const tip = new THREE.ConeGeometry(0.16, 0.62, 8).rotateX(Math.PI).translate(0, -0.31, 0).rotateZ(0.35).translate(0.02, 0, 0);
  const shoulder = new THREE.SphereGeometry(0.165, 8, 6).scale(1, 0.8, 1);
  const calyx = new THREE.ConeGeometry(0.13, 0.08, 6).translate(0, 0.14, 0);
  const stem = new THREE.CylinderGeometry(0.03, 0.035, 0.2, 5).rotateZ(-0.4).translate(-0.04, 0.24, 0);
  const g = mergeGeometries([paint(tip, "#ff2a1a"), paint(shoulder, "#ff4a2a"), paint(calyx, "#3fae2a"), paint(stem, "#2f8f1f")], false)!;
  g.computeBoundingSphere();
  return g;
}

function ensureKind(): void {
  if (G.projectiles.hasKind(KIND)) return;
  // unlit: the chillies are glowing hot
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  G.projectiles.registerKind(KIND, { geometry: chiliGeometry(), material: mat, spin: 9, tumble: 11, capacity: 96 });
}

class ChiliStorm implements UltEffect {
  private t = 0;
  private rain = RAIN;
  private total = 30;
  private launched = 0;
  private token = 0;
  private finaleDone = false;
  private ringT = -1;
  private ringR = RING_R;
  private c: UltCast = { power: 1, area: 1, amount: 0, duration: 1 };
  private vortex = -1;
  private throwCd = 0;
  private boomCd = 0;
  private shakeCd = 0;
  private readonly flying: Proj[] = [];
  private readonly dataPool: ChiliData[] = Array.from({ length: 128 }, () => ({ token: -1, sx: 0, sz: 0, tx: 0, tz: 0, y0: 2, peak: 3 }));
  private dataIdx = 0;
  private readonly patches: Patch[] = Array.from({ length: MAX_PATCHES }, () => ({ on: false, x: 0, z: 0, r: 1, t: 0, life: 1, tick: 0, dmg: 0 }));
  private patchIdx = 0;
  private glow: SpriteBatch | null = null;
  private readonly hitOnce = new HitOnce();
  private readonly tmp = { x: 0, z: 0 };
  private readonly splashOpts: HitOpts = { kb: 6, fromX: 0, fromZ: 0, color: "#ffb36b" };
  private readonly burnOpts: HitOpts = { kb: 0, slow: 0.55, slowTime: 0.6, noCrit: true, silent: false, color: "#ff9a4a" };
  private readonly ringOpts: HitOpts = { kb: 22, fromX: 0, fromZ: 0, color: "#ffd27a" };

  /** flight: lerp on the ground, parabola in height; lands (onExpire) at the target */
  private readonly move = (p: Proj): boolean => {
    const d = p.data as unknown as ChiliData;
    const u = Math.min(1, p.age / p.life);
    p.x = d.sx + (d.tx - d.sx) * u;
    p.z = d.sz + (d.tz - d.sz) * u;
    p.y = d.y0 * (1 - u) + 0.25 * u + d.peak * 4 * u * (1 - u);
    return true;
  };
  private readonly land = (p: Proj): void => {
    const d = p.data as unknown as ChiliData;
    if (d.token !== this.token) return;
    this.impact(d.tx, d.tz);
  };

  prepare(): void {
    ensureKind();
    this.batch();
    void VFX.sparkles;
    void VFX.decals;
    void VFX.dark;
    void VFX.domes;
  }

  private batch(): SpriteBatch {
    if (!this.glow) this.glow = new SpriteBatch(G.world.scene, softGlowTex(), 96 + MAX_PATCHES * 2, { facing: "camera", additive: true, depthTest: false, renderOrder: 9 });
    return this.glow;
  }

  start(c: UltCast): void {
    ensureKind();
    this.c = c;
    this.t = 0;
    this.rain = RAIN * c.duration;
    this.total = Math.round(34 + 3 * Math.min(6, c.amount));
    this.launched = 0;
    this.token++;
    this.finaleDone = false;
    this.ringT = -1;
    this.throwCd = 0;
    this.flying.length = 0;
    for (const q of this.patches) q.on = false;
    const p = G.player;
    this.vortex = G.fx.vortex(p.x, p.z, 2.8 * c.area, "#ff6a1f", this.rain + 0.6, { spin: 6, arms: 3 });
    G.fx.pillar(p.x, p.z, ORANGE, { radius: 0.9, height: 9, life: 0.7 });
    VFX.decals.spawn(p.x, p.z, 3.5 * c.area, 0.5, col(HOT), DECAL_SHOCK, 1, 0, 0.1, 0.9);
    VFX.sparkles.burst(p.x, 2.2, p.z, 26, 5, 8, 0.8, 0.7, col(YELLOW), SPARK_EMBER, -5, 1.4, 0.6);
    G.audio.sfx("burn", { vol: 1, pitch: 0.8 });
    G.audio.sfx("whoosh", { vol: 0.9, pitch: 0.9 });
  }

  update(dt: number): boolean {
    this.t += dt;
    this.throwCd -= dt;
    this.boomCd -= dt;
    this.shakeCd -= dt;
    const p = G.player;
    if (this.vortex >= 0) G.fx.move(this.vortex, p.x, p.z);
    // the wok spits fire while it is raised
    if (this.t < this.rain && Math.random() < dt * 26) {
      VFX.sparkles.spawn(p.x + (Math.random() - 0.5) * 0.7, 2.1 + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2, 0.5, 0.7, col(Math.random() < 0.5 ? ORANGE : YELLOW), SPARK_EMBER, -3, 1);
    }
    const due = Math.min(this.total, Math.floor((this.t / this.rain) * this.total) + 1);
    while (this.launched < due && this.t < this.rain) {
      this.launch();
      this.launched++;
    }
    if (!this.finaleDone && this.t >= this.rain + 0.15) this.finale();
    const ringBusy = this.stepRing(dt);
    const patchBusy = this.stepPatches(dt);
    const flyBusy = this.draw(dt);
    return this.t < this.rain || !this.finaleDone || flyBusy || patchBusy || ringBusy;
  }

  stop(): void {
    for (const pr of this.flying) if (pr.alive && (pr.data as unknown as ChiliData).token === this.token) pr.alive = false;
    this.flying.length = 0;
    this.token++;
    for (const q of this.patches) q.on = false;
    this.ringT = -1;
    if (this.vortex >= 0) G.fx.cancel(this.vortex);
    this.vortex = -1;
    const b = this.batch();
    b.begin();
    b.end();
  }

  /** throw one chilli at a crowd on screen (or a random spot around the hero) */
  private launch(): void {
    const p = G.player;
    const em = G.enemies;
    const out = this.tmp;
    let found = false;
    if (Math.random() < 0.68) {
      const i = em.randomVisible();
      if (i >= 0) {
        out.x = em.x[i] + (Math.random() - 0.5) * 0.8;
        out.z = em.z[i] + (Math.random() - 0.5) * 0.8;
        found = true;
      }
    }
    if (!found) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.5 + Math.random() * 5.5 * this.c.area;
      out.x = p.x + Math.cos(a) * r;
      out.z = p.z + Math.sin(a) * r;
      if (!G.world.onScreen(out.x, out.z, 1)) randomScreenPoint(out, 2);
    }
    const d = this.dataPool[this.dataIdx];
    this.dataIdx = (this.dataIdx + 1) % this.dataPool.length;
    const dist = Math.hypot(out.x - p.x, out.z - p.z);
    d.token = this.token;
    d.sx = p.x;
    d.sz = p.z;
    d.tx = out.x;
    d.tz = out.z;
    d.y0 = 2.2;
    d.peak = 2.2 + dist * 0.22;
    const life = 0.5 + Math.min(0.35, dist * 0.035) + Math.random() * 0.08;
    const pr = G.projectiles.spawn({
      kind: KIND,
      x: p.x,
      z: p.z,
      y: 2.2,
      vx: out.x - p.x,
      vz: out.z - p.z,
      damage: 0,
      radius: 0.3,
      life,
      contact: false,
      source: ultChef.id,
      scale: 0.9 + Math.random() * 0.35,
      data: d as unknown as Record<string, unknown>,
      update: this.move,
      onExpire: this.land,
    });
    if (pr) this.flying.push(pr);
    if (this.throwCd <= 0) {
      this.throwCd = 0.12;
      G.audio.sfx("throw", { vol: 0.45, pitch: 1.2 + Math.random() * 0.4 });
    }
  }

  private impact(x: number, z: number): void {
    const r = SPLASH_R * this.c.area;
    const em = G.enemies;
    const o = this.splashOpts;
    o.fromX = x;
    o.fromZ = z;
    const list = enemiesIn(x, z, r);
    const dmg = SPLASH_DMG * this.c.power;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      o.kb = em.isBoss(i) ? 0 : 6;
      hitEnemy(i, dmg, ultChef.id, o);
    }
    // burning patch
    const q = this.patches[this.patchIdx];
    this.patchIdx = (this.patchIdx + 1) % MAX_PATCHES;
    q.on = true;
    q.x = x;
    q.z = z;
    q.r = r * 0.8;
    q.t = 0;
    q.life = PATCH_LIFE * this.c.duration;
    q.tick = PATCH_TICK * 0.5;
    q.dmg = PATCH_DMG * this.c.power;
    // splash look
    const sp = VFX.sparkles;
    G.fx.explosionEx(x, z, { radius: r * 0.7, color: ORANGE, shake: 0, scorch: false, sparks: 0.5, smoke: Math.random() < 0.3 });
    VFX.decals.spawn(x, z, r * 1.2, 0.35, col(HOT), DECAL_SHOCK, 0.9, 0, 0.15, 0.9);
    VFX.decals.spawn(x, z, q.r * 1.15, q.life, col(RED), DECAL_GLOW, 0.75, 0, 0.6, 0.12);
    VFX.decals.spawn(x, z, q.r, q.life * 0.8, col(ORANGE), DECAL_VORTEX, 0.5, 4, 0.5, 0.2);
    VFX.dark.spawn(x, z, q.r * 0.95, q.life + 1, col(SCORCH), DECAL_SCORCH, 0.55, 0, 0.6, 0.08);
    sp.burst(x, 0.4, z, 10, r * 3, 5, 0.55, 0.6, col(YELLOW), SPARK_EMBER, -6, 1.8, r * 0.4);
    sp.burst(x, 0.3, z, 4, r * 1.5, 2, 0.4, 0.9, col(HOT), SPARK_STAR, -2, 2, r * 0.3);
    if (this.boomCd <= 0) {
      this.boomCd = 0.09;
      G.audio.sfx(Math.random() < 0.5 ? "burn" : "boom", { vol: 0.6, pitch: 1.1 + Math.random() * 0.4 });
    }
    if (this.shakeCd <= 0) {
      this.shakeCd = 0.2;
      G.fx.shake(0.18);
    }
  }

  private finale(): void {
    this.finaleDone = true;
    const p = G.player;
    const a = this.c.area;
    this.ringR = RING_R * a;
    this.ringT = 0;
    this.hitOnce.clear();
    this.ringOpts.fromX = p.x;
    this.ringOpts.fromZ = p.z;
    G.fx.pillar(p.x, p.z, ORANGE, { radius: 1.8, height: 16, life: 1 });
    G.fx.flare(p.x, 1.5, p.z, 11, HOT, 0.45);
    G.fx.ring(p.x, p.z, { radius: this.ringR, color: ORANGE, life: RING_T + 0.15, width: 1.1, from: 0.1 });
    G.fx.ring(p.x, p.z, { radius: this.ringR * 0.8, color: YELLOW, life: RING_T, width: 0.6, from: 0.05 });
    VFX.domes.spawn(p.x, p.z, 3 * a, 0.5, col(ORANGE), 1, 0.8, 10);
    VFX.decals.spawn(p.x, p.z, this.ringR, RING_T + 0.3, col(ORANGE), DECAL_SHOCK, 1, 0, 0.1, 0.9);
    VFX.dark.spawn(p.x, p.z, 3.2 * a, 3, col(SCORCH), DECAL_SCORCH, 0.6, 0, 0.5, 0.08);
    VFX.sparkles.burst(p.x, 0.6, p.z, 40, this.ringR * 2.2, 4, 0.7, 0.9, col(YELLOW), SPARK_EMBER, -4, 1.6, 1);
    G.fx.shake(0.9);
    G.fx.hitStop(0.08, 0.05);
    G.overlay.screenFlash("#ffe2c4", 0.45, 0.35);
    G.audio.sfx("boom", { vol: 1, pitch: 0.65 });
    G.audio.sfx("burn", { vol: 1, pitch: 0.6 });
  }

  /** the rolling fire ring hits every enemy it passes once */
  private stepRing(dt: number): boolean {
    if (this.ringT < 0) return false;
    this.ringT += dt;
    const k = Math.min(1, this.ringT / RING_T);
    const r = easeOutCubic(k) * this.ringR;
    const o = this.ringOpts;
    const em = G.enemies;
    const list = enemiesIn(o.fromX ?? 0, o.fromZ ?? 0, r);
    const dmg = RING_DMG * this.c.power;
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      if (!this.hitOnce.first(i)) continue;
      o.kb = em.isBoss(i) ? 0 : 22;
      hitEnemy(i, dmg, ultChef.id, o);
    }
    // flame tongues along the front
    if (Math.random() < dt * 60) {
      const a = Math.random() * Math.PI * 2;
      VFX.sparkles.spawn((o.fromX ?? 0) + Math.cos(a) * r, 0.4, (o.fromZ ?? 0) + Math.sin(a) * r, Math.cos(a) * 2, 3, Math.sin(a) * 2, 0.45, 0.9, col(Math.random() < 0.5 ? ORANGE : YELLOW), SPARK_GLOW, -2, 1.5);
    }
    if (k >= 1) {
      this.ringT = -1;
      return false;
    }
    return true;
  }

  /** burning patches: damage + slow on a tick */
  private stepPatches(dt: number): boolean {
    let any = false;
    const o = this.burnOpts;
    for (const q of this.patches) {
      if (!q.on) continue;
      q.t += dt;
      if (q.t >= q.life) {
        q.on = false;
        continue;
      }
      any = true;
      q.tick -= dt;
      if (q.tick <= 0) {
        q.tick += PATCH_TICK;
        const list = enemiesIn(q.x, q.z, q.r);
        for (let n = 0; n < list.length; n++) hitEnemy(list[n], q.dmg, ultChef.id, o);
      }
      if (Math.random() < dt * 5) {
        VFX.sparkles.spawn(q.x + (Math.random() - 0.5) * q.r, 0.15, q.z + (Math.random() - 0.5) * q.r, 0, 1.6 + Math.random(), 0, 0.6, 0.45, col(Math.random() < 0.6 ? ORANGE : YELLOW), SPARK_EMBER, 0.8, 1);
      }
    }
    return any;
  }

  /** flame halo on every flying chilli + flickering flames on the patches */
  private draw(dt: number): boolean {
    const b = this.batch();
    b.begin();
    const sp = VFX.sparkles;
    const cR = col(RED);
    const cO = col(ORANGE);
    const cY = col(YELLOW);
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const pr = this.flying[i];
      if (!pr.alive || (pr.data as unknown as ChiliData).token !== this.token) {
        this.flying[i] = this.flying[this.flying.length - 1];
        this.flying.pop();
        continue;
      }
      b.add(pr.x, pr.y, pr.z, 1.25 * pr.scale, cO, 0.85);
      if (Math.random() < dt * 22) sp.spawn(pr.x, pr.y, pr.z, (Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6, 0.35, 0.55, Math.random() < 0.5 ? cY : cR, SPARK_GLOW, 0, 2);
    }
    const tt = G.realTime;
    for (let k = 0; k < this.patches.length; k++) {
      const q = this.patches[k];
      if (!q.on) continue;
      const fade = Math.min(1, (q.life - q.t) / 0.4) * Math.min(1, q.t / 0.1);
      const fl = 0.8 + 0.25 * Math.sin(tt * 19 + k * 1.7);
      b.add(q.x, 0.45, q.z, q.r * 1.4 * fl, cR, 0.5 * fade);
      b.add(q.x, 0.7 + 0.15 * Math.sin(tt * 13 + k), q.z, q.r * 0.8 * fl, cY, 0.45 * fade);
    }
    b.end();
    return this.flying.length > 0;
  }
}

/** icon: a wok tossing fiery chillies under a burst of flame */
function drawIcon(c: CanvasRenderingContext2D, s: number): void {
  iconBg(c, s, "#f2552c", "#2a0f08");
  c.save();
  // flame burst
  const g = c.createRadialGradient(s * 0.5, s * 0.5, s * 0.02, s * 0.5, s * 0.5, s * 0.4);
  g.addColorStop(0, "#fff1c4");
  g.addColorStop(0.4, "#ffb43d");
  g.addColorStop(1, "rgba(255,80,20,0)");
  c.fillStyle = g;
  c.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 7;
    const r = i % 2 ? s * 0.2 : s * 0.4;
    c.lineTo(s * 0.5 + Math.cos(a) * r, s * 0.46 + Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
  // chillies
  const chili = (x: number, y: number, rot: number, k: number): void => {
    c.save();
    c.translate(s * x, s * y);
    c.rotate(rot);
    c.scale(k, k);
    c.lineWidth = s * 0.025;
    c.strokeStyle = "#0d0f14";
    c.fillStyle = "#ff2a1a";
    c.beginPath();
    c.moveTo(-s * 0.06, -s * 0.05);
    c.quadraticCurveTo(s * 0.08, -s * 0.06, s * 0.1, s * 0.14);
    c.quadraticCurveTo(s * 0.02, s * 0.06, -s * 0.06, s * 0.04);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = "#3fae2a";
    c.beginPath();
    c.ellipse(-s * 0.06, 0, s * 0.03, s * 0.055, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.restore();
  };
  chili(0.28, 0.26, -0.6, 1);
  chili(0.66, 0.2, 0.5, 0.9);
  chili(0.78, 0.46, 1.2, 0.8);
  chili(0.22, 0.52, -1.3, 0.8);
  // wok
  c.lineWidth = s * 0.04;
  c.strokeStyle = "#0d0f14";
  c.fillStyle = "#4a505c";
  c.beginPath();
  c.moveTo(s * 0.2, s * 0.64);
  c.quadraticCurveTo(s * 0.5, s * 0.96, s * 0.8, s * 0.64);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "#8a5a2b";
  c.beginPath();
  c.roundRect(s * 0.78, s * 0.62, s * 0.16, s * 0.05, s * 0.02);
  c.fill();
  c.stroke();
  c.restore();
}

export const ultChef: UltimateDef = {
  id: "ultChef",
  name: "พริกเพลิงพันเม็ด",
  desc: "โยนกระทะไฟ พริกเพลิงนับสิบพุ่งระเบิดใส่ฝูงศัตรู ทิ้งกองไฟเผาไหม้ ปิดท้ายด้วยวงเพลิงกวาดทั้งจอ",
  color: "#ff6a1f",
  flash: "#ffe6cc",
  icon: drawIcon,
  duration: 3.4,
  // chillies in flight + burning patches outlast the throw
  hudDuration: 5.3,
  invuln: 0.8,
  pose: "channel",
  create: () => new ChiliStorm(),
};
