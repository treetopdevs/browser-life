// The runner (experiments/3d-slab/regime-sweep.ts, plan 8.4) without and with a GPU. Seeds 9900 and up only.
//
//  Pure (no GPU): the arguments and their refusals, the job lists of the four stages (dev 18 jobs, gate 20, main 96, late 96, with their
//    ids, rungs, roles and F pairs), --only, --kind, --shard and --reverse, gate.json (R9.5), the stamps and the refusals built on them,
//    the C4 comparison with M4's exact JSONs and with the rounded TSV, and the JSON writer.
//  GPU (skipped with --no-gpu): the whole-job test (f) of plan 8.3. A small job is run by the runner as a subprocess, killed with SIGKILL
//    in the middle of its twin phase, run again (the resume) and run cleanly in another directory: the two JSONs are equal apart from the
//    timings and the uptimes. A second small job (two rungs, the FEW_SITES path of a 128 x 128 x 8 world) is run twice and compared.
//
// Run from the repo root: deno run -A --no-lock tests/deno/regime_runner.ts [--no-gpu]
import {
  ROOT,
  UsageError,
  c4Of,
  computeStamps,
  gateProblems,
  jobList,
  jobText,
  m4Entry,
  m4Missing,
  parseArgs,
  parseGate,
  preflight,
  selectJobs,
  sha256Text,
  sourceStamps,
  validateOptions,
  type JobSpec,
  type M4Entry,
  type Options,
} from "../../experiments/3d-slab/regime-sweep.ts";
import { Checker } from "./regime_lib.ts";
import { expectedRoster, jobId, noiseSeed, rosterKey, sweepRoster } from "../../packages/metrics/src/index.ts";
import { isReservedSeed } from "../../experiments/3d-slab/regime-sweep.ts";

const t = new Checker("regime_runner");
const opts = (...a: string[]): Options => parseArgs(a);
const SEL = { rung: "P1", decider: "net" } as const;

function throwsUsage(name: string, f: () => unknown): void {
  try {
    f();
    t.check(name, false, "did not throw");
  } catch (e) {
    t.check(name, e instanceof UsageError, String(e));
  }
}

// ---- arguments
console.log("-- arguments");
{
  const o = opts("--stage=main", "--shard=1/3", "--only=a, b", "--reverse", "--dev", "--seeds=9900,9901", "--t=2000", "--grid=128x64", "--kind=2d", "--capture", "--keep-going", "--list", "--m4=/x", "--out=/y");
  t.check("parseArgs reads every flag", o.stage === "main" && o.shard?.i === 1 && o.shard.n === 3 && o.only.join("|") === "a|b" && o.reverse && o.dev && o.seeds?.join() === "9900,9901" && o.t === 2000 && o.grid?.W === 128 && o.grid.H === 64 && o.kind === "2d" && o.capture && o.keepGoing && o.list && o.m4 === "/x" && o.out === "/y");
  throwsUsage("a stage is required", () => opts());
  throwsUsage("an unknown stage", () => opts("--stage=foo"));
  throwsUsage("an unknown flag", () => opts("--stage=dev", "--nope"));
  throwsUsage("a flag that takes a value, without one", () => opts("--stage=dev", "--out"));
  throwsUsage("a boolean flag with a value", () => opts("--stage=dev", "--capture=1"));
  throwsUsage("a shard out of range", () => opts("--stage=dev", "--shard=3/3"));
  throwsUsage("a bad rung", () => opts("--stage=dev", "--rung=P3"));
  throwsUsage("a bad decider", () => opts("--stage=dev", "--decider=sum"));
  throwsUsage("a grid that is not whole blocks", () => opts("--stage=dev", "--grid=100"));
  throwsUsage("a non-numeric seed", () => opts("--stage=dev", "--seeds=a"));
  throwsUsage("--dev needs rehearsal seeds", () => validateOptions(opts("--stage=dev", "--dev")));
  throwsUsage("--dev refuses a reserved seed (9001)", () => validateOptions(opts("--stage=dev", "--dev", "--seeds=9001")));
  throwsUsage("--dev refuses a gate seed (101)", () => validateOptions(opts("--stage=main", "--dev", "--seeds=101", "--rung=P1", "--decider=net")));
  // the noise-swapped twin runs under noiseSeed(seed): a rehearsal seed whose N seed is a reserved one is refused too (CX-F10)
  t.check("the two seeds found by the review map to reserved N seeds (101 and 9001)", noiseSeed(1055639648) === 101 && noiseSeed(1059225128) === 9001 && isReservedSeed(101) && isReservedSeed(9001) && isReservedSeed(6) && !isReservedSeed(7) && !isReservedSeed(110) && !isReservedSeed(9004));
  throwsUsage("--dev refuses a seed whose noise-swapped twin would run under seed 101", () => validateOptions(opts("--stage=dev", "--dev", "--seeds=1055639648")));
  throwsUsage("--dev refuses a seed whose noise-swapped twin would run under seed 9001", () => validateOptions(opts("--stage=dev", "--dev", "--seeds=1059225128")));
  t.check("the rehearsal seeds in use (9900 to 9930) have unreserved N seeds", Array.from({ length: 31 }, (_, i) => 9900 + i).every((s) => !isReservedSeed(noiseSeed(s))));
  throwsUsage("--grid without --dev", () => validateOptions(opts("--stage=main", "--grid=128")));
  throwsUsage("--seeds on the gate stage", () => validateOptions(opts("--stage=gate", "--rung=P1", "--decider=net", "--seeds=104")));
  throwsUsage("--seeds outside 101 to 106 on the main stage", () => validateOptions(opts("--stage=main", "--seeds=107")));
  throwsUsage("--t=123 on the main stage", () => validateOptions(opts("--stage=main", "--t=123")));
  // the 2D reference worlds are not read at T0 (R1, R9.1; answer G1 of 2026-10-24): --t filters the two times T1 and T2 and nothing else
  throwsUsage("--t=20000 on the gate stage (the 2D references are read at 50,000 and 100,000 steps only)", () => validateOptions(opts("--stage=gate", "--rung=P1", "--decider=net", "--t=20000")));
  throwsUsage("--t=20000 on the dev stage", () => validateOptions(opts("--stage=dev", "--t=20000")));
  t.check("--t=50000 and --t=100000 pass on the gate and dev stages", (() => { for (const tt of ["--t=50000", "--t=100000"]) { validateOptions(opts("--stage=gate", "--rung=P1", "--decider=net", tt)); validateOptions(opts("--stage=dev", tt)); } return true; })());
  throwsUsage("the late stage needs --only", () => validateOptions(opts("--stage=late")));
  throwsUsage("the gate stage needs --rung and --decider", () => validateOptions(opts("--stage=gate")));
  throwsUsage("--capture needs --only", () => validateOptions(opts("--stage=main", "--capture")));
  throwsUsage("--dev on the main stage needs --rung and --decider", () => validateOptions(opts("--stage=main", "--dev", "--seeds=9900")));
  throwsUsage("--dev --t must be a multiple of 1,000", () => validateOptions(opts("--stage=dev", "--dev", "--seeds=9900", "--t=1500")));
  t.check("a valid extension request passes", (() => { validateOptions(opts("--stage=main", "--seeds=104,105,106", "--only=mu30-s8-k256")); return true; })());
  throwsUsage("main and late need the selected combination to list jobs", () => jobList(opts("--stage=main"), null));
}

