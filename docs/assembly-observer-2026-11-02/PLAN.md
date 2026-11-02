# I07 Construction grammar and copy number: first-rung plan

Status: PLAN stage, 2026-11-02. Branch `claude/i07-assembly` from `origin/main` c5098735. Source: "I07" and "Agent execution contract" in `docs/simulation-research-2026-11-01/report.md`; coordinator decisions D14, D15 (`docs/backlog-run-2026-11-01.html`; D15 is not yet written there, so the scope text in the task is the authority). Modelled on the merged I14 slice (`docs/predictability-atlas-2026-11-01/PLAN.md`): same library layout, canonical-JSON evidence, `--write/--check/--replay-check` CLI, private page. Observer and tooling only. CPU only, no GPU, no physics change, no model calls, no deploy.

## 1. Bounded question

Using a pre-stated, explicitly assembly-inspired grammar, do construction-length bound, copy count and persistence (each read separately) tell apart manually assembled hierarchies from (a) random fields and (b) random fields with duplicated random motifs, at matched occupied mass and resolution, and how much do those readings move under segmentation and temporal-sampling choices?

Answer shape (frozen rule, section 3.8): for each readout, "separates" or "fails to separate". The expected, and informative, outcome is that raw bound times copies fails on duplicated random motifs (they have high bound and many copies). That is a result, not a defect. No life-detection claim is made at any outcome; no evolving-world clip is a positive case.

## 2. What is built (one PR)

1. **Grammar spec, fixed before scoring** (`GRAMMAR.md`, section 3.1-3.4) and **frozen protocol** (`PROTOCOL.md`, 3.8-3.9).
2. **Exact toy path.** Exact construction length for small lattice objects (<= 10 cells) by exhaustive search, with hand-derived expected values.
3. **Bounded path for larger patches.** Beam/greedy grammar search returning an *upper bound*, labelled `bound` unless the exact search completed within budget (`exact`). Never called an assembly index.
4. **Calibration set** (matched mass) with the key negative case that fools the naive metric (duplicated random motifs), plus short sim-ref clips and reused I14 Life fixtures.
5. **Streaming patch sampler**: one frame in memory at a time; per-frame object extraction; the class tally is the only carried state.
6. **Evidence JSON + manifest** with `--write / --check / --replay-check`.
7. **Private page** `/assembly/` showing every calibration object, its separate readouts and baselines side by side, kept off the deployed site like `/predictability/`.
8. **Freeze-before-run.** `GRAMMAR.md`, `PROTOCOL.md` (decision rules, thresholds, seeds, grid, clip recipes) are committed and pushed (no PR) before any evolving-world clip is scored. Never rebased afterwards.

## 3. Design

### 3.1 Grammar (the spec file `GRAMMAR.md` must state each of these)

- **Substrate.** A patch is a `w x h` torus of small integers. Occupancy: cell occupied iff `value >= tau`. Frozen `tau = 1` primary; `tau in {1,2,4}` only in the sensitivity grid. Matter amount is ignored by the grammar (shape only); mass is controlled at the fixture level.
- **Primitive.** The monomer: one occupied cell.
- **Object.** A finite set of occupied cells, connected under the connectivity rule (3.2), stored as integer offsets from its min corner.
- **Joining operation.** Given two pool members A, B (A may equal B, reuse is free once built), place B at an integer offset relative to A so that cells are disjoint and the union is connected under the connectivity rule; the union is a new pool member. Cost 1 per join. Monomers are free.
- **Restriction (stated, not hidden).** Intermediates must be sub-objects of the target (connected subsets, up to the equivalence group). This is the standard "fragments of the target" restriction; it makes the search finite. The result is the *construction length under this grammar*, not the published assembly index (different primitives, 2D lattice, no chemistry).
- **Construction length `a(O)`**: minimum joins to build O from monomers. Trivial bounds `ceil(log2 n) <= a <= n-1`. Exact for `n <= EXACT_MAX_N` (10) within a node budget; otherwise an upper bound from the search that ran (`bound`, with the node budget recorded). Status field per object: `exact | bound`.
- **Equivalence / copy identity.** Primary group `T` (translation only). Variants `D4` (translation plus the 8 dihedral images). Two objects are copies iff their canonical forms (lexicographically least sorted offset list over the group) are equal. Primary reading uses `T`; `D4` reported as the equivalence-class uncertainty (3.6). Reflection is included in `D4` and flagged, since chirality is a real distinction on a lattice.
- **Torus.** Components are found with wraparound; an object that wraps the full torus in either axis is flagged `spans` and excluded from class tallies (counted, reported).

