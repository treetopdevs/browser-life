// Fixed CPU-only polymer-drag possibility probe; no parameter search.
// deno run --allow-read --allow-write tools/construction-drag.ts <new-output-dir>
import {
  b2,
  cellBase,
  cellCount,
  CH,
  encodeCheckpoint,
  FLUX_NAMES,
  genomeFromHex,
  genomeHex,
  ledgerResidual,
  OUT,
  stateHash,
  totalsOf,
  validateState,
  worldW,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { mulShareD, polymerDragShare, RefSim, w1d } from "@bl/sim-ref";
import { constructionWorld } from "./lib/construction.ts";
import { newConstructionOutput, constructionProvenance } from "./lib/construction-provenance.ts";
import { patchTransport, type PatchTransport } from "./lib/construction-transport.ts";

/** Exact B crossing a one-site patch in the NEXT transport step. */
export function sampleBoundPatchTransport(state: WorldState, site: number) {
  const { cfg, cells, step } = state, n = cellCount(cfg), W = worldW(cfg);
  if (cfg.dtQ !== 0 || cfg.motility) throw new Error("bound diagnostic requires zero displacement: dtQ0 and motility false");
  if (!Number.isInteger(site) || site < 0 || site >= n) throw new Error("invalid patch site");
  const x = site % W, y = Math.floor(site / W);
  const lx = x % cfg.tileW, ly = y % cfg.tileH, ox = x - lx, oy = y - ly;
  const hw = 32 + cfg.spread, d2 = 4 * hw * hw;
  let grossIn = 0, grossOut = 0;
  const share = (source: number, dx: number, dy: number) => {
    const offer = mulShareD(cells[CH.B * n + source], w1d(0, dx, hw) * w1d(0, dy, hw), d2);
    return cfg.polymerDrag === true
      ? polymerDragShare(offer, cells[CH.P * n + source], cellBase(cfg.seed, step, source), (dy + 1) * 3 + dx + 1, 0)
      : offer;
  };
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    const neighbour = (oy + (ly + dy + cfg.tileH) % cfg.tileH) * W + ox + (lx + dx + cfg.tileW) % cfg.tileW;
    grossOut += share(site, dx, dy);
    grossIn += share(neighbour, -dx, -dy);
  }
  return { fromStep: step, toStep: step + 1, grossIn, grossOut, netIn: grossIn - grossOut };
}

const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";

