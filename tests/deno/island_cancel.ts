// Island cancellation on native WebGPU (docs/island-cancel-2026-10-18.md), against an in-process fake coordinator
// with a one-second lease that, like Coordinator.Segment.reclaim, is reclaimed only on POST /api/next (the real
// coordinator's lease_ms has no runtime setting; its reclaim path is apps/coordinator's queue_test.exs to show).
//   1. Island A is aborted on its first progress line, mid-run: it resolves 0 promptly, and the coordinator saw no
//      upload and no completion from it.
//   2. After the lease lapses, island B, on the same device, is offered the same segment, completes it, and reports
//      the digest a direct unaborted runExperiment of the same spec gives.
//   3. The headless island (tools/island.ts), sent SIGINT mid-run, uploads and completes nothing and exits 130 (when
//      the signal lands only after the child's run has ended, as on an overloaded machine, the mid-run checks are
//      reported as skipped and only the exit code is checked).
//   4. tools/island.ts with its complete held open by the coordinator: one SIGTERM does not abort a complete already
//      sent (the island keeps waiting), and a second SIGTERM, sent once the child has acknowledged the first, exits at
//      once with 143.
//   deno run -A tests/deno/island_cancel.ts
// Exits 1 on any failure; prints `uptime` beside the result, since the timings depend on the machine's load.
import { requestDevice } from "@bl/sim-gpu";
import { runExperiment, runIsland, specConfig, type RunSpec, type Sink } from "@bl/runner";

const LEASE_MS = 1000;
const spec: RunSpec = { experiment: "cancel", presetId: "spots", condition: "treatment", seed: 7, steps: 1000, censusEvery: 10, deepEvery: 100, checkpointEvery: 0, overrides: { tileW: 32, tileH: 32, kernelRadius: 4 } };
/** Part 4's segment: short, since only its complete matters. */
const shortSpec: RunSpec = { ...spec, steps: 100 };

type Attempt = { island: string; lease: string; status: "running" | "abandoned" | "done"; beatAt: number };
type Segment = { id: string; index: number; spec: RunSpec; status: "pending" | "assigned" | "done"; attempts: Attempt[]; endHash?: string };
const segments: Segment[] = [
  { id: "seg-1", index: 0, spec, status: "pending", attempts: [] },
  { id: "seg-2", index: 1, spec, status: "pending", attempts: [] },
  { id: "seg-3", index: 2, spec: shortSpec, status: "pending", attempts: [] },
];
/** Which segments /next may offer (part 4 narrows it to seg-3, so a lapsed seg-2 is not offered first). */
let offer: (s: Segment) => boolean = (s) => s.id !== "seg-3";
/** Part 4: seg-3's complete is held until released, and `held` resolves once it arrives. */
const completeHold = { held: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
/** Every record-changing request, by island: PUTs, completes, rejects, fails. */
const writes: { island: string; key: string }[] = [];
let islands = 0;
let leases = 0;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
  const url = new URL(req.url);
  const island = url.searchParams.get("island") ?? "";
  const key = `${req.method} ${url.pathname}`;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : (await req.arrayBuffer(), {});
  if (key === "POST /api/islands") return json({ id: `isl-${++islands}`, token: `tok-${islands}` });
  if (key === "POST /api/next") {
    const now = Date.now();
    for (const s of segments) {
      const a = s.attempts.at(-1);
      if (s.status === "assigned" && a && now - a.beatAt > LEASE_MS) {
        a.status = "abandoned";
        s.status = "pending";
      }
    }
    const s = segments.find((x) => x.status === "pending" && offer(x));
    if (!s) return json({ kind: "idle" });
    const lease = `lease-${++leases}`;
    s.status = "assigned";
    s.attempts.push({ island, lease, status: "running", beatAt: now });
    return json({ kind: "run", lease, segment: { id: s.id, run: "cancel", index: s.index, startStep: 0, steps: s.spec.steps }, spec: s.spec, startFrom: null, startHash: null });
  }
  const m = url.pathname.match(/^\/api\/segments\/(seg-\d)\/(heartbeat|checkpoint|files\/[^/]+|complete|reject|fail)$/);
  const s = m && segments.find((x) => x.id === m[1]);
  if (!m || !s) return json({ error: `unexpected ${key}` }, 404);
  const lease = (body as { lease?: string }).lease ?? url.searchParams.get("lease");
  const a = s.attempts.at(-1);
  const live = s.status === "assigned" && a && a.lease === lease && a.island === island;
  if (m[2] !== "heartbeat") writes.push({ island, key: `${req.method} ${m[2].replace(/\/.*/, "")}` });
  if (!live) return json({ error: "segment not assigned to this island/lease" }, 409);
  if (m[2] === "heartbeat") a!.beatAt = Date.now();
  if (m[2] === "complete") {
    if (s.id === "seg-3") {
      completeHold.held.resolve();
      await completeHold.release.promise;
    }
    s.status = "done";
    a!.status = "done";
    s.endHash = (body as { endHash?: string }).endHash;
    return json({ status: "done" });
  }
  return json({ ok: true });
});
const coord = `http://127.0.0.1:${server.addr.port}`;

