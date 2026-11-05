// Generative background music: a spooky-but-playful minor-key groove built
// from a 16th-note step sequencer that is driven by a lookahead scheduler
// (AudioSys calls schedule() every ~30 ms with now + lookahead).
//
// Variety without obvious loops:
//  - every 4-bar phrase picks a new chord progression, energy level, groove
//    patterns, arp style and lead instrument;
//  - a 2-bar melodic hook is generated, answered with a variation, and is
//    re-used (re-harmonised) in later phrases so the tune stays catchy;
//  - fills, breakdowns, crashes and percussion accents are randomised.
// Modes: "menu" (slow music-box lullaby), "run" intensity 0 (main groove),
// "run" intensity 1 (boss: faster, heavier drums, distorted bass, choir).
import { midiHz, adsr } from "./synth";
import type { SampleBank, Reaper } from "./SampleBank";
import { SAMPLE_BASE, organWave } from "./instruments";

export type MusicMode = "menu" | "run";

interface Chord {
  /** bass root (MIDI) */
  root: number;
  /** chord-tone pitch classes, root first */
  pcs: readonly number[];
  /** scale alteration while this chord plays: [fromPc, toPc] */
  alter?: readonly [number, number];
}

const CH: Record<string, Chord> = {
  Dm: { root: 38, pcs: [2, 5, 9] },
  Gm: { root: 43, pcs: [7, 10, 2] },
  Bb: { root: 46, pcs: [10, 2, 5] },
  A: { root: 45, pcs: [9, 1, 4], alter: [0, 1] },
  A7: { root: 45, pcs: [9, 1, 4, 7], alter: [0, 1] },
  C: { root: 48, pcs: [0, 4, 7] },
  F: { root: 41, pcs: [5, 9, 0] },
  Eb: { root: 39, pcs: [3, 7, 10], alter: [4, 3] },
  Edim: { root: 40, pcs: [4, 7, 10] },
};

const prog = (names: string): Chord[] => names.split(" ").map((n) => CH[n]);
const PROG_RUN = ["Dm Bb Gm A", "Dm Gm Bb A", "Dm C Bb A", "Dm Eb Dm A", "Gm Dm Eb A", "Dm F Gm A7", "Dm Bb Edim A", "Bb Gm Dm A7"].map(prog);
const PROG_BOSS = ["Dm Dm Eb Dm", "Dm Bb Eb A", "Dm Eb C A", "Gm Eb Dm A7", "Dm Dm Bb A"].map(prog);
const PROG_MENU = ["Dm Gm A Dm", "Dm Bb Gm A", "F C Dm A", "Dm Edim Dm A7"].map(prog);

// D natural minor, MIDI 60..88 (melody range)
const SCALE: number[] = [];
for (let m = 60; m <= 88; m++) if ([2, 4, 5, 7, 9, 10, 0].includes(m % 12)) SCALE.push(m);
const D5 = SCALE.indexOf(74);

// --- drum patterns: '.' rest, 'x' hit, 'X' accent, 'g' ghost -------------
const KICK: Record<number, string[]> = {
  1: ["x.......x.......", "x.......x.....x.", "x.....x.x......."],
  2: ["x.......x.......", "x.....x.x.......", "x.......x.x.....", "x..x....x......x"],
  3: ["x...x...x...x...", "x...x...x...x.x.", "x...x..xx...x..."],
};
const SNARE: Record<number, string[]> = {
  1: ["....x.......x..."],
  2: ["....x.......x...", "....x.......x..g", "....x..g....x...", "....x.......x.g."],
  3: ["....x.......x...", "....x..g....x.g.", "....X.......X..g"],
};
const HAT: Record<number, string[]> = {
  0: ["..x...x...x...x.", "................"],
  1: ["x.x.x.x.x.x.x.x."],
  2: ["x.x.x.x.x.x.x.x.", "x.xxx.x.x.xxx.x.", "x.x.x.x.x.x.x.xx"],
  3: ["xxxxxxxxxxxxxxxx", "x.xxx.xxx.xxx.xx", "xgxgxgxgxgxgxgxg"],
};
const OHAT: Record<number, string[]> = {
  2: ["..............x.", "................"],
  3: ["......x.......x.", "..x...x...x...x."],
};
const BONES = ["..x..x....x..x..", "...x..x...x.x...", "..x...x.x....x..", ".x.x......x...x."];
const BONE_RATES = [1, 1.189, 1.335, 1.498, 1.782];

