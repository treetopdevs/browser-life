# Scaffolding registration v1 (frozen 2026-10-02)

*Drafted 2026-10-01 as row C, step 2 of `docs/plan.md`. Approved as written by the user on 2026-10-02, with the decisions recorded under "Freeze and order of events", and frozen that day. Its SHA-256 is in `experiments/scaffold/REGISTRATION-v1`. No run, assay or data of this design existed at the freeze. Any change from here on goes in a dated amendment at the end, and the original text stays.*

## Question

Under an imposed pond life cycle (protocol v1's pond cycle: grind every pond, reseed it from a k × k propagule of a donor pond), does selection among ponds evolve a pond-level trait that persists after the cycle is removed, and does the evolved genome carry it?

The trait is **propagule competence**: the probability that a k × k fragment of a world founds a pond that regrows in a fresh assay pond. It is protocol v1's R3 measure, unchanged.

**Primary hypotheses** (confirmatory; tests under "Primary tests"):
- **H1, persistence beyond the controls.** Competence of `scaf`-evolved worlds tends to be higher than that of each control:
  - `rand`-evolved worlds (the bottleneck without selection among ponds);
  - `cont`-evolved worlds (no cycle);
  - the ancestor.

  "Tends to be higher" means a one-sided exact rank-sum test rejects the null that the two arms' competences come from one distribution, in the direction of `scaf` ranking higher. It does not mean stochastic dominance, or a shift in location.

  H1 must hold at two timings:
  - **(a)**, withdrawal immediately before the boundary-100 transform, after 99 completed cycles;
  - **(b)**, after a further 2 × 10⁵ steps with no cycle.
- **H2, a genome effect.** For a `scaf` history, the probability that its dominant evolved genome founds more ponds than the ancestor's genome, on the same physical fragments of an ancestral world, exceeds one half.

**Secondary hypotheses** (registered, reported with their tests, never part of the primary outcome):
- **S1, size.** The genome gain reaches at least half of the `scaf` advantage over the ancestor: protocol v1's swap criterion.
- **S2, adaptation on fresh histories.** Protocol v1's R2 (common garden, standardised inoculum), which has never been replicated.
- **S3, pond-level heredity.** The heredity replication's R1″ (capped crossing time at boundary 34), in `scaf` and in `rand`.

## What a confirmed result would and would not mean

- **H1 confirmed:** across histories, the competence of worlds evolved under scaffolded selection ranks above that of worlds evolved under the bottleneck alone, without the cycle, and of the ancestor (in the rank-sum sense above). It does so both at withdrawal and 2 × 10⁵ steps after the cycle stops.
- **H2 confirmed:** the dominant genome of a `scaf` world, taken out of its world, founds ponds better than the ancestor's genome does from the same ancestral material.
- **Both confirmed:** the two claims are reported separately and together. H2 tests timing-(a) genomes on ancestral material. It does not show that the genome causes the advantage of evolved worlds at timing (b), or that `scaf`'s genomes improved more than `rand`'s or `cont`'s.
- **Heritable.** The word "heritable" is used for the pond-level trait only if S3 demonstrates heredity in `scaf`.
- **Would not mean:**
  - that ponds reproduce as units once the scaffold is gone: no endogenous life cycle is tested;
  - that the collectives are individuals in the tracker's sense, or anything about the reset line's entity question;
  - anything beyond this regime: k 8, period 10,000, 64 ponds, one ancestor, 10⁶ steps.
- **Not confirmed:** "not confirmed by this registration". That is not a demonstration that the exploratory result was wrong.
- **Milestones.** It does not count toward M6.
  - `docs/plan.md`'s M7 row specifies adhesion and signalling with a collective tracker. This design enables neither and imposes the life cycle ecologically.
  - **A confirmed result stands as its own registered result** and does not count toward M7 (the user's decision, 2026-10-02). It is evidence that informs M7's design. It is not a step of M7 that has been met, because the life cycle here is imposed and the north star asks for one that is not.

## What earlier data informed

Every design choice here was informed by the exploratory line: protocol v1 (main run, R1–R4), the heredity replication (R1″) and the R3 replication.
- The regime, measures and thresholds are protocol v1's, except for the deliberate deviations listed below.
- The redesigned swap test answers the R3 replication's caveats: its six swap tests shared one ancestor fragment draw, and the swap's size criterion passed at its threshold twice. The redesign uses an independent draw per history and an explicit relabelled control.
- The tests, the sample size and the demotion of the size criterion to S1 follow the power estimates below. They are bootstrapped from those runs' per-fragment outcomes.
- **A pilot of the new control (2026-10-01, Mac, exploratory).**
  - **What ran:** `Ga-on-Fa` on both exploratory ancestor fragment sets, with their own sources and seeds, so on the same physical fragments as their `ancestor-a` and swap sets. The outputs are in `runs/scaffold/reg-pilot/`.
  - **The control founds better than the unmodified ancestor set:** 0.914 against 0.875 in the R3 replication, and 0.867 against 0.820 in v1. That is 5 and 6 more fragments, and no fewer.
  - **Against this control, every evolved genome still gains,** but by only 2–4 fragments of 128 in the R3 replication and 1–8 in v1, and on no fragment does the control win.
  - **So most of the exploratory swap gains (7–14 fragments) came from the control's mutants, not from the evolved genome.** Under a matched control, the genome gain is under half of the advantage over the ancestor in all 12 histories, so S1 is expected to fail.
  - The small per-history signal is why the swap pair gets 8 replicates.

No world, assay or data in this registration's seed block exists.

## Deviations from protocol v1 and the replications

- Two-sample tests across 24 independent histories per arm replace v1's counts of "at least 4 of 6" over histories paired by index; that pairing carries no meaning. The genome effect is tested with a sign test, which needs no symmetry assumption.
- **Genome-only control:** a new `Ga-on-Fa` control is added (see Assays), and each history gets its own ancestor world and fragment draw.
- **Replicates:** 4 per set (256 fragments), and 8 for the swap pair (512), not 2.
- **Runner:** histories run on the shared runner (preset `ponds`). Sources are the runner's own pre-cycle checkpoints, a small opt-in runner feature built for this registration (see "Code to build"). Histories use census every 1,000 steps, not 100.
- **Ended histories:** an ended history keeps stepping its cleared, A-only world to boundary 100, while v1's tool stopped and assayed the terminal pre-clear state. Its fragments are absent either way, and so fail. Its timing-(b) world stays empty here, whereas v1 continued the pre-clear state, where cells below the eligibility threshold could regrow.
- Protocol v1's truncation rule is carried forward unchanged: a history with more than 1% truncated recipient rows is flagged. A sensitivity result without flagged histories is reported beside the outcome; if it would change the outcome row, the result is reported as sensitive to truncation.

## System under test

- **Physics: RULE_VERSION 1,** golden pins as committed. No rule, WGSL or configuration key changes for this registration.
- **Runner:** the shared runner with the integrated pond cycle (`docs/scaffold-integration-v1.md`), `tools/run.ts`, preset `ponds` (identity `56526b894cfccf3f`).
  - Its physics is `DEFAULT_EVAL`'s, at 64 × 64 ponds, 8 × 8, with `pondPeriod` 10,000 and `pondK` 8, a clone start of `M3_FOUNDERS[2]`, and the default mutation rate (429,497).
  - It equals protocol v1's frozen main configuration apart from the pond keys.
  - The runner reproduces protocol v1's standalone histories byte for byte (integration acceptance test 2).
- **Arms (conditions):** `scaf` = `treatment`, `rand` = `pond-rand`, `cont` = `pond-cont`.
- **Each history is one uninterrupted run of 10⁶ steps (100 cycles):**
  - census every 1,000 steps, deep metrics every 10 censuses;
  - no periodic checkpoints;
  - pre-cycle checkpoints at boundaries 34 and 100, with their state hashes in the manifest.
  - Neither the physics nor `ponds.tsv` depends on the census cadence (integration Amendment 2).
  - The runner stops on more than 65,536 mutation events between censuses. Integration test 2 measured at most about 4,000 per 1,000 steps in this regime.
- **Validity of a run:** exact conservation at every census, recorded in the manifest's `conservationOk`, and at every cycle, where a violation throws. A history that ends (no eligible pond) keeps stepping and is valid: that is a biological outcome.

## Histories and sources

- **Histories:** 24 per arm, i = 0–23 (the user's choice, 2026-10-01).
- **Ancestor worlds:** 24 independent clone worlds, one per index i: preset `ponds`, condition `pond-cont`, 10,000 steps, with a pre-cycle checkpoint at boundary 1. A `pond-cont` world of one period is protocol v1's ancestor source (the clone grown one period).
- **Source (a):**
  - `scaf` and `rand`: the pre-cycle checkpoint at boundary 100;
  - `cont`: the same checkpoint, which is its state at step 10⁶;
  - ancestor i: its boundary-1 checkpoint.
  - Every source is loaded by the hash recorded in its manifest.
- **Source (b):** source (a) run 2 × 10⁵ further steps with no cycle and mutation on, as in protocol v1.
- **Dominant genome:** the lineage with the largest trait mass (cells with B+P ≥ 48) in a `scaf` history's source (a). Ties go to the smallest (hi, lo).

## Assays

Protocol v1's competence assay, unchanged except for the number of replicates:
- fresh assay worlds of 64 ponds at 512², with per-pond matter budget M_assay = 151,552, mutation off, one period of 10,000 steps;
- standard fragments: k = 8, the source pond uniform among eligible ponds, the centre by the packet rule;
- a fragment succeeds when its pond trait is at least 0.25 · ref (ref = 103,058) and at least 4 × its retained landed B+P;
- **R = 4 replicates**, so 256 fragments per set, and **8 replicates (512 fragments) for the swap pair** `Ge-on-Fa`_i and `Ga-on-Fa`_i; competence = successes / fragments.

**Sets per index i (13):**
1. **Sources:** `scaf`_i, `rand`_i, `cont`_i and ancestor_i, each at (a) and (b): 8 sets.
2. **`Ge-on-Fa`_i:** ancestor world i's fragments at (a), with every cell's genome words replaced by G_e,i, the dominant genome of `scaf`_i's source (a).
3. **`Ga-on-Fa`_i (new control):** the same fragments with every cell's genome replaced by `M3_FOUNDERS[2]`.
   - The ancestor world carries mutants after its period, and lineage ids enter the physics (whether a cell is living, and copying), so the unmodified ancestor set is not a genome-only control.
   - Both swap sets are relabelled by protocol v1's rule (every distinct genome to (0, k+1) in raster order of first appearance), so each carries the single id (0, 1).
   - `Ge-on-Fa`_i and `Ga-on-Fa`_i therefore differ only in genome words.
4. **`Ga-on-Fe`_i:** `scaf`_i's fragments at (a), with the ancestor genome, relabelled (descriptive).
5. **Quenched:** `scaf`_i's fragments at (a) and (b), with the controller weight words and E set to 0, relabelled. This is the validity control.

**Pairing (common random numbers).**
- Every set on one source and timing uses that source's assay seed σ, for both fragment sampling and the assay world's physics.
- So ancestor_i (a), `Ga-on-Fa`_i and `Ge-on-Fa`_i are the same physical fragments in the same physics stream.
- Each history's swap pair uses its own ancestor world and its own draw, so the 24 swap comparisons are independent (given the fixed founder and regime).

## Primary tests

All tests are exact and one-sided, at α = 0.01. Mann–Whitney uses the permutation distribution with midranks for ties (`mannWhitney(…, "exact").pGreater` in `packages/metrics/src/stats.ts`). Sign tests use the binomial tail at one half.

- **H1.** Six exact one-sided Mann–Whitney tests of `scaf` competence against `rand`, `cont` and the ancestor, at (a) and at (b).
  - Each test runs across the 24 histories per arm and 24 ancestor worlds (48 values in all, within `mannWhitney`'s exact range).
  - Arms are independent histories, so these are two-sample tests. The null of each test is that the two groups' competences are exchangeable (one distribution).
  - **Unresolved values.** A rank test is not made conservative by substituting an extreme value: that changes the permutation distribution and can lower p. So a comparison that would include an unresolved value (see "Validity, missing data and availability") is **uninformative**. Then H1 is uninformative, and its slot in the Holm family is p = 1.
  - H1's p is the largest of the six p-values (intersection–union: H1 holds only if every comparison does).
- **H2.** For each `scaf` history, g_i = competence(`Ge-on-Fa`_i) − competence(`Ga-on-Fa`_i), a paired difference on 512 identical fragments.
  - H2's p is the exact one-sided sign-test p for the count of histories with g_i > 0 among the 24.
  - A history with g_i ≤ 0 counts as not positive. So does a history without a dominant genome (no eligible cell in source a: the endpoint is scored as failure, not measured), and an unresolved history.
  - With 24 histories, at least 19 positive histories are needed: 19 gives p = 0.0033, and 18 gives 0.011.
- **Family:** Holm over {H1, H2} at α = 0.01. Each hypothesis is **confirmed** when its Holm-adjusted p is at most 0.01.

## Secondary tests

Holm over {S1, S2a, S2b, S3} at α = 0.01, separately from the primary family.
- **S1.** d_i = g_i − 0.5 · (competence(`scaf`_i, a) − competence(ancestor_i, a)).
  - S1's p is the sign-test p for the count of histories with d_i > 0; failures as in H2.
  - **Descriptive:** the gain-to-advantage ratio g_i / (competence(`scaf`_i, a) − competence(ancestor_i, a)).
    - It uses histories with a measured, finite numerator and a measured, positive denominator. Exclusions are counted by reason: unresolved, no dominant genome, non-positive denominator.
    - It reports the median and a percentile bootstrap 95% interval over the m eligible histories: 10,000 resamples; resample r takes histories `randomKey(4,880,201, r, j, 0) mod m` for j = 0 … m−1.
    - With no eligible history, the ratio is reported as unavailable.
  - The ratio compares two homogenised genomes on ancestral material against an unmatched difference between worlds. It is not the fraction of the advantage that the genome causes.
- **S2 (protocol v1's R2 on fresh histories).** Inocula come from each `scaf` and `rand` history at time 0 (its initial world, rebuilt from the preset and seed and checked against the manifest's initial-state hash) and at time C (source a).
  - The **standardised** inoculum plants each fragment's dominant genome as the standard disc: radius 10, biomass 64, energy 128.
  - The **raw** inoculum is reported descriptively.
  - Two replicates, one period, mutation off. Gain_i = mean end trait at time C − mean end trait at time 0, on the standardised inoculum.
  - **S2a:** `scaf` gain > 0, by a sign test across `scaf` histories.
  - **S2b:** `scaf` gain > `rand` gain, by an exact one-sided Mann–Whitney test. As for H1, an unresolved gain in either arm makes S2b uninformative, with slot p = 1.
- **S3 (R1″ at boundary 34).** Exactly the heredity replication's design:
  - its transmission assay, recording the trait at every assay census (every 100 steps, independent of the histories' census);
  - the crossing-time trait, OLS covariates, ICC and permutation test;
  - the positive control (the P2 ranking worlds) and the null-calibration gate (four mutation-off clone worlds, at most 1 of 4 significant).
  - Sources are the histories' boundary-34 pre-cycle checkpoints.
  - S3's p, per arm, is the binomial upper tail of the count of histories with ICC > 0 and p < 0.05, under a per-history null rate of 0.05. With 24 histories, 5 gives p = 0.006 and 6 gives p = 0.001, before Holm.
  - The `scaf` test enters the family; `rand` is reported with the same statistic.
  - A failed control gate makes S3 uninformative, and its family slot is then p = 1.

## Descriptive (never decision inputs)

- every competence, advantage and swap competence, as successes out of 256 for ordinary sets and 512 for the swap pair, and out of 64 for each replicate alone;
- `Ga-on-Fe` competences;
- retained B+P and E distributions of every set's fragments, the truncation report, and success within retained-mass bins (the mass confound of the unmatched H1 comparisons; the matched test is H2);
- mean pond trait per boundary, extinct ponds at boundary 100, ended histories;
- R4: `evaluateBatch` with `DEFAULT_EVAL` (its own seed 1 and 4 replicates) on the dominant genome of every history's source (a) and on the ancestor;
- a side-by-side with protocol v1's and the R3 replication's numbers.

## Validity, missing data and availability

Applied before any test, in this order.

1. **Device check.** It is every instance's first command: preset `ponds`, condition `treatment`, seed 4,880,301, 20,000 steps (two cycles), census 1,000.
   - Its `finalHash` must equal the same spec's on the Mac.
   - If it does not, nothing runs on that instance.
2. **Infrastructure failures** are rerun with the same seeds until they complete, within the budget. Every run is deterministic, so a rerun reproduces the same result. They are:
   - instance loss;
   - a killed process;
   - input/output or network errors;
   - out of memory.
3. **Event overflow.** A history that stops on an event-buffer overflow is rerun at census 100. The physics and sources are unchanged; only the observation files differ.
4. **Unresolved failures.** These are any other failure that recurs with the same seeds:
   - a conservation violation;
   - a hash or provenance mismatch;
   - a runner or assay error.

   They are never dropped.
   - In the **sign tests** (H2, S1, S2a), an unresolved history counts as not positive. That is conservative, because a sign test's p only grows as the positive count falls and its denominator stays fixed.
   - In **S3**, an unresolved history counts as not significant, which is conservative for the same reason.
   - In the **rank tests** (H1's comparisons, S2b), an unresolved value makes the comparison uninformative (see "Primary tests").
   - If any arm, or the ancestor worlds, has more than 6 unresolved histories, the whole outcome is **uninformative**.
   - Event overflow that recurs at census 100 is an unresolved failure.
5. **Quenched gate.** If any quenched set's competence exceeds 0.05, the assay is invalid and the outcome is **invalid**, whatever else holds. A `scaf` history whose two quenched sets are not both available is unresolved, as in step 4.
6. **Biological outcomes are data.** An ended history is valid, and its competence is measured (absent fragments fail). A `scaf` source (a) with no eligible cell has no dominant genome: its g_i and d_i are scored as failures, as in H2.
7. **Reproducibility check.**
   - After the runs, two histories are chosen: the first two distinct values of `randomKey(4,880,101, 0, k, 0) mod 72`, for k = 0, 1, …, where `randomKey` is the one in `packages/schema/src/ponds.ts`. Values index the histories in seed order: `scaf` 0–23, `rand` 24–47, `cont` 48–71.
   - Each is rerun on the Mac to step 340,000, with its boundary-34 pre-cycle checkpoint.
   - That checkpoint's hash must equal the instance's. A mismatch makes the outcome **invalid**.
   - A selected history is never replaced. If one is unresolved, the check cannot be made, and the outcome is **invalid**.

## Execution order and stopping

- **Queue order** (fixed now):
  - Three instances: instance 1 takes indices i = 0–7, instance 2 takes i = 8–15, and instance 3 takes i = 16–23.
  - On each, the device check runs first.
  - Then come that instance's histories, interleaved by index (`scaf`_i, `rand`_i, `cont`_i), then its ancestor worlds, its continuations, its competence sets, and its S2 and S3 sets.
  - The S3 controls run on instance 1, after its S3 sets.
  - Retries run on the same instance, after the failed command.
  - A command that ends unresolved is terminal and counts as complete for the queue.
  - The queue manifest, with every command, is committed before the instances start.
- **No interim analysis.** Until the whole queue completes, only technical status is examined: completion, exit status, conservation flags, hashes and provenance. There is no efficacy or futility stopping and no result-driven scheduling.
- **Budget stop.** If the hard stop is reached before the queue completes, nothing is analysed. The user may approve a further dated draw that completes the same queue with the same seeds; otherwise the outcome is **uninformative**. No partial ensemble is ever analysed.

## Outcomes and disposition (first matching row)

| Outcome | Statement | Next (each a separate dated decision) |
|---|---|---|
| Invalid | The device, quenched or reproducibility check failed. | Report; no claim. |
| Uninformative | More than 6 unresolved histories in an arm, or the budget stopped the queue. | Report; decide whether to complete or rerun. |
| H1 and H2 confirmed | Both claims as stated under "What a confirmed result would and would not mean", reported separately; "heritable" only if S3 holds in `scaf`. | Next rung toward endogenisation, e.g. protocol v1's withdrawal ladder (longer removal, partial grind, migration-only dispersal), and the M7 question. |
| H1 confirmed, H2 not | Persistence beyond the controls is confirmed; the genome effect is not confirmed by this registration. The advantage may sit in community composition or physical structure. | Dissect: multi-genome swaps, community transplants. |
| H2 confirmed, H1 not | The genome effect is confirmed; `scaf`'s advantage over every control is not, and the failed comparisons are named. | Report which comparisons did not establish higher `scaf` competence, distinguishing uninformative ones. |
| Neither | Not confirmed by this registration. | Report; the exploratory results stay as recorded. |

If an unresolved value entered an H1 comparison, H1 is uninformative: it counts as not confirmed for this table, with Holm slot p = 1, and the report marks it uninformative rather than not confirmed. The secondary results are reported beside the row, with their own Holm family. They never change the row.

## Sample size

`tools/scaffold-power.ts` simulates registrations by bootstrapping per-fragment outcomes from protocol v1's R3 assays, the R3 replication's, and the `Ga-on-Fa` pilot.
- Each simulated index draws observed records jointly:
  - a `scaf` history: its timing-(a) and timing-(b) competences, and its swap outcomes against the pilot's `Ga-on-Fa` control on the same fragments;
  - a `rand` and a `cont` history;
  - independently, an ancestor world: its (a) fragments and its (b) competence.
- It then draws fragments independently: 4 replicates per set, and 8 for the swap pair.
- The tests above are applied to each simulated registration: 400 per design; Monte Carlo standard error about ±0.01–0.025.
- Output: `experiments/scaffold/registration-power.json`.
- These are estimates conditional on the observed histories, not general bounds. Applying a swap profile to an independently grown ancestor world assumes the genome's response on ancestral material does not depend on which ancestor world supplies it.

Estimated probability of confirming H1 and H2 (Holm, α = 0.01):

| Histories per arm | Both data sets | v1 only (two `rand` histories near `scaf`) | R3 replication only | Both data sets, 10% of genomes without a gain |
|---|---|---|---|---|
| 8 | 0.87 | 0.61 | 1.00 | 0.39 |
| 12 | 0.97 | 0.86 | 1.00 | 0.64 |
| 16 | 0.998 | 0.93 | 1.00 | 0.75 |
| **24** | **1.00** | **0.99** | **1.00** | **0.96** |

- **H1** is limited by `rand`, which matched `scaf` in one v1 history (0.992 against 0.953).
- **H2.** Against the matched control, every one of the 12 observed evolved genomes gained, by 1–8 fragments of 128, and on no fragment did the control win. So H2's estimated power is about 1 on the observed data.
  - The last column is a sensitivity scenario the data cannot generate: it forces 10% of simulated `scaf` histories to a non-positive gain (g = 0).
  - With 24 histories the sign test needs 19 positive; with 16 it would need 14. Twenty-four histories are what keep H2 robust to a minority of genomes without a gain (0.96 against 0.75 at 10%).
  - With only 4 replicates for the swap pair, H2's power drops to 0.83–0.92 at 8 histories and stays near 1 from 12. At 24 histories, 8 replicates cost about 1.9 × 10⁶ steps more.
- **S1** was rejected in none of the simulations (unadjusted rate 0), because under the matched control the genome gain is under half the advantage in every observed history. Its ratio estimate and interval are the informative output.
- **Limits:**
  - the bootstrap resamples 12 observed histories per arm and two ancestor worlds;
  - the pilot's control was measured on 128 fragments per ancestor world;
  - real variation between histories may be larger.

## Seeds (block 4,850,001–4,899,999, reserved for this registration)

- **Histories:** 4,850,001 + 100·arm + i (arm 0 `scaf`, 1 `rand`, 2 `cont`; i 0–23).
- **Ancestor worlds:** 4,850,401 + i.
- **Continuations (b):** 4,850,501 + h, with h = 24·arm + i for the histories (0–71) and 72 + i for the ancestor worlds (72–95); at most 4,850,596.
- **Competence assays:** σ(h, t, s) = 4,851,001 + 100·h + 10·t + s, with t 0 = (a), 1 = (b) and s 0–3; at most 4,860,514.
  - `Ge-on-Fa`_i and `Ga-on-Fa`_i use σ(72 + i, 0, s) with s 0–7. Their first four replicates are therefore the same fragments as ancestor_i's own set at (a).
  - `Ga-on-Fe`_i and the quenched sets use `scaf`_i's σ.
- **S2:** seed(h, t, v, s) = 4,861,001 + 100·h + 20·t + 10·v + s, with h 0–47 (`scaf` and `rand`), t 0 = time 0, 1 = time C, v 0 = raw, 1 = disc, and s 0–1. At most 4,865,732.
  - As v1's R2 does, both inocula sample their fragments with seed(h, t, 0, s), so the disc inoculum's genomes are those of the raw inoculum's fragments.
  - The assay world's physics uses seed(h, t, v, s).
- **S3:** 4,866,001 + 250·h + s, with h 0–47 the histories, 48–49 the positive controls and 50–53 the negative controls; s 0–1 the replicates, 8 the permutation stream and 9 the donor selection. At most 4,879,260. Negative-control worlds: 4,880,001–4,880,004.
- **Other:**
  - reproducibility draw 4,880,101;
  - S1 bootstrap 4,880,201;
  - device check 4,880,301.
- No seed in this block is used by earlier work. Checked on 2026-10-01 against every reserved range in `docs/`, `plans/` and the sibling workspaces' docs.

## Code to build before any run

Built after the freeze and before any instance starts: tested, reviewed by Astra, and committed. Production never uses `--allow-any-seed`.
- **Runner: opt-in pre-cycle checkpoints.**
  - An optional `RunSpec` field listing boundaries, absent by default. At each listed boundary the runner writes the pre-cycle state (and observer) as `checkpoints/b<NNN>-pre.blck`, with its state hash, in the manifest. For `cont`, that is the state at the boundary step.
  - Default runs and every existing preset's bundle, digest and identity stay byte-identical, as in integration acceptance test 1.
  - The runner's continuation guard already refuses to continue from such a state.
- **Runner-bundle sources** in `tools/scaffold-assays.ts`: load a source by its manifest-recorded hash, and run continuations (b) from it.
- **Labels, seeds and provenance** for this block (`reg1`), as for `r3rep`:
  - each seed checked against its formula;
  - each source's path, state hash, seed, mutation rate and step;
  - this document's SHA-256 in every `assay.json`.
- **The `Ga-on-Fa` variant,** 4 replicates per set and 8 for the swap pair.
- **A report stage** (`scaffold-report.ts reg1`): validity, missing data and availability as above, the primary and secondary tests, and the descriptive outputs, written to `experiments/scaffold/readouts/reg1.json`.
- **Tests:**
  - the exact tests against brute-force enumeration on small samples;
  - the decision procedure on crafted inputs: every outcome row, the quenched gate, unresolved-value scoring, missing dominant genomes and the budget stop;
  - seed formulas and ranges;
  - pre-cycle checkpoints on `ponds-small`, matching the state before the cycle and leaving the post-cycle history unchanged.
- **Operations:** the R3 replication's queue, lanes and supervisor, generalised to three instances, with the device check as each queue's first command and the frozen queue order.

## Compute and budget

- **Steps (512²):** about 111 × 10⁶:
  - 72 histories × 10⁶;
  - 96 continuations × 2 × 10⁵ = 19.2 × 10⁶;
  - 264 competence sets × 4 × 10⁴ and 48 swap sets × 8 × 10⁴ = 14.4 × 10⁶;
  - the S2 and S3 assays, about 5.0 × 10⁶;
  - the ancestor worlds and device checks, about 0.3 × 10⁶.
- **Where:** three AWS g5.xlarge instances with six lanes each, about 8 hours. The R3 replication measured about $0.21 per 10⁶ steps on that instance type.
- **Budget:** about $23 of compute at that rate, and an estimate of about $28 with setup and idle time; hard stop $40.
  - It comes out of the cohort reserve (about $117.18 after the R3 replication), and only by a dated draw note in `docs/plan.md` approved by the user before any paid run.
  - The $60 RULE_VERSION 2 go/no-go is untouched.
- **The Mac** runs the reproducibility check and R4, at $0.

## Freeze and order of events

1. **Decided by the user (2026-10-02): approved as written.** The design choices, all as drafted:
   - 24 histories per arm, with 4 replicates per set and 8 for the swap pair (the history count was decided on 2026-10-01);
   - H2 as a sign test of direction, with the size criterion as S1;
   - two-sample tests in place of v1's paired counts;
   - the missing-data rules: failures counted against the sign tests, rank comparisons uninformative;
   - S2 and S3 as secondaries;
   - M7: a confirmed result stands as its own registered result (see "What a confirmed result would and would not mean").
2. **Freeze (2026-10-02).**
   - **Review:** a review of the final text. By the user's instruction for that day, it was done with Antigravity (`agy`) instead of Codex Astra.
   - **Commit:** the document's SHA-256 is recorded in `experiments/scaffold/REGISTRATION-v1` and in a dated freeze note in `docs/plan.md`.
   - **Use by the transition hunt.** The exploratory transition hunt (`docs/scaffold-transition-hunt-v1.md`) may branch from this registration's boundary-100 pre-cycle checkpoints of the `scaf` histories.
     - It starts only after this registration's queue has completed.
     - It reads only those checkpoint files, never an assay, report or result of this registration.
     - Those checkpoints are therefore kept after the report.
3. **Code:** built and tested as above, reviewed by Astra, and committed, with the commit recorded.
4. **Draw:** the dated AWS draw note, approved by the user.
5. **Runs and assays.** Then the report stage, an independent re-derivation of every number from the raw files, an Astra review, and the dated result entry.
