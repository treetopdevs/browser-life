/** Candidate dated amendment. Not a declaration that M4 is met or ready to launch. */
export const M4_GROWTH_V1 = {
  id: "m4-growth-v1",
  date: "2026-09-29",
  status: "development",
  presets: ["gradient-m3", "spots-m3"],
  conditions: ["treatment", "neutral", "no-mutation"],
  horizon: 1_000_000,
  windowStart: 500_000,
  censusEvery: 100,
  deepEvery: 10,
  unitsSteps: 100_000,
  alphaFamily: 0.01,
  // Bonferroni across two preset growth claims. Original endpoint 1 stays separate.
  alphaPerPreset: 0.005,
  effectFloor: 1,
  candidatePairs: 64,
  test: "paired-student-t-mean",
  minimumPairs: 2,
  syntheticDevelopmentMaster: 650009001,
  syntheticValidationMaster: 650009002,
} as const;
