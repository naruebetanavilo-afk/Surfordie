/**
 * Run timeline data (10 minutes). Pure data: Director.ts interprets it.
 *
 * Phases set the steady stream (which types, how many alive, cluster size);
 * events are scripted moments (hordes, stampedes, swarms, bosses).
 */

export interface Phase {
  /** start / end time in seconds */
  from: number;
  to: number;
  /** target alive count, interpolated from [0] at `from` to [1] at `to` */
  alive: [number, number];
  /** relative spawn weights per enemy id */
  weights: Record<string, number>;
  /** enemies per spawn cluster [min, max] */
  cluster: [number, number];
  /** seconds between elite spawns (0 = none) */
  elite: number;
  /** ids an elite can be drawn from */
  elites?: string[];
}

export const PHASES: Phase[] = [
  // 0:00 gentle start — only shamblers trickle in
  { from: 0, to: 60, alive: [14, 48], weights: { shambler: 1 }, cluster: [1, 2], elite: 0 },
  // 1:00 runners and the first spirits
  { from: 60, to: 120, alive: [48, 95], weights: { shambler: 6, runner: 2.5, ghost: 1 }, cluster: [1, 3], elite: 0 },
  // 2:00 tougher crowd + first elites
  {
    from: 120,
    to: 180,
    alive: [95, 150],
    weights: { shambler: 5, runner: 2.5, ghost: 1, mummy: 2, shield: 1.2 },
    cluster: [2, 4],
    elite: 45,
    elites: ["shield", "mummy"],
  },
  // 3:00 ranged spitters + bloaters (boss 1 arrives)
  {
    from: 180,
    to: 240,
    alive: [150, 210],
    weights: { shambler: 4, runner: 2.5, ghost: 1, mummy: 2, shield: 2, spitter: 1, bloater: 0.7 },
    cluster: [2, 4],
    elite: 40,
    elites: ["shield", "mummy", "spitter"],
  },
  // 4:00 brutes join
  {
    from: 240,
    to: 300,
    alive: [210, 280],
    weights: { shambler: 4, runner: 3, ghost: 1, mummy: 2.2, shield: 2, spitter: 1.2, bloater: 1, brute: 0.45 },
    cluster: [2, 5],
    elite: 36,
    elites: ["brute", "shield", "mummy"],
  },
  // 5:00 the screen fills up
  {
    from: 300,
    to: 360,
    alive: [280, 360],
    weights: { shambler: 4, runner: 3, ghost: 1.4, mummy: 2.5, shield: 2.4, spitter: 1.3, bloater: 1.2, brute: 0.7 },
    cluster: [3, 6],
    elite: 32,
    elites: ["brute", "shield", "mummy", "spitter"],
  },
  // 6:00 boss 2 + dense horde
  {
    from: 360,
    to: 420,
    alive: [360, 430],
    weights: { shambler: 3.5, runner: 3, ghost: 1.5, mummy: 3, shield: 2.6, spitter: 1.5, bloater: 1.3, brute: 0.9 },
    cluster: [3, 6],
    elite: 28,
    elites: ["brute", "shield", "mummy", "spitter"],
  },
  {
    from: 420,
    to: 480,
    alive: [430, 490],
    weights: { shambler: 3, runner: 3.2, ghost: 1.6, mummy: 3.2, shield: 3, spitter: 1.6, bloater: 1.4, brute: 1.1 },
    cluster: [3, 7],
    elite: 24,
    elites: ["brute", "shield", "mummy", "spitter", "bloater"],
  },
  {
    from: 480,
    to: 540,
    alive: [490, 550],
    weights: { shambler: 3, runner: 3.4, ghost: 1.8, mummy: 3.4, shield: 3.2, spitter: 1.7, bloater: 1.5, brute: 1.3 },
    cluster: [4, 7],
    elite: 20,
    elites: ["brute", "shield", "mummy", "spitter", "bloater"],
  },
  // 9:00 final boss + everything
  {
    from: 540,
    to: 600,
    alive: [550, 600],
    weights: { shambler: 3, runner: 3.5, ghost: 2, mummy: 3.5, shield: 3.4, spitter: 1.8, bloater: 1.6, brute: 1.5 },
    cluster: [4, 8],
    elite: 18,
    elites: ["brute", "shield", "mummy", "spitter", "bloater"],
  },
];

