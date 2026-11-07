import { G } from "../../core/G";
import { hitEnemy, type HitOpts } from "../../combat/damage";
import { VFX, col, SPARK_EMBER, SPARK_STAR, SPARK_GLOW, DECAL_CRACK, DECAL_SCORCH, DECAL_SHOCK, DECAL_GLOW } from "../../weapons/vfx";
import { iconBg } from "../../ui/icons";
import { enemiesIn, HitOnce, easeOutCubic } from "./common";
import type { UltCast, UltEffect, UltimateDef } from "./types";

/**
 * ป้อมเหล็กถล่มปฐพี (Iron Fortress Quake) — the bucket knight leaps up wrapped
 * in a golden iron shell (invulnerable), smashes the ground, and three ever
 * wider shockwave rings roll out from the crater: heavy damage, the horde is
 * hurled back (bosses take full damage but are not pushed).
 */

const GOLD = "#ffd23f";
const HOT = "#fff3b0";
const TEAL = "#3de0d0";
const DUST = "#c9b48f";

/** seconds after the cast when the knight lands */
const SLAM_T = 0.32;

interface WaveSpec {
  /** start time (s after cast) */
  at: number;
  /** final radius (world units, before the area stat) */
  r: number;
  /** expansion time */
  T: number;
  /** base damage (x power, x might) */
  dmg: number;
  kb: number;
  color: string;
}

const WAVES: WaveSpec[] = [
  { at: SLAM_T, r: 6.5, T: 0.42, dmg: 30, kb: 42, color: GOLD },
  { at: SLAM_T + 0.3, r: 9.5, T: 0.48, dmg: 30, kb: 48, color: TEAL },
  { at: SLAM_T + 0.62, r: 13, T: 0.55, dmg: 52, kb: 60, color: GOLD },
];
const RING_FROM = 0.06;

interface Wave {
  on: boolean;
  t: number;
  T: number;
  r: number;
  dmg: number;
  kb: number;
  hit: HitOnce;
  dustT: number;
}

class IronQuake implements UltEffect {
  private t = 0;
  private dur = 2.2;
  private cx = 0;
  private cz = 0;
  private slammed = false;
  private started = 0;
  private c: UltCast = { power: 1, area: 1, amount: 0, duration: 1 };
  private rune = -1;
  private sparkT = 0;
  private readonly waves: Wave[] = WAVES.map(() => ({ on: false, t: 0, T: 1, r: 1, dmg: 0, kb: 0, hit: new HitOnce(), dustT: 0 }));
  private readonly opts: HitOpts = { kb: 0, fromX: 0, fromZ: 0, color: GOLD, slow: 0.45, slowTime: 1.6 };

  prepare(): void {
    void VFX.decals;
    void VFX.dark;
    void VFX.domes;
    void VFX.sparkles;
  }

  start(c: UltCast): void {
    this.c = c;
    this.t = 0;
    this.dur = 2.2 * c.duration;
    this.slammed = false;
    this.started = 0;
    this.sparkT = 0;
    for (const w of this.waves) w.on = false;
    const p = G.player;
    G.audio.sfx("whoosh", { vol: 1, pitch: 0.7 });
    G.audio.sfx("levelup", { vol: 0.5, pitch: 0.6 });
    this.rune = G.fx.rune(p.x, p.z, 2.2, GOLD, this.dur, { spin: 3.5 });
    G.fx.glowBall(p.x, 1, p.z, 3.2, HOT, 0.3);
    VFX.sparkles.burst(p.x, 0.3, p.z, 18, 3, 7, 0.7, 0.55, col(GOLD), SPARK_STAR, -4, 1.5, 1.2);
  }

  update(dt: number): boolean {
    this.t += dt;
    const p = G.player;
    if (this.rune >= 0) G.fx.move(this.rune, p.x, p.z);

    // iron shell sparkles while invulnerable
    this.sparkT -= dt;
    if (this.sparkT <= 0 && this.t < this.dur - 0.3) {
      this.sparkT = 0.05;
      const a = Math.random() * Math.PI * 2;
      VFX.sparkles.spawn(p.x + Math.cos(a) * 0.7, 0.3 + Math.random() * 1.2, p.z + Math.sin(a) * 0.7, Math.cos(a) * 0.6, 2.2, Math.sin(a) * 0.6, 0.45, 0.45, col(Math.random() < 0.5 ? GOLD : HOT), SPARK_STAR, 0, 1, 3);
    }

    if (!this.slammed && this.t >= SLAM_T) this.slam();
    while (this.started < WAVES.length && this.t >= WAVES[this.started].at) this.startWave(this.started++);
    for (const w of this.waves) if (w.on) this.stepWave(w, dt);
    if (this.t >= this.dur) {
      this.finish();
      return false;
    }
    return true;
  }

