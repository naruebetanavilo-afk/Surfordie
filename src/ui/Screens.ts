import { G } from "../core/G";
import { Flow } from "../core/flow";
import { Meta, SHOP, PICK_TIMER_DEFAULT, type ShopUpgrade } from "../core/Meta";
import { HEROES, type HeroDef } from "../player/heroes";
import { iconURL, uiIcon, shopIcon, type UiIconName } from "./icons";
import { formatTime, formatNum } from "../core/math";
import { weaponById } from "../weapons/registry";
import { passiveById } from "../upgrades/passives";
import { RUN_LENGTH } from "../director/Director";
import { splitStatLine } from "./Hud";
import { onTap } from "./tap";
import { choiceKey, type Choice, type LevelUpAction } from "../weapons/WeaponSystem";
import { recommend } from "../weapons/recommend";
import { luIcon, luShopIcon, type LevelUpGlyph } from "./levelupIcons";
import { AutoChip } from "./autoChip";
import "./levelup.css";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function img(cls: string, parent: HTMLElement, src: string): HTMLImageElement {
  const i = el("img", cls, parent);
  i.alt = "";
  i.draggable = false;
  i.src = src;
  return i;
}

/** icon inside a frame with a spinning accent glow (badge can sit outside the frame) */
function framedIcon(parent: HTMLElement, cls: string, src: string): HTMLDivElement {
  const box = el("div", cls, parent);
  const frame = el("div", "icon-frame", box);
  el("i", "icon-spin", frame);
  img("", frame, src);
  return box;
}

/** button with an optional glyph and a label span */
function btn(parent: HTMLElement, cls: string, label: string, icon?: UiIconName): HTMLButtonElement {
  const b = el("button", "btn " + cls, parent);
  b.type = "button";
  if (icon) img("btn-ico", b, uiIcon(icon, 64));
  el("span", "btn-label", b, label);
  return b;
}

function setLabel(b: HTMLButtonElement, text: string): void {
  const l = b.querySelector(".btn-label");
  if (l) l.textContent = text;
}

