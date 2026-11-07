import * as THREE from "three";
import { ModelKit, place, box, sph, cyl, cone, dodeca, ico } from "./ModelKit";
import type { PropDef } from "./DecorProps";

/**
 * Original frozen-graveyard scenery for the "snow" world theme, built like
 * DecorProps (ModelKit, base at y = 0, front = +Z, vertex colours).
 * Shares the decor toon materials, so it adds no shader programs.
 * Shapes stay chunky and darker than the snow (stone, bark, pine needles,
 * ice) so the bright ground keeps its contrast with the props.
 */

const SNOW = "#f3f7ff";
const SNOW_SHADE = "#d3e0f2";
const ICE = "#8fd8ff";
const ICE_DEEP = "#4fa8e8";
const SHADOW = "#8396b8";
const STONE = "#8790ad";
const WOOD = "#6e5747";
const PINE = "#2f4f5a";

/** flat bluish disc that grounds a prop on the snow (fake contact shadow) */
function groundShadow(k: ModelKit, r: number, sx = 1, sz = 1, x = 0, z = 0): void {
  k.add(place(cyl(r, r, 0.01, 16), x, 0.008, z, 0, 0, 0, sx, 1, sz), SHADOW);
}

/** soft snow pile (half-buried flattened sphere) */
function snowPile(k: ModelKit, r: number, x: number, z: number, sy = 0.32, sx = 1, sz = 1): void {
  k.add(place(sph(r, 12, 7), x, 0, z, 0, 0, 0, sx, sy, sz), SNOW, { shadeBottom: 0.82 });
}

/** a hanging icicle (cone pointing down) whose top sits at (x, y, z) */
function icicle(k: ModelKit, x: number, y: number, z: number, len: number, r = 0.025): void {
  k.add(place(cone(r, len, 5), x, y - len / 2, z, Math.PI, 0, 0), ICE, { glow: 0.25, outline: false });
}

// --------------------------------------------------------------------------- tuft (grass layer)

/** frozen grass blades poking out of a little snow mound */
export function buildSnowTuft(): THREE.BufferGeometry {
  const k = new ModelKit();
  k.add(place(sph(0.16, 9, 5), 0, 0, 0, 0, 0, 0, 1.1, 0.28, 0.9), SNOW_SHADE, { shadeBottom: 0.85 });
  const blades: [number, number, number, number, number][] = [
    [0.02, 0.0, 0.34, 0.1, 0],
    [0.08, 0.04, 0.26, -0.4, 0.15],
    [-0.07, 0.03, 0.29, 0.4, 0.1],
  ];
  for (const [x, z, h, lx, lz] of blades) {
    const g = cone(0.035, h, 3);
    g.translate(0, h / 2, 0);
    k.add(place(g, x, 0, z, lz, 0, lx), "#9fb8c6", { shadeBottom: 0.55 });
  }
  return k.build();
}

// --------------------------------------------------------------------------- small props

function snowLumps(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.28, 1.3, 0.9);
  snowPile(k, 0.22, 0, 0, 0.42);
  snowPile(k, 0.14, 0.2, 0.08, 0.45);
  snowPile(k, 0.1, -0.17, 0.1, 0.5);
  return k.build();
}

function snowPebbles(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.24, 1.3, 0.9);
  k.add(place(dodeca(0.13), 0, 0.07, 0, 0.4, 0.2, 0, 1, 0.7, 1), STONE, { shadeBottom: 0.65 });
  k.add(place(sph(0.11, 9, 5), 0.0, 0.135, 0.0, 0, 0, 0, 1.05, 0.32, 1.0), SNOW);
  k.add(place(dodeca(0.08), 0.15, 0.04, 0.06, 0.2, 0.9, 0, 1, 0.7, 1), "#7b84a0", { shadeBottom: 0.65 });
  k.add(place(sph(0.065, 8, 5), 0.15, 0.085, 0.06, 0, 0, 0, 1, 0.35, 1), SNOW);
  k.add(place(dodeca(0.06), -0.13, 0.03, 0.08, 0.7, 0.1, 0, 1, 0.8, 1), "#959dba", { shadeBottom: 0.65 });
  return k.build();
}

