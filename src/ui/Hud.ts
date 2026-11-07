import { G } from "../core/G";
import { Meta } from "../core/Meta";
import { formatTime, formatNum } from "../core/math";
import { iconURL, uiIcon, prewarmIcon, prewarmUi } from "./icons";
import { onTap } from "./tap";
import { weaponById, WEAPONS } from "../weapons/registry";
import { passiveById, PASSIVES } from "../upgrades/passives";
import { RUN_LENGTH } from "../director/Director";
import type { Choice } from "../weapons/WeaponSystem";
import type { UltimateDef } from "../player/ultimates/types";
import "./ultimate.css";

const SVG_NS = "http://www.w3.org/2000/svg";
/** ultimate ring: r = 46 in a 100x100 viewBox */
const ULT_C = 2 * Math.PI * 46;
/** ring fill steps (DOM is only written when the quantised value changes) */
const ULT_STEPS = 200;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function img(cls: string, parent: HTMLElement, src = ""): HTMLImageElement {
  const i = el("img", cls, parent);
  i.alt = "";
  i.draggable = false;
  if (src) i.src = src;
  return i;
}

/** split "สปีดโจมตี +110%" into label / value parts for two-tone toast lines */
export function splitStatLine(line: string): [string, string] {
  const m = /^(.*?)\s*([+\-−×x]\s?[\d.,]+\s?%?|[\d.,]+\s?%)\s*$/.exec(line);
  if (!m || !m[1]) return [line, ""];
  return [m[1], m[2]];
}

/** a weapon/passive slot in the HUD rows */
interface SlotView {
  root: HTMLDivElement;
  icon: HTMLImageElement;
  pips: HTMLDivElement;
  id: string;
  level: number;
  evolved: boolean;
}

/** one boss HP bar in the stacked boss panel */
interface BossView {
  root: HTMLDivElement;
  name: HTMLSpanElement;
  fill: HTMLDivElement;
  trail: HTMLDivElement;
  pct: HTMLSpanElement;
  /** tracked enemy uid (-1 = bar unused) and its last known slot */
  uid: number;
  slot: number;
  frac: number;
  pctV: number;
  label: string;
}

interface ToastItem {
  el: HTMLDivElement;
  /** seconds alive (only advances while playing) */
  t: number;
  mini: boolean;
  /** time when the out animation started, -1 = not leaving */
  outT: number;
}

const WEAPON_SLOTS = 6;
const PASSIVE_SLOTS = 6;
/** skill toasts sit over the playfield: keep them brief (seconds of play time) */
const TOAST_LIFE = 1.8;
const MINI_LIFE = 2.4;
const MAX_MINIS = 2;
/** stat lines shown in a big toast (the level-up card already listed them all) */
const TOAST_LINES = 2;
/** bosses shown at once (a weak build can face two or three overlapping bosses) */
const MAX_BOSS_BARS = 3;