### 3.2 Segmentation (object boundaries)

Primary: 4-connectivity on occupied cells, torus. Variant: 8-connectivity. Both are in the frozen sensitivity grid; the primary is never chosen after seeing scores. Objects with more than `OBJ_MAX_N` (40) cells are scored by the bound only and flagged `large`. Components touching the patch border are not special (torus).

### 3.3 Exact search (toy path)

For target O with n cells: iterative deepening over join count k = lower bound .. n-1. State = set of pool members (canonical sub-objects of O, closed under the group). A step chooses an unordered pair (with repeat) from the pool whose canonical union is a connected sub-object of O at a consistent offset. Every candidate set is enumerated in a fixed order (cells sorted row-major, offsets sorted) so node counts are deterministic. Prune: pool must be able to reach |O| (largest piece sum bound), dedupe states by sorted canonical-id tuple. Budget `EXACT_NODE_BUDGET`; on exhaustion the status degrades to `bound` and the best known upper bound is returned. Expected exact values are derived by hand in the test file (see 5), not by running the solver: monomer 0; domino 1; I-tromino 2; 2x2 square 2 (two dominoes, one reused); I-tetromino 2 (domino reused); 1x8 line 3 (doubling); 2x4 block 3; plus-pentomino **4** (review finding 2: a 3-join build needs a connected 3+2 partition or a 2-join tetromino plus monomer; the plus allows neither; lower-bound proof in the test comment); L-tromino 2 (translation-only), and a case showing that D4 and T give the same `a` while differing in class counts.

### 3.4 Bounded search (larger patches)

**Certificate rule:** a reported `bound` is always the join count of a *completed* construction DAG (every target cell reached, every join valid under 3.1) which an independent validator re-checks in tests; a partial path's count is never reported. On budget exhaustion the monomer chain (`n-1`) is the fallback. Ties in the beam break by lexicographic canonical id. Greedy-with-reuse beam: maintain the pool; repeatedly pick the join that completes the largest repeated sub-pattern (copy-aware), beam width `BEAM_W` (8), node cap `BOUND_NODE_CAP`. Always also compare against the trivial `n-1` and keep the min. Output `{ bound, exact: boolean, nodes }`. Patch-level `sharedBound` is defined precisely: the join count of a completed construction DAG that builds every non-`spans`, non-`large` object of the patch, with pool members shared across targets (each pool member a connected sub-object of at least one target); it is a **cost** (lower = more reuse), reported as a separate readout. It is what makes a duplicated motif cheap after the first copy, and it is exactly the quantity we expect to expose duplicated random motifs as low-cost. Tests assert `bound >= exact` on every toy object where both are known, and that the bound is monotone-safe (never below the proven lower bound).

### 3.5 Calibration set (matched mass and resolution)

All synthetic patches `64 x 64` torus, exactly `M = 240` occupied cells (divisible by 6, 8, 10, 12, 15, 20, 24, 30), objects spaced so no two touch under 8-connectivity (so 4 and 8 segmentation agree on them; the sensitivity grid then probes the *other* cases). `R = 16` replicate seeds per class (counter-based integer PRNG from `packages/metrics/src/predictability/movie.ts`, reused, no `Math.random`). Classes:

