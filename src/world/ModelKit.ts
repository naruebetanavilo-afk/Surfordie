import * as THREE from "three";
import { toonGradient } from "../enemies/AnimatedMaterial";

/**
 * Procedural model kit.
 *
 * Collects primitive geometries (already placed in model space) with a flat
 * colour, an optional bone index (rigid skinning) and an optional glow amount,
 * then merges them into ONE indexed BufferGeometry with attributes:
 *   position, normal, color, aGlow (+ skinIndex/skinWeight when rigged)
 * A second merged geometry with position-averaged normals (`aOutN`) is built
 * for an inverted-hull outline.
 *
 * Heroes use it to become a single SkinnedMesh (+1 outline mesh) whose bones
 * keep the named-part contract (body, head, armL...). Decor & pickups use the
 * static merge for one-geometry-per-InstancedMesh props.
 */

export interface PartOpts {
  /** bone index for rigid skinning (default 0) */
  bone?: number;
  /** 0..1 self-illumination (emissive = vertex colour * glow) */
  glow?: number;
  /** include in the outline hull (default true) */
  outline?: boolean;
  /** multiply vertex colours by a vertical gradient: bottom *= shade (fake AO) */
  shadeBottom?: number;
}

interface Part {
  geo: THREE.BufferGeometry;
  color: THREE.Color;
  bone: number;
  glow: number;
  outline: boolean;
  shadeBottom: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** place a geometry: scale, then rotate (XYZ euler), then translate. Returns the same geometry. */
export function place(
  geo: THREE.BufferGeometry,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.BufferGeometry {
  tmpE.set(rx, ry, rz);
  tmpQ.setFromEuler(tmpE);
  tmpP.set(x, y, z);
  tmpS.set(sx, sy, sz);
  tmpM.compose(tmpP, tmpQ, tmpS);
  geo.applyMatrix4(tmpM);
  return geo;
}

// --- primitive shorthands (all centred on the origin) ---------------------
export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const sph = (r: number, ws = 14, hs = 10): THREE.BufferGeometry => new THREE.SphereGeometry(r, ws, hs);
export const cyl = (rt: number, rb: number, h: number, seg = 12, open = false): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const cone = (r: number, h: number, seg = 10): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, seg);
export const capsule = (r: number, len: number, seg = 10): THREE.BufferGeometry =>
  new THREE.CapsuleGeometry(r, len, 4, seg);
export const torus = (r: number, tube: number, rs = 6, ts = 14, arc = Math.PI * 2): THREE.BufferGeometry =>
  new THREE.TorusGeometry(r, tube, rs, ts, arc);
export const ico = (r: number, detail = 0): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, detail);
export const dodeca = (r: number): THREE.BufferGeometry => new THREE.DodecahedronGeometry(r, 0);

export class ModelKit {
  private parts: Part[] = [];

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, opts: PartOpts = {}): this {
    this.parts.push({
      geo,
      color: new THREE.Color(color),
      bone: opts.bone ?? 0,
      glow: opts.glow ?? 0,
      outline: opts.outline ?? true,
      shadeBottom: opts.shadeBottom ?? 1,
    });
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** merged render geometry (position, normal, color, aGlow, optional skinning) */
  build(rigged = false): THREE.BufferGeometry {
    return merge(this.parts, rigged, false);
  }

  /** merged outline-hull geometry (position, aOutN, optional skinning) */
  buildOutline(rigged = false): THREE.BufferGeometry {
    return merge(
      this.parts.filter((p) => p.outline),
      rigged,
      true,
    );
  }

  dispose(): void {
    for (const p of this.parts) p.geo.dispose();
    this.parts = [];
  }
}

function merge(parts: Part[], rigged: boolean, outline: boolean): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    const n = p.geo.getAttribute("position").count;
    nv += n;
    ni += p.geo.index ? p.geo.index.count : n;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = outline ? null : new Float32Array(nv * 3);
  const glow = outline ? null : new Float32Array(nv);
  const skI = rigged ? new Uint16Array(nv * 4) : null;
  const skW = rigged ? new Float32Array(nv * 4) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);

  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geo;
    const pa = g.getAttribute("position") as THREE.BufferAttribute;
    let na = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (!na) {
      g.computeVertexNormals();
      na = g.getAttribute("normal") as THREE.BufferAttribute;
    }
    const n = pa.count;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const y = pa.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const spanY = Math.max(1e-5, maxY - minY);
    for (let i = 0; i < n; i++) {
      const o = (vo + i) * 3;
      pos[o] = pa.getX(i);
      pos[o + 1] = pa.getY(i);
      pos[o + 2] = pa.getZ(i);
      nor[o] = na.getX(i);
      nor[o + 1] = na.getY(i);
      nor[o + 2] = na.getZ(i);
      if (col && glow) {
        const t = (pa.getY(i) - minY) / spanY;
        const sh = p.shadeBottom + (1 - p.shadeBottom) * t;
        col[o] = p.color.r * sh;
        col[o + 1] = p.color.g * sh;
        col[o + 2] = p.color.b * sh;
        glow[vo + i] = p.glow;
      }
      if (skI && skW) {
        skI[(vo + i) * 4] = p.bone;
        skW[(vo + i) * 4] = 1;
      }
    }
    if (outline) averageNormals(pos, nor, vo, n);
    if (g.index) {
      const gi = g.index;
      for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo;
      io += gi.count;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = vo + i;
      io += n;
    }
    vo += n;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (outline) {
    out.setAttribute("aOutN", new THREE.BufferAttribute(nor, 3));
    // three needs a `normal` attribute for skinned normal code paths
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  } else {
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col!, 3));
    out.setAttribute("aGlow", new THREE.BufferAttribute(glow!, 1));
  }
  if (skI && skW) {
    out.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skI, 4));
    out.setAttribute("skinWeight", new THREE.BufferAttribute(skW, 4));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** replace normals by the average normal of all vertices sharing a position (hard edges -> smooth hull) */
