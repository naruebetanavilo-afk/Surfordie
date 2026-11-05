import { G } from "../core/G";
import { ENEMY_DEFS, enemyDefIndex } from "../enemies/defs";
import { Marks } from "../enemies/marks";
import { ensureHostileKinds, resetHostile } from "../enemies/hostile";
import { resetBosses, setBossesPassive } from "../enemies/bosses";
import { startStampede } from "../enemies/ai";
import { PHASES, EVENTS, type Phase, type RunEvent } from "./timeline";

/** length of a full run in seconds; surviving this long = victory */
export const RUN_LENGTH = 10 * 60;

/** hard ceiling on living enemies, scripted events included (perf guard) */
const ALIVE_CAP = 640;
/** max regular spawns per frame (spreads big refills over a few frames) */
const SPAWN_PER_FRAME = 14;

interface PhaseCache {
  phase: Phase;
  ids: number[];
  weights: number[];
  elites: number[];
}

interface PendingStampede {
  t: number;
  ids: number[];
  perLane: number;
  speed: number;
  /** flattened lanes: x, z, angle, length */
  lanes: number[];
}

/**
 * Spawn director: interprets the 10-minute timeline (timeline.ts).
 *  - steady stream: keeps the alive count near the phase target, spawning
 *    small same-type clusters just outside the screen
 *  - elites on a timer (they drop chests)
 *  - scripted events: encircling hordes, telegraphed stampedes, spirit
 *    swarms, boss warnings and the three bosses (3:00, 6:00, 9:00)
 * Also ticks the enemy ground telegraphs (Marks) and resets all enemy-side
 * run state on reset().
 */
export class Director {
  private acc = 0;
  private tmp = { x: 0, z: 0 };
  private cache: PhaseCache[];
  private nextEvent = 0;
  private eliteT = 0;
  private pending: PendingStampede[] = [];
  private bossAlive = 0;
  /** debug lineup: no stream / events */
  private quiet = false;
  /** debug lineup members: uid, offset x, offset z (kept around the player) */
  private lineup: number[] = [];

  constructor() {
    this.cache = PHASES.map((phase) => {
      const ids: number[] = [];
      const weights: number[] = [];
      for (const [id, w] of Object.entries(phase.weights)) {
        ids.push(enemyDefIndex(id));
        weights.push(w);
      }
      return { phase, ids, weights, elites: (phase.elites ?? []).map(enemyDefIndex) };
    });
    G.events.on("bossKilled", () => {
      this.bossAlive = Math.max(0, this.bossAlive - 1);
      if (this.bossAlive === 0) this.setBossMood(false);
    });
  }

  reset(): void {
    this.acc = 0;
    this.quiet = false;
    this.lineup.length = 0;
    this.pending.length = 0;
    this.bossAlive = 0;
    const t = G.time;
    // debug starts (?t=…) skip the events that are already in the past
    this.nextEvent = 0;
    while (this.nextEvent < EVENTS.length && EVENTS[this.nextEvent].t < t) this.nextEvent++;
    this.eliteT = Math.max(120, t + 12);
    Marks.clear();
    resetHostile();
    resetBosses();
    ensureHostileKinds();
    this.debugSpawns();
  }

  /**
   * Debug URL params: `lineup=1` parades every enemy type (immobile, tanky)
   * above the player; `boss=bossBull|bossWitch|bossKing` spawns a boss now.
   */
  private debugSpawns(): void {
    const q = new URLSearchParams(location.search);
    const em = G.enemies;
    if (q.get("lineup") === "1") {
      setBossesPassive(true);
      this.quiet = true;
      const regular = ENEMY_DEFS.filter((d) => !d.boss);
      const put = (id: string, ox: number, oz: number, hpMul: number): void => {
        const i = em.spawn(id, ox, oz, { hpMul, speedMul: 0 });
        if (i >= 0) this.lineup.push(em.uid[i], ox, oz);
      };
      regular.forEach((d, k) => put(d.id, -4.8 + (k / (regular.length - 1)) * 9.6, -2.4 - (k % 2) * 1.5, 1e4));
      ENEMY_DEFS.filter((d) => d.boss).forEach((d, k) => put(d.id, -4.2 + k * 4.2, -8.2 + (k % 2) * 0.6, 1e3));
    }
    const boss = q.get("boss");
    if (boss && ENEMY_DEFS.some((d) => d.id === boss && d.boss)) {
      this.pending.length = 0;
      setTimeout(() => {
        if (G.state === "playing") this.spawnBoss(boss);
      }, 1500);
    }
  }

