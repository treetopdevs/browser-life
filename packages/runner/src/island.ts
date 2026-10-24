// Island client: joins a coordinator, pulls segment tasks, runs or replays
// them on the local GPU and reports end-state digests. Works in browsers
// (worker or page) and in Deno.
//
// Protocol: a private token (from join) authenticates every call; each task
// carries a lease that must accompany heartbeats, uploads and completion. A
// start checkpoint whose digest differs from the predecessor's report is
// rejected, which makes the coordinator recompute that predecessor. A task
// this island cannot run as given (a scheduled feed the world refuses, see
// the catch in `runIsland`) is reported failed under its lease, which stops
// the run there instead of offering the segment to the next island.
//
// Cancellation (IslandOptions.signal, docs/island-cancel-2026-10-18.md): the
// island stops local work before requesting a bounded best-effort leave.
// The join, `/next`, downloads, heartbeats and uploads
// are aborted with the signal, the run stops at its next census-chunk boundary
// (RunOptions.signal), and no PUT, reject, fail, complete or heartbeat leaves
// after the abort. Leave releases unfinished leases; if it fails, they expire
// normally. Each task request is checked against the signal immediately before it
// is sent, after any log callback (which may itself stop the island). A
// complete, reject or fail already sent is waited for, never aborted:
// the coordinator applies each atomically, so nothing is ever torn. runIsland
// then leaves and resolves with the tasks completed; an abort never makes it reject.

import { encodeCheckpoint, METRICS_VERSION, stateHash, type WorldState } from "@bl/schema";
import { continuationError, decodeArtifact, immigrantError, runExperiment, sunContinuationError, type HostInfo, type ObserverState, type RunSpec, type Sink } from "./runner.ts";
import { InterventionError } from "./interventions.ts";
import { observationDigests } from "./stitch.ts";
import { IslandBackoff, islandDelay } from "./island-backoff.ts";

/** What this island's code can run, sent as the JSON body of every
 * `POST /api/next`. The coordinator offers segments and verify tasks of a
 * pond experiment (a preset in its `:pond_presets`) only to an island that
 * lists `"ponds-v1"`: older code cannot run the pond cycle
 * (WorldConfig.pondPeriod), and would report a valid predecessor as invalid,
 * its runner throwing on the unknown preset (see Coordinator.Queue's
 * moduledoc). `"ponds-v2"` adds the transition hunt's arms nat and shuf
 * (conditions pond-nat and pond-shuf): older code throws on those arms in
 * the same way, so the coordinator hands a run of either only to an island
 * that lists both. `"interventions-v1"` is scheduled interventions
 * (RunSpec.interventions, interventions.ts): the coordinator carries an
 * experiment's lesions and feeds whole in every segment's task spec, and
 * hands such a segment, run or verify, only to an island that lists this.
 * Older code knows no such field: it would run the segment clean and report
 * a digest that disagrees with every capable island's, a divergence with no
 * real disagreement in it. `"breed-v1"` is the breeder (WorldConfig.pondScore,
 * docs/sandbox-wild.md): the conditions pond-breed-<score>, pond-mass-<score>
 * and pond-drift-<score>, and every run of the `breeder` preset, whose
 * `treatment` is the breed arm. The coordinator asks for it in addition to
 * `"ponds-v1"`, never instead of it. Older code has none of those condition
 * ids nor the score columns, so it throws on them, and on a continuation would
 * report a valid predecessor as invalid; the controls are gated as well as the
 * arm for that reason. Only the rule's own donors are distributed: a picked or
 * pressured run is still refused below (docs/archipelago-breed-2026-10-18.md).
 * `"sun-v1"` is a schedule holding a sun (kind "sun", docs/garden-sun-2026-10-18.md), asked for in addition to
 * `"interventions-v1"`: code without it refuses the kind, or (older still) would run the segment under the world's own light. */
export const ISLAND_CAPABILITIES: readonly string[] = ["ponds-v1", "ponds-v2", "interventions-v1", "breed-v1", "sun-v1"];

