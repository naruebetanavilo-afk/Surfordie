# Surfordie — architecture

Original mobile-first 3D horde-survival ("survivor-like") web game.
Three.js r187 + TypeScript + Vite. No assets: every model, icon, texture and
sound is generated procedurally. UI language: Thai.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build in dist/
node scripts/smoke.mjs --seconds 20 --params "god=1"   # headless playtest
```

Debug URL params: `?skipmenu=1` `autoplay=1` (bot plays, auto-picks upgrades)
`god=1` (no damage) `fps=1` `t=300` (start at 5:00) `weapons=8` (all weapons at
level 8) `hero=mage` `seed=7` `quality=low|medium|high`.
`lineup=1` (frozen parade of the current stage's enemy types)
`boss=bossBull|bossWitch|bossKing|bossFrost` (spawn that boss after 1.5 s)
`wtest=bomb,axe&wlv=8&wevo=1` (weapon loadout) `stage=snow` (force a stage)
`curse=0..10` (force a curse tier; a win is recorded like a real one)
`day=yyyymmdd` (pick the daily missions of that date) `hero=chef` bypasses
the hero lock.
`window.__game` exposes the global context in the browser.

## World conventions

- Ground plane is XZ, Y up. Screen-up is world **-Z**. Models face **+Z**.
- Camera: perspective, pitch ~56°, follows the player (`World.update`).
- Units: hero radius 0.45, normal zombie ~1.3 tall, radius 0.42.
- `G.world.viewHalfW / viewHalfH` = visible ground half-extents;
  `G.world.onScreen(x, z, margin)`; `G.world.project(x, y, z, out)` → CSS px.

## Global context `G` (`src/core/G.ts`)

Every system is a singleton on `G`, assigned in `Game.boot()`. Import `G` and
only access it inside functions (never at module top level).

| field | class | file |
|---|---|---|
| `G.world` | World (renderer, scene, camera, ground, decor, shake) | `src/world/World.ts` |
| `G.input` | Input (keyboard + floating joystick) | `src/core/Input.ts` |
| `G.player` | Player (movement, stats, xp, hp, hero model) | `src/player/Player.ts` |
| `G.enemies` | EnemyManager (SoA horde, grid, instanced rendering) | `src/enemies/EnemyManager.ts` |
| `G.director` | Director (spawning timeline) | `src/director/Director.ts` |
| `G.projectiles` | Projectiles (pooled, instanced per kind) | `src/combat/Projectiles.ts` |
| `G.pickups` | Pickups (xp gems, coins, heal, magnet, chest, nuke) | `src/pickups/Pickups.ts` |
| `G.fx` | Fx (particles, rings, flashes, slash arcs, lightning) | `src/fx/Fx.ts` |
| `G.overlay` | Overlay2D (damage numbers, HP bars, joystick) | `src/ui/Overlay2D.ts` |
| `G.hud` | Hud (DOM HUD, skill toasts, boss bar, announce) | `src/ui/Hud.ts` |
| `G.screens` | Screens (menu, level-up, chest, pause, results) | `src/ui/Screens.ts` |
| `G.audio` | AudioSys (procedural WebAudio sfx + music) | `src/audio/Audio.ts` |
| `G.weapons` | WeaponSystem (owned weapons/passives, level-up rolls) | `src/weapons/WeaponSystem.ts` |
| `G.events` | EventBus (`enemyKilled`, `levelUp`, `bossSpawned`, `announce`...) | `src/core/Events.ts` |
| `G.rng` | seeded Rng | `src/core/Rng.ts` |

`G.state`: `menu | playing | levelup | chest | paused | gameover | victory`.
Simulation only advances in `playing`. `G.time` = run seconds. `G.dt` = scaled step.
Game flow entry points: `Flow.startRun/toMenu/resume/pause` (`src/core/flow.ts`).

Frame order (`src/core/Game.ts`): input → player → director → enemies →
weapons → projectiles → pickups → fx → world(camera) → render instanced
buffers → WebGL render → overlay → HUD.

## Enemies

`EnemyManager` stores enemies as typed arrays indexed by slot `i` (stable within
a frame only; keep `em.uid[i]` across frames). Fields: `x z kx kz yaw hp maxHp
speed dmg radius mass scale xp flash slowT slowMul freezeT dieT walk age ai0..ai3
state flags`.

- `em.spawn(id, x, z, {hpMul, dmgMul, speedMul, elite, scaleMul})`
- `em.kill(i, source)`, `em.knock(i, dx, dz, force)`, `em.slow(i, mul, t)`, `em.freeze(i, t)`
- `em.queryCircle(x, z, r, cb)`, `em.nearest(x, z, maxR)`, `em.randomVisible()`,
  `em.densestTarget(radius)`, `em.spawnPoint(out, extra, angle?)`
- `em.isBoss(i)`, `em.isElite(i)`, `em.def(i)`

Enemy types are `EnemyDef`s in `src/enemies/defs.ts` (see `src/enemies/types.ts`).
Each def builds ONE merged geometry with `PartBuilder` (per-vertex colour + part
id + pivot); the toon `AnimatedMaterial` animates arms/legs/head/death in the
vertex shader. One InstancedMesh per type → one draw call per type.
Custom AI: `def.update(em, i, dt)` (return true if you moved it yourself),
`def.onDeath`, `def.onSpawn`.
`def.flying` makes a type separate only from other flyers (passes over the horde).
`glow(PART.X)` (PartBuilder) marks a part as unlit/glowing (eyes, pustules, gems).

Enemy content modules:

| file | contents |
|---|---|
| `src/enemies/models.ts` | PartBuilder models for the 8 regular types + 3 bosses |
| `src/enemies/defs.ts` | `ENEMY_DEFS` (stats, anim, hooks) |
| `src/enemies/ai.ts` | shared steering + behaviours. AI registers: `ai0` = mode (`MODE_STAMPEDE = 9`), `ai1` = timer, `ai2/ai3` = extra |
| `src/enemies/bosses.ts` | boss attack patterns, per-boss state keyed by uid |
| `src/enemies/hostile.ts` | hostile projectile kinds `sfdGoo` (lobbed, `contact: false`, hurts on landing), `sfdOrbG`, `sfdOrbR` |
| `src/enemies/marks.ts` | pooled ground markers: warning circles, charge lanes, toxic puddles, boss rings |
| `src/director/timeline.ts` | ten one-minute phases, events, elites, boss schedule (3:00 / 6:00 / 9:00) |

`Director.hpScale(t)` / `dmgScale(t)` scale enemy stats over time; hard cap 640 alive.

## Combat

- `hitEnemy(i, baseDamage, weaponId, {kb, fromX, fromZ, dirX, dirZ, slow, slowTime, freeze, noCrit, silent, color})`
  in `src/combat/damage.ts` applies might, crit, variance, knockback, flash,
  damage number, stats and kills. Returns true if killed.
- `hitCircle(x, z, r, base, weaponId, opts)` for AoE.
- `G.projectiles.registerKind(name, {geometry, material, faceVelocity, spin, tumble, capacity})`
  once, then `G.projectiles.spawn({kind, x, z, y, vx, vz, damage, radius, life, pierce, source, kb, homing, scale, hostile, rehit, hit, update, onHit, onExpire, data})`.
  `hostile: true` projectiles damage the player. `contact: false` skips all
  collisions (scripted/visual projectiles). Zero-damage projectiles never call `hitEnemy`.
- `G.player.takeDamage(n)`; contact damage is handled by EnemyManager.

## Weapons & passives

`WeaponDef` (`src/weapons/types.ts`): `id, name, maxLevel (8), icon, color,
describe(level), lines(level), evolution {requires: passiveId, name, describe, icon}, create()`.
`Weapon` subclasses implement `update(dt)`; helpers `cd()`, `area()`, `amount()`,
`duration()`, `projSpeed()`; `evolved` flag; `onLevelUp/onEvolve/dispose`.
Registry: `src/weapons/registry.ts`. Passives: `src/upgrades/passives.ts`.
Evolution: weapon at max level + owning the passive → next chest evolves it.
Weapon-side effect layers (`VFX.sparkles/decals/dark/domes/bolts`, `SpriteBatch`),
the `liveSlot/aoeHit` helpers and the `?wtest=…&wlv=&wevo=1&wonly=1&wpas=…`
loadout params are documented in `src/weapons/README.md`.

## FX

`G.fx.ring(x, z, {radius, color, life, width})`, `flash(x, z, {radius, color, life})`,
`slashArc(x, z, dirX, dirZ, {radius, arc, color, life})`,
`lightning(x1, y1, z1, x2, y2, z2, {color, width, jitter})`,
`burst(x, y, z, {count, color, speed, life, size, gravity, up, additive, dirX, dirZ, spread})`,
`explosion(x, z, radius, color, shake)`, `hitSpark`, `enemyDeath`,
`G.fx.particles.emit(...)`.

Helpers: `explosionEx, vortex, rune, pillar, decal, telegraph, sparkle, glowBall,
flare, smoke, impact, thorns, bossDeath`; `vortex/rune/decal/telegraph` return a
handle for `move()/cancel()/alive()`. Game feel: `G.fx.shake(amount)` (respects
the user's shake setting `G.fx.shakeScale`, localStorage `sfd.shake`),
`hitStop(seconds, scale)`, `slowMo(seconds, scale)`. Full reference: the JSDoc at
the top of `src/fx/Fx.ts`. Overlay: `G.overlay.screenFlash(color, strength, time)`.

## Level-up systems

- `recommend(choices)` (`src/weapons/recommend.ts`) scores the offered cards like a
  good player (evolution > low-HP heal > evolution catalyst > levelling owned weapons
  > new weapon early > strong passives > gold). It drives the "แนะนำ" badge, the
  10 s timer pick, AUTO mode and the autoplay bot.
- Level-up screen: decision timer (`Meta.data.pickTimer`, `Meta.pickSeconds()`,
  0 = unlimited) picks the recommended card when it runs out; reroll / skip / banish
  charges per run = 1 + shop level (`reroll`, `skip`, `banish`), see
  `WeaponSystem.charges/banished/useCharge/banish/skipLevel` and
  `rollChoices(count?, {exclude, avoid, anyKind})`.
- AUTO mode (`Meta.data.autoPick`): no modal, `Game.autoLevelUp` applies one level
  every 0.25 s; chests close by themselves. Toggle on the level-up screen, pause,
  settings and the in-play chip (`src/ui/autoChip.ts`). `Screens.update()` runs
  every frame.

## Ultimates

`G.player.ult` (`src/player/Ultimate.ts`): charge 0..1 from kills (weighted by
enemy XP, cost grows with run time), `ready`, `tryCast()`, `reset()`. Each hero's
`HeroDef.ultimate` (`src/player/ultimates/*`, README there) has a Thai name/desc,
icon and effect. HUD button `.hud-ult` (bottom-right, `onTap`), Space on desktop.
Emits `ultCast`. Shop upgrade `ultCharge` raises `stats.ultCharge`.

## Run modifiers & stages

`G.mods` (`RunMods`: hp, dmg, speed, density, gold) apply to every enemy spawn,
the director's crowd size and coins. `G.stageId` selects a `StageDef`
(`src/stages/stages.ts`: timeline, events, world theme, `requires` for the
unlock); the Director loads its timeline on reset. `Game.startRun` calls
`applyRunSetup()` (`src/meta/runSetup.ts`) before `G.director.reset()`, which
sets `G.stageId`, `G.curse` and `G.mods` from the menu selection (or the debug
params). Nothing may overwrite them after that.

Stages (details and roster in `src/stages/README.md`):
- `meadow` ทุ่งหญ้าต้องสาป: the original timeline (`timeline.ts`).
- `snow` สุสานหิมะ (`timelineSnow.ts`): unlocked by winning meadow once or
  surviving 6:00 there. Enemies `frostWolf`, `iceZombie`, `snowImp`, `yeti`
  (models `modelsSnow.ts`, AI `snowAi.ts`), final boss `bossFrost`
  (`bossFrost.ts`), `blizzard` run events (`Weather`), boss events may carry
  `hpMul`. Frost slows the hero via `chillPlayer()` (`src/enemies/chill.ts`)
  → `Player.moveMul`; the HUD portrait turns icy while chilled.
- World: `G.world.setTheme(id)` switches ground branch, decor set, fog,
  lights, vignette and snowfall (`themes.ts`, `DecorSnow.ts`, `Snowfall.ts`);
  the world follows `stageById(G.stageId).theme` by itself, menu included.
- Ground marks (`marks.ts`) draw in at most 3 instanced draw calls.

## Meta progression

See `src/meta/README.md`.
- Curse tiers 0..10 (`src/meta/curse.ts`): per tier +20 % enemy HP, +10 %
  damage, small speed/crowd bumps, +25 % gold. Tier N+1 opens after winning
  tier N on that stage (`Meta.data.curseCleared`, selection `curseSel`).
  The HUD shows a curse chip when `G.curse > 0`.
- Unlocks: new saves start with `BASE_WEAPONS` (slash, orbit, missile, axe,
  bomb); lightning / spikes / aura and the chef hero (`HeroDef.unlock`) come
  from missions. `WeaponSystem.weaponAllowed()` filters level-up rolls.
  `Meta.migrate()` grandfathers old saves (runs > 0 keep everything).
- Missions (`src/meta/missions.ts`): 18 achievements + 3 daily missions per
  local date; emits `missionComplete` (in-run toast). `Game.endRun` owns
  bestLevel / totalKills / wins, then stage records, then missions.
- Menu: run setup (stage picker + curse stepper) above the play button,
  missions screen, codex (สมุดภาพ); UI in `src/ui/runSetupUi.ts`,
  `metaScreens.ts`, `missionToast.ts`, styles `meta.css`.

## Audio

`G.audio.sfx(name, {vol, pitch})` is safe to call every frame (throttled,
voice-limited, ~1 µs when rejected). `music(on, intensity)`: 0 = run, 1 = boss,
< 0 = menu theme (also plays automatically while `G.state === "menu"`); repeated
calls only change intensity. `applySettings()` after changing
`Meta.data.muted/musicVol/sfxVol`. AudioSys itself plays `bossDie`, `evolve`
and `nuke` on the matching events — don't play them again. See `src/audio/README.md`.

## Rules of thumb

- Mobile performance first: no per-entity meshes or draw calls, no allocations in
  hot loops, reuse pools, prefer InstancedMesh / Points / pooled meshes.
- Use `G.rng` for gameplay randomness, `Math.random` for cosmetics.
- All player-facing text in Thai.
- Original content only — no names, characters or art from existing games.
