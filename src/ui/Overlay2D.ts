import { G } from "../core/G";

interface FloatText {
  active: boolean;
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  size: number;
  t: number;
  life: number;
  vx: number;
}

const MAX_TEXT = 220;

/**
 * 2D canvas drawn over the 3D scene every frame: damage numbers, enemy HP
 * bars, player HP bar, virtual joystick, hurt vignette.
 */
export class Overlay2D {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  w = 1;
  h = 1;
  dpr = 1;
  private texts: FloatText[] = [];
  private textIdx = 0;
  private hurtT = 0;
  private pt = { x: 0, y: 0 };
  private pt2 = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    for (let i = 0; i < MAX_TEXT; i++) {
      this.texts.push({ active: false, x: 0, y: 0, z: 0, text: "", color: "#fff", size: 16, t: 0, life: 0.8, vx: 0 });
    }
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  clear(): void {
    for (const t of this.texts) t.active = false;
    this.hurtT = 0;
  }

  private push(x: number, y: number, z: number, text: string, color: string, size: number, life: number): void {
    const t = this.texts[this.textIdx];
    this.textIdx = (this.textIdx + 1) % MAX_TEXT;
    t.active = true;
    t.x = x + (Math.random() - 0.5) * 0.4;
    t.y = y;
    t.z = z;
    t.text = text;
    t.color = color;
    t.size = size;
    t.t = 0;
    t.life = life;
    t.vx = (Math.random() - 0.5) * 30;
  }

  damageNumber(x: number, y: number, z: number, value: number, crit: boolean, color?: string): void {
    if (crit) this.push(x, y, z, `${value}!`, color ?? "#ffd23f", 26, 0.9);
    else this.push(x, y, z, `${value}`, color ?? "#ffffff", 17, 0.7);
  }

  healNumber(x: number, z: number, value: number): void {
    this.push(x, 2, z, `+${Math.round(value)}`, "#5cff7a", 22, 0.9);
  }

  /** floating text at a world position (e.g. "+50 ทอง") */
  floatText(x: number, z: number, text: string, color = "#ffffff", size = 20): void {
    this.push(x, 2, z, text, color, size, 1.1);
  }

  playerHit(_dmg: number): void {
    this.hurtT = 1;
  }

  draw(dt: number): void {
    const c = this.ctx;
    const dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (G.state === "boot" || G.state === "menu") {
      return;
    }
    this.drawHpBars(c);
    this.drawPlayerBar(c);
    this.drawTexts(c, G.state === "playing" ? dt : 0);
    this.drawBossArrow(c);
    this.drawJoystick(c);
    // hurt vignette
    if (this.hurtT > 0) {
      this.hurtT = Math.max(0, this.hurtT - dt * 2.5);
      this.vignette(c, `rgba(255,30,30,${(this.hurtT * 0.45).toFixed(3)})`);
    }
    const p = G.player;
    if (p.hp / p.stats.maxHp < 0.3 && !p.dead) {
      const a = 0.18 + Math.sin(G.realTime * 6) * 0.08;
      this.vignette(c, `rgba(200,0,0,${a.toFixed(3)})`);
    }
  }

