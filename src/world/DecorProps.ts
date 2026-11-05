import * as THREE from "three";
import { ModelKit, place, box, sph, cyl, cone, torus, dodeca, ico } from "./ModelKit";

/**
 * Original spooky-cute scenery props, built procedurally with ModelKit.
 * Every prop: base at y=0, roughly centred on the origin, front = +Z.
 * Colours are baked as vertex colours (instance colour multiplies them).
 */

/** additive light attached to a prop (local offset), drawn by the decor glow layer */
export interface PropGlow {
  x: number;
  y: number;
  z: number;
  size: number;
  color: string;
  /** 0 = camera-facing halo, 1 = flat pool of light on the ground, 2 = drifting firefly */
  mode: 0 | 1 | 2;
}

export interface PropDef {
  name: string;
  build: () => THREE.BufferGeometry;
  /** relative pick weight inside its zone list */
  glows?: PropGlow[];
  /** allow a small random tilt (graves lean) */
  tilt?: number;
  /** base scale range */
  scale: [number, number];
  /** tint palette (multiplies vertex colours); white = untinted */
  tints?: string[];
}

const SHADOW = "#2e5a26";

/** flat dark disc that grounds a prop (cheap fake contact shadow) */
function groundShadow(k: ModelKit, r: number, sx = 1, sz = 1, x = 0, z = 0): void {
  k.add(place(cyl(r, r, 0.01, 16), x, 0.008, z, 0, 0, 0, sx, 1, sz), SHADOW);
}

// --------------------------------------------------------------------------- grass

export function buildGrassTuft(): THREE.BufferGeometry {
  const k = new ModelKit();
  const blades: [number, number, number, number, number][] = [
    // x, z, height, leanX, leanZ
    [0, 0, 0.42, 0, 0],
    [0.07, 0.03, 0.33, -0.35, 0.1],
    [-0.07, 0.02, 0.36, 0.35, 0.15],
    [0.02, -0.07, 0.3, 0.1, 0.35],
    [-0.03, 0.07, 0.28, -0.1, -0.4],
  ];
  for (const [x, z, h, lx, lz] of blades) {
    const g = cone(0.045, h, 3);
    g.translate(0, h / 2, 0);
    k.add(place(g, x, 0, z, lz, 0, lx), "#7cc94f", { shadeBottom: 0.45 });
  }
  return k.build();
}

// --------------------------------------------------------------------------- small props

function flowers(): THREE.BufferGeometry {
  const k = new ModelKit();
  const heads: [number, number, number][] = [
    [0, 0, 0.2],
    [0.1, 0.06, 0.15],
    [-0.08, 0.07, 0.13],
  ];
  for (const [x, z, h] of heads) {
    k.add(place(cyl(0.012, 0.014, h, 4), x, h / 2, z), "#4f9a36");
    k.add(place(sph(0.032, 6, 4), x, h + 0.01, z), "#ffd23f", { glow: 0.2 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      k.add(place(sph(0.034, 6, 4), x + Math.cos(a) * 0.045, h + 0.005, z + Math.sin(a) * 0.045, 0, 0, 0, 1, 0.5, 1), "#ffffff", {
        glow: 0.12,
      });
    }
  }
  for (const s of [-1, 1]) {
    k.add(place(sph(0.07, 6, 4), 0.05 * s, 0.03, 0.02, 0, 0.6 * s, 0, 1, 0.3, 0.5), "#5fae3c");
  }
  return k.build();
}

function mushrooms(): THREE.BufferGeometry {
  const k = new ModelKit();
  const list: [number, number, number][] = [
    [0, 0, 0.13],
    [0.13, 0.05, 0.09],
    [-0.1, 0.08, 0.07],
  ];
  groundShadow(k, 0.2, 1.2, 0.9, 0.01, 0.03);
  for (const [x, z, r] of list) {
    const h = r * 1.1;
    k.add(place(cyl(r * 0.32, r * 0.42, h, 7), x, h / 2, z), "#f6ead2", { shadeBottom: 0.75 });
    k.add(place(new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, h * 0.9, z, 0, 0, 0, 1, 0.75, 1), "#ff5b4f", {
      glow: 0.08,
    });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + r * 10;
      const dx = Math.cos(a) * r * 0.55;
      const dz = Math.sin(a) * r * 0.55;
      k.add(place(sph(r * 0.16, 5, 4), x + dx, h * 0.9 + r * 0.55, z + dz), "#ffffff", { glow: 0.3 });
    }
  }
  return k.build();
}

