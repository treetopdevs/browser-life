// Declared-cell births (WorldConfig.cellPeriod; docs/sandbox-cells.md) are replayed from the pass's own
// draws, not from the in-step mutation draws: applyMutation must reproduce the genome applyCellPass wrote.
import { describe, expect, it } from "vitest";
import { CH, GENOME_CHANNELS, M3_FOUNDERS, NN_BYTES, buildWorld, defaultConfig, encodeGenome, founderGenome, packLineageLo, type WorldConfig, type WorldState } from "@bl/schema";
import { applyCellPass } from "@bl/sim-ref";
import { applyMutation, expressionOf, mutationSite, type Probe } from "../src/genotype.ts";

const W = 32;
const base = { tileW: W, tileH: W, kernelRadius: 3, seed: 91, mutRate: 0, cellPeriod: 100 } as const;
/** Founder 0 as `count` separate 3 x 3 bodies (mass 540 each) at step `step`, all under founder id 1. */
function bodies(cfg: WorldConfig, step: number, count: number): { state: WorldState; parent: Uint32Array; parentKey: string } {
  const s = buildWorld(cfg, { nutrient: 16, founders: [] });
  s.step = step;
  const n = W * W, parent = encodeGenome(founderGenome(M3_FOUNDERS[0]), 0, packLineageLo(cfg, 1));
  for (let k = 0; k < count; k++) {
    const x0 = 1 + 5 * (k % 6), y0 = 1 + 5 * Math.floor(k / 6);
    for (let y = y0; y < y0 + 3; y++)
      for (let x = x0; x < x0 + 3; x++) {
        s.cells[CH.B * n + y * W + x] = 60;
        for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + y * W + x] = parent[g];
      }
  }
  return { state: s, parent, parentKey: `0:${packLineageLo(cfg, 1)}` };
}
/** Applies one pass and checks the replay of every birth; returns the slots that mutated. */
function replayAll(cfg: WorldConfig, step: number): { births: number; mutated: number; slots: number[] } {
  const { state, parent, parentKey } = bodies(cfg, step, 30);
  const n = W * W;
  const births = applyCellPass(state);
  const slots: number[] = [];
  for (const b of births) {
    const child = `${b.childHi}:${b.childLo}`;
    const r = applyMutation(parent, child, parentKey, cfg);
    const actual = Uint32Array.from({ length: GENOME_CHANNELS }, (_, g) => state.genome[g * n + b.anchor]);
    expect(Array.from(r.words)).toEqual(Array.from(actual));
    // One convention with in-step mutations: `step` is the last step before the lineage exists.
    expect(r.mutation.step).toBe(step - 1);
    expect(r.mutation.cell).toBe(b.anchor);
    // The pass reports a daughter as mutated only when its genome changed; the replay separates the
    // draw (cellBirth.mutated) from a clamp that left the genome as it was.
    expect(r.mutation.cellBirth!.mutated && !r.mutation.clamped).toBe(b.mutated);
    expect(mutationSite(child, cfg).cellBirth).toEqual(r.mutation.cellBirth);
    if (b.mutated) slots.push(r.mutation.slot);
  }
  return { births: births.length, mutated: births.filter((b) => b.mutated).length, slots };
}

describe("lineage replay of declared-cell births", () => {
  it("reproduces every daughter's genome, mutated or not, from its id and its parent's genome", () => {
    // Half of the daughters mutate, so both branches of the pass's draw are replayed.
    const r = replayAll(defaultConfig({ ...base, cellMutProb: 2 ** 31 }), 300);
    expect(r.births).toBe(29);
    expect(r.mutated).toBeGreaterThan(5);
    expect(r.mutated).toBeLessThan(24);
  });

  it.each([
    ["a ring namespace", { ringNamespace: 5 }, 0],
    ["two kernel rings", { shapeReach: 3 }, 2],
    ["three kernel rings and a ring namespace", { shapeReach: 6, ringNamespace: 9 }, 3],
  ] as const)("replays births under %s", (_name, extra, rings) => {
    const cfg = defaultConfig({ ...base, cellMutProb: 2 ** 32, ...extra });
    const seen = new Set<number>();
    let births = 0;
    // Passes at many steps, until every ring slot has mutated at least once (29 births per pass).
    for (let step = 100; step <= 20_000 && (births === 0 || [...Array(rings).keys()].some((k) => !seen.has(NN_BYTES + 3 + k))); step += 100) {
      const r = replayAll(cfg, step);
      births += r.births;
      for (const s of r.slots) seen.add(s);
    }
    expect(births).toBeGreaterThan(0);
    for (let k = 0; k < rings; k++) expect(seen.has(NN_BYTES + 3 + k)).toBe(true);
    // No slot beyond the configured count is ever drawn.
    expect(Math.max(...seen)).toBeLessThan(NN_BYTES + 3 + rings);
  });

  it("leaves the replay of in-step mutations as it was, and classifies a ring mutation as physics", () => {
    const site = mutationSite("300:50", defaultConfig());
    expect(site.step).toBe(299);
    expect(site.cellBirth).toBeUndefined();
    const same = { outs: new Int16Array(8) } as unknown as Probe;
    const m = { kind: "ring", clamped: false } as Parameters<typeof expressionOf>[0];
    expect(expressionOf(m, same, same).expression).toBe("physics");
  });
});
