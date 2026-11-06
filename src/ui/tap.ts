/**
 * Multi-touch safe "tap" for UI buttons.
 *
 * Browsers only synthesise `click` for single-pointer taps: while the joystick
 * thumb is still on the screen, a second finger's tap on a button produces
 * pointerdown/pointerup but never a click. onTap() fires on the pointerup of
 * the same pointer that went down on the element, as long as it is released
 * over the element (touch pointers are implicitly captured, so the target of
 * pointerup is always the element: the release point is hit-tested instead).
 *
 * `click` is still handled for keyboard activation and programmatic
 * `el.click()` (autoplay bot, Enter shortcuts); a click that follows a pointer
 * tap on the same element is ignored, and the touchend of a pointer tap is
 * cancelled so no synthetic click can land on whatever replaced the element.
 */

/** `downAt` = performance.now() of the press, or -1 for keyboard / programmatic clicks */
export type TapHandler = (e: PointerEvent | MouseEvent, downAt: number) => void;

/** a click within this many ms after a pointer tap on the same element is the duplicate */
const DEDUPE_MS = 500;

export function onTap(el: HTMLElement, fn: TapHandler): void {
  let id = -1;
  let downAt = 0;
  let tapAt = -Infinity;
  let cancelTouch = false;

  el.addEventListener("pointerdown", (e) => {
    // primary mouse button only; touch and pen always report button 0
    if (e.button !== 0) return;
    id = e.pointerId;
    downAt = performance.now();
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerId !== id) return;
    id = -1;
    if (!releasedOver(el, e.clientX, e.clientY)) return;
    tapAt = performance.now();
    cancelTouch = e.pointerType === "touch";
    fn(e, downAt);
  });
  el.addEventListener("pointercancel", (e) => {
    if (e.pointerId === id) id = -1;
  });
  // pointerup is dispatched before touchend: cancelling the touchend of a tap
  // that already fired suppresses the compatibility click (no ghost clicks on
  // a screen that opened under the finger)
  el.addEventListener(
    "touchend",
    (e) => {
      if (!cancelTouch) return;
      cancelTouch = false;
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener("click", (e) => {
    if (performance.now() - tapAt < DEDUPE_MS) return;
    fn(e, -1);
  });
}

function releasedOver(el: HTMLElement, x: number, y: number): boolean {
  const hit = document.elementFromPoint(x, y);
  if (hit) return el.contains(hit);
  // outside the viewport (or no hit-testable element): fall back to the box
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
