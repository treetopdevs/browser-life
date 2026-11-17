import { census } from "@bl/metrics";
import savedStage0Audit from "../../docs/recovery-severity-2026-10-24/STAGE0-AUDIT.json" with {
  type: "json",
};
import engineeringAudit from "../../docs/recovery-severity-2026-10-24/audit.json" with {
  type: "json",
};
import { canonicalObserverJSON, cloneState, decodeCheckpoint, stateHash, worldW } from "@bl/schema";
import { applyLesion, RefSim } from "@bl/sim-ref";
import { OBSERVER_VERSION } from "../recovery-accessibility/observer.ts";
import {
  type CaseResult,
  genomeHex,
  subjects,
  validateCase,
} from "../recovery-accessibility/protocol.ts";
import { validateTrack } from "./continuity.ts";
import { assertConserved, stateIdentity, targetLabel } from "./parity.ts";
import {
  type BranchDiagnostic,
  type BranchFacts,
  type Difference,
  injuryFacts,
  type Trace,
} from "./branch-diagnostic.ts";

export interface FilePin {
  path: string;
  bytes: number;
  sha256: string;
}
export interface SourcePin extends FilePin {
  sourcePath: string;
}
export interface BranchRecord {
  version: "recovery-severity-branch-record-v1";
  mode: "engineering-execution" | "saved-trace-reanalysis";
  diagnostic: BranchDiagnostic;
  evidence:
    & Record<
      | "manifest"
      | "inputs"
      | "sourceCase"
      | "selection"
      | "grown"
      | "post"
      | "final"
      | "cpu25"
      | "gpu25"
      | "gpu50",
      FilePin
    >
    & { sources: SourcePin[] };
}
export const stable = canonicalObserverJSON;
export const sha256 = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
export const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
export const objectDigest = async (value: unknown) =>
  sha256(new TextEncoder().encode(stable(value)));
export const pinBytes = async (
  path: string,
  bytes: Uint8Array,
): Promise<FilePin> => ({
  path,
  bytes: bytes.length,
  sha256: await sha256(bytes),
});
export function validPath(path: string): boolean {
  return typeof path === "string" && !path.includes("\\") &&
    !path.startsWith("/") &&
    path.split("/").every((p) => !!p && p !== "." && p !== "..");
}

