// Frozen, local-only clone/empty-slot pilot. Planning and analysis are CPU-only;
// only run and replay create simulator devices.
import {
  FLUX_NAMES,
  RULE_VERSION,
  stateHash,
  type WorldConfig,
} from "@bl/schema";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionMasses,
  discoveryCompetitionWorld,
} from "./lib/discovery-competition.ts";
import { fromHex } from "./lib/selection-funnel-audit.ts";
import { sha256 } from "./lib/founder-policy.ts";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const PILOT_SEEDS = [6440001, 6440002, 6440003, 6440004] as const;
export const PILOT_TIMES = [0, 10_000, 20_000] as const;
const PILOT_FORMAT = "discovery-competition-pilot/v1" as const;
const RECEIPT_FORMAT = "discovery-competition-receipt/v1" as const;
const REPLAY_FORMAT = "discovery-competition-replay/v1" as const;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;

export type PilotMode = "clone" | "empty";
export interface PilotFounder {
  id: string;
  cluster: number;
  hex: string;
  subjects: string[];
}
export interface PilotMass {
  descendant: number;
  ancestor: number;
  unassociated: number;
  unexpected: number;
}
export interface PilotUnit {
  id: string;
  founderId: string;
  founderHex: string;
  mode: PilotMode;
  seed: number;
  assignment: number;
  initialStateHash: string;
  initialMass: PilotMass;
  initialFlux: string[];
}
export interface PilotSample {
  step: number;
  mass: PilotMass;
  score: number | null;
  flux: string[];
  stateHash: string;
}
export interface PilotReceipt {
  format: typeof RECEIPT_FORMAT;
  designHash: string;
  sourceManifestHash: string;
  inputHashes: Record<string, string>;
  unit: PilotUnit;
  times: number[];
  samples: PilotSample[];
  elapsedSeconds: number;
}
export interface PilotDesign {
  format: typeof PILOT_FORMAT;
  ruleVersion: number;
  sourceRoot: string;
  root: string;
  protocolPath: string;
  inputs: Record<string, string>;
  sources: Record<string, string>;
  sourceManifestHash: string;
  designHash: string;
  founders: PilotFounder[];
  seeds: number[];
  times: number[];
  configs: Record<string, WorldConfig>;
  units: PilotUnit[];
  requiredReplayUnitIds: string[];
  thresholds: {
    overallUniqueAvailability: number;
    founderUniqueAvailability: number;
    founderUniqueActivity: number;
  };
}

export interface PilotEvidence<T = unknown> {
  value?: T;
  sha256: string;
  error?: string;
}
export interface PilotReplayReport {
  format: typeof REPLAY_FORMAT;
  unitId: string;
  designHash: string;
  sourceManifestHash: string;
  receiptSha256: string;
  replaySourceSha256: string;
  pass: boolean;
  samples: PilotSample[];
  elapsedSeconds: number;
}
export interface PilotAnalysis {
  format: "discovery-competition-pilot-analysis/v1";
  designHash: string;
  status: "incomplete" | "thresholds-failed" | "pending-replays" | "eligible";
  requested: number;
  available: number;
  missing: string[];
  invalid: { id: string; error: string }[];
  unexpectedReceipts: string[];
  replayMissing: string[];
  replayInvalid: { id: string; error: string }[];
  replays: { unitId: string; sha256: string; pass: boolean }[];
  overallUniqueCloneAvailability: {
    available: number;
    requested: number;
    fraction: number;
  };
  perFounder: {
    founderId: string;
    uniqueStates: number;
    availableStates: number;
    availability: number;
    activityStates: number;
    activityFraction: number;
  }[];
  emptyControlAccountingPass: boolean;
  thresholdsPass: boolean;
  interpretation: string;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}
function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function canonicalHashMap(value: Record<string, string>): string {
  return sha256(
    JSON.stringify(Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    )),
  );
}
function safeMass(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw Error(`invalid mass ${name}`);
  }
}
function validDigest(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw Error(`invalid ${name} SHA-256`);
  }
}
function expectedScore(mass: PilotMass): number | null {
  const total = mass.descendant + mass.ancestor;
  return total === 0 ? null : (mass.descendant - mass.ancestor) / total;
}
function massTotal(mass: PilotMass): number {
  return mass.descendant + mass.ancestor + mass.unassociated;
}

