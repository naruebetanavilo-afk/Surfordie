import { G } from "../core/G";
import { ENEMY_DEFS } from "../enemies/defs";
import type { UltCast, UltEffect, UltimateDef } from "./ultimates/types";

/**
 * Charge cost model. The horde's kill-xp rate grows ~30x over a run (measured
 * with the autoplay bot: ~0.8 xp/s at 0:30 with the start weapon, ~30 xp/s at
 * 4:00 with a full build), so the cost of a full meter follows the run clock,
 * fitted to a typical player's kill rate (1 xp/s @0:30, 3.5 @1:30, 8 @3:00,
 * 15 @5:00, 22 @7:00, 32 @9:00) for one cast every ~40-60 s. A rolling
 * average of the player's own kill rate puts a floor under the cost, so a
 * very strong build still waits ~30 s. Kills by the ultimate itself and kills
 * while it is running do not charge it.
 *
 *   need(t)   = max(NEED_BASE * (1 + m * NEED_LIN + m^2 * NEED_QUAD), rate * FLOOR_S)
 *               * (1 + NEED_PER_CAST * min(casts, 6))          (m = minutes)
 *   per kill  = enemy xp (elite x10) / need     (boss kill: +BOSS_BONUS)
 *   trickle   = 1 / TRICKLE_S per second       (a fleeing player still gets one)
 *
 * A run starts with START_CHARGE so the first cast (and the button) shows up
 * within the first minute. `stats.ultCharge` (if a shop upgrade ever adds it)
 * multiplies all gains.
 */
const NEED_BASE = 55;
const NEED_LIN = 1.9;
const NEED_QUAD = 0.2;
const NEED_PER_CAST = 0.06;
const FLOOR_S = 40;
/** time constant (s) of the kill-rate average */
const RATE_TAU = 20;
const TRICKLE_S = 150;
const BOSS_BONUS = 0.3;
const START_CHARGE = 0.2;

/**
 * Per-run difficulty modifier (`G.mods`, difficulty tiers / stages) when the
 * build has it, else 1: tougher enemies (hp) scale the ultimate's damage, a
 * denser crowd (density) raises the meter cost so the cadence stays the same.
 */
function runMod(key: "hp" | "density"): number {
  const m = (G as unknown as { mods?: Partial<Record<string, number>> }).mods;
  const v = m ? m[key] : undefined;
  return typeof v === "number" && v > 0 ? v : 1;
}

/** autoplay bot: wait this long after the meter fills before casting */
const BOT_DELAY = 0.6;

/**
 * The hero's ultimate skill: a charge meter (0..1) filled by fighting and a
 * spectacular effect cast with the big HUD button / Space. Owned by Player
 * (`G.player.ult`); updated from Player.update, so it only runs while playing.
 */
export class Ultimate {
  /** 0..1 meter */
  charge = 0;
  /** casts this run */
  casts = 0;
  def: UltimateDef | null = null;
  /** seconds the running effect has played, and its nominal length */
  activeT = 0;
  activeDur = 1;
  /** seconds the HUD ring takes to drain (>= activeDur for lingering effects) */
  private hudDur = 1;
  /** tuning / test counters (read by probes through window.__game) */
  readonly stat = { killXp: 0, castAt: [] as number[], kills: 0 };

  private effect: UltEffect | null = null;
  private readonly instances = new Map<string, UltEffect>();
  private xpById: Map<string, number> | null = null;
  private hooked = false;
  private botWait = 0;
  /** rolling average of xp-weighted kills per second, and this frame's kills */
  private rate = 0;
  private xpAcc = 0;
  private readonly cast: UltCast = { power: 1, area: 1, amount: 0, duration: 1 };

  /** meter full and nothing running */
  get ready(): boolean {
    return this.charge >= 1 && this.effect === null;
  }

  /** an ultimate effect is playing */
  get active(): boolean {
    return this.effect !== null;
  }

  /** 0..1 progress of the running effect */
  get activeFrac(): number {
    return this.effect ? Math.min(1, this.activeT / this.hudDur) : 0;
  }

  /** xp-weighted kills needed for a full meter right now */
  need(): number {
    const m = G.time / 60;
    const base = Math.max(NEED_BASE * (1 + m * NEED_LIN + m * m * NEED_QUAD), this.rate * FLOOR_S);
    return base * runMod("density") * (1 + NEED_PER_CAST * Math.min(this.casts, 6));
  }

  /** rolling xp-weighted kill rate (per second) */
  get killRate(): number {
    return this.rate;
  }

  /** create the effect objects of these ultimates now (boot shader prewarm) */
  prepare(defs: readonly UltimateDef[]): void {
    for (const d of defs) this.instance(d).prepare();
  }

