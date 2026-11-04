import { G } from "../core/G";
import type { EnemyManager } from "./EnemyManager";
import { Marks, type Mark } from "./marks";
import { steerTo, facePlayer, faceAngle } from "./ai";
import { lobGoo, orbRing, fireOrb, ORB_GREEN, ORB_RED } from "./hostile";

/**
 * Boss behaviours. Each boss runs a small state machine with readable,
 * telegraphed attacks (warning circles / charge lanes fill up before the hit).
 * State lives in a memo keyed by uid (slots move when the horde compacts).
 */

interface BossMemo {
  state: number;
  t: number;
  angle: number;
  len: number;
  travelled: number;
  counter: number;
  /** summon thresholds already used (bit flags) */
  stage: number;
  hitDone: boolean;
  chain: number;
  enraged: boolean;
  volley: number;
  fx: number;
  /** duration of the current wind-up */
  wind: number;
  mark: Mark | null;
  markGen: number;
}

const memos = new Map<number, BossMemo>();
/** debug lineup: bosses just stand and animate */
let passive = false;
export function setBossesPassive(on: boolean): void {
  passive = on;
}

function memo(em: EnemyManager, i: number): BossMemo {
  const uid = em.uid[i];
  let m = memos.get(uid);
  if (!m) {
    m = { state: 0, t: 2.5, angle: 0, len: 0, travelled: 0, counter: 0, stage: 0, hitDone: false, chain: 0, enraged: false, volley: 0, fx: 0, wind: 1, mark: null, markGen: 0 };
    memos.set(uid, m);
  }
  return m;
}

/** new run: drop every boss memo */
export function resetBosses(): void {
  memos.clear();
  passive = false;
}

function setMark(m: BossMemo, mark: Mark): void {
  m.mark = mark;
  m.markGen = mark.gen;
}

function clearMark(m: BossMemo): void {
  Marks.end(m.mark, m.markGen);
  m.mark = null;
}

function distToPlayer(em: EnemyManager, i: number): number {
  return Math.hypot(G.player.x - em.x[i], G.player.z - em.z[i]);
}

function angleToPlayer(em: EnemyManager, i: number): number {
  return Math.atan2(G.player.x - em.x[i], G.player.z - em.z[i]);
}

/** pulse the white hit-flash to show a charging attack */
function windupPulse(em: EnemyManager, i: number, k: number): void {
  em.flash[i] = Math.max(em.flash[i], 0.15 + 0.4 * k * (0.5 + 0.5 * Math.sin(em.age[i] * (20 + k * 30))));
}

function hurtPlayerInCircle(x: number, z: number, r: number, dmg: number): void {
  const p = G.player;
  const dx = p.x - x;
  const dz = p.z - z;
  const rr = r + p.radius * 0.5;
  if (dx * dx + dz * dz < rr * rr) p.takeDamage(dmg);
}

function shove(em: EnemyManager, self: number, x: number, z: number, r: number, force: number): void {
  em.queryCircle(x, z, r, (j) => {
    if (j !== self && !em.isBoss(j)) em.knock(j, em.x[j] - x, em.z[j] - z, force);
  });
}

/** spawn minions around (cx,cz) in a ring, with a puff for each */
function summon(id: string, count: number, cx: number, cz: number, radius: number, color: string, elite = false): void {
  const em = G.enemies;
  const hpMul = G.director.hpScale(G.time);
  const off = G.rng.angle();
  for (let k = 0; k < count; k++) {
    const a = off + (k / count) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    if (em.spawn(id, x, z, { hpMul, elite }) >= 0) {
      G.fx.flash(x, z, { radius: 1.1, color, life: 0.35 });
      G.fx.particles.burst(x, 0.3, z, { count: 5, color, speed: 2.5, life: 0.4, size: 0.3, up: 2.5, gravity: -6 });
    }
  }
}

/** dust kicked up while charging */
function dust(x: number, z: number): void {
  G.fx.particles.burst(x, 0.2, z, { count: 3, color: "#c9b38a", speed: 1.8, life: 0.45, size: 0.5, up: 1.2, gravity: -2, additive: false });
}

