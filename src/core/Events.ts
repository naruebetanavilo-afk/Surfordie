// Tiny typed event bus for cross-system notifications.
export interface GameEvents {
  /** enemy died. x/z = position, typeId = enemy def id, source = weapon id that killed it */
  enemyKilled: { x: number; z: number; typeId: string; source: string; boss: boolean; elite: boolean };
  /** player took damage */
  playerHurt: { amount: number };
  playerDied: Record<string, never>;
  levelUp: { level: number };
  /** a weapon or passive was gained/upgraded/evolved */
  upgradeApplied: { kind: "weapon" | "passive" | "evolve" | "gold" | "heal"; id: string; level: number };
  bossSpawned: { typeId: string; name: string };
  bossKilled: { typeId: string };
  runStart: Record<string, never>;
  runEnd: { victory: boolean };
  pickup: { kind: string; value: number };
  /** director announcements, e.g. "ฝูงซอมบี้กำลังมา!" */
  announce: { text: string; color?: string };
  /** the hero cast their ultimate */
  ultCast: { id: string; hero: string };
  /**
   * a mission (src/meta/missions.ts) reached its goal. Unlock rewards
   * (`weapon` / `hero` ids) are already applied; `gold` waits for the claim.
   */
  missionComplete: { id: string; name: string; daily: boolean; gold: number; weapon?: string; hero?: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private map = new Map<keyof GameEvents, Handler<any>[]>();
  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let list = this.map.get(type);
    if (!list) this.map.set(type, (list = []));
    list.push(fn);
    return () => {
      const l = this.map.get(type);
      if (l) l.splice(l.indexOf(fn), 1);
    };
  }
  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const list = this.map.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}
