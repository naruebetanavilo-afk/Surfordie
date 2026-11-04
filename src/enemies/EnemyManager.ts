import * as THREE from "three";
import { G } from "../core/G";
import { ENEMY_DEFS, enemyDefIndex } from "./defs";
import { FLAG_BOSS, FLAG_ELITE, type EnemyDef, type SpawnOpts } from "./types";
import { createAnimatedMaterial, animTime } from "./AnimatedMaterial";
import { SpatialGrid } from "./SpatialGrid";
import { blobShadowTexture } from "../fx/textures";

export const MAX_ENEMIES = 1400;

/**
 * Structure-of-arrays horde. Indices are stable within a frame; removals are
 * compacted at the end of update(). Never keep an index across frames — keep
 * the uid instead (em.uid[i]) and use em.findByUid if needed.
 */
export class EnemyManager {
  readonly defs: EnemyDef[] = ENEMY_DEFS;
  /** number of used slots (alive + dying) */
  n = 0;
  private nextUid = 1;

  readonly uid = new Int32Array(MAX_ENEMIES);
  readonly type = new Uint8Array(MAX_ENEMIES);
  /** 0 = alive, 1 = dying */
  readonly state = new Uint8Array(MAX_ENEMIES);
  readonly flags = new Uint8Array(MAX_ENEMIES);
  readonly x = new Float32Array(MAX_ENEMIES);
  readonly z = new Float32Array(MAX_ENEMIES);
  /** knockback velocity */
  readonly kx = new Float32Array(MAX_ENEMIES);
  readonly kz = new Float32Array(MAX_ENEMIES);
  readonly yaw = new Float32Array(MAX_ENEMIES);
  readonly hp = new Float32Array(MAX_ENEMIES);
  readonly maxHp = new Float32Array(MAX_ENEMIES);
  readonly speed = new Float32Array(MAX_ENEMIES);
  readonly dmg = new Float32Array(MAX_ENEMIES);
  readonly radius = new Float32Array(MAX_ENEMIES);
  readonly mass = new Float32Array(MAX_ENEMIES);
  readonly scale = new Float32Array(MAX_ENEMIES);
  readonly xp = new Float32Array(MAX_ENEMIES);
  readonly flash = new Float32Array(MAX_ENEMIES);
  readonly phase = new Float32Array(MAX_ENEMIES);
  /** remaining slow duration and slow multiplier (0.5 = half speed) */
  readonly slowT = new Float32Array(MAX_ENEMIES);
  readonly slowMul = new Float32Array(MAX_ENEMIES);
  /** remaining freeze duration (cannot move) */
  readonly freezeT = new Float32Array(MAX_ENEMIES);
  readonly dieT = new Float32Array(MAX_ENEMIES);
  /** current walk animation rate (0 idle) */
  readonly walk = new Float32Array(MAX_ENEMIES);
  /** time since spawn */
  readonly age = new Float32Array(MAX_ENEMIES);
  /** generic AI scratch registers for EnemyDef.update hooks */
  readonly ai0 = new Float32Array(MAX_ENEMIES);
  readonly ai1 = new Float32Array(MAX_ENEMIES);
  readonly ai2 = new Float32Array(MAX_ENEMIES);
  readonly ai3 = new Float32Array(MAX_ENEMIES);
  /** last weapon id that hit it (for kill attribution) */
  readonly lastHitBy: string[] = new Array(MAX_ENEMIES).fill("");

  readonly grid = new SpatialGrid(MAX_ENEMIES);