/** Independent reduction: no call to diagnoseBranch, compareTraces, or returnTime. */
export function deriveDiagnostic(
  facts: BranchFacts,
  cpu: Trace,
  fast: Trace,
  slow: Trace,
): BranchDiagnostic {
  const traces = [cpu, fast, slow];
  for (const [index, t] of traces.entries()) {
    const cadence = index === 2 ? 50 : 25;
    if (t.cadence !== cadence || t.rows.length !== 2000 / cadence + 1) {
      throw new Error("reader: incomplete/wrong grid");
    }
    validateTrack(t.track, facts.referenceMass, cadence, facts.startStep);
    if (
      !Number.isSafeInteger(t.initialMass) || t.initialMass < 0 ||
      t.rows[0].mass !== t.initialMass ||
      t.rows[0].label !== t.track.initialLabel ||
      (t.track.initialLabel === null
        ? t.initialMass !== 0
        : !Number.isInteger(t.track.initialLabel) || t.track.initialLabel < 0 ||
          t.initialMass < 128)
    ) throw new Error("reader: invalid initialization");
    t.rows.forEach((r, i) => {
      if (
        r.offset !== i * cadence || typeof r.identity !== "string" ||
        !r.identity
      ) throw new Error("reader: wrong observation");
      if (
        i &&
        (r.label !== t.track.history[i - 1].label ||
          r.mass !== t.track.history[i - 1].mass ||
          facts.startStep + r.offset !== t.track.history[i - 1].step)
      ) throw new Error("reader: row/history disagreement");
    });
  }
  const sameCadenceOffsets = fast.rows.filter((r, i) =>
    r.identity !== cpu.rows[i].identity
  ).map((r) => r.offset);
  const sharedCadenceOffsets = slow.rows.filter((r, i) =>
    r.identity !== fast.rows[i * 2].identity
  ).map((r) => r.offset);
  const observerOK = stable(cpu.track) === stable(fast.track) &&
    cpu.rows.every((r, i) =>
      r.label === fast.rows[i].label && r.mass === fast.rows[i].mass
    );
  const disagreements: Difference[] = [];
  slow.rows.forEach((s, i) => {
    const f = fast.rows[i * 2];
    if (f.label !== s.label || f.mass !== s.mass) {
      disagreements.push({
        offset: s.offset,
        fast: { label: f.label, mass: f.mass },
        slow: { label: s.label, mass: s.mass },
      });
    }
  });
  const technical = sameCadenceOffsets.length > 0 ||
    sharedCadenceOffsets.length > 0 || !observerOK ||
    disagreements.some((d) => d.fast.label === d.slow.label);
  const badContinuity = fast.track.initialLabel === null ||
    slow.track.initialLabel === null || fast.track.lost || slow.track.lost ||
    fast.track.merged || slow.track.merged;
  let T: number | null = technical ? null : 2025;
  if (!technical && !badContinuity && !disagreements.length) {
    // Scan backwards: every later 25-step mass must meet the original reference.
    let suffixOK = true;
    for (let i = fast.rows.length - 1; i >= 0; i--) {
      suffixOK = suffixOK && 10 * fast.rows[i].mass >= 9 * facts.referenceMass;
      if (suffixOK && fast.rows[i].offset <= 1800) T = fast.rows[i].offset;
    }
  }
  const summarize = (t: Trace) => {
    const at = (key: "split" | "merged" | "lost") => {
      const r = t.track.history.find((h) => h[key]);
      return r ? r.step - facts.startStep : null;
    };
    return {
      initialLabel: t.track.initialLabel,
      initialMass: t.initialMass,
      splitAt: at("split"),
      mergedAt: at("merged"),
      lostAt: t.track.initialLabel === null ? 0 : at("lost"),
      merged: t.track.merged,
      lost: t.track.lost,
    };
  };
  const injury = facts.injury;
  if (
    !Number.isSafeInteger(facts.referenceMass) || facts.referenceMass <= 0 ||
    !Number.isSafeInteger(facts.startStep) || facts.startStep < 0 ||
    ![injury.destroyedTargetMass, injury.originalCellsInRemnant].every((v) =>
      Number.isSafeInteger(v) && v >= 0
    ) || injury.destroyedTargetMass > facts.referenceMass ||
    injury.lesionApplied === (facts.arm === "sham")
  ) throw new Error("reader: invalid branch facts");
  const clean = !disagreements.length && !badContinuity &&
    fast.track.recovered && slow.track.recovered && injury.lesionApplied &&
    injury.originalCellsInRemnant > 0 &&
    5 * fast.initialMass <= 4 * facts.referenceMass &&
    5 * injury.destroyedTargetMass >= facts.referenceMass &&
    2 * injury.destroyedTargetMass <= facts.referenceMass;
  return {
    version: "recovery-severity-stage0-v4",
    observerVersion: OBSERVER_VERSION,
    facts,
    grids: { cpu25: 25, gpu25: 25, gpu50: 50, horizon: 2000 },
    physicalParity: {
      ok: !sameCadenceOffsets.length && !sharedCadenceOffsets.length,
      sameCadenceOffsets,
      sharedCadenceOffsets,
    },
    sameCadenceObserverParity: { ok: observerOK },
    cadenceConcordance: {
      ok: !disagreements.length,
      firstDisagreement: disagreements[0]?.offset ?? null,
      disagreements,
    },
    continuity: { fast: summarize(fast), slow: summarize(slow) },
    endpoint: {
      status: technical
        ? "TECHNICAL-FAILURE"
        : disagreements.length
        ? "CADENCE-DISAGREEMENT"
        : badContinuity
        ? "CONTINUITY-FAILURE"
        : T === 2025
        ? "NO-RETURN"
        : "RETURN",
      T,
      cleanRecovery: technical || facts.arm === "sham" ? null : clean,
      shamSuccess: technical || facts.arm !== "sham"
        ? null
        : !disagreements.length && fast.track.recovered && slow.track.recovered,
    },
    stage0: technical || disagreements.length ? "TECHNICAL-STOP" : "PASS",
  };
}

