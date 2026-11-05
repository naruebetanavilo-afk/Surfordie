import { G } from "../core/G";
import type { EnemyManager } from "./EnemyManager";
import { Marks } from "./marks";
import { lobGoo } from "./hostile";

/**
 * Behaviour hooks for the regular roster (EnemyDef.update / onSpawn / onDeath).
 *
 * Register conventions for every non-boss type:
 *   ai0 = mode (0 = default chase; MODE_STAMPEDE = scripted charge set by the director)
 *   ai1 = timer
 *   ai2 = aux (stampede heading, fuse x ...)
 *   ai3 = aux (stampede speed, fuse z ...)
 * Bosses keep their richer state in bosses.ts (keyed by uid).
 */

export const MODE_STAMPEDE = 9;

/** move towards (tx,tz) at speed * mul, turn smoothly and animate the walk */
export function steerTo(em: EnemyManager, i: number, dt: number, tx: number, tz: number, mul = 1, turn = 8): void {
  const dx = tx - em.x[i];
  const dz = tz - em.z[i];
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const sp = em.speed[i] * em.slowMul[i] * mul;
  em.x[i] += (dx / d) * sp * dt;
  em.z[i] += (dz / d) * sp * dt;
  faceAngle(em, i, dt, Math.atan2(dx, dz), turn);
  em.walk[i] = em.def(i).walkRate * em.slowMul[i] * Math.min(1.6, Math.max(0.35, mul));
}

/** smoothly rotate yaw towards `target` (atan2(dx, dz) convention) */
export function faceAngle(em: EnemyManager, i: number, dt: number, target: number, rate = 8): void {
  let diff = target - em.yaw[i];
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  em.yaw[i] += diff * Math.min(1, dt * rate);
}

export function facePlayer(em: EnemyManager, i: number, dt: number, rate = 8): void {
  faceAngle(em, i, dt, Math.atan2(G.player.x - em.x[i], G.player.z - em.z[i]), rate);
}

// ---- director-scripted stampede ---------------------------------------------

/** make enemy `i` charge straight along `angle` for `time` seconds at `speed` */
export function startStampede(em: EnemyManager, i: number, angle: number, speed: number, time: number): void {
  em.ai0[i] = MODE_STAMPEDE;
  em.ai1[i] = time;
  em.ai2[i] = angle;
  em.ai3[i] = speed;
  em.yaw[i] = angle;
}

function stampede(em: EnemyManager, i: number, dt: number): boolean {
  em.ai1[i] -= dt;
  if (em.ai1[i] <= 0) {
    em.ai0[i] = 0;
    return false;
  }
  const a = em.ai2[i];
  const sp = em.ai3[i] * em.slowMul[i];
  em.x[i] += Math.sin(a) * sp * dt;
  em.z[i] += Math.cos(a) * sp * dt;
  em.yaw[i] = a;
  em.walk[i] = em.def(i).walkRate * 1.8;
  return true;
}

/** plain chasers that can join stampedes (shambler, runner, brute, shield) */
export function chaserUpdate(em: EnemyManager, i: number, dt: number): boolean {
  if (em.ai0[i] === MODE_STAMPEDE) return stampede(em, i, dt);
  return false;
}

// ---- mummy: lurching gait ---------------------------------------------------

export function mummyUpdate(em: EnemyManager, i: number, dt: number): boolean {
  if (em.ai0[i] === MODE_STAMPEDE) return stampede(em, i, dt);
  // drag-step rhythm: surge, pause, surge
  const s = Math.sin(em.age[i] * 3.4 + em.phase[i]);
  const mul = 0.45 + 0.95 * (s > 0 ? s : 0);
  steerTo(em, i, dt, G.player.x, G.player.z, mul, 5);
  return true;
}

// ---- ghost: weaving flight --------------------------------------------------

export function ghostUpdate(em: EnemyManager, i: number, dt: number): boolean {
  if (em.ai0[i] === MODE_STAMPEDE) return stampede(em, i, dt);
  const p = G.player;
  const dx = p.x - em.x[i];
  const dz = p.z - em.z[i];
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  // weave sideways; weave fades out when close so they still connect
  const w = Math.sin(em.age[i] * 4.2 + em.phase[i]) * Math.min(1, d / 4) * 0.9;
  const nx = dx / d - (dz / d) * w;
  const nz = dz / d + (dx / d) * w;
  const l = Math.hypot(nx, nz) || 1;
  const sp = em.speed[i] * em.slowMul[i];
  em.x[i] += (nx / l) * sp * dt;
  em.z[i] += (nz / l) * sp * dt;
  faceAngle(em, i, dt, Math.atan2(nx, nz), 10);
  em.walk[i] = em.def(i).walkRate;
  return true;
}

// ---- spitter: keeps distance and lobs goo -----------------------------------

const SPIT_WIND = 0.7;

export function spitterSpawn(em: EnemyManager, i: number): void {
  em.ai1[i] = 1.5 + G.rng.next() * 2;
}