  private vignette(c: CanvasRenderingContext2D, color: string): void {
    const g = c.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, color);
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
  }

  private pxPerUnit(): number {
    const w = G.world;
    const fov = (w.camera.fov * Math.PI) / 180;
    return w.height / (2 * Math.tan(fov / 2) * w.camDist);
  }

  private drawHpBars(c: CanvasRenderingContext2D): void {
    const em = G.enemies;
    const world = G.world;
    const ppu = this.pxPerUnit();
    const pt = this.pt;
    c.save();
    for (let i = 0; i < em.n; i++) {
      if (em.state[i] !== 0) continue;
      if (em.hp[i] >= em.maxHp[i]) continue;
      if (em.isBoss(i)) continue;
      const def = em.def(i);
      const y = def.hpBarY * (em.scale[i] / def.scale);
      if (!world.project(em.x[i], y, em.z[i], pt)) continue;
      const bw = Math.max(26, Math.min(90, em.radius[i] * 2.4 * ppu));
      const bh = Math.max(4, Math.min(7, bw * 0.11));
      const x0 = pt.x - bw / 2;
      const y0 = pt.y - bh / 2;
      const f = Math.max(0, em.hp[i] / em.maxHp[i]);
      c.fillStyle = "rgba(15,10,10,0.85)";
      c.fillRect(x0 - 1, y0 - 1, bw + 2, bh + 2);
      c.fillStyle = em.isElite(i) ? "#ffb02e" : "#e8343c";
      c.fillRect(x0, y0, bw * f, bh);
      c.fillStyle = "rgba(255,255,255,0.35)";
      c.fillRect(x0, y0, bw * f, bh * 0.35);
    }
    c.restore();
  }

  private drawPlayerBar(c: CanvasRenderingContext2D): void {
    const p = G.player;
    if (p.dead) return;
    if (!G.world.project(p.x, 0, p.z, this.pt)) return;
    const bw = 56;
    const bh = 7;
    const x0 = this.pt.x - bw / 2;
    const y0 = this.pt.y + 14;
    const f = Math.max(0, p.hp / p.stats.maxHp);
    c.fillStyle = "rgba(10,12,16,0.85)";
    c.beginPath();
    c.roundRect(x0 - 2, y0 - 2, bw + 4, bh + 4, 4);
    c.fill();
    c.fillStyle = f > 0.5 ? "#4cd964" : f > 0.25 ? "#ffcc00" : "#ff3b30";
    c.beginPath();
    c.roundRect(x0, y0, Math.max(0.01, bw * f), bh, 3);
    c.fill();
  }

  private drawTexts(c: CanvasRenderingContext2D, dt: number): void {
    const world = G.world;
    const pt = this.pt;
    c.save();
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    let lastFont = "";
    for (const t of this.texts) {
      if (!t.active) continue;
      t.t += dt;
      if (t.t >= t.life) {
        t.active = false;
        continue;
      }
      if (!world.project(t.x, t.y, t.z, pt)) continue;
      const k = t.t / t.life;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : k < 0.3 ? 1.2 - ((k - 0.15) / 0.15) * 0.2 : 1;
      const rise = k * 38;
      const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const size = Math.round(t.size * pop);
      const font = `800 ${size}px Kanit, system-ui, sans-serif`;
      if (font !== lastFont) {
        c.font = font;
        lastFont = font;
      }
      const x = pt.x + t.vx * k;
      const y = pt.y - rise;
      c.globalAlpha = alpha;
      c.lineWidth = Math.max(3, size * 0.2);
      c.strokeStyle = "rgba(10,10,14,0.95)";
      c.strokeText(t.text, x, y);
      c.fillStyle = t.color;
      c.fillText(t.text, x, y);
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /** arrow at the screen edge pointing to an off-screen boss */
  private drawBossArrow(c: CanvasRenderingContext2D): void {
    const em = G.enemies;
    for (let i = 0; i < em.n; i++) {
      if (em.state[i] !== 0 || !em.isBoss(i)) continue;
      if (G.world.onScreen(em.x[i], em.z[i], -1)) continue;
      const p = G.player;
      if (!G.world.project(p.x, 0.5, p.z, this.pt)) continue;
      G.world.project(em.x[i], 0.5, em.z[i], this.pt2);
      let dx = this.pt2.x - this.pt.x;
      let dy = this.pt2.y - this.pt.y;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const m = 40;
      const tx = dx > 0 ? (this.w - m - this.pt.x) / dx : (m - this.pt.x) / dx;
      const ty = dy > 0 ? (this.h - m - this.pt.y) / dy : (m - this.pt.y) / dy;
      const t = Math.min(Math.abs(tx), Math.abs(ty));
      const ax = this.pt.x + dx * t;
      const ay = this.pt.y + dy * t;
      c.save();
      c.translate(ax, ay);
      c.rotate(Math.atan2(dy, dx));
      c.fillStyle = "#ff3b30";
      c.strokeStyle = "#1a0505";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(18, 0);
      c.lineTo(-10, -13);
      c.lineTo(-4, 0);
      c.lineTo(-10, 13);
      c.closePath();
      c.stroke();
      c.fill();
      c.restore();
    }
  }

  private drawJoystick(c: CanvasRenderingContext2D): void {
    const j = G.input.joy;
    if (!j.active || G.state !== "playing") return;
    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = "rgba(0,0,0,0.35)";
    c.strokeStyle = "rgba(255,255,255,0.7)";
    c.lineWidth = 3;
    c.beginPath();
    c.arc(j.baseX, j.baseY, j.radius, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.globalAlpha = 0.85;
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.beginPath();
    c.arc(j.knobX, j.knobY, j.radius * 0.42, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
}
