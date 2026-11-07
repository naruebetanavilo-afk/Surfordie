import { uiIcon, type UiIconName } from "./icons";

/** tiny DOM helpers shared by the screens */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function img(cls: string, parent: HTMLElement, src: string): HTMLImageElement {
  const i = el("img", cls, parent);
  i.alt = "";
  i.draggable = false;
  i.src = src;
  return i;
}

/** button with an optional glyph and a label span */
export function btn(parent: HTMLElement, cls: string, label: string, icon?: UiIconName): HTMLButtonElement {
  const b = el("button", "btn " + cls, parent);
  b.type = "button";
  if (icon) img("btn-ico", b, uiIcon(icon, 64));
  el("span", "btn-label", b, label);
  return b;
}

export function setLabel(b: HTMLButtonElement, text: string): void {
  const l = b.querySelector(".btn-label");
  if (l) l.textContent = text;
}

/** retrigger a one-shot CSS animation class */
export function pulse(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

/** set text only when it changed (avoids layout work in per-frame updates) */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}
