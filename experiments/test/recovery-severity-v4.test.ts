import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodeCheckpoint } from "@bl/schema";
import { OBSERVER_VERSION } from "../recovery-accessibility/observer.ts";
import {
  type BranchFacts,
  diagnoseBranch,
  injuryFacts,
  STAGE0_VERSION,
  type Trace,
} from "../recovery-severity/branch-diagnostic.ts";
import {
  type BranchRecord,
  deriveDiagnostic,
  finishBranch,
  jsonBytes,
  objectDigest,
  pinBytes,
  readBranchRecord,
  sha256,
  verifyBranchRecord,
} from "../recovery-severity/branch-record.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/recovery-severity-pair2.json", import.meta.url),
    "utf8",
  ),
);
const decode = <T>(b: Uint8Array): T => JSON.parse(new TextDecoder().decode(b));
async function saved() {
  const files = new Map<string, Uint8Array>();
  for (
    const [path, item] of Object.entries(fixture.files) as [
      string,
      { bytes: number; sha256: string; gzipBase64: string },
    ][]
  ) {
    const bytes = new Uint8Array(
      gunzipSync(Buffer.from(item.gzipBase64, "base64")),
    );
    expect(bytes.length).toBe(item.bytes);
    expect(await sha256(bytes)).toBe(item.sha256);
    files.set(path, bytes);
  }
  const id = fixture.id as string;
  const cpu = decode<Trace>(files.get(`${id}-cpu25.json`)!);
  const fast = decode<Trace>(files.get(`${id}-gpu25.json`)!);
  const slow = decode<Trace>(files.get(`${id}-gpu50.json`)!);
  const c = decode<
    { observation: { target: { cells: number[]; mass: number } } }
  >(files.get("2026102402-mutant-case.json")!);
  const grown =
      decodeCheckpoint(files.get("2026102402-mutant-grown.blck")!).state,
    post = decodeCheckpoint(files.get(`${id}-post.blck`)!).state;
  const facts: BranchFacts = {
    id,
    arm: "mass-targeted",
    referenceMass: c.observation.target.mass,
    startStep: grown.step,
    injury: injuryFacts(
      grown,
      post,
      c.observation.target,
      fast.track.initialLabel,
      true,
    ),
  };
  const sources = [];
  for (
    const name of [
      "stage0.ts",
      "parity.ts",
      "budget.ts",
      "continuity.ts",
      "branch-diagnostic.ts",
      "branch-record.ts",
      "observer.ts",
    ]
  ) {
    const sourcePath = name === "observer.ts"
      ? "experiments/recovery-accessibility/observer.ts"
      : `experiments/recovery-severity/${name}`;
    const bytes = new Uint8Array(
      readFileSync(new URL(`../../${sourcePath}`, import.meta.url)),
    );
    const path = `execution-source/${name}`;
    files.set(path, bytes);
    sources.push({ ...await pinBytes(path, bytes), sourcePath });
  }
  files.set(
    "manifest.json",
    jsonBytes({
      protocol: STAGE0_VERSION,
      observerVersion: OBSERVER_VERSION,
      stage: "saved-evidence-only",
      sourceManifest:
        "8c68136f8e68f551a8ec5f34a93349c729ef0268ad7e2182c6fd2431877dc1f7",
      origin: {
        manifest: await pinBytes(
          "origin-manifest.json",
          files.get("origin-manifest.json")!,
        ),
        audit: await pinBytes(
          "origin-audit.json",
          files.get("origin-audit.json")!,
        ),
      },
      sources: sources.map((s) => ({ path: s.sourcePath, sha256: s.sha256 })),
    }),
  );
  files.set("pair-2026102402-selection.json", jsonBytes(fixture.selection));
  const pin = async (path: string) => pinBytes(path, files.get(path)!);
  const record: BranchRecord = {
    version: "recovery-severity-branch-record-v1",
    mode: "saved-trace-reanalysis",
    diagnostic: diagnoseBranch(facts, cpu, fast, slow),
    evidence: {
      manifest: await pin("manifest.json"),
      inputs: await pin("inputs.json"),
      sourceCase: await pin("2026102402-mutant-case.json"),
      selection: await pin("pair-2026102402-selection.json"),
      grown: await pin("2026102402-mutant-grown.blck"),
      post: await pin(`${id}-post.blck`),
      final: await pin(`${id}-final.blck`),
      cpu25: await pin(`${id}-cpu25.json`),
      gpu25: await pin(`${id}-gpu25.json`),
      gpu50: await pin(`${id}-gpu50.json`),
      sources,
    },
  };
  const load = async (path: string) => {
    const bytes = files.get(path);
    if (!bytes) throw Error(`missing ${path}`);
    return bytes;
  };
  return { files, load, record, facts, cpu, fast, slow };
}

