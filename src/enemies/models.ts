import * as THREE from "three";
import { PART, PartBuilder } from "./PartBuilder";

/**
 * Procedural low-poly models for the enemy roster. Every builder returns ONE
 * merged geometry (see PartBuilder) facing +Z with feet at y = 0.
 * Readability from the top-down camera comes first: distinct head shapes,
 * hats and body colours rather than tiny details.
 */

type V3 = [number, number, number];

interface FigureColors {
  skin: string;
  shirt: string;
  pants: string;
  /** sleeve colour (default = shirt). Use skin for bare arms */
  sleeve?: string;
  shoe?: string;
  /** lower-leg colour for shorts (default = pants) */
  shin?: string;
}

interface FigureOpts {
  width?: number;
  height?: number;
  headR?: number;
  belly?: number;
  armThick?: number;
  hand?: number;
  legThick?: number;
  /** push the head forward (hunch) */
  headZ?: number;
  /** lower the head into the shoulders */
  headDrop?: number;
}

export interface FigureInfo {
  hip: number;
  neck: number;
  shoulder: number;
  shoulderX: number;
  armLen: number;
  headY: number;
  headZ: number;
  headR: number;
  /** torso half depth (front face z) */
  front: number;
  w: number;
}

/**
 * Generic humanoid body with more options than humanoid(): bare arms,
 * shorts, hunch, big fists. Arms hang down; the shader raises them.
 */
export function figure(b: PartBuilder, c: FigureColors, o: FigureOpts = {}): FigureInfo {
  const w = o.width ?? 1;
  const h = o.height ?? 1;
  const hr = o.headR ?? 0.27;
  const at = o.armThick ?? 0.13;
  const lt = o.legThick ?? 1;
  const hip = 0.42 * h;
  const knee = hip * 0.5;
  const lx = 0.13 * w;
  // legs
  for (const [side, part] of [[-1, PART.LEG_L], [1, PART.LEG_R]] as const) {
    const pv: V3 = [side * lx, hip, 0];
    if (c.shin) {
      b.box(0.18 * w * lt, hip - knee + 0.02, 0.21 * lt, c.pants, part, { pos: [side * lx, (hip + knee) / 2, 0], pivot: pv });
      b.box(0.14 * w * lt, knee, 0.16 * lt, c.shin, part, { pos: [side * lx, knee / 2, 0], pivot: pv });
    } else {
      b.box(0.17 * w * lt, hip, 0.2 * lt, c.pants, part, { pos: [side * lx, hip / 2, 0], pivot: pv });
    }
    if (c.shoe) b.box(0.19 * w * lt, 0.08, 0.27 * lt, c.shoe, part, { pos: [side * lx, 0.04, 0.03], pivot: pv });
  }
  // torso
  const torsoH = 0.5 * h;
  const depth = 0.32 * (o.belly ?? 1);
  b.box(0.52 * w, torsoH, depth, c.shirt, PART.BODY, { pos: [0, hip + torsoH / 2, 0] });
  // arms
  const sh = hip + torsoH - 0.06;
  const armL = 0.46 * h;
  const ax = 0.26 * w + at * 0.55;
  const sleeve = c.sleeve ?? c.shirt;
  const hand = 0.12 * (o.hand ?? 1);
  for (const [side, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]] as const) {
    const pv: V3 = [side * ax, sh, 0];
    b.box(at, armL, at + 0.01, sleeve, part, { pos: [side * ax, sh - armL / 2 + 0.05, 0], pivot: pv });
    b.box(hand, hand, hand, c.skin, part, { pos: [side * ax, sh - armL + 0.02 - (hand - 0.12) * 0.4, 0], pivot: pv });
  }
  // head
  const neck = hip + torsoH;
  const headY = neck + hr * 0.85 - (o.headDrop ?? 0);
  const headZ = o.headZ ?? 0;
  b.sphere(hr, c.skin, PART.HEAD, { pos: [0, headY, headZ], pivot: [0, neck, 0] }, 12);
  return { hip, neck, shoulder: sh, shoulderX: ax, armLen: armL, headY, headZ, headR: hr, front: depth / 2, w };
}

