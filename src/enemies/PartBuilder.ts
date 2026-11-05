import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Part ids understood by the animated character shader (see AnimatedMaterial).
 * Models face +Z, stand on y = 0, roughly 1.3 units tall at scale 1.
 */
export const PART = {
  BODY: 0,
  ARM_L: 1, // swings around its pivot (shoulder) on the X axis
  ARM_R: 2,
  LEG_L: 3, // swings around its pivot (hip) on the X axis
  LEG_R: 4,
  HEAD: 5, // gentle wobble around the pivot (neck)
  STATIC: 6, // never animated by part rotation (still follows body sway/death)
} as const;

/** offset added to a part id to mark it as glowing (unlit, keeps full colour on shaded sides) */
export const GLOW = 10;
/** mark a part as glowing: `b.sphere(r, "#ff0", glow(PART.HEAD), ...)` */
export function glow(part: number): number {
  return part + GLOW;
}

type V3 = [number, number, number];

export interface PartOpts {
  pos?: V3;
  rot?: V3; // euler radians
  scale?: V3;
  pivot?: V3; // defaults to pos
}

/**
 * Builds one merged, non-indexed geometry from primitive parts with
 * per-vertex colour, part id and pivot. Use for enemies (one InstancedMesh per
 * type => one draw call for the whole horde of that type).
 */
export class PartBuilder {
  private geos: THREE.BufferGeometry[] = [];
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(src: THREE.BufferGeometry, color: THREE.ColorRepresentation, part: number, o: PartOpts = {}): this {
    let g = src.index ? src.toNonIndexed() : src.clone();
    g.deleteAttribute("uv");
    const pos = o.pos ?? [0, 0, 0];
    const rot = o.rot ?? [0, 0, 0];
    const sc = o.scale ?? [1, 1, 1];
    this.e.set(rot[0], rot[1], rot[2]);
    this.q.setFromEuler(this.e);
    this.tmp.compose(new THREE.Vector3(...pos), this.q, new THREE.Vector3(...sc));
    g.applyMatrix4(this.tmp);
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    // author colours in sRGB, convert to linear for the renderer
    c.convertSRGBToLinear();
    const colors = new Float32Array(n * 3);
    const parts = new Float32Array(n);
    const pivots = new Float32Array(n * 3);
    const pv = o.pivot ?? pos;
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      parts[i] = part;
      pivots[i * 3] = pv[0];
      pivots[i * 3 + 1] = pv[1];
      pivots[i * 3 + 2] = pv[2];
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aPart", new THREE.BufferAttribute(parts, 1));
    g.setAttribute("aPivot", new THREE.BufferAttribute(pivots, 3));
    this.geos.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: THREE.ColorRepresentation, part: number, o: PartOpts = {}): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, part, o);
  }

  sphere(r: number, color: THREE.ColorRepresentation, part: number, o: PartOpts = {}, seg = 10): this {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, Math.floor(seg * 0.75))), color, part, o);
  }

  cyl(rTop: number, rBot: number, h: number, color: THREE.ColorRepresentation, part: number, o: PartOpts = {}, seg = 10): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), color, part, o);
  }

  cone(r: number, h: number, color: THREE.ColorRepresentation, part: number, o: PartOpts = {}, seg = 8): this {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, part, o);
  }

  capsule(r: number, len: number, color: THREE.ColorRepresentation, part: number, o: PartOpts = {}): this {
    return this.add(new THREE.CapsuleGeometry(r, len, 4, 10), color, part, o);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    if (!merged) throw new Error("PartBuilder: merge failed");
    merged.computeBoundingSphere();
    for (const g of this.geos) g.dispose();
    this.geos = [];
    return merged;
  }
}

/**
 * A standard shambling humanoid body you can recolour/extend.
 * Arms hang down in the model; the shader raises them (zombie pose).
 */
export function humanoid(
  b: PartBuilder,
  c: { skin: string; shirt: string; pants: string; shoe?: string },
  o: { width?: number; height?: number; headR?: number; belly?: number } = {},
): PartBuilder {
  const w = o.width ?? 1;
  const h = o.height ?? 1;
  const hr = o.headR ?? 0.27;
  const hip = 0.42 * h;
  // legs
  b.box(0.17 * w, hip, 0.2, c.pants, PART.LEG_L, { pos: [-0.13 * w, hip / 2, 0], pivot: [-0.13 * w, hip, 0] });
  b.box(0.17 * w, hip, 0.2, c.pants, PART.LEG_R, { pos: [0.13 * w, hip / 2, 0], pivot: [0.13 * w, hip, 0] });
  if (c.shoe) {
    b.box(0.19 * w, 0.08, 0.26, c.shoe, PART.LEG_L, { pos: [-0.13 * w, 0.04, 0.03], pivot: [-0.13 * w, hip, 0] });
    b.box(0.19 * w, 0.08, 0.26, c.shoe, PART.LEG_R, { pos: [0.13 * w, 0.04, 0.03], pivot: [0.13 * w, hip, 0] });
  }
  // torso
  const torsoH = 0.5 * h;
  b.box(0.52 * w, torsoH, 0.32 * (o.belly ?? 1), c.shirt, PART.BODY, { pos: [0, hip + torsoH / 2, 0] });
  // arms (hanging down from the shoulder pivot)
  const sh = hip + torsoH - 0.06;
  const armL = 0.46 * h;
  b.box(0.13, armL, 0.14, c.shirt, PART.ARM_L, { pos: [-0.33 * w, sh - armL / 2 + 0.05, 0], pivot: [-0.33 * w, sh, 0] });
  b.box(0.13, armL, 0.14, c.shirt, PART.ARM_R, { pos: [0.33 * w, sh - armL / 2 + 0.05, 0], pivot: [0.33 * w, sh, 0] });
  b.box(0.12, 0.12, 0.12, c.skin, PART.ARM_L, { pos: [-0.33 * w, sh - armL + 0.02, 0], pivot: [-0.33 * w, sh, 0] });
  b.box(0.12, 0.12, 0.12, c.skin, PART.ARM_R, { pos: [0.33 * w, sh - armL + 0.02, 0], pivot: [0.33 * w, sh, 0] });
  // head
  const neck = hip + torsoH;
  b.sphere(hr, c.skin, PART.HEAD, { pos: [0, neck + hr * 0.85, 0], pivot: [0, neck, 0] }, 12);
  return b;
}
