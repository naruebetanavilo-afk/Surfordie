// Keyboard (WASD / arrows) + floating virtual joystick for touch & mouse.
// Movement vector is in world XZ space: screen-up maps to -Z.
export class Input {
  /** movement vector, length 0..1 */
  moveX = 0;
  moveZ = 0;
  /** joystick visuals (CSS pixels) */
  joy = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0, radius: 56 };
  /** set by autoplay bot (debug) */
  botX = 0;
  botZ = 0;
  botActive = false;

  private keys = new Set<string>();
  private pointerId: number | null = null;
  private onPause: (() => void) | null = null;

  constructor(private surface: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Escape" || e.code === "KeyP") this.onPause?.();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.release();
    });

    surface.addEventListener("pointerdown", (e) => {
      // Only start the stick on the game surface itself (not UI buttons).
      const t = e.target as HTMLElement;
      if (t.closest("button, .interactive")) return;
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.joy.active = true;
      this.joy.baseX = this.joy.knobX = e.clientX;
      this.joy.baseY = this.joy.knobY = e.clientY;
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    surface.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.pointerId) return;
      const j = this.joy;
      let dx = e.clientX - j.baseX;
      let dy = e.clientY - j.baseY;
      const len = Math.hypot(dx, dy);
      if (len > j.radius) {
        // drag the base along so the stick never feels "stuck"
        const over = len - j.radius;
        j.baseX += (dx / len) * over;
        j.baseY += (dy / len) * over;
        dx = e.clientX - j.baseX;
        dy = e.clientY - j.baseY;
      }
      j.knobX = j.baseX + dx;
      j.knobY = j.baseY + dy;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.release();
    };
    surface.addEventListener("pointerup", end);
    surface.addEventListener("pointercancel", end);
    surface.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setPauseHandler(fn: () => void): void {
    this.onPause = fn;
  }

  release(): void {
    this.pointerId = null;
    this.joy.active = false;
  }

  update(): void {
    let x = 0;
    let z = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) z -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) z += 1;
    if (x !== 0 || z !== 0) {
      const l = Math.hypot(x, z);
      x /= l;
      z /= l;
    } else if (this.joy.active) {
      const j = this.joy;
      const dx = j.knobX - j.baseX;
      const dy = j.knobY - j.baseY;
      const len = Math.hypot(dx, dy);
      const dead = 6;
      if (len > dead) {
        const mag = Math.min(1, (len - dead) / (j.radius * 0.6));
        x = (dx / len) * mag;
        z = (dy / len) * mag;
      }
    } else if (this.botActive) {
      x = this.botX;
      z = this.botZ;
    }
    this.moveX = x;
    this.moveZ = z;
  }
}
