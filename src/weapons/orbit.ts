import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { G } from "../core/G";
import { hitEnemy } from "../combat/damage";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { VFX, col, SPARK_STAR } from "./vfx";
import { weaponToonRamp, paint, prep } from "./vfx/toon";
import { levelLines, liveSlot } from "./util";
import { evolvedFrame, glow, INK } from "./iconkit";

/**
 * ใบเลื่อยวงโคจร (Orbit Saws) — reference for a persistent-mesh weapon.
 * Toothed saw blades circle the hero for a duration (with glowing motion
 * trails), then rest for a cooldown. Evolved (วงจักรนิรันดร์): never rest,
 * +2 blades, crimson, +50% damage.
 */
const LV = [
  { n: 2, dmg: 10, r: 2.1, dur: 3.0, cd: 3.2, spd: 3.2 },
  { n: 3, dmg: 10, r: 2.1, dur: 3.0, cd: 3.2, spd: 3.2 },
  { n: 3, dmg: 14, r: 2.4, dur: 3.5, cd: 3.0, spd: 3.4 },
  { n: 4, dmg: 14, r: 2.4, dur: 3.5, cd: 3.0, spd: 3.6 },
  { n: 4, dmg: 18, r: 2.7, dur: 4.0, cd: 2.8, spd: 3.8 },
  { n: 5, dmg: 18, r: 2.7, dur: 4.5, cd: 2.6, spd: 4.0 },
  { n: 5, dmg: 25, r: 3.0, dur: 4.5, cd: 2.4, spd: 4.2 },
  { n: 6, dmg: 34, r: 3.2, dur: 5.0, cd: 2.2, spd: 4.5 },
];

const MAX_SAWS = 14;
const TRAIL_SEG = 18;

/** toothed circular saw lying flat (XZ), radius ≈ 0.46 */
function sawGeometry(): THREE.BufferGeometry {
  const teeth = 14;
  const R = 0.46;
  const Rin = 0.35;
  const sh = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.62) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    // hooked tooth: rise to the tip, then drop back to the gullet
    if (i === 0) sh.moveTo(Math.cos(a0) * Rin, Math.sin(a0) * Rin);
    sh.quadraticCurveTo(Math.cos(a0 + 0.08) * R * 0.92, Math.sin(a0 + 0.08) * R * 0.92, Math.cos(a1) * R, Math.sin(a1) * R);
    sh.lineTo(Math.cos(a2) * Rin, Math.sin(a2) * Rin);
  }
  sh.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.07, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 3 });
  blade.translate(0, 0, -0.0225);
  blade.rotateX(-Math.PI / 2);
  const bp = prep(blade);
  const pos = bp.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const edge = new THREE.Color("#ffffff");
  const steel = new THREE.Color("#b8c3d2");
  const inner = new THREE.Color("#7d889b");
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    if (r > 0.33) tmp.copy(steel).lerp(edge, Math.min(1, (r - 0.33) / 0.1));
    else if (r > 0.24) tmp.copy(steel);
    else tmp.copy(inner);
    cols[i * 3] = tmp.r;
    cols[i * 3 + 1] = tmp.g;
    cols[i * 3 + 2] = tmp.b;
  }
  bp.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  const hub = prep(paint(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 12), "#3d4558"));
  const cap = prep(paint(new THREE.CylinderGeometry(0.075, 0.075, 0.11, 8), "#ffcc4d"));
  // decorative slots between hub and teeth
  const slots: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.BoxGeometry(0.05, 0.06, 0.14).translate(0, 0, 0.22).rotateY((k / 3) * Math.PI * 2);
    slots.push(prep(paint(g, "#4c566a")));
  }
  const g = mergeGeometries([bp, hub, cap, ...slots], false)!;
  g.computeVertexNormals();
  return g;
}

