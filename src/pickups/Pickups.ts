import * as THREE from "three";
import { G } from "../core/G";
import { ModelKit, place, box, sph, cyl, torus, kitToonMaterial } from "../world/ModelKit";
import { uploadInstances, uploadItems } from "../core/gpu";

export type PickupKind = "xp" | "coin" | "heal" | "magnet" | "chest" | "nuke";
const KINDS: PickupKind[] = ["xp", "coin", "heal", "magnet", "chest", "nuke"];
const MAX = 1600;
const MAX_GLOW = 2600;

/** XP gem tiers: min value -> colour & size */
const GEM_TIERS = [
  { min: 0, color: new THREE.Color("#4fc3ff"), scale: 0.8 },
  { min: 5, color: new THREE.Color("#5cff7a"), scale: 1.0 },
  { min: 20, color: new THREE.Color("#ff4f6a"), scale: 1.2 },
  { min: 100, color: new THREE.Color("#c77dff"), scale: 1.45 },
];

/** glow layer modes (see glow shader) */
const GLOW_HALO = 0;
const GLOW_GROUND = 1;
const GLOW_BEAM = 3;
const GLOW_STAR = 4;

const C_COIN = new THREE.Color("#ffd34d");
const C_HEART = new THREE.Color("#ff4d7a");
const C_MAGNET = new THREE.Color("#ff6b6b");
const C_CHEST = new THREE.Color("#ffd34d");
const C_NUKE = new THREE.Color("#ff7a2e");
const C_WHITE = new THREE.Color("#ffffff");

// ------------------------------------------------------------------ geometry

/** six-sided bipyramid crystal with facet shading baked into vertex colours (values > 1 = highlights) */
function gemGeometry(): THREE.BufferGeometry {
  const top = new THREE.ConeGeometry(0.15, 0.17, 6, 1, true);
  top.translate(0, 0.085, 0);
  const bot = new THREE.ConeGeometry(0.15, 0.26, 6, 1, true);
  bot.rotateX(Math.PI);
  bot.translate(0, -0.13, 0);
  const parts = [top.toNonIndexed(), bot.toNonIndexed()];
  top.dispose();
  bot.dispose();
  let n = 0;
  for (const p of parts) n += p.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.getAttribute("position").array as Float32Array, o);
    o += p.getAttribute("position").count * 3;
    p.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals(); // non-indexed -> flat facets
  const nor = geo.getAttribute("normal");
  const col = new Float32Array(n * 3);
  const L = new THREE.Vector3(-0.45, 0.8, 0.55).normalize();
  const V = new THREE.Vector3(0, 0.81, 0.59);
  const nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    nv.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    const diff = Math.max(0, nv.dot(L));
    const spec = Math.pow(Math.max(0, nv.dot(V)), 6);
    const up = pos[i * 3 + 1] > 0 ? 0.25 : 0;
    const shade = 0.45 + diff * 0.75 + spec * 0.6 + up;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

function coinGeometry(): THREE.BufferGeometry {
  const k = new ModelKit();
  k.add(place(cyl(0.2, 0.2, 0.055, 18), 0, 0, 0, Math.PI / 2), "#ffbf1f", { glow: 0.35 });
  k.add(place(cyl(0.14, 0.14, 0.07, 18), 0, 0, 0, Math.PI / 2), "#ffe36b", { glow: 0.45 });
  // embossed diamond mark
  k.add(place(box(0.07, 0.07, 0.08), 0, 0, 0, 0, 0, Math.PI / 4), "#ffbf1f", { glow: 0.35 });
  return k.build();
}

function heartGeometry(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.2);
  sh.bezierCurveTo(0.05, -0.14, 0.24, -0.04, 0.24, 0.08);
  sh.bezierCurveTo(0.24, 0.2, 0.1, 0.24, 0, 0.13);
  sh.bezierCurveTo(-0.1, 0.24, -0.24, 0.2, -0.24, 0.08);
  sh.bezierCurveTo(-0.24, -0.04, -0.05, -0.14, 0, -0.2);
  const ex = new THREE.ExtrudeGeometry(sh, {
    depth: 0.07,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 8,
  });
  ex.translate(0, 0, -0.035);
  const k = new ModelKit();
  k.add(ex, "#ff3d63", { glow: 0.3 });
  k.add(place(sph(0.045, 8, 6), -0.11, 0.1, 0.075, 0, 0, 0, 1, 1.3, 0.5), "#ffffff", { glow: 1 });
  return k.build();
}

