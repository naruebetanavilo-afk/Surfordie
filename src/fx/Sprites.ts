import * as THREE from "three";

/** procedural sprite shapes (drawn in the fragment shader, no textures) */
export const enum Shape {
  /** soft round glow with a hot core */
  Glow = 0,
  /** crisp 4-point star sparkle with a soft halo */
  Star = 1,
  /** thin glowing ring / halo */
  Ring = 2,
  /** horizontal anamorphic lens streak */
  Flare = 3,
  /** soft lumpy smoke puff (use on the normal-blended layer) */
  Puff = 4,
  /** 8-ray starburst */
  Burst = 5,
}

/** how size and alpha evolve over the sprite's life */
export const enum Curve {
  /** overshoot pop-in, then shrink + fade (sparkles, hit flashes) */
  Pop = 0,
  /** ease from size0 to size1, fade in quickly then out (smoke) */
  Grow = 1,
  /** linear size0 -> size1, linear fade out */
  Fade = 2,
}

const vert = /* glsl */ `
attribute vec3 aOffset;
attribute vec4 aData; // size, rotation, alpha, shape
attribute vec3 aColor;
varying vec2 vP;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vP = position.xy * 2.0;
  vColor = aColor;
  vAlpha = aData.z;
  vShape = aData.w;
  float c = cos(aData.y);
  float s = sin(aData.y);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aData.x;
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying vec2 vP;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  vec2 p = vP;
  float r = length(p);
  if (r > 1.0 && vShape < 2.5) discard;
  float a = 0.0;
  vec3 col = vColor;
  if (vShape < 0.5) {
    // glow
    float f = max(0.0, 1.0 - r);
    a = f * f;
    col = mix(vColor, vec3(1.0), f * f * f * 0.9);
  } else if (vShape < 1.5) {
    // 4-point star: concave diamond (sqrt|x| + sqrt|y| < 1) + halo
    vec2 q = abs(p);
    float f = sqrt(q.x) + sqrt(q.y);
    float body = 1.0 - smoothstep(0.78, 1.0, f);
    float halo = exp(-r * 4.5) * 0.55;
    a = max(body, halo);
    col = mix(vColor, vec3(1.0), (1.0 - smoothstep(0.25, 0.85, f)) * 0.95);
  } else if (vShape < 2.5) {
    // ring
    float d = abs(r - 0.78);
    a = (1.0 - smoothstep(0.0, 0.16, d)) + exp(-d * 9.0) * 0.35;
    a *= 1.0 - smoothstep(0.95, 1.0, r);
    col = mix(vColor, vec3(1.0), 1.0 - smoothstep(0.0, 0.05, d));
  } else if (vShape < 3.5) {
    // flare: thin horizontal streak with a bright centre
    float sx = max(0.0, 1.0 - abs(p.x));
    a = exp(-abs(p.y) * 14.0) * sx * sx + exp(-r * 6.0) * 0.6;
    col = mix(vColor, vec3(1.0), exp(-abs(p.y) * 30.0) * sx);
  } else if (vShape < 4.5) {
    // smoke puff: lumpy edge via angular noise
    float ang = atan(p.y, p.x);
    float e = 0.78 + 0.12 * sin(ang * 3.0 + vColor.r * 40.0) + 0.08 * sin(ang * 5.0 + 1.7);
    a = 1.0 - smoothstep(e - 0.35, e, r);
    // darker underside, lighter top for a toon volume read
    col = vColor * (0.75 + 0.45 * smoothstep(-0.6, 0.6, p.y));
  } else {
    // starburst rays
    float ang = atan(p.y, p.x);
    float rays = pow(abs(cos(ang * 4.0)), 6.0);
    a = (rays * (1.0 - r) * 1.2 + exp(-r * 5.0)) ;
    a *= 1.0 - smoothstep(0.9, 1.0, r);
    col = mix(vColor, vec3(1.0), exp(-r * 4.0));
  }
  a = clamp(a * vAlpha, 0.0, 1.0);
  if (a < 0.003) discard;
#ifdef ADDITIVE
  gl_FragColor = vec4(col * a, a);
#else
  gl_FragColor = vec4(col, a);
#endif
  #include <colorspace_fragment>
}`;

/**
 * Pooled camera-facing quads drawn with ONE instanced draw call. Used for
 * sparkles, big glows, flares and smoke puffs. Structure-of-arrays storage,
 * fixed capacity, overwrite-oldest when full.
 */
export class SpriteLayer {
  n = 0;
  readonly cap: number;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private alpha: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private shape: Uint8Array;
  private curve: Uint8Array;
  private col: Float32Array;
  private recycle = 0;