  stop(): void {
    this.finish();
    for (const w of this.waves) w.on = false;
  }

  private finish(): void {
    if (this.rune >= 0) G.fx.cancel(this.rune);
    this.rune = -1;
  }

  private slam(): void {
    this.slammed = true;
    const p = G.player;
    const a = this.c.area;
    this.cx = p.x;
    this.cz = p.z;
    const x = this.cx;
    const z = this.cz;
    G.fx.explosionEx(x, z, { radius: 2.8 * a, color: GOLD, shake: 1.1, scorch: true, sparks: 1.6, hitStop: 0.09 });
    G.fx.pillar(x, z, GOLD, { radius: 1.4, height: 13, life: 0.8 });
    G.fx.flare(x, 1.2, z, 10, HOT, 0.4);
    VFX.domes.spawn(x, z, 3.4 * a, 0.75, col(GOLD), 1.3, 0.85, 6);
    VFX.decals.spawn(x, z, 6 * a, 2.8, col(GOLD), DECAL_CRACK, 1.3, 0, 0.5, 0.12);
    VFX.decals.spawn(x, z, 4 * a, 0.6, col(HOT), DECAL_GLOW, 1.2, 0, 0.4, 0.2);
    VFX.dark.spawn(x, z, 4.2 * a, 3.2, col("#2a2018"), DECAL_SCORCH, 0.8, 0, 0.7, 0.1);
    // rubble + dust
    G.fx.burst(x, 0.4, z, { count: 26, color: "#8a7a66", speed: 9, life: 0.9, size: 0.32, up: 9, gravity: -24, additive: false, jitter: 1.2 });
    G.fx.smoke(x, 0.4, z, { count: 7, color: DUST, size: 1.6, life: 1.1, spread: 2.2, rise: 1.4 });
    VFX.sparkles.burst(x, 0.5, z, 30, 14, 6, 0.6, 0.6, col(GOLD), SPARK_EMBER, -12, 2, 1);
    G.audio.sfx("stomp", { vol: 1, pitch: 0.8 });
    G.audio.sfx("boom", { vol: 1, pitch: 0.75 });
    G.overlay.screenFlash("#fff1c2", 0.45, 0.3);
    p.ultLanded();
  }

  private startWave(k: number): void {
    const s = WAVES[k];
    const w = this.waves[k];
    const a = this.c.area;
    w.on = true;
    w.t = 0;
    w.T = s.T;
    w.r = s.r * a;
    w.dmg = s.dmg * this.c.power;
    w.kb = s.kb;
    w.dustT = 0;
    w.hit.clear();
    const x = this.cx;
    const z = this.cz;
    G.fx.ring(x, z, { radius: w.r, color: s.color, life: s.T + 0.12, width: 1.6 + k * 0.4, from: RING_FROM });
    G.fx.ring(x, z, { radius: w.r * 1.05, color: "#ffffff", life: s.T, width: 0.3, from: RING_FROM });
    G.fx.ring(x, z, { radius: w.r * 0.9, color: s.color, life: s.T + 0.25, width: 0.55, from: RING_FROM * 0.5 });
    VFX.decals.spawn(x, z, w.r, s.T + 0.2, col(s.color), DECAL_SHOCK, 1.6, 0, RING_FROM, 0.9);
    if (k > 0) {
      G.fx.shake(0.45 + k * 0.2);
      G.audio.sfx(k === WAVES.length - 1 ? "thunder" : "boom", { vol: 0.9, pitch: 0.7 + k * 0.08 });
      G.fx.flash(x, z, { radius: 3 + k, color: s.color, life: 0.3 });
    }
    if (k === WAVES.length - 1) G.overlay.screenFlash("#e8fff8", 0.3, 0.3);
  }

