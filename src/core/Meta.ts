import type { PlayerStats } from "../player/stats";

/**
 * Persistent meta progression (localStorage): banked gold, permanent shop
 * upgrades, unlocked heroes, best records and settings.
 */
export interface ShopUpgrade {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  /** price for buying level `lvl` (1-based) */
  price: (lvl: number) => number;
  apply: (s: PlayerStats, lvl: number) => void;
  /** accent colour of the shop card / icon glow */
  color?: string;
  /** short total-effect text at level `lvl` (e.g. "+15%"), shown as "now → next" */
  effect?: (lvl: number) => string;
}

const pct = (v: number): string => `+${Math.round(v * 100)}%`;

/** gently super-linear price curve: base, then ~x2.2, x3.6 ... */
const curve = (base: number) => (l: number) => Math.round((base * Math.pow(l, 1.7)) / 5) * 5;

/** reroll / skip / banish charges every run starts with before shop upgrades */
export const LEVELUP_BASE_CHARGES = 1;

/** level-up decision timer choices in seconds (0 = unlimited) */
export const PICK_TIMER_DEFAULT = 10;

export const SHOP: ShopUpgrade[] = [
  {
    id: "might",
    name: "พลังโจมตี",
    desc: "ดาเมจทุกอาวุธ +5% ต่อระดับ",
    maxLevel: 5,
    price: curve(60),
    apply: (s, l) => (s.might += 0.05 * l),
    color: "#ff4f6a",
    effect: (l) => pct(0.05 * l),
  },
  {
    id: "hp",
    name: "พลังชีวิต",
    desc: "พลังชีวิตสูงสุด +10 ต่อระดับ",
    maxLevel: 5,
    price: curve(50),
    apply: (s, l) => (s.maxHp += 10 * l),
    color: "#ff6b8a",
    effect: (l) => `+${10 * l}`,
  },
  {
    id: "armor",
    name: "เกราะ",
    desc: "ลดดาเมจที่ได้รับ 1 ต่อระดับ",
    maxLevel: 3,
    price: curve(120),
    apply: (s, l) => (s.armor += l),
    color: "#7fb2ff",
    effect: (l) => `-${l}`,
  },
  {
    id: "regen",
    name: "ฟื้นฟู",
    desc: "ฟื้นพลังชีวิต 0.3 ต่อวินาที ต่อระดับ",
    maxLevel: 3,
    price: curve(90),
    apply: (s, l) => (s.regen += 0.3 * l),
    color: "#5cdc4a",
    effect: (l) => `+${(0.3 * l).toFixed(1)}/วิ`,
  },
  {
    id: "speed",
    name: "ความเร็ว",
    desc: "ความเร็วเคลื่อนที่ +4% ต่อระดับ",
    maxLevel: 3,
    price: curve(80),
    apply: (s, l) => (s.moveSpeed *= 1 + 0.04 * l),
    color: "#3de0ff",
    effect: (l) => pct(0.04 * l),
  },
  {
    id: "cooldown",
    name: "สปีดโจมตี",
    desc: "สปีดโจมตี +3% ต่อระดับ",
    maxLevel: 3,
    price: curve(150),
    apply: (s, l) => (s.cooldown *= 1 - 0.03 * l),
    color: "#ff3d9a",
    effect: (l) => pct(0.03 * l),
  },
  {
    id: "area",
    name: "ขอบเขต",
    desc: "ขนาดการโจมตี +4% ต่อระดับ",
    maxLevel: 3,
    price: curve(110),
    apply: (s, l) => (s.area += 0.04 * l),
    color: "#c46bff",
    effect: (l) => pct(0.04 * l),
  },
  {
    id: "duration",
    name: "ระยะเวลา",
    desc: "เอฟเฟกต์อาวุธอยู่นานขึ้น +6% ต่อระดับ",
    maxLevel: 3,
    price: curve(90),
    apply: (s, l) => (s.duration += 0.06 * l),
    color: "#ffb43d",
    effect: (l) => pct(0.06 * l),
  },
  {
    id: "crit",
    name: "คริติคอล",
    desc: "โอกาสคริติคอล +2% ต่อระดับ",
    maxLevel: 3,
    price: curve(120),
    apply: (s, l) => (s.critChance += 0.02 * l),
    color: "#ff9b3d",
    effect: (l) => pct(0.02 * l),
  },
  {
    id: "magnet",
    name: "แม่เหล็ก",
    desc: "ระยะดูดของ +15% ต่อระดับ",
    maxLevel: 3,
    price: curve(40),
    apply: (s, l) => (s.magnet *= 1 + 0.15 * l),
    color: "#ff6b6b",
    effect: (l) => pct(0.15 * l),
  },
  {
    id: "growth",
    name: "ปัญญา",
    desc: "ค่าประสบการณ์ +5% ต่อระดับ",
    maxLevel: 3,
    price: curve(100),
    apply: (s, l) => (s.growth += 0.05 * l),
    color: "#2fcf4a",
    effect: (l) => pct(0.05 * l),
  },
  {
    id: "greed",
    name: "โลภ",
    desc: "ทองที่ได้ +10% ต่อระดับ",
    maxLevel: 3,
    price: curve(80),
    apply: (s, l) => (s.greed += 0.1 * l),
    color: "#ffd23f",
    effect: (l) => pct(0.1 * l),
  },
  {
    id: "luck",
    name: "โชค",
    desc: "โอกาสได้การ์ดเพิ่มและหีบดีขึ้น +8% ต่อระดับ",
    maxLevel: 3,
    price: curve(90),
    apply: (s, l) => (s.luck += 0.08 * l),
    color: "#7dff6a",
    effect: (l) => pct(0.08 * l),
  },
  {
    id: "amount",
    name: "ทวีคูณ",
    desc: "จำนวนกระสุน/ชิ้นของทุกอาวุธ +1",
    maxLevel: 1,
    price: () => 2400,
    apply: (s, l) => (s.amount += l),
    color: "#ffd23f",
    effect: (l) => `+${l}`,
  },
  {
    id: "revive",
    name: "ฟื้นคืนชีพ",
    desc: "ชุบชีวิตได้ 1 ครั้งต่อรอบ",
    maxLevel: 1,
    price: () => 1500,
    apply: (s, l) => (s.revives += l),
    color: "#fff3a6",
    effect: (l) => `${l} ครั้ง`,
  },
  {
    id: "ultCharge",
    name: "ชาร์จไม้ตาย",
    desc: "เกจไม้ตายชาร์จเร็วขึ้น 8% ต่อระดับ",
    maxLevel: 5,
    price: (l) => Math.round(160 * Math.pow(1.7, l)),
    apply: (s, l) => (s.ultCharge += 0.08 * l),
    color: "#ffb347",
    effect: (l) => pct(0.08 * l),
  },
  // ---- level-up helpers: charges per run on the level-up screen (base 1 each).
  // They are not player stats: WeaponSystem reads Meta.level(id) at run start.
  {
    id: "reroll",
    name: "สุ่มใหม่",
    desc: "สุ่มการ์ดเลเวลอัปใหม่ได้ +1 ครั้งต่อรอบ",
    maxLevel: 3,
    price: curve(70),
    apply: () => {},
    color: "#3de0ff",
    effect: (l) => `${LEVELUP_BASE_CHARGES + l} ครั้ง`,
  },
  {
    id: "skip",
    name: "ข้าม",
    desc: "ข้ามการเลือกแล้วรับทองแทน +1 ครั้งต่อรอบ",
    maxLevel: 2,
    price: curve(50),
    apply: () => {},
    color: "#ffb43d",
    effect: (l) => `${LEVELUP_BASE_CHARGES + l} ครั้ง`,
  },
  {
    id: "banish",
    name: "ตัดทิ้ง",
    desc: "ตัดการ์ดที่ไม่อยากได้ออกจากรอบนี้ +1 ครั้งต่อรอบ",
    maxLevel: 3,
    price: curve(90),
    apply: () => {},
    color: "#ff4f6a",
    effect: (l) => `${LEVELUP_BASE_CHARGES + l} ครั้ง`,
  },
];

