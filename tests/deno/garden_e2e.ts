// The shared garden end to end on one machine (docs/garden-local-2026-10-17.md has the sizing and every pass criterion,
// written before this file). A real `mix phx.server` (MIX_ENV dev, a scratch BL_DATA_DIR, its own port) hosts a small
// garden on `spots`; two in-process islands on one GPU device tend it through packages/runner/src/island.ts's real wire
// protocol, sequenced by this script: A runs every day, B replays every day. The coordinator has a garden island token
// (amended 2026-10-18): A and B join showing it, and a third island C, without it, is told idle. Visitors' letters go through the public
// route, the keeper drops one through the admin route, and the public view (`garden-v1`) is checked after each step:
// days done, replayed and verified, the fork, letters waiting, landed, verified and dropped, tending and pacing. The
// coordinator is then restarted in a fresh OS process against the same data directory, the verified prefix is
// exported with tools/stitch.ts (garden mode) and compared with one unsegmented tools/run.ts run of the same schedule:
// the stitched schedule must be the founding plus the verified letters, and the two bundles must agree byte for byte.
// Food (amended 2026-10-18, docs/garden-food-2026-10-18.md section 8): the garden is founded with food (K 2, N 1), two
// networks (X-Forwarded-For, which this coordinator trusts) call a food onto day 1 right after L2, and the food is a feed
// in day 1's log (r 32, matter exactly 51,344), verified, kept across the restart and in the stitched schedule. Its day
// waits one dawn period (a second here) after the call before an island gets it (the keeper's veto window). The ask's
// count after the restart is 0 trivially here (the call itself zeroed it); ExUnit holds the restart rule with a hand
// left counted.
// Who held the field (amended 2026-10-18, docs/garden-predictions-2026-10-18.md section 9): once day 0 is verified its
// leaders block is ok and its census equals the script's own reading of day 0's lineages.tsv at step D; once days 1 and 2
// are, day 1's lines equal the script's own walk over days 0 and 1's mutations.tsv; all three survive the restart.
//
// The dawn grid is the test clock: `dawnPeriodMs` 1,000, so a day waits at most a second for its dawn. Nothing in the
// coordinator is moved from outside. GPU time is small: 3 days of 256 steps on a 256x256 world, each replayed once, then
// 768 steps unsegmented.
//
// Run from the repo root (a timed-out run is rerun once alone before it counts as a failure):
//   deno run -A tests/deno/garden_e2e.ts < /dev/null
// The coordinator's port is one the OS reports free (BL_E2E_PORT names one instead). The test refuses to start when
// something already answers there, fails as soon as its own server exits, and checks (with lsof) that the listener is
// its own process before founding anything. Its scratch directories are removed when every check passed, and kept (the
// paths are printed) when one failed; SIGINT, SIGTERM and SIGHUP stop the coordinator and any tool it runs first.
import { requestDevice } from "@bl/sim-gpu";
import { noLockDenoBin } from "./lib/no_lock_deno.ts";
import { PRESETS, artifactDigest, cellCount, defaultConfig, lowbias32, worldW } from "@bl/schema";
import { INTERVENTIONS_FILE, OBSERVATION_FILES, VERIFIED_FILES, decodeArtifact, parseInterventionLog, runIsland, type ScheduledIntervention } from "@bl/runner";

const T0 = performance.now();
const uptime = async () => {
  try {
    return new TextDecoder().decode((await new Deno.Command("uptime", { stdin: "null" }).output()).stdout).trim();
  } catch {
    return "unavailable";
  }
};
console.log(`uptime: ${await uptime()}`);

const root = Deno.cwd();
const coordinatorDir = `${root}/apps/coordinator`;
const freePort = () => {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const p = (l.addr as Deno.NetAddr).port;
  l.close();
  return p;
};
const port = Deno.env.get("BL_E2E_PORT") ? Number(Deno.env.get("BL_E2E_PORT")) : freePort();
const base = `http://127.0.0.1:${port}`;
// Created inside the protected run below, so a failure to reach the GPU leaves nothing behind.
let dataDir = "";
let workDir = "";
let serverLog = "";
// A deno the coordinator finds on PATH (its discovery validator) runs with --no-lock (tests/deno/lib/no_lock_deno.ts).
let denoBin = "";

const NAME = "e2e";
const D = 256; // stepsPerDay
const DAYS = 4;
const PERIOD = 1000; // dawnPeriodMs
const CENSUS = 64;
const FOUNDING: ScheduledIntervention[] = [{ step: 0, kind: "feed", x: 128, y: 128, r: 64, amount: 16 }];
// The food (docs/garden-food-2026-10-18.md): the world's centre, the coordinator's default radius and amount. The r 32
// disc on spots is 3,209 cells, so it adds 51,344 quanta.
const FOOD = { kind: "feed", x: 128, y: 128, r: 32, amount: 16 };
const FOOD_MATTER = 51_344;
// The coordinator's garden island token (amended 2026-10-18, docs/garden-hardening-2026-10-18.md): set after the BL_*
// scrub below, so this coordinator offers the garden's days only to islands that join showing it. A and B do; a third
// island C does not, and is told idle while day 0 waits unassigned.
const TOKEN = `e2e-garden-${crypto.randomUUID()}`;

let ok = true;
let checks = 0;
const check = (name: string, cond: boolean, detail = "") => {
  checks++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail.slice(0, 1500)}` : ""}`);
  ok &&= cond;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The coordinator serialises each entry's keys in its own (sorted) order.
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const readOr = (p: string) => Deno.readTextFile(p).catch(() => undefined);
// Every BL_* setting of the caller's shell is dropped: BL_ADMIN_TOKEN would make the tokenless founding a 401,
// BL_GARDEN_ISLAND_TOKEN would be a token these islands do not know (the test sets its own, TOKEN, after the scrub),
// BL_TRUST_FORWARDED_FOR would change how the letter limit keys addresses, and BL_DISCOVERY_DATA_DIR (or its default,
// apps/coordinator/data-discovery) would put discovery's state outside the scratch directories. (Discovery refuses a
// directory inside the queue's, so it goes in the other scratch directory.)
const withoutBl = (env: Record<string, string>) => Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("BL_")));

const text = (b: Uint8Array) => new TextDecoder().decode(b);
async function run(cmd: string, args: string[]) {
  try {
    const out = await new Deno.Command(cmd, { args, stdin: "null", stdout: "piped", stderr: "null" }).output();
    return out.success ? text(out.stdout) : "";
  } catch {
    return undefined; // the command itself is missing
  }
}
/** `pid` and every process below it (pgrep -P, depth first). */
async function treePids(pid: number): Promise<number[]> {
  const kids = ((await run("pgrep", ["-P", String(pid)])) ?? "").split(/\s+/).filter(Boolean).map(Number);
  const below = await Promise.all(kids.map(treePids));
  return [pid, ...below.flat()];
}

// ---- the coordinator process (coordinator_integration.ts's pattern; its log goes to a file, printed on failure) ----

interface Server {
  child: Deno.ChildProcess;
  drained: Promise<unknown>;
  exited: { code: number | null };
}

async function answers(): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2000) });
    await r.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/** Starts `mix phx.server` on the scratch data directory, after checking nothing already answers on the port. */