/** two eyes on a head sphere; returns nothing. `glow` eyes get no pupil */
function eyes(b: PartBuilder, f: FigureInfo, color: string, size: number, spread: number, dy = 0.05, pupil?: string): void {
  const z = f.headZ + f.headR * 0.84;
  for (const s of [-1, 1]) {
    b.sphere(size, color, PART.HEAD, { pos: [s * spread, f.headY + dy, z], pivot: [0, f.neck, 0] }, 6);
    if (pupil) b.sphere(size * 0.5, pupil, PART.HEAD, { pos: [s * spread, f.headY + dy, z + size * 0.75], pivot: [0, f.neck, 0] }, 5);
  }
}

function headPart(f: FigureInfo, pos: V3): { pos: V3; pivot: V3 } {
  return { pos, pivot: [0, f.neck, 0] };
}

// ---------------------------------------------------------------- regulars --

export function buildShambler(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const f = figure(b, { skin: "#8cc06a", shirt: "#9a6a3e", pants: "#46609a", shoe: "#2b2b2b" });
  // torn shirt + ragged hem
  b.box(0.3, 0.12, 0.02, "#6e4c2c", PART.BODY, { pos: [0.05, 0.6, 0.165] });
  b.box(0.16, 0.08, 0.34, "#6e4c2c", PART.BODY, { pos: [-0.17, 0.44, 0], rot: [0, 0, 0.3] });
  // messy hair tuft + mismatched eyes + mouth
  b.box(0.22, 0.08, 0.2, "#4a3b2a", PART.HEAD, headPart(f, [0.04, f.headY + 0.24, -0.04]));
  b.sphere(0.055, "#ffffff", PART.HEAD, headPart(f, [-0.09, 1.21, 0.21]), 6);
  b.sphere(0.04, "#ffffff", PART.HEAD, headPart(f, [0.1, 1.2, 0.22]), 6);
  b.box(0.14, 0.03, 0.02, "#3a2a20", PART.HEAD, headPart(f, [0, 1.08, 0.25]));
  return b.build();
}

export function buildRunner(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const f = figure(
    b,
    { skin: "#a9c4d2", shirt: "#e8443a", sleeve: "#a9c4d2", pants: "#2e2b3a", shin: "#a9c4d2", shoe: "#1b1b1b" },
    { width: 0.8, headR: 0.25, armThick: 0.11, headZ: 0.06 },
  );
  // white racing stripe on the tank top
  b.box(0.1, 0.5, 0.02, "#ffffff", PART.BODY, { pos: [0, 0.67, 0.165] });
  // red headband + spiky black hair
  b.cyl(f.headR * 1.03, f.headR * 1.03, 0.07, "#e8443a", PART.HEAD, headPart(f, [0, f.headY + 0.08, f.headZ]));
  const top = f.headY + f.headR * 0.75;
  b.cone(0.09, 0.26, "#1d1a22", PART.HEAD, { pos: [0, top + 0.08, f.headZ - 0.06], rot: [-0.6, 0, 0], pivot: [0, f.neck, 0] });
  b.cone(0.08, 0.22, "#1d1a22", PART.HEAD, { pos: [-0.12, top + 0.04, f.headZ - 0.05], rot: [-0.5, 0, 0.6], pivot: [0, f.neck, 0] });
  b.cone(0.08, 0.22, "#1d1a22", PART.HEAD, { pos: [0.12, top + 0.04, f.headZ - 0.05], rot: [-0.5, 0, -0.6], pivot: [0, f.neck, 0] });
  b.cone(0.07, 0.2, "#1d1a22", PART.HEAD, { pos: [0, top, f.headZ - 0.2], rot: [-1.3, 0, 0], pivot: [0, f.neck, 0] });
  eyes(b, f, "#fff27a", 0.05, 0.09, 0.02);
  // gaping mouth
  b.box(0.12, 0.07, 0.03, "#5a1020", PART.HEAD, headPart(f, [0, f.headY - 0.09, f.headZ + f.headR * 0.9]));
  return b.build();
}