export function validatePilotReceipt(
  raw: unknown,
  design: PilotDesign,
  unit: PilotUnit,
): PilotReceipt {
  const r = object(raw, `receipt ${unit.id}`);
  if (r.format !== RECEIPT_FORMAT) throw Error("receipt format mismatch");
  if (r.designHash !== design.designHash) {
    throw Error("receipt design hash mismatch");
  }
  if (r.sourceManifestHash !== design.sourceManifestHash) {
    throw Error("receipt source manifest hash mismatch");
  }
  if (!equalJson(r.inputHashes, design.inputs)) {
    throw Error("receipt input hashes mismatch");
  }
  if (!equalJson(r.unit, unit)) throw Error("receipt unit identity mismatch");
  if (!equalJson(r.times, design.times)) {
    throw Error("receipt exact-time roster mismatch");
  }
  if (!Array.isArray(r.samples) || r.samples.length !== design.times.length) {
    throw Error("receipt sample count mismatch");
  }
  if (
    typeof r.elapsedSeconds !== "number" ||
    !Number.isFinite(r.elapsedSeconds) || r.elapsedSeconds <= 0
  ) throw Error("invalid receipt elapsed time");
  let priorFlux: bigint[] | null = null;
  for (let i = 0; i < design.times.length; i++) {
    const s = object(r.samples[i], `sample ${i}`);
    if (s.step !== design.times[i]) throw Error(`sample step mismatch at ${i}`);
    if (typeof s.stateHash !== "string" || !HEX16.test(s.stateHash)) {
      throw Error(`invalid state hash at ${i}`);
    }
    const m = object(s.mass, `mass ${i}`) as unknown as PilotMass;
    for (
      const field of [
        "descendant",
        "ancestor",
        "unassociated",
        "unexpected",
      ] as const
    ) safeMass(m[field], `${i}.${field}`);
    if (m.unexpected !== 0) {
      throw Error(`unexpected-lineage mass at sample ${i}`);
    }
    if (unit.mode === "empty" && m.ancestor !== 0) {
      throw Error(`empty-slot ancestor mass at sample ${i}`);
    }
    if (s.score !== expectedScore(m)) {
      throw Error(`score mismatch at sample ${i}`);
    }
    if (!Array.isArray(s.flux) || s.flux.length !== FLUX_NAMES.length) {
      throw Error(`flux vector mismatch at sample ${i}`);
    }
    const flux = s.flux.map((v, j) => {
      if (typeof v !== "string" || !UINT.test(v)) {
        throw Error(`noncanonical unsigned flux at sample ${i}, channel ${j}`);
      }
      return BigInt(v);
    });
    if (priorFlux && flux.some((v, j) => v < priorFlux![j])) {
      throw Error(`decreasing cumulative flux at sample ${i}`);
    }
    priorFlux = flux;
  }
  const initial = r.samples[0] as PilotSample;
  if (initial.stateHash !== unit.initialStateHash) {
    throw Error("initial state hash mismatch");
  }
  if (!equalJson(initial.mass, unit.initialMass)) {
    throw Error("initial state mass mismatch");
  }
  if (!equalJson(initial.flux, unit.initialFlux)) {
    throw Error("initial state flux mismatch");
  }
  return raw as PilotReceipt;
}

function cloneGroupKey(unit: PilotUnit): string {
  return JSON.stringify([unit.founderId, unit.initialStateHash]);
}
function samePhysicalSeries(a: PilotReceipt, b: PilotReceipt): boolean {
  const sameLabels = (a.unit.assignment & 2) === (b.unit.assignment & 2);
  if (a.samples.length !== b.samples.length) return false;
  return a.samples.every((x, i) => {
    const y = b.samples[i];
    const attributionMatches = sameLabels
      ? x.mass.descendant === y.mass.descendant &&
        x.mass.ancestor === y.mass.ancestor
      : x.mass.descendant === y.mass.ancestor &&
        x.mass.ancestor === y.mass.descendant;
    return x.stateHash === y.stateHash &&
      massTotal(x.mass) === massTotal(y.mass) && attributionMatches &&
      x.mass.unassociated === y.mass.unassociated &&
      x.mass.unexpected === y.mass.unexpected &&
      equalJson(x.flux, y.flux);
  });
}
function positiveLateActivity(receipt: PilotReceipt): boolean {
  const at10k = receipt.samples[1].flux, at20k = receipt.samples[2].flux;
  const photo = FLUX_NAMES.indexOf("photo"), grow = FLUX_NAMES.indexOf("grow");
  return receipt.samples[2].mass.descendant + receipt.samples[2].mass.ancestor >
      0 &&
    BigInt(at20k[photo]) - BigInt(at10k[photo]) + BigInt(at20k[grow]) -
          BigInt(at10k[grow]) > 0n;
}

