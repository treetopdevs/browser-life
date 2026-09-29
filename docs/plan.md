# Plan: An Open-Ended Ecology in the Browser

*September 25, 2026. Builds on `life_like_systems_edited.md` (the report) and `browser_artificial_life_addendum.md` (the addendum). The addendum's three milestones are the first 40% of this plan; this document sets the goal they lead to.*

## North star

> **Across ≥100 independent browser-hosted histories, a world that is closed in matter and open in energy produces, without being told to: (1) self-maintaining individuals, (2) heritable reproduction by fission, (3) a recycling ecology with ≥3 functionally distinct trophic roles, and (4) at least one major transition: a collective that reproduces as a unit through a bottleneck. Held-out complexity measures must rise above neutral and ablation controls, with no saturation detected over the observation window.**

This combines three of the report's hardest open problems into one falsifiable target:

- **Ecological closure** (open problem 7): producers, consumers and decomposers that recycle each other's waste.
- **Emergent individuality** (open problem 2): no `reproduce()`, no `Organism` class. Individuals, parents and offspring are *inferred* from the dynamics.
- **Major transitions** (the report's "particularly strong positive result"): a new reproducing unit at a higher level.

The plan is built so that **failure is informative**. If the system plateaus, as Bedau found in earlier systems, a well-controlled ensemble that records *where* it plateaued and *which ablation* caused it is still a real result.

## Six design decisions that make it ambitious (and tractable)

### 1. Matter closed, energy open (like Earth)
Total matter is fixed and exactly conserved. Energy enters as a light field (spatially and temporally varying) and leaves as exported heat. There is no external food replenishment, so waste *must* be recycled or everything stalls. This makes decomposers and nutrient cycling selectively favored rather than scripted, and gives the "anti-entropy" framing an honest physical shape: local organization is paid for by energy throughput and heat export.

### 2. Exact integer physics
Mass is stored as `u32` quanta and controllers run in fixed-point `i32`. Transport is gather-based: each cell recomputes, deterministically, what each neighbor sends it, with rounding remainders assigned to the source. Consequences:
- The conservation residual is **exactly zero**, not "small".
- Runs are **bitwise-replayable across GPUs**. f32 cannot promise this; integer WGSL can.
- Distributed runs become **verifiable**: the coordinator can spot-check any volunteer's segment by replaying it (see §7).

### 3. Heredity rides on matter (the Flow-Lenia move)
Every cell carries a genome vector that is advected with its mass. When mass from several sources merges into one cell, the resulting genome is chosen by mass-weighted lottery using a counter-based PRNG keyed on `(seed, step, cell)`. Mutation happens at copy time with a fixed per-quantum rate. Each genome also carries a `u32` lineage ID; a mutation mints a new ID and appends a birth event to a GPU event buffer. *As implemented (RULE_VERSION 1), mutation happens when biomass is synthesised, not when it moves, and the lineage ID takes two words; see "Plan versus implementation" under "M4 pivot: foundations review".*

### 4. The genome is a developmental program, not a parameter list
The genome holds the weights of a small fixed-topology local network (about 12 sensors → 8 hidden → 8 actuators, fixed-point). It reads local chemistry, gradients, signals and its own state channels. Actuators: catalysis rate for each reaction, flow bias (motility), adhesion, signal secretion, and deposition of structural polymer (a membrane). Evolvability features are built in from the start: modular per-reaction weight blocks, silent slots available for neutral drift, and a duplication mutation that copies one module into a silent slot. *Not implemented in RULE_VERSION 1. The controller is 10 → 8 → 8 with no adhesion output, and there are no module blocks, silent slots or duplication mutation; see "Plan versus implementation" under "M4 pivot: foundations review".*

### 5. A chemistry whose loops are open but not scripted
Start with about five species (roughly `A`, `B`, `C`, a structural polymer `P`, and signal `S`). Each species has a potential energy, and every reaction balances matter + energy + heat:

| Reaction | Energy | Role it *permits* (not assigns) |
|---|---|---|
| `A + light → B` | stores energy | producer |
| `B → C + work` | releases | consumer |
| `C → A + work` (slow unless catalyzed) | releases a little | decomposer |
| `B → P` | costs | builds membrane/structure |
| `P → C` | decays | makes maintenance necessary (autopoiesis) |

Which reactions a cell catalyzes, and how strongly, is entirely genomic. Catalysis costs work, so a lineage that catalyzes everything pays for it. This is still *abstract* energy accounting, not calibrated thermodynamics. Report it as "resource-accounting entropy" per the report.

### 6. Individuality is detected, never declared
A GPU label-propagation pass finds connected biomass components, bounded by membranes and grouped by genome similarity. It tracks them across frames. A **fission** (one component becoming two viable components with shared lineage) is recorded as reproduction. The same machinery runs one level up. Components linked by adhesion or signaling form *collectives*, and a collective that fissions into collectives, each regrowing the parent's composition from a small propagule, is a candidate **major transition**.

### 7. An archipelago of browsers
Each browser tab is an **island** running an independent world. A lightweight Phoenix coordinator (it fits your Elixir interests, and the dense compute stays in WGSL as the addendum advises) does four things:
- Assigns **run manifests**: seed, condition (treatment or one of the controls, randomized and blinded in the UI), rule version, and environment regime.
- Exchanges **migration packets** (small patches of matter and genomes, schema-validated, data only) between islands of the same metapopulation. This creates stepping stones and gene flow.
- Collects metric streams, event logs and periodic checkpoints.
- **Verifies** by assigning a random fraction of segments to a second browser for replay and comparing state hashes, which is only possible because of §2.

Later, the coordinator can generate island environments POET-style: mutate the light and cycle regimes and keep environments where life persists under strain. That selection signal never touches the held-out metrics.

## Measurement: pre-registered, held out, controlled

Freeze `experiments/preregistration.md` and commit its hash **before** any M4+ ensemble runs. It fixes the metrics, thresholds, controls, observation window and analysis code.

**Metric vector** (recorded separately, never collapsed into one score):
- *Thermo/resource:* energy in, heat out, stored chemical energy, matter-cycling index (Finn's cycling index over the species flux network).
- *Information:* compression ratio **and** predictive-information estimate on coarse-grained fields, always reported together.
- *Structure:* components, membrane-bounded compartments, nesting depth, differentiation (distinct cell states within one individual).
- *Robustness:* automated lesion battery (remove 10/30/50%), obstacle and light-shift perturbations, recovery probability and time.
- *Evolution:* Bedau evolutionary-activity statistics against a **neutral shadow** (identical run whose lineage labels are reassigned at random), phylogenetic depth, innovation rate.
- *Ecology:* trophic-role clustering from each lineage's reaction-flux profile, interaction network (who consumes whose output), coexistence time.
- *Multilevel:* collective-level heritability (parent/offspring collective composition correlation), bottleneck size, and fitness decoupling between levels.

**Probability gates** (decided 2026-09-27, before the freeze; applies to every gate after M3): every per-seed probability a gate tests, such as "recovers with p > 0.8" or "dies without light", is measured on **32 fresh-seed replicates** and passes when its **one-sided 95% Clopper–Pearson lower bound** exceeds the threshold. For p > 0.8 that is 30 or more of 32, so a couple of failures are tolerated while chance passes stay rare (`passesProbabilityGate` in `packages/metrics`). An observed rate over 16 replicates admits chance passes; a lower bound over 16, or "all replicates", demands a perfect score. Under this rule the M3 test requires survival, regeneration after a 30% lesion and death without light each to clear 0.8 (`tools/retest.ts`).

**Horizon, independence and adhesion** (decided 2026-09-27, before the freeze, after seeing only the neutral calibration pilot):
- *Horizon.* The registered ensemble runs 10⁶ steps, the horizon the frozen activity thresholds were calibrated at; analysis refuses a threshold for any other schedule. The M4 gate is amended from 10⁷ to that horizon. A 10⁷ run costs about 2.8 hours (the ensemble about 450 GPU-hours and a new pilot about 110), and the 10⁶ threshold cannot be carried over without an argument made after the fact. The longer window is kept as a registered secondary extension (see the pre-registration, "Secondary analyses"), descriptive rather than confirmatory.
- *Independence.* Migrating rings exchange cells between runs, so their members are not independent. They are excluded from the primary ensemble and from M6's 100 histories; any ring analysis is registered separately and treats a whole ring as one unit.
- *Adhesion.* `WorldConfig.adhesion` stays off in every registered ensemble run. Enabling it changes the physics and so the preset identities, which would invalidate the frozen thresholds; M7 is registered separately.

**Held out:** at least one-third of these, including ecology, multilevel and predictive information, are never used by the bootstrap search or the environment generator.

### Gate calibration

`tools/nullcal.ts` measures how often the pre-registered primary endpoints and held-out directional observables (`experiments/endpoints.ts`) pass on data generated by processes known to be bounded / non-open-ended, through the *unmodified* `analyzeEnsemble` function `tools/analyze.ts` also uses for real runs (no reimplementation, no subprocess: `nullcal.ts` builds `Run[]` in memory and calls it directly). Four exchangeable (condition-fair) null generators (`tools/lib/nullgen.ts`): a slow-periodic fixed lineage alphabet (`longPeriodLoop`), a neutral Moran process (`neutralDrift`), a saturating rise (`saturatingProcess`), and a boundary-reflected random walk driving Poisson lineage introductions (`randomWalkNoise`). A fifth, explicitly separate scenario, `boundedTreatmentVsFlat`, is a real but bounded treatment/control difference, not a null — reported separately, never in the false-positive tally.

Every nullcal trial reuses the registered `gradient-m3` preset id purely for its endpoint/held-out-control wiring; it is not a real gradient-m3 bundle, so it has none of that preset's calibration-pilot provenance. Since the activity threshold was frozen (2026-09-27), `analyzeEnsemble` therefore always calls with `ignoreFrozenThreshold: true` for these synthetic ensembles, which keeps the threshold at this ensemble's own neutral condition's in-sample 95th-percentile activity — the same computation nullcal always used, before any threshold was ever frozen — rather than refusing on missing provenance or silently mixing synthetic activity with a threshold calibrated from real simulation data.

Run: `deno run -A tools/nullcal.ts --windows 1e5,1e6 --replicates 32 --seeds-per-condition 20 --out runs/nullcal/<label>` (fresh `--out` each run; extending a sweep means rerunning with more `--replicates`, which is deterministic).

**Results (real, measured — 32 replicates/window, 20 seeds/condition, `censusEvery=100`/`deepEvery=10`, 2870.9s total / 8.97s per trial, 320 trials):** at 1e5, every `PRIMARY_ENDPOINTS`/held-out row is 0/32 across all four nulls except `saturatingProcess`'s `unbounded-growth` (3/32, 95% CI [0.02, 0.25]). At 1e6, every row is 0/32 except `saturatingProcess`'s `unbounded-growth` again (3/32, [0.02, 0.25]) and `longPeriodLoop`'s `ecological-closure-recycling` (1/32, [0.00, 0.16]) — the latter consistent with the endpoint's α = 0.01 (P(≥1 of 32 | p=0.01) ≈ 0.28); the former is a finite-window effect — see limitation (d). `ecological-closure-coexistence` (and its `.gate` row) is unavailable at 1e5 for every null (a 1e5-step window can't observe its own 1e5-step `minSteps`) and passes **32/32** at 1e6 for every null — correctly, since these generators do sustain several roles; it is not a false positive, and coexistence alone says nothing about open-endedness. `boundedTreatmentVsFlat` passes `adaptive-activity` and the held-out summary at both windows (32/32) but never `unbounded-growth` or `held-out-role-count` (0/32 both); `held-out-differentiation` is 23/32 at 1e5, 32/32 at 1e6. Full raw output: `runs/nullcal/w1e5-w1e6-rewrite/report.{md,json}` (gitignored, regenerate with the command above).

**Known limitations:** (a) `longPeriodLoop`, `saturatingProcess`, and `randomWalkNoise` structurally keep every role share bounded away from the 5% `roleSummary` threshold throughout (fixed floors for the first two; `randomWalkNoise`'s role share is a walk reflected within [0.05, 0.95]), so `held-out-role-count` is uninformative for them. `neutralDrift` is the exception: its role shares follow an unconstrained Ornstein–Uhlenbeck process with no floor near 5%, so the role count *can* drop below 4 (confirmed: master seed 1, window 1,000,000, replicate 0, treatment condition, seed index 11 — only 3 of 4 roles present at step 450,100). `ecological-closure-coexistence` (which only needs ≥2 roles) still passes every null at 1e6 as measured above; (b) `boundedTreatmentVsFlat` — a bounded-but-real treatment effect — passes `adaptive-activity` and the held-out summary, so those gates detect "treatment beats control", not open-endedness; only `unbounded-growth` reliably rejects it; (c) 32 replicates (the registered `PROBABILITY_GATE.reps`) still leaves wide intervals on rare events — `longPeriodLoop`'s single `ecological-closure-recycling` pass above falls well inside that noise; (d) **`unbounded-growth` passes `saturatingProcess` in 3/32 replicates (9%, 95% CI [0.02, 0.25]) at both windows.** This endpoint is not a significance test with a nominal α: it classifies each run's cumulative new-activity curve (`growthVsSaturation`) and passes when a majority of treatment runs are "growing" and at most a minority of neutral runs are. By that classifier's own rule, a saturation time constant beyond half the window counts as "growing", and `saturatingProcess` draws τ = 3–8× the window, so every trial sees only the near-linear onset. The treatment and neutral conditions are exchangeable here, so each pass is a chance majority/minority split between two conditions whose runs are frequently classified "growing". This is the finite-window caveat measured directly: a single-window "growing" verdict cannot distinguish unbounded growth from saturation slower than the window, which matters for reading M4's gate.

**Controls** (same seed protocol, randomized assignment):
- no mutation
- neutral shadow
- no light gradient (uniform energy)
- fixed environment
- matter replenished externally (breaks closure)
- no migration
- no adhesion/signal actuators (blocks transitions)

## Milestones and gates

Each gate is a pass/fail check. The **pivot** column is what we do instead of pushing on.

| # | Milestone | Gate | Pivot if it fails |
|---|---|---|---|
| **M0** | Harness: Vite + TS, WebGPU in a worker, ping-pong integer transport, CPU reference, OPFS checkpoints, headless test runner | 100k steps, conservation residual = 0; GPU hash = CPU hash on 64²; identical hashes on 2 different GPUs; checkpoint/restore round-trips bit-exact | Fall back to f32 with tolerance-based checks; drop cross-device verification from §7 |
| **M1** | Chemistry + energy ledger, globally fixed catalysis | Energy ledger closes exactly every step; dissipative patterns persist under light; no-light control relaxes to equilibrium | Simplify to 3 species |
| **M2** | Heredity substrate: genomes, mixing lottery, mutation, lineage IDs, event log | Neutral markers drift at a rate consistent with neutral-theory expectation for the effective population size; complete phylogeny reconstructable from the log | Revisit mixing rule (mass-weighted blend vs lottery) |
| **M3** | Individuals: bootstrap search (MAP-Elites / IMGEP over many small worlds batched in one texture array), component tracker, fission detector, lesion battery | ≥20 genetically distinct seeds (clusters more than 10 genome slots apart) that recover from a 30% lesion with p > 0.8 **and** die in the no-light control (active, not passive, maintenance), confirmed on fresh seeds with 16 replicates each | If the search finds no self-maintaining individuals, switch substrate to particle chemistry (addendum §"When the substrate changes") and keep M0–M2 infrastructure. Too few distinct clusters may only reflect search budget: extend the search (`tools/bootstrap.ts --resume`) first |
| **M4** | Open evolution: bootstrap off, long runs | Over the registered 10⁶-step horizon, pre-registered endpoints 1 and 2 both hold: cumulative new activity in treatment exceeds neutral and no-mutation (endpoint 1), and a majority of treatment runs are classified "growing" while at most a minority of neutral runs are (endpoint 2). Amended before the freeze from "exceeds neutral shadow in ≥70% of runs over 10⁷ steps": no registered endpoint counted that per run, and a 10⁷ extension is a registered secondary analysis. The fraction of treatment runs whose cumulative new activity exceeds the neutral runs' 95th percentile is reported descriptively | Strengthen evolvability (duplication rate, modularity) before scaling up |
| **M5** | Ecological closure | ≥3 trophic roles (each ≥5% of living cells) coexist for ≥10⁵ steps across consecutive deep censuses in a majority of treatment runs (reported with endpoint 4), and the biotic recycling share is above the "matter replenished" control (endpoint 3). Amended before the freeze from ≥10⁶ steps and Finn's cycling index: the first cannot be observed within the 10⁶-step horizon, and under matter closure the cycling index is trivially 1 | Add spatial heterogeneity (light patches, slow currents) to support niches |
| **M6** | Archipelago (run alongside M5): coordinator, manifests, migration, replay verification, run-bundle export | 100 verified independent histories across ≥3 device types, with every registered control that applies to the preset (migration comparisons such as `no-migration` belong to the separate ring registration). Only ordinary runs count: runs in a migrating ring exchange cells and are not independent. Migration counts as delivered infrastructure (replay-verified ring runs) | Run the ensemble on your own machines headlessly and defer the volunteer network |
| **M7** | Major-transition hunt: adhesion and signaling enabled, collective tracker; registered separately, with its own presets, pilot and thresholds | North star met, or a documented negative result naming the level and ablation where organization saturated | Publish the negative result with the full ensemble |

### Gate results

- **M3 met (2026-09-27), under the gate as specified:** each counted seed regenerated after a 30% lesion in more than 80% of 16 fresh-seed replicates (13 or more of 16, observed rate) and died without light in all 16. 580 of 839 screening passers qualified, forming 24 genetic clusters (20 required). Search: 300 batches of `tools/bootstrap.ts` (seed 1, lineage selection, `--random 0.25`; 200 batches, then `--resume` to 300); confirmation seeds 1000001–1000210. 21 of the 24 clusters sit about 160 slots from `generalistGenome`, consistent with separate random founders; the cluster count grew roughly linearly with search budget (10 at 80 batches, 18 at 200).
  *Robustness:* requiring a one-sided 95% Clopper–Pearson lower bound above 0.8 instead, which at 16 replicates only 16 of 16 meets, leaves 244 passers in 12 clusters. A retest under the "Probability gates" rule above (32 fresh-seed replicates, seeds 2000001–2000050; every member of the 14 clusters without a 16/16 passer, up to 4 strict members of each of the other 10; `experiments/m3/retest.json`) found passers in **13 of the 24 clusters**: 4 of the 14 weak clusters (their members mostly regenerate in 21–28 of 32, a true rate near 0.65–0.85, so 13/16 was mostly the lucky side of chance) and 9 of the 10 strong ones. M3 stands as specified; under the later rule it would not be met.
- **The hand-built founder does not regenerate.** `generalistGenome(60, 20)`, the founder of every generalist preset, survived, recovered its mass and died without light in 32 of 32 replicates but regenerated in **0 of 32**: it persists as many small reproducing individuals (about 47 per tile, about 96 fissions or buddings per tile), resilient as a population but not as individuals. An instrumented rerun (seeds from 3000001) confirmed the lesion lands and the remnant is tracked: the damaged individual regrows only to 48–83% of its mass in the 2,000-step window and levels off near 80% even over 8,000 steps (3 of 32), while an M3 founder in the same batch regrows to 90–115% in 32 of 32. The pre-registered ensembles are therefore founded from the M3 founder set instead (`packages/schema/src/founders.ts`, presets `gradient-m3` and `spots-m3`): the best genome of each of the 13 clusters that pass the retest, kept only if it still passes with a second, independent 32-replicate batch pooled in (seeds 5000001–5000007, `experiments/m3/replicate.json`). Picking each cluster's best batch favoured lucky ones: on the replication alone only 5 of the 13 passed, and five of the eight that failed had 29 of 32, since their true regeneration rates lie around 0.9–0.95. Pooled over 64 replicates, 12 pass (0.906–1.0); cluster 23's candidate (56 of 64, 0.875, bound 0.786) was dropped, leaving **12 founders**. The same noise applies to the probability-gate rule itself: near a true rate of 0.9 a single 32-replicate batch passes or fails almost by chance, so the rule is conservative there.
- **Activity threshold frozen (2026-09-27).** A separate neutral-only pilot, 20 runs of 10⁶ steps per preset on seeds 1001–1020 from the 12-founder set, fixed endpoint 1's threshold at the 95th percentile of pooled lineage activity: **gradient-m3 10,008**, **spots-m3 14,613** cell-censuses (`experiments/endpoints.ts`, report `experiments/calibration/calib-neutral.json`). Both are stable: bootstrap 90% intervals over runs are within ±2% (9,919–10,119; 14,376–14,832), and odd and even seeds agree (9,990 / 10,031; 14,717 / 14,501). The neutral distribution is very skewed (in one gradient-m3 run: median 6, 99th percentile about 107,000); no lineage survives a whole run. Analysis refuses the frozen value for an ensemble whose versions, preset identity or neutral distribution differ from the pilot's, or whose seeds overlap it.
- **Pre-registration frozen (2026-09-27).** `experiments/preregistration.md` is frozen with SHA-256 `5e08b51d7b58d00ad11b192eca3195343f1fc96747a5b7972e847b1d73879b4d` recorded in `experiments/FROZEN`; the analysis code is `tools/analyze.ts` at that commit (after the streaming rework of the lineage tables, the gate-calibration refactor, and the heredity and role-threshold sensitivity sections). `tools/gen-prereg.ts` now refuses to rewrite its generated sections; later changes are dated amendments.
- **M4 not met (2026-09-28).** The registered ensemble ran to completion: 170 runs of 10⁶ steps (`gradient-m3`, 6 conditions × seeds 1–20; `spots-m3`, 5 conditions × seeds 1–10; census every 100, deep every 10), all with exact conservation and none extinct. It was analysed with `tools/analyze.ts` from the freeze commit `b7fd4c1`; the reports are `experiments/m4/gradient-m3.json` and `experiments/m4/spots-m3.json`.
  - *Endpoint 1* holds on `gradient-m3`: treatment beats both neutral and no-mutation with effect 1.00 (Holm-adjusted p < 0.0001). It fails on `spots-m3`, where treatment > neutral misses α = 0.01 (effect 0.80, p = 0.0116); treatment > no-mutation holds there (effect 1.00).
  - *Endpoint 2* fails on both presets. Treatment runs are "growing" (20 of 20; 8 of 10), but so are neutral runs (20 of 20; 10 of 10), where the endpoint requires at most a minority.
  - *Pivot.* The registered response to a failed M4 is to strengthen evolvability. The foundations review below decides how, before any amendment or fresh ensemble.
  - *Other registered results from the same ensemble.* Endpoint 3 holds (biotic recycling above replenished, effect 1.00 on both presets), and so does endpoint 4 (at least 2 roles for 10⁵ steps in 20 of 20 and 10 of 10 treatment runs). The M5 criterion of at least 3 roles holds in 13 of 20 and 10 of 10. The held-out hypothesis is a fully evaluated negative on both presets: 0 of 4 observables established.
  - *Calibration check.* The frozen thresholds reproduced: this ensemble's own neutral 95th percentiles are 9,940 and 14,646, against the frozen 10,008 and 14,613.
  - *Hardware.* 40 runs ran on an Apple M1 Max and 130 on an NVIDIA A10G (AWS g5.xlarge). The A10G passed `tests/deno/gpu_golden.ts`, and a shared run's first 50,000 steps were byte-identical on both devices.
  - *Exploratory, from looking at the data, not confirmatory.* Endpoint 2's neutral-minority condition is hard to satisfy. The threshold is the neutral pilot's 95th percentile, so it leaves about 5% of the pilot's pooled neutral lineages above it (ties aside). A similar fraction is expected in independent neutral runs while the activity distribution stays stable. With new lineages arriving at a roughly steady rate, that yields almost linear cumulative new activity. All 30 neutral runs here were classified "growing". On `gradient-m3`, every treatment run still exceeds every neutral run in cumulative new activity. A criterion that compares treatment's growth with neutral's would need a dated amendment and a fresh ensemble; this ensemble cannot be re-read under it.
- **Foundations review: Variation (2026-09-29).** `tools/foundations.ts gate`, on the results in `experiments/foundations/`. Rows in order:
  - *Substrate does not fire.* Test 1's parent–offspring slopes are 0.85 (95% interval 0.69–1.00) for mass at reproduction, 0.96 (0.94–1.02) for membrane fraction and 0.90 (0.60–0.96) for reproduction rate, all above 0.2. All 10 histories hold viable three-generation chains. 148 of the 200 links are clonal, so the slopes mostly measure how faithfully whole genomes are passed on.
  - *Variation fires.* In test 2, 310 of the 2,400 `mutStep` 24 mutants (12.9%; 298 under the literal parent − 0.10 margin) are viable and changed, far above 1%. But viable role-changing mutants appear for only 1 founder of 12: founder 2, mixed to phototroph, in 3 mutants. Test 3 found 75 candidate roles in its 60 mutation runs. Beside the founder in the garden, 10 keep a different role, 63 take the founder's role and 2 are inactive. Founder 2 originates a role in 5 of 5 runs, founder 10 in 2 and founder 3 in 1, so 1 founder of 12 counts. Without mutation every founder holds one role.
  - *Caveats, recorded with the verdict, which they do not change.* Both tests read roles in the evaluator's uniform light (level 200). Test 2 judges each mutant alone, where a mutant living on others' products cannot be viable, so the only role change it can see is between self-feeding strategies. In test 3, 31 of the 34 decomposer candidates took the founder's role beside it (28 of them as phototrophs), and bright uniform light may make almost any genome a phototroph. Both tests may therefore understate heritable role change. The founder diagnostic's gradient garden (Part A, below) checked this for test 3. 16 of the 75 candidates keep a different role there, against 10 in uniform light. But founder 2 is still the only founder that counts (founders 3 and 10 originate a role in 2 runs each), and 28 of the 34 decomposer candidates are still phototrophs beside the founder. Uniform light does not explain test 3's result. Test 5 adds that the replays' evolved lineages keep survival and light dependence (0.956 each) but not regeneration (0.168, against the founders' 0.979; 0 of 50 pass the strict M3 retest).
  - *Test 4, reported beside the row, which does not need it:* Inconclusive. Late lineages beat early ones by the margin in both states in 0 of 10 histories, although in the early state they win by far more than the margin in 7. In the late state both groups sit at the extinction floor in 9 of 10. The neutral control cleared the margin in 0 of 5. Test 4b, with 256-cell implants, is Inconclusive too: late beats early by the margin in both states in 5 of 10 histories. In the early state late implants win in all 10, by 4.7–10.6 in log cell count; 35–95% of early implants go extinct there against 0–35% of late ones. In the other 5 histories both groups sit at the extinction floor in the late state. Its neutral control cleared in 0 of 5. Descriptively, competitive ability accumulates between 10⁵ and 9 × 10⁵ steps: mean fitness, late minus early, is positive in every history in both states. The floor hides whether late lineages keep that edge at home.
  - *Next move,* as the row says: RULE_VERSION 2 aimed at variation, and founder selection that measures evolvability. First, the founder diagnostic below asks how much of the verdict belongs to these 12 founders.

### M4 pivot: foundations review (decided 2026-09-28)

*Decided after the M4 result and before any foundations experiment ran. Everything here is exploratory: nothing is a registered endpoint, and none of it re-reads the M4 ensemble as confirmatory. The decision-gate thresholds were written before any result, and they change only by a dated note below them.*

Repairing endpoint 2 answers a narrow question. The question that decides M4–M7 is whether this world can accumulate heritable capabilities that open the way to further evolution. The review tests that first, reusing the existing simulation, replay and analysis infrastructure. The endpoint-2 amendment and any fresh ensemble wait for its decision gate.

**Why.**
- *The M4 data, looked at per window (exploratory).* For each gradient-m3 run, the lineages first seen in each 100k-step window of `lineages.tsv`, and the share of them that cross the frozen threshold (medians over runs):
  - Neutral runs have about 5,100 new lineages per window, and 4.9–5.3% of them cross, in every window. Their cumulative new activity is a straight line by construction.
  - Treatment runs have 10,200–14,000 new lineages per window, and 5.7–8.8% cross. Crossings per window are flat too: the median ratio of windows 8–10 to windows 2–4 is 0.94 (neutral 1.01). Nothing speeds up or levels off.
  - Part of endpoint 1's margin is therefore demographic: treatment has about twice neutral's births and 1.2–1.8× its crossing share. The `neutral` condition expresses one reference phenotype everywhere (203 individuals against 533), so it is not the demography-matched shadow described under "Measurement". Comparing treatment's slope with neutral's would restate endpoint 1, since both curves are straight lines from zero.
  - At step 100, at least 3 roles are present in 19 of 20 gradient-m3 runs in both treatment and no-mutation (7 of 10 each on spots-m3). The founders supply the roles. Mutation keeps them (no-mutation falls to 1.13 roles on average in the second half), but nothing shows they evolved.
  - Crossings per window fall over the run in 18 of 20 `uniform-light` runs (11 of 20 treatment) and in all 10 `replenished` spots-m3 runs. This hints that light patchiness and matter closure help sustain turnover.
- *The mechanism the pivot names doesn't exist yet.* The table below lists where the implemented rules depart from the design decisions above. The largest gap is decision 4: strengthening evolvability through duplication or modularity means adding a mechanism, not tuning one.
- *Two held-out measures had little room to move.* Role count uses four fixed categories, one a catch-all (`ROLES` in `packages/metrics/src/ecology.ts`), and gradient-m3 treatment runs already average 3.04 roles, some at 4. `compartmentalised` is zero in every treatment run on both presets. The heredity statistic (sibling μ and σ, about 0.95) is as high in no-mutation runs, so it reflects shared genomes, not transmitted organisation. Founder selection scored lesion recovery and light dependence, with size and speed only as MAP-Elites descriptors (`packages/search/src/evaluate.ts`); nothing measured evolvability.

**Plan versus implementation (RULE_VERSION 1).**

| Design decision | Implemented |
|---|---|
| 3: mutation at copy time, fixed per-quantum rate | Mutation happens in `react`, when biomass is synthesised: at most one event per cell per step, with probability new quanta × `mutRate` / 2³² (default 429,497, about 10⁻⁴ per new quantum). Transport never mutates. |
| 3: a `u32` lineage ID | Two words: birth step + 1 and birth cell. A mutation mints a new ID even when clamping leaves the genome unchanged. |
| 4: about 12 sensors → 8 hidden → 8 actuators | 10 → 8 (ReLU) → 8, 160 int8 weights and biases. Inputs: A, B, C, P, E per unit B, light, S, the S gradient (x, y), Lenia affinity U. Outputs: photosynthesis, respiration, decomposition, growth, polymer building, signal emission, motility (x, y). |
| 4: adhesion actuator | None. `WorldConfig.adhesion` derives attraction from the polymer gradient, and it is off in every registered run. |
| 4: per-reaction modules, silent slots, duplication | None. A mutation picks one of 163 loci (160 controller bytes, μ, σ and motility gain) and draws δ uniformly from −24…24 (`mutStep`), with 0 replaced by +1, so +1 is twice as likely. σ receives δ shifted right by 2, so at most 6 in size and never 0. Every locus is clamped to its range, so a mutation can leave the genome unchanged. |
| 5: five reactions | Six catalysed reactions (photosynthesis, respiration, decomposition, growth A + E → B, polymer building, signal emission), all through an Allee-type effective catalyst, plus passive decay and light-driven abiotic recycling (`docs/rules.md`). |
| 6: GPU label propagation, grouped by genome similarity | Connected bound-mass components (B + P ≥ 48, individuals ≥ 256 quanta), found on census readbacks and tracked by overlap. Each component records the share of its cells carrying its dominant lineage (`purity` in `packages/metrics/src/census.ts`), but components are not grouped by genome. |
| Measurement: interaction network, nesting depth | Not implemented. A collective tracker exists (`packages/metrics/src/collectives.ts`); no registered analysis has used it. |

**Tests.** Time box 2026-09-29 to 2026-10-19. Seeds 4,000,001–4,599,999 are reserved for this review, split by test below, and are never reused by a registered ensemble.

*Compute.* GPU work runs on AWS; the Mac is for development, smoke tests and jobs under an hour. Two budgets are approved (2026-09-28): up to **$50** for the tests below and a separate **$50** for the registered 10⁷ extension. Each includes its own storage and transfer.
- *Allocation.* At M4 throughput the tests come to about $22–25, including the conditional search in the Substrate row. The extension comes to about $20 (about 19 instance-hours). Each budget's remainder covers its storage, transfer, reruns and overruns, and each stops at $50.
- *Instance.* The M4 ensemble's g5.xlarge (NVIDIA A10G, about $1 an hour on demand in us-east-1) ran 6 concurrent lanes at about 730 steps/s each. That was 130 runs of 10⁶ steps at 256² in about 8.5 hours, roughly $0.07 per run.
- *Operation.* The same pattern repeats here: a supervisor starts the lanes, copies results back and terminates the instance when its queue is empty. Each instance passes `tests/deno/gpu_golden.ts` before contributing. Throughput is measured before each job, and the projected cost is checked against what remains of its budget, leaving room for storage, transfer and the jobs still to come.

The replayed source histories are fixed now, before any assay result: M4 gradient-m3 seeds 1–10 in treatment and seeds 1–5 in neutral and no-mutation. A replay takes about 23 minutes per 10⁶ steps on one lane (1,383 s for treatment seed 1 on the M1 Max; A10G lanes run about 730 steps/s). It is accepted only if its census rows match the original `series.jsonl` up to each state it saves; the M1 Max and A10G were byte-identical in M4. Observer additions (per-lineage role and Lenia parameters) are recorded during replay and change no physics.

1. *Life-cycle heredity* (feasibility; seeds from 4,000,001). In the ten treatment replays, follow individuals through fissions and buddings over at least three linked generations. Grow parent and offspring propagules in a common garden (the batched small-world evaluator, standard light and matter). Measure mass at fission, membrane fraction and time to the next fission, censored when none happens, and record each individual's lineage purity alongside.
2. *Mutation neighbourhood* (access to variation; seeds from 4,100,001). 200 single mutants of each of the 12 founders at `mutStep` 24, the rule's value, and at 8 and 4 as perturbations. Each mutant is paired with its parent at identical seeds and tile positions, with 4 replicates and mutation off. Measures: survival, recovery, regeneration, light dependence, mass, speed, reproduction and dominant role (an observer addition to the evaluator).
   - A mutant is *viable* if it survives at no less than the parent's rate minus 10 points and still dies without light.
   - It is *changed* if a measured trait's mean falls outside the parent's central 95% range over 32 seeds.
   - It is *role-changing* if its dominant role differs from the parent's.

   Mutants are drawn with `mutateInPlace` itself, with only `mutStep` changed for the perturbation scales. Clamped proposals that leave the genome unchanged are kept and counted, not redrawn. Candidate classes are confirmed on 32 fresh replicates under the probability-gate rule. If the throughput pilot projects the full screen above $6, it drops to 100 mutants per founder.
3. *Single-founder starts* (access to ecology; seeds from 4,200,001). Each founder alone, gradient-m3 otherwise unchanged, 10⁶ steps: 5 seeds with mutation and 3 without. Roles are read from current fluxes, so they shift with resources and light even when genomes don't change.
   - A role *originates* in a mutation run when three things hold. Lineages in that role hold at least 5% of living cells for at least 10⁵ steps across consecutive deep censuses. The role never qualifies that way in any of the founder's runs without mutation. And a descendant genome holding it, grown in the common garden of test 1 beside the founder, keeps a dominant role different from the founder's.
   - A founder counts when 3 of its 5 mutation runs originate a role.
4. *Time-shift competition* (accumulation; seeds from 4,300,001). From each of the ten treatment replays, save the states at 10⁵ and 9 × 10⁵ steps. From each of the five most abundant lineages at each time, take exactly 64 of that lineage's own cells (matter and genome): the 64 nearest the centroid of its largest individual. A lineage with fewer than 64 cells in one individual is skipped for the next most abundant. Every implant thus starts from the same cell count, and its bound mass is reported. Implant it into both states, with mutation off, at the same 4 positions in every state, fixed on the torus before any implant.
   - *Labels.* Implanted cells get lineage IDs present in neither state; the rest of the genome is unchanged. IDs only label genomes, so this changes no physics, and only the implant's descendants are counted, never residents of the same lineage.
   - *Fitness.* An implant's fitness is log((N_end + 1) / (N_start + 1)), where N counts cells carrying its assay IDs at implant and after 5 × 10⁴ steps. Extinction therefore stays finite. W(o, e) is the median fitness over one history's implants from time o in the state from time e; the share of those implants that went extinct is reported beside it.
   - *Tool.* `applyExchange` (`packages/schema/src/exchange.ts`) already overwrites one run's cells with another run's checkpointed cells, but only at the same positions. The transplant tool adds the offset and the relabelling.
   - A middle state at 5 × 10⁵ steps is added, descriptively, only if the tests' budget has room after everything else; it shows whether any change is monotone.
5. *Lesion battery on evolved individuals* (does evolution keep self-maintenance; seeds from 4,400,001). The ten most abundant lineages at 9 × 10⁵ steps in each of the first five treatment replays go through the M3 retest: 32 replicates of survival, regeneration after a 30% lesion, and death without light. Descriptive, compared with the founder set; it is not a gate row.
6. *Measurement validation* (seeds from 4,500,001).
   - *Worlds known to differ*, built from existing conditions:
     - neutral turnover: the `neutral` replays;
     - a fixed, monomorphic organism: test 3's single-founder runs without mutation;
     - sorting among fixed founders without new variation: the `no-mutation` replays;
     - ecological specialisation: the full founder set without mutation (at least 3 roles at step 100 in 19 of 20 M4 runs) against the single-founder runs without mutation. This pair counts only once test 3 confirms that those single-founder runs hold fewer roles.
   - Candidate measures: new activity in excess of a demography-matched shadow; novelty in phenotype bins (μ, σ and catalytic profile, counting bins never occupied before); an uncapped role measure (distinct catalytic-profile clusters); and the compartment detector, checked first on a hand-built individual with a membrane rim.
   - *Eligibility.* A measure is eligible for a future registration only if both of these hold, with each measure's expected direction for each pair written down before it is computed:
     - It separates each pair of worlds it should, with effect P(a > b) ≥ 0.8.
     - It passes its null checks. A per-run criterion (for example, excess over the shadow, or a growth shape) is applied to every neutral run available, the calibration pilots' 40 and M4's 30. It qualifies when the one-sided 95% Clopper–Pearson upper bound on its flag rate is below 10%, which means at most 2 of the 70 runs flagged. A between-condition comparison is run on 1,000 random 10/10 splits of each preset's pilot and must reject in no more than 2α of them. That is a sanity check only, since splits of the same runs aren't independent trials.
   - A reproducing collective can't be built yet, so that case is a known gap.

**Operational definitions (fixed 2026-09-28, before any assay result).** These fill in what the tests above leave open. The replays and single-founder runs were already running, but nothing below had been computed.
- *Tools and observers.*
  - Replays and single-founder runs use `tools/run.ts --lineage-obs`. This writes `profiles.tsv`, `genomes.tsv` and `births.tsv`:
    - `profiles.tsv`: each lineage's catalytic profile, role and genome μ, σ and motility gain, at every deep census;
    - `genomes.tsv`: each lineage's genome when first seen;
    - `births.tsv`: parent and child traits at each fission and budding.
  - Single-founder runs use `--solo-founder k`: all 13 founder discs of `gradient-m3` carry founder k (the index into `M3_FOUNDERS`), with placement and amounts unchanged.
  - The evaluator's optional observers are `EvalConfig.roles` (catalytic fluxes summed per tile over the censuses of the last 1,000 growth steps) and `perRep`. With both off, M3 evaluations are unchanged.
  - A replay is accepted when its `series.jsonl` and `lineages.tsv` equal the original's line for line.
- *Common garden* (tests 1 and 3): the M3 evaluator's world (`DEFAULT_EVAL`: 64² tiles, uniform light, nutrient 32, mutation off) grown for 20,000 steps, with a census every 100 and the tracker at B + P ≥ 48 and mass ≥ 128.
  - *Reproduction* is a tracker fission, or a budding: a birth within 24 cells of a living individual of the same lineage in the same tile, the runner's own attribution. A parent reproducing at a census counts as one reproduction event, however many offspring it has.
  - *Changed 2026-09-28, before any garden result:* the garden first ran 6,000 steps and counted fissions only. A smoke test with founder 0 gave 0–2 fissions per tile in 6,000 steps, while buddings outnumber fissions about 20 to 1 in the replays.
- *Test 1.*
  - A *link* is a fission or budding row of `births.tsv`. A *chain* is three links in series (g0 → g1 → g2 → g3). g3 is *viable* if it lives at least 10⁴ steps. The earlier "or reproduces" was dropped before any result: the garden smoke test showed bursts of short-lived buds, which would make it trivial.
  - Pairs: from each treatment replay, 20 links drawn uniformly (sampling seed 4,000,001), among those whose parent and child lineages both appear in `genomes.tsv`.
  - Parent and child genomes are grown in separate tiles, 8 each, seeds from 4,000,101. Measured per genome:
    - mass at reproduction (the plan's "mass at fission"): the parent's mass at the census before each reproduction;
    - membrane fraction: P / (B + P) summed over individuals, across the censuses of the last 3,000 steps;
    - time to next reproduction, as its survival-aware inverse, the reproduction rate: reproduction events per 10⁴ individual-steps at risk, each tracked individual counting 100 steps per census, pooled over the genome's tiles. This handles individuals that die or never reproduce, which averaging censored intervals would not.
  - Slope: the OLS slope of the child genome's mean on the parent genome's mean. Its 95% interval comes from 2,000 bootstrap resamples of histories (percentile).
- *Test 2.*
  - *Mutants.* Mutant m of founder f at step size s: `mutateInPlace` on a copy of the founder. It is fed `draw(base, RND.MUT_WHICH)` and `draw(base, RND.MUT_DELTA)`, with base = `cellBase(4,100,000, s, 200f + m)`.
  - *Screen.* `evaluateBatch` with 4 replicates, 16 genomes per batch, and roles and per-replicate values on.
    - Batch b of founder f at step-size index i has seed 4,100,001 + 13(3f + i) + b. Each has a parent batch of 16 founder copies at the same seed.
    - The parent's rates, its central 95% range of 4-replicate means, and its dominant role come from all its parent batches (39 seeds per founder).
    - The six traits for *changed* are recovery, bound mass, mean individual mass, individuals, speed and reproduction. Each is estimated throughout (parent ranges, screen and confirmation) as the unweighted mean of per-tile values, with a dead tile counting 0.
    - *Viable*: survival and death without light each at no less than the parent's pooled rate minus 0.10.
  - *Confirmation* (step size 24 only; 8 and 4 are reported from the screen). Every screen candidate, viable and changed or viable and role-changing, is run on 32 fresh replicates (seeds from 4,150,001), beside its parent at the same seeds and positions.
    - Viable: survival and death without light each have a one-sided 95% Clopper–Pearson lower bound above min(parent rate − 0.10, 0.8).
    - *This amends test 2's viability margin for the confirmation step (2026-09-28, before any result).* The founders' rates are near 1, so the literal parent − 0.10 needs a bound above 0.9, which takes 32 of 32 replicates. That would reject mutants as reliable as the founders themselves were when selected (at least 30 of 32, bound above 0.8). The screen keeps parent − 0.10. The literal 0.9 version is reported beside it, and any change it would make to the Variation row is recorded.
    - Changed: each trait flagged in the screen falls, on the same side, outside the central 99% of 2,000 bootstrap 32-replicate means of the parent's screen tiles.
    - Role-changing: the mutant's dominant role over the 32 differs from the parent's at the same seeds.
- *Test 3.*
  - Founder k runs on seeds 4,200,001 + 10k + j: j = 0–4 with mutation, j = 5–7 without.
  - A role's share is its lineages' share of the living cells in `profiles.tsv`. A role *qualifies* when that share is at least 5% at every deep census across a window of at least 10⁵ steps.
  - Its *descendant* is the lineage with the most cells in that role at the midpoint of the first qualifying window. It is co-cultured with the founder, one disc each at a third and two thirds of the tile's width, over 16 tiles (seeds from 4,250,001). Each lineage's dominant role comes from its own summed fluxes in those tiles.
  - Roles are compared only between *active* lineages, meaning present and catalysing. A descendant inactive beside its founder does not originate a role. A founder inactive beside its descendant is represented by its own monoculture, grown in the same batches.
- *Test 4.*
  - The implant positions are the torus cells (64, 64), (192, 64), (64, 192) and (192, 192).
  - *Changed 2026-09-28, before any assay ran.* Individuals are far smaller than 64 cells: in replayed states at 2 × 10⁴ and 2 × 10⁵ steps the median is 16–17 cells and the largest 29–36. So "fewer than 64 cells in one individual" would skip every lineage.
  - A lineage's *largest individual* is instead the individual (census component of mass ≥ 256) of greatest mass whose dominant lineage it is. The implant is the lineage's 64 cells nearest that individual's centroid on the torus, whether or not they belong to it, ties broken by cell index. A lineage is skipped when it has no such individual or fewer than 64 cells.
  - All channels are copied, relative offsets are kept, and the implant is centred on the position, overwriting what was there.
  - Assay IDs are (1, lo) with lo counting down from 65,535, skipping any present in either state.
  - The assay uses the source config with `mutRate` 0 and seed 4,300,001 + 80h + 40o + 20e + 4r + p. Here h is the history (the replay's seed minus 1), o the origin, e the environment, r the rank and p the position. Logs are natural.
  - Implant cells are ranked by torus distance to the exact centroid. Offsets are taken from the centroid rounded to a cell, and that cell is placed on the position.
  - *Opportunity* also needs its residual condition: every history where late does not beat early shows home advantage, or has neither late-over-early edge clearing the margin. Otherwise the result is Inconclusive.
  - *Neutral control, added 2026-09-28 before any assay result.* The added rule follows the practice of testing simple baselines before crediting the dynamics. The same assay runs on `neutral` replays 1–5, seeds 4,300,801 + 80h + 40o + 20e + 4r + p. There every cell expresses the same phenotype, so a late-over-early difference can only come from the assay itself (implant contents, state density). If the control clears test 4's margin in both states in at least 3 of its 5 histories, test 4's verdict is recorded as Inconclusive (assay confounded), whatever the treatment count. The rule can only move a verdict to Inconclusive.
- *Incomplete inputs decide nothing.* A test whose expected runs, controls or assay results are missing reports "incomplete" and fills no gate row.
- *Test 4b, fixed 2026-09-29 after test 4's result and before any 4b assay ran.* Test 4 as defined came out Inconclusive (`runs/foundations/results/t4.json`):
  - Late lineages beat early ones by far more than the margin in the early state, in 7 of 10 histories.
  - In the late state, at least half of each group's implants went extinct in 9 of 10 histories, so both medians sit at the extinction floor, log(1/65). Neither edge can clear the margin there, and the residual condition fails.
  - The neutral control cleared the margin in 0 of 5 histories.

  The gate's Inconclusive row asks for the cheapest test that would decide the question. With the time box and the tests' budget still open, it runs as test 4b:
  - *Changed:* implants of 256 cells instead of 64 (the lineage's 256 cells nearest its heaviest individual's centroid; a lineage with fewer is skipped). Seeds 4,303,001 + 80h + 40o + 20e + 4r + p, and 4,304,001 + … for the neutral control.
  - *Unchanged:* the positions, 5 × 10⁴ steps, fitness, W, margin, gate rule and neutral-control rule.
  - Test 4b decides test 4's gate row, and test 4 is reported beside it.
  - *The middle state* (descriptive) was to use 4b's 256-cell implants, in the five origin/environment combinations that involve the 5 × 10⁵ state, with seeds 4,302,001 + 100h + 20c + 4r + p for combination c. *Cancelled 2026-09-29, before any of its assays ran:* after the gate, its budget and instance time go to the founder diagnostic below.
  - *Floor guard, for both tests.* A state is at the floor in a history when at least half of both groups' implants in it went extinct. Such a history can still count toward "late beats early", but it cannot count as "neither edge clears the margin". A floor can hide a difference, never show its absence. So floors that leave the rule undecided give Inconclusive, with the survival shares reported.
- *Test 5.* The ten lineages with the most cells at the 9 × 10⁵ checkpoint of treatment replays 1–5 get `evaluateBatch` with 32 replicates, 2 genomes per batch, seeds from 4,400,001. They are reported against the founders' retest counts.
- *Test 6.*
  - *Shadow excess.* Each run's cumulative new activity (the preset's frozen threshold) minus the median of 20 shadows. A shadow keeps the run's living cells at each census and its lineage births, each entering at its first-census cell count, and redraws the remaining cells multinomially from its own previous abundances. A run is flagged when it exceeds all 20 shadows.
  - *Phenotype-bin novelty.* Bins are μ / 8, σ / 4 and role, using genome μ and σ (so drift counts in `neutral`, where every cell expresses the reference phenotype). Only lineages with at least 1% of living cells at a deep census count. Novelty is the number of bins first occupied after step 10⁵, and a run is flagged when it is above zero.
    - Also, in the style of ANNECS (added 2026-09-28, before computing), *persistent novelty* counts only those new bins that some lineage in the bin later holds at 1% or more across 10⁵ steps of consecutive deep censuses.
  - *Uncapped roles.* Catalytic-profile clusters among lineages with at least 5% of living cells: shares of (photo, grow, decomp, resp), single linkage at L1 distance below 0.2, averaged over the second half's deep censuses.
  - *Compartment detector.* Checked on a hand-built individual with and without a membrane rim.
  - *Expected directions, written before computing* (a > b):
    - treatment > no-mutation replays for shadow excess and novelty;
    - no-mutation replays > single-founder no-mutation runs for uncapped roles (the specialisation pair, counted only if test 3 shows fewer roles there);
    - no-mutation replays and single-founder no-mutation runs near zero for novelty.
    - The null checks run over the 70 neutral runs, replayed with the observers.

**Decision gate.** Checked in this order; the first row whose condition holds decides. The margins are prioritisation choices fixed before any result, not biological constants.

| Row | Condition | Next move |
|---|---|---|
| Substrate | Test 1 finds no heritable life cycle: no trait's parent–offspring slope has a 95% interval above 0.2, or fewer than 5 of 10 histories hold a lineage that reproduces over 3 generations with viable descendants. A MAP-Elites search scored on that life cycle then finds none either (at most $5 of the tests' budget, descriptors disjoint from every held-out measure). | Prototype a different substrate, keeping the integer physics, replay, coordinator and analysis infrastructure. |
| Variation | Test 2: fewer than 1% of `mutStep` 24 mutants, pooled over founders, are viable and changed, or viable role-changing mutants appear for fewer than 3 of 12 founders. *And* test 3: a role originates for fewer than 3 of 12 founders. | RULE_VERSION 2 aimed at variation: duplication, modules or silent slots, and step size. Founder selection that measures evolvability, with a score disjoint from every held-out measure. |
| Opportunity | Test 4: late lineages beat early ones by at least log 1.10 in both states in at most 4 of 10 histories; in the rest, either each time wins at home or neither edge clears the margin. | RULE_VERSION 2 aimed at ecological opportunity: a way for products to open new niches (for example, a polymer or signal carrying a genome tag that only matching lineages can use), possibly with duplication. |
| Measurement | Test 4: W(late, e) − W(early, e) ≥ log 1.10 in both states in at least 8 of 10 histories. | Keep RULE_VERSION 1. Replace the measures that missed it with measures that pass test 6, then write the amendment and run a new pilot and a fresh ensemble. |
| Inconclusive | 5 to 7 of 10 histories clear test 4's margin, or anything is left undecided within the review's time box and the tests' $50 budget. | Record what is missing and the cheapest test that would decide it. The fresh ensemble stays on hold. |

If only one of tests 2 and 3 fails, the failure is recorded and the gate moves on to test 4.

**Founder diagnostic (exploratory; fixed 2026-09-29, after the gate and before any of its runs).** Is the Variation verdict mostly about these 12 founders or about the mechanism? M3's selection put half its weight on regeneration and judged each genome alone in uniform light, which may favour self-feeding phototrophs: in that evaluator 9 of the 12 founders are phototrophs and 3 mixed (founders 2, 8 and 10). Founder 2 supplied every viable role-changing mutant and is the only founder that counts in test 3; founder 10 originates a role in 2 runs and founder 8 in none. The diagnostic does not re-decide the gate, and nothing in it is registered. Its genomes never found an ensemble (see *Separation*). It informs the RULE_VERSION 2 founder rule, which is written separately and registered before that cohort's pilot. The role strata used here never become a selection criterion, since M5 would then be selected for.
- *Part A, a gradient garden.* Test 3's 75 candidates and 12 founder monocultures regrow in the garden with light 20 + 220y/63 down each 64-row tile, which is gradient-m3's range. Both discs of a replicate sit on the same row: rows 12, 26, 38 and 52 in turn over the 16 replicates (light about 61, 110, 152 and 201). Seeds from 4,260,001. It is read with test 3's rules and reported beside test 3, never in its place.
- *Part B, 24 other genomes.*
  - *16 from the archive.* The pool is the M3 confirmations (`runs/bootstrap-200/confirm.json`) that survived and died without light in at least 13 of 16 replicates, whatever their regeneration, less the founders' own genomes. That is 826 genomes in 21 clusters at the M3 cluster distance, 9 of them containing a founder. Each pool genome's role comes from the evaluator with roles on: 4 replicates, seeds from 4,205,001. Picks: 8 not phototroph and 8 phototroph, drawn at random (mulberry32, seed 4,210,000), one per cluster within each group while clusters last. A short group is filled from the other.
  - *8 evolved.* From test 5's lineages that survived and died without light in at least 26 of 32: 4 not phototroph and 4 phototroph, one per history within each group while histories last.
  - *Harness.* Test 3's: all 13 gradient-m3 discs carry the genome (`tools/run.ts --solo-genome`), 10⁶ steps, seeds 4,210,001 + 10c + j for subject c, with j = 0–4 with mutation and 5–7 without. Candidates, descendants and gardens follow test 3's rules, with the subject's monoculture in place of the founder's. Both gardens are used: uniform (test 3's, seeds from 4,270,001) and gradient (Part A's, seeds from 4,280,001).
- *Reading, fixed before any run.* A genome counts as in test 3: it originates a role in at least 3 of its 5 mutation runs. The primary reading is the uniform garden, where the founders' rate is 1 of 12.
  - 6 or more of 24 count: founder selection is a major bottleneck. At the founders' rate that would happen with probability about 1.2%.
  - 3 or fewer: the mechanism is the bottleneck, and RULE_VERSION 2's variation changes come first.
  - 4 or 5: ambiguous.
  - The gradient garden is read the same way, against the founders' rate there from Part A, and only once Part A is complete. Incomplete runs or gardens decide nothing: the runs must be exactly the prescribed 192, each finished at 10⁶ steps. Counts are also reported by stratum (archive or evolved, phototroph or not), with the runs in which the genome died out (the manifest's extinction flag). The phototroph strata show whether producer founders can originate roles at all, which an all-producer RULE_VERSION 2 cohort would need.
- *Cost.* About $16 of the tests' budget, mostly the 192 runs of 10⁶ steps; the tests' total comes to about $37 of $50.

**Also.**
- *The registered 10⁷ extension* runs on AWS alongside the review, from its own $50 budget.
  - Size: 15 histories plus its 10-run neutral pilot, 2.5 × 10⁸ steps. Each history takes about 3.8 hours on one lane, and 25 histories on 6 lanes take about 19 instance-hours.
  - It runs with `--checkpoint` every 10⁶ steps, since segmented runs equal continuous ones byte for byte. Its saved states then extend test 4's gap to 10⁷ steps without replays, as descriptive evidence outside the gate.
  - Its analysis still needs schedule-aware threshold code and its pilot first (pre-registration, "Secondary analyses").
- *On hold until the gate:* the endpoint-2 amendment, and whether it also re-tests endpoint 1 against a matched shadow; the fresh ensemble; founder changes; any RULE_VERSION change.
- *Before any new freeze:* role count and `compartmentalised` are replaced by measures that pass test 6. The full analysis is rehearsed on pilot data and the test-6 worlds. Every comparative endpoint must fail neutral against neutral and be passable by a world that differs. A non-comparative endpoint, such as coexistence, must instead fail a world that lacks the property. spots-m3 gets 20 seeds.
- *Separation.* A RULE_VERSION 2 is a separate cohort with its own presets, pilot and thresholds, never pooled with RULE_VERSION 1. Organisms built or searched for in this review are positive controls only and never found an emergence ensemble. The registered 10⁷ extension keeps the M3 founder set. A future cohort's founders come from a selection rule registered before its pilot, with a score disjoint from every held-out measure.

Rough timeline for one person working part-time: M0–M3 in about 4 months, M4–M6 in about 4 more, and M7 open-ended. Throughput is unknown until it is measured in M0. For planning, assume 1024² at 1–3k steps/s on an M-series GPU, which puts a 10⁷-step history at about 1–3 hours.

## Architecture

```
apps/
  lab/            UI: controls, field views, metric plots, lesion tools, run compare
  coordinator/    Phoenix: manifests, migration relay, ingest, replay verification
packages/
  sim-gpu/        WGSL kernels + TS host (worker, fixed-step loop, device-loss recovery)
  sim-ref/        CPU reference with the same integer rules (small grids, golden hashes)
  schema/         Versioned state layout, checkpoint format, migration packet schema
  metrics/        GPU reductions + CPU analysis (activity stats, cycling index, trackers)
experiments/      Configs, preregistration.md (frozen + hashed), control definitions
analysis/         Reproducible notebooks/scripts over exported run bundles
```

Per-cell state at 1024² comes to about 64 × 32-bit channels (species ×5, energy, heat, genome ×~48, lineage, component label, spare) ≈ 256 MB for each of the two ping-pong copies. That is fine on desktop GPUs. Mobile gets 512².

## Safety and ethics

- Genomes are numeric weights interpreted by a fixed kernel. There is no code in any genome and no path from the substrate to the network.
- Migration packets are schema-validated data, size-capped and rate-limited. The coordinator holds no credentials beyond its own database.
- Browser compute is opt-in, visibly running, and pausable. Use per-tab GPU budgets and a coordinator-side kill switch.
- Following the report and Witkowski & Schwitzgebel, the project neither asserts nor rules out moral status. Log the question in the pre-registration and revisit it if M7 succeeds.

## First week

1. Scaffold the pnpm workspace plus `apps/lab`, `packages/sim-gpu` and `packages/sim-ref`.
2. Write the integer gather-transport kernel (one species, diffusion + advection by a fixed flow field) in both WGSL and TS.
3. Add a golden test: 64², 1,000 steps, same seed, comparing GPU and CPU state hashes, run headlessly in Chrome via Playwright.
4. Add a conservation assertion (sum of quanta, via GPU reduction) checked every step in debug builds.
5. Draft `packages/schema` v0 and the checkpoint format (header, checksum, schema version, rule version).
