/** Bounded local CPU feasibility run; records no biological contact claim. */
import { CH, FLUX_NAMES, G, GENOME_CHANNELS, allocState, cellCount, cloneState,
  defaultConfig, encodeGenome, generalistGenome, type FluxName } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { boundStep, globalBound, initialBoundCohort, regionBound, type CellFlux } from
  "./lib/reset-material-bounds-v1.ts";
import { initialTokenCohort, reactTokenCohort, tokenTotal, transportTokenCohort } from
  "./lib/reset-material-token-oracle-v1.ts";

const fixtureName = Deno.args[0] === "passive" ? "stress" :
  Deno.args[0] === "mutation" ? "mutation" : "active";
const fixture = JSON.parse(await Deno.readTextFile(new URL(
  `./fixtures/reset-material-bounds-${fixtureName}-v1.json`, import.meta.url)));
const instrumentedModule = await import(new URL(
  "../runs/foundational-reset/material-bounds-feasibility-v1/ref-step.instrumented.ts", import.meta.url).href);
const DiagnosticRefSim = instrumentedModule.RefSim as typeof RefSim;
const cfg = defaultConfig({ seed: fixture.seed, tileW: fixture.tileW, tileH: fixture.tileH,
  tilesX: 1, tilesY: 1, kernelRadius: fixture.kernelRadius,
  mutRate: fixture.mutRate ?? defaultConfig().mutRate });
const start = allocState(cfg), n = cellCount(cfg);
for (let i = 0; i < n; i++) start.cells[CH.A * n + i] = fixture.nutrientPerSite;
for (const [i, q] of fixture.initialB) {
  start.cells[CH.B * n + i] = q;
  start.cells[CH.E * n + i] = 1000;
  if (fixture.genome === "generalist") {
    const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
    for (let g = 0; g < GENOME_CHANNELS; g++) start.genome[g * n + i] = words[g];
  } else start.genome[G.LIN_LO * n + i] = 1;
}
for (const [i, q] of fixture.initialP) start.cells[CH.P * n + i] = q;
const sim = new DiagnosticRefSim(cloneState(start)), twin = new RefSim(cloneState(start));
let cohort = initialBoundCohort(start, new Set<number>(fixture.selectedSites));
let oldFirst = initialTokenCohort(start, new Set<number>(fixture.selectedSites));
let freshFirst = initialTokenCohort(start, new Set<number>(fixture.selectedSites));
let regionRetain = initialTokenCohort(start, new Set<number>(fixture.selectedSites));
let regionRetainB = initialTokenCohort(start, new Set<number>(fixture.selectedSites));
let regionReplace = initialTokenCohort(start, new Set<number>(fixture.selectedSites));
const selectedSites = new Set<number>(fixture.selectedSites);
const initialTaggedBound = globalBound(cohort).hi;
const rows: unknown[] = [];
const diagnostics = sim as unknown as { diagnosticDisplacement: Uint32Array;
  diagnosticTransportedCells: Uint32Array; diagnosticTransportedGenome: Uint32Array;
  diagnosticLocalFlux: Uint32Array };
