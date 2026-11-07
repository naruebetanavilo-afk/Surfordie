import * as THREE from "three";
import { PART, glow, PartBuilder } from "./PartBuilder";
import { figure, type FigureInfo } from "./models";

/**
 * Procedural models for the frozen-graveyard roster (stage "snow").
 * Same rules as models.ts: ONE merged geometry per type, facing +Z, feet at
 * y = 0. Bodies use mid/dark tones (slate fur, navy cloth, orange parka) and
 * glowing ice accents so they stay readable on the bright snow.
 */

type V3 = [number, number, number];

function hp(f: FigureInfo, pos: V3): { pos: V3; pivot: V3 } {
  return { pos, pivot: [0, f.neck, 0] };
}

/** two glowing eyes on a figure's head */
function glowEyes(b: PartBuilder, f: FigureInfo, color: string, size: number, spread: number, dy = 0.04): void {
  const z = f.headZ + f.headR * 0.86;
  for (const s of [-1, 1]) b.sphere(size, color, glow(PART.HEAD), hp(f, [s * spread, f.headY + dy, z]), 6);
}

/** icicle hanging from (x, y, z) on a given part */
function icicle(b: PartBuilder, part: number, x: number, y: number, z: number, len: number, r: number, pivot: V3, color = "#a6e4ff"): void {
  b.cone(r, len, color, part, { pos: [x, y - len / 2, z], rot: [Math.PI, 0, 0], pivot }, 5);
}

// ---------------------------------------------------------------- regulars --

/**
 * หมาป่าน้ำแข็ง — quadruped pack hunter. Front legs use the ARM parts and the
 * back legs the LEG parts: with armRaise 0 the shader swings front-left with
 * back-right (a trot).
 */
export function buildFrostWolf(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const fur = "#56688f";
  const dark = "#3b4a6b";
  const belly = "#dfe8f6";
  const ice = "#8ff0ff";
  const hipY = 0.46;
  // legs: [x, z, part]
  const legs: [number, number, number][] = [
    [-0.13, 0.27, PART.ARM_L],
    [0.13, 0.27, PART.ARM_R],
    [0.13, -0.27, PART.LEG_L],
    [-0.13, -0.27, PART.LEG_R],
  ];
  for (const [x, z, part] of legs) {
    const pv: V3 = [x, hipY, z];
    b.box(0.11, hipY, 0.12, fur, part, { pos: [x, hipY / 2, z], pivot: pv });
    b.box(0.13, 0.06, 0.17, dark, part, { pos: [x, 0.03, z + 0.03], pivot: pv });
  }
  // body: long barrel + white belly + chest ruff
  b.capsule(0.22, 0.5, fur, PART.BODY, { pos: [0, 0.56, -0.02], rot: [Math.PI / 2, 0, 0] });
  b.box(0.3, 0.12, 0.6, belly, PART.BODY, { pos: [0, 0.4, 0] });
  b.sphere(0.24, belly, PART.BODY, { pos: [0, 0.6, 0.3], scale: [1, 1.05, 0.8] }, 10);
  // icy spikes along the spine (glow)
  for (let k = 0; k < 4; k++) {
    b.cone(0.055, 0.2 - k * 0.025, ice, glow(PART.BODY), { pos: [0, 0.8 - k * 0.02, 0.18 - k * 0.15], rot: [-0.35, 0, 0] }, 5);
  }
  // tail: bushy, pointing back and up, frosted tip
  b.cone(0.11, 0.42, fur, PART.BODY, { pos: [0, 0.68, -0.46], rot: [-2.2, 0, 0] }, 7);
  b.sphere(0.08, belly, PART.BODY, { pos: [0, 0.82, -0.62] }, 7);
  // head (pivot at the neck)
  const pv: V3 = [0, 0.66, 0.36];
  const hy = 0.78;
  const hz = 0.5;
  b.box(0.3, 0.26, 0.28, fur, PART.HEAD, { pos: [0, hy, hz], pivot: pv });
  b.box(0.18, 0.14, 0.24, belly, PART.HEAD, { pos: [0, hy - 0.06, hz + 0.2], pivot: pv });
  b.sphere(0.045, "#1b2233", PART.HEAD, { pos: [0, hy - 0.01, hz + 0.33], pivot: pv }, 6);
  b.box(0.14, 0.03, 0.04, "#1b2233", PART.HEAD, { pos: [0, hy - 0.12, hz + 0.3], pivot: pv });
  // ears
  for (const s of [-1, 1]) {
    b.cone(0.06, 0.16, dark, PART.HEAD, { pos: [s * 0.1, hy + 0.2, hz - 0.06], rot: [-0.15, 0, -s * 0.2], pivot: pv }, 4);
    b.sphere(0.04, ice, glow(PART.HEAD), { pos: [s * 0.08, hy + 0.05, hz + 0.145], pivot: pv }, 6);
  }
  // little fangs
  for (const s of [-1, 1]) b.cone(0.016, 0.05, "#ffffff", PART.HEAD, { pos: [s * 0.05, hy - 0.15, hz + 0.28], rot: [Math.PI, 0, 0], pivot: pv }, 4);
  return b.build();
}

