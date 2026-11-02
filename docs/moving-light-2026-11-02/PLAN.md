# I08 Collective sensing under moving light: first rung (slice plan v2, after Codex plan review)

Status: PLAN REVIEW stage done, 2026-11-02 (v2; dispositions in `REVIEW.md`). Provenance note: the coordinator log in this checkout ends at D14; D15 cited in the scope is absent here, so only D14 is verifiable. Branch `claude/i08-moving-light` from `origin/main` c4b16ccd. Sources: "I08" and "Agent execution contract" in `docs/simulation-research-2026-11-01/report.md`; decisions D14, D15 in `docs/backlog-run-2026-11-01.html`. Exploratory, CPU only (`sim-ref`), mutation off, no physics change, no model calls, no GPU, no deploy. Template followed: the I06 slice (`docs/niche-construction-2026-11-01/`, `packages/runner/src/niche/`, `tools/niche/niche.ts`, `apps/lab/niche/`).

## 1. Bounded question

In small `sim-ref` worlds with mutation off, under a sun whose meridian moves in a way the population was not tuned for, does local interaction (the existing signal field read through `signalGain`) raise realised light capture per audited input energy or reduce tracking error for a **grouped** inoculum, beyond what the **same bodies, in the same tile, with the same resource competition, achieve when dispersed**? Sub-questions: (a) grouped vs dispersed, (b) signal strategy vs the information-free movement-capable ablation, (c) motility on vs off, (d) blind drifters (fixed heading) as the hard-coded comparator.

Positive answer: "a group-level interaction benefit is supported in this panel, world size, horizon and schedule set". Negative: "no interaction benefit detected here". It does not say sensing cannot help elsewhere, does not test evolution (mutation off), does not claim a new flocking mechanism, and does not separate emission cost from information (section 4.2). Schooling appearance alone is never a pass. Composition-follows-benefit (a transferred group state) is explicitly **deferred**, not claimed.

## 2. What is built (one PR)

1. **Evidence fixture with a negative case that fools the naive metric** (section 5). Naive metric: "bodies in the group move together and stay near the sun" (pairwise displacement alignment, tracking lag of the group centroid). Negative fixtures: `common-forcing` (synthetic tracks: every agent follows the same sun path plus independent integer noise; no coupling) and `blind-drifters-physical` (planet-followers genome, `signalGain` unused, grouped in `sim-ref`): the naive metric reads "collective motion", the residual against the dispersed (same-competition) arm exposed to the same sun is zero within noise and the decision function rejects it. Positive fixtures: `coupled-synthetic` (explicit neighbour-mean coupling, residual clearly above the floor) and `null-world` (identical arms, effect exactly zero).
2. **Small CPU path.** A read-only observer, arm construction on `RefSim`, a patch and placement builder (grouped vs dispersed, same bodies), a decision function and evidence sealing, in `packages/runner/src/movinglight/` (no new package, so no alias-map edits; the tool resolves `@bl/*` with the same `registerHooks` shim as `tools/niche/niche.ts`). Instrumented vs plain twin test shows the observer does not change physics.
3. **Manifest and machine-readable evidence.** `docs/moving-light-2026-11-02/{protocol.lock.json,calibration.json,evidence.json,manifest.json}` with `--bench / --calibrate / --freeze / --write / --check / --replay-check`.
4. **Local prototype page** `apps/lab/moving-light/index.html`, kept off the deployed site like `/niche/` (vite entry, Dockerfile.site rm list, Caddyfile 404 route, packaging test). Reads `evidence.json` only; runs no simulation.
5. Docs: this PLAN, `REVIEW.md` (Codex dispositions), `EVIDENCE.md` (human result, written after the run).

## 3. Reuse, and what the existing keys can and cannot express

Reuse, unchanged: `sweep` light mode, `dayPeriod`, `wanderPeriod`, `wanderAmp`, `signalGain`, `kSDecay` (config.ts); `generalistGenome`, `sunFollowerGenome` (blind east drifter), `darkFleeGenome` (sensing follower); `followerWorld`/`threeWayWorld` placement style (presets.ts); `buildWorld`, `allocState`, `validateState`, `totalsOf`, `ledgerResidual`, `stateHash`, `lowbias32`, `canonicalJSON`, `sha256HexJS` (@bl/schema); `RefSim` (`light(x,y,step)` public, ground truth for the sun). No new `WorldConfig` key; none enters `defaultConfig()`; `RULE_VERSION` and golden pins untouched.

