import * as THREE from "three";
import { G } from "../core/G";
import { Meta } from "../core/Meta";
import { clamp, damp, easeOutCubic, lerp } from "../core/math";
import { baseStats, xpToNext, type PlayerStats } from "./stats";
import { HEROES, heroById, type HeroDef } from "./heroes";
import { Ultimate } from "./Ultimate";
import type { UltPose } from "./ultimates/types";

/** ground decal: soft contact shadow + thin accent ring (ring is white, tinted by material colour) */
let groundTex: THREE.Texture | null = null;
function heroGroundTexture(): THREE.Texture {
  if (groundTex) return groundTex;
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const c = cv.getContext("2d")!;
  const h = s / 2;
  const g = c.createRadialGradient(h, h, 0, h, h, h * 0.62);
  g.addColorStop(0, "rgba(0,0,0,0.62)");
  g.addColorStop(0.6, "rgba(0,0,0,0.42)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  c.strokeStyle = "rgba(255,255,255,0.85)";
  c.lineWidth = s * 0.045;
  c.beginPath();
  c.arc(h, h, h * 0.86, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = "rgba(255,255,255,0.18)";
  c.lineWidth = s * 0.08;
  c.stroke();
  groundTex = new THREE.CanvasTexture(cv);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  return groundTex;
}

/** bones the animator drives (any may be missing on a custom model) */
interface Rig {
  body?: THREE.Object3D;
  head?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  weapon?: THREE.Object3D;
  cape?: THREE.Object3D;
  capeTip?: THREE.Object3D;
  hatTip?: THREE.Object3D;
  orbGlow?: THREE.Object3D;
}

export class Player {
  x = 0;
  z = 0;
  velX = 0;
  velZ = 0;
  /** unit vector of the last movement direction (for directional weapons) */
  faceX = 0;
  faceZ = 1;
  yaw = 0;
  readonly radius = 0.45;

  hp = 100;
  level = 1;
  xp = 0;
  xpNext = xpToNext(1);
  /** queued level ups waiting for the player to pick upgrades */
  pendingLevels = 0;
  stats: PlayerStats = baseStats();
  hero: HeroDef = heroById("knight");
  /** ultimate skill: charge meter + cast (`G.player.ult.tryCast()`) */
  readonly ult = new Ultimate();
  /** 0..1 golden ultimate glow on the hero (set every frame by a running ultimate) */
  ultGlow = 0;

  /** seconds of invulnerability left (after revive etc.) */
  invuln = 0;
  /** contact-damage tick cooldown */
  private hurtCd = 0;
  /** revives spent this run (stats are rebuilt from scratch on every passive pick) */
  private revivesUsed = 0;
  /** 0..1 red flash */
  hurtFlash = 0;
  dead = false;
  private walkT = 0;
  private regenAcc = 0;

  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private parts: Record<string, THREE.Object3D | undefined> = {};
  private rig: Rig = {};
  private flashMats: THREE.MeshToonMaterial[] = [];
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;

  // --- animation state (visual only) ---
  private moveBlend = 0;
  private yawVel = 0;
  private capeA = 0;
  private capeV = 0;
  private capeTipA = 0;
  private capeTipV = 0;
  private hatA = 0;
  private hatV = 0;
  private hatZ = 0;
  private hatZV = 0;
  /** knight-style swing progress driven by the slash weapon (1 = idle) */
  private swingP = 1;
  /** auto-detected cast/throw progress (1 = idle) */
  private attackP = 1;
  private lastWeaponTimer = 0;
  /** squash/stretch impulse spring (hurt, level up, landing) */
  private pop = 0;
  private popV = 0;
  private hopT = 1;
  private lastHurt = 0;
  private eventsHooked = false;
  private ultPrepared = false;
  // --- ultimate pose (visual only) ---
  private ultPose: UltPose | null = null;
  private ultPoseT = 0;
  private ultPoseDur = 0;
  private ultSpin = 0;
  private ultLand = 1;
  private readonly ultColor = new THREE.Color("#ffd23f");

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: heroGroundTexture(),
      transparent: true,
      depthWrite: false,
      color: "#ffffff",
    });
    const sg = new THREE.PlaneGeometry(1.5, 1.5);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, this.shadowMat);
    this.shadow.position.y = 0.025;
    this.shadow.renderOrder = -4;
    scene.add(this.shadow);
  }

  /** start a new run with the given hero */
  reset(heroId: string): void {
    this.hero = heroById(heroId);
    this.x = this.z = 0;
    this.velX = this.velZ = 0;
    this.faceX = 0;
    this.faceZ = 1;
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpToNext(1);
    this.pendingLevels = 0;
    this.invuln = 1.5;
    this.hurtCd = 0;
    this.hurtFlash = 0;
    this.dead = false;
    this.regenAcc = 0;
    this.revivesUsed = 0;
    this.setModel(this.hero.build());
    this.recalcStats();
    this.hp = this.stats.maxHp;
    this.hookEvents();
    this.ultPose = null;
    this.ultGlow = 0;
    this.ultSpin = 0;
    this.ultLand = 1;
    // first reset (boot, before the shader prewarm): create every hero's
    // ultimate effect objects so they compile with the rest of the scene
    if (!this.ultPrepared) {
      this.ultPrepared = true;
      this.ult.prepare(HEROES.map((h) => h.ultimate));
      this.ult.reset(this.hero.ultimate, false);
    } else this.ult.reset(this.hero.ultimate);
  }

  private hookEvents(): void {
    if (this.eventsHooked || !G.events) return;
    this.eventsHooked = true;
    G.events.on("levelUp", () => {
      this.hopT = 0;
      this.kick(0.35);
    });
    G.events.on("runStart", () => {
      this.hopT = 0;
    });
  }

  private setModel(m: THREE.Group): void {
    if (this.model) {
      this.root.remove(this.model);
      disposeModel(this.model);
    }
    this.model = m;
    this.root.add(m);
    this.parts = {};
    this.flashMats = [];
    m.traverse((o) => {
      if (o.name) this.parts[o.name] = o;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material;
        if ((mat as THREE.MeshToonMaterial).isMeshToonMaterial) {
          const tm = mat as THREE.MeshToonMaterial;
          tm.emissive = new THREE.Color(0, 0, 0);
          this.flashMats.push(tm);
        }
      }
    });
    const p = this.parts;
    this.rig = {
      body: p.body,
      head: p.head,
      armL: p.armL,
      armR: p.armR,
      legL: p.legL,
      legR: p.legR,
      weapon: p.weapon,
      cape: p.cape,
      capeTip: p.capeTip,
      hatTip: p.hatTip,
      orbGlow: p.orbGlow,
    };
    for (const o of Object.values(this.rig)) {
      if (o && !o.userData.base) o.userData.base = o.position.clone();
    }
    this.shadowMat.color.set(this.hero.color);
    this.swingP = 1;
    this.attackP = 1;
    this.capeA = this.capeV = this.capeTipA = this.capeTipV = 0;
    this.hatA = this.hatV = this.hatZ = this.hatZV = 0;
    this.pop = this.popV = 0;
    this.lastWeaponTimer = 0;
  }

  /** rebuild stats from base + hero + meta shop + passives */
  recalcStats(): void {
    const prevMax = this.stats.maxHp;
    const s = baseStats();
    const b = this.hero.bonus;
    for (const k of Object.keys(b) as (keyof PlayerStats)[]) {
      s[k] += b[k] as number;
    }
    Meta.applyShop(s);
    G.weapons?.applyPassives(s);
    s.cooldown = Math.max(0.25, s.cooldown);
    s.revives = Math.max(0, s.revives - this.revivesUsed);
    this.stats = s;
    if (s.maxHp > prevMax && this.hp > 0) this.hp += s.maxHp - prevMax;
    this.hp = Math.min(this.hp, s.maxHp);
  }

  addXp(v: number): void {
    this.xp += v * this.stats.growth;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpToNext(this.level);
      this.pendingLevels++;
      G.stats.maxLevel = this.level;
      G.events.emit("levelUp", { level: this.level });
    }
  }

  heal(amount: number): void {
    if (this.dead) return;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
    const gained = this.hp - before;
    if (gained >= 1) G.overlay.healNumber(this.x, this.z, gained);
  }

  /** called by the horde every frame while touching */
  contactDamage(amount: number): void {
    if (this.hurtCd > 0) return;
    this.hurtCd = 0.4;
    this.takeDamage(amount);
  }

  takeDamage(amount: number): void {
    // only while playing: the end screens keep the horde animating in the background
    if (this.dead || this.invuln > 0 || G.debug.god || G.state !== "playing") return;
    const dmg = Math.max(1, amount - this.stats.armor);
    this.hp -= dmg;
    this.hurtFlash = 1;
    G.overlay.playerHit(dmg);
    G.audio.sfx("hurt");
    G.fx.shake(0.35);
    G.events.emit("playerHurt", { amount: dmg });
    if (this.hp <= 0) {
      if (this.stats.revives > 0) {
        this.stats.revives--;
        this.revivesUsed++;
        this.hp = this.stats.maxHp * 0.5;
        this.invuln = 3;
        G.fx.ring(this.x, this.z, { radius: 8, color: "#ffe680", life: 0.8, width: 1.2 });
        // blast enemies away
        G.enemies.queryCircle(this.x, this.z, 8, (i) => {
          G.enemies.knock(i, G.enemies.x[i] - this.x, G.enemies.z[i] - this.z, 30);
        });
        G.events.emit("announce", { text: "ฟื้นคืนชีพ!", color: "#ffe680" });
        return;
      }
      this.hp = 0;
      this.dead = true;
      G.events.emit("playerDied", {});
    }
  }

  update(dt: number): void {
    const inp = G.input;
    const sp = this.stats.moveSpeed;
    const tx = inp.moveX * sp;
    const tz = inp.moveZ * sp;
    const k = damp(14, dt);
    this.velX += (tx - this.velX) * k;
    this.velZ += (tz - this.velZ) * k;
    this.x += this.velX * dt;
    this.z += this.velZ * dt;
    const moving = Math.hypot(inp.moveX, inp.moveZ) > 0.05;
    if (moving) {
      const l = Math.hypot(inp.moveX, inp.moveZ);
      this.faceX = inp.moveX / l;
      this.faceZ = inp.moveZ / l;
    }
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtCd > 0) this.hurtCd -= dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    if (this.stats.regen > 0 && this.hp < this.stats.maxHp && !this.dead) {
      this.regenAcc += this.stats.regen * dt;
      if (this.regenAcc >= 1) {
        const h = Math.floor(this.regenAcc);
        this.regenAcc -= h;
        this.hp = Math.min(this.stats.maxHp, this.hp + h);
      }
    }
    this.ult.update(dt);
    this.detectAttack();
    this.animate(dt, moving);
  }

  /** start the hero's ultimate body animation (visual only) */
  playUltPose(pose: UltPose, dur: number, color: string): void {
    this.ultPose = pose;
    this.ultPoseT = 0;
    this.ultPoseDur = Math.max(0.3, dur);
    this.ultLand = pose === "slam" ? 0 : 1;
    this.ultColor.set(color);
    this.ultGlow = 1;
    this.hopT = 1;
    this.kick(0.3);
  }

  /** the slam ultimate hit the ground: squash on landing */
  ultLanded(): void {
    this.ultLand = 1;
    this.kick(-0.5);
  }

  /**
   * Visual only: the starting weapon's generic cooldown `timer` jumps up when it
   * fires; use that to play the hero's cast / throw gesture.
   */
  private detectAttack(): void {
    const style = this.hero.attackStyle;
    if (!style || style === "swing" || !G.weapons) return;
    const w = G.weapons.get(this.hero.startWeapon);
    if (!w) return;
    if (w.timer > this.lastWeaponTimer + 0.05 && this.attackP > 0.6) this.attackP = 0;
    this.lastWeaponTimer = w.timer;
  }

  /** add a squash/stretch impulse */
  private kick(v: number): void {
    this.popV += v * 14;
  }

  /** visual update; also used on the menu screen */
  animate(dt: number, moving: boolean): void {
    const targetYaw = Math.atan2(this.faceX, this.faceZ);
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const dy = d * damp(16, dt);
    this.yaw += dy;
    this.yawVel += ((dt > 0 ? dy / dt : 0) - this.yawVel) * damp(10, dt);
    const t = G.realTime;

    // ultimate pose: weight eases in/out; spin / lift / float
    let poseW = 0;
    let lift = 0;
    const pose = this.ultPose;
    if (pose) {
      this.ultPoseT += dt;
      const left = this.ultPoseDur - this.ultPoseT;
      if (left <= 0) {
        // keep the facing continuous: fold the spin into the yaw, which then eases back
        this.yaw += this.ultSpin % (Math.PI * 2);
        this.ultSpin = 0;
        this.ultPose = null;
      } else {
        poseW = Math.min(1, this.ultPoseT / 0.12) * Math.min(1, left / 0.25);
        if (pose === "spin") {
          this.ultSpin += dt * 20 * Math.max(0.25, poseW);
        } else if (pose === "slam") {
          if (this.ultLand < 1) {
            // leap up, hang, drop
            const u = this.ultPoseT;
            lift = u < 0.2 ? easeOutCubic(u / 0.2) * 1.3 : Math.max(0, 1.3 - ((u - 0.2) / 0.12) ** 2 * 1.3);
          }
        } else {
          lift = (0.22 + Math.sin(t * 3.2) * 0.05) * poseW;
        }
      }
    }

    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.yaw + this.ultSpin;
    if (this.model) this.model.position.y = (this.hopT < 1 ? Math.sin(this.hopT * Math.PI) * 0.28 : 0) + lift;

    const speedN = Math.min(1, Math.hypot(this.velX, this.velZ) / Math.max(1, this.stats.moveSpeed));
    this.moveBlend += ((moving ? 1 : 0) - this.moveBlend) * damp(10, dt);
    const mb = Math.min(this.moveBlend, Math.max(speedN, moving ? 0.35 : 0));
    this.walkT += dt * (moving ? 10 + 3 * speedN : 0);
    const w = Math.sin(this.walkT);
    const plant = 1 - Math.abs(w); // 1 when a foot hits the ground
    const breathe = Math.sin(t * 2.6);
    const r = this.rig;

    // attack progress
    if (this.attackP < 1) this.attackP = Math.min(1, this.attackP + dt / (this.hero.attackStyle === "cast" ? 0.38 : 0.34));
    if (this.hopT < 1) this.hopT = Math.min(1, this.hopT + dt / 0.45);
    const hop = this.hopT < 1 ? Math.sin(this.hopT * Math.PI) * 0.28 : 0;

    // hurt reaction
    if (this.hurtFlash > this.lastHurt + 0.5) this.kick(-0.25);
    this.lastHurt = this.hurtFlash;

    // squash spring
    this.popV += (-this.pop * 160 - this.popV * 11) * dt;
    this.pop += this.popV * dt;
    const pop = clamp(this.pop, -0.35, 0.35);

    // legs
    const legAmp = 0.9 * mb;
    if (r.legL) r.legL.rotation.x = w * legAmp;
    if (r.legR) r.legR.rotation.x = -w * legAmp;

    // body: bounce, squash on foot plant, lean forward, roll into turns
    let twist = 0;
    if (r.body) {
      const base = r.body.userData.base as THREE.Vector3;
      const bounce = Math.abs(w) * 0.075 * mb;
      r.body.position.y = base.y + bounce + breathe * 0.008 * (1 - mb);
      const sq = plant * 0.07 * mb - breathe * 0.012 * (1 - mb) + pop * 0.6;
      r.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
      r.body.rotation.x = 0.16 * speedN + (this.attackP < 1 && this.hero.attackStyle === "cast" ? Math.sin(this.attackP * Math.PI) * 0.15 : 0);
      r.body.rotation.z = clamp(-this.yawVel * 0.05, -0.22, 0.22) + Math.sin(this.walkT) * 0.05 * mb;
      if (this.swingP < 1) {
        // knight: wind up to the right, follow through to the left
        twist = 0.55 - easeOutCubic(this.swingP) * 1.0;
      } else if (this.attackP < 1 && this.hero.attackStyle === "throw") {
        const a = this.attackP;
        twist = a < 0.35 ? (a / 0.35) * 0.45 : 0.45 - easeOutCubic(Math.min(1, (a - 0.35) / 0.4)) * 0.8 * (1 - Math.max(0, (a - 0.75) / 0.25));
      }
      r.body.rotation.y = twist;
    }

    // head: look slightly up while running, idle glance around
    if (r.head) {
      const idleLook = (1 - mb) * Math.sin(t * 0.7) * 0.25;
      r.head.rotation.x = -0.16 - 0.08 * speedN + Math.sin(t * 2.6 + 0.6) * 0.03 * (1 - mb) - Math.abs(w) * 0.04 * mb;
      r.head.rotation.y = idleLook - twist * 0.4;
      r.head.rotation.z = -(r.body?.rotation.z ?? 0) * 0.6;
    }

    // arms: counter-swing, slight outward rest angle, idle sway
    if (r.armL) {
      r.armL.rotation.x = -w * 0.75 * mb + Math.sin(t * 2.6) * 0.05 * (1 - mb);
      r.armL.rotation.z = -0.14 - plant * 0.06 * mb - breathe * 0.03 * (1 - mb);
    }
    if (r.armR && !r.armR.userData.locked) {
      let ax = w * 0.6 * mb - 0.12 + Math.sin(t * 2.6 + 1) * 0.05 * (1 - mb);
      let az = 0.14 + plant * 0.06 * mb + breathe * 0.03 * (1 - mb);
      if (this.attackP < 1) {
        const a = this.attackP;
        if (this.hero.attackStyle === "cast") {
          // raise the staff forward, hold, lower
          const k = a < 0.3 ? easeOutCubic(a / 0.3) : 1 - Math.max(0, (a - 0.55) / 0.45);
          ax = ax * (1 - k) - 1.55 * k;
          az = az * (1 - k) + 0.05 * k;
        } else if (a < 0.3) {
          // throw: pull back...
          ax = lerp(ax, 1.25, easeOutCubic(a / 0.3));
        } else if (a < 0.55) {
          // ...whip forward...
          ax = lerp(1.25, -1.9, easeOutCubic((a - 0.3) / 0.25));
          az += 0.25;
        } else {
          // ...and recover
          const u = (a - 0.55) / 0.45;
          ax = lerp(-1.9, ax, u * u * (3 - 2 * u));
          az += 0.25 * (1 - u);
        }
      }
      r.armR.rotation.x = ax;
      r.armR.rotation.z = az;
    }
    if (pose && poseW > 0) this.poseArms(pose, poseW, t);
    if (r.weapon) {
      let wx = Math.sin(t * 2.2) * 0.04 * (1 - mb);
      let sc = 1;
      if (this.attackP < 1 && this.hero.attackStyle === "cast") wx += Math.sin(this.attackP * Math.PI) * 0.5;
      if (this.attackP < 1 && this.hero.attackStyle === "throw") {
        // the axe leaves the hand and a fresh one pops back in
        const a = this.attackP;
        sc = a < 0.5 ? 1 : a < 0.8 ? 0 : easeOutCubic((a - 0.8) / 0.2);
      }
      r.weapon.rotation.x = wx;
      r.weapon.scale.setScalar(Math.max(0.001, sc));
    }
    if (r.orbGlow) {
      let pulse = 0.62 + Math.sin(t * 5) * 0.05 + (this.attackP < 1 ? Math.sin(this.attackP * Math.PI) * 0.35 : 0);
      if (pose === "channel") pulse += poseW * (0.9 + Math.sin(t * 14) * 0.2);
      r.orbGlow.scale.setScalar(pulse);
    }

    // cape: damped spring that streams back with speed and flaps on each step
    const fdt = Math.min(dt, 1 / 30);
    if (r.cape) {
      const target = 0.06 + 0.4 * speedN + Math.abs(w) * 0.08 * mb + Math.sin(t * 1.7) * 0.04 + hop * 0.5;
      this.capeV += ((target - this.capeA) * 90 - this.capeV * 12) * fdt;
      this.capeA += this.capeV * fdt;
      // keep the lift modest: from the high camera a near-horizontal cape reads as a flat board
      r.cape.rotation.x = clamp(this.capeA, 0, 0.62);
      r.cape.rotation.z = clamp(this.yawVel * 0.04, -0.2, 0.2);
    }
    if (r.capeTip) {
      const flutter = Math.sin(t * 13 + this.walkT) * 0.16 * speedN + Math.sin(t * 2.3) * 0.05;
      const target = (r.cape ? this.capeA * 0.3 : 0) + flutter;
      this.capeTipV += ((target - this.capeTipA) * 70 - this.capeTipV * 9) * fdt;
      this.capeTipA += this.capeTipV * fdt;
      r.capeTip.rotation.x = clamp(this.capeTipA, -0.15, 0.45);
    }
    // floppy hat tip / pom-pom lags behind head motion
    if (r.hatTip) {
      const tx2 = -0.25 * speedN + (Math.abs(w) - 0.5) * 0.2 * mb + hop;
      const tz2 = clamp(this.yawVel * 0.08, -0.4, 0.4) + Math.sin(t * 1.9) * 0.05;
      this.hatV += ((tx2 - this.hatA) * 60 - this.hatV * 7) * fdt;
      this.hatA += this.hatV * fdt;
      this.hatZV += ((tz2 - this.hatZ) * 60 - this.hatZV * 7) * fdt;
      this.hatZ += this.hatZV * fdt;
      r.hatTip.rotation.x = this.hatA;
      r.hatTip.rotation.z = this.hatZ;
    }

    // hurt flash / invulnerability blink (an ultimate glows gold instead of blinking)
    const blink = this.invuln > 0 && !this.dead && this.ultGlow <= 0 ? (Math.sin(G.realTime * 30) > 0 ? 0.35 : 0) : 0;
    const f = Math.max(this.hurtFlash, blink);
    if (this.ultGlow > 0) {
      this.ultGlow = Math.max(0, this.ultGlow - dt * 2.5);
      const g = this.ultGlow * (0.42 + 0.18 * Math.sin(t * 16));
      const c = this.ultColor;
      for (const m of this.flashMats) m.emissive.setRGB(Math.max(f * 0.9, c.r * g), Math.max(f * 0.15, c.g * g), Math.max(f * 0.1, c.b * g));
    } else {
      for (const m of this.flashMats) m.emissive.setRGB(f * 0.9, f * 0.15, f * 0.1);
    }
    this.shadow.position.x = this.x;
    this.shadow.position.z = this.z;
    const shS = 1 - hop * 0.9;
    this.shadow.scale.set(shS, 1, shS);
  }

  /** blend the arms (and body lean) into the ultimate pose */
  private poseArms(pose: UltPose, w: number, t: number): void {
    const r = this.rig;
    let lx = 0;
    let lz = 0;
    let rx = 0;
    let rz = 0;
    let lean = 0;
    if (pose === "slam") {
      if (this.ultLand < 1) {
        // both arms overhead for the leap
        lx = -2.9;
        rx = -2.9;
        lz = -0.25;
        rz = 0.25;
      } else {
        // crouched follow-through, fists to the ground
        lx = -0.9;
        rx = -0.9;
        lz = -0.5;
        rz = 0.5;
        lean = 0.35;
      }
    } else if (pose === "channel") {
      // staff raised high, free hand pushed forward
      rx = -2.85 + Math.sin(t * 6) * 0.08;
      rz = 0.12;
      lx = -1.3;
      lz = -0.35;
      lean = -0.2;
    } else {
      // whirlwind: arms flung out
      lx = -0.2;
      rx = -0.2;
      lz = -1.35;
      rz = 1.35;
    }
    if (r.armL) {
      r.armL.rotation.x = lerp(r.armL.rotation.x, lx, w);
      r.armL.rotation.z = lerp(r.armL.rotation.z, lz, w);
    }
    if (r.armR) {
      r.armR.rotation.x = lerp(r.armR.rotation.x, rx, w);
      r.armR.rotation.z = lerp(r.armR.rotation.z, rz, w);
    }
    if (r.body) r.body.rotation.x = lerp(r.body.rotation.x, lean, w);
  }

  /** play the attack swing on the weapon arm (0..1 progress) */
  swing(progress: number): void {
    const arm = this.parts.armR;
    if (!arm) return;
    arm.userData.locked = progress < 1;
    this.swingP = progress;
    if (progress < 1) {
      // overhead wind-up -> fast diagonal slash -> slight overshoot
      const e = easeOutCubic(progress);
      arm.rotation.x = -2.5 + e * 3.0;
      arm.rotation.z = 0.5 - e * 0.35;
      if (progress < 0.08) this.kick(0.12);
    }
  }
}

function disposeModel(m: THREE.Object3D): void {
  m.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh || (o as THREE.Sprite).isSprite) {
      if (mesh.geometry && !(o as THREE.Sprite).isSprite) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    }
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton) sk.skeleton.dispose();
  });
}
