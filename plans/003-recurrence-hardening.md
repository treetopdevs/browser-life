# Plan 003: Make the recurrence readout safe to reuse (completeness, rule as written, clade keys, inactive "mixed")

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
> shasum -a 256 tools/recurrence-x.ts tools/lib/recurrence.ts tools/test/recurrence.test.ts | cut -c1-12
> ls tools/lib/clade.ts experiments/foundations/fx-root.json
> ```
>
> Expected: `81a965c74cbf`, `e37c10baf513`, `8028a6f8034d`, and both files
> listed (plan 002 creates them). If a hash differs, compare the "Current
> state" excerpts against the live code; on a mismatch, treat it as a STOP
> condition. If either file is missing, plan 002 has not landed: STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (analysis only; writes a new output file and leaves the recorded `fr.json` alone)
- **Depends on**: plans/002-regarden-founder-sets.md (`tools/lib/clade.ts`, `experiments/foundations/fx-root.json`)
- **Category**: bug
- **Planned at**: git `f08e1e6` plus the uncommitted jj working copy (change `smzqotqt`), 2026-09-30

## Why this matters

The recurrence readout (`tools/recurrence-x.ts`, logic in `tools/lib/recurrence.ts`) asks whether trophic roles keep re-originating after their first fill. It is about to become the bar for the next experiments (S6 producer-plus-obligate worlds, and the M4/10⁷ reading in plan 004). Its fixed definitions are in `docs/plan.md`, "Recurrence readout (fixed 2026-09-30, before computing)". It ran once on 416 runs (`experiments/foundations/fr.json`; results in `docs/plan.md`, "Recurrence results (2026-09-30)"). Before it can be reused, several gaps need closing:

1. **No completeness check.** `summary` reads whatever per-run records are cached and issues a reading. A partial cache (for example, 79 of 416) would still produce a headline. The fixed text says "Incomplete inputs decide nothing".
2. **The "mixed" rule is not in code.** The fixed text says that if the other counting strata disagree with the primary pool, "the reading is stated as mixed". The tool outputs only the primary pool's reading. The recorded result was stated as mixed by hand; a re-run on S6 would not do that.
3. **Bar (c) is ambiguous.** The prose says "the largest mutation-arm mean among the strata above (clouds, point founders, S1/S5 pool)". The code takes all clouds, all point founders and all diagnostic subjects. That is one reading; the counting-strata-only reading is the other. Both should be reported.
4. **Comparison (iii) is pooled.** The prose pairs "the clouds … with the solo runs of the same founder", returns only. The code pools all 12 founders, and also reports post-fill events there.
5. **Early re-entries undercount.** The prose counts all windows k ≥ 2 that start before 2×10⁵. The code counts only those that would be a return or a replacement, so flickers are dropped.
6. **Lineage-key precision.** Keys are packed as `hi * 2^32 + lo` numbers, which collide once `hi` (birth step + 1) exceeds 2^21, i.e. runs longer than about 2.1×10⁶ steps. Nothing in the walk guards against the resulting cycles.
7. **"mixed" includes inactive lineages.** `classify(photo, grow, decomp)` (`packages/metrics/src/ecology.ts:43-50`) returns "mixed" when all three fluxes are 0, and `profiles.tsv` stores a single step's fluxes. So part of every "mixed" window may be cells catalysing nothing. The share is unknown, and it bears on the recorded events: B's replacements include 3 "mixed" ones.
8. **Counting strata come from the old garden comparator.** `counting()` reads `experiments/foundations/fx.json`. Plan 002 writes `fx-root.json` with each candidate compared against its own ancestor.

## Current state

- `tools/lib/recurrence.ts` (pure, vitest-loadable). Key pieces:

  ```ts
  // tools/lib/recurrence.ts:100-120 (censusesFrom: no order check, no flux columns)
  export async function censusesFrom(
    rows: AsyncIterable<{ step: string; lineage: string; cells: string; role: string }>,
    rootOf: (lineage: string) => string,
  ): Promise<Census[]> {
    const out: Census[] = [];
    let cur: Census | null = null;
    for await (const r of rows) {
      const step = +r.step;
      if (!cur || cur.step !== step) {
        cur = emptyCensus(step);
        out.push(cur);
      }
      ...
  ```

  ```ts
  // tools/lib/recurrence.ts:138-146 (readRun's event loop)
      const held = new Set<string>(ws.length ? [ws[0].holder] : []);
      for (let k = 1; k < ws.length; k++) {
        const w = ws[k], gap = w.start - ws[k - 1].end;
        const kind: EventKind | null = gap >= GAP_MIN ? "return" : !held.has(w.holder) ? "replacement" : null;
        held.add(w.holder);
        if (!kind) continue;
        if (w.start < AFTER) early++;
        else events.push({ role, kind, start: w.start, end: w.end, holder: w.holder, gap });
      }
  ```

  `Census` is `{ step, total, byRole: Record<Role, Map<string, number>> }`. `RunRecord` (lines 261–271) has `id, family, group, mutation, seed, extinct, steps, readout, windows`. `bootstrapDiffInDiff` (lines 213–220) resamples four arms. `reading(diff)` (lines 223–227) is the fixed rule.
- `tools/recurrence-x.ts` (Deno CLI). Numeric key packing (lines 70–94):

  ```ts
  // tools/recurrence-x.ts:72-77
  const TWO32 = 4294967296;
  const num = (key: string) => {
    const [hi, lo] = key.split(":");
    return +hi * TWO32 + +lo;
  };
  const str = (n: number) => `${Math.floor(n / TWO32)}:${n % TWO32}`;
  ```

  `analyseRun` (lines 112–152) walks roots with `rootNum`, streams `profiles.tsv` through `censusesFrom`, and labels clades by a hash of the root genome. `counting()` (lines 213–224) reads `experiments/foundations/fx.json` `.uniform.perCloudOrSet`. `summaryCmd()` (lines 232–315) builds strata, comparisons and `barForStep1`, and writes `--out` (default `experiments/foundations/fr.json`).
- `tools/lib/clade.ts` (from plan 002): `parentMap(lines)` and `rootWalker(parents)`, with string keys and cycle detection.
- `experiments/foundations/fx-root.json` (from plan 002): `.uniform.perSubject[]` with `{ id, runsOriginating, counts }` for ids `founder-0…founder-11, S1, S2, S4, S5`.
- `profiles.tsv` header: `step lineage cells mass photo grow decomp resp role mu sigma motGain`.
- The cache holds 416 records under `runs/foundations/results/recurrence/` (`B-*`, `C-*`, `solo-*`, `diag-*`), written by the current code. They lack the new fields, so they must be recomputed (`--force`), which is CPU only.

**Conventions.** Pure logic and its tests go in `tools/lib/recurrence.ts` / `tools/test/recurrence.test.ts` (pattern: the `mk(n, spec)` census builder at the top of that test file). Stream every TSV. Exploratory outputs go to `experiments/foundations/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Recurrence tests | `pnpm vitest run tools/test/recurrence.test.ts tools/test/clade.test.ts` | all pass |
| All tests | `pnpm test` | all pass |
| Recompute per-run records (CPU) | `deno run -A tools/recurrence-x.ts runs --force` | 416 lines `… fills … post-fill …`, then `runs: 416 analysed, 0 cached, 0 outside layout` |
| Summary to a new file | `deno run -A tools/recurrence-x.ts summary --out experiments/foundations/fr-v2.json` | `wrote experiments/foundations/fr-v2.json` |

## Scope

**In scope:**
- `tools/lib/recurrence.ts`
- `tools/recurrence-x.ts`
- `tools/test/recurrence.test.ts`
- New output `experiments/foundations/fr-v2.json`, recomputed records under `runs/foundations/results/recurrence/`, and a one-time copy of the old records in `runs/foundations/results/recurrence-v1/`
- `docs/plan.md`: one dated paragraph (step 8)

**Out of scope** (do NOT touch):
- `experiments/foundations/fr.json`: the recorded result. Never overwrite it; always pass `--out experiments/foundations/fr-v2.json`.
- The fixed definitions `SHARE_MIN`, `SPAN_MIN`, `GAP_MIN`, `AFTER`, the bootstrap seeds and replicate count, and `reading()`.
- Role classification itself (`packages/metrics/src/ecology.ts`). The inactive share is reported, not used to relabel.
- `tools/foundations.ts`, `tools/founders-x.ts`.

## Git workflow

- jj-colocated; other sessions may share the working copy. **Do not commit, bookmark or push.** List changed files at the end.

## Steps

### Step 1: Order, spacing and inactive cells in `censusesFrom`

In `tools/lib/recurrence.ts`:

1. Add `inactiveMixed: number` to `Census` (cells in rows whose role is `mixed` and whose `photo`, `grow` and `decomp` are all 0). Initialise it to 0 in `emptyCensus`.
2. Widen the `censusesFrom` row type to `{ step: string; lineage: string; cells: string; role: string; photo?: string; grow?: string; decomp?: string }`. When the three flux fields are present and all equal `"0"`, and `role === "mixed"`, add `cells` to `cur.inactiveMixed`.
3. Throw when a row's step is lower than the current census step (`profiles.tsv rows out of order at step …`). Equal steps continue the census as now.
4. Add an exported helper:

   ```ts
   /** Deep-census cadence check: count, first and last step, and how many consecutive gaps differ from `every`. */
   export function spacing(dc: Census[], every = 1000): { censuses: number; firstStep: number | null; lastStep: number | null; gaps: number } {
     let gaps = 0;
     for (let i = 1; i < dc.length; i++) if (dc[i].step - dc[i - 1].step !== every) gaps++;
     return { censuses: dc.length, firstStep: dc[0]?.step ?? null, lastStep: dc.at(-1)?.step ?? null, gaps };
   }
   ```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Early re-entries as written, and the inactive share in `readRun`

In `readRun`'s loop, count every window k ≥ 2 that starts before `AFTER` as an early re-entry, whatever its kind. Then count events only at or after `AFTER`:

```ts
      const kind: EventKind | null = gap >= GAP_MIN ? "return" : !held.has(w.holder) ? "replacement" : null;
      held.add(w.holder);
      if (w.start < AFTER) {
        early++;
        continue;
      }
      if (kind) events.push({ role, kind, start: w.start, end: w.end, holder: w.holder, gap });
```

Add to `RunReadout`:
- `mixedInactiveShare: number | null`: over all censuses, the sum of `inactiveMixed` divided by the sum of mixed-role cells (`null` when there are no mixed cells).
- On each event whose role is `mixed`, `inactiveShare`: the same ratio over that window's censuses (i..j). Add it as an optional field on `PostFillEvent`.

Update the existing test `"windows k >= 2 that start before 2e5 are early re-entries, not counted"` only if it now fails. Its scenario is a replacement, so it should still give `earlyReentries === 1`. Then add tests:
- a flicker (same holder, gap < 10⁵) starting before 2×10⁵ now counts as an early re-entry;
- `censusesFrom` throws on a descending step;
- `censusesFrom` with flux columns tallies `inactiveMixed` (one mixed row with fluxes 0/0/0 and 10 cells, one mixed row with photo 3 and 5 cells → `inactiveMixed === 10`);
- `spacing` reports `gaps === 1` when one census is missing;
- `readRun(...).mixedInactiveShare` equals the expected ratio on a hand-built two-census input.

**Verify**: `pnpm vitest run tools/test/recurrence.test.ts` → all pass (existing + new).

### Step 3: The overall reading, both bar-(c) readings, and the paired comparison as pure functions

Add to `tools/lib/recurrence.ts`:

```ts
/** The fixed rule's overall statement: the primary reading if every non-empty counting stratum agrees with it, otherwise "mixed". */
export function overallReading(primary: StratumRow, counting: StratumRow[]): { reading: "one-shot" | "recurring" | "unclear" | "mixed"; disagree: string[]; empty: string[] } {
  const empty = counting.filter((s) => s.mutation.runs === 0 || s.noMutation.runs === 0).map((s) => s.stratum);
  const disagree = counting.filter((s) => !empty.includes(s.stratum) && s.reading !== primary.reading).map((s) => s.stratum);
  return { reading: disagree.length ? "mixed" : primary.reading, disagree, empty };
}

/**
 * Comparison (iii) as fixed: per founder, (B mutation - B no-mutation) - (solo mutation - solo no-mutation)
 * in one field (returns), averaged over founders; runs resampled within each of the four arms of each founder.
 */
export function bootstrapPairedDiffInDiff(groups: { x: { mut: number[]; nm: number[] }; y: { mut: number[]; nm: number[] } }[], seed: number, reps = 5000, level = 0.9): Interval {
  const ok = groups.filter((g) => g.x.mut.length && g.x.nm.length && g.y.mut.length && g.y.nm.length);
  if (!ok.length) return { n: 0, mean: NaN, lo: NaN, hi: NaN };
  const r = rng(seed), boots: number[] = [];
  const one = (g: (typeof ok)[number], f: (xs: number[]) => number) => f(g.x.mut) - f(g.x.nm) - (f(g.y.mut) - f(g.y.nm));
  for (let k = 0; k < reps; k++) boots.push(mean(ok.map((g) => one(g, (xs) => resampleMean(xs, r)))));
  boots.sort((p, q) => p - q);
  return { n: ok.length, mean: mean(ok.map((g) => one(g, mean))), lo: quantile(boots, (1 - level) / 2), hi: quantile(boots, 1 - (1 - level) / 2) };
}
```

Tests:
- `overallReading` gives the primary reading when all agree, "mixed" with the disagreeing names otherwise, and ignores empty strata. Build the `StratumRow` inputs with `summariseStratum` on small hand-made `RunRecord` arrays, or as minimal objects cast to `StratumRow`.
- `bootstrapPairedDiffInDiff` gives `mean === 0` when x and y are identical for every founder, and is deterministic for a fixed seed.

**Verify**: `pnpm vitest run tools/test/recurrence.test.ts` → all pass.

### Step 4: String clade keys and record metadata in `tools/recurrence-x.ts`

1. Delete `TWO32`, `num`, `str` and `parentsOf`. Import `parentMap` and `rootWalker` from `./lib/clade.ts`. In `analyseRun`:

   ```ts
   const rootOf = rootWalker(await parentMap(lines(`${dir}/mutations.tsv`)));
   ```

   Remove `rootMemo`/`rootNum`. `censusesFrom(tsv(...), rootOf)` stays; the `tsv` rows now carry `photo`/`grow`/`decomp`, so the inactive tally works with no other change.
2. Add `export const RECURRENCE_RECORD_VERSION = 2;` to `tools/lib/recurrence.ts`, and add to `RunRecord`: `version: number; spacing: { censuses: number; firstStep: number | null; lastStep: number | null; gaps: number }`. Fill both in `analyseRun` (`spacing(dc)`).

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Completeness, counting strata from `fx-root.json`, and the new summary fields

In `summaryCmd()`:

1. **Completeness.** Expected records: B 12 groups × 8, C 4 × 8, solo 12 × 8, diag 24 × 8 = 416, each with exactly 5 mutation and 3 no-mutation runs per group. Every record must also have `version === RECURRENCE_RECORD_VERSION`, `spacing.gaps === 0`, `spacing.firstStep === 100`, and either `spacing.lastStep === 999_100` or `extinct === true`. If anything fails, write `--out` as `{ complete: false, problems: [...] }` (each problem a short string naming the record and issue), print the first 20 problems, and return without readings.
2. **Counting strata.** `counting()` reads B and C from `experiments/foundations/fx-root.json` → `.uniform.perSubject` (ids starting `founder-` for B; `S1|S2|S4|S5` for C; `counts === true`). Throw `run plan 002 first` if the file is missing or `.uniform.complete !== true`. Solo (`t3.json`) and diag (`fd.json`) are unchanged.
3. **Overall reading.** `overallReading(primary, [rows for "B counting clouds", "Solo counting founders", "Diagnostic counting subjects"])` goes into the output as `overallReading`.
4. **Bar (c), both readings.** Keep `largestPooledMutationArmMean` as it is, and add `largestCountingMutationArmMean`: the same `best()` over the primary plus the three counting strata. Add `barCNote: "The fixed text names 'the strata above (clouds, point founders, S1/S5 pool)'; both readings of that phrase are reported; the operator chooses before S6 is read."`
5. **Comparison (iii).** Add `returnsPairedByFounder`: for each founder k = 0…11, x = B group `founder-k`, y = solo group `founder-k`, field `returns`, via `bootstrapPairedDiffInDiff(groups, 783)`. Rename the existing pooled entries to `returnsPooledLegacy` and `postFillPooledContextOnly`; keep their values.
6. **Inactive share.** Per stratum, report the mean of `readout.mixedInactiveShare` over its runs (mutation and no-mutation separately, nulls skipped). Under `eventsByRoleKind`, also list each mixed event's `inactiveShare`.
7. Add `complete: true` and `recordVersion` to the output.

**Verify**: `pnpm typecheck` → exit 0. `deno run -A tools/recurrence-x.ts summary --out /tmp/fr-check.json` **before** recomputing should write `complete: false`, because the cached records lack `version`, and must not throw.

### Step 6: Recompute the records (CPU)

First keep the old records for comparison: `cp -R runs/foundations/results/recurrence runs/foundations/results/recurrence-v1` (only if `recurrence-v1` does not exist yet). Then run `deno run -A tools/recurrence-x.ts runs --force`. This rewrites the 416 per-run cache records only. It takes CPU minutes to about an hour, and needs no GPU.

**Verify**: the last line reads `runs: 416 analysed, 0 cached, 0 outside layout`. Then `python3 -c "import json,glob;fs=glob.glob('runs/foundations/results/recurrence/*.json');print(len(fs),{json.load(open(f))['version'] for f in fs})"` → `416 {2}`.

### Step 7: Write `fr-v2.json` and compare it with `fr.json`

Run `deno run -A tools/recurrence-x.ts summary --out experiments/foundations/fr-v2.json`.

**Verify**: `python3 -c "import json;a=json.load(open('experiments/foundations/fr.json'));b=json.load(open('experiments/foundations/fr-v2.json'));print(b['complete'],b['overallReading']);print([(x['stratum'][:40],x['reading']) for x in b['strata']]);print('primary old/new',a['primaryReading']['reading'],b['primaryReading']['reading'])"`. Expect `True` and an `overallReading` object.

Then compare per run: `python3 -c "import json,glob,os;d=[(os.path.basename(f),json.load(open(f))['readout']['postFill'],json.load(open('runs/foundations/results/recurrence/'+os.path.basename(f)))['readout']['postFill']) for f in glob.glob('runs/foundations/results/recurrence-v1/*.json')];print(len(d),[x for x in d if x[1]!=x[2]][:10])"` → `416 []`. Every run's post-fill count must be unchanged.

Note every difference from `fr.json` in your report: primary reading; each stratum's reading; post-fill means; early re-entry means. Differences are expected only from (a) the composition of the *counting* strata, now taken from `fx-root.json` (strata named "counting" or "non-counting", the primary pool and comparison (ii)), and (b) early re-entries, which now count flickers. Strata that do not depend on counting ("C all four sets", "B clouds, all 12", "Solo point founders (test 3), all 12", "Diagnostic subjects, all 24") must have identical post-fill means; if they do not, STOP.

### Step 8: Record it in `docs/plan.md`

Append at the end (blank line first; fill the bracketed values from `fr-v2.json`; no interpretation beyond what is listed):

```markdown
**Recurrence readout, hardened rerun (YYYY-MM-DD; `experiments/foundations/fr-v2.json`).** Same fixed definitions; the tool now refuses incomplete inputs (416 of 416 complete), states "mixed" when the counting strata disagree (overall: <reading>; disagreeing: <list>), takes the counting strata from the re-gardened `fx-root.json`, counts every window k ≥ 2 before 2×10⁵ as an early re-entry, pairs comparison (iii) by founder (returns: <mean> [<lo>, <hi>]), reports both readings of bar (c) (pooled <x>, counting-only <y>), and uses string lineage keys. Per-run post-fill counts are unchanged from the first run; strata that depend on which sets count may differ. Share of "mixed" cells with no catalytic flux in the deep-census snapshot: <mutation mean> in mutation runs, <no-mutation mean> without, pooled over all 416 runs; mixed post-fill events: <n>, median inactive share <m>.
```

**Verify**: `tail -1 docs/plan.md` starts with `**Recurrence readout, hardened rerun`.

## Test plan

- `tools/test/recurrence.test.ts` gains: a flicker counted as an early re-entry; the out-of-order throw; the inactive tally; `spacing` gaps; `mixedInactiveShare`; `overallReading` (agree, disagree, empty); `bootstrapPairedDiffInDiff` (zero for identical, deterministic).
- Existing tests keep passing. If the early-re-entry test needs a change, change only its expectation and say why in your report.
- `pnpm test` → all pass.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0
- [ ] `grep -n "TWO32" tools/recurrence-x.ts` returns no matches
- [ ] `experiments/foundations/fr-v2.json` has `complete: true` and an `overallReading`
- [ ] `git diff --stat experiments/foundations/fr.json` is empty
- [ ] Every run's post-fill count equals its `recurrence-v1` record (416 of 416), and the four non-counting-dependent strata have identical post-fill means in `fr.json` and `fr-v2.json`
- [ ] `docs/plan.md` ends with the hardened-rerun paragraph
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 002's outputs (`tools/lib/clade.ts`, `experiments/foundations/fx-root.json` with `uniform.complete === true`) are missing.
- After recomputing, any run's post-fill count differs from its `recurrence-v1` record. The string-key walk should give the same roots at 10⁶ steps; a difference means a bug.
- Any run fails the spacing check (`gaps > 0`, or a non-extinct run's last step is not 999,100). Report which runs.
- A peer process is running `tools/recurrence-x.ts` (`ps aux | grep recurrence-x | grep -v grep`). Do not run concurrently against the same cache.

## Maintenance notes

- Plan 004 extends this tool to the M4 replays and the 10⁷ extension; it relies on `spacing`, string keys and `overallReading`.
- When S6 runs exist, add them as a new family in `groupOf` with their own seed layout, and choose the bar-(c) reading before reading S6.
- The inactive share is descriptive. If it is large in mixed events, a rule that excludes zero-flux rows from role shares would be a new, dated decision, and also needs the M4 role counts restated.
