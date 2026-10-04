// tools/lib/pickers.ts: the rule, random, file and command pickers with injected I/O (a fake clock and file system).
import { describe, expect, it } from "vitest";
import { CH, PRESETS, cellCount, initWorld, presetConfig, worldW, type WorldState } from "@bl/schema";
import type { PickRequest } from "@bl/runner";
import { OUTPUT_LIMIT } from "../lib/run-command.ts";
import { claimPickDir, commandAnswerer, dirPicker, pickDirTaken, fileAnswerer, parseAnswer, randomPicker, randomPicks, requestJson, rulePicker, type CommandResult, type PickIo, type RunCommand } from "../lib/pickers.ts";
import { ensembleProblems } from "../lib/bundle.ts";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;

/** ponds-small's world with uniform bound mass per pond: `mass(pond)`. */
function world(mass: (pond: number) => number): WorldState {
  const s = initWorld(presetConfig(pondsSmall, 1), pondsSmall.init);
  const cfg = s.cfg, n = cellCount(cfg), W = worldW(cfg);
  s.cells.fill(0, CH.B * n, (CH.P + 1) * n);
  for (let p = 0; p < 4; p++) {
    const tx = p % 2, ty = (p - tx) / 2;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) s.cells[CH.B * n + (ty * 64 + y) * W + tx * 64 + x] = mass(p);
  }
  return { ...s, step: 5000 };
}

/** A request over `pre` at cycle 3 with k = 5 (a pond of uniform mass m has an expected packet mass 25 m). */
function request(pre: WorldState, over: Partial<PickRequest> = {}): PickRequest {
  const occupied = [0, 1, 2, 3].filter((p) => pre.cells[CH.B * cellCount(pre.cfg) + (Math.floor(p / 2) * 64) * worldW(pre.cfg) + (p % 2) * 64] > 0);
  return { step: pre.step, cycle: 3, pre, k: 5, occupied, suggested: [2, 0], max: 2, ...over };
}

