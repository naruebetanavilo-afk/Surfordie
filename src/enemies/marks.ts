import * as THREE from "three";
import { G } from "../core/G";
import { chillPlayer } from "./chill";

/**
 * Ground marks owned by the enemy roster: attack telegraphs (filling warning
 * circles, charge lanes, breath cones) and lingering hazards (toxic puddles,
 * chilling frost patches).
 *
 * Rendering: three InstancedMesh batches share one shader (per-instance
 * colour / progress / alpha / mode / size), so ALL marks cost at most three
 * draw calls: telegraph discs (circles, cones) and telegraph lanes draw over
 * the horde without depth test; puddles, frost patches and boss auras stay
 * depth tested on the ground. The batches are rebuilt right before every
 * render (scene.onBeforeRender), so a moved mark never lags a frame.
 * Marks are purely visual except puddles, which tick damage on the player,
 * and frost patches, which chill (slow) the player standing in them.
 * Updated from Director.update(), cleared by Director.reset(); they hide
 * themselves automatically outside of a run (menu / results).
 */

export const MARK_CIRCLE = 0;
export const MARK_LANE = 1;
export const MARK_PUDDLE = 2;
export const MARK_AURA = 3;
export const MARK_FROST = 4;
export const MARK_CONE = 5;

export interface Mark {
  active: boolean;
  /** bumps every time the slot is reused, so stale handles can be detected */
  gen: number;
  kind: number;
  x: number;
  z: number;
  /** lane / cone direction (yaw convention: atan2(dx, dz)) */
  angle: number;
  /** circle radius, lane width or cone range */
  r: number;
  /** lane length or cone half-angle (radians) */
  len: number;
  t: number;
  dur: number;
  /** enemy uid that owns this mark (0 = none). killOwner() removes them */
  owner: number;
  /** puddle damage per tick */
  dmg: number;
  tick: number;
  /** linear RGB colour */
  color: THREE.Color;
  /** fill progress 0..1 (telegraphs) */
  progress: number;
  /** overall opacity 0..1 */
  alpha: number;
  /** grow-in scale multiplier (puddles / frost) */
  grow: number;
}

