// tools/lib/picker-prompt.ts: the model picker's prompt, answer parsing and validation, notebook and call budget.
import { describe, expect, it } from "vitest";
import { SCHEMA, buildPrompt, callAttempts, callBudgetError, claudeArgs, notebookBlock, parseClaudeResult, settleNotebook, validateModelAnswer, wantCount } from "../lib/picker-prompt.ts";
import type { PickRequestJson } from "../lib/pickers.ts";

const req = (over: Partial<PickRequestJson> = {}): PickRequestJson => ({
  version: 1, nonce: "c3-1", cycle: 3, step: 15000, dir: "/abs/picker", sheet: "b003-sheet.png", album: "album.png",
  grid: { x: 4, y: 4 }, tile: 64, ponds: 16, occupied: [0, 1, 2, 3, 5, 6], eligible: [0, 2, 3, 6], foundingMass: 3000, donors: { min: 1, max: 3 }, answer: "b003-picks.json", ...over,
});
const answer = (ponds: number[]) => ({ seen: "mostly dark with two bright ponds", picks: ponds.map((pond) => ({ pond, new: `pond ${pond} has a ring` })) });

describe("buildPrompt", () => {
  it("holds the eligible list, the exact count, the files and the notebook", () => {
    const p = buildPrompt(req(), "## Cycle 2 (t=10,000)\nSeen: x\n- pond 1: stripes\n");
    expect(p).toContain("0, 2, 3, 6");
    expect(p).toContain("exactly 3 distinct ponds");
    expect(p).toContain("b003-sheet.png");
    expect(p).toContain("album.png");
    expect(p).toContain("pond 1: stripes");
  });
  it("says so when no pond is eligible or there is no album or notebook", () => {
    const p = buildPrompt(req({ eligible: [], album: null }), "");
    expect(p).toContain("No pond is eligible");
    expect(p).toContain("0, 1, 2, 3, 5, 6");
    expect(p).toContain("no album yet");
    expect(p).toContain("first cycle");
  });
  it("never carries the arm's suggestion", () => {
    expect(JSON.stringify(Object.keys(req()).sort())).not.toContain("suggested");
    expect(buildPrompt(req(), "")).not.toMatch(/suggest|score|rank/i);
  });
});

describe("claudeArgs", () => {
  it("is lean: one tool, restricted, no MCP, no settings, no session", () => {
    const args = claudeArgs("sonnet", "hi", 0.5);
    for (const [flag, value] of [["--model", "sonnet"], ["--tools", "Read"], ["--setting-sources", ""], ["--max-budget-usd", "0.5"], ["--permission-mode", "default"]]) expect(args[args.indexOf(flag) + 1]).toBe(value);
    for (const flag of ["--restricted", "--strict-mcp-config", "--no-session-persistence"]) expect(args).toContain(flag);
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1])).toEqual(SCHEMA);
    expect(args).not.toContain("--bare");
  });
});

describe("parseClaudeResult", () => {
  const result = { type: "result", is_error: false, duration_ms: 4800, total_cost_usd: 0.018, structured_output: answer([3, 0]) };
  it("takes the single object", () => {
    const r = parseClaudeResult(JSON.stringify(result));
    expect(r.picks.map((p) => p.pond)).toEqual([3, 0]);
    expect([r.costUsd, r.ms]).toEqual([0.018, 4800]);
  });
  it("takes the result element of an array", () => {
    const r = parseClaudeResult(JSON.stringify([{ type: "system" }, { type: "assistant" }, result]));
    expect(r.seen).toBe("mostly dark with two bright ponds");
  });
  it("falls back to the result text", () => {
    const r = parseClaudeResult(JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(answer([1])) }));
    expect(r.picks).toEqual([{ pond: 1, new: "pond 1 has a ring" }]);
  });
  it("fails on is_error, junk and a missing answer", () => {
    expect(() => parseClaudeResult(JSON.stringify({ ...result, is_error: true, result: "boom" }))).toThrow(/boom/);
    expect(() => parseClaudeResult("not json")).toThrow(/no JSON/);
    expect(() => parseClaudeResult(JSON.stringify([{ type: "assistant" }]))).toThrow(/no result/);
    expect(() => parseClaudeResult(JSON.stringify({ type: "result", result: "prose" }))).toThrow(/not the JSON answer/);
    expect(() => parseClaudeResult(JSON.stringify({ type: "result", structured_output: { seen: "x" } }))).toThrow(/seen and picks/);
  });
});

