import { describe, expect, it } from 'vitest';
import {
  DevelopmentWorld, GENOME_PRESETS, RULES, createDevelopmentFixture,
  developmentDirections, validateGenome, wrappedNeighbor,
} from '../src/development/model';

const founder = (overrides: Partial<{ tile: number; heading: number; genome: unknown; age: number; store: number }> = {}) => ({
  tile: 48 * RULES.width + 48, heading: 0, genome: GENOME_PRESETS[0], age: 0, store: 24, ...overrides,
});
const fixture = (opts: { seed?: number; mutation?: boolean; food?: number; founders?: ReturnType<typeof founder>[] } = {}) =>
  createDevelopmentFixture({ seed: opts.seed ?? 1, mutation: opts.mutation ?? false, food: opts.food ?? 40, founders: opts.founders ?? [founder()] });

function footprint(world: DevelopmentWorld, id: number, root: number): string {
  const organism = world.organisms.find((candidate) => candidate.id === id)!;
  const rx = root % RULES.width, ry = Math.floor(root / RULES.width);
  const relative = organism.cells.map(({ tile }) => {
    let dx = tile % RULES.width - rx, dy = Math.floor(tile / RULES.width) - ry;
    if (dx > RULES.width / 2) dx -= RULES.width;
    if (dx < -RULES.width / 2) dx += RULES.width;
    if (dy > RULES.height / 2) dy -= RULES.height;
    if (dy < -RULES.height / 2) dy += RULES.height;
    return `${dx},${dy}`;
  });
  return relative.sort().join(';');
}

function mutationDraws(seed: number): number[] {
  let state = (seed ^ RULES.mutationSeedXor) >>> 0;
  return Array.from({ length: 3 }, () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  });
}

describe('development model geometry and copied inputs', () => {
  it('validates and freezes exact genome copies without invoking accessors', () => {
    const source = { turnEvery: 4, turn: -0, branchEvery: 3, maxCells: 24 };
    const genome = validateGenome(source);
    source.branchEvery = 5;
    expect(genome).toEqual({ turnEvery: 4, turn: 0, branchEvery: 3, maxCells: 24 });
    expect(Object.isFrozen(genome)).toBe(true);
    expect(() => validateGenome({ ...genome, extra: 1 })).toThrow();
    let accessed = false;
    const getter = Object.defineProperty({ turn: 0, turnEvery: 4, branchEvery: 3, maxCells: 24 }, 'turn', {
      enumerable: true, get() { accessed = true; return 0; },
    });
    expect(() => validateGenome(getter)).toThrow();
    expect(accessed).toBe(false);
    expect(() => validateGenome(Object.assign(Object.create({}), { turnEvery: 4, turn: 0, branchEvery: 3, maxCells: 24 }))).toThrow();
    expect(() => validateGenome({ turnEvery: 9, turn: 0, branchEvery: 3, maxCells: 24 })).toThrow();
  });

  it('pins headings, turn signs, branch ordering, and torus wrapping', () => {
    const straight = GENOME_PRESETS[0];
    const curling = GENOME_PRESETS[1];
    expect(developmentDirections(straight, 0, 0)).toEqual([0, 3, 1]);
    expect(developmentDirections(straight, 0, 1)).toEqual([0]);
    expect(developmentDirections(straight, 0, 4)).toEqual([0, 3, 1]);
    expect(developmentDirections(curling, 0, 3)).toEqual([0, 3, 1]);
    expect(developmentDirections(curling, 0, 4)).toEqual([1]);
    expect(wrappedNeighbor(95, 0)).toBe(0);
    expect(wrappedNeighbor(95, 1)).toBe(191);
    expect(wrappedNeighbor(95, 2)).toBe(94);
    expect(wrappedNeighbor(95, 3)).toBe(95 + 95 * RULES.width);
  });

  it('keeps constructor ecology identical across mutation settings and protects read-only copies', () => {
    const fixed = new DevelopmentWorld(0xffff_ffff, false);
    const evolving = new DevelopmentWorld(0xffff_ffff, true);
    expect(fixed.organisms.map(({ id, family, cells }) => [id, family, cells])).toEqual(
      evolving.organisms.map(({ id, family, cells }) => [id, family, cells]),
    );
    expect(fixed.organisms).toHaveLength(12);
    expect(fixed.ledger.initialEnergy).toBe(184_656);
    const food = fixed.food;
    food[0] = 0;
    expect(fixed.food[0]).toBe(20);
    const occupancy = fixed.occupancy;
    occupancy.fill(0);
    expect(fixed.occupancy.some((id) => id !== 0)).toBe(true);
    const organisms = fixed.organisms as unknown as { age: number }[];
    expect(() => { organisms[0].age = 55; }).toThrow();
    expect(fixed.organisms[0].age).toBe(0);
  });

  it('copies Buffer food fixtures into a base Uint8Array with no aliases', () => {
    const input = Buffer.alloc(RULES.tileCount);
    input[0] = 17;
    const world = createDevelopmentFixture({ seed: 7, mutation: false, food: input, founders: [] });
    input[0] = 0;
    expect(world.food[0]).toBe(17);
    const readback = world.food;
    expect(Buffer.isBuffer(readback)).toBe(false);
    readback[0] = 2;
    expect(world.food[0]).toBe(17);
  });

  it('replays the same ecology and mutation streams exactly from a seed', () => {
    const first = fixture({ seed: 731, mutation: true, founders: [founder({ store: 160,
      genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 } })] });
    const second = fixture({ seed: 731, mutation: true, founders: [founder({ store: 160,
      genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 } })] });
    first.step(240);
    second.step(240);
    expect(first.snapshot()).toEqual(second.snapshot());
  });

  it('closes the ledger through supply and transfers', () => {
    const world = new DevelopmentWorld(1, false);
    world.step(5);
    expect(world.ledger.initialEnergy).toBe(184_656);
    expect(world.ledger.supplied).toBe(9_216);
    expect(world.ledger.residual).toBe(0);
    expect(world.census().ledgerResidual).toBe(0);
    world.step(55);
    expect(world.ledger.residual).toBe(0);
    expect(world.history.map((sample) => sample.tick)).toContain(60);
    expect(world.history.find((sample) => sample.tick === 60)?.totalEnergy).toBeGreaterThan(0);
  });
});

