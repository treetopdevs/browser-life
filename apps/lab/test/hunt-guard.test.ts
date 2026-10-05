// The lab refuses the transition hunt's pond arms (pondArm "nat" and "shuf"; docs/scaffold-transition-hunt-v1.md,
// "Code to build"): LabExecution refuses a world that has one, whatever its start state or observer, and the worker's
// entry points (a new preset world, an import, a restore or jump) check the same function before they build anything.
// The v1 arms are untouched. The worker itself needs a GPU and a worker scope, so its call sites are pinned by source.
import { describe, expect, it } from "vitest";
import { PRESETS, initWorld, presetConfig, type WorldConfig, type WorldState } from "@bl/schema";
import { restoreObservers, serializeObservers } from "@bl/runner";
import { LabExecution, huntArmError, type LabSimulation } from "../src/execution.ts";
import source from "../src/sim.worker.ts?raw";

const settings = { censusEvery: 2, deepEvery: 5, activityThreshold: null };
const pondsSmall = PRESETS.find((p) => p.id === "ponds-small")!;
const hunt = { pondDeath: 32_768, pondExport: 28 };

/** ponds-small's start world at seed 1 with `extra`, at `step` (a refusal never steps it). */
function world(extra: Partial<WorldConfig> = {}, step = 0): WorldState {
  return { ...initWorld(presetConfig(pondsSmall, 1, { pondPeriod: 4, ...extra }), pondsSmall.init), step };
}

/** All the constructor reads before it refuses or settles in: the config and the step. */
const stub = (state: WorldState) => ({ cfg: state.cfg, step: state.step }) as unknown as LabSimulation;
const options = { waitForIdle: async () => {}, isCurrent: () => true };

describe("huntArmError", () => {
  it("is null without a pond arm and for the v1 arms", () => {
    expect(huntArmError({})).toBeNull();
    for (const arm of ["scaf", "rand", "cont"] as const) expect(huntArmError({ pondArm: arm })).toBeNull();
  });

  it("names the hunt, the arm and that the lab does not run its arms yet, for nat and shuf", () => {
    for (const arm of ["nat", "shuf"] as const) {
      const message = huntArmError({ pondArm: arm });
      expect(message).toContain(`"${arm}"`);
      expect(message).toMatch(/transition hunt/);
      expect(message).toMatch(/lab does not run the hunt's arms yet/);
    }
  });
});

describe("LabExecution refuses the hunt's arms", () => {
  it.each(["nat", "shuf"] as const)("a %s world, fresh or imported mid-run, with or without a start state or observer", (arm) => {
    const fresh = world({ pondArm: arm, ...hunt });
    const mid = world({ pondArm: arm, ...hunt }, 6);
    const refused = /transition hunt.*lab does not run the hunt's arms yet/;
    expect(() => new LabExecution(stub(fresh), settings, { ...options, start: fresh })).toThrow(refused);
    expect(() => new LabExecution(stub(fresh), settings, options)).toThrow(refused);
    const observer = serializeObservers(restoreObservers(undefined, settings, mid.cfg), mid.step, settings);
    expect(() => new LabExecution(stub(mid), settings, { ...options, start: mid, observer: { ...observer, ponds: { lastCycle: 1 } } })).toThrow(refused);
    // Before the cadence, observer and start checks, so none of their messages hides it.
    const off = world({ pondArm: arm, ...hunt, pondPeriod: 5 });
    expect(() => new LabExecution(stub(off), settings, { ...options, start: off })).toThrow(refused);
  });

  it("still builds a v1 pond world", () => {
    for (const arm of ["scaf", "rand", "cont"] as const) {
      const state = world({ pondArm: arm });
      expect(() => new LabExecution(stub(state), settings, { ...options, start: state })).not.toThrow();
    }
  });
});

// The worker is only importable inside a worker with WebGPU, so pin what it must do: check every world's config
// before building one, in the two places worlds enter (`load` for a preset with overrides, `adopt` for the rest).
describe("the worker checks its entry points", () => {
  const body = (name: string) => {
    const at = source.indexOf(`async function ${name}(`);
    expect(at).toBeGreaterThan(-1);
    return source.slice(at, source.indexOf("\n}\n", at));
  };

  it("load and adopt call huntArmError before building the world", () => {
    expect(body("load")).toMatch(/huntArmError\(cfg\)[\s\S]*initWorld\(/);
    expect(body("adopt")).toMatch(/huntArmError\(state\.cfg\)[\s\S]*GpuSim\.create\(/);
  });

  it("import and restore reach the world only through adopt", () => {
    expect(body("restore")).toContain("await adopt(");
    expect(source.slice(source.indexOf('case "import"'), source.indexOf('case "verify"'))).toContain("await adopt(");
    expect(source.match(/GpuSim\.create\(/g)).toHaveLength(2); // adopt's, and verify's twin of an already adopted world
  });
});