it("preserves the real saved-trace disagreement, frozen penalty and Stage 0 stop in runtime and independent reader", async () => {
  const s = await saved(), d = s.record.diagnostic;
  expect(d.physicalParity.ok).toBe(true);
  expect(d.sameCadenceObserverParity.ok).toBe(true);
  expect(d.cadenceConcordance.firstDisagreement).toBe(100);
  expect(d.cadenceConcordance.disagreements.map((r) => r.offset)).toEqual([
    100,
    150,
    200,
    250,
    300,
    350,
  ]);
  expect(d.endpoint).toEqual({
    status: "CADENCE-DISAGREEMENT",
    T: 2025,
    cleanRecovery: false,
    shamSuccess: null,
  });
  expect(d.stage0).toBe("TECHNICAL-STOP");
  expect(d.continuity.fast).toMatchObject({
    splitAt: 150,
    mergedAt: 250,
    lostAt: 400,
  });
  expect(d.continuity.slow.lostAt).toBe(100);
  expect(deriveDiagnostic(s.facts, s.cpu, s.fast, s.slow)).toEqual(d);
  expect(await verifyBranchRecord(s.record, s.load)).toEqual(d);
});
it("publishes authenticated evidence before stopping, without proceeding to another arm/replay", async () => {
  const s = await saved();
  let proceeded = false;
  const path = "branch-diagnostic.json";
  const run = async () => {
    await finishBranch(s.record, path, async (p, value) => {
      s.files.set(p, jsonBytes(value));
    }, s.load);
    proceeded = true;
  };
  await expect(run()).rejects.toThrow(/CADENCE-DISAGREEMENT/);
  expect(proceeded).toBe(false);
  expect(s.files.has(path)).toBe(true);
  expect(s.files.has(`${path}.digest.json`)).toBe(true);
  expect((await readBranchRecord(path, s.load)).diagnostic.stage0).toBe(
    "TECHNICAL-STOP",
  );
});
it("rejects forged verdicts even after recomputing their outer checksum", async () => {
  const s = await saved(), path = "forged.json";
  s.record.diagnostic.stage0 = "PASS";
  s.record.diagnostic.endpoint.T = 0;
  s.record.diagnostic.endpoint.cleanRecovery = true;
  s.files.set(path, jsonBytes(s.record));
  s.files.set(
    `${path}.digest.json`,
    jsonBytes({ sha256: await objectDigest(s.record) }),
  );
  await expect(readBranchRecord(path, s.load)).rejects.toThrow(
    /forged\/inconsistent/,
  );
});
it("rejects damaged evidence, missing provenance, changed versions and altered original case bindings", async () => {
  const s = await saved();
  s.files.set(s.record.evidence.inputs.path, jsonBytes([]));
  await expect(verifyBranchRecord(s.record, s.load)).rejects.toThrow(
    /artifact mismatch/,
  );
  const a = await saved();
  a.record.evidence.sources = [];
  await expect(verifyBranchRecord(a.record, a.load)).rejects.toThrow(
    /source snapshot/,
  );
  const b = await saved();
  const m = decode<Record<string, unknown>>(b.files.get("manifest.json")!);
  m.protocol = "recovery-severity-stage0-v3";
  b.files.set("manifest.json", jsonBytes(m));
  b.record.evidence.manifest = await pinBytes(
    "manifest.json",
    b.files.get("manifest.json")!,
  );
  await expect(verifyBranchRecord(b.record, b.load)).rejects.toThrow(
    /provenance\/version/,
  );
  const c = await saved();
  const original = decode<Record<string, unknown>>(
    c.files.get(c.record.evidence.sourceCase.path)!,
  );
  original.seed = 1;
  c.files.set(c.record.evidence.sourceCase.path, jsonBytes(original));
  c.record.evidence.sourceCase = await pinBytes(
    c.record.evidence.sourceCase.path,
    c.files.get(c.record.evidence.sourceCase.path)!,
  );
  await expect(verifyBranchRecord(c.record, c.load)).rejects.toThrow(
    /frozen engineering inventory/,
  );
});

