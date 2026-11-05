/**
 * Clock shared by the GPU-animated weapon effects. It only advances while the
 * simulation runs (WeaponSystem.update), so effects freeze with the game on
 * level-up / pause screens instead of silently finishing behind them.
 */
export const vfxClock = { t: 0 };
