import { G } from "../core/G";
import { Meta } from "../core/Meta";
import { onTap } from "./tap";
import { luIcon } from "./levelupIcons";
import "./levelup.css";

/**
 * Small always-visible "ออโต้" chip during play (AUTO level-up mode on/off).
 * Sits under the HUD's kills / pause row on the right; it is inserted before
 * the modal layer so level-up / chest / pause screens cover it like the HUD.
 * update() runs every frame and only touches the DOM when something changed.
 */
export class AutoChip {
  private readonly wrap: HTMLDivElement;
  private readonly btn: HTMLButtonElement;
  private readonly state: HTMLSpanElement;
  private shown: boolean | null = null;
  private on: boolean | null = null;
  private flip = false;

  constructor(ui: HTMLElement, before: Element | null) {
    this.wrap = document.createElement("div");
    this.wrap.className = "auto-chip-wrap hidden";
    ui.insertBefore(this.wrap, before);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "auto-chip interactive";
    const ico = document.createElement("img");
    ico.className = "auto-chip-ico";
    ico.alt = "";
    ico.draggable = false;
    ico.src = luIcon("auto", 64);
    b.appendChild(ico);
    const txt = document.createElement("span");
    txt.className = "auto-chip-txt";
    txt.textContent = "ออโต้";
    b.appendChild(txt);
    this.state = document.createElement("span");
    this.state.className = "auto-chip-state";
    b.appendChild(this.state);
    this.wrap.appendChild(b);
    this.btn = b;
    // onTap: works as a second finger while the joystick thumb is held
    onTap(b, () => {
      Meta.setAutoPick(!Meta.data.autoPick);
      G.audio.sfx("select");
      this.flip = !this.flip;
      b.classList.toggle("popA", this.flip);
      b.classList.toggle("popB", !this.flip);
      this.update();
    });
  }

  update(): void {
    const s = G.state;
    const show = s === "playing" || s === "levelup" || s === "chest" || s === "paused";
    if (show !== this.shown) {
      this.shown = show;
      this.wrap.classList.toggle("hidden", !show);
    }
    if (!show) return;
    const on = Meta.data.autoPick;
    if (on !== this.on) {
      this.on = on;
      this.btn.classList.toggle("on", on);
      this.btn.setAttribute("aria-pressed", String(on));
      this.btn.setAttribute("aria-label", on ? "ออโต้เลือกสกิล: เปิด" : "ออโต้เลือกสกิล: ปิด");
      this.state.textContent = on ? "เปิด" : "ปิด";
    }
  }
}
