import * as THREE from "three";
import { G } from "../core/G";
import { toonGradient } from "../enemies/AnimatedMaterial";

export type PickupKind = "xp" | "coin" | "heal" | "magnet" | "chest" | "nuke";
const KINDS: PickupKind[] = ["xp", "coin", "heal", "magnet", "chest", "nuke"];
const MAX = 1600;

/** XP gem tiers: min value -> colour & size */
const GEM_TIERS = [
  { min: 0, color: new THREE.Color("#4fc3ff"), scale: 0.8 },
  { min: 5, color: new THREE.Color("#5cff7a"), scale: 1.0 },
  { min: 20, color: new THREE.Color("#ff4f6a"), scale: 1.2 },
  { min: 100, color: new THREE.Color("#c77dff"), scale: 1.45 },
];

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
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private pv = new THREE.Vector3();
  private sv = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const g = toonGradient();
    const gem = new THREE.OctahedronGeometry(0.17, 0);
    gem.scale(1, 1.5, 1);
    const gemMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const coin = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14);
    coin.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshToonMaterial({ color: "#ffcc33", gradientMap: g, emissive: "#6b4a00" });
    const heart = new THREE.SphereGeometry(0.24, 12, 8);
    const heartMat = new THREE.MeshToonMaterial({ color: "#ff4d6d", gradientMap: g, emissive: "#550010" });
    const mag = new THREE.TorusGeometry(0.2, 0.07, 8, 14, Math.PI);
    mag.rotateZ(Math.PI);
    const magMat = new THREE.MeshToonMaterial({ color: "#e23b3b", gradientMap: g, emissive: "#330000" });
    const chest = new THREE.BoxGeometry(0.7, 0.5, 0.5);
    chest.translate(0, 0.1, 0);
    const chestMat = new THREE.MeshToonMaterial({ color: "#d99a2b", gradientMap: g, emissive: "#3b2000" });
    const nuke = new THREE.IcosahedronGeometry(0.25, 0);
    const nukeMat = new THREE.MeshToonMaterial({ color: "#ff8a00", gradientMap: g, emissive: "#552200" });
    const defs: [THREE.BufferGeometry, THREE.Material, number][] = [
      [gem, gemMat, MAX],
      [coin, coinMat, 256],
      [heart, heartMat, 32],
      [mag, magMat, 16],
      [chest, chestMat, 16],
      [nuke, nukeMat, 16],
    ];
    for (const [geo, mat, cap] of defs) {
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    // gems use instance colours
    const gm = this.meshes[0];
    for (let i = 0; i < MAX; i++) gm.setColorAt(i, this.col.set("#ffffff"));
  }

  clear(): void {
    this.n = 0;
    for (const m of this.meshes) m.count = 0;
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
        const g = Math.max(1, Math.round(v * p.stats.greed));
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
        G.world.shake(0.8);
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

  render(): void {
    for (const m of this.meshes) m.count = 0;
    const t = G.realTime;
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i];
      const mesh = this.meshes[k];
      if (mesh.count >= mesh.instanceMatrix.count) continue;
      const s = this.seed[i];
      let y = 0.35 + Math.sin(t * 3 + s) * 0.08;
      let sc = 1;
      let yaw = t * 2 + s;
      if (k === 0) {
        const v = this.value[i];
        let tier = GEM_TIERS[0];
        for (const g of GEM_TIERS) if (v >= g.min) tier = g;
        sc = tier.scale;
        mesh.setColorAt(mesh.count, tier.color);
      } else if (k === 4) {
        y = 0.05;
        yaw = 0.3;
        sc = 1 + Math.sin(t * 5) * 0.05;
      } else if (k === 1) {
        yaw = t * 4 + s;
      }
      // pop-in
      const a = Math.min(1, this.age[i] * 6);
      sc *= a;
      this.e.set(0, yaw, 0);
      this.q.setFromEuler(this.e);
      this.pv.set(this.x[i], y, this.z[i]);
      this.sv.setScalar(sc);
      this.m.compose(this.pv, this.q, this.sv);
      mesh.setMatrixAt(mesh.count++, this.m);
    }
    for (const m of this.meshes) {
      if (m.count > 0) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }
}
