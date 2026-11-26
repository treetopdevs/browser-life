# I02b PLAN: held-out confirmation of the prediction envelope on fresh families

Slice I02b, branch `claude/i02-confirm` (from origin/main 8a44ae38), 2026-11-02. CPU only (sim-ref); no model call, GPU, network or paid compute.
Sources: `docs/simulation-research-2026-11-01/report.md` (I02 and "Agent execution contract"), `docs/prediction-envelope-2026-11-01/EVIDENCE.md`
(missing: a real confirmation), `docs/backlog-run-2026-11-01.html` D11, D13, D14. Reuses `tools/predict.ts`, `tools/lib/prediction/*`,
`experiments/prediction-envelope/`; no parallel harness.

## 1. Bounded question

On families never used by v0 dev, test or qualify, does the one evidence-using rule, `numericTrend` (the single nominated primary rule), beat (a) its shuffled-evidence control and (b) `priorMajority` on multiclass
Brier (primary readout bodyMass, minEffect 25, frozen), with whole-family bootstrap intervals? All other proposers are descriptive only (plan review P1-3, P1-4). This is a statement about the v0 CPU
fixture mechanisms only. It says nothing about any model, GPU world or production preset. Success is not required: negative and
uninformative are valid, reported results.

## 2. Key design decision: freeze identity vs fresh families

