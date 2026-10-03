// Bounded stationary mutation accumulation + genome-reconstitution assay.
// deno run -A tools/construction-evolution.ts <fresh-output-directory>
import {
  cellCount,
  CH,
  decodeGenome,
  encodeCheckpoint,
  FLUX_NAMES,
  G,
  GENOME_CHANNELS,
  genomeFromHex,
  genomeHex,
  ledgerResidual,
  ROLE_WORDS,
  stateHash,
  totalsOf,
  validateState,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { GpuSim, type MutationEvent, requestDevice } from "@bl/sim-gpu";
import {
  constructionConfig,
  constructionGenome,
  constructionWorld,
} from "./lib/construction.ts";
import {
  constructionProvenance,
  newConstructionOutput,
} from "./lib/construction-provenance.ts";

const [out] = Deno.args;
if (!out || Deno.args.length !== 1) {
  throw new Error("usage: construction-evolution.ts <fresh-output-directory>");
}
const founders = [1, 4, 8], sourceSeeds = [501, 502, 503, 504, 505];
const transferSeeds = [601, 602, 603],
  mutationDose = 4_294_967,
  horizon = 3000,
  cadence = 100;
const protocol = "experiments/construction/EVOLUTION.md";
const serialize = (x: unknown) =>
  JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const avg = (xs: number[]) => mean(xs) ?? 0;
const cfgFor = (seed: number, mutation: boolean, gate: boolean) =>
  constructionConfig(seed, {
    ruleVersion: 1,
    dtQ: 0,
    spread: 0,
    motility: false,
    mutRate: mutation ? mutationDose : 0,
    ...(gate ? {} : { polymerTransport: false }),
  });

await newConstructionOutput(out);
const sources = await constructionProvenance([
  "tools/construction-evolution.ts",
  protocol,
  "packages/sim-gpu/src/gpu-sim.ts",
  "packages/sim-gpu/src/shaders.ts",
  "packages/schema/src/checkpoint.ts",
]);
await Deno.mkdir(`${out}/source-snapshot`, { recursive: true });
for (const path of Object.keys(sources)) {
  const target = `${out}/source-snapshot/${path}`;
  await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.copyFile(path, target);
}
await Deno.writeTextFile(
  `${out}/manifest.json`,
  serialize({
    created: new Date().toISOString(),
    cwd: Deno.cwd(),
    sources,
    protocol,
    founders,
    sourceSeeds,
    transferSeeds,
    mutationDose,
    horizon,
    cadence,
    sourceHistories: 60,
    initialB: 1024,
    initialE: 2048,
    initialP: 0,
    cfg: cfgFor(501, false, true),
    label:
      "mutation accumulation and differential persistence; no spatial birth or offspring competition",
    criteria:
      "E>0, T_on>0, T_off<=0 in >=3/5 source histories and mean E>0, for >=2/3 founders",
  }),
);

const device = await requestDevice(navigator.gpu, cfgFor(501, false, true));
let deviceLost = "";
device.lost.then((x) => {
  if (x.reason !== "destroyed") deviceLost = x.message;
});

type Trace = {
  step: number;
  B: number;
  P: number;
  E: number;
  matter: string;
  lightIn: string;
  heatOut: string;
  residual: string;
  flux: string[];
  lastStepRoles: number[];
  mutations: number;
  hash: string;
};
type Assay = {
  id: string;
  cfg: WorldConfig;
  initialGenome: string;
  terminalGenome: string | null;
  B: number;
  P: number;
  E: number;
  alive: boolean;
  mutations: number;
  sampledBiomassArea: number;
  flux: Record<string, string>;
  hash: string;
  changedBytes: number | null;
  trace: Trace[];
};
type Source = Assay & {
  founder: number;
  seed: number;
  mutation: boolean;
  gate: boolean;
};
type TransferPair = {
  gate: boolean;
  seed: number;
  ancestorId: string;
  descendantId: string | null;
  ancestorB: number;
  descendantB: number;
  gain: number;
  ancestorArea: number;
  descendantArea: number;
};
type Readout = {
  id: string;
  founder: number;
  seed: number;
  mutation: boolean;
  gate: boolean;
  alive: boolean;
  B: number;
  mutations: number;
  ecologicalDelta: number;
  transferGainOn: number;
  transferGainOff: number;
  combinedImprovement: boolean;
  transfers: TransferPair[];
};

function hexAt(state: WorldState, site: number): string {
  const n = cellCount(state.cfg), words = new Uint32Array(GENOME_CHANNELS);
  for (let j = 0; j < GENOME_CHANNELS; j++) {
    words[j] = state.genome[j * n + site];
  }
  return genomeHex(decodeGenome(words));
}

async function runAssay(
  id: string,
  hex: string,
  cfg: WorldConfig,
): Promise<Assay> {
  if (deviceLost) throw new Error(`GPU lost: ${deviceLost}`);
  const initial = constructionWorld(cfg, [{
    x: 16,
    y: 16,
    genome: genomeFromHex(hex),
  }]);
  const start = totalsOf(cfg, initial.cells),
    n = cellCount(cfg),
    site = 16 * 32 + 16;
  const gpu = await GpuSim.create(device, initial);
  const events: MutationEvent[] = [], trace: Trace[] = [];
  let state = initial, area = 0, previousB = 1024;
  const record = (roles: Uint32Array | null) => {
    const totals = totalsOf(cfg, state.cells),
      residual = ledgerResidual(start, state);
    if (totals.matter !== start.matter || residual !== 0n) {
      throw new Error(`ledger failure ${id}@${state.step}`);
    }
    const errors = validateState(state);
    if (errors.length) {
      throw new Error(`invalid state ${id}: ${errors.join("; ")}`);
    }
    let offsiteB = 0;
    for (let i = 0; i < n; i++) {
      if (i !== site) offsiteB += state.cells[CH.B * n + i];
    }
    if (offsiteB) throw new Error(`unexpected spatial propagation ${id}`);
    trace.push({
      step: state.step,
      B: Number(totals.B),
      P: Number(totals.P),
      E: Number(totals.E),
      matter: String(totals.matter),
      lightIn: String(state.lightIn),
      heatOut: String(state.heatOut),
      residual: String(residual),
      flux: state.flux.map(String),
      lastStepRoles: roles
        ? Array.from(roles.slice(site * ROLE_WORDS, (site + 1) * ROLE_WORDS))
        : [],
      mutations: events.length,
      hash: stateHash(state),
    });
    if (roles) {
      for (let i = 0; i < roles.length; i++) {
        if (
          Math.floor(i / ROLE_WORDS) !== site && roles[i] !== 0
        ) throw new Error(`unexpected offsite roles ${id}`);
      }
    }
  };
  try {
    record(null);
    while (state.step < horizon) {
      gpu.run(cadence);
      const ledger = await gpu.drainLedger();
      if (ledger.dropped) throw new Error(`dropped mutation events ${id}`);
      events.push(...ledger.events);
      state = await gpu.readState();
      if (
        ledger.step !== state.step || ledger.lightIn !== state.lightIn ||
        ledger.heatOut !== state.heatOut
      ) {
        throw new Error(`inconsistent ledger readback ${id}`);
      }
      record(await gpu.readRoles());
      const b = trace.at(-1)!.B;
      area += cadence * (previousB + b) / 2;
      previousB = b;
    }
    if (cfg.mutRate === 0 && events.length) {
      throw new Error(`mutation in disabled arm ${id}`);
    }
    const final = trace.at(-1)!,
      terminalGenome = final.B > 0 ? hexAt(state, site) : null;
    const terminalRaw = hexAt(state, site);
    if (cfg.mutRate === 0 && terminalGenome && terminalRaw !== hex) {
      throw new Error(`genome changed without mutation ${id}`);
    }
    let changedBytes = 0;
    for (let p = 0; p < hex.length; p += 2) {
      if (hex.slice(p, p + 2) !== terminalRaw.slice(p, p + 2)) changedBytes++;
    }
    const row: Assay = {
      id,
      cfg,
      initialGenome: hex,
      terminalGenome,
      B: final.B,
      P: final.P,
      E: final.E,
      alive: final.B > 0,
      mutations: events.length,
      sampledBiomassArea: area,
      flux: Object.fromEntries(
        FLUX_NAMES.map((key, i) => [key, String(state.flux[i])]),
      ),
      hash: final.hash,
      changedBytes: terminalGenome ? changedBytes : null,
      trace,
    };
    await Deno.writeTextFile(
      `${out}/${id}.json`,
      serialize({ ...row, events }),
    );
    await Deno.writeFile(`${out}/${id}.blck`, encodeCheckpoint(state));
    return row;
  } finally {
    gpu.destroy();
  }
}

const rows: Source[] = [];
const transferCache = new Map<string, Assay>();
async function transfer(
  hex: string,
  seed: number,
  gate: boolean,
): Promise<Assay> {
  const cfg = cfgFor(seed, false, gate),
    key = JSON.stringify({ hex, cfg, x: 16, y: 16, B: 1024, E: 2048 });
  const cached = transferCache.get(key);
  if (cached) return cached;
  const id = `transfer-${String(transferCache.size + 1).padStart(3, "0")}`;
  const row = await runAssay(id, hex, cfg);
  transferCache.set(key, row);
  console.log(`${id} seed=${seed} gate=${gate} B=${row.B}`);
  return row;
}

try {
  for (const founder of founders) {
    for (const seed of sourceSeeds) {
      for (const mutation of [false, true]) {
        for (const gate of [true, false]) {
          const id = `source-build-${founder}-seed-${seed}-mut-${
            Number(mutation)
          }-gate-${Number(gate)}`;
          const row = {
            ...await runAssay(
              id,
              genomeHex(constructionGenome({ build: founder })),
              cfgFor(seed, mutation, gate),
            ),
            founder,
            seed,
            mutation,
            gate,
          };
          rows.push(row);
          await Deno.writeTextFile(`${out}/source-rows.json`, serialize(rows));
          console.log(`${id} B=${row.B} mutations=${row.mutations}`);
        }
      }
    }
  }
  const readouts: Readout[] = [];
  for (const row of rows) {
    const transfers = [];
    for (const gate of [true, false]) {
      for (const seed of transferSeeds) {
        const ancestor = await transfer(row.initialGenome, seed, gate);
        const descendant = row.terminalGenome
          ? await transfer(row.terminalGenome, seed, gate)
          : null;
        transfers.push({
          gate,
          seed,
          ancestorId: ancestor.id,
          descendantId: descendant?.id ?? null,
          ancestorB: ancestor.B,
          descendantB: descendant?.B ?? 0,
          gain: (descendant?.B ?? 0) - ancestor.B,
          ancestorArea: ancestor.sampledBiomassArea,
          descendantArea: descendant?.sampledBiomassArea ?? 0,
        });
      }
    }
    const sibling = rows.find((x) =>
      x.founder === row.founder && x.seed === row.seed && !x.mutation &&
      x.gate === row.gate
    )!;
    const ecologicalDelta = row.B - sibling.B;
    const transferGainOn = avg(
      transfers.filter((t) => t.gate).map((t) => t.gain),
    );
    const transferGainOff = avg(
      transfers.filter((t) => !t.gate).map((t) => t.gain),
    );
    readouts.push({
      id: row.id,
      founder: row.founder,
      seed: row.seed,
      mutation: row.mutation,
      gate: row.gate,
      alive: row.alive,
      B: row.B,
      mutations: row.mutations,
      ecologicalDelta,
      transferGainOn,
      transferGainOff,
      combinedImprovement: row.mutation && row.gate && ecologicalDelta > 0 &&
        transferGainOn > 0 && transferGainOff <= 0,
      transfers,
    });
    await Deno.writeTextFile(
      `${out}/transfer-readouts.json`,
      serialize(readouts),
    );
  }
  const summaries = founders.flatMap((founder) =>
    [false, true].flatMap((mutation) =>
      [true, false].map((gate) => {
        const rs = readouts.filter((x) =>
          x.founder === founder && x.mutation === mutation && x.gate === gate
        );
        const survivors = rs.filter((x) => x.alive);
        return {
          founder,
          mutation,
          gate,
          denominator: rs.length,
          survivors: survivors.length,
          meanB: avg(rs.map((x) => x.B)),
          meanEvents: avg(rs.map((x) => x.mutations)),
          meanEcologicalDelta: avg(rs.map((x) => x.ecologicalDelta)),
          meanTransferGainOn: avg(rs.map((x) => x.transferGainOn)),
          meanTransferGainOff: avg(rs.map((x) => x.transferGainOff)),
          conditionalSurvivorTransferGainOn: mean(
            survivors.map((x) => x.transferGainOn),
          ),
          combinedImprovementHistories: rs.filter((x) =>
            x.combinedImprovement
          ).length,
        };
      })
    )
  );
  const founderReadouts = founders.map((founder) => {
    const on = summaries.find((x) =>
      x.founder === founder && x.mutation && x.gate
    )!;
    const off = summaries.find((x) =>
      x.founder === founder && x.mutation && !x.gate
    )!;
    return {
      founder,
      counts: on.meanEcologicalDelta > 0 &&
        on.combinedImprovementHistories >= 3,
      ecologicalDifferenceInDifferences: on.meanEcologicalDelta -
        off.meanEcologicalDelta,
    };
  });
  const positive = founderReadouts.filter((x) => x.counts).length >= 2;
  const summary = {
    complete: true,
    positive,
    label: positive
      ? "Positive finite mutation-accumulation screen"
      : "Negative bounded mutation-accumulation screen",
    sourceHistories: rows.length,
    uniqueTransferAssays: transferCache.size,
    summaries,
    founderReadouts,
    limitations: [
      "No spatial birth or competition among offspring",
      "Genomes reconstituted with equal fresh matter and energy",
      "Extinct source histories remain in primary denominators",
      "Transfer seeds are not independent source histories",
      "Mechanism-off extinction may create a floor",
      "No dose or search extension is triggered",
    ],
  };
  await Deno.writeTextFile(`${out}/summary.json`, serialize(summary));
  const lines = [
    "# Bounded stationary mutation-accumulation readout",
    "",
    `**${summary.label}.** ${
      founderReadouts.filter((x) => x.counts).length
    }/3 founders count.`,
    "",
    "All-run means; n=5 original source histories per row. Extinct source transfer scores are zero before subtracting the ancestor.",
    "",
    "| Build | Mutation | Gate | Survivors | Final B | Events | Ecological delta | Transfer gain on | Transfer gain off | Combined |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const x of summaries) {
    lines.push(
      `| ${x.founder} | ${x.mutation ? "on" : "off"} | ${
        x.gate ? "on" : "off"
      } | ${x.survivors}/5 | ${x.meanB.toFixed(1)} | ${
        x.meanEvents.toFixed(1)
      } | ${x.meanEcologicalDelta.toFixed(1)} | ${
        x.meanTransferGainOn.toFixed(1)
      } | ${
        x.meanTransferGainOff.toFixed(1)
      } | ${x.combinedImprovementHistories}/5 |`,
    );
  }
  lines.push(
    "",
    ...summary.limitations.map((x) => `- ${x}`),
    "",
    `Source histories: ${rows.length}. Unique transfer assays: ${transferCache.size}. Exact state, role snapshots, events, fluxes, ledgers, hashes and checkpoints accompany this summary.`,
    "",
  );
  await Deno.writeTextFile(`${out}/summary.md`, lines.join("\n"));
  console.log(
    JSON.stringify({
      complete: true,
      positive,
      sourceHistories: rows.length,
      uniqueTransfers: transferCache.size,
    }),
  );
} finally {
  device.destroy();
}
