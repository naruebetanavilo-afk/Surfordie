import { G } from "../../core/G";
import { hitEnemy, type HitOpts } from "../../combat/damage";
import { VFX, col, SPARK_GLOW, SPARK_STAR, SPARK_EMBER, DECAL_TARGET, DECAL_VORTEX, DECAL_SHOCK, DECAL_GLOW, DECAL_SCORCH } from "../../weapons/vfx";
import { SpriteBatch } from "../../weapons/vfx/SpriteBatch";
import { softGlowTex } from "../../weapons/vfx/textures";
import { iconBg } from "../../ui/icons";
import { enemiesIn, randomScreenPoint } from "./common";
import type { UltCast, UltEffect, UltimateDef } from "./types";

/**
 * พายุดาวหางมนตรา (Arcane Comet Storm) — the apprentice raises the staff and
 * opens the sky: for ~3 s glowing violet / cyan comets rain onto the densest
 * groups on screen, each one a big blast with a dome and a vortex scar, and
 * a giant finale comet crashes into the biggest crowd at the end.
 */

const VIOLET = "#9b6bff";
const CYAN = "#59e8ff";
const CORE = "#f2ecff";
const PINK = "#ff78e8";
const SCORCH = "#1d1236";

const MAX_COMETS = 48;
/** seconds the rain lasts (x duration stat) */
const RAIN = 2.7;
/** fall time of a comet */
const FALL = 0.5;
const FINALE_FALL = 0.75;
/** comet start offset from its target (falls from the upper-left / far side) */
const OFF_X = -4.5;
const OFF_Y = 16;
const OFF_Z = -6;

interface Comet {
  on: boolean;
  t: number;
  T: number;
  x: number;
  z: number;
  r: number;
  dmg: number;
  size: number;
  cyan: boolean;
  finale: boolean;
}

class CometStorm implements UltEffect {
  private comets: Comet[] = [];
  private halo: SpriteBatch | null = null;
  private core: SpriteBatch | null = null;
  private t = 0;
  private rain = RAIN;
  private total = 24;
  private launched = 0;
  private finaleDone = false;
  private c: UltCast = { power: 1, area: 1, amount: 0, duration: 1 };
  private rune = -1;
  private boomCd = 0;
  private shakeCd = 0;
  /** recent targets (spread the impacts) */
  private readonly rx = new Float32Array(8);
  private readonly rz = new Float32Array(8);
  private rn = 0;
  private readonly tmp = { x: 0, z: 0 };
  private readonly opts: HitOpts = { kb: 9, fromX: 0, fromZ: 0, color: "#d9c4ff" };
  private cnt = 0;
  private readonly countCb = (i: number): void => {
    if (i < G.enemies.n) this.cnt++;
  };

  constructor() {
    for (let i = 0; i < MAX_COMETS; i++) this.comets.push({ on: false, t: 0, T: 1, x: 0, z: 0, r: 1, dmg: 0, size: 1, cyan: false, finale: false });
  }

  prepare(): void {
    void VFX.decals;
    void VFX.dark;
    void VFX.domes;
    void VFX.sparkles;
    this.batches();
  }

  private batches(): [SpriteBatch, SpriteBatch] {
    if (!this.halo || !this.core) {
      // alpha-blended halo keeps the comets saturated over the bright grass; additive hot core on top
      this.halo = new SpriteBatch(G.world.scene, softGlowTex(), MAX_COMETS, { facing: "camera", additive: false, depthTest: false, renderOrder: 9 });
      this.core = new SpriteBatch(G.world.scene, softGlowTex(), MAX_COMETS * 2, { facing: "camera", additive: true, depthTest: false, renderOrder: 10 });
    }
    return [this.halo, this.core];
  }

