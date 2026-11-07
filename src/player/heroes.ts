import * as THREE from "three";
import type { PlayerStats } from "./stats";
import { iconBg, type IconDraw } from "../ui/icons";
import {
  ModelKit,
  place,
  box,
  sph,
  cyl,
  cone,
  torus,
  ico,
  kitToonMaterial,
  kitOutlineMaterial,
} from "../world/ModelKit";
import { glowTexture } from "../fx/textures";
import type { UltimateDef } from "./ultimates/types";
import { ultKnight } from "./ultimates/knight";
import { ultMage } from "./ultimates/mage";
import { ultRanger } from "./ultimates/ranger";

/** how the hero's arm animates when its starting weapon fires */
export type AttackStyle = "swing" | "cast" | "throw";

export interface HeroDef {
  id: string;
  /** Thai display name */
  name: string;
  /** short Thai tagline */
  title: string;
  /** Thai description of the hero perk */
  desc: string;
  /** weapon id the hero starts with */
  startWeapon: string;
  /** stat overrides/bonuses applied on top of baseStats (multipliers multiply, others add) */
  bonus: Partial<PlayerStats>;
  /** gold price in the menu (0 = unlocked) */
  price: number;
  /** accent colour for UI */
  color: string;
  /** attack gesture played when the starting weapon fires (visual only) */
  attackStyle?: AttackStyle;
  /**
   * Build the 3D model (facing +Z, feet at y=0, ~1.5 units tall).
   * Named animated children: "body", "head", "armL", "armR", "legL", "legR",
   * "weapon" (optional) and optional "cape", "capeTip", "hatTip".
   * Parts are Bones of one SkinnedMesh with their pivot at the joint
   * (shoulder / hip / neck) so rotation.x swings them.
   */
  build: () => THREE.Group;
  portrait: IconDraw;
  /**
   * The hero's ultimate (ไม้ตาย): Thai `name` / `desc` and `icon` are ready for
   * menus (e.g. `iconURL("ult:" + ultimate.id, ultimate.icon)`).
   */
  ultimate: UltimateDef;
}

// ---------------------------------------------------------------------------
// rig
// ---------------------------------------------------------------------------

/** bone indices shared by every hero */
const B = {
  rig: 0,
  body: 1,
  head: 2,
  armL: 3,
  armR: 4,
  legL: 5,
  legR: 6,
  weapon: 7,
  cape: 8,
  capeTip: 9,
  hatTip: 10,
} as const;

interface BoneSpec {
  name: string;
  parent: number;
  /** rest pivot in model space */
  p: [number, number, number];
}

/** pivots in model space (rest pose: arms hanging, legs straight) */
function boneSpecs(hatTip: [number, number, number] = [0, 1.5, -0.05]): BoneSpec[] {
  return [
    { name: "rig", parent: -1, p: [0, 0, 0] },
    { name: "body", parent: B.rig, p: [0, 0.36, 0] },
    { name: "head", parent: B.body, p: [0, 0.8, 0] },
    { name: "armL", parent: B.body, p: [-0.3, 0.72, 0] },
    { name: "armR", parent: B.body, p: [0.3, 0.72, 0] },
    { name: "legL", parent: B.rig, p: [-0.12, 0.36, 0] },
    { name: "legR", parent: B.rig, p: [0.12, 0.36, 0] },
    { name: "weapon", parent: B.armR, p: [0.31, 0.43, 0.02] },
    { name: "cape", parent: B.body, p: [0, 0.76, -0.24] },
    { name: "capeTip", parent: B.cape, p: [0, 0.5, -0.27] },
    { name: "hatTip", parent: B.head, p: hatTip },
  ];
}

/** turn a filled ModelKit into one SkinnedMesh + outline hull sharing a skeleton */
function finishRig(
  k: ModelKit,
  specs: BoneSpec[],
  extras?: (bones: THREE.Bone[]) => void,
): THREE.Group {
  const root = new THREE.Group();
  const geo = k.build(true);
  const oGeo = k.buildOutline(true);
  k.dispose();

  const mesh = new THREE.SkinnedMesh(geo, kitToonMaterial({ rim: 0.42, rimColor: "#d6ecff" }));
  const bones = specs.map((s) => {
    const b = new THREE.Bone();
    b.name = s.name;
    return b;
  });
  specs.forEach((s, i) => {
    const pp = s.parent >= 0 ? specs[s.parent].p : [0, 0, 0];
    bones[i].position.set(s.p[0] - pp[0], s.p[1] - pp[1], s.p[2] - pp[2]);
    if (s.parent >= 0) bones[s.parent].add(bones[i]);
  });
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);

  const outline = new THREE.SkinnedMesh(oGeo, kitOutlineMaterial("#1a1324", 0.034));
  outline.bind(skeleton, mesh.bindMatrix);

  mesh.frustumCulled = false;
  outline.frustumCulled = false;
  root.add(mesh, outline);
  for (const b of bones) b.userData.base = b.position.clone();
  extras?.(bones);
  return root;
}

