import { G } from "../core/G";
import type { GameEvents } from "../core/Events";
import { HEROES } from "../player/heroes";
import { weaponById } from "../weapons/registry";
import { formatNum } from "../core/math";
import { iconURL, uiIcon } from "./icons";
import { el, img } from "./dom";

type Done = GameEvents["missionComplete"];

/** seconds a toast stays (play time only) */
const SHOW = 3.4;
const OUT = 0.35;

/**
 * Small banner at the top of the screen while playing when a mission
 * completes ("ภารกิจสำเร็จ!"). Queued, one at a time; the clock only runs
 * while G.state === "playing" so a level-up modal does not eat it. Inserted
 * below the modal layer (modals cover it like the HUD). DOM is only touched
 * when a toast starts / ends.
 */
export class MissionToast {
  private readonly wrap: HTMLDivElement;
  private readonly queue: Done[] = [];
  private cur: HTMLDivElement | null = null;
  private t = 0;
  private out = false;

  constructor(ui: HTMLElement, before: Element | null) {
    this.wrap = document.createElement("div");
    this.wrap.className = "ms-toasts";
    ui.insertBefore(this.wrap, before);
    G.events.on("missionComplete", (e) => {
      // only during a run: on the menu the missions button badge tells the story
      if (G.state !== "playing" && G.state !== "levelup" && G.state !== "chest" && G.state !== "paused") return;
      this.queue.push(e);
    });
    G.events.on("runStart", () => this.clear());
  }

  private clear(): void {
    this.queue.length = 0;
    this.cur?.remove();
    this.cur = null;
  }

  /** per frame (real dt) */
  update(dt: number): void {
    const s = G.state;
    if (s !== "playing") {
      // modals (level-up, chest, pause) cover the banner and freeze its clock;
      // the run is over on the end / menu screens (results list the missions)
      if (s !== "levelup" && s !== "chest" && s !== "paused" && (this.cur || this.queue.length)) this.clear();
      return;
    }
    if (this.cur) {
      this.t += dt;
      if (!this.out && this.t >= SHOW) {
        this.out = true;
        this.cur.classList.add("out");
      }
      if (this.t >= SHOW + OUT) {
        this.cur.remove();
        this.cur = null;
      }
      return;
    }
    const e = this.queue.shift();
    if (e) this.show(e);
  }

  private show(e: Done): void {
    this.t = 0;
    this.out = false;
    const card = el("div", "ms-toast" + (e.daily ? " daily" : ""), this.wrap);
    const ic = el("div", "ms-toast-ico", card);
    img("", ic, uiIcon("scroll", 64));
    const body = el("div", "ms-toast-body", card);
    el("small", "ms-toast-cap", body, e.daily ? "ภารกิจประจำวันสำเร็จ!" : "ภารกิจสำเร็จ!");
    el("b", "ms-toast-name", body, e.name);
    const rw = el("div", "ms-toast-rw", body);
    const w = e.weapon ? weaponById(e.weapon) : undefined;
    const h = e.hero ? HEROES.find((x) => x.id === e.hero) : undefined;
    if (w) {
      img("ms-toast-mini", rw, iconURL("w:" + w.id, w.icon));
      el("span", "unlock", rw, `ปลดล็อก ${w.name}!`);
    } else if (h) {
      img("ms-toast-mini", rw, iconURL("hero:" + h.id, h.portrait, 128));
      el("span", "unlock", rw, `ปลดล็อก ${h.name}!`);
    } else {
      img("ms-toast-mini", rw, uiIcon("coin", 64));
      el("span", "", rw, `+${formatNum(e.gold)} ทอง • รับที่เมนูภารกิจ`);
    }
    this.cur = card;
    G.audio.sfx("coin", { pitch: 0.75, vol: 0.9 });
    G.audio.sfx("select", { pitch: 1.6, vol: 0.6 });
  }
}
