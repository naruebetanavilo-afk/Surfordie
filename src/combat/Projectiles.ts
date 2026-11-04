import * as THREE from "three";
import { G } from "../core/G";
import { hitEnemy, type HitOpts } from "./damage";

export interface ProjectileKind {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** max simultaneous projectiles of this kind (default 512) */
  capacity?: number;
  /** rotate the mesh to face its velocity (models point along +Z) */
  faceVelocity?: boolean;
  /** constant spin around Y (rad/s) */
  spin?: number;
  /** spin around the local X axis (tumbling), rad/s */
  tumble?: number;
}

export interface ProjSpawn {
  kind: string;
  x: number;
  z: number;
  /** height above ground (default 0.7) */
  y?: number;
  vx: number;
  vz: number;
  /** base damage (might/crit applied in hitEnemy) */
  damage: number;
  /** collision radius */
  radius: number;
  /** lifetime in seconds */
  life: number;
  /** how many enemies it can pass through. 0 = dies on first hit. Infinity = never */
  pierce?: number;
  /** weapon id for stats */
  source: string;
  /** knockback force */
  kb?: number;
  /** homing turn rate (rad/s), 0 = straight */
  homing?: number;
  /** visual scale */
  scale?: number;
  /** hostile projectiles hurt the player instead of enemies */
  hostile?: boolean;
  /** if > 0, the same enemy can be hit again after this many seconds */
  rehit?: number;
  /** extra hit options (slow, freeze, colour) */
  hit?: HitOpts;
  /** custom per-frame motion. If it returns true the default movement is skipped */
  update?: (p: Proj, dt: number) => boolean | void;
  onHit?: (p: Proj, enemy: number) => void;
  onExpire?: (p: Proj) => void;
  data?: Record<string, unknown>;
}

export class Proj {
  alive = false;
  kindIdx = 0;
  x = 0;
  y = 0.7;
  z = 0;
  vx = 0;
  vz = 0;
  damage = 0;
  radius = 0.3;
  life = 1;
  age = 0;
  pierce = 0;
  source = "";
  kb = 0;
  homing = 0;
  scale = 1;
  hostile = false;
  rehit = 0;
  rot = 0;
  hit: HitOpts | undefined;
  /** uid -> time of last hit */
  hits = new Map<number, number>();
  update: ProjSpawn["update"];
  onHit: ProjSpawn["onHit"];
  onExpire: ProjSpawn["onExpire"];
  data: Record<string, unknown> = {};
}

interface KindRec {
  name: string;
  def: ProjectileKind;
  mesh: THREE.InstancedMesh;
}

const MAX_PROJ = 1500;

