import * as THREE from "three";
import { G } from "../../core/G";

const SEG = 10;
const VPB = (SEG + 1) * 2; // vertices per bolt

const vert = /* glsl */ `
attribute float aSide;
attribute vec4 aCol;
varying float vSide;
varying vec4 vCol;
void main() {
  vSide = aSide;
  vCol = aCol;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
varying float vSide;
varying vec4 vCol;
void main() {
  float d = abs(vSide);
  float core = 1.0 - smoothstep(0.0, 0.35, d);
  float halo = pow(1.0 - d, 1.6);
  float i = (halo * 0.85 + core * 1.2) * vCol.a;
  vec3 c = mix(vCol.rgb, vec3(1.0), core * 0.85);
  gl_FragColor = vec4(c * i, clamp(i * 0.55, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

/**
 * Camera-facing jagged lightning ribbons, all in ONE dynamic buffer / draw
 * call. The ribbon width is computed against the fixed camera direction, so
 * vertical sky strikes stay as wide as horizontal chain arcs. Bolts re-jitter
 * a few times during their life for a crackling look.
 */
export class Bolts {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly colA: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  // per-bolt state
  private readonly active: Uint8Array;
  private readonly ab: Float32Array; // ax ay az bx by bz
  private readonly side: Float32Array; // ribbon side vector
  private readonly t: Float32Array;
  private readonly life: Float32Array;
  private readonly width: Float32Array;
  private readonly jit: Float32Array;
  private readonly rgb: Float32Array;
  private readonly off: Float32Array;
  private readonly rej: Float32Array;
  private head = 0;
  private anyActive = false;
  private readonly view = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    readonly cap = 96,
  ) {
    const nv = cap * VPB;
    this.pos = new Float32Array(nv * 3);
    this.colA = new Float32Array(nv * 4);
    const sideArr = new Float32Array(nv);
    const idx: number[] = [];
    for (let b = 0; b < cap; b++) {
      for (let i = 0; i <= SEG; i++) {
        sideArr[b * VPB + i * 2] = -1;
        sideArr[b * VPB + i * 2 + 1] = 1;
      }
      for (let i = 0; i < SEG; i++) {
        const a = b * VPB + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colA, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("aCol", this.colAttr);
    geo.setAttribute("aSide", new THREE.BufferAttribute(sideArr, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    scene.add(this.mesh);
    this.active = new Uint8Array(cap);
    this.ab = new Float32Array(cap * 6);
    this.side = new Float32Array(cap * 3);
    this.t = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.width = new Float32Array(cap);
    this.jit = new Float32Array(cap);
    this.rgb = new Float32Array(cap * 3);
    this.off = new Float32Array(cap * (SEG + 1));
    this.rej = new Float32Array(cap);
  }

  /** spawn a bolt from A to B. `color` is "#hex" */
  spawn(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: string, width = 0.3, jitter = 0.5, life = 0.2): void {
    const b = this.head;
    this.head = (this.head + 1) % this.cap;
    this.active[b] = 1;
    this.anyActive = true;
    const o6 = b * 6;
    this.ab[o6] = ax;
    this.ab[o6 + 1] = ay;
    this.ab[o6 + 2] = az;
    this.ab[o6 + 3] = bx;
    this.ab[o6 + 4] = by;
    this.ab[o6 + 5] = bz;
    // camera forward (fixed pitch, looking towards -Z)
    const pitch = G.world.camPitch;
    this.view.set(0, -Math.sin(pitch), -Math.cos(pitch));
    this.d.set(bx - ax, by - ay, bz - az).normalize();
    this.s.crossVectors(this.d, this.view);
    if (this.s.lengthSq() < 1e-6) this.s.set(1, 0, 0);
    this.s.normalize();
    this.side[b * 3] = this.s.x;
    this.side[b * 3 + 1] = this.s.y;
    this.side[b * 3 + 2] = this.s.z;
    this.t[b] = 0;
    this.life[b] = life;
    this.width[b] = width;
    this.jit[b] = jitter;
    this.tmpC.set(color);
    this.rgb[b * 3] = this.tmpC.r;
    this.rgb[b * 3 + 1] = this.tmpC.g;
    this.rgb[b * 3 + 2] = this.tmpC.b;
    this.rej[b] = 0;
    this.jitter(b);
  }

  private jitter(b: number): void {
    const o = b * (SEG + 1);
    const j = this.jit[b];
    let acc = 0;
    for (let i = 0; i <= SEG; i++) {
      if (i === 0 || i === SEG) {
        this.off[o + i] = 0;
        continue;
      }
      // random walk keeps the bolt jagged but connected
      acc = acc * 0.45 + (Math.random() - 0.5) * 2 * j;
      this.off[o + i] = acc;
    }
  }

  update(dt: number): void {
    this.mesh.visible = this.anyActive;
    if (!this.anyActive) return;
    let any = false;
    for (let b = 0; b < this.cap; b++) {
      if (!this.active[b]) continue;
      this.t[b] += dt;
      const k = this.t[b] / this.life[b];
      const vo = b * VPB;
      if (k >= 1) {
        this.active[b] = 0;
        for (let v = 0; v < VPB; v++) this.colA[(vo + v) * 4 + 3] = 0;
        continue;
      }
      any = true;
      this.rej[b] -= dt;
      if (this.rej[b] <= 0) {
        this.rej[b] = 0.045;
        this.jitter(b);
      }
      const alpha = k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75;
      const o6 = b * 6;
      const ax = this.ab[o6];
      const ay = this.ab[o6 + 1];
      const az = this.ab[o6 + 2];
      const dx = this.ab[o6 + 3] - ax;
      const dy = this.ab[o6 + 4] - ay;
      const dz = this.ab[o6 + 5] - az;
      const sx = this.side[b * 3];
      const sy = this.side[b * 3 + 1];
      const sz = this.side[b * 3 + 2];
      const w0 = this.width[b] * (0.6 + 0.4 * alpha);
      const oo = b * (SEG + 1);
      const r = this.rgb[b * 3];
      const g = this.rgb[b * 3 + 1];
      const bl = this.rgb[b * 3 + 2];
      for (let i = 0; i <= SEG; i++) {
        const tt = i / SEG;
        const off = this.off[oo + i];
        const cx = ax + dx * tt + sx * off;
        const cy = ay + dy * tt + sy * off;
        const cz = az + dz * tt + sz * off;
        const w = w0 * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, tt * 1.2 + 0.1)));
        const p0 = (vo + i * 2) * 3;
        this.pos[p0] = cx - sx * w;
        this.pos[p0 + 1] = cy - sy * w;
        this.pos[p0 + 2] = cz - sz * w;
        this.pos[p0 + 3] = cx + sx * w;
        this.pos[p0 + 4] = cy + sy * w;
        this.pos[p0 + 5] = cz + sz * w;
        const c0 = (vo + i * 2) * 4;
        this.colA[c0] = r;
        this.colA[c0 + 1] = g;
        this.colA[c0 + 2] = bl;
        this.colA[c0 + 3] = alpha;
        this.colA[c0 + 4] = r;
        this.colA[c0 + 5] = g;
        this.colA[c0 + 6] = bl;
        this.colA[c0 + 7] = alpha;
      }
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.anyActive = any;
  }

  clear(): void {
    this.active.fill(0);
    for (let v = 0; v < this.cap * VPB; v++) this.colA[v * 4 + 3] = 0;
    this.colAttr.needsUpdate = true;
    this.anyActive = false;
    this.mesh.visible = false;
  }
}
