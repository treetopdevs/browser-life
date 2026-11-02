# I02 plan: a naturalist that predicts interventions (slice S2, decisions D1, D3, D7)

Stage PLAN (revision 2, after the Sol xhigh plan review; see REVIEW.md), 2026-11-01. Branch `claude/i02-prediction-envelope`
from origin/main 8d577be4. Observer and tooling only: no dynamics change, no `RULE_VERSION` bump, no golden pin moved, no
new `defaultConfig()` key, no model call, no paid compute, no GPU, no deploy, no edit inside the frozen preregistration
GENERATED sections.

## Bounded question

Given a fixed evidence envelope for a small known-history world (registered frame samples, census series, config, an
allowed intervention menu), can a proposer emit a structured, validator-clean probability forecast of one fixed paired
intervention's effect that beats the strongest simple baseline on **held-out whole histories**, in multiclass Brier score
and directional accuracy, with stable calibration?

This slice builds the harness and answers only: does the harness separate an evidence-using rule from baselines, and does a
naive metric get fooled where the scoring does not. It runs no model. Any "better than baseline" statement about a model
is out of scope; the model seam is typed and unrun. No advance/stop decision is evaluable here (restated in EVIDENCE.md).

## Scope cut (review finding 13)

One primary endpoint: a **world-level** readout, **one task per case** (see Task). Deferred: region subjects, births,
multi-readout, cross-seed campaigns beyond fixture qualification, richer calibration analysis, lab Field notes wiring,
bell-ring cases from real bundles, GPU forks via `tools/bench.ts`, the numeric-only vs video-only vs combined arm
comparison (frames are in the envelope; only a test proves the field is reachable).

## What exists and is reused (inspected; corrections from review applied)

- `tools/lib/propose.ts` (`Action`, `Direction` (up/down only), `Prediction` (different semantics, kept), `buildForkSpec`,
  `validateProposalSpec` whose rule is that intervention steps are **strictly after** the fork step C), `tools/lib/bench.ts`
  (paired scoring and sign test conventions), `tools/lib/naturalist-envelope.ts` (the bell baseline header: a different
  "envelope", keep names distinct), `apps/lab/src/naturalist-suggest.ts` (untouched).
- `@bl/runner` `ScheduledIntervention` + `validateInterventions` (lesion; feed with negative amount = drain; sun; zero feed
  is rejected; empty array invalid). `RefSim` does **not** implement `InterventionSim`; `applyLesion(ref, ...)` returns
  void; `applyFeed(state, ...)` (in `@bl/schema`) acts on `WorldState`. The runner has a *private* CPU adapter
  (`runner.ts` ~929-941, feed accounting ~1285-1293) that this slice mirrors in a tool-local adapter.
- `@bl/metrics` census returns components/lineages/living-cell counts, not named scalar readouts; births need tracker
  history. Readouts therefore are defined here from state/census (see Readouts), not assumed.
- "Wound" = lesion; drain = feed with negative `amount`; `injuryShell` configs out of scope.

### Integration point with existing tooling (finding 13)

Concrete: (a) small behaviour-preserving exports from `tools/lib/propose.ts` (canonical JSON + SHA-256 helpers, jar-disc
centre rule) with a test that existing proposal hashes are unchanged; (b) `fromRulesProposal(pred)` adapter mapping the v0
rule proposer's `Prediction` (up/down) into the new schema (probability mass on the stated direction, remainder on
`none`, explicit and versioned), so the v0 rule proposer is a fifth scored baseline on the same envelopes;
(c) result files follow the discovery split of canonical scientific result vs execution metadata
(`packages/schema/src/discovery.ts` ~364-400) and its provenance fields; the discovery runner itself is **not** used (it
supports only specific observers/assays). v0 identities and existing outputs are not modified.

## What is built

