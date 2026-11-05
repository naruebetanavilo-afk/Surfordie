import * as THREE from "three";
import { G } from "../core/G";
import { glowTexture } from "./textures";
import { rgb } from "./colors";

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

/** fixed capacity of each point pool (glow sparks / solid debris) */
export const PARTICLE_CAP = 3000;

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
  // hot white core so sparks read as light, not paint
  vec3 c = mix(vColor, vec3(1.0), t.a * t.a * t.a * 0.5);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  // premultiplied: mostly additive, slight occlusion keeps colours saturated
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * 0.35);
}`;

/** toon-shaded debris blob: dark rim + highlight, so chunks read on any ground */
const fragSolid = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  vec3 c = vColor;
  float hl = 1.0 - smoothstep(0.0, 0.18, dot(p + vec2(0.35, 0.35), p + vec2(0.35, 0.35)));
  c = mix(c, vec3(1.0), hl * 0.45);
  c *= mix(1.0, 0.45, smoothstep(0.55, 0.75, r));
  gl_FragColor = vec4(c, vAlpha);
  #include <colorspace_fragment>
}`;

class PointPool {
  n = 0;
  readonly px = new Float32Array(PARTICLE_CAP);
  readonly py = new Float32Array(PARTICLE_CAP);
  readonly pz = new Float32Array(PARTICLE_CAP);
  readonly vx = new Float32Array(PARTICLE_CAP);
  readonly vy = new Float32Array(PARTICLE_CAP);
  readonly vz = new Float32Array(PARTICLE_CAP);
  readonly life = new Float32Array(PARTICLE_CAP);
  readonly maxLife = new Float32Array(PARTICLE_CAP);
  readonly size = new Float32Array(PARTICLE_CAP);
  readonly grav = new Float32Array(PARTICLE_CAP);
  readonly drag = new Float32Array(PARTICLE_CAP);
  readonly col = new Float32Array(PARTICLE_CAP * 3);
  readonly geo = new THREE.BufferGeometry();
  readonly points: THREE.Points;
  private posA: THREE.BufferAttribute;
  private sizeA: THREE.BufferAttribute;
  private alphaA: THREE.BufferAttribute;
  private colA: THREE.BufferAttribute;
  private attrs: THREE.BufferAttribute[];
  readonly mat: THREE.ShaderMaterial;
  /** solid debris fades only at the very end (it "pops" away) */
  private readonly solid: boolean;
  private recycle = 0;