const same = (a: Uint32Array, b: Uint32Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
let mutationEvents = 0;
for (let t = 1; t <= fixture.contactSteps + fixture.recoverySteps; t++) {
  const before = cloneState(sim.state);
  const actual = sim.step();
  const baseline = twin.step();
  mutationEvents += actual.events.length;
  const transported = { cfg, step: before.step,
    cells: diagnostics.diagnosticTransportedCells,
    genomeHead: diagnostics.diagnosticTransportedGenome.subarray(0, 4 * n) };
  if (sim.state.step !== twin.state.step || !same(sim.state.cells, twin.state.cells) ||
      !same(sim.state.genome, twin.state.genome) ||
      sim.state.lightIn !== twin.state.lightIn || sim.state.heatOut !== twin.state.heatOut ||
      JSON.stringify(sim.state.flux.map(String)) !== JSON.stringify(twin.state.flux.map(String)) ||
      JSON.stringify(actual.events) !== JSON.stringify(baseline.events))
    throw new Error(`label/no-label physical mismatch at step ${t}`);
  const flux: CellFlux[] = Array.from({ length: n }, (_, i) => {
    const row = {} as CellFlux;
    FLUX_NAMES.forEach((k: FluxName, j: number) => {
      row[k] = diagnostics.diagnosticLocalFlux[i * FLUX_NAMES.length + j];
    });
    return row;
  });
  const observed = boundStep(before, diagnostics.diagnosticDisplacement,
    transported, sim.state, cohort, flux);
  cohort = observed.cohort;
  oldFirst = reactTokenCohort(transported,
    transportTokenCohort(before, diagnostics.diagnosticDisplacement, oldFirst, "old-first"),
    flux, "old-first");
  freshFirst = reactTokenCohort(transported,
    transportTokenCohort(before, diagnostics.diagnosticDisplacement, freshFirst, "fresh-first"),
    flux, "fresh-first");
  regionRetain = reactTokenCohort(transported,
    transportTokenCohort(before, diagnostics.diagnosticDisplacement,
      regionRetain, "old-first", selectedSites), flux, "fresh-first");
  regionRetainB = reactTokenCohort(transported,
    transportTokenCohort(before, diagnostics.diagnosticDisplacement,
      regionRetainB, "old-first", selectedSites), flux, "fresh-first", "fresh-first");
  regionReplace = reactTokenCohort(transported,
    transportTokenCohort(before, diagnostics.diagnosticDisplacement,
      regionReplace, "fresh-first", selectedSites), flux, "old-first");
  for (let i = 0; i < n; i++) for (const oracle of
    [oldFirst, freshFirst, regionRetain, regionRetainB, regionReplace]) {
    if (oracle.B[i] < cohort.B[i].lo || oracle.B[i] > cohort.B[i].hi ||
        oracle.P[i] < cohort.P[i].lo || oracle.P[i] > cohort.P[i].hi)
      throw new Error(`interval excluded valid token allocation at step ${t}, site ${i}`);
  }
  for (const oracle of [oldFirst, freshFirst, regionRetain, regionRetainB, regionReplace]) {
    const total = tokenTotal(oracle), bound = globalBound(cohort);
    if (total < bound.lo || total > bound.hi)
      throw new Error(`global interval excluded valid token allocation at step ${t}`);
    const selected = tokenTotal(oracle, selectedSites), region = regionBound(cohort, selectedSites);
    if (selected < region.lo || selected > region.hi)
      throw new Error(`regional interval excluded valid token allocation at step ${t}`);
  }
  if ([1, 10, fixture.contactSteps, 1000, fixture.contactSteps + fixture.recoverySteps].includes(t)) {
    const boundNow = sim.state.cells.reduce((sum, q, idx) => {
      const ch = Math.floor(idx / n); return sum + (ch === CH.B || ch === CH.P ? q : 0);
    }, 0);
    const selectedNow = fixture.selectedSites.reduce((sum: number, i: number) => sum +
      sim.state.cells[CH.B * n + i] + sim.state.cells[CH.P * n + i], 0);
    const global = globalBound(cohort), selectedRegion = regionBound(cohort,
      new Set<number>(fixture.selectedSites));
    rows.push({ step: t, global, selectedRegion,
      possibleTokenTotals: { oldFirst: tokenTotal(oldFirst), freshFirst: tokenTotal(freshFirst),
        regionRetain: tokenTotal(regionRetain), regionRetainB: tokenTotal(regionRetainB),
        regionReplace: tokenTotal(regionReplace) },
      possibleSelectedTokens: { oldFirst: tokenTotal(oldFirst, new Set<number>(fixture.selectedSites)),
        freshFirst: tokenTotal(freshFirst, selectedSites),
        regionRetain: tokenTotal(regionRetain, selectedSites),
        regionRetainB: tokenTotal(regionRetainB, selectedSites),
        regionReplace: tokenTotal(regionReplace, selectedSites) },
      totalBoundNow: boundNow,
      selectedBoundNow: selectedNow, initialTaggedBound,
      globalSurvivalFraction: { lo: global.lo / initialTaggedBound,
        hi: global.hi / initialTaggedBound },
      selectedRetainedFraction: selectedNow === 0 ? null :
        { lo: selectedRegion.lo / selectedNow, hi: selectedRegion.hi / selectedNow },
      localWitness: observed.witness });
  }
}
if (fixture.requireMutation && mutationEvents === 0)
  throw new Error("forced mutation control produced no actual mutations");
console.log(JSON.stringify({ fixture: `reset-material-bounds-${fixtureName}-v1`, rows,
  physicalParity: "exact-every-step-including-events", reactionExtentAvailability: "diagnostic-reference-copy",
  mutationEvents,
  interpretation: "continuously-bound-material-only; organization-unmeasured" }, null, 2));
