import { describe, expect, it } from "vitest";
import { PRESETS, presetConfig } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { conditionById } from "../src/conditions.ts";

// Mean light over one tile and (for seasons) one full cycle, from the reference light function.
function meanLight(cfg: ReturnType<typeof presetConfig>): number {
  const sim = Object.create(RefSim.prototype) as RefSim;
  (sim as unknown as { cfg: typeof cfg }).cfg = cfg;
  const period = Math.max(1, cfg.seasonPeriod);
  let sum = 0;
  for (let t = 0; t < period; t += 7) for (let y = 0; y < cfg.tileH; y += 3) for (let x = 0; x < cfg.tileW; x += 3) sum += sim.light(x, y, t);
  const count = Math.ceil(period / 7) * Math.ceil(cfg.tileH / 3) * Math.ceil(cfg.tileW / 3);
  return sum / count;
}

describe("controls preserve mean illumination (review 4)", () => {
  for (const [preset, cond] of [
    ["seasons", "fixed-env"],
    ["gradient", "uniform-light"],
  ] as const) {
    it(`${cond} on ${preset}`, () => {
      const base = presetConfig(PRESETS.find((p) => p.id === preset)!, 1);
      const ctl = { ...base, ...conditionById(cond).apply(base) };
      expect(Math.abs(meanLight(ctl) - meanLight(base))).toBeLessThan(1);
    });
  }
});

describe('no-signal-motility removes adhesion too (plan\'s "no adhesion/signal actuators" control)', () => {
  it("turns adhesion off when the input config set it", () => {
    const base = presetConfig(PRESETS.find((p) => p.id === "gradient")!, 1, { adhesion: true, kAdhesion: 512 });
    const patch = conditionById("no-signal-motility").apply(base);
    expect(patch.adhesion).toBe(false);
    expect(patch.kEmit).toBe(0);
    expect(patch.motility).toBe(false);
  });

  it("does not add an adhesion key when the input config never had one (would change its digest)", () => {
    const base = presetConfig(PRESETS.find((p) => p.id === "gradient")!, 1);
    expect(base.adhesion).toBeUndefined();
    const patch = conditionById("no-signal-motility").apply(base);
    expect("adhesion" in patch).toBe(false);
    const ctl = { ...base, ...patch };
    expect(ctl.adhesion).toBeUndefined();
  });
});

describe("no-migration control", () => {
  it("disables migration on the archipelago preset (which has it configured)", () => {
    const base = presetConfig(PRESETS.find((p) => p.id === "archipelago")!, 1);
    expect(base.migrationPeriod).toBeGreaterThan(0);
    expect(base.migrantCount).toBeGreaterThan(0);
    const ctl = { ...base, ...conditionById("no-migration").apply(base) };
    expect(ctl.migrationPeriod).toBe(0);
    expect(ctl.migrantCount).toBe(0);
  });

  it("is a no-op (never throws) on presets without tile migration configured -- it may still be meaningful via a metapopulation, which apply() has no visibility into (see specConfig, runner.ts)", () => {
    for (const id of ["spots", "gradient", "soup", "seasons", "large"]) {
      const base = presetConfig(PRESETS.find((p) => p.id === id)!, 1);
      expect(conditionById("no-migration").apply(base)).toEqual({});
    }
  });
});
