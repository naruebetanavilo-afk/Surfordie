import type { PassiveDef } from "../weapons/types";
import { iconBg, type IconDraw } from "../ui/icons";

/**
 * Passive items. ids are stable (saves, evolutions and debug params use them).
 * Evolution catalysts: might→slash, haste→orbit, amount→missile, armor→axe,
 * area→bomb, crit→lightning, vitality→spikes, regen→aura.
 */

const INK = "#0d0f14";

function tile(glow: string, draw: (c: CanvasRenderingContext2D, s: number) => void): IconDraw {
  return (c, s) => {
    iconBg(c, s, glow);
    c.save();
    c.lineWidth = s * 0.045;
    c.strokeStyle = INK;
    c.lineJoin = "round";
    c.lineCap = "round";
    draw(c, s);
    c.restore();
  };
}

function fillStroke(c: CanvasRenderingContext2D, fill: string | CanvasGradient): void {
  c.fillStyle = fill;
  c.fill();
  c.stroke();
}

function vgrad(c: CanvasRenderingContext2D, s: number, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const g = c.createLinearGradient(0, y0 * s, 0, y1 * s);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

function sparkle(c: CanvasRenderingContext2D, x: number, y: number, r: number, color = "#ffffff"): void {
  c.save();
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.quadraticCurveTo(x, y, x, y + r);
  c.quadraticCurveTo(x, y, x - r, y);
  c.quadraticCurveTo(x, y, x, y - r);
  c.fill();
  c.restore();
}

function poly(c: CanvasRenderingContext2D, pts: number[], s: number): void {
  c.beginPath();
  c.moveTo(pts[0] * s, pts[1] * s);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] * s, pts[i + 1] * s);
  c.closePath();
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const PASSIVES: PassiveDef[] = [
  {
    id: "might",
    name: "กำปั้นเหล็ก",
    maxLevel: 5,
    color: "#ff5a5a",
    icon: tile("#ff5a5a", (c, s) => {
      // impact lines
      c.save();
      c.strokeStyle = "#ffb3a8";
      c.lineWidth = s * 0.035;
      for (const [x1, y1, x2, y2] of [
        [0.14, 0.3, 0.24, 0.36],
        [0.12, 0.5, 0.23, 0.5],
        [0.16, 0.7, 0.25, 0.63],
      ]) {
        c.beginPath();
        c.moveTo(x1 * s, y1 * s);
        c.lineTo(x2 * s, y2 * s);
        c.stroke();
      }
      c.restore();
      // gauntlet
      c.beginPath();
      c.roundRect(s * 0.3, s * 0.3, s * 0.44, s * 0.38, s * 0.1);
      fillStroke(c, vgrad(c, s, 0.3, 0.68, "#e9eef5", "#8a95a8"));
      c.beginPath();
      c.roundRect(s * 0.36, s * 0.66, s * 0.3, s * 0.14, s * 0.04);
      fillStroke(c, "#b23a3a");
      c.strokeStyle = "rgba(13,15,20,0.75)";
      c.lineWidth = s * 0.03;
      for (let i = 1; i < 4; i++) {
        c.beginPath();
        c.moveTo(s * (0.3 + i * 0.11), s * 0.31);
        c.lineTo(s * (0.3 + i * 0.11), s * 0.45);
        c.stroke();
      }
      sparkle(c, s * 0.42, s * 0.38, s * 0.05);
    }),
    describe: (l) => `ดาเมจทุกอย่าง +10% (รวม +${l * 10}%)`,
    lines: () => ["ดาเมจ +10%"],
    apply: (s, l) => (s.might += 0.1 * l),
  },
  {
    id: "haste",
    name: "นาฬิกาเร่ง",
    maxLevel: 5,
    color: "#5ad1ff",
    icon: tile("#5ad1ff", (c, s) => {
      c.save();
      c.strokeStyle = "rgba(90,209,255,0.8)";
      c.lineWidth = s * 0.04;
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.moveTo(s * 0.12, s * (0.42 + i * 0.1));
        c.lineTo(s * 0.26, s * (0.42 + i * 0.1));
        c.stroke();
      }
      c.restore();
      c.beginPath();
      c.roundRect(s * 0.5, s * 0.17, s * 0.1, s * 0.09, s * 0.02);
      fillStroke(c, "#ffcc4d");
      c.beginPath();
      c.arc(s * 0.55, s * 0.55, s * 0.27, 0, Math.PI * 2);
      fillStroke(c, vgrad(c, s, 0.28, 0.82, "#e8f8ff", "#7cc6e8"));
      c.beginPath();
      c.arc(s * 0.55, s * 0.55, s * 0.2, 0, Math.PI * 2);
      c.fillStyle = "#ffffff";
      c.fill();
      c.lineWidth = s * 0.045;
      c.beginPath();
      c.moveTo(s * 0.55, s * 0.55);
      c.lineTo(s * 0.55, s * 0.4);
      c.moveTo(s * 0.55, s * 0.55);
      c.lineTo(s * 0.67, s * 0.6);
      c.stroke();
      c.fillStyle = "#ff5a5a";
      c.beginPath();
      c.arc(s * 0.55, s * 0.55, s * 0.035, 0, Math.PI * 2);
      c.fill();
    }),
    describe: (l) => `สปีดโจมตี +8% คูลดาวน์ลดลง (รวม +${Math.round((1 / Math.pow(0.92, l) - 1) * 100)}%)`,
    lines: () => ["สปีดโจมตี +8%"],
    apply: (s, l) => (s.cooldown *= Math.pow(0.92, l)),
  },
  {
    id: "area",
    name: "คัมภีร์ขยาย",
    maxLevel: 5,
    color: "#b07cff",
    icon: tile("#b07cff", (c, s) => {
      // expanding rings
      c.save();
      for (let i = 0; i < 3; i++) {
        c.strokeStyle = `rgba(214,170,255,${0.9 - i * 0.25})`;
        c.lineWidth = s * 0.035;
        c.beginPath();
        c.ellipse(s * 0.5, s * 0.36, s * (0.12 + i * 0.09), s * (0.06 + i * 0.045), 0, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
      // open book
      c.beginPath();
      c.moveTo(s * 0.5, s * 0.58);
      c.quadraticCurveTo(s * 0.34, s * 0.5, s * 0.18, s * 0.56);
      c.lineTo(s * 0.18, s * 0.8);
      c.quadraticCurveTo(s * 0.34, s * 0.74, s * 0.5, s * 0.82);
      c.closePath();
      fillStroke(c, "#f4ecff");
      c.beginPath();
      c.moveTo(s * 0.5, s * 0.58);
      c.quadraticCurveTo(s * 0.66, s * 0.5, s * 0.82, s * 0.56);
      c.lineTo(s * 0.82, s * 0.8);
      c.quadraticCurveTo(s * 0.66, s * 0.74, s * 0.5, s * 0.82);
      c.closePath();
      fillStroke(c, "#e2d2ff");
      sparkle(c, s * 0.5, s * 0.36, s * 0.07);
    }),
    describe: (l) => `ขอบเขตการโจมตี +10% (รวม +${l * 10}%)`,
    lines: () => ["ขอบเขต +10%"],
    apply: (s, l) => (s.area += 0.1 * l),
  },
  {
    id: "vitality",
    name: "หัวใจยักษ์",
    maxLevel: 5,
    color: "#ff6b9a",
    icon: tile("#ff6b9a", (c, s) => {
      c.beginPath();
      c.moveTo(s / 2, s * 0.8);
      c.bezierCurveTo(s * 0.08, s * 0.52, s * 0.22, s * 0.14, s / 2, s * 0.34);
      c.bezierCurveTo(s * 0.78, s * 0.14, s * 0.92, s * 0.52, s / 2, s * 0.8);
      const g = c.createRadialGradient(s * 0.38, s * 0.36, s * 0.02, s * 0.5, s * 0.5, s * 0.4);
      g.addColorStop(0, "#ffd0dc");
      g.addColorStop(0.4, "#ff5a86");
      g.addColorStop(1, "#b0123f");
      fillStroke(c, g);
      c.fillStyle = "rgba(255,255,255,0.75)";
      c.beginPath();
      c.ellipse(s * 0.33, s * 0.38, s * 0.05, s * 0.08, -0.6, 0, Math.PI * 2);
      c.fill();
      sparkle(c, s * 0.76, s * 0.24, s * 0.06);
    }),
    describe: (l) => `พลังชีวิตสูงสุด +20 (รวม +${l * 20})`,
    lines: () => ["พลังชีวิต +20"],
    apply: (s, l) => (s.maxHp += 20 * l),
  },
  {
    id: "swift",
    name: "รองเท้าลม",
    maxLevel: 5,
    color: "#7dffb0",
    icon: tile("#7dffb0", (c, s) => {
      // wing
      c.beginPath();
      c.moveTo(s * 0.3, s * 0.42);
      c.quadraticCurveTo(s * 0.1, s * 0.28, s * 0.12, s * 0.18);
      c.quadraticCurveTo(s * 0.26, s * 0.3, s * 0.36, s * 0.34);
      c.quadraticCurveTo(s * 0.22, s * 0.22, s * 0.26, s * 0.12);
      c.quadraticCurveTo(s * 0.4, s * 0.26, s * 0.44, s * 0.38);
      c.closePath();
      fillStroke(c, "#ffffff");
      // boot
      poly(c, [0.34, 0.26, 0.56, 0.26, 0.58, 0.58, 0.8, 0.64, 0.82, 0.78, 0.3, 0.78], s);
      fillStroke(c, vgrad(c, s, 0.26, 0.78, "#a8ffd0", "#2fa866"));
      c.beginPath();
      c.rect(s * 0.3, s * 0.72, s * 0.52, s * 0.07);
      fillStroke(c, "#1f5a3a");
      c.save();
      c.strokeStyle = "rgba(125,255,176,0.8)";
      c.lineWidth = s * 0.03;
      c.beginPath();
      c.moveTo(s * 0.86, s * 0.5);
      c.lineTo(s * 0.7, s * 0.5);
      c.stroke();
      c.restore();
    }),
    describe: (l) => `ความเร็วเคลื่อนที่ +8% (รวม +${l * 8}%)`,
    lines: () => ["ความเร็ว +8%"],
    apply: (s, l) => (s.moveSpeed *= 1 + 0.08 * l),
  },
  {
    id: "magnet",
    name: "แม่เหล็กวิญญาณ",
    maxLevel: 5,
    color: "#ff8a5a",
    icon: tile("#ff8a5a", (c, s) => {
      c.save();
      c.lineWidth = s * 0.2;
      c.strokeStyle = INK;
      c.beginPath();
      c.arc(s / 2, s * 0.46, s * 0.19, Math.PI, 0);
      c.lineTo(s * 0.69, s * 0.66);
      c.moveTo(s * 0.31, s * 0.46);
      c.lineTo(s * 0.31, s * 0.66);
      c.stroke();
      c.lineWidth = s * 0.12;
      c.strokeStyle = "#e23b3b";
      c.beginPath();
      c.arc(s / 2, s * 0.46, s * 0.19, Math.PI, 0);
      c.lineTo(s * 0.69, s * 0.62);
      c.moveTo(s * 0.31, s * 0.46);
      c.lineTo(s * 0.31, s * 0.62);
      c.stroke();
      c.restore();
      c.fillStyle = "#e8eef5";
      c.fillRect(s * 0.25, s * 0.6, s * 0.12, s * 0.12);
      c.fillRect(s * 0.63, s * 0.6, s * 0.12, s * 0.12);
      c.strokeRect(s * 0.25, s * 0.6, s * 0.12, s * 0.12);
      c.strokeRect(s * 0.63, s * 0.6, s * 0.12, s * 0.12);
      sparkle(c, s * 0.5, s * 0.82, s * 0.05, "#7cf3ff");
      sparkle(c, s * 0.2, s * 0.86, s * 0.035, "#7cf3ff");
      sparkle(c, s * 0.8, s * 0.86, s * 0.035, "#7cf3ff");
    }),
    describe: (l) => `ระยะดูดไอเทม +30% (รวม +${l * 30}%)`,
    lines: () => ["ระยะดูด +30%"],
    apply: (s, l) => (s.magnet *= 1 + 0.3 * l),
  },
  {
    id: "armor",
    name: "โล่หนาม",
    maxLevel: 5,
    color: "#c9d3dd",
    icon: tile("#c9d3dd", (c, s) => {
      // spikes around the rim
      c.save();
      c.fillStyle = "#8a95a8";
      for (const [x, y, a] of [
        [0.5, 0.14, 0],
        [0.82, 0.3, 1.1],
        [0.18, 0.3, -1.1],
        [0.78, 0.62, 2.2],
        [0.22, 0.62, -2.2],
      ]) {
        c.save();
        c.translate(x * s, y * s);
        c.rotate(a);
        c.beginPath();
        c.moveTo(-s * 0.05, s * 0.04);
        c.lineTo(0, -s * 0.08);
        c.lineTo(s * 0.05, s * 0.04);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }
      c.restore();
      poly(c, [0.5, 0.2, 0.77, 0.3, 0.73, 0.58, 0.5, 0.82, 0.27, 0.58, 0.23, 0.3], s);
      fillStroke(c, vgrad(c, s, 0.2, 0.82, "#f2f6fa", "#7d889b"));
      poly(c, [0.5, 0.3, 0.66, 0.36, 0.63, 0.55, 0.5, 0.7, 0.37, 0.55, 0.34, 0.36], s);
      c.fillStyle = "#3d6bd9";
      c.fill();
      sparkle(c, s * 0.42, s * 0.38, s * 0.05);
    }),
    describe: (l) => `เกราะ +1 ลดดาเมจที่ได้รับทุกครั้ง (รวม ${l})`,
    lines: () => ["เกราะ +1"],
    apply: (s, l) => (s.armor += l),
  },
  {
    id: "regen",
    name: "สมุนไพรฟื้นฟู",
    maxLevel: 5,
    color: "#5cff7a",
    icon: tile("#5cff7a", (c, s) => {
      const leaf = (rot: number, color: string) => {
        c.save();
        c.translate(s * 0.5, s * 0.72);
        c.rotate(rot);
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(-s * 0.16, -s * 0.22, 0, -s * 0.44);
        c.quadraticCurveTo(s * 0.16, -s * 0.22, 0, 0);
        fillStroke(c, color);
        c.strokeStyle = "rgba(13,15,20,0.5)";
        c.lineWidth = s * 0.02;
        c.beginPath();
        c.moveTo(0, -s * 0.04);
        c.lineTo(0, -s * 0.36);
        c.stroke();
        c.restore();
      };
      leaf(-0.7, "#3fbf5c");
      leaf(0.7, "#3fbf5c");
      leaf(0, "#6dff8a");
      // plus badge
      c.beginPath();
      c.arc(s * 0.74, s * 0.3, s * 0.12, 0, Math.PI * 2);
      fillStroke(c, "#ffffff");
      c.fillStyle = "#ff4d6d";
      c.fillRect(s * 0.715, s * 0.225, s * 0.05, s * 0.15);
      c.fillRect(s * 0.665, s * 0.275, s * 0.15, s * 0.05);
    }),
    describe: (l) => `ฟื้นฟูพลังชีวิต +0.4 ต่อวินาที (รวม ${(0.4 * l).toFixed(1)}/วิ)`,
    lines: () => ["ฟื้นฟู +0.4/วิ"],
    apply: (s, l) => (s.regen += 0.4 * l),
  },
  {
    id: "amount",
    name: "เงาแฝด",
    maxLevel: 2,
    color: "#ffe066",
    icon: tile("#ffe066", (c, s) => {
      // shadow twin behind
      c.save();
      c.globalAlpha = 0.55;
      c.beginPath();
      c.arc(s * 0.62, s * 0.46, s * 0.17, 0, Math.PI * 2);
      fillStroke(c, "#6b5ab0");
      c.restore();
      const g = c.createRadialGradient(s * 0.34, s * 0.48, s * 0.02, s * 0.42, s * 0.54, s * 0.2);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.45, "#ffe066");
      g.addColorStop(1, "#d99a1a");
      c.beginPath();
      c.arc(s * 0.42, s * 0.56, s * 0.19, 0, Math.PI * 2);
      fillStroke(c, g);
      c.fillStyle = INK;
      c.font = `900 ${Math.floor(s * 0.2)}px sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("+1", s * 0.42, s * 0.57);
      sparkle(c, s * 0.78, s * 0.22, s * 0.06);
    }),
    describe: (l) => `จำนวนกระสุน/อาวุธ +1 ทุกอาวุธ (รวม +${l})`,
    lines: () => ["จำนวน +1"],
    apply: (s, l) => (s.amount += l),
  },
  {
    id: "crit",
    name: "ตาเหยี่ยว",
    maxLevel: 5,
    color: "#ffd23f",
    icon: tile("#ffd23f", (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.14, s * 0.5);
      c.quadraticCurveTo(s * 0.5, s * 0.16, s * 0.86, s * 0.5);
      c.quadraticCurveTo(s * 0.5, s * 0.84, s * 0.14, s * 0.5);
      fillStroke(c, "#fffbe8");
      const g = c.createRadialGradient(s * 0.47, s * 0.46, s * 0.01, s * 0.5, s * 0.5, s * 0.16);
      g.addColorStop(0, "#fff3b0");
      g.addColorStop(0.6, "#ffb300");
      g.addColorStop(1, "#a65d00");
      c.beginPath();
      c.arc(s * 0.5, s * 0.5, s * 0.15, 0, Math.PI * 2);
      fillStroke(c, g);
      c.fillStyle = INK;
      c.beginPath();
      c.ellipse(s * 0.5, s * 0.5, s * 0.035, s * 0.1, 0, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.strokeStyle = "#ff5a5a";
      c.lineWidth = s * 0.03;
      for (const [x1, y1, x2, y2] of [
        [0.5, 0.08, 0.5, 0.2],
        [0.5, 0.8, 0.5, 0.92],
        [0.06, 0.5, 0.12, 0.5],
        [0.88, 0.5, 0.94, 0.5],
      ]) {
        c.beginPath();
        c.moveTo(x1 * s, y1 * s);
        c.lineTo(x2 * s, y2 * s);
        c.stroke();
      }
      c.restore();
      sparkle(c, s * 0.45, s * 0.44, s * 0.04);
    }),
    describe: (l) => `โอกาสคริติคอล +6% • ดาเมจคริ +20% (รวม +${l * 6}% / +${l * 20}%)`,
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
    icon: tile("#7cc6ff", (c, s) => {
      poly(c, [0.2, 0.72, 0.18, 0.34, 0.36, 0.5, 0.5, 0.26, 0.64, 0.5, 0.82, 0.34, 0.8, 0.72], s);
      fillStroke(c, vgrad(c, s, 0.26, 0.72, "#fff3b0", "#e0a21a"));
      c.beginPath();
      c.rect(s * 0.2, s * 0.68, s * 0.6, s * 0.1);
      fillStroke(c, "#c98a12");
      for (const [x, y, col] of [
        [0.5, 0.56, "#7cc6ff"],
        [0.31, 0.6, "#ff5a86"],
        [0.69, 0.6, "#5cff7a"],
      ] as [number, number, string][]) {
        c.beginPath();
        c.arc(x * s, y * s, s * 0.045, 0, Math.PI * 2);
        fillStroke(c, col);
      }
      sparkle(c, s * 0.5, s * 0.16, s * 0.06);
    }),
    describe: (l) => `ค่าประสบการณ์ที่ได้ +10% (รวม +${l * 10}%)`,
    lines: () => ["EXP +10%"],
    apply: (s, l) => (s.growth += 0.1 * l),
  },
  {
    id: "duration",
    name: "ทรายกาลเวลา",
    maxLevel: 5,
    color: "#e0b0ff",
    icon: tile("#e0b0ff", (c, s) => {
      c.beginPath();
      c.rect(s * 0.28, s * 0.16, s * 0.44, s * 0.07);
      fillStroke(c, "#8a5a2b");
      c.beginPath();
      c.rect(s * 0.28, s * 0.77, s * 0.44, s * 0.07);
      fillStroke(c, "#8a5a2b");
      poly(c, [0.33, 0.23, 0.67, 0.23, 0.53, 0.5, 0.67, 0.77, 0.33, 0.77, 0.47, 0.5], s);
      fillStroke(c, "rgba(230,245,255,0.85)");
      // sand
      poly(c, [0.4, 0.33, 0.6, 0.33, 0.52, 0.47, 0.48, 0.47], s);
      c.fillStyle = "#ffcf5a";
      c.fill();
      poly(c, [0.37, 0.75, 0.63, 0.75, 0.56, 0.64, 0.44, 0.64], s);
      c.fill();
      c.fillRect(s * 0.49, s * 0.47, s * 0.02, s * 0.18);
      sparkle(c, s * 0.78, s * 0.42, s * 0.05, "#f3d9ff");
    }),
    describe: (l) => `ระยะเวลาสกิล +10% • ความเร็วกระสุน +10% (รวม +${l * 10}%)`,
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
