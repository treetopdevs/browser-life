import assert from "node:assert/strict";
import {
  buildWorld,
  cellCount,
  CH,
  encodeGenome,
  G,
  GENOME_CHANNELS,
  lineageKey,
  packLineageLo,
  presetConfig,
  PRESETS,
  type WorldState,
} from "@bl/schema";
import {
  discoveryEvolutionConfig,
  discoveryEvolutionWorld,
  sampleDiscoveryEvolution,
} from "../lib/discovery-evolution.ts";
import { asSimGenome, type MutationEdge } from "../lib/founder-policy.ts";
import {
  fromHex,
  normalizeGenome,
  toHex,
} from "../lib/selection-funnel-audit.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  assert.deepStrictEqual(actual, expected);
}

function assertThrows(
  fn: () => unknown,
  _errorType: typeof Error,
  message: string,
): void {
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof Error && error.message.includes(message),
  );
}

const founder = () =>
  normalizeGenome({
    mu: 60,
    sigma: 20,
    motGain: 0,
    weights: Array(160).fill(0),
  });

function stateWithGenomeMasses(
  genomes: { hex: string; mass: number; lineage: string }[],
  step = 100_000,
): WorldState {
  const cfg = discoveryEvolutionConfig(777, "normal");
  const state = buildWorld(cfg, {
    nutrient: 32,
    founders: [{
      x: 128,
      y: 128,
      radius: 12,
      genome: asSimGenome(founder()),
      biomass: 64,
      energy: 128,
    }],
  });
  state.step = step;
  const n = state.cfg.tileW * state.cfg.tileH;
  const occupied = [] as number[];
  for (let i = 0; i < n; i++) {
    if (state.cells[CH.B * n + i] > 0) occupied.push(i);
  }
  for (const i of occupied) {
    state.cells[CH.B * n + i] = 0;
    state.cells[CH.P * n + i] = 0;
  }
  const total = genomes.reduce((sum, item) => sum + item.mass, 0);
  if (total > occupied.length) {
    throw Error("test mass needs more occupied cells");
  }
  let at = 0;
  for (const item of genomes) {
    const genome = fromHex(item.hex);
    const [hi, lo] = item.lineage.split(":").map(Number);
    const words = encodeGenome(asSimGenome(genome), hi, lo);
    for (let j = 0; j < item.mass; j++) {
      const i = occupied[at++];
      state.cells[CH.B * n + i] = 1;
      state.cells[CH.P * n + i] = 0;
      for (let g = 0; g < GENOME_CHANNELS; g++) {
        state.genome[g * n + i] = words[g];
      }
    }
  }
  // The untouched cells in the disc are zero-mass and do not count.
  return state;
}

function rootLineage(seed = 777): string {
  return lineageKey(
    0,
    packLineageLo(discoveryEvolutionConfig(seed, "normal"), 1),
  );
}

Deno.test("normal and mutation-off worlds preserve single-founder initial physical identity", () => {
  const hex = toHex(founder());
  const normal = discoveryEvolutionWorld(701, "normal", hex),
    off = discoveryEvolutionWorld(701, "off", hex);
  assertEquals(normal.state.cells, off.state.cells);
  assertEquals(normal.state.genome, off.state.genome);
  assertEquals(normal.founderRoots, off.founderRoots);
  assertEquals(Object.keys(normal.founderRoots).length, 1);
  assertEquals(discoveryEvolutionConfig(701, "off").mutRate, 0);
  assertEquals(
    discoveryEvolutionConfig(701, "normal").mutRate,
    presetConfig(PRESETS.find((p) => p.id === "gradient-m3")!, 701).mutRate,
  );
});

Deno.test("sampling accepts only the three exact observation times and u32 draw seeds", () => {
  const world = discoveryEvolutionWorld(702, "normal", toHex(founder()));
  world.state.step = 1;
  assertThrows(
    () => sampleDiscoveryEvolution(world.state, world.founderHex, [], [1, 2]),
    Error,
    "unplanned sample step",
  );
  world.state.step = 100_000;
  assertThrows(
    () => sampleDiscoveryEvolution(world.state, world.founderHex, [], [-1, 2]),
    Error,
    "u32",
  );
  assertThrows(
    () =>
      sampleDiscoveryEvolution(world.state, world.founderHex, [], [
        1,
        0x1_0000_0000,
      ]),
    Error,
    "u32",
  );
});

