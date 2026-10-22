// The shell readout (apps/lab/src/shell.ts; docs/pond-keeper-v3-2026-10-22.md, section 3): which living cells of a snapshot hold at
// least the shell's worth of membrane. Hand-built states pin the count, and one step of the reference physics under a wound at every
// cell pins the rule it reads, with margins wide enough that BUILD and decay between cannot flip either cell.
import { describe, expect, it } from "vitest";
import { CH, G, buildWorld, cellCount, cloneState, defaultConfig, generalistGenome, type WorldConfig, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { fmtShare, shellCount } from "../src/shell.ts";

const tile = { tileW: 24, tileH: 24, kernelRadius: 2 } as const;
/** A wound at every cell on every step (as packages/sim-ref/test/injury.test.ts builds one), with a shell of 2. */
const wounded = { injuryPeriod: 1, injuryRadius: 0, injuryProb: 2 ** 32 - 1, injuryShell: 2 } as const;

/**
 * Two founder discs far apart on a 24 x 24 tile (farther than a cell's matter moves in a step): 13 living cells in each, every one
 * given biomass 50 and no membrane, so the test plants what it counts. The first 13 living cells in raster order are the upper disc.
 */
function world(extra: Partial<WorldConfig> = {}): WorldState {
  const cfg = defaultConfig({ ...tile, ...extra });
  const genome = generalistGenome(cfg.defaultMu, cfg.defaultSigma);
  const s = buildWorld(cfg, {
    nutrient: 20,
    founders: [{ x: 5, y: 5, radius: 2, genome, biomass: 100, energy: 200 }, { x: 17, y: 17, radius: 2, genome, biomass: 100, energy: 200 }],
  });
  const n = cellCount(cfg);
  for (let i = 0; i < n; i++) {
    if (living(s, i)) {
      s.cells[CH.B * n + i] = 50;
      s.cells[CH.P * n + i] = 0;
    }
  }
  return s;
}
const living = (s: WorldState, i: number) => {
  const n = cellCount(s.cfg);
  return (s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0;
};
const livingCells = (s: WorldState) => Array.from({ length: cellCount(s.cfg) }, (_, i) => i).filter((i) => living(s, i));
const setP = (s: WorldState, i: number, p: number) => { s.cells[CH.P * cellCount(s.cfg) + i] = p; };

describe("shellCount", () => {
  it("counts a living cell at the shell, not one below it, and not a cell with no lineage that holds membrane", () => {
    const s = world({ ...wounded });
    const cells = livingCells(s);
    expect(cells).toHaveLength(26);
    const outside = Array.from({ length: cellCount(s.cfg) }, (_, i) => i).find((i) => !living(s, i))!;
    setP(s, cells[0], 2); // exactly the shell: counts
    setP(s, cells[1], 1); // one below: does not
    setP(s, cells[2], 3); // above: counts
    setP(s, cells[3], 0); // none: does not
    setP(s, outside, 50); // membrane without a lineage: not even living
    expect(shellCount(s.cfg, s.cells, s.genome)).toEqual({ wearing: 2, living: 26 });
    // Another shell, the same cells: 3 and above only.
    expect(shellCount({ ...s.cfg, injuryShell: 3 }, s.cells, s.genome)).toEqual({ wearing: 1, living: 26 });
    expect(shellCount({ ...s.cfg, injuryShell: 1 }, s.cells, s.genome)).toEqual({ wearing: 3, living: 26 });
  });

  it("reads a census's genome head as it reads a state's genome: the first channels are all it needs", () => {
    const s = world({ ...wounded });
    const n = cellCount(s.cfg);
    for (const i of livingCells(s).slice(0, 4)) setP(s, i, 9);
    expect(shellCount(s.cfg, s.cells, s.genome.slice(0, n * 4))).toEqual(shellCount(s.cfg, s.cells, s.genome));
    expect(shellCount(s.cfg, s.cells, s.genome.slice(0, n * 4))).toEqual({ wearing: 4, living: 26 });
  });

  it("is null without a shell in the config, and zero wearing in a world that has none yet", () => {
    const s = world({ injuryPeriod: 13, injuryRadius: 3, injuryProb: 100_000 });
    expect("injuryShell" in s.cfg).toBe(false);
    for (const i of livingCells(s)) setP(s, i, 9);
    expect(shellCount(s.cfg, s.cells, s.genome)).toBeNull();
    expect(shellCount(defaultConfig(tile), s.cells, s.genome)).toBeNull();
    const none = world({ ...wounded });
    expect(shellCount(none.cfg, none.cells, none.genome)).toEqual({ wearing: 0, living: 26 });
  });

  it("is the rule's own eligibility: one step under a wound at every cell, a cell far above the shell keeps its lineage and one holding none loses it", () => {
    // BUILD is off (kBuild 0), so a cell with no membrane cannot build its way over the shell inside the step, and membrane far above
    // the shell is not decayed under it: the readout's two classes are the rule's two outcomes, with no chance in between. The
    // keepers are one disc and the losers the other, so no membrane is carried from one to the other before the wound.
    const s = world({ kBuild: 0, ...wounded });
    const n = cellCount(s.cfg);
    const cells = livingCells(s);
    const keepers = cells.slice(0, 13), losers = cells.slice(13);
    for (const i of keepers) setP(s, i, 100);
    expect(shellCount(s.cfg, s.cells, s.genome)).toEqual({ wearing: 13, living: 26 });

    // The same step without the wound shows what the cells hold when the injury branch reads them (after BUILD, transport and the decays).
    const { injuryPeriod, injuryRadius, injuryProb, injuryShell, ...rest } = s.cfg;
    void injuryPeriod; void injuryRadius; void injuryProb; void injuryShell;
    const twin = new RefSim({ ...cloneState(s), cfg: rest as WorldConfig });
    twin.step();
    for (const i of keepers) expect(twin.state.cells[CH.P * n + i]).toBeGreaterThanOrEqual(2 * 2);
    for (const i of losers) expect(twin.state.cells[CH.P * n + i]).toBe(0);

    const sim = new RefSim(cloneState(s));
    sim.step();
    for (const i of keepers) {
      // Weathered: the lineage and the body stay, and exactly the shell's worth of membrane is spent.
      expect(sim.state.genome[G.LIN_HI * n + i] | sim.state.genome[G.LIN_LO * n + i]).not.toBe(0);
      expect(sim.state.genome[G.LIN_LO * n + i]).toBe(s.genome[G.LIN_LO * n + i]);
      expect(sim.state.cells[CH.P * n + i]).toBe(twin.state.cells[CH.P * n + i] - 2);
    }
    for (const i of losers) {
      // Lost: the wound clears it as a lesion does.
      expect(sim.state.genome[G.LIN_HI * n + i] | sim.state.genome[G.LIN_LO * n + i]).toBe(0);
      expect([sim.state.cells[CH.B * n + i], sim.state.cells[CH.P * n + i], sim.state.cells[CH.E * n + i]]).toEqual([0, 0, 0]);
    }
    // The lower disc is gone from the readout, and the upper disc's cells are all still living.
    const after = shellCount(sim.state.cfg, sim.state.cells, sim.state.genome)!;
    expect(after.living).toBeGreaterThanOrEqual(keepers.length);
    expect(livingCells(sim.state).filter((i) => losers.includes(i))).toEqual([]);
  });
});

describe("fmtShare", () => {
  it("prints one decimal and a percent sign, and never 0.0% for a share above zero", () => {
    expect(fmtShare(47.24)).toBe("47.2%");
    expect(fmtShare(1.7)).toBe("1.7%");
    expect(fmtShare(0.1)).toBe("0.1%");
    expect(fmtShare(0.05)).toBe("0.1%");
    // 2 of 6,354 living cells is 0.03%: one decimal would read 0.0% beside a row that counts two cells.
    expect(fmtShare((100 * 2) / 6354)).toBe("<0.1%");
    expect(fmtShare(0.0001)).toBe("<0.1%");
    // Zero is zero (the row says "none yet" there, and the chart prints its latest value).
    expect(fmtShare(0)).toBe("0.0%");
  });
});