function frozenBones(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.26, 1.2, 0.8);
  const bone = "#e6e8f0";
  snowPile(k, 0.2, -0.05, 0.02, 0.3, 1.3, 0.9);
  for (const a of [0.5, -0.6]) {
    const len = 0.34;
    k.add(place(cyl(0.022, 0.022, len, 5), 0, 0.04, 0, Math.PI / 2, a, 0), bone);
    for (const s of [-1, 1]) {
      const ex = Math.sin(a) * (len / 2) * s;
      const ez = Math.cos(a) * (len / 2) * s;
      k.add(place(sph(0.035, 6, 4), ex, 0.045, ez), bone);
    }
  }
  // frosted skull with icy eye sockets
  k.add(place(sph(0.09, 10, 8), 0.14, 0.085, -0.06, 0, 0, 0, 1, 0.92, 1.05), bone, { shadeBottom: 0.8 });
  k.add(place(sph(0.07, 8, 5), 0.14, 0.15, -0.07, 0, 0, 0, 1.1, 0.4, 1.1), SNOW);
  for (const s of [-1, 1]) k.add(place(sph(0.025, 6, 4), 0.14 + 0.035 * s, 0.09, 0.015), "#3d6fa8");
  return k.build();
}

function frostFlowers(): THREE.BufferGeometry {
  const k = new ModelKit();
  const heads: [number, number, number][] = [
    [0, 0, 0.2],
    [0.1, 0.06, 0.15],
    [-0.08, 0.07, 0.13],
  ];
  for (const [x, z, h] of heads) {
    k.add(place(cyl(0.012, 0.014, h, 4), x, h / 2, z), "#5d7f94");
    k.add(place(sph(0.03, 6, 4), x, h + 0.01, z), "#e9fbff", { glow: 0.5 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      // crystal petals: little diamonds pointing outwards
      k.add(place(ico(0.035, 0), x + Math.cos(a) * 0.05, h + 0.005, z + Math.sin(a) * 0.05, 0, -a, 0, 1.4, 0.45, 0.8), ICE, {
        glow: 0.35,
      });
    }
  }
  snowPile(k, 0.13, 0.01, 0.04, 0.3, 1.3, 1);
  return k.build();
}

function coldCandles(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.2, 1.1, 0.9);
  const list: [number, number, number][] = [
    [0, 0, 0.2],
    [0.1, 0.05, 0.13],
    [-0.09, 0.06, 0.1],
  ];
  for (const [x, z, h] of list) {
    k.add(place(cyl(0.035, 0.04, h, 8), x, h / 2, z), "#e7ecf6", { shadeBottom: 0.8 });
    k.add(place(cone(0.022, 0.06, 6), x, h + 0.035, z), "#8ff3ff", { glow: 1, outline: false });
  }
  snowPile(k, 0.14, 0, 0.03, 0.22, 1.3, 1.1);
  return k.build();
}

function iceShards(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.26, 1.1, 0.9);
  snowPile(k, 0.17, 0, 0.02, 0.28, 1.2, 1);
  const list: [number, number, number, number, number][] = [
    [0, 0, 0.32, 0.0, 0.0],
    [0.1, 0.05, 0.22, -0.3, 0.35],
    [-0.09, 0.06, 0.18, 0.25, -0.4],
  ];
  for (const [x, z, h, rx, rz] of list) {
    const g = ico(0.09, 0);
    g.scale(0.7, h / 0.18, 0.7);
    g.translate(0, h * 0.45, 0);
    k.add(place(g, x, 0, z, rx, 0, rz), ICE, { glow: 0.5, shadeBottom: 0.55 });
  }
  return k.build();
}

function groundIcicles(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.24, 1.2, 0.9);
  const list: [number, number, number, number][] = [
    [0, 0, 0.3, 0.05],
    [0.09, -0.05, 0.2, -0.25],
    [-0.08, 0.04, 0.24, 0.3],
    [0.04, 0.1, 0.15, 0.15],
  ];
  for (const [x, z, h, lean] of list) {
    const g = cone(0.04, h, 5);
    g.translate(0, h / 2, 0);
    k.add(place(g, x, 0, z, lean, 0, -lean * 0.6), ICE_DEEP, { glow: 0.3, shadeBottom: 0.6 });
  }
  snowPile(k, 0.12, 0.0, 0.0, 0.3, 1.3, 1);
  return k.build();
}

