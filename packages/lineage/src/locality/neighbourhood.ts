// The fixed one-step mutation neighbourhood of a controller (I05, docs/controller-locality-2026-11-01/PLAN.md).
// Pure and integer: the loci, signs and draw indices are a function of (salt, genome id, family, index) alone,
// fixed before any probe or assay outcome exists. `mutateInPlace` from @bl/sim-ref is the only editor, so the
// operator's clamping and its sigma `>>2` rule are the real ones. Observer code: no dynamics are touched.
import { G, GENOME_CHANNELS, NN_BYTES, NN_H, NN_I, NN_O, W2_OFF, B2_OFF, defaultConfig, draw, lowbias32, type WorldConfig } from "@bl/schema";
import { mutateInPlace } from "@bl/sim-ref";
import { locusOf, slotValue, type LocusKind } from "../genotype.ts";

/** Frozen neighbourhood protocol, recorded verbatim in the evidence. */
export const NEIGHBOURHOOD = {
  salt: 0x1c0de05,
  /** The operator's default mutStep: 24 is the single-locus edit that multi-locus edits are matched to. */
  mutStep: 24,
  singleMagnitudes: [6, 24],
  /** Slots sampled per kind for the single-locus family. */
  singleSlots: { w1: 10, b1: 4, w2: 10, b2: 4 },
  /** Matched total |delta| = 24: k slots of per-slot delta 24 / k. */
  multi: [{ k: 2, per: 12 }, { k: 4, per: 6 }],
  /** Secondary family: the same slots and signs with the full 24 on each slot (matched on slot count, not magnitude). */
  multiEqualCount: [{ k: 2, per: 24 }, { k: 4, per: 24 }],
  drawsPerMulti: 8,
} as const;

export type Family = "single6" | "single24" | "multi2" | "multi4" | "multi2x24" | "multi4x24";
export type EditClass = "unchanged" | "boundary-clamped" | "genuine";
export type StratumKind = "w1" | "b1" | "w2" | "b2" | "physics" | "multi";

export interface SlotEdit {
  slot: number;
  kind: LocusKind;
  locus: string;
  /** The delta requested of the operator (what `mutateInPlace` computes from `deltaRnd`). */
  opDelta: number;
  /** The slot delta the operator would apply with no bound: sigma is scaled (`delta >> 2`, at least 1 in magnitude). */
  expected: number;
  before: number;
  after: number;
  applied: number;
  cls: EditClass;
}

export interface Edit {
  id: string;
  family: Family;
  /** Locus kind for single-locus edits, `multi` for multi-locus ones. */
  kind: StratumKind;
  k: number;
  slots: SlotEdit[];
  cls: EditClass;
  requestedL1: number;
  realisedL1: number;
  /** Hash of the edited genome words (PARAM0 on). */
  hash: string;
  /** First earlier edit with the same genome words (or `baseline`), else null. */
  dupOf: string | null;
  /** The negated operator deltas, applied by the same operator in reverse order, give back the original words. */
  undoExact: boolean;
}

export const CTRL_CONFIG: WorldConfig = defaultConfig();

export const strHash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = lowbias32((h ^ s.charCodeAt(i)) >>> 0);
  return h >>> 0;
};

/** Two-chain integer hash of the genome words from PARAM0 on, 16 hex digits. Not cryptographic. */
export function genomeHash(w: Uint32Array): string {
  let a = 0x9e3779b9, b = 0x85ebca6b;
  for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) {
    a = lowbias32((a ^ w[g]) >>> 0);
    b = lowbias32((b + Math.imul(w[g], 0x2545f491) + g) >>> 0);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const sameWords = (a: Uint32Array, b: Uint32Array): boolean => {
  for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) if (a[g] !== b[g]) return false;
  return true;
};

export const kindOfSlot = (slot: number): StratumKind => {
  const k = locusOf(slot).kind;
  return k === "w1" || k === "b1" || k === "w2" || k === "b2" ? k : "physics";
};

