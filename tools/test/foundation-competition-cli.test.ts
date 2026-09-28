import { describe, expect, it } from "vitest";
import { parseCompetitionArgs, validateReusablePriorBatch, type CompetitionManifest } from "../foundation-competition.ts";

const inputs = ["--inputs", "/sources.json", "--out", "/new-output"];

describe("bounded competition CLI options", () => {
  it("plans without a GPU request and caps explicit execution to eight ordered runs", () => {
    expect(parseCompetitionArgs(inputs)).toMatchObject({ execute: false, maxSeconds: null, maxRuns: null,
      runOffset: 0, priorManifests: [] });
    expect(() => parseCompetitionArgs([...inputs, "--execute"])).toThrow(/requires --max-seconds/);
    expect(() => parseCompetitionArgs([...inputs, "--execute", "--max-seconds", "601", "--max-runs", "8"])).toThrow(/<=600/);
    expect(() => parseCompetitionArgs([...inputs, "--execute", "--max-seconds", "600", "--max-runs", "9"])).toThrow(/1..8/);
    expect(parseCompetitionArgs([...inputs, "--execute", "--max-seconds", "600", "--max-runs", "8"])).toMatchObject({
      execute: true, maxSeconds: 600, maxRuns: 8 });
  });

  it("requires previous batch artifacts when execution skips the first run", () => {
    expect(() => parseCompetitionArgs([...inputs, "--execute", "--max-seconds", "600", "--max-runs", "8",
      "--run-offset", "8"])).toThrow(/prior-manifests/);
    expect(parseCompetitionArgs([...inputs, "--execute", "--max-seconds", "600", "--max-runs", "8",
      "--run-offset", "8", "--prior-manifests", "/batch0/manifest.json"])).toMatchObject({
        runOffset: 8, priorManifests: ["/batch0/manifest.json"] });
    expect(() => parseCompetitionArgs([...inputs, "--run-offset", "70"])).toThrow(/0..69/);
  });

  it("rejects forged complete rows and failed or unverified prior batches", () => {
    const run = { ordinal: 0, id: "world/solo/early", kind: "solo-control", worldId: "world",
      environmentId: null, genotype: "early", earlySide: null, seed: 630010001,
      initialPhysicsHash: "a", transplantAudits: [], status: "complete",
      points: Array.from({ length: 30 }, (_, i) => ({ step: (i + 1) * 100, conservationOk: true, mutations: 0 })),
      gardenLifeTrace: { scope: "one-solo-garden-in-situ-observer-trace", status: "complete",
        lastCapturedStep: 3000, unreconciledEvents: [], window: { startStep: 100, endStep: 3000,
          censusDigests: Array.from({ length: 30 }, (_, i) => ({ step: (i + 1) * 100 })) } },
      outcome: { finalArtifactHash: "b" } } as never;
    const expected = { inputsFile: { sha256: "a", bytes: 1 }, ruleFile: { sha256: "b", bytes: 2 },
      codeFilesBefore: { file: { sha256: "c", bytes: 3 } }, sources: [], environments: [], runs: [run] };
    const prior = { ...expected, format: 1, status: "partial", postExecutionRevalidated: true,
      execution: { requested: true }, codeFilesAfter: expected.codeFilesBefore,
      runtime: { endedAt: "done", overrun: false, adapter: { vendor: "test" } }, failure: undefined } as unknown as CompetitionManifest;
    expect(() => validateReusablePriorBatch(prior, expected as never)).not.toThrow();
    expect(() => validateReusablePriorBatch({ ...prior, postExecutionRevalidated: false }, expected as never))
      .toThrow(/post-execution/);
    expect(() => validateReusablePriorBatch({ ...prior, status: "failed" }, expected as never))
      .toThrow(/post-execution/);
    expect(() => validateReusablePriorBatch({ ...prior, runtime: { ...prior.runtime!, overrun: true } }, expected as never))
      .toThrow(/post-execution/);
    expect(() => validateReusablePriorBatch({ ...prior, codeFilesAfter: {} }, expected as never))
      .toThrow(/post-execution/);
    const forged = structuredClone(prior);
    forged.runs[0].points![0].conservationOk = false;
    expect(() => validateReusablePriorBatch(forged, expected as never)).toThrow(/invalid observation/);
    const missingLife = structuredClone(prior);
    delete missingLife.runs[0].gardenLifeTrace;
    expect(() => validateReusablePriorBatch(missingLife, expected as never)).toThrow(/lacks complete in-situ lifecycle/);
  });
});