| id | construction | role |
|---|---|---|
| `tile-repeat` | one fixed 6-cell motif, 40 copies | repeated tile |
| `crystal-lattice` | one connected solid block region (e.g. 12x20 solid) | deterministic crystal, one big object; bound grows ~ log |
| `crystal-spaced` | 15 identical 4x4 solid squares | crystal of copies |
| `random-field` | 40 distinct random connected 6-cell polyominoes | random, matched mass |
| `random-dup` | **key negative**: 4 distinct random 10-cell polyominoes, each in 6 copies, scattered. Motif selection (review finding 1: `a = n-1` is unattainable, every connected 10-cell object has two disjoint equivalent dominoes so `a <= 8`): per motif, generate `K = 256` deterministic random-grown candidates (attempt cap, no retry loop) and keep the one with the highest *exact* `a` (n=10 is exact-feasible); ties by canonical id. The chosen `a` is recorded; frozen floor `a >= 7` | duplicated random motifs |
| `random-dup-hi` | one random 10-cell motif (same selection), 24 copies | extreme duplication |
| `random-dup-12` | **size-matched negative**: one random 12-cell motif (same K=256 selection by `bound`), 20 copies | matched partner of `hier-12` |
| `hier-12` | **primary positive**: explicit program, one 12-cell object with genuine nested reuse (L-tromino -> 2x3 block from two trominoes -> 12-cell composite from two blocks; all coordinates written in `GRAMMAR.md` before freeze), 20 copies; same count, size, multiplicity and placement scheme as `random-dup-12` | manually assembled hierarchy |
| `hierarchy` | secondary: 4-level program ending in a 24-cell composite, 10 copies; sizes differ from the negatives, so it is reported but **cannot carry the verdict** (size/count confound) | hierarchy, unmatched sizes |
| `hierarchy-mixed` | two levels coexisting (copies at 6 and at 12 cells) | hierarchy at two scales |
| `random-scatter` | 240 isolated random cells, no objects larger than monomer | occupancy baseline floor |

**Matching.** The primary pair `hier-12` vs `random-dup-12` is identical in object size, object count, copy multiplicity and placement; it is the only pair that may carry a `separates` verdict. All other pairs are descriptive, with their size/count differences stated in the evidence. Because exact mass is enforced by construction, tests assert `sum occupied == 240` for every replicate. Where integer division cannot hit 240, the class is padded with isolated monomers and the padding count is recorded (not hidden).

**Reused I14 fixtures** (import from `packages/metrics/src/predictability/fixtures.ts`, no edits): `life-block`, `life-blinker`, `life-pulsar`, `life-glider`, `life-gliders-dup`, `life-soup-early`, `random-bits`, `random-static`, `blobs-diffuse`, plus `ecologyClip()`. Their mass is not matched; they are used only for persistence/temporal sampling and for sanity, and are labelled `unmatched` in the evidence so they cannot enter the separation rule.

**sim-ref clips** (`packages/metrics/src/assembly/clips.ts`): the I14 recipe (`presetConfig`, `RefSim`, channel B, shift 5, cap 15) on three presets frozen in `PROTOCOL.md`: `spots` (reuses I14 recipe), `gradient`, `seasons`; seed 1, 32x32, 96 frames, stride 4. Thresholds and the `tau` grid are frozen before these are scored. I14's `ecology.ts` is not edited (a new file copies the recipe with a preset parameter), so I14 evidence stays byte-identical. Dense worlds may be one giant object at `tau=1`; that is reported as "objects not defined" (`spans`/`large`), which is a legitimate sensitivity finding.

### 3.6 Readouts (kept separate; no combined statistic)

Per patch / per frame:
1. `constructionLength`: per class `a` (status exact|bound); patch summaries: sum, max, mean of `a/(n-1)` ("reuse ratio"), and `sharedBound`.
2. `copyCount`: per class and summary (number of classes with copies >= 2, max copies, copy-weighted sum). Under `T` and `D4`.
3. `persistence`: for movie inputs, fraction of classes (by canonical form) present at t that are present at t+dt for `dt in {1,2,4}` frames; static synthetic patches are `n/a`, not 1.
4. `equivClassUncertainty`: number of classes and total copy pairs under `T`, `D4`, and `D4` with 8-connectivity; the spread (max - min) is the uncertainty.
5. **Baselines**: occupied cell count (occupancy), deflate length of the packed patch (reuse `deflateSync` helper conventions and fflate pin from I14 `losses.ts`), object count, mean object size and max-class multiplicity (trivial descriptors, finding 3). All are independent columns and all enter the beyond-baselines gate. Evidence records the fflate version; verdicts depend on deflate only through baseline pair accuracy, re-derived by `--check`.
6. **Incremental value**: for each class pair of interest, exact order-accuracy of each readout and of each baseline over all replicate pairs (fraction of (hier-12_i, random-dup-12_j) pairs ordered in the **declared direction of that quantity**; ties count 1/2; integer rationals). "Incremental over baselines" means a readout orders pairs where occupancy and deflate do not (accuracy minus the best baseline accuracy, rational). It is a discrimination statement on a fixed fixture set, not predictive modelling.

