import { describe, expect, it } from "vitest";
import {
  CURRENT_CONDITIONS, MATTER_HEIGHT, MATTER_HISTORY_CAPACITY, MATTER_SIZE, MATTER_WIDTH,
  MatterWorld as CurrentWorld, circulateNutrient, createMatterFixture as createCurrentFixture,
  currentSuccessor,
} from "../src/currents/model";
import { MatterWorld as OriginalWorld } from "../src/matter/model";

const at = (x: number, y: number) => y * MATTER_WIDTH + x;
function fixture(overrides: Partial<Parameters<typeof createCurrentFixture>[0]> = {}) {
  return createCurrentFixture({
    seed: 0, mode: "closed", current: "off", nutrient: new Uint32Array(MATTER_SIZE),
    biomass: new Uint32Array(MATTER_SIZE), detritus: new Uint32Array(MATTER_SIZE),
    phases: new Uint8Array(MATTER_SIZE), reservoir: 0, ...overrides,
  });
}
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) if (key !== "current" && key !== "circulated") out[key] = normalize(child);
  return out;
}

// Test oracle derived from the written one-step edge-transfer rule. It uses a
// separate field transform rather than sampling the model's output.
function referenceRelax(input: Uint32Array): Uint32Array {
  const delta = new Int32Array(MATTER_SIZE);
  const transfer = (a: number, b: number) => {
    const difference = input[a] - input[b];
    const amount = Math.floor(Math.abs(difference) / 4);
    if (difference > 0) { delta[a] -= amount; delta[b] += amount; }
    else if (difference < 0) { delta[b] -= amount; delta[a] += amount; }
  };
  for (let y = 0; y < MATTER_HEIGHT; y++) for (let x = 0; x < MATTER_WIDTH; x++) {
    const i = at(x, y);
    transfer(i, at((x + 1) % MATTER_WIDTH, y));
    if (y + 1 < MATTER_HEIGHT) transfer(i, at(x, y + 1));
  }
  return Uint32Array.from(input, (value, i) => value + delta[i]);
}
function referenceCurrent(input: Uint32Array): Uint32Array {
  const output = new Uint32Array(MATTER_SIZE);
  for (let left = 0; left < MATTER_WIDTH; left += 2) {
    // Invert the specified source-to-successor arrows to fill destination slots.
    output[at(left + 1, 0)] = input[at(left, 0)];
    for (let y = 1; y < MATTER_HEIGHT; y++) output[at(left + 1, y)] = input[at(left + 1, y - 1)];
    output[at(left, MATTER_HEIGHT - 1)] = input[at(left + 1, MATTER_HEIGHT - 1)];
    for (let y = 0; y < MATTER_HEIGHT - 1; y++) output[at(left, y)] = input[at(left, y + 1)];
  }
  return output;
}
function referenceThroughTick4(initial: Uint32Array, currentBeforeRelax: boolean): Uint32Array {
  let field: Uint32Array = new Uint32Array(initial);
  for (let tick = 1; tick <= 4; tick++) {
    if (tick === 4 && currentBeforeRelax) field = referenceCurrent(field);
    field = referenceRelax(field);
    if (tick === 4 && !currentBeforeRelax) field = referenceCurrent(field);
  }
  return field;
}

