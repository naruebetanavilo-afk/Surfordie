# Meta progression (`src/meta/`)

Everything that persists between runs beyond the shop: difficulty tiers,
stage records / unlocks, weapon + hero unlocks and missions. All state lives
in `Meta.data` (`src/core/Meta.ts`, localStorage `sfd.meta.v1`) in
sanitize-friendly fields (numbers, string arrays, numeric records), so old and
hand-edited saves load with defaults.

| file | contents |
|---|---|
| `curse.ts` | ระดับคำสาป tiers 0..10: `curseMods(t)` → `RunMods`, `curseLines(t)` (exact UI numbers), `curseName`, `curseColor` |
| `runSetup.ts` | stage + tier selection (`selectedStage/selectStage`, `selectedCurse/selectCurse`, `maxCurse`), unlock rules (`stageUnlocked`, `stageRequirement`), `applyRunSetup()` (sets `G.stageId/G.curse/G.mods`), `syncMenuStage()`, `recordRun()` |
| `missions.ts` | `MISSIONS` (18 achievements), `DAILY_POOL` (3 per local date), the `Missions` tracker (progress, completion, claims) |

## Curse tiers

Per tier: enemy HP +20%, enemy damage +10%, enemy speed +2% (max +10%),
crowd size +3% (max +15%), coin gold +25% (tier 10: HP x3, dmg x2, gold
x3.5). Tier N+1 on a stage opens after winning tier N there
(`Meta.data.curseCleared[stageId]` = highest tier won; missing = never won).
The menu stepper stores the pick per stage in `Meta.data.curseSel`.
`?curse=<n>` forces a tier for testing (a forced win still records).

## Stages

`Meta.data.lastStage` is the picked stage, `Meta.data.stageBest[id]` the best
survival time. A stage with `requires: X` opens when X was won once or the
player survived `STAGE_UNLOCK_TIME` (6:00) on X. `?stage=<id>` forces one.
`Game.startRun` calls `applyRunSetup()` before the director loads the stage;
the menu calls `syncMenuStage()` so the background follows the selection.

## Unlocks

New saves start with `BASE_WEAPONS` (slash, orbit, missile, axe, bomb);
lightning, spikes and aura come from missions (`reward.weapon`). The chef
hero comes from mission `a_win1` (`HeroDef.unlock`). `WeaponSystem.weaponAllowed`
keeps locked weapons out of level-up rolls (a hero's own start weapon is
always allowed; chests only upgrade owned weapons). `Meta.migrate()`
grandfathers a save that already had runs when the feature first loaded:
every weapon / hero that existed then stays unlocked and its old records
become the meadow's.

## Missions

Progress = lifetime numbers in Meta (`totalKills`, `wins`, `runs`,
`bestLevel`, `bestTime`, curse records, `counters`) + the running run (G.stats
and a few event counters: elites, ultimates via `ultCast`, evolutions,
chests) until `Game.endRun` merges it (`Missions.endRun`); quitting mid-run
merges kills etc. too (`abandonRun`). `Missions.tick` re-checks every 0.4 s
while playing, so missions complete mid-run: unlock rewards apply at once,
gold waits for the claim on the missions screen. Each completion emits
`missionComplete` (in-run toast: `src/ui/missionToast.ts`).

Daily missions: `dailyFor(yyyymmdd)` shuffles the pool with a seeded PRNG and
takes one per category; progress lives in `Meta.data.daily` and resets when
the local date changes (`?day=yyyymmdd` overrides for tests).

## UI

`src/ui/runSetupUi.ts` (menu stage button + curse stepper),
`src/ui/metaScreens.ts` (stage picker, missions, codex), results / pause
chips in `Screens.ts`, styles in `src/ui/meta.css`.
