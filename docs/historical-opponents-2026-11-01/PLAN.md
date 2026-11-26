# I03 Historical-opponent ecology, first rung: assay sensitivity. Slice plan (v1)

Status: PLAN stage, 2026-11-01. Branch `claude/i03-historical-opponents` from `origin/main` 67fdd025. Source: "I03" and "Agent execution contract" in `docs/simulation-research-2026-11-01/report.md`; coordinator decisions D1, D7, D10, D12 (the log in this checkout ends at D10, so D12 text is unverified here; D10 says I03 follows I02 fixtures, and this slice uses only committed founders and the generalist, so it has no I02 dependency; D7 requires rebase and focused revalidation before publication, see section 6). Follows the I14 slice layout (`docs/predictability-atlas-2026-11-01/`, merged as D9). Observer and tooling only. No physics change, no model calls, no GPU, no deploy. CPU only (sim-ref), and every artifact says so.

## 1. Bounded question

Can a genome-only, standard-inoculum, mutation-off pairwise contest on small `sim-ref` arenas tell apart a few known-distinct strategies, and does it correctly stay quiet where it should? Concretely: (a) a deliberately weakened variant must be detected as losing to its parent (positive control); (b) the same genome under two lineage labels must show exact label invariance and no significant position bias (null control); (c) runs where both sides sit at the extinction floor must be reported uninformative, not as ties; (d) solo growth at the same positions is reported beside each payoff, as a descriptive monoculture residual (not a causal separation of vigour from matchup effects); (e) an intransitive cycle must be detectable when one is constructed, and reported as "none detected" otherwise.

This is the sensitivity check the report requires before any tournament. It answers nothing about evolution over time, open-endedness, predation or organism reproduction, and it is not the M3 environment (small `sim-ref` worlds, one fixed chemistry). If (a) or (b) fails or (c) dominates, the honest result is "assay uninformative or biased"; that is a valid, shippable outcome and the PR says so.

## 2. What is built (one PR)

1. **Evidence fixture with negative cases that fool the naive metric.** The naive metric is "who has more biomass at the end of one run" (win rate over single runs, 0/0 read as a tie). Negative cases, each built so the naive reading is wrong and the sealed rule is right:
   - `twin-labels`: genome G under labels G and G'. Naive: every single run has a "winner" by share, so a naive win-rate view of individual runs looks decisive; the sealed rule (exact label invariance, then signed position effect across seed blocks with a sign-flip test) must show no significant bias. The evidence also reports the naive run-level "decisive winner" rate (share beyond 0.5 +- 0.10) for the twins so the gap is visible.
   - `depletion-arena`: an in-world configuration chosen in calibration (plain nutrient 0 is not assumed to deplete; see 3.5 G4) in which both sides reach the extinction floor. Naive: share 0/0 -> 0.5 -> "balanced, assay clean". Sealed rule: class `both-floor`, pair status `uninformative`, excluded from payoffs, counted; if calibration finds no such arena, a pure classifier fixture stands in and the evidence says so.
   - `vigour-only` (pure-function fixture, arithmetic only): solo growth 3:1, payoff exactly the vigour share. Naive: "A dominates B". Sealed rule: residual 0. It does not validate the in-world residual.
   - `rps-synthetic` (pure-function fixture): a constructed 3x3 payoff matrix with a known A>B>C>A cycle, plus a transitive matrix. Detector must find exactly the one cycle and none in the transitive one. Labelled synthetic in evidence and on the page; the real panel reports whatever it finds (expected: none, stated as "none detected at this resolution", never "none exists").
