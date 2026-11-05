import * as THREE from "three";
import { G } from "../core/G";

/**
 * Ground marks owned by the enemy roster: attack telegraphs (filling warning
 * circles, charge lanes) and lingering hazards (toxic puddles).
 *
 * A small pool of flat meshes (one draw call per *visible* mark). Marks are
 * purely visual except puddles, which tick damage on the player.
 * Updated from Director.update(), cleared by Director.reset(); they hide
 * themselves automatically outside of a run (menu / results).
 */

export const MARK_CIRCLE = 0;
export const MARK_LANE = 1;
export const MARK_PUDDLE = 2;
export const MARK_AURA = 3;

export interface Mark {
  active: boolean;
  /** bumps every time the slot is reused, so stale handles can be detected */
  gen: number;
  kind: number;
  x: number;
  z: number;
  /** lane direction (yaw convention: atan2(dx, dz)) */
  angle: number;
  /** circle radius or lane width */
  r: number;
  /** lane length */
  len: number;
  t: number;
  dur: number;
  /** enemy uid that owns this mark (0 = none). killOwner() removes them */
  owner: number;
  /** puddle damage per tick */
  dmg: number;
  tick: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uProgress;
uniform float uAlpha;
uniform float uMode;
uniform float uTime;
uniform vec2 uSize;
void main() {
  float a = 0.0;
  vec3 col = uColor;
  if (uMode < 0.5) {
    // warning circle: dark tint + rim + disc filling outward
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float bw = clamp(0.16 / uSize.x, 0.02, 0.2);
    float rim = smoothstep(1.0 - bw * 1.6, 1.0 - bw, r);
    float fill = 1.0 - smoothstep(uProgress - 0.015, uProgress, r);
    float front = fill * smoothstep(uProgress - 0.12, uProgress, r);
    float blink = 0.75 + 0.25 * sin(uTime * (10.0 + uProgress * 22.0));
    a = max(0.24, fill * 0.55 + front * 0.35);
    a = max(a, rim * 0.95 * blink);
    col = mix(uColor, vec3(1.0, 0.92, 0.85), rim * 0.2 + front * 0.45);
  } else if (uMode < 1.5) {
    // charge lane: vUv.x across, along = 0 at origin .. 1 at the far end
    float along = 1.0 - vUv.y;
    vec2 d = vec2(min(vUv.x, 1.0 - vUv.x) * uSize.x, min(along, 1.0 - along) * uSize.y);
    float edge = 1.0 - smoothstep(0.1, 0.2, min(d.x, d.y));
    float fill = 1.0 - smoothstep(uProgress - 0.01, uProgress, along);
    // chevrons scrolling towards the far end
    float chev = fract((along * uSize.y - abs(vUv.x - 0.5) * uSize.x * 0.9) * 0.55 - uTime * 2.5);
    float stripe = smoothstep(0.0, 0.08, chev) * (1.0 - smoothstep(0.4, 0.48, chev));
    float blink = 0.75 + 0.25 * sin(uTime * (10.0 + uProgress * 22.0));
    a = max(0.2 + stripe * 0.18, fill * (0.5 + stripe * 0.25));
    a = max(a, edge * 0.9 * blink);
    col = mix(uColor, vec3(1.0, 0.92, 0.85), edge * 0.2 + stripe * fill * 0.3);
  } else if (uMode < 2.5) {
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
    col = mix(uColor * 0.65, uColor, rim) + bub * 0.35;
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
    col = mix(uColor, vec3(1.0), band * dash * 0.35);
  }
  a = clamp(a * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const POOL = 56;

class MarkSystem {
  private pool: Mark[] = [];
  private discGeo: THREE.PlaneGeometry | null = null;
  private laneGeo: THREE.PlaneGeometry | null = null;
  private scene: THREE.Scene | null = null;

  private ensure(): void {
    if (this.scene) return;
    this.scene = G.world.scene;
    this.discGeo = new THREE.PlaneGeometry(2, 2);
    this.discGeo.rotateX(-Math.PI / 2);
    this.laneGeo = new THREE.PlaneGeometry(1, 1);
    this.laneGeo.rotateX(-Math.PI / 2);
    this.laneGeo.translate(0, 0, 0.5);
    for (let i = 0; i < POOL; i++) this.pool.push(this.make());
  }

  private make(): Mark {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uProgress: { value: 0 },
        uAlpha: { value: 1 },
        uMode: { value: 0 },
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.discGeo!, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    const m: Mark = {
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
      mesh,
      mat,
    };
    // outside of a run the director is not ticking: hide leftovers instantly
    mesh.onBeforeRender = () => {
      const s = G.state;
      if (s === "menu" || s === "gameover" || s === "victory" || s === "boot") {
        mat.uniforms.uAlpha.value = 0;
        this.release(m);
      }
    };
    this.scene!.add(mesh);
    return m;
  }

  private take(): Mark {
    this.ensure();
    let best: Mark | null = null;
    let bestPuddle: Mark | null = null;
    for (const m of this.pool) {
      if (!m.active) return m;
      // recycle the mark closest to finishing, puddles before telegraphs
      if (m.kind === MARK_PUDDLE && (!bestPuddle || m.t / m.dur > bestPuddle.t / bestPuddle.dur)) bestPuddle = m;
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
    m.t = 0;
    m.dur = Math.max(0.05, dur);
    m.owner = owner;
    m.dmg = 0;
    m.tick = 0;
    const u = m.mat.uniforms;
    u.uColor.value.set(color);
    u.uMode.value = kind;
    u.uProgress.value = 0;
    u.uAlpha.value = 0;
    m.mesh.geometry = kind === MARK_LANE ? this.laneGeo! : this.discGeo!;
    m.mesh.visible = true;
    return m;
  }

  /** filling warning circle; fully filled exactly when `dur` elapses */
  circle(x: number, z: number, r: number, dur: number, owner = 0, color = "#ff2424"): Mark {
    const m = this.setup(this.take(), MARK_CIRCLE, x, z, color, dur, owner);
    m.r = r;
    m.mat.uniforms.uSize.value.set(r, r);
    this.place(m);
    return m;
  }

  /** charge lane starting at (x,z) heading `angle` (atan2(dx,dz)) */
  lane(x: number, z: number, angle: number, len: number, width: number, dur: number, owner = 0, color = "#ff2424"): Mark {
    const m = this.setup(this.take(), MARK_LANE, x, z, color, dur, owner);
    m.angle = angle;
    m.len = len;
    m.r = width;
    m.mat.uniforms.uSize.value.set(width, len);
    this.place(m);
    return m;
  }

  /** lingering hazard that hurts the player while standing in it */
  puddle(x: number, z: number, r: number, dur: number, dmg: number, color = "#8bff3a"): Mark {
    const m = this.setup(this.take(), MARK_PUDDLE, x, z, color, dur, 0);
    m.r = r;
    m.dmg = dmg;
    m.tick = 0.35;
    m.mat.uniforms.uSize.value.set(r, r);
    this.place(m);
    return m;
  }

  /** ring that follows a boss until killOwner() (move it every frame) */
  aura(x: number, z: number, r: number, owner: number, color: string): Mark {
    const m = this.setup(this.take(), MARK_AURA, x, z, color, 1e9, owner);
    m.r = r;
    m.mat.uniforms.uSize.value.set(r, r);
    this.place(m);
    return m;
  }

  /** move/re-aim a live mark (e.g. a lane that tracks the player during wind-up) */
  move(m: Mark, gen: number, x: number, z: number, angle?: number): void {
    if (!m.active || m.gen !== gen) return;
    m.x = x;
    m.z = z;
    if (angle !== undefined) m.angle = angle;
    this.place(m);
  }

  /** is this handle still the same live mark? */
  alive(m: Mark | null, gen: number): boolean {
    return !!m && m.active && m.gen === gen;
  }

  end(m: Mark | null, gen: number): void {
    if (m && m.active && m.gen === gen) this.release(m);
  }

  /** remove every mark owned by an enemy (call from onDeath) */
  killOwner(uid: number): void {
    for (const m of this.pool) if (m.active && m.owner === uid) this.release(m);
  }

  private release(m: Mark): void {
    m.active = false;
    m.mesh.visible = false;
  }

  private place(m: Mark): void {
    const mesh = m.mesh;
    if (m.kind === MARK_LANE) {
      mesh.position.set(m.x, 0.045, m.z);
      mesh.rotation.set(0, m.angle, 0);
      mesh.scale.set(m.r, 1, m.len);
    } else {
      mesh.position.set(m.x, m.kind === MARK_PUDDLE ? 0.035 : m.kind === MARK_AURA ? 0.03 : 0.05, m.z);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(m.r, 1, m.r);
    }
  }

  update(dt: number): void {
    if (!this.scene) return;
    const p = G.player;
    const time = G.time;
    for (const m of this.pool) {
      if (!m.active) continue;
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const u = m.mat.uniforms;
      u.uTime.value = time;
      if (m.kind === MARK_PUDDLE) {
        // grow in, fade out
        const grow = Math.min(1, m.t * 6);
        m.mesh.scale.set(m.r * (0.4 + 0.6 * grow), 1, m.r * (0.4 + 0.6 * grow));
        u.uAlpha.value = k > 0.75 ? (1 - k) / 0.25 : 0.9;
        m.tick -= dt;
        if (m.tick <= 0) {
          m.tick = 0.5;
          const dx = p.x - m.x;
          const dz = p.z - m.z;
          const rr = m.r * 0.85 + p.radius * 0.5;
          if (dx * dx + dz * dz < rr * rr) p.takeDamage(m.dmg);
        }
      } else if (m.kind === MARK_AURA) {
        u.uAlpha.value = Math.min(1, m.t * 2);
      } else {
        u.uProgress.value = k;
        u.uAlpha.value = Math.min(1, m.t * 8);
      }
      if (m.t >= m.dur) this.release(m);
    }
  }

  clear(): void {
    for (const m of this.pool) this.release(m);
  }

  /** free GPU resources (the pool is rebuilt lazily if used again) */
  dispose(): void {
    for (const m of this.pool) {
      m.mesh.removeFromParent();
      m.mat.dispose();
    }
    this.discGeo?.dispose();
    this.laneGeo?.dispose();
    this.discGeo = this.laneGeo = null;
    this.pool = [];
    this.scene = null;
  }
}

/** shared instance (lazy: meshes are created on first use) */
export const Marks = new MarkSystem();