  /** release the telegraph meshes owned by the enemy side */
  dispose(): void {
    Marks.dispose();
  }

  /** HP multiplier for enemies spawned at time t (seconds) */
  hpScale(t: number): number {
    const m = t / 60;
    return 1 + m * 0.42 + m * m * 0.058;
  }

  /** contact / projectile damage multiplier at time t */
  dmgScale(t: number): number {
    return 1 + (t / 60) * 0.075;
  }

  private phaseIndex(t: number): number {
    for (let k = 0; k < this.cache.length; k++) if (t < this.cache[k].phase.to) return k;
    return this.cache.length - 1;
  }

  /** desired number of living enemies at time t */
  targetAlive(t: number): number {
    const ph = this.cache[this.phaseIndex(t)].phase;
    const k = Math.min(1, Math.max(0, (t - ph.from) / (ph.to - ph.from)));
    let n = ph.alive[0] + (ph.alive[1] - ph.alive[0]) * k;
    // give boss fights a little breathing room
    if (this.bossAlive > 0) n *= 0.8;
    return Math.min(ALIVE_CAP, Math.floor(n));
  }

  update(dt: number): void {
    const t = G.time;
    Marks.update(dt);
    if (this.quiet) {
      // keep the debug parade in view while the autoplay bot wanders
      const em = G.enemies;
      for (let k = 0; k < this.lineup.length; k += 3) {
        const i = em.findByUid(this.lineup[k]);
        if (i < 0) continue;
        em.x[i] = G.player.x + this.lineup[k + 1];
        em.z[i] = G.player.z + this.lineup[k + 2];
        em.yaw[i] = 0;
      }
      return;
    }
    while (this.nextEvent < EVENTS.length && EVENTS[this.nextEvent].t <= t) {
      this.runEvent(EVENTS[this.nextEvent]);
      this.nextEvent++;
    }
    this.runPending(t);
    this.stream(t, dt);
    this.elites(t);
  }

  // ---------------------------------------------------------------- stream --

  private stream(t: number, dt: number): void {
    const em = G.enemies;
    const target = this.targetAlive(t);
    const deficit = target - em.alive;
    if (deficit <= 0) {
      this.acc = 0;
      return;
    }
    const rate = 3 + t / 20 + deficit * 1.2;
    this.acc += rate * dt;
    let budget = Math.min(SPAWN_PER_FRAME, deficit, Math.floor(this.acc));
    this.acc -= budget;
    if (budget <= 0) return;
    const pc = this.cache[this.phaseIndex(t)];
    const rng = G.rng;
    const hpMul = this.hpScale(t);
    const dmgMul = this.dmgScale(t);
    while (budget > 0) {
      const type = pc.ids[rng.weighted(pc.weights)];
      const def = ENEMY_DEFS[type];
      const n = Math.min(budget, rng.int(pc.phase.cluster[0], pc.phase.cluster[1]));
      em.spawnPoint(this.tmp, 1.2 + rng.next() * 1.5);
      const spread = 0.5 + n * 0.22;
      for (let k = 0; k < n; k++) {
        const x = this.tmp.x + (rng.next() - 0.5) * 2 * spread;
        const z = this.tmp.z + (rng.next() - 0.5) * 2 * spread;
        em.spawn(type, x, z, { hpMul, dmgMul });
      }
      budget -= n;
      // heavy types count extra so the budget stays honest
      if (def.mass >= 6) budget -= 1;
    }
  }

