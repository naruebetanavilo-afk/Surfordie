import * as THREE from "three";
import { G } from "../core/G";
import type { Proj } from "../combat/Projectiles";
import { Weapon, type WeaponDef } from "./types";
import { iconBg } from "../ui/icons";
import { glowTexture } from "../fx/textures";
import { VFX, col, SPARK_GLOW, SPARK_STAR, DECAL_VORTEX, DECAL_SHOCK, DECAL_GLOW } from "./vfx";
import { SpriteBatch } from "./vfx/SpriteBatch";
import { softGlowTex } from "./vfx/textures";
import { levelLines } from "./util";
import { evolvedFrame, glow, star4 } from "./iconkit";

/**
 * ลูกไฟวิญญาณ (Spirit Missile) — reference for a projectile weapon.
 * Fires homing spirit bolts at the nearest enemies. Evolved (ดาวตกวิญญาณ):
 * violet bolts that explode in a small soul vortex on every hit.
 */
const LV = [
  { n: 1, dmg: 12, cd: 1.0, pierce: 0, spd: 11 },
  { n: 2, dmg: 12, cd: 1.0, pierce: 0, spd: 11 },
  { n: 2, dmg: 16, cd: 0.95, pierce: 1, spd: 12 },
  { n: 3, dmg: 16, cd: 0.9, pierce: 1, spd: 12 },
  { n: 3, dmg: 22, cd: 0.85, pierce: 2, spd: 13 },
  { n: 4, dmg: 22, cd: 0.8, pierce: 2, spd: 13 },
  { n: 4, dmg: 30, cd: 0.75, pierce: 3, spd: 14 },
  { n: 5, dmg: 40, cd: 0.7, pierce: 3, spd: 15 },
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
  const evMat = mat.clone();
  evMat.color.set("#c77dff");
  G.projectiles.registerKind("spiritBoltEvo", { geometry: geo, material: evMat, capacity: 256 });
}

/** token stored in Proj.data so recycled projectiles aren't mistaken for ours */
type BoltTag = { evolved: boolean };

class Missile extends Weapon {
  private burst: { t: number }[] = [];
  private live: { p: Proj; tag: BoltTag }[] = [];
  private cores: SpriteBatch | null = null;
  private boomCd = 0;

  private coreBatch(): SpriteBatch {
    if (!this.cores) {
      // the bright white core rides on each bolt (was a 2nd projectile, which dealt 1-damage hits)
      this.cores = new SpriteBatch(G.world.scene, softGlowTex(), 256, { facing: "camera", additive: true, depthTest: false, renderOrder: 9 });
    }
    return this.cores;
  }

  /** register the projectile kinds and the core batch up front (shader prewarm) */
  prepare(): void {
    ensureKind();
    this.coreBatch();
  }

  update(dt: number): void {
    ensureKind();
    const L = LV[this.level - 1];
    const p = G.player;
    this.boomCd -= dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.cd(L.cd);
      const n = this.amount(L.n);
      for (let k = 0; k < n; k++) this.burst.push({ t: k * 0.07 });
    }
    for (let b = this.burst.length - 1; b >= 0; b--) {
      const it = this.burst[b];
      it.t -= dt;
      if (it.t > 0) continue;
      this.burst.splice(b, 1);
      this.fire(L);
    }
    // cores + trails
    const cb = this.coreBatch();
    cb.begin();
    const ev = this.evolved;
    const coreC = col(ev ? "#f3d9ff" : "#e8feff");
    const trailC = col(ev ? "#c77dff" : "#7cf3ff");
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      if (!f.p.alive || f.p.data !== f.tag) {
        this.live.splice(i, 1);
        continue;
      }
      const pr = f.p;
      cb.add(pr.x, pr.y, pr.z, 0.42 * pr.scale, coreC, 1);
      if (Math.random() < dt * 30) {
        VFX.sparkles.spawn(pr.x, pr.y, pr.z, 0, 0.3, 0, 0.3, 0.42 * pr.scale, trailC, SPARK_GLOW, 0, 0);
      }
    }
    cb.end();
  }

  private fire(L: (typeof LV)[number]): void {
    const p = G.player;
    const t = G.enemies.nearest(p.x, p.z, 14);
    let a: number;
    if (t >= 0) a = Math.atan2(G.enemies.z[t] - p.z, G.enemies.x[t] - p.x) + (Math.random() - 0.5) * 0.5;
    else a = Math.atan2(p.faceZ, p.faceX) + (Math.random() - 0.5) * 0.8;
    const sp = this.projSpeed(L.spd);
    const ev = this.evolved;
    const color = ev ? "#c77dff" : "#7cf3ff";
    const dmg = L.dmg * (ev ? 1.4 : 1);
    const tag: BoltTag = { evolved: ev };
    const glowP = G.projectiles.spawn({
      kind: ev ? "spiritBoltEvo" : "spiritBolt",
      x: p.x,
      z: p.z,
      y: 0.9,
      vx: Math.cos(a) * sp,
      vz: Math.sin(a) * sp,
      damage: dmg,
      radius: 0.35,
      life: 1.6,
      pierce: L.pierce + (ev ? 2 : 0),
      source: this.def.id,
      kb: 3,
      homing: 5,
      scale: this.area(1),
      data: tag,
      onHit: (pr) => {
        G.fx.hitSpark(pr.x, pr.y, pr.z, color);
        if (this.evolved) this.miniBlast(pr.x, pr.z);
      },
    });
    if (glowP) this.live.push({ p: glowP, tag });
    G.audio.sfx("zap");
  }

  private miniBlast(x: number, z: number): void {
    const r = 1.4 * this.area(1);
    VFX.decals.spawn(x, z, r * 1.2, 0.3, col("#c77dff"), DECAL_GLOW, 1, 0, 0.5, 0.2);
    VFX.sparkles.burst(x, 0.4, z, 8, r * 3, 2, 0.45, 0.4, col("#c77dff"), SPARK_GLOW, -3, 2.5);
    VFX.decals.spawn(x, z, r * 1.1, 0.55, col("#d65cff"), DECAL_VORTEX, 0.9, 6, 0.4, 0.25);
    VFX.decals.spawn(x, z, r * 1.25, 0.3, col("#f3d9ff"), DECAL_SHOCK, 0.7, 0, 0.2, 0.9);
    VFX.sparkles.burst(x, 0.6, z, 2, 3, 3, 0.4, 0.7, col("#ffffff"), SPARK_STAR, -6, 2);
    if (this.boomCd <= 0) {
      G.audio.sfx("boom", { vol: 0.35, pitch: 1.4 });
      this.boomCd = 0.1;
    }
  }

  dispose(): void {
    super.dispose();
    this.cores?.dispose();
    this.cores = null;
    this.live.length = 0;
    this.burst.length = 0;
  }
}

