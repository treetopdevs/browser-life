// discovery-v1: the case and result contracts of the evolvability-discovery
// workbench (docs/evolvability-discovery-2026-10-04/DESIGN.md section 4).
//
// One case identity, one validator and one reducer serve the local shard path
// and the distributed plane. Everything here is pure and runtime-neutral
// (browser, Deno, Node); SHA-256 goes through WebCrypto, so the digest helpers
// are async.
//
// Canonical bytes are UTF-8 JSON with object keys sorted recursively and no
// insignificant whitespace (the form `canonicalObserverJSON` produces), with
// three extra rules that make the encoding total and unambiguous:
//   - numbers must be safe integers (no floats, NaN, Infinity or -0);
//   - a bigint is a base-10 string without leading zeros;
//   - a typed array is a lowercase hex string of its bytes, each element
//     little-endian at its own width (`Uint32Array([1])` is "01000000").
// `undefined`, functions, Maps, Dates and other objects are rejected, so a
// payload either canonicalizes exactly or throws.

import { RULE_VERSION, SCHEMA_VERSION, defaultConfig, validateConfig, type WorldConfig } from "./config.ts";

export const DISCOVERY_SCHEMA = "discovery-v1";

/** The CPU reference of this build. */
export const CPU_BACKEND = "cpu-ref-v1" as const;
/**
 * Decision D5 (2026-10-04): cases that need the construction workstream's
 * renewal observer run pinned to a named construction revision, vendored byte
 * for byte in vendor/construction-renewal-v1 (tools/lib/discovery-pin.ts).
 * These labels name that pin; a manifest that uses them records the pin and
 * the pin's physics versions, never this build's.
 */
export const RENEWAL_PIN = {
  backend: "cpu-ref-renewal-pin-v1",
  observerVersion: "renewal-observer-v1.pin-24cef9e2",
  readoutVersion: "renewal-readout-v1.pin-24cef9e2",
  name: "construction-renewal-v1",
  constructionRevision: "ca8a4dbd08000ae406e48acf242469d48d04b6c2",
  sourceDigest: "24cef9e2f79abaad6d9260e63585c30c1b0a3516d38e669321235ccd3d0e6362",
  /** SHA-256 of the renewal-v1 root's manifest.json, as frozen (FROZEN.json manifestSha256). */
  manifestSha256: "0df114ada3dfba34f601cd70afea764f1af6207565cf8ce1cca1cb882250f1e0",
  physicsVersions: { ruleVersion: 2, checkpointSchema: 3 },
} as const;
export const BACKEND_CONTRACTS = [CPU_BACKEND, RENEWAL_PIN.backend] as const;
export type BackendContract = (typeof BACKEND_CONTRACTS)[number];
export interface PinRecord {
  name: string;
  constructionRevision: string;
  sourceDigest: string;
}

/** The evidence vocabulary of PLAN Stage 0. A technical failure is never a biological negative. */
export const EVIDENCE_STATUSES = ["supported", "unsupported-within-tested-domain", "invalid-or-incomplete", "unsupported-measurement"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Purposes partition seeds and results (DESIGN section 3: calibration, discovery and confirmation namespaces). */
export const CAMPAIGN_PURPOSES = ["engineering", "calibration", "discovery", "confirmation"] as const;
export type CampaignPurpose = (typeof CAMPAIGN_PURPOSES)[number];

// ---------------------------------------------------------------------------
// Canonical encoding and digests

type TypedArray = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array | Int32Array | BigUint64Array | BigInt64Array;

function isTypedArray(v: unknown): v is TypedArray {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

/** Lowercase hex of a typed array's elements, each little-endian at its own width, independent of host byte order. */
export function typedArrayHex(a: TypedArray): string {
  const width = a.BYTES_PER_ELEMENT;
  const out = new Array<string>(a.length * width);
  let p = 0;
  for (let i = 0; i < a.length; i++) {
    let v = typeof a[i] === "bigint" ? BigInt.asUintN(64, a[i] as bigint) : BigInt((a[i] as number) < 0 ? (a[i] as number) + 2 ** (8 * width) : (a[i] as number));
    for (let b = 0; b < width; b++) {
      out[p++] = Number(v & 0xffn).toString(16).padStart(2, "0");
      v >>= 8n;
    }
  }
  return out.join("");
}

/** Inverse of `typedArrayHex` for an unsigned element width of 1, 2 or 4 bytes. */
export function hexToUint(hex: string, width: 1 | 2 | 4): Uint8Array | Uint16Array | Uint32Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex) || hex.length % (2 * width) !== 0) throw new Error(`hex: not a whole number of ${width}-byte elements`);
  const n = hex.length / (2 * width);
  const out = width === 1 ? new Uint8Array(n) : width === 2 ? new Uint16Array(n) : new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let b = width - 1; b >= 0; b--) v = v * 256 + parseInt(hex.substr((i * width + b) * 2, 2), 16);
    out[i] = v;
  }
  return out;
}

/**
 * Serializes a value canonically, or throws naming the offending path. Keys
 * are emitted in sorted UTF-16 code-unit order by this serializer itself, not
 * by object insertion order, so integer-like keys ("10" before "2") and own
 * "__proto__" keys are kept exactly. For the ASCII keys every contract here
 * uses, the order equals Python's `sort_keys`.
 */
