// bin/garden-dev's own paths, without the GPU, the lab or islands (GARDEN_LAB=0, GARDEN_ISLANDS=0): founding with a
// hostile environment (BL_ADMIN_TOKEN, BL_GARDEN_ISLAND_TOKEN and BL_DISCOVERY_DATA_DIR set in the caller's shell), the
// refusals (a data directory another launcher holds, a port something already answers on), re-tending a garden that
// already exists in a named directory (its own world in the printed commands, not this run's preset), and shutdown on
// SIGINT, SIGTERM (twice, the second during the cleanup) and SIGHUP (every process gone, the port free, the lock
// released, a scratch directory removed and a named one kept). A signal to this script stops its launchers too. tests/deno/garden_e2e.ts covers the garden itself; this covers the launcher around it.
//
// Run from the repo root: deno run -A tests/deno/garden_dev_smoke.ts < /dev/null
import { ISLAND_CAPABILITIES } from "@bl/runner";
import { METRICS_VERSION } from "@bl/schema";

const T0 = performance.now();
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const uptime = async () => {
  try {
    return text((await new Deno.Command("uptime", { stdin: "null" }).output()).stdout).trim();
  } catch {
    return "unavailable";
  }
};
console.log(`uptime: ${await uptime()}`);

const root = Deno.cwd();
const launcher = `${root}/bin/garden-dev`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const p = (l.addr as Deno.NetAddr).port;
  l.close();
  return p;
};

