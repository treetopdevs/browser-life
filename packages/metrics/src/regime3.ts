// Regime meters (candidate 8 of the 3D line): the pure part. Pure functions of arrays and job JSON, no GPU, no I/O; they run
// unchanged in browsers and Deno. The normative text is the pre-stated rule (runs/regime/rule-draft.md, to be frozen as
// experiments/3d-slab/regime-rule.md); every section below cites its clauses ("R6.4" and so on). A disagreement between this
// file and the rule is a bug here, never a reason to read the data differently. The plan is
// docs/3d-regime-meters-plan-2026-10-23.md (section 8.1 lists this file).
//
// Conventions (R0)
//  - NA is `null` in every result (JSON-safe), never NaN; a quantity that needs an NA input is NA (a class that needs an NA
//    quantity is `"NA"`); a denominator that is zero is floored at 1 only where a clause says so.
//  - Arithmetic is IEEE doubles, `ln` natural, fits ordinary least squares, the median of an even count is the mean of the
//    two middle values, every band is inclusive at both ends unless a clause says "below" or "above". Comparisons use unrounded
//    values. Count fractions (a tenth of the living blocks, half of the pool, 0.9 of the class-bearing settings, a quarter of
//    the sites) are compared by integer cross-multiplication (`Frac`), so a boundary row is the mathematical comparison and
//    not a rounding accident of `0.1 * x`.
//  - A step index `t` into a counter series means t steps after T; index 0 is the diff pass before step 1. A window mean
//    "at t_c" is the mean over steps max(1, t_c - 5) to min(tmax, t_c + 5) (R6.3, R6.6). Every "n_dec(tau)" of the rule is read
//    as that window mean (resolution W1 in the list below).
//
// Every ambiguity the rule left open is listed here with the reading this file takes, so the main session can settle it before
// the freeze (the same list goes in the builder's report).
//   W1  "n_dec(tau)" is a window mean (steps tau - 5 to tau + 5) everywhere: R6.12 writes Nbar, but R9.0 go/no-go b and R9.2 G7 write n_dec(TAU_DEC) and n_dec(100) (R14 says
//       "a row states the quantity after the window mean"). The F, S and N columns of G7 iii, the N twin's satFrac at 100 and the U twin's coverage at TAU_DEC are window means.
//   W2  DRIFT (R3.7) is read only for a job that was IN_WINDOW at T. A job already CARPET or RELIC at T keeps that flag and is not DRIFT (else every carpet would be DRIFT
//       and have no class, and G3 could never hold). A dead world is DIED_IN_PHASE, not also DRIFT.
//   W3  The stability check of R7.2 (stT >= STABLE, stD) still applies after the FROZEN pairing (frozen ORDERED T-class with CRITICAL D-class), so that pairing can be UNSTABLE.
//   W4  G2 votes (R9.2 "a vote is as in R8.2") need the job IN_WINDOW at T and at T + 1000; G3 ignores the CARPET flag only ("whatever the CARPET flag"). INVALID, extinct,
//       NO_TARGET, DIED_IN_PHASE and DRIFT jobs vote in neither.
//   W5  Bootstrap (R7): only saturation is held at its point value. OVERLAP and speed are per-site quantities and are recomputed over the sites drawn; the floor 1 / (2 m_S)
//       uses the number of sites drawn; n0_S is the mean of the per-site kicked-block counts of the sites drawn (1 under P1).
//   W6  The colony index of the bootstrap is the order of the lowest S-site index in each colony (`siteColonies`); the rule does not order colonies.
//   W7  The F pair's T-class (R9.2 G7 ii) is R6.4 applied without the FEW_COLONIES clause of step 1 (FEW_SITES still gives NA). Read literally, a one-colony world (a carpet;
//       a 2D world at 78 percent living) would give the frozen control an NA class, which counts as failing, and G7 could never hold there.
//   W8  A six-seed setting (R8.5) is a class or SPLIT after the INSUFFICIENT test: the rule gives no DUSTY for it ("else SPLIT").
//   W9  A block's centre is the voxel (8 bx + 4, 8 by + 4) for attribution and reach (R6.2: "its centre" lies between voxels); the GPU diff pass uses the same voxel.
//   W10 AMP-ROBUST (R9.8) means: under the other rung with the selected decider both 2D presets read refClass itself at T1, the first time the 2D references are read (R9.6: "and, if
//       AMP-ROBUST, at the other scale").
//   W11 Stage 0 (R9.0): go/no-go a, b and the threshold trigger are read in every metered Stage 0 job (B0 included) and, for b and c, on the block-net count of the U twin of each
//       rung's bank with that bank's thetaB. A failure of a (the Z twin) is a cause of all four combinations. A failure of b (DUST-FLOOR) and the threshold trigger (b or c: DUST-THRESHOLD)
//       are read per rung's bank and fail only that rung's two combinations (answers G2 and G3 of 2026-10-24; thetaB is never re-derived, so a fired trigger fails a rung instead). A failure
//       of b fires the trigger, so a rung whose U twin covers more than SAT shows both causes. The margin condition is read in the metered G2 and G3 jobs only (B0 is informational), on
//       either side of a threshold, edges inclusive. G5 counts every job passed in.
//   W12 R12.6 says "critical" becomes "in the CRITICAL class at this kick scale" unless refClass is CRITICAL and AMP-ROBUST; for the sentence that names "the critical manifold"
//       that substitution does not parse, so `inferenceSentence` re-casts it ("the boundary of the CRITICAL class at this kick scale").
//   W13 Descriptive only: the genome fingerprint chain starts at 0x9e3779b9 and is h = lowbias32((h ^ word) >>> 0); the Fisher-Yates stream of c_ratio is draw(h0, i); the
//       Hilbert curve is the classic d2xy walk (a covering power-of-two curve with cells outside the grid skipped); a per-site median/IQR at a TAU column uses the stored steps
//       inside the window.
//   W14 The D_ONLY flag marks every job whose T-class is NA (also UNSTABLE ones): R10.5.5 counts "jobs without a trajectory meter".
//   W15 Cause names the rule does not give: INVALID-JOB (G5), G1-REPRO-FAIL (G1), Z-NOT-ZERO (go/no-go a). MARGINAL, DUST-FLOOR and DUST-THRESHOLD are the rule's.
//   W16 The would-be class of a DUSTY setting (R8.2) is the majority over all valid jobs that have a class, whatever their dust state (SPLIT if none holds a majority).
//   W17 `winner`: a class is chosen only if exactly one class reaches the vote threshold (three or six seeds cannot give two).
//   W18 R9.2 G6: a job with no U twin (FEW_SITES, U unavailable, no reading) is dust UNAVAILABLE and a group with no job fails with DUST-CONTROL-UNAVAILABLE.
//   W19 R10: the 31 of TOO-MANY-UNMETERABLE is the number of non-control settings in the table; the control is in no count; an INVALID late job makes the outcome
//       INVALID-RUN (R10.1) before R11 can call it PENDING.
//   W20 R13 prose (the fixed wording and the reading-scale footer) is the readout's job: `decideOutcome` returns the outcome ids of R10/R11 with their payloads, the ranking of R12,
//       and `inferenceSentence` the R12.6 sentences; `fatal` marks INVALID-RUN (the readout exits non-zero).
//   W21 R14 rows 88 and 89 (share3 at rest) run in vitest; row 90 (RefSim3, about 100 s of CPU on a shared Mac) is opt-in (`BL_REGIME_SLOW=1`), and tests/deno/regime_controls.ts
//       runs the GPU twin of it.
//   W22 REFS-DISAGREE (R9.2 G2) is raised only when both presets are internally stable and differ; a preset whose class changes between T1 and T2 gives REF-UNSTABLE
//       alone (R14: "spots-m3 CRITICAL at T1 and CHAOTIC at T2: FAIL REF-UNSTABLE").
//   W23 SAT is compared as a float: satFrac is a window mean of per-step ratios, which no integer cross-multiplication can make exact. A reading at exactly 5 percent depends on
//       the rounding of the mean (the mean of equal values is returned exactly, so a constant series is safe). Defining satFrac as a ratio of window sums in the rule would fix it.
//       The algorithm is the one of `meanExact` (a constant window returns its constant; otherwise a Neumaier sum in step order over the count); R0 states it (build review CX-F12).
//   Added by the build review (docs: runs/regime/review-build/fix-table.md):
//   W24 A gate or Stage 0 evaluation needs the complete roster (R9.0, R9.1): a missing job is the cause INCOMPLETE and fails every combination; G6 counts an absent job as
//       UNAVAILABLE (a group of one CLEAR job and two missing ones fails). The reader refuses an incomplete or unlisted job set before any evaluation (`expectedRoster`).
//   W25 The extension of R8.5 is licensed only when R10 gives UNRESOLVED on seeds 101 to 103, and only for the settings that are SPLIT there (`checkExtension`,
//       `sweepWithExtension`); a started extension must cover every such setting at seeds 104 to 106 before UNRESOLVED-FINAL can be said.
//   W26 The rung files of one gate or Stage 0 job carry one ruleSha, codeCommit and srcHash (reader); a METERED job must carry C1 to C8 and an EXTINCT or NO_TARGET job
//       C2, C4 and C6 (`missingChecks`): an absent check is not a passed check. C1 needs steps 1 to 100 in full and a hash (`checkC1`).
//   W27 The additive margins of R9.0 are the closed intervals between the explicit cuts centre -/+ margin (`marginHits`), so a stability of exactly 0.75 or 0.85 is within the margin.
//   Added by the answers of the main session, 2026-10-24:
//   W28 The 2D reference worlds are read at T1 and T2 only (`refTimes`); T0 is dropped for them because the registered 2D worlds are still filling at 20,000 steps, so a T0 read would make
//       G2 REF-UNDEFINED on a transient (G1). G2, G6, the rosters (Stage 0: 18 jobs, gate: 20) and the amplitude label (at T1) use `refTimes`; the slab jobs are read at T0 as before.
//   W29 When every Delta of the axis ranking is NA (B0 qualifies, no swept axis has a candidate) the outcome is NO-RANKING with reason NO-CANDIDATE, not NO-AXIS: no constant was
//       compared, so the rule cannot say that none moves the meters (G4). B0 not qualifying is NO-RANKING with reason B0, as before.
//   Added by the final review (runs/regime/review-final/fix-table.md; text changes T17 to T19), awaiting the main session's approval:
//   W30 R9.0 Repetition: the first STAGE0-PASS is final, also when the threshold trigger fired in the other rung's bank; a rerun is licensed only after a STAGE0-FAIL (at most
//       STAGE0_RUNS - 1 more times) and declining it closes the candidate. `stage0` is stateless: the run number is the finalizer's, kept in the hand log of R0.2 (D7), and the
//       reader prints the licence (its Next line and the `final` and `rerunsLeft` fields of stage0.json).
//   W31 R9.0 missing evidence: a metered job with no U log in a rung's bank (FEW_SITES: the S twin is not run, hence no U twin) contributes nothing to go/no-go (b), (c) or the trigger in that bank:
//       neither a pass nor a failure (`goNoGo.uEvidence` records which jobs were not read, so the readout does not say "every metered job"). A U log with no block of nonzero
//       difference has coverage 0 and no median (NA), which does not fire (c). A present U log is read even when its dose makes the job's dust state UNAVAILABLE.
//   W32 R5 at Stage 0: an INVALID job is the cause INVALID-JOB of every combination (G5; a failed C1 is also go/no-go (a), Z-NOT-ZERO), the run counts toward the three and the readout
//       exits 0; the jobs of a Stage 0 run are not compared with one another for stamps (`validateRun` ignores dev jobs) but the rung files of one job must agree (the reader's C6).
//
// The canonical job-JSON contract is the set of interfaces below (`RegimeJob`, `TwinBank`, `DiffLog`, `SiteLog`, `JobSummary`).
// Layers: (1) arrays -> numbers (scale, sites, colonies, kicks, block counters, fits, entropy, divergence); (2) one bank of
// twins -> one reading of a job (`analyzeBank`); (3) readings -> settings, gate, Stage 0, outcomes, late check, ranking.

import { CELL_CHANNELS, CH, draw, lowbias32 } from "@bl/schema";
import { compressionRatio } from "./complexity.ts";
import { linearFit } from "./stats.ts";

// =====================================================================================================================
// R1 Constants

/** An exact fraction `num / den` of a count. Compare with `fracCmp`; never multiply a float by it. */
export interface Frac {
  readonly num: number;
  readonly den: number;
}

/**
 * The constants of R1. Every function that decides something takes `c: RegimeConstants = REGIME`, so the sensitivity table
 * (R13) re-runs the same code with a constant moved. RUNG and DECIDER are not constants here: the finalizer's Stage 0 selection
 * is passed as a `Combination` wherever it matters.
 */
export interface RegimeConstants {
  /** Burn-in steps: the slab jobs (T0); the late check and the first read of the 2D reference worlds (T1); the second read of the 2D references (T2). The 2D references are not read at T0 (R1, R9). */
  readonly T0: number;
  readonly T1: number;
  readonly T2: number;
  /** Livable window `WINDOW_LO <= f < WINDOW_HI` of the living fraction (R3). */
  readonly WINDOW_LO: number;
  readonly WINDOW_HI: number;
  /** k = max(K_MIN, floor(B* / 2)) (R4.1). */
  readonly K_MIN: number;
  /** Fewest eligible voxels for a target (R3). */
  readonly NE_MIN: number;
  /** A block is damaged under the occupancy decider if at least OCC_V voxels have |dB| >= thetaV (R6). */
  readonly OCC_V: number;
  /** S sites wanted, their separation in voxels, fewest sites, fewest colonies, candidate draws (R4.4). */
  readonly M_S: number;
  readonly D_SEP: number;
  readonly M_S_MIN: number;
  readonly M_COL_MIN: number;
  readonly SITE_TRIES: number;
  /** Doses (kicked voxels) and the dose cap: a dose is run if its kicked blocks are at most DOSE_CAP of the living blocks (R4.5). */
  readonly DOSES: readonly number[];
  readonly DOSE_CAP: Frac;
  /** Steps a dose twin, U and N run (R2.6), and the S twin and R run. */
  readonly DOSE_STEPS: number;
  readonly TRAJ_STEPS: number;
  /** Response-ratio columns and the deciding step (R6.6, R6.7, R6.12). */
  readonly TAU: readonly number[];
  readonly TAU_DEC: number;
  /** Trajectory grid and the half-width of its window (R6.3). */
  readonly TRAJ: readonly number[];
  readonly WIN_HALF: number;
  /** ORDERED below ORD_R at step 1000 (R6.4); the exponent band (R6.4). */
  readonly ORD_R: number;
  readonly B_LO: number;
  readonly B_HI: number;
  /** Saturation: coverage SAT of the living blocks and a per-site multiplication of at least R_AMP (R6.3). */
  readonly SAT: number;
  readonly R_AMP: number;
  /** Voxels per step below which a persistent damage count is a FROZEN scar (R6.11): one block over steps 100 to 1000. */
  readonly SPEED_MIN: number;
  /** Unit-kick control: divisor, clear/limited lines, largest U dose as a fraction of the S dose (R4.8, R6.12). */
  readonly U_DIV: number;
  readonly DUST_CLEAR: number;
  readonly DUST_LIM: number;
  readonly U_MAX: Frac;
  /** Derrida window (R6.7). */
  readonly D_LO: number;
  readonly D_HI: number;
  /** A site is spread at reach >= OVERLAP_REACH voxels; the job overlaps if more than OVERLAP_FRAC of the sites are (R6.5). */
  readonly OVERLAP_REACH: number;
  readonly OVERLAP_FRAC: Frac;
  /** Bootstrap resamples and the stability line (R7). */
  readonly BOOT: number;
  readonly STABLE: number;
  /** Floor of s(TAU_DEC) before the logarithm (R8.4). */
  readonly S_FLOOR: number;
  /** Votes needed of 3 seeds; of 6 seeds (with at least VOTE_EXT_MIN voting) (R8.2, R8.5). */
  readonly VOTE: number;
  readonly VOTE_EXT: number;
  readonly VOTE_EXT_MIN: number;
  /** Fractions of R10. */
  readonly UNMET_FRAC: Frac;
  readonly UNRES_FRAC: Frac;
  readonly SENS_FRAC: Frac;
  readonly SUPPORT_FRAC: Frac;
  readonly POOL_MIN: number;
  readonly AXES_MIN: number;
  readonly NO_CONTRAST: Frac;
  /** Most settings re-burnt to T1 (R11). */
  readonly LATE_MAX: number;
  /** Axis ranking: smallest Delta (ln units) and the tie band (R12). */
  readonly NO_AXIS: number;
  readonly TIE: number;
  /** Stage 0 margins (R9.0). */
  readonly MARGIN_RATIO: number;
  readonly MARGIN_S: number;
  readonly MARGIN_ST: number;
  /** Stage 0 runs allowed (R9.0). */
  readonly STAGE0_RUNS: number;
  /** Quantisation edges of the entropy symbols and the time lag of the space-time estimator (R6.9). */
  readonly ENT_EDGES: readonly number[];
  readonly ENT_LAG: number;
}

export const REGIME: RegimeConstants = Object.freeze({
  T0: 20_000,
  T1: 50_000,
  T2: 100_000,
  WINDOW_LO: 0.01,
  WINDOW_HI: 0.85,
  K_MIN: 12,
  NE_MIN: 64,
  OCC_V: 8,
  M_S: 16,
  D_SEP: 40,
  M_S_MIN: 6,
  M_COL_MIN: 2,
  SITE_TRIES: 4096,
  DOSES: Object.freeze([4, 8, 16, 32, 64]),
  DOSE_CAP: Object.freeze({ num: 1, den: 10 }),
  DOSE_STEPS: 300,
  TRAJ_STEPS: 1000,
  TAU: Object.freeze([30, 100, 300]),
  TAU_DEC: 30,
  TRAJ: Object.freeze([100, 139, 193, 268, 373, 518, 720, 1000]),
  WIN_HALF: 5,
  ORD_R: 0.1,
  B_LO: -0.5,
  B_HI: 0.5,
  SAT: 0.05,
  R_AMP: 2.0,
  SPEED_MIN: 8 / 900,
  U_DIV: 8,
  DUST_CLEAR: 0.25,
  DUST_LIM: 0.5,
  U_MAX: Object.freeze({ num: 1, den: 4 }),
  D_LO: 0.5,
  D_HI: 2.0,
  OVERLAP_REACH: 20,
  OVERLAP_FRAC: Object.freeze({ num: 1, den: 4 }),
  BOOT: 1000,
  STABLE: 0.8,
  S_FLOOR: 0.01,
  VOTE: 2,
  VOTE_EXT: 4,
  VOTE_EXT_MIN: 5,
  UNMET_FRAC: Object.freeze({ num: 1, den: 2 }),
  UNRES_FRAC: Object.freeze({ num: 1, den: 2 }),
  SENS_FRAC: Object.freeze({ num: 1, den: 2 }),
  SUPPORT_FRAC: Object.freeze({ num: 1, den: 2 }),
  POOL_MIN: 8,
  AXES_MIN: 3,
  NO_CONTRAST: Object.freeze({ num: 9, den: 10 }),
  LATE_MAX: 6,
  NO_AXIS: 0.35,
  TIE: 0.1,
  MARGIN_RATIO: 0.1,
  MARGIN_S: 1.25,
  MARGIN_ST: 0.05,
  STAGE0_RUNS: 3,
  ENT_EDGES: Object.freeze([1, 4, 16]),
  ENT_LAG: 100,
});

/** Block edge in columns (R6; a block is 8 x 8 columns by all layers). Not overridable: it is the instrument's resolution. */
export const BLOCK = 8;

/** Seeds (R1): the gate and the sweep 101 to 103, the extension 104 to 106, development (Stage 0) 9001 to 9003; seeds 1 to 6 are never used. */
export const SEEDS = Object.freeze({
  main: Object.freeze([101, 102, 103]),
  extension: Object.freeze([104, 105, 106]),
  dev: Object.freeze([9001, 9002, 9003]),
});

/** R4.10: the seed of the noise-swapped control, `lowbias32((seed ^ 0x4e4e4e4e) >>> 0)`. */
export const noiseSeed = (seed: number): number => lowbias32((seed ^ 0x4e4e4e4e) >>> 0);

// ---------------------------------------------------------------------------------------------------------------------
// Names

export type Rung = "P1" | "P2";
export type Decider = "net" | "occ";
export interface Combination {
  readonly rung: Rung;
  readonly decider: Decider;
}
export type ComboKey = "P1-net" | "P1-occ" | "P2-net" | "P2-occ";
/** The four combinations in Stage 0's fixed order (R9.0). */
export const COMBINATIONS: readonly Combination[] = Object.freeze([
  Object.freeze({ rung: "P1", decider: "net" }),
  Object.freeze({ rung: "P1", decider: "occ" }),
  Object.freeze({ rung: "P2", decider: "net" }),
  Object.freeze({ rung: "P2", decider: "occ" }),
] as const);
export const comboKey = (c: Combination): ComboKey => `${c.rung}-${c.decider}`;
export const comboOf = (k: ComboKey): Combination => ({ rung: k.slice(0, 2) as Rung, decider: k.slice(3) as Decider });
export const comboLabel = (c: Combination): string => `(${c.rung}, ${c.decider})`;

/** The three response classes (R0 Names): finite-amplitude, same-noise, block-scale; never the infinitesimal-slope phases. */
export type RegimeClass = "ORDERED" | "CRITICAL" | "CHAOTIC";
export const REGIME_CLASSES: readonly RegimeClass[] = Object.freeze(["ORDERED", "CRITICAL", "CHAOTIC"] as const);
/** The trajectory class: `"NA"` when the trajectory meter is unavailable (R6.4 steps 1 and 3). */
export type TClass = RegimeClass | "NA";
/** Job class (R7): the three classes, or MIXED (the meters disagree) or UNSTABLE (they agree, a stability check fails). */
export type JobClass = RegimeClass | "MIXED" | "UNSTABLE";
export type DustState = "CLEAR" | "AMBIG" | "LIMITED" | "UNAVAILABLE";
export type GrowthForm = "decays" | "frozen" | "saturating" | "exponential" | "cone" | "super-cone" | "flat";
export const isRegimeClass = (x: unknown): x is RegimeClass => x === "ORDERED" || x === "CRITICAL" || x === "CHAOTIC";

// =====================================================================================================================
// Primitives

export const isNum = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** Sign of `a / b - f`, exactly (integers): `a * f.den - b * f.num`. `b` may be 0 (then the sign is that of `a`). */
export function fracCmp(a: number, b: number, f: Frac): number {
  const d = a * f.den - b * f.num;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}
/** `a / b >= f`, `> f`, `<= f`, `< f` by integer cross-multiplication. */
export const fracGE = (a: number, b: number, f: Frac): boolean => fracCmp(a, b, f) >= 0;
export const fracGT = (a: number, b: number, f: Frac): boolean => fracCmp(a, b, f) > 0;
export const fracLE = (a: number, b: number, f: Frac): boolean => fracCmp(a, b, f) <= 0;
export const fracLT = (a: number, b: number, f: Frac): boolean => fracCmp(a, b, f) < 0;
export const fracValue = (f: Frac): number => f.num / f.den;