Deno.test("sampling is weighted with replacement and preserves duplicate genome draws", () => {
  const a = toHex(founder()), bGenome = founder();
  bGenome.mu++;
  const b = toHex(bGenome),
    state = stateWithGenomeMasses([
      { hex: a, mass: 99, lineage: rootLineage() },
      {
        hex: b,
        mass: 1,
        lineage: `1:${
          packLineageLo(discoveryEvolutionConfig(777, "normal"), 9001)
        }`,
      },
    ]);
  const result = sampleDiscoveryEvolution(state, a, [{
    child: `1:${packLineageLo(discoveryEvolutionConfig(777, "normal"), 9001)}`,
    parent: rootLineage(),
  }], [1, 1]);
  assertEquals(result.draws.status, "present");
  assertEquals(result.draws.genomes.length, 2);
  assertEquals(result.draws.genomes[0], result.draws.genomes[1]);
  assertEquals(result.rootMass, 100);
  assertEquals(result.byGenomeAbundance, [{ hex: a, mass: 99 }, {
    hex: b,
    mass: 1,
  }]);
});

Deno.test("mutation parent chains resolve changed genomes back to the founder", () => {
  const a = toHex(founder()), bGenome = founder();
  bGenome.sigma++;
  const b = toHex(bGenome), root = rootLineage();
  const state = stateWithGenomeMasses(
    [{
      hex: b,
      mass: 4,
      lineage: `2:${
        packLineageLo(discoveryEvolutionConfig(777, "normal"), 9002)
      }`,
    }],
    100_000,
  );
  const edges: MutationEdge[] = [{
    child: `2:${packLineageLo(discoveryEvolutionConfig(777, "normal"), 9002)}`,
    parent: `1:${packLineageLo(discoveryEvolutionConfig(777, "normal"), 9001)}`,
  }, {
    child: `1:${packLineageLo(discoveryEvolutionConfig(777, "normal"), 9001)}`,
    parent: root,
  }];
  const result = sampleDiscoveryEvolution(state, a, edges, [42, 43]);
  assertEquals(result.rootMass, 4);
  assertEquals(result.byGenomeAbundance, [{ hex: b, mass: 4 }]);
  assertEquals(result.draws.genomes, [b, b]);
});

Deno.test("validates cell-zero mutation and leaves missing historical ancestry unresolved", () => {
  const a = toHex(founder()), cfg = discoveryEvolutionConfig(777, "normal");
  const child = `3:${packLineageLo(cfg, 0)}`;
  const state = stateWithGenomeMasses([{ hex: a, mass: 1, lineage: child }]);
  assertEquals(
    sampleDiscoveryEvolution(state, a, [{ child, parent: rootLineage() }], [
      12,
      13,
    ]).draws.status,
    "present",
  );
  assertEquals(
    sampleDiscoveryEvolution(state, a, [{
      child,
      parent: `2:${packLineageLo(cfg, 4)}`,
    }], [12, 13]).draws.status,
    "unresolved",
  );
});

Deno.test("rejects forged normal founder genomes and noncausal or out-of-range events", () => {
  const a = toHex(founder()), changed = founder();
  changed.mu++;
  const forged = stateWithGenomeMasses([{
    hex: toHex(changed),
    mass: 1,
    lineage: rootLineage(),
  }]);
  assertThrows(
    () => sampleDiscoveryEvolution(forged, a, [], [1, 2]),
    Error,
    "founder lineage carries",
  );

  const state = stateWithGenomeMasses([{
    hex: a,
    mass: 1,
    lineage: rootLineage(),
  }]);
  const cfg = state.cfg, root = rootLineage();
  const badEdges: [MutationEdge, string][] = [
    [
      { child: `100001:${packLineageLo(cfg, 1)}`, parent: root },
      "sampled state",
    ],
    [{
      child: `100:${packLineageLo(cfg, 1)}`,
      parent: `100:${packLineageLo(cfg, 2)}`,
    }, "causal"],
    [{ child: `0:${packLineageLo(cfg, 1)}`, parent: root }, "sampled state"],
    [
      { child: `1:${packLineageLo(cfg, cellCount(cfg))}`, parent: root },
      "cell index",
    ],
  ];
  for (const [edge, message] of badEdges) {
    assertThrows(
      () => sampleDiscoveryEvolution(state, a, [edge], [1, 2]),
      Error,
      message,
    );
  }
});