// --- bass: [step, interval, lengthInSteps]; AP = chromatic approach, TH = chord third
const AP = 99;
const TH = 100;
type BassPat = readonly (readonly [number, number, number])[];
const BASS: Record<string, BassPat[]> = {
  menu: [
    [[0, 0, 4], [8, -5, 4]],
    [[0, 0, 3], [6, 7, 2], [8, -5, 4]],
    [[0, 0, 6], [8, 7, 3], [12, -5, 3]],
  ],
  e0: [[[0, 0, 10]], [[0, 0, 6], [8, -5, 6]]],
  e1: [
    [[0, 0, 3], [8, -5, 3]],
    [[0, 0, 3], [4, 12, 1], [6, 0, 2], [8, -5, 3], [14, AP, 2]],
    [[0, 0, 2], [3, 0, 1], [6, 7, 2], [8, 0, 3], [12, 10, 2], [14, AP, 2]],
  ],
  e2: [
    [[0, 0, 2], [3, 0, 1], [6, 7, 2], [8, 0, 2], [11, 0, 1], [12, 10, 2], [14, AP, 2]],
    [[0, 0, 3], [4, TH, 3], [8, 7, 3], [12, AP, 3]],
    [[0, 0, 1], [2, 12, 1], [4, 0, 2], [7, 0, 1], [8, -5, 2], [10, 7, 2], [12, 0, 1], [14, AP, 2]],
    [[0, 0, 3], [3, 0, 1], [4, 12, 2], [8, -5, 3], [11, -5, 1], [12, 7, 2], [14, AP, 2]],
  ],
  e3: [
    [[0, 0, 1], [2, 0, 1], [4, 12, 1], [6, 0, 1], [8, 0, 1], [10, 12, 1], [12, 7, 1], [14, AP, 1]],
    [[0, 0, 2], [3, 0, 1], [4, 12, 1], [6, 0, 2], [8, 0, 1], [10, 0, 1], [11, 12, 1], [12, 7, 2], [14, 10, 2]],
    [[0, 0, 1], [1, 0, 1], [2, 12, 1], [4, 0, 1], [6, 0, 1], [7, 12, 1], [8, 0, 1], [10, 7, 1], [12, 0, 1], [13, 0, 1], [14, AP, 2]],
  ],
};

// --- arps: digit = chord-tone index, 'c' = chord stab, '.' = rest -------
const ARP: Record<string, string[]> = {
  menu: ["0...1...2...1...", "0..2..1...3..2..", "2.1.0...3.2.1...", "0.......2...1..."],
  sparse: ["..c...c...c...c.", "0.......2.......", "0...2...1...3...", "..c.......c....."],
  e0: ["0.......2.......", "0...2...1...3...", "3.......1......."],
  e1: ["0.1.2.3.2.1.0.1.", "0..2..1.3..2..1.", "..c...c...c...c."],
  e2: ["0.1.2.3.2.1.0.1.", "0.2.1.3.0.2.1.3.", "0..2..1.3..2..1.", "..c...c...c...c.", "0.12.0.13.2.0.1.", "3.2.1.0.3.2.1.0."],
  e3: ["0213021302130213", "3.2.1.0.3210.1.2", "0.0.2.1.3.3.2.1.", "0.c.0.c.0.c.0.c."],
};

// --- melodic hook rhythms over 2 bars: [step 0..31, lengthInSteps] -------
const RHY: (readonly [number, number])[][] = [
  [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4], [16, 2], [18, 2], [20, 6], [28, 4]],
  [[0, 3], [3, 1], [4, 2], [6, 2], [8, 6], [14, 2], [16, 3], [19, 1], [20, 2], [22, 2], [24, 8]],
  [[2, 2], [4, 2], [6, 2], [8, 4], [12, 4], [18, 2], [20, 2], [22, 2], [24, 8]],
  [[0, 1], [1, 1], [2, 2], [4, 2], [8, 2], [10, 2], [12, 4], [16, 1], [17, 1], [18, 2], [20, 2], [24, 6]],
  [[0, 4], [4, 2], [6, 2], [8, 2], [10, 6], [16, 4], [20, 2], [22, 2], [24, 4], [28, 4]],
  [[0, 2], [3, 2], [6, 2], [8, 8], [16, 2], [19, 2], [22, 2], [24, 8]],
];
const MOVES = [-3, -2, -2, -1, -1, -1, 0, 1, 1, 1, 2, 2, 3];

