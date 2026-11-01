# I14 Predictability atlas and observer benchmark: slice plan (v2, after Sol review)

Status: PLAN stage, revised 2026-11-01 after the Codex Sol 6.1 xhigh plan review (dispositions in `REVIEW.md`). Branch `claude/i14-predictability-atlas` from `origin/main` 8d577be4. Source: "I14" and "Agent execution contract" in `docs/simulation-research-2026-11-01/report.md`; coordinator decisions D1, D3, D7. Observer and tooling only. No physics change, no model calls, no GPU, no deploy. CPU only, and every artifact says so.

## 1. Bounded question

Using only past information, how does a small set of simple predictors' loss behave on trivially predictable, noise, copy-structure, passive and ecology movies, and how much do the readings depend on frozen spatial resolution and horizon? Concretely: which cheap readouts are fooled by an incompressible random field (hard to predict, not alive) or by duplicated motifs (more cells of structure, same structure), so they can be rejected before they enter I01 or I07.

It answers a metric-validity question for a fixed small fixture set. It does not say whether any ecology is alive, open-ended or irreducible, and it assigns no capability-novelty score.

## 2. What is built (one PR)

1. **Evidence fixture with negative cases.** Naive metric: raw one-step persistence error read as "novelty". Negative case: `random-bits` has the highest raw persistence error among all binary (Q=2) fixtures, yet the frozen decision table (3.6) labels it `noise-like`, never structured. Second negative: `life-gliders-dup` (9 copies of one glider) shows exactly 9 times the error count of `life-glider` for every predictor, i.e. error scales with motif count and carries no new structure. This is an error-scaling check, not a measurement of predictive information.
2. **Small CPU path.** Pure TypeScript, integer-only, deterministic. Library in `packages/metrics/src/predictability/` (already aliased in all four maps; no new package, no alias edits).
3. **Manifest and machine-readable evidence** (3.8).
4. **Local prototype page** `apps/lab/predictability/index.html` + `apps/lab/src/predictability/{page.ts,render.ts,style.css}`, kept off the deployed site like `/spatial/`.

## 3. Design

### 3.1 Movie format and fixtures

`Movie = { id, family, w, h, q, frames: Uint8Array[] }` with values `0..q-1`. Generators use only a counter-based integer PRNG (splitmix32-style keyed on fixture seed, frame, cell; no `Math.random`, no floats). Default `T = 96` frames, `64x64` torus, fixed per fixture and listed in the manifest. The fixture matrix is fixed: there is no runtime-dependent skip (a generation failure fails the run with a diagnostic; runtime is measured outside the deterministic payload).

| id | family | q | notes |
|---|---|---|---|
| `life-block` | still life | 2 | Conway Life (own tiny integer stepper; calibration world) |
| `life-blinker`, `life-pulsar` | oscillator | 2 | periods 2 and 3 |
| `life-glider` | translating | 2 | period 4, displacement (1,1) per 4 frames |
| `life-gliders-dup` | duplicated motif | 2 | the same glider at 9 positions `{0,20,40}x{0,20,40}` (all multiples of 4, so block phase is identical at r=1,2,4); co-moving gliders never interact |
| `life-soup-early` | chaotic transient | 2 | 25% soup, Life rules |
| `random-bits` | noise | 2 | i.i.d. Bernoulli(1/2), fresh each frame |
| `random-static` | frozen noise | 2 | one random frame repeated (random in space, trivial in time) |
| `blobs-diffuse` | passive aggregate | 16 | latent integer particle counts per cell (discrete random walk on torus, total conserved exactly, asserted on the latent array); observed frame = `min(count, 15)`; saturation is documented, not hidden |
| `ecology-clip` | existing ecology | 16 | see below |

`ecology-clip` protocol (fixed in code, recorded in evidence): `presetConfig(spots, seed=1, {w:32,h:32})`, state via `initWorld(cfg, preset.init)`, `RefSim` stepping, frame k (k = 0..95) is channel `CH.B` after `4*k` steps, quantised `min(15, B >> S)` where `S` is a documented constant chosen at build time from the preset's init biomass scale before any predictor is run and never tuned afterwards. The full config, init params, seed, stride, `S` and the movie sha256 go in the manifest. Frames are copied into independent arrays. Physics is untouched; `golden-hashes.test.ts` is not edited. Ranking statements about the naive metric use only Q=2 fixtures (error rates are not comparable across alphabets); Q=16 rows are reported, not ranked against Q=2 rows.