**Directions are frozen per quantity (finding 4):** `sharedBound` and `reuseRatio` are costs; the declared direction for `hier-12` is **lower** (more reuse than a random motif of equal size). Per-object `constructionLength` and `maxCopies` are declared *not directional* at matched size and multiplicity (tied by design; reported, cannot separate). Baselines are scored in both directions, best direction used (conservative bar).

**Undefined values (finding 9):** monomers have undefined `reuseRatio` (excluded from means, counted); empty eligible sets give `null`, making the readout verdict `measurement-limited`, never pass or fail. `large` objects (> `OBJ_MAX_N`) are scored by bound only and counted; `spans` objects are excluded and counted.

**Torus identity (finding 10):** a component is unwrapped by BFS lifting from its row-major-first cell; a revisit at a different lift (winding) marks it `spans`. Canonical forms use lifted offsets, so a domino across a seam equals an interior domino; tests translate fixtures across both seams.

### 3.7 Sensitivity analyses (reported, never tuned)

- Segmentation: `{4,8} x tau {1,2,4}` on clips; on synthetic patches `{4,8}` (tau fixed); plus a one-cell dilation/erosion perturbation of every object boundary (deterministic) to measure how many class memberships change.
- Temporal sampling: stride `dt in {1,2,4,8}` frames on movies for persistence and copy count.
- Frozen segmentation-sensitive control (finding 5): `seam-touch` patches (240 cells; objects deliberately diagonally adjacent at scheme-fixed positions) built from the same `hier-12` and `random-dup-12` motifs, so 4 vs 8 connectivity changes object definitions inside the calibration set. The verdict is recomputed for `{4,8}` on spaced and `seam-touch` versions. Clips give descriptive outcomes only: per variant (object count, share of cells in `large`/`spans`, class count); a clip is `segmentation-dominated` if any moves by a factor of 2 or more across the `{4,8} x tau` grid (factor frozen). Temporal-sampling outcomes apply to movies only; static verdicts are `n/a` for sampling, never `stable`.
- Verdict per readout: `stable` if the separation verdict is identical across the grid, else `segmentation-dominated` (resp. `sampling-dominated`). If object definitions dominate, the sensitivity failure is published as the result; no boundary is changed to rescue the treatment.

### 3.8 Frozen decision rule (in `PROTOCOL.md`, before any clip is scored)

For each readout R in {`constructionLength` (patch mean per object, and `sharedBound`), `reuseRatio`, `copyCount` (max copies), `copyWeightedConstruction` (naive metric under test, defined as `sum over classes with copies >= 2 of a_class * (copies_class - 1)` so duplication weights it; algebra tested)} and each of the two negative classes `random-field`, `random-dup`, `random-dup-hi`:

- R **separates** `hier-12` from `random-dup-12` iff, over all `R x R` replicate pairs, the score is ordered in R's declared direction in every pair (accuracy = 1) under the primary grammar, **and** the same strict ordering holds in the segmentation grid.
- If `random-dup`, `random-dup-hi` or `random-dup-12` scores as strongly as the weakest `hier-12` replicate on R (secondary `hierarchy` reported separately): verdict for R = **`fails to separate`**, and the report states in those words that no life-detection claim is made from R.
- If the verdict differs across the sensitivity grid: `segmentation-dominated` and published as a sensitivity failure.
- A readout that passes must additionally beat the best of occupancy and deflate baselines on pair accuracy to be called `adds value over simple baselines`; otherwise `separates, but not beyond baselines`.

Expectation, declared before running (so surprises are visible): the naive `copyWeightedConstruction` fails against `random-dup`/`random-dup-hi` vs secondary `hierarchy`; `maxCopies` cannot separate at matched multiplicity; `reuseRatio` and `sharedBound` may separate; neither is allowed to be tuned after seeing it. Thresholds (the accuracy-1 requirement, grids, `R`, `M`) are fixed in `PROTOCOL.md`; any change needs a dated amendment file, never an edit.