### 1. Task and evidence envelope
`PredictionEnvelope` v1 (canonical JSON, SHA-256 id): `caseId`, `historyId`, `familyId` (= source-history family; all
windows and seed variants of one history share it), world `config` (+ `ruleVersion`), `census` series with steps `<= C`
only, `frames`: K registered samples at fixed steps `<= C` as small integer arrays (fixed downsample of cell matter/biomass
bytes; copied, never aliasing sim buffers), the `menu` (allowed operations with bounds), and the **task**: exactly one
frozen tuple `{subject: world, intervention, readout, forkStep C, horizon H}` per case. The envelope holds no post-C data
and no outcome; builder asserts `maxStep <= C`.

Intervention timing: applied at step `C + delta`, `delta >= 1` from the menu (matches `propose.ts` strictly-after rule);
the horizon is measured from C and `H >= delta + settle`.

### 2. Prediction schema (version 1, finding 1 and 2)
One prediction per case, exactly: `caseId`, `envelopeHash`, `task` (must restate the envelope task verbatim; the validator
rejects any other intervention/readout/subject/time, so a proposer cannot pick an easier question), `probs`
`{up, down, none}` in integer per-mille, each 0..1000, **summing to exactly 1000**, `abstain` boolean (abstain requires
`probs` absent), free-text `reason` (stored, escaped, never scored). The displayed direction is `argmax` with the fixed
tie order none > down > up (derived, never submitted). No confidence floor.

### 3. Host validator
`validatePrediction(p, envelope)` -> `{ok, errors[]}`. Rejects: unknown keys, `__proto__`/`constructor`/`prototype` keys,
non-object lines, probs not integers / not summing to 1000 / out of range, abstain with probs, missing probs without
abstain, task != envelope task, wrong `caseId` or hash, duplicate or missing caseIds across a file (file-level check:
exactly one line per case; extras and missing are counted). Task operations convert to a `ScheduledIntervention` passing
`validateInterventions`, **except** the sham (below). Invalid proposals are counted and scored as non-answers, never
repaired.

**Sham = no scheduled operation** (finding 3): `{kind:"none"}` is an explicit validator branch that maps to *omitting* the
schedule, as the existing replay control does. A radius-0 lesion is not a sham (it destroys the centre cell) and a zero
feed is invalid; neither appears in the menu. Sham twin replay must equal the control replay hash at every checked step.

### 4. Proposers (`Proposer {id, propose(env): Prediction}`; take only envelopes)
- `fixedRule`: lesion -> down, feed -> up, drain -> down, sham -> none, with a frozen distribution (e.g. 600/200/200 form).
- `numericTrend`: census-only slope extrapolation of the readout mapped to probs by a frozen rule; ignores frames.
- `shuffledEvidence`: `numericTrend` run on a donor envelope's census. Donors are assigned by a **derangement of family
  ids within each split** (never the same family, never across splits), preserving observation-window shape; assignment
  is frozen into protocol before exclusions or scoring (finding 6).
- Constant/prior baselines (finding 8): `priorMajority` (dev-split class frequencies, applied everywhere), `alwaysNone`
  (prob 1000 none, still a valid forecast), `abstainAll` (coverage floor).
- `mechanismRule` (positive control, **dev diagnostic only**): reads the config (nutrient rate, lesion centre occupancy
  from frame mass) and encodes the known mechanism; labelled as a fixture-aware oracle, never a baseline to beat.
- `v0Rules` via `fromRulesProposal`.
- Model seam: `ModelProposerAdapter { id; propose(env, ctx): Promise<unknown> }` + `adaptModelOutput` routing raw output
  through the validator. No implementation, no network import; a test asserts the module imports nothing outside the repo
  and that no adapter is registered by default.

### 5. Readouts (finding 5)
Versioned `readouts.v1` in protocol.json, evaluated directly from `WorldState` at C+H (no tracker, no census history
dependency): primary world-level readout `livingCells` = count of cells with biomass above the census living threshold
(the same constant the census uses, referenced not copied); secondary reported only as diagnostics: `freeNutrient` (total
nutrient in the field). Each has its own unit and `minEffect` (in its own units, set from **development** seeds before
freeze); effects are never pooled across units. Definitions are cross-checked against `census()` outputs in a test.

