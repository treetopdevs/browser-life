// Donors picked by something other than the rule, end to end on a native WebGPU device (wild sandbox; packages/runner/src/picks.ts,
// tools/lib/pickers.ts, tools/picker-claude.ts, tools/run.ts's --picker, --picks-from and recovery). Two fixtures: A, ponds-small
// (4 ponds, one donor) for the segment and recovery checks; B, the breeder preset (16 ponds, four donors) at a 1,500-step period
// with a census every 100 steps, so that the hook-at-pond-boundaries-only rule is exercised. The checks:
//
//  1. an unpicked run's bundle has no picks.jsonl, no manifest.picks and no spec.picked;
//  2. the rule picker equals the unpicked run: final hash, ponds.tsv, final state; its log's donors are the arm's own;
//  3. the random picker (seed 7): conserved, a log line per boundary of distinct occupied donors, some unlike the rule's, the log
//     and ponds.tsv consistent;
//  4. replaying (3)'s log with no picker gives the same final hash, ponds.tsv bytes and every pre-cycle checkpoint;
//  5. replay-then-continue: a record longer than the live count, in a reversed order, then the rule picker. The record wins
//     (`by` recorded, then rule), each boundary's rows are applyPondCycle's on its own pre-cycle checkpoint with the logged donors
//     (so the donor order assigns recipients as the oracle does), and the hybrid run equals the replay of its own log;
//  6. the file picker, answered by a background process that writes a half-written file first: the request has its pinned keys
//     and no `suggested`, the sheet is a PNG, and the run equals the replay of its log;
//  7. the command picker (a shell one-liner), and 7b the model picker's script against a stub `claude` (the notebook, the pending
//     block, the call log and its cap);
//  8. every failure (an empty pond, a repeat, too many, none, a throw, a non-zero exit, a timeout, a late answer file) stops the run
//     with a PickError, a `failed` line and no ponds.tsv row, and a readback of the simulation after the rejection is the
//     pre-selection state; a scribbling picker changes nothing; a throwing `applied` stops with phase "after" and the next run
//     replays that boundary; 8b, through tools/run.ts: a failed recovery keeps all ten recorded picks in picks.recovery.jsonl and
//     a third attempt completes;
//  8c. recovery that must not lose or mix histories (through tools/run.ts): a log with a torn last record recovers its complete
//     picks (and is refused without --picks-from), a damaged log or two logs that disagree at a step are refused with every file
//     untouched; 8d. real child processes: a deadline ends the whole tree and a child that ignores SIGTERM, output past the cap stops
//     the child, and a picker's `applied` or a throw of null cannot corrupt the manifest's digest or skip the failed line;
//  9. a log with a missing boundary and no picker, or an entry off a boundary, is refused before the run starts (and by tools/run.ts);
// 10. a picked run refuses a start state and a missing picker, and a picked segment cannot be stitched;
// 11. a lab-style manifest (`interventions` of kind pick) built by hand from (3)'s log replays to the same final hash; a sparse one
//     takes the rule's donors where it has none.
//
// Run from the repo root: deno run -A tests/deno/picked.ts
import {
  PRESETS,
  RULE_VERSION,
  applyPondCycle,
  breedPondColumns,
  initWorld,
  pondDonors,
  pondTraits,
  presetConfig,
  stateHash,
  CH,
  cellCount,
  worldW,
  type WorldState,
} from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import {
  PICKS_FILE,
  PONDS_FILE,
  PickError,
  applyBoundary,
  decodeArtifact,
  makeDonorHook,
  parsePickLog,
  pondCensus,
  pondContext,
  picksConsistencyError,
  picksDigest,
  picksFromManifest,
  runExperiment,
  specConfig,
  stitchRun,
  type ObserverState,
  type PickEntry,
  type PickRequest,
  type Picker,
  type RunSpec,
  type Sink,
  type StitchSegment,
} from "@bl/runner";
import { canonicalPath, commandAnswerer, denoIo, denoRun, dirPicker, fileAnswerer, randomPicker, rulePicker } from "../../tools/lib/pickers.ts";
import { runBounded } from "../../tools/lib/run-command.ts";

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

const host = { host: "test", adapter: "test" };
const breeder = PRESETS.find((p) => p.id === "breeder")!;
const device = await requestDevice(navigator.gpu, presetConfig(breeder, 1));
const tmp = await Deno.makeTempDir({ prefix: "picked-" });

const PERIOD = 1500;
const specB = (cycles: number, over: Partial<RunSpec> = {}): RunSpec => ({
  experiment: "picked-test", presetId: "breeder", condition: "treatment", seed: 1, steps: cycles * PERIOD, censusEvery: 100, deepEvery: 10, checkpointEvery: 0,
  preCycleCheckpoints: Array.from({ length: cycles }, (_, k) => k + 1), overrides: { pondPeriod: PERIOD }, ...over,
});
const picked = (s: RunSpec): RunSpec => ({ ...s, picked: true });

interface Run {
  finalHash: string;
  final: WorldState;
  conservationOk: boolean;
  observer: ObserverState;
  files: Record<string, string>;
  bytes: Map<string, Uint8Array>;
  sink: Mem;
}
async function run(spec: RunSpec, opts: Parameters<typeof runExperiment>[5] = {}): Promise<Run> {
  const sink = new Mem();
  const r = await runExperiment(device, spec, sink, host, () => {}, { keepFinal: true, ...opts });
  return { finalHash: r.summary.finalHash, final: r.final!, conservationOk: r.summary.conservationOk, observer: r.observer, files: Object.fromEntries(sink.files), bytes: sink.bytes, sink };
}
/** The error a run rejects with (and the sink it was writing), or null when it completes. */
async function rejection(spec: RunSpec, opts: Parameters<typeof runExperiment>[5]): Promise<{ error: Error | null; sink: Mem }> {
  const sink = new Mem();
  try {
    await runExperiment(device, spec, sink, host, () => {}, opts);
    return { error: null, sink };
  } catch (e) {
    return { error: e as Error, sink };
  }
}
const lines = (text: string | undefined) => (text ?? "").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
const pickLines = (r: { files: Record<string, string> }) => lines(r.files[PICKS_FILE]).filter((l) => l.kind === "pick");
const preAt = (r: Run, b: number) => decodeArtifact(r.bytes.get(`checkpoints/b${String(b).padStart(3, "0")}-pre.blck`)!).state;
const samePre = (x: Run, y: Run, cycles: number) => Array.from({ length: cycles }, (_, k) => k + 1).every((b) => stateHash(preAt(x, b)) === stateHash(preAt(y, b)));

