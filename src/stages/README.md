# Stages

A stage (`StageDef` in `stages.ts`) is one 10-minute map: a spawn timeline
(`phases` + scripted `events`, see `src/director/timeline.ts`) and a world look
(`theme`, see `src/world/themes.ts`). `G.stageId` picks it:

- the **Director** loads the timeline of `G.stageId` on every run start
  (`Director.reset → loadStage`);
- the **World** follows `stageById(G.stageId).theme` every frame (menu
  included) — ground pattern, decor set, fog/background, light tint,
  vignette and snowfall. `G.world.setTheme(id)` switches directly.

Debug: `?stage=<id>` overrides `G.stageId` at boot and on every run start
(`debugStageId()`), e.g. `?stage=snow&skipmenu=1&god=1`. `lineup=1` shows the
enemy roster of the current stage (`stageRoster()`), `boss=<id>` spawns a boss.

## Stages

| id | name | theme | bosses | unlock |
|---|---|---|---|---|
| `meadow` | ทุ่งหญ้าต้องสาป | grass field | 3:00 bossBull, 6:00 bossWitch, 9:00 bossKing | open |
| `snow` | สุสานหิมะ | snowy frozen graveyard + snowfall | 3:00 bossBull, 6:00 bossKing (half HP), 9:00 **bossFrost** | win `meadow` |

### สุสานหิมะ (`snow`)

Timeline: `src/director/timelineSnow.ts` (crowds ~5 % above the meadow).
Stage event: **blizzard** (`kind: "blizzard"`, 2:20 / 5:15 / 7:40): Thai banner,
heavy snow + white haze + frosted screen edges (`Weather.storm`), the wind
pushes the hero gently downwind and packs charge in from upwind.

Frozen roster (`src/enemies/modelsSnow.ts`, `snowAi.ts`, `bossFrost.ts`):

| id | Thai | behaviour |
|---|---|---|
| `frostWolf` | หมาป่าน้ำแข็ง | fast pack runner: flanks, crouches (white flash 0.42 s), lunges |
| `iceZombie` | ซอมบี้น้ำแข็ง | sturdy lurcher; touching it **chills** the hero (slower moves) |
| `snowImp` | ภูตปาหิมะ | keeps distance, lobs snowballs (blue landing circle) that chill and leave a frost patch |
| `yeti` | ยักษ์หิมะ | slow giant; red circle telegraph → ground pound (damage + chill + shove) |
| `bossFrost` | พญาเหมันต์ | icicle rain (blue circles), frost-breath cone, racing ice-spike lanes, wolf-pack summons; at 50 % HP calls a blizzard and attacks faster |

Chill (`src/enemies/chill.ts`) slows the hero without touching stats: after
`Player.update` the Director gives back part of the frame's displacement.

## Adding a stage

1. Write a timeline module in `src/director/` (`Phase[]` + `RunEvent[]`).
2. If it needs a new look, add a `WorldTheme` in `src/world/themes.ts`
   (ground branch in `Ground.ts`, decor set in `Decor.ts` `DECOR_SETS`).
3. Append a `StageDef` to `STAGES` with `requires` set to the previous stage.