interface Note {
  step: number;
  len: number;
  idx: number;
}

enum Lead {
  None = 0,
  Theremin = 1,
  Square = 2,
  Celesta = 3,
}

function pick<T>(a: readonly T[]): T {
  return a[(Math.random() * a.length) | 0];
}
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** apply a chord's scale alteration (e.g. C → C# over A major) */
function adjust(m: number, ch: Chord): number {
  if (ch.alter && m % 12 === ch.alter[0]) return m + ch.alter[1] - ch.alter[0];
  return m;
}
function isChordTone(idx: number, ch: Chord): boolean {
  return ch.pcs.includes(adjust(SCALE[idx], ch) % 12);
}
function nearestChordIdx(idx: number, ch: Chord): number {
  for (let d = 0; d < 7; d++) {
    if (idx + d < SCALE.length && isChordTone(idx + d, ch)) return idx + d;
    if (idx - d >= 0 && isChordTone(idx - d, ch)) return idx - d;
  }
  return idx;
}
function nearestPcIdx(idx: number, pc: number, ch: Chord): number {
  for (let d = 0; d < 7; d++) {
    if (idx - d >= 0 && adjust(SCALE[idx - d], ch) % 12 === pc) return idx - d;
    if (idx + d < SCALE.length && adjust(SCALE[idx + d], ch) % 12 === pc) return idx + d;
  }
  return idx;
}

/** fill `out` with velocities from a pattern string */
function parse(p: string, out: Float32Array, scale = 1): void {
  for (let s = 0; s < 16; s++) {
    const c = p.charCodeAt(s);
    out[s] = c === 120 /* x */ ? scale : c === 88 /* X */ ? 1.25 * scale : c === 103 /* g */ ? 0.35 * scale : 0;
  }
}

export class Music {
  playing = false;
  mode: MusicMode = "run";
  /** current intensity: -1 menu, 0 normal, 1 boss */
  intensity = 0;
  private pending = 0;
  private bpm = 116;
  /** seconds per 16th step */
  private sd = 60 / 116 / 4;
  private swing = 0.12;
  private nextT = 0;
  private step = 0;
  private bar = 0;
  private phraseN = 0;
  private prog: Chord[] = PROG_RUN[0];
  private nextProg: Chord[] | null = null;
  private chord: Chord = CH.Dm;
  private energy = 1;
  private leadKind: Lead = Lead.None;
  private motif: Note[] | null = null;
  private melody: Note[] = [];
  private arpPat = ARP.e1[0];
  private arpPatLast = ARP.e1[0];
  private kickPat = KICK[1][0];
  private kickPatLast = KICK[1][0];
  private snarePat = SNARE[1][0];
  private hatPat = HAT[1][0];
  private ohatPat = "";
  private bassA: BassPat = BASS.e1[0];
  private bassB: BassPat = BASS.e1[0];
  private useClap = false;
  private transition = 0;
  private riserArmed = false;
  private lastLeadHz = 0;
  private lastLeadEnd = -1;
  private crash = false;

  // per-bar step tables
  private kick = new Float32Array(16);
  private snare = new Float32Array(16);
  private hat = new Float32Array(16);
  private ohat = new Float32Array(16);
  private bone = new Float32Array(16);
  private tomV = new Float32Array(16);
  private tomR = new Float32Array(16);
  private bassM = new Int16Array(16);
  private bassL = new Float32Array(16);
  private arpT = new Int8Array(16);
  private leadM = new Int16Array(16);
  private leadL = new Float32Array(16);
  private arpNotes: number[] = [];
  private padNotes: number[] = [];

  // mixing
  private drums: GainNode;
  private bassBus: GainNode;
  private arpBus: GainNode;
  private padBus: GainNode;
  private leadBus: GainNode;
  private choirIn: GainNode;
  private echo: DelayNode;
  private organ: PeriodicWave | null = null;