async function spawnServer(): Promise<Server> {
  if (signalled) throw new Error("stopping on a signal");
  if (!denoBin) throw new Error("no deno shim yet");
  if (await answers()) throw new Error(`something already answers on ${base}; refusing to found a garden in a coordinator this test did not start`);
  // A signal during the probe found no server to stop, so none may start after it.
  if (signalled) throw new Error("stopping on a signal");
  const child = new Deno.Command("mix", {
    args: ["phx.server"],
    cwd: coordinatorDir,
    // BL_TRUST_FORWARDED_FOR (amended 2026-10-18, food): the food hands below come from distinct X-Forwarded-For
    // networks. Requests without the header (the stones, the islands) are still keyed by the peer, 127.0.0.1.
    env: { ...withoutBl(Deno.env.toObject()), PATH: `${denoBin}:${Deno.env.get("PATH") ?? ""}`, MIX_ENV: "dev", PORT: String(port), BL_DATA_DIR: dataDir, BL_DISCOVERY_DATA_DIR: `${workDir}/discovery`, BL_GARDEN_ISLAND_TOKEN: TOKEN, BL_TRUST_FORWARDED_FOR: "1" },
    clearEnv: true,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const sink = async (stream: ReadableStream<Uint8Array>) => {
    const file = await Deno.open(serverLog, { create: true, append: true });
    await stream.pipeTo(file.writable).catch(() => {});
  };
  const drained = Promise.all([sink(child.stdout), sink(child.stderr)]);
  const exited = { code: null as number | null };
  child.status.then((s) => (exited.code = s.code));
  // Registered here, synchronously with the spawn, so a signal from now on stops this one.
  server = { child, drained, exited };
  return server;
}

/** SIGTERM to the server's whole process tree; SIGKILL to whatever is left after `graceMs`. */
async function stopServer(s: Server | undefined, graceMs = 20_000) {
  if (!s) return;
  const pids = s.exited.code === null ? await treePids(s.child.pid) : [];
  for (const pid of pids) {
    try {
      Deno.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  const stopped = await Promise.race([s.child.status.then(() => true), sleep(graceMs).then(() => false)]);
  for (const pid of stopped ? [] : pids) {
    try {
      Deno.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  await s.child.status;
  await Promise.race([s.drained, sleep(5_000)]);
}

/** The process listening on the port must be `pid` or one of its descendants (checked with lsof; skipped without it). */
async function ownsPort(pid: number): Promise<{ ok: boolean; detail: string }> {
  const out = await run("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (out === undefined) return { ok: false, detail: "lsof is missing, and this test needs it to check who listens on the port" };
  const listeners = out.split(/\s+/).filter(Boolean).map(Number);
  const ours = new Set(await treePids(pid));
  return { ok: listeners.length > 0 && listeners.every((l) => ours.has(l)), detail: `listeners [${listeners.join(", ")}], ours [${[...ours].join(", ")}]` };
}

async function waitReady(s: Server, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (s.exited.code !== null) throw new Error(`the coordinator exited (${s.exited.code}) before it answered on ${base}`);
    if (await answers()) {
      const own = await ownsPort(s.child.pid);
      if (!own.ok) throw new Error(`the coordinator answering on ${base} is not the one this test started (${own.detail})`);
      return;
    }
    await sleep(300);
  }
  throw new Error(`the coordinator did not answer on ${base} within ${timeoutMs / 1000} s`);
}

// A tool subprocess (stitch, run) in flight, so a signal can stop it too. Each has a deadline (tools/stitch.ts's own
// requests have none): past it the tool is killed and counts as failed, so a stalled coordinator fails the run.
const TOOL_MS = 600_000;
let tool: Deno.ChildProcess | undefined;
async function runTool(args: string[]) {
  if (signalled) throw new Error("stopping on a signal");
  const child = (tool = new Deno.Command(Deno.execPath(), { args, stdin: "null", stdout: "piped", stderr: "piped" }).spawn());
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }, TOOL_MS);
  try {
    const out = await child.output();
    return { success: out.success && !timedOut, stdout: text(out.stdout), stderr: `${timedOut ? `killed after ${TOOL_MS / 1000} s\n` : ""}${text(out.stderr)}` };
  } finally {
    clearTimeout(timer);
    tool = undefined;
  }
}

// Every request is bounded (its body too), so a coordinator that accepts and never answers fails the run instead of
// hanging it.
const REQUEST_MS = 30_000;
async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${base}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_MS) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body, headers: res.headers };
}
const postJson = (path: string, body: unknown) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---- the public view, and the pacing invariant checked on every read ----

// deno-lint-ignore no-explicit-any
type View = any;
let paceOk = true;
let paceDetail = "";
// Each day's own record (added 2026-10-17, second review): a done or verified day carries the time it was done, a
// verified one the time it was verified, in order after its release, and a day not yet done carries neither. Without
// this a coordinator that never recorded completion would leave doneAt null and skip the release-order check below.
let recordOk = true;
let recordDetail = "";
const dawnIndex = (t: number, v: View) => Math.floor((t - v.pace.dawnOffsetMs) / v.pace.dawnPeriodMs);
async function view(): Promise<View> {
  const r = await request(`/api/public/gardens/${NAME}`);
  if (r.status !== 200) throw new Error(`GET /api/public/gardens/${NAME}: ${r.status} ${JSON.stringify(r.body)}`);
  const v = r.body;
  // In any n dawn periods at most n + 1 days are released.
  const released = v.clock.releasedStep / v.pace.stepsPerDay;
  const dawns = dawnIndex(v.now, v) - dawnIndex(v.createdAt, v);
  if (released > 1 + dawns) {
    paceOk = false;
    paceDetail ||= `${released} days released ${dawns} dawns after creation (now ${v.now}, createdAt ${v.createdAt})`;
  }
  // And release by release (Garden.maybe_release/3): day d + 1 comes at a later dawn than day d's own release, and
  // only once day d is done. days[] lists every day here (it shows the newest 14).
  const days = [...v.days].sort((a: { day: number }, b: { day: number }) => a.day - b.day);
  for (const d of days) {
    const done = d.status === "done" || d.status === "verified";
    const good = !Number.isInteger(d.releasedAt)
      ? false
      : done
        ? Number.isInteger(d.doneAt) && d.doneAt >= d.releasedAt &&
          (d.status === "verified" ? Number.isInteger(d.verifiedAt) && d.verifiedAt >= d.doneAt : d.verifiedAt === null)
        : d.doneAt === null && d.verifiedAt === null;
    if (!good) {
      recordOk = false;
      recordDetail ||= `day ${d.day}: ${JSON.stringify({ status: d.status, releasedAt: d.releasedAt, doneAt: d.doneAt, verifiedAt: d.verifiedAt })} (view at ${v.now})`;
    }
  }
  for (let i = 1; i < days.length; i++) {
    const [prev, next] = [days[i - 1], days[i]];
    // Days are released in turn, each after its predecessor is done; a predecessor with no done time fails too (no day
    // is redone in this test, so none goes back to waiting).
    if (next.day !== prev.day + 1 || !Number.isInteger(next.releasedAt) || !Number.isInteger(prev.releasedAt)) continue;
    const sameDawn = dawnIndex(next.releasedAt, v) <= dawnIndex(prev.releasedAt, v);
    const beforeDone = !Number.isInteger(prev.doneAt) || next.releasedAt < prev.doneAt;
    if (sameDawn || beforeDone) {
      paceOk = false;
      paceDetail ||= `day ${next.day} released at ${next.releasedAt}, day ${prev.day} released at ${prev.releasedAt} and done at ${prev.doneAt} (${sameDawn ? "the same dawn period" : "before it was done"})`;
    }
  }
  return v;
}
/** Polls the view (cached for up to two seconds) until `pred` holds; throws (naming `what`) if it still does not after
 * `timeoutMs`, so a check never runs on a stale read. */
async function viewWhen(what: string, pred: (v: View) => boolean, timeoutMs = 10_000): Promise<View> {
  const deadline = Date.now() + timeoutMs;
  let v = await view();
  while (!pred(v)) {
    if (Date.now() >= deadline) {
      throw new Error(`the public view did not show ${what} within ${timeoutMs / 1000} s: ${JSON.stringify({ now: v.now, state: v.state, clock: v.clock, verification: v.verification, letters: v.letters })}`);
    }
    await sleep(250);
    v = await view();
  }
  return v;
}
const letterOf = (v: View, id: string) => [...v.letters.waiting, ...v.letters.recent].find((l: { id: string }) => l.id === id);
const dayOf = (v: View, d: number) => v.days.find((x: { day: number }) => x.day === d);

// ---- islands: one device, two identities, sequenced by this script ----

// Acquired inside the protected run below.
let device: GPUDevice;
let host: { host: string; adapter: string };

interface Island {
  name: string;
  identity?: { id: string; token: string };
  gardenToken?: string;
  log: string[];
}
const A: Island = { name: "A", gardenToken: TOKEN, log: [] };
const B: Island = { name: "B", gardenToken: TOKEN, log: [] };

/** Has `island` complete `n` tasks, asking again (after a short sleep) whenever it is told idle: an idle answer is
 * waiting for the next dawn, not a failure. Returns the tasks it took, as "run #d" / "verify #d". */
// The deadline is runIsland's signal, which since docs/island-cancel-2026-10-18.md also cancels its requests and stops a
// task in hand at its next census chunk (nothing uploaded or completed, the lease left to lapse): a day past the
// deadline is abandoned, not finished and counted, so the checks see it as not done. A complete, reject or fail already
// sent is not aborted, so a call still running ISLAND_GRACE_MS past the deadline (a coordinator that never answers one)
// fails the run: the throw reaches the cleanup, which stops the coordinator and exits the process, and with it the call.
const ISLAND_GRACE_MS = 30_000;
// A day takes about a second here; BL_E2E_WORK_MS raises the per-step budget (default 120 s) on a machine slow enough
// to need it, so a healthy slow island is not failed as a stuck one.
const WORK_MS = Deno.env.get("BL_E2E_WORK_MS") ? Number(Deno.env.get("BL_E2E_WORK_MS")) : 120_000;
if (!Number.isInteger(WORK_MS) || WORK_MS <= 0) throw new Error(`BL_E2E_WORK_MS must be a positive integer, not ${Deno.env.get("BL_E2E_WORK_MS")}`);
async function work(island: Island, n: number, timeoutMs = WORK_MS): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const taken: string[] = [];
  let done = 0;
  while (done < n && Date.now() < deadline) {
    const log: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stuck = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`island ${island.name} still running ${ISLAND_GRACE_MS / 1000} s past its deadline: ${log.slice(-6).join(" | ")}`)), Math.max(1, deadline - Date.now()) + ISLAND_GRACE_MS);
    });
    try {
      done += await Promise.race([
        runIsland(device, {
          coordinator: base,
          host,
          maxTasks: n - done,
          idleMs: 200,
          identity: island.identity,
          gardenToken: island.gardenToken,
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          onJoined: (identity) => (island.identity = identity),
          log: (m) => log.push(m),
        }),
        stuck,
      ]);
    } finally {
      clearTimeout(timer);
    }
    island.log.push(...log);
    for (const m of log) {
      const hit = /^(run|verify) \S+ #(\d+)/.exec(m);
      if (hit) taken.push(`${hit[1]} #${hit[2]}`);
    }
    // A rejected predecessor or a failed task is never "waiting for the dawn": stop and let the checks say so.
    if (log.some((m) => /rejecting|cannot apply the schedule|task abandoned/.test(m))) break;
    if (done < n) await sleep(300);
  }
  return taken;
}

