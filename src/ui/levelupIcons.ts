import { iconURL, iconBg, letterIcon, UI_INK, type IconDraw } from "./icons";

/**
 * Procedural glyphs for the level-up helpers (reroll / skip / banish), the
 * AUTO mode toggle and their permanent-shop tiles. Same chunky inked style as
 * the UI glyphs in icons.ts (transparent background, cached data URLs).
 */
export type LevelUpGlyph = "reroll" | "skip" | "banish" | "auto";

/** fill + ink stroke the current path */
function fs(c: CanvasRenderingContext2D, s: number, fill: string | CanvasGradient, w = 0.06): void {
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = s * w;
  c.strokeStyle = UI_INK;
  c.stroke();
}

function vgrad(c: CanvasRenderingContext2D, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

/** thick inked arc stroke: ink underlay, coloured core, glossy inner line */
function inkArc(c: CanvasRenderingContext2D, s: number, x: number, y: number, r: number, a0: number, a1: number, color: string, w = 0.14): void {
  c.lineCap = "butt";
  c.beginPath();
  c.arc(x, y, r, a0, a1);
  c.lineWidth = s * (w + 0.07);
  c.strokeStyle = UI_INK;
  c.stroke();
  c.lineWidth = s * w;
  c.strokeStyle = color;
  c.stroke();
  c.lineCap = "round";
}

/** arrow head at angle `a` on a circle of radius r, pointing along the direction of travel */
function arcHead(c: CanvasRenderingContext2D, s: number, x: number, y: number, r: number, a: number, dir: 1 | -1, color: string, size = 0.17): void {
  const px = x + Math.cos(a) * r;
  const py = y + Math.sin(a) * r;
  // tangent (direction of travel) and outward normal
  const tx = -Math.sin(a) * dir;
  const ty = Math.cos(a) * dir;
  const nx = Math.cos(a);
  const ny = Math.sin(a);
  const h = s * size;
  c.beginPath();
  c.moveTo(px + tx * h * 1.05, py + ty * h * 1.05);
  c.lineTo(px + nx * h, py + ny * h);
  c.lineTo(px - nx * h, py - ny * h);
  c.closePath();
  c.lineJoin = "round";
  fs(c, s, color, 0.055);
}

const DRAW: Record<LevelUpGlyph, IconDraw> = {
  reroll(c, s) {
    const x = s / 2;
    const y = s / 2;
    const r = s * 0.29;
    // two arrows chasing each other around a circle
    inkArc(c, s, x, y, r, Math.PI * 0.95, Math.PI * 1.75, "#7ce7ff");
    inkArc(c, s, x, y, r, Math.PI * -0.05, Math.PI * 0.75, "#3de0ff");
    arcHead(c, s, x, y, r, Math.PI * 1.78, 1, "#7ce7ff");
    arcHead(c, s, x, y, r, Math.PI * 0.78, 1, "#3de0ff");
    // die pips in the middle
    c.beginPath();
    c.roundRect(x - s * 0.1, y - s * 0.1, s * 0.2, s * 0.2, s * 0.05);
    fs(c, s, "#ffffff", 0.045);
    c.fillStyle = UI_INK;
    for (const [dx, dy] of [
      [-0.045, -0.045],
      [0.045, 0.045],
    ]) {
      c.beginPath();
      c.arc(x + s * dx, y + s * dy, s * 0.022, 0, Math.PI * 2);
      c.fill();
    }
  },
  skip(c, s) {
    // two chevrons and a bar: ⏭
    const y = s * 0.5;
    for (let k = 0; k < 2; k++) {
      const x0 = s * (0.14 + k * 0.27);
      c.beginPath();
      c.moveTo(x0, y - s * 0.24);
      c.lineTo(x0 + s * 0.3, y);
      c.lineTo(x0, y + s * 0.24);
      c.closePath();
      c.lineJoin = "round";
      fs(c, s, vgrad(c, y - s * 0.24, y + s * 0.24, k ? "#ffd27a" : "#ffe7a8", "#ff9b1a"), 0.06);
    }
    c.beginPath();
    c.roundRect(s * 0.73, y - s * 0.25, s * 0.12, s * 0.5, s * 0.03);
    fs(c, s, vgrad(c, y - s * 0.25, y + s * 0.25, "#ffe7a8", "#ff9b1a"), 0.06);
  },
  banish(c, s) {
    // prohibition sign over a little card
    const x = s / 2;
    const y = s / 2;
    c.save();
    c.translate(x, y);
    c.rotate(-0.18);
    c.beginPath();
    c.roundRect(-s * 0.15, -s * 0.2, s * 0.3, s * 0.4, s * 0.05);
    fs(c, s, vgrad(c, -s * 0.2, s * 0.2, "#efe9ff", "#b7a8e6"), 0.05);
    c.restore();
    const r = s * 0.32;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.lineWidth = s * 0.19;
    c.strokeStyle = UI_INK;
    c.stroke();
    c.lineWidth = s * 0.12;
    c.strokeStyle = "#ff4f6a";
    c.stroke();
    c.lineCap = "butt";
    c.beginPath();
    c.moveTo(x - r * 0.72, y + r * 0.72);
    c.lineTo(x + r * 0.72, y - r * 0.72);
    c.lineWidth = s * 0.19;
    c.strokeStyle = UI_INK;
    c.stroke();
    c.lineWidth = s * 0.12;
    c.strokeStyle = "#ff4f6a";
    c.stroke();
    c.lineCap = "round";
    // glossy highlight
    c.beginPath();
    c.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.4);
    c.lineWidth = s * 0.035;
    c.strokeStyle = "rgba(255,255,255,0.7)";
    c.stroke();
  },
  auto(c, s) {
    // cycle arrow around a play triangle: "plays by itself"
    const x = s / 2;
    const y = s / 2;
    const r = s * 0.33;
    inkArc(c, s, x, y, r, Math.PI * -0.35, Math.PI * 1.35, "#9dff3a", 0.12);
    arcHead(c, s, x, y, r, Math.PI * 1.38, 1, "#9dff3a", 0.15);
    c.beginPath();
    c.moveTo(x - s * 0.09, y - s * 0.15);
    c.lineTo(x + s * 0.17, y);
    c.lineTo(x - s * 0.09, y + s * 0.15);
    c.closePath();
    c.lineJoin = "round";
    fs(c, s, "#ffffff", 0.05);
  },
};

/** data URL of a level-up helper glyph (transparent background) */
export function luIcon(name: LevelUpGlyph, size = 64): string {
  return iconURL("lu:" + name, DRAW[name], size);
}

/**
 * Shop tile for the reroll / skip / banish upgrades (same framing as
 * icons.ts shopIcon). Returns undefined for any other id.
 */
export function luShopIcon(id: string, color: string, size = 96): string | undefined {
  if (id !== "reroll" && id !== "skip" && id !== "banish") return undefined;
  const draw = DRAW[id];
  return iconURL(`lushop:${id}`, (c, s) => {
    iconBg(c, s, color, "#2a1d45");
    if (!draw) {
      letterIcon("?", color)(c, s);
      return;
    }
    c.save();
    c.translate(s * 0.14, s * 0.14);
    c.scale(0.72, 0.72);
    draw(c, s);
    c.restore();
  }, size);
}