// ---- job lists
console.log("-- job lists");
const dev = jobList(opts("--stage=dev"), null);
const gate = jobList(opts("--stage=gate", "--rung=P1", "--decider=net"), SEL);
const main = jobList(opts("--stage=main"), SEL);
const late = jobList(opts("--stage=late", "--only=mu30-s8-k256"), SEL);
const count = (xs: JobSpec[], f: (j: JobSpec) => boolean) => xs.filter(f).length;
{
  t.check("dev: 18 jobs (G3 3, B0 3, G2 12)", dev.length === 18 && count(dev, (j) => j.role === "G3") === 3 && count(dev, (j) => j.role === "B0") === 3 && count(dev, (j) => j.role === "G2") === 12);
  t.check("dev: seeds 9001 to 9003, ids start dev-, two rungs and the F pair", dev.every((j) => [9001, 9002, 9003].includes(j.seed) && j.ids.every((id) => id.startsWith("dev-")) && j.rungs.join() === "P1,P2" && j.fPair && j.dev));
  t.check("dev: the constant screen rides on the first B0 job only (seed 9001)", count(dev, (j) => j.screen) === 1 && dev.find((j) => j.screen)!.seed === 9001 && dev.find((j) => j.screen)!.role === "B0");
  t.check("dev: the 2D worlds are read at 50,000 and 100,000 steps (T1 and T2, never at 20,000); the slab at 20,000", dev.filter((j) => j.kind === "2d").every((j) => [50000, 100000].includes(j.T)) && dev.filter((j) => j.kind === "2d").some((j) => j.T === 50000) && dev.filter((j) => j.kind === "2d").some((j) => j.T === 100000) && dev.filter((j) => j.kind === "slab").every((j) => j.T === 20000));
  t.check("dev: job ids", dev[0].ids.join() === "dev-slab-mu60-s8-k1024-seed9001-t20000-P1,dev-slab-mu60-s8-k1024-seed9001-t20000-P2" && dev.some((j) => j.ids[0] === "dev-2d-spots-m3-seed9002-t50000-P1"));
  t.check("gate: 20 jobs (G1 3, G3 3, G4 2, G2 12)", gate.length === 20 && count(gate, (j) => j.role === "G1") === 3 && count(gate, (j) => j.role === "G3") === 3 && count(gate, (j) => j.role === "G4") === 2 && count(gate, (j) => j.role === "G2") === 12);
  t.check("gate: no 2D job starts at 20,000 steps", gate.filter((j) => j.kind === "2d").every((j) => j.T !== 20000) && gate.filter((j) => j.kind === "2d").length === 12);
  t.check("gate: seeds 101 to 103 (G4: 101, 102), no dev tag, two rungs and the F pair", gate.every((j) => [101, 102, 103].includes(j.seed) && !j.dev && j.rungs.length === 2 && j.fPair && !j.ids[0].startsWith("dev-")) && gate.filter((j) => j.role === "G4").map((j) => j.seed).join() === "101,102");
  t.check("gate: the worlds", gate.filter((j) => j.role === "G1").every((j) => j.world === "mu20-s8-k256") && gate.filter((j) => j.role === "G3").every((j) => j.world === "mu60-s8-k1024") && gate.filter((j) => j.role === "G4").every((j) => j.world === "mu20-s8-k4096"));
  t.check("main: 96 jobs, 32 settings x seeds 101 to 103 at T0, one rung, the selected decider, no F pair", main.length === 96 && new Set(main.map((j) => j.settingId)).size === 32 && main.every((j) => [101, 102, 103].includes(j.seed) && j.T === 20000 && j.rungs.join() === "P1" && j.decider === "net" && !j.fPair && j.role === "SWEEP"));
  t.check("main: ids are unique and end with rung and decider", new Set(main.map((j) => j.ids[0])).size === 96 && main[0].ids[0] === "slab-mu20-s8-k256-seed101-t20000-P1-net");
  const sets = new Set(main.map((j) => j.settingId));
  t.check("main: group D and the control are in (dtQ 26 and 102, spread 4 and 16, mutRate 0)", ["mu30-s8-k256-dtQ26", "mu30-s8-k256-dtQ102", "mu30-s8-k256-sp4", "mu30-s8-k256-sp16", "mu30-s8-k256-nomut"].every((s) => sets.has(s)));
  t.check("main: group C and B are in", ["mu30-s8-k256-dA100", "mu30-s8-k256-gK1024", "mu30-s16-k4096", "mu30-s20-k1024"].every((s) => sets.has(s)));
  t.check("late: the same 96 at T1 = 50,000", late.length === 96 && late.every((j) => j.T === 50000 && j.ids[0].includes("-t50000-")));
  const g50 = jobList(opts("--stage=gate", "--rung=P1", "--decider=net", "--t=50000"), SEL);
  t.check("gate --t=50000: the slab jobs stay at T0, the 2D jobs are filtered to 50,000", g50.filter((j) => j.kind === "slab").every((j) => j.T === 20000) && g50.filter((j) => j.kind === "2d").length === 6 && g50.filter((j) => j.kind === "2d").every((j) => j.T === 50000));
  const d100 = jobList(opts("--stage=dev", "--t=100000"), null);
  t.check("dev --t=100000: the same", d100.filter((j) => j.kind === "slab").every((j) => j.T === 20000) && d100.filter((j) => j.kind === "2d").length === 6 && d100.filter((j) => j.kind === "2d").every((j) => j.T === 100000));
  t.check("--seeds=104,105,106 gives the extension jobs", jobList(opts("--stage=main", "--seeds=104,105,106"), SEL).every((j) => [104, 105, 106].includes(j.seed)));
  t.check("--dev --t moves the slab too (a rehearsal)", jobList(opts("--stage=dev", "--dev", "--seeds=9900", "--t=3000"), null).every((j) => j.T === 3000));
  t.check("--dev lists carry the dev tag and the rehearsal grid", jobList(opts("--stage=main", "--dev", "--seeds=9900", "--grid=128", "--rung=P2", "--decider=occ"), { rung: "P2", decider: "occ" }).every((j) => j.ids[0].startsWith("dev-slab-") && j.ids[0].includes("-g128-seed9900-t20000-P2-occ")));
}

