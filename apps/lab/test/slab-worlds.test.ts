// The slab viewer's setting tables against the committed records they cite, and its setter against the spike's own bounds.
import { describe, expect, it } from "vitest";
import { presetById, presetConfig } from "@bl/schema";
import { applySettings } from "../../../experiments/3d-rps/gate0-spike/adapter.ts";
import { RPS } from "../../../experiments/3d-rps/gate0-spike/shaders3d-rps.ts";
import { jobConfig } from "../../../experiments/3d-rps/gate0-spike/rungs.ts";
import amendment1 from "../../../experiments/3d-rps/GATE0-EXPLORATION.md?raw";
import amendment2 from "../../../experiments/3d-rps/GATE0-EXPLORATION-2.md?raw";
import m4 from "../../../experiments/3d-slab/m4-results.tsv?raw";
import {
  CYCLIC_RECORDS, CYCLIC_SIZES, DEFAULT_CYCLIC, DEFAULT_ECO, ECO_OPTIONS, ECO_SIZES, KILL_OPTIONS, PACES, SPREAD,
  cyclicConfig, cyclicRecord, cyclicSettings, ecoConfig, ecoRecordId,
} from "../src/slab/settings.ts";

interface Row { id: string; shape: string; kill: string; spread: number; rate: number; seed: number; klass: string }
/** Job rows of the two exploration tables (Amendment 1 rows carry a source column and no shape: its jobs are 128 x 128 x 4). */
function rows(md: string): Row[] {
  const out: Row[] = [];
  for (const line of md.split("\n")) {
    if (!/^\| g[0-9]-/.test(line)) continue;
    const c = line.split("|").slice(1, -1).map((x) => x.trim());
    const st = c.findIndex((x) => x.startsWith("g0."));
    const shape = c.find((x) => /^\d+x\d+x\d+$/.test(x)) ?? "128x128x4";
    const first = st + 1 + (/^\d+x\d+x\d+$/.test(c[st + 1]) ? 1 : 0);
    out.push({ id: c[0], shape, kill: c.find((x) => x === "removal" || x === "vacancy")!, spread: Number(c[first]), rate: Number(c[first + 1]), seed: Number(c[first + 2]), klass: c[first + 4] });
  }
  return out;
}
const table = [...rows(amendment1), ...rows(amendment2)];

describe("recorded settings", () => {
  it("every recorded setting names a job id that appears verbatim in the committed tables, with matching shape, seed, kill form and rate", () => {
    expect(table.length).toBeGreaterThan(50);
    for (const r of CYCLIC_RECORDS) {
      const row = table.find((t) => t.id === r.id);
      expect(row, r.id).toBeTruthy();
      expect({ shape: row!.shape, kill: row!.kill, rate: row!.rate, spread: row!.spread, seed: row!.seed, klass: row!.klass }).toEqual({ shape: r.shape, kill: r.kill, rate: r.rate, spread: r.spread, seed: r.seed, klass: r.klass });
    }
    for (const o of ECO_OPTIONS) for (const seed of [101, 102, 103]) {
      const id = ecoRecordId({ size: [256, 256, 8], option: o.id, seed })!;
      expect(m4.split("\n").some((l) => l.startsWith(`${id}\t`)), id).toBe(true);
    }
  });

  it("a tuple with no matching row is labelled not recorded and names no job id", () => {
    expect(cyclicRecord({ ...DEFAULT_CYCLIC })?.id).toBe("g2-confirm-V-sp8-r64-s401");
    expect(cyclicRecord({ ...DEFAULT_CYCLIC, seed: 7 })).toBeNull();
    expect(cyclicRecord({ ...DEFAULT_CYCLIC, burnIn: false })).toBeNull();
    expect(cyclicRecord({ ...DEFAULT_CYCLIC, size: [128, 128, 4] })).toBeNull(); // no vacancy job at 128
    expect(cyclicRecord({ ...DEFAULT_CYCLIC, size: [128, 128, 4], kill: "none", seed: 403 })?.id).toBe("g0-horizon-S0-sp8-r0-s403");
    expect(ecoRecordId({ ...DEFAULT_ECO, size: [128, 128, 8] })).toBeNull();
    expect(ecoRecordId({ ...DEFAULT_ECO, seed: 555 })).toBeNull();
    expect(ecoRecordId(DEFAULT_ECO)).toBe("mu40-s20-k1024-seed101");
  });

  it("the default cyclic config equals jobConfig(S0, 256 x 256 x 4, spread 8, seed 401) and the setter accepts only bounded inputs", () => {
    expect(cyclicConfig(DEFAULT_CYCLIC)).toEqual(jobConfig("S0", [256, 256, 4], 8, 401));
    expect(SPREAD).toBe(8);
    for (const k of KILL_OPTIONS) for (const phase of ["burn", "run"] as const) {
      applySettings(cyclicSettings({ ...DEFAULT_CYCLIC, kill: k.id }, phase));
      expect(RPS.rate).toBe(phase === "burn" ? 0 : k.rate);
      expect(RPS.min).toBe(4);
    }
    expect(() => applySettings({ rpsKill: "vacancy", rpsRate: 1e6, rpsMin: 4 })).toThrow();
    expect(() => applySettings({ rpsKill: "vacancy", rpsRate: 64, rpsMin: 0 })).toThrow();
    RPS.on = false; RPS.rate = 0;
  });

  it("the default ecology config equals what m4-calibrate.ts builds for mu40-s20-k1024, seed 101 (at 256 x 256 x 8)", () => {
    const want = presetConfig(presetById("slab-spots")!, 101, { defaultMu: 40, defaultSigma: 20, lightK: 1024 });
    expect(ecoConfig(DEFAULT_ECO)).toEqual(want);
    expect([want.tileW, want.tileH, want.tileD]).toEqual([256, 256, 8]);
    expect(ecoConfig({ ...DEFAULT_ECO, size: [128, 128, 8] }).tileW).toBe(128);
  });

  it("every option has plain-language text, and no hype words", () => {
    const texts = [...KILL_OPTIONS.map((k) => k.title + k.text), ...ECO_OPTIONS.map((o) => o.title + o.text), ...PACES.map((p) => p.title + p.text)];
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(30);
      expect(t).not.toMatch(/\b(amazing|stunning|revolutionary|breakthrough|incredible|magical)\b/i);
    }
    expect(CYCLIC_SIZES.length + ECO_SIZES.length).toBe(4);
  });
});