/** Authenticate a branch record and derive its verdict from saved evidence. Failed attempts are readable, never successful. */
export async function verifyBranchRecord(
  record: BranchRecord,
  load: (path: string) => Promise<Uint8Array>,
): Promise<BranchDiagnostic> {
  if (
    record.version !== "recovery-severity-branch-record-v1" ||
    !["engineering-execution", "saved-trace-reanalysis"].includes(record.mode)
  ) throw new Error("reader: unsupported branch record");
  const match = /^(202610240[12])-(parent|mutant)-(legacy|mass-targeted|sham)$/
    .exec(record.diagnostic.facts.id);
  if (!match) throw new Error("reader: wrong engineering branch");
  const seed = Number(match[1]),
    subject = match[2] as "parent" | "mutant",
    arm = match[3] as BranchFacts["arm"];
  const expectedPaths: Record<
    keyof Omit<BranchRecord["evidence"], "sources">,
    string
  > = {
    manifest: "manifest.json",
    inputs: "inputs.json",
    sourceCase: `${seed}-${subject}-case.json`,
    selection: `pair-${seed}-selection.json`,
    grown: `${seed}-${subject}-grown.blck`,
    post: `${record.diagnostic.facts.id}-post.blck`,
    final: `${record.diagnostic.facts.id}-final.blck`,
    cpu25: `${record.diagnostic.facts.id}-cpu25.json`,
    gpu25: `${record.diagnostic.facts.id}-gpu25.json`,
    gpu50: `${record.diagnostic.facts.id}-gpu50.json`,
  };
  for (const [key, path] of Object.entries(expectedPaths)) {
    if (record.evidence[key as keyof typeof expectedPaths].path !== path) {
      throw new Error("reader: incorrect evidence role/path");
    }
  }
  const pins = Object.entries(record.evidence).filter(([key]) =>
    key !== "sources"
  ).map(([, pin]) => pin as FilePin).concat(record.evidence.sources);
  const bytes = new Map<string, Uint8Array>();
  for (const pin of pins) {
    if (
      !validPath(pin.path) || !Number.isSafeInteger(pin.bytes) ||
      pin.bytes < 0 || !/^[a-f0-9]{64}$/.test(pin.sha256)
    ) throw new Error("reader: invalid file pin");
    if (!bytes.has(pin.path)) bytes.set(pin.path, await load(pin.path));
    const b = bytes.get(pin.path)!;
    if (b.length !== pin.bytes || await sha256(b) !== pin.sha256) {
      throw new Error(`reader: artifact mismatch: ${pin.path}`);
    }
  }
  const parse = <T>(pin: FilePin): T =>
    JSON.parse(new TextDecoder().decode(bytes.get(pin.path)!));
  const manifest = parse<
    {
      protocol: string;
      observerVersion: string;
      stage: string;
      sourceManifest: string;
      sources: { path: string; sha256: string }[];
      origin?: { manifest: FilePin; audit: FilePin };
    }
  >(record.evidence.manifest);
  const expectedManifest =
    "8c68136f8e68f551a8ec5f34a93349c729ef0268ad7e2182c6fd2431877dc1f7";
  if (
    manifest.protocol !== "recovery-severity-stage0-v4" ||
    manifest.observerVersion !== OBSERVER_VERSION ||
    manifest.sourceManifest !== expectedManifest ||
    manifest.stage !==
      (record.mode === "engineering-execution"
        ? "engineering-only"
        : "saved-evidence-only")
  ) throw new Error("reader: provenance/version mismatch");
  if (record.mode === "saved-trace-reanalysis") {
    if (!manifest.origin) throw new Error("reader: missing reanalysis origin");
    const originBytes = async (pin: FilePin) => {
      if (!validPath(pin.path)) throw new Error("reader: invalid origin path");
      const b = await load(pin.path);
      if (b.length !== pin.bytes || await sha256(b) !== pin.sha256) {
        throw new Error("reader: origin artifact mismatch");
      }
      return JSON.parse(new TextDecoder().decode(b));
    };
    const origin = await originBytes(manifest.origin.manifest),
      audit = await originBytes(manifest.origin.audit);
    if (stable(audit) !== stable(savedStage0Audit)) {
      throw new Error("reader: untrusted origin audit");
    }
    if (
      origin.protocol !== "recovery-severity-stage0-v2" ||
      origin.sourceManifest !== expectedManifest
    ) throw new Error("reader: wrong origin execution");
    const originPins: [string, FilePin][] = [[
      "manifest.json",
      manifest.origin.manifest,
    ]];
    for (
      const key of [
        "inputs",
        "grown",
        "post",
        "final",
        "cpu25",
        "gpu25",
        "gpu50",
      ] as const
    ) originPins.push([record.evidence[key].path, record.evidence[key]]);
    for (const [oldPath, pin] of originPins) {
      const originalPin = audit.artifacts.find((a: FilePin) =>
        a.path === oldPath
      );
      if (
        !originalPin || originalPin.sha256 !== pin.sha256 ||
        originalPin.bytes !== pin.bytes
      ) throw new Error("reader: trace outside saved origin inventory");
    }
    const selected = JSON.parse(
      new TextDecoder().decode(bytes.get(record.evidence.selection.path)!),
    );
    if (
      stable(selected) !==
        stable(
          audit.selections.find((s: { seed: number }) =>
            s.seed === selected.seed
          ),
        )
    ) throw new Error("reader: changed saved prescription");
  }
  const requiredSources = [
    "stage0.ts",
    "parity.ts",
    "continuity.ts",
    "branch-diagnostic.ts",
    "branch-record.ts",
    "observer.ts",
  ];
  for (const name of requiredSources) {
    if (
      !record.evidence.sources.some((s) => s.sourcePath.endsWith(`/${name}`))
    ) throw new Error(`reader: missing source snapshot ${name}`);
  }
  for (const pin of record.evidence.sources) {
    if (
      !manifest.sources.some((s) =>
        s.path === pin.sourcePath && s.sha256 === pin.sha256
      )
    ) throw new Error("reader: source snapshot mismatch");
  }
  const c = parse<CaseResult>(record.evidence.sourceCase),
    id = `science-${subject}-${seed}`;
  const inputs = parse<
    { id: string; caseSha256: string; checkpointSha256: string }[]
  >(record.evidence.inputs);
  const input = inputs.filter((e) => e.id === id);
  if (
    record.evidence.sourceCase.sha256 !==
      engineeringAudit.cases.find((row) => row.id === id)?.source_sha256
  ) throw new Error("reader: case outside frozen engineering inventory");
  if (
    input.length !== 1 || await objectDigest(c) !== input[0].caseSha256 ||
    c.artifacts.find((a) => a.path === "grown.blck")?.sha256 !==
      input[0].checkpointSha256
  ) throw new Error("reader: original case binding mismatch");
  validateCase(c, {
    manifestHash: expectedManifest,
    id,
    seed,
    subject,
    genome: genomeHex(subjects()[subject]),
  });
  if (!c.observation.target) throw new Error("reader: absent original target");
  const grown = decodeCheckpoint(bytes.get(record.evidence.grown.path)!).state,
    post = decodeCheckpoint(bytes.get(record.evidence.post.path)!).state;
  const final = decodeCheckpoint(bytes.get(record.evidence.final.path)!).state;
  if (
    grown.step !== 3000 ||
    stateHash(grown) !== c.observation.states.grown.hash ||
    post.step !== grown.step || final.step !== grown.step + 2000 ||
    stable(grown.cfg) !== stable(post.cfg) ||
    stable(grown.cfg) !== stable(final.cfg)
  ) throw new Error("reader: boundary identity mismatch");
  assertConserved(grown, post);
  assertConserved(grown, final);
  const cpu = parse<Trace>(record.evidence.cpu25),
    fast = parse<Trace>(record.evidence.gpu25),
    slow = parse<Trace>(record.evidence.gpu50);
  const overlapLabel = targetLabel(post, c.observation.target);
  const immediate = census({
    cfg: post.cfg,
    step: post.step,
    cells: post.cells,
    genomeHead: post.genome,
  }, { threshold: 48, minMass: 128 });
  const initialLabel =
    overlapLabel === undefined || immediate.components[overlapLabel].mass < 128
      ? undefined
      : overlapLabel;
  const initialMass = initialLabel === undefined
    ? 0
    : immediate.components[initialLabel].mass;
  for (const t of [cpu, fast, slow]) {
    if (t.initialMass !== initialMass) {
      throw new Error("reader: initial mass differs from checkpoint");
    }
  }
  for (const t of [cpu, fast, slow]) {
    if (
      t.rows[0].identity !== stateIdentity(post) ||
      t.rows.at(-1)!.identity !== stateIdentity(final) ||
      t.track.initialLabel !== (initialLabel ?? null)
    ) throw new Error("reader: trace/boundary mismatch");
  }
  const facts: BranchFacts = {
    id: record.diagnostic.facts.id,
    arm,
    referenceMass: c.observation.target.mass,
    startStep: grown.step,
    injury: injuryFacts(
      grown,
      post,
      c.observation.target,
      fast.track.initialLabel,
      arm !== "sham",
    ),
  };
  const selection = parse<
    {
      seed: number;
      selected: {
        parent: { damage: number; originalMass: number; center: number; radius: number };
        mutant: { damage: number; originalMass: number; center: number; radius: number };
      };
    }
  >(record.evidence.selection);
  if (selection.seed !== seed || !selection.selected) {
    throw new Error("reader: wrong pair prescription");
  }
  if (
    arm === "mass-targeted" &&
    (selection.selected[subject].damage !== facts.injury.destroyedTargetMass ||
      selection.selected[subject].originalMass !== facts.referenceMass)
  ) throw new Error("reader: injury/prescription mismatch");
  if (arm !== "sham") {
    // Bind the saved post state to the prescribed geometry: replay the CPU
    // lesion operator on the saved grown state and compare whole-state identity.
    const disc = arm === "legacy"
      ? c.observation.target.lesion
      : selection.selected[subject];
    if (
      !disc || !Number.isInteger(disc.center) || !Number.isInteger(disc.radius)
    ) throw new Error("reader: missing lesion geometry");
    const expected = cloneState(grown), w = worldW(expected.cfg);
    applyLesion(new RefSim(expected), disc.center % w, Math.floor(disc.center / w), disc.radius);
    if (stateIdentity(expected) !== stateIdentity(post)) {
      throw new Error("reader: saved intervention differs from prescribed lesion geometry");
    }
  }
  if (arm === "sham" && stateIdentity(grown) !== stateIdentity(post)) {
    throw new Error("reader: sham changed state");
  }
  const derived = deriveDiagnostic(facts, cpu, fast, slow);
  if (stable(derived) !== stable(record.diagnostic)) {
    throw new Error("reader: forged/inconsistent branch diagnostic");
  }
  return derived;
}

