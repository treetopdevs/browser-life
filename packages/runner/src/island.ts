// Island client: joins a coordinator, pulls segment tasks, runs or replays
// them on the local GPU and reports end-state digests. Works in browsers
// (worker or page) and in Deno.
//
// Protocol: a private token (from join) authenticates every call; each task
// carries a lease that must accompany heartbeats, uploads and completion. A
// start checkpoint whose digest differs from the predecessor's report is
// rejected, which makes the coordinator recompute that predecessor.

import { encodeCheckpoint, METRICS_VERSION, stateHash, type WorldState } from "@bl/schema";
import { continuationError, decodeArtifact, immigrantError, runExperiment, type HostInfo, type ObserverState, type RunSpec, type Sink } from "./runner.ts";
import { observationDigests } from "./stitch.ts";

/** What this island's code can run, sent as the JSON body of every
 * `POST /api/next`. The coordinator offers segments and verify tasks of a
 * pond experiment (a preset in its `:pond_presets`) only to an island that
 * lists `"ponds-v1"`: older code cannot run the pond cycle
 * (WorldConfig.pondPeriod), and would report a valid predecessor as invalid,
 * its runner throwing on the unknown preset (see Coordinator.Queue's
 * moduledoc). `"ponds-v2"` adds the transition hunt's arms nat and shuf
 * (conditions pond-nat and pond-shuf): older code throws on those arms in
 * the same way, so the coordinator hands a run of either only to an island
 * that lists both. */
export const ISLAND_CAPABILITIES: readonly string[] = ["ponds-v1", "ponds-v2"];

/** Why this island will not run `spec`, or null. A branch run (RunSpec.branch)
 * starts from a source checkpoint that only tools/run.ts reads, from a local
 * bundle: branches are not distributed, the coordinator never builds one, and
 * a task that carries one is refused before anything is fetched. A picked run
 * (RunSpec.picked) takes its donors from a picker or a record that no segment
 * carries, so it is refused the same way. */
export function specRefusal(spec: RunSpec): string | null {
  if ((spec as { branch?: unknown }).branch !== undefined) return "the spec is a branch run (spec.branch); branches are not distributed, so an island does not run them";
  if ((spec as { picked?: unknown }).picked !== undefined) return "the spec is a picked run (spec.picked); picked runs are not distributed, so an island does not run them";
  return null;
}

export interface Task {
  kind: "run" | "verify" | "idle";
  lease?: string;
  segment?: { id: string; run: string; index: number; startStep: number; steps: number };
  spec?: RunSpec;
  startFrom?: string | null;
  startHash?: string | null;
  /** The ring-predecessor's segment (same metapopulation, previous boundary) whose accepted end state this segment imports from, if any (see RunSpec.metapopulation). */
  importFrom?: string | null;
  importHash?: string | null;
}

export interface IslandOptions {
  coordinator: string;
  host: HostInfo;
  log?: (msg: string) => void;
  /** Stop after this many tasks, or when idle (0 = forever). */
  maxTasks?: number;
  idleMs?: number;
  heartbeatMs?: number;
  signal?: AbortSignal;
  /** Reuse an already-joined island (id + bearer token) instead of calling
   * `/api/islands` again. The caller is responsible for having confirmed the
   * coordinator still accepts it (see `decideRejoin`); an invalid identity
   * fails the same way any other authentication error would. */
  identity?: { id: string; token: string };
  /** Called once this island's id/token are known, whether from a fresh join
   * or from `identity` above -- lets the caller remember them for a rejoin
   * after e.g. a page reload. */
  onJoined?: (identity: { id: string; token: string }) => void;
}

/** Combines `signal` with a `timeoutMs` bound, using `AbortSignal.any`/
 * `AbortSignal.timeout` where both exist. Review: Chrome shipped WebGPU in
 * 113, three versions before `AbortSignal.any` (116) -- calling it
 * unconditionally throws a `TypeError` *before* `fetch` is ever invoked on
 * such an engine, which an outer `catch { return null; }` (see
 * `probeIslandIdentity`) then indistinguishably reports as a network
 * failure: no request is made, ever, and a remembered identity can never be
 * reconfirmed. The fallback reimplements the combination by hand with a
 * plain `AbortController` + `setTimeout`, cleaning up (clearing the timer,
 * dropping the listener) as soon as either side settles so neither lingers
 * past that point. */
export function timeoutSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }
  const ctrl = new AbortController();
  const onSignalAbort = () => ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  ctrl.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onSignalAbort);
    },
    { once: true },
  );
  if (signal.aborted) ctrl.abort();
  else signal.addEventListener("abort", onSignalAbort, { once: true });
  return ctrl.signal;
}

