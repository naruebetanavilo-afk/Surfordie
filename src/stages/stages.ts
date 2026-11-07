import { PHASES, EVENTS, type Phase, type RunEvent } from "../director/timeline";

/**
 * A stage = one 10-minute map: its spawn timeline (phases + scripted events)
 * and the world look. The Director reads the timeline of `G.stageId` on every
 * run start; the world reads `theme` to pick ground colours, decor and fog.
 */
export interface StageDef {
  id: string;
  /** Thai display name */
  name: string;
  /** one-line Thai description for the stage picker */
  desc: string;
  /** accent colour for menus / banners */
  color: string;
  /** world look id understood by the world (ground palette, decor set, fog) */
  theme: string;
  phases: Phase[];
  events: RunEvent[];
  /** stage that must be won once to unlock this one (undefined = always open) */
  requires?: string;
}

export const STAGES: StageDef[] = [
  {
    id: "meadow",
    name: "ทุ่งหญ้าต้องสาป",
    desc: "ทุ่งหญ้าเขียวขจีที่ซอมบี้ตื่นขึ้นจากหลุม",
    color: "#7bd04a",
    theme: "meadow",
    phases: PHASES,
    events: EVENTS,
  },
  {
    id: "snow",
    name: "สุสานหิมะ",
    desc: "ป่าช้าเยือกแข็งกลางพายุหิมะ ฝูงหมาป่าน้ำแข็งและพญาเหมันต์รออยู่",
    color: "#8fd8ff",
    theme: "snow",
    phases: PHASES,
    events: EVENTS,
    requires: "meadow",
  },
];

export function stageById(id: string): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

let dbgStage: string | null | undefined;
/**
 * Debug URL override `?stage=<id>` (only known ids), read once. The Director
 * applies it to `G.stageId` at boot and on every run start, so it wins over
 * the menu's stage choice.
 */
export function debugStageId(): string | null {
  if (dbgStage !== undefined) return dbgStage;
  dbgStage = null;
  try {
    const id = new URLSearchParams(location.search).get("stage");
    if (id && STAGES.some((s) => s.id === id)) dbgStage = id;
  } catch {
    dbgStage = null;
  }
  return dbgStage;
}
