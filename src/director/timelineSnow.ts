import type { Phase, RunEvent } from "./timeline";

/**
 * Stage "snow" (สุสานหิมะ) — 10-minute timeline. Pure data, read by the
 * Director like timeline.ts. Mixes the frozen roster (frost wolves, ice
 * zombies, snow imps, yetis) with graveyard regulars (shamblers, spirits,
 * mummies, shields). Crowd sizes run ~5 % above the meadow; blizzards are the
 * stage event. Bosses: 3:00 ยักษ์กระทิงเน่า, 6:00 ราชาซากศพ (half HP, risen
 * early), 9:00 the new พญาเหมันต์.
 */

export const SNOW_PHASES: Phase[] = [
  // 0:00 shamblers and the first ice zombies
  { from: 0, to: 60, alive: [26, 58], weights: { shambler: 3, iceZombie: 1.2 }, cluster: [1, 3], elite: 0 },
  // 1:00 frost wolves start hunting in packs
  { from: 60, to: 120, alive: [55, 100], weights: { shambler: 4, iceZombie: 2, frostWolf: 2.5, ghost: 0.8 }, cluster: [1, 3], elite: 0 },
  // 2:00 snow imps lob snowballs, shields, first elites
  {
    from: 120,
    to: 180,
    alive: [100, 158],
    weights: { shambler: 3, iceZombie: 2.5, frostWolf: 2.5, ghost: 1, snowImp: 0.9, shield: 1 },
    cluster: [2, 4],
    elite: 45,
    elites: ["iceZombie", "shield"],
  },
  // 3:00 boss 1 + mummies
  {
    from: 180,
    to: 240,
    alive: [158, 220],
    weights: { shambler: 3, iceZombie: 2.5, frostWolf: 2.6, ghost: 1, snowImp: 1.1, shield: 1.6, mummy: 1.2 },
    cluster: [2, 4],
    elite: 40,
    elites: ["iceZombie", "shield", "snowImp"],
  },
  // 4:00 yetis join
  {
    from: 240,
    to: 300,
    alive: [220, 292],
    weights: { shambler: 3, iceZombie: 2.6, frostWolf: 3, ghost: 1, snowImp: 1.2, shield: 1.8, mummy: 1.6, yeti: 0.45 },
    cluster: [2, 5],
    elite: 36,
    elites: ["yeti", "iceZombie", "shield"],
  },
  // 5:00 the graveyard fills up
  {
    from: 300,
    to: 360,
    alive: [292, 375],
    weights: { shambler: 3, iceZombie: 2.8, frostWolf: 3.2, ghost: 1.3, snowImp: 1.3, shield: 2.2, mummy: 2, yeti: 0.7 },
    cluster: [3, 6],
    elite: 32,
    elites: ["yeti", "iceZombie", "shield", "snowImp"],
  },
  // 6:00 boss 2 + dense horde
  {
    from: 360,
    to: 420,
    alive: [375, 450],
    weights: { shambler: 2.6, iceZombie: 3, frostWolf: 3.2, ghost: 1.4, snowImp: 1.5, shield: 2.4, mummy: 2.4, yeti: 0.9 },
    cluster: [3, 6],
    elite: 28,
    elites: ["yeti", "iceZombie", "shield", "snowImp"],
  },
  {
    from: 420,
    to: 480,
    alive: [450, 510],
    weights: { shambler: 2.4, iceZombie: 3.2, frostWolf: 3.4, ghost: 1.5, snowImp: 1.6, shield: 2.8, mummy: 2.8, yeti: 1.1 },
    cluster: [3, 7],
    elite: 24,
    elites: ["yeti", "iceZombie", "shield", "snowImp", "mummy"],
  },
  {
    from: 480,
    to: 540,
    alive: [510, 565],
    weights: { shambler: 2.4, iceZombie: 3.4, frostWolf: 3.6, ghost: 1.7, snowImp: 1.7, shield: 3, mummy: 3, yeti: 1.3 },
    cluster: [4, 7],
    elite: 20,
    elites: ["yeti", "iceZombie", "shield", "snowImp", "mummy"],
  },
  // 9:00 the Winter Lord + everything
  {
    from: 540,
    to: 600,
    alive: [565, 610],
    weights: { shambler: 2.4, iceZombie: 3.5, frostWolf: 3.8, ghost: 1.8, snowImp: 1.8, shield: 3.2, mummy: 3.2, yeti: 1.5 },
    cluster: [4, 8],
    elite: 18,
    elites: ["yeti", "iceZombie", "shield", "snowImp", "mummy"],
  },
];