  private stepWave(w: Wave, dt: number): void {
    w.t += dt;
    const k = Math.min(1, w.t / w.T);
    const r = w.r * (RING_FROM + (1 - RING_FROM) * easeOutCubic(k));
    const em = G.enemies;
    const o = this.opts;
    o.fromX = this.cx;
    o.fromZ = this.cz;
    const list = enemiesIn(this.cx, this.cz, r);
    for (let n = 0; n < list.length; n++) {
      const i = list[n];
      if (!w.hit.first(i)) continue;
      // bosses: full damage, no push
      o.kb = em.isBoss(i) ? 0 : w.kb;
      hitEnemy(i, w.dmg, ultKnight.id, o);
    }
    // dust and embers kicked up along the wave front
    w.dustT -= dt;
    if (w.dustT <= 0 && k < 0.9) {
      w.dustT = 0.05;
      for (let j = 0; j < 4; j++) {
        const a = Math.random() * Math.PI * 2;
        const x = this.cx + Math.cos(a) * r;
        const z = this.cz + Math.sin(a) * r;
        VFX.sparkles.spawn(x, 0.25, z, Math.cos(a) * 4, 3 + Math.random() * 3, Math.sin(a) * 4, 0.5, 0.5, col(GOLD), SPARK_EMBER, -10, 1.5);
      }
      // kicked-up dust reads well against the grass
      const a = Math.random() * Math.PI * 2;
      G.fx.smoke(this.cx + Math.cos(a) * r, 0.3, this.cz + Math.sin(a) * r, { count: 2, color: DUST, size: 1.1, life: 0.6, spread: 0.6, rise: 1.6 });
    }
    if (k >= 1) w.on = false;
  }
}

/** icon: golden shockwaves around a slamming bucket helm */
function drawIcon(c: CanvasRenderingContext2D, s: number): void {
  iconBg(c, s, "#1fa39a", "#10262a");
  c.save();
  // shock arcs (bottom)
  c.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    c.strokeStyle = k === 1 ? "rgba(61,224,208,0.95)" : `rgba(255,210,63,${0.95 - k * 0.15})`;
    c.lineWidth = s * (0.07 - k * 0.012);
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.74, s * (0.18 + k * 0.12), s * (0.07 + k * 0.045), 0, Math.PI * 0.95, Math.PI * 2.05);
    c.stroke();
  }
  // ground cracks
  c.strokeStyle = "#0d0f14";
  c.lineWidth = s * 0.03;
  c.beginPath();
  c.moveTo(s * 0.5, s * 0.76);
  c.lineTo(s * 0.4, s * 0.86);
  c.lineTo(s * 0.33, s * 0.84);
  c.moveTo(s * 0.5, s * 0.76);
  c.lineTo(s * 0.62, s * 0.88);
  c.moveTo(s * 0.5, s * 0.76);
  c.lineTo(s * 0.52, s * 0.92);
  c.stroke();
  // impact glow
  const g = c.createRadialGradient(s * 0.5, s * 0.72, 0, s * 0.5, s * 0.72, s * 0.3);
  g.addColorStop(0, "rgba(255,243,176,0.95)");
  g.addColorStop(1, "rgba(255,210,63,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(s * 0.5, s * 0.72, s * 0.3, 0, Math.PI * 2);
  c.fill();
  // bucket helm coming down (speed lines above)
  c.strokeStyle = "rgba(255,255,255,0.7)";
  c.lineWidth = s * 0.025;
  for (const x of [0.36, 0.5, 0.64]) {
    c.beginPath();
    c.moveTo(s * x, s * 0.08);
    c.lineTo(s * x, s * 0.2);
    c.stroke();
  }
  c.lineJoin = "round";
  c.fillStyle = "#cfd8e3";
  c.strokeStyle = "#0d0f14";
  c.lineWidth = s * 0.04;
  c.beginPath();
  c.moveTo(s * 0.3, s * 0.62);
  c.lineTo(s * 0.36, s * 0.27);
  c.lineTo(s * 0.64, s * 0.27);
  c.lineTo(s * 0.7, s * 0.62);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.55)";
  c.fillRect(s * 0.39, s * 0.31, s * 0.05, s * 0.26);
  c.fillStyle = "#8e9cab";
  c.beginPath();
  c.roundRect(s * 0.27, s * 0.58, s * 0.46, s * 0.07, s * 0.03);
  c.fill();
  c.stroke();
  // visor slit
  c.fillStyle = "#0d0f14";
  c.beginPath();
  c.roundRect(s * 0.38, s * 0.44, s * 0.24, s * 0.05, s * 0.02);
  c.fill();
  // red pom-pom
  c.fillStyle = "#ff4d5e";
  c.beginPath();
  c.arc(s * 0.5, s * 0.23, s * 0.055, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.restore();
}

export const ultKnight: UltimateDef = {
  id: "ultKnight",
  name: "ป้อมเหล็กถล่มปฐพี",
  desc: "กระโดดทุบพื้นในเกราะทองอมตะ ปล่อยคลื่นกระแทก 3 ระลอก ผลักฝูงซอมบี้กระเด็น ดาเมจมหาศาล",
  color: GOLD,
  flash: "#fff3c4",
  icon: drawIcon,
  duration: 2.2,
  invuln: 2.6,
  pose: "slam",
  create: () => new IronQuake(),
};
