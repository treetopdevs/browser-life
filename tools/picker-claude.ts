// A command picker that asks a model (wild sandbox): the donors of each pond boundary chosen by `claude -p` from the contact
// sheet. For tools/run.ts's `--picker command` (see its header); the pick directory is the child's cwd, so the script path
// must be absolute:
//
//   deno run -A tools/run.ts --experiment pick1 --preset breeder --conditions treatment --seeds 1 --steps 15000 \
//     --census 1000 --checkpoint 0 --picker command --pick-label model \
//     --pick-cmd '["deno","run","-A","/abs/path/tools/picker-claude.ts","--model","sonnet"]'
//
// Contract: the request JSON (tools/lib/pickers.ts `PickRequestJson`) on stdin; {"donors":[...]} on stdout, in the model's
// order, exactly `donors.max` ponds of the eligible ones (every occupied one when none is eligible). An invalid or failed answer
// exits 1 with the reason on stderr: the runner stops at that boundary and a re-run replays the recorded cycles.
// Flags: --model (default sonnet), --max-calls N (default 40), --call-log FILE, --timeout SEC (default 150), --max-budget USD
// (default 0.5 per call). CLAUDE_BIN overrides the `claude` binary (tests/deno/picked.ts uses a stub).
//
// One call is `claude -p <prompt> --model sonnet --restricted --permission-mode default --tools Read --strict-mcp-config
// --setting-sources "" --system-prompt <three sentences> --no-session-persistence --output-format json --json-schema <schema>
// --max-budget-usd 0.5`, cwd = the pick directory, stdin closed: no MCP server, one tool, no user settings or hooks (--bare is not
// used: it never reads the OAuth login, so it needs ANTHROPIC_API_KEY). A prompt naming a path outside the pick directory
// is refused under these flags (permission denied). The default model is Sonnet because Haiku described an abstract frame as satellite imagery.
//
// Memory, in the pick directory: notebook.md (one block per committed cycle: what the sheet looked like and a line per pick; the
// whole notebook goes into every prompt) and album.png (written by the runner's dir picker). A block is kept in pending.json
// until the next call, and enters the notebook only if the run applied exactly its donors at its cycle: the dir picker's
// b<NNN>-applied.json (the request's `applied`) says what was applied, replayed cycles included. A call for the same or an
// earlier cycle (a recovery that asks again) drops the stale block, and so does a boundary the run settled with other donors
// (a crash before the commit, then a recovery that replays another record). Replayed cycles make no call, so a block
// waits for the next one.
//
// Call log (an absolute path, shared by every pick directory): a `started` line is appended before `claude` launches and an
// outcome line (ok, invalid, error, timeout, with cost and milliseconds) after, so a charged call that returns junk still counts;
// the script refuses to launch when the log already holds --max-calls `started` lines. The check and the `started` line are one step
// under a lock directory beside the log (<call-log>.lock), so pick directories sharing a log cannot launch past the cap together.
//
// `claude` runs under tools/lib/run-command.ts: at --timeout it and its descendants are ended (SIGTERM, then SIGKILL), and more than
// 1 MiB on either stream stops it and counts as an error.
//
// Measured (2026-10-04, sonnet, the breeder preset's 4 x 4 sheet at 1,310 px): a call took 4.9 to 6.3 s of claude's time (about 8 s of
// wall time with the script's start-up) and cost $0.018 at the first cycle, $0.030 at the seventh as the notebook grew; about 4,000
// input tokens at the start, against 12 s and $0.60 with the session's MCP tools loaded.
import { callBudgetError, buildPrompt, claudeArgs, notebookBlock, parseClaudeResult, settleNotebook, validateModelAnswer, type Committed, type Pending } from "./lib/picker-prompt.ts";
import type { PickRequestJson } from "./lib/pickers.ts";
import { runBounded } from "./lib/run-command.ts";
import { parseArgs } from "jsr:@std/cli@1/parse-args";

const a = parseArgs(Deno.args, { string: ["model", "max-calls", "call-log", "timeout", "max-budget"], default: { model: "sonnet", "max-calls": "40", timeout: "150", "max-budget": "0.5" } });
const logPath = a["call-log"] ?? new URL("../runs/wild/review/model-calls.log", import.meta.url).pathname;
const fail = (msg: string): never => {
  console.error(`picker-claude: ${msg}`);
  Deno.exit(1);
};

const req = JSON.parse(await new Response(Deno.stdin.readable).text()) as PickRequestJson;
const dir = req.dir;
const read = (f: string) => Deno.readTextFile(f).catch((e) => (e instanceof Deno.errors.NotFound ? "" : Promise.reject(e)));

