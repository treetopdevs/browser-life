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
Every cell carries a genome vector that is advected with its mass. When mass from several sources merges into one cell, the resulting genome is chosen by mass-weighted lottery using a counter-based PRNG keyed on `(seed, step, cell)`. Mutation happens at copy time with a fixed per-quantum rate. Each genome also carries a `u32` lineage ID; a mutation mints a new ID and appends a birth event to a GPU event buffer.

### 4. The genome is a developmental program, not a parameter list
The genome holds the weights of a small fixed-topology local network (about 12 sensors → 8 hidden → 8 actuators, fixed-point). It reads local chemistry, gradients, signals and its own state channels. Actuators: catalysis rate for each reaction, flow bias (motility), adhesion, signal secretion, and deposition of structural polymer (a membrane). Evolvability features are built in from the start: modular per-reaction weight blocks, silent slots available for neutral drift, and a duplication mutation that copies one module into a silent slot.

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
  - *Pivot.* The registered response to a failed M4 is to strengthen evolvability; see the exploratory note below before choosing how.
  - *Other registered results from the same ensemble.* Endpoint 3 holds (biotic recycling above replenished, effect 1.00 on both presets), and so does endpoint 4 (at least 2 roles for 10⁵ steps in 20 of 20 and 10 of 10 treatment runs). The M5 criterion of at least 3 roles holds in 13 of 20 and 10 of 10. The held-out hypothesis is a fully evaluated negative on both presets: 0 of 4 observables established.
  - *Calibration check.* The frozen thresholds reproduced: this ensemble's own neutral 95th percentiles are 9,940 and 14,646, against the frozen 10,008 and 14,613.
  - *Hardware.* 40 runs ran on an Apple M1 Max and 130 on an NVIDIA A10G (AWS g5.xlarge). The A10G passed `tests/deno/gpu_golden.ts`, and a shared run's first 50,000 steps were byte-identical on both devices.
  - *Exploratory, from looking at the data, not confirmatory.* Endpoint 2's neutral-minority condition is hard to satisfy. The threshold is the neutral pilot's 95th percentile, so it leaves about 5% of the pilot's pooled neutral lineages above it (ties aside). A similar fraction is expected in independent neutral runs while the activity distribution stays stable. With new lineages arriving at a roughly steady rate, that yields almost linear cumulative new activity. All 30 neutral runs here were classified "growing". On `gradient-m3`, every treatment run still exceeds every neutral run in cumulative new activity. A criterion that compares treatment's growth with neutral's would need a dated amendment and a fresh ensemble; this ensemble cannot be re-read under it.

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


## Founder-policy assay decision — 2026-09-30 UTC

The genome-level founder-policy protocol supersedes the requirement to wait for organism Gate A or a validated evolvability surrogate. RULE_VERSION 1 and historical presets remain fixed. The separate ecology-first program is untouched. The historical Variation verdict is preserved; it does not select a mechanism.

The complete local pilot (256 competitions plus deterministic replay) failed its frozen survival and identical-competitor balance criteria: only 1/8 genotype controls retained both competitors in all 16 replicates; 168/256 competitions were both-extinct (80 identical, 88 disabled-control); the two fully scored identical controls had mean absolute scores 0.365 and 0.836, above 0.15. Only two original-versus-zero-controller contrasts were fully informative, both scoring +1. The other six are unavailable, not measured evidence of equal performance.

**Decision: stop at this specific assay limitation.** No technical defect justifying the one permitted repair was identified. Do not change controls, thresholds, the environment or horizon to force a pass. No comparison histories, new founder policy, physics changes or general foundations review are launched. The comparison code passed independent review and 20 CPU tests, but the planned 72 histories remain unexecuted. Organism reproduction and evolutionary capacity are not resolved by this pilot.

[Full findings and reviewed evidence](../experiments/founder-policy/v1/pilot-findings.md). Paid spending **$0 of $50**; no cloud resources were created, and no cloud teardown is required.


## 2026-09-30 — Fixed-founder genome-level improvement study released

The fresh competition pilot passed its frozen engineering criteria: 128 valid controls, 32/32 unique clone states available and activity-positive, and two passing replay checks. Independent analysis matched byte-for-byte. This establishes assay availability/accounting for four deliberately prepared founders; it does not establish genetic sensitivity, adaptation or organism reproduction. The old failed founder-policy pilot and historical Variation verdict remain unchanged.

The reviewed study freezes four founders, eight matched evolution seeds and normal/off mutation pairs: 64 histories under RULE_VERSION 1, with the one-million-step endpoint primary. It is a fixed-founder adaptation experiment, not the previously proposed randomized archive founder-policy comparison. Manifest and release are in `experiments/founder-discovery/v1/improvement-study/`.

Decision: launch the complete local roster in bounded tranches. Measured engineering workloads support a 72-hour forecast with a 96-hour cumulative execution ceiling, 64 GiB estimated storage and a 20 GiB free-space floor. Paid compute remains $0. These are projections with headroom, not worst-case guarantees; a resource interruption is an incomplete study, never permission to reduce replication or buy more compute. No ecology/physics change or organism-reproduction claim is released.
