/**
 * Uniform grid (linked lists in typed arrays) centred on the player, rebuilt
 * every frame. Enemies outside the window are simply not indexed (they are far
 * off-screen and get recycled anyway).
 */
export class SpatialGrid {
  readonly cell = 1.5;
  readonly dim = 96; // 96 * 1.5 = 144 world units across
  private head: Int32Array;
  private next: Int32Array;
  private ox = 0;
  private oz = 0;

  constructor(capacity: number) {
    this.head = new Int32Array(this.dim * this.dim).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
  }

  rebuild(src: { n: number; x: Float32Array; z: Float32Array; state: Uint8Array }, cx: number, cz: number): void {
    const dim = this.dim;
    const cell = this.cell;
    this.head.fill(-1);
    this.ox = Math.floor(cx / cell) - (dim >> 1);
    this.oz = Math.floor(cz / cell) - (dim >> 1);
    for (let i = 0; i < src.n; i++) {
      if (src.state[i] !== 0) continue;
      const gx = Math.floor(src.x[i] / cell) - this.ox;
      const gz = Math.floor(src.z[i] / cell) - this.oz;
      if (gx < 0 || gz < 0 || gx >= dim || gz >= dim) {
        this.next[i] = -1;
        continue;
      }
      const c = gz * dim + gx;
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  /** visit indices in cells overlapping the square around (x,z,r). cb may return true to stop */
  query(x: number, z: number, r: number, cb: (i: number) => boolean | void): void {
    const dim = this.dim;
    const cell = this.cell;
    let x0 = Math.floor((x - r) / cell) - this.ox;
    let x1 = Math.floor((x + r) / cell) - this.ox;
    let z0 = Math.floor((z - r) / cell) - this.oz;
    let z1 = Math.floor((z + r) / cell) - this.oz;
    if (x1 < 0 || z1 < 0 || x0 >= dim || z0 >= dim) return;
    if (x0 < 0) x0 = 0;
    if (z0 < 0) z0 = 0;
    if (x1 >= dim) x1 = dim - 1;
    if (z1 >= dim) z1 = dim - 1;
    for (let gz = z0; gz <= z1; gz++) {
      const row = gz * dim;
      for (let gx = x0; gx <= x1; gx++) {
        let i = this.head[row + gx];
        while (i !== -1) {
          const nx = this.next[i];
          if (cb(i) === true) return;
          i = nx;
        }
      }
    }
  }
}