/** Pure fixed-roster analysis. Missing or invalid units remain in every denominator. */
export function analyzePilotEvidence(
  design: PilotDesign,
  receipts: Readonly<Record<string, PilotEvidence>>,
  replayEvidence: Readonly<Record<string, PilotEvidence>> = {},
): PilotAnalysis {
  const expectedIds = new Set(design.units.map((u) => u.id));
  const missing: string[] = [],
    invalid: { id: string; error: string }[] = [],
    unexpectedReceipts: string[] = [];
  const valid = new Map<string, PilotReceipt>();
  for (const [id, evidence] of Object.entries(receipts)) {
    if (!expectedIds.has(id)) unexpectedReceipts.push(id);
  }
  for (const unit of design.units) {
    const evidence = receipts[unit.id];
    if (!evidence) {
      missing.push(unit.id);
      continue;
    }
    try {
      if (evidence.error) throw Error(evidence.error);
      valid.set(unit.id, validatePilotReceipt(evidence.value, design, unit));
    } catch (e) {
      invalid.push({
        id: unit.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const duplicateProblems: { id: string; error: string }[] = [];
  const cloneGroups = new Map<string, PilotUnit[]>();
  for (const unit of design.units.filter((u) => u.mode === "clone")) {
    const k = cloneGroupKey(unit), xs = cloneGroups.get(k) ?? [];
    xs.push(unit);
    cloneGroups.set(k, xs);
  }
  for (const units of cloneGroups.values()) {
    if (units.length < 2 || units.some((u) => !valid.has(u.id))) continue;
    const receiptsInGroup = units.map((u) => valid.get(u.id)!);
    if (
      !receiptsInGroup.slice(1).every((r) =>
        samePhysicalSeries(receiptsInGroup[0], r)
      )
    ) {
      for (const unit of units) {
        valid.delete(unit.id);
        duplicateProblems.push({
          id: unit.id,
          error:
            "linked clone initial-state group has divergent state hashes, physical masses, or flux",
        });
      }
    }
  }
  invalid.push(...duplicateProblems);
  invalid.sort((a, b) => a.id.localeCompare(b.id));
  missing.sort();
  unexpectedReceipts.sort();

  const plannedCloneGroups = new Map<string, PilotUnit[]>();
  for (const unit of design.units.filter((u) => u.mode === "clone")) {
    const k = cloneGroupKey(unit), xs = plannedCloneGroups.get(k) ?? [];
    xs.push(unit);
    plannedCloneGroups.set(k, xs);
  }
  const byFounder = design.founders.map((founder) => {
    const groups = [...plannedCloneGroups.values()].filter((xs) =>
      xs[0].founderId === founder.id
    );
    let availableStates = 0, activityStates = 0;
    for (const units of groups) {
      if (
        units.every((u) => valid.has(u.id)) && (() => {
          const mass = valid.get(units[0].id)!.samples[2].mass;
          return mass.descendant + mass.ancestor > 0;
        })()
      ) {
        availableStates++;
        const representative = valid.get(units[0].id)!;
        if (positiveLateActivity(representative)) activityStates++;
      }
    }
    return {
      founderId: founder.id,
      uniqueStates: groups.length,
      availableStates,
      availability: groups.length ? availableStates / groups.length : 0,
      activityStates,
      activityFraction: groups.length ? activityStates / groups.length : 0,
    };
  });
  const cloneGroupsTotal = [...plannedCloneGroups.values()];
  const availableUnique = cloneGroupsTotal.filter((units) => {
    if (!units.every((u) => valid.has(u.id))) return false;
    const mass = valid.get(units[0].id)!.samples[2].mass;
    return mass.descendant + mass.ancestor > 0;
  }).length;
  const totalUnique = cloneGroupsTotal.length;
  const overallUniqueCloneAvailability = {
    available: availableUnique,
    requested: totalUnique,
    fraction: totalUnique ? availableUnique / totalUnique : 0,
  };
  const expectedEmpty = design.units.filter((u) => u.mode === "empty");
  const emptyControlAccountingPass = expectedEmpty.length > 0 &&
    expectedEmpty.every((u) => valid.has(u.id));
  const thresholdsPass = overallUniqueCloneAvailability.fraction >=
      design.thresholds.overallUniqueAvailability &&
    byFounder.every((f) =>
      f.availability >= design.thresholds.founderUniqueAvailability &&
      f.activityFraction >= design.thresholds.founderUniqueActivity
    ) &&
    emptyControlAccountingPass;

  const replayMissing: string[] = [],
    replayInvalid: { id: string; error: string }[] = [],
    replays: PilotAnalysis["replays"] = [];
  for (const id of design.requiredReplayUnitIds) {
    const evidence = replayEvidence[id],
      receiptEvidence = receipts[id],
      unit = design.units.find((u) => u.id === id);
    if (!evidence) {
      replayMissing.push(id);
      continue;
    }
    try {
      if (evidence.error) throw Error(evidence.error);
      if (!unit || !receiptEvidence || !valid.has(id)) {
        throw Error("replay target receipt is unavailable or invalid");
      }
      const r = object(
        evidence.value,
        `replay ${id}`,
      ) as unknown as PilotReplayReport;
      if (
        r.format !== REPLAY_FORMAT || r.unitId !== id ||
        r.designHash !== design.designHash ||
        r.sourceManifestHash !== design.sourceManifestHash
      ) throw Error("replay identity or design hash mismatch");
      if (r.receiptSha256 !== receiptEvidence.sha256) {
        throw Error("replay receipt hash mismatch");
      }
      if (
        r.replaySourceSha256 !==
          design.sources["tools/discovery_competition_pilot.ts"]
      ) throw Error("replay source hash mismatch");
      if (
        typeof r.elapsedSeconds !== "number" ||
        !Number.isFinite(r.elapsedSeconds) || r.elapsedSeconds <= 0
      ) throw Error("invalid replay elapsed time");
      if (
        !Array.isArray(r.samples) ||
        !equalJson(r.samples, valid.get(id)!.samples)
      ) throw Error("replay samples differ from frozen receipt");
      if (r.pass !== true) throw Error("replay reported failure");
      replays.push({ unitId: id, sha256: evidence.sha256, pass: true });
    } catch (e) {
      replayInvalid.push({
        id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  for (const id of Object.keys(replayEvidence)) {
    if (!design.requiredReplayUnitIds.includes(id)) {
      replayInvalid.push({ id, error: "unexpected replay report" });
    }
  }
  const available = valid.size;
  const complete = missing.length === 0 && invalid.length === 0 &&
    unexpectedReceipts.length === 0 && available === design.units.length;
  let status: PilotAnalysis["status"];
  if (!complete) status = "incomplete";
  else if (!thresholdsPass) status = "thresholds-failed";
  else if (
    replayMissing.length || replayInvalid.length ||
    replays.length !== design.requiredReplayUnitIds.length
  ) status = "pending-replays";
  else status = "eligible";
  return {
    format: "discovery-competition-pilot-analysis/v1",
    designHash: design.designHash,
    status,
    requested: design.units.length,
    available,
    missing,
    invalid,
    unexpectedReceipts,
    replayMissing,
    replayInvalid,
    replays,
    overallUniqueCloneAvailability,
    perFounder: byFounder,
    emptyControlAccountingPass,
    thresholdsPass,
    interpretation:
      "Engineering pilot only: endpoint availability, lineage accounting, same-device replay, and candidate-associated activity in this assay. Passing releases preparation and costing only; it does not establish evolutionary improvement or release evolution histories.",
  };
}

export async function verifyHashRecords(
  records: Readonly<Record<string, string>>,
  readFile: (path: string) => Promise<Uint8Array> = (path) =>
    Deno.readFile(path),
): Promise<void> {
  for (const [path, expected] of Object.entries(records)) {
    validDigest(expected, `${path} expected`);
    let actual: string;
    try {
      actual = sha256(await readFile(path));
    } catch (e) {
      throw Error(
        `frozen source unavailable: ${path}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    if (actual !== expected) throw Error(`frozen source drift: ${path}`);
  }
}

async function collectSourceHashes(
  protocolPath: string,
): Promise<Record<string, string>> {
  const paths = new Set<string>();
  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else if (entry.isFile && path.endsWith(".ts")) paths.add(path);
    }
  }
  for (
    const path of [
      "packages/schema/src",
      "packages/sim-gpu/src",
      "packages/sim-ref/src",
      "packages/runner/src",
      "packages/metrics/src",
    ]
  ) await walk(path);
  for (
    const path of [
      "deno.json",
      "tools/discovery_competition_pilot.ts",
      "tools/test/discovery-competition-pilot.test.ts",
      "tools/lib/discovery-competition.ts",
      "tools/lib/founder-policy.ts",
      "tools/lib/selection-funnel-audit.ts",
    ]
  ) paths.add(path);
  try {
    await Deno.stat("deno.lock");
    paths.add("deno.lock");
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  paths.add(protocolPath);
  const entries: [string, string][] = [];
  for (const path of [...paths].sort()) {
    entries.push([path, sha256(await Deno.readFile(path))]);
  }
  return Object.fromEntries(entries);
}

function assertDistinctStrings(values: unknown[], label: string): string[] {
  if (
    !values.length || values.some((x) => typeof x !== "string" || !x.length) ||
    new Set(values).size !== values.length
  ) throw Error(`${label} must be nonempty and unique`);
  return values as string[];
}

function compareActivityInputs(
  root: string,
  shortlist: Record<string, unknown>,
  strict: Record<string, unknown>,
  activity: Record<string, unknown>,
  design: Record<string, unknown>,
  inventoryHash: string,
  strictHash: string,
  activityHash: string,
  designHash: string,
): void {
  if (
    strict.status !== "complete" || strict.valid !== 252 ||
    strict.missing !== 0 || strict.invalid !== 0 ||
    !Array.isArray(strict.units) || strict.units.length !== 252
  ) throw Error("strict-validation-final.json is not complete");
  const strictIds = new Set<string>();
  for (const unit of strict.units) {
    const u = object(unit, "strict validation unit");
    if (
      u.status !== "valid" || typeof u.id !== "string" || strictIds.has(u.id)
    ) {
      throw Error(
        "strict validation roster has missing, invalid, or duplicate rows",
      );
    }
    validDigest(u.sha256, `strict unit ${u.id}`);
    strictIds.add(u.id);
  }
  if (
    strict.designHash !== designHash || activity.designHash !== designHash ||
    activity.strictValidationSha256 !== strictHash ||
    activity.status !== "complete"
  ) throw Error("strict validation/activity/design identity mismatch");
  const hashes = object(shortlist.inputHashes, "shortlist inputHashes");
  for (
    const [key, hash] of Object.entries({
      activity: activityHash,
      strictValidation: strictHash,
      inventory: inventoryHash,
      design: designHash,
    })
  ) {
    if (hashes[key] !== hash) {
      throw Error(`shortlist ${key} input hash mismatch`);
    }
  }
  if (shortlist.status !== "shortlisted-awaiting-fresh-assay-confirmation") {
    throw Error("shortlist is not awaiting fresh assay confirmation");
  }
}

function canonicalPayloadHash<T extends { designHash: string }>(
  value: T,
): string {
  const { designHash: _, ...payload } = value;
  return sha256(JSON.stringify(payload));
}

export async function buildPilotDesign(rootArg: string): Promise<PilotDesign> {
  const sourceRoot = await Deno.realPath(Deno.cwd());
  const root = await Deno.realPath(resolve(rootArg));
  const protocolPath = join(root, "improvement-pilot-protocol.md");
  const shortlistPath = join(root, "shortlist.json"),
    strictPath = join(root, "strict-validation-final.json");
  const activityPath = join(root, "activity-final.json"),
    inventoryPath = join(root, "initial-inventory/inventory.json");
  const capabilityDesignPath = join(root, "capability-design.json");
  const paths = [
    shortlistPath,
    strictPath,
    activityPath,
    inventoryPath,
    capabilityDesignPath,
    protocolPath,
  ];
  const bytes = await Promise.all(paths.map((path) => Deno.readFile(path)));
  const [shortlist, strict, activity, inventory, capabilityDesign] = bytes
    .slice(0, 5).map((b) => JSON.parse(new TextDecoder().decode(b))) as Record<
      string,
      unknown
    >[];
  const [shortlistB, strictB, activityB, inventoryB, designB] = bytes;
  const inputPaths = [
    shortlistPath,
    strictPath,
    activityPath,
    inventoryPath,
    capabilityDesignPath,
  ];
  const inputs = Object.fromEntries(
    inputPaths.map((p, i) => [p, sha256(bytes[i])]),
  );
  compareActivityInputs(
    root,
    shortlist,
    strict,
    activity,
    capabilityDesign,
    inputs[inventoryPath],
    inputs[strictPath],
    inputs[activityPath],
    inputs[capabilityDesignPath],
  );
  const inventoryFiles = object(inventory.files, "initial inventory files");
  for (const [rel, metaRaw] of Object.entries(inventoryFiles)) {
    const meta = object(metaRaw, `inventory file ${rel}`);
    validDigest(meta.sha256, `inventory file ${rel}`);
    if (
      sha256(await Deno.readFile(join(root, "initial-inventory", rel))) !==
        meta.sha256
    ) throw Error(`initial inventory drift: ${rel}`);
  }
  const selected = shortlist.selected;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 4) {
    throw Error("shortlist must contain one to four selected genomes");
  }
  const founders: PilotFounder[] = [],
    ids = new Set<string>(),
    clusters = new Set<number>(),
    hexes = new Set<string>();
  for (const raw of selected) {
    const entry = object(raw, "shortlisted founder");
    if (
      typeof entry.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(entry.id) ||
      ids.has(entry.id)
    ) throw Error("shortlist founder IDs must be safe and unique");
    if (
      !Number.isSafeInteger(entry.cluster) ||
      clusters.has(entry.cluster as number)
    ) throw Error("shortlist clusters must be safe and unique");
    if (
      typeof entry.hex !== "string" || !/^[0-9a-f]{336}$/.test(entry.hex) ||
      hexes.has(entry.hex)
    ) throw Error("shortlist genomes must be canonical and unique");
    fromHex(entry.hex);
    if (
      !Array.isArray(entry.subjects) || entry.subjects.length === 0 ||
      entry.subjects.some((x) => typeof x !== "string")
    ) throw Error(`invalid shortlist subjects for ${entry.id}`);
    ids.add(entry.id);
    clusters.add(entry.cluster as number);
    hexes.add(entry.hex);
    founders.push({
      id: entry.id,
      cluster: entry.cluster as number,
      hex: entry.hex,
      subjects: [...entry.subjects] as string[],
    });
  }
  if (RULE_VERSION !== capabilityDesign.ruleVersion) {
    throw Error("RULE_VERSION differs from the capability design");
  }
  const configs: Record<string, WorldConfig> = Object.fromEntries(
    PILOT_SEEDS.map((seed) => [String(seed), discoveryCompetitionConfig(seed)]),
  );
  const units: PilotUnit[] = [];
  for (const founder of founders) {
    for (const mode of ["clone", "empty"] as const) {
      for (const seed of PILOT_SEEDS) {
        for (let assignment = 0; assignment < 4; assignment++) {
          const id = `${founder.id}-${mode}-${seed}-a${assignment}`;
          const cfg = configs[String(seed)];
          const built = discoveryCompetitionWorld(
            cfg,
            founder.hex,
            mode === "clone" ? founder.hex : null,
            assignment,
          );
          const mass = discoveryCompetitionMasses(
            built.state,
            built.descendantLineage,
            built.ancestorLineage,
          );
          if (
            mass.unexpected !== 0 || mode === "empty" && mass.ancestor !== 0
          ) {
            throw Error(
              `invalid prepared initial lineage accounting for ${id}`,
            );
          }
          units.push({
            id,
            founderId: founder.id,
            founderHex: founder.hex,
            mode,
            seed,
            assignment,
            initialStateHash: stateHash(built.state),
            initialMass: mass,
            initialFlux: built.state.flux.map(String),
          });
        }
      }
    }
  }
  const requiredReplayUnitIds = [
    units.find((u) => u.mode === "clone")!.id,
    units.find((u) => u.mode === "empty")!.id,
  ];
  const inputMap = Object.fromEntries(
    Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)),
  );
  const inputHashes = inputMap;
  const sources = await collectSourceHashes(protocolPath);
  const configHash = sha256(JSON.stringify(configs));
  if (!configHash) throw Error("unreachable config hash");
  const payload = {
    format: PILOT_FORMAT,
    ruleVersion: RULE_VERSION,
    sourceRoot,
    root,
    protocolPath,
    inputs: inputHashes,
    sources,
    sourceManifestHash: canonicalHashMap(sources),
    founders,
    seeds: [...PILOT_SEEDS],
    times: [...PILOT_TIMES],
    configs,
    units,
    requiredReplayUnitIds,
    thresholds: {
      overallUniqueAvailability: 0.9,
      founderUniqueAvailability: 0.75,
      founderUniqueActivity: 0.75,
    },
  };
  return { ...payload, designHash: sha256(JSON.stringify(payload)) };
}

export function validatePilotDesign(raw: unknown): PilotDesign {
  const d = object(raw, "pilot design") as unknown as PilotDesign;
  if (d.format !== PILOT_FORMAT || d.ruleVersion !== RULE_VERSION) {
    throw Error("pilot design format or rule version mismatch");
  }
  if (canonicalPayloadHash(d) !== d.designHash) {
    throw Error("pilot design hash mismatch");
  }
  if (
    !Array.isArray(d.founders) || d.founders.length < 1 ||
    d.founders.length > 4 ||
    new Set(d.founders.map((f) => f.id)).size !== d.founders.length
  ) throw Error("invalid fixed founder roster");
  if (!equalJson(d.seeds, PILOT_SEEDS) || !equalJson(d.times, PILOT_TIMES)) {
    throw Error("pilot seeds or exact times differ from frozen protocol");
  }
  const expectedCount = d.founders.length * PILOT_SEEDS.length * 2 * 4;
  if (
    !Array.isArray(d.units) || d.units.length !== expectedCount ||
    new Set(d.units.map((u) => u.id)).size !== expectedCount
  ) throw Error("pilot unit roster incomplete or duplicated");
  const seen = new Set<string>();
  for (const founder of d.founders) {
    fromHex(founder.hex);
    for (const mode of ["clone", "empty"] as const) {
      for (const seed of PILOT_SEEDS) {
        for (let assignment = 0; assignment < 4; assignment++) {
          const id = `${founder.id}-${mode}-${seed}-a${assignment}`;
          const unit = d.units.find((u) => u.id === id);
          if (
            !unit || unit.founderId !== founder.id ||
            unit.founderHex !== founder.hex || unit.mode !== mode ||
            unit.seed !== seed || unit.assignment !== assignment
          ) throw Error(`pilot unit identity mismatch ${id}`);
          seen.add(id);
          if (!HEX16.test(unit.initialStateHash)) {
            throw Error(`invalid frozen initial state hash ${id}`);
          }
          for (
            const field of [
              "descendant",
              "ancestor",
              "unassociated",
              "unexpected",
            ] as const
          ) safeMass(unit.initialMass[field], `${id}.${field}`);
          if (
            unit.initialMass.unexpected !== 0 ||
            mode === "empty" && unit.initialMass.ancestor !== 0
          ) throw Error(`invalid frozen initial attribution ${id}`);
          if (
            unit.initialFlux.length !== FLUX_NAMES.length ||
            unit.initialFlux.some((x) => !UINT.test(x))
          ) throw Error(`invalid frozen initial flux ${id}`);
        }
      }
    }
  }
  if (
    !equalJson(d.requiredReplayUnitIds, [
      d.units.find((u) => u.mode === "clone")!.id,
      d.units.find((u) => u.mode === "empty")!.id,
    ])
  ) throw Error("frozen replay target identity mismatch");
  return d;
}

export async function verifyFrozenPilot(design: PilotDesign): Promise<void> {
  if (await Deno.realPath(Deno.cwd()) !== design.sourceRoot) {
    throw Error("pilot must run from its frozen source root");
  }
  if (
    canonicalHashMap(await collectSourceHashes(design.protocolPath)) !==
      design.sourceManifestHash
  ) throw Error("frozen source closure drift");
  await verifyHashRecords(design.inputs);
  await verifyHashRecords(design.sources);
}

async function writeNew(path: string, text: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, text, { createNew: true });
}
async function readDesign(
  pilotDir: string,
): Promise<{ design: PilotDesign; raw: string }> {
  const raw = await Deno.readTextFile(join(pilotDir, "pilot-design.json"));
  const design = validatePilotDesign(JSON.parse(raw));
  const reconstructed = await buildPilotDesign(design.root);
  if (!equalJson(reconstructed, design)) {
    throw Error(
      "frozen pilot design differs from reconstructed inputs/configuration/roster",
    );
  }
  await verifyFrozenPilot(design);
  return { design, raw };
}
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

async function plan(root: string, pilotDirArg: string): Promise<void> {
  const pilotDir = resolve(pilotDirArg);
  const design = await buildPilotDesign(root);
  validatePilotDesign(design);
  if (
    canonicalHashMap(await collectSourceHashes(design.protocolPath)) !==
      design.sourceManifestHash
  ) throw Error("source drift during plan freeze");
  await verifyHashRecords(design.inputs);
  await verifyHashRecords(design.sources);
  await Deno.mkdir(pilotDir, { recursive: false });
  await writeNew(
    join(pilotDir, "pilot-design.json"),
    JSON.stringify(design, null, 2) + "\n",
  );
  console.log(JSON.stringify({
    status: "frozen",
    designHash: design.designHash,
    founders: design.founders.length,
    units: design.units.length,
    requiredReplayUnitIds: design.requiredReplayUnitIds,
    paidUSD: 0,
  }));
}

function captureSample(
  state: import("@bl/schema").WorldState,
  built: ReturnType<typeof discoveryCompetitionWorld>,
  step: number,
): PilotSample {
  const mass = discoveryCompetitionMasses(
    state,
    built.descendantLineage,
    built.ancestorLineage,
  );
  return {
    step,
    mass,
    score: expectedScore(mass),
    flux: state.flux.map(String),
    stateHash: stateHash(state),
  };
}

async function run(pilotDirArg: string, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
    throw Error(
      "Runtime tranche must be greater than 0 and at most 600 seconds",
    );
  }
  const pilotDir = await Deno.realPath(resolve(pilotDirArg));
  const { design } = await readDesign(pilotDir);
  const receiptDir = join(pilotDir, "receipts");
  await Deno.mkdir(receiptDir, { recursive: true });
  const lockPath = join(pilotDir, "RUNNING");
  await Deno.writeTextFile(lockPath, `${Deno.pid}\n`, { createNew: true });
  const start = performance.now();
  let completed = 0;
  try {
    const { GpuSim, requestDevice } = await import("@bl/sim-gpu");
    const device = await requestDevice(navigator.gpu);
    try {
      for (const unit of design.units) {
        const path = join(receiptDir, `${unit.id}.json`);
        if (await exists(path)) {
          const priorBytes = await Deno.readFile(path),
            prior = JSON.parse(new TextDecoder().decode(priorBytes));
          validatePilotReceipt(prior, design, unit);
          continue;
        }
        if (performance.now() - start >= seconds * 1000) break;
        const cfg = design.configs[String(unit.seed)];
        const built = discoveryCompetitionWorld(
          cfg,
          unit.founderHex,
          unit.mode === "clone" ? unit.founderHex : null,
          unit.assignment,
        );
        const sim = await GpuSim.create(device, built.state),
          samples: PilotSample[] = [];
        const unitStart = performance.now();
        let step = 0, state = built.state;
        try {
          samples.push(captureSample(state, built, 0));
          for (const end of design.times.slice(1)) {
            while (step < end) {
              sim.run(Math.min(100, end - step));
              await device.queue.onSubmittedWorkDone();
              step += Math.min(100, end - step);
            }
            state = await sim.readState();
            if (state.step !== end) {
              throw Error(`step mismatch for ${unit.id} at ${end}`);
            }
            samples.push(captureSample(state, built, end));
          }
          const receipt: PilotReceipt = {
            format: RECEIPT_FORMAT,
            designHash: design.designHash,
            sourceManifestHash: design.sourceManifestHash,
            inputHashes: design.inputs,
            unit,
            times: design.times,
            samples,
            elapsedSeconds: (performance.now() - unitStart) / 1000,
          };
          validatePilotReceipt(receipt, design, unit);
          await writeNew(path, JSON.stringify(receipt) + "\n");
          completed++;
          console.log(
            JSON.stringify({
              id: unit.id,
              score: samples[2].score,
              totalMass: massTotal(samples[2].mass),
              elapsedSeconds: receipt.elapsedSeconds,
            }),
          );
        } finally {
          sim.destroy();
        }
      }
    } finally {
      device.destroy();
    }
    await verifyFrozenPilot(design);
  } finally {
    await Deno.remove(lockPath);
  }
  console.log(
    JSON.stringify({
      completed,
      elapsedSeconds: (performance.now() - start) / 1000,
    }),
  );
}

async function loadEvidenceDirectory(
  dir: string,
  design: PilotDesign,
): Promise<
  {
    receipts: Record<string, PilotEvidence>;
    replays: Record<string, PilotEvidence>;
    extra: string[];
  }
> {
  const receipts: Record<string, PilotEvidence> = {},
    replays: Record<string, PilotEvidence> = {},
    extra: string[] = [];
  const receiptDir = join(dir, "receipts");
  if (await exists(receiptDir)) {
    for await (const ent of Deno.readDir(receiptDir)) {
      if (!ent.isFile || !ent.name.endsWith(".json")) {
        extra.push(`receipts/${ent.name}`);
        continue;
      }
      const id = ent.name.slice(0, -5),
        path = join(receiptDir, ent.name),
        bytes = await Deno.readFile(path),
        digest = sha256(bytes);
      try {
        receipts[id] = {
          value: JSON.parse(new TextDecoder().decode(bytes)),
          sha256: digest,
        };
      } catch (e) {
        receipts[id] = {
          error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
          sha256: digest,
        };
      }
    }
  }
  const replayDir = join(dir, "replays");
  if (await exists(replayDir)) {
    for await (const ent of Deno.readDir(replayDir)) {
      if (!ent.isFile || !ent.name.endsWith(".json")) {
        extra.push(`replays/${ent.name}`);
        continue;
      }
      const path = join(replayDir, ent.name),
        bytes = await Deno.readFile(path),
        digest = sha256(bytes);
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch (e) {
        extra.push(
          `replays/${ent.name}: invalid JSON ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        continue;
      }
      const id = (value as { unitId?: unknown }).unitId;
      if (typeof id !== "string" || replays[id]) {
        extra.push(`replays/${ent.name}: missing or duplicate unitId`);
        continue;
      }
      replays[id] = { value, sha256: digest };
    }
  }
  return { receipts, replays, extra };
}

async function analyze(pilotDirArg: string, outputArg: string): Promise<void> {
  const pilotDir = await Deno.realPath(resolve(pilotDirArg));
  if (await exists(join(pilotDir, "RUNNING"))) {
    throw Error(
      "pilot run is live; analysis waits for the RUNNING lock to clear",
    );
  }
  const { design } = await readDesign(pilotDir);
  const evidence = await loadEvidenceDirectory(pilotDir, design);
  const result = analyzePilotEvidence(
    design,
    evidence.receipts,
    evidence.replays,
  );
  const report = {
    ...result,
    unexpectedFiles: evidence.extra,
    inputHashes: design.inputs,
    sourceManifestHash: design.sourceManifestHash,
    receiptHashes: Object.fromEntries(
      Object.entries(evidence.receipts).filter(([, e]) => e.value !== undefined)
        .map(([id, e]) => [id, e.sha256]),
    ),
  };
  if (evidence.extra.length) report.status = "incomplete";
  await writeNew(resolve(outputArg), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    status: report.status,
    requested: report.requested,
    available: report.available,
    missing: report.missing.length,
    invalid: report.invalid.length,
    replayMissing: report.replayMissing.length,
    replayInvalid: report.replayInvalid.length,
  }));
}

async function replay(
  pilotDirArg: string,
  unitId: string,
  outputArg: string,
): Promise<void> {
  const pilotDir = await Deno.realPath(resolve(pilotDirArg));
  const { design } = await readDesign(pilotDir);
  const unit = design.units.find((u) => u.id === unitId);
  if (!unit || !design.requiredReplayUnitIds.includes(unitId)) {
    throw Error("unit is not one of the two frozen replay targets");
  }
  const receiptPath = join(pilotDir, "receipts", `${unitId}.json`),
    receiptBytes = await Deno.readFile(receiptPath);
  const receipt = validatePilotReceipt(
    JSON.parse(new TextDecoder().decode(receiptBytes)),
    design,
    unit,
  );
  const output = resolve(outputArg), replayDir = resolve(pilotDir, "replays");
  if (
    dirname(output) !== replayDir || isAbsolute(relative(replayDir, output)) ||
    relative(replayDir, output).startsWith("..") || !output.endsWith(".json")
  ) {
    throw Error(
      "replay output must be a new .json file directly under PILOT_DIR/replays",
    );
  }
  await Deno.mkdir(replayDir, { recursive: true });
  const lockPath = join(pilotDir, "RUNNING");
  await Deno.writeTextFile(lockPath, `${Deno.pid}\n`, { createNew: true });
  try {
    const { GpuSim, requestDevice } = await import("@bl/sim-gpu");
    const cfg = design.configs[String(unit.seed)];
    const built = discoveryCompetitionWorld(
      cfg,
      unit.founderHex,
      unit.mode === "clone" ? unit.founderHex : null,
      unit.assignment,
    );
    const device = await requestDevice(navigator.gpu);
    const samples: PilotSample[] = [];
    let elapsedSeconds = 0;
    try {
      const sim = await GpuSim.create(device, built.state),
        start = performance.now();
      let state = built.state, step = 0;
      try {
        samples.push(captureSample(state, built, 0));
        for (const end of design.times.slice(1)) {
          while (step < end) {
            const delta = Math.min(100, end - step);
            sim.run(delta);
            await device.queue.onSubmittedWorkDone();
            step += delta;
          }
          state = await sim.readState();
          if (state.step !== end) throw Error(`replay step mismatch at ${end}`);
          samples.push(captureSample(state, built, end));
        }
      } finally {
        sim.destroy();
        elapsedSeconds = (performance.now() - start) / 1000;
      }
    } finally {
      device.destroy();
    }
    const pass = equalJson(samples, receipt.samples);
    const report: PilotReplayReport = {
      format: REPLAY_FORMAT,
      unitId,
      designHash: design.designHash,
      sourceManifestHash: design.sourceManifestHash,
      receiptSha256: sha256(receiptBytes),
      replaySourceSha256:
        design.sources["tools/discovery_competition_pilot.ts"],
      pass,
      samples,
      elapsedSeconds,
    };
    await verifyFrozenPilot(design);
    await writeNew(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ unitId, pass }));
    if (!pass) throw Error("replay differs from frozen receipt");
  } finally {
    await Deno.remove(lockPath);
  }
}

if (import.meta.main) {
  const [stage, ...args] = Deno.args;
  if (stage === "plan" && args.length === 2) await plan(args[0], args[1]);
  else if (stage === "run" && args.length === 2) {
    await run(args[0], Number(args[1]));
  } else if (stage === "analyze" && args.length === 2) {
    await analyze(args[0], args[1]);
  } else if (stage === "replay" && args.length === 3) {
    await replay(args[0], args[1], args[2]);
  } else {throw Error(
      "usage: discovery_competition_pilot.ts plan ROOT NEW_PILOT_DIR | run PILOT_DIR SECONDS | analyze PILOT_DIR NEW_OUTPUT | replay PILOT_DIR UNIT_ID NEW_OUTPUT",
    );}
}
