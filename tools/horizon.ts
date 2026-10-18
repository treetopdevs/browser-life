// The stone horizon (slice 26): the shared garden brainstorm's §6.2 test, run headless to the rules written before the run in
// docs/garden-stone-horizon-2026-10-18.md (section numbers §n below are that note's). From a checkpoint of a source history
// (tools/run.ts, the big storm founded with the commons' feed), twins forked through `runExperiment` (the code path of
// tools/run.ts --start-from): U0 undisturbed, U1 a control, and one twin per stone radius with a lesion at N + 1. Each census of
// each twin is caught in memory from the runner's checkpoint write, reduced to (lineage, B + P) per cell and compared with U0's,
// near the stone (the torus disc of twice its radius) and far from it; tools/lib/horizon.ts holds the measure, the rule and
// the cap arithmetic. Nothing is written under runs/: sources, series and group files go to scratch directories given here.
//
//   deno run -A --no-lock tools/horizon.ts pilot   --source DIR --checkpoint N --out DIR --started ISO
//   deno run -A --no-lock tools/horizon.ts plan    --pilot FILE [--cap-hours 6] --out FILE
//   deno run -A --no-lock tools/horizon.ts living  --source DIR
//   deno run -A --no-lock tools/horizon.ts run     --sources S=DIR,... --checkpoints N,... --radii 8,32,64 --pilot FILE --plan FILE
//                                                  --series-dir DIR --out RECORD.json [--replaced S=DIR,...] [--note TEXT]...
//   deno run -A --no-lock tools/horizon.ts rebuild --record OLD.json --series-dir DIR --out RECORD.json [--replaced S=DIR,...] [--note TEXT]...
//   deno run -A --no-lock tools/horizon.ts readout --record RECORD.json
//
// pilot    timing only (§7): U0 and S8 from the source's checkpoint N for 4 censuses each, in two chunks of two, then the
//          code-path cross-check (§6): one continuous `tools/run.ts --start-from SOURCE --start-step N --lesion N+1:cx,cy,8
//          --steps 4096` whose finalHash must equal the chunked S8's (exit 4 otherwise). Use a fresh --out on a retry: run.ts refuses an
//          existing fork directory (xcheck/), which also exits 4. Prints and writes wall times and
//          rates only, never a measure value. --started is when the cap's clock started (before the pilot's source run).
// plan     §7's scale-down rule on the pilot's rates: source depth, window, deadline, a group's worst case.
// living   living cells at each checkpoint of a source (the extinction check of §1).
// run      the groups in the given order (checkpoints outer, sources inner: day 1 seeds 1-3, then day 2, ...), each started only if
//          its worst case fits before the plan's deadline; writes each group's full counts to --series-dir and the compact record
//          after every group. A group already complete in --series-dir is loaded, not rerun, only when its binding (seed, N,
//          checkpoint hash, radii, K, window, cadence, chunk, stone step, centre) matches this run's; any mismatch exits 2.
//          Exit 5 on a control fault (§6). --replaced lists seeds replaced under §1, recorded with their living cells only.
//          Every source must be a wild-storm-large treatment history founded with §1's feed (0:256,256,255,16) alone and no
//          overrides (exit 2 otherwise).
// rebuild  re-derives a record from its run's group files in the current layout (integer counts per census), carrying the
//          run's provenance and its replaced seeds; exits 2 unless every outcome and the readout reproduce exactly. No GPU.
// readout  §8's readings recomputed from a record's integer counts (exit 3 if they differ from the stored readout), then the
//          side readings, as Markdown.
//          For both, any malformed input (a missing field, a shape check) also exits 2 or 3; an I/O error (a missing or
//          unreadable file) exits 1.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { RULE_VERSION, decodeCheckpoint, stateHash, worldW, cellCount, type WorldState } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { RefSim, applyLesion } from "@bl/sim-ref";
import {
  INTERVENTIONS_FILE,
  continuationError,
  decodeArtifact,
  parseInterventionLog,
  runExperiment,
  specConfig,
  type ObserverState,
  type RunSpec,
  type Sink,
} from "@bl/runner";
import {
  ControlFault,
  bindingError,
  censusGate,
  compactGroup,
  compareRegions,
  groupFits,
  groupWorstSeconds,
  isFounding,
  livingIn,
  nearMask,
  readout,
  recomputePairs,
  recordRadii,
  compactJson,
  runGroup,
  sideReadings,
  signatureOf,
  sourceDepth,
  stoneCentre,
  torusDisc,
  type CompactGroup,
  type GroupBinding,
  type GroupFile,
  type GroupIo,
  type SegmentResult,
  type Signature,
  type TwinPlan,
  DeterminismFault,
  NullFault,
  compactNullGroup,
  finePointsOf,
  fineReadings,
  kickCell,
  largestNullRadius,
  lesionNullMask,
  notePrefix,
  nullBindingError,
  nullDiscCentre,
  FineCap,
  cappedRun,
  fineFileError,
  fineTopError,
  gridError,
  parseRunStatus,
  runStatusError,
  fineWorstSeconds,
  sPairsFrom55,
  nullGroupWorst,
  nullReadings,
  nullScaleDown,
  runArms,
  type ArmsPlan,
  type FineBinding,
  type FinePairRecord,
  type NullRecordView,
  type NullBinding,
  type NullGroupFile,
  type NullPrep,
  type PairRecord,
  type U0Reference,
} from "./lib/horizon.ts";

const RULES = "docs/garden-stone-horizon-2026-10-18.md";
const CENSUS = 1024;
const DEEP = 10;
const WANDER = 131_072;
const WOUND = 13_000;
const K = 4;
const CHUNK = 16;
const PRESET = "wild-storm-large";
/** §1's founding: the commons' own feed at step 0, and nothing else on the source's schedule. */
const FOUNDING = { step: 0, kind: "feed", x: 256, y: 256, r: 255, amount: 16 };

const a = parseArgs(Deno.args, {
  string: ["source", "checkpoint", "out", "started", "pilot", "plan", "cap-hours", "sources", "replaced", "checkpoints", "radii", "series-dir", "record", "note", "prep", "fine-dir", "lesioncheck", "seed", "status"],
  collect: ["note"],
});
const cmd = String(a._[0] ?? "");
const die = (msg: string, code = 2): never => {
  console.error(msg);
  Deno.exit(code);
};
const need = (k: keyof typeof a): string => {
  const v = a[k];
  if (typeof v !== "string" || v === "") die(`${cmd}: --${String(k)} is required`);
  return v as string;
};
const ints = (s: string) => s.split(",").map((x) => {
  const v = Number(x.trim());
  if (!Number.isSafeInteger(v) || v <= 0) die(`not a positive integer: ${x}`);
  return v;
});

async function sh(argv: string[]): Promise<string> {
  try {
    const o = await new Deno.Command(argv[0], { args: argv.slice(1), stdout: "piped", stderr: "piped" }).output();
    return new TextDecoder().decode(o.stdout).trim();
  } catch (e) {
    return `(${argv[0]} failed: ${(e as Error).message})`;
  }
}
const uptime = () => sh(["uptime"]);

// ---- Sources (the preflight of tools/run.ts --start-from)

interface SourceManifest {
  runId: string;
  spec: RunSpec;
  checkpoints: { step: number; file: string; hash: string }[];
  summary?: { finalHash: string; steps: number; stepsPerSecond: number; wallSeconds: number };
}

async function readManifest(dir: string): Promise<SourceManifest> {
  const m = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`)) as SourceManifest;
  if (m.spec?.presetId !== PRESET || m.spec.condition !== "treatment" || m.spec.censusEvery !== CENSUS || m.spec.deepEvery !== DEEP)
    die(`${dir}: not a ${PRESET} treatment history at census ${CENSUS}, deep ${DEEP}`);
  // §1: founded with the commons' feed and nothing else (no other intervention, no override; `isFounding`).
  if (!isFounding(m.spec.interventions, FOUNDING)) die(`${dir}: its schedule is ${JSON.stringify(m.spec.interventions ?? [])}, not §1's founding feed ${JSON.stringify(FOUNDING)} alone`);
  const ov = (m.spec as { overrides?: unknown }).overrides;
  if (ov !== undefined && ov !== null && !(typeof ov === "object" && Object.keys(ov as object).length === 0)) die(`${dir}: overrides ${JSON.stringify(ov)}; §1's sources have none`);
  return m;
}

/** The twins' spec: the source's own fields (so `continuationError` holds), experiment `horizon`, a checkpoint at every census. */
function twinSpec(src: RunSpec, steps: number, stone?: { step: number; x: number; y: number; r: number }): RunSpec {
  return {
    experiment: "horizon",
    presetId: src.presetId,
    condition: src.condition,
    seed: src.seed,
    steps,
    censusEvery: CENSUS,
    deepEvery: DEEP,
    checkpointEvery: CENSUS,
    ...(src.activityThreshold !== undefined ? { activityThreshold: src.activityThreshold } : {}),
    ...(stone ? { interventions: [{ step: stone.step, kind: "lesion" as const, x: stone.x, y: stone.y, r: stone.r }] } : {}),
  };
}

/** The decoded, hash-checked checkpoint at N that a twin can continue (as tools/run.ts --start-from checks it). */
async function loadCheckpoint(dir: string, m: SourceManifest, N: number): Promise<{ state: WorldState; observer: ObserverState }> {
  const entry = m.checkpoints?.find((c) => c.step === N);
  if (!entry) die(`${dir}: its manifest lists no checkpoint at step ${N}`);
  if (entry!.file.startsWith("/") || entry!.file.split(/[/\\]/).includes("..")) die(`${dir}: checkpoint ${entry!.file} is not inside the bundle`);
  const { state, observer } = decodeArtifact(await Deno.readFile(`${dir}/${entry!.file}`));
  if (state.step !== N) die(`${dir}: ${entry!.file} holds step ${state.step}, not ${N}`);
  const h = stateHash(state);
  if (h !== entry!.hash) die(`${dir}: ${entry!.file} hashes to ${h}, its manifest entry says ${entry!.hash}`);
  const cannot = continuationError(twinSpec(m.spec, CENSUS), state, observer);
  if (cannot) die(`${dir} at step ${N}: ${cannot}`);
  return { state, observer };
}

const livingOf = (s: WorldState) => signatureOf(s).living;

// ---- The GPU side: one twin segment through runExperiment, its censuses caught from the checkpoint writes