// --------------------------------------------------------------------------- big props

function frozenGrave(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.44, 1.0, 0.85, 0, 0.12);
  k.add(place(box(0.5, 0.42, 0.14), 0, 0.21, 0), STONE, { shadeBottom: 0.65 });
  k.add(place(cyl(0.25, 0.25, 0.14, 16), 0, 0.42, 0, Math.PI / 2), STONE);
  // engraved cross filled with frost
  k.add(place(box(0.05, 0.22, 0.02), 0, 0.36, 0.072), "#b6dcf5", { glow: 0.15 });
  k.add(place(box(0.15, 0.045, 0.02), 0, 0.41, 0.072), "#b6dcf5", { glow: 0.15 });
  // snow cap on the arch + icicles along the front edge
  k.add(place(sph(0.27, 14, 6), 0, 0.6, 0, 0, 0, 0, 1.05, 0.32, 0.62), SNOW);
  for (const [x, len] of [
    [-0.18, 0.1],
    [-0.06, 0.15],
    [0.07, 0.08],
    [0.17, 0.12],
  ]) {
    icicle(k, x, 0.5 - Math.abs(x) * 0.5, 0.075, len);
  }
  // snowy grave mound
  k.add(place(sph(0.3, 12, 6), 0, 0.0, 0.33, 0, 0, 0, 0.85, 0.25, 1.05), SNOW, { shadeBottom: 0.85 });
  return k.build();
}

function frozenCross(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.36, 0.9, 0.9, 0, 0.1);
  k.add(place(box(0.09, 0.7, 0.07), 0, 0.35, 0), WOOD, { shadeBottom: 0.7 });
  k.add(place(box(0.42, 0.08, 0.07), 0, 0.5, 0.0, 0, 0, 0.08), WOOD);
  // snow on top of the beams
  k.add(place(box(0.44, 0.035, 0.085), 0, 0.555, 0, 0, 0, 0.08), SNOW);
  k.add(place(sph(0.06, 8, 5), 0, 0.71, 0, 0, 0, 0, 1, 0.5, 1), SNOW);
  icicle(k, -0.15, 0.47, 0.03, 0.09, 0.02);
  icicle(k, 0.13, 0.49, 0.03, 0.12, 0.02);
  k.add(place(sph(0.26, 12, 6), 0, 0, 0.28, 0, 0, 0, 0.8, 0.24, 1.0), SNOW, { shadeBottom: 0.85 });
  return k.build();
}

function snowPine(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.6, 1.1, 0.9);
  k.add(place(cyl(0.07, 0.11, 0.4, 7), 0, 0.2, 0), WOOD, { shadeBottom: 0.6 });
  // three needle tiers, each with a snow layer resting on top
  const tiers: [number, number, number][] = [
    [0.32, 0.58, 0.62],
    [0.72, 0.46, 0.52],
    [1.06, 0.32, 0.42],
  ];
  for (const [y, r, h] of tiers) {
    k.add(place(cone(r, h, 8), 0, y + h / 2 - 0.06, 0), PINE, { shadeBottom: 0.7 });
    k.add(place(cone(r * 0.8, h * 0.46, 8), 0.02, y + h * 0.66, -0.01), SNOW, { shadeBottom: 0.9 });
  }
  snowPile(k, 0.3, 0.05, 0.15, 0.22, 1.3, 1);
  return k.build();
}

function deadPine(): THREE.BufferGeometry {
  const k = new ModelKit();
  const bark = "#5b4b45";
  groundShadow(k, 0.5, 1.1, 0.9);
  k.add(place(cyl(0.05, 0.12, 1.25, 7), 0, 0.62, 0, 0, 0, 0.04), bark, { shadeBottom: 0.6 });
  // drooping bare branches, snow lying on each
  const br: [number, number, number][] = [
    // height, angleY, length
    [0.45, 0.4, 0.5],
    [0.62, 2.6, 0.44],
    [0.8, 4.4, 0.38],
    [0.96, 1.5, 0.32],
    [1.1, 3.4, 0.24],
  ];
  for (const [y, ay, len] of br) {
    const dx = Math.cos(ay);
    const dz = Math.sin(ay);
    const g = cyl(0.018, 0.04, len, 5);
    g.translate(0, len / 2, 0);
    const m = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(dz, 0, -dx), 1.75);
    g.applyMatrix4(m);
    g.translate(0, y, 0);
    k.add(g, bark);
    // snow clump along the branch
    k.add(place(sph(0.06, 7, 4), dx * len * 0.55, y + 0.02 - len * 0.1, dz * len * 0.55, 0, -ay, 0, 2.2, 0.6, 1), SNOW);
  }
  k.add(place(sph(0.06, 8, 5), 0.0, 1.27, 0, 0, 0, 0, 1, 0.6, 1), SNOW);
  snowPile(k, 0.28, 0, 0.08, 0.24, 1.2, 1);
  return k.build();
}