export const SNOW_EVENTS: RunEvent[] = [
  { t: 40, kind: "swarm", id: "ghost", groups: 1, perGroup: 12, text: "วิญญาณเยือกแข็งลอยมา!" },
  { t: 75, kind: "stampede", ids: ["frostWolf"], lanes: 3, perLane: 4, speed: 8 },
  { t: 105, kind: "ring", ids: ["iceZombie", "shambler"], count: 34, text: "ซอมบี้น้ำแข็งล้อมรอบตัวคุณ!" },
  { t: 140, kind: "blizzard", duration: 22, text: "พายุหิมะมาแล้ว! ฝูงหมาป่าวิ่งตามลมมา!", ids: ["frostWolf"], packs: 2, perPack: 7 },
  { t: 172, kind: "warn", text: "เสียงคำรามดังก้องทั่วสุสานหิมะ...", color: "#9fd8ff" },
  { t: 180, kind: "boss", id: "bossBull" },
  { t: 215, kind: "swarm", id: "ghost", groups: 2, perGroup: 16, text: "ฝูงวิญญาณเยือกแข็งบุก!" },
  { t: 250, kind: "ring", ids: ["iceZombie", "mummy", "shambler"], count: 48, text: "ฝูงศพน้ำแข็งล้อมรอบตัวคุณ!" },
  { t: 285, kind: "stampede", ids: ["frostWolf", "frostWolf", "yeti"], lanes: 4, perLane: 5, speed: 7.5 },
  { t: 315, kind: "blizzard", duration: 26, text: "พายุหิมะโหมกระหน่ำ! ระวังฝูงที่มากับลม!", ids: ["frostWolf", "frostWolf", "iceZombie"], packs: 3, perPack: 7 },
  { t: 345, kind: "ring", ids: ["iceZombie", "mummy", "shield"], count: 60, text: "คลื่นศพน้ำแข็งระลอกใหญ่!" },
  { t: 352, kind: "warn", text: "ราชาซากศพลุกขึ้นจากหลุมน้ำแข็ง...", color: "#ff6b8a" },
  { t: 360, kind: "boss", id: "bossKing", hpMul: 0.5 },
  { t: 400, kind: "stampede", ids: ["frostWolf"], lanes: 4, perLane: 6, speed: 8, sides: 2 },
  { t: 430, kind: "ring", ids: ["iceZombie", "shield", "shambler"], count: 64, text: "ฝูงศพน้ำแข็งล้อมรอบตัวคุณ!" },
  { t: 460, kind: "blizzard", duration: 30, text: "พายุหิมะครั้งใหญ่! ยักษ์หิมะมากับลม!", ids: ["frostWolf", "frostWolf", "yeti"], packs: 3, perPack: 8 },
  { t: 495, kind: "ring", ids: ["shambler", "frostWolf", "mummy", "iceZombie"], count: 72, text: "คลื่นศพระลอกใหญ่!", rings: 2 },
  { t: 520, kind: "stampede", ids: ["yeti", "frostWolf", "frostWolf"], lanes: 4, perLane: 6, speed: 7, sides: 2 },
  { t: 532, kind: "warn", text: "ลมหนาวยะเยือก... พญาเหมันต์ตื่นแล้ว!", color: "#9fe8ff" },
  { t: 540, kind: "boss", id: "bossFrost" },
  { t: 570, kind: "swarm", id: "ghost", groups: 4, perGroup: 22, text: "ฝูงวิญญาณเยือกแข็งบุก!" },
  { t: 585, kind: "ring", ids: ["shambler", "mummy", "shield", "iceZombie"], count: 90, text: "คลื่นสุดท้าย! อดทนอีกนิด!", rings: 2 },
];
