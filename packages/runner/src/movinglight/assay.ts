// One block: the same patches in every strategy x placement x schedule world, run and read. A block is the independent unit.
import { buildArm, buildPatches, auditArm, type Patch } from "./arms.ts";
import { coordination, trackOf, type Coordination } from "./coordination.ts";
import { readouts, runArm, windowOf, type Readouts, type Series } from "./observe.ts";
import { PROTOCOL, type Placement, type Protocol, type ScheduleId, type StrategyId } from "./protocol.ts";
import { meridianPath } from "./schedule.ts";

export interface RunSummary {
  strategy: StrategyId;
  placement: Placement;
  readouts: Readouts;
  /** Pre-turn part for the reversed schedule (recorded, never scored for the reversal verdict). */
  pre: Readouts | null;
  coordination: Coordination;
  inputB: number;
  inputE: number;
  inputEnergy: number;
  endHash: string;
  /** Conservation held (residual exactly zero) at every census; runArm throws otherwise. */
  conserved: true;
}

export interface BlockRecord {
  seed: number;
  patchSeed: number;
  patchAudit: { B: number; E: number; problems: string[] };
  /** schedule -> "strategy/placement" -> summary. */
  runs: Record<string, Record<string, RunSummary>>;
  /** Block 0 only: per-census centroid strip for the page. */
  strip: Record<string, { t: number[]; d1000: number[]; B: number[] }> | null;
}

export const key = (s: StrategyId, pl: Placement): string => `${s}/${pl}`;

export function summarize(series: Series, p: Protocol = PROTOCOL): RunSummary {
  const w = windowOf(series.schedule, p);
  const path = meridianPath(series.schedule, p);
  const pre = series.schedule === "reversed" ? readouts(series, { from: p.T0, to: w.from }, p) : null;
  return {
    strategy: series.strategy,
    placement: series.placement,
    readouts: readouts(series, w, p),
    pre,
    coordination: coordination(trackOf(series.censuses, w), path, p),
    inputB: series.inputB,
    inputE: series.inputE,
    inputEnergy: series.inputEnergy,
    endHash: series.endHash,
    conserved: true,
  };
}

const stripOf = (s: Series, p: Protocol) => ({
  t: s.censuses.map((c) => c.t),
  d1000: s.censuses.map((c) => (c.B ? Math.floor((c.sumBd * 1000) / c.B) : 0)),
  B: s.censuses.map((c) => c.B),
});

export interface BlockSpec {
  seed: number;
  patchSeed?: number;
  schedules: readonly ScheduleId[];
  strategies: readonly StrategyId[];
  placements?: readonly Placement[];
  withStrip?: boolean;
}

export function runBlock(spec: BlockSpec, p: Protocol = PROTOCOL): BlockRecord {
  const patchSeed = spec.patchSeed ?? spec.seed;
  const patches: Patch[] = buildPatches(p, patchSeed);
  const problems: string[] = [];
  const runs: BlockRecord["runs"] = {};
  const strip: NonNullable<BlockRecord["strip"]> = {};
  for (const sc of spec.schedules) {
    runs[sc] = {};
    for (const st of spec.strategies)
      for (const pl of spec.placements ?? (["grouped", "dispersed"] as const)) {
        const arm = buildArm(st, pl, sc, spec.seed, patches, p);
        problems.push(...auditArm(arm, patches));
        const series = runArm(arm, { p });
        runs[sc][key(st, pl)] = summarize(series, p);
        if (spec.withStrip) strip[`${sc}/${key(st, pl)}`] = stripOf(series, p);
      }
  }
  return {
    seed: spec.seed,
    patchSeed,
    patchAudit: { B: patches.reduce((a, q) => a + q.B, 0), E: patches.reduce((a, q) => a + q.E, 0), problems },
    runs,
    strip: spec.withStrip ? strip : null,
  };
}
