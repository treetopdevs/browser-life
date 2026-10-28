import { describe, expect, it } from "vitest";
import {
  MATTER_HISTORY_CAPACITY, MATTER_SIZE, MATTER_WIDTH, MatterWorld,
  createMatterFixture, isMatterLit, matterNeighbors,
} from "../src/matter/model";

const at = (x: number, y: number) => y * MATTER_WIDTH + x;
function fixture(overrides: Partial<Parameters<typeof createMatterFixture>[0]> = {}) {
  return createMatterFixture({
    seed: 0, mode: "closed", nutrient: new Uint32Array(MATTER_SIZE), biomass: new Uint32Array(MATTER_SIZE),
    detritus: new Uint32Array(MATTER_SIZE), phases: new Uint8Array(MATTER_SIZE), reservoir: 0, ...overrides,
  });
}
function stock(w: MatterWorld, name: "nutrient" | "biomass" | "detritus") { return w.fields[name]; }
function checkLedger(w: MatterWorld) {
  const c = w.census();
  expect(c.residual).toBe(0);
  expect(c.reservoir).toBe(c.initialReservoir - c.imported);
  expect(c.sediment).toBe(c.buried);
  expect(c.nutrient).toBe(c.initialNutrient + c.imported - c.growth + c.recycled);
  expect(c.biomass).toBe(c.initialBiomass + c.growth - c.mortality);
  expect(c.detritus).toBe(c.initialDetritus + c.mortality - c.recycled - c.buried);
  expect(c.mortality).toBe(c.routineDecay + c.thresholdLoss);
  expect([...stock(w, "biomass")].every((b) => b <= 64 && (w.tick === 0 || b === 0 || b >= 4))).toBe(true);
}

