# Plan 004: Read recurrence on the registered worlds (M4 replays and the 10⁷ extension), with null and threshold checks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: this plan builds on plan 003. Confirm it landed:
>
> ```bash
> grep -n "RECURRENCE_RECORD_VERSION\|export function overallReading\|export function spacing" tools/lib/recurrence.ts
> grep -n "rootWalker" tools/recurrence-x.ts
> ls experiments/foundations/fr-v2.json
> ```
>
> Expected: three matches in the first command, one or more in the second, and
> the file listed. If anything is missing, plan 003 has not landed: STOP.

## Status

- **Priority**: P1 (it decides the most with the least: $0, CPU only)
- **Effort**: M
- **Risk**: LOW (read-only on existing run bundles; new output files only)
- **Depends on**: plans/003-recurrence-hardening.md
- **Category**: direction (exploratory analysis)
- **Planned at**: git `f08e1e6` plus the uncommitted jj working copy (change `smzqotqt`), 2026-09-30

## Why this matters

The founder program's recurrence readout found role origination mostly "one-shot" after the first niche fill. Its primary pool (S1+S5) had 0 post-fill events, while B clouds and solo founders read "recurring" at about 0.2–0.3 events per run. But every run read was 10⁶ steps long, leaving at most 8×10⁵ steps after the 2×10⁵ cut-off.

The registered world already exists at much longer horizons:
- **M4 replays**: 10 treatment, 5 no-mutation and 20 neutral runs of `gradient-m3`, each with full lineage observers. These 12-founder worlds allow replacement events.
- **The registered 10⁷ extension**: 5 treatment, 5 no-mutation and 5 neutral runs of 10⁷ steps. Its `series.jsonl` records role shares at every deep census, giving 98×10⁵ post-fill steps.

Neither has been read for recurrence. If the extension shows no excess role returns over no-mutation at 10⁷, founder variants measured at 10⁶ cannot overturn that, and the next decision (forcing, RULE_VERSION 2) can be taken on that basis. If it does recur, the horizon is a lever.

The readout also needs two checks before anyone leans on it:
- **A null.** Neutral runs express one reference phenotype everywhere, so any "recurrence" there is ecological fluctuation, not heritable change.
- **Threshold robustness.** Roles come from a 0.6 dominance cut on single-step fluxes, and the "mixed" label includes cells that catalyse nothing.

## Current state

- `tools/recurrence-x.ts` and `tools/lib/recurrence.ts`, after plan 003:
  - `censusesFrom(rows, rootOf)` builds `Census[]` from `profiles.tsv` rows (`step, lineage, cells, role, photo, grow, decomp`), and throws on out-of-order steps.
  - `readRun(dc, cladeOf)` gives fills, events (`return` | `replacement`), `postFill`, `returns`, `earlyReentries` and `mixedInactiveShare`.
  - `spacing(dc, every)`, `summariseStratum(name, runs)`, `reading(diff)`, `overallReading(...)`.
  - `bootstrapDiff(a, b, seed)` and `bootstrapMean(xs, seed)`.
  - `RunRecord` has `family: "B" | "C" | "solo" | "diag"`, `version` and `spacing`.
  - Fixed constants: `SHARE_MIN 0.05`, `SPAN_MIN 1e5`, `GAP_MIN 1e5`, `AFTER 2e5`, `EXPOSURE_1E5 8` (10⁶-step runs only).
- `packages/metrics/src/ecology.ts:43` — `classify(photo, grow, decomp, dominance = 0.6): Role`, available as `@bl/metrics` in Deno tools and vitest.
- Run bundles (all verified present and finished):
  - `runs/replay-m4/gradient-m3/treatment/seed-{1..10}`, `.../no-mutation/seed-{1..5}`, `.../neutral/seed-{1..20}`. Each manifest has `spec.experiment === "replay-m4"`, `spec.condition` and `summary.steps === 1000000`. Files: `profiles.tsv` (about 18 MB), `mutations.tsv`, `genomes.tsv`.
  - `runs/m4-ext/gradient-m3/{treatment,no-mutation,neutral}/seed-{101..105}`, `spec.experiment === "m4-ext"`, `summary.steps === 10000000`, none extinct. No `profiles.tsv`/`genomes.tsv`. `series.jsonl` (about 77 MB per run) holds one JSON object per census (every 100 steps); deep censuses (steps 100, 1,100, …, 9,999,100) carry `"roles": { "phototroph": <share>, "chemotroph": …, "decomposer": …, "mixed": … }`, shares of living cells summing to 1. Example at step 100: `{"phototroph":0.671,"chemotroph":0,"decomposer":0.328,"mixed":0.0004}`.