function synthetic(cadence: 25 | 50): Trace {
  const history = Array.from(
    { length: 2000 / cadence },
    (_, i) => ({
      step: (i + 1) * cadence,
      mass: 900,
      label: 0 as number | null,
      edges: [{ from: 0, to: 0, cells: 2 }],
      split: false,
      merged: false,
      lost: false,
    }),
  );
  return {
    cadence,
    initialMass: 600,
    rows: [
      { offset: 0, identity: "state-0", label: 0, mass: 600 },
      ...history.map((h) => ({
        offset: h.step,
        identity: `state-${h.step}`,
        label: h.label,
        mass: h.mass,
      })),
    ],
    track: {
      initialLabel: 0,
      recovered: true,
      retained: true,
      merged: false,
      lost: false,
      mass: 900,
      history,
    },
  };
}
const syntheticFacts: BranchFacts = {
  id: "2026102401-parent-mass-targeted",
  arm: "mass-targeted",
  referenceMass: 1000,
  startStep: 0,
  injury: {
    lesionApplied: true,
    destroyedTargetMass: 400,
    originalCellsInRemnant: 6,
  },
};
function both(
  facts: BranchFacts,
  fast: Trace,
  slow: Trace,
  cpu = structuredClone(fast),
) {
  const runtime = diagnoseBranch(facts, cpu, fast, slow);
  expect(deriveDiagnostic(facts, cpu, fast, slow)).toEqual(runtime);
  return runtime;
}
it("preserves clean complete agreement and observed return time on the original grid", () => {
  const d = both(syntheticFacts, synthetic(25), synthetic(50));
  expect(d.stage0).toBe("PASS");
  expect(d.endpoint).toMatchObject({
    T: 25,
    cleanRecovery: true,
    status: "RETURN",
  });
});
it("rejects separately recovering split daughters and transient disagreement despite final agreement", () => {
  const fast = synthetic(25), slow = synthetic(50);
  for (const t of [fast, slow]) {
    t.track.history[0].edges = [{
      from: 0,
      to: 0,
      cells: t.cadence === 25 ? 8 : 4,
    }, { from: 0, to: 1, cells: t.cadence === 25 ? 4 : 8 }];
    t.track.history[0].split = true;
    if (t.cadence === 50) {
      t.track.history.forEach((h, i) => {
        h.label = 1;
        t.rows[i + 1].label = 1;
        if (i) h.edges = [{ from: 1, to: 1, cells: 8 }];
      });
    }
  }
  expect(both(syntheticFacts, fast, slow).endpoint).toMatchObject({
    T: 2025,
    cleanRecovery: false,
    status: "CADENCE-DISAGREEMENT",
  });
  const a = synthetic(25), b = synthetic(50);
  b.track.history[0].label = 1;
  b.track.history[0].edges = [{ from: 0, to: 1, cells: 2 }];
  b.rows[1].label = 1;
  b.track.history[1].edges = [{ from: 1, to: 0, cells: 2 }];
  const d = both(syntheticFacts, a, b);
  expect(d.cadenceConcordance.disagreements.map((r) => r.offset)).toEqual([50]);
  expect(d.stage0).toBe("TECHNICAL-STOP");
});
it("never rescues matched null labels, and keeps one-grid loss a cadence disagreement", () => {
  const lost = (cadence: 25 | 50) => {
    const t = synthetic(cadence);
    t.track.lost = true;
    t.track.retained = false;
    t.track.recovered = false;
    t.track.mass = 0;
    t.track.history.forEach((h, i) => {
      h.label = null;
      h.mass = 0;
      h.edges = [];
      h.lost = true;
      t.rows[i + 1].label = null;
      t.rows[i + 1].mass = 0;
    });
    return t;
  };
  expect(both(syntheticFacts, lost(25), lost(50)).endpoint).toMatchObject({
    T: 2025,
    cleanRecovery: false,
    status: "CONTINUITY-FAILURE",
  });
  expect(both(syntheticFacts, synthetic(25), lost(50)).stage0).toBe(
    "TECHNICAL-STOP",
  );
});
it("keeps physical and same-cadence observer failures separate from biological penalties", () => {
  const fast = synthetic(25), slow = synthetic(50);
  slow.rows[1].identity = "different physical state";
  const d = both(syntheticFacts, fast, slow);
  expect(d.physicalParity.ok).toBe(false);
  expect(d.endpoint.T).toBeNull();
  expect(d.stage0).toBe("TECHNICAL-STOP");
  const cpu = synthetic(25);
  cpu.track.history[0].edges[0].cells++;
  const e = both(syntheticFacts, synthetic(25), synthetic(50), cpu);
  expect(e.sameCadenceObserverParity.ok).toBe(false);
  expect(e.endpoint.T).toBeNull();
});
it("treats missing, duplicate, reordered or contradictory evidence as technical errors, never T=2025", () => {
  for (
    const mutate of [
      (t: Trace) => {
        t.rows.pop();
      },
      (t: Trace) => {
        t.rows[2] = structuredClone(t.rows[1]);
      },
      (t: Trace) => {
        [t.rows[1], t.rows[2]] = [t.rows[2], t.rows[1]];
      },
      (t: Trace) => {
        t.track.history[0].merged = true;
      },
      (t: Trace) => {
        t.track.history[0].split = true;
      },
      (t: Trace) => {
        t.rows[1].mass++;
      },
    ]
  ) {
    const fast = synthetic(25), slow = synthetic(50);
    mutate(slow);
    expect(() => diagnoseBranch(syntheticFacts, fast, fast, slow)).toThrow();
    expect(() => deriveDiagnostic(syntheticFacts, fast, fast, slow)).toThrow();
  }
});

