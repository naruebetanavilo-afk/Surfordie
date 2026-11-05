import * as THREE from "three";

/** ground effect modes (one shader, branch per instance) */
export const enum GMode {
  /** expanding shockwave ring with a bright rim (p0 = inner fill strength) */
  Ring = 0,
  /** soft glowing disc */
  Flash = 1,
  /** sweeping crescent slash (p0 = half arc, p1 = sweep head 0..1.2) */
  Arc = 2,
  /** spinning spiral swirl (p0 = spin angle, p1 = arms) */
  Vortex = 3,
  /** warning circle that fills up (p0 = progress 0..1, p1 = pulse) */
  Telegraph = 4,
  /** goo splat decal with droplets */
  Splat = 5,
  /** scorch mark decal */
  Scorch = 6,
  /** rotating rune circle (p0 = angle) */
  Rune = 7,
}

const vert = /* glsl */ `
attribute vec4 aA; // x, y, z, rotY
attribute vec4 aB; // radius, mode, alpha, inner
attribute vec4 aC; // p0, p1, p2, seed
attribute vec3 aColor;
varying vec2 vP;
varying vec3 vColor;
varying vec4 vB;
varying vec4 vC;
void main() {
  vP = vec2(position.x, -position.z);
  vColor = aColor;
  vB = aB;
  vC = aC;
  float c = cos(aA.w);
  float s = sin(aA.w);
  vec3 lp = position * aB.x;
  vec3 wp = vec3(c * lp.x + s * lp.z + aA.x, aA.y, -s * lp.x + c * lp.z + aA.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const frag = /* glsl */ `
