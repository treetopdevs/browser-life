// Pins the rules: any change to the dynamics changes these hashes. If a change
// is intended, bump RULE_VERSION and update the table deliberately.
import { describe, expect, it } from "vitest";
import { RULE_VERSION, cloneState } from "@bl/schema";
import { goldenCases } from "@bl/sim-gpu";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { stateHash } from "@bl/schema";

// Digests cover config, step, cells, canonical genome and the full ledger
// (re-pinned 2026-09-26 when the digest was widened; the rules did not change).
// Version 1 is pre-release: the mutation saturation boundary (newB > mutCap)
// was corrected on 2026-09-26 before the first commit, without changing any
// earlier pin; "mutation-boundary" pins the corrected rule.
//
// WorldConfig's `adhesion`/`kAdhesion` (the adhesion actuator) are optional
// and deliberately absent from defaultConfig()'s own defaults (see
// WorldConfig in packages/schema/src/config.ts): the digest hashes the whole
// config object, so a config that never sets either key must serialise --
// and hash -- exactly as it did before this actuator existed. Only the
// "adhesion"/"adhesion-extremes"/"adhesion-default-gain" cases (which do set
// at least `adhesion`) get new pins below; the 8 original pins are untouched.
const PINNED: Record<number, Record<string, string>> = {
  1: {
    soup: "b3d47d070e6c6cea",
    "tiled+mutation-heavy": "117d8fd3b1e77f42",
    "patches+seasons": "3e4f084e6301f052",
    "lesion+stats": "d43796023aab7ee8",
    "blocked-affinity": "5305b74b343ada3a",
    extremes: "4ab5f8cae369f055",
    "neutral-shadow": "be5cf2be45d6a153",
    adhesion: "50eddcb6828ecddd",
    "adhesion-extremes": "00c9ffa767290ed9",
    "adhesion-default-gain": "16b879ff174bb74c",
    "polymer-transport-off": "2adcd0a6ecc3761a",
    "mutation-boundary": "0966e96ab1306e8f",
    "ring-namespace": "e277953f6ebc2ea2",
    // Lossy takeover (WorldConfig.takeover, optional, ownership sandbox): new
    // cases only; every pin above is unchanged.
    "takeover-lineage": "b73f19659cf78e51",
    "takeover-growth": "e01f6f014554e875",
    "takeover-genome": "dfb56d29a4d59f7a",
    // Recurring injury (WorldConfig.injuryPeriod, optional, ownership sandbox).
    injury: "1fd51d2042631706",
    "injury-extremes": "a007c064a2346ee8",
    // Heritable kernel shape (WorldConfig.shapeReach, optional, cells sandbox).
    "shape-far": "2f9a2c0e000f2330",
    "shape-near": "01fbc54dc408e1e1",
    // Sandbox "sweep" light mode (optional dayPeriod, absent elsewhere): a new
    // case with its own pin; every pin above is untouched.
    sweep: "e69b229777d809cf",
    // Sandbox optional signalGain (absent elsewhere): its own new pin.
    "signal-gain": "950301275043e2fa",
    // Sandbox optional wanderPeriod/wanderAmp (absent elsewhere): its own new pin.
    "sweep-wander": "dcfbb10ffe638f13",
    // Wild sandbox: every optional lever at once (see the case in golden.ts).
    "wild-stack": "ba3c41c46b14c035",
  },
  // Rule 2 introduces optional matrix drag. Even unchanged trajectories get
  // new hashes because the digest includes cfg.ruleVersion. Rule-1 pins
  // above remain unchanged and are executed separately below.
  2: {
    soup: "8672cf43e23a2191",
    "tiled+mutation-heavy": "965191399086d4e6",
    "patches+seasons": "99dd24075d570eec",
    "lesion+stats": "25b1ea708beacf51",
    "blocked-affinity": "ea9180914c466639",
    extremes: "d5ad194dfb494dd4",
    "neutral-shadow": "5323ca6a46cf2923",
    adhesion: "46c70ae5bde64e30",
    "adhesion-extremes": "f46d381e9f39ea47",
    "adhesion-default-gain": "f0eeac65bbfad501",
    "polymer-transport-off": "19a7e424a3e57b7b",
    "polymer-drag": "d4214f795b70ece9",
    "polymer-drag-extremes": "0326b44826cbccd1",
    "mutation-boundary": "92eed0da25afc74a",
    "ring-namespace": "46eb59a05b14971f",
    // The lab sandboxes' optional levers under rule 2 (drag off): the same
    // trajectories and mutation counts as their rule-1 pins; only the digest's
    // cfg.ruleVersion differs. GPU bit-exact (tests/deno/gpu_golden.ts).
    sweep: "95be3c44a2d3238f",
    "signal-gain": "0f46cd7a78627e94",
    "sweep-wander": "c64c0a163d68afc7",
    "takeover-lineage": "2fc60340920457dd",
    "takeover-growth": "f52f56c125dfda63",
    injury: "2cd4123610cf79b9",
    "takeover-genome": "ddd6663de0234d14",
    "injury-extremes": "d68803060baee716",
    "shape-far": "1ba1c13e5d0a2c51",
    "shape-near": "93391c919d6b2188",
    "wild-stack": "55a674bf977d88c2",
  },
};

for (const version of [1, RULE_VERSION]) describe(`rule version ${version}`, () => {
  for (const gc of goldenCases(version)) {
    it(`${gc.name} matches its pinned hash`, () => {
      const sim = new RefSim(cloneState(gc.init(gc.cfg)));
      for (let s = 0; s < gc.steps; s += gc.every) {
        sim.run(gc.every);
        if (gc.lesion && s === 0) applyLesion(sim, ...gc.lesion);
      }
      expect(stateHash(sim.state)).toBe(PINNED[version]?.[gc.name]);
    });
  }
});