- Seeds: none. This plan runs no simulation, and its bootstrap seeds are fixed constants in code.

**Conventions.** Pure logic goes in `tools/lib/recurrence.ts`, with tests in `tools/test/recurrence.test.ts`. Stream every file line by line; never `Deno.readTextFile` a whole `series.jsonl` or `profiles.tsv`. Outputs: `experiments/foundations/fr-m4.json`; per-run cache in `runs/foundations/results/recurrence-m4/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Tests | `pnpm vitest run tools/test/recurrence.test.ts` and `pnpm test` | all pass |
| Per-run records | `deno run -A tools/recurrence-x.ts runs-m4` | one line per run/variant, then `runs-m4: 155 written, 0 cached` |
| Summary | `deno run -A tools/recurrence-x.ts summary-m4` | `wrote experiments/foundations/fr-m4.json` |

## Scope

**In scope:**
- `tools/lib/recurrence.ts` (add functions; do not change existing behaviour)
- `tools/recurrence-x.ts` (add subcommands `runs-m4`, `summary-m4`)
- `tools/test/recurrence.test.ts`
- New: `runs/foundations/results/recurrence-m4/*.json`, `experiments/foundations/fr-m4.json`
- `docs/plan.md`: one dated "fixed before computing" paragraph (step 1) and one result paragraph (step 6)

**Out of scope** (do NOT touch):
- `fr.json`, `fr-v2.json`, the existing `runs` / `summary` subcommands and their families, and every existing constant or rule in `tools/lib/recurrence.ts`.
- Run bundles under `runs/replay-m4`, `runs/m4-ext` (read only).
- `packages/**`.

## Git workflow

- jj-colocated; other sessions may share the working copy. **Do not commit, bookmark or push.** List changed files at the end.

## Steps

### Step 1: Fix the definitions in `docs/plan.md` before computing anything

Append at the end of `docs/plan.md` (blank line first; replace `YYYY-MM-DD`). Do this **before** step 4 runs, and do not change it afterwards:

```markdown
**Recurrence on the registered worlds (fixed YYYY-MM-DD, before computing).** The recurrence readout's definitions (windows, fills, returns, replacements, the 2×10⁵ cut-off, the bootstrap and the reading rule) applied unchanged to two families not read before. Exploratory and descriptive; zero GPU; output `experiments/foundations/fr-m4.json`.
- *M4 replays* (`runs/replay-m4/gradient-m3`): treatment seeds 1–10 against no-mutation seeds 1–5, post-fill events per run (returns and replacements, clades from `mutations.tsv`). Null: the 20 neutral replays read by the same rule against the same no-mutation runs.
- *10⁷ extension* (`runs/m4-ext/gradient-m3`, seeds 101–105 per condition): role shares from `series.jsonl` at every deep census. No lineage profiles exist, so only returns can be counted (no clades). Events are returns in windows starting at or after 2×10⁵; treatment against no-mutation, neutral as the null. Reported beside it, descriptively: returns per 10⁶-step block, and returns in windows starting at or after 5×10⁶.
- *Specificity.* A family's treatment reading counts as specific only if its neutral null does not read "recurring"; otherwise it is reported as "not specific".
- *Threshold robustness (M4 replays only, since the extension stores shares, not fluxes).* Roles recomputed from `profiles.tsv` fluxes at dominance 0.5 and 0.7, and at 0.6 with zero-flux rows counted in the living total but in no role. The treatment reading is "robust" if all four variants (0.5, 0.6, 0.7, 0.6 without inactive rows) give the same reading, and "threshold-sensitive" otherwise.
- *What it would mean, stated now.* An extension reading of one-shot (mean difference ≤ 0) is recorded as "no excess role returns over no-mutation at 10⁷ in the registered world". A specific "recurring" is recorded as such, with the per-block profile showing whether returns persist late. Either way the roles are tracker-free here, but they are still flux-snapshot labels, and the entity question is untouched.
```

**Verify**: `tail -6 docs/plan.md` shows the paragraph.

### Step 2: Pure helpers in `tools/lib/recurrence.ts`

Add, without changing anything existing:

1. **Role override in `censusesFrom`.** Add an optional third parameter `roleOf?: (r: { role: string; photo?: string; grow?: string; decomp?: string }) => Role | null`. When it is given, use its result instead of `r.role`; `null` means "count the cells in `total` but in no role". When absent, behaviour is exactly as now.
2. **Dominance and inactive variants.** Import `classify` from `@bl/metrics`, then:

   ```ts
   export type RoleVariant = "d0.5" | "d0.6" | "d0.7" | "d0.6-noinactive";
   export const ROLE_VARIANTS: readonly RoleVariant[] = ["d0.5", "d0.6", "d0.7", "d0.6-noinactive"];
   /** Role from a profiles.tsv row's fluxes under a variant; null = an inactive row excluded from roles. */
   export function variantRole(v: RoleVariant): (r: { photo?: string; grow?: string; decomp?: string }) => Role | null {
     const d = v === "d0.5" ? 0.5 : v === "d0.7" ? 0.7 : 0.6;
     return (r) => {
       const p = +(r.photo ?? 0), g = +(r.grow ?? 0), dc = +(r.decomp ?? 0);
       if (v === "d0.6-noinactive" && p + g + dc === 0) return null;
       return classify(p, g, dc, d) as Role;
     };
   }
   ```

   Check that `variantRole("d0.6")` reproduces each row's stored `role` column. The test in step 3 covers this, and step 4 asserts it on real data.
3. **Censuses from series.jsonl role shares.**

   ```ts
   /** Deep censuses from series.jsonl objects that carry `roles` (shares of living cells). One pseudo-root "all"; total 1. */
   export function censusFromSeriesLine(o: { step: number; roles?: Record<string, number> }): Census | null {
     if (!o.roles) return null;
     const c = emptyCensus(o.step);
     c.total = 1;
     for (const r of ROLES) c.byRole[r].set("all", o.roles[r] ?? 0);
     return c;
   }
   ```

   `share(c, r)` then returns the stored share exactly, with no rounding.
4. **Block profile and late count.**

   ```ts
   /** Returns per block of `block` steps (by window start), and the number starting at or after `late`. */
   export function returnProfile(events: PostFillEvent[], block: number, nBlocks: number, late: number): { perBlock: number[]; late: number } {
     const perBlock = Array.from({ length: nBlocks }, () => 0);
     for (const e of events) if (e.kind === "return") perBlock[Math.min(nBlocks - 1, Math.floor(e.start / block))]++;
     return { perBlock, late: events.filter((e) => e.kind === "return" && e.start >= late).length };
   }
   ```

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Tests for the helpers

In `tools/test/recurrence.test.ts` add:
- `censusesFrom` with a `roleOf` that returns `null` for one row: that row's cells are in `total` but in no role.
- `variantRole("d0.6")` on rows `{photo:"10",grow:"0",decomp:"0"}` → `"phototroph"`; `{photo:"0",grow:"0",decomp:"0"}` → `"mixed"`; and `variantRole("d0.6-noinactive")` on the zero row → `null`. `variantRole("d0.5")` on `{photo:"5",grow:"5",decomp:"0"}` → `"phototroph"` (0.5 ≥ 0.5), while `d0.6` gives `"mixed"`.
- `censusFromSeriesLine` → `share(c, "decomposer")` equals the input share exactly; a line without `roles` → `null`.
- `returnProfile` with returns at starts 250,000, 1,500,000 and 6,000,000, blocks of 10⁶, 10 blocks, late 5×10⁶ → `perBlock[0] === 1`, `perBlock[1] === 1`, `perBlock[6] === 1`, `late === 1`.

**Verify**: `pnpm vitest run tools/test/recurrence.test.ts` → all pass.

### Step 4: `runs-m4` subcommand (CPU)

In `tools/recurrence-x.ts` add `async function runsM4Cmd()` and `case "runs-m4"`. Write records to `runs/foundations/results/recurrence-m4/` (create it), skipping files that exist unless `--force`. Use the record shape of `RunRecord`, widening `family` to include `"m4r" | "ext"` in `tools/lib/recurrence.ts`, and add `condition: string` and `variant: string`.

- **M4 replays.** For each `condition` in `treatment | no-mutation | neutral` and each run directory under `runs/replay-m4/gradient-m3/<condition>/`:
  - read the manifest; require `spec.experiment === "replay-m4"` and `summary.steps === 1000000`;
  - build the root walker once (`rootWalker(await parentMap(lines(mutations.tsv)))`) and the clade labels as in `analyseRun`;
  - for each variant in `ROLE_VARIANTS`, stream `profiles.tsv` again with `censusesFrom(tsv(...), rootOf, variantRole(v))`, run `readRun`, and store the record as `m4r-<condition>-<seed>-<variant>.json`, with `group: condition`, `mutation: condition === "treatment"`, and `spacing(dc)`.
  - **Assert once per run**: for variant `d0.6`, the role computed from the fluxes equals the stored `role` column on every row. Do the check inside the stream with a counter, and throw on the first mismatch with its step and lineage.
  - Expected: 35 runs × 4 variants = 140 records.
- **Extension.** For each condition and each `seed-*` under `runs/m4-ext/gradient-m3/<condition>/`:
  - require `spec.experiment === "m4-ext"` and `summary.steps === 10000000`;
  - stream `series.jsonl` line by line, `JSON.parse` each line, and keep `censusFromSeriesLine(o)` results that are not null;
  - `readRun(dc, () => "all")`;
  - add `profile: returnProfile(readout.events, 1_000_000, 10, 5_000_000)`, and store `ext-<condition>-<seed>.json` with `variant: "shares"`.
  - Expected: 15 records.
- Print one line per record, then `runs-m4: <n> written, <k> cached`.


**Verify**:
- `ls runs/foundations/results/recurrence-m4/*.json | wc -l` → `155`.
- Every M4 record has `spacing.gaps === 0`, `spacing.firstStep === 100` and `spacing.lastStep === 999100`, unless extinct.
- Every extension record has `spacing.gaps === 0` and `spacing.lastStep === 9999100`. Check with a short `python3 -c` over the JSON files.

### Step 5: `summary-m4` subcommand

Add `async function summaryM4Cmd()` and `case "summary-m4"`. It reads every record in `runs/foundations/results/recurrence-m4/` and checks completeness: M4 has 10/5/20 runs per condition × 4 variants; the extension has 5/5/5. If incomplete, write `{ complete: false, problems }` and stop. Then compute:

1. **M4, per variant v**:
   - `main = summariseStratum("m4 " + v, [...treatment_v, ...noMutation_v])`, where treatment has `mutation: true` and no-mutation `mutation: false`;
   - `nullRow = summariseStratum("m4 neutral " + v, [...neutral_v.map((r) => ({ ...r, mutation: true })), ...noMutation_v])`.
   - Record `main.reading`, `main.diffPostFill`, `main.diffReturns`, `nullRow.reading`, and the mean `mixedInactiveShare` per condition.
2. **M4 robustness**: `"robust"` if `main.reading` is identical for all four variants, otherwise `"threshold-sensitive"`. **Specificity** (on variant d0.6): `"specific"` unless `nullRow.reading === "recurring"`.
3. **Extension**:
   - `ext = summariseStratum("ext", [...treatment, ...noMutation])`. Use `diffReturns` as the primary statistic; post-fill equals returns here, since there are no replacements.
   - `extNull = summariseStratum("ext neutral", [...neutral.map(m => ({...m, mutation: true})), ...noMutation])`.
   - Per condition, the mean `profile.perBlock` and the mean `profile.late`.
   - Specificity as above.
   - Note that `perE5` from `summariseStratum` assumes 10⁶-step runs, so for the extension compute rates as returns / 98 per 10⁵ steps yourself, and do not report `perE5`.
4. **Wording**, stated exactly as fixed in step 1:
   - extension one-shot → `"no excess role returns over no-mutation at 10⁷ in the registered world"`;
   - extension recurring and specific → `"excess role returns at 10⁷ (specific)"`;
   - extension recurring and not specific → `"recurring but not specific (neutral also recurs)"`;
   - unclear → `"unclear"`.
5. Write `experiments/foundations/fr-m4.json` with `{ note, complete: true, definitions, m4: { byVariant, robustness, specificity }, ext: { reading, diffReturns, null, specificity, perBlockMean, lateMean, statement } }`.

**Verify**: `deno run -A tools/recurrence-x.ts summary-m4` → `wrote experiments/foundations/fr-m4.json`. `python3 -c "import json;d=json.load(open('experiments/foundations/fr-m4.json'));print(d['complete'],d['m4']['robustness'],d['m4']['specificity'],d['ext']['statement'])"` → `True` plus three strings.

### Step 6: Record the result in `docs/plan.md`

Append (blank line first) one factual paragraph using only `fr-m4.json` values, in this template:

```markdown
*Result (YYYY-MM-DD; `experiments/foundations/fr-m4.json`).* M4 replays, post-fill events per run, treatment <m> [<lo>, <hi>] against no-mutation <n>: <reading> (<robust|threshold-sensitive> across dominance 0.5/0.6/0.7 and without inactive rows; neutral null reads <reading>, so <specific|not specific>). 10⁷ extension, returns per run, treatment <m> [<lo>, <hi>] against no-mutation <n> (neutral <k>): <statement>. Returns per 10⁶ block, treatment mean: <b1, …, b10>; returns starting at or after 5×10⁶: treatment <x>, no-mutation <y>. Mean share of "mixed" cells with no flux in M4 replays: treatment <a>, no-mutation <b>, neutral <c>.
```

**Verify**: `tail -1 docs/plan.md` starts with `*Result (`.

## Test plan

- New tests in `tools/test/recurrence.test.ts`: the `roleOf` override; `variantRole` (three variants, and the 0.5 boundary); `censusFromSeriesLine`; `returnProfile`. Pattern: the existing `mk(n, spec)` helper tests.
- `pnpm test` → all pass.

## Done criteria

- [ ] `pnpm typecheck` exits 0; `pnpm test` exits 0
- [ ] 155 records in `runs/foundations/results/recurrence-m4/`, all with clean spacing
- [ ] The d0.6 role assertion passed on all 35 M4 runs (no throw)
- [ ] `experiments/foundations/fr-m4.json` has `complete: true`
- [ ] `docs/plan.md` has the fixed paragraph (written before step 4) and the result paragraph
- [ ] `fr.json` and `fr-v2.json` are unchanged
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 003 has not landed (drift check).
- Any expected run directory is missing, or not finished (M4: 10/5/20 at 10⁶; extension: 5/5/5 at 10⁷).
- The d0.6 role assertion fails. The stored role column would then not be what `classify` gives at 0.6, so the variants are not comparable.
- A spacing check fails (gaps, wrong first or last step).
- Memory use climbs because a whole file is being held. Stream instead; if you cannot, stop.
- You would need to change any fixed constant (`SHARE_MIN`, `SPAN_MIN`, `GAP_MIN`, `AFTER`) or `reading()`.

## Maintenance notes

- `EXPOSURE_1E5` and `perE5` assume 10⁶-step runs. The extension's rates are computed separately; do not reuse `perE5` for other horizons.
- The improvement study in the `browser-life-founder-policy` workspace (64 single-founder histories, mutation on/off, checkpoints every 10⁵) could get the same returns-only reading later, if its runs can be replayed with observers. That is a separate decision.
- If the M4 reading is "threshold-sensitive", any registered use of role windows needs a classifier decision first. Record that as a dated decision, not a silent change.
