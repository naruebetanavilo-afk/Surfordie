import { G } from "../core/G";
import { Flow } from "../core/flow";
import { Meta, SHOP } from "../core/Meta";
import { HEROES } from "../player/heroes";
import { iconURL } from "./icons";
import { formatTime, formatNum } from "../core/math";
import { weaponById } from "../weapons/registry";
import type { Choice } from "../weapons/WeaponSystem";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * Full-screen DOM screens: main menu (hero select, shop, settings), level-up
 * cards, treasure chest, pause, results.
 */
export class Screens {
  private layer: HTMLDivElement;
  private current: HTMLDivElement | null = null;
  private selectedHero = Meta.data.lastHero || "knight";

  constructor(private ui: HTMLElement) {
    this.layer = el("div", "screens", ui);
  }

  private open(cls: string): HTMLDivElement {
    this.close();
    const s = el("div", `screen ${cls} interactive`, this.layer);
    this.current = s;
    requestAnimationFrame(() => s.classList.add("in"));
    return s;
  }

  close(): void {
    if (this.current) {
      this.current.remove();
      this.current = null;
    }
  }

  // ---------------------------------------------------------------- menu
  showMenu(): void {
    const s = this.open("menu");
    const wrap = el("div", "menu-wrap", s);
    const title = el("div", "title", wrap);
    el("h1", "", title, "SURFORDIE");
    el("p", "subtitle", title, "เอาชีวิตรอด... หรือตาย");

    const bank = el("div", "bank", wrap);
    el("i", "coin", bank);
    el("span", "", bank, formatNum(Meta.data.gold));

    el("div", "section-label", wrap, "เลือกฮีโร่");
    const heroes = el("div", "hero-list", wrap);
    for (const h of HEROES) {
      const card = el("button", "hero-card", heroes);
      card.style.setProperty("--accent", h.color);
      if (h.id === this.selectedHero) card.classList.add("selected");
      const img = el("img", "", card);
      img.src = iconURL("hero:" + h.id, h.portrait, 128);
      el("div", "hero-name", card, h.name);
      el("div", "hero-title", card, h.title);
      el("div", "hero-desc", card, h.desc);
      card.addEventListener("click", () => {
        this.selectedHero = h.id;
        G.audio.sfx("select");
        heroes.querySelectorAll(".hero-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
      });
    }

    const play = el("button", "btn primary big", wrap, "เริ่มเกม");
    play.addEventListener("click", () => {
      Meta.data.lastHero = this.selectedHero;
      Meta.save();
      G.audio.sfx("select");
      Flow.startRun(this.selectedHero);
    });

    const row = el("div", "btn-row", wrap);
    const shop = el("button", "btn", row, "ร้านค้า");
    shop.addEventListener("click", () => this.showShop());
    const settings = el("button", "btn", row, "ตั้งค่า");
    settings.addEventListener("click", () => this.showSettings(() => this.showMenu()));

    if (Meta.data.runs > 0) {
      el("div", "records", wrap, `สถิติดีที่สุด ${formatTime(Meta.data.bestTime)} • สังหาร ${formatNum(Meta.data.bestKills)}`);
    }
  }

  // ---------------------------------------------------------------- shop
  showShop(): void {
    const s = this.open("shop");
    const wrap = el("div", "panel", s);
    el("h2", "", wrap, "ร้านค้าถาวร");
    const bank = el("div", "bank", wrap);
    el("i", "coin", bank);
    const bankTxt = el("span", "", bank, formatNum(Meta.data.gold));
    const list = el("div", "shop-list", wrap);
    const render = () => {
      list.innerHTML = "";
      bankTxt.textContent = formatNum(Meta.data.gold);
      for (const up of SHOP) {
        const lvl = Meta.level(up.id);
        const row = el("div", "shop-item", list);
        const info = el("div", "shop-info", row);
        el("div", "shop-name", info, `${up.name}  ${"●".repeat(lvl)}${"○".repeat(up.maxLevel - lvl)}`);
        el("div", "shop-desc", info, up.desc);
        const maxed = lvl >= up.maxLevel;
        const price = maxed ? 0 : up.price(lvl + 1);
        const b = el("button", "btn small" + (maxed || Meta.data.gold < price ? " disabled" : ""), row, maxed ? "สูงสุด" : `${formatNum(price)}`);
        if (!maxed) b.prepend(el("i", "coin"));
        b.addEventListener("click", () => {
          if (Meta.buy(up.id)) {
            G.audio.sfx("coin");
            render();
          } else G.audio.sfx("deny");
        });
      }
    };
    render();
    const back = el("button", "btn", wrap, "กลับ");
    back.addEventListener("click", () => this.showMenu());
  }

  // ---------------------------------------------------------------- settings
  showSettings(onBack: () => void): void {
    const s = this.open("settings");
    const wrap = el("div", "panel", s);
    el("h2", "", wrap, "ตั้งค่า");
    const mute = el("button", "btn", wrap, Meta.data.muted ? "เสียง: ปิด" : "เสียง: เปิด");
    mute.addEventListener("click", () => {
      Meta.data.muted = !Meta.data.muted;
      Meta.save();
      G.audio.applySettings();
      mute.textContent = Meta.data.muted ? "เสียง: ปิด" : "เสียง: เปิด";
    });
    const qNames = { low: "ต่ำ", medium: "กลาง", high: "สูง" } as const;
    const q = el("button", "btn", wrap, `กราฟิก: ${qNames[G.world.quality]}`);
    q.addEventListener("click", () => {
      const order = ["low", "medium", "high"] as const;
      const next = order[(order.indexOf(G.world.quality) + 1) % 3];
      G.world.setQuality(next);
      q.textContent = `กราฟิก: ${qNames[next]}`;
    });
    const fps = el("button", "btn", wrap, G.debug.showFps ? "แสดง FPS: เปิด" : "แสดง FPS: ปิด");
    fps.addEventListener("click", () => {
      G.debug.showFps = !G.debug.showFps;
      fps.textContent = G.debug.showFps ? "แสดง FPS: เปิด" : "แสดง FPS: ปิด";
    });
    const back = el("button", "btn primary", wrap, "กลับ");
    back.addEventListener("click", onBack);
  }

  // ---------------------------------------------------------------- level up
  showLevelUp(choices: Choice[], onPick: (c: Choice) => void): void {
    const s = this.open("levelup");
    el("div", "levelup-title", s, "เลเวลอัป!");
    el("div", "levelup-sub", s, `เลเวล ${G.player.level} • เลือกพลัง 1 อย่าง`);
    const list = el("div", "card-list", s);
    choices.forEach((c, idx) => {
      const card = el("button", "card", list);
      card.style.setProperty("--accent", c.color);
      card.style.animationDelay = `${idx * 0.06}s`;
      const img = el("img", "", card);
      img.src = c.icon;
      const body = el("div", "card-body", card);
      const head = el("div", "card-head", body);
      el("span", "card-name", head, c.name);
      el(
        "span",
        "card-badge" + (c.isNew ? " new" : ""),
        head,
        c.isNew ? "ใหม่!" : c.kind === "evolve" ? "วิวัฒน์" : c.kind === "gold" || c.kind === "heal" ? "" : `Lv.${c.level}`,
      );
      el("div", "card-desc", body, c.desc);
      card.addEventListener("click", () => {
        if (s.dataset.picked) return;
        s.dataset.picked = "1";
        G.audio.sfx("select");
        onPick(c);
      });
    });
  }

  // ---------------------------------------------------------------- chest
  openChest(): void {
    if (G.state !== "playing") return;
    G.state = "chest";
    const rewards = G.weapons.openChest();
    const s = this.open("chest");
    el("div", "levelup-title", s, "หีบสมบัติ!");
    const list = el("div", "card-list", s);
    rewards.forEach((c, idx) => {
      const card = el("div", "card", list);
      card.style.setProperty("--accent", c.color);
      card.style.animationDelay = `${0.2 + idx * 0.15}s`;
      const img = el("img", "", card);
      img.src = c.icon;
      const body = el("div", "card-body", card);
      el("div", "card-name", body, c.kind === "evolve" ? `✦ ${c.name}` : `${c.name} Lv.${c.level}`);
      el("div", "card-desc", body, c.desc);
    });
    const ok = el("button", "btn primary big", s, "รับ");
    ok.addEventListener("click", () => {
      this.close();
      Flow.resume();
    });
  }

  // ---------------------------------------------------------------- pause
  togglePause(): void {
    if (G.state === "playing") Flow.pause();
    else if (G.state === "paused") {
      this.close();
      Flow.resume();
    }
  }

  showPause(): void {
    const s = this.open("pause");
    const wrap = el("div", "panel", s);
    el("h2", "", wrap, "หยุดชั่วคราว");
    const owned = el("div", "pause-owned", wrap);
    for (const w of G.weapons.weapons) {
      const it = el("div", "pause-item", owned);
      const img = el("img", "", it);
      img.src = iconURL("w:" + w.def.id, w.def.icon, 64);
      el("span", "", it, `${w.name} Lv.${w.level}`);
    }
    const resume = el("button", "btn primary big", wrap, "เล่นต่อ");
    resume.addEventListener("click", () => this.togglePause());
    const settings = el("button", "btn", wrap, "ตั้งค่า");
    settings.addEventListener("click", () => this.showSettings(() => this.showPause()));
    const quit = el("button", "btn danger", wrap, "ออกไปเมนู");
    quit.addEventListener("click", () => Flow.toMenu());
  }

  // ---------------------------------------------------------------- results
  showResults(victory: boolean, goldEarned: number): void {
    const s = this.open("results " + (victory ? "win" : "lose"));
    const wrap = el("div", "panel", s);
    el("h2", "result-title", wrap, victory ? "รอดชีวิต!" : "คุณตายแล้ว");
    const grid = el("div", "result-grid", wrap);
    const stat = (label: string, value: string) => {
      const r = el("div", "result-stat", grid);
      el("span", "", r, label);
      el("b", "", r, value);
    };
    stat("เวลารอด", formatTime(G.time));
    stat("สังหาร", formatNum(G.stats.kills));
    stat("เลเวล", String(G.player.level));
    stat("ทองที่ได้", `+${formatNum(goldEarned)}`);
    const dmg = el("div", "result-dmg", wrap);
    const entries = Object.entries(G.stats.damageBy).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
    for (const [id, v] of entries) {
      const d = weaponById(id);
      if (!d) continue;
      const row = el("div", "dmg-row", dmg);
      const img = el("img", "", row);
      img.src = iconURL("w:" + id, d.icon, 64);
      const bar = el("div", "dmg-bar", row);
      const fill = el("div", "dmg-fill", bar);
      fill.style.width = `${((v / total) * 100).toFixed(0)}%`;
      el("span", "dmg-val", row, formatNum(v));
    }
    const again = el("button", "btn primary big", wrap, "เล่นอีกครั้ง");
    again.addEventListener("click", () => Flow.startRun(G.heroId));
    const menu = el("button", "btn", wrap, "เมนูหลัก");
    menu.addEventListener("click", () => Flow.toMenu());
  }
}