// ---------------------------------------------------------------------------
// shared face
// ---------------------------------------------------------------------------

/** big chibi eyes + highlights + blush + mouth on a head sphere centred at (0, cy, 0) */
function addFace(
  k: ModelKit,
  cy: number,
  r: number,
  o: { eyeY?: number; eyeX?: number; eye?: string; blush?: string; mouth?: string; brows?: string } = {},
): void {
  const eyeY = o.eyeY ?? cy - 0.04;
  const eyeX = o.eyeX ?? 0.115;
  const onSurf = (x: number, y: number, inset = 0.012): number =>
    Math.sqrt(Math.max(0, r * r - x * x - (y - cy) * (y - cy))) - inset;
  for (const s of [-1, 1]) {
    const x = eyeX * s;
    const z = onSurf(x, eyeY, 0.008);
    k.add(place(sph(0.058, 10, 8), x, eyeY, z, 0, 0, 0, 0.85, 1.2, 0.55), o.eye ?? "#1a1424", {
      bone: B.head,
      outline: false,
    });
    k.add(place(sph(0.019, 6, 4), x + 0.016 * s, eyeY + 0.026, z + 0.02), "#ffffff", {
      bone: B.head,
      glow: 1,
      outline: false,
    });
    const bx = 0.185 * s;
    const by = eyeY - 0.07;
    k.add(place(sph(0.045, 8, 6), bx, by, onSurf(bx, by, 0.015), 0, 0.5 * s, 0, 1, 0.55, 0.35), o.blush ?? "#ff8fa0", {
      bone: B.head,
      outline: false,
      glow: 0.25,
    });
    if (o.brows) {
      k.add(place(box(0.07, 0.018, 0.02), x, eyeY + 0.085, onSurf(x, eyeY + 0.085, 0.0), 0, 0, -0.25 * s), o.brows, {
        bone: B.head,
        outline: false,
      });
    }
  }
  const my = eyeY - 0.11;
  k.add(place(sph(0.03, 8, 6), 0, my, onSurf(0, my, 0.01), 0, 0, 0, 1.3, 0.6, 0.5), o.mouth ?? "#7a2a35", {
    bone: B.head,
    outline: false,
  });
}

/** a row of small downward cones (hair fringe) just above the eyes on a head sphere */
function fringe(k: ModelKit, y: number, r: number, cy: number, color: string, xs: number[]): void {
  for (const x of xs) {
    const z = Math.sqrt(Math.max(0, r * r - x * x - (y - cy) * (y - cy))) - 0.005;
    k.add(place(cone(0.055, 0.13, 6), x, y, z, Math.PI - 0.35, 0, x * 1.5), color, { bone: B.head, outline: false });
  }
}

// ---------------------------------------------------------------------------
// อัศวินถังเหล็ก — bucket knight
// ---------------------------------------------------------------------------