describe("matter aquarium model", () => {
  it("pins zero-seed Mulberry initialization and shared founders/phases", () => {
    const w = new MatterWorld(0, "closed"), f = w.fields;
    expect([...f.nutrient.slice(0, 2)]).toEqual([6, 4]);
    expect([...f.phases.slice(0, 8)]).toEqual([2, 3, 1, 3, 0, 0, 3, 3]);
    expect([at(8, 12), at(24, 12), at(40, 12), at(56, 12), at(8, 28), at(24, 28), at(40, 28), at(56, 28)].map((i) => f.biomass[i])).toEqual(Array(8).fill(16));
    expect(w.census().initialReservoir).toBe(32768);
    expect(new MatterWorld(0, "rain").fields.phases).toEqual(f.phases);
  });

  it("uses wrapped horizontal neighbors, closed vertical edges and light schedule", () => {
    expect(matterNeighbors(0, 0)).toEqual([1, MATTER_WIDTH, MATTER_WIDTH - 1]);
    expect(matterNeighbors(63, 47)).toEqual([at(0, 47), at(62, 47), at(63, 46)]);
    const b = new Uint32Array(MATTER_SIZE); b[at(0, 10)] = 4; b[at(63, 10)] = 4; b[at(0, 11)] = 4; b[at(0, 47)] = 4;
    expect(fixture({ biomass: b }).census()).toMatchObject({ components: 2, largestComponentCells: 3, activeCells: 4 });
    expect(isMatterLit(0, 24, 35)).toBe(true);
    expect(isMatterLit(0, 25, 10)).toBe(false);
    expect(isMatterLit(0, 0, 36)).toBe(false);
    expect(isMatterLit(640, 0, 10)).toBe(true);
  });

  it("keeps active components at the top and bottom rows disconnected", () => {
    const b = new Uint32Array(MATTER_SIZE);
    b[at(17, 0)] = 4;
    b[at(17, 47)] = 4;
    expect(fixture({ biomass: b }).census()).toMatchObject({ components: 2, largestComponentCells: 1, activeCells: 2 });
  });

  it("relaxes across the horizontal seam with exact synchronous, unclamped conservation", () => {
    const n = new Uint32Array(MATTER_SIZE); n[at(0, 20)] = 100;
    const w = fixture({ nutrient: n });
    w.step();
    const after = stock(w, "nutrient");
    expect(after[at(0, 20)]).toBe(0);
    for (const i of [at(1, 20), at(63, 20), at(0, 19), at(0, 21)]) expect(after[i]).toBe(25);
    expect(w.census().relaxed).toBe(100);
    expect(w.census().nutrient).toBe(100);
    checkLedger(w);
  });

  it("keeps varied synchronous relaxation bounded, nonnegative and conservative", () => {
    const nutrient = new Uint32Array(MATTER_SIZE);
    for (let i = 0; i < MATTER_SIZE; i++) nutrient[i] = (i * 37 + (i >>> 2) * 13) % 21;
    const initialTotal = nutrient.reduce((a, b) => a + b, 0);
    const initialMax = nutrient.reduce((a, b) => Math.max(a, b), 0);
    const a = fixture({ nutrient }), b = fixture({ nutrient });
    for (let tick = 0; tick < 8; tick++) {
      a.step(); b.step();
      const afterA = stock(a, "nutrient"), afterB = stock(b, "nutrient");
      expect(afterA).toEqual(afterB);
      expect(afterA.reduce((sum, value) => sum + value, 0)).toBe(initialTotal);
      expect(Math.min(...afterA)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...afterA)).toBeLessThanOrEqual(initialMax);
    }
  });

  it("rotates finite rain, counts only imports, and leaves reservoir intact when disabled", () => {
    const rain = fixture({ mode: "rain", reservoir: 65 });
    rain.step(8);
    expect(rain.census()).toMatchObject({ imported: 64, reservoir: 1 });
    expect([...stock(rain, "nutrient").slice(0, MATTER_WIDTH)]).toEqual(Array(MATTER_WIDTH).fill(1));
    rain.step(8);
    expect(rain.census()).toMatchObject({ imported: 65, reservoir: 0 });
    expect(stock(rain, "nutrient")[1]).toBe(2);
    const closed = fixture({ mode: "closed", reservoir: 65 }); closed.step(16);
    expect(closed.census()).toMatchObject({ imported: 0, reservoir: 65 });
    checkLedger(rain); checkLedger(closed);
  });

  it("grows only lit active biomass and obeys halfwidth 24", () => {
    const n = new Uint32Array(MATTER_SIZE); n.fill(1);
    const b = new Uint32Array(MATTER_SIZE); b[at(0, 0)] = 4; b[at(25, 0)] = 4; b[at(0, 36)] = 4;
    const w = fixture({ nutrient: n, biomass: b }); w.step();
    expect(w.census().growth).toBe(1);
    expect(stock(w, "biomass")[at(0, 0)]).toBe(5);
    expect(stock(w, "biomass")[at(25, 0)]).toBe(4);
    expect(stock(w, "biomass")[at(0, 36)]).toBe(4);
    checkLedger(w);
  });

  it("applies light-edge growth before routine mortality at tick 10", () => {
    const n = new Uint32Array(MATTER_SIZE); n.fill(16);
    const b = new Uint32Array(MATTER_SIZE); b[at(25, 12)] = 4; b[at(26, 12)] = 4;
    const w = fixture({ nutrient: n, biomass: b }); w.step(10);
    expect(w.census()).toMatchObject({ biomass: 4, growth: 1, mortality: 5, routineDecay: 2, thresholdLoss: 3 });
    expect(stock(w, "biomass")[at(25, 12)]).toBe(4); // lit at center 1: 4 -> 5 -> 4
    expect(stock(w, "biomass")[at(26, 12)]).toBe(0); // dark at distance 25: 4 -> 3 -> 0
    checkLedger(w);
  });

  it("applies mortality before simultaneous extension, with no same-phase newborn extension", () => {
    const b = new Uint32Array(MATTER_SIZE), p = new Uint8Array(MATTER_SIZE), n = new Uint32Array(MATTER_SIZE); n.fill(1);
    const target = at(15, 10);
    const donors = [[15, 9, 0], [16, 10, 1], [15, 11, 2], [14, 10, 3]] as const;
    for (const [x, y, phase] of donors) { b[at(x, y)] = 24; p[at(x, y)] = phase; }
    const w = fixture({ nutrient: n, biomass: b, phases: p }); w.step(12);
    expect(stock(w, "biomass")[target]).toBe(16);
    expect(w.census()).toMatchObject({ spread: 16, colonizedTiles: 1, mortality: 4 });
    expect(w.census().activeCells).toBe(5);
    const collision = new Uint32Array(MATTER_SIZE); collision[at(10, 37)] = 64;
    const q = new Uint8Array(MATTER_SIZE); q[at(10, 37)] = 3;
    const late = fixture({ biomass: collision, phases: q }); late.step(60);
    expect(late.census()).toMatchObject({ biomass: 42, spread: 20, colonizedTiles: 5, routineDecay: 10, thresholdLoss: 12, mortality: 22 });
    expect(stock(late, "biomass")[at(11, 37)]).toBe(4); // tick-60 deposition survives its birth tick
    checkLedger(late);
  });

  it("runs the fixed ample-N growth and extension gate exactly", () => {
    const nutrient = new Uint32Array(MATTER_SIZE); nutrient.fill(16);
    const biomass = new Uint32Array(MATTER_SIZE); biomass[at(8, 12)] = 24;
    const world = fixture({ nutrient, biomass });
    for (let tick = 1; tick <= 24; tick++) { world.step(); checkLedger(world); }
    expect(world.census()).toMatchObject({ tick: 24, growth: 36, mortality: 3, routineDecay: 3, thresholdLoss: 0, spread: 8, colonizedTiles: 2, biomass: 57, activeCells: 3 });
    expect([at(8, 12), at(8, 13), at(7, 12)].every((i) => stock(world, "biomass")[i] >= 4)).toBe(true);
  });

  it("recycles slowly, settles synchronously, and buries after settling", () => {
    const d = new Uint32Array(MATTER_SIZE); d[at(4, 39)] = 5; d[at(5, 47)] = 3;
    const w = fixture({ mode: "burial", detritus: d });
    w.step(4);
    expect(w.census()).toMatchObject({ buried: 4, sediment: 4, recycled: 0 });
    expect(stock(w, "detritus")[at(4, 40)]).toBe(0);
    expect(stock(w, "detritus")[at(4, 39)]).toBe(0);
    expect(stock(w, "detritus")[at(5, 47)]).toBe(2);
    w.step(20);
    expect(w.census().recycled).toBe(0);
    const recycling = new Uint32Array(MATTER_SIZE); recycling[at(5, 47)] = 1;
    const recycled = fixture({ detritus: recycling }); recycled.step(24);
    expect(recycled.census().recycled).toBe(1);
    checkLedger(w);
  });

  it("keeps physical exchange alive after extinction without biomass resurrection", () => {
    const d = new Uint32Array(MATTER_SIZE); d[at(0, 47)] = 16;
    const w = fixture({ mode: "rain-burial", detritus: d, reservoir: 4 });
    expect(w.extinctionTick).toBe(0);
    w.step(100);
    expect(w.census()).toMatchObject({ tick: 100, extinctionTick: 0, imported: 4, reservoir: 0, recycled: 2, buried: 14, sediment: 14, nutrient: 6, biomass: 0, detritus: 0, residual: 0 });
    expect(w.history.at(-1)?.tick).toBe(100);
    checkLedger(w);
  });

  it("copies fixture inputs and field/history outputs, and observers do not affect stepping", () => {
    const n = new Uint32Array(MATTER_SIZE); n.fill(8);
    const w = fixture({ nutrient: n }); n.fill(999);
    const first = w.fields; first.nutrient.fill(999); first.phases.fill(3);
    const history = w.history; history[0].nutrient = 999;
    const a = new MatterWorld(0, "rain"), b = new MatterWorld(0, "rain");
    for (let i = 0; i < 100; i++) { a.census(); a.fields; a.history; a.step(); b.step(); }
    expect(a.snapshot().fields).toEqual(b.snapshot().fields);
    expect(a.census()).toEqual(b.census());
    expect(stock(w, "nutrient")[0]).toBe(8);
    const phases = Buffer.alloc(MATTER_SIZE, 2);
    const buffered = fixture({ phases });
    phases.fill(0);
    expect(buffered.fields.phases.constructor).toBe(Uint8Array);
    expect(Buffer.isBuffer(buffered.fields.phases)).toBe(false);
    expect(buffered.fields.phases[0]).toBe(2);
    expect(Array.isArray(buffered.snapshot().fields.nutrient)).toBe(true);
    expect(buffered.snapshot()).toMatchObject({ observationOnly: true, description: "Observation only; not a resumable checkpoint" });
  });

  it("matches deterministic seed-zero replay and chunked stepping", () => {
    const a = new MatterWorld(0, "rain-burial"), b = new MatterWorld(0, "rain-burial");
    a.step(137); b.step(37); b.step(100);
    expect(a.snapshot().fields).toEqual(b.snapshot().fields);
    expect(a.snapshot().counters).toEqual(b.snapshot().counters);
    expect(a.census()).toEqual(b.census());
    checkLedger(a);
  });

  it("deduplicates extinction samples, keeps cadence and caps history at 122", () => {
    const b = new Uint32Array(MATTER_SIZE); b[at(0, 47)] = 4;
    const cadence = fixture({ biomass: b }); cadence.step(50);
    expect(cadence.history.map((s) => s.tick)).toEqual([0, 10, 50]);
    expect(cadence.history.find((s) => s.tick === 50)).toMatchObject({ intervalFromTick: 10, intervalToTick: 50 });
    const w = fixture({ biomass: b });
    expect(w.history[0]).toMatchObject({ tick: 0, intervalFromTick: null, intervalToTick: null, meanAbsBChange: null, maskFlipFraction: null });
    w.step(6500);
    expect(w.extinctionTick).toBe(10);
    expect(w.history.at(-1)?.tick).toBe(6500);
    expect(w.history).toHaveLength(MATTER_HISTORY_CAPACITY);
    expect(w.droppedSamples).toBe(10);
    expect(w.history[0].tick).toBe(450);
    expect(w.history.find((s) => s.tick === 450)).toMatchObject({ intervalFromTick: 400, intervalToTick: 450 });
  });

  it("rejects invalid counts, malformed fixtures, accessors, holes and over-budget stocks", () => {
    const w = new MatterWorld(0, "closed");
    for (const n of [-1, 1.5, 100001]) expect(() => w.step(n)).toThrow();
    expect(() => new MatterWorld(-1, "closed")).toThrow();
    expect(() => new MatterWorld(0, "other" as never)).toThrow();
    const sparse = Array<number>(MATTER_SIZE); sparse[0] = 1;
    expect(() => fixture({ nutrient: sparse })).toThrow();
    const accessor = Array<number>(MATTER_SIZE).fill(0);
    Object.defineProperty(accessor, "0", { get: () => 0 });
    expect(() => fixture({ nutrient: accessor })).toThrow();
    const excessive = new Uint32Array(MATTER_SIZE); excessive[0] = 69761;
    expect(() => fixture({ nutrient: excessive })).toThrow();
    expect(() => createMatterFixture({ seed: 0, mode: "closed", nutrient: new Uint32Array(MATTER_SIZE), biomass: new Uint32Array(MATTER_SIZE), detritus: new Uint32Array(MATTER_SIZE), phases: new Uint8Array(MATTER_SIZE), reservoir: 0, extra: 1 } as never)).toThrow();
  });
});