function bones(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.26, 1.2, 0.8);
  const bone = "#f3ead8";
  for (const a of [0.5, -0.6]) {
    const len = 0.34;
    k.add(place(cyl(0.022, 0.022, len, 5), 0, 0.03, 0, Math.PI / 2, a, 0), bone);
    for (const s of [-1, 1]) {
      const ex = Math.sin(a) * (len / 2) * s;
      const ez = Math.cos(a) * (len / 2) * s;
      k.add(place(sph(0.035, 6, 4), ex + Math.cos(a) * 0.02, 0.035, ez - Math.sin(a) * 0.02), bone);
      k.add(place(sph(0.035, 6, 4), ex - Math.cos(a) * 0.02, 0.035, ez + Math.sin(a) * 0.02), bone);
    }
  }
  // little skull
  k.add(place(sph(0.09, 10, 8), 0.14, 0.085, -0.06, 0, 0, 0, 1, 0.92, 1.05), bone, { shadeBottom: 0.8 });
  k.add(place(box(0.09, 0.05, 0.06), 0.14, 0.03, -0.0), bone);
  for (const s of [-1, 1]) {
    k.add(place(sph(0.025, 6, 4), 0.14 + 0.035 * s, 0.09, 0.015), "#2a2433");
  }
  return k.build();
}

function pebbles(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.24, 1.3, 0.9);
  k.add(place(dodeca(0.13), 0, 0.07, 0, 0.4, 0.2, 0, 1, 0.7, 1), "#9aa3a8", { shadeBottom: 0.65 });
  k.add(place(dodeca(0.08), 0.15, 0.04, 0.06, 0.2, 0.9, 0, 1, 0.7, 1), "#8c949b", { shadeBottom: 0.65 });
  k.add(place(dodeca(0.06), -0.13, 0.03, 0.08, 0.7, 0.1, 0, 1, 0.8, 1), "#a8b0b4", { shadeBottom: 0.65 });
  return k.build();
}

function clover(): THREE.BufferGeometry {
  const k = new ModelKit();
  const leaves: [number, number, number][] = [
    [0, 0, 0.11],
    [0.12, 0.05, 0.09],
    [-0.1, 0.08, 0.1],
    [0.03, -0.12, 0.08],
    [-0.12, -0.07, 0.07],
  ];
  for (const [x, z, r] of leaves) {
    k.add(place(sph(r, 8, 5), x, 0.04, z, 0, x * 9, 0.25, 1, 0.32, 0.75), "#3f8f35", { shadeBottom: 0.7 });
  }
  return k.build();
}

function candles(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.2, 1.1, 0.9);
  const list: [number, number, number][] = [
    [0, 0, 0.2],
    [0.1, 0.05, 0.13],
    [-0.09, 0.06, 0.1],
  ];
  for (const [x, z, h] of list) {
    k.add(place(cyl(0.035, 0.04, h, 8), x, h / 2, z), "#f4ecd8", { shadeBottom: 0.8 });
    k.add(place(cone(0.022, 0.06, 6), x, h + 0.035, z), "#ffd56b", { glow: 1, outline: false });
  }
  return k.build();
}

// --------------------------------------------------------------------------- big props

function headstone(): THREE.BufferGeometry {
  const k = new ModelKit();
  const stone = "#a6a2bd";
  groundShadow(k, 0.42, 1.0, 0.85, 0, 0.12);
  k.add(place(box(0.5, 0.42, 0.14), 0, 0.21, 0), stone, { shadeBottom: 0.7 });
  k.add(place(cyl(0.25, 0.25, 0.14, 16), 0, 0.42, 0, Math.PI / 2), stone);
  // engraved cross + moss
  k.add(place(box(0.05, 0.22, 0.02), 0, 0.38, 0.072), "#6c6888");
  k.add(place(box(0.15, 0.045, 0.02), 0, 0.43, 0.072), "#6c6888");
  k.add(place(sph(0.09, 8, 5), -0.2, 0.03, 0.05, 0, 0, 0, 1.2, 0.5, 1), "#4f9a36");
  // grave mound
  k.add(place(sph(0.3, 12, 6), 0, 0.0, 0.33, 0, 0, 0, 0.85, 0.22, 1.05), "#6e5a3c", { shadeBottom: 0.8 });
  return k.build();
}

