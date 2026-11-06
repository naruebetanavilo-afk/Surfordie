import { G } from "./G";
import { WEAPONS } from "../weapons/registry";
import { VFX } from "../weapons/vfx";
import type { Weapon } from "../weapons/types";
import { ensureHostileKinds } from "../enemies/hostile";
import { Marks } from "../enemies/marks";

/**
 * Boot-time shader prewarm.
 *
 * Without it every weapon, weapon effect layer, pickup type, hostile
 * projectile and ground mark compiles its shader program the first time it is
 * drawn — i.e. in the middle of a run, right after the level-up card that
 * granted it closes (a visible freeze on phones).
 *
 * Here we create everything a run can draw up front — one throw-away instance
 * of every weapon with all its lazily created meshes / projectile kinds /
 * sprite batches (base and evolved look: the evolved forms only change
 * uniforms or use kinds registered together with the base ones), every weapon
 * VFX layer, the hostile projectile kinds and the ground-mark pool — and hand
 * the whole scene to `renderer.compile`. Hidden objects are included (pickup
 * meshes stay invisible until the first drop), and three dedupes by material.
 *
 * `compile` only queues compile/link work: with KHR_parallel_shader_compile
 * (and Chrome's GPU process in general) the driver finishes it in the
 * background while the menu is shown. The throw-away weapons are removed
 * right away; their materials are module-level singletons that are never
 * disposed, so the programs stay cached for every run of the session.
 *
 * Returns the number of programs the renderer knows after the prewarm.
 */
export function prewarmShaders(): number {
  const w = G.world;
  const temp: Weapon[] = [];
  for (const def of WEAPONS) {
    const inst = def.create();
    inst.prepare();
    temp.push(inst);
  }
  VFX.prepare();
  ensureHostileKinds();
  Marks.prepare();
  try {
    w.renderer.compile(w.scene, w.camera);
  } catch (e) {
    // never block the game on a prewarm problem: shaders then compile on first use
    console.warn("shader prewarm failed", e);
  }
  for (const inst of temp) inst.dispose();
  return w.renderer.info.programs?.length ?? 0;
}
