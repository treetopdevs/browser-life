// Shared builders for the prediction-envelope tests: synthetic envelopes with no simulation, and a tiny protocol for the CPU fixtures.
import { defaultConfig } from "@bl/schema";
import { sealEnvelope, standardMenu, type CensusPoint, type Frame, type PredictionEnvelope, type TaskOp } from "../lib/prediction/envelope.ts";
import { draftProtocol, type Protocol } from "../lib/prediction/run.ts";

export function censusSeries(start: number, slope: number, n = 31, every = 10): CensusPoint[] {
  return Array.from({ length: n }, (_, i) => ({ step: i * every, livingCells: 100, freeNutrient: 50, mass: start + slope * i * every }));
}
export function frames(): Frame[] {
  const mass = new Array(64).fill(0);
  mass[0] = 5;
  return [{ step: 300, side: 8, mass }];
}
export function synthEnv(op: TaskOp, o: { familyId?: string; historyId?: string; caseId?: string; census?: CensusPoint[]; delta?: number; horizon?: number } = {}): PredictionEnvelope {
  const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 1 });
  return sealEnvelope({
    version: 1,
    caseId: o.caseId ?? "c-test",
    historyId: o.historyId ?? `${o.familyId ?? "fA"}:s1`,
    familyId: o.familyId ?? "fA",
    ruleVersion: 1,
    config: cfg,
    census: o.census ?? censusSeries(1000, 0),
    frames: frames(),
    menu: standardMenu(cfg, 60, 4096, 6),
    task: { subject: "world", op, delta: o.delta ?? 10, readout: "bodyMass", forkStep: 300, horizon: o.horizon ?? 200 },
  });
}
export const LESION: TaskOp = { kind: "lesion", x: 1, y: 1, r: 4 };
export const FEED: TaskOp = { kind: "feed", x: 1, y: 1, r: 4, amount: 64 };
export const DRAIN: TaskOp = { kind: "drain", x: 1, y: 1, r: 4, amount: 64 };
export const SHAM: TaskOp = { kind: "none" };

/** A tiny protocol: 6 short families, 2 mechanisms' worth of work per family, short windows. minEffect and devPrior are set. */
export function tinyProtocol(): Protocol {
  const p = draftProtocol();
  p.families = p.families.slice(0, 6);
  p.nDev = 3;
  p.nQualify = 2;
  p.window = { forkStep: 40, delta: 5, horizon: 30, censusEvery: 10, frameSteps: [20, 40] };
  p.mechanisms = p.mechanisms.filter((m) => ["feedOccupied", "lesionOccupied", "sham"].includes(m.id));
  p.proposers.numericTrend.window = 2;
  p.minEffect = 10;
  p.devPrior = { up: 200, down: 300, none: 500 };
  p.frozen = true;
  p.donors = {};
  return p;
}

import { buildOutputs, type Built } from "../lib/prediction/output.ts";
import { generate, splitPlanOf } from "../lib/prediction/run.ts";
import { donorsFor } from "../lib/prediction/splits.ts";

let cached: { p: Protocol; built: Built } | undefined;
/** A complete tiny pipeline (4 families, 3 mechanisms) built once per test file. */
export function tinyPipeline(): { p: Protocol; built: Built } {
  if (cached) return cached;
  const p = tinyProtocol();
  p.families = p.families.slice(0, 4);
  p.nDev = 2;
  p.nQualify = 1;
  p.donors = donorsFor(splitPlanOf(p), p.salt);
  const gen = generate(p, p.families.map((f) => f.id), true);
  cached = { p, built: buildOutputs(p, gen) };
  return cached;
}
