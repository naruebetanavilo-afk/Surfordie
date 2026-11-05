# Weapons, passives & evolutions

| id | name | evolution (needs passive) | look |
|---|---|---|---|
| slash | ดาบพิฆาต | ดาบจันทราโลหิต (might) | arc slashes, crescent waves |
| orbit | ใบเลื่อยวงโคจร | วงจักรนิรันดร์ (haste) | toothed saws + glowing motion trails |
| missile | ลูกไฟวิญญาณ | ดาวตกวิญญาณ (amount) | homing spirit bolts, violet vortex hits |
| axe | ขวานบูมเมอแรง | ขวานพายุคลั่ง (armor) | spinning double-bit axes out & back, apex whirl when evolved |
| bomb | ระเบิดวิญญาณ | พายุวิญญาณ (area) | soul orbs arc onto dense clusters → dome + vortex + shock blasts |
| lightning | สายฟ้าฟาด | เทพเจ้าสายฟ้า (crit) | sky strikes + chain arcs, cracks, star sparkles |
| spikes | หนามเงามรณะ | ป่าหนามนรก (vitality) | radial lines of erupting violet thorns (+3 rings evolved) |
| aura | วงเพลิงนรก | สุริยะแผดเผา (regen) | permanent fire ring + flame wall + orbiting wisps |

Every weapon uses `cd() / area() / amount() / duration() / projSpeed()` so
passives matter; `amount` adds one projectile / orb / strike / thorn line /
axe / saw / slash / fire wisp depending on the weapon.

## Shared GPU effect layers (`vfx/`)

`VFX` (from `./vfx`) owns lazily created, ring-buffered, GPU-animated layers.
Each layer is ONE draw call (hidden when empty) and costs only a small
attribute upload when something spawns. Colours are linear `THREE.Color`s —
use `col("#hex")` (cached, never mutate).

- `VFX.sparkles.spawn/burst(...)` — billboards: `SPARK_GLOW`, `SPARK_STAR`
  (4-point sparkle), `SPARK_EMBER`, `SPARK_STEADY`; ballistic + drag in shader.
- `VFX.decals.spawn(x, z, radius, life, color, mode, ...)` — ground decals:
  `DECAL_VORTEX`, `DECAL_GLOW`, `DECAL_SHOCK`, `DECAL_CRACK`, `DECAL_TARGET`.
- `VFX.dark.spawn(..., DECAL_SCORCH)` — normal-blended dark marks.
- `VFX.domes.spawn(x, z, radius, life, color)` — translucent energy domes.
- `VFX.bolts.spawn(ax, ay, az, bx, by, bz, "#hex", width, jitter, life)` —
  camera-facing lightning ribbons (all bolts in one buffer).
- `SpriteBatch` — per-frame CPU-positioned quads (orbs, cores, blur discs).

`WeaponSystem.update` drives the clock (`VFX.begin(dt)` / `VFX.flush()`), so
effects freeze on level-up / pause and play out in slow motion after a run ends.

## Safety helpers (`util.ts`)

`liveSlot(i)` / `aoeHit(...)` skip stale enemy slots the spatial grid can
return for one frame after dead enemies are compacted (see integration notes).

## Debug params

`?wtest=bomb,spikes&wlv=8&wevo=1&wonly=1&wpas=area,might` grants specific
weapons (level `wlv`, evolved with `wevo=1`, dropping the hero's start weapon
with `wonly=1`) and max-level passives.
