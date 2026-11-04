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
}

export const SHOP: ShopUpgrade[] = [
  {
    id: "might",
    name: "พลังโจมตี",
    desc: "ดาเมจ +5% ต่อระดับ",
    maxLevel: 5,
    price: (l) => 60 * l * l,
    apply: (s, l) => (s.might += 0.05 * l),
  },
  {
    id: "hp",
    name: "พลังชีวิต",
    desc: "พลังชีวิตสูงสุด +10 ต่อระดับ",
    maxLevel: 5,
    price: (l) => 50 * l * l,
    apply: (s, l) => (s.maxHp += 10 * l),
  },
  {
    id: "armor",
    name: "เกราะ",
    desc: "ลดดาเมจที่ได้รับ 1 ต่อระดับ",
    maxLevel: 3,
    price: (l) => 120 * l * l,
    apply: (s, l) => (s.armor += l),
  },
  {
    id: "speed",
    name: "ความเร็ว",
    desc: "ความเร็วเคลื่อนที่ +4% ต่อระดับ",
    maxLevel: 3,
    price: (l) => 80 * l * l,
    apply: (s, l) => (s.moveSpeed *= 1 + 0.04 * l),
  },
  {
    id: "cooldown",
    name: "สปีดโจมตี",
    desc: "สปีดโจมตี +3% ต่อระดับ",
    maxLevel: 3,
    price: (l) => 150 * l * l,
    apply: (s, l) => (s.cooldown *= 1 - 0.03 * l),
  },
  {
    id: "magnet",
    name: "แม่เหล็ก",
    desc: "ระยะดูดของ +15% ต่อระดับ",
    maxLevel: 3,
    price: (l) => 40 * l * l,
    apply: (s, l) => (s.magnet *= 1 + 0.15 * l),
  },
  {
    id: "growth",
    name: "ปัญญา",
    desc: "ค่าประสบการณ์ +5% ต่อระดับ",
    maxLevel: 3,
    price: (l) => 100 * l * l,
    apply: (s, l) => (s.growth += 0.05 * l),
  },
  {
    id: "greed",
    name: "โลภ",
    desc: "ทองที่ได้ +10% ต่อระดับ",
    maxLevel: 3,
    price: (l) => 80 * l * l,
    apply: (s, l) => (s.greed += 0.1 * l),
  },
  {
    id: "revive",
    name: "ฟื้นคืนชีพ",
    desc: "ชุบชีวิตได้ 1 ครั้งต่อรอบ",
    maxLevel: 1,
    price: () => 1500,
    apply: (s, l) => (s.revives += l),
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
}

const KEY = "sfd.meta.v1";

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
  };
}

export const Meta = {
  data: defaults(),
  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...defaults(), ...JSON.parse(raw) };
    } catch {
      this.data = defaults();
    }
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
  applyShop(s: PlayerStats): void {
    for (const up of SHOP) {
      const l = this.level(up.id);
      if (l > 0) up.apply(s, l);
    }
  },
};
