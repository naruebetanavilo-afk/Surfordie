import { G } from "../core/G";
import { Meta } from "../core/Meta";
import { STAGES, type StageDef } from "../stages/stages";
import { HEROES, type HeroDef } from "../player/heroes";
import { WEAPONS } from "../weapons/registry";
import type { WeaponDef } from "../weapons/types";
import { passiveById } from "../upgrades/passives";
import { formatNum, formatTime } from "../core/math";
import { MISSIONS, Missions, msToReset, unlockSource, type MissionDef } from "../meta/missions";
import { bestCurse, selectStage, selectedStage, stageBestTime, stageRequirement, stageUnlocked, syncMenuStage, STAGE_UNLOCK_TIME } from "../meta/runSetup";
import { curseColor, curseName } from "../meta/curse";
import { iconURL, stageIcon, uiIcon, type UiIconName } from "./icons";
import { el, img, btn, pulse } from "./dom";
import { onTap } from "./tap";

/** what the meta screens need from Screens (modal plumbing) */
export interface ScreenCtx {
  open(cls: string): HTMLDivElement;
  head(parent: HTMLElement, title: string, onBack?: () => void): HTMLDivElement;
  bankChip(parent: HTMLElement): HTMLSpanElement;
  later(ms: number, fn: () => void): void;
  setKey(fn: ((e: KeyboardEvent) => void) | null): void;
}

/** a hero is locked behind a mission (or a price) and not unlocked yet */
export function heroLocked(h: HeroDef): boolean {
  return (h.price > 0 || !!h.unlock) && !Meta.isUnlocked(h.id);
}

/** "320/500" or "3:12/5:00" */
export function progressText(m: MissionDef, v: number): string {
  if (m.stat === "time") return `${formatTime(v)}/${formatTime(m.goal)}`;
  return `${formatNum(v)}/${formatNum(m.goal)}`;
}

/** Thai lock line of a mission unlock: ภารกิจ "X": desc */
export function missionLockText(m: MissionDef): string {
  return `ภารกิจ "${m.name}": ${m.desc}`;
}

function stageIndex(s: StageDef): number {
  return Math.max(0, STAGES.indexOf(s));
}

function stageArtURL(s: StageDef, size = 96): string {
  return stageIcon(s.id, s.color, stageIndex(s), size);
}

/** reward chips of a mission (gold + unlocks) */
function rewardChips(parent: HTMLElement, m: MissionDef): void {
  const r = m.reward;
  if (r.weapon) {
    const w = WEAPONS.find((d) => d.id === r.weapon);
    if (w) {
      const c = el("span", "ms-chip unlock", parent);
      c.title = `ปลดล็อก ${w.name}`;
      img("", c, iconURL("w:" + w.id, w.icon));
    }
  }
  if (r.hero) {
    const h = HEROES.find((x) => x.id === r.hero);
    if (h) {
      const c = el("span", "ms-chip unlock hero", parent);
      c.title = `ปลดล็อก ${h.name}`;
      img("", c, iconURL("hero:" + h.id, h.portrait, 128));
    }
  }
  const g = el("span", "ms-chip gold", parent);
  img("", g, uiIcon("coin", 64));
  el("b", "", g, formatNum(r.gold));
}

function resetText(): string {
  const ms = msToReset();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `รีเซ็ตใน ${h} ชม. ${m} นาที` : `รีเซ็ตใน ${Math.max(1, m)} นาที`;
}

/**
 * Stage picker, missions and codex screens (opened from the main menu).
 */
export class MetaScreens {
  constructor(private ctx: ScreenCtx) {}