const DECIDED = Symbol("decided");
let device: GPUDevice | undefined;
let hostInfo = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch}`, adapter: "unknown" };

async function gpu(cfgFrom: RunSpec): Promise<GPUDevice> {
  if (device) return device;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const info = adapter?.info;
  hostInfo = { ...hostInfo, adapter: [info?.vendor, info?.architecture, info?.description].filter((v) => v && !/^\d+$/.test(v)).join(" ") || "unknown" };
  device = await requestDevice(navigator.gpu, specConfig(cfgFrom));
  return device;
}

type Cont = { state: WorldState; observer: ObserverState };
interface Timing {
  twin: string;
  firstK: number;
  censuses: number;
  seconds: number;
  reduceSeconds: number;
}

/** A group's io: twins forked from `start` (the checkpoint at N), run on the GPU one at a time. */
function gpuIo(src: RunSpec, start: Cont, deadline: number, timings?: Timing[]): GroupIo<Cont> {
  const N = start.state.step;
  return {
    deadline,
    now: () => performance.now() / 1000,
    async runSegment(twin, from, firstK, censuses, onCensus): Promise<SegmentResult<Cont>> {
      const begin = from ?? start;
      const startStep = begin.state.step;
      if (startStep !== N + (firstK - 1) * CENSUS) throw new Error(`${twin.name}: a segment from census ${firstK} must start at ${N + (firstK - 1) * CENSUS}, not ${startStep}`);
      const steps = censuses * CENSUS;
      // The stone goes only to the segment that owns it (the fork window (start, start + steps]). Slice 34's lesions (N0, the
      // kick; any radius, 0 included) come as `entry` and take the same path.
      const lesion = twin.stone ?? twin.entry;
      const stone = lesion && lesion.step > startStep && lesion.step <= startStep + steps ? { step: lesion.step, x: lesion.x, y: lesion.y, r: lesion.r } : undefined;
      const spec = twinSpec(src, steps, stone);
      const ctrl = new AbortController();
      const applied: { step: number; r: number }[] = [];
      let last: WorldState | undefined;
      let reduce = 0;
      // The census gate (tools/lib/horizon.ts): k in sequence, and every census conservation-checked before it can decide.
      const gate = censusGate({ name: twin.name, N, censusEvery: CENSUS, firstK });
      const text = (f: string, t: string) => {
        if (f === INTERVENTIONS_FILE && t) for (const e of parseInterventionLog(t)) applied.push({ step: e.step, r: e.r });
        if (f === "series.jsonl" && t) gate.series(t);
      };
      const sink: Sink = {
        async writeText(f, t) {
          text(f, t);
        },
        async appendText(f, t) {
          text(f, t);
        },
        async writeBytes(f, b) {
          if (!/^checkpoints\//.test(f)) return;
          const t = performance.now();
          const { state } = decodeCheckpoint(b);
          const k = gate.checkpoint(f, state.step);
          if (k === null) return;
          last = state;
          const sig = signatureOf(state);
          reduce += (performance.now() - t) / 1000;
          if (onCensus(k, sig, () => stateHash(state))) ctrl.abort(DECIDED);
        },
      };
      const t0 = performance.now();
      const done = (r: Omit<SegmentResult<Cont>, "seconds" | "applied" | "reached">): SegmentResult<Cont> => {
        const seconds = (performance.now() - t0) / 1000;
        const reached = gate.reached;
        timings?.push({ twin: twin.name, firstK, censuses: reached - firstK + 1, seconds, reduceSeconds: reduce });
        return { ...r, reached, applied, seconds };
      };
      try {
        const { summary, final, observer } = await runExperiment(await gpu(src), spec, sink, hostInfo, () => {}, {
          start: begin.state,
          observer: begin.observer,
          keepFinal: true,
          signal: ctrl.signal,
        });
        if (!final) throw new Error(`${twin.name}: the runner returned no final state`);
        if (!summary.conservationOk) throw new Error(`${twin.name}: conservation violated`);
        return done({ next: { state: final, observer }, finalHash: summary.finalHash, stopStateHash: null });
      } catch (e) {
        if (e !== DECIDED) throw e;
        return done({ next: null, finalHash: null, stopStateHash: last ? stateHash(last) : null });
      }
    },
  };
}

// ---- pilot (§7): timing only

async function pilot() {
  const dir = need("source"), out = need("out"), started = Date.parse(need("started"));
  if (!Number.isFinite(started)) die("--started must be an ISO time");
  const N = ints(need("checkpoint"))[0];
  const up = [{ stage: "pilot twins", uptime: await uptime() }];
  const m = await readManifest(dir);
  const start = await loadCheckpoint(dir, m, N);
  const cfg = start.state.cfg;
  const W = worldW(cfg), n = cellCount(cfg), H = n / W;
  const c = stoneCentre(start.state.cells, n, W, m.spec.seed, N);
  if (!c) die(`${dir}: no living cell at step ${N}`);
  const timings: Timing[] = [];
  const io = gpuIo(m.spec, start, Infinity, timings);
  // U0 then S8, each as two chunks of two censuses; the S8 chunks are compared with U0's held censuses only to time the
  // comparison (its counts are discarded, never printed).
  const held = new Map<number, Signature>();
  let cont: Cont | null = null;
  for (const first of [1, 3]) cont = (await io.runSegment({ name: "U0" }, cont, first, 2, (k, sig) => (held.set(k, sig), false))).next;
  const mask = nearMask(W, H, c!.x, c!.y, 8);
  let compareSeconds = 0, compares = 0;
  const s8: TwinPlan = { name: "S8", stone: { step: N + 1, x: c!.x, y: c!.y, r: 8 } };
  let sc: Cont | null = null;
  let last: SegmentResult<Cont> | undefined;
  for (const first of [1, 3]) {
    last = await io.runSegment(s8, sc, first, 2, (k, sig) => {
      const t = performance.now();
      compareRegions(sig, held.get(k)!, mask);
      compareSeconds += (performance.now() - t) / 1000;
      compares++;
      return false;
    });
    sc = last.next;
  }
  const s8Hash = last!.finalHash;
  // The stop path (§5), outside the timings: a stone twin whose census callback decides at k = 1 must stop there through
  // RunOptions.signal (no continuation, the census's state hash, census 1 reached), and the device must then run a normal
  // segment. No measure value is looked at.
  const sio = gpuIo(m.spec, start, Infinity);
  const stopped = await sio.runSegment(s8, null, 1, 2, () => true);
  const after = await sio.runSegment({ name: "U0" }, null, 1, 1, () => false);
  const stopOk = stopped.next === null && stopped.finalHash === null && stopped.stopStateHash !== null && stopped.reached === 1 && after.next !== null && after.reached === 1;
  console.log(`stop path: ${stopOk ? "ok" : "FAILED"} (stopped at census ${stopped.reached}, next ${stopped.next === null ? "null" : "set"}; then a normal segment reached ${after.reached})`);
  if (!stopOk) die("the stop path failed", 4);
  // The code-path cross-check: one continuous tools/run.ts fork with the same stone.
  up.push({ stage: "pilot cross-check", uptime: await uptime() });
  const xdir = `${out}/xcheck`;
  const argv = ["run", "-A", "--no-lock", "tools/run.ts", "--experiment", "horizon-xcheck", "--preset", PRESET, "--conditions", "treatment", "--seeds", String(m.spec.seed),
    "--steps", String(4 * CENSUS), "--census", String(CENSUS), "--deep", String(DEEP), "--checkpoint", "0", "--start-from", dir, "--start-step", String(N),
    "--lesion", `${N + 1}:${c!.x},${c!.y},8`, "--out", xdir];
  const tx = performance.now();
  const r = await new Deno.Command(Deno.execPath(), { args: argv, cwd: new URL("..", import.meta.url).pathname, stdout: "inherit", stderr: "inherit" }).output();
  const xSeconds = (performance.now() - tx) / 1000;
  if (!r.success) die(`the cross-check run failed (exit ${r.code})`, 4);
  const xm = JSON.parse(await Deno.readTextFile(`${xdir}/horizon-xcheck/${PRESET}/treatment/seed-${m.spec.seed}/manifest.json`));
  const crossOk = xm.summary?.finalHash === s8Hash;
  const twinSteps = timings.reduce((s, t) => s + t.censuses * CENSUS, 0), twinSecs = timings.reduce((s, t) => s + t.seconds, 0);
  const rec = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    pilotSeconds: (Date.now() - started) / 1000,
    source: { dir, seed: m.spec.seed, steps: m.summary?.steps, wallSeconds: m.summary?.wallSeconds, rate: m.summary?.stepsPerSecond },
    twinRate: twinSteps / twinSecs,
    chunks: timings.map((t) => ({ ...t, rate: (t.censuses * CENSUS) / t.seconds })),
    reduceSecondsPerCensus: timings.reduce((s, t) => s + t.reduceSeconds, 0) / timings.reduce((s, t) => s + t.censuses, 0),
    compareSecondsPerCensus: compareSeconds / compares,
    crossCheck: { runTsSeconds: xSeconds, runTsRate: xm.summary?.stepsPerSecond, ok: crossOk, horizonHash: s8Hash, runTsHash: xm.summary?.finalHash },
    stopPath: { ok: stopOk, stoppedAt: stopped.reached, stopStateHash: stopped.stopStateHash, afterReached: after.reached, seconds: stopped.seconds + after.seconds },
    uptime: up,
    host: hostInfo,
  };
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(`${out}/pilot.json`, JSON.stringify(rec, null, 2) + "\n");
  console.log(JSON.stringify(rec, null, 2));
  if (!crossOk) die(`cross-check FAILED: horizon.ts S8 finalHash ${s8Hash}, tools/run.ts ${xm.summary?.finalHash}`, 4);
}

// ---- plan (§7)

async function plan() {
  const p = JSON.parse(await Deno.readTextFile(need("pilot")));
  const capHours = Number(a["cap-hours"] ?? 6);
  const capSeconds = capHours * 3600;
  const c = {
    pilotSeconds: p.pilotSeconds,
    srcRate: p.source.rate,
    twinRate: p.twinRate,
    capSeconds,
    factor: 0.75,
    wander: WANDER,
    censusEvery: CENSUS,
    K,
    control: CHUNK,
    seeds: 3,
  };
  const d = sourceDepth(c);
  const out = {
    capHours,
    startedAt: p.startedAt,
    deadline: new Date(Date.parse(p.startedAt) + capSeconds * 1000).toISOString(),
    inputs: c,
    depth: d.depth,
    kMax: d.kMax,
    fallback: d.fallback,
    groupWorstSeconds: d.groupWorst,
    sourcesSeconds: d.sources,
    budgetSeconds: d.budget,
    scaleDown: d.fallback
      ? "no depth fits: sources to day 1 and the window drops to 64 censuses (§7)"
      : d.depth < 3
        ? `sources to day ${d.depth} only (§7): days ${d.depth + 1}..3 are not run (cap)`
        : "none",
  };
  await Deno.writeTextFile(need("out"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
}

// ---- living (§1)

async function living() {
  const dir = need("source");
  const m = await readManifest(dir);
  for (const ck of m.checkpoints ?? []) {
    const { state } = decodeArtifact(await Deno.readFile(`${dir}/${ck.file}`));
    console.log(`${m.spec.seed}\t${ck.step}\t${livingOf(state)}`);
  }
}

const round = (x: number, p: number) => (typeof x === "number" ? Math.round(x * 10 ** p) / 10 ** p : x);

/** SHA-256 of the rules note and this slice's two tool files as they are when a record is written (provenance, §9 amended). */
async function digests(): Promise<Record<string, string>> {
  const root = new URL("..", import.meta.url);
  const out: Record<string, string> = {};
  for (const f of [RULES, "tools/horizon.ts", "tools/lib/horizon.ts"]) {
    const b = await Deno.readFile(new URL(f, root));
    out[f] = [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  return out;
}

// ---- run (§2-§9)

const groupPath = (dir: string, seed: number, N: number) => `${dir}/group-s${seed}-n${N}.json`;

interface SourceInfo {
  seed: number;
  dir: string;
  finalHash?: string;
  steps?: number;
  living: Record<string, number | null>;
  /** A seed replaced under §1 (no living cell at day 1), recorded with its living cells but never run. */
  replaced?: boolean;
}

/** A source's final hash and its living cells at each checkpoint (§1's side reading). */
async function sourceInfo(seed: number, dir: string, checkpoints: number[], replaced = false): Promise<{ info: SourceInfo; m: SourceManifest }> {
  const m = await readManifest(dir);
  if (m.spec.seed !== seed) die(`${dir} is seed ${m.spec.seed}, not ${seed}`);
  const living: Record<string, number | null> = {};
  for (const N of checkpoints) {
    const ck = m.checkpoints.find((c) => c.step === N);
    if (!ck) {
      living[N] = null;
      continue;
    }
    // The checkpoint's identity (as loadCheckpoint checks it), so a living count is never read from the wrong file.
    if (ck.file.startsWith("/") || ck.file.split(/[/\\]/).includes("..")) die(`${dir}: checkpoint ${ck.file} is not inside the bundle`);
    const { state } = decodeArtifact(await Deno.readFile(`${dir}/${ck.file}`));
    if (state.step !== N) die(`${dir}: ${ck.file} holds step ${state.step}, not ${N}`);
    const h = stateHash(state);
    if (h !== ck.hash) die(`${dir}: ${ck.file} hashes to ${h}, its manifest entry says ${ck.hash}`);
    living[N] = livingOf(state);
  }
  return { info: { seed, dir, finalHash: m.summary?.finalHash, steps: m.summary?.steps, living, ...(replaced ? { replaced: true } : {}) }, m };
}

const seedDirs = (arg: string | undefined) =>
  (arg ? arg.split(",") : []).filter(Boolean).map((p) => {
    const [s, dir] = p.split("=");
    return { seed: Number(s), dir };
  });

/** The binding a group of this run must carry (§2, §5, §7): what its result depends on. */
function bindingFor(m: SourceManifest, seed: number, N: number, radii: number[], kMax: number, centre: { x: number; y: number }): GroupBinding {
  const entry = m.checkpoints.find((c) => c.step === N)!;
  return { seed, N, checkpointHash: entry.hash, radii, K, kMax, censusEvery: CENSUS, chunk: CHUNK, stoneStep: N + 1, centre };
}

/** The record (§9, amended): provenance, the cap, sources, compact groups with integer counts, and the readout recomputed from them. */
function buildRecord(base: Record<string, unknown>, groups: CompactGroup[], radii: number[], kMax: number) {
  const pairs = recomputePairs(groups as Parameters<typeof recomputePairs>[0], radii, { K, kMax, censusEvery: CENSUS });
  return { ...base, radii, groups, readout: readout(pairs, { kMax, censusEvery: CENSUS, wound: WOUND, wander: WANDER }) };
}


async function run() {
  const seriesDir = need("series-dir"), outFile = need("out");
  const sources = seedDirs(need("sources"));
  const checkpoints = ints(need("checkpoints"));
  const radii = ints(a.radii ?? "8,32,64");
  const pilotRec = JSON.parse(await Deno.readTextFile(need("pilot")));
  const planRec = JSON.parse(await Deno.readTextFile(need("plan")));
  const kMax: number = planRec.kMax;
  const deadlineMs = Date.parse(planRec.deadline);
  const worst = groupWorstSeconds({ twinRate: pilotRec.twinRate, factor: 0.75, censusEvery: CENSUS, K, control: CHUNK }, kMax);
  await Deno.mkdir(seriesDir, { recursive: true });
  const stages: { stage: string; at: string; uptime: string }[] = [{ stage: "run start", at: new Date().toISOString(), uptime: await uptime() }];

  const srcInfo: SourceInfo[] = [];
  const manifests = new Map<number, SourceManifest>();
  for (const s of seedDirs(a.replaced as string | undefined)) srcInfo.push((await sourceInfo(s.seed, s.dir, checkpoints, true)).info);
  for (const s of sources) {
    const { info, m } = await sourceInfo(s.seed, s.dir, checkpoints);
    manifests.set(s.seed, m);
    srcInfo.push(info);
  }

  const groups: GroupFile[] = [];
  const writeRecord = async () => {
    const rec = buildRecord(
      {
        rules: `${RULES} (2026-10-18)`,
        commit: await sh(["git", "rev-parse", "HEAD"]),
        dirty: (await sh(["git", "status", "--porcelain", "--", "tools/horizon.ts", "tools/lib/horizon.ts", RULES])) !== "",
        digests: await digests(),
        ruleVersion: RULE_VERSION,
        host: hostInfo.host,
        adapter: hostInfo.adapter,
        notes: (a.note as unknown as string[] | undefined) ?? [],
        pilot: {
          startedAt: pilotRec.startedAt,
          pilotSeconds: round(pilotRec.pilotSeconds, 1),
          srcRate: round(pilotRec.source.rate, 1),
          twinRate: round(pilotRec.twinRate, 1),
          reduceSecondsPerCensus: round(pilotRec.reduceSecondsPerCensus, 3),
          compareSecondsPerCensus: round(pilotRec.compareSecondsPerCensus, 4),
          crossCheck: pilotRec.crossCheck,
          ...(pilotRec.stopPath ? { stopPath: pilotRec.stopPath } : {}),
          uptime: pilotRec.uptime,
        },
        cap: {
          hours: planRec.capHours,
          deadline: planRec.deadline,
          depth: planRec.depth,
          kMax,
          fallback: planRec.fallback,
          scaleDown: planRec.scaleDown,
          groupWorstSeconds: Math.round(worst),
        },
        stages,
        sources: srcInfo,
      },
      groups.map((g) => compactGroup(g, radii)),
      radii,
      kMax,
    );
    await Deno.writeTextFile(outFile, compactJson(rec) + "\n");
  };

  for (const N of checkpoints)
    for (const s of sources) {
      const m = manifests.get(s.seed)!;
      const path = groupPath(seriesDir, s.seed, N);
      const g: GroupFile = { seed: s.seed, N, status: "done" };
      if (!m.checkpoints.some((c) => c.step === N)) {
        g.status = "not run (cap)"; // the source was not run this deep (§7's scale-down)
        groups.push(g);
        await writeRecord();
        continue;
      }
      const start = await loadCheckpoint(s.dir, m, N);
      const cfg = start.state.cfg;
      const W = worldW(cfg), n = cellCount(cfg), H = n / W;
      const c = stoneCentre(start.state.cells, n, W, s.seed, N);
      // A group file already in --series-dir is reused only when its binding matches this run's exactly.
      try {
        const old = JSON.parse(await Deno.readTextFile(path)) as GroupFile;
        if (old.status === "done" || old.status === "extinct source") {
          const why = c ? bindingError(old.binding, bindingFor(m, s.seed, N, radii, kMax, { x: c.x, y: c.y })) : old.status === "extinct source" ? null : "the source has no living cell";
          if (why) die(`${path}: not reusable: ${why}; move it away or use a fresh --series-dir`);
          console.log(`group seed ${s.seed} N ${N}: loaded from ${path} (${old.status})`);
          if (old.startedAt && old.uptime) stages.push({ stage: `group seed ${s.seed} N ${N} (loaded)`, at: old.startedAt, uptime: old.uptime });
          groups.push(old);
          await writeRecord();
          continue;
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
      if (!c) {
        g.status = "extinct source";
        groups.push(g);
        await Deno.writeTextFile(path, JSON.stringify(g) + "\n");
        await writeRecord();
        continue;
      }
      const remaining = (deadlineMs - Date.now()) / 1000;
      if (!groupFits(remaining, worst)) {
        console.log(`group seed ${s.seed} N ${N}: not run (cap): worst case ${Math.round(worst)} s, ${Math.round(remaining)} s left`);
        g.status = "not run (cap)";
        groups.push(g);
        await writeRecord();
        continue;
      }
      g.binding = bindingFor(m, s.seed, N, radii, kMax, { x: c.x, y: c.y });
      g.centre = { x: c.x, y: c.y, living: c.living };
      const masks = new Map<number, Uint8Array>();
      g.stones = radii.map((R) => {
        const near = nearMask(W, H, c.x, c.y, R);
        masks.set(R, near);
        return { R, stoneDisc: livingIn(start.state.cells, n, torusDisc(W, H, c.x, c.y, R)), nearDisc: livingIn(start.state.cells, n, near) };
      });
      g.uptime = await uptime();
      g.startedAt = new Date().toISOString();
      stages.push({ stage: `group seed ${s.seed} N ${N}`, at: g.startedAt, uptime: g.uptime });
      console.log(`group seed ${s.seed} N ${N}: centre (${c.x}, ${c.y}); ${g.uptime}`);
      const deadline = performance.now() / 1000 + (deadlineMs - Date.now()) / 1000;
      try {
        g.result = await runGroup(gpuIo(m.spec, start, deadline), {
          centre: c,
          radii,
          masks,
          chunk: CHUNK,
          horizon: { K, kMax, censusEvery: CENSUS },
          stoneStep: N + 1,
        });
      } catch (e) {
        if (!(e instanceof ControlFault)) throw e;
        g.status = "void";
        groups.push(g);
        await Deno.writeTextFile(path, JSON.stringify({ ...g, fault: e.message, control: e.control }) + "\n");
        await writeRecord();
        die(`control fault in group seed ${s.seed} N ${N}: ${e.message}; the group is void and the run stops (§6)`, 5);
      }
      for (const st of g.result!.stones) console.log(`  ${st.name}: ${st.outcome.kind} (census ${st.reached})`);
      groups.push(g);
      await Deno.writeTextFile(path, JSON.stringify(g) + "\n");
      await writeRecord();
    }
  stages.push({ stage: "run end", at: new Date().toISOString(), uptime: await uptime() });
  await writeRecord();
}

// ---- rebuild: a record of an earlier run, re-derived from its group files (no GPU)

/**
 * Rebuilds a record from the group files of the run that wrote it: provenance (commit, host, adapter, pilot, cap, stages,
 * notes) is carried from the old record, groups and readout are re-derived with this version's layout, and the run must
 * reproduce exactly: every pair's outcome recomputed from the integer counts equals the old record's. Group files written
 * before bindings existed are checked instead against the sources: the checkpoint hash, the centre the §2 rule draws from it,
 * the radii and the window.
 */
async function rebuild() {
  const old = JSON.parse(await Deno.readTextFile(need("record")));
  const seriesDir = need("series-dir"), outFile = need("out");
  const kMax: number = old.cap.kMax;
  const radii = recordRadii(old);
  const checkpoints: number[] = [...new Set<number>(old.groups.map((g: { N: number }) => g.N))];
  const sources: SourceInfo[] = [];
  const manifests = new Map<number, { dir: string; m: SourceManifest }>();
  // Replaced seeds: the old record's, re-read and checked, then any --replaced seed it lacks.
  for (const s of old.sources as SourceInfo[]) {
    if (!s.replaced) continue;
    const { info } = await sourceInfo(s.seed, s.dir, checkpoints, true);
    if (info.finalHash !== s.finalHash || JSON.stringify(info.living) !== JSON.stringify(s.living)) die(`replaced source seed ${s.seed} at ${s.dir} no longer matches the record`);
    sources.push(info);
  }
  for (const s of seedDirs(a.replaced as string | undefined)) {
    const had = (old.sources as SourceInfo[]).find((x) => x.seed === s.seed);
    if (had && !(had.replaced && had.dir === s.dir)) die(`--replaced seed ${s.seed}=${s.dir}: the record has seed ${s.seed} as ${had.replaced ? "replaced" : "a run source"} at ${had.dir}`);
    if (!had) sources.push((await sourceInfo(s.seed, s.dir, checkpoints, true)).info);
  }
  for (const s of old.sources as SourceInfo[]) {
    if (s.replaced) continue;
    const { info, m } = await sourceInfo(s.seed, s.dir, checkpoints);
    if (info.finalHash !== s.finalHash || JSON.stringify(info.living) !== JSON.stringify(s.living)) die(`source seed ${s.seed} at ${s.dir} no longer matches the record`);
    manifests.set(s.seed, { dir: s.dir, m });
    sources.push(info);
  }
  const files: GroupFile[] = [];
  for (const og of old.groups as { seed: number; N: number; status: string }[]) {
    if (og.status !== "done") {
      files.push({ seed: og.seed, N: og.N, status: og.status as GroupFile["status"] });
      continue;
    }
    const path = groupPath(seriesDir, og.seed, og.N);
    const g = JSON.parse(await Deno.readTextFile(path)) as GroupFile;
    const src = manifests.get(og.seed)!;
    const start = await loadCheckpoint(src.dir, src.m, og.N);
    const W = worldW(start.state.cfg), n = cellCount(start.state.cfg);
    const c = stoneCentre(start.state.cells, n, W, og.seed, og.N)!;
    const want = bindingFor(src.m, og.seed, og.N, radii, kMax, { x: c.x, y: c.y });
    if (g.binding) {
      const why = bindingError(g.binding, want);
      if (why) die(`${path}: ${why}`);
    } else {
      if (g.centre?.x !== c.x || g.centre?.y !== c.y) die(`${path}: centre (${g.centre?.x}, ${g.centre?.y}), the rule draws (${c.x}, ${c.y})`);
      const rs = g.result!.stones.map((s) => s.R);
      if (JSON.stringify(rs) !== JSON.stringify(radii)) die(`${path}: radii ${rs}, the record's ${radii}`);
      for (const s of g.result!.stones) if (s.reached > kMax + K - 1) die(`${path}: ${s.name} reached census ${s.reached}, past the window`);
      // An unbound file carries no checkpoint hash of its own: what is checked is that the source checkpoint still hashes to
      // its manifest entry (loadCheckpoint) and that the file's centre is the one §2 draws from it. That is consistent with
      // the file having come from this checkpoint; it does not prove it.
      console.log(`${path}: no binding (written before bindings): its centre (${c.x}, ${c.y}) is the one §2 draws from the source checkpoint (which hashes to its manifest entry ${want.checkpointHash}), radii ${radii}; its provenance is otherwise unverified`);
    }
    files.push(g);
  }
  const groups = files.map((g) => compactGroup(g, radii));
  let pairsNew: ReturnType<typeof recomputePairs> = [];
  try {
    pairsNew = recomputePairs(groups as Parameters<typeof recomputePairs>[0], radii, { K, kMax, censusEvery: CENSUS });
  } catch (e) {
    die(`the group files' counts do not give their own outcomes: ${(e as Error).message}`);
  }
  for (const og of old.groups as { seed: number; N: number; status: string; stones?: { R: number; outcome: unknown }[] }[])
    for (const st of og.stones ?? []) {
      const p = pairsNew.find((x) => x.seed === og.seed && x.N === og.N && x.R === st.R)!;
      if (JSON.stringify(p.outcome) !== JSON.stringify(st.outcome)) die(`seed ${og.seed} N ${og.N} R ${st.R}: rebuilt ${JSON.stringify(p.outcome)}, recorded ${JSON.stringify(st.outcome)}`);
    }
  const { groups: _g, readout: _r, sources: _s, ...base } = old;
  const rec = buildRecord(
    {
      ...base,
      rebuilt: { at: new Date().toISOString(), commit: await sh(["git", "rev-parse", "HEAD"]), digests: await digests(), note: "re-derived from the run's group files by tools/horizon.ts rebuild: integer counts replace the rounded series; every outcome reproduced; provenance above is the run's" },
      notes: [...(old.notes ?? []), ...((a.note as unknown as string[] | undefined) ?? [])],
      sources,
    },
    groups,
    radii,
    kMax,
  );
  if (JSON.stringify(rec.readout) !== JSON.stringify(old.readout)) die("the rebuilt readout differs from the recorded one");
  await Deno.writeTextFile(outFile, compactJson(rec) + "\n");
  console.log(`rebuilt ${outFile}: ${groups.length} groups, outcomes and readout reproduced`);
}

