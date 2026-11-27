// A picked breeder run cut into segments the way an island continues one, with its donors from a fixed, content-addressed
// pick log (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02). Every continuation goes through the artifact bytes
// (encodeCheckpoint -> decodeArtifact -> continuationError), with the coordinator's task-spec shape plus picked, pickLog and
// pickImplicit, and with only the log's entries inside the segment's own window (what runIsland passes), on a native WebGPU device.
//
// The pick log is the null-fixture kind (review P1-3): non-rule donors at cycle 1 (a segment end) and cycle 3 (a later segment's
// end), cycle 2 implicit. The rule would pick [6, 7, 15, 2] at cycle 1, so a run that ignored the log is told apart by hash.
//
// PASS iff:
//  - the picked continuous run's cycle-1 donors are the log's, not the rule's, and its finalHash differs from a continuous run
//    that ignores the log (an island that dropped the picks would fail every equality below);
//  - the chain (cuts at a cycle step and mid-cycle) has finalHash and stateHash equal to the continuous picked run's, every
//    segment and the whole conserve exactly, and every artifact decodes and passes continuationError;
//  - stitchRun with the log's text equals the continuous run in every VERIFIED_FILES file byte for byte, its picks.jsonl holds
//    the continuous run's applied donors, and its manifest `picks` block equals the continuous run's (digest and counts);
//  - the chain with every pick dropped (a lossy island) fails the same equality, and stitchRun refuses it against the log;
//  - a pick naming an unoccupied pond fails at its boundary: PickError, a `failed` line, no ponds.tsv row for that cycle.
//
// Run from the repo root: deno run -A tests/deno/picked_segments.ts
import { encodeCheckpoint, stateHash, type WorldState } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import {
  PICKS_FILE,
  PickError,
  VERIFIED_FILES,
  canonicalPickLog,
  continuationError,
  decodeArtifact,
  parsePickLog,
  pickLogDigest,
  runExperiment,
  specConfig,
  stitchRun,
  verifiedPickLog,
  type ObserverState,
  type PickEntry,
  type RunSpec,
  type Sink,
  type StitchSegment,
} from "@bl/runner";

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

const STEPS = 15_000;
const CUTS = [5_000, 8_000, 12_500];
const input: PickEntry[] = [
  { step: 5_000, cycle: 1, donors: [3, 9, 12, 0] },
  { step: 15_000, cycle: 3, donors: [5, 12, 3, 1] },
];
const logText = canonicalPickLog(input);
const digest = pickLogDigest(logText);
const all = verifiedPickLog(logText, digest);
const spec = (steps: number): RunSpec => ({ experiment: "picked-segments", presetId: "breeder", condition: "treatment", seed: 1, steps, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, picked: true, pickLog: digest, pickImplicit: true });
const window = (start: number, steps: number, entries: readonly PickEntry[] = all) => entries.filter((e) => e.step > start && e.step <= start + steps);
const host = { host: "test", adapter: "test" };
const device = await requestDevice(navigator.gpu, specConfig(spec(STEPS)));