function frozenFence(): THREE.BufferGeometry {
  const k = new ModelKit();
  const wood = "#7a6250";
  groundShadow(k, 0.5, 1.4, 0.45);
  const posts = [-0.45, 0, 0.42];
  posts.forEach((x, i) => {
    const h = i === 1 ? 0.42 : 0.55;
    k.add(place(box(0.09, h, 0.09), x, h / 2, 0, 0, 0, i === 1 ? 0.12 : 0), wood, { shadeBottom: 0.7 });
    k.add(place(sph(0.06, 7, 4), x + (i === 1 ? 0.03 : 0), h + 0.02, 0, 0, 0, 0, 1.1, 0.55, 1.1), SNOW);
  });
  k.add(place(box(0.95, 0.07, 0.04), 0, 0.4, 0.06, 0, 0, 0.04), "#8a705c");
  k.add(place(box(0.95, 0.03, 0.06), 0, 0.445, 0.06, 0, 0, 0.04), SNOW);
  // broken lower rail + icicles under the top rail
  k.add(place(box(0.5, 0.07, 0.04), -0.24, 0.2, 0.06, 0, 0, -0.08), "#8a705c");
  k.add(place(box(0.4, 0.07, 0.04), 0.26, 0.12, 0.08, 0, 0, 0.45), "#6c5444");
  for (const x of [-0.3, -0.12, 0.2, 0.33]) icicle(k, x, 0.37 + x * 0.04, 0.07, 0.08 + Math.abs(x) * 0.15, 0.018);
  snowPile(k, 0.3, 0.1, 0.12, 0.2, 2.2, 0.8);
  return k.build();
}

function coldLantern(): THREE.BufferGeometry {
  const k = new ModelKit();
  const iron = "#2e3450";
  groundShadow(k, 0.3, 1, 1);
  k.add(place(cyl(0.035, 0.05, 1.15, 6), 0, 0.575, 0), iron, { shadeBottom: 0.6 });
  k.add(place(cyl(0.09, 0.11, 0.08, 8), 0, 0.04, 0), iron);
  k.add(place(box(0.3, 0.035, 0.035), 0.12, 1.12, 0), iron);
  k.add(place(box(0.3, 0.02, 0.05), 0.12, 1.145, 0), SNOW);
  // lantern cage + cold blue-white flame
  k.add(place(cone(0.12, 0.1, 4), 0.25, 1.06, 0, 0, Math.PI / 4, 0), iron);
  k.add(place(cone(0.1, 0.06, 4), 0.25, 1.1, 0, 0, Math.PI / 4, 0), SNOW);
  k.add(place(box(0.15, 0.17, 0.15), 0.25, 0.93, 0), "#a8f0ff", { glow: 1 });
  k.add(place(box(0.17, 0.03, 0.17), 0.25, 0.84, 0), iron);
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    k.add(place(box(0.025, 0.18, 0.025), 0.25 + dx * 0.075, 0.93, dz * 0.075), iron);
  }
  icicle(k, 0.2, 0.83, 0.05, 0.08, 0.016);
  icicle(k, 0.3, 0.83, -0.04, 0.06, 0.014);
  snowPile(k, 0.22, 0, 0, 0.25);
  return k.build();
}