  private meshes: THREE.InstancedMesh[] = [];
  private animAttrs: THREE.InstancedBufferAttribute[] = [];
  private shadows: THREE.InstancedMesh;
  private counts: number[] = [];
  private aliveCount = 0;
  private removeQueue: number[] = [];
  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    for (const def of this.defs) {
      const geo = def.build();
      const cap = def.capacity ?? MAX_ENEMIES;
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("aAnim", anim);
      const mat = createAnimatedMaterial(def.anim);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      // allocate instanceColor (white = untinted)
      for (let k = 0; k < cap; k++) mesh.setColorAt(k, this.tmpColor.setRGB(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.meshes.push(mesh);
      this.animAttrs.push(anim);
      this.counts.push(0);
    }
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    const sm = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      color: "#000000",
      opacity: 0.38,
    });
    this.shadows = new THREE.InstancedMesh(sg, sm, MAX_ENEMIES);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = -5;
    scene.add(this.shadows);
  }

  get alive(): number {
    return this.aliveCount;
  }

  def(i: number): EnemyDef {
    return this.defs[this.type[i]];
  }

  isBoss(i: number): boolean {
    return (this.flags[i] & FLAG_BOSS) !== 0;
  }
  isElite(i: number): boolean {
    return (this.flags[i] & FLAG_ELITE) !== 0;
  }

  /** remove everything (new run) */
  clear(): void {
    this.n = 0;
    this.aliveCount = 0;
    this.removeQueue.length = 0;
    for (const m of this.meshes) m.count = 0;
    this.shadows.count = 0;
  }

  /** spawn an enemy by def id or index. returns slot index or -1 if full */
  spawn(id: string | number, x: number, z: number, opts: SpawnOpts = {}): number {
    if (this.n >= MAX_ENEMIES) return -1;
    const t = typeof id === "number" ? id : enemyDefIndex(id);
    const def = this.defs[t];
    const cap = def.capacity ?? MAX_ENEMIES;
    let typeCount = 0;
    for (let k = 0; k < this.n; k++) if (this.type[k] === t) typeCount++;
    if (typeCount >= cap) return -1;
    const i = this.n++;
    const elite = !!opts.elite;
    this.uid[i] = this.nextUid++;
    this.type[i] = t;
    this.state[i] = 0;
    this.flags[i] = (elite ? FLAG_ELITE : 0) | (def.boss ? FLAG_BOSS : 0);
    this.x[i] = x;
    this.z[i] = z;
    this.kx[i] = 0;
    this.kz[i] = 0;
    const px = G.player ? G.player.x : 0;
    const pz = G.player ? G.player.z : 0;
    this.yaw[i] = Math.atan2(px - x, pz - z);
    const hp = def.hp * (opts.hpMul ?? 1) * (elite ? 8 : 1);
    this.hp[i] = hp;
    this.maxHp[i] = hp;
    this.speed[i] = def.speed * (opts.speedMul ?? 1) * (0.9 + Math.random() * 0.2);
    this.dmg[i] = def.damage * (opts.dmgMul ?? 1) * (elite ? 1.5 : 1);
    const sc = def.scale * (opts.scaleMul ?? 1) * (elite ? 1.35 : 1);
    this.scale[i] = sc;
    this.radius[i] = def.radius * sc / def.scale;
    this.mass[i] = def.mass * (elite ? 3 : 1);
    this.xp[i] = def.xp * (elite ? 10 : 1);
    this.flash[i] = 0;
    this.phase[i] = Math.random() * Math.PI * 2;
    this.slowT[i] = 0;
    this.slowMul[i] = 1;
    this.freezeT[i] = 0;
    this.dieT[i] = 0;
    this.walk[i] = def.walkRate;
    this.age[i] = 0;
    this.ai0[i] = this.ai1[i] = this.ai2[i] = this.ai3[i] = 0;
    this.lastHitBy[i] = "";
    this.aliveCount++;
    def.onSpawn?.(this, i);
    return i;
  }

  /** mark enemy as killed (plays death anim, drops loot). safe to call once. */
  kill(i: number, source = ""): void {
    if (this.state[i] !== 0) return;
    this.state[i] = 1;
    this.dieT[i] = 0.0001;
    this.aliveCount--;
    const def = this.defs[this.type[i]];
    const x = this.x[i];
    const z = this.z[i];
    const boss = this.isBoss(i);
    const elite = this.isElite(i);
    def.onDeath?.(this, i);
    const src = source || this.lastHitBy[i] || "unknown";
    G.stats.kills++;
    G.stats.killsBy[src] = (G.stats.killsBy[src] ?? 0) + 1;
    // loot
    G.pickups.spawnXp(x, z, this.xp[i]);
    const coinChance = (def.coinChance ?? 0.03) * (G.player.stats.luck);
    if (elite || boss) {
      G.pickups.spawn("chest", x, z, 1);
      for (let k = 0; k < (boss ? 12 : 4); k++) {
        G.pickups.spawn("coin", x + (Math.random() - 0.5) * 3, z + (Math.random() - 0.5) * 3, 5);
      }
    } else if (Math.random() < coinChance) {
      G.pickups.spawn("coin", x, z, 1);
    } else if (Math.random() < 0.0035 * G.player.stats.luck) {
      G.pickups.spawn(Math.random() < 0.7 ? "heal" : "magnet", x, z, 1);
    }
    G.fx.enemyDeath(x, z, def.color, this.scale[i], boss);
    G.audio.sfx("kill");
    G.events.emit("enemyKilled", { x, z, typeId: def.id, source: src, boss, elite });
    if (boss) {
      G.stats.bossesKilled++;
      G.events.emit("bossKilled", { typeId: def.id });
    }
  }

  slow(i: number, mul: number, time: number): void {
    if (this.isBoss(i)) mul = Math.max(mul, 0.7);
    if (mul <= this.slowMul[i] || this.slowT[i] <= 0) this.slowMul[i] = mul;
    this.slowT[i] = Math.max(this.slowT[i], time);
  }

  freeze(i: number, time: number): void {
    if (this.isBoss(i)) time *= 0.25;
    this.freezeT[i] = Math.max(this.freezeT[i], time);
  }

  /** apply a knockback impulse (world units/sec) scaled by mass */
  knock(i: number, dx: number, dz: number, force: number): void {
    const len = Math.hypot(dx, dz) || 1;
    const m = this.mass[i];
    if (m >= 50) return;
    const f = force / m;
    this.kx[i] += (dx / len) * f;
    this.kz[i] += (dz / len) * f;
  }

  findByUid(uid: number): number {
    for (let i = 0; i < this.n; i++) if (this.uid[i] === uid && this.state[i] === 0) return i;
    return -1;
  }

  /** visit living enemies whose body overlaps circle (x,z,r). return true from cb to stop early */
  queryCircle(x: number, z: number, r: number, cb: (i: number) => boolean | void): void {
    this.grid.query(x, z, r + 1.6, (i) => {
      if (this.state[i] !== 0) return false;
      const dx = this.x[i] - x;
      const dz = this.z[i] - z;
      const rr = r + this.radius[i];
      if (dx * dx + dz * dz <= rr * rr) return cb(i);
      return false;
    });
  }

  /** nearest living enemy to (x,z) within maxR. -1 if none */
  nearest(x: number, z: number, maxR = 30, exclude?: Set<number>): number {
    let best = -1;
    let bd = maxR * maxR;
    // grid query for small radius, brute force otherwise
    if (maxR <= 12) {
      this.grid.query(x, z, maxR, (i) => {
        if (this.state[i] !== 0) return;
        if (exclude && exclude.has(this.uid[i])) return;
        const dx = this.x[i] - x;
        const dz = this.z[i] - z;
        const d = dx * dx + dz * dz;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    }
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== 0) continue;
      if (exclude && exclude.has(this.uid[i])) continue;
      const dx = this.x[i] - x;
      const dz = this.z[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** random living enemy that is currently visible on screen, or -1 */
  randomVisible(): number {
    if (this.aliveCount === 0) return -1;
    for (let tries = 0; tries < 24; tries++) {
      const i = Math.floor(Math.random() * this.n);
      if (this.state[i] === 0 && G.world.onScreen(this.x[i], this.z[i], -0.5)) return i;
    }
    return -1;
  }

  /**
   * Find a good AoE target point near the player: samples visible enemies and
   * returns the one with the most neighbours within `radius`. -1 if none.
   */
  densestTarget(radius: number, samples = 12): number {
    let best = -1;
    let bestN = -1;
    for (let s = 0; s < samples; s++) {
      const i = this.randomVisible();
      if (i < 0) continue;
      let c = 0;
      this.queryCircle(this.x[i], this.z[i], radius, () => {
        c++;
      });
      if (c > bestN) {
        bestN = c;
        best = i;
      }
    }
    return best;
  }

  /** a spawn point just outside the visible area, biased towards the player's heading */
  spawnPoint(out: { x: number; z: number }, extra = 1.5, angle?: number): void {
    const w = G.world;
    const p = G.player;
    let a = angle ?? Math.random() * Math.PI * 2;
    if (angle === undefined && (p.velX !== 0 || p.velZ !== 0) && Math.random() < 0.35) {
      a = Math.atan2(p.velZ, p.velX) + (Math.random() - 0.5) * 1.6;
    }
    const cx = w.camTarget.x;
    const cz = w.camTarget.z;
    const hw = w.viewHalfW + extra;
    const hhTop = w.viewHalfH + extra; // far side (-z) is larger on screen
    const hhBot = w.viewHalfH * 0.75 + extra;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // ray-rectangle intersection
    const tx = Math.abs(dx) > 1e-4 ? hw / Math.abs(dx) : 1e9;
    const tz = Math.abs(dz) > 1e-4 ? (dz < 0 ? hhTop : hhBot) / Math.abs(dz) : 1e9;
    const t = Math.min(tx, tz);
    out.x = cx + dx * t;
    out.z = cz + dz * t;
  }

  update(dt: number): void {
    const p = G.player;
    const px = p.x;
    const pz = p.z;
    const pr = p.radius;
    const n = this.n;
    const recycleDist = Math.max(G.world.viewHalfW, G.world.viewHalfH) * 2.2 + 6;
    const recycleD2 = recycleDist * recycleDist;
    const tmp = { x: 0, z: 0 };

    // 1) AI + movement
    for (let i = 0; i < n; i++) {
      if (this.state[i] !== 0) {
        this.dieT[i] += dt * 2.6;
        this.flash[i] = Math.max(0, this.flash[i] - dt * 6);
        if (this.dieT[i] >= 1) this.removeQueue.push(i);
        continue;
      }
      this.age[i] += dt;
      if (this.flash[i] > 0) this.flash[i] = Math.max(0, this.flash[i] - dt * 7);
      if (this.slowT[i] > 0) {
        this.slowT[i] -= dt;
        if (this.slowT[i] <= 0) this.slowMul[i] = 1;
      }
      const def = this.defs[this.type[i]];
      let handled = false;
      if (this.freezeT[i] > 0) {
        this.freezeT[i] -= dt;
        handled = true;
        this.walk[i] = 0;
      } else if (def.update) {
        handled = !!def.update(this, i, dt);
      }
      const dx = px - this.x[i];
      const dz = pz - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (!handled) {
        const d = Math.sqrt(d2) || 1;
        const sp = this.speed[i] * this.slowMul[i];
        this.x[i] += (dx / d) * sp * dt;
        this.z[i] += (dz / d) * sp * dt;
        // smooth turn towards the player
        const target = Math.atan2(dx, dz);
        let diff = target - this.yaw[i];
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.yaw[i] += diff * Math.min(1, dt * 8);
        this.walk[i] = def.walkRate * this.slowMul[i];
      }
      // knockback
      const kx = this.kx[i];
      const kz = this.kz[i];
      if (kx !== 0 || kz !== 0) {
        this.x[i] += kx * dt;
        this.z[i] += kz * dt;
        const f = Math.exp(-dt * 9);
        this.kx[i] = Math.abs(kx * f) < 0.01 ? 0 : kx * f;
        this.kz[i] = Math.abs(kz * f) < 0.01 ? 0 : kz * f;
      }
      // recycle stragglers far behind the player
      if (d2 > recycleD2) {
        if (this.isBoss(i)) {
          // bosses teleport to the edge of the screen instead
          this.spawnPoint(tmp, 1);
        } else {
          this.spawnPoint(tmp, 2);
        }
        this.x[i] = tmp.x;
        this.z[i] = tmp.z;
        this.kx[i] = this.kz[i] = 0;
      }
    }

    // 2) spatial grid + separation
    this.grid.rebuild(this, px, pz);
    this.separate();

    // 3) player contact
    let maxD = 0;
    let sumD = 0;
    let touching = 0;
    for (let i = 0; i < n; i++) {
      if (this.state[i] !== 0) continue;
      const dx = this.x[i] - px;
      const dz = this.z[i] - pz;
      const rr = this.radius[i] + pr;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.001;
        // push enemy out of the player
        const push = (rr - d) * (this.isBoss(i) ? 0.2 : 0.8);
        this.x[i] += (dx / d) * push;
        this.z[i] += (dz / d) * push;
        if (d < rr + 0.05) {
          touching++;
          sumD += this.dmg[i];
          if (this.dmg[i] > maxD) maxD = this.dmg[i];
        }
      }
    }
    if (touching > 0) {
      const total = maxD + (sumD - maxD) * 0.3;
      p.contactDamage(total);
    }

    // 4) remove fully dead (descending order keeps indices valid while swapping)
    if (this.removeQueue.length) {
      this.removeQueue.sort((a, b) => b - a);
      for (const i of this.removeQueue) this.removeAt(i);
      this.removeQueue.length = 0;
    }
    animTime.value = G.time;
    G.perf.enemies = this.aliveCount;
  }

  private separate(): void {
    const g = this.grid;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.state[i] !== 0) continue;
      const xi = this.x[i];
      const zi = this.z[i];
      const ri = this.radius[i];
      const mi = this.mass[i];
      g.query(xi, zi, ri + 1.2, (j) => {
        if (j <= i || this.state[j] !== 0) return;
        const dx = this.x[j] - xi;
        const dz = this.z[j] - zi;
        const rr = ri + this.radius[j];
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) {
          if (d2 < 1e-8) {
            this.x[j] += (Math.random() - 0.5) * 0.05;
            this.z[j] += (Math.random() - 0.5) * 0.05;
          }
          return;
        }
        const d = Math.sqrt(d2);
        const overlap = (rr - d) * 0.5;
        const mj = this.mass[j];
        const wi = mj / (mi + mj);
        const wj = mi / (mi + mj);
        const nx = dx / d;
        const nz = dz / d;
        this.x[i] -= nx * overlap * wi;
        this.z[i] -= nz * overlap * wi;
        this.x[j] += nx * overlap * wj;
        this.z[j] += nz * overlap * wj;
      });
    }
  }

  private removeAt(i: number): void {
    const last = this.n - 1;
    if (i !== last) this.copySlot(i, last);
    this.n--;
  }

  private copySlot(d: number, s: number): void {
    this.uid[d] = this.uid[s];
    this.type[d] = this.type[s];
    this.state[d] = this.state[s];
    this.flags[d] = this.flags[s];
    this.x[d] = this.x[s];
    this.z[d] = this.z[s];
    this.kx[d] = this.kx[s];
    this.kz[d] = this.kz[s];
    this.yaw[d] = this.yaw[s];
    this.hp[d] = this.hp[s];
    this.maxHp[d] = this.maxHp[s];
    this.speed[d] = this.speed[s];
    this.dmg[d] = this.dmg[s];
    this.radius[d] = this.radius[s];
    this.mass[d] = this.mass[s];
    this.scale[d] = this.scale[s];
    this.xp[d] = this.xp[s];
    this.flash[d] = this.flash[s];
    this.phase[d] = this.phase[s];
    this.slowT[d] = this.slowT[s];
    this.slowMul[d] = this.slowMul[s];
    this.freezeT[d] = this.freezeT[s];
    this.dieT[d] = this.dieT[s];
    this.walk[d] = this.walk[s];
    this.age[d] = this.age[s];
    this.ai0[d] = this.ai0[s];
    this.ai1[d] = this.ai1[s];
    this.ai2[d] = this.ai2[s];
    this.ai3[d] = this.ai3[s];
    this.lastHitBy[d] = this.lastHitBy[s];
  }

  /** write instance buffers. call once per rendered frame */
  render(): void {
    const counts = this.counts;
    for (let t = 0; t < counts.length; t++) counts[t] = 0;
    const sh = this.shadows.instanceMatrix.array as Float32Array;
    let ns = 0;
    for (let i = 0; i < this.n; i++) {
      const t = this.type[i];
      const mesh = this.meshes[t];
      const k = counts[t]++;
      if (k >= mesh.instanceMatrix.count) continue;
      const m = mesh.instanceMatrix.array as Float32Array;
      const sc = this.scale[i];
      const fl = this.flash[i];
      // squash on hit
      const sy = sc * (1 - fl * 0.12);
      const sxz = sc * (1 + fl * 0.08);
      const c = Math.cos(this.yaw[i]);
      const s = Math.sin(this.yaw[i]);
      const o = k * 16;
      m[o] = c * sxz;
      m[o + 1] = 0;
      m[o + 2] = -s * sxz;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = sy;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s * sxz;
      m[o + 9] = 0;
      m[o + 10] = c * sxz;
      m[o + 11] = 0;
      m[o + 12] = this.x[i];
      m[o + 13] = 0;
      m[o + 14] = this.z[i];
      m[o + 15] = 1;
      const a = this.animAttrs[t].array as Float32Array;
      const ao = k * 4;
      a[ao] = this.phase[i];
      a[ao + 1] = fl;
      a[ao + 2] = Math.min(1, this.dieT[i]);
      a[ao + 3] = this.state[i] === 0 ? this.walk[i] : 0;
      const col = mesh.instanceColor!.array as Float32Array;
      const co = k * 3;
      if (this.freezeT[i] > 0) {
        col[co] = 0.55;
        col[co + 1] = 0.8;
        col[co + 2] = 1.4;
      } else if (this.isElite(i)) {
        col[co] = 1.25;
        col[co + 1] = 0.85;
        col[co + 2] = 0.55;
      } else if (this.slowT[i] > 0) {
        col[co] = 0.75;
        col[co + 1] = 0.9;
        col[co + 2] = 1.2;
      } else {
        col[co] = 1;
        col[co + 1] = 1;
        col[co + 2] = 1;
      }
      // blob shadow
      const r = this.radius[i] * 2.6 * (1 - Math.min(1, this.dieT[i]) * 0.6);
      const so = ns * 16;
      sh[so] = r;
      sh[so + 1] = 0;
      sh[so + 2] = 0;
      sh[so + 3] = 0;
      sh[so + 4] = 0;
      sh[so + 5] = 1;
      sh[so + 6] = 0;
      sh[so + 7] = 0;
      sh[so + 8] = 0;
      sh[so + 9] = 0;
      sh[so + 10] = r;
      sh[so + 11] = 0;
      sh[so + 12] = this.x[i];
      sh[so + 13] = 0.02;
      sh[so + 14] = this.z[i];
      sh[so + 15] = 1;
      ns++;
    }
    for (let t = 0; t < this.meshes.length; t++) {
      const mesh = this.meshes[t];
      mesh.count = Math.min(counts[t], mesh.instanceMatrix.count);
      if (mesh.count > 0) {
        mesh.instanceMatrix.clearUpdateRanges();
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        const a = this.animAttrs[t];
        a.clearUpdateRanges();
        a.addUpdateRange(0, mesh.count * 4);
        a.needsUpdate = true;
        const ic = mesh.instanceColor!;
        ic.clearUpdateRanges();
        ic.addUpdateRange(0, mesh.count * 3);
        ic.needsUpdate = true;
      }
    }
    this.shadows.count = ns;
    if (ns > 0) {
      this.shadows.instanceMatrix.clearUpdateRanges();
      this.shadows.instanceMatrix.addUpdateRange(0, ns * 16);
      this.shadows.instanceMatrix.needsUpdate = true;
    }
  }
}
