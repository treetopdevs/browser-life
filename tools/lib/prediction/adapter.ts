// A tool-local CPU intervention adapter (PLAN.md, section 6). `RefSim` is not an `InterventionSim`, and the runner's CPU adapter is
// private, so this mirrors it on a deep clone of a WorldState: advance to a step, apply one scheduled operation with the reference
// `applyLesion` / `applyFeed`, advance again. It logs each application (requested vs delivered matter) and books matter and
// energy the way the runner does, so each arm can be checked: energy by `ledgerResidual == 0`, matter by delivered feed (a lesion
// converts matter in place and moves none).
import { clampLesionRadius, cloneState, ledgerResidual, totalsOf, FeedRefusedError, applyFeed, type WorldState } from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";
import type { ScheduledIntervention } from "@bl/runner";

export interface AppliedLog {
  step: number;
  kind: "lesion" | "feed";
  requestedAmount: number | null;
  deliveredMatter: number;
  radius: number;
  refused: string | null;
}

export class CpuInterventionAdapter {
  readonly sim: RefSim;
  readonly log: AppliedLog[] = [];
  private fedMatter = 0n;
  private fedEnergy = 0n;
  private readonly startMatter: bigint;
  private readonly startEnergy: bigint;

  /** `source` is cloned; `startTotals` are the totals of the world's step-0 state (the ledger's baseline), not the fork's. */
  constructor(source: WorldState, startTotals: { matter: bigint; energy: bigint }) {
    this.sim = new RefSim(cloneState(source));
    this.startMatter = startTotals.matter;
    this.startEnergy = startTotals.energy;
  }

  get state(): WorldState {
    return this.sim.state;
  }

  advanceTo(step: number): void {
    const s = this.sim.state;
    if (step < s.step) throw new Error(`cannot go back from step ${s.step} to ${step}`);
    this.sim.run(step - s.step);
  }

  apply(e: ScheduledIntervention): AppliedLog {
    if (e.step !== this.sim.state.step) throw new Error(`scheduled for step ${e.step}, world is at ${this.sim.state.step}`);
    if (e.kind === "sun") throw new Error("sun is not on the prediction menu");
    if (e.kind === "lesion") {
      applyLesion(this.sim, e.x, e.y, e.r);
      const line: AppliedLog = { step: e.step, kind: "lesion", requestedAmount: null, deliveredMatter: 0, radius: clampLesionRadius(this.sim.cfg, e.r), refused: null };
      this.log.push(line);
      return line;
    }
    try {
      const res = applyFeed(this.sim.state, e.x, e.y, e.r, e.amount);
      this.fedMatter += BigInt(res.matter);
      this.fedEnergy += res.energy;
      const line: AppliedLog = { step: e.step, kind: "feed", requestedAmount: e.amount, deliveredMatter: res.matter, radius: res.radius, refused: null };
      this.log.push(line);
      return line;
    } catch (err) {
      if (!(err instanceof FeedRefusedError)) throw err;
      const line: AppliedLog = { step: e.step, kind: "feed", requestedAmount: e.amount, deliveredMatter: 0, radius: e.r, refused: err.message };
      this.log.push(line);
      return line;
    }
  }

  /** Energy residual against the step-0 baseline moved by the fed energy: exactly 0n when the rules and the books agree. */
  energyResidual(): bigint {
    return ledgerResidual({ energy: this.startEnergy + this.fedEnergy }, this.sim.state);
  }

  /** Matter now minus (matter at step 0 + delivered feed): exactly 0n when matter is closed apart from the logged feeds. */
  matterResidual(): bigint {
    return totalsOf(this.sim.cfg, this.sim.state.cells).matter - (this.startMatter + this.fedMatter);
  }
}