const letterBody = (x: number, y: number, r: number) => ({ kind: "stone", x, y, r });
const postLetter = (l: { x: number; y: number; r: number }) => postJson(`/api/public/gardens/${NAME}/letters`, letterBody(l.x, l.y, l.r));
/** A food hand from network `ip` (the coordinator trusts X-Forwarded-For here). */
const hand = (ip: string) => request(`/api/public/gardens/${NAME}/food/hands`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: "{}" });

// Stones on the founders' cells (world.ts's generalist init: lowbias32(seed * 31 + i)), so the letters hit biomass.
const spotsCfg = { ...defaultConfig(), ...PRESETS.find((p) => p.id === "spots")!.cfg, seed: 1 };
const W = worldW(spotsCfg), H = cellCount(spotsCfg) / W;

// Who held the field (amended 2026-10-18, docs/garden-predictions-2026-10-18.md section 9): the script's own reading of
// the files the coordinator stored, to compare with the view's `days[].leaders`. Shares are compared to within a unit
// in the fourth place (the coordinator rounds in decimal, JavaScript in binary); everything else exactly.
type Row = { hi: number; lo: number; cells: number };
const keyOf = (r: { hi: number; lo: number }) => `${r.hi}:${r.lo}`;
const leaderLabel = (hi: number, lo: number) =>
  hi === 0 ? `founder ${lo}` : lo < W * H ? `born step ${hi - 1} at ${lo % W},${Math.floor(lo / W)}` : `born step ${hi - 1}, cell ${lo}`;