export async function readBranchRecord(
  path: string,
  load: (path: string) => Promise<Uint8Array>,
): Promise<{ record: BranchRecord; diagnostic: BranchDiagnostic }> {
  if (!validPath(path)) throw new Error("reader: invalid branch record path");
  const record = JSON.parse(
    new TextDecoder().decode(await load(path)),
  ) as BranchRecord;
  const digest = JSON.parse(
    new TextDecoder().decode(await load(`${path}.digest.json`)),
  );
  if (digest.sha256 !== await objectDigest(record)) {
    throw new Error("reader: branch record digest mismatch");
  }
  return { record, diagnostic: await verifyBranchRecord(record, load) };
}

export async function publishBranchRecord(
  record: BranchRecord,
  path: string,
  write: (path: string, value: unknown) => Promise<void>,
  load: (path: string) => Promise<Uint8Array>,
) {
  await write(`${path}.digest.json`, { sha256: await objectDigest(record) });
  await write(path, record);
  return (await readBranchRecord(path, load)).diagnostic;
}

/** The runner calls this before replays, the next arm, or successful publication. */
export async function finishBranch(
  record: BranchRecord,
  path: string,
  write: (path: string, value: unknown) => Promise<void>,
  load: (path: string) => Promise<Uint8Array>,
) {
  const diagnostic = await publishBranchRecord(record, path, write, load);
  if (diagnostic.stage0 !== "PASS") {
    throw new Error(
      `${diagnostic.endpoint.status}: ${diagnostic.facts.id}; first shared disagreement ${diagnostic.cadenceConcordance.firstDisagreement}; saved ${path}`,
    );
  }
  return diagnostic;
}