export function buildBrute(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const skin = "#9a8fc0";
  const f = figure(
    b,
    { skin, shirt: "#d8c79c", sleeve: skin, pants: "#3f6f9f", shoe: "#2a2420" },
    { width: 1.55, height: 1.08, headR: 0.21, belly: 1.7, armThick: 0.24, hand: 2.0, legThick: 1.45, headZ: 0.1, headDrop: 0.08 },
  );
  // denim overalls: bib + straps + pocket
  const bibY = f.hip + 0.16;
  b.box(0.62, 0.34, 0.04, "#3f6f9f", PART.BODY, { pos: [0, bibY, f.front + 0.01] });
  b.box(0.1, 0.36, 0.04, "#3f6f9f", PART.BODY, { pos: [-0.24, f.neck - 0.18, f.front + 0.01] });
  b.box(0.1, 0.36, 0.04, "#3f6f9f", PART.BODY, { pos: [0.24, f.neck - 0.18, f.front + 0.01] });
  b.box(0.2, 0.12, 0.02, "#2f5478", PART.BODY, { pos: [0, bibY + 0.04, f.front + 0.035] });
  b.sphere(0.04, "#ffcc33", PART.BODY, { pos: [-0.24, f.neck - 0.06, f.front + 0.04] }, 5);
  b.sphere(0.04, "#ffcc33", PART.BODY, { pos: [0.24, f.neck - 0.06, f.front + 0.04] }, 5);
  // back hump
  b.sphere(0.32, skin, PART.BODY, { pos: [0, f.neck - 0.02, -0.16], scale: [1.3, 0.8, 1] }, 10);
  // stitched scar on the hump
  for (let k = 0; k < 4; k++) b.box(0.03, 0.03, 0.14, "#3a2a40", PART.BODY, { pos: [-0.15 + k * 0.1, f.neck + 0.2, -0.14], rot: [0.6, 0, 0] });
  // small angry head: brow, red eyes, tusks
  b.box(0.3, 0.05, 0.08, "#5e4f80", PART.HEAD, headPart(f, [0, f.headY + 0.08, f.headZ + 0.17]));
  eyes(b, f, "#ff4d4d", 0.04, 0.08, 0.02);
  b.cone(0.03, 0.09, "#fff6dc", PART.HEAD, headPart(f, [-0.08, f.headY - 0.07, f.headZ + 0.18]));
  b.cone(0.03, 0.09, "#fff6dc", PART.HEAD, headPart(f, [0.08, f.headY - 0.07, f.headZ + 0.18]));
  // knuckle wraps
  for (const s of [-1, 1]) {
    b.box(0.26, 0.08, 0.26, "#c9b48a", s < 0 ? PART.ARM_L : PART.ARM_R, {
      pos: [s * f.shoulderX, f.shoulder - f.armLen + 0.12, 0],
      pivot: [s * f.shoulderX, f.shoulder, 0],
    });
  }
  return b.build();
}

export function buildShield(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const f = figure(b, { skin: "#9cb27b", shirt: "#b4533a", pants: "#4d4f63", shoe: "#2a2a2a" }, { width: 1.05, headR: 0.26 });
  // cooking-pot helmet
  const hy = f.headY + 0.1;
  b.cyl(0.29, 0.3, 0.22, "#aab3bd", PART.HEAD, headPart(f, [0, hy + 0.06, 0]));
  b.cyl(0.36, 0.36, 0.04, "#7d8691", PART.HEAD, headPart(f, [0, hy - 0.04, 0]));
  b.box(0.16, 0.05, 0.05, "#7d8691", PART.HEAD, headPart(f, [0.33, hy + 0.08, 0]));
  eyes(b, f, "#ffffff", 0.05, 0.1, -0.03, "#202020");
  // the door-shield (BODY so it stays upright in front of the chest)
  const sz = f.front + 0.24;
  const sy = 0.66;
  b.box(0.9, 0.98, 0.08, "#b07a40", PART.BODY, { pos: [0, sy, sz] });
  for (const dx of [-0.22, 0.22]) b.box(0.02, 0.96, 0.02, "#7d5228", PART.BODY, { pos: [dx, sy, sz + 0.045] });
  // metal frame
  b.box(0.96, 0.07, 0.11, "#7d8691", PART.BODY, { pos: [0, sy + 0.48, sz] });
  b.box(0.96, 0.07, 0.11, "#7d8691", PART.BODY, { pos: [0, sy - 0.48, sz] });
  b.box(0.07, 1.0, 0.11, "#7d8691", PART.BODY, { pos: [-0.46, sy, sz] });
  b.box(0.07, 1.0, 0.11, "#7d8691", PART.BODY, { pos: [0.46, sy, sz] });
  // diagonal brace + emblem
  b.box(0.09, 1.2, 0.04, "#7d5228", PART.BODY, { pos: [0, sy, sz + 0.05], rot: [0, 0, 0.72] });
  b.cyl(0.17, 0.17, 0.05, "#e0b53a", PART.BODY, { pos: [0, sy + 0.04, sz + 0.07], rot: [Math.PI / 2, 0, 0] }, 12);
  b.cyl(0.08, 0.08, 0.06, "#c0392b", PART.BODY, { pos: [0, sy + 0.04, sz + 0.08], rot: [Math.PI / 2, 0, 0] }, 10);
  for (const [rx, ry] of [[-0.4, 0.42], [0.4, 0.42], [-0.4, -0.42], [0.4, -0.42]]) {
    b.sphere(0.035, "#e6e9ec", PART.BODY, { pos: [rx, sy + ry, sz + 0.06] }, 5);
  }
  return b.build();
}

