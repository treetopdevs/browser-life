// Retry only explicit coordinator refusals, never an ambiguous failed request.
// All operations of one island share this gate, including its heartbeat worker.
export const ISLAND_RETRY_ATTEMPTS = 4;
export const ISLAND_RETRY_BUDGET_MS = 120_000;

/** Milliseconds advertised by Retry-After; null means absent or malformed.
 * An overflowing seconds value means infinity: never retry earlier than it. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1_000 ? seconds * 1_000 : Infinity;
  }
  // HTTP-date's three wire forms. Do not accept Date.parse's incidental
  // numeric/date shortcuts (e.g. a negative or fractional seconds value).
  if (!/^(?:[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]+, \d{2}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/.test(text)) return null;
  const date = Date.parse(text.endsWith("GMT") ? text : `${text} GMT`);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw "reason" in signal ? signal.reason : new DOMException("island stopped", "AbortError");
}

export function islandDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, Math.ceil(ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface IslandBackoffClock {
  monotonic(): number;
  wall(): number;
  random(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

/** One instance per runIsland invocation; not one per request or task. */
export class IslandBackoff {
  private until = 0;
  constructor(private readonly clock: IslandBackoffClock = {
    monotonic: () => performance.now(), wall: () => Date.now(), random: () => Math.random(), sleep: islandDelay,
  }) {}

  private async ready(deadline: number, signal?: AbortSignal): Promise<boolean> {
    for (;;) {
      checkAbort(signal);
      const now = this.clock.monotonic();
      if (now >= deadline) return false;
      if (this.until <= now) return true;
      if (this.until >= deadline) return false;
      await this.clock.sleep(this.until - now, signal);
      // Another operation may have extended the shared cooldown as we slept.
    }
  }

  /** send must reuse the exact request body/lease. signal governs waits and
   * whether another attempt starts; send owns the in-flight signal policy.
   * In particular, an already-sent terminal decision is never aborted here.
   * The budget bounds retry admission/waits, not an unresolved sent request. */
  async request(send: () => Promise<Response>, signal?: AbortSignal): Promise<Response> {
    const deadline = this.clock.monotonic() + ISLAND_RETRY_BUDGET_MS;
    let previous: Response | undefined;
    try {
      for (let attempt = 0; attempt < ISLAND_RETRY_ATTEMPTS; attempt++) {
        if (!await this.ready(deadline, signal)) {
          if (previous) { const result = previous; previous = undefined; return result; }
          throw new Error("island request retry budget exhausted while waiting for coordinator cooldown");
        }
        checkAbort(signal);
        if (previous?.body) void previous.body.cancel().catch(() => {});
        previous = undefined;
        const response = await send(); // A rejection is ambiguous: never replay it.
        if ((response.status !== 429 && response.status !== 503) || response.headers.get("x-island-request-applied") !== "false") return response;
        const delay = Math.max(retryAfterMs(response.headers.get("retry-after"), this.clock.wall()) ?? 0, 1_000 * 2 ** attempt * (1 + this.clock.random() * 0.25));
        this.until = Math.max(this.until, this.clock.monotonic() + delay);
        // Set the shared gate even on exhaustion so heartbeats cannot ignore it.
        previous = response;
        checkAbort(signal);
        if (attempt === ISLAND_RETRY_ATTEMPTS - 1 || this.until >= deadline) { previous = undefined; return response; }
        // Keep this refusal readable if another request extends the shared
        // gate beyond our budget; discard it immediately before the next send.
      }
    } finally {
      if (previous?.body) void previous.body.cancel().catch(() => {});
    }
    throw new Error("unreachable island retry state");
  }
}
