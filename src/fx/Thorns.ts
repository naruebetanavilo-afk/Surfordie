import * as THREE from "three";

/**
 * Dark thorn spikes that burst out of the ground, hold, then sink back.
 * One InstancedMesh (one draw call) of a faceted, slightly hooked cone with a
 * dark base and a glowing tip (vertex colours x instance colour).
 */
export class Thorns {
  private mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private n = 0;
  private px: Float32Array;
  private pz: Float32Array;
  private yaw: Float32Array;
  private lean: Float32Array;
  private height: Float32Array;
  private width: Float32Array;
  private t: Float32Array;
  private life: Float32Array;
  private delay: Float32Array;
  private col: Float32Array;
  private dummy = new THREE.Object3D();
  private recycle = 0;

  constructor(scene: THREE.Scene, cap = 256) {
    this.cap = cap;
    this.px = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.yaw = new Float32Array(cap);
    this.lean = new Float32Array(cap);
    this.height = new Float32Array(cap);
    this.width = new Float32Array(cap);
    this.t = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.delay = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);

    const geo = buildThornGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color("#2a0838") });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** spawn one thorn leaning `lean` radians away from its yaw direction */
  spawn(x: number, z: number, yaw: number, lean: number, height: number, width: number, life: number, delay: number, c: THREE.Color): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else {
      i = this.recycle;
      this.recycle = (this.recycle + 3) % this.cap;
    }
    this.px[i] = x;
    this.pz[i] = z;
    this.yaw[i] = yaw;
    this.lean[i] = lean;
    this.height[i] = height;
    this.width[i] = width;
    this.t[i] = 0;
    this.life[i] = life;
    this.delay[i] = delay;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
  }

  private remove(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l];
    this.pz[i] = this.pz[l];
    this.yaw[i] = this.yaw[l];
    this.lean[i] = this.lean[l];
    this.height[i] = this.height[l];
    this.width[i] = this.width[l];
    this.t[i] = this.t[l];
    this.life[i] = this.life[l];
    this.delay[i] = this.delay[l];
    this.col[i * 3] = this.col[l * 3];
    this.col[i * 3 + 1] = this.col[l * 3 + 1];
    this.col[i * 3 + 2] = this.col[l * 3 + 2];
  }

  update(dt: number): void {
    const d = this.dummy;
    let i = 0;
    let out = 0;
    const colors = this.mesh.instanceColor!.array as Float32Array;
    while (i < this.n) {
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        i++;
        continue;
      }
      this.t[i] += dt;
      const k = this.t[i] / this.life[i];
      if (k >= 1) {
        this.remove(i);
        continue;
      }
      // burst up with overshoot, hold, then sink
      let h: number;
      if (k < 0.12) {
        const u = k / 0.12;
        h = u * 1.2;
      } else if (k < 0.22) h = 1.2 - ((k - 0.12) / 0.1) * 0.2;
      else if (k < 0.7) h = 1;
      else h = 1 - (k - 0.7) / 0.3;
      const w = this.width[i] * (0.6 + 0.4 * Math.min(1, k * 6));
      d.position.set(this.px[i], -0.05, this.pz[i]);
      d.rotation.set(0, this.yaw[i], 0);
      d.rotateX(this.lean[i]);
      d.scale.set(w, Math.max(0.001, this.height[i] * h), w);
      d.updateMatrix();
      this.mesh.setMatrixAt(out, d.matrix);
      colors[out * 3] = this.col[i * 3];
      colors[out * 3 + 1] = this.col[i * 3 + 1];
      colors[out * 3 + 2] = this.col[i * 3 + 2];
      out++;
      i++;
    }
    this.mesh.count = out;
    if (out > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, out * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      const ic = this.mesh.instanceColor!;
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, out * 3);
      ic.needsUpdate = true;
    }
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** faceted cone (height 1, radius 1) bent into a slight hook, dark base -> bright tip */
function buildThornGeometry(): THREE.BufferGeometry {
  const sides = 5;
  const rings = 4;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const base = new THREE.Color("#1a0626");
  const mid = new THREE.Color("#5a1a7a");
  const tip = new THREE.Color("#ff7cf0");
  const c = new THREE.Color();
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const rad = (1 - v) * (1 - v * 0.15);
    // hook: bend toward +Z as it rises
    const bend = v * v * 0.35;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, v, Math.sin(a) * rad + bend);
      if (v < 0.6) c.copy(base).lerp(mid, v / 0.6);
      else c.copy(mid).lerp(tip, (v - 0.6) / 0.4);
      // alternate facet shading for a faceted toon read
      const f = s % 2 === 0 ? 1 : 0.78;
      col.push(c.r * f, c.g * f, c.b * f);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      const a2 = a + sides;
      const b2 = b + sides;
      idx.push(a, a2, b, b, a2, b2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}
