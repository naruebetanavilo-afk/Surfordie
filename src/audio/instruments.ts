// Music instruments. Drums and plucked/bass voices are pre-rendered samples
// (pitched with playbackRate), sustained pads and leads are synthesised live
// in Music.ts because they need per-note length and glide.
import type { SampleRecipe } from "./SampleBank";
import { type Voice, tone, noise, shaper, adsr, midiHz } from "./synth";

/** base MIDI note each melodic sample was rendered at */
export const SAMPLE_BASE: Record<string, number> = {
  bass: 38,
  bassHi: 50,
  bassB: 38,
  pluck: 62,
  pluckHi: 74,
  celesta: 74,
};

/** 808-style metallic noise: six detuned squares through band/high-pass */
function metal(v: Voice, dur: number, vol: number, hp: number): void {
  const c = v.c;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 10000;
  bp.Q.value = 0.8;
  const hpf = c.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(0, v.t);
  g.gain.linearRampToValueAtTime(vol, v.t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, v.t + dur);
  g.gain.linearRampToValueAtTime(0, v.t + dur + 0.004);
  bp.connect(hpf);
  hpf.connect(g);
  g.connect(v.out);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = f * 1.7;
    o.connect(bp);
    o.start(v.t);
    o.stop(v.t + dur + 0.02);
  }
}

function bassRecipe(v: Voice, f: number, dirty: boolean, dur: number): void {
  const c = v.c;
  const t = v.t;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = dirty ? 5 : 3.5;
  lp.frequency.setValueAtTime(dirty ? 3000 : 2200, t);
  lp.frequency.setTargetAtTime(dirty ? 800 : 560, t + 0.005, 0.12);
  const g = c.createGain();
  adsr(g.gain, t, 1, 0.004, 0.25, 0.65, t + dur - 0.2, 0.025);
  lp.connect(g);
  g.connect(dirty ? shaper(c, v.out, 3) : v.out);
  const dets = dirty ? [-10, 10] : [0];
  for (const d of dets) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.detune.value = d;
    o.connect(lp);
    o.start(t);
    o.stop(t + dur);
  }
  // clean sub keeps the low end solid; the saw harmonics carry on phone speakers
  const sub = c.createOscillator();
  sub.frequency.value = f;
  const sg = c.createGain();
  sg.gain.value = 0.32;
  sub.connect(sg);
  sg.connect(g);
  sub.start(t);
  sub.stop(t + dur);
}

function pluckRecipe(v: Voice, f: number): void {
  // pizzicato / marimba hybrid
  tone(v, { type: "triangle", f, dur: 0.75, vol: 0.8, a: 0.002, lp: 6000, lp1: 1500 });
  tone(v, { type: "square", f, dur: 0.12, vol: 0.12, a: 0.001, lp: 5000, lp1: 1200 });
  tone(v, { f: f * 2, dur: 0.25, vol: 0.3, a: 0.001 });
  tone(v, { f: f * 4.01, dur: 0.07, vol: 0.12, a: 0.001 });
  noise(v, { type: "bandpass", f: Math.min(f * 6, 12000), dur: 0.015, vol: 0.25, q: 2 });
}

function celestaRecipe(v: Voice, f: number): void {
  // music-box bell
  tone(v, { f, dur: 1.4, vol: 0.8, a: 0.002 });
  tone(v, { f: f * 2, dur: 0.8, vol: 0.2, a: 0.002 });
  tone(v, { f: f * 4, dur: 0.45, vol: 0.22, a: 0.001 });
  tone(v, { f: f * 5.43, dur: 0.15, vol: 0.08, a: 0.001 });
}

