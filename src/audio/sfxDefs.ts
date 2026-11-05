// Procedural sound-effect recipes + per-sound mixing/voice rules.
// Each recipe is rendered once (several random variants for frequent sounds)
// into an AudioBuffer by SampleBank; playback is then a single buffer source
// with pitch jitter, so dense combat costs almost nothing.
import { type Voice, tone, noise, shaper, lfo, midiHz } from "./synth";

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
  | "stomp"
  // added by the audio pass
  | "evolve"
  | "nuke"
  | "bossDie";

export interface SfxDef {
  /** render length in seconds */
  dur: number;
  /** pre-rendered random variants (frequent sounds get several) */
  variants: number;
  /** render sample rate (lower for bass-heavy sounds to save memory) */
  rate: number;
  /** minimum seconds between two plays of this sound */
  gap: number;
  /** max simultaneous voices of this sound */
  max: number;
  /** 0 = combat spam … 3 = stinger; higher may steal lower voices */
  prio: number;
  /** random pitch spread, ± semitones */
  jitter: number;
  /** base output gain */
  vol: number;
  /** how strongly rapid repeats are attenuated (0 = never) */
  dense: number;
  /** how much the music ducks under this sound (0..1) */
  duck: number;
  render(v: Voice): void;
}

type Spec = Partial<Omit<SfxDef, "render" | "dur">> & Pick<SfxDef, "render" | "dur">;
const def = (s: Spec): SfxDef => ({
  variants: 1,
  rate: 32000,
  gap: 0.05,
  max: 2,
  prio: 1,
  jitter: 0,
  vol: 0.5,
  dense: 0,
  duck: 0,
  ...s,
});

/** small random spread factor around 1 */
const spread = (v: Voice, amt: number): number => 1 + (v.r() - 0.5) * amt;

/** brassy note: detuned saw pair through a closing lowpass */
function brass(v: Voice, m: number, at: number, dur: number, vol: number): void {
  const f = midiHz(m);
  for (const det of [-7, 7]) {
    tone(v, { type: "sawtooth", f, detune: det, dur, vol, a: 0.025, at, lp: 2800, lp1: 700, q: 1.2 });
  }
  tone(v, { type: "square", f: f / 2, dur: dur * 0.8, vol: vol * 0.5, a: 0.02, at, lp: 900 });
}

