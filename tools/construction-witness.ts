// CPU-only possibility assay. Usage: deno run -A tools/construction-witness.ts <phase> <out-dir>
// phases: core, access, neighbours, spread. All outputs are exploratory, never a claim of evolution.
import {
  cellCount,
  CH,
  encodeCheckpoint,
  FLUX_NAMES,
  G,
  type Genome,
  genomeFromHex,
  genomeHex,
  ledgerResidual,
  ROLE_WORDS,
  stateHash,
  totalsOf,
  validateState,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  constructionConfig,
  constructionGenome,
  constructionWorld,
  lineageBiomass,
  type Placement,
} from "./lib/construction.ts";
import { patchTransport } from "./lib/construction-transport.ts";
import {
  constructionProvenance,
  newConstructionOutput,
} from "./lib/construction-provenance.ts";
const [phase = "core", out = `runs/construction/${phase}`, selectedPath] =
  Deno.args;
await newConstructionOutput(out);
const selected = phase === "competitor"
  ? JSON.parse(await Deno.readTextFile(selectedPath))
  : undefined;
const seeds = [101, 102, 103, 104, 105], steps = 3000;
interface Case {
  name: string;
  build: number;
  gate: boolean;
  neighbour?: number;
  mirror?: boolean;
  spread?: number;
  genome?: Genome;
}
const cases: Case[] = phase === "core"
  ? [
    { name: "builder-on", build: 16, gate: true },
    { name: "builder-off", build: 16, gate: false },
    { name: "nonbuilder-on", build: 0, gate: true },
    { name: "nonbuilder-off", build: 0, gate: false },
  ]
  : phase === "competitor"
  ? [{
    name: "selected-competitor",
    build: 0,
    gate: true,
    genome: genomeFromHex(selected.genome),
  }, { name: "builder", build: 16, gate: true }]
  : phase === "access"
  ? [0, 1, 2, 3, 4, 8, 12, 15, 16, 17, 20, 24].map((build) => ({
    name: `build-${build}`,
    build,
    gate: true,
  }))
  : phase === "neighbours"
  ? [1, 2, 4].flatMap((neighbour) =>
    [false, true].flatMap((mirror) =>
      [true, false].map((gate) => ({
        name: `distance-${neighbour}-${mirror ? "mirror" : "normal"}-${
          gate ? "on" : "off"
        }`,
        build: 16,
        gate,
        neighbour,
        mirror,
      }))
    )
  )
  : phase === "spread"
  ? [1, 2, 4].flatMap((spread) =>
    [true, false].flatMap((gate) =>
      [0, 16].map((build) => ({
        name: `spread-${spread}-build-${build}-${gate ? "on" : "off"}`,
        build,
        gate,
        spread,
      }))
    )
  )
  : [];
if (!cases.length) throw new Error(`unknown phase ${phase}`);
const serialize = (x: unknown) =>
  JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
await Deno.writeTextFile(
  `${out}/manifest.json`,
  serialize({
    phase,
    created: new Date().toISOString(),
    sources: await constructionProvenance(),
    selected,
    seeds,
    steps,
    cases,
    genome: genomeHex(constructionGenome({ build: 16 })),
    cfg: constructionConfig(101),
    label:
      "constructed example; mutation disabled; exploratory finite-horizon experiment",
    initial: {
      biomassPerPlacement: 1024,
      energyPerPlacement: 2048,
      polymer: 0,
      nutrient: 0,
      waste: 0,
    },
  }),
);
const rows = [];
for (const c of cases) {
  for (const seed of seeds) {
    const cfg = constructionConfig(seed, {
      ...(c.gate ? {} : { polymerTransport: false }),
      ...(c.spread ? { spread: c.spread } : {}),
    });
    const genome = c.genome ?? constructionGenome({ build: c.build });
    const x = c.mirror ? 16 + (c.neighbour ?? 0) : 16,
      nx = c.mirror ? 16 : 16 + (c.neighbour ?? 0);
    const placements: Placement[] = [{ x, y: 16, genome }];
    if (c.neighbour) {
      placements.push({
        x: nx,
        y: 16,
        genome: constructionGenome({ build: 0 }),
      });
    }
    const initial = constructionWorld(cfg, placements),
      n = cellCount(cfg),
      initialTotals = totalsOf(cfg, initial.cells),
      sim = new RefSim(initial);
    const mask = Array.from({ length: n }, (_, i) => i === 16 * 32 + x),
      transport = {
        A: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
        C: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
      };
    let biomassArea = 0, producerArea = 0, mutations = 0;
    const assimilation: Record<string, number> = {}, trace = [];
    const sample = () => {
      const totals = totalsOf(cfg, sim.state.cells);
      const residual = ledgerResidual(initialTotals, sim.state);
      if (
        totals.matter !== initialTotals.matter || residual !== 0n
      ) throw new Error("conservation failed");
      let occupied = 0, externalB = 0;
      for (let i = 0; i < n; i++) {
        if (sim.state.cells[CH.B * n + i] > 0) occupied++;
        if (!mask[i]) externalB += sim.state.cells[CH.B * n + i];
      }
      return {
        step: sim.state.step,
        totals,
        assignedBiomass: lineageBiomass(sim.state),
        occupied,
        externalB,
        transport: structuredClone(transport),
        assimilation: { ...assimilation },
        flux: Object.fromEntries(
          FLUX_NAMES.map((f, i) => [f, sim.state.flux[i]]),
        ),
        residual,
      };
    };
    trace.push(sample());
    for (let t = 0; t < steps; t++) {
      const f = patchTransport(sim.state, mask);
      for (const sp of ["A", "C"] as const) {
        for (
          const k of ["grossIn", "grossOut", "netIn", "internal"] as const
        ) transport[sp][k] += f[sp][k];
      }
      mutations += sim.step().events.length;
      const assigned = lineageBiomass(sim.state);
      producerArea += assigned["0:1"] ?? 0;
      biomassArea += Object.values(assigned).reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++) {
        const key = `${sim.state.genome[G.LIN_HI * n + i]}:${
          sim.state.genome[G.LIN_LO * n + i]
        }`;
        if (key === "0:0") continue;
        const r = sim.roles[i * ROLE_WORDS];
        assimilation[key] = (assimilation[key] ?? 0) + (r & 65535) + (r >>> 16);
      }
      if (sim.state.step % 100 === 0) trace.push(sample());
    }
    if (mutations || validateState(sim.state).length) {
      throw new Error("invalid mutation-off witness");
    }
    const row = {
      case: c.name,
      seed,
      cfg,
      genome: genomeHex(genome),
      initial: initialTotals,
      final: trace.at(-1),
      biomassArea,
      producerArea,
      mutations,
      hash: stateHash(sim.state),
    };
    rows.push(row);
    const stem = `${out}/${c.name}-seed-${seed}`;
    await Deno.writeTextFile(`${stem}.json`, serialize({ row, trace }));
    await Deno.writeFile(`${stem}.blck`, encodeCheckpoint(sim.state));
    await Deno.writeTextFile(
      `${out}/rows.jsonl`,
      JSON.stringify(row, (_, v) => typeof v === "bigint" ? v.toString() : v) +
        "\n",
      { append: true },
    );
    console.log(
      c.name,
      seed,
      "B",
      String(row.final!.totals.B),
      "assigned",
      JSON.stringify(row.final!.assignedBiomass),
    );
  }
}
await Deno.writeTextFile(`${out}/summary.json`, serialize(rows));
