import { G } from "../core/G";
import { Meta } from "../core/Meta";
import { bestCurseAny } from "./runSetup";

/**
 * Missions (ภารกิจ): permanent achievements with progress over all runs, plus
 * three daily missions picked from a pool by the local date.
 *
 * Progress comes from lifetime numbers in Meta (totalKills, wins, runs,
 * bestLevel, bestTime, curse records, `counters`) plus the running run's own
 * numbers (G.stats + a few event counters) until the run is merged at its end,
 * so a mission can complete mid-run (toast) without saving every kill.
 *
 * Unlock rewards (weapons, hero) are applied the moment a mission completes;
 * the gold reward waits for the claim button on the missions screen.
 * Completions are announced with the `missionComplete` event.
 */

/**
 * What a mission measures. Sums: kills, elites, bosses, ults, evos, chests,
 * gold, runs, wins, `win:<heroId>`. Maxima: level / time (best single run),
 * curse (highest tier won on any stage), heroes (heroes with a win).
 */
export type StatKey =
  | "kills"
  | "elites"
  | "bosses"
  | "ults"
  | "evos"
  | "chests"
  | "gold"
  | "runs"
  | "wins"
  | "level"
  | "time"
  | "curse"
  | "heroes"
  | `win:${string}`;

/** UI glyph of a mission row (see ui/icons.ts UiIconName) */
export type MissionGlyph =
  | "skull"
  | "sword"
  | "bossSkull"
  | "hourglass"
  | "evolve"
  | "star"
  | "burst"
  | "chest"
  | "curse"
  | "coin"
  | "trophy"
  | "crown"
  | "retry";

export interface MissionReward {
  gold: number;
  /** weapon id unlocked on completion */
  weapon?: string;
  /** hero id unlocked on completion */
  hero?: string;
}

export interface MissionDef {
  id: string;
  /** Thai name */
  name: string;
  /** Thai goal text */
  desc: string;
  stat: StatKey;
  goal: number;
  reward: MissionReward;
  icon: MissionGlyph;
  /** daily missions only: no two of the same category on one day */
  cat?: string;
}

/** permanent achievements (order = order on the missions screen) */
export const MISSIONS: MissionDef[] = [
  { id: "a_kills1", name: "ล่าแรกพบ", desc: "กำจัดซอมบี้รวม 500 ตัว", stat: "kills", goal: 500, reward: { gold: 100 }, icon: "skull" },
  { id: "a_boss1", name: "ล้มยักษ์ตัวแรก", desc: "กำจัดบอส 1 ตัว", stat: "bosses", goal: 1, reward: { gold: 100, weapon: "lightning" }, icon: "bossSkull" },
  { id: "a_time5", name: "ทรหดอดทน", desc: "รอดชีวิตถึง 5:00 ในรอบเดียว", stat: "time", goal: 300, reward: { gold: 100, weapon: "spikes" }, icon: "hourglass" },
  { id: "a_evo1", name: "วิวัฒน์ครั้งแรก", desc: "วิวัฒนาการอาวุธ 1 ครั้ง", stat: "evos", goal: 1, reward: { gold: 150, weapon: "aura" }, icon: "evolve" },
  { id: "a_win1", name: "ผู้รอดชีวิต", desc: "รอดครบ 10 นาที (ชนะ) 1 ครั้ง", stat: "wins", goal: 1, reward: { gold: 200, hero: "chef" }, icon: "trophy" },
  { id: "a_level30", name: "เลเวลพุ่งทะยาน", desc: "ถึงเลเวล 30 ในรอบเดียว", stat: "level", goal: 30, reward: { gold: 250 }, icon: "star" },
  { id: "a_ult20", name: "ไม้ตายไม่ยั้ง", desc: "ใช้ไม้ตายรวม 20 ครั้ง", stat: "ults", goal: 20, reward: { gold: 250 }, icon: "burst" },
  { id: "a_chest15", name: "นักล่าสมบัติ", desc: "เปิดหีบสมบัติรวม 15 ใบ", stat: "chests", goal: 15, reward: { gold: 200 }, icon: "chest" },
  { id: "a_kills5k", name: "เครื่องบดซอมบี้", desc: "กำจัดซอมบี้รวม 5,000 ตัว", stat: "kills", goal: 5000, reward: { gold: 300 }, icon: "skull" },
  { id: "a_gold5k", name: "เศรษฐีกลางฝูงซอมบี้", desc: "เก็บทองรวม 5,000", stat: "gold", goal: 5000, reward: { gold: 300 }, icon: "coin" },
  { id: "a_boss10", name: "นักปราบบอส", desc: "กำจัดบอสรวม 10 ตัว", stat: "bosses", goal: 10, reward: { gold: 500 }, icon: "bossSkull" },
  { id: "a_curse1", name: "ฝ่าคำสาป", desc: "ชนะคำสาประดับ 1", stat: "curse", goal: 1, reward: { gold: 300 }, icon: "curse" },
  { id: "a_heroes3", name: "ครบทุกสาย", desc: "ชนะด้วยฮีโร่ต่างกัน 3 ตัว", stat: "heroes", goal: 3, reward: { gold: 500 }, icon: "crown" },
  { id: "a_chef", name: "เชฟผู้พิชิต", desc: "ชนะด้วยเชฟกระทะไฟ", stat: "win:chef", goal: 1, reward: { gold: 400 }, icon: "trophy" },
  { id: "a_curse3", name: "คำสาปขั้นสาม", desc: "ชนะคำสาประดับ 3", stat: "curse", goal: 3, reward: { gold: 600 }, icon: "curse" },
  { id: "a_kills25k", name: "ตำนานนักล่า", desc: "กำจัดซอมบี้รวม 25,000 ตัว", stat: "kills", goal: 25000, reward: { gold: 800 }, icon: "skull" },
  { id: "a_curse6", name: "เหนือคำสาป", desc: "ชนะคำสาประดับ 6", stat: "curse", goal: 6, reward: { gold: 1200 }, icon: "curse" },
  { id: "a_curse10", name: "ราชาคำสาป", desc: "ชนะคำสาประดับ 10", stat: "curse", goal: 10, reward: { gold: 3000 }, icon: "crown" },
];