export interface MetaData {
  gold: number;
  shop: Record<string, number>;
  unlocked: string[];
  bestTime: number;
  bestKills: number;
  runs: number;
  muted: boolean;
  musicVol: number;
  sfxVol: number;
  lastHero: string;
  // ---- added by the UI pass (all optional-in-practice: defaults fill old saves)
  /** highest level reached in a run */
  bestLevel: number;
  /** number of 10-minute victories */
  wins: number;
  /** lifetime kills */
  totalKills: number;
  /** show the FPS / perf line in the HUD */
  showFps: boolean;
  /** the "drag to move" hint has been completed once */
  tutorialDone: boolean;
  // ---- level-up systems
  /** AUTO mode: level-ups apply the recommended card without pausing; chests close by themselves */
  autoPick: boolean;
  /** level-up decision time in seconds; 0 = unlimited */
  pickTimer: number;
  // ---- meta progression (wave 2). Every field has a sanitize-friendly default.
  /** save schema step: 0 = saved before meta progression existed (see migrate) */
  metaVer: number;
  /** weapon ids that may appear in level-up rolls (a hero's start weapon is always allowed) */
  unlockedWeapons: string[];
  /** stage picked in the run setup */
  lastStage: string;
  /** highest curse tier won, per stage id (missing = never won there) */
  curseCleared: Record<string, number>;
  /** curse tier picked in the run setup, per stage id */
  curseSel: Record<string, number>;
  /** best survival time in seconds, per stage id */
  stageBest: Record<string, number>;
  /** lifetime counters for missions: bosses, elites, ults, evos, chests, gold, "win:<hero>" ... */
  counters: Record<string, number>;
  /** permanent missions completed (rewards that unlock things are applied on completion) */
  missionsDone: string[];
  /** permanent missions whose gold reward was claimed */
  missionsClaimed: string[];
  /** local date (yyyymmdd) the daily progress below belongs to */
  dailyDay: number;
  /** today's daily counters (same keys as `counters`; "level" / "time" are per-run maxima) */
  daily: Record<string, number>;
  dailyDone: string[];
  dailyClaimed: string[];
}

