/**
 * Run weather shared by the director (gameplay) and the world (visuals).
 *
 * `storm` eases towards 1 while a blizzard is active and back to 0 after:
 * the world thickens the snowfall, whitens the haze and frosts the screen
 * edges; the director lets the wind push the hero gently (see Director).
 * Pure state, no scene objects. Reset on every run start.
 */
export const Weather = {
  /** 0 = calm, 1 = full blizzard (eased) */
  storm: 0,
  /** run time (s) at which the current blizzard ends */
  until: 0,
  /** unit wind direction on the ground (x, z) */
  windX: 1,
  windZ: 0,

  /** start (or extend) a blizzard blowing towards `angle` (radians, atan2(z, x)) */
  blizzard(now: number, duration: number, angle: number): void {
    this.until = Math.max(this.until, now + duration);
    this.windX = Math.cos(angle);
    this.windZ = Math.sin(angle);
  },

  /** is a blizzard currently raging (not just fading out)? */
  active(now: number): boolean {
    return now < this.until;
  },

  /** advance the easing (call once per simulated frame) */
  update(now: number, dt: number): void {
    const target = now < this.until ? 1 : 0;
    const rate = target > this.storm ? 0.45 : 0.3;
    if (this.storm < target) this.storm = Math.min(target, this.storm + rate * dt);
    else if (this.storm > target) this.storm = Math.max(target, this.storm - rate * dt);
  },

  reset(): void {
    this.storm = 0;
    this.until = 0;
    this.windX = 1;
    this.windZ = 0;
  },
};