  // ============================================================ stages
  showStages(onBack: () => void): void {
    const s = this.ctx.open("stages");
    const panel = el("div", "panel stages-panel", s);
    this.ctx.head(panel, "เลือกด่าน", onBack);
    el("div", "panel-sub", panel, `ชนะ หรือรอดให้ถึง ${Math.floor(STAGE_UNLOCK_TIME / 60)}:00 เพื่อเปิดด่านถัดไป`);
    const list = el("div", "stage-list", panel);
    const cards: HTMLButtonElement[] = [];
    const cur = selectedStage().id;
    STAGES.forEach((st, idx) => {
      const open = stageUnlocked(st);
      const card = el("button", "stage-card" + (open ? "" : " locked") + (st.id === cur ? " selected" : ""), list);
      card.type = "button";
      card.style.setProperty("--accent", st.color);
      card.style.animationDelay = `${0.05 + idx * 0.06}s`;
      const art = el("div", "stage-art", card);
      img("", art, stageArtURL(st, 128));
      if (!open) {
        const lk = el("div", "stage-lock", art);
        img("", lk, uiIcon("lock", 64));
      }
      const body = el("div", "stage-body", card);
      const nm = el("div", "stage-name", body);
      el("span", "", nm, st.name);
      el("span", "stage-pick", nm, "เลือกอยู่");
      el("div", "stage-desc", body, st.desc);
      if (open) {
        const recs = el("div", "stage-recs", body);
        const best = stageBestTime(st.id);
        const t = el("span", "stage-rec", recs);
        img("", t, uiIcon("hourglass", 64));
        el("b", "", t, best > 0 ? formatTime(best) : "--:--");
        const bc = bestCurse(st.id);
        const c = el("span", "stage-rec curse", recs);
        c.style.setProperty("--accent", curseColor(Math.max(0, bc)));
        img("", c, uiIcon(bc >= 0 ? "trophy" : "curse", 64));
        el("b", "", c, bc < 0 ? "ยังไม่เคยชนะ" : bc === 0 ? "ชนะระดับปกติ" : `ผ่าน${curseName(bc)}`);
      } else {
        const req = stageRequirement(st);
        if (req) {
          const r = el("div", "stage-req", body);
          el("span", "stage-req-txt", r, req.text);
          const bar = el("div", "stage-req-bar", r);
          const fill = el("i", "", bar);
          fill.style.transform = `scaleX(${req.progress.toFixed(3)})`;
          el("small", "", bar, `${formatTime(req.best)}/${formatTime(STAGE_UNLOCK_TIME)}`);
        }
      }
      cards.push(card);
      onTap(card, () => {
        if (!stageUnlocked(st)) {
          G.audio.sfx("deny");
          pulse(card, "shake");
          return;
        }
        selectStage(st.id);
        syncMenuStage();
        G.audio.sfx("select");
        cards.forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        this.ctx.later(260, onBack);
      });
    });
    this.ctx.setKey((e) => {
      if (e.code === "Escape") onBack();
    });
  }

