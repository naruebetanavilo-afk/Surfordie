import * as THREE from "three";
import { G } from "../../core/G";
import { vfxClock } from "./clock";
import { Sparkles } from "./Sparkles";
import { Decals } from "./Decals";
import { Domes } from "./Domes";
import { Bolts } from "./Bolts";

export { vfxClock } from "./clock";
export { SPARK_GLOW, SPARK_STAR, SPARK_EMBER, SPARK_STEADY } from "./Sparkles";
export { DECAL_VORTEX, DECAL_GLOW, DECAL_SHOCK, DECAL_CRACK, DECAL_SCORCH, DECAL_TARGET } from "./Decals";

/**
 * Shared, lazily created GPU effect layers used by the weapons. Each layer is
 * a single draw call regardless of how many effects are alive.
 * WeaponSystem drives it: begin(dt) before weapons update, flush() after.
 */
class WeaponVfx {
  private _sparkles: Sparkles | null = null;
  private _decals: Decals | null = null;
  private _dark: Decals | null = null;
  private _domes: Domes | null = null;
  private _bolts: Bolts | null = null;
  private dt = 0;

  /** additive billboards: glows, star sparkles, embers */
  get sparkles(): Sparkles {
    if (!this._sparkles) {
      this._sparkles = new Sparkles(G.world.scene, 4096);
      this._sparkles.density = G.world.quality === "low" ? 0.5 : 1;
    }
    return this._sparkles;
  }
  /** additive ground decals: vortexes, shock rings, cracks, telegraphs */
  get decals(): Decals {
    if (!this._decals) this._decals = new Decals(G.world.scene, false, 320);
    return this._decals;
  }
  /** normal-blended dark ground decals: scorch marks, thorn shadows */
  get dark(): Decals {
    if (!this._dark) this._dark = new Decals(G.world.scene, true, 256);
    return this._dark;
  }
  /** translucent energy domes for big blasts */
  get domes(): Domes {
    if (!this._domes) this._domes = new Domes(G.world.scene, 64);
    return this._domes;
  }

  /** camera-facing lightning ribbons */
  get bolts(): Bolts {
    if (!this._bolts) this._bolts = new Bolts(G.world.scene, 128);
    return this._bolts;
  }

  begin(dt: number): void {
    vfxClock.t += dt;
    this.dt = dt;
  }

  flush(): void {
    this._sparkles?.update();
    this._decals?.update();
    this._dark?.update();
    this._domes?.update();
    this._bolts?.update(this.dt);
  }

  /** drop every live effect (new run / back to menu) */
  clear(): void {
    this._sparkles?.clear();
    this._decals?.clear();
    this._dark?.clear();
    this._domes?.clear();
    this._bolts?.clear();
  }
}

export const VFX = new WeaponVfx();

const colorCache = new Map<string, THREE.Color>();

/** cached linear colour for a hex string — shared instance, never mutate it */
export function col(hex: string): THREE.Color {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}
