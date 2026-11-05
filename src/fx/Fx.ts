/**
 * Fx — pooled, fire-and-forget visual effects + game-feel helpers.
 *
 * Everything is drawn by a handful of shared batches (no per-effect meshes);
 * an empty batch issues no draw call:
 *   ground glow   (rings, flashes, slashes, vortex, rune)  over the horde
 *   ground decals (goo splats, scorch)                     under the horde
 *   ground warn   (telegraphs)                             over the horde
 *   sprites glow  (sparkles, glows, flares, starbursts)    over the horde
 *   sprites smoke (puffs)                                  depth tested
 *   points glow / solid (sparks / debris)
 *   lightning ribbons, light pillars, thorn spikes
 * All pools have fixed caps and recycle the oldest effect when full.
 *
 * Primitives (stable API, used by weapons/enemies):
 *   ring(x, z, {radius, color, life?, width?, y?, from?})   expanding shockwave ring (bright rim)
 *   flash(x, z, {radius, color, life?, y?})                  soft glowing ground disc
 *   slashArc(x, z, dirX, dirZ, {radius, arc, color, life?, width?, y?})  crescent slash smear
 *   lightning(x1, y1, z1, x2, y2, z2, {color?, life?, width?, jitter?, branches?, impact?})
 *   burst(x, y, z, BurstOpts)                                raw particle burst (= particles.burst)
 *   explosion(x, z, radius, color, shake = 0.25)             layered explosion (see explosionEx)
 *   hitSpark(x, y, z, color = "#ffffff")                      white 4-point star + sparks
 *   enemyDeath(x, z, color, scale, boss)                     goo splat + chunks (boss: bossDeath)
 *   particles.burst / particles.emit                         low-level point particles
 *
 * Reusable helpers:
 *   explosionEx(x, z, {radius, color, shake?, scorch?, smoke?, sparks?, hitStop?, y?})
 *   vortex(x, z, radius, color, life = 1.2, {spin?, arms?, y?})       → handle
 *   pillar(x, z, color, {radius?, height?, life?})                    vertical light beam
 *   decal(x, z, radius, color, life = 2.5, {style?: "splat" | "scorch", alpha?})  → handle
 *   telegraph(x, z, radius, life, color = "#ff3b30")                  → handle (fills up, then vanishes)
 *   rune(x, z, radius, color, life = 1.2, {spin?})                     → handle (rotating magic circle)
 *   sparkle(x, y, z, color = "#ffffff", size = 0.6)                    4-point star sparkle
 *   glowBall(x, y, z, size, color, life = 0.25)                         camera-facing glow
 *   flare(x, y, z, size, color, life = 0.3)                             horizontal lens streak
 *   smoke(x, y, z, {count?, color?, size?, life?, spread?, rise?})
 *   thorns(x, z, radius, {count?, tint?, height?, life?, burst?})      dark thorns erupting from the ground
 *   impact(x, y, z, dirX, dirZ, color = "#ffffff", power = 1)           directional hit spray
 *   bossDeath(x, z, color = "#ffcf5a")                                  multi-stage spectacle
 *   move(handle, x, z) / cancel(handle)                                 control a ground effect
 *
 * Game feel:
 *   shake(amount)                       screen shake (forwards to G.world.shake)
 *   hitStop(seconds = 0.05, scale = 0.05)  brief near-freeze via G.timeScale (auto-restored, rate limited)
 *   slowMo(seconds, scale = 0.3)        slow motion that eases back to normal speed
 */
import * as THREE from "three";
import { G } from "../core/G";
import { glowTexture } from "./textures";
import { Particles, type BurstOpts } from "./Particles";
import { SpriteLayer, Shape, Curve } from "./Sprites";
import { GroundLayer, GMode, type GroundItem } from "./Ground";
import { Bolts } from "./Bolts";
import { Beams } from "./Beams";
import { Thorns } from "./Thorns";
import { rgb, mixInto, WHITE } from "./colors";

export interface RingOpts {
  radius: number;
  color: string;
  life?: number;
  /** ring thickness in world units */
  width?: number;
  /** height above ground */
  y?: number;
  /** starting radius fraction (0..1) for the expansion */
  from?: number;
}

export interface FlashOpts {
  radius: number;
  color: string;
  life?: number;
  y?: number;
}

export interface ArcOpts {
  radius: number;
  /** full arc angle in radians */
  arc: number;
  color: string;
  life?: number;
  width?: number;
  y?: number;
}

export interface BoltOpts {
  color?: string;
  life?: number;
  width?: number;
  /** jaggedness (world units) */
  jitter?: number;
  /** number of side branches (0..3), default by length */
  branches?: number;
  /** glow + sparks at the end point (default true) */
  impact?: boolean;
}

export interface ExplosionOpts {
  radius: number;
  color: string;
  /** screen shake amount (default 0.25) */
  shake?: number;
  /** leave a fading scorch mark (default: radius >= 1.2) */
  scorch?: boolean;
  /** dark smoke puffs (default true) */
  smoke?: boolean;
  /** spark count multiplier (default 1) */
  sparks?: number;
  /** brief hit-stop seconds (default 0) */
  hitStop?: number;
}

export interface VortexOpts {
  /** radians per second (default 7) */
  spin?: number;
  /** spiral arm count (default 3) */
  arms?: number;
  y?: number;
}

export interface PillarOpts {
  radius?: number;
  height?: number;
  life?: number;
}

export interface DecalOpts {
  style?: "splat" | "scorch";
  alpha?: number;
}

export interface ThornOpts {
  /** number of thorns (default 7) */
  count?: number;
  /** tint multiplied over the dark-purple / pink-tip palette (default white) */
  tint?: string;
  /** thorn height in world units (default 1.6) */
  height?: number;
  /** seconds (default 0.7) */
  life?: number;
  /** add a coloured ground burst + debris (default true) */
  burst?: boolean;
}