// ---- the runner lists exactly the registered roster (the reader refuses anything else)
console.log("-- roster");
{
  const keysOf = (xs: JobSpec[]) => xs.map((j) => rosterKey({ kind: j.kind, world: j.world, seed: j.seed, T: j.T, dev: j.dev })).sort();
  const rosterKeys = (xs: { kind: string; world: string; seed: number; T: number; dev: boolean }[]) => xs.map(rosterKey).sort();
  t.check("dev: the runner's 18 jobs are the Stage 0 roster of regime3.ts, key for key", JSON.stringify(keysOf(dev)) === JSON.stringify(rosterKeys(expectedRoster("dev"))));
  t.check("gate: the runner's 20 jobs are the gate roster, key for key", JSON.stringify(keysOf(gate)) === JSON.stringify(rosterKeys(expectedRoster("gate"))));
  t.check("main: the runner's 96 jobs are the sweep roster, key for key", JSON.stringify(keysOf(main)) === JSON.stringify(rosterKeys(sweepRoster())));
  // the names the reader gives a missing file are the names the runner writes
  const rungIds = (xs: ReturnType<typeof expectedRoster>) => xs.flatMap((e) => (["P1", "P2"] as const).map((rung) => jobId({ dev: e.dev, kind: e.kind, world: e.world, seed: e.seed, T: e.T, rung }))).sort();
  t.check("dev: the runner's 36 file ids are the roster's, rung by rung", dev.flatMap((j) => j.ids).length === 36 && JSON.stringify(dev.flatMap((j) => j.ids).sort()) === JSON.stringify(rungIds(expectedRoster("dev"))));
  t.check("gate: the runner's 40 file ids are the roster's, rung by rung", gate.flatMap((j) => j.ids).length === 40 && JSON.stringify(gate.flatMap((j) => j.ids).sort()) === JSON.stringify(rungIds(expectedRoster("gate"))));
  t.check("main: the runner's 96 file ids are the roster's under the selected rung and decider", JSON.stringify(main.flatMap((j) => j.ids).sort()) === JSON.stringify(sweepRoster().map((e) => jobId({ kind: "slab", world: e.world, seed: e.seed, T: e.T, rung: "P1", decider: "net" })).sort()));
  t.check("the roles agree too (G1, G2, G3, G4, B0, SWEEP)", [[dev, "dev"], [gate, "gate"]].every(([xs, stage]) => {
    const want = expectedRoster(stage as "dev" | "gate");
    return (xs as JobSpec[]).every((j) => want.some((w) => w.role === j.role && rosterKey(w) === rosterKey({ kind: j.kind, world: j.world, seed: j.seed, T: j.T, dev: j.dev })));
  }));
}