export class Projectiles {
  private pool: Proj[] = [];
  private active: Proj[] = [];
  private kinds: KindRec[] = [];
  private kindIndex = new Map<string, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, "YXZ");
  private pv = new THREE.Vector3();
  private sv = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < MAX_PROJ; i++) this.pool.push(new Proj());
  }

  /** register a visual kind once (weapons do this lazily on first use) */
  registerKind(name: string, def: ProjectileKind): void {
    if (this.kindIndex.has(name)) return;
    const mesh = new THREE.InstancedMesh(def.geometry, def.material, def.capacity ?? 512);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.add(mesh);
    this.kindIndex.set(name, this.kinds.length);
    this.kinds.push({ name, def, mesh });
  }

  hasKind(name: string): boolean {
    return this.kindIndex.has(name);
  }

  spawn(s: ProjSpawn): Proj | null {
    const p = this.pool.pop();
    if (!p) return null;
    const ki = this.kindIndex.get(s.kind);
    if (ki === undefined) throw new Error(`Projectile kind not registered: ${s.kind}`);
    p.alive = true;
    p.kindIdx = ki;
    p.x = s.x;
    p.z = s.z;
    p.y = s.y ?? 0.7;
    p.vx = s.vx;
    p.vz = s.vz;
    p.damage = s.damage;
    p.radius = s.radius;
    p.life = s.life;
    p.age = 0;
    p.pierce = s.pierce ?? 0;
    p.source = s.source;
    p.kb = s.kb ?? 0;
    p.homing = s.homing ?? 0;
    p.scale = s.scale ?? 1;
    p.hostile = !!s.hostile;
    p.rehit = s.rehit ?? 0;
    p.hit = s.hit;
    p.rot = Math.random() * Math.PI * 2;
    p.hits.clear();
    p.update = s.update;
    p.onHit = s.onHit;
    p.onExpire = s.onExpire;
    p.data = s.data ?? {};
    this.active.push(p);
    return p;
  }

  kill(p: Proj): void {
    p.alive = false;
  }

  clear(): void {
    for (const p of this.active) {
      p.alive = false;
      this.pool.push(p);
    }
    this.active.length = 0;
    for (const k of this.kinds) k.mesh.count = 0;
  }

  /** iterate active projectiles (read-only use) */
  each(cb: (p: Proj) => void): void {
    for (const p of this.active) if (p.alive) cb(p);
  }

  update(dt: number): void {
    const em = G.enemies;
    const pl = G.player;
    const now = G.time;
    for (let a = 0; a < this.active.length; a++) {
      const p = this.active[a];
      if (!p.alive) continue;
      p.age += dt;
      const kind = this.kinds[p.kindIdx].def;
      if (kind.spin) p.rot += kind.spin * dt;
      let custom = false;
      if (p.update) custom = !!p.update(p, dt);
      if (!p.alive) continue;
      if (!custom) {
        if (p.homing > 0 && !p.hostile) {
          const t = em.nearest(p.x, p.z, 10);
          if (t >= 0) {
            const desired = Math.atan2(em.z[t] - p.z, em.x[t] - p.x);
            const cur = Math.atan2(p.vz, p.vx);
            let d = desired - cur;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            const turn = Math.max(-p.homing * dt, Math.min(p.homing * dt, d));
            const sp = Math.hypot(p.vx, p.vz);
            const na = cur + turn;
            p.vx = Math.cos(na) * sp;
            p.vz = Math.sin(na) * sp;
          }
        }
        p.x += p.vx * dt;
        p.z += p.vz * dt;
      }
      if (p.hostile) {
        const dx = pl.x - p.x;
        const dz = pl.z - p.z;
        const rr = p.radius + pl.radius;
        if (dx * dx + dz * dz < rr * rr) {
          pl.takeDamage(p.damage);
          p.onHit?.(p, -1);
          p.alive = false;
          continue;
        }
      } else {
        em.queryCircle(p.x, p.z, p.radius, (i) => {
          const uid = em.uid[i];
          const last = p.hits.get(uid);
          if (last !== undefined && (p.rehit <= 0 || now - last < p.rehit)) return false;
          p.hits.set(uid, now);
          hitEnemy(i, p.damage, p.source, { kb: p.kb, dirX: p.vx, dirZ: p.vz, ...p.hit });
          p.onHit?.(p, i);
          if (p.pierce <= 0) {
            p.alive = false;
            return true;
          }
          p.pierce--;
          return false;
        });
      }
      if (p.age >= p.life) {
        if (p.alive) p.onExpire?.(p);
        p.alive = false;
      }
    }
    // compact
    let w = 0;
    for (let r = 0; r < this.active.length; r++) {
      const p = this.active[r];
      if (p.alive) this.active[w++] = p;
      else this.pool.push(p);
    }
    this.active.length = w;
  }

  render(): void {
    for (const k of this.kinds) k.mesh.count = 0;
    for (const p of this.active) {
      const k = this.kinds[p.kindIdx];
      const mesh = k.mesh;
      if (mesh.count >= mesh.instanceMatrix.count) continue;
      let yaw = p.rot;
      let pitch = 0;
      if (k.def.faceVelocity) yaw = Math.atan2(p.vx, p.vz);
      if (k.def.tumble) pitch = p.age * k.def.tumble;
      this.e.set(pitch, yaw, 0);
      this.q.setFromEuler(this.e);
      this.pv.set(p.x, p.y, p.z);
      this.sv.setScalar(p.scale);
      this.m.compose(this.pv, this.q, this.sv);
      mesh.setMatrixAt(mesh.count++, this.m);
    }
    for (const k of this.kinds) {
      if (k.mesh.count > 0) k.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