2. **Small CPU path.** Pure TypeScript, integer-only for anything touching sim state; floats only in the final summary statistics (payoff means, intervals). Library `packages/metrics/src/opponents/`, CLI `tools/opponents/assay.ts` (Node 24, relative imports, like `tools/predictability/atlas.ts`) running contests across `worker_threads`. Reuses `buildWorld`/`Founder` (schema), `RefSim` (sim-ref), `generalistGenome`, `M3_FOUNDERS`/`founderGenome`, `genomeDistance` (schema), `mean`/`sd` (metrics stats). No new package, so no alias-map edits.
3. **Manifest and machine-readable evidence** `evidence.json` (sealed, canonical JSON, no timestamps or platform strings) and `manifest.json` (source hashes, config, seeds, budget), with `--write`, `--check` (no simulation) and `--replay-check` (regenerate, require byte equality), same contract as the predictability CLI.
4. **Local prototype page** `apps/lab/opponents/index.html` plus `apps/lab/src/opponents/{page.ts,render.ts,style.css}`: payoff matrix with interval text, a "contest time" selector (matrix at steps 100/200/300/400, so you can see a matchup resolve or not; the history axis of the report's time-versus-opponent view needs an archive and is deferred), ratio and position toggles, a vigour-vs-matchup toggle, extinction counts, the controls. Kept off the deployed site exactly like `/predictability/`.

## 3. Design

### 3.0 Reuse decision (review finding 1)

`packages/runner/src/discovery.ts` already freezes genome-only founder fixtures (`FixtureSpec`, `buildInitialState` over `buildWorld`), runs CPU cases with a deadline and replay validation, and the report points at it. Decision: **adopt its fixture vocabulary, not its campaign runner.** Contest worlds are described as founder specs with `genomeHex` (same JSON shape as `FixtureSpec` `initial.kind: "founders"`) so a later rung can port them into a discovery campaign unchanged. The runner itself is not reused because (i) its observer ledger is capability/census oriented and has no per-lineage payoff observer, and adding one is a shared `packages/runner` and schema change with its own versioning, which this observer-only slice must avoid; (ii) it writes a checkpoint artifact per case, which is heavy for ~800 short throwaway contests. Work order step 0 is a one-hour spike that reads `discovery.ts` and records in `EVIDENCE.md` the concrete incompatibilities found (or, if the spike shows a cheap observer hook, switches to it and the plan is amended). `tools/assay.ts` / `tools/foundations.ts` time-shift machinery and `tools/lib/pond-assay.ts` (64x64 ponds hardcoded; budget-accounting precedent only) are read for design and not reused; `packages/lineage` mutation replay is deferred (mutation off, fixed founders).

### 3.1 Arena and standard inoculum (frozen before any evidence run)

- Config: `defaultConfig({seed, tileW, tileH, mutRate: 0})`, single tile (size from calibration grid), everything else default. No new `WorldConfig` keys; `defaultConfig()` untouched.
- Slots: four slots at fixed lattice centres (a quarter and three quarters of the tile in each axis), jittered per axis by up to +-2 cells. Jitter value = `lowbias32((seed ^ imul(slot + 1, 0x9E3779B1) ^ imul(axis + 1, 0x85EBCA6B) ^ SALT_JITTER) >>> 0)` mod 5 minus 2 (`lowbias32` takes ONE argument; a two-argument call is a TS error and JS ignores the second). A test pins distinct values per slot and axis and reproducibility. Calibration asserts toroidal non-overlap of discs including worst-case jitter (centre separation minus 4 > 2R).
- Founder array is always the full four slots in slot order, so `buildWorld`'s per-founder and per-cell noise is identical across all arenas that share a seed. A slot a given arena does not use is emptied after `buildWorld` by zeroing that slot's disc cells (B, E, genome channels; nutrient left as built). `biomass 256 / energy 512 / nutrient 256` are planting parameters: `buildWorld` draws per-cell biomass in `0..2*biomass` and derives energy from the draw, so actual step-zero inventories are measured, recorded per label in the evidence, and used as the initial share. Test: step-zero inventory of a slot is equal across every contest and solo arena at a seed.
- Arenas, with slot sets fixed (A on set X, B on the rest):
  - **balanced**: A on {0,1}, B on {2,3} (position P1) and A on {2,3}, B on {0,1} (P2).
  - **rare-A**: A on {0} vs B on {1,2,3} (position R1) and A on {2} vs B on {0,1,3} (R2).
  - **rare-B**: the same with roles exchanged. Rare-A and rare-B are separate arms; they are never averaged into a payoff, and neutral expectation is the measured initial share, not 0.5.
  - **solo**: each mask used above, occupied by a single genotype and the other slots emptied (masks {0,1}, {2,3}, {0}, {2}, {1,2,3}, {0,1,3}), so vigour is measured at the actual disc count and positions.
- Lineage labels: `buildWorld` gives slot `i` lineage raw id `i+1`; a label map takes lineage id -> genotype label (twins G and G' share a genome and differ in label only). With `mutRate 0` no other lineage ids may appear; asserted at every checkpoint (every living cell's lineage is a founder id; labelled biomass sums to total biomass).
- Observation is read-only on `RefSim.state` at the checkpoints; a test steps the same world with and without readouts and requires equal `stateHash`.
- The seed block (`cfg.seed` plus its jitter) is the independent unit. All matchups reuse the same seed blocks (paired design); that is legitimate pairing and is never counted as extra replication.

### 3.2 Readouts per run (integer)

`bA`, `bB` = sum of CH.B per label; `cellsA`, `cellsB`; all stored as integers. Shares are computed from the integer counts in floating point at aggregation time; `shareA_ppm = floor(1e6*bA/(bA+bB))` is a display value only and never feeds a gate (review finding 2: flooring turned an exact 0.5 reciprocal mean into 0.4999995). Floor: a label is at the floor when its biomass is below `FLOOR_FRAC = 1/16` of its own measured step-zero biomass; `FLOOR_FRAC` is frozen now and not a calibration parameter. Run class: `contested` (both above floor), `decisive` (exactly one at floor; informative, a win), `both-floor` (uninformative; share is undefined, never 0.5).

### 3.3 Panel (genetically separated founders)

Five genotypes, sealed by hex in the manifest:
- `G` hand-built generalist (`generalistGenome(defaultMu, defaultSigma)`).
- `F1..F3` three M3 founders chosen by a deterministic farthest-point rule on `genomeDistance` starting from G (`M3_FOUNDER_SET` id recorded). `genomeDistance` counts differing slots; it shows the genotypes are separated, not that they follow different competitive strategies in these arenas (M3 qualification concerns survival, repair and light dependence in another assay). The plan therefore says "genetically separated founders" everywhere; functional spread is reported descriptively from solo vigour and the payoff matrix, and no verdict claims strategy discrimination beyond the controls actually validated.
- `W` weakened G: photosynthesis output weight (`w2(1, OUT.PHOTO)`) reduced by an amount from the calibration grid. Reducing it also lowers catalytic work cost, so a loss is not guaranteed by the edit; calibration must show W loses with W's solo vigour above the floor (so a loss is not just death).
- `G'` same genome as G under a second label: the genotype-neutral control, not a panel member.
Contests: 10 panel pairs; controls `G` vs `G'` (same arms) and the depletion control (3.5, G4). `F1` vs `F1'` is optional (first cut).

### 3.4 Aggregation and inference (post-processing, floats allowed)

- Eligibility: a pair's seed block is **complete** only if both reciprocal positions are non-`both-floor` at the primary checkpoint. Incomplete blocks are dropped whole (never keep a surviving single position), counted and shown. Pair status `uninformative` if complete blocks < 80% of seeds (8 of 10; 5 of 6 for rare arms). Report a naive payoff (both-floor counted 0.5, incomplete blocks kept) beside it so the effect of exclusion is visible. Fixtures cover asymmetric exclusion.
- Seeds: S = 10 evidence seeds (101..110) for the balanced arm; rare arms use the first 6 (101..106) and are **exploratory**. Calibration seeds are 1..3 only and never reused.
- **Primary analysis (confirmatory, the only inferential claims):** the final checkpoint T, balanced arm, payoff per complete block = mean over P1 and P2 of A's share computed from integer counts. Gates G1/G2 and cycle edges use these. Inference is an exact sign-flip test on block payoff minus 0.5 (min two-sided p = 2/2^n, so 0.002 at n = 10; with n = 6 it would be 0.031 and could never survive a family of 10 pairs, which is why S = 10). A directed edge A->B requires: all complete blocks on the same side of 0.5 (p <= 2/2^n, which must be <= 0.05/10 for the 10-pair family, so n >= 9 or the edge is not allowed) AND mean offset >= 0.05. The t interval (df = retained blocks - 1, frozen t table) is shown as a descriptive uncertainty band only, with the caveat that payoffs are bounded and may be bimodal; it never decides anything.
- **Secondary/exploratory (labelled as such in evidence and page):** other checkpoints (100/200/300 for the contest-time view), rare arms, invasion, vigour residual, breadth. No multiplicity correction is claimed for them and none of them feeds the verdict.
- **Position effect** is gated separately from reciprocal averaging (review finding 2): per block, the signed slot-set advantage (share of the label on slot set {0,1} in P1 minus its initial share) and its absolute size are reported before averaging; for the twin control this is the whole bias measurement.
- **Invasion from rare:** from rare-A and rare-B arms separately, rare label's final share minus its measured initial share per block (paired), with the sign-flip test over the 6 blocks; classes `invades`, `fails`, `unclear` (6 blocks cannot reach a family-wise bar, so `invades`/`fails` need all 6 blocks same sign and are labelled exploratory). Mutual invasibility is "both invade", no mechanism claimed.
- **Vigour (descriptive monoculture residual, not a causal separation):** solo biomass `V_x(mask)` at the identical mask and step; vigour-expected share `V_A/(V_A+V_B)`; residual = observed share minus expected share. The residual can still contain density response and spatial self-interaction (affinity depends on local B+P; metabolism on local resources), so it is described as "share not predicted by solo growth at the same positions", with that limitation stated, and no gate depends on it. The hand-built `vigour-only` fixture tests arithmetic only.
- **Cycles:** over the confirmatory edges only; all directed 3-cycles and a transitivity check. Mean payoff and breadth (opponents beaten) are reported separately, never combined.
- **Extinction counts:** per run class, per pair, per ratio, per checkpoint.

### 3.5 Controls and pre-stated verdict rules (written before any evidence run)

- `G1a label invariance (exact)`: swapping the label map on a twin world changes nothing physical; checked as an exact identity of integer counts (`bA` under map1 equals `bB` under the swapped map).
- `G1b twin position bias`: for `G` vs `G'` balanced, the signed slot-set advantage across blocks has an exact sign-flip p > 0.05 AND the mean absolute position effect is below the effect target stated in `calibration.json` (set from the calibration seeds, committed before evidence, and at most half the W-versus-G margin). Same for rare arms on excess share (exploratory, reported, not gating).
- `G2 positive control`: `W` vs `G` complete blocks all below 0.5 (sign-flip p = 0.002 at n = 10) and mean payoff <= 0.40 at the final checkpoint.
- `G3 floor`: at the primary checkpoint, the `both-floor` share of contests is <= 20% in EACH panel pair and each arm (not pooled), no panel pair `uninformative`.
- `G4 depletion`: an in-world depletion arena (configuration chosen in calibration from a bounded list; plain `nutrient 0` is not assumed to deplete because decomposition and abiotic recycling return C to A and biomass/energy persist; a diagnostic with `nutrient 0` retained most inoculum biomass at step 400) must show raw inventories of BOTH labels below the floor at T in every evidence seed, and its pair status must be `uninformative`. If calibration finds no cheap configuration that does so, G4 falls back to a pure classifier fixture on hand-built states and the evidence states "both-floor path not exercised in-world".
- `G5 pure-function fixtures`: `vigour-only` arithmetic, `rps-synthetic` finds exactly one cycle, transitive matrix finds none, straddling-0.5 matrix finds no edge, asymmetric-exclusion fixtures behave as 3.4.
- Verdict decision table (precedence in this order): any of G4, G5 failed or any run invalid/incomplete -> `control-invalid`; G1a or G1b failed -> `label-or-position-biased`; G2 failed -> `insensitive`; G3 failed -> `extinction-limited` (no tournament); otherwise `assay-sensitive`, defined as exactly: "detects the constructed weakening at this effect size and stays quiet for identical genomes at this resolution, on genetically separated founders in small CPU arenas". It does not assert discrimination between real strategies. A non-sensitive verdict is shipped as is. `--check` recomputes every summary and gate from the raw per-block records and compares with the stored values and verdict (not just recomputing the verdict from stored gate booleans). No score selects anything or tunes the assay after evidence seeds are run.

### 3.6 Time conventions

"Time" here is contest time (checkpoints inside one run). No archive and no historical axis exists yet. Archived-generation opponents, withheld-opponent generality and evolving-against-archive comparisons are later rungs.

### 3.7 Calibration stage (before evidence; committed as `calibration.json`)

Bounded, predeclared grid; all attempts are logged and committed, not just the winner: disc radius R in {2,3,4}; tile {32, 40}; T in {300, 400, 600} (checkpoints at T/4, T/2, 3T/4, T); W weakening in {-25%, -50%, -75%} of the photosynthesis output weight; depletion configurations from a short listed set. Enumerate settings in cost order (smallest tile, smallest R, shortest T first) and pick the first that meets the attainability criteria on seeds 1..3: W loses to G with mean payoff <= 0.40 and W's solo vigour above the floor; twin mean absolute position effect below half the W margin; both-floor share on panel pairs <= 20%; depletion arena reaches the floor if achievable. At most 36 attempted settings. Freeze choices in `arena.ts` constants and `manifest.json` in one commit before the first evidence run. `FLOOR_FRAC` and the 0.40 / 20% / 0.05 thresholds are not tuned. If no setting attains the criteria, stop and report "assay cannot be made informative on these arenas".

Job schedule (frozen in the manifest, counted in the evidence): balanced pairs 10 x 10 seeds x 2 positions = 200; rare arms 10 pairs x 6 seeds x 2 arms x 2 positions = 240; twin G/G' balanced and rare = 10x2 + 6x4 = 44; solo 5 genotypes x (2 balanced masks x 10 seeds + 4 rare masks x 6 seeds) = 220, plus W solo; depletion arena 10 seeds x 2; roughly 750-800 runs. Each run reads all checkpoints from one pass. A prototype measured ~30 ms/step at 64x64 serial, so a 32x32 arena is ~7 ms/step and a 400-step run ~3 s; ~800 runs is ~40 min serial and about 10 min on 4 workers, which exceeds the budget, so the budget is *not* assumed met. A separate four-worker 400-step micro-benchmark on this machine finished in 2.78 s, which is not a qualification of the frozen schedule. Calibration benchmarks the exact frozen schedule; if `--replay-check` projects over about 5 minutes, cut in this order (each cut removes jobs, unlike UI cuts): drop the optional F1 twin; reduce rare arms to one position (R1) and 4 seeds; shorten T; reduce balanced S only if edges stay allowed (n >= 9), otherwise drop edge/cycle claims on the real panel and keep the fixture. Arena size is last.

## 4. Files to add or change

Add:
- `packages/metrics/src/opponents/{arena.ts,panel.ts,payoff.ts,evidence.ts,index.ts}` (arena: config, inoculum, labelling, contest runner; panel: genotypes, farthest-point pick, weakening; payoff: aggregation, intervals, invasion, vigour, cycles, gates; evidence: payload build and seal). About 600 lines. Not re-exported from `packages/metrics/src/index.ts` (the I14 review found that the re-export drags sim-ref into the lab bundle).
- `docs/historical-opponents-2026-11-01/calibration.json` (every attempted setting and the selection).
- `tools/opponents/assay.ts` (CLI: `--write`, `--check`, `--replay-check`, `--jobs N`, `--calibrate` writing to a scratch dir only) and `tools/opponents/worker.ts` (each worker registers the `@bl/*` resolution hook as its first step, before dynamically importing the assay: a parent-registered hook does not reach workers and a plain Node 24 worker fails with ERR_MODULE_NOT_FOUND for `@bl/schema`; one contest per message, results ordered by job key so output is independent of worker count).
- `apps/lab/opponents/index.html`, `apps/lab/src/opponents/{page.ts,render.ts,style.css}` (no shared Vite chunk, no `manualChunks` entry; the page reads the committed `evidence.json` only and imports nothing from sim-ref).
- `docs/historical-opponents-2026-11-01/{evidence.json,manifest.json,EVIDENCE.md}` (PLAN.md and REVIEW.md live here already or are added by the review stage).
- Tests (section 5).

Change (small):
- `apps/lab/vite.config.ts`: input `opponents: r("./opponents/index.html")`.
- `Dockerfile.site`: add `apps/lab/dist/opponents apps/lab/dist/assets/opponents-*.js apps/lab/dist/assets/opponents-*.css` to the removal list.
- `deploy/Caddyfile`: `@private_opponents path_regexp private_opponents (?i)^/opponents(?:/|$)` with `respond @private_opponents 404`, beside `private_predictability`.
- `tsconfig`/vitest include only if the new test paths are not already globbed.

Not touched: `packages/sim-ref`, `sim-gpu`, `schema` (config, presets, genome), `RULE_VERSION`, `golden-hashes.test.ts`, `defaultConfig()`, `experiments/endpoints.ts`, `experiments/preregistration.md`, `experiments/FROZEN`, coordinator, I01/I05 files, `tools/assay.ts`, `tools/foundations.ts` (read for design only; their time-shift machinery implants cut patches with stored resources and developmental state, which the report names as a different experiment).

## 5. Tests (vitest, named cases)

`packages/metrics/test/opponents.test.ts`
- `inoculum is identical across contests`: every contest and solo run at fixed seed has the same disc count, biomass and energy totals; ratio 1:3 swaps conserve totals.
- `reciprocal positions swap slot sets`: swapping labels A/B reproduces the same world with labels exchanged (state hash equal after relabelling).
- `mutation off: no new lineage ids`: 400 steps, every living cell's lineage in the founder set at each checkpoint.
- `labels sum to total biomass`: labelled biomass equals total CH.B.
- `readouts do not change physics`: instrumented vs plain twin `stateHash` equal.
- `twin genomes under two labels are distinguishable by lineage only`: identical genome words, different lineage ids, map resolves.
- `share arithmetic is integer and exact`: ppm values for hand cases including 0/0 -> class `both-floor` (never 0.5).
- `run classes at the floor`: contested / decisive / both-floor from hand-built biomass triples at the threshold edges.
- `depletion arena is both-floor and the naive reading says tie`: the calibrated depletion arena (or, on fallback, a hand-built both-floor state); sealed class `both-floor`; naive share 0.5 asserted in the same test; raw inventories of both labels asserted below the floor.
- `payoff interval from known blocks`: hand-computed mean and t interval for fixed per-block values.
- `vigour-only fixture has zero residual`: 3:1 vigour, payoff = 0.75, residual 0.
- `cycle detector finds the constructed cycle only`: `rps-synthetic` yields exactly one cycle (as a set of three), the transitive matrix yields none, a matrix with an interval straddling 0.5 yields no edge.
- `invasion from rare labels`: hand blocks give `invades`, `fails`, `unclear`.
- `breadth is separate from mean payoff`: two genotypes with equal mean payoff and different breadth.
- `jitter is reproducible and differs per slot and axis` (one-argument `lowbias32`).
- `step-zero inventory of a slot is equal across contests and solo arenas`; `reciprocal arenas have equal resource fields`.
- `twin: label swap gives exact count identity; flooring never creates 0.4999995` (ppm display only).
- `complete-block eligibility drops the whole block when one position is both-floor`.
- `rare arms: neutral expectation is the measured initial share`.
- `sign-flip p values: n=6 min 0.031, n=10 min 0.002; edges refused when n < 9`.
- `verdict decision table is exhaustive` (every gate combination incl. G4/G5 failed -> control-invalid).
- `farthest-point pick is deterministic and distinct`: picks stable, pairwise `genomeDistance` above the clustering distance.
- `weakened variant differs from parent only in the stated weight`.
- `verdict follows gates`: synthetic gate sets give each verdict (`assay-sensitive`, `label-or-position-biased`, `insensitive`, `extinction-limited`) and the precedence order is fixed.

`tools/test/opponents-evidence.test.ts`
- `evidence seal and manifest verify` (`checkSaved()` returns no problems; no `generatedAt`/platform strings; statements include "CPU only", "no GPU evidence", "not the M3 environment").
- `a tampered payload, manifest or source is rejected` (edit a payoff, a manifest hash, one source file, an upstream input such as `generalistGenome` source).
- `workers resolve @bl/* without vitest aliases` (Node 24 subprocess, VITEST unset).
- `a correctly resealed but internally inconsistent payload is rejected` (summary or gate edited, seal and manifest recomputed).
- `worker count does not change output`: a mini config (2 pairs, 2 seeds, T=60) at `--jobs 1` and `--jobs 3` is byte equal.
- `mini regeneration equals itself` (determinism).
- `evidence records seeds, panel hex, distances, calibration constants, excluded counts, and the naive comparison`.
- `verdict in evidence equals the verdict recomputed from the stored gates`.

`apps/lab/test/opponents-packaging.test.ts` (same shape as the predictability one): Vite input present, Dockerfile removal list and Caddy private route (`/opponents`, `/OPPONENTS/index.html` match; `/opponents-other` does not), page text carries "CPU only", "no GPU evidence", "noindex", a captioned `<table>`, and the site build keeps a self-contained asset graph after the Dockerfile deletions.

`apps/lab/test/opponents-render.test.ts`: matrix renders the same numbers as the table; `uninformative` cells are labelled, not coloured as ties; reduced-motion; checkpoint/ratio/position toggles change the displayed numbers; text says synthetic for the cycle fixture.

## 6. Acceptance gates (runnable)

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install && pnpm typecheck
pnpm vitest run packages/metrics/test/opponents.test.ts tools/test/opponents-evidence.test.ts apps/lab/test/opponents-packaging.test.ts apps/lab/test/opponents-render.test.ts
node tools/opponents/assay.ts --check                 # integrity, no simulation
time node tools/opponents/assay.ts --replay-check     # byte-equal regeneration, under ~5 min
pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts experiments/test/prereg-sync.test.ts   # untouched pins
pnpm test                                             # full suite; report load-sensitive flakes separately
git diff --stat origin/main -- packages/sim-ref packages/sim-gpu packages/schema experiments   # must be empty
```
Before publication (D7): rebase on current origin/main, rerun the focused tests, `--check` and (if any hashed source changed) `--write` again, re-review the delta.
Plus: the calibration commit precedes the first `--write`; `evidence.json` `verdict` is recorded whatever it is; Codex Sol 6.1 xhigh read-only review of this plan (REVIEW.md, before code) and of the source before commit.

## 7. Page content

Header "Local experiment / historical opponents, first rung". Plain-language option text for ratio ("1:1 even start; 1:3 one side starts rare, which tests invasion"), position ("both positions averaged; the difference is shown as position effect") and contest time. Matrix cells show payoff, interval and excluded count; `uninformative` is its own state. Caption "What this does not show": a sensitivity check on five genetically separated founders in small CPU arenas, not the M3 environment; a payoff is share of biomass at a step, not reproduction or fitness; wins can be vigour, see the vigour toggle; the cycle fixture is synthetic; "none detected" is not "none exist"; no archive tournament has been run; CPU only, no GPU evidence, not on the public site. A real `<table>` carries every number the canvas shows.

## 8. Non-goals and limits

- No historical-archive tournament, no evolving against opponents, no generality-on-withheld-opponents (needs training history), no synthesis-versus-lottery attribution (reported as unresolved, no predation claim), no whole-patch transfer (that moves stored resources and developmental state; different experiment).
- No physics, schema, preset or `RULE_VERSION` change; no GPU or backend qualification; hosted/physical-GPU evidence: none.
- Small `sim-ref` worlds, five genotypes, S=10 seed blocks (6 for rare arms): wide intervals are expected and stated; an interval containing 0.5 is not evidence of equality.
- Weakened variant is a single hand-built manipulation, a sensitivity floor, not a spectrum of effect sizes.
- Fitness here is relative biomass share at a fixed step; it does not establish organism reproduction, open-endedness or ecological context effects.
- No paid calls, AWS, deploy, push or PR at this stage; the plan stage commits nothing.

## 9. Size and order of work

About 600 lines of library, 250 of CLI and worker, 400 of tests, one HTML/CSS/TS page. Order: step 0 discovery.ts spike (3.0); arena + labelling + invariants tests; payoff/cycle/vigour pure functions with fixtures; panel pick; calibration (scratch, freeze constants); CLI + worker + evidence/manifest; page; packaging edits and tests; Codex source review. If scope must shrink, cut in this order: `F1` twin control, see the job-schedule cuts in 3.7 (UI cuts do not save simulation time). Optional arms to cut first: F1 twin, rare-arm positions and seeds, contest-time selector.