export interface SmokeOpts {
  count?: number;
  color?: string;
  size?: number;
  life?: number;
  /** horizontal spawn spread radius */
  spread?: number;
  /** upward speed */
  rise?: number;
}

const enum DelayKind {
  Explosion = 0,
  Ring = 1,
  Sparkles = 2,
}

class Delayed {
  active = false;
  t = 0;
  kind: DelayKind = DelayKind.Explosion;
  x = 0;
  z = 0;
  r = 1;
  color = "#ffffff";
}

const LAYER_ADD = 0;
const LAYER_DECAL = 1;
const LAYER_WARN = 2;
const TAU = Math.PI * 2;

/**
 * Visual effects facade. All effects are pooled and fire-and-forget.
 * Weapons should use these helpers instead of creating meshes ad hoc.
 */
export class Fx {
  readonly particles: Particles;
  /** additive billboards: sparkles, glows, flares */
  readonly sprites: SpriteLayer;
  /** normal-blended billboards: smoke */
  readonly smokeLayer: SpriteLayer;
  private groundAdd: GroundLayer;
  private groundDecal: GroundLayer;
  private groundWarn: GroundLayer;
  private bolts: Bolts;
  private beams: Beams;
  private thornLayer: Thorns;
  private delayed: Delayed[] = [];
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();

  /** per-frame counters used to thin out effects during mass events */
  private deathsThisFrame = 0;
  private sparksThisFrame = 0;

  // time warp (hit-stop / slow-mo) state
  private warpBase = 1;
  private warpWritten = NaN;
  private hsStart = 0;
  private hsEnd = 0;
  private hsScale = 1;
  private hsCooldown = 0;
  private smStart = 0;
  private smDur = 0;
  private smScale = 1;
  /** user setting: screen shake multiplier (0 disables) */
  shakeScale = 1;

  constructor(private scene: THREE.Scene) {
    this.particles = new Particles(scene);
    // decals sit under the horde (depth tested); glows, telegraphs and
    // sparkles draw over it so AoE stays readable in a dense crowd
    this.groundDecal = new GroundLayer(scene, 200, false, -6);
    this.groundWarn = new GroundLayer(scene, 48, false, 4, true);
    this.groundAdd = new GroundLayer(scene, 160, true, 5, true);
    this.smokeLayer = new SpriteLayer(scene, 220, false, 6);
    this.sprites = new SpriteLayer(scene, 700, true, 9, true);
    this.bolts = new Bolts(scene);
    this.beams = new Beams(scene, 24);
    this.thornLayer = new Thorns(scene, 256);
    for (let i = 0; i < 32; i++) this.delayed.push(new Delayed());
    this.hookEvents();
    try {
      const s = localStorage.getItem("sfd.shake");
      if (s !== null) this.shakeScale = Math.max(0, Math.min(1.5, parseFloat(s) || 0));
    } catch {
      /* storage unavailable */
    }
  }