export function spitterUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const p = G.player;
  const dx = p.x - em.x[i];
  const dz = p.z - em.z[i];
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  if (em.ai0[i] === 1) {
    // wind-up: stand still, swell (white pulse) then spit
    em.walk[i] = 0;
    facePlayer(em, i, dt, 10);
    em.ai1[i] -= dt;
    const k = 1 - em.ai1[i] / SPIT_WIND;
    em.flash[i] = Math.max(em.flash[i], 0.25 + 0.35 * k * (0.5 + 0.5 * Math.sin(em.age[i] * 38)));
    if (em.ai1[i] <= 0) {
      // aim slightly ahead of a moving player
      const lead = 0.45;
      let tx = p.x + p.velX * lead;
      let tz = p.z + p.velZ * lead;
      const tdx = tx - em.x[i];
      const tdz = tz - em.z[i];
      const td = Math.hypot(tdx, tdz);
      if (td > 11) {
        tx = em.x[i] + (tdx / td) * 11;
        tz = em.z[i] + (tdz / td) * 11;
      }
      const ok = lobGoo(em.x[i] + Math.sin(em.yaw[i]) * 0.4, em.z[i] + Math.cos(em.yaw[i]) * 0.4, tx, tz, {
        damage: em.dmg[i] * 2.2,
        flight: 0.95 + td * 0.03,
        splash: 1.15,
        puddle: 2.2,
        y0: 1.1 * em.scale[i],
      });
      if (ok) G.audio.sfx("spit");
      em.ai0[i] = 0;
      em.ai1[i] = ok ? 3.4 + G.rng.next() * 1.6 : 0.8;
    }
    return true;
  }
  em.ai1[i] -= dt;
  if (em.ai1[i] <= 0 && d < 11 && G.world.onScreen(em.x[i], em.z[i], -0.6)) {
    em.ai0[i] = 1;
    em.ai1[i] = SPIT_WIND;
    return true;
  }
  if (d > 8.5) {
    steerTo(em, i, dt, p.x, p.z, 1);
  } else if (d < 5.2) {
    // back off while facing the player
    steerTo(em, i, dt, em.x[i] - dx, em.z[i] - dz, 0.75);
    facePlayer(em, i, dt, 12);
  } else {
    // strafe around the player (direction from uid parity)
    const s = em.uid[i] & 1 ? 1 : -1;
    steerTo(em, i, dt, em.x[i] - (dz / d) * s, em.z[i] + (dx / d) * s, 0.45);
    facePlayer(em, i, dt, 12);
  }
  return true;
}

// ---- bloater: fuse + explosion near the player -------------------------------

const FUSE = 1.0;
export const BLOAT_RADIUS = 2.5;

export function bloaterUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const p = G.player;
  if (em.ai0[i] === 1) {
    em.walk[i] = 0;
    em.ai1[i] -= dt;
    const k = 1 - em.ai1[i] / FUSE;
    // flashing faster and faster
    em.flash[i] = Math.max(em.flash[i], Math.sin(em.age[i] * (18 + k * 50)) > 0 ? 0.85 : 0.1);
    // stay on the telegraph centre
    em.x[i] = em.ai2[i];
    em.z[i] = em.ai3[i];
    em.kx[i] = em.kz[i] = 0;
    if (em.ai1[i] <= 0) explodeBloater(em, i);
    return true;
  }
  if (em.ai0[i] === MODE_STAMPEDE) return stampede(em, i, dt);
  const dx = p.x - em.x[i];
  const dz = p.z - em.z[i];
  if (dx * dx + dz * dz < 2.3 * 2.3 && !p.dead) {
    em.ai0[i] = 1;
    em.ai1[i] = FUSE;
    em.ai2[i] = em.x[i];
    em.ai3[i] = em.z[i];
    Marks.circle(em.x[i], em.z[i], BLOAT_RADIUS, FUSE, em.uid[i], "#ff6a1a");
    G.audio.sfx("warn", { vol: 0.6, pitch: 1.3 });
    return true;
  }
  return false;
}

function explodeBloater(em: EnemyManager, i: number): void {
  const x = em.x[i];
  const z = em.z[i];
  em.ai0[i] = 2; // exploded (onDeath skips the harmless pop)
  const p = G.player;
  const dx = p.x - x;
  const dz = p.z - z;
  const rr = BLOAT_RADIUS + p.radius * 0.5;
  if (dx * dx + dz * dz < rr * rr) p.takeDamage(em.dmg[i] * 3);
  G.fx.explosion(x, z, BLOAT_RADIUS, "#b8ff3a", 0.45);
  G.fx.particles.burst(x, 0.8, z, { count: 18, color: "#d8ff5a", speed: 6, life: 0.6, size: 0.45, gravity: -10, up: 4, additive: false });
  G.audio.sfx("boom", { vol: 0.8 });
  // shove the crowd away from the blast
  em.queryCircle(x, z, BLOAT_RADIUS, (j) => {
    if (j !== i) em.knock(j, em.x[j] - x, em.z[j] - z, 14);
  });
  em.kill(i, "bloater");
}

export function bloaterDeath(em: EnemyManager, i: number): void {
  Marks.killOwner(em.uid[i]);
  if (em.ai0[i] === 2) return;
  // popped before it could blow: harmless splash
  G.fx.particles.burst(em.x[i], 0.8, em.z[i], { count: 12, color: "#d8ff5a", speed: 4.5, life: 0.5, size: 0.35, gravity: -10, up: 3, additive: false });
  G.fx.flash(em.x[i], em.z[i], { radius: 1.4, color: "#b8ff3a", life: 0.2 });
}
