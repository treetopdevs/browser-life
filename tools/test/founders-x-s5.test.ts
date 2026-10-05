// S5 (S1 + producers interleaved) must not move S1/S2/S4 seeds or genomes.
// Spawns `founders-x.ts plan` and compares the S1–S4 slice of the plan files to a frozen baseline.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, cpSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname!, "../..");
const BASELINE = join(REPO, "runs/foundations/results");

describe("founders-x S5 plan identity", () => {
  it("interleaveGenomes alternates and preserves all members", async () => {
    // Import via deno eval — vitest cannot load the Deno CLI module directly.
    const out = execFileSync(
      "deno",
      [
        "eval",
        `
        import { interleaveGenomes } from "./tools/founders-x.ts";
        const a = ["A0","A1","A2","A3"];
        const b = ["B0","B1","B2","B3","B4","B5","B6","B7","B8"];
        console.log(JSON.stringify(interleaveGenomes(a,b)));
        `,
      ],
      { cwd: REPO, encoding: "utf8" },
    ).trim();
    expect(JSON.parse(out)).toEqual([
      "A0", "B0", "A1", "B1", "A2", "B2", "A3", "B3", "B4", "B5", "B6", "B7", "B8",
    ]);
  });

  it("plan keeps S1/S2/S4 run lines and seeds identical; S5 is setIndex 3", () => {
    if (!existsSync(join(BASELINE, "fd-subjects.json")) || !existsSync(join(BASELINE, "fx-c-runs.txt"))) {
      return; // no local foundations results; skip rather than fail CI without fixtures
    }
    const beforeRuns = readFileSync(join(BASELINE, "fx-c-runs.txt"), "utf8").trimEnd().split("\n");
    const beforePlan = JSON.parse(readFileSync(join(BASELINE, "fx-c-plan.json"), "utf8"));
    // Baseline may already include S5 after the first regeneration; take the S1/S2/S4 slice.
    const s124 = beforeRuns.filter((l) => {
      const seed = Number(l.split(" ")[2]);
      return seed >= 4_740_001 && seed < 4_740_031; // setIndex 0–2
    });
    expect(s124.length).toBe(24);

    const out = mkdtempSync(join(tmpdir(), "fx-s5-"));
    try {
      cpSync(join(BASELINE, "fd-subjects.json"), join(out, "fd-subjects.json"));
      // B plan needs cloud sources; copy existing B plan inputs by pointing --out at a dir
      // that already has fd-subjects; planB tolerates missing cloud sources.
      execFileSync("deno", ["run", "-A", "tools/founders-x.ts", "plan", "--out", out], {
        cwd: REPO,
        encoding: "utf8",
      });
      const afterRuns = readFileSync(join(out, "fx-c-runs.txt"), "utf8").trimEnd().split("\n");
      const afterPlan = JSON.parse(readFileSync(join(out, "fx-c-plan.json"), "utf8"));
      const after124 = afterRuns.filter((l) => {
        const seed = Number(l.split(" ")[2]);
        return seed >= 4_740_001 && seed < 4_740_031;
      });
      expect(after124).toEqual(s124);

      const s5 = afterRuns.filter((l) => Number(l.split(" ")[2]) >= 4_740_031 && Number(l.split(" ")[2]) <= 4_740_038);
      expect(s5.length).toBe(8);
      expect(s5.every((l) => l.includes("gradient-m3 ") && !l.includes("waste"))).toBe(true);

      const byId = Object.fromEntries(afterPlan.sets.map((s: any) => [s.id, s]));
      expect(byId.S1.setIndex).toBe(0);
      expect(byId.S2.setIndex).toBe(1);
      expect(byId.S4.setIndex).toBe(2);
      expect(byId.S5.setIndex).toBe(3);
      expect(byId.S5.genomes.length).toBe(13);
      expect(afterPlan.s5Ordering.length).toBe(13);
      expect(afterPlan.s5Ordering.filter((o: any) => o.source === "S1").length).toBe(4);
      expect(afterPlan.s5Ordering.filter((o: any) => o.source === "S2").length).toBe(9);
      // First four discs alternate S1, S2, S1, S2.
      expect(afterPlan.s5Ordering.slice(0, 4).map((o: any) => o.source)).toEqual(["S1", "S2", "S1", "S2"]);

      // S1/S2/S4 genomes unchanged vs baseline plan's matching sets.
      for (const id of ["S1", "S2", "S4"]) {
        const prev = beforePlan.sets.find((s: any) => s.id === id);
        if (prev) expect(byId[id].genomes).toEqual(prev.genomes);
      }

      // B founder-run list identity when cloud sources exist (hash of lines that were already planned).
      if (existsSync(join(BASELINE, "fx-b-founders-runs.txt")) && existsSync(join(out, "fx-b-founders-runs.txt"))) {
        const h = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
        // Only assert if both are non-empty (missing clouds yield empty files).
        const a = readFileSync(join(BASELINE, "fx-b-founders-runs.txt"), "utf8");
        const b = readFileSync(join(out, "fx-b-founders-runs.txt"), "utf8");
        if (a.length && b.length) expect(h(join(out, "fx-b-founders-runs.txt"))).toBe(h(join(BASELINE, "fx-b-founders-runs.txt")));
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