### 6. Fixtures with outcomes (finding 4, 12)
Small CPU worlds via `RefSim` (32x32, kernelRadius 4, 3 preset-shaped configs). Tool-local `CpuInterventionAdapter`
wraps clones of `WorldState`/`RefSim`: exact order = advance to `C + delta`, apply operation, advance to `C + H`; logs each
application (requested vs delivered matter, refusals). Every arm gets its own deep clone (test: buffer independence).
Invariants checked separately: energy via `ledgerResidual == 0`; matter via delivered-feed and lesion-destroyed
bookkeeping (the existing ledger checks energy only), with fork-time light/heat counters carried not re-baselined.

Per case: treated twin, control twin (same seed, intervention omitted), and for neutrality an **instrumented vs plain**
pair: identical schedules run with envelope/frame/census construction enabled and disabled; full-state hash equality
checked at every sampled step to C+H (observer neutrality, per the source's instrumented/plain requirement). Outcome =
sign of (treated - control) of the readout at C+H against `minEffect`: up / down / none.

Mechanism fixtures (outcome labels are *measured*, not assumed; any label that disagrees with its mechanism expectation
is reported, not silently relabelled): feed (expect up), lesion on occupied region (expect down), drain (expect down),
sham (none by construction), lesion on empty region (expect none; may differ due to fragmentation or edge effects, so the
dev qualification run decides), and a low-dose feed (expect none by threshold). The earlier "saturated feed is none" idea
is **dropped**: feed has no saturation clamp (`feed.ts` ~77-89).

### 7. Splits and the freeze order (finding 7)
Whole source families by `familyId` hashed with a frozen salt into `dev` / `test` (total histories 12, raised to 24 only if
a dev timing measurement says so, decided before freeze). A separate reserved `qualify` subset of **dev** histories is used
for all fixture qualification, `minEffect` choice, seed-flip stability, runtime measurement and proposer rule tuning.
Freeze (protocol.json hashed into the manifest, written and committed before any test-split outcome is generated):
family list and split membership, salt, seed reservations, `minEffect`, readout definitions, proposer rules/probs, donor
assignments, denominators. Test outcomes are generated once by `predict run --stage confirm`, which refuses to run unless
the protocol hash matches the frozen file. No test case is dropped for unstable outcome: unstable test cases stay in the
unfiltered denominator, flagged `measurementLimited` (the prespecified category), and reported both with and without. Any
post-inspection amendment needs fresh confirmation families and a dated amendment. Proposer code only receives envelopes;
only the scorer reads outcomes. `assertNoLeak` checks disjoint family sets, that no test envelope contains dev data, and
that shuffled donors obey the derangement rule.

### 8. Scoring (`scoreRun`)
- **Multiclass Brier** over `{up, down, none}`: `BS = (1/N) * sum_i sum_c (p_ic/1000 - o_ic)^2`, range 0..2. Abstentions
  and invalid/missing predictions are imputed with the frozen **dev-split prior** distribution for the headline number
  (so abstaining cannot beat the prior), with answered-only Brier also reported.
- Directional accuracy on answered cases (argmax vs outcome), balanced accuracy over outcome classes, **accuracy at matched
  coverage** (each comparator restricted to the cases the least-covering one answered, when that is non-empty),
  coverage, abstention rate, invalid and missing counts, mean absolute effect (own units, reported per unit).
- A **calibrated majority baseline is legitimately strong**: the table does not claim Brier punishes it; "strongest simple
  baseline" is whichever of {priorMajority, alwaysNone, fixedRule, numericTrend, v0Rules} scores best on dev.
- Reliability table over the stated probability of the argmax class, 5 bins with per-bin n shown.
- `validNonNullYield` = valid forecasts on cases whose outcome is not `none` / total cases (renamed from "cost per useful
  experiment"; it is a yield, not a cost). `costPerUseful` = total evaluation cost in simulated cell-steps (all arms,
  nulls and failed attempts included) / count of cases whose outcome is non-null; null when the denominator is 0.
- **Cross-seed effect stability** (renamed from "counterfactual agreement"; no "ceiling"): two complete pairs
  `(treated_s, control_s)` and `(treated_s', control_s')` per qualification case; sign agreement reported. It measures
  heterogeneity across seeds of the same family, not a predictor's accuracy limit. Seed variants share a family/split.
- **Uncertainty unit** (finding 11): the family. Per-family aggregates, whole-family bootstrap with a stated resample
  count/seed, paired differences between proposers on the same families. Intervals are computed only when the test split
  has >= 10 families; otherwise only counts and per-family tables are shown ("descriptive"). Bin and class denominators
  stated; missing-class handling stated.

### 9. Outputs (finding 14)
Under `experiments/prediction-envelope/v0/`:
- canonical, byte-reproducible: `envelopes.jsonl`, `protocol.snapshot.json`, `recipes.jsonl` (config, seed, steps, family:
  full replay inputs), `predictions.jsonl`, `outcomes.jsonl` (with envelope hash and protocol hash), `comparison.json`,
  `comparison.md`, `report.html`, `canonical.sha256` listing hashes of exactly these files.
- non-canonical: `meta.json` (git SHA, a source-closure hash over the tool files and packages used, rule/schema/metrics
  versions, config hashes, commands, hardware, timing, no-model/no-GPU statement). Excluded from the reproducibility diff.
Budget < 1.5 MB; if exceeded, commit `canonical.sha256` + recipes only and say which files were regenerated locally.

### 10. Notebook surface
`report.html` (static, uses `tools/lib/report-html`, no scripts, no external URLs, works from `file://`): per case an
observation block (census sparkline, frame thumbnails), a hypothesis block (probs per proposer), a measured-outcome block
(paired result), visibly distinct; failed predictions first; filter for invalid. Reason text escaped. No lab change.

## Files

Add: `tools/lib/prediction/{envelope,validate,proposers,score,splits,fixtures,adapter,readouts,report-html}.ts`;
`tools/predict.ts` (`build`, `validate <file>`, `run --stage dev|confirm`, `report`; Deno, Node-safe lib);
`tools/tsconfig.prediction.json` (typecheck for the new tool code); `experiments/prediction-envelope/protocol.json`;
`experiments/prediction-envelope/v0/*`; tests `tools/test/prediction-{validate,proposers,score,splits,fixtures,report,cli}.test.ts`;
`docs/prediction-envelope-2026-11-01/EVIDENCE.md` (run stage).
Change: `tools/lib/propose.ts` (additive exports only, no behaviour change, hash-identity test);
`docs/naturalist-proposer-v0-2026-10-18.md` (one dated linking line); `package.json` script only if needed.
Not touched: `packages/*/src`, `apps/lab/src`, `experiments/endpoints.ts`, `preregistration.md`, `experiments/FROZEN`,
golden hashes, aliases.

## Tests (named cases; expectations derived by hand, not tuned)

validate: accepts menu lesion/feed/drain/sham; rejects probs summing to 999/1001, float, negative, >1000, abstain+probs,
missing probs without abstain, task mismatch (different readout/intervention/time), extra key, wrong caseId/hash,
`__proto__`, non-object line; file-level duplicate/missing/extra caseIds counted; every non-sham accepted op converts to a
`ScheduledIntervention` passing `validateInterventions`; sham maps to no schedule; radius-0 lesion and zero feed are not
accepted menu entries; invalid never repaired.
envelope: no post-fork data (census and frame steps <= C); hash stable under key order, changes with one census value;
frames are copies (mutating sim buffers after build leaves the envelope unchanged).
proposers: each baseline emits validator-clean output on all fixtures; `fixedRule` ignores census; `numericTrend` ignores
frames; `shuffledEvidence` deterministic, donor family != own family, donor same split, **a later window of the same
history offered as donor is rejected**; `alwaysNone` and `priorMajority` valid; `fromRulesProposal` round trip; adapter seam
rejects out-of-menu raw output; nothing registered by default; module imports nothing external.
splits: whole families never straddle dev/test; all windows and seed variants of a family share a split; deterministic under
input permutation; leak check fails on injected shared family and on a bad donor; confirm stage refuses on protocol hash
mismatch.
score: multiclass Brier hand-computed on a 6-case table; uniform = 2/3, perfect = 0, confidently wrong = 2; majority-class
forecast on an imbalanced set scores as computed (not asserted to be bad); abstain/invalid imputed with dev prior and cannot
beat the prior; matched-coverage comparison; always-`none` exposed on a none-heavy table by balanced accuracy; reliability
bins sum to answered; zero-denominator `costPerUseful` is null; bootstrap resamples families and is skipped below 10.
fixtures (CPU): treated/control equal before the intervention; control omits the schedule; sham equals control; buffers
independent across arms; energy residual 0 and matter bookkeeping closes in all arms; instrumented == plain through C+H;
generation deterministic (rerun hashes equal); trend-confound truth table (hand-specified: rising world, sham and
low-dose feed have paired outcome none) vs a naive before/after scorer applied to a naive `alwaysRising` predictor: the
unit test asserts the **hand-derived** table values, and the pair is reported as a dev diagnostic, not a gate; qualification
report lists measured vs expected labels and seed stability; per-test timeouts explicit.
cli: spawned `deno run --no-lock` smoke test of `validate` and a tiny `run` (2 cases).
report: contains every case id, failed first, escapes reason, no external URLs, no script tags.

## Acceptance gates (runnable)

```
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install
pnpm typecheck
pnpm exec tsc --noEmit -p tools/tsconfig.prediction.json
deno check tools/predict.ts
pnpm vitest run tools/test/prediction-*.test.ts
pnpm test                                    # golden-hashes unchanged
git diff --stat origin/main -- packages tests/deno apps/lab/src experiments/endpoints.ts experiments/preregistration.md experiments/FROZEN   # empty
deno run -A --no-lock tools/predict.ts run --stage dev --out experiments/prediction-envelope/v0
deno run -A --no-lock tools/predict.ts run --stage confirm --out experiments/prediction-envelope/v0   # only after protocol commit
deno run -A --no-lock tools/predict.ts run --stage confirm --out /tmp/pe2 && (cd experiments/prediction-envelope/v0 && sha256sum -c canonical.sha256) && diff -r --exclude=meta.json experiments/prediction-envelope/v0 /tmp/pe2
deno run -A --no-lock tools/predict.ts validate experiments/prediction-envelope/v0/predictions.jsonl
```
Runtime: fixture step/case/byte caps and per-test timeouts are measured on the `qualify` subset on identified hardware and
frozen in protocol.json; wall time is never part of a reproducibility assertion. Plus a Sol review (xhigh) of the diff
before any commit.

## Non-goals and limits

- No model, video-only or combined proposer runs; typed seam only. Frames used by no baseline except the `mechanismRule`
  dev oracle and a reachability test.
- Fixtures are small CPU worlds with known mechanisms; nothing is claimed about unfamiliar cases or production presets
  (no neutral-bell recalibration claimed). CPU only; no checkpoint/physics change, so segment/stitch tests do not apply.
- 12 (or 24) families is a harness check, not a power claim; below 10 test families only descriptive output.
- Thresholds, salt, probs and donors are frozen in protocol.json before the first confirm run; changes are dated
  amendments with fresh confirmation families.

## Risks

Small-world outcomes may be mostly `none` or seed-unstable; the qualification step on dev decides which fixture *types*
are kept, and that decision is fixed before freeze (never per test case). If `fixedRule`/prior baselines tie everything,
that is reported as the result.

## Amendment 1 (2026-11-01, fix stage; revision 3)

Dated, made after the Sol xhigh source review and before any committed freeze. Details and evidence: `EVIDENCE.md`.
- **Primary readout is `bodyMass` (B+P), not `livingCells`** (section 5): the dev probe showed a feed leaves the living-cell count
  unchanged in 8 of 12 families, so an "up" class was unreachable. `livingCells` and `freeNutrient` remain diagnostics.
- **Qualify-only tuning** (section 7): the dev stage still generates all 12 dev families, but threshold tallies and cross-seed
  stability use only the `qualify` subset; the dev class prior (`devPrior`) is computed separately over all dev cases at the frozen
  threshold. Rule for `minEffect`: largest count of cases matching fixture expectations on qualify, ties to the larger threshold
  (gives 25). The first pass tuned on all dev families and picked 50; this is disclosed in EVIDENCE.md.
- **Labels are inclusive at the boundary**: effect >= +minEffect is up, <= -minEffect is down.
- **Confirm requires a committed freeze**: `protocol.json` and `protocol.freeze.sha256` must be in HEAD and byte-equal to the
  working files; `--exploratory yes` bypasses only that and stamps outputs EXPLORATORY. The delivered run is exploratory; a real
  confirmation needs fresh families.
- **Observer neutrality** now covers each arm's continuation through C+H (an instrumented chunked twin per arm, same schedule,
  final full-state hash equal to the plain arm), not only the history to C.