// ---- --only, --kind, --shard, --reverse
console.log("-- selection");
{
  const pick = (o: Options, list: JobSpec[]) => selectJobs(list, o);
  t.check("--only=<setting> takes its three seeds", pick(opts("--stage=main", "--only=mu30-s8-k256"), main).length === 3);
  t.check("--only=B0 is the base setting", pick(opts("--stage=main", "--only=B0"), main).map((j) => j.settingId).every((s) => s === "mu30-s8-k256"));
  t.check("--only=<job id with rung and decider> takes one job", pick(opts("--stage=main", "--only=slab-mu30-s8-k256-seed102-t20000-P1-net"), main).length === 1);
  t.check("--only=<job id without them> takes the same job", pick(opts("--stage=main", "--only=slab-mu30-s8-k256-seed102-t20000"), main).length === 1);
  t.check("--only=<role>", pick(opts("--stage=gate", "--only=G2"), gate).length === 12 && pick(opts("--stage=gate", "--only=G4"), gate).length === 2);
  t.check("--only=<preset>", pick(opts("--stage=dev", "--only=spots-m3"), dev).length === 6);
  t.check("--kind=2d and --kind=slab", pick(opts("--stage=gate", "--kind=2d"), gate).length === 12 && pick(opts("--stage=gate", "--kind=slab"), gate).length === 8);
  const shards = [0, 1, 2].map((i) => pick(opts("--stage=main", `--shard=${i}/3`), main).map((j) => j.ids[0]));
  t.check("--shard=i/n: the shards are disjoint and cover the queue", shards.flat().length === 96 && new Set(shards.flat()).size === 96 && shards.every((s) => s.length === 32));
  t.check("--shard divides the canonical index, whatever --only says", pick(opts("--stage=main", "--shard=1/2", "--only=mu30-s8-k256"), main).every((j) => j.index % 2 === 1));
  const fwd = pick(opts("--stage=main"), main).map((j) => j.ids[0]);
  const rev = pick(opts("--stage=main", "--reverse"), main).map((j) => j.ids[0]);
  t.check("--reverse walks the queue from the other end", fwd.join() === [...rev].reverse().join());
  const r13 = pick(opts("--stage=main", "--shard=1/3", "--reverse"), main);
  t.check("--shard and --reverse compose (shard first)", r13[0].index === 94 && r13[1].index === 91 && r13.length === 32);
}

// ---- gate.json (R9.5)
console.log("-- gate.json");
{
  const RULE = "ab".repeat(32);
  const ok = { pass: true, ruleSha: RULE, rung: "P1", decider: "net", refClass: "CHAOTIC", amp: "AMP-ROBUST", m4Manifest: "m", devLogSha: "d" };
  t.check("a passing gate.json that carries the rule's hash has no problem", gateProblems(parseGate(ok), RULE, { rung: null, decider: null }).length === 0);
  t.check("...and agrees with matching --rung and --decider", gateProblems(parseGate(ok), RULE, { rung: "P1", decider: "net" }).length === 0);
  const probs = (g: unknown, rule: string | null = RULE, o: Pick<Options, "rung" | "decider"> = { rung: null, decider: null }) => gateProblems(parseGate(g), rule, o).join(" | ");
  t.check("pass false is refused", /pass: true/.test(probs({ ...ok, pass: false })));
  t.check("a missing pass is refused", /pass: true/.test(probs({ ...ok, pass: undefined })));
  t.check("another rule hash is refused", /not the frozen rule/.test(probs({ ...ok, ruleSha: "cd".repeat(32) })));
  t.check("no frozen rule hash is refused", /no frozen rule hash/.test(probs(ok, null)));
  t.check("no rung or decider is refused", /no rung and decider/.test(probs({ ...ok, rung: undefined })));
  t.check("--rung that differs from gate.json is refused", /--rung=P2 differs/.test(probs(ok, RULE, { rung: "P2", decider: null })));
  t.check("--decider that differs from gate.json is refused", /--decider=occ differs/.test(probs(ok, RULE, { rung: null, decider: "occ" })));
  t.check("a missing refClass, amplitude label, M4 manifest or development-log hash is refused", ["refClass", "amp", "m4Manifest", "devLogSha"].every((k) => probs({ ...ok, [k]: undefined }).includes("R9.5")));
  t.check("the reader's gate file (schema regime-gate/1, m4Manifest an object) has no problem", gateProblems(parseGate({ schema: "regime-gate/1", label: "", draft: false, synthetic: false, pass: true, invalidRun: false, rung: "P2", decider: "occ", refClass: "CRITICAL", amp: "AMP-ROBUST", ruleSha: RULE, ruleStatus: "FROZEN", devLogSha: "d", m4Manifest: { "runs/m4-calibration/a.json": "00" }, stamps: {}, causes: [] }), RULE, { rung: null, decider: null }).length === 0);
  t.check("an empty M4 manifest object is refused", /M4/.test(probs({ ...ok, m4Manifest: {} })));
  t.check("a DRAFT gate, a synthetic one and an invalid run are refused", /DRAFT/.test(probs({ ...ok, draft: true })) && /DRAFT/.test(probs({ ...ok, ruleStatus: "DRAFT" })) && /SYNTHETIC/.test(probs({ ...ok, synthetic: true })) && /INVALID/.test(probs({ ...ok, invalidRun: true })));
  t.check("alternative spellings of the R9.5 fields are read", gateProblems(parseGate({ pass: true, ruleSha: RULE, rung: "P2", decider: "occ", refClass: "CRITICAL", ampLabel: "AMP-DEPENDENT", manifest: "m", devLogSha256: "d" }), RULE, { rung: null, decider: null }).length === 0);
}