const shareOf = (c: number, living: number) => (living === 0 ? 0 : Math.round((c / living) * 1e4) / 1e4);
function endRows(tsv: string, endStep: number): Row[] {
  return tsv.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")).filter((f) => Number(f[0]) === endStep)
    .map(([, k, c]) => { const [hi, lo] = k.split(":").map(Number); return { hi, lo, cells: Number(c) }; });
}
function censusOf(rows: Row[], step: number) {
  const living = rows.reduce((a, r) => a + r.cells, 0);
  const top = [...rows].sort((a, b) => b.cells - a.cells || a.hi - b.hi || a.lo - b.lo).slice(0, 3);
  const clear = top.length && top[0].cells * 100 >= 10 * living && !(top[1] && top[1].cells >= top[0].cells) ? keyOf(top[0]) : null;
  return {
    step, livingCells: living, lineages: rows.length, clearLeader: clear,
    top: top.map((r) => ({ key: keyOf(r), label: leaderLabel(r.hi, r.lo), cells: r.cells, share: shareOf(r.cells, living) })),
  };
}
function parentsOf(tsvs: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const tsv of tsvs) for (const l of tsv.split("\n").slice(1).filter(Boolean)) { const [a, b, c, d] = l.split("\t"); m.set(`${a}:${b}`, `${c}:${d}`); }
  return m;
}
/** The lines into day T from B = T - 1 (the note's section 4): each key walked up to the nearest of B's top keys, or to a key born before B began. */
function linesOf(rows: Row[], parents: Map<string, string>, fromDay: number, startB: number, topB: string[]) {
  const sums = new Map<string, number>();
  let orphan = "";
  for (const r of rows) {
    let k = keyOf(r);
    for (;;) {
      if (topB.includes(k)) break;
      if (Number(k.split(":")[0]) <= startB) { k = "rest"; break; }
      const p = parents.get(k);
      if (!p) { orphan ||= k; k = "rest"; break; }
      k = p;
    }
    sums.set(k, (sums.get(k) ?? 0) + r.cells);
  }
  const living = rows.reduce((a, r) => a + r.cells, 0);
  const groups = topB.map((k) => { const [hi, lo] = k.split(":").map(Number); const c = sums.get(k) ?? 0; return { key: k, label: leaderLabel(hi, lo), cells: c, share: shareOf(c, living) }; });
  const rest = sums.get("rest") ?? 0;
  const all = [{ key: "rest", cells: rest }, ...groups].sort((a, b) => b.cells - a.cells);
  const winner = all[0].cells > 0 && !(all[1] && all[1].cells === all[0].cells) ? all[0].key : null;
  return { orphan, lines: { fromDay, groups, rest: { cells: rest, share: shareOf(rest, living) }, winner } };
}
/** Equal, with every `share` within 1.1e-4 of the other's. */
function sameNumbers(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameNumbers(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    return canon(ka) === canon(kb) && ka.every((k) => k === "share"
      ? Math.abs((a as Record<string, number>)[k] - (b as Record<string, number>)[k]) <= 1.1e-4
      : sameNumbers((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}
/** A segment's stored file as text (the coordinator serves what the producer uploaded). */
async function segmentText(index: number, name: string): Promise<string> {
  const listing = await request(`/api/experiments/${NAME}`);
  const seg = (listing.body?.segments ?? []).find((x: { index: number }) => x.index === index);
  if (!seg) return "";
  const res = await fetch(`${base}/api/segments/${seg.id}/files/${name}`, { signal: AbortSignal.timeout(REQUEST_MS) });
  const text = await res.text();
  return res.status === 200 ? text : "";
}
/** Polls the view until `pred` holds (the block is counted off the queue), or gives the last view after `timeoutMs`. */
async function leadersWhen(pred: (v: View) => boolean, timeoutMs = 60_000): Promise<View> {
  const deadline = Date.now() + timeoutMs;
  let v = await view();
  while (!pred(v) && Date.now() < deadline) {
    await sleep(250);
    v = await view();
  }
  return v;
}
const founder = (i: number) => {
  const h = lowbias32(spotsCfg.seed * 31 + i);
  return { x: h % W, y: (h >>> 12) % H };
};
const L1 = { ...founder(0), r: 12 };
const L2 = { ...founder(1), r: 10 };
const L3 = { ...founder(2), r: 8 };

// The letter limit counts in fixed windows of the coordinator's wall clock (LetterLimiter.take/1, config.exs's
// garden_letter_window_ms), not a sliding hour; the 429 check below needs L1 to L3 and the fourth post in one window.
const LETTER_WINDOW_MS = 3_600_000;
const letterWindow = () => Math.floor(Date.now() / LETTER_WINDOW_MS);
// Enough for the coordinator's boot and A's day 0 on a loaded machine, between L1 and the fourth post.
const LETTER_WINDOW_MARGIN_MS = 180_000;

let server: Server | undefined;
let finishing = false;
// Set by a signal: its cleanup, which ends in Deno.exit. The main flow (whose next request fails once the server is
// stopped) waits for it rather than exiting first.
let signalled: Promise<void> | undefined;
async function cleanUp(removeDirs: boolean) {
  if (tool) {
    try {
      tool.kill("SIGKILL");
    } catch {
      // already exited
    }
  }
  await stopServer(server);
  server = undefined;
  if (removeDirs) {
    for (const d of [dataDir, workDir]) if (d) await Deno.remove(d, { recursive: true }).catch(() => {});
  }
}
// A signal skips JavaScript's finally, so each one stops the coordinator (and a running tool) and removes the scratch
// directories itself.
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  Deno.addSignalListener(sig, () => {
    if (finishing) return;
    finishing = true;
    console.log(`${sig}: stopping the coordinator and removing the scratch directories`);
    signalled = cleanUp(true).finally(() => Deno.exit(code));
  });
}

try {
  dataDir = await Deno.makeTempDir({ prefix: "bl-garden-e2e-data-" });
  workDir = await Deno.makeTempDir({ prefix: "bl-garden-e2e-out-" });
  serverLog = `${workDir}/coordinator.log`;
  denoBin = await noLockDenoBin(`${workDir}/bin`);
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const info = adapter?.info;
  const desc = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(" ") || "unknown";
  host = { host: `deno ${Deno.version.deno} ${Deno.build.os}-${Deno.build.arch} e2e`, adapter: `wgpu ${desc}` };
  device = await requestDevice(navigator.gpu);

  server = await spawnServer();
  await waitReady(server, 180_000);
  console.log(`  (coordinator on ${base})`);

  // ---- 1. found the garden; letter L1 ----
  const founded = await postJson("/api/gardens", {
    name: NAME,
    presetId: "spots",
    seed: 1,
    founding: FOUNDING,
    days: DAYS,
    stepsPerDay: D,
    censusEvery: CENSUS,
    lettersPerDay: 1,
    dawnPeriodMs: PERIOD,
    food: true,
    foodAsks: 2,
    foodEveryDays: 1,
  });
  check("1. the keeper founds a 4-day spots garden in dev (spots is a dev garden preset)", founded.status === 200 && founded.body?.garden === NAME && founded.body?.days === DAYS, JSON.stringify(founded));

  let v = await view();
  check(
    "1. the fresh garden: contract garden-v1, waiting for an island, day 0 released, nothing done, no tip, fork, census or share",
    v.contract === "garden-v1" && v.state === "waiting-for-island" && v.presetId === "spots" &&
      canon({ step: v.clock.step, verifiedStep: v.clock.verifiedStep, releasedStep: v.clock.releasedStep, horizonStep: v.clock.horizonStep, daysDone: v.clock.daysDone, daysTotal: v.clock.daysTotal }) ===
        canon({ step: 0, verifiedStep: 0, releasedStep: D, horizonStep: 4 * D, daysDone: 0, daysTotal: 4 }) &&
      v.tip === null && v.fork === null && v.census === null && v.verification.share === null,
    JSON.stringify({ contract: v.contract, state: v.state, clock: v.clock, tip: v.tip, fork: v.fork, census: v.census, verification: v.verification }),
  );

  check(
    "1. the food ask is open: enabled, K 2, N 1, no hands, a food would land on day 0 at D, at the centre with r 32 and amount 16",
    v.food?.enabled === true && v.food.asks === 2 && v.food.everyDays === 1 && v.food.hands === 0 && v.food.open === true && v.food.closed === null &&
      canon(v.food.landing) === canon({ day: 0, step: D }) && canon(v.food.place) === canon({ x: 128, y: 128 }) && v.food.r === 32 && v.food.amount === 16 && v.food.foods.length === 0,
    JSON.stringify(v.food),
  );

  const toEdge = LETTER_WINDOW_MS - (Date.now() % LETTER_WINDOW_MS);
  if (toEdge < LETTER_WINDOW_MARGIN_MS) {
    console.log(`  (waiting ${Math.ceil(toEdge / 1000) + 1} s for the next letter window, so the four posts share one)`);
    await sleep(toEdge + 1000);
  }
  const windowL1 = letterWindow();
  const p1 = await postLetter(L1);
  const l1 = p1.body?.letter;
  check("1. L1 is taken (201): waiting on day 0, landing at step D", p1.status === 201 && l1?.id === "ltr-1" && l1?.status === "waiting" && l1?.day === 0 && l1?.landsAtStep === D, JSON.stringify(p1));
  v = await viewWhen("one letter queued", (x) => x.letters.queued === 1);
  check("1. one letter queued, and the next would land on day 1 (day 0 is full)", v.letters.queued === 1 && v.letters.nextLanding?.day === 1, JSON.stringify(v.letters));

  // ---- 1b. an island without the garden token is never offered a garden day (amended 2026-10-18) ----
  // Day 0 is released and nobody holds it, so a tokenless island asking now would get it on an open coordinator. One
  // ask (maxTasks 1 returns on the first idle answer): no task, and day 0 still waits for A.
  const cLog: string[] = [];
  const cDone = await runIsland(device, { coordinator: base, host, maxTasks: 1, idleMs: 200, signal: AbortSignal.timeout(WORK_MS), log: (m) => cLog.push(m) });
  const cTook = cLog.filter((m) => /^(run|verify) /.test(m));
  const vC = await view();
  check(
    "1b. island C, joined without the garden token while day 0 is released and unassigned, is told idle: no task taken, day 0 still waiting",
    cDone === 0 && cTook.length === 0 && cLog.some((m) => /^joined as /.test(m)) && dayOf(vC, 0)?.status === "waiting" && vC.clock.releasedStep === D,
    `${cDone} done | ${cLog.join(" | ")} | day 0 ${JSON.stringify(dayOf(vC, 0))}`,
  );

  // ---- 2. A runs day 0; letters L2 and L3; the per-address limit ----
  const a0 = await work(A, 1);
  check("2. island A runs day 0", canon(a0) === canon(["run #0"]), `${a0.join(", ")} | ${A.log.join(" | ")}`);
  const p2 = await postLetter(L2);
  const p3 = await postLetter(L3);
  check(
    "2. L2 goes on day 1 (day 0 holds an attempt) and lands at 2D; L3 spills to day 2 (day 1 is full) and lands at 3D",
    p2.status === 201 && p2.body.letter.id === "ltr-2" && p2.body.letter.day === 1 && p2.body.letter.landsAtStep === 2 * D &&
      p3.status === 201 && p3.body.letter.id === "ltr-3" && p3.body.letter.day === 2 && p3.body.letter.landsAtStep === 3 * D,
    JSON.stringify({ p2: p2.body, p3: p3.body }),
  );
  const p4 = await postLetter({ ...founder(3), r: 4 });
  const sameWindow = letterWindow() === windowL1;
  check(
    "2. a fourth letter from the same address in the same hourly window is refused 429 with Retry-After and an integer retryAfterMs",
    sameWindow && p4.status === 429 && p4.headers.get("retry-after") !== null && Number.isInteger(p4.body?.retryAfterMs),
    `${sameWindow ? "" : "the hourly letter window rolled over between L1 and this post (rerun); "}${p4.status} retry-after ${p4.headers.get("retry-after")} ${JSON.stringify(p4.body)}`,
  );
  // ---- 2b. food: two networks call a food onto day 1 (the frontier: day 0 holds an attempt) ----
  // The dawn period is one second here and hands expire at each dawn. First the repeat rule, with one network (K 2,
  // so one network alone can never call): each try starts just past a dawn and sends the same network twice; a dawn
  // between the two makes the second a fresh 201 instead, and the next try repeats it. Then fresh networks, one at a
  // time, until one calls the food (the first unless a dawn falls between it and the repeat's network).
  let food: any = null;
  let repeatSeen = false;
  const handLog: string[] = [];
  const said = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify({ counted: r.body?.counted, called: r.body?.called?.id ?? null, hands: r.body?.food?.hands })}`;
  for (let attempt = 0; attempt < 5 && !repeatSeen; attempt++) {
    await sleep(PERIOD - (Date.now() % PERIOD) + 30);
    // A fresh network per try: a hand costs a letter of that network's hourly budget, and a repeat is a refusal.
    const h1 = await hand(`10.0.${attempt}.1`);
    const again = await hand(`10.0.${attempt}.1`);
    handLog.push(`repeat try ${attempt}: ${said(h1)} | ${said(again)}`);
    repeatSeen = h1.status === 201 && h1.body?.counted === true && h1.body?.called === null && again.status === 200 && again.body?.counted === false && again.body?.called === null;
  }
  check("2b. the same network's second hand in one dawn period is answered 200, not counted", repeatSeen, handLog.join(" || "));
  for (let i = 0; i < 4 && !food; i++) {
    const r = await hand(`10.0.8.${i + 1}`);
    handLog.push(`call try ${i}: ${said(r)}`);
    if (r.status === 201 && r.body?.called) food = r.body.called;
  }
  check(
    "2b. two networks call a food: waiting on day 1 (L2's day), landing at 2D, at the centre, r 32, amount 16, called by 2 hands, its day held a dawn period",
    food !== null && /^food-\d+$/.test(food.id) && food.day === 1 && food.landsAtStep === 2 * D && food.x === 128 && food.y === 128 && food.r === 32 && food.amount === 16 && food.hands === 2 && food.status === "waiting" &&
      food.noticeUntil === food.calledAt + PERIOD,
    `${JSON.stringify(food)} | ${handLog.join(" || ")}`,
  );
  const foodId = food?.id as string;
  const fourth = await hand("10.0.9.3");
  check(
    "2b. a further hand is refused 409 cooldown: the next food can land on day 2 at the earliest (N 1)",
    fourth.status === 409 && fourth.body?.closed === "cooldown" && fourth.body?.opensAtDay === 2,
    `${fourth.status} ${JSON.stringify(fourth.body)}`,
  );
  v = await viewWhen("the food in the view", (x) => x.food?.foods?.length === 1);
  check(
    "2b. the view shows the food waiting, the ask closed for cooldown, and no food among the letters",
    v.food.foods[0].id === foodId && v.food.foods[0].status === "waiting" && v.food.closed === "cooldown" && v.food.opensAtDay === 2 && v.food.landing === null &&
      ![...v.letters.waiting, ...v.letters.recent].some((l: { id: string }) => l.id === foodId),
    JSON.stringify({ food: v.food, letters: v.letters }),
  );

  v = await viewWhen("day 0 done with two letters queued", (x) => x.clock.daysDone === 1 && x.letters.queued === 2);
  check(
    "2. one day done, not verified: tip at D unverified, no fork, verifiedStep 0, a census with conservation exact, last moved when day 0 was done",
    v.clock.daysDone === 1 && v.clock.step === D && v.clock.verifiedStep === 0 && v.tip?.day === 0 && v.tip?.verified === false && v.fork === null && v.census !== null && v.census.conservationOk === true &&
      Number.isInteger(v.clock.lastMovedAt) && v.clock.lastMovedAt === dayOf(v, 0)?.doneAt && dayOf(v, 0)?.verifiedAt === null,
    JSON.stringify({ clock: v.clock, tip: v.tip, fork: v.fork, census: v.census, day0: dayOf(v, 0) }),
  );
  const tip0 = v.tip?.digest as string;
  check(
    "2. L1 landed in day 0's digest; L2 waits on day 1 at 2D, L3 on day 2 at 3D",
    letterOf(v, "ltr-1")?.status === "landed" && letterOf(v, "ltr-1")?.landedIn === tip0 &&
      letterOf(v, "ltr-2")?.status === "waiting" && letterOf(v, "ltr-2")?.day === 1 && letterOf(v, "ltr-2")?.landsAtStep === 2 * D &&
      letterOf(v, "ltr-3")?.status === "waiting" && letterOf(v, "ltr-3")?.day === 2 && letterOf(v, "ltr-3")?.landsAtStep === 3 * D,
    JSON.stringify(v.letters),
  );
  const unverifiedCk = await request(`/api/public/gardens/${NAME}/checkpoints/${tip0}`);
  check("2. day 0's checkpoint is not served while day 0 is unverified (404)", unverifiedCk.status === 404, String(unverifiedCk.status));

  // ---- 3. B replays day 0 ----
  const b0 = await work(B, 1);
  check("3. island B replays day 0", canon(b0) === canon(["verify #0"]), `${b0.join(", ")} | ${B.log.join(" | ")}`);
  v = await viewWhen("day 0 verified", (x) => x.verification.daysVerified === 1);
  check(
    "3. day 0 verified by a second island of the same device type: share 1, verifiedStep D, the fork is day 0, L1 verified",
    canon({ daysDone: v.verification.daysDone, daysVerified: v.verification.daysVerified, same: v.verification.bySameDeviceType, different: v.verification.byDifferentDeviceType, share: v.verification.share }) ===
      canon({ daysDone: 1, daysVerified: 1, same: 1, different: 0, share: 1 }) &&
      v.clock.verifiedStep === D && v.fork?.day === 0 && v.fork?.step === D && v.fork?.digest === dayOf(v, 0)?.digest && v.fork?.digest === tip0 &&
      letterOf(v, "ltr-1")?.status === "verified",
    JSON.stringify({ verification: v.verification, clock: v.clock, fork: v.fork, l1: letterOf(v, "ltr-1") }),
  );
  // The servable-checkpoint lookup is cached like the view (up to two seconds), and step 2's 404 just filled that cache.
  // A day becoming verified now invalidates both (amended 2026-10-18, docs/garden-hardening-2026-10-18.md, item 2), so
  // the first read after the view first names the fork is 200: no polling.
  const forkT0 = Date.now();
  const forkRes = await fetch(`${base}${v.fork?.checkpoint}`, { signal: AbortSignal.timeout(REQUEST_MS) });
  const forkWaitMs = Date.now() - forkT0;
  const forkBytes = new Uint8Array(await forkRes.arrayBuffer());
  let forkDetail = `${forkRes.status} on the first read (${forkWaitMs} ms)`;
  let forkOk = false;
  if (forkRes.status === 200) {
    try {
      const art = decodeArtifact(forkBytes);
      const digest = artifactDigest(art.state, art.observer);
      forkOk = art.state.step === D && digest === v.fork.digest;
      forkDetail = `step ${art.state.step}, digest ${digest} vs fork ${v.fork.digest}, served after ${forkWaitMs} ms`;
    } catch (e) {
      forkDetail = `undecodable: ${(e as Error).message}`;
    }
  }
  check("3. the fork checkpoint is served (200) on the first read after the view names it, and decodes to the state at step D whose artifact digest is the fork's", forkOk, forkDetail);

  // Who held the field (amended 2026-10-18): day 0 was replayed with every observation file matching, so its block is
  // counted from its files, off the queue.
  v = await leadersWhen((x) => dayOf(x, 0)?.leaders?.status === "ok");
  const lineages0 = await segmentText(0, "lineages.tsv");
  const rows0 = endRows(lineages0, D);
  const census0 = censusOf(rows0, D);
  check(
    "3. day 0's leaders block is ok, its lines null (no day before it), and the leaders rule is lines-v1",
    dayOf(v, 0)?.leaders?.status === "ok" && dayOf(v, 0)?.leaders?.lines === null && v.leadersRule?.name === "lines-v1",
    JSON.stringify({ leaders: dayOf(v, 0)?.leaders, rule: v.leadersRule }),
  );
  check(
    "3. day 0's lineages.tsv has rows at the day's end step D, and the block's census is the script's own top three and sum over them",
    rows0.length > 0 && sameNumbers(dayOf(v, 0)?.leaders?.census, census0),
    `${rows0.length} rows at D; view ${JSON.stringify(dayOf(v, 0)?.leaders?.census)} vs script ${JSON.stringify(census0)}`,
  );

  // ---- 4. A runs day 1; the keeper drops L3 ----
  const a1 = await work(A, 1);
  check("4. island A runs day 1 (released at the next dawn)", canon(a1) === canon(["run #1"]), `${a1.join(", ")} | ${A.log.slice(-6).join(" | ")}`);
  const drop3 = await postJson(`/api/gardens/${NAME}/letters/ltr-3/drop`, {});
  const drop1 = await postJson(`/api/gardens/${NAME}/letters/ltr-1/drop`, {});
  check(
    "4. the keeper drops L3 (its day has no attempt): 200 dropped; dropping L1 (its day was assigned) is 409",
    drop3.status === 200 && drop3.body?.letter?.status === "dropped" && drop1.status === 409,
    JSON.stringify({ drop3, drop1: { status: drop1.status, body: drop1.body } }),
  );
  const listing = await request(`/api/experiments/${NAME}`);
  const seg1 = (listing.body?.segments ?? []).find((s: { index: number }) => s.index === 1);
  const man1 = seg1 ? await request(`/api/segments/${seg1.id}/files/manifest.json`) : { status: 0, body: null, headers: new Headers() };
  const l3Entry = { step: 3 * D, kind: "lesion", ...L3 };
  check(
    "4. day 1's uploaded manifest carries L3 at 3D (the drop came after day 1 was assigned, so the stitch rule's case 4 is exercised)",
    man1.status === 200 && Array.isArray(man1.body?.spec?.interventions) && man1.body.spec.interventions.some((e: unknown) => canon(e) === canon(l3Entry)),
    JSON.stringify({ status: man1.status, interventions: man1.body?.spec?.interventions }),
  );
  // Mid-run (added 2026-10-17, after review): day 1 is done and not replayed, so the honesty numbers split.
  v = await viewWhen("day 1 done", (x) => x.clock.daysDone === 2);
  check(
    "4. two days done, one verified: step 2D, verifiedStep D, share 0.5, tip day 1 unverified, the fork still day 0, L2 landed (not verified) in day 1's digest",
    canon({ step: v.clock.step, verifiedStep: v.clock.verifiedStep }) === canon({ step: 2 * D, verifiedStep: D }) &&
      canon(v.verification) === canon({ daysDone: 2, daysVerified: 1, byDifferentDeviceType: 0, bySameDeviceType: 1, diverged: 0, failed: 0, share: 0.5 }) &&
      v.tip?.day === 1 && v.tip?.verified === false && v.fork?.day === 0 && v.fork?.step === D && v.fork?.step === v.clock.verifiedStep &&
      letterOf(v, "ltr-2")?.status === "landed" && letterOf(v, "ltr-2")?.landedIn === v.tip?.digest && letterOf(v, "ltr-1")?.status === "verified",
    JSON.stringify({ clock: v.clock, verification: v.verification, tip: v.tip, fork: v.fork, l1: letterOf(v, "ltr-1"), l2: letterOf(v, "ltr-2") }),
  );
  // The export is the verified prefix: day 0 only, with L1 and without L2, which landed in the unverified day 1.
  const prefixOut = `${workDir}/prefix`;
  const prefix = await runTool(["run", "--no-lock", "-A", "tools/stitch.ts", "--coordinator", base, "--experiment", NAME, "--out", prefixOut]);
  const prefixMan = JSON.parse((await readOr(`${prefixOut}/${NAME}/spots/treatment/seed-1/manifest.json`)) ?? "{}");
  check(
    "4. tools/stitch.ts mid-run exports only the verified prefix: steps D, the founding plus L1 at D, 2 applied",
    prefix.success && prefix.stdout.includes("1 written") && prefixMan.spec?.steps === D &&
      canon(prefixMan.spec?.interventions) === canon([...FOUNDING, { step: D, kind: "lesion", ...L1 }]) && prefixMan.interventions?.applied === 2,
    `${prefix.stdout.slice(-300)} ${prefix.stderr.slice(0, 400)} ${JSON.stringify({ steps: prefixMan.spec?.steps, spec: prefixMan.spec?.interventions, block: prefixMan.interventions })}`,
  );

  // ---- 5. B replays day 1, A runs day 2, B replays day 2 ----
  const b1 = await work(B, 1);
  const a2 = await work(A, 1);
  const b2 = await work(B, 1);
  check(
    "5. B replays day 1, A runs day 2, B replays day 2",
    canon([b1, a2, b2]) === canon([["verify #1"], ["run #2"], ["verify #2"]]),
    `${canon([b1, a2, b2])} | A: ${A.log.slice(-6).join(" | ")} | B: ${B.log.slice(-6).join(" | ")}`,
  );
  v = await viewWhen("three days verified", (x) => x.verification.daysVerified === 3);
  const R = v.clock.releasedStep as number;
  check(
    "5. three days done and verified: step 3D, verifiedStep 3D, released 3D or 4D (day 3 may be released by B's last request), last moved when day 2 was done",
    v.clock.step === 3 * D && v.clock.verifiedStep === 3 * D && v.clock.daysDone === 3 && (R === 3 * D || R === 4 * D) &&
      Number.isInteger(v.clock.lastMovedAt) && v.clock.lastMovedAt === dayOf(v, 2)?.doneAt,
    JSON.stringify({ clock: v.clock, day2: dayOf(v, 2) }),
  );
  check(
    "5. verification: 3 done, 3 verified, all by the same device type, none diverged or failed, share 1",
    canon(v.verification) === canon({ daysDone: 3, daysVerified: 3, byDifferentDeviceType: 0, bySameDeviceType: 3, diverged: 0, failed: 0, share: 1 }),
    JSON.stringify(v.verification),
  );
  check(
    "5. the fork is day 2 at step 3D (the verified step), at the tip; days 0 to 2 are verified, same-device-type",
    v.fork?.day === 2 && v.fork?.step === 3 * D && v.fork?.step === v.clock.verifiedStep && v.fork?.digest === v.tip?.digest && [0, 1, 2].every((d) => dayOf(v, d)?.status === "verified" && dayOf(v, d)?.verification === "same-device-type"),
    JSON.stringify({ fork: v.fork, tip: v.tip, days: v.days }),
  );
  check(
    "5. day letters: day 0 [ltr-1], day 1 [ltr-2], day 2 []",
    canon([0, 1, 2].map((d) => dayOf(v, d)?.letters)) === canon([["ltr-1"], ["ltr-2"], []]),
    JSON.stringify(v.days.map((d: { day: number; letters: string[] }) => [d.day, d.letters])),
  );
  check(
    "5. L1 and L2 verified, landed in their days' digests; L3 dropped; nothing queued",
    letterOf(v, "ltr-1")?.status === "verified" && letterOf(v, "ltr-1")?.landedIn === dayOf(v, 0)?.digest &&
      letterOf(v, "ltr-2")?.status === "verified" && letterOf(v, "ltr-2")?.landedIn === dayOf(v, 1)?.digest &&
      letterOf(v, "ltr-3")?.status === "dropped" && v.letters.queued === 0,
    JSON.stringify(v.letters),
  );
  const seg1Log = seg1 ? await request(`/api/segments/${seg1.id}/files/${INTERVENTIONS_FILE}`) : { status: 0, body: "", headers: new Headers() };
  const day1Log = (() => {
    try {
      // request() parses a body that is one JSON value; a one-line log would be one.
      return parseInterventionLog(typeof seg1Log.body === "string" ? seg1Log.body : `${JSON.stringify(seg1Log.body)}\n`);
    } catch {
      return [];
    }
  })();
  const atEnd1 = day1Log.filter((e) => e.step === 2 * D);
  check(
    "5. day 1's interventions.jsonl holds L2 and then the food, a feed of r 32 that moved exactly 51,344 quanta, at 2D",
    seg1Log.status === 200 && atEnd1.length === 2 && canon(atEnd1[0]) === canon({ step: 2 * D, kind: "lesion", ...L2 }) &&
      canon(atEnd1[1]) === canon({ step: 2 * D, ...FOOD, matter: FOOD_MATTER }),
    `${seg1Log.status} ${JSON.stringify(day1Log)}`,
  );
  check(
    "5. the food is verified, landed in day 1's digest, day 1 carries it, and day 1's matter adds up",
    v.food.foods[0]?.id === foodId && v.food.foods[0]?.status === "verified" && v.food.foods[0]?.landedIn === dayOf(v, 1)?.digest &&
      dayOf(v, 1)?.food === foodId && dayOf(v, 0)?.food === null && dayOf(v, 2)?.food === null && dayOf(v, 1)?.census?.conservationOk === true,
    JSON.stringify({ food: v.food, days: v.days }),
  );

  // Island C joined and asked too, but tending counts attempts, not joins: still two.
  check("5. tending: two islands today (C, which never took a day, is not counted), one device type ever", v.tending.islandsToday === 2 && v.tending.deviceTypesEver === 1, JSON.stringify(v.tending));

  // The lines into day 1 (amended 2026-10-18): the script walks both days' mutations.tsv itself.
  const vl = await leadersWhen((x) => [1, 2].every((d) => dayOf(x, d)?.leaders?.status === "ok" && dayOf(x, d)?.leaders?.lines));
  const rows1 = endRows(await segmentText(1, "lineages.tsv"), 2 * D);
  const walk = linesOf(rows1, parentsOf([await segmentText(0, "mutations.tsv"), await segmentText(1, "mutations.tsv")]), 0, 0, census0.top.map((t) => t.key));
  check(
    "5. days 1 and 2 have ok blocks with lines; day 1's census is the script's own over its end-step rows",
    rows1.length > 0 && sameNumbers(dayOf(vl, 1)?.leaders?.census, censusOf(rows1, 2 * D)) && dayOf(vl, 2)?.leaders?.lines?.fromDay === 1,
    JSON.stringify({ day1: dayOf(vl, 1)?.leaders?.census, script: censusOf(rows1, 2 * D), day2: dayOf(vl, 2)?.leaders }),
  );
  check(
    "5. day 1's lines equal the script's own walk over days 0 and 1's mutations.tsv (no orphan key)",
    walk.orphan === "" && sameNumbers(dayOf(vl, 1)?.leaders?.lines, walk.lines),
    `orphan ${walk.orphan || "none"}; view ${JSON.stringify(dayOf(vl, 1)?.leaders?.lines)} vs script ${JSON.stringify(walk.lines)}`,
  );

  // Pacing (amended 2026-10-17): a garden nobody asks releases nothing. No island asks from here on.
  await sleep(2 * PERIOD + 500);
  const rested = await viewWhen("a read two dawn periods later", (x) => x.now >= v.now + 2 * PERIOD, 10_000);
  check(
    "5. pacing: two dawns later with no island asking, nothing more is released and the garden waits for an island",
    rested.clock.releasedStep === R && rested.state === "waiting-for-island",
    JSON.stringify({ R, clock: rested.clock, state: rested.state, pace: rested.pace }),
  );
  if (R === 3 * D) {
    const day2 = dayOf(rested, 2);
    const expected = Math.floor(day2.releasedAt / PERIOD) * PERIOD + PERIOD;
    check(
      "5. pacing (day 3 not released): its release is due, at the first dawn after day 2's release",
      rested.pace.releaseDue === true && rested.pace.nextReleaseAt === expected,
      JSON.stringify({ pace: rested.pace, day2ReleasedAt: day2.releasedAt, expected }),
    );
  } else {
    const day3 = dayOf(rested, 3);
    check(
      "5. pacing (day 3 released by B's last request): day 3 waits, released, and no next release is scheduled",
      day3?.status === "waiting" && Number.isInteger(day3?.releasedAt) && rested.pace.nextReleaseAt === null,
      JSON.stringify({ pace: rested.pace, day3 }),
    );
  }

  // ---- 6. restart in a fresh OS process, same data directory ----
  const before = rested;
  const durable = (x: View) =>
    canon({
      clock: { step: x.clock.step, verifiedStep: x.clock.verifiedStep, releasedStep: x.clock.releasedStep, horizonStep: x.clock.horizonStep, daysDone: x.clock.daysDone, daysTotal: x.clock.daysTotal, lastMovedAt: x.clock.lastMovedAt },
      verification: x.verification,
      fork: x.fork,
      letters: [...x.letters.waiting, ...x.letters.recent].map((l: { id: string; status: string; landedIn: string | null }) => [l.id, l.status, l.landedIn]).sort(),
      foods: (x.food?.foods ?? []).map((f: { id: string; status: string; landedIn: string | null; day: number }) => [f.id, f.status, f.landedIn, f.day]),
      days: x.days.map((d: { day: number; status: string; releasedAt: number; doneAt: number | null; verifiedAt: number | null; digest: string | null }) => [d.day, d.status, d.releasedAt, d.doneAt, d.verifiedAt, d.digest]),
    });
  await stopServer(server);
  server = undefined;
  server = await spawnServer();
  await waitReady(server, 180_000);
  const after = await view();
  check("6. after a restart in a fresh OS process: the clock, verification, fork, letters, foods and every day's release record are unchanged", durable(after) === durable(before), `${durable(before)}\n vs ${durable(after)}`);
  const leadersOfView = (x: View) => canon({ rule: x.leadersRule, days: [0, 1, 2].map((d) => dayOf(x, d)?.leaders) });
  check(
    "6. ...and the leaders blocks of days 0 to 2 (decoded from state.bin by a fresh process) are unchanged",
    leadersOfView(after) === leadersOfView(before) && [0, 1, 2].every((d) => dayOf(after, d)?.leaders?.status === "ok"),
    `${leadersOfView(before)}\n vs ${leadersOfView(after)}`,
  );
  check(
    "6. ...the food is still there, verified, and the ask's count is 0 (trivially here, the call zeroed it; ExUnit holds the restart rule)",
    after.food?.foods?.[0]?.id === foodId && after.food.foods[0].status === "verified" && after.food.hands === 0,
    JSON.stringify(after.food),
  );
  // The fork is still downloadable (the letter limiter re-registers the garden's world on boot; the route needs it), on
  // the first read (amended 2026-10-18: no polling).
  const forkAgain = await fetch(`${base}${after.fork?.checkpoint}`, { signal: AbortSignal.timeout(REQUEST_MS) });
  let forkAgainDetail = `${forkAgain.status} on the first read`;
  let forkAgainOk = false;
  if (forkAgain.status === 200) {
    try {
      const art = decodeArtifact(new Uint8Array(await forkAgain.arrayBuffer()));
      const digest = artifactDigest(art.state, art.observer);
      forkAgainOk = art.state.step === 3 * D && after.fork.step === 3 * D && digest === after.fork.digest;
      forkAgainDetail = `step ${art.state.step} (fork says ${after.fork.step}), digest ${digest} vs fork ${after.fork.digest}`;
    } catch (e) {
      forkAgainDetail = `undecodable: ${(e as Error).message}`;
    }
  } else await forkAgain.body?.cancel();
  check("6. ...and the fork checkpoint (day 2's, at step 3D) is still served on the first read and decodes to step 3D with the fork's digest", forkAgainOk, forkAgainDetail);

  // ---- 7. export the verified prefix; compare with one unsegmented run ----
  const outDir = `${workDir}/stitched`;
  const stitch = await runTool(["run", "--no-lock", "-A", "tools/stitch.ts", "--coordinator", base, "--experiment", NAME, "--out", outDir]);
  const stitchOut = stitch.stdout;
  const stitchErr = stitch.stderr;
  check("7. tools/stitch.ts exports the garden's verified prefix (exit 0, 1 written)", stitch.success && stitchOut.includes("1 written"), `${stitchOut.slice(-400)} ${stitchErr.slice(0, 600)}`);

  const stitchedDir = `${outDir}/${NAME}/spots/treatment/seed-1`;
  const stitchedMan = JSON.parse((await readOr(`${stitchedDir}/manifest.json`)) ?? "{}");
  const stitchedLog = (await readOr(`${stitchedDir}/${INTERVENTIONS_FILE}`)) ?? "";
  const logged = (() => {
    try {
      return parseInterventionLog(stitchedLog);
    } catch {
      return [];
    }
  })();
  const expectedSchedule = [...FOUNDING, { step: D, kind: "lesion", ...L1 }, { step: 2 * D, kind: "lesion", ...L2 }, { step: 2 * D, ...FOOD }];
  check(
    "7. the stitched schedule is the founding plus L1 at D, L2 at 2D and the food after it, without the dropped L3; its log holds 4 lines at 0, D, 2D, 2D (the food's with its matter), and the manifest counts 4 applied",
    canon(stitchedMan.spec?.interventions) === canon(expectedSchedule) && logged.map((e) => e.step).join() === `0,${D},${2 * D},${2 * D}` &&
      logged[3]?.kind === "feed" && (logged[3] as { matter?: number }).matter === FOOD_MATTER && stitchedMan.interventions?.applied === 4 && stitchedMan.spec?.steps === 3 * D,
    JSON.stringify({ spec: stitchedMan.spec?.interventions, steps: stitchedMan.spec?.steps, log: logged.map((e) => e.step), block: stitchedMan.interventions }),
  );
  // At one step the stones come first, then the foods, each by number (README: food.landing).
  type Entry = { at: [number, number, number]; e: Record<string, unknown> };
  const seq = (id: string) => Number(id.slice(id.indexOf("-") + 1));
  const stonesFromView: Entry[] = [...after.letters.waiting, ...after.letters.recent]
    .filter((l: { status: string }) => l.status === "verified")
    .map((l: { id: string; landsAtStep: number; x: number; y: number; r: number }) => ({ at: [l.landsAtStep, 0, seq(l.id)], e: { step: l.landsAtStep, kind: "lesion", x: l.x, y: l.y, r: l.r } }));
  const foodsFromView: Entry[] = (after.food?.foods ?? [])
    .filter((f: { status: string }) => f.status === "verified")
    .map((f: { id: string; landsAtStep: number; x: number; y: number; r: number; amount: number }) => ({ at: [f.landsAtStep, 1, seq(f.id)], e: { step: f.landsAtStep, kind: "feed", x: f.x, y: f.y, r: f.r, amount: f.amount } }));
  const fromView = [
    ...after.founding,
    ...[...stonesFromView, ...foodsFromView].sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2]).map((x) => x.e),
  ];
  check("7. ...and it equals the public view's founding plus its verified letters and foods", canon(stitchedMan.spec?.interventions) === canon(fromView), `${canon(stitchedMan.spec?.interventions)} vs ${canon(fromView)}`);

  const scheduleFile = `${workDir}/schedule.json`;
  await Deno.writeTextFile(scheduleFile, JSON.stringify(stitchedMan.spec?.interventions ?? []));
  const singleOut = `${workDir}/single`;
  const single = await runTool([
    "run", "--no-lock", "-A", "tools/run.ts", "--experiment", NAME, "--preset", "spots", "--conditions", "treatment", "--seeds", "1",
    "--steps", String(3 * D), "--census", String(CENSUS), "--deep", "10", "--checkpoint", "0", "--interventions", scheduleFile, "--out", singleOut,
  ]);
  check("7. tools/run.ts runs the stitched schedule unsegmented over 3D steps", single.success, single.stderr.slice(0, 600));
  const singleDir = `${singleOut}/${NAME}/spots/treatment/seed-1`;
  const singleMan = JSON.parse((await readOr(`${singleDir}/manifest.json`)) ?? "{}");
  const differing: string[] = [];
  const missing: string[] = [];
  for (const f of VERIFIED_FILES) {
    const text = await readOr(`${stitchedDir}/${f}`);
    if (text !== (await readOr(`${singleDir}/${f}`))) differing.push(f);
    if (text === undefined && (f === INTERVENTIONS_FILE || (OBSERVATION_FILES as readonly string[]).includes(f))) missing.push(f);
  }
  check(
    "7. the stitched bundle equals the unsegmented run: every verified file byte for byte, and one final hash for the stitch, the run and the fork",
    differing.length === 0 && missing.length === 0 && typeof stitchedMan.summary?.finalHash === "string" &&
      stitchedMan.summary.finalHash === singleMan.summary?.finalHash && stitchedMan.summary.finalHash === after.fork?.digest,
    `differing [${differing.join(", ")}], missing [${missing.join(", ")}], finalHash stitched ${stitchedMan.summary?.finalHash} single ${singleMan.summary?.finalHash} fork ${after.fork?.digest}`,
  );

  check(
    "records over the whole test: every day read carried its release time, a done day its done time, a verified day its verified time, in that order, and an unfinished day neither",
    recordOk,
    recordDetail,
  );
  check(
    "pacing over the whole test: released days never exceed one plus the dawns since the garden was created, and each day was released at a later dawn than the one before, after it was done",
    paceOk,
    paceDetail,
  );
} catch (e) {
  if (!signalled) check("the run completes without an exception", false, (e as Error).stack ?? String(e));
} finally {
  if (signalled) await signalled;
  if (!finishing) {
    finishing = true;
    if (!ok && serverLog) {
      const tail = ((await readOr(serverLog)) ?? "").split("\n").slice(-40).join("\n");
      console.log(`--- coordinator log (last 40 lines) ---\n${tail}`);
    }
    await cleanUp(ok);
    if (!ok && dataDir) console.log(`kept for inspection: ${dataDir} (the coordinator's data) and ${workDir} (its log and the bundles)`);
  }
}

console.log(`${ok ? "OK" : "FAILED"}: ${checks} checks, ${ok ? "all passed" : "some failed"}, in ${((performance.now() - T0) / 1000).toFixed(1)} s`);
console.log(`uptime: ${await uptime()}`);
Deno.exit(ok ? 0 : 1);
