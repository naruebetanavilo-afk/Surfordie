import * as THREE from "three";

// Parsing CSS colour strings is surprisingly slow (regex + colour management),
// and effects are spawned hundreds of times per second with the same handful
// of colours, so parsed colours are cached by string.
const cache = new Map<string, THREE.Color>();

/** Cached, shared THREE.Color for a CSS colour string. Never mutate the result. */
export function rgb(color: string): THREE.Color {
  let c = cache.get(color);
  if (!c) {
    c = new THREE.Color(color);
    if (cache.size > 512) cache.clear();
    cache.set(color, c);
  }
  return c;
}

/** Scratch colour helpers (write into `out`, no allocation). */
export function mixInto(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}

export const WHITE = new THREE.Color(1, 1, 1);
export const BLACK = new THREE.Color(0, 0, 0);