export function buildSpitter(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const skin = "#86e24a";
  const f = figure(b, { skin, shirt: "#8a46c4", pants: "#5b3385", sleeve: "#8a46c4" }, { width: 0.95, headR: 0.25, headZ: 0.12, headDrop: 0.1 });
  // hood behind the face
  b.sphere(f.headR * 1.08, "#7a3cb0", PART.HEAD, headPart(f, [0, f.headY + 0.05, f.headZ - 0.12]), 10);
  b.cone(0.1, 0.25, "#7a3cb0", PART.HEAD, { pos: [0, f.headY + 0.18, f.headZ - 0.3], rot: [-1.9, 0, 0], pivot: [0, f.neck, 0] });
  // face bulges forward out of the hood
  b.sphere(f.headR * 0.95, skin, PART.HEAD, headPart(f, [0, f.headY - 0.02, f.headZ + 0.06]), 10);
  // glowing eyes + swollen toxic throat sac
  b.sphere(0.06, "#f4ff3a", PART.HEAD, headPart(f, [-0.09, f.headY + 0.05, f.headZ + 0.27]), 6);
  b.sphere(0.06, "#f4ff3a", PART.HEAD, headPart(f, [0.09, f.headY + 0.05, f.headZ + 0.27]), 6);
  b.sphere(0.24, "#c8ff4d", PART.HEAD, headPart(f, [0, f.headY - 0.2, f.headZ + 0.2]), 10);
  b.sphere(0.06, "#e9ff9a", PART.HEAD, headPart(f, [0.07, f.headY - 0.14, f.headZ + 0.35]), 6);
  b.sphere(0.045, "#8cff3a", PART.HEAD, headPart(f, [-0.05, f.headY - 0.36, f.headZ + 0.26]), 5);
  // toxic pustules on the back + belt
  b.sphere(0.12, "#a6ff4d", PART.BODY, { pos: [-0.12, 0.84, -0.17] }, 8);
  b.sphere(0.09, "#d4ff6a", PART.BODY, { pos: [0.14, 0.72, -0.16] }, 8);
  b.box(0.54, 0.06, 0.34, "#3d2060", PART.BODY, { pos: [0, 0.48, 0] });
  // robe skirt
  b.cyl(0.26, 0.34, 0.24, "#8a46c4", PART.BODY, { pos: [0, 0.38, 0] }, 8);
  return b.build();
}

