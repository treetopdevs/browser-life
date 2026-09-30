# Plan 005: Rebuild the test-6 measures so they can pass a null check (lineage-ID-free persistence and clusters, and a passable shadow rule)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> shasum -a 256 tools/foundations.ts tools/lib/bundle.ts packages/metrics/src/ecology.ts | cut -c1-12
> ```
>
> Expected: `d40ee1e12157`, `59f5d8f69bbe`, `54c480b25798`. This plan reads
> those files and copies code from `tools/foundations.ts` lines 909–1049; if a
> hash differs, compare the excerpts below against the live code. On a
> mismatch in those lines, treat it as a STOP condition.

## Status

- **Priority**: P2 (a prerequisite for any registered cohort, and for any claim from new founder or forcing experiments)
- **Effort**: L (code about 1–2 days; CPU compute a few hours)
- **Risk**: LOW (analysis only; a new CLI and a new output file; `t6.json` stays the record)
- **Depends on**: none
- **Category**: bug
- **Planned at**: git `f08e1e6` plus the uncommitted jj working copy (change `smzqotqt`), 2026-09-30

## Why this matters

Test 6 of the foundations review asked whether any activity, novelty or role measure could be used in a future registration. A measure had to separate worlds known to differ (effect ≥ 0.8). It also had to pass a null check: over the 70 neutral runs, the one-sided 95% upper bound on its flag rate below 0.10, i.e. at most 2 of 70 flagged. None qualified (`experiments/foundations/t6.json`). Reading the code shows that two of the failures come from how the measures were built, not from the worlds:

1. **Lineage-ID keyed measures collapse once mutation is on.**
   - Persistent novelty requires a single lineage ID to hold at least 1% of living cells in a bin for 10⁵ steps. Role clusters cluster only lineages that each hold at least 5% of cells.
   - Treatment runs mint 10,000–14,000 new lineage IDs per 10⁵ steps, so no single ID reaches either bar.
   - Result: persistent novelty is 0 in all 10 treatment replays, and role clusters average 0–0.77 (three runs exactly 0) while 2–4 roles are present.
2. **The shadow null rule cannot be passed even by a perfect shadow.**
   - A run is flagged when it beats all 20 shadows. Under a perfectly calibrated shadow that happens to 1 run in 21 (4.8%).
   - The rule allows at most 2 of 70 flagged. With 3.3 expected, a perfect shadow passes only about 35% of the time.
   - The shadow also redraws every surviving cell at each census, a full resampling generation every 100 steps, whatever the world's real turnover. That is a plausible cause of its opposite miscalibration on the two presets: all 30 `spots-m3` neutral runs flagged, while all 40 `gradient-m3` neutral runs sit below their shadows.

This plan builds measures without those flaws, tests them on synthetic inputs with known answers, and re-runs the eligibility check on the same worlds. It writes `experiments/foundations/t6-v2.json` beside the untouched `t6.json`. It does not register anything; the eligibility rules are unchanged.

## Current state

- `tools/foundations.ts` — the foundations review's analysis CLI. Test 6 is `t6()` (lines 1088–1194), using:
  - `binomialUpperBound` (line 909: `(k, n) => 1 - binomialLowerBound(n - k, n)`);
  - `binom(n, p, r)` (lines 912–936; inversion for small means, a clamped normal approximation otherwise);
  - `shadowExcess(dir, threshold, k = 20, seed = 4_500_001)` (lines 939–997);
  - `profileMeasures(dir)` (lines 1000–1049);
  - `compartmentCheck()` (lines 1051–1073);
  - `runDirs(root)` (lines 1075–1086).
  - `rng(seed)` (mulberry32) is exported at lines 86–94, and `tsv(path)` at lines 48–61.
- The persistence key and per-lineage cut:

  ```ts
  // tools/foundations.ts:1009-1021 (inside profileMeasures' flush)
      for (const x of rowsAt) {
        if (x.cells / total < 0.01) continue;
        const bin = `${Math.floor(x.mu / 8)}:${Math.floor(x.sigma / 4)}:${x.role}`;
        if (!firstSeen.has(bin)) firstSeen.set(bin, step);
        const sk = `${x.key}|${bin}`;
        live.add(sk);
        if (!streak.has(sk)) streak.set(sk, step);
        if (step - streak.get(sk)! >= 100_000) persistent.add(bin);
      }
  ```

  ```ts
  // tools/foundations.ts:1022-1031
      if (step > 500_000) {
        ...
        const big = rowsAt.filter((x) => x.cells / total >= 0.05).map((x) => x.v);
        ... single linkage at L1 < 0.2 over `big` ...
        clusters.push(new Set(big.map((_, i) => find(i))).size);
      }
  ```

  A row's profile vector is `[photo, grow, decomp, resp] / sum`, and a zero-flux row becomes the zero vector (`sum || 1`, line 1041).
- The shadow flag (line 996): `flagged: realNew > shadows[shadows.length - 1]`. The null rule (line 1123): `passes: xs.length === 70 && binomialUpperBound(f, xs.length) < 0.1`.
- `t6()`'s cache (lines 1089–1101) is keyed by directory only. Measures are recomputed only when `rolesPresent` is missing.
- Run sets used by `t6()` (lines 1108–1117), unchanged here:
  - `T` = `runs/replay-m4/gradient-m3/treatment` (10)
  - `NM` = `runs/replay-m4/gradient-m3/no-mutation` (5)
  - `soloNM` = `runs/solo/gradient-m3/no-mutation` (36)
  - neutral = `runs/replay-calib/{gradient-m3,spots-m3}/neutral` plus `runs/replay-m4/{gradient-m3,spots-m3}/neutral` (70 in all).
  - Thresholds: `ACTIVITY_THRESHOLDS[preset].value` from `experiments/endpoints.ts`.
- `tools/lib/bundle.ts:98` — `lineageCensuses(dir)` streams `lineages.tsv` one census at a time as `[step, [key, cells][]]`, and throws on out-of-order steps. Lineages files are up to about 1.3 GB, so never load one whole.
- `profiles.tsv` header: `step lineage cells mass photo grow decomp resp role mu sigma motGain` (deep censuses every 1,000 steps).
- Cached per-run values of the old measures are in `runs/foundations/results/t6-runs.json` (121 entries keyed by run directory: `real, shadowMedian, shadowMax, excess, flagged, novelty, persistentNovelty, roleClusters, rolesPresent`). Example for `runs/replay-m4/gradient-m3/treatment/seed-1`: `real 8098, shadowMedian 5863.5, shadowMax 6024, flagged true, persistentNovelty 0, roleClusters 0.18`.

**Conventions.** Pure functions that take async iterables go in `tools/lib/*.ts` and are tested with vitest (`tools/test/*.test.ts`; pattern `tools/test/recurrence.test.ts`). The CLI wrapper uses Deno APIs. Seeds for PRNG streams are fixed constants in code. Results go to `experiments/foundations/`; caches go to `runs/foundations/results/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| New tests | `pnpm vitest run tools/test/measures6.test.ts` | all pass |
| All tests | `pnpm test` | all pass |
| Pilot (2 runs) | `deno run -A tools/t6v2.ts pilot` | prints per-run timings and the old-vs-new regression comparison |
| Full run | `deno run -A tools/t6v2.ts all` | writes `experiments/foundations/t6-v2.json` |

## Scope

**In scope:**
- `tools/lib/measures6.ts` (create): pure measure functions
- `tools/test/measures6.test.ts` (create)
- `tools/t6v2.ts` (create): the CLI (`pilot`, `all`)
- New outputs: `runs/foundations/results/t6v2-runs.json` (cache) and `experiments/foundations/t6-v2.json`
- `docs/plan.md`: one dated "fixed before computing" paragraph (step 5) and one result paragraph (step 8)

**Out of scope** (do NOT touch):
- `tools/foundations.ts` (`t6()` stays as the record; copy from it, do not edit it), `experiments/foundations/t6.json`, `runs/foundations/results/t6-runs.json`.
- `packages/metrics/**`: no change to `classify` or other shared metrics.
- The eligibility rules themselves (effect ≥ 0.8; null upper bound < 0.10 at n = 70; splits ≤ 0.10).

## Git workflow

- jj-colocated; other sessions may share the working copy. **Do not commit, bookmark or push.** List changed files at the end.

## Steps

### Step 1: Copy the old shadow into `tools/lib/measures6.ts`, with a turnover option

Create `tools/lib/measures6.ts`. Copy `rng` (mulberry32, `tools/foundations.ts:86-94`) and `binom` (lines 912–936) verbatim. Then write:

```ts
export type Census = [number, [string, number][]];
export interface ShadowResult { real: number; shadowMedian: number; shadowMax: number; excess: number; flagged: boolean; rank: number; k: number }

/**
 * Shadow excess as in tools/foundations.ts shadowExcess, but over any census stream, with k shadows and a turnover mode:
 *  - "full": every surviving cell is redrawn each census from the shadow's previous abundances (the original).
 *  - "observed": each shadow component keeps Binomial(x_i, 1 - tau) cells and only the rest is redrawn,
 *    tau = the real world's turnover between consecutive censuses (see realTurnover).
 * `rank` = number of shadows the real run strictly exceeds (0..k), for rank-uniformity checks.
 */
