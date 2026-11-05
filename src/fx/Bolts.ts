import * as THREE from "three";
import { G } from "../core/G";

const MAX_BOLTS = 48;
const MAIN_PTS = 14;
const BRANCHES = 3;
const BR_PTS = 6;
const PTS = MAIN_PTS + BRANCHES * BR_PTS;
const VERTS = PTS * 2;
const IDX_PER_BOLT = ((MAIN_PTS - 1) + BRANCHES * (BR_PTS - 1)) * 6;
/** seconds between path re-randomisations (gives the crackling flicker) */
const FLICKER = 1 / 28;

const vert = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aCol;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = aUv;
  vCol = aCol;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
void main() {
  float d = abs(vUv.x);
  float core = 1.0 - smoothstep(0.12, 0.26, d);
  float glow = 1.0 - d;
  glow = glow * glow * glow * 0.6;
  vec3 c = mix(vCol.rgb, vec3(1.0), core * 0.85);
  float a = clamp((core + glow) * vCol.a, 0.0, 1.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (0.3 + core * 0.4));
}`;

class Bolt {
  active = false;
  t = 0;
  life = 0.2;
  flick = 0;
  x1 = 0;
  y1 = 0;
  z1 = 0;
  x2 = 0;
  y2 = 0;
  z2 = 0;
  width = 0.18;
  jitter = 0.35;
  r = 1;
  g = 1;
  b = 1;
  bright = 1;
  branches = 0;
  /** centre line points (x,y,z) for main + branches */
  readonly pts = new Float32Array(PTS * 3);
  /** per-point half width */
  readonly w = new Float32Array(PTS);
  /** per-strip side vector (x,y,z) for main + branches */
  readonly side = new Float32Array((1 + BRANCHES) * 3);
}

/**
 * Lightning bolts with a white-hot core, coloured glow halo, random side
 * branches and a crackling re-randomised path. All bolts share ONE dynamic
 * mesh / draw call; ribbons are billboarded toward the camera so vertical
 * strikes from the sky look as good as horizontal chains.
 */
export class Bolts {
  private bolts: Bolt[] = [];
  private geo = new THREE.BufferGeometry();
  private posA: THREE.BufferAttribute;
  private uvA: THREE.BufferAttribute;
  private colA: THREE.BufferAttribute;
  private mat: THREE.ShaderMaterial;
  readonly mesh: THREE.Mesh;
  activeCount = 0;
  private warm = 3;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX_BOLTS; i++) this.bolts.push(new Bolt());
    this.posA = new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.uvA = new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * VERTS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * VERTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posA);
    this.geo.setAttribute("aUv", this.uvA);
    this.geo.setAttribute("aCol", this.colA);
    const idx = new Uint16Array(MAX_BOLTS * IDX_PER_BOLT);
    let o = 0;
    for (let b = 0; b < MAX_BOLTS; b++) {
      const base = b * VERTS;
      const strip = (start: number, count: number): void => {
        for (let i = 0; i < count - 1; i++) {
          const a = base + (start + i) * 2;
          idx[o++] = a;
          idx[o++] = a + 1;
          idx[o++] = a + 2;
          idx[o++] = a + 1;
          idx[o++] = a + 3;
          idx[o++] = a + 2;
        }
      };
      strip(0, MAIN_PTS);
      for (let k = 0; k < BRANCHES; k++) strip(MAIN_PTS + k * BR_PTS, BR_PTS);
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    // static across-ribbon uv: x = -1 / +1, y = along
    const uv = this.uvA.array as Float32Array;
    for (let b = 0; b < MAX_BOLTS; b++) {
      for (let p = 0; p < PTS; p++) {
        const v = (b * VERTS + p * 2) * 2;
        const along = p < MAIN_PTS ? p / (MAIN_PTS - 1) : ((p - MAIN_PTS) % BR_PTS) / (BR_PTS - 1);
        uv[v] = -1;
        uv[v + 1] = along;
        uv[v + 2] = 1;
        uv[v + 3] = along;
      }
    }
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
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
  }

  spawn(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, c: THREE.Color, width: number, jitter: number, life: number, branches: number): void {
    let b: Bolt | null = null;
    let oldest = this.bolts[0];
    for (const q of this.bolts) {
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
    b.flick = 0;
    b.x1 = x1;
    b.y1 = y1;
    b.z1 = z1;
    b.x2 = x2;
    b.y2 = y2;
    b.z2 = z2;
    b.width = width;
    b.jitter = jitter;
    b.r = c.r;
    b.g = c.g;
    b.b = c.b;
    b.branches = branches;
    this.regen(b);
  }

  /** re-randomise the bolt's path (main line + branches) */
  private regen(b: Bolt): void {
    const pitch = G.world.camPitch;
    const fx = 0;
    const fy = -Math.sin(pitch);
    const fz = -Math.cos(pitch);
    let dx = b.x2 - b.x1;
    let dy = b.y2 - b.y1;
    let dz = b.z2 - b.z1;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    // side = d x f (billboarded width direction)
    let sx = dy * fz - dz * fy;
    let sy = dz * fx - dx * fz;
    let sz = dx * fy - dy * fx;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) {
      sx = 1;
      sy = 0;
      sz = 0;
      sl = 1;
    }
    sx /= sl;
    sy /= sl;
    sz /= sl;
    b.side[0] = sx;
    b.side[1] = sy;
    b.side[2] = sz;
    const jit = Math.min(b.jitter, len * 0.3);
    const bend = (Math.random() - 0.5) * jit * 1.6;
    const pts = b.pts;
    for (let i = 0; i < MAIN_PTS; i++) {
      const t = i / (MAIN_PTS - 1);
      const env = Math.sin(Math.PI * t);
      const off = i === 0 || i === MAIN_PTS - 1 ? 0 : (Math.random() - 0.5) * 2 * jit * (0.35 + 0.65 * env) + bend * env;
      const o = i * 3;
      pts[o] = b.x1 + (b.x2 - b.x1) * t + sx * off;
      pts[o + 1] = b.y1 + (b.y2 - b.y1) * t + sy * off;
      pts[o + 2] = b.z1 + (b.z2 - b.z1) * t + sz * off;
      b.w[i] = b.width * (1.15 - 0.45 * t) * (0.85 + Math.random() * 0.3);
    }
    // branches fork off the main line and fade toward their tips
    for (let k = 0; k < BRANCHES; k++) {
      const base = MAIN_PTS + k * BR_PTS;
      const so = (1 + k) * 3;
      if (k >= b.branches) {
        for (let i = 0; i < BR_PTS; i++) b.w[base + i] = 0;
        continue;
      }
      const si = 2 + Math.floor(Math.random() * (MAIN_PTS - 6));
      const ang = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 0.6);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      let bx = dx * ca + sx * sa;
      let by = dy * ca + sy * sa;
      let bz = dz * ca + sz * sa;
      const bl = Math.hypot(bx, by, bz) || 1;
      bx /= bl;
      by /= bl;
      bz /= bl;
      // branch side vector
      let bsx = by * fz - bz * fy;
      let bsy = bz * fx - bx * fz;
      let bsz = bx * fy - by * fx;
      const bsl = Math.hypot(bsx, bsy, bsz) || 1;
      bsx /= bsl;
      bsy /= bsl;
      bsz /= bsl;
      b.side[so] = bsx;
      b.side[so + 1] = bsy;
      b.side[so + 2] = bsz;
      const L = len * (0.16 + Math.random() * 0.2);
      const ox = pts[si * 3];
      const oy = pts[si * 3 + 1];
      const oz = pts[si * 3 + 2];
      const bw = b.w[si] * 0.6;
      for (let i = 0; i < BR_PTS; i++) {
        const t = i / (BR_PTS - 1);
        const off = i === 0 ? 0 : (Math.random() - 0.5) * jit * 0.7;
        const o = (base + i) * 3;
        pts[o] = ox + bx * L * t + bsx * off;
        pts[o + 1] = oy + by * L * t + bsy * off;
        pts[o + 2] = oz + bz * L * t + bsz * off;
        b.w[base + i] = bw * (1 - t * 0.85);
      }
    }
    b.bright = 0.8 + Math.random() * 0.2;
  }

  update(dt: number): void {
    const pos = this.posA.array as Float32Array;
    const col = this.colA.array as Float32Array;
    let n = 0;
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) {
        b.active = false;
        continue;
      }
      b.flick -= dt;
      if (b.flick <= 0) {
        b.flick = FLICKER;
        this.regen(b);
      }
      const alpha = (k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7) * b.bright;
      // ribbon is 3x the core width: the outer part is the glow halo
      const vBase = n * VERTS;
      for (let p = 0; p < PTS; p++) {
        const strip = p < MAIN_PTS ? 0 : 1 + Math.floor((p - MAIN_PTS) / BR_PTS);
        const so = strip * 3;
        const w = b.w[p] * 2.4;
        const cx = b.pts[p * 3];
        const cy = b.pts[p * 3 + 1];
        const cz = b.pts[p * 3 + 2];
        const v = (vBase + p * 2) * 3;
        pos[v] = cx - b.side[so] * w;
        pos[v + 1] = cy - b.side[so + 1] * w;
        pos[v + 2] = cz - b.side[so + 2] * w;
        pos[v + 3] = cx + b.side[so] * w;
        pos[v + 4] = cy + b.side[so + 1] * w;
        pos[v + 5] = cz + b.side[so + 2] * w;
        const a = strip === 0 ? alpha : alpha * 0.75;
        const c = (vBase + p * 2) * 4;
        col[c] = b.r;
        col[c + 1] = b.g;
        col[c + 2] = b.b;
        col[c + 3] = a;
        col[c + 4] = b.r;
        col[c + 5] = b.g;
        col[c + 6] = b.b;
        col[c + 7] = a;
      }
      n++;
    }
    this.activeCount = n;
    // visible for the first frames even when empty so the shader compiles at boot
    if (this.warm > 0) this.warm--;
    this.mesh.visible = n > 0 || this.warm > 0;
    if (n === 0) return;
    this.geo.setDrawRange(0, n * IDX_PER_BOLT);
    this.posA.clearUpdateRanges();
    this.posA.addUpdateRange(0, n * VERTS * 3);
    this.posA.needsUpdate = true;
    this.colA.clearUpdateRanges();
    this.colA.addUpdateRange(0, n * VERTS * 4);
    this.colA.needsUpdate = true;
  }

  clear(): void {
    for (const b of this.bolts) b.active = false;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