function buildKnight(): THREE.Group {
  const k = new ModelKit();
  const steel = "#cfd8e3";
  const steelDark = "#8e9cab";
  const teal = "#17b3a6";
  const gold = "#ffc94a";

  // legs + boots
  for (const s of [-1, 1]) {
    const bone = s < 0 ? B.legL : B.legR;
    const x = 0.12 * s;
    k.add(place(cyl(0.085, 0.08, 0.24, 10), x, 0.24, 0), "#4a5878", { bone });
    k.add(place(cyl(0.095, 0.095, 0.05, 10), x, 0.16, 0), steel, { bone });
    k.add(place(box(0.17, 0.13, 0.25), x, 0.065, 0.03), "#5e3c25", { bone, shadeBottom: 0.7 });
  }

  // torso: rounded breastplate, tabard, belt
  k.add(place(sph(0.27, 16, 12), 0, 0.57, 0, 0, 0, 0, 1, 1.02, 0.86), steel, { bone: B.body, shadeBottom: 0.75 });
  k.add(place(box(0.28, 0.3, 0.05), 0, 0.5, 0.215, -0.12), teal, { bone: B.body, shadeBottom: 0.8 });
  k.add(place(cyl(0.06, 0.06, 0.03, 12), 0, 0.56, 0.245, Math.PI / 2 - 0.12), gold, { bone: B.body, glow: 0.2 });
  k.add(place(torus(0.255, 0.035, 6, 18), 0, 0.38, 0, Math.PI / 2), "#6b4a2b", { bone: B.body });
  k.add(place(box(0.08, 0.07, 0.04), 0, 0.38, 0.26), gold, { bone: B.body, glow: 0.15 });
  // collar
  k.add(place(torus(0.15, 0.045, 6, 14), 0, 0.8, 0, Math.PI / 2), teal, { bone: B.body });

  // arms: pauldrons, chain sleeves, gauntlets
  for (const s of [-1, 1]) {
    const bone = s < 0 ? B.armL : B.armR;
    const x = 0.31 * s;
    k.add(place(sph(0.12, 12, 8), x + 0.01 * s, 0.73, 0, 0, 0, 0, 1, 0.78, 1), steel, { bone });
    k.add(place(cyl(0.068, 0.062, 0.24, 8), x, 0.58, 0), steelDark, { bone });
    k.add(place(sph(0.082, 10, 8), x, 0.43, 0.01), steel, { bone });
  }
  // round shield on the left arm (faces outward/forward)
  const sx = -0.43;
  k.add(place(cyl(0.21, 0.21, 0.05, 18), sx, 0.52, 0.04, 0, 0.5, Math.PI / 2), "#c0803c", { bone: B.armL, shadeBottom: 0.8 });
  k.add(place(torus(0.21, 0.028, 6, 20), sx, 0.52, 0.04, 0, Math.PI / 2 + 0.5, 0), steel, { bone: B.armL });
  k.add(place(sph(0.06, 10, 8), sx - 0.03, 0.52, 0.06), gold, { bone: B.armL, glow: 0.2 });

  // head: face, bucket helmet (tilted back so the eyes peek out), handle crest, pom-pom
  const hy = 1.08;
  k.add(place(sph(0.3, 18, 14), 0, hy, 0), "#ffd9b8", { bone: B.head });
  addFace(k, hy, 0.3, { eyeY: 1.03, eyeX: 0.11 });
  const bt = -0.3; // bucket tilt
  const bc = 1.28; // bucket centre height
  const by = (dy: number): number => bc + dy * Math.cos(bt);
  const bz = (dy: number): number => -0.03 + dy * Math.sin(bt);
  k.add(place(cyl(0.25, 0.33, 0.3, 18), 0, bc, -0.03, bt), "#b4c1cd", { bone: B.head, shadeBottom: 0.78 });
  k.add(place(torus(0.33, 0.032, 6, 22), 0, by(-0.15), bz(-0.15), Math.PI / 2 + bt), steelDark, { bone: B.head });
  k.add(place(torus(0.292, 0.02, 5, 22), 0, by(0.0), bz(0.0), Math.PI / 2 + bt), "#97a4b2", { bone: B.head });
  for (const s of [-1, 1]) {
    k.add(place(sph(0.026, 6, 4), 0.3 * s, by(-0.07), bz(-0.07)), steelDark, { bone: B.head, outline: false });
  }
  // bucket handle used as a crest, tilted back; the pom-pom wobbles on its own bone
  k.add(place(torus(0.29, 0.02, 5, 18, Math.PI), 0, 1.33, -0.05, -0.5), "#76838f", { bone: B.head });
  k.add(place(sph(0.08, 10, 8), 0, 1.6, -0.2), "#ff4d5e", { bone: B.hatTip, glow: 0.12 });

  // sword (weapon bone at the right hand)
  const wx = 0.31;
  const wy = 0.43;
  k.add(place(cyl(0.024, 0.024, 0.16, 6), wx, wy, 0.06, Math.PI / 2), "#6b3f22", { bone: B.weapon });
  k.add(place(sph(0.035, 6, 4), wx, wy, -0.03), gold, { bone: B.weapon });
  k.add(place(box(0.22, 0.045, 0.055), wx, wy, 0.15), gold, { bone: B.weapon, glow: 0.15 });
  k.add(place(box(0.08, 0.026, 0.58), wx, wy, 0.46), "#eef6ff", { bone: B.weapon, glow: 0.3 });
  k.add(place(cone(0.057, 0.13, 4), wx, wy, 0.81, Math.PI / 2, 0, 0, 1, 1, 0.33), "#eef6ff", {
    bone: B.weapon,
    glow: 0.3,
  });

  // cape (two segments)
  k.add(place(box(0.46, 0.3, 0.04), 0, 0.62, -0.27, 0.05), teal, { bone: B.cape, shadeBottom: 0.85 });
  k.add(place(box(0.5, 0.26, 0.04), 0, 0.37, -0.28), "#119085", { bone: B.capeTip, shadeBottom: 0.75 });

  return finishRig(k, boneSpecs([0, 1.54, -0.17]));
}