describe("nutrient current model", () => {
  it("exports the ordered fixed condition matrix and records the current setting", () => {
    expect(CURRENT_CONDITIONS).toEqual([
      { id: "closed-still", mode: "closed", current: "off" },
      { id: "closed-current", mode: "closed", current: "circulating" },
      { id: "rain-still", mode: "rain", current: "off" },
      { id: "rain-current", mode: "rain", current: "circulating" },
    ]);
    expect(Object.isFrozen(CURRENT_CONDITIONS)).toBe(true);
    const world = new CurrentWorld(0, "closed");
    expect(world.current).toBe("off");
    expect(world.snapshot()).toMatchObject({ current: "off", counters: { circulated: 0 }, rules: { current: { mode: "circulating", period: 4 } } });
  });

  it("defines a bijective adjacent permutation across all 3072 cells and 32 full-height cycles", () => {
    const successors = Array.from({ length: MATTER_SIZE }, (_, i) => currentSuccessor(i));
    expect(new Set(successors).size).toBe(MATTER_SIZE);
    for (let i = 0; i < MATTER_SIZE; i++) {
      const x = i % MATTER_WIDTH, y = Math.floor(i / MATTER_WIDTH), next = successors[i];
      const nx = next % MATTER_WIDTH, ny = Math.floor(next / MATTER_WIDTH);
      expect(Math.abs(x - nx) + Math.abs(y - ny)).toBe(1);
      expect(Math.floor(x / 2)).toBe(Math.floor(nx / 2));
    }
    expect(currentSuccessor(at(0, 0))).toBe(at(1, 0));
    expect(currentSuccessor(at(1, 0))).toBe(at(1, 1));
    expect(currentSuccessor(at(1, 47))).toBe(at(0, 47));
    expect(currentSuccessor(at(0, 47))).toBe(at(0, 46));
    expect(currentSuccessor(at(22, 13))).toBe(at(22, 12));
    for (let x = 0; x < MATTER_WIDTH; x += 2) {
      let cursor = at(x, 0);
      const seen = new Set<number>();
      for (let n = 0; n < 96; n++) { expect(seen.has(cursor)).toBe(false); seen.add(cursor); cursor = currentSuccessor(cursor); }
      expect(cursor).toBe(at(x, 0));
      expect(seen.size).toBe(96);
      expect([...seen].some((i) => Math.floor(i / MATTER_WIDTH) === 0)).toBe(true);
      expect([...seen].some((i) => Math.floor(i / MATTER_WIDTH) === MATTER_HEIGHT - 1)).toBe(true);
    }
  });

  it("moves exactly one pulse from copied bounded data and preserves the nutrient multiset", () => {
    const source = new Uint32Array(MATTER_SIZE); source[at(8, 10)] = 7;
    const moved = circulateNutrient(source);
    expect(moved.nutrient[at(8, 9)]).toBe(7);
    expect(moved.movedUnits).toBe(7);
    expect(moved.nutrient).not.toBe(source);
    expect(source[at(8, 10)]).toBe(7);
    for (let n = 0; n < 96; n++) {
      const next = circulateNutrient(moved.nutrient);
      moved.nutrient.set(next.nutrient);
    }
    expect(moved.nutrient[at(8, 9)]).toBe(7);

    const mixed = Uint32Array.from({ length: MATTER_SIZE }, (_, i) => (i * 17) % 23);
    const result = circulateNutrient(mixed);
    expect([...result.nutrient].sort((a, b) => a - b)).toEqual([...mixed].sort((a, b) => a - b));
    expect(result.movedUnits).toBe(mixed.reduce((sum, n) => sum + n, 0));
    expect(result.nutrient).not.toBe(mixed);
    expect(() => currentSuccessor(-1)).toThrow();
    expect(() => currentSuccessor(MATTER_SIZE)).toThrow();
    expect(() => currentSuccessor(1.5)).toThrow();
    expect(() => circulateNutrient(new Uint32Array(2))).toThrow();
    expect(() => circulateNutrient(Array(MATTER_SIZE).fill(0).map((v, i) => i === 0 ? 69761 : v))).toThrow();
    expect(() => circulateNutrient(Array<number>(MATTER_SIZE))).toThrow();
    const accessor = Array<number>(MATTER_SIZE).fill(0);
    Object.defineProperty(accessor, "0", { get: () => 1 });
    expect(() => circulateNutrient(accessor)).toThrow();
  });

  it("circulates after rain and before relaxation every fourth tick, with exact translated-unit accounting", () => {
    const nutrient = new Uint32Array(MATTER_SIZE); nutrient[at(8, 10)] = 1000;
    const off = fixture({ nutrient });
    const on = fixture({ nutrient, current: "circulating" });
    for (let tick = 1; tick <= 3; tick++) { off.step(); on.step(); }
    expect(on.fields.nutrient).toEqual(off.fields.nutrient);
    expect(on.census().circulated).toBe(0);
    off.step(); on.step();
    expect(on.fields.nutrient).not.toEqual(off.fields.nutrient);
    expect(on.census().circulated).toBe(1000);
    const expectedBeforeRelax = referenceThroughTick4(nutrient, true);
    const expectedRelaxBefore = referenceThroughTick4(nutrient, false);
    expect(expectedBeforeRelax).not.toEqual(expectedRelaxBefore);
    expect(on.fields.nutrient).toEqual(expectedBeforeRelax);
    expect(on.fields.nutrient).not.toEqual(expectedRelaxBefore);

    const rain = fixture({ mode: "rain", current: "circulating", reservoir: 64 });
    rain.step(8);
    expect(rain.census()).toMatchObject({ imported: 64, circulated: 64, reservoir: 0 });
    const expected = new Uint32Array(MATTER_SIZE);
    for (let x = 1; x < MATTER_WIDTH; x += 2) {
      expected[at(x, 0)] = 1;
      expected[at(x, 1)] = 1;
    }
    expect(rain.fields.nutrient).toEqual(expected);
    expect(rain.extinctionTick).toBe(0);
    rain.step(100);
    expect(rain.census()).toMatchObject({ extinctionTick: 0, biomass: 0 });
    expect(rain.census().circulated).toBeGreaterThan(64);
    expect(rain.history.find((sample) => sample.tick === 100)?.circulated).toBeGreaterThan(64);
    expect(rain.snapshot().counters.circulated).toBe(rain.census().circulated);
  });

  it("keeps all current-off snapshots, censuses and histories identical to the original model", () => {
    for (const seed of [0, 1201]) for (const mode of ["closed", "rain"] as const) {
      const current = new CurrentWorld(seed, mode, "off"), original = new OriginalWorld(seed, mode);
      for (let tick = 1; tick <= 1000; tick++) {
        current.step(); original.step();
        if (tick % 50 === 0 || tick === 1000) {
          expect(normalize(current.snapshot())).toEqual(normalize(original.snapshot()));
          expect(normalize(current.census())).toEqual(normalize(original.census()));
          expect(normalize(current.history)).toEqual(normalize(original.history));
        }
      }
      const chunked = new CurrentWorld(seed, mode);
      chunked.step(137); chunked.step(863);
      expect(normalize(chunked.snapshot())).toEqual(normalize(current.snapshot()));
    }
    for (const mode of ["burial", "rain-burial"] as const) {
      const current = new CurrentWorld(1201, mode), original = new OriginalWorld(1201, mode);
      current.step(37); original.step(37);
      expect(normalize(current.snapshot())).toEqual(normalize(original.snapshot()));
    }
  });

  it("requires current on fixtures, copies fixture arrays, and preserves the 122-sample history cap", () => {
    const nutrient = new Uint32Array(MATTER_SIZE); nutrient[4] = 9;
    const world = fixture({ current: "circulating", nutrient });
    nutrient.fill(0);
    expect(world.fields.nutrient[4]).toBe(9);
    expect(world.current).toBe("circulating");
    expect(() => createCurrentFixture({ seed: 0, mode: "closed", nutrient: new Uint32Array(MATTER_SIZE), biomass: new Uint32Array(MATTER_SIZE), detritus: new Uint32Array(MATTER_SIZE), phases: new Uint8Array(MATTER_SIZE), reservoir: 0 } as never)).toThrow();
    const long = new CurrentWorld(0, "closed"); long.step(6500);
    expect(long.history).toHaveLength(MATTER_HISTORY_CAPACITY);
    expect(long.droppedSamples).toBeGreaterThan(0);
  });

  it("preserves the original current-off growth and extension fixture", () => {
    const nutrient = new Uint32Array(MATTER_SIZE); nutrient.fill(16);
    const biomass = new Uint32Array(MATTER_SIZE); biomass[at(8, 12)] = 24;
    const world = fixture({ nutrient, biomass });
    for (let tick = 1; tick <= 24; tick++) world.step();
    expect(world.census()).toMatchObject({
      current: "off", tick: 24, growth: 36, mortality: 3, routineDecay: 3,
      thresholdLoss: 0, spread: 8, colonizedTiles: 2, biomass: 57, activeCells: 3, circulated: 0,
    });
    expect([at(8, 12), at(8, 13), at(7, 12)].every((i) => world.fields.biomass[i] >= 4)).toBe(true);
  });

  it("preserves the original current-off no-biomass rain and burial fixture", () => {
    const detritus = new Uint32Array(MATTER_SIZE); detritus[at(0, 47)] = 16;
    const world = fixture({ mode: "rain-burial", detritus, reservoir: 4 });
    expect(world.extinctionTick).toBe(0);
    world.step(100);
    expect(world.census()).toMatchObject({
      current: "off", tick: 100, extinctionTick: 0, imported: 4, reservoir: 0,
      recycled: 2, buried: 14, sediment: 14, nutrient: 6, biomass: 0, detritus: 0, residual: 0, circulated: 0,
    });
  });
});
