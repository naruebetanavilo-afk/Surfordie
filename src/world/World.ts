import * as THREE from "three";
import { G } from "../core/G";
import { damp } from "../core/math";
import { Decor } from "./Decor";
import { createGround, GROUND_FOG_COLOR } from "./Ground";
import { createVignette } from "./Vignette";

export type Quality = "low" | "medium" | "high";

/** visible half-width (world units) across the narrow axis in portrait */
const FRAME_HALF_W = 5.6;
/** visible half-height (camera plane units) in landscape / desktop */
const FRAME_HALF_V = 7.4;
/** tallest thing we expect to walk in from the bottom edge (bosses) */
const SPAWN_HEIGHT = 2.4;
/** fill light offset from the target: camera side (+Z), from the right, fairly low */
const FILL_DIR = new THREE.Vector3(6, 4.5, 10);

/**
 * Owns renderer, scene, camera, lights and the infinite ground.
 * Camera looks down at roughly 54 degrees; screen-up is world -Z.
 */
export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  ground: THREE.Mesh;
  decor: Decor;
  sun: THREE.DirectionalLight;
  /**
   * Weak cool fill from the camera's lower-right: lifts the sides/backs that
   * face away from the warm key (enemies walking up from the bottom of the
   * screen) so the horde reads well from every direction.
   */
  fill: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private vignette: THREE.Mesh;

  /** CSS pixel size of the viewport */
  width = 1;
  height = 1;
  dpr = 1;
  quality: Quality = "high";

  /** distance from camera to the follow target */
  camDist = 30;
  readonly camPitch = (54 * Math.PI) / 180;
  private readonly cosPitch = Math.cos(this.camPitch);
  camTarget = new THREE.Vector3();
  private shakeAmt = 0;
  private shakeT = 0;
  /** extra zoom factor (1 = default), e.g. boss fights zoom out a bit */
  zoom = 1;
  private zoomCur = 1;
  /** automatic subtle zoom-out when the screen is crowded (multiplies `zoom`) */
  private crowdZoom = 1;
  /** 1 on the main menu: closer "hero showcase" framing with the hero high on screen */
  private menuBlend = 0;
  /** ground offset (+Z) from the follow target to the point the camera looks at */
  private lookOffZ = 0;

  /** combined projection*view matrix, refreshed every frame (for fast 2D projection) */
  readonly viewProj = new THREE.Matrix4();
  /**
   * Conservative half extents of the visible ground area around the target
   * (world units). The visible ground is a trapezoid (wider at the top of the
   * screen); `viewHalfW` is its widest half-width, `viewHalfH` its far (-Z)
   * extent, and `viewHalfH * 0.75` always covers the near (+Z) extent
   * including tall enemies. A point outside this rectangle is never visible.
   */
  viewHalfW = 10;
  viewHalfH = 16;
  /** exact trapezoid parameters (see onScreen) */
  private tanH = 0.2;
  private farExt = 16;
  private nearExt = 10;

  readonly groundUniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
    uView: { value: new THREE.Vector2(6, 16) },
    uLightComp: { value: new THREE.Vector3(1, 1, 1) },
  };

  constructor(canvas: HTMLCanvasElement) {
    let saved: Quality | null = null;
    try {
      saved = (localStorage.getItem("sfd.quality") as Quality | null) ?? null;
    } catch {
      saved = null;
    }
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

    const bg = new THREE.Color(GROUND_FOG_COLOR);
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 40, 80);

    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 300);

    // cool sky fill + warm grass bounce, warm key light from the upper left
    this.hemi = new THREE.HemisphereLight("#cfe6ff", "#7a9a52", 1.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff0d2", 2.25);
    this.sun.position.set(-6, 14, 8);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight("#bcd0ff", 0.8);
    this.fill.position.set(FILL_DIR.x, FILL_DIR.y, FILL_DIR.z);
    this.scene.add(this.fill);
    this.scene.add(this.fill.target);

    this.ground = createGround(this.groundUniforms);
    this.compensateGroundFill();
    this.scene.add(this.ground);

    this.decor = new Decor(this.scene);

    this.vignette = createVignette();
    this.scene.add(this.vignette);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.visualViewport?.addEventListener("resize", () => this.resize());
  }

  /**
   * The ground is lit by the same lights as the characters; cancel the fill
   * light's contribution on the (flat, up-facing) ground so the grass keeps
   * its tuned colours while characters get the extra lift.
   */
  private compensateGroundFill(): void {
    const up = (l: THREE.DirectionalLight): number =>
      Math.max(0, l.position.clone().sub(l.target.position).normalize().y) * l.intensity;
    const base = new THREE.Color().copy(this.hemi.color).multiplyScalar(this.hemi.intensity);
    base.add(new THREE.Color().copy(this.sun.color).multiplyScalar(up(this.sun)));
    const withFill = base.clone().add(new THREE.Color().copy(this.fill.color).multiplyScalar(up(this.fill)));
    this.groundUniforms.uLightComp.value.set(base.r / withFill.r, base.g / withFill.g, base.b / withFill.b);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    try {
      localStorage.setItem("sfd.quality", q);
    } catch {
      /* storage blocked: keep in memory only */
    }
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

  /**
   * Choose a camera distance so that ~11 world units fit across a portrait
   * phone (characters read big), or ~15 units vertically in landscape, then
   * derive the exact visible ground trapezoid.
   */
  private fitCamera(): void {
    const fov = (this.camera.fov * Math.PI) / 180;
    const phi = fov / 2;
    const tanV = Math.tan(phi);
    const tanH = tanV * this.camera.aspect;
    const zoom = this.zoomCur * this.crowdZoom * (1 - 0.42 * this.menuBlend);
    const D = Math.max(FRAME_HALF_W / tanH, FRAME_HALF_V / tanV) * zoom;
    this.camDist = D;
    this.camera.near = Math.max(0.5, D * 0.3);
    this.camera.far = D * 4;
    this.camera.updateProjectionMatrix();

    const th = this.camPitch;
    const sin = Math.sin(th);
    const cos = Math.cos(th);
    // ground hit of the top / bottom screen rays (relative to the target, +Z = screen-down)
    const far = D * (sin / Math.tan(th - phi) - cos);
    const nearGround = th + phi < Math.PI / 2 - 1e-3 ? D * (cos - sin / Math.tan(th + phi)) : D * cos;
    // a point SPAWN_HEIGHT above the ground just below the bottom edge
    const nearTall =
      th + phi < Math.PI / 2 - 1e-3 ? D * cos - (D * sin - SPAWN_HEIGHT) / Math.tan(th + phi) : D * cos + 2;
    // half-width grows linearly with depth (= D - dz*cos), widest at the far edge
    const halfFar = (D + far * cos) * tanH;
    this.tanH = tanH;
    this.farExt = far;
    this.nearExt = nearGround;
    this.viewHalfW = halfFar * 1.02;
    this.viewHalfH = Math.max(far * 1.02, nearTall / 0.75);

    // menu showcase: look below the hero so it sits ~27% from the top of the screen
    const beta = Math.atan(0.46 * tanV);
    this.lookOffZ = this.menuBlend * D * (sin / Math.tan(th - beta) - cos);

    const fog = this.scene.fog as THREE.Fog;
    // view-space depth: target = D, far edge ~1.37 D -> the top strip fades into haze
    fog.near = D * 1.08;
    fog.far = D * 2.15;
    this.groundUniforms.uView.value.set(this.viewHalfW, far);
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, amount));
  }

  /** follow target (usually the player) */
  update(dt: number, tx: number, tz: number): void {
    const realDt = dt;
    this.groundUniforms.uTime.value = G.realTime;

    // crowded screen -> ease the camera back a little (max +9%)
    const alive = G.state === "playing" && G.enemies ? G.enemies.alive : 0;
    const crowdTarget = 1 + Math.min(0.09, Math.max(0, alive - 180) / 3600);
    const zc = this.zoomCur;
    const cc = this.crowdZoom;
    const mc = this.menuBlend;
    this.zoomCur += (this.zoom - this.zoomCur) * damp(2, realDt);
    this.crowdZoom += (crowdTarget - this.crowdZoom) * damp(0.6, realDt);
    const menuTarget = G.state === "menu" ? 1 : 0;
    this.menuBlend += (menuTarget - this.menuBlend) * damp(menuTarget ? 3 : 5, realDt);
    if (Math.abs(this.menuBlend - menuTarget) < 1e-3) this.menuBlend = menuTarget;
    if (
      Math.abs(zc - this.zoomCur) > 1e-4 ||
      Math.abs(cc - this.crowdZoom) > 1e-4 ||
      Math.abs(mc - this.menuBlend) > 1e-5
    )
      this.fitCamera();

    this.camTarget.x += (tx - this.camTarget.x) * damp(10, realDt);
    this.camTarget.z += (tz - this.camTarget.z) * damp(10, realDt);
    this.camTarget.y = 0;

    this.shakeT += realDt * 60;
    this.shakeAmt = Math.max(0, this.shakeAmt - realDt * 2.5);
    const s = this.shakeAmt * this.shakeAmt * 0.8;
    const sx = (Math.sin(this.shakeT * 1.7) + Math.sin(this.shakeT * 3.1) * 0.5) * s;
    const sz = (Math.cos(this.shakeT * 2.3) + Math.sin(this.shakeT * 4.7) * 0.5) * s;

    const cx = this.camTarget.x + sx;
    const cz = this.camTarget.z + sz + this.lookOffZ;
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
    this.groundUniforms.uCenter.value.set(this.camTarget.x, this.camTarget.z);
    this.sun.position.set(this.camTarget.x - 6, 14, this.camTarget.z + 8);
    this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    this.fill.position.set(this.camTarget.x + FILL_DIR.x, FILL_DIR.y, this.camTarget.z + FILL_DIR.z);
    this.fill.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    this.decor.update(this.camTarget.x, this.camTarget.z + this.lookOffZ, this.viewHalfW, this.viewHalfH);
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

  /**
   * Is ground point (x,z) inside the visible area (margin in world units,
   * negative = must be that far inside)? Exact perspective trapezoid test.
   */
  onScreen(x: number, z: number, margin = 0): boolean {
    const dz = z - this.camTarget.z - this.lookOffZ;
    if (dz < -this.farExt - margin || dz > this.nearExt + margin) return false;
    const halfW = (this.camDist - dz * this.cosPitch) * this.tanH;
    return Math.abs(x - this.camTarget.x) < halfW + margin;
  }
}