function magnetGeometry(): THREE.BufferGeometry {
  const k = new ModelKit();
  k.add(place(torus(0.16, 0.065, 8, 14, Math.PI), 0, 0.03, 0), "#ff3b3b", { glow: 0.25 });
  for (const s of [-1, 1]) {
    k.add(place(cyl(0.065, 0.065, 0.07, 10), 0.16 * s, -0.0, 0), "#ff3b3b", { glow: 0.25 });
    k.add(place(cyl(0.067, 0.067, 0.1, 10), 0.16 * s, -0.085, 0), "#eef3f8", { glow: 0.4 });
  }
  return k.build();
}

function chestGeometry(): THREE.BufferGeometry {
  const k = new ModelKit();
  const wood = "#b8742f";
  const gold = "#ffcc3d";
  k.add(place(box(0.7, 0.34, 0.48), 0, 0.17, 0), wood, { shadeBottom: 0.65, glow: 0.08 });
  k.add(place(box(0.71, 0.02, 0.49), 0, 0.11, 0), "#8a521e");
  // lid: half cylinder along X
  const lid = new THREE.CylinderGeometry(0.24, 0.24, 0.7, 16, 1, false, 0, Math.PI);
  k.add(place(lid, 0, 0.355, 0, 0, 0, Math.PI / 2), "#cf8a3d", { glow: 0.1 });
  // gold bands on base and lid
  for (const s of [-1, 1]) {
    k.add(place(box(0.07, 0.35, 0.5), 0.24 * s, 0.17, 0), gold, { glow: 0.3 });
    const band = new THREE.CylinderGeometry(0.252, 0.252, 0.07, 16, 1, false, 0, Math.PI);
    k.add(place(band, 0.24 * s, 0.355, 0, 0, 0, Math.PI / 2), gold, { glow: 0.3 });
  }
  // glowing seam between lid and base
  k.add(place(box(0.73, 0.03, 0.51), 0, 0.345, 0), "#fff3a8", { glow: 1, outline: false });
  // lock
  k.add(place(box(0.13, 0.15, 0.05), 0, 0.31, 0.255), gold, { glow: 0.4 });
  k.add(place(box(0.03, 0.06, 0.02), 0, 0.3, 0.282), "#3a2410");
  return k.build();
}

function bombGeometry(): THREE.BufferGeometry {
  const k = new ModelKit();
  k.add(place(sph(0.22, 16, 12), 0, 0, 0), "#30355a", { shadeBottom: 0.7 });
  k.add(place(torus(0.215, 0.035, 6, 20), 0, 0, 0, Math.PI / 2 - 0.35, 0, 0.2), "#ff4d4d", { glow: 0.45 });
  k.add(place(sph(0.05, 8, 6), -0.08, 0.1, 0.17, 0, 0, 0, 1, 1.3, 0.6), "#c9d3ff", { glow: 0.6 });
  k.add(place(cyl(0.07, 0.08, 0.08, 10), 0, 0.23, 0), "#9aa0b8");
  k.add(place(torus(0.07, 0.018, 4, 8, Math.PI), 0.07, 0.27, 0, 0, 0, 0), "#d9b37a");
  return k.build();
}

// ------------------------------------------------------------------ glow shader