// ---------------------------------------------------------------------------
// จอมเวทฝึกหัด — apprentice mage
// ---------------------------------------------------------------------------

function buildMage(): THREE.Group {
  const k = new ModelKit();
  const robe = "#7b4fe0";
  const robeDark = "#4b2fa0";
  const hat = "#3f2c96";
  const gold = "#ffcf4d";

  // legs + shoes peeking under the robe
  for (const s of [-1, 1]) {
    const bone = s < 0 ? B.legL : B.legR;
    const x = 0.11 * s;
    k.add(place(cyl(0.06, 0.06, 0.26, 8), x, 0.23, 0), "#2e2846", { bone });
    k.add(place(sph(0.085, 10, 8), x, 0.05, 0.04, 0, 0, 0, 1, 0.65, 1.45), "#4a2e1e", { bone });
  }

  // robe (body)
  k.add(place(cyl(0.21, 0.36, 0.5, 18), 0, 0.47, 0), robe, { bone: B.body, shadeBottom: 0.72 });
  k.add(place(torus(0.355, 0.035, 6, 22), 0, 0.225, 0, Math.PI / 2), gold, { bone: B.body, glow: 0.15 });
  k.add(place(sph(0.245, 16, 12), 0, 0.69, 0, 0, 0, 0, 1, 0.85, 0.9), robe, { bone: B.body });
  k.add(place(torus(0.16, 0.05, 6, 14), 0, 0.8, 0, Math.PI / 2), robeDark, { bone: B.body });
  k.add(place(torus(0.255, 0.03, 6, 18), 0, 0.58, 0, Math.PI / 2 + 0.12), "#ff9f43", { bone: B.body });
  // little stars on the robe
  const stars: [number, number][] = [
    [0.13, 0.4],
    [-0.16, 0.5],
    [0.04, 0.3],
  ];
  for (const [x, y] of stars) {
    const rr = 0.36 - (y - 0.22) * 0.3;
    const z = Math.sqrt(Math.max(0, rr * rr - x * x)) - 0.01;
    k.add(place(ico(0.035), x, y, z), gold, { bone: B.body, glow: 0.6, outline: false });
  }
  // spell book on the hip
  k.add(place(box(0.13, 0.16, 0.05), -0.3, 0.46, 0.06, 0, 0.35, 0.1), "#9b4a2a", { bone: B.body });
  k.add(place(box(0.11, 0.14, 0.055), -0.295, 0.46, 0.065, 0, 0.35, 0.1), "#fff1cf", { bone: B.body, outline: false });

  // arms: wide sleeves + hands
  for (const s of [-1, 1]) {
    const bone = s < 0 ? B.armL : B.armR;
    const x = 0.3 * s;
    k.add(place(cyl(0.07, 0.115, 0.26, 10), x, 0.57, 0), robe, { bone });
    k.add(place(torus(0.105, 0.022, 5, 12), x, 0.45, 0, Math.PI / 2), gold, { bone });
    k.add(place(sph(0.068, 10, 8), x, 0.42, 0.01), "#ffe0c4", { bone });
  }

  // head: face, hair, wizard hat with floppy tip
  const hy = 1.08;
  k.add(place(sph(0.31, 18, 14), 0, hy, 0), "#ffe0c4", { bone: B.head });
  addFace(k, hy, 0.31, { eyeY: 1.05, eyeX: 0.12 });
  const hair = "#d0663a";
  k.add(place(sph(0.31, 14, 10), 0, 1.12, -0.07, 0, 0, 0, 1.03, 0.92, 0.95), hair, { bone: B.head });
  for (const s of [-1, 1]) {
    k.add(place(sph(0.12, 10, 8), 0.25 * s, 1.0, -0.04), hair, { bone: B.head });
  }
  fringe(k, 1.205, 0.31, hy, hair, [-0.15, -0.05, 0.05, 0.15]);
  // brim tilted back so the face stays visible from the high camera
  const tilt = -0.32;
  k.add(place(cyl(0.46, 0.46, 0.04, 22), 0, 1.3, -0.02, tilt), hat, { bone: B.head });
  k.add(place(cyl(0.2, 0.29, 0.3, 18), 0, 1.44, -0.07, tilt), hat, { bone: B.head, shadeBottom: 0.85 });
  k.add(place(torus(0.275, 0.035, 6, 20), 0, 1.345, -0.035, Math.PI / 2 + tilt), gold, { bone: B.head, glow: 0.15 });
  k.add(place(ico(0.06), 0.02, 1.38, 0.24), gold, { bone: B.head, glow: 0.7, outline: false });
  // hat tip on its own bone so it flops
  k.add(place(cone(0.2, 0.44, 16), 0, 1.74, -0.21, -0.62), hat, { bone: B.hatTip });
  k.add(place(sph(0.055, 8, 6), 0, 1.92, -0.35), gold, { bone: B.hatTip, glow: 0.7 });

  // staff: shaft, crook, glowing orb
  const wx = 0.37;
  k.add(place(cyl(0.03, 0.034, 1.3, 7), wx, 0.72, 0.06), "#8a5a2b", { bone: B.weapon, shadeBottom: 0.7 });
  k.add(place(torus(0.09, 0.03, 6, 12, Math.PI * 1.2), wx, 1.4, 0.06, 0, 0, -0.3), "#8a5a2b", { bone: B.weapon });
  k.add(place(sph(0.11, 14, 10), wx, 1.48, 0.06), "#7ff6ff", { bone: B.weapon, glow: 1 });
  k.add(place(torus(0.15, 0.014, 5, 18), wx, 1.48, 0.06, 1.1, 0.4, 0), gold, { bone: B.weapon, glow: 0.4, outline: false });

  // short capelet
  k.add(place(box(0.42, 0.28, 0.035), 0, 0.62, -0.29, 0.06), robeDark, { bone: B.cape });
  k.add(place(box(0.46, 0.22, 0.035), 0, 0.39, -0.3), "#3a2380", { bone: B.capeTip, shadeBottom: 0.8 });
  k.add(place(ico(0.04), 0, 0.4, -0.325), gold, { bone: B.capeTip, glow: 0.6, outline: false });

  return finishRig(k, boneSpecs([0, 1.56, -0.1]), (bones) => {
    // soft additive halo around the orb (child of the weapon bone)
    const mat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: "#59e8ff",
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    });
    const halo = new THREE.Sprite(mat);
    halo.name = "orbGlow";
    halo.scale.setScalar(0.62);
    halo.position.set(0.06, 1.05, 0.04);
    bones[B.weapon].add(halo);
  });
}