const logText = await read(logPath);
const budget = callBudgetError(logText, Number(a["max-calls"]));
if (budget) fail(`refusing to call the model: ${budget}`);

// Settle the notebook before asking, so the prompt holds every committed cycle.
let pending: Pending | undefined;
try {
  pending = JSON.parse(await read(`${dir}/pending.json`) || "null") ?? undefined;
} catch {
  pending = undefined;
}
// What the run applied at the pending block's boundary, if it committed one there.
let committed: Committed | undefined;
if (pending && typeof pending.applied === "string" && !pending.applied.includes("/"))
  try {
    const applied = JSON.parse(await read(`${dir}/${pending.applied}`) || "null") as Committed | null;
    if (applied && Array.isArray(applied.donors)) committed = applied;
  } catch {
    committed = undefined;
  }
const notebook = settleNotebook(await read(`${dir}/notebook.md`), pending, req.cycle, committed);
await Deno.writeTextFile(`${dir}/notebook.md`, notebook);
await Deno.remove(`${dir}/pending.json`).catch(() => {});

/** Runs `fn` holding the lock directory `lock` (mkdir is atomic); one older than 30 s is a dead holder's and is taken over. */
async function withLock<T>(lock: string, fn: () => Promise<T>): Promise<T> {
  await Deno.mkdir(lock.replace(/\/[^/]+$/, ""), { recursive: true });
  for (let tries = 0; ; tries++) {
    try {
      await Deno.mkdir(lock);
      break;
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists) || tries > 600) throw e;
      const held = await Deno.stat(lock).catch(() => null);
      if (held?.mtime && Date.now() - held.mtime.getTime() > 30_000) await Deno.remove(lock).catch(() => {});
      else await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await Deno.remove(lock).catch(() => {});
  }
}

const note = (o: Record<string, unknown>) => Deno.writeTextFile(logPath, JSON.stringify({ when: new Date().toISOString(), cycle: req.cycle, model: a.model, by: "picker-claude", ...o }) + "\n", { append: true });
await Deno.mkdir(logPath.replace(/\/[^/]+$/, ""), { recursive: true });

// The cap is checked again with the `started` line under one lock: another pick directory may have launched since the check above.
const reserve = await withLock(`${logPath}.lock`, async () => {
  const bad = callBudgetError(await read(logPath), Number(a["max-calls"]));
  if (!bad) await note({ status: "started" });
  return bad;
});
if (reserve) fail(`refusing to call the model: ${reserve}`);

const started = Date.now();
let res: Awaited<ReturnType<typeof runBounded>>;
try {
  res = await runBounded([Deno.env.get("CLAUDE_BIN") ?? "claude", ...claudeArgs(a.model, buildPrompt(req, notebook), Number(a["max-budget"]))], { cwd: dir, timeoutMs: Number(a.timeout) * 1000 });
} catch (e) {
  await note({ status: "error", ms: Date.now() - started });
  fail(`could not run claude: ${e instanceof Error ? e.message : String(e)}`);
}
if (res!.timedOut) {
  await note({ status: "timeout", ms: Date.now() - started });
  fail(`claude did not answer within ${a.timeout} s`);
}
const stdout = res!.stdout;
if (res!.overflow || res!.code !== 0) {
  await note({ status: "error", ms: Date.now() - started });
  fail(res!.overflow ? "claude wrote more than 1 MiB and was stopped" : `claude exited with code ${res!.code}: ${res!.stderr.trim().slice(0, 500) || stdout.slice(0, 200)}`);
}
let result;
try {
  result = parseClaudeResult(stdout);
} catch (e) {
  await note({ status: "invalid", ms: Date.now() - started });
  fail((e as Error).message);
}
const bad = validateModelAnswer(result!, req);
if (bad) {
  await note({ status: "invalid", costUsd: result!.costUsd, ms: result!.ms || Date.now() - started, error: bad });
  fail(`invalid answer: ${bad}`);
}
const keep: Pending = { nonce: req.nonce, cycle: req.cycle, donors: result!.picks.map((p) => p.pond), applied: req.applied, block: notebookBlock(req.cycle, req.step, result!) };
await Deno.writeTextFile(`${dir}/pending.json`, JSON.stringify(keep));
await note({ status: "ok", costUsd: result!.costUsd, ms: result!.ms || Date.now() - started });
console.log(JSON.stringify({ donors: result!.picks.map((p) => p.pond) }));
