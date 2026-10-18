// The breeder cut into segments the way an island continues one (docs/archipelago-breed-2026-10-18.md, criterion 1):
// every continuation goes through the artifact bytes (encodeCheckpoint -> decodeArtifact -> continuationError), with
// the coordinator's task-spec shape (censusEvery 100, deepEvery 10, checkpointEvery 0, no overrides, no activity
// threshold), on a native WebGPU device. tests/deno/breed.ts §3 proves the same in memory with scored overrides on
// ponds-small; this one runs the presets as the archipelago distributes them.
//
// For each leg, PASS iff:
//  - the chain's finalHash and stateHash equal the continuous run's;
//  - stitchRun of the chain equals the continuous run in every VERIFIED_FILES file present, byte for byte;
//  - ponds.tsv is present with breedPondColumns(score) as its header and one row per pond per boundary;
//  - every segment, and the continuous run, conserves exactly;
//  - every decoded artifact is the state it was encoded from, and continuationError accepts it for the next segment;
//  - the artifact at a cycle step, continued under pond-mass-drive+seed+body instead, is refused by continuationError;
//  - at every boundary the donors read back from ponds.tsv are ordered as applyPondCycle's armDonors orders them: no
//    occupied non-donor pond outranks a donor by score, then bound mass (recipientTrait). An ordering property only:
//    the number of donors and the recipient each feeds are not checked here (the replay digests hold those);
//  - on a leg marked `selects` (the breeder, mutation x 10), some pond scores above 0, and at some boundary the rule
//    passed over a pond with more bound mass than a donor it chose, so the donors are not the mass control's.
// On ponds-small (stock mutation) no pond is expected to score, so the breeder there is its mass control physically
// (the note's vacuity caveat): its largest score is logged, not asserted.
//
// Run from the repo root: deno run -A tests/deno/breed_segments.ts
import { breedPondColumns, encodeCheckpoint, stateHash, type WorldState } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { PONDS_FILE, VERIFIED_FILES, continuationError, decodeArtifact, runExperiment, specConfig, stitchRun, type ObserverState, type RunSpec, type Sink, type StitchSegment } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes() {}
}

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

interface Leg {
  presetId: string;
  condition: string;
  steps: number;
  cuts: number[];
  /** A cut at a cycle step, whose artifact is continued under another condition and must be refused. */
  cycleCut: number;
  ponds: number;
  boundaries: number;
  /** Selection must show in the file: a score above 0, and a donor chosen over a pond with more bound mass. */
  selects: boolean;
}
const LEGS: Leg[] = [
  { presetId: "ponds-small", condition: "pond-breed-drive+seed+body", steps: 3_500, cuts: [1_000, 1_700, 3_000], cycleCut: 1_000, ponds: 4, boundaries: 3, selects: false },
  { presetId: "breeder", condition: "treatment", steps: 10_500, cuts: [2_500, 5_000, 7_600], cycleCut: 5_000, ponds: 16, boundaries: 2, selects: true },
];
const OTHER = "pond-mass-drive+seed+body";

// The coordinator's task spec (Coordinator.Queue's task/4): no overrides, no activity threshold, no checkpoints.
const taskSpec = (leg: Leg, steps: number, condition = leg.condition): RunSpec => ({
  experiment: "breed-segments",
  presetId: leg.presetId,
  condition,
  seed: 1,
  steps,
  censusEvery: 100,
  deepEvery: 10,
  checkpointEvery: 0,
});

const host = { host: "test", adapter: "test" };
// The breeder's world is the larger (256 x 256), so its config sizes the device for both legs.
const device = await requestDevice(navigator.gpu, specConfig(taskSpec(LEGS[1], LEGS[1].steps)));