// shared state ids
const CHASE = 0;
const CHARGE_WIND = 1;
const CHARGE = 2;
const RECOVER = 3;
const SLAM_WIND = 4;
const ROAR = 5;
const VOLLEY_WIND = 6;
const VOLLEY = 7;
const LOB = 8;
const SPIRAL = 9;

function startCharge(em: EnemyManager, i: number, m: BossMemo, wind: number, width: number): void {
  m.state = CHARGE_WIND;
  m.t = wind;
  m.wind = wind;
  m.angle = angleToPlayer(em, i);
  m.len = Math.min(17, Math.max(9, distToPlayer(em, i) + 5));
  setMark(m, Marks.lane(em.x[i], em.z[i], m.angle, m.len, width, wind, em.uid[i]));
  G.audio.sfx("warn");
}

/** charge wind-up + dash shared by the bull and the king. returns true while busy */
function chargeStates(em: EnemyManager, i: number, dt: number, m: BossMemo, speed: number, dmg: number): boolean {
  if (m.state === CHARGE_WIND) {
    em.walk[i] = 0;
    m.t -= dt;
    const k = 1 - m.t / m.wind;
    // track the player for the first half, then lock (dodge window)
    if (k < 0.5) {
      m.angle = angleToPlayer(em, i);
      Marks.move(m.mark!, m.markGen, em.x[i], em.z[i], m.angle);
    }
    faceAngle(em, i, dt, m.angle, 14);
    windupPulse(em, i, k);
    m.fx -= dt;
    if (m.fx <= 0) {
      m.fx = 0.12;
      dust(em.x[i] - Math.sin(m.angle) * 0.8, em.z[i] - Math.cos(m.angle) * 0.8);
    }
    if (m.t <= 0) {
      clearMark(m);
      m.state = CHARGE;
      m.travelled = 0;
      m.hitDone = false;
      G.audio.sfx("bossRoar", { vol: 0.6, pitch: 1.3 });
    }
    return true;
  }
  if (m.state === CHARGE) {
    const step = speed * dt;
    const sx = Math.sin(m.angle);
    const sz = Math.cos(m.angle);
    em.x[i] += sx * step;
    em.z[i] += sz * step;
    em.yaw[i] = m.angle;
    em.walk[i] = em.def(i).walkRate * 3;
    m.travelled += step;
    if (!m.hitDone) {
      const p = G.player;
      const rr = em.radius[i] + p.radius + 0.15;
      const dx = p.x - em.x[i];
      const dz = p.z - em.z[i];
      if (dx * dx + dz * dz < rr * rr) {
        p.takeDamage(dmg);
        m.hitDone = true;
        G.world.shake(0.5);
      }
    }
    // bulldoze the crowd sideways
    em.queryCircle(em.x[i], em.z[i], em.radius[i] + 0.4, (j) => {
      if (j === i || em.isBoss(j)) return;
      const ox = em.x[j] - em.x[i];
      const oz = em.z[j] - em.z[i];
      const side = ox * sz - oz * sx >= 0 ? 1 : -1;
      em.knock(j, sz * side + sx * 0.5, -sx * side + sz * 0.5, 22);
    });
    m.fx -= dt;
    if (m.fx <= 0) {
      m.fx = 0.05;
      dust(em.x[i], em.z[i]);
    }
    if (m.travelled >= m.len) {
      G.fx.ring(em.x[i], em.z[i], { radius: 2.4, color: "#ffd08a", life: 0.35, width: 0.5 });
      G.world.shake(0.3);
      G.audio.sfx("stomp");
      m.state = RECOVER;
      m.t = 0.85;
    }
    return true;
  }
  return false;
}

function startSlam(em: EnemyManager, i: number, m: BossMemo, wind: number, r: number): void {
  m.state = SLAM_WIND;
  m.t = wind;
  m.wind = wind;
  m.len = r;
  setMark(m, Marks.circle(em.x[i], em.z[i], r, wind, em.uid[i]));
  G.audio.sfx("warn");
}

