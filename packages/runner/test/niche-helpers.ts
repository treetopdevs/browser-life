// Test helpers: re-exports and the matched-control probes used by niche-arms.test.ts.
import { CH, type WorldState } from "@bl/schema";
import { matchedControls, receiverAlone, type PreArm } from "../src/niche/arms.ts";
import { GIFT, regionCellsExcludingFootprint, uniformBudget, type GiftVariant } from "../src/niche/fixtures.ts";
import type { Protocol } from "../src/niche/protocol.ts";
import { audited, cloneAudit, cloneState, debitEven } from "../src/niche/transfer.ts";
import { outsideRegion } from "../src/niche/arms.ts";

export { cloneAudit, cloneState, permutation, scrambleChannels } from "../src/niche/transfer.ts";

const addTo = (s: WorldState, ch: number, cells: readonly number[], total: number): void => {
  const n = s.cells.length / 7;
  const m = cells.length, base = Math.floor(total / m), rem = total % m;
  cells.forEach((i, j) => (s.cells[ch * n + i] += base + (j < rem ? 1 : 0)));
};

export function matchedControlsProbe(kind: GiftVariant | "detritus", p: Protocol): ReturnType<typeof matchedControls> & { d0: PreArm } {
  const d0 = receiverAlone({ audit: uniformBudget(p) }, 1, p);
  const b: PreArm = { id: "b", state: cloneState(d0.state), audit: cloneAudit(d0.audit), records: [] };
  const ring = regionCellsExcludingFootprint(p);
  if (kind === "detritus") {
    audited("detritus", b.state, b.audit, () => {
      debitEven(b.state, CH.A, 200, ring);
      addTo(b.state, CH.B, ring, 200);
      debitEven(b.state, CH.E, (b.state.cfg.eB - b.state.cfg.eA) * 200, outsideRegion(p));
      return {};
    });
  } else {
    addTo(b.state, CH.E, ring, GIFT.annulus);
    b.audit.energyStart += BigInt(GIFT.annulus);
  }
  return { ...matchedControls(b, d0, p), d0 };
}