### 3.2 Time conventions (past-only)

A forecast **origin** `t` means the predictor sees exactly `frames[0..t-1]` (t frames) and predicts the **target** frame `t+h-1`. Fit window `[0, F)` with `F = 24`. Valid origins: `t in [F, T-h]` inclusive, so targets span `[F+h-1, T-1]`. Predictors are pure functions of `frames.slice(0, t)` and parameters fitted on `frames[0..F-1]` only. All coarsening is per-frame and local (3.3), so no statistic uses future data. The past-only test perturbs raw future frames and reruns the **entire** pipeline (coarsening, fitting, prediction, loss, calibration) and asserts identical outputs for all earlier origins.

### 3.3 Frozen resolutions and horizons

`r in {1,2,4}` non-overlapping blocks aligned at offset 0 (64 and 32 divide all r). Block value = `floor((sum + floor(r*r/2)) / (r*r))` (rounded mean, ties up), no clipping needed, no fitted normalisation. Horizons `h in {1,2,4,8}`. Because coarsening changes the marginal distribution (for example fair bits become biased at r=2), **chance is never assumed to be 1/2**: the chance reference is the `marginal` baseline predictor (3.4). A (fixture, r) whose coarsened movie is constant in every frame is flagged `erased` and its skill is null (a single glider at r=4 erases).

### 3.4 Predictors (all past-only, all fitted on `[0, F)` and frozen)

- `persistence`: predict `frames[t-1]`.
- `marginal` (baseline): most frequent value in the coarsened fit window (ties to the smaller value), predicted everywhere. This is the temporal-information-free reference and doubles as the constant control.
- `best-period`: for `p in 1..16` score `x[s] ~ x[s-p]` on `s in [p, F-1]` by Hamming **error rate** (errors/pairs, compared by integer cross-multiplication because pair counts differ); pick the lowest, ties to smaller `p`; predict `x[t+h-1-p*ceil(h/p)]` (index <= t-1 by construction). On a glider this selects `p=1`; we keep that as an honest limitation of this predictor and do not require it to succeed.
- `local-stats`: **direct-horizon** tables, no rollout. For each `h`, count pairs (3x3 torus neighbourhood of frame `s-1` at a cell, value of frame `s+h-1` at the same cell) for `s in [1, F-h]`; counts get Laplace +1. Context key is an exact integer (base-q packing, safe below 2^53). Prediction at origin `t` uses the neighbourhood of frame `t-1`; argmax ties to the smaller value; an **unseen context falls back to `marginal`** with confidence `floor(1000/q)`. Confidence (per-mille, integer) = `floor(1000*(c_max+1)/(n+q))`. Never refit on the evaluation span.

### 3.5 Losses, kept separate

- **Predictive loss**: Hamming error count and scored-cell count (integers) per (fixture, predictor, r, h); rate is the exact rational. **Skill** versus a named baseline `B` is `1 - loss/loss_B` with explicit baselines `persistence` and `marginal`; reported as a rational, `null` when `loss_B = 0`, and `skillVsBest` uses `min(persistence, marginal)`.
- **Compression** (own column group, never blended): deflate length via `fflate@0.8.3` `deflateSync(.., {level: 6})` of the frame stream **bit-packed** (q=2: 8 cells/byte; q=16: 2 cells/byte) and XOR-delta coded against the previous packed frame (first frame raw). Reported as compressed bytes, packed raw bytes, and the per-mille ratio. Deflate output is library-version sensitive (cf. `packages/metrics/src/complexity.ts` note), so the evidence records the fflate version and options and pins representative sizes; low ratio is described as "resistant to deflate", never as algorithmic incompressibility.
- **Recurrence**: fraction of scored targets with an exact earlier-frame match at resolution r.
- **Calibration** (`local-stats` only): five equal bins over per-mille confidence; per-bin n, accuracy; count-weighted miscalibration as an integer-ratio. Tested against a hand-built table with known stated confidence and known realised accuracy, including a deliberately miscalibrated one.
- **Binning sensitivity**: ranked quantity = per-fixture `skillVsBest` of the reference predictor set at each r (Q=2 fixtures only; ties are non-flips); the indicator `rankFlipAcrossR` is whatever the computation returns, including `false`, and is recorded either way. The detector is unit-tested on constructed values containing a known flip and a known non-flip.
- **Deferred (explicit gaps in the evidence file)**: a surprise/false-alarm detector (no calibrated, past-only threshold and nominal rate are defined yet) and alternative bin offsets. Both need their own definitions before they would be meaningful; leaving them out is a stated limit, not an omission.

