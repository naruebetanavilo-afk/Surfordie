import * as THREE from "three";
import { kitToonMaterial } from "./ModelKit";
import { BIG_PROPS, SMALL_PROPS, buildGrassTuft, type PropDef } from "./DecorProps";
import { SNOW_BIG, SNOW_SMALL, buildSnowTuft } from "./DecorSnow";

/**
 * Procedural, infinitely tiling scenery: grass tufts, flowers, mushrooms,
 * bones, candles, crystals (small) and headstones, crosses, dead trees,
 * broken fences, lanterns, boulders, stumps (big), plus additive lights and
 * fireflies. Content is deterministic per world cell (so nothing changes when
 * you walk back) and grouped into themed zones (meadow / graveyard / grove).
 * Purely visual: no collision.
 *
 * Draw calls: grass + glows + one InstancedMesh per prop variant that is
 * currently in view (up to 7 small + 7 big). All variants of a layer share ONE
 * material (one shader program), and each instance only pushes its own
 * variant's triangles (a merged "all variants" mesh would shade every
 * variant's vertices for every instance).
 *
 * The scatter is rebuilt only when the camera crosses a cell boundary and
 * always covers the conservative view rectangle + margin, so props spawn
 * outside the screen and never pop in view.
 *
 * Decor sets (`setTheme`): "meadow" (above) and "snow" (frozen grass tufts,
 * snow lumps, frozen graves, snowy pines, ice crystals, drifts, cold
 * lanterns; zones = snowfield / frozen graveyard / frozen grove). A set's
 * meshes are built on first use and share the same three toon materials, so
 * switching never compiles a shader; the inactive set is hidden (count 0).
 */

const CELL = 4;
const MAX_GRASS = 1800;
const MAX_SMALL = 700;
const MAX_BIG = 260;
const MAX_GLOW = 420;
/** keep the spawn area around the world origin readable */
const CLEAR_R = 6.5;

type Zone = 0 | 1 | 2; // meadow, graveyard, grove

/** per-zone pick weights, indexed like SMALL_PROPS / BIG_PROPS */
const SMALL_W: Record<Zone, number[]> = {
  //      flowers mush bones pebbles clover candles crystals
  0: [5, 1, 0.3, 2, 4, 0, 0.3],
  1: [1, 0.8, 3, 1.5, 1.5, 2.5, 0.4],
  2: [0.6, 4, 1, 1.5, 2, 0.3, 1.6],
};
const BIG_W: Record<Zone, number[]> = {
  //      stone cross tree fence lantern boulder stump
  0: [0.2, 0.2, 0.6, 1.2, 0.5, 2.5, 1.5],
  1: [5, 3.5, 0.8, 1.5, 1.4, 0.6, 0.3],
  2: [0.5, 0.4, 4, 0.8, 0.7, 1.2, 2.5],
};
const BIG_P: Record<Zone, number> = { 0: 0.07, 1: 0.24, 2: 0.17 };
const SMALL_P: Record<Zone, number> = { 0: 0.5, 1: 0.55, 2: 0.6 };

const GRASS_TINTS = ["#ffffff", "#e6f5c8", "#cfe8a8", "#f2ffd8", "#b9dc9a"].map((c) => new THREE.Color(c));

/** everything that differs between decor themes (meadow values are the originals) */
interface DecorSetDef {
  tuft: () => THREE.BufferGeometry;
  tuftTints: THREE.Color[];
  /** tufts per cell: 1 + floor(rand * (zone 0 ? [0] : [1])) */
  tufts: [number, number];
  small: PropDef[];
  big: PropDef[];
  smallW: Record<Zone, number[]>;
  bigW: Record<Zone, number[]>;
  smallP: Record<Zone, number>;
  bigP: Record<Zone, number>;
  /** chance of a second small prop in zones 1/2 */
  small2P: number;
  /** drifting motes (fireflies / frost sprites): chance per cell, colour in zone 1 / zone 2 */
  moteP: number;
  moteColors: [string, string];
}