Schedules, config values only. The sun path is a **staircase** (step.ts floors rotation, quantises wander phase to 512 bins, floors amplitude scaling), so every schedule is frozen as an **exact integer meridian path `m(t)`** recorded by the schedule module and tested; "speed" in this plan is nominal, and the realised mean speed, first-move step and turning step are reported per schedule. Only the schedules below are in this rung.

| Schedule | Keys | Note |
|---|---|---|
| fixed (screening) | `dayPeriod = P` | eastward staircase, nominal speed W/P |
| paused (matched static control) | `dayPeriod = 0`, no wander | meridian at x = 0; inocula placed relative to it in every schedule |
| wandering | `dayPeriod = 0`, `wanderPeriod = WP`, `wanderAmp = A` | triangle east then west; `A` is a design choice (the presets use `A` above `tileW`, so no `A <= tileW` refusal; the protocol checks that the realised path has a distinct eastward and westward leg of at least k steps) |
| reversed | same keys as wandering | scored on the post-turn window only, with the pre-turn state recorded (section 4.3) |

Dropped from this rung: rotation+wander (nominal speeds alternate between 2v and 0 under matching, so it is not speed-matched; deferred).

**Gaps recorded, not worked around.** (G1) A westward constant-speed rotation from t=0 is not expressible (`dayPeriod` unsigned); reversal is a mid-run turn of the wander triangle. (G2) No live sun reversal/pause on a displayed world: the live `sun` intervention scales brightness only and preserves phase (schema `sun.ts`, lab `protocol.ts`). A visitor-driven reverse/pause of an existing world is therefore **deferred**, and the page is a labelled replay of precomputed branches (section 7). No key is added to close any gap.

## 4. Design

### 4.1 Worlds, windows and cost gate

Single tile, small (starting point 24 x 16 to 32 x 24, `lightMode: "sweep"`, `lightBase 20`, `lightAmp 220`, `signalGain 127`, `kSDecay 13`, `mutRate 0`, no season). Sun speed: the blind drifter moves 1/64 cell per step; the main screen uses `P` so that the realised mean sun speed is about 1.5x the drifter's (the 11000 * W / 256 scaling gives about 1.49x; the realised ratio is reported), and a matched-heading control uses the drifter's own speed.

Exact windows, frozen in the protocol: `warmup [0, T0)` unscored (inoculum settles); `scored [T0, T)`; for the reversed schedule `scored-post = [Tturn, T)` where `Tturn` is the realised turning step. Every scored quantity is an **increment over its window** (ledger counters at the window end minus at its start), never a final inventory. Census every `c` steps. The pre-turn state and inventories at `Tturn` are recorded and reported as the pre-turn part; the reversal verdict uses only post-turn increments, so advantage carried across the turn is not credited as reversal performance.

**Cost gate (pre-freeze stop).** The workload is enumerated in the protocol: worlds = arms x 2 placements x seeds x schedules, steps per world, projected seconds = total steps / measured steps-per-second at the chosen grid and kernel radius / worker processes (the tool starts at most two). Only `--write` and its projection are held to the 10-minute target; `--replay-check` replays a frozen subset (2 seed blocks, at most 2 minutes). Frozen reduction ladder, applied before any fresh run and recorded in `calibration.json`: smaller grid, shorter horizon, drop transfer schedules to {paused, reversed}, drop `still`/`sense-nomot` from transfer. If the projection still exceeds 10 minutes the stage stops before freeze and reports; limits are not loosened.

### 4.2 Arms and placements

n bodies per inoculum (n fixed in the protocol, 4 to 6). **Body patches are built once** (biomass, energy, lineage id, genome id, from `buildWorld` with a fixed seed), audited (actual B and E totals recorded), and **copied by torus translation** into every arm and placement, so identical bodies and input budgets hold by construction. Rebuilding a body as a sole founder (which changes its founder index, lineage and random biomass) is not used. Replicate-noise runs clone the same patches and change only the engine seed.

Genomes (existing fields only; `arms.ts` lists each edit with a hash):
- `sense`: darkFlee as is (emission plus signal-gradient motility).
- `sense-nosig`: darkFlee with EMIT bias and weights zeroed, motility wiring kept: the movement-capable **information-free** comparator.
- `sense-nomot`: darkFlee with motility gain 0 (emission on, no movement).
- `drift`: `sunFollowerGenome`.
- `still`: generalist, motility 0.
`sense-costed-null` is dropped: it differed from `sense` in movement as well as emission, and from `sense-nomot` it added nothing. The plan does **not** attribute any difference to "information alone": `sense` vs `sense-nosig` is the total strategy effect (emit + read + their costs). Actual emission and work expenditure per arm are reported where the ledger exposes them, as a covariate, not a correction.