export type RunEvent =
  | { t: number; kind: "warn"; text: string; color: string }
  | { t: number; kind: "boss"; id: string; announce?: string }
  | { t: number; kind: "ring"; ids: string[]; count: number; text: string; rings?: number }
  | { t: number; kind: "stampede"; ids: string[]; lanes: number; perLane: number; speed: number; sides?: number }
  | { t: number; kind: "swarm"; id: string; groups: number; perGroup: number; text: string };

export const EVENTS: RunEvent[] = [
  { t: 50, kind: "swarm", id: "ghost", groups: 1, perGroup: 14, text: "วิญญาณเร่ร่อนลอยมา!" },
  { t: 90, kind: "ring", ids: ["shambler"], count: 34, text: "ซอมบี้ล้อมรอบตัวคุณ!" },
  { t: 135, kind: "stampede", ids: ["runner"], lanes: 3, perLane: 5, speed: 6.5 },
  { t: 172, kind: "warn", text: "พื้นดินสั่นสะเทือน... บางสิ่งกำลังมา!", color: "#ff9b5a" },
  { t: 180, kind: "boss", id: "bossBull" },
  { t: 220, kind: "swarm", id: "ghost", groups: 2, perGroup: 18, text: "ฝูงวิญญาณบุก!" },
  { t: 260, kind: "ring", ids: ["shambler", "mummy"], count: 48, text: "ฝูงซอมบี้ล้อมรอบตัวคุณ!" },
  { t: 290, kind: "stampede", ids: ["runner", "runner", "shield"], lanes: 4, perLane: 5, speed: 6.5 },
  { t: 320, kind: "swarm", id: "ghost", groups: 3, perGroup: 20, text: "ฝูงวิญญาณบุก!" },
  { t: 345, kind: "ring", ids: ["shambler", "mummy", "shield"], count: 60, text: "คลื่นซอมบี้ระลอกใหญ่!" },
  { t: 352, kind: "warn", text: "กลิ่นหนองพิษลอยมา... ระวัง!", color: "#8cff3a" },
  { t: 360, kind: "boss", id: "bossWitch" },
  { t: 400, kind: "stampede", ids: ["runner"], lanes: 4, perLane: 6, speed: 7, sides: 2 },
  { t: 430, kind: "ring", ids: ["mummy", "shield", "shambler"], count: 64, text: "ฝูงซอมบี้ล้อมรอบตัวคุณ!" },
  { t: 465, kind: "swarm", id: "ghost", groups: 3, perGroup: 26, text: "ฝูงวิญญาณบุก!" },
  { t: 495, kind: "ring", ids: ["shambler", "runner", "mummy", "bloater"], count: 72, text: "คลื่นซอมบี้ระลอกใหญ่!", rings: 2 },
  { t: 520, kind: "stampede", ids: ["brute", "runner", "runner"], lanes: 4, perLane: 6, speed: 6, sides: 2 },
  { t: 532, kind: "warn", text: "ราชันแห่งความตายกำลังตื่น...", color: "#ff4f6a" },
  { t: 540, kind: "boss", id: "bossKing" },
  { t: 570, kind: "swarm", id: "ghost", groups: 4, perGroup: 24, text: "ฝูงวิญญาณบุก!" },
  { t: 585, kind: "ring", ids: ["shambler", "mummy", "shield", "runner"], count: 90, text: "คลื่นสุดท้าย! อดทนอีกนิด!", rings: 2 },
];
