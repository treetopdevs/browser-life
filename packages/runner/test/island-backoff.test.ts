import { describe, expect, it, vi } from "vitest";
import { IslandBackoff, islandDelay, retryAfterMs, type IslandBackoffClock } from "../src/island-backoff.ts";

const refusal = (status = 429, delay?: string, marker: string | null = "false") => new Response("refused", {
  status, headers: { ...(delay === undefined ? {} : { "retry-after": delay }), ...(marker === null ? {} : { "x-island-request-applied": marker }) },
});
function clock() {
  let now = 0;
  const waits: number[] = [];
  const time: IslandBackoffClock = {
    monotonic: () => now, wall: () => Date.UTC(2026, 9, 24) + now, random: () => 0,
    sleep: async (ms) => { waits.push(ms); now += ms; },
  };
  return { time, waits, advance: (ms: number) => { now += ms; } };
}

describe("island refusal backoff", () => {
  it("parses seconds and HTTP dates, preserving huge advertised waits", () => {
    const now = Date.UTC(2026, 9, 24);
    expect(retryAfterMs(" 60 ", now)).toBe(60_000);
    expect(retryAfterMs("00", now)).toBe(0);
    expect(retryAfterMs("Sat, 24 Oct 2026 00:00:02 GMT", now)).toBe(2_000);
    expect(retryAfterMs("Friday, 23-Oct-26 23:59:59 GMT", now)).toBe(0);
    expect(retryAfterMs("Sat Oct 24 00:00:02 2026", now)).toBe(2_000);
    expect(retryAfterMs("999999999999999999999", now)).toBe(Infinity);
    for (const invalid of [null, "", "-1", "1.5", "soon", "2026-10-24", "NaN"]) expect(retryAfterMs(invalid, now)).toBeNull();
  });

  it.each([429, 503])("retries marked %s with 1/2/4 second floors and four attempts maximum", async (status) => {
    const c = clock();
    const send = vi.fn(async () => refusal(status, "0"));
    const response = await new IslandBackoff(c.time).request(send);
    expect(send).toHaveBeenCalledTimes(4);
    expect(c.waits).toEqual([1_000, 2_000, 4_000]);
    expect(await response.text()).toBe("refused");
  });

  it("honours Retry-After and does not shorten it to fit the retry budget", async () => {
    const c = clock();
    const send = vi.fn(async () => refusal(429, "60"));
    expect((await new IslandBackoff(c.time).request(send)).status).toBe(429);
    expect(c.waits).toEqual([60_000]);
    expect(send).toHaveBeenCalledTimes(2);
    const huge = vi.fn(async () => refusal(503, "999999999999999999999"));
    await new IslandBackoff(c.time).request(huge);
    expect(huge).toHaveBeenCalledTimes(1);
  });

  it("uses positive jitter and counts elapsed response time against the budget", async () => {
    const c = clock(); c.time.random = () => 1;
    const send = vi.fn(async () => {
      if (send.mock.calls.length === 1) return refusal(503);
      c.advance(120_000);
      return refusal(503);
    });
    await new IslandBackoff(c.time).request(send);
    expect(c.waits).toEqual([1_250]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([[429, null], [503, null], [503, "true"], [409, "false"], [500, "false"]] as const)("does not replay status %s marker %s", async (status, marker) => {
    const c = clock(); const send = vi.fn(async () => refusal(status, "1", marker));
    await new IslandBackoff(c.time).request(send);
    expect(send).toHaveBeenCalledTimes(1); expect(c.waits).toEqual([]);
  });

  it("does not replay a rejected fetch", async () => {
    const c = clock(); const error = new Error("response lost after mutation");
    const send = vi.fn(async () => { throw error; });
    await expect(new IslandBackoff(c.time).request(send)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shares cooldown with other operations", async () => {
    vi.useFakeTimers();
    try {
      const c = clock(); c.time.monotonic = () => Date.now(); c.time.sleep = islandDelay;
      const backoff = new IslandBackoff(c.time);
      const first = vi.fn(async () => first.mock.calls.length === 1 ? refusal(429, "2") : new Response("ok"));
      const pending = backoff.request(first);
      await vi.advanceTimersByTimeAsync(0);
      const second = vi.fn(async () => new Response("ok"));
      const other = backoff.request(second);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([pending, other]);
      expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it("rechecks a cooldown extended by a concurrent in-flight response", async () => {
    vi.useFakeTimers();
    try {
      const c = clock(); c.time.monotonic = () => Date.now(); c.time.sleep = islandDelay;
      const backoff = new IslandBackoff(c.time);
      let release!: (response: Response) => void;
      const held = new Promise<Response>((resolve) => { release = resolve; });
      const late = vi.fn(async () => late.mock.calls.length === 1 ? held : new Response("ok"));
      const lateRun = backoff.request(late);
      const first = vi.fn(async () => first.mock.calls.length === 1 ? refusal(429, "2") : new Response("ok"));
      const firstRun = backoff.request(first);
      await vi.advanceTimersByTimeAsync(1_000);
      release(refusal(503, "4")); // gate extends from t=2000 to t=5000
      await vi.advanceTimersByTimeAsync(1_000);
      expect(first).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(first).toHaveBeenCalledTimes(1); expect(late).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([lateRun, firstRun]);
      expect(first).toHaveBeenCalledTimes(2); expect(late).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("returns the readable previous refusal when a concurrent gate extension exceeds its deadline", async () => {
    vi.useFakeTimers();
    try {
      const c = clock(); c.time.monotonic = () => Date.now(); c.time.sleep = islandDelay;
      const backoff = new IslandBackoff(c.time);
      let release!: (response: Response) => void;
      const lateRun = backoff.request(() => new Promise<Response>((resolve) => { release = resolve; }));
      const previous = refusal(429, "2");
      const send = vi.fn(async () => previous);
      const pending = backoff.request(send);
      await vi.advanceTimersByTimeAsync(1_000);
      release(refusal(503, "120")); // t=121000, beyond both t=120000 deadlines
      await vi.advanceTimersByTimeAsync(1_000);
      const answer = await pending;
      expect(answer).toBe(previous);
      expect(await answer.text()).toBe("refused");
      expect(send).toHaveBeenCalledTimes(1);
      expect((await lateRun).status).toBe(503);
    } finally { vi.useRealTimers(); }
  });

  it("exhausts an attempt-zero budget behind a shared gate without sending anything", async () => {
    const c = clock(); const backoff = new IslandBackoff(c.time);
    await backoff.request(async () => refusal(503, "120"));
    const send = vi.fn(async () => new Response("must not send"));
    await expect(backoff.request(send)).rejects.toThrow("retry budget exhausted while waiting for coordinator cooldown");
    expect(send).not.toHaveBeenCalled();
    expect(c.waits).toEqual([]);
  });

  it.each([undefined, null, "stop", NaN])("cancels a refused-attempt wait with exact reason %s", async (reason) => {
    const c = clock(); const controller = new AbortController();
    c.time.sleep = async () => { controller.abort(reason); };
    const send = vi.fn(async () => refusal());
    const caught = await new IslandBackoff(c.time).request(send, controller.signal).catch((error) => error);
    expect(Object.is(caught, controller.signal.reason)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a sent successful decision still resolves when Stop lands during its response", async () => {
    const c = clock(); const controller = new AbortController();
    const send = vi.fn(async () => { controller.abort(); return new Response("accepted"); });
    expect(await (await new IslandBackoff(c.time).request(send, controller.signal)).text()).toBe("accepted");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