export async function shadowExcessStream(censuses: AsyncIterable<Census>, threshold: number, k: number, seed: number, turnover: "full" | "observed"): Promise<ShadowResult>
```

The body copies the original loop (lines 940–997) with these changes:
- `k` shadows instead of 20;
- in `"observed"` mode, compute `tau` per census with `realTurnover(prevRows, rows)` and change the redraw step as described below;
- the returned `rank` (count of shadows with `cumNew < realNew`);
- the median and max as before.

```ts
/** Fraction of the previous census's cells replaced by the current one: (sum over keys of |c_t - c_{t-1}|) / (2 * total_{t-1}), clamped to [0, 1]; 1 when there is no previous census. */
export function realTurnover(prev: Map<string, number> | null, now: [string, number][]): number
```

"Observed" redraw for one shadow with previous counts `x_i` (total `mass`) and `rest` cells to fill:
1. `keep_i = binom(x_i, 1 - tau, r)`, capped so that `Σ keep_i ≤ rest`; if the sum overshoots, cap from the end.
2. Redraw `rest - Σ keep_i` multinomially from `x_i / mass`, using the same sequential binomial scheme as the original.
3. The new count is `keep_i + draw_i`. Activity and crossing bookkeeping are unchanged.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Lineage-ID-free profile measures in the same file

Add:

```ts
export interface ProfileRow { step: number; lineage: string; cells: number; photo: number; grow: number; decomp: number; resp: number; role: string; mu: number; sigma: number }
export interface ProfileResult {
  novelty: number;            // as before: bins first occupied after 1e5 by a lineage holding >= 1% (kept for continuity)
  persistentNoveltyV2: number;  // new bins whose SUMMED share over all lineages in the bin stays >= 1% across consecutive deep censuses spanning >= 1e5
  roleClustersV2: number | null; // mean over censuses after horizon/2 of clusters whose summed share >= 5%, zero-flux rows excluded
  rolesPresent: number | null;   // as before, for the specialisation-pair condition
  zeroFluxShare: number;      // mean over censuses of the share of living cells in rows with photo = grow = decomp = 0
}
export async function profileMeasuresV2(rows: AsyncIterable<ProfileRow>, horizon: number): Promise<ProfileResult>
```

Definitions, to implement exactly:
- **Bin** = `${floor(mu / 8)}:${floor(sigma / 4)}:${role}`, as before. **Bin share** at a census = the sum of `cells` over all rows in that bin, divided by that census's total cells.
- **novelty**: the old definition; copy the `firstSeen` logic for lineages with share ≥ 1%.
- **persistentNoveltyV2**:
  - a bin is *newly occupied* when its bin share first reaches ≥ 1% at a census with step > 100,000;
  - it is *persistent* when its bin share is ≥ 1% at every deep census of some run of consecutive censuses whose first-to-last span is ≥ 100,000 steps;
  - the count is the number of newly occupied bins that are persistent.
- **roleClustersV2**: at each census with `step > horizon / 2`:
  - drop rows with `photo + grow + decomp === 0`;
  - map each remaining row to `q = round([photo, grow, decomp, resp] / sum * 50) / 50` and aggregate cells by the joined `q`;
  - single-linkage cluster the aggregated points at L1 distance < 0.2 (union-find, as the original);
  - count clusters whose summed cells / total (the total includes dropped rows) ≥ 0.05.
  - The result is the mean count over those censuses, or `null` if there are none.
- **rolesPresent**: as the original (roles with summed share ≥ 5%, averaged over censuses after `horizon / 2`).
- **zeroFluxShare**: as defined in the interface comment.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Tests with known answers (`tools/test/measures6.test.ts`)

Write the tests before running anything on real data.

1. **realTurnover**: identical censuses → 0; disjoint censuses → 1; one key halving out of two equal keys → 0.25.
2. **Shadow regression, "full" mode, k = 20**: a hand-made stream of 5 censuses with 3 lineages gives a deterministic result. Assert it twice with the same seed (determinism), and once more with another seed (it changes).
3. **Shadow calibration**:
   - Generate 300 synthetic runs from a neutral Wright–Fisher process that matches the "full" shadow model: 50 lineages, 2,000 cells, 200 censuses, all cells resampled each census, 5 new lineages of 10 cells injected each census, threshold 3,000.
   - With `k = 19` in "full" mode, the fraction flagged lies in [0.02, 0.09] (nominal 0.05), and the mean `rank / k` lies in [0.4, 0.6].
   - Use a fixed seed per synthetic run. If this takes over 30 s, reduce to 150 runs and widen to [0.01, 0.11].
4. **persistentNoveltyV2**: a stream where, from step 200,100 to 400,100 at every deep census, a new bin is held by a *different* lineage each census at 2% of cells → `persistentNoveltyV2 === 1` and `novelty >= 1`. The same stream at 0.5% → 0.
5. **roleClustersV2**:
   - a single profile repeated across many lineages, each at 0.1% but summing to 60% of cells → 1;
   - two distinct profiles (`[1,0,0,0]` and `[0,0,1,0]`), each summing to 30% → 2;
   - the same plus zero-flux rows holding 40% → still 2, with `zeroFluxShare ≈ 0.4`.

**Verify**: `pnpm vitest run tools/test/measures6.test.ts` → all pass.

### Step 4: The CLI `tools/t6v2.ts`, then a pilot on 2 runs

Create `tools/t6v2.ts` (Deno). It imports `lineageCensuses` from `./lib/bundle.ts`, `tsv` from `./foundations.ts`, `ACTIVITY_THRESHOLDS` from `../experiments/endpoints.ts`, `mannWhitney` and `binomialLowerBound` from `@bl/metrics`, and the new lib. Constants:

```ts
const MEASURES6_VERSION = 2;
const SHADOW_SEED = 4_500_001; // same base as test 6
```

`K` is decided in step 5. The run sets are the same as `t6()` (see Current state).

Per run, compute:
- `shadowFull` = `shadowExcessStream(lineageCensuses(dir), thr, K, SHADOW_SEED, "full")`;
- `shadowObserved` = the same with `"observed"`;
- `profile` = `profileMeasuresV2(rows from tsv(profiles.tsv) mapped to numbers, manifest.summary.steps)`, when `profiles.tsv` exists.

Cache to `runs/foundations/results/t6v2-runs.json` under key `${dir}|v${MEASURES6_VERSION}|k${K}`.

`pilot` subcommand:
- run on `runs/replay-calib/gradient-m3/neutral/seed-1001` and `runs/replay-m4/gradient-m3/treatment/seed-1` only, with `K = 20` in "full" mode first;
- **regression**: `real`, `shadowMedian`, `shadowMax`, `excess` and `flagged` must equal the cached old values in `runs/foundations/results/t6-runs.json` for those two directories exactly (same seed, same algorithm). Print `regression: OK` or the differences;
- then time one run at `K = 199` in each mode, and print the projected total for 121 runs × 2 modes.

**Verify**: `deno run -A tools/t6v2.ts pilot` prints `regression: OK` and a projection.

### Step 5: Fix the parameters in `docs/plan.md` before computing any flag

Choose `K = 199` if the step-4 projection for 121 runs × 2 modes is at most 8 hours; otherwise `K = 99`. Set `K` in `tools/t6v2.ts`. Then append to the end of `docs/plan.md` (blank line first; fill `YYYY-MM-DD` and `<K>`):

```markdown
**Test 6 measures rebuilt (fixed YYYY-MM-DD, before computing any flag).** Two test-6 failures came from measure construction rather than from the worlds: persistent novelty and role clusters were keyed on single lineage IDs, which turn over by the thousand per 10⁵ steps under mutation (persistent novelty 0 in all 10 treatment replays; role clusters 0–0.77 while 2–4 roles were present). And with 20 shadows a perfectly calibrated shadow flags 1 run in 21, so it meets "at most 2 of 70" only about 35% of the time. Rebuilt, exploratory, same worlds and same eligibility rules (`tools/t6v2.ts`, `tools/lib/measures6.ts`, output `experiments/foundations/t6-v2.json`; `t6.json` stays the record):
- *Shadow excess* with <K> shadows (a perfect shadow then flags about 1/(<K>+1)), in two modes: the original full redraw each census, and a turnover-matched shadow that keeps Binomial(x, 1 − τ) of each component and redraws the rest, τ being the real world's census-to-census turnover. Also the rank of each run among its shadows, whose distribution over the 70 neutral runs should be uniform.
- *Persistent novelty v2*: a (μ/8, σ/4, role) bin newly reaching 1% of living cells after 10⁵ steps, summed over every lineage in the bin, that stays at ≥ 1% for ≥ 10⁵ steps of consecutive deep censuses.
- *Role clusters v2*: catalytic-profile clusters (single linkage, L1 < 0.2 on profiles rounded to 0.02) whose summed share is ≥ 5%, zero-flux rows excluded, averaged over the second half.
- *Expected directions, written before computing* (a > b): treatment > no-mutation replays for both shadow excesses and persistent novelty v2; no-mutation replays > single-founder no-mutation runs for role clusters v2 (specialisation pair, counted only if they hold more roles, as before). Null checks over the same 70 neutral runs; eligibility as in test 6.
```

**Verify**: `tail -8 docs/plan.md` shows it, with `<K>` filled in.

### Step 6: Full computation (CPU)

Run `deno run -A tools/t6v2.ts all` (in the background if it is long; it resumes from its cache).

`all` computes the per-run measures for every run in the four sets, then builds `measures` and `eligible` exactly as `t6()` does (copy lines 1118–1190), with these differences:
- **shadow excess**: one block per mode. Each block holds `treatmentVsNoMutation` (effect on `excess`), `null` (flagRate on `flagged`), `splits` (on `excess`), and `rankUniformity`: the 70 neutral ranks binned into 10 equal bins of `0..K`, with a chi-square statistic and its p-value. Use the chi-square survival function with 9 df; implement the regularized incomplete gamma or a series, or compute a Monte Carlo p-value from 10,000 uniform draws with a fixed seed. State which you used.
- **novelty (v1)**: as before, for continuity.
- **persistentNoveltyV2**: `treatmentVsNoMutation`, null flag = `> 0`, splits.
- **roleClustersV2**: the `noMutationVsSoloNoMutation` effect (if `fewerRoles` holds), `treatmentMean`, splits.
- **zeroFluxShare**: mean per run set (descriptive).
- **compartment**: omit; it is unchanged from `t6.json`.

`eligible` has one boolean per new measure under the same three conditions as `t6()`, plus `complete` (T = 10, NM = 5, soloNM = 36, neutral = 70). Write `experiments/foundations/t6-v2.json` with `{ note, version, K, eligible, measures, runs, old: <the eligible block from t6.json> }`.

**Verify**: `python3 -c "import json;d=json.load(open('experiments/foundations/t6-v2.json'));print(d['eligible']);print(d['measures']['shadowExcessFull']['null'],d['measures']['shadowExcessObserved']['null'])"` → `complete: True` and two null blocks with `of: 70`.

### Step 7: Sanity checks on the output

- Persistent novelty v2 in treatment should no longer be 0 in every run. If it still is, report it; that is a result, not a failure.
- `zeroFluxShare` per set is between 0 and 1.
- In "full" mode with `K` shadows, the neutral flag count is reported as-is. Compare it with the expected `70 / (K + 1)` in your report. A count far above that means the shadow is still miscalibrated, now visible under a passable rule.

### Step 8: Record the result in `docs/plan.md`

Append one factual paragraph (blank line first; values only from `t6-v2.json`):

```markdown
*Result (YYYY-MM-DD; `experiments/foundations/t6-v2.json`).* Eligible: shadow excess (full) <yes/no> (effect <e>, neutral flagged <f>/70, upper bound <u>, rank uniformity p <p>); shadow excess (turnover-matched) <yes/no> (effect <e>, <f>/70, <u>, p <p>); persistent novelty v2 <yes/no> (effect <e>, <f>/70, <u>); role clusters v2 <yes/no|not counted> (pair effect <e>; treatment mean <m>). Mean zero-flux share of living cells: treatment <a>, no-mutation <b>, neutral <c>.
```

## Test plan

- `tools/test/measures6.test.ts` (new):
  - `realTurnover` (three cases);
  - shadow determinism and seed sensitivity;
  - shadow calibration on a synthetic neutral process (flag rate near 1/(k+1), mean rank near 0.5);
  - `persistentNoveltyV2` (many short-lived lineages holding one bin → 1; below 1% → 0);
  - `roleClustersV2` (one profile → 1; two → 2; zero-flux rows excluded, `zeroFluxShare` near 0.4).
- Pilot regression: the "full" mode at `K = 20` reproduces the cached old shadow values exactly on two real runs.
- `pnpm test` → all pass.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0, including `tools/test/measures6.test.ts`
- [ ] `deno run -A tools/t6v2.ts pilot` printed `regression: OK`
- [ ] `experiments/foundations/t6-v2.json` exists with `eligible.complete === true`
- [ ] `git diff --stat tools/foundations.ts experiments/foundations/t6.json` is empty
- [ ] `docs/plan.md` has the fixed paragraph (before step 6) and the result paragraph
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The pilot regression differs from the cached old values. The copy is not faithful; do not continue to new modes.
- The projected time at `K = 99` is still over 8 hours.
- Memory grows with file size, meaning something is loading a whole `lineages.tsv` or `profiles.tsv`.
- Any of the four run sets has a different count from 10/5/36/70.
- The synthetic calibration test fails for "full" mode. The rank logic would then be wrong, and every flag rate meaningless.
- You find yourself changing an eligibility rule or an expected direction after seeing any computed value.

## Maintenance notes

- The turnover-matched shadow is the candidate for the "demography-matched shadow" the plan's Measurement section asks for. If it passes, a registration would still need its own dated rule and a fresh pilot.
- A further option, not built here: child lineages identical to their parent (no-op mutations, about 0.3% of mutation events) are exactly neutral and share the run's demography, so they could serve as an in-run neutral reference.
- Role clusters v2 and persistent novelty v2 still use roles from single-step flux snapshots; `zeroFluxShare` shows how much of the "mixed" label is inactivity.
- The `binomialLowerBound` used for the null upper bound is accurate at n = 70; plan 006 makes it refuse invalid inputs.
