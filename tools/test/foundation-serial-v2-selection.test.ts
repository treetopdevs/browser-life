import { describe, expect, it } from "vitest";
import { selectFirstCopyLinkedTransition, validateSavedV2Selection, type CopyTransitionFrame,
  type CopyLinkedComponent } from "../lib/foundation-serial-v2-selection.ts";
import { CH, G, GENOME_CHANNELS, allocState, cellCount, cloneState, defaultConfig,
  encodeGenome, generalistGenome } from "@bl/schema";
import { buildSerialV2Frame } from "../lib/foundation-serial-v2-frame.ts";
import { V2ParityTranscript } from "../lib/foundation-serial-v2-parity.ts";

const sha = "a".repeat(64);
const identity = { sourceKey: "source-1", arm: "donor" as const, stage: 0 as const, seed: 640020001 };
const component = (componentIndex: number, change: Partial<CopyLinkedComponent> = {}): CopyLinkedComponent => ({
  componentIndex, cells: 2, mass: 300, initialCopySourceByCell: [0, 1],
  continuousCopyCoverage: "complete", physicalSeparation: "confirmed",
  immediateParentSplit: "not-observed", singleGenotype: true, memberSha256: sha, ...change,
});
const frame = (step: number, components: CopyLinkedComponent[] = []): CopyTransitionFrame => ({
  step, currentStateHash: sha, copyMapSha256: sha, separationEvidenceSha256: sha,
  initialSourceCellCount: 2, components,
});