/** Slot delta the operator applies absent any bound. */
export const expectedSlotDelta = (slot: number, opDelta: number): number => (slot === NN_BYTES + 1 ? (opDelta >> 2 === 0 ? (opDelta > 0 ? 1 : -1) : opDelta >> 2) : opDelta);

/** Edits `words` in place by the real operator. A requested delta d in [-mutStep, mutStep] \ {0} is reached by deltaRnd = d + mutStep. */
export function applyOperator(words: Uint32Array, slot: number, opDelta: number, cfg: WorldConfig = CTRL_CONFIG): void {
  if (opDelta === 0 || Math.abs(opDelta) > cfg.mutStep) throw new Error(`operator delta ${opDelta} is not reachable with mutStep ${cfg.mutStep}`);
  mutateInPlace(words, 1, 0, cfg, slot, opDelta + cfg.mutStep);
}

export function editFromSlots(base: Uint32Array, id: string, family: Family, kind: StratumKind, req: { slot: number; opDelta: number }[], cfg: WorldConfig = CTRL_CONFIG): { edit: Omit<Edit, "dupOf">; words: Uint32Array } {
  const words = base.slice();
  const slots: SlotEdit[] = req.map(({ slot, opDelta }) => {
    const before = slotValue(words, slot);
    applyOperator(words, slot, opDelta, cfg);
    const after = slotValue(words, slot);
    const expected = expectedSlotDelta(slot, opDelta);
    const applied = after - before;
    const { kind: lk, label } = locusOf(slot);
    return { slot, kind: lk, locus: label, opDelta, expected, before, after, applied, cls: applied === 0 ? "unchanged" : applied === expected ? "genuine" : "boundary-clamped" };
  });
  const changed = !sameWords(words, base);
  const cls: EditClass = !changed ? "unchanged" : slots.every((s) => s.cls === "genuine") ? "genuine" : "boundary-clamped";
  const undo = words.slice();
  for (let i = req.length - 1; i >= 0; i--) applyOperator(undo, req[i].slot, -req[i].opDelta, cfg);
  return {
    words,
    edit: {
      id, family, kind, k: req.length, slots, cls,
      requestedL1: req.reduce((s, r) => s + Math.abs(r.opDelta), 0),
      realisedL1: slots.reduce((s, r) => s + Math.abs(r.applied), 0),
      hash: genomeHash(words),
      undoExact: sameWords(undo, base),
    },
  };
}

/** `count` distinct entries of `pool`, chosen by a partial Fisher-Yates on counter draws. */
function pick(pool: readonly number[], count: number, base: number): number[] {
  const a = pool.slice();
  for (let i = 0; i < count && i < a.length; i++) {
    const j = i + (draw(base, i) % (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(count, a.length));
}

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo }, (_, i) => lo + i);
const KIND_POOL: Record<"w1" | "b1" | "w2" | "b2", number[]> = { w1: range(0, NN_I * NN_H), b1: range(NN_I * NN_H, NN_I * NN_H + NN_H), w2: range(W2_OFF, W2_OFF + NN_H * NN_O), b2: range(B2_OFF, B2_OFF + NN_O) };
const PHYSICS_SLOTS = [NN_BYTES, NN_BYTES + 1, NN_BYTES + 2];

export interface Neighbourhood {
  genomeId: string;
  baseHash: string;
  edits: Edit[];
  /** Genome words of each edit, parallel to `edits`. */
  words: Uint32Array[];
}

/**
 * The neighbourhood of `base`: single-locus edits (per-kind stratified slot sample, two signed magnitudes), the matched-magnitude
 * multi-locus families and the equal-slot-count secondary family. Selection depends on (salt, genomeId, family, index) only.
 */
