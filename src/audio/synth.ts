// Small procedural-synthesis toolkit shared by sound effects and music.
// Every helper builds plain WebAudio nodes on a BaseAudioContext, so the same
// recipe can run on the live AudioContext or be pre-rendered into a buffer by
// an OfflineAudioContext (see SampleBank). All envelopes start and end at zero
// and every source node is stopped, so nothing clicks and nothing leaks.

export type Rnd = () => number;

/** Deterministic PRNG (mulberry32) so pre-rendered variants are reproducible. */
export function mulberry32(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a recipe writes: context, destination node, start time, randomness. */
export interface Voice {
  c: BaseAudioContext;
  out: AudioNode;
  t: number;
  r: Rnd;
}

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------ shared data --

let noiseBuf: AudioBuffer | null = null;
/** 2 s of white noise, shared by every context (AudioBuffers are context-free). */
export function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  if (!noiseBuf) {
    const rate = 32000;
    const len = rate * 2;
    const b = c.createBuffer(1, len, rate);
    const d = b.getChannelData(0);
    const r = mulberry32(1234567);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    noiseBuf = b;
  }
  return noiseBuf;
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();
/** tanh soft-clip curve; `drive` 1 = gentle, 8 = crunchy. Cached per drive. */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  let cv = curves.get(drive);
  if (!cv) {
    const n = 1024;
    cv = new Float32Array(n);
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      cv[i] = Math.tanh(x * drive) / norm;
    }
    curves.set(drive, cv);
  }
  return cv;
}

/** WaveShaper soft clipper connected to `to`; connect sources into the result. */
export function shaper(c: BaseAudioContext, to: AudioNode, drive: number): WaveShaperNode {
  const w = c.createWaveShaper();
  w.curve = driveCurve(drive);
  w.oversample = "none";
  w.connect(to);
  return w;
}

// -------------------------------------------------------------- envelopes --

const SILENT = 0.0001;

/** Percussive envelope: 0 → peak in `a` seconds → exponential decay to silence at t+dur. */
export function perc(p: AudioParam, t: number, peak: number, a: number, dur: number): void {
  const pk = Math.max(peak, SILENT * 2);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.exponentialRampToValueAtTime(SILENT, t + Math.max(dur, a + 0.005));
  p.linearRampToValueAtTime(0, t + Math.max(dur, a + 0.005) + 0.004);
}

/**
 * Sustained envelope with smooth exponential tails:
 * attack (linear) → decay toward `sus` (fraction of peak) → release at `relT`.
 * Returns the time the voice is effectively silent (stop sources there).
 */
export function adsr(p: AudioParam, t: number, peak: number, a: number, decayTau: number, sus: number, relT: number, relTau: number): number {
  const rel = Math.max(relT, t + a + 0.001);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(peak * sus, t + a, decayTau);
  p.setTargetAtTime(0, rel, relTau);
  return rel + relTau * 7;
}

/** Multi-point frequency path: pairs of [timeOffset, hz] after the start value. */
export type Path = readonly (readonly [number, number])[];

function applyPath(p: AudioParam, t: number, f0: number, path: Path | undefined, f1: number | undefined, dur: number): void {
  p.setValueAtTime(f0, t);
  if (path) {
    for (const [dt, f] of path) p.exponentialRampToValueAtTime(Math.max(1, f), t + dt);
  } else if (f1 !== undefined && f1 !== f0) {
    p.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  }
}

// ---------------------------------------------------------------- sources --

export interface ToneOpts {
  type?: OscillatorType;
  wave?: PeriodicWave;
  f: number;
  /** end frequency (exponential glide over `glide` seconds, default whole note) */
  f1?: number;
  glide?: number;
  path?: Path;
  dur: number;
  vol: number;
  a?: number;
  /** start offset relative to v.t */
  at?: number;
  detune?: number;
  /** optional lowpass on this tone */
  lp?: number;
  lp1?: number;
  q?: number;
  /** vibrato: rate Hz, depth in cents */
  vib?: number;
  vibDepth?: number;
  to?: AudioNode;
}