let ok = true;
const check = (name: string, pass: boolean, detail = "") => {
  ok &&= pass;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
/** The tools/island.ts child running now, if any: the guard kills it rather than leaving it on the GPU. */
let child: Deno.ChildProcess | undefined;
const guard = setTimeout(() => {
  console.log("FAIL timed out after 15 minutes");
  try {
    child?.kill("SIGKILL");
  } catch {
    // already gone
  }
  Deno.exit(1);
}, 15 * 60_000);

/** Spawns tools/island.ts against the fake (without touching deno.lock), calling `onLine` on each stdout line. Stderr is
 * drained alongside stdout, so a chatty child cannot fill its pipe and stall. */
function spawnIsland(label: string, onLine: (line: string, proc: Deno.ChildProcess) => void) {
  const proc = new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-lock", "-A", "tools/island.ts", "--coordinator", coord, "--label", label],
    cwd: new URL("../../", import.meta.url).pathname,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  child = proc;
  const err = new Response(proc.stderr).text();
  const out: string[] = [];
  const lines = (async () => {
    const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const parts = buf.split("\n");
      buf = parts.pop()!;
      for (const line of parts) {
        out.push(line);
        onLine(line, proc);
      }
    }
  })();
  return { proc, out, err, lines };
}

class Mem implements Sink {
  files = new Map<string, string>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes() {}
}
const host = { host: "island_cancel", adapter: "test" };
const device = await requestDevice(navigator.gpu, specConfig(spec));

// The digest an unaborted run of the spec gives, and how long it takes here.
let t = performance.now();
const direct = await runExperiment(device, spec, new Mem(), host, () => {}, { keepFinal: true });
const fullMs = performance.now() - t;
console.log(`direct run: ${spec.steps} steps in ${(fullMs / 1000).toFixed(1)} s, ${direct.summary.finalHash}`);

// 1. Island A, aborted on its first progress line (t=200, census 20 of 100).
const stopA = new AbortController();
let abortedAt = 0;
const logA: string[] = [];
const doneA = await runIsland(device, {
  coordinator: coord,
  host,
  signal: stopA.signal,
  heartbeatMs: 200,
  idleMs: 50,
  log: (m) => {
    logA.push(m);
    if (!abortedAt && /^\s+t=\d+/.test(m)) {
      abortedAt = performance.now();
      stopA.abort();
    }
  },
});
const latencyMs = performance.now() - abortedAt;
const seg1 = segments[0];
check("A was aborted mid-run", abortedAt > 0 && !!logA.find((m) => /^\s+t=200 /.test(m)));
// The proof that the run itself stopped (not only that nothing was uploaded after it): the abort lands inside the
// t=200 progress callback, and an island whose run ignored the signal would go on to log t=400 and later.
check("A's run logged no progress after the abort", logA.filter((m) => /^\s+t=\d+/.test(m)).length === 1, logA.filter((m) => /^\s+t=\d+/.test(m)).join(" | "));
check("A resolves 0", doneA === 0, String(doneA));
check("A resolved promptly after the abort", latencyMs < Math.max(10_000, fullMs / 2), `${latencyMs.toFixed(0)} ms (full run ${fullMs.toFixed(0)} ms)`);
check("A made no upload, completion, reject or fail", !writes.some((w) => w.island === "isl-1"), JSON.stringify(writes));
check("A logged that it left the task", logA.includes("stopped: left cancel #0; the coordinator offers it again once its lease lapses"));
check("seg-1 is still assigned to A (its lease not yet reclaimed)", seg1.status === "assigned" && seg1.attempts.length === 1);

// 2. Island B, on the same device, once A's lease has lapsed.
await new Promise((r) => setTimeout(r, LEASE_MS + 500));
const logB: string[] = [];
t = performance.now();
const doneB = await runIsland(device, { coordinator: coord, host, maxTasks: 1, heartbeatMs: 200, idleMs: 50, log: (m) => logB.push(m) });
check("B completes one task", doneB === 1, String(doneB));
check("B was given A's segment after the lease lapsed", seg1.attempts.length === 2 && seg1.attempts[0].status === "abandoned" && seg1.attempts[1].island === "isl-2" && seg1.status === "done", JSON.stringify(seg1.attempts.map((a) => [a.island, a.status])));
check("B's digest equals the direct unaborted run's", seg1.endHash === direct.summary.finalHash, `${seg1.endHash} vs ${direct.summary.finalHash}`);
device.destroy();

