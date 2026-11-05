import * as THREE from "three";
import { G } from "../core/G";
import { hitEnemy } from "../combat/damage";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { VFX, col, SPARK_STAR } from "./vfx";
import { evolvedFrame, glow } from "./iconkit";
import { liveSlot } from "./util";

/**
 * ดาบพิฆาต (Slayer Blade) — reference weapon implementation.
 * Sweeping melee arc towards the nearest enemy (or facing direction).
 */
const LV = [
  // dmg, radius, cooldown, slashes
  { dmg: 16, r: 2.7, cd: 1.15, n: 1 },
  { dmg: 16, r: 2.7, cd: 1.15, n: 2 },
  { dmg: 22, r: 2.7, cd: 1.1, n: 2 },
  { dmg: 22, r: 3.2, cd: 1.0, n: 2 },
  { dmg: 28, r: 3.2, cd: 0.95, n: 3 },
  { dmg: 34, r: 3.5, cd: 0.9, n: 3 },
  { dmg: 40, r: 3.8, cd: 0.85, n: 4 },
  { dmg: 50, r: 4.0, cd: 0.8, n: 4 },
];

class Slash extends Weapon {
  private queue: { t: number; dx: number; dz: number }[] = [];
  private swingT = 1;

  update(dt: number): void {
    const p = G.player;
    const L = LV[this.level - 1];
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.cd(L.cd);
      // aim: nearest enemy within reach, else facing
      let dx = p.faceX;
      let dz = p.faceZ;
      const t = G.enemies.nearest(p.x, p.z, this.area(L.r) + 3);
      if (t >= 0) {
        dx = G.enemies.x[t] - p.x;
        dz = G.enemies.z[t] - p.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
      }
      const n = this.amount(L.n);
      for (let k = 0; k < n; k++) {
        // alternate: front, back, left, right...
        const a = Math.atan2(dz, dx) + (k === 0 ? 0 : k === 1 ? Math.PI : k === 2 ? Math.PI / 2 : -Math.PI / 2);
        this.queue.push({ t: k * 0.08, dx: Math.cos(a), dz: Math.sin(a) });
      }
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.queue.splice(i, 1);
        this.doSlash(q.dx, q.dz, L.dmg, this.area(L.r));
      }
    }
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt * 6);
      p.swing(this.swingT);
    }
  }

  private doSlash(dx: number, dz: number, dmg: number, r: number): void {
    const p = G.player;
    const arc = (this.evolved ? 200 : 150) * (Math.PI / 180);
    const half = arc / 2;
    const cos = Math.cos(half);
    const color = this.evolved ? "#ff4f6a" : "#bfe9ff";
    G.fx.slashArc(p.x, p.z, dx, dz, { radius: r, arc, color, life: 0.24 });
    this.swingT = 0;
    G.audio.sfx("slash");
    const hits: number[] = [];
    G.enemies.queryCircle(p.x, p.z, r, (i) => {
      if (!liveSlot(i)) return;
      const ex = G.enemies.x[i] - p.x;
      const ez = G.enemies.z[i] - p.z;
      const l = Math.hypot(ex, ez) || 1;
      if ((ex * dx + ez * dz) / l >= cos || l < 0.9) hits.push(i);
    });
    let stars = 0;
    for (const i of hits) {
      const x = G.enemies.x[i];
      const z = G.enemies.z[i];
      hitEnemy(i, dmg, this.def.id, { kb: 9, fromX: p.x, fromZ: p.z });
      G.fx.hitSpark(x, 0.8, z, color);
      if (stars < 4 && Math.random() < 0.4) {
        stars++;
        VFX.sparkles.spawn(x, 0.9, z, dx * 1.5, 1, dz * 1.5, 0.28, 0.75, col("#ffffff"), SPARK_STAR, 0, 1, 4);
      }
    }
    if (this.evolved) {
      // crescent wave projectile
      ensureWaveKind();
      G.projectiles.spawn({
        kind: "slashWave",
        x: p.x + dx * 0.8,
        z: p.z + dz * 0.8,
        y: 0.6,
        vx: dx * 14,
        vz: dz * 14,
        damage: dmg * 0.7,
        radius: 1.1 * G.player.stats.area,
        life: 0.6,
        pierce: Infinity,
        source: this.def.id,
        kb: 4,
        scale: G.player.stats.area,
      });
    }
  }
}

