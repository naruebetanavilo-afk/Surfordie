/**
 * Procedural icons. An IconDraw paints into a square 2D context of size `s`
 * (already cleared, origin top-left). Icons are cached as data URLs.
 *
 * Besides the shared helpers used by weapon/passive icons (iconBg, inked,
 * letterIcon) this module also draws the UI glyphs (coin, hourglass, skull,
 * chest...) and the permanent-shop upgrade icons.
 */
export type IconDraw = (c: CanvasRenderingContext2D, s: number) => void;

const cache = new Map<string, string>();

/**
 * One reusable scratch canvas. `willReadFrequently` keeps it CPU-backed: a
 * GPU-accelerated 2D canvas makes every toDataURL() wait for the GPU to finish
 * all queued WebGL work and read the pixels back. That stall (100-400 ms per
 * icon in software GL, tens of ms on phones) is what made the first level-up
 * screen of a run freeze for 1-4 s while its card icons were generated.
 */
let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

export function iconURL(key: string, draw: IconDraw, size = 96): string {
  const k = `${key}@${size}`;
  const hit = cache.get(k);
  if (hit) return hit;
  if (!scratch || !scratchCtx) {
    scratch = document.createElement("canvas");
    scratchCtx = scratch.getContext("2d", { willReadFrequently: true })!;
  }
  const cv = scratch;
  // assigning width/height clears the bitmap and resets all context state
  cv.width = size;
  cv.height = size;
  const c = scratchCtx;
  c.lineJoin = "round";
  c.lineCap = "round";
  draw(c, size);
  const url = cv.toDataURL("image/png");
  cache.set(k, url);
  return url;
}

/** true when the icon is already generated (no canvas work needed) */
export function iconCached(key: string, size = 96): boolean {
  return cache.has(`${key}@${size}`);
}

interface IconJob {
  key: string;
  draw: IconDraw;
  size: number;
}
const warmQueue: IconJob[] = [];
let warmScheduled = false;

