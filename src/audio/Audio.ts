import { Meta } from "../core/Meta";

export type SfxName =
  | "hit"
  | "crit"
  | "kill"
  | "xp"
  | "coin"
  | "levelup"
  | "select"
  | "deny"
  | "hurt"
  | "slash"
  | "zap"
  | "boom"
  | "whoosh"
  | "thunder"
  | "heal"
  | "magnet"
  | "chest"
  | "boss"
  | "victory"
  | "defeat"
  | "spike"
  | "burn"
  | "throw"
  | "freeze"
  | "spit"
  | "warn"
  | "horde"
  | "bossRoar"
  | "stomp";

/**
 * WebAudio synthesiser: every sound is generated procedurally (no assets).
 * Core version: simple blips. The audio pass replaces the internals but must
 * keep this public API (sfx, music, applySettings, unlock).
 */
export class AudioSys {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  private lastPlay = new Map<string, number>();
  private xpPitch = 0;
  private xpPitchT = 0;

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.applySettings();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  applySettings(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    const d = Meta.data;
    this.master.gain.value = d.muted ? 0 : 1;
    this.sfxBus.gain.value = d.sfxVol * 0.6;
    this.musicBus.gain.value = d.musicVol * 0.5;
  }

  /** throttled one-shot sound effect */
  sfx(name: SfxName, opts: { vol?: number; pitch?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const minGap = name === "hit" || name === "kill" || name === "xp" ? 0.035 : 0.02;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < minGap) return;
    this.lastPlay.set(name, now);
    const vol = opts.vol ?? 1;
    const p = opts.pitch ?? 1;
    switch (name) {
      case "hit":
        this.blip("square", 220 * p, 110 * p, 0.05, 0.12 * vol);
        break;
      case "crit":
        this.blip("square", 440 * p, 160 * p, 0.08, 0.16 * vol);
        break;
      case "kill":
        this.noise(0.08, 0.1 * vol, 1200);
        break;
      case "xp": {
        if (now - this.xpPitchT > 0.6) this.xpPitch = 0;
        this.xpPitchT = now;
        this.xpPitch = Math.min(this.xpPitch + 1, 14);
        const f = 660 * Math.pow(2, this.xpPitch / 24);
        this.blip("sine", f, f * 1.5, 0.06, 0.09 * vol);
        break;
      }
      case "coin":
        this.blip("square", 990, 1320, 0.08, 0.08 * vol);
        break;
      case "levelup":
        [523, 659, 784, 1046].forEach((f, i) => this.blip("triangle", f, f, 0.14, 0.18 * vol, i * 0.07));
        break;
      case "select":
        this.blip("triangle", 660, 990, 0.08, 0.15 * vol);
        break;
      case "deny":
        this.blip("square", 180, 120, 0.12, 0.12 * vol);
        break;
      case "hurt":
        this.blip("sawtooth", 200, 60, 0.18, 0.2 * vol);
        break;
      case "slash":
        this.noise(0.12, 0.12 * vol, 3000);
        break;
      case "zap":
        this.blip("sawtooth", 880 * p, 220 * p, 0.09, 0.06 * vol);
        break;
      case "boom":
        this.noise(0.4, 0.3 * vol, 500);
        this.blip("sine", 120, 40, 0.35, 0.3 * vol);
        break;
      case "whoosh":
        this.noise(0.25, 0.08 * vol, 1800);
        break;
      case "thunder":
        this.noise(0.35, 0.25 * vol, 2200);
        break;
      case "heal":
        this.blip("sine", 440, 880, 0.25, 0.15 * vol);
        break;
      case "magnet":
        this.blip("sine", 300, 1200, 0.4, 0.15 * vol);
        break;
      case "chest":
        [392, 523, 659, 784, 1046].forEach((f, i) => this.blip("triangle", f, f, 0.18, 0.2 * vol, i * 0.08));
        break;
      case "boss":
        this.blip("sawtooth", 90, 45, 1.2, 0.3 * vol);
        break;
      case "victory":
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.blip("triangle", f, f, 0.3, 0.2 * vol, i * 0.12));
        break;
      case "spike":
        this.noise(0.15, 0.15 * vol, 900);
        this.blip("square", 160, 60, 0.12, 0.1 * vol);
        break;
      case "burn":
        this.noise(0.2, 0.06 * vol, 1500);
        break;
      case "throw":
        this.noise(0.15, 0.08 * vol, 2500);
        break;
      case "freeze":
        this.blip("sine", 1800, 900, 0.25, 0.08 * vol);
        break;
      case "spit":
        this.blip("sine", 400, 150, 0.12, 0.1 * vol);
        break;
      case "warn":
        this.blip("square", 600, 600, 0.12, 0.1 * vol);
        this.blip("square", 600, 600, 0.12, 0.1 * vol, 0.18);
        break;
      case "horde":
        this.blip("sawtooth", 110, 80, 0.8, 0.2 * vol);
        break;
      case "bossRoar":
        this.blip("sawtooth", 140, 50, 1.0, 0.3 * vol);
        this.noise(0.8, 0.2 * vol, 600);
        break;
      case "stomp":
        this.blip("sine", 90, 35, 0.3, 0.35 * vol);
        break;
      case "defeat":
        [392, 330, 262, 196].forEach((f, i) => this.blip("triangle", f, f * 0.98, 0.35, 0.2 * vol, i * 0.18));
        break;
    }
  }

  /** start/stop background music. intensity 0 = calm, 1 = boss */
  music(on: boolean, _intensity = 0): void {
    void on;
  }

  private blip(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBuf: AudioBuffer | null = null;
  private noise(dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx!;
    if (!this.noiseBuf) {
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
