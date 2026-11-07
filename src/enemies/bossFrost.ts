import { G } from "../core/G";
import type { EnemyManager } from "./EnemyManager";
import { Marks } from "./marks";
import { steerTo, facePlayer, faceAngle } from "./ai";
import { chillPlayer } from "./chill";
import { IceFx } from "./iceFx";
import { orbRing, ORB_ICE } from "./hostile";
import { Weather } from "../world/Weather";
import {
  memo,
  bossesPassive,
  followAura,
  setMark,
  clearMark,
  angleToPlayer,
  windupPulse,
  shove,
  summon,
  roar,
  bossDeath,
  type BossMemo,
} from "./bosses";

/**
 * Final boss of the frozen graveyard — พญาเหมันต์ (the Winter Lord).
 * Keeps a medium distance and cycles four readable, telegraphed attacks:
 *  1. icicle rain   waves of filling blue circles; a big icicle drops into
 *                   each exactly when it fills (first one aimed at the hero)
 *  2. frost breath  a cone fills from the boss (tracks, then locks), then a
 *                   freezing gust: damage + strong chill, frost patches left
 *  3. ice lanes     lanes fill, then a wall of ice spikes races along them
 *  4. summon        a frost-wolf pack around the hero + ice zombies
 * Below 50 % HP it calls a blizzard (Weather) and attacks faster/bigger.
 */

const TELE = "#2f7dff";
const ICE_FX = "#bfeeff";

const CHASE = 0;
const RECOVER = 3;
const ROAR = 5;
const RAIN_CAST = 20;
const RAIN = 21;
const BREATH_WIND = 22;
const BREATH = 23;
const LANES_WIND = 24;
const LANES = 25;

const RAIN_R = 1.3;
const RAIN_FILL = 1.15;
const ICICLE_FALL = 0.32;
const BREATH_RANGE = 7.5;
const LANE_LEN = 13;
const LANE_W = 1.7;
const LANE_SPEED = 17;

// ---- pending icicle impacts (fixed pool, resolved by updateIcicles) ---------

const IMP_CAP = 48;
const impX = new Float32Array(IMP_CAP);
const impZ = new Float32Array(IMP_CAP);
const impT = new Float32Array(IMP_CAP);
const impDmg = new Float32Array(IMP_CAP);
let impN = 0;

function queueIcicle(x: number, z: number, dmg: number, uid: number): void {
  if (impN >= IMP_CAP) return;
  impX[impN] = x;
  impZ[impN] = z;
  impT[impN] = RAIN_FILL;
  impDmg[impN] = dmg;
  impN++;
  Marks.circle(x, z, RAIN_R, RAIN_FILL, uid, TELE);
  IceFx.icicle(x, z, ICICLE_FALL, 1.5, RAIN_FILL - ICICLE_FALL);
}

/** resolve icicles that land this frame (called from Director.update) */
export function updateIcicles(dt: number): void {
  for (let k = impN - 1; k >= 0; k--) {
    impT[k] -= dt;
    if (impT[k] > 0) continue;
    const x = impX[k];
    const z = impZ[k];
    const p = G.player;
    const dx = p.x - x;
    const dz = p.z - z;
    const rr = RAIN_R + p.radius * 0.5;
    if (dx * dx + dz * dz < rr * rr) {
      p.takeDamage(impDmg[k]);
      chillPlayer(0.8, 0.6);
    }
    IceFx.burst(x, z, 0.8, 5, 0.75, 0.7);
    G.fx.ring(x, z, { radius: RAIN_R * 1.5, color: ICE_FX, life: 0.35, width: 0.35, from: 0.5 });
    G.fx.particles.burst(x, 0.4, z, { count: 10, color: "#e8fbff", speed: 4.5, life: 0.45, size: 0.3, up: 3, gravity: -10, additive: false });
    G.fx.shake(0.1);
    G.audio.sfx("spike", { vol: 0.55, pitch: 1.2 });
    // swap-remove
    impN--;
    impX[k] = impX[impN];
    impZ[k] = impZ[impN];
    impT[k] = impT[impN];
    impDmg[k] = impDmg[impN];
  }
}

/** new run / boss gone: drop pending impacts */
export function resetFrostBoss(): void {
  impN = 0;
}

// ---- attacks ------------------------------------------------------------------