const KEY = "sfd.meta.v1";

/** current save schema step (see Meta.migrate) */
const META_VER = 1;

/** weapons every new save starts with; the others are unlocked by missions */
export const BASE_WEAPONS = ["slash", "orbit", "missile", "axe", "bomb"];

/**
 * Weapons and heroes that existed before meta progression: a save that had
 * already played when the feature first loaded keeps all of them unlocked.
 */
const LEGACY_WEAPONS = ["slash", "orbit", "missile", "axe", "bomb", "lightning", "spikes", "aura"];
const LEGACY_HEROES = ["knight", "mage", "ranger"];

/** the only stage before stages existed: every legacy run was played there */
const LEGACY_STAGE = "meadow";

function defaults(): MetaData {
  return {
    gold: 0,
    shop: {},
    unlocked: ["knight", "mage", "ranger"],
    bestTime: 0,
    bestKills: 0,
    runs: 0,
    muted: false,
    musicVol: 0.5,
    sfxVol: 0.8,
    lastHero: "knight",
    bestLevel: 0,
    wins: 0,
    totalKills: 0,
    showFps: false,
    tutorialDone: false,
    autoPick: false,
    pickTimer: PICK_TIMER_DEFAULT,
    metaVer: 0,
    unlockedWeapons: BASE_WEAPONS.slice(),
    lastStage: LEGACY_STAGE,
    curseCleared: {},
    curseSel: {},
    stageBest: {},
    counters: {},
    missionsDone: [],
    missionsClaimed: [],
    dailyDay: 0,
    daily: {},
    dailyDone: [],
    dailyClaimed: [],
  };
}

/** add `id` to a string list once */
function addOnce(list: string[], id: string): boolean {
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}

/**
 * Merge a parsed save over the defaults, keeping only values whose type matches
 * the default (a hand-edited or future-schema save must never crash boot).
 */
function sanitize(parsed: unknown): MetaData {
  const d = defaults();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return d;
  const src = parsed as Record<string, unknown>;
  const out = d as unknown as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const def = out[k];
    const v = src[k];
    if (v === undefined) continue;
    if (typeof def === "number") {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    } else if (Array.isArray(def)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string");
    } else if (def !== null && typeof def === "object") {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const o: Record<string, number> = {};
        for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
          if (typeof vv === "number" && Number.isFinite(vv)) o[kk] = vv;
        }
        out[k] = o;
      }
    } else if (typeof v === typeof def) {
      out[k] = v;
    }
  }
  return d;
}

