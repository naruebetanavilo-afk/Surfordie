// Pre-renders procedural recipes into AudioBuffers with OfflineAudioContexts
// (off the main thread in modern browsers). Playback of a buffer costs one
// source node + one gain, which is what keeps dense combat audio cheap.
import { type Voice, mulberry32, offlineCtor, renderOffline, finishBuffer } from "./synth";

export interface SampleRecipe {
  dur: number;
  /** render sample rate (default 32 kHz) */
  rate?: number;
  /** random variants to render (default 1) */
  variants?: number;
  render(v: Voice): void;
}

export interface RenderJob {
  key: string;
  recipe: SampleRecipe;
}

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Disconnects nodes once their scheduled sound has finished (no onended closures). */
export class Reaper {
  private nodes: AudioNode[] = [];
  private times: number[] = [];

  add(node: AudioNode, at: number): void {
    this.nodes.push(node);
    this.times.push(at);
  }

  sweep(now: number): void {
    const n = this.nodes;
    const t = this.times;
    let w = 0;
    for (let i = 0; i < n.length; i++) {
      if (t[i] <= now) {
        try {
          n[i].disconnect();
        } catch {
          /* already disconnected */
        }
      } else {
        n[w] = n[i];
        t[w] = t[i];
        w++;
      }
    }
    n.length = w;
    t.length = w;
  }

  /** disconnect everything immediately (context teardown) */
  flush(): void {
    this.sweep(Infinity);
  }

  get size(): number {
    return this.nodes.length;
  }
}

export class SampleBank {
  private map = new Map<string, AudioBuffer[]>();
  /** offline rendering unavailable: callers fall back to live synthesis */
  unsupported = false;
  private building = false;
  /** total bytes of rendered PCM (diagnostics) */
  bytes = 0;

  get(key: string): AudioBuffer[] | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get count(): number {
    return this.map.size;
  }

  /**
   * Render all jobs, `parallel` at a time, in the given order (put the sounds
   * needed first at the front). Resolves when everything is done.
   */
  async build(ref: BaseAudioContext, jobs: RenderJob[], parallel = 4): Promise<void> {
    if (this.building) return;
    this.building = true;
    const OC = offlineCtor();
    if (!OC) {
      this.unsupported = true;
      return;
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (this.map.has(job.key)) continue;
        try {
          const bufs = await this.renderJob(OC, ref, job);
          this.map.set(job.key, bufs);
        } catch (err) {
          // a failing recipe must never break the game; it simply stays silent
          console.warn("[audio] render failed", job.key, err);
        }
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < parallel; i++) workers.push(worker());
    await Promise.all(workers);
  }

  private async renderJob(
    OC: new (ch: number, len: number, rate: number) => OfflineAudioContext,
    ref: BaseAudioContext,
    job: RenderJob,
  ): Promise<AudioBuffer[]> {
    const rec = job.recipe;
    const rate = rec.rate ?? 32000;
    const n = rec.variants ?? 1;
    const out: AudioBuffer[] = [];
    const seed = hashKey(job.key);
    for (let k = 0; k < n; k++) {
      const oc = new OC(1, Math.ceil(rec.dur * rate), rate);
      rec.render({ c: oc, out: oc.destination, t: 0, r: mulberry32(seed + k * 7919) });
      const raw = await renderOffline(oc);
      const buf = finishBuffer(ref, raw, 0.9);
      this.bytes += buf.length * 4;
      out.push(buf);
    }
    return out;
  }
}