/** daily pool: three are picked per local date, one per category */
export const DAILY_POOL: MissionDef[] = [
  { id: "d_kills", name: "กวาดล้างประจำวัน", desc: "กำจัดซอมบี้ 600 ตัว", stat: "kills", goal: 600, reward: { gold: 60 }, icon: "skull", cat: "kills" },
  { id: "d_kills2", name: "พายุสังหาร", desc: "กำจัดซอมบี้ 1,500 ตัว", stat: "kills", goal: 1500, reward: { gold: 110 }, icon: "skull", cat: "kills" },
  { id: "d_elite", name: "ล่าหัวหน้าฝูง", desc: "กำจัดศัตรูหัวหน้า (ตัวใหญ่เรืองแสง) 4 ตัว", stat: "elites", goal: 4, reward: { gold: 80 }, icon: "sword", cat: "elite" },
  { id: "d_boss", name: "ล้มบอสวันนี้", desc: "กำจัดบอส 1 ตัว", stat: "bosses", goal: 1, reward: { gold: 120 }, icon: "bossSkull", cat: "elite" },
  { id: "d_ult", name: "ไม้ตายรายวัน", desc: "ใช้ไม้ตาย 4 ครั้ง", stat: "ults", goal: 4, reward: { gold: 70 }, icon: "burst", cat: "ult" },
  { id: "d_time", name: "อึดประจำวัน", desc: "รอดชีวิตถึง 4:00 ในรอบเดียว", stat: "time", goal: 240, reward: { gold: 80 }, icon: "hourglass", cat: "run" },
  { id: "d_level", name: "โตไวใจกล้า", desc: "ถึงเลเวล 15 ในรอบเดียว", stat: "level", goal: 15, reward: { gold: 70 }, icon: "star", cat: "run" },
  { id: "d_win", name: "รอดครบวันนี้", desc: "รอดครบ 10 นาที (ชนะ) 1 ครั้ง", stat: "wins", goal: 1, reward: { gold: 200 }, icon: "trophy", cat: "run" },
  { id: "d_gold", name: "เก็บเงินเก็บทอง", desc: "เก็บทอง 250", stat: "gold", goal: 250, reward: { gold: 70 }, icon: "coin", cat: "loot" },
  { id: "d_chest", name: "เปิดหีบรับโชค", desc: "เปิดหีบสมบัติ 2 ใบ", stat: "chests", goal: 2, reward: { gold: 70 }, icon: "chest", cat: "loot" },
  { id: "d_runs", name: "ขยันฝ่าฝูง", desc: "เล่นจบ 3 รอบ", stat: "runs", goal: 3, reward: { gold: 60 }, icon: "retry", cat: "grind" },
  { id: "d_evo", name: "วิวัฒน์วันนี้", desc: "วิวัฒนาการอาวุธ 1 ครั้ง", stat: "evos", goal: 1, reward: { gold: 120 }, icon: "evolve", cat: "grind" },
];

export const DAILY_COUNT = 3;

/** stats that keep the best single value instead of adding up */
const MAX_STATS: ReadonlySet<string> = new Set(["level", "time", "curse", "heroes"]);

export function isMaxStat(stat: StatKey): boolean {
  return MAX_STATS.has(stat);
}

