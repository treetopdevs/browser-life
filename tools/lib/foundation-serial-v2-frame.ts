/** Builds a conservative census certificate; a runner must authenticate the continuous twin trace. */
import { createHash } from "node:crypto";
import { G, GENOME_CHANNELS, canonicalConfig, cellCount, stateHash, validateState,
  type WorldState } from "@bl/schema";
import { census, DEFAULT_CENSUS } from "@bl/metrics";
import { assertColorTwinParity, type SourceColor } from "./foundation-copy-ancestry.ts";
import type { CopyTransitionFrame, CopyLinkedComponent } from "./foundation-serial-v2-selection.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const label = (hi: number, lo: number) => `${hi}:${lo}`;

/**
 * A conservative physical-separation rule: from one prior detected component to
 * two or more current components, the unique maximal same-site overlap remains
 * the incumbent; other copy-linked components are newly separate. Tied or
 * zero overlap, or a multi-component prior census, is ambiguous. This does not
 * assert an immediate genetic parent or require a surviving root identity.
 */
export function buildSerialV2Frame(priorColored: WorldState, currentColored: WorldState,
  originalCurrent: WorldState, colors: readonly SourceColor[],
  coverage: { throughStep: number; parityTranscriptSha256: string }): CopyTransitionFrame {
  if (currentColored.step < 25 || currentColored.step > 1000 || currentColored.step % 25 !== 0 ||
      priorColored.step !== currentColored.step - 25 ||
      coverage.throughStep < currentColored.step ||
      !/^[a-f0-9]{64}$/.test(coverage.parityTranscriptSha256) ||
      currentColored.cfg.mutRate !== 0 ||
      canonicalConfig(priorColored.cfg) !== canonicalConfig(currentColored.cfg) ||
      validateState(priorColored).length || validateState(currentColored).length)
    throw new Error("A2 frame requires authenticated continuous coverage and adjacent censuses");
  assertColorTwinParity(originalCurrent, currentColored);
  const n = cellCount(currentColored.cfg);
  if (priorColored.cells.length !== currentColored.cells.length || colors.length < 1)
    throw new Error("A2 frame geometry or source-color mapping missing");
  const previous = census({ cfg: priorColored.cfg, step: priorColored.step, cells: priorColored.cells,
    genomeHead: priorColored.genome.subarray(0, 4 * n) }, DEFAULT_CENSUS);
  const current = census({ cfg: currentColored.cfg, step: currentColored.step, cells: currentColored.cells,
    genomeHead: currentColored.genome.subarray(0, 4 * n) }, DEFAULT_CENSUS);
  const sourceByColor = new Map(colors.map((x) => [x.color, x.sourceIndex]));
  if (sourceByColor.size !== colors.length ||
      colors.some((x) => x.sourceIndex < 0 || x.sourceIndex >= n))
    throw new Error("A2 frame has duplicate/out-of-range source colors");
  const members = current.components.map(() => [] as number[]);
  for (let i = 0; i < n; i++) if (current.labels[i] >= 0) members[current.labels[i]].push(i);
  const sources = members.map((sites) => sites.map((i) => sourceByColor.get(label(
    currentColored.genome[G.LIN_HI * n + i], currentColored.genome[G.LIN_LO * n + i])) ?? -1));
  const overlaps = current.components.map(() => new Map<number, number>());
  for (let i = 0; i < n; i++) {
    const now = current.labels[i], before = previous.labels[i];
    if (now >= 0 && before >= 0)
      overlaps[now].set(before, (overlaps[now].get(before) ?? 0) + 1);
  }
  const allLinked = sources.map((row) => row.length > 0 && row.every((x) => x >= 0));
  const priorLinked = previous.components.map((c) => {
    let all = true;
    for (let i = 0; i < n; i++) if (previous.labels[i] === c.idx &&
        !sourceByColor.has(label(priorColored.genome[G.LIN_HI * n + i],
          priorColored.genome[G.LIN_LO * n + i]))) all = false;
    return all;
  });
  let incumbent: number | null = null, separationAmbiguous = false;
  if (previous.components.length === 1 && priorLinked[0] && allLinked.filter(Boolean).length >= 2) {
    const priorIdx = priorLinked.findIndex(Boolean);
    const ranked = current.components.filter((c) => allLinked[c.idx])
      .map((c) => ({ idx: c.idx, overlap: overlaps[c.idx].get(priorIdx) ?? 0 }))
      .sort((a, b) => b.overlap - a.overlap || a.idx - b.idx);
    if (ranked[0].overlap > 0 && ranked[0].overlap > ranked[1].overlap) incumbent = ranked[0].idx;
    else separationAmbiguous = true;
  } else if (allLinked.filter(Boolean).length > 1) separationAmbiguous = true;
  const components: CopyLinkedComponent[] = current.components.map((c) => {
    const sites = members[c.idx], first = sites[0];
    let sameGenome = true;
    for (const i of sites) for (let g = 2; g < GENOME_CHANNELS; g++)
      if (currentColored.genome[g * n + i] !== currentColored.genome[g * n + first])
        sameGenome = false;
    return { componentIndex: c.idx, cells: c.cells, mass: c.mass,
      initialCopySourceByCell: sources[c.idx],
      continuousCopyCoverage: allLinked[c.idx] ? "complete" : "unavailable",
      physicalSeparation: incumbent !== null && c.idx !== incumbent && allLinked[c.idx] ?
        "confirmed" : separationAmbiguous ? "ambiguous" : "not-separate",
      immediateParentSplit: "not-observed", singleGenotype: sameGenome,
      memberSha256: sha(sites.join(",")) };
  });
  return { step: current.step, currentStateHash: sha(stateHash(originalCurrent)),
    copyMapSha256: sha(JSON.stringify({ colors, sources, coverage })),
    separationEvidenceSha256: sha(JSON.stringify({ prior: stateHash(priorColored),
      current: stateHash(currentColored), previousComponents: previous.components.map((c) => c.mass),
      currentComponents: current.components.map((c) => c.mass), overlaps: overlaps.map((m) => [...m]) })),
    initialSourceCellCount: n, components };
}