/** ซอมบี้น้ำแข็ง — frozen corpse with an ice-encased fist and icicles */
export function buildIceZombie(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const skin = "#8cbbe0";
  const f = figure(b, { skin, shirt: "#2e4270", pants: "#283656", shoe: "#1a2238" }, { width: 1.05, headR: 0.27, belly: 1.15 });
  // torn shirt with frost crust
  b.box(0.3, 0.12, 0.02, "#22325a", PART.BODY, { pos: [-0.04, 0.62, f.front + 0.01] });
  b.sphere(0.14, "#e8f4ff", PART.BODY, { pos: [-0.22, f.neck - 0.02, 0.02], scale: [1.2, 0.6, 1.1] }, 8);
  b.sphere(0.1, "#e8f4ff", PART.BODY, { pos: [0.24, f.neck - 0.04, -0.04], scale: [1.1, 0.55, 1] }, 8);
  // ice crystals growing out of the back (glow)
  b.cone(0.07, 0.3, "#7fe6ff", glow(PART.BODY), { pos: [-0.1, f.neck - 0.05, -0.2], rot: [-0.7, 0, 0.3] }, 5);
  b.cone(0.06, 0.24, "#7fe6ff", glow(PART.BODY), { pos: [0.12, f.neck - 0.15, -0.2], rot: [-0.8, 0, -0.3] }, 5);
  // left fist frozen in a big ice block
  const sx = f.shoulderX;
  const handY = f.shoulder - f.armLen;
  b.box(0.26, 0.26, 0.26, "#a8e6ff", glow(PART.ARM_L), { pos: [-sx, handY + 0.02, 0], rot: [0.3, 0.4, 0.2], pivot: [-sx, f.shoulder, 0] });
  // icicles hanging from the arms
  icicle(b, PART.ARM_R, sx, f.shoulder - 0.16, 0.07, 0.16, 0.025, [sx, f.shoulder, 0]);
  icicle(b, PART.ARM_R, sx + 0.04, f.shoulder - 0.3, -0.06, 0.12, 0.022, [sx, f.shoulder, 0]);
  icicle(b, PART.ARM_L, -sx - 0.03, f.shoulder - 0.2, 0.06, 0.13, 0.022, [-sx, f.shoulder, 0]);
  // frozen white hair spikes
  const top = f.headY + f.headR * 0.8;
  for (const [x, z, rx, rz] of [
    [0, -0.02, -0.3, 0],
    [-0.1, 0, -0.2, 0.5],
    [0.1, 0, -0.2, -0.5],
    [0, -0.14, -1.0, 0],
  ]) {
    b.cone(0.06, 0.2, "#eef8ff", PART.HEAD, { pos: [x, top + 0.04, z], rot: [rx, 0, rz], pivot: [0, f.neck, 0] }, 5);
  }
  glowEyes(b, f, "#5ff6ff", 0.055, 0.1, 0.03);
  // blue-lipped gaping mouth + frost on the chin
  b.box(0.13, 0.06, 0.03, "#16243e", PART.HEAD, hp(f, [0, f.headY - 0.1, f.headR * 0.9]));
  icicle(b, PART.HEAD, -0.04, f.headY - 0.14, f.headR * 0.85, 0.08, 0.018, [0, f.neck, 0]);
  return b.build();
}