describe("A2 fixed first copy-linked packet selection", () => {
  it("selects the earliest separate descendant without requiring root persistence or immediate-parent fission", () => {
    const result = selectFirstCopyLinkedTransition(identity, [
      frame(25, [component(0, { physicalSeparation: "not-separate" })]),
      frame(50, [component(0, { physicalSeparation: "not-separate" }), component(1)]),
      frame(75, [component(0), component(1)]),
    ]);
    expect(result.status).toBe("selected");
    expect(result.selected).toMatchObject({ step: 50, componentIndex: 1,
      immediateParentSplit: "not-observed" });
    expect(result.candidates.find((x) => x.step === 75 && x.componentIndex === 0)?.disposition)
      .toBe("eligible-after-selection");
  });

  it("uses a frozen hash tie at the first eligible step, independent of array order and later success", () => {
    const both = [component(0), component(1)];
    const a = selectFirstCopyLinkedTransition(identity, [frame(25, both)]);
    const b = selectFirstCopyLinkedTransition(identity, [frame(25, [...both].reverse())]);
    expect(a.selected?.componentIndex).toBe(b.selected?.componentIndex);
    expect(a.selected?.selectionSha256).toBe(b.selected?.selectionSha256);
    expect(a.selected?.disposition).toBe("selected");
    // There is no extraction or viability input to this selector: a failed chosen packet cannot be replaced.
    expect(Object.keys(a.selected ?? {})).not.toContain("packetValid");
  });

  it("retains ambiguous, mixed, below-mass and uncovered components without substitute selection", () => {
    const rows = [
      component(0, { physicalSeparation: "ambiguous" }),
      component(1, { initialCopySourceByCell: [0, -1], continuousCopyCoverage: "unavailable" }),
      component(2, { mass: 255 }),
      component(3, { singleGenotype: false }),
    ];
    const result = selectFirstCopyLinkedTransition(identity, [frame(25, rows)]);
    expect(result.status).toBe("pending");
    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.map((x) => x.rejectionReasons)).toEqual([
      ["physical-separation-ambiguous"], ["continuous-copy-link-unavailable"],
      ["below-minimum-mass"], ["mixed-genotype"],
    ]);
  });

  it("rejects missing cadence, incomplete census, out-of-range copy sites and absent hashes", () => {
    expect(() => selectFirstCopyLinkedTransition(identity, [frame(50)])).toThrow(/missing or reordered/);
    expect(() => selectFirstCopyLinkedTransition(identity, [frame(25, [component(1)])]))
      .toThrow(/incomplete/);
    expect(() => selectFirstCopyLinkedTransition(identity, [frame(25,
      [component(0, { initialCopySourceByCell: [0, 2] })])])).toThrow(/outside initial/);
    expect(() => selectFirstCopyLinkedTransition(identity, [{ ...frame(25), copyMapSha256: "" }]))
      .toThrow(/hashes/);
  });

  it("marks a complete forty-census no-event window separately from an incomplete observation", () => {
    const all = Array.from({ length: 40 }, (_, i) => frame((i + 1) * 25,
      [component(0, { physicalSeparation: "not-separate" })]));
    expect(selectFirstCopyLinkedTransition(identity, all).status).toBe("no-eligible-transition");
    expect(selectFirstCopyLinkedTransition(identity, all.slice(0, 39)).status).toBe("pending");
  });

  it("derives physical separation from a one-to-two census without requiring a surviving root label", () => {
    const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
      kernelRadius: 2, mutRate: 0 };
    const prior = allocState(cfg), current = allocState(cfg), n = cellCount(cfg);
    const genome = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
    const paint = (state: typeof prior, i: number, color: number) => {
      state.cells[CH.B * n + i] = 300;
      for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = genome[g];
      state.genome[G.LIN_LO * n + i] = color;
    };
    paint(prior, 1, 1); paint(prior, 2, 2);
    paint(current, 1, 1); paint(current, 5, 2);
    current.step = 25;
    const original = cloneState(current);
    original.genome[G.LIN_LO * n + 1] = 7;
    original.genome[G.LIN_LO * n + 5] = 7;
    const result = buildSerialV2Frame(prior, current, original,
      [{ color: "0:1", sourceIndex: 1, originalLineage: "0:7" },
        { color: "0:2", sourceIndex: 2, originalLineage: "0:7" }],
      { throughStep: 25, parityTranscriptSha256: sha });
    expect(result.components.map((c) => c.physicalSeparation)).toEqual(["not-separate", "confirmed"]);
    expect(selectFirstCopyLinkedTransition(identity, [result]).selected?.componentIndex).toBe(1);
    expect(result.components[1].immediateParentSplit).toBe("not-observed");
  });

  it("does not call a translated singleton or overlap-tied split a recruitable packet", () => {
    const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
      kernelRadius: 2, mutRate: 0 };
    const n = cellCount(cfg), words = encodeGenome(
      generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
    const make = (step: number, sites: number[]) => {
      const s = allocState(cfg); s.step = step;
      for (const [k, i] of sites.entries()) {
        s.cells[CH.B * n + i] = 300;
        for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = words[g];
        s.genome[G.LIN_LO * n + i] = k + 1;
      }
      return s;
    };
    const colors = [{ color: "0:1", sourceIndex: 1, originalLineage: "0:7" },
      { color: "0:2", sourceIndex: 2, originalLineage: "0:7" }];
    const original = (colored: ReturnType<typeof make>) => {
      const s = cloneState(colored);
      for (const i of [1, 2, 5, 6]) if (s.cells[CH.B * n + i] > 0)
        s.genome[G.LIN_LO * n + i] = 7;
      return s;
    };
    const prior = make(0, [1, 2]);
    const translated = make(25, [5, 6]);
    const singleton = buildSerialV2Frame(prior, translated, original(translated), colors,
      { throughStep: 25, parityTranscriptSha256: sha });
    expect(singleton.components[0].physicalSeparation).toBe("not-separate");
    expect(selectFirstCopyLinkedTransition(identity, [singleton]).selected).toBeNull();
    const splitNoOverlap = make(25, [5, 7]);
    const ambiguous = buildSerialV2Frame(prior, splitNoOverlap, original(splitNoOverlap), colors,
      { throughStep: 25, parityTranscriptSha256: sha });
    expect(ambiguous.components.map((x) => x.physicalSeparation)).toEqual(["ambiguous", "ambiguous"]);
    expect(selectFirstCopyLinkedTransition(identity, [ambiguous]).selected).toBeNull();
    const priorWithUnlinkedSecond = make(0, [1, 5]);
    priorWithUnlinkedSecond.genome[G.LIN_LO * n + 5] = 9;
    const stableTwo = make(25, [1, 5]);
    const noNewPacket = buildSerialV2Frame(priorWithUnlinkedSecond, stableTwo,
      original(stableTwo), colors, { throughStep: 25, parityTranscriptSha256: sha });
    expect(noNewPacket.components.map((x) => x.physicalSeparation))
      .toEqual(["ambiguous", "ambiguous"]);
    expect(selectFirstCopyLinkedTransition(identity, [noNewPacket]).selected).toBeNull();
  });

  it("requires a continuous colored/uncolored physical parity transcript", () => {
    const snap = (step: number, physical = 4) => ({ step,
      cells: new Uint32Array([physical]), genomeHead: new Uint32Array([0, 1, 3, 4]),
      flux: [1n] });
    const trace = new V2ParityTranscript();
    trace.observe(snap(0), snap(0));
    const at0 = trace.snapshot();
    expect(at0.throughStep).toBe(0);
    expect(() => trace.observe(snap(2), snap(2))).toThrow(/exact step 1/);
    expect(() => trace.observe(snap(1), snap(1, 5))).toThrow(/physical mismatch/);
    trace.observe(snap(1), snap(1));
    expect(trace.finish().throughStep).toBe(1);
    expect(() => trace.observe(snap(2), snap(2))).toThrow(/exact step/);
  });

  it("rejects a saved later substitute after a first eligible packet", () => {
    const frames = Array.from({ length: 40 }, (_, i) => frame((i + 1) * 25,
      i < 2 ? [component(0)] : []));
    const saved = selectFirstCopyLinkedTransition(identity, frames);
    expect(() => validateSavedV2Selection(identity, saved, frames)).not.toThrow();
    const forged = JSON.parse(JSON.stringify(saved)) as typeof saved;
    forged.candidates[0].disposition = "eligible-not-selected";
    forged.candidates[1].disposition = "selected";
    forged.selected = forged.candidates[1];
    expect(() => validateSavedV2Selection(identity, forged, frames))
      .toThrow(/first eligible|rejection reasons/);
    const reclassified = JSON.parse(JSON.stringify(saved)) as typeof saved;
    reclassified.candidates[0].rejectionReasons = ["physical-separation-ambiguous"];
    reclassified.candidates[0].disposition = "rejected";
    reclassified.candidates[1].disposition = "selected";
    reclassified.selected = reclassified.candidates[1];
    expect(() => validateSavedV2Selection(identity, reclassified, frames))
      .toThrow(/rejection reasons/);
  });
});