export function buildBloater(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const skin = "#cbd46a";
  const hip = 0.34;
  for (const [s, part] of [[-1, PART.LEG_L], [1, PART.LEG_R]] as const) {
    b.box(0.17, hip, 0.2, "#5a4a3a", part, { pos: [s * 0.17, hip / 2, 0], pivot: [s * 0.17, hip, 0] });
    b.box(0.2, 0.08, 0.26, "#2b2b2b", part, { pos: [s * 0.17, 0.04, 0.03], pivot: [s * 0.17, hip, 0] });
  }
  // the huge belly
  const by = 0.78;
  b.sphere(0.52, skin, PART.BODY, { pos: [0, by, 0.04], scale: [1.08, 0.96, 1.05] }, 14);
  // tattered vest on the back
  b.sphere(0.46, "#7a4f8f", PART.BODY, { pos: [0, by + 0.08, -0.14], scale: [1.08, 0.9, 0.8] }, 10);
  // glowing pustules + stitches
  const spots: [number, number, number, number, string][] = [
    [0.22, 0.95, 0.42, 0.09, "#ff5f86"],
    [-0.28, 0.72, 0.44, 0.08, "#ffd23a"],
    [0.05, 0.6, 0.53, 0.07, "#ff5f86"],
    [-0.08, 1.06, 0.4, 0.06, "#ffd23a"],
    [0.4, 0.68, 0.3, 0.07, "#ff5f86"],
    [-0.42, 0.95, 0.2, 0.08, "#ff5f86"],
  ];
  for (const [x, y, z, r, c] of spots) b.sphere(r, c, PART.BODY, { pos: [x, y, z] }, 6);
  for (let k = 0; k < 4; k++) b.box(0.03, 0.12, 0.03, "#3b2a1a", PART.BODY, { pos: [-0.12 + k * 0.08, 0.84, 0.54], rot: [0, 0, 0.4] });
  b.box(0.3, 0.03, 0.03, "#3b2a1a", PART.BODY, { pos: [0, 0.84, 0.545] });
  // stubby arms
  for (const [s, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]] as const) {
    b.box(0.14, 0.32, 0.15, skin, part, { pos: [s * 0.58, 0.96, 0.02], pivot: [s * 0.56, 1.08, 0] });
  }
  // tiny head on top
  const hy = 1.36;
  const pv: V3 = [0, 1.2, 0];
  b.sphere(0.2, "#b8c45a", PART.HEAD, { pos: [0, hy, 0.08], pivot: pv }, 10);
  b.sphere(0.045, "#ffffff", PART.HEAD, { pos: [-0.07, hy + 0.04, 0.25], pivot: pv }, 5);
  b.sphere(0.045, "#ffffff", PART.HEAD, { pos: [0.07, hy + 0.04, 0.25], pivot: pv }, 5);
  b.box(0.1, 0.06, 0.03, "#4a1020", PART.HEAD, { pos: [0, hy - 0.07, 0.26], pivot: pv });
  return b.build();
}

export function buildMummy(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const wrap = "#eadfc4";
  const dark = "#bba886";
  const f = figure(b, { skin: wrap, shirt: wrap, pants: wrap, shoe: dark }, { width: 0.95, headR: 0.26 });
  // bandage bands (slightly tilted rings) on torso + head
  for (let k = 0; k < 4; k++) {
    b.box(0.54, 0.035, 0.34, dark, PART.BODY, { pos: [0, f.hip + 0.08 + k * 0.12, 0], rot: [0, 0, k % 2 ? 0.12 : -0.12] });
  }
  b.box(0.56, 0.04, 0.28, dark, PART.HEAD, { pos: [0, f.headY + 0.13, 0], rot: [0.2, 0, 0.15], pivot: [0, f.neck, 0] });
  b.box(0.56, 0.04, 0.3, dark, PART.HEAD, { pos: [0, f.headY - 0.12, 0], rot: [-0.15, 0, -0.1], pivot: [0, f.neck, 0] });
  for (const [s, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]] as const) {
    for (let k = 0; k < 3; k++) {
      b.box(0.16, 0.03, 0.17, dark, part, { pos: [s * f.shoulderX, f.shoulder - 0.1 - k * 0.13, 0], rot: [0, 0, s * 0.25], pivot: [s * f.shoulderX, f.shoulder, 0] });
    }
  }
  // loose dangling strip from the right arm
  b.box(0.06, 0.3, 0.02, wrap, PART.ARM_R, { pos: [f.shoulderX + 0.05, f.shoulder - f.armLen - 0.1, -0.04], pivot: [f.shoulderX, f.shoulder, 0] });
  // dark eye slit + glowing cyan eyes + gold amulet
  b.box(0.36, 0.09, 0.05, "#2a2230", PART.HEAD, headPart(f, [0, f.headY + 0.03, f.headR * 0.85]));
  b.sphere(0.055, "#5ff3ff", PART.HEAD, headPart(f, [-0.09, f.headY + 0.03, f.headR * 0.93]), 6);
  b.sphere(0.055, "#5ff3ff", PART.HEAD, headPart(f, [0.09, f.headY + 0.03, f.headR * 0.93]), 6);
  b.box(0.12, 0.12, 0.04, "#ffcc33", PART.BODY, { pos: [0, f.neck - 0.14, f.front + 0.02], rot: [0, 0, Math.PI / 4] });
  b.sphere(0.04, "#2fb8ff", PART.BODY, { pos: [0, f.neck - 0.14, f.front + 0.05] }, 5);
  return b.build();
}