/** Why this island will not run `spec`, or null. A branch run (RunSpec.branch)
 * starts from a source checkpoint that only tools/run.ts reads, from a local
 * bundle: branches are not distributed, the coordinator never builds one, and
 * a task that carries one is refused before anything is fetched. A picked run
 * (RunSpec.picked) takes its donors from a picker or a record that no segment
 * carries, so it is refused the same way, and so is a pressured run
 * (RunSpec.pressures, the lab's pond keeper: a picked run too). A run with scheduled interventions
 * (RunSpec.interventions) is not refused: the coordinator carries the
 * schedule (capability `"interventions-v1"` above), `runExperiment` applies
 * only the entries this segment owns, and its interventions.jsonl is a
 * verified segment file that stitchRun joins. */
export function specRefusal(spec: RunSpec): string | null {
  if ((spec as { branch?: unknown }).branch !== undefined) return "the spec is a branch run (spec.branch); branches are not distributed, so an island does not run them";
  if ((spec as { picked?: unknown }).picked !== undefined) return "the spec is a picked run (spec.picked); picked runs are not distributed, so an island does not run them";
  if ((spec as { pressures?: unknown }).pressures !== undefined) return "the spec carries pressures (spec.pressures); a pressured run is not distributed, so an island does not run it";
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
  /** Stops the island (see the header comment): resolves with the tasks
   * completed so far, requesting release of any task still in hand. */
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
  /** The coordinator's garden island token (its `BL_GARDEN_ISLAND_TOKEN`),
   * when it has one: a coordinator with that token set offers a garden's days
   * only to islands that showed it at join (Coordinator.Queue's moduledoc).
   * Sent as `gardenToken` in the `POST /api/islands` body and nowhere else
   * (never in a URL, a header, `/api/next` or a log line); an empty string is
   * no token. A resumed `identity` makes no join and needs none: the
   * coordinator remembers on the island's record that it showed the token.
   * A fresh join (the coordinator forgot the island, or the metrics version
   * changed) needs it again. A join that carries it follows no redirect, and
   * its error never repeats the response body (`joinFailure`, `joinAnswer`).
   * See `gardenTokenFrom`, `gardenTokenFromHash` and `gardenTokenFor` for how
   * the CLI and the browser page obtain it (docs/garden-hardening-2026-10-18.md). */
  gardenToken?: string;
}

/** The headless island's garden token: the `--garden-token` flag, else the
 * `BL_ISLAND_GARDEN_TOKEN` environment variable; an empty value is no token.
 * The variable is deliberately not the coordinator's `BL_GARDEN_ISLAND_TOKEN`,
 * so a shell that runs a coordinator does not hand its token to whatever
 * coordinator an island started there is pointed at. */
export function gardenTokenFrom(flag?: string | null, env?: string | null): string | undefined {
  if (typeof flag === "string" && flag !== "") return flag;
  if (typeof flag !== "string" && typeof env === "string" && env !== "") return env;
  return undefined;
}

/** Reads `garden-token=<t>` from a URL fragment (`location.hash`, with or
 * without its `#`) and returns it with the fragment that remains once it is
 * removed (every other `&`-separated part kept byte for byte, in order; `""`
 * when nothing remains), and `found` when any part's key, percent-decoded, is
 * `garden-token` (even an empty one, or one spelt `%67arden-token`): the page
 * strips the fragment whenever `found`, not by looking for the literal name.
 * A fragment never reaches a server or a `Referer`, so the token never lands
 * in a request log. The value is percent-decoded and nothing else: a `+` stays
 * a `+` (a token is not form data), and a value that does not decode is taken
 * as written. The last non-empty `garden-token` wins; an empty one is no token. */
export function gardenTokenFromHash(hash: string): { token?: string; rest: string; found: boolean } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") return { rest: "", found: false };
  const decode = (v: string) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  let token: string | undefined;
  let found = false;
  const kept: string[] = [];
  for (const part of raw.split("&")) {
    const eq = part.indexOf("=");
    const key = decode(eq < 0 ? part : part.slice(0, eq));
    if (key !== "garden-token") {
      kept.push(part);
      continue;
    }
    found = true;
    const value = eq < 0 ? "" : decode(part.slice(eq + 1));
    if (value !== "") token = value;
  }
  if (!found) return { rest: `#${raw}`, found };
  const rest = kept.filter((p) => p !== "").join("&");
  return { token, rest: rest ? `#${rest}` : "", found };
}

/** The headless island's garden token for `coordinator`: the token only over
 * https or to a loopback host (`localhost`, `*.localhost`, `127.*`, `[::1]`),
 * so it never crosses a network in clear text. */
