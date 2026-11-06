import { G } from "../core/G";

// ---------------------------------------------------------------------------
// Pre-rendered glyph atlases for damage numbers.
// Drawing outlined text with fillText/strokeText hundreds of times per frame
// is the slowest thing a 2D canvas can do; blitting pre-rendered glyphs with
// drawImage is an order of magnitude cheaper and needs no font switching.
// ---------------------------------------------------------------------------

const GLYPHS = "0123456789+-!.KM";
const G_PLUS = 10;
const G_MINUS = 11;
const G_BANG = 12;
const G_DOT = 13;
const G_K = 14;
const G_M = 15;
/** font size the atlases are rendered at (numbers are drawn scaled down) */
const ATLAS_PX = 60;
const FONT_FAMILY = "Kanit, system-ui, sans-serif";

interface GlyphStyle {
  /** solid fill or [top, middle, bottom] vertical gradient */
  fill: string | [string, string, string];
  outline: string;
  /** outline thickness in atlas px */
  outlineW: number;
  /** darker drop shadow under the outline (chunky mobile-game look) */
  shadow: string;
}

class GlyphAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly sx = new Float32Array(GLYPHS.length);
  readonly sw = new Float32Array(GLYPHS.length);
  readonly adv = new Float32Array(GLYPHS.length);
  pad = 0;
  h = 0;

  constructor(private style: GlyphStyle) {
    this.canvas = document.createElement("canvas");
    this.build();
  }

  build(): void {
    const st = this.style;
    const cv = this.canvas;
    const c = cv.getContext("2d")!;
    const font = `800 ${ATLAS_PX}px ${FONT_FAMILY}`;
    c.font = font;
    const pad = Math.ceil(st.outlineW + 3);
    this.pad = pad;
    const widths: number[] = [];
    let total = 0;
    for (let i = 0; i < GLYPHS.length; i++) {
      const w = Math.ceil(c.measureText(GLYPHS[i]).width);
      widths.push(w);
      total += w + pad * 2 + 2;
    }
    this.h = Math.ceil(ATLAS_PX * 1.25 + pad * 2 + 3);
    cv.width = total;
    cv.height = this.h;
    c.font = font;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.miterLimit = 2;
    let x = 0;
    const midY = this.h / 2 - 1;
    let fillStyle: string | CanvasGradient;
    if (typeof st.fill === "string") fillStyle = st.fill;
    else {
      const g = c.createLinearGradient(0, midY - ATLAS_PX * 0.42, 0, midY + ATLAS_PX * 0.42);
      g.addColorStop(0, st.fill[0]);
      g.addColorStop(0.5, st.fill[1]);
      g.addColorStop(1, st.fill[2]);
      fillStyle = g;
    }
    for (let i = 0; i < GLYPHS.length; i++) {
      const ch = GLYPHS[i];
      const w = widths[i];
      const gx = x + pad + 1;
      this.sx[i] = x;
      this.sw[i] = w + pad * 2 + 2;
      // glyph advance: overlap outlines a little so numbers read as one chunk
      this.adv[i] = w * 0.93;
      c.lineWidth = st.outlineW * 2;
      c.strokeStyle = st.shadow;
      c.strokeText(ch, gx, midY + 3);
      c.strokeStyle = st.outline;
      c.strokeText(ch, gx, midY);
      c.fillStyle = fillStyle;
      c.fillText(ch, gx, midY);
      x += this.sw[i];
    }
  }
}

const STYLE_NORMAL: GlyphStyle = { fill: "#ffffff", outline: "#1d1426", outlineW: 6.5, shadow: "rgba(10,6,14,0.85)" };
const STYLE_CRIT: GlyphStyle = { fill: ["#fffbc4", "#ffd23f", "#ff8516"], outline: "#3f0f00", outlineW: 7.5, shadow: "rgba(40,6,0,0.9)" };
const STYLE_HEAL: GlyphStyle = { fill: ["#e2ffd6", "#7dff7a", "#25c94f"], outline: "#062a0e", outlineW: 7, shadow: "rgba(2,20,6,0.85)" };
const STYLE_HURT: GlyphStyle = { fill: ["#ffd0d0", "#ff5a5a", "#d11f2c"], outline: "#2a0306", outlineW: 7, shadow: "rgba(20,0,2,0.85)" };