export function buildGhost(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const body = "#bfaaff";
  const head = "#e6ddff";
  // tapered floating body (point down)
  b.cone(0.38, 0.8, body, PART.BODY, { pos: [0, 0.86, 0], rot: [Math.PI, 0, 0] }, 10);
  b.sphere(0.34, body, PART.BODY, { pos: [0, 1.16, 0], scale: [1, 0.7, 1] }, 10);
  // wispy tail tips swing like legs
  b.cone(0.12, 0.36, "#9d84f0", PART.LEG_L, { pos: [-0.1, 0.4, -0.04], rot: [Math.PI + 0.2, 0, 0.3], pivot: [-0.1, 0.62, 0] }, 6);
  b.cone(0.12, 0.36, "#9d84f0", PART.LEG_R, { pos: [0.1, 0.4, -0.04], rot: [Math.PI + 0.2, 0, -0.3], pivot: [0.1, 0.62, 0] }, 6);
  // reaching arms
  for (const [s, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]] as const) {
    b.capsule(0.07, 0.3, body, part, { pos: [s * 0.36, 1.0, 0], pivot: [s * 0.36, 1.16, 0] });
  }
  // big round head with hollow eyes and an "o" mouth
  const pv: V3 = [0, 1.2, 0];
  const hy = 1.5;
  b.sphere(0.32, head, PART.HEAD, { pos: [0, hy, 0.02], pivot: pv }, 12);
  for (const s of [-1, 1]) {
    b.sphere(0.085, "#2b1650", PART.HEAD, { pos: [s * 0.12, hy + 0.05, 0.26], scale: [1, 1.3, 0.6], pivot: pv }, 8);
    b.sphere(0.035, "#ff6ad5", PART.HEAD, { pos: [s * 0.12, hy + 0.06, 0.31], pivot: pv }, 5);
  }
  b.sphere(0.06, "#2b1650", PART.HEAD, { pos: [0, hy - 0.13, 0.28], scale: [1, 1.2, 0.6], pivot: pv }, 6);
  return b.build();
}

// ------------------------------------------------------------------ bosses --

export function buildBullBoss(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const skin = "#a47c5e";
  const f = figure(
    b,
    { skin, shirt: "#7e4c33", sleeve: skin, pants: "#4d3c37", shoe: "#2a201c" },
    { width: 1.6, height: 1.12, headR: 0.3, belly: 1.5, armThick: 0.24, hand: 2.1, legThick: 1.5, headZ: 0.14, headDrop: 0.06 },
  );
  // red loincloth + belt with gold buckle
  b.box(0.82, 0.08, 0.5, "#2a1c16", PART.BODY, { pos: [0, f.hip + 0.04, 0] });
  b.box(0.16, 0.12, 0.04, "#ffcc33", PART.BODY, { pos: [0, f.hip + 0.04, f.front + 0.02] });
  b.box(0.36, 0.3, 0.04, "#b0302a", PART.BODY, { pos: [0, f.hip - 0.13, f.front - 0.02] });
  // iron shoulder pads with spikes
  for (const s of [-1, 1]) {
    b.sphere(0.24, "#86909c", PART.BODY, { pos: [s * 0.46, f.neck - 0.04, 0], scale: [1.1, 0.75, 1.1] }, 10);
    b.cone(0.06, 0.2, "#d6dbe1", PART.BODY, { pos: [s * 0.52, f.neck + 0.16, 0], rot: [0, 0, -s * 0.4] }, 6);
    b.cone(0.05, 0.16, "#d6dbe1", PART.BODY, { pos: [s * 0.38, f.neck + 0.12, -0.12], rot: [-0.3, 0, -s * 0.2] }, 6);
  }
  // chain across the chest
  for (let k = 0; k < 6; k++) b.box(0.09, 0.05, 0.05, "#9aa3ad", PART.BODY, { pos: [-0.3 + k * 0.12, f.neck - 0.08 - k * 0.06, f.front + 0.02], rot: [0, 0, -0.5] });
  // bull head: snout, nose ring, horns, glowing eyes
  const hz = f.headZ;
  b.box(0.3, 0.2, 0.2, "#c99a86", PART.HEAD, headPart(f, [0, f.headY - 0.08, hz + 0.27]));
  b.sphere(0.03, "#3a2018", PART.HEAD, headPart(f, [-0.07, f.headY - 0.06, hz + 0.375]), 5);
  b.sphere(0.03, "#3a2018", PART.HEAD, headPart(f, [0.07, f.headY - 0.06, hz + 0.375]), 5);
  b.add(new THREE.TorusGeometry(0.07, 0.022, 6, 12), "#ffcc33", PART.HEAD, headPart(f, [0, f.headY - 0.17, hz + 0.39]));
  for (const s of [-1, 1]) {
    b.cone(0.09, 0.42, "#f3ead2", PART.HEAD, { pos: [s * 0.4, f.headY + 0.14, hz], rot: [0, 0, -s * 1.15], pivot: [0, f.neck, 0] }, 8);
    b.cone(0.05, 0.22, "#f3ead2", PART.HEAD, { pos: [s * 0.6, f.headY + 0.3, hz], rot: [0, 0, -s * 0.2], pivot: [0, f.neck, 0] }, 6);
  }
  b.box(0.36, 0.06, 0.1, "#3a2a22", PART.HEAD, headPart(f, [0, f.headY + 0.12, hz + 0.22]));
  eyes(b, f, "#ff3b2f", 0.055, 0.12, 0.05);
  return b.build();
}

