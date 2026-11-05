import * as THREE from "three";
import { G } from "../core/G";
import type { Proj, ProjSpawn } from "../combat/Projectiles";
import { Marks } from "./marks";

/**
 * Hostile projectiles fired by enemies and bosses.
 *  - "sfdGoo": lobbed toxic glob. Flies in an arc towards a ground target shown
 *    by a filling warning circle, splashes on landing and leaves a puddle.
 *  - "sfdOrbG" / "sfdOrbR": straight bullets (boss volleys), green / red.
 * Every model is a bright core with a dark inverted-hull outline so bullets
 * stay readable on top of a crowded horde.
 */

const GOO = "sfdGoo";
export const ORB_GREEN = "sfdOrbG";
export const ORB_RED = "sfdOrbR";

/** max simultaneous lobbed globs (protects against 60 spitters = bullet hell) */
const MAX_GOO = 14;
let gooInFlight = 0;

/** core + flipped, enlarged dark shell = cheap single-draw toon outline */
function outlined(core: THREE.BufferGeometry, coreColor: string, topColor: string, rimColor: string, rim = 1.28): THREE.BufferGeometry {
  const g = core.index ? core.toNonIndexed() : core.clone();
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const pos = g.attributes.position.array as Float32Array;
  const n = pos.length / 3;
  g.computeBoundingBox();
  const minY = g.boundingBox!.min.y;
  const maxY = g.boundingBox!.max.y;
  const c0 = new THREE.Color(coreColor).convertSRGBToLinear();
  const c1 = new THREE.Color(topColor).convertSRGBToLinear();
  const cr = new THREE.Color(rimColor).convertSRGBToLinear();
  const out = new Float32Array(n * 2 * 3);
  const col = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1];
    const k = Math.pow((y - minY) / Math.max(1e-4, maxY - minY), 1.5);
    out[i * 3] = pos[i * 3];
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = pos[i * 3 + 2];
    col[i * 3] = c0.r + (c1.r - c0.r) * k;
    col[i * 3 + 1] = c0.g + (c1.g - c0.g) * k;
    col[i * 3 + 2] = c0.b + (c1.b - c0.b) * k;
  }
  // shell: scaled copy with reversed winding (renders only its far inner side)
  for (let t = 0; t < n; t += 3) {
    for (let v = 0; v < 3; v++) {
      const src = t + (v === 0 ? 0 : v === 1 ? 2 : 1);
      const dst = n + t + v;
      out[dst * 3] = pos[src * 3] * rim;
      out[dst * 3 + 1] = pos[src * 3 + 1] * rim;
      out[dst * 3 + 2] = pos[src * 3 + 2] * rim;
      col[dst * 3] = cr.r;
      col[dst * 3 + 1] = cr.g;
      col[dst * 3 + 2] = cr.b;
    }
  }
  g.dispose();
  const res = new THREE.BufferGeometry();
  res.setAttribute("position", new THREE.BufferAttribute(out, 3));
  res.setAttribute("color", new THREE.BufferAttribute(col, 3));
  res.computeBoundingSphere();
  return res;
}

export function ensureHostileKinds(): void {
  const pr = G.projectiles;
  if (pr.hasKind(GOO)) return;
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  // goo: lumpy blob (main ball + two bumps)
  const blob = new THREE.SphereGeometry(0.26, 10, 8);
  const bump1 = new THREE.SphereGeometry(0.14, 8, 6).translate(0.17, 0.1, -0.06);
  const bump2 = new THREE.SphereGeometry(0.11, 8, 6).translate(-0.12, -0.05, 0.16);
  const merged = mergeSimple([blob, bump1, bump2]);
  pr.registerKind(GOO, { geometry: outlined(merged, "#4fd11c", "#e6ff8a", "#123300"), material: mat, capacity: 96, spin: 5 });
  const orb = new THREE.IcosahedronGeometry(0.3, 1);
  pr.registerKind(ORB_GREEN, { geometry: outlined(orb, "#3dff7a", "#f2ffd9", "#0b2a12", 1.3), material: mat, capacity: 256, spin: 3 });
  pr.registerKind(ORB_RED, { geometry: outlined(orb.clone(), "#ff3a3a", "#ffe08a", "#2a0505", 1.3), material: mat, capacity: 256, spin: 3 });
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  for (const g of list) g.dispose();
  const res = new THREE.BufferGeometry();
  res.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return res;
}

// ---- lobbed goo ------------------------------------------------------------

interface GooData extends Record<string, unknown> {
  splash: number;
  puddle: number;
  y0: number;
  peak: number;
  trail: number;
}

const spec: ProjSpawn = { kind: GOO, x: 0, z: 0, vx: 0, vz: 0, damage: 0, radius: 0, life: 1, source: "enemy", hostile: true };

function gooUpdate(p: Proj, dt: number): boolean {
  const d = p.data as GooData;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const k = Math.min(1, p.age / p.life);
  p.y = d.y0 * (1 - k) + 0.15 * k + d.peak * 4 * k * (1 - k);
  d.trail -= dt;
  if (d.trail <= 0) {
    d.trail = 0.06;
    G.fx.particles.burst(p.x, p.y, p.z, { count: 1, color: "#9dff4a", speed: 0.4, life: 0.35, size: 0.22, gravity: -3 });
  }
  return true;
}