  constructor(scene: THREE.Scene, additive: boolean) {
    this.solid = !additive;
    this.posA = new THREE.BufferAttribute(new Float32Array(PARTICLE_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeA = new THREE.BufferAttribute(new Float32Array(PARTICLE_CAP), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaA = new THREE.BufferAttribute(new Float32Array(PARTICLE_CAP), 1).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(new Float32Array(PARTICLE_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [this.posA, this.sizeA, this.alphaA, this.colA];
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
      blending: THREE.NormalBlending,
      premultipliedAlpha: additive,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 8 : 4;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grav: number, drag: number, c: THREE.Color): void {
    let i: number;
    if (this.n < PARTICLE_CAP) i = this.n++;
    else {
      // full: overwrite in a rolling fashion (spreads the loss over old particles)
      i = this.recycle;
      this.recycle = (this.recycle + 7) % PARTICLE_CAP;
    }
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

  update(dt: number, uScale: number): void {
    let i = 0;
    const px = this.px;
    const py = this.py;
    const pz = this.pz;
    const vx = this.vx;
    const vy = this.vy;
    const vz = this.vz;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          px[i] = px[l];
          py[i] = py[l];
          pz[i] = pz[l];
          vx[i] = vx[l];
          vy[i] = vy[l];
          vz[i] = vz[l];
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
      const d = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      vx[i] *= d;
      vz[i] *= d;
      vy[i] += this.grav[i] * dt;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
      if (py[i] < 0.03) {
        // bounce + skid on the ground
        py[i] = 0.03;
        vy[i] *= -0.3;
        vx[i] *= 0.55;
        vz[i] *= 0.55;
      }
      i++;
    }
    const pos = this.posA.array as Float32Array;
    const sz = this.sizeA.array as Float32Array;
    const al = this.alphaA.array as Float32Array;
    const co = this.colA.array as Float32Array;
    const solid = this.solid;
    for (let k = 0; k < this.n; k++) {
      const k3 = k * 3;
      pos[k3] = px[k];
      pos[k3 + 1] = py[k];
      pos[k3 + 2] = pz[k];
      const t = this.life[k] / this.maxLife[k];
      if (solid) {
        // chunks keep their size, then shrink away quickly at the end
        sz[k] = this.size[k] * (t > 0.3 ? 1 : 0.2 + (t / 0.3) * 0.8);
        al[k] = 1;
      } else {
        sz[k] = this.size[k] * (0.4 + 0.6 * t);
        al[k] = t * 2.2 < 1 ? t * 2.2 : 1;
      }
      co[k3] = this.col[k3];
      co[k3 + 1] = this.col[k3 + 1];
      co[k3 + 2] = this.col[k3 + 2];
    }
    this.geo.setDrawRange(0, this.n);
    for (let a = 0; a < this.attrs.length; a++) {
      const at = this.attrs[a];
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(1, this.n) * at.itemSize);
      at.needsUpdate = true;
    }
    this.mat.uniforms.uScale.value = uScale;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/**
 * Two pooled Points clouds (one draw call each): additive glow sparks and
 * toon-shaded solid debris. Particles live in structure-of-arrays storage with
 * a fixed cap; when full, old particles are overwritten.
 */
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

  /** 0..1 fill ratio of the busiest pool (use to scale down optional effects) */
  get load(): number {
    return Math.max(this.add.n, this.solid.n) / PARTICLE_CAP;
  }

  burst(x: number, y: number, z: number, o: BurstOpts): void {
    const pool = o.additive === false ? this.solid : this.add;
    const c = rgb(o.color);
    const n = Math.max(1, Math.round(o.count * (G.world.quality === "low" ? 0.5 : 1)));
    const hasDir = o.dirX !== undefined && o.dirZ !== undefined;
    const baseA = hasDir ? Math.atan2(o.dirZ as number, o.dirX as number) : 0;
    const spread = o.spread ?? 0.6;
    const up = o.up ?? 0;
    const j = o.jitter ?? 0;
    const grav = o.gravity ?? 0;
    const drag = o.drag ?? 2;
    for (let i = 0; i < n; i++) {
      const a = hasDir ? baseA + (Math.random() - 0.5) * 2 * spread : Math.random() * Math.PI * 2;
      const sp = o.speed * (0.35 + Math.random() * 0.65);
      pool.emit(
        x + (Math.random() - 0.5) * j,
        y,
        z + (Math.random() - 0.5) * j,
        Math.cos(a) * sp,
        up * (0.5 + Math.random()),
        Math.sin(a) * sp,
        o.life * (0.6 + Math.random() * 0.4),
        o.size * (0.7 + Math.random() * 0.6),
        grav,
        drag,
        c,
      );
    }
  }

  /** emit a single particle with explicit velocity */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, additive = true, gravity = 0): void {
    (additive ? this.add : this.solid).emit(x, y, z, vx, vy, vz, life, size, gravity, 1, rgb(color));
  }

  /** allocation-free emit with a pre-parsed colour (internal fast path) */
  emitC(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: THREE.Color, additive: boolean, gravity: number, drag: number): void {
    (additive ? this.add : this.solid).emit(x, y, z, vx, vy, vz, life, size, gravity, drag, c);
  }

  /** scratch colour for callers that need to tint before emitC */
  get scratch(): THREE.Color {
    return this.c;
  }

  update(dt: number): void {
    // world-size points: pixels = size * (viewportHeightPx / (2 tan(fov/2))) / depth
    const w = G.world;
    const fov = (w.camera.fov * Math.PI) / 180;
    const uScale = (w.height * w.dpr) / (2 * Math.tan(fov / 2));
    this.add.update(dt, uScale);
    this.solid.update(dt, uScale);
  }

  clear(): void {
    this.add.n = 0;
    this.solid.n = 0;
  }

  dispose(): void {
    this.add.dispose();
    this.solid.dispose();
  }
}
