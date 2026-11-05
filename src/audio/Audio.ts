import { Meta } from "../core/Meta";
import { G } from "../core/G";
import { SFX, SFX_NAMES, type SfxName } from "./sfxDefs";
import { SampleBank, Reaper, type RenderJob } from "./SampleBank";
import { MUSIC_SAMPLES, MUSIC_CORE } from "./instruments";
import { Music, type MusicMode } from "./Music";
import { buildMixer, type Mixer } from "./mixer";

export type { SfxName } from "./sfxDefs";

/** hard cap on simultaneous sound-effect voices */
const MAX_VOICES = 24;
/** music lookahead (s) and scheduler period (ms) */
const LOOKAHEAD = 0.2;
const TICK_MS = 30;
/** bus levels at volume 1.0 */
const SFX_LEVEL = 0.9;
const MUSIC_LEVEL = 0.75;
/** xp pickups climb a minor pentatonic while collected in quick succession */
const XP_STEPS = [0, 3, 5, 7, 10, 12, 15];
/** sounds rendered first so the menu / first fight are never silent */
const RENDER_FIRST: SfxName[] = ["select", "deny", "coin", "hit", "kill", "xp", "crit", "hurt", "levelup", "slash"];

interface SfxState {
  last: number;
  energy: number;
  eT: number;
}

type MusicState = "off" | MusicMode | "stopping";

export interface AudioStats {
  state: string;
  voices: number;
  pendingNodes: number;
  samples: number;
  sampleBytes: number;
  music: string;
  intensity: number;
  paused: boolean;
  muffled: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const quiet = (p: Promise<unknown> | undefined): void => {
  if (p && typeof p.catch === "function") p.catch(() => undefined);
};

/**
 * Procedural WebAudio sound system (no asset files).
 *
 * - Sound effects are synthesised once into buffers (SampleBank) and played
 *   with pitch jitter, per-sound throttling, a global voice cap, density
 *   attenuation and priority-based voice stealing.
 * - Music is a generative sequencer (Music) driven by a lookahead scheduler;
 *   intensity follows boss events, it muffles on level-up/chest screens,
 *   fades while paused and suspends with the page.
 * - Everything goes through a compressor + limiter (mixer.ts).
 *
 * Public API (stable): ctx, master, sfxBus, musicBus, unlock(), applySettings(),
 * sfx(name, {vol, pitch}), music(on, intensity). intensity < 0 = menu theme.
 */
export class AudioSys {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  /** play the calm menu theme automatically while G.state is "menu" */
  autoMenuMusic = true;

  private mix: Mixer | null = null;
  private bank = new SampleBank();
  private reaper = new Reaper();
  private seq: Music | null = null;
  private timer = 0;
  private tickFailed = false;
  private rt = {} as Record<SfxName, SfxState>;

  // voice table (fixed size, no per-play allocations besides the WebAudio nodes)
  private vEnd = new Float64Array(MAX_VOICES);
  private vStart = new Float64Array(MAX_VOICES);
  private vPrio = new Int8Array(MAX_VOICES);
  private vName: (SfxName | null)[] = new Array<SfxName | null>(MAX_VOICES).fill(null);
  private vGain: (GainNode | null)[] = new Array<GainNode | null>(MAX_VOICES).fill(null);
  private vSrc: (AudioBufferSourceNode | null)[] = new Array<AudioBufferSourceNode | null>(MAX_VOICES).fill(null);

  private xpStep = 0;
  private xpT = -10;
  private duckUntil = 0;
  private duckDepth = 0;

  // music control
  private reqOn = false;
  private reqIntensity = 0;
  private bossCount = 0;
  private mState: MusicState = "off";
  private stopEnd = 0;
  private paused = false;
  private muffled = false;
  private lastGameState = "";
  private subscribed = false;
  private suspendTimer = 0;
  private listeners: [EventTarget, string, EventListener][] = [];

  constructor() {
    for (const n of SFX_NAMES) this.rt[n] = { last: -10, energy: 0, eT: 0 };
    const unlock = (): void => this.unlock();
    // capture phase: runs before UI handlers (so a menu click can already make sound)
    for (const ev of ["pointerdown", "pointerup", "touchend", "keydown", "click"]) this.listen(window, ev, unlock);
    this.listen(document, "visibilitychange", () => this.updateSuspend());
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn, { capture: true, passive: true });
    this.listeners.push([target, type, fn]);
  }

  // ------------------------------------------------------------ lifecycle --