  /** game-event driven juice (no other system needs to call these) */
  private hookEvents(): void {
    const ev = G.events;
    if (!ev) return;
    ev.on("enemyKilled", (e) => {
      if (!e.elite || e.boss) return;
      this.hitStop(0.05, 0.08);
      this.ring(e.x, e.z, { radius: 2.4, color: "#ffc34d", life: 0.4, width: 0.45, from: 0.2 });
      this.glowBall(e.x, 1, e.z, 2.4, "#ffd27a", 0.22);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + Math.random();
        this.sprites.spawn(e.x, 1, e.z, Math.cos(a) * 4, 3 + Math.random() * 2, Math.sin(a) * 4, 0.7, 0.1, 0.45, rgb("#fff2c4"), 1, Shape.Star, Curve.Pop, Math.random() * TAU, 4, -8, 1);
      }
    });
    ev.on("pickup", (e) => {
      const p = G.player;
      if (!p) return;
      if (e.kind === "nuke") {
        G.overlay?.screenFlash("#fff1d0", 0.6, 0.45);
        this.pillar(p.x, p.z, "#ffb347", { radius: 1.2, height: 14, life: 0.9 });
        this.rune(p.x, p.z, 4, "#ffb347", 0.9, { spin: 3 });
      } else if (e.kind === "heal") {
        this.ring(p.x, p.z, { radius: 1.8, color: "#5cff7a", life: 0.45, width: 0.35, from: 0.3 });
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * TAU;
          this.sprites.spawn(p.x + Math.cos(a) * 0.6, 0.4, p.z + Math.sin(a) * 0.6, 0, 2.2 + Math.random() * 1.5, 0, 0.5, 0.1, 0.6, rgb("#8dffa0"), 1, Shape.Star, Curve.Pop, 0, 2);
        }
      } else if (e.kind === "magnet") {
        this.ring(p.x, p.z, { radius: 3, color: "#7fd7ff", life: 0.5, width: 0.4, from: 0.2 });
      }
    });
    ev.on("levelUp", () => {
      const p = G.player;
      if (!p) return;
      this.pillar(p.x, p.z, "#ffe27a", { radius: 0.9, height: 9, life: 0.9 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        this.sprites.spawn(p.x + Math.cos(a) * 0.8, 0.5, p.z + Math.sin(a) * 0.8, Math.cos(a) * 1.5, 3 + Math.random() * 2, Math.sin(a) * 1.5, 0.55, 0.1, 0.7, rgb("#fff3b0"), 1, Shape.Star, Curve.Pop, 0, 3, -2, 0.5);
      }
    });
    ev.on("upgradeApplied", (e) => {
      if (e.kind !== "evolve") return;
      const p = G.player;
      if (!p) return;
      G.overlay?.screenFlash("#fff6d8", 0.5, 0.4);
      this.pillar(p.x, p.z, "#ffcf5a", { radius: 1.4, height: 14, life: 1.2 });
      this.rune(p.x, p.z, 3.2, "#ffcf5a", 1.4, { spin: 2.5 });
    });
    ev.on("playerHurt", () => {
      const p = G.player;
      if (!p) return;
      this.glowBall(p.x, 1, p.z, 1.6, "#ff3b30", 0.18);
      this.particles.burst(p.x, 1, p.z, { count: 5, color: "#ff5a4a", speed: 4, life: 0.3, size: 0.2, up: 2, gravity: -8 });
    });
    ev.on("playerDied", () => {
      const p = G.player;
      if (!p) return;
      this.explosionEx(p.x, p.z, { radius: 2.2, color: "#ff3b30", shake: 0.9, scorch: true });
      G.overlay?.screenFlash("#ff2a2a", 0.45, 0.6);
    });
  }

  // ---------------------------------------------------------------- helpers

  /** effect density multiplier: quality setting x current pool pressure */
  private lod(): number {
    const q = G.world.quality === "low" ? 0.5 : G.world.quality === "medium" ? 0.8 : 1;
    const load = Math.max(this.particles.load, this.sprites.n / this.sprites.cap);
    return q * (load > 0.75 ? 0.35 : load > 0.5 ? 0.65 : 1);
  }

  private handle(layer: number, idx: number, gen: number): number {
    return gen * 4096 + layer * 1024 + idx;
  }

  private resolve(h: number): GroundItem | null {
    if (!(h >= 0)) return null;
    const idx = h % 1024;
    const layer = Math.floor(h / 1024) % 4;
    const gen = Math.floor(h / 4096);
    const L = this.layer(layer);
    const it = L.items[idx];
    if (!it || !it.active || it.gen !== gen) return null;
    return it;
  }

  private layer(id: number): GroundLayer {
    return id === LAYER_ADD ? this.groundAdd : id === LAYER_WARN ? this.groundWarn : this.groundDecal;
  }

  private itemHandle(layer: number, it: GroundItem): number {
    const L = this.layer(layer);
    return this.handle(layer, L.items.indexOf(it), it.gen);
  }

  // ------------------------------------------------------------- primitives

  /** expanding shockwave ring on the ground */
  ring(x: number, z: number, o: RingOpts): void {
    const g = this.groundAdd.take(GMode.Ring, x, o.y ?? 0.06, z, o.radius, o.life ?? 0.45, rgb(o.color));
    g.from = o.from ?? 0.2;
    g.w = o.width ?? o.radius * 0.25;
    g.p0 = 0.25;
    this.stepGround(g, 0);
  }

  /** soft glowing disc that fades out (explosion core, muzzle flash) */
  flash(x: number, z: number, o: FlashOpts): void {
    const g = this.groundAdd.take(GMode.Flash, x, o.y ?? 0.08, z, o.radius, o.life ?? 0.25, rgb(o.color));
    g.from = 0.6;
    this.stepGround(g, 0);
  }

  /** sweeping crescent slash centred on direction (dirX, dirZ) */
  slashArc(x: number, z: number, dirX: number, dirZ: number, o: ArcOpts): void {
    const c = rgb(o.color);
    const life = o.life ?? 0.22;
    const rot = Math.atan2(-dirX, -dirZ);
    const half = Math.min(Math.PI, o.arc / 2);
    const y = o.y ?? 0.5;
    const g = this.groundAdd.take(GMode.Arc, x, y, z, o.radius, life, c);
    g.rot = rot;
    g.p0 = half;
    g.inner = Math.max(0.1, 1 - (o.width ?? o.radius * 0.45) / o.radius);
    this.stepGround(g, 0);
    // thinner white echo slightly inside, trailing the main arc
    const e = this.groundAdd.take(GMode.Arc, x, y + 0.02, z, o.radius * 0.84, life * 0.9, mixInto(this.tmpC, c, WHITE, 0.6));
    e.rot = rot;
    e.p0 = half * 0.94;
    e.inner = Math.max(0.3, 1 - (o.width ?? o.radius * 0.45) * 0.45 / (o.radius * 0.84));
    e.alpha = 0.55;
    e.delay = life * 0.12;
    // sparkles flung off the blade edge
    const lod = this.lod();
    const n = Math.round(4 * lod);
    for (let i = 0; i < n; i++) {
      // local arc angle u -> world direction (matches the shader orientation)
      const u = (Math.random() - 0.5) * 2 * half;
      const dx = Math.sin(u - rot);
      const dz = -Math.cos(u - rot);
      const rr = o.radius * (0.75 + Math.random() * 0.25);
      const px = x + dx * rr;
      const pz = z + dz * rr;
      const sp = 2 + Math.random() * 3;
      this.sprites.spawn(px, y + 0.2, pz, dx * sp, 1 + Math.random() * 2, dz * sp, 0.32 + Math.random() * 0.2, 0.05, 0.22 + Math.random() * 0.1, mixInto(this.tmpC2, c, WHITE, 0.5), 1, Shape.Star, Curve.Pop, Math.random() * TAU, 4, -6, 2);
    }
  }

  /** jagged lightning bolt between two points (white core, coloured halo, branches) */
  lightning(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, o: BoltOpts = {}): void {
    const c = rgb(o.color ?? "#bfe9ff");
    const len = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    const branches = o.branches ?? (len > 5 ? 3 : len > 2 ? 2 : 1);
    this.bolts.spawn(x1, y1, z1, x2, y2, z2, c, o.width ?? 0.18, o.jitter ?? 0.35, o.life ?? 0.18, Math.max(0, Math.min(3, branches)));
    if (o.impact === false) return;
    const lod = this.lod();
    this.sprites.spawn(x2, y2 + 0.1, z2, 0, 0, 0, 1.1, 0.5, 0.16, c, 0.7, Shape.Glow, Curve.Pop);
    this.sprites.spawn(x2, y2 + 0.15, z2, 0, 0, 0, 1.0, 0.2, 0.14, c, 1, Shape.Star, Curve.Pop, Math.random() * 0.6);
    const n = Math.round(4 * lod);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = 3 + Math.random() * 4;
      this.particles.emitC(x2, y2 + 0.2, z2, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, 0.25 + Math.random() * 0.15, 0.16, c, true, -8, 3);
    }
    if (y2 < 1.2) {
      const g = this.groundAdd.take(GMode.Flash, x2, 0.07, z2, 1.1, 0.2, c);
      g.from = 0.5;
      this.stepGround(g, 0);
    }
  }

  burst(x: number, y: number, z: number, o: BurstOpts): void {
    this.particles.burst(x, y, z, o);
  }

  /** composite explosion: flash + rings + core glow + sparks + smoke + scorch + shake */
  explosion(x: number, z: number, radius: number, color: string, shake = 0.25): void {
    this.explode(x, z, radius, color, shake, radius >= 1.2, true, 1, 0);
  }

  /** layered explosion with options (see ExplosionOpts) */
  explosionEx(x: number, z: number, o: ExplosionOpts): void {
    this.explode(x, z, o.radius, o.color, o.shake ?? 0.25, o.scorch ?? o.radius >= 1.2, o.smoke !== false, o.sparks ?? 1, o.hitStop ?? 0);
  }

  /** positional (allocation-free) explosion implementation */
  private explode(x: number, z: number, radius: number, color: string, shake: number, scorch: boolean, smoke: boolean, sparkMul: number, hitStop: number): void {
    const r = Math.max(0.3, radius);
    const c = rgb(color);
    const lod = this.lod();
    const hot = mixInto(this.tmpC, c, WHITE, 0.3);
    // ground: flash + main shockwave + fast thin white ring
    const f = this.groundAdd.take(GMode.Flash, x, 0.08, z, r * 1.25, 0.3, c);
    f.from = 0.5;
    this.stepGround(f, 0);
    const g = this.groundAdd.take(GMode.Ring, x, 0.06, z, r * 1.05, 0.42, c);
    g.from = 0.15;
    g.w = r * 0.38;
    g.p0 = 0.5;
    this.stepGround(g, 0);
    const g2 = this.groundAdd.take(GMode.Ring, x, 0.07, z, r * 1.4, 0.26, hot);
    g2.from = 0.35;
    g2.w = Math.max(0.12, r * 0.09);
    this.stepGround(g2, 0);
    // vertical core: big glow + starburst
    const cy = 0.35 + r * 0.3;
    this.sprites.spawn(x, cy, z, 0, 0.6, 0, r * 2.3, r * 1.3, 0.24, hot, 0.85, Shape.Glow, Curve.Pop);
    this.sprites.spawn(x, cy, z, 0, 0, 0, r * 2.0, r * 0.6, 0.16, c, 0.8, Shape.Burst, Curve.Pop, Math.random() * TAU, 2);
    // sparks
    const sparks = Math.round(Math.min(34, 8 + r * 7) * lod * sparkMul);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * TAU;
      const sp = r * (2.2 + Math.random() * 3.2);
      const white = i % 4 === 0;
      this.particles.emitC(x + Math.cos(a) * 0.2, 0.4, z + Math.sin(a) * 0.2, Math.cos(a) * sp, 2 + Math.random() * r * 2.5, Math.sin(a) * sp, 0.4 + Math.random() * 0.35, 0.2 + Math.random() * 0.18, white ? WHITE : c, true, -10, 2.2);
    }
    // a few star sparkles thrown outward
    const stars = Math.round((1 + Math.min(3, r)) * lod);
    for (let i = 0; i < stars; i++) {
      const a = Math.random() * TAU;
      const d = r * (0.3 + Math.random() * 0.6);
      this.sprites.spawn(x + Math.cos(a) * d, 0.5 + Math.random() * r * 0.5, z + Math.sin(a) * d, Math.cos(a) * 2, 1.5, Math.sin(a) * 2, 0.5 + r * 0.12, 0.05, 0.3, hot, 1, Shape.Star, Curve.Pop, Math.random() * TAU, 3, -3, 1);
    }
    // smoke puffs (dark, tinted)
    if (smoke) {
      const puffs = Math.round((2 + Math.min(4, r)) * lod);
      const sc = this.tmpC2.copy(c).multiplyScalar(0.18);
      sc.r += 0.05;
      sc.g += 0.045;
      sc.b += 0.06;
      for (let i = 0; i < puffs; i++) {
        const a = Math.random() * TAU;
        const d = r * Math.random() * 0.55;
        const s = r * (0.45 + Math.random() * 0.3);
        this.smokeLayer.spawn(x + Math.cos(a) * d, 0.5 + Math.random() * 0.5, z + Math.sin(a) * d, Math.cos(a) * r * 0.8, 1.8 + Math.random() * 1.2, Math.sin(a) * r * 0.8, s * 0.5, s * 1.3, 0.55 + Math.random() * 0.3, sc, 0.55, Shape.Puff, Curve.Grow, Math.random() * TAU, (Math.random() - 0.5) * 1.5, 0, 1.6);
      }
    }
    if (scorch) {
      const d = this.groundDecal.take(GMode.Scorch, x, 0.02, z, r * 0.8, 2.4, mixInto(this.tmpC2, c, this.tmpC2.setRGB(0.02, 0.015, 0.02), 0.85));
      d.rot = Math.random() * TAU;
      d.alpha = 0.7;
      this.stepGround(d, 0);
    }
    if (shake > 0) this.shake(shake);
    if (hitStop > 0) this.hitStop(hitStop);
  }

  /** small impact spark at a hit point: white 4-point star + a few coloured sparks */
  hitSpark(x: number, y: number, z: number, color = "#ffffff"): void {
    const c = rgb(color);
    const n = ++this.sparksThisFrame;
    // during huge multi-hits only every other spark gets the star
    if (n < 24 || (n & 1) === 0) {
      const tint = mixInto(this.tmpC, c, WHITE, 0.35);
      this.sprites.spawn(x + (Math.random() - 0.5) * 0.3, y + 0.2, z + (Math.random() - 0.5) * 0.3, 0, 0.4, 0, 0.85 + Math.random() * 0.35, 0.15, 0.18, tint, 1, Shape.Star, Curve.Pop, Math.random() * 0.5 - 0.25);
    }
    if (n < 40) {
      const lod = this.lod();
      const cnt = Math.max(1, Math.round(3 * lod));
      for (let i = 0; i < cnt; i++) {
        const a = Math.random() * TAU;
        const sp = 3 + Math.random() * 3.5;
        this.particles.emitC(x, y, z, Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp, 0.18 + Math.random() * 0.12, 0.17, c, true, -6, 3);
      }
    }
  }

  /** called by EnemyManager.kill */
  enemyDeath(x: number, z: number, color: string, scale: number, boss: boolean): void {
    if (boss) {
      this.bossDeath(x, z, "#ffcf5a", color);
      return;
    }
    const n = ++this.deathsThisFrame;
    const heavy = n > 20;
    const lod = this.lod() * (heavy ? 0.4 : 1);
    const c = rgb(color);
    // goo chunks
    const chunks = Math.max(1, Math.round(5 * lod));
    for (let i = 0; i < chunks; i++) {
      const a = Math.random() * TAU;
      const sp = (1.8 + Math.random() * 2.6) * scale;
      this.particles.emitC(x, 0.55 * scale, z, Math.cos(a) * sp, 2.5 + Math.random() * 3, Math.sin(a) * sp, 0.4 + Math.random() * 0.2, (0.18 + Math.random() * 0.14) * scale, c, false, -16, 1.5);
    }
    // a bone chip or two
    if (Math.random() < 0.8 * lod + 0.1) {
      const a = Math.random() * TAU;
      this.particles.emitC(x, 0.7 * scale, z, Math.cos(a) * 2.2, 4 + Math.random() * 2, Math.sin(a) * 2.2, 0.5, 0.17 * scale, rgb("#f3ead6"), false, -18, 1);
    }
    // quick pale pop
    if (!heavy || (n & 3) === 0) {
      this.sprites.spawn(x, 0.6 * scale, z, 0, 0.5, 0, 0.8 * scale, 0.3 * scale, 0.13, mixInto(this.tmpC, c, WHITE, 0.4), 0.5, Shape.Glow, Curve.Pop);
    }
    // goo splat on the ground
    if (!heavy || (n & 1) === 0) {
      const d = this.groundDecal.take(GMode.Splat, x, 0.02, z, (0.5 + Math.random() * 0.25) * scale, 1.6 + Math.random() * 0.6, this.tmpC.copy(c).multiplyScalar(0.62));
      d.rot = Math.random() * TAU;
      d.alpha = 0.85;
      this.stepGround(d, 0);
    }
  }

  // ---------------------------------------------------------- new helpers

  /** spinning additive swirl on the ground. Returns a handle for move()/cancel(). */
  vortex(x: number, z: number, radius: number, color: string, life = 1.2, o: VortexOpts = {}): number {
    const g = this.groundAdd.take(GMode.Vortex, x, o.y ?? 0.07, z, radius, life, rgb(color));
    g.spin = o.spin ?? 7;
    g.p0 = Math.random() * TAU;
    g.p1 = o.arms ?? 3;
    this.stepGround(g, 0);
    return this.itemHandle(LAYER_ADD, g);
  }

  /** rotating magic rune circle on the ground */
  rune(x: number, z: number, radius: number, color: string, life = 1.2, o: { spin?: number } = {}): number {
    const g = this.groundAdd.take(GMode.Rune, x, 0.065, z, radius, life, rgb(color));
    g.spin = o.spin ?? 1.6;
    g.p0 = Math.random() * TAU;
    this.stepGround(g, 0);
    return this.itemHandle(LAYER_ADD, g);
  }

  /** vertical light beam with a white core */
  pillar(x: number, z: number, color: string, o: PillarOpts = {}): void {
    const c = rgb(color);
    const r = o.radius ?? 0.7;
    const h = o.height ?? 10;
    const life = o.life ?? 0.7;
    this.beams.spawn(x, z, c, r, h, life, false);
    this.beams.spawn(x, z, c, r * 0.45, h * 1.1, life * 0.85, true);
    const g = this.groundAdd.take(GMode.Flash, x, 0.08, z, r * 2.4, life * 0.6, c);
    g.from = 0.4;
    this.stepGround(g, 0);
  }

  /**
   * Dark thorns erupting from the ground in a ring of `radius` around (x, z),
   * leaning outward, then sinking back.
   */
  thorns(x: number, z: number, radius: number, o: ThornOpts = {}): void {
    const n = Math.max(1, Math.round((o.count ?? 7) * Math.max(0.5, this.lod())));
    const tint = rgb(o.tint ?? "#ffffff");
    const h = o.height ?? 1.6;
    const life = o.life ?? 0.7;
    const off = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU + (Math.random() - 0.5) * 0.5;
      const d = radius * (0.25 + Math.random() * 0.75);
      const tx = x + Math.cos(a) * d;
      const tz = z + Math.sin(a) * d;
      const yaw = Math.atan2(Math.cos(a), Math.sin(a));
      const hh = h * (0.6 + Math.random() * 0.6);
      this.thornLayer.spawn(tx, tz, yaw, 0.25 + Math.random() * 0.45, hh, hh * (0.16 + Math.random() * 0.06), life * (0.85 + Math.random() * 0.3), Math.random() * 0.08, tint);
    }
    // a big central thorn
    this.thornLayer.spawn(x, z, Math.random() * TAU, 0.1, h * 1.5, h * 0.26, life, 0, tint);
    if (o.burst !== false) {
      const glow = this.tmpC.copy(rgb("#c34dff")).multiply(tint);
      const g = this.groundAdd.take(GMode.Flash, x, 0.08, z, radius * 1.3, 0.35, glow);
      g.from = 0.5;
      this.stepGround(g, 0);
      const r = this.groundAdd.take(GMode.Ring, x, 0.06, z, radius * 1.15, 0.4, glow);
      r.from = 0.3;
      r.w = radius * 0.2;
      this.stepGround(r, 0);
      this.particles.burst(x, 0.3, z, { count: Math.round(8 * this.lod()), color: "#2a1036", speed: radius * 2.5, life: 0.5, size: 0.22, up: 4, gravity: -14, additive: false, jitter: radius });
      const d = this.groundDecal.take(GMode.Scorch, x, 0.02, z, radius * 1.1, life + 0.8, this.tmpC2.setRGB(0.06, 0.01, 0.08));
      d.alpha = 0.6;
      this.stepGround(d, 0);
    }
  }

  /** fading ground mark (goo splat or scorch). Returns a handle. */
  decal(x: number, z: number, radius: number, color: string, life = 2.5, o: DecalOpts = {}): number {
    const g = this.groundDecal.take(o.style === "scorch" ? GMode.Scorch : GMode.Splat, x, 0.02, z, radius, life, rgb(color));
    g.rot = Math.random() * TAU;
    g.alpha = o.alpha ?? (o.style === "scorch" ? 0.7 : 0.85);
    this.stepGround(g, 0);
    return this.itemHandle(LAYER_DECAL, g);
  }

  /** warning circle that fills from the centre over `life` seconds. Returns a handle. */
  telegraph(x: number, z: number, radius: number, life: number, color = "#ff3b30"): number {
    const g = this.groundWarn.take(GMode.Telegraph, x, 0.025, z, radius, life, rgb(color));
    this.stepGround(g, 0);
    return this.itemHandle(LAYER_WARN, g);
  }

  /** 4-point star sparkle */
  sparkle(x: number, y: number, z: number, color = "#ffffff", size = 0.6): void {
    this.sprites.spawn(x, y, z, 0, 0.3, 0, size, size * 0.1, 0.22, mixInto(this.tmpC, rgb(color), WHITE, 0.4), 1, Shape.Star, Curve.Pop, (Math.random() - 0.5) * 0.8, 1.5);
  }

  /** camera-facing soft glow (muzzle flashes, orbs, impact cores) */
  glowBall(x: number, y: number, z: number, size: number, color: string, life = 0.25): void {
    this.sprites.spawn(x, y, z, 0, 0, 0, size, size * 0.5, life, rgb(color), 1, Shape.Glow, Curve.Pop);
  }

  /** horizontal anamorphic lens streak */
  flare(x: number, y: number, z: number, size: number, color: string, life = 0.3): void {
    this.sprites.spawn(x, y, z, 0, 0, 0, size, size * 1.2, life, rgb(color), 1, Shape.Flare, Curve.Fade);
  }

  /** rising smoke puffs (normal blended) */
  smoke(x: number, y: number, z: number, o: SmokeOpts = {}): void {
    const c = rgb(o.color ?? "#3a3440");
    const n = Math.max(1, Math.round((o.count ?? 3) * this.lod()));
    const size = o.size ?? 0.8;
    const spread = o.spread ?? 0.4;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const d = Math.random() * spread;
      this.smokeLayer.spawn(x + Math.cos(a) * d, y, z + Math.sin(a) * d, Math.cos(a) * 0.5, (o.rise ?? 1) * (0.6 + Math.random() * 0.6), Math.sin(a) * 0.5, size * 0.6, size * 1.5, (o.life ?? 0.9) * (0.8 + Math.random() * 0.4), c, 0.65, Shape.Puff, Curve.Grow, Math.random() * TAU, (Math.random() - 0.5) * 1.2, 0, 1.5);
    }
  }

  /** directional impact: star + spark spray along (dirX, dirZ) */
  impact(x: number, y: number, z: number, dirX: number, dirZ: number, color = "#ffffff", power = 1): void {
    const c = rgb(color);
    const l = Math.hypot(dirX, dirZ) || 1;
    const dx = dirX / l;
    const dz = dirZ / l;
    this.sprites.spawn(x, y, z, 0, 0, 0, 0.8 * power, 0.1, 0.16, mixInto(this.tmpC, c, WHITE, 0.6), 1, Shape.Star, Curve.Pop, Math.random() * 0.5);
    this.sprites.spawn(x, y, z, 0, 0, 0, 1.1 * power, 0.4, 0.12, c, 0.8, Shape.Glow, Curve.Pop);
    const n = Math.round(6 * power * this.lod());
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dz, dx) + (Math.random() - 0.5) * 1.1;
      const sp = (4 + Math.random() * 5) * power;
      this.particles.emitC(x, y, z, Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp, 0.2 + Math.random() * 0.15, 0.16, i % 3 === 0 ? WHITE : c, true, -8, 3);
    }
  }

  /** multi-stage boss death spectacle */
  bossDeath(x: number, z: number, color = "#ffcf5a", gooColor?: string): void {
    const c = rgb(color);
    const cw = mixInto(this.tmpC2, c, WHITE, 0.3);
    this.slowMo(1.1, 0.25);
    this.shake(1.1);
    G.overlay?.screenFlash("#fff6d8", 0.75, 0.45);
    this.explode(x, z, 3.6, color, 0, true, true, 1.5, 0);
    this.pillar(x, z, color, { radius: 1.6, height: 16, life: 1.5 });
    const v = this.resolve(this.vortex(x, z, 4.2, color, 1.4, { spin: 9, arms: 4 }));
    if (v) v.alpha = 0.7;
    const rn = this.resolve(this.rune(x, z, 6.5, color, 1.6, { spin: 2.2 }));
    if (rn) rn.alpha = 0.75;
    this.flare(x, 1.6, z, 9, color, 0.6);
    this.sprites.spawn(x, 1.5, z, 0, 0, 0, 7, 3, 0.5, WHITE, 1, Shape.Burst, Curve.Pop, 0, 1.2);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU;
      const sp = 3 + Math.random() * 6;
      this.sprites.spawn(x, 1 + Math.random(), z, Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp, 0.7 + Math.random() * 0.5, 0.1, 0.7 + Math.random() * 0.4, i % 3 === 0 ? WHITE : cw, 1, Shape.Star, Curve.Pop, Math.random() * TAU, 5, -6, 0.8);
    }
    const goo = rgb(gooColor ?? color);
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * TAU;
      const sp = 3 + Math.random() * 6;
      this.particles.emitC(x, 1.2, z, Math.cos(a) * sp, 4 + Math.random() * 6, Math.sin(a) * sp, 0.8 + Math.random() * 0.5, 0.3 + Math.random() * 0.3, i % 4 === 0 ? rgb("#f3ead6") : goo, false, -16, 0.8);
    }
    this.decal(x, z, 3.2, gooColor ?? color, 4, { style: "splat", alpha: 0.8 });
    // delayed secondary blasts around the body, then a final wide ring
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.random() * 0.8;
      const d = 1.8 + Math.random() * 1.6;
      this.schedule(0.12 + i * 0.13, DelayKind.Explosion, x + Math.cos(a) * d, z + Math.sin(a) * d, 1.6 + Math.random() * 0.9, color);
    }
    this.schedule(0.35, DelayKind.Sparkles, x, z, 4, "#ffffff");
    this.schedule(0.7, DelayKind.Ring, x, z, 11, color);
    this.ring(x, z, { radius: 9, color: "#ffffff", life: 0.6, width: 0.5, from: 0.1 });
  }

  /** move a ground effect (vortex / decal / telegraph / rune) created earlier */
  move(handle: number, x: number, z: number): void {
    const it = this.resolve(handle);
    if (!it) return;
    it.x = x;
    it.z = z;
  }

  /** stop a ground effect early */
  cancel(handle: number): void {
    const it = this.resolve(handle);
    if (it) it.active = false;
  }

  /** true while the effect behind `handle` is still playing */
  alive(handle: number): boolean {
    return this.resolve(handle) !== null;
  }

  private schedule(delay: number, kind: DelayKind, x: number, z: number, r: number, color: string): void {
    let d: Delayed | null = null;
    for (const q of this.delayed) {
      if (!q.active) {
        d = q;
        break;
      }
    }
    if (!d) return;
    d.active = true;
    d.t = delay;
    d.kind = kind;
    d.x = x;
    d.z = z;
    d.r = r;
    d.color = color;
  }

  // -------------------------------------------------------------- game feel

  /** screen shake (respects the user's shake setting) */
  shake(amount: number): void {
    if (this.shakeScale <= 0) return;
    G.world.shake(amount * this.shakeScale);
  }

  /**
   * Brief near-freeze for heavy hits. Scales G.timeScale and restores it
   * after `seconds` of real time. Rate limited so rapid hits don't stutter.
   */
  hitStop(seconds = 0.05, scale = 0.05): void {
    if (G.state !== "playing") return;
    const now = G.realTime;
    if (now < this.hsEnd) {
      // already frozen: deepen / extend a little, but never beyond 0.2s total
      this.hsScale = Math.min(this.hsScale, scale);
      this.hsEnd = Math.min(this.hsStart + 0.2, Math.max(this.hsEnd, now + seconds * 0.5));
      this.applyWarp();
      return;
    }
    if (now < this.hsCooldown) return;
    this.beginWarp();
    this.hsStart = now;
    this.hsEnd = now + Math.min(0.2, seconds);
    this.hsScale = scale;
    this.hsCooldown = this.hsEnd + 0.15;
    this.applyWarp();
  }

  /** slow motion that eases back to full speed over `seconds` (real time) */
  slowMo(seconds: number, scale = 0.3): void {
    if (G.state !== "playing") return;
    this.beginWarp();
    this.smStart = G.realTime;
    this.smDur = Math.max(0.05, seconds);
    this.smScale = scale;
    this.applyWarp();
  }

  private warpActive(): boolean {
    return !Number.isNaN(this.warpWritten);
  }

  private beginWarp(): void {
    if (!this.warpActive()) {
      this.warpBase = G.timeScale;
    } else if (G.timeScale !== this.warpWritten) {
      // someone else changed the time scale meanwhile: treat it as the new base
      this.warpBase = G.timeScale;
    }
  }

  private warpMul(now: number): number {
    let m = 1;
    if (now < this.hsEnd) m = Math.min(m, this.hsScale);
    if (this.smDur > 0) {
      const k = (now - this.smStart) / this.smDur;
      if (k < 1) {
        const e = k * k * (3 - 2 * k);
        m = Math.min(m, this.smScale + (1 - this.smScale) * e);
      } else this.smDur = 0;
    }
    return m;
  }

  private applyWarp(): void {
    const m = this.warpMul(G.realTime);
    if (G.timeScale !== this.warpWritten && this.warpActive()) this.warpBase = G.timeScale;
    if (m >= 1) {
      if (this.warpActive()) {
        if (G.timeScale === this.warpWritten) G.timeScale = this.warpBase;
        this.warpWritten = NaN;
      }
      return;
    }
    G.timeScale = this.warpBase * m;
    this.warpWritten = G.timeScale;
  }

  // ------------------------------------------------------------------ update

  /** advance one ground item; dt = scaled frame time */
  private stepGround(g: GroundItem, dt: number): void {
    if (g.delay > 0) {
      g.delay -= dt;
      if (g.delay > 0) return;
      dt = -g.delay;
      g.delay = 0;
    }
    g.t += dt;
    const k = Math.min(1, g.t / g.life);
    switch (g.mode) {
      case GMode.Ring: {
        const e = 1 - (1 - k) * (1 - k) * (1 - k);
        const r = g.radius * (g.from + (1 - g.from) * e);
        g.curRadius = Math.max(0.01, r);
        g.inner = Math.max(0.03, 1 - (g.w * (1 - 0.55 * k)) / g.curRadius);
        g.curAlpha = (1 - k * k) * (k < 0.06 ? 0.6 + k * 6.6 : 1);
        g.p0 = g.p0 * (1 - k);
        break;
      }
      case GMode.Flash: {
        g.curRadius = g.radius * (g.from + (1 - g.from) * Math.min(1, k * 3));
        g.curAlpha = (1 - k) * (1 - k) * 1.6;
        break;
      }
      case GMode.Arc: {
        g.curRadius = g.radius * (0.9 + 0.1 * (1 - (1 - k) * (1 - k)));
        g.p1 = Math.min(1.3, k * 2.1);
        g.curAlpha = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
        break;
      }
      case GMode.Vortex:
      case GMode.Rune: {
        g.p0 += g.spin * dt;
        const kin = Math.min(1, g.t / Math.min(0.2, g.life * 0.25));
        g.curRadius = g.radius * (0.55 + 0.45 * (1 - (1 - kin) * (1 - kin)));
        g.curAlpha = kin * (k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1);
        g.rot = 0;
        break;
      }
      case GMode.Telegraph: {
        g.p0 = k;
        g.p1 += dt * 14;
        const fadeIn = Math.min(1, g.t / 0.12);
        g.curAlpha = fadeIn * (k > 0.97 ? 1 - (k - 0.97) / 0.03 : 1);
        g.curRadius = g.radius * (0.85 + 0.15 * fadeIn);
        break;
      }
      case GMode.Splat: {
        const pop = k * g.life < 0.08 ? 0.55 + (k * g.life) / 0.08 * 0.55 : k * g.life < 0.14 ? 1.1 - ((k * g.life - 0.08) / 0.06) * 0.1 : 1;
        g.curRadius = g.radius * pop;
        g.curAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        break;
      }
      case GMode.Scorch: {
        g.curRadius = g.radius * Math.min(1, 0.6 + g.t * 6);
        g.curAlpha = k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6;
        break;
      }
    }
    if (g.t >= g.life) g.active = false;
  }

  update(dt: number): void {
    this.deathsThisFrame = 0;
    this.sparksThisFrame = 0;
    if (this.warpActive() || this.smDur > 0) this.applyWarp();

    for (const d of this.delayed) {
      if (!d.active) continue;
      d.t -= dt;
      if (d.t > 0) continue;
      d.active = false;
      if (d.kind === DelayKind.Explosion) this.explode(d.x, d.z, d.r, d.color, 0.35, true, true, 1, 0);
      else if (d.kind === DelayKind.Ring) this.ring(d.x, d.z, { radius: d.r, color: d.color, life: 0.8, width: 1.2, from: 0.2 });
      else {
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * TAU;
          const rr = Math.random() * d.r;
          this.sparkle(d.x + Math.cos(a) * rr, 0.5 + Math.random() * 2, d.z + Math.sin(a) * rr, d.color, 0.5 + Math.random() * 0.5);
        }
      }
    }

    for (const g of this.groundAdd.items) if (g.active) this.stepGround(g, dt);
    for (const g of this.groundDecal.items) if (g.active) this.stepGround(g, dt);
    for (const g of this.groundWarn.items) if (g.active) this.stepGround(g, dt);
    this.groundAdd.upload();
    this.groundDecal.upload();
    this.groundWarn.upload();
    this.sprites.update(dt);
    this.smokeLayer.update(dt);
    this.bolts.update(dt);
    this.beams.update(dt);
    this.thornLayer.update(dt);
    this.particles.update(dt);
    G.perf.particles = this.particles.count + this.sprites.n + this.smokeLayer.n;
  }

  clear(): void {
    this.groundAdd.clear();
    this.groundDecal.clear();
    this.groundWarn.clear();
    this.sprites.clear();
    this.smokeLayer.clear();
    this.bolts.clear();
    this.beams.clear();
    this.thornLayer.clear();
    this.particles.clear();
    for (const d of this.delayed) d.active = false;
    // drop any pending time warp without touching G.timeScale (callers reset it)
    this.warpWritten = NaN;
    this.hsEnd = 0;
    this.smDur = 0;
  }

  dispose(): void {
    this.clear();
    this.groundAdd.dispose();
    this.groundDecal.dispose();
    this.groundWarn.dispose();
    this.sprites.dispose();
    this.smokeLayer.dispose();
    this.bolts.dispose();
    this.beams.dispose();
    this.thornLayer.dispose();
    this.particles.dispose();
    void this.scene;
  }

  /** generic glow sprite texture for weapons that need one */
  static glow(): THREE.Texture {
    return glowTexture();
  }
}