function ensureWaveKind(): void {
  if (G.projectiles.hasKind("slashWave")) return;
  const geo = new THREE.TorusGeometry(1, 0.12, 4, 16, Math.PI * 0.9);
  geo.rotateX(Math.PI / 2);
  geo.rotateY(-Math.PI * 0.05);
  geo.rotateY(Math.PI / 2 - Math.PI * 0.45);
  const mat = new THREE.MeshBasicMaterial({
    color: "#ff6b81",
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  G.projectiles.registerKind("slashWave", { geometry: geo, material: mat, faceVelocity: true, capacity: 64 });
}

function drawSword(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  iconBg(c, s, evolved ? "#ff4f6a" : "#5ad1ff", evolved ? "#24101a" : "#1b1f2a");
  // crescent swing
  c.save();
  c.lineCap = "round";
  c.strokeStyle = evolved ? "rgba(255,107,129,0.85)" : "rgba(191,233,255,0.8)";
  c.lineWidth = s * 0.06;
  c.beginPath();
  c.arc(s * 0.5, s * 0.52, s * 0.34, Math.PI * 0.95, Math.PI * 1.65);
  c.stroke();
  c.restore();
  if (evolved) glow(c, s * 0.5, s * 0.5, s * 0.34, "rgba(255,79,106,0.55)");
  c.save();
  c.translate(s / 2, s / 2);
  c.rotate(-Math.PI / 4);
  c.fillStyle = evolved ? "#ffd0d8" : "#e9f3ff";
  c.strokeStyle = "#0d0f14";
  c.lineWidth = s * 0.04;
  c.beginPath();
  c.moveTo(0, -s * 0.36);
  c.lineTo(s * 0.07, -s * 0.26);
  c.lineTo(s * 0.07, s * 0.12);
  c.lineTo(-s * 0.07, s * 0.12);
  c.lineTo(-s * 0.07, -s * 0.26);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = evolved ? "#ff4f6a" : "#d9a440";
  c.fillRect(-s * 0.17, s * 0.12, s * 0.34, s * 0.06);
  c.fillStyle = "#6b4a2b";
  c.fillRect(-s * 0.04, s * 0.18, s * 0.08, s * 0.16);
  c.restore();
  if (evolved) evolvedFrame(c, s);
}

export const slashDef: WeaponDef = {
  id: "slash",
  name: "ดาบพิฆาต",
  maxLevel: 8,
  color: "#bfe9ff",
  icon: (c, s) => drawSword(c, s, false),
  describe: (l) =>
    [
      "ฟันเป็นวงโค้งใส่ศัตรูที่ใกล้ที่สุด",
      "ฟันเพิ่ม 1 ครั้งไปทางด้านหลัง",
      "ดาเมจ +6",
      "ขอบเขต +19% • สปีดโจมตีเร็วขึ้น",
      "ฟันเพิ่มอีก 1 ครั้ง • ดาเมจ +6",
      "ดาเมจ +6 • ขอบเขตเพิ่ม",
      "ฟันเพิ่มอีก 1 ครั้ง • ดาเมจ +6",
      "ดาเมจ +10 • สปีดโจมตีเร็วขึ้น",
    ][l - 1] ?? "",
  lines: (l) => {
    const a = LV[Math.max(0, l - 2)];
    const b = LV[l - 1];
    const out: string[] = [];
    if (l === 1) return ["ดาเมจ " + b.dmg];
    if (b.dmg !== a.dmg) out.push(`ดาเมจ +${Math.round((b.dmg / a.dmg - 1) * 100)}%`);
    if (b.cd !== a.cd) out.push(`สปีดโจมตี +${Math.round((a.cd / b.cd - 1) * 100)}%`);
    if (b.r !== a.r) out.push(`ขอบเขต +${Math.round((b.r / a.r - 1) * 100)}%`);
    if (b.n !== a.n) out.push(`จำนวนฟัน +${b.n - a.n}`);
    return out;
  },
  evolution: {
    requires: "might",
    name: "ดาบจันทราโลหิต",
    describe: "ฟันกว้างขึ้นและปล่อยคลื่นพระจันทร์เสี้ยวทะลุศัตรู",
    icon: (c, s) => drawSword(c, s, true),
  },
  create: () => new Slash(slashDef),
};