function glowMaterial(time: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `
      attribute float iMode;
      varying vec3 vCol;
      varying vec2 vUv;
      varying float vMode;
      void main() {
        vec3 c = instanceMatrix[3].xyz;
        vec2 s = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vUv = position.xy * 2.0;
        vMode = iMode;
        vec4 mv;
        if (iMode > 0.5 && iMode < 1.5) {
          mv = viewMatrix * vec4(c + vec3(position.x * s.x, 0.0, -position.y * s.x), 1.0);
        } else if (iMode > 2.5 && iMode < 3.5) {
          // vertical beam that always faces the camera (cylindrical billboard)
          vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
          vec3 wp = c + right * position.x * s.x + vec3(0.0, (position.y + 0.5) * s.y, 0.0);
          mv = viewMatrix * vec4(wp, 1.0);
        } else {
          mv = viewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * s;
        }
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vCol;
      varying vec2 vUv;
      varying float vMode;
      void main() {
        vec2 u = vUv;
        float a;
        vec3 col = vCol;
        if (vMode > 3.5) {
          // 4-point sparkle star
          vec2 q = abs(u);
          float st = max(0.0, 1.0 - (q.x * 7.0 + q.y * 0.9)) + max(0.0, 1.0 - (q.y * 7.0 + q.x * 0.9));
          a = clamp(st, 0.0, 1.0) + exp(-dot(u, u) * 22.0);
          col = mix(vCol, vec3(1.0), 0.6);
        } else if (vMode > 2.5) {
          // beam: soft horizontally, fades out going up, shimmering
          float h = (u.y + 1.0) * 0.5;
          float core = exp(-u.x * u.x * 7.0);
          a = core * (1.0 - h) * (0.75 + 0.25 * sin(uTime * 6.0 + h * 12.0));
          col = mix(vCol, vec3(1.0), core * 0.5);
        } else {
          float d = dot(u, u);
          if (d > 1.0) discard;
          a = exp(-d * 3.5) * (1.0 - d);
          if (vMode > 0.5) a *= 0.75;
        }
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class Pickups {
  n = 0;
  readonly kind = new Uint8Array(MAX);
  readonly x = new Float32Array(MAX);
  readonly z = new Float32Array(MAX);
  readonly value = new Float32Array(MAX);
  /** 0 idle, 1 being pulled to the player */
  readonly pulled = new Uint8Array(MAX);
  readonly speed = new Float32Array(MAX);
  readonly age = new Float32Array(MAX);
  readonly seed = new Float32Array(MAX);

  private meshes: THREE.InstancedMesh[] = [];
  private glow: THREE.InstancedMesh;
  private glowMode: THREE.InstancedBufferAttribute;
  private glowN = 0;
  private readonly time = { value: 0 };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private pv = new THREE.Vector3();
  private sv = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const gemMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const kitMat = kitToonMaterial({ rim: 0.35, rimColor: "#fff3c4" });
    const defs: [THREE.BufferGeometry, THREE.Material, number][] = [
      [gemGeometry(), gemMat, MAX],
      [coinGeometry(), kitMat, 256],
      [heartGeometry(), kitMat, 32],
      [magnetGeometry(), kitMat, 16],
      [chestGeometry(), kitMat, 16],
      [bombGeometry(), kitMat, 16],
    ];
    for (const [geo, mat, cap] of defs) {
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    // gems use instance colours
    const gm = this.meshes[0];
    for (let i = 0; i < MAX; i++) gm.setColorAt(i, this.col.set("#ffffff"));

    const gg = new THREE.PlaneGeometry(1, 1);
    this.glowMode = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOW), 1);
    this.glowMode.setUsage(THREE.DynamicDrawUsage);
    gg.setAttribute("iMode", this.glowMode);
    this.glow = new THREE.InstancedMesh(gg, glowMaterial(this.time), MAX_GLOW);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.setColorAt(0, C_WHITE);
    this.glow.frustumCulled = false;
    this.glow.count = 0;
    this.glow.renderOrder = 2;
    scene.add(this.glow);
  }

  clear(): void {
    this.n = 0;
    for (const m of this.meshes) {
      m.count = 0;
      m.visible = false;
    }
    this.glow.count = 0;
  }

  spawn(kind: PickupKind, x: number, z: number, value: number): number {
    if (this.n >= MAX) {
      if (kind === "xp") return this.mergeInto(x, z, value);
      return -1;
    }
    const i = this.n++;
    this.kind[i] = KINDS.indexOf(kind);
    this.x[i] = x;
    this.z[i] = z;
    this.value[i] = value;
    this.pulled[i] = 0;
    this.speed[i] = 0;
    this.age[i] = 0;
    this.seed[i] = Math.random() * 10;
    return i;
  }

  spawnXp(x: number, z: number, value: number): void {
    // too many gems lying around -> merge into an existing far gem
    if (this.n > 900) {
      this.mergeInto(x, z, value);
      return;
    }
    this.spawn("xp", x, z, value);
  }

  private mergeInto(x: number, z: number, value: number): number {
    // add value to the gem farthest from the player
    let best = -1;
    let bd = -1;
    const px = G.player.x;
    const pz = G.player.z;
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(Math.random() * this.n);
      if (this.kind[i] !== 0 || this.pulled[i]) continue;
      const d = (this.x[i] - px) ** 2 + (this.z[i] - pz) ** 2;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) this.value[best] += value;
    return best;
  }

  /** pull every XP gem to the player */
  vacuum(): void {
    for (let i = 0; i < this.n; i++) if (this.kind[i] === 0) this.pulled[i] = 1;
  }

  update(dt: number): void {
    const p = G.player;
    const mag = p.stats.magnet;
    const mag2 = mag * mag;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      const dx = p.x - this.x[i];
      const dz = p.z - this.z[i];
      const d2 = dx * dx + dz * dz;
      const k = this.kind[i];
      // chests and magnets need to be walked over; others get attracted
      if (!this.pulled[i] && d2 < (k >= 3 ? 0.8 : mag2)) this.pulled[i] = 1;
      if (this.pulled[i]) {
        const d = Math.sqrt(d2) || 0.001;
        this.speed[i] = Math.min(28, this.speed[i] + dt * 40);
        // small hop away first for juice
        const sp = this.age[i] < 0.05 ? -2 : this.speed[i];
        const step = Math.min(d, sp * dt);
        this.x[i] += (dx / d) * step;
        this.z[i] += (dz / d) * step;
        if (d < 0.55) {
          this.collect(i);
          this.removeAt(i);
          i--;
          // a chest opened its screen: leave the rest (e.g. a second chest) for after it closes
          if (G.state !== "playing") break;
        }
      }
    }
  }

  private collect(i: number): void {
    const k = KINDS[this.kind[i]];
    const v = this.value[i];
    const p = G.player;
    switch (k) {
      case "xp":
        p.addXp(v);
        G.audio.sfx("xp");
        break;
      case "coin": {
        const g = Math.max(1, Math.round(v * p.stats.greed * G.mods.gold));
        G.stats.gold += g;
        G.audio.sfx("coin");
        break;
      }
      case "heal":
        p.heal(30);
        G.audio.sfx("heal");
        break;
      case "magnet":
        this.vacuum();
        G.audio.sfx("magnet");
        break;
      case "chest":
        G.audio.sfx("chest");
        G.screens.openChest();
        break;
      case "nuke": {
        G.fx.ring(p.x, p.z, { radius: 14, color: "#ffb347", life: 0.7, width: 2 });
        G.fx.shake(0.8);
        const em = G.enemies;
        for (let e = 0; e < em.n; e++) {
          if (em.state[e] === 0 && !em.isBoss(e) && G.world.onScreen(em.x[e], em.z[e], 1)) em.kill(e, "nuke");
        }
        break;
      }
    }
    G.events.emit("pickup", { kind: k, value: v });
  }

  private removeAt(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.kind[i] = this.kind[l];
    this.x[i] = this.x[l];
    this.z[i] = this.z[l];
    this.value[i] = this.value[l];
    this.pulled[i] = this.pulled[l];
    this.speed[i] = this.speed[l];
    this.age[i] = this.age[l];
    this.seed[i] = this.seed[l];
  }

  // ---------------------------------------------------------------- visuals

  private addGlow(x: number, y: number, z: number, sx: number, sy: number, color: THREE.Color, mode: number, mul = 1): void {
    if (this.glowN >= MAX_GLOW) return;
    const i = this.glowN++;
    this.q.identity();
    this.pv.set(x, y, z);
    this.sv.set(sx, sy, 1);
    this.m.compose(this.pv, this.q, this.sv);
    this.glow.setMatrixAt(i, this.m);
    if (mul === 1) this.glow.setColorAt(i, color);
    else this.glow.setColorAt(i, this.col.copy(color).multiplyScalar(mul));
    this.glowMode.setX(i, mode);
  }

  render(): void {
    for (const m of this.meshes) m.count = 0;
    this.glowN = 0;
    const t = G.realTime;
    this.time.value = t;
    const world = G.world;
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i];
      const px = this.x[i];
      const pz = this.z[i];
      // skip pickups well outside the view (chest beams are tall: bigger margin)
      if (!world.onScreen(px, pz, k === 4 ? 4 : 1.2)) continue;
      const mesh = this.meshes[k];
      if (mesh.count >= mesh.instanceMatrix.count) continue;
      const s = this.seed[i];
      let y = 0.38 + Math.sin(t * 3 + s) * 0.08;
      let sc = 1;
      let yaw = t * 2 + s;
      let pitch = 0;
      // pop-in with a little overshoot
      const age = this.age[i];
      const a = age < 0.25 ? Math.sin(Math.min(1, age * 5) * 1.9) / Math.sin(1.9) : 1;
      const pulled = this.pulled[i] === 1;
      switch (k) {
        case 0: {
          const v = this.value[i];
          let tier = GEM_TIERS[0];
          for (const g of GEM_TIERS) if (v >= g.min) tier = g;
          sc = tier.scale;
          mesh.setColorAt(mesh.count, tier.color);
          const gs = sc * a;
          // soft pool of light under the gem + halo; brief sparkle twinkles
          this.addGlow(px, 0.03, pz, 0.85 * gs, 0.85 * gs, tier.color, GLOW_GROUND, 0.7);
          this.addGlow(px, y, pz, 0.55 * gs, 0.55 * gs, tier.color, GLOW_HALO, 0.55);
          const tw = (t * 0.7 + s * 0.37) % 1.6;
          if (tw < 0.22) {
            const ts = Math.sin((tw / 0.22) * Math.PI) * 0.5 * gs;
            this.addGlow(px + 0.07, y + 0.1, pz, ts, ts, tier.color, GLOW_STAR);
          }
          break;
        }
        case 1: {
          yaw = t * 5 + s;
          sc = 1.05;
          this.addGlow(px, 0.03, pz, 0.8 * a, 0.8 * a, C_COIN, GLOW_GROUND, 0.6);
          // glint when the face turns towards the camera
          const glint = Math.cos(yaw);
          if (glint > 0.93) this.addGlow(px + 0.05, y + 0.08, pz + 0.1, 0.45, 0.45, C_COIN, GLOW_STAR);
          break;
        }
        case 2: {
          yaw = Math.sin(t * 1.5 + s) * 0.6;
          const beat = Math.max(0, Math.sin(t * 7 + s));
          sc = 1.1 + beat * beat * 0.18;
          this.addGlow(px, y, pz, 1.0 * a, 1.0 * a, C_HEART, GLOW_HALO, 0.6 + beat * 0.3);
          this.addGlow(px, 0.03, pz, 1.0 * a, 1.0 * a, C_HEART, GLOW_GROUND, 0.6);
          break;
        }
        case 3: {
          yaw = t * 1.6 + s;
          pitch = 0.3;
          sc = 1.2;
          this.addGlow(px, y, pz, 1.0 * a, 1.0 * a, C_MAGNET, GLOW_HALO, 0.55);
          this.addGlow(px, 0.03, pz, 1.1 * a, 1.1 * a, C_MAGNET, GLOW_GROUND, 0.6);
          break;
        }
        case 4: {
          y = 0.02 + Math.max(0, Math.sin(t * 4 + s)) * 0.06;
          yaw = 0.25;
          sc = 1.2 + Math.sin(t * 5) * 0.04;
          const pulse = 0.75 + Math.sin(t * 3 + s) * 0.25;
          // golden beam visible from far away + ground glow + orbiting sparkles
          this.addGlow(px, 0.0, pz, 0.9, 5.5, C_CHEST, GLOW_BEAM, 0.75 * pulse);
          this.addGlow(px, 0.03, pz, 2.4 * a, 2.4 * a, C_CHEST, GLOW_GROUND, 0.9);
          this.addGlow(px, 0.55, pz, 1.4 * a, 1.4 * a, C_CHEST, GLOW_HALO, 0.5 * pulse);
          for (let j = 0; j < 3; j++) {
            const ang = t * 1.8 + (j * Math.PI * 2) / 3 + s;
            const tw = 0.25 + 0.2 * Math.max(0, Math.sin(t * 6 + j * 2.1));
            this.addGlow(px + Math.cos(ang) * 0.6, 0.5 + Math.sin(t * 2 + j) * 0.25, pz + Math.sin(ang) * 0.45, tw, tw, C_CHEST, GLOW_STAR);
          }
          break;
        }
        case 5: {
          yaw = Math.sin(t * 2 + s) * 0.5;
          sc = 1.15;
          const fl = 0.3 + Math.random() * 0.25;
          // fuse spark flicker (fuse tip in model space ~ (0.14, 0.27) after yaw)
          const fx = Math.cos(yaw) * 0.14 * sc;
          const fz = -Math.sin(yaw) * 0.14 * sc;
          this.addGlow(px + fx, y + 0.31 * sc, pz + fz, fl, fl, C_NUKE, GLOW_STAR);
          this.addGlow(px, y, pz, 1.1 * a, 1.1 * a, C_NUKE, GLOW_HALO, 0.45);
          this.addGlow(px, 0.03, pz, 1.1 * a, 1.1 * a, C_NUKE, GLOW_GROUND, 0.6);
          break;
        }
      }
      if (pulled) sc *= 0.85;
      sc *= a;
      this.e.set(pitch, yaw, 0);
      this.q.setFromEuler(this.e);
      this.pv.set(px, y, pz);
      this.sv.setScalar(Math.max(0.001, sc));
      this.m.compose(this.pv, this.q, this.sv);
      mesh.setMatrixAt(mesh.count++, this.m);
    }
    // upload only the instances written this frame (not the whole capacity)
    for (const m of this.meshes) {
      m.visible = m.count > 0;
      uploadInstances(m);
    }
    this.glow.count = this.glowN;
    this.glow.visible = this.glowN > 0;
    uploadInstances(this.glow);
    uploadItems(this.glowMode, this.glowN);
  }
}
