import type { IconDraw } from "../../ui/icons";

/** hero body animation played while the ultimate runs (Player.animate) */
export type UltPose = "slam" | "channel" | "spin";

/** numbers an ultimate reads once, when it is cast */
export interface UltCast {
  /** damage multiplier: tracks enemy HP growth over the run (might is applied by hitEnemy) */
  power: number;
  /** radius multiplier from the hero's area stat (softened) */
  area: number;
  /** extra projectiles / impacts from the amount stat */
  amount: number;
  /** effect duration multiplier (softened) */
  duration: number;
}

/**
 * A running ultimate effect. One instance per hero ultimate, created lazily
 * and reused every cast (no per-cast allocations of GPU objects).
 */
export interface UltEffect {
  /** create every mesh / projectile kind / sprite batch up front (boot shader prewarm) */
  prepare(): void;
  /** begin a cast at the hero's position */
  start(c: UltCast): void;
  /** advance by scaled dt; return false once the effect has fully finished */
  update(dt: number): boolean;
  /** abort immediately and clean up (new run / back to menu) */
  stop(): void;
}

/** an original ultimate skill attached to a HeroDef */
export interface UltimateDef {
  /** also the damage source id (`G.stats.damageBy`) — always starts with "ult" */
  id: string;
  /** Thai name (banner, HUD, hero select) */
  name: string;
  /** one-line Thai description for the hero select screen */
  desc: string;
  /** accent colour (button ring, banner) */
  color: string;
  /** light tint used for the cast screen flash */
  flash: string;
  /** procedural icon (HUD button, menus) */
  icon: IconDraw;
  /** seconds the effect lasts at duration x1 (HUD "active" ring) */
  duration: number;
  /** seconds of invulnerability granted on cast */
  invuln: number;
  /** hero body animation while active */
  pose: UltPose;
  create(): UltEffect;
}