function serialize(v: unknown, path: string): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw new Error(`canonical: ${path} is not a safe integer (${v})`);
    return String(v);
  }
  if (typeof v === "bigint") return JSON.stringify(v.toString(10));
  if (isTypedArray(v)) return JSON.stringify(typedArrayHex(v));
  if (Array.isArray(v)) return `[${v.map((x, i) => serialize(x, `${path}[${i}]`)).join(",")}]`;
  if (typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys
      .map((k) => {
        if (o[k] === undefined) throw new Error(`canonical: ${path}.${k} is undefined`);
        return `${JSON.stringify(k)}:${serialize(o[k], `${path}.${k}`)}`;
      })
      .join(",")}}`;
  }
  throw new Error(`canonical: ${path} has unsupported type ${typeof v}`);
}

export function canonicalJSON(v: unknown): string {
  return serialize(v, "$");
}

export function canonicalBytes(v: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJSON(v));
}

const K256 = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * FIPS 180-4 SHA-256 in plain JavaScript, for pages without WebCrypto (a
 * browser on a plain-HTTP private address is not a secure context). Checked
 * against WebCrypto and the shared test vectors.
 */
export function sha256HexJS(bytes: Uint8Array): string {
  const len = bytes.length;
  const padded = new Uint8Array((((len + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  dv.setUint32(padded.length - 4, bits >>> 0);
  const H = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + 4 * t);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K256[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256HexJS(bytes);
  const d = await subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function digestOf(v: unknown): Promise<string> {
  return sha256Hex(canonicalBytes(v));
}

const HEX64 = /^[0-9a-f]{64}$/;
export const isDigest = (s: unknown): s is string => typeof s === "string" && HEX64.test(s);

// ---------------------------------------------------------------------------
// Protocol (authored) -> manifest (frozen) -> cases

/**
 * A declarative initial state. No executable code: the runner builds the
 * state from these integers alone, and freeze stores the result as an
 * immutable checkpoint artifact that every case binds by digest.
 */
export type InitialRecipe =
  | {
      kind: "deposits";
      /** Nutrient (A) quanta per cell. */
      nutrient: number;
      /** Non-living bound matter placed in single cells (lineage 0:0, no genome). */
      deposits: { x: number; y: number; B: number; P: number; E: number }[];
    }
  | {
      /**
       * Exact single-cell founders (the construction workstream's
       * `constructionWorld`): biomass and free energy in one cell each, lineage
       * ids 1, 2, ... in listed order, no founder noise; nutrient in every cell.
       */
      kind: "cells";
      nutrient: number;
      founders: { x: number; y: number; genomeHex: string; biomass: number; energy: number }[];
    }
  | {
      kind: "founders";
      nutrient: number;
      /** Each founder's genome is the hex of `genomeHex` (an explicit encoding, never a name). */
      founders: { x: number; y: number; radius: number; genomeHex: string; biomass: number; energy: number }[];
    };

/** One fixed world of a campaign: a law point, a habitat, a founder panel and an assay. */
export interface FixtureSpec {
  /** Stable label, unique in the campaign. */
  id: string;
  candidateId: string;
  habitatId: string;
  founderId: string;
  assayId: string;
  armId: string;
  /** `WorldConfig` overrides on top of `defaultConfig()`; `seed` is set per block and may not appear here. */
  config: Partial<WorldConfig>;
  initial: InitialRecipe;
  steps: number;
  /** Census every `censusEvery` steps (and at the end). */
  censusEvery: number;
  /** Steps at which the runner round-trips state and observers through a checkpoint. */
  segmentAt: number[];
  /** Sites (x, y) the maintained-site readout follows; empty when the assay has none. */
  sites: { x: number; y: number }[];
}

export interface ResourceLimits {
  concurrentCasesPerHost: number;
  caseWallSeconds: number;
  campaignWallSeconds: number;
  campaignBytes: number;
  attemptsPerCasePerRole: number;
}

export interface VerificationPolicy {
  /** "every-case-cross-host": every case needs a replay from a different physical host with equal canonical results. */
  replay: "every-case-cross-host";
}

/** What a researcher writes and reviews before freezing. */
export interface DiscoveryProtocol {
  schemaVersion: typeof DISCOVERY_SCHEMA;
  campaign: string;
  purpose: CampaignPurpose;
  question: string;
  /** Seed namespace of this campaign; every block seed must lie inside it. */
  seedNamespace: { name: string; first: number; last: number };
  blocks: { id: string; seed: number }[];
  fixtures: FixtureSpec[];
  observerVersion: string;
  readoutVersion: string;
  resourceLimits: ResourceLimits;
  verificationPolicy: VerificationPolicy;
  stoppingRule: string;
}

export interface CaseSpec {
  schemaVersion: typeof DISCOVERY_SCHEMA;
  campaignDigest: string;
  candidateId: string;
  habitatId: string;
  founderId: string;
  assayId: string;
  fixtureId: string;
  blockId: string;
  armId: string;
  physicsSeed: number;
  mutationPolicy: "as-configured";
  resolvedWorldConfig: WorldConfig;
  initialArtifactDigest: string;
  steps: number;
  observationSchedule: { censusEvery: number; segmentAt: number[]; sites: { x: number; y: number }[] };
  requiredBackendContract: BackendContract;
  resourceClass: "small-cpu";
}

export interface CampaignManifest {
  schemaVersion: typeof DISCOVERY_SCHEMA;
  campaign: string;
  purpose: CampaignPurpose;
  question: string;
  protocolDigest: string;
  buildDigest: string;
  sourceClosureDigest: string;
  physicsVersions: { ruleVersion: number; checkpointSchema: number };
  observerVersion: string;
  readoutVersion: string;
  resolvedParameterDomain: { fixtureId: string; candidateId: string; config: Partial<WorldConfig> }[];
  habitats: { fixtureId: string; habitatId: string; initialArtifactDigest: string }[];
  encodedFounderPanel: { founderId: string; genomeHex: string[] }[];
  assayDefinitions: { assayId: string; fixtureIds: string[] }[];
  seedNamespaces: { name: string; first: number; last: number; blocks: { id: string; seed: number }[] };
  resourceLimits: ResourceLimits;
  verificationPolicy: VerificationPolicy;
  stoppingRule: string;
  /** Excluded from the campaign core: hold case IDs. */
  orderedCaseIds: string[];
  proposalBatches: string[][];
  archiveDefinition: null;
  /** Present only on campaigns that run pinned to a construction revision (D5); absent keys keep older manifests' digests. */
  pin?: PinRecord;
}

/** The two fields that hold case IDs (DESIGN 4, "Hashing order"); a schema that adds another must add it here. */
export const CASE_ID_FIELDS = ["orderedCaseIds", "proposalBatches"] as const;

export function campaignCore(m: CampaignManifest): Omit<CampaignManifest, (typeof CASE_ID_FIELDS)[number]> {
  const { orderedCaseIds: _a, proposalBatches: _b, ...core } = m;
  return core;
}

export async function campaignCoreDigest(m: CampaignManifest): Promise<string> {
  return digestOf(campaignCore(m));
}

/** `caseId = SHA256(canonical CaseSpec)`; a spec carries no `caseId` field, so nothing is excluded. */
export async function caseIdOf(spec: CaseSpec): Promise<string> {
  return digestOf(spec);
}

/** Digest of the completed manifest: core and case list together. The acceptance index and the export bind to it. */
export async function manifestDigest(m: CampaignManifest): Promise<string> {
  return digestOf(m);
}

// ---------------------------------------------------------------------------
// Results

export const RESULT_FILES = ["observations.jsonl", "readout.json", "end.blck"] as const;
export type ResultFile = (typeof RESULT_FILES)[number];

/**
 * The scientific part of a result. Two executions of one case agree exactly
 * when these are equal; nothing host- or time-dependent is in here.
 */
export interface CanonicalResult {
  caseId: string;
  campaignDigest: string;
  startArtifactDigest: string;
  /** `stateHash` of the end state (physics only, 16 hex). */
  endStateHash: string;
  /** SHA-256 of the end checkpoint file (physics and observer). */
  endArtifactDigest: string;
  canonicalObservationDigests: { observations: string };
  readoutDigest: string;
  invariantChecks: { matterResidualMax: string; energyResidualMax: string; fluxIdentityViolations: number; passed: boolean };
  /** "completed": the history ran to its end (an extinction is completed). "failed" never reaches a result file. */
  outcome: "completed";
}

export interface ExecutionRecord {
  attemptId: string;
  role: "primary" | "replay";
  leaseId: string | null;
  workerId: string;
  physicalHostId: string;
  backendBuild: string;
  sourceClosureDigest: string;
  startedAt: string;
  measuredWallMs: number;
  artifactSizes: Record<ResultFile, number>;
  files: Record<ResultFile, string>;
}

export interface ResultManifest {
  schemaVersion: typeof DISCOVERY_SCHEMA;
  canonical: CanonicalResult;
  execution: ExecutionRecord;
}

// ---------------------------------------------------------------------------
// Strict validation (no unknown keys, finite integers, digests)

type Errs = string[];

function keysExactly(o: unknown, keys: readonly string[], path: string, errs: Errs): o is Record<string, unknown> {
  if (!o || typeof o !== "object" || Array.isArray(o)) {
    errs.push(`${path}: not an object`);
    return false;
  }
  const have = Object.keys(o);
  for (const k of have) if (!keys.includes(k)) errs.push(`${path}: unknown key ${k}`);
  for (const k of keys) if (!(k in (o as object))) errs.push(`${path}: missing ${k}`);
  return true;
}

const int = (v: unknown, lo: number, hi: number) => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const label = (v: unknown) => typeof v === "string" && LABEL.test(v);

function checkRecipe(r: unknown, path: string, errs: Errs): void {
  if (!r || typeof r !== "object") return void errs.push(`${path}: not an object`);
  const kind = (r as { kind?: unknown }).kind;
  if (kind === "deposits") {
    if (!keysExactly(r, ["kind", "nutrient", "deposits"], path, errs)) return;
    if (!int(r.nutrient, 0, 1 << 20)) errs.push(`${path}.nutrient: bad`);
    if (!Array.isArray(r.deposits)) return void errs.push(`${path}.deposits: not an array`);
    r.deposits.forEach((d, i) => {
      const p = `${path}.deposits[${i}]`;
      if (!keysExactly(d, ["x", "y", "B", "P", "E"], p, errs)) return;
      for (const k of ["x", "y", "B", "P", "E"]) if (!int(d[k], 0, 1 << 26)) errs.push(`${p}.${k}: bad`);
    });
  } else if (kind === "cells") {
    if (!keysExactly(r, ["kind", "nutrient", "founders"], path, errs)) return;
    if (!int(r.nutrient, 0, 1 << 20)) errs.push(`${path}.nutrient: bad`);
    if (!Array.isArray(r.founders) || r.founders.length === 0) return void errs.push(`${path}.founders: not a non-empty array`);
    const seen = new Set<string>();
    r.founders.forEach((f, i) => {
      const p = `${path}.founders[${i}]`;
      if (!keysExactly(f, ["x", "y", "genomeHex", "biomass", "energy"], p, errs)) return;
      for (const k of ["x", "y", "biomass", "energy"]) if (!int(f[k], 0, 1 << 20)) errs.push(`${p}.${k}: bad`);
      if (typeof f.genomeHex !== "string" || !/^[0-9a-f]+$/.test(f.genomeHex)) errs.push(`${p}.genomeHex: bad`);
      if (seen.has(`${f.x},${f.y}`)) errs.push(`${p}: overlaps another founder`);
      seen.add(`${f.x},${f.y}`);
    });
  } else if (kind === "founders") {
    if (!keysExactly(r, ["kind", "nutrient", "founders"], path, errs)) return;
    if (!int(r.nutrient, 0, 1 << 20)) errs.push(`${path}.nutrient: bad`);
    if (!Array.isArray(r.founders)) return void errs.push(`${path}.founders: not an array`);
    r.founders.forEach((f, i) => {
      const p = `${path}.founders[${i}]`;
      if (!keysExactly(f, ["x", "y", "radius", "genomeHex", "biomass", "energy"], p, errs)) return;
      for (const k of ["x", "y", "radius", "biomass", "energy"]) if (!int(f[k], 0, 1 << 20)) errs.push(`${p}.${k}: bad`);
      if (typeof f.genomeHex !== "string" || !/^[0-9a-f]+$/.test(f.genomeHex)) errs.push(`${p}.genomeHex: bad`);
    });
  } else errs.push(`${path}.kind: unknown ${String(kind)}`);
}

/**
 * Config keys a fixture may set: the default keys, plus, on a pinned campaign
 * only, the pin's cost-retaining ablation switch `polymerTransport` (D5). This
 * build's own physics would silently ignore that key, so an unpinned campaign
 * must never carry it.
 */
export function configKeyErrors(config: Record<string, unknown>, pinned: boolean): string[] {
  const errs: string[] = [];
  const known = Object.keys(defaultConfig());
  for (const k of Object.keys(config)) {
    if (k === "seed" || known.includes(k)) continue;
    if (k === "polymerTransport" && pinned) {
      if (typeof config[k] !== "boolean") errs.push("polymerTransport must be a boolean");
      continue;
    }
    errs.push(`key ${k} is not a default config key${k === "polymerTransport" ? " (allowed only on a campaign pinned to the construction revision)" : ""}`);
  }
  return errs;
}

const FIXTURE_KEYS = ["id", "candidateId", "habitatId", "founderId", "assayId", "armId", "config", "initial", "steps", "censusEvery", "segmentAt", "sites"] as const;
const LIMIT_KEYS = ["concurrentCasesPerHost", "caseWallSeconds", "campaignWallSeconds", "campaignBytes", "attemptsPerCasePerRole"] as const;

/** Strict structural check of an authored protocol. Returns every problem found. */
export function validateProtocol(p: unknown): string[] {
  const errs: Errs = [];
  const keys = ["schemaVersion", "campaign", "purpose", "question", "seedNamespace", "blocks", "fixtures", "observerVersion", "readoutVersion", "resourceLimits", "verificationPolicy", "stoppingRule"];
  if (!keysExactly(p, keys, "protocol", errs)) return errs;
  if (p.schemaVersion !== DISCOVERY_SCHEMA) errs.push(`protocol.schemaVersion: expected ${DISCOVERY_SCHEMA}`);
  if (!label(p.campaign)) errs.push("protocol.campaign: bad label");
  if (!CAMPAIGN_PURPOSES.includes(p.purpose as CampaignPurpose)) errs.push("protocol.purpose: unknown");
  if (typeof p.question !== "string" || !p.question.trim()) errs.push("protocol.question: empty");
  if (typeof p.stoppingRule !== "string" || !p.stoppingRule.trim()) errs.push("protocol.stoppingRule: empty");
  for (const k of ["observerVersion", "readoutVersion"]) if (!label(p[k])) errs.push(`protocol.${k}: bad label`);
  const ns = p.seedNamespace as Record<string, unknown>;
  if (keysExactly(ns, ["name", "first", "last"], "protocol.seedNamespace", errs)) {
    if (!label(ns.name)) errs.push("protocol.seedNamespace.name: bad label");
    if (!int(ns.first, 1, 0xffffffff) || !int(ns.last, 1, 0xffffffff) || (ns.first as number) > (ns.last as number)) errs.push("protocol.seedNamespace: bad range");
  }
  if (!Array.isArray(p.blocks) || p.blocks.length === 0) errs.push("protocol.blocks: empty");
  else {
    const ids = new Set<string>();
    const seeds = new Set<number>();
    p.blocks.forEach((b, i) => {
      if (!keysExactly(b, ["id", "seed"], `protocol.blocks[${i}]`, errs)) return;
      if (!label(b.id) || ids.has(b.id as string)) errs.push(`protocol.blocks[${i}].id: bad or duplicate`);
      ids.add(b.id as string);
      if (!int(b.seed, 1, 0xffffffff)) errs.push(`protocol.blocks[${i}].seed: bad`);
      else {
        if (seeds.has(b.seed as number)) errs.push(`protocol.blocks[${i}].seed: collides with another block`);
        seeds.add(b.seed as number);
        if (ns && int(ns.first, 1, 0xffffffff) && ((b.seed as number) < (ns.first as number) || (b.seed as number) > (ns.last as number)))
          errs.push(`protocol.blocks[${i}].seed: outside the campaign namespace`);
      }
    });
  }
  if (!Array.isArray(p.fixtures) || p.fixtures.length === 0) errs.push("protocol.fixtures: empty");
  else {
    const ids = new Set<string>();
    p.fixtures.forEach((f, i) => {
      const path = `protocol.fixtures[${i}]`;
      if (!keysExactly(f, FIXTURE_KEYS, path, errs)) return;
      if (!label(f.id) || ids.has(f.id as string)) errs.push(`${path}.id: bad or duplicate`);
      ids.add(f.id as string);
      for (const k of ["candidateId", "habitatId", "founderId", "assayId", "armId"]) if (!label(f[k])) errs.push(`${path}.${k}: bad label`);
      if (!f.config || typeof f.config !== "object" || Array.isArray(f.config)) errs.push(`${path}.config: not an object`);
      else {
        if ("seed" in (f.config as object)) errs.push(`${path}.config: seed is set per block, not per fixture`);
        const cfgErrs = validateConfig(defaultConfig({ ...(f.config as Partial<WorldConfig>), seed: 1 }));
        for (const e of cfgErrs) errs.push(`${path}.config: ${e}`);
        for (const e of configKeyErrors(f.config as Record<string, unknown>, p.observerVersion === RENEWAL_PIN.observerVersion)) errs.push(`${path}.config: ${e}`);
      }
      checkRecipe(f.initial, `${path}.initial`, errs);
      if (!int(f.steps, 1, 10_000_000)) errs.push(`${path}.steps: bad`);
      if (!int(f.censusEvery, 1, 10_000_000)) errs.push(`${path}.censusEvery: bad`);
      if (!Array.isArray(f.segmentAt) || f.segmentAt.some((s, j, a) => !int(s, 1, (f.steps as number) - 1) || (j > 0 && s <= a[j - 1])))
        errs.push(`${path}.segmentAt: must be increasing steps inside the run`);
      if (!Array.isArray(f.sites)) errs.push(`${path}.sites: not an array`);
      else f.sites.forEach((s, j) => keysExactly(s, ["x", "y"], `${path}.sites[${j}]`, errs) && (int(s.x, 0, 1 << 16) && int(s.y, 0, 1 << 16) || errs.push(`${path}.sites[${j}]: bad`)));
    });
  }
  const lim = p.resourceLimits as Record<string, unknown>;
  if (keysExactly(lim, LIMIT_KEYS, "protocol.resourceLimits", errs))
    for (const k of LIMIT_KEYS) if (!int(lim[k], 1, Number.MAX_SAFE_INTEGER)) errs.push(`protocol.resourceLimits.${k}: bad`);
  const vp = p.verificationPolicy as Record<string, unknown>;
  if (keysExactly(vp, ["replay"], "protocol.verificationPolicy", errs) && vp.replay !== "every-case-cross-host") errs.push("protocol.verificationPolicy.replay: unsupported");
  return errs;
}

const CANONICAL_KEYS = ["caseId", "campaignDigest", "startArtifactDigest", "endStateHash", "endArtifactDigest", "canonicalObservationDigests", "readoutDigest", "invariantChecks", "outcome"] as const;
const EXEC_KEYS = ["attemptId", "role", "leaseId", "workerId", "physicalHostId", "backendBuild", "sourceClosureDigest", "startedAt", "measuredWallMs", "artifactSizes", "files"] as const;

/** Strict structural check of a result manifest (identity against the campaign is the validator's job). */
export function validateResultManifest(r: unknown): string[] {
  const errs: Errs = [];
  if (!keysExactly(r, ["schemaVersion", "canonical", "execution"], "result", errs)) return errs;
  if (r.schemaVersion !== DISCOVERY_SCHEMA) errs.push("result.schemaVersion: bad");
  const c = r.canonical as Record<string, unknown>;
  if (keysExactly(c, CANONICAL_KEYS, "result.canonical", errs)) {
    for (const k of ["caseId", "campaignDigest", "startArtifactDigest", "endArtifactDigest", "readoutDigest"]) if (!isDigest(c[k])) errs.push(`result.canonical.${k}: not a digest`);
    if (typeof c.endStateHash !== "string" || !/^[0-9a-f]{16}$/.test(c.endStateHash)) errs.push("result.canonical.endStateHash: bad");
    const od = c.canonicalObservationDigests as Record<string, unknown>;
    if (keysExactly(od, ["observations"], "result.canonical.canonicalObservationDigests", errs) && !isDigest(od.observations)) errs.push("result.canonical.canonicalObservationDigests.observations: not a digest");
    const ic = c.invariantChecks as Record<string, unknown>;
    if (keysExactly(ic, ["matterResidualMax", "energyResidualMax", "fluxIdentityViolations", "passed"], "result.canonical.invariantChecks", errs)) {
      for (const k of ["matterResidualMax", "energyResidualMax"]) if (typeof ic[k] !== "string" || !/^(0|[1-9][0-9]*)$/.test(ic[k] as string)) errs.push(`result.canonical.invariantChecks.${k}: bad`);
      if (!int(ic.fluxIdentityViolations, 0, Number.MAX_SAFE_INTEGER)) errs.push("result.canonical.invariantChecks.fluxIdentityViolations: bad");
      if (typeof ic.passed !== "boolean") errs.push("result.canonical.invariantChecks.passed: bad");
    }
    if (c.outcome !== "completed") errs.push("result.canonical.outcome: bad");
  }
  const e = r.execution as Record<string, unknown>;
  if (keysExactly(e, EXEC_KEYS, "result.execution", errs)) {
    for (const k of ["attemptId", "workerId", "physicalHostId"]) if (!label(e[k])) errs.push(`result.execution.${k}: bad label`);
    if (e.role !== "primary" && e.role !== "replay") errs.push("result.execution.role: bad");
    if (e.leaseId !== null && typeof e.leaseId !== "string") errs.push("result.execution.leaseId: bad");
    if (typeof e.backendBuild !== "string") errs.push("result.execution.backendBuild: bad");
    if (!isDigest(e.sourceClosureDigest)) errs.push("result.execution.sourceClosureDigest: not a digest");
    if (typeof e.startedAt !== "string") errs.push("result.execution.startedAt: bad");
    if (!int(e.measuredWallMs, 0, Number.MAX_SAFE_INTEGER)) errs.push("result.execution.measuredWallMs: bad");
    const sizes = e.artifactSizes as Record<string, unknown>;
    if (keysExactly(sizes, RESULT_FILES, "result.execution.artifactSizes", errs)) for (const f of RESULT_FILES) if (!int(sizes[f], 0, Number.MAX_SAFE_INTEGER)) errs.push(`result.execution.artifactSizes.${f}: bad`);
    const files = e.files as Record<string, unknown>;
    if (keysExactly(files, RESULT_FILES, "result.execution.files", errs)) for (const f of RESULT_FILES) if (!isDigest(files[f])) errs.push(`result.execution.files.${f}: not a digest`);
  }
  return errs;
}

const MANIFEST_KEYS = [
  "schemaVersion", "campaign", "purpose", "question", "protocolDigest", "buildDigest", "sourceClosureDigest", "physicsVersions", "observerVersion", "readoutVersion",
  "resolvedParameterDomain", "habitats", "encodedFounderPanel", "assayDefinitions", "seedNamespaces", "resourceLimits", "verificationPolicy", "stoppingRule",
  "orderedCaseIds", "proposalBatches", "archiveDefinition",
] as const;

/** Strict structural check of a frozen manifest (its digests are checked by the loader). */
export function validateManifest(m: unknown): string[] {
  const errs: Errs = [];
  const pinned = !!m && typeof m === "object" && "pin" in (m as object);
  if (!keysExactly(m, pinned ? [...MANIFEST_KEYS, "pin"] : MANIFEST_KEYS, "manifest", errs)) return errs;
  if (pinned) {
    const pin = m.pin as Record<string, unknown>;
    if (keysExactly(pin, ["name", "constructionRevision", "sourceDigest"], "manifest.pin", errs) && (pin.name !== RENEWAL_PIN.name || pin.constructionRevision !== RENEWAL_PIN.constructionRevision || pin.sourceDigest !== RENEWAL_PIN.sourceDigest))
      errs.push("manifest.pin: not a pin this build knows");
    if (m.observerVersion !== RENEWAL_PIN.observerVersion || m.readoutVersion !== RENEWAL_PIN.readoutVersion) errs.push("manifest.pin: a pinned campaign must use the pinned observer and readout");
  } else if (m.observerVersion === RENEWAL_PIN.observerVersion || m.readoutVersion === RENEWAL_PIN.readoutVersion) errs.push("manifest: the pinned observer or readout needs the pin record");
  if (m.schemaVersion !== DISCOVERY_SCHEMA) errs.push("manifest.schemaVersion: bad");
  if (!label(m.campaign)) errs.push("manifest.campaign: bad label");
  if (!CAMPAIGN_PURPOSES.includes(m.purpose as CampaignPurpose)) errs.push("manifest.purpose: unknown");
  for (const k of ["protocolDigest", "buildDigest", "sourceClosureDigest"]) if (!isDigest(m[k])) errs.push(`manifest.${k}: not a digest`);
  for (const k of ["observerVersion", "readoutVersion"]) if (!label(m[k])) errs.push(`manifest.${k}: bad label`);
  const pv = m.physicsVersions as Record<string, unknown>;
  const physics = pinned ? RENEWAL_PIN.physicsVersions : { ruleVersion: RULE_VERSION, checkpointSchema: SCHEMA_VERSION };
  if (keysExactly(pv, ["ruleVersion", "checkpointSchema"], "manifest.physicsVersions", errs) && (pv.ruleVersion !== physics.ruleVersion || pv.checkpointSchema !== physics.checkpointSchema))
    errs.push(`manifest.physicsVersions: ${pinned ? "the pin" : "this build"} runs rule ${physics.ruleVersion}, checkpoint schema ${physics.checkpointSchema}`);
  const lim = m.resourceLimits as Record<string, unknown>;
  if (keysExactly(lim, LIMIT_KEYS, "manifest.resourceLimits", errs)) for (const k of LIMIT_KEYS) if (!int(lim[k], 1, Number.MAX_SAFE_INTEGER)) errs.push(`manifest.resourceLimits.${k}: bad`);
  const vp = m.verificationPolicy as Record<string, unknown>;
  if (keysExactly(vp, ["replay"], "manifest.verificationPolicy", errs) && vp.replay !== "every-case-cross-host") errs.push("manifest.verificationPolicy.replay: unsupported");
  if (!Array.isArray(m.orderedCaseIds) || m.orderedCaseIds.length === 0 || !m.orderedCaseIds.every(isDigest)) errs.push("manifest.orderedCaseIds: bad");
  else if (new Set(m.orderedCaseIds).size !== m.orderedCaseIds.length) errs.push("manifest.orderedCaseIds: duplicate case IDs");
  if (!Array.isArray(m.proposalBatches) || !m.proposalBatches.every((b) => Array.isArray(b) && b.every(isDigest))) errs.push("manifest.proposalBatches: bad");
  else if (Array.isArray(m.orderedCaseIds) && canonicalJSON(m.proposalBatches.flat()) !== canonicalJSON(m.orderedCaseIds)) errs.push("manifest.proposalBatches: must partition orderedCaseIds in order");
  if (m.archiveDefinition !== null) errs.push("manifest.archiveDefinition: must be null (no search in discovery-v1)");
  const list = (v: unknown, path: string, keys: string[], each: (o: Record<string, unknown>, p: string) => void) => {
    if (!Array.isArray(v) || v.length === 0) return void errs.push(`${path}: not a non-empty array`);
    v.forEach((o, i) => keysExactly(o, keys, `${path}[${i}]`, errs) && each(o, `${path}[${i}]`));
  };
  const fixtureIds = new Set<string>();
  list(m.resolvedParameterDomain, "manifest.resolvedParameterDomain", ["fixtureId", "candidateId", "config"], (o, p) => {
    if (!label(o.fixtureId) || fixtureIds.has(o.fixtureId as string)) errs.push(`${p}.fixtureId: bad or duplicate`);
    fixtureIds.add(o.fixtureId as string);
    if (!label(o.candidateId)) errs.push(`${p}.candidateId: bad label`);
    if (!o.config || typeof o.config !== "object" || Array.isArray(o.config)) errs.push(`${p}.config: not an object`);
    else {
      if ("seed" in o.config) errs.push(`${p}.config: key seed not allowed`);
      for (const e of configKeyErrors(o.config as Record<string, unknown>, pinned)) errs.push(`${p}.config: ${e}`);
      for (const e of validateConfig(defaultConfig({ ...(o.config as Partial<WorldConfig>), seed: 1 }))) errs.push(`${p}.config: ${e}`);
    }
  });
  list(m.habitats, "manifest.habitats", ["fixtureId", "habitatId", "initialArtifactDigest"], (o, p) => {
    if (typeof o.fixtureId !== "string" || !fixtureIds.has(o.fixtureId.split("/")[0])) errs.push(`${p}.fixtureId: unknown fixture`);
    if (!label(o.habitatId)) errs.push(`${p}.habitatId: bad label`);
    if (!isDigest(o.initialArtifactDigest)) errs.push(`${p}.initialArtifactDigest: not a digest`);
  });
  list(m.encodedFounderPanel, "manifest.encodedFounderPanel", ["founderId", "genomeHex"], (o, p) => {
    if (!label(o.founderId)) errs.push(`${p}.founderId: bad label`);
    if (!Array.isArray(o.genomeHex) || !o.genomeHex.every((g) => typeof g === "string" && /^[0-9a-f]+$/.test(g))) errs.push(`${p}.genomeHex: bad`);
  });
  list(m.assayDefinitions, "manifest.assayDefinitions", ["assayId", "fixtureIds"], (o, p) => {
    if (!label(o.assayId)) errs.push(`${p}.assayId: bad label`);
    if (!Array.isArray(o.fixtureIds) || o.fixtureIds.length === 0 || !o.fixtureIds.every((f) => fixtureIds.has(f as string))) errs.push(`${p}.fixtureIds: unknown fixture`);
  });
  const ns = m.seedNamespaces as Record<string, unknown>;
  if (keysExactly(ns, ["name", "first", "last", "blocks"], "manifest.seedNamespaces", errs)) {
    if (!label(ns.name) || !int(ns.first, 1, 0xffffffff) || !int(ns.last, 1, 0xffffffff) || (ns.first as number) > (ns.last as number)) errs.push("manifest.seedNamespaces: bad range");
    const blockIds = new Set<unknown>();
    const blockSeeds = new Set<unknown>();
    list(ns.blocks, "manifest.seedNamespaces.blocks", ["id", "seed"], (o, p) => {
      if (!label(o.id) || blockIds.has(o.id)) errs.push(`${p}.id: bad label or duplicate`);
      if (blockSeeds.has(o.seed)) errs.push(`${p}.seed: duplicate`);
      blockIds.add(o.id);
      blockSeeds.add(o.seed);
      if (!int(o.seed, ns.first as number, ns.last as number)) errs.push(`${p}.seed: outside the namespace`);
    });
  }
  if (typeof m.question !== "string" || typeof m.stoppingRule !== "string") errs.push("manifest: question and stoppingRule must be text");
  return errs;
}

const CASE_KEYS = [
  "schemaVersion", "campaignDigest", "candidateId", "habitatId", "founderId", "assayId", "fixtureId", "blockId", "armId", "physicsSeed", "mutationPolicy",
  "resolvedWorldConfig", "initialArtifactDigest", "steps", "observationSchedule", "requiredBackendContract", "resourceClass",
] as const;

/** Strict structural check of a frozen case spec. */
export function validateCaseSpec(c: unknown): string[] {
  const errs: Errs = [];
  if (!keysExactly(c, CASE_KEYS, "case", errs)) return errs;
  if (c.schemaVersion !== DISCOVERY_SCHEMA) errs.push("case.schemaVersion: bad");
  for (const k of ["campaignDigest", "initialArtifactDigest"]) if (!isDigest(c[k])) errs.push(`case.${k}: not a digest`);
  for (const k of ["candidateId", "habitatId", "founderId", "assayId", "fixtureId", "blockId", "armId"]) if (!label(c[k])) errs.push(`case.${k}: bad label`);
  if (!int(c.physicsSeed, 1, 0xffffffff)) errs.push("case.physicsSeed: bad");
  if (c.mutationPolicy !== "as-configured") errs.push("case.mutationPolicy: bad");
  if (!int(c.steps, 1, 10_000_000)) errs.push("case.steps: bad");
  const cfg = c.resolvedWorldConfig as WorldConfig;
  if (!cfg || typeof cfg !== "object") errs.push("case.resolvedWorldConfig: not an object");
  else {
    for (const e of validateConfig(cfg)) errs.push(`case.resolvedWorldConfig: ${e}`);
    for (const e of configKeyErrors(cfg as unknown as Record<string, unknown>, c.requiredBackendContract === RENEWAL_PIN.backend)) errs.push(`case.resolvedWorldConfig: ${e}`);
    if (cfg.seed !== c.physicsSeed) errs.push("case.resolvedWorldConfig.seed differs from physicsSeed");
  }
  const o = c.observationSchedule as Record<string, unknown>;
  if (keysExactly(o, ["censusEvery", "segmentAt", "sites"], "case.observationSchedule", errs)) {
    if (!int(o.censusEvery, 1, 10_000_000)) errs.push("case.observationSchedule.censusEvery: bad");
    if (!Array.isArray(o.segmentAt) || o.segmentAt.some((x, j, a) => !int(x, 1, (c.steps as number) - 1) || (j > 0 && x <= a[j - 1]))) errs.push("case.observationSchedule.segmentAt: bad");
    if (!Array.isArray(o.sites) || o.sites.some((x) => !keysExactly(x, ["x", "y"], "case.observationSchedule.sites[]", errs) || !int(x.x, 0, 1 << 16) || !int(x.y, 0, 1 << 16))) errs.push("case.observationSchedule.sites: bad");
  }
  if (!BACKEND_CONTRACTS.includes(c.requiredBackendContract as BackendContract)) errs.push("case.requiredBackendContract: unknown");
  if (c.resourceClass !== "small-cpu") errs.push("case.resourceClass: unknown");
  return errs;
}

// ---------------------------------------------------------------------------
// Seeds

/** A reserved seed range from the project registry (docs/plan.md and the workspaces' protocols). */
export interface SeedReservation {
  first: number;
  last: number;
  owner: string;
}

/**
 * Collisions of a campaign's block seeds with each other and with the known
 * registry. Returns human-readable problems; an empty list means the seeds are
 * free to freeze. The campaign's own namespace reservation is skipped by name.
 */
export function seedCollisions(blocks: { id: string; seed: number }[], registry: SeedReservation[], ownNamespace: string): string[] {
  const out: string[] = [];
  const seen = new Map<number, string>();
  for (const b of blocks) {
    const prev = seen.get(b.seed);
    if (prev) out.push(`block ${b.id} reuses seed ${b.seed} of block ${prev}`);
    seen.set(b.seed, b.id);
    for (const r of registry) if (r.owner !== ownNamespace && b.seed >= r.first && b.seed <= r.last) out.push(`block ${b.id} seed ${b.seed} lies in ${r.owner} (${r.first}-${r.last})`);
  }
  return out;
}

/** Physics versions the frozen manifest records and every result is checked against. */
export const PHYSICS_VERSIONS = { ruleVersion: RULE_VERSION, checkpointSchema: SCHEMA_VERSION } as const;