export const SFX: Record<SfxName, SfxDef> = {
  // ------------------------------------------------------------- combat --
  hit: def({
    dur: 0.13,
    variants: 4,
    gap: 0.03,
    max: 4,
    prio: 0,
    jitter: 1.2,
    vol: 0.42,
    dense: 0.25,
    render(v) {
      const k = spread(v, 0.18);
      tone(v, { f: 230 * k, f1: 70, glide: 0.07, dur: 0.1, vol: 0.9, a: 0.001 });
      tone(v, { type: "triangle", f: 560 * k, f1: 240, dur: 0.045, vol: 0.35, a: 0.001 });
      noise(v, { type: "bandpass", f: 2600 * k, f1: 1100, dur: 0.035, vol: 0.55, q: 1.1, a: 0.0005 });
    },
  }),
  crit: def({
    dur: 0.32,
    variants: 3,
    gap: 0.05,
    max: 3,
    prio: 1,
    jitter: 1,
    vol: 0.5,
    dense: 0.2,
    render(v) {
      const k = spread(v, 0.12);
      const d = shaper(v.c, v.out, 2.5);
      tone(v, { f: 300 * k, f1: 65, glide: 0.09, dur: 0.14, vol: 1, a: 0.001, to: d });
      noise(v, { type: "highpass", f: 2800, dur: 0.06, vol: 0.6, a: 0.0005 });
      const b = 2093 * k;
      tone(v, { f: b, dur: 0.28, vol: 0.22, a: 0.002, at: 0.005 });
      tone(v, { f: b * 1.505, dur: 0.2, vol: 0.14, a: 0.002, at: 0.005 });
      tone(v, { f: b * 2.76, dur: 0.12, vol: 0.08, a: 0.002, at: 0.005 });
      tone(v, { type: "square", f: 1046 * k, f1: 1568 * k, glide: 0.03, dur: 0.06, vol: 0.12, lp: 4000 });
    },
  }),
  kill: def({
    dur: 0.2,
    variants: 4,
    gap: 0.04,
    max: 4,
    prio: 0,
    jitter: 1.5,
    vol: 0.4,
    dense: 0.3,
    render(v) {
      const k = 0.85 + v.r() * 0.3;
      // cartoon "splorp": tiny pop, deflating bloop, resonant squelch
      tone(v, { type: "triangle", f: 900 * k, f1: 1500 * k, glide: 0.015, dur: 0.025, vol: 0.25 });
      tone(v, { f: 540 * k, f1: 130 * k, glide: 0.1, dur: 0.13, vol: 0.75, a: 0.002, at: 0.008 });
      noise(v, { type: "lowpass", f: 2600 * k, f1: 280, dur: 0.15, vol: 0.65, q: 5, a: 0.002 });
    },
  }),
  slash: def({
    dur: 0.24,
    variants: 3,
    gap: 0.06,
    max: 3,
    prio: 1,
    jitter: 1.2,
    vol: 0.42,
    dense: 0.2,
    render(v) {
      const k = spread(v, 0.2);
      noise(v, { type: "bandpass", f: 600 * k, path: [[0.07, 4800 * k], [0.19, 1400 * k]], dur: 0.2, vol: 0.85, q: 1.6, a: 0.035 });
      noise(v, { type: "highpass", f: 5000, dur: 0.1, vol: 0.18, a: 0.03, at: 0.03 });
      tone(v, { f: 3520 * k, dur: 0.09, vol: 0.05, at: 0.05 });
    },
  }),
  zap: def({
    dur: 0.18,
    variants: 3,
    gap: 0.05,
    max: 3,
    prio: 1,
    jitter: 1.5,
    vol: 0.34,
    dense: 0.25,
    render(v) {
      const k = spread(v, 0.2);
      const bp = v.c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400;
      bp.Q.value = 0.8;
      bp.connect(v.out);
      const car = tone(v, { type: "sawtooth", f: 1700 * k, f1: 380 * k, glide: 0.12, dur: 0.14, vol: 0.8, a: 0.001, to: bp });
      // square-wave FM gives the electric buzz
      const mod = v.c.createOscillator();
      mod.type = "square";
      mod.frequency.value = 60 + v.r() * 50;
      const mg = v.c.createGain();
      mg.gain.setValueAtTime(500 * k, v.t);
      mg.gain.exponentialRampToValueAtTime(90, v.t + 0.12);
      mod.connect(mg);
      mg.connect(car.frequency);
      mod.start(v.t);
      mod.stop(v.t + 0.17);
      noise(v, { type: "highpass", f: 4500, dur: 0.06, vol: 0.35 });
    },
  }),
  boom: def({
    dur: 0.95,
    variants: 3,
    rate: 24000,
    gap: 0.07,
    max: 3,
    prio: 1,
    jitter: 1.5,
    vol: 0.62,
    dense: 0.35,
    duck: 0.12,
    render(v) {
      const d = shaper(v.c, v.out, 2);
      tone(v, { f: 125, f1: 36, glide: 0.38, dur: 0.6, vol: 1, a: 0.002, to: d });
      noise(v, { type: "bandpass", f: 1800, dur: 0.06, vol: 0.8, q: 0.6, a: 0.0005 });
      noise(v, { type: "lowpass", f: 2200, f1: 110, dur: 0.85, vol: 0.95, q: 0.9, a: 0.004, rate: 0.6 + v.r() * 0.2 });
      for (let i = 0; i < 4; i++) noise(v, { type: "highpass", f: 2500, dur: 0.02, vol: 0.12 + 0.2 * v.r(), at: 0.08 + v.r() * 0.35 });
    },
  }),
  whoosh: def({
    dur: 0.38,
    variants: 2,
    gap: 0.12,
    max: 2,
    prio: 0,
    jitter: 1,
    vol: 0.32,
    dense: 0.2,
    render(v) {
      const k = 0.85 + v.r() * 0.3;
      noise(v, { type: "bandpass", f: 320 * k, path: [[0.15, 1700 * k], [0.34, 450 * k]], dur: 0.36, vol: 0.7, q: 2.2, a: 0.11 });
    },
  }),
  thunder: def({
    dur: 1.2,
    variants: 2,
    rate: 24000,
    gap: 0.1,
    max: 2,
    prio: 1,
    jitter: 1.5,
    vol: 0.55,
    dense: 0.3,
    duck: 0.15,
    render(v) {
      noise(v, { type: "highpass", f: 2200, dur: 0.09, vol: 1, a: 0.0005 });
      tone(v, { type: "sawtooth", f: 2600, f1: 160, glide: 0.07, dur: 0.08, vol: 0.35, lp: 5000 });
      // rumble with a flutter so it reads as rolling thunder
      const am = v.c.createGain();
      am.gain.value = 0.6;
      am.connect(v.out);
      lfo(v, am.gain, 9 + v.r() * 6, 0.4, 1.1, "triangle");
      noise(v, { type: "lowpass", f: 1100, f1: 140, dur: 1.1, vol: 0.9, q: 0.8, a: 0.02, at: 0.02, rate: 0.5, to: am });
      tone(v, { f: 60, f1: 38, dur: 0.6, vol: 0.5, at: 0.01 });
    },
  }),
  spike: def({
    dur: 0.26,
    variants: 3,
    gap: 0.06,
    max: 3,
    prio: 1,
    jitter: 1.2,
    vol: 0.42,
    dense: 0.25,
    render(v) {
      const k = spread(v, 0.2);
      noise(v, { type: "bandpass", f: 1500 * k, dur: 0.06, vol: 0.9, q: 1.4, a: 0.0005 });
      tone(v, { f: 170 * k, f1: 55, dur: 0.16, vol: 0.85 });
      noise(v, { type: "highpass", f: 5200, dur: 0.13, vol: 0.22, at: 0.012 });
      tone(v, { f: 1245 * k, dur: 0.12, vol: 0.1, at: 0.01 });
      tone(v, { f: 1867 * k, dur: 0.09, vol: 0.07, at: 0.01 });
    },
  }),
  burn: def({
    dur: 0.45,
    variants: 3,
    gap: 0.09,
    max: 2,
    prio: 0,
    jitter: 1.5,
    vol: 0.36,
    dense: 0.3,
    render(v) {
      const k = 0.85 + v.r() * 0.3;
      noise(v, { type: "lowpass", f: 800 * k, path: [[0.12, 2600 * k], [0.4, 600 * k]], dur: 0.42, vol: 0.75, q: 1.2, a: 0.07 });
      for (let i = 0; i < 6; i++) {
        noise(v, { type: "highpass", f: 2500 + v.r() * 2500, dur: 0.008 + v.r() * 0.01, vol: 0.25 + v.r() * 0.35, at: 0.02 + v.r() * 0.35 });
      }
    },
  }),
  throw: def({
    dur: 0.16,
    variants: 3,
    gap: 0.06,
    max: 3,
    prio: 0,
    jitter: 1.5,
    vol: 0.34,
    dense: 0.2,
    render(v) {
      const k = 0.85 + v.r() * 0.3;
      noise(v, { type: "bandpass", f: 800 * k, f1: 3400 * k, dur: 0.13, vol: 0.75, q: 2.6, a: 0.015 });
      tone(v, { f: 420 * k, f1: 760 * k, dur: 0.07, vol: 0.12 });
    },
  }),
  freeze: def({
    dur: 0.65,
    variants: 2,
    gap: 0.15,
    max: 2,
    prio: 1,
    jitter: 1,
    vol: 0.4,
    dense: 0.2,
    render(v) {
      noise(v, { type: "highpass", f: 6000, dur: 0.045, vol: 0.8, a: 0.0005 });
      const fs = [2349, 2794, 3520, 4186];
      for (let i = 0; i < fs.length; i++) tone(v, { f: fs[i] * spread(v, 0.012), dur: 0.55 - i * 0.07, vol: 0.18, at: i * 0.025 });
      tone(v, { f: 4200, f1: 1900, glide: 0.2, dur: 0.22, vol: 0.08 });
      noise(v, { type: "bandpass", f: 9000, dur: 0.4, vol: 0.12, q: 3, a: 0.05, at: 0.03 });
    },
  }),
  spit: def({
    dur: 0.22,
    variants: 2,
    gap: 0.08,
    max: 3,
    prio: 1,
    jitter: 1.5,
    vol: 0.36,
    dense: 0.2,
    render(v) {
      const k = spread(v, 0.2);
      tone(v, { type: "triangle", f: 240, f1: 120, dur: 0.05, vol: 0.3 });
      tone(v, { f: 650 * k, f1: 190 * k, dur: 0.17, vol: 0.6, vib: 34, vibDepth: 180 });
      noise(v, { type: "lowpass", f: 1400 * k, f1: 350, dur: 0.13, vol: 0.45, q: 7 });
    },
  }),
  stomp: def({
    dur: 0.5,
    variants: 2,
    rate: 24000,
    gap: 0.12,
    max: 2,
    prio: 2,
    jitter: 1,
    vol: 0.62,
    duck: 0.15,
    render(v) {
      const sh = shaper(v.c, v.out, 2.5);
      tone(v, { f: 85, f1: 30, glide: 0.28, dur: 0.45, vol: 1, a: 0.002, to: sh });
      noise(v, { type: "lowpass", f: 700, f1: 90, dur: 0.35, vol: 0.75, q: 1 });
      noise(v, { type: "bandpass", f: 1300, dur: 0.045, vol: 0.45, q: 1 });
      for (let i = 0; i < 3; i++) noise(v, { type: "bandpass", f: 1800 + v.r() * 1500, dur: 0.02, vol: 0.2, at: 0.06 + v.r() * 0.2, q: 2 });
    },
  }),
  hurt: def({
    dur: 0.3,
    gap: 0.15,
    max: 1,
    prio: 2,
    jitter: 1,
    vol: 0.55,
    duck: 0.15,
    render(v) {
      const d = shaper(v.c, v.out, 3);
      tone(v, { type: "sawtooth", f: 340, f1: 85, glide: 0.18, dur: 0.22, vol: 0.55, lp: 2200, lp1: 400, to: d });
      tone(v, { f: 120, f1: 50, dur: 0.22, vol: 0.7 });
      noise(v, { type: "lowpass", f: 3500, f1: 500, dur: 0.12, vol: 0.55 });
    },
  }),

  // ------------------------------------------------------------ pickups --
  xp: def({
    dur: 0.14,
    gap: 0.045,
    max: 3,
    prio: 0,
    vol: 0.28,
    dense: 0.15,
    render(v) {
      // base D6; the pickup chain raises it along a minor pentatonic
      tone(v, { type: "triangle", f: 1109, f1: 1175, glide: 0.012, dur: 0.11, vol: 0.55, a: 0.001 });
      tone(v, { f: 2350, dur: 0.06, vol: 0.22, a: 0.001 });
      tone(v, { f: 3525, dur: 0.035, vol: 0.08, a: 0.001 });
    },
  }),
  coin: def({
    dur: 0.38,
    gap: 0.06,
    max: 2,
    prio: 1,
    jitter: 0.3,
    vol: 0.36,
    dense: 0.3,
    render(v) {
      tone(v, { type: "square", f: 988, dur: 0.075, vol: 0.3, lp: 5000, a: 0.001 });
      tone(v, { type: "square", f: 1319, dur: 0.28, vol: 0.3, lp: 5000, lp1: 2000, a: 0.001, at: 0.07 });
      tone(v, { f: 2637, dur: 0.25, vol: 0.18, at: 0.07 });
      tone(v, { f: 3951, dur: 0.12, vol: 0.08, at: 0.07 });
    },
  }),
  heal: def({
    dur: 0.85,
    gap: 0.1,
    max: 1,
    prio: 2,
    vol: 0.45,
    duck: 0.1,
    render(v) {
      tone(v, { f: 300, f1: 620, glide: 0.25, dur: 0.3, vol: 0.25, a: 0.03 });
      const ns = [81, 85, 88, 93];
      for (let i = 0; i < ns.length; i++) tone(v, { type: "triangle", f: midiHz(ns[i]), dur: 0.4, vol: 0.28, at: 0.04 + i * 0.06 });
      tone(v, { f: midiHz(93), dur: 0.6, vol: 0.12, a: 0.05, at: 0.25, vib: 7, vibDepth: 15 });
      noise(v, { type: "highpass", f: 7000, dur: 0.5, vol: 0.1, a: 0.12, at: 0.05 });
    },
  }),
  magnet: def({
    dur: 0.85,
    gap: 0.2,
    max: 1,
    prio: 2,
    vol: 0.45,
    duck: 0.1,
    render(v) {
      tone(v, { type: "triangle", f: 170, f1: 1400, glide: 0.5, dur: 0.55, vol: 0.45, a: 0.05, vib: 14, vibDepth: 60 });
      tone(v, { f: 340, f1: 2800, glide: 0.5, dur: 0.5, vol: 0.18, a: 0.05 });
      tone(v, { f: 2093, dur: 0.2, vol: 0.18, at: 0.48 });
      tone(v, { f: 2637, dur: 0.25, vol: 0.18, at: 0.54 });
    },
  }),
  chest: def({
    dur: 1.55,
    gap: 0.3,
    max: 1,
    prio: 3,
    vol: 0.55,
    duck: 0.4,
    render(v) {
      // creaky lid, thunk, then a sparkling treasure arpeggio
      tone(v, { type: "sawtooth", f: 85, f1: 150, glide: 0.32, dur: 0.34, vol: 0.4, lp: 700, q: 9, a: 0.03, vib: 9, vibDepth: 80 });
      tone(v, { f: 170, f1: 60, dur: 0.18, vol: 0.7, at: 0.3 });
      noise(v, { type: "lowpass", f: 1500, f1: 300, dur: 0.12, vol: 0.4, at: 0.3 });
      const ns = [74, 78, 81, 86, 90, 93];
      for (let i = 0; i < ns.length; i++) {
        const at = 0.36 + i * 0.05;
        tone(v, { type: "triangle", f: midiHz(ns[i]), dur: 0.45, vol: 0.26, at });
        tone(v, { f: midiHz(ns[i]) * 2, dur: 0.2, vol: 0.08, at });
      }
      for (const m of [86, 90, 93, 98]) tone(v, { f: midiHz(m), dur: 0.8, vol: 0.12, a: 0.04, at: 0.68, vib: 6, vibDepth: 10 });
      noise(v, { type: "highpass", f: 6500, dur: 0.8, vol: 0.12, a: 0.2, at: 0.4 });
    },
  }),
  nuke: def({
    dur: 1.5,
    rate: 24000,
    gap: 0.3,
    max: 1,
    prio: 3,
    vol: 0.7,
    duck: 0.5,
    render(v) {
      const sh = shaper(v.c, v.out, 3);
      tone(v, { f: 90, f1: 28, glide: 0.8, dur: 1.2, vol: 1, a: 0.003, to: sh });
      noise(v, { type: "lowpass", f: 4000, f1: 80, dur: 1.4, vol: 1, q: 0.7, a: 0.003, rate: 0.5 });
      noise(v, { type: "highpass", f: 3000, f1: 8000, dur: 0.4, vol: 0.4 });
      tone(v, { type: "sawtooth", f: 1200, f1: 60, glide: 0.5, dur: 0.6, vol: 0.2, lp: 3000, lp1: 200 });
    },
  }),

  // ----------------------------------------------------------------- UI --
  levelup: def({
    dur: 1.25,
    gap: 0.2,
    max: 1,
    prio: 3,
    vol: 0.55,
    duck: 0.45,
    render(v) {
      tone(v, { type: "triangle", f: 300, f1: 1200, glide: 0.25, dur: 0.3, vol: 0.25, a: 0.02 });
      const ns = [74, 78, 81, 86, 90];
      for (let i = 0; i < ns.length; i++) {
        const at = 0.05 + i * 0.065;
        tone(v, { type: "square", f: midiHz(ns[i]), dur: 0.22, vol: 0.18, lp: 3500, lp1: 1500, at });
        tone(v, { type: "triangle", f: midiHz(ns[i]), dur: 0.3, vol: 0.3, at });
      }
      for (const m of [86, 90, 93]) tone(v, { type: "triangle", f: midiHz(m), dur: 0.75, vol: 0.2, a: 0.02, at: 0.38, vib: 6, vibDepth: 12 });
      noise(v, { type: "highpass", f: 6000, dur: 0.6, vol: 0.12, a: 0.15, at: 0.3 });
    },
  }),
  evolve: def({
    dur: 1.8,
    gap: 0.5,
    max: 1,
    prio: 3,
    vol: 0.6,
    duck: 0.5,
    render(v) {
      // reverse swell into a big shimmering major chord
      noise(v, { type: "bandpass", f: 300, f1: 7000, dur: 0.66, vol: 0.6, q: 3, a: 0.6 });
      tone(v, { type: "sawtooth", f: 150, f1: 1200, glide: 0.6, dur: 0.62, vol: 0.18, a: 0.55, lp: 3000 });
      tone(v, { f: 110, f1: 45, dur: 0.5, vol: 0.9, at: 0.62 });
      for (const m of [74, 78, 81, 86, 88]) {
        tone(v, { type: "triangle", f: midiHz(m), dur: 1.1, vol: 0.2, a: 0.01, at: 0.62, vib: 5.5, vibDepth: 10 });
        tone(v, { type: "square", f: midiHz(m), dur: 0.5, vol: 0.06, lp: 3000, lp1: 800, at: 0.62 });
      }
      noise(v, { type: "highpass", f: 6000, dur: 1.0, vol: 0.16, a: 0.05, at: 0.62 });
    },
  }),
  select: def({
    dur: 0.12,
    gap: 0.05,
    max: 2,
    prio: 2,
    vol: 0.4,
    render(v) {
      tone(v, { f: 620, f1: 1150, glide: 0.05, dur: 0.09, vol: 0.6, a: 0.002 });
      tone(v, { type: "triangle", f: 1240, dur: 0.035, vol: 0.2, at: 0.02 });
    },
  }),
  deny: def({
    dur: 0.32,
    gap: 0.1,
    max: 1,
    prio: 2,
    vol: 0.4,
    render(v) {
      tone(v, { type: "square", f: 233, dur: 0.1, vol: 0.35, lp: 1400, a: 0.002 });
      tone(v, { type: "square", f: 185, dur: 0.16, vol: 0.35, lp: 1400, lp1: 600, a: 0.002, at: 0.12 });
    },
  }),
  warn: def({
    dur: 0.45,
    gap: 0.25,
    max: 1,
    prio: 2,
    vol: 0.4,
    duck: 0.15,
    render(v) {
      // "dee-doo dee-doo" alarm
      for (let i = 0; i < 4; i++) {
        const hi = (i & 1) === 0;
        tone(v, { type: "square", f: hi ? 932 : 698, dur: 0.09, vol: 0.3, lp: hi ? 3000 : 2200, a: 0.004, at: i * 0.1 });
      }
    },
  }),

  // ------------------------------------------------------------ stingers --
  horde: def({
    dur: 1.7,
    rate: 24000,
    gap: 0.4,
    max: 2,
    prio: 2,
    vol: 0.55,
    duck: 0.3,
    render(v) {
      // crowd of groaning voices through "oh" formants, plus a war drum
      const f1 = v.c.createBiquadFilter();
      f1.type = "bandpass";
      f1.frequency.value = 450;
      f1.Q.value = 3;
      f1.connect(v.out);
      const f2 = v.c.createBiquadFilter();
      f2.type = "bandpass";
      f2.frequency.value = 820;
      f2.Q.value = 4;
      f2.connect(v.out);
      for (let i = 0; i < 6; i++) {
        const f = 75 + v.r() * 70;
        tone(v, { type: "sawtooth", f, f1: f * (0.82 + v.r() * 0.1), dur: 1.5, vol: 0.22, a: 0.35 + v.r() * 0.2, at: v.r() * 0.25, to: i & 1 ? f1 : f2, vib: 3 + v.r() * 3, vibDepth: 25 });
      }
      tone(v, { f: 70, f1: 42, dur: 0.6, vol: 0.9 });
      noise(v, { type: "lowpass", f: 500, dur: 0.5, vol: 0.4 });
    },
  }),
  boss: def({
    dur: 1.95,
    rate: 24000,
    gap: 0.5,
    max: 1,
    prio: 3,
    vol: 0.55,
    duck: 0.5,
    render(v) {
      // ominous tritone brass swell with timpani
      const lp = v.c.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(250, v.t);
      lp.frequency.exponentialRampToValueAtTime(1600, v.t + 0.5);
      lp.frequency.exponentialRampToValueAtTime(400, v.t + 1.8);
      lp.connect(v.out);
      for (const m of [38, 44, 50]) for (const det of [-9, 9]) tone(v, { type: "sawtooth", f: midiHz(m), detune: det, dur: 1.8, vol: 0.3, a: 0.25, to: lp });
      tone(v, { f: 95, f1: 62, dur: 0.7, vol: 0.9 });
      tone(v, { f: 95, f1: 62, dur: 0.7, vol: 0.7, at: 0.22 });
      noise(v, { type: "bandpass", f: 380, dur: 1.6, vol: 0.3, q: 2.5, a: 0.01 });
    },
  }),
  bossRoar: def({
    dur: 1.6,
    rate: 24000,
    gap: 0.5,
    max: 1,
    prio: 3,
    jitter: 0.5,
    vol: 0.65,
    duck: 0.5,
    render(v) {
      const sh = shaper(v.c, v.out, 4);
      const am = v.c.createGain();
      am.gain.value = 0.65;
      am.connect(sh);
      lfo(v, am.gain, 27, 0.35, 1.5, "triangle");
      const f1 = v.c.createBiquadFilter();
      f1.type = "bandpass";
      f1.Q.value = 2.5;
      f1.frequency.setValueAtTime(380, v.t);
      f1.frequency.linearRampToValueAtTime(720, v.t + 0.35);
      f1.frequency.exponentialRampToValueAtTime(300, v.t + 1.45);
      f1.connect(am);
      for (const det of [-15, 0, 15]) tone(v, { type: "sawtooth", f: 118, path: [[0.3, 128], [1.4, 64]], dur: 1.45, vol: 0.5, a: 0.07, detune: det, to: f1 });
      noise(v, { type: "bandpass", f: 1100, f1: 400, dur: 1.3, vol: 0.6, q: 1.2, a: 0.06, to: am });
      tone(v, { f: 55, f1: 40, dur: 1.2, vol: 0.6, a: 0.05 });
    },
  }),
  bossDie: def({
    dur: 2.2,
    rate: 24000,
    gap: 0.5,
    max: 1,
    prio: 3,
    vol: 0.65,
    duck: 0.6,
    render(v) {
      // collapsing roar into a huge boom and a bright victory chime
      const sh = shaper(v.c, v.out, 3);
      tone(v, { type: "sawtooth", f: 140, path: [[0.5, 45]], dur: 0.6, vol: 0.5, lp: 900, lp1: 200, to: sh });
      tone(v, { f: 80, f1: 26, glide: 0.9, dur: 1.3, vol: 1, a: 0.003, at: 0.25, to: sh });
      noise(v, { type: "lowpass", f: 3000, f1: 90, dur: 1.5, vol: 0.9, a: 0.003, at: 0.25, rate: 0.5 });
      const ns = [74, 78, 81, 86];
      for (let i = 0; i < ns.length; i++) tone(v, { type: "triangle", f: midiHz(ns[i]), dur: 0.9, vol: 0.22, at: 0.55 + i * 0.07, vib: 6, vibDepth: 10 });
      noise(v, { type: "highpass", f: 6500, dur: 1.2, vol: 0.14, a: 0.1, at: 0.55 });
    },
  }),
  victory: def({
    dur: 2.5,
    rate: 32000,
    gap: 1,
    max: 1,
    prio: 3,
    vol: 0.6,
    duck: 0.8,
    render(v) {
      // A A A | D— | F# E F# A | D-major chord
      const seq: [number, number, number][] = [
        [0, 69, 0.11], [0.12, 69, 0.11], [0.24, 69, 0.11], [0.38, 74, 0.3],
        [0.7, 78, 0.13], [0.85, 76, 0.13], [1.0, 78, 0.13], [1.15, 81, 0.15],
      ];
      for (const [at, m, d] of seq) brass(v, m, at, d + 0.12, 0.2);
      for (const m of [74, 78, 81, 86]) brass(v, m, 1.32, 1.1, 0.14);
      tone(v, { f: 98, f1: 60, dur: 0.6, vol: 0.8, at: 0.38 });
      tone(v, { f: 98, f1: 60, dur: 0.8, vol: 0.9, at: 1.32 });
      noise(v, { type: "highpass", f: 6000, dur: 1.0, vol: 0.14, a: 0.05, at: 1.32 });
    },
  }),
  defeat: def({
    dur: 2.6,
    rate: 24000,
    gap: 1,
    max: 1,
    prio: 3,
    vol: 0.55,
    duck: 0.8,
    render(v) {
      // slow sagging descent that never resolves
      const seq: [number, number, number][] = [[0, 69, 0.42], [0.45, 65, 0.42], [0.9, 62, 0.42], [1.35, 61, 1.1]];
      for (const [at, m, d] of seq) {
        const f = midiHz(m);
        const last = d > 1;
        tone(v, { type: "sawtooth", f, f1: last ? f * 0.96 : f, dur: d, vol: 0.28, a: 0.03, at, lp: 1200, lp1: 500, vib: 5, vibDepth: last ? 35 : 20 });
        tone(v, { type: "triangle", f: f / 2, f1: last ? f * 0.48 : f / 2, dur: d, vol: 0.2, a: 0.03, at });
      }
      tone(v, { f: midiHz(38), dur: 2.4, vol: 0.35, a: 0.3 });
      noise(v, { type: "bandpass", f: 200, dur: 1.2, vol: 0.2, q: 3, at: 1.35 });
    },
  }),
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];