/** returns true when the slam lands this frame */
function slamWind(em: EnemyManager, i: number, dt: number, m: BossMemo): boolean {
  em.walk[i] = 0;
  em.kx[i] = em.kz[i] = 0;
  m.t -= dt;
  windupPulse(em, i, 1 - m.t / m.wind);
  facePlayer(em, i, dt, 4);
  return m.t <= 0;
}

function slamHit(em: EnemyManager, i: number, m: BossMemo, dmg: number, color: string): void {
  clearMark(m);
  const x = em.x[i];
  const z = em.z[i];
  const r = m.len;
  G.fx.explosion(x, z, r, color, 0.7);
  G.fx.ring(x, z, { radius: r * 2.1, color: "#ffffff", life: 0.6, width: 0.7, from: 0.45 });
  G.fx.particles.burst(x, 0.3, z, { count: 26, color: "#b89a70", speed: r * 2.2, life: 0.7, size: 0.55, up: 3, gravity: -9, additive: false });
  G.audio.sfx("stomp");
  G.audio.sfx("boom", { vol: 0.7 });
  hurtPlayerInCircle(x, z, r, dmg);
  shove(em, i, x, z, r * 1.3, 30);
}

function roar(em: EnemyManager, i: number, m: BossMemo): void {
  m.state = ROAR;
  m.t = 1.0;
  G.audio.sfx("bossRoar");
  G.world.shake(0.4);
  G.fx.ring(em.x[i], em.z[i], { radius: 6, color: "#ff4f6a", life: 0.7, width: 0.8 });
}

/** HP threshold check: returns true once per threshold crossed */
function crossed(em: EnemyManager, i: number, m: BossMemo, frac: number, bit: number): boolean {
  if (m.stage & bit) return false;
  if (em.hp[i] / em.maxHp[i] > frac) return false;
  m.stage |= bit;
  return true;
}

// ======================================================================
// Boss 1 — ยักษ์กระทิงเน่า: charging brute with ground slams
// ======================================================================

export function bullUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const m = memo(em, i);
  if (passive) return true;
  if (chargeStates(em, i, dt, m, 15, em.dmg[i] * 1.7)) return true;
  switch (m.state) {
    case CHASE: {
      steerTo(em, i, dt, G.player.x, G.player.z, 1, 5);
      if (crossed(em, i, m, 0.66, 1) || crossed(em, i, m, 0.33, 2)) {
        roar(em, i, m);
        summon("runner", 8, em.x[i], em.z[i], 3, "#ff6a5a");
        return true;
      }
      m.t -= dt;
      if (m.t <= 0) {
        m.counter++;
        const d = distToPlayer(em, i);
        if (m.counter % 3 === 0 && d < 9) startSlam(em, i, m, 1.15, 4.4);
        else if (d < 18) startCharge(em, i, m, 1.05, 2.3);
        else m.t = 0.5;
      }
      return true;
    }
    case SLAM_WIND:
      if (slamWind(em, i, dt, m)) {
        slamHit(em, i, m, em.dmg[i] * 1.5, "#ffb347");
        m.state = RECOVER;
        m.t = 1.0;
      }
      return true;
    case ROAR:
      em.walk[i] = 0;
      m.t -= dt;
      if (m.t <= 0) {
        m.state = CHASE;
        m.t = 1.2;
      }
      return true;
    case RECOVER:
    default:
      em.walk[i] = 0;
      m.t -= dt;
      if (m.t <= 0) {
        m.state = CHASE;
        m.t = 2.6 + G.rng.next() * 1.0;
      }
      return true;
  }
}

// ======================================================================
// Boss 2 — แม่มดหนองพิษ: keeps range, orb volleys, goo barrages, summons
// ======================================================================