### 3.6 Frozen decision table (reference observer r=1, h=1; stated before any run)

Let `L_best` = lowest loss over the four predictors, `L_m` = `marginal` loss, `L_best^shuf` = the same under the time-shuffle control. Rules apply in order, with all comparisons by integer cross-multiplication:

1. `uninformative`: scored cells = 0, or `erased`.
2. `exact`: `L_best = 0` (includes still lifes and `random-static`, where skill is null by construction).
3. `noise-like`: `100*L_best >= 95*L_m` **and** `|L_best^shuf - L_best| <= 1/50`.
4. `partial`: everything else.

Thresholds are fixed here; if a threshold produces a counter-intuitive label in the build stage, the finding is recorded and the threshold is changed only through a dated plan amendment, never silently. Labels describe predictor behaviour on a movie. They are not claims about the substrate. Expected labels are written in the test file as literals (`life-block`, `life-blinker`, `life-pulsar`, `random-static`: `exact` (as predicted by best-period or local-stats); `random-bits`: `noise-like`; others recorded as measured, not asserted, except that `random-bits` must never be `partial` or `exact`). `copy` is a control result (3.7), not a label. There is no `structured-hard` label.

### 3.7 Controls

- **Time shuffle**: fixed-seed permutation of the whole suffix `[F, T)` (fit window untouched), then score the same valid origins on the synthetic timeline. Row-level expectations (r=1, h=1): `random-bits` and `random-static`: `|L_best^shuf - L_best| <= 1/50`; `life-blinker`, `life-pulsar`, `life-soup-early`: `L_best^shuf > L_best` strictly. Other rows and the ecology clip are reported, not gated. Zero baselines and erased rows yield `null` skill, not failure.
- **Phase shift**: origins start at `F+k` for `k in {1,3,7}` (same end); denominators reported. For `life-blinker` and `life-pulsar` the `best-period` loss at r=1 is exactly 0 at every h and k (no tolerance). Other fixtures reported.
- **Duplicated motif**: for each predictor at r in {1,2} (block-aligned), `errors(life-gliders-dup) == 9 * errors(life-glider)` exactly, and `marginal` included so the reader sees that a motion-blind constant predictor passes the same equality; the page therefore calls it error scaling.
- **Past-only**: see 3.2.

### 3.8 Evidence and provenance

`evidence.json` is a **deterministic payload** only: fixtures (sha256 of canonical movie bytes), grid, predictors, losses, controls, decision table and labels, deferred-gaps list, compression block (fflate version, options), versions (`PREDICTABILITY_VERSION`, `RULE_VERSION`, `METRICS_VERSION`), the literal statements "CPU only", "no GPU evidence", "no score here selected anything", plus `integritySha256` over the canonical payload (canonical JSON as in `tools/spatial/explore.ts`). Platform, timing and repo SHA are **not** in the payload. `manifest.json` holds the payload sha256, the sha256 of each source file the payload depends on (fixtures, predictors, losses, controls, atlas, the CLI), fixture parameter blocks, and a separate non-replayed `provenance` block (base commit `8d577be4`, tool versions, run time). Files are written once by `--write`; `--check` validates saved artifacts without simulating (seal, manifest-to-payload, source hashes match the working tree); `--replay-check` regenerates the payload and requires byte equality. Runtime: Node 24 with **relative imports only** (as in `tools/spatial/explore.ts`; `node tools/predictability/atlas.ts`), because Node does not resolve `@bl/*`. Vitest runs both checks through the exported functions and one subprocess smoke test of the CLI.