const DECOR_SETS: Record<string, DecorSetDef> = {
  meadow: {
    tuft: buildGrassTuft,
    tuftTints: GRASS_TINTS,
    tufts: [5, 4],
    small: SMALL_PROPS,
    big: BIG_PROPS,
    smallW: SMALL_W,
    bigW: BIG_W,
    smallP: SMALL_P,
    bigP: BIG_P,
    small2P: 0.22,
    moteP: 0.16,
    moteColors: ["#b6ff7a", "#7affe8"],
  },
  snow: {
    tuft: buildSnowTuft,
    tuftTints: ["#ffffff", "#e8f0ff", "#dde8f6", "#f4f6ff", "#d4e2f0"].map((c) => new THREE.Color(c)),
    tufts: [4, 3],
    small: SNOW_SMALL,
    big: SNOW_BIG,
    smallW: {
      //      lumps pebbles bones flowers candles shards icicles
      0: [4, 2.2, 0.4, 1.2, 0, 0.8, 1.6],
      1: [1.5, 1.4, 3, 0.8, 2.5, 0.5, 0.8],
      2: [1.2, 1.2, 0.8, 2, 0.3, 2.4, 1.8],
    },
    bigW: {
      //      grave cross pine deadPine fence lantern crystal drift
      0: [0.3, 0.3, 1.5, 1.1, 1.0, 0.4, 0.7, 1.4],
      1: [5, 3.2, 0.4, 0.9, 1.5, 1.4, 0.3, 0.7],
      2: [0.4, 0.3, 3.6, 2.0, 0.5, 0.6, 1.6, 1.0],
    },
    smallP: { 0: 0.5, 1: 0.6, 2: 0.6 },
    bigP: { 0: 0.13, 1: 0.26, 2: 0.22 },
    small2P: 0.22,
    moteP: 0.12,
    moteColors: ["#9fe6ff", "#c8f4ff"],
  },
};

interface Layer {
  mesh: THREE.InstancedMesh;
  n: number;
  cap: number;
}

/** the built meshes of one decor set */
interface DecorSet {
  def: DecorSetDef;
  grass: Layer;
  small: PropLayer;
  big: PropLayer;
}

/** a prop layer: one InstancedMesh per variant, all sharing one material */
interface PropLayer {
  meshes: THREE.InstancedMesh[];
  /** instances placed per variant this rebuild */
  counts: number[];
  props: PropDef[];
  tints: THREE.Color[][];
  material: THREE.Material;
  big: boolean;
  /** total instances placed this rebuild (all variants) */
  n: number;
  /** total cap across variants (kept from the merged-mesh days) */
  cap: number;
}

function imul(a: number, b: number): number {
  return Math.imul(a, b);
}

export class Decor {
  /** shared animation clock for wind sway & glow flicker */
  readonly time = { value: 0 };
  private grass: Layer;
  private small: PropLayer;
  private big: PropLayer;
  /** active decor set + every set built so far (lazily) */
  private set: DecorSet;
  private sets = new Map<string, DecorSet>();
  private readonly grassMat: THREE.Material;
  private readonly smallMat: THREE.Material;
  private readonly bigMat: THREE.Material;
  private glow: THREE.InstancedMesh;
  private glowMode: THREE.InstancedBufferAttribute;
  private glowN = 0;
  private lastCx = 1e9;
  private lastCz = 1e9;
  private coveredW = 0;
  private coveredH = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private c = new THREE.Color();
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // one toon material per layer, shared by every decor set (one program each)
    this.grassMat = kitToonMaterial({ wind: 0.16, time: this.time });
    this.smallMat = kitToonMaterial({ wind: 0.05, time: this.time });
    this.bigMat = kitToonMaterial({ wind: 0.012, time: this.time });
    this.set = this.buildSet("meadow");
    this.grass = this.set.grass;
    this.small = this.set.small;
    this.big = this.set.big;