// ---------------------------------------------------------------------------
// พรานขวานบิน — flying-axe ranger
// ---------------------------------------------------------------------------

function buildRanger(): THREE.Group {
  const k = new ModelKit();
  // warm leather tones: a green tunic vanished into the grass and the shambler horde
  const green = "#d9772b";
  const greenDark = "#9a4a1c";
  const leather = "#7a4a26";
  const steel = "#e3e9f0";

  // legs, boots, fur cuffs
  for (const s of [-1, 1]) {
    const bone = s < 0 ? B.legL : B.legR;
    const x = 0.12 * s;
    k.add(place(cyl(0.08, 0.075, 0.22, 10), x, 0.25, 0), "#5b3b22", { bone });
    k.add(place(box(0.16, 0.14, 0.24), x, 0.07, 0.03), leather, { bone, shadeBottom: 0.7 });
    k.add(place(torus(0.085, 0.032, 6, 12), x, 0.15, 0.01, Math.PI / 2), "#f3e6c8", { bone });
  }

  // tunic, skirt, belt, strap
  k.add(place(sph(0.26, 16, 12), 0, 0.57, 0, 0, 0, 0, 1, 1.03, 0.88), green, { bone: B.body, shadeBottom: 0.8 });
  k.add(place(cyl(0.25, 0.3, 0.14, 16), 0, 0.37, 0), greenDark, { bone: B.body });
  k.add(place(torus(0.255, 0.03, 6, 18), 0, 0.44, 0, Math.PI / 2), "#6b4223", { bone: B.body });
  k.add(place(box(0.08, 0.07, 0.04), 0, 0.44, 0.265), "#ffc94a", { bone: B.body, glow: 0.15 });
  k.add(place(box(0.06, 0.52, 0.03), 0.02, 0.58, 0.215, -0.12, 0, 0.62), leather, { bone: B.body, outline: false });
  // two spare axes strapped on the back (crossed)
  for (const s of [-1, 1]) {
    const rz = 0.6 * s;
    k.add(place(cyl(0.02, 0.02, 0.42, 6), 0, 0.62, -0.27, 0, 0, rz), "#8a5a2b", { bone: B.body });
    const tx = -0.2 * Math.sin(rz);
    const ty = 0.62 + 0.2 * Math.cos(rz);
    k.add(place(box(0.13, 0.11, 0.035), tx - 0.05 * s, ty, -0.28, 0, 0, rz), steel, { bone: B.body });
  }

  // scarf (body) + tail (cape bones)
  k.add(place(torus(0.19, 0.07, 8, 16), 0, 0.81, 0, Math.PI / 2), "#ffbf2e", { bone: B.body });
  k.add(place(box(0.13, 0.28, 0.04), 0.1, 0.62, -0.27, 0.05, 0, 0.08), "#ffbf2e", { bone: B.cape });
  k.add(place(box(0.13, 0.22, 0.04), 0.12, 0.39, -0.29, 0, 0, 0.12), "#ff9a1f", { bone: B.capeTip });

  // arms: sleeves, bracers, hands
  for (const s of [-1, 1]) {
    const bone = s < 0 ? B.armL : B.armR;
    const x = 0.3 * s;
    k.add(place(cyl(0.07, 0.065, 0.22, 8), x, 0.6, 0), green, { bone });
    k.add(place(cyl(0.078, 0.078, 0.09, 8), x, 0.48, 0), leather, { bone });
    k.add(place(sph(0.068, 10, 8), x, 0.42, 0.01), "#f1c49b", { bone });
  }

  // head: face, bangs, hood (open front), hood tip, feather
  const hy = 1.08;
  k.add(place(sph(0.3, 18, 14), 0, hy, 0), "#f1c49b", { bone: B.head });
  addFace(k, hy, 0.3, { eyeY: 1.03, eyeX: 0.115, brows: "#7a3418" });
  const hair = "#8a3a1e";
  fringe(k, 1.17, 0.3, hy, hair, [-0.1, 0, 0.1]);
  // hood: closed cap over the top + open-fronted skirt around the sides/back
  const hr = 0.345;
  const capT = Math.PI * 0.4;
  const open = 1.0; // half-angle of the face opening
  k.add(place(new THREE.SphereGeometry(hr, 18, 7, 0, Math.PI * 2, 0, capT), 0, 1.1, -0.02), greenDark, { bone: B.head });
  k.add(
    place(
      new THREE.SphereGeometry(hr, 18, 6, Math.PI / 2 + open, Math.PI * 2 - open * 2, capT, Math.PI * 0.32),
      0,
      1.1,
      -0.02,
    ),
    greenDark,
    { bone: B.head },
  );
  k.add(place(torus(hr * Math.sin(capT), 0.04, 6, 20), 0, 1.1 + hr * Math.cos(capT), -0.02, Math.PI / 2), green, {
    bone: B.head,
  });
  k.add(place(cone(0.13, 0.32, 10), 0, 1.33, -0.32, -2.0), greenDark, { bone: B.hatTip });
  k.add(place(sph(0.06, 8, 6), 0.27, 1.38, -0.06, 0, 0, -0.55, 0.6, 2.6, 0.3), "#ff6a3d", { bone: B.head, glow: 0.15 });

  // hand axe: handle + crescent blade
  const wx = 0.31;
  const wy = 0.43;
  k.add(place(cyl(0.025, 0.025, 0.44, 6), wx, wy, 0.15, Math.PI / 2), "#8a5a2b", { bone: B.weapon });
  k.add(
    place(new THREE.CylinderGeometry(0.15, 0.15, 0.035, 14, 1, false, 0, Math.PI), wx, wy + 0.01, 0.32, 0, 0, Math.PI / 2),
    steel,
    { bone: B.weapon, glow: 0.25 },
  );
  k.add(place(box(0.05, 0.07, 0.08), wx, wy - 0.02, 0.32), "#9aa5b1", { bone: B.weapon });

  return finishRig(k, boneSpecs([0, 1.36, -0.24]));
}

