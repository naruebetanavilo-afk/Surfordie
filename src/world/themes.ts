/**
 * World looks ("themes"). A stage names one (`StageDef.theme`); `World`
 * follows the theme of `G.stageId` automatically and `World.setTheme(id)`
 * switches: ground palette/pattern (shader branch `ground`), decor set,
 * fog/background colour, light tint, vignette and the snowfall layer.
 *
 * "meadow" values are the original hand-tuned look: keep them unchanged.
 */
export interface WorldTheme {
  id: string;
  /** ground shader branch (0 = grass checker, 1 = snow checker + frost) */
  ground: number;
  /** haze / background colour the far edge fades into */
  fog: string;
  /** hemisphere light: sky colour, bounce colour, intensity */
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  /** warm key light */
  sun: string;
  sunI: number;
  /** cool fill light (characters only, cancelled on the ground) */
  fill: string;
  fillI: number;
  /** screen vignette tint + strength */
  vignette: string;
  vignetteI: number;
  /** decor set id understood by Decor */
  decor: string;
  /** snowfall layer on/off */
  snow: boolean;
}

export const THEMES: Record<string, WorldTheme> = {
  meadow: {
    id: "meadow",
    ground: 0,
    fog: "#1d3a2a",
    hemiSky: "#cfe6ff",
    hemiGround: "#7a9a52",
    hemi: 1.5,
    sun: "#fff0d2",
    sunI: 2.25,
    fill: "#bcd0ff",
    fillI: 0.8,
    vignette: "#04120c",
    vignetteI: 0.56,
    decor: "meadow",
    snow: false,
  },
  snow: {
    id: "snow",
    ground: 1,
    fog: "#53698c",
    hemiSky: "#d6e6ff",
    hemiGround: "#9aa9c4",
    hemi: 1.45,
    sun: "#fff3e4",
    sunI: 2.1,
    fill: "#b4c8ff",
    fillI: 0.85,
    vignette: "#0a1630",
    vignetteI: 0.5,
    decor: "snow",
    snow: true,
  },
};

export function themeById(id: string): WorldTheme {
  return THEMES[id] ?? THEMES.meadow;
}
