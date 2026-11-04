import * as THREE from "three";

/** shared time uniform for every animated character material */
export const animTime = { value: 0 };

let gradient: THREE.DataTexture | null = null;
/** 3-band toon ramp shared by characters */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export interface AnimParams {
  /** arm swing amplitude (radians) */
  armAmp?: number;
  /** leg swing amplitude (radians) */
  legAmp?: number;
  /** vertical bob (world units) */
  bob?: number;
  /** raise arms forward (radians). 1.35 = classic zombie pose, 0 = hanging */
  armRaise?: number;
  /** body side-sway amplitude (radians) */
  sway?: number;
}

/**
 * Toon material for merged PartBuilder geometry rendered through an
 * InstancedMesh. Per-instance attribute `aAnim` (vec4):
 *   x = animation phase offset
 *   y = hit flash 0..1 (mixes towards white)
 *   z = death progress 0..1 (falls backwards & sinks)
 *   w = walk rate multiplier (0 = idle)
 * Optional `instanceColor` multiplies vertex colours (elite / frozen tints).
 */
export function createAnimatedMaterial(p: AnimParams = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  const uniforms = {
    uTime: animTime,
    uArmAmp: { value: p.armAmp ?? 0.25 },
    uLegAmp: { value: p.legAmp ?? 0.55 },
    uBob: { value: p.bob ?? 0.05 },
    uArmRaise: { value: p.armRaise ?? 1.35 },
    uSway: { value: p.sway ?? 0.08 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uTime;
uniform float uArmAmp;
uniform float uLegAmp;
uniform float uBob;
uniform float uArmRaise;
uniform float uSway;
attribute float aPart;
attribute vec3 aPivot;
attribute vec4 aAnim;
varying float vFlash;
mat3 sfdRotX(float a){ float c = cos(a); float s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 sfdRotZ(float a){ float c = cos(a); float s = sin(a); return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0); }`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `float sfdT = uTime * 6.0 * max(aAnim.w, 0.0001) + aAnim.x;
float sfdSw = sin(sfdT) * step(0.001, aAnim.w);
float sfdDie = aAnim.z;
mat3 sfdPart = mat3(1.0);
if (aPart > 0.5 && aPart < 1.5) sfdPart = sfdRotX(-uArmRaise + sfdSw * uArmAmp);
else if (aPart > 1.5 && aPart < 2.5) sfdPart = sfdRotX(-uArmRaise - sfdSw * uArmAmp);
else if (aPart > 2.5 && aPart < 3.5) sfdPart = sfdRotX(sfdSw * uLegAmp);
else if (aPart > 3.5 && aPart < 4.5) sfdPart = sfdRotX(-sfdSw * uLegAmp);
else if (aPart > 4.5 && aPart < 5.5) sfdPart = sfdRotZ(sin(sfdT * 0.5 + 1.3) * 0.15);
mat3 sfdBody = sfdRotZ(sin(sfdT * 0.5) * uSway);
mat3 sfdDieR = sfdRotX(-sfdDie * 1.5);
vec3 objectNormal = sfdDieR * sfdBody * sfdPart * vec3( normal );
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = sfdPart * (position - aPivot) + aPivot;
transformed.y += abs(sfdSw) * uBob;
transformed = sfdBody * transformed;
transformed = sfdDieR * transformed;
transformed.y -= sfdDie * 0.35;
vFlash = aAnim.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFlash;")
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.97, 0.92), clamp(vFlash, 0.0, 1.0));",
      );
  };
  return mat;
}
