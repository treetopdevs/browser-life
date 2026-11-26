// Test helpers: a short protocol so sim-ref worlds stay cheap, and hand-built states for the observer.
import { CH, G, allocState, cellCount, packLineageLo, type WorldState } from "@bl/schema";
import { PROTOCOL, worldConfig, type Protocol, type ScheduleId } from "../src/movinglight/protocol.ts";

export const SHORT: Protocol = { ...PROTOCOL, T: 96, T0: 32, census: 32 };

/** An empty world with biomass B at the given (x, y, lineage raw id) cells. */
export function handState(schedule: ScheduleId, bodies: { x: number; y: number; raw: number; B?: number }[], p: Protocol = PROTOCOL): WorldState {
  const cfg = worldConfig(8_700_999, schedule, p);
  const s = allocState(cfg);
  const n = cellCount(cfg);
  for (const b of bodies) {
    const i = b.y * p.W + b.x;
    s.cells[CH.B * n + i] = b.B ?? 100;
    s.genome[G.LIN_HI * n + i] = 0;
    s.genome[G.LIN_LO * n + i] = packLineageLo(cfg, b.raw);
  }
  return s;
}
