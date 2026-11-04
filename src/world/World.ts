import * as THREE from "three";
import { G } from "../core/G";
import { damp } from "../core/math";
import { Decor } from "./Decor";

export type Quality = "low" | "medium" | "high";

/**
 * Owns renderer, scene, camera, lights and the infinite ground.
 * Camera looks down at roughly 55 degrees; screen-up is world -Z.
 */
export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  ground: THREE.Mesh;
  decor: Decor;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;

  /** CSS pixel size of the viewport */
  width = 1;
  height = 1;
  dpr = 1;
  quality: Quality = "high";

  /** distance from camera to the follow target */
  camDist = 30;
  readonly camPitch = (56 * Math.PI) / 180;
  camTarget = new THREE.Vector3();
  private shakeAmt = 0;
  private shakeT = 0;
  /** extra zoom factor (1 = default), e.g. boss fights zoom out a bit */
  zoom = 1;
  private zoomCur = 1;

  /** combined projection*view matrix, refreshed every frame (for fast 2D projection) */
  readonly viewProj = new THREE.Matrix4();
  /** half extents of the visible ground area around the target (world units) */
  viewHalfW = 10;
  viewHalfH = 16;

  readonly groundUniforms = { uTime: { value: 0 } };

  constructor(canvas: HTMLCanvasElement) {
    const saved = (localStorage.getItem("sfd.quality") as Quality | null) ?? null;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    this.quality = saved ?? (isMobile ? "medium" : "high");

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.quality !== "low",
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    const bg = new THREE.Color("#1f3324");
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 40, 80);

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 300);

    this.hemi = new THREE.HemisphereLight("#e8f4ff", "#40602c", 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff6e0", 1.9);
    this.sun.position.set(-6, 14, 8);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ground = this.createGround();
    this.scene.add(this.ground);

    this.decor = new Decor(this.scene);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.visualViewport?.addEventListener("resize", () => this.resize());
  }

  setQuality(q: Quality): void {
    this.quality = q;
    localStorage.setItem("sfd.quality", q);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    const cap = this.quality === "high" ? 2 : this.quality === "medium" ? 1.5 : 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.fitCamera();
    G.overlay?.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  /** choose a camera distance so that ~15 world units fit across the narrow axis */
  private fitCamera(): void {
    const fov = (this.camera.fov * Math.PI) / 180;
    const tanV = Math.tan(fov / 2);
    const tanH = tanV * this.camera.aspect;
    const halfW = 6.0;
    const halfH = 8.0;
    this.camDist = Math.max(halfW / tanH, halfH / tanV) * this.zoomCur;
    this.camera.near = Math.max(1, this.camDist * 0.3);
    this.camera.far = this.camDist * 4;
    this.camera.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.camDist * 1.05;
    fog.far = this.camDist * 2.1;
    this.viewHalfW = (this.camDist * tanH) * 1.05;
    // ground depth visible is stretched by the tilt
    this.viewHalfH = (this.camDist * tanV) / Math.sin(this.camPitch) * 1.15;
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, amount));
  }

  /** follow target (usually the player) */
  update(dt: number, tx: number, tz: number): void {
    const realDt = dt;
    this.groundUniforms.uTime.value = G.realTime;
    const zc = this.zoomCur;
    this.zoomCur += (this.zoom - this.zoomCur) * damp(2, realDt);
    if (Math.abs(zc - this.zoomCur) > 1e-4) this.fitCamera();

    this.camTarget.x += (tx - this.camTarget.x) * damp(10, realDt);
    this.camTarget.z += (tz - this.camTarget.z) * damp(10, realDt);
    this.camTarget.y = 0;

    this.shakeT += realDt * 60;
    this.shakeAmt = Math.max(0, this.shakeAmt - realDt * 2.5);
    const s = this.shakeAmt * this.shakeAmt * 0.8;
    const sx = (Math.sin(this.shakeT * 1.7) + Math.sin(this.shakeT * 3.1) * 0.5) * s;
    const sz = (Math.cos(this.shakeT * 2.3) + Math.sin(this.shakeT * 4.7) * 0.5) * s;

    const cx = this.camTarget.x + sx;
    const cz = this.camTarget.z + sz;
    this.camera.position.set(
      cx,
      Math.sin(this.camPitch) * this.camDist,
      cz + Math.cos(this.camPitch) * this.camDist,
    );
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);

    // keep the ground & sun centred on the camera target
    this.ground.position.set(Math.round(this.camTarget.x / 4) * 4, 0, Math.round(this.camTarget.z / 4) * 4);
    this.sun.position.set(this.camTarget.x - 6, 14, this.camTarget.z + 8);
    this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    this.decor.update(this.camTarget.x, this.camTarget.z, this.viewHalfW, this.viewHalfH);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    G.perf.drawCalls = this.renderer.info.render.calls;
  }

  /** project a world point to CSS-pixel screen coords. returns false if behind camera */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    const e = this.viewProj.elements;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0.0001) return false;
    const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    out.x = (nx * 0.5 + 0.5) * this.width;
    out.y = (0.5 - ny * 0.5) * this.height;
    return nx > -1.2 && nx < 1.2 && ny > -1.2 && ny < 1.2;
  }

  /** is world point (x,z) inside the visible area (with margin in world units)? */
  onScreen(x: number, z: number, margin = 0): boolean {
    const dx = Math.abs(x - this.camTarget.x);
    const dz = z - this.camTarget.z;
    return dx < this.viewHalfW + margin && dz > -this.viewHalfH - margin && dz < this.viewHalfH * 0.75 + margin;
  }

  private createGround(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(260, 260, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const uniforms = this.groundUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
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
  float tile = 3.2;
  vec2 c = floor(p / tile);
  float checker = mod(c.x + c.y, 2.0);
  vec3 g1 = vec3(0.36, 0.62, 0.25);
  vec3 g2 = vec3(0.31, 0.55, 0.22);
  vec3 col = mix(g1, g2, checker);
  float n = gNoise(p * 0.18) * 0.6 + gNoise(p * 0.7) * 0.4;
  col *= 0.86 + n * 0.22;
  // dirt patches
  float d = smoothstep(0.62, 0.75, gNoise(p * 0.05 + 13.0));
  col = mix(col, vec3(0.42, 0.36, 0.24), d * 0.55);
  // soft tile edge lines
  vec2 f = abs(fract(p / tile) - 0.5);
  float edge = smoothstep(0.47, 0.5, max(f.x, f.y));
  col *= 1.0 - edge * 0.06;
  diffuseColor.rgb = col;
}`,
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -10;
    return mesh;
  }
}