/** ภูตปาหิมะ — small parka imp that lobs snowballs */
export function buildSnowImp(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const parka = "#d0662c";
  const fur = "#f4f1ea";
  const skin = "#78a6f0";
  const f = figure(
    b,
    { skin, shirt: parka, pants: "#5b3b2a", shoe: "#3a2618" },
    { width: 0.95, height: 0.9, headR: 0.28, belly: 1.25, armThick: 0.14, hand: 1.15, headZ: 0.04 },
  );
  // fur hem + belt
  b.box(0.56, 0.08, 0.44, fur, PART.BODY, { pos: [0, f.hip + 0.02, 0] });
  b.box(0.54, 0.05, 0.42, "#6b3a1c", PART.BODY, { pos: [0, f.hip + 0.13, 0] });
  // fur cuffs
  for (const [s, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]] as const) {
    b.box(0.17, 0.06, 0.17, fur, part, { pos: [s * f.shoulderX, f.shoulder - f.armLen + 0.11, 0], pivot: [s * f.shoulderX, f.shoulder, 0] });
  }
  // snowball held in the right hand (raised by the shader when it throws)
  b.sphere(0.12, "#ffffff", PART.ARM_R, { pos: [f.shoulderX, f.shoulder - f.armLen - 0.06, 0.04], pivot: [f.shoulderX, f.shoulder, 0] }, 8);
  // sack of snowballs on the back
  b.sphere(0.2, "#b99a6c", PART.BODY, { pos: [0, f.hip + 0.3, -0.26], scale: [1, 1.1, 0.8] }, 8);
  b.sphere(0.08, "#ffffff", PART.BODY, { pos: [-0.06, f.hip + 0.5, -0.26] }, 6);
  b.sphere(0.07, "#ffffff", PART.BODY, { pos: [0.07, f.hip + 0.52, -0.22] }, 6);
  // hood: parka shell behind the face, white fur ring around it, pointy tip
  b.sphere(f.headR * 1.15, parka, PART.HEAD, hp(f, [0, f.headY + 0.04, f.headZ - 0.08]), 10);
  b.add(new THREE.TorusGeometry(f.headR * 0.95, 0.07, 6, 14), fur, PART.HEAD, hp(f, [0, f.headY, f.headZ + 0.13]));
  b.cone(0.1, 0.28, parka, PART.HEAD, { pos: [0, f.headY + 0.3, f.headZ - 0.18], rot: [-0.9, 0, 0], pivot: [0, f.neck, 0] }, 6);
  b.sphere(0.07, fur, PART.HEAD, hp(f, [0, f.headY + 0.42, f.headZ - 0.32]), 6);
  // face pushed forward into the fur ring, big glowing eyes, fangs
  b.sphere(f.headR * 0.8, skin, PART.HEAD, hp(f, [0, f.headY - 0.01, f.headZ + 0.08]), 10);
  for (const s of [-1, 1]) {
    b.sphere(0.07, "#ffe23a", glow(PART.HEAD), hp(f, [s * 0.09, f.headY + 0.04, f.headZ + 0.27]), 7);
    b.cone(0.02, 0.06, "#ffffff", PART.HEAD, { pos: [s * 0.04, f.headY - 0.11, f.headZ + 0.27], rot: [Math.PI, 0, 0], pivot: [0, f.neck, 0] }, 4);
  }
  return b.build();
}