`protocolHash` covers the whole canonical protocol, families included, so fresh families cannot live in the frozen `protocol.json`
without changing its hash, and that file (and `protocol.freeze.sha256`) must not change; the gate `git diff origin/main -- experiments/prediction-envelope/protocol.json experiments/prediction-envelope/protocol.freeze.sha256` must be empty.
Resolution: a second protocol file, `experiments/prediction-envelope/protocol.confirm.json` with its own `protocol.confirm.freeze.sha256`, that is the
frozen protocol with ONLY these fields replaced: `salt`, `families`, `cohorts`, `donors`, `nDev`, `nQualify`. Every other field is byte-equal to v0. The
test deep-compares them. `families[]` and `cohorts` are NOT exempt from content checks (review P2-8): a test asserts that for every new family the
`light/nutrient/founders` tuple equals the v0 recipe at the same cycle index (`light = [spots,gradient][k%2]`, `nutrient=[0,1,2][k%3]` as in `draftProtocol`, `founders=3+k%3`) read from the
committed v0 `protocol.json`, never retyped; rising families use `spots`, nutrient 50, founders from a prefix of the v0 rising founders list. `devPrior` and `minEffect` are transferred from v0 dev
unchanged and the amendment registers that transfer and the sampling weights (rising share 25%, equal to v0's overall rising share) explicitly. Fresh "dev" families only satisfy split
machinery and play no role in any decision. This is a new protocol file sharing v0's frozen parameters, and the amendment says so plainly; it is not "the v0 file unchanged".

## 3. Fresh-family recipe (fixed in the amendment, before any outcome)

- Salt `i02-prediction-confirm-2026-11-02`; family ids `c00..c19` (v0 uses `f00..f31`).
- Seeds `6000..6019` (v0: 5000..5031; v0 seed variants +7919 = 12919..12950; fresh variants would be 13919..13938; none overlap).
- 20 families: 15 original-style (indices k=0..14 of the v0 cycle) and cohort `rising` 5 (founders 1,2,3,4,5, prefix of the v0 rising list). `nDev` 3 (original) + 1 (rising),
  `nQualify` 0 => test = 12 original + 4 rising = 16 families, 96 test cases. 16 >= MIN_FAMILIES_FOR_INTERVALS (10). The test asserts these counts through `splitPlanOf`.
- The recipe is a pure function `freshFamilies()` in `tools/lib/prediction/confirm.ts`; no probe of any outcome.
- Budget decided NOW from existing v0 evidence, with no smoke or timing run on the confirmation families (review P1-2): `experiments/prediction-envelope/v0/meta.json` wallMs 327641 for 32 families (+ seed variants)
  on an M1 Max. 20 families without variants is about 3.5 min idle and about 10 min at load x3. The size is fixed here; it is never changed after the freeze commit. Runtime has no effect on sample size.
  Any timing or smoke check before the freeze uses the v0 protocol or a tiny throwaway protocol with seeds outside 6000..6019, never a confirmation family.
- Disjointness is checked by effective simulation identity, without simulating anything (review P2-9): the set of (seed, light, nutrient, founders) and seed+seedVariantOffset from the
  new protocol against v0 `protocol.json` AND v0 `recipes.jsonl` (including variant seeds). History ids embed family ids and are not a valid disjointness key; the test also asserts seeds alone are disjoint.

## 4. Order of operations (the run step is gated on the commit)

1. Write `AMENDMENT.md` (section 5), `confirm.ts`, CLI plumbing and tests. Build `protocol.confirm.json` and its freeze hash via `predict.ts protocol-confirm` (never overwrites; builds from the recipe, no simulation).
   Pre-run gates (section 8a) pass. Commit ("I02b amendment and fresh-family freeze") BEFORE any confirm run. Only pure helpers, protocol building and unit tests touch the new families; no `generate`, `smoke`, `dev` or `buildOutputs` on them.
2. The confirm run refuses unless ALL of these hold (review P1-1): committed HEAD blobs of `AMENDMENT.md`, `protocol.confirm.json` and `protocol.confirm.freeze.sha256` equal the working copies; the working tree is clean over `tools packages experiments/prediction-envelope deno.json package.json tsconfig.json`
   (so the executable closure is exactly the committed one; the existing `gitDirty` is promoted from a meta field to a refusal for this protocol); the out dir does not exist or is empty (no overwrite, review P2-12); protocol hash equals the freeze hash. Every protocol/freeze path the CLI reads (gate, `generate`, `meta`, `report`, `validate`) goes through the selected `--protocol/--freeze`, not the `PROTOCOL`/`FREEZE` constants.
3. Run: `deno run -A --no-lock tools/predict.ts run --stage confirm --protocol experiments/prediction-envelope/protocol.confirm.json --freeze experiments/prediction-envelope/protocol.confirm.freeze.sha256 --amendment docs/prediction-confirm-2026-11-02/AMENDMENT.md --out experiments/prediction-envelope/confirm-2026-11-02`
   (no `--exploratory`; meta.json must say `status: "CONFIRM"`, and `--exploratory` combined with `--protocol` for this protocol is refused). Then `predict.ts confirm-analysis --out DIR` writes `confirmation.json` and the committed ledger `ledger.jsonl` (below).
4. Write `RESULT.md` by applying section 5 mechanically (generated table first, prose only restating it); render the notebook; commit outputs.
Attempts (review P2-12): the first completed run is the attempt of record and stays committed. Replays for reproducibility go to `/tmp` only and are compared by digest, never copied over. If the run fails or a scoring bug is found:
stop, record in `docs/prediction-confirm-2026-11-02/BUG.md`, keep any partial output untouched. A rerun on changed code requires a new dated amendment AND a newly drawn disjoint family set (new salt and seed range), because the first families have been seen.
A crash before any outcome is written (e.g. out of memory) may be rerun unchanged on the same families; the amendment states this.
`envelopes.jsonl` / `predictions.jsonl` stay gitignored like v0, with digests in `canonical.sha256`.

## 5. Amendment content (AMENDMENT.md, fixes before outcomes)

1. Identity: freeze commit SHA recorded in RESULT.md; the amendment names the frozen v0 protocol hash, the confirm protocol hash, family list, seeds, salt, transferred `devPrior`/`minEffect`, sampling weights.
2. No change to any threshold, minEffect, readout, proposer, scoring or bootstrap setting.
3. One primary rule: `numericTrend`. Two primary comparisons on the test split (imputed multiclass Brier, per-family means, paired whole-family bootstrap difference
   `numericTrend` minus comparator, protocol resamples and seed, 95% percentile interval): (A) vs `shuffledEvidence`, (B) vs `priorMajority`. Everything else (`v0Rules`, `fixedRule`, `shuffledEvidence`, `priorMajority`, always-none and any other) is descriptive and cannot
   produce a POSITIVE/NEGATIVE claim: `v0Rules` and `fixedRule` choose from the operation kind alone, so shuffling evidence cannot change them and beating `priorMajority` would not show evidence use (review P1-3). `mechanismRule` is a dev oracle and is not evaluated on test. A single named rule with a conjunction of two
   comparisons means no across-rule multiplicity correction is needed or claimed (P1-4). Secondary, descriptive: directional accuracy, coverage, invalid counts, trend-confound diagnostic, label agreement with fixture expectations, measurement-limited share.
   Stated limitation (P2-5): the shuffled control for case i is another family's evidence from the cyclic donor map, so per-family differences in comparison (A) are mildly dependent and the unchanged independent-family bootstrap is nominal for (A); the amendment does not claim calibrated coverage for (A), and POSITIVE requires (B) as well, which has no donor coupling.
4. Reading, applied mechanically, in this precedence:
   a. UNINFORMATIVE (override) if any of: fewer than 10 test families; `meta.status != CONFIRM`; either primary interval is null or has a non-finite endpoint; the paired family sets of numericTrend and the comparator are not identical (pairing incomplete);
      `numericTrend` has any invalid or missing prediction on the test split; `numericTrend` is degenerate (one predicted class on all of its answered test cases, or zero answered); or measurement-limited cases exceed 25% of test cases. The comparators `priorMajority` and
      `shuffledEvidence` are exempt from the degenerate check (priorMajority is constant by design) but must have complete valid predictions, else UNINFORMATIVE. Degeneracy and the 25% share are evaluated from the ledger by the pure function, not by eye.
   b. NEGATIVE iff some primary interval lies wholly above 0 (supported inferiority).
   c. POSITIVE iff both primary intervals lie wholly below 0.
   d. Otherwise UNINFORMATIVE, with the descriptive suffix "no improvement shown" when the point estimate vs `priorMajority` is >= 0, else "improvement not supported"; the suffix does not change the label (P2-7: a nonnegative point estimate alone is never NEGATIVE).
5. Meaning: POSITIVE = on these fixtures numericTrend beat its shuffled control and the prior out of sample; not evidence for any model, production world or the naturalist feature. NEGATIVE = numericTrend is worse than a comparator with interval support.
   UNINFORMATIVE = fixtures or counts could not decide; no claim. v0 exploratory numbers are not reused as evidence.
6. Failed predictions are reported first and in full; no post-hoc relabelling, threshold change, family exclusion or reinterpretation. Deviations go in a dated addendum, never an edit of earlier text.

## 6. Files

Add: `docs/prediction-confirm-2026-11-02/{PLAN.md,AMENDMENT.md,RESULT.md,REVIEW.md,review-sol-plan.txt}`; `tools/lib/prediction/confirm.ts` (fresh recipe, protocol-confirm builder asserting only identity fields differ and v0-recipe tuples match, disjointness helper,
`confirmRefusal`-style extended gate `amendmentRefusal(...)` pure and unit-testable, pure `confirmReading(ledger, ...)` reader, paired intervals via existing `familyBootstrap`/`pairedFamilyDiff`);
`experiments/prediction-envelope/{protocol.confirm.json,protocol.confirm.freeze.sha256}`;
`experiments/prediction-envelope/confirm-2026-11-02/*` (comparison.{json,md}, confirmation.json, `ledger.jsonl`, outcomes.jsonl, report.html, meta.json, canonical.sha256, confirm.sha256, .gitignore);
tests `tools/test/prediction-confirm.test.ts`.
`ledger.jsonl` (review P2-10) is the committed sufficient scoring input: one row per test case per proposer with family id, case id, proposer id, status (valid/invalid/missing), predicted class, probability vector, observed label, measurement-limited flag; it is small (about 6 proposers x 96 cases). `confirmation.json` (the decision) and `ledger.jsonl` are hashed in `confirm.sha256`, which `analysis` writes, so the reading is sealed independent of the gitignored `envelopes.jsonl`/`predictions.jsonl`. `confirmReading` recomputes the reading from the ledger alone.
Change: `tools/predict.ts` (`--protocol/--freeze/--amendment` for confirm, `protocol-confirm` and `confirm-analysis` subcommands; defaults unchanged so v0 reproduces),
`tools/lib/prediction/output.ts` (the confirm manifest and `rerender` taking the confirmation results and status) and `report-html.ts` (confirmation section, CONFIRM/EXPLORATORY banner; failed-first ordering already present),
`docs/prediction-envelope-2026-11-01/EVIDENCE.md` (link to RESULT and report). No change to `score.ts`, `proposers.ts`, `readouts.ts`, `run.ts` scoring or `generate`/`runFamily`.

## 7. Tests (tools/test/prediction-confirm.test.ts, named cases)

- `fresh families are disjoint from every v0 family`: identity tuples, seeds, seed+seedVariantOffset against committed v0 `protocol.json` and `recipes.jsonl`; no simulation is run.
- `confirm protocol differs from the frozen protocol only in identity fields`: deep-compare every other key; freeze hash file equals `protocolHash`; v0 `protocol.json` bytes unchanged; recipe tuples equal the v0 cycle (k) read from the file.
- `split plan: 16 test families (12 original, 4 rising), no family in two splits, donors stay within split, assertNoLeak clean`.
- `gate refuses`: unit tests of the extended gate with fake committed copies: amendment missing/differs, protocol differs, freeze differs, dirty closure, non-empty out dir, `--exploratory` with the confirm protocol; passes when all match.
- `CLI honours --protocol`: a tiny throwaway 2-family protocol (seeds 9000+, never the confirm families) run through the smoke path produces exactly its families; v0 default behaviour (no flags) is unchanged (command parse check, no simulation of confirm families).
- `reading`: positive / negative / uninformative on synthetic ledgers, each override (9 families, EXPLORATORY status, null interval, incomplete pairing, invalid predictions, degenerate, zero answered, >25% measurement-limited) and the precedence (an override beats NEGATIVE).
- `negative fixture fools a naive metric`: a synthetic numericTrend that predicts at least two classes, has high raw directional accuracy on easy cases, yet loses Brier (overconfident wrong probabilities) to `priorMajority` with an interval wholly above 0: reading NEGATIVE while accuracy alone says positive.
  Separate case: an always-`none` predictor is degenerate, so the reading is UNINFORMATIVE (override), not POSITIVE. These two expectations are intentionally different and not in conflict.
- `non-negative point estimate is not NEGATIVE`: point +1e-6 with interval spanning 0 is UNINFORMATIVE ("no improvement shown").
- `report lists failed predictions first and shows CONFIRM status and the reading table` (render with a fixture; assert order and no scripts/external URLs).
- `delivered confirm outputs` (post-delivery group, section 8b only): reads committed `confirmation.json` and `ledger.jsonl`, asserts status CONFIRM, protocol hash equals the freeze hash, test families >= 10, `confirm.sha256` verifies, and the reading equals `confirmReading()` recomputed from the ledger.

## 8. Acceptance gates (runnable)

8a. Pre-run (before the freeze commit; the delivered-output test is skipped/absent here):
```
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install
pnpm vitest run --maxWorkers=2 tools/test/prediction-*.test.ts   # `delivered confirm outputs` is skipIf(no committed confirmation.json)
deno check tools/predict.ts tools/lib/prediction/confirm.ts tools/lib/prediction/output.ts tools/lib/prediction/report-html.ts   # root tsc excludes tools
pnpm typecheck
git diff origin/main --quiet -- experiments/prediction-envelope/protocol.json experiments/prediction-envelope/protocol.freeze.sha256 packages/ tools/lib/prediction/score.ts tools/lib/prediction/proposers.ts tools/lib/prediction/readouts.ts
git commit ...                                   # amendment + freeze
for f in docs/prediction-confirm-2026-11-02/AMENDMENT.md experiments/prediction-envelope/protocol.confirm.json experiments/prediction-envelope/protocol.confirm.freeze.sha256; do git show HEAD:$f | cmp - $f; done
```
8b. Run and delivery (after the commit):
```
deno run -A --no-lock tools/predict.ts run --stage confirm --protocol experiments/prediction-envelope/protocol.confirm.json --freeze experiments/prediction-envelope/protocol.confirm.freeze.sha256 --amendment docs/prediction-confirm-2026-11-02/AMENDMENT.md --out experiments/prediction-envelope/confirm-2026-11-02
jq -e '.status=="CONFIRM"' experiments/prediction-envelope/confirm-2026-11-02/meta.json
deno run -A --no-lock tools/predict.ts validate experiments/prediction-envelope/confirm-2026-11-02/predictions.jsonl
deno run -A --no-lock tools/predict.ts confirm-analysis --out experiments/prediction-envelope/confirm-2026-11-02
(cd experiments/prediction-envelope/confirm-2026-11-02 && shasum -a 256 -c canonical.sha256 && shasum -a 256 -c confirm.sha256)
pnpm vitest run --maxWorkers=2 tools/test/prediction-*.test.ts     # now including `delivered confirm outputs`
pnpm vitest run --maxWorkers=2                                     # full suite once at the end; a load-only timeout must pass alone, limits not loosened
git diff origin/main --quiet -- packages/ experiments/prediction-envelope/protocol.json experiments/prediction-envelope/protocol.freeze.sha256 tools/lib/prediction/score.ts tools/lib/prediction/proposers.ts
```
Reproducibility: rerun into /tmp (never over the committed dir) and `diff` digests. Golden pins and RULE_VERSION untouched; no change to `generate`/`runFamily` means no dynamics change.

## 9. Review

Codex Sol 6.1 xhigh read-only on the amendment + code diff BEFORE the confirm run (amendment gaps are the main risk), and again on RESULT.md + notebook. Findings in REVIEW.md. Plan review: `review-sol-plan.txt`.

## 10. Non-goals and limits

No model or video proposer, no new mechanisms, menus, thresholds, readouts or retuning; no GPU; no claim about naturalist usefulness; no merging of confirm
and v0 numbers into one table; no deploy, push or PR in this stage. One protocol, one run of record; an uninformative result is reported as such. Limits: 20 fixture families of 32x32 CPU worlds, one rising recipe, saturated worlds push labels toward
"none", intervals are descriptive at this n, the shuffled-control contrast has donor-coupled dependence, label agreement with expectations is reported, never forced.