function crystalCluster(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.5, 1.15, 0.9);
  k.add(place(dodeca(0.28), 0, 0.12, 0, 0.3, 0.5, 0.1, 1.2, 0.55, 1), STONE, { shadeBottom: 0.6 });
  const list: [number, number, number, number, number][] = [
    [0, 0, 0.75, 0.05, 0.0],
    [0.2, 0.06, 0.5, -0.25, 0.45],
    [-0.19, 0.08, 0.55, 0.2, -0.5],
    [0.05, -0.18, 0.42, 0.55, 0.1],
    [-0.08, 0.2, 0.36, -0.5, -0.2],
  ];
  for (const [x, z, h, rx, rz] of list) {
    const g = ico(0.12, 0);
    g.scale(0.75, h / 0.24, 0.75);
    g.translate(0, h * 0.45, 0);
    k.add(place(g, x, 0.05, z, rx, 0, rz), ICE, { glow: 0.55, shadeBottom: 0.5 });
  }
  snowPile(k, 0.36, 0, 0.05, 0.2, 1.2, 1);
  return k.build();
}

function snowdrift(): THREE.BufferGeometry {
  const k = new ModelKit();
  groundShadow(k, 0.62, 1.4, 0.8, 0, 0.05);
  snowPile(k, 0.5, 0, 0, 0.5, 1.5, 0.9);
  snowPile(k, 0.34, 0.45, 0.12, 0.55, 1.1, 0.9);
  snowPile(k, 0.28, -0.5, 0.1, 0.45, 1.2, 0.8);
  // a buried old signpost sticking out of the drift
  k.add(place(box(0.06, 0.55, 0.06), -0.2, 0.3, -0.12, 0.1, 0, -0.18), WOOD, { shadeBottom: 0.6 });
  k.add(place(box(0.3, 0.12, 0.03), -0.12, 0.5, -0.1, 0.1, 0.2, -0.25), "#7d6553");
  k.add(place(box(0.32, 0.03, 0.05), -0.12, 0.575, -0.1, 0.1, 0.2, -0.25), SNOW);
  return k.build();
}

/** small snow props, indexed like the snow zone weights in Decor */
export const SNOW_SMALL: PropDef[] = [
  { name: "lumps", build: snowLumps, scale: [0.9, 1.5] },
  { name: "pebbles", build: snowPebbles, scale: [0.8, 1.5] },
  { name: "bones", build: frozenBones, scale: [0.9, 1.25] },
  { name: "frostFlowers", build: frostFlowers, scale: [0.9, 1.3], tints: ["#ffffff", "#d8f4ff", "#e8e0ff"] },
  {
    name: "coldCandles",
    build: coldCandles,
    scale: [0.9, 1.2],
    glows: [{ x: 0, y: 0.26, z: 0, size: 0.7, color: "#4fd8ff", mode: 0 }],
  },
  { name: "iceShards", build: iceShards, scale: [0.9, 1.4], tints: ["#ffffff", "#c8f0ff"], glows: [{ x: 0, y: 0.2, z: 0, size: 0.8, color: "#3fb8ff", mode: 0 }] },
  { name: "icicles", build: groundIcicles, scale: [0.9, 1.4] },
];

/** big snow props, indexed like the snow zone weights in Decor */
export const SNOW_BIG: PropDef[] = [
  { name: "frozenGrave", build: frozenGrave, scale: [0.85, 1.15], tilt: 0.14, tints: ["#ffffff", "#e4e8ff", "#dde6ef"] },
  { name: "frozenCross", build: frozenCross, scale: [0.85, 1.1], tilt: 0.18 },
  { name: "snowPine", build: snowPine, scale: [1.0, 1.45], tints: ["#ffffff", "#e0f0f0", "#d8e4ff"] },
  { name: "deadPine", build: deadPine, scale: [0.95, 1.35] },
  { name: "frozenFence", build: frozenFence, scale: [0.9, 1.15], tilt: 0.06 },
  {
    name: "coldLantern",
    build: coldLantern,
    scale: [0.95, 1.1],
    glows: [
      { x: 0.25, y: 0.93, z: 0, size: 1.4, color: "#45c8ff", mode: 0 },
      { x: 0.2, y: 0.03, z: 0.1, size: 2.2, color: "#2a7fd0", mode: 1 },
    ],
  },
  { name: "crystalCluster", build: crystalCluster, scale: [0.85, 1.25], glows: [{ x: 0, y: 0.45, z: 0, size: 1.5, color: "#2fa8ff", mode: 0 }] },
  { name: "snowdrift", build: snowdrift, scale: [0.9, 1.3] },
];
