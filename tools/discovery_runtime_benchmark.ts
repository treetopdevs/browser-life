import { dirname } from "node:path";
// Engineering throughput only. Requires completed pilot acceptance; never supplies study histories.
import {
  cellCount,
  CH,
  decodeCheckpoint,
  encodeCheckpoint,
  G,
  GENOME_CHANNELS,
  lineageKey,
  stateHash,
} from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { discoveryEvolutionWorld } from "./lib/discovery-evolution.ts";
import { sha256 } from "./lib/founder-policy.ts";
import {
  type Unit,
  validateCheckpointBiology,
} from "./lib/discovery-improvement-runtime.ts";
import {
  analyzePilotEvidence,
  buildPilotDesign,
  type PilotEvidence,
  validatePilotDesign,
  verifyFrozenPilot,
} from "./discovery_competition_pilot.ts";

const [pilotDir, output, rawDir] = Deno.args;
if (
  !pilotDir || !output || !rawDir || !/^runs\/[A-Za-z0-9_/-]+$/.test(rawDir) ||
  rawDir.includes("..")
) {
  throw Error(
    "usage: discovery_runtime_benchmark.ts PILOT_DIR NEW_OUTPUT NEW_runs/DIR",
  );
}
const design = validatePilotDesign(
  JSON.parse(await Deno.readTextFile(`${pilotDir}/pilot-design.json`)),
);
await verifyFrozenPilot(design);
if (
  JSON.stringify(await buildPilotDesign(design.root)) !== JSON.stringify(design)
) throw Error("Pilot design differs from reconstructed roster");
const finalBytes = await Deno.readFile(`${pilotDir}/final-analysis.json`);
const final = JSON.parse(new TextDecoder().decode(finalBytes));
const receipts: Record<string, PilotEvidence> = {},
  replays: Record<string, PilotEvidence> = {};