// ---------------------------------------------------------------------------
// portraits (2D canvas)
// ---------------------------------------------------------------------------

const INK = "#140f1c";

function blob(c: CanvasRenderingContext2D, s: number, fill: string, path: () => void, lw = 0.045): void {
  c.beginPath();
  path();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = s * lw;
  c.strokeStyle = INK;
  c.stroke();
}

function eyes(c: CanvasRenderingContext2D, s: number, cx: number, cy: number, gap: number, size: number): void {
  for (const sx of [-1, 1]) {
    const x = cx + gap * sx;
    c.fillStyle = INK;
    c.beginPath();
    c.ellipse(x, cy, size * 0.8, size, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(x + size * 0.28, cy - size * 0.38, size * 0.32, 0, Math.PI * 2);
    c.fill();
  }
  // blush
  c.fillStyle = "rgba(255,120,140,0.55)";
  for (const sx of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + (gap + size * 1.6) * sx, cy + size * 1.25, size * 0.9, size * 0.5, 0, 0, Math.PI * 2);
    c.fill();
  }
  // smile
  c.strokeStyle = INK;
  c.lineWidth = s * 0.025;
  c.beginPath();
  c.arc(cx, cy + size * 1.3, size * 0.55, 0.2 * Math.PI, 0.8 * Math.PI);
  c.stroke();
}

