import * as THREE from "three";

const vert = /* glsl */ `
attribute vec4 aA; // x, z, radius, height
attribute vec4 aB; // alpha, time, seed, core (0 = coloured, 1 = white core)
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vB;
varying float vFacing;
void main() {
  vUv = uv;
  vColor = aColor;
  vB = aB;
  vec3 p = vec3(position.x * aA.z, position.y * aA.w, position.z * aA.z);
  vec4 wp = vec4(p.x + aA.x, p.y, p.z + aA.y, 1.0);
  vec4 mv = viewMatrix * wp;
  // how directly this side of the cylinder faces the camera (centre = 1, silhouette = 0)
  vec3 n = normalize(mat3(viewMatrix) * vec3(position.x, 0.0, position.z));
  vFacing = abs(n.z);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying vec4 vB;
varying float vFacing;
void main() {
  float h = vUv.y;
  float fade = pow(1.0 - h, 1.6) * smoothstep(0.0, 0.04, h);
  float streak = 0.65 + 0.35 * sin(vUv.x * 6.2831 * 4.0 + h * 9.0 - vB.y * 14.0 + vB.z * 20.0);
  float body = pow(vFacing, 1.5);
  float a = clamp(fade * streak * body * vB.x, 0.0, 1.0);
  vec3 c = mix(vColor, vec3(1.0), clamp(vB.w * 0.8 + pow(1.0 - h, 6.0) * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * 0.4);
}`;

class Beam {
  active = false;
  t = 0;
  life = 0.8;
  x = 0;
  z = 0;
  radius = 0.6;
  height = 9;
  r = 1;
  g = 1;
  b = 1;
  core = 0;
  seed = 0;
}

/**
 * Vertical light pillars (instanced open cylinders, ONE draw call). Bright at
 * the base, fading upward with scrolling streaks.
 */
export class Beams {
  private beams: Beam[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, readonly cap = 32) {
    for (let i = 0; i < cap; i++) this.beams.push(new Beam());
    const base = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    base.translate(0, 0.5, 0);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.geo.setAttribute("uv", base.getAttribute("uv"));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aA", this.aA);
    this.geo.setAttribute("aB", this.aB);
    this.geo.setAttribute("aColor", this.aCol);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }

  spawn(x: number, z: number, c: THREE.Color, radius: number, height: number, life: number, core: boolean): void {
    let b: Beam | null = null;
    let oldest = this.beams[0];
    for (const q of this.beams) {
      if (!q.active) {
        b = q;
        break;
      }
      if (q.t / q.life > oldest.t / oldest.life) oldest = q;
    }
    if (!b) b = oldest;
    b.active = true;
    b.t = 0;
    b.life = life;
    b.x = x;
    b.z = z;
    b.radius = radius;
    b.height = height;
    b.r = c.r;
    b.g = c.g;
    b.b = c.b;
    b.core = core ? 1 : 0;
    b.seed = Math.random();
  }

  update(dt: number): void {
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    let n = 0;
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        b.active = false;
        continue;
      }
      // quick swell, then thin out while fading
      const grow = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) * 0.55;
      const alpha = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
      const o4 = n * 4;
      A[o4] = b.x;
      A[o4 + 1] = b.z;
      A[o4 + 2] = b.radius * Math.max(0.05, grow);
      A[o4 + 3] = b.height * (0.7 + 0.3 * Math.min(1, k * 4));
      B[o4] = alpha * (b.core ? 0.9 : 0.75);
      B[o4 + 1] = b.t;
      B[o4 + 2] = b.seed;
      B[o4 + 3] = b.core;
      C[n * 3] = b.r;
      C[n * 3 + 1] = b.g;
      C[n * 3 + 2] = b.b;
      n++;
    }
    this.geo.instanceCount = n;
    if (n === 0) return;
    this.aA.clearUpdateRanges();
    this.aA.addUpdateRange(0, n * 4);
    this.aA.needsUpdate = true;
    this.aB.clearUpdateRanges();
    this.aB.addUpdateRange(0, n * 4);
    this.aB.needsUpdate = true;
    this.aCol.clearUpdateRanges();
    this.aCol.addUpdateRange(0, n * 3);
    this.aCol.needsUpdate = true;
  }

  clear(): void {
    for (const b of this.beams) b.active = false;
    this.geo.instanceCount = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