try {
  const CYCLES = 5;
  // --- 1. the unpicked run
  const plain = await run(specB(CYCLES));
  const manifestOf = (r: { files: Record<string, string> }) => JSON.parse(r.files["manifest.json"]) as { spec: Record<string, unknown>; picks?: Record<string, unknown> };
  check("1. an unpicked run has no picks.jsonl, no manifest.picks and no spec.picked", !(PICKS_FILE in plain.files) && manifestOf(plain).picks === undefined && manifestOf(plain).spec.picked === undefined && plain.conservationOk);
  const cfg = specConfig(specB(CYCLES));
  const ctx = pondContext(initWorld(cfg, breeder.init))!;
  const score = cfg.pondScore!;
  const columns = breedPondColumns(score);
  const tsv = (text: string) => {
    const [header, ...rows] = text.trimEnd().split("\n");
    const names = header.split("\t");
    return rows.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [names[i], v])));
  };

  // --- 2. the rule picker is the unpicked run
  const ruleRun = await run(picked(specB(CYCLES)), { picker: rulePicker() });
  const ruleLines = pickLines(ruleRun);
  check("2. the rule picker: the unpicked run's final hash, ponds.tsv and final state", ruleRun.finalHash === plain.finalHash && ruleRun.files[PONDS_FILE] === plain.files[PONDS_FILE] && stateHash(ruleRun.final) === stateHash(plain.final), `${ruleRun.finalHash} vs ${plain.finalHash}`);
  check("2. ...its log has a line per boundary and donors equal suggested on every one, consistent with ponds.tsv", ruleLines.length === CYCLES && ruleLines.every((l) => JSON.stringify(l.donors) === JSON.stringify(l.suggested) && l.by === "rule") && picksConsistencyError(ruleRun.files[PICKS_FILE], ruleRun.files[PONDS_FILE], 1) === null);
  const mf = manifestOf(ruleRun);
  check("2. ...and its manifest says spec.picked and a picks block with counts", mf.spec.picked === true && mf.picks?.picker === "rule" && mf.picks?.live === CYCLES && mf.picks?.recorded === 0 && mf.picks?.boundaries === CYCLES && typeof mf.picks?.digest === "string", JSON.stringify(mf.picks));

  // --- 3. the random picker
  const rand = await run(picked(specB(CYCLES)), { picker: randomPicker(7) });
  const randLines = pickLines(rand);
  const distinct = randLines.every((l) => new Set(l.donors as number[]).size === (l.donors as number[]).length && (l.donors as number[]).length > 0);
  check("3. the random picker conserves matter and energy exactly", rand.conservationOk);
  check("3. ...logs a line per boundary of distinct donors, consistent with ponds.tsv", randLines.length === CYCLES && distinct && picksConsistencyError(rand.files[PICKS_FILE], rand.files[PONDS_FILE], 1) === null);
  check("3. ...some line differs from the rule's suggestion, and every one names the same count", randLines.some((l) => JSON.stringify(l.donors) !== JSON.stringify(l.suggested)) && randLines.every((l) => (l.donors as number[]).length === (l.suggested as number[]).length), JSON.stringify(randLines.map((l) => [l.donors, l.suggested])));

  // --- 4. replay with no picker
  const randLog = parsePickLog(rand.files[PICKS_FILE]);
  const replay = await run(picked(specB(CYCLES)), { picks: randLog });
  check("4. replay of the random log with no picker: the same final hash and ponds.tsv bytes", replay.finalHash === rand.finalHash && replay.files[PONDS_FILE] === rand.files[PONDS_FILE], `${replay.finalHash} vs ${rand.finalHash}`);
  check("4. ...every pre-cycle checkpoint equal, and the replayed log says recorded with the same donors", samePre(replay, rand, CYCLES) && pickLines(replay).every((l, i) => l.by === "recorded" && JSON.stringify(l.donors) === JSON.stringify(randLog[i].donors)));

  // --- 5. replay-then-continue
  {
    const occ = (b: number) => pondTraits(preAt(rand, b)).flatMap((t, p) => (t > 0 ? [p] : []));
    // Three boundaries recorded: the first two as (3), the third every occupied pond of its state in descending order (longer than the live count of four).
    const third = occ(3).reverse();
    const record: PickEntry[] = [randLog[0], randLog[1], { step: 3 * PERIOD, cycle: 3, donors: third }];
    const hybrid = await run(picked(specB(CYCLES)), { picks: record, picker: rulePicker() });
    const hl = pickLines(hybrid);
    check("5. the record wins: three boundaries recorded (the third longer than the live count, descending), the rest by the rule", hl.slice(0, 3).every((l, i) => l.by === "recorded" && JSON.stringify(l.donors) === JSON.stringify(record[i].donors)) && hl.slice(3).every((l) => l.by === "rule") && third.length > 4, JSON.stringify(hl.map((l) => [l.by, l.donors])));
    let oracle = true, why = "";
    const rows = tsv(hybrid.files[PONDS_FILE]);
    for (let b = 1; b <= CYCLES; b++) {
      const pre = preAt(hybrid, b);
      const donors = hl[b - 1].donors as number[];
      if (b > 3 && JSON.stringify(donors) !== JSON.stringify(pondDonors(pre, b, "breed", 8, score))) { oracle = false; why ||= `boundary ${b}: not the rule's donors`; }
      const want = applyPondCycle(pre, b, "breed", 8, ctx.Mr, pondCensus, score, donors).rows.map((x) => columns.map((c) => String(x[c])).join("\t"));
      const got = rows.filter((x) => Number(x.cycle) === b).map((x) => columns.map((c) => x[c]).join("\t"));
      if (JSON.stringify(got) !== JSON.stringify(want)) { oracle = false; why ||= `boundary ${b}: rows differ from applyPondCycle's`; }
    }
    check("5. ...each boundary's rows are applyPondCycle's on its own pre-cycle checkpoint with the logged donors in the logged order; later donors are the rule's", oracle, why);
    check("5. ...the hybrid's log is consistent with its ponds.tsv", picksConsistencyError(hybrid.files[PICKS_FILE], hybrid.files[PONDS_FILE], 1) === null);
    const again = await run(picked(specB(CYCLES)), { picks: parsePickLog(hybrid.files[PICKS_FILE]) });
    check("5. ...and the hybrid equals the replay of its own log", again.finalHash === hybrid.finalHash && again.files[PONDS_FILE] === hybrid.files[PONDS_FILE] && samePre(again, hybrid, CYCLES));
  }

  // --- 6. the file picker, answered by a background process
  {
    const dir = `${tmp}/file`;
    const seen: { keys: string[]; suggested: boolean; png: boolean; occupied: number[] }[] = [];
    let stop = false;
    const answerer = (async () => {
      const done = new Set<string>();
      while (!stop) {
        try {
          for await (const e of Deno.readDir(dir)) {
            if (!/^b\d{3}-request\.json$/.test(e.name) || done.has(e.name)) continue;
            done.add(e.name);
            const req = JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`));
            const sheet = await Deno.readFile(`${dir}/${req.sheet}`);
            seen.push({ keys: Object.keys(req).sort(), suggested: JSON.stringify(req).includes("suggested"), png: sheet[0] === 0x89 && sheet[1] === 0x50 && sheet[2] === 0x4e && sheet[3] === 0x47, occupied: req.occupied });
            const answer = `${dir}/${req.answer}`;
            // Half a file first: the picker must wait for it to be whole.
            await Deno.writeTextFile(answer, `{"donors":[${req.occupied[1]},`);
            await new Promise((r) => setTimeout(r, 300));
            await Deno.writeTextFile(answer, JSON.stringify({ donors: [req.occupied[1], req.occupied[0]], nonce: req.nonce }));
          }
        } catch { /* the directory does not exist yet */ }
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    const file = dirPicker({ dir, io: denoIo, name: "file", answer: fileAnswerer({ io: denoIo, timeoutMs: 30_000, pollMs: 50 }) });
    const r = await run(picked(specB(3)), { picker: file });
    stop = true;
    await answerer;
    const keys = ["album", "answer", "applied", "cycle", "dir", "donors", "eligible", "foundingMass", "grid", "nonce", "occupied", "ponds", "sheet", "step", "tile", "version"];
    check("6. the file picker: each request has its pinned keys and no suggested, each sheet is a PNG", seen.length === 3 && seen.every((s) => JSON.stringify(s.keys) === JSON.stringify(keys) && !s.suggested && s.png), JSON.stringify(seen.map((s) => s.keys)));
    check("6. ...the donors are the half-written file's complete answer, in its order", pickLines(r).every((l, i) => l.by === "file" && JSON.stringify(l.donors) === JSON.stringify([seen[i].occupied[1], seen[i].occupied[0]])), JSON.stringify(pickLines(r).map((l) => l.donors)));
    const back = await run(picked(specB(3)), { picks: parsePickLog(r.files[PICKS_FILE]) });
    check("6. ...and the run equals the replay of its own log", back.finalHash === r.finalHash && back.files[PONDS_FILE] === r.files[PONDS_FILE]);
    check("6. ...an album was kept beside the sheets", (await Deno.stat(`${dir}/album.png`).catch(() => null))?.isFile === true);
  }

  // --- 7. the command picker
  {
    const dir = `${tmp}/command`;
    const argv = ["sh", "-c", "cat >/dev/null; echo '{\"donors\":[1]}'"];
    const r = await run(picked(specB(1)), { picker: dirPicker({ dir, io: denoIo, name: "command:test", answer: commandAnswerer({ argv, run: denoRun, timeoutMs: 20_000 }) }) });
    const l = pickLines(r);
    check("7. the command picker: its one donor (pond 1) is applied", l.length === 1 && JSON.stringify(l[0].donors) === "[1]" && l[0].by === "command:test" && r.conservationOk, JSON.stringify(l));
  }
  {
    // 7b. tools/picker-claude.ts against a stub claude
    const dir = `${tmp}/model`;
    await Deno.mkdir(dir, { recursive: true });
    const stub = `${tmp}/claude-stub.sh`;
    await Deno.writeTextFile(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > "$STUB_ARGS"\ncat "$STUB_REPLY"\n`);
    await Deno.chmod(stub, 0o755);
    const reply = (picks: number[]) => JSON.stringify({ type: "result", is_error: false, duration_ms: 12, total_cost_usd: 0.002, structured_output: { seen: "dark ponds", picks: picks.map((pond) => ({ pond, new: `pond ${pond} is new` })) } });
    const callLog = `${tmp}/calls.log`;
    const request = (cycle: number) => JSON.stringify({ version: 1, nonce: `n${cycle}`, cycle, step: cycle * 5000, dir, sheet: `b00${cycle}-sheet.png`, album: null, grid: { x: 4, y: 4 }, tile: 64, ponds: 16, occupied: [0, 1, 2, 3, 5, 6], eligible: [0, 2, 3, 6], foundingMass: 3000, donors: { min: 1, max: 3 }, answer: `b00${cycle}-picks.json`, applied: `b00${cycle}-applied.json` });
    // The runner's part: what its dir picker records once a boundary is committed.
    const commit = (cycle: number, donors: number[], by = "command:model") => Deno.writeTextFile(`${dir}/b00${cycle}-applied.json`, JSON.stringify({ cycle, step: cycle * 5000, donors, by }) + "\n");
    const call = async (cycle: number, picks: number[], maxCalls = 3) => {
      await Deno.writeTextFile(`${tmp}/reply.json`, reply(picks));
      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", new URL("../../tools/picker-claude.ts", import.meta.url).pathname, "--call-log", callLog, "--max-calls", String(maxCalls)],
        cwd: dir, stdin: "piped", stdout: "piped", stderr: "piped", env: { CLAUDE_BIN: stub, STUB_ARGS: `${tmp}/args.txt`, STUB_REPLY: `${tmp}/reply.json` },
      }).spawn();
      const w = child.stdin.getWriter();
      await w.write(new TextEncoder().encode(request(cycle)));
      await w.close();
      const out = await child.output();
      return { code: out.code, stdout: new TextDecoder().decode(out.stdout), stderr: new TextDecoder().decode(out.stderr) };
    };
    const c1 = await call(1, [3, 0, 6]);
    const args = (await Deno.readTextFile(`${tmp}/args.txt`)).split("\n");
    check("7b. picker-claude: the stub's picks come back as donors, in the model's order", c1.code === 0 && JSON.stringify(JSON.parse(c1.stdout)) === '{"donors":[3,0,6]}', c1.stderr);
    check("7b. ...claude is called lean (--tools Read, --strict-mcp-config, --restricted, no settings)", args.includes("--restricted") && args.includes("--strict-mcp-config") && args[args.indexOf("--tools") + 1] === "Read" && args[args.indexOf("--setting-sources") + 1] === "");
    await commit(1, [3, 0, 6]);
    const c2 = await call(2, [2, 3, 6]);
    const notebook = await Deno.readTextFile(`${dir}/notebook.md`);
    check("7b. ...once cycle 1 is committed with those donors, the next cycle's call promotes its block into notebook.md and the prompt carries it", c2.code === 0 && notebook.includes("## Cycle 1 (t=5,000)") && notebook.includes("- pond 3: pond 3 is new") && args.length > 0 && (await Deno.readTextFile(`${tmp}/args.txt`)).includes("pond 0: pond 0 is new"));
    const c2b = await call(2, [2, 3, 6], 9);
    check("7b. ...a recovery asking cycle 2 again drops its stale pending block", c2b.code === 0 && !(await Deno.readTextFile(`${dir}/notebook.md`)).includes("## Cycle 2"));
    // A crash before cycle 2's commit, then a recovery that replays other donors there: the block describes a choice the run never applied.
    await commit(2, [2, 3, 0], "recorded");
    const c3 = await call(3, [0, 2, 6], 9);
    check("7b. ...a block whose donors the run did not apply (a recovery replayed others at that cycle) never enters the notebook", c3.code === 0 && !(await Deno.readTextFile(`${dir}/notebook.md`)).includes("## Cycle 2"), c3.stderr);
    const c4 = await call(4, [3, 0, 6], 9);
    check("7b. ...nor does one with nothing on record for its cycle (a crash before the commit)", c4.code === 0 && !(await Deno.readTextFile(`${dir}/notebook.md`)).includes("## Cycle 3"), c4.stderr);
    const bad = await call(3, [5, 0, 2], 9);
    const log = lines(await Deno.readTextFile(callLog));
    check("7b. ...an ineligible pick exits 1 with the reason and an invalid line", bad.code === 1 && /not in the pool/.test(bad.stderr) && log.at(-1)?.status === "invalid", bad.stderr);
    const capped = await call(3, [3, 0, 6], 6);
    const after = lines(await Deno.readTextFile(callLog));
    check("7b. ...the call log counts attempts (started lines), and a call at the cap is refused without launching claude", capped.code === 1 && /limit is 6/.test(capped.stderr) && after.filter((l) => l.status === "started").length === 6 && after.length === log.length, capped.stderr);
    // A cap that is not a positive finite number would never apply: refused at startup, before the log or the stub is touched.
    for (const flag of [["--max-calls", "abc"], ["--max-calls", "2.5"], ["--timeout", "Infinity"], ["--max-budget", "1e309"], ["--max-budget", "0"]]) {
      const before = await Deno.readTextFile(callLog);
      const out = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", new URL("../../tools/picker-claude.ts", import.meta.url).pathname, "--call-log", callLog, ...flag],
        cwd: dir, stdin: "null", stdout: "piped", stderr: "piped", env: { CLAUDE_BIN: stub, STUB_ARGS: `${tmp}/args.txt`, STUB_REPLY: `${tmp}/reply.json` },
      }).output();
      const err = new TextDecoder().decode(out.stderr);
      check(`7b. ...${flag.join(" ")} is refused at startup without a call`, out.code === 1 && err.includes(`${flag[0]} must be a positive`) && (await Deno.readTextFile(callLog)) === before, err);
    }
    // Two pick directories sharing one call log, one call left under the cap: exactly one may launch.
    const race = `${tmp}/race.log`;
    await Deno.writeTextFile(race, [1, 2].map(() => JSON.stringify({ status: "started" })).join("\n") + "\n");
    const slow = `${tmp}/claude-slow.sh`;
    await Deno.writeTextFile(slow, `#!/bin/sh\nsleep 1\ncat "$STUB_REPLY"\n`);
    await Deno.chmod(slow, 0o755);
    await Deno.writeTextFile(`${tmp}/reply.json`, reply([3, 0, 6]));
    const racer = async (n: number) => {
      const rdir = `${tmp}/race-${n}`;
      await Deno.mkdir(rdir, { recursive: true });
      const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", new URL("../../tools/picker-claude.ts", import.meta.url).pathname, "--call-log", race, "--max-calls", "3"],
        cwd: rdir, stdin: "piped", stdout: "piped", stderr: "piped", env: { CLAUDE_BIN: slow, STUB_REPLY: `${tmp}/reply.json` },
      }).spawn();
      const w = child.stdin.getWriter();
      await w.write(new TextEncoder().encode(request(1).replace(JSON.stringify(dir), JSON.stringify(rdir))));
      await w.close();
      return child.output();
    };
    const both = await Promise.all([racer(1), racer(2)]);
    const raceLog = lines(await Deno.readTextFile(race));
    check("7b. ...two callers racing for the last call: one launches, one is refused at the cap, and the log holds three started lines", both.filter((o) => o.code === 0).length === 1 && both.filter((o) => o.code === 1).length === 1 && raceLog.filter((l) => l.status === "started").length === 3 && (await Deno.stat(`${race}.lock`).catch(() => null)) === null, `${both.map((o) => o.code)} ${raceLog.length}`);
    check("7b. ...every attempt has a started line and an outcome with its cost", log.filter((l) => l.status === "started").length === 6 && log.filter((l) => l.status === "ok").length === 5 && log.filter((l) => l.status === "ok").every((l) => l.costUsd === 0.002));
  }

  // --- 8. failures
  {
    // The sim-level view: the hook on a pre-cycle state, a readback after the rejection.
    const pre0 = preAt(plain, 1);
    const emptyPre = (() => {
      const s = decodeArtifact(plain.bytes.get("checkpoints/b001-pre.blck")!).state;
      const n = cellCount(s.cfg), W = worldW(s.cfg);
      for (let ch = CH.B; ch <= CH.P; ch++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) s.cells[ch * n + (1 * 64 + y) * W + 1 * 64 + x] = 0; // pond 5 (row 1, column 1)
      return s;
    })();
    const sleepy = ["sh", "-c", "exec sleep 5"];
    const answerLater = async (dir: string) => {
      // A file picker's answer that appears after its deadline.
      setTimeout(async () => {
        try {
          for await (const e of Deno.readDir(dir)) if (/-request\.json$/.test(e.name)) await Deno.writeTextFile(`${dir}/${JSON.parse(await Deno.readTextFile(`${dir}/${e.name}`)).answer}`, '{"donors":[0]}');
        } catch { /* no directory */ }
      }, 600);
    };
    const modes: { name: string; pre?: WorldState; picker: (n: string) => Picker; inRun: boolean }[] = [
      { name: "an empty pond", pre: emptyPre, picker: () => ({ name: "x", pick: async () => [5] }), inRun: false },
      { name: "a repeated pond", picker: () => ({ name: "x", pick: async () => [2, 2] }), inRun: true },
      { name: "too many donors", picker: () => ({ name: "x", pick: async () => [0, 1, 2, 3, 4] }), inRun: true },
      { name: "no donors", picker: () => ({ name: "x", pick: async () => [] }), inRun: true },
      { name: "a throwing picker", picker: () => ({ name: "x", pick: async () => { throw new Error("boom"); } }), inRun: true },
      { name: "a non-zero exit", picker: (n) => dirPicker({ dir: `${tmp}/f-${n}`, io: denoIo, name: "cmd", answer: commandAnswerer({ argv: ["sh", "-c", "echo oops >&2; exit 3"], run: denoRun, timeoutMs: 20_000 }) }), inRun: true },
      { name: "a timeout", picker: (n) => dirPicker({ dir: `${tmp}/f-${n}`, io: denoIo, name: "cmd", answer: commandAnswerer({ argv: sleepy, run: denoRun, timeoutMs: 50 }) }), inRun: true },
      { name: "a late answer file", picker: (n) => { answerLater(`${tmp}/f-${n}`); return dirPicker({ dir: `${tmp}/f-${n}`, io: denoIo, name: "file", answer: fileAnswerer({ io: denoIo, timeoutMs: 200, pollMs: 25 }) }); }, inRun: true },
    ];
    for (const [i, m] of modes.entries()) {
      const pre = m.pre ?? pre0;
      const sim = await GpuSim.create(device, pre);
      const sink = new Mem();
      try {
        let error: Error | null = null;
        const note = { by: "", suggested: [] as number[] };
        try {
          await applyBoundary(sim, pre.step, ctx, makeDonorHook({ cfg: pre.cfg, recorded: new Map(), picker: m.picker(`${i}a`), sink, note }));
        } catch (e) { error = e as Error; }
        const held = await sim.readState();
        check(`8. ${m.name}: the hook throws PickError, the log ends with a failed line, and the simulation still holds the pre-selection state`,
          error instanceof PickError && lines(sink.files.get(PICKS_FILE)).at(-1)?.kind === "failed" && stateHash(held) === stateHash(pre), `${error} ${stateHash(held)} vs ${stateHash(pre)}`);
      } finally {
        sim.destroy();
      }
      if (m.inRun) {
        const { error, sink: s } = await rejection(picked(specB(2)), { picker: m.picker(`${i}b`) });
        const l = lines(s.files.get(PICKS_FILE));
        check(`8. ${m.name}: the run rejects with PickError at boundary 1, a failed line, no ponds.tsv row and no pick line`,
          error instanceof PickError && l.at(-1)?.kind === "failed" && l.every((x) => x.kind === "failed") && (s.files.get(PONDS_FILE) ?? "").trimEnd().split("\n").length <= 1, `${error}`);
      }
    }
    // A picker that scribbles over its snapshot changes nothing.
    const scribble: Picker = {
      name: "rule",
      pick: async (req: PickRequest) => {
        const suggested = [...req.suggested];
        req.pre.cells.fill(0);
        req.pre.cfg.seed = 99;
        req.max = 1;
        req.occupied.length = 0;
        return suggested;
      },
    };
    const scribbled = await run(picked(specB(3)), { picker: scribble });
    const calm = await run(picked(specB(3)), { picker: rulePicker() });
    check("8b. a picker that scribbles over its snapshot changes nothing", scribbled.finalHash === calm.finalHash && scribbled.files[PONDS_FILE] === calm.files[PONDS_FILE]);
    // A throwing `applied` is a post-commit failure; the next run replays that boundary.
    const flaky: Picker = { ...rulePicker(), applied: (req) => { if (req.cycle === 2) throw new Error("album full"); } };
    const { error: afterErr, sink: afterSink } = await rejection(picked(specB(4)), { picker: flaky });
    const al = lines(afterSink.files.get(PICKS_FILE));
    check("8b. a throwing applied stops with a failed line of phase after, and the committed boundary is logged", afterErr instanceof PickError && al.at(-1)?.kind === "failed" && al.at(-1)?.phase === "after" && al.filter((l) => l.kind === "pick").length === 2, `${afterErr}`);
    const healed = await run(picked(specB(4)), { picks: parsePickLog(afterSink.files.get(PICKS_FILE)!), picker: rulePicker() });
    const whole4 = await run(picked(specB(4)), { picker: rulePicker() });
    check("8b. ...the next run replays it (recorded, then the rule) and equals the uninterrupted run", pickLines(healed).slice(0, 2).every((l) => l.by === "recorded") && healed.finalHash === whole4.finalHash);
  }

  // --- 8d (part). what a picker's callbacks and throws cannot do to the record
  {
    const clean = await run(picked(specB(3)), { picker: rulePicker() });
    const scribbler: Picker = { ...rulePicker(), applied: (_req, donors) => { (donors as number[]).reverse(); (donors as number[])[0] = 15; (donors as number[]).length = 1; } };
    const scribbled = await run(picked(specB(3)), { picker: scribbler });
    const digest = JSON.parse(scribbled.files["manifest.json"]).picks.digest;
    check("8d. an `applied` that scribbles on its donors changes neither the manifest's digest, the log nor the world", digest === (await picksDigest(parsePickLog(scribbled.files[PICKS_FILE]))) && digest === JSON.parse(clean.files["manifest.json"]).picks.digest && scribbled.files[PONDS_FILE] === clean.files[PONDS_FILE] && scribbled.finalHash === clean.finalHash, digest);
    for (const thrown of [null, undefined, "plain text"]) {
      const { error, sink } = await rejection(picked(specB(2)), { picker: { ...rulePicker(), pick: async () => { throw thrown; } } });
      const l = lines(sink.files.get(PICKS_FILE));
      check(`8d. a picker that throws ${JSON.stringify(thrown) ?? "undefined"} still stops the run with PickError and a failed line saying so`, error instanceof PickError && l.length === 1 && l[0].kind === "failed" && l[0].error === String(thrown), `${error}`);
      const post = await rejection(picked(specB(2)), { picker: { ...rulePicker(), applied: () => { throw thrown; } } });
      const pl = lines(post.sink.files.get(PICKS_FILE));
      check(`8d. ...and so does a throwing \`applied\` (${JSON.stringify(thrown) ?? "undefined"}), after the boundary is logged`, post.error instanceof PickError && pl.at(-1)?.kind === "failed" && pl.at(-1)?.phase === "after" && pl.at(-1)?.error === String(thrown) && pl.filter((x) => x.kind === "pick").length === 1, `${post.error}`);
    }
  }

  // --- 8b (continued). recovery through tools/run.ts
  {
    const out = `${tmp}/runs`;
    const answerer = `${tmp}/answer.ts`;
    // Answers the first `max` occupied ponds of the request; fails once its call count passes the limit in ${tmp}/limit.
    await Deno.writeTextFile(answerer, `
      const req = JSON.parse(await new Response(Deno.stdin.readable).text());
      const n = Number(await Deno.readTextFile("${tmp}/count").catch(() => "0")) + 1;
      await Deno.writeTextFile("${tmp}/count", String(n));
      if (n > Number(await Deno.readTextFile("${tmp}/limit"))) { console.error("limit reached"); Deno.exit(3); }
      const pool = req.eligible.length ? req.eligible : req.occupied;
      console.log(JSON.stringify({ donors: pool.slice(0, req.donors.max) }));
    `);
    const runTool = async (extra: string[], exp = "rec", outDir = out) => {
      const o = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", new URL("../../tools/run.ts", import.meta.url).pathname, "--experiment", exp, "--preset", "ponds-small", "--conditions", "treatment", "--seeds", "1", "--steps", "12000", "--census", "1000", "--deep", "10", "--out", outDir, ...extra],
        stdout: "piped", stderr: "piped",
      }).output();
      return { code: o.code, text: new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr) };
    };
    const cmd = JSON.stringify([Deno.execPath(), "run", "-A", answerer]);
    const bundle = `${out}/rec/ponds-small/treatment-by-model/seed-1`;
    await Deno.writeTextFile(`${tmp}/limit`, "10");
    const first = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd]);
    const firstLog = await Deno.readTextFile(`${bundle}/${PICKS_FILE}`).catch(() => "");
    check("8b. through tools/run.ts: the first attempt records ten picks and stops at the eleventh boundary (exit 3)", first.code === 3 && parsePickLog(firstLog).length === 10 && lines(firstLog).at(-1)?.kind === "failed", `${first.code} ${first.text.slice(-300)}`);
    const bare = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd]);
    check("8b. ...re-running without --picks-from is refused rather than truncating the record (exit 2)", bare.code === 2 && /--picks-from/.test(bare.text), `${bare.code} ${bare.text.slice(-200)}`);
    // The second attempt fails while replaying: the album cannot be written (a directory stands in its place).
    await Deno.remove(`${bundle}/picker/album.png`).catch(() => {});
    await Deno.mkdir(`${bundle}/picker/album.png`);
    await Deno.writeTextFile(`${tmp}/limit`, "99");
    const second = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", `${bundle}/${PICKS_FILE}`]);
    const recovery = await Deno.readTextFile(`${bundle}/picks.recovery.jsonl`).catch(() => "");
    const truncated = parsePickLog(await Deno.readTextFile(`${bundle}/${PICKS_FILE}`).catch(() => ""));
    check("8b. ...a second attempt that fails mid-replay (exit 3) leaves picks.recovery.jsonl holding all ten while picks.jsonl is shorter", second.code === 3 && parsePickLog(recovery).length === 10 && truncated.length < 10, `${second.code} ${parsePickLog(recovery).length} ${truncated.length} ${second.text.slice(-300)}`);
    await Deno.remove(`${bundle}/picker/album.png`, { recursive: true });
    const third = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", `${bundle}/${PICKS_FILE}`]);
    const finalLog = await Deno.readTextFile(`${bundle}/${PICKS_FILE}`).catch(() => "");
    const done = JSON.parse(await Deno.readTextFile(`${bundle}/manifest.json`));
    const entries = parsePickLog(finalLog);
    check("8b. ...and a third attempt, given the shortened log, takes the longest record, replays ten, asks for two and completes", third.code === 0 && done.summary && entries.length === 12 && JSON.stringify(entries.slice(0, 10)) === JSON.stringify(parsePickLog(recovery)) && lines(finalLog).slice(0, 10).every((l) => l.by === "recorded"), `${third.code} ${entries.length} ${third.text.slice(-300)}`);
    const complete = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd]);
    check("8b. ...a complete picked directory is never reused (exit 2)", complete.code === 2 && /complete picked run/.test(complete.text), `${complete.code} ${complete.text.slice(-200)}`);

    // --- 8c. recovery that must not lose or mix histories
    const incomplete = async (exp: string, limit = 10) => {
      await Deno.writeTextFile(`${tmp}/count`, "0");
      await Deno.writeTextFile(`${tmp}/limit`, String(limit));
      const r = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd], exp);
      await Deno.writeTextFile(`${tmp}/limit`, "99");
      const dir = `${out}/${exp}/ponds-small/treatment-by-model/seed-1`;
      return { r, dir, log: await Deno.readTextFile(`${dir}/${PICKS_FILE}`) };
    };
    const files = async (dir: string) => ({ log: await Deno.readTextFile(`${dir}/${PICKS_FILE}`), recovery: await Deno.readTextFile(`${dir}/picks.recovery.jsonl`).catch(() => null), names: (await Array.fromAsync(Deno.readDir(dir), (e) => e.name)).sort() });
    const withDonor = (text: string, cycle: number, donors: number[]) => lines(text).map((l) => (l.kind === "pick" && l.cycle === cycle ? { ...l, donors } : l)).map((l) => JSON.stringify(l)).join("\n") + "\n";

    // A crash mid-append: ten complete picks, then half of an eleventh.
    const torn = await incomplete("rect");
    check("8c. fixture: an incomplete bundle with ten picks", torn.r.code === 3 && parsePickLog(torn.log).length === 10, `${torn.r.code} ${torn.r.text.slice(-200)}`);
    const tornText = torn.log.split("\n").filter((l) => l !== "" && JSON.parse(l).kind === "pick").join("\n") + '\n{"step":55000,"kind":"pick","cyc';
    await Deno.writeTextFile(`${torn.dir}/${PICKS_FILE}`, tornText);
    const tornBare = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd], "rect");
    const afterBare = await files(torn.dir);
    check("8c. a torn pick log without --picks-from is refused, not ignored and truncated: exit 2, every pick still on disk", tornBare.code === 2 && /--picks-from/.test(tornBare.text) && afterBare.log === tornText && afterBare.recovery === null, `${tornBare.code} ${tornBare.text.slice(-300)}`);
    const tornGood = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", `${torn.dir}/${PICKS_FILE}`], "rect");
    const tornDone = parsePickLog(await Deno.readTextFile(`${torn.dir}/${PICKS_FILE}`));
    check("8c. ...with --picks-from the ten complete picks replay, the original is kept as picks.jsonl.torn, and the run completes", tornGood.code === 0 && tornDone.length === 12 && JSON.stringify(tornDone.slice(0, 10)) === JSON.stringify(parsePickLog(torn.log)) && (await Deno.readTextFile(`${torn.dir}/${PICKS_FILE}.torn`)) === tornText && /torn record/.test(tornGood.text), `${tornGood.code} ${tornGood.text.slice(-300)}`);

    // Two histories under one run name: an equal-length external record that differs at cycle 1.
    const clash = await incomplete("recc");
    const donors1 = parsePickLog(clash.log)[0].donors;
    const other = `${tmp}/other.jsonl`;
    await Deno.writeTextFile(other, withDonor(clash.log, 1, [(donors1[0] + 1) % 4]));
    const before = await files(clash.dir);
    const clashed = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", other], "recc");
    const afterClash = await files(clash.dir);
    check("8c. an external record that disagrees with the bundle's log at a step is refused (exit 2) with the log, the recovery copy and the rest of the directory untouched", clashed.code === 2 && /disagree at t=1000/.test(clashed.text) && JSON.stringify(before) === JSON.stringify(afterClash), `${clashed.code} ${clashed.text.slice(-300)}`);
    const agreeing = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", `${clash.dir}/${PICKS_FILE}`], "recc");
    check("8c. ...the bundle's own log still recovers", agreeing.code === 0, `${agreeing.code} ${agreeing.text.slice(-200)}`);

    // Damage in the middle of the log: refused, file untouched, even with a good record given.
    const dmg = await incomplete("recd");
    const good = `${tmp}/good.jsonl`;
    await Deno.writeTextFile(good, dmg.log);
    const damaged = dmg.log.split("\n");
    damaged[2] = "{oops";
    await Deno.writeTextFile(`${dmg.dir}/${PICKS_FILE}`, damaged.join("\n"));
    const damagedRun = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", good], "recd");
    const afterDamage = await files(dmg.dir);
    check("8c. a log damaged before its last record is refused (exit 2) and left as it is", damagedRun.code === 2 && /damaged/.test(damagedRun.text) && afterDamage.log === damaged.join("\n") && afterDamage.recovery === null && afterDamage.names.every((n) => !/recovery|torn/.test(n)), `${damagedRun.code} ${damagedRun.text.slice(-300)}`);

    // A given record that holds only later boundaries: the bundle committed cycle 1, the record has cycles 2 to 12 (more entries than the bundle's log).
    const sparse = await incomplete("recs", 1);
    const later = `${tmp}/later.jsonl`;
    await Deno.writeTextFile(later, tornDone.slice(1).map((e) => JSON.stringify({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors })).join("\n") + "\n");
    await Deno.writeTextFile(`${tmp}/count`, "0");
    const sparseRun = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", later], "recs");
    const sparseLog = await Deno.readTextFile(`${sparse.dir}/${PICKS_FILE}`);
    const sparseKept = await Deno.readTextFile(`${sparse.dir}/picks.recovery.jsonl`).catch(() => "");
    check("8c. a given record of later cycles does not displace the bundle's committed ones: all twelve replay, the picker is never asked, the recovery copy holds twelve",
      parsePickLog(sparse.log).length === 1 && sparseRun.code === 0 && JSON.stringify(parsePickLog(sparseLog)) === JSON.stringify(tornDone) && lines(sparseLog).every((l) => l.by === "recorded") &&
        (await Deno.readTextFile(`${tmp}/count`)) === "0" && JSON.stringify(parsePickLog(sparseKept)) === JSON.stringify(tornDone) && lines(sparseKept)[0].by === "command:model",
      `${sparseRun.code} ${parsePickLog(sparseLog).length} ${parsePickLog(sparseKept).length} count ${await Deno.readTextFile(`${tmp}/count`)} ${sparseRun.text.slice(-300)}`);

    // The same recovery with no picker at all: the given record alone is short of the run, the merged one is whole.
    const bare11 = await incomplete("recn", 1);
    const noPicker = await runTool(["--pick-label", "model", "--picks-from", later], "recn");
    const noPickerLog = await Deno.readTextFile(`${bare11.dir}/${PICKS_FILE}`);
    check("8c. ...and with no picker the merged record is judged, not the given one alone: the replay completes with all twelve", noPicker.code === 0 && JSON.stringify(parsePickLog(noPickerLog)) === JSON.stringify(tornDone) && lines(noPickerLog).every((l) => l.by === "recorded"), `${noPicker.code} ${noPicker.text.slice(-300)}`);

    // A pick directory is one run's: a second run pointed at it is refused before any GPU work, and nothing in it changes.
    const ownedDir = `${sparse.dir}/picker`;
    const ownedBefore = (await Array.fromAsync(Deno.readDir(ownedDir), (e) => e.name)).sort();
    const intruder = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--pick-dir", ownedDir], "reco");
    check("8c. a second run pointed at another run's pick directory is refused (exit 2) and writes neither there nor a bundle",
      intruder.code === 2 && /pick directory of another run/.test(intruder.text) && JSON.stringify((await Array.fromAsync(Deno.readDir(ownedDir), (e) => e.name)).sort()) === JSON.stringify(ownedBefore) &&
        ownedBefore.includes("owner.json") && (await Deno.stat(`${out}/reco`).catch(() => null)) === null,
      `${intruder.code} ${intruder.text.slice(-300)}`);

    // The same refusal for a run that has an incomplete bundle: nothing of the bundle may change before the refusal.
    const own = await incomplete("recb", 1);
    const tree = async (dir: string) => JSON.stringify([await files(dir), (await Array.fromAsync(Deno.readDir(`${dir}/checkpoints`), (e) => e.name).catch(() => [])).sort()]);
    const ownBefore = await tree(own.dir);
    const trespass = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", `${own.dir}/${PICKS_FILE}`, "--pick-dir", ownedDir], "recb");
    check("8c. ...and when that run has an incomplete bundle, the refusal comes before recovery copies or clears anything in it", trespass.code === 2 && /pick directory of another run/.test(trespass.text) && (await tree(own.dir)) === ownBefore, `${trespass.code} ${trespass.text.slice(-300)}`);
    // The owner is the bundle directory as the file system knows it: a recovery through another spelling of it (a symbolic link) is the same run.
    await Deno.symlink(out, `${tmp}/runs-alias`);
    const aliased = await runTool(["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", `${own.dir}/${PICKS_FILE}`], "recb", `${tmp}/runs-alias`);
    check("8c. a recovery through a symbolic link to the output directory is let into its own pick directory and completes", aliased.code === 0 && parsePickLog(await Deno.readTextFile(`${own.dir}/${PICKS_FILE}`)).length === 12, `${aliased.code} ${aliased.text.slice(-300)}`);
    await Deno.mkdir(`${tmp}/data/sub`, { recursive: true });
    await Deno.symlink(`${tmp}/data/sub`, `${tmp}/link`);
    const real = await Deno.realPath(tmp);
    check("8c. ...canonicalPath follows links before `..` and keeps a tail that does not exist yet", (await canonicalPath(`${tmp}/link/../fresh/x`)) === `${real}/data/fresh/x` && (await canonicalPath(`${tmp}/runs-alias/nothing/../here`)) === `${real}/runs/here`, `${await canonicalPath(`${tmp}/link/../fresh/x`)} ${await canonicalPath(`${tmp}/runs-alias/nothing/../here`)}`);

    // A lab manifest as the record, and a replay that fails twice: the recovery copy must be pick lines, not the manifest's text.
    const labSpec: RunSpec = { experiment: "recl", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 12000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0 };
    const labFile = `${tmp}/lab.run.json`;
    await Deno.writeTextFile(labFile, JSON.stringify({ presetId: "ponds-small", seed: 1, ruleVersion: RULE_VERSION, cfg: specConfig(labSpec), init: PRESETS.find((x) => x.id === "ponds-small")!.init, interventions: tornDone.slice(0, 4).map((e) => ({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors })) }, null, 2));
    const labDir = `${out}/recl/ponds-small/treatment-by-model/seed-1`;
    await Deno.mkdir(`${labDir}/picker/album.png`, { recursive: true }); // the album cannot be written: `applied` fails after the first boundary
    await Deno.writeTextFile(`${tmp}/limit`, "99");
    const labArgs = ["--picker", "command", "--pick-label", "model", "--pick-cmd", cmd, "--picks-from", labFile];
    const lab1 = await runTool(labArgs, "recl");
    const lab2 = await runTool(labArgs, "recl");
    const labKept = await Deno.readTextFile(`${labDir}/picks.recovery.jsonl`).catch(() => "");
    let labEntries = -1;
    try {
      labEntries = parsePickLog(labKept).length;
    } catch { /* not a pick log */ }
    check("8c. a lab manifest replay that fails twice leaves a recovery copy that is a pick log of its four picks", lab1.code === 3 && lab2.code === 3 && labEntries === 4 && !labKept.includes("interventions"), `${lab1.code} ${lab2.code} ${labEntries} ${lab2.text.slice(-300)}`);
    await Deno.remove(`${labDir}/picker/album.png`, { recursive: true });
    const lab3 = await runTool(labArgs, "recl");
    const labDone = parsePickLog(await Deno.readTextFile(`${labDir}/${PICKS_FILE}`).catch(() => ""));
    check("8c. ...and the third attempt reads it and completes with the manifest's four picks first", lab3.code === 0 && labDone.length === 12 && JSON.stringify(labDone.slice(0, 4)) === JSON.stringify(tornDone.slice(0, 4)), `${lab3.code} ${labDone.length} ${lab3.text.slice(-300)}`);
  }

  // --- 8d. real child processes
  {
    const left = async (marker: string) => new TextDecoder().decode((await new Deno.Command("pgrep", { args: ["-f", marker], stdout: "piped" }).output()).stdout).trim();
    const timed = async <T>(f: () => Promise<T>) => {
      const t0 = Date.now();
      const v = await f();
      return { v, ms: Date.now() - t0 };
    };
    const common = { cwd: tmp, stdin: "{}", timeoutMs: 100, maxBytes: 1 << 20 };
    // A grandchild holds stdout and stderr open and outlives its parent's SIGTERM.
    const tree = await timed(() => denoRun(["sh", "-c", "sleep 31.25 & sleep 31.25; wait"], common));
    check("8d. a deadline ends a child and its descendants: returned in under 4 s, timed out, no sleep left", tree.v.timedOut && tree.ms < 4000 && (await left("sleep 31.25")) === "", `${tree.ms} ms ${JSON.stringify(tree.v)} left: ${await left("sleep 31.25")}`);
    const stubborn = await timed(() => denoRun(["sh", "-c", "trap '' TERM; while :; do sleep 1; done"], common));
    check("8d. ...a child that ignores SIGTERM is killed and reaped: returned in under 5 s", stubborn.v.timedOut && stubborn.ms < 5000, `${stubborn.ms} ms`);
    const flood = await timed(() => denoRun(["sh", "-c", "yes; sleep 30"], { ...common, timeoutMs: 20_000, maxBytes: 5000 }));
    check("8d. output past the cap stops the child at once (overflow, 5,000 bytes kept, not a timeout)", flood.v.overflow === true && !flood.v.timedOut && flood.v.stdout.length === 5000 && flood.ms < 5000, `${flood.ms} ms ${flood.v.stdout.length}`);
    const floodErr = await timed(() => denoRun(["sh", "-c", "yes >&2"], { ...common, timeoutMs: 20_000, maxBytes: 5000 }));
    check("8d. ...on stderr too", floodErr.v.overflow === true && floodErr.v.stderr.length === 5000 && floodErr.ms < 5000, `${floodErr.ms} ms`);
    const fine = await runBounded(["sh", "-c", "cat; echo bad >&2; exit 3"], { stdin: "hello", timeoutMs: 20_000 });
    check("8d. a command within its limits still returns its output and exit code", fine.code === 3 && fine.stdout === "hello" && fine.stderr === "bad\n" && !fine.timedOut && !fine.overflow, JSON.stringify(fine));
    // The child exits at once; a descendant writes the answer after the deadline.
    const lateArgv = ["sh", "-c", '(sleep 0.4; printf "[0]") & exit 0'];
    const late = await timed(() => denoRun(lateArgv, { ...common, timeoutMs: 100 }));
    check("8d. output that ends after the deadline is a timeout even when the child itself exited in time", late.v.timedOut && late.v.stdout === "" && late.ms < 2000, `${late.ms} ms ${JSON.stringify(late.v)}`);
    // This process's event loop is held up past the deadline, so the output's end and the overdue timer are delivered together.
    const held = denoRun(["sh", "-c", '(sleep 0.1; printf "[0]") & exit 0'], { ...common, timeoutMs: 50 });
    await new Promise((r) => setTimeout(r, 15));
    for (const until = performance.now() + 180; performance.now() < until; );
    check("8d. ...and by the clock, not by which callback ran first: late output seen behind a held-up event loop is still a timeout", (await held).timedOut, JSON.stringify(await held));
    const inTime = await denoRun(lateArgv, { ...common, timeoutMs: 5000 });
    check("8d. ...and within the deadline the same output is taken", !inTime.timedOut && inTime.code === 0 && inTime.stdout === "[0]", JSON.stringify(inTime));
    const { error: lateErr, sink: lateSink } = await rejection(picked(specB(2)), { picker: dirPicker({ dir: `${tmp}/late`, io: denoIo, name: "cmd", answer: commandAnswerer({ argv: lateArgv, run: denoRun, timeoutMs: 100 }) }) });
    check("8d. ...a command picker whose answer arrives late fails the pick: PickError, a failed line, nothing applied", lateErr instanceof PickError && /did not answer within/.test(lateErr.message) && lines(lateSink.files.get(PICKS_FILE)).at(-1)?.kind === "failed" && lines(lateSink.files.get(PICKS_FILE)).every((l) => l.kind !== "pick"), `${lateErr}`);
    const noisy = commandAnswerer({ argv: ["sh", "-c", "yes"], run: denoRun, timeoutMs: 20_000, maxBytes: 2000 });
    const { error: noisyErr, sink: noisySink } = await rejection(picked(specB(2)), { picker: dirPicker({ dir: `${tmp}/noisy`, io: denoIo, name: "cmd", answer: noisy }) });
    check("8d. a flooding command picker fails the pick: PickError, a failed line naming the cap", noisyErr instanceof PickError && /wrote more than 2000 bytes/.test(noisyErr.message) && lines(noisySink.files.get(PICKS_FILE)).at(-1)?.kind === "failed", `${noisyErr}`);
  }

  // --- 9. replay logs that cannot drive the run are refused before it starts
  {
    const short = randLog.slice(0, 2);
    const off = [...randLog.slice(0, 1), { step: 1234, cycle: 1, donors: [0] }];
    for (const [name, picks, want] of [["a missing boundary", short, /covers 2 of the run's 5/], ["an entry off a boundary", off, /not on a pond boundary/]] as const) {
      const { error, sink } = await rejection(picked(specB(CYCLES)), { picks });
      check(`9. ${name} and no picker: refused before the run starts, nothing written`, error !== null && want.test(error.message) && sink.files.size === 0 && sink.bytes.size === 0, `${error}`);
    }
    const shortFile = `${tmp}/short.jsonl`;
    await Deno.writeTextFile(shortFile, short.map((e) => JSON.stringify({ ...e, kind: "pick" })).join("\n") + "\n");
    const o = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", new URL("../../tools/run.ts", import.meta.url).pathname, "--experiment", "short", "--preset", "breeder", "--conditions", "treatment", "--seeds", "1", "--steps", String(CYCLES * 5000), "--out", `${tmp}/never`, "--picks-from", shortFile],
      stdout: "piped", stderr: "piped",
    }).output();
    check("9. ...tools/run.ts exits 2 before any GPU work and writes no bundle", o.code === 2 && (await Deno.stat(`${tmp}/never`).catch(() => null)) === null, new TextDecoder().decode(o.stderr).slice(-200));
  }

  // --- 10. resume, a missing picker, stitching
  {
    const start = preAt(plain, 1);
    const a = await rejection(picked(specB(2)), { picker: rulePicker(), start });
    check("10. a picked run refuses a start state", a.error !== null && /cannot continue from a checkpoint/.test(a.error.message) && a.sink.files.size === 0, `${a.error}`);
    const b = await rejection(picked(specB(2)), {});
    check("10. ...and spec.picked with neither picker nor picks", b.error !== null && /needs its picks/.test(b.error.message) && b.sink.files.size === 0, `${b.error}`);
    const c = await rejection(specB(2), { picker: rulePicker() });
    check("10. ...a picker without spec.picked", c.error !== null && /need spec.picked/.test(c.error.message));
    // Two segments of ponds-small, their manifests marked picked: the stitcher refuses them.
    const seg = (steps: number): RunSpec => ({ experiment: "seg", presetId: "ponds-small", condition: "treatment", seed: 1, steps, censusEvery: 500, deepEvery: 10, checkpointEvery: 0 });
    const s0 = await run(seg(1000));
    const mark = (r: Run) => ({ ...r.files, "manifest.json": JSON.stringify({ ...JSON.parse(r.files["manifest.json"]), spec: { ...JSON.parse(r.files["manifest.json"]).spec, picked: true } }) });
    const second = await run(seg(1000), { start: s0.final, observer: s0.observer });
    const segs: StitchSegment[] = [
      { index: 0, startStep: 0, steps: 1000, digest: s0.finalHash, files: mark(s0) },
      { index: 1, startStep: 1000, steps: 1000, digest: second.finalHash, files: mark(second) },
    ];
    let msg = "";
    try { stitchRun(segs, 2000); } catch (e) { msg = (e as Error).message; }
    check("10. ...and a picked segment cannot be stitched", /picked runs cannot be stitched/.test(msg), msg);
  }

  // --- 11. a lab-style manifest
  {
    const manifest = { presetId: "breeder", seed: 1, ruleVersion: RULE_VERSION, cfg: cfg, init: breeder.init, edgesFrom: 0, interventions: randLog.map((e) => ({ step: e.step, kind: "pick", cycle: e.cycle, donors: e.donors })) };
    const entries = picksFromManifest(manifest);
    const lab = await run(picked(specB(CYCLES)), { picks: entries, implicitRule: true });
    check("11. a lab-style manifest built from the random log replays to the same final hash and ponds.tsv", lab.finalHash === rand.finalHash && lab.files[PONDS_FILE] === rand.files[PONDS_FILE], `${lab.finalHash} vs ${rand.finalHash}`);
    const sparse = await run(picked(specB(CYCLES)), { picks: entries.slice(0, -1), implicitRule: true });
    const sl = pickLines(sparse);
    check("11. ...a sparse one (the last boundary not picked) takes the rule's donors there, as the lab replay does", sl.at(-1)!.by === "rule(implicit)" && JSON.stringify(sl.at(-1)!.donors) === JSON.stringify(sl.at(-1)!.suggested) && sl.slice(0, -1).every((l) => l.by === "recorded"), JSON.stringify(sl.map((l) => l.by)));
    let refused = "";
    try { picksFromManifest({ ...manifest, interventions: [...manifest.interventions, { step: 9, kind: "lesion" }] }); } catch (e) { refused = (e as Error).message; }
    check("11. ...and a manifest with a lesion is refused", /lesion/.test(refused), refused);
  }
} finally {
  device.destroy();
  await Deno.remove(tmp, { recursive: true }).catch(() => {});
}
console.log(ok ? "\nALL PASS" : "\nFAILURES");
if (!ok) Deno.exit(1);