Deno.test("distinguishes absent root mass from unresolved ancestry", () => {
  const a = toHex(founder());
  const absent = stateWithGenomeMasses([]);
  assertEquals(
    sampleDiscoveryEvolution(absent, a, [], [1, 2]).draws.status,
    "absent",
  );
  const unknownGenome = toHex(founder()),
    unresolved = stateWithGenomeMasses([{
      hex: unknownGenome,
      mass: 1,
      lineage: "5:6",
    }]);
  const sampled = sampleDiscoveryEvolution(unresolved, a, [], [1, 2]);
  assertEquals(sampled.rootMass, 0);
  assertEquals(sampled.unknownAncestryMass, 1);
  assertEquals(sampled.draws.status, "unresolved");
});

Deno.test("lineage-zero B/P remains unassociated without making the founder unresolved", () => {
  const a = toHex(founder()), state = stateWithGenomeMasses([]);
  const n = state.cfg.tileW * state.cfg.tileH;
  const cell = 0;
  state.cells[CH.B * n + cell] = 7;
  state.cells[CH.P * n + cell] = 3;
  for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + cell] = 0;
  const sampled = sampleDiscoveryEvolution(state, a, [], [31, 32]);
  assertEquals(sampled.draws.status, "absent");
  assertEquals(sampled.rootMass, 0);
  assertEquals(sampled.unassociatedMass, 10);
  assertEquals(sampled.unknownAncestryMass, 0);
});

Deno.test("rejects malformed genomes and conflicting or cyclic mutation parents", () => {
  const a = toHex(founder()),
    state = stateWithGenomeMasses([{
      hex: a,
      mass: 1,
      lineage: rootLineage(),
    }]);
  const n = state.cfg.tileW * state.cfg.tileH;
  const i =
    state.cells.findIndex((v, at) =>
      at >= CH.B * n && at < (CH.B + 1) * n && v > 0
    ) - CH.B * n;
  state.genome[G.PARAM1 * n + i] |= 0x100;
  assertThrows(
    () => sampleDiscoveryEvolution(state, a, [], [1, 2]),
    Error,
    "padding",
  );
  const good = stateWithGenomeMasses([{
    hex: a,
    mass: 1,
    lineage: rootLineage(),
  }]);
  assertThrows(
    () =>
      sampleDiscoveryEvolution(good, a, [
        { child: "3:1", parent: "2:2" },
        { child: "3:1", parent: "0:1" },
      ], [1, 2]),
    Error,
    "conflicting",
  );
  assertThrows(
    () =>
      sampleDiscoveryEvolution(good, a, [
        { child: "3:1", parent: "3:2" },
        { child: "3:2", parent: "3:1" },
      ], [1, 2]),
    Error,
    "causal",
  );
  assertThrows(
    () =>
      sampleDiscoveryEvolution(good, a, [{
        child: "03:1",
        parent: rootLineage(),
      }], [1, 2]),
    Error,
    "malformed",
  );
});

Deno.test("mutation-off rejects edges and altered carried genomes", () => {
  const hex = toHex(founder()),
    world = discoveryEvolutionWorld(703, "off", hex);
  assertThrows(
    () =>
      sampleDiscoveryEvolution(world.state, hex, [{
        child: "1:2",
        parent: world.founderRoots ? Object.keys(world.founderRoots)[0] : "0:1",
      }], [3, 4]),
    Error,
    "no mutation edges",
  );
  const n = world.state.cfg.tileW * world.state.cfg.tileH;
  for (let i = 0; i < n; i++) {
    if (world.state.cells[CH.B * n + i] > 0) {
      world.state.genome[G.PARAM0 * n + i] ^= 1;
    }
  }
  assertThrows(
    () => sampleDiscoveryEvolution(world.state, hex, [], [3, 4]),
    Error,
    "changed genome",
  );
});
