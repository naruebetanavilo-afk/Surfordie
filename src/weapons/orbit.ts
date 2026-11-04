import * as THREE from "three";
import { G } from "../core/G";
import { hitEnemy } from "../combat/damage";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";

/**
 * ใบเลื่อยวงโคจร (Orbit Saws) — reference for a persistent-mesh weapon.
 * Saws circle the hero for a duration, then rest for a cooldown.
 */
const LV = [
  { n: 2, dmg: 10, r: 2.1, dur: 3.0, cd: 3.2, spd: 3.2 },
  { n: 3, dmg: 10, r: 2.1, dur: 3.0, cd: 3.2, spd: 3.2 },
  { n: 3, dmg: 14, r: 2.4, dur: 3.5, cd: 3.0, spd: 3.4 },
  { n: 4, dmg: 14, r: 2.4, dur: 3.5, cd: 3.0, spd: 3.6 },
  { n: 4, dmg: 18, r: 2.7, dur: 4.0, cd: 2.8, spd: 3.8 },
  { n: 5, dmg: 18, r: 2.7, dur: 4.5, cd: 2.6, spd: 4.0 },
  { n: 5, dmg: 24, r: 3.0, dur: 4.5, cd: 2.4, spd: 4.2 },
  { n: 6, dmg: 30, r: 3.2, dur: 5.0, cd: 2.2, spd: 4.5 },
];

const MAX_SAWS = 12;

class Orbit extends Weapon {
  private mesh: THREE.InstancedMesh;
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

  constructor(def: WeaponDef) {
    super(def);
    const blade = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12);
    const teeth: THREE.BufferGeometry[] = [];
    const mat = new THREE.MeshBasicMaterial({ color: "#e9eef5" });
    this.mesh = new THREE.InstancedMesh(blade, mat, MAX_SAWS);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    void teeth;
    // inner ring tint via a second smaller disk would be another draw; keep it simple
    G.world.scene.add(this.mesh);
  }

  private setEvolvedLook(): void {
    (this.mesh.material as THREE.MeshBasicMaterial).color.set("#ff4f6a");
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
    const n = this.amount(L.n) + (this.evolved ? 2 : 0);
    const r = this.area(L.r);
    this.angle += dt * L.spd * (this.evolved ? 1.3 : 1);
    const now = G.time;
    const dmg = L.dmg * (this.evolved ? 1.5 : 1);
    const scale = this.area(1) * this.appear;
    let count = 0;
    for (let k = 0; k < n && k < MAX_SAWS; k++) {
      const a = this.angle + (k / n) * Math.PI * 2;
      const x = p.x + Math.cos(a) * r * (0.6 + 0.4 * this.appear);
      const z = p.z + Math.sin(a) * r * (0.6 + 0.4 * this.appear);
      if (this.appear > 0.01) {
        this.e.set(0.35, now * 14, 0);
        this.q.setFromEuler(this.e);
        this.v.set(x, 0.75, z);
        this.s.setScalar(scale);
        this.m.compose(this.v, this.q, this.s);
        this.mesh.setMatrixAt(count++, this.m);
      }
      if (this.appear > 0.6) {
        G.enemies.queryCircle(x, z, 0.45 * this.area(1), (i) => {
          const uid = G.enemies.uid[i];
          const last = this.lastHit.get(uid) ?? -9;
          if (now - last < 0.45) return;
          this.lastHit.set(uid, now);
          hitEnemy(i, dmg, this.def.id, { kb: 6, fromX: p.x, fromZ: p.z });
          G.fx.hitSpark(G.enemies.x[i], 0.8, G.enemies.z[i], this.evolved ? "#ff4f6a" : "#ffffff");
        });
        if (Math.random() < dt * 20) {
          G.fx.particles.emit(x, 0.75, z, 0, 0.5, 0, 0.3, 0.3, this.evolved ? "#ff4f6a" : "#9fd8ff");
        }
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.lastHit.size > 2000) this.lastHit.clear();
  }

  dispose(): void {
    G.world.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

export const orbitDef: WeaponDef = {
  id: "orbit",
  name: "ใบเลื่อยวงโคจร",
  maxLevel: 8,
  color: "#e9eef5",
  icon: (c, s) => {
    iconBg(c, s, "#9fd8ff");
    c.save();
    c.translate(s / 2, s / 2);
    c.fillStyle = "#e9eef5";
    c.strokeStyle = "#0d0f14";
    c.lineWidth = s * 0.035;
    c.beginPath();
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? s * 0.3 : s * 0.22;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = "#5a6474";
    c.beginPath();
    c.arc(0, 0, s * 0.08, 0, Math.PI * 2);
    c.fill();
    c.restore();
  },
  describe: (l) =>
    [
      "ใบเลื่อย 2 ใบหมุนรอบตัว บดขยี้ศัตรูที่เข้าใกล้",
      "ใบเลื่อย +1",
      "ดาเมจ +40% • รัศมีและระยะเวลาเพิ่ม",
      "ใบเลื่อย +1 • หมุนเร็วขึ้น",
      "ดาเมจ +30% • รัศมีและระยะเวลาเพิ่ม",
      "ใบเลื่อย +1 • ระยะเวลา +0.5 วิ",
      "ดาเมจ +33% • รัศมีเพิ่ม",
      "ใบเลื่อย +1 • ดาเมจ +25%",
    ][l - 1] ?? "",
  lines: (l) => {
    if (l === 1) return ["ใบเลื่อย x2"];
    const a = LV[l - 2];
    const b = LV[l - 1];
    const out: string[] = [];
    if (b.n !== a.n) out.push(`ใบเลื่อย +${b.n - a.n}`);
    if (b.dmg !== a.dmg) out.push(`ดาเมจ +${Math.round((b.dmg / a.dmg - 1) * 100)}%`);
    if (b.spd !== a.spd) out.push(`สปีดหมุน +${Math.round((b.spd / a.spd - 1) * 100)}%`);
    return out;
  },
  evolution: {
    requires: "haste",
    name: "วงจักรนิรันดร์",
    describe: "ใบเลื่อยหมุนตลอดเวลาไม่มีพัก ดาเมจ +50% และเพิ่มอีก 2 ใบ",
  },
  create: () => new Orbit(orbitDef),
};