// ---- stamps and refusals
console.log("-- stamps and refusals");
{
  const s = await sourceStamps();
  t.check("sourceStamps: a 64-hex srcHash, git's commit or 'uncommitted', and a boolean treeClean", /^[0-9a-f]{64}$/.test(s.srcHash) && (s.codeCommit === "uncommitted" || /^[0-9a-f]{40}$/.test(s.codeCommit)) && typeof s.treeClean === "boolean" && /^[0-9a-f]{40}$/.test(s.head));
  const dir = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(`${dir}/none.sha256`, "not a hash\n");
    const bad = await computeStamps({ ruleSha: `${dir}/none.sha256` });
    t.check("a RULE.sha256 without a hash is a problem", bad.ruleProblems.some((p) => p.includes("holds no SHA-256")) && bad.ruleSha === null);
    Deno.writeTextFileSync(`${dir}/r.sha256`, `${"12".repeat(32)}  regime-rule.md\n`);
    const crafted = await computeStamps({ ruleSha: `${dir}/r.sha256` });
    t.check("a RULE.sha256 that no frozen copy matches is a problem; the hash is still read", crafted.ruleSha === "12".repeat(32) && crafted.ruleSource === "frozen" && crafted.ruleProblems.length >= 1);
    const g = parseGate({ pass: true, ruleSha: "12".repeat(32), rung: "P1", decider: "net", refClass: "CHAOTIC", amp: "AMP-ROBUST", m4Manifest: "m", devLogSha: "d" });
    Deno.writeTextFileSync(`${dir}/gate.json`, JSON.stringify({ ...g, pass: true }));
    const pre = await preflight(opts("--stage=main", `--gate-json=${dir}/gate.json`, `--rule-sha=${dir}/r.sha256`), crafted);
    t.check("main with a passing gate.json: the gate raises no problem, the selection comes from it", !pre.problems.some((p) => p.includes("gate.json")) && pre.sel?.rung === "P1" && pre.sel.decider === "net" && pre.gate?.sha256.length === 64, pre.problems.join(" | "));
    t.check("...but the unfrozen rule is still refused (and a dirty tree, if it is dirty)", pre.problems.some((p) => p.includes("frozen") || p.includes("SHA-256")));
    Deno.writeTextFileSync(`${dir}/gate.json`, JSON.stringify({ pass: false }));
    const pre2 = await preflight(opts("--stage=main", `--gate-json=${dir}/gate.json`), crafted);
    t.check("main with a failing gate.json is refused", pre2.problems.some((p) => p.includes("pass: true")));
    const pre3 = await preflight(opts("--stage=late", "--only=B0", `--gate-json=${dir}/missing.json`), crafted);
    t.check("late without a gate.json is refused", pre3.problems.some((p) => p.includes("does not exist")));
    const pre4 = await preflight(opts("--stage=gate", "--rung=P1", "--decider=net"), await computeStamps({ ruleSha: `${dir}/none.sha256` }));
    t.check("gate without a frozen rule is refused", pre4.problems.some((p) => p.includes("not frozen")) && pre4.sel?.rung === "P1");
    const dv = await preflight(opts("--stage=main", "--dev", "--seeds=9900", "--rung=P2", "--decider=occ"), crafted);
    t.check("--dev waives every refusal and takes the combination from the flags", dv.problems.length === 0 && dv.sel?.rung === "P2" && dv.sel.decider === "occ" && dv.notes.length === 1);
    const st0 = await preflight(opts("--stage=dev"), crafted);
    t.check("Stage 0 needs no gate and no clean tree", st0.problems.length === 0);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

// ---- the frozen rule's records are read as the reader reads them (CX-F9): the LAST hash, R1 from the committed copy
console.log("-- the rule's records");
{
  const root = Deno.makeTempDirSync();
  const put = (rel: string, text: string) => { Deno.mkdirSync(`${root}/${rel.split("/").slice(0, -1).join("/")}`, { recursive: true }); Deno.writeTextFileSync(`${root}/${rel}`, text); };
  const ruleText = (r1: string) => `| name | value |\n|---|---|\n| RUNG, DECIDER | ${r1} | J | R4 |\n`;
  try {
    const text = ruleText("P2, occ");
    const sha = await sha256Text(text);
    put("experiments/3d-slab/regime-rule.md", text);
    put("experiments/3d-slab/REGIME-FROZEN", `# frozen\n${"1".repeat(64)}\n${sha}\n`);
    put("runs/regime/RULE.sha256", `${"2".repeat(64)}\n${sha}  regime-rule.md\n`);
    const ok = await computeStamps({ ruleSha: null }, root);
    t.check("an amended rule (an older hash first, the current one last) is accepted: both records are read by their last hash", ok.ruleSha === sha && ok.ruleSource === "frozen" && ok.ruleProblems.length === 0, ok.ruleProblems.join(" | "));
    t.check("R1 is read from the committed copy with the reader's strict form", ok.ruleCombo?.rung === "P2" && ok.ruleCombo.decider === "occ");
    put("experiments/3d-slab/REGIME-FROZEN", `${sha}\n${"1".repeat(64)}\n`);
    const old = await computeStamps({ ruleSha: null }, root);
    t.check("REGIME-FROZEN whose last hash is not the rule's is a problem (the hash is not just somewhere in the file)", old.ruleProblems.some((p) => p.includes("last SHA-256")), old.ruleProblems.join(" | "));
    put("experiments/3d-slab/REGIME-FROZEN", `${sha}\n`);
    put("runs/regime/RULE.sha256", `${sha}\n${"2".repeat(64)}\n`);
    t.check("RULE.sha256 whose last hash is another one is a problem too", (await computeStamps({ ruleSha: null }, root)).ruleProblems.some((p) => p.includes("differs from")));
    put("runs/regime/RULE.sha256", `${sha}\n`);
    // a half fill of R1 is not a fill
    put("experiments/3d-slab/regime-rule.md", ruleText("RUNG = P1; DECIDER is not filled (net is a possibility)"));
    const half = await computeStamps({ ruleSha: null }, root);
    t.check("a half-filled R1 gives no combination", half.ruleCombo === null && /names P1 and net/.test(half.ruleComboWhy ?? ""));
    // preflight compares the selection with R1 before any GPU work
    const sha2 = await sha256Text(text);
    put("experiments/3d-slab/regime-rule.md", text);
    const st = await computeStamps({ ruleSha: null }, root);
    t.check("the stamps of the restored rule agree again", st.ruleSha === sha2 && st.ruleCombo?.rung === "P2");
    const gateOpts = (rung: string, decider: string) => opts("--stage=gate", `--rung=${rung}`, `--decider=${decider}`);
    const noR1 = (p: string[]) => p.filter((x) => x.includes("R1 of the frozen rule"));
    t.check("gate: --rung and --decider that differ from R1 are refused", (await preflight(gateOpts("P1", "net"), st)).problems.some((p) => p.includes("differ from R1 of the frozen rule, (P2, occ)")));
    t.check("gate: flags equal to R1 raise no R1 problem", !(await preflight(gateOpts("P2", "occ"), st)).problems.some((p) => p.includes("differ from R1")));
    const g = parseGate({ pass: true, ruleSha: sha, rung: "P1", decider: "net", refClass: "CHAOTIC", amp: "AMP-ROBUST", m4Manifest: "m", devLogSha: "d" });
    Deno.writeTextFileSync(`${root}/gate.json`, JSON.stringify(g));
    t.check("main: a gate.json of another combination than R1's is refused", (await preflight(opts("--stage=main", `--gate-json=${root}/gate.json`), st)).problems.some((p) => p.includes("gate.json's combination (P1, net) differs from R1 of the frozen rule, (P2, occ)")));
    Deno.writeTextFileSync(`${root}/gate.json`, JSON.stringify({ ...g, rung: "P2", decider: "occ" }));
    t.check("main: a gate.json that agrees with R1 raises no combination problem", !(await preflight(opts("--stage=main", `--gate-json=${root}/gate.json`), st)).problems.some((p) => p.includes("differs from R1")));
    put("experiments/3d-slab/regime-rule.md", ruleText("**filled in by the finalizer**: `RUNG` in {P1, P2}, `DECIDER` in {net, occ}"));
    put("experiments/3d-slab/REGIME-FROZEN", `${await sha256Text(ruleText("**filled in by the finalizer**: `RUNG` in {P1, P2}, `DECIDER` in {net, occ}"))}\n`);
    put("runs/regime/RULE.sha256", Deno.readTextFileSync(`${root}/experiments/3d-slab/REGIME-FROZEN`));
    const open = await computeStamps({ ruleSha: null }, root);
    t.check("a frozen rule whose R1 is still the placeholder is refused before any GPU work", noR1((await preflight(gateOpts("P1", "net"), open)).problems).length === 1);
    t.check("--dev waives it", noR1((await preflight(opts("--stage=main", "--dev", "--seeds=9900", "--rung=P1", "--decider=net"), open)).problems).length === 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

// ---- C4 against M4's exact JSONs and the rounded TSV
console.log("-- C4");
{
  const m4dir = `${ROOT}runs/m4-calibration`;
  const tsv = `${ROOT}experiments/3d-slab/m4-results.tsv`;
  const have = (() => { try { return Array.from(Deno.readDirSync(m4dir)).filter((e) => e.name.endsWith(".json")).length; } catch { return 0; } })();
  console.log(`   ${have} M4 JSONs in ${m4dir}`);
  const spec = (stage: string, world: string, seed: number, ...rest: string[]) => jobList(opts(`--stage=${stage}`, ...rest), SEL).find((j) => j.world === world && j.seed === seed)!;
  const cells = 524288;
  if (have === 180) {
    const g1 = spec("gate", "mu20-s8-k256", 101, "--rung=P1", "--decider=net");
    const e = await m4Entry("mu20-s8-k256", 101, m4dir, tsv);
    t.check("m4Entry reads M4's exact JSON (mode json, a SHA-256, a relative path)", e?.mode === "json" && /^[0-9a-f]{64}$/.test(e.sha256) && e.path === "runs/m4-calibration/mu20-s8-k256-seed101.json" && e.extinctAt === 6000 && e.living5k.join() === "1");
    t.check("C4: the dead world's own trace and extinction step agree", c4Of(g1, { living5k: [1], extinctAt: 6000, cells }, e).check.ok && c4Of(g1, { living5k: [1], extinctAt: 6000, cells }, e).mode === "json");
    t.check("C4: an extinction at another step fails", !c4Of(g1, { living5k: [1], extinctAt: 7000, cells }, e).check.ok);
    t.check("C4: a living count off by one fails, and says where", (() => { const r = c4Of(g1, { living5k: [2], extinctAt: 6000, cells }, e); return !r.check.ok && /5000/.test(r.check.detail ?? ""); })());
    t.check("C4: a world that survives where M4's died fails", !c4Of(g1, { living5k: [1, 5, 9, 12], extinctAt: null, cells }, e).check.ok);
    const b0 = spec("main", "mu30-s8-k256", 101);
    const eb = await m4Entry("mu30-s8-k256", 101, m4dir, tsv);
    t.check("C4: B0's first four counts (T0) agree with M4's, which ran on to 50,000", c4Of(b0, { living5k: eb!.living5k.slice(0, 4), extinctAt: null, cells }, eb).check.ok);
    t.check("C4: ...and a differing count fails", !c4Of(b0, { living5k: [...eb!.living5k.slice(0, 3), eb!.living5k[3] + 1], extinctAt: null, cells }, eb).check.ok);
    const late = jobList(opts("--stage=late", "--only=B0"), SEL).find((j) => j.seed === 101)!;
    t.check("C4 at T1 compares all ten counts (a change in the tenth fails)", c4Of(late, { living5k: eb!.living5k, extinctAt: null, cells }, eb).check.ok && !c4Of(late, { living5k: [...eb!.living5k.slice(0, 9), eb!.living5k[9] - 1], extinctAt: null, cells }, eb).check.ok);
    // an M4 extinction after T is not an extinction at T
    let lateDead: { id: string; extinctAt: number; trace: number[] } | null = null;
    for (const f of Deno.readDirSync(m4dir)) {
      if (!f.name.endsWith(".json")) continue;
      const j = JSON.parse(Deno.readTextFileSync(`${m4dir}/${f.name}`)) as { id: string; extinctAt: number | null; livingTrace5k: number[] };
      if (j.extinctAt !== null && j.extinctAt > 20000) { lateDead = { id: j.id, extinctAt: j.extinctAt, trace: j.livingTrace5k }; break; }
    }
    if (lateDead) {
      const m = /^(.*)-seed(\d+)$/.exec(lateDead.id)!;
      const sp = jobList(opts("--stage=main"), SEL).find((j) => j.settingId === m[1] && j.seed === Number(m[2]));
      if (sp) {
        const en = await m4Entry(m[1], Number(m[2]), m4dir, tsv);
        t.check(`C4: M4's extinction of ${lateDead.id} at ${lateDead.extinctAt} is after T0, so a job alive at 20,000 agrees`, c4Of(sp, { living5k: lateDead.trace.slice(0, 4), extinctAt: null, cells }, en).check.ok);
      } else console.log(`   (${lateDead.id} is not a sweep setting; skipped)`);
    }
    t.check("m4Missing: the gate's slab jobs all have their JSON in the copy; an empty directory lacks all eight", m4Missing(gate, m4dir).length === 0 && m4Missing(gate, "/nonexistent-m4-dir").length === 8 && m4Missing(main, m4dir).length === 0);
    t.check("m4Missing: only the jobs C4 applies to count (group C, the control, 2D and dev jobs do not)", m4Missing(main, "/nonexistent-m4-dir").length === 54 && m4Missing(dev, "/nonexistent-m4-dir").length === 0);
  } else console.log("   (the 180 M4 JSONs are not in runs/m4-calibration: the exact-JSON checks are skipped; the synthetic and TSV cases below do not need them)");
  // These cases need no M4 file (a synthetic entry, the committed TSV): they run whether or not the 180 JSONs are in the copy, so that the test's
  // pass count does not depend on a gitignored directory (CX-F18)
  {
    const b0 = spec("main", "mu30-s8-k256", 101);
    const late = jobList(opts("--stage=late", "--only=B0"), SEL).find((j) => j.seed === 101)!;
    const synth: M4Entry = { mode: "json", path: "synthetic", sha256: "0".repeat(64), living5k: [10, 20, 30, 40, 50, 60, 0], extinctAt: 35000 };
    t.check("C4: an M4 extinction after T0 is not an extinction at T0 (the trace is cut to the job's four counts)", c4Of(b0, { living5k: [10, 20, 30, 40], extinctAt: null, cells }, synth).check.ok);
    t.check("C4 at T1: a job extinct at 35,000 agrees with M4's, a job alive at 50,000 does not", c4Of(late, { living5k: [10, 20, 30, 40, 50, 60, 0], extinctAt: 35000, cells }, synth).check.ok && !c4Of(late, { living5k: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], extinctAt: null, cells }, synth).check.ok);
    t.check("C4 at T0 against a synthetic entry: a differing count fails, and so does an extinction M4 does not have before T0", !c4Of(b0, { living5k: [10, 20, 30, 41], extinctAt: null, cells }, synth).check.ok && !c4Of(b0, { living5k: [10, 20], extinctAt: 15000, cells }, synth).check.ok);
    const tsvOnly = await m4Entry("mu30-s8-k256", 101, "/nonexistent-m4-dir", tsv);
    t.check("without the JSON the TSV is the fallback (mode tsv-rounded)", tsvOnly?.mode === "tsv-rounded" && /^[0-9a-f]{64}$/.test(tsvOnly.sha256) && tsvOnly.path === "experiments/3d-slab/m4-results.tsv");
    const frac = tsvOnly!.living5k;
    t.check("C4 by the rounded TSV: within 0.00005 of the fraction passes, 0.0002 off fails", c4Of(b0, { living5k: frac.slice(0, 4).map((x) => Math.round(x * cells)), extinctAt: null, cells }, tsvOnly).check.ok && !c4Of(b0, { living5k: frac.slice(0, 4).map((x) => Math.round((x + 0.0002) * cells)), extinctAt: null, cells }, tsvOnly).check.ok);
    t.check("a setting with neither source fails C4 (not applicable is for other cases)", !c4Of(b0, { living5k: [1], extinctAt: null, cells }, null).check.ok);
  }
  const c = jobList(opts("--stage=main"), SEL).find((j) => j.world === "mu30-s8-k256-dA100" && j.seed === 101)!;
  t.check("C4 is not applicable to group C (M4 never ran that axis)", c4Of(c, { living5k: [1], extinctAt: null, cells }, null).check.applicable === false && c4Of(c, { living5k: [1], extinctAt: null, cells }, null).mode === "none");
  t.check("...to the control, to group D, to the extension seeds, to development seeds and to 2D worlds", [
    jobList(opts("--stage=main"), SEL).find((j) => j.world === "mu30-s8-k256-nomut")!,
    jobList(opts("--stage=main"), SEL).find((j) => j.world === "mu30-s8-k256-dtQ26")!,
    jobList(opts("--stage=main", "--seeds=104"), SEL)[0],
    dev[0],
    gate.find((j) => j.kind === "2d")!,
  ].every((j) => c4Of(j, { living5k: [1], extinctAt: null, cells }, null).check.applicable === false));
}

// ---- the writer
console.log("-- writer");
{
  const text = jobText({ a: NaN, b: [1, Infinity, 2], c: undefined, d: 5n, e: { f: 1 } });
  t.check("non-finite numbers are written as null, undefined keys are dropped, bigints become strings", text.includes('"a":null') && text.includes('"b":[1,null,2]') && !text.includes('"c"') && text.includes('"d":"5"') && JSON.parse(text).e.f === 1);
  t.check("one top-level key per line", text.split("\n").length === 7);
}

// ---- GPU: the whole job re-run
if (!Deno.args.includes("--no-gpu")) {
  console.log("-- GPU: the whole-job re-run (plan 8.3 f)");
  // what a clock or the load decides: the phase timings, the job's seconds and its burn-in steps per second, the two uptime lines
  const VOLATILE = ["timings", "seconds", "stepsPerSec", "uptimeStart", "uptimeEnd"];
  const RUNNER = `${ROOT}experiments/3d-slab/regime-sweep.ts`;
  const run = (args: string[]) => new Deno.Command(Deno.execPath(), { args: ["run", "--no-lock", "-A", `--config=${ROOT}deno.json`, RUNNER, ...args], cwd: ROOT, stdout: "piped", stderr: "piped" });
  const load = (path: string): Record<string, unknown> => {
    const j = JSON.parse(Deno.readTextFileSync(path)) as Record<string, unknown>;
    for (const k of VOLATILE) delete j[k];
    return j;
  };
  const stable = (path: string): string => JSON.stringify(load(path));
  /** The keys in which two job files differ (once the volatile ones are gone): what a failed comparison reports. */
  const differing = (a: string, b: string): string => {
    const x = load(a), y = load(b);
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).join(", ") || "none";
  };
  const dirA = Deno.makeTempDirSync(), dirB = Deno.makeTempDirSync(), dirC = Deno.makeTempDirSync(), dirD = Deno.makeTempDirSync();
  try {
    // a main-style job (one rung, S and U twins), killed in the middle of its twin phase, resumed, and run cleanly elsewhere
    const jobArgs = ["--stage=main", "--dev", "--seeds=9901", "--rung=P1", "--decider=net", "--grid=256", "--t=5000", "--only=mu30-s8-k1024"];
    const id = "dev-slab-mu30-s8-k1024-g256-seed9901-t5000-P1-net";
    const child = run([...jobArgs, `--out=${dirA}`]).spawn();
    let seen = "";
    let killed = false;
    const reader = child.stdout.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
      if (!killed && seen.includes("sites in")) {
        await new Promise((r) => setTimeout(r, 6000));
        child.kill("SIGKILL");
        killed = true;
      }
    }
    await child.status;
    const left = Array.from(Deno.readDirSync(dirA)).map((e) => e.name);
    t.check("a SIGKILL in the middle of the twin phase leaves no job file (and no .tmp)", killed && left.length === 0, `killed ${killed}, left ${left.join(",")}`);
    const resumed = await run([...jobArgs, `--out=${dirA}`]).output();
    t.check("the rerun resumes the job and finishes it", resumed.code === 0 && Deno.statSync(`${dirA}/${id}.json`).isFile, new TextDecoder().decode(resumed.stderr).slice(0, 400));
    const clean = await run([...jobArgs, `--out=${dirB}`]).output();
    t.check("a clean run in another directory", clean.code === 0);
    t.check("the resumed job equals the clean job apart from timings and uptimes", stable(`${dirA}/${id}.json`) === stable(`${dirB}/${id}.json`), `differs in ${differing(`${dirA}/${id}.json`, `${dirB}/${id}.json`)}`);
    const again = await run([...jobArgs, `--out=${dirA}`]).output();
    t.check("a third run skips a job whose JSON exists", again.code === 0 && new TextDecoder().decode(again.stdout).includes("nothing to run"));
    // a dev-style job (two rungs from one burn-in; the second rung from the frozen copy) twice
    const devArgs = ["--stage=dev", "--dev", "--seeds=9900", "--grid=128", "--t=3000", "--only=G3", "--kind=slab"];
    const r1 = await run([...devArgs, `--out=${dirC}`]).output();
    const r2 = await run([...devArgs, `--out=${dirD}`]).output();
    t.check("a two-rung job runs twice", r1.code === 0 && r2.code === 0, new TextDecoder().decode(r1.stderr).slice(0, 300));
    for (const rung of ["P1", "P2"]) {
      const f = `dev-slab-mu60-s8-k1024-g128-seed9900-t3000-${rung}.json`;
      t.check(`...and the ${rung} files are equal apart from timings and uptimes`, stable(`${dirC}/${f}`) === stable(`${dirD}/${f}`), `differs in ${differing(`${dirC}/${f}`, `${dirD}/${f}`)}`);
    }
    const a = JSON.parse(Deno.readTextFileSync(`${dirC}/dev-slab-mu60-s8-k1024-g128-seed9900-t3000-P1.json`)) as { hashes: Record<string, string>; stateHashT: string; liveR: number[] };
    const b = JSON.parse(Deno.readTextFileSync(`${dirC}/dev-slab-mu60-s8-k1024-g128-seed9900-t3000-P2.json`)) as { hashes: Record<string, string>; stateHashT: string; liveR: number[] };
    t.check("both rungs saw the same reference: equal state hash at T, at step 100 and at step 1,000, and equal live counts", a.stateHashT === b.stateHashT && a.hashes.R100 === b.hashes.R100 && a.hashes.R1000 === b.hashes.R1000 && JSON.stringify(a.liveR) === JSON.stringify(b.liveR));
  } finally {
    for (const d of [dirA, dirB, dirC, dirD]) Deno.removeSync(d, { recursive: true });
  }
}
t.done();