export function buildNeighbourhood(base: Uint32Array, genomeId: string, cfg: WorldConfig = CTRL_CONFIG): Neighbourhood {
  const N = NEIGHBOURHOOD;
  const gid = strHash(genomeId);
  const key = (tag: string) => lowbias32((N.salt ^ gid ^ strHash(tag)) >>> 0);
  const edits: Edit[] = [];
  const words: Uint32Array[] = [];
  const seen = new Map<string, string>([[genomeHash(base), "baseline"]]);
  const push = (id: string, family: Family, kind: StratumKind, req: { slot: number; opDelta: number }[]) => {
    const { edit, words: w } = editFromSlots(base, id, family, kind, req, cfg);
    edits.push({ ...edit, dupOf: seen.get(edit.hash) ?? null });
    if (!seen.has(edit.hash)) seen.set(edit.hash, id);
    words.push(w);
  };
  const sample: { slot: number; kind: StratumKind }[] = [];
  for (const kind of ["w1", "b1", "w2", "b2"] as const) for (const slot of pick(KIND_POOL[kind], N.singleSlots[kind], key(`loci:${kind}`))) sample.push({ slot, kind });
  for (const slot of PHYSICS_SLOTS) sample.push({ slot, kind: "physics" });
  for (const mag of N.singleMagnitudes) {
    const family: Family = mag === 6 ? "single6" : "single24";
    const sb = key(`sign:${family}`);
    sample.forEach(({ slot, kind }, i) => push(`${family}:${i}`, family, kind, [{ slot, opDelta: (draw(sb, i) & 1 ? 1 : -1) * mag }]));
  }
  const ctrl = range(0, NN_BYTES);
  const multiSlots = (k: number, d: number) => pick(ctrl, k, key(`multi:${k}:${d}`));
  const multiSigns = (k: number, d: number) => Array.from({ length: k }, (_, i) => (draw(key(`msign:${k}:${d}`), i) & 1 ? 1 : -1));
  for (const { k, per } of N.multi) for (let d = 0; d < N.drawsPerMulti; d++) {
    const s = multiSlots(k, d), sg = multiSigns(k, d);
    push(`multi${k}:${d}`, `multi${k}` as Family, "multi", s.map((slot, i) => ({ slot, opDelta: sg[i] * per })));
  }
  for (const { k, per } of N.multiEqualCount) for (let d = 0; d < N.drawsPerMulti; d++) {
    const s = multiSlots(k, d), sg = multiSigns(k, d);
    push(`multi${k}x24:${d}`, `multi${k}x24` as Family, "multi", s.map((slot, i) => ({ slot, opDelta: sg[i] * per })));
  }
  return { genomeId, baseHash: genomeHash(base), edits, words };
}

/** Stratified draw of edits to assay, frozen before any outcome: allocation[stratum] genuine, non-duplicate edits per stratum by counter draws. */
export type Allocation = Record<string, number>;
export const strataKey = (e: Pick<Edit, "family" | "kind">): string => `${e.family}/${e.kind}`;
export function drawAssaySubset(nb: Neighbourhood, allocation: Allocation): { chosen: number[]; strata: Record<string, { population: number; chosen: number }> } {
  const byStratum = new Map<string, number[]>();
  nb.edits.forEach((e, i) => {
    if (e.cls !== "genuine" || e.dupOf !== null) return;
    const k = strataKey(e);
    byStratum.set(k, [...(byStratum.get(k) ?? []), i]);
  });
  const gid = strHash(nb.genomeId);
  const chosen: number[] = [];
  const strata: Record<string, { population: number; chosen: number }> = {};
  for (const k of Object.keys(allocation).sort()) {
    const pool = byStratum.get(k) ?? [];
    const take = pick(pool, allocation[k], lowbias32((NEIGHBOURHOOD.salt ^ gid ^ strHash(`assay:${k}`)) >>> 0));
    chosen.push(...take);
    strata[k] = { population: pool.length, chosen: take.length };
  }
  return { chosen: chosen.sort((a, b) => a - b), strata };
}

export const NN_SENSORS = NN_I;
export const NN_ACTUATORS = NN_O;
export const NN_HIDDEN = NN_H;
