import { G, resetRunStats } from "./G";
import { Flow } from "./flow";
import { Meta } from "./Meta";
import { Rng } from "./Rng";
import { EventBus } from "./Events";
import { Input } from "./Input";
import { World } from "../world/World";
import { Player } from "../player/Player";
import { EnemyManager } from "../enemies/EnemyManager";
import { Director, RUN_LENGTH } from "../director/Director";
import { Projectiles } from "../combat/Projectiles";
import { Pickups } from "../pickups/Pickups";
import { Fx } from "../fx/Fx";
import { Overlay2D } from "../ui/Overlay2D";
import { Hud } from "../ui/Hud";
import { Screens } from "../ui/Screens";
import { AudioSys } from "../audio/Audio";
import { WeaponSystem } from "../weapons/WeaponSystem";
import { WEAPONS } from "../weapons/registry";
import { prewarmShaders } from "./prewarm";
import { recommend } from "../weapons/recommend";
import { applyRunSetup, recordRun, syncMenuStage } from "../meta/runSetup";
import { Missions } from "../meta/missions";

/** what the results screen shows besides the run stats (meta progression) */
export interface RunSummary {
  stageId: string;
  curse: number;
  /** won a curse tier above this stage's previous best (or the first win there) */
  newBestCurse: boolean;
  /** curse tier opened by this win (0 = none) */
  unlockedCurse: number;
  /** stage ids opened by this run */
  newStages: string[];
  /** survived longer than ever on this stage */
  newBestTime: boolean;
  /** missions completed during this run */
  missions: { id: string; name: string; daily: boolean; weapon?: string; hero?: string }[];
}

/** first level-up of a burst waits this long (s); AUTO mode then applies one every AUTO_GAP */
const LEVELUP_DELAY = 0.15;
const AUTO_GAP = 0.25;

/**
 * Boots every system, owns the main loop and the run state machine.
 */
export class Game {
  private last = performance.now();
  private fpsAcc = 0;
  private fpsFrames = 0;
  private levelUpDelay = 0;
  private botT = 0;
  private botAngle = 0;
  private endT = -1;
  /** state seen by the previous frame's render step, and frames spent in the current modal */
  private renderState: string = "";
  private modalFrames = 0;