varying vec2 vP;
varying vec3 vColor;
varying vec4 vB;
varying vec4 vC;
const float PI = 3.14159265;
void main() {
  vec2 p = vP;
  float r = length(p);
  if (r > 1.0) discard;
  float mode = vB.y;
  float inner = vB.w;
  float a = 0.0;
  // occ: how much the effect hides what is behind it (0 = purely additive glow,
  // 1 = opaque paint). Saturated colours need some occlusion to survive on a
  // bright ground.
  float occ = 0.5;
  vec3 col = vColor;
  if (mode < 0.5) {
    // shockwave ring: soft inner edge, bright crisp outer rim, faint fill
    float band = smoothstep(inner - 0.12, inner + 0.03, r) * (1.0 - smoothstep(0.93, 1.0, r));
    float rim = smoothstep(inner, 0.95, r);
    float fill = (1.0 - smoothstep(0.0, inner, r)) * vC.x * 0.4;
    a = band * (0.3 + 0.8 * rim * rim) + fill;
    float hot = smoothstep(0.84, 0.95, r) * band;
    col = mix(vColor, vec3(1.0), hot * 0.6);
    occ = 0.6 - hot * 0.3;
  } else if (mode < 1.5) {
    // flash disc
    float f = 1.0 - r;
    a = pow(f, 1.3);
    col = mix(vColor, vec3(1.0), pow(f, 4.0) * 0.55);
    occ = 0.45;
  } else if (mode < 2.5) {
    // crescent slash: bright leading edge + fading smear behind it
    float arcHalf = vC.x;
    float sweep = vC.y;
    float ang = atan(p.x, p.y);
    float t = (ang + arcHalf) / (2.0 * arcHalf);
    if (t < 0.0 || t > 1.0) discard;
    float behind = sweep - t;
    if (behind < -0.03) discard;
    float trail = clamp(1.0 - behind / 0.9, 0.0, 1.0);
    // crescent thickness tapers towards the tail
    float th = (1.0 - inner) * (0.2 + 0.8 * trail);
    float mid = 1.0 - th * 0.5;
    float d = abs(r - mid) / (th * 0.5 + 0.001);
    float band = 1.0 - smoothstep(0.5, 1.0, d);
    float head = exp(-max(behind, 0.0) * 16.0);
    float edge = smoothstep(0.6, 0.97, (r - (mid - th * 0.5)) / (th + 0.001));
    a = band * (trail * trail * 0.9 + head * 0.8) + band * edge * trail * 0.6;
    float white = clamp(head * 0.75 + edge * trail * 0.65, 0.0, 1.0);
    col = mix(vColor, vec3(1.0), white);
    occ = 0.7 - white * 0.3;
  } else if (mode < 3.5) {
    // vortex: spiral arms rotating with p0, hot centre, dark gaps
    float ang = atan(p.y, p.x);
    float arms = vC.y;
    float s = sin(ang * arms + r * 9.0 - vC.x);
    float arm = smoothstep(0.1, 1.0, s);
    float body = (1.0 - smoothstep(0.72, 1.0, r)) * smoothstep(0.02, 0.3, r);
    float core = pow(1.0 - r, 5.0);
    float rimRing = (1.0 - smoothstep(0.88, 1.0, r)) * smoothstep(0.76, 0.9, r);
    a = arm * body * (0.5 + 0.6 * (1.0 - r)) + core * 0.8 + rimRing * 0.45 + body * 0.15;
    col = mix(vColor, vec3(1.0), clamp(core * 0.8 + arm * pow(1.0 - r, 3.0) * 0.4, 0.0, 1.0));
    occ = 0.6;
  } else if (mode < 4.5) {
    // telegraph: thick outline + growing fill + bright fill front
    float prog = vC.x;
    float outline = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.97, 1.0, r));
    float fill = 1.0 - step(prog, r);
    float front = fill * smoothstep(prog - 0.1, prog, r);
    float pulse = 0.85 + 0.15 * sin(vC.y);
    a = (outline * 0.95 + 0.2 + fill * 0.32 + front * 0.45) * pulse;
    col = mix(vColor, vec3(1.0), front * 0.35 + outline * 0.1);
  } else if (mode < 5.5) {
    // goo splat: lumpy blob + satellite droplets
    float seed = vC.w;
    float ang = atan(p.y, p.x);
    float e = 0.55 + 0.1 * sin(ang * 5.0 + seed * 6.3) + 0.07 * sin(ang * 9.0 + seed * 12.7) + 0.05 * sin(ang * 13.0 + seed * 3.1);
    float body = 1.0 - smoothstep(e - 0.05, e, r);
    float drops = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float da = seed * 6.2831 + fk * 1.7 + sin(seed * 9.0 + fk) * 0.6;
      float dr = 0.72 + 0.16 * fract(seed * 7.0 + fk * 0.37);
      vec2 c = vec2(cos(da), sin(da)) * dr;
      float rad = 0.07 + 0.06 * fract(seed * 3.0 + fk * 0.61);
      drops = max(drops, 1.0 - smoothstep(rad - 0.03, rad, length(p - c)));
    }
    float m = max(body, drops);
    // toon shading: darker rim, glossy highlight
    float rim = smoothstep(e - 0.16, e - 0.04, r) * body;
    col = vColor * (1.0 - rim * 0.35);
    float hl = 1.0 - smoothstep(0.0, 0.12, length(p - vec2(-0.18, 0.16)));
    col = mix(col, vec3(1.0), hl * 0.35 * body);
    a = m;
  } else if (mode < 6.5) {
    // scorch: soft burnt disc, mottled by value noise
    float seed = vC.w;
    vec2 q = p * 3.5 + seed * 17.0;
    vec2 i0 = floor(q);
    vec2 f0 = fract(q);
    vec2 u = f0 * f0 * (3.0 - 2.0 * f0);
    float n = mix(mix(fract(sin(dot(i0, vec2(12.9898, 78.233))) * 43758.5453), fract(sin(dot(i0 + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453), u.x),
                  mix(fract(sin(dot(i0 + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453), fract(sin(dot(i0 + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453), u.x), u.y);
    float e = 0.72 + 0.22 * n;
    a = (1.0 - smoothstep(0.15, e, r)) * (0.55 + 0.45 * n);
    col = vColor * (0.7 + 0.6 * n);
  } else {
    // rune circle: two rings + rotating ticks + inner triangle
    float ang = atan(p.y, p.x) + vC.x;
    float ring1 = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.92));
    float ring2 = 1.0 - smoothstep(0.0, 0.025, abs(r - 0.7));
    float ticks = step(0.86, fract(ang / (2.0 * PI) * 16.0)) * step(0.77, r) * step(r, 0.86);
    float tri = step(abs(fract(ang / (2.0 * PI) * 3.0) - 0.5) * 2.0, 1.0 - (r - 0.1) / 0.6) * step(0.1, r) * step(r, 0.7);
    float triEdge = tri * (1.0 - smoothstep(0.0, 0.06, (1.0 - (r - 0.1) / 0.6) - abs(fract(ang / (2.0 * PI) * 3.0) - 0.5) * 2.0));
    a = ring1 + ring2 * 0.8 + ticks * 0.7 + triEdge * 0.6 + (1.0 - r) * 0.15;
    col = mix(vColor, vec3(1.0), ring1 * 0.35);
    occ = 0.55;
  }
  a = clamp(a * vB.z, 0.0, 1.0);
  if (a < 0.003) discard;
#ifdef ADDITIVE
  // premultiplied "glow-over": rgb added, background dimmed by a * occ
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * occ);
#else
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
#endif
}`;

/** one pooled ground effect; fields are driven by Fx each frame */
export class GroundItem {
  active = false;
  /** bumped on every reuse so stale handles can be detected */
  gen = 0;
  mode: GMode = GMode.Ring;
  t = 0;
  life = 1;
  x = 0;
  y = 0;
  z = 0;
  rot = 0;
  radius = 1;
  /** start radius fraction for expanding effects */
  from = 0;
  r = 1;
  g = 1;
  b = 1;
  /** user alpha multiplier */
  alpha = 1;
  inner = 0.8;
  p0 = 0;
  p1 = 0;
  p2 = 0;
  seed = 0;
  /** spin speed (rad/s) for vortex / rune */
  spin = 0;
  /** ring band width in world units */
  w = 0.3;
  /** start delay in seconds (item is hidden until it elapses) */
  delay = 0;
  /** current values written to the GPU */
  curRadius = 1;
  curAlpha = 1;
}

/**
 * Pooled flat ground effects drawn with ONE instanced draw call per layer.
 * The additive layer draws rings, flashes, slashes, vortexes and runes; the
 * normal-blended layer draws decals (goo, scorch) and telegraphs.
 */
export class GroundLayer {
  readonly items: GroundItem[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private aC: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  private vec4Attrs: THREE.InstancedBufferAttribute[];
  private cursor = 0;
  activeCount = 0;

  /**
   * @param overlay draw on top of enemies (no depth test) so AoE / warnings stay
   *   readable inside a dense crowd
   */
  constructor(scene: THREE.Scene, readonly cap: number, additive: boolean, renderOrder: number, overlay = false) {
    for (let i = 0; i < cap; i++) this.items.push(new GroundItem());
    const base = new THREE.PlaneGeometry(2, 2);
    base.rotateX(-Math.PI / 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute("position", base.getAttribute("position"));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("aA", this.aA);
    this.geo.setAttribute("aB", this.aB);
    this.geo.setAttribute("aC", this.aC);
    this.geo.setAttribute("aColor", this.aCol);
    this.vec4Attrs = [this.aA, this.aB, this.aC];
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      defines: additive ? { ADDITIVE: 1 } : {},
      transparent: true,
      depthWrite: false,
      depthTest: !overlay,
      // glow layers use premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA) so each
      // fragment can choose between additive light and occluding colour
      blending: THREE.NormalBlending,
      premultipliedAlpha: additive,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  /** get a free item (or recycle the most finished one) and reset it */
  take(mode: GMode, x: number, y: number, z: number, radius: number, life: number, c: THREE.Color): GroundItem {
    const items = this.items;
    const n = items.length;
    let pick: GroundItem | null = null;
    for (let k = 0; k < n; k++) {
      const it = items[(this.cursor + k) % n];
      if (!it.active) {
        pick = it;
        this.cursor = (this.cursor + k + 1) % n;
        break;
      }
    }
    if (!pick) {
      // full: recycle the item closest to finishing
      let best = items[0];
      let bestK = -1;
      for (let k = 0; k < n; k++) {
        const it = items[k];
        const kk = it.t / it.life;
        if (kk > bestK) {
          bestK = kk;
          best = it;
        }
      }
      pick = best;
    }
    pick.active = true;
    pick.gen++;
    pick.mode = mode;
    pick.t = 0;
    pick.life = Math.max(0.01, life);
    pick.x = x;
    pick.y = y;
    pick.z = z;
    pick.rot = 0;
    pick.radius = radius;
    pick.from = 0;
    pick.r = c.r;
    pick.g = c.g;
    pick.b = c.b;
    pick.alpha = 1;
    pick.inner = 0.8;
    pick.p0 = 0;
    pick.p1 = 0;
    pick.p2 = 0;
    pick.seed = Math.random();
    pick.spin = 0;
    pick.w = radius * 0.25;
    pick.delay = 0;
    pick.curRadius = radius;
    pick.curAlpha = 1;
    return pick;
  }

  /** upload active items (call after Fx advanced their state) */
  upload(): void {
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    const K = this.aCol.array as Float32Array;
    let n = 0;
    for (const it of this.items) {
      if (!it.active || it.delay > 0) continue;
      const o4 = n * 4;
      const o3 = n * 3;
      A[o4] = it.x;
      A[o4 + 1] = it.y;
      A[o4 + 2] = it.z;
      A[o4 + 3] = it.rot;
      B[o4] = it.curRadius;
      B[o4 + 1] = it.mode;
      B[o4 + 2] = it.curAlpha * it.alpha;
      B[o4 + 3] = it.inner;
      C[o4] = it.p0;
      C[o4 + 1] = it.p1;
      C[o4 + 2] = it.p2;
      C[o4 + 3] = it.seed;
      K[o3] = it.r;
      K[o3 + 1] = it.g;
      K[o3 + 2] = it.b;
      n++;
    }
    this.activeCount = n;
    this.geo.instanceCount = n;
    const cnt = Math.max(1, n);
    for (let k = 0; k < this.vec4Attrs.length; k++) {
      const at = this.vec4Attrs[k];
      at.clearUpdateRanges();
      at.addUpdateRange(0, cnt * 4);
      at.needsUpdate = true;
    }
    this.aCol.clearUpdateRanges();
    this.aCol.addUpdateRange(0, cnt * 3);
    this.aCol.needsUpdate = true;
  }

  clear(): void {
    for (const it of this.items) it.active = false;
    this.geo.instanceCount = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