/** A fake file system with a clock that only the sleeps and `at` advance. */
function fakeIo() {
  let clock = 0;
  const files = new Map<string, { data: string | Uint8Array; mtime: number }>();
  const timers: { at: number; run: () => void }[] = [];
  const settle = () => {
    for (const t of timers.filter((x) => x.at <= clock).sort((x, y) => x.at - y.at)) {
      timers.splice(timers.indexOf(t), 1);
      t.run();
    }
  };
  const io: PickIo = {
    mkdir: async () => {},
    exists: async (p) => files.has(p),
    readText: async (p) => {
      const f = files.get(p);
      if (!f || typeof f.data !== "string") throw new Error(`no text file ${p}`);
      return f.data;
    },
    size: async (p) => (typeof files.get(p)!.data === "string" ? (files.get(p)!.data as string).length : (files.get(p)!.data as Uint8Array).length),
    mtime: async (p) => files.get(p)!.mtime,
    remove: async (p) => void files.delete(p),
    writeText: async (p, t) => void files.set(p, { data: t, mtime: clock }),
    createNew: async (p, t) => (files.has(p) ? false : (files.set(p, { data: t, mtime: clock }), true)),
    // One alias, as on a Mac: /tmp is /private/tmp.
    canonical: async (p) => p.replace(/^\/tmp\//, "/private/tmp/"),
    writeBytes: async (p, b) => void files.set(p, { data: b, mtime: clock }),
    sleep: async (ms) => {
      clock += ms;
      settle();
    },
    now: () => clock,
  };
  return {
    io,
    files,
    /** Runs `fn` when the clock reaches `ms`. */
    at(ms: number, fn: () => void) {
      timers.push({ at: ms, run: fn });
    },
    put(p: string, data: string) {
      files.set(p, { data, mtime: clock });
    },
    get clock() {
      return clock;
    },
  };
}

describe("randomPicks", () => {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  it("is distinct, inside the pool and deterministic per (seed, cycle)", () => {
    const a = randomPicks(7, 3, pool, 4);
    expect(a.length).toBe(4);
    expect(new Set(a).size).toBe(4);
    expect(a.every((p) => pool.includes(p))).toBe(true);
    expect(randomPicks(7, 3, pool, 4)).toEqual(a);
  });
  it("differs across cycles and seeds, and is capped by the pool", () => {
    const cycles = new Set(Array.from({ length: 12 }, (_, b) => randomPicks(7, b + 1, pool, 4).join()));
    expect(cycles.size).toBeGreaterThan(6);
    expect(randomPicks(8, 3, pool, 4)).not.toEqual(randomPicks(7, 3, pool, 4));
    expect(randomPicks(7, 3, [4, 9], 5).sort()).toEqual([4, 9]);
    expect(randomPicks(7, 3, [], 5)).toEqual([]);
  });
  it("a smaller count is a prefix of a larger one (same keys)", () => {
    expect(randomPicks(7, 3, pool, 8).slice(0, 3)).toEqual(randomPicks(7, 3, pool, 3));
  });
});

describe("the rule and random pickers", () => {
  it("rule answers the arm's own donors, in order, as a copy", async () => {
    const req = request(world(() => 120));
    const got = await rulePicker().pick(req);
    expect(got).toEqual([2, 0]);
    got.push(9);
    expect(req.suggested).toEqual([2, 0]);
    expect(rulePicker().name).toBe("rule");
  });
  it("random draws `max` ponds from the eligible pool", async () => {
    // Masses 112, 120, 128, 0: with k = 5 the packet masses are 2,800, 3,000, 3,200 and 0, so ponds 1 and 2 can found a pond.
    const pre = world((p) => [112, 120, 128, 0][p]);
    expect([...(await randomPicker(7).pick(request(pre, { max: 2 })))].sort()).toEqual([1, 2]);
    const one = await randomPicker(7).pick(request(pre, { max: 1 }));
    expect(one.length).toBe(1);
    expect([1, 2]).toContain(one[0]);
    expect(await randomPicker(7).pick(request(pre, { max: 1 }))).toEqual(one);
    expect(randomPicker(7).name).toBe("random");
  });
  it("random falls back to the occupied ponds when none is eligible, and caps at the pool", async () => {
    const pre = world((p) => [100, 100, 100, 0][p]);
    const got = await randomPicker(7).pick(request(pre, { max: 4 }));
    expect(got.sort()).toEqual([0, 1, 2]);
  });
});

describe("requestJson", () => {
  const pre = world((p) => [112, 120, 128, 0][p]);
  const files = { nonce: "c3-a1", dir: "/pick", sheet: "b003-sheet.png", album: null, answer: "b003-picks.json", applied: "b003-applied.json" };
  it("has exactly the pinned keys: no suggested, no scores, no ranks", () => {
    const json = requestJson(request(pre, { suggested: [2, 1] }), files);
    expect(Object.keys(json).sort()).toEqual(["album", "answer", "applied", "cycle", "dir", "donors", "eligible", "foundingMass", "grid", "nonce", "occupied", "ponds", "sheet", "step", "tile", "version"]);
    expect(JSON.stringify(json)).not.toMatch(/suggest|score|rank/i);
    expect(json).toMatchObject({ version: 1, cycle: 3, step: 5000, grid: { x: 2, y: 2 }, tile: 64, ponds: 4, occupied: [0, 1, 2], eligible: [1, 2], foundingMass: 3000, donors: { min: 1, max: 2 }, album: null });
  });
  it("is the same whatever the arm suggested", () => {
    expect(requestJson(request(pre, { suggested: [2, 1] }), files)).toEqual(requestJson(request(pre, { suggested: [0, 3] }), files));
  });
});

describe("parseAnswer", () => {
  it("takes {donors} or a bare array, ignores extra keys, refuses the rest", () => {
    expect(parseAnswer('{"donors":[3,1]}')).toEqual([3, 1]);
    expect(parseAnswer('{"donors":[3],"why":"new"}')).toEqual([3]);
    expect(parseAnswer(" [1, 2]\n")).toEqual([1, 2]);
    expect(() => parseAnswer("not json")).toThrow(/not JSON/);
    expect(() => parseAnswer('{"picks":[1]}')).toThrow(/no donors array/);
    expect(() => parseAnswer('{"donors":["a"]}')).toThrow(/no donors array/);
    expect(() => parseAnswer("3")).toThrow(/no donors array/);
  });
});

describe("dirPicker", () => {
  const pre = world((p) => [112, 120, 128, 0][p]);
  const answer = async () => [1];

  it("writes the request and the sheet before asking, and the request carries no suggestion", async () => {
    const f = fakeIo();
    const picker = dirPicker({ dir: "/pick", io: f.io, answer: async (ctx) => (expect(f.files.has("/pick/b003-request.json")).toBe(true), expect(f.files.has("/pick/b003-sheet.png")).toBe(true), expect(ctx.json.album).toBeNull(), [1]), name: "file", nonce: (c) => `n${c}` });
    expect(await picker.pick(request(pre))).toEqual([1]);
    const json = JSON.parse(f.files.get("/pick/b003-request.json")!.data as string);
    expect(json.nonce).toBe("n3");
    expect(JSON.stringify(json)).not.toMatch(/suggest/);
    const png = f.files.get("/pick/b003-sheet.png")!.data as Uint8Array;
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("the sheet bytes do not depend on what the arm suggested", async () => {
    const run = async (suggested: number[]) => {
      const f = fakeIo();
      await dirPicker({ dir: "/pick", io: f.io, answer, name: "file" }).pick(request(pre, { suggested }));
      return Array.from(f.files.get("/pick/b003-sheet.png")!.data as Uint8Array);
    };
    expect(await run([2, 1])).toEqual(await run([0, 3]));
  });

  it("removes a stale answer file first", async () => {
    const f = fakeIo();
    f.put("/pick/b003-picks-n.json", "[0]");
    await dirPicker({ dir: "/pick", io: f.io, answer: async () => (expect(f.files.has("/pick/b003-picks-n.json")).toBe(false), [1]), name: "file", nonce: () => "n" }).pick(request(pre));
  });

  it("records what the run applied at a boundary, and a boundary being asked has no such record", async () => {
    const f = fakeIo();
    const picker = dirPicker({ dir: "/pick", io: f.io, answer, name: "file" });
    await picker.applied!(request(pre, { cycle: 3 }), [2, 1], "recorded");
    expect(JSON.parse(f.files.get("/pick/b003-applied.json")!.data as string)).toEqual({ cycle: 3, step: 5000, donors: [2, 1], by: "recorded" });
    // The same directory used again from that boundary: asking means it is not committed, so the old record goes before the answerer runs.
    await dirPicker({ dir: "/pick", io: f.io, answer: async (ctx) => (expect(f.files.has("/pick/b003-applied.json")).toBe(false), expect(ctx.json.applied).toBe("b003-applied.json"), [1]), name: "file" }).pick(request(pre));
  });

  it("applied builds album.png from state and donors, and the next request points at it", async () => {
    const f = fakeIo();
    const picker = dirPicker({ dir: "/pick", io: f.io, answer, name: "file" });
    expect(f.files.has("/pick/album.png")).toBe(false);
    await picker.applied!(request(pre, { cycle: 1 }), [1, 2], "file");
    expect(Array.from((f.files.get("/pick/album.png")!.data as Uint8Array).subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
    await picker.pick(request(pre, { cycle: 2 }));
    expect(JSON.parse(f.files.get("/pick/b002-request.json")!.data as string).album).toBe("album.png");
  });
});

describe("claimPickDir", () => {
  const pre = world((p) => [112, 120, 128, 0][p]);
  it("gives a directory to the first run that asks, lets that run back in, and refuses any other", async () => {
    const f = fakeIo();
    expect(await claimPickDir(f.io, "/pick", "/runs/a")).toBeNull();
    expect(JSON.parse(f.files.get("/pick/owner.json")!.data as string)).toEqual({ run: "/runs/a" });
    expect(await claimPickDir(f.io, "/pick", "/runs/a")).toBeNull(); // a recovery of the same run
    expect(await claimPickDir(f.io, "/pick", "/runs/b")).toMatch(/pick directory of another run \(\/runs\/a\)/);
    f.put("/odd/owner.json", "{oops");
    expect(await claimPickDir(f.io, "/odd", "/runs/a")).toMatch(/owner\.json is unreadable/);
  });
  it("knows a run by its canonical bundle directory: another spelling of it is the same run, and the check alone writes nothing", async () => {
    const f = fakeIo();
    expect(await pickDirTaken(f.io, "/pick", "/tmp/runs/a")).toBeNull(); // unclaimed
    expect(f.files.size).toBe(0);
    expect(await claimPickDir(f.io, "/pick", "/tmp/runs/a")).toBeNull();
    expect(JSON.parse(f.files.get("/pick/owner.json")!.data as string)).toEqual({ run: "/private/tmp/runs/a" });
    expect(await claimPickDir(f.io, "/pick", "/private/tmp/runs/a")).toBeNull();
    expect(await pickDirTaken(f.io, "/pick", "/tmp/runs/a")).toBeNull();
    expect(await pickDirTaken(f.io, "/pick", "/tmp/runs/b")).toMatch(/another run/);
    // An owner written under its spelling (before owners were canonical) is still its run's.
    f.put("/old/owner.json", JSON.stringify({ run: "/tmp/runs/a" }));
    expect(await claimPickDir(f.io, "/old", "/private/tmp/runs/a")).toBeNull();
  });
  it("a dir picker with a run writes nothing into another run's directory, neither a request nor an applied record", async () => {
    const f = fakeIo();
    await claimPickDir(f.io, "/pick", "/runs/a");
    const before = [...f.files.keys()];
    const other = dirPicker({ dir: "/pick", io: f.io, answer: async () => [1], name: "file", run: "/runs/b" });
    await expect(other.pick(request(pre))).rejects.toThrow(/another run/);
    await expect(other.applied!(request(pre), [1], "file")).rejects.toThrow(/another run/);
    expect([...f.files.keys()]).toEqual(before);
    const own = dirPicker({ dir: "/pick", io: f.io, answer: async () => [1], name: "file", run: "/runs/a" });
    expect(await own.pick(request(pre))).toEqual([1]);
  });
});

describe("fileAnswerer", () => {
  const pre = world((p) => [112, 120, 128, 0][p]);
  const ask = async (f: ReturnType<typeof fakeIo>, timeoutMs = 10_000) =>
    dirPicker({ dir: "/pick", io: f.io, answer: fileAnswerer({ io: f.io, timeoutMs, pollMs: 500 }), name: "file", nonce: () => "n" }).pick(request(pre));

  it("takes an answer that appears", async () => {
    const f = fakeIo();
    f.at(2200, () => f.put("/pick/b003-picks-n.json", '{"donors":[2,1]}'));
    expect(await ask(f)).toEqual([2, 1]);
    expect(f.clock).toBeLessThan(5000);
  });
  it("waits for a half-written answer to be complete", async () => {
    const f = fakeIo();
    f.at(1000, () => f.put("/pick/b003-picks-n.json", '{"donors":[2'));
    f.at(2400, () => f.put("/pick/b003-picks-n.json", '{"donors":[2, 1]}'));
    expect(await ask(f)).toEqual([2, 1]);
    expect(f.clock).toBeGreaterThanOrEqual(2400);
  });
  it("times out when no answer appears, and never reads a late one", async () => {
    const f = fakeIo();
    f.at(10_500, () => f.put("/pick/b003-picks-n.json", "[1]"));
    await expect(ask(f)).rejects.toThrow(/no answer in b003-picks-n.json within 10 s/);
    expect(f.clock).toBeLessThan(11_500);
  });
  it("an unparsable file that stays so is an invalid answer at the deadline", async () => {
    const f = fakeIo();
    f.at(500, () => f.put("/pick/b003-picks-n.json", "{oops"));
    await expect(ask(f, 5000)).rejects.toThrow(/not a valid answer by the deadline/);
  });
  it("ignores a stale nonce and a bare array older than the request", async () => {
    const f = fakeIo();
    f.at(500, () => f.put("/pick/b003-picks-n.json", '{"donors":[0],"nonce":"old"}'));
    f.at(3000, () => f.put("/pick/b003-picks-n.json", '{"donors":[1],"nonce":"n"}'));
    expect(await ask(f)).toEqual([1]);
    const g = fakeIo();
    g.at(500, () => g.put("/pick/b003-picks-n.json", "[1]"));
    // The request is written at t = 0, the bare array at t = 500: later, so it is taken.
    expect(await ask(g)).toEqual([1]);
  });
});

describe("fileAnswerer: one answer file per request, and the deadline holds", () => {
  const pre = world((p) => [112, 120, 128, 0][p]);
  const ask = (f: ReturnType<typeof fakeIo>, nonce: string, timeoutMs = 10_000, io: PickIo = f.io) =>
    dirPicker({ dir: "/pick", io, answer: fileAnswerer({ io, timeoutMs, pollMs: 500 }), name: "file", nonce: () => nonce }).pick(request(pre));

  it("names a file per request: the request's answer path carries its nonce, and the same cycle asked again gets another", async () => {
    const f = fakeIo();
    f.at(500, () => f.put("/pick/b003-picks-n1.json", '{"donors":[2],"nonce":"n1"}'));
    expect(await ask(f, "n1")).toEqual([2]);
    expect(JSON.parse(f.files.get("/pick/b003-request.json")!.data as string).answer).toBe("b003-picks-n1.json");
    const g = fakeIo();
    await ask(g, "x/y z", 1000).catch(() => {});
    expect(JSON.parse(g.files.get("/pick/b003-request.json")!.data as string).answer).toBe("b003-picks-x-y-z.json");
  });
  it("a delayed answer of an earlier attempt, written to its own path, is never read by the next attempt", async () => {
    const f = fakeIo();
    // The first attempt times out; its answerer then publishes to the first request's path while the second request waits.
    await expect(ask(f, "first", 1000)).rejects.toThrow(/no answer in b003-picks-first.json/);
    f.at(f.clock + 600, () => f.put("/pick/b003-picks-first.json", '{"donors":[1]}'));
    f.at(f.clock + 3000, () => f.put("/pick/b003-picks-second.json", '{"donors":[2],"nonce":"second"}'));
    expect(await ask(f, "second")).toEqual([2]);
  });
  it("an object without this request's nonce is taken only if it is newer than the request", async () => {
    const f = fakeIo();
    // Already in place when the request is written is impossible (it is removed first); one dated before it is an old answer.
    f.at(0, () => {});
    const io: PickIo = { ...f.io, mtime: async (p) => (p.endsWith("request.json") ? 1000 : 400) };
    f.at(500, () => f.put("/pick/b003-picks-n.json", '{"donors":[0]}'));
    await expect(ask(f, "n", 3000, io)).rejects.toThrow(/no answer in/);
  });
  it("does not take an answer whose read finished after the deadline", async () => {
    const f = fakeIo();
    f.at(1, () => f.put("/pick/b003-picks-n.json", '{"donors":[1],"nonce":"n"}'));
    // The second stable poll starts at 1,000 ms, before the 1,500 ms deadline; its read ends at 1,600.
    const io: PickIo = { ...f.io, readText: async (p) => (await f.io.sleep(600), f.io.readText(p)) };
    await expect(ask(f, "n", 1500, io)).rejects.toThrow(/no answer in b003-picks-n.json within 2 s/);
  });
  it("does not wait on a read that never returns", async () => {
    const f = fakeIo();
    f.at(1, () => f.put("/pick/b003-picks-n.json", '{"donors":[1],"nonce":"n"}'));
    const io: PickIo = { ...f.io, readText: () => new Promise<string>(() => {}) };
    await expect(ask(f, "n", 50, io)).rejects.toThrow(/no answer in/);
  });
});

describe("commandAnswerer", () => {
  const pre = world((p) => [112, 120, 128, 0][p]);
  const run = (res: Partial<CommandResult>, seen: { argv?: readonly string[]; cwd?: string; stdin?: string; timeoutMs?: number; maxBytes?: number } = {}): RunCommand =>
    async (argv, opts) => {
      Object.assign(seen, { argv, ...opts });
      return { code: 0, stdout: '{"donors":[1]}', stderr: "", timedOut: false, ...res };
    };
  const ask = (r: RunCommand, timeoutMs = 3000) => dirPicker({ dir: "/pick", io: fakeIo().io, answer: commandAnswerer({ argv: ["picker", "--x"], run: r, timeoutMs }), name: "command:m", nonce: () => "n" }).pick(request(pre));

  it("passes the request on stdin with cwd = the pick directory, and takes the donors from stdout", async () => {
    const seen: { argv?: readonly string[]; cwd?: string; stdin?: string; timeoutMs?: number; maxBytes?: number } = {};
    expect(await ask(run({}, seen))).toEqual([1]);
    expect(seen.argv).toEqual(["picker", "--x"]);
    expect(seen.cwd).toBe("/pick");
    expect(seen.timeoutMs).toBe(3000);
    expect(JSON.parse(seen.stdin!)).toMatchObject({ version: 1, cycle: 3, nonce: "n", eligible: [1, 2] });
    expect(seen.stdin).not.toMatch(/suggest/);
  });
  it("accepts a bare array and ignores extra keys", async () => {
    expect(await ask(run({ stdout: "[2, 1]\n" }))).toEqual([2, 1]);
    expect(await ask(run({ stdout: '{"donors":[2],"notes":"x"}' }))).toEqual([2]);
  });
  it("fails on a non-zero exit with stderr in the error, on the deadline and on junk", async () => {
    await expect(ask(run({ code: 2, stderr: "model fell over\n" }))).rejects.toThrow(/picker exited with code 2: model fell over/);
    await expect(ask(run({ code: null, timedOut: true, stdout: '{"donors":[1]}' }))).rejects.toThrow(/did not answer within 3 s/);
    await expect(ask(run({ stdout: "sure, pond 1" }))).rejects.toThrow(/not JSON/);
    await expect(ask(run({ code: 1, stderr: "x".repeat(900) }))).rejects.toThrow(new RegExp(`: x{500}$`));
  });
  it("fails on output past the cap, whatever the exit code, and hands the runner the cap", async () => {
    const seen: { maxBytes?: number } = {};
    await expect(ask(run({ code: null, overflow: true, stdout: "{" }, seen))).rejects.toThrow(new RegExp(`wrote more than ${OUTPUT_LIMIT} bytes`));
    await expect(ask(run({ code: 0, overflow: true }))).rejects.toThrow(/wrote more than/);
    expect(seen.maxBytes).toBe(OUTPUT_LIMIT);
  });
});

describe("the ensemble check refuses a picked run", () => {
  it("names a picked run as no replicate of its condition", () => {
    const spec = { experiment: "e", presetId: "ponds-small", condition: "treatment", seed: 1, steps: 1000, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, picked: true as const };
    const problems = ensembleProblems([{ condition: "treatment", seed: 1, series: [], manifest: { spec, cfg: {}, ruleVersion: 0, schemaVersion: 0, summary: { steps: 1000 } } } as never]);
    expect(problems.some((p) => /picked run.*not a replicate/.test(p))).toBe(true);
  });
});