function woodCross(): THREE.BufferGeometry {
  const k = new ModelKit();
  const wood = "#8f6a45";
  groundShadow(k, 0.36, 0.9, 0.9, 0, 0.1);
  k.add(place(box(0.09, 0.7, 0.07), 0, 0.35, 0), wood, { shadeBottom: 0.7 });
  k.add(place(box(0.42, 0.08, 0.07), 0, 0.5, 0.0, 0, 0, 0.08), wood);
  k.add(place(box(0.1, 0.1, 0.075), 0, 0.5, 0.0, 0, 0, 0.08), "#6b4c30");
  k.add(place(sph(0.26, 12, 6), 0, 0, 0.28, 0, 0, 0, 0.8, 0.2, 1.0), "#6e5a3c");
  // a little wreath of flowers
  for (let i = 0; i < 3; i++) {
    k.add(place(sph(0.035, 6, 4), -0.08 + i * 0.08, 0.06, 0.3 + (i % 2) * 0.04), i === 1 ? "#ff8fb1" : "#ffffff", { glow: 0.15 });
  }
  return k.build();
}

function deadTree(): THREE.BufferGeometry {
  const k = new ModelKit();
  const bark = "#5e4a3c";
  groundShadow(k, 0.55, 1.1, 0.9);
  k.add(place(cyl(0.11, 0.2, 1.0, 8), 0, 0.5, 0, 0, 0, 0.05), bark, { shadeBottom: 0.6 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const g = cone(0.08, 0.25, 5);
    k.add(place(g, Math.cos(a) * 0.16, 0.06, Math.sin(a) * 0.16, Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2), bark);
  }
  // branches: [angleY, height, tilt, length]
  const br: [number, number, number, number][] = [
    [0.3, 0.75, 0.9, 0.55],
    [2.4, 0.9, 0.8, 0.45],
    [4.3, 0.62, 1.0, 0.4],
    [1.4, 1.02, 0.35, 0.4],
  ];
  for (const [ay, y, tilt, len] of br) {
    const g = cyl(0.025, 0.06, len, 5);
    g.translate(0, len / 2, 0);
    // tilt away from the trunk around an axis perpendicular to the branch direction
    const dx = Math.cos(ay);
    const dz = Math.sin(ay);
    const m = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(dz, 0, -dx), tilt);
    g.applyMatrix4(m);
    g.translate(0.03, y, 0);
    k.add(g, bark);
    // twig at the end
    const tipX = 0.03 + dx * Math.sin(tilt) * len;
    const tipY = y + Math.cos(tilt) * len;
    const tipZ = dz * Math.sin(tilt) * len;
    const tw = cone(0.02, 0.18, 4);
    tw.translate(0, 0.09, 0);
    k.add(place(tw, tipX, tipY, tipZ, 0.5 * dz, 0, -0.5 * dx - 0.4), bark);
  }
  return k.build();
}

function fence(): THREE.BufferGeometry {
  const k = new ModelKit();
  const wood = "#a77d52";
  groundShadow(k, 0.5, 1.4, 0.45);
  const posts = [-0.45, 0, 0.42];
  posts.forEach((x, i) => {
    const h = i === 1 ? 0.42 : 0.55;
    k.add(place(box(0.09, h, 0.09), x, h / 2, 0, 0, 0, i === 1 ? 0.12 : 0), wood, { shadeBottom: 0.7 });
    if (i !== 1) k.add(place(cone(0.065, 0.12, 4), x, h + 0.06, 0, 0, Math.PI / 4, 0), wood);
  });
  k.add(place(box(0.95, 0.07, 0.04), 0, 0.4, 0.06, 0, 0, 0.04), "#b78b5e");
  // broken lower rail hanging down
  k.add(place(box(0.5, 0.07, 0.04), -0.24, 0.2, 0.06, 0, 0, -0.08), "#b78b5e");
  k.add(place(box(0.4, 0.07, 0.04), 0.26, 0.12, 0.08, 0, 0, 0.45), "#9a7046");
  return k.build();
}

function lantern(): THREE.BufferGeometry {
  const k = new ModelKit();
  const iron = "#3d3550";
  groundShadow(k, 0.3, 1, 1);
  k.add(place(cyl(0.035, 0.05, 1.15, 6), 0, 0.575, 0), iron, { shadeBottom: 0.6 });
  k.add(place(cyl(0.09, 0.11, 0.08, 8), 0, 0.04, 0), iron);
  k.add(place(box(0.3, 0.035, 0.035), 0.12, 1.12, 0), iron);
  // lantern cage + glowing core
  k.add(place(cone(0.12, 0.1, 4), 0.25, 1.06, 0, 0, Math.PI / 4, 0), iron);
  k.add(place(box(0.15, 0.17, 0.15), 0.25, 0.93, 0), "#ffcf6b", { glow: 1 });
  k.add(place(box(0.17, 0.03, 0.17), 0.25, 0.84, 0), iron);
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    k.add(place(box(0.025, 0.18, 0.025), 0.25 + dx * 0.075, 0.93, dz * 0.075), iron);
  }
  return k.build();
}