export const MUSIC_SAMPLES: Record<string, SampleRecipe> = {
  kick: {
    dur: 0.45,
    rate: 24000,
    render(v) {
      const sh = shaper(v.c, v.out, 1.8);
      tone(v, { f: 165, path: [[0.08, 52]], dur: 0.3, vol: 1, a: 0.0015, to: sh });
      tone(v, { type: "triangle", f: 330, f1: 110, glide: 0.06, dur: 0.1, vol: 0.45 });
      noise(v, { type: "highpass", f: 3000, dur: 0.014, vol: 0.5 });
    },
  },
  kickB: {
    dur: 0.55,
    rate: 24000,
    render(v) {
      const sh = shaper(v.c, v.out, 3.5);
      tone(v, { f: 150, path: [[0.1, 44]], dur: 0.52, vol: 1, a: 0.0015, to: sh });
      tone(v, { type: "square", f: 300, f1: 90, glide: 0.05, dur: 0.07, vol: 0.25, lp: 2000 });
      noise(v, { type: "lowpass", f: 2500, f1: 200, dur: 0.12, vol: 0.5 });
    },
  },
  snare: {
    dur: 0.28,
    render(v) {
      tone(v, { type: "triangle", f: 230, f1: 175, dur: 0.1, vol: 0.6 });
      noise(v, { type: "bandpass", f: 2100, dur: 0.22, vol: 0.9, q: 0.7 });
      noise(v, { type: "highpass", f: 6000, dur: 0.09, vol: 0.35 });
    },
  },
  clap: {
    dur: 0.3,
    render(v) {
      for (let i = 0; i < 3; i++) noise(v, { type: "bandpass", f: 1300, dur: 0.014, vol: 0.9, q: 1.8, at: i * 0.011 });
      noise(v, { type: "bandpass", f: 1250, dur: 0.22, vol: 0.7, q: 1.5, at: 0.033 });
    },
  },
  hat: {
    dur: 0.07,
    variants: 2,
    render(v) {
      metal(v, 0.05, 0.9, 7500);
      noise(v, { type: "highpass", f: 8000, dur: 0.04, vol: 0.3 });
    },
  },
  ohat: {
    dur: 0.4,
    render(v) {
      metal(v, 0.36, 0.9, 6500);
      noise(v, { type: "highpass", f: 7000, dur: 0.3, vol: 0.25, a: 0.002 });
    },
  },
  tom: {
    dur: 0.42,
    rate: 24000,
    render(v) {
      tone(v, { f: 160, f1: 100, glide: 0.18, dur: 0.38, vol: 1, a: 0.002 });
      tone(v, { type: "triangle", f: 320, f1: 200, glide: 0.1, dur: 0.12, vol: 0.25 });
      noise(v, { type: "lowpass", f: 1500, dur: 0.05, vol: 0.3 });
    },
  },
  crash: {
    dur: 1.6,
    render(v) {
      metal(v, 1.5, 0.7, 4500);
      noise(v, { type: "highpass", f: 4000, dur: 1.4, vol: 0.6, a: 0.002 });
      noise(v, { type: "bandpass", f: 6000, dur: 0.4, vol: 0.3, q: 1 });
    },
  },
  bone: {
    dur: 0.13,
    render(v) {
      // skeleton xylophone / woodblock click
      tone(v, { f: 1050, dur: 0.09, vol: 0.8, a: 0.001 });
      tone(v, { f: 1050 * 2.76, dur: 0.04, vol: 0.3, a: 0.001 });
      noise(v, { type: "bandpass", f: 3000, dur: 0.012, vol: 0.4, q: 1.5 });
    },
  },
  riser: {
    dur: 1.7,
    render(v) {
      noise(v, { type: "bandpass", f: 250, f1: 7000, dur: 1.6, vol: 1, q: 3.5, a: 1.55 });
      tone(v, { type: "sawtooth", f: 80, f1: 640, glide: 1.6, dur: 1.6, vol: 0.12, a: 1.5, lp: 2000 });
    },
  },
  bass: { dur: 1.1, rate: 24000, render: (v) => bassRecipe(v, midiHz(38), false, 1.1) },
  bassHi: { dur: 1.0, rate: 24000, render: (v) => bassRecipe(v, midiHz(50), false, 1.0) },
  bassB: { dur: 1.0, rate: 24000, render: (v) => bassRecipe(v, midiHz(38), true, 1.0) },
  pluck: { dur: 0.9, render: (v) => pluckRecipe(v, midiHz(62)) },
  pluckHi: { dur: 0.8, render: (v) => pluckRecipe(v, midiHz(74)) },
  celesta: { dur: 1.5, render: (v) => celestaRecipe(v, midiHz(74)) },
};

/** samples the run theme cannot start without */
export const MUSIC_CORE = ["kick", "snare", "hat", "bass", "bassHi", "pluck", "pluckHi"];

/** Hammond-ish drawbar organ; fundamental of the wave is the 16' sub-octave. */
export function organWave(c: BaseAudioContext): PeriodicWave {
  const imag = new Float32Array([0, 0.55, 1.0, 0.45, 0.6, 0, 0.25, 0, 0.3]);
  const real = new Float32Array(imag.length);
  return c.createPeriodicWave(real, imag);
}