/** ยักษ์หิมะ — shaggy snow giant that pounds the ground */
export function buildYeti(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const fur = "#8d97c0";
  const furLight = "#c3cbe6";
  const face = "#3d4b78";
  const f = figure(
    b,
    { skin: face, shirt: fur, sleeve: fur, pants: fur, shoe: face },
    { width: 1.5, height: 1.08, headR: 0.24, belly: 1.65, armThick: 0.26, hand: 2.1, legThick: 1.5, headZ: 0.1, headDrop: 0.06 },
  );
  // darker chest patch
  b.box(0.5, 0.36, 0.04, "#6c76a3", PART.BODY, { pos: [0, f.hip + 0.3, f.front + 0.01] });
  // shaggy fur tufts on shoulders, hips and back
  const tufts: [number, number, number, number, number][] = [
    [-0.42, f.neck - 0.02, 0, 0.0, 0.7],
    [0.42, f.neck - 0.02, 0, 0.0, -0.7],
    [-0.3, f.hip + 0.05, 0.12, 0.4, 0.4],
    [0.3, f.hip + 0.05, 0.12, 0.4, -0.4],
    [0, f.neck + 0.05, -0.16, -0.7, 0],
  ];
  for (const [x, y, z, rx, rz] of tufts) b.cone(0.13, 0.3, furLight, PART.BODY, { pos: [x, y, z], rot: [rx, 0, rz] }, 6);
  b.sphere(0.34, fur, PART.BODY, { pos: [0, f.neck - 0.02, -0.15], scale: [1.35, 0.8, 1] }, 10);
  // ice crystals growing from the back (glow)
  for (const [x, y, z, h, rx, rz] of [
    [-0.18, f.neck + 0.1, -0.3, 0.42, -0.6, 0.35],
    [0.15, f.neck + 0.14, -0.3, 0.5, -0.5, -0.3],
    [0.0, f.neck - 0.15, -0.4, 0.34, -1.0, 0.0],
  ]) {
    b.cone(0.09, h, "#8ff0ff", glow(PART.BODY), { pos: [x, y, z], rot: [rx, 0, rz] }, 5);
  }
  // fur cuffs on the big fists
  for (const [s, part] of [[-1, PART.ARM_L], [1, PART.ARM_R]] as const) {
    b.box(0.32, 0.12, 0.32, furLight, part, { pos: [s * f.shoulderX, f.shoulder - f.armLen + 0.2, 0], pivot: [s * f.shoulderX, f.shoulder, 0] });
  }
  // head: fur hood around a dark face, curled horns, angry orange eyes, tusks
  b.sphere(f.headR * 1.25, furLight, PART.HEAD, hp(f, [0, f.headY + 0.05, f.headZ - 0.08]), 10);
  b.sphere(f.headR * 0.88, face, PART.HEAD, hp(f, [0, f.headY - 0.02, f.headZ + 0.08]), 10);
  for (const s of [-1, 1]) {
    b.cone(0.07, 0.34, "#efe6cf", PART.HEAD, { pos: [s * 0.28, f.headY + 0.16, f.headZ - 0.04], rot: [-0.3, 0, -s * 1.0], pivot: [0, f.neck, 0] }, 6);
    b.cone(0.045, 0.16, "#efe6cf", PART.HEAD, { pos: [s * 0.43, f.headY + 0.32, f.headZ - 0.1], rot: [-0.6, 0, -s * 0.1], pivot: [0, f.neck, 0] }, 5);
    b.sphere(0.045, "#ffa22e", glow(PART.HEAD), hp(f, [s * 0.08, f.headY + 0.03, f.headZ + 0.27]), 6);
    b.cone(0.03, 0.09, "#ffffff", PART.HEAD, hp(f, [s * 0.07, f.headY - 0.1, f.headZ + 0.25]));
  }
  b.box(0.24, 0.05, 0.06, "#222b48", PART.HEAD, hp(f, [0, f.headY + 0.1, f.headZ + 0.23]));
  return b.build();
}

// ------------------------------------------------------------------ boss --

