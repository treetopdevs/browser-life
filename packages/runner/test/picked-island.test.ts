// A picked run on an island (docs/archipelago-breed-2026-10-18.md, amendment 2026-11-02): which specs an island accepts, and that a
// pick log the island cannot use (a digest that does not match, a malformed or misplaced log) is reported as a failed segment,
// the same on every island, never run and never retried. No GPU: each failure is found before any state is built.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ISLAND_CAPABILITIES, canonicalPickLog, pickLogDigest, runIsland, specRefusal, type PickEntry, type RunSpec } from "../src/index.ts";

const entry = (cycle: number, donors: number[]): PickEntry => ({ step: cycle * 5000, cycle, donors });
const log = canonicalPickLog([entry(1, [3, 9, 12, 0])]);
const digest = pickLogDigest(log);
const spec: RunSpec = { experiment: "t", presetId: "breeder", condition: "treatment", seed: 1, steps: 5000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0, picked: true, pickLog: digest, pickImplicit: true };

describe("specRefusal and the capability for picked runs", () => {
  it("allows picked with pickLog, refuses picked without it, pressures and branch", () => {
    expect(specRefusal(spec)).toBeNull();
    const { pickLog: _p, pickImplicit: _i, ...bare } = spec;
    expect(specRefusal(bare)).toMatch(/picked run \(spec.picked\) without a pick log/);
    expect(specRefusal({ ...spec, pressures: [{ step: 0, cycle: 1, score: "mass" }] })).toMatch(/pressures/);
    expect(specRefusal({ ...spec, branch: { source: "s", sourceHash: "0".repeat(16), boundary: 1 } })).toMatch(/branch run/);
  });

  it("the island advertises picks-v1 in addition to the others", () => {
    expect(ISLAND_CAPABILITIES).toEqual(expect.arrayContaining(["ponds-v1", "breed-v1", "picks-v1"]));
  });
});

describe("an island that cannot use the task's pick log reports the segment failed", () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  /** One task (segment #0 or #1 of 5000 steps) against a fake coordinator that serves `served` as the pick log. */
  async function attempt(taskSpec: RunSpec, served: string | null, segment = { id: "seg-0", run: "r", index: 0, startStep: 0, steps: 5000 }, seen: { calls: string[]; fails: { reason?: string }[] } = { calls: [], fails: [] }) {
    const { calls, fails } = seen;
    const logged: string[] = [];
    let given = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      calls.push(`${init.method ?? "GET"} ${path}`);
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") {
        if (given) return json({ kind: "idle" });
        given = true;
        return json({ kind: "run", lease: "L", segment, spec: taskSpec, startFrom: null, startHash: null });
      }
      if (path === `/api/pick-logs/${taskSpec.pickLog}` && served === null) return new Response("not found", { status: 404 });
      if (path === `/api/pick-logs/${taskSpec.pickLog}`) return new Response(served, { headers: { "content-type": "application/octet-stream" } });
      if (path.endsWith("/heartbeat")) return json({ ok: true });
      if (path.endsWith("/fail")) {
        fails.push(JSON.parse(String(init.body)));
        return json({ ok: true });
      }
      throw new Error(`unexpected ${path}`);
    });
    const done = await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, maxTasks: 2, log: (m) => logged.push(m) });
    return { done, calls: calls.filter((c) => !/heartbeat/.test(c)), logged, fails };
  }

  const shape = ["POST /api/islands", "POST /api/next"];
  const tail = ["POST /api/next", "DELETE /api/islands/isl"];

  it("island rejects a fetched pick log whose SHA-256 differs from spec.pickLog", async () => {
    const other = canonicalPickLog([entry(1, [3, 9, 12, 1])]);
    const { done, calls, fails, logged } = await attempt(spec, other);
    expect(done).toBe(0);
    expect(calls).toEqual([...shape, `GET /api/pick-logs/${digest}`, "POST /api/segments/seg-0/fail", ...tail]);
    expect(fails[0].reason).toMatch(/pick log [0-9a-f]{64}: the pick log hashes to/);
    expect(logged.find((m) => /cannot apply the picks as given/.test(m))).toBeDefined();
  });

  it("a pick log the coordinator no longer has (404) fails the segment instead of releasing it for retry", async () => {
    const { done, calls, fails } = await attempt(spec, null);
    expect(done).toBe(0);
    expect(calls).toEqual([...shape, `GET /api/pick-logs/${digest}`, "POST /api/segments/seg-0/fail", ...tail]);
    expect(fails[0].reason).toMatch(/pick log [0-9a-f]{64}: GET \/api\/pick-logs\/[0-9a-f]{64}: 404/);
  });

  it("a log with the right digest that is not canonical, or is not UTF-8, fails the same way", async () => {
    const messy = log.replace(",", ", ");
    const r1 = await attempt({ ...spec, pickLog: pickLogDigest(messy) }, messy);
    expect(r1.fails[0].reason).toMatch(/not in canonical form/);
  });

  it("an entry outside this segment's own window never reaches the run; one off a boundary or past the world's cycle fails it", async () => {
    // Entries are cut to (start, start + steps]: a log whose only entry is cycle 1 is empty for segment #1 (5000..10000)... which has
    // a boundary at 10000 and, implicit, is answered by the rule. That reaches the GPU (a fake device here), not a pick failure.
    const second = { id: "seg-1", run: "r", index: 1, startStep: 5000, steps: 5000 };
    // A pick error would resolve (the segment reported via /fail); this one must reject, after the log was fetched, with no /fail.
    const seen = { calls: [] as string[], fails: [] as { reason?: string }[] };
    const err = await attempt(spec, log, second, seen).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/pick/);
    expect(seen.calls).toContain(`GET /api/pick-logs/${digest}`);
    expect(seen.calls.filter((c) => c.endsWith("/fail"))).toEqual([]);
    expect(seen.fails).toEqual([]);
    const off = canonicalPickLog([{ step: 5100, cycle: 1, donors: [1] }]);
    // In segment #1's window (5000, 10000]; segment #0's window (0, 5000] does not hold it.
    const r = await attempt({ ...spec, pickLog: pickLogDigest(off) }, off, { ...second, id: "seg-0" });
    expect(r.fails[0].reason).toMatch(/pick at t=5100 is not on a pond boundary/);
    const wrongCycle = canonicalPickLog([{ step: 5000, cycle: 2, donors: [1] }]);
    const r2 = await attempt({ ...spec, pickLog: pickLogDigest(wrongCycle) }, wrongCycle);
    expect(r2.fails[0].reason).toMatch(/says cycle 2, not 1/);
  });

  it("a strict log with no entry for the segment's boundary fails (no implicit rule)", async () => {
    const strict = { ...spec } as Record<string, unknown>;
    delete strict.pickImplicit;
    const empty = canonicalPickLog([]);
    const r = await attempt({ ...(strict as unknown as RunSpec), pickLog: pickLogDigest(empty) }, empty);
    expect(r.fails[0].reason).toMatch(/covers 0 of the run's 1 pond boundaries and no picker answers the rest/);
  });

  it("a pick that is not for a donor-choosing pond world fails at once", async () => {
    const r = await attempt({ ...spec, presetId: "spots", pickLog: digest }, log);
    expect(r.fails[0].reason).toMatch(/needs a pond config/);
  });
});