function startRain(em: EnemyManager, i: number, m: BossMemo): void {
  m.state = RAIN_CAST;
  m.t = 0.55;
  m.wind = 0.55;
  G.fx.rune(em.x[i], em.z[i], 2.6, "#5fd0ff", 0.7);
  G.audio.sfx("warn");
}

function rainWave(em: EnemyManager, i: number, m: BossMemo, first: boolean): void {
  const p = G.player;
  const n = m.enraged ? 4 : 3;
  const off = G.rng.angle();
  for (let k = 0; k < n; k++) {
    let x: number;
    let z: number;
    if (k === 0 && first) {
      // the first icicle of the volley is aimed where the hero is heading
      x = p.x + p.velX * 0.35;
      z = p.z + p.velZ * 0.35;
    } else {
      const a = off + (k / n) * Math.PI * 2 + (G.rng.next() - 0.5) * 0.8;
      const r = 1.8 + G.rng.next() * 3.2;
      x = p.x + p.velX * 0.5 + Math.cos(a) * r;
      z = p.z + p.velZ * 0.5 + Math.sin(a) * r;
    }
    queueIcicle(x, z, em.dmg[i] * 1.0, em.uid[i]);
  }
}

function startBreath(em: EnemyManager, i: number, m: BossMemo, wind: number): void {
  m.state = BREATH_WIND;
  m.wind = wind;
  m.t = wind;
  m.angle = angleToPlayer(em, i);
  // cone half-angle (rad): narrow enough that a sideways dash escapes once it locks
  m.len = m.enraged ? 0.46 : 0.38;
  setMark(m, Marks.cone(em.x[i], em.z[i], m.angle, BREATH_RANGE, m.len, m.wind, em.uid[i], TELE));
  G.audio.sfx("warn");
}

function inCone(em: EnemyManager, i: number, angle: number, half: number): boolean {
  const p = G.player;
  const dx = p.x - em.x[i];
  const dz = p.z - em.z[i];
  const d = Math.hypot(dx, dz);
  if (d > BREATH_RANGE + p.radius * 0.5) return false;
  if (d < em.radius[i] + p.radius) return true;
  let diff = Math.atan2(dx, dz) - angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  return Math.abs(diff) <= half + Math.atan2(p.radius * 0.5, Math.max(1, d));
}

function startLanes(em: EnemyManager, i: number, m: BossMemo): void {
  m.state = LANES_WIND;
  m.wind = m.enraged ? 0.8 : 0.95;
  m.t = m.wind;
  m.angle = angleToPlayer(em, i);
  m.chain = m.enraged ? 3 : 1;
  m.ox = em.x[i];
  m.oz = em.z[i];
  for (let k = 0; k < m.chain; k++) {
    const a = m.angle + laneOffset(k, m.chain);
    Marks.lane(m.ox, m.oz, a, LANE_LEN, LANE_W, m.wind, em.uid[i], TELE);
  }
  G.audio.sfx("warn");
}

function laneOffset(k: number, n: number): number {
  return n === 1 ? 0 : (k - (n - 1) / 2) * 0.48;
}

/** one frame of the ice-spike wall racing along every lane */
function lanesStep(em: EnemyManager, i: number, m: BossMemo, dt: number): boolean {
  const prev = m.travelled;
  m.travelled = Math.min(LANE_LEN, m.travelled + LANE_SPEED * dt);
  const p = G.player;
  for (let k = 0; k < m.chain; k++) {
    const a = m.angle + laneOffset(k, m.chain);
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    // a chunky spike every 0.6 units of newly covered lane
    for (let d = Math.ceil(prev / 0.6) * 0.6; d < m.travelled; d += 0.6) {
      if (d < 0.9) continue;
      const j = (Math.random() - 0.5) * 0.6;
      IceFx.spike(m.ox + sx * d + sz * j, m.oz + sz * d - sx * j, 1.3 + Math.random() * 0.5, 1.3, 0, 0.35);
    }
    if (!m.hitDone) {
      const rx = p.x - m.ox;
      const rz = p.z - m.oz;
      const along = rx * sx + rz * sz;
      const lat = Math.abs(rx * sz - rz * sx);
      if (along > prev - 0.7 && along < m.travelled + 0.7 && along > 0.4 && lat < LANE_W / 2 + p.radius * 0.5) {
        p.takeDamage(em.dmg[i] * 1.4);
        chillPlayer(1.0, 0.6);
        m.hitDone = true;
      }
    }
  }
  m.fx -= dt;
  if (m.fx <= 0) {
    m.fx = 0.1;
    G.audio.sfx("spike", { vol: 0.45, pitch: 0.9 + Math.random() * 0.3 });
  }
  return m.travelled >= LANE_LEN;
}