const vert = /* glsl */ `
attribute vec3 iColor;
attribute vec4 iData;
attribute vec2 iSize;
varying vec2 vUv;
varying vec3 vColor;
varying float vProgress;
varying float vAlpha;
varying float vMode;
varying vec2 vSize;
void main() {
  vUv = uv;
  vColor = iColor;
  vProgress = iData.x;
  vAlpha = iData.y;
  vMode = iData.z;
  vSize = iSize;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vProgress;
varying float vAlpha;
varying float vMode;
varying vec2 vSize;
uniform float uTime;
void main() {
  float a = 0.0;
  vec3 col = vColor;
  if (vMode < 0.5) {
    // warning circle: dark tint + rim + disc filling outward
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float bw = clamp(0.16 / vSize.x, 0.02, 0.2);
    float rim = smoothstep(1.0 - bw * 1.6, 1.0 - bw, r);
    float fill = 1.0 - smoothstep(vProgress - 0.015, vProgress, r);
    float front = fill * smoothstep(vProgress - 0.12, vProgress, r);
    float blink = 0.75 + 0.25 * sin(uTime * (10.0 + vProgress * 22.0));
    a = max(0.24, fill * 0.55 + front * 0.35);
    a = max(a, rim * 0.95 * blink);
    col = mix(vColor, vec3(1.0, 0.92, 0.85), rim * 0.2 + front * 0.45);
  } else if (vMode < 1.5) {
    // charge lane: vUv.x across, along = 0 at origin .. 1 at the far end
    float along = 1.0 - vUv.y;
    vec2 d = vec2(min(vUv.x, 1.0 - vUv.x) * vSize.x, min(along, 1.0 - along) * vSize.y);
    float edge = 1.0 - smoothstep(0.1, 0.2, min(d.x, d.y));
    float fill = 1.0 - smoothstep(vProgress - 0.01, vProgress, along);
    // chevrons (tips towards the far end) scrolling in the travel direction
    float chev = fract((along * vSize.y + abs(vUv.x - 0.5) * vSize.x * 0.9) * 0.55 - uTime * 2.5);
    float stripe = smoothstep(0.0, 0.08, chev) * (1.0 - smoothstep(0.4, 0.48, chev));
    float blink = 0.75 + 0.25 * sin(uTime * (10.0 + vProgress * 22.0));
    a = max(0.2 + stripe * 0.18, fill * (0.5 + stripe * 0.25));
    a = max(a, edge * 0.9 * blink);
    col = mix(vColor, vec3(1.0, 0.92, 0.85), edge * 0.2 + stripe * fill * 0.3);
  } else if (vMode < 2.5) {
    // toxic puddle: wobbly blob with bubbles
    vec2 p = vUv * 2.0 - 1.0;
    float ang = atan(p.y, p.x);
    float wob = 0.86 + 0.06 * sin(ang * 5.0 + uTime * 2.0) + 0.04 * sin(ang * 9.0 - uTime * 3.0);
    float r = length(p) / wob;
    if (r > 1.0) discard;
    vec2 q = p * 3.2 + vec2(uTime * 0.3, -uTime * 0.2);
    vec2 cell = fract(q) - 0.5;
    float bub = 1.0 - smoothstep(0.08, 0.16, length(cell) + 0.05 * sin(uTime * 4.0 + floor(q.x) * 7.0 + floor(q.y) * 3.0));
    float rim = smoothstep(0.75, 0.95, r);
    a = 0.55 + rim * 0.35;
    col = mix(vColor * 0.65, vColor, rim) + bub * 0.35;
  } else if (vMode > 3.5 && vMode < 4.5) {
    // frost patch: cracked ice sheet with a bright frosty rim
    vec2 p = vUv * 2.0 - 1.0;
    float ang = atan(p.y, p.x);
    float wob = 0.9 + 0.05 * sin(ang * 6.0) + 0.03 * sin(ang * 11.0 + 1.7);
    float r = length(p) / wob;
    if (r > 1.0) discard;
    float cr = abs(fract(ang * 1.1459 + r * 0.6) - 0.5);
    float crack = (1.0 - smoothstep(0.0, 0.035, cr)) * smoothstep(0.15, 0.4, r);
    float ring = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.55));
    float rim = smoothstep(0.78, 0.97, r);
    float shine = 0.5 + 0.5 * sin(uTime * 3.0 + p.x * 4.0 - p.y * 3.0);
    a = 0.42 + rim * 0.4 + crack * 0.25 + ring * 0.12;
    col = mix(vColor, vec3(1.0), rim * 0.55 + crack * 0.5 + shine * 0.08);
  } else if (vMode > 4.5) {
    // breath cone: sector pointing along local +Z (= -vUv.y), filling outward
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ang = abs(atan(p.x, -p.y));
    float half_ = vSize.y;
    if (r > 1.0 || ang > half_) discard;
    float bw = clamp(0.16 / vSize.x, 0.02, 0.2);
    float side = (half_ - ang) * r;
    float edge = max(smoothstep(1.0 - bw * 1.6, 1.0 - bw, r), 1.0 - smoothstep(bw * 0.6, bw * 1.4, side));
    float fill = 1.0 - smoothstep(vProgress - 0.015, vProgress, r);
    float front = fill * smoothstep(vProgress - 0.12, vProgress, r);
    float blink = 0.75 + 0.25 * sin(uTime * (10.0 + vProgress * 22.0));
    a = max(0.22, fill * 0.5 + front * 0.35);
    a = max(a, edge * 0.92 * blink);
    col = mix(vColor, vec3(1.0, 0.95, 0.9), edge * 0.2 + front * 0.45);
  } else {
    // boss aura: pulsing dashed ring that keeps the boss readable in a crowd
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float band = smoothstep(0.74, 0.82, r) * (1.0 - smoothstep(0.93, 1.0, r));
    float ang = atan(p.y, p.x);
    float dash = step(0.45, fract(ang * 1.909859 + uTime * 0.6));
    float pulse = 0.7 + 0.3 * sin(uTime * 5.0);
    a = band * (0.45 + 0.45 * dash) * pulse + (1.0 - r) * 0.18;
    col = mix(vColor, vec3(1.0), band * dash * 0.35);
  }
  a = clamp(a * vAlpha, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const POOL = 56;

/** batch ids: telegraph discs, telegraph lanes, ground hazards */
const B_TELE = 0;
const B_LANE = 1;
const B_GROUND = 2;

interface Batch {
  mesh: THREE.InstancedMesh;
  color: THREE.InstancedBufferAttribute;
  data: THREE.InstancedBufferAttribute;
  size: THREE.InstancedBufferAttribute;
}

function batchOf(kind: number): number {
  if (kind === MARK_LANE) return B_LANE;
  if (kind === MARK_CIRCLE || kind === MARK_CONE) return B_TELE;
  return B_GROUND;
}

function hiddenState(): boolean {
  const s = G.state;
  return s === "menu" || s === "gameover" || s === "victory" || s === "boot";
}


/** per-batch instance counts of the current sync (reused, no per-frame allocation) */
const SYNC_COUNTS = new Int32Array(3);

/** upload only the first `n` floats of an instanced attribute */
function flagRange(a: THREE.InstancedBufferAttribute, n: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n);
  a.needsUpdate = true;
}

class MarkSystem {
  private pool: Mark[] = [];
  private batches: Batch[] = [];
  private discGeo: THREE.PlaneGeometry | null = null;
  private laneGeo: THREE.PlaneGeometry | null = null;
  private scene: THREE.Scene | null = null;
  private prevHook: THREE.Scene["onBeforeRender"] | null = null;
  private readonly time = { value: 0 };

  private ensure(): void {
    if (this.scene) return;
    const scene = G.world.scene;
    this.scene = scene;
    this.discGeo = new THREE.PlaneGeometry(2, 2);
    this.discGeo.rotateX(-Math.PI / 2);
    this.laneGeo = new THREE.PlaneGeometry(1, 1);
    this.laneGeo.rotateX(-Math.PI / 2);
    this.laneGeo.translate(0, 0, 0.5);
    // attack warnings draw over the horde (enemy bodies would otherwise hide most of
    // the circle/lane); puddles and auras stay depth tested on the ground
    this.batches = [this.makeBatch(this.discGeo, false, 20), this.makeBatch(this.laneGeo, false, 20), this.makeBatch(this.discGeo, true, 3)];
    for (let i = 0; i < POOL; i++) {
      this.pool.push({
        active: false,
        gen: 0,
        kind: 0,
        x: 0,
        z: 0,
        angle: 0,
        r: 1,
        len: 1,
        t: 0,
        dur: 1,
        owner: 0,
        dmg: 0,
        tick: 0,
        color: new THREE.Color(),
        progress: 0,
        alpha: 0,
        grow: 1,
      });
    }
    // rebuild the instance buffers right before each render (after every
    // update of the frame, before three uploads attributes)
    this.prevHook = scene.onBeforeRender;
    const prev = this.prevHook;
    scene.onBeforeRender = function (this: THREE.Scene, ...args: Parameters<THREE.Scene["onBeforeRender"]>) {
      prev.apply(this, args);
      Marks.sync();
    } as THREE.Scene["onBeforeRender"];
  }

  private makeBatch(geo: THREE.PlaneGeometry, depthTest: boolean, renderOrder: number): Batch {
    const g = geo.clone();
    const color = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    const data = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    const size = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 2), 2);
    for (const a of [color, data, size]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("iColor", color);
    g.setAttribute("iData", data);
    g.setAttribute("iSize", size);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: this.time },
      transparent: true,
      depthWrite: false,
      depthTest,
    });
    const mesh = new THREE.InstancedMesh(g, mat, POOL);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    this.scene!.add(mesh);
    return { mesh, color, data, size };
  }

  private take(): Mark {
    this.ensure();
    let best: Mark | null = null;
    let bestPuddle: Mark | null = null;
    for (const m of this.pool) {
      if (!m.active) return m;
      // recycle the mark closest to finishing, puddles before telegraphs
      if ((m.kind === MARK_PUDDLE || m.kind === MARK_FROST) && (!bestPuddle || m.t / m.dur > bestPuddle.t / bestPuddle.dur)) bestPuddle = m;
      if (!best || m.t / m.dur > best.t / best.dur) best = m;
    }
    return bestPuddle ?? best!;
  }

  private setup(m: Mark, kind: number, x: number, z: number, color: string, dur: number, owner: number): Mark {
    m.active = true;
    m.gen++;
    m.kind = kind;
    m.x = x;
    m.z = z;
    m.angle = 0;
    m.t = 0;
    m.dur = Math.max(0.05, dur);
    m.owner = owner;
    m.dmg = 0;
    m.tick = 0;
    m.color.set(color);
    m.progress = 0;
    m.alpha = 0;
    m.grow = 1;
    return m;
  }

  /** filling warning circle; fully filled exactly when `dur` elapses */
  circle(x: number, z: number, r: number, dur: number, owner = 0, color = "#ff2424"): Mark {
    const m = this.setup(this.take(), MARK_CIRCLE, x, z, color, dur, owner);
    m.r = r;
    m.len = r;
    return m;
  }

  /** charge lane starting at (x,z) heading `angle` (atan2(dx,dz)) */
  lane(x: number, z: number, angle: number, len: number, width: number, dur: number, owner = 0, color = "#ff2424"): Mark {
    const m = this.setup(this.take(), MARK_LANE, x, z, color, dur, owner);
    m.angle = angle;
    m.len = len;
    m.r = width;
    return m;
  }

  /** lingering hazard that hurts the player while standing in it */
  puddle(x: number, z: number, r: number, dur: number, dmg: number, color = "#8bff3a"): Mark {
    const m = this.setup(this.take(), MARK_PUDDLE, x, z, color, dur, 0);
    m.r = r;
    m.len = r;
    m.dmg = dmg;
    m.tick = 0.35;
    m.grow = 0.4;
    return m;
  }

  /** icy patch that chills (slows) the player standing in it */
  frost(x: number, z: number, r: number, dur: number, color = "#a8e8ff"): Mark {
    const m = this.setup(this.take(), MARK_FROST, x, z, color, dur, 0);
    m.r = r;
    m.len = r;
    m.tick = 0.1;
    m.grow = 0.3;
    return m;
  }

  /**
   * filling breath cone from (x,z) towards `angle` (atan2(dx,dz)): `range`
   * long, `halfAngle` radians to each side; fully filled after `dur`
   */
  cone(x: number, z: number, angle: number, range: number, halfAngle: number, dur: number, owner = 0, color = "#ff2424"): Mark {
    const m = this.setup(this.take(), MARK_CONE, x, z, color, dur, owner);
    m.angle = angle;
    m.r = range;
    m.len = halfAngle;
    return m;
  }

  /** ring that follows a boss until killOwner() (move it every frame) */
  aura(x: number, z: number, r: number, owner: number, color: string): Mark {
    const m = this.setup(this.take(), MARK_AURA, x, z, color, 1e9, owner);
    m.r = r;
    m.len = r;
    return m;
  }

  /** move/re-aim a live mark (e.g. a lane that tracks the player during wind-up) */
  move(m: Mark, gen: number, x: number, z: number, angle?: number): void {
    if (!m.active || m.gen !== gen) return;
    m.x = x;
    m.z = z;
    if (angle !== undefined) m.angle = angle;
  }

  /** is this handle still the same live mark? */
  alive(m: Mark | null, gen: number): boolean {
    return !!m && m.active && m.gen === gen;
  }

  end(m: Mark | null, gen: number): void {
    if (m && m.active && m.gen === gen) m.active = false;
  }

  /** remove every mark owned by an enemy (call from onDeath) */
  killOwner(uid: number): void {
    for (const m of this.pool) if (m.active && m.owner === uid) m.active = false;
  }

  update(dt: number): void {
    if (!this.scene) return;
    const p = G.player;
    this.time.value = G.time;
    for (const m of this.pool) {
      if (!m.active) continue;
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      if (m.kind === MARK_PUDDLE) {
        // grow in, fade out
        m.grow = 0.4 + 0.6 * Math.min(1, m.t * 6);
        m.alpha = k > 0.75 ? (1 - k) / 0.25 : 0.9;
        m.tick -= dt;
        if (m.tick <= 0) {
          m.tick = 0.5;
          const dx = p.x - m.x;
          const dz = p.z - m.z;
          const rr = m.r * 0.85 + p.radius * 0.5;
          if (dx * dx + dz * dz < rr * rr) p.takeDamage(m.dmg);
        }
      } else if (m.kind === MARK_FROST) {
        m.grow = 0.3 + 0.7 * Math.min(1, m.t * 7);
        m.alpha = k > 0.7 ? (1 - k) / 0.3 : 0.9;
        m.tick -= dt;
        if (m.tick <= 0) {
          m.tick = 0.25;
          const dx = p.x - m.x;
          const dz = p.z - m.z;
          const rr = m.r * 0.85 + p.radius * 0.5;
          if (k < 0.85 && dx * dx + dz * dz < rr * rr) chillPlayer(0.5, 0.65);
        }
      } else if (m.kind === MARK_AURA) {
        m.alpha = Math.min(1, m.t * 2);
      } else {
        m.progress = k;
        m.alpha = Math.min(1, m.t * 8);
      }
      if (m.t >= m.dur) m.active = false;
    }
  }

  /** write every live mark into its batch (called right before rendering) */
  sync(): void {
    if (!this.scene) return;
    const hidden = hiddenState();
    const counts = SYNC_COUNTS;
    counts.fill(0);
    for (const m of this.pool) {
      if (!m.active) continue;
      // outside of a run the director is not ticking: drop leftovers instantly
      if (hidden) {
        m.active = false;
        continue;
      }
      const bi = batchOf(m.kind);
      const b = this.batches[bi];
      const k = counts[bi]++;
      // transform: yaw (lanes / cones), scale and a per-kind lift above the ground
      const lane = m.kind === MARK_LANE;
      const rot = lane || m.kind === MARK_CONE;
      const sx = lane ? m.r : m.r * m.grow;
      const sz = lane ? m.len : m.r * m.grow;
      const y = lane ? 0.045 : m.kind === MARK_PUDDLE || m.kind === MARK_FROST ? 0.035 : m.kind === MARK_AURA ? 0.03 : 0.05;
      const c = rot ? Math.cos(m.angle) : 1;
      const s = rot ? Math.sin(m.angle) : 0;
      const e = b.mesh.instanceMatrix.array as Float32Array;
      const o = k * 16;
      e[o] = c * sx;
      e[o + 1] = 0;
      e[o + 2] = -s * sx;
      e[o + 3] = 0;
      e[o + 4] = 0;
      e[o + 5] = 1;
      e[o + 6] = 0;
      e[o + 7] = 0;
      e[o + 8] = s * sz;
      e[o + 9] = 0;
      e[o + 10] = c * sz;
      e[o + 11] = 0;
      e[o + 12] = m.x;
      e[o + 13] = y;
      e[o + 14] = m.z;
      e[o + 15] = 1;
      const ca = b.color.array as Float32Array;
      ca[k * 3] = m.color.r;
      ca[k * 3 + 1] = m.color.g;
      ca[k * 3 + 2] = m.color.b;
      const da = b.data.array as Float32Array;
      da[k * 4] = m.progress;
      da[k * 4 + 1] = m.alpha;
      da[k * 4 + 2] = m.kind;
      da[k * 4 + 3] = 0;
      const sa = b.size.array as Float32Array;
      // shader size: circle/puddle/aura/frost = (r, r), lane = (width, length), cone = (range, half-angle)
      sa[k * 2] = m.r;
      sa[k * 2 + 1] = m.len;
    }
    for (let bi = 0; bi < this.batches.length; bi++) {
      const b = this.batches[bi];
      const n = counts[bi];
      b.mesh.count = n;
      b.mesh.visible = n > 0;
      if (n === 0) continue;
      const im = b.mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, n * 16);
      im.needsUpdate = true;
      flagRange(b.color, n * 3);
      flagRange(b.data, n * 4);
      flagRange(b.size, n * 2);
    }
  }

  clear(): void {
    for (const m of this.pool) m.active = false;
  }

  /** build the (hidden) batches now so the boot-time shader prewarm sees them */
  prepare(): void {
    this.ensure();
  }

  /** show one invisible mark for a frame so the shader compiles up front */
  warmUp(x: number, z: number): void {
    this.circle(x, z, 0.01, 0.05);
  }

  /** free GPU resources (the batches are rebuilt lazily if used again) */
  dispose(): void {
    for (const b of this.batches) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      b.mesh.dispose();
    }
    if (this.scene && this.prevHook) this.scene.onBeforeRender = this.prevHook;
    this.discGeo?.dispose();
    this.laneGeo?.dispose();
    this.discGeo = this.laneGeo = null;
    this.batches = [];
    this.pool = [];
    this.scene = null;
    this.prevHook = null;
  }
}

/** shared instance (lazy: meshes are created on first use) */
export const Marks = new MarkSystem();