export function gardenTokenForCoordinator(coordinator: string, token?: string): string | undefined {
  if (!token) return undefined;
  try {
    const u = new URL(coordinator);
    if (u.protocol === "https:") return token;
    const h = u.hostname;
    const loopback = h === "localhost" || h.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(h) || h === "[::1]";
    return u.protocol === "http:" && loopback ? token : undefined;
  } catch {
    return undefined;
  }
}

/** The garden token to send to `coordinator` from a page served at
 * `pageOrigin`: the token only when the coordinator is the page's own origin
 * (the deployed site and Vite's proxy both serve `/api` there), so a token
 * given to this page is never sent to a coordinator typed in by hand. */
export function gardenTokenFor(coordinator: string, pageOrigin: string, token?: string): string | undefined {
  if (!token) return undefined;
  try {
    return new URL(coordinator).origin === new URL(pageOrigin).origin ? token : undefined;
  } catch {
    return undefined;
  }
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

/** The error for a refused join. With a garden token in the body, nothing of
 * the response body is repeated (a development coordinator's error page lists
 * the request's parameters, the token among them, and an echo can carry it
 * escaped or encoded, past any substring check): only the status, with a fixed
 * description of the two refusals a join meets in normal running, and a
 * redirect is named as one. */
async function joinFailure(res: Response, gardenToken?: string): Promise<string> {
  if (!gardenToken) return `join: ${res.status} ${await res.text()}`;
  await res.body?.cancel().catch(() => {});
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    return `join: the coordinator answered with a redirect (${res.status}); a join that carries a garden token follows none`;
  }
  const known: Record<number, string> = {
    429: "too many joins or requests from this address; try later",
    503: "the coordinator has no room for new islands, or is unavailable",
  };
  return `join: ${res.status} ${known[res.status] ?? "(response withheld: the join carried a garden token)"}`;
}

/** Coordinator.Queue's island credentials: `"isl-"` and 9 random bytes, and
 * 32 random bytes, both base64url without padding. */
const ISLAND_ID = /^isl-[A-Za-z0-9_-]{12}$/;
const ISLAND_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The id and token of an accepted join. With a garden token in the body, an
 * answer that is not JSON naming both, in the coordinator's own formats and
 * neither holding the garden token, is refused with a fixed message: the
 * parser's own error quotes the start of the body, and a reflected id would
 * be logged, remembered and put in every URL (and a token with a newline
 * makes a header error that quotes it). */
async function joinAnswer(res: Response, gardenToken?: string): Promise<{ id: string; token: string }> {
  if (!gardenToken) return (await res.json()) as { id: string; token: string };
  // Read outside the parse: a body that fails to arrive (the island was stopped,
  // the connection dropped) rethrows its own error, which quotes nothing of the
  // body, so a stop is still recognised as one (`stopped` in runIsland).
  const text = await res.text();
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    answer = undefined;
  }
  const { id, token } = (answer ?? {}) as { id?: unknown; token?: unknown };
  // Neither may hold the garden token. A random 12- or 43-character value
  // holds a given 4-character string about once in 10^6 joins, so containment
  // is checked from 4 characters up; a shorter token (no secret anyway) is
  // checked for equality only, so a real join is not refused by chance.
  const holds = (v: string) => (gardenToken.length >= 4 ? v.includes(gardenToken) : v === gardenToken || v.slice(4) === gardenToken);
  const ok = typeof id === "string" && typeof token === "string" && ISLAND_ID.test(id) && ISLAND_TOKEN.test(token) && !holds(id) && !holds(token);
  if (!ok) {
    throw new Error(`join: ${res.status} answer is not an island id and token (response withheld: the join carried a garden token)`);
  }
  return { id: id as string, token: token as string };
}

/** What the island page and tools/island.ts say when Stop or a signal lands. Phase-neutral: Stop may land while idle
 * (no task in hand) or while a complete is in flight (that task then counts as completed); runIsland's own log line
 * says which happened. */
export const STOP_MESSAGE = "stopping: a task in hand stops at its next census chunk; a result already being sent finishes, then the island requests immediate release (lease expiry is the fallback)";

/** Cleanup is independent of Stop and cannot replace the run's result or error.
 * Race the transport as well as aborting it: even a stalled implementation has
 * a bounded cleanup lifetime. Never read or log a response body or credentials. */