  start(c: UltCast): void {
    this.c = c;
    this.t = 0;
    this.rain = RAIN * c.duration;
    this.total = Math.round(24 + 2 * Math.min(6, c.amount));
    this.launched = 0;
    this.finaleDone = false;
    this.rn = 0;
    for (const m of this.comets) m.on = false;
    const p = G.player;
    this.rune = G.fx.rune(p.x, p.z, 3, VIOLET, this.rain + FINALE_FALL + 0.4, { spin: 2.4 });
    G.fx.pillar(p.x, p.z, VIOLET, { radius: 1, height: 16, life: 0.9 });
    VFX.domes.spawn(p.x, p.z, 2.2, 0.6, col(CYAN), 1, 0.8, 12);
    VFX.sparkles.burst(p.x, 1.5, p.z, 20, 4, 9, 0.8, 0.6, col(CORE), SPARK_STAR, -3, 1.2, 0.6);
    G.audio.sfx("zap", { vol: 1, pitch: 0.6 });
    G.audio.sfx("whoosh", { vol: 0.9, pitch: 1.3 });
  }

  update(dt: number): boolean {
    this.t += dt;
    this.boomCd -= dt;
    this.shakeCd -= dt;
    const p = G.player;
    if (this.rune >= 0) G.fx.move(this.rune, p.x, p.z);
    // staff sparkles while channelling
    if (this.t < this.rain && Math.random() < dt * 30) {
      VFX.sparkles.spawn(p.x + (Math.random() - 0.5) * 0.8, 2 + Math.random() * 0.6, p.z + (Math.random() - 0.5) * 0.8, 0, 3.5, 0, 0.5, 0.5, col(Math.random() < 0.5 ? CYAN : CORE), SPARK_STAR, 0, 1, 4);
    }
    // launch schedule: evenly spread over the rain window
    const due = Math.min(this.total, Math.floor((this.t / this.rain) * this.total) + 1);
    while (this.launched < due && this.t < this.rain) {
      this.launch(false);
      this.launched++;
    }
    if (!this.finaleDone && this.t >= this.rain - 0.2) {
      this.finaleDone = true;
      this.launch(true);
    }
    const busy = this.step(dt);
    return busy || this.t < this.rain || !this.finaleDone;
  }

  stop(): void {
    for (const m of this.comets) m.on = false;
    if (this.rune >= 0) G.fx.cancel(this.rune);
    this.rune = -1;
    const [h, c] = this.batches();
    h.begin();
    h.end();
    c.begin();
    c.end();
  }

  /** choose a dense spot, away from the last few impacts */
  private pickTarget(r: number, out: { x: number; z: number }): void {
    const em = G.enemies;
    let best = -1e9;
    let found = false;
    const sep2 = r * 1.3 * (r * 1.3);
    for (let s = 0; s < 8; s++) {
      const i = em.randomVisible();
      if (i < 0) break;
      const x = em.x[i];
      const z = em.z[i];
      let pen = 0;
      const n = Math.min(this.rn, this.rx.length);
      for (let k = 0; k < n; k++) {
        const dx = this.rx[k] - x;
        const dz = this.rz[k] - z;
        if (dx * dx + dz * dz < sep2) pen += 6;
      }
      this.cnt = 0;
      em.queryCircle(x, z, r, this.countCb);
      const score = this.cnt - pen + Math.random();
      if (score > best) {
        best = score;
        out.x = x + (Math.random() - 0.5) * 0.6;
        out.z = z + (Math.random() - 0.5) * 0.6;
        found = true;
      }
    }
    if (!found) randomScreenPoint(out, 2);
    const k = this.rn++ % this.rx.length;
    this.rx[k] = out.x;
    this.rz[k] = out.z;
  }

  private launch(finale: boolean): void {
    let m: Comet | null = null;
    for (const q of this.comets) {
      if (!q.on) {
        m = q;
        break;
      }
    }
    if (!m) return;
    const r = (finale ? 4.6 : 2.4) * this.c.area;
    this.pickTarget(finale ? r * 0.7 : r, this.tmp);
    m.on = true;
    m.t = 0;
    m.T = finale ? FINALE_FALL : FALL * (0.9 + Math.random() * 0.2);
    m.x = this.tmp.x;
    m.z = this.tmp.z;
    m.r = r;
    m.dmg = (finale ? 110 : 34) * this.c.power;
    m.size = finale ? 2.4 : 1;
    m.cyan = !finale && Math.random() < 0.4;
    m.finale = finale;
    VFX.decals.spawn(m.x, m.z, r, m.T + 0.05, col(finale ? PINK : m.cyan ? CYAN : VIOLET), DECAL_TARGET, finale ? 1.1 : 0.8, 1.5, 1, 0.01);
    if (finale) G.audio.sfx("warn", { vol: 0.6, pitch: 1.3 });
  }