function drawMissile(c: CanvasRenderingContext2D, s: number, evolved: boolean): void {
  const main = evolved ? "#c77dff" : "#7cf3ff";
  iconBg(c, s, main, evolved ? "#1d1430" : "#1b1f2a");
  // comet tail
  c.save();
  c.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    c.strokeStyle = evolved ? `rgba(199,125,255,${0.85 - k * 0.25})` : `rgba(124,243,255,${0.85 - k * 0.25})`;
    c.lineWidth = s * (0.09 - k * 0.025);
    c.beginPath();
    c.moveTo(s * (0.2 + k * 0.04), s * (0.82 - k * 0.02));
    c.quadraticCurveTo(s * 0.3, s * 0.58, s * 0.5, s * 0.5);
    c.stroke();
  }
  c.restore();
  glow(c, s * 0.58, s * 0.43, s * 0.32, evolved ? "rgba(199,125,255,0.9)" : "rgba(124,243,255,0.9)");
  const g = c.createRadialGradient(s * 0.58, s * 0.43, 0, s * 0.58, s * 0.43, s * 0.17);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.55, evolved ? "#f3d9ff" : "#d8fdff");
  g.addColorStop(1, main);
  c.fillStyle = g;
  c.beginPath();
  c.arc(s * 0.58, s * 0.43, s * 0.15, 0, Math.PI * 2);
  c.fill();
  star4(c, s * 0.8, s * 0.22, s * 0.07);
  star4(c, s * 0.26, s * 0.3, s * 0.045);
  if (evolved) {
    star4(c, s * 0.78, s * 0.72, s * 0.06, "#f3d9ff");
    evolvedFrame(c, s);
  }
}

export const missileDef: WeaponDef = {
  id: "missile",
  name: "ลูกไฟวิญญาณ",
  maxLevel: 8,
  color: "#7cf3ff",
  icon: (c, s) => drawMissile(c, s, false),
  describe: (l) =>
    [
      "ยิงลูกไฟวิญญาณติดตามศัตรูที่ใกล้ที่สุด",
      "ลูกไฟ +1",
      "ดาเมจ +33% • ทะลุศัตรู +1",
      "ลูกไฟ +1 • ยิงเร็วขึ้น",
      "ดาเมจ +37% • ทะลุ +1",
      "ลูกไฟ +1",
      "ดาเมจ +36% • ทะลุ +1",
      "ลูกไฟ +1 • ดาเมจ +33%",
    ][l - 1] ?? "",
  lines: (l) =>
    levelLines(
      LV,
      l,
      [
        { key: "n", label: "ลูกไฟ", kind: "add" },
        { key: "dmg", label: "ดาเมจ", kind: "pct" },
        { key: "cd", label: "สปีดโจมตี", kind: "cd" },
        { key: "pierce", label: "ทะลุ", kind: "add" },
      ],
      ["ลูกไฟ x1"],
    ),
  evolution: {
    requires: "amount",
    name: "ดาวตกวิญญาณ",
    describe: "ลูกไฟกลายเป็นสีม่วง ระเบิดเป็นวังวนเมื่อโดนศัตรู ดาเมจ +40% ทะลุ +2",
    icon: (c, s) => drawMissile(c, s, true),
  },
  create: () => new Missile(missileDef),
};