- **Dev-only oracle**: `mechanismRule` is run on, serialised for and shown on dev cases only.
- **Budget before simulation**: protocol bounds and planned cell-steps (`plannedCellSteps`, equal to the simulated count) are
  checked before any family runs, variants included.
- **`report --out DIR`** is implemented: it re-renders `comparison.md`, `report.html` and `canonical.sha256` from the data files.
- **Gate fix**: the reproduction diff is `diff -r --exclude=meta.json --exclude=dev --exclude=.gitignore`, run locally where the
  gitignored `envelopes.jsonl` and `predictions.jsonl` exist; the `canonical.sha256` check covers them.

## Amendment 2 (2026-11-01, rising-world cohort; revision 4)

Dated, made after the first delivered v0 run, whose fixtures could not discriminate the baselines (every world declined in body
mass, so `numericTrend` and `shuffledEvidence` both said "down" on all 144 cases and the trend-confound negative case never
appeared). The existing dev and test families had been looked at, so this regenerated v0 stays **EXPLORATORY**. Details: `EVIDENCE.md`.
- **A second fixture cohort, `rising` (families f24..f31)**: spots light, nutrient 50 (rich), founders 1, 2, 3, 4, 5, 2, 3, 4,
  seeds 5024..5031. These worlds grow without any intervention. The founder counts and nutrient were fixed by a probe that only
  checked that such worlds rise (no mechanism outcome, label, threshold or score was looked at before the cohort was written).
- **Split rule unchanged for the original 24 families**: each cohort is split by its own hash ranking (`protocol.cohorts`,
  `FamilySpec.cohort`), whole-family, 4 dev and 4 test from `rising`; none join the `qualify` subset. Dev now has 16 families
  and test 16. The donor derangement is taken over the combined split lists, so a rising family can donate its census to a
  declining one (this is what lets `shuffledEvidence` differ from `numericTrend`).
- **`minEffect` not re-tuned**: the rule of Amendment 1 re-applied to the unchanged `qualify` tallies again gives 25 (21 of 24
  matching; 19, 19, 18 at 50, 100, 200). `devPrior` is recomputed over all 16 dev families (it is a dev class frequency, not a tuned threshold).
- **Protocol re-frozen** (`protocol.json`, `protocol.freeze.sha256` new hash); a held-out confirmation still needs fresh families.
- **Diagnostic added**: `trendConfound.numericTrendOnNull` counts, on sham and low-dose cases, those where the before/after
  rule says up, `numericTrend` predicts up and the paired outcome is none.
