import * as THREE from "three";

let ramp: THREE.DataTexture | null = null;

/** 3-band toon ramp for weapon meshes (own copy so weapons don't depend on enemy code) */
export function weaponToonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/** give every vertex of `g` the same colour (linear) via a `color` attribute */
export function paint(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

/** strip to position/normal/color (non-indexed) so differing primitives can be merged */
export function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) {
    if (k !== "position" && k !== "normal" && k !== "color") out.deleteAttribute(k);
  }
  return out;
}
