import { G } from "../core/G";
import type { EnemyManager } from "./EnemyManager";
import { Marks } from "./marks";
import { MODE_STAMPEDE, stampede, steerTo, facePlayer } from "./ai";
import { lobSnowball } from "./hostile";
import { chillPlayer } from "./chill";
import { IceFx } from "./iceFx";

/**
 * Behaviour hooks for the frozen-graveyard roster (stage "snow").
 * Register conventions as in ai.ts: ai0 = mode (MODE_STAMPEDE = director
 * charge), ai1 = timer, ai2/ai3 = aux. Every type can join stampedes.
 */

// ---- frost wolf: flanking pack runner with a telegraphed lunge ---------------

const W_RUN = 0;
const W_CROUCH = 1;
const W_LUNGE = 2;
const W_RECOVER = 3;
const CROUCH_T = 0.42;
const LUNGE_T = 0.36;

export function wolfSpawn(em: EnemyManager, i: number): void {
  // ai3 = lunge cooldown
  em.ai3[i] = 0.8 + G.rng.next() * 2;
}

export function wolfUpdate(em: EnemyManager, i: number, dt: number): boolean {
  if (em.ai0[i] === MODE_STAMPEDE) {
    if (stampede(em, i, dt)) return true;
    em.ai3[i] = 0.8;
  }
  const p = G.player;
  const dx = p.x - em.x[i];
  const dz = p.z - em.z[i];
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  switch (em.ai0[i]) {
    case W_CROUCH: {
      // wind-up: drop low, flash, lock the direction at the end
      em.walk[i] = 0;
      facePlayer(em, i, dt, 14);
      em.ai1[i] -= dt;
      const k = 1 - em.ai1[i] / CROUCH_T;
      em.flash[i] = Math.max(em.flash[i], 0.2 + 0.45 * k * (0.5 + 0.5 * Math.sin(em.age[i] * 40)));
      if (em.ai1[i] <= 0) {
        em.ai0[i] = W_LUNGE;
        em.ai1[i] = LUNGE_T;
        em.ai2[i] = Math.atan2(dx, dz);
      }
      return true;
    }
    case W_LUNGE: {
      em.ai1[i] -= dt;
      const a = em.ai2[i];
      const sp = em.speed[i] * 2.7 * em.slowMul[i];
      em.x[i] += Math.sin(a) * sp * dt;
      em.z[i] += Math.cos(a) * sp * dt;
      em.yaw[i] = a;
      em.walk[i] = em.def(i).walkRate * 2.2;
      if (em.ai1[i] <= 0) {
        em.ai0[i] = W_RECOVER;
        em.ai1[i] = 0.45;
        if (G.world.onScreen(em.x[i], em.z[i])) {
          G.fx.particles.burst(em.x[i], 0.15, em.z[i], { count: 3, color: "#ffffff", speed: 1.6, life: 0.35, size: 0.3, up: 1, gravity: -4, additive: false });
        }
      }
      return true;
    }
    case W_RECOVER:
      em.ai1[i] -= dt;
      steerTo(em, i, dt, p.x, p.z, 0.35, 4);
      if (em.ai1[i] <= 0) {
        em.ai0[i] = W_RUN;
        em.ai3[i] = 2.2 + G.rng.next() * 1.4;
      }
      return true;
    default: {
      em.ai3[i] -= dt;
      if (em.ai3[i] <= 0 && d < 4.4 && d > 1.3 && !p.dead && G.world.onScreen(em.x[i], em.z[i], -0.3)) {
        em.ai0[i] = W_CROUCH;
        em.ai1[i] = CROUCH_T;
        return true;
      }
      // flank: run at a point beside the player (side from uid parity), converging when close
      const side = em.uid[i] & 1 ? 1 : -1;
      const off = Math.min(2.6, d * 0.4) * side;
      steerTo(em, i, dt, p.x - (dz / d) * off, p.z + (dx / d) * off, 1, 9);
      return true;
    }
  }
}