type IdleCb = (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number;

function scheduleWarm(): void {
  if (warmScheduled || !warmQueue.length) return;
  warmScheduled = true;
  const ric = (window as unknown as { requestIdleCallback?: IdleCb }).requestIdleCallback;
  const run = (budget: () => number): void => {
    warmScheduled = false;
    // a few icons per idle slice so no single frame gets long
    let n = 0;
    while (warmQueue.length && (n < 1 || budget() > 4) && n < 6) {
      const j = warmQueue.shift()!;
      iconURL(j.key, j.draw, j.size);
      n++;
    }
    scheduleWarm();
  };
  if (ric) ric((d) => run(() => d.timeRemaining()), { timeout: 400 });
  else window.setTimeout(() => run(() => 0), 30);
}

/**
 * Queue icons to be generated in idle time (menu, early run) so modals that
 * show many icons at once only hit the cache.
 */
export function prewarmIcon(key: string, draw: IconDraw, size = 96): void {
  if (cache.has(`${key}@${size}`)) return;
  warmQueue.push({ key, draw, size });
  scheduleWarm();
}

/** UI outline colour (deep purple-black, matches --ink in CSS) */
export const UI_INK = "#160d24";

/**
 * Rounded tile background used by most icons: dark bevelled base with a
 * coloured inner glow, a soft top highlight and a two-tone rim.
 */
export function iconBg(c: CanvasRenderingContext2D, s: number, glow: string, base = "#1b1f2a"): void {
  const r = s * 0.16;
  const x0 = s * 0.04;
  const w = s * 0.92;
  c.save();
  c.beginPath();
  c.roundRect(x0, x0, w, w, r);
  // base: slightly lighter at the top for a bevelled look
  const bg = c.createLinearGradient(0, x0, 0, x0 + w);
  bg.addColorStop(0, shade(base, 0.12));
  bg.addColorStop(1, shade(base, -0.25));
  c.fillStyle = bg;
  c.fill();
  c.save();
  c.clip();
  // coloured core glow
  const g = c.createRadialGradient(s / 2, s * 0.56, s * 0.04, s / 2, s * 0.56, s * 0.6);
  g.addColorStop(0, glow);
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.globalAlpha = 0.5;
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  // glossy top band
  c.globalAlpha = 0.1;
  c.fillStyle = "#ffffff";
  c.beginPath();
  c.ellipse(s / 2, x0, w * 0.62, s * 0.24, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // rim: coloured inner line + light outer line
  c.globalAlpha = 0.45;
  c.lineWidth = s * 0.05;
  c.strokeStyle = glow;
  c.stroke();
  c.globalAlpha = 1;
  c.lineWidth = s * 0.022;
  c.strokeStyle = "rgba(255,255,255,0.28)";
  c.stroke();
  c.restore();
}

/** thick outlined path helper: fills with `fill` then strokes dark outline */
export function inked(c: CanvasRenderingContext2D, s: number, fill: string, path: () => void, outline = "#0d0f14"): void {
  c.save();
  c.beginPath();
  path();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = s * 0.05;
  c.strokeStyle = outline;
  c.stroke();
  c.restore();
}

/** fallback icon: letter in a tile */
export function letterIcon(letter: string, color: string): IconDraw {
  return (c, s) => {
    iconBg(c, s, color);
    c.font = `800 ${Math.floor(s * 0.5)}px Kanit, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineWidth = s * 0.07;
    c.strokeStyle = "#0d0f14";
    c.strokeText(letter, s / 2, s / 2 + s * 0.03);
    c.fillStyle = color;
    c.fillText(letter, s / 2, s / 2 + s * 0.03);
  };
}

// ------------------------------------------------------------------ helpers

/** lighten (amt > 0) or darken (amt < 0) a #rrggbb colour */
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function vgrad(c: CanvasRenderingContext2D, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

/** fill + ink stroke the current path */
function fs(c: CanvasRenderingContext2D, s: number, fill: string | CanvasGradient, w = 0.06): void {
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = s * w;
  c.strokeStyle = UI_INK;
  c.stroke();
}

function star5(c: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.48): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * inner;
    if (i === 0) c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
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

function heartPath(c: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  c.beginPath();
  c.moveTo(x, y + w * 0.36);
  c.bezierCurveTo(x - w * 0.62, y - w * 0.06, x - w * 0.34, y - w * 0.56, x, y - w * 0.22);
  c.bezierCurveTo(x + w * 0.34, y - w * 0.56, x + w * 0.62, y - w * 0.06, x, y + w * 0.36);
  c.closePath();
}

// ------------------------------------------------------------------ UI glyphs

export type UiIconName =
  | "coin"
  | "hourglass"
  | "skull"
  | "gear"
  | "bag"
  | "trophy"
  | "lock"
  | "chest"
  | "chestOpen"
  | "speaker"
  | "music"
  | "star"
  | "crown"
  | "sword"
  | "bossSkull"
  | "play"
  | "home"
  | "retry"
  | "back"
  | "gem";

const UI: Record<UiIconName, IconDraw> = {
  coin(c, s) {
    const x = s / 2;
    const y = s / 2;
    const r = s * 0.4;
    c.beginPath();
    c.arc(x, y + s * 0.03, r, 0, Math.PI * 2);
    c.fillStyle = "#b86e00";
    c.fill();
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, "#fff6b8");
    g.addColorStop(0.45, "#ffd23f");
    g.addColorStop(1, "#f39a00");
    fs(c, s, g, 0.075);
    c.beginPath();
    c.arc(x, y, r * 0.66, 0, Math.PI * 2);
    c.lineWidth = s * 0.045;
    c.strokeStyle = "rgba(160,90,0,0.75)";
    c.stroke();
    star5(c, x, y + s * 0.01, r * 0.42);
    c.fillStyle = "#fff3a6";
    c.fill();
    c.lineWidth = s * 0.03;
    c.strokeStyle = "#b86e00";
    c.stroke();
  },
  hourglass(c, s) {
    // frame plates
    c.beginPath();
    c.roundRect(s * 0.18, s * 0.08, s * 0.64, s * 0.13, s * 0.04);
    fs(c, s, "#ffb43d");
    c.beginPath();
    c.roundRect(s * 0.18, s * 0.79, s * 0.64, s * 0.13, s * 0.04);
    fs(c, s, "#ffb43d");
    // glass
    c.beginPath();
    c.moveTo(s * 0.27, s * 0.21);
    c.lineTo(s * 0.73, s * 0.21);
    c.quadraticCurveTo(s * 0.72, s * 0.42, s * 0.54, s * 0.5);
    c.quadraticCurveTo(s * 0.72, s * 0.58, s * 0.73, s * 0.79);
    c.lineTo(s * 0.27, s * 0.79);
    c.quadraticCurveTo(s * 0.28, s * 0.58, s * 0.46, s * 0.5);
    c.quadraticCurveTo(s * 0.28, s * 0.42, s * 0.27, s * 0.21);
    c.closePath();
    fs(c, s, "rgba(190,240,255,0.9)");
    // sand
    c.fillStyle = "#ff3d9a";
    c.beginPath();
    c.moveTo(s * 0.35, s * 0.3);
    c.lineTo(s * 0.65, s * 0.3);
    c.quadraticCurveTo(s * 0.6, s * 0.42, s * 0.5, s * 0.47);
    c.quadraticCurveTo(s * 0.4, s * 0.42, s * 0.35, s * 0.3);
    c.fill();
    c.beginPath();
    c.moveTo(s * 0.31, s * 0.76);
    c.quadraticCurveTo(s * 0.5, s * 0.58, s * 0.69, s * 0.76);
    c.closePath();
    c.fill();
    c.fillRect(s * 0.485, s * 0.47, s * 0.03, s * 0.22);
  },
  skull(c, s) {
    c.beginPath();
    c.moveTo(s * 0.2, s * 0.48);
    c.bezierCurveTo(s * 0.18, s * 0.14, s * 0.82, s * 0.14, s * 0.8, s * 0.48);
    c.quadraticCurveTo(s * 0.8, s * 0.62, s * 0.7, s * 0.66);
    c.lineTo(s * 0.7, s * 0.84);
    c.lineTo(s * 0.3, s * 0.84);
    c.lineTo(s * 0.3, s * 0.66);
    c.quadraticCurveTo(s * 0.2, s * 0.62, s * 0.2, s * 0.48);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.15, s * 0.85, "#ffffff", "#c9d1e6"), 0.07);
    c.fillStyle = UI_INK;
    c.beginPath();
    c.ellipse(s * 0.38, s * 0.47, s * 0.09, s * 0.1, 0.2, 0, Math.PI * 2);
    c.ellipse(s * 0.62, s * 0.47, s * 0.09, s * 0.1, -0.2, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.57);
    c.lineTo(s * 0.45, s * 0.65);
    c.lineTo(s * 0.55, s * 0.65);
    c.closePath();
    c.fill();
    c.lineWidth = s * 0.04;
    c.strokeStyle = UI_INK;
    for (const x of [0.42, 0.5, 0.58]) {
      c.beginPath();
      c.moveTo(s * x, s * 0.73);
      c.lineTo(s * x, s * 0.84);
      c.stroke();
    }
  },
  bossSkull(c, s) {
    UI.skull(c, s);
    // horns
    c.beginPath();
    c.moveTo(s * 0.24, s * 0.32);
    c.quadraticCurveTo(s * 0.04, s * 0.22, s * 0.08, s * 0.04);
    c.quadraticCurveTo(s * 0.2, s * 0.2, s * 0.34, s * 0.22);
    c.closePath();
    fs(c, s, "#ff4f6a", 0.05);
    c.beginPath();
    c.moveTo(s * 0.76, s * 0.32);
    c.quadraticCurveTo(s * 0.96, s * 0.22, s * 0.92, s * 0.04);
    c.quadraticCurveTo(s * 0.8, s * 0.2, s * 0.66, s * 0.22);
    c.closePath();
    fs(c, s, "#ff4f6a", 0.05);
    c.fillStyle = "#ff4f6a";
    c.beginPath();
    c.arc(s * 0.38, s * 0.48, s * 0.035, 0, Math.PI * 2);
    c.arc(s * 0.62, s * 0.48, s * 0.035, 0, Math.PI * 2);
    c.fill();
  },
  gear(c, s) {
    const x = s / 2;
    const y = s / 2;
    c.beginPath();
    const teeth = 8;
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * Math.PI * 2;
      const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? s * 0.42 : s * 0.32;
      c.arc(x, y, r, a0, a1);
    }
    c.closePath();
    fs(c, s, vgrad(c, s * 0.1, s * 0.9, "#e9ecff", "#9aa3c7"), 0.065);
    c.beginPath();
    c.arc(x, y, s * 0.13, 0, Math.PI * 2);
    fs(c, s, "#3b2d63", 0.06);
  },
  bag(c, s) {
    c.beginPath();
    c.moveTo(s * 0.36, s * 0.3);
    c.bezierCurveTo(s * 0.1, s * 0.46, s * 0.12, s * 0.88, s * 0.5, s * 0.88);
    c.bezierCurveTo(s * 0.88, s * 0.88, s * 0.9, s * 0.46, s * 0.64, s * 0.3);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.3, s * 0.9, "#c78bff", "#7a3fd6"), 0.065);
    c.beginPath();
    c.moveTo(s * 0.34, s * 0.3);
    c.lineTo(s * 0.26, s * 0.12);
    c.lineTo(s * 0.5, s * 0.2);
    c.lineTo(s * 0.74, s * 0.12);
    c.lineTo(s * 0.66, s * 0.3);
    c.closePath();
    fs(c, s, "#a465ff", 0.06);
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.31, s * 0.18, s * 0.055, 0, 0, Math.PI * 2);
    fs(c, s, "#ffd23f", 0.05);
    UI.coin(withTransform(c, s * 0.34, s * 0.48, 0.32), s);
    c.restore();
  },
  trophy(c, s) {
    c.beginPath();
    c.arc(s * 0.26, s * 0.32, s * 0.12, Math.PI * 0.5, Math.PI * 1.5);
    c.lineWidth = s * 0.12;
    c.strokeStyle = UI_INK;
    c.stroke();
    c.lineWidth = s * 0.05;
    c.strokeStyle = "#ffb000";
    c.stroke();
    c.beginPath();
    c.arc(s * 0.74, s * 0.32, s * 0.12, Math.PI * 1.5, Math.PI * 0.5);
    c.lineWidth = s * 0.12;
    c.strokeStyle = UI_INK;
    c.stroke();
    c.lineWidth = s * 0.05;
    c.strokeStyle = "#ffb000";
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.24, s * 0.14);
    c.lineTo(s * 0.76, s * 0.14);
    c.quadraticCurveTo(s * 0.76, s * 0.56, s * 0.5, s * 0.6);
    c.quadraticCurveTo(s * 0.24, s * 0.56, s * 0.24, s * 0.14);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.14, s * 0.6, "#fff1a0", "#ffb000"), 0.065);
    c.beginPath();
    c.rect(s * 0.43, s * 0.58, s * 0.14, s * 0.14);
    fs(c, s, "#e09200", 0.05);
    c.beginPath();
    c.roundRect(s * 0.28, s * 0.72, s * 0.44, s * 0.14, s * 0.04);
    fs(c, s, "#7a3fd6", 0.06);
    sparkle(c, s * 0.4, s * 0.3, s * 0.07, "#ffffff");
  },
  lock(c, s) {
    c.beginPath();
    c.arc(s * 0.5, s * 0.42, s * 0.17, Math.PI, 0);
    c.lineWidth = s * 0.16;
    c.strokeStyle = UI_INK;
    c.stroke();
    c.lineWidth = s * 0.08;
    c.strokeStyle = "#c9d1e6";
    c.stroke();
    c.beginPath();
    c.roundRect(s * 0.22, s * 0.42, s * 0.56, s * 0.44, s * 0.08);
    fs(c, s, vgrad(c, s * 0.42, s * 0.86, "#ffd23f", "#e08a00"), 0.065);
    c.beginPath();
    c.arc(s * 0.5, s * 0.6, s * 0.06, 0, Math.PI * 2);
    c.fillStyle = UI_INK;
    c.fill();
    c.fillRect(s * 0.475, s * 0.6, s * 0.05, s * 0.14);
  },
  chest(c, s) {
    drawChest(c, s, false);
  },
  chestOpen(c, s) {
    drawChest(c, s, true);
  },
  speaker(c, s) {
    c.beginPath();
    c.moveTo(s * 0.14, s * 0.38);
    c.lineTo(s * 0.3, s * 0.38);
    c.lineTo(s * 0.52, s * 0.18);
    c.lineTo(s * 0.52, s * 0.82);
    c.lineTo(s * 0.3, s * 0.62);
    c.lineTo(s * 0.14, s * 0.62);
    c.closePath();
    fs(c, s, "#ffffff", 0.065);
    c.lineWidth = s * 0.065;
    c.strokeStyle = "#ffffff";
    c.beginPath();
    c.arc(s * 0.52, s * 0.5, s * 0.17, -0.8, 0.8);
    c.stroke();
    c.beginPath();
    c.arc(s * 0.52, s * 0.5, s * 0.31, -0.8, 0.8);
    c.stroke();
  },
  music(c, s) {
    c.lineWidth = s * 0.07;
    c.strokeStyle = "#ffffff";
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.moveTo(s * 0.38, s * 0.7);
    c.lineTo(s * 0.38, s * 0.2);
    c.lineTo(s * 0.78, s * 0.12);
    c.lineTo(s * 0.78, s * 0.62);
    c.stroke();
    c.beginPath();
    c.ellipse(s * 0.29, s * 0.72, s * 0.12, s * 0.09, -0.3, 0, Math.PI * 2);
    c.ellipse(s * 0.69, s * 0.64, s * 0.12, s * 0.09, -0.3, 0, Math.PI * 2);
    c.fill();
  },
  star(c, s) {
    star5(c, s / 2, s * 0.53, s * 0.42);
    fs(c, s, vgrad(c, s * 0.1, s * 0.9, "#fff6b0", "#ffb000"), 0.07);
    sparkle(c, s * 0.42, s * 0.42, s * 0.07);
  },
  crown(c, s) {
    c.beginPath();
    c.moveTo(s * 0.14, s * 0.72);
    c.lineTo(s * 0.1, s * 0.3);
    c.lineTo(s * 0.32, s * 0.48);
    c.lineTo(s * 0.5, s * 0.2);
    c.lineTo(s * 0.68, s * 0.48);
    c.lineTo(s * 0.9, s * 0.3);
    c.lineTo(s * 0.86, s * 0.72);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.2, s * 0.72, "#fff1a0", "#ffb000"), 0.065);
    c.beginPath();
    c.roundRect(s * 0.14, s * 0.7, s * 0.72, s * 0.14, s * 0.04);
    fs(c, s, "#ff3d9a", 0.06);
  },
  sword(c, s) {
    c.save();
    c.translate(s / 2, s / 2);
    c.rotate(-Math.PI / 4);
    c.beginPath();
    c.moveTo(0, -s * 0.42);
    c.lineTo(s * 0.08, -s * 0.32);
    c.lineTo(s * 0.08, s * 0.14);
    c.lineTo(-s * 0.08, s * 0.14);
    c.lineTo(-s * 0.08, -s * 0.32);
    c.closePath();
    fs(c, s, vgrad(c, -s * 0.4, s * 0.14, "#ffffff", "#9fb3cc"), 0.06);
    c.beginPath();
    c.roundRect(-s * 0.2, s * 0.13, s * 0.4, s * 0.08, s * 0.03);
    fs(c, s, "#ffb43d", 0.05);
    c.beginPath();
    c.roundRect(-s * 0.045, s * 0.21, s * 0.09, s * 0.18, s * 0.03);
    fs(c, s, "#7a4e26", 0.05);
    c.restore();
  },
  play(c, s) {
    c.beginPath();
    c.moveTo(s * 0.28, s * 0.16);
    c.lineTo(s * 0.84, s * 0.5);
    c.lineTo(s * 0.28, s * 0.84);
    c.closePath();
    fs(c, s, "#ffffff", 0.08);
  },
  home(c, s) {
    c.beginPath();
    c.moveTo(s * 0.1, s * 0.5);
    c.lineTo(s * 0.5, s * 0.14);
    c.lineTo(s * 0.9, s * 0.5);
    c.lineTo(s * 0.78, s * 0.5);
    c.lineTo(s * 0.78, s * 0.86);
    c.lineTo(s * 0.22, s * 0.86);
    c.lineTo(s * 0.22, s * 0.5);
    c.closePath();
    fs(c, s, "#ffffff", 0.07);
    c.beginPath();
    c.roundRect(s * 0.42, s * 0.6, s * 0.16, s * 0.26, s * 0.03);
    c.fillStyle = UI_INK;
    c.fill();
  },
  retry(c, s) {
    c.lineWidth = s * 0.2;
    c.strokeStyle = UI_INK;
    c.beginPath();
    c.arc(s * 0.5, s * 0.52, s * 0.28, -Math.PI * 0.35, Math.PI * 1.3);
    c.stroke();
    c.lineWidth = s * 0.1;
    c.strokeStyle = "#ffffff";
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.58, s * 0.06);
    c.lineTo(s * 0.86, s * 0.26);
    c.lineTo(s * 0.54, s * 0.4);
    c.closePath();
    fs(c, s, "#ffffff", 0.06);
  },
  back(c, s) {
    c.beginPath();
    c.moveTo(s * 0.12, s * 0.5);
    c.lineTo(s * 0.5, s * 0.16);
    c.lineTo(s * 0.5, s * 0.36);
    c.lineTo(s * 0.86, s * 0.36);
    c.lineTo(s * 0.86, s * 0.64);
    c.lineTo(s * 0.5, s * 0.64);
    c.lineTo(s * 0.5, s * 0.84);
    c.closePath();
    fs(c, s, "#ffffff", 0.08);
  },
  gem(c, s) {
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.1);
    c.lineTo(s * 0.82, s * 0.42);
    c.lineTo(s * 0.5, s * 0.9);
    c.lineTo(s * 0.18, s * 0.42);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.1, s * 0.9, "#c7ffd0", "#22c55e"), 0.07);
    c.beginPath();
    c.moveTo(s * 0.18, s * 0.42);
    c.lineTo(s * 0.82, s * 0.42);
    c.moveTo(s * 0.5, s * 0.1);
    c.lineTo(s * 0.4, s * 0.42);
    c.lineTo(s * 0.5, s * 0.9);
    c.lineWidth = s * 0.03;
    c.strokeStyle = "rgba(22,13,36,0.5)";
    c.stroke();
  },
};

/** save + translate/scale; caller must restore */
function withTransform(c: CanvasRenderingContext2D, x: number, y: number, k: number): CanvasRenderingContext2D {
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  return c;
}

function drawChest(c: CanvasRenderingContext2D, s: number, open: boolean): void {
  const wood = vgrad(c, s * 0.45, s * 0.9, "#c06a2b", "#7a3a14");
  if (open) {
    // light pouring out
    const g = c.createRadialGradient(s * 0.5, s * 0.4, s * 0.02, s * 0.5, s * 0.4, s * 0.48);
    g.addColorStop(0, "rgba(255,255,230,1)");
    g.addColorStop(0.35, "rgba(255,214,90,0.75)");
    g.addColorStop(1, "rgba(255,190,60,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    // lid swung open: we see its darker inner face, narrower at the top
    c.beginPath();
    c.moveTo(s * 0.15, s * 0.46);
    c.lineTo(s * 0.21, s * 0.1);
    c.lineTo(s * 0.79, s * 0.1);
    c.lineTo(s * 0.85, s * 0.46);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.1, s * 0.46, "#7a3a14", "#3f1c08"), 0.05);
    c.beginPath();
    c.moveTo(s * 0.19, s * 0.1);
    c.lineTo(s * 0.81, s * 0.1);
    c.lineTo(s * 0.8, s * 0.17);
    c.lineTo(s * 0.2, s * 0.17);
    c.closePath();
    fs(c, s, "#d9843d", 0.035);
    c.beginPath();
    c.rect(s * 0.27, s * 0.17, s * 0.07, s * 0.28);
    c.rect(s * 0.66, s * 0.17, s * 0.07, s * 0.28);
    fs(c, s, vgrad(c, s * 0.17, s * 0.45, "#ffe27a", "#c98200"), 0.03);
    // treasure mound
    c.beginPath();
    c.moveTo(s * 0.13, s * 0.5);
    c.quadraticCurveTo(s * 0.28, s * 0.3, s * 0.5, s * 0.32);
    c.quadraticCurveTo(s * 0.72, s * 0.3, s * 0.87, s * 0.5);
    c.closePath();
    const mg = c.createRadialGradient(s * 0.45, s * 0.34, s * 0.02, s * 0.5, s * 0.42, s * 0.36);
    mg.addColorStop(0, "#fff8c8");
    mg.addColorStop(0.5, "#ffd23f");
    mg.addColorStop(1, "#e08a00");
    fs(c, s, mg, 0.045);
    for (const [x, y, r] of [
      [0.3, 0.43, 0.06],
      [0.5, 0.37, 0.065],
      [0.68, 0.43, 0.06],
      [0.4, 0.46, 0.05],
      [0.6, 0.47, 0.05],
    ] as const) {
      c.beginPath();
      c.ellipse(s * x, s * y, s * r, s * r * 0.7, 0, 0, Math.PI * 2);
      fs(c, s, "#ffe46b", 0.025);
    }
    // a pink gem in the pile
    c.beginPath();
    c.moveTo(s * 0.56, s * 0.29);
    c.lineTo(s * 0.62, s * 0.35);
    c.lineTo(s * 0.56, s * 0.43);
    c.lineTo(s * 0.5, s * 0.35);
    c.closePath();
    fs(c, s, "#ff3d9a", 0.03);
  }
  // body
  c.beginPath();
  c.roundRect(s * 0.12, s * 0.46, s * 0.76, s * 0.4, s * 0.05);
  fs(c, s, wood, 0.05);
  // planks
  c.lineWidth = s * 0.02;
  c.strokeStyle = "rgba(22,13,36,0.45)";
  c.beginPath();
  c.moveTo(s * 0.14, s * 0.6);
  c.lineTo(s * 0.86, s * 0.6);
  c.moveTo(s * 0.14, s * 0.73);
  c.lineTo(s * 0.86, s * 0.73);
  c.stroke();
  // metal bands
  c.beginPath();
  c.rect(s * 0.2, s * 0.46, s * 0.09, s * 0.4);
  c.rect(s * 0.71, s * 0.46, s * 0.09, s * 0.4);
  fs(c, s, vgrad(c, s * 0.46, s * 0.86, "#fff1a0", "#d98a00"), 0.035);
  if (open) {
    // front lock plate hangs open
    c.beginPath();
    c.roundRect(s * 0.43, s * 0.46, s * 0.14, s * 0.13, s * 0.03);
    fs(c, s, vgrad(c, s * 0.46, s * 0.59, "#fff1a0", "#e09200"), 0.035);
    sparkle(c, s * 0.3, s * 0.24, s * 0.07);
    sparkle(c, s * 0.72, s * 0.2, s * 0.09);
    sparkle(c, s * 0.5, s * 0.06, s * 0.05, "rgba(255,255,255,0.85)");
  } else {
    // domed lid
    c.beginPath();
    c.moveTo(s * 0.1, s * 0.48);
    c.lineTo(s * 0.1, s * 0.34);
    c.quadraticCurveTo(s * 0.5, s * 0.1, s * 0.9, s * 0.34);
    c.lineTo(s * 0.9, s * 0.48);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.18, s * 0.48, "#e0853a", "#9a4a1a"), 0.05);
    c.beginPath();
    c.moveTo(s * 0.2, s * 0.48);
    c.lineTo(s * 0.2, s * 0.27);
    c.lineTo(s * 0.29, s * 0.24);
    c.lineTo(s * 0.29, s * 0.48);
    c.closePath();
    c.moveTo(s * 0.71, s * 0.48);
    c.lineTo(s * 0.71, s * 0.24);
    c.lineTo(s * 0.8, s * 0.27);
    c.lineTo(s * 0.8, s * 0.48);
    c.closePath();
    fs(c, s, "#ffc93c", 0.035);
    // lock plate
    c.beginPath();
    c.roundRect(s * 0.42, s * 0.4, s * 0.16, s * 0.18, s * 0.03);
    fs(c, s, vgrad(c, s * 0.4, s * 0.58, "#fff1a0", "#e09200"), 0.04);
    c.fillStyle = UI_INK;
    c.beginPath();
    c.arc(s * 0.5, s * 0.47, s * 0.025, 0, Math.PI * 2);
    c.fill();
    c.fillRect(s * 0.49, s * 0.47, s * 0.02, s * 0.06);
    sparkle(c, s * 0.3, s * 0.3, s * 0.05, "rgba(255,255,255,0.8)");
  }
}

/** data URL of a UI glyph (transparent background) */
export function uiIcon(name: UiIconName, size = 64): string {
  return iconURL("ui:" + name, UI[name], size);
}

/** queue a UI glyph for idle-time generation (see prewarmIcon) */
export function prewarmUi(name: UiIconName, size = 64): void {
  prewarmIcon("ui:" + name, UI[name], size);
}

// ------------------------------------------------------------------ shop

const SHOP_DRAW: Record<string, IconDraw> = {
  might(c, s) {
    UI.sword(c, s);
  },
  hp(c, s) {
    heartPath(c, s / 2, s * 0.52, s * 0.62);
    fs(c, s, vgrad(c, s * 0.2, s * 0.85, "#ff8fa3", "#e0123c"), 0.065);
    sparkle(c, s * 0.38, s * 0.4, s * 0.07);
  },
  armor(c, s) {
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.12);
    c.lineTo(s * 0.82, s * 0.24);
    c.quadraticCurveTo(s * 0.82, s * 0.68, s * 0.5, s * 0.88);
    c.quadraticCurveTo(s * 0.18, s * 0.68, s * 0.18, s * 0.24);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.12, s * 0.88, "#d7e3f5", "#6f86a8"), 0.065);
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.22);
    c.lineTo(s * 0.72, s * 0.3);
    c.quadraticCurveTo(s * 0.72, s * 0.62, s * 0.5, s * 0.77);
    c.closePath();
    c.fillStyle = "rgba(61,224,255,0.65)";
    c.fill();
  },
  speed(c, s) {
    for (let k = 0; k < 2; k++) {
      const o = k * 0.24;
      c.beginPath();
      c.moveTo(s * (0.16 + o), s * 0.2);
      c.lineTo(s * (0.4 + o), s * 0.2);
      c.lineTo(s * (0.62 + o), s * 0.5);
      c.lineTo(s * (0.4 + o), s * 0.8);
      c.lineTo(s * (0.16 + o), s * 0.8);
      c.lineTo(s * (0.38 + o), s * 0.5);
      c.closePath();
      fs(c, s, k === 0 ? "#7ce7ff" : "#3de0ff", 0.06);
    }
  },
  cooldown(c, s) {
    c.beginPath();
    c.roundRect(s * 0.42, s * 0.08, s * 0.16, s * 0.1, s * 0.03);
    fs(c, s, "#ffb43d", 0.05);
    c.beginPath();
    c.arc(s * 0.5, s * 0.54, s * 0.34, 0, Math.PI * 2);
    fs(c, s, vgrad(c, s * 0.2, s * 0.88, "#ffffff", "#c9d1e6"), 0.065);
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.54);
    c.arc(s * 0.5, s * 0.54, s * 0.26, -Math.PI / 2, Math.PI * 0.35);
    c.closePath();
    c.fillStyle = "rgba(255,61,154,0.75)";
    c.fill();
    c.lineWidth = s * 0.06;
    c.strokeStyle = UI_INK;
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.54);
    c.lineTo(s * 0.5, s * 0.32);
    c.stroke();
  },
  magnet(c, s) {
    c.lineCap = "butt";
    c.beginPath();
    c.arc(s * 0.5, s * 0.46, s * 0.24, Math.PI, 0);
    c.lineTo(s * 0.74, s * 0.8);
    c.moveTo(s * 0.26, s * 0.46);
    c.lineTo(s * 0.26, s * 0.8);
    c.lineWidth = s * 0.24;
    c.strokeStyle = UI_INK;
    c.stroke();
    c.lineWidth = s * 0.15;
    c.strokeStyle = "#ff4f6a";
    c.stroke();
    c.fillStyle = "#e9ecff";
    c.fillRect(s * 0.19, s * 0.68, s * 0.14, s * 0.12);
    c.fillRect(s * 0.67, s * 0.68, s * 0.14, s * 0.12);
    c.lineCap = "round";
  },
  growth(c, s) {
    UI.gem(c, s);
    sparkle(c, s * 0.78, s * 0.2, s * 0.08, "#ffffff");
  },
  greed(c, s) {
    UI.coin(withTransform(c, s * 0.02, s * 0.2, 0.62), s);
    c.restore();
    UI.coin(withTransform(c, s * 0.36, s * 0.32, 0.62), s);
    c.restore();
    UI.coin(withTransform(c, s * 0.18, s * 0.02, 0.62), s);
    c.restore();
  },
  revive(c, s) {
    // wings
    for (const d of [-1, 1]) {
      c.beginPath();
      c.moveTo(s * 0.5, s * 0.5);
      c.quadraticCurveTo(s * (0.5 + d * 0.46), s * 0.2, s * (0.5 + d * 0.42), s * 0.66);
      c.quadraticCurveTo(s * (0.5 + d * 0.3), s * 0.56, s * (0.5 + d * 0.12), s * 0.62);
      c.closePath();
      fs(c, s, "#ffffff", 0.05);
    }
    heartPath(c, s / 2, s * 0.6, s * 0.4);
    fs(c, s, "#ff4f6a", 0.06);
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.2, s * 0.17, s * 0.06, 0, 0, Math.PI * 2);
    c.lineWidth = s * 0.09;
    c.strokeStyle = UI_INK;
    c.stroke();
    c.lineWidth = s * 0.045;
    c.strokeStyle = "#ffd23f";
    c.stroke();
  },
  regen(c, s) {
    c.beginPath();
    const a = 0.36;
    const b = 0.64;
    c.moveTo(s * a, s * 0.14);
    c.lineTo(s * b, s * 0.14);
    c.lineTo(s * b, s * a);
    c.lineTo(s * 0.86, s * a);
    c.lineTo(s * 0.86, s * b);
    c.lineTo(s * b, s * b);
    c.lineTo(s * b, s * 0.86);
    c.lineTo(s * a, s * 0.86);
    c.lineTo(s * a, s * b);
    c.lineTo(s * 0.14, s * b);
    c.lineTo(s * 0.14, s * a);
    c.lineTo(s * a, s * a);
    c.closePath();
    fs(c, s, vgrad(c, s * 0.14, s * 0.86, "#c7ffb0", "#2fcf4a"), 0.065);
  },
  area(c, s) {
    for (let k = 3; k >= 1; k--) {
      c.beginPath();
      c.arc(s / 2, s / 2, s * 0.13 * k, 0, Math.PI * 2);
      c.lineWidth = s * 0.1;
      c.strokeStyle = UI_INK;
      c.stroke();
      c.lineWidth = s * 0.05;
      c.strokeStyle = k === 3 ? "#ff3d9a" : k === 2 ? "#c46bff" : "#ffffff";
      c.stroke();
    }
  },
  duration(c, s) {
    UI.hourglass(c, s);
  },
  luck(c, s) {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      c.save();
      c.translate(s / 2, s * 0.46);
      c.rotate(a + Math.PI);
      heartPath(c, 0, -s * 0.18, s * 0.34);
      fs(c, s, k % 2 ? "#5cdc4a" : "#3fbf3a", 0.05);
      c.restore();
    }
    c.lineWidth = s * 0.06;
    c.strokeStyle = UI_INK;
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.5);
    c.quadraticCurveTo(s * 0.56, s * 0.76, s * 0.66, s * 0.9);
    c.stroke();
  },
  crit(c, s) {
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.34, 0, Math.PI * 2);
    fs(c, s, "#ffffff", 0.065);
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.22, 0, Math.PI * 2);
    fs(c, s, "#ff4f6a", 0.05);
    c.beginPath();
    c.arc(s / 2, s / 2, s * 0.09, 0, Math.PI * 2);
    fs(c, s, "#ffffff", 0.04);
    c.lineWidth = s * 0.06;
    c.strokeStyle = UI_INK;
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.04);
    c.lineTo(s * 0.5, s * 0.2);
    c.moveTo(s * 0.5, s * 0.8);
    c.lineTo(s * 0.5, s * 0.96);
    c.moveTo(s * 0.04, s * 0.5);
    c.lineTo(s * 0.2, s * 0.5);
    c.moveTo(s * 0.8, s * 0.5);
    c.lineTo(s * 0.96, s * 0.5);
    c.stroke();
  },
  amount(c, s) {
    for (let k = 0; k < 3; k++) {
      const y = s * (0.28 + k * 0.22);
      const x = s * (0.18 + (k === 1 ? 0.08 : 0));
      c.beginPath();
      c.moveTo(x, y - s * 0.035);
      c.lineTo(x + s * 0.44, y - s * 0.035);
      c.lineTo(x + s * 0.44, y - s * 0.1);
      c.lineTo(x + s * 0.62, y);
      c.lineTo(x + s * 0.44, y + s * 0.1);
      c.lineTo(x + s * 0.44, y + s * 0.035);
      c.lineTo(x, y + s * 0.035);
      c.closePath();
      fs(c, s, k === 1 ? "#ffd23f" : "#ff9b3d", 0.045);
    }
  },
};

/** icon for a permanent shop upgrade (tile + glyph) */
export function shopIcon(id: string, color: string, size = 96): string {
  const draw = SHOP_DRAW[id];
  return iconURL(`shop:${id}`, (c, s) => {
    iconBg(c, s, color, "#2a1d45");
    if (!draw) {
      letterIcon("?", color)(c, s);
      return;
    }
    // draw the glyph a bit smaller so it sits inside the tile
    c.save();
    c.translate(s * 0.14, s * 0.14);
    c.scale(0.72, 0.72);
    draw(c, s);
    c.restore();
  }, size);
}