### 3.9 Evidence, manifest, streaming

- `evidence.json`: deterministic payload only (grammar version `ASSEMBLY_VERSION = 1`, frozen constants, per-class summaries and per-replicate rows, pair accuracies, sensitivity grids, verdicts, I14 fixture sha256s, clip configs plus movie sha256, statements "CPU only", "no GPU evidence", "no score here selected anything", "destruction/reconstruction interventions: not done (later rung)", "no evolving-world positive case", `integritySha256`). No timing, platform or SHA inside.
- `manifest.json`: payload sha256, sha256 of every source file, freeze commit sha, non-replayed provenance block (tool versions, wall-clock, base commit c5098735).
- CLI `node tools/assembly/observer.ts --write | --check | --replay-check` (Node 24, relative imports, `@bl/*` hook as in `tools/predictability/atlas.ts` for the clips). `--check` needs no simulation. Runtime budget: regeneration under 10 minutes on a loaded machine (exact search is capped by a deterministic node budget (values set in step 0; toy-size results must finish exact); budgets are the knob, not wall-clock, so the payload is deterministic); measured and logged outside the payload. Time limits are not loosened; if exceeded, shrink `R`/clip count through an amendment before freeze, not after.
- **Streaming sampler**: `streamObjects(frames: Iterable<Uint8Array>, params)` is a generator; per frame it extracts components, canonicalises, folds into a `Map<canonicalKey, tally>` and drops the frame. Clips are generated lazily by a new frame-iterator over `RefSim` (not I14's `ecologyClip()`/`movieBytes()`, which retain whole movies; movie hashes are incremental). Retained state is the class tally plus a ring of the last `max dt` class sets, checked through the sampler's own `retainedFrames()` counter (not GC) and a lazy 10^4-frame generator test. Nothing reads a run bundle or `lineages.tsv`.

## 4. Files

Add:
- `docs/assembly-observer-2026-11-02/GRAMMAR.md`, `PROTOCOL.md` (freeze files), later `REVIEW.md`, `evidence.json`, `manifest.json`
- `packages/metrics/src/assembly/{version.ts,grammar.ts,segment.ts,exact.ts,bound.ts,fixtures.ts,clips.ts,readouts.ts,verdict.ts,stream.ts,observer.ts,index.ts}` (~900 lines; imports I14 `movie.ts`, `fixtures.ts`, `losses.ts` helpers by relative path; `clips.ts` and the CLI are the only files touching `@bl/*`)
- `tools/assembly/observer.ts`
- `apps/lab/assembly/index.html`, `apps/lab/src/assembly/{page.ts,render.ts,style.css}`
- Tests in section 5.

Change (small):
- `apps/lab/vite.config.ts`: add `assembly: r("./assembly/index.html")`.
- `Dockerfile.site`: append `apps/lab/dist/assembly apps/lab/dist/assets/assembly-*.js apps/lab/dist/assets/assembly-*.css` to the `rm -rf` list.
- `deploy/Caddyfile`: `@private_assembly path_regexp private_assembly (?i)^/assembly(?:/|$)` -> `respond 404`, beside `private_predictability`.

Not touched: `packages/sim-ref`, `sim-gpu`, `schema` (config, presets, `RULE_VERSION`), `golden-hashes.test.ts`, `defaultConfig()`, `packages/metrics/src/index.ts` (no barrel re-export, per the I14 review finding), I14 files, `experiments/*`, coordinator. No new package, so the four alias maps are untouched.

## 5. Tests (vitest, named cases)

`packages/metrics/test/assembly-grammar.test.ts`
- `canonical forms: translation and D4`: hand-built objects; T-equal vs D4-equal pairs (L-tromino and its rotation/reflection are D4-equal, T-different).
- `segmentation: 4 vs 8 connectivity`: diagonal pair is two objects under 4, one under 8; torus wrap joins across the seam; `spans` flag for a full-width ring.
- `exact construction length toy values`: the hand-derived table in 3.3; each with its derivation in a comment; also lower/upper trivial bounds hold for every enumerated polyomino up to n=6 (all free and fixed polyominoes generated in-test).
- `reuse is free, copies are not`: two disjoint dominoes in one pool: pool of target "2x2" costs 2; "two separate dominoes far apart" is two objects with a=1 each and shared bound 1.
- `exact budget exhaustion degrades to bound`: tiny budget on a 10-cell object returns `status: "bound"` with `bound >= exact`.
- `bound is an upper bound`: for every toy object `bound >= exact`, and for a 64-cell solid block `bound <= n-1` and `bound <= 2*ceil(log2 n)+c` (the doubling construction is found), labelled `bound`.
- `sharedBound exposes duplication`: 6 copies of one random 10-cell motif have `sharedBound < sum of per-object bounds`, and per-object `a` is identical for every copy.

`packages/metrics/test/assembly-calibration.test.ts`
- `matched mass`: every replicate of every synthetic class has exactly 240 occupied cells; padding recorded.
- `fixtures are deterministic`: two generations give identical sha256; pinned digests per `ASSEMBLY_VERSION`.
- `random-dup motifs are internally unstructured`: each chosen motif has exact `a >= 7` (K=256 cap, generator terminates); a test documents that `a = 9` is unattainable at n=10.
- `naive metric algebra`: `copyWeightedConstruction` equals `sum a*(copies-1)` on constructed inputs and grows with duplication at fixed motif. Whether it fools the real calibration set is an *outcome* in evidence, not a unit-test assertion; fixtures are never edited to make it so.
- `verdict rule on constructed scores`: each branch (separates / fails to separate / segmentation-dominated / separates but not beyond baselines) from hand-made numbers, independent of stored evidence.
- `pair accuracy`: known small matrices give exact rationals, ties 1/2.
- `incremental over baselines`: constructed case where deflate and occupancy tie but a readout orders.
- `persistence and temporal sampling`: exact values measured by the reviewer: glider persistence at lag 1 is 1/2 under 4-connectivity (recurring class is the monomer) and 0 under 8, and 1 at lag 4; tests assert these rationals. Persistence is a frame lag, distinct from sampling stride (movie subsampled first). Random-bits persistence is recorded, no "near zero" gate. `n/a` for static patches.
- `equivalence uncertainty`: spread is 0 for a fixture with only symmetric-free objects and > 0 for a constructed chiral-pair case.

`packages/metrics/test/assembly-stream.test.ts`
- `streams one frame at a time`: instrumented generator; max live frames == 1; result equals the non-streaming reference on a small movie.
- `past/future independence`: completed persistence pairs (t, t+dt) come from a bounded ring of the last `max dt` class sets; results for pairs ending at k are unchanged when later frames change.

`tools/test/assembly-evidence.test.ts`
- `evidence seal and manifest verify` (check path); `tampered payload/manifest/source rejected`; `replay reproduces byte for byte`; subprocess smoke `node tools/assembly/observer.ts --check`.
- `protocol constants equal PROTOCOL.md`: the fenced JSON block in `PROTOCOL.md` deep-equals the exported frozen constants (prereg-sync style).
- `freeze commit precedes outcomes`: manifest freeze sha is an ancestor of HEAD, **both `GRAMMAR.md` and `PROTOCOL.md` exist at it and match current content byte for byte (later changes only as dated amendment files marked `outcomeExposed`)**, and `evidence.json` is absent from it (`git` subprocess; skipped with explicit message when no git history, e.g. in a tarball).
- `plain twin equals observed twin`: clip observed with the sampler vs plain `RefSim`, full `stateHash` equal at every frame; `RULE_VERSION` and `defaultConfig()` hash literals unchanged.
- `statements`: CPU-only, intervention-not-done and no-claim strings present; no platform/timing keys.

`apps/lab/test/assembly-packaging.test.ts` and `apps/lab/test/assembly-render.test.ts` (mirror the I14 pair)
- vite input present; `Dockerfile.site` removes `dist/assembly`; Caddy regexp matches `/assembly`, `/assembly/`, `/ASSEMBLY/index.html`, not `/assembly-other`.
- Render: side-by-side cards for every calibration class; a real `<table>` repeats the numbers; each readout in its own column; verdict text uses the words "fails to separate"; caption present.

## 6. Acceptance gates (run in order; each fails the stage)

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install                                     # once
set -e
pnpm vitest run --maxWorkers=2 packages/metrics/test/assembly-grammar.test.ts packages/metrics/test/assembly-calibration.test.ts packages/metrics/test/assembly-stream.test.ts tools/test/assembly-evidence.test.ts apps/lab/test/assembly-packaging.test.ts apps/lab/test/assembly-render.test.ts
node tools/assembly/observer.ts --check
node tools/assembly/observer.ts --replay-check
pnpm typecheck
pnpm vitest run --maxWorkers=2 packages/sim-ref/test/golden-hashes.test.ts
pnpm vitest run --maxWorkers=2 packages/metrics/test/predictability.test.ts tools/test/predictability-evidence.test.ts   # I14 untouched
pnpm test -- --maxWorkers=2
PROT='packages/sim-ref packages/sim-gpu packages/schema experiments packages/metrics/src/predictability packages/metrics/src/index.ts apps/lab/predictability tools/predictability docs/predictability-atlas-2026-11-01'
git diff --exit-code c5098735 -- $PROT
test -z "$(git ls-files --others --exclude-standard -- $PROT)"   # untracked additions too
pnpm build && test -e apps/lab/dist/assembly/index.html
```
Regeneration (`--write`) wall-clock is logged and must be under about 10 minutes. Manual: browser look at `pnpm dev` `/assembly/` (cards render, reduced motion respected, keyboard operable, caption visible), recorded in the PR body. Read-only Sol review (`gpt-6.1-sol`, xhigh): once on the freeze files before the freeze commit, once on source and evidence before commit; findings resolved in `REVIEW.md`. Image checks are "not run" unless an image is built.

## 7. Order of work and freeze point

0. **Development benchmark first (finding 13):** a throwaway workload (not the frozen protocol; no calibration outcomes read) times exact/beam search to choose numeric `EXACT_NODE_BUDGET`, `BOUND_NODE_CAP`, `BEAM_W`, candidate caps and a whole-regeneration total-node limit (deterministic, with canonical-object result caching). Hierarchy coordinates, motif seeds, the K=256 selection rule, all fixture recipes and tie-breaks are written complete into the freeze files. Synthetic calibration scores are computed only after the freeze commit exists.
1. Write `GRAMMAR.md` and `PROTOCOL.md` (including the fenced constants block, numeric budgets, complete fixture recipes, clip recipes, expected-outcome paragraph). Sol review them. Commit **only** those two files and `git push -u origin claude/i07-assembly` (no PR). Record the commit sha. This is before any clip or evolving-world scoring and before the calibration outcomes exist.
2. Implement grammar/segment/exact with the toy tests (no outcomes needed). Then bound, fixtures, readouts, verdict, stream, with synthetic tests.
3. Run `--write` once; clips scored only now. Never rebase the pushed freeze commit.
4. CLI check paths, page, packaging edits, full gates, Sol review, REVIEW.md.

If scope must shrink, cut in this order: `D4` variant beyond the toy tests, dilation/erosion perturbation, clip count to `spots` only, page canvases to a static table. Do not cut the negative case, the exact toy tests, or the frozen rule.

## 8. Non-goals and limits

- Not the published assembly index (different primitives, 2D lattice, target-fragment restriction); outputs are "construction length under this grammar", exact only for small objects, otherwise an upper bound.
- No life-detection claim at any outcome; evolving-world clips are descriptive, never positives, and score nothing that selects anything. No optimisation of the metric, no held-out use of it.
- Destruction/reconstruction interventions (capability link): **not done**, recorded in evidence as a later rung.
- Hierarchy fixtures are hand-built by us; passing them shows the readout tracks that construction, not that nature does. Dense sim worlds may not segment into objects at all; that is reported.
- Compression is a baseline, not an assembly index. Deflate output is library-version sensitive (fflate pin recorded).
- No GPU or backend qualification; no hosted evidence; page is local and private. No deploy, no PR at plan stage.
- Small fixed fixture set (R=16 per class, three clips, one seed): an observer calibration, not an ensemble result.