/** local calendar day as yyyymmdd (`?day=20261107` overrides for tests) */
export function todayKey(): number {
  try {
    const q = new URLSearchParams(location.search).get("day");
    const n = q ? parseInt(q, 10) : NaN;
    if (n > 19000101 && n < 30000101) return n;
  } catch {
    /* no location */
  }
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** milliseconds until the next local midnight (daily reset) */
export function msToReset(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

/** small deterministic PRNG (mulberry32) for the daily pick */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dailyCache = { day: -1, list: [] as MissionDef[] };

/** the daily missions of a date: shuffled pool, first one of each category */
export function dailyFor(day: number): MissionDef[] {
  if (dailyCache.day === day) return dailyCache.list;
  const rnd = prng(Math.imul(day, 2654435761) ^ 0x5f3759df);
  const pool = DAILY_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  const out: MissionDef[] = [];
  const cats = new Set<string>();
  for (const m of pool) {
    if (out.length >= DAILY_COUNT) break;
    if (m.cat && cats.has(m.cat)) continue;
    if (m.cat) cats.add(m.cat);
    out.push(m);
  }
  dailyCache.day = day;
  dailyCache.list = out;
  return out;
}

/** the mission whose reward unlocks a weapon / hero (codex lock text) */
export function unlockSource(kind: "weapon" | "hero", id: string): MissionDef | undefined {
  return MISSIONS.find((m) => (kind === "weapon" ? m.reward.weapon === id : m.reward.hero === id));
}

/** payload of the `missionComplete` event and of the results screen list */
export interface MissionDone {
  def: MissionDef;
  daily: boolean;
}

/**
 * Tracks the running run, merges it into Meta at the end, completes missions
 * and handles claims. One instance: `Missions`.
 */
class MissionTracker {
  private hooked = false;
  /** a run is in progress and its numbers are not merged into Meta yet */
  private active = false;
  /** per-run event counters (the rest comes from G.stats / G.player) */
  readonly run = { elites: 0, ults: 0, evos: 0, chests: 0 };
  /** missions completed during the current / last run (results screen) */
  readonly runDone: MissionDone[] = [];
  private checkT = 0;

  /** hook the event bus once (G.events must exist) */
  init(): void {
    if (this.hooked || !G.events) return;
    this.hooked = true;
    const ev = G.events;
    ev.on("runStart", () => {
      this.rollDay();
      this.active = true;
      this.run.elites = this.run.ults = this.run.evos = this.run.chests = 0;
      this.runDone.length = 0;
      this.checkT = 0.5;
    });
    ev.on("enemyKilled", (e) => {
      if (this.active && e.elite && !e.boss) this.run.elites++;
    });
    ev.on("ultCast", () => {
      if (this.active) this.run.ults++;
    });
    ev.on("upgradeApplied", (e) => {
      if (this.active && e.kind === "evolve") this.run.evos++;
    });
    ev.on("pickup", (e) => {
      if (this.active && e.kind === "chest") this.run.chests++;
    });
  }

  /** a run is being tracked (not merged yet) */
  get running(): boolean {
    return this.active;
  }

  /** the running run's own value of a stat (0 when no run is tracked) */
  private runValue(stat: StatKey): number {
    if (!this.active) return 0;
    switch (stat) {
      case "kills":
        return G.stats.kills;
      case "bosses":
        return G.stats.bossesKilled;
      case "gold":
        return Math.floor(G.stats.gold);
      case "elites":
      case "ults":
      case "evos":
      case "chests":
        return this.run[stat];
      case "level":
        return G.player.level;
      case "time":
        return Math.floor(G.time);
      default:
        return 0;
    }
  }

  /** lifetime progress of a stat, including the running run */
  value(stat: StatKey): number {
    const d = Meta.data;
    const run = this.runValue(stat);
    switch (stat) {
      case "kills":
        return d.totalKills + run;
      case "wins":
        return d.wins;
      case "runs":
        return d.runs;
      case "level":
        return Math.max(d.bestLevel, run);
      case "time":
        return Math.max(Math.floor(d.bestTime), run);
      case "curse":
        return Math.max(0, bestCurseAny());
      case "heroes": {
        let n = 0;
        for (const k of Object.keys(d.counters)) if (k.startsWith("win:") && d.counters[k] > 0) n++;
        return n;
      }
      default:
        return Meta.counter(stat) + run;
    }
  }

  /** today's progress of a daily stat, including the running run */
  dailyValue(stat: StatKey): number {
    this.rollDay();
    const v = Meta.data.daily[stat] ?? 0;
    const run = this.runValue(stat);
    return isMaxStat(stat) ? Math.max(v, run) : v + run;
  }

  /** 0..goal progress of a mission */
  progress(m: MissionDef, daily: boolean): number {
    return Math.min(m.goal, daily ? this.dailyValue(m.stat) : this.value(m.stat));
  }

  isDone(m: MissionDef, daily: boolean): boolean {
    return (daily ? Meta.data.dailyDone : Meta.data.missionsDone).includes(m.id);
  }

  isClaimed(m: MissionDef, daily: boolean): boolean {
    return (daily ? Meta.data.dailyClaimed : Meta.data.missionsClaimed).includes(m.id);
  }

  /** today's three daily missions */
  today(): MissionDef[] {
    return dailyFor(this.rollDay());
  }

  /** reset the daily progress when the local date changed; returns today's key */
  rollDay(): number {
    const day = todayKey();
    const d = Meta.data;
    if (d.dailyDay !== day) {
      d.dailyDay = day;
      d.daily = {};
      d.dailyDone = [];
      d.dailyClaimed = [];
    }
    return day;
  }

  /** completed missions whose gold is waiting on the missions screen */
  claimable(): number {
    let n = 0;
    const d = Meta.data;
    for (const id of d.missionsDone) if (!d.missionsClaimed.includes(id)) n++;
    for (const m of this.today()) if (d.dailyDone.includes(m.id) && !d.dailyClaimed.includes(m.id)) n++;
    return n;
  }

  /** claim a completed mission's gold; returns the gold added (0 = nothing to claim) */
  claim(m: MissionDef, daily: boolean): number {
    const d = Meta.data;
    if (daily) this.rollDay();
    const done = daily ? d.dailyDone : d.missionsDone;
    const claimed = daily ? d.dailyClaimed : d.missionsClaimed;
    if (!done.includes(m.id) || claimed.includes(m.id)) return 0;
    claimed.push(m.id);
    d.gold += m.reward.gold;
    Meta.save();
    return m.reward.gold;
  }

  /**
   * Complete every mission whose goal is reached: applies unlock rewards,
   * saves, emits `missionComplete`. Returns the newly completed missions.
   */
  check(): MissionDone[] {
    const d = Meta.data;
    const fresh: MissionDone[] = [];
    for (const m of MISSIONS) {
      if (d.missionsDone.includes(m.id) || this.value(m.stat) < m.goal) continue;
      d.missionsDone.push(m.id);
      if (m.reward.weapon) Meta.unlockWeapon(m.reward.weapon);
      if (m.reward.hero) Meta.grantHero(m.reward.hero);
      fresh.push({ def: m, daily: false });
    }
    for (const m of this.today()) {
      if (d.dailyDone.includes(m.id) || this.dailyValue(m.stat) < m.goal) continue;
      d.dailyDone.push(m.id);
      fresh.push({ def: m, daily: true });
    }
    if (fresh.length) {
      Meta.save();
      for (const f of fresh) {
        if (this.active || G.state === "victory" || G.state === "gameover") this.runDone.push(f);
        G.events?.emit("missionComplete", {
          id: f.def.id,
          name: f.def.name,
          daily: f.daily,
          gold: f.def.reward.gold,
          weapon: f.def.reward.weapon,
          hero: f.def.reward.hero,
        });
      }
    }
    return fresh;
  }

  /** per-frame: re-check a few times a second while a run is playing */
  tick(dt: number): void {
    if (!this.active || G.state !== "playing") return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 0.4;
    this.check();
  }

  /** add the run's numbers to the lifetime counters and today's progress */
  private merge(victory: boolean, finished: boolean): void {
    this.rollDay();
    const d = Meta.data;
    const day = d.daily;
    const add = (k: StatKey, v: number): void => {
      if (!v) return;
      Meta.count(k, v);
      day[k] = (day[k] ?? 0) + v;
    };
    add("bosses", G.stats.bossesKilled);
    add("elites", this.run.elites);
    add("ults", this.run.ults);
    add("evos", this.run.evos);
    add("chests", this.run.chests);
    day.kills = (day.kills ?? 0) + G.stats.kills;
    if (finished) {
      add("gold", Math.floor(G.stats.gold));
      day.runs = (day.runs ?? 0) + 1;
      day.level = Math.max(day.level ?? 0, G.player.level);
      day.time = Math.max(day.time ?? 0, Math.floor(G.time));
      if (victory) {
        day.wins = (day.wins ?? 0) + 1;
        Meta.count("win:" + G.heroId);
      }
    }
  }

  /**
   * The run ended (Game.endRun, after it updated totalKills / runs / wins /
   * records and the stage records). Merges, completes missions and returns
   * everything completed during this run.
   */
  endRun(victory: boolean): MissionDone[] {
    if (this.active) {
      this.active = false;
      this.merge(victory, true);
    }
    this.check();
    return this.runDone.slice();
  }

  /**
   * The player quit mid-run: kills and other event counters still count
   * (gold is not banked, so neither is the gold counter).
   */
  abandonRun(): void {
    if (!this.active) return;
    this.active = false;
    Meta.data.totalKills += G.stats.kills;
    this.merge(false, false);
    this.check();
    Meta.save();
  }
}

export const Missions = new MissionTracker();