const trailVert = /* glsl */ `
attribute float aAngle;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uWidth;
uniform float uArc;
uniform float uY;
varying vec2 vP;
void main() {
  // position.x: 0..1 along the trail (0 = at the saw), position.y: -1..1 across
  float u = position.x;
  float a = aAngle - u * uArc;
  float r = uRadius + position.y * uWidth * (1.0 - u * 0.6);
  vec3 wp = uCenter + vec3(cos(a) * r, uY, sin(a) * r);
  vP = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const trailFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vP;
void main() {
  float along = pow(1.0 - vP.x, 1.6);
  float across = 1.0 - abs(vP.y);
  float i = along * pow(across, 0.7) * uAlpha;
  vec3 c = mix(uColor, vec3(1.0), along * across * 0.5);
  gl_FragColor = vec4(c * i, clamp(i * 0.5, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

class Orbit extends Weapon {
  private mesh: THREE.InstancedMesh;
  private trail: THREE.Mesh;
  private trailGeo: THREE.InstancedBufferGeometry;
  private trailMat: THREE.ShaderMaterial;
  private angleAttr: THREE.InstancedBufferAttribute;
  private active = true;
  private phaseT = 0;
  private angle = 0;
  private appear = 0;
  private lastHit = new Map<number, number>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private hitDmg = 0;
  private readonly hitCb = (i: number): void => {
    if (!liveSlot(i)) return;
    const uid = G.enemies.uid[i];
    const now = G.time;
    const last = this.lastHit.get(uid) ?? -9;
    if (now - last < 0.45) return;
    this.lastHit.set(uid, now);
    const p = G.player;
    hitEnemy(i, this.hitDmg, this.def.id, { kb: 6, fromX: p.x, fromZ: p.z });
    const ex = G.enemies.x[i];
    const ez = G.enemies.z[i];
    G.fx.hitSpark(ex, 0.8, ez, this.evolved ? "#ff4f6a" : "#ffffff");
    if (Math.random() < 0.35) VFX.sparkles.spawn(ex, 0.9, ez, 0, 1, 0, 0.25, 0.6, col("#ffffff"), SPARK_STAR, 0, 0, 4);
  };

  constructor(def: WeaponDef) {
    super(def);
    const mat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: weaponToonRamp(),
      emissive: new THREE.Color("#1c2230"),
    });
    this.mesh = new THREE.InstancedMesh(sawGeometry(), mat, MAX_SAWS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    G.world.scene.add(this.mesh);

    // motion trails: one instanced strip per saw, shaped in the vertex shader
    const strip = new THREE.PlaneGeometry(1, 2, TRAIL_SEG, 1);
    strip.translate(0.5, 0, 0);
    const tg = new THREE.InstancedBufferGeometry();
    tg.index = strip.index;
    tg.setAttribute("position", strip.getAttribute("position"));
    this.angleAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SAWS), 1);
    this.angleAttr.setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute("aAngle", this.angleAttr);
    tg.instanceCount = 0;
    this.trailGeo = tg;
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: trailVert,
      fragmentShader: trailFrag,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uRadius: { value: 2 },
        uWidth: { value: 0.3 },
        uArc: { value: 1 },
        uY: { value: 0.72 },
        uColor: { value: new THREE.Color("#9fd8ff") },
        uAlpha: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    });
    this.trail = new THREE.Mesh(tg, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 6;
    G.world.scene.add(this.trail);
  }

  private setEvolvedLook(): void {
    (this.mesh.material as THREE.MeshToonMaterial).color.set("#ff8a96");
    (this.mesh.material as THREE.MeshToonMaterial).emissive.set("#5a0a14");
    (this.trailMat.uniforms.uColor.value as THREE.Color).set("#ff4f6a");
  }

  onEvolve(): void {
    this.setEvolvedLook();
  }

  update(dt: number): void {
    const L = LV[this.level - 1];
    const p = G.player;
    this.phaseT += dt;
    const permanent = this.evolved;
    if (!permanent) {
      if (this.active && this.phaseT >= this.duration(L.dur)) {
        this.active = false;
        this.phaseT = 0;
      } else if (!this.active && this.phaseT >= this.cd(L.cd)) {
        this.active = true;
        this.phaseT = 0;
        G.audio.sfx("whoosh");
      }
    } else this.active = true;

    this.appear += (this.active ? 1 : -1) * dt * 5;
    this.appear = Math.max(0, Math.min(1, this.appear));
    const n = Math.min(MAX_SAWS, this.amount(L.n) + (this.evolved ? 2 : 0));
    const r = this.area(L.r);
    const spd = L.spd * (this.evolved ? 1.3 : 1);
    this.angle += dt * spd;
    const now = G.time;
    this.hitDmg = L.dmg * (this.evolved ? 1.5 : 1);
    const scale = this.area(1) * this.appear;
    const rr = r * (0.6 + 0.4 * this.appear);
    let count = 0;
    const ang = this.angleAttr.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const a = this.angle + (k / n) * Math.PI * 2;
      const x = p.x + Math.cos(a) * rr;
      const z = p.z + Math.sin(a) * rr;
      if (this.appear > 0.01) {
        this.e.set(0.35, -now * 14, 0);
        this.q.setFromEuler(this.e);
        this.v.set(x, 0.75, z);
        this.s.setScalar(scale * 1.15);
        this.m.compose(this.v, this.q, this.s);
        this.mesh.setMatrixAt(count, this.m);
        ang[count] = a;
        count++;
      }
      if (this.appear > 0.6) {
        G.enemies.queryCircle(x, z, 0.5 * this.area(1), this.hitCb);
      }
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    this.trail.visible = count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    // trails
    const u = this.trailMat.uniforms;
    (u.uCenter.value as THREE.Vector3).set(p.x, 0, p.z);
    u.uRadius.value = rr;
    u.uWidth.value = 0.32 * this.area(1);
    // a longer smear when spinning faster, never wrapping into the next saw
    u.uArc.value = Math.min(((Math.PI * 2) / Math.max(1, n)) * 0.8, 0.22 * spd);
    u.uAlpha.value = this.appear * (this.evolved ? 1 : 0.85);
    this.trailGeo.instanceCount = count;
    this.angleAttr.needsUpdate = true;
    if (this.lastHit.size > 2000) this.lastHit.clear();
  }

  dispose(): void {
    super.dispose();
    G.world.scene.remove(this.mesh, this.trail);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.trailGeo.dispose();
    this.trailMat.dispose();
  }
}

function drawSaw(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  iconBg(c, s, evolved ? "#ff4f6a" : "#9fd8ff", evolved ? "#241018" : "#1b1f2a");
  c.save();
  c.translate(s / 2, s / 2);
  // motion smear
  c.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    c.strokeStyle = evolved ? `rgba(255,79,106,${0.7 - k * 0.2})` : `rgba(159,216,255,${0.7 - k * 0.2})`;
    c.lineWidth = s * (0.06 - k * 0.015);
    c.beginPath();
    c.arc(0, 0, s * (0.37 + k * 0.025), Math.PI * (0.15 + k * 0.1), Math.PI * (0.85 + k * 0.05));
    c.stroke();
  }
  if (evolved) glow(c, 0, 0, s * 0.36, "rgba(255,79,106,0.6)");
  const teeth = 12;
  c.fillStyle = evolved ? "#ffc2ca" : "#e9eef5";
  c.strokeStyle = INK;
  c.lineWidth = s * 0.035;
  c.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.62) / teeth) * Math.PI * 2;
    if (i === 0) c.moveTo(Math.cos(a0) * s * 0.23, Math.sin(a0) * s * 0.23);
    c.lineTo(Math.cos(a1) * s * 0.31, Math.sin(a1) * s * 0.31);
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    c.lineTo(Math.cos(a2) * s * 0.23, Math.sin(a2) * s * 0.23);
  }
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = evolved ? "#8a2a3a" : "#7d889b";
  c.beginPath();
  c.arc(0, 0, s * 0.15, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#ffcc4d";
  c.beginPath();
  c.arc(0, 0, s * 0.06, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.restore();
  if (evolved) evolvedFrame(c, s);
}

export const orbitDef: WeaponDef = {
  id: "orbit",
  name: "ใบเลื่อยวงโคจร",
  maxLevel: 8,
  color: "#e9eef5",
  icon: (c, s) => drawSaw(c, s, false),
  describe: (l) =>
    [
      "ใบเลื่อย 2 ใบหมุนรอบตัว บดขยี้ศัตรูที่เข้าใกล้",
      "ใบเลื่อย +1",
      "ดาเมจ +40% • รัศมีและระยะเวลาเพิ่ม",
      "ใบเลื่อย +1 • หมุนเร็วขึ้น",
      "ดาเมจ +30% • รัศมีและระยะเวลาเพิ่ม",
      "ใบเลื่อย +1 • ระยะเวลา +0.5 วิ",
      "ดาเมจ +39% • รัศมีเพิ่ม",
      "ใบเลื่อย +1 • ดาเมจ +36%",
    ][l - 1] ?? "",
  lines: (l) =>
    levelLines(
      LV,
      l,
      [
        { key: "n", label: "ใบเลื่อย", kind: "add" },
        { key: "dmg", label: "ดาเมจ", kind: "pct" },
        { key: "r", label: "ขอบเขต", kind: "pct" },
        { key: "spd", label: "สปีดหมุน", kind: "pct" },
      ],
      ["ใบเลื่อย x2"],
    ),
  evolution: {
    requires: "haste",
    name: "วงจักรนิรันดร์",
    describe: "ใบเลื่อยหมุนตลอดเวลาไม่มีพัก ดาเมจ +50% และเพิ่มอีก 2 ใบ",
    icon: (c, s) => drawSaw(c, s, true),
  },
  create: () => new Orbit(orbitDef),
};
