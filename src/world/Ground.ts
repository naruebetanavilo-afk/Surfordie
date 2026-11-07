import * as THREE from "three";

/** haze / background colour the far edge of the field fades into (sRGB hex) */
export const GROUND_FOG_COLOR = "#1d3a2a";

export interface GroundUniforms {
  uTime: { value: number };
  /** camera target on the ground (x, z) */
  uCenter: { value: THREE.Vector2 };
  /** visible half-width at the far edge, far extent (world units) */
  uView: { value: THREE.Vector2 };
  /** per-channel multiplier cancelling character-only lights on the ground */
  uLightComp?: { value: THREE.Vector3 };
  /** ground pattern: 0 = meadow grass, 1 = snow (see themes.ts) */
  uGround?: { value: number };
}

/** sRGB hex -> GLSL vec3 literal in linear space */
function lin(hex: string): string {
  const c = new THREE.Color(hex); // Color() converts sRGB hex to the linear working space
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/**
 * Infinite stylised ground. Pattern `uGround`:
 *  0 = grass field: a soft 45-degree checkerboard of saturated greens, clumpy
 *      value-noise variation, worn patches, soft tile-border AO
 *  1 = snow field: icy blue-white checker, wind-swept drift streaks, frozen
 *      ice patches with cracks and twinkling frost glints
 * plus a world-space "spotlight" falloff that keeps the area around the hero
 * bright while the edges (where enemies spawn) sink into a cool haze.
 * One program for every theme (a uniform branch), so switching stages never
 * compiles a shader. Everything is computed from world position so the plane
 * can follow the camera.
 */
export function createGround(uniforms: GroundUniforms): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(260, 260, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCenter = uniforms.uCenter;
    shader.uniforms.uView = uniforms.uView;
    shader.uniforms.uLightComp = uniforms.uLightComp ?? { value: new THREE.Vector3(1, 1, 1) };
    shader.uniforms.uGround = uniforms.uGround ?? { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vWPos;
uniform float uTime;
uniform vec2 uCenter;
uniform vec2 uView;
uniform vec3 uLightComp;
uniform float uGround;
float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(gHash(i), gHash(i+vec2(1,0)), u.x), mix(gHash(i+vec2(0,1)), gHash(i+vec2(1,1)), u.x), u.y);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
if (uGround < 0.5) {
  vec2 p = vWPos.xz;
  // soft diamond checker: product of two clamped sines (45 degree grid, tile ~3.1u)
  vec2 r = vec2(p.x + p.y, p.y - p.x) * 0.70710678;
  vec2 sn = sin(r * (3.14159265 / 3.1));
  vec2 sm = clamp(sn * 4.0, -1.0, 1.0);
  float ch = 0.5 + 0.5 * sm.x * sm.y;

  float nL = gNoise(p * 0.06 + 3.1);   // big hue drift
  float nM = gNoise(p * 0.5 + 7.7);    // clumps
  float nS = gNoise(p * 2.7);          // fine grain
  vec3 lightCol = mix(${lin("#70c24f")}, ${lin("#7fca4b")}, nL);
  vec3 darkCol  = mix(${lin("#489f3d")}, ${lin("#3e9846")}, nL);
  vec3 col = mix(darkCol, lightCol, ch);
  col *= 0.9 + nM * 0.16 + (nS - 0.5) * 0.1;

  // soft ambient occlusion along the tile borders
  float bd = min(abs(sn.x), abs(sn.y));
  col *= 0.93 + 0.07 * smoothstep(0.0, 0.45, bd);

  // worn earthy patches
  float worn = smoothstep(0.68, 0.84, gNoise(p * 0.045 + 17.0));
  col = mix(col, ${lin("#7f9a45")} * (0.9 + nS * 0.2), worn * 0.4);

  // spotlight falloff: bright around the hero, darker towards the edges
  vec2 q = (p - uCenter) / uView;
  q.y *= q.y > 0.0 ? 1.6 : 0.95;      // near side (+z) is shorter on screen
  float dist = length(q);
  col *= mix(1.0, 0.74, smoothstep(0.36, 1.08, dist));

  diffuseColor.rgb = col * uLightComp;
} else {
  vec2 p = vWPos.xz;
  // same diamond checker as the meadow, in packed-snow tones
  vec2 r = vec2(p.x + p.y, p.y - p.x) * 0.70710678;
  vec2 sn = sin(r * (3.14159265 / 3.1));
  vec2 sm = clamp(sn * 4.0, -1.0, 1.0);
  float ch = 0.5 + 0.5 * sm.x * sm.y;

  float nL = gNoise(p * 0.06 + 3.1);
  float nM = gNoise(p * 0.5 + 7.7);
  float nS = gNoise(p * 2.7);
  vec3 lightCol = mix(${lin("#e0e8f4")}, ${lin("#e6e9f5")}, nL);
  vec3 darkCol  = mix(${lin("#b2c4de")}, ${lin("#bac1de")}, nL);
  vec3 col = mix(darkCol, lightCol, ch);
  col *= 0.94 + nM * 0.09 + (nS - 0.5) * 0.05;

  // soft blue occlusion along the tile borders
  float bd = min(abs(sn.x), abs(sn.y));
  col *= mix(vec3(0.9, 0.93, 0.98), vec3(1.0), smoothstep(0.0, 0.45, bd));

  // wind-swept drift streaks (stretched noise, slightly brighter)
  float drift = gNoise(vec2(p.x * 0.22 + p.y * 0.08, p.y * 0.9 - p.x * 0.3) + 23.0);
  col *= 0.97 + smoothstep(0.55, 0.9, drift) * 0.07;

  // frozen ice patches: smooth blue sheets with a darker rim and cracks
  float iceN = gNoise(p * 0.075 + 41.0) + (nM - 0.5) * 0.12;
  float ice = smoothstep(0.63, 0.69, iceN);
  float iceRim = ice * (1.0 - smoothstep(0.69, 0.77, iceN));
  vec3 iceCol = mix(${lin("#97bfe4")}, ${lin("#b9d9f2")}, nS);
  float crack = 1.0 - smoothstep(0.0, 0.035, abs(gNoise(p * 1.3 + 5.0) - 0.5));
  iceCol *= 1.0 - crack * 0.22;
  col = mix(col, iceCol, ice * 0.8);
  col *= 1.0 - iceRim * 0.12;

  // frost glints: sparse sparkles that twinkle
  vec2 gq = p * 2.6;
  vec2 gc = floor(gq);
  float gh = gHash(gc);
  float gd = length(fract(gq) - 0.5 - (vec2(gHash(gc + 3.7), gHash(gc + 9.1)) - 0.5) * 0.6);
  float glint = step(0.94, gh) * (1.0 - smoothstep(0.02, 0.09, gd)) * max(0.0, sin(uTime * 2.3 + gh * 60.0));
  col += glint * 0.32;

  // spotlight falloff into a cold blue dusk
  vec2 q = (p - uCenter) / uView;
  q.y *= q.y > 0.0 ? 1.6 : 0.95;
  float dist = length(q);
  col *= mix(vec3(1.0), vec3(0.66, 0.72, 0.86), smoothstep(0.36, 1.08, dist));

  diffuseColor.rgb = col * uLightComp;
}`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