/**
 * The exit-code boundary of rebuild and readout: any failure that is not an I/O error (a malformed record or group file,
 * a missing field, a shape check) is a validation failure and exits `code`, as the header says; an I/O error (a missing or
 * unreadable file) is rethrown and exits 1, so it never reads as a mismatch.
 */
async function validating(code: number, what: string, f: () => Promise<void>) {
  try {
    await f();
  } catch (e) {
    if (Object.values(Deno.errors).some((C) => typeof C === "function" && e instanceof C)) throw e;
    die(`${what}: ${(e as Error)?.message ?? String(e)}`, code);
  }
}

// ---- readout (§8)

/** §8's readings, recomputed from the record's integer counts (and checked against the readout it stored), then the side readings. */
async function readoutCmd() {
  const rec = JSON.parse(await Deno.readTextFile(need("record")));
  const kMax: number = rec.cap.kMax;
  const radii = recordRadii(rec);
  let pairs: ReturnType<typeof recomputePairs> = [];
  try {
    pairs = recomputePairs(rec.groups, radii, { K, kMax, censusEvery: CENSUS });
  } catch (e) {
    die(`the record's counts do not give its outcomes: ${(e as Error).message}`, 3);
  }
  const ro = readout(pairs, { kMax, censusEvery: CENSUS, wound: WOUND, wander: WANDER });
  if (JSON.stringify(ro) !== JSON.stringify(rec.readout)) die("the readout recomputed from the record's counts differs from the readout it stores", 3);
  const n = (x: number) => x.toLocaleString("en-US");
  const lines: string[] = [];
  for (const r of ro.radii) {
    const list = r.valid.map((v) => `${v.steps === null ? `>${n(kMax * CENSUS - 1)}` : n(v.steps)} (seed ${v.seed}, N ${n(v.N)})`);
    lines.push(`- **R = ${r.R}**: ${r.valid.length} valid${list.length ? `: ${list.join("; ")}` : ""}${r.excluded.length ? `. Excluded: ${r.excluded.map((x) => `seed ${x.seed} N ${n(x.N)} ${x.kind}`).join("; ")}` : ""}.`);
    lines.push(`  ${r.verdict}.`);
  }
  lines.push(`- ${ro.pace}`);
  const sr = sideReadings(rec.groups);
  const h = sr.horizons;
  lines.push("", "Side readings (not in the rules; they decide nothing):", "");
  lines.push(sr.farAtCensus1 ? `- far at census 1: ${sr.farAtCensus1.min} to ${sr.farAtCensus1.max}.` : "- far at census 1: no observations (no pair has a census).");
  if (sr.farReaches09) lines.push(`- far first reaches 0.9 at census ${sr.farReaches09.min} to ${sr.farReaches09.max} (median ${sr.farReaches09.median}) in ${sr.farReaches09.pairs} of ${sr.farReaches09.of} pairs.`);
  lines.push(`- censuses after census 16 with near and far both >= 0.99: ${sr.bothSaturatedAfter16.censuses} of ${sr.bothSaturatedAfter16.of}.`);
  lines.push(`- measured horizons: ${h.total}; starting after census 10: ${h.afterCensus10}, of which ${h.afterCensus10Saturated} start with near and far both >= 0.99; far under 0.9 at k: ${h.farBelow09}; near at k below near at census 1: ${h.nearBelowCensus1}.`);
  lines.push(`- into the crossing (census k - 1 to k, ${h.total - h.atCensus1} horizons with k > 1): near fell in ${h.nearFellIntoCrossing}, far rose in ${h.farRoseIntoCrossing}, both in ${h.bothMovedIntoCrossing}.`);
  for (const p of sr.pairs.filter((p) => p.k !== null))
    lines.push(`  - seed ${p.seed} N ${n(p.N)} R ${p.R}: k ${p.k}, near ${p.nearK}, far ${p.farK}${p.saturatedAtK ? ", both saturated" : ""}${p.farBelow09 ? ", far under 0.9" : ""}${p.nearBelowCensus1 ? ", near below census 1" : ""}${p.nearFellIntoCrossing ? ", near fell into it" : ""}${p.farRoseIntoCrossing ? ", far rose into it" : ""}.`);
  console.log(lines.join("\n"));
}