  private elites(t: number): void {
    if (t < this.eliteT) return;
    const pc = this.cache[this.phaseIndex(t)];
    if (pc.phase.elite <= 0 || pc.elites.length === 0) {
      this.eliteT = t + 5;
      return;
    }
    this.eliteT = t + pc.phase.elite * (0.85 + G.rng.next() * 0.3);
    const em = G.enemies;
    if (em.alive >= ALIVE_CAP) return;
    em.spawnPoint(this.tmp, 1.5);
    const type = pc.elites[Math.floor(G.rng.next() * pc.elites.length)];
    em.spawn(type, this.tmp.x, this.tmp.z, { hpMul: this.hpScale(t) * 0.8, dmgMul: this.dmgScale(t), elite: true });
  }

  // ---------------------------------------------------------------- events --

  private room(): number {
    return Math.max(0, ALIVE_CAP - G.enemies.alive);
  }

  private runEvent(e: RunEvent): void {
    switch (e.kind) {
      case "warn":
        G.events.emit("announce", { text: e.text, color: e.color });
        G.audio.sfx("warn");
        break;
      case "boss":
        this.spawnBoss(e.id);
        break;
      case "ring":
        this.ringHorde(e.ids, e.count, e.rings ?? 1);
        G.events.emit("announce", { text: e.text, color: "#ff6b6b" });
        G.audio.sfx("horde");
        break;
      case "stampede":
        this.stampede(e.ids, e.lanes, e.perLane, e.speed, e.sides ?? 1);
        G.audio.sfx("horde");
        G.audio.sfx("warn");
        break;
      case "swarm":
        this.swarm(e.id, e.groups, e.perGroup);
        G.events.emit("announce", { text: e.text, color: "#c9a8ff" });
        G.audio.sfx("horde", { pitch: 1.4 });
        break;
    }
  }

  private spawnBoss(id: string): void {
    const em = G.enemies;
    // enter from the top of the screen so the player sees it coming
    em.spawnPoint(this.tmp, 2, -Math.PI / 2 + (G.rng.next() - 0.5) * 0.8);
    const i = em.spawn(id, this.tmp.x, this.tmp.z);
    if (i < 0) return;
    const def = em.def(i);
    this.bossAlive++;
    this.setBossMood(true);
    G.audio.sfx("bossRoar");
    G.world.shake(0.6);
    G.events.emit("bossSpawned", { typeId: def.id, name: def.name });
  }

  private setBossMood(on: boolean): void {
    G.world.zoom = on ? 1.12 : 1;
    G.audio.music(true, on ? 1 : 0);
  }

  /** enemies evenly spaced around the screen border, all converging */
  private ringHorde(ids: string[], count: number, rings: number): void {
    const em = G.enemies;
    const t = G.time;
    const hpMul = this.hpScale(t);
    const dmgMul = this.dmgScale(t);
    const types = ids.map(enemyDefIndex);
    const n = Math.min(count, this.room());
    const perRing = Math.ceil(n / rings);
    const off = G.rng.angle();
    let spawned = 0;
    for (let r = 0; r < rings && spawned < n; r++) {
      for (let k = 0; k < perRing && spawned < n; k++) {
        const a = off + ((k + r * 0.5) / perRing) * Math.PI * 2;
        em.spawnPoint(this.tmp, 1.2 + r * 3.5, a);
        em.spawn(types[k % types.length], this.tmp.x, this.tmp.z, { hpMul, dmgMul });
        spawned++;
      }
    }
  }