function gooLand(p: Proj): void {
  gooInFlight = Math.max(0, gooInFlight - 1);
  const d = p.data as GooData;
  const pl = G.player;
  const dx = pl.x - p.x;
  const dz = pl.z - p.z;
  const rr = d.splash + pl.radius * 0.6;
  if (dx * dx + dz * dz < rr * rr) pl.takeDamage(p.damage);
  G.fx.flash(p.x, p.z, { radius: d.splash * 1.3, color: "#7dff3a", life: 0.25 });
  G.fx.particles.burst(p.x, 0.3, p.z, { count: 10, color: "#8cff3a", speed: 3.5, life: 0.45, size: 0.3, gravity: -9, up: 3, additive: false });
  if (d.puddle > 0) Marks.puddle(p.x, p.z, d.splash * 0.95, d.puddle, Math.max(2, Math.round(p.damage * 0.3)));
  G.audio.sfx("spit", { pitch: 0.7, vol: 0.6 });
}

/**
 * Lob a toxic glob from (x,z) to the ground point (tx,tz). A warning circle
 * fills up exactly when it lands. Returns false if the global cap is reached.
 */
export function lobGoo(x: number, z: number, tx: number, tz: number, o: { damage: number; flight?: number; splash?: number; puddle?: number; scale?: number; y0?: number }): boolean {
  if (gooInFlight >= MAX_GOO) return false;
  ensureHostileKinds();
  const flight = o.flight ?? 1.0;
  const splash = o.splash ?? 1.15;
  spec.kind = GOO;
  spec.x = x;
  spec.z = z;
  spec.y = o.y0 ?? 1.1;
  spec.vx = (tx - x) / flight;
  spec.vz = (tz - z) / flight;
  spec.damage = o.damage;
  // negative radius cancels the player's radius: no mid-air hits, the
  // splash on landing (gooLand) is the only way the glob can hurt
  spec.radius = -G.player.radius;
  spec.life = flight;
  spec.scale = o.scale ?? 1;
  spec.update = gooUpdate;
  spec.onExpire = gooLand;
  spec.onHit = undefined;
  const data: GooData = { splash, puddle: o.puddle ?? 2.2, y0: spec.y, peak: 1.6 + Math.hypot(tx - x, tz - z) * 0.12, trail: 0 };
  spec.data = data;
  const p = G.projectiles.spawn(spec);
  if (!p) return false;
  gooInFlight++;
  Marks.circle(tx, tz, splash, flight, 0, "#66ff2e");
  return true;
}

// ---- straight orbs ---------------------------------------------------------

/** shared read-only payloads (no per-shot allocation) */
const ORB_FX: Record<string, { color: string }> = {
  [ORB_GREEN]: { color: "#6aff8a" },
  [ORB_RED]: { color: "#ff6a4a" },
};

function orbHit(p: Proj): void {
  const c = (p.data as { color?: string }).color ?? "#ffffff";
  G.fx.particles.burst(p.x, p.y, p.z, { count: 6, color: c, speed: 3, life: 0.3, size: 0.28 });
}

/** fire a straight hostile bullet. angle uses atan2(dx, dz) */
export function fireOrb(kind: string, x: number, z: number, angle: number, speed: number, damage: number, life = 4, scale = 1): void {
  ensureHostileKinds();
  spec.kind = kind;
  spec.x = x;
  spec.z = z;
  spec.y = 0.75;
  spec.vx = Math.sin(angle) * speed;
  spec.vz = Math.cos(angle) * speed;
  spec.damage = damage;
  spec.radius = 0.3 * scale;
  spec.life = life;
  spec.scale = scale;
  spec.update = undefined;
  spec.onExpire = undefined;
  spec.onHit = orbHit;
  spec.data = ORB_FX[kind];
  G.projectiles.spawn(spec);
}

/** ring of `count` orbs around (x,z), rotated by `offset` radians */
export function orbRing(kind: string, x: number, z: number, count: number, offset: number, speed: number, damage: number): void {
  for (let k = 0; k < count; k++) {
    fireOrb(kind, x, z, offset + (k / count) * Math.PI * 2, speed, damage);
  }
}

/**
 * Spawn one invisible, harmless projectile of each kind (below the ground) so
 * their shaders compile at run start instead of on the first enemy shot.
 */
export function warmUpHostile(): void {
  ensureHostileKinds();
  for (const kind of [GOO, ORB_GREEN, ORB_RED]) {
    spec.kind = kind;
    spec.x = G.player.x;
    spec.z = G.player.z;
    spec.y = -20;
    spec.vx = spec.vz = 0;
    spec.damage = 0;
    spec.radius = -G.player.radius;
    spec.life = 0.1;
    spec.scale = 1;
    spec.update = undefined;
    spec.onExpire = undefined;
    spec.onHit = undefined;
    spec.data = undefined;
    G.projectiles.spawn(spec);
  }
}

/** new run: forget in-flight counters (Projectiles.clear() drops them silently) */
export function resetHostile(): void {
  gooInFlight = 0;
}
