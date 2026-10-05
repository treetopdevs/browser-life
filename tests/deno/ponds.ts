// Pond runs through the shared runner, end to end on a native WebGPU device
// (docs/scaffold-integration-v1.md, "Acceptance tests"):
//
//  2. standalone equivalence: preset `ponds` reproduces the histories tools/scaffold.ts recorded
//     under runs/scaffold -- scaf and rand to boundary 11 by physical digest and ponds.tsv rows,
//     cont by its ponds.tsv rows for boundaries 1-11;
//  3. segment parity on ponds-small (6 cycles, species census on) for scaf, rand and cont: cuts at a
//     mid-period census step, exactly at a cycle step and at three cycle steps; a history that ends
//     and keeps stepping through no-donor cycles; stitchRun's ponds.tsv rejections;
//  4. the continuation guard: a pre-cycle state at a cycle step is refused (a runner artifact edited
//     to lastCycle - 1, and tools/scaffold.ts's own b<C>-pre checkpoint), a post-cycle one accepted;
//  5. controls: pond-cont has the physics of the config without pond keys and scaf and rand do not,
//     default-off parity, the exclusions, and recipientLineages' definition;
//  6. the GPU side of the CPU-reference pin: the runner reaches the states and rows
//     packages/runner/test/ponds.test.ts pins;
//  7. opt-in pre-cycle checkpoints (RunSpec.preCycleCheckpoints; Amendment 3): a run that writes
//     them is otherwise the run that does not, and each one is the state before its boundary's cycle;
//  8. the transition hunt's arms nat and shuf (docs/scaffold-transition-hunt-v1.md, "The current";
//     Amendment 4) on ponds-small, in two regimes (the hunt's own, where nothing exports at this scale
//     and every dying pond is refilled with A only, and a small export zone with a lower death rate,
//     where donors, survivors and shuf's permutation all occur): conservation, one ponds.tsv row per
//     pond per boundary with the extended header, 2,000 + 2,000 steps equal to 4,000 byte for byte, and
//     each boundary's transform equal to `applyCurrentCycle` on the pre-cycle checkpoint;
//  9. branch runs (RunSpec.branch, "Branch contract"): from a treatment history's pre-cycle checkpoint,
//     the first transform equals `applyCurrentCycle` on the decoded source (rows, post-transform hash),
//     the manifest records the branch and no initHash, and the branch in two segments equals one.
//
// Test 2 reads runs/scaffold/rep/main/{scaf,rand}/i0 and runs/scaffold/r3rep/main/cont/i0 and steps
// 330,000 steps at 512 x 512 (several minutes on the Mac). Tests 3 and 4 run tools/scaffold.ts itself
// on ponds-small, into a temporary directory, for their standalone side.
//
// Run from the repo root: deno run -A tests/deno/ponds.ts [equivalence] [parity] [guard] [controls] [pin] [precycle] [natshuf] [branch]
// (no argument runs every section).
import {
  CH,
  G,
  GENOME_CHANNELS,
  HUNT_POND_COLUMNS,
  POND_COLUMNS,
  PRESETS,
  applyCurrentCycle,
  applyPondCycle,
  canonicalConfig,
  canonicalGenome,
  cellCount,
  contRows,
  digestWords,
  encodeCheckpoint,
  initWorld,
  pondMatter,
  presetConfig,
  stateHash,
  validateConfig,
  type WorldState,
} from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import {
  PONDS_FILE,
  SPECIES_FILE,
  VERIFIED_FILES,
  applyBoundary,
  continuationError,
  decodeArtifact,
  pondCensus,
  pondContext,
  pondTsvRows,
  runExperiment,
  specConfig,
  stitchRun,
  type ObserverState,
  type RunSpec,
  type Sink,
  type StitchSegment,
} from "@bl/runner";
import { loadCheckpoint } from "../../tools/lib/pond-gpu.ts";

const ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const RECORDED = `${ROOT}runs/scaffold`;
const SECTIONS = ["equivalence", "parity", "guard", "controls", "pin", "precycle", "natshuf", "branch"];
const sections = new Set(Deno.args);
for (const a of sections) if (!SECTIONS.includes(a)) throw new Error(`unknown section ${a}; the sections are ${SECTIONS.join(", ")}`);
const section = (name: string) => sections.size === 0 || sections.has(name);

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
/** Passes when `f` throws (or rejects) with a message matching `re`. */
async function rejects(name: string, f: () => unknown, re: RegExp) {
  try {
    await f();
    check(name, false, "accepted");
  } catch (e) {
    check(name, re.test((e as Error).message), (e as Error).message);
  }
}

const u64 = (v: bigint) => [Number(v & 0xffffffffn), Number((v >> 32n) & 0xffffffffn)];
/**
 * Everything physical in a state -- step, ledger (light, heat, fluxes), cells and canonical genome
 * -- without the config: `stateHash` minus its config section. A runner pond run and
 * tools/scaffold.ts's history of it have configs that differ by the pond keys alone (checked in test
 * 2), so this is what "the same state" means between them; it also compares runs whose conditions
 * differ (test 5).
 */