// ==== Slice 34: the null stone, the kick and the finer cadence (the note's "Amendment, slice 34", N1 to N8)
//
//   deno run -A --no-lock tools/horizon.ts nullprep    --record OLD.json --sources S=DIR,... --checkpoints N,... --out PREP.json
//   deno run -A --no-lock tools/horizon.ts lesioncheck --prep PREP.json --out FILE [--seed S --checkpoint N]
//   deno run -A --no-lock tools/horizon.ts nullplan    --pilot FILE --prep PREP.json [--cap-hours 4] --out PLAN.json
//   deno run -A --no-lock tools/horizon.ts nullrun     --prep PREP.json --plan PLAN.json --checkpoints N,... --series-dir DIR
//   deno run -A --no-lock tools/horizon.ts fine        --prep PREP.json --plan PLAN.json --fine-dir DIR
//   deno run -A --no-lock tools/horizon.ts nullrecord  --prep PREP.json --plan PLAN.json --pilot FILE --lesioncheck FILE
//                                                      --series-dir DIR --fine-dir DIR [--status run.status] --out RECORD.json
//   deno run -A --no-lock tools/horizon.ts nullreadout --record RECORD.json
//
// nullprep     CPU only (N4): each source's final hash and living cells, each checkpoint's hash and §2's stone centre equal
//              #55's record (exit 2 otherwise); then per group the N0 centres or "no null disc" and r0 (N2), the kick's cell
//              and the stale count (N3), #55's U0 reference and its stone outcomes.
// lesioncheck  GPU, no step (N5): the kick (r = 0) and the N0 R = 8 lesion on GpuSim and by applyLesion on the CPU hash equal;
//              N0 leaves the stateHash unchanged and the kick changes it (exit 4 otherwise).
// nullplan     N7's cap: worst cases from the pilot's rates times 0.75, the scale-down, the deadline (pilot start + cap) and the
//              note's SHA-256 at the start (N8).
// nullrun      the groups at the given checkpoints (N2 to N4): U0, U1, the N0 twins and K, through runArms; one file per group.
//              A done file is reused only when its binding matches (exit 2 otherwise). Exit 5 on a control, null or
//              determinism fault (the group is void).
// fine         the fine pilot (N5) on the day-1 groups: U0, S8, S32, S64 and K every 64 steps by GpuSim directly, each gated by
//              the same twin through runExperiment, and the two #55 anchors. Exit 4 on a gate failure (the fine pilot is void).
// nullrecord   the compact record (N8) and N6's readings, recomputed from the counts (exit 2 if anything does not reproduce).
// nullreadout  N6's readings recomputed from the record's counts and the note's prefix hash (exit 3 on a mismatch), as Markdown.

const AMENDMENT = "## Amendment, slice 34 (2026-10-18): the null stone and a finer cadence, rules written before the run";
const READOUT34 = "## Readout, slice 34 (2026-10-18)";
const RADII = [8, 32, 64];
const DAY1 = 131_072;
const EVERY = 64;
const KF = 16;
const FACTOR = 0.75;
/** #55's receipts the fine path must reproduce (N5): S8 of seed 1 at day 1 stopped at census 6; S64 of seed 4 at day 2 at census 5. */
const ANCHORS = [
  { seed: 1, N: 131_072, R: 8, steps: 6_144, want: "3067b35b80d9177f" },
  { seed: 4, N: 262_144, R: 64, steps: 5_120, want: "dd6f3f27cbfc6e70" },
];
const PILOT_HASH = "92b973bc4ff08e9a";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (b: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));
/** N7's `ps` note: other deno runs, vite servers and browser GPU processes (noted, never stopped). */
const psNote = () => sh(["sh", "-c", "ps -Ao pid,pcpu,etime,command | grep -E 'deno run|vite|[(]GPU[)]' | grep -v grep | cut -c1-160 | head -20"]);
const readJson = async (f: string) => JSON.parse(await Deno.readTextFile(f));
const repoFile = (f: string) => new URL(`../${f}`, import.meta.url);

interface PrepGroup {
  seed: number;
  N: number;
  checkpointHash: string;
  prep: NullPrep;
  /** #55's centre and stone outcomes (with their final or stop hash). */
  stones: { R: number; outcome: unknown; finalHash: string | null; stopStateHash: string | null }[];
  u0Reference: U0Reference;
}

interface PrepFile {
  record: string;
  recordSha256: string;
  kMax55: number;
  sources: { seed: number; dir: string; finalHash?: string; living: Record<string, number | null>; checkpointHashes: Record<string, string> }[];
  groups: PrepGroup[];
  sPairs: PairRecord[];
}