it("blocks progress on partial publication and on a self-consistent but forged saved verdict", async () => {
  const s = await saved(), path = "partial.json";
  await expect(finishBranch(s.record, path, async (p, value) => {
    if (p === path) throw Error("publication failed");
    s.files.set(p, jsonBytes(value));
  }, s.load)).rejects.toThrow(/publication failed/);
  expect(s.files.has(path)).toBe(false);
  await expect(readBranchRecord(path, s.load)).rejects.toThrow(/missing/);
  const forged = await saved();
  forged.record.diagnostic.stage0 = "PASS";
  await expect(
    finishBranch(forged.record, "forged-runtime.json", async (p, v) => {
      forged.files.set(p, jsonBytes(v));
    }, forged.load),
  ).rejects.toThrow(/forged\/inconsistent/);
});
it("does not turn a same-label mass inconsistency into a biological cadence penalty", () => {
  const fast = synthetic(25), slow = synthetic(50);
  slow.rows[1].mass++;
  slow.track.history[0].mass++;
  const d = both(syntheticFacts, fast, slow);
  expect(d.physicalParity.ok).toBe(true);
  expect(d.endpoint).toMatchObject({
    status: "TECHNICAL-FAILURE",
    T: null,
    cleanRecovery: null,
  });
  expect(d.stage0).toBe("TECHNICAL-STOP");
});