  constructor(
    private c: BaseAudioContext,
    out: AudioNode,
    private bank: SampleBank,
    private reaper: Reaper,
  ) {
    const g = (to: AudioNode, v: number): GainNode => {
      const n = c.createGain();
      n.gain.value = v;
      n.connect(to);
      return n;
    };
    const mix = g(out, 1);
    this.drums = g(mix, 0.9);
    this.bassBus = g(mix, 0.85);
    this.arpBus = g(mix, 0.55);
    this.padBus = g(mix, 0.6);
    this.leadBus = g(mix, 0.55);

    // tempo-synced dotted-8th echo on arp + lead: cheap spooky space
    const send = c.createGain();
    send.gain.value = 0.3;
    this.arpBus.connect(send);
    this.leadBus.connect(send);
    this.echo = c.createDelay(1.5);
    this.echo.delayTime.value = this.sd * 3;
    const damp = c.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2400;
    const fb = c.createGain();
    fb.gain.value = 0.36;
    send.connect(this.echo);
    this.echo.connect(damp);
    damp.connect(fb);
    fb.connect(this.echo);
    damp.connect(g(mix, 0.7));

    // "ooh" choir: saws through three parallel formant filters
    this.choirIn = c.createGain();
    const choirOut = g(this.padBus, 2.4);
    const formants: [number, number, number][] = [[450, 5, 1], [800, 6, 0.6], [2800, 8, 0.22]];
    for (const [f, q, gain] of formants) {
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f;
      bp.Q.value = q;
      this.choirIn.connect(bp);
      bp.connect(g(choirOut, gain));
    }
  }

  // ------------------------------------------------------------- control --