  /** create / resume the AudioContext; must be called from a user gesture */
  unlock(): void {
    if (!this.ctx && !this.create()) return;
    this.subscribe();
    this.updateSuspend();
  }

  private create(): boolean {
    let ctx: AudioContext;
    try {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return false;
      ctx = new Ctor({ latencyHint: "interactive" });
    } catch {
      return false;
    }
    this.ctx = ctx;
    const mix = buildMixer(ctx);
    this.mix = mix;
    this.master = mix.master;
    this.sfxBus = mix.sfxIn;
    this.musicBus = mix.musicIn;
    const d = Meta.data;
    mix.master.gain.value = d.muted || document.hidden ? 0 : 1;
    mix.sfxIn.gain.value = clamp01(d.sfxVol) * SFX_LEVEL;
    mix.musicIn.gain.value = clamp01(d.musicVol) * MUSIC_LEVEL;
    // iOS: starting a silent buffer inside the gesture fully unlocks output
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      /* not needed elsewhere */
    }
    void this.bank.build(ctx, this.renderJobs());
    this.timer = window.setInterval(this.tick, TICK_MS);
    return true;
  }

  private renderJobs(): RenderJob[] {
    const jobs: RenderJob[] = [];
    const seen = new Set<string>();
    const add = (key: string, recipe: RenderJob["recipe"]): void => {
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push({ key, recipe });
    };
    for (const n of RENDER_FIRST) add(n, SFX[n]);
    for (const k of MUSIC_CORE) add(k, MUSIC_SAMPLES[k]);
    for (const n of SFX_NAMES) add(n, SFX[n]);
    for (const k of Object.keys(MUSIC_SAMPLES)) add(k, MUSIC_SAMPLES[k]);
    return jobs;
  }

  /** Re-read Meta.data.muted / musicVol / sfxVol. */
  applySettings(): void {
    const ctx = this.ctx;
    const mix = this.mix;
    if (!ctx || !mix) return;
    const d = Meta.data;
    const now = ctx.currentTime;
    mix.sfxIn.gain.setTargetAtTime(clamp01(d.sfxVol) * SFX_LEVEL, now, 0.015);
    mix.musicIn.gain.setTargetAtTime(clamp01(d.musicVol) * MUSIC_LEVEL, now, 0.015);
    this.updateSuspend();
    this.refresh();
  }

  /** fade + suspend the audio thread while hidden or muted (battery), resume otherwise */
  private updateSuspend(): void {
    const ctx = this.ctx;
    const mix = this.mix;
    if (!ctx || !mix) return;
    const run = !document.hidden && !Meta.data.muted;
    mix.master.gain.setTargetAtTime(run ? 1 : 0, ctx.currentTime, 0.015);
    clearTimeout(this.suspendTimer);
    if (run) {
      if (ctx.state !== "running") quiet(ctx.resume());
    } else if (ctx.state === "running") {
      this.suspendTimer = window.setTimeout(() => {
        if (this.ctx && (document.hidden || Meta.data.muted)) quiet(this.ctx.suspend());
      }, 150);
    }
  }

  /** stop timers, listeners and the context (not used by the game, for completeness) */
  dispose(): void {
    clearInterval(this.timer);
    clearTimeout(this.suspendTimer);
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn, { capture: true });
    this.listeners.length = 0;
    this.seq?.stop();
    for (let i = 0; i < MAX_VOICES; i++) this.vGain[i]?.disconnect();
    this.reaper.flush();
    if (this.ctx) quiet(this.ctx.close());
    this.ctx = null;
    this.mix = null;
    this.master = this.sfxBus = this.musicBus = null;
  }

  private subscribe(): void {
    if (this.subscribed) return;
    const ev = G.events;
    if (!ev) return;
    this.subscribed = true;
    ev.on("bossSpawned", () => {
      this.bossCount++;
      this.refresh();
    });
    ev.on("bossKilled", () => {
      this.bossCount = Math.max(0, this.bossCount - 1);
      this.sfx("bossDie");
      this.refresh();
    });
    ev.on("runStart", () => (this.bossCount = 0));
    ev.on("runEnd", () => (this.bossCount = 0));
    ev.on("upgradeApplied", (e) => {
      if (e.kind === "evolve") this.sfx("evolve");
    });
    ev.on("pickup", (e) => {
      if (e.kind === "nuke") this.sfx("nuke");
    });
  }

  // -------------------------------------------------------- sound effects --

  /** Throttled, voice-limited one-shot sound effect. Safe to call every frame. */
  sfx(name: SfxName, opts?: { vol?: number; pitch?: number }): void {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== "running" || Meta.data.sfxVol <= 0.001) return;
    const def = SFX[name];
    if (!def) return;
    const st = this.rt[name];
    const now = ctx.currentTime;
    if (now - st.last < def.gap) return;

    // voice allocation: per-sound cap, then a free slot, else steal the
    // oldest lowest-priority voice (never one more important than us)
    let same = 0;
    let oldestSame = -1;
    let free = -1;
    let victim = -1;
    for (let i = 0; i < MAX_VOICES; i++) {
      if (this.vEnd[i] <= now) {
        if (free < 0) free = i;
        continue;
      }
      if (this.vName[i] === name) {
        same++;
        if (oldestSame < 0 || this.vStart[i] < this.vStart[oldestSame]) oldestSame = i;
      }
      if (victim < 0 || this.vPrio[i] < this.vPrio[victim] || (this.vPrio[i] === this.vPrio[victim] && this.vStart[i] < this.vStart[victim])) victim = i;
    }
    let slot: number;
    if (same >= def.max) {
      if (def.prio < 2) return; // combat spam: just drop
      slot = oldestSame; // important sounds restart
    } else if (free >= 0) {
      slot = free;
    } else {
      if (this.vPrio[victim] > def.prio) return;
      slot = victim;
    }
    this.releaseVoice(slot, now);
    st.last = now;

    // rapid repeats of the same sound get progressively quieter (less fatigue)
    st.energy = st.energy * Math.exp(-(now - st.eT) / 0.3) + 1;
    st.eT = now;
    const vol = (def.vol * (opts?.vol ?? 1)) / Math.sqrt(1 + (st.energy - 1) * def.dense);
    let rate = opts?.pitch ?? 1;
    if (def.jitter > 0) rate *= Math.pow(2, ((Math.random() * 2 - 1) * def.jitter) / 12);
    if (name === "xp") rate *= this.xpChain(now);

    const g = ctx.createGain();
    g.gain.value = vol;
    g.connect(this.mix!.sfxIn);
    const bufs = this.bank.get(name);
    let src: AudioBufferSourceNode | null = null;
    let end: number;
    if (bufs) {
      const buf = bufs.length > 1 ? bufs[(Math.random() * bufs.length) | 0] : bufs[0];
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(g);
      src.start(now);
      end = now + buf.duration / rate;
    } else {
      // not rendered yet (first instant after unlock) or no offline rendering: synthesise live
      def.render({ c: ctx, out: g, t: now, r: Math.random });
      end = now + def.dur + 0.05;
    }
    this.vEnd[slot] = end;
    this.vStart[slot] = now;
    this.vPrio[slot] = def.prio;
    this.vName[slot] = name;
    this.vGain[slot] = g;
    this.vSrc[slot] = src;
    if (def.duck > 0) this.duck(def.duck * Math.min(1, opts?.vol ?? 1), now);
  }

  private xpChain(now: number): number {
    if (now - this.xpT > 0.5) this.xpStep = 0;
    else if (++this.xpStep >= XP_STEPS.length) this.xpStep = 2; // keep cycling the top of the scale
    this.xpT = now;
    return Math.pow(2, XP_STEPS[this.xpStep] / 12);
  }

  /** free a voice slot; a still-playing voice is faded in 15 ms (no click) */
  private releaseVoice(slot: number, now: number): void {
    const g = this.vGain[slot];
    if (g) {
      if (this.vEnd[slot] > now) {
        const p = g.gain;
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(0, now + 0.015);
        const s = this.vSrc[slot];
        if (s) {
          try {
            s.stop(now + 0.02);
          } catch {
            /* already stopped */
          }
        }
        this.reaper.add(g, now + 0.05);
      } else {
        g.disconnect();
      }
    }
    this.vGain[slot] = null;
    this.vSrc[slot] = null;
    this.vName[slot] = null;
    this.vEnd[slot] = 0;
  }

  private sweepVoices(now: number): void {
    for (let i = 0; i < MAX_VOICES; i++) {
      const g = this.vGain[i];
      if (g && this.vEnd[i] + 0.05 < now) {
        g.disconnect();
        this.vGain[i] = null;
        this.vSrc[i] = null;
        this.vName[i] = null;
      }
    }
  }

  /** dip the music under a stinger */
  private duck(amount: number, now: number): void {
    const mix = this.mix;
    if (!mix || this.mState === "off") return;
    if (now < this.duckUntil && amount <= this.duckDepth) return;
    const hold = 0.2 + amount * 0.6;
    const p = mix.duck.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(1 - amount, now, 0.03);
    p.setTargetAtTime(1, now + hold, 0.3);
    this.duckUntil = now + hold;
    this.duckDepth = amount;
  }

  // ----------------------------------------------------------------- music --

  /**
   * Start/stop background music. intensity: 0 = normal, 1 = boss fight,
   * < 0 = calm menu theme. Repeated calls only change intensity (no restart).
   */
  music(on: boolean, intensity = 0): void {
    this.subscribe();
    this.reqOn = on;
    if (on) this.reqIntensity = intensity;
    this.refresh();
  }

  private refresh(): void {
    const ctx = this.ctx;
    if (ctx && this.mix) this.reconcileMusic(ctx.currentTime);
  }

  private effIntensity(): number {
    return this.reqIntensity > 0 || this.bossCount > 0 ? 1 : 0;
  }

  private desiredMusic(): "off" | MusicMode {
    const d = Meta.data;
    if (d.muted || d.musicVol <= 0.001) return "off";
    if (this.reqOn) return this.reqIntensity < 0 ? "menu" : "run";
    if (this.autoMenuMusic && G.state === "menu") return "menu";
    return "off";
  }

  private musicReady(): boolean {
    for (const k of MUSIC_CORE) if (!this.bank.has(k)) return false;
    return true;
  }

  private reconcileMusic(now: number): void {
    const want = this.desiredMusic();
    if (this.mState === "stopping") {
      if (now < this.stopEnd) return;
      this.seq?.stop();
      this.mState = "off";
    }
    if (this.mState === "off") {
      if (want !== "off" && this.musicReady()) this.startMusic(want, now);
      return;
    }
    if (this.mState !== want) {
      this.fadeOutMusic(now, want === "off" ? 0.7 : 0.35);
      return;
    }
    if (want === "run") this.seq?.setIntensity(this.effIntensity());
  }

  private startMusic(mode: MusicMode, now: number): void {
    const ctx = this.ctx!;
    const mix = this.mix!;
    if (!this.seq) this.seq = new Music(ctx, mix.musicIn, this.bank, this.reaper);
    const g = mix.gate.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(1, now + (mode === "menu" ? 2 : 0.08));
    this.seq.start(mode, mode === "run" ? this.effIntensity() : -1, now + 0.1);
    this.mState = mode;
  }

  private fadeOutMusic(now: number, dur: number): void {
    const g = this.mix!.gate.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + dur);
    this.mState = "stopping";
    this.stopEnd = now + dur + 0.05;
  }

  /** react to pause / level-up / chest screens */
  private watchGameState(now: number): void {
    const s = G.state;
    if (s === this.lastGameState) return;
    this.lastGameState = s;
    const ctx = this.ctx!;
    const mix = this.mix!;
    const pause = s === "paused";
    if (pause !== this.paused) {
      this.paused = pause;
      const p = mix.pause.gain;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(pause ? 0 : 1, now, pause ? 0.05 : 0.12);
      if (!pause) this.seq?.resync(now + 0.05);
    }
    const muffle = s === "levelup" || s === "chest";
    if (muffle !== this.muffled) {
      this.muffled = muffle;
      const f = mix.muffle.frequency;
      f.cancelScheduledValues(now);
      f.setTargetAtTime(muffle ? 700 : Math.min(20000, ctx.sampleRate / 2 - 100), now, muffle ? 0.06 : 0.25);
    }
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || !this.mix) return;
    try {
      const now = ctx.currentTime;
      this.sweepVoices(now);
      this.reaper.sweep(now);
      this.watchGameState(now);
      this.reconcileMusic(now);
      const m = this.seq;
      if (m && m.playing && !this.paused && ctx.state === "running") m.schedule(now, now + LOOKAHEAD);
    } catch (err) {
      // never let audio take the game down; report once and silence music
      this.seq?.stop();
      if (!this.tickFailed) {
        this.tickFailed = true;
        console.error("[audio] scheduler error", err);
      }
    }
  };

  /** diagnostics for tests / debugging */
  stats(): AudioStats {
    const now = this.ctx?.currentTime ?? 0;
    let voices = 0;
    for (let i = 0; i < MAX_VOICES; i++) if (this.vEnd[i] > now) voices++;
    return {
      state: this.ctx?.state ?? "locked",
      voices,
      pendingNodes: this.reaper.size,
      samples: this.bank.count,
      sampleBytes: this.bank.bytes,
      music: this.mState,
      intensity: this.seq?.intensity ?? 0,
      paused: this.paused,
      muffled: this.muffled,
    };
  }
}