export async function runDragPilot(out: string): Promise<void> {
  const witnessPath = "experiments/construction/witness-v1.json";
  const competitorPath = "experiments/construction/selected-competitor-v1.json";
  const witness = JSON.parse(await Deno.readTextFile(witnessPath));
  const selected = JSON.parse(await Deno.readTextFile(competitorPath));
  const builder = genomeFromHex(witness.genomeHex);
  const nonbuilder = { ...builder, weights: builder.weights.slice() };
  nonbuilder.weights[b2(OUT.BUILD)] = 0;
  const strongest = genomeFromHex(selected.genome);
  const base: WorldConfig = {
    ...witness.cfg, ruleVersion: 2, seed: 1, spread: 1, dtQ: 0,
    adhesion: false, motility: false, mutRate: 0,
  };
  interface Arm { name: string; genome: Genome; cfg: WorldConfig; }
  const arms: Arm[] = [];
  for (const drag of [true, false]) for (const gate of [true, false]) arms.push({
    name: `builder-drag-${drag ? "on" : "off"}-gate-${gate ? "on" : "off"}`,
    genome: builder, cfg: { ...base, polymerDrag: drag, polymerTransport: gate },
  });
  arms.push(
    { name: "matched-nonbuilder", genome: nonbuilder, cfg: { ...base, polymerDrag: true, polymerTransport: true } },
    { name: "selected-simple-nonbuilder", genome: strongest, cfg: { ...base, polymerDrag: true, polymerTransport: true } },
  );
  const placement = witness.initialization.placement;
  const horizons = [3000, 10000], censusEvery = 100;
  const initialStates = arms.map((arm) => constructionWorld(arm.cfg, [{
    x: placement.x, y: placement.y, biomass: placement.biomass, energy: placement.energy, genome: arm.genome,
  }]));
  const initialCells = initialStates[0].cells;
  for (const state of initialStates) {
    if (!state.cells.every((v, i) => v === initialCells[i])) throw new Error("initial resource arrays differ");
    if (validateState(state).length) throw new Error("invalid initial state");
  }
  await newConstructionOutput(out);
  const sourceSha256 = await constructionProvenance([
    "tools/construction-drag.ts", "packages/sim-gpu/src/shaders.ts", "packages/schema/src/accounting.ts",
    "packages/schema/src/checkpoint.ts", witnessPath, competitorPath,
  ]);
  for (const [path, expected] of Object.entries(sourceSha256)) {
    const bytes = await Deno.readFile(path);
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    if (actual !== expected) throw new Error(`source changed while taking snapshot: ${path}`);
    const destination = `${out}/sources/${path}`;
    await Deno.mkdir(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(destination, bytes, { createNew: true });
  }
  await Deno.writeTextFile(`${out}/manifest.json`, json({
    phase: "exploratory fixed polymerDrag pilot", backend: "CPU RefSim", createdAt: new Date().toISOString(),
    seeds: [1], horizons, censusEvery, sourceSha256, witnessPath, competitorPath,
    initial: { placement, otherMatterAndEnergy: 0, polymer: 0, totals: totalsOf(base, initialCells) },
    arms: arms.map((arm, i) => ({ name: arm.name, cfg: arm.cfg, genome: genomeHex(arm.genome), initialHash: stateHash(initialStates[i]) })),
    interpretation: "Constructed finite-horizon possibility only. No tuning, mutation, evolution, reproduction, second-opportunity or indefinite-persistence claim.",
    comparatorScope: "Selected strongest of the recorded 103-controller stationary search; not a new optimality claim in this changed ecology.",
    measurements: "Active B and integrated B exclude P; exact cumulative A/C flux across original site. Occupied cells, external B and their maxima are sampled every100steps. B transport is calculated from each census step's incoming state and records that executed transport only, not an integrated estimate.",
    plannedDecision: "Require active-B and integrated-B advantage over both nonbuilders with construction expenditure paid. Inspect drag and gate ablations separately: direct mechanical and dissolved-retention benefits must not be conflated. A negative pilot stops this experiment; a clean positive motivates a separately frozen fresh-seed confirmation, never launches it automatically.",
  }), { createNew: true });
  const summary: unknown[] = [];
  for (let ai = 0; ai < arms.length; ai++) {
    const arm = arms[ai], initial = initialStates[ai], start = totalsOf(arm.cfg, initial.cells);
    const sim = new RefSim(initial), n = cellCount(arm.cfg), site = placement.y * worldW(arm.cfg) + placement.x;
    const mask = new Uint8Array(n); mask[site] = 1;
    const transport: PatchTransport = { A: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 }, C: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 } };
    let biomassArea = 0, sampledOccupiedPeak = 0, sampledExternalBPeak = 0, mutations = 0;
    await Deno.writeFile(`${out}/${arm.name}-initial.blck`, encodeCheckpoint(initial), { createNew: true });
    function measure(boundTransport: ReturnType<typeof sampleBoundPatchTransport> | null) {
      const totals = totalsOf(arm.cfg, sim.state.cells);
      if (totals.matter !== start.matter || ledgerResidual(start, sim.state) !== 0n) throw new Error(`ledger failure in ${arm.name}`);
      const errors = validateState(sim.state);
      if (errors.length) throw new Error(errors.join("; "));
      let occupied = 0, externalB = 0, maxCellB = 0;
      for (let i = 0; i < n; i++) {
        const B = sim.state.cells[CH.B * n + i];
        if (B > 0) occupied++;
        if (i !== site) externalB += B;
        maxCellB = Math.max(maxCellB, B);
      }
      sampledOccupiedPeak = Math.max(sampledOccupiedPeak, occupied);
      sampledExternalBPeak = Math.max(sampledExternalBPeak, externalB);
      const buildQuanta = sim.state.flux[FLUX_NAMES.indexOf("build")];
      return {
        step: sim.state.step, totals, activeB: Number(totals.B), biomassArea, occupied, externalB, maxCellB,
        sampledOccupiedPeak, sampledExternalBPeak, boundTransportSample: boundTransport,
        transport: structuredClone(transport), flux: Object.fromEntries(FLUX_NAMES.map((name, i) => [name, sim.state.flux[i]])),
        buildBiomassCost: buildQuanta, buildFreeEnergyCost: buildQuanta * BigInt(arm.cfg.eP - arm.cfg.eB),
        lightIn: sim.state.lightIn, heatOut: sim.state.heatOut, matterResidual: "0", energyResidual: "0",
      };
    }
    const trace = [measure(null)], endpoints = [];
    const began = performance.now();
    for (let t = 0; t < horizons.at(-1)!; t++) {
      const sample = (sim.state.step + 1) % censusEvery === 0;
      const boundTransport = sample ? sampleBoundPatchTransport(sim.state, site) : null;
      const f = patchTransport(sim.state, mask);
      for (const sp of ["A", "C"] as const) for (const key of ["grossIn", "grossOut", "netIn", "internal"] as const) transport[sp][key] += f[sp][key];
      mutations += sim.step().events.length;
      for (let i = 0; i < n; i++) biomassArea += sim.state.cells[CH.B * n + i];
      if (sample) {
        const row = measure(boundTransport); trace.push(row);
        if (horizons.includes(sim.state.step)) {
          const checkpoint = `${arm.name}-step-${sim.state.step}.blck`;
          await Deno.writeFile(`${out}/${checkpoint}`, encodeCheckpoint(sim.state), { createNew: true });
          const endpoint = { ...row, checkpoint, hash: stateHash(sim.state) };
          endpoints.push(endpoint);
          console.log(JSON.stringify({ arm: arm.name, step: sim.state.step, B: row.activeB, P: String(row.totals.P), externalB: row.externalB, biomassArea, buildQuanta: String(row.buildBiomassCost) }));
        }
      }
    }
    if (mutations) throw new Error("unexpected mutation");
    const result = { name: arm.name, cfg: arm.cfg, genome: genomeHex(arm.genome), initial: start, mutations, endpoints, elapsedMs: performance.now() - began };
    await Deno.writeTextFile(`${out}/${arm.name}.json`, json({ result, trace }), { createNew: true });
    summary.push(result);
    await Deno.writeTextFile(`${out}/summary.json`, json(summary));
  }
}

if (import.meta.main) {
  if (Deno.args.length !== 1) throw new Error("provide one new output directory");
  await runDragPilot(Deno.args[0]);
}
