# Audio (procedural, no asset files)

`G.audio` is an `AudioSys` (`Audio.ts`). Every sound and all music is synthesised
with WebAudio at runtime.

## API

```ts
G.audio.sfx("hit");                          // throttled, voice-limited, pitch-jittered
G.audio.sfx("boom", { vol: 0.6, pitch: 1.2 });
G.audio.music(true, 0);   // run theme      (Game.startRun)
G.audio.music(true, 1);   // boss intensity (also automatic on bossSpawned/bossKilled)
G.audio.music(true, -1);  // calm menu theme (also automatic while G.state === "menu")
G.audio.music(false);     // fade out
G.audio.applySettings();  // re-read Meta.data.muted / musicVol / sfxVol
G.audio.stats();          // diagnostics: voices, pending nodes, music state...
```

Calling `sfx()` every frame, even hundreds of times, is fine: rejected calls cost
about 1 µs. Sound names are listed in `SfxName` (`sfxDefs.ts`).

AudioSys plays these sounds itself when the matching event fires, so other code
should not also play them:
`bossDie` on `bossKilled`, `evolve` on `upgradeApplied{kind:"evolve"}`, `nuke` on
`pickup{kind:"nuke"}`.

## How it works

- `sfxDefs.ts`: one recipe per sound plus mixing rules: `gap` (throttle), `max`
  (voices per sound), `prio` (voice stealing), `jitter` (± semitones), `dense`
  (quieter on rapid repeats) and `duck` (dips the music).
- `SampleBank.ts`: after the first user gesture, every recipe is pre-rendered into
  AudioBuffers by OfflineAudioContexts (about 0.3 s, off the main thread, about
  4 MB). After that, a sound effect costs one buffer source and one gain node.
  Until a buffer is ready, the recipe is synthesised live instead.
- `Music.ts`: a generative 16th-note sequencer fed by a 30 ms lookahead scheduler
  (0.2 s ahead).
  - Each 4-bar phrase picks a new chord progression in D minor, plus energy,
    drum, bass and arp patterns, and a lead instrument (theremin, square or
    music box).
  - A 2-bar melodic hook is generated, answered, and re-used in later phrases.
  - Fills, breakdowns, crashes and "bone" percussion add variety.
  - Boss mode: 134 BPM, heavier kick, distorted bass, "ooh" choir, a riser into
    the transition and a sting on the way out.
- `instruments.ts`: drum, bass, pluck and celesta sample recipes, plus the organ
  PeriodicWave.
- `mixer.ts`: sfx compressor, then music muffle/duck/pause/gate, then high-pass,
  limiter and master.
- Pause fades the music. Level-up and chest screens muffle it. A hidden page or
  mute fades out and then suspends the context to save battery.
- `Reaper` disconnects every voice after its scheduled end. There are no
  `onended` closures and no ScriptProcessor.

## Adding a sound

1. Add the name to `SfxName`.
2. Add a `def({...})` recipe to `SFX` using `tone()` and `noise()` from `synth.ts`.
   Envelopes must start and end at 0.
3. Pick `gap`, `max`, `prio`, `vol` and `variants`. Use several variants for
   sounds that play often.
