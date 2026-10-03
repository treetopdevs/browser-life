// Renewal v1 contract: matrix, budget, resources, pairing and arms.
// Initialization only: no scientific seed and no reservoir witness habitat is stepped.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allocState,
  b2,
  CH,
  defaultConfig,
  encodeGenome,
  G,
  generalistGenome,
  genomeHex,
  GENOME_CHANNELS,
  OUT,
  totalsOf,
} from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import {
  armGenome,
  checkPairedArrays,
  enumerateConfirmationCases,
  enumerateInitialCases,
  expectedTotals,
  genomeByteDiff,
  initialState,
  type RenewalInputs,
  type RenewalProtocol,
  resolveConfig,
  stepBudget,
  validateProtocol,
} from "../lib/construction-renewal.ts";

const read = (p: string) => readFileSync(p);
const protocol = JSON.parse(read("experiments/construction/renewal-v1/protocol.json").toString()) as RenewalProtocol;
const inputs: RenewalInputs = {
  witness: JSON.parse(read(protocol.inputs.witness.path).toString()),
  selected: JSON.parse(read(protocol.inputs.selected.path).toString()),
};
const sha = (p: string) => createHash("sha256").update(read(p)).digest("hex");

describe("renewal v1 protocol", () => {
  it("binds the plan and both inputs by SHA-256", () => {
    expect(sha(protocol.plan.path)).toBe(protocol.plan.sha256);
    expect(sha(protocol.inputs.witness.path)).toBe("7cbf49c409b137768b90c176b2a68c7034e3a870f81163cf969b0bbfc03e6019");
    expect(sha(protocol.inputs.selected.path)).toBe("18b596eaf84a2724706e1b93988c40f0992ed25c182c248af0a17c7cf719ebdd");
  });

  it("validates and enumerates the fixed 40/20 matrix and its step budget", () => {
    expect(validateProtocol(protocol)).toEqual([]);
    const initial = enumerateInitialCases(protocol);
    const controls = initial.filter((c) => c.phase === "controls");
    expect(controls.map((c) => c.id).slice(0, 4)).toEqual([
      "control-capacity-A4",
      "control-capacity-A16",
      "control-division-A4",
      "control-division-A16",
    ]);
    expect(controls.length).toBe(16);
    expect(controls.filter((c) => c.kind === "small-founder").length).toBe(12);
    expect(initial.filter((c) => c.phase === "pilot").length).toBe(24);
    expect(initial.slice(0, 16).every((c) => c.phase === "controls")).toBe(true);
    expect(stepBudget(initial)).toBe(372_000);
    const conf = enumerateConfirmationCases(protocol, { reservoir: 4, spread: 1 });
    expect(conf.length).toBe(20);
    expect(stepBudget(initial) + stepBudget(conf)).toBe(572_000);
    expect(new Set(conf.map((c) => c.seed))).toEqual(new Set([7311001, 7311002, 7311003, 7311004, 7311005]));
    expect(initial.every((c) => c.seed === 7310001)).toBe(true);
    expect(() => enumerateConfirmationCases(protocol, { reservoir: 4, spread: 0 })).toThrow("not in the frozen selection order");
  });

  it("rejects a protocol whose arithmetic drifts from the plan", () => {
    const bad = structuredClone(protocol);
    bad.phases.pilot.horizon = 9000;
    expect(validateProtocol(bad).length).toBeGreaterThan(0);
    const badSeed = structuredClone(protocol);
    badSeed.seeds.confirmation = [7310001, 7311002, 7311003, 7311004, 7311005];
    expect(validateProtocol(badSeed)).toContain("confirmation reuses the pilot seed");
  });

  it("places founders deterministically with lineages in listed order", () => {
    const cases = enumerateInitialCases(protocol);
    const capacity = cases.find((c) => c.id === "control-capacity-A4")!;
    const s = initialState(protocol, inputs, capacity);
    const n = 1024, left = 16 * 32 + 8, right = 16 * 32 + 24;
    expect(capacity.sourceSites).toEqual([left, right]);
    expect(s.genome[G.LIN_LO * n + left]).toBe(1);
    expect(s.genome[G.LIN_LO * n + right]).toBe(2);
    expect(s.cells[CH.B * n + left]).toBe(1024);
    expect(s.cells[CH.E * n + right]).toBe(2048);
    const main = cases.find((c) => c.id === "pilot-builder-A4-s1")!;
    expect(main.sourceSites).toEqual([16 * 32 + 16]);
    expect(main.founders).toEqual([{ x: 16, y: 16, biomass: 1024, energy: 2048 }]);
  });

  it("supplies exactly the plan's resources, with A in every cell including the founder's", () => {
    const table: Record<string, [bigint, bigint]> = {
      "pilot-builder-A4-s0": [5120n, 12288n],
      "pilot-ablation-A16-s2": [17408n, 12288n],
      "control-division-A4": [5120n, 12288n],
      "control-capacity-A4": [6144n, 24576n],
      "control-capacity-A16": [18432n, 24576n],
      "control-small-B64-A4-s0": [4160n, 768n],
      "control-small-B64-A16-s1": [16448n, 768n],
      "control-small-B128-A4-s2": [4224n, 1536n],
      "control-small-B128-A16-s0": [16512n, 1536n],
    };
    for (const c of enumerateInitialCases(protocol)) {
      const s = initialState(protocol, inputs, c);
      const t = totalsOf(s.cfg, s.cells), e = expectedTotals(protocol, inputs, c);
      expect([t.B, t.E, t.matter, t.energy]).toEqual([e.B, e.E, e.matter, e.energy]);
      expect([t.C, t.P, t.S]).toEqual([0n, 0n, 0n]);
      for (let i = 0; i < 1024; i++) expect(s.cells[CH.A * 1024 + i]).toBe(c.reservoir);
      expect(s.step).toBe(0);
      if (table[c.id]) expect([t.matter, t.energy]).toEqual(table[c.id]);
    }
  });

  it("pairs arms with byte-identical matter and energy arrays inside each habitat", () => {
    const cases = enumerateInitialCases(protocol).filter((c) => c.phase === "pilot");
    const states = cases.map((spec) => ({ spec, state: initialState(protocol, inputs, spec) }));
    expect(() => checkPairedArrays(states)).not.toThrow();
    expect(new Set(cases.map((c) => c.habitat)).size).toBe(6);
    const broken = states.map((s) => ({ ...s, state: { ...s.state, cells: s.state.cells.slice() } }));
    broken[1].state.cells[CH.A * 1024 + 3] += 1;
    expect(() => checkPairedArrays(broken)).toThrow("differ");
  });

  it("matched comparator differs from the builder in exactly b2(OUT.BUILD), 16 to 0", () => {
    const builder = armGenome(protocol, inputs, "builder"), matched = armGenome(protocol, inputs, "matched");
    expect(builder.weights[b2(OUT.BUILD)]).toBe(16);
    expect(matched.weights[b2(OUT.BUILD)]).toBe(0);
    const changed = Array.from(builder.weights).flatMap((w, i) => (w === matched.weights[i] ? [] : [i]));
    expect(changed).toEqual([b2(OUT.BUILD)]);
    expect(genomeByteDiff(genomeHex(builder), genomeHex(matched)).length).toBe(1);
    expect(genomeHex(armGenome(protocol, inputs, "ablation"))).toBe(genomeHex(builder));
    expect(genomeHex(armGenome(protocol, inputs, "selected"))).toBe(inputs.selected.genome);
    expect(genomeHex(builder)).toBe(inputs.witness.genomeHex);
  });

  it("resolves the witness config with only seed, spread and the ablation's gate overridden", () => {
    const w = inputs.witness.cfg as unknown as Record<string, unknown>;
    for (const arm of ["builder", "matched", "selected", "ablation"] as const) {
      const cfg = resolveConfig(protocol, inputs, { seed: 7310001, spread: 2, arm }) as unknown as Record<string, unknown>;
      const changed = Object.keys({ ...w, ...cfg }).filter((k) => w[k] !== cfg[k]).sort();
      expect(changed).toEqual(arm === "ablation" ? ["polymerTransport", "seed", "spread"] : ["seed", "spread"]);
      for (const k of ["polymerDrag", "adhesion", "kAdhesion", "migrationPeriod", "migrantCount", "ringNamespace", "pondPeriod", "pondK", "pondArm"]) {
        expect(k in cfg).toBe(false);
      }
      expect(cfg.mutRate).toBe(0);
      expect(cfg.ruleVersion).toBe(1);
      expect(cfg.dtQ).toBe(0);
      expect(cfg.motility).toBe(false);
    }
    const tainted = { ...inputs, witness: { ...inputs.witness, cfg: { ...inputs.witness.cfg, polymerDrag: true } } };
    expect(() => resolveConfig(protocol, tainted, { seed: 1, spread: 1, arm: "builder" })).toThrow("polymerDrag");
    const drifted = { ...inputs, witness: { ...inputs.witness, cfg: { ...inputs.witness.cfg, kAbio: 5 } } };
    expect(() => resolveConfig(protocol, drifted, { seed: 1, spread: 1, arm: "builder" })).toThrow("kAbio");
  });

  it("mutation stays off at mutRate 0 on an artificial growing world (not the witness habitat)", () => {
    const run = (mutRate: number) => {
      const cfg = defaultConfig({ ruleVersion: 1, seed: 99, tileW: 16, tileH: 16, kernelRadius: 2, lightMode: "uniform", lightBase: 255, lightAmp: 0, dtQ: 0, motility: false, mutRate, spread: 1 });
      const s = allocState(cfg), n = 256;
      const words = encodeGenome(generalistGenome(154, 24), 0, 1);
      for (let i = 0; i < n; i++) {
        s.cells[CH.A * n + i] = 200;
        s.cells[CH.MOT * n + i] = 128 | (128 << 8);
      }
      for (const i of [0, 37, 100, 200]) {
        s.cells[CH.B * n + i] = 400;
        s.cells[CH.E * n + i] = 800;
        for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = words[g];
      }
      const sim = new RefSim(s);
      let events = 0;
      for (let t = 0; t < 400; t++) events += sim.step().events.length;
      return { events, grew: sim.state.flux[3] > 0n };
    };
    const off = run(0);
    expect(off.grew).toBe(true);
    expect(off.events).toBe(0);
    expect(run(2 ** 28).events).toBeGreaterThan(0);
  });
});
