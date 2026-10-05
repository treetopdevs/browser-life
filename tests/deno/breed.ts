// The breeder through the shared runner, end to end on a native WebGPU device (wild sandbox;
// WorldConfig.pondScore). On ponds-small (2 x 2 ponds) with a 4,000-step period and heavy mutation, so that
// some pond scores within a few cycles:
//
//  1. pond-breed-drive, pond-mass-drive, pond-drift-drive and the combined score's pond-breed-drive+seed+body each
//     conserve matter and energy exactly and write ponds.tsv with their score's header (the breeder's columns, plus
//     one per term under the combined score), one row per pond per boundary;
//  2. each boundary's rows are `applyPondCycle` on that boundary's pre-cycle checkpoint with the config's score;
//     the checkpoint the run writes at that step is that transform's state; and the GPU really holds it: that
//     state stepped one period on a fresh simulation is the next boundary's pre-cycle readback, bit for bit;
//  3. a run cut at a mid-period census step and at a cycle step, then stitched, equals the continuous run in its
//     final hash and in every verified file, byte for byte;
//  4. the controls only measure: pond-mass-drive has the physics and v1 rows of the scaf arm (treatment), and
//     pond-drift-drive those of pond-rand;
//  5. the breeder departs from its mass control once a pond scores: its donors are then the scoring ponds, and
//     the two histories end in different physical states;
//  6. donors picked by hand (applyBoundary's `picks`, the lab's breeder) reach the GPU: the readback after the
//     boundary is `applyPondCycle` with those picks, and it steps on as that state does.
//
// Run from the repo root: deno run -A tests/deno/breed.ts
import {
  POND_COLUMNS,
  PRESETS,
  applyPondCycle,
  breedPondColumns,
  canonicalGenome,
  digestWords,
  initWorld,
  presetConfig,
  stateHash,
  type WorldState,
} from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { PONDS_FILE, SPECIES_FILE, VERIFIED_FILES, applyBoundary, decodeArtifact, pondCensus, pondContext, runExperiment, specConfig, stitchRun, type ObserverState, type RunSpec, type Sink, type StitchSegment } from "@bl/runner";

class Mem implements Sink {
  files = new Map<string, string>();
  bytes = new Map<string, Uint8Array>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes(p: string, b: Uint8Array) { this.bytes.set(p, b); }
}

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail}` : ""}`);
  ok &&= cond;
};

const u64 = (v: bigint) => [Number(v & 0xffffffffn), Number((v >> 32n) & 0xffffffffn)];
/** Everything physical in a state (step, ledger, cells, canonical genome) without the config, as tests/deno/ponds.ts compares runs whose conditions differ. */
function physicalDigest(s: WorldState): string {
  let [a, b] = digestWords(Uint32Array.of(s.step, ...u64(s.lightIn), ...u64(s.heatOut), ...s.flux.flatMap(u64)));
  [a, b] = digestWords(s.cells, a, b);
  [a, b] = digestWords(canonicalGenome(s.genome), a, b);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const host = { host: "test", adapter: "test" };
const device = await requestDevice(navigator.gpu, presetConfig(pondsSmall, 1));

interface Run {
  finalHash: string;
  final: WorldState;
  observer: ObserverState;
  conservationOk: boolean;
  files: Record<string, string>;
  bytes: Map<string, Uint8Array>;
}
async function run(spec: RunSpec, opts: { start?: WorldState; observer?: ObserverState } = {}): Promise<Run> {
  const sink = new Mem();
  const r = await runExperiment(device, spec, sink, host, () => {}, { start: opts.start, observer: opts.observer, keepFinal: true });
  return { finalHash: r.summary.finalHash, final: r.final!, observer: r.observer, conservationOk: r.summary.conservationOk, files: Object.fromEntries(sink.files), bytes: sink.bytes };
}

/** Steps `state` on a fresh GPU simulation with no observer and no pond cycle (GpuSim knows nothing of the pond keys), draining the mutation ledger as the runner does. */
async function stepPlain(state: WorldState, steps: number): Promise<WorldState> {
  const sim = await GpuSim.create(device, state);
  try {
    for (let s = 0; s < steps; ) {
      const chunk = Math.min(100, steps - s);
      for (let k = 0; k < chunk; k += 64) sim.run(Math.min(64, chunk - k));
      s += chunk;
      await device.queue.onSubmittedWorkDone();
      if ((await sim.drainLedger()).dropped > 0) throw new Error("event buffer overflow");
    }
    return await sim.readState();
  } finally {
    sim.destroy();
  }
}

/** ponds.tsv as header-keyed rows. */
function tsv(text: string): Record<string, string>[] {
  const [header, ...lines] = text.trimEnd().split("\n");
  const names = header.split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [names[i], v])));
}
const v1Text = (text: string) => tsv(text).map((r) => POND_COLUMNS.map((c) => r[c]).join("\t")).join("\n");

