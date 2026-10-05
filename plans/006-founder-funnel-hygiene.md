# Plan 006: Make the founder-selection funnel reproducible: recorded parameters, explicit gate, seeded orders, validated bounds

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: this plan edits `tools/bootstrap.ts` after
> plan 001 has. Confirm plan 001 landed, then check the other files:
>
> ```bash
> grep -c "reviveEvalConfig" tools/bootstrap.ts
> shasum -a 256 packages/metrics/src/stats.ts packages/search/src/mapelites.ts packages/search/src/retest.ts tools/retest.ts | cut -c1-12
> ```
>
> Expected: `3`, then `da12ccc972b4`, `b7a3caac6e33`, `80ea2e3a723a`,
> `69723b499890`. If the first prints `0`, plan 001 has not landed: STOP. If a
> hash differs, compare the "Current state" excerpts against the live code;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (land before any new founder screen, e.g. "diversify the obligate pool")
- **Effort**: M
- **Risk**: LOW for history (every default reproduces today's behaviour); MED for future screens that opt into the new options
- **Depends on**: plans/001-obligate-preflight.md (both edit `tools/bootstrap.ts`)
- **Category**: tech-debt
- **Planned at**: git `f08e1e6` plus the uncommitted jj working copy (change `smzqotqt`), 2026-09-30

## Why this matters

The founder funnel is: MAP-Elites search, then confirmation, then a dependence re-screen, then a retest, then a pinned founder set. Its outcome depends on settings that are not recorded and on input order nobody chose:

- **The retest's per-cluster cap is taken in row order and not recorded.** `tools/retest.ts` keeps the first `--per-strong` (default 4) members of each strong cluster, in `confirm.json` row order (discovery order). The value of the cap is not written to `retest.json`. A later audit had to *reconstruct* the cap as 4, and found four archive genomes that later originated roles beyond it (`docs/plan.md`, "Selection-mismatch audit decision").
- **"Maintenance" screens still select for regeneration.** `--score maintenance` drops regeneration from the archive score. But the screening gate (`passesGate`) still requires regeneration > 0.8, and half of all parent picks (`--pass-bias 0.5`) go to lineages holding a gate passer. So a screen meant to be neutral on regeneration still steers reproduction toward regenerators. The founder diagnostic links regeneration-heavy selection to phototroph founders that rarely originate roles.
- **Provenance is thin.** `archive.json` lacks the archive spec, cluster distance, gate constants, schema/rule/metrics versions and whether roles were recorded (they never were, so the background pool has no role breakdown). `confirm.json` does not record the dependence re-screen's seeds, so `usedSeeds` cannot refuse them. A later `--resume` overwrites the previous dependence block. `--confirm-only` ignores an existing `confirm.json` and overwrites it.
- **The dependence re-screen runs in discovery order.** Partial readings are therefore biased: a mid-run "0 obligate so far" turned out wrong once obligates appeared late in the list.
- **`binomialLowerBound` fails silently.** It returns about 1 for `k` undefined, NaN or greater than `n` (so a malformed row would pass the strict gate), and 0 for mid-range `k` once `n` ≥ 1,029.

Every change here keeps today's defaults byte-identical, so the pinned founder set and existing tests are unaffected. New screens can then record and control these choices.

## Current state

- `packages/metrics/src/stats.ts:329-348` — `binomialLowerBound(k, n, alpha = 0.05)`: returns 0 if `k <= 0`, otherwise bisects 60 times on a tail sum built from running binomial coefficients `c = (c * (n - i)) / (i + 1)`. `passesProbabilityGate` (lines 366–368) checks only `n >= minReps`. Tests: `packages/metrics/test/stats.test.ts:238-246` (16/16 closed form, 0/16 = 0, 15/16 ≈ 0.7358). `tools/nullcal.ts:58-70` documents the n = 1,029 collapse.
- `packages/search/src/mapelites.ts`:
  - `Archive` constructor `(spec = DEFAULT_ARCHIVE, score = quality)` (lines 57–61). `offer` adds passers with `passesGate(e)` (line 82) and keeps the incumbent on quality ties (line 88: `if (cur && cur.quality >= q) return false;`).
  - `lineages()` counts `passesGate` passers (line 116). `pickParent(seed, passBias = 0.5)` prefers lineages with passers (lines 129–135).
  - `passesGate(e, minRecovery = 0.8)` = `e.survived > 0 && e.regenerated / e.reps > minRecovery && e.lightDependent === e.reps` (lines 177–179).
  - `confirmsGate(e, minReps)` (197–199) and `m3Gate(confirmations, minClusters, minReps)` (209–213).
  - `CONFIRM_REPS = 16`, `M3_MIN_CLUSTERS = 20`, `DEFAULT_ARCHIVE = { bins: 8, massRange: [7, 13], speedRange: [0, 4] }`.
- `packages/search/src/retest.ts` — `RetestProvenance { seeds; used }` (lines 22–25), `usedSeeds(gate, rows)` (40–50; reads `searchSeeds` and `confirmSeeds`/`confirmSeed`), `checkFresh` (53–62), `selectFounders` (69+).
- `tools/retest.ts:47-55` — inline item selection:

  ```ts
  const by = new Map<number, { regenLowerBound: number; eval: Evaluation; genome: EncGenome }[]>();
  for (const r of c.rows.filter((r: { pass: boolean }) => r.pass)) by.set(r.cluster, [...(by.get(r.cluster) ?? []), r]);
  const items: Omit<Row, "eval">[] = [{ label: "generalistGenome(60,20)", cluster: null, weak: null, prior: null, genome: enc(generalistGenome(60, 20)) }];
  for (const [id, rs] of by) {
    const weak = !rs.some((r) => r.regenLowerBound > 0.8);
    (weak ? rs : rs.filter((r) => r.regenLowerBound > 0.8).slice(0, perStrong)).forEach((r, i) =>
      items.push({ label: `c${id}.${i}`, cluster: id, weak, prior: `${r.eval.regenerated}/${r.eval.reps}`, genome: r.genome })
    );
  }
  ```

  and line 73 writes `{ reps, seeds, provenance, rows }`.
- `tools/bootstrap.ts`:
  - flags at lines 60–65 (defaults: `pass-bias 0.5`, `score quality`, `select lineages`);
  - `search` object at 107–112 (it records `score` only when non-default, so old archives still resume);
  - `archiveJson` at 156–160;
  - confirmation and dependence at 296–362. The dependence loop walks `passing` in order (346–352) and writes `dependence = { seed, seeds, obligate, rows }`. The confirm file is written at 361: `{ gate: detail, eval: cec, ...(dependence ? { dependence } : {}), rows: out }`.
  - `prevConfirm` is loaded only with `--resume` (line 233).
- `@bl/schema` exports `SCHEMA_VERSION`, `RULE_VERSION`, `METRICS_VERSION` (`packages/schema/src/config.ts:5-17`) and `CLUSTER_DISTANCE` (`genetics.ts:20`).
- Tests: `packages/search/test/gate.test.ts` (m3Gate, clusters), `packages/search/test/retest.test.ts` (it regenerates the pinned founder set from `experiments/m3/*.json`; **must stay green**), `packages/metrics/test/stats.test.ts`. GPU regression: `tests/deno/bootstrap-resume.ts` (about 8 minutes, real GPU, temp directory).

**Conventions.** New options follow the existing pattern: a CLI flag, validated, recorded in the archive's `search` block **only when non-default**, so pre-existing archives still resume (see the `score` comment at `tools/bootstrap.ts:106`). Pure helpers go in `packages/search/src/*.ts` with vitest tests in `packages/search/test/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Search tests | `pnpm vitest run packages/search/test` | all pass (30 before; more after) |
| Stats tests | `pnpm vitest run packages/metrics/test/stats.test.ts` | all pass |
| All tests | `pnpm test` | all pass |
| GPU resume regression | `deno run -A tests/deno/bootstrap-resume.ts` | every line `PASS`, about 8 min |

## Scope

**In scope:**
- `packages/metrics/src/stats.ts` (`binomialLowerBound` only)
- `packages/metrics/test/stats.test.ts`
- `packages/search/src/mapelites.ts`
- `packages/search/src/retest.ts`
- `packages/search/test/gate.test.ts`, `packages/search/test/retest.test.ts` (add tests only; do not change existing expectations)
- `tools/retest.ts`, `tools/bootstrap.ts`

**Out of scope** (do NOT touch):
- `packages/schema/src/founders.ts` and `experiments/m3/*.json`: the pinned founder set and its records.
- `quality` and `qualityMaintenance` (`packages/search/src/evaluate.ts`), `DEFAULT_EVAL`, `DEFAULT_ARCHIVE`, every default flag value.
- `tools/nullcal.ts` (it has its own guard).
- Any existing `runs/` output. No new GPU screen runs; only the resume regression test, in a temp directory.

## Git workflow

- jj-colocated; other sessions may share the working copy. **Do not commit, bookmark or push.** List changed files at the end.

## Steps

### Step 1: `binomialLowerBound` refuses invalid input and handles large n

In `packages/metrics/src/stats.ts`, at the top of `binomialLowerBound`:

```ts
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(k) || k < 0 || k > n) throw new Error(`binomialLowerBound: need integers 0 <= k <= n, n >= 1; got k=${k}, n=${n}`);
```

Keep the existing algorithm unchanged for `n <= 1000`, so every current value stays bit-identical. For `n > 1000`, compute the tail in log space:

```ts
  if (n > 1000) {
    const tailLog = (p: number) => {
      // log of sum_{i>=k} C(n,i) p^i (1-p)^(n-i), by log-sum-exp over terms built from the mode outward.
      const lp = Math.log(p), lq = Math.log1p(-p);
      let logC = 0; // log C(n, 0)
      const terms: number[] = [];
      for (let i = 0; i <= n; i++) {
        if (i > 0) logC += Math.log((n - i + 1) / i);
        if (i >= k) terms.push(logC + i * lp + (n - i) * lq);
      }
      const m = Math.max(...terms);
      return m + Math.log(terms.reduce((s, t) => s + Math.exp(t - m), 0));
    };
    let lo = 0, hi = 1;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (tailLog(mid) < Math.log(alpha)) lo = mid;
      else hi = mid;
    }
    return lo;
  }
```

`Math.max(...terms)` can overflow the call stack for very large n. If `n` can exceed about 100,000 in your environment, replace it with a loop.

Add tests to `packages/metrics/test/stats.test.ts`:
- throws for `(undefined as any, 32)`, `(NaN, 32)`, `(33, 32)`, `(-1, 32)`, `(1.5, 32)`, `(0, 0)`;
- `binomialLowerBound(1000, 2000)` lies in [0.475, 0.49] (normal approximation 0.4816);
- `binomialLowerBound(600, 1100)` > 0.5;
- the existing three expectations still pass.

**Verify**: `pnpm vitest run packages/metrics/test/stats.test.ts packages/search/test/retest.test.ts` → all pass. The retest file regenerates the pinned founder set through `passesStrictM3`, so it guards the n ≤ 1000 path.

### Step 2: An explicit, optional gate predicate in `mapelites.ts`

1. Add exported gate predicates and a name type:

   ```ts
   export type GateName = "m3" | "maintenance";
   /** "maintenance": alive and light-dependent in every replicate; regeneration is reported, not required. */
   export function passesMaintenanceGate(e: Evaluation): boolean {
     return e.survived > 0 && e.lightDependent === e.reps;
   }
   export const GATES: Record<GateName, (e: Evaluation) => boolean> = { m3: (e) => passesGate(e), maintenance: passesMaintenanceGate };
   ```

2. Give `Archive` a third constructor parameter `readonly gate: (e: Evaluation) => boolean = passesGate`. Use it at line 82 (`if (this.gate(e))`) and at line 116 (`if (this.gate(el.eval)) l.passers++`). Give `Archive.replay(log, evaluated, spec, score)` an optional fifth parameter `gate = passesGate` and pass it through.
3. Give `confirmsGate(e, minReps = CONFIRM_REPS, gate = passesGate)` and `m3Gate(confirmations, minClusters, minReps, gate = passesGate)` the optional gate. Keep `passesGate` and every default as they are.

Add to `packages/search/test/gate.test.ts`:
- an evaluation with `regenerated: 0`, `survived: 4`, `lightDependent: 4`, `reps: 4` is not a passer under the default archive but is under `new Archive(DEFAULT_ARCHIVE, quality, passesMaintenanceGate)`;
- `m3Gate` with `passesMaintenanceGate` counts such genomes as confirmed;
- the default `m3Gate` results in the existing tests are unchanged (they already run).

**Verify**: `pnpm vitest run packages/search/test` → all pass.

### Step 3: Extracted, recorded retest selection

In `packages/search/src/retest.ts` add:

```ts
export type RetestRank = "row-order" | "seeded";
export interface RetestSelection { perStrong: number; rank: RetestRank; seed: number | null; confirm: string }

/** Deterministic permutation of 0..n-1 (Fisher-Yates over mulberry32(seed)). */
export function shuffledOrder(n: number, seed: number): number[]

/**
 * The retest's items: the generalist reference, then per cluster (in first-seen order) either every member
 * (a weak cluster: no member with a 16-replicate regeneration lower bound above 0.8) or the first `perStrong`
 * strong members, "first" meaning confirm.json row order ("row-order", the historical rule) or a seeded
 * shuffle of that cluster's strong members ("seeded"; seed + cluster id).
 */
export function selectRetestItems(rows: { pass: boolean; cluster: number; regenLowerBound: number; eval: Evaluation; genome: EncGenome }[], sel: RetestSelection, generalist: EncGenome): Omit<RetestRow, "eval">[]
```

Implement `shuffledOrder` with the mulberry32 used elsewhere (copy from `tools/lib/recurrence.ts:169-177`). Implement `selectRetestItems` so that `"row-order"` reproduces `tools/retest.ts:47-55` exactly, including labels `c<id>.<i>`, `prior` and the generalist first. Add `selection?: RetestSelection` to `RetestProvenance`.

In `tools/retest.ts`:
- add flags `--rank row-order|seeded` (default `row-order`) and `--rank-seed` (required when `seeded`);
- replace lines 47–55 with a `selectRetestItems` call;
- set `provenance.selection = { perStrong, rank, seed, confirm: a.confirm }`. Paths that read an old `retest.json` (`--from`) must still accept a provenance without `selection`.

Tests in `packages/search/test/retest.test.ts` (add only):
- `selectRetestItems` with `"row-order"` on a hand-made rows array (one weak cluster with 2 members; one strong cluster with 6 strong members) returns the generalist, both weak members, and the first 4 strong members in row order, with labels `c<id>.<i>`;
- `"seeded"` with seed 1 returns 4 strong members, deterministically, and differs from row order for at least one seed in 1..10;
- `shuffledOrder(10, 7)` is a permutation of 0..9 and is stable across calls.

**Verify**: `pnpm vitest run packages/search/test/retest.test.ts` → all pass, including the existing "regenerates exactly" test.

### Step 4: Bootstrap provenance, gate option, roles option and dependence hygiene

In `tools/bootstrap.ts`:

1. **Flags.** Add `"gate"` (values `m3 | maintenance`, default `m3`), `"dep-order"` (values `discovery | shuffled`, default `shuffled`) and boolean `roles` (default false).
   - Validate them as `--score` is validated.
   - Add `gate` to the `search` object **only when it is not `m3`**: `...(gateName !== "m3" ? { gate: gateName } : {})`.
   - Pass `GATES[gateName]` to `new Archive(...)`, to `Archive.replay(...)`, to `confirmsGate(...)` (all three call sites in this file) and to `m3Gate(rows, undefined, undefined, gate)`.
   - When resuming or confirming only, take the gate from `prev.search?.gate ?? "m3"`, as the score is taken from `prev.search?.score` at line 218.
2. **Roles.** With `--roles`, set `ec = { ...DEFAULT_EVAL, ...mediumPatch, seed, roles: true }`. Roles are an observer: they record each evaluation's role and never enter scores or gates. Because the resume check compares `ec` exactly, a search started without `--roles` cannot be resumed with it, which is correct.
3. **Provenance.** Add one top-level `provenance` object, built once, to the JSON written by `archiveJson` and to the confirm file:

   ```ts
   const provenance = { schemaVersion: SCHEMA_VERSION, ruleVersion: RULE_VERSION, metricsVersion: METRICS_VERSION, archiveSpec: DEFAULT_ARCHIVE, clusterDistance: CLUSTER_DISTANCE, gate: gateName, gateMinRecovery: 0.8, m3MinClusters: M3_MIN_CLUSTERS, confirmReps: reps, passBias: search.passBias, select: search.select, random: search.random, score: scoreName, roles: !!ec.roles, depOrder };
   ```

   It is a new key, so the existing resume comparisons of `eval` and `search` are unaffected.
4. **Dependence seeds and history.**
   - Add `dependenceSeeds: [depRange]` to the confirm file's `gate` detail when the re-screen runs.
   - When a previous confirm has a `dependence` block, keep its summary as `dependenceHistory: [...(prevConfirm?.dependenceHistory ?? []), { seed, seeds, obligate, n: rows.length }]` instead of dropping it.
   - In `packages/search/src/retest.ts` `usedSeeds`, append `gate.dependenceSeeds` ranges when present. Widen the parameter type to allow `dependenceSeeds?: unknown[]`.
5. **Dependence order.** With `--dep-order shuffled`, evaluate `passing` in the order `shuffledOrder(passing.length, depSeed)`. Rows keep their genomes, and every reader matches by genome. Record `order: "shuffled"` and the seed in the dependence block. With `discovery`, keep today's order.
6. **`--confirm-only` refuses to clobber.** When `--confirm-only` is given without `--resume` and `confirm.json` exists, throw `confirm.json exists: pass --resume to add confirmations, or use another --out`.

Add a test to `packages/search/test/retest.test.ts`: `usedSeeds` with `dependenceSeeds: [[50, 60]]` includes `[50, 60]`, and `checkFresh` then refuses a retest at seeds 55..56.

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run packages/search/test` → all pass.

### Step 5: Full verification, including the GPU resume regression

**Verify**:
- `pnpm typecheck` → exit 0.
- `pnpm test` → all pass.
- `deno run -A tests/deno/bootstrap-resume.ts` → every line `PASS`. It runs a default search (gate `m3`, no medium) in a temp directory, so with defaults unchanged it must still pass. It takes about 8 minutes on the GPU, longer if other GPU jobs are running. If it cannot get a GPU device, report that instead of retrying in a loop.

## Test plan

- `stats.test.ts`: six invalid-input throws; large-n values (n = 2,000 and n = 1,100).
- `gate.test.ts`: the maintenance gate in `Archive` and `m3Gate`; defaults unchanged.
- `retest.test.ts`: `selectRetestItems` row-order equivalence; seeded determinism; `shuffledOrder`; `usedSeeds` with dependence seeds.
- The existing "regenerates exactly" founder-set test must keep passing; it is the guard that history is untouched.
- GPU: `tests/deno/bootstrap-resume.ts` all PASS.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0
- [ ] `deno run -A tests/deno/bootstrap-resume.ts` prints only PASS lines
- [ ] `git diff --stat packages/schema/src/founders.ts experiments/m3` is empty
- [ ] `grep -n "selectRetestItems" tools/retest.ts` returns a match, and the inline `.slice(0, perStrong)` is gone from `tools/retest.ts`
- [ ] `grep -n "dependenceSeeds" packages/search/src/retest.ts tools/bootstrap.ts` returns matches in both
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 has not landed (drift check prints `0`).
- `packages/search/test/retest.test.ts`'s existing tests fail at any point: the pinned founder set would no longer regenerate.
- Any existing expectation in `stats.test.ts` or `gate.test.ts` changes value.
- `tests/deno/bootstrap-resume.ts` reports a FAIL.
- A change seems to require editing `quality`, `qualityMaintenance`, `DEFAULT_EVAL`, `DEFAULT_ARCHIVE` or any default flag value.

## Maintenance notes

- Future screens should pass `--gate maintenance --pass-bias 0 --roles` when regeneration is meant to be neutral and roles are wanted as a read-out. Roles stay a read-out: they never enter a score or gate. Selecting on roles would select for the held-out M5 outcome (`docs/plan.md`, founder diagnostic).
- The archive still keeps the incumbent on quality ties (`mapelites.ts:88`). Under a saturating score that favours the earliest genome to reach 1.0. Changing it alters search trajectories, so it is deliberately left alone; consider a tie-break on a content hash for a new, registered screen.
- A survival-only evaluation mode (skip lesion, regeneration and dark arms) would make dependence re-screens roughly 3× cheaper. It touches the evaluator's core path and is left for a separate plan.