export function witchUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const m = memo(em, i);
  if (passive) return true;
  const p = G.player;
  if (!m.enraged && em.hp[i] < em.maxHp[i] * 0.5) {
    m.enraged = true;
    clearMark(m);
    G.events.emit("announce", { text: "แม่มดหนองพิษโกรธจัด!", color: "#8cff3a" });
    roar(em, i, m);
    summon("bloater", 5, p.x, p.z, 7, "#b8ff3a");
    return true;
  }
  const pace = m.enraged ? 0.7 : 1;
  switch (m.state) {
    case CHASE: {
      const dx = p.x - em.x[i];
      const dz = p.z - em.z[i];
      const d = Math.hypot(dx, dz) || 1;
      if (d > 8) steerTo(em, i, dt, p.x, p.z, 1, 5);
      else if (d < 4.5) {
        steerTo(em, i, dt, em.x[i] - dx, em.z[i] - dz, 0.8, 5);
        facePlayer(em, i, dt, 6);
      } else {
        steerTo(em, i, dt, em.x[i] - dz / d, em.z[i] + dx / d, 0.5, 5);
        facePlayer(em, i, dt, 6);
      }
      m.t -= dt;
      if (m.t <= 0) {
        const pick = m.counter++ % 4;
        if (pick === 0 || pick === 2) {
          m.state = VOLLEY_WIND;
          m.t = 0.8;
          setMark(m, Marks.circle(em.x[i], em.z[i], 2.2, 0.8, em.uid[i], "#7dff3a"));
          G.audio.sfx("warn");
        } else if (pick === 1) {
          m.state = LOB;
          m.t = 0;
          m.volley = m.enraged ? 7 : 5;
        } else {
          roar(em, i, m);
          summon("spitter", 3, em.x[i], em.z[i], 3, "#7dff3a");
          summon("bloater", 3, em.x[i], em.z[i], 4.2, "#b8ff3a");
        }
      }
      return true;
    }
    case VOLLEY_WIND:
      em.walk[i] = 0;
      m.t -= dt;
      windupPulse(em, i, 1 - m.t / 0.8);
      facePlayer(em, i, dt, 6);
      if (m.t <= 0) {
        clearMark(m);
        m.state = VOLLEY;
        m.volley = m.enraged ? 5 : 4;
        m.t = 0;
        m.angle = G.rng.angle();
      }
      return true;
    case VOLLEY: {
      em.walk[i] = 0;
      m.t -= dt;
      if (m.t <= 0) {
        const n = m.enraged ? 18 : 14;
        orbRing(ORB_GREEN, em.x[i], em.z[i], n, m.angle, 5, em.dmg[i] * 0.8);
        m.angle += Math.PI / n;
        G.audio.sfx("spit", { pitch: 0.8 });
        G.fx.flash(em.x[i], em.z[i], { radius: 2, color: "#7dff3a", life: 0.2 });
        m.volley--;
        m.t = 0.38;
        if (m.volley <= 0) {
          m.state = RECOVER;
          m.t = 0.8;
        }
      }
      return true;
    }
    case LOB: {
      em.walk[i] = 0;
      facePlayer(em, i, dt, 6);
      m.t -= dt;
      if (m.t <= 0) {
        const first = m.volley === (m.enraged ? 7 : 5);
        const a = G.rng.angle();
        const r = first ? 0 : 1.6 + G.rng.next() * 2.4;
        lobGoo(em.x[i], em.z[i], p.x + p.velX * 0.5 + Math.cos(a) * r, p.z + p.velZ * 0.5 + Math.sin(a) * r, {
          damage: em.dmg[i] * 1.1,
          flight: 1.15,
          splash: 1.45,
          puddle: 3.2,
          scale: 1.4,
          y0: 3.4,
        });
        G.audio.sfx("spit");
        m.volley--;
        m.t = 0.22;
        if (m.volley <= 0) {
          m.state = RECOVER;
          m.t = 0.9;
        }
      }
      return true;
    }
    case ROAR:
    case RECOVER:
    default:
      em.walk[i] = 0;
      m.t -= dt;
      if (m.t <= 0) {
        m.state = CHASE;
        m.t = (2.2 + G.rng.next() * 0.8) * pace;
      }
      return true;
  }
}

// ======================================================================
// Boss 3 (final) — ราชาซากศพ: slams, triple charges, orb spirals, undead rings
// ======================================================================