/** retrigger a one-shot CSS animation class */
function pulse(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

const QUALITY_NAMES = { low: "ต่ำ", medium: "กลาง", high: "สูง" } as const;
type Quality = keyof typeof QUALITY_NAMES;

/** guard against accidental taps right after a modal opens (ms) */
const TAP_GUARD = 320;
/** level-up: S / A double as movement keys, so they wait a little longer */
const MOVE_KEY_GUARD = 650;
/** chests close by themselves this long after the reveal (ms): AUTO mode / normal */
const CHEST_AUTO_CLOSE = 1500;
const CHEST_IDLE_CLOSE = 6000;
/** results: buttons wait for the stat count-up (250 ms delay + 900 ms) to mostly finish */
const RESULTS_GUARD = 900;

/**
 * Full-screen DOM screens: main menu (hero select, shop, settings), level-up
 * cards, treasure chest, pause, results.
 */
export class Screens {
  private layer: HTMLDivElement;
  private current: HTMLDivElement | null = null;
  private selectedHero = Meta.data.lastHero || "knight";
  private openedAt = 0;
  private timers: number[] = [];
  private rafs: number[] = [];
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  /** records before the current run started (to flag new bests) */
  private prev = { time: 0, kills: 0, level: 0 };
  /** in-play AUTO mode chip (under the HUD's pause button) */
  private autoChip: AutoChip;

  constructor(private ui: HTMLElement) {
    this.layer = el("div", "screens", ui);
    // below the modal layer: level-up / chest / pause screens cover it like the HUD
    this.autoChip = new AutoChip(ui, this.layer);
    // persisted settings that live in Meta (quality is persisted by World)
    if (Meta.data.showFps) G.debug.showFps = true;
    window.addEventListener("keydown", (e) => {
      if (this.onKey && !e.repeat) this.onKey(e);
    });
    G.events.on("runStart", () => {
      this.prev = { time: Meta.data.bestTime, kills: Meta.data.bestKills, level: Meta.data.bestLevel };
    });
    // fade out the HTML boot splash once the game owns the screen
    const splash = document.getElementById("boot");
    if (splash) {
      requestAnimationFrame(() => splash.classList.add("gone"));
      window.setTimeout(() => splash.remove(), 700);
    }
  }

  private open(cls: string): HTMLDivElement {
    this.close();
    const s = el("div", `screen ${cls} interactive`, this.layer);
    this.current = s;
    this.openedAt = performance.now();
    requestAnimationFrame(() => s.classList.add("in"));
    return s;
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t);
    for (const r of this.rafs) cancelAnimationFrame(r);
    this.timers.length = 0;
    this.rafs.length = 0;
    this.onKey = null;
    if (this.current) {
      this.current.remove();
      this.current = null;
    }
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  /** per-frame UI that lives outside the modals (AUTO chip). Called by Game every frame. */
  update(): void {
    this.autoChip.update();
  }

  /**
   * Compact "ออโต้" toggle (glyph + label + mini switch) used on the level-up
   * and pause screens. `onChange` runs after the setting flipped; taps are
   * ignored while `blocked(downAt)` returns true. Returns the button and a
   * `toggle()` for keyboard shortcuts (bypasses the tap check).
   */
  private autoToggle(
    parent: HTMLElement,
    onChange?: (on: boolean) => void,
    blocked?: (downAt: number) => boolean,
  ): { el: HTMLButtonElement; toggle: () => void } {
    const b = el("button", "lu-auto", parent);
    b.type = "button";
    img("lu-auto-ico", b, luIcon("auto", 64));
    el("span", "lu-auto-txt", b, "ออโต้");
    const sw = el("span", "lu-auto-sw", b);
    el("i", "", sw);
    const sync = () => {
      const on = Meta.data.autoPick;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", on ? "ออโต้เลือกสกิล: เปิด" : "ออโต้เลือกสกิล: ปิด");
    };
    sync();
    const toggle = () => {
      Meta.setAutoPick(!Meta.data.autoPick);
      G.audio.sfx("select");
      sync();
      onChange?.(Meta.data.autoPick);
    };
    onTap(b, (_e, downAt) => {
      if (!blocked?.(downAt)) toggle();
    });
    return { el: b, toggle };
  }

  /** true while a freshly opened modal should ignore taps */
  private guarded(): boolean {
    return !G.debug.autoplay && performance.now() - this.openedAt < TAP_GUARD;
  }

  private bankChip(parent: HTMLElement): HTMLSpanElement {
    const bank = el("div", "bank-chip", parent);
    img("chip-icon", bank, uiIcon("coin", 64));
    return el("span", "chip-val", bank, formatNum(Meta.data.gold));
  }

  private head(parent: HTMLElement, title: string, onBack?: () => void): HTMLDivElement {
    const h = el("div", "panel-head", parent);
    if (onBack) {
      const b = el("button", "btn icon-btn back", h);
      b.type = "button";
      b.setAttribute("aria-label", "กลับ");
      img("btn-ico", b, uiIcon("back", 64));
      onTap(b, () => {
        G.audio.sfx("select");
        onBack();
      });
    }
    el("h2", "panel-title", h, title);
    return h;
  }

  // ================================================================ menu
  showMenu(): void {
    const s = this.open("menu");
    if (!HEROES.some((h) => h.id === this.selectedHero)) this.selectedHero = HEROES[0].id;
    // close-up of the hero behind the menu; startRun resets zoom to 1, which
    // gives a nice pull-back when the run begins
    if (G.state === "menu") {
      G.world.zoom = 0.58;
      // Player.reset grants spawn invulnerability, which only ticks down in
      // update(); in the menu that would leave the hero blinking forever
      G.player.invuln = 0;
    }

    const top = el("div", "menu-top", s);
    const rec = el("div", "record-chip", top);
    img("chip-icon", rec, uiIcon("trophy", 64));
    const recTxt = el("div", "record-txt", rec);
    if (Meta.data.runs > 0) {
      el("b", "", recTxt, formatTime(Meta.data.bestTime));
      el("small", "", recTxt, `สังหาร ${formatNum(Meta.data.bestKills)} • Lv.${Meta.data.bestLevel || 1}`);
    } else {
      el("b", "", recTxt, "--:--");
      el("small", "", recTxt, "ยังไม่มีสถิติ");
    }
    const bankVal = this.bankChip(top);

    const logo = el("div", "logo", s);
    const h1 = el("h1", "logo-title", logo);
    h1.setAttribute("aria-label", "SURFORDIE");
    "SURFORDIE".split("").forEach((ch, i) => {
      const sp = el("span", i >= 6 ? "die" : "", h1, ch);
      sp.style.setProperty("--i", String(i));
    });
    el("div", "logo-tag", logo, `ฝ่าฝูงซอมบี้ เอาชีวิตรอดให้ครบ ${Math.round(RUN_LENGTH / 60)} นาที!`);

    el("div", "menu-spacer", s);

    const bottom = el("div", "menu-bottom", s);
    const pickBox = el("div", "hero-pick", bottom);
    el("div", "section-label", pickBox, "เลือกฮีโร่");
    const list = el("div", "hero-list", pickBox);
    const detail = el("div", "hero-detail", pickBox);
    const detailIco = el("img", "hero-detail-ico", detail);
    detailIco.alt = "";
    const detailTxt = el("span", "", detail);
    // the hero's ultimate (ไม้ตาย) under the perk line
    const ultRow = el("div", "hero-ult", pickBox);
    const ultIco = el("img", "hero-ult-ico", ultRow);
    ultIco.alt = "";
    const ultTxt = el("span", "", ultRow);
    const actions = el("div", "menu-actions", bottom);
    const play = btn(actions, "primary big play-btn", "เริ่มเกม", "play");
    const cards = new Map<string, HTMLButtonElement>();

    const locked = (h: HeroDef) => h.price > 0 && !Meta.isUnlocked(h.id);
    const refreshPlay = () => {
      const h = HEROES.find((x) => x.id === this.selectedHero) ?? HEROES[0];
      detail.style.setProperty("--accent", h.color);
      const wd = weaponById(h.startWeapon);
      if (wd) detailIco.src = iconURL("w:" + wd.id, wd.icon);
      detailIco.style.display = wd ? "" : "none";
      detailTxt.textContent = h.desc;
      const u = h.ultimate;
      ultRow.style.setProperty("--accent", u.color);
      ultIco.src = iconURL("ult:" + u.id, u.icon, 96);
      ultTxt.innerHTML = "";
      el("b", "", ultTxt, `ไม้ตาย: ${u.name}`);
      el("small", "", ultTxt, u.desc);
      if (locked(h)) {
        play.classList.add("unlock");
        setLabel(play, `ปลดล็อก ${formatNum(h.price)}`);
        play.classList.toggle("disabled", Meta.data.gold < h.price);
      } else {
        play.classList.remove("unlock", "disabled");
        setLabel(play, "เริ่มเกม");
      }
    };

    HEROES.forEach((h, idx) => {
      const card = el("button", "hero-card", list);
      card.type = "button";
      card.style.setProperty("--accent", h.color);
      card.style.animationDelay = `${0.12 + idx * 0.07}s`;
      if (h.id === this.selectedHero) card.classList.add("selected");
      if (locked(h)) card.classList.add("locked");
      const pf = el("div", "hero-portrait", card);
      img("", pf, iconURL("hero:" + h.id, h.portrait, 128));
      if (locked(h)) {
        const lk = el("div", "hero-lock", pf);
        img("", lk, uiIcon("lock", 64));
      }
      el("div", "hero-name", card, h.name);
      el("div", "hero-title", card, h.title);
      cards.set(h.id, card);
      onTap(card, () => {
        if (this.selectedHero === h.id) return;
        this.selectedHero = h.id;
        G.audio.sfx("select");
        cards.forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        pulse(detail, "swap");
        // show the chosen hero's 3D model behind the menu
        if (G.state === "menu") {
          G.player.reset(h.id);
          G.player.invuln = 0;
        }
        if (!locked(h)) {
          Meta.data.lastHero = h.id;
          Meta.save();
        }
        refreshPlay();
      });
    });
    refreshPlay();

    onTap(play, () => {
      const h = HEROES.find((x) => x.id === this.selectedHero) ?? HEROES[0];
      if (locked(h)) {
        if (Meta.unlockHero(h.id, h.price)) {
          G.audio.sfx("coin");
          bankVal.textContent = formatNum(Meta.data.gold);
          cards.get(h.id)?.classList.remove("locked");
          cards.get(h.id)?.querySelector(".hero-lock")?.remove();
          Meta.data.lastHero = h.id;
          Meta.save();
          refreshPlay();
        } else {
          G.audio.sfx("deny");
          pulse(play, "shake");
        }
        return;
      }
      Meta.data.lastHero = h.id;
      Meta.save();
      G.audio.sfx("select");
      Flow.startRun(h.id);
    });

    const row = el("div", "menu-row", actions);
    onTap(btn(row, "violet", "ร้านค้า", "bag"), () => {
      G.audio.sfx("select");
      this.showShop();
    });
    onTap(btn(row, "ghost", "ตั้งค่า", "gear"), () => {
      G.audio.sfx("select");
      this.showSettings(() => this.showMenu());
    });

    this.onKey = (e) => {
      if (e.code === "Enter" || e.code === "Space") play.click();
    };
  }

  // ================================================================ shop
  showShop(): void {
    const s = this.open("shop");
    const panel = el("div", "panel shop-panel", s);
    const head = this.head(panel, "ร้านค้าถาวร", () => this.showMenu());
    const bankVal = this.bankChip(head);
    el("div", "panel-sub", panel, "อัปเกรดถาวร มีผลกับทุกฮีโร่ในทุกรอบ");
    const grid = el("div", "shop-grid", panel);
    const updaters: (() => void)[] = [];

    const refreshAll = () => {
      bankVal.textContent = formatNum(Meta.data.gold);
      for (const u of updaters) u();
      refreshRefund();
    };

    SHOP.forEach((up: ShopUpgrade, idx) => {
      const color = up.color ?? "#ffd23f";
      const card = el("div", "shop-card", grid);
      card.style.setProperty("--accent", color);
      card.style.animationDelay = `${0.03 * idx}s`;
      img("shop-icon", card, luShopIcon(up.id, color, 96) ?? shopIcon(up.id, color, 96));
      const main = el("div", "shop-main", card);
      const name = el("div", "shop-name", main, up.name);
      const pips = el("div", "pips", name);
      const pipEls: HTMLElement[] = [];
      for (let k = 0; k < up.maxLevel; k++) pipEls.push(el("i", "", pips));
      el("div", "shop-desc", main, up.desc);
      const eff = el("div", "shop-effect", main);
      const buy = el("button", "shop-buy", card);
      buy.type = "button";
      const buyIco = img("btn-ico", buy, uiIcon("coin", 64));
      const buyTxt = el("span", "", buy);

      const update = () => {
        const lvl = Meta.level(up.id);
        const maxed = lvl >= up.maxLevel;
        const price = maxed ? 0 : up.price(lvl + 1);
        pipEls.forEach((p, k) => p.classList.toggle("on", k < lvl));
        card.classList.toggle("maxed", maxed);
        card.classList.toggle("poor", !maxed && Meta.data.gold < price);
        buyIco.style.display = maxed ? "none" : "";
        buyTxt.textContent = maxed ? "สูงสุด" : formatNum(price);
        if (up.effect) {
          eff.textContent = "";
          if (lvl > 0) el("span", "now", eff, up.effect(lvl));
          if (!maxed) {
            if (lvl > 0) el("span", "arrow", eff, "▸");
            el("span", "next", eff, up.effect(lvl + 1));
          }
        }
      };
      updaters.push(update);
      update();

      onTap(buy, () => {
        if (Meta.buy(up.id)) {
          G.audio.sfx("coin");
          refreshAll();
          pulse(card, "bought");
          pulse(bankVal.parentElement as HTMLElement, "bump");
        } else {
          G.audio.sfx("deny");
          pulse(card, "shake");
        }
      });
    });

    const foot = el("div", "shop-foot", panel);
    const refund = btn(foot, "ghost small", "");
    let confirmT = 0;
    const refreshRefund = () => {
      const spent = Meta.spent();
      refund.classList.toggle("disabled", spent === 0);
      setLabel(refund, confirmT ? `แตะอีกครั้งเพื่อคืน ${formatNum(spent)} ทอง` : `คืนทองทั้งหมด (+${formatNum(spent)})`);
    };
    onTap(refund, () => {
      if (Meta.spent() === 0) return;
      if (!confirmT) {
        confirmT = window.setTimeout(() => {
          confirmT = 0;
          refreshRefund();
        }, 2500);
        this.timers.push(confirmT);
        refreshRefund();
        return;
      }
      clearTimeout(confirmT);
      confirmT = 0;
      Meta.refund();
      G.audio.sfx("coin");
      refreshAll();
    });
    refreshRefund();
    this.onKey = (e) => {
      if (e.code === "Escape") this.showMenu();
    };
  }

  // ================================================================ settings
  showSettings(onBack: () => void): void {
    const s = this.open("settings");
    const panel = el("div", "panel settings-panel", s);
    this.head(panel, "ตั้งค่า", onBack);
    const body = el("div", "set-list", panel);

    /** settings row; `icon` is a UI glyph name or a ready image URL */
    const row = (label: string, icon: UiIconName | { src: string }) => {
      const r = el("div", "set-row", body);
      const l = el("div", "set-label", r);
      img("set-ico", l, typeof icon === "string" ? uiIcon(icon, 64) : icon.src);
      el("span", "", l, label);
      return r;
    };

    const sw = (parent: HTMLElement, get: () => boolean, set: (v: boolean) => void) => {
      const b = el("button", "switch", parent);
      b.type = "button";
      el("i", "", b);
      const sync = () => {
        b.classList.toggle("on", get());
        b.setAttribute("aria-pressed", String(get()));
      };
      onTap(b, () => {
        set(!get());
        sync();
        G.audio.sfx("select");
      });
      sync();
      return b;
    };

    const slider = (
      parent: HTMLElement,
      get: () => number,
      set: (v: number) => void,
      commit: () => void,
      fmt: (v: number) => string = (v) => `${Math.round(v * 100)}%`,
    ) => {
      const wrap = el("div", "slider", parent);
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "slider");
      const track = el("div", "slider-track", wrap);
      const fill = el("div", "slider-fill", track);
      const knob = el("div", "slider-knob", track);
      const val = el("span", "slider-val", parent);
      const sync = () => {
        const v = get();
        fill.style.transform = `scaleX(${v})`;
        knob.style.left = `${v * 100}%`;
        val.textContent = fmt(v);
        wrap.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      };
      const fromX = (x: number) => {
        const r = track.getBoundingClientRect();
        const v = Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width)));
        set(Math.round(v * 20) / 20);
        sync();
      };
      let dragId: number | null = null;
      wrap.addEventListener("pointerdown", (e) => {
        dragId = e.pointerId;
        try {
          wrap.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        wrap.classList.add("drag");
        fromX(e.clientX);
      });
      wrap.addEventListener("pointermove", (e) => {
        if (e.pointerId === dragId) fromX(e.clientX);
      });
      const end = (e: PointerEvent) => {
        if (e.pointerId !== dragId) return;
        dragId = null;
        wrap.classList.remove("drag");
        commit();
      };
      wrap.addEventListener("pointerup", end);
      wrap.addEventListener("pointercancel", end);
      wrap.addEventListener("keydown", (e) => {
        if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
          set(Math.max(0, Math.min(1, get() + (e.code === "ArrowLeft" ? -0.05 : 0.05))));
          sync();
          commit();
          e.preventDefault();
        }
      });
      sync();
      return wrap;
    };

    const audioRows: HTMLElement[] = [];
    const syncMute = () => audioRows.forEach((r) => r.classList.toggle("dim", Meta.data.muted));

    sw(
      row("เสียง", "speaker"),
      () => !Meta.data.muted,
      (v) => {
        Meta.data.muted = !v;
        Meta.save();
        G.audio.applySettings();
        syncMute();
      },
    );
    const musicRow = row("เพลง", "music");
    slider(
      musicRow,
      () => Meta.data.musicVol,
      (v) => {
        Meta.data.musicVol = v;
        G.audio.applySettings();
      },
      () => Meta.save(),
    );
    const sfxRow = row("เอฟเฟกต์เสียง", "speaker");
    slider(
      sfxRow,
      () => Meta.data.sfxVol,
      (v) => {
        Meta.data.sfxVol = v;
        G.audio.applySettings();
      },
      () => {
        Meta.save();
        G.audio.sfx("coin");
      },
    );
    audioRows.push(musicRow, sfxRow);
    syncMute();

    const q = el("div", "seg", row("กราฟิก", "star"));
    const segBtns: HTMLButtonElement[] = [];
    // anti-aliasing (MSAA) is fixed when the WebGL context is created: the
    // resolution cap changes at once, AA only after the game is reopened
    const aaNow = G.world.renderer.getContextAttributes()?.antialias ?? G.world.quality !== "low";
    const syncQuality = () => {
      const k = G.world.quality;
      segBtns.forEach((x) => x.classList.toggle("on", x.dataset.q === k));
      const pending = (k !== "low") !== aaNow;
      note.classList.toggle("warn", pending);
      note.textContent = pending ? "การลบรอยหยักของภาพจะมีผลหลังเปิดเกมใหม่" : "คุณภาพ \"ต่ำ\" ช่วยให้ลื่นขึ้นบนมือถือรุ่นเก่า";
    };
    (["low", "medium", "high"] as Quality[]).forEach((k) => {
      const b = el("button", "seg-btn", q, QUALITY_NAMES[k]);
      b.type = "button";
      b.dataset.q = k;
      segBtns.push(b);
      onTap(b, () => {
        G.world.setQuality(k);
        G.audio.sfx("select");
        syncQuality();
      });
    });

    // screen shake 0..150% (slider 0..1 maps to 0..1.5); read by Fx.shake()
    const SHAKE_MAX = 1.5;
    slider(
      row("จอสั่น", "shake"),
      () => Math.max(0, Math.min(1, G.fx.shakeScale / SHAKE_MAX)),
      (v) => {
        G.fx.shakeScale = Math.round(v * SHAKE_MAX * 100) / 100;
      },
      () => {
        try {
          localStorage.setItem("sfd.shake", String(G.fx.shakeScale));
        } catch {
          /* storage unavailable */
        }
        // preview the new strength (world shake ticks even while paused/menu)
        G.fx.shake(0.35);
      },
      (v) => (v <= 0 ? "ปิด" : `${Math.round(v * SHAKE_MAX * 100)}%`),
    );

    sw(
      row("แสดง FPS", "gauge"),
      () => G.debug.showFps,
      (v) => {
        G.debug.showFps = v;
        Meta.data.showFps = v;
        Meta.save();
      },
    );

    // level-up: decision timer (10 s / unlimited) and AUTO mode
    const ts = el("div", "seg", row("เวลาเลือกสกิล", "hourglass"));
    const tBtns: HTMLButtonElement[] = [];
    const syncTimer = () => tBtns.forEach((x) => x.classList.toggle("on", (Number(x.dataset.t) > 0) === Meta.pickSeconds() > 0));
    ([
      [PICK_TIMER_DEFAULT, `${PICK_TIMER_DEFAULT} วินาที`],
      [0, "ไม่จำกัด"],
    ] as const).forEach(([t, label]) => {
      const b = el("button", "seg-btn", ts, label);
      b.type = "button";
      b.dataset.t = String(t);
      tBtns.push(b);
      onTap(b, () => {
        Meta.data.pickTimer = t;
        Meta.save();
        G.audio.sfx("select");
        syncTimer();
      });
    });
    syncTimer();
    sw(
      row("ออโต้เลือกสกิล", { src: luIcon("auto", 64) }),
      () => Meta.data.autoPick,
      (v) => Meta.setAutoPick(v),
    );

    const note = el("div", "set-note", panel);
    note.setAttribute("aria-live", "polite");
    syncQuality();
    onTap(btn(panel, "primary", "ตกลง"), () => {
      G.audio.sfx("select");
      onBack();
    });
  }

  // ================================================================ level up
  /**
   * Level-up cards. The recommended card (weapons/recommend.ts) carries a
   * "แนะนำ" badge; a decision timer (Meta.pickSeconds(), 0 = unlimited) starts
   * after the tap guard and picks the recommendation when it runs out.
   * Reroll / skip / banish spend per-run charges (G.weapons.charges); the AUTO
   * toggle takes the recommendation now and lets Game resolve later levels.
   * `onSkip` is called instead of `onPick` for a skipped level (no skip button
   * without it).
   */
  showLevelUp(choices: Choice[], onPick: (c: Choice) => void, onSkip?: () => void): void {
    const s = this.open("levelup");
    const ws = G.weapons;
    el("div", "burst-rays", s);
    const head = el("div", "lu-head", s);
    const title = el("div", "lu-title", head);
    el("span", "", title, "เลเวลอัป!");
    el("div", "lu-level", head, `Lv.${G.player.level}`);
    const SUB = "เลือกพลัง 1 อย่าง";
    const sub = el("div", "lu-sub", s, SUB);

    // ---- decision timer + AUTO toggle
    const total = Meta.pickSeconds();
    const bar = el("div", "lu-bar", s);
    const timer = el("div", "lu-timer" + (total > 0 ? "" : " off"), bar);
    img("lu-timer-ico", timer, uiIcon("hourglass", 64));
    const track = el("div", "lu-timer-track", timer);
    const fill = el("div", "lu-timer-fill", track);
    el("span", "lu-timer-cap", track, total > 0 ? "เลือกให้อัตโนมัติใน" : "ไม่จำกัดเวลา");
    const secEl = el("b", "lu-timer-sec", timer, total > 0 ? String(total) : "∞");
    const autoCtl = this.autoToggle(
      bar,
      (on) => {
        // AUTO on: take the recommendation now; Game resolves the remaining levels
        if (!on) return;
        if (busy) this.later(320, () => pick(rec, true));
        else pick(rec, true);
      },
      (downAt) => picked || !tapOk(downAt),
    );
    el("span", "lu-key", autoCtl.el, "A");

    const list = el("div", "card-list", s);
    const foot = el("div", "lu-actions", s);

    let cur = choices.slice();
    let rec = -1;
    let cardEls: HTMLButtonElement[] = [];
    let picked = false;
    /** a banished card is animating out: no picks until its replacement is in */
    let busy = false;
    let banishing = false;

    // a press must start after the guard window (stops a held joystick finger
    // or a double tap from instantly choosing a card). Pointer taps carry the
    // time of their own press; keyboard / programmatic clicks fall back to the
    // last press anywhere on the screen.
    let armedAt = Infinity;
    s.addEventListener("pointerdown", () => {
      armedAt = this.guarded() ? Infinity : performance.now();
    });
    const armed = (downAt: number) => (downAt >= 0 ? downAt - this.openedAt >= TAP_GUARD : armedAt !== Infinity);
    const tapOk = (downAt: number) => G.debug.autoplay || (!this.guarded() && armed(downAt));

    const buildCard = (c: Choice, idx: number, delay: number): HTMLButtonElement => {
      const card = el("button", "card");
      card.type = "button";
      card.dataset.kind = c.kind;
      card.style.setProperty("--accent", c.color);
      card.style.animationDelay = `${delay}s`;
      if (c.kind === "evolve") {
        card.classList.add("evo");
        el("i", "shine", card);
      }
      const ic = framedIcon(card, "card-icon", c.icon);
      const badge = c.isNew ? "ใหม่!" : c.kind === "evolve" ? "วิวัฒน์!" : "";
      if (badge) el("span", "card-badge" + (c.isNew ? " new" : " evo"), ic, badge);

      const body = el("div", "card-body", card);
      const top = el("div", "card-head", body);
      el("span", "card-name", top, c.name);
      const kindTxt = c.kind === "weapon" ? "อาวุธ" : c.kind === "passive" ? "ไอเท็ม" : c.kind === "evolve" ? "วิวัฒนาการ" : "พิเศษ";
      el("span", "card-kind", top, kindTxt);

      const max = c.kind === "weapon" ? weaponById(c.id)?.maxLevel ?? 0 : c.kind === "passive" ? passiveById(c.id)?.maxLevel ?? 0 : 0;
      if (max > 0) {
        const pr = el("div", "card-progress", body);
        el("span", "card-lv", pr, c.isNew ? "Lv.1" : `Lv.${c.level - 1} ▸ ${c.level}`);
        const pips = el("div", "pips", pr);
        for (let k = 0; k < max; k++) el("i", k < c.level - 1 ? "on" : k === c.level - 1 ? "on next" : "", pips);
      }
      el("div", "card-desc", body, c.desc);
      if (!c.isNew && c.kind !== "evolve" && c.lines.length) {
        const ls = el("div", "card-lines", body);
        for (const ln of c.lines.slice(0, 3)) {
          const [lbl, val] = splitStatLine(ln);
          const d = el("span", "card-line", ls);
          el("span", "lbl", d, lbl);
          if (val) el("b", "", d, " " + val);
        }
      }
      // recommendation ribbon (shown by CSS on the .rec card only)
      const rb = el("span", "card-rec", card);
      img("", rb, uiIcon("star", 64));
      el("span", "", rb, "แนะนำ");
      // banish-mode overlay
      const bx = el("span", "card-ban", card);
      img("", bx, luIcon("banish", 64));
      el("span", "card-key", card, String(idx + 1));

      // onTap: a second finger works while the joystick thumb is still down
      onTap(card, (_e, downAt) => {
        if (picked || busy || !tapOk(downAt)) return;
        const i = cardEls.indexOf(card);
        if (i < 0) return;
        if (banishing) doBanish(i);
        else pick(i);
      });
      return card;
    };

    const markRec = () => {
      rec = recommend(cur);
      cardEls.forEach((card, i) => card.classList.toggle("rec", i === rec));
    };

    const renderAll = (delay0: number) => {
      list.textContent = "";
      list.classList.toggle("four", cur.length >= 4);
      cardEls = cur.map((c, i) => {
        const card = buildCard(c, i, delay0 + i * 0.075);
        list.appendChild(card);
        return card;
      });
      markRec();
    };

    // ---- reroll / skip / banish (charges per run, shown on the buttons)
    const acts: Partial<Record<LevelUpAction, { b: HTMLButtonElement; n: HTMLElement; label: HTMLElement; cap: HTMLElement }>> = {};
    const action = (a: LevelUpAction, label: string, cap: string, fn: () => void) => {
      const b = el("button", "lu-act " + a, foot);
      b.type = "button";
      img("lu-act-ico", b, luIcon(a as LevelUpGlyph, 64));
      const t = el("span", "lu-act-txt", b);
      const l = el("b", "lu-act-label", t, label);
      const c = el("small", "lu-act-cap", t, cap);
      const n = el("span", "lu-act-n", b);
      el("span", "lu-key", b, a === "reroll" ? "R" : a === "skip" ? "S" : "B");
      acts[a] = { b, n, label: l, cap: c };
      onTap(b, (_e, downAt) => {
        if (picked || busy || !tapOk(downAt)) return;
        fn();
      });
    };
    const deny = (a: LevelUpAction) => {
      G.audio.sfx("deny");
      const r = acts[a];
      if (r) pulse(r.b, "shake");
    };
    const syncActs = () => {
      for (const a of ["reroll", "skip", "banish"] as const) {
        const r = acts[a];
        if (!r) continue;
        const n = ws.charges[a];
        r.n.textContent = String(n);
        r.b.classList.toggle("empty", n <= 0 && !(a === "banish" && banishing));
        r.b.setAttribute("aria-label", `${r.label.textContent} (เหลือ ${n} ครั้ง)`);
      }
    };

    const setBanish = (on: boolean) => {
      banishing = on;
      s.classList.toggle("banishing", on);
      cardEls.forEach((card, i) => card.classList.toggle("no-banish", on && !ws.canBanish(cur[i])));
      if (!picked) sub.textContent = on ? "แตะการ์ดที่จะตัดทิ้ง (ไม่ออกอีกในรอบนี้)" : SUB;
      const r = acts.banish;
      if (r) {
        r.b.classList.toggle("armed", on);
        r.label.textContent = on ? "ยกเลิก" : "ตัดทิ้ง";
        r.cap.textContent = on ? "แตะการ์ด" : "ไม่ออกอีก";
      }
      syncActs();
    };

    // ---- decision timer (accumulated, clamped dt: a hidden tab does not burn it)
    let left = total;
    let lastSec = -1;
    const resetTimer = () => {
      if (total <= 0) return;
      left = total;
      lastSec = -1;
      pulse(timer, "refill");
    };

    const pick = (i: number, auto = false) => {
      if (picked || i < 0 || i >= cur.length) return;
      if (banishing) setBanish(false);
      picked = true;
      s.classList.add("picked");
      if (auto) {
        s.classList.add("auto-picked");
        sub.textContent = Meta.data.autoPick ? "ออโต้: เลือกการ์ดแนะนำให้" : "หมดเวลา! เลือกการ์ดแนะนำให้";
      }
      cardEls[i].classList.add("chosen");
      G.audio.sfx("select");
      const c = cur[i];
      // an automatic pick lingers a moment so the player sees what was taken
      this.later(auto ? 420 : 150, () => onPick(c));
    };

    const reroll = () => {
      if (!ws.useCharge("reroll")) return deny("reroll");
      if (banishing) setBanish(false);
      G.audio.sfx("whoosh");
      cur = ws.rollChoices(choices.length, { avoid: cur.map(choiceKey) });
      renderAll(0);
      resetTimer();
      syncActs();
    };

    const skip = () => {
      if (!onSkip) return;
      if (!ws.useCharge("skip")) return deny("skip");
      if (banishing) setBanish(false);
      picked = true;
      s.classList.add("picked", "skipped");
      sub.textContent = `ข้าม! รับ ${formatNum(ws.skipGold())} ทอง`;
      G.audio.sfx("coin");
      syncActs();
      this.later(220, () => onSkip());
    };

    const toggleBanish = () => {
      if (banishing) {
        setBanish(false);
        G.audio.sfx("select");
        return;
      }
      if (ws.charges.banish <= 0 || !cur.some((c) => ws.canBanish(c))) return deny("banish");
      G.audio.sfx("select");
      setBanish(true);
    };

    const doBanish = (i: number) => {
      const c = cur[i];
      const card = cardEls[i];
      if (!ws.canBanish(c)) {
        G.audio.sfx("deny");
        pulse(card, "shake");
        return;
      }
      if (!ws.useCharge("banish")) {
        setBanish(false);
        return deny("banish");
      }
      ws.banish(c);
      setBanish(false);
      busy = true;
      card.classList.add("banished");
      G.audio.sfx("whoosh");
      this.later(300, () => {
        busy = false;
        // re-roll just this slot, never repeating a card still on screen
        const others = cur.filter((_, k) => k !== i).map(choiceKey);
        const rep = ws.rollChoices(1, { exclude: others, anyKind: true })[0];
        if (rep) {
          cur[i] = rep;
          const nc = buildCard(rep, i, 0);
          nc.classList.add("swap-in");
          card.replaceWith(nc);
          cardEls[i] = nc;
        } else {
          cur.splice(i, 1);
          cardEls.splice(i, 1);
          card.remove();
          cardEls.forEach((ce, k) => {
            const key = ce.querySelector(".card-key");
            if (key) key.textContent = String(k + 1);
          });
          list.classList.toggle("four", cur.length >= 4);
        }
        markRec();
        resetTimer();
      });
    };

    action("reroll", "สุ่มใหม่", "การ์ดชุดใหม่", reroll);
    if (onSkip) action("skip", "ข้าม", `+${formatNum(ws.skipGold())} ทอง`, skip);
    action("banish", "ตัดทิ้ง", "ไม่ออกอีก", toggleBanish);
    renderAll(0.1);
    syncActs();

    if (total > 0) {
      const slot = this.rafs.length;
      this.rafs.push(0);
      let lastT = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.25, Math.max(0, (now - lastT) / 1000));
        lastT = now;
        if (picked) return;
        if (!busy && now - this.openedAt >= TAP_GUARD) left -= dt;
        fill.style.transform = `scaleX(${Math.max(0, left / total).toFixed(4)})`;
        const sec = Math.max(0, Math.ceil(left));
        if (sec !== lastSec) {
          const first = lastSec < 0;
          lastSec = sec;
          secEl.textContent = String(sec);
          const hurry = sec <= 3;
          timer.classList.toggle("hurry", hurry);
          // soft tick for the last three seconds
          if (hurry && sec > 0 && !first) G.audio.sfx("select", { vol: 0.35, pitch: 1.35 + (3 - sec) * 0.15 });
        }
        if (left <= 0) {
          pick(rec, true);
          return;
        }
        this.rafs[slot] = requestAnimationFrame(tick);
      };
      this.rafs[slot] = requestAnimationFrame(tick);
    }

    this.onKey = (e) => {
      if (picked) return;
      const since = performance.now() - this.openedAt;
      if (since < TAP_GUARD) return;
      const n = e.code.startsWith("Digit") ? parseInt(e.code.slice(5), 10) : e.code.startsWith("Numpad") ? parseInt(e.code.slice(6), 10) : NaN;
      if (n >= 1 && n <= cur.length) {
        if (busy) return;
        if (banishing) doBanish(n - 1);
        else pick(n - 1);
        return;
      }
      if (busy) return;
      switch (e.code) {
        case "KeyR":
          reroll();
          break;
        case "KeyB":
          toggleBanish();
          break;
        case "Escape":
          if (banishing) setBanish(false);
          break;
        // S / A are also movement keys: a key still being pressed for walking
        // when the screen opened must not skip or toggle AUTO
        case "KeyS":
          if (since >= MOVE_KEY_GUARD) skip();
          break;
        case "KeyA":
          if (since >= MOVE_KEY_GUARD) autoCtl.toggle();
          break;
      }
    };
  }

  // ================================================================ chest
  openChest(): void {
    if (G.state !== "playing") return;
    G.state = "chest";
    G.input.release();
    const rewards = G.weapons.openChest();
    const hasEvo = rewards.some((r) => r.kind === "evolve");
    const s = this.open("chest" + (hasEvo ? " has-evo" : ""));
    const title = el("div", "chest-title", s, "หีบสมบัติ!");

    const stage = el("div", "chest-stage", s);
    el("div", "chest-rays", stage);
    el("div", "chest-glow", stage);
    const box = el("div", "chest-box", stage);
    const chestImg = img("chest-img", box, uiIcon("chest", 192));
    const sparks = el("div", "chest-sparks", stage);
    for (let k = 0; k < 16; k++) {
      const sp = el("i", "", sparks);
      const a = (k / 16) * Math.PI * 2 + Math.random() * 0.3;
      const d = 90 + Math.random() * 80;
      sp.style.setProperty("--dx", `${(Math.cos(a) * d).toFixed(0)}px`);
      sp.style.setProperty("--dy", `${(Math.sin(a) * d * 0.8 - 20).toFixed(0)}px`);
      sp.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
    }
    el("div", "chest-flash", s);

    const list = el("div", "chest-rewards", s);
    const cards = rewards.map((c) => {
      const card = el("div", "reward-card" + (c.kind === "evolve" ? " evo" : ""), list);
      card.style.setProperty("--accent", c.color);
      if (c.kind === "evolve") el("i", "shine", card);
      framedIcon(card, "card-icon", c.icon);
      const body = el("div", "card-body", card);
      if (c.kind === "evolve") el("div", "reward-ribbon", body, "วิวัฒนาการ!");
      const head = el("div", "card-head", body);
      el("span", "card-name", head, c.name);
      if (c.kind === "weapon" || c.kind === "passive") el("span", "card-lv", head, c.isNew ? "ใหม่!" : `Lv.${c.level}`);
      const line = c.kind === "evolve" ? c.desc : c.lines[0] ?? c.desc;
      el("div", "card-desc", body, line);
      return card;
    });

    const hint = el("div", "chest-hint", s, "แตะเพื่อข้าม");
    const ok = btn(s, "primary big chest-ok", "รับรางวัล");

    let done = false;
    let doneAt = 0;
    let burst = false;
    let revealed = 0;
    const doBurst = () => {
      if (burst) return;
      burst = true;
      s.classList.add("burst");
      chestImg.src = uiIcon("chestOpen", 192);
      title.textContent = hasEvo ? "วิวัฒนาการ!" : "ได้รับรางวัล!";
      G.audio.sfx(hasEvo ? "levelup" : "coin");
      G.world.shake(0.25);
    };
    const reveal = (i: number) => {
      if (i < revealed) return;
      revealed = i + 1;
      cards[i]?.classList.add("show");
      G.audio.sfx(rewards[i]?.kind === "evolve" ? "levelup" : "xp", { pitch: 1 + i * 0.12 });
    };
    const finish = () => {
      if (done) return;
      doBurst();
      for (let i = revealed; i < cards.length; i++) cards[i].classList.add("show", "instant");
      revealed = cards.length;
      done = true;
      doneAt = performance.now();
      s.classList.add("done");
      hint.textContent = "";
      startAutoClose();
    };

    // the chest closes by itself after the reveal: quickly in AUTO mode, after
    // a gentle countdown otherwise (shown on the button). Clamped dt: a hidden
    // tab does not burn the countdown.
    const startAutoClose = () => {
      const auto = Meta.data.autoPick;
      const total = (auto ? CHEST_AUTO_CLOSE : CHEST_IDLE_CLOSE) / 1000;
      let left = total;
      let lastSec = -1;
      ok.classList.add("counting");
      const bar = el("i", "chest-count-bar", ok);
      const cnt = el("span", "chest-count", ok);
      hint.classList.add("auto-close");
      const slot = this.rafs.length;
      this.rafs.push(0);
      let lastT = performance.now();
      const tick = (now: number) => {
        if (closed) return;
        left -= Math.min(0.25, Math.max(0, (now - lastT) / 1000));
        lastT = now;
        if (left <= 0) {
          collect(true);
          return;
        }
        bar.style.transform = `scaleX(${(left / total).toFixed(4)})`;
        const sec = Math.ceil(left);
        if (sec !== lastSec) {
          lastSec = sec;
          cnt.textContent = String(sec);
          hint.textContent = `${auto ? "ออโต้ • " : ""}ปิดเองใน ${sec} วิ`;
        }
        this.rafs[slot] = requestAnimationFrame(tick);
      };
      this.rafs[slot] = requestAnimationFrame(tick);
    };

    // timeline: drop → shake → burst → reveal one by one → button
    s.classList.add("shaking");
    this.later(1000, doBurst);
    rewards.forEach((_, i) => this.later(1300 + i * 380, () => reveal(i)));
    this.later(1300 + rewards.length * 380 + 150, finish);

    // tap anywhere to skip the reveal (multi-touch safe, see onTap)
    onTap(s, (e) => {
      if (e.target instanceof Element && e.target.closest(".chest-ok")) return;
      if (!done && !this.guarded()) finish();
    });
    let closed = false;
    const collect = (auto = false) => {
      if (closed) return;
      if (!done) {
        // the button is not tappable before the reveal ends (CSS); Enter /
        // Space skip the reveal but respect the open guard like a tap does
        if (!this.guarded()) finish();
        return;
      }
      if (!auto && !G.debug.autoplay && performance.now() - doneAt < 250) return;
      closed = true;
      G.audio.sfx("select");
      this.close();
      Flow.resume();
    };
    onTap(ok, () => collect());
    this.onKey = (e) => {
      if (e.code === "Enter" || e.code === "Space") collect();
    };
  }

  // ================================================================ pause
  togglePause(): void {
    if (G.state === "playing") Flow.pause();
    else if (G.state === "paused") {
      this.close();
      Flow.resume();
    }
  }

  showPause(): void {
    const s = this.open("pause");
    const panel = el("div", "panel pause-panel", s);
    this.autoToggle(this.head(panel, "หยุดชั่วคราว"));

    const stats = el("div", "pause-stats", panel);
    const stat = (icon: UiIconName, v: string) => {
      const d = el("div", "mini-stat", stats);
      img("chip-icon", d, uiIcon(icon, 64));
      el("b", "", d, v);
    };
    stat("hourglass", formatTime(G.time));
    stat("skull", formatNum(G.stats.kills));
    stat("star", `Lv.${G.player.level}`);
    stat("coin", formatNum(G.stats.gold));

    const section = (title: string, count: number, max: number, cls: string) => {
      const t = el("div", "sec-title " + cls, panel);
      el("span", "", t, title);
      el("small", "", t, `${count}/${max}`);
      return el("div", "owned-grid " + cls, panel);
    };
    const item = (grid: HTMLElement, icon: string, name: string, level: number, max: number, color: string, evolved: boolean) => {
      const it = el("div", "owned" + (evolved ? " evolved" : level >= max ? " max" : ""), grid);
      it.style.setProperty("--accent", color);
      img("owned-icon", it, icon);
      const b = el("div", "owned-body", it);
      el("div", "owned-name", b, name);
      const pips = el("div", "pips", b);
      for (let k = 0; k < max; k++) el("i", k < level ? "on" : "", pips);
    };

    const ws = G.weapons.weapons;
    const wg = section("อาวุธ", ws.length, G.weapons.maxWeapons, "sec-w");
    for (const w of ws) {
      const ev = w.evolved && w.def.evolution;
      const icon = iconURL((w.evolved ? "e:" : "w:") + w.def.id, (ev && ev.icon) || w.def.icon);
      item(wg, icon, ev ? ev.name : w.def.name, w.level, w.def.maxLevel, w.def.color, w.evolved);
    }
    if (!ws.length) el("div", "owned-empty", wg, "ยังไม่มีอาวุธ");

    const pg = section("ไอเท็มเสริม", G.weapons.passives.size, G.weapons.maxPassives, "sec-p");
    G.weapons.passives.forEach((lvl, id) => {
      const d = passiveById(id);
      if (d) item(pg, iconURL("p:" + id, d.icon), d.name, lvl, d.maxLevel, d.color, false);
    });
    if (!G.weapons.passives.size) el("div", "owned-empty", pg, "ยังไม่มีไอเท็ม");

    const actions = el("div", "pause-actions", panel);
    onTap(btn(actions, "primary big", "เล่นต่อ", "play"), () => {
      G.audio.sfx("select");
      this.togglePause();
    });
    const row = el("div", "btn-row", actions);
    onTap(btn(row, "ghost", "ตั้งค่า", "gear"), () => {
      G.audio.sfx("select");
      this.showSettings(() => this.showPause());
    });
    const quit = btn(row, "danger", "ออกไปเมนู", "home");
    let armed = false;
    onTap(quit, () => {
      if (!armed) {
        armed = true;
        quit.classList.add("confirm");
        setLabel(quit, "แตะอีกครั้ง");
        this.later(2500, () => {
          armed = false;
          quit.classList.remove("confirm");
          setLabel(quit, "ออกไปเมนู");
        });
        return;
      }
      G.audio.sfx("select");
      Flow.toMenu();
    });
  }

  // ================================================================ results
  showResults(victory: boolean, goldEarned: number): void {
    // lifetime records kept by the UI (Game already saved gold / best time / kills)
    const md = Meta.data;
    md.bestLevel = Math.max(md.bestLevel, G.player.level);
    md.totalKills += G.stats.kills;
    if (victory) md.wins++;
    Meta.save();

    const s = this.open("results " + (victory ? "win" : "lose"));
    el("div", victory ? "burst-rays" : "lose-vignette", s);
    if (victory) {
      const conf = el("div", "confetti", s);
      const colors = ["#ffd23f", "#ff3d9a", "#3de0ff", "#9dff3a", "#c46bff"];
      for (let k = 0; k < 28; k++) {
        const c = el("i", "", conf);
        c.style.left = `${Math.random() * 100}%`;
        c.style.background = colors[k % colors.length];
        c.style.animationDelay = `${(Math.random() * 1.6).toFixed(2)}s`;
        c.style.animationDuration = `${(2.4 + Math.random() * 1.6).toFixed(2)}s`;
        c.style.setProperty("--r", `${Math.floor(Math.random() * 720 - 360)}deg`);
      }
    }
    const panel = el("div", "panel results-panel", s);
    const head = el("div", "res-head", panel);
    el("div", "res-title", head, victory ? "รอดชีวิต!" : "พ่ายแพ้!");
    const sub = el("div", "res-sub", head);
    const hero = G.player.hero;
    img("res-hero", sub, iconURL("hero:" + hero.id, hero.portrait, 128));
    el("span", "", sub, victory ? `${hero.name} ฝ่าฝูงซอมบี้ได้สำเร็จ` : `${hero.name} ถูกฝูงซอมบี้รุมจนล้ม`);

    const grid = el("div", "res-stats", panel);
    const counters: { el: HTMLElement; to: number; fmt: (v: number) => string }[] = [];
    const stat = (icon: UiIconName, label: string, to: number, fmt: (v: number) => string, record: boolean) => {
      const r = el("div", "res-stat", grid);
      img("res-ico", r, uiIcon(icon, 64));
      const v = el("b", "res-val", r, fmt(0));
      el("span", "res-lbl", r, label);
      if (record) el("span", "res-record", r, "สถิติใหม่!");
      counters.push({ el: v, to, fmt });
    };
    const runs = md.runs;
    stat("hourglass", "เวลารอด", G.time, (v) => formatTime(v), runs > 1 && G.time > this.prev.time);
    stat("skull", "สังหาร", G.stats.kills, (v) => formatNum(v), runs > 1 && G.stats.kills > this.prev.kills);
    stat("star", "เลเวล", G.player.level, (v) => String(Math.round(v)), runs > 1 && G.player.level > this.prev.level);
    stat("coin", "ทองที่ได้", goldEarned, (v) => `+${formatNum(v)}`, false);

    // count-up animation
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0 - 250) / 900);
      const e = k <= 0 ? 0 : 1 - Math.pow(1 - k, 3);
      for (const c of counters) c.el.textContent = c.fmt(c.to * e);
      if (k < 1) this.rafs.push(requestAnimationFrame(tick));
    };
    this.rafs.push(requestAnimationFrame(tick));

    const ultOf = (id: string) => HEROES.find((h) => h.ultimate.id === id)?.ultimate;
    const entries = Object.entries(G.stats.damageBy)
      .filter(([id]) => weaponById(id) || ultOf(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    if (entries.length) {
      const t = el("div", "sec-title", panel);
      el("span", "", t, "ดาเมจของแต่ละอาวุธ");
      const dmg = el("div", "res-dmg", panel);
      const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
      const top = entries[0][1] || 1;
      entries.forEach(([id, v], i) => {
        const d = weaponById(id);
        const u = d ? undefined : ultOf(id);
        const w = G.weapons.get(id);
        const ev = d && w?.evolved && d.evolution;
        const row = el("div", "dmg-row", dmg);
        row.style.setProperty("--accent", d ? d.color : u!.color);
        row.style.animationDelay = `${0.35 + i * 0.08}s`;
        if (d) img("dmg-ico", row, iconURL((ev ? "e:" : "w:") + id, (ev && ev.icon) || d.icon));
        else img("dmg-ico", row, iconURL("ult:" + id, u!.icon, 96));
        const mid = el("div", "dmg-mid", row);
        const nm = el("div", "dmg-name", mid);
        el("span", "", nm, d ? (ev ? ev.name : d.name) : `ไม้ตาย: ${u!.name}`);
        el("small", "", nm, `${Math.round((v / total) * 100)}%`);
        const bar = el("div", "dmg-bar", mid);
        const fill = el("div", "dmg-fill", bar);
        fill.style.transform = `scaleX(${(v / top).toFixed(3)})`;
        fill.style.animationDelay = `${0.45 + i * 0.08}s`;
        el("b", "dmg-val", row, formatNum(v));
      });
    }

    const bank = el("div", "res-bank", panel);
    el("span", "", bank, "ทองสะสม");
    img("chip-icon", bank, uiIcon("coin", 64));
    el("b", "", bank, formatNum(md.gold));

    const actions = el("div", "res-actions", panel);
    // a panic tap right after death must not skip the results: the buttons
    // wake up once the count-up has mostly played (CSS fades them in)
    const resultsGuard = () => !G.debug.autoplay && performance.now() - this.openedAt < RESULTS_GUARD;
    this.later(RESULTS_GUARD, () => actions.classList.add("ready"));
    const again = btn(actions, "primary big", "เล่นอีกครั้ง", "retry");
    onTap(again, () => {
      if (resultsGuard()) return;
      G.audio.sfx("select");
      Flow.startRun(G.heroId);
    });
    onTap(btn(actions, "ghost", "เมนูหลัก", "home"), () => {
      if (resultsGuard()) return;
      G.audio.sfx("select");
      Flow.toMenu();
    });
    this.onKey = (e) => {
      if (e.code === "Enter") again.click();
    };
  }
}