  private step(dt: number): boolean {
    const [hb, cb] = this.batches();
    hb.begin();
    cb.begin();
    const sp = VFX.sparkles;
    const cw = col(CORE);
    let any = false;
    for (const m of this.comets) {
      if (!m.on) continue;
      any = true;
      m.t += dt;
      const u = Math.min(1, m.t / m.T);
      // accelerate into the ground
      const k = u * u * (0.35 + 0.65 * u);
      const x = m.x + OFF_X * (1 - k);
      const y = 0.3 + OFF_Y * (1 - k);
      const z = m.z + OFF_Z * (1 - k);
      const main = col(m.finale ? PINK : m.cyan ? CYAN : VIOLET);
      const s = m.size;
      const pulse = 1 + 0.15 * Math.sin(m.t * 40);
      hb.add(x, y, z, 2.6 * s * pulse, main, 1);
      // streak: stretched glow along the fall direction, plus the white-hot head
      cb.add(x - OFF_X * 0.025, y - OFF_Y * 0.025 * 0.4, z - OFF_Z * 0.025, 1.7 * s, main, 0.9, -1.05, 2.6);
      cb.add(x, y, z, 1.05 * s * pulse, cw, 1);
      sp.spawn(x + (Math.random() - 0.5) * 0.3 * s, y + (Math.random() - 0.5) * 0.3 * s, z + (Math.random() - 0.5) * 0.3 * s, (Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6, 0.45, 0.85 * s, main, SPARK_GLOW, 0, 1.5);
      if (Math.random() < dt * 20) sp.spawn(x, y, z, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2, 0.4, 0.6 * s, cw, SPARK_STAR, -2, 1, 4);
      if (u >= 1) {
        m.on = false;
        this.impact(m);
      }
    }
    hb.end();
    cb.end();
    return any;
  }

  private impact(m: Comet): void {
    const x = m.x;
    const z = m.z;
    const r = m.r;
    const em = G.enemies;
    const o = this.opts;
    o.fromX = x;
    o.fromZ = z;
    const list = enemiesIn(x, z, r);
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      o.kb = em.isBoss(i) ? 0 : m.finale ? 30 : 9;
      hitEnemy(i, m.dmg, ultMage.id, o);
    }
    const main = col(m.finale ? PINK : m.cyan ? CYAN : VIOLET);
    const sp = VFX.sparkles;
    const big = m.finale ? 1.6 : 1;
    G.fx.explosionEx(x, z, { radius: r * 0.75, color: m.finale ? PINK : m.cyan ? CYAN : VIOLET, shake: 0, scorch: false, sparks: 0.7 * big, smoke: m.finale });
    VFX.domes.spawn(x, z, r * 0.7, 0.45 * big, main, 1, 0.7, 10);
    VFX.decals.spawn(x, z, r * 1.05, 1.0 * big, main, DECAL_VORTEX, 1.1, 5, 0.35, 0.2);
    VFX.decals.spawn(x, z, r * 1.35, 0.45, col(CORE), DECAL_SHOCK, 0.9, 0, 0.12, 0.95);
    VFX.decals.spawn(x, z, r * 1.4, 0.35, main, DECAL_GLOW, 0.7, 0, 0.55, 0.15);
    VFX.dark.spawn(x, z, r * 0.75, 2.6, col(SCORCH), DECAL_SCORCH, 0.55, 0, 0.6, 0.08);
    sp.burst(x, 0.6, z, 6 * big, r * 2.6, 6, 0.6, 1.0, col("#ffffff"), SPARK_STAR, -7, 2.4, r * 0.6);
    sp.burst(x, 0.3, z, 14 * big, r * 3.2, 3, 0.6, 0.6, main, SPARK_GLOW, -3, 2.6, r * 0.5);
    sp.burst(x, 0.2, z, 5 * big, r, 3, 0.8, 0.35, col(PINK), SPARK_EMBER, 1.2, 1.6, r);
    if (m.finale) {
      G.fx.pillar(x, z, PINK, { radius: 1.8, height: 16, life: 1 });
      G.fx.flare(x, 1.5, z, 12, CORE, 0.5);
      G.fx.shake(1);
      G.fx.hitStop(0.1, 0.05);
      G.overlay.screenFlash("#ffe6ff", 0.5, 0.35);
      G.audio.sfx("thunder", { vol: 1, pitch: 0.8 });
      G.audio.sfx("boom", { vol: 1, pitch: 0.6 });
    } else {
      if (this.shakeCd <= 0) {
        G.fx.shake(0.28);
        this.shakeCd = 0.18;
      }
      if (this.boomCd <= 0) {
        G.audio.sfx("boom", { vol: 0.8, pitch: 1 + Math.random() * 0.35 });
        this.boomCd = 0.08;
      }
    }
  }
}