export function kingUpdate(em: EnemyManager, i: number, dt: number): boolean {
  const m = memo(em, i);
  if (passive) return true;
  const p = G.player;
  if (!m.enraged && em.hp[i] < em.maxHp[i] * 0.4) {
    m.enraged = true;
    m.chain = 0;
    clearMark(m);
    G.events.emit("announce", { text: "ราชาซากศพคลั่งแค้น!", color: "#ff4f6a" });
    roar(em, i, m);
    summon("brute", 2, em.x[i], em.z[i], 3.5, "#ff4f6a", true);
    return true;
  }
  const pace = m.enraged ? 0.7 : 1;
  if (chargeStates(em, i, dt, m, m.enraged ? 19 : 16, em.dmg[i] * 1.6)) {
    // chain the next charge straight from the recovery
    if (m.state === RECOVER && m.chain > 1) {
      m.chain--;
      startCharge(em, i, m, 0.7, 2.6);
    } else if (m.state === RECOVER) {
      m.chain = 0;
    }
    return true;
  }
  switch (m.state) {
    case CHASE: {
      steerTo(em, i, dt, p.x, p.z, m.enraged ? 1.25 : 1, 5);
      m.t -= dt;
      if (m.t <= 0) {
        const pick = m.counter++ % 4;
        const d = distToPlayer(em, i);
        if (pick === 0 && d < 9) startSlam(em, i, m, 1.25 * pace + 0.2, 5.2);
        else if (pick === 0 || pick === 1) {
          m.chain = 3;
          startCharge(em, i, m, 1.0, 2.6);
        } else if (pick === 2) {
          m.state = SPIRAL;
          m.t = 0;
          m.volley = m.enraged ? 22 : 16;
          m.angle = G.rng.angle();
          G.audio.sfx("warn");
        } else {
          roar(em, i, m);
          summon("mummy", m.enraged ? 16 : 12, p.x, p.z, 6.5, "#b06cff");
        }
      }
      return true;
    }
    case SLAM_WIND:
      if (slamWind(em, i, dt, m)) {
        slamHit(em, i, m, em.dmg[i] * 1.6, "#ff4f6a");
        if (m.enraged) orbRing(ORB_RED, em.x[i], em.z[i], 16, G.rng.angle(), 5.5, em.dmg[i] * 0.6);
        m.state = RECOVER;
        m.t = 0.9;
      }
      return true;
    case SPIRAL: {
      em.walk[i] = 0;
      em.kx[i] = em.kz[i] = 0;
      windupPulse(em, i, 0.6);
      m.t -= dt;
      if (m.t <= 0) {
        // 5-armed rotating spiral of bolts
        const arms = 5;
        for (let k = 0; k < arms; k++) fireOrb(ORB_RED, em.x[i], em.z[i], m.angle + (k / arms) * Math.PI * 2, 5.2, em.dmg[i] * 0.55);
        m.angle += 0.32;
        m.volley--;
        m.t = 0.14;
        if ((m.volley & 3) === 0) G.audio.sfx("zap", { pitch: 0.6 });
        if (m.volley <= 0) {
          m.state = RECOVER;
          m.t = 0.8;
        }
      }
      return true;
    }
    case ROAR:
    case RECOVER:
    default:
      em.walk[i] = 0;
      m.t -= dt;
      if (m.t <= 0) {
        m.state = CHASE;
        m.t = (2.3 + G.rng.next() * 0.8) * pace;
      }
      return true;
  }
}

/** shared boss onSpawn: entrance shockwave + memo */
export function bossSpawn(em: EnemyManager, i: number): void {
  const m = memo(em, i);
  m.t = 2.2;
  G.fx.ring(em.x[i], em.z[i], { radius: 5, color: "#ff4f6a", life: 0.8, width: 0.8 });
}

/** shared boss onDeath: remove telegraphs + memo */
export function bossDeath(em: EnemyManager, i: number): void {
  const uid = em.uid[i];
  Marks.killOwner(uid);
  memos.delete(uid);
  G.fx.ring(em.x[i], em.z[i], { radius: 9, color: "#ffe680", life: 0.9, width: 1.2 });
  // the horde around the fallen boss is blown away
  shove(em, i, em.x[i], em.z[i], 7, 35);
}