async function leaveIsland(base: string, identity: { id: string; token: string }, log: (message: string) => void): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let released = false;
  try {
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        resolve(false);
        controller.abort();
      }, 2_000);
    });
    const id = encodeURIComponent(identity.id);
    released = await Promise.race([
      fetch(`${base}/api/islands/${id}?island=${id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${identity.token}` },
        redirect: "error",
        signal: controller.signal,
      }).then((response) => response.status === 204),
      timeout,
    ]);
  } catch {
    // Old coordinators, lost connections and authorization failures all fall
    // back to ordinary lease expiry; cleanup must not hide an earlier error.
  } finally {
    clearTimeout(timer);
  }
  try {
    log(released
      ? "left island: registration removed and unfinished work released"
      : "leave could not be confirmed; any unfinished work becomes available when its lease expires");
  } catch {
    // A caller's logging callback must not turn cleanup into a new failure.
  }
}

export async function runIsland(device: GPUDevice, opt: IslandOptions): Promise<number> {
  const log = opt.log ?? (() => {});
  const base = opt.coordinator.replace(/\/$/, "");
  const signal = opt.signal;
  const backoff = new IslandBackoff();
  // An engine without `AbortSignal.reason` (none that has WebGPU) carries no reason to match by identity.
  const noReason = !!signal && !("reason" in signal);
  // A fetch or body read aborted by `signal` rethrows as the signal's own reason (not every engine does), so
  // `stopped` matches by identity alone: an unrelated `AbortError` (a GPU readback failing as Stop lands) is
  // still a failure, not a stop.
  const asStop = (e: unknown) => (signal?.aborted && !noReason && (e as { name?: unknown } | null)?.name === "AbortError" ? signal.reason : e);
  // An abort this island asked for: the signal's own reason. One seen while the signal is not aborted came from
  // elsewhere and is not ours to swallow. `Object.is`, not `===`: a reason of NaN is still the reason.
  const stopped = (e: unknown) => !!signal?.aborted && (Object.is(e, signal.reason) || (noReason && (e as { name?: unknown } | null)?.name === "AbortError"));
  // Before a request that changes the coordinator's record: none leaves after the abort.
  const stopIfAborted = () => {
    if (signal?.aborted) throw noReason ? new DOMException("the island was stopped", "AbortError") : signal.reason;
  };
  if (signal?.aborted) return 0;
  let done = 0;
  let identity: { id: string; token: string } | undefined;
  try {
    let id: string, token: string;
    if (opt.identity) {
      ({ id, token } = opt.identity);
    } else {
      try {
        const joinRequest: RequestInit = {
          method: "POST",
          headers: { "content-type": "application/json" },
          // The coordinator only offers a segment to an island whose declared
          // metrics version matches the segment's experiment (and checks the
          // uploaded manifest's version again at completion -- see
          // Coordinator.Queue's moduledoc).
          // A garden token (see IslandOptions.gardenToken) is shown here only.
          body: JSON.stringify({ adapter: opt.host.adapter, userAgent: opt.host.host, metricsVersion: METRICS_VERSION, ...(opt.gardenToken ? { gardenToken: opt.gardenToken } : {}) }),
          // A redirect would carry that body (a 307/308 keeps it) to wherever it
          // points, past every origin rule: a join with a token follows none.
          ...(opt.gardenToken ? { redirect: "manual" as const } : {}),
          signal,
        };
        const joined = await backoff.request(() => fetch(`${base}/api/islands`, joinRequest), signal);
        if (!joined.ok) throw new Error(await joinFailure(joined, opt.gardenToken));
        ({ id, token } = await joinAnswer(joined, opt.gardenToken));
      } catch (e) {
        throw asStop(e);
      }
    }
    identity = { id, token };
    // A join answered as the abort landed is not reported: the caller asked to stop.
    stopIfAborted();
    opt.onJoined?.({ id, token });
    const q = (extra = "") => `island=${encodeURIComponent(id)}${extra}`;
    const call = async <T>(path: string, init: RequestInit = {}, raw = false, retrySignal = signal): Promise<T> => {
      try {
        const request = { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } };
        const res = await backoff.request(() => fetch(`${base}${path}`, request), retrySignal);
        if (!res.ok) throw new HttpError(res.status, `${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
        const ct = res.headers.get("content-type") ?? "";
        return (await (ct.includes("json") && !raw ? res.json() : res.arrayBuffer())) as T;
      } catch (e) {
        // Only a request that carries the signal: a complete, reject or fail is sent without it, and an `AbortError`
        // from one (say, the page unloading) is not the stop (whether the coordinator applied it is unknown).
        throw init.signal ? asStop(e) : e;
      }
    };
    // `abortable`: `/next` and heartbeats only. A complete, reject or fail, once
    // sent, is waited for: the island cannot know whether the coordinator applied it.
    const postJson = <T>(path: string, body: unknown, abortable = false, attemptSignal = signal) =>
      call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(abortable ? { signal: attemptSignal } : {}) }, false, attemptSignal);

    log(opt.identity ? `resumed as ${id}` : `joined as ${id}`);
    let waiting = false;
    while (!signal?.aborted && (!opt.maxTasks || done < opt.maxTasks)) {
      const task = await postJson<Task>(`/api/next?${q()}`, { capabilities: ISLAND_CAPABILITIES }, true);
      if (task.kind === "idle" || !task.segment || !task.spec || !task.lease) {
        if (opt.maxTasks) break;
        if (!signal?.aborted && !waiting) {
          log("connected; waiting for work. No experiment segment is available right now; checking again shortly");
          waiting = true;
        }
        // Stop may have aborted while `/next` was in flight; don't run a full
        // idle wait just to discover that on the next loop check.
        if (!signal?.aborted)
          await new Promise<void>((r) => {
            const t = setTimeout(wake, opt.idleMs ?? 10_000);
            function wake() {
              clearTimeout(t);
              signal?.removeEventListener("abort", wake);
              r();
            }
            signal?.addEventListener("abort", wake);
          });
        continue;
      }
      waiting = false;
      const seg = task.segment;
      const lease = task.lease;
      const refusal = specRefusal(task.spec);
      if (refusal) throw new Error(`refusing ${seg.run} #${seg.index}: ${refusal}`);
      log(`${task.kind} ${seg.run} #${seg.index} (${seg.steps} steps from t=${seg.startStep})`);
      // One task-scoped heartbeat worker: no overlapping attempts, and no
      // delayed retry can escape task teardown or ignore the shared cooldown.
      const heartbeat = new AbortController();
      const stopHeartbeat = () => heartbeat.abort();
      if (signal?.aborted) stopHeartbeat();
      else signal?.addEventListener("abort", stopHeartbeat, { once: true });
      const beat = (async () => {
        while (!heartbeat.signal.aborted) {
          try {
            await islandDelay(opt.heartbeatMs ?? 60_000, heartbeat.signal);
            await postJson(`/api/segments/${seg.id}/heartbeat?${q()}`, { lease }, true, heartbeat.signal);
          } catch (e) {
            if (heartbeat.signal.aborted) break;
            log(`  heartbeat: ${(e as Error).message}`);
          }
        }
      })();
      try {
        let start: WorldState | undefined;
        let observer: ObserverState | undefined;
        if (task.startFrom) {
          // Every defect of the predecessor's artifact (undecodable or invalid
          // state, wrong step or digest, malformed or mismatched observer)
          // rejects the predecessor for recomputation instead of failing this
          // island; only transport errors propagate. One artifact, one fetch:
          // the checkpoint and observer sections decode together.
          const bytes = new Uint8Array(await call<ArrayBuffer>(`/api/segments/${task.startFrom}/start?${q()}`, { signal }));
          let bad: string | null = null;
          try {
            const decoded = decodeArtifact(bytes);
            const digest = stateHash(decoded.state);
            if (decoded.state.step !== seg.startStep || (task.startHash && digest !== task.startHash))
              bad = `start checkpoint t=${decoded.state.step} digest ${digest}, expected t=${seg.startStep} digest ${task.startHash}`;
            else {
              // The sun check too (`sunContinuationError`, which runExperiment would otherwise throw): a predecessor taken
              // under another sun than the schedule's is rejected for recomputation, not a failure of this island.
              bad = continuationError(task.spec, decoded.state, decoded.observer) ?? sunContinuationError(task.spec, decoded.state.cfg, decoded.state.step, decoded.observer);
              if (!bad) {
                start = decoded.state;
                observer = decoded.observer;
              }
            }
          } catch (e) {
            bad = `invalid predecessor artifact: ${(e as Error).message}`;
          }
          if (bad) {
            // Not sent after an abort: the next island meets the same defect.
            // Checked again after the log, which may itself stop the island.
            stopIfAborted();
            log(`  rejecting: ${bad}`);
            stopIfAborted();
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
          const bytes = new Uint8Array(await call<ArrayBuffer>(`/api/segments/${task.importFrom}/start?${q()}`, { signal }));
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
            stopIfAborted();
            log(`  rejecting import: ${bad}`);
            stopIfAborted();
            await postJson(`/api/segments/${seg.id}/reject?${q()}`, { lease, reason: bad.slice(0, 500), predecessor: "import" });
            continue;
          }
        }
        const sink = new MemorySink();
        const out = await runExperiment(device, task.spec, sink, opt.host, (m) => log(`  ${m}`), { start, observer, immigrant, keepFinal: task.kind === "run", signal });
        const lq = q(`&lease=${encodeURIComponent(lease)}`);
        if (task.kind === "run") {
          // Encode once; explicit-refusal retries reuse those bytes. The checkpoint and observer travel as
          // one artifact. Verify attempts upload nothing — they replay locally
          // and report the digest they computed for the coordinator to compare.
          // Uploads belong to this attempt and are aborted with it: nothing
          // uploaded is a result until the complete below is accepted.
          const octet = { "content-type": "application/octet-stream" };
          stopIfAborted();
          await call(`/api/segments/${seg.id}/checkpoint?${lq}`, { method: "PUT", headers: octet, body: encodeCheckpoint(out.final!, out.observer) as BodyInit, signal });
          for (const [name, text] of sink.files) {
            const safe = name.replace(/[^a-z0-9_.-]/gi, "-").toLowerCase();
            stopIfAborted();
            await call(`/api/segments/${seg.id}/files/${safe}?${lq}`, { method: "PUT", headers: octet, body: text, signal });
          }
        }
        const body = {
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
        };
        // The last point at which an abort leaves the task; once sent, the complete stands.
        stopIfAborted();
        const r = await postJson<{ status: string }>(`/api/segments/${seg.id}/complete?${q()}`, body);
        log(`  ${task.kind} complete: ${out.summary.finalHash} → ${r.status}`);
        done++;
      } catch (e) {
        if (stopped(e)) {
          log(`stopped local work: ${seg.run} #${seg.index}; requesting release`);
          break;
        }
        // A lost lease (reassigned after a long stall, or the run was blocked) is not fatal.
        if (e instanceof HttpError && e.status === 409) log(`  task abandoned: ${e.message}`);
        // Nor is a scheduled feed the world refuses (past MATTER_MAX at that step, which no
        // creation-time check can see; see Coordinator.Queue's moduledoc): a property of the
        // spec against its world, the same on every island, so crashing here would only take
        // this island down and the next one after it, and leaving the task would only have the
        // next island fail it again once the lease lapsed. Reported instead: the coordinator
        // marks the segment failed with this reason under this lease, blocks the run's later
        // segments and never offers it again, so the experiment stops there, visibly. Only a
        // lost lease (409: reclaimed meanwhile, or the segment was blocked) is not fatal here
        // either; a coordinator that cannot be reached still throws.
        else if (e instanceof InterventionError) {
          // Unless the island was stopped meanwhile: then it reports nothing, and the
          // next island meets the same refusal once the lease lapses. Checked
          // again after the log line, whose callback may itself stop the island.
          if (!signal?.aborted) log(`  cannot apply the schedule as given, leaving the task: ${e.message}`);
          if (signal?.aborted) {
            log(`stopped local work: ${seg.run} #${seg.index}; requesting release`);
            break;
          }
          try {
            await postJson(`/api/segments/${seg.id}/fail?${q()}`, { lease, reason: e.message.slice(0, 500) });
            log(`  reported ${seg.run} #${seg.index} as failed; the run stops there`);
          } catch (f) {
            if (f instanceof HttpError && f.status === 409) log(`  task abandoned: ${f.message}`);
            else throw f;
          }
        } else throw e;
      } finally {
        stopHeartbeat();
        signal?.removeEventListener("abort", stopHeartbeat);
        await beat;
      }
    }
  } catch (e) {
    // The join or `/next` aborted (a task's own abort breaks out above).
    if (stopped(e)) {
      log("stopped");
      return done;
    }
    throw e;
  } finally {
    if (identity) await leaveIsland(base, identity, log);
  }
  return done;
}