/** N2, N3 from a checkpoint state: the null discs per radius, r0, the kick's cell, the stale count. */
function prepOf(state: WorldState, seed: number, N: number): NullPrep {
  const W = worldW(state.cfg), n = cellCount(state.cfg);
  const c = stoneCentre(state.cells, n, W, seed, N);
  if (!c) die(`seed ${seed} N ${N}: no living cell`);
  const mask = lesionNullMask(state);
  const nulls = RADII.map((R) => {
    const z = nullDiscCentre(state, W, R, seed, N, mask);
    return z ? { R, x: z.x, y: z.y, count: z.count } : { R, none: true as const };
  });
  const kick = kickCell(state, W, seed, N);
  if (!kick) die(`seed ${seed} N ${N}: no stale cell, so no kick (N3)`);
  return { stoneCentre: { x: c!.x, y: c!.y }, r0: largestNullRadius(state, W, Math.max(...RADII), mask), stale: kick!.stale, nulls, kick: kick! };
}

const nullsOf = (p: NullPrep) => p.nulls.filter((z): z is { R: number; x: number; y: number; count: number } => !("none" in z));

async function nullprep() {
  const recPath = need("record");
  const recBytes = await Deno.readFile(recPath);
  const rec = JSON.parse(new TextDecoder().decode(recBytes));
  const sources = seedDirs(need("sources"));
  const checkpoints = ints(need("checkpoints"));
  if (JSON.stringify(recordRadii(rec)) !== JSON.stringify(RADII)) die(`${recPath}: radii ${recordRadii(rec)}, not ${RADII}`);
  const out: PrepFile = { record: recPath, recordSha256: await sha256(recBytes), kMax55: rec.cap.kMax, sources: [], groups: [], sPairs: [] };
  const manifests = new Map<number, { dir: string; m: SourceManifest }>();
  for (const s of sources) {
    const { info, m } = await sourceInfo(s.seed, s.dir, checkpoints);
    const rs = (rec.sources as SourceInfo[]).find((x) => x.seed === s.seed && !x.replaced);
    if (!rs) die(`${recPath} has no run source seed ${s.seed}`);
    const want = Object.fromEntries(checkpoints.map((N) => [N, rs!.living[N] ?? null]));
    if (info.finalHash !== rs!.finalHash || JSON.stringify(info.living) !== JSON.stringify(want))
      die(`source seed ${s.seed} at ${s.dir}: final hash ${info.finalHash} and living ${JSON.stringify(info.living)}; #55's record has ${rs!.finalHash} and ${JSON.stringify(want)}`);
    manifests.set(s.seed, { dir: s.dir, m });
    out.sources.push({ seed: s.seed, dir: s.dir, finalHash: info.finalHash, living: info.living, checkpointHashes: Object.fromEntries(checkpoints.map((N) => [N, m.checkpoints.find((c) => c.step === N)!.hash])) });
    console.log(`source seed ${s.seed}: final hash ${info.finalHash} and living cells match #55's record`);
  }
  for (const N of checkpoints)
    for (const s of sources) {
      const rg = (rec.groups as CompactGroup[]).find((g) => g.seed === s.seed && g.N === N);
      if (!rg || rg.status !== "done" || !rg.centre || !rg.u0 || !rg.stones) die(`${recPath}: no done group seed ${s.seed} N ${N}`);
      const src = manifests.get(s.seed)!;
      const start = await loadCheckpoint(src.dir, src.m, N);
      const prep = prepOf(start.state, s.seed, N);
      if (prep.stoneCentre.x !== rg!.centre!.x || prep.stoneCentre.y !== rg!.centre!.y) die(`seed ${s.seed} N ${N}: §2 draws (${prep.stoneCentre.x}, ${prep.stoneCentre.y}), #55's record has (${rg!.centre!.x}, ${rg!.centre!.y})`);
      out.groups.push({
        seed: s.seed,
        N,
        checkpointHash: src.m.checkpoints.find((c) => c.step === N)!.hash,
        prep,
        stones: rg!.stones!.map((st) => ({ R: st.R, outcome: st.outcome, finalHash: st.finalHash, stopStateHash: st.stopStateHash })),
        u0Reference: { living: rg!.u0!.living, reached: rg!.u0!.reached, finalHash: rg!.u0!.finalHash, chunk1Hash: rg!.control!.hashU0 },
      });
      const z = prep.nulls.map((x) => ("none" in x ? `R${x.R} none` : `R${x.R} (${x.x}, ${x.y}) of ${x.count}`)).join(", ");
      console.log(`group seed ${s.seed} N ${N}: stone centre ok; null discs ${z}; r0 ${prep.r0}; kick (${prep.kick.x}, ${prep.kick.y}) P ${prep.kick.P} E ${prep.kick.E} MOT ${prep.kick.motOff ? "off rest" : "at rest"}, ${prep.kick.ties} tied of ${prep.kick.stale} stale`);
    }
  // #55's stone pairs, recomputed from its counts (they are what K is read against, N6).
  out.sPairs = recomputePairs(rec.groups, RADII, { K, kMax: rec.cap.kMax, censusEvery: CENSUS }).filter((p) => out.groups.some((g) => g.seed === p.seed && g.N === p.N));
  await Deno.writeTextFile(need("out"), JSON.stringify(out, null, 1) + "\n");
}

/**
 * A source checkpoint for a GPU stage, checked against the receipts `nullprep` took (N4): the manifest's checkpoint hash at N
 * equals the prep's (per source and per group), and its final hash equals the prep's, before `loadCheckpoint` checks the file
 * against the manifest. So a checkpoint changed after nullprep (with its manifest entry updated to match) is refused (exit 2).
 */
async function sourceOf(prep: PrepFile, seed: number, N: number) {
  const s = prep.sources.find((x) => x.seed === seed);
  if (!s) die(`the prep file has no source seed ${seed}`);
  const m = await readManifest(s!.dir);
  const entry = m.checkpoints.find((c) => c.step === N);
  const g = prep.groups.find((x) => x.seed === seed && x.N === N);
  const want = s!.checkpointHashes[N];
  if (!entry || !want || entry.hash !== want || (g && g.checkpointHash !== want))
    die(`${s!.dir} at ${N}: its manifest gives ${entry?.hash ?? "no checkpoint"}, the prep recorded ${want ?? "none"}${g ? ` (group ${g.checkpointHash})` : ""}`);
  if (m.summary?.finalHash !== s!.finalHash) die(`${s!.dir}: final hash ${m.summary?.finalHash}, the prep recorded ${s!.finalHash}`);
  const start = await loadCheckpoint(s!.dir, m, N);
  return { m, start, dir: s!.dir };
}

const clone = (s: WorldState): WorldState => ({ ...s, cells: s.cells.slice(), genome: s.genome.slice(), flux: [...s.flux] });

async function lesioncheck() {
  const prep: PrepFile = await readJson(need("prep"));
  const seed = Number(a.seed ?? 1), N = Number(a.checkpoint ?? DAY1);
  const g = prep.groups.find((x) => x.seed === seed && x.N === N);
  if (!g) die(`the prep file has no group seed ${seed} N ${N}`);
  const { m, start } = await sourceOf(prep, seed, N);
  const dev = await gpu(m.spec);
  const h0 = stateHash(start.state);
  const sim = await GpuSim.create(dev, start.state);
  const t0 = performance.now();
  const out: Record<string, unknown> = { seed, N, uptime: await uptime(), stateHash: h0 };
  try {
    const k = g!.prep.kick;
    const rK = sim.lesion(k.x, k.y, 0);
    const gpuK = stateHash(await sim.readState());
    const cpu = new RefSim(clone(start.state));
    applyLesion(cpu, k.x, k.y, 0);
    const cpuK = stateHash(cpu.state);
    out.kick = { x: k.x, y: k.y, effectiveR: rK, gpu: gpuK, cpu: cpuK, ok: rK === 0 && gpuK === cpuK && gpuK !== h0 };
    const z = nullsOf(g!.prep).find((x) => x.R === 8);
    if (z) {
      sim.upload(start.state);
      const rZ = sim.lesion(z.x, z.y, 8);
      const gpuZ = stateHash(await sim.readState());
      const cpu2 = new RefSim(clone(start.state));
      applyLesion(cpu2, z.x, z.y, 8);
      const cpuZ = stateHash(cpu2.state);
      out.null8 = { x: z.x, y: z.y, effectiveR: rZ, gpu: gpuZ, cpu: cpuZ, ok: rZ === 8 && gpuZ === h0 && cpuZ === h0 };
    } else out.null8 = { none: true, ok: true };
  } finally {
    sim.destroy();
  }
  out.seconds = (performance.now() - t0) / 1000;
  out.ok = (out.kick as { ok: boolean }).ok && (out.null8 as { ok: boolean }).ok;
  out.host = hostInfo;
  await Deno.writeTextFile(need("out"), JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify(out, null, 1));
  if (!out.ok) die("lesioncheck FAILED", 4);
}

// ---- nullplan (N7)

// N7's arithmetic is in tools/lib/horizon.ts (`nullGroupWorst`, `fineWorstSeconds`, `nullScaleDown`), tested there.
const groupWorst = (n0: number, kMax: number, rate: number) => nullGroupWorst({ n0, kMax, K, chunk: CHUNK, censusEvery: CENSUS, rate });
const fineWorst = (window: number, rate: number, groups: number) => fineWorstSeconds({ window, rate, groups, anchors: ANCHORS, day1: DAY1 });

async function nullplan() {
  const p = await readJson(need("pilot"));
  const prep: PrepFile = await readJson(need("prep"));
  if (p.crossCheck?.horizonHash !== PILOT_HASH || p.crossCheck?.ok !== true || p.stopPath?.ok !== true) die(`the pilot hashes ${p.crossCheck?.horizonHash} (cross-check ${p.crossCheck?.ok}, stop path ${p.stopPath?.ok}); N7 wants ${PILOT_HASH}`, 4);
  const capHours = Number(a["cap-hours"] ?? 4);
  const capSeconds = capHours * 3600;
  const started = Date.parse(p.startedAt);
  const elapsed = (Date.now() - started) / 1000;
  const rate = p.twinRate * FACTOR;
  const day1 = prep.groups.filter((g) => g.N === DAY1);
  const sd = nullScaleDown({
    capSeconds,
    elapsed,
    day1Worst: (kMax) => day1.reduce((s, g) => s + groupWorst(nullsOf(g.prep).length, kMax, rate), 0),
    fineWorst: (window) => fineWorst(window, rate, day1.length),
  });
  const { window, kMax, scaleDown } = sd;
  const note = await Deno.readFile(repoFile(RULES));
  if (new TextDecoder().decode(note).includes(`\n${READOUT34}\n`)) die(`${RULES} already has its slice-34 readout heading: the rules digest must be taken before the run`);
  const out = {
    capHours,
    startedAt: p.startedAt,
    deadline: new Date(started + capSeconds * 1000).toISOString(),
    elapsedAtPlan: elapsed,
    rate,
    factor: FACTOR,
    fineWindow: window,
    kMax,
    scaleDown,
    budgetSeconds: sd.budget,
    groupWorst: prep.groups.map((g) => ({ seed: g.seed, N: g.N, n0: nullsOf(g.prep).length, seconds: groupWorst(nullsOf(g.prep).length, kMax, rate) })),
    fineWorstSeconds: fineWorst(window, rate, day1.length),
    rulesDigestAtStart: await sha256(note),
    commit: await sh(["git", "rev-parse", "HEAD"]),
    dirty: (await sh(["git", "status", "--porcelain", "--", "tools/horizon.ts", "tools/lib/horizon.ts", RULES])) !== "",
    uptime: await uptime(),
  };
  await Deno.writeTextFile(need("out"), JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify(out, null, 1));
}

// ---- nullrun (N2 to N4)