for (const unit of design.units) {
  const bytes = await Deno.readFile(`${pilotDir}/receipts/${unit.id}.json`);
  receipts[unit.id] = {
    value: JSON.parse(new TextDecoder().decode(bytes)),
    sha256: sha256(bytes),
  };
  if (final.receiptHashes?.[unit.id] !== sha256(bytes)) {
    throw Error("Pilot receipt drift");
  }
}
for (const id of design.requiredReplayUnitIds) {
  const bytes = await Deno.readFile(`${pilotDir}/replays/${id}.json`);
  replays[id] = {
    value: JSON.parse(new TextDecoder().decode(bytes)),
    sha256: sha256(bytes),
  };
}
const checked = analyzePilotEvidence(design, receipts, replays);
for (const [key, value] of Object.entries(checked)) {
  if (JSON.stringify(final[key]) !== JSON.stringify(value)) {
    throw Error(`Pilot analysis drift: ${key}`);
  }
}
if (
  final.status !== "eligible" || checked.status !== "eligible" ||
  final.designHash !== design.designHash || final.unexpectedFiles?.length
) throw Error("Complete accepted pilot required");
const lockPath = `${pilotDir}/BENCHMARK_RUNNING`;
const lock = await Deno.open(lockPath, { write: true, createNew: true });
try {
  await lock.write(new TextEncoder().encode(String(Deno.pid)));
} finally {
  lock.close();
}
const hashes = Object.fromEntries(
  await Promise.all(
    [
      ...new Set([
        ...Object.keys(design.sources),
        "tools/discovery_runtime_benchmark.ts",
        "tools/lib/discovery-evolution.ts",
        "tools/lib/discovery-improvement-runtime.ts",
        "tools/discovery_competition_pilot.ts",
        "tools/lib/discovery-improvement-summary.ts",
      ]),
    ].sort().map(async (p) => [p, sha256(await Deno.readFile(p))]),
  ),
);
const reports = [];
try {
  await Deno.mkdir(dirname(rawDir), { recursive: true });
  await Deno.mkdir(rawDir);
  const device = await requestDevice(navigator.gpu);
  try {
    for (const kind of ["single-disc", "constructed-dense"] as const) {
      const { state } = discoveryEvolutionWorld(
        6460001,
        "normal",
        design.founders[0].hex,
      );
      if (kind === "constructed-dense") {
        const n = cellCount(state.cfg), center = 128 * 256 + 128;
        if (!state.genome[G.LIN_LO * n + center]) {
          throw Error("Missing benchmark founder");
        }
        for (let c = 0; c < GENOME_CHANNELS; c++) {
          state.genome.fill(state.genome[c * n + center], c * n, (c + 1) * n);
        }
        state.cells.fill(64, CH.B * n, (CH.B + 1) * n);
        state.cells.fill(128, CH.E * n, (CH.E + 1) * n);
      }
      const startHash = stateHash(state),
        sim = await GpuSim.create(device, state);
      const events: { child: string; parent: string }[] = [];
      const started = performance.now();
      try {
        for (let step = 0; step < 10000; step += 100) {
          sim.run(100);
          await device.queue.onSubmittedWorkDone();
          const ledger = await sim.drainLedger();
          if (ledger.step !== step + 100 || ledger.dropped) {
            throw Error("Benchmark mutation event loss or step mismatch");
          }
          for (const e of ledger.events) {
            events.push({
              child: lineageKey(e.childHi, e.childLo),
              parent: lineageKey(e.parentHi, e.parentLo),
            });
          }
        }
        const evolveSeconds = (performance.now() - started) / 1000,
          readStart = performance.now(),
          end = await sim.readState();
        if (end.step !== 10000) throw Error("Benchmark endpoint mismatch");
        const readbackSeconds = (performance.now() - readStart) / 1000;
        events.sort((a, b) => {
          const aa = [...a.child.split(":"), ...a.parent.split(":")].map(
              Number,
            ),
            bb = [...b.child.split(":"), ...b.parent.split(":")].map(Number);
          for (let i = 0; i < 4; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
          return 0;
        });
        const unit: Unit = {
          id: `engineering-${kind}`,
          founderId: design.founders[0].id,
          founderHex: design.founders[0].hex,
          seed: 6460001,
          mode: "normal",
          drawSeeds: [],
        };
        const semanticStart = performance.now();
        validateCheckpointBiology(end, unit, events, events, 0);
        const checkpointSemanticSeconds = (performance.now() - semanticStart) /
          1000;
        const ioStart = performance.now();
        const checkpoint = encodeCheckpoint(end, { engineering: true, kind }),
          edgeBytes = new TextEncoder().encode(JSON.stringify(events) + "\n");
        const checkpointSha256 = sha256(checkpoint),
          edgeSha256 = sha256(edgeBytes);
        for (
          const [name, bytes] of [[`${kind}.checkpoint`, checkpoint], [
            `${kind}.edges.json`,
            edgeBytes,
          ]] as const
        ) {
          const f = await Deno.open(`${rawDir}/${name}`, {
            write: true,
            createNew: true,
          });
          try {
            let offset = 0;
            while (offset < bytes.length) {
              const written = await f.write(bytes.subarray(offset));
              if (written <= 0) throw Error("Short benchmark write");
              offset += written;
            }
            await f.sync();
          } finally {
            f.close();
          }
        }
        const encodeHashWriteSeconds = (performance.now() - ioStart) / 1000;
        const rereadStart = performance.now(),
          reread = await Deno.readFile(`${rawDir}/${kind}.checkpoint`);
        if (
          sha256(reread) !== checkpointSha256 ||
          sha256(await Deno.readFile(`${rawDir}/${kind}.edges.json`)) !==
            edgeSha256 ||
          stateHash(decodeCheckpoint(reread).state) !== stateHash(end)
        ) throw Error("Benchmark checkpoint roundtrip mismatch");
        const readHashDecodeSeconds = (performance.now() - rereadStart) / 1000;
        const report = {
          kind,
          checkpointSemanticSeconds,
          checkpointBytes: checkpoint.length,
          checkpointSha256,
          edgeSha256,
          encodeHashWriteSeconds,
          readHashDecodeSeconds,
          seed: 6460001,
          steps: 10000,
          founderId: design.founders[0].id,
          startHash,
          endHash: stateHash(end),
          evolveWithLedgerSeconds: evolveSeconds,
          readbackSeconds,
          mutationEvents: events.length,
          serializedEdgeBytes:
            new TextEncoder().encode(JSON.stringify(events)).length,
        };
        reports.push(report);
        console.log(JSON.stringify(report));
      } finally {
        sim.destroy();
      }
    }
  } finally {
    device.destroy();
  }
  await verifyFrozenPilot(design);
  for (const [p, h] of Object.entries(hashes)) {
    if (sha256(await Deno.readFile(p)) !== h) {
      throw Error("Benchmark source drift");
    }
  }
  await Deno.writeTextFile(
    output,
    JSON.stringify(
      {
        format: "discovery-engineering-throughput/v1",
        pilotAnalysisSha256: sha256(finalBytes),
        sourceHashes: hashes,
        rawDir,
        reports,
        paidUSD: 0,
        interpretation:
          "Two fixed 10,000-step engineering workloads, not study histories or biological evidence. Dense initialization is constructed. No genotype or threshold selection from benchmark outcomes. Timing and edge counts are measurements, not worst-case guarantees. Checkpoint semantics are timed separately from I/O; scheduled sampling and resume verification require separate measurement; 10k edge counts do not bound a million-step ancestry graph.",
      },
      null,
      2,
    ) + "\n",
    { createNew: true },
  );
} finally {
  await Deno.remove(lockPath);
}