  /**
   * New run (or menu): empty meter, stop anything running. `stopAll` also
   * resets every idle effect (hides their batches); the very first reset at
   * boot skips it so the freshly prepared objects are still visible to the
   * shader prewarm (renderer.compile only visits visible objects).
   */
  reset(def: UltimateDef, stopAll = true): void {
    this.stopEffect();
    if (stopAll) for (const e of this.instances.values()) e.stop();
    this.def = def;
    this.charge = START_CHARGE;
    this.casts = 0;
    this.botWait = 0;
    this.rate = 0;
    this.xpAcc = 0;
    this.stat.killXp = 0;
    this.stat.kills = 0;
    this.stat.castAt.length = 0;
    this.hook();
  }

  /** add meter (0..1 units), scaled by the charge-speed stat */
  addCharge(v: number): void {
    if (this.effect || v <= 0) return;
    const was = this.charge;
    this.charge = Math.min(1, this.charge + v * this.chargeMul());
    if (was < 1 && this.charge >= 1) G.audio.sfx("select", { pitch: 1.45, vol: 0.8 });
  }

  update(dt: number): void {
    if (!this.def) return;
    // rate += (xpAcc / dt - rate) * dt / TAU
    this.rate = Math.max(0, this.rate + (this.xpAcc - this.rate * dt) / RATE_TAU);
    this.xpAcc = 0;
    if (this.effect) {
      this.activeT += dt;
      G.player.ultGlow = 1;
      if (!this.effect.update(dt)) this.effect = null;
    } else if (this.charge < 1) {
      this.addCharge(dt / TRICKLE_S);
    }
    // the autoplay bot casts once there is something worth hitting
    if (G.debug.autoplay && this.ready) {
      this.botWait += dt;
      if (this.botWait > BOT_DELAY && (this.crowd() >= 8 || this.botWait > 4)) this.tryCast();
    } else this.botWait = 0;
  }

  /** cast if ready; returns true when the ultimate fired */
  tryCast(): boolean {
    const p = G.player;
    const def = this.def;
    if (!def || !this.ready || G.state !== "playing" || p.dead) return false;
    this.charge = 0;
    this.casts++;
    this.botWait = 0;
    this.stat.castAt.push(+G.time.toFixed(1));
    const s = p.stats;
    const c = this.cast;
    c.power = G.director.hpScale(G.time) * runMod("hp");
    c.area = 0.75 + 0.25 * s.area;
    c.amount = Math.max(0, s.amount);
    c.duration = 0.85 + 0.15 * s.duration;
    this.activeT = 0;
    this.activeDur = def.duration * c.duration;
    this.hudDur = (def.hudDuration ?? def.duration) * c.duration;
    this.effect = this.instance(def);
    p.invuln = Math.max(p.invuln, def.invuln);
    p.playUltPose(def.pose, this.activeDur, def.color);
    // shared cast juice; each effect adds its own sounds / impacts
    G.fx.slowMo(0.5, 0.3);
    G.overlay.screenFlash(def.flash, 0.5, 0.4);
    G.fx.shake(0.35);
    G.hud.ultCast(def);
    G.events.emit("ultCast", { id: def.id, hero: p.hero.id });
    this.effect.start(c);
    return true;
  }

  private stopEffect(): void {
    if (this.effect) this.effect.stop();
    this.effect = null;
  }

  private instance(def: UltimateDef): UltEffect {
    let e = this.instances.get(def.id);
    if (!e) {
      e = def.create();
      this.instances.set(def.id, e);
    }
    return e;
  }

  private chargeMul(): number {
    const m = G.player.stats.ultCharge;
    return typeof m === "number" && m > 0 ? m : 1;
  }

  private crowdN = 0;
  private readonly crowdCb = (): void => {
    this.crowdN++;
  };
  /** enemies close to the hero (bot heuristic) */
  private crowd(): number {
    this.crowdN = 0;
    G.enemies.queryCircle(G.player.x, G.player.z, 7, this.crowdCb);
    return this.crowdN;
  }

  private hook(): void {
    if (this.hooked || !G.events) return;
    this.hooked = true;
    G.events.on("enemyKilled", (e) => {
      if (G.state !== "playing" || e.source.startsWith("ult")) return;
      if (!this.xpById) {
        this.xpById = new Map();
        for (const d of ENEMY_DEFS) this.xpById.set(d.id, d.xp);
      }
      // bosses drop hundreds of xp: they give a flat bonus instead
      const xp = e.boss ? 0 : (this.xpById.get(e.typeId) ?? 1) * (e.elite ? 10 : 1);
      this.stat.killXp += xp;
      this.stat.kills++;
      this.xpAcc += xp;
      if (this.effect) return;
      this.addCharge(xp / this.need() + (e.boss ? BOSS_BONUS : 0));
    });
  }
}