// ---- ice zombie: lurching tank whose touch chills ----------------------------

export function iceZombieUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const p = G.player;
  if (em.ai0[i] === MODE_STAMPEDE && stampede(em, i, dt)) {
    touchChill(em, i, p.x, p.z);
    return true;
  }
  const s = Math.sin(em.age[i] * 2.6 + em.phase[i]);
  steerTo(em, i, dt, p.x, p.z, 0.72 + 0.45 * (s > 0 ? s : 0), 5);
  touchChill(em, i, p.x, p.z);
  // a frosty breath puff now and then (cosmetic)
  em.ai1[i] -= dt;
  if (em.ai1[i] <= 0) {
    em.ai1[i] = 1.6 + Math.random() * 2;
    if (G.world.onScreen(em.x[i], em.z[i])) {
      const fx = Math.sin(em.yaw[i]);
      const fz = Math.cos(em.yaw[i]);
      G.fx.particles.burst(em.x[i] + fx * 0.35, 1.15 * em.scale[i], em.z[i] + fz * 0.35, {
        count: 2,
        color: "#e6f8ff",
        speed: 1.2,
        life: 0.5,
        size: 0.22,
        gravity: 0.5,
        dirX: fx,
        dirZ: fz,
        spread: 0.5,
        additive: false,
      });
    }
  }
  return true;
}

function touchChill(em: EnemyManager, i: number, px: number, pz: number): void {
  const dx = px - em.x[i];
  const dz = pz - em.z[i];
  const rr = em.radius[i] + G.player.radius + 0.12;
  if (dx * dx + dz * dz < rr * rr) chillPlayer(1.4, 0.6);
}

// ---- snow imp: keeps its distance and lobs chilling snowballs ----------------

const THROW_WIND = 0.6;

export function impSpawn(em: EnemyManager, i: number): void {
  em.ai1[i] = 1.2 + G.rng.next() * 2;
}

export function impUpdate(em: EnemyManager, i: number, dt: number): boolean {
  if (em.ai0[i] === MODE_STAMPEDE && stampede(em, i, dt)) return true;
  const p = G.player;
  const dx = p.x - em.x[i];
  const dz = p.z - em.z[i];
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  if (em.ai0[i] === 1) {
    em.walk[i] = 0;
    facePlayer(em, i, dt, 10);
    em.ai1[i] -= dt;
    const k = 1 - em.ai1[i] / THROW_WIND;
    em.flash[i] = Math.max(em.flash[i], 0.2 + 0.35 * k * (0.5 + 0.5 * Math.sin(em.age[i] * 36)));
    if (em.ai1[i] <= 0) {
      let tx = p.x + p.velX * 0.4;
      let tz = p.z + p.velZ * 0.4;
      const tdx = tx - em.x[i];
      const tdz = tz - em.z[i];
      const td = Math.hypot(tdx, tdz);
      if (td > 10) {
        tx = em.x[i] + (tdx / td) * 10;
        tz = em.z[i] + (tdz / td) * 10;
      }
      const ok = lobSnowball(em.x[i] + Math.sin(em.yaw[i]) * 0.35, em.z[i] + Math.cos(em.yaw[i]) * 0.35, tx, tz, {
        damage: em.dmg[i] * 2.1,
        flight: 0.9 + Math.min(td, 10) * 0.035,
        splash: 1.05,
        chill: 1.3,
        frost: 2.2,
        y0: 1.0 * em.scale[i],
      });
      if (ok) G.audio.sfx("throw", { vol: 0.6, pitch: 1.2 });
      em.ai0[i] = 0;
      em.ai1[i] = ok ? 3.0 + G.rng.next() * 1.5 : 0.7;
    }
    return true;
  }
  em.ai1[i] -= dt;
  if (em.ai1[i] <= 0 && d < 10 && G.world.onScreen(em.x[i], em.z[i], -0.6)) {
    em.ai0[i] = 1;
    em.ai1[i] = THROW_WIND;
    return true;
  }
  if (d > 8) {
    steerTo(em, i, dt, p.x, p.z, 1);
  } else if (d < 5) {
    steerTo(em, i, dt, em.x[i] - dx, em.z[i] - dz, 0.8);
    facePlayer(em, i, dt, 12);
  } else {
    const s = em.uid[i] & 1 ? 1 : -1;
    steerTo(em, i, dt, em.x[i] - (dz / d) * s, em.z[i] + (dx / d) * s, 0.5);
    facePlayer(em, i, dt, 12);
  }
  return true;
}