Placements (same total bodies, same tile, same competition):
- `grouped`: n patches in one compact cluster, centred at offset `o` from the t=0 meridian.
- `dispersed`: the same n patches at maximal spacing along the tile with the same offsets distribution relative to the t=0 meridian. Called "dispersed", not "isolated": signal diffuses and decays stochastically (`kSDecay 13` is about a 5,000-step scale, comparable to the horizon), so no spacing gives a finite cutoff. The protocol defines an operational cross-talk threshold from a probe (emit-only world, foreign-body signal mass at a body's neighbourhood at the horizon, versus a frozen fraction of own signal) and each dispersed run reports its measured cross-talk. A run above the threshold is flagged and the claim stays "dispersed".
- `solo-i` (single body at its grouped position, no competitors) is a **descriptive baseline only**, run in calibration and fixtures, never in the run of record and never in a decision rule: it confounds crowding (shared nutrient field, polymer diffusion, density-dependent catalysis) with interaction.

Run-of-record arms: {sense, sense-nosig, sense-nomot, drift, still} x {grouped, dispersed}.

### 4.3 Readouts (observer-side, integer or rational, `movinglight-metrics-v1`)

The observer reads cell arrays and the ledger at census steps; it does not touch physics. The meridian `m(t)` is the recorded exact integer path; a test checks it equals the argmax of `RefSim.light(x, *, t)` for every schedule.
- **Realised light capture per input energy (primary capture readout):** scored-window increment of the ledger's `lightIn` (actual photosynthetic input) divided by the audited inoculum input energy of that arm. `lightIn` is **not** arm-independent (it depends on biomass, controller output, light and nutrient); the earlier claim is retracted. Reported separately and never primary: occupied-cell **exposure** (opportunity; rewards spreading), and the biomass inventory change (can come from initial free energy). If `lightIn` is not readable at census, that is recorded as a gap at bench and the readout becomes the biomass-increment with exposure as covariate.
- **Tracking, three separate quantities:** (1) *signed bias*: biomass-weighted mean of signed circular distance `d` to `m(t)` (`d` in `(-W/2, W/2]`); (2) *absolute circular tracking error* (primary tracking readout): biomass-weighted mean `|d|`, so opposite-side bodies do not cancel; (3) *temporal response lag*: causal and fit-free: at each census, the elapsed time since the meridian last stood at the body centroid's cell (a lookup into the frozen `m(t)` path), averaged over the window; undefined when the centroid never coincided and then reported `unavailable`.
- **Cohesion:** circular variance of `d` around an explicit unwrapped centre (the biomass-weighted mean of offsets taken from the heaviest cell, wrapped to `(-W/2, W/2]`); `unavailable` if mass spans more than W/2. Also the fraction of biomass within a fixed radius of that centre.
- **Survival:** surviving biomass fraction and extinction flag. An extinct arm keeps its **actual terminal outcome** (zero biomass, its realised gain) in every block; it is never dropped or censored from gain and survival.
- **Residual coordination (key control):** per interval and body pair (both lineages alive at both interval ends), the covariance of the idiosyncratic displacement `(dx_i - dm)` and `(dx_j - dm)`, where `dm` is the sun's recorded displacement for that interval; the arm statistic is the mean over pairs and intervals, an exact rational. Sun-driven common forcing cancels by construction. Residual = grouped statistic minus the **dispersed** statistic for the same genome and seed block (same competition); solo is secondary and descriptive. Sign agreement is not used (it saturates at 1 under common forcing). Unavailable (not zero) when no pair exists; pair counts reported.
- **Lineage displacement is not locomotion.** Affinity flow, spreading, differential growth and the transport lineage lottery all move lineage centroids without active motility. The coordination readout is therefore accompanied by `still`/`sense-nomot` arms (no active motility) that must give a residual within the floor; fixtures cover stationary growth and label takeover (section 5).

### 4.4 Cross-checks

Conservation: `ledgerResidual` zero at every census for every world. Replay: same seed and patches, same bytes (`stateHash` pinned). Plain vs instrumented twin: identical `stateHash` sequence. Patch audit: actual B/E totals equal across placements and arms of a genome.

## 5. Fixtures (built before any search or fresh run)

| Fixture | Construction | Naive metric says | Decision must say |
|---|---|---|---|
| `common-forcing` | synthetic tracks: sun path plus independent integer noise, no coupling | strong alignment, low lag | residual covariance ~0 (inside floor); `unsupported-within-tested-domain` |
| `blind-drifters-physical` | `drift` grouped vs dispersed in sim-ref | high alignment, low lag when speed matched | `B_sense - B_drift` inside floor; `unsupported` |
| `crowding-physical` | `sense-nosig`/`still` grouped vs dispersed in sim-ref: crowding changes growth and cohesion with no useful signalling | grouped differs from dispersed | difference-in-differences against the information-free comparator rejects; `unsupported` |
| `stationary-growth` | `still` grouped: lineage centroids shift by growth/transport | apparent motion | residual within floor; `unsupported` |
| `label-takeover` | synthetic: lineage tags change hands with no displacement of material | apparent displacement | pairs excluded or residual within floor |
| `coupled-synthetic` | agents steer toward neighbour mean plus the sun path | strong alignment | residual above floor; `coordination-detected` (a readout label, not the scientific label) |
| `planted-benefit` | synthetic block table with a planted positive B, drift unaffected, paused zero | n/a | the **complete** decision function returns `supported`; the same table with B planted in paused too returns `inconclusive-confounded` |
| `null-world` | two identical arms | zero | exactly zero; `unsupported` |
| `static-sun` | paused, `still` grouped | no motion | coordination `unavailable`, never 0 |

The naive metric (pairwise sign agreement and centroid lag) is computed beside the residual in every fixture and in the main evidence so the page can show both.

## 6. Pre-stated decision rules (frozen in `protocol.lock.json` before the fresh run)

- Independent unit: the seed block (one seed gives all arms and all schedules of that block).
- Seeds: dev (calibration only) `8700001-8700004`; replicate-noise `8700201-8700204` (same patches, different engine seeds); fixture `8700401-8700408`; fresh confirmation `8700501-8700508`, never used to tune anything. Range `8700001-8700999` is free and unreserved in `experiments/discovery/seed-registry.json` (verified); the slice adds the reservation. I06 ends at 8600999.
- Calibration (dev and noise seeds only) fixes: n, grid, `P`/`WP`/`A`, windows, cadence, the cross-talk threshold, and the floors: `delta_cap` = the maximum absolute difference-in-differences across the four replicate-noise seeds for identical-arm pairs, `delta_res` = the same for the residual coordination statistic. Floors come from noise seeds only. If `sense` shows no tracking on dev at the matched speed the screen is `unsupported-measurement`, not "no benefit".
- Contrasts, with G = grouped, D = dispersed, `c(a)` = realised light capture per audited input energy of arm a in a block:
  - `S = c(sense,G) - c(sense,D)` (raw sensing placement effect),
  - `N = c(sense-nosig,G) - c(sense-nosig,D)` (information-free comparator),
  - `V = c(drift,G) - c(drift,D)` (hard-coded heading),
  - `B = S - N` (difference in differences), and `B_drift = S - V`.
  Both comparators are separate contrasts (not averaged); **all** must pass.
- Screening (fixed sun, 8 fresh blocks), supported only if all hold: (i) `S > 0` and `B > 0` each in at least 7 of 8 blocks (exact one-sided sign test, 7 of 8 gives p = 9/256 below 1/20; zeros count as not positive); (ii) median `S` and median `B` each above `delta_cap`; (iii) a deterministic paired bootstrap (resampling blocks with `lowbias32`, 2000 draws, frozen) 90% lower bound of median `B` above 0; (iv) residual coordination above `delta_res` in at least 6 of 8 blocks where available, with `still`/`sense-nomot` residual inside `delta_res`; (v) grouped `sense` survival not below dispersed `sense` survival minus a frozen margin; (vi) median `B_drift > delta_cap`.
- Transfer: the **same eight fresh blocks** run every schedule in one joint confirmation, with the complete contrast family and all controls for each schedule frozen after dev screening (no subset chosen from fresh results, no rescreening driven by transfer). The benefit must persist (criteria (i)-(iii) on post-turn increments) under reversed and wandering; `paused` is the matched static control with `|B| <= delta_cap` (else `inconclusive-confounded`).
- Labels: `supported`, `unsupported-within-tested-domain`, `inconclusive-confounded` (paused control shows a benefit, or comparator contrasts disagree), `inconclusive` (neither pass nor fail by the rules, including ties), `invalid-or-incomplete` (conservation fails, patch audit fails, or engine data missing for more than 1 of 8 blocks), `unsupported-measurement`. Extinction is not missing data. Coordination `unavailable` in more than 2 of 8 blocks makes criterion (iv) fail, not drop.
- Uncertainty is reported for every contrast (bootstrap interval plus exact sign-test p). One run of record on fresh seeds after the freeze; no override; failed blocks are in evidence.

## 7. Prototype page (`/moving-light/`, local, noindex)

Honest framing first: the page **replays** precomputed CPU runs and runs no physics (G2). The requested "reverse/pause the sun in an existing world" is **deferred**: a schedule selector switches among independent precomputed runs (fixed, paused, wandering, reversed) with a plain label saying each is a whole separate history, not an intervention on the displayed state. Contents: an SVG strip of the tile with the meridian and body centroids over time (scrubber, reduced-motion safe, keyboard operable); four panels for the strategies under **blinded labels** A-D (a fixed frozen permutation of sense / sense-nosig / drift / still; a "Reveal" button shows true names; reveal state is not persisted); per-panel numbers (capture per input energy, absolute tracking error, survival); the naive vs residual coordination table with the `common-forcing` and `crowding-physical` fixtures above the fold; the verdict from the pre-stated rules; the limits list. Plain-language captions for every selector. The page reads `docs/moving-light-2026-11-02/evidence.json` via JSON import, as the niche page does.

## 8. Files

Add:
- `packages/runner/src/movinglight/{index,protocol,schedule,arms,observe,coordination,fixtures,decision,evidence}.ts`
- `packages/runner/test/movinglight-{schedule,observe,arms,coordination,fixtures,decision,evidence}.test.ts` (placement is `dispersed`, not `solo-i`, in the run of record), `packages/runner/test/movinglight-helpers.ts`
- `tools/movinglight/movinglight.ts`; `tools/test/movinglight-evidence.test.ts`
- `apps/lab/moving-light/index.html`, `apps/lab/src/moving-light/{page,render,style}.ts|css`, `apps/lab/test/moving-light-{render,packaging}.test.ts`
- `docs/moving-light-2026-11-02/{PLAN.md,REVIEW.md,protocol.lock.json,calibration.json,evidence.json,manifest.json,EVIDENCE.md}`

Change (small): `apps/lab/vite.config.ts` (one entry), `Dockerfile.site` (rm list adds `apps/lab/dist/moving-light` and its assets), `deploy/Caddyfile` (private route 404), `experiments/discovery/seed-registry.json` (one reservation). `packages/runner/src/index.ts` is not changed (the tool and tests import the module path directly, as niche does). Nothing in `packages/schema`, `packages/sim-ref`, `packages/sim-gpu`, `docs/rules.md` or the preregistration.

## 9. Tests (named cases)

- `movinglight-schedule`: `meridian equals RefSim.light argmax for fixed, paused, wandering` ; `realised integer path frozen, first-move, turn step and realised speed ratio reported` ; `reversed schedule has eastward and westward legs of at least k steps` ; `scored-post window starts at the realised turn` ; `no new WorldConfig key and defaultConfig hash unchanged`.
- `movinglight-observe`: `signed circular distance is exact at the wrap` ; `absolute error is nonzero for bodies at -8 and +8` ; `cohesion is continuous across the circular seam` ; `temporal lag is causal and unavailable when never coincident` ; `capture uses scored-window lightIn increments` ; `instrumented twin has the same stateHash sequence as plain` ; `conservation residual zero at every census`.
- `movinglight-arms`: `genome edits touch only the listed weights and hash stably` ; `sense-nosig emits nothing and still moves, sense-nomot emits and does not move` ; `patches are copied by translation with identical lineage ids and audited B/E` ; `dispersed cross-talk is measured and flagged above threshold` ; `grouped and dispersed share offsets from the t=0 meridian` ; `replicate-noise runs clone patches` ; `equal audited input energy across placements`.
- `movinglight-coordination`: `common forcing raises naive alignment in group and dispersed set equally and gives covariance ~0` ; `coupled agents give a residual above the floor` ; `static sun gives unavailable not zero` ; `zero-displacement and missing-lineage pairs are handled and pair counts reported`.
- `movinglight-fixtures`: `common-forcing is rejected while naive metric passes` ; `blind-drifters-physical is rejected` ; `crowding-physical is rejected` ; `stationary-growth and label-takeover are rejected` ; `coupled-synthetic is coordination-detected` ; `planted-benefit gives supported through the full decision` ; `null-world is exactly zero`.
- `movinglight-decision`: `needs raw S, B, sign test, delta floor, bootstrap bound, residual, survival and B_drift all together` ; `positive B with negative S is not supported` ; `7 of 8 gives p = 9/256` ; `zeros count as not positive` ; `extinct arms keep terminal outcomes and blocks are not dropped` ; `paused control with a benefit gives inconclusive-confounded` ; `floors come from noise seeds only`.
- `movinglight-evidence`: `canonical JSON refuses floats` ; `evidence payload hash equals manifest` ; `lock before write is required` ; `replay regenerates byte-equal evidence` (small panel).
- `tools/test/movinglight-evidence.test.ts`: `--check passes on saved artifacts` ; `--check fails on a tampered evidence byte` ; `--replay-check on the saved panel`.
- `apps/lab/test/moving-light-render.test.ts`: `blinded labels hide names until reveal` ; `naive and residual both rendered with the fixture rejection` ; `schedule switch changes the strip data` ; `escapes evidence strings`. `moving-light-packaging.test.ts`: as the niche test (vite entry, Dockerfile rm, Caddy 404 regex, caption, noindex, self-contained asset graph).

## 10. Acceptance gates (runnable)

```
export PATH=$HOME/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install --frozen-lockfile
pnpm typecheck
pnpm vitest run --maxWorkers=2 packages/runner/test/movinglight-*.test.ts tools/test/movinglight-evidence.test.ts apps/lab/test/moving-light-*.test.ts
pnpm vitest run --maxWorkers=2 packages/sim-ref/test/golden-hashes.test.ts packages/schema/test    # pins and defaultConfig untouched
node tools/movinglight/movinglight.ts --bench          # informational runtime projection
node tools/movinglight/movinglight.ts --calibrate      # dev seeds only
node tools/movinglight/movinglight.ts --freeze         # then commit and push the freeze files BEFORE --write
node tools/movinglight/movinglight.ts --write
node tools/movinglight/movinglight.ts --check
node tools/movinglight/movinglight.ts --replay-check
pnpm test -- --maxWorkers=2                            # full suite before the final commit
```
G1 the bench projection is a pre-freeze stop gate: full `--write` projected under about 10 minutes with at most two worker processes (`--maxWorkers=2` bounds Vitest only, so the tool enforces its own two-process cap); `--replay-check` on a frozen 2-block subset under about 2 minutes; over-target stops the stage and is reported, limits are not loosened. G2 `git diff` shows no change under `packages/schema`, `packages/sim-ref`, `packages/sim-gpu`. G3 every fixture and the saved evidence verify. G4 the freeze commit contains only `protocol.lock.json`, `PLAN.md`, `REVIEW.md` (plan review), the protocol/source files and seed registry; no outcome file; pushed to `origin/claude/i08-moving-light` before `--write`. G5 Codex (gpt-6.1-sol, xhigh, read-only) reviews the plan before freeze and the source plus evidence before commit; P1/P2 resolved or recorded in REVIEW.md.

## 11. Non-goals and limits

- No new physics, no Boids-like alignment actuator (a later rule fork only if this rung shows a gap an actuator would close), no new `WorldConfig` key, no GPU evidence (CPU only, stated), no evolution (mutation off), no paid calls, no deploy, no edit of the frozen preregistration.
- Small worlds, short horizons: results do not transfer to the 256 x 256 planet presets or to open-ended evolution.
- Reversal is a wander turning point (G1); a live reverse-the-sun control on physics is not available (G2); a public world is out of scope, only a local replay page.
- Capture is the realised `lightIn` increment per audited input energy; exposure and biomass change are covariates. Exposure differences across arms are reported, not corrected away.
- Signal cost and information are not separated: `sense` vs `sense-nosig` is a total strategy effect. Composition transfer is deferred. Solo baselines are descriptive only.
- Calibration may find the assay insensitive; then the label is `unsupported-measurement`, not "no benefit".
- One PR of reviewable size: about 9 source files of a few hundred lines each, the tool, the page, seven test files, and generated evidence. If the cost gate forces cuts, the page and transfer schedules shrink before the screen does.