const nullPath = (dir: string, seed: number, N: number) => `${dir}/null-s${seed}-n${N}.json`;

function nullBindingFor(g: PrepGroup, kMax: number): NullBinding {
  return {
    seed: g.seed,
    N: g.N,
    checkpointHash: g.checkpointHash,
    stoneCentre: g.prep.stoneCentre,
    nulls: nullsOf(g.prep).map((z) => ({ R: z.R, x: z.x, y: z.y })),
    noNull: g.prep.nulls.filter((z) => "none" in z).map((z) => z.R),
    r0: g.prep.r0,
    kick: { x: g.prep.kick.x, y: g.prep.kick.y },
    K,
    kMax,
    censusEvery: CENSUS,
    chunk: CHUNK,
    entryStep: g.N + 1,
  };
}

async function nullrun() {
  const prep: PrepFile = await readJson(need("prep"));
  const planRec = await readJson(need("plan"));
  const seriesDir = need("series-dir");
  const checkpoints = ints(need("checkpoints"));
  const kMax: number = planRec.kMax;
  const deadlineMs = Date.parse(planRec.deadline);
  await Deno.mkdir(seriesDir, { recursive: true });
  for (const N of checkpoints)
    for (const g of prep.groups.filter((x) => x.N === N)) {
      const path = nullPath(seriesDir, g.seed, N);
      const binding = nullBindingFor(g, kMax);
      try {
        const old = (await readJson(path)) as NullGroupFile;
        if (old.status === "done") {
          const why = nullBindingError(old.binding, binding);
          if (why) die(`${path}: not reusable: ${why}; move it away or use a fresh --series-dir`);
          console.log(`group seed ${g.seed} N ${N}: loaded from ${path}`);
          continue;
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
      const { m, start } = await sourceOf(prep, g.seed, N);
      // The prep is re-derived from the checkpoint (which loadCheckpoint hash-checked) so the plan cannot drift from it.
      const again = prepOf(start.state, g.seed, N);
      if (JSON.stringify(again) !== JSON.stringify(g.prep)) die(`seed ${g.seed} N ${N}: the checkpoint gives another prep than ${need("prep")}`);
      const file: NullGroupFile = { seed: g.seed, N, status: "done", binding, prep: g.prep };
      const worst = groupWorst(binding.nulls.length, kMax, planRec.rate);
      const remaining = (deadlineMs - Date.now()) / 1000;
      if (!groupFits(remaining, worst)) {
        console.log(`group seed ${g.seed} N ${N}: not run (cap): worst case ${Math.round(worst)} s, ${Math.round(remaining)} s left`);
        file.status = "not run (cap)";
        delete file.binding;
        await Deno.writeTextFile(path, JSON.stringify({ ...file, worstSeconds: worst, remainingSeconds: remaining }) + "\n");
        continue;
      }
      const W = worldW(start.state.cfg), n = cellCount(start.state.cfg), H = n / W;
      const cfg = start.state.cfg as { migrationPeriod?: number; pondPeriod?: number; cellPeriod?: number };
      if (cfg.migrationPeriod || cfg.pondPeriod !== undefined || cfg.cellPeriod !== undefined) die(`seed ${g.seed}: the world has boundary transforms; slice 34 assumes none`);
      file.uptime = await uptime();
      file.ps = await psNote();
      file.startedAt = new Date().toISOString();
      console.log(`group seed ${g.seed} N ${N}: N0 ${binding.nulls.map((z) => `R${z.R}`).join(", ") || "none"}; kick (${binding.kick.x}, ${binding.kick.y}); ${file.uptime}`);
      const kick = g.prep.kick;
      const plan: ArmsPlan = {
        nulls: binding.nulls,
        kick: { x: kick.x, y: kick.y },
        pairs: RADII.map((R) => ({ label: `K|${R}`, R, mask: nearMask(W, H, kick.x, kick.y, R) })),
        controlMask: nearMask(W, H, g.prep.stoneCentre.x, g.prep.stoneCentre.y, RADII[0]),
        chunk: CHUNK,
        horizon: { K, kMax, censusEvery: CENSUS },
        entryStep: N + 1,
        u0Reference: g.u0Reference,
      };
      const deadline = performance.now() / 1000 + (deadlineMs - Date.now()) / 1000;
      try {
        file.result = await runArms(gpuIo(m.spec, start, deadline), plan);
      } catch (e) {
        // Any failure voids the group and is written down, so the record never reads a crash as a cap decision.
        const err = e instanceof Error ? e : new Error(String(e));
        file.status = "void";
        file.fault = `${err.name}: ${err.message}`;
        await Deno.writeTextFile(path, JSON.stringify({ ...file, host: hostInfo }) + "\n");
        if (!(e instanceof ControlFault || e instanceof NullFault || e instanceof DeterminismFault)) throw e;
        die(`${e.name} in group seed ${g.seed} N ${N}: ${e.message}; the group is void and the run stops (N2, N4)`, 5);
      }
      const r = file.result!;
      for (const z of r.nulls) console.log(`  ${z.name}: identical to U0 over ${z.censuses} censuses`);
      for (const p of r.pairs) console.log(`  ${p.label}: ${p.outcome.kind}`);
      await Deno.writeTextFile(path, JSON.stringify({ ...file, host: hostInfo }) + "\n");
    }
}

// ---- fine (N5)

interface FineTwin {
  name: string;
  lesion: { x: number; y: number; r: number } | null;
}

/**
 * One twin on GpuSim directly, in the runner's order (N5): from the checkpoint, one step, wait for the device, the lesion, then
 * batches of at most 64 steps to each reading; the ledger is drained every census as the runner does. Each reading is the
 * cells and the genome head (lineage words) reduced by §3's signature. A full state is read (and hashed) at the readings in
 * `hashAt` and at the last.
 */
/** The fine pilot's deadline (performance.now() seconds; N7's cap): checked before every twin, gate, anchor and reading. */
let fineDeadline = Infinity;
const fineCapCheck = (where: string) => {
  if (performance.now() / 1000 > fineDeadline) throw new FineCap(`the cap's deadline passed before ${where}`);
};

async function finePath(start: WorldState, lesion: FineTwin["lesion"], J: number, onReading: (j: number, sig: Signature) => void, hashAt: number[] = []) {
  const dev = device!;
  const sim = await GpuSim.create(dev, start);
  const t0 = performance.now();
  const N = start.step;
  const hashes: Record<number, string> = {};
  let effectiveR: number | null = null;
  try {
    let reached = N;
    const runTo = (t: number) => {
      for (let k = t - reached; k > 0; k -= 64) sim.run(Math.min(64, k));
      reached = t;
    };
    if (lesion) {
      runTo(N + 1);
      await dev.queue.onSubmittedWorkDone();
      effectiveR = sim.lesion(lesion.x, lesion.y, lesion.r);
    }
    for (let j = 1; j <= J; j++) {
      fineCapCheck(`reading ${j} of a fine twin`);
      runTo(N + EVERY * j);
      await dev.queue.onSubmittedWorkDone();
      if ((EVERY * j) % CENSUS === 0) {
        const L = await sim.drainLedger();
        if (L.dropped > 0) throw new Error(`fine path: event buffer overflow (${L.dropped} dropped) by step ${N + EVERY * j}`);
      }
      const snap = await sim.readSnapshot();
      if (snap.step !== N + EVERY * j) throw new Error(`fine path: read step ${snap.step}, expected ${N + EVERY * j}`);
      onReading(j, signatureOf({ cells: snap.cells, genome: snap.genomeHead }));
      if (j === J || hashAt.includes(j)) hashes[j] = stateHash(await sim.readState());
    }
  } finally {
    sim.destroy();
  }
  return { hashes, effectiveR, seconds: (performance.now() - t0) / 1000 };
}

async function fine() {
  const prep: PrepFile = await readJson(need("prep"));
  const planRec = await readJson(need("plan"));
  const dir = need("fine-dir");
  await Deno.mkdir(dir, { recursive: true });
  const window: number = planRec.fineWindow;
  const J = window / EVERY, jMax = J - KF + 1;
  const deadlineMs = Date.parse(planRec.deadline);
  const remaining = (deadlineMs - Date.now()) / 1000;
  fineDeadline = performance.now() / 1000 + remaining;
  const status = { window, every: EVERY, Kf: KF, jMax, rulesDigestAtStart: planRec.rulesDigestAtStart, worstSeconds: planRec.fineWorstSeconds, remainingSeconds: remaining, uptime: await uptime(), ps: await psNote(), startedAt: new Date().toISOString() };
  if (!groupFits(remaining, planRec.fineWorstSeconds)) {
    console.log(`fine pilot: not run (cap): worst case ${Math.round(planRec.fineWorstSeconds)} s, ${Math.round(remaining)} s left`);
    await Deno.writeTextFile(`${dir}/fine.json`, JSON.stringify({ status: "not run (cap)", ...status }) + "\n");
    return;
  }
  const failures: string[] = [];
  const groups: string[] = [];
  const voidFine = async (why: string) => {
    await Deno.writeTextFile(`${dir}/fine.json`, JSON.stringify({ status: "void", ...status, groups, failures: [...failures, why], finishedAt: new Date().toISOString() }, null, 1) + "\n");
    die(`the fine pilot is void: ${[...failures, why].join("; ")}`, 4);
  };
  // N7: a fine pilot the cap overtakes after admission stops where it is and reads as nothing ("stopped (cap)", exit 0).
  const stoppedFine = async (why: string) => {
    await Deno.writeTextFile(`${dir}/fine.json`, JSON.stringify({ status: "stopped (cap)", ...status, groups, failures, stopped: why, finishedAt: new Date().toISOString() }, null, 1) + "\n");
    console.log(`fine pilot: stopped (cap): ${why}`);
  };
  try {
    for (const g of prep.groups.filter((x) => x.N === DAY1)) {
      const { m, start } = await sourceOf(prep, g.seed, g.N);
      await gpu(m.spec);
      const W = worldW(start.state.cfg), n = cellCount(start.state.cfg), H = n / W;
      const sc = g.prep.stoneCentre, kc = g.prep.kick;
      const binding: FineBinding = { seed: g.seed, N: g.N, checkpointHash: g.checkpointHash, stoneCentre: { x: sc.x, y: sc.y }, kick: { x: kc.x, y: kc.y }, window, every: EVERY, Kf: KF, jMax };
      const t0 = performance.now();
      const up = await uptime();
      console.log(`fine seed ${g.seed} N ${g.N}: ${up}`);
      // U0 first, its readings held.
      const u0: Signature[] = [];
      const u0Run = await finePath(start.state, null, J, (_j, sig) => void u0.push(sig));
      const u0Living = u0.map((s) => s.living);
      let refChecked = 0;
      for (let c = 1; 16 * c <= J && c <= g.u0Reference.living.length; c++, refChecked++)
        if (u0Living[16 * c - 1] !== g.u0Reference.living[c - 1]) failures.push(`seed ${g.seed}: fine U0 has ${u0Living[16 * c - 1]} living at census ${c}, #55 ${g.u0Reference.living[c - 1]}`);
      if (failures.length) await voidFine(`seed ${g.seed}: the fine U0 does not reproduce #55, so no twin is run`);
      const twins: FineTwin[] = [...RADII.map((R) => ({ name: `S${R}`, lesion: { x: sc.x, y: sc.y, r: R } })), { name: "K", lesion: { x: kc.x, y: kc.y, r: 0 } }];
      const twinOut: Record<string, unknown>[] = [{ name: "U0", finalStateHash: u0Run.hashes[J], seconds: u0Run.seconds, living: u0Living }];
      const pairs: FinePairRecord[] = [];
      const anchor = ANCHORS.find((x) => x.seed === g.seed && x.N === g.N);
      for (const t of twins) {
        fineCapCheck(`seed ${g.seed} ${t.name}`);
        const masks = t.name === "K"
          ? RADII.map((R) => ({ label: `K|${R}`, R, kind: "K" as const, mask: nearMask(W, H, kc.x, kc.y, R) }))
          : [{ label: t.name, R: t.lesion!.r, kind: "S" as const, mask: nearMask(W, H, sc.x, sc.y, t.lesion!.r) }];
        const counts = masks.map(() => ({ nearDiff: [] as number[], nearUnion: [] as number[], farDiff: [] as number[], farUnion: [] as number[] }));
        const living: number[] = [];
        const anchorJ = anchor && t.name === `S${anchor.R}` && anchor.steps <= window ? anchor.steps / EVERY : null;
        const run = await finePath(start.state, t.lesion, J, (j, sig) => {
          living.push(sig.living);
          masks.forEach((mk, i) => {
            const c = compareRegions(sig, u0[j - 1], mk.mask);
            counts[i].nearDiff.push(c.near.diff), counts[i].nearUnion.push(c.near.union), counts[i].farDiff.push(c.far.diff), counts[i].farUnion.push(c.far.union);
          });
        }, anchorJ ? [anchorJ] : []);
        if (run.effectiveR !== t.lesion!.r) failures.push(`seed ${g.seed} ${t.name}: lesion applied with radius ${run.effectiveR}, not ${t.lesion!.r}`);
        // The gate: the same twin through runExperiment for window / 1,024 censuses.
        fineCapCheck(`seed ${g.seed} ${t.name}'s gate`);
        const io = gpuIo(m.spec, start, fineDeadline);
        const seg = await cappedRun((stop) => io.runSegment({ name: `${t.name}-gate`, entry: { step: g.N + 1, kind: "lesion", ...t.lesion! } }, null, 1, window / CENSUS, stop), io.now, fineDeadline, `seed ${g.seed} ${t.name}'s gate`);
        const runnerHash = seg.next ? stateHash(seg.next.state) : null;
        const gateOk = runnerHash !== null && runnerHash === run.hashes[J];
        if (!gateOk) failures.push(`seed ${g.seed} ${t.name}: fine path ${run.hashes[J]}, runExperiment ${runnerHash}`);
        twinOut.push({ name: t.name, lesion: t.lesion, effectiveR: run.effectiveR, finalStateHash: run.hashes[J], runnerStateHash: runnerHash, gateOk, seconds: run.seconds, gateSeconds: seg.seconds, living, ...(anchorJ ? { anchorHash: run.hashes[anchorJ] } : {}) });
        masks.forEach((mk, i) => pairs.push({ label: mk.label, R: mk.R, kind: mk.kind, ...counts[i], readings: fineReadings(finePointsOf(counts[i]), { every: EVERY, Kf: KF, jMax }) }));
      }
      fineCapCheck(`seed ${g.seed} U0's gate`);
      const u0Io = gpuIo(m.spec, start, fineDeadline);
      const u0Gate = await cappedRun((stop) => u0Io.runSegment({ name: "U0-gate" }, null, 1, window / CENSUS, stop), u0Io.now, fineDeadline, `seed ${g.seed} U0's gate`);
      const u0RunnerHash = u0Gate.next ? stateHash(u0Gate.next.state) : null;
      if (u0RunnerHash !== u0Run.hashes[J]) failures.push(`seed ${g.seed} U0: fine path ${u0Run.hashes[J]}, runExperiment ${u0RunnerHash}`);
      Object.assign(twinOut[0], { runnerStateHash: u0RunnerHash, gateOk: u0RunnerHash === u0Run.hashes[J] });
      const f = { seed: g.seed, N: g.N, status: "done", window, every: EVERY, Kf: KF, jMax, binding, uptime: up, u0: { living: u0Living, referenceChecked: refChecked }, twins: twinOut, pairs, seconds: (performance.now() - t0) / 1000, host: hostInfo };
      const path = `${dir}/fine-s${g.seed}-n${g.N}.json`;
      await Deno.writeTextFile(path, JSON.stringify(f) + "\n");
      groups.push(path);
      for (const p of pairs) console.log(`  ${p.label}: G ${Math.round(p.readings.gapArea)} steps, fine horizon ${p.readings.fineHorizon.kind === "horizon" ? p.readings.fineHorizon.steps : "censored"}`);
    }
  } catch (e) {
    if (e instanceof FineCap) return await stoppedFine(e.message);
    await voidFine(`${(e as Error)?.name ?? "Error"}: ${(e as Error)?.message ?? String(e)}`);
  }
  // The anchors: #55's stop hashes, through the fine path.
  const anchors: Record<string, unknown>[] = [];
  for (const x of ANCHORS) {
    try {
      fineCapCheck(`anchor seed ${x.seed} N ${x.N}`);
    } catch (e) {
      return await stoppedFine((e as Error).message);
    }
    const g = prep.groups.find((y) => y.seed === x.seed && y.N === x.N);
    if (!g) {
      failures.push(`anchor seed ${x.seed} N ${x.N}: not in the prep`);
      continue;
    }
    let hash: string | undefined;
    const ran = x.N === DAY1 && x.steps <= window;
    if (ran) {
      const f = JSON.parse(await Deno.readTextFile(`${dir}/fine-s${x.seed}-n${x.N}.json`));
      hash = f.twins.find((t: { name: string }) => t.name === `S${x.R}`)?.anchorHash;
    } else {
      const { m, start } = await sourceOf(prep, x.seed, x.N);
      await gpu(m.spec);
      try {
        const r = await finePath(start.state, { x: g.prep.stoneCentre.x, y: g.prep.stoneCentre.y, r: x.R }, x.steps / EVERY, () => {});
        hash = r.hashes[x.steps / EVERY];
      } catch (e) {
        if (e instanceof FineCap) return await stoppedFine(e.message);
        throw e;
      }
    }
    const recorded = g.stones.find((s) => s.R === x.R)?.stopStateHash;
    const ok = hash === x.want && recorded === x.want;
    if (!ok) failures.push(`anchor seed ${x.seed} N ${x.N} S${x.R} at +${x.steps}: fine path ${hash}, want ${x.want} (#55's record ${recorded})`);
    anchors.push({ ...x, hash, ok, fromFineRun: ran });
  }
  // N7 once more after the last anchor's readback: a pilot that ends past the deadline is stopped, never recorded done.
  try {
    fineCapCheck("the pilot was recorded");
  } catch (e) {
    return await stoppedFine((e as Error).message);
  }
  const out = { status: failures.length ? "void" : "done", ...status, groups, anchors, failures, finishedAt: new Date().toISOString() };
  await Deno.writeTextFile(`${dir}/fine.json`, JSON.stringify(out, null, 1) + "\n");
  console.log(JSON.stringify({ status: out.status, anchors, failures }, null, 1));
  if (failures.length) die(`the fine pilot is void: ${failures.join("; ")}`, 4);
}

// ---- nullrecord and nullreadout (N6, N8)

/**
 * N6's readings of a slice-34 record against #55's own record: its grid, and N5's gate evidence for a done fine pilot (the
 * anchors, and per group U0 checked at every census the window reaches that #55 recorded).
 */
const readings34 = (rec: NullRecordView, r55: { groups: { seed: number; N: number; u0?: { living: number[] } }[] }, grid: readonly { seed: number; N: number }[]) => {
  const J = (rec.fine.window ?? 0) / EVERY;
  const u0Censuses = (g: { seed: number; N: number }) => Math.min(Math.floor(J / 16), r55.groups.find((x) => x.seed === g.seed && x.N === g.N)?.u0?.living.length ?? 0);
  return nullReadings(rec, { radii: RADII, K, censusEvery: CENSUS, every: EVERY, Kf: KF, wander: WANDER, day1: DAY1, grid, fineGate: { anchors: ANCHORS, u0Censuses } });
};

/** #55's record as nullprep took it (its SHA-256 checked) and its (seed, N) grid: what slice 34's groups must be (N2). */
async function grid55(path: string, sha: string) {
  const b = await Deno.readFile(repoFile(path));
  if ((await sha256(b)) !== sha) die(`${path} no longer hashes to ${sha}`, 3);
  const rec = JSON.parse(new TextDecoder().decode(b));
  return { rec, grid: (rec.groups as { seed: number; N: number }[]).map((g) => ({ seed: g.seed, N: g.N })) };
}

async function nullrecord() {
  const prep: PrepFile = await readJson(need("prep"));
  const { rec: r55, grid } = await grid55(prep.record, prep.recordSha256);
  const gridBad = gridError(prep.groups, grid, need("prep"));
  if (gridBad) die(gridBad);
  // The stone pairs K is read against: the prep's must be #55's, recomputed from #55's own record (as nullreadout checks).
  if (JSON.stringify(sPairsFrom55(r55, grid, RADII, { K, censusEvery: CENSUS })) !== JSON.stringify(prep.sPairs)) die(`${need("prep")}: its sPairs differ from #55's pairs recomputed from ${prep.record}`, 3);
  const planRec = await readJson(need("plan"));
  const pilotRec = await readJson(need("pilot"));
  const lc = await readJson(need("lesioncheck"));
  const seriesDir = need("series-dir"), fineDir = need("fine-dir");
  const files: NullGroupFile[] = [];
  const order = [...new Set(prep.groups.map((g) => g.N))];
  for (const N of order)
    for (const g of prep.groups.filter((x) => x.N === N)) {
      try {
        files.push(await readJson(nullPath(seriesDir, g.seed, N)));
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
        files.push({ seed: g.seed, N, status: "not run (stopped)", prep: g.prep }); // never started: the run ended before it
      }
    }
  for (const f of files) {
    const g = prep.groups.find((x) => x.seed === f.seed && x.N === f.N)!;
    if (f.status === "done") {
      const why = nullBindingError(f.binding, nullBindingFor(g, planRec.kMax));
      if (why) die(`${nullPath(seriesDir, f.seed, f.N)}: ${why}`);
    }
  }
  let fineTop: Record<string, unknown> = { status: "not run" };
  try {
    fineTop = await readJson(`${fineDir}/fine.json`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const fineGroups: Record<string, unknown>[] = [];
  if (fineTop.status !== "not run" && fineTop.status !== "not run (cap)") {
    // The fine output must be this plan's and this prep's (N5): window and cadence, and per group the checkpoint, stone centre
    // and kick. Files written before the fine binding existed are checked on the fields they carry.
    const J = planRec.fineWindow / EVERY;
    const top = { window: planRec.fineWindow, every: EVERY, Kf: KF, jMax: J - KF + 1 };
    for (const [k, v] of Object.entries(top)) if (fineTop[k] !== v) die(`${fineDir}/fine.json: ${k} is ${JSON.stringify(fineTop[k])}, the plan gives ${v}`);
    const topBad = fineTopError(fineTop, ANCHORS);
    if (topBad) die(`${fineDir}/fine.json: ${topBad}`);
    if (fineTop.rulesDigestAtStart !== undefined && fineTop.rulesDigestAtStart !== planRec.rulesDigestAtStart) die(`${fineDir}/fine.json: rules digest ${fineTop.rulesDigestAtStart}, the plan's ${planRec.rulesDigestAtStart}`);
    for (const p of (fineTop.groups as string[]) ?? []) {
      const f = await readJson(p);
      const g = prep.groups.find((x) => x.seed === f.seed && x.N === f.N && x.N === DAY1);
      if (!g) die(`${p}: seed ${f.seed} N ${f.N} is not a day-1 group of the prep`);
      const want: FineBinding = { seed: g!.seed, N: g!.N, checkpointHash: g!.checkpointHash, stoneCentre: { x: g!.prep.stoneCentre.x, y: g!.prep.stoneCentre.y }, kick: { x: g!.prep.kick.x, y: g!.prep.kick.y }, ...top };
      const u0Censuses = Math.min(Math.floor(J / 16), g!.u0Reference.living.length);
      const why = fineFileError(f, want, RADII, fineTop.status === "done" ? { u0Censuses } : undefined);
      if (why) die(`${p}: ${why}`);
      fineGroups.push({ seed: f.seed, N: f.N, status: f.status, bindingChecked: f.binding ? "binding" : "fields (the file predates the fine binding: no checkpoint hash)", seconds: Math.round(f.seconds), uptime: f.uptime, u0: f.u0, twins: f.twins.map(({ living: _l, ...t }: Record<string, unknown>) => t), pairs: f.pairs });
    }
  }
  let runStatus: ReturnType<typeof parseRunStatus> | undefined;
  if (a.status) {
    const text = await Deno.readTextFile(String(a.status));
    const bad = runStatusError(text, planRec.rulesDigestAtStart);
    if (bad) die(`${a.status}: ${bad}`);
    runStatus = parseRunStatus(text);
  }
  const stages = [
    { stage: "pilot", at: pilotRec.startedAt, uptime: pilotRec.uptime },
    { stage: "lesioncheck", uptime: lc.uptime },
    { stage: "nullplan", uptime: planRec.uptime },
    ...files.filter((f) => f.uptime).map((f) => ({ stage: `group seed ${f.seed} N ${f.N}`, at: f.startedAt, uptime: f.uptime, ps: f.ps })),
    ...(fineTop.uptime ? [{ stage: "fine pilot", at: fineTop.startedAt, uptime: fineTop.uptime, ps: fineTop.ps }] : []),
  ];
  const groups = files.map(compactNullGroup);
  const fine = { status: fineTop.status as string, window: fineTop.window as number | undefined, every: EVERY, Kf: KF, jMax: fineTop.jMax as number | undefined, anchors: fineTop.anchors ?? [], failures: fineTop.failures ?? [], groups: fineGroups as { seed: number; N: number; status: string; pairs?: FinePairRecord[] }[] };
  const host = (files.find((f) => (f as { host?: typeof hostInfo }).host) as { host?: typeof hostInfo } | undefined)?.host ?? lc.host ?? hostInfo;
  const base = {
    amendment: AMENDMENT,
    rules: RULES,
    rulesDigestAtStart: planRec.rulesDigestAtStart,
    readoutHeading: READOUT34,
    commit: planRec.commit,
    dirty: planRec.dirty,
    recordedAt: { at: new Date().toISOString(), commit: await sh(["git", "rev-parse", "HEAD"]), digests: await digests() },
    ruleVersion: RULE_VERSION,
    host: host.host,
    adapter: host.adapter,
    record55: { path: prep.record, sha256: prep.recordSha256, kMax: prep.kMax55 },
    pilot: { startedAt: pilotRec.startedAt, pilotSeconds: round(pilotRec.pilotSeconds, 1), twinRate: round(pilotRec.twinRate, 1), crossCheck: pilotRec.crossCheck, stopPath: pilotRec.stopPath, uptime: pilotRec.uptime },
    lesioncheck: lc,
    cap: { hours: planRec.capHours, deadline: planRec.deadline, factor: planRec.factor, rate: round(planRec.rate, 1), fineWindow: planRec.fineWindow, kMax: planRec.kMax, scaleDown: planRec.scaleDown, groupWorst: planRec.groupWorst.map((g: { seconds: number }) => ({ ...g, seconds: Math.round(g.seconds) })), fineWorstSeconds: Math.round(planRec.fineWorstSeconds) },
    stages,
    ...(runStatus ? { runStatus: { file: String(a.status), ...runStatus } } : {}),
    sources: prep.sources,
    scratch: { prep: need("prep"), seriesDir, fineDir, note: "full counts (all three measures) are in the group files there; the directory is session-scoped and may vanish" },
    radii: RADII,
    kMax: planRec.kMax,
    sPairs: prep.sPairs,
    groups,
    fine,
  };
  const ro = readings34(base as unknown as NullRecordView, r55, grid);
  const rec = { ...base, readout: ro };
  await Deno.writeTextFile(need("out"), compactJson(rec) + "\n");
  console.log(`wrote ${need("out")}: ${groups.length} groups, fine ${fine.status}`);
}

async function nullreadoutCmd() {
  const rec = await readJson(need("record"));
  // The groups and the stone pairs K is read against come from #55's own record (its hash as nullprep took it), not trusted.
  const { rec: r55, grid } = await grid55(rec.record55.path, rec.record55.sha256);
  const ro = (() => {
    try {
      return readings34(rec, r55, grid);
    } catch (e) {
      return die(`the record does not read: ${(e as Error).message}`, 3);
    }
  })();
  if (JSON.stringify(ro) !== JSON.stringify(rec.readout)) die("the readout recomputed from the record's counts differs from the readout it stores", 3);
  const s55 = sPairsFrom55(r55, grid, RADII, { K, censusEvery: CENSUS });
  if (JSON.stringify(s55) !== JSON.stringify(rec.sPairs)) die(`the record's sPairs differ from #55's pairs recomputed from ${rec.record55.path}`, 3);
  const note = await Deno.readFile(repoFile(rec.rules));
  const prefix = await sha256(notePrefix(note, rec.readoutHeading));
  if (prefix !== rec.rulesDigestAtStart) die(`${rec.rules} before "${rec.readoutHeading}" hashes to ${prefix}, the record's rulesDigestAtStart is ${rec.rulesDigestAtStart}: the rules changed after the run started`, 3);
  const n = (x: number) => x.toLocaleString("en-US");
  const lines: string[] = [];
  lines.push(`- **Rules digest**: the note before this heading hashes to \`${prefix.slice(0, 16)}...\`, the SHA-256 stored at the run's start.`);
  const groups = rec.groups as { seed: number; N: number; status: string; prep?: NullPrep; nulls?: { name: string; R: number; censuses: number; identical: boolean }[]; kick?: { sameAsU0At1: boolean | null }; u0?: { reference: { livingChecked: number; chunk1HashChecked: boolean; finalHashChecked: boolean } | null } }[];
  for (const g of groups) {
    const nz = g.nulls?.length ? g.nulls.map((z) => `${z.name} ${z.identical ? "identical" : "DIFFERS"} over ${z.censuses}`).join(", ") : "no N0 twin";
    const none = g.prep?.nulls.filter((z) => "none" in z).map((z) => z.R) ?? [];
    const k = g.prep?.kick;
    lines.push(`- seed ${g.seed} N ${n(g.N)}: ${g.status}${g.status === "done" ? `; ${nz}${none.length ? `; no null disc at R = ${none.join(", ")} (r0 ${g.prep!.r0})` : ""}; kick (${k!.x}, ${k!.y}) P ${k!.P} E ${k!.E}${g.kick?.sameAsU0At1 ? ", equal to U0 at census 1" : ""}; U0 reproduces #55 (${g.u0?.reference?.livingChecked} censuses, chunk-1 hash ${g.u0?.reference?.chunk1HashChecked ? "checked" : "not checked"}, end hash ${g.u0?.reference?.finalHashChecked ? "checked" : "not reached"})` : ""}.`);
  }
  if (ro.fault) lines.push(`- **${ro.fault}**`);
  for (const p of ro.kPairs) {
    const o = p.outcome as { kind: string; steps?: number };
    lines.push(`  - K|${p.R} seed ${p.seed} N ${n(p.N)}: ${o.kind}${o.kind === "horizon" ? ` ${n(o.steps!)}` : ""}`);
  }
  for (const r of ro.radii) lines.push(`- **R = ${r.R}**: ${r.text}.`);
  if (rec.fine.status === "done" && ro.fine) {
    lines.push(`- **Fine pilot** (every ${EVERY} steps, window ${n(rec.fine.window)}; gates: ${rec.fine.anchors.map((x: { seed: number; R: number; steps: number; ok: boolean }) => `S${x.R} seed ${x.seed} +${n(x.steps)} ${x.ok ? "ok" : "FAILED"}`).join(", ")}; every twin equal to runExperiment):`);
    for (const g of rec.fine.groups) for (const p of g.pairs as FinePairRecord[]) {
      const r = p.readings;
      lines.push(`  - seed ${g.seed} ${p.label}: far50 ${r.far50 ?? "never"}, far90 ${r.far90 ?? "never"}, cross ${r.cross ?? "never"}, G ${n(Math.round(r.gapArea))} steps, fine horizon ${r.fineHorizon.kind === "horizon" ? n(r.fineHorizon.steps) : `censored (> ${n(r.fineHorizon.window)})`}.`);
    }
    for (const f of ro.fine) lines.push(`  - R = ${f.R}: ${f.verdict} (${f.rows.map((x) => `seed ${x.seed} G(S) ${n(Math.round(x.gS))} vs G(K) ${n(Math.round(x.gK))}`).join("; ")}).`);
  } else lines.push(`- **Fine pilot**: ${rec.fine.status}${rec.fine.failures?.length ? ` (${rec.fine.failures.join("; ")})` : ""}.`);
  lines.push(`- ${ro.pace}`);
  if (ro.side) {
    const v = (x: number) => (x === -1 ? "no mark" : x === Infinity ? "censored" : n(x));
    lines.push("", "Side readings computed by the tool (not in the rules; they decide nothing):", "");
    lines.push("- **By day**, K|R against S-R on the matched groups, with N6's median rule (values per seed, K then S):");
    for (const r of ro.side.byDay)
      for (const d of r.days)
        lines.push(`  - R = ${r.R}, N ${n(d.N)}: ${[...d.k].sort((x, y) => x.seed - y.seed).map((x) => `seed ${x.seed} ${v(x.value)} / ${v(x.s)}`).join("; ")}; medians K ${d.kMedian === null ? "none" : v(d.kMedian)}, S ${d.sMedian === null ? "none" : v(d.sMedian)} (${d.verdict}); paired ${d.paired.atLeastHalf} of ${d.paired.of}.`);
    const q = ro.side.fineQuiet;
    if (q.length) {
      const vac = q.filter((x) => x.vacuous), empty = q.filter((x) => x.emptyNear > 0);
      const late = q.filter((x) => x.firstDiff !== 1);
      lines.push(`- **Fine pairs, first difference** (the first reading where near or far differs at all): reading 1 in ${q.length - late.length} of ${q.length} pairs${late.length ? `; ${late.map((x) => `seed ${x.seed} ${x.label} ${x.firstDiff ?? "never"}`).join(", ")}` : ""}.`);
      lines.push(`  - fine horizons that start before the first difference (vacuous: nothing had happened yet; N5 has no "no mark" class): ${vac.length ? vac.map((x) => `seed ${x.seed} ${x.label}`).join(", ") : "none"}.`);
      lines.push(`  - readings with an empty near union: ${empty.length ? empty.map((x) => `seed ${x.seed} ${x.label} ${x.emptyNear} of ${rec.fine.window / EVERY}`).join(", ") : "none"}.`);
    }
  }
  console.log(lines.join("\n"));
}

if (cmd === "pilot") await pilot();
else if (cmd === "plan") await plan();
else if (cmd === "living") await living();
else if (cmd === "run") await run();
else if (cmd === "rebuild") await validating(2, "rebuild", rebuild);
else if (cmd === "readout") await validating(3, "readout", readoutCmd);
else if (cmd === "nullprep") await nullprep();
else if (cmd === "lesioncheck") await lesioncheck();
else if (cmd === "nullplan") await nullplan();
else if (cmd === "nullrun") await nullrun();
else if (cmd === "fine") await fine();
else if (cmd === "nullrecord") await validating(2, "nullrecord", nullrecord);
else if (cmd === "nullreadout") await validating(3, "nullreadout", nullreadoutCmd);
else die("usage: tools/horizon.ts pilot|plan|living|run|rebuild|readout|nullprep|lesioncheck|nullplan|nullrun|fine|nullrecord|nullreadout (see the headers)");