  start(mode: MusicMode, intensity: number, t: number): void {
    this.mode = mode;
    this.intensity = this.pending = mode === "menu" ? -1 : intensity > 0 ? 1 : 0;
    this.applyTempo();
    this.step = 0;
    this.bar = 0;
    this.phraseN = 0;
    this.nextProg = null;
    this.motif = null;
    this.transition = 0;
    this.riserArmed = false;
    this.lastLeadEnd = -1;
    this.nextT = t;
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  /** request intensity (applied at the next bar line) */
  setIntensity(i: number): void {
    if (this.mode !== "run") return;
    const v = i > 0 ? 1 : 0;
    if (v !== this.pending) {
      this.pending = v;
      this.riserArmed = false;
    }
  }

  /** continue from the current step at time t (after a pause) */
  resync(t: number): void {
    this.nextT = t;
    this.lastLeadEnd = -1;
  }

  /** schedule every step that starts before `until` */
  schedule(now: number, until: number): void {
    if (!this.playing) return;
    // main thread stalled longer than the lookahead: skip, don't burst
    if (this.nextT < now - 0.03) this.nextT = now + 0.03;
    if (this.pending !== this.intensity && !this.riserArmed) this.armRiser(now);
    while (this.nextT < until) {
      this.doStep(this.nextT);
      this.nextT += this.sd;
      if (++this.step === 16) {
        this.step = 0;
        this.bar = (this.bar + 1) & 3;
      }
    }
  }

  private applyTempo(): void {
    if (this.mode === "menu") {
      this.bpm = 92;
      this.swing = 0.3;
    } else if (this.intensity > 0) {
      this.bpm = 134;
      this.swing = 0.04;
    } else {
      this.bpm = 116;
      this.swing = 0.12;
    }
    this.sd = 60 / this.bpm / 4;
    this.echo.delayTime.setTargetAtTime(this.sd * 3, this.c.currentTime, 0.05);
  }

  /** riser that ends exactly on the bar where the boss groove kicks in */
  private armRiser(now: number): void {
    this.riserArmed = true;
    if (this.pending <= this.intensity) return;
    const arr = this.bank.get("riser");
    if (!arr) return;
    const buf = arr[0];
    const barT = this.nextT + ((16 - this.step) & 15) * this.sd;
    const start = barT - buf.duration;
    const t = Math.max(start, now + 0.02);
    const offset = t - start;
    if (offset >= buf.duration - 0.15) return;
    const src = this.c.createBufferSource();
    src.buffer = buf;
    const g = this.c.createGain();
    g.gain.value = 0.35;
    src.connect(g);
    g.connect(this.drums);
    src.start(t, offset);
    this.reaper.add(g, barT + 0.1);
  }

  // ----------------------------------------------------------- sequencing --

  private doStep(t: number): void {
    const s = this.step;
    if (s === 0) this.onBar(t);
    const st = (s & 3) === 2 ? t + this.swing * this.sd : t;
    const d = this.drums;
    let v: number;
    if ((v = this.kick[s])) this.samp(this.intensity > 0 ? "kickB" : "kick", t, 0.85 * v, 1, d);
    if ((v = this.snare[s])) this.samp(this.useClap ? "clap" : "snare", st, 0.5 * v, 0.97 + Math.random() * 0.06, d);
    if ((v = this.hat[s])) this.samp("hat", st, ((s & 3) === 0 ? 0.2 : 0.13) * v, 0.94 + Math.random() * 0.12, d);
    if ((v = this.ohat[s])) this.samp("ohat", st, 0.14 * v, 1, d);
    if ((v = this.bone[s])) this.samp("bone", st, 0.2 * v, pick(BONE_RATES), d);
    if ((v = this.tomV[s])) this.samp("tom", st, 0.5 * v, this.tomR[s], d);
    if (s === 0 && this.crash) this.samp("crash", t, 0.3, 1, d);
    const bm = this.bassM[s];
    if (bm > 0) this.playBass(st, bm, this.bassL[s] * this.sd);
    const at = this.arpT[s];
    if (at >= 0) this.playArp(st, at);
    const lm = this.leadM[s];
    if (lm > 0) this.playLead(st, lm, this.leadL[s] * this.sd, (s & 3) === 0);
  }

  private onBar(t: number): void {
    if (this.pending !== this.intensity) {
      this.transition = this.pending > this.intensity ? 1 : -1;
      this.intensity = this.pending;
      this.applyTempo();
      this.bar = 0;
      this.nextProg = null;
    }
    if (this.bar === 0) this.newPhrase();
    this.chord = this.prog[this.bar];
    const next = this.bar < 3 ? this.prog[this.bar + 1] : (this.nextProg ?? this.prog)[0];
    this.buildBar(next);
    this.playPad(t);
    if (this.transition < 0) this.sting(t);
    this.transition = 0;
  }

  private newPhrase(): void {
    const n = ++this.phraseN;
    const menu = this.mode === "menu";
    const boss = this.intensity > 0;
    const pool = menu ? PROG_MENU : boss ? PROG_BOSS : PROG_RUN;
    this.prog = this.nextProg ?? (n === 1 && !boss ? pool[0] : pick(pool));
    let np = pick(pool);
    if (np === this.prog) np = pick(pool);
    this.nextProg = np;

    if (menu) {
      this.energy = n % 3 === 0 ? 1 : 0;
      this.leadKind = n === 1 ? Lead.None : n % 2 === 0 ? Lead.Theremin : Lead.Celesta;
    } else if (boss) {
      this.energy = 3;
      this.leadKind = n % 2 === 0 ? Lead.Square : Math.random() < 0.5 ? Lead.Theremin : Lead.None;
    } else {
      this.energy = n === 1 ? 1 : n % 6 === 0 ? 0 : Math.random() < 0.65 ? 2 : 1;
      this.leadKind = this.energy === 0 ? Lead.Theremin : n % 2 === 0 ? (Math.random() < 0.55 ? Lead.Theremin : Lead.Square) : Lead.None;
    }
    if (this.leadKind !== Lead.None) {
      // re-use the hook most of the time: that is what makes it catchy
      if (!this.motif || Math.random() < 0.35) this.motif = this.genMotif();
      this.fitMelody(this.motif);
    } else {
      this.melody.length = 0;
    }

    const E = this.energy;
    const arpSet = menu ? ARP.menu : this.leadKind !== Lead.None ? (E === 3 ? ARP.e3 : ARP.sparse) : ARP["e" + E];
    this.arpPat = pick(arpSet);
    this.arpPatLast = Math.random() < 0.5 ? pick(arpSet) : this.arpPat;
    const bassSet = menu ? BASS.menu : BASS["e" + E];
    this.bassA = pick(bassSet);
    this.bassB = Math.random() < 0.5 ? pick(bassSet) : this.bassA;
    if (E >= 1) {
      this.kickPat = pick(KICK[E]);
      this.kickPatLast = Math.random() < 0.5 ? pick(KICK[E]) : this.kickPat;
      this.snarePat = pick(SNARE[E]);
    }
    this.hatPat = pick(HAT[E] ?? HAT[1]);
    this.ohatPat = OHAT[E] ? pick(OHAT[E]) : "";
    this.useClap = Math.random() < 0.45;
  }

  private genMotif(): Note[] {
    const out: Note[] = [];
    let idx = D5 + ((Math.random() * 5) | 0) - 2;
    for (const [step, len] of pick(RHY)) {
      if (out.length) idx = clamp(idx + pick(MOVES), 2, SCALE.length - 3);
      out.push({ step, len, idx });
    }
    return out;
  }

  /** hook over bars 1-2, answered with a variation over bars 3-4 */
  private fitMelody(m: Note[]): void {
    const out = this.melody;
    out.length = 0;
    const shift = pick([0, 0, 1, -1, 2]);
    for (let half = 0; half < 2; half++) {
      for (let i = 0; i < m.length; i++) {
        const n = m[i];
        const step = n.step + half * 32;
        const ch = this.prog[step >> 4];
        let idx = n.idx + (half ? shift : 0);
        if (half && i < m.length - 1 && Math.random() < 0.2) idx += Math.random() < 0.5 ? -1 : 1;
        idx = clamp(idx, 0, SCALE.length - 1);
        if ((step & 7) === 0 || i === 0) idx = nearestChordIdx(idx, ch);
        let len = n.len;
        if (i === m.length - 1) {
          // phrase endings land on the root (answer) or a chord tone (question)
          idx = half ? nearestPcIdx(idx, ch.pcs[0], ch) : nearestChordIdx(idx, ch);
          if (half) len = Math.max(len, 63 - step);
        }
        out.push({ step, len, idx });
      }
    }
  }

  private buildBar(next: Chord): void {
    const E = this.energy;
    const menu = this.mode === "menu";
    const last = this.bar === 3;
    const ch = this.chord;
    this.kick.fill(0);
    this.snare.fill(0);
    this.hat.fill(0);
    this.ohat.fill(0);
    this.bone.fill(0);
    this.tomV.fill(0);
    this.bassM.fill(0);
    this.arpT.fill(-1);
    this.leadM.fill(0);

    // drums
    if (menu) {
      if (E >= 1) {
        parse("..x...x...x...x.", this.hat, 0.6);
        this.kick[0] = 0.45;
        this.kick[8] = 0.3;
      }
      if (Math.random() < 0.6) parse(pick(BONES), this.bone, 0.9);
    } else {
      if (E >= 1) {
        parse(last ? this.kickPatLast : this.kickPat, this.kick);
        parse(this.snarePat, this.snare, E === 1 ? 0.8 : 1);
      }
      parse(this.hatPat, this.hat);
      if (this.ohatPat) parse(this.ohatPat, this.ohat);
      if (E <= 2 && Math.random() < (E === 0 ? 0.8 : 0.35)) parse(pick(BONES), this.bone);
    }
    this.crash = !menu && this.bar === 0 && (this.transition !== 0 || (E >= 2 && this.phraseN > 1 && (E === 3 || Math.random() < 0.4)));

    // bass
    const pat = last || (this.bar === 1 && Math.random() < 0.3) ? this.bassB : this.bassA;
    for (const [s, iv, len] of pat) {
      let m: number;
      if (iv === AP) {
        let tgt = next.root;
        while (tgt - ch.root > 6) tgt -= 12;
        while (ch.root - tgt > 6) tgt += 12;
        m = tgt === ch.root ? ch.root + 7 : tgt > ch.root ? tgt - 1 : tgt + 1;
      } else if (iv === TH) {
        m = ch.root + ((ch.pcs[1] - ch.pcs[0] + 12) % 12);
      } else {
        m = ch.root + iv;
      }
      while (m < 33) m += 12;
      while (m > 62) m -= 12;
      this.bassM[s] = m;
      this.bassL[s] = len;
    }

    // arp voicing + pattern
    this.voice(ch, menu ? 74 : 62, this.arpNotes);
    if (this.arpNotes.length === 3) this.arpNotes.push(this.arpNotes[0] + 12);
    const ap = last ? this.arpPatLast : this.arpPat;
    for (let s = 0; s < 16; s++) {
      const c = ap.charCodeAt(s);
      this.arpT[s] = c === 46 /* . */ ? -1 : c === 99 /* c */ ? 9 : c - 48;
    }

    // lead
    for (const n of this.melody) {
      if (n.step >> 4 !== this.bar) continue;
      this.leadM[n.step & 15] = adjust(SCALE[n.idx], ch);
      this.leadL[n.step & 15] = n.len;
    }

    if (last && !menu && E >= 1 && (E === 3 || Math.random() < 0.7)) this.fill(E);
  }

  /** end-of-phrase drum fill */
  private fill(E: number): void {
    const r = Math.random();
    if (r < 0.35) {
      for (let s = 12; s < 16; s++) {
        this.snare[s] = 0.45 + (s - 12) * 0.2;
        this.hat[s] = 0;
      }
    } else if (r < 0.7) {
      const rates = [1.35, 1.2, 1.0, 0.85];
      for (let k = 0; k < 4; k++) {
        this.tomV[12 + k] = 0.8 + 0.06 * k;
        this.tomR[12 + k] = rates[k];
        this.snare[12 + k] = 0;
      }
    } else if (r < 0.85 && E < 3) {
      // dramatic stop: everything drops out, a lone bone click, then the downbeat
      for (let s = 13; s < 16; s++) {
        this.kick[s] = this.snare[s] = this.hat[s] = this.ohat[s] = this.bone[s] = 0;
        this.bassM[s] = 0;
        this.arpT[s] = -1;
      }
      this.bone[14] = 1.2;
    } else {
      this.kick[12] = 1;
      this.kick[14] = 0.8;
      this.kick[15] = 0.9;
      this.snare[13] = 0.6;
    }
  }

  /** closed voicing of the chord's pitch classes inside [lo, lo+12) */
  private voice(ch: Chord, lo: number, out: number[]): void {
    out.length = 0;
    for (const pc of ch.pcs) out.push(lo + ((((pc - lo) % 12) + 12) % 12));
    out.sort((a, b) => a - b);
  }

  // ---------------------------------------------------------- instruments --

  /** gated, pitched sample playback */
  private samp(key: string, t: number, vol: number, rate: number, dest: AudioNode, gate = 0): void {
    const arr = this.bank.get(key);
    if (!arr) return;
    const buf = arr.length > 1 ? arr[(Math.random() * arr.length) | 0] : arr[0];
    const c = this.c;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    let end = t + buf.duration / rate;
    if (gate > 0 && t + gate < end) {
      g.gain.setValueAtTime(vol, t);
      g.gain.setValueAtTime(vol, t + gate);
      g.gain.linearRampToValueAtTime(0, t + gate + 0.035);
      end = t + gate + 0.04;
      src.stop(end);
    } else {
      g.gain.value = vol;
    }
    src.connect(g);
    g.connect(dest);
    src.start(t);
    this.reaper.add(g, end + 0.05);
  }

  private pitched(key: string, t: number, m: number, vol: number, dest: AudioNode, gate = 0): void {
    if (key === "pluck" && m >= 68) key = "pluckHi";
    this.samp(key, t, vol, Math.pow(2, (m - SAMPLE_BASE[key]) / 12), dest, gate);
  }

  private playBass(t: number, m: number, dur: number): void {
    const key = this.intensity > 0 ? "bassB" : m >= 44 ? "bassHi" : "bass";
    const vol = (this.mode === "menu" ? 0.45 : 0.72) * (0.92 + Math.random() * 0.12);
    this.pitched(key, t, m, vol, this.bassBus, Math.max(0.06, dur * 0.9));
  }

  private playArp(t: number, tone: number): void {
    const menu = this.mode === "menu";
    const key = menu ? "celesta" : "pluck";
    const vol = (menu ? 0.3 : this.leadKind !== Lead.None ? 0.22 : 0.34) * (0.85 + Math.random() * 0.2);
    const notes = this.arpNotes;
    if (tone === 9) {
      for (let i = 0; i < 3; i++) this.pitched(key, t, notes[i], vol * 0.55, this.arpBus);
      return;
    }
    this.pitched(key, t, notes[tone % notes.length], vol, this.arpBus);
  }

  private playLead(t: number, m: number, dur: number, strong: boolean): void {
    const accent = strong ? 1 : 0.85;
    switch (this.leadKind) {
      case Lead.Theremin:
        this.theremin(t, m, dur, 0.34 * accent);
        break;
      case Lead.Square:
        this.squareLead(t, m, dur, 0.16 * accent);
        break;
      case Lead.Celesta:
        this.pitched("celesta", t, m, 0.36 * accent, this.leadBus);
        break;
    }
  }

  /** sine with delayed vibrato and portamento from the previous note */
  private theremin(t: number, m: number, dur: number, vol: number): void {
    const c = this.c;
    const f = midiHz(m);
    const legato = this.lastLeadEnd > 0 && t - this.lastLeadEnd < 0.25;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(legato ? this.lastLeadHz : f, t);
    if (legato) o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    const l = c.createOscillator();
    l.frequency.value = 5.3;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.014, t + Math.min(0.3, dur));
    l.connect(lg);
    lg.connect(o.frequency);
    const h = c.createOscillator();
    h.type = "triangle";
    h.frequency.value = f * 2;
    const hg = c.createGain();
    hg.gain.value = 0.12;
    h.connect(hg);
    const g = c.createGain();
    const end = adsr(g.gain, t, vol, 0.04, 0.4, 0.8, t + dur, 0.06);
    o.connect(g);
    hg.connect(g);
    g.connect(this.leadBus);
    o.start(t);
    l.start(t);
    h.start(t);
    o.stop(end);
    l.stop(end);
    h.stop(end);
    this.reaper.add(g, end + 0.05);
    this.lastLeadHz = f;
    this.lastLeadEnd = t + dur;
  }