import {
  verifyBudgetDebit,
  verifyFirstPairReplays,
} from "../recovery-severity/attempt-gates.ts";
it("rejects an altered saved-origin audit even after repinning the copied audit and manifest", async () => {
  const s = await saved(),
    audit = decode<{ artifacts: { sha256: string }[] }>(
      s.files.get("origin-audit.json")!,
    );
  audit.artifacts[0].sha256 = "0".repeat(64);
  s.files.set("origin-audit.json", jsonBytes(audit));
  const manifest = decode<
    { origin: { audit: Awaited<ReturnType<typeof pinBytes>> } }
  >(s.files.get("manifest.json")!);
  manifest.origin.audit = await pinBytes(
    "origin-audit.json",
    s.files.get("origin-audit.json")!,
  );
  s.files.set("manifest.json", jsonBytes(manifest));
  s.record.evidence.manifest = await pinBytes(
    "manifest.json",
    s.files.get("manifest.json")!,
  );
  await expect(verifyBranchRecord(s.record, s.load)).rejects.toThrow(
    /untrusted origin audit/,
  );
});
it("rejects ineligible retained masses and nonzero mass on a null label in both reductions", () => {
  const fast = synthetic(25), slow = synthetic(50);
  fast.track.history[0].mass = 127;
  fast.rows[1].mass = 127;
  expect(() => diagnoseBranch(syntheticFacts, fast, fast, slow)).toThrow(
    /ineligible/,
  );
  expect(() => deriveDiagnostic(syntheticFacts, fast, fast, slow)).toThrow(
    /ineligible/,
  );
  const lost = synthetic(50);
  lost.track.lost = true;
  lost.track.recovered = false;
  lost.track.retained = false;
  lost.track.mass = 0;
  for (let i = 0; i < lost.track.history.length; i++) {
    const h = lost.track.history[i];
    h.label = null;
    h.mass = 0;
    h.edges = [];
    h.lost = true;
    lost.rows[i + 1].label = null;
    lost.rows[i + 1].mass = 0;
  }
  lost.track.history[0].mass = 1;
  lost.rows[1].mass = 1;
  expect(() =>
    diagnoseBranch(syntheticFacts, synthetic(25), synthetic(25), lost)
  ).toThrow(/ineligible/);
  expect(() =>
    deriveDiagnostic(syntheticFacts, synthetic(25), synthetic(25), lost)
  ).toThrow(/ineligible/);
});
it("requires first-pair replay inventory and exact replay equality independently of branch parity", async () => {
  const files = new Map<string, Uint8Array>(), rows = [];
  for (const subject of ["parent", "mutant"]) {
    for (const arm of ["legacy", "mass-targeted", "sham"]) {
      const id = `2026102401-${subject}-${arm}`,
        gpu25 = `${id}-gpu25.json`,
        gpu50 = `${id}-gpu50.json`;
      rows.push({ id, gpu25, gpu50 });
      for (const cadence of [25, 50] as const) {
        const b = jsonBytes(synthetic(cadence));
        files.set(`${id}-gpu${cadence}.json`, b);
        files.set(`${id}-replay${cadence}.json`, b);
      }
    }
  }
  const pins = await Promise.all([...files].map(([p, b]) => pinBytes(p, b))),
    load = async (p: string) => {
      const b = files.get(p);
      if (!b) throw Error("missing");
      return b;
    };
  await verifyFirstPairReplays(rows, pins, load);
  await expect(
    verifyFirstPairReplays(
      rows,
      pins.filter((p) => p.path !== "2026102401-mutant-sham-replay50.json"),
      load,
    ),
  ).rejects.toThrow(/missing replay inventory/);
  await expect(verifyFirstPairReplays(rows.slice(1), pins, load)).rejects
    .toThrow(/incomplete/);
  files.set(
    "2026102401-parent-legacy-replay25.json",
    jsonBytes({ forged: true }),
  );
  await expect(verifyFirstPairReplays(rows, pins, load)).rejects.toThrow(
    /replay mismatch/,
  );
});
it("requires a settled debit for elapsed time and every final byte without resetting the aggregate cap", () => {
  const cap = { maxMs: 1200000, maxBytes: 536870912 },
    prior = { ...cap, spentMs: 100, spentBytes: 500 },
    budget = { ...cap, spentMs: 400, spentBytes: 1800 };
  const result = { elapsedMs: 190, writtenBytes: 1000 },
    debit = { elapsedMs: 200, bytes: 1040 };
  expect(() => verifyBudgetDebit(prior, budget, result, debit, 40)).not
    .toThrow();
  for (
    const d of [undefined, { elapsedMs: 189, bytes: 1040 }, {
      elapsedMs: 200,
      bytes: 1000,
    }]
  ) {
    expect(() => verifyBudgetDebit(prior, budget, result, d, 40)).toThrow(
      /debited/,
    );
  }
  expect(() =>
    verifyBudgetDebit(prior, { ...budget, spentMs: 0 }, result, debit, 40)
  ).toThrow(/debited/);
  expect(() =>
    verifyBudgetDebit(
      prior,
      { ...budget, spentBytes: 536870913 },
      result,
      debit,
      40,
    )
  ).toThrow(/budget/);
});

