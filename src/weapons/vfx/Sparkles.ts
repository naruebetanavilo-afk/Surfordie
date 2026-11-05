import * as THREE from "three";
import { vfxClock } from "./clock";

/** visual style of a sparkle */
export const SPARK_GLOW = 0;
export const SPARK_STAR = 1;
export const SPARK_EMBER = 2;
/** constant-size glow that fades quickly at the end (orb cores, streaks) */
export const SPARK_STEADY = 3;

const vert = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // x y z t0
attribute vec4 aB; // vx vy vz life
attribute vec4 aC; // r g b size
attribute vec4 aD; // gravity drag spin mode
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vMode;
void main() {
  float age = uTime - aA.w;
  float k = age / aB.w;
  vUv = uv;
  vCol = aC.rgb;
  vMode = aD.w;
  vAlpha = 0.0;
  if (k < 0.0 || k >= 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float drag = aD.y;
  float f = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 p = aA.xyz + aB.xyz * f;
  p.y += 0.5 * aD.x * age * age;
  p.y = max(p.y, 0.04);
  float s = aC.w;
  float a = 1.0;
  if (aD.w < 0.5) {
    s *= 0.55 + 0.45 * min(1.0, k * 5.0);
    a = (1.0 - k) * (1.0 - k);
  } else if (aD.w < 1.5) {
    s *= sin(3.14159 * pow(k, 0.5));
    a = 1.0 - k * k;
  } else if (aD.w < 2.5) {
    s *= 1.0 - k * 0.6;
    a = (1.0 - k) * (0.7 + 0.3 * sin(age * 45.0 + aA.w * 91.0));
  } else {
    a = 1.0 - smoothstep(0.75, 1.0, k);
  }
  float ang = aD.z * age + aA.w * 37.0;
  float c = cos(ang);
  float sn = sin(ang);
  vec2 off = vec2(position.x * c - position.y * sn, position.x * sn + position.y * c) * s;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vAlpha = a;
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vMode;
uniform float uOcc;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float i;
  float d = dot(p, p);
  if (vMode > 0.5 && vMode < 1.5) {
    float ax = abs(p.x);
    float ay = abs(p.y);
    float star = max(0.0, 1.0 - ay) * exp(-ax * 11.0) + max(0.0, 1.0 - ax) * exp(-ay * 11.0);
    i = star * 1.3 + exp(-d * 12.0) * 1.2;
  } else {
    float soft = max(0.0, 1.0 - d);
    i = soft * soft + exp(-d * 20.0) * 0.9;
  }
  i *= vAlpha;
  vec3 col = mix(vCol, vec3(1.0), clamp(i - 0.75, 0.0, 1.0) * 0.7);
  gl_FragColor = vec4(col * i, clamp(i * uOcc, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

/**
 * GPU-animated additive billboard particles (glows, 4-point star sparkles,
 * embers). Every particle is written once into a ring buffer and animated
 * entirely in the vertex shader (ballistic motion + drag), so spawning many
 * costs only a small attribute upload and simulation costs nothing on the CPU.
 * One draw call for all of them.
 */
export class Sparkles {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly aD: THREE.InstancedBufferAttribute;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private head = 0;
  private used = 0;
  /** clock time until which at least one particle may still be alive */
  private aliveUntil = -1;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  /** global spawn-count multiplier (lower on low quality) */
  density = 1;

  constructor(
    scene: THREE.Scene,
    readonly cap = 4096,
  ) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    const mk = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aA = mk();
    this.aB = mk();
    this.aC = mk();
    this.aD = mk();
    // park every slot in the past so nothing renders before it is used
    const b = this.aB.array as Float32Array;
    for (let i = 0; i < cap; i++) b[i * 4 + 3] = 1;
    const a = this.aA.array as Float32Array;
    for (let i = 0; i < cap; i++) a[i * 4 + 3] = -1e6;
    this.attrs = [this.aA, this.aB, this.aC, this.aD];
    geo.setAttribute("aA", this.aA);
    geo.setAttribute("aB", this.aB);
    geo.setAttribute("aC", this.aC);
    geo.setAttribute("aD", this.aD);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: { value: 0 }, uOcc: { value: 0.35 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
  }

  /**
   * Spawn one particle. `color` must be a linear THREE.Color (reused freely by
   * the caller). gravity < 0 pulls down; drag damps velocity per second.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: THREE.Color,
    mode = SPARK_GLOW,
    gravity = 0,
    drag = 0,
    spin = 0,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    if (this.used < this.cap) this.used++;
    const o = i * 4;
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    const D = this.aD.array as Float32Array;
    A[o] = x;
    A[o + 1] = y;
    A[o + 2] = z;
    A[o + 3] = vfxClock.t;
    B[o] = vx;
    B[o + 1] = vy;
    B[o + 2] = vz;
    B[o + 3] = Math.max(0.01, life);
    if (vfxClock.t + life > this.aliveUntil) this.aliveUntil = vfxClock.t + life;
    C[o] = color.r;
    C[o + 1] = color.g;
    C[o + 2] = color.b;
    C[o + 3] = size;
    D[o] = gravity;
    D[o + 1] = drag;
    D[o + 2] = spin;
    D[o + 3] = mode;
    if (this.dirtyFrom < 0) {
      this.dirtyFrom = i;
      this.dirtyTo = i;
    } else if (i === this.dirtyTo + 1) this.dirtyTo = i;
    else {
      // wrapped around: upload everything this frame
      this.dirtyFrom = 0;
      this.dirtyTo = this.cap - 1;
    }
  }

  /** radial burst of `count` particles */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    up: number,
    life: number,
    size: number,
    color: THREE.Color,
    mode = SPARK_GLOW,
    gravity = 0,
    drag = 2,
    jitter = 0,
  ): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.65);
      this.spawn(
        x + (Math.random() - 0.5) * jitter,
        y,
        z + (Math.random() - 0.5) * jitter,
        Math.cos(a) * sp,
        up * (0.4 + Math.random() * 0.8),
        Math.sin(a) * sp,
        life * (0.65 + Math.random() * 0.35),
        size * (0.7 + Math.random() * 0.6),
        color,
        mode,
        gravity,
        drag,
        (Math.random() - 0.5) * 6,
      );
    }
  }

  update(): void {
    this.mat.uniforms.uTime.value = vfxClock.t;
    this.geo.instanceCount = this.used;
    // no live particles: skip the draw call
    this.mesh.visible = vfxClock.t < this.aliveUntil;
    if (this.dirtyFrom < 0) return;
    const start = this.dirtyFrom * 4;
    const count = (this.dirtyTo - this.dirtyFrom + 1) * 4;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(start, count);
      a.needsUpdate = true;
    }
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
  }

  clear(): void {
    const a = this.aA.array as Float32Array;
    for (let i = 0; i < this.cap; i++) a[i * 4 + 3] = -1e6;
    this.aA.clearUpdateRanges();
    this.aA.needsUpdate = true;
    this.head = 0;
    this.used = 0;
    this.aliveUntil = -1;
    this.mesh.visible = false;
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
    this.geo.instanceCount = 0;
  }
}