/**
 * In-game DOM HUD: portrait + level + XP bar (top-left), gold, timer, kills,
 * pause button, weapon/passive slots with level pips, skill toasts (left),
 * boss bar, announcement banner and the first-run movement hint.
 *
 * update() runs every frame but only writes to the DOM when a value changed;
 * bars use transform: scaleX so they never trigger layout.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private portraitBox: HTMLDivElement;
  private portrait: HTMLImageElement;
  private lvl: HTMLSpanElement;
  private name: HTMLDivElement;
  private xpBox: HTMLDivElement;
  private xpFill: HTMLDivElement;
  private xpText: HTMLSpanElement;
  private goldBox: HTMLDivElement;
  private gold: HTMLSpanElement;
  private clockBox: HTMLDivElement;
  private time: HTMLSpanElement;
  private kills: HTMLSpanElement;
  private weaponRow: HTMLDivElement;
  private passiveRow: HTMLDivElement;
  private wSlots: SlotView[] = [];
  private pSlots: SlotView[] = [];
  private toastsEl: HTMLDivElement;
  private bossBox: HTMLDivElement;
  private bossViews: BossView[] = [];
  private bossMore: HTMLDivElement;
  private announceEl: HTMLDivElement;
  private announceText: HTMLDivElement;
  private hint: HTMLDivElement;
  private fps: HTMLDivElement;
  // ultimate button + cast cut-in
  private ultBtn: HTMLButtonElement;
  private ultFill: SVGCircleElement;
  private ultIcon: HTMLImageElement;
  private ultLabel: HTMLSpanElement;
  private ultDenyFlip = false;
  private ultTip: HTMLDivElement;
  /** realTime when the tip hides (0 = hidden); shown once per run, first runs only */
  private ultTipUntil = 0;
  private ultTipDone = false;
  private cutIn: HTMLDivElement;
  private cutHero: HTMLImageElement;
  private cutName: HTMLElement;
  /** HUD blocks that cover the playfield (top bar, kills/pause, slots, boss bars) */
  private bandEls: HTMLElement[] = [];
  private autoChipEl: HTMLElement | null = null;

  private last: Record<string, string | number | boolean> = {};
  private lastRT = 0;
  private bump = false;
  private flash = false;

  // toasts
  private toastQueue: Choice[] = [];
  private toasts: ToastItem[] = [];
  private toastGap = 0;

  // boss tracking: periodic scan collects the newest bosses (by uid)
  private bossScanT = 0;
  private readonly bossUids = new Int32Array(MAX_BOSS_BARS);
  private readonly bossSlots = new Int32Array(MAX_BOSS_BARS);

  // first-run hint
  private hintOn = false;
  private hintMoveT = 0;

  // passives iteration without allocating an iterator each frame
  private pIdx = 0;
  private readonly visitPassive = (lvl: number, id: string): void => {
    const s = this.pSlots[this.pIdx++];
    if (s) this.setSlot(s, "passive", id, lvl, false);
  };

  constructor(ui: HTMLElement) {
    this.root = el("div", "hud hidden", ui);

    // ---------------------------------------------------------- top bar
    const top = el("div", "hud-top", this.root);
    const pl = el("div", "hud-player", top);
    this.portraitBox = el("div", "hud-portrait", pl);
    const pf = el("div", "hud-portrait-frame", this.portraitBox);
    this.portrait = img("", pf);
    const lv = el("div", "hud-lvl", this.portraitBox);
    el("small", "", lv, "Lv");
    this.lvl = el("span", "", lv, "1");
    const info = el("div", "hud-info", pl);
    this.name = el("div", "hud-name", info);
    this.xpBox = el("div", "hud-xp", info);
    const xpTrack = el("div", "hud-xp-track", this.xpBox);
    this.xpFill = el("div", "hud-xp-fill", xpTrack);
    this.xpText = el("span", "hud-xp-text", this.xpBox, "0/0");

    this.goldBox = el("div", "hud-gold chip", top);
    img("chip-icon", this.goldBox, uiIcon("coin", 64));
    this.gold = el("span", "chip-val", this.goldBox, "0");

    this.clockBox = el("div", "hud-clock chip", top);
    img("chip-icon", this.clockBox, uiIcon("hourglass", 64));
    this.time = el("span", "chip-val", this.clockBox, "00:00");

    // ---------------------------------------------------------- second row (right)
    const sub = el("div", "hud-sub", this.root);
    const kb = el("div", "hud-kills chip", sub);
    img("chip-icon", kb, uiIcon("skull", 64));
    this.kills = el("span", "chip-val", kb, "0");
    const pause = el("button", "hud-pause interactive", sub);
    pause.type = "button";
    pause.setAttribute("aria-label", "หยุดชั่วคราว");
    el("span", "", pause);
    el("span", "", pause);
    // onTap: works as a second finger while the joystick thumb is held
    onTap(pause, () => G.screens.togglePause());

    // ---------------------------------------------------------- slots
    const slots = el("div", "hud-slots", this.root);
    this.weaponRow = el("div", "slot-row weapons", slots);
    this.passiveRow = el("div", "slot-row passives", slots);
    for (let i = 0; i < WEAPON_SLOTS; i++) this.wSlots.push(this.makeSlot(this.weaponRow));
    for (let i = 0; i < PASSIVE_SLOTS; i++) this.pSlots.push(this.makeSlot(this.passiveRow));

    // ---------------------------------------------------------- boss bars
    this.bossBox = el("div", "hud-bosses", this.root);
    for (let k = 0; k < MAX_BOSS_BARS; k++) this.bossViews.push(this.makeBossView(k));
    this.bossMore = el("div", "hud-boss-more hidden", this.bossBox);
    this.bandEls.push(top, sub, slots, this.bossBox);

    // ---------------------------------------------------------- toasts, banner, hint
    this.toastsEl = el("div", "hud-toasts", this.root);
    this.announceEl = el("div", "hud-announce", this.root);
    const band = el("div", "ann-band", this.announceEl);
    this.announceText = el("div", "ann-text", band);

    this.hint = el("div", "hud-hint hidden", this.root);
    const hand = el("div", "hint-stick", this.hint);
    el("i", "hint-base", hand);
    el("i", "hint-knob", hand);
    el("div", "hint-text", this.hint);

    this.fps = el("div", "hud-fps", this.root);

    // ---------------------------------------------------------- ultimate
    this.cutIn = el("div", "ult-cutin", this.root);
    const cband = el("div", "uc-band", this.cutIn);
    this.cutHero = img("uc-hero", cband);
    const ctext = el("div", "uc-text", cband);
    el("small", "uc-tag", ctext, "ไม้ตาย!");
    this.cutName = el("b", "uc-name", ctext);

    this.ultBtn = el("button", "hud-ult interactive", this.root);
    this.ultBtn.type = "button";
    this.ultBtn.setAttribute("aria-label", "ไม้ตาย");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ult-ring");
    svg.setAttribute("viewBox", "0 0 100 100");
    const track = document.createElementNS(SVG_NS, "circle");
    track.setAttribute("class", "ult-track");
    this.ultFill = document.createElementNS(SVG_NS, "circle");
    this.ultFill.setAttribute("class", "ult-fill");
    for (const c of [track, this.ultFill]) {
      c.setAttribute("cx", "50");
      c.setAttribute("cy", "50");
      c.setAttribute("r", "46");
      svg.appendChild(c);
    }
    this.ultFill.style.strokeDasharray = ULT_C.toFixed(2);
    this.ultFill.style.strokeDashoffset = ULT_C.toFixed(2);
    el("i", "ult-spark", this.ultBtn);
    this.ultBtn.appendChild(svg);
    const core = el("span", "ult-core", this.ultBtn);
    this.ultIcon = img("ult-icon", core);
    this.ultLabel = el("span", "ult-label", this.ultBtn, "0%");
    el("span", "ult-key", this.ultBtn, "Space");
    // first-runs tip bubble (sibling: it must not catch taps meant for the button)
    this.ultTip = el("div", "ult-tip", this.root);
    // boss arrows stay clear of it too
    this.bandEls.push(this.ultBtn);
    // onTap: works as a second finger while the joystick thumb is held
    onTap(this.ultBtn, () => this.castUlt());
    G.input.setUltHandler(() => {
      if (G.state !== "playing") return false;
      this.castUlt();
      return true;
    });

    G.events.on("announce", (e) => this.announce(e.text, e.color));
    G.events.on("bossSpawned", (e) => {
      this.announce(`${e.name} ปรากฏตัว!`, "#ff4f6a", "boss");
      this.bossScanT = 0;
    });
    G.events.on("bossKilled", () => {
      this.bossScanT = 0;
    });
    G.events.on("levelUp", () => this.flashLevel());
    Hud.prewarm();
  }

  /**
   * Generate every weapon / evolution / passive icon (and the chest art) in
   * idle time, so the level-up, chest and pause screens never have to draw
   * several canvases in the frame they open.
   */
  private static prewarm(): void {
    // icons may draw text: wait for the web font so the cache never keeps a
    // fallback-font version
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts && fonts.status !== "loaded") {
      fonts.ready.then(() => Hud.prewarmNow()).catch(() => Hud.prewarmNow());
    } else Hud.prewarmNow();
  }

  private static prewarmNow(): void {
    for (const w of WEAPONS) {
      prewarmIcon("w:" + w.id, w.icon);
      if (w.evolution) prewarmIcon("e:" + w.id, w.evolution.icon ?? w.icon);
    }
    for (const p of PASSIVES) prewarmIcon("p:" + p.id, p.icon);
    prewarmUi("chest", 192);
    prewarmUi("chestOpen", 192);
    prewarmUi("bossSkull", 64);
  }

  private makeBossView(k: number): BossView {
    const root = el("div", "hud-boss hidden" + (k > 0 ? " sub" : ""), this.bossBox);
    const bh = el("div", "hud-boss-head", root);
    img("hud-boss-skull", bh, uiIcon("bossSkull", 64));
    const name = el("span", "hud-boss-name", bh);
    const bb = el("div", "hud-boss-bar", root);
    const trail = el("div", "hud-boss-trail", bb);
    const fill = el("div", "hud-boss-fill", bb);
    el("div", "hud-boss-ticks", bb);
    const pct = el("span", "hud-boss-pct", bb);
    return { root, name, fill, trail, pct, uid: -1, slot: -1, frac: -1, pctV: -1, label: "" };
  }

  private makeSlot(parent: HTMLElement): SlotView {
    const root = el("div", "slot empty", parent);
    const icon = img("slot-icon", root);
    const pips = el("div", "slot-pips", root);
    return { root, icon, pips, id: "", level: -1, evolved: false };
  }

  show(on: boolean): void {
    this.root.classList.toggle("hidden", !on);
  }

  /**
   * Screen rectangles (CSS px, [left, top, right, bottom] per block) of the HUD
   * blocks that sit over the playfield, so canvas markers (boss arrows) can
   * stay clear of them. Reads layout: call rarely (on resize / ~2x per second).
   * Returns the number of rects written.
   */
  bandRects(out: Float32Array): number {
    if (this.root.classList.contains("hidden")) return 0;
    let n = 0;
    // the AUTO chip is mounted by Screens (src/ui/autoChip.ts); pick it up lazily
    if (!this.autoChipEl) {
      const chip = document.querySelector<HTMLElement>(".auto-chip-wrap");
      if (chip) {
        this.autoChipEl = chip;
        this.bandEls.push(chip);
      }
    }
    for (const e of this.bandEls) {
      if (n * 4 + 4 > out.length) break;
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      out[n * 4] = r.left;
      out[n * 4 + 1] = r.top;
      out[n * 4 + 2] = r.right;
      out[n * 4 + 3] = r.bottom;
      n++;
    }
    return n;
  }

  reset(): void {
    this.toastsEl.textContent = "";
    this.toasts.length = 0;
    this.toastQueue.length = 0;
    this.toastGap = 0;
    this.last = {};
    for (const s of this.wSlots) this.clearSlot(s);
    for (const s of this.pSlots) this.clearSlot(s);
    const h = G.player.hero;
    this.portrait.src = iconURL("hero:" + h.id, h.portrait, 128);
    this.portraitBox.style.setProperty("--accent", h.color);
    this.name.textContent = h.name;
    const u = h.ultimate;
    this.ultIcon.src = iconURL("ult:" + u.id, u.icon, 128);
    this.ultBtn.style.setProperty("--ult", u.color);
    this.ultBtn.setAttribute("aria-label", `ไม้ตาย: ${u.name}`);
    this.ultBtn.classList.remove("ready", "active", "denyA", "denyB");
    this.cutIn.classList.remove("show");
    this.ultTip.classList.remove("show");
    this.ultTipUntil = 0;
    // only new players get the "tap here" bubble (first few runs)
    this.ultTipDone = Meta.data.runs >= 3 || G.debug.autoplay;
    const fine = window.matchMedia?.("(pointer: fine)").matches ?? false;
    this.ultTip.textContent = fine ? "กด Space ปล่อยไม้ตาย!" : "แตะเพื่อปล่อยไม้ตาย!";
    for (const v of this.bossViews) this.bindBoss(v, -1, -1);
    this.bossMore.classList.add("hidden");
    this.bossScanT = 0;
    this.announceEl.classList.remove("show", "boss");
    this.lastRT = G.realTime;
    // first-run movement hint
    this.hintOn = !Meta.data.tutorialDone;
    this.hintMoveT = 0;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? true;
    (this.hint.lastElementChild as HTMLElement).textContent = coarse
      ? "ลากนิ้วเพื่อเคลื่อนที่ • อาวุธโจมตีอัตโนมัติ"
      : "ลากเมาส์หรือกด WASD เพื่อเคลื่อนที่ • อาวุธโจมตีอัตโนมัติ";
    this.hint.classList.toggle("hidden", !this.hintOn);
    this.hint.classList.remove("out");
  }

  /** returns true if the value changed (and stores it) */
  private changed(key: string, v: string | number | boolean): boolean {
    if (this.last[key] === v) return false;
    this.last[key] = v;
    return true;
  }

  update(): void {
    const now = G.realTime;
    const dt = Math.min(0.1, Math.max(0, now - this.lastRT));
    this.lastRT = now;
    const playing = G.state === "playing";
    if (this.changed("frozen", !playing)) this.root.classList.toggle("frozen", !playing);

    const p = G.player;
    if (this.changed("lvl", p.level)) this.lvl.textContent = String(p.level);
    const xp = Math.floor(p.xp);
    const xpChanged = this.changed("xp", xp);
    const nextChanged = this.changed("xpn", p.xpNext);
    if (xpChanged || nextChanged) {
      this.xpText.textContent = `${xp}/${p.xpNext}`;
      const f = Math.max(0, Math.min(1, p.xp / p.xpNext));
      this.xpFill.style.transform = `scaleX(${f.toFixed(3)})`;
    }
    const gold = Math.floor(G.stats.gold);
    if (this.changed("gold", gold)) {
      this.gold.textContent = formatNum(gold);
      if (gold > 0) {
        // restart the bump animation without forcing a reflow
        this.bump = !this.bump;
        this.goldBox.classList.toggle("bumpA", this.bump);
        this.goldBox.classList.toggle("bumpB", !this.bump);
      }
    }
    const secs = Math.floor(G.time);
    if (this.changed("time", secs)) {
      this.time.textContent = formatTime(secs);
      const final = RUN_LENGTH - secs <= 30 && secs < RUN_LENGTH;
      if (this.changed("final", final)) this.clockBox.classList.toggle("final", final);
    }
    if (this.changed("kills", G.stats.kills)) this.kills.textContent = formatNum(G.stats.kills);

    this.updateSlots();
    this.updateUlt();
    this.updateBoss(dt);
    this.updateToasts(playing ? dt : 0);
    this.updateHint(playing ? dt : 0);

    const showFps = G.debug.showFps;
    if (this.changed("fpsOn", showFps)) this.fps.classList.toggle("hidden", !showFps);
    if (showFps && this.changed("fpsT", Math.floor(now * 4))) {
      const f = G.perf;
      this.fps.textContent = `${f.fps.toFixed(0)}fps ${f.frameMs.toFixed(1)}ms • ศัตรู ${f.enemies} • p ${f.particles} • dc ${f.drawCalls}`;
    }
  }

  // ------------------------------------------------------------ slots

  private updateSlots(): void {
    const ws = G.weapons.weapons;
    // debug loadouts can exceed the normal 6 slots: grow the row on demand
    while (this.wSlots.length < ws.length) this.wSlots.push(this.makeSlot(this.weaponRow));
    for (let i = 0; i < this.wSlots.length; i++) {
      const w = ws[i];
      if (w) this.setSlot(this.wSlots[i], "weapon", w.def.id, w.level, w.evolved);
      else this.clearSlot(this.wSlots[i]);
    }
    const pn = G.weapons.passives.size;
    while (this.pSlots.length < pn) this.pSlots.push(this.makeSlot(this.passiveRow));
    this.pIdx = 0;
    G.weapons.passives.forEach(this.visitPassive);
    for (let i = this.pIdx; i < this.pSlots.length; i++) this.clearSlot(this.pSlots[i]);
  }

  private clearSlot(s: SlotView): void {
    if (s.id === "") return;
    s.id = "";
    s.level = -1;
    s.evolved = false;
    s.root.className = "slot empty";
    s.icon.removeAttribute("src");
  }

  private setSlot(s: SlotView, kind: "weapon" | "passive", id: string, level: number, evolved: boolean): void {
    if (s.id === id && s.level === level && s.evolved === evolved) return;
    const fresh = s.id !== id;
    const levelled = !fresh && s.level !== level && s.level >= 0;
    s.id = id;
    s.level = level;
    s.evolved = evolved;
    let max = 8;
    if (kind === "weapon") {
      const d = weaponById(id);
      if (d) {
        max = d.maxLevel;
        const evIcon = evolved && d.evolution?.icon;
        s.icon.src = iconURL((evolved ? "e:" : "w:") + id, evIcon || d.icon);
      }
    } else {
      const d = passiveById(id);
      if (d) {
        max = d.maxLevel;
        s.icon.src = iconURL("p:" + id, d.icon);
      }
    }
    s.pips.style.setProperty("--n", String(max));
    s.pips.style.setProperty("--f", (Math.min(level, max) / max).toFixed(3));
    let cls = "slot";
    if (evolved) cls += " evolved";
    else if (level >= max) cls += " max";
    if (fresh) cls += " pop";
    else if (levelled) cls += level % 2 ? " upA" : " upB";
    s.root.className = cls;
  }

  // ------------------------------------------------------------ boss

  private updateBoss(dt: number): void {
    const em = G.enemies;
    this.bossScanT -= dt;
    if (this.bossScanT <= 0) {
      // periodic full scan (cheap: 2x/s): keep the newest bosses, newest on top
      this.bossScanT = 0.5;
      const uids = this.bossUids;
      const slots = this.bossSlots;
      uids.fill(-1);
      let total = 0;
      for (let i = 0; i < em.n; i++) {
        if (em.state[i] !== 0 || !em.isBoss(i)) continue;
        total++;
        // insertion into a tiny sorted (desc by uid) array
        const u = em.uid[i];
        let k = MAX_BOSS_BARS - 1;
        if (u <= uids[k]) continue;
        while (k > 0 && u > uids[k - 1]) {
          uids[k] = uids[k - 1];
          slots[k] = slots[k - 1];
          k--;
        }
        uids[k] = u;
        slots[k] = i;
      }
      let shown = 0;
      for (let k = 0; k < MAX_BOSS_BARS; k++) {
        this.bindBoss(this.bossViews[k], uids[k], slots[k]);
        if (uids[k] >= 0) shown++;
      }
      // lets CSS push the announcement banner below the stack
      if (this.changed("bossShown", shown)) this.root.dataset.bosses = String(shown);
      const extra = total - MAX_BOSS_BARS;
      if (this.changed("bossMore", extra)) {
        this.bossMore.classList.toggle("hidden", extra <= 0);
        this.bossMore.textContent = extra > 0 ? `+${extra} บอส` : "";
      }
    }
    for (let k = 0; k < MAX_BOSS_BARS; k++) this.updateBossView(this.bossViews[k]);
  }

  /** attach a bar to a boss uid (or detach with uid -1) */
  private bindBoss(v: BossView, uid: number, slot: number): void {
    if (v.uid === uid) {
      v.slot = slot;
      return;
    }
    const wasOn = v.uid >= 0;
    v.uid = uid;
    v.slot = slot;
    v.frac = -1;
    v.pctV = -1;
    if (uid < 0) {
      v.root.classList.add("hidden");
      v.label = "";
      return;
    }
    const name = G.enemies.def(slot).name;
    if (v.label !== name) {
      v.label = name;
      v.name.textContent = name;
    }
    // a new boss replacing a bar re-plays the entrance; the trail snaps to full
    v.trail.style.transition = "none";
    v.trail.style.transform = "scaleX(1)";
    v.fill.style.transform = "scaleX(1)";
    v.root.classList.remove("dead");
    requestAnimationFrame(() => {
      v.trail.style.transition = "";
    });
    if (!wasOn) v.root.classList.remove("hidden");
    else {
      v.root.classList.add("hidden");
      // re-show next frame so the entrance animation restarts without a reflow
      requestAnimationFrame(() => v.uid >= 0 && v.root.classList.remove("hidden"));
    }
  }

  private updateBossView(v: BossView): void {
    if (v.uid < 0) return;
    const em = G.enemies;
    let i = v.slot;
    // slots move when enemies are compacted: re-find by uid when stale
    if (!(i >= 0 && i < em.n && em.uid[i] === v.uid && em.state[i] === 0)) {
      i = v.slot = em.findByUid(v.uid);
      if (i < 0) {
        // died: show it empty until the next scan removes the bar
        if (v.frac !== 0) {
          v.frac = 0;
          v.fill.style.transform = "scaleX(0)";
          v.trail.style.transform = "scaleX(0)";
          v.pct.textContent = "0%";
          v.root.classList.add("dead");
        }
        this.bossScanT = Math.min(this.bossScanT, 0.35);
        return;
      }
    }
    const f = Math.max(0, Math.min(1, em.hp[i] / em.maxHp[i]));
    if (Math.abs(f - v.frac) > 0.001) {
      v.frac = f;
      const sx = `scaleX(${f.toFixed(4)})`;
      v.fill.style.transform = sx;
      v.trail.style.transform = sx;
      const pct = Math.ceil(f * 100);
      if (pct !== v.pctV) {
        v.pctV = pct;
        v.pct.textContent = `${pct}%`;
      }
    }
  }

  // ------------------------------------------------------------ toasts

  /** left-side "skill acquired" toast (queued; plays while the run is active) */
  toast(c: Choice): void {
    this.toastQueue.push(c);
  }

  private updateToasts(dt: number): void {
    if (dt <= 0) return;
    this.toastGap -= dt;
    if (this.toastQueue.length && this.toastGap <= 0) {
      this.spawnToast(this.toastQueue.shift()!);
      this.toastGap = this.toastQueue.length > 3 ? 0.28 : 0.5;
    }
    for (let k = this.toasts.length - 1; k >= 0; k--) {
      const t = this.toasts[k];
      t.t += dt;
      if (t.outT < 0 && t.t > (t.mini ? MINI_LIFE : TOAST_LIFE)) {
        t.outT = t.t;
        t.el.classList.add("out");
      }
      if (t.outT >= 0 && t.t - t.outT > 0.4) {
        t.el.remove();
        this.toasts.splice(k, 1);
      }
    }
  }

  private spawnToast(c: Choice): void {
    // demote the current big toast(s) to compact rows
    let minis = 0;
    for (let k = this.toasts.length - 1; k >= 0; k--) {
      const t = this.toasts[k];
      if (t.outT >= 0) continue;
      if (!t.mini) {
        t.mini = true;
        t.el.classList.add("mini");
      }
      minis++;
      if (minis > MAX_MINIS) {
        t.outT = t.t;
        t.el.classList.add("out");
      }
    }
    const root = el("div", "toast", this.toastsEl);
    root.style.setProperty("--accent", c.color);
    if (c.kind === "evolve") root.classList.add("evo");
    const ic = el("div", "toast-icon", root);
    const frame = el("div", "icon-frame", ic);
    el("i", "icon-spin", frame);
    img("", frame, c.icon);
    const tag = c.isNew ? "ใหม่!" : c.kind === "evolve" ? "วิวัฒน์!" : c.kind === "weapon" || c.kind === "passive" ? `Lv.${c.level}` : "";
    if (tag) el("span", "toast-tag" + (c.isNew ? " new" : c.kind === "evolve" ? " evo" : ""), ic, tag);
    const body = el("div", "toast-body", root);
    el("div", "toast-name", body, c.name);
    const lines = c.lines.length ? c.lines : [c.desc];
    for (let i = 0; i < Math.min(TOAST_LINES, lines.length); i++) {
      const [lbl, val] = splitStatLine(lines[i]);
      const d = el("div", `toast-line l${i}`, body);
      el("span", "lbl", d, lbl);
      if (val) el("span", "val", d, " " + val);
      d.style.animationDelay = `${0.12 + 0.07 * i}s`;
    }
    this.toasts.push({ el: root, t: 0, mini: false, outT: -1 });
  }

  // ------------------------------------------------------------ ultimate

  private castUlt(): void {
    if (G.state !== "playing") return;
    if (G.player.ult.tryCast()) return;
    if (G.player.ult.active) return;
    // not charged yet: wiggle + soft deny (restart the animation without a reflow)
    this.ultDenyFlip = !this.ultDenyFlip;
    this.ultBtn.classList.toggle("denyA", this.ultDenyFlip);
    this.ultBtn.classList.toggle("denyB", !this.ultDenyFlip);
    G.audio.sfx("deny", { vol: 0.6 });
  }

  private updateUlt(): void {
    const u = G.player.ult;
    const state = u.active ? 2 : u.ready ? 1 : 0;
    if (this.changed("ultState", state)) {
      this.ultBtn.classList.toggle("ready", state === 1);
      this.ultBtn.classList.toggle("active", state === 2);
      if (state === 1) this.ultLabel.textContent = "ไม้ตาย!";
      else if (state === 2) this.ultLabel.textContent = "ปล่อย!";
      else this.last.ultPct = -1;
      if (state === 1 && !this.ultTipDone) {
        this.ultTipDone = true;
        this.ultTipUntil = G.realTime + 7;
        this.ultTip.classList.add("show");
      } else if (state !== 1 && this.ultTipUntil > 0) {
        this.ultTipUntil = 0;
        this.ultTip.classList.remove("show");
      }
    }
    if (this.ultTipUntil > 0 && G.realTime > this.ultTipUntil) {
      this.ultTipUntil = 0;
      this.ultTip.classList.remove("show");
    }
    // ring: charge while filling, remaining time while the effect plays
    const f = state === 2 ? 1 - u.activeFrac : Math.min(1, u.charge);
    const q = Math.round(f * ULT_STEPS);
    if (this.changed("ultQ", q)) this.ultFill.style.strokeDashoffset = (ULT_C * (1 - q / ULT_STEPS)).toFixed(1);
    if (state === 0) {
      const pct = Math.min(99, Math.floor(u.charge * 100));
      if (this.changed("ultPct", pct)) this.ultLabel.textContent = `${pct}%`;
    }
  }

  /** big diagonal cut-in with the hero and the ultimate's name */
  ultCast(def: UltimateDef): void {
    const h = G.player.hero;
    this.cutHero.src = iconURL("hero:" + h.id, h.portrait, 128);
    this.cutName.textContent = def.name;
    this.cutIn.style.setProperty("--c", def.color);
    this.cutIn.style.setProperty("--h", h.color);
    this.cutIn.classList.remove("show");
    void this.cutIn.offsetWidth; // restart the CSS animation (rare event, reflow is fine)
    this.cutIn.classList.add("show");
  }

  // ------------------------------------------------------------ banner

  /** big centred-top banner. style "boss" gets hazard stripes */
  announce(text: string, color = "#ffffff", style: "info" | "boss" = "info"): void {
    const a = this.announceEl;
    this.announceText.textContent = text;
    a.style.setProperty("--c", color);
    a.classList.remove("show");
    a.classList.toggle("boss", style === "boss");
    void a.offsetWidth; // restart the CSS animation (rare event, reflow is fine)
    a.classList.add("show");
  }

  private flashLevel(): void {
    this.flash = !this.flash;
    this.portraitBox.classList.toggle("lvA", this.flash);
    this.portraitBox.classList.toggle("lvB", !this.flash);
    this.xpBox.classList.toggle("lvA", this.flash);
    this.xpBox.classList.toggle("lvB", !this.flash);
  }

  // ------------------------------------------------------------ hint

  private updateHint(dt: number): void {
    if (!this.hintOn || dt <= 0) return;
    const inp = G.input;
    if (Math.abs(inp.moveX) + Math.abs(inp.moveZ) > 0.2) this.hintMoveT += dt;
    if (this.hintMoveT > 0.7) {
      this.hintOn = false;
      this.hint.classList.add("out");
      // only a real player completes the tutorial (not the autoplay bot)
      if (!G.debug.autoplay) {
        Meta.data.tutorialDone = true;
        Meta.save();
      }
    }
  }

  /** look up a weapon/passive icon (helper for screens) */
  static iconFor(kind: "weapon" | "passive", id: string): string {
    if (kind === "weapon") {
      const d = weaponById(id);
      return d ? iconURL("w:" + id, d.icon) : "";
    }
    const p = passiveById(id);
    return p ? iconURL("p:" + id, p.icon) : "";
  }
}