function enrage(em: EnemyManager, i: number, m: BossMemo): void {
  m.enraged = true;
  clearMark(m);
  G.events.emit("announce", { text: "พญาเหมันต์เรียกพายุหิมะ!", color: "#9fe8ff" });
  roar(em, i, m);
  Weather.blizzard(G.time, 45, G.rng.angle());
  shove(em, i, em.x[i], em.z[i], 6, 30);
  orbRing(ORB_ICE, em.x[i], em.z[i], 16, G.rng.angle(), 5, em.dmg[i] * 0.6);
}

// ---- main update ----------------------------------------------------------------

export function frostUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const m = memo(em, i);
  followAura(em, i, m);
  if (bossesPassive()) return true;
  const p = G.player;
  // enrage between attacks only, so no telegraph is ever left without its hit
  if (!m.enraged && em.hp[i] < em.maxHp[i] * 0.5 && (m.state === CHASE || m.state === RECOVER)) {
    enrage(em, i, m);
    return true;
  }
  const pace = m.enraged ? 0.72 : 1;
  switch (m.state) {
    case CHASE: {
      const dx = p.x - em.x[i];
      const dz = p.z - em.z[i];
      const d = Math.hypot(dx, dz) || 1;
      // hover ~5 units from the hero, drifting towards the top of the screen
      // (the roomiest part of a portrait view) so the boss stays in sight
      let ux = -dx / d;
      let uz = -dz / d - 0.9;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      const tx = p.x + ux * 5;
      const tz = p.z + uz * 5;
      const td = Math.hypot(tx - em.x[i], tz - em.z[i]);
      // left behind: stride in quickly (a slow boss would otherwise trail off-screen)
      if (d > 7) steerTo(em, i, dt, p.x, p.z, 1.9, 5);
      else if (td > 0.6) {
        steerTo(em, i, dt, tx, tz, d < 3.2 ? 1 : 0.75, 5);
        facePlayer(em, i, dt, 6);
      } else {
        em.walk[i] = 0;
        facePlayer(em, i, dt, 6);
      }
      // only start an attack once back in range (in sight)
      if (d < 9.5) m.t -= dt;
      if (m.t <= 0) {
        const pick = m.counter++ % 4;
        if (pick === 0) startRain(em, i, m);
        else if (pick === 1 && d < 9) {
          // enraged: two breaths in a row, the second one re-aimed
          m.volley = m.enraged ? 2 : 1;
          startBreath(em, i, m, m.enraged ? 0.85 : 1.05);
        } else if (pick <= 2) startLanes(em, i, m);
        else {
          roar(em, i, m);
          summon("frostWolf", m.enraged ? 8 : 6, p.x, p.z, 7, "#9fe8ff");
          summon("iceZombie", m.enraged ? 3 : 2, em.x[i], em.z[i], 3, "#9fe8ff");
        }
      }
      return true;
    }
    case RAIN_CAST:
      em.walk[i] = 0;
      em.kx[i] = em.kz[i] = 0;
      m.t -= dt;
      windupPulse(em, i, 1 - m.t / m.wind);
      facePlayer(em, i, dt, 6);
      if (m.t <= 0) {
        m.state = RAIN;
        m.volley = m.enraged ? 5 : 4;
        m.t = 0;
        m.chain = 1;
        G.audio.sfx("whoosh", { pitch: 0.7 });
      }
      return true;
    case RAIN:
      em.walk[i] = 0;
      facePlayer(em, i, dt, 6);
      m.t -= dt;
      if (m.t <= 0) {
        rainWave(em, i, m, m.chain === 1);
        m.chain = 0;
        m.volley--;
        m.t = m.enraged ? 0.36 : 0.42;
        if (m.volley <= 0) {
          m.state = RECOVER;
          m.t = 0.9;
        }
      }
      return true;
    case BREATH_WIND: {
      em.walk[i] = 0;
      em.kx[i] = em.kz[i] = 0;
      m.t -= dt;
      const k = 1 - m.t / m.wind;
      // track the hero for the first 30 %, then lock (dodge window)
      if (k < 0.3) {
        m.angle = angleToPlayer(em, i);
        Marks.move(m.mark!, m.markGen, em.x[i], em.z[i], m.angle);
      }
      faceAngle(em, i, dt, m.angle, 12);
      windupPulse(em, i, k);
      m.fx -= dt;
      if (m.fx <= 0) {
        m.fx = 0.08;
        const hx = em.x[i] + Math.sin(m.angle) * 1.2;
        const hz = em.z[i] + Math.cos(m.angle) * 1.2;
        G.fx.particles.burst(hx, 2.4, hz, { count: 2, color: "#bfeeff", speed: 0.8, life: 0.4, size: 0.3, gravity: -2 });
      }
      if (m.t <= 0) {
        clearMark(m);
        m.state = BREATH;
        m.t = 0.65;
        m.hitDone = false;
        G.audio.sfx("whoosh", { pitch: 0.55, vol: 0.9 });
        G.audio.sfx("freeze", { pitch: 0.6 });
        // the gust leaves chilling frost on the ground along the cone
        const sx = Math.sin(m.angle);
        const sz = Math.cos(m.angle);
        Marks.frost(em.x[i] + sx * 3.2, em.z[i] + sz * 3.2, 1.5, 3.0);
        Marks.frost(em.x[i] + sx * 5.8, em.z[i] + sz * 5.8, 1.9, 3.0);
      }
      return true;
    }
    case BREATH: {
      em.walk[i] = 0;
      em.kx[i] = em.kz[i] = 0;
      m.t -= dt;
      const sx = Math.sin(m.angle);
      const sz = Math.cos(m.angle);
      G.fx.particles.burst(em.x[i] + sx * 1.1, 1.9, em.z[i] + sz * 1.1, {
        count: 5,
        color: "#a8dcff",
        speed: 12,
        life: 0.55,
        size: 0.5,
        gravity: -1.5,
        dirX: sx,
        dirZ: sz,
        spread: m.len,
        drag: 1,
        additive: false,
      });
      G.fx.particles.burst(em.x[i] + sx * 1.1, 1.7, em.z[i] + sz * 1.1, {
        count: 3,
        color: "#ffffff",
        speed: 10,
        life: 0.5,
        size: 0.35,
        gravity: -1.5,
        dirX: sx,
        dirZ: sz,
        spread: m.len * 0.8,
        drag: 1,
      });
      // the gust hits in its first 0.2 s (when the warning vanishes), not for its whole tail
      if (!m.hitDone && m.t > 0.45 && inCone(em, i, m.angle, m.len)) {
        p.takeDamage(em.dmg[i] * 1.3);
        chillPlayer(2.0, 0.5);
        m.hitDone = true;
      }
      if (m.t <= 0) {
        m.volley--;
        if (m.volley > 0) startBreath(em, i, m, 0.75);
        else {
          m.state = RECOVER;
          m.t = 0.9;
        }
      }
      return true;
    }
    case LANES_WIND:
      em.walk[i] = 0;
      em.kx[i] = em.kz[i] = 0;
      m.t -= dt;
      windupPulse(em, i, 1 - m.t / m.wind);
      faceAngle(em, i, dt, m.angle, 10);
      if (m.t <= 0) {
        m.state = LANES;
        m.travelled = 0;
        m.hitDone = false;
        m.fx = 0;
        G.fx.shake(0.25);
        G.audio.sfx("stomp");
        G.fx.ring(m.ox, m.oz, { radius: 3, color: ICE_FX, life: 0.4, width: 0.5 });
      }
      return true;
    case LANES:
      em.walk[i] = 0;
      if (lanesStep(em, i, m, dt)) {
        m.state = RECOVER;
        m.t = 0.8;
      }
      return true;
    case ROAR:
    case RECOVER:
    default:
      em.walk[i] = 0;
      m.t -= dt;
      if (m.t <= 0) {
        m.state = CHASE;
        m.t = (2.0 + G.rng.next() * 0.8) * pace;
      }
      return true;
  }
}

/** shared boss death + drop the icicles still falling (their circles vanish with the boss) */
export function frostDeath(em: EnemyManager, i: number): void {
  resetFrostBoss();
  bossDeath(em, i);
}
