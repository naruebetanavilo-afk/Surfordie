// Master signal chain, built the same way on the live AudioContext and on
// OfflineAudioContexts used by tests.
//
//   sfxIn ─► sfxComp ──────────────────────────────┐
//   musicIn ─► muffle(LP) ─► duck ─► pause ─► gate ─┴─► sum ─► limiter ─► master ─► out
//
// sfxComp glues dense combat together, the limiter stops clipping, `muffle`
// darkens music on level-up/chest screens, `duck` dips music under stingers,
// `pause` fades music while paused and `gate` handles start/stop fades.
export interface Mixer {
  sfxIn: GainNode;
  musicIn: GainNode;
  muffle: BiquadFilterNode;
  duck: GainNode;
  pause: GainNode;
  gate: GainNode;
  master: GainNode;
}

export function buildMixer(c: BaseAudioContext): Mixer {
  const master = c.createGain();
  master.connect(c.destination);

  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  limiter.connect(master);

  const sum = c.createGain();
  sum.connect(limiter);

  const sfxComp = c.createDynamicsCompressor();
  sfxComp.threshold.value = -20;
  sfxComp.knee.value = 12;
  sfxComp.ratio.value = 4;
  sfxComp.attack.value = 0.002;
  sfxComp.release.value = 0.2;
  sfxComp.connect(sum);

  const sfxIn = c.createGain();
  sfxIn.connect(sfxComp);

  const gate = c.createGain();
  gate.gain.value = 0;
  gate.connect(sum);
  const pause = c.createGain();
  pause.connect(gate);
  const duck = c.createGain();
  duck.connect(pause);
  const muffle = c.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.frequency.value = Math.min(20000, c.sampleRate / 2 - 100);
  muffle.Q.value = 0.9;
  muffle.connect(duck);
  const musicIn = c.createGain();
  musicIn.connect(muffle);

  return { sfxIn, musicIn, muffle, duck, pause, gate, master };
}
