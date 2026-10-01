// Experimental conditions: the treatment and the pre-registered controls.
// Each is a pure transformation of the world config, so a (preset, condition,
// seed) triple fully determines a run.

import type { WorldConfig } from "@bl/schema";

/** Integer mean of f over 0..n-1, rounded half up (exact: sums are small integers). */
function meanRounded(n: number, f: (i: number) => number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += f(i);
  return Math.floor((2 * sum + n) / (2 * n));
}

export interface Condition {
  id: string;
  label: string;
  /** What the control removes, for reports. */
  removes: string;
  apply: (cfg: WorldConfig) => Partial<WorldConfig>;
}

export const CONDITIONS: Condition[] = [
  { id: "treatment", label: "Treatment", removes: "nothing", apply: () => ({}) },
  { id: "no-mutation", label: "No mutation", removes: "heritable variation", apply: () => ({ mutRate: 0 }) },
  { id: "neutral", label: "Neutral shadow", removes: "genotype → phenotype mapping (selection)", apply: () => ({ neutral: true }) },
  {
    id: "uniform-light",
    label: "Uniform light",
    removes: "spatial energy gradient",
    // Replaces the spatial pattern by its tile-mean intensity (the light
    // function of packages/sim-ref/src/step.ts, rounded to the nearest integer).
    apply: (c) => {
      if (c.lightMode === "uniform") throw new Error("uniform-light control needs a preset with a spatial light pattern");
      const mean =
        c.lightMode === "gradient"
          ? meanRounded(c.tileH, (ly) => Math.floor((c.lightAmp * ly) / (c.tileH - 1)))
          : meanRounded(c.tileW * c.tileH, (i) => ((((i % c.tileW) >> 5) + (Math.floor(i / c.tileW) >> 5)) & 1) === 0 ? c.lightAmp : 0);
      return { lightMode: "uniform", lightBase: c.lightBase + mean, lightAmp: 0 };
    },
  },
  {
    id: "fixed-env",
    label: "Fixed environment",
    removes: "seasonal change",
    // Removes the fluctuation but keeps the cycle-mean seasonal light (same
    // integer formula as the light function, rounded to the nearest integer).
    apply: (c) => {
      if (c.seasonPeriod === 0) throw new Error("fixed-env control needs a preset with seasons");
      const mean = meanRounded(c.seasonPeriod, (t) => (c.seasonAmp * Math.abs(Math.floor((t * 512) / c.seasonPeriod) - 256)) >> 8);
      return { lightBase: c.lightBase + mean, seasonPeriod: 0, seasonAmp: 0 };
    },
  },
  {
    id: "replenished",
    label: "Matter replenished",
    removes: "closure pressure (waste recycled abiotically at a high rate)",
    apply: () => ({ kAbio: 40_000 }),
  },
  {
    id: "no-signal-motility",
    label: "No adhesion/signal/motility",
    // The plan's "no adhesion/signal actuators (blocks transitions)" control;
    // motility is included too since without it neither adhesion nor signal
    // can produce coordinated multicellular behaviour on their own.
    removes: "adhesion (when present), signal emission and active motility (blocks coordination and major transitions)",
    // Only overrides `adhesion` when the input config actually set it: adding
    // the key to a config that never had it would change that config's
    // canonical-JSON digest (see WorldConfig.adhesion), corrupting the
    // checkpoint/replay continuity of every existing no-signal-motility run
    // that predates the adhesion actuator.
    // Note: specConfig (packages/runner/src/runner.ts) applies spec.overrides
    // after this condition, so an explicit `{ adhesion: true }` run override
    // re-enables it even under this control -- overrides always win.
    apply: (c) => ({ kEmit: 0, motility: false, ...(c.adhesion !== undefined ? { adhesion: false } : {}) }),
  },
  {
    id: "no-migration",
    label: "No migration",
    removes: "gene flow between islands (tile migration and/or a metapopulation's cross-run exchange)",
    // Only strips tile-migration fields when this preset actually has them
    // (never throws): a run's cross-run exchange, if any, is a property of
    // the *experiment* (RunSpec.metapopulation), which this function never
    // sees -- it is given only the WorldConfig. Whether the control is
    // *meaningful* at all (tile migration configured, or a metapopulation
    // present) is checked once, with both pieces of context available, in
    // specConfig (runner.ts) -- not here.
    apply: (c) => (c.migrationPeriod ? { migrationPeriod: 0, migrantCount: 0 } : {}),
  },
  {
    id: "pond-rand",
    label: "Random pond donors",
    removes: "selection among ponds (donors drawn at random from the surviving ponds)",
    // Protocol v1's rand arm (docs/scaffold-protocol-v1.md): the same cycle, with donors drawn at random.
    apply: (c) => {
      if (c.pondPeriod === undefined) throw new Error("pond-rand control needs a preset with the pond cycle");
      return { pondArm: "rand" };
    },
  },
  {
    id: "pond-cont",
    label: "No pond cycle",
    removes: "the pond cycle (each boundary is only measured, one row per pond)",
    // Protocol v1's cont arm: no transform, so the physics is that of the same config without pond keys.
    apply: (c) => {
      if (c.pondPeriod === undefined) throw new Error("pond-cont control needs a preset with the pond cycle");
      return { pondArm: "cont" };
    },
  },
];

export function conditionById(id: string): Condition {
  const c = CONDITIONS.find((k) => k.id === id);
  if (!c) throw new Error(`unknown condition ${id}; known: ${CONDITIONS.map((k) => k.id).join(", ")}`);
  return c;
}
