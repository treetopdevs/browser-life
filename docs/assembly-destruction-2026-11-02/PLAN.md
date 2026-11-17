# I07b Destruction and reconstruction: second-rung plan

Status: PLAN stage, revised after Codex Sol xhigh plan review (16 findings, dispositions in REVIEW.md), 2026-11-02. Branch base is the immutable commit recorded as BASE below (not the moving `origin/main`). Branch `claude/i07-destruction` from `origin/main` f94bb52b. Source: "I07" in `docs/simulation-research-2026-11-01/report.md` ("Add destruction/reconstruction interventions to connect the measured organisation to a capability"; "Reject a life-detection claim if duplicated random motifs score as strongly as the proposed positive cases"). First rung: `docs/assembly-observer-2026-11-02/` (PR #148): reuse-aware readouts (`sharedBound`, `reuseRatio`) separated `hier-12` from `random-dup-12`; the naive copy-weighted metric failed. Observer and tooling only: CPU, no GPU, no physics change, no model calls, `RULE_VERSION` and golden pins untouched, nothing added to `defaultConfig()`.

## 0. Revisions from plan review (binding; they supersede any older wording below)

- R1 (reduced scope, finding 15): the shipped rung is the **synthetic assay + nulls + sealed CLI evidence + EVIDENCE.md**. The private page, its Playwright spec and render test, and the real-sim clip arm are **stage 2, built only if the assay is frozen, scored and green with time left**; if cut, EVIDENCE.md says "page and clip arm deferred" and the acceptance list drops them. D4/D8 variants stay (cheap, synthetic).
- R2 (finding 2): the property tested is renamed **recipe-dependent reconstruction** (rebuilds the class after total destruction from information held outside the patch), not heredity. Added negatives: `stored-image-renderer` (a bitmap store that pastes the stored image; is positive for C1 by design, and is labelled so: C1 cannot tell recipe from image) and `wrong-store-builder` (store replaced by a different program, activity preserved: rebuilds the *wrong* class, identity 0). Truth labels are therefore stated per property: `recipe-dependent` = {builder-hier12, stored-image-renderer}, `heritable-transmission` = untestable in this assay (no transmission step) and said so.
- R3 (finding 1): `highAssembly` is dropped as a crystal gate. First-rung evidence shows hier-12 and the 4x4 crystal both have `a=4` (reuseRatio 4/11 vs 4/15), so no ceiling separates them. Frozen predicate: `highAssembly(patch) := construction readouts eligible (>=2 distinct non-monomer keys recovered) and copy-weighted construction >= 1/2 of the pre-damage hier-12 reference`, a level gate only; the crystal is expected to **pass** it. The crystal is then separated, if at all, by identity+ablation (C1 gives it `reappears-by-templating-only`/`level-only`, never `reconstructs`, because the crystal grows from surviving seeds only), and the report states plainly that these readouts alone do not exclude the crystal as "high".
- R4 (findings 3, 8): `identityReturn` is copy-count recovery. Let `n0` = copies of the target key before damage, `n1` = copies right after damage, `n2` = copies after regrowth. Defined only if `n0 >= 8` and the damage actually removed mass. `identityReturn = (n2 - n1)/(n0 - n1)` clamped to [0,1] when `n1 < n0`; a survival-only outcome (n1 = n2) is 0. Persistence = key count at each of the last 3 rounds `>= ceil(n0/2)`; it is part of every positive. `levelReturn` requires baseline copy-weighted construction `> 0` and post-regrowth occupied mass `>= 3/4 * 240`; a zero baseline or empty regrowth is `undefined`, never true. Zero denominators or missing rows reject the run.
- R5 (finding 4): regrowth is by whole objects. Frozen rules: surviving fragments are **swept** (removed, recorded as `sweptMass`) at the start of regrowth so only whole objects of any kind remain; at most 2 objects per round, 8 rounds; residual mass (`240 - occupied` at the end, can be nonzero and is recorded) is a reported outcome. The unconditional C3 expectation is removed; C3 (mass back to within one object of 240) is reported as measured. Mass identity test: `occupied_after = occupied_before - removed - swept + regrown` exactly. Crystal total-destruction nucleation: one frozen 2x2 seed placed by the process PRNG (stated information source: the process itself, not the patch); the crystal then grows by edge accretion. The 4x4 crystal is treated as 16 cells at spacing, mass accounted like others.
- R6 (finding 5): outcomes are measured, not asserted. Initial motif generation and regrowth sampling are separate PRNG streams (`init`, `regrow`). `fresh-random-dup12` uses a plain K=1 draw (a connected 12-cell polyomino, no scoring) for the original and a *separate* K=1 draw for regrowth; whether the regrown key collides with the original, and the level result, are recorded. No unit test asserts the hypothesis outcomes of random processes: tests use **constructed inputs** for the verdict arithmetic (a table of hand-made per-replicate rows -> expected verdict/classifier answers). The declared expectation stays in PROTOCOL.md and a flipped outcome is reported as a surprise, not a failure.
- R7 (findings 6, 7): the scramble control is split. (a) Class loss: after `scramble`, the target key count is *measured* (expected near 0 but not forced, not randomised until absent). (b) Organisation control: scramble is an *occupancy-matched spatial randomisation* of the whole patch (same 240 cells, torus, PRNG free cells). Frozen criterion: for hier-12 and crystal patches, the patch-level `sharedBound` and `reuseRatio` after scramble must each move to the **worse** side (cost readouts, lower is the hierarchical direction, so higher cost) of the pre-damage value in at least 14 of 16 replicates, aggregated as exact counts; patches with fewer than 2 non-monomer keys after scramble give `undefined` (reported, counted as moved). For `inert-scatter` the control is `not-applicable` (monomers only). Failing the criterion gives `measurement-limited` for the affected process rows only, not a global stop.
- R8 (finding 9): classifiers give a **per-replicate binary prediction** of "recipe-dependent reconstruction": C1 = (`identityReturn >= 1/2` after `lesion-total` and persistence) in this replicate and the paired `nostore` replicate has identity 0 (processes without a store arm: C1 false, arm missing is a documented `n/a` that counts false); C2 = `levelReturn` true after `lesion-partial`; C3 = final mass within one object of 240 after `lesion-total`. Accuracy = exact integer correct/96 over 6 truth-labelled processes x 16 replicates (the stored-image renderer and wrong-store builder are reported in a second table, 8 processes x 16 = 128). A separate **process aggregation table** gives the four-way label (`reconstructs` = every replicate positive on C1; `reappears-by-templating-only` = identityReturn >= 1/2 in every replicate after partial and 0 in every replicate after total; `level-only`; `absent`), with precedence in that order. Missing rows, zero denominators, or incomplete replicate sets reject the run.
- R9 (finding 10): freeze-before-scoring is enforced. Seed namespaces: `dev` (any, used for tests and tuning of implementation bugs) and `score` (frozen in PROTOCOL.md, never used before the freeze commit; a test fails if `dev` and `score` seeds intersect). The reference key is handed to the scorer only; the regrowth code receives (process, store, rng) and never the pre-damage patch except `template-*`, whose input is the *surviving* patch by definition. `tools/assembly/destruction.ts --write` refuses to run unless `git merge-base --is-ancestor <freeze-sha> HEAD` and the protocol/constants/decision-path file hashes (protocol.ts, damage.ts, regrow.ts, processes.ts, readouts.ts, verdict.ts, PROTOCOL.md, first-rung GRAMMAR.md, and the reused first-rung sources) match the manifest's freeze block. Test: `write refuses when freeze hashes differ`. The freeze commit pins implementation of the decision path, not only constants; after the freeze only evidence, EVIDENCE.md, REVIEW.md, page and tests may change, otherwise a dated amendment.
- R10 (finding 11): damage is described as a **synthetic occupancy deletion on binary patches**, loosely modelled on `applyLesion`'s disc geometry. It does not mirror `applyLesion` (which turns B/P into C, drains E to heat, resets motion/lineage and clamps radius via `config.ts`). If the clip arm is built, real-sim clips audit matter, heat and effective radius separately.
- R11 (finding 12, only if the clip arm is built): lesion by calling `applyLesion` on a RefSim between physics steps, sample frames in an explicit own loop (not via `clipFrames`, which samples before `onSim`), at step indices frozen in PROTOCOL.md; the first-rung flag is inherited as conservative abstention and a new per-clip sensitivity verdict is computed over the same 4/8 x threshold variants only if run on the same sampling; otherwise "no verdict" is the only allowed word.
- R12 (finding 13): acceptance order is structural unit tests, then frozen generation, then evidence/verify tests (see section 6).
- R13 (finding 14): protected-path guards compare against `BASE` (the recorded branch base commit, `git merge-base HEAD origin/main` at creation = f94bb52b) and additionally fail on untracked files under protected paths (`git status --porcelain -- <paths>` empty).
- R14 (finding 16): Dockerfile.site deletes `dist/assembly`; privacy is by that deletion plus the Caddy `^/assembly(?:/|$)` 404. The packaging test keeps an asset-graph check for the `assembly-destruction` entry.

## 1. Bounded question

Take objects the frozen grammar scores as high-assembly, destroy them, and let a process run. Does the *same* object class (identical canonical key under translation) come back, and does that reappearance tell a process that rebuilds from stored, heritable information apart from processes where a high readout is also produced by templating, passive accretion or fresh randomness?

Answer shape, frozen before scoring: for each process, `reconstructs` / `reappears-by-templating-only` / `level-only` / `absent`, plus whether the two candidate classifiers (identity-after-total-destruction with store ablation, and the naive level classifier) agree with the known truth label of that process. The expected and informative outcome is that the naive level classifier ("high copy-weighted construction returns, so it was rebuilt") mislabels at least one negative, and that partial destruction alone cannot separate heritable rebuilding from templating. No life-detection claim at any outcome.

## 2. What is built (one PR)

1. **Frozen protocol** `PROTOCOL.md` (decision rules, thresholds, seeds, process recipes, expectation) and an unchanged-grammar statement. `GRAMMAR.md` of the first rung is reused by hash (grammar version 1, `ASSEMBLY_VERSION` untouched); this slice adds no grammar change. Freeze-before-run: protocol file(s) and the `PROTOCOL` constants module are committed and pushed (no PR) before any evidence is written.
2. **Processes and interventions** (`packages/metrics/src/assembly/destruction/`), all pure integer functions of (process, replicate, protocol) on the first rung's 64x64 torus with exactly `M = 240` occupied cells:
   - Damage operators: `lesion-partial` (disc removal on the occupancy grid, see R10; centres and radius frozen), `lesion-total` (all objects of the target class destroyed), `scramble` (control: same occupied mass, every cell moved to a PRNG-chosen free cell, so organisation is gone and mass is not). Removed mass is recorded; no hidden mass.
   - Regrowth rules (the process under test), each run for `T = 8` rounds, adding objects at free, non-touching sites until mass returns to 240 or the round budget ends:
     - `builder-hier12` (positive, heritable): a program store held *outside* the patch (genome-like) rebuilds `hier-12` by its 3-level program. Ablation arm `builder-hier12-nostore`: same process, store deleted at the damage step.
     - `template-hier12` and `template-dup12`: new objects are copied from surviving objects (templating, information lives in the objects). Reappear after partial damage, cannot after total damage. Shows the partial-damage test alone cannot separate them from the builder.
     - `fresh-random-dup12` (the naive-fooling negative): regrowth draws a *new* random 12-cell motif, copied 20 times. Level readouts (copy-weighted construction, copy count) return; identity does not.
     - `accretion-crystal` (passive aggregate): edge-growth of a spaced 4x4 crystal. Identity reappears but the construction bound is low, so it fails the "high-assembly" gate. Guards against calling any returning thing reconstruction.
     - `inert-scatter`: random monomers; occupancy floor.
   - Reuse of the first rung: `segment`, `ConstructionService`, `patchReadouts`, `canonicalKey`, `PROTOCOL.patch`, fixtures `hier-12` / `random-dup-12` motif generators, `rnd` from `predictability/movie.ts`. No parallel grammar.
3. **Reconstruction readouts** (kept separate, rationals): `identityReturn` (fraction of original T-class copies whose key is present after regrowth), `levelReturn` (copy-weighted construction after regrowth within a frozen 25 percent of the pre-damage value, key ignored), `highAssembly` (target class `a` bound at or below the frozen `reuseRatio` ceiling that the first rung's `hier-12` met), `persistence` of returned copies over the last 3 rounds, and the D4 and 8-connectivity variants as equivalence-class uncertainty (verdict recomputed for `{4,8}`; disagreement = `segmentation-dominated`, published as such).
4. **Evolving-world arm, descriptive only.** There is no committed fixture in the repo with a verified heritable constructive object: gene v1/v2, polymer-shell and the breeder shell test closed confounded, no pass or "NO" (see `docs/assembly-observer-2026-11-02/EVIDENCE.md` for the clips, all `segmentation-dominated`). So no evolving-world positive case exists and none is invented. What is run instead: the three first-rung sim-ref clips (`spots`, `gradient`, `seasons`, seed 1, 32x32, same recipe via `clips.ts`) with a *real* lesion through `applyLesion` on a RefSim at a frozen step and a bit-identical unlesioned twin (same seed, same steps), then a same-recipe scramble of the post-lesion frame. Reported per clip: object-class set before, right after, `k` frames later, for twin and lesioned runs; class-return fraction with 4 and 8 connectivity. Not scored by the verdict rules, because the clips are segmentation-dominated; the evidence states "no verdict possible" for any clip where the first-rung rule already flagged it. Uses the CPU `RefSim` only (no new interventions code; `packages/runner/src/interventions.ts` schedule semantics are quoted, not changed).
5. **Evidence + manifest** `evidence.json`, `manifest.json` with `--write / --check / --replay-check`, same sealing scheme as the first rung (payload sha256, per-source hashes, freeze commit sha, non-replayed provenance block). Payload has no timing or platform.
6. **Private page** `apps/lab/assembly/destruction/index.html`: for each process a before / damaged / regrown strip (three canvases drawn from the saved evidence and re-derived by the page), the labels `reconstructs` etc. as text plus icons (not colour alone), both classifiers next to the truth label, the clip arm below with "no verdict" shown plainly, and the CPU-only and not-a-life-detection statements. Private like `/assembly/`: the existing Caddy rule `^/assembly(?:/|$)` already 404s it on the deployed site and Dockerfile.site already copies `dist/assembly`; the Vite entry key is `assembly-destruction` so emitted assets match the existing `assets/assembly-*` globs.

## 3. Frozen decision rules (go into PROTOCOL.md before any scoring)

Truth labels (declared by construction, not measured): `builder-hier12` heritable; every other process not heritable.

- Process verdict `reconstructs`: after `lesion-total`, `identityReturn >= 1/2` in every one of 16 replicates, **and** `highAssembly`, **and** the matching `nostore` arm gives `identityReturn = 0` in every replicate.
- `reappears-by-templating-only`: identity returns after `lesion-partial` in every replicate, is 0 after `lesion-total`.
- `level-only`: `levelReturn` true, identity 0 in every replicate.
- `absent`: otherwise.
- (Superseded in detail by R8; kept for history.) Observer classifiers compared: C1 = the verdict above (identity, total destruction, store ablation); C2 = naive (`levelReturn` after `lesion-partial`, no identity, no ablation); C3 = occupancy return (mass back to 240). Accuracy against truth labels as exact integers over the 6 processes x 16 replicates. Scramble gate: see R7.
- Declared expectation (surprises visible; measured, never asserted by tests, see R6): C1 correct on the 6 base processes; C2 wrong on `template-*` under partial damage (counted positive) and possibly on `fresh-random-dup12`; C3 reported as measured. `accretion-crystal` passes the level gate (R3) and is separated only by identity+ablation. If C2 is also right everywhere, the result is "the second rung adds nothing over naive return" and is published as such.
- Nothing tuned after scoring; any change is a dated `amendment-N` file.

Frozen constants (in `destruction/protocol.ts`, mirrored as a fenced JSON block in PROTOCOL.md and compared by test): replicates 16, rounds 8, lesion radius and centres, level tolerance 25 percent, identity threshold 1/2, seeds, site pitch (8, as first rung), `M = 240`, clip lesion step and radius, `k` lag frames.

## 4. Files

Add:
- `docs/assembly-destruction-2026-11-02/{PLAN.md,PROTOCOL.md,REVIEW.md,EVIDENCE.md,evidence.json,manifest.json}` (+ prompts and Codex outputs)
- `packages/metrics/src/assembly/destruction/{protocol.ts,damage.ts,regrow.ts,processes.ts,readouts.ts,verdict.ts,clips.ts,observer.ts}` (~700 lines; `clips.ts` is the only file touching `@bl/*`; not re-exported from the barrel, like `clips.ts` of the first rung)
- `tools/assembly/destruction.ts` (CLI `--write | --check | --replay-check`, Node 24, same `@bl/*` hook as `tools/assembly/observer.ts`)
- `apps/lab/assembly/destruction/index.html`, `apps/lab/src/assembly/destruction/{page.ts,render.ts,style.css}`
- Tests below.

Change (small): `apps/lab/vite.config.ts` (one input `assembly-destruction`), `apps/lab/test/assembly-packaging.test.ts` (one case for the new page staying private). No edits to the first rung's source, evidence, `PROTOCOL.md` or `GRAMMAR.md`, to `packages/sim-ref`, `packages/schema`, `packages/runner`, or the preregistration.

## 5. Tests (named)

`packages/metrics/test/assembly-destruction.test.ts`:
- `damage lesion-partial removes exactly the cells in the disc and records the removed mass`
- `lesion-total leaves zero copies of the target key`
- `scramble keeps occupied mass at 240 and destroys every object of the target class`
- `regrow never overlaps occupied cells and never touches under 8-connectivity`
- `mass accounting: occupied after = occupied before - removed + regrown, for every process and replicate`
- `builder-hier12 rebuilds the hier-12 key under total destruction; the nostore arm does not`
- `template-dup12 returns under partial destruction and not under total destruction`
- `fresh-random-dup12 key differs from the original in every replicate but levelReturn is true`
- `accretion-crystal returns its key and fails the highAssembly gate`
- `translation across both torus seams does not change identityReturn`
- `process outputs are pure functions of (process, replicate, protocol): two runs equal, no Math.random` (source scan)
- `verdict table: C1 right on all 6 processes, C2 wrong on the named negatives` (the declared expectation, asserted so a flip shows)
- `segmentation variant {4,8} that disagrees is labelled segmentation-dominated, not forced`
- `scramble gate: a readout that does not drop after scramble gives measurement-limited`
- `protocol constants equal the fenced JSON block in PROTOCOL.md`

`packages/metrics/test/assembly-destruction-clips.test.ts`:
- `lesioned and twin runs are identical up to the lesion step`
- `lesion step matches applyLesion on a RefSim clone (cells in disc are bound-free)`
- `clip arm reports no verdict for clips flagged segmentation-dominated by the first-rung rule`
- `streaming: one frame retained at a time (retainedFrames counter)`

`tools/test/assembly-destruction-evidence.test.ts`:
- `evidence seal verifies; tampering one replicate row fails --check`
- `statements present: CPU only, no GPU evidence, no evolving-world positive case (reason), no life-detection claim`
- `manifest source hashes cover destruction/*.ts, the frozen protocol, amendments, and the first rung's GRAMMAR.md`
- `first-rung evidence.json and manifest.json byte-identical to origin/main` (git diff guard)
- `payload contains no timing or platform fields`

`apps/lab/test/assembly-destruction-render.test.ts`:
- `strip rendering is deterministic from evidence rows` ; `labels carry text and an icon, not colour alone` ; `clip rows with no verdict render the words "no verdict"`.

Browser: `tests/e2e/assembly-destruction.spec.ts` (per-worktree, `BL_E2E_PORT=5411`, chrome project): `/assembly/destruction/` at 1280 and 375 px, all canvases drawn, status line says regenerated strips match the saved hashes, no page-level horizontal overflow, screenshots saved and read.

## 5b. Test changes from review (override section 5)
Tests asserting hypothesis outcomes of random/process runs (`fresh-random-dup12 key differs ... levelReturn true`, `verdict table: C1 right ..., C2 wrong ...`, `accretion-crystal ... fails the highAssembly gate`, `scramble keeps ... destroys every object`) are replaced by: constructed-row verdict tests; `identityReturn` definition tests (survival-only is 0, undefined when n0<8); `levelReturn` undefined on empty/zero-baseline; mass identity with `sweptMass`; scramble criterion on constructed patches (14/16 count); `dev`/`score` seed disjointness; `write refuses when freeze hashes differ`; stored-image-renderer and wrong-store-builder rows present; untracked-file guard. Page, render and e2e tests and the clip tests exist only if stage 2 (R1) is built.

## 6. Acceptance gates (runnable)
Order (R12): unit/structural tests -> freeze commit pushed -> `--write` -> evidence/verify tests -> (stage 2: page, e2e). Protected-path guard uses `BASE=f94bb52b568e33ec0bbe429370b1fbd3aad4ed8a`, not `origin/main`, plus `git status --porcelain` on protected paths (R13). The command list below is the full-scope list; entries for the page, clips and e2e apply only if stage 2 is built.

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH; cd /Users/nicholas/develop/browser-life-i07-destruction
uptime                                   # pace heavy runs when load > 40
pnpm install
pnpm vitest run --maxWorkers=2 packages/metrics/test/assembly-destruction.test.ts packages/metrics/test/assembly-destruction-clips.test.ts tools/test/assembly-destruction-evidence.test.ts apps/lab/test/assembly-destruction-render.test.ts apps/lab/test/assembly-packaging.test.ts
node tools/assembly/destruction.ts --write          # once, after the freeze commit is pushed
node tools/assembly/destruction.ts --check
node tools/assembly/destruction.ts --replay-check
node tools/assembly/observer.ts --check             # first rung untouched
pnpm typecheck && pnpm build
BL_E2E_PORT=5411 npx playwright test tests/e2e/assembly-destruction.spec.ts --project=chrome
git diff --exit-code f94bb52b568e33ec0bbe429370b1fbd3aad4ed8a -- packages/sim-ref packages/sim-gpu packages/schema packages/runner experiments docs/assembly-observer-2026-11-02 apps/coordinator
pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts      # pins untouched
```
Full `pnpm test` is run once at the end; load-sensitive timeouts in untouched suites are rerun alone and never have limits loosened. Runtime budget: `--write` under 10 minutes on a loaded machine (fixed work, no wall-clock cutoffs in the payload); whole slice under about 2 hours. Codex Sol xhigh read-only reviews: of the freeze files (before the freeze commit), and of the full diff before commit.

## 7. How to try it

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
cd /Users/nicholas/develop/browser-life-i07-destruction && pnpm install
pnpm dev -- --port 5401 --strictPort        # then open http://localhost:5401/assembly/destruction/
node tools/assembly/destruction.ts --check  # validate the saved evidence; --replay-check regenerates and compares
```
On the page: each process shows original, damaged and regrown patches with its label and the three classifier answers beside the truth label; the clip section shows the real lesion on the sim clips and says "no verdict" where the first rung found object definitions unstable. The first-rung page stays at `/assembly/`.

## 8. Non-goals and limits

- Not a life-detection claim; not the published assembly index; no combined statistic; no optimising the metric and then using it as held-out evidence.
- The truth labels and the processes are authored by us: the result shows what the observer can and cannot tell apart in a known-history toy, not that any evolving world reconstructs anything.
- Synthetic regrowth is a rule on binary patches, not a physics rule; matter and energy conservation is not modelled there (mass is counted, removal recorded). Only the clip arm uses real sim lesions, descriptive.
- No evolving-world positive case: none exists in committed fixtures (above); a later rung would need a world with a verified heritable constructive object and ablatable heredity.
- No GPU, no lab-worker or coordinator changes, no new `WorldConfig` keys, no deploy, no paid calls, no edits to frozen preregistration sections, no PR #60/#69/#130 or I01 drift.
- Open risks to review: whether `highAssembly` ceiling is stated without peeking (fixed from the first rung's published `hier-12` value only); `fresh-random` motif selection must not use the first rung's score-picking (plain random draw, K=1) to avoid the "selected by score" caveat.
