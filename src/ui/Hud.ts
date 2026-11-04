import { G } from "../core/G";
import { formatTime, formatNum } from "../core/math";
import { iconURL } from "./icons";
import { weaponById } from "../weapons/registry";
import { passiveById } from "../upgrades/passives";
import type { Choice } from "../weapons/WeaponSystem";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * In-game DOM HUD: portrait + level + XP bar (top-left), gold, timer, kills,
 * pause button, weapon/passive slots, skill toasts (left), boss bar,
 * announcements.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private portrait: HTMLImageElement;
  private lvl: HTMLDivElement;
  private name: HTMLDivElement;
  private xpFill: HTMLDivElement;
  private xpText: HTMLSpanElement;
  private gold: HTMLSpanElement;
  private time: HTMLSpanElement;
  private kills: HTMLSpanElement;
  private slots: HTMLDivElement;
  private toasts: HTMLDivElement;
  private boss: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossFill: HTMLDivElement;
  private announceEl: HTMLDivElement;
  private fps: HTMLDivElement;
  private last: Record<string, string | number> = {};
  private slotKey = "";

  constructor(ui: HTMLElement) {
    this.root = el("div", "hud hidden", ui);
    const top = el("div", "hud-top", this.root);

    const pl = el("div", "hud-player", top);
    const pf = el("div", "hud-portrait", pl);
    this.portrait = el("img", "", pf);
    this.lvl = el("div", "hud-lvl", pf);
    const info = el("div", "hud-info", pl);
    this.name = el("div", "hud-name", info);
    const xp = el("div", "hud-xp", info);
    this.xpFill = el("div", "hud-xp-fill", xp);
    this.xpText = el("span", "hud-xp-text", xp);

    const mid = el("div", "hud-gold", top);
    el("i", "coin", mid);
    this.gold = el("span", "", mid);

    const right = el("div", "hud-right", top);
    const tb = el("div", "hud-time", right);
    el("i", "hourglass", tb);
    this.time = el("span", "", tb);
    const kb = el("div", "hud-kills", right);
    el("i", "skull", kb);
    this.kills = el("span", "", kb);

    const pause = el("button", "hud-pause interactive", top);
    pause.setAttribute("aria-label", "หยุดชั่วคราว");
    pause.innerHTML = "<span></span><span></span>";
    pause.addEventListener("click", () => G.screens.togglePause());

    this.slots = el("div", "hud-slots", this.root);
    this.toasts = el("div", "hud-toasts", this.root);

    this.boss = el("div", "hud-boss hidden", this.root);
    this.bossName = el("div", "hud-boss-name", this.boss);
    const bb = el("div", "hud-boss-bar", this.boss);
    this.bossFill = el("div", "hud-boss-fill", bb);

    this.announceEl = el("div", "hud-announce", this.root);
    this.fps = el("div", "hud-fps", this.root);

    G.events.on("announce", (e) => this.announce(e.text, e.color));
    G.events.on("bossSpawned", (e) => this.announce(`⚠ ${e.name} ปรากฏตัว!`, "#ff4f6a"));
  }

  show(on: boolean): void {
    this.root.classList.toggle("hidden", !on);
  }

  reset(): void {
    this.toasts.innerHTML = "";
    this.slotKey = "";
    this.last = {};
    this.portrait.src = iconURL("hero:" + G.player.hero.id, G.player.hero.portrait, 128);
    this.name.textContent = G.player.hero.name;
    this.boss.classList.add("hidden");
  }

  private set(key: string, v: string | number, apply: () => void): void {
    if (this.last[key] === v) return;
    this.last[key] = v;
    apply();
  }

  update(): void {
    const p = G.player;
    this.set("lvl", p.level, () => (this.lvl.textContent = String(p.level)));
    const xpTxt = `${Math.floor(p.xp)}/${p.xpNext}`;
    this.set("xp", xpTxt, () => {
      this.xpText.textContent = xpTxt;
      this.xpFill.style.width = `${Math.min(100, (p.xp / p.xpNext) * 100).toFixed(1)}%`;
    });
    this.set("gold", G.stats.gold, () => (this.gold.textContent = formatNum(G.stats.gold)));
    const tt = formatTime(G.time);
    this.set("time", tt, () => (this.time.textContent = tt));
    this.set("kills", G.stats.kills, () => (this.kills.textContent = formatNum(G.stats.kills)));
    this.updateSlots();
    this.updateBoss();
    if (G.debug.showFps) {
      const f = G.perf;
      this.fps.textContent = `${f.fps.toFixed(0)}fps ${f.frameMs.toFixed(1)}ms • ศัตรู ${f.enemies} • p ${f.particles} • dc ${f.drawCalls}`;
    }
  }

  private updateSlots(): void {
    const ws = G.weapons.weapons;
    const key = ws.map((w) => `${w.def.id}${w.level}${w.evolved ? "e" : ""}`).join(",") + "|" + [...G.weapons.passives].map(([k, v]) => k + v).join(",");
    if (key === this.slotKey) return;
    this.slotKey = key;
    this.slots.innerHTML = "";
    const row1 = el("div", "slot-row", this.slots);
    for (const w of ws) {
      const s = el("div", "slot" + (w.evolved ? " evolved" : ""), row1);
      const img = el("img", "", s);
      img.src = iconURL((w.evolved ? "e:" : "w:") + w.def.id, w.evolved && w.def.evolution?.icon ? w.def.evolution.icon : w.def.icon, 64);
      el("b", "", s).textContent = w.level >= w.def.maxLevel ? "MAX" : String(w.level);
    }
    const row2 = el("div", "slot-row small", this.slots);
    for (const [id, l] of G.weapons.passives) {
      const d = passiveById(id);
      if (!d) continue;
      const s = el("div", "slot", row2);
      const img = el("img", "", s);
      img.src = iconURL("p:" + id, d.icon, 64);
      el("b", "", s).textContent = l >= d.maxLevel ? "MAX" : String(l);
    }
  }

  private updateBoss(): void {
    const em = G.enemies;
    let bi = -1;
    for (let i = 0; i < em.n; i++) {
      if (em.state[i] === 0 && em.isBoss(i)) {
        bi = i;
        break;
      }
    }
    if (bi < 0) {
      this.set("boss", "none", () => this.boss.classList.add("hidden"));
      return;
    }
    const name = em.def(bi).name;
    this.set("boss", name, () => {
      this.boss.classList.remove("hidden");
      this.bossName.textContent = name;
    });
    const f = Math.max(0, em.hp[bi] / em.maxHp[bi]);
    this.bossFill.style.width = `${(f * 100).toFixed(1)}%`;
  }

  /** left-side skill toast (like "วงล้อ... สปีดโจมตี +110%") */
  toast(c: Choice): void {
    const t = el("div", "toast", this.toasts);
    t.style.setProperty("--accent", c.color);
    const img = el("img", "", t);
    img.src = c.icon;
    const body = el("div", "toast-body", t);
    el("div", "toast-name", body).textContent = c.isNew ? `${c.name} (ใหม่)` : c.kind === "evolve" ? c.name : `${c.name} Lv.${c.level}`;
    const lines = c.lines.length ? c.lines : [c.desc];
    lines.slice(0, 3).forEach((ln, i) => {
      const d = el("div", "toast-line", body);
      d.textContent = ln;
      d.style.animationDelay = `${0.08 * (i + 1)}s`;
    });
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.classList.add("out"), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  announce(text: string, color = "#ffffff"): void {
    const a = this.announceEl;
    a.textContent = text;
    a.style.color = color;
    a.classList.remove("show");
    void a.offsetWidth;
    a.classList.add("show");
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