## 4. Files to add or change

Add:
- `packages/metrics/src/predictability/{movie.ts,life.ts,fixtures.ts,resolution.ts,predictors.ts,losses.ts,controls.ts,labels.ts,atlas.ts,index.ts}` (relative imports inside; about 800 lines)
- `tools/predictability/atlas.ts` (Node 24, relative imports)
- `apps/lab/predictability/index.html`, `apps/lab/src/predictability/{page.ts,render.ts,style.css}`
- `docs/predictability-atlas-2026-11-01/{evidence.json,manifest.json}` (REVIEW.md exists)
- Tests (section 5)

Change (small):
- `packages/metrics/src/index.ts`: `export * from "./predictability/index.ts";`; `PREDICTABILITY_VERSION` lives in `predictability/index.ts` (not `schema`), so `METRICS_VERSION` and golden pins are untouched.
- `apps/lab/vite.config.ts`: input `predictability` and a `predictability-core` manual chunk.
- `Dockerfile.site`: add `apps/lab/dist/predictability apps/lab/dist/assets/predictability-*.js apps/lab/dist/assets/predictability-*.css` to the removal list.
- `deploy/Caddyfile`: `@private_predictability path_regexp private_predictability (?i)^/predictability(?:/|$)` with a 404 response, next to `private_spatial`.
- `tools/test/site-image.test.ts`: not changed (its route matrix covers garden routes only; `/spatial/` is not in it either). The packaging test is the check; image checks are reported as not run unless an image is built.

Not touched: `packages/sim-ref`, `sim-gpu`, `schema` config/presets, `RULE_VERSION`, `golden-hashes.test.ts`, `defaultConfig()`, `experiments/endpoints.ts`, `experiments/preregistration.md`, `experiments/FROZEN`, coordinator, I01 (PR 130) files.

## 5. Tests (vitest, named cases, each with a stated pass condition)

`packages/metrics/test/predictability.test.ts`
- `fixtures are deterministic`: two generations give identical sha256; pinned sha256 for every fixture (version-keyed).
- `life fixtures behave as named`: block constant; blinker period 2; pulsar period 3; glider returns to its shape translated by (1,1) every 4 frames.
- `blobs conserve latent count`: latent particle total is identical across frames; observed saturation count reported.
- `random-bits resists deflate`: packed delta deflate ratio >= 990 per-mille of packed raw size; pinned sizes for two fixtures recorded with the fflate version.
- `coarsening is defined`: known inputs give known blocks including r=2 ties; fair-bit coarsening bias is demonstrated (marginal beats persistence at r=2 on `random-bits`), proving chance is not 1/2.
- `predictors give known outputs`: hand-built tiny movies with exact expected predictions for each predictor and h in {1,2,4,8} (including best-period index bounds and unseen-context fallback).
- `predictors use only the past`: full-pipeline rerun after perturbing raw frames `>= t` leaves everything at origins `<= t` bit-identical.
- `fit windows are frozen`: parameters equal when frames after F are replaced.
- `naive metric is fooled`: persistence error rate of `random-bits` exceeds every other Q=2 fixture; its label is `noise-like` and never `partial`/`exact`.
- `decision table`: expected labels as literals (3.6) and a constructed-values unit test of each rule and its precedence, independent of the stored evidence.
- `time shuffle rows`: the row expectations in 3.7.
- `phase shift rows`: blinker/pulsar best-period loss exactly 0 for k in {1,3,7}, all h.
- `duplicated motifs scale errors`: `errors(dup) == 9*errors(single)` for every predictor at r in {1,2}.
- `compression is separate`: result rows carry `loss` and `compression` as distinct objects; a runtime key check finds no blended field.
- `binning sensitivity detector`: constructed flip and non-flip.
- `calibration`: hand-built known confidence/accuracy bins; bin counts sum to scored cells.