describe("validateModelAnswer", () => {
  it("accepts exactly the wanted count from the eligible pool, in any order", () => {
    expect(validateModelAnswer(answer([6, 0, 3]), req())).toBeNull();
  });
  it("refuses a repeat, an ineligible or unknown pond, a wrong count, a non-integer and an empty sentence", () => {
    expect(validateModelAnswer(answer([0, 0, 3]), req())).toMatch(/repeat/);
    expect(validateModelAnswer(answer([0, 3, 5]), req())).toMatch(/not in the pool/);
    expect(validateModelAnswer(answer([0, 3, 99]), req())).toMatch(/not in the pool/);
    expect(validateModelAnswer(answer([0, 3]), req())).toMatch(/exactly 3/);
    expect(validateModelAnswer(answer([0, 3, 6, 2]), req())).toMatch(/exactly 3/);
    expect(validateModelAnswer(answer([0, 3, 1.5]), req())).toMatch(/integer/);
    expect(validateModelAnswer({ seen: "x", picks: [{ pond: 0, new: " " }, { pond: 2, new: "a" }, { pond: 3, new: "b" }] }, req())).toMatch(/what is new/);
    expect(validateModelAnswer({ seen: " ", picks: answer([0, 2, 3]).picks }, req())).toMatch(/looks like/);
  });
  it("draws on the occupied ponds when none is eligible, and caps the count at the pool", () => {
    expect(validateModelAnswer(answer([5, 1, 0]), req({ eligible: [] }))).toBeNull();
    expect(wantCount(req({ eligible: [4], donors: { min: 1, max: 3 } }))).toBe(1);
    expect(validateModelAnswer(answer([4]), req({ eligible: [4] }))).toBeNull();
  });
});

describe("notebook", () => {
  it("writes a block per cycle", () => {
    expect(notebookBlock(3, 15000, answer([5, 2]))).toBe("## Cycle 3 (t=15,000)\nSeen: mostly dark with two bright ponds\n- pond 5: pond 5 has a ring\n- pond 2: pond 2 has a ring\n");
  });
  it("promotes a pending block only once the run has gone past its cycle with exactly its donors applied", () => {
    const pending = { nonce: "n", cycle: 2, donors: [5, 2], applied: "b002-applied.json", block: "## Cycle 2 (t=10,000)\nSeen: x\n" };
    const committed = { cycle: 2, donors: [5, 2] };
    expect(settleNotebook("", pending, 3, committed)).toBe(pending.block);
    expect(settleNotebook("## Cycle 1\n", pending, 3, committed)).toBe("## Cycle 1\n\n" + pending.block);
    expect(settleNotebook("## Cycle 1\n", pending, 2, committed)).toBe("## Cycle 1\n"); // a recovery asking again: the stale block is dropped
    expect(settleNotebook("## Cycle 1\n", undefined, 2)).toBe("## Cycle 1\n");
  });
  it("drops a pending block the run never applied as written", () => {
    const pending = { nonce: "n", cycle: 2, donors: [5, 2], applied: "b002-applied.json", block: "## Cycle 2 (t=10,000)\nSeen: x\n" };
    expect(settleNotebook("## Cycle 1\n", pending, 3)).toBe("## Cycle 1\n"); // a crash before the commit: nothing on record
    expect(settleNotebook("## Cycle 1\n", pending, 3, { cycle: 2, donors: [5, 3] })).toBe("## Cycle 1\n"); // a recovery replayed other donors there
    expect(settleNotebook("## Cycle 1\n", pending, 3, { cycle: 2, donors: [2, 5] })).toBe("## Cycle 1\n"); // the order is part of the choice
    expect(settleNotebook("## Cycle 1\n", pending, 3, { cycle: 1, donors: [5, 2] })).toBe("## Cycle 1\n"); // another boundary's record
    const old = { nonce: "n", cycle: 2, block: "## Cycle 2\n" } as unknown as typeof pending; // a pending.json from before donors were kept
    expect(settleNotebook("", old, 3, { cycle: 2, donors: [5, 2] })).toBe("");
  });
});

describe("call budget", () => {
  const line = (status: string) => JSON.stringify({ status }) + "\n";
  it("counts attempts, not successes", () => {
    const log = line("started") + line("error") + line("started") + line("ok") + '{"by":"plan flag trial 1"}\n' + "junk\n";
    expect(callAttempts(log)).toBe(2);
    expect(callBudgetError(log, 3)).toBeNull();
    expect(callBudgetError(log, 2)).toMatch(/2 attempts/);
  });
});