  // ============================================================ missions
  showMissions(onBack: () => void, onChange: () => void): void {
    const s = this.ctx.open("missions");
    const panel = el("div", "panel missions-panel", s);
    const head = this.ctx.head(panel, "ภารกิจ", onBack);
    const bankVal = this.ctx.bankChip(head);
    const top = el("div", "ms-top", panel);
    const claimAll = btn(top, "primary small ms-claim-all", "รับทั้งหมด", "coin");
    const scroll = el("div", "ms-scroll", panel);

    type Row = { m: MissionDef; daily: boolean; row: HTMLDivElement; update: () => void };
    const rows: Row[] = [];
    const refreshTop = () => {
      const n = Missions.claimable();
      claimAll.classList.toggle("hidden", n < 2);
      bankVal.textContent = formatNum(Meta.data.gold);
    };

    const claim = (r: Row): void => {
      const g = Missions.claim(r.m, r.daily);
      if (!g) return;
      G.audio.sfx("coin");
      r.update();
      pulse(r.row, "claimed-pop");
      pulse(bankVal.parentElement as HTMLElement, "bump");
      refreshTop();
      onChange();
    };

    const addRow = (parent: HTMLElement, m: MissionDef, daily: boolean, idx: number): void => {
      const row = el("div", "ms-row", parent);
      row.style.animationDelay = `${0.03 * idx}s`;
      const ic = el("div", "ms-ico", row);
      img("", ic, uiIcon(m.icon as UiIconName, 64));
      const body = el("div", "ms-body", row);
      const nm = el("div", "ms-name", body);
      el("span", "", nm, m.name);
      if (daily) el("span", "ms-tag", nm, "วันนี้");
      el("div", "ms-desc", body, m.desc);
      const bar = el("div", "ms-bar", body);
      const fill = el("i", "", bar);
      const num = el("small", "", bar);
      const side = el("div", "ms-side", row);
      const chips = el("div", "ms-chips", side);
      rewardChips(chips, m);
      const act = el("button", "ms-claim", side);
      act.type = "button";
      const actIco = img("", act, uiIcon("coin", 64));
      const actTxt = el("span", "", act, "รับ");
      const r: Row = {
        m,
        daily,
        row,
        update: () => {
          const v = Missions.progress(m, daily);
          const done = Missions.isDone(m, daily);
          const claimed = Missions.isClaimed(m, daily);
          fill.style.transform = `scaleX(${(m.goal > 0 ? v / m.goal : 1).toFixed(3)})`;
          num.textContent = m.stat === "curse" ? `${done ? m.goal : Math.min(v, m.goal)}/${m.goal}` : progressText(m, v);
          row.classList.toggle("done", done);
          row.classList.toggle("claimable", done && !claimed);
          row.classList.toggle("claimed", claimed);
          act.classList.toggle("hidden", !done);
          act.disabled = claimed;
          actIco.src = uiIcon(claimed ? "check" : "coin", 64);
          actTxt.textContent = claimed ? "รับแล้ว" : "รับ";
        },
      };
      onTap(act, () => claim(r));
      r.update();
      rows.push(r);
    };

    // daily
    const dt = el("div", "sec-title ms-sec", scroll);
    el("span", "", dt, "ภารกิจประจำวัน");
    const reset = el("small", "", dt, resetText());
    const dl = el("div", "ms-list", scroll);
    Missions.today().forEach((m, i) => addRow(dl, m, true, i));
    // achievements: ready to claim first, then in progress, then claimed
    const order = MISSIONS.slice().sort((a, b) => {
      const rank = (m: MissionDef) => (Missions.isClaimed(m, false) ? 2 : Missions.isDone(m, false) ? 0 : 1);
      return rank(a) - rank(b) || MISSIONS.indexOf(a) - MISSIONS.indexOf(b);
    });
    const at = el("div", "sec-title ms-sec", scroll);
    el("span", "", at, "ความสำเร็จ");
    el("small", "", at, `สำเร็จ ${Meta.data.missionsDone.length}/${MISSIONS.length}`);
    const al = el("div", "ms-list", scroll);
    order.forEach((m, i) => addRow(al, m, false, i + 3));

    onTap(claimAll, () => {
      for (const r of rows) if (Missions.isDone(r.m, r.daily) && !Missions.isClaimed(r.m, r.daily)) claim(r);
    });
    refreshTop();
    // keep the reset countdown fresh while the screen is open
    const tick = () => {
      reset.textContent = resetText();
      this.ctx.later(30000, tick);
    };
    this.ctx.later(30000, tick);
    this.ctx.setKey((e) => {
      if (e.code === "Escape") onBack();
    });
  }

