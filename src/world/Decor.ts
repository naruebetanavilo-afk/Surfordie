import * as THREE from "three";

/**
 * Procedural, infinitely tiling scenery (grass tufts, rocks, graves...).
 * Decorations are deterministic per world cell so they never "pop" when you
 * walk back. Purely visual: no collision.
 *
 * Core version: scattered grass tufts + small rocks. The environment pass can
 * extend this file freely (keep the public API: constructor(scene), update()).
 */
export class Decor {
  private tufts: THREE.InstancedMesh;
  private rocks: THREE.InstancedMesh;
  private readonly cell = 4;
  private readonly maxTufts = 900;
  private readonly maxRocks = 160;
  private lastCx = 1e9;
  private lastCz = 1e9;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private e = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    const tuftGeo = new THREE.ConeGeometry(0.12, 0.45, 4, 1);
    tuftGeo.translate(0, 0.22, 0);
    const tuftMat = new THREE.MeshLambertMaterial({ color: "#4f8a32" });
    this.tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, this.maxTufts);
    this.tufts.frustumCulled = false;
    this.tufts.count = 0;
    scene.add(this.tufts);

    const rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
    rockGeo.translate(0, 0.12, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: "#8b8f87", flatShading: true });
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, this.maxRocks);
    this.rocks.frustumCulled = false;
    this.rocks.count = 0;
    scene.add(this.rocks);
  }

  private hash(x: number, z: number, k: number): number {
    let h = (x * 374761393 + z * 668265263 + k * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  }

  update(cx: number, cz: number, halfW: number, halfH: number): void {
    const ccx = Math.floor(cx / this.cell);
    const ccz = Math.floor(cz / this.cell);
    if (ccx === this.lastCx && ccz === this.lastCz) return;
    this.lastCx = ccx;
    this.lastCz = ccz;
    const rx = Math.ceil((halfW + 4) / this.cell);
    const rz = Math.ceil((halfH + 4) / this.cell);
    let nt = 0;
    let nr = 0;
    for (let gz = ccz - rz; gz <= ccz + rz; gz++) {
      for (let gx = ccx - rx; gx <= ccx + rx; gx++) {
        const tuftsHere = Math.floor(this.hash(gx, gz, 1) * 4);
        for (let k = 0; k < tuftsHere && nt < this.maxTufts; k++) {
          const x = (gx + this.hash(gx, gz, 10 + k)) * this.cell;
          const z = (gz + this.hash(gx, gz, 20 + k)) * this.cell;
          const sc = 0.7 + this.hash(gx, gz, 30 + k) * 0.8;
          this.p.set(x, 0, z);
          this.e.set(0, this.hash(gx, gz, 40 + k) * 6.28, 0);
          this.q.setFromEuler(this.e);
          this.s.set(sc, sc, sc);
          this.m.compose(this.p, this.q, this.s);
          this.tufts.setMatrixAt(nt++, this.m);
        }
        if (this.hash(gx, gz, 2) < 0.12 && nr < this.maxRocks) {
          const x = (gx + this.hash(gx, gz, 50)) * this.cell;
          const z = (gz + this.hash(gx, gz, 51)) * this.cell;
          const sc = 0.5 + this.hash(gx, gz, 52) * 0.9;
          this.p.set(x, 0, z);
          this.e.set(0, this.hash(gx, gz, 53) * 6.28, 0);
          this.q.setFromEuler(this.e);
          this.s.set(sc, sc * 0.7, sc);
          this.m.compose(this.p, this.q, this.s);
          this.rocks.setMatrixAt(nr++, this.m);
        }
      }
    }
    this.tufts.count = nt;
    this.rocks.count = nr;
    this.tufts.instanceMatrix.needsUpdate = true;
    this.rocks.instanceMatrix.needsUpdate = true;
  }
}
