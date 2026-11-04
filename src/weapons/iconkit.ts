/** small canvas drawing helpers for the procedural weapon icons */

export const INK = "#0d0f14";

/** 4-point sparkle star */
export function star4(c: CanvasRenderingContext2D, x: number, y: number, r: number, color = "#ffffff"): void {
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

/** radial glow blob */
export function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1): void {
  c.save();
  c.globalAlpha = alpha;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** glossy orb: white hot spot → mid → edge colour, with an ink rim */
export function orb(c: CanvasRenderingContext2D, x: number, y: number, r: number, mid: string, edge: string, ink = true): void {
  c.save();
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.35, mid);
  g.addColorStop(1, edge);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  if (ink) {
    c.lineWidth = r * 0.16;
    c.strokeStyle = INK;
    c.stroke();
  }
  c.restore();
}

/** golden frame + corner sparkles marking an evolved weapon icon */
export function evolvedFrame(c: CanvasRenderingContext2D, s: number): void {
  c.save();
  c.beginPath();
  c.roundRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88, s * 0.14);
  c.lineWidth = s * 0.045;
  const g = c.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, "#fff3a8");
  g.addColorStop(0.5, "#ffc93c");
  g.addColorStop(1, "#ff8a1f");
  c.strokeStyle = g;
  c.stroke();
  c.restore();
  star4(c, s * 0.82, s * 0.18, s * 0.09, "#fff6c2");
  star4(c, s * 0.17, s * 0.84, s * 0.06, "#fff6c2");
}

/** stroke + fill a path with the standard dark ink outline */
export function ink(c: CanvasRenderingContext2D, s: number, fill: string | CanvasGradient, path: () => void, width = 0.045): void {
  c.save();
  c.beginPath();
  path();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = s * width;
  c.strokeStyle = INK;
  c.stroke();
  c.restore();
}