// ---- yeti: slow giant with a telegraphed ground pound -------------------------

const POUND_WIND = 0.95;
export const POUND_R = 2.5;

export function yetiSpawn(em: EnemyManager, i: number): void {
  em.ai1[i] = 1.5 + G.rng.next() * 2;
}

export function yetiUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const p = G.player;
  if (em.ai0[i] === 1) {
    // wind-up: planted on the telegraph centre, pulsing
    em.walk[i] = 0;
    em.x[i] = em.ai2[i];
    em.z[i] = em.ai3[i];
    em.kx[i] = em.kz[i] = 0;
    facePlayer(em, i, dt, 4);
    em.ai1[i] -= dt;
    const k = 1 - em.ai1[i] / POUND_WIND;
    em.flash[i] = Math.max(em.flash[i], 0.15 + 0.45 * k * (0.5 + 0.5 * Math.sin(em.age[i] * (20 + k * 30))));
    if (em.ai1[i] <= 0) pound(em, i);
    return true;
  }
  if (em.ai0[i] === MODE_STAMPEDE) return stampede(em, i, dt);
  em.ai1[i] -= dt;
  const dx = p.x - em.x[i];
  const dz = p.z - em.z[i];
  if (em.ai1[i] <= 0 && dx * dx + dz * dz < 3.1 * 3.1 && !p.dead) {
    em.ai0[i] = 1;
    em.ai1[i] = POUND_WIND;
    em.ai2[i] = em.x[i];
    em.ai3[i] = em.z[i];
    Marks.circle(em.x[i], em.z[i], POUND_R, POUND_WIND, em.uid[i], "#ff4a3a");
    G.audio.sfx("warn", { vol: 0.5, pitch: 0.8 });
    return true;
  }
  return false;
}

const knockFrom = { x: 0, z: 0, em: null as EnemyManager | null, self: 0 };
function poundKnock(j: number): void {
  const em = knockFrom.em!;
  if (j !== knockFrom.self && !em.isBoss(j)) em.knock(j, em.x[j] - knockFrom.x, em.z[j] - knockFrom.z, 16);
}

function pound(em: EnemyManager, i: number): void {
  const x = em.x[i];
  const z = em.z[i];
  em.ai0[i] = 0;
  em.ai1[i] = 3.8 + G.rng.next() * 1.6;
  const p = G.player;
  const dx = p.x - x;
  const dz = p.z - z;
  const rr = POUND_R + p.radius * 0.5;
  if (dx * dx + dz * dz < rr * rr) {
    p.takeDamage(em.dmg[i] * 1.7);
    chillPlayer(1.0, 0.6);
  }
  IceFx.burst(x, z, POUND_R * 0.75, 7, 0.95, 0.85);
  G.fx.ring(x, z, { radius: POUND_R * 1.6, color: "#d8f4ff", life: 0.45, width: 0.5, from: 0.4 });
  G.fx.particles.burst(x, 0.3, z, { count: 16, color: "#ffffff", speed: 5, life: 0.55, size: 0.4, up: 3.5, gravity: -9, additive: false });
  G.fx.shake(0.22);
  G.audio.sfx("stomp", { vol: 0.8 });
  knockFrom.em = em;
  knockFrom.self = i;
  knockFrom.x = x;
  knockFrom.z = z;
  em.queryCircle(x, z, POUND_R, poundKnock);
}

export function yetiDeath(em: EnemyManager, i: number): void {
  Marks.killOwner(em.uid[i]);
}
