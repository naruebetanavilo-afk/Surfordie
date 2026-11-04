import * as THREE from "three";
import { G } from "../core/G";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { glowTexture } from "../fx/textures";

/**
 * ลูกไฟวิญญาณ (Spirit Missile) — reference for a projectile weapon.
 * Fires homing spirit bolts at the nearest enemies.
 */
const LV = [
  { n: 1, dmg: 12, cd: 1.0, pierce: 0, spd: 11 },
  { n: 2, dmg: 12, cd: 1.0, pierce: 0, spd: 11 },
  { n: 2, dmg: 16, cd: 0.95, pierce: 1, spd: 12 },
  { n: 3, dmg: 16, cd: 0.9, pierce: 1, spd: 12 },
  { n: 3, dmg: 22, cd: 0.85, pierce: 2, spd: 13 },
  { n: 4, dmg: 22, cd: 0.8, pierce: 2, spd: 13 },
  { n: 4, dmg: 30, cd: 0.75, pierce: 3, spd: 14 },
  { n: 5, dmg: 38, cd: 0.7, pierce: 3, spd: 15 },
];

function ensureKind(): void {
  if (G.projectiles.hasKind("spiritBolt")) return;
  const geo = new THREE.PlaneGeometry(0.9, 0.9);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: "#7cf3ff",
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  G.projectiles.registerKind("spiritBolt", { geometry: geo, material: mat, capacity: 256 });
  const core = new THREE.SphereGeometry(0.13, 8, 6);
  const coreMat = new THREE.MeshBasicMaterial({ color: "#e8feff" });
  G.projectiles.registerKind("spiritBoltCore", { geometry: core, material: coreMat, capacity: 256 });
}

class Missile extends Weapon {
  private burst: { t: number; target: number }[] = [];

  update(dt: number): void {
    ensureKind();
    const L = LV[this.level - 1];
    const p = G.player;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.cd(L.cd);
      const n = this.amount(L.n);
      for (let k = 0; k < n; k++) this.burst.push({ t: k * 0.07, target: -1 });
    }
    for (let b = this.burst.length - 1; b >= 0; b--) {
      const it = this.burst[b];
      it.t -= dt;
      if (it.t > 0) continue;
      this.burst.splice(b, 1);
      const t = G.enemies.nearest(p.x, p.z, 14);
      let a: number;
      if (t >= 0) a = Math.atan2(G.enemies.z[t] - p.z, G.enemies.x[t] - p.x) + (Math.random() - 0.5) * 0.5;
      else a = Math.atan2(p.faceZ, p.faceX) + (Math.random() - 0.5) * 0.8;
      const sp = this.projSpeed(L.spd);
      const color = this.evolved ? "#c77dff" : "#7cf3ff";
      const dmg = L.dmg * (this.evolved ? 1.4 : 1);
      const glow = G.projectiles.spawn({
        kind: "spiritBolt",
        x: p.x,
        z: p.z,
        y: 0.9,
        vx: Math.cos(a) * sp,
        vz: Math.sin(a) * sp,
        damage: dmg,
        radius: 0.35,
        life: 1.6,
        pierce: L.pierce + (this.evolved ? 2 : 0),
        source: this.def.id,
        kb: 3,
        homing: 5,
        scale: this.area(1),
        update: (pr, d) => {
          if (Math.random() < d * 30) G.fx.particles.emit(pr.x, pr.y, pr.z, 0, 0.3, 0, 0.3, 0.25, color);
        },
        onHit: (pr) => {
          G.fx.hitSpark(pr.x, pr.y, pr.z, color);
          if (this.evolved) G.fx.explosion(pr.x, pr.z, 1.4 * this.area(1), color, 0);
        },
      });
      if (glow) {
        // a bright core that rides along with the glow
        const core = G.projectiles.spawn({
          kind: "spiritBoltCore",
          x: p.x,
          z: p.z,
          y: 0.9,
          vx: 0,
          vz: 0,
          damage: 0,
          radius: 0,
          life: 1.6,
          pierce: Infinity,
          source: this.def.id,
          update: (c) => {
            if (!glow.alive) {
              c.alive = false;
              return true;
            }
            c.x = glow.x;
            c.z = glow.z;
            return true;
          },
        });
        void core;
      }
      G.audio.sfx("zap");
    }
  }
}

export const missileDef: WeaponDef = {
  id: "missile",
  name: "ลูกไฟวิญญาณ",
  maxLevel: 8,
  color: "#7cf3ff",
  icon: (c, s) => {
    iconBg(c, s, "#7cf3ff");
    const g = c.createRadialGradient(s * 0.55, s * 0.45, 0, s * 0.55, s * 0.45, s * 0.3);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#7cf3ff");
    g.addColorStop(1, "rgba(124,243,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(s * 0.55, s * 0.45, s * 0.3, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#7cf3ff";
    c.lineWidth = s * 0.06;
    c.beginPath();
    c.moveTo(s * 0.2, s * 0.8);
    c.quadraticCurveTo(s * 0.3, s * 0.55, s * 0.45, s * 0.52);
    c.stroke();
  },
  describe: (l) =>
    [
      "ยิงลูกไฟวิญญาณติดตามศัตรูที่ใกล้ที่สุด",
      "ลูกไฟ +1",
      "ดาเมจ +33% • ทะลุศัตรู +1",
      "ลูกไฟ +1 • ยิงเร็วขึ้น",
      "ดาเมจ +37% • ทะลุ +1",
      "ลูกไฟ +1",
      "ดาเมจ +36% • ทะลุ +1",
      "ลูกไฟ +1 • ดาเมจ +27%",
    ][l - 1] ?? "",
  lines: (l) => {
    if (l === 1) return ["ลูกไฟ x1"];
    const a = LV[l - 2];
    const b = LV[l - 1];
    const out: string[] = [];
    if (b.n !== a.n) out.push(`ลูกไฟ +${b.n - a.n}`);
    if (b.dmg !== a.dmg) out.push(`ดาเมจ +${Math.round((b.dmg / a.dmg - 1) * 100)}%`);
    if (b.cd !== a.cd) out.push(`สปีดโจมตี +${Math.round((a.cd / b.cd - 1) * 100)}%`);
    if (b.pierce !== a.pierce) out.push(`ทะลุ +${b.pierce - a.pierce}`);
    return out;
  },
  evolution: {
    requires: "amount",
    name: "ดาวตกวิญญาณ",
    describe: "ลูกไฟกลายเป็นสีม่วง ระเบิดเมื่อโดนศัตรู ดาเมจ +40% ทะลุ +2",
  },
  create: () => new Missile(missileDef),
};
