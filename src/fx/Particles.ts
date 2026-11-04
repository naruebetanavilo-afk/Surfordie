import * as THREE from "three";
import { G } from "../core/G";
import { glowTexture } from "./textures";

export interface BurstOpts {
  count: number;
  color: string;
  /** initial speed (world units/s) */
  speed: number;
  /** lifetime seconds */
  life: number;
  /** point size in world units */
  size: number;
  /** vertical acceleration (negative = falls) */
  gravity?: number;
  /** extra initial upward velocity */
  up?: number;
  /** additive glow (default) vs. normal blending for solid debris */
  additive?: boolean;
  /** velocity damping per second (default 2) */
  drag?: number;
  /** restrict emission to a cone around (dirX, dirZ) with half-angle `spread` */
  dirX?: number;
  dirZ?: number;
  spread?: number;
  /** spawn radius around the origin */
  jitter?: number;
}

const CAP = 3000;

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const fragAdd = /* glsl */ `
uniform sampler2D uTex;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  float a = t.a * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}`;

const fragSolid = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  vec3 c = vColor * (1.0 - r * 0.35);
  gl_FragColor = vec4(c, vAlpha);
  #include <colorspace_fragment>
}`;

class PointPool {
  n = 0;
  readonly px = new Float32Array(CAP);
  readonly py = new Float32Array(CAP);
  readonly pz = new Float32Array(CAP);
  readonly vx = new Float32Array(CAP);
  readonly vy = new Float32Array(CAP);
  readonly vz = new Float32Array(CAP);
  readonly life = new Float32Array(CAP);
  readonly maxLife = new Float32Array(CAP);
  readonly size = new Float32Array(CAP);
  readonly grav = new Float32Array(CAP);
  readonly drag = new Float32Array(CAP);
  readonly col = new Float32Array(CAP * 3);
  readonly geo = new THREE.BufferGeometry();
  readonly points: THREE.Points;
  private posA: THREE.BufferAttribute;
  private sizeA: THREE.BufferAttribute;
  private alphaA: THREE.BufferAttribute;
  private colA: THREE.BufferAttribute;
  readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, additive: boolean) {
    this.posA = new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeA = new THREE.BufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaA = new THREE.BufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posA);
    this.geo.setAttribute("aSize", this.sizeA);
    this.geo.setAttribute("aAlpha", this.alphaA);
    this.geo.setAttribute("aColor", this.colA);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: additive ? fragAdd : fragSolid,
      uniforms: { uScale: { value: 600 }, uTex: { value: glowTexture() } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      premultipliedAlpha: additive,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 8 : 4;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grav: number, drag: number, c: THREE.Color): void {
    let i: number;
    if (this.n < CAP) i = this.n++;
    else i = Math.floor(Math.random() * CAP); // overwrite random when full
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          this.px[i] = this.px[l];
          this.py[i] = this.py[l];
          this.pz[i] = this.pz[l];
          this.vx[i] = this.vx[l];
          this.vy[i] = this.vy[l];
          this.vz[i] = this.vz[l];
          this.life[i] = this.life[l];
          this.maxLife[i] = this.maxLife[l];
          this.size[i] = this.size[l];
          this.grav[i] = this.grav[l];
          this.drag[i] = this.drag[l];
          this.col[i * 3] = this.col[l * 3];
          this.col[i * 3 + 1] = this.col[l * 3 + 1];
          this.col[i * 3 + 2] = this.col[l * 3 + 2];
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] += this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.03) {
        this.py[i] = 0.03;
        this.vy[i] *= -0.3;
        this.vx[i] *= 0.6;
        this.vz[i] *= 0.6;
      }
      i++;
    }
    const pos = this.posA.array as Float32Array;
    const sz = this.sizeA.array as Float32Array;
    const al = this.alphaA.array as Float32Array;
    const co = this.colA.array as Float32Array;
    for (let k = 0; k < this.n; k++) {
      pos[k * 3] = this.px[k];
      pos[k * 3 + 1] = this.py[k];
      pos[k * 3 + 2] = this.pz[k];
      const t = this.life[k] / this.maxLife[k];
      sz[k] = this.size[k] * (0.4 + 0.6 * t);
      al[k] = Math.min(1, t * 2.2);
      co[k * 3] = this.col[k * 3];
      co[k * 3 + 1] = this.col[k * 3 + 1];
      co[k * 3 + 2] = this.col[k * 3 + 2];
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of [this.posA, this.sizeA, this.alphaA, this.colA]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
    // world-size points: pixels = size * (viewportHeightPx / (2 tan(fov/2))) / depth
    const w = G.world;
    const fov = (w.camera.fov * Math.PI) / 180;
    this.mat.uniforms.uScale.value = (w.height * w.dpr) / (2 * Math.tan(fov / 2));
  }
}

export class Particles {
  private add: PointPool;
  private solid: PointPool;
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.add = new PointPool(scene, true);
    this.solid = new PointPool(scene, false);
  }

  get count(): number {
    return this.add.n + this.solid.n;
  }

  burst(x: number, y: number, z: number, o: BurstOpts): void {
    const pool = o.additive === false ? this.solid : this.add;
    this.c.set(o.color);
    const n = Math.max(1, Math.round(o.count * (G.world.quality === "low" ? 0.5 : 1)));
    for (let i = 0; i < n; i++) {
      let a: number;
      if (o.dirX !== undefined && o.dirZ !== undefined) {
        a = Math.atan2(o.dirZ, o.dirX) + (Math.random() - 0.5) * 2 * (o.spread ?? 0.6);
      } else a = Math.random() * Math.PI * 2;
      const sp = o.speed * (0.35 + Math.random() * 0.65);
      const j = o.jitter ?? 0;
      pool.emit(
        x + (Math.random() - 0.5) * j,
        y,
        z + (Math.random() - 0.5) * j,
        Math.cos(a) * sp,
        (o.up ?? 0) * (0.5 + Math.random()),
        Math.sin(a) * sp,
        o.life * (0.6 + Math.random() * 0.4),
        o.size * (0.7 + Math.random() * 0.6),
        o.gravity ?? 0,
        o.drag ?? 2,
        this.c,
      );
    }
  }

  /** emit a single particle with explicit velocity */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, additive = true, gravity = 0): void {
    this.c.set(color);
    (additive ? this.add : this.solid).emit(x, y, z, vx, vy, vz, life, size, gravity, 1, this.c);
  }

  update(dt: number): void {
    this.add.update(dt);
    this.solid.update(dt);
  }

  clear(): void {
    this.add.n = 0;
    this.solid.n = 0;
  }
}
