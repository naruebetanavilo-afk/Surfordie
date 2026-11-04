import * as THREE from "three";
import { G } from "../../core/G";

export interface SpriteBatchOpts {
  /** "camera": quad faces the (fixed-pitch) camera; "ground": lies flat on XZ */
  facing?: "camera" | "ground";
  additive?: boolean;
  depthTest?: boolean;
  renderOrder?: number;
  /** base opacity for non-additive batches */
  opacity?: number;
}

/**
 * Textured quads whose transforms are rewritten every frame from CPU state
 * (things that follow projectiles or orbit the hero). One InstancedMesh, one
 * draw call. Usage per frame: begin() → add()… → end().
 * Additive batches fade by darkening the per-instance colour.
 */
export class SpriteBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly baseQ = new THREE.Quaternion();
  private readonly q = new THREE.Quaternion();
  private readonly rq = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly axis = new THREE.Vector3(0, 0, 1);

  constructor(
    scene: THREE.Scene,
    texture: THREE.Texture,
    readonly cap: number,
    o: SpriteBatchOpts = {},
  ) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const additive = o.additive ?? true;
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: o.depthTest ?? true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity: o.opacity ?? 1,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = o.renderOrder ?? 8;
    if ((o.facing ?? "camera") === "camera") {
      // the camera never rotates, only translates: a fixed tilt faces it
      this.baseQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -G.world.camPitch);
    } else {
      this.baseQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    }
    scene.add(this.mesh);
  }

  begin(): void {
    this.mesh.count = 0;
  }

  /** add a quad; `rot` spins it around its facing normal. Returns false when full. */
  add(x: number, y: number, z: number, size: number, color: THREE.Color, intensity = 1, rot = 0, stretch = 1): boolean {
    const i = this.mesh.count;
    if (i >= this.cap) return false;
    this.rq.setFromAxisAngle(this.axis, rot);
    this.q.multiplyQuaternions(this.baseQ, this.rq);
    this.p.set(x, y, z);
    this.s.set(size * stretch, size, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.c.setRGB(color.r * intensity, color.g * intensity, color.b * intensity);
    this.mesh.setColorAt(i, this.c);
    this.mesh.count = i + 1;
    return true;
  }

  end(): void {
    if (this.mesh.count === 0) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.mesh.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    const ic = this.mesh.instanceColor!;
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, this.mesh.count * 3);
    ic.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
