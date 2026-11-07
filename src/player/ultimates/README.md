# Ultimates (ไม้ตาย)

One original ultimate per hero, charged by fighting and cast with the big
round HUD button (bottom-right thumb zone), a second finger while the joystick
is held, or **Space** on desktop.

| hero | ultimate | effect | file |
|---|---|---|---|
| knight อัศวินถังเหล็ก | ป้อมเหล็กถล่มปฐพี | leaps in a golden iron shell (2.6 s invulnerable), slams: crater + 3 ever wider shockwave rings (6.5 / 9.5 / 13 u), heavy damage, horde hurled back, slow | `knight.ts` |
| mage จอมเวทฝึกหัด | พายุดาวหางมนตรา | ~2.7 s of 24+ comets on the densest groups on screen (dome + vortex scar each), giant finale comet | `mage.ts` |
| ranger พรานขวานบิน | ระบำพายุขวาน | ~3.8 s whirlwind: rotating spiral arms of piercing spirit axes, closing ring of 18 axes | `ranger.ts` |

## Runtime

- `G.player.ult` (`src/player/Ultimate.ts`): `charge` 0..1, `ready`, `active`,
  `activeFrac`, `tryCast()`, `reset(def)`, `update(dt)`, `need()`, `killRate`,
  `casts`, `stat` (probe counters). Updated from `Player.update`, so it only
  runs while `G.state === "playing"` and freezes with the game.
- Charge: xp-weighted kills (elite x10, boss +0.3 flat) / `need()`, plus a
  1/150 per second trickle. `need()` follows the run clock (fitted to typical
  kill rates → a cast every ~45-55 s for an average player, ~60-75 s weak,
  ~30-40 s strong) with a rolling kill-rate floor and +6% per cast (max 6).
  Runs start at 20%. Kills by the ultimate itself and kills while it plays do
  not charge it. `stats.ultCharge` (optional stat) multiplies all gains.
- Damage: base x `G.director.hpScale(G.time)` (tracks enemy HP growth), then
  might/crit in `hitEnemy`. Bosses take full damage but are never pushed.
  Damage source ids: `ultKnight`, `ultMage`, `ultRanger` (`G.stats.damageBy`).
- Autoplay: the bot casts ~0.6 s after the meter fills once 8+ enemies are
  within 7 units (or after 4 s).
- Cast juice: slow-mo, screen flash, shake, hero pose + golden glow, HUD
  cut-in banner (`G.hud.ultCast(def)`) with the hero portrait and the name.

## Adding an ultimate

1. Write an `UltEffect` (`types.ts`): `prepare()` creates every mesh /
   projectile kind / sprite batch (boot shader prewarm: Player's first reset
   runs before `prewarmShaders`, and `renderer.compile` only sees visible
   objects, so do not hide them in `prepare`), `start(cast)`, `update(dt)`
   returning false when done, `stop()` cleaning up (hides batches, kills own
   projectiles by token).
2. Export an `UltimateDef` (Thai `name`/`desc`, `color`, `flash`, `icon`,
   `duration`, `invuln`, `pose`: `"slam" | "channel" | "spin"`) and set it as
   `ultimate` on the `HeroDef` in `heroes.ts`.
3. Keep hot paths allocation-free: `enemiesIn()` (shared buffer), `HitOnce`
   for expanding waves, reuse `HitOpts` objects, pool per-projectile data.