function averageNormals(pos: Float32Array, nor: Float32Array, start: number, count: number): void {
  const map = new Map<string, number[]>();
  for (let i = start; i < start + count; i++) {
    const key = `${Math.round(pos[i * 3] * 1000)},${Math.round(pos[i * 3 + 1] * 1000)},${Math.round(pos[i * 3 + 2] * 1000)}`;
    let l = map.get(key);
    if (!l) map.set(key, (l = []));
    l.push(i);
  }
  for (const list of map.values()) {
    if (list.length < 2) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const i of list) {
      x += nor[i * 3];
      y += nor[i * 3 + 1];
      z += nor[i * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of list) {
      nor[i * 3] = x / l;
      nor[i * 3 + 1] = y / l;
      nor[i * 3 + 2] = z / l;
    }
  }
}

/**
 * Merge several kit-built static geometries (position, normal, color, aGlow,
 * index) into one, tagging every vertex with its variant id (`aVar`). Used
 * with `kitToonMaterial({ variants: true })` + a per-instance `iVar` attribute
 * so ONE InstancedMesh can draw many different props (non-matching vertices
 * are discarded in the vertex shader).
 */
export function mergeVariants(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const g of geos) {
    nv += g.getAttribute("position").count;
    ni += g.index ? g.index.count : 0;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const glow = new Float32Array(nv);
  const vr = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0;
  let io = 0;
  geos.forEach((g, v) => {
    const n = g.getAttribute("position").count;
    pos.set((g.getAttribute("position") as THREE.BufferAttribute).array as Float32Array, vo * 3);
    nor.set((g.getAttribute("normal") as THREE.BufferAttribute).array as Float32Array, vo * 3);
    col.set((g.getAttribute("color") as THREE.BufferAttribute).array as Float32Array, vo * 3);
    glow.set((g.getAttribute("aGlow") as THREE.BufferAttribute).array as Float32Array, vo);
    vr.fill(v, vo, vo + n);
    const gi = g.index!;
    for (let i = 0; i < gi.count; i++) idx[io + i] = gi.getX(i) + vo;
    io += gi.count;
    vo += n;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.setAttribute("aGlow", new THREE.BufferAttribute(glow, 1));
  out.setAttribute("aVar", new THREE.BufferAttribute(vr, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// --- materials ---------------------------------------------------------------

export interface KitToonOpts {
  rim?: number;
  rimColor?: string;
  emissive?: string;
  /** per-instance variant selection (geometry from mergeVariants + InstancedBufferAttribute `iVar`) */
  variants?: boolean;
  /** wind sway amplitude (world units per unit of height); needs `time` */
  wind?: number;
  /** shared time uniform for wind */
  time?: { value: number };
}

/**
 * Vertex-coloured toon material with per-vertex glow (aGlow) and an optional
 * cool fresnel rim light. Works for Mesh, InstancedMesh (instanceColor tints)
 * and SkinnedMesh.
 */
export function kitToonMaterial(opts: KitToonOpts = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: toonGradient(),
    emissive: opts.emissive ?? "#000000",
  });
  const rim = opts.rim ?? 0;
  const rimColor = new THREE.Color(opts.rimColor ?? "#bfe3ff");
  const variants = !!opts.variants;
  const wind = opts.wind ?? 0;
  const time = opts.time ?? { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uKitTime = time;
    let pars = "attribute float aGlow;\nvarying float vGlow;\nuniform float uKitTime;";
    let begin = "vGlow = aGlow;";
    if (variants) pars += "\nattribute float aVar;\nattribute float iVar;";
    if (wind > 0) {
      // sway grows with height; phase from the instance position so neighbours differ
      begin += `
#ifdef USE_INSTANCING
  vec2 kitIp = instanceMatrix[3].xz;
#else
  vec2 kitIp = vec2(0.0);
#endif
  float kitSw = sin(uKitTime * 1.9 + kitIp.x * 0.7 + kitIp.y * 0.43) + 0.4 * sin(uKitTime * 3.3 + kitIp.x * 1.3);
  transformed.x += kitSw * ${wind.toFixed(3)} * max(transformed.y, 0.0);
  transformed.z += kitSw * ${(wind * 0.5).toFixed(3)} * max(transformed.y, 0.0);`;
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + pars)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + begin);
    if (variants) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nif (abs(aVar - iVar) > 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);",
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vGlow;\nuniform float uRim;\nuniform vec3 uRimColor;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;",
      )
      .replace(
        "#include <opaque_fragment>",
        `{
  float fr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight += uRimColor * (fr * fr * fr) * uRim;
}
#include <opaque_fragment>`,
      );
  };
  const key = `kitToon:${variants ? 1 : 0}:${wind.toFixed(3)}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** inverted-hull outline material; thickness in model units, extruded along aOutN */
export function kitOutlineMaterial(color = "#15121c", thickness = 0.035): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aOutN;\nuniform float uOutline;")
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
#ifdef USE_SKINNING
  vec3 oN = (skinMatrix * vec4(aOutN, 0.0)).xyz;
#else
  vec3 oN = aOutN;
#endif
transformed += normalize(oN) * uOutline;`,
      );
  };
  mat.customProgramCacheKey = () => "kitOutline";
  return mat;
}