export const Meta = {
  data: defaults(),
  /** true when this boot grandfathered an old save (tests / debugging) */
  grandfathered: false,
  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = sanitize(JSON.parse(raw));
    } catch {
      this.data = defaults();
    }
    this.migrate();
  },
  /**
   * One-time upgrade of saves written before meta progression. A save that
   * already has runs keeps every weapon / hero that existed then (the player
   * earned them by playing), and its old global records become the meadow's
   * (the only stage back then). A fresh save starts with BASE_WEAPONS.
   */
  migrate(): void {
    const d = this.data;
    if (d.metaVer >= META_VER) return;
    if (d.metaVer < 1 && d.runs > 0) {
      this.grandfathered = true;
      for (const id of LEGACY_WEAPONS) addOnce(d.unlockedWeapons, id);
      for (const id of LEGACY_HEROES) addOnce(d.unlocked, id);
      d.stageBest[LEGACY_STAGE] = Math.max(d.stageBest[LEGACY_STAGE] ?? 0, d.bestTime);
      if (d.wins > 0) d.curseCleared[LEGACY_STAGE] = Math.max(d.curseCleared[LEGACY_STAGE] ?? 0, 0);
    }
    d.metaVer = META_VER;
    this.save();
  },
  isWeaponUnlocked(id: string): boolean {
    return this.data.unlockedWeapons.includes(id);
  },
  /** unlock a weapon for the level-up pool; true when it was locked before */
  unlockWeapon(id: string): boolean {
    return addOnce(this.data.unlockedWeapons, id);
  },
  /** unlock a hero (mission reward); true when it was locked before */
  grantHero(id: string): boolean {
    return addOnce(this.data.unlocked, id);
  },
  /** add to a lifetime mission counter */
  count(key: string, v = 1): void {
    if (v) this.data.counters[key] = (this.data.counters[key] ?? 0) + v;
  },
  counter(key: string): number {
    return this.data.counters[key] ?? 0;
  },
  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage might be unavailable (private mode) */
    }
  },
  level(id: string): number {
    return this.data.shop[id] ?? 0;
  },
  /** price of the next level, or 0 when maxed / unknown */
  nextPrice(id: string): number {
    const up = SHOP.find((u) => u.id === id);
    if (!up) return 0;
    const lvl = this.level(id);
    return lvl >= up.maxLevel ? 0 : up.price(lvl + 1);
  },
  /** try to buy the next level of a shop upgrade. returns true on success */
  buy(id: string): boolean {
    const up = SHOP.find((u) => u.id === id);
    if (!up) return false;
    const lvl = this.level(id);
    if (lvl >= up.maxLevel) return false;
    const cost = up.price(lvl + 1);
    if (this.data.gold < cost) return false;
    this.data.gold -= cost;
    this.data.shop[id] = lvl + 1;
    this.save();
    return true;
  },
  /** total gold spent in the shop (what a refund gives back) */
  spent(): number {
    let sum = 0;
    for (const up of SHOP) {
      const l = this.level(up.id);
      for (let k = 1; k <= l; k++) sum += up.price(k);
    }
    return sum;
  },
  /** sell every shop upgrade back for its full price. returns gold refunded */
  refund(): number {
    const g = this.spent();
    this.data.gold += g;
    this.data.shop = {};
    this.save();
    return g;
  },
  isUnlocked(heroId: string): boolean {
    return this.data.unlocked.includes(heroId);
  },
  /** buy a hero for `price` gold. returns true on success (or if already owned) */
  unlockHero(heroId: string, price: number): boolean {
    if (this.isUnlocked(heroId)) return true;
    if (this.data.gold < price) return false;
    this.data.gold -= price;
    this.data.unlocked.push(heroId);
    this.save();
    return true;
  },
  /** level-up decision time in seconds, 0 = unlimited (hand-edited saves are clamped) */
  pickSeconds(): number {
    const t = this.data.pickTimer;
    return t > 0 ? Math.max(3, Math.min(60, t)) : 0;
  },
  /** turn AUTO level-up mode on/off and persist it */
  setAutoPick(on: boolean): void {
    if (this.data.autoPick === on) return;
    this.data.autoPick = on;
    this.save();
  },
  applyShop(s: PlayerStats): void {
    for (const up of SHOP) {
      const l = this.level(up.id);
      if (l > 0) up.apply(s, l);
    }
  },
};