`tools/test/predictability-evidence.test.ts`
- `evidence seal and manifest verify` (`--check` path).
- `replay reproduces byte for byte` (`--replay-check` path), plus a subprocess smoke test of `node tools/predictability/atlas.ts --check`.
- `ecology clip is a plain RefSim read`: two independently constructed twins (separate cfg objects and buffers); one is observed (frames copied out each stride), the other is plain; full physics state hash is equal at every observation boundary; copied frames stay unchanged after further steps.
- `no physics pin touched`: literal `RULE_VERSION` and literal `defaultConfig()` hash captured at build start are asserted unchanged.
- `labels follow stated rules only`: relabelling from stored raw numbers reproduces stored labels.

`apps/lab/test/predictability-packaging.test.ts` (mirrors `spatial-packaging.test.ts`)
- `keeps the predictability prototype outside the deployed site`: vite input present; `Dockerfile.site` removes `dist/predictability` and its assets; Caddy regexp matches `/predictability`, `/predictability/`, `/PREDICTABILITY/index.html`, not `/predictability-other`.
- `page text carries the caption`: "why this is not yet evidence of life" and the CPU-only sentence present.

## 6. Acceptance gates (each fails the run on failure)

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install                                   # once
set -e
pnpm vitest run packages/metrics/test/predictability.test.ts tools/test/predictability-evidence.test.ts apps/lab/test/predictability-packaging.test.ts
node tools/predictability/atlas.ts --check
node tools/predictability/atlas.ts --replay-check
pnpm typecheck
pnpm vitest run packages/sim-ref/test/golden-hashes.test.ts
pnpm test
git diff --exit-code 8d577be4 -- packages/sim-ref packages/sim-gpu packages/schema experiments/endpoints.ts experiments/preregistration.md experiments/FROZEN
pnpm build
test -e apps/lab/dist/predictability/index.html   # the page exists locally
```
A separate packaging assertion (test) checks Dockerfile.site removal and Caddy 404; image checks are reported as "not run" unless an image is built. Plus a manual browser look at `pnpm dev` `/predictability/` (all substrates render, reduced motion respected, keyboard operable, caption visible), recorded in the PR body. Read-only Sol review (`gpt-6.1-sol`, xhigh) after the build stage, findings resolved in `REVIEW.md`.

## 7. Page content and accessibility

Header "Local experiment / predictability atlas". A shared observer panel (resolution r, horizon h, predictor) with plain-language option text saying what differs. One card per fixture with a looping canvas (static frame strip when `prefers-reduced-motion`), the loss and skill for the chosen observer, and the mechanical label. A real `<table>` gives the same numbers as the canvases. Fixture provenance (what we built) is displayed separately from the metric label (what the predictors did).

Caption "Why this is not yet evidence of life", bounded wording only: independent noise can defeat temporal prediction without being alive; duplicated motifs repeat the same predictive structure rather than adding any; losses depend on the observer (resolution, horizon, predictor) and rankings across different alphabets are not comparable; deflate resistance is not algorithmic incompressibility; Life is a calibration world and does not make chemistry or energy bookkeeping unnecessary; failure of our simple predictors does not show computational irreducibility. States: CPU only, deterministic integer fixtures, no GPU evidence, not on the public site.

## 8. Non-goals and limits

- No claim about life, open-endedness, innovation or irreducibility; no capability-novelty measure; no learned or neural predictors; no model/paid calls.
- No new sim rules, no new package, no WGSL, no GPU or backend qualification (CPU only; stated in evidence, page and PR). Hosted/physical-GPU evidence: none.
- Not an I01/I07 metric: it only provides a rejection suite.
- The ecology clip is one small `spots` world and one seed; an illustration, not an ensemble result. No confirmation split exists; thresholds are fixed here before running and no score selects anything.
- Copier fixture: none found in the checkout; omitted and listed as an explicit gap.
- Surprise/false-alarm detector and alternative bin offsets are deferred (3.5). Resolutions and horizons are a small frozen grid; sensitivity is reported, not eliminated.
- No deploy, no push, no PR, no commit at the PLAN stage.

## 9. Size and order of work

About 1,000 lines of source, 600 of tests, one HTML and CSS file. Order: movie/life/fixtures with pins; resolution and predictors with known-output and past-only tests; losses; controls and decision table; atlas + CLI + evidence; page; packaging edits and test. Each step keeps tests green. If scope must shrink, cut in this order: ecology calibration bins display, recurrence column, page canvases to a static strip.