  /** telegraphed lanes across the screen, then a file of chargers per lane */
  private stampede(ids: string[], lanes: number, perLane: number, speed: number, sides: number): void {
    const w = G.world;
    const cx = w.camTarget.x;
    const cz = w.camTarget.z;
    const rng = G.rng;
    const p = G.player;
    const horizontal = sides > 1 || rng.next() < 0.7;
    const dir = rng.next() < 0.5 ? 1 : -1;
    const tele = 1.5;
    const flat: number[] = [];
    let text: string;
    if (horizontal) {
      const halfW = w.viewHalfW;
      const lo = cz - w.viewHalfH * 0.75;
      const hi = cz + w.viewHalfH * 0.55;
      const len = halfW * 2 + 5;
      for (let s = 0; s < sides; s++) {
        const d = s === 0 ? dir : -dir;
        const startX = cx - d * (halfW + 1);
        const angle = d > 0 ? Math.PI / 2 : -Math.PI / 2;
        for (let l = 0; l < lanes; l++) {
          // one lane always crosses the player's row
          let z = l === 0 ? p.z + (rng.next() - 0.5) * 1.2 : lo + (hi - lo) * ((l - 0.5 + rng.next() * 0.6) / lanes);
          if (s === 1) z += (hi - lo) / lanes / 2;
          flat.push(startX, z, angle, len);
        }
      }
      text = sides > 1 ? "ฝูงคลั่งพุ่งมาจากสองฝั่ง!" : dir > 0 ? "ฝูงคลั่งพุ่งมาจากทางซ้าย!" : "ฝูงคลั่งพุ่งมาจากทางขวา!";
    } else {
      // dir > 0: from the top (moving +z / screen-down)
      const halfW = w.viewHalfW;
      const startZ = dir > 0 ? cz - w.viewHalfH - 1 : cz + w.viewHalfH * 0.75 + 1;
      const angle = dir > 0 ? 0 : Math.PI;
      const len = w.viewHalfH * 1.75 + 5;
      for (let l = 0; l < lanes; l++) {
        const x = l === 0 ? p.x + (rng.next() - 0.5) * 1.0 : cx - halfW * 0.85 + halfW * 1.7 * ((l - 0.5 + rng.next() * 0.6) / lanes);
        flat.push(x, startZ, angle, len);
      }
      text = dir > 0 ? "ฝูงคลั่งพุ่งมาจากด้านบน!" : "ฝูงคลั่งพุ่งมาจากด้านล่าง!";
    }
    for (let k = 0; k < flat.length; k += 4) Marks.lane(flat[k], flat[k + 1], flat[k + 2], flat[k + 3], 1.5, tele, 0, "#ffa31a");
    G.events.emit("announce", { text, color: "#ffb02e" });
    this.pending.push({ t: G.time + tele, ids: ids.map(enemyDefIndex), perLane, speed, lanes: flat });
  }

  private runPending(t: number): void {
    for (let k = this.pending.length - 1; k >= 0; k--) {
      const ps = this.pending[k];
      if (t < ps.t) continue;
      this.pending.splice(k, 1);
      const em = G.enemies;
      const hpMul = this.hpScale(t);
      const dmgMul = this.dmgScale(t);
      let room = this.room();
      for (let l = 0; l < ps.lanes.length; l += 4) {
        const x0 = ps.lanes[l];
        const z0 = ps.lanes[l + 1];
        const a = ps.lanes[l + 2];
        const len = ps.lanes[l + 3];
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        for (let j = 0; j < ps.perLane && room > 0; j++) {
          const back = 1.5 + j * 1.15;
          const type = ps.ids[(l / 4 + j) % ps.ids.length];
          const i = em.spawn(type, x0 - sx * back + (Math.random() - 0.5) * 0.3, z0 - sz * back + (Math.random() - 0.5) * 0.3, { hpMul, dmgMul });
          if (i < 0) continue;
          room--;
          const sp = ps.speed * (ENEMY_DEFS[type].mass >= 6 ? 0.8 : 1);
          startStampede(em, i, a, sp, (len + back) / sp);
        }
      }
    }
  }

  /** tight groups of fast fliers from a few directions */
  private swarm(id: string, groups: number, perGroup: number): void {
    const em = G.enemies;
    const t = G.time;
    const type = enemyDefIndex(id);
    const hpMul = this.hpScale(t);
    const dmgMul = this.dmgScale(t);
    const off = G.rng.angle();
    let room = this.room();
    for (let g = 0; g < groups; g++) {
      const a = off + (g / groups) * Math.PI * 2 + (G.rng.next() - 0.5) * 0.6;
      em.spawnPoint(this.tmp, 2.5, a);
      for (let k = 0; k < perGroup && room > 0; k++) {
        const r = Math.sqrt(G.rng.next()) * 2.2;
        const b = G.rng.angle();
        if (em.spawn(type, this.tmp.x + Math.cos(b) * r, this.tmp.z + Math.sin(b) * r, { hpMul, dmgMul }) >= 0) room--;
      }
    }
  }
}
