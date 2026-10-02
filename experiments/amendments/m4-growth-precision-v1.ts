/**
 * Precision extension for the 2026-09-29 M4 growth candidate (m4-growth-v1).
 * Its frozen validation failed one null screen: spots-m3 paired endpoint-1
 * null, 2/200, one-sided 95% upper bound 0.0311 > 0.025. This is a single,
 * separately frozen, fixed-N re-test of that screen with a fresh master seed.
 * It is never concatenated with the 2026-09-29 trials, never topped up, and
 * is not a confirmation or a registration. Protocol:
 * experiments/amendments/2026-10-02-m4-growth-precision.md.
 */
export const M4_GROWTH_PRECISION_V1 = {
  id: "m4-growth-precision-v1",
  date: "2026-10-02",
  parent: "m4-growth-v1",
  parentValidation: {
    manifestSha256: "fc22327f851a782c43c5ecf0a6d794737f363df40473d3f0870b9d9a586ea321",
    reportSha256: "b74d8f439edc96c24fbafba05f27b3dfff30c8ea1c0ddc8bffbdbe670f609932",
    trialsSha256: "ee6808f0d41859fee46247fedffab160c3f27fe539af1b3054eb82e27b23683d",
  },
  phase: "precision-extension",
  // Unused in every local workspace's docs, tools, experiments and runs on
  // 2026-10-02 (word-bounded scan); 650009001/650009002 are consumed.
  masterSeed: 650009003,
  // Engineering checks only: the 2026-09-29 development master, already consumed.
  engineeringMaster: 650009001,
  engineeringMaxTrials: 10,
  trials: 20_000,
  pairs: 64,
  strata: [
    { scenario: "pairedEndpoint1Null", preset: "gradient-m3" },
    { scenario: "pairedEndpoint1Null", preset: "spots-m3" },
  ],
  // Identical to the 2026-09-29 validation acceptance object.
  acceptance: {
    nullOneSided95UpperMax: 0.025,
    nominalPerPresetAlpha: 0.005,
    alternativeOneSided95PowerLowerMin: 0.8,
    alternativeMeanConfidenceMarginMax: 2,
    unavailable:
      "Report separately and include as non-support in unconditional procedure operating characteristics; never claim available inference for them.",
  },
} as const;
