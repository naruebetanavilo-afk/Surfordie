import * as THREE from "three";

/** haze / background colour the far edge of the field fades into (sRGB hex) */
export const GROUND_FOG_COLOR = "#1d3a2a";

export interface GroundUniforms {
  uTime: { value: number };
  /** camera target on the ground (x, z) */
  uCenter: { value: THREE.Vector2 };
  /** visible half-width at the far edge, far extent (world units) */
  uView: { value: THREE.Vector2 };
}

/** sRGB hex -> GLSL vec3 literal in linear space */
function lin(hex: string): string {
  const c = new THREE.Color(hex); // Color() converts sRGB hex to the linear working space
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/**
 * Infinite stylised grass field: a soft 45-degree checkerboard of saturated
 * greens, clumpy value-noise variation, worn patches, soft tile-border AO and
 * a world-space "spotlight" falloff that keeps the area around the hero bright
 * while the edges (where enemies spawn) sink into a cool haze.
 * Everything is computed from world position so the plane can follow the camera.
 */
export function createGround(uniforms: GroundUniforms): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(260, 260, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCenter = uniforms.uCenter;
    shader.uniforms.uView = uniforms.uView;
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
{
  vec2 p = vWPos.xz;
  // soft diamond checker: product of two clamped sines (45 degree grid, tile ~3.1u)
  vec2 r = vec2(p.x + p.y, p.y - p.x) * 0.70710678;
  vec2 sn = sin(r * (3.14159265 / 3.1));
  vec2 sm = clamp(sn * 4.0, -1.0, 1.0);
  float ch = 0.5 + 0.5 * sm.x * sm.y;

  float nL = gNoise(p * 0.06 + 3.1);   // big hue drift
  float nM = gNoise(p * 0.5 + 7.7);    // clumps
  float nS = gNoise(p * 2.7);          // fine grain
  vec3 lightCol = mix(${lin("#79c94e")}, ${lin("#8fcf4a")}, nL);
  vec3 darkCol  = mix(${lin("#4f9e3c")}, ${lin("#3f9446")}, nL);
  vec3 col = mix(darkCol, lightCol, ch);
  col *= 0.9 + nM * 0.16 + (nS - 0.5) * 0.1;

  // soft ambient occlusion along the tile borders
  float bd = min(abs(sn.x), abs(sn.y));
  col *= 0.93 + 0.07 * smoothstep(0.0, 0.45, bd);

  // worn earthy patches
  float worn = smoothstep(0.68, 0.84, gNoise(p * 0.045 + 17.0));
  col = mix(col, ${lin("#8a8a3e")} * (0.9 + nS * 0.2), worn * 0.45);

  // spotlight falloff: bright around the hero, darker towards the edges
  vec2 q = (p - uCenter) / uView;
  q.y *= q.y > 0.0 ? 1.6 : 0.95;      // near side (+z) is shorter on screen
  float dist = length(q);
  col *= mix(1.07, 0.66, smoothstep(0.3, 1.05, dist));

  diffuseColor.rgb = col;
}`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
