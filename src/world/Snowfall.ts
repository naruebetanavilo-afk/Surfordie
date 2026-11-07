import * as THREE from "three";

/**
 * Light snowfall: ONE THREE.Points draw call. Flakes live in a box that
 * wraps around the camera target (positions are folded with mod() in the
 * vertex shader), so the field is infinite and never needs CPU updates
 * beyond a few uniforms per frame. Fall / wind offsets are integrated on the
 * CPU so changing the wind (blizzard) never makes flakes jump.
 *
 * `density` (0..1) shows a fraction of the flakes: calm snow uses ~40 %, a
 * blizzard all of them, blown sideways.
 */

const FLAKES = { low: 380, medium: 700, high: 950 } as const;

const vert = /* glsl */ `
attribute vec2 aRand;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec2 uWind;
uniform float uFall;
uniform float uTime;
uniform float uScale;
uniform float uSize;
uniform float uDensity;
varying float vA;
void main() {
  if (aRand.y > uDensity) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vA = 0.0;
    return;
  }
  float sp = 0.7 + aRand.x * 0.6;
  vec3 p = position * uBox;
  p.y = mod(p.y - uFall * sp, uBox.y);
  float ph = aRand.y * 37.0 + aRand.x * 11.0;
  vec2 sway = vec2(sin(uTime * 0.9 + ph), cos(uTime * 0.7 + ph * 1.3)) * 0.35;
  p.x = uCenter.x + mod(p.x + uWind.x * sp + sway.x - uCenter.x, uBox.x) - uBox.x * 0.5;
  p.z = uCenter.z + mod(p.z + uWind.y * sp + sway.y - uCenter.z, uBox.z) - uBox.z * 0.5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (0.65 + aRand.x * 0.7) * uScale / max(1.0, -mv.z), 1.5, 22.0);
  // fade in at the top of the box and just above the ground (no popping)
  vA = smoothstep(0.0, 0.6, p.y) * (1.0 - smoothstep(uBox.y * 0.75, uBox.y, p.y));
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uAlpha;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  // bright core + a faint cool rim so flakes still read over the white ground
  float core = 1.0 - smoothstep(0.25, 0.55, d);
  float a = max(core, (1.0 - d) * 0.55);
  vec3 col = mix(uRim, uColor, core);
  gl_FragColor = vec4(col, a * vA * uAlpha);
  #include <colorspace_fragment>
}`;

export class Snowfall {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private fall = 0;
  private windX = 0;
  private windZ = 0;
  /** current wrap box size (x / z), see update() */
  private boxX = 0;
  private boxZ = 0;

  constructor(quality: "low" | "medium" | "high") {
    const n = FLAKES[quality];
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      // cosmetic: Math.random is fine (no gameplay effect)
      // unit cube, scaled by the wrap box in the shader: uniform density for any box size
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      rnd[i * 2] = Math.random();
      rnd[i * 2 + 1] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rnd, 2));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(24, 10, 36) },
        uWind: { value: new THREE.Vector2() },
        uFall: { value: 0 },
        uTime: { value: 0 },
        uScale: { value: 600 },
        uSize: { value: 0.2 },
        uDensity: { value: 0.4 },
        uColor: { value: new THREE.Color("#ffffff") },
        uRim: { value: new THREE.Color("#7d93b8") },
        uAlpha: { value: 0.9 },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
  }

  /** pixels per world unit at view depth 1 (call on resize) */
  setScale(pxPerUnit: number): void {
    this.mat.uniforms.uScale.value = pxPerUnit;
  }

  /**
   * advance one frame. `storm` 0..1 (blizzard), wind unit vector (x, z),
   * centre/box = the wrapped volume around the visible area.
   */
  update(dt: number, time: number, storm: number, windX: number, windZ: number, cx: number, cz: number, halfW: number, halfH: number): void {
    const u = this.mat.uniforms;
    const fallSpeed = 1.1 + storm * 1.6;
    const windSpeed = 0.35 + storm * 7.5;
    this.fall += fallSpeed * dt;
    this.windX += windX * windSpeed * dt;
    this.windZ += windZ * windSpeed * dt;
    // keep the integrators small so float precision never degrades
    if (this.fall > 1e4) this.fall -= 1e4;
    if (Math.abs(this.windX) > 1e4) this.windX = 0;
    if (Math.abs(this.windZ) > 1e4) this.windZ = 0;
    u.uFall.value = this.fall;
    u.uWind.value.set(this.windX, this.windZ);
    u.uTime.value = time;
    // (the wrap box has 30 % headroom per axis, so more of the flakes are shown)
    u.uDensity.value = 0.6 + storm * 0.4;
    u.uSize.value = 0.2 + storm * 0.04;
    u.uAlpha.value = 0.85 + storm * 0.1;
    // the far (-z) side of the view is larger: shift the box up-screen
    u.uCenter.value.set(cx, 0, cz - halfH * 0.12);
    // the wrap box must stay put while the camera zooms (boss zoom, crowd zoom,
    // menu blend): a changing box would shift every flake by a different amount.
    // It only grows (with headroom) or shrinks after a big resize; flakes are
    // stored in a unit cube, so a resize re-lays them out evenly.
    const needX = halfW * 2 + 6;
    const needZ = halfH * 1.9 + 6;
    if (needX > this.boxX || needZ > this.boxZ || needX < this.boxX * 0.55) {
      // 30 % headroom covers the largest in-run zoom (boss 1.12 x crowd 1.09)
      this.boxX = needX * 1.3;
      this.boxZ = needZ * 1.3;
      u.uBox.value.set(this.boxX, 9, this.boxZ);
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