describe('growth, survival, and scheduling', () => {
  it('adds one connected FIFO growth cell at a time and transfers four energy units', () => {
    const world = fixture({ founders: [founder({ store: 40 })] });
    const before = world.organisms[0];
    world.step(6);
    const after = world.organisms[0];
    expect(after.cells).toHaveLength(2);
    expect(after.cells[1].tile).toBe(wrappedNeighbor(before.cells[0].tile, 0));
    expect(after.store).toBe(before.store + 2 * 6 - 6 - 4);
    expect(world.occupancy[after.cells[1].tile]).toBe(after.id);
    expect(world.ledger.residual).toBe(0);
  });

  it('grows across a torus edge and skips a blocked FIFO attempt to use the next direction', () => {
    const edge = fixture({ founders: [founder({ tile: 48 * RULES.width + 95, heading: 0, store: 40 })] });
    const root = edge.organisms[0].cells[0].tile;
    edge.step(6);
    expect(edge.organisms[0].cells[1].tile).toBe(wrappedNeighbor(root, 0));
    expect(edge.organisms[0].cells[1].tile % RULES.width).toBe(0);

    const blockedRoot = 48 * RULES.width + 48;
    const blocked = fixture({ founders: [
      founder({ tile: blockedRoot, heading: 0, store: 40 }),
      founder({ tile: wrappedNeighbor(blockedRoot, 0), heading: 2, store: 40 }),
    ] });
    blocked.step(6);
    const growing = blocked.organisms.find((organism) => organism.id === 1)!;
    expect(growing.cells[1].tile).toBe(wrappedNeighbor(blockedRoot, 3));
    expect(growing.growthCursor).toBe(2);
  });

  it('stops growth at maxCells and pays upkeep rounded up above eight cells', () => {
    const world = fixture({ food: 0, founders: [founder({ store: 160,
      genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 16 } })] });
    world.step(48);
    expect(world.organisms[0].cells).toHaveLength(9);
    const dissipatedBefore = world.ledger.dissipated;
    world.step();
    expect(world.ledger.dissipated - dissipatedBefore).toBe(2);
    while (world.organisms[0]?.cells.length < 16 && world.tick < 180) world.step();
    expect(world.organisms[0].cells).toHaveLength(16);
    const founderID = world.organisms[0].id;
    world.step(12);
    expect(world.organisms.find((organism) => organism.id === founderID)!.cells).toHaveLength(16);
    expect(world.organisms.every((organism) => organism.cells.length <= organism.genome.maxCells)).toBe(true);
  });

  it('clips feeding at store capacity and leaves unabsorbed food on the tile', () => {
    const tile = 48 * RULES.width + 48;
    const food = new Uint8Array(RULES.tileCount);
    food[tile] = 40;
    const fed = createDevelopmentFixture({ seed: 1, mutation: false, food, founders: [founder({ tile, store: 160 })] });
    fed.step();
    expect(fed.organisms[0].store).toBe(159);
    expect(fed.food[tile]).toBe(40);
    fed.step();
    expect(fed.organisms[0].store).toBe(159);
    expect(fed.food[tile]).toBe(39);
    expect(fed.ledger.residual).toBe(0);
  });

  it('preserves connected wrapped bodies under each preset through the assay horizon', () => {
    const shapes: string[] = [];
    for (const genome of GENOME_PRESETS) {
      const origin = 48 * RULES.width + 48;
      const world = fixture({ seed: 1201, food: 40, founders: [founder({ tile: origin, heading: 0, genome })] });
      let firstBirth: number | null = null;
      for (let tick = 1; tick <= 240; tick++) {
        world.step();
        expect(world.ledger.residual).toBe(0);
        const cells = world.organisms[0]?.cells ?? [];
        for (let i = 1; i < cells.length; i++) {
          expect(cells.slice(0, i).some((cell) => [0, 1, 2, 3].some((d) => wrappedNeighbor(cell.tile, d) === cells[i].tile))).toBe(true);
        }
        if (world.census().births > 0 && firstBirth === null) firstBirth = tick;
        if (tick === 144) shapes.push(footprint(world, 1, origin));
      }
      expect(world.organisms.find((organism) => organism.id === 1)?.cells.length).toBeGreaterThanOrEqual(18);
      expect(firstBirth).not.toBeNull();
      expect(firstBirth).toBeLessThanOrEqual(240);
    }
    expect(new Set(shapes).size).toBe(3);
  });

  it('ages, feeds, pays upkeep, and accounts age death in the specified order', () => {
    const world = fixture({ food: 0, founders: [founder({ age: 599, store: 20 })] });
    world.step();
    expect(world.tick).toBe(1);
    expect(world.organisms).toHaveLength(0);
    expect(world.extinctionTick).toBe(1);
    expect(world.countersView.deaths).toBe(1);
    expect(world.ledger.dissipated).toBe(1);
    expect(world.ledger.deathLoss).toBe(23);
    expect(world.ledger.residual).toBe(0);
    world.step(100);
    expect(world.tick).toBe(1);
    expect(world.history.map(({ tick }) => tick)).toEqual([0, 1]);
  });

  it('charges available store before a starvation death and freezes extinction', () => {
    const world = fixture({ food: 0, founders: [founder({ store: 0 })] });
    world.step();
    expect(world.extinctionTick).toBe(1);
    expect(world.ledger.dissipated).toBe(0);
    expect(world.ledger.deathLoss).toBe(4);
    const snapshot = world.snapshot();
    world.step(40);
    expect(world.snapshot()).toEqual(snapshot);
  });

  it('reserves newborn occupancy immediately and defers child processing until the next tick', () => {
    const parent = founder({ store: 160, genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 16 } });
    const world = fixture({ founders: [parent] });
    const parentID = world.organisms[0].id;
    world.step(160);
    const bornThisTick = world.lineage.find((node) => node.parentID === parentID && node.birthTick === 160)!;
    const child = world.organisms.find((organism) => organism.id === bornThisTick.id)!;
    expect(child).toBeDefined();
    expect(child.age).toBe(0);
    expect(child.cells).toHaveLength(1);
    expect(world.occupancy[child.cells[0].tile]).toBe(child.id);
    expect(world.organisms.find((organism) => organism.id === parentID)!.births).toBe(2);
    expect(world.ledger.residual).toBe(0);
    world.step();
    expect(world.organisms.find((organism) => organism.id === child.id)!.age).toBe(1);
  });

  it('counts cap-blocked births only when conditions pass and never reuses IDs', () => {
    const genome = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 16 };
    const founders = Array.from({ length: 12 }, (_, i) => founder({ tile: (16 + Math.floor(i / 4) * 32) * RULES.width + 12 + (i % 4) * 24, store: 24, genome }));
    const world = fixture({ founders });
    world.step(480);
    expect(world.countersView.blockedCapBirths).toBeGreaterThan(0);
    expect(world.countersView.blockedCapBirths).toBeGreaterThanOrEqual(1);
    expect(world.countersView.births).toBeGreaterThan(0);
    expect(world.organisms.length).toBeLessThanOrEqual(48);
    expect(new Set(world.organisms.map((o) => o.id)).size).toBe(48);
    expect(world.ledger.residual).toBe(0);
  });
});