// 3. tools/island.ts, sent SIGINT mid-run: exits 130 and completes nothing (it takes seg-2).
if (Deno.build.os === "windows") console.log("SKIP signal checks (Windows)");
else {
  let sent = false;
  const c = spawnIsland("sigint", (line, proc) => {
    if (!sent && /^\s+t=\d+/.test(line)) {
      sent = true;
      proc.kill("SIGINT");
    }
  });
  await c.lines;
  const status = await c.proc.status;
  const err = await c.err;
  child = undefined;
  // The child's stdout is in its own order: where its "SIGINT: stopping" line falls among its progress lines says
  // when the signal actually landed. On a loaded machine the parent can be descheduled after reading the first
  // progress line while the child runs on; a signal that lands after the child's last progress line (t=1000) finds
  // the run already over, and its upload and complete are then correct, not a failure: that case is reported as
  // inconclusive (part 1 has proved the mid-run stop in process), and only the exit code is checked.
  const ack = c.out.findIndex((l) => /^SIGINT: stopping: /.test(l));
  const progress = (from: number, to: number) => c.out.slice(from, to).filter((l) => /^\s+t=\d+/.test(l));
  const late = ack >= 0 && progress(0, ack).some((l) => /^\s+t=1000 /.test(l));
  check("tools/island.ts was interrupted", sent && ack >= 0, c.out.slice(-4).join(" | "));
  check("tools/island.ts exits 130 after SIGINT", status.code === 130, `code ${status.code}${err ? `; stderr ${err.slice(0, 300)}` : ""}`);
  if (late) console.log("SKIP mid-run SIGINT checks: the signal landed after the child's run had ended (machine too loaded); part 1 covers the mid-run stop");
  else {
    // The chunk in flight when the signal lands may still log its census; none after that.
    check("tools/island.ts logged at most one progress line after SIGINT", progress(ack + 1, c.out.length).length <= 1, progress(ack + 1, c.out.length).join(" | "));
    check("tools/island.ts made no upload or completion", !writes.some((w) => w.island === "isl-3"), JSON.stringify(writes.filter((w) => w.island === "isl-3")));
    check("tools/island.ts reported its stop", c.out.some((l) => /stopped: left cancel #1/.test(l)) && c.out.some((l) => /island finished 0 tasks/.test(l)), c.out.slice(-4).join(" | "));
    check("seg-2 was left assigned, not completed", segments[1].status === "assigned");
  }

  // 4. tools/island.ts, its complete held open: the first SIGTERM does not abort the complete, the second exits 143.
  offer = (s) => s.id === "seg-3";
  // The child's own "SIGTERM: stopping" line acknowledges the first signal: the second is sent only after it, so the
  // two cannot coalesce into one pending signal on a loaded machine.
  const firstAck = Promise.withResolvers<void>();
  const d = spawnIsland("sigterm", (line) => {
    if (/^SIGTERM: stopping: /.test(line)) firstAck.resolve();
  });
  const exited = d.proc.status;
  const settled = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
  // A child that ignores the signals is killed and reaped here, within a bound, rather than left to the global guard.
  const reap = async () => {
    try {
      d.proc.kill("SIGKILL");
    } catch {
      // already exited
    }
    completeHold.release.resolve();
    await settled(exited, 10_000);
  };
  try {
    await completeHold.held.promise;
    d.proc.kill("SIGTERM");
    const acked = await settled(firstAck.promise, 60_000);
    check("tools/island.ts acknowledged the first SIGTERM", acked, d.out.slice(-4).join(" | "));
    if (!acked) await reap();
    else {
      const exitedOnFirst = await settled(exited, 1500);
      check("after one SIGTERM, tools/island.ts still waits on the complete it sent", !exitedOnFirst);
      const t2 = performance.now();
      if (!exitedOnFirst) d.proc.kill("SIGTERM");
      const exitedOnSecond = await settled(exited, 5000);
      const quitMs = performance.now() - t2;
      check("a second SIGTERM exits at once", exitedOnSecond, `${quitMs.toFixed(0)} ms`);
      if (!exitedOnSecond) await reap();
      completeHold.release.resolve();
      const status4 = await exited;
      await d.lines;
      const err4 = await d.err;
      check("tools/island.ts exits 143 after SIGTERM", status4.code === 143, `code ${status4.code}${err4 ? `; stderr ${err4.slice(0, 300)}` : ""}`);
      check("tools/island.ts printed the stop message on SIGTERM", d.out.some((l) => /^SIGTERM: stopping: /.test(l)), d.out.slice(-4).join(" | "));
    }
  } finally {
    completeHold.release.resolve();
    child = undefined;
  }
}
clearTimeout(guard);
completeHold.release.resolve();
await server.shutdown();
// Best effort: `uptime` is not on every platform (native Windows).
let up = "unavailable";
try {
  up = new TextDecoder().decode((await new Deno.Command("uptime", { stdout: "piped" }).output()).stdout).trim();
} catch {
  // keep "unavailable"
}
console.log(`${ok ? "PASS" : "FAIL"} island_cancel (uptime: ${up})`);
Deno.exit(ok ? 0 : 1);