/** พญาเหมันต์ — crowned winter warden with an ice staff (final boss of "snow") */
export function buildFrostBoss(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const navy = "#34508f";
  const navyDark = "#27396e";
  const ice = "#9feaff";
  const silver = "#c9d6ea";
  const fur = "#f1f5ff";
  const f = figure(
    b,
    { skin: "#d4e8ff", shirt: navy, sleeve: navy, pants: navyDark, shoe: "#141c3a" },
    { width: 1.45, height: 1.18, headR: 0.29, belly: 1.3, armThick: 0.2, hand: 1.5, legThick: 1.35, headZ: 0.05 },
  );
  // long robe skirt over the legs with a glowing frost hem
  b.cyl(0.36, 0.6, 0.62, navy, PART.BODY, { pos: [0, f.hip - 0.12, 0] }, 12);
  b.cyl(0.59, 0.63, 0.08, ice, glow(PART.BODY), { pos: [0, f.hip - 0.42, 0] }, 12);
  // silver belt + chest crest
  b.box(0.8, 0.08, 0.5, silver, PART.BODY, { pos: [0, f.hip + 0.06, 0] });
  b.box(0.1, 0.42, 0.03, silver, PART.BODY, { pos: [0, f.hip + 0.32, f.front + 0.01] });
  b.add(new THREE.OctahedronGeometry(0.1, 0), ice, glow(PART.BODY), { pos: [0, f.neck - 0.16, f.front + 0.05], scale: [1, 1.4, 0.6] });
  // cape behind (navy outside, icy lining edge)
  b.box(1.0, 1.25, 0.06, navyDark, PART.BODY, { pos: [0, f.hip + 0.22, -f.front - 0.1], rot: [-0.12, 0, 0] });
  b.box(1.04, 0.08, 0.08, ice, PART.BODY, { pos: [0, f.hip - 0.4, -f.front - 0.17], rot: [-0.12, 0, 0] });
  // white fur mantle round the shoulders
  b.add(new THREE.TorusGeometry(0.36, 0.12, 6, 14), fur, PART.BODY, { pos: [0, f.neck - 0.02, 0], rot: [Math.PI / 2, 0, 0], scale: [1.25, 1, 1] });
  // shoulder pauldrons topped with ice crystal clusters
  for (const s of [-1, 1]) {
    b.sphere(0.24, silver, PART.BODY, { pos: [s * 0.46, f.neck - 0.04, 0], scale: [1.15, 0.7, 1.1] }, 10);
    b.cone(0.08, 0.36, ice, glow(PART.BODY), { pos: [s * 0.52, f.neck + 0.2, 0.02], rot: [0, 0, -s * 0.35] }, 5);
    b.cone(0.06, 0.24, ice, glow(PART.BODY), { pos: [s * 0.4, f.neck + 0.14, -0.12], rot: [-0.4, 0, -s * 0.15] }, 5);
    b.cone(0.05, 0.2, ice, glow(PART.BODY), { pos: [s * 0.6, f.neck + 0.08, 0.12], rot: [0.4, 0, -s * 0.8] }, 5);
  }
  // ice staff in the right hand (raised forward by the shader): pole, prongs, orb
  const sx = f.shoulderX;
  const pv: V3 = [sx, f.shoulder, 0];
  const handY = f.shoulder - f.armLen;
  b.box(0.07, 1.5, 0.07, "#5a6d99", PART.ARM_R, { pos: [sx, handY - 0.15, 0], pivot: pv });
  b.box(0.12, 0.08, 0.12, silver, PART.ARM_R, { pos: [sx, handY + 0.55, 0], pivot: pv });
  b.box(0.12, 0.08, 0.12, silver, PART.ARM_R, { pos: [sx, handY - 0.88, 0], pivot: pv });
  for (const s of [-1, 1]) b.cone(0.04, 0.26, silver, PART.ARM_R, { pos: [sx + s * 0.1, handY - 0.98, 0], rot: [Math.PI, 0, s * 0.35], pivot: pv }, 5);
  b.sphere(0.15, "#c8f8ff", glow(PART.ARM_R), { pos: [sx, handY - 1.05, 0], pivot: pv }, 10);
  // head: pale face, glowing eyes, icicle beard
  for (const s of [-1, 1]) {
    b.sphere(0.07, "#123a6a", PART.HEAD, hp(f, [s * 0.11, f.headY + 0.03, f.headZ + 0.22]), 8);
    b.sphere(0.045, "#5ff6ff", glow(PART.HEAD), hp(f, [s * 0.11, f.headY + 0.03, f.headZ + 0.27]), 6);
  }
  b.box(0.3, 0.05, 0.1, "#8fb4dc", PART.HEAD, hp(f, [0, f.headY + 0.12, f.headZ + 0.22]));
  for (let k = 0; k < 5; k++) {
    const x = -0.14 + k * 0.07;
    const len = 0.16 + (k === 2 ? 0.12 : k % 2 ? 0.05 : 0.0);
    icicle(b, PART.HEAD, x, f.headY - 0.12, f.headZ + 0.2 - Math.abs(x) * 0.3, len, 0.03, [0, f.neck, 0], ice);
  }
  // tall crown of ice crystals around a silver band
  const cy = f.headY + 0.22;
  b.cyl(0.26, 0.24, 0.1, silver, PART.HEAD, hp(f, [0, cy, f.headZ - 0.02]), 12);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    const h = k === 0 ? 0.5 : k % 2 ? 0.32 : 0.24;
    b.cone(0.06, h, ice, glow(PART.HEAD), hp(f, [Math.sin(a) * 0.22, cy + h / 2 + 0.04, f.headZ - 0.02 + Math.cos(a) * 0.22]), 5);
  }
  return b.build();
}