function boulder(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.48, 1.2, 0.9);
  k.add(place(dodeca(0.32), 0, 0.2, 0, 0.3, 0.5, 0.1, 1.15, 0.8, 1), "#9298a6", { shadeBottom: 0.6 });
  k.add(place(dodeca(0.17), 0.33, 0.1, 0.12, 0.6, 0.2, 0), "#878d9b", { shadeBottom: 0.6 });
  // moss cap
  k.add(place(sph(0.22, 10, 6), -0.03, 0.4, 0.0, 0, 0, 0, 1.1, 0.3, 0.95), "#5aa63e");
  return k.build();
}

function stump(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.38, 1.1, 0.9);
  k.add(place(cyl(0.22, 0.27, 0.26, 10), 0, 0.13, 0), "#7a5a3e", { shadeBottom: 0.65 });
  k.add(place(cyl(0.2, 0.2, 0.02, 10), 0, 0.265, 0), "#d9b47e");
  k.add(place(torus(0.12, 0.012, 3, 12), 0, 0.277, 0, Math.PI / 2), "#b38a58", { outline: false });
  // tiny glowing toadstool on the side
  k.add(place(cyl(0.02, 0.025, 0.08, 5), 0.25, 0.04, 0.12), "#f4ecd8");
  k.add(place(new THREE.SphereGeometry(0.06, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0.25, 0.075, 0.12), "#b56cff", { glow: 0.6 });
  return k.build();
}

function crystals(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.26, 1.1, 0.9);
  const list: [number, number, number, number, number][] = [
    [0, 0, 0.32, 0.0, 0.0],
    [0.1, 0.05, 0.22, -0.3, 0.35],
    [-0.09, 0.06, 0.18, 0.25, -0.4],
  ];
  for (const [x, z, h, rx, rz] of list) {
    const g = ico(0.09, 0);
    g.scale(0.7, h / 0.18, 0.7);
    g.translate(0, h * 0.45, 0);
    k.add(place(g, x, 0, z, rx, 0, rz), "#a98bff", { glow: 0.55, shadeBottom: 0.6 });
  }
  return k.build();
}

/** small props (one InstancedMesh, variant-collapsed) */
export const SMALL_PROPS: PropDef[] = [
  { name: "flowers", build: flowers, scale: [0.9, 1.3], tints: ["#ffffff", "#ffd1e8", "#fff0a6", "#d8c8ff", "#ffb3a7"] },
  { name: "mushrooms", build: mushrooms, scale: [0.9, 1.5], tints: ["#ffffff", "#ffd9a8", "#e8c8ff"] },
  { name: "bones", build: bones, scale: [0.9, 1.25] },
  { name: "pebbles", build: pebbles, scale: [0.8, 1.6] },
  { name: "clover", build: clover, scale: [0.9, 1.6], tints: ["#ffffff", "#d8f0b0"] },
  {
    name: "candles",
    build: candles,
    scale: [0.9, 1.2],
    glows: [{ x: 0, y: 0.26, z: 0, size: 0.75, color: "#ffb347", mode: 0 }],
  },
  { name: "crystals", build: crystals, scale: [0.9, 1.4], tints: ["#ffffff", "#9ff2ff"], glows: [{ x: 0, y: 0.2, z: 0, size: 0.9, color: "#9a6bff", mode: 0 }] },
];

/** big props (one InstancedMesh, variant-collapsed) */
export const BIG_PROPS: PropDef[] = [
  { name: "headstone", build: headstone, scale: [0.85, 1.15], tilt: 0.14, tints: ["#ffffff", "#e6e0ff", "#d8dcd0"] },
  { name: "cross", build: woodCross, scale: [0.85, 1.1], tilt: 0.18 },
  { name: "tree", build: deadTree, scale: [0.95, 1.35], tints: ["#ffffff", "#e8d8ff"] },
  { name: "fence", build: fence, scale: [0.9, 1.15], tilt: 0.06 },
  {
    name: "lantern",
    build: lantern,
    scale: [0.95, 1.1],
    glows: [
      { x: 0.25, y: 0.93, z: 0, size: 1.5, color: "#ffb347", mode: 0 },
      { x: 0.2, y: 0.03, z: 0.1, size: 2.6, color: "#ffa640", mode: 1 },
    ],
  },
  { name: "boulder", build: boulder, scale: [0.8, 1.3] },
  {
    name: "stump",
    build: stump,
    scale: [0.9, 1.2],
    glows: [{ x: 0.25, y: 0.12, z: 0.12, size: 0.6, color: "#c27bff", mode: 0 }],
  },
];