  private squareLead(t: number, m: number, dur: number, vol: number): void {
    const c = this.c;
    const f = midiHz(m);
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(3600, t);
    lp.frequency.setTargetAtTime(1300, t + 0.01, 0.1);
    const l = c.createOscillator();
    l.frequency.value = 6;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.25, dur));
    l.connect(lg);
    lg.connect(o.frequency);
    const g = c.createGain();
    const end = adsr(g.gain, t, vol, 0.005, 0.15, 0.55, t + dur, 0.05);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.leadBus);
    o.start(t);
    l.start(t);
    o.stop(end);
    l.stop(end);
    this.reaper.add(g, end + 0.05);
  }

  private playPad(t: number): void {
    const dur = 16 * this.sd;
    const ch = this.chord;
    if (this.mode === "menu") {
      this.voice(ch, 57, this.padNotes);
      this.glass(t, dur, 0.07);
      return;
    }
    this.voice(ch, 55, this.padNotes);
    this.organPad(t, dur, this.energy === 0 ? 0.075 : 0.055);
    if (this.intensity > 0) this.choir(t, dur, 0.08);
  }

  private organPad(t: number, dur: number, vol: number): void {
    const c = this.c;
    if (!this.organ) this.organ = organWave(c);
    for (const m of this.padNotes) {
      const g = c.createGain();
      const end = adsr(g.gain, t, vol, 0.05, 0.6, 0.8, t + dur - 0.04, 0.07);
      g.connect(this.padBus);
      const f = midiHz(m - 12);
      for (const det of [-5, 5]) {
        const o = c.createOscillator();
        o.setPeriodicWave(this.organ);
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(end);
      }
      this.reaper.add(g, end + 0.05);
    }
  }

  private choir(t: number, dur: number, vol: number): void {
    const c = this.c;
    for (const m of this.padNotes) {
      const g = c.createGain();
      const end = adsr(g.gain, t, vol, 0.3, 1, 0.9, t + dur - 0.04, 0.12);
      g.connect(this.choirIn);
      for (const det of [-12, 12]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(end);
      }
      this.reaper.add(g, end + 0.05);
    }
  }

  private glass(t: number, dur: number, vol: number): void {
    const c = this.c;
    for (const m of this.padNotes) {
      const g = c.createGain();
      const end = adsr(g.gain, t, vol, 0.35, 0.8, 0.7, t + dur, 0.35);
      g.connect(this.padBus);
      const o = c.createOscillator();
      o.frequency.value = midiHz(m);
      const o2 = c.createOscillator();
      o2.type = "triangle";
      o2.frequency.value = midiHz(m) * 2.001;
      const g2 = c.createGain();
      g2.gain.value = 0.2;
      o.connect(g);
      o2.connect(g2);
      g2.connect(g);
      o.start(t);
      o2.start(t);
      o.stop(end);
      o2.stop(end);
      this.reaper.add(g, end + 0.05);
    }
  }

  /** bright arpeggio when the boss falls and the groove calms down */
  private sting(t: number): void {
    const notes = [74, 77, 81, 86, 89, 93];
    for (let i = 0; i < notes.length; i++) this.pitched("pluck", t + i * 0.055, notes[i], 0.32, this.arpBus);
  }
}