try {
  const run = (steps: number, opts: Parameters<typeof runExperiment>[5]) => {
    const sink = new Mem();
    return runExperiment(device, spec(steps), sink, host, () => {}, { implicitRule: true, ...opts }).then((r) => ({ r, sink }));
  };

  const t0 = performance.now();
  const whole = await run(STEPS, { picks: all, keepFinal: true });
  const wholeFiles = Object.fromEntries(whole.sink.files);
  const wholePicks = parsePickLog(wholeFiles[PICKS_FILE]);
  check("the continuous picked run applied the log's donors at cycles 1 and 3, not the rule's", wholePicks[0].donors.join() === "3,9,12,0" && wholePicks[2].donors.join() === "5,12,3,1", JSON.stringify(wholePicks));
  check("...and the implicit cycle 2 took the arm's rule donors (by rule(implicit))", /"cycle":2.*"by":"rule\(implicit\)"/.test(wholeFiles[PICKS_FILE]));
  check("...conserving exactly", whole.r.summary.conservationOk);

  const ignoring = await run(STEPS, { picks: [], keepFinal: true });
  check("a continuous run that ignores the log has another finalHash (so the equalities below prove the picks travelled)", ignoring.r.summary.finalHash !== whole.r.summary.finalHash);
  console.log(`  info: continuous ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  const chain = async (dropAll: boolean) => {
    const bounds = [0, ...CUTS, STEPS];
    const segs: StitchSegment[] = [];
    let start: WorldState | undefined;
    let observer: ObserverState | undefined;
    let last: Awaited<ReturnType<typeof run>> | undefined;
    let conserved = true, accepted = true, detail = "";
    for (let k = 0; k + 1 < bounds.length; k++) {
      const steps = bounds[k + 1] - bounds[k];
      // runIsland's own cut: only the entries in (start, start + steps]; a lossy island drops them all.
      const picks = window(bounds[k], steps).filter(() => !dropAll);
      const out = await run(steps, { start, observer, picks, keepFinal: true });
      conserved &&= out.r.summary.conservationOk;
      segs.push({ index: k, startStep: bounds[k], steps, digest: out.r.summary.finalHash, files: Object.fromEntries(out.sink.files) });
      last = out;
      if (k + 2 === bounds.length) break;
      const decoded = decodeArtifact(encodeCheckpoint(out.r.final!, out.r.observer));
      if (decoded.state.step !== bounds[k + 1] || stateHash(decoded.state) !== stateHash(out.r.final!)) accepted = false, detail ||= `cut ${bounds[k + 1]}: artifact differs`;
      const why = continuationError(spec(bounds[k + 2] - bounds[k + 1]), decoded.state, decoded.observer);
      if (why) accepted = false, detail ||= `cut ${bounds[k + 1]}: ${why}`;
      start = decoded.state;
      observer = decoded.observer;
    }
    return { segs, last: last!, conserved, accepted, detail };
  };

  const t1 = performance.now();
  const c = await chain(false);
  check(`every segment conserves exactly (cuts ${CUTS.join(", ")}: a cycle step and mid-cycle)`, c.conserved);
  check("each cut's artifact decodes to its state and continuationError accepts it for the next segment", c.accepted, c.detail);
  check("the chain's finalHash equals the continuous picked run's", c.last.r.summary.finalHash === whole.r.summary.finalHash, `${c.last.r.summary.finalHash} vs ${whole.r.summary.finalHash}`);
  check("...and its stateHash", stateHash(c.last.r.final!) === stateHash(whole.r.final!));

  const stitched = stitchRun(c.segs, STEPS, { pickLog: logText });
  for (const f of VERIFIED_FILES) {
    if (wholeFiles[f] === undefined && stitched[f] === undefined) continue;
    check(`stitched ${f} equals the continuous run's`, stitched[f] === wholeFiles[f], `${stitched[f]?.length} vs ${wholeFiles[f]?.length} bytes`);
  }
  const stitchedPicks = parsePickLog(stitched[PICKS_FILE]);
  check("stitched picks.jsonl holds the continuous run's applied entries (step, cycle, donors in order)", JSON.stringify(stitchedPicks) === JSON.stringify(wholePicks));
  const sm = JSON.parse(stitched["manifest.json"]).picks, wm = JSON.parse(wholeFiles["manifest.json"]).picks;
  check("the stitched manifest's picks block equals the continuous run's (file, picker, counts, digest)", JSON.stringify(sm) === JSON.stringify(wm), `${JSON.stringify(sm)} vs ${JSON.stringify(wm)}`);
  console.log(`  info: chain ${((performance.now() - t1) / 1000).toFixed(1)} s; picks block ${JSON.stringify(sm)}`);

  const lossy = await chain(true);
  check("a chain whose segments dropped every pick has another finalHash than the continuous run", lossy.last.r.summary.finalHash !== whole.r.summary.finalHash);
  let lossyStitch = "";
  try {
    stitchRun(lossy.segs, STEPS, { pickLog: logText });
  } catch (e) {
    lossyStitch = (e as Error).message;
  }
  check("...and stitchRun refuses it against the log (the applied cycle-1 donors are the rule's)", /picked run: at t=5000 the run applied donors .*the pick log says \[3, 9, 12, 0\]/.test(lossyStitch), lossyStitch);

  // A pick naming a pond that is not occupied: fails at its boundary, world unchanged.
  const bad: PickEntry[] = [...input.slice(0, 1), { step: 10_000, cycle: 2, donors: [999] }];
  const sink = new Mem();
  let failure: unknown;
  try {
    await runExperiment(device, spec(10_500), sink, host, () => {}, { picks: bad, implicitRule: true });
  } catch (e) {
    failure = e;
  }
  const failedPicks = sink.files.get(PICKS_FILE) ?? "";
  check("a pick naming a pond that does not exist fails at its boundary with a PickError", failure instanceof PickError && /pond cycle 2 at t=10000/.test(failure.message), String(failure));
  check("...a failed line is the last of picks.jsonl, and ponds.tsv has no row for cycle 2 (the world is as it was before the boundary)", /"kind":"failed","cycle":2/.test(failedPicks.trimEnd().split("\n").pop()!) && !/^2\t/m.test(sink.files.get("ponds.tsv") ?? ""));
} finally {
  device.destroy();
}
console.log(ok ? "\nALL PASS" : "\nFAILURES");
if (!ok) Deno.exit(1);
