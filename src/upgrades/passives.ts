import type { PassiveDef } from "../weapons/types";
import { iconBg, type IconDraw } from "../ui/icons";

function glyph(color: string, draw: (c: CanvasRenderingContext2D, s: number) => void): IconDraw {
  return (c, s) => {
    iconBg(c, s, color);
    c.save();
    c.fillStyle = color;
    c.strokeStyle = "#0d0f14";
    c.lineWidth = s * 0.05;
    draw(c, s);
    c.restore();
  };
}

function poly(c: CanvasRenderingContext2D, pts: number[], s: number): void {
  c.beginPath();
  c.moveTo(pts[0] * s, pts[1] * s);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] * s, pts[i + 1] * s);
  c.closePath();
  c.fill();
  c.stroke();
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const PASSIVES: PassiveDef[] = [
  {
    id: "might",
    name: "กำปั้นเหล็ก",
    maxLevel: 5,
    color: "#ff5a5a",
    icon: glyph("#ff5a5a", (c, s) => {
      c.beginPath();
      c.roundRect(s * 0.27, s * 0.3, s * 0.46, s * 0.42, s * 0.1);
      c.fill();
      c.stroke();
      c.fillStyle = "#ffd0d0";
      for (let i = 0; i < 3; i++) c.fillRect(s * (0.32 + i * 0.13), s * 0.33, s * 0.08, s * 0.1);
    }),
    describe: () => "ดาเมจทุกอย่าง +10%",
    lines: () => ["ดาเมจ +10%"],
    apply: (s, l) => (s.might += 0.1 * l),
  },
  {
    id: "haste",
    name: "นาฬิกาเร่ง",
    maxLevel: 5,
    color: "#5ad1ff",
    icon: glyph("#5ad1ff", (c, s) => {
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.26, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.strokeStyle = "#0d0f14";
      c.beginPath();
      c.moveTo(s / 2, s / 2);
      c.lineTo(s / 2, s * 0.32);
      c.moveTo(s / 2, s / 2);
      c.lineTo(s * 0.64, s * 0.56);
      c.stroke();
    }),
    describe: () => "สปีดโจมตี +8% (คูลดาวน์ลดลง)",
    lines: () => ["สปีดโจมตี +8%"],
    apply: (s, l) => (s.cooldown *= Math.pow(0.92, l)),
  },
  {
    id: "area",
    name: "คัมภีร์ขยาย",
    maxLevel: 5,
    color: "#b07cff",
    icon: glyph("#b07cff", (c, s) => {
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.28, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.14, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }),
    describe: () => "ขอบเขตการโจมตี +10%",
    lines: () => ["ขอบเขต +10%"],
    apply: (s, l) => (s.area += 0.1 * l),
  },
  {
    id: "vitality",
    name: "หัวใจยักษ์",
    maxLevel: 5,
    color: "#ff6b9a",
    icon: glyph("#ff6b9a", (c, s) => {
      c.beginPath();
      c.moveTo(s / 2, s * 0.74);
      c.bezierCurveTo(s * 0.12, s * 0.48, s * 0.28, s * 0.18, s / 2, s * 0.36);
      c.bezierCurveTo(s * 0.72, s * 0.18, s * 0.88, s * 0.48, s / 2, s * 0.74);
      c.fill();
      c.stroke();
    }),
    describe: () => "พลังชีวิตสูงสุด +20",
    lines: () => ["พลังชีวิต +20"],
    apply: (s, l) => (s.maxHp += 20 * l),
  },
  {
    id: "swift",
    name: "รองเท้าลม",
    maxLevel: 5,
    color: "#7dffb0",
    icon: glyph("#7dffb0", (c, s) => poly(c, [0.25, 0.3, 0.45, 0.3, 0.48, 0.55, 0.75, 0.62, 0.75, 0.72, 0.25, 0.72], s)),
    describe: () => "ความเร็วเคลื่อนที่ +8%",
    lines: () => ["ความเร็ว +8%"],
    apply: (s, l) => (s.moveSpeed *= 1 + 0.08 * l),
  },
  {
    id: "magnet",
    name: "แม่เหล็กวิญญาณ",
    maxLevel: 5,
    color: "#ff8a5a",
    icon: glyph("#ff8a5a", (c, s) => {
      c.lineWidth = s * 0.14;
      c.strokeStyle = "#ff8a5a";
      c.beginPath();
      c.arc(s / 2, s * 0.45, s * 0.2, Math.PI, 0, true);
      c.stroke();
      c.fillStyle = "#e8eef5";
      c.fillRect(s * 0.23, s * 0.44, s * 0.14, s * 0.16);
      c.fillRect(s * 0.63, s * 0.44, s * 0.14, s * 0.16);
    }),
    describe: () => "ระยะดูดไอเทม +30%",
    lines: () => ["ระยะดูด +30%"],
    apply: (s, l) => (s.magnet *= 1 + 0.3 * l),
  },
  {
    id: "armor",
    name: "โล่หนาม",
    maxLevel: 5,
    color: "#c9d3dd",
    icon: glyph("#c9d3dd", (c, s) => poly(c, [0.5, 0.2, 0.76, 0.3, 0.72, 0.58, 0.5, 0.8, 0.28, 0.58, 0.24, 0.3], s)),
    describe: () => "เกราะ +1 (ลดดาเมจที่ได้รับ)",
    lines: () => ["เกราะ +1"],
    apply: (s, l) => (s.armor += l),
  },
  {
    id: "regen",
    name: "สมุนไพรฟื้นฟู",
    maxLevel: 5,
    color: "#5cff7a",
    icon: glyph("#5cff7a", (c, s) => {
      c.fillRect(s * 0.42, s * 0.24, s * 0.16, s * 0.52);
      c.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.16);
    }),
    describe: () => "ฟื้นฟูพลังชีวิต +0.4 ต่อวินาที",
    lines: () => ["ฟื้นฟู +0.4/วิ"],
    apply: (s, l) => (s.regen += 0.4 * l),
  },
  {
    id: "amount",
    name: "เงาแฝด",
    maxLevel: 2,
    color: "#ffe066",
    icon: glyph("#ffe066", (c, s) => {
      c.beginPath();
      c.arc(s * 0.4, s * 0.5, s * 0.16, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.beginPath();
      c.arc(s * 0.62, s * 0.5, s * 0.16, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }),
    describe: () => "จำนวนกระสุน/อาวุธ +1",
    lines: () => ["จำนวน +1"],
    apply: (s, l) => (s.amount += l),
  },
  {
    id: "crit",
    name: "ตาเหยี่ยว",
    maxLevel: 5,
    color: "#ffd23f",
    icon: glyph("#ffd23f", (c, s) => {
      c.beginPath();
      c.ellipse(s / 2, s / 2, s * 0.3, s * 0.18, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = "#0d0f14";
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.09, 0, Math.PI * 2);
      c.fill();
    }),
    describe: () => "โอกาสคริติคอล +6% • ดาเมจคริ +20%",
    lines: () => ["คริ +6%", "ดาเมจคริ +20%"],
    apply: (s, l) => {
      s.critChance += 0.06 * l;
      s.critMul += 0.2 * l;
    },
  },
  {
    id: "growth",
    name: "มงกุฎปราชญ์",
    maxLevel: 5,
    color: "#7cc6ff",
    icon: glyph("#7cc6ff", (c, s) => poly(c, [0.22, 0.7, 0.22, 0.34, 0.36, 0.5, 0.5, 0.28, 0.64, 0.5, 0.78, 0.34, 0.78, 0.7], s)),
    describe: () => "ค่าประสบการณ์ที่ได้ +10%",
    lines: () => ["EXP +10%"],
    apply: (s, l) => (s.growth += 0.1 * l),
  },
  {
    id: "duration",
    name: "ทรายกาลเวลา",
    maxLevel: 5,
    color: "#e0b0ff",
    icon: glyph("#e0b0ff", (c, s) => poly(c, [0.3, 0.22, 0.7, 0.22, 0.52, 0.5, 0.7, 0.78, 0.3, 0.78, 0.48, 0.5], s)),
    describe: () => "ระยะเวลาสกิล +10% • ความเร็วกระสุน +10%",
    lines: () => ["ระยะเวลา +10%", "ความเร็วกระสุน +10%"],
    apply: (s, l) => {
      s.duration += 0.1 * l;
      s.projSpeed += 0.1 * l;
    },
  },
];

export function passiveById(id: string): PassiveDef | undefined {
  return PASSIVES.find((p) => p.id === id);
}

export { pct };
