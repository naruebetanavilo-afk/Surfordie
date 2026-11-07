import { G } from "../core/G";
import { STAGES } from "../stages/stages";
import { CURSE_MAX, curseLines, curseColor, curseMods } from "../meta/curse";
import { maxCurse, selectCurse, selectedCurse, selectedStage, stageUnlocked, syncMenuStage } from "../meta/runSetup";
import { stageIcon, uiIcon } from "./icons";
import { el, img, pulse, setText } from "./dom";
import { onTap } from "./tap";

/** short labels for the one-line modifier summary under the stepper */
const SHORT: Record<string, string> = {
  hp: "HP",
  dmg: "ดาเมจ",
  speed: "เร็ว",
  density: "จำนวน",
};

/**
 * Run setup block of the main menu: the selected stage (tap: stage picker)
 * and the curse-tier stepper (− / +, a pip per tier: locked tiers greyed),
 * with the exact modifiers of the selected tier and its gold bonus below.
 * It never blocks "เริ่มเกม": the selection simply persists in Meta.
 */
export class RunSetupPanel {
  readonly root: HTMLDivElement;
  readonly mods: HTMLDivElement;
  private readonly stageBtn: HTMLButtonElement;
  private readonly stageArt: HTMLImageElement;
  private readonly stageName: HTMLElement;
  private readonly stageSub: HTMLElement;
  private readonly curseBox: HTMLDivElement;
  private readonly tierNum: HTMLElement;
  private readonly tierCap: HTMLElement;
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private readonly pips: HTMLElement[] = [];
  private hintT = 0;

  /**
   * `onStage` opens the stage picker; `later` schedules a timer that is
   * cancelled when the screen closes.
   */
  constructor(parent: HTMLElement, onStage: () => void, private later: (ms: number, fn: () => void) => void) {
    this.root = el("div", "run-setup", parent);

    // ---- stage
    const sb = el("button", "rs-stage", this.root);
    sb.type = "button";
    sb.setAttribute("aria-label", "เลือกด่าน");
    this.stageArt = img("rs-stage-art", sb, "");
    const st = el("span", "rs-stage-txt", sb);
    this.stageSub = el("small", "", st);
    this.stageName = el("b", "", st);
    el("span", "rs-chev", sb, "›");
    this.stageBtn = sb;
    onTap(sb, () => {
      G.audio.sfx("select");
      onStage();
    });

    // ---- curse stepper
    const cb = el("div", "rs-curse", this.root);
    this.curseBox = cb;
    const row = el("div", "rs-curse-row", cb);
    this.minus = el("button", "rs-step minus", row);
    this.minus.type = "button";
    this.minus.setAttribute("aria-label", "ลดระดับคำสาป");
    el("span", "", this.minus, "−");
    const tier = el("div", "rs-tier", row);
    img("rs-tier-ico", tier, uiIcon("curse", 64));
    const tt = el("span", "rs-tier-txt", tier);
    this.tierCap = el("small", "", tt, "คำสาป");
    this.tierNum = el("b", "", tt);
    this.plus = el("button", "rs-step plus", row);
    this.plus.type = "button";
    this.plus.setAttribute("aria-label", "เพิ่มระดับคำสาป");
    el("span", "", this.plus, "+");
    const pr = el("div", "rs-pips", cb);
    for (let t = 1; t <= CURSE_MAX; t++) this.pips.push(el("i", "", pr));
    onTap(this.minus, () => this.step(-1));
    onTap(this.plus, () => this.step(1));

    this.mods = el("div", "rs-mods", parent);
    this.mods.setAttribute("aria-live", "polite");
    this.refresh();
  }

  /** change the tier by `d`; a locked tier shakes the stepper and says how to open it */
  step(d: number): void {
    const stage = selectedStage();
    const cur = selectedCurse(stage.id);
    const next = cur + d;
    if (next < 0) {
      G.audio.sfx("deny");
      pulse(this.minus, "shake");
      return;
    }
    if (next > CURSE_MAX || !selectCurse(stage.id, next)) {
      G.audio.sfx("deny");
      pulse(this.curseBox, "shake");
      if (next <= CURSE_MAX) this.hint(next);
      return;
    }
    G.audio.sfx("select", { pitch: 1 + next * 0.04 });
    pulse(this.tierNum, "bump");
    this.refresh();
  }

  /** show why `tier` is locked in the modifier line for a moment */
  private hint(tier: number): void {
    const stage = selectedStage();
    const need = tier - 1;
    this.mods.textContent = "";
    this.mods.classList.add("hint");
    img("rs-lock", this.mods, uiIcon("lock", 64));
    el("span", "", this.mods, need <= 0 ? `ชนะด่าน "${stage.name}" 1 ครั้ง เพื่อปลดล็อกคำสาป 1` : `ชนะคำสาป ${need} ในด่านนี้ เพื่อปลดล็อกคำสาป ${tier}`);
    const id = ++this.hintT;
    this.later(2400, () => {
      if (id === this.hintT) this.refresh();
    });
  }

  refresh(): void {
    this.hintT++;
    const stage = selectedStage();
    const idx = STAGES.indexOf(stage);
    this.stageBtn.style.setProperty("--accent", stage.color);
    this.stageArt.src = stageIcon(stage.id, stage.color, Math.max(0, idx), 96);
    setText(this.stageName, stage.name);
    setText(this.stageSub, STAGES.length > 1 ? `ด่าน ${idx + 1}/${STAGES.length}` : "ด่าน");
    this.stageBtn.classList.toggle("more", STAGES.length > 1);

    const t = selectedCurse(stage.id);
    const max = maxCurse(stage.id);
    this.curseBox.style.setProperty("--accent", curseColor(t));
    this.curseBox.classList.toggle("on", t > 0);
    setText(this.tierNum, String(t));
    setText(this.tierCap, t > 0 ? "คำสาป" : "ปกติ");
    this.minus.classList.toggle("off", t <= 0);
    this.plus.classList.toggle("off", t >= max);
    this.plus.classList.toggle("locked", t >= max && max < CURSE_MAX);
    // "+" glows only when the tier right above the selection is the newest one opened
    this.plus.classList.toggle("new", t + 1 === max && max > 0);
    this.pips.forEach((p, k) => {
      const tier = k + 1;
      p.className = tier <= t ? "on" : tier <= max ? "open" : "";
      if (tier <= t) p.style.background = curseColor(tier);
      else p.style.background = "";
    });

    // exact numbers of the selected tier
    const m = this.mods;
    m.classList.remove("hint");
    m.textContent = "";
    if (t === 0) {
      el("span", "rs-normal", m, "ระดับปกติ");
      el("span", "rs-sep", m, "•");
      el("span", "", m, max > 0 ? `ปลดล็อกถึงคำสาป ${max} แล้ว — กด + เพื่อท้าทาย` : "ชนะด่านนี้เพื่อปลดล็อกคำสาป 1");
      return;
    }
    el("span", "rs-mods-cap", m, "ศัตรู");
    for (const ln of curseLines(t)) {
      if (ln.key === "gold") continue;
      const s = el("span", "rs-mod", m);
      el("span", "", s, SHORT[ln.key] ?? ln.label);
      el("b", "", s, " " + ln.value);
    }
    const g = el("span", "rs-gold", m);
    img("", g, uiIcon("coin", 64));
    el("b", "", g, `ทอง +${Math.round((curseMods(t).gold - 1) * 100)}%`);
  }

  /** keep G.stageId (menu background) in sync after a selection elsewhere */
  sync(): void {
    syncMenuStage();
    this.refresh();
  }
}
