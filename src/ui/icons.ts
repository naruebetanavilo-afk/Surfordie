/**
 * Procedural icons. An IconDraw paints into a square 2D context of size `s`
 * (already cleared, origin top-left). Icons are cached as data URLs.
 */
export type IconDraw = (c: CanvasRenderingContext2D, s: number) => void;

const cache = new Map<string, string>();

export function iconURL(key: string, draw: IconDraw, size = 96): string {
  const k = `${key}@${size}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  c.lineJoin = "round";
  c.lineCap = "round";
  draw(c, size);
  const url = cv.toDataURL("image/png");
  cache.set(k, url);
  return url;
}

/** dark rounded tile background with a coloured glow, used by most icons */
export function iconBg(c: CanvasRenderingContext2D, s: number, glow: string, base = "#1b1f2a"): void {
  const r = s * 0.16;
  c.save();
  c.beginPath();
  c.roundRect(s * 0.04, s * 0.04, s * 0.92, s * 0.92, r);
  c.fillStyle = base;
  c.fill();
  const g = c.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.55);
  g.addColorStop(0, glow);
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.globalAlpha = 0.55;
  c.fillStyle = g;
  c.fill();
  c.globalAlpha = 1;
  c.lineWidth = s * 0.04;
  c.strokeStyle = "rgba(255,255,255,0.18)";
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
    c.fillStyle = color;
    c.font = `800 ${Math.floor(s * 0.5)}px Kanit, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(letter, s / 2, s / 2 + s * 0.03);
  };
}
