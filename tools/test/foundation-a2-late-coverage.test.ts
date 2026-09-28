/** Late CPU engineering coverage. These are not frozen before the A2 outcome. */
import { describe, expect, it } from "vitest";
import { CH, GENOME_CHANNELS, allocState, cellCount, encodeGenome,
  generalistGenome } from "@bl/schema";
import { specConfig } from "@bl/runner";
import type { SourceIdentity } from "../lib/foundation-replay.ts";
import { extractCellPacket } from "../lib/foundation-transplant.ts";
import { prepareV2Start } from "../lib/foundation-serial-v2.ts";
import { selectFirstCopyLinkedTransition, type CopyTransitionFrame,
  type CopyLinkedComponent } from "../lib/foundation-serial-v2-selection.ts";

const source = { runId: "m4/gradient-m3/treatment/seed-1", spec: {
  experiment: "m4", presetId: "gradient-m3", condition: "treatment", seed: 1,
  steps: 1_000_000, censusEvery: 100, deepEvery: 500, checkpointEvery: 0,
} } as SourceIdentity;
const makePacket = (sites: number[]) => {
  const state = allocState(specConfig(source.spec)), n = cellCount(state.cfg);
  const words = encodeGenome(generalistGenome(state.cfg.defaultMu, state.cfg.defaultSigma), 0, 1);
  for (const i of sites) {
    state.cells[CH.B * n + i] = 300;
    for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
  }
  return extractCellPacket(state, sites);
};

describe("A2 late failure-boundary coverage", () => {
  it("rejects two eligible roots from the actual packet preparation before a GPU call", () => {
    const packet = makePacket([128 * 256 + 100, 128 * 256 + 150]);
    expect(() => prepareV2Start(source, 0, "donor", packet))
      .toThrow(/2 eligible step-0 roots/);
  });

  it("keeps the first choice fixed when its actual packet extraction fails", () => {
    const sha = "a".repeat(64);
    const c = (componentIndex: number): CopyLinkedComponent => ({
      componentIndex, cells: 1, mass: 300, initialCopySourceByCell: [0],
      continuousCopyCoverage: "complete", physicalSeparation: "confirmed",
      immediateParentSplit: "not-observed", singleGenotype: true, memberSha256: sha,
    });
    const f = (step: number, component: CopyLinkedComponent): CopyTransitionFrame => ({
      step, currentStateHash: sha, copyMapSha256: sha, separationEvidenceSha256: sha,
      initialSourceCellCount: 1, components: [component],
    });
    const identity = { sourceKey: source.runId, arm: "donor" as const,
      stage: 0 as const, seed: 640020101 };
    const first = selectFirstCopyLinkedTransition(identity, [f(25, c(0))]);
    expect(first.selected?.step).toBe(25);
    const state = allocState(specConfig(source.spec));
    state.step = 25;
    expect(() => extractCellPacket(state, [])).toThrow();
    const later = selectFirstCopyLinkedTransition(identity, [f(25, c(0)), f(50, c(0))]);
    expect(later.selected?.step).toBe(25);
    expect(later.candidates.at(-1)?.disposition).toBe("eligible-after-selection");
  });
});