  private geo: THREE.InstancedBufferGeometry;
  private offA: THREE.InstancedBufferAttribute;
  private dataA: THREE.InstancedBufferAttribute;
  private colA: THREE.InstancedBufferAttribute;
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, cap: number, additive: boolean, renderOrder: number) {
    this.cap = cap;
    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.rot = new Float32Array(cap);
    this.spin = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.shape = new Uint8Array(cap);
    this.curve = new Uint8Array(cap);
    this.col = new Float32Array(cap * 3);

    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.offA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dataA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aOffset", this.offA);
    this.geo.setAttribute("aData", this.dataA);
    this.geo.setAttribute("aColor", this.colA);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      defines: additive ? { ADDITIVE: 1 } : {},
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      premultipliedAlpha: additive,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  /**
   * Spawn one sprite. Positional args on purpose: this is called hundreds of
   * times per second and must not allocate.
   */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    size0: number, size1: number, life: number,
    c: THREE.Color, alpha: number, shape: Shape, curve: Curve,
    rot = 0, spin = 0, grav = 0, drag = 0,
  ): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else {
      i = this.recycle;
      this.recycle = (this.recycle + 5) % this.cap;
    }
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = alpha;
    this.shape[i] = shape;
    this.curve[i] = curve;
    this.rot[i] = rot;
    this.spin[i] = spin;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
  }

  private remove(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l];
    this.py[i] = this.py[l];
    this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l];
    this.vy[i] = this.vy[l];
    this.vz[i] = this.vz[l];
    this.s0[i] = this.s0[l];
    this.s1[i] = this.s1[l];
    this.life[i] = this.life[l];
    this.maxLife[i] = this.maxLife[l];
    this.alpha[i] = this.alpha[l];
    this.shape[i] = this.shape[l];
    this.curve[i] = this.curve[l];
    this.rot[i] = this.rot[l];
    this.spin[i] = this.spin[l];
    this.grav[i] = this.grav[l];
    this.drag[i] = this.drag[l];
    this.col[i * 3] = this.col[l * 3];
    this.col[i * 3 + 1] = this.col[l * 3 + 1];
    this.col[i * 3 + 2] = this.col[l * 3 + 2];
  }

  update(dt: number): void {
    const off = this.offA.array as Float32Array;
    const data = this.dataA.array as Float32Array;
    const co = this.colA.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.remove(i);
        continue;
      }
      if (this.drag[i] > 0) {
        const d = Math.exp(-this.drag[i] * dt);
        this.vx[i] *= d;
        this.vy[i] *= d;
        this.vz[i] *= d;
      }
      this.vy[i] += this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;

      const k = 1 - this.life[i] / this.maxLife[i];
      let s: number;
      let a: number;
      const cv = this.curve[i];
      if (cv === Curve.Pop) {
        // 0..0.18 overshoot to 1.25, settle to 1, then shrink toward size1
        if (k < 0.18) {
          const u = k / 0.18;
          s = this.s0[i] * (0.3 + u * 0.95);
        } else if (k < 0.3) {
          s = this.s0[i] * (1.25 - ((k - 0.18) / 0.12) * 0.25);
        } else {
          const u = (k - 0.3) / 0.7;
          s = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
        }
        a = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
      } else if (cv === Curve.Grow) {
        const e = 1 - (1 - k) * (1 - k);
        s = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
        a = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
      } else {
        s = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
        a = 1 - k;
      }
      const o3 = i * 3;
      const o4 = i * 4;
      off[o3] = this.px[i];
      off[o3 + 1] = this.py[i];
      off[o3 + 2] = this.pz[i];
      data[o4] = s;
      data[o4 + 1] = this.rot[i];
      data[o4 + 2] = a * this.alpha[i];
      data[o4 + 3] = this.shape[i];
      co[o3] = this.col[o3];
      co[o3 + 1] = this.col[o3 + 1];
      co[o3 + 2] = this.col[o3 + 2];
      i++;
    }
    this.geo.instanceCount = this.n;
    const cnt = Math.max(1, this.n);
    this.offA.clearUpdateRanges();
    this.offA.addUpdateRange(0, cnt * 3);
    this.offA.needsUpdate = true;
    this.dataA.clearUpdateRanges();
    this.dataA.addUpdateRange(0, cnt * 4);
    this.dataA.needsUpdate = true;
    this.colA.clearUpdateRanges();
    this.colA.addUpdateRange(0, cnt * 3);
    this.colA.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }

  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
