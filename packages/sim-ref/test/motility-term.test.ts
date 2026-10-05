// The shared motility term (@bl/schema's motilityTerm and motilityReader) against the rule itself: what `flow`
// adds to a cell's displacement when the config's `motility` is on. The breeder's "drive" score and tools/breed.ts
// read movement through motilityReader, so it must be flow's term for every kind of cell: thick and thin, with and
// without a lineage, in a neutral run, and with motility off.
import { describe, expect, it } from "vitest";
import { CH, G, PRESETS, cellCount, cloneState, initWorld, motilityReader, motilityTerm, pondDrives, pondTraits, presetConfig, type WorldConfig, type WorldState } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;

/**
 * A world whose four lineages (one per pond) carry different gains and whose living cells carry varied motility
 * outputs, some of them thinned below the census support threshold. A lineage's genome is the same in all its cells.
 */
function movers(extra: Partial<WorldConfig> = {}): WorldState {
  const s = initWorld(presetConfig(pondsSmall, 1, extra), pondsSmall.init);
  const n = cellCount(s.cfg);
  const gains = [12, 60, 200, 255], gainOf = new Map<string, number>();
  let k = 0;
  for (let i = 0; i < n; i++) {
    const hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    k++;
    const key = `${hi}:${lo}`;
    if (!gainOf.has(key)) gainOf.set(key, gains[gainOf.size % gains.length]);
    s.genome[G.PARAM1 * n + i] = ((s.genome[G.PARAM1 * n + i] & 0xffffff00) | gainOf.get(key)!) >>> 0;
    s.cells[CH.MOT * n + i] = ((k * 53) % 256) | (((k * 101) % 256) << 8);
    if (k % 3 === 0) {
      // Thin the cell to B+P = 20, its matter kept as nutrient: flow still moves it, the census does not count it.
      s.cells[CH.A * n + i] += s.cells[CH.B * n + i] + s.cells[CH.P * n + i] - 20;
      s.cells[CH.B * n + i] = 20;
      s.cells[CH.P * n + i] = 0;
    }
  }
  return s;
}

/** flow's displacement of every cell, (dx, dy) in 1/64 cell, for `state` under `cfg` (the private passes of one step, run in order). */
function flowDisp(state: WorldState, cfg: WorldConfig): [number, number][] {
  const sim = new RefSim({ ...cloneState(state), cfg }) as unknown as { affinity(): void; flow(): void; disp: Uint32Array };
  sim.affinity();
  sim.flow();
  return Array.from(sim.disp, (d) => [(d & 0xff) - 64, ((d >>> 8) & 0xff) - 64] as [number, number]);
}

describe("motilityTerm", () => {
  it("is (byte - 128) * gain / 256 truncated toward zero", () => {
    expect(motilityTerm(160, 12)).toBe(1); // 32 * 12 / 256 = 1.5
    expect(motilityTerm(96, 12)).toBe(-1); // -1.5, where floor would give -2
    expect(motilityTerm(0, 3)).toBe(-1);
    expect(motilityTerm(255, 255)).toBe(126);
    expect(motilityTerm(0, 255)).toBe(-127); // the largest size on an axis, so |dx| + |dy| <= 254
    expect(motilityTerm(128, 255)).toBe(0);
    expect(motilityTerm(149, 12)).toBe(0); // 0.98
  });
});

describe("motilityReader against flow", () => {
  for (const [name, extra] of [["an ordinary run", {}], ["a neutral run", { neutral: true }]] as const) {
    it(`is the difference motility makes to flow's displacement in ${name}, for thick and thin cells alike`, () => {
      const s = movers(extra);
      const n = cellCount(s.cfg);
      const on = flowDisp(s, { ...s.cfg, motility: true }), off = flowDisp(s, { ...s.cfg, motility: false });
      const read = motilityReader({ ...s, cfg: { ...s.cfg, motility: true } });
      const dmax = 64 - s.cfg.spread;
      let living = 0, thin = 0, moving = 0;
      for (let i = 0; i < n; i++) {
        const [dx, dy] = read(i);
        const clamp = (v: number) => Math.max(-dmax, Math.min(dmax, v));
        // flow adds the term to the unclamped drift and clamps the sum; `off` is that drift clamped. Where the
        // drift itself is inside the clamp the sum is exact, and it is everywhere in this world.
        expect(Math.abs(off[i][0])).toBeLessThan(dmax);
        expect(Math.abs(off[i][1])).toBeLessThan(dmax);
        expect(on[i]).toEqual([clamp(off[i][0] + dx), clamp(off[i][1] + dy)]);
        if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) === 0) {
          expect([dx, dy]).toEqual([0, 0]);
          continue;
        }
        living++;
        if (s.cells[CH.B * n + i] + s.cells[CH.P * n + i] < 48) thin++;
        if (dx !== 0 || dy !== 0) moving++;
      }
      expect(living).toBeGreaterThan(100);
      expect(thin).toBeGreaterThan(30);
      // The reference genome is sessile, so a neutral run moves nothing whatever the stored genomes say.
      if (extra.neutral) expect(moving).toBe(0);
      else expect(moving).toBeGreaterThan(living / 2);
    });
  }

  it("reads nothing with motility off, although gains and outputs are stored", () => {
    const s = movers({ motility: false });
    const read = motilityReader(s);
    for (let i = 0; i < cellCount(s.cfg); i++) expect(read(i)).toEqual([0, 0]);
    expect(pondDrives(s)).toEqual([0, 0, 0, 0]);
  });
});

describe("pondDrives on the reader", () => {
  it("counts the supported cells only: thin moving cells add nothing, and a neutral run scores 0", () => {
    const s = movers();
    const n = cellCount(s.cfg);
    const read = motilityReader(s);
    const want = [0, 0, 0, 0];
    const W = s.cfg.tilesX * s.cfg.tileW;
    for (let i = 0; i < n; i++) {
      const m = s.cells[CH.B * n + i] + s.cells[CH.P * n + i];
      if (m < 48) continue;
      const [dx, dy] = read(i);
      want[Math.floor(Math.floor(i / W) / s.cfg.tileH) * s.cfg.tilesX + Math.floor((i % W) / s.cfg.tileW)] += m * (Math.abs(dx) + Math.abs(dy));
    }
    expect(pondDrives(s)).toEqual(want);
    expect(want.every((x) => x > 0)).toBe(true);
    expect(pondTraits(s).every((t) => t > 0)).toBe(true);
    expect(pondDrives(movers({ neutral: true }))).toEqual([0, 0, 0, 0]);
  });
});