/** One authenticated `GET /api/islands/me` attempt: the probe an
 * auto-rejoining island uses to check a remembered identity before reusing
 * it (see `decideRejoin`/`resolveRejoin`). Bounded by `timeoutMs` (a few
 * seconds) combined with the caller's own cancellation `signal` via
 * `timeoutSignal`. Resolves to the HTTP status, or `null` on any failure --
 * a timeout, a cancel, or a genuine network error are all equally
 * inconclusive to `decideRejoin`, which is exactly why they're folded
 * together here instead of being told apart. */
export async function probeIslandIdentity(coordinator: string, id: string, token: string, signal: AbortSignal, timeoutMs = 5000): Promise<number | null> {
  try {
    const base = coordinator.replace(/\/$/, "");
    const res = await fetch(`${base}/api/islands/me?island=${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: timeoutSignal(signal, timeoutMs),
    });
    if (res.status !== 200) return res.status;
    // The coordinator assigns work by the metrics version recorded at join
    // (absent: joined before versions existed, i.e. 1). A registration made
    // under another version -- e.g. by this page before the coordinator was
    // upgraded -- would idle on current work, so report it as unusable.
    const info = (await res.json()) as { metrics_version?: unknown };
    const registered = typeof info?.metrics_version === "number" ? info.metrics_version : 1;
    return registered === METRICS_VERSION ? 200 : STALE_REGISTRATION;
  } catch {
    return null;
  }
}

/** Synthetic probe status (HTTP 426 Upgrade Required): the identity
 * authenticates but was registered under a different metrics version. */
export const STALE_REGISTRATION = 426;

/** What one probe of `GET /api/islands/me` establishes about a remembered
 * identity: `"reuse"` (200, still authenticates under the current metrics
 * version), `"fresh"` (401, the coordinator no longer recognizes it --
 * unknown id, or a restarted coordinator with a fresh data dir -- or
 * `STALE_REGISTRATION`, registered under another metrics version), or
 * `"retry"` for everything else
 * (network failure, a 404 from a coordinator too old to have this route, a
 * 5xx e.g. mid hot-reload) -- none of those say anything about whether the
 * identity itself is valid, so they're worth another attempt rather than a
 * guess in either direction. */
export type ProbeDecision = "reuse" | "fresh" | "retry";

/** That endpoint is a plain read (unlike `/api/next`, which claims a task),
 * so a probe -- retried or abandoned -- never strands a task assignment
 * behind a 10-minute lease. `probeStatus` is the HTTP status, or `null` if
 * the request itself failed (offline, DNS, ...). */
export function decideRejoin(probeStatus: number | null): ProbeDecision {
  if (probeStatus === 200) return "reuse";
  if (probeStatus === 401 || probeStatus === STALE_REGISTRATION) return "fresh";
  return "retry";
}

export type RejoinResult = "reuse" | "fresh" | "wait" | "cancelled";

export interface ResolveRejoinOptions {
  /** Makes one probe attempt; returns the HTTP status, or `null` on failure
   * (including the probe's own timeout, if any -- see `decideRejoin`, which
   * treats that the same as any other inconclusive result). */
  probe(): Promise<number | null>;
  /** Attempts beyond the first before giving up (default 3, so 4 tries total). */
  retries?: number;
  /** Delay before retry number `attempt` (0-based); default exponential from 500ms. */
  backoffMs?(attempt: number): number;
  sleep?(ms: number): Promise<void>;
  /** Review: a probe with no bound on its own duration (no timeout/abort on
   * the underlying fetch) can hang forever, trapping the page in a disabled
   * "starting" state with no way out. Aborting `signal` cancels the whole
   * resume attempt -- no further probes, and a backoff wait already in
   * progress resolves immediately rather than running out its delay --
   * without ever reaching a `"reuse"`/`"fresh"` decision that would let the
   * caller proceed into the runner. The caller is responsible for also
   * threading `signal` into `probe` itself (e.g. via `AbortSignal.any`), so
   * an in-flight fetch is actually aborted, not just ignored once it
   * eventually settles. */
  signal?: AbortSignal;
}

/** Resolves when `sleep(ms)` does, or as soon as `signal` aborts, whichever
 * is first -- without waiting out the rest of a long backoff delay just
 * because it's already started. Never rejects; the caller checks
 * `signal.aborted` afterwards to tell which one happened. */
function abortableWait(sleep: (ms: number) => Promise<void>, ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    void sleep(ms).then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

/** Turns a single, possibly-inconclusive probe into a final decision: keeps
 * probing (with backoff) while `decideRejoin` says `"retry"`, gives up as
 * `"wait"` once out of attempts (so a flaky network or an old/reloading
 * coordinator doesn't get treated as either a confirmed reuse or a reason to
 * mint a second island for the same tab), and reports `"cancelled"` the
 * moment `opts.signal` aborts, at whichever point that happens to fall. */
export async function resolveRejoin(opts: ResolveRejoinOptions): Promise<RejoinResult> {
  const retries = opts.retries ?? 3;
  const backoffMs = opts.backoffMs ?? ((attempt: number) => 500 * 2 ** attempt);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { signal } = opts;

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) return "cancelled";
    const decision = decideRejoin(await opts.probe());
    if (signal?.aborted) return "cancelled";
    if (decision !== "retry") return decision;
    if (attempt >= retries) return "wait";
    await abortableWait(sleep, backoffMs(attempt), signal);
    if (signal?.aborted) return "cancelled";
  }
}

/** Collects bundle files in memory for upload after the segment finishes. */
class MemorySink implements Sink {
  readonly files = new Map<string, string>();
  readonly bytes = new Map<string, Uint8Array>();
  async writeText(p: string, t: string) {
    this.files.set(p, t);
  }
  async appendText(p: string, t: string) {
    this.files.set(p, (this.files.get(p) ?? "") + t);
  }
  async writeBytes(p: string, b: Uint8Array) {
    this.bytes.set(p, b);
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function runIsland(device: GPUDevice, opt: IslandOptions): Promise<number> {
  const log = opt.log ?? (() => {});
  const base = opt.coordinator.replace(/\/$/, "");
  let id: string, token: string;
  if (opt.identity) {
    ({ id, token } = opt.identity);
  } else {
    const joined = await fetch(`${base}/api/islands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The coordinator only offers a segment to an island whose declared
      // metrics version matches the segment's experiment (and checks the
      // uploaded manifest's version again at completion -- see
      // Coordinator.Queue's moduledoc).
      body: JSON.stringify({ adapter: opt.host.adapter, userAgent: opt.host.host, metricsVersion: METRICS_VERSION }),
    });
    if (!joined.ok) throw new Error(`join: ${joined.status} ${await joined.text()}`);
    ({ id, token } = (await joined.json()) as { id: string; token: string });
  }
  opt.onJoined?.({ id, token });
  const q = (extra = "") => `island=${encodeURIComponent(id)}${extra}`;
  const call = async <T>(path: string, init: RequestInit = {}, raw = false): Promise<T> => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
    if (!res.ok) throw new HttpError(res.status, `${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("json") && !raw ? res.json() : res.arrayBuffer()) as Promise<T>;
  };
  const postJson = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  log(opt.identity ? `resumed as ${id}` : `joined as ${id}`);
  let done = 0;
  let waiting = false;
  while (!opt.signal?.aborted && (!opt.maxTasks || done < opt.maxTasks)) {
    const task = await postJson<Task>(`/api/next?${q()}`, { capabilities: ISLAND_CAPABILITIES });
    if (task.kind === "idle" || !task.segment || !task.spec || !task.lease) {
      if (opt.maxTasks) break;
      if (!opt.signal?.aborted && !waiting) {
        log("connected; waiting for work. No experiment segment is available right now; checking again shortly");
        waiting = true;
      }
      // Stop may have aborted while `/next` was in flight; don't run a full
      // idle wait just to discover that on the next loop check.
      if (!opt.signal?.aborted)
        await new Promise<void>((r) => {
          const t = setTimeout(wake, opt.idleMs ?? 10_000);
          function wake() {
            clearTimeout(t);
            opt.signal?.removeEventListener("abort", wake);
            r();
          }
          opt.signal?.addEventListener("abort", wake);
        });
      continue;
    }
    waiting = false;
    const seg = task.segment;
    const lease = task.lease;
    const refusal = specRefusal(task.spec);
    if (refusal) throw new Error(`refusing ${seg.run} #${seg.index}: ${refusal}`);
    log(`${task.kind} ${seg.run} #${seg.index} (${seg.steps} steps from t=${seg.startStep})`);
    const beat = setInterval(() => {
      postJson(`/api/segments/${seg.id}/heartbeat?${q()}`, { lease }).catch((e) => log(`  heartbeat: ${e.message}`));
    }, opt.heartbeatMs ?? 60_000);
    try {
      let start: WorldState | undefined;
      let observer: ObserverState | undefined;
      if (task.startFrom) {
        // Every defect of the predecessor's artifact (undecodable or invalid
        // state, wrong step or digest, malformed or mismatched observer)
        // rejects the predecessor for recomputation instead of failing this
        // island; only transport errors propagate. One artifact, one fetch:
        // the checkpoint and observer sections decode together.
        const bytes = new Uint8Array(await call<ArrayBuffer>(`/api/segments/${task.startFrom}/start?${q()}`));
        let bad: string | null = null;
        try {
          const decoded = decodeArtifact(bytes);
          const digest = stateHash(decoded.state);
          if (decoded.state.step !== seg.startStep || (task.startHash && digest !== task.startHash))
            bad = `start checkpoint t=${decoded.state.step} digest ${digest}, expected t=${seg.startStep} digest ${task.startHash}`;
          else {
            bad = continuationError(task.spec, decoded.state, decoded.observer);
            if (!bad) {
              start = decoded.state;
              observer = decoded.observer;
            }
          }
        } catch (e) {
          bad = `invalid predecessor artifact: ${(e as Error).message}`;
        }
        if (bad) {
          log(`  rejecting: ${bad}`);
          await postJson(`/api/segments/${seg.id}/reject?${q()}`, { lease, reason: bad.slice(0, 500), predecessor: "own" });
          continue;
        }
      }
      let immigrant: WorldState | undefined;
      if (task.importFrom) {
        // Same shape as the startFrom block above, but for a metapopulation's
        // cross-run exchange (see RunSpec.metapopulation): every defect
        // rejects the *ring-predecessor's* segment (a different run) for
        // recomputation, disambiguated from a bad own-predecessor rejection
        // by `predecessor: "import"` (see Coordinator.Queue.reject/5).
        const bytes = new Uint8Array(await call<ArrayBuffer>(`/api/segments/${task.importFrom}/start?${q()}`));
        let bad: string | null = null;
        try {
          const decoded = decodeArtifact(bytes);
          const digest = stateHash(decoded.state);
          if (task.importHash && digest !== task.importHash) bad = `import checkpoint t=${decoded.state.step} digest ${digest}, expected digest ${task.importHash}`;
          else {
            bad = immigrantError(task.spec, seg.startStep, decoded.state);
            if (!bad) immigrant = decoded.state;
          }
        } catch (e) {
          bad = `invalid import predecessor artifact: ${(e as Error).message}`;
        }
        if (bad) {
          log(`  rejecting import: ${bad}`);
          await postJson(`/api/segments/${seg.id}/reject?${q()}`, { lease, reason: bad.slice(0, 500), predecessor: "import" });
          continue;
        }
      }
      const sink = new MemorySink();
      const out = await runExperiment(device, task.spec, sink, opt.host, (m) => log(`  ${m}`), { start, observer, immigrant, keepFinal: task.kind === "run" });
      const lq = q(`&lease=${encodeURIComponent(lease)}`);
      if (task.kind === "run") {
        // Encode once, PUT once: the checkpoint and observer state travel as
        // one artifact. Verify attempts upload nothing — they replay locally
        // and report the digest they computed for the coordinator to compare.
        const octet = { "content-type": "application/octet-stream" };
        await call(`/api/segments/${seg.id}/checkpoint?${lq}`, { method: "PUT", headers: octet, body: encodeCheckpoint(out.final!, out.observer) as BodyInit });
        for (const [name, text] of sink.files) {
          const safe = name.replace(/[^a-z0-9_.-]/gi, "-").toLowerCase();
          await call(`/api/segments/${seg.id}/files/${safe}?${lq}`, { method: "PUT", headers: octet, body: text });
        }
      }
      const r = await postJson<{ status: string }>(`/api/segments/${seg.id}/complete?${q()}`, {
        kind: task.kind,
        lease,
        // Physics and observer together (see `artifactDigest`), replacing the
        // old separate endHash/observerHash pair with one end-to-end digest.
        endHash: out.summary.finalHash,
        summary: out.summary,
        // Only a verify attempt's regenerated files are worth reporting: a
        // run attempt's uploads are already digested server-side from the
        // bytes it PUT, so there is nothing this would add for them (see
        // `Coordinator.Segment.complete_verify/5`).
        ...(task.kind === "verify" ? { observationDigests: await observationDigests(sink.files) } : {}),
      });
      log(`  ${task.kind} complete: ${out.summary.finalHash} → ${r.status}`);
      done++;
    } catch (e) {
      // A lost lease (reassigned after a long stall, or the run was blocked) is not fatal.
      if (e instanceof HttpError && e.status === 409) log(`  task abandoned: ${e.message}`);
      else throw e;
    } finally {
      clearInterval(beat);
    }
  }
  return done;
}
