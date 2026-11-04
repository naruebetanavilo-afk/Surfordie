import * as THREE from "three";
import { vfxClock } from "./clock";

const vert = /* glsl */ `
uniform float uTime;
attribute vec4 aA; // x z t0 life
attribute vec4 aB; // radius heightScale seed swirlSpeed
attribute vec4 aC; // r g b intensity
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying vec3 vCol;
varying float vK;
varying float vAge;
varying float vSeed;
varying float vSwirl;
varying float vI;
void main() {
  float age = uTime - aA.z;
  float k = age / aA.w;
  vK = k;
  vAge = age;
  vCol = aC.rgb;
  vI = aC.w;
  vSeed = aB.z;
  vSwirl = aB.w;
  vP = position;
  vN = normalize(vec3(normal.x, normal.y / max(0.2, aB.y), normal.z));
  if (k < 0.0 || k >= 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vV = vec3(0.0, 1.0, 0.0); return; }
  float g = min(1.0, k * 4.0);
  g = 1.0 - pow(1.0 - g, 3.0);
  float r = aB.x * (0.3 + 0.7 * g);
  // squash slightly while expanding, settle round
  float h = aB.y * r * (0.75 + 0.25 * g);
  vec3 wp = vec3(aA.x + position.x * r, position.y * h, aA.y + position.z * r);
  vV = normalize(cameraPosition - wp);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const frag = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying vec3 vCol;
varying float vK;
varying float vAge;
varying float vSeed;
varying float vSwirl;
varying float vI;
uniform float uOcc;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float lon = atan(vP.z, vP.x);
  float bands = 0.5 + 0.5 * sin(lon * 4.0 + vP.y * 7.0 - vAge * vSwirl + vSeed);
  bands = pow(bands, 3.0);
  float bands2 = 0.5 + 0.5 * sin(lon * 7.0 - vP.y * 9.0 + vAge * vSwirl * 0.7 + vSeed * 2.0);
  bands2 = pow(bands2, 5.0);
  float fade = 1.0 - smoothstep(0.3, 1.0, vK);
  float flash = 1.0 - smoothstep(0.0, 0.16, vK);
  float rim = smoothstep(0.3, 0.85, f);
  // thin dark silhouette line for the cartoon look
  float edge = smoothstep(0.86, 0.96, f);
  float body = 0.14 + (bands * 0.6 + bands2 * 0.4) * (1.0 - vP.y * 0.5);
  float g = (body + rim * 1.25) * (1.0 - edge);
  vec3 c = vCol * g + vec3(1.0) * (bands * bands2 * 0.55 + rim * rim * 0.22) * (1.0 - edge);
  float a = clamp(g * uOcc, 0.0, 1.0);
  c += vCol * 0.1 * edge;
  a = max(a, edge * 0.8);
  c = mix(c, vec3(1.0, 0.92, 1.0) * 1.2, flash * 0.55);
  a = max(a, flash * 0.5);
  float m = fade * vI;
  // alpha fades faster than colour: a dying dome turns into pure glow, not a grey film
  gl_FragColor = vec4(c * m, a * m * m);
  #include <colorspace_fragment>
}`;

/**
 * Instanced translucent energy domes for big blasts: fresnel rim, swirling
 * bands, quick pop-out then fade. GPU-animated, one draw call.
 */
export class Domes {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private head = 0;
  private used = 0;
  private dirty = false;

  constructor(
    scene: THREE.Scene,
    readonly cap = 64,
  ) {
    const base = new THREE.SphereGeometry(1, 22, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("normal", base.getAttribute("normal"));
    const mk = () => {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.aA = mk();
    this.aB = mk();
    this.aC = mk();
    this.attrs = [this.aA, this.aB, this.aC];
    const A = this.aA.array as Float32Array;
    for (let i = 0; i < cap; i++) {
      A[i * 4 + 2] = -1e6;
      A[i * 4 + 3] = 1;
    }
    geo.setAttribute("aA", this.aA);
    geo.setAttribute("aB", this.aB);
    geo.setAttribute("aC", this.aC);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: { value: 0 }, uOcc: { value: 0.8 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }

  /** spawn a dome of `radius`; `height` is the vertical scale relative to the radius */
  spawn(x: number, z: number, radius: number, life: number, color: THREE.Color, intensity = 1, height = 0.75, swirl = 9): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    if (this.used < this.cap) this.used++;
    const o = i * 4;
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    A[o] = x;
    A[o + 1] = z;
    A[o + 2] = vfxClock.t;
    A[o + 3] = Math.max(0.01, life);
    B[o] = radius;
    B[o + 1] = height;
    B[o + 2] = Math.random() * 10;
    B[o + 3] = swirl;
    C[o] = color.r;
    C[o + 1] = color.g;
    C[o + 2] = color.b;
    C[o + 3] = intensity;
    this.dirty = true;
  }

  update(): void {
    this.mat.uniforms.uTime.value = vfxClock.t;
    this.geo.instanceCount = this.used;
    if (!this.dirty) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
    this.dirty = false;
  }

  clear(): void {
    const A = this.aA.array as Float32Array;
    for (let i = 0; i < this.cap; i++) A[i * 4 + 2] = -1e6;
    this.head = 0;
    this.used = 0;
    this.dirty = true;
    this.update();
  }
}