  // ============================================================ codex
  showCodex(onBack: () => void): void {
    const s = this.ctx.open("codex");
    const panel = el("div", "panel codex-panel", s);
    this.ctx.head(panel, "สมุดภาพ", onBack);
    const scroll = el("div", "cx-scroll", panel);
    const detail = el("div", "cx-detail", panel);
    const tiles: HTMLButtonElement[] = [];

    interface Entry {
      icon: string;
      name: string;
      kind: string;
      color: string;
      locked: boolean;
      desc: string;
      extra: string[];
      lock?: { text: string; v: number; goal: number; m?: MissionDef };
    }

    const showDetail = (e: Entry, tile: HTMLButtonElement): void => {
      tiles.forEach((t) => t.classList.remove("sel"));
      tile.classList.add("sel");
      detail.textContent = "";
      detail.style.setProperty("--accent", e.color);
      detail.classList.toggle("locked", e.locked);
      pulse(detail, "swap");
      const ic = el("div", "cx-d-ico", detail);
      img("", ic, e.icon);
      if (e.locked) img("cx-d-lock", ic, uiIcon("lock", 64));
      const b = el("div", "cx-d-body", detail);
      const nm = el("div", "cx-d-name", b);
      el("span", "", nm, e.name);
      el("small", "", nm, e.kind);
      el("div", "cx-d-desc", b, e.desc);
      for (const x of e.extra) el("div", "cx-d-extra", b, x);
      if (e.lock) {
        const l = el("div", "cx-d-req", b);
        img("", l, uiIcon("lock", 64));
        el("span", "", l, e.lock.text);
        if (e.lock.goal > 0) {
          const bar = el("div", "ms-bar cx-bar", b);
          const fill = el("i", "", bar);
          fill.style.transform = `scaleX(${Math.min(1, e.lock.v / e.lock.goal).toFixed(3)})`;
          el("small", "", bar, e.lock.m ? progressText(e.lock.m, Math.min(e.lock.v, e.lock.goal)) : `${formatTime(e.lock.v)}/${formatTime(e.lock.goal)}`);
        }
      }
    };

    let first: { e: Entry; t: HTMLButtonElement } | null = null;
    let firstLocked: { e: Entry; t: HTMLButtonElement } | null = null;
    const section = (title: string, entries: Entry[], cls: string): void => {
      const t = el("div", "sec-title cx-sec", scroll);
      el("span", "", t, title);
      el("small", "", t, `ปลดล็อก ${entries.filter((x) => !x.locked).length}/${entries.length}`);
      const grid = el("div", "cx-grid " + cls, scroll);
      entries.forEach((e, i) => {
        const tile = el("button", "cx-tile" + (e.locked ? " locked" : ""), grid);
        tile.type = "button";
        tile.style.setProperty("--accent", e.color);
        tile.style.animationDelay = `${0.02 * i}s`;
        const ic = el("div", "cx-ico", tile);
        img("", ic, e.icon);
        if (e.locked) {
          const lk = el("span", "cx-lock", ic);
          img("", lk, uiIcon("lock", 64));
        }
        el("span", "cx-name", tile, e.name);
        tiles.push(tile);
        onTap(tile, () => {
          G.audio.sfx("select");
          showDetail(e, tile);
        });
        if (!first) first = { e, t: tile };
        if (!firstLocked && e.locked) firstLocked = { e, t: tile };
      });
    };

    const missionLock = (m: MissionDef | undefined): Entry["lock"] => {
      if (!m) return { text: "ยังไม่เปิดให้ใช้", v: 0, goal: 0 };
      return { text: missionLockText(m), v: Missions.progress(m, false), goal: m.goal, m };
    };

    // weapons
    const weaponEntry = (w: WeaponDef): Entry => {
      const locked = !Meta.isWeaponUnlocked(w.id);
      const ev = w.evolution;
      const pas = ev ? passiveById(ev.requires) : undefined;
      const extra: string[] = [];
      if (ev) extra.push(`วิวัฒน์เป็น "${ev.name}" เมื่อเลเวลสูงสุดและมี ${pas ? pas.name : ev.requires}`);
      const owner = HEROES.find((h) => h.startWeapon === w.id);
      if (locked && owner) extra.push(`${owner.name} เริ่มเกมด้วยอาวุธนี้เสมอ`);
      return {
        icon: iconURL("w:" + w.id, w.icon),
        name: w.name,
        kind: "อาวุธ",
        color: w.color,
        locked,
        desc: w.describe(1),
        extra,
        lock: locked ? missionLock(unlockSource("weapon", w.id)) : undefined,
      };
    };
    section("อาวุธ", WEAPONS.map(weaponEntry), "w");

    // heroes
    const heroEntry = (h: HeroDef): Entry => {
      const locked = heroLocked(h);
      const m = h.unlock ? MISSIONS.find((x) => x.id === h.unlock) : unlockSource("hero", h.id);
      return {
        icon: iconURL("hero:" + h.id, h.portrait, 128),
        name: h.name,
        kind: h.title,
        color: h.color,
        locked,
        desc: h.desc,
        extra: [`ไม้ตาย: ${h.ultimate.name}`],
        lock: locked ? (h.price > 0 && !m ? { text: `ซื้อได้ที่เมนูด้วย ${formatNum(h.price)} ทอง`, v: 0, goal: 0 } : missionLock(m)) : undefined,
      };
    };
    section("ฮีโร่", HEROES.map(heroEntry), "h");

    // stages
    const stageEntry = (st: StageDef): Entry => {
      const locked = !stageUnlocked(st);
      const req = stageRequirement(st);
      const bc = bestCurse(st.id);
      const best = stageBestTime(st.id);
      return {
        icon: stageArtURL(st),
        name: st.name,
        kind: "ด่าน",
        color: st.color,
        locked,
        desc: st.desc,
        extra: locked ? [] : [`สถิติ ${best > 0 ? formatTime(best) : "--:--"} • ${bc < 0 ? "ยังไม่เคยชนะ" : bc === 0 ? "ชนะระดับปกติ" : `ผ่าน${curseName(bc)}`}`],
        lock: req ? { text: req.text, v: req.best, goal: STAGE_UNLOCK_TIME } : undefined,
      };
    };
    section("ด่าน", STAGES.map(stageEntry), "s");

    const pick = (firstLocked ?? first) as { e: Entry; t: HTMLButtonElement } | null;
    if (pick) showDetail(pick.e, pick.t);
    this.ctx.setKey((e) => {
      if (e.code === "Escape") onBack();
    });
  }
}