describe('reproduction, mutation, history, and fixtures', () => {
  it('copies inherited genomes and records only a bounded effective field mutation', () => {
    let seed = 0;
    let mutated: DevelopmentWorld | null = null;
    for (; seed < 20 && !mutated; seed++) {
      const candidate = fixture({ seed, mutation: true, founders: [founder({ store: 160,
        genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 } })] });
      candidate.step(160);
      if (candidate.countersView.attemptedMutations > 0) mutated = candidate;
    }
    expect(mutated).not.toBeNull();
    const parent = mutated!.organisms.find((o) => o.parentID === null)!;
    const child = mutated!.organisms.find((o) => o.parentID === parent.id)!;
    const event = mutated!.lineage.find((node) => node.id === child.id)!;
    expect(child.genome).not.toBe(parent.genome);
    expect(Object.isFrozen(child.genome)).toBe(true);
    expect(event.mutation).not.toBeNull();
    expect(Math.abs(event.mutation!.to - event.mutation!.from)).toBe(1);
    const bounds = { turnEvery: [2, 8], turn: [-1, 1], branchEvery: [2, 6], maxCells: [16, 32] } as const;
    const [minimum, maximum] = bounds[event.mutation!.field];
    expect(event.mutation!.to).toBeGreaterThanOrEqual(minimum);
    expect(event.mutation!.to).toBeLessThanOrEqual(maximum);
    expect(mutated!.countersView.effectiveMutations).toBe(1);
    expect(mutated!.ledger.residual).toBe(0);
  });

  it('records a boundary mutation attempt without changing the child genome', () => {
    let seed = 0;
    while (seed < 10_000) {
      const [probability, field, sign] = mutationDraws(seed);
      if (probability < RULES.mutationRate && Math.floor(field * 4) === 3 && sign < 0.5) break;
      seed++;
    }
    expect(seed).toBeLessThan(10_000);
    const baseGenome = { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 16 };
    const world = fixture({ seed, mutation: true, founders: [founder({ genome: baseGenome })] });
    world.step(80);
    const child = world.organisms.find((organism) => organism.parentID !== null)!;
    expect(world.countersView.attemptedMutations).toBe(1);
    expect(world.countersView.effectiveMutations).toBe(0);
    expect(child.genome).toEqual(baseGenome);
    expect(world.lineage.find((node) => node.id === child.id)?.mutation).toBeNull();
  });

  it('copies genomes unchanged when mutation is off and marks a retained parent record present', () => {
    const world = fixture({ seed: 5, mutation: false, founders: [founder({ store: 160,
      genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 } })] });
    world.step(160);
    const child = world.organisms.find((organism) => organism.parentID !== null)!;
    expect(child.genome).toEqual(world.organisms[0].genome);
    expect(world.lineage.find((node) => node.id === child.id)?.mutation).toBeNull();
    expect(world.lineage.find((node) => node.id === child.id)?.parentRecordDropped).toBe(false);
  });

  it('samples 0/every 20/extinction once and keeps bounded copied history', () => {
    const world = new DevelopmentWorld(27, false);
    world.step(120);
    expect(world.history.map((record) => record.tick)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    const copiedHistory = world.history as unknown as { tick: number }[];
    expect(() => { copiedHistory[1].tick = 999; }).toThrow();
    expect(world.history[1].tick).toBe(20);
    expect(world.census().ledgerResidual).toBe(0);
  });

  it('deduplicates extinction at a regular sample tick', () => {
    const world = fixture({ food: 40, founders: [founder({ age: 580, store: 160 })] });
    world.step(20);
    expect(world.extinctionTick).toBe(20);
    expect(world.history.map(({ tick }) => tick)).toEqual([0, 20]);
    expect(world.history[1].population).toBe(0);
  });

  it('rejects malformed fixture arrays, fields, occupancy, and scalar bounds', () => {
    expect(() => fixture({ food: 41 })).toThrow();
    expect(() => createDevelopmentFixture({ seed: 1, mutation: false, food: new Uint8Array(2), founders: [] })).toThrow();
    expect(() => fixture({ founders: [founder(), founder()] })).toThrow();
    expect(() => fixture({ founders: [founder({ heading: 4 })] })).toThrow();
    expect(() => fixture({ founders: [{ ...founder(), extra: true } as never] })).toThrow();
    expect(() => fixture({ founders: [founder({ store: 161 })] })).toThrow();
  });
});