const CYCLES = 4, PERIOD = 4000;
// Heavy mutation (the golden cases' rate) and a period long enough for a mutant with motility gain to grow into
// counted cells, so that a pond scores within the run. Seed 3 because there the scoring pond is not always the
// heaviest, so the breeder and its mass control choose different donors (at seed 1 they never do, and at seed 2
// no pond scores).
const base = { experiment: "breed-test", presetId: "ponds-small", seed: 3, steps: CYCLES * PERIOD, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, speciesCensus: true, overrides: { mutRate: 60_000_000, pondPeriod: PERIOD } } as const;
const spec = (condition: string): RunSpec => ({ ...base, condition });
const boundaries = Array.from({ length: CYCLES }, (_, k) => k + 1);

try {
  const whole: Record<string, Run> = {};
  for (const [condition, arm, score] of [["pond-breed-drive", "breed", "drive"], ["pond-mass-drive", "scaf", "drive"], ["pond-drift-drive", "rand", "drive"], ["pond-breed-drive+seed+body", "breed", "drive+seed+body"]] as const) {
    const columns = breedPondColumns(score);
    const cfg = specConfig(spec(condition));
    const Mr = pondContext(initWorld(cfg, pondsSmall.init))!.Mr;
    const r = (whole[condition] = await run({ ...spec(condition), preCycleCheckpoints: boundaries, checkpointEvery: PERIOD }));

    // --- 1. conservation, header, row count
    check(`${condition}: the config has arm ${arm} and score ${score}`, cfg.pondArm === arm && cfg.pondScore === score, JSON.stringify([cfg.pondArm, cfg.pondScore]));
    check(`${condition}: conserves matter and energy exactly`, r.conservationOk);
    const text = r.files[PONDS_FILE];
    const rows = tsv(text);
    check(`${condition}: ponds.tsv has its score's header (${columns.length} columns)`, text.startsWith(columns.join("\t") + "\n"), text.split("\n", 1)[0]);
    check(
      `${condition}: ...and one row per pond for each of the ${CYCLES} boundaries`,
      rows.length === 4 * CYCLES && boundaries.every((b) => rows.filter((x) => Number(x.cycle) === b && Number(x.step) === b * PERIOD).length === 4),
      `${rows.length} rows`,
    );

    // --- 2. each boundary is applyPondCycle on its pre-cycle checkpoint
    let rowsOk = true, stateOk = true, gpuOk = true, detail = "", stateDetail = "", gpuDetail = "";
    const preAt = (b: number) => decodeArtifact(r.bytes.get(`checkpoints/b${String(b).padStart(3, "0")}-pre.blck`)!).state;
    for (const b of boundaries) {
      const pre = preAt(b);
      const want = applyPondCycle(pre, b, arm, 8, Mr, pondCensus, score);
      const got = rows.filter((x) => Number(x.cycle) === b).map((x) => columns.map((c) => x[c]).join("\t"));
      const expected = want.rows.map((x) => columns.map((c) => String(x[c])).join("\t"));
      if (JSON.stringify(got) !== JSON.stringify(expected)) { rowsOk = false; detail ||= `boundary ${b}`; }
      // The periodic checkpoint at a cycle step serialises the transform's own state (a check of what is written).
      const post = decodeArtifact(r.bytes.get(`checkpoints/t${String(b * PERIOD).padStart(9, "0")}.blck`)!).state;
      if (stateHash(post) !== stateHash(want.state)) { stateOk = false; stateDetail ||= `boundary ${b}: ${stateHash(post)} vs ${stateHash(want.state)}`; }
      // What the GPU holds after the upload: the next boundary's pre-cycle checkpoint is a readback of the run's
      // simulation one period later, so it must be the transform's state stepped one period. A dropped or wrong
      // upload would show here.
      if (b < CYCLES) {
        const stepped = await stepPlain(want.state, PERIOD);
        const next = preAt(b + 1);
        if (stateHash(stepped) !== stateHash(next)) { gpuOk = false; gpuDetail ||= `boundary ${b}: ${stateHash(stepped)} vs ${stateHash(next)}`; }
      } else if (stateHash(r.final) !== stateHash(want.state)) {
        // The run ends on its last boundary: its final state is a readback of the simulation right after that upload.
        gpuOk = false;
        gpuDetail ||= `boundary ${b} (the run's final readback): ${stateHash(r.final)} vs ${stateHash(want.state)}`;
      }
    }
    check(`${condition}: every boundary's rows are applyPondCycle's on its pre-cycle checkpoint`, rowsOk, detail);
    check(`${condition}: ...the checkpoint written at each cycle step is that transform's state`, stateOk, stateDetail);
    check(`${condition}: ...and the GPU holds it: one period later its readback is the transform's state stepped one period, and the run's final readback is the last transform's state`, gpuOk, gpuDetail);

    // --- 3. segments: a mid-period cut and a cut at a cycle step, stitched
    const cuts = [6500, 12_000], bounds = [0, ...cuts, base.steps];
    const segs: StitchSegment[] = [];
    let prev: Run | undefined;
    for (let k = 0; k + 1 < bounds.length; k++) {
      const steps = bounds[k + 1] - bounds[k];
      const seg: Run = await run({ ...spec(condition), steps }, { start: prev?.final, observer: prev?.observer });
      segs.push({ index: k, startStep: bounds[k], steps, digest: seg.finalHash, files: seg.files });
      prev = seg;
    }
    const plain = await run(spec(condition));
    check(`${condition}: checkpoints, pre-cycle and periodic, do not change the run`, plain.finalHash === r.finalHash, `${plain.finalHash} vs ${r.finalHash}`);
    check(`${condition}: cut at ${cuts.join(" and ")}, the same finalHash as the continuous run`, prev!.finalHash === plain.finalHash, `${prev!.finalHash} vs ${plain.finalHash}`);
    const stitched = stitchRun(segs, base.steps);
    for (const f of VERIFIED_FILES) {
      const required = f === PONDS_FILE || f === SPECIES_FILE;
      check(`${condition}: stitched ${f} equals the continuous run's`, stitched[f] === plain.files[f] && (!required || plain.files[f] !== undefined), `${stitched[f]?.length} vs ${plain.files[f]?.length} bytes`);
    }
  }

  // --- 4. the controls only measure
  for (const [control, v1] of [["pond-mass-drive", "treatment"], ["pond-drift-drive", "pond-rand"]] as const) {
    const plain = await run(spec(v1));
    check(`${control}: the physics of ${v1} (final state without the config)`, physicalDigest(whole[control].final) === physicalDigest(plain.final));
    check(`${control}: ...a different state hash, since the config differs`, stateHash(whole[control].final) !== stateHash(plain.final));
    check(`${control}: ...and ${v1}'s ponds.tsv in the v1 columns`, v1Text(whole[control].files[PONDS_FILE]) === v1Text(plain.files[PONDS_FILE]) && plain.files[PONDS_FILE].startsWith(POND_COLUMNS.join("\t") + "\n"));
  }

  // --- 5. the breeder departs from the mass control once a pond scores
  const breed = tsv(whole["pond-breed-drive"].files[PONDS_FILE]), mass = tsv(whole["pond-mass-drive"].files[PONDS_FILE]);
  const at = (rows: Record<string, string>[], b: number) => rows.filter((x) => Number(x.cycle) === b);
  const firstScoring = boundaries.find((b) => at(breed, b).some((x) => Number(x.score) > 0));
  check("some pond scores within the run (heavy mutation reaches motility)", firstScoring !== undefined);
  if (firstScoring !== undefined) {
    const same = (b: number) => JSON.stringify(at(breed, b)) === JSON.stringify(at(mass, b));
    check(`before any pond scores (boundaries < ${firstScoring}), the breeder is its mass control row for row`, boundaries.filter((b) => b < firstScoring).every(same));
    const scoring = at(breed, firstScoring);
    const best = Math.max(...scoring.map((x) => Number(x.score)));
    check(
      `at boundary ${firstScoring} every pond is seeded from the best-scoring pond (score ${best})`,
      scoring.every((x) => Number(x.donorScore) === best && Number(scoring[Number(x.donor)].score) === best),
      JSON.stringify(scoring.map((x) => [x.recipient, x.donor, x.score, x.donorScore])),
    );
    const differ = boundaries.find((b) => JSON.stringify(at(breed, b).map((x) => x.donor)) !== JSON.stringify(at(mass, b).map((x) => x.donor)));
    check("the breeder's donors differ from its mass control's at some boundary", differ !== undefined);
    check("...and the two histories end in different physical states", physicalDigest(whole["pond-breed-drive"].final) !== physicalDigest(whole["pond-mass-drive"].final));
  }

  // --- 6. donors picked by hand reach the GPU
  {
    const r = whole["pond-breed-drive+seed+body"];
    const cfg = specConfig(spec("pond-breed-drive+seed+body"));
    const ctx = pondContext(initWorld(cfg, pondsSmall.init))!;
    const pre = decodeArtifact(r.bytes.get("checkpoints/b002-pre.blck")!).state;
    // Not the rule's own choice: every occupied pond, in descending index.
    const picks = [3, 2, 1, 0].filter((p) => Number(tsv(r.files[PONDS_FILE]).find((x) => Number(x.cycle) === 2 && Number(x.recipient) === p)!.recipientTrait) > 0);
    const auto = applyPondCycle(pre, 2, "breed", 8, ctx.Mr, pondCensus, "drive+seed+body");
    const want = applyPondCycle(pre, 2, "breed", 8, ctx.Mr, pondCensus, "drive+seed+body", picks);
    check(`picks ${picks.join(", ")} at boundary 2 are not the rule's donors (${auto.donors.join(", ")})`, JSON.stringify(picks) !== JSON.stringify(auto.donors) && stateHash(want.state) !== stateHash(auto.state));
    const sim = await GpuSim.create(device, pre);
    try {
      const res = await applyBoundary(sim, pre.step, ctx, picks);
      check("picked donors: the boundary reports them and the cycle's rows", JSON.stringify(res.ponds!.donors) === JSON.stringify(picks) && JSON.stringify(res.ponds!.rows) === JSON.stringify(want.rows));
      const held = await sim.readState();
      check("picked donors: the GPU holds applyPondCycle's state with those picks", stateHash(held) === stateHash(want.state), `${stateHash(held)} vs ${stateHash(want.state)}`);
      // As stepPlain steps: 100 at a time, the ledger drained after each.
      for (let k = 0; k < 2; k++) {
        sim.run(64);
        sim.run(36);
        await device.queue.onSubmittedWorkDone();
        await sim.drainLedger();
      }
      const on = await sim.readState();
      const ref = await stepPlain(want.state, 200);
      check("picked donors: ...and steps on from it as that state does", stateHash(on) === stateHash(ref), `${stateHash(on)} vs ${stateHash(ref)}`);
      let refused = "";
      try { await applyBoundary(sim, on.step, ctx, picks); } catch (e) { refused = String(e); }
      check("picks away from a pond boundary are refused", /not a pond boundary/.test(refused), refused);
    } finally {
      sim.destroy();
    }
  }
} finally {
  device.destroy();
}
console.log(ok ? "\nALL PASS" : "\nFAILURES");
if (!ok) Deno.exit(1);