let ok = true;
let checks = 0;
const check = (name: string, cond: boolean, detail = "") => {
  checks++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail && !cond ? `: ${detail.slice(0, 1500)}` : ""}`);
  ok &&= cond;
};

/** The pids listening on `port`. lsof exits 1, silently, when there are none; a missing lsof, or one that fails any
 * other way, throws, so "the port is free" never passes because nothing could look. */
async function listeners(port: number): Promise<number[]> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command("lsof", { args: ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], stdin: "null", stdout: "piped", stderr: "piped" }).output();
  } catch (e) {
    throw new Error(`lsof is required to check the port: ${(e as Error).message}`);
  }
  const pids = text(out.stdout).split(/\s+/).filter(Boolean);
  const none = out.code === 1 && pids.length === 0 && text(out.stderr).trim() === "";
  if (!out.success && !none) throw new Error(`lsof failed (exit ${out.code}): ${text(out.stderr).slice(0, 300)}`);
  if (pids.some((p) => !/^[0-9]+$/.test(p))) throw new Error(`lsof printed something other than pids: ${pids.join(" ")}`);
  return pids.map(Number);
}
/** `pid` and every process below it (pgrep -P, depth first). */
async function treePids(pid: number): Promise<number[]> {
  let kids: number[] = [];
  try {
    const out = await new Deno.Command("pgrep", { args: ["-P", String(pid)], stdin: "null", stdout: "piped", stderr: "null" }).output();
    kids = text(out.stdout).split(/\s+/).filter(Boolean).map(Number);
  } catch {
    // no pgrep: the pid alone
  }
  return [pid, ...(await Promise.all(kids.map(treePids))).flat()];
}
/** A process as recorded: its pid and its start time, so a pid the system has since given to another process is not
 * taken for it (nothing is signalled on the strength of a bare pid recorded earlier). */
interface Proc {
  pid: number;
  start: string;
}
/** `pid`'s start time while it runs (a zombie does not), read with ps, which sends no signal. */
async function startOf(pid: number): Promise<string | undefined> {
  try {
    const out = await new Deno.Command("ps", { args: ["-o", "stat=,lstart=", "-p", String(pid)], stdin: "null", stdout: "piped", stderr: "null" }).output();
    const line = text(out.stdout).trim();
    if (!out.success || line === "" || line.startsWith("Z")) return undefined;
    return line.replace(/^\S+\s+/, "");
  } catch {
    return undefined;
  }
}
async function identify(pids: number[]): Promise<Proc[]> {
  const procs = await Promise.all(pids.map(async (pid) => ({ pid, start: await startOf(pid) })));
  return procs.filter((p): p is Proc => p.start !== undefined);
}
/** The recorded processes that are still the same processes and still running. */
async function running(procs: Proc[]): Promise<Proc[]> {
  const now = await Promise.all(procs.map(async (p) => (await startOf(p.pid)) === p.start));
  return procs.filter((_, i) => now[i]);
}
const pidsOf = (procs: Proc[]) => procs.map((p) => p.pid).join(", ");
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);

interface Launch {
  child: Deno.ChildProcess;
  out: () => string;
  /** The launcher's exit, after its output is drained. */
  status: Promise<Deno.CommandStatus>;
  /** Whether the launcher process itself has exited (its raw status, not the drained output). */
  exited: () => boolean;
  /** The launcher's process tree once it was up (`until` records it), checked again after it exits. */
  tree: Proc[];
  /** The launcher itself, identified as it was spawned. */
  root: Promise<Proc | undefined>;
}
const launches: Launch[] = [];

const baseEnv = Object.fromEntries(Object.entries(Deno.env.toObject()).filter(([k]) => !k.startsWith("BL_") && !k.startsWith("GARDEN_")));
function launch(env: Record<string, string>): Launch {
  if (stopping) throw new Error("stopping: no new launcher");
  const child = new Deno.Command(launcher, {
    cwd: root,
    env: { ...baseEnv, GARDEN_LAB: "0", GARDEN_ISLANDS: "0", GARDEN_DAYS: "2", GARDEN_DAWN_MS: "1000", ...env },
    clearEnv: true,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let buf = "";
  const pump = async (s: ReadableStream<Uint8Array>) => {
    for await (const chunk of s) buf += text(chunk);
  };
  const pumped = Promise.all([pump(child.stdout), pump(child.stderr)]);
  const status = child.status.then(async (s) => (await pumped, s));
  let exited = false;
  child.status.then(() => (exited = true));
  // Read while the launcher cannot have been reaped yet (its raw status has not resolved), so its pid is its own.
  const self = identify([child.pid]).then((r) => (exited ? undefined : r[0]));
  const l: Launch = { child, out: () => buf, status, exited: () => exited, tree: [], root: self };
  launches.push(l);
  return l;
}
async function until(l: Launch, needle: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let done = false;
  l.status.then(() => (done = true));
  while (!l.out().includes(needle)) {
    if (done) throw new Error(`the launcher exited before printing "${needle}":\n${l.out()}`);
    if (Date.now() >= deadline) throw new Error(`no "${needle}" within ${timeoutMs / 1000} s:\n${l.out()}`);
    await sleep(250);
  }
  if (needle === "Press Ctrl-C") l.tree = await ownTree(l);
}
/** The launcher's current process tree, identified, or nothing unless the launcher is still its own spawned process
 * both before and after the walk: its raw status unresolved and its pid with the start time recorded at spawn. (A pid
 * reused within the same second as the launcher's start would still pass; `lstart` has whole seconds.) */
async function ownTree(l: Launch): Promise<Proc[]> {
  const spawned = await l.root;
  const own = async () => !l.exited() && spawned !== undefined && (await running([spawned])).length === 1;
  if (!(await own())) return [];
  const found = await identify(await treePids(l.child.pid));
  return (await own()) ? found : [];
}
async function exitWithin(l: Launch, timeoutMs: number) {
  return await Promise.race([l.status, sleep(timeoutMs).then(() => undefined)]);
}
let stopping = false;
/** Sends `sig` (`twice`: a second one while the cleanup runs) and checks the launcher exits with `code` from its own
 * trap (not killed by the signal), its coordinator (`pid`) is gone and `port` is free. */
async function stop(label: string, l: Launch, sig: Deno.Signal, code: number, port: number, coordinator: Proc[], twice = false) {
  let second = !twice;
  if (!twice) l.child.kill(sig);
  else {
    // The coordinator is stopped (SIGSTOP) first, so the SIGTERM the cleanup sends it stays pending and the cleanup
    // waits on it: the second signal then lands during the cleanup for certain, however fast a shutdown would be.
    for (const p of await running(coordinator)) Deno.kill(p.pid, "SIGSTOP");
    try {
      l.child.kill(sig);
      const deadline = Date.now() + 10_000;
      while (!l.out().includes("bin/garden-dev: stopping") && Date.now() < deadline) await sleep(100);
      if (l.out().includes("bin/garden-dev: stopping")) {
        l.child.kill(sig);
        // Still running three seconds after the second signal, with the coordinator still held: it was ignored. Had it
        // been deferred instead (a trap that runs once the cleanup's `sleep 1` returns), the launcher would be gone.
        await sleep(3000);
        second = !l.exited();
      }
    } catch {
      // it already exited, so the second signal tested nothing
    } finally {
      for (const p of await running(coordinator)) {
        try {
          Deno.kill(p.pid, "SIGCONT");
        } catch {
          // already gone
        }
      }
    }
  }
  const s = await exitWithin(l, 60_000);
  const gone = pidsOf(await running([...coordinator, ...l.tree.filter((t) => !coordinator.some((c) => c.pid === t.pid))]));
  const still = await listeners(port);
  check(`${label}: ${twice ? `two ${sig}s` : sig} stop${twice ? "" : "s"} the launcher (exit ${code}), its coordinator and the port`, second && s?.code === code && s.signal === null && gone.length === 0 && still.length === 0, `${second ? "" : "the second signal did not land during the cleanup; "}exit ${s?.code} (killed by ${s?.signal ?? "no signal"}), alive [${gone}], listening [${still.join(", ")}]\n${l.out().slice(-800)}`);
}

const scratch = await Deno.makeTempDir({ prefix: "bl-garden-dev-smoke-" });
/** Every launcher still running gets SIGTERM (its own cleanup stops its coordinator). One that has not exited a minute
 * later has its whole tree killed (a SIGKILL to the launcher alone would orphan its coordinator), and any process of a
 * launcher's tree (recorded once it was up) still running after it exited is killed too; either fails the smoke. The
 * scratch directory goes only when nothing is left running, and is printed otherwise. */
async function stopAll() {
  let left: number[] = [];
  for (const l of launches) {
    try {
      l.child.kill("SIGTERM");
    } catch {
      // already exited
    }
    const timedOut = (await exitWithin(l, 60_000)) === undefined;
    // The tree is looked up again only while the launcher is still its own process (ownTree); otherwise only what was
    // recorded while it was up is used.
    const found = timedOut ? await ownTree(l) : [];
    const tree = [...found, ...l.tree.filter((t) => !found.some((f) => f.pid === t.pid))];
    const survivors = await running(tree);
    if (!timedOut && survivors.length === 0) continue;
    for (const p of survivors) {
      try {
        Deno.kill(p.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    await exitWithin(l, 10_000);
    await sleep(500);
    left = [...left, ...(await running(tree)).map((p) => p.pid)];
    check(
      `launcher ${l.child.pid} and its processes stop within a minute of SIGTERM`,
      false,
      `${timedOut ? "the launcher did not exit; " : ""}killed [${pidsOf(survivors)}]`,
    );
  }
  if (left.length === 0) await Deno.remove(scratch, { recursive: true }).catch(() => {});
  else console.log(`still running after SIGKILL: [${left.join(", ")}]; kept ${scratch}`);
}
// A signal to this script skips its finally, so each one runs the same cleanup and exits; the main flow (whose next
// step fails once its launchers stop) waits for it in its finally rather than exiting first.
let shutdown: Promise<void> | undefined;
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  Deno.addSignalListener(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig}: stopping the launchers and removing ${scratch}`);
    shutdown = stopAll().finally(() => Deno.exit(code));
  });
}
try {
  // ---- 1. an automatic directory, with every BL_* trap set in the caller's environment ----
  const p1 = freePort();
  const escaped = `${scratch}/escaped-discovery`;
  const one = launch({ PORT: String(p1), BL_ADMIN_TOKEN: "smoke-admin", BL_GARDEN_ISLAND_TOKEN: "smoke-island", BL_DISCOVERY_DATA_DIR: escaped });
  await until(one, "Press Ctrl-C", 300_000);
  check("1. founds the garden although the caller's shell sets BL_ADMIN_TOKEN", one.out().includes("Founded garden 'commons' on spots"), one.out());
  const dir1 = /Directory: +(\S+)/.exec(one.out())?.[1] ?? "";
  const api1 = `http://127.0.0.1:${p1}`;
  // An island that joins without a garden token is offered day 0, so BL_GARDEN_ISLAND_TOKEN did not reach the coordinator.
  const joined = await fetch(`${api1}/api/islands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adapter: "smoke", userAgent: "garden_dev_smoke", metricsVersion: METRICS_VERSION }),
  }).then((r) => r.json());
  const task = await fetch(`${api1}/api/next?island=${encodeURIComponent(joined.id)}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${joined.token}` },
    body: JSON.stringify({ capabilities: ISLAND_CAPABILITIES }),
  }).then((r) => r.json());
  check("1. an island without a garden token is offered day 0 (BL_GARDEN_ISLAND_TOKEN was dropped)", task?.kind === "run" && task?.spec?.experiment === "commons" && task?.segment?.index === 0, JSON.stringify(task).slice(0, 600));
  check("1. discovery's state is inside the scratch directory, not BL_DISCOVERY_DATA_DIR", dir1 !== "" && (await exists(`${dir1}/discovery`)) && !(await exists(escaped)), `dir ${dir1}`);
  const coordinator1 = await identify(await listeners(p1));

  // ---- 2. the refusals, while 1 runs ----
  const two = launch({ PORT: String(freePort()), GARDEN_DATA_DIR: dir1 });
  const s2 = await exitWithin(two, 60_000);
  check("2. a second launcher on the same data directory refuses (the lock)", s2?.code === 1 && two.out().includes("is locked by another bin/garden-dev") && two.out().includes(" (running)"), two.out());
  const three = launch({ PORT: String(p1) });
  const s3 = await exitWithin(three, 60_000);
  check("2. a launcher on a port something already listens on refuses", s3?.code === 1 && three.out().includes(`already listens on port ${p1}`), three.out());

  await stop("1", one, "SIGINT", 130, p1, coordinator1);
  check("1. the automatic directory is removed", !(await exists(dir1)), dir1);

  // ---- 3. a named directory: found, stop, re-tend with another preset ----
  const named = `${scratch}/named`;
  const p3 = freePort();
  const four = launch({ PORT: String(p3), GARDEN_DATA_DIR: named });
  await until(four, "Press Ctrl-C", 300_000);
  check("3. founds the garden in a named directory", four.out().includes("Founded garden 'commons' on spots"), four.out());
  await stop("3", four, "SIGTERM", 143, p3, await identify(await listeners(p3)), true);
  check("3. the named directory is kept, without its lock", (await exists(`${named}/data`)) && !(await exists(`${named}/.garden-dev.lock`)), named);

  const five = launch({ PORT: String(p3), GARDEN_DATA_DIR: named, GARDEN_PRESET: "wild-storm-large" });
  await until(five, "Press Ctrl-C", 300_000);
  check(
    "3. a garden already there is tended as it is: its own preset and world in the message and the printed stone, with a note about GARDEN_PRESET",
    five.out().includes("already exists") && five.out().includes("(spots, 256x256)") && five.out().includes(`"x":128,"y":128`) && five.out().includes("not GARDEN_PRESET=wild-storm-large"),
    five.out(),
  );
  await stop("3", five, "SIGHUP", 129, p3, await identify(await listeners(p3)));
} catch (e) {
  if (!shutdown) check("the smoke completes without an exception", false, (e as Error).stack ?? String(e));
} finally {
  if (shutdown) await shutdown; // ends in Deno.exit with the signal's code
  if (!stopping) {
    stopping = true;
    await stopAll();
  }
}

console.log(`${ok ? "OK" : "FAILED"}: ${checks} checks, ${ok ? "all passed" : "some failed"}, in ${((performance.now() - T0) / 1000).toFixed(1)} s`);
console.log(`uptime: ${await uptime()}`);
Deno.exit(ok ? 0 : 1);