/** icon: comets with trails falling into a violet sky */
function drawIcon(c: CanvasRenderingContext2D, s: number): void {
  iconBg(c, s, "#8b5cf6", "#160f2e");
  c.save();
  const comet = (x: number, y: number, r: number, color: string): void => {
    // trail towards the upper-left
    const g = c.createLinearGradient(x - r * 5, y - r * 5, x, y);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, color);
    c.strokeStyle = g;
    c.lineCap = "round";
    c.lineWidth = r * 1.5;
    c.beginPath();
    c.moveTo(x - r * 5, y - r * 5);
    c.lineTo(x, y);
    c.stroke();
    const h = c.createRadialGradient(x, y, 0, x, y, r * 2);
    h.addColorStop(0, "#ffffff");
    h.addColorStop(0.35, color);
    h.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = h;
    c.beginPath();
    c.arc(x, y, r * 2, 0, Math.PI * 2);
    c.fill();
  };
  comet(s * 0.32, s * 0.36, s * 0.045, CYAN);
  comet(s * 0.78, s * 0.3, s * 0.035, PINK);
  comet(s * 0.6, s * 0.66, s * 0.075, "#b48cff");
  // impact burst
  c.fillStyle = "rgba(255,240,255,0.9)";
  c.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = i % 2 ? s * 0.06 : s * 0.15;
    c.lineTo(s * 0.62 + Math.cos(a) * rr, s * 0.7 + Math.sin(a) * rr * 0.6);
  }
  c.closePath();
  c.fill();
  // sparkles
  c.fillStyle = "#ffe680";
  for (const [x, y, r] of [
    [0.2, 0.7, 0.04],
    [0.84, 0.62, 0.03],
    [0.5, 0.16, 0.035],
  ]) {
    c.beginPath();
    c.moveTo(s * x, s * (y - r));
    c.quadraticCurveTo(s * x, s * y, s * (x + r), s * y);
    c.quadraticCurveTo(s * x, s * y, s * x, s * (y + r));
    c.quadraticCurveTo(s * x, s * y, s * (x - r), s * y);
    c.quadraticCurveTo(s * x, s * y, s * x, s * (y - r));
    c.fill();
  }
  c.restore();
}

export const ultMage: UltimateDef = {
  id: "ultMage",
  name: "พายุดาวหางมนตรา",
  desc: "เปิดฟ้าเรียกดาวหางเวทนับสิบถล่มจุดที่ศัตรูหนาแน่นทั่วจอ ปิดท้ายด้วยดาวหางยักษ์",
  color: VIOLET,
  flash: "#efe4ff",
  icon: drawIcon,
  duration: 3.3,
  invuln: 0.8,
  pose: "channel",
  create: () => new CometStorm(),
};
