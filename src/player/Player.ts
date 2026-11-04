import * as THREE from "three";
import { G } from "../core/G";
import { Meta } from "../core/Meta";
import { damp } from "../core/math";
import { baseStats, xpToNext, type PlayerStats } from "./stats";
import { heroById, type HeroDef } from "./heroes";
import { blobShadowTexture } from "../fx/textures";

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

  /** seconds of invulnerability left (after revive etc.) */
  invuln = 0;
  /** contact-damage tick cooldown */
  private hurtCd = 0;
  /** 0..1 red flash */
  hurtFlash = 0;
  dead = false;
  private walkT = 0;
  private regenAcc = 0;

  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private parts: Record<string, THREE.Object3D | undefined> = {};
  private flashMats: THREE.MeshToonMaterial[] = [];
  private shadow: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    const sm = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      color: "#000000",
      opacity: 0.45,
    });
    const sg = new THREE.PlaneGeometry(1.4, 1.4);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, sm);
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
    this.setModel(this.hero.build());
    this.recalcStats();
    this.hp = this.stats.maxHp;
  }

  private setModel(m: THREE.Group): void {
    if (this.model) this.root.remove(this.model);
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
    if (this.dead || this.invuln > 0 || G.debug.god) return;
    const dmg = Math.max(1, amount - this.stats.armor);
    this.hp -= dmg;
    this.hurtFlash = 1;
    G.overlay.playerHit(dmg);
    G.audio.sfx("hurt");
    G.world.shake(0.35);
    G.events.emit("playerHurt", { amount: dmg });
    if (this.hp <= 0) {
      if (this.stats.revives > 0) {
        this.stats.revives--;
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
    this.animate(dt, moving);
  }

  /** visual update; also used on the menu screen */
  animate(dt: number, moving: boolean): void {
    const targetYaw = Math.atan2(this.faceX, this.faceZ);
    let d = targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * damp(16, dt);
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.yaw;
    const speedN = Math.min(1, Math.hypot(this.velX, this.velZ) / Math.max(1, this.stats.moveSpeed));
    this.walkT += dt * (moving ? 11 : 2.5);
    const sw = Math.sin(this.walkT) * speedN;
    const p = this.parts;
    if (p.legL) p.legL.rotation.x = sw * 0.8;
    if (p.legR) p.legR.rotation.x = -sw * 0.8;
    if (p.armL) p.armL.rotation.x = -sw * 0.6;
    if (p.armR && !p.armR.userData.locked) p.armR.rotation.x = sw * 0.4 - 0.3;
    if (p.body) {
      p.body.position.y = Math.abs(Math.sin(this.walkT)) * 0.06 * speedN + Math.sin(G.realTime * 2.4) * 0.015;
      p.body.rotation.z = Math.sin(this.walkT * 0.5) * 0.05 * speedN;
      p.body.rotation.x = speedN * 0.12;
    }
    // hurt flash / invulnerability blink
    const blink = this.invuln > 0 && !this.dead ? (Math.sin(G.realTime * 30) > 0 ? 0.35 : 0) : 0;
    const f = Math.max(this.hurtFlash, blink);
    for (const m of this.flashMats) m.emissive.setRGB(f * 0.9, f * 0.15, f * 0.1);
    this.shadow.position.x = this.x;
    this.shadow.position.z = this.z;
  }

  /** play the attack swing on the weapon arm (0..1 progress) */
  swing(progress: number): void {
    const arm = this.parts.armR;
    if (!arm) return;
    arm.userData.locked = progress < 1;
    if (progress < 1) arm.rotation.x = -2.2 + progress * 2.6;
  }
}