/** Enveloped oscillator. */
export function tone(v: Voice, o: ToneOpts): OscillatorNode {
  const c = v.c;
  const t = v.t + (o.at ?? 0);
  const osc = c.createOscillator();
  if (o.wave) osc.setPeriodicWave(o.wave);
  else osc.type = o.type ?? "sine";
  applyPath(osc.frequency, t, o.f, o.path, o.f1, o.glide ?? o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = c.createGain();
  perc(g.gain, t, o.vol, o.a ?? 0.003, o.dur);
  if (o.lp) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    applyPath(f.frequency, t, o.lp, undefined, o.lp1, o.dur);
    f.Q.value = o.q ?? 0.7;
    osc.connect(f);
    f.connect(g);
  } else {
    osc.connect(g);
  }
  g.connect(o.to ?? v.out);
  let lfo: OscillatorNode | null = null;
  if (o.vib) {
    lfo = c.createOscillator();
    lfo.frequency.value = o.vib;
    const lg = c.createGain();
    lg.gain.value = o.vibDepth ?? 30;
    lfo.connect(lg);
    lg.connect(osc.detune);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.03);
  }
  osc.start(t);
  osc.stop(t + o.dur + 0.03);
  return osc;
}

export interface NoiseOpts {
  dur: number;
  vol: number;
  type?: BiquadFilterType;
  f: number;
  f1?: number;
  path?: Path;
  q?: number;
  a?: number;
  at?: number;
  to?: AudioNode;
  /** playback rate of the noise buffer (lower = darker, grainier) */
  rate?: number;
}

/** Enveloped filtered noise burst. */
export function noise(v: Voice, o: NoiseOpts): AudioBufferSourceNode {
  const c = v.c;
  const t = v.t + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const f = c.createBiquadFilter();
  f.type = o.type ?? "lowpass";
  applyPath(f.frequency, t, o.f, o.path, o.f1, o.dur);
  f.Q.value = o.q ?? 0.7;
  const g = c.createGain();
  perc(g.gain, t, o.vol, o.a ?? 0.002, o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(o.to ?? v.out);
  src.start(t, v.r() * 1.5);
  src.stop(t + o.dur + 0.03);
  return src;
}

/** Plain gain node into `to` (mixing helper). */
export function bus(c: BaseAudioContext, to: AudioNode, gain = 1): GainNode {
  const g = c.createGain();
  g.gain.value = gain;
  g.connect(to);
  return g;
}

/** Low-frequency oscillator modulating `param` around its value; auto-stopped. */
export function lfo(v: Voice, param: AudioParam, rate: number, depth: number, dur: number, type: OscillatorType = "sine", at = 0): void {
  const o = v.c.createOscillator();
  o.type = type;
  o.frequency.value = rate;
  const g = v.c.createGain();
  g.gain.value = depth;
  o.connect(g);
  g.connect(param);
  o.start(v.t + at);
  o.stop(v.t + at + dur + 0.03);
}

// ------------------------------------------------------- offline rendering --

type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

export function offlineCtor(): OfflineCtor | null {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null;
}

/** startRendering() that also works on old Safari (event-based API). */
export function renderOffline(oc: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    oc.oncomplete = (e) => resolve(e.renderedBuffer);
    try {
      const p = oc.startRendering() as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === "function") p.then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Peak-normalise, trim trailing silence and fade the last few ms so a
 * pre-rendered buffer always starts/ends cleanly. Returns a (possibly
 * shorter) buffer.
 */
export function finishBuffer(c: BaseAudioContext, b: AudioBuffer, peakTarget: number): AudioBuffer {
  const d = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) {
    const a = d[i] < 0 ? -d[i] : d[i];
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return b;
  const k = peakTarget / peak;
  const floor = peak * 0.0006;
  let last = d.length - 1;
  while (last > 0 && Math.abs(d[last]) < floor) last--;
  const fade = Math.min(Math.floor(b.sampleRate * 0.006), last);
  const len = Math.min(d.length, last + 2);
  const out = len < d.length - b.sampleRate * 0.01 ? c.createBuffer(1, len, b.sampleRate) : b;
  const o = out.getChannelData(0);
  for (let i = 0; i < len; i++) o[i] = d[i] * k;
  for (let i = len; i < o.length; i++) o[i] = 0;
  for (let i = 0; i < fade; i++) o[len - 1 - i] *= i / fade;
  return out;
}