const knightPortrait: IconDraw = (c, s) => {
  iconBg(c, s, "#1fa39a");
  c.save();
  c.lineJoin = "round";
  // cape collar
  blob(c, s, "#17b3a6", () => c.ellipse(s * 0.5, s * 0.98, s * 0.36, s * 0.2, 0, Math.PI, 0));
  // face
  blob(c, s, "#ffd9b8", () => c.arc(s * 0.5, s * 0.6, s * 0.25, 0, Math.PI * 2));
  eyes(c, s, s * 0.5, s * 0.6, s * 0.095, s * 0.045);
  // bucket helmet (narrow top, wide bottom) pulled down to the eyebrows
  blob(c, s, "#b4c1cd", () => {
    c.moveTo(s * 0.27, s * 0.52);
    c.lineTo(s * 0.33, s * 0.2);
    c.lineTo(s * 0.67, s * 0.2);
    c.lineTo(s * 0.73, s * 0.52);
    c.closePath();
  });
  c.fillStyle = "rgba(255,255,255,0.45)";
  c.fillRect(s * 0.36, s * 0.24, s * 0.05, s * 0.24);
  blob(c, s, "#8e9cab", () => c.roundRect(s * 0.25, s * 0.49, s * 0.5, s * 0.06, s * 0.03), 0.03);
  blob(c, s, "#97a4b2", () => c.roundRect(s * 0.3, s * 0.33, s * 0.4, s * 0.035, s * 0.02), 0.025);
  // handle crest + pom-pom
  c.strokeStyle = INK;
  c.lineWidth = s * 0.07;
  c.beginPath();
  c.arc(s * 0.5, s * 0.27, s * 0.2, Math.PI * 1.08, Math.PI * 1.92);
  c.stroke();
  c.strokeStyle = "#76838f";
  c.lineWidth = s * 0.035;
  c.stroke();
  blob(c, s, "#ff4d5e", () => c.arc(s * 0.5, s * 0.08, s * 0.06, 0, Math.PI * 2), 0.035);
  c.restore();
};