    // additive glows (lantern halos, light pools, candle flames, fireflies)
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    this.glowMode = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOW), 1);
    this.glowMode.setUsage(THREE.DynamicDrawUsage);
    glowGeo.setAttribute("iMode", this.glowMode);
    this.glow = new THREE.InstancedMesh(glowGeo, this.glowMaterial(), MAX_GLOW);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.setColorAt(0, this.c.set("#ffffff"));
    this.glow.frustumCulled = false;
    this.glow.count = 0;
    this.glow.renderOrder = 5;
    scene.add(this.glow);
  }

  private initMesh(mesh: THREE.InstancedMesh): THREE.InstancedMesh {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, this.c.set("#ffffff"));
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  private initLayer(mesh: THREE.InstancedMesh, cap: number): Layer {
    return { mesh: this.initMesh(mesh), n: 0, cap };
  }

  /** build the meshes of a decor set (hidden until the next rebuild fills them) */
  private buildSet(id: string): DecorSet {
    const def = DECOR_SETS[id] ?? DECOR_SETS.meadow;
    // grass: single geometry, wind sway, tinted per instance
    const grass = this.initLayer(new THREE.InstancedMesh(def.tuft(), this.grassMat, MAX_GRASS), MAX_GRASS);
    const set: DecorSet = {
      def,
      grass,
      small: this.makePropLayer(def.small, MAX_SMALL, this.smallMat, false),
      big: this.makePropLayer(def.big, MAX_BIG, this.bigMat, true),
    };
    this.sets.set(id, set);
    return set;
  }

  /**
   * Switch the decor set ("meadow" | "snow"). Builds it on first use, hides
   * the previous set and forces a full rebuild of the scatter.
   */
  setTheme(id: string): void {
    const key = DECOR_SETS[id] ? id : "meadow";
    const next = this.sets.get(key) ?? this.buildSet(key);
    if (next === this.set) return;
    for (const mesh of [this.grass.mesh, ...this.small.meshes, ...this.big.meshes]) {
      mesh.count = 0;
      mesh.visible = false;
    }
    this.set = next;
    this.grass = next.grass;
    this.small = next.small;
    this.big = next.big;
    this.lastCx = this.lastCz = 1e9;
  }

  private makePropLayer(props: PropDef[], cap: number, material: THREE.Material, big: boolean): PropLayer {
    // every variant can take the whole layer budget (zones can be dominated by one prop)
    const meshes = props.map((p) => this.initMesh(new THREE.InstancedMesh(p.build(), material, cap)));
    return {
      meshes,
      counts: props.map(() => 0),
      props,
      tints: props.map((p) => (p.tints ?? ["#ffffff"]).map((t) => new THREE.Color(t))),
      material,
      big,
      n: 0,
      cap,
    };
  }

  /** upload only the instances written this rebuild */
  private commit(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    const im = mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, count * 16);
    im.needsUpdate = true;
    const ic = mesh.instanceColor;
    if (ic) {
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, count * 3);
      ic.needsUpdate = true;
    }
  }

  private glowMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: this.time },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute float iMode;
        varying vec3 vCol;
        varying vec2 vUv;
        varying float vA;
        void main() {
          vec3 c = instanceMatrix[3].xyz;
          float s = length(instanceMatrix[0].xyz);
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0);
          #endif
          vUv = position.xy * 2.0;
          vA = 0.82 + 0.18 * sin(uTime * 7.0 + c.x * 3.1 + c.z * 1.7) * sin(uTime * 3.3 + c.z);
          vec4 mv;
          if (iMode > 0.5 && iMode < 1.5) {
            // flat pool of light on the ground
            mv = viewMatrix * vec4(c + vec3(position.x, 0.0, -position.y) * s, 1.0);
            vA *= 0.42;
          } else {
            if (iMode > 1.5) {
              // firefly: slow wander + blink
              float ph = c.x * 1.7 + c.z * 2.3;
              c += vec3(sin(uTime * 0.8 + ph) * 0.45, sin(uTime * 1.6 + ph * 1.3) * 0.22, cos(uTime * 0.6 + ph) * 0.45);
              vA = 0.25 + 0.75 * max(0.0, sin(uTime * 2.2 + ph * 3.0));
            }
            mv = viewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * s;
          }
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        varying vec2 vUv;
        varying float vA;
        void main() {
          float d = dot(vUv, vUv);
          if (d > 1.0) discard;
          float a = exp(-d * 4.0) * (1.0 - d);
          vec3 col = vCol + vec3(1.0, 0.95, 0.8) * exp(-d * 30.0) * 0.8;
          gl_FragColor = vec4(col, a * vA);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  private hash(x: number, z: number, k: number): number {
    let h = imul(x | 0, 374761393) ^ imul(z | 0, 668265263) ^ imul(k | 0, 1274126177);
    h = imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /** smooth value noise over cell coordinates -> themed zones */
  private zone(gx: number, gz: number): Zone {
    const f = 1 / 5;
    const x = gx * f;
    const z = gz * f;
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = this.hash(ix, iz, 901);
    const b = this.hash(ix + 1, iz, 901);
    const c = this.hash(ix, iz + 1, 901);
    const d = this.hash(ix + 1, iz + 1, 901);
    const n = a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
    return n < 0.4 ? 0 : n < 0.68 ? 1 : 2;
  }

  private pick(weights: number[], r: number): number {
    let sum = 0;
    for (const w of weights) sum += w;
    let t = r * sum;
    for (let i = 0; i < weights.length; i++) {
      t -= weights[i];
      if (t <= 0) return i;
    }
    return weights.length - 1;
  }

  private pushGlow(x: number, y: number, z: number, size: number, color: string, mode: number): void {
    if (this.glowN >= MAX_GLOW) return;
    this.p.set(x, y, z);
    this.q.identity();
    this.s.setScalar(size);
    this.m.compose(this.p, this.q, this.s);
    this.glow.setMatrixAt(this.glowN, this.m);
    this.glow.setColorAt(this.glowN, this.c.set(color));
    this.glowMode.setX(this.glowN, mode);
    this.glowN++;
  }

  private placeProp(layer: PropLayer, v: number, x: number, z: number, gx: number, gz: number, salt: number): void {
    if (layer.n >= layer.cap) return;
    const def = layer.props[v];
    const mesh = layer.meshes[v];
    const sc = (def.scale[0] + (def.scale[1] - def.scale[0]) * this.hash(gx, gz, salt + 1)) * (layer.big ? 1.3 : 1.45);
    const tilt = def.tilt ?? 0;
    // face mostly towards the camera (+Z) so props read well, with some variety
    const yaw = (this.hash(gx, gz, salt + 2) - 0.5) * (layer.big ? 1.6 : Math.PI * 2);
    this.e.set((this.hash(gx, gz, salt + 3) - 0.5) * tilt * 2, yaw, (this.hash(gx, gz, salt + 4) - 0.5) * tilt * 2);
    this.q.setFromEuler(this.e);
    this.p.set(x, 0, z);
    this.s.setScalar(sc);
    this.m.compose(this.p, this.q, this.s);
    layer.n++;
    const i = layer.counts[v]++;
    mesh.setMatrixAt(i, this.m);
    const tints = layer.tints[v];
    mesh.setColorAt(i, tints[Math.floor(this.hash(gx, gz, salt + 5) * tints.length) % tints.length]);
    if (def.glows) {
      for (const g of def.glows) {
        this.v.set(g.x, g.y, g.z).applyMatrix4(this.m);
        this.pushGlow(this.v.x, g.mode === 1 ? 0.04 : this.v.y, this.v.z, g.size * sc, g.color, g.mode);
      }
    }
  }

  update(cx: number, cz: number, halfW: number, halfH: number): void {
    this.time.value = performance.now() / 1000;
    const ccx = Math.floor(cx / CELL);
    const ccz = Math.floor(cz / CELL);
    const grew = halfW > this.coveredW || halfH > this.coveredH;
    if (ccx === this.lastCx && ccz === this.lastCz && !grew) return;
    this.lastCx = ccx;
    this.lastCz = ccz;
    // cover a bit more than needed so small zoom changes don't force rebuilds
    this.coveredW = halfW * 1.08;
    this.coveredH = halfH * 1.08;
    const rx = Math.ceil((this.coveredW + 3) / CELL) + 1;
    const rz = Math.ceil((this.coveredH + 3) / CELL) + 1;

    const grass = this.grass;
    grass.n = 0;
    for (const layer of [this.small, this.big]) {
      layer.n = 0;
      layer.counts.fill(0);
    }
    this.glowN = 0;

    const sd = this.set.def;
    for (let gz = ccz - rz; gz <= ccz + rz; gz++) {
      for (let gx = ccx - rx; gx <= ccx + rx; gx++) {
        const zone = this.zone(gx, gz);
        const ox = gx * CELL;
        const oz = gz * CELL;
        const nearOrigin = Math.hypot(ox + CELL / 2, oz + CELL / 2) < CLEAR_R;

        // grass tufts (sometimes in small clumps)
        const tufts = 1 + Math.floor(this.hash(gx, gz, 1) * (zone === 0 ? sd.tufts[0] : sd.tufts[1]));
        for (let k = 0; k < tufts && grass.n < grass.cap; k++) {
          const x = ox + this.hash(gx, gz, 10 + k) * CELL;
          const z = oz + this.hash(gx, gz, 20 + k) * CELL;
          const sc = 0.9 + this.hash(gx, gz, 30 + k) * 0.8;
          this.p.set(x, 0, z);
          this.e.set(0, this.hash(gx, gz, 40 + k) * 6.28, 0);
          this.q.setFromEuler(this.e);
          this.s.set(sc, sc * (0.8 + this.hash(gx, gz, 45 + k) * 0.5), sc);
          this.m.compose(this.p, this.q, this.s);
          grass.mesh.setMatrixAt(grass.n, this.m);
          grass.mesh.setColorAt(grass.n, sd.tuftTints[Math.floor(this.hash(gx, gz, 50 + k) * sd.tuftTints.length)]);
          grass.n++;
        }

        // small prop
        if (this.hash(gx, gz, 2) < sd.smallP[zone] * (nearOrigin ? 0.4 : 1)) {
          const v = this.pick(sd.smallW[zone], this.hash(gx, gz, 3));
          const x = ox + (0.1 + this.hash(gx, gz, 4) * 0.8) * CELL;
          const z = oz + (0.1 + this.hash(gx, gz, 5) * 0.8) * CELL;
          this.placeProp(this.small, v, x, z, gx, gz, 100);
        }
        // occasional second small prop in lush zones
        if (zone !== 0 && this.hash(gx, gz, 6) < sd.small2P) {
          const v = this.pick(sd.smallW[zone], this.hash(gx, gz, 7));
          const x = ox + (0.1 + this.hash(gx, gz, 8) * 0.8) * CELL;
          const z = oz + (0.1 + this.hash(gx, gz, 9) * 0.8) * CELL;
          this.placeProp(this.small, v, x, z, gx, gz, 200);
        }

        // big prop (one per cell max, kept inside the cell so they never overlap)
        if (!nearOrigin && this.hash(gx, gz, 60) < sd.bigP[zone]) {
          const v = this.pick(sd.bigW[zone], this.hash(gx, gz, 61));
          const x = ox + (0.2 + this.hash(gx, gz, 62) * 0.6) * CELL;
          const z = oz + (0.2 + this.hash(gx, gz, 63) * 0.6) * CELL;
          this.placeProp(this.big, v, x, z, gx, gz, 300);
        }

        // fireflies in spooky zones
        if (zone !== 0 && this.hash(gx, gz, 70) < sd.moteP) {
          const x = ox + this.hash(gx, gz, 71) * CELL;
          const z = oz + this.hash(gx, gz, 72) * CELL;
          const col = zone === 1 ? sd.moteColors[0] : sd.moteColors[1];
          this.pushGlow(x, 0.7 + this.hash(gx, gz, 73) * 0.7, z, 0.32, col, 2);
        }
      }
    }

    this.commit(grass.mesh, grass.n);
    for (const layer of [this.small, this.big]) {
      for (let v = 0; v < layer.meshes.length; v++) this.commit(layer.meshes[v], layer.counts[v]);
    }
    const glowN = this.glowN;
    this.commit(this.glow, glowN);
    if (glowN > 0) {
      this.glowMode.clearUpdateRanges();
      this.glowMode.addUpdateRange(0, glowN);
      this.glowMode.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const set of this.sets.values()) {
      this.scene.remove(set.grass.mesh);
      set.grass.mesh.geometry.dispose();
      set.grass.mesh.dispose();
      for (const layer of [set.small, set.big]) {
        for (const mesh of layer.meshes) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.dispose();
        }
      }
    }
    this.sets.clear();
    this.grassMat.dispose();
    this.smallMat.dispose();
    this.bigMat.dispose();
    this.scene.remove(this.glow);
    this.glow.geometry.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.glow.dispose();
  }
}
