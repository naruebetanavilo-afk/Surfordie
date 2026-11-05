import * as THREE from "three";

/**
 * Screen-space vignette: one full-screen quad drawn last (after FX) that
 * darkens the corners with a cool deep-green tint. Frames the action, makes
 * the bright centre pop and helps hide enemies walking in from the edges.
 * Cheap: a single tiny fragment shader, no render targets.
 */
export function createVignette(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color("#04120c") },
      uStrength: { value: 0.56 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vQ;
      void main() {
        vQ = position.xy;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vQ;
      void main() {
        float d = length(vQ * vec2(1.0, 0.92));
        float a = smoothstep(0.62, 1.5, d) * uStrength;
        // a touch more haze along the top edge, where most spawns walk in
        a += smoothstep(0.55, 1.0, vQ.y) * 0.14;
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.85));
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  mesh.name = "vignette";
  return mesh;
}