export function buildWitchBoss(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const skin = "#9fd35a";
  const robe = "#3f8a52";
  // robe skirt hides the legs (tiny feet still shuffle)
  for (const [s, part] of [[-1, PART.LEG_L], [1, PART.LEG_R]] as const) {
    b.box(0.16, 0.12, 0.3, "#1e2a1e", part, { pos: [s * 0.15, 0.06, 0.06], pivot: [s * 0.15, 0.4, 0] });
  }
  b.cone(0.7, 1.15, robe, PART.BODY, { pos: [0, 0.58, 0] }, 12);
  b.cyl(0.36, 0.42, 0.42, "#56a565", PART.BODY, { pos: [0, 1.15, -0.02] }, 10);
  // ragged moss strands
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.box(0.08, 0.3, 0.04, "#2c5a38", PART.BODY, { pos: [Math.sin(a) * 0.62, 0.1, Math.cos(a) * 0.62], rot: [0, a, 0] });
  }
  // shoulder mushrooms
  for (const s of [-1, 1]) {
    b.cyl(0.06, 0.07, 0.18, "#f3ead2", PART.BODY, { pos: [s * 0.36, 1.42, -0.05] }, 6);
    b.sphere(0.17, "#ff5f86", PART.BODY, { pos: [s * 0.36, 1.53, -0.05], scale: [1, 0.55, 1] }, 10);
    b.sphere(0.035, "#ffffff", PART.BODY, { pos: [s * 0.3, 1.6, 0.04] }, 4);
    b.sphere(0.03, "#ffffff", PART.BODY, { pos: [s * 0.44, 1.58, -0.1] }, 4);
  }
  // long clawed arms
  for (const [s, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]] as const) {
    const pv: V3 = [s * 0.42, 1.3, 0];
    b.box(0.13, 0.62, 0.14, robe, part, { pos: [s * 0.42, 1.0, 0], pivot: pv });
    b.box(0.13, 0.14, 0.13, skin, part, { pos: [s * 0.42, 0.64, 0], pivot: pv });
    for (const dx of [-0.04, 0.04]) b.cone(0.025, 0.14, "#1a1a1a", part, { pos: [s * 0.42 + dx, 0.52, 0.02], rot: [Math.PI, 0, 0], pivot: pv }, 5);
  }
  // head: long nose, glowing eyes, crooked hat
  const pv: V3 = [0, 1.36, 0];
  const hy = 1.62;
  b.sphere(0.27, skin, PART.HEAD, { pos: [0, hy, 0.1], pivot: pv }, 12);
  b.cone(0.06, 0.26, "#8cc24a", PART.HEAD, { pos: [0, hy - 0.04, 0.42], rot: [1.75, 0, 0], pivot: pv }, 6);
  b.sphere(0.05, "#c6ff3a", PART.HEAD, { pos: [-0.1, hy + 0.06, 0.33], pivot: pv }, 6);
  b.sphere(0.05, "#c6ff3a", PART.HEAD, { pos: [0.1, hy + 0.06, 0.33], pivot: pv }, 6);
  b.box(0.14, 0.03, 0.02, "#2a1030", PART.HEAD, { pos: [0, hy - 0.15, 0.34], pivot: pv });
  b.cyl(0.56, 0.56, 0.05, "#6233a0", PART.HEAD, { pos: [0, hy + 0.2, 0.06], pivot: pv }, 16);
  b.cone(0.3, 0.7, "#6233a0", PART.HEAD, { pos: [0, hy + 0.55, -0.02], rot: [-0.25, 0, 0.1], pivot: pv }, 10);
  b.cyl(0.29, 0.31, 0.08, "#7dff3a", PART.HEAD, { pos: [0, hy + 0.27, 0.05], pivot: pv }, 12);
  b.sphere(0.06, "#ffcc33", PART.HEAD, { pos: [0.1, hy + 0.9, -0.12], pivot: pv }, 6);
  return b.build();
}

