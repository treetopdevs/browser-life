// Mutation-off return-capture challenge for the physical-flow constructed witness.
// deno run -A tools/construction-capture.ts <positive-record.json> <new-output-dir>
import {
  b2,
  cellCount,
  CH,
  encodeCheckpoint,
  FLUX_NAMES,
  G,
  genomeFromHex,
  genomeHex,
  ledgerResidual,
  OUT,
  ROLE_WORDS,
  stateHash,
  totalsOf,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { constructionWorld } from "./lib/construction.ts";
import { patchTransport } from "./lib/construction-transport.ts";
import {
  constructionProvenance,
  newConstructionOutput,
} from "./lib/construction-provenance.ts";
const [positivePath, out] = Deno.args;
if (!positivePath || !out) {
  throw new Error("provide a saved positive record and a new output directory");
}
const positive = JSON.parse(await Deno.readTextFile(positivePath));
if (
  positive.outcome?.extinct !== false || positive.cfg?.mutRate !== 0 ||
  positive.cfg?.polymerTransport === false
) throw new Error("expected a mutation-off positive gate-on record");
const builder = genomeFromHex(positive.genome);
const nonbuilder = { ...builder, weights: builder.weights.slice() };
nonbuilder.weights[b2(OUT.BUILD)] = 0;
const pilot = Deno.args[2] === "--pilot";
const seeds = pilot ? [1] : [201, 202, 203, 204, 205], steps = 10000;
const centerX = positive.cfg.tileW >> 1, centerY = positive.cfg.tileH >> 1;
const layouts = [
  "all-producer",
  "all-nonbuilder",
  "producer-common-center-cheater",
  "producer-rare-center",
  "producer-common-corner-cheater",
  "producer-rare-corner",
] as const;
await newConstructionOutput(out);
const json = (x: unknown) =>
  JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) +
  "\n";
await Deno.writeTextFile(
  `${out}/manifest.json`,
  json({
    created: new Date().toISOString(),
    pilot,
    sourceRecord: positivePath,
    sourceRecordHash: positive.outcome.finalHash,
    sourceSha256: await constructionProvenance([
      "tools/construction-capture.ts",
    ]),
    cfg: positive.cfg,
    genomes: {
      producer: genomeHex(builder),
      nonbuilder: genomeHex(nonbuilder),
    },
    seeds,
    steps,
    layouts,
    mechanisms: [true, false],
    initial:
      "3x3 sites x512B,1024E; total4608B,9216E; noP/A/C; same amounts for every arm",
    claim:
      "Mutation-off mixed-genotype return capture; lineage-assigned material is not molecular tracing.",
    earlyStop:
      "Only when totalB is zero, an absorbing state; record the actual step and checkpoint, do not extrapolate other fields.",
  }),
);
const results = [];
for (const layout of layouts) {
  for (const gate of [true, false]) {
    for (const seed of seeds) {
      const cfg = {
        ...positive.cfg,
        seed,
        ...(gate ? {} : { polymerTransport: false }),
      };
      const producerIds = new Set<number>(), placements = [];
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const marked = layout.includes("corner")
            ? dx === -1 && dy === -1
            : dx === 0 && dy === 0;
          const producer = layout === "all-producer" ||
            (layout.includes("common") && !marked) ||
            (layout.includes("rare") && marked);
          k++;
          if (producer) producerIds.add(k);
          placements.push({
            x: centerX + dx,
            y: centerY + dy,
            genome: producer ? builder : nonbuilder,
            biomass: 512,
            energy: 1024,
          });
        }
      }
      const sim = new RefSim(constructionWorld(cfg, placements)),
        n = cellCount(cfg),
        start = totalsOf(cfg, sim.state.cells);
      const mask = Array.from(
        { length: n },
        (_, i) =>
          Math.abs(i % cfg.tileW - centerX) <= 1 &&
          Math.abs(Math.floor(i / cfg.tileW) - centerY) <= 1,
      );
      const transport = {
        A: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
        C: { grossIn: 0, grossOut: 0, netIn: 0, internal: 0 },
      };
      let producerArea = 0,
        nonbuilderArea = 0,
        producerAssimilation = 0,
        nonbuilderAssimilation = 0,
        events = 0;
      const trace = [];
      function measure() {
        let producerB = 0, nonbuilderB = 0, externalB = 0, occupied = 0;
        for (let i = 0; i < n; i++) {
          const B = sim.state.cells[CH.B * n + i];
          if (B > 0) {
            occupied++;
          }
          if (!mask[i]) {
            externalB += B;
          }
          const id = sim.state.genome[G.LIN_LO * n + i];
          if (producerIds.has(id)) producerB += B;
          else nonbuilderB += B;
        }
        const totals = totalsOf(cfg, sim.state.cells);
        if (
          totals.matter !== start.matter ||
          ledgerResidual(start, sim.state) !== 0n
        ) throw new Error("conservation failure");
        return {
          step: sim.state.step,
          totals,
          producerB,
          nonbuilderB,
          externalB,
          occupied,
          producerArea,
          nonbuilderArea,
          producerAssimilation,
          nonbuilderAssimilation,
          transport: structuredClone(transport),
          buildQuanta: sim.state.flux[FLUX_NAMES.indexOf("build")],
          matterResidual: 0,
          energyResidual: 0,
        };
      }
      trace.push(measure());
      let final = trace[0];
      for (let t = 0; t < steps; t++) {
        const f = patchTransport(sim.state, mask);
        for (const sp of ["A", "C"] as const) {
          for (
            const key of ["grossIn", "grossOut", "netIn", "internal"] as const
          ) transport[sp][key] += f[sp][key];
        }
        events += sim.step().events.length;
        for (let i = 0; i < n; i++) {
          const producer = producerIds.has(sim.state.genome[G.LIN_LO * n + i]),
            B = sim.state.cells[CH.B * n + i],
            roles = sim.roles[i * ROLE_WORDS],
            assimilation = (roles & 65535) + (roles >>> 16);
          if (producer) {
            producerArea += B;
            producerAssimilation += assimilation;
          } else {
            nonbuilderArea += B;
            nonbuilderAssimilation += assimilation;
          }
        }
        if (sim.state.step % 100 === 0 || sim.state.step === steps) {
          final = measure();
          trace.push(final);
          if (final.totals.B === 0n) break;
        }
      }
      if (events) throw new Error("unexpected mutations");
      const name = `${layout}-gate-${gate ? "on" : "off"}-seed-${seed}`,
        row = {
          name,
          layout,
          gate,
          seed,
          initial: start,
          initialProducerB: producerIds.size * 512,
          initialNonbuilderB: (9 - producerIds.size) * 512,
          observedStep: sim.state.step,
          requestedSteps: steps,
          final,
          hash: stateHash(sim.state),
          mutations: events,
        };
      await Deno.writeTextFile(`${out}/${name}.json`, json({ row, trace }));
      await Deno.writeFile(`${out}/${name}.blck`, encodeCheckpoint(sim.state));
      results.push(row);
      await Deno.writeTextFile(`${out}/summary.json`, json(results));
      console.log(
        name,
        "producerB",
        final.producerB,
        "nonbuilderB",
        final.nonbuilderB,
        "step",
        sim.state.step,
      );
    }
  }
}