const magePortrait: IconDraw = (c, s) => {
  iconBg(c, s, "#8b5cf6");
  c.save();
  c.lineJoin = "round";
  blob(c, s, "#7b4fe0", () => c.ellipse(s * 0.5, s * 1.0, s * 0.36, s * 0.22, 0, Math.PI, 0));
  // hair behind
  blob(c, s, "#d0663a", () => c.ellipse(s * 0.5, s * 0.62, s * 0.3, s * 0.26, 0, 0, Math.PI * 2));
  blob(c, s, "#ffe0c4", () => c.arc(s * 0.5, s * 0.64, s * 0.24, 0, Math.PI * 2));
  eyes(c, s, s * 0.5, s * 0.66, s * 0.1, s * 0.047);
  // bangs
  blob(c, s, "#d0663a", () => c.ellipse(s * 0.5, s * 0.47, s * 0.22, s * 0.08, 0, 0, Math.PI * 2), 0.03);
  // brim
  blob(c, s, "#3f2c96", () => c.ellipse(s * 0.5, s * 0.43, s * 0.42, s * 0.085, -0.06, 0, Math.PI * 2));
  // cone with floppy tip
  blob(c, s, "#3f2c96", () => {
    c.moveTo(s * 0.3, s * 0.42);
    c.quadraticCurveTo(s * 0.4, s * 0.2, s * 0.6, s * 0.08);
    c.quadraticCurveTo(s * 0.74, s * 0.04, s * 0.84, s * 0.14);
    c.quadraticCurveTo(s * 0.68, s * 0.16, s * 0.64, s * 0.26);
    c.lineTo(s * 0.7, s * 0.42);
    c.closePath();
  });
  blob(c, s, "#ffcf4d", () => c.roundRect(s * 0.31, s * 0.36, s * 0.39, s * 0.05, s * 0.02), 0.025);
  // star
  c.fillStyle = "#ffe680";
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? s * 0.025 : s * 0.06;
    c.lineTo(s * 0.84 + Math.cos(a) * r, s * 0.15 + Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
  c.restore();
};

const rangerPortrait: IconDraw = (c, s) => {
  iconBg(c, s, "#e8b23a");
  c.save();
  c.lineJoin = "round";
  // scarf
  blob(c, s, "#ffbf2e", () => c.ellipse(s * 0.5, s * 0.95, s * 0.34, s * 0.16, 0, Math.PI, 0));
  // hood back + point
  blob(c, s, "#9a4a1c", () => {
    c.moveTo(s * 0.2, s * 0.78);
    c.quadraticCurveTo(s * 0.14, s * 0.3, s * 0.42, s * 0.2);
    c.quadraticCurveTo(s * 0.62, s * 0.06, s * 0.86, s * 0.12);
    c.quadraticCurveTo(s * 0.74, s * 0.2, s * 0.78, s * 0.36);
    c.quadraticCurveTo(s * 0.86, s * 0.6, s * 0.8, s * 0.78);
    c.closePath();
  });
  // feather
  blob(c, s, "#ff6a3d", () => c.ellipse(s * 0.8, s * 0.3, s * 0.04, s * 0.13, 0.5, 0, Math.PI * 2), 0.03);
  // face
  blob(c, s, "#f1c49b", () => c.arc(s * 0.5, s * 0.6, s * 0.22, 0, Math.PI * 2));
  // bangs
  blob(c, s, "#b4502b", () => c.ellipse(s * 0.5, s * 0.42, s * 0.2, s * 0.075, 0, 0, Math.PI * 2), 0.03);
  eyes(c, s, s * 0.5, s * 0.6, s * 0.095, s * 0.045);
  // hood rim
  c.strokeStyle = INK;
  c.lineWidth = s * 0.075;
  c.beginPath();
  c.arc(s * 0.5, s * 0.58, s * 0.26, Math.PI * 0.85, Math.PI * 2.15);
  c.stroke();
  c.strokeStyle = "#d9772b";
  c.lineWidth = s * 0.045;
  c.stroke();
  c.restore();
};

export const HEROES: HeroDef[] = [
  {
    id: "knight",
    name: "อัศวินถังเหล็ก",
    title: "ทนทาน ฟันหนัก",
    desc: "เริ่มด้วยดาบพิฆาต • พลังชีวิต +20% • เกราะ +1",
    startWeapon: "slash",
    bonus: { maxHp: 20, armor: 1 },
    price: 0,
    color: "#1fa39a",
    attackStyle: "swing",
    build: buildKnight,
    portrait: knightPortrait,
    ultimate: ultKnight,
  },
  {
    id: "mage",
    name: "จอมเวทฝึกหัด",
    title: "ระยะไกล พลังเวท",
    desc: "เริ่มด้วยลูกไฟวิญญาณ • ขอบเขต +10% • สปีดโจมตี +5%",
    startWeapon: "missile",
    bonus: { area: 0.1, cooldown: -0.05 },
    price: 0,
    color: "#8b5cf6",
    attackStyle: "cast",
    build: buildMage,
    portrait: magePortrait,
    ultimate: ultMage,
  },
  {
    id: "ranger",
    name: "พรานขวานบิน",
    title: "ว่องไว คล่องตัว",
    desc: "เริ่มด้วยขวานบูมเมอแรง • ความเร็ว +10% • แม่เหล็ก +30%",
    startWeapon: "axe",
    bonus: { moveSpeed: 0.46, magnet: 0.7 },
    price: 0,
    color: "#e8b23a",
    attackStyle: "throw",
    build: buildRanger,
    portrait: rangerPortrait,
    ultimate: ultRanger,
  },
];

export function heroById(id: string): HeroDef {
  return HEROES.find((h) => h.id === id) ?? HEROES[0];
}
