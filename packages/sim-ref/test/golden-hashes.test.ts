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
    "mutation-boundary": "0966e96ab1306e8f",
  },
};

describe(`rule version ${RULE_VERSION}`, () => {
  for (const gc of goldenCases()) {
    it(`${gc.name} matches its pinned hash`, () => {
      const sim = new RefSim(cloneState(gc.init(gc.cfg)));
      for (let s = 0; s < gc.steps; s += gc.every) {
        sim.run(gc.every);
        if (gc.lesion && s === 0) applyLesion(sim, ...gc.lesion);
      }
      expect(stateHash(sim.state)).toBe(PINNED[RULE_VERSION]?.[gc.name]);
    });
  }
});
