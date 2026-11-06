import * as THREE from "three";
import { vfxClock } from "./clock";

/** spiral energy vortex (spins, expands, fades) */
export const DECAL_VORTEX = 0;
/** soft glowing disc */
export const DECAL_GLOW = 1;
/** thin, sharp shockwave ring */
export const DECAL_SHOCK = 2;
/** radial crack / star-burst streaks */
export const DECAL_CRACK = 3;
/** irregular dark blot — use with the dark (normal-blended) layer */
export const DECAL_SCORCH = 4;
/** landing telegraph: dashed ring with a fill that grows until impact */
export const DECAL_TARGET = 5;

const vert = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // x z t0 life
attribute vec4 aB; // radius rot0 spin mode
attribute vec4 aC; // r g b intensity
attribute vec4 aD; // y from seed growT
varying vec2 vUv;
varying vec3 vCol;
varying float vK;
varying float vMode;
varying float vSeed;
varying float vAge;
varying float vI;
void main() {
  float age = uTime - aA.z;
  float k = age / aA.w;
  vUv = uv;
  vCol = aC.rgb;
  vK = k;
  vMode = aB.w;
  vSeed = aD.z;
  vAge = age;
  vI = aC.w;
  if (k < 0.0 || k >= 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float g = min(1.0, k / max(0.001, aD.w));
  g = 1.0 - pow(1.0 - g, 3.0);
  float r = aB.x * (aD.y + (1.0 - aD.y) * g);
  float ang = aB.y + aB.z * age;
  float c = cos(ang);
  float s = sin(ang);
  vec2 lp = position.xy * r;
  vec2 rp = vec2(lp.x * c - lp.y * s, lp.x * s + lp.y * c);
  vec3 wp = vec3(aA.x + rp.x, aD.x, aA.y + rp.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const frag = /* glsl */ `
uniform float uDark;
uniform float uOcc;
varying vec2 vUv;
varying vec3 vCol;
varying float vK;
varying float vMode;
varying float vSeed;
varying float vAge;
varying float vI;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float fade = 1.0 - smoothstep(0.45, 1.0, vK);
  float i = 0.0;
  float hot = 0.0;
  if (vMode < 0.5) {
    float sw = a * 3.0 + r * 8.0 - vAge * 5.0 + vSeed;
    float arms = pow(0.5 + 0.5 * sin(sw), 3.0);
    float sw2 = a * 5.0 - r * 11.0 + vAge * 3.0 + vSeed * 2.0;
    float arms2 = pow(0.5 + 0.5 * sin(sw2), 6.0);
    float edge = 1.0 - smoothstep(0.78, 1.0, r);
    float hole = smoothstep(0.0, 0.22, r);
    float rim = smoothstep(0.6, 0.9, r) * edge;
    float core = exp(-r * r * 14.0);
    i = (arms * 1.05 + arms2 * 0.45) * edge * hole + rim * 0.55 + core * 1.3;
    hot = core * 0.8 + arms * arms2 * 0.5;
    i *= fade;
  } else if (vMode < 1.5) {
    i = pow(1.0 - r, 1.6) * (1.0 - vK) * (1.0 - vK) * 1.4;
    hot = pow(1.0 - r, 4.0) * 0.8;
  } else if (vMode < 2.5) {
    float d = (r - 0.9) / 0.07;
    float band = exp(-d * d);
    i = (band * 1.5 + smoothstep(0.45, 0.95, r) * 0.22) * (1.0 - vK);
    hot = band * 0.5;
  } else if (vMode < 3.5) {
    float rays = pow(abs(cos(a * 3.5 + vSeed * 3.0 + sin(r * 6.0 + vSeed) * 0.35)), 24.0);
    float rays2 = pow(abs(cos(a * 5.5 + vSeed * 5.0)), 40.0) * 0.6;
    float fall = 1.0 - smoothstep(0.15, 1.0, r);
    i = ((rays + rays2) * fall * 1.4 + exp(-r * r * 9.0) * 0.9) * fade;
    hot = exp(-r * r * 20.0) * 0.6;
  } else if (vMode < 4.5) {
    float wob = 0.78 + 0.12 * sin(a * 5.0 + vSeed * 7.0) + 0.06 * sin(a * 11.0 + vSeed * 3.0);
    i = (1.0 - smoothstep(wob - 0.3, wob, r)) * (1.0 - vK);
  } else {
    float dash = step(0.45, fract(a / 6.2831853 * 14.0 + vAge * 0.6));
    float ring = smoothstep(0.82, 0.88, r) * (1.0 - smoothstep(0.94, 1.0, r));
    float fill = (1.0 - smoothstep(vK - 0.05, vK, r));
    float front = exp(-pow((r - vK) / 0.04, 2.0));
    i = (ring * (0.35 + 0.65 * dash) + fill * 0.22 + front * 0.8) * min(1.0, vK * 6.0);
    hot = front * 0.4;
  }
  i *= vI;
  vec3 col = mix(vCol, vec3(1.0), clamp(hot, 0.0, 1.0));
  if (uDark > 0.5) {
    gl_FragColor = vec4(vCol, clamp(i, 0.0, 1.0));
  } else {
    gl_FragColor = vec4(col * i, clamp(i * uOcc, 0.0, 1.0));
  }
  #include <colorspace_fragment>
}`;

/**
 * Instanced, GPU-animated ground decals (vortexes, shock rings, cracks,
 * scorch marks, telegraphs). Ring-buffered like Sparkles: one draw call per
 * layer, no per-frame CPU work besides uploading freshly spawned slots.
 */
export class Decals {
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
  /** slot range written since the last upload (lo > hi = clean) */
  private dirtyLo = 1 << 30;
  private dirtyHi = -1;
  private aliveUntil = -1;
  private layerY: number;

  constructor(
    scene: THREE.Scene,
    readonly dark: boolean,
    readonly cap = 256,
  ) {
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    const mk = () => {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.aA = mk();
    this.aB = mk();
    this.aC = mk();
    this.aD = mk();
    this.attrs = [this.aA, this.aB, this.aC, this.aD];
    const A = this.aA.array as Float32Array;
    for (let i = 0; i < cap; i++) {
      A[i * 4 + 2] = -1e6;
      A[i * 4 + 3] = 1;
    }
    geo.setAttribute("aA", this.aA);
    geo.setAttribute("aB", this.aB);
    geo.setAttribute("aC", this.aC);
    geo.setAttribute("aD", this.aD);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: { value: 0 }, uDark: { value: dark ? 1 : 0 }, uOcc: { value: 0.8 } },
      transparent: true,
      depthWrite: false,
      // premultiplied "over": colour adds like light, alpha (uOcc) partly hides
      // the bright ground so saturated hues stay saturated instead of going white
      blending: THREE.NormalBlending,
      premultipliedAlpha: !dark,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = dark ? -4 : 6;
    this.layerY = dark ? 0.035 : 0.075;
    scene.add(this.mesh);
  }

  /**
   * Spawn a decal. `color` is a linear THREE.Color. `from` is the starting
   * radius fraction, `growT` the fraction of life spent expanding.
   */
  spawn(
    x: number,
    z: number,
    radius: number,
    life: number,
    color: THREE.Color,
    mode: number,
    intensity = 1,
    spin = 0,
    from = 0.3,
    growT = 0.25,
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
    A[o + 1] = z;
    A[o + 2] = vfxClock.t;
    A[o + 3] = Math.max(0.01, life);
    if (vfxClock.t + life > this.aliveUntil) this.aliveUntil = vfxClock.t + life;
    B[o] = radius;
    B[o + 1] = Math.random() * Math.PI * 2;
    B[o + 2] = spin;
    B[o + 3] = mode;
    C[o] = color.r;
    C[o + 1] = color.g;
    C[o + 2] = color.b;
    C[o + 3] = intensity;
    // tiny per-slot height offset keeps overlapping decals from z-fighting
    D[o] = this.layerY + (i % 16) * 0.0015;
    D[o + 1] = from;
    D[o + 2] = Math.random() * 10;
    D[o + 3] = growT;
    this.markDirty(i);
  }

  update(): void {
    this.mat.uniforms.uTime.value = vfxClock.t;
    this.geo.instanceCount = this.used;
    this.mesh.visible = vfxClock.t < this.aliveUntil;
    if (this.dirtyHi < 0) return;
    // upload only the slots written since the last flush
    const start = this.dirtyLo * 4;
    const count = (this.dirtyHi - this.dirtyLo + 1) * 4;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(start, count);
      a.needsUpdate = true;
    }
    this.dirtyLo = 1 << 30;
    this.dirtyHi = -1;
  }

  private markDirty(i: number): void {
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  clear(): void {
    const A = this.aA.array as Float32Array;
    for (let i = 0; i < this.cap; i++) A[i * 4 + 2] = -1e6;
    this.head = 0;
    this.used = 0;
    this.aliveUntil = -1;
    this.dirtyLo = 0;
    this.dirtyHi = this.cap - 1;
    this.update();
  }
}
