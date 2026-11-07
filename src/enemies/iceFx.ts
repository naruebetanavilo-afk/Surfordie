import * as THREE from "three";
import { G } from "../core/G";
import { ModelKit, place, cone, ico, kitToonMaterial } from "../world/ModelKit";

/**
 * Ice crystals for the frozen roster: ONE InstancedMesh (one draw call).
 *  - spike(): a shard erupts from the ground (overshoot), holds, sinks back
 *    (boss ice lanes, yeti ground pounds, icicle impacts)
 *  - icicle(): a big icicle falls from the sky and lands exactly after `fall`
 *    seconds (the caller resolves the hit at the same moment)
 * Uses the shared decor toon material program (no extra shader compile) and
 * is created at boot by the Director so the shader prewarm sees it.
 */

const CAP = 192;
const MODE_SPIKE = 0;
const MODE_FALL = 1;

function buildShard(): THREE.BufferGeometry {
  const k = new ModelKit();
  // main crystal (unit height, base at y = 0) + two small side shards
  const main = cone(0.22, 1, 6);
  main.translate(0, 0.5, 0);
  k.add(main, "#8fdcff", { glow: 0.55, shadeBottom: 0.55 });
  const tip = ico(0.09, 0);
  tip.scale(0.8, 1.6, 0.8);
  k.add(place(tip, 0, 0.86, 0), "#f2fcff", { glow: 0.8 });
  const s1 = cone(0.1, 0.42, 5);
  s1.translate(0, 0.21, 0);
  k.add(place(s1, 0.13, 0, 0.05, 0.1, 0, -0.55), "#6cc4f4", { glow: 0.45, shadeBottom: 0.6 });
  const s2 = cone(0.08, 0.34, 5);
  s2.translate(0, 0.17, 0);
  k.add(place(s2, -0.12, 0, -0.04, -0.15, 0, 0.6), "#6cc4f4", { glow: 0.45, shadeBottom: 0.6 });
  return k.build();
}

class IceLayer {
  private mesh: THREE.InstancedMesh | null = null;
  private n = 0;
  private recycle = 0;
  private readonly px = new Float32Array(CAP);
  private readonly pz = new Float32Array(CAP);
  private readonly yaw = new Float32Array(CAP);
  private readonly lean = new Float32Array(CAP);
  private readonly h = new Float32Array(CAP);
  private readonly w = new Float32Array(CAP);
  private readonly t = new Float32Array(CAP);
  private readonly life = new Float32Array(CAP);
  private readonly delay = new Float32Array(CAP);
  private readonly mode = new Uint8Array(CAP);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  /** create the (hidden) mesh now so the boot-time shader prewarm compiles it */
  prepare(): void {
    if (this.mesh) return;
    const mesh = new THREE.InstancedMesh(buildShard(), kitToonMaterial({ rim: 0.5, rimColor: "#e6fbff" }), CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    // outside of a run the director stops ticking: drop leftovers (like Marks)
    mesh.onBeforeRender = () => {
      const s = G.state;
      if (s === "menu" || s === "gameover" || s === "victory" || s === "boot") this.clear();
    };
    G.world.scene.add(mesh);
    this.mesh = mesh;
  }

  private take(): number {
    if (this.n < CAP) return this.n++;
    const i = this.recycle;
    this.recycle = (this.recycle + 7) % CAP;
    return i;
  }

  /** a shard erupting at (x,z): height h, alive `life` s after `delay` s */
  spike(x: number, z: number, h: number, life: number, delay = 0, lean = 0.25): void {
    this.prepare();
    const i = this.take();
    this.px[i] = x;
    this.pz[i] = z;
    this.yaw[i] = Math.random() * Math.PI * 2;
    this.lean[i] = (Math.random() - 0.5) * 2 * lean;
    this.h[i] = h;
    this.w[i] = h * (0.75 + Math.random() * 0.35);
    this.t[i] = 0;
    this.life[i] = life;
    this.delay[i] = delay;
    this.mode[i] = MODE_SPIKE;
  }

  /** a ring of shards around (x,z) (ground pound / impact) */
  burst(x: number, z: number, radius: number, count: number, h: number, life: number): void {
    const off = Math.random() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const a = off + (k / count) * Math.PI * 2;
      const d = radius * (0.55 + Math.random() * 0.45);
      this.spike(x + Math.cos(a) * d, z + Math.sin(a) * d, h * (0.6 + Math.random() * 0.5), life, Math.random() * 0.06, 0.5);
    }
    this.spike(x, z, h * 1.3, life, 0, 0.1);
  }

  /** a big icicle that starts falling after `delay` s and lands on (x,z) `fall` s later */
  icicle(x: number, z: number, fall: number, size = 1.6, delay = 0): void {
    this.prepare();
    const i = this.take();
    this.px[i] = x;
    this.pz[i] = z;
    this.yaw[i] = Math.random() * Math.PI * 2;
    this.lean[i] = 0;
    this.h[i] = size;
    this.w[i] = size * 0.7;
    this.t[i] = 0;
    this.life[i] = fall;
    this.delay[i] = delay;
    this.mode[i] = MODE_FALL;
  }

  private remove(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l];
    this.pz[i] = this.pz[l];
    this.yaw[i] = this.yaw[l];
    this.lean[i] = this.lean[l];
    this.h[i] = this.h[l];
    this.w[i] = this.w[l];
    this.t[i] = this.t[l];
    this.life[i] = this.life[l];
    this.delay[i] = this.delay[l];
    this.mode[i] = this.mode[l];
  }

  update(dt: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    let k = 0;
    for (let i = 0; i < this.n; ) {
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        i++;
        continue;
      }
      this.t[i] += dt;
      const t = this.t[i];
      const life = this.life[i];
      if (t >= life) {
        this.remove(i);
        continue;
      }
      let y = 0;
      let sy = this.h[i];
      let pitch = this.lean[i];
      if (this.mode[i] === MODE_SPIKE) {
        // erupt with a little overshoot, hold, sink into the ground
        const rise = Math.min(1, t / 0.12);
        const grow = rise < 1 ? rise * (1.25 - 0.25 * rise) : 1;
        const sink = Math.max(0, (t - (life - 0.25)) / 0.25);
        sy *= Math.max(0.05, grow);
        y = -sink * this.h[i];
      } else {
        // falling icicle, tip down: accelerates from high above
        const f = t / life;
        y = 9 * (1 - f * f) + this.h[i];
        pitch = Math.PI;
      }
      this.e.set(pitch, this.yaw[i], 0);
      this.q.setFromEuler(this.e);
      this.p.set(this.px[i], y, this.pz[i]);
      this.s.set(this.w[i], sy, this.w[i]);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(k++, this.m);
      i++;
    }
    mesh.count = k;
    mesh.visible = k > 0;
    if (k > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, k * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    this.n = 0;
    if (this.mesh) {
      this.mesh.count = 0;
      this.mesh.visible = false;
    }
  }
}

/** shared instance (mesh created by prepare() / first use) */
export const IceFx = new IceLayer();
