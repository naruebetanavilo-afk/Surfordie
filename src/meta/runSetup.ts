import { G } from "../core/G";
import { Meta } from "../core/Meta";
import { STAGES, type StageDef } from "../stages/stages";
import { CURSE_MAX, clampCurse, curseMods } from "./curse";

/**
 * Run setup: which stage and curse tier the next run uses, the per-stage
 * records (best time, highest tier won) and the unlock rules.
 *
 * - A stage with `requires: X` opens once X was won (any tier) OR the player
 *   survived STAGE_UNLOCK_TIME on X.
 * - Curse tier N+1 on a stage opens after winning tier N on that stage.
 * - The selection lives in Meta (lastStage, curseSel) so "play again" and the
 *   next session reuse it; Game.startRun calls applyRunSetup().
 * - Debug: `?curse=<n>` forces a tier, `?stage=<id>` forces a stage (both
 *   ignore locks).
 */

/** survive this long on the required stage to open the next one (seconds) */
export const STAGE_UNLOCK_TIME = 360;

function param(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

/** `?curse=<n>` debug override, or null */
export function forcedCurse(): number | null {
  const v = param("curse");
  if (v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? clampCurse(n) : null;
}

/** `?stage=<id>` debug override (must name an existing stage), or null */
export function forcedStage(): string | null {
  const v = param("stage");
  return v && STAGES.some((s) => s.id === v) ? v : null;
}

export function stageDef(id: string): StageDef | undefined {
  return STAGES.find((s) => s.id === id);
}

/** the stage was won at least once (any tier) */
export function stageWon(id: string): boolean {
  return Meta.data.curseCleared[id] !== undefined;
}

export function stageBestTime(id: string): number {
  return Meta.data.stageBest[id] ?? 0;
}

export function stageUnlocked(s: StageDef): boolean {
  if (!s.requires) return true;
  return stageWon(s.requires) || stageBestTime(s.requires) >= STAGE_UNLOCK_TIME;
}

export interface StageRequirement {
  /** Thai requirement line */
  text: string;
  /** 0..1 progress towards the survival-time route */
  progress: number;
  /** best time on the required stage (s) */
  best: number;
}

/** what opens a locked stage (null when the stage is open) */
export function stageRequirement(s: StageDef): StageRequirement | null {
  if (!s.requires || stageUnlocked(s)) return null;
  const req = stageDef(s.requires);
  const name = req ? req.name : s.requires;
  const best = stageBestTime(s.requires);
  return {
    text: `ชนะด่าน "${name}" 1 ครั้ง หรือรอดถึง ${Math.floor(STAGE_UNLOCK_TIME / 60)}:00`,
    progress: Math.min(1, best / STAGE_UNLOCK_TIME),
    best,
  };
}

/** highest tier won on a stage, -1 when never won */
export function bestCurse(stageId: string): number {
  const c = Meta.data.curseCleared[stageId];
  return c === undefined ? -1 : clampCurse(c);
}

/** highest tier that can be picked on a stage */
export function maxCurse(stageId: string): number {
  return Math.min(CURSE_MAX, bestCurse(stageId) + 1);
}

/** highest tier won on any stage, -1 when never won */
export function bestCurseAny(): number {
  let best = -1;
  for (const k of Object.keys(Meta.data.curseCleared)) best = Math.max(best, bestCurse(k));
  return best;
}

/** the stage the run setup has selected (falls back to the first open stage) */
export function selectedStage(): StageDef {
  const s = stageDef(Meta.data.lastStage);
  if (s && stageUnlocked(s)) return s;
  return STAGES.find((x) => stageUnlocked(x)) ?? STAGES[0];
}

/** select a stage for the next run; false when it is locked / unknown */
export function selectStage(id: string): boolean {
  const s = stageDef(id);
  if (!s || !stageUnlocked(s)) return false;
  if (Meta.data.lastStage !== id) {
    Meta.data.lastStage = id;
    Meta.save();
  }
  return true;
}

/** curse tier selected for a stage, clamped to what is unlocked there */
export function selectedCurse(stageId = selectedStage().id): number {
  return Math.min(maxCurse(stageId), clampCurse(Meta.data.curseSel[stageId] ?? 0));
}

/** select a tier on a stage; false when it is locked */
export function selectCurse(stageId: string, tier: number): boolean {
  const t = clampCurse(tier);
  if (t > maxCurse(stageId)) return false;
  if (Meta.data.curseSel[stageId] !== t) {
    Meta.data.curseSel[stageId] = t;
    Meta.save();
  }
  return true;
}

/** menu background: G.stageId follows the selection (the world follows G.stageId's theme) */
export function syncMenuStage(): void {
  G.stageId = forcedStage() ?? selectedStage().id;
}

/** set G.stageId / G.curse / G.mods for the run that is about to start */
export function applyRunSetup(): void {
  const stage = forcedStage() ?? selectedStage().id;
  const curse = forcedCurse() ?? selectedCurse(stage);
  G.stageId = stage;
  G.curse = curse;
  G.mods = curseMods(curse);
}

/** what a finished run changed in the stage / curse records */
export interface RunRecord {
  stageId: string;
  curse: number;
  victory: boolean;
  /** won a tier above the previous best on this stage (or the first win there) */
  newBestCurse: boolean;
  /** tier newly opened by this win (0 = none) */
  unlockedCurse: number;
  /** stages opened by this run */
  newStages: StageDef[];
  /** survived longer than ever on this stage (not flagged on the first run there) */
  newBestTime: boolean;
}

/** update the per-stage records at run end (Meta is saved by the caller) */
export function recordRun(victory: boolean, time: number): RunRecord {
  const d = Meta.data;
  const id = G.stageId;
  const curse = clampCurse(G.curse);
  const lockedBefore = STAGES.filter((s) => !stageUnlocked(s));
  const prevMax = maxCurse(id);
  const prevTime = d.stageBest[id];
  d.stageBest[id] = Math.max(prevTime ?? 0, time);
  let newBestCurse = false;
  if (victory) {
    const prev = d.curseCleared[id];
    if (prev === undefined || curse > prev) {
      d.curseCleared[id] = curse;
      newBestCurse = true;
    }
  }
  const nowMax = maxCurse(id);
  return {
    stageId: id,
    curse,
    victory,
    newBestCurse,
    unlockedCurse: nowMax > prevMax ? nowMax : 0,
    newStages: lockedBefore.filter((s) => stageUnlocked(s)),
    newBestTime: prevTime !== undefined && time > prevTime,
  };
}
