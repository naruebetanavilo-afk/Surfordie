/**
 * Game flow entry points. Implemented in Game.ts; UI code calls these.
 */
export const Flow = {
  /** start a fresh run with the hero id */
  startRun: (_heroId: string): void => {},
  /** go back to the main menu (abandons the current run) */
  toMenu: (): void => {},
  /** resume simulation after a modal (level-up, chest, pause) closes */
  resume: (): void => {},
  /** pause the simulation and show the pause screen */
  pause: (): void => {},
};