  boot(): void {
    this.readDebugFlags();
    Meta.load();
    G.rng = new Rng(this.seed());
    G.events = new EventBus();
    // mission tracking hooks the bus first; old saves may already meet some goals
    Missions.init();
    Missions.check();
    syncMenuStage();
    const app = document.getElementById("app")!;
    const glCanvas = document.getElementById("gl") as HTMLCanvasElement;
    const ovCanvas = document.getElementById("overlay") as HTMLCanvasElement;
    const ui = document.getElementById("ui")!;

    G.overlay = new Overlay2D(ovCanvas);
    G.world = new World(glCanvas);
    const q = new URLSearchParams(location.search).get("quality");
    if (q === "low" || q === "medium" || q === "high") G.world.setQuality(q);
    G.input = new Input(app);
    G.audio = new AudioSys();
    G.weapons = new WeaponSystem();
    G.fx = new Fx(G.world.scene);
    G.player = new Player(G.world.scene);
    G.enemies = new EnemyManager(G.world.scene);
    G.projectiles = new Projectiles(G.world.scene);
    G.pickups = new Pickups(G.world.scene);
    G.director = new Director();
    G.hud = new Hud(ui);
    G.screens = new Screens(ui);
    G.world.resize();

    Flow.startRun = (id) => this.startRun(id);
    Flow.toMenu = () => this.toMenu();
    Flow.resume = () => this.resume();
    Flow.pause = () => this.pause();
    G.input.setPauseHandler(() => G.screens.togglePause());

    G.events.on("playerDied", () => this.endRun(false));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && G.state === "playing") this.pause();
    });
    // desktop: losing window focus clears input, so pause instead of leaving the hero idle
    window.addEventListener("blur", () => {
      if (G.state === "playing" && !G.debug.autoplay) this.pause();
    });

    // expose for tests / debugging
    (window as unknown as { __game: typeof G }).__game = G;

    G.player.reset(G.debug.hero ?? Meta.data.lastHero ?? "knight");
    // compile every shader a run can need now, not mid-run (see prewarm.ts)
    prewarmShaders();
    if (G.debug.skipMenu) this.startRun(G.debug.hero ?? Meta.data.lastHero ?? "knight");
    else this.toMenu();

    requestAnimationFrame((t) => this.frame(t));
  }

  private seed(): number {
    const s = new URLSearchParams(location.search).get("seed");
    return s ? parseInt(s, 10) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  }

  private readDebugFlags(): void {
    const q = new URLSearchParams(location.search);
    const d = G.debug;
    d.autoplay = q.get("autoplay") === "1";
    d.god = q.get("god") === "1";
    d.skipMenu = q.get("skipmenu") === "1" || d.autoplay;
    d.showFps = q.get("fps") === "1";
    d.startTime = parseFloat(q.get("t") ?? "0") || 0;
    d.allWeapons = parseInt(q.get("weapons") ?? "0", 10) || 0;
    d.hero = q.get("hero");
  }

  startRun(heroId: string): void {
    G.screens.close();
    // a run restarted from the pause screen counts what it already did
    if (Missions.running) Missions.abandonRun();
    // stage + curse tier from the run setup (G.stageId / G.curse / G.mods): before
    // the director loads the stage timeline and before anything spawns
    applyRunSetup();
    G.heroId = heroId;
    resetRunStats();
    G.time = G.debug.startTime;
    G.timeScale = 1;
    G.enemies.clear();
    G.projectiles.clear();
    G.pickups.clear();
    G.fx.clear();
    G.overlay.clear();
    G.director.reset();
    G.player.reset(heroId);
    G.weapons.reset(G.player.hero.startWeapon);
    if (G.debug.allWeapons > 0) {
      for (const w of WEAPONS) {
        const inst = G.weapons.get(w.id) ?? G.weapons.addWeapon(w.id);
        while (inst && inst.level < Math.min(G.debug.allWeapons, w.maxLevel)) G.weapons.upgradeWeapon(w.id);
      }
    }
    G.player.recalcStats();
    G.player.hp = G.player.stats.maxHp;
    G.world.camTarget.set(0, 0, 0);
    G.world.zoom = 1;
    this.endT = -1;
    this.levelUpDelay = 0;
    G.hud.reset();
    G.hud.show(true);
    G.state = "playing";
    G.audio.music(true, 0);
    G.events.emit("runStart", {});
  }

  toMenu(): void {
    // quitting mid-run: kills etc. still count for missions
    if (Missions.running) Missions.abandonRun();
    G.state = "menu";
    syncMenuStage();
    G.hud.show(false);
    G.enemies.clear();
    G.projectiles.clear();
    G.pickups.clear();
    G.fx.clear();
    G.overlay.clear();
    for (const w of G.weapons.weapons) w.dispose();
    G.weapons.weapons = [];
    G.player.reset(Meta.data.lastHero || "knight");
    G.world.camTarget.set(0, 0, 0);
    G.screens.showMenu();
    G.audio.music(false);
  }

  pause(): void {
    if (G.state !== "playing") return;
    G.state = "paused";
    G.input.release();
    G.screens.showPause();
  }

  resume(): void {
    G.screens.close();
    G.state = "playing";
    this.last = performance.now();
  }

  private endRun(victory: boolean): void {
    if (G.state === "gameover" || G.state === "victory") return;
    G.state = victory ? "victory" : "gameover";
    const earned = Math.round(G.stats.gold);
    const md = Meta.data;
    md.gold += earned;
    md.runs++;
    md.bestTime = Math.max(md.bestTime, G.time);
    md.bestKills = Math.max(md.bestKills, G.stats.kills);
    md.bestLevel = Math.max(md.bestLevel, G.player.level);
    md.totalKills += G.stats.kills;
    if (victory) md.wins++;
    // per-stage records + curse unlocks, then missions (they read the records)
    const rec = recordRun(victory, G.time);
    const done = Missions.endRun(victory);
    Meta.save();
    const summary: RunSummary = {
      stageId: rec.stageId,
      curse: rec.curse,
      newBestCurse: rec.newBestCurse,
      unlockedCurse: rec.unlockedCurse,
      newStages: rec.newStages.map((s) => s.id),
      newBestTime: rec.newBestTime,
      missions: done.map((m) => ({ id: m.def.id, name: m.def.name, daily: m.daily, weapon: m.def.reward.weapon, hero: m.def.reward.hero })),
    };
    G.input.release();
    G.audio.sfx(victory ? "victory" : "defeat");
    G.audio.music(false);
    G.events.emit("runEnd", { victory });
    // short delay so the death/victory moment reads
    setTimeout(() => G.screens.showResults(victory, earned, summary), victory ? 600 : 1200);
  }

  private openLevelUp(): void {
    G.state = "levelup";
    G.input.release();
    G.audio.sfx("levelup");
    G.fx.ring(G.player.x, G.player.z, { radius: 3.5, color: "#ffe680", life: 0.6, width: 0.6 });
    const choices = G.weapons.rollChoices();
    const next = () => {
      G.player.pendingLevels--;
      G.screens.close();
      // AUTO mode switched on from the level-up screen resolves the rest in play
      if (G.player.pendingLevels > 0 && !Meta.data.autoPick) {
        this.openLevelUp();
      } else {
        G.state = "playing";
        this.last = performance.now();
      }
    };
    G.screens.showLevelUp(
      choices,
      (c) => {
        G.weapons.applyChoice(c);
        next();
      },
      () => {
        G.weapons.skipLevel();
        next();
      },
    );
    if (G.debug.autoplay) {
      // the bot takes the recommended card like a sensible player
      setTimeout(() => {
        const btn = document.querySelector<HTMLButtonElement>(".levelup .card.rec") ?? document.querySelector<HTMLButtonElement>(".levelup .card");
        btn?.click();
      }, 150);
    }
  }

  /**
   * AUTO mode: apply the recommended card of a fresh roll without pausing.
   * The usual level-up sound / ring play and WeaponSystem.applyChoice shows
   * the skill toast, so the player still sees what they got. Never spends
   * reroll / skip / banish charges.
   */
  private autoLevelUp(): void {
    const p = G.player;
    G.audio.sfx("levelup");
    G.fx.ring(p.x, p.z, { radius: 3.5, color: "#ffe680", life: 0.6, width: 0.6 });
    const choices = G.weapons.rollChoices();
    const k = recommend(choices);
    if (k >= 0) G.weapons.applyChoice(choices[k]);
    p.pendingLevels--;
  }

  private bot(dt: number): void {
    const inp = G.input;
    if (!G.debug.autoplay) {
      inp.botActive = false;
      return;
    }
    inp.botActive = true;
    const p = G.player;
    const em = G.enemies;
    let fx = 0;
    let fz = 0;
    em.queryCircle(p.x, p.z, 5, (i) => {
      const dx = p.x - em.x[i];
      const dz = p.z - em.z[i];
      const d2 = dx * dx + dz * dz + 0.1;
      fx += dx / d2;
      fz += dz / d2;
    });
    this.botT -= dt;
    if (this.botT <= 0) {
      this.botT = 1.5 + Math.random() * 2;
      this.botAngle += (Math.random() - 0.5) * 2.5;
    }
    // go for the nearest pickup (gems, coins, hearts, chests) like a real player;
    // strongly when nothing is close, weakly while threatened
    const pk = G.pickups;
    let best = -1;
    let bd = 81;
    for (let k = 0; k < pk.n; k++) {
      const dx = pk.x[k] - p.x;
      const dz = pk.z[k] - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        best = k;
      }
    }
    const danger = Math.hypot(fx, fz);
    if (best >= 0) {
      const d = Math.sqrt(bd) || 1;
      const w = danger < 0.35 ? 1.6 : 0.5;
      fx += ((pk.x[best] - p.x) / d) * w;
      fz += ((pk.z[best] - p.z) / d) * w;
    } else {
      fx += Math.cos(this.botAngle) * 0.6;
      fz += Math.sin(this.botAngle) * 0.6;
    }
    const l = Math.hypot(fx, fz) || 1;
    inp.botX = fx / l;
    inp.botZ = fz / l;
    // auto-close chests
    const chestBtn = document.querySelector<HTMLButtonElement>(".chest .btn.primary");
    if (chestBtn && G.state === "chest") chestBtn.click();
  }

  /**
   * Behind the level-up / chest / pause modals the simulation is frozen and
   * the scene sits under a 72-95% opaque backdrop: redraw it (and re-upload
   * the instance buffers) only on the first frame of the modal, every 4th
   * frame (the slowed fx drift stays alive) and after a resize. A WebGL
   * canvas that is not drawn to keeps showing its last frame.
   */
  private shouldRender3D(): boolean {
    const s = G.state;
    const entered = s !== this.renderState;
    this.renderState = s;
    if (s !== "levelup" && s !== "chest" && s !== "paused") return true;
    this.modalFrames = entered ? 0 : this.modalFrames + 1;
    return this.modalFrames % 4 === 0 || G.world.renderRequested;
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    G.realTime += rawDt;
    const t0 = performance.now();

    G.input.update();
    if (G.state === "playing") {
      const dt = rawDt * G.timeScale;
      G.dt = dt;
      G.time += dt;
      this.bot(dt);
      G.player.update(dt);
      G.director.update(dt);
      G.enemies.update(dt);
      G.weapons.update(dt);
      G.projectiles.update(dt);
      G.pickups.update(dt);
      Missions.tick(rawDt);
      // re-check the state: a chest picked up this frame must not be replaced by the level-up
      if (G.state === "playing" && G.player.pendingLevels > 0 && !G.player.dead) {
        this.levelUpDelay += rawDt;
        if (this.levelUpDelay > LEVELUP_DELAY) {
          if (Meta.data.autoPick) {
            // stagger a burst of levels so each toast / ring reads
            this.levelUpDelay = LEVELUP_DELAY - AUTO_GAP;
            this.autoLevelUp();
          } else {
            this.levelUpDelay = 0;
            this.openLevelUp();
          }
        }
      }
      if (G.time >= RUN_LENGTH && !G.player.dead && G.state === "playing" && this.endT < 0) {
        this.endT = G.time;
        this.endRun(true);
      }
    } else if (G.state === "menu") {
      G.player.faceX = Math.sin(G.realTime * 0.6);
      G.player.faceZ = Math.cos(G.realTime * 0.6);
      G.player.animate(rawDt, false);
    } else if (G.state === "gameover" || G.state === "victory") {
      // let death animations / effects finish in the background
      G.enemies.update(rawDt * 0.3, false);
    }
    G.fx.update(G.state === "playing" ? G.dt : rawDt * (G.state === "menu" ? 1 : 0.25));
    G.world.update(rawDt, G.player.x, G.player.z);
    if (this.shouldRender3D()) {
      G.enemies.render();
      G.projectiles.render();
      G.pickups.render();
      G.world.render();
    }
    G.overlay.draw(rawDt);
    if (G.state === "playing" || G.state === "levelup" || G.state === "chest" || G.state === "paused") G.hud.update();
    G.screens.update();

    // perf stats
    G.perf.frameMs = G.perf.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fpsAcc += rawDt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      G.perf.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }
}