try {
  for (const leg of LEGS) {
    const name = `${leg.presetId}/${leg.condition}`;
    const t0 = performance.now();
    const cfg = specConfig(taskSpec(leg, leg.steps));
    check(`${name}: the config is the breed arm with a score (${cfg.pondArm}, ${cfg.pondScore})`, cfg.pondArm === "breed" && cfg.pondScore !== undefined);
    const score = cfg.pondScore!;

    const wholeSink = new Mem();
    const whole = await runExperiment(device, taskSpec(leg, leg.steps), wholeSink, host, () => {}, { keepFinal: true });
    const tWhole = performance.now();

    const bounds = [0, ...leg.cuts, leg.steps];
    const segs: StitchSegment[] = [];
    let start: WorldState | undefined;
    let observer: ObserverState | undefined;
    let last: Awaited<ReturnType<typeof runExperiment>> | undefined;
    let conserved = true, decodedOk = true, acceptedOk = true, refusal: string | null = null;
    let decodeDetail = "", acceptDetail = "";
    for (let k = 0; k + 1 < bounds.length; k++) {
      const steps = bounds[k + 1] - bounds[k];
      const sink = new Mem();
      const r = await runExperiment(device, taskSpec(leg, steps), sink, host, () => {}, { start, observer, keepFinal: true });
      conserved &&= r.summary.conservationOk;
      segs.push({ index: k, startStep: bounds[k], steps, digest: r.summary.finalHash, files: Object.fromEntries(sink.files) });
      last = r;
      if (k + 2 === bounds.length) break;
      // What the island does with the predecessor's upload (island.ts's runIsland).
      const decoded = decodeArtifact(encodeCheckpoint(r.final!, r.observer));
      if (decoded.state.step !== bounds[k + 1] || stateHash(decoded.state) !== stateHash(r.final!)) {
        decodedOk = false;
        decodeDetail ||= `cut ${bounds[k + 1]}: t=${decoded.state.step} ${stateHash(decoded.state)} vs ${stateHash(r.final!)}`;
      }
      const why = continuationError(taskSpec(leg, bounds[k + 2] - bounds[k + 1]), decoded.state, decoded.observer);
      if (why !== null) {
        acceptedOk = false;
        acceptDetail ||= `cut ${bounds[k + 1]}: ${why}`;
      }
      if (bounds[k + 1] === leg.cycleCut) refusal = continuationError(taskSpec(leg, 500, OTHER), decoded.state, decoded.observer);
      start = decoded.state;
      observer = decoded.observer;
    }
    const tChain = performance.now();

    check(`${name}: every segment and the continuous run conserve exactly`, conserved && whole.summary.conservationOk);
    check(`${name}: each cut's artifact decodes to the state it was encoded from`, decodedOk, decodeDetail);
    check(`${name}: ...and continuationError accepts it for the next segment (cuts ${leg.cuts.join(", ")})`, acceptedOk, acceptDetail);
    check(`${name}: the chain's finalHash equals the continuous run's`, last!.summary.finalHash === whole.summary.finalHash, `${last!.summary.finalHash} vs ${whole.summary.finalHash}`);
    check(`${name}: ...and so does its stateHash`, stateHash(last!.final!) === stateHash(whole.final!), `${stateHash(last!.final!)} vs ${stateHash(whole.final!)}`);

    const stitched = stitchRun(segs, leg.steps);
    const files = Object.fromEntries(wholeSink.files);
    for (const f of VERIFIED_FILES) {
      if (files[f] === undefined && stitched[f] === undefined) continue;
      check(`${name}: stitched ${f} equals the continuous run's`, stitched[f] === files[f], `${stitched[f]?.length} vs ${files[f]?.length} bytes`);
    }
    const ponds = files[PONDS_FILE] ?? "";
    const [header, ...rows] = ponds.trimEnd().split("\n");
    const columns = breedPondColumns(score);
    check(`${name}: ponds.tsv has the ${score} header (${columns.length} columns)`, header === columns.join("\t"), header);
    check(`${name}: ...and ${leg.ponds * leg.boundaries} rows (${leg.ponds} ponds x ${leg.boundaries} boundaries)`, rows.length === leg.ponds * leg.boundaries, `${rows.length} rows`);
    check(`${name}: the cycle-step artifact (t=${leg.cycleCut}) continued under ${OTHER} is refused`, refusal !== null && /config differs/.test(refusal), String(refusal));

    // The donors, read back from the file: per boundary, each pond's score and bound mass, and the set of donors.
    const names = header.split("\t");
    const col = Object.fromEntries(["step", "recipient", "donor", "score", "recipientTrait"].map((c) => [c, names.indexOf(c)]));
    check(`${name}: ponds.tsv has the step, recipient, donor, score and recipientTrait columns`, Object.values(col).every((i) => i >= 0), JSON.stringify(col));
    const byStep = new Map<number, { pond: number; donor: number; score: number; trait: number }[]>();
    for (const r of rows) {
      const f = r.split("\t").map(Number);
      (byStep.get(f[col.step]) ?? byStep.set(f[col.step], []).get(f[col.step])!).push({ pond: f[col.recipient], donor: f[col.donor], score: f[col.score], trait: f[col.recipientTrait] });
    }
    let ruleOk = true, passedOver = 0, ruleDetail = "";
    for (const [step, ps] of byStep) {
      const donors = new Set(ps.map((p) => p.donor).filter((d) => d >= 0));
      const of = new Map(ps.map((p) => [p.pond, p]));
      for (const d of donors)
        for (const q of ps) {
          if (donors.has(q.pond) || q.trait === 0) continue;
          const dp = of.get(d)!;
          if (q.score > dp.score || (q.score === dp.score && q.trait > dp.trait)) {
            ruleOk = false;
            ruleDetail ||= `t=${step}: pond ${q.pond} (score ${q.score}, mass ${q.trait}) outranks donor ${d} (score ${dp.score}, mass ${dp.trait})`;
          }
          if (q.trait > dp.trait) passedOver++;
        }
    }
    check(`${name}: at every boundary the donors are ordered as the breed arm orders them (no occupied non-donor outranks one by score, then mass; donor count and assignment are not checked here)`, ruleOk && byStep.size === leg.boundaries, ruleDetail || `${byStep.size} boundaries`);
    const best = Math.max(0, ...rows.map((r) => Number(r.split("\t")[col.score])));
    if (leg.selects) {
      check(`${name}: some pond scores above 0 (largest ${best})`, best > 0);
      check(`${name}: ...and the rule chose a donor over a pond with more bound mass (${passedOver} such pairs), so these are not the mass control's donors`, passedOver > 0);
    }
    console.log(`  info: ${name}: largest pond score ${best}, donor/heavier-non-donor pairs ${passedOver}; continuous ${((tWhole - t0) / 1000).toFixed(1)} s, chain ${((tChain - tWhole) / 1000).toFixed(1)} s`);
  }
} finally {
  device.destroy();
}
console.log(ok ? "\nALL PASS" : "\nFAILURES");
if (!ok) Deno.exit(1);