/** crit starburst drawn behind crit numbers */
function makeBurst(): HTMLCanvasElement {
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const c = cv.getContext("2d")!;
  const h = s / 2;
  const star = (rOut: number, rIn: number, n: number): void => {
    c.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? rOut : rIn;
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = h + Math.cos(a) * r;
      const py = h + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  };
  c.lineJoin = "round";
  star(60, 30, 9);
  c.fillStyle = "#3f0f00";
  c.fill();
  star(54, 26, 9);
  const g = c.createRadialGradient(h, h, 4, h, h, 56);
  g.addColorStop(0, "#fff4a8");
  g.addColorStop(0.45, "#ffb62e");
  g.addColorStop(1, "#ff5a1a");
  c.fillStyle = g;
  c.fill();
  return cv;
}

class Num {
  active = false;
  x = 0;
  y = 0;
  z = 0;
  t = 0;
  life = 0.7;
  vx = 0;
  rise = 34;
  size = 16;
  /** 0 = glyph number, 1 = free text */
  kind = 0;
  crit = false;
  atlas: GlyphAtlas | null = null;
  readonly glyphs = new Uint8Array(12);
  n = 0;
  text = "";
  color = "#fff";
  rot = 0;
}

const MAX_NUMS = 200;
const MAX_BARS = 900;
/** boss arrow: badge centre distance from the screen edges (badge + arrowhead fit) */
const ARROW_EDGE = 46;
/** boss arrow: clearance from DOM HUD blocks (the arrowhead reaches ~40 px out) */
const ARROW_HUD_PAD = 40;
/** a boss whose feet are this close to (or under) a HUD block counts as hidden */
const HIDDEN_HUD_PAD = 16;
/** max HUD blocks tracked for the boss arrow */
const MAX_HUD_RECTS = 6;
const H_SIZE = 4096;
const H_MASK = H_SIZE - 1;

/** open-addressed uid -> HP-bar trail state table (rebuilt every frame) */
class TrailTable {
  readonly keys = new Int32Array(H_SIZE);
  readonly trail = new Float32Array(H_SIZE);
  readonly last = new Float32Array(H_SIZE);
  readonly hold = new Float32Array(H_SIZE);
  count = 0;

  find(uid: number): number {
    const h = Math.imul(uid, 0x9e3779b1) >>> 20;
    for (let k = 0; k < H_SIZE; k++) {
      const s = (h + k) & H_MASK;
      const key = this.keys[s];
      if (key === uid) return s;
      if (key === 0) return -1;
    }
    return -1;
  }

  insert(uid: number, trail: number, last: number, hold: number): void {
    if (this.count >= H_SIZE * 0.6) return;
    const h = Math.imul(uid, 0x9e3779b1) >>> 20;
    for (let k = 0; k < H_SIZE; k++) {
      const s = (h + k) & H_MASK;
      if (this.keys[s] === 0 || this.keys[s] === uid) {
        if (this.keys[s] === 0) this.count++;
        this.keys[s] = uid;
        this.trail[s] = trail;
        this.last[s] = last;
        this.hold[s] = hold;
        return;
      }
    }
  }

  reset(): void {
    if (this.count === 0) return;
    this.keys.fill(0);
    this.count = 0;
  }
}

/**
 * 2D canvas drawn over the 3D scene every frame: damage numbers, enemy HP
 * bars (with trailing "recent damage" segment), player HP bar, off-screen
 * boss arrow, virtual joystick, hurt / low-HP vignettes and screen flashes.
 */
export class Overlay2D {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  w = 1;
  h = 1;
  dpr = 1;
  private nums: Num[] = [];
  private numIdx = 0;
  private activeNums = 0;
  private avgDmg = 20;
  private hurtT = 0;
  private hurtPeak = 0.5;
  private flashT = 0;
  private flashDur = 0.3;
  private flashStrength = 0;
  private flashColor = "#ffffff";
  private pt = { x: 0, y: 0 };
  private pt2 = { x: 0, y: 0 };

  // boss arrows: DOM HUD blocks + safe-area insets, refreshed on resize and
  // every 0.25 s while a boss is alive (boss bars come and go; reading layout
  // every frame would be wasteful)
  private hudRects = new Float32Array(MAX_HUD_RECTS * 4);
  private hudN = 0;
  private hudT = 0;
  private safeT = 0;
  private safeR = 0;
  private safeB = 0;
  private safeL = 0;
  private safeProbe: HTMLDivElement | null = null;

