import * as THREE from "three";
import { G } from "../core/G";
import { glowTexture } from "./textures";
import { Particles, type BurstOpts } from "./Particles";

export interface RingOpts {
  radius: number;
  color: string;
  life?: number;
  /** ring thickness in world units */
  width?: number;
  /** height above ground */
  y?: number;
  /** starting radius fraction (0..1) for the expansion */
  from?: number;
}

export interface FlashOpts {
  radius: number;
  color: string;
  life?: number;
  y?: number;
}

export interface ArcOpts {
  radius: number;
  /** full arc angle in radians */
  arc: number;
  color: string;
  life?: number;
  width?: number;
  y?: number;
}

export interface BoltOpts {
  color?: string;
  life?: number;
  width?: number;
  /** jaggedness (world units) */
  jitter?: number;
}

const groundVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * mode 0 = ring, 1 = filled glow disc, 2 = slash arc (sweeps with uSweep)
 */
const groundFrag = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uInner;
uniform float uArc;
uniform float uSweep;
uniform float uMode;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float glow;
  vec3 col = uColor;
  if (uMode < 0.5) {
    float band = smoothstep(uInner - 0.1, uInner, r) * (1.0 - smoothstep(0.88, 1.0, r));
    float rim = smoothstep(0.7, 0.95, r);
    glow = band * (0.45 + rim * 0.8);
    col = mix(uColor, vec3(1.0), rim * 0.35);
  } else if (uMode < 1.5) {
    glow = pow(1.0 - r, 1.6);
    col = mix(uColor, vec3(1.0), pow(1.0 - r, 4.0) * 0.8);
  } else {
    float a = atan(p.x, p.y);
    float t = (a + uArc) / (2.0 * uArc);
    if (t < 0.0 || t > 1.0) discard;
    float band = smoothstep(uInner - 0.15, uInner + 0.1, r) * (1.0 - smoothstep(0.86, 1.0, r));
    float trail = smoothstep(uSweep - 0.75, uSweep, t) * (1.0 - smoothstep(uSweep, uSweep + 0.04, t));
    glow = band * trail * 1.4;
    col = mix(uColor, vec3(1.0), smoothstep(0.75, 0.95, r) * trail * 0.8);
  }
  float a = clamp(glow * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}`;

interface GroundFxItem {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  active: boolean;
  t: number;
  life: number;
  kind: 0 | 1 | 2;
  radius: number;
  from: number;
}

interface BoltItem {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  geo: THREE.BufferGeometry;
  active: boolean;
  t: number;
  life: number;
}

const BOLT_SEGS = 12;

/**
 * Visual effects facade. All effects are pooled and fire-and-forget.
 * Weapons should use these helpers instead of creating meshes ad hoc.
 */
export class Fx {
  readonly particles: Particles;
  /** additive glow particles (sparks, magic) */
  private ground: GroundFxItem[] = [];
  private bolts: BoltItem[] = [];
  private flashGeo = new THREE.PlaneGeometry(2, 2);

  constructor(private scene: THREE.Scene) {
    this.particles = new Particles(scene);
    this.flashGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 72; i++) this.ground.push(this.makeGround());
    for (let i = 0; i < 40; i++) this.bolts.push(this.makeBolt());
  }

  private makeGround(): GroundFxItem {
    const mat = new THREE.ShaderMaterial({
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uAlpha: { value: 1 },
        uInner: { value: 0.8 },
        uArc: { value: Math.PI },
        uSweep: { value: 1 },
        uMode: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
    });
    const mesh = new THREE.Mesh(this.flashGeo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    return { mesh, mat, active: false, t: 0, life: 1, kind: 0, radius: 1, from: 0 };
  }

  private makeBolt(): BoltItem {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((BOLT_SEGS + 1) * 2 * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const idx: number[] = [];
    for (let i = 0; i < BOLT_SEGS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: "#bfe9ff",
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    this.scene.add(mesh);
    return { mesh, mat, geo, active: false, t: 0, life: 0.2 };
  }

  private takeGround(): GroundFxItem {
    let best = this.ground[0];
    for (const g of this.ground) {
      if (!g.active) return g;
      if (g.t / g.life > best.t / best.life) best = g;
    }
    return best;
  }

  /** expanding shockwave ring on the ground */
  ring(x: number, z: number, o: RingOpts): void {
    const g = this.takeGround();
    g.active = true;
    g.t = 0;
    g.life = o.life ?? 0.45;
    g.kind = 0;
    g.radius = o.radius;
    g.from = o.from ?? 0.2;
    const u = g.mat.uniforms;
    u.uColor.value.set(o.color);
    u.uMode.value = 0;
    u.uInner.value = Math.max(0.05, 1 - (o.width ?? o.radius * 0.25) / o.radius);
    g.mesh.position.set(x, o.y ?? 0.06, z);
    g.mesh.rotation.set(0, 0, 0);
    g.mesh.visible = true;
  }

  /** soft glowing disc that fades out (explosion core, muzzle flash) */
  flash(x: number, z: number, o: FlashOpts): void {
    const g = this.takeGround();
    g.active = true;
    g.t = 0;
    g.life = o.life ?? 0.25;
    g.kind = 1;
    g.radius = o.radius;
    g.from = 0.6;
    const u = g.mat.uniforms;
    u.uColor.value.set(o.color);
    u.uMode.value = 1;
    g.mesh.position.set(x, o.y ?? 0.08, z);
    g.mesh.rotation.set(0, 0, 0);
    g.mesh.visible = true;
  }

  /** sweeping crescent slash centred on direction (dirX, dirZ) */
  slashArc(x: number, z: number, dirX: number, dirZ: number, o: ArcOpts): void {
    const g = this.takeGround();
    g.active = true;
    g.t = 0;
    g.life = o.life ?? 0.22;
    g.kind = 2;
    g.radius = o.radius;
    g.from = 1;
    const u = g.mat.uniforms;
    u.uColor.value.set(o.color);
    u.uMode.value = 2;
    u.uArc.value = Math.min(Math.PI, o.arc / 2);
    u.uInner.value = Math.max(0.1, 1 - (o.width ?? o.radius * 0.45) / o.radius);
    u.uSweep.value = 0;
    g.mesh.position.set(x, o.y ?? 0.5, z);
    g.mesh.rotation.set(0, Math.atan2(-dirX, -dirZ), 0);
    g.mesh.visible = true;
  }

  /** jagged lightning bolt between two points */
  lightning(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, o: BoltOpts = {}): void {
    let b = this.bolts.find((q) => !q.active);
    if (!b) b = this.bolts[0];
    b.active = true;
    b.t = 0;
    b.life = o.life ?? 0.18;
    b.mat.color.set(o.color ?? "#bfe9ff");
    b.mat.opacity = 1;
    const pos = b.geo.attributes.position.array as Float32Array;
    const w = o.width ?? 0.18;
    const jit = o.jitter ?? 0.35;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    // perpendicular in XZ plane
    const nx = -dz / len;
    const nz = dx / len;
    for (let i = 0; i <= BOLT_SEGS; i++) {
      const t = i / BOLT_SEGS;
      const off = i === 0 || i === BOLT_SEGS ? 0 : (Math.random() - 0.5) * 2 * jit;
      const cx = x1 + dx * t + nx * off;
      const cy = y1 + (y2 - y1) * t + (Math.random() - 0.5) * jit * 0.5;
      const cz = z1 + dz * t + nz * off;
      const ww = w * (1 - Math.abs(t - 0.5) * 0.8);
      const o6 = i * 6;
      pos[o6] = cx - nx * ww;
      pos[o6 + 1] = cy;
      pos[o6 + 2] = cz - nz * ww;
      pos[o6 + 3] = cx + nx * ww;
      pos[o6 + 4] = cy;
      pos[o6 + 5] = cz + nz * ww;
    }
    b.geo.attributes.position.needsUpdate = true;
    b.geo.computeBoundingSphere();
    b.mesh.visible = true;
  }

  burst(x: number, y: number, z: number, o: BurstOpts): void {
    this.particles.burst(x, y, z, o);
  }

  /** composite explosion: flash + ring + sparks + shake */
  explosion(x: number, z: number, radius: number, color: string, shake = 0.25): void {
    this.flash(x, z, { radius: radius * 1.15, color, life: 0.3 });
    this.ring(x, z, { radius, color, life: 0.45, width: radius * 0.3 });
    this.particles.burst(x, 0.4, z, {
      count: Math.min(40, 10 + Math.floor(radius * 6)),
      color,
      speed: radius * 3,
      life: 0.6,
      size: 0.35,
      gravity: -4,
      up: 2,
    });
    if (shake > 0) G.world.shake(shake);
  }

  /** small impact spark at a hit point */
  hitSpark(x: number, y: number, z: number, color = "#ffffff"): void {
    this.particles.burst(x, y, z, { count: 3, color, speed: 4, life: 0.25, size: 0.22 });
  }

  /** called by EnemyManager.kill */
  enemyDeath(x: number, z: number, color: string, scale: number, boss: boolean): void {
    if (boss) {
      this.explosion(x, z, 5, "#ffcf5a", 0.9);
      this.particles.burst(x, 1, z, { count: 60, color: "#ffffff", speed: 9, life: 0.9, size: 0.4, gravity: -6, up: 4 });
      return;
    }
    this.particles.burst(x, 0.6 * scale, z, {
      count: 6,
      color,
      speed: 3.2,
      life: 0.45,
      size: 0.26 * scale,
      gravity: -9,
      up: 3,
      additive: false,
    });
    this.particles.burst(x, 0.7 * scale, z, { count: 2, color: "#ffffff", speed: 2, life: 0.25, size: 0.3 });
  }

  update(dt: number): void {
    for (const g of this.ground) {
      if (!g.active) continue;
      g.t += dt;
      const k = Math.min(1, g.t / g.life);
      const u = g.mat.uniforms;
      if (g.kind === 0) {
        const e = 1 - Math.pow(1 - k, 3);
        const r = g.radius * (g.from + (1 - g.from) * e);
        g.mesh.scale.set(r, 1, r);
        u.uAlpha.value = 1 - k * k;
      } else if (g.kind === 1) {
        const r = g.radius * (g.from + (1 - g.from) * Math.min(1, k * 3));
        g.mesh.scale.set(r, 1, r);
        u.uAlpha.value = (1 - k) * (1 - k) * 1.6;
      } else {
        g.mesh.scale.set(g.radius, 1, g.radius);
        u.uSweep.value = Math.min(1.2, k * 1.8);
        u.uAlpha.value = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
      }
      if (k >= 1) {
        g.active = false;
        g.mesh.visible = false;
      }
    }
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / b.life;
      b.mat.opacity = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
      if (k >= 1) {
        b.active = false;
        b.mesh.visible = false;
      }
    }
    this.particles.update(dt);
    G.perf.particles = this.particles.count;
  }

  clear(): void {
    for (const g of this.ground) {
      g.active = false;
      g.mesh.visible = false;
    }
    for (const b of this.bolts) {
      b.active = false;
      b.mesh.visible = false;
    }
    this.particles.clear();
  }

  /** generic glow sprite texture for weapons that need one */
  static glow(): THREE.Texture {
    return glowTexture();
  }
}
