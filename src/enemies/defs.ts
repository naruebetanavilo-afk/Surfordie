import { PART, PartBuilder, humanoid } from "./PartBuilder";
import type { EnemyDef } from "./types";

/**
 * Enemy roster. The order matters only for rendering; look enemies up by id.
 * Every def gets its own InstancedMesh, so keep the list reasonably short.
 */
export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: "shambler",
    name: "ซอมบี้เดินเอื่อย",
    hp: 10,
    speed: 1.9,
    damage: 6,
    radius: 0.42,
    mass: 1,
    xp: 1,
    scale: 1,
    walkRate: 0.8,
    hpBarY: 1.6,
    color: "#7bb35a",
    anim: { armRaise: 1.35, armAmp: 0.18, legAmp: 0.5 },
    build: () => {
      const b = new PartBuilder();
      humanoid(b, { skin: "#8cc06a", shirt: "#7a5a3a", pants: "#3d4a6b", shoe: "#2b2b2b" });
      // torn shirt detail + eyes
      b.box(0.3, 0.12, 0.02, "#5e4229", PART.BODY, { pos: [0.05, 0.6, 0.165] });
      b.sphere(0.055, "#ffffff", PART.HEAD, { pos: [-0.09, 1.21, 0.21], pivot: [0, 0.92, 0] }, 6);
      b.sphere(0.04, "#ffffff", PART.HEAD, { pos: [0.1, 1.2, 0.22], pivot: [0, 0.92, 0] }, 6);
      b.box(0.14, 0.03, 0.02, "#3a2a20", PART.HEAD, { pos: [0, 1.08, 0.25], pivot: [0, 0.92, 0] });
      return b.build();
    },
  },
];

export function enemyDefIndex(id: string): number {
  const i = ENEMY_DEFS.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`Unknown enemy id: ${id}`);
  return i;
}