  private atlasNormal: GlyphAtlas;
  private atlasCrit: GlyphAtlas;
  private atlasHeal: GlyphAtlas;
  private atlasHurt: GlyphAtlas;
  private atlasCustom = new Map<string, GlyphAtlas>();
  private burst: HTMLCanvasElement;
  private vignetteCv: HTMLCanvasElement | null = null;

  // enemy HP bar trails (double-buffered tables keyed by enemy uid)
  private tabA = new TrailTable();
  private tabB = new TrailTable();
  private barX = new Float32Array(MAX_BARS);
  private barY = new Float32Array(MAX_BARS);
  private barW = new Float32Array(MAX_BARS);
  private barH = new Float32Array(MAX_BARS);
  private barF = new Float32Array(MAX_BARS);
  private barT = new Float32Array(MAX_BARS);
  private barElite = new Uint8Array(MAX_BARS);

  // player bar trail
  private pTrail = 1;
  private pLast = 1;
  private pHold = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    for (let i = 0; i < MAX_NUMS; i++) this.nums.push(new Num());
    this.atlasNormal = new GlyphAtlas(STYLE_NORMAL);
    this.atlasCrit = new GlyphAtlas(STYLE_CRIT);
    this.atlasHeal = new GlyphAtlas(STYLE_HEAL);
    this.atlasHurt = new GlyphAtlas(STYLE_HURT);
    this.burst = makeBurst();
    // re-render atlases once the web font is actually available
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      fonts
        .load(`800 ${ATLAS_PX}px Kanit`)
        .then(() => this.rebuildAtlases())
        .catch(() => undefined);
      fonts.ready.then(() => this.rebuildAtlases()).catch(() => undefined);
    }
  }

  private rebuildAtlases(): void {
    this.atlasNormal.build();
    this.atlasCrit.build();
    this.atlasHeal.build();
    this.atlasHurt.build();
    for (const a of this.atlasCustom.values()) a.build();
  }

  private customAtlas(color: string): GlyphAtlas {
    let a = this.atlasCustom.get(color);
    if (!a) {
      if (this.atlasCustom.size >= 24) return this.atlasNormal;
      a = new GlyphAtlas({ fill: color, outline: "#1d1426", outlineW: 6.5, shadow: "rgba(10,6,14,0.85)" });
      this.atlasCustom.set(color, a);
    }
    return a;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.vignetteCv = null;
    this.readSafeArea();
    // HUD layout depends on the viewport: re-read it the next time it's needed
    this.hudT = 0;
  }

  /** safe-area insets in px (env() only resolves inside a real CSS property) */
  private readSafeArea(): void {
    let d = this.safeProbe;
    if (!d) {
      if (!document.body) return;
      d = document.createElement("div");
      d.style.cssText =
        "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
        "padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left)";
      document.body.appendChild(d);
      this.safeProbe = d;
    }
    const cs = getComputedStyle(d);
    this.safeT = parseFloat(cs.paddingTop) || 0;
    this.safeR = parseFloat(cs.paddingRight) || 0;
    this.safeB = parseFloat(cs.paddingBottom) || 0;
    this.safeL = parseFloat(cs.paddingLeft) || 0;
  }

  clear(): void {
    for (const t of this.nums) t.active = false;
    this.activeNums = 0;
    this.hurtT = 0;
    this.flashT = 0;
    this.tabA.reset();
    this.tabB.reset();
    this.pTrail = 1;
    this.pLast = 1;
    this.pHold = 0;
  }

  // ------------------------------------------------------------ numbers

  private take(): Num {
    const t = this.nums[this.numIdx];
    this.numIdx = (this.numIdx + 1) % MAX_NUMS;
    if (!t.active) this.activeNums++;
    t.active = true;
    t.t = 0;
    return t;
  }

  /** encode value into glyph indices: 1234 -> "1234", 12345 -> "12.3K" */
  private encode(t: Num, value: number, prefix: number, suffix: number): void {
    let n = 0;
    const g = t.glyphs;
    if (prefix >= 0) g[n++] = prefix;
    let v = Math.max(0, Math.round(value));
    let unit = -1;
    let decimal = -1;
    if (v >= 1e6) {
      const m = v / 1e6;
      unit = G_M;
      if (m < 100) {
        decimal = Math.floor(m * 10) % 10;
        v = Math.floor(m);
      } else v = Math.floor(m);
    } else if (v >= 1e4) {
      const k = v / 1e3;
      unit = G_K;
      if (k < 100) {
        decimal = Math.floor(k * 10) % 10;
        v = Math.floor(k);
      } else v = Math.floor(k);
    }
    // digits (most significant first)
    const start = n;
    do {
      g[n++] = v % 10;
      v = Math.floor(v / 10);
    } while (v > 0 && n < 9);
    // reverse digits in place
    for (let a = start, b = n - 1; a < b; a++, b--) {
      const tmp = g[a];
      g[a] = g[b];
      g[b] = tmp;
    }
    if (decimal >= 0 && decimal !== 0) {
      g[n++] = G_DOT;
      g[n++] = decimal;
    }
    if (unit >= 0) g[n++] = unit;
    if (suffix >= 0) g[n++] = suffix;
    t.n = n;
  }

  damageNumber(x: number, y: number, z: number, value: number, crit: boolean, color?: string): void {
    const v = Math.max(1, value);
    // big-number emphasis relative to the recent average hit
    this.avgDmg += (v - this.avgDmg) * 0.02;
    if (!crit && this.activeNums > 90 && v < this.avgDmg * (this.activeNums > 140 ? 1.3 : 0.9)) return;
    const rel = Math.log2(v / Math.max(1, this.avgDmg));
    const mag = Math.max(0.85, Math.min(1.4, 0.95 + rel * 0.2));
    const t = this.take();
    t.kind = 0;
    t.crit = crit;
    t.x = x + (Math.random() - 0.5) * 0.5;
    t.y = y + Math.random() * 0.3;
    t.z = z + (Math.random() - 0.5) * 0.3;
    t.vx = (Math.random() - 0.5) * 44;
    t.rot = crit ? (Math.random() - 0.5) * 0.24 : 0;
    if (crit) {
      t.atlas = this.atlasCrit;
      t.size = 22 * mag;
      t.life = 0.9;
      t.rise = 50;
      this.encode(t, v, -1, G_BANG);
    } else {
      t.atlas = color ? this.customAtlas(color) : this.atlasNormal;
      t.size = 16 * mag;
      t.life = 0.62;
      t.rise = 32;
      this.encode(t, v, -1, -1);
    }
  }

  healNumber(x: number, z: number, value: number): void {
    const t = this.take();
    t.kind = 0;
    t.crit = false;
    t.atlas = this.atlasHeal;
    t.x = x;
    t.y = 2.1;
    t.z = z;
    t.vx = 0;
    t.rot = 0;
    t.size = 22;
    t.life = 1;
    t.rise = 44;
    this.encode(t, value, G_PLUS, -1);
  }

  /** floating text at a world position (e.g. "+50 ทอง") */
  floatText(x: number, z: number, text: string, color = "#ffffff", size = 20): void {
    const t = this.take();
    t.kind = 1;
    t.crit = false;
    t.atlas = null;
    t.x = x;
    t.y = 2;
    t.z = z;
    t.vx = 0;
    t.rot = 0;
    t.text = text;
    t.color = color;
    t.size = size;
    t.life = 1.15;
    t.rise = 46;
  }

  playerHit(dmg: number): void {
    const p = G.player;
    const frac = p ? dmg / Math.max(1, p.stats.maxHp) : 0.1;
    this.hurtT = 1;
    this.hurtPeak = Math.min(0.75, 0.38 + frac * 3);
    if (p && dmg >= 1) {
      const t = this.take();
      t.kind = 0;
      t.crit = false;
      t.atlas = this.atlasHurt;
      t.x = p.x + (Math.random() - 0.5) * 0.4;
      t.y = 2.2;
      t.z = p.z;
      t.vx = (Math.random() - 0.5) * 30;
      t.rot = 0;
      t.size = 20;
      t.life = 0.8;
      t.rise = 40;
      this.encode(t, dmg, G_MINUS, -1);
    }
  }

  /** full-screen colour flash (boss deaths, nukes, level ups) */
  screenFlash(color = "#ffffff", strength = 0.6, time = 0.3): void {
    if (this.flashT > 0 && this.flashStrength * (this.flashT / this.flashDur) > strength) return;
    this.flashColor = color;
    this.flashStrength = strength;
    this.flashDur = Math.max(0.05, time);
    this.flashT = this.flashDur;
  }

  // ------------------------------------------------------------ frame

  draw(dt: number): void {
    const c = this.ctx;
    const dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (G.state === "boot" || G.state === "menu") {
      return;
    }
    const simDt = G.state === "playing" ? dt : 0;
    this.drawHpBars(c, simDt);
    this.drawPlayerBar(c, simDt);
    this.drawNumbers(c, simDt);
    this.drawBossArrows(c, dt);
    this.drawJoystick(c);
    // hurt vignette
    if (this.hurtT > 0) {
      this.hurtT = Math.max(0, this.hurtT - dt * 2.6);
      this.vignette(c, this.hurtT * this.hurtT * this.hurtPeak);
    }
    const p = G.player;
    const f = p.hp / p.stats.maxHp;
    if (f < 0.3 && !p.dead) {
      // heartbeat: two quick pulses per beat, stronger as HP drops
      const ph = (G.realTime * 1.25) % 1;
      const beat = Math.exp(-ph * 14) + Math.exp(-Math.abs(ph - 0.22) * 14) * 0.7;
      const sev = 1 - f / 0.3;
      this.vignette(c, 0.16 + sev * 0.14 + beat * (0.12 + sev * 0.14));
    }
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / this.flashDur;
      c.globalAlpha = this.flashStrength * k * k;
      c.fillStyle = this.flashColor;
      c.fillRect(0, 0, this.w, this.h);
      c.globalAlpha = 1;
    }
  }

  /** red edge vignette, pre-rendered once per resize */
  private vignette(c: CanvasRenderingContext2D, alpha: number): void {
    if (alpha <= 0.003) return;
    if (!this.vignetteCv) {
      const cv = document.createElement("canvas");
      const vw = 160;
      const vh = Math.max(16, Math.round((160 * this.h) / Math.max(1, this.w)));
      cv.width = vw;
      cv.height = vh;
      const g = cv.getContext("2d")!;
      const rad = g.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.32, vw / 2, vh / 2, Math.max(vw, vh) * 0.62);
      rad.addColorStop(0, "rgba(255,20,30,0)");
      rad.addColorStop(0.6, "rgba(220,10,20,0.45)");
      rad.addColorStop(1, "rgba(150,0,10,1)");
      g.fillStyle = rad;
      g.fillRect(0, 0, vw, vh);
      this.vignetteCv = cv;
    }
    c.globalAlpha = Math.min(1, alpha);
    c.drawImage(this.vignetteCv, 0, 0, this.w, this.h);
    c.globalAlpha = 1;
  }

  private pxPerUnit(): number {
    const w = G.world;
    const fov = (w.camera.fov * Math.PI) / 180;
    return w.height / (2 * Math.tan(fov / 2) * w.camDist);
  }

  private drawHpBars(c: CanvasRenderingContext2D, dt: number): void {
    const em = G.enemies;
    const world = G.world;
    const ppu = this.pxPerUnit();
    const pt = this.pt;
    // swap trail tables: read last frame's state from prev, write into cur
    const prev = this.tabA;
    const cur = this.tabB;
    this.tabA = cur;
    this.tabB = prev;
    cur.reset();
    let n = 0;
    for (let i = 0; i < em.n && n < MAX_BARS; i++) {
      if (em.state[i] !== 0) continue;
      if (em.hp[i] >= em.maxHp[i]) continue;
      if (em.isBoss(i)) continue;
      const f = Math.max(0, em.hp[i] / em.maxHp[i]);
      // trailing "recent damage" segment: holds briefly, then drains
      const uid = em.uid[i];
      const s = prev.find(uid);
      let trail = 1;
      let last = 1;
      let hold = 0.3;
      if (s >= 0) {
        trail = prev.trail[s];
        last = prev.last[s];
        hold = prev.hold[s];
      }
      if (f < last - 1e-4) hold = Math.max(hold, 0.28);
      hold -= dt;
      if (hold <= 0) trail = Math.max(f, trail - dt * (0.9 + (trail - f) * 3));
      if (trail < f) trail = f;
      cur.insert(uid, trail, f, hold);

      const def = em.def(i);
      const y = def.hpBarY * (em.scale[i] / def.scale);
      if (!world.project(em.x[i], y, em.z[i], pt)) continue;
      const bw = Math.round(Math.max(28, Math.min(84, em.radius[i] * 2.6 * ppu)));
      const bh = bw > 50 ? 6 : 5;
      this.barX[n] = Math.round(pt.x - bw / 2);
      this.barY[n] = Math.round(pt.y - bh / 2);
      this.barW[n] = bw;
      this.barH[n] = bh;
      this.barF[n] = f;
      this.barT[n] = trail;
      this.barElite[n] = em.isElite(i) ? 1 : 0;
      n++;
    }
    if (n === 0) return;
    const X = this.barX;
    const Y = this.barY;
    const W = this.barW;
    const H = this.barH;
    const F = this.barF;
    const T = this.barT;
    // batched passes: one path + one fill per colour
    c.fillStyle = "rgba(14,8,16,0.92)";
    c.beginPath();
    for (let k = 0; k < n; k++) c.rect(X[k] - 1, Y[k] - 1, W[k] + 2, H[k] + 2);
    c.fill();
    c.fillStyle = "#fff1b8";
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const a = W[k] * F[k];
      const b = W[k] * T[k];
      if (b - a > 0.5) c.rect(X[k] + a, Y[k], b - a, H[k]);
    }
    c.fill();
    c.fillStyle = "#e8323e";
    c.beginPath();
    for (let k = 0; k < n; k++) if (!this.barElite[k] && F[k] > 0) c.rect(X[k], Y[k], Math.max(1, W[k] * F[k]), H[k]);
    c.fill();
    c.fillStyle = "#ffa424";
    c.beginPath();
    for (let k = 0; k < n; k++) if (this.barElite[k] && F[k] > 0) c.rect(X[k], Y[k], Math.max(1, W[k] * F[k]), H[k]);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.32)";
    c.beginPath();
    for (let k = 0; k < n; k++) if (F[k] > 0) c.rect(X[k], Y[k], Math.max(1, W[k] * F[k]), Math.max(1, Math.floor(H[k] * 0.4)));
    c.fill();
  }

  private drawPlayerBar(c: CanvasRenderingContext2D, dt: number): void {
    const p = G.player;
    if (p.dead) return;
    const f = Math.max(0, Math.min(1, p.hp / p.stats.maxHp));
    if (f < this.pLast - 1e-4) this.pHold = 0.35;
    else if (f > this.pTrail) this.pTrail = f;
    this.pLast = f;
    this.pHold -= dt;
    if (this.pHold <= 0) this.pTrail = Math.max(f, this.pTrail - dt * 0.8);
    if (!G.world.project(p.x, 0, p.z, this.pt)) return;
    const bw = 62;
    const bh = 8;
    const x0 = Math.round(this.pt.x - bw / 2);
    const y0 = Math.round(this.pt.y + 15);
    const low = f < 0.3;
    // frame
    c.fillStyle = "rgba(10,10,16,0.9)";
    c.beginPath();
    c.roundRect(x0 - 2, y0 - 2, bw + 4, bh + 4, 5);
    c.fill();
    // trailing damage segment
    if (this.pTrail > f + 0.002) {
      c.fillStyle = "#ffffff";
      c.fillRect(x0 + bw * f, y0, bw * (this.pTrail - f), bh);
    }
    // fill
    const col = f > 0.5 ? "#52e06a" : f > 0.25 ? "#ffcc1f" : "#ff3b30";
    c.fillStyle = col;
    if (f > 0) {
      c.beginPath();
      c.roundRect(x0, y0, Math.max(2, bw * f), bh, 3);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.35)";
      c.fillRect(x0 + 1, y0 + 1, Math.max(1, bw * f - 2), 2);
    }
    // quarter ticks
    c.fillStyle = "rgba(10,10,16,0.55)";
    for (let k = 1; k < 4; k++) c.fillRect(x0 + Math.round((bw * k) / 4), y0, 1, bh);
    if (low) {
      const pulse = 0.5 + 0.5 * Math.sin(G.realTime * 10);
      c.strokeStyle = `rgba(255,60,50,${(0.35 + pulse * 0.5).toFixed(3)})`;
      c.lineWidth = 2;
      c.beginPath();
      c.roundRect(x0 - 3, y0 - 3, bw + 6, bh + 6, 6);
      c.stroke();
    }
  }

  private drawNumbers(c: CanvasRenderingContext2D, dt: number): void {
    const world = G.world;
    const pt = this.pt;
    const dpr = this.dpr;
    let active = 0;
    // starbursts are the loudest element: cap them so crit-heavy builds stay readable
    let bursts = 0;
    // pass 0: normal numbers, pass 1: crits + texts on top
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < MAX_NUMS; i++) {
        const t = this.nums[i];
        if (!t.active) continue;
        const top = t.crit || t.kind === 1;
        if ((pass === 0) === top) continue;
        t.t += dt;
        if (t.t >= t.life) {
          t.active = false;
          continue;
        }
        active++;
        if (!world.project(t.x, t.y, t.z, pt)) continue;
        const k = t.t / t.life;
        // pop: overshoot then settle; shrink a touch while fading
        const tt = t.t;
        let pop: number;
        if (tt < 0.07) pop = 0.35 + (tt / 0.07) * (t.crit ? 1.25 : 1.0);
        else if (tt < 0.16) pop = (t.crit ? 1.6 : 1.35) - ((tt - 0.07) / 0.09) * (t.crit ? 0.6 : 0.35);
        else pop = k > 0.7 ? 1 - (k - 0.7) * 0.5 : 1;
        const e = 1 - (1 - k) * (1 - k);
        const x = pt.x + t.vx * e;
        const y = pt.y - t.rise * e;
        const alpha = k > 0.68 ? 1 - (k - 0.68) / 0.32 : 1;
        c.globalAlpha = alpha;
        if (t.kind === 1) {
          const size = Math.round(t.size * pop);
          c.font = `800 ${size}px ${FONT_FAMILY}`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.lineJoin = "round";
          c.lineWidth = Math.max(3, size * 0.24);
          c.strokeStyle = "rgba(14,8,18,0.95)";
          c.strokeText(t.text, x, y);
          c.fillStyle = t.color;
          c.fillText(t.text, x, y);
          continue;
        }
        const atlas = t.atlas!;
        const s = (t.size * pop) / ATLAS_PX;
        let tw = 0;
        for (let g = 0; g < t.n; g++) tw += atlas.adv[t.glyphs[g]];
        tw *= s;
        if (t.crit) {
          // starburst behind the crit, spinning slowly, fading early
          const bs = t.size * 1.9 * pop;
          const ba = Math.max(0, 1 - k * 1.7);
          if (ba > 0 && bursts < 10) {
            bursts++;
            const ang = t.rot + tt * 2.2;
            const cs = Math.cos(ang) * dpr;
            const sn = Math.sin(ang) * dpr;
            c.globalAlpha = alpha * ba * 0.95;
            c.setTransform(cs, sn, -sn, cs, x * dpr, y * dpr);
            c.drawImage(this.burst, -bs / 2, -bs / 2, bs, bs);
          }
          const cs = Math.cos(t.rot) * dpr;
          const sn = Math.sin(t.rot) * dpr;
          c.setTransform(cs, sn, -sn, cs, x * dpr, y * dpr);
          c.globalAlpha = alpha;
          this.blitGlyphs(c, t, atlas, -tw / 2, 0, s);
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          this.blitGlyphs(c, t, atlas, x - tw / 2, y, s);
        }
      }
    }
    this.activeNums = active;
    c.globalAlpha = 1;
  }

  private blitGlyphs(c: CanvasRenderingContext2D, t: Num, atlas: GlyphAtlas, x: number, y: number, s: number): void {
    const h = atlas.h;
    const pad = atlas.pad;
    const dy = y - (h * s) / 2;
    for (let g = 0; g < t.n; g++) {
      const gi = t.glyphs[g];
      const sw = atlas.sw[gi];
      c.drawImage(atlas.canvas, atlas.sx[gi], 0, sw, h, x - (pad + 1) * s, dy, sw * s, h * s);
      x += atlas.adv[gi] * s;
    }
  }

  /**
   * Pulsing arrow + skull badge pointing to each boss the player cannot see:
   * off-screen, or on screen but under the DOM HUD (top bar, slots, boss bars).
   * The badge sits where the player->boss ray first meets the safe screen
   * margin or a HUD block, so it is never drawn underneath the HUD.
   */
  private drawBossArrows(c: CanvasRenderingContext2D, dt: number): void {
    const em = G.enemies;
    const world = G.world;
    this.hudT -= dt;
    let ready = false;
    for (let i = 0; i < em.n; i++) {
      if (em.state[i] !== 0 || !em.isBoss(i)) continue;
      if (!ready) {
        // once per frame, and only while a boss is alive
        ready = true;
        if (this.hudT <= 0) {
          this.hudT = 0.25;
          this.hudN = G.hud ? G.hud.bandRects(this.hudRects) : 0;
        }
        const p = G.player;
        if (!world.project(p.x, 0.5, p.z, this.pt)) return;
      }
      const pt = this.pt;
      const pt2 = this.pt2;
      pt2.x = NaN;
      world.project(em.x[i], 0.5, em.z[i], pt2);
      let dx: number;
      let dy: number;
      if (pt2.x === pt2.x) {
        if (this.bossVisible(pt2.x, pt2.y)) continue;
        dx = pt2.x - pt.x;
        dy = pt2.y - pt.y;
      } else {
        // behind the camera plane (far below the screen): the world direction
        // is close enough (screen-up = world -Z)
        dx = em.x[i] - G.player.x;
        dy = em.z[i] - G.player.z;
      }
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const t = this.arrowDistance(pt.x, pt.y, dx, dy);
      if (!(t > 0)) continue;
      const ax = pt.x + dx * t;
      const ay = pt.y + dy * t;
      const pulse = 1 + Math.sin(G.realTime * 8) * 0.12;
      c.save();
      c.translate(ax, ay);
      // skull badge
      c.fillStyle = "#1a0505";
      c.beginPath();
      c.arc(0, 0, 17 * pulse, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#ff3b30";
      c.beginPath();
      c.arc(0, 0, 14 * pulse, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#fff2e6";
      c.beginPath();
      c.arc(0, -1.5, 8, 0, Math.PI * 2);
      c.fill();
      c.fillRect(-4.5, 3, 9, 5);
      c.fillStyle = "#1a0505";
      c.beginPath();
      c.arc(-3.2, -2, 2.4, 0, Math.PI * 2);
      c.arc(3.2, -2, 2.4, 0, Math.PI * 2);
      c.fill();
      c.fillRect(-0.8, 4, 1.6, 4);
      // arrow head beyond the badge
      c.rotate(Math.atan2(dy, dx));
      c.translate(24 + (pulse - 1) * 30, 0);
      c.fillStyle = "#ff3b30";
      c.strokeStyle = "#1a0505";
      c.lineWidth = 3;
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(12, 0);
      c.lineTo(-6, -11);
      c.lineTo(-2, 0);
      c.lineTo(-6, 11);
      c.closePath();
      c.stroke();
      c.fill();
      c.restore();
    }
  }

  /** screen point (boss feet) is inside the safe playfield and clear of the HUD */
  private bossVisible(x: number, y: number): boolean {
    const m = ARROW_EDGE;
    if (x < this.safeL + m || x > this.w - this.safeR - m || y < this.safeT + m || y > this.h - this.safeB - m) return false;
    const r = this.hudRects;
    const pad = HIDDEN_HUD_PAD;
    for (let k = 0; k < this.hudN; k++) {
      const o = k * 4;
      if (x > r[o] - pad && x < r[o + 2] + pad && y > r[o + 1] - pad && y < r[o + 3] + pad) return false;
    }
    return true;
  }

  /**
   * Distance along the ray (ox, oy) + t * (dx, dy) to the first obstacle: the
   * safe-area-inset screen margin or a padded HUD block. <= 0 = no room.
   */
  private arrowDistance(ox: number, oy: number, dx: number, dy: number): number {
    const m = ARROW_EDGE;
    const left = this.safeL + m;
    const right = this.w - this.safeR - m;
    const top = this.safeT + m;
    const bottom = this.h - this.safeB - m;
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (right - ox) / dx);
    else if (dx < -1e-6) t = Math.min(t, (left - ox) / dx);
    if (dy > 1e-6) t = Math.min(t, (bottom - oy) / dy);
    else if (dy < -1e-6) t = Math.min(t, (top - oy) / dy);
    if (t === Infinity) return 0;
    const r = this.hudRects;
    const pad = ARROW_HUD_PAD;
    for (let k = 0; k < this.hudN; k++) {
      const o = k * 4;
      // slab test of the segment [0, t] against the padded block
      let t0 = 0;
      let t1 = t;
      const x0 = r[o] - pad;
      const y0 = r[o + 1] - pad;
      const x1 = r[o + 2] + pad;
      const y1 = r[o + 3] + pad;
      if (Math.abs(dx) < 1e-6) {
        if (ox < x0 || ox > x1) continue;
      } else {
        const a = (x0 - ox) / dx;
        const b = (x1 - ox) / dx;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      if (Math.abs(dy) < 1e-6) {
        if (oy < y0 || oy > y1) continue;
      } else {
        const a = (y0 - oy) / dy;
        const b = (y1 - oy) / dy;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      // the player itself inside a padded block (tiny screens): ignore that block
      if (t0 <= 0 || t0 > t1) continue;
      t = t0;
    }
    return t;
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
