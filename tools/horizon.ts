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
import { requestDevice } from "@bl/sim-gpu";
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
  string: ["source", "checkpoint", "out", "started", "pilot", "plan", "cap-hours", "sources", "replaced", "checkpoints", "radii", "series-dir", "record", "note"],
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
function twinSpec(src: RunSpec, steps: number, stone?: TwinPlan["stone"]): RunSpec {
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
      // The stone goes only to the segment that owns it (the fork window (start, start + steps]).
      const stone = twin.stone && twin.stone.step > startStep && twin.stone.step <= startStep + steps ? twin.stone : undefined;
      const spec = twinSpec(src, steps, stone);
      const ctrl = new AbortController();
      const applied: { step: number; r: number }[] = [];
      let last: WorldState | undefined;
      let reduce = 0;
      // The census gate (tools/lib/horizon.ts): k in sequence, and every census conservation-checked before it can decide.
      const gate = censusGate({ name: twin.name, N, censusEvery: CENSUS, firstK });
      const text = (f: string, t: string) => {
        if (f === INTERVENTIONS_FILE && t) for (const e of parseInterventionLog(t)) if (e.kind !== "sun") applied.push({ step: e.step, r: e.r });
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
          if (onCensus(k, sig)) ctrl.abort(DECIDED);
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

if (cmd === "pilot") await pilot();
else if (cmd === "plan") await plan();
else if (cmd === "living") await living();
else if (cmd === "run") await run();
else if (cmd === "rebuild") await validating(2, "rebuild", rebuild);
else if (cmd === "readout") await validating(3, "readout", readoutCmd);
else die("usage: tools/horizon.ts pilot|plan|living|run|rebuild|readout (see the header)");