import { resolveUniqueDebit } from "../recovery-severity/attempt-gates.ts";
it("never compares a replay artifact with itself as its purported primary trace", async () => {
  const s = await saved(),
    path = `${fixture.id}-replay25.json`,
    bytes = s.files.get(s.record.evidence.gpu25.path)!;
  s.files.set(path, bytes);
  s.record.evidence.gpu25 = await pinBytes(path, bytes);
  await expect(verifyBranchRecord(s.record, s.load)).rejects.toThrow(
    /evidence role\/path/,
  );
  const id = "2026102401-parent-legacy";
  await expect(
    verifyFirstPairReplays(
      [{ id, gpu25: `${id}-replay25.json`, gpu50: `${id}-gpu50.json` }],
      [],
      async () => jsonBytes({}),
    ),
  ).rejects.toThrow(/primary replay source/);
});
it("binds all three initial masses to the measured eligible checkpoint component", async () => {
  const s = await saved();
  s.record.mode = "engineering-execution";
  const manifest = decode<{ stage: string }>(s.files.get("manifest.json")!);
  manifest.stage = "engineering-only";
  s.files.set("manifest.json", jsonBytes(manifest));
  s.record.evidence.manifest = await pinBytes(
    "manifest.json",
    s.files.get("manifest.json")!,
  );
  for (const role of ["cpu25", "gpu25", "gpu50"] as const) {
    const trace = decode<Trace>(s.files.get(s.record.evidence[role].path)!);
    trace.initialMass++;
    trace.rows[0].mass++;
    s.files.set(s.record.evidence[role].path, jsonBytes(trace));
    s.record.evidence[role] = await pinBytes(
      s.record.evidence[role].path,
      s.files.get(s.record.evidence[role].path)!,
    );
  }
  await expect(verifyBranchRecord(s.record, s.load)).rejects.toThrow(
    /initial mass differs from checkpoint/,
  );
});
it("resolves equivalent relative/absolute debit paths once and rejects duplicate canonical outputs", async () => {
  const debit = { out: "runs/example", elapsedMs: 20, bytes: 100 },
    normalize = async (p: string) =>
      ["runs/example", "/checkout/runs/example", "/checkout/runs/example/."]
          .includes(p)
        ? "canonical-output"
        : null;
  expect(await resolveUniqueDebit([debit], "/checkout/runs/example", normalize))
    .toEqual(debit);
  expect(
    await resolveUniqueDebit([debit], "/checkout/runs/example/.", normalize),
  ).toEqual(debit);
  await expect(
    resolveUniqueDebit(
      [debit, { ...debit, out: "/checkout/runs/example" }],
      "runs/example",
      normalize,
    ),
  ).rejects.toThrow(/duplicate/);
});

it("rejects a repinned selection whose lesion geometry does not produce the saved post state", async () => {
  const s = await saved();
  s.record.mode = "engineering-execution";
  const manifest = decode<{ stage: string }>(s.files.get("manifest.json")!);
  manifest.stage = "engineering-only";
  s.files.set("manifest.json", jsonBytes(manifest));
  s.record.evidence.manifest = await pinBytes("manifest.json", s.files.get("manifest.json")!);
  const path = s.record.evidence.selection.path;
  const sel = decode<{ selected: { mutant: { center: number } } }>(s.files.get(path)!);
  sel.selected.mutant.center += 1;
  s.files.set(path, jsonBytes(sel));
  s.record.evidence.selection = await pinBytes(path, s.files.get(path)!);
  await expect(verifyBranchRecord(s.record, s.load)).rejects.toThrow(
    /prescribed lesion geometry/,
  );
});