export function buildKingBoss(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const bone = "#ece4cf";
  const f = figure(
    b,
    { skin: bone, shirt: "#6040a0", sleeve: "#6040a0", pants: "#43345e", shoe: "#2a2033" },
    { width: 1.45, height: 1.15, headR: 0.29, belly: 1.3, armThick: 0.2, hand: 1.6, legThick: 1.35, headZ: 0.06 },
  );
  // royal cape (behind, flared)
  b.box(0.95, 1.05, 0.06, "#cc2a40", PART.BODY, { pos: [0, f.hip + 0.32, -f.front - 0.08], rot: [-0.12, 0, 0] });
  b.box(1.05, 0.12, 0.08, "#ffcc33", PART.BODY, { pos: [0, f.hip - 0.18, -f.front - 0.16], rot: [-0.12, 0, 0] });
  // gold trims + gem on the chest armour
  b.box(0.78, 0.07, 0.48, "#ffcc33", PART.BODY, { pos: [0, f.hip + 0.04, 0] });
  b.box(0.08, 0.5, 0.03, "#ffcc33", PART.BODY, { pos: [0, f.hip + 0.3, f.front + 0.01] });
  b.sphere(0.07, "#ff2f5a", PART.BODY, { pos: [0, f.neck - 0.16, f.front + 0.04] }, 8);
  // pauldrons
  for (const s of [-1, 1]) {
    b.sphere(0.25, "#7a5cb8", PART.BODY, { pos: [s * 0.44, f.neck - 0.02, 0], scale: [1.15, 0.7, 1.1] }, 10);
    b.box(0.5, 0.05, 0.05, "#ffcc33", PART.BODY, { pos: [s * 0.46, f.neck - 0.08, 0.2], rot: [0, 0, s * 0.3] });
  }
  // greatsword in the right hand: hangs down, raised forward by the shader
  const sx = f.shoulderX;
  const pv: V3 = [sx, f.shoulder, 0];
  const handY = f.shoulder - f.armLen;
  b.box(0.3, 0.06, 0.08, "#ffcc33", PART.ARM_R, { pos: [sx, handY - 0.06, 0], pivot: pv });
  b.box(0.14, 1.15, 0.05, "#cfd8e3", PART.ARM_R, { pos: [sx, handY - 0.66, 0], pivot: pv });
  b.box(0.04, 1.1, 0.06, "#8fa0b3", PART.ARM_R, { pos: [sx, handY - 0.64, 0], pivot: pv });
  b.cone(0.07, 0.16, "#cfd8e3", PART.ARM_R, { pos: [sx, handY - 1.3, 0], rot: [Math.PI, 0, 0], pivot: pv }, 4);
  // skull face: dark sockets, red glow, jaw
  for (const s of [-1, 1]) {
    b.sphere(0.085, "#1a1020", PART.HEAD, headPart(f, [s * 0.11, f.headY + 0.03, f.headZ + 0.21]), 8);
    b.sphere(0.04, "#ff3030", PART.HEAD, headPart(f, [s * 0.11, f.headY + 0.03, f.headZ + 0.28]), 5);
  }
  b.box(0.26, 0.1, 0.16, bone, PART.HEAD, headPart(f, [0, f.headY - 0.21, f.headZ + 0.1]));
  for (let k = 0; k < 4; k++) b.box(0.025, 0.05, 0.02, "#1a1020", PART.HEAD, headPart(f, [-0.075 + k * 0.05, f.headY - 0.15, f.headZ + 0.27]));
  // crown
  const cy = f.headY + 0.24;
  b.cyl(0.25, 0.23, 0.12, "#ffcc33", PART.HEAD, headPart(f, [0, cy, f.headZ - 0.02]));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.cone(0.06, 0.18, "#ffcc33", PART.HEAD, headPart(f, [Math.sin(a) * 0.2, cy + 0.14, f.headZ - 0.02 + Math.cos(a) * 0.2]));
  }
  b.sphere(0.045, "#ff2f5a", PART.HEAD, headPart(f, [0, cy, f.headZ + 0.22]), 6);
  return b.build();
}