/** Median of a list (the mean of the two middle values for an even count); null for an empty list. */
export function median(xs: ArrayLike<number>): number | null {
  const n = xs.length;
  if (n === 0) return null;
  const s = Array.from(xs).sort((a, b) => a - b);
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Lower median: ascending order, element floor((n - 1) / 2) (R4.1's B*). Null for an empty list. */
export function lowerMedian(xs: ArrayLike<number>): number | null {
  const n = xs.length;
  if (n === 0) return null;
  const s = Array.from(xs).sort((a, b) => a - b);
  return s[Math.floor((n - 1) / 2)];
}

/** Inter-quartile range by linear interpolation between order statistics (descriptive columns only). */
export function iqr(xs: ArrayLike<number>): number | null {
  const n = xs.length;
  if (n === 0) return null;
  const s = Array.from(xs).sort((a, b) => a - b);
  const q = (p: number) => {
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    return s[lo] + (s[Math.min(n - 1, lo + 1)] - s[lo]) * (h - lo);
  };
  return q(0.75) - q(0.25);
}

/**
 * Mean of `xs[lo..hi]`. If every value is equal the value itself is returned (a constant series has exactly its constant as
 * mean, with no rounding of `n * x / n`); otherwise the compensated (Neumaier) sum over the count. Null for an empty range.
 */
export function meanExact(xs: ArrayLike<number>, lo = 0, hi = xs.length - 1): number | null {
  if (hi < lo || lo < 0 || hi >= xs.length) return null;
  const first = xs[lo];
  let same = true;
  for (let i = lo + 1; i <= hi; i++) if (xs[i] !== first) { same = false; break; }
  if (same) return first;
  let sum = 0;
  let comp = 0;
  for (let i = lo; i <= hi; i++) {
    const x = xs[i];
    const t = sum + x;
    comp += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
    sum = t;
  }
  return (sum + comp) / (hi - lo + 1);
}

/** The steps a window at `tc` covers: `max(1, tc - half)` to `min(tmax, tc + half)` (R6.3, R6.6). */
export function windowBounds(tc: number, tmax: number, half = REGIME.WIN_HALF): [number, number] {
  return [Math.max(1, tc - half), Math.min(tmax, tc + half)];
}

/** Window mean of a per-step series (index = step) at `tc`; the window is clipped at 1 and at `tmax` (default: the series end). */
export function windowMean(series: ArrayLike<number>, tc: number, tmax = series.length - 1, half = REGIME.WIN_HALF): number | null {
  const [lo, hi] = windowBounds(tc, Math.min(tmax, series.length - 1), half);
  return hi < lo ? null : meanExact(series, lo, hi);
}

/**
 * Window mean of a per-step ratio `num[t] / max(den[t], 1)` (satFrac of R6.3): the mean of the ratios, not the ratio of the
 * means. The denominator is floored at 1 (R0).
 */
export function windowMeanRatio(num: ArrayLike<number>, den: ArrayLike<number>, tc: number, tmax = num.length - 1, half = REGIME.WIN_HALF): number | null {
  const [lo, hi] = windowBounds(tc, Math.min(tmax, num.length - 1, den.length - 1), half);
  if (hi < lo) return null;
  const v: number[] = [];
  for (let t = lo; t <= hi; t++) v.push(num[t] / Math.max(den[t], 1));
  return meanExact(v);
}

/** Window mean over the stored steps that fall inside the window (a per-site series is stored at a subset of the steps). */
export function windowMeanStored(steps: ArrayLike<number>, values: ArrayLike<number>, tc: number, tmax: number, half = REGIME.WIN_HALF): number | null {
  const [lo, hi] = windowBounds(tc, tmax, half);
  const v: number[] = [];
  for (let i = 0; i < steps.length; i++) if (steps[i] >= lo && steps[i] <= hi) v.push(values[i]);
  return v.length ? meanExact(v) : null;
}

/** The steps a per-site log must hold (R6.5): every step of the eight grid windows and every 10th step to 1000. */
export function storedSteps(c: RegimeConstants = REGIME): number[] {
  const s = new Set<number>();
  for (const tc of c.TRAJ) {
    const [lo, hi] = windowBounds(tc, c.TRAJ_STEPS, c.WIN_HALF);
    for (let t = lo; t <= hi; t++) s.add(t);
  }
  for (let t = 10; t <= c.TRAJ_STEPS; t += 10) s.add(t);
  return [...s].sort((a, b) => a - b);
}

/** Natural-log OLS of y on x; null with fewer than 3 points (R6.3). Reuses the package's `linearFit`. */
export function olsSlope(x: readonly number[], y: readonly number[]): { slope: number; sse: number } | null {
  if (x.length < 3) return null;
  const f = linearFit(x as number[], y as number[]);
  return { slope: f.slope, sse: f.sse };
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry (voxel index v = (z * H + y) * W + x; blocks are 8 x 8 columns by all layers)

export interface Geom {
  readonly W: number;
  readonly H: number;
  /** Layers: 8 for the slab, 1 for a 2D world. */
  readonly D: number;
}
export const SLAB_GEOM: Geom = Object.freeze({ W: 256, H: 256, D: 8 });
export const GEOM_2D: Geom = Object.freeze({ W: 256, H: 256, D: 1 });

export const voxelCount = (g: Geom): number => g.W * g.H * g.D;
export const columnCount = (g: Geom): number => g.W * g.H;
export const blocksAlong = (g: Geom): [number, number] => [Math.floor(g.W / BLOCK), Math.floor(g.H / BLOCK)];
export const blockCount = (g: Geom): number => Math.floor(g.W / BLOCK) * Math.floor(g.H / BLOCK);
export const voxelX = (v: number, g: Geom): number => v % g.W;
export const voxelY = (v: number, g: Geom): number => Math.floor(v / g.W) % g.H;
export const voxelZ = (v: number, g: Geom): number => Math.floor(v / (g.W * g.H));
export const voxelAt = (x: number, y: number, z: number, g: Geom): number => (z * g.H + y) * g.W + x;
/** Id of the block holding the column (x, y). */
export const blockOfXY = (x: number, y: number, g: Geom): number => Math.floor(y / BLOCK) * Math.floor(g.W / BLOCK) + Math.floor(x / BLOCK);
export const blockOfVoxel = (v: number, g: Geom): number => blockOfXY(voxelX(v, g), voxelY(v, g), g);

/** Horizontal Chebyshev distance on the torus between two voxels (x and y wrap, z ignored) (R4.4). */
export function torusChebyshev(a: number, b: number, g: Geom): number {
  const dx = Math.abs(voxelX(a, g) - voxelX(b, g));
  const dy = Math.abs(voxelY(a, g) - voxelY(b, g));
  return Math.max(Math.min(dx, g.W - dx), Math.min(dy, g.H - dy));
}

/**
 * The voxel taken as a block's centre for attribution and reach (R6.2): (8 bx + 4, 8 by + 4). The rule says "its centre"; the
 * geometric centre of 8 columns lies between two voxels, so one voxel is fixed (resolution W9; the GPU kernel uses the same).
 */
export function blockCentre(block: number, g: Geom): [number, number] {
  const bw = Math.floor(g.W / BLOCK);
  return [(block % bw) * BLOCK + BLOCK / 2, Math.floor(block / bw) * BLOCK + BLOCK / 2];
}

/** Chebyshev torus distance in voxels between a block's centre (R6.2) and a site voxel. */
export function blockSiteDistance(block: number, site: number, g: Geom): number {
  const [cx, cy] = blockCentre(block, g);
  const dx = Math.abs(cx - voxelX(site, g));
  const dy = Math.abs(cy - voxelY(site, g));
  return Math.max(Math.min(dx, g.W - dx), Math.min(dy, g.H - dy));
}

/** The S site nearest to a block's centre (R6.2): index into `sites`, ties to the lower index; -1 with no sites. */
export function nearestSite(block: number, sites: ArrayLike<number>, g: Geom): { site: number; distance: number } {
  let best = -1;
  let bd = Infinity;
  for (let j = 0; j < sites.length; j++) {
    const d = blockSiteDistance(block, sites[j], g);
    if (d < bd) { bd = d; best = j; }
  }
  return { site: best, distance: best < 0 ? 0 : bd };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hilbert order (R6.9 c_ratio): the classic d2xy walk of a curve of side 2^order

export function hilbertXY(order: number, d: number): [number, number] {
  let x = 0;
  let y = 0;
  let t = d;
  for (let s = 1; s < 2 ** order; s *= 2) {
    const rx = 1 & Math.floor(t / 2);
    const ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

/** Column indices (y * W + x) of a W x H grid in Hilbert order (the curve of the smallest power-of-two side that covers it, cells outside skipped). */
export function hilbertOrder(W: number, H: number): Uint32Array {
  let order = 0;
  while (2 ** order < Math.max(W, H)) order++;
  const out = new Uint32Array(W * H);
  let k = 0;
  for (let d = 0; d < 4 ** order; d++) {
    const [x, y] = hilbertXY(order, d);
    if (x < W && y < H) out[k++] = y * W + x;
  }
  return out;
}

// =====================================================================================================================
// R3 Start-state statuses

export type WindowFlag = "IN_WINDOW" | "CARPET" | "RELIC";

/** The livable window of the living fraction f at a time (R3): CARPET at f >= 0.85, RELIC below 0.01, else IN_WINDOW. */
export function windowFlag(f: number, c: RegimeConstants = REGIME): WindowFlag {
  if (f >= c.WINDOW_HI) return "CARPET";
  if (f < c.WINDOW_LO) return "RELIC";
  return "IN_WINDOW";
}

export type StartStatus = "EXTINCT" | "NO_TARGET" | "METERED";

/**
 * R3 items 1 to 3. EXTINCT if the world died before T; NO_TARGET if there are fewer than NE_MIN eligible voxels, including the
 * case that no voxel holds B >= 1 (B* is NA, N_E = 0); otherwise METERED with the window flag of f at T.
 */
export function startState(i: { extinct: boolean; Bstar: number | null; NE: number; f: number }, c: RegimeConstants = REGIME): { status: StartStatus; flag: WindowFlag | null } {
  if (i.extinct) return { status: "EXTINCT", flag: null };
  if (i.Bstar === null || i.NE < c.NE_MIN) return { status: "NO_TARGET", flag: null };
  return { status: "METERED", flag: windowFlag(i.f, c) };
}

/** FEW_SITES: fewer than M_S_MIN sites placed (the S and U twins are not run). */
export const fewSites = (mS: number, c: RegimeConstants = REGIME): boolean => mS < c.M_S_MIN;
/** FEW_COLONIES: enough sites but they lie in fewer than M_COL_MIN colonies (the trajectory class is NA). */
export const fewColonies = (mS: number, nCol: number, c: RegimeConstants = REGIME): boolean => mS >= c.M_S_MIN && nCol < c.M_COL_MIN;

/**
 * R3 items 6 and 7, from the reference's living count at every step of the twin phase (`liveR`, the diff log's live_R) and the
 * living fraction read at T + 1000. DIED_IN_PHASE if live_R is 0 at any step. DRIFT if the job was IN_WINDOW at T and f leaves the
 * window by T + 1000 (a job already outside the window at T keeps its CARPET or RELIC flag and is not DRIFT: resolution W2).
 * A dead world is DIED_IN_PHASE and not also DRIFT.
 */
export function phaseState(i: { liveR: ArrayLike<number>; fEnd: number; startFlag: WindowFlag | null }, c: RegimeConstants = REGIME): { diedInPhase: boolean; drift: boolean } {
  let died = false;
  for (let t = 0; t < i.liveR.length; t++) if (i.liveR[t] === 0) { died = true; break; }
  const drift = !died && i.startFlag === "IN_WINDOW" && windowFlag(i.fEnd, c) !== "IN_WINDOW";
  return { diedInPhase: died, drift };
}

// =====================================================================================================================
// R4 Scale, sites, the kick

export interface ScaleResult {
  /** B*: lower median of B over the voxels with B >= 1 (null when no voxel has B >= 1). */
  Bstar: number | null;
  k: number | null;
  thetaB: number | null;
  thetaV: number | null;
  /** Eligible voxels (B >= k + 1), ascending index (R4.2). */
  E: Uint32Array;
  NE: number;
}

/** k, the block threshold and the voxel threshold from B* (R4.1): k = max(12, floor(B* / 2)), thetaB = ceil(k / 2), thetaV = max(2, ceil(k / 4)). */
export function scaleFromBstar(Bstar: number, c: RegimeConstants = REGIME): { k: number; thetaB: number; thetaV: number } {
  const k = Math.max(c.K_MIN, Math.floor(Bstar / 2));
  return { k, thetaB: Math.ceil(k / 2), thetaV: Math.max(2, Math.ceil(k / 4)) };
}

/** R4.1 and R4.2 from the B channel of the reference at T. */
export function scaleOf(B: ArrayLike<number>, c: RegimeConstants = REGIME): ScaleResult {
  let cnt = 0;
  for (let i = 0; i < B.length; i++) if (B[i] >= 1) cnt++;
  if (cnt === 0) return { Bstar: null, k: null, thetaB: null, thetaV: null, E: new Uint32Array(0), NE: 0 };
  const vals = new Uint32Array(cnt);
  let j = 0;
  for (let i = 0; i < B.length; i++) if (B[i] >= 1) vals[j++] = B[i];
  vals.sort();
  const Bstar = vals[Math.floor((cnt - 1) / 2)];
  const { k, thetaB, thetaV } = scaleFromBstar(Bstar, c);
  let ne = 0;
  for (let i = 0; i < B.length; i++) if (B[i] >= k + 1) ne++;
  const E = new Uint32Array(ne);
  j = 0;
  for (let i = 0; i < B.length; i++) if (B[i] >= k + 1) E[j++] = i;
  return { Bstar, k, thetaB, thetaV, E, NE: ne };
}

/** R4.3: the selection stream `h0 = lowbias32((imul(seed, 7919) ^ T) >>> 0)`. */
export function selectionSeed(seed: number, T: number): number {
  return lowbias32((Math.imul(seed, 7919) ^ T) >>> 0);
}

/**
 * R4.4: for j = 0 .. SITE_TRIES - 1, c = draw(h0, j) % N_E; the voxel E[c] is accepted if its horizontal Chebyshev torus distance to
 * every accepted site is at least D_SEP; stop at M_S accepted. Returns the accepted voxels in acceptance order (site index j).
 */
export function placeSites(E: ArrayLike<number>, g: Geom, h0: number, c: RegimeConstants = REGIME): number[] {
  const ne = E.length;
  const sites: number[] = [];
  if (ne === 0) return sites;
  for (let j = 0; j < c.SITE_TRIES && sites.length < c.M_S; j++) {
    const v = E[draw(h0, j) % ne];
    let ok = true;
    for (const s of sites) if (torusChebyshev(s, v, g) < c.D_SEP) { ok = false; break; }
    if (ok) sites.push(v);
  }
  return sites;
}

/** The key of R4.5: `lowbias32((v ^ h0) >>> 0)`. */
export const doseKey = (v: number, h0: number): number => lowbias32((v ^ h0) >>> 0);

/**
 * R4.5: the first `count` voxels of E sorted by `doseKey` ascending (ties by index), so the kicked set of dose m is the first m
 * entries and doses are nested. E is ascending, so a tie cannot occur (the key is a bijection of v), but the order is stated.
 */
export function keyedPrefix(E: ArrayLike<number>, h0: number, count: number): number[] {
  const keys: number[] = [];
  const vox: number[] = [];
  for (let i = 0; i < E.length; i++) {
    const v = E[i];
    const key = doseKey(v, h0);
    if (keys.length === count) {
      const wk = keys[count - 1];
      if (key > wk || (key === wk && v > vox[count - 1])) continue;
    }
    let p = keys.length;
    while (p > 0 && (keys[p - 1] > key || (keys[p - 1] === key && vox[p - 1] > v))) p--;
    keys.splice(p, 0, key);
    vox.splice(p, 0, v);
    if (keys.length > count) { keys.pop(); vox.pop(); }
  }
  return vox;
}

/** Ascending distinct ids of the blocks that hold any of the given voxels. */
export function kickedBlockIds(voxels: ArrayLike<number>, g: Geom): number[] {
  const s = new Set<number>();
  for (let i = 0; i < voxels.length; i++) s.add(blockOfVoxel(voxels[i], g));
  return [...s].sort((a, b) => a - b);
}

/** R4.5: a dose of `m` kicked voxels is run if m <= N_E / 2 and its kicked blocks n0 are at most DOSE_CAP of the living blocks. */
export function doseIsRun(m: number, NE: number, n0: number, liveblk: number, c: RegimeConstants = REGIME): boolean {
  return 2 * m <= NE && fracLE(n0, liveblk, c.DOSE_CAP);
}

export interface DoseRow {
  m: number;
  /** Blocks that hold a voxel of the dose's kicked set (decider-independent, computed on the CPU before any twin is built). */
  n0: number;
  run: boolean;
}

/** The dose table of R4.5: `n0Of(m)` gives the kicked-block count of dose m (P1: blocks of the first m keyed voxels; P2: of the union of m balls). */
export function doseTable(NE: number, liveblk: number, n0Of: (m: number) => number, c: RegimeConstants = REGIME): { doses: DoseRow[]; origin: number[] } {
  const doses = c.DOSES.map((m): DoseRow => {
    const n0 = n0Of(m);
    return { m, n0, run: doseIsRun(m, NE, n0, liveblk, c) };
  });
  return { doses, origin: doses.filter((d) => d.run).map((d) => d.m) };
}

/** FEW_DOSES (R3.5): the origin set holds fewer than 2 doses. */
export const fewDoses = (originSize: number): boolean => originSize < 2;

// ---------------------------------------------------------------------------------------------------------------------
// Colonies (R4.4)

/** One flag per column: the column holds a living voxel (B + P > 0) in the reference at T. */
export function livingColumns(B: ArrayLike<number>, P: ArrayLike<number>, g: Geom): Uint8Array {
  const wh = columnCount(g);
  const out = new Uint8Array(wh);
  for (let z = 0; z < g.D; z++) {
    const o = z * wh;
    for (let i = 0; i < wh; i++) if (B[o + i] + P[o + i] > 0) out[i] = 1;
  }
  return out;
}

export interface ColonyLabels {
  /** Per column: component id (0, 1, ... in scan order of each component's first column), or -1 if the column is not living. */
  labels: Int32Array;
  count: number;
  /** Columns per component. */
  sizes: number[];
}

/** Connected components of living columns, 4-neighbourhood, x and y wrap (R4.4). */
export function colonyLabels(living: ArrayLike<number>, g: Geom): ColonyLabels {
  const wh = columnCount(g);
  const labels = new Int32Array(wh).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(wh);
  let count = 0;
  for (let s = 0; s < wh; s++) {
    if (!living[s] || labels[s] >= 0) continue;
    let top = 0;
    stack[top++] = s;
    labels[s] = count;
    let size = 0;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % g.W;
      const y = (i - x) / g.W;
      const nb = [y * g.W + ((x + 1) % g.W), y * g.W + ((x + g.W - 1) % g.W), ((y + 1) % g.H) * g.W + x, ((y + g.H - 1) % g.H) * g.W + x];
      for (const j of nb) if (living[j] && labels[j] < 0) { labels[j] = count; stack[top++] = j; }
    }
    sizes.push(size);
    count++;
  }
  return { labels, count, sizes };
}

export interface SiteColonies {
  /** Per site: its colony's index among the colonies that hold a site (0 .. nCol - 1, in order of the lowest site index). */
  colonyOfSite: number[];
  /** Per colony: the S-site indices it holds, ascending. This order is the bootstrap's colony order (resolution W6). */
  colonies: number[][];
  nCol: number;
}

/** A site belongs to the colony of its column; n_col counts the colonies that hold at least one site (R4.4). */
export function siteColonies(sites: ArrayLike<number>, labels: ArrayLike<number>, g: Geom): SiteColonies {
  const index = new Map<number, number>();
  const colonies: number[][] = [];
  const colonyOfSite: number[] = [];
  for (let j = 0; j < sites.length; j++) {
    const v = sites[j];
    const lab = labels[voxelY(v, g) * g.W + voxelX(v, g)];
    let ci = index.get(lab);
    if (ci === undefined) { ci = colonies.length; index.set(lab, ci); colonies.push([]); }
    colonies[ci].push(j);
    colonyOfSite.push(ci);
  }
  return { colonyOfSite, colonies, nCol: colonies.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Kicks (R4.6, R4.8, R4.9)

/**
 * A perturbation: voxels that lose `amounts` of B to C. A voxel appears once (the union rule), so no voxel is kicked twice and the
 * unsigned B channel cannot underflow. Same shape as the GPU module's kick set.
 */
export interface KickPlan {
  /** Kicked voxels, strictly ascending. */
  voxels: Uint32Array;
  /** B-to-C amount at each kicked voxel, at least 1. */
  amounts: Uint32Array;
  /** Sum of the amounts: the dose of R4.8. */
  total: number;
  /** Ascending ids of the blocks that hold a kicked voxel; `n0` is their number (R6.3). */
  blocks: Uint32Array;
  /** The sum of the amounts in each of those blocks: the block's net difference at step 0 (C5). */
  blockSums: Uint32Array;
}

function buildKickPlan(pairs: Map<number, number>, g: Geom): KickPlan {
  const vox = [...pairs.keys()].sort((a, b) => a - b);
  const voxels = Uint32Array.from(vox);
  const amounts = Uint32Array.from(vox, (v) => pairs.get(v)!);
  const perBlock = new Map<number, number>();
  let total = 0;
  for (let j = 0; j < voxels.length; j++) {
    total += amounts[j];
    const b = blockOfVoxel(voxels[j], g);
    perBlock.set(b, (perBlock.get(b) ?? 0) + amounts[j]);
  }
  const ids = [...perBlock.keys()].sort((a, b) => a - b);
  return { voxels, amounts, total, blocks: Uint32Array.from(ids), blockSums: Uint32Array.from(ids, (b) => perBlock.get(b)!) };
}

/** Rung P1 (R4.6): `k` units of B to C at each site. A site needs B >= k + 1 (the voxel stays living) and may be listed once. */
export function kickPlanP1(B: ArrayLike<number>, sites: ArrayLike<number>, k: number, g: Geom): KickPlan {
  if (!Number.isInteger(k) || k < 1) throw new Error(`kickPlanP1: k = ${k} is not a positive integer`);
  const pairs = new Map<number, number>();
  for (let j = 0; j < sites.length; j++) {
    const v = sites[j];
    if (pairs.has(v)) throw new Error(`kickPlanP1: voxel ${v} is listed twice`);
    if (B[v] < k + 1) throw new Error(`kickPlanP1: voxel ${v} holds B = ${B[v]}; a site needs B >= k + 1 = ${k + 1}`);
    pairs.set(v, k);
  }
  return buildKickPlan(pairs, g);
}

/** A ball: the voxels within Euclidean distance `radius` of the centre; x and y wrap, z is clipped at the walls (R4.9). At most 123 voxels for radius 3. */
export function ballVoxels(centre: number, g: Geom, radius = 3): number[] {
  const cx = voxelX(centre, g);
  const cy = voxelY(centre, g);
  const cz = voxelZ(centre, g);
  const out: number[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    const z = cz + dz;
    if (z < 0 || z >= g.D) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = (cy + dy + g.H) % g.H;
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        out.push(voxelAt((cx + dx + g.W) % g.W, y, z, g));
      }
    }
  }
  return out;
}

/**
 * Rung P2 (R4.9): the kicked set is the union of the balls around `centres`, restricted to voxels with B >= 3 in the frozen
 * reference; each such voxel is kicked once, by floor(B_v / 2) of its value in the reference at T.
 */
export function kickPlanP2(B: ArrayLike<number>, centres: ArrayLike<number>, g: Geom): KickPlan {
  const pairs = new Map<number, number>();
  for (let j = 0; j < centres.length; j++)
    for (const v of ballVoxels(centres[j], g)) if (B[v] >= 3 && !pairs.has(v)) pairs.set(v, Math.floor(B[v] / 2));
  return buildKickPlan(pairs, g);
}

/** The unit-kick control (R4.8): the same voxels at max(1, floor(k_v / U_DIV)) at every voxel the full kick touches, so U is never empty. */
export function unitKickPlan(plan: KickPlan, g: Geom, c: RegimeConstants = REGIME): KickPlan {
  const pairs = new Map<number, number>();
  for (let j = 0; j < plan.voxels.length; j++) pairs.set(plan.voxels[j], Math.max(1, Math.floor(plan.amounts[j] / c.U_DIV)));
  return buildKickPlan(pairs, g);
}

/** U is available if its dose is at most U_MAX of the S dose (R4.8); otherwise the dust state is UNAVAILABLE. */
export function unitKickAvailable(doseU: number, doseS: number, c: RegimeConstants = REGIME): boolean {
  return fracLE(doseU, doseS, c.U_MAX);
}

/**
 * R4.9 thresholds of rung P2, from the S twin's kick: thetaB = ceil(M / 2) with M the median of |dB_blk(0)| over the blocks that
 * contain a kick; thetaV = max(2, ceil(K / 2)) with K the median of k_v over the kicked voxels. Every twin of the job uses them.
 */
export function thresholdsP2(plan: KickPlan): { thetaB: number; thetaV: number } {
  const M = median(plan.blockSums);
  const K = median(plan.amounts);
  if (M === null || K === null) throw new Error("thresholdsP2: an empty kick");
  return { thetaB: Math.ceil(M / 2), thetaV: Math.max(2, Math.ceil(K / 2)) };
}

/** The B and C channels with the kick applied (copies): B_v -= k_v, C_v += k_v. Throws if a voxel would underflow (R4.6). */
export function applyKickToChannels(B: ArrayLike<number>, C: ArrayLike<number>, plan: KickPlan): { B: Uint32Array; C: Uint32Array } {
  const b = Uint32Array.from(B as ArrayLike<number>);
  const cc = Uint32Array.from(C as ArrayLike<number>);
  for (let j = 0; j < plan.voxels.length; j++) {
    const v = plan.voxels[j];
    if (b[v] < plan.amounts[j]) throw new Error(`applyKickToChannels: voxel ${v} holds B = ${b[v]} and would lose ${plan.amounts[j]}`);
    b[v] -= plan.amounts[j];
    cc[v] += plan.amounts[j];
  }
  return { B: b, C: cc };
}

/** The heat entry of a kick: sum(k_v) * (eB - eC), the energy the decay law B -> C exports (R4.6). */
export const kickHeat = (plan: KickPlan, eB: number, eC: number): number => plan.total * (eB - eC);

// =====================================================================================================================
// R6 Counters: the CPU reference of the GPU diff pass

/** The global counters of one diff pass (twin X against reference R), in the order of the GPU log (plan 8.2). */
export const DIFF_COLUMNS = [
  "n_blk", "n_blk2", "n_occ", "L1c", "liveblk_R", "n_thetaV", "n_2thetaV", "n_1", "n_live", "n_vox",
  "L1_A", "L1_B", "L1_C", "L1_P", "SB_R", "live_R", "SB_X", "live_X",
] as const;
export type DiffColumn = (typeof DIFF_COLUMNS)[number];
/** One row of the log: every counter after `t` steps. */
export type DiffRow = Record<DiffColumn, number>;
/** One twin's log by column: `log.n_blk[t]` is the counter after t steps; t = 0 is the pass before step 1. JSON-safe. */
export type DiffLog = Record<DiffColumn, number[]>;
/** The counters that are 0 at every step for a fork with no kick (C1). */
export const DIFF_ZERO_COLUMNS: readonly DiffColumn[] = Object.freeze(["n_blk", "n_blk2", "n_occ", "L1c", "n_thetaV", "n_2thetaV", "n_1", "n_live", "n_vox", "L1_A", "L1_B", "L1_C", "L1_P"] as const);

export function emptyDiffLog(): DiffLog {
  return Object.fromEntries(DIFF_COLUMNS.map((k) => [k, [] as number[]])) as DiffLog;
}
export function diffLogFromRows(rows: readonly DiffRow[]): DiffLog {
  const log = emptyDiffLog();
  for (const r of rows) for (const k of DIFF_COLUMNS) log[k].push(r[k]);
  return log;
}
export function diffRowAt(log: DiffLog, t: number): DiffRow {
  return Object.fromEntries(DIFF_COLUMNS.map((k) => [k, log[k][t]])) as DiffRow;
}
export const diffLogLength = (log: DiffLog): number => log.n_blk.length;

/** The deciding count column of a log: `n_blk` under the net decider, `n_occ` under the occupancy decider (R6, R1 DECIDER). */
export const decidingColumn = (log: DiffLog, decider: Decider): number[] => (decider === "net" ? log.n_blk : log.n_occ);
/** The column that does not decide (printed beside it, R6.8). */
export const otherColumn = (log: DiffLog, decider: Decider): number[] => (decider === "net" ? log.n_occ : log.n_blk);

/** Per-block quantities of one pass, kept so the per-site attribution and the descriptive columns can be derived. */
export interface BlockDamage {
  /** Signed net sum of B_X - B_R over each block. */
  net: Float64Array;
  /** Voxels per block with |B_X - B_R| >= thetaV. */
  occ: Uint32Array;
  /** 1 if the block holds a living voxel (B + P > 0) in the reference. */
  live: Uint8Array;
}

/**
 * The CPU reference of the diff pass (R6): `R` and `X` are channel-major cell buffers (`cells[ch * n + v]`, n = W * H * D, 7
 * channels). One call is one row of the log. The GPU kernel must agree with it exactly at every step it is compared (plan 8.3 c).
 */
export function diffCounters(R: ArrayLike<number>, X: ArrayLike<number>, g: Geom, thr: { thetaB: number; thetaV: number }, c: RegimeConstants = REGIME): { row: DiffRow; blocks: BlockDamage } {
  const n = voxelCount(g);
  const wh = columnCount(g);
  const nb = blockCount(g);
  const bw = Math.floor(g.W / BLOCK);
  const net = new Float64Array(nb);
  const occ = new Uint32Array(nb);
  const live = new Uint8Array(nb);
  let nTV = 0, n2TV = 0, n1 = 0, nLive = 0, nVox = 0, l1A = 0, l1B = 0, l1C = 0, l1P = 0, sbR = 0, sbX = 0, liveR = 0, liveX = 0;
  const oB = CH.B * n, oA = CH.A * n, oC = CH.C * n, oP = CH.P * n;
  for (let v = 0; v < n; v++) {
    const col = v % wh;
    const x = col % g.W;
    const y = (col - x) / g.W;
    const b = Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK);
    const bR = R[oB + v], bX = X[oB + v];
    const dB = bX - bR;
    const aB = Math.abs(dB);
    net[b] += dB;
    sbR += bR;
    sbX += bX;
    const lr = bR + R[oP + v] > 0;
    const lx = bX + X[oP + v] > 0;
    if (lr) { liveR++; live[b] = 1; }
    if (lx) liveX++;
    if (lr !== lx) nLive++;
    if (aB >= 1) n1++;
    if (aB >= thr.thetaV) { nTV++; occ[b]++; }
    if (aB >= 2 * thr.thetaV) n2TV++;
    l1A += Math.min(Math.abs(X[oA + v] - R[oA + v]), 1023);
    l1B += Math.min(aB, 1023);
    l1C += Math.min(Math.abs(X[oC + v] - R[oC + v]), 1023);
    l1P += Math.min(Math.abs(X[oP + v] - R[oP + v]), 1023);
    for (let ch = 0; ch < CELL_CHANNELS; ch++) if (R[ch * n + v] !== X[ch * n + v]) { nVox++; break; }
  }
  let nBlk = 0, nBlk2 = 0, nOcc = 0, l1c = 0, liveBlk = 0;
  for (let b = 0; b < nb; b++) {
    const a = Math.abs(net[b]);
    l1c += a;
    if (a >= thr.thetaB) nBlk++;
    if (a >= 2 * thr.thetaB) nBlk2++;
    if (occ[b] >= c.OCC_V) nOcc++;
    if (live[b]) liveBlk++;
  }
  const row: DiffRow = {
    n_blk: nBlk, n_blk2: nBlk2, n_occ: nOcc, L1c: l1c, liveblk_R: liveBlk, n_thetaV: nTV, n_2thetaV: n2TV, n_1: n1, n_live: nLive, n_vox: nVox,
    L1_A: l1A, L1_B: l1B, L1_C: l1C, L1_P: l1P, SB_R: sbR, live_R: liveR, SB_X: sbX, live_X: liveX,
  };
  return { row, blocks: { net, occ, live } };
}

/** The four per-site words of a pass (R6.2): damaged blocks attributed to each S site under each decider, and the reaches in voxels. */
export interface SiteRow {
  n_blk: number[];
  n_occ: number[];
  reach_blk: number[];
  reach_occ: number[];
}

/** Attribution of the damaged blocks of one pass to the S sites (R6.2). */
export function siteCounters(blocks: BlockDamage, thr: { thetaB: number }, sites: ArrayLike<number>, g: Geom, c: RegimeConstants = REGIME): SiteRow {
  const m = sites.length;
  const out: SiteRow = { n_blk: new Array(m).fill(0), n_occ: new Array(m).fill(0), reach_blk: new Array(m).fill(0), reach_occ: new Array(m).fill(0) };
  for (let b = 0; b < blocks.net.length; b++) {
    const netDamaged = Math.abs(blocks.net[b]) >= thr.thetaB;
    const occDamaged = blocks.occ[b] >= c.OCC_V;
    if (!netDamaged && !occDamaged) continue;
    const { site, distance } = nearestSite(b, sites, g);
    if (site < 0) continue;
    if (netDamaged) { out.n_blk[site]++; out.reach_blk[site] = Math.max(out.reach_blk[site], distance); }
    if (occDamaged) { out.n_occ[site]++; out.reach_occ[site] = Math.max(out.reach_occ[site], distance); }
  }
  return out;
}

/** Signed net difference of B per block, from two B channels (used by the dust-floor report of R9.0 (c)). */
export function blockNetDiff(Bref: ArrayLike<number>, Bx: ArrayLike<number>, g: Geom): Float64Array {
  const wh = columnCount(g);
  const bw = Math.floor(g.W / BLOCK);
  const net = new Float64Array(blockCount(g));
  for (let v = 0; v < voxelCount(g); v++) {
    const col = v % wh;
    const x = col % g.W;
    const y = (col - x) / g.W;
    net[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)] += Bx[v] - Bref[v];
  }
  return net;
}

/** Median of |net| over the blocks with a nonzero net difference (R9.0 go/no-go c); null if every block is zero. */
export function medianNonzeroAbs(net: ArrayLike<number>): number | null {
  const a: number[] = [];
  for (let i = 0; i < net.length; i++) if (net[i] !== 0) a.push(Math.abs(net[i]));
  return median(a);
}

// =====================================================================================================================
// R6.2 to R6.5, R6.11 Trajectory meter

/** Per-site counters of a twin's pass at the stored steps (the S twin and the F pair's X_F): `[site][stored step index]`. */
export interface SiteLog {
  /** Stored steps, ascending (`storedSteps()`: every step of the eight windows and every 10th step). */
  steps: number[];
  n_blk: number[][];
  n_occ: number[][];
  reach_blk: number[][];
  reach_occ: number[][];
}

/** The per-site series of the deciding column. */
export interface SiteSeries {
  steps: number[];
  nDec: number[][];
  reach: number[][];
}
export function siteSeries(log: SiteLog, decider: Decider): SiteSeries {
  return decider === "net" ? { steps: log.steps, nDec: log.n_blk, reach: log.reach_blk } : { steps: log.steps, nDec: log.n_occ, reach: log.reach_occ };
}

/** The per-site log holds every step of the eight grid windows (what the bootstrap, the speed and OVERLAP read). */
export function siteLogComplete(log: SiteLog, c: RegimeConstants = REGIME): boolean {
  const have = new Set(log.steps);
  for (const tc of c.TRAJ) {
    const [lo, hi] = windowBounds(tc, c.TRAJ_STEPS, c.WIN_HALF);
    for (let t = lo; t <= hi; t++) if (!have.has(t)) return false;
  }
  return log.n_blk.length === log.n_occ.length && log.n_blk.length === log.reach_blk.length && log.n_blk.every((row) => row.length === log.steps.length);
}

/**
 * Cross-check of the log against itself: at every stored step the per-site counts add up to the global count of the same decider
 * (every damaged block is attributed, so N(t) = n_dec(t) / m_S, R6.2). A GPU kernel that loses or double-counts a block fails it.
 */
export function siteSumsMatchGlobal(log: DiffLog, sites: SiteLog, decider: Decider): boolean {
  const ss = siteSeries(sites, decider);
  const global = decidingColumn(log, decider);
  return ss.steps.every((t, i) => ss.nDec.reduce((a, row) => a + row[i], 0) === global[t]);
}

/** Saturated at a grid time: coverage of at least SAT of the living blocks and a per-site multiplication of at least R_AMP (R6.3). */
export const isSaturated = (satFrac: number, r: number, c: RegimeConstants = REGIME): boolean => satFrac >= c.SAT && r >= c.R_AMP;
/** Coverage reached without the doubling: the kick footprint alone covers that share; not saturated (R6.3). */
export const isFootprint = (satFrac: number, r: number, c: RegimeConstants = REGIME): boolean => satFrac >= c.SAT && r < c.R_AMP;

export interface TrajectorySeries {
  grid: number[];
  /** N-bar(t_c): window mean of N(t) = n_dec(t) / m_S. */
  Nbar: (number | null)[];
  /** r(t_c) = Nbar(t_c) / n0_S. */
  r: (number | null)[];
  /** satFrac(t_c): window mean of n_dec(t) / max(liveblk_R(t), 1). */
  satFrac: (number | null)[];
  saturatedAt: boolean[];
  footprintAt: boolean[];
  /** Saturated at any grid time. */
  saturated: boolean;
  /** The FOOTPRINT flag: coverage reached without the doubling at some grid time. */
  footprint: boolean;
  /** Index of the first saturated grid time, or null. */
  firstSaturated: number | null;
}

/**
 * R6.3. `nDec` and `liveblk` are the S twin's global deciding column and liveblk_R by step (index = step); `mS` the sites placed;
 * `n0` the blocks that hold a kicked voxel of S (so n0_S = n0 / m_S: 1 per site under P1).
 */
export function trajectorySeries(i: { mS: number; n0: number; nDec: ArrayLike<number>; liveblk: ArrayLike<number> }, c: RegimeConstants = REGIME): TrajectorySeries {
  const n0S = Math.max(i.n0, 1) / Math.max(i.mS, 1);
  const Nbar: (number | null)[] = [];
  const r: (number | null)[] = [];
  const satFrac: (number | null)[] = [];
  for (const tc of c.TRAJ) {
    const m = windowMean(i.nDec, tc, c.TRAJ_STEPS, c.WIN_HALF);
    const nb = m === null ? null : m / Math.max(i.mS, 1);
    Nbar.push(nb);
    r.push(nb === null ? null : nb / n0S);
    satFrac.push(windowMeanRatio(i.nDec, i.liveblk, tc, c.TRAJ_STEPS, c.WIN_HALF));
  }
  const saturatedAt = c.TRAJ.map((_, j) => r[j] !== null && satFrac[j] !== null && isSaturated(satFrac[j]!, r[j]!, c));
  const footprintAt = c.TRAJ.map((_, j) => r[j] !== null && satFrac[j] !== null && isFootprint(satFrac[j]!, r[j]!, c));
  const first = saturatedAt.indexOf(true);
  return { grid: [...c.TRAJ], Nbar, r, satFrac, saturatedAt, footprintAt, saturated: first >= 0, footprint: footprintAt.some(Boolean), firstSaturated: first >= 0 ? first : null };
}

export interface ExponentFit {
  /** OLS slope of ln(max(r, 1 / (2 m_S))) on ln t over the grid points before the first saturated one (all if none); null with fewer than 3 points. */
  b: number | null;
  points: number;
  /** Residual sums of squares of y against t (exponential model) and against ln t (power model); null if b is null. */
  sseExp: number | null;
  sseLogT: number | null;
}

/** R6.3 fit. `firstSaturated` cuts the fit to the points before it. */
export function fitExponent(r: readonly (number | null)[], mS: number, firstSaturated: number | null, c: RegimeConstants = REGIME): ExponentFit {
  const end = firstSaturated === null ? c.TRAJ.length : firstSaturated;
  const floor = 1 / (2 * Math.max(mS, 1));
  const lt: number[] = [];
  const tt: number[] = [];
  const y: number[] = [];
  for (let j = 0; j < end; j++) {
    const rj = r[j];
    if (rj === null) continue;
    lt.push(Math.log(c.TRAJ[j]));
    tt.push(c.TRAJ[j]);
    y.push(Math.log(Math.max(rj, floor)));
  }
  const pow = olsSlope(lt, y);
  if (!pow) return { b: null, points: y.length, sseExp: null, sseLogT: null };
  const exp = olsSlope(tt, y)!;
  return { b: pow.slope, points: y.length, sseExp: exp.sse, sseLogT: pow.sse };
}

/** The exponent for the map (R6.3): +2 if saturated, else -2 if r(1000) < ORD_R, else b clamped to [-2, +2]; null if undefined. */
export function mapExponent(i: { saturated: boolean; r1000: number | null; b: number | null }, c: RegimeConstants = REGIME): number | null {
  if (i.saturated) return 2;
  if (i.r1000 === null) return null;
  if (i.r1000 < c.ORD_R) return -2;
  return i.b === null ? null : Math.max(-2, Math.min(2, i.b));
}

/** Per-site spread flags and OVERLAP (R6.5): a site is spread if its reach is at least OVERLAP_REACH at any stored step; OVERLAP if more than a quarter of the sites are. */
export function overlapOf(reach: readonly (readonly number[])[], c: RegimeConstants = REGIME): { spread: boolean[]; spreadCount: number; overlap: boolean } {
  const spread = reach.map((row) => row.some((x) => x >= c.OVERLAP_REACH));
  const spreadCount = spread.filter(Boolean).length;
  return { spread, spreadCount, overlap: fracGT(spreadCount, reach.length, c.OVERLAP_FRAC) };
}

/**
 * R6.11: the median over sites whose n_dec_j window mean at step 1000 is positive of (reach_j(1000) - reach_j(100)) / 900, from
 * window means; null if no site has damage at 1000. `subset` restricts (and repeats) sites, for the bootstrap.
 */
export function siteSpeed(s: SiteSeries, subset?: readonly number[], c: RegimeConstants = REGIME): number | null {
  const t0 = c.TRAJ[0];
  const t1 = c.TRAJ[c.TRAJ.length - 1];
  const idx = subset ?? s.nDec.map((_, j) => j);
  const v: number[] = [];
  for (const j of idx) {
    const alive = windowMeanStored(s.steps, s.nDec[j], t1, c.TRAJ_STEPS, c.WIN_HALF);
    if (alive === null || !(alive > 0)) continue;
    const a = windowMeanStored(s.steps, s.reach[j], t0, c.TRAJ_STEPS, c.WIN_HALF);
    const b = windowMeanStored(s.steps, s.reach[j], t1, c.TRAJ_STEPS, c.WIN_HALF);
    if (a === null || b === null) continue;
    v.push((b - a) / (t1 - t0));
  }
  return median(v);
}

/** Inputs of the T-class decision, all already reduced (R6.4). */
export interface TrajectoryFacts {
  fewSites: boolean;
  fewColonies: boolean;
  saturated: boolean;
  overlap: boolean;
  r1000: number | null;
  b: number | null;
  speed: number | null;
}

/**
 * R6.4, in order: 1 NA if FEW_SITES or FEW_COLONIES; 2 CHAOTIC if saturated; 3 NA if OVERLAP; 4 ORDERED if r(1000) < ORD_R or
 * b < B_LO; 5 CHAOTIC if b > B_HI; 6 ORDERED (form frozen) if speed < SPEED_MIN; 7 CRITICAL. A quantity that is NA where a step
 * needs it makes the class NA (R0).
 */
export function classifyTrajectory(i: TrajectoryFacts, c: RegimeConstants = REGIME): { cls: TClass; frozen: boolean } {
  if (i.fewSites || i.fewColonies) return { cls: "NA", frozen: false };
  if (i.saturated) return { cls: "CHAOTIC", frozen: false };
  if (i.overlap) return { cls: "NA", frozen: false };
  if (i.r1000 === null) return { cls: "NA", frozen: false };
  if (i.r1000 < c.ORD_R) return { cls: "ORDERED", frozen: false };
  if (i.b === null) return { cls: "NA", frozen: false };
  if (i.b < c.B_LO) return { cls: "ORDERED", frozen: false };
  if (i.b > c.B_HI) return { cls: "CHAOTIC", frozen: false };
  if (i.speed === null) return { cls: "NA", frozen: false };
  if (i.speed < c.SPEED_MIN) return { cls: "ORDERED", frozen: true };
  return { cls: "CRITICAL", frozen: false };
}

/** The growth-form label (R6.4, printed, decides nothing). */
export function growthForm(i: { cls: TClass; frozen: boolean; saturated: boolean; b: number | null; sseExp: number | null; sseLogT: number | null }, c: RegimeConstants = REGIME): GrowthForm | null {
  if (i.saturated) return "saturating";
  if (i.cls === "NA") return null;
  if (i.cls === "ORDERED") return i.frozen ? "frozen" : "decays";
  if (i.cls === "CHAOTIC" && i.b !== null && i.b > c.B_HI) {
    if (i.sseExp !== null && i.sseLogT !== null && i.sseExp < i.sseLogT) return "exponential";
    return i.b <= 2.5 ? "cone" : "super-cone";
  }
  return "flat";
}

// ---------------------------------------------------------------------------------------------------------------------
// R7 Bootstrap over colonies

/** `bootSeed = lowbias32(h0 ^ 0xb007)` (R7). */
export const bootstrapSeed = (h0: number): number => lowbias32((h0 ^ 0xb007) >>> 0);

/**
 * The colony at position `p` of resample `u` (R7): stream position `i = u * n_col + p` runs over all resamples, so no two resamples
 * reuse a stream position; the colony index is `draw(bootSeed, i) % n_col` (two resamples may of course draw the same colony).
 */
export function bootstrapDraw(bootSeed: number, u: number, p: number, nCol: number): { position: number; colony: number } {
  const position = u * nCol + p;
  return { position, colony: draw(bootSeed, position) % nCol };
}

/**
 * Stability of the T-class (R7): BOOT resamples of the colonies that hold sites; each takes all S sites of each drawn colony (a
 * colony drawn twice counts twice), recomputes N(t) as the mean of the per-site series over the sites drawn, then r, b and the
 * T-class with the saturation flag held at its point value; `stT` is the fraction of resamples whose class equals the point class.
 * Overlap and speed are per-site quantities and are recomputed over the sites drawn (resolution W5). Null if the point class is NA.
 */
export function bootstrapStability(
  i: { pointClass: TClass; saturated: boolean; series: SiteSeries; colonies: readonly (readonly number[])[]; n0Site: readonly number[]; h0: number },
  c: RegimeConstants = REGIME,
): number | null {
  if (i.pointClass === "NA") return null;
  const nCol = i.colonies.length;
  const m = i.series.nDec.length;
  if (nCol === 0 || m === 0) return null;
  const bootSeed = bootstrapSeed(i.h0);
  const win = i.series.nDec.map((row) => c.TRAJ.map((tc) => windowMeanStored(i.series.steps, row, tc, c.TRAJ_STEPS, c.WIN_HALF)));
  const spreadFlags = overlapOf(i.series.reach, c).spread;
  let same = 0;
  for (let u = 0; u < c.BOOT; u++) {
    const drawn: number[] = [];
    for (let p = 0; p < nCol; p++) for (const j of i.colonies[bootstrapDraw(bootSeed, u, p, nCol).colony]) drawn.push(j);
    const n0S = drawn.reduce((a, j) => a + i.n0Site[j], 0) / drawn.length;
    const r: (number | null)[] = c.TRAJ.map((_, g) => {
      let s = 0;
      for (const j of drawn) {
        const w = win[j][g];
        if (w === null) return null;
        s += w;
      }
      return s / drawn.length / n0S;
    });
    // The resample's own m_S is the number of sites drawn (it sets the floor of the fit).
    const fit = fitExponent(r, drawn.length, null, c);
    const spreadCount = drawn.filter((j) => spreadFlags[j]).length;
    const cls = classifyTrajectory({
      fewSites: false, fewColonies: false, saturated: i.saturated, overlap: fracGT(spreadCount, drawn.length, c.OVERLAP_FRAC),
      r1000: r[r.length - 1], b: fit.b, speed: siteSpeed(i.series, drawn, c),
    }, c).cls;
    if (cls === i.pointClass) same++;
  }
  return same / c.BOOT;
}

// =====================================================================================================================
// R6.6, R6.7 Derrida meter

/** The Derrida class of a response ratio at TAU_DEC (R6.7): ORDERED below D_LO, CRITICAL from D_LO to D_HI inclusive, CHAOTIC above D_HI. */
export function derridaClass(s: number, c: RegimeConstants = REGIME): RegimeClass {
  if (s < c.D_LO) return "ORDERED";
  if (s <= c.D_HI) return "CRITICAL";
  return "CHAOTIC";
}

export interface DoseInput {
  m: number;
  /** Blocks that hold a kicked voxel of this dose (R4.5). */
  n0: number;
  /** The dose twin's deciding column by step (index = step; 300 steps). */
  nDec: ArrayLike<number>;
}

export interface DoseResponse {
  m: number;
  n0: number;
  /** nbar(tau; m) per TAU column: mean of n_dec over steps max(1, tau - 5) to min(300, tau + 5). */
  nbar: (number | null)[];
  /** Response ratio s_m(tau) = nbar / max(n0, 1): damaged blocks per kicked block after tau steps. */
  s: (number | null)[];
  /** Curve point x = n0 / liveblk_R(T), the kicked-block fraction. */
  x: number;
  /** d0_m = m / live_R(T), and D_m(tau) = nbar / liveblk_R(T) (kept, not the response ratio). */
  d0: number;
  D: (number | null)[];
}

export interface DerridaResult {
  doses: DoseResponse[];
  /** Pooled ratio s(tau) = sum of nbar over O / sum of n0 over O, per TAU column. */
  s: (number | null)[];
  /** Linearity ratio s_m(tau) / s(tau) per dose and TAU column (null when s(tau) is 0). */
  lin: (number | null)[][];
  /** D-class decided at TAU_DEC, the classes of s_m(TAU_DEC) for the two largest doses, and stD. */
  sDec: number | null;
  dClass: RegimeClass | null;
  topDoseClasses: RegimeClass[];
  stD: boolean | null;
}

/**
 * R6.6 and R6.7 from the dose twins of the origin set (the doses that were run). `liveblkT` and `liveT` are liveblk_R(T) and live_R(T)
 * (floored at 1 in quotients). Needs at least 2 doses (otherwise the job is FEW_DOSES and has no D-class).
 */
export function derridaAnalysis(doses: readonly DoseInput[], at: { liveblkT: number; liveT: number }, c: RegimeConstants = REGIME): DerridaResult {
  const sorted = [...doses].sort((a, b) => a.m - b.m);
  const taus = c.TAU;
  const nbarAt = (d: DoseInput, tau: number) => windowMean(d.nDec, tau, c.DOSE_STEPS, c.WIN_HALF);
  const rows: DoseResponse[] = sorted.map((d) => {
    const nbar = taus.map((tau) => nbarAt(d, tau));
    return {
      m: d.m, n0: d.n0, nbar,
      s: nbar.map((v) => (v === null ? null : v / Math.max(d.n0, 1))),
      x: d.n0 / Math.max(at.liveblkT, 1),
      d0: d.m / Math.max(at.liveT, 1),
      D: nbar.map((v) => (v === null ? null : v / Math.max(at.liveblkT, 1))),
    };
  });
  const sumN0 = Math.max(rows.reduce((a, r) => a + r.n0, 0), 1);
  const pooled = taus.map((_, t) => {
    let sum = 0;
    for (const r of rows) {
      if (r.nbar[t] === null) return null;
      sum += r.nbar[t]!;
    }
    return sum / sumN0;
  });
  const lin = rows.map((r) => r.s.map((v, t) => (v === null || pooled[t] === null || !(pooled[t]! > 0) ? null : v / pooled[t]!)));
  const sDecPooled = ((): number | null => {
    const sum = sorted.map((d) => nbarAt(d, c.TAU_DEC));
    if (sum.some((v) => v === null)) return null;
    return sum.reduce<number>((a, v) => a + (v as number), 0) / sumN0;
  })();
  const top = sorted.slice(-2);
  const topDoseClasses: RegimeClass[] = [];
  for (const d of top) {
    const v = nbarAt(d, c.TAU_DEC);
    if (v !== null) topDoseClasses.push(derridaClass(v / Math.max(d.n0, 1), c));
  }
  const dClass = sDecPooled === null ? null : derridaClass(sDecPooled, c);
  const stD = dClass === null || topDoseClasses.length < 2 ? null : topDoseClasses.every((k) => k === dClass);
  return { doses: rows, s: pooled, lin, sDec: sDecPooled, dClass, topDoseClasses, stD };
}

// =====================================================================================================================
// R6.12 Dust control

/** ratio_U = Nbar_U / max(Nbar_S, 1 / (2 m_S)) (R6.12). */
export const dustRatio = (NbarS: number, NbarU: number, mS: number): number => NbarU / Math.max(NbarS, 1 / (2 * Math.max(mS, 1)));

/** The dust state of a ratio (R6.12): CLEAR below DUST_CLEAR, LIMITED from DUST_LIM, AMBIG between; UNAVAILABLE for no ratio. */
export function dustState(ratio: number | null, c: RegimeConstants = REGIME): DustState {
  if (ratio === null) return "UNAVAILABLE";
  if (ratio < c.DUST_CLEAR) return "CLEAR";
  if (ratio >= c.DUST_LIM) return "LIMITED";
  return "AMBIG";
}

// =====================================================================================================================
// R7 Job class

export interface JobClassInput {
  fewDoses: boolean;
  diedInPhase: boolean;
  drift: boolean;
  tClass: TClass;
  /** T-class is ORDERED with form frozen. */
  tFrozen: boolean;
  dClass: RegimeClass | null;
  stT: number | null;
  stD: boolean | null;
}

export type JobFlag = "FROZEN" | "D_ONLY";

/**
 * R7 steps 1 to 3. No class if FEW_DOSES, DIED_IN_PHASE or DRIFT. With a T-class: a frozen ORDERED T-class and a CRITICAL D-class
 * agree on ORDERED (flag FROZEN); then MIXED if they differ, UNSTABLE if they agree but stT < STABLE or stD is false, else the common
 * class. Without a T-class (FEW_SITES, FEW_COLONIES, OVERLAP): UNSTABLE if stD is false; else the D-class if ORDERED or CHAOTIC, MIXED if
 * CRITICAL (one meter cannot certify a band); the job carries the flag D_ONLY. The stability check still applies after the
 * FROZEN pairing (resolution W3).
 */
export function jobClassOf(i: JobClassInput, c: RegimeConstants = REGIME): { cls: JobClass | null; flags: JobFlag[] } {
  if (i.fewDoses || i.diedInPhase || i.drift || i.dClass === null) return { cls: null, flags: [] };
  const flags: JobFlag[] = [];
  if (i.tClass === "NA") {
    flags.push("D_ONLY");
    if (i.stD !== true) return { cls: "UNSTABLE", flags };
    return { cls: i.dClass === "CRITICAL" ? "MIXED" : i.dClass, flags };
  }
  let d: RegimeClass = i.dClass;
  if (i.tClass === "ORDERED" && i.tFrozen && d === "CRITICAL") {
    d = "ORDERED";
    flags.push("FROZEN");
  }
  if (i.tClass !== d) return { cls: "MIXED", flags };
  if (i.stT === null || i.stT < c.STABLE || i.stD !== true) return { cls: "UNSTABLE", flags };
  return { cls: i.tClass, flags };
}

/** R7.4: a job votes only if its class is one of the three and its dust state is CLEAR. */
export const jobVotes = (cls: JobClass | null, dust: DustState): boolean => isRegimeClass(cls) && dust === "CLEAR";

// =====================================================================================================================
// The twin bank, one job's reading of it

/** What the runner records of one rung's twin phase (R2.6); the long logs are `DiffLog`s, the per-site logs `SiteLog`s. */
export interface TwinBank {
  rung: Rung;
  /** The kick size under P1 (R4.1), or the median k_v of the S twin under P2. */
  k: number;
  /** The thresholds in force for every twin of the bank: ceil(k / 2) and max(2, ceil(k / 4)) under P1, S-derived under P2 (R4.9). */
  thetaB: number;
  thetaV: number;
  /** S site voxels in acceptance order, and the colonies (site indices per colony, in order of the lowest site index). */
  sites: number[];
  nCol: number;
  colonies: number[][];
  /** Blocks that hold a kicked voxel of the S twin: total and per site (n0_S = n0 / m_S). */
  n0: number;
  n0Site: number[];
  /** The S dose (sum of the S kicks). */
  doseS: number;
  /** Doses of the origin set that were run, with their kicked blocks and 300-step logs; the others are listed in `skipped`. */
  doses: { m: number; n0: number; log: DiffLog }[];
  skipped?: { m: number; n0: number }[];
  /** S twin (absent under FEW_SITES): 1000-step log and per-site log. */
  S?: { log: DiffLog; sites: SiteLog };
  /** Unit-kick control (absent under FEW_SITES): 300-step log, its dose, and the median |dB_blk| over its nonzero blocks at TAU_DEC (R9.0 c). */
  U?: { log: DiffLog; doseU: number; medianBlock30?: number | null };
  /** Noise-swapped control (300 steps). */
  N?: { log: DiffLog };
  /** Frozen pair (gate and Stage 0 jobs): X_F against R_F for 1000 steps. */
  F?: { log: DiffLog; sites: SiteLog };
}

/** Job-level facts of a metered job that the reading needs. */
export interface JobCore {
  /** liveblk_R(T) and live_R(T): living blocks and voxels of the reference at T. */
  liveblkT: number;
  liveT: number;
  /** The selection seed h0 (R4.3). */
  h0: number;
  /** R3 items 6 and 7, from `phaseState`: the job has no class if either is true. */
  diedInPhase: boolean;
  drift: boolean;
}

export interface JobReading {
  rung: Rung;
  decider: Decider;
  fewSites: boolean;
  fewColonies: boolean;
  fewDoses: boolean;
  overlap: boolean;
  mS: number;
  nCol: number;
  // R6.3 to R6.5, R6.11
  tClass: TClass;
  tFrozen: boolean;
  form: GrowthForm | null;
  saturated: boolean;
  footprint: boolean;
  b: number | null;
  /** The exponent for the map (R6.3). */
  e: number | null;
  speed: number | null;
  /** r(t_c) and satFrac(t_c) at the eight grid times (the margin condition reads them). */
  gridR: (number | null)[];
  gridSatFrac: (number | null)[];
  stT: number | null;
  // R6.6, R6.7
  dClass: RegimeClass | null;
  stD: boolean | null;
  /** Pooled response ratio per TAU column, and the S twin's r(tau) as the cross-check column. */
  s: (number | null)[];
  sS: (number | null)[];
  /** s(TAU_DEC), the quantity the Derrida class and the coordinate `ell` are made of. */
  s30: number | null;
  // R6.12
  NbarS: number | null;
  NbarU: number | null;
  ratioU: number | null;
  dust: DustState;
  doseS: number;
  doseU: number | null;
  // R7
  jobClass: JobClass | null;
  flags: JobFlag[];
  vote: boolean;
  // Controls (R9.2 G7) and the go/no-go reports of R9.0
  /** satFrac of the N twin at step 100: window mean of n_dec,N / liveblk_R. */
  nSat100: number | null;
  /** The F pair's T-class (R6.4 applied to X_F against R_F with the S sites; the colony clause is not applied, resolution W7). */
  fClass: TClass | null;
  /** Window means at TAU_DEC of the deciding column of F, S and N (global, not per site). */
  nDecF30: number | null;
  nDecS30: number | null;
  nDecN30: number | null;
  /** U twin, block-net: window mean at TAU_DEC of n_blk / max(liveblk_R, 1) (R9.0 b), the median |dB_blk| over its nonzero blocks (R9.0 c), and thetaB. */
  uNetCoverage30: number | null;
  uMedianBlock30: number | null;
  thetaB: number;
}

function trajectoryOf(mS: number, nCol: number, n0: number, log: DiffLog, sites: SiteLog, decider: Decider, ignoreColonies: boolean, c: RegimeConstants) {
  const nDec = decidingColumn(log, decider);
  const series = trajectorySeries({ mS, n0, nDec, liveblk: log.liveblk_R }, c);
  const fit = fitExponent(series.r, mS, series.firstSaturated, c);
  const ss = siteSeries(sites, decider);
  const ov = overlapOf(ss.reach, c);
  const speed = siteSpeed(ss, undefined, c);
  const r1000 = series.r[series.r.length - 1];
  const fC = ignoreColonies ? false : fewColonies(mS, nCol, c);
  const cl = classifyTrajectory({ fewSites: false, fewColonies: fC, saturated: series.saturated, overlap: ov.overlap, r1000, b: fit.b, speed }, c);
  return { series, fit, ss, ov, speed, r1000, cl, nDec };
}

/**
 * One reading of a job's twin bank under one decider (the rung is the bank's): the T-class and its stability, the D-class, the dust
 * state, the job class and its vote, and the control and go/no-go quantities the gate and Stage 0 read.
 */
export function analyzeBank(core: JobCore, bank: TwinBank, decider: Decider, c: RegimeConstants = REGIME): JobReading {
  const mS = bank.sites.length;
  const fS = fewSites(mS, c) || !bank.S;
  const fC = !fS && fewColonies(mS, bank.nCol, c);

  const fD = fewDoses(bank.doses.length);
  const der = fD ? null : derridaAnalysis(bank.doses.map((d) => ({ m: d.m, n0: d.n0, nDec: decidingColumn(d.log, decider) })), { liveblkT: core.liveblkT, liveT: core.liveT }, c);

  let tClass: TClass = "NA", tFrozen = false, form: GrowthForm | null = null, saturated = false, footprint = false;
  let b: number | null = null, e: number | null = null, speed: number | null = null, stT: number | null = null, overlap = false;
  let gridR: (number | null)[] = c.TRAJ.map(() => null), gridSat: (number | null)[] = c.TRAJ.map(() => null);
  let sS: (number | null)[] = c.TAU.map(() => null);
  if (!fS && bank.S) {
    const t = trajectoryOf(mS, bank.nCol, bank.n0, bank.S.log, bank.S.sites, decider, false, c);
    tClass = t.cl.cls;
    tFrozen = t.cl.frozen;
    saturated = t.series.saturated;
    footprint = t.series.footprint;
    b = t.fit.b;
    speed = t.speed;
    overlap = t.ov.overlap;
    gridR = t.series.r;
    gridSat = t.series.satFrac;
    e = mapExponent({ saturated, r1000: t.r1000, b }, c);
    form = growthForm({ cls: tClass, frozen: tFrozen, saturated, b, sseExp: t.fit.sseExp, sseLogT: t.fit.sseLogT }, c);
    const n0S = Math.max(bank.n0, 1) / Math.max(mS, 1);
    sS = c.TAU.map((tau) => {
      const m = windowMean(t.nDec, tau, c.TRAJ_STEPS, c.WIN_HALF);
      return m === null ? null : m / mS / n0S;
    });
    if (tClass !== "NA") {
      stT = bootstrapStability({ pointClass: tClass, saturated, series: t.ss, colonies: bank.colonies, n0Site: bank.n0Site, h0: core.h0 }, c);
    }
  }

  // Dust control (R6.12) at TAU_DEC.
  let NbarS: number | null = null, NbarU: number | null = null, ratioU: number | null = null;
  const uOk = !fS && !!bank.S && !!bank.U && unitKickAvailable(bank.U.doseU, bank.doseS, c);
  if (uOk) {
    const ms = windowMean(decidingColumn(bank.S!.log, decider), c.TAU_DEC, c.TRAJ_STEPS, c.WIN_HALF);
    const mu = windowMean(decidingColumn(bank.U!.log, decider), c.TAU_DEC, c.DOSE_STEPS, c.WIN_HALF);
    if (ms !== null && mu !== null) {
      NbarS = ms / mS;
      NbarU = mu / mS;
      ratioU = dustRatio(NbarS, NbarU, mS);
    }
  }
  const dust = dustState(ratioU, c);

  const jc = jobClassOf({ fewDoses: fD, diedInPhase: core.diedInPhase, drift: core.drift, tClass, tFrozen, dClass: der ? der.dClass : null, stT, stD: der ? der.stD : null }, c);

  // Controls.
  let nSat100: number | null = null, nDecN30: number | null = null, nDecS30: number | null = null, nDecF30: number | null = null;
  let fClass: TClass | null = null;
  if (bank.N) {
    nSat100 = windowMeanRatio(decidingColumn(bank.N.log, decider), bank.N.log.liveblk_R, 100, c.DOSE_STEPS, c.WIN_HALF);
    nDecN30 = windowMean(decidingColumn(bank.N.log, decider), c.TAU_DEC, c.DOSE_STEPS, c.WIN_HALF);
  }
  if (bank.S) nDecS30 = windowMean(decidingColumn(bank.S.log, decider), c.TAU_DEC, c.TRAJ_STEPS, c.WIN_HALF);
  if (bank.F) {
    nDecF30 = windowMean(decidingColumn(bank.F.log, decider), c.TAU_DEC, c.TRAJ_STEPS, c.WIN_HALF);
    if (!fS) fClass = trajectoryOf(mS, bank.nCol, bank.n0, bank.F.log, bank.F.sites, decider, true, c).cl.cls;
    else fClass = "NA";
  }
  // Go/no-go b and c: the block-net count of the U twin, whatever the decider (R9.0).
  const uNetCoverage30 = bank.U ? windowMeanRatio(bank.U.log.n_blk, bank.U.log.liveblk_R, c.TAU_DEC, c.DOSE_STEPS, c.WIN_HALF) : null;

  return {
    rung: bank.rung, decider, fewSites: fS, fewColonies: fC, fewDoses: fD, overlap, mS, nCol: bank.nCol,
    tClass, tFrozen, form, saturated, footprint, b, e, speed, gridR, gridSatFrac: gridSat, stT,
    dClass: der ? der.dClass : null, stD: der ? der.stD : null, s: der ? der.s : c.TAU.map(() => null), sS, s30: der ? der.sDec : null,
    NbarS, NbarU, ratioU, dust, doseS: bank.doseS, doseU: bank.U ? bank.U.doseU : null,
    jobClass: jc.cls, flags: jc.flags, vote: jobVotes(jc.cls, dust),
    nSat100, fClass, nDecF30, nDecS30, nDecN30,
    uNetCoverage30, uMedianBlock30: bank.U?.medianBlock30 ?? null, thetaB: bank.thetaB,
  };
}

// =====================================================================================================================
// R5 Validity checks (pure parts)

export type CheckName = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8";
/** The result of one check on a job. `applicable: false` (C4 with `m4Source: none`) is skipped and never counted as passed. */
export interface CheckResult {
  ok: boolean;
  applicable?: boolean;
  detail?: string;
}

/** Names of the checks a job failed (applicable and not ok). A job with any is INVALID (R5). */
export function invalidChecks(checks: Partial<Record<CheckName, CheckResult>> | undefined): CheckName[] {
  if (!checks) return [];
  return (Object.keys(checks) as CheckName[]).filter((k) => checks[k]!.applicable !== false && !checks[k]!.ok).sort();
}

/**
 * The checks a job must carry (R5): a METERED job all eight (C3 and C4 may be recorded as not applicable, never left out); an EXTINCT or NO_TARGET
 * job, which runs no twins, C2, C4 and C6. A check that is absent was not passed: a truncated or hand-edited file with no C1 must not read as a
 * valid job.
 */
export const REQUIRED_CHECKS: Readonly<Record<StartStatus, readonly CheckName[]>> = Object.freeze({
  METERED: Object.freeze(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"] as CheckName[]),
  EXTINCT: Object.freeze(["C2", "C4", "C6"] as CheckName[]),
  NO_TARGET: Object.freeze(["C2", "C4", "C6"] as CheckName[]),
});
/** The required checks that the job's `checks` object does not hold at all. */
export function missingChecks(checks: Partial<Record<CheckName, CheckResult>> | undefined, status: StartStatus): CheckName[] {
  return REQUIRED_CHECKS[status].filter((k) => !checks || checks[k] === undefined);
}

/** The last step C1 reads: the Z twin's counters at steps 1 to 100 and its full-state hash at step 100 (R5 C1). */
export const C1_STEPS = 100;

/**
 * C1 zero control: the Z twin's thirteen counters are 0 at every step 1 to 100, and at step 100 its full-state hash equals R's. A genome
 * word that differs with no expressed cell effect leaves every counter at 0 and is caught only by the hash. A column that stops short of
 * step 100 (a truncated or empty column) has not shown the control at step 100, so it fails; so does a missing hash (two empty strings are
 * equal and prove nothing).
 */
export function checkC1(z: { counters: Partial<Record<DiffColumn, ArrayLike<number>>>; hashZ: string; hashR: string }): CheckResult {
  for (const k of DIFF_ZERO_COLUMNS) {
    const col = z.counters[k];
    if (!col) return { ok: false, detail: `counter ${k} missing` };
    if (col.length <= C1_STEPS) return { ok: false, detail: `counter ${k} holds ${col.length} rows; steps 1 to ${C1_STEPS} need ${C1_STEPS + 1}` };
    for (let t = 1; t <= C1_STEPS; t++) if (col[t] !== 0) return { ok: false, detail: `${k}[${t}] = ${col[t]}` };
  }
  if (!z.hashZ || !z.hashR) return { ok: false, detail: "full-state hash missing" };
  return z.hashZ === z.hashR ? { ok: true } : { ok: false, detail: "full-state hash differs at step 100" };
}

/** C2 exact ledgers: for every sim, matter at the end equals its initial total (decimal strings, BigInt-safe) and the ledger residual is 0. */
export function checkC2(sims: readonly { name: string; matterStart: string; matterEnd: string; residual: string }[]): CheckResult {
  for (const s of sims) {
    if (s.matterStart !== s.matterEnd) return { ok: false, detail: `${s.name}: matter ${s.matterStart} -> ${s.matterEnd}` };
    if (BigInt(s.residual) !== 0n) return { ok: false, detail: `${s.name}: ledger residual ${s.residual}` };
  }
  return { ok: true };
}

/** C3 legal state: `validateState` returned no errors for the S twin's state right after the kick. */
export const checkC3 = (validateStateErrors: readonly string[]): CheckResult => (validateStateErrors.length === 0 ? { ok: true } : { ok: false, detail: validateStateErrors.join("; ") });

export type M4Mode = "json" | "tsv-rounded";

/** The settings a job's world is, for C4: the axes M4 never varied (diffusion, gate, dtQ, spread, mutRate) must be at base. */
export interface C4Subject {
  kind: "slab" | "2d";
  seed: number;
  dev: boolean;
  /** The job changes a key M4 never varied (groups C and D, the control). */
  changedUnvariedKey: boolean;
}
/** C4 applies only to slab jobs of M4's grid (groups A and B and the gate worlds) at seeds 101 to 103; never to development seeds, 2D worlds, extension seeds, groups C and D or the control (R5). */
export function c4Applicable(s: C4Subject): boolean {
  return s.kind === "slab" && !s.dev && [101, 102, 103].includes(s.seed) && !s.changedUnvariedKey;
}

/**
 * C4 living-trace agreement with M4 at every multiple of 5,000 steps up to T. Mode `json`: exact equality with M4's per-run JSON.
 * Mode `tsv-rounded`: `|living / cells - tsv| <= 0.00005` (the TSV has four decimals). For an extinct run `extinctAt` must equal M4's.
 * Not applicable: `{ applicable: false, ok: true }` (recorded as `m4Source: none`, skipped, never counted as passed).
 */
export function checkC4(i: {
  subject: C4Subject;
  mode?: M4Mode;
  cells: number;
  living5k: readonly number[];
  m4Living5k?: readonly number[];
  m4Tsv5k?: readonly number[];
  extinctAt?: number | null;
  m4ExtinctAt?: number | null;
}): CheckResult & { mode: M4Mode | "none" } {
  if (!c4Applicable(i.subject)) return { ok: true, applicable: false, mode: "none" };
  const mode: M4Mode = i.mode ?? "json";
  if ((i.extinctAt ?? null) !== (i.m4ExtinctAt ?? null)) return { ok: false, mode, detail: `extinctAt ${i.extinctAt} against M4's ${i.m4ExtinctAt}` };
  if (mode === "json") {
    const ref = i.m4Living5k ?? [];
    if (ref.length !== i.living5k.length) return { ok: false, mode, detail: "trace length differs" };
    for (let t = 0; t < ref.length; t++) if (ref[t] !== i.living5k[t]) return { ok: false, mode, detail: `living at ${5000 * (t + 1)}: ${i.living5k[t]} against ${ref[t]}` };
    return { ok: true, mode };
  }
  const ref = i.m4Tsv5k ?? [];
  if (ref.length !== i.living5k.length) return { ok: false, mode, detail: "trace length differs" };
  for (let t = 0; t < ref.length; t++) if (Math.abs(i.living5k[t] / i.cells - ref[t]) > 0.00005) return { ok: false, mode, detail: `living fraction at ${5000 * (t + 1)}` };
  return { ok: true, mode };
}

/**
 * The repro line of R13 from the jobs' C4 modes: comparisons by exact JSON (passed of total), by rounded TSV (passed of total) and the jobs
 * to which C4 does not apply (`m4Mode: "none"` or absent). A job whose C4 failed is in the total and not in the passed count.
 */
export function reproCounts(jobs: readonly JobSummary[]): { json: { passed: number; total: number }; tsv: { passed: number; total: number }; notApplicable: number } {
  const out = { json: { passed: 0, total: 0 }, tsv: { passed: 0, total: 0 }, notApplicable: 0 };
  for (const j of jobs) {
    if (j.m4Mode === "json" || j.m4Mode === "tsv-rounded") {
      const bucket = j.m4Mode === "json" ? out.json : out.tsv;
      bucket.total++;
      if (!j.invalidChecks.includes("C4")) bucket.passed++;
    } else out.notApplicable++;
  }
  return out;
}

/** The gate refuses any C4 that is not mode `json` (R5, R9.2 G1): `tsv-rounded` proves less. */
export const c4GateAccepts = (r: CheckResult & { mode: M4Mode | "none" }): boolean => r.ok && r.applicable !== false && r.mode === "json";

/**
 * C5 initial damage: the pass before step 1 shows n_live = 0, L1_A = L1_P = 0, L1_B = L1_C = the sum of the kicks, n_blk equal to the
 * number of kicked blocks whose kicks sum to at least thetaB (P1: m_S, since the sites are 5 blocks apart), and under P1 n_occ = 0.
 */
export function checkC5(i: { row0: DiffRow; plan: KickPlan; thetaB: number; rung: Rung }): CheckResult {
  const r = i.row0;
  const expectBlk = Array.from(i.plan.blockSums).filter((s) => s >= i.thetaB).length;
  if (r.n_live !== 0 || r.L1_A !== 0 || r.L1_P !== 0) return { ok: false, detail: "A, P or living status differs before step 1" };
  if (r.L1_B !== i.plan.total || r.L1_C !== i.plan.total) return { ok: false, detail: `L1_B = ${r.L1_B}, L1_C = ${r.L1_C}, kicks sum ${i.plan.total}` };
  if (r.n_blk !== expectBlk) return { ok: false, detail: `n_blk = ${r.n_blk}, expected ${expectBlk}` };
  if (i.rung === "P1" && r.n_occ !== 0) return { ok: false, detail: "n_occ is not 0 under P1" };
  return { ok: true };
}

/** C6 stamp: ruleSha equals the recorded hash; codeCommit and srcHash present; the tree was clean. `dev` jobs are tagged and never enter a readout. */
export function checkC6(i: { ruleSha?: string; ruleShaRecorded: string; codeCommit?: string; srcHash?: string; treeClean?: boolean }): CheckResult {
  if (!i.ruleSha || i.ruleSha !== i.ruleShaRecorded) return { ok: false, detail: "ruleSha differs from RULE.sha256" };
  if (!i.codeCommit || !i.srcHash) return { ok: false, detail: "codeCommit or srcHash missing" };
  if (i.treeClean !== true) return { ok: false, detail: "tree not clean" };
  return { ok: true };
}

/** C7 living identity: live_R at the last step run (from the diff log) equals R's `readStats().living`. */
export const checkC7 = (liveRLast: number, living: number): CheckResult => (liveRLast === living ? { ok: true } : { ok: false, detail: `${liveRLast} against ${living}` });

/** C8 control configurations: the keys on which a sim's configuration differs from R's equal exactly the stated list. */
export function checkC8(differing: readonly string[], expected: readonly string[]): CheckResult {
  const a = [...differing].sort().join(",");
  const b = [...expected].sort().join(",");
  return a === b ? { ok: true } : { ok: false, detail: `differs in [${a}], expected [${b}]` };
}

// =====================================================================================================================
// R2 Settings, job ids

export const AXES = ["mu", "sigma", "lightK", "diffA", "diffC", "diffS", "gateK", "dtQ", "spread"] as const;
export type Axis = (typeof AXES)[number];
/** The nine swept constants of a slab setting (R2.3). `mutRate: 0` marks the control. */
export interface SettingParams {
  mu: number;
  sigma: number;
  lightK: number;
  diffA: number;
  diffC: number;
  diffS: number;
  gateK: number;
  dtQ: number;
  spread: number;
  mutRate0?: boolean;
}
/** B0, the base (the nearest miss of M4): mu30-s8-k256. */
export const B0_PARAMS: SettingParams = Object.freeze({ mu: 30, sigma: 8, lightK: 256, diffA: 200, diffC: 200, diffS: 150, gateK: 64, dtQ: 51, spread: 8 });
export const B0_ID = "mu30-s8-k256";
/** The tested value lists, ascending (R10 bracket): adjacency in these lists is what "adjacent" means. */
export const AXIS_LISTS: Readonly<Record<Axis, readonly number[]>> = Object.freeze({
  mu: [20, 30, 40],
  sigma: [8, 12, 16, 20],
  lightK: [256, 1024, 4096],
  diffA: [100, 200, 240],
  diffC: [100, 200, 240],
  diffS: [75, 150, 240],
  gateK: [16, 64, 256, 1024],
  dtQ: [26, 51, 102],
  spread: [4, 8, 16],
});

export type SettingGroup = "A" | "B" | "C" | "D" | "control";
export interface SettingSpec {
  id: string;
  group: SettingGroup;
  params: SettingParams;
  control: boolean;
  /** The `presetConfig` overrides this setting names (R2.1). */
  overrides: Record<string, number>;
}

const AXIS_SUFFIX: Partial<Record<Axis, string>> = { diffA: "dA", diffC: "dC", diffS: "dS", gateK: "gK", dtQ: "dtQ", spread: "sp" };

/** The setting id: `mu<mu>-s<sigma>-k<lightK>` plus a suffix per changed C or D axis (`-dA100`, `-gK16`, `-dtQ26`, `-sp4`) and `-nomut` for the control. */
export function settingId(p: SettingParams): string {
  let id = `mu${p.mu}-s${p.sigma}-k${p.lightK}`;
  for (const a of ["diffA", "diffC", "diffS", "gateK", "dtQ", "spread"] as const) if (p[a] !== B0_PARAMS[a]) id += `-${AXIS_SUFFIX[a]}${p[a]}`;
  if (p.mutRate0) id += "-nomut";
  return id;
}

/** The swept axes along which a setting differs from B0 (the control differs along none). */
export function axesDiffering(p: SettingParams, base: SettingParams = B0_PARAMS): Axis[] {
  return AXES.filter((a) => p[a] !== base[a]);
}

function specOf(group: SettingGroup, p: SettingParams): SettingSpec {
  const overrides: Record<string, number> = { defaultMu: p.mu, defaultSigma: p.sigma, lightK: p.lightK };
  for (const a of ["diffA", "diffC", "diffS", "gateK", "dtQ", "spread"] as const) if (p[a] !== B0_PARAMS[a]) overrides[a] = p[a];
  if (p.mutRate0) overrides.mutRate = 0;
  return { id: settingId(p), group, params: p, control: group === "control", overrides };
}

/** The 32 settings of the sweep (R2.3): group A 12, B 6, C 9, D 4 and the `mutRate` control (31 sweep settings and the control). */
export function sweepSettings(): SettingSpec[] {
  const out: SettingSpec[] = [];
  for (const mu of [20, 30, 40]) for (const sigma of [8, 12, 16, 20]) out.push(specOf("A", { ...B0_PARAMS, mu, sigma }));
  for (const lightK of [1024, 4096]) for (const sigma of [8, 16, 20]) out.push(specOf("B", { ...B0_PARAMS, mu: 30, sigma, lightK }));
  for (const v of [100, 240]) out.push(specOf("C", { ...B0_PARAMS, diffA: v }));
  for (const v of [100, 240]) out.push(specOf("C", { ...B0_PARAMS, diffC: v }));
  for (const v of [75, 240]) out.push(specOf("C", { ...B0_PARAMS, diffS: v }));
  for (const v of [16, 256, 1024]) out.push(specOf("C", { ...B0_PARAMS, gateK: v }));
  for (const v of [26, 102]) out.push(specOf("D", { ...B0_PARAMS, dtQ: v }));
  for (const v of [4, 16]) out.push(specOf("D", { ...B0_PARAMS, spread: v }));
  out.push(specOf("control", { ...B0_PARAMS, mutRate0: true }));
  return out;
}

/** Adjacent in the axis's tested list (R10 bracket, R12.2). */
export function adjacentInList(axis: Axis, a: number, b: number): boolean {
  const L = AXIS_LISTS[axis];
  const i = L.indexOf(a);
  const j = L.indexOf(b);
  return i >= 0 && j >= 0 && Math.abs(i - j) === 1;
}

/** Ranking candidates of an axis (R12.2): the settings that differ from B0 along that axis alone and sit next to B0's value in the tested list. */
export function axisCandidateIds(axis: Axis, specs: readonly { id: string; params: SettingParams; control: boolean }[] = sweepSettings()): string[] {
  return specs
    .filter((s) => !s.control)
    .filter((s) => {
      const d = axesDiffering(s.params);
      return d.length === 1 && d[0] === axis && adjacentInList(axis, s.params[axis], B0_PARAMS[axis]);
    })
    .map((s) => s.id);
}

export type JobRole = "SWEEP" | "G1" | "G2" | "G3" | "G4" | "B0";

/** R2.4: `[dev-]slab|2d-<setting>-seed<n>-t<T>-<rung>[-<decider>]`. A sweep job ends with its rung and decider; a gate or Stage 0 job with its rung. */
export function jobId(i: { dev?: boolean; kind: "slab" | "2d"; world: string; seed: number; T: number; rung: Rung; decider?: Decider }): string {
  return `${i.dev ? "dev-" : ""}${i.kind}-${i.world}-seed${i.seed}-t${i.T}-${i.rung}${i.decider ? `-${i.decider}` : ""}`;
}

// =====================================================================================================================
// Rosters (R9.0, R9.1, R2.3): the jobs a stage consists of

/** The slab worlds of the gate (R9.1) by their M4 axes: G1 the known dead world, G3 the known carpet, G4 the starved relic. */
export const GATE_SLABS: Readonly<Record<"G1" | "G3" | "G4", { readonly mu: number; readonly sigma: number; readonly lightK: number }>> = Object.freeze({
  G1: Object.freeze({ mu: 20, sigma: 8, lightK: 256 }),
  G3: Object.freeze({ mu: 60, sigma: 8, lightK: 1024 }),
  G4: Object.freeze({ mu: 20, sigma: 8, lightK: 4096 }),
});
/**
 * The start steps at which the 2D reference worlds are read (R1, R9.1): T1 = 50,000 and T2 = 100,000. They are not read at T0 = 20,000: the registered 2D
 * worlds are still filling then (rehearsal seed 9911: `spots-m3` 0.981 living at 20,000, 0.370 at 50,000, 0.437 at 100,000), so a T0 read would give
 * REF-UNDEFINED on a transient. The slab jobs are read at T0 (G1 of the answers of 2026-10-24).
 */
export const refTimes = (c: RegimeConstants = REGIME): readonly number[] => [c.T1, c.T2];

/** The setting id of a gate slab world: `mu20-s8-k256`, `mu60-s8-k1024`, `mu20-s8-k4096`. */
export const gateSlabId = (role: "G1" | "G3" | "G4"): string => settingId({ ...B0_PARAMS, ...GATE_SLABS[role] });
/** Jobs per group in the gate and Stage 0: "2 of its 3 jobs" (R9.2) presumes three. */
export const GATE_GROUP_JOBS = 3;

/** One job of a stage: a world read at a time. The runner writes one file per rung for a gate or Stage 0 job and one file for a sweep job. */
export interface RosterJob {
  role: JobRole;
  kind: "slab" | "2d";
  world: string;
  seed: number;
  T: number;
  dev: boolean;
}

/**
 * The jobs of the Stage 0 queue (R9.0: G3, B0 and the two 2D presets at T1 and T2, on seeds 9001 to 9003: 18 jobs) or of the held-out gate
 * (R9.1: G1 and G3 on seeds 101 to 103, G4 on 101 and 102, the two presets at T1 and T2 on 101 to 103: 20 jobs). The runner's `jobList`
 * must list exactly these (tests/deno/regime_runner.ts checks it).
 */
export function expectedRoster(stage: "dev" | "gate", c: RegimeConstants = REGIME): RosterJob[] {
  const dev = stage === "dev";
  const seeds = dev ? SEEDS.dev : SEEDS.main;
  const out: RosterJob[] = [];
  const slab = (role: JobRole, world: string, seed: number) => out.push({ role, kind: "slab", world, seed, T: c.T0, dev });
  if (dev) {
    for (const s of seeds) slab("G3", gateSlabId("G3"), s);
    for (const s of seeds) slab("B0", B0_ID, s);
  } else {
    for (const s of seeds) slab("G1", gateSlabId("G1"), s);
    for (const s of seeds) slab("G3", gateSlabId("G3"), s);
    for (const s of seeds.filter((x) => x === 101 || x === 102)) slab("G4", gateSlabId("G4"), s);
  }
  for (const p of GATE_PRESETS) for (const s of seeds) for (const T of refTimes(c)) out.push({ role: "G2", kind: "2d", world: p, seed: s, T, dev });
  return out;
}

/** The main stage (R2.3): every setting of `specs` at each seed and T0 (the 32 settings at seeds 101 to 103: 96 jobs). */
export function sweepRoster(specs: readonly { id: string }[] = sweepSettings(), seeds: readonly number[] = SEEDS.main, T: number = REGIME.T0): RosterJob[] {
  const out: RosterJob[] = [];
  for (const s of specs) for (const seed of seeds) out.push({ role: "SWEEP", kind: "slab", world: s.id, seed, T, dev: false });
  return out;
}

/** The key under which a job's files are joined (the same for its two rung files): kind, world, seed, T and dev. */
export const rosterKey = (j: { kind: string; world: string; seed: number; T: number; dev?: boolean }): string => `${j.kind}|${j.world}|${j.seed}|${j.T}|${j.dev ? "dev" : "main"}`;
/** A job named for a message: `G2 spots-m3 seed 101 T 50000`. */
export const rosterLabel = (j: { role: string; world: string; seed: number; T: number }): string => `${j.role} ${j.world} seed ${j.seed} T ${j.T}`;

/**
 * The jobs the decisions of the gate (G1, G2, G3) or of Stage 0 (G2, G3) need and the list does not hold. G4 and B0 are informational and are not
 * decided here (the reader refuses their absence). Matching is by role, world, seed and T.
 */
export function gateRosterGaps(jobs: readonly { role: string; world: string; seed: number; T: number }[], stage: "dev" | "gate", c: RegimeConstants = REGIME): RosterJob[] {
  const have = new Set(jobs.map((j) => `${j.role}|${j.world}|${j.seed}|${j.T}`));
  return expectedRoster(stage, c).filter((e) => (e.role === "G1" || e.role === "G2" || e.role === "G3") && !have.has(`${e.role}|${e.world}|${e.seed}|${e.T}`));
}

// =====================================================================================================================
// Job JSON and its summary

/**
 * One job's JSON (one rung's twin phase): the burn-in facts, the bank of twins and the check results (plan 8.4). `world` is the setting
 * id for a slab job (`mu30-s8-k256`) and the preset id for a 2D job (`spots-m3`). Fields beyond these (timings, entropy, divergence,
 * hashes) ride along; the pure functions read only what is declared here.
 */
export interface RegimeJob {
  id: string;
  role: JobRole;
  kind: "slab" | "2d";
  world: string;
  seed: number;
  T: number;
  dev?: boolean;
  /** Step of extinction in the burn-in, or null. */
  extinctAt: number | null;
  /** Voxels in the world, living voxels at T, B* and N_E (null/0 when there is no target). */
  cells: number;
  living: number;
  Bstar: number | null;
  NE: number;
  liveblkT: number;
  liveT: number;
  h0: number;
  /** live_R at every step of the twin phase (the diff log) and R's living count at its end (R3 items 6 and 7). */
  liveR: number[];
  livingEnd: number;
  bank?: TwinBank;
  checks: Partial<Record<CheckName, CheckResult>>;
  ruleSha?: string;
  codeCommit?: string;
  srcHash?: string;
  treeClean?: boolean;
  m4Mode?: M4Mode | "none";
}

export interface JobSummary {
  id: string;
  role: JobRole;
  kind: "slab" | "2d";
  world: string;
  seed: number;
  T: number;
  dev: boolean;
  invalid: boolean;
  invalidChecks: CheckName[];
  extinct: boolean;
  extinctAt: number | null;
  noTarget: boolean;
  /** Living fraction at T. */
  f: number;
  /** The window flag at T (METERED jobs only). */
  flag: WindowFlag | null;
  diedInPhase: boolean;
  drift: boolean;
  stamps: { ruleSha?: string; codeCommit?: string; srcHash?: string };
  m4Mode?: M4Mode | "none";
  /** One reading per combination analysed (a sweep job: the selected one; a Stage 0 or gate job: up to four). */
  readings: Partial<Record<ComboKey, JobReading>>;
}

/** R3, R5 and the readings of one job JSON (every decider of the bank's rung unless `deciders` says otherwise). */
export function summarizeJob(job: RegimeJob, deciders: readonly Decider[] = ["net", "occ"], c: RegimeConstants = REGIME): JobSummary {
  const f = job.cells > 0 ? job.living / job.cells : 0;
  const st = startState({ extinct: job.extinctAt !== null, Bstar: job.Bstar, NE: job.NE, f }, c);
  const inv = [...new Set([...invalidChecks(job.checks), ...missingChecks(job.checks, st.status)])].sort() as CheckName[];
  const out: JobSummary = {
    id: job.id, role: job.role, kind: job.kind, world: job.world, seed: job.seed, T: job.T, dev: !!job.dev,
    invalid: inv.length > 0, invalidChecks: inv, extinct: job.extinctAt !== null, extinctAt: job.extinctAt,
    noTarget: st.status === "NO_TARGET", f, flag: st.flag, diedInPhase: false, drift: false,
    stamps: { ruleSha: job.ruleSha, codeCommit: job.codeCommit, srcHash: job.srcHash }, m4Mode: job.m4Mode, readings: {},
  };
  if (st.status === "METERED" && job.bank) {
    const ph = phaseState({ liveR: job.liveR, fEnd: job.cells > 0 ? job.livingEnd / job.cells : 0, startFlag: st.flag }, c);
    out.diedInPhase = ph.diedInPhase;
    out.drift = ph.drift;
    for (const d of deciders)
      out.readings[comboKey({ rung: job.bank.rung, decider: d })] = analyzeBank({ liveblkT: job.liveblkT, liveT: job.liveT, h0: job.h0, diedInPhase: ph.diedInPhase, drift: ph.drift }, job.bank, d, c);
  }
  return out;
}

/** Merges the summaries of one job's two rung files (same world, seed and T) into one with both rungs' readings. */
export function mergeSummaries(parts: readonly JobSummary[]): JobSummary {
  const first = parts[0];
  const readings: Partial<Record<ComboKey, JobReading>> = {};
  for (const p of parts) Object.assign(readings, p.readings);
  return {
    ...first, invalid: parts.some((p) => p.invalid), invalidChecks: [...new Set(parts.flatMap((p) => p.invalidChecks))].sort() as CheckName[],
    diedInPhase: parts.some((p) => p.diedInPhase), drift: parts.some((p) => p.drift), readings,
  };
}

// =====================================================================================================================
// R8 Setting class

export type SettingStatus = "UNMETERABLE" | "CARPET" | "RELIC" | "WINDOWED";
export type SettingClass = RegimeClass | "SPLIT" | "DUSTY" | "INSUFFICIENT";

const bySeed = (a: JobSummary, b: JobSummary) => a.seed - b.seed;

/**
 * R8.1: from the first three seeds' job statuses (the three lowest seeds present; an extended setting's status stays that of its
 * first three). UNMETERABLE if at least 2 are EXTINCT, NO_TARGET or DIED_IN_PHASE; else CARPET if at least 2 are flagged CARPET at T;
 * else RELIC if at least 2 are flagged RELIC at T; else windowed. INVALID jobs are excluded from every count.
 */
export function settingStatus(jobs: readonly JobSummary[]): SettingStatus {
  const first = [...jobs].filter((j) => !j.invalid).sort(bySeed).slice(0, 3);
  const dead = first.filter((j) => j.extinct || j.noTarget || j.diedInPhase).length;
  if (dead >= 2) return "UNMETERABLE";
  if (first.filter((j) => j.flag === "CARPET").length >= 2) return "CARPET";
  if (first.filter((j) => j.flag === "RELIC").length >= 2) return "RELIC";
  return "WINDOWED";
}

/** R8.2: valid jobs are METERED, IN_WINDOW at T and at T + 1000, not INVALID, with a job class (so not FEW_DOSES, DIED_IN_PHASE or DRIFT). */
export function isValidJob(j: JobSummary, key: ComboKey): boolean {
  const r = j.readings[key];
  return !!r && !j.invalid && !j.extinct && !j.noTarget && j.flag === "IN_WINDOW" && !j.diedInPhase && !j.drift && !r.fewDoses && r.jobClass !== null;
}

/** A valid job votes if its class is ORDERED, CRITICAL or CHAOTIC and its dust state is CLEAR (R7.4, R8.2). */
export function isVotingJob(j: JobSummary, key: ComboKey): boolean {
  return isValidJob(j, key) && j.readings[key]!.vote;
}

export interface SettingResult {
  status: SettingStatus;
  /** The class, or null unless the setting is windowed. */
  cls: SettingClass | null;
  /** The class the valid jobs would have formed by majority had the dust rule not kept any from voting (printed for DUSTY). */
  wouldBe: RegimeClass | "SPLIT" | null;
  valid: number;
  voting: number;
  votes: Record<RegimeClass, number>;
  /** R8.4: median over the voting jobs of ln(max(s(TAU_DEC), S_FLOOR)); null with no voting job. */
  ell: number | null;
  /** The per-job values `ell` is the median of (their range is B0's NOISE, R12.4). */
  ellVals: number[];
  extended: boolean;
  /** Counts over the valid jobs for R10.5: jobs without a trajectory meter, jobs with a U twin, and of those the AMBIG or LIMITED ones. */
  nDonly: number;
  nWithU: number;
  nAmbigLimited: number;
}

const tally = (classes: readonly RegimeClass[]): Record<RegimeClass, number> => ({
  ORDERED: classes.filter((k) => k === "ORDERED").length,
  CRITICAL: classes.filter((k) => k === "CRITICAL").length,
  CHAOTIC: classes.filter((k) => k === "CHAOTIC").length,
});
/** The one class with at least `need` votes; null if none, or if two reach it (which three or six seeds cannot produce: ties never pick a class). */
const winner = (t: Record<RegimeClass, number>, need: number): RegimeClass | null => {
  const hit = REGIME_CLASSES.filter((k) => t[k] >= need);
  return hit.length === 1 ? hit[0] : null;
};

/**
 * R8.2 and R8.5 for one combination. Fewer than 2 valid jobs: INSUFFICIENT. Three seeds: with at least VOTE voting jobs, the class with at
 * least VOTE votes, else SPLIT; with fewer voting jobs DUSTY if at least VOTE valid jobs have a class that the dust rule kept from voting,
 * else SPLIT. Six seeds (`extended`): with at least 5 voting jobs the class with at least 4 votes, else SPLIT (no DUSTY: resolution W8).
 */
export function settingResult(jobs: readonly JobSummary[], combo: Combination, opts: { extended?: boolean } = {}, c: RegimeConstants = REGIME): SettingResult {
  const key = comboKey(combo);
  const status = settingStatus(jobs);
  const extended = !!opts.extended;
  const valid = jobs.filter((j) => isValidJob(j, key));
  const voting = valid.filter((j) => j.readings[key]!.vote);
  const kept = valid.filter((j) => isRegimeClass(j.readings[key]!.jobClass) && !j.readings[key]!.vote);
  const votes = tally(voting.map((j) => j.readings[key]!.jobClass as RegimeClass));
  const classed = valid.map((j) => j.readings[key]!.jobClass).filter(isRegimeClass);
  const allTally = tally(classed);
  const wb = winner(allTally, extended ? c.VOTE_EXT : c.VOTE);
  const wouldBe: RegimeClass | "SPLIT" | null = classed.length === 0 ? null : (wb ?? "SPLIT");
  const ellVals = voting.map((j) => j.readings[key]!.s30).filter(isNum).map((s) => Math.log(Math.max(s, c.S_FLOOR)));
  const base = {
    status, wouldBe, valid: valid.length, voting: voting.length, votes, ell: median(ellVals), ellVals, extended,
    nDonly: valid.filter((j) => j.readings[key]!.flags.includes("D_ONLY")).length,
    nWithU: valid.filter((j) => j.readings[key]!.dust !== "UNAVAILABLE").length,
    nAmbigLimited: valid.filter((j) => j.readings[key]!.dust === "AMBIG" || j.readings[key]!.dust === "LIMITED").length,
  };
  if (status !== "WINDOWED") return { ...base, cls: null };
  if (valid.length < 2) return { ...base, cls: "INSUFFICIENT" };
  if (extended) {
    if (voting.length >= c.VOTE_EXT_MIN) return { ...base, cls: winner(votes, c.VOTE_EXT) ?? "SPLIT" };
    return { ...base, cls: "SPLIT" };
  }
  if (voting.length >= c.VOTE) return { ...base, cls: winner(votes, c.VOTE) ?? "SPLIT" };
  return { ...base, cls: kept.length >= c.VOTE ? "DUSTY" : "SPLIT" };
}

export interface SettingRow {
  id: string;
  params: SettingParams;
  control: boolean;
  /** The seeds of the setting's jobs (three, or six after the extension): the late check re-burns the same seeds (R11). */
  seeds: number[];
  result: SettingResult;
}

/** R8.3 pool: windowed settings with at least 2 valid jobs (INSUFFICIENT excluded; SPLIT and DUSTY included); the control is not in the band logic. */
export const inPool = (r: SettingRow): boolean => !r.control && r.result.status === "WINDOWED" && r.result.cls !== null && r.result.cls !== "INSUFFICIENT";
/** The class-bearing pool settings: class ORDERED, CRITICAL or CHAOTIC. */
export const isClassBearing = (r: SettingRow): boolean => inPool(r) && isRegimeClass(r.result.cls);

/** The seeds each setting (job `world`) has jobs for, ascending. */
export function seedsByWorld(jobs: readonly JobSummary[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const j of jobs) (out[j.world] ??= []).push(j.seed);
  for (const k of Object.keys(out)) out[k].sort((a, b) => a - b);
  return out;
}

/**
 * One row per setting of the catalogue from the sweep's jobs under one combination (R8). A setting with jobs at the extension seeds (104 to 106)
 * is read by the six-seed rule (R8.5); a setting with no job reads INSUFFICIENT.
 */
export function buildSettingRows(jobs: readonly JobSummary[], combo: Combination, specs: readonly SettingSpec[] = sweepSettings(), c: RegimeConstants = REGIME): SettingRow[] {
  return specs.map((sp) => {
    const own = jobs.filter((j) => j.world === sp.id);
    const extended = own.some((j) => SEEDS.extension.includes(j.seed));
    return { id: sp.id, params: sp.params, control: sp.control, seeds: own.map((j) => j.seed).sort((a, b) => a - b), result: settingResult(own, combo, { extended }, c) };
  });
}

// =====================================================================================================================
// R9 Ground-truth gate and Stage 0

/** A failure cause with the job ids (or group labels) it was found in. */
export interface GateCause {
  code: string;
  where: string[];
}
const addCause = (causes: GateCause[], code: string, where: string[]) => {
  const hit = causes.find((x) => x.code === code);
  if (hit) hit.where.push(...where.filter((w) => !hit.where.includes(w)));
  else causes.push({ code, where: [...where] });
};
export const GATE_PRESETS: readonly string[] = Object.freeze(["spots-m3", "gradient-m3"]);

/**
 * A gate vote (R9.2: a vote is as in R8.2, so MIXED, UNSTABLE and non-CLEAR jobs vote for nothing). `window` requires the job to be IN_WINDOW
 * (G2); `any` ignores the CARPET flag (G3 "whatever the CARPET flag": resolution W4). INVALID, extinct, no-target, DIED_IN_PHASE and DRIFT jobs never vote.
 */
function gateVotes(j: JobSummary, key: ComboKey, mode: "window" | "any"): boolean {
  const r = j.readings[key];
  if (!r || j.invalid || j.extinct || j.noTarget || j.diedInPhase || j.drift) return false;
  if (mode === "window" && j.flag !== "IN_WINDOW") return false;
  return r.vote;
}

/** The class held by at least VOTE of a group's voting jobs, or null. */
export function groupClass(jobs: readonly JobSummary[], combo: Combination, mode: "window" | "any" = "window", c: RegimeConstants = REGIME): RegimeClass | null {
  const key = comboKey(combo);
  return winner(tally(jobs.filter((j) => gateVotes(j, key, mode)).map((j) => j.readings[key]!.jobClass as RegimeClass)), c.VOTE);
}

const groupLabel = (world: string, T: number) => `${world}@${T}`;

export interface G2Result {
  holds: boolean;
  /** The class the alive 2D worlds share (CRITICAL or CHAOTIC), or null. */
  refClass: RegimeClass | null;
  /** The class held by 2 of 3 jobs per `preset@T`, or null. */
  classes: Record<string, RegimeClass | null>;
  causes: GateCause[];
}

/**
 * G2 (R9.2): for each preset and at each of T1 and T2 (`refTimes`) some class is held by at least 2 of its 3 jobs, that class is CRITICAL or CHAOTIC, it is the
 * same at T1 and T2, and the two presets agree. Causes: REF-ORDERED, REF-UNDEFINED, REF-UNSTABLE (a preset's class changes between the two times),
 * REFS-DISAGREE (two internally stable presets with different classes).
 */
export function evaluateG2(jobs: readonly JobSummary[], combo: Combination, c: RegimeConstants = REGIME): G2Result {
  const classes: Record<string, RegimeClass | null> = {};
  const causes: GateCause[] = [];
  const times = refTimes(c);
  const perPreset: Record<string, (RegimeClass | null)[]> = {};
  for (const preset of GATE_PRESETS) {
    perPreset[preset] = times.map((T) => {
      const cls = groupClass(jobs.filter((j) => j.role === "G2" && j.world === preset && j.T === T), combo, "window", c);
      classes[groupLabel(preset, T)] = cls;
      return cls;
    });
  }
  const entries = Object.entries(classes);
  const ordered = entries.filter(([, v]) => v === "ORDERED").map(([k]) => k);
  const undef = entries.filter(([, v]) => v === null).map(([k]) => k);
  if (ordered.length) addCause(causes, "REF-ORDERED", ordered);
  if (undef.length) addCause(causes, "REF-UNDEFINED", undef);
  const unstable = GATE_PRESETS.filter((p) => new Set(perPreset[p].filter((v): v is RegimeClass => v !== null)).size > 1);
  if (unstable.length) addCause(causes, "REF-UNSTABLE", [...unstable]);
  const stableClass = GATE_PRESETS.map((p) => {
    const defined = perPreset[p].filter((v): v is RegimeClass => v !== null);
    return defined.length > 0 && new Set(defined).size === 1 ? defined[0] : null;
  });
  if (stableClass.every((v) => v !== null) && stableClass[0] !== stableClass[1]) addCause(causes, "REFS-DISAGREE", [...GATE_PRESETS]);
  const refClass = causes.length === 0 ? (stableClass[0] as RegimeClass) : null;
  return { holds: causes.length === 0, refClass, classes, causes };
}

/** G3: some class is held by at least 2 of the 3 carpet jobs (whatever the CARPET flag) and differs from refClass. Causes: CARPET-UNDEFINED, CARPET-NOT-SEPARATED. */
export function evaluateG3(jobs: readonly JobSummary[], combo: Combination, refClass: RegimeClass | null, c: RegimeConstants = REGIME): { holds: boolean; carpetClass: RegimeClass | null; causes: GateCause[] } {
  const g3 = jobs.filter((j) => j.role === "G3");
  const carpetClass = groupClass(g3, combo, "any", c);
  const causes: GateCause[] = [];
  const ids = g3.map((j) => j.id);
  if (carpetClass === null) addCause(causes, "CARPET-UNDEFINED", ids);
  else if (refClass !== null && carpetClass === refClass) addCause(causes, "CARPET-NOT-SEPARATED", ids);
  return { holds: carpetClass !== null && refClass !== null && carpetClass !== refClass, carpetClass, causes };
}

/**
 * G6 dust control: in each of spots-m3 and gradient-m3 at each time (T1 and T2) and in the carpet, at least 2 of the 3 jobs are DUST_CLEAR. A job with no U twin
 * is UNAVAILABLE, and so is a job that is absent (it is never DUST_CLEAR): a group of one CLEAR job and two missing ones fails with
 * DUST-CONTROL-UNAVAILABLE. `holds` is the count's verdict and does not depend on which causes were printed.
 */
export function evaluateG6(jobs: readonly JobSummary[], combo: Combination, c: RegimeConstants = REGIME): { holds: boolean; causes: GateCause[] } {
  const key = comboKey(combo);
  const causes: GateCause[] = [];
  let failed = false;
  const groups: [string, JobSummary[]][] = [];
  for (const preset of GATE_PRESETS) for (const T of refTimes(c)) groups.push([groupLabel(preset, T), jobs.filter((j) => j.role === "G2" && j.world === preset && j.T === T)]);
  groups.push(["carpet", jobs.filter((j) => j.role === "G3")]);
  for (const [label, js] of groups) {
    const state = (j: JobSummary): DustState => j.readings[key]?.dust ?? "UNAVAILABLE";
    if (js.filter((j) => state(j) === "CLEAR").length >= 2) continue;
    failed = true;
    const present = new Set(js.map(state).filter((s) => s !== "CLEAR"));
    if (js.length < GATE_GROUP_JOBS) present.add("UNAVAILABLE");
    if (present.has("LIMITED")) addCause(causes, "DUST-LIMITED", [label]);
    if (present.has("AMBIG")) addCause(causes, "DUST-AMBIGUOUS", [label]);
    if (present.has("UNAVAILABLE")) addCause(causes, "DUST-CONTROL-UNAVAILABLE", [label]);
  }
  return { holds: !failed, causes };
}

/** G7 controls, in every metered G2 and G3 job: N saturates (satFrac at step 100 >= SAT); the F pair's T-class is ORDERED (NA fails); n_dec,F < n_dec,S < n_dec,N at TAU_DEC, strictly. */
export function evaluateG7(jobs: readonly JobSummary[], combo: Combination, c: RegimeConstants = REGIME): { holds: boolean; causes: GateCause[] } {
  const key = comboKey(combo);
  const causes: GateCause[] = [];
  for (const j of jobs.filter((x) => (x.role === "G2" || x.role === "G3") && x.flag !== null)) {
    const r = j.readings[key];
    if (!r) continue;
    if (r.nSat100 === null || !(r.nSat100 >= c.SAT)) addCause(causes, "N-NOT-SATURATED", [j.id]);
    if (r.fClass !== "ORDERED") addCause(causes, "FROZEN-NOT-ORDERED", [j.id]);
    if (r.nDecF30 === null || r.nDecS30 === null || r.nDecN30 === null || !(r.nDecF30 < r.nDecS30 && r.nDecS30 < r.nDecN30)) addCause(causes, "NO-CONTRAST-WITH-CONTROLS", [j.id]);
  }
  return { holds: causes.length === 0, causes };
}

export interface GateEval {
  combo: Combination;
  /** The roster is complete (R9.0, R9.1): every job of G1 (gate only), G2 and G3 is present; a missing job is the cause INCOMPLETE. */
  roster: { holds: boolean; causes: GateCause[] };
  g1: { holds: boolean; causes: GateCause[] } | null;
  g2: G2Result;
  g3: { holds: boolean; carpetClass: RegimeClass | null; causes: GateCause[] };
  g5: { holds: boolean; causes: GateCause[] };
  g6: { holds: boolean; causes: GateCause[] };
  g7: { holds: boolean; causes: GateCause[] };
  /** R9.3: G1 (when evaluated), G2, G3, G5, G6 and G7 hold. */
  pass: boolean;
  causes: GateCause[];
  refClass: RegimeClass | null;
}

/**
 * The conditions of R9.2 for one combination. `withG1` is false in Stage 0 (G1 is a repro check against M4 and development seeds have no M4
 * data). G4 is recorded and never decides, G8 is informational (`ampLabel`).
 */
export function evaluateGate(jobs: readonly JobSummary[], combo: Combination, opts: { withG1: boolean; expectG1?: number } = { withG1: true }, c: RegimeConstants = REGIME): GateEval {
  let g1: GateEval["g1"] = null;
  if (opts.withG1) {
    const js = jobs.filter((j) => j.role === "G1");
    const ok = js.length >= (opts.expectG1 ?? 3) && js.every((j) => j.extinct && !j.invalid && j.m4Mode === "json");
    g1 = { holds: ok, causes: ok ? [] : [{ code: "G1-REPRO-FAIL", where: js.map((j) => j.id) }] };
  }
  const g2 = evaluateG2(jobs, combo, c);
  const g3 = evaluateG3(jobs, combo, g2.refClass, c);
  const bad = jobs.filter((j) => j.invalid).map((j) => j.id);
  const g5 = { holds: bad.length === 0, causes: bad.length ? [{ code: "INVALID-JOB", where: bad }] : [] };
  const g6 = evaluateG6(jobs, combo, c);
  const g7 = evaluateG7(jobs, combo, c);
  const gaps = gateRosterGaps(jobs, opts.withG1 ? "gate" : "dev", c);
  const roster = { holds: gaps.length === 0, causes: gaps.length ? [{ code: "INCOMPLETE", where: gaps.map(rosterLabel) }] : [] };
  const causes: GateCause[] = [];
  for (const part of [roster, g1, g2, g3, g5, g6, g7]) if (part) for (const x of part.causes) addCause(causes, x.code, x.where);
  const pass = roster.holds && (g1 ? g1.holds : true) && g2.holds && g3.holds && g5.holds && g6.holds && g7.holds;
  return { combo, roster, g1, g2, g3, g5, g6, g7, pass, causes, refClass: g2.refClass };
}

/** G8 (R9.8, informational): AMP-ROBUST if, under the other rung with the selected decider, both 2D presets read refClass at T1 with the same vote rule (resolution W10). */
export function ampLabel(jobs: readonly JobSummary[], selected: Combination, refClass: RegimeClass, c: RegimeConstants = REGIME): "AMP-ROBUST" | "AMP-DEPENDENT" {
  const other: Combination = { rung: selected.rung === "P1" ? "P2" : "P1", decider: selected.decider };
  const same = GATE_PRESETS.every((p) => groupClass(jobs.filter((j) => j.role === "G2" && j.world === p && j.T === c.T1), other, "window", c) === refClass);
  return same ? "AMP-ROBUST" : "AMP-DEPENDENT";
}

/**
 * The held-out gate for the selected combination (R9.3, R9.4): its evaluation decides; the other three combinations are evaluated for the readout
 * to print as information only and never change the result. The amplitude label (G8) is that of the selected combination's refClass.
 */
export function gateReport(jobs: readonly JobSummary[], selected: Combination, c: RegimeConstants = REGIME): {
  selected: GateEval;
  others: GateEval[];
  amp: "AMP-ROBUST" | "AMP-DEPENDENT" | null;
} {
  const sel = evaluateGate(jobs, selected, { withG1: true }, c);
  const others = COMBINATIONS.filter((x) => comboKey(x) !== comboKey(selected)).map((x) => evaluateGate(jobs, x, { withG1: true }, c));
  return { selected: sel, others, amp: sel.refClass ? ampLabel(jobs, selected, sel.refClass, c) : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage 0

/**
 * The quantities of one reading that lie within their margin of a threshold (R9.0 margin condition). Empty = none. The additive margins are
 * the closed intervals between the explicit cuts `centre - margin` and `centre + margin` (`Math.abs(x - centre) <= margin` would not hit a
 * value that sits exactly on a cut: |0.75 - 0.8| is 0.05000000000000004 in doubles).
 */
export function marginHits(r: JobReading, c: RegimeConstants = REGIME): string[] {
  const hits: string[] = [];
  const within = (x: number, centre: number, margin: number): boolean => x >= centre - margin && x <= centre + margin;
  if (r.ratioU !== null && (within(r.ratioU, c.DUST_CLEAR, c.MARGIN_RATIO) || within(r.ratioU, c.DUST_LIM, c.MARGIN_RATIO))) hits.push("ratioU");
  if (r.s30 !== null && r.s30 > 0 && [c.D_LO, c.D_HI].some((edge) => r.s30! >= edge / c.MARGIN_S && r.s30! <= edge * c.MARGIN_S)) hits.push("s30");
  if (r.stT !== null && within(r.stT, c.STABLE, c.MARGIN_ST)) hits.push("stT");
  for (let g = 0; g < r.gridR.length; g++) {
    const sf = r.gridSatFrac[g], rr = r.gridR[g];
    if (sf !== null && rr !== null && sf >= c.SAT / c.MARGIN_S && sf <= c.SAT * c.MARGIN_S && rr >= c.R_AMP / c.MARGIN_S && rr <= c.R_AMP * c.MARGIN_S) { hits.push("grid"); break; }
  }
  return hits;
}

/** What one rung's bank showed in go/no-go (b) or the threshold trigger: the job ids concerned, in encounter order. */
export interface RungFlags {
  ok: boolean;
  jobs: string[];
}

export interface GoNoGo {
  /** (a) the Z twin is exactly zero in every Stage 0 job (no job failed C1). A failure is a cause of all four combinations. */
  zExact: { ok: boolean; jobs: string[] };
  /**
   * (b) the U twin's block-net n_dec(TAU_DEC) / liveblk_R is at most SAT in every metered job that has a U twin (cause DUST-FLOOR; a job without one is `uEvidence`'s, not a pass). `ok` and
   * `jobs` are over both rungs' banks; `byRung` is what each rung's bank showed, and a failure fails only that rung's two combinations (answer G2 of 2026-10-24).
   */
  dustFloor: { ok: boolean; jobs: string[]; byRung: Record<Rung, RungFlags> };
  /** (c) the U twin's median |dB_blk| over its nonzero blocks at TAU_DEC, next to thetaB, per metered job and rung. */
  medianBlock: { job: string; rung: Rung; median: number; thetaB: number; exceeds: boolean }[];
  /**
   * The threshold trigger (R9.0): (c) exceeds thetaB or (b) fails in some metered Stage 0 job. `fired` and `jobs` are over both rungs' banks; `byRung` is the trigger of each rung's
   * bank: a rung whose trigger fired fails its two combinations with the cause DUST-THRESHOLD, and thetaB is never re-derived (answer G3 of 2026-10-24).
   */
  trigger: { fired: boolean; jobs: string[]; byRung: Record<Rung, { fired: boolean; jobs: string[] }> };
  /**
   * Where the U twin could be read (R9.0 missing evidence; final review F2). Per rung's bank: the metered job readings, those in which the U log exists (`assessed`) and the
   * ids of the others (`absent`: a FEW_SITES job runs no S twin and so no U twin). A job with no U log contributes nothing to (b), (c) or the trigger in that bank, so it is
   * neither a pass nor a failure; this field is what lets the readout say how many jobs the dust floor was actually read in instead of "every metered job".
   */
  uEvidence: Record<Rung, { metered: number; assessed: number; absent: string[] }>;
}

/**
 * R9.0 go/no-go reports and the threshold trigger over the Stage 0 jobs (every metered job, B0 included: resolution W11), per rung's bank (W11). A reading without a U log (a
 * FEW_SITES job) or without a nonzero block (the median of (c) is NA) is skipped by (b), (c) and the trigger, and `uEvidence` records that it was (W31).
 */
export function goNoGo(jobs: readonly JobSummary[], c: RegimeConstants = REGIME): GoNoGo {
  const zBad = jobs.filter((j) => j.invalidChecks.includes("C1")).map((j) => j.id);
  const floor: Record<Rung, Set<string>> = { P1: new Set(), P2: new Set() };
  const exceed: Record<Rung, Set<string>> = { P1: new Set(), P2: new Set() };
  const floorAll = new Set<string>();
  const exceedAll = new Set<string>();
  const medianBlock: GoNoGo["medianBlock"] = [];
  const uEvidence: GoNoGo["uEvidence"] = { P1: { metered: 0, assessed: 0, absent: [] }, P2: { metered: 0, assessed: 0, absent: [] } };
  const seenBank = new Set<string>();
  for (const j of jobs) {
    for (const r of Object.values(j.readings)) {
      if (!r) continue;
      // one count per job and rung's bank (a bank has a reading under each decider)
      if (!seenBank.has(`${j.id}|${r.rung}`)) {
        seenBank.add(`${j.id}|${r.rung}`);
        const ev = uEvidence[r.rung];
        ev.metered++;
        if (r.uNetCoverage30 !== null) ev.assessed++;
        else ev.absent.push(j.id);
      }
      if (r.uNetCoverage30 !== null && r.uNetCoverage30 > c.SAT) {
        floor[r.rung].add(j.id);
        floorAll.add(j.id);
      }
      if (r.uMedianBlock30 !== null && !medianBlock.some((m) => m.job === j.id && m.rung === r.rung)) {
        const exceeds = r.uMedianBlock30 > r.thetaB;
        medianBlock.push({ job: j.id, rung: r.rung, median: r.uMedianBlock30, thetaB: r.thetaB, exceeds });
        if (exceeds) {
          exceed[r.rung].add(j.id);
          exceedAll.add(j.id);
        }
      }
    }
  }
  const byRung = <T,>(f: (rung: Rung) => T): Record<Rung, T> => ({ P1: f("P1"), P2: f("P2") });
  const trigOf = (rung: Rung): string[] => [...new Set([...floor[rung], ...exceed[rung]])];
  const trigAll = [...new Set([...floorAll, ...exceedAll])];
  return {
    zExact: { ok: zBad.length === 0, jobs: zBad },
    dustFloor: { ok: floorAll.size === 0, jobs: [...floorAll], byRung: byRung((rung) => ({ ok: floor[rung].size === 0, jobs: [...floor[rung]] })) },
    medianBlock,
    trigger: { fired: trigAll.length > 0, jobs: trigAll, byRung: byRung((rung) => ({ fired: trigOf(rung).length > 0, jobs: trigOf(rung) })) },
    uEvidence,
  };
}

export interface Stage0Combo {
  combo: Combination;
  gate: GateEval;
  /** Job ids whose quantities lie within a margin of a threshold (the combination is MARGINAL), with the quantities. */
  marginal: { job: string; quantities: string[] }[];
  /** Every cause: the gate's, MARGINAL, the Z twin's failure (all four combinations) and this rung's DUST-FLOOR and DUST-THRESHOLD. */
  causes: GateCause[];
  /** This combination's rung showed no dust floor failure (go/no-go b) and its threshold trigger did not fire. */
  rung: { floorOk: boolean; triggerFired: boolean };
  satisfies: boolean;
}

export type Stage0Outcome = "STAGE0-PASS" | "STAGE0-FAIL" | "STAGE0-CLOSED";
export interface Stage0Result {
  run: number;
  outcome: Stage0Outcome;
  selected: Combination | null;
  combos: Stage0Combo[];
  goNoGo: GoNoGo;
}

/**
 * R9.0: for each combination in the fixed order (P1 net, P1 occ, P2 net, P2 occ) evaluate G2, G3, G5, G6, G7 and the margin condition on the
 * development jobs; the first that satisfies all of them, and for which go/no-go (a) (the Z twin: it fails all four combinations), go/no-go (b) (DUST-FLOOR) and the
 * threshold trigger (DUST-THRESHOLD) do not fail, is selected. (b) and the trigger are read in the bank of the combination's own rung: a failure there fails that rung's
 * two combinations only, and thetaB is never re-derived (W11). If none, the outcome is STAGE0-FAIL, or STAGE0-CLOSED when this was the last of the STAGE0_RUNS runs. A STAGE0-PASS is final
 * (W30): no further run is permitted, also when the other rung's trigger fired; the function keeps no state across runs (the run number is the finalizer's, D7).
 * Margins are read in the metered G2 and G3 jobs (B0 is informational).
 */
export function stage0(jobs: readonly JobSummary[], run: number, c: RegimeConstants = REGIME): Stage0Result {
  const go = goNoGo(jobs, c);
  const combos: Stage0Combo[] = COMBINATIONS.map((combo) => {
    const key = comboKey(combo);
    const gate = evaluateGate(jobs, combo, { withG1: false }, c);
    const marginal: Stage0Combo["marginal"] = [];
    for (const j of jobs.filter((x) => (x.role === "G2" || x.role === "G3") && x.flag !== null)) {
      const r = j.readings[key];
      const q = r ? marginHits(r, c) : [];
      if (q.length) marginal.push({ job: j.id, quantities: q });
    }
    const causes: GateCause[] = gate.causes.map((x) => ({ code: x.code, where: [...x.where] }));
    const floor = go.dustFloor.byRung[combo.rung];
    const trigger = go.trigger.byRung[combo.rung];
    if (marginal.length) addCause(causes, "MARGINAL", marginal.map((m) => m.job));
    if (!go.zExact.ok) addCause(causes, "Z-NOT-ZERO", go.zExact.jobs);
    if (!floor.ok) addCause(causes, "DUST-FLOOR", floor.jobs);
    if (trigger.fired) addCause(causes, "DUST-THRESHOLD", trigger.jobs);
    const satisfies = gate.roster.holds && gate.g2.holds && gate.g3.holds && gate.g5.holds && gate.g6.holds && gate.g7.holds && marginal.length === 0 && go.zExact.ok && floor.ok && !trigger.fired;
    return { combo, gate, marginal, causes, rung: { floorOk: floor.ok, triggerFired: trigger.fired }, satisfies };
  });
  const first = combos.find((x) => x.satisfies);
  const outcome: Stage0Outcome = first ? "STAGE0-PASS" : run >= c.STAGE0_RUNS ? "STAGE0-CLOSED" : "STAGE0-FAIL";
  return { run, outcome, selected: first ? first.combo : null, combos, goNoGo: go };
}

// ---------------------------------------------------------------------------------------------------------------------
// R10.1 invalid runs

/** R10.1: jobs that failed a check, and the stamps that differ across jobs (more than one ruleSha, codeCommit or srcHash). `dev` jobs never enter a readout and are ignored. */
export function validateRun(jobs: readonly JobSummary[]): { invalid: { id: string; checks: CheckName[] }[]; mixed: { ruleSha: string[]; codeCommit: string[]; srcHash: string[] }; fatal: boolean } {
  const js = jobs.filter((j) => !j.dev);
  const invalid = js.filter((j) => j.invalid).map((j) => ({ id: j.id, checks: j.invalidChecks }));
  const distinct = (k: "ruleSha" | "codeCommit" | "srcHash") => [...new Set(js.map((j) => j.stamps[k]).filter((v): v is string => typeof v === "string"))].sort();
  const mixed = { ruleSha: distinct("ruleSha"), codeCommit: distinct("codeCommit"), srcHash: distinct("srcHash") };
  const isMixed = mixed.ruleSha.length > 1 || mixed.codeCommit.length > 1 || mixed.srcHash.length > 1;
  return { invalid, mixed, fatal: invalid.length > 0 || isMixed };
}

// =====================================================================================================================
// R12 Axis ranking, brackets, INERT gateK

/** R12.3: a gateK setting is INERT if, for every seed, its `stateDigestT` equals B0's for the same seed (equal sums would not prove equal states). */
export function isInertGateK(digests: Readonly<Record<number, string>>, b0Digests: Readonly<Record<number, string>>): boolean {
  const seeds = Object.keys(b0Digests).map(Number);
  return seeds.length > 0 && seeds.every((s) => digests[s] !== undefined && digests[s] === b0Digests[s]);
}

/** The axes along which two settings differ. */
const axesBetween = (a: SettingParams, b: SettingParams): Axis[] => AXES.filter((x) => a[x] !== b[x]);

/**
 * The bracket of R10: two class-bearing pool settings that differ in exactly one swept axis, adjacent in that axis's tested list, one ORDERED and
 * one CHAOTIC. INERT settings (R12.3) form no bracket.
 */
export function findBrackets(rows: readonly SettingRow[], inert: ReadonlySet<string> = new Set()): { a: string; b: string; axis: Axis }[] {
  const cand = rows.filter((r) => isClassBearing(r) && !inert.has(r.id));
  const out: { a: string; b: string; axis: Axis }[] = [];
  for (let i = 0; i < cand.length; i++)
    for (let j = i + 1; j < cand.length; j++) {
      const d = axesBetween(cand[i].params, cand[j].params);
      if (d.length !== 1 || !adjacentInList(d[0], cand[i].params[d[0]], cand[j].params[d[0]])) continue;
      const classes = [cand[i].result.cls, cand[j].result.cls];
      if (classes.includes("ORDERED") && classes.includes("CHAOTIC")) {
        const [x, y] = [cand[i], cand[j]].sort((p, q) => (p.id < q.id ? -1 : 1));
        out.push({ a: x.id, b: y.id, axis: d[0] });
      }
    }
  return out;
}

/** R12.1 distance to the target of a log response ratio: CRITICAL: max(0, ln D_LO - ell, ell - ln D_HI); CHAOTIC: max(0, ln D_HI - ell). */
export function distanceToTarget(ell: number, refClass: RegimeClass, c: RegimeConstants = REGIME): number {
  if (refClass === "CRITICAL") return Math.max(0, Math.log(c.D_LO) - ell, ell - Math.log(c.D_HI));
  return Math.max(0, Math.log(c.D_HI) - ell);
}

export interface RankingRow {
  axis: Axis;
  /** Delta_a = d(B0) - min over the candidates of d; null with no candidates. */
  delta: number | null;
  /** The candidate that attains the minimum (ties: smaller |log2(x / x_B0)|, then id) and its value on the axis. */
  best: string | null;
  bestValue: number | null;
  direction: "raise" | "lower" | null;
  /** |log2(x_best / x_B0)|, the size of the change. */
  change: number | null;
  candidates: string[];
}

export type RankingKind = "RANKED" | "NO-RANKING" | "NO-AXIS";
/**
 * Why a ranking is NO-RANKING (R12.2): "B0" when B0 is not in the pool with a class and at least two voting jobs; "NO-CANDIDATE" when B0 qualifies but no swept axis has a
 * class-bearing candidate next to B0, so every Delta is NA and no constant was compared (answer G4 of 2026-10-24: this is not NO-AXIS, which says that none moves the meters).
 */
export type NoRankingReason = "B0" | "NO-CANDIDATE";
export interface Ranking {
  kind: RankingKind;
  /** Set exactly when `kind` is NO-RANKING. */
  reason: NoRankingReason | null;
  /** Axes in R12.4 order (defined Deltas first). Empty for NO-RANKING with reason B0; for NO-CANDIDATE every row has a null Delta. */
  rows: RankingRow[];
  /** The named axis (RANKED only). */
  top: RankingRow | null;
  /** NOISE: range of ln(max(s(TAU_DEC), S_FLOOR)) over B0's voting jobs (R12.4), and d(B0). */
  noise: number | null;
  dB0: number | null;
}

/**
 * R12.2 to R12.5. B0 must be in the pool with a class and `ell` defined, else NO-RANKING. Candidates of an axis are the class-bearing pool
 * settings that differ from B0 along that axis alone and sit next to B0's value in the tested list; INERT settings are excluded. Axes are
 * sorted by Delta descending; those within TIE of the top are ordered by the smaller change, then alphabetically. If the top Delta is below
 * max(NO_AXIS, NOISE) the kind is NO-AXIS. If every Delta is NA (no axis has a candidate) there is no top Delta and the kind is NO-RANKING with reason NO-CANDIDATE (W29).
 */
export function rankAxes(rows: readonly SettingRow[], refClass: RegimeClass, inert: ReadonlySet<string> = new Set(), c: RegimeConstants = REGIME): Ranking {
  const none: Ranking = { kind: "NO-RANKING", reason: "B0", rows: [], top: null, noise: null, dB0: null };
  const b0 = rows.find((r) => r.id === B0_ID);
  if (!b0 || !isClassBearing(b0) || b0.result.ell === null) return none;
  const dB0 = distanceToTarget(b0.result.ell, refClass, c);
  const vals = b0.result.ellVals;
  const noise = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  const ranked: RankingRow[] = AXES.map((axis) => {
    const ids = new Set(axisCandidateIds(axis, rows));
    const cands = rows.filter((r) => ids.has(r.id) && isClassBearing(r) && !inert.has(r.id) && r.result.ell !== null);
    if (cands.length === 0) return { axis, delta: null, best: null, bestValue: null, direction: null, change: null, candidates: [] };
    const scored = cands.map((r) => ({ r, d: distanceToTarget(r.result.ell!, refClass, c), change: Math.abs(Math.log2(r.params[axis] / B0_PARAMS[axis])) }));
    scored.sort((p, q) => p.d - q.d || p.change - q.change || (p.r.id < q.r.id ? -1 : p.r.id > q.r.id ? 1 : 0));
    const best = scored[0];
    return {
      axis, delta: dB0 - best.d, best: best.r.id, bestValue: best.r.params[axis], direction: best.r.params[axis] > B0_PARAMS[axis] ? "raise" : "lower",
      change: best.change, candidates: scored.map((s) => s.r.id),
    };
  });
  const defined = ranked.filter((r) => r.delta !== null).sort((a, b) => b.delta! - a.delta!);
  const undef = ranked.filter((r) => r.delta === null);
  // Every Delta NA: no constant was compared, so the rule cannot say that none moves the meters (that is NO-AXIS): NO-RANKING (R12.2, W29).
  if (defined.length === 0) return { kind: "NO-RANKING", reason: "NO-CANDIDATE", rows: undef, top: null, noise, dB0 };
  const topDelta = defined[0].delta!;
  const tied = defined.filter((r) => r.delta! >= topDelta - c.TIE);
  tied.sort((a, b) => a.change! - b.change! || (a.axis < b.axis ? -1 : 1));
  const ordered = [...tied, ...defined.filter((r) => !tied.includes(r)), ...undef];
  const noAxis = topDelta < Math.max(c.NO_AXIS, noise);
  return { kind: noAxis ? "NO-AXIS" : "RANKED", reason: null, rows: ordered, top: noAxis ? null : ordered[0], noise, dB0 };
}

// =====================================================================================================================
// R11 Late check

export type LateStatus = "AGREES" | "TRANSIENT" | "INCONCLUSIVE" | "PENDING" | "UNCHECKED-CAP";

/** R11 order of the target settings: fewer swept axes changed from B0 first (B0 first of all), then setting id. */
export function lateOrder(target0: readonly SettingRow[]): SettingRow[] {
  return [...target0].sort((a, b) => axesDiffering(a.params).length - axesDiffering(b.params).length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface LateResult {
  /** The first LATE_MAX target settings in `lateOrder`, and those beyond the cap (listed, never run, never agreeing). */
  late0: string[];
  uncheckedCap: string[];
  settings: Record<string, { status: LateStatus; cls: SettingClass | null; statusAtT1: SettingStatus | null; missing: string[] }>;
  outcome: "PENDING-LATE-CHECK" | "BAND-FOUND" | "LATE-INCONCLUSIVE" | "TRANSIENT-BAND";
  /** Job ids missing or INVALID at T1 (the PENDING list). */
  missing: string[];
  agrees: string[];
  transient: string[];
  inconclusive: string[];
}

/**
 * R11. For each setting of LATE0 the T1 jobs of its seeds (the three, or the six of an extended setting): PENDING while a late job is missing
 * or INVALID; otherwise AGREES if the setting is windowed and its class equals refClass, INCONCLUSIVE if it is windowed with fewer than 2 valid
 * jobs, else TRANSIENT (UNMETERABLE, CARPET or RELIC at T1, or SPLIT, DUSTY or another class). Outcome: PENDING-LATE-CHECK while any setting is
 * PENDING; else BAND-FOUND if one AGREES; else LATE-INCONCLUSIVE if one is INCONCLUSIVE; else TRANSIENT-BAND.
 */
export function lateCheck(
  i: { target0: readonly SettingRow[]; t1Jobs: readonly JobSummary[]; seedsOf?: Readonly<Record<string, readonly number[]>>; refClass: RegimeClass; combo: Combination },
  c: RegimeConstants = REGIME,
): LateResult {
  const ordered = lateOrder(i.target0);
  const late0 = ordered.slice(0, c.LATE_MAX).map((r) => r.id);
  const uncheckedCap = ordered.slice(c.LATE_MAX).map((r) => r.id);
  const settings: LateResult["settings"] = {};
  const missingAll: string[] = [];
  for (const id of late0) {
    const seeds = i.seedsOf?.[id] ?? ordered.find((r) => r.id === id)!.seeds;
    if (!seeds || seeds.length === 0) throw new Error(`lateCheck: no seeds known for ${id} (the setting row carries the seeds of its T0 jobs)`);
    const jobs = i.t1Jobs.filter((j) => j.world === id && j.T === c.T1);
    const missing: string[] = [];
    for (const s of seeds) {
      const j = jobs.find((x) => x.seed === s);
      if (!j || j.invalid) missing.push(j ? j.id : jobId({ kind: "slab", world: id, seed: s, T: c.T1, rung: i.combo.rung, decider: i.combo.decider }));
    }
    if (missing.length) {
      settings[id] = { status: "PENDING", cls: null, statusAtT1: null, missing };
      missingAll.push(...missing);
      continue;
    }
    const res = settingResult(jobs.filter((j) => seeds.includes(j.seed)), i.combo, { extended: seeds.length > 3 }, c);
    const status: LateStatus = res.status === "WINDOWED" && res.cls === i.refClass ? "AGREES" : res.status === "WINDOWED" && res.cls === "INSUFFICIENT" ? "INCONCLUSIVE" : "TRANSIENT";
    settings[id] = { status, cls: res.cls, statusAtT1: res.status, missing: [] };
  }
  for (const id of uncheckedCap) settings[id] = { status: "UNCHECKED-CAP", cls: null, statusAtT1: null, missing: [] };
  const by = (s: LateStatus) => late0.filter((id) => settings[id].status === s);
  const outcome = by("PENDING").length ? "PENDING-LATE-CHECK" : by("AGREES").length ? "BAND-FOUND" : by("INCONCLUSIVE").length ? "LATE-INCONCLUSIVE" : "TRANSIENT-BAND";
  return { late0, uncheckedCap, settings, outcome, missing: missingAll, agrees: by("AGREES"), transient: by("TRANSIENT"), inconclusive: by("INCONCLUSIVE") };
}

// =====================================================================================================================
// R10 Outcomes

export type AmpLabel = "AMP-ROBUST" | "AMP-DEPENDENT";
export type NoBandLabel = "all-ordered" | "all-chaotic" | "scattered";

export interface OutcomeInput {
  /** R10.1: `validateRun` of the jobs read. */
  validation: ReturnType<typeof validateRun>;
  /** R9.4: whether the held-out gate passed, the causes of the selected combination if it did not, and (information only) the other combinations' causes. */
  gate: { pass: boolean; causes: GateCause[]; others?: { combo: Combination; causes: GateCause[] }[] };
  /** The settings at T0 (the control flagged), the target class and the amplitude label. */
  rows: readonly SettingRow[];
  refClass: RegimeClass;
  amp: AmpLabel;
  /** Whether the seed extension (R8.5) has been run, so that a repeat of UNRESOLVED is final. */
  extended: boolean;
  /** The selected combination and the T1 data of the late check (R11); `t1Jobs` empty means no late job has run yet. */
  combo: Combination;
  late: { t1Jobs: readonly JobSummary[]; seedsOf?: Readonly<Record<string, readonly number[]>> };
  /** INERT gateK settings (R12.3). */
  inert?: ReadonlySet<string>;
}

interface OutcomeBase {
  /** The readout exits non-zero (INVALID-RUN). */
  fatal: boolean;
  /** The outcome carries an inference clause (R12.6): BAND-FOUND, CROSSING-BRACKETED, NO-BAND. */
  inference: boolean;
  refClass: RegimeClass;
  amp: AmpLabel;
}
export type Outcome = OutcomeBase &
  (
    | { id: "INVALID-RUN"; invalid: { id: string; checks: CheckName[] }[]; mixed: { ruleSha: string[]; codeCommit: string[]; srcHash: string[] } }
    | { id: "GATE-FAIL"; causes: GateCause[]; others: { combo: Combination; causes: GateCause[] }[] }
    | { id: "NO-CONTRAST"; n: number; of: number; settings: string[] }
    | { id: "PENDING-LATE-CHECK"; late: LateResult; missing: string[] }
    | { id: "BAND-FOUND"; late: LateResult; settings: string[]; ranking: null }
    | { id: "LATE-INCONCLUSIVE"; late: LateResult }
    | { id: "TRANSIENT-BAND"; late: LateResult }
    | { id: "EMPTY-WINDOW" }
    | { id: "TOO-MANY-UNMETERABLE"; n: number; of: number }
    | { id: "THIN-POOL"; classBearing: number; axes: Axis[] }
    | { id: "SENSITIVE-EVERYWHERE"; n: number; of: number }
    | { id: "UNDER-SUPPORTED"; n: number; of: number }
    | { id: "UNRESOLVED" | "UNRESOLVED-FINAL"; n: number; pool: number }
    | { id: "CROSSING-BRACKETED"; brackets: { a: string; b: string; axis: Axis }[]; ranking: Ranking }
    | { id: "NO-BAND"; label: NoBandLabel; ranking: Ranking }
  );
export type OutcomeId = Outcome["id"];

/** The swept axes that the settings differ from B0 along, between them. */
export function axesSpanned(rows: readonly SettingRow[]): Axis[] {
  return AXES.filter((a) => rows.some((r) => r.params[a] !== B0_PARAMS[a]));
}

/**
 * R10: the first clause that applies. 1 INVALID-RUN; 2 GATE-FAIL; 3 NO-CONTRAST; 4 the late check if any setting reads refClass at T0; then, with
 * no target: 5.1 EMPTY-WINDOW, 5.2 TOO-MANY-UNMETERABLE, 5.3 THIN-POOL, 5.4 SENSITIVE-EVERYWHERE, 5.5 UNDER-SUPPORTED, 5.6 UNRESOLVED (or
 * UNRESOLVED-FINAL after the extension), 5.7 CROSSING-BRACKETED (refClass CRITICAL only), 5.8 NO-BAND. Only outcomes 4 (BAND-FOUND), 5.7 and 5.8
 * carry an inference; the ranking accompanies 5.7 and 5.8. Control settings are not in any count.
 */
export function decideOutcome(i: OutcomeInput, c: RegimeConstants = REGIME): Outcome {
  const base = { refClass: i.refClass, amp: i.amp };
  if (i.validation.fatal) return { ...base, id: "INVALID-RUN", fatal: true, inference: false, invalid: i.validation.invalid, mixed: i.validation.mixed };
  if (!i.gate.pass) return { ...base, id: "GATE-FAIL", fatal: false, inference: false, causes: i.gate.causes, others: i.gate.others ?? [] };
  const sweep = i.rows.filter((r) => !r.control);
  const pool = sweep.filter(inPool);
  const bearing = pool.filter(isClassBearing);
  const same = bearing.filter((r) => r.result.cls === i.refClass);
  if (bearing.length >= c.POOL_MIN && fracGE(same.length, bearing.length, c.NO_CONTRAST))
    return { ...base, id: "NO-CONTRAST", fatal: false, inference: false, n: same.length, of: bearing.length, settings: same.map((r) => r.id) };
  if (same.length > 0) {
    const late = lateCheck({ target0: same, t1Jobs: i.late.t1Jobs, seedsOf: i.late.seedsOf, refClass: i.refClass, combo: i.combo }, c);
    if (late.outcome === "PENDING-LATE-CHECK") return { ...base, id: "PENDING-LATE-CHECK", fatal: false, inference: false, late, missing: late.missing };
    if (late.outcome === "BAND-FOUND") return { ...base, id: "BAND-FOUND", fatal: false, inference: true, late, settings: late.agrees, ranking: null };
    return { ...base, id: late.outcome, fatal: false, inference: false, late };
  }
  if (pool.length === 0) return { ...base, id: "EMPTY-WINDOW", fatal: false, inference: false };
  const unmet = sweep.filter((r) => r.result.status === "UNMETERABLE").length;
  if (fracGT(unmet, sweep.length, c.UNMET_FRAC)) return { ...base, id: "TOO-MANY-UNMETERABLE", fatal: false, inference: false, n: unmet, of: sweep.length };
  const axes = axesSpanned(bearing);
  if (bearing.length < c.POOL_MIN || axes.length < c.AXES_MIN) return { ...base, id: "THIN-POOL", fatal: false, inference: false, classBearing: bearing.length, axes };
  const withU = pool.reduce((a, r) => a + r.result.nWithU, 0);
  const sens = pool.reduce((a, r) => a + r.result.nAmbigLimited, 0);
  if (fracGT(sens, withU, c.SENS_FRAC)) return { ...base, id: "SENSITIVE-EVERYWHERE", fatal: false, inference: false, n: sens, of: withU };
  const valid = pool.reduce((a, r) => a + r.result.valid, 0);
  const donly = pool.reduce((a, r) => a + r.result.nDonly, 0);
  if (fracGT(donly, valid, c.SUPPORT_FRAC)) return { ...base, id: "UNDER-SUPPORTED", fatal: false, inference: false, n: donly, of: valid };
  const split = pool.filter((r) => r.result.cls === "SPLIT").length;
  if (fracGT(split, pool.length, c.UNRES_FRAC)) return { ...base, id: i.extended ? "UNRESOLVED-FINAL" : "UNRESOLVED", fatal: false, inference: false, n: split, pool: pool.length };
  const ranking = rankAxes(i.rows, i.refClass, i.inert ?? new Set(), c);
  if (i.refClass === "CRITICAL") {
    const brackets = findBrackets(i.rows, i.inert ?? new Set());
    if (brackets.length) return { ...base, id: "CROSSING-BRACKETED", fatal: false, inference: true, brackets, ranking };
  }
  const label: NoBandLabel = bearing.every((r) => r.result.cls === "ORDERED") ? "all-ordered" : bearing.every((r) => r.result.cls === "CHAOTIC") ? "all-chaotic" : "scattered";
  return { ...base, id: "NO-BAND", fatal: false, inference: true, label, ranking };
}

/**
 * R12.6: the inference sentence of an outcome that carries one. Criticality wording is printed only for refClass CRITICAL that is AMP-ROBUST;
 * otherwise "critical" becomes "in the CRITICAL class at this kick scale" (the sentences are re-cast to read, resolution W12). Null for any
 * other outcome. Every sentence is followed by the reading scale of R13 (the readout adds it).
 */
export function inferenceSentence(o: Pick<Outcome, "id" | "refClass" | "amp">): string | null {
  const crit = o.refClass === "CRITICAL" && o.amp === "AMP-ROBUST";
  if (o.id === "BAND-FOUND") return "No physics change is indicated by these meters: at least one swept setting reads like the project's alive 2D worlds at T0 and T1.";
  if (o.id === "CROSSING-BRACKETED")
    return crit
      ? "The critical manifold lies between the two bracketed settings; refine along that axis before any physics change."
      : "The boundary of the CRITICAL class at this kick scale lies between the two bracketed settings; refine along that axis before any physics change.";
  if (o.id === "NO-BAND") {
    if (o.refClass === "CRITICAL")
      return crit
        ? "A physics change is indicated by these meters: the project's alive 2D worlds read critical and no swept slab setting does."
        : "A physics change is indicated by these meters: the project's alive 2D worlds read in the CRITICAL class at this kick scale and no swept slab setting does.";
    return "No swept slab setting reads like the project's alive 2D worlds (chaotic-like). This does not test the criticality hypothesis.";
  }
  return null;
}

// =====================================================================================================================
// R8.5 The seed extension: licensed only when R10 gives UNRESOLVED, and only for the SPLIT settings

/** An extension job (seed 104 to 106) as the checks see it. */
export interface ExtJob {
  world: string;
  seed: number;
}
export interface ExtensionCheck {
  /** The settings that are SPLIT under seeds 101 to 103 alone, in the pool (the control excluded): the only settings the extension is run for (R8.5). */
  roster: string[];
  /** R10 gave UNRESOLVED on the table of seeds 101 to 103: the extension is licensed. */
  licensed: boolean;
  /** Extension jobs that are not licensed: the extension was not called for, or the setting was not SPLIT at seeds 101 to 103. */
  unlicensed: ExtJob[];
  /** Once any extension job exists: the roster's jobs that are missing (a SPLIT setting needs all three of seeds 104 to 106). */
  missing: ExtJob[];
  /** At least one extension job exists. */
  started: boolean;
  /** Licensed, started and nothing missing or unlicensed: the extension has been run once, so a repeat of UNRESOLVED is final. */
  complete: boolean;
}

/**
 * R8.5 and R10.5.6. `baseRows` is the table of seeds 101 to 103 alone and `baseOutcome` the outcome R10 gave on it. The extension is run once, for
 * the SPLIT settings, and only if that outcome is UNRESOLVED; a setting that was not SPLIT, or any job when R10 did not call for it, is unlicensed
 * (extra seeds added after the table was seen would be seed shopping). A started extension must cover every roster setting at all of seeds 104 to 106.
 */
export function checkExtension(i: { baseRows: readonly SettingRow[]; baseOutcome: string; ext: readonly ExtJob[] }): ExtensionCheck {
  const roster = i.baseRows.filter((r) => inPool(r) && r.result.cls === "SPLIT").map((r) => r.id);
  const licensed = i.baseOutcome === "UNRESOLVED";
  const unlicensed = i.ext.filter((e) => !licensed || !roster.includes(e.world) || !SEEDS.extension.includes(e.seed));
  const started = i.ext.length > 0;
  const have = new Set(i.ext.map((e) => `${e.world}|${e.seed}`));
  const missing: ExtJob[] = [];
  if (started && licensed) for (const world of roster) for (const seed of SEEDS.extension) if (!have.has(`${world}|${seed}`)) missing.push({ world, seed });
  return { roster, licensed, unlicensed, missing, started, complete: licensed && started && missing.length === 0 && unlicensed.length === 0 };
}

/**
 * R10 on the sweep with the extension of R8.5 applied as the rule orders it: the table of seeds 101 to 103 alone is read first; if R10 gives
 * UNRESOLVED there, the extension jobs (seeds 104 to 106) of the SPLIT settings are added and R10 is read again, and UNRESOLVED then is final.
 * Jobs that are not licensed, or an extension that is started and not complete, are returned in `ext` for the caller to refuse; the outcome is then
 * that of the table of seeds 101 to 103.
 */
export function sweepWithExtension(
  i: { t0: readonly JobSummary[]; combo: Combination; input: Omit<OutcomeInput, "rows" | "extended">; specs?: readonly SettingSpec[] },
  c: RegimeConstants = REGIME,
): { rows: SettingRow[]; outcome: Outcome; baseRows: SettingRow[]; baseOutcome: Outcome; ext: ExtensionCheck } {
  const specs = i.specs ?? sweepSettings();
  const main = i.t0.filter((j) => !SEEDS.extension.includes(j.seed));
  const extJobs = i.t0.filter((j) => SEEDS.extension.includes(j.seed));
  const baseRows = buildSettingRows(main, i.combo, specs, c);
  const baseOutcome = decideOutcome({ ...i.input, rows: baseRows, extended: false }, c);
  const ext = checkExtension({ baseRows, baseOutcome: baseOutcome.id, ext: extJobs.map((j) => ({ world: j.world, seed: j.seed })) });
  if (!ext.complete) return { rows: baseRows, outcome: baseOutcome, baseRows, baseOutcome, ext };
  const rows = buildSettingRows([...main, ...extJobs], i.combo, specs, c);
  return { rows, outcome: decideOutcome({ ...i.input, rows, extended: true }, c), baseRows, baseOutcome, ext };
}

// =====================================================================================================================
// R6.9 Spatial entropy rate of B (descriptive only: no entropy value enters any class, the gate or any outcome)

/** The symbol of a B value: the number of ENT_EDGES at or below it, so {0}, {1..3}, {4..15}, {>=16} (q = 4). */
export function entropySymbol(b: number, c: RegimeConstants = REGIME): number {
  let q = 0;
  for (const e of c.ENT_EDGES) if (b >= e) q++;
  return q;
}
export function quantiseB(B: ArrayLike<number>, c: RegimeConstants = REGIME): Uint8Array {
  const q = new Uint8Array(B.length);
  for (let i = 0; i < B.length; i++) q[i] = entropySymbol(B[i], c);
  return q;
}

/** Plug-in entropy in bits of a symbol sequence. */
export function marginalEntropy(sym: ArrayLike<number>, nSym: number): number {
  const cnt = new Float64Array(nSym);
  for (let i = 0; i < sym.length; i++) cnt[sym[i]]++;
  let h = 0;
  for (const v of cnt) if (v > 0) h -= (v / sym.length) * Math.log2(v / sym.length);
  return h;
}

/** Plug-in conditional entropy H(sym | ctx) in bits over paired samples. */
export function conditionalEntropy(ctx: ArrayLike<number>, sym: ArrayLike<number>, nCtx: number, nSym: number): number {
  const joint = new Float64Array(nCtx * nSym);
  const per = new Float64Array(nCtx);
  const n = sym.length;
  for (let i = 0; i < n; i++) { joint[ctx[i] * nSym + sym[i]]++; per[ctx[i]]++; }
  let h = 0;
  for (let k = 0; k < nCtx; k++)
    for (let s = 0; s < nSym; s++) {
      const j = joint[k * nSym + s];
      if (j > 0) h -= (j / n) * Math.log2(j / per[k]);
    }
  return h;
}

/** The plug-in bias bound printed with `h_sp`: contexts * (nSym - 1) / (2 N ln 2) bits (0.0011 for 256 contexts, 4 symbols, 524,288 samples). */
export const entropyBiasBound = (nCtx: number, nSym: number, N: number): number => (nCtx * (nSym - 1)) / (2 * N * Math.LN2);

export interface SpatialEntropy {
  /** Marginal entropy of q at T. */
  H0: number;
  /** Conditional entropy of q given its W, NW, N, NE neighbours in the layer (x and y wrap), pooled over layers. */
  h_sp: number;
  h_sp_bias: number;
  /** Slab only: conditional entropy of q(z) given q(z - 1) at the same column, pooled over z = 1 to D - 1; null for a 2D world. */
  h_z: number | null;
  /** Space-time: q at T + ENT_LAG given (q at T, number of the six face neighbours with q >= 2 at T); null without the later field. */
  h_st: number | null;
  /** Deflate ratio of the symbols in Hilbert order over that of a seeded shuffle of the same bytes: 1 means no structure. */
  c_ratio: number | null;
}

/** Seeded Fisher-Yates shuffle (stream `draw(h0, i)`); returns a copy. */
export function seededShuffle(bytes: Uint8Array, h0: number): Uint8Array {
  const out = Uint8Array.from(bytes);
  for (let i = out.length - 1, k = 0; i > 0; i--, k++) {
    const j = draw(h0, k) % (i + 1);
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/** R6.9 on the B channel at T (`B0`) and at T + ENT_LAG (`B1`, optional). `h0` seeds the shuffle of c_ratio. */
export function spatialEntropy(B0: ArrayLike<number>, B1: ArrayLike<number> | null, g: Geom, h0: number, c: RegimeConstants = REGIME): SpatialEntropy {
  const n = voxelCount(g);
  const q = quantiseB(B0, c);
  const at = (x: number, y: number, z: number) => q[voxelAt(((x % g.W) + g.W) % g.W, ((y % g.H) + g.H) % g.H, z, g)];
  const ctxSp = new Uint8Array(n);
  const symSp = new Uint8Array(n);
  for (let z = 0; z < g.D; z++)
    for (let y = 0; y < g.H; y++)
      for (let x = 0; x < g.W; x++) {
        const v = voxelAt(x, y, z, g);
        ctxSp[v] = at(x - 1, y, z) * 64 + at(x - 1, y - 1, z) * 16 + at(x, y - 1, z) * 4 + at(x + 1, y - 1, z);
        symSp[v] = q[v];
      }
  let h_z: number | null = null;
  if (g.D > 1) {
    const wh = columnCount(g);
    const cz = new Uint8Array(wh * (g.D - 1));
    const sz = new Uint8Array(wh * (g.D - 1));
    for (let z = 1; z < g.D; z++)
      for (let i = 0; i < wh; i++) { cz[(z - 1) * wh + i] = q[(z - 1) * wh + i]; sz[(z - 1) * wh + i] = q[z * wh + i]; }
    h_z = conditionalEntropy(cz, sz, 4, 4);
  }
  let h_st: number | null = null;
  if (B1) {
    const q1 = quantiseB(B1, c);
    const ctx = new Uint8Array(n);
    for (let z = 0; z < g.D; z++)
      for (let y = 0; y < g.H; y++)
        for (let x = 0; x < g.W; x++) {
          const v = voxelAt(x, y, z, g);
          let m = 0;
          if (at(x + 1, y, z) >= 2) m++;
          if (at(x - 1, y, z) >= 2) m++;
          if (at(x, y + 1, z) >= 2) m++;
          if (at(x, y - 1, z) >= 2) m++;
          if (z + 1 < g.D && q[voxelAt(x, y, z + 1, g)] >= 2) m++;
          if (z - 1 >= 0 && q[voxelAt(x, y, z - 1, g)] >= 2) m++;
          ctx[v] = q[v] * 7 + m;
        }
    h_st = conditionalEntropy(ctx, q1, 28, 4);
  }
  const order = hilbertOrder(g.W, g.H);
  const hil = new Uint8Array(n);
  for (let z = 0; z < g.D; z++) for (let k = 0; k < order.length; k++) hil[z * order.length + k] = q[z * order.length + order[k]];
  const denom = compressionRatio(seededShuffle(hil, h0));
  const c_ratio = denom > 0 ? compressionRatio(hil) / denom : null;
  return { H0: marginalEntropy(q, 4), h_sp: conditionalEntropy(ctxSp, symSp, 256, 4), h_sp_bias: entropyBiasBound(256, 4, n), h_z, h_st, c_ratio };
}

// =====================================================================================================================
// R6.10 Genome, lineage and census divergence (descriptive only)

/** A 32-bit chained lowbias32 hash of all genome words of one voxel (R6.10 fingerprint; the chain starts at the golden constant, resolution W13). */
export function genomeFingerprint(words: ArrayLike<number>): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < words.length; i++) h = lowbias32((h ^ words[i]) >>> 0);
  return h >>> 0;
}

/** Per-voxel fingerprints from a channel-major genome buffer (`genome[ch * n + v]`, `channels` words per voxel). */
export function genomeFingerprints(genome: ArrayLike<number>, n: number, channels: number): Uint32Array {
  const out = new Uint32Array(n);
  const w = new Array<number>(channels);
  for (let v = 0; v < n; v++) {
    for (let ch = 0; ch < channels; ch++) w[ch] = genome[ch * n + v];
    out[v] = genomeFingerprint(w);
  }
  return out;
}

/** One sim's view for the divergence columns: the living flag per voxel (B + P > 0), the lineage id words and, for J_g, the fingerprints. */
export interface LineageView {
  live: ArrayLike<number>;
  idHi: ArrayLike<number>;
  idLo: ArrayLike<number>;
  fp?: ArrayLike<number>;
}

/**
 * J_id(t) = |ids_S symmetric-difference ids_R| / |ids_S union ids_R| over the lineage ids (genome words 0 and 1) of living voxels; J_g is the same
 * over the triples (id_hi, id_lo, fingerprint); n_gdiff is the number of voxels living in both whose fingerprints differ. A quotient with an
 * empty union is NA.
 */
export function lineageDivergence(S: LineageView, R: LineageView): { Jid: number | null; Jg: number | null; ngdiff: number | null } {
  const n = R.live.length;
  const sets = (v: LineageView, withFp: boolean) => {
    const s = new Set<string>();
    for (let i = 0; i < n; i++) if (v.live[i]) s.add(withFp ? `${v.idHi[i]}:${v.idLo[i]}:${v.fp![i]}` : `${v.idHi[i]}:${v.idLo[i]}`);
    return s;
  };
  const jac = (a: Set<string>, b: Set<string>): number | null => {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const uni = a.size + b.size - inter;
    return uni === 0 ? null : (uni - inter) / uni;
  };
  const Jid = jac(sets(S, false), sets(R, false));
  let Jg: number | null = null;
  let ngdiff: number | null = null;
  if (S.fp && R.fp) {
    Jg = jac(sets(S, true), sets(R, true));
    ngdiff = 0;
    for (let i = 0; i < n; i++) if (S.live[i] && R.live[i] && S.fp[i] !== R.fp[i]) ngdiff++;
  }
  return { Jid, Jg, ngdiff };
}

/** Census divergence (R6.10): dLiving = |live_S - live_R| / max(live_R, 1) and dSumB = |SB_S - SB_R| / max(SB_R, 1). */
export function censusDivergence(i: { liveS: number; liveR: number; sumBS: number; sumBR: number }): { dLiving: number; dSumB: number } {
  return { dLiving: Math.abs(i.liveS - i.liveR) / Math.max(i.liveR, 1), dSumB: Math.abs(i.sumBS - i.sumBR) / Math.max(i.sumBR, 1) };
}

/**
 * The scale curve (R6.10): the relative L1 `sum |B_X - B_R| / max(sum B_R, 1)` of the column-summed B field after coarse-graining to tiles of
 * s x s columns, for each s (default 1, 2, 4, 8, 16, 32). It says at which scale the twins differ.
 */
export function scaleCurve(Bref: ArrayLike<number>, Bx: ArrayLike<number>, g: Geom, scales: readonly number[] = [1, 2, 4, 8, 16, 32]): number[] {
  const wh = columnCount(g);
  const cr = new Float64Array(wh);
  const cx = new Float64Array(wh);
  for (let z = 0; z < g.D; z++) for (let i = 0; i < wh; i++) { cr[i] += Bref[z * wh + i]; cx[i] += Bx[z * wh + i]; }
  return scales.map((s) => {
    const tw = Math.ceil(g.W / s);
    const a = new Float64Array(tw * Math.ceil(g.H / s));
    const b = new Float64Array(a.length);
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) { const k = Math.floor(y / s) * tw + Math.floor(x / s); a[k] += cr[y * g.W + x]; b[k] += cx[y * g.W + x]; }
    let num = 0, den = 0;
    for (let k = 0; k < a.length; k++) { num += Math.abs(a[k] - b[k]); den += a[k]; }
    return num / Math.max(den, 1);
  });
}

// =====================================================================================================================
// R6.8 Second columns, R13 sensitivity table

export interface SecondColumns {
  /** Window means at the eight grid times of S's non-deciding block column, n_blk2, L1c, n_thetaV, n_2thetaV, n_1, n_live, n_vox, L1_A..L1_P, L1_B / SB_R and n_thetaV / n_dec. */
  grid: Record<string, (number | null)[]>;
  /** Ceiling ratio q(t) = n_dec,S(t) / max(n_dec,N(t), 1) at the TAU columns. */
  q: (number | null)[];
  /** Per-site median and inter-quartile range of n_dec_j at the TAU columns (over the stored steps in the window). */
  siteMedian: (number | null)[];
  siteIqr: (number | null)[];
}

export function secondColumns(i: { S: DiffLog; N?: DiffLog; sites?: SiteLog; decider: Decider }, c: RegimeConstants = REGIME): SecondColumns {
  const at = (col: ArrayLike<number>) => c.TRAJ.map((tc) => windowMean(col, tc, c.TRAJ_STEPS, c.WIN_HALF));
  const nDec = at(decidingColumn(i.S, i.decider));
  const grid: Record<string, (number | null)[]> = {
    [i.decider === "net" ? "n_occ" : "n_blk"]: at(otherColumn(i.S, i.decider)),
    n_blk2: at(i.S.n_blk2), L1c: at(i.S.L1c), n_thetaV: at(i.S.n_thetaV), n_2thetaV: at(i.S.n_2thetaV), n_1: at(i.S.n_1), n_live: at(i.S.n_live), n_vox: at(i.S.n_vox),
    L1_A: at(i.S.L1_A), L1_B: at(i.S.L1_B), L1_C: at(i.S.L1_C), L1_P: at(i.S.L1_P),
  };
  const l1b = grid.L1_B;
  const sbr = at(i.S.SB_R);
  grid["L1_B/SB_R"] = l1b.map((v, k) => (v === null || sbr[k] === null ? null : v / Math.max(sbr[k]!, 1)));
  grid["n_thetaV/n_dec"] = grid.n_thetaV.map((v, k) => (v === null || nDec[k] === null ? null : v / Math.max(nDec[k]!, 1)));
  const q = c.TAU.map((tau) => {
    if (!i.N) return null;
    const s = windowMean(decidingColumn(i.S, i.decider), tau, c.TRAJ_STEPS, c.WIN_HALF);
    const nn = windowMean(decidingColumn(i.N, i.decider), tau, c.DOSE_STEPS, c.WIN_HALF);
    return s === null || nn === null ? null : s / Math.max(nn, 1);
  });
  const perSite = (tau: number): number[] => {
    if (!i.sites) return [];
    const ss = siteSeries(i.sites, i.decider);
    const [lo, hi] = windowBounds(tau, c.TRAJ_STEPS, c.WIN_HALF);
    return ss.nDec.map((row) => {
      const v = ss.steps.map((s, k) => (s >= lo && s <= hi ? row[k] : null)).filter(isNum);
      return v.length ? (meanExact(v) as number) : NaN;
    }).filter(Number.isFinite);
  };
  return { grid, q, siteMedian: c.TAU.map((tau) => median(perSite(tau))), siteIqr: c.TAU.map((tau) => iqr(perSite(tau))) };
}

/**
 * The sensitivity table's scenarios (R13, printed, never used): D_LO, D_HI, B_LO, B_HI, ORD_R, SAT, R_AMP, DUST_CLEAR, DUST_LIM and SPEED_MIN each
 * moved by 25 percent in the direction that widens, then narrows, the CRITICAL band (for the dust lines: that lets more jobs vote).
 */
export function sensitivityScenarios(c: RegimeConstants = REGIME): { constant: string; direction: "widen" | "narrow"; consts: RegimeConstants }[] {
  const up = 1.25, down = 0.75;
  const spec: [keyof RegimeConstants, number, number][] = [
    ["D_LO", down, up], ["D_HI", up, down], ["B_LO", up, down], ["B_HI", up, down], ["ORD_R", down, up], ["SAT", up, down], ["R_AMP", up, down],
    ["DUST_CLEAR", up, down], ["DUST_LIM", up, down], ["SPEED_MIN", down, up],
  ];
  const out: { constant: string; direction: "widen" | "narrow"; consts: RegimeConstants }[] = [];
  for (const [k, widen, narrow] of spec) {
    const v = c[k] as number;
    out.push({ constant: k, direction: "widen", consts: { ...c, [k]: v * widen } });
    out.push({ constant: k, direction: "narrow", consts: { ...c, [k]: v * narrow } });
  }
  return out;
}

// =====================================================================================================================
// The rule file (R1, R15): the hashes it is frozen under and the combination it holds

const HASH64 = /\b[0-9a-f]{64}\b/gi;
/** The hashes of a REGIME-FROZEN or RULE.sha256 file: every 64-digit hex word on the lines that are not comments, in order. The LAST one is the rule's current hash (R15 amendments append). */
export function parseHashFile(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    for (const m of line.matchAll(HASH64)) out.push(m[0].toLowerCase());
  }
  return out;
}

/**
 * The two fill forms of the R1 value cell (markdown emphasis and backticks removed), as R1 writes them: `P2, occ` and `RUNG = P2, DECIDER = occ`. The separator is a
 * comma and the labels come both or neither (spaces around `,` and `=` are free); a semicolon, one label without the other or any other text is not a fill (final review F5).
 */
const R1_FILL = /^(?:RUNG\s*=\s*(P[12])\s*,\s*DECIDER\s*=\s*(net|occ)|(P[12])\s*,\s*(net|occ))$/;

/**
 * The value cell of the R1 row "RUNG, DECIDER" read as a combination. The cell is filled only if, with backticks and asterisks removed, it IS one of
 * the fill forms above: any other text (a placeholder that names both options, or a half fill such as `RUNG = P1; DECIDER is not filled (net is a
 * possibility)`) is not a fill. Returns the combination, or null with the reason.
 */
export function parseCombination(ruleText: string): { combo: Combination | null; why: string | null } {
  const row = ruleText.split(/\r?\n/).find((l) => /^\|\s*RUNG\s*,\s*DECIDER\s*\|/.test(l));
  if (!row) return { combo: null, why: "no R1 row starting `RUNG, DECIDER`" };
  const cells = row.split("|").map((x) => x.trim());
  const value = (cells[2] ?? "").replace(/[`*]/g, "").trim();
  const m = R1_FILL.exec(value);
  if (m) return { combo: { rung: (m[1] ?? m[3]) as Rung, decider: (m[2] ?? m[4]) as Decider }, why: null };
  const rungs = [...new Set([...value.matchAll(/\bP([12])\b/g)].map((x) => `P${x[1]}`))];
  const deciders = [...new Set([...value.matchAll(/\b(net|occ)\b/g)].map((x) => x[1]))];
  return { combo: null, why: `the R1 row names ${rungs.length ? rungs.join("/") : "no rung"} and ${deciders.length ? deciders.join("/") : "no decider"}; it must name exactly one of P1, P2 and one of net, occ, as one fill form such as \`P2, occ\` or \`RUNG = P2, DECIDER = occ\` (a comma between the two, and both labels or neither) and nothing else (Stage 0 fills it in)` };
}