function physicalDigest(s: WorldState): string {
  let [a, b] = digestWords(Uint32Array.of(s.step, ...u64(s.lightIn), ...u64(s.heatOut), ...s.flux.flatMap(u64)));
  [a, b] = digestWords(s.cells, a, b);
  [a, b] = digestWords(canonicalGenome(s.genome), a, b);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const sha256 = async (text: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");

/** A text file's lines, streamed (the recorded ponds.tsv files are read only as far as needed). */
async function* fileLines(path: string): AsyncGenerator<string> {
  const file = await Deno.open(path);
  let rest = "";
  for await (const chunk of file.readable.pipeThrough(new TextDecoderStream())) {
    const parts = (rest + chunk).split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (rest) yield rest;
}

/** Column index of each `POND_COLUMNS` name in the rows `pondRows` returns. */
const COL = Object.fromEntries(POND_COLUMNS.map((c, i) => [c, i])) as Record<(typeof POND_COLUMNS)[number], number>;
/** ponds.tsv rows read by header, each as its `POND_COLUMNS` values in order, up to cycle `maxCycle` (rows are in cycle order). */
async function pondRows(lines: Iterable<string> | AsyncIterable<string>, maxCycle = Infinity): Promise<string[][]> {
  let cols: number[] | null = null;
  const out: string[][] = [];
  for await (const line of lines) {
    if (!line) continue;
    const f = line.split("\t");
    if (!cols) {
      cols = POND_COLUMNS.map((c) => f.indexOf(c));
      if (cols.includes(-1)) throw new Error(`ponds.tsv header lacks ${POND_COLUMNS[cols.indexOf(-1)]}`);
      continue;
    }
    const row = cols.map((i) => f[i]);
    if (Number(row[COL.cycle]) > maxCycle) break;
    out.push(row);
  }
  return out;
}
const sameRows = (a: string[][], b: string[][]) => a.length === b.length && a.every((r, i) => r.join("\t") === b[i].join("\t"));
const firstDiff = (a: string[][], b: string[][]) => {
  const i = a.findIndex((r, k) => r.join("\t") !== b[k]?.join("\t"));
  return `${a.length} vs ${b.length} rows; first difference at row ${i}: ${a[i]?.join(" ")} | ${b[i]?.join(" ")}`;
};

/** ponds.tsv rows of the hunt's arms, by header: one record of column name to text per row. */
function huntRows(text: string): Record<string, string>[] {
  const [head, ...lines] = text.split("\n").filter(Boolean).map((l) => l.split("\t"));
  return lines.map((f) => Object.fromEntries(head.map((c, i) => [c, f[i]])));
}
const bytesEqual = (a: Uint8Array | undefined, b: Uint8Array | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

const host = { host: "test", adapter: "test" };
const ponds = PRESETS.find((p) => p.id === "ponds")!;
const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
// The largest world here (8 x 8 ponds) sizes the device.
const device = await requestDevice(navigator.gpu, presetConfig(ponds, 1));

interface Run {
  finalHash: string;
  final: WorldState;
  observer: ObserverState;
  conservationOk: boolean;
  files: Record<string, string>;
  bytes: Map<string, Uint8Array>;
}
async function run(spec: RunSpec, opts: { start?: WorldState; observer?: ObserverState; branchFrom?: WorldState; verbose?: boolean } = {}): Promise<Run> {
  const sink = new Mem();
  const r = await runExperiment(device, spec, sink, host, opts.verbose ? (m) => console.log(`  ${m}`) : () => {}, { start: opts.start, observer: opts.observer, branchFrom: opts.branchFrom, keepFinal: true });
  return { finalHash: r.summary.finalHash, final: r.final!, observer: r.observer, conservationOk: r.summary.conservationOk, files: Object.fromEntries(sink.files), bytes: sink.bytes };
}
/** The checkpoint artifact a run wrote at `step`. */
const artifactAt = (r: Run, step: number) => decodeArtifact(r.bytes.get(`checkpoints/t${String(step).padStart(9, "0")}.blck`)!);

/**
 * `spec` run in segments cut at `cuts` (absolute steps), each continuing from its predecessor's final
 * state and observer, then stitched. Without periodic checkpoints, which stitching refuses; they
 * touch neither the physics nor any verified file, so the continuous runs keep theirs.
 */
async function segmented(full: RunSpec, cuts: number[]) {
  const spec: RunSpec = { ...full, checkpointEvery: 0 };
  const bounds = [0, ...cuts, spec.steps];
  const segs: StitchSegment[] = [];
  const runs: Run[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const steps = bounds[k + 1] - bounds[k];
    const r = await run({ ...spec, steps }, { start: runs[k - 1]?.final, observer: runs[k - 1]?.observer });
    segs.push({ index: k, startStep: bounds[k], steps, digest: r.finalHash, files: r.files });
    runs.push(r);
  }
  return { finalHash: runs[runs.length - 1].finalHash, files: stitchRun(segs, spec.steps), segs, runs };
}

const continuousRuns = new Map<string, Promise<Run>>();
/** One continuous run per spec, shared between sections. */
const continuous = (spec: RunSpec) => {
  const key = JSON.stringify(spec);
  if (!continuousRuns.has(key)) continuousRuns.set(key, run(spec));
  return continuousRuns.get(key)!;
};

/** Every verified file byte-identical between a stitched and a continuous run; a pond run's ponds.tsv and species.tsv must be there. */
function sameVerified(label: string, got: Record<string, string>, want: Record<string, string>) {
  for (const f of VERIFIED_FILES) {
    const required = f === PONDS_FILE || f === SPECIES_FILE;
    check(`${label}: ${f}`, got[f] === want[f] && (!required || want[f] !== undefined), `${got[f]?.length} vs ${want[f]?.length} bytes`);
  }
}

/** Steps `state` on the GPU with no observer and no pond cycle (GpuSim knows nothing of the pond keys), draining the mutation ledger as the runner does. */
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

// tools/scaffold.ts itself, on ponds-small's world (2 x 2 ponds, clone of founder 2, seed 1), into a
// temporary directory: the standalone side of tests 3 and 4.
const tmp = await Deno.makeTempDir({ prefix: "bl-ponds-" });
const standaloneRuns = new Map<string, Promise<string>>();
function standalone(name: string, args: string[]): Promise<string> {
  if (!standaloneRuns.has(name))
    standaloneRuns.set(
      name,
      (async () => {
        const out = `${tmp}/${name}`;
        const argv = ["run", "-A", "--config", `${ROOT}deno.json`, `${ROOT}tools/scaffold.ts`, "evolve", "--init", "clone", "--side", "2", "--seed", "1", "--allow-any-seed", ...args, "--out", out];
        const { code, stderr } = await new Deno.Command(Deno.execPath(), { args: argv, cwd: ROOT, stdout: "null", stderr: "piped" }).output();
        if (code !== 0) throw new Error(`tools/scaffold.ts ${name} failed: ${new TextDecoder().decode(stderr)}`);
        return out;
      })(),
    );
  return standaloneRuns.get(name)!;
}
const standaloneScaf = () => standalone("scaf", ["--arm", "scaf", "--k", "8", "--period", "1000", "--cycles", "4"]);
const standaloneScafEnds = () => standalone("scaf-ends", ["--arm", "scaf", "--k", "8", "--period", "200", "--cycles", "4"]);

// ponds-small, 6 cycles, species census on, checkpoints at every cycle step (post-cycle states for tests 3 and 4).
const small: RunSpec = { experiment: "ponds", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 6000, censusEvery: 100, deepEvery: 10, checkpointEvery: 1000, speciesCensus: true };
const ARMS = [
  ["scaf", "treatment"],
  ["rand", "pond-rand"],
  ["cont", "pond-cont"],
] as const;

try {
  // --- 2. standalone equivalence (preset ponds vs runs/scaffold) -----------
  if (section("equivalence")) {
    for (const [arm, condition, seed, dir, post] of [
      ["scaf", "treatment", 4_811_001, "rep/main/scaf/i0", "b11-post"],
      ["rand", "pond-rand", 4_811_101, "rep/main/rand/i0", "b11-post"],
      ["cont", "pond-cont", 4_811_301, "r3rep/main/cont/i0", null],
    ] as const) {
      const fixture = `${RECORDED}/${dir}`;
      let meta: { arm: string; k: number; period: number; Mr: number[]; config: Record<string, unknown> };
      try {
        meta = JSON.parse(await Deno.readTextFile(`${fixture}/meta.json`));
      } catch (e) {
        check(`${arm}: recorded history ${fixture} is present`, false, (e as Error).message);
        continue;
      }
      // Census every 1,000 steps (the cycle's census callback reads the pre-cycle state itself, so the
      // cadence does not touch ponds.tsv or the physics); the standalone tool censused every 100.
      const spec: RunSpec = { experiment: "ponds-equivalence", presetId: "ponds", condition, seed, steps: 11 * 10_000, censusEvery: 1000, deepEvery: 1000, checkpointEvery: 0 };
      const cfg = specConfig(spec);
      const { pondPeriod, pondK, pondArm, ...physics } = cfg;
      check(
        `${arm}: the runner's config is the recorded one plus pondPeriod/pondK/pondArm`,
        canonicalConfig(physics) === canonicalConfig(meta.config as unknown as WorldState["cfg"]) && pondPeriod === meta.period && pondArm === meta.arm && (arm === "cont" || pondK === meta.k),
        `${canonicalConfig(physics)} vs ${JSON.stringify(meta.config)}`,
      );
      const init = initWorld(cfg, ponds.init);
      check(`${arm}: the ponds init kind builds the recorded start state`, physicalDigest(init) === physicalDigest(await loadCheckpoint(`${fixture}/ckpt/init.blck.gz`)));
      check(`${arm}: per-pond matter M_r equals the recorded one`, JSON.stringify(pondMatter(init)) === JSON.stringify(meta.Mr));
      console.log(`  ${arm}: ${spec.steps} steps of preset ponds, seed ${seed}, condition ${condition}`);
      const r = await run(spec, { verbose: true });
      check(`${arm}: conserves matter and energy exactly`, r.conservationOk);
      if (post) {
        const want = await loadCheckpoint(`${fixture}/ckpt/${post}.blck.gz`);
        check(`${arm}: the post-cycle state at boundary 11 equals the recorded ${post} (physical digest)`, r.final.step === want.step && physicalDigest(r.final) === physicalDigest(want), `${physicalDigest(r.final)} vs ${physicalDigest(want)}`);
      }
      const got = await pondRows(r.files[PONDS_FILE].split("\n"));
      const want = await pondRows(fileLines(`${fixture}/ponds.tsv`), 11);
      check(`${arm}: ponds.tsv rows of cycles 1-11 (${want.length}) equal the recorded ones, by header`, want.length === 11 * 64 && sameRows(got, want), firstDiff(got, want));
    }
  }

  // --- 3. segment parity on ponds-small ------------------------------------
  if (section("parity")) {
    for (const [arm, condition] of ARMS) {
      const spec: RunSpec = { ...small, condition };
      const whole = await continuous(spec);
      check(`${arm}: the continuous run conserves exactly`, whole.conservationOk);
      const flagged = whole.files["series.jsonl"].trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.afterCycle).map((x) => x.step);
      check(`${arm}: ...records 6 boundaries in ponds.tsv and flags the first census after each cycle`, (await pondRows(whole.files[PONDS_FILE].split("\n"))).length === 24 && flagged.join() === "1100,2100,3100,4100,5100", flagged.join());
      for (const cuts of [[2500], [3000], [1000, 3000, 5000]]) {
        const seg = await segmented(spec, cuts);
        const label = `${arm} cut at ${cuts.join(", ")}`;
        check(`${label}: finalHash`, seg.finalHash === whole.finalHash, `${seg.finalHash} vs ${whole.finalHash}`);
        sameVerified(label, seg.files, whole.files);
        // A join at a cycle step: the predecessor's last census and the successor's start both fall
        // there; the stitched file keeps one census of it, one row per pond, from the post-cycle state.
        for (const [k, cut] of cuts.entries()) {
          if (cut % 1000 !== 0) continue;
          const rows = seg.files[SPECIES_FILE].split("\n").filter((l) => l.split("\t", 1)[0] === String(cut));
          const successorStart = seg.segs[k + 1].files[SPECIES_FILE].split("\n").filter((l) => l.split("\t", 1)[0] === String(cut));
          const postCycle = artifactAt(whole, cut).state;
          check(
            `${label}: the join at t=${cut} has exactly one species row per pond, the post-cycle state's`,
            rows.length === 4 && rows.map((l) => l.split("\t")[1]).join() === "0,1,2,3" && rows.join("\n") === successorStart.join("\n") &&
              physicalDigest(seg.runs[k].final) === physicalDigest(postCycle),
            rows.join(" | "),
          );
          if (arm !== "cont") {
            // After the grind a pond holds only its landed packet, so no more living cells than landed.
            const landed = (await pondRows(seg.files[PONDS_FILE].split("\n"))).filter((r) => r[COL.step] === String(cut)).sort((a, b) => Number(a[COL.recipient]) - Number(b[COL.recipient])).map((r) => Number(r[COL.landed]));
            check(`${label}: ...and its living cells per pond are within that cycle's landed packets`, rows.every((l, p) => Number(l.split("\t")[3]) <= landed[p]), `${rows.join(" | ")} vs landed ${landed}`);
          }
        }
      }
    }

    // The continuous scaf run is tools/scaffold.ts's history of the same world.
    {
      const dir = await standaloneScaf();
      const whole = await continuous(small);
      const got = await pondRows(whole.files[PONDS_FILE].split("\n"), 4);
      const want = await pondRows(fileLines(`${dir}/ponds.tsv`));
      check("scaf: ponds-small's rows of cycles 1-4 equal tools/scaffold.ts's", sameRows(got, want), firstDiff(got, want));
      for (const b of [1, 2, 4])
        check(`scaf: t=${b * 1000} equals tools/scaffold.ts's b${b}-post (physical digest)`, physicalDigest(artifactAt(whole, b * 1000).state) === physicalDigest(await loadCheckpoint(`${dir}/ckpt/b${b}-post.blck.gz`)));
    }

    // No-donor continuation: at a 200-step period the history ends at cycle 2, where no pond is
    // eligible and every pond is cleared to nutrient (docs/scaffold-integration-v1.md Amendment 1);
    // the run steps on through cycles 3-6 in the A-only world and segments across a cycle step as any other.
    {
      const spec: RunSpec = { ...small, steps: 1200, checkpointEvery: 200, overrides: { pondPeriod: 200 } };
      const whole = await continuous(spec);
      const rows = await pondRows(whole.files[PONDS_FILE].split("\n"));
      const byCycle = (b: number) => rows.filter((r) => r[COL.cycle] === String(b));
      check("ended: cycle 1 has donors", byCycle(1).length === 4 && byCycle(1).every((r) => r[COL.donor] !== "-1"));
      check(
        "ended: cycles 2-6 take the no-donor path (donor -1, nothing landed, every pond's trait 0)",
        [2, 3, 4, 5, 6].every((b) => byCycle(b).length === 4 && byCycle(b).every((r) => r[COL.donor] === "-1" && r[COL.landed] === "0" && r[COL.recipientTrait] === "0")),
        rows.map((r) => `${r[COL.cycle]}:${r[COL.donor]}:${r[COL.recipientTrait]}`).join(" "),
      );
      check("ended: the run steps on to t=1200 and conserves exactly", whole.final.step === 1200 && whole.conservationOk);
      const dir = await standaloneScafEnds();
      const want = await pondRows(fileLines(`${dir}/ponds.tsv`));
      check("ended: rows of cycles 1-2 equal tools/scaffold.ts's (which stops there)", sameRows(rows.slice(0, 8), want), firstDiff(rows.slice(0, 8), want));
      for (const b of [1, 2])
        check(`ended: t=${b * 200} equals tools/scaffold.ts's b${b}-post (physical digest)`, physicalDigest(artifactAt(whole, b * 200).state) === physicalDigest(await loadCheckpoint(`${dir}/ckpt/b${b}-post.blck.gz`)));
      for (const cuts of [[800], [400, 600, 1000]]) {
        const seg = await segmented(spec, cuts);
        const label = `ended, cut at ${cuts.join(", ")}`;
        check(`${label}: finalHash`, seg.finalHash === whole.finalHash, `${seg.finalHash} vs ${whole.finalHash}`);
        sameVerified(label, seg.files, whole.files);
      }
    }

    // Stitching rejects a pond run with ponds.tsv missing from any segment, and a non-pond run carrying one.
    {
      const { segs } = await segmented(small, [1000, 3000, 5000]);
      const without = (s: StitchSegment): StitchSegment => {
        const { [PONDS_FILE]: _, ...files } = s.files;
        return { ...s, files };
      };
      for (const k of [0, 2, 3]) await rejects(`stitchRun rejects a pond run whose segment #${k} lacks ponds.tsv`, () => stitchRun(segs.map((s, i) => (i === k ? without(s) : s)), small.steps), /pond run but missing ponds\.tsv/);
      const spots: RunSpec = { experiment: "ponds-off", presetId: "spots", condition: "treatment", seed: 1, steps: 400, censusEvery: 100, deepEvery: 10, checkpointEvery: 0 };
      const plain = await segmented(spots, [200]);
      check("(fixture) a non-pond run stitches without ponds.tsv", !(PONDS_FILE in plain.files));
      const carrying = plain.segs.map((s, i) => (i === 1 ? { ...s, files: { ...s.files, [PONDS_FILE]: segs[0].files[PONDS_FILE] } } : s));
      await rejects("stitchRun rejects a non-pond run with ponds.tsv in a segment", () => stitchRun(carrying, spots.steps), /ponds\.tsv present on a run without the pond cycle/);
    }
  }

  // --- 4. continuation guard ------------------------------------------------
  if (section("guard")) {
    const whole = await continuous(small);
    const spec: RunSpec = { ...small, steps: 3000 };
    // A post-cycle artifact (every one a pond run writes at a cycle step) is accepted, and continues exactly.
    const bytes = whole.bytes.get("checkpoints/t000003000.blck")!;
    const { state, observer } = decodeArtifact(bytes);
    check("the runner's artifact at cycle step 3000 records lastCycle 3", observer.ponds?.lastCycle === 3, JSON.stringify(observer.ponds));
    check("a post-cycle artifact is accepted (continuationError)", continuationError(spec, state, observer) === null, String(continuationError(spec, state, observer)));
    const cont = await run(spec, { start: state, observer });
    check("...and continuing from it reproduces the continuous run's finalHash", cont.finalHash === whole.finalHash, `${cont.finalHash} vs ${whole.finalHash}`);

    // The same artifact edited to lastCycle - 1: it decodes, and is refused as a pre-cycle state.
    const edited = decodeArtifact(encodeCheckpoint(state, { ...observer, ponds: { lastCycle: 2 } }));
    check("an artifact edited to lastCycle - 1 is refused as pre-cycle (continuationError)", /pre-cycle state/.test(continuationError(spec, edited.state, edited.observer) ?? ""), String(continuationError(spec, edited.state, edited.observer)));
    await rejects("...and by runExperiment", () => runExperiment(device, spec, new Mem(), host, () => {}, { start: edited.state, observer: edited.observer }), /pre-cycle state/);

    // tools/scaffold.ts's b4-pre: this history's own state at t=4000 before cycle 4 (the runner's
    // post-cycle state at 3000 stepped 1,000 steps), which a continuation would carry past cycle 4.
    const pre = await loadCheckpoint(`${await standaloneScaf()}/ckpt/b4-pre.blck.gz`);
    check("(fixture) tools/scaffold.ts's b4-pre is this history's pre-cycle state at t=4000", physicalDigest(pre) === physicalDigest(await stepPlain(state, 1000)));
    const at4000 = artifactAt(whole, 4000);
    const spec4000: RunSpec = { ...small, steps: 2000 };
    await rejects("a standalone b<C>-pre as recorded (its config has no pond keys) is refused", () => runExperiment(device, spec4000, new Mem(), host, () => {}, { start: pre }), /config differs/);
    const grafted: WorldState = { ...pre, cfg: specConfig(spec4000) };
    await rejects("...under the pond config, without an observer", () => runExperiment(device, spec4000, new Mem(), host, () => {}, { start: grafted }), /requires the matching observer state/);
    const { ponds: _, ...noPonds } = at4000.observer;
    for (const [what, obs, re] of [
      ["with an observer at lastCycle 3 (its own: cycle 4 not applied)", { ...at4000.observer, ponds: { lastCycle: 3 } }, /pre-cycle state/],
      ["with an observer lacking the ponds field", noPonds as ObserverState, /pond-cycle field/],
    ] as const) {
      check(`...under the pond config ${what}: continuationError refuses it`, re.test(continuationError(spec4000, grafted, obs) ?? ""), String(continuationError(spec4000, grafted, obs)));
      await rejects(`...and runExperiment does`, () => runExperiment(device, spec4000, new Mem(), host, () => {}, { start: grafted, observer: obs }), re);
    }
  }

  // --- 5. controls ------------------------------------------------------------
  if (section("controls")) {
    const finals = new Map<string, WorldState>();
    for (const [arm, condition] of ARMS) finals.set(arm, (await continuous({ ...small, condition })).final);
    // The same config with the pond keys removed, stepped from the same start.
    const { pondPeriod: _p, pondK: _k, pondArm: _a, ...plainCfg } = specConfig({ ...small, condition: "pond-cont" });
    const plain = await stepPlain(initWorld(plainCfg, pondsSmall.init), small.steps);
    check("pond-cont has the physical digest of the same config without pond keys", physicalDigest(finals.get("cont")!) === physicalDigest(plain), `${physicalDigest(finals.get("cont")!)} vs ${physicalDigest(plain)}`);
    check("...though not its stateHash (the configs differ by the pond keys)", stateHash(finals.get("cont")!) !== stateHash(plain));
    for (const arm of ["scaf", "rand"]) check(`${arm} differs from it`, physicalDigest(finals.get(arm)!) !== physicalDigest(plain));

    // Default-off parity: no pond keys, no ponds.tsv, no ponds observer field.
    for (const p of PRESETS) {
      const c = presetConfig(p, 1);
      const has = [c.pondPeriod, c.pondK, c.pondArm].some((v) => v !== undefined);
      check(`preset ${p.id} ${has ? "has" : "has no"} pond keys`, has === (p.init.kind === "ponds"));
    }
    const off = await run({ experiment: "ponds-off", presetId: "spots", condition: "treatment", seed: 1, steps: 200, censusEvery: 100, deepEvery: 10, checkpointEvery: 100, speciesCensus: true });
    check("a run without pond keys writes no ponds.tsv", !(PONDS_FILE in off.files));
    check("...and no ponds observer field, in its result or its checkpoints", !("ponds" in off.observer) && [100, 200].every((t) => !("ponds" in artifactAt(off, t).observer)));
    check("...and flags no census afterCycle", !off.files["series.jsonl"].includes("afterCycle"));

    // Exclusions.
    const cfg = specConfig(small);
    check("the pond config itself validates", validateConfig(cfg).length === 0, validateConfig(cfg).join("; "));
    check("a pond config with tile migration fails validation", validateConfig({ ...cfg, migrationPeriod: 200, migrantCount: 4 }).some((e) => /cannot migrate/.test(e)));
    check("a pond config with ringNamespace fails validation", validateConfig({ ...cfg, ringNamespace: 1 }).some((e) => /metapopulation member/.test(e)));
    await rejects("a pond run with an immigrant fails at the runner's entry", () => runExperiment(device, small, new Mem(), host, () => {}, { immigrant: initWorld(cfg, pondsSmall.init) }), /cannot import an immigrant/);
    await rejects("a pond run in a metapopulation fails at the runner's entry", () => runExperiment(device, { ...small, metapopulation: { salt: 1, migrantCount: 4, ringNamespace: 1 } }, new Mem(), host), /cannot belong to a metapopulation/);
    for (const condition of ["pond-rand", "pond-cont"]) await rejects(`${condition} on a non-pond preset throws`, () => specConfig({ ...small, presetId: "spots", condition }), /needs a preset with the pond cycle/);

    // recipientLineages: protocol v1's count of distinct nonzero lineage ids among a pond's cells with
    // B+P >= 48 -- not components, not the census's individuals. Pond 0 of ponds-small's start world
    // gets a two-lineage component (its disc, half relabelled) and three lone cells of other lineages
    // at B+P = 32, 47 (below the threshold) and 48 (at it).
    {
      const s: WorldState = { ...initWorld(cfg, pondsSmall.init), step: 1000 };
      const n = cellCount(cfg), W = cfg.tilesX * cfg.tileW;
      const disc = 32 * W + 32;
      for (let y = 0; y < 64; y++)
        for (let x = 33; x < 64; x++) {
          const i = y * W + x;
          if (s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) [s.genome[G.LIN_HI * n + i], s.genome[G.LIN_LO * n + i]] = [0x77, 0x77];
        }
      const put = (x: number, y: number, B: number, P: number, hi: number, lo: number) => {
        const i = y * W + x;
        s.cells[CH.B * n + i] = B;
        s.cells[CH.P * n + i] = P;
        for (let w = 0; w < GENOME_CHANNELS; w++) s.genome[w * n + i] = s.genome[w * n + disc];
        [s.genome[G.LIN_HI * n + i], s.genome[G.LIN_LO * n + i]] = [hi, lo];
      };
      put(5, 5, 32, 0, 0x91, 1);
      put(10, 5, 16, 31, 0x92, 2);
      put(15, 5, 24, 24, 0x93, 3);
      const want = new Set<string>();
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const i = y * W + x, hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
          if (s.cells[CH.B * n + i] + s.cells[CH.P * n + i] >= 48 && (hi | lo)) want.add(`${hi}:${lo}`);
        }
      const census = pondCensus(s);
      const boundary = await applyBoundary({ cfg, readState: async () => s, upload: () => {} }, 1000, pondContext(s));
      const viaHook = boundary.ponds!.rows.find((r) => r.recipient === 0)!.recipientLineages;
      const viaCont = contRows(s, 1, pondCensus)[0].recipientLineages;
      check(
        "recipientLineages counts the lineages at B+P >= 48 (3 here: both of the mixed component's, and the cell at 48), in the runner's cycle and in cont rows",
        want.size === 3 && viaHook === 3 && viaCont === 3,
        `want ${want.size}, hook ${viaHook}, cont ${viaCont}`,
      );
      check("...which is not the census's count of distinct lineages among individuals", census.lineages[0] !== 3, `census ${JSON.stringify(census)}`);
    }
  }

  // --- 6. the CPU-reference pin, on the GPU ---------------------------------
  if (section("pin")) {
    // The values packages/runner/test/ponds.test.ts pins on the CPU reference: ponds-small at a
    // 20-step period, seed 1; scaf's post-cycle states at cycles 1-3 and its ponds.tsv, and rand's
    // post-cycle state at cycle 1 and its ponds.tsv.
    const PINS = {
      scaf: { states: ["f7364f1bd5459eb1", "e190dc48028a1033", "54f0297b6b5e0d44"], ponds: "f2d9686eff02ac2d3dde8430fbc510db19b5d21825b8d54e6129361bddf29c64" },
      rand: { state: "4b5741dce25be469", ponds: "b08a02496e7c96c93a4e8ee50f77e0ccc5fca22dfc47f70790ccce70767c200a" },
    };
    const spec: RunSpec = { experiment: "ponds-pin", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 60, censusEvery: 20, deepEvery: 10, checkpointEvery: 20, overrides: { pondPeriod: 20 } };
    const scaf = await run(spec);
    const states = [20, 40, 60].map((t) => stateHash(artifactAt(scaf, t).state));
    check("scaf: the runner's post-cycle states at cycles 1-3 equal the CPU-reference pins", JSON.stringify(states) === JSON.stringify(PINS.scaf.states), JSON.stringify(states));
    check("scaf: ...and its ponds.tsv", (await sha256(scaf.files[PONDS_FILE])) === PINS.scaf.ponds);
    const rand = await run({ ...spec, condition: "pond-rand", steps: 20 });
    check("rand: the runner's post-cycle state at cycle 1 equals the CPU-reference pin", stateHash(rand.final) === PINS.rand.state, stateHash(rand.final));
    check("rand: ...and its ponds.tsv", (await sha256(rand.files[PONDS_FILE])) === PINS.rand.ponds);
  }

  // --- 7. pre-cycle checkpoints ----------------------------------------------
  if (section("precycle")) {
    const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
    for (const [arm, condition] of ARMS) {
      // Boundary 4 is the run's last step, as in production (histories' b100, ancestors' b001).
      const spec: RunSpec = { experiment: "ponds-precycle", presetId: "ponds-small", condition, seed: 1, steps: 4000, censusEvery: 100, deepEvery: 10, checkpointEvery: 1000 };
      const plain = await run(spec);
      const withPre = await run({ ...spec, preCycleCheckpoints: [2, 4] });
      const mPlain = JSON.parse(plain.files["manifest.json"]), mPre = JSON.parse(withPre.files["manifest.json"]);
      const preFiles = (r: Run) => [...r.bytes.keys()].filter((f) => f.endsWith("-pre.blck")).sort();

      // The run that writes them is otherwise the run that does not.
      check(`${arm}: the same finalHash with and without pre-cycle checkpoints`, withPre.finalHash === plain.finalHash, `${withPre.finalHash} vs ${plain.finalHash}`);
      check(`${arm}: ...the same ponds.tsv bytes`, plain.files[PONDS_FILE] !== undefined && withPre.files[PONDS_FILE] === plain.files[PONDS_FILE]);
      const periodic = [...plain.bytes.keys()].sort();
      check(
        `${arm}: ...the same periodic checkpoints (manifest hashes and bytes)`,
        mPlain.checkpoints.length === 4 && JSON.stringify(mPre.checkpoints) === JSON.stringify(mPlain.checkpoints) && periodic.every((f) => sameBytes(withPre.bytes.get(f), plain.bytes.get(f))),
        `${JSON.stringify(mPre.checkpoints)} vs ${JSON.stringify(mPlain.checkpoints)}`,
      );
      const others = Object.keys(plain.files).filter((f) => f !== "manifest.json").sort();
      check(`${arm}: ...and every other file but manifest.json byte-identical`, JSON.stringify(Object.keys(withPre.files).filter((f) => f !== "manifest.json").sort()) === JSON.stringify(others) && others.every((f) => withPre.files[f] === plain.files[f]));
      check(
        `${arm}: without the field, no preCycleCheckpoints in the spec or manifest and no pre-cycle file`,
        !("preCycleCheckpoints" in mPlain) && !("preCycleCheckpoints" in mPlain.spec) && preFiles(plain).length === 0,
      );
      check(`${arm}: with it, the spec records the list`, JSON.stringify(mPre.spec.preCycleCheckpoints) === "[2,4]");
      const entries = mPre.preCycleCheckpoints as { boundary: number; step: number; file: string; hash: string }[];
      check(
        `${arm}: the manifest lists b002-pre and b004-pre, in boundary order, and exactly those files are written`,
        JSON.stringify(entries.map((e) => [e.boundary, e.step, e.file])) === JSON.stringify([[2, 2000, "checkpoints/b002-pre.blck"], [4, 4000, "checkpoints/b004-pre.blck"]]) &&
          JSON.stringify(preFiles(withPre)) === JSON.stringify(entries.map((e) => e.file)),
        JSON.stringify(entries),
      );

      // Each is the state before its boundary's cycle, with the pre-cycle observer.
      const cfg = specConfig(spec);
      const Mr = pondContext(initWorld(cfg, pondsSmall.init))!.Mr;
      for (const e of entries) {
        const { state, observer } = decodeArtifact(withPre.bytes.get(e.file)!);
        const preHash = stateHash(state);
        const post = artifactAt(plain, e.step);
        const postHash = stateHash(post.state);
        check(`${arm} b${e.boundary}: its step is ${e.boundary * 1000} and its observer's ponds.lastCycle is ${e.boundary - 1}`, state.step === e.boundary * 1000 && observer.ponds?.lastCycle === e.boundary - 1, `t=${state.step} ${JSON.stringify(observer.ponds)}`);
        check(`${arm} b${e.boundary}: its stateHash is the manifest's`, preHash === e.hash, `${preHash} vs ${e.hash}`);
        check(
          `${arm} b${e.boundary}: its observer is the periodic checkpoint's at that step but for ponds.lastCycle`,
          JSON.stringify({ ...observer, ponds: { lastCycle: e.boundary } }) === JSON.stringify(post.observer),
        );
        // The post-cycle state: applyPondCycle (CPU) of this one for scaf and rand, this one itself for cont.
        let cycledHash = preHash;
        if (arm === "cont") check(`${arm} b${e.boundary}: the pre-cycle state is the periodic checkpoint at t=${e.step}`, preHash === postHash, `${preHash} vs ${postHash}`);
        else {
          cycledHash = stateHash(applyPondCycle(state, e.boundary, cfg.pondArm as "scaf" | "rand", cfg.pondK!, Mr, pondCensus).state);
          check(`${arm} b${e.boundary}: it differs from the post-cycle state`, preHash !== postHash);
          check(`${arm} b${e.boundary}: applyPondCycle (CPU) on it gives the periodic checkpoint at t=${e.step}, the post-cycle state`, cycledHash === postHash, `${cycledHash} vs ${postHash}`);
        }
        if (e.step === spec.steps)
          check(
            `${arm} b${e.boundary}, the last step: ...and the final state of both runs`,
            cycledHash === stateHash(withPre.final) && cycledHash === stateHash(plain.final),
            `${cycledHash} vs ${stateHash(withPre.final)}, ${stateHash(plain.final)}`,
          );
        // A continuation from it would skip this boundary's cycle (the last one has nothing left to run).
        if (e.step < spec.steps) {
          const rest: RunSpec = { ...spec, steps: spec.steps - e.step };
          check(`${arm} b${e.boundary}: continuationError refuses it as a pre-cycle state`, /pre-cycle state/.test(continuationError(rest, state, observer) ?? ""), String(continuationError(rest, state, observer)));
          await rejects(`${arm} b${e.boundary}: ...and runExperiment does`, () => runExperiment(device, rest, new Mem(), host, () => {}, { start: state, observer }), /pre-cycle state/);
        }
        const more: RunSpec = { ...spec, steps: 1000 };
        check(`${arm} b${e.boundary}: continuationError refuses it for any further steps`, /pre-cycle state/.test(continuationError(more, state, observer) ?? ""), String(continuationError(more, state, observer)));
      }

      // A continuation from the post-cycle checkpoint at 2000 writes the same pre-cycle files as a
      // continuous run listing the same boundaries.
      const ref = await run({ ...spec, preCycleCheckpoints: [3, 4] });
      const at2000 = artifactAt(plain, 2000);
      const cont = await run({ ...spec, steps: 2000, preCycleCheckpoints: [3, 4] }, { start: at2000.state, observer: at2000.observer });
      const mRef = JSON.parse(ref.files["manifest.json"]), mCont = JSON.parse(cont.files["manifest.json"]);
      check(`${arm}: continued from t=2000, the same finalHash as the continuous run`, cont.finalHash === plain.finalHash, `${cont.finalHash} vs ${plain.finalHash}`);
      check(
        `${arm}: ...its b003-pre and b004-pre bytes equal the continuous run's`,
        ["checkpoints/b003-pre.blck", "checkpoints/b004-pre.blck"].every((f) => sameBytes(cont.bytes.get(f), ref.bytes.get(f))) && sameBytes(cont.bytes.get("checkpoints/b004-pre.blck"), withPre.bytes.get("checkpoints/b004-pre.blck")),
      );
      check(`${arm}: ...and its manifest lists the same entries`, mCont.preCycleCheckpoints.length === 2 && JSON.stringify(mCont.preCycleCheckpoints) === JSON.stringify(mRef.preCycleCheckpoints), `${JSON.stringify(mCont.preCycleCheckpoints)} vs ${JSON.stringify(mRef.preCycleCheckpoints)}`);
    }
  }

  // --- 8. the current's arms nat and shuf ---------------------------------------
  if (section("natshuf")) {
    for (const [arm, condition] of [["nat", "pond-nat"], ["shuf", "pond-shuf"]] as const) {
      for (const [regime, overrides] of [["the hunt's regime", undefined], ["export zone 12, death 3/8", { pondExport: 12, pondDeath: 24_576 }]] as const) {
        const label = `${arm}, ${regime}`;
        const spec: RunSpec = { experiment: "ponds-hunt", presetId: "ponds-small", condition, seed: 1, steps: 4000, censusEvery: 100, deepEvery: 10, checkpointEvery: 1000, ...(overrides ? { overrides } : {}) };
        const cfg = specConfig(spec);
        const Mr = pondContext(initWorld(cfg, pondsSmall.init))!.Mr;
        const whole = await run({ ...spec, preCycleCheckpoints: [2, 4] });
        const manifest = JSON.parse(whole.files["manifest.json"]);
        check(`${label}: the config has the arm and both keys`, cfg.pondArm === arm && cfg.pondDeath === (overrides?.pondDeath ?? 32_768) && cfg.pondExport === (overrides?.pondExport ?? 28), JSON.stringify([cfg.pondArm, cfg.pondDeath, cfg.pondExport]));
        check(`${label}: conserves matter and energy exactly`, whole.conservationOk);
        check(`${label}: no branch, and an initHash, in the manifest of an ordinary run`, !("branch" in manifest) && typeof manifest.initHash === "string");

        // ponds.tsv: the extended header and one row per pond per boundary.
        const text = whole.files[PONDS_FILE];
        const rows = huntRows(text);
        check(`${label}: ponds.tsv has the extended header`, text.startsWith(HUNT_POND_COLUMNS.join("\t") + "\n"), text.split("\n", 1)[0]);
        check(
          `${label}: ...and one row per pond (ascending) for each of the 4 boundaries`,
          rows.length === 16 && rows.every((r, i) => r.cycle === String(Math.floor(i / 4) + 1) && r.step === String(1000 * (Math.floor(i / 4) + 1)) && r.recipient === String(i % 4)),
          rows.map((r) => `${r.cycle}:${r.recipient}`).join(" "),
        );
        const byCycle = (b: number) => rows.filter((r) => r.cycle === String(b));
        check(
          `${label}: died, donor, landed and weight agree (a survivor has donor -2 and no packet; a recipient's donor weighs > 0)`,
          rows.every((r) => (r.died === "0") === (r.donor === "-2") && (r.donor === "-2" || r.donor === "-1" || Number(r.landed) > 0) && (Number(r.donor) < 0 || Number(byCycle(Number(r.cycle))[Number(r.donor)].weight) > 0)),
        );
        check(
          `${label}: ${arm === "nat" ? "weight is the export mass" : "the weights are a permutation of the export masses"} at every boundary`,
          [1, 2, 3, 4].every((b) => {
            const x = byCycle(b).map((r) => Number(r.exportMass)), w = byCycle(b).map((r) => Number(r.weight));
            return arm === "nat" ? x.join() === w.join() : [...x].sort((p, q) => p - q).join() === [...w].sort((p, q) => p - q).join();
          }),
        );
        if (overrides) check(`${label}: this regime has exporters, recipients with donors and survivors`, rows.some((r) => Number(r.exportMass) > 0) && rows.some((r) => Number(r.donor) >= 0) && rows.some((r) => r.donor === "-2"));
        else check(`${label}: nothing exports at this scale, so every dying pond is refilled with A only (donor -1)`, rows.every((r) => r.exportMass === "0" && (r.died === "0" ? r.donor === "-2" : r.donor === "-1")));
        const flagged = whole.files["series.jsonl"].trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.afterCycle).map((x) => x.step);
        check(`${label}: the first census after each of boundaries 1-3 is flagged`, flagged.join() === "1100,2100,3100", flagged.join());

        // 2,000 + 2,000 steps, the second from the first's checkpoint at 2,000, equal the 4,000.
        const first = await run({ ...spec, steps: 2000, preCycleCheckpoints: [2] });
        const at2000 = artifactAt(first, 2000);
        const second = await run({ ...spec, steps: 2000, preCycleCheckpoints: [4] }, { start: at2000.state, observer: at2000.observer });
        const header = HUNT_POND_COLUMNS.join("\t") + "\n";
        check(`${label}: segmented, the final hash is the continuous run's`, second.finalHash === whole.finalHash, `${second.finalHash} vs ${whole.finalHash}`);
        check(`${label}: ...ponds.tsv (the second segment's has the header and boundaries 3 and 4)`, second.files[PONDS_FILE].startsWith(header) && first.files[PONDS_FILE] + second.files[PONDS_FILE].slice(header.length) === text);
        check(`${label}: ...series.jsonl`, first.files["series.jsonl"] + second.files["series.jsonl"] === whole.files["series.jsonl"]);
        const want: [string, Run][] = [["t000001000", first], ["t000002000", first], ["t000003000", second], ["t000004000", second], ["b002-pre", first], ["b004-pre", second]];
        for (const [name, r] of want) {
          const file = `checkpoints/${name}.blck`;
          check(`${label}: ...${file}`, bytesEqual(r.bytes.get(file), whole.bytes.get(file)));
        }

        // Each boundary's transform on its own pre-cycle checkpoint: the rows and the post-cycle state the run recorded.
        for (const e of manifest.preCycleCheckpoints as { boundary: number; step: number; file: string; hash: string }[]) {
          const { state, observer } = decodeArtifact(whole.bytes.get(e.file)!);
          const cycle = applyCurrentCycle(state, e.boundary, arm, cfg.pondK!, cfg.pondDeath!, cfg.pondExport!, Mr, pondCensus);
          const recorded = text.split("\n").filter((l) => l.split("\t", 1)[0] === String(e.boundary)).join("\n") + "\n";
          check(`${label} b${e.boundary}: the pre-cycle checkpoint is the state before the cycle (hash, observer lastCycle ${e.boundary - 1})`, stateHash(state) === e.hash && observer.ponds?.lastCycle === e.boundary - 1);
          check(`${label} b${e.boundary}: applyCurrentCycle (CPU) on it gives the run's ponds.tsv rows`, pondTsvRows(cycle.rows, HUNT_POND_COLUMNS) === recorded);
          check(
            `${label} b${e.boundary}: ...and the post-cycle state of the run's checkpoint at t=${e.step}`,
            stateHash(cycle.state) === stateHash(artifactAt(whole, e.step).state),
            `${stateHash(cycle.state)} vs ${stateHash(artifactAt(whole, e.step).state)}`,
          );
        }
      }
    }
  }

  // --- 9. branch runs ----------------------------------------------------------
  if (section("branch")) {
    // A treatment history to boundary 3, whose pre-cycle state at boundary 2 is the source (docs/scaffold-transition-hunt-v1.md,
    // "Branch contract"), branched under both arms with a fresh seed and the small export zone (the hunt's own would export nothing here).
    const base: RunSpec = { experiment: "ponds-branch", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 3000, censusEvery: 100, deepEvery: 10, checkpointEvery: 1000, preCycleCheckpoints: [2] };
    const history = await run(base);
    const entry = JSON.parse(history.files["manifest.json"]).preCycleCheckpoints[0] as { boundary: number; step: number; file: string; hash: string };
    const { state: source } = decodeArtifact(history.bytes.get(entry.file)!);
    check("the source is the history's pre-cycle state at boundary 2 (hash and step)", stateHash(source) === entry.hash && source.step === 2000 && entry.boundary === 2);
    const Mr = pondContext(source)!.Mr;
    for (const [arm, condition] of [["nat", "pond-nat"], ["shuf", "pond-shuf"]] as const) {
      const label = `branch ${arm}`;
      const branch = { source: "mem:history", sourceHash: entry.hash, boundary: 2 };
      const spec: RunSpec = { experiment: "ponds-branch", presetId: "ponds-small", condition, seed: 2, steps: 2000, censusEvery: 100, deepEvery: 10, checkpointEvery: 1000, overrides: { pondExport: 12, pondDeath: 24_576 }, branch };
      const cfg = specConfig(spec);
      const whole = await run({ ...spec, preCycleCheckpoints: [3] }, { branchFrom: source });
      const manifest = JSON.parse(whole.files["manifest.json"]);
      const text = whole.files[PONDS_FILE];
      const rows = huntRows(text);

      // The first transform equals the CPU transform of the decoded source, with the branch's seed.
      const first = applyCurrentCycle({ ...source, cfg }, 2, arm, cfg.pondK!, cfg.pondDeath!, cfg.pondExport!, Mr, pondCensus);
      check(`${label}: conserves matter and energy exactly`, whole.conservationOk);
      check(
        `${label}: the manifest records branch (with the post-transform hash) and no initHash`,
        JSON.stringify(manifest.branch) === JSON.stringify({ ...branch, postHash: stateHash(first.state) }) && !("initHash" in manifest) && JSON.stringify(manifest.spec.branch) === JSON.stringify(branch) && manifest.startStep === 2000,
        JSON.stringify(manifest.branch),
      );
      check(
        `${label}: the first transform's rows (boundary 2) are applyCurrentCycle's on the decoded source`,
        text.startsWith(HUNT_POND_COLUMNS.join("\t") + "\n" + pondTsvRows(first.rows, HUNT_POND_COLUMNS)),
        text.split("\n").slice(0, 5).join(" | "),
      );
      check(`${label}: ...and its post-transform hash (branch.postHash) is applyCurrentCycle's`, manifest.branch.postHash === stateHash(first.state));
      check(
        `${label}: the first transform is not trivial (exporters, a recipient with a donor, a survivor)`,
        rows.slice(0, 4).some((r) => Number(r.exportMass) > 0) && rows.slice(0, 4).some((r) => Number(r.donor) >= 0) && rows.slice(0, 4).some((r) => r.donor === "-2"),
        rows.slice(0, 4).map((r) => `${r.donor}/${r.exportMass}`).join(" "),
      );
      check(`${label}: the branch is not the source's own history (another regime and seed)`, manifest.branch.postHash !== stateHash(artifactAt(history, 2000).state));
      check(`${label}: ponds.tsv has one row per pond for boundaries 2, 3 and 4`, rows.length === 12 && rows.every((r, i) => r.cycle === String(Math.floor(i / 4) + 2) && r.recipient === String(i % 4)), rows.map((r) => `${r.cycle}:${r.recipient}`).join(" "));
      const series = whole.files["series.jsonl"].trim().split("\n").map((l) => JSON.parse(l));
      check(`${label}: the first census is at t=2100 and flagged after-cycle, with observers fresh`, series[0].step === 2100 && series[0].afterCycle === true && series.filter((x) => x.afterCycle).map((x) => x.step).join() === "2100,3100", series.filter((x) => x.afterCycle).map((x) => x.step).join());
      check(`${label}: the run ends at t=4000 with ponds.lastCycle 4`, whole.final.step === 4000 && whole.observer.ponds?.lastCycle === 4 && whole.observer.censusIdx === 20);

      // A pre-cycle checkpoint after the boundary carries the observer as of the previous cycle, and its cycle is the run's.
      const pre = decodeArtifact(whole.bytes.get("checkpoints/b003-pre.blck")!);
      const cycle3 = applyCurrentCycle(pre.state, 3, arm, cfg.pondK!, cfg.pondDeath!, cfg.pondExport!, Mr, pondCensus);
      check(`${label} b3: the pre-cycle checkpoint is at t=3000 with ponds.lastCycle 2`, pre.state.step === 3000 && pre.observer.ponds?.lastCycle === 2);
      check(
        `${label} b3: applyCurrentCycle (CPU) on it gives the run's rows and its checkpoint at t=3000`,
        pondTsvRows(cycle3.rows, HUNT_POND_COLUMNS) === text.split("\n").filter((l) => l.split("\t", 1)[0] === "3").join("\n") + "\n" && stateHash(cycle3.state) === stateHash(artifactAt(whole, 3000).state),
      );

      // One segment equals two (cut at t=3000, from the first's checkpoint): final hash, ponds.tsv, series, checkpoints.
      const seg1 = await run({ ...spec, steps: 1000, preCycleCheckpoints: [3] }, { branchFrom: source });
      const at3000 = artifactAt(seg1, 3000);
      const seg2 = await run({ ...spec, steps: 1000 }, { start: at3000.state, observer: at3000.observer });
      const header = HUNT_POND_COLUMNS.join("\t") + "\n";
      const m1 = JSON.parse(seg1.files["manifest.json"]), m2 = JSON.parse(seg2.files["manifest.json"]);
      check(`${label}: in two segments, the final hash is the continuous branch's`, seg2.finalHash === whole.finalHash, `${seg2.finalHash} vs ${whole.finalHash}`);
      check(`${label}: ...ponds.tsv`, seg2.files[PONDS_FILE].startsWith(header) && seg1.files[PONDS_FILE] + seg2.files[PONDS_FILE].slice(header.length) === text);
      check(`${label}: ...series.jsonl`, seg1.files["series.jsonl"] + seg2.files["series.jsonl"] === whole.files["series.jsonl"]);
      for (const [file, r] of [["checkpoints/t000003000.blck", seg1], ["checkpoints/t000004000.blck", seg2], ["checkpoints/b003-pre.blck", seg1]] as const)
        check(`${label}: ...${file}`, bytesEqual(r.bytes.get(file), whole.bytes.get(file)));
      check(
        `${label}: ...the first segment's manifest is the continuous one's branch record; the continuation records the spec's branch and neither branch nor initHash`,
        JSON.stringify(m1.branch) === JSON.stringify(manifest.branch) && !("branch" in m2) && !("initHash" in m2) && JSON.stringify(m2.spec.branch) === JSON.stringify(branch),
      );
    }
  }
} finally {
  await Deno.remove(tmp, { recursive: true });
}

console.log(ok ? "ALL PASS" : "SOME FAILED");
Deno.exit(ok ? 0 : 1);
