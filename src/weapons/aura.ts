import * as THREE from "three";
import { G } from "../core/G";
import { hitEnemy } from "../combat/damage";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { VFX, col, SPARK_EMBER, SPARK_STAR, SPARK_GLOW, DECAL_SHOCK, DECAL_GLOW } from "./vfx";
import { SpriteBatch } from "./vfx/SpriteBatch";
import { softGlowTex } from "./vfx/textures";
import { levelLines } from "./util";
import { evolvedFrame, glow, star4 } from "./iconkit";

/**
 * วงเพลิงนรก (Hellfire Circle) — a permanent ring of fire around the hero
 * (animated ground decal + a low wall of flame tongues). Burns everything
 * inside on a tick and slows it; fire wisps (one per "amount") circle the rim.
 * Evolved (สุริยะแผดเผา): a blazing sun ring — bigger, hotter, emits solar
 * flares that blast enemies away, and every burning tick mends the hero.
 */
const LV = [
  { r: 1.9, dmg: 6, tick: 0.5, slow: 0.8, w: 0 },
  { r: 2.1, dmg: 8, tick: 0.5, slow: 0.8, w: 0 },
  { r: 2.3, dmg: 8, tick: 0.45, slow: 0.75, w: 1 },
  { r: 2.5, dmg: 11, tick: 0.45, slow: 0.75, w: 1 },
  { r: 2.7, dmg: 11, tick: 0.4, slow: 0.7, w: 2 },
  { r: 2.9, dmg: 15, tick: 0.4, slow: 0.7, w: 2 },
  { r: 3.1, dmg: 15, tick: 0.35, slow: 0.65, w: 3 },
  { r: 3.4, dmg: 20, tick: 0.35, slow: 0.6, w: 3 },
];

const NOISE = /* glsl */ `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 + 1.7) * 0.1; }
`;

const ringVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ringFrag = /* glsl */ `
uniform float uTime;
uniform float uEvo;
uniform float uFlash;
uniform float uS;
uniform float uRing;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHot;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // work in world units so the band keeps its thickness at any radius
  vec2 w = p * uS;
  float rr = r * uS;
  float a = atan(p.y, p.x);
  vec2 dir = p / max(r, 1e-3);
  float n = fbm(w * 1.3 - dir * uTime * 1.6 + vec2(uTime * 0.2, 0.0));
  float n2 = fbm(w * 2.4 + dir * uTime * 0.8);
  float d = rr - uRing;
  float band = exp(-pow(d / 0.2, 2.0));
  float tongues = smoothstep(0.42, 0.85, n) * smoothstep(-1.2, -0.1, d) * (1.0 - smoothstep(0.15, 0.6, d));
  float haze = smoothstep(0.0, uRing, rr) * (1.0 - smoothstep(-0.1, 0.3, d)) * (0.12 + 0.08 * n2);
  float runes = step(0.55, fract(a / 6.2831853 * floor(uRing * 6.0) + uTime * 0.12)) * exp(-pow((rr - (uRing - 0.7)) / 0.06, 2.0)) * 0.55;
  float rays = 0.0;
  if (uEvo > 0.5) {
    rays = pow(abs(cos(a * 9.0 + uTime * 0.6)), 14.0) * smoothstep(-1.4, -0.2, d) * (1.0 - smoothstep(0.0, 0.5, d)) * 0.8;
    runes *= 1.3;
    haze *= 0.6;
  }
  float i = band * (1.0 + 0.4 * n) + tongues * 1.1 + haze + runes + rays + uFlash * smoothstep(0.0, uRing, rr) * (1.0 - smoothstep(0.0, 0.4, d)) * 0.6;
  i *= 1.0 - smoothstep(0.9, 1.0, r);
  vec3 c = mix(uDeep, uMid, clamp(band + tongues * n * 1.4 + rays, 0.0, 1.0));
  c = mix(c, uHot, clamp(band * band * (0.4 + n) + runes + uFlash * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(c * i, clamp(i * 0.75, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

const wallVert = /* glsl */ `
varying vec2 vUv;
varying float vAng;
void main() {
  vUv = uv;
  vAng = atan(position.z, position.x);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const wallFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHot;
varying vec2 vUv;
varying float vAng;
${NOISE}
void main() {
  float h = vUv.y;
  vec2 q = vec2(cos(vAng), sin(vAng)) * 3.2;
  float n = fbm(vec2(q.x + uTime * 0.4, q.y + h * 2.2 - uTime * 3.0));
  float n2 = vnoise(vec2(q.y * 2.0 - uTime, q.x * 2.0 + h * 4.0 - uTime * 4.5));
  float flame = smoothstep(0.0, 0.22, (n * 0.9 + n2 * 0.35) - h * 1.05);
  float i = flame * (1.0 - h * 0.4) * 1.25;
  vec3 c = mix(uHot, uMid, smoothstep(0.0, 0.45, h));
  c = mix(c, uDeep, smoothstep(0.35, 0.9, h));
  gl_FragColor = vec4(c * i, clamp(i * 0.6, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

class Aura extends Weapon {
  private ring: THREE.Mesh | null = null;
  private wall: THREE.Mesh | null = null;
  private ringMat: THREE.ShaderMaterial | null = null;
  private wallMat: THREE.ShaderMaterial | null = null;
  private halo: SpriteBatch | null = null;
  private core: SpriteBatch | null = null;
  private t = 0;
  private wispA = 0;
  private flareT = 2;
  private flash = 0;
  private radius = 1.9;
  private hits: number[] = [];
  private readonly collect = (i: number): void => {
    this.hits.push(i);
  };
  private wispLast = new Map<number, number>();
  private wispDmg = 0;
  private readonly wispCb = (i: number): void => {
    const uid = G.enemies.uid[i];
    const last = this.wispLast.get(uid) ?? -9;
    if (G.time - last < 0.5) return;
    this.wispLast.set(uid, G.time);
    hitEnemy(i, this.wispDmg, this.def.id, { kb: 4, color: "#ffb35a" });
  };
  private burnSfx = 0;

  private ensure(): void {
    if (this.ring) return;
    const uni = () => ({
      uTime: { value: 0 },
      uEvo: { value: 0 },
      uFlash: { value: 0 },
      uS: { value: 2 },
      uRing: { value: 1.7 },
      uDeep: { value: new THREE.Color("#a3180a") },
      uMid: { value: new THREE.Color("#ff6a1a") },
      uHot: { value: new THREE.Color("#ffd36b") },
    });
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      uniforms: uni(),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    });
    const rg = new THREE.PlaneGeometry(2, 2);
    rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 3;
    this.wallMat = new THREE.ShaderMaterial({
      vertexShader: wallVert,
      fragmentShader: wallFrag,
      uniforms: uni(),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    });
    const wg = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true);
    wg.translate(0, 0.5, 0);
    this.wall = new THREE.Mesh(wg, this.wallMat);
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 4;
    G.world.scene.add(this.ring, this.wall);
    this.halo = new SpriteBatch(G.world.scene, softGlowTex(), 16, { facing: "camera", additive: false, renderOrder: 9 });
    this.core = new SpriteBatch(G.world.scene, softGlowTex(), 16, { facing: "camera", additive: true, renderOrder: 10 });
    this.applyLook();
  }

  private applyLook(): void {
    if (!this.ringMat || !this.wallMat) return;
    const ev = this.evolved;
    for (const m of [this.ringMat, this.wallMat]) {
      const u = m.uniforms;
      u.uEvo.value = ev ? 1 : 0;
      (u.uDeep.value as THREE.Color).set(ev ? "#ff7a00" : "#a3180a");
      (u.uMid.value as THREE.Color).set(ev ? "#ffc21f" : "#ff6a1a");
      (u.uHot.value as THREE.Color).set(ev ? "#fffbe0" : "#ffd36b");
    }
  }

  onEvolve(): void {
    this.applyLook();
    this.flareT = 0.2;
  }

  update(dt: number): void {
    this.ensure();
    const L = LV[this.level - 1];
    const p = G.player;
    const ev = this.evolved;
    this.t += dt;
    const R = this.area(L.r) * (ev ? 1.35 : 1);
    // grow/shrink smoothly when the radius changes
    this.radius += (R - this.radius) * Math.min(1, dt * 4);
    const r = this.radius;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.ring!.position.set(p.x, 0.06, p.z);
    const S = r + 0.8;
    this.ring!.scale.setScalar(S);
    this.ringMat!.uniforms.uS.value = S;
    this.ringMat!.uniforms.uRing.value = r * 0.92;
    this.wall!.position.set(p.x, 0, p.z);
    this.wall!.scale.set(r * 0.92, ev ? 0.95 : 0.65, r * 0.92);
    this.ringMat!.uniforms.uTime.value = this.t;
    this.ringMat!.uniforms.uFlash.value = this.flash;
    this.wallMat!.uniforms.uTime.value = this.t;

    // burn tick
    this.timer -= dt;
    this.burnSfx -= dt;
    if (this.timer <= 0) {
      this.timer = Math.max(0.15, this.cd(L.tick));
      this.hits.length = 0;
      G.enemies.queryCircle(p.x, p.z, r * 0.92, this.collect);
      const many = this.hits.length > 10;
      const dmg = L.dmg * (ev ? 1.5 : 1);
      for (const i of this.hits) {
        hitEnemy(i, dmg, this.def.id, {
          slow: L.slow,
          slowTime: 0.6,
          color: "#ffb35a",
          // keep the number spam readable in big crowds
          silent: many && Math.random() < 0.5,
        });
      }
      if (this.hits.length) {
        if (this.burnSfx <= 0) {
          G.audio.sfx("burn", { vol: 0.35 });
          this.burnSfx = 0.6;
        }
        if (ev) G.player.heal(Math.min(1.5, 0.3 + this.hits.length * 0.05));
      }
    }
    // embers rising from the rim
    const sp = VFX.sparkles;
    const emberRate = r * (ev ? 26 : 16);
    let ne = emberRate * dt;
    while (ne > 0) {
      if (ne < 1 && Math.random() > ne) break;
      ne -= 1;
      const a = Math.random() * Math.PI * 2;
      const rr = r * (0.75 + Math.random() * 0.2);
      sp.spawn(p.x + Math.cos(a) * rr, 0.2, p.z + Math.sin(a) * rr, Math.cos(a) * 0.4, 1.4 + Math.random() * 1.6, Math.sin(a) * 0.4, 0.7, 0.32, col(Math.random() < 0.5 ? (ev ? "#ffd23f" : "#ff8a2a") : ev ? "#fff3b0" : "#ffc15a"), SPARK_EMBER, 0.6, 0.6);
    }
    this.updateWisps(dt, L, r);
    if (ev) this.updateFlare(dt, r, L.dmg * 1.5);
    if (this.wispLast.size > 3000) this.wispLast.clear();
  }

  private updateWisps(dt: number, L: (typeof LV)[number], r: number): void {
    const n = this.amount(L.w);
    const halo = this.halo!;
    const core = this.core!;
    halo.begin();
    core.begin();
    if (n > 0) {
      const p = G.player;
      const ev = this.evolved;
      this.wispA += dt * 2.4;
      this.wispDmg = L.dmg * 1.6 * (ev ? 1.5 : 1);
      const hc = col(ev ? "#ff9a1f" : "#ff4a12");
      const cc = col(ev ? "#fff6c8" : "#ffd27a");
      for (let k = 0; k < n; k++) {
        const a = this.wispA + (k / n) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r * 0.86;
        const z = p.z + Math.sin(a) * r * 0.86;
        const y = 0.7 + Math.sin(this.t * 6 + k) * 0.12;
        const fl = 1 + 0.15 * Math.sin(this.t * 25 + k * 3);
        halo.add(x, y, z, 1.25 * fl, hc, 1);
        core.add(x, y, z, 0.6 * fl, cc, 1);
        G.enemies.queryCircle(x, z, 0.6, this.wispCb);
        if (Math.random() < dt * 30) {
          VFX.sparkles.spawn(x, y, z, -Math.sin(a) * -1.5, 0.8, Math.cos(a) * -1.5, 0.35, 0.45, hc, SPARK_GLOW, 1, 2);
        }
      }
    }
    halo.end();
    core.end();
  }

  private updateFlare(dt: number, r: number, dmg: number): void {
    this.flareT -= dt;
    if (this.flareT > 0) return;
    this.flareT = this.cd(2.6);
    const p = G.player;
    const R = r * 1.35;
    this.hits.length = 0;
    G.enemies.queryCircle(p.x, p.z, R, this.collect);
    for (const i of this.hits) hitEnemy(i, dmg * 3, this.def.id, { kb: 11, fromX: p.x, fromZ: p.z, color: "#ffe066" });
    this.flash = 1;
    VFX.decals.spawn(p.x, p.z, R * 1.1, 0.55, col("#fff3b0"), DECAL_SHOCK, 1.2, 0, 0.25, 0.9);
    VFX.decals.spawn(p.x, p.z, R * 0.95, 0.5, col("#ff9a1f"), DECAL_SHOCK, 0.8, 0, 0.15, 0.8);
    VFX.decals.spawn(p.x, p.z, R, 0.3, col("#ffc21f"), DECAL_GLOW, 0.45, 0, 0.6, 0.2);
    VFX.sparkles.burst(p.x, 0.6, p.z, 10, R * 2.5, 3, 0.55, 0.9, col("#ffffff"), SPARK_STAR, -5, 2, R);
    VFX.sparkles.burst(p.x, 0.4, p.z, 18, R * 3, 2, 0.6, 0.5, col("#ffc21f"), SPARK_GLOW, -2, 2.5, R * 0.8);
    G.player.heal(G.player.stats.maxHp * 0.02);
    G.world.shake(0.2);
    G.audio.sfx("burn", { vol: 0.8, pitch: 0.7 });
  }

  dispose(): void {
    super.dispose();
    if (this.ring) {
      G.world.scene.remove(this.ring, this.wall!);
      this.ring.geometry.dispose();
      this.wall!.geometry.dispose();
      this.ringMat!.dispose();
      this.wallMat!.dispose();
      this.ring = null;
      this.wall = null;
    }
    this.halo?.dispose();
    this.core?.dispose();
    this.halo = null;
    this.core = null;
  }
}

function drawAura(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  iconBg(c, s, evolved ? "#ffc21f" : "#ff6a1a", evolved ? "#241a0c" : "#22140f");
  const cx = s / 2;
  const cy = s * 0.55;
  glow(c, cx, cy, s * 0.42, evolved ? "rgba(255,194,31,0.7)" : "rgba(255,90,20,0.7)");
  // ring of flame tongues
  c.save();
  c.translate(cx, cy);
  c.scale(1, 0.62);
  const tongues = 14;
  for (let k = 0; k < tongues; k++) {
    const a = (k / tongues) * Math.PI * 2;
    const x = Math.cos(a) * s * 0.3;
    const y = Math.sin(a) * s * 0.3;
    const h = s * (0.13 + 0.06 * Math.sin(k * 2.3));
    const g = c.createLinearGradient(x, y, x, y - h * 1.6);
    g.addColorStop(0, evolved ? "#fffbe0" : "#ffd36b");
    g.addColorStop(0.5, evolved ? "#ffc21f" : "#ff6a1a");
    g.addColorStop(1, evolved ? "rgba(255,140,0,0)" : "rgba(163,24,10,0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x - s * 0.045, y);
    c.quadraticCurveTo(x - s * 0.02, y - h, x + s * 0.01, y - h * 1.6);
    c.quadraticCurveTo(x + s * 0.03, y - h * 0.8, x + s * 0.045, y);
    c.closePath();
    c.fill();
  }
  c.lineWidth = s * 0.05;
  c.strokeStyle = evolved ? "#fff3b0" : "#ffb35a";
  c.beginPath();
  c.arc(0, 0, s * 0.3, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  if (evolved) {
    // sun core
    const g = c.createRadialGradient(cx, cy - s * 0.04, 0, cx, cy - s * 0.04, s * 0.13);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, "#fff3b0");
    g.addColorStop(1, "#ffc21f");
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy - s * 0.04, s * 0.12, 0, Math.PI * 2);
    c.fill();
    evolvedFrame(c, s);
  } else {
    star4(c, s * 0.78, s * 0.24, s * 0.06, "#ffe0a8");
  }
}

export const auraDef: WeaponDef = {
  id: "aura",
  name: "วงเพลิงนรก",
  maxLevel: 8,
  color: "#ff7a3c",
  icon: (c, s) => drawAura(c, s, false),
  describe: (l) =>
    [
      "วงไฟรอบตัวเผาศัตรูที่อยู่ใกล้อย่างต่อเนื่อง และทำให้ช้าลง",
      "ดาเมจ +33% • วงไฟกว้างขึ้น",
      "ดวงไฟวิญญาณ +1 วนรอบขอบวง • เผาถี่ขึ้น",
      "ดาเมจ +38% • วงไฟกว้างขึ้น",
      "ดวงไฟวิญญาณ +1 • เผาถี่ขึ้น • ช้าลงมากขึ้น",
      "ดาเมจ +36% • วงไฟกว้างขึ้น",
      "ดวงไฟวิญญาณ +1 • เผาถี่ขึ้น",
      "ดาเมจ +33% • วงไฟกว้างขึ้น • ช้าลงมากขึ้น",
    ][l - 1] ?? "",
  lines: (l) =>
    levelLines(
      LV,
      l,
      [
        { key: "w", label: "ดวงไฟ", kind: "add" },
        { key: "dmg", label: "ดาเมจ", kind: "pct" },
        { key: "r", label: "ขอบเขต", kind: "pct" },
        { key: "tick", label: "สปีดเผา", kind: "cd" },
      ],
      ["ดาเมจ " + LV[0].dmg + "/ครั้ง", "ทำให้ศัตรูช้าลง"],
    ),
  evolution: {
    requires: "regen",
    name: "สุริยะแผดเผา",
    describe: "วงไฟกลายเป็นดวงอาทิตย์ กว้างขึ้น 35% ดาเมจ +50% ปล่อยเปลวสุริยะผลักศัตรูกระเด็น และทุกการเผาช่วยฟื้นพลังชีวิต",
    icon: (c, s) => drawAura(c, s, true),
  },
  create: () => new Aura(auraDef),
};