import { validateRoleTraces } from "../recovery-severity/audit-traces.ts";
it("audit binds each retained trace's cadence to its file role, not to the trace's own field", async () => {
  const s = await saved();
  // The retained pair-2 traces still pass the stricter role check.
  expect(() =>
    validateRoleTraces([s.cpu, s.fast, s.slow], s.facts.referenceMass, s.facts.startStep)
  ).not.toThrow();
  expect(() =>
    validateRoleTraces([synthetic(25), synthetic(25), synthetic(50)], 1000, 0)
  ).not.toThrow();
  // Copies of one branch's gpu50 trace in the cpu25 and gpu25 files would
  // otherwise validate and compare equal, hiding the cadence disagreements.
  expect(() =>
    validateRoleTraces([synthetic(50), synthetic(50), synthetic(50)], 1000, 0)
  ).toThrow(/does not match role cpu25/);
  expect(() =>
    validateRoleTraces([synthetic(25), synthetic(50), synthetic(50)], 1000, 0)
  ).toThrow(/does not match role gpu25/);
  const relabelled = synthetic(50);
  (relabelled as { cadence: number }).cadence = 25;
  expect(() =>
    validateRoleTraces([synthetic(25), relabelled, synthetic(50)], 1000, 0)
  ).toThrow(/incomplete recovery observations/);
  expect(() =>
    validateRoleTraces([synthetic(25), synthetic(25), synthetic(25)], 1000, 0)
  ).toThrow(/does not match role gpu50/);
});
it("publishes and rereads a final-offset parity failure; only GPU25 must match the saved final checkpoint", async () => {
  const engineering = async (
    role: "cpu25" | "gpu25" | "gpu50",
  ) => {
    const s = await saved();
    s.record.mode = "engineering-execution";
    const manifest = decode<{ stage: string }>(s.files.get("manifest.json")!);
    manifest.stage = "engineering-only";
    s.files.set("manifest.json", jsonBytes(manifest));
    s.record.evidence.manifest = await pinBytes(
      "manifest.json",
      s.files.get("manifest.json")!,
    );
    const path = s.record.evidence[role].path,
      trace = decode<Trace>(s.files.get(path)!);
    trace.rows.at(-1)!.identity = "different final state";
    s.files.set(path, jsonBytes(trace));
    s.record.evidence[role] = await pinBytes(path, s.files.get(path)!);
    const t = (r: "cpu25" | "gpu25" | "gpu50") =>
      decode<Trace>(s.files.get(s.record.evidence[r].path)!);
    s.record.diagnostic = diagnoseBranch(
      s.facts,
      t("cpu25"),
      t("gpu25"),
      t("gpu50"),
    );
    return s;
  };
  for (
    const [role, key] of [["cpu25", "sameCadenceOffsets"], [
      "gpu50",
      "sharedCadenceOffsets",
    ]] as const
  ) {
    const s = await engineering(role), path = `${role}-diagnostic.json`;
    await expect(
      finishBranch(s.record, path, async (p, value) => {
        s.files.set(p, jsonBytes(value));
      }, s.load),
    ).rejects.toThrow(/TECHNICAL-FAILURE/);
    const reread = (await readBranchRecord(path, s.load)).diagnostic;
    expect(reread.stage0).toBe("TECHNICAL-STOP");
    expect(reread.endpoint.status).toBe("TECHNICAL-FAILURE");
    expect(reread.physicalParity[key]).toContain(2000);
  }
  // A checkpoint that differs from the trace that saved it is still rejected.
  const own = await engineering("gpu25");
  await expect(verifyBranchRecord(own.record, own.load)).rejects.toThrow(
    /trace\/boundary mismatch/,
  );
});
