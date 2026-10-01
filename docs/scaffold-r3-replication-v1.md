# Scaffold R3 replication: protocol v1 (sandbox, fixed before any data)

*2026-10-01. Opened by the user's decision after the R1″ result in `docs/scaffold-heredity-replication-v1.md`. It reruns protocol v1's R3 (removal: propagule competence) on fresh histories, with a design fixed before any of its data exist. The line is still exploratory and not registered, does not answer the reset line's entity question, and does not count toward M6. After the first run of this protocol starts, any change to this document goes in a dated amendment at the end.*

## Question

Does protocol v1's R3 result replicate on fresh histories? In v1, R3 was decisive by its rule but at the threshold: the advantage held in 5 of 6 histories, and the swap criterion in exactly 4 of 6, with margins of −3.5 to +3.5 fragments out of 128.

**What earlier data informed.** Nothing new is chosen here except seeds, the history extension and the fresh comparators. R3's design, thresholds and rule are protocol v1's, unchanged. The fresh `scaf` and `rand` histories' first 34 cycles have been seen: their frames, and the R1″ assays at boundary 34. No state past boundary 34, and no competence assay of these histories, exists.

## Histories

All runs use protocol v1's frozen main configuration (`experiments/scaffold/main-config-v1.json`): 64 ponds at 512², ancestor `M3_FOUNDERS[2]`, k 8, period 10,000, D 16, the default mutation rate, census every 100 steps, C = 100 cycles. `tools/scaffold.ts` and `tools/lib/ponds.ts` are unchanged since the main run.

- **`scaf` and `rand` (arms 0 and 1):** the 12 fresh histories of the heredity replication, seeds 4,811,001 + 100·arm + i, i = 0–5.
  - Each is copied from `runs/scaffold/rep/main/<arm>/i<i>` to `runs/scaffold/r3rep/main/<arm>/i<i>`. Every copied file's SHA-256 must equal its original. The originals are never resumed, because `--resume` deletes pre-cycle checkpoints other than the final one, and the R1″ assays reference `b34-pre`.
  - The copy is resumed from `b34-post` with `--cycles 100` and otherwise the original flags (`--arm <arm> --init clone --k 8 --period 10000 --side 8 --seed <seed> --frames --resume`).
  - **Equivalence.** The cycle and its PRNG keys depend on the boundary, not on C, so the extended history's dynamics equal a 100-cycle run from the start. Only logging differs: lineage snapshots, checkpoints and frames follow the 34-cycle schedule up to boundary 34.
- **`cont` (arm 2):** 6 new histories, seeds 4,811,301 + i, i = 0–5, with `--arm cont --init clone --period 10000 --cycles 100 --side 8 --frames`. The formula's arm-2 seeds (4,811,201 + i) are not used, because 4,811,201–4,811,204 are the R1″ negative-control worlds.
- **Ancestor source:** a new clone world grown one period, as P1's calibration source was. That is `--arm cont --init clone --period 10000 --cycles 1 --side 8` at seed 4,818,401, mutation on. Its source (a) is `ckpt/b1-pre.blck.gz`.
- **Device check (before any extension).** The first 34 cycles ran on the Mac (Apple M1 Max). The extension and every other run of this protocol run on AWS (NVIDIA A10G).
  - Before any extension, a scratch copy of `scaf` i0 has its `b34-pre` and `b34-post` removed and is resumed from `b22-post` with `--cycles 34` on the instance.
  - Its `b34-pre` and `b34-post` state hashes, and its `ponds.tsv` and `lineages.tsv`, must equal the Mac originals byte for byte.
  - If they differ, nothing else runs; the instance is torn down and the mismatch is reported.
- **Extinction.** A `scaf` or `rand` history ends early when no pond is eligible at a boundary (no cell with B+P ≥ 48), so no donor exists. That is a biological outcome, and valid. `cont` has no cycle and always runs to boundary 100.
  - An ended history's terminal pre-cycle checkpoint `b<e>-pre` is its source (a). It is continued and assayed exactly like any other source. Cells below the eligibility threshold can still grow during the continuation, so (b) is measured, not assumed.
  - A source with no eligible pond yields absent fragments, which fail (v1's standard-fragment rule).
  - A `scaf` source (a) with no eligible cell has no dominant genome, so its `Ge-on-Fa` set cannot exist. The tool records that set as biologically unavailable (a validated record with no rows). The history stays valid and fails the swap criterion; its advantage is evaluated as usual.

## R3, as in protocol v1

Everything in this section is protocol v1's R3 (`docs/scaffold-protocol-v1.md`, sections "Assay world", "Standard fragment", "Competence of a source world" and "R3"), with ref = 103,058 (Amendment 1). Only the seeds are new.

- **Source worlds**, per history h:
  - **(a)** the pre-cycle state at boundary 100, `ckpt/b100-pre.blck.gz` (for `cont`, the state at step 10⁶);
  - **(b)** that state run 2 × 10⁵ further steps with no cycle and mutation on (`scaffold-assays.ts continue`).
- **Ancestor:** (a) is the ancestor source above; (b) is that world continued the same way.
- **Competence:** of every source world, with replicates s = 0–1, so 128 standard fragments, k = 8, one period of 10,000 steps, mutation off, in fresh assay ponds with M_assay = 151,552. A fragment succeeds when its pond trait is at least 0.25·ref and at least 4× its retained landed B+P.
- **Dominant genome:** the lineage with the largest trait mass (cells with B+P ≥ 48) in the `scaf` history's source (a); ties go to the smallest (hi, lo).
- **Swap arms**, for each `scaf` history i, on the same physical fragments:
  - `Ge-on-Fa`: fragments from the ancestor's source (a), with every cell's genome words replaced by G_e under one fresh id;
  - `Ga-on-Fe`: fragments from the history's source (a), with genomes replaced by `M3_FOUNDERS[2]` under one fresh id.
- **Quenched control:** on every `scaf` source, at both timings.
- **Advantage:** adv_i(X) = competence(`scaf`_i) − competence(X), where X is `rand`_i, `cont`_i (paired by i) or the ancestor, at the same timing.
- **Decisive if all hold:**
  - adv_i(X) > 0 for every X at both timings, in at least 4 of 6 histories i;
  - competence(`Ge-on-Fa`_i) − competence(ancestor) ≥ 0.5 · adv_i(ancestor) at timing (a), in at least 4 of 6 histories i;
  - no quenched control exceeds 0.05. If one does, R3 is unreliable and not decisive.
- **Unmatched comparisons:** retained B+P and E distributions of every source's fragments are reported, as in v1.

## Seeds

- **Competence assays:** σ(h, t, s) = 4,816,301 + 100·h + 10·t + s.
  - h = 6·arm + i for the histories (0–17; arm 0 `scaf`, 1 `rand`, 2 `cont`), and h = 18 for the ancestor;
  - t = 0 for timing (a), 1 for (b);
  - s = 0–1, the replicate.
  - σ seeds both the fragment sampling and the assay world's physics. Every variant of one source and timing uses that source's σ (common random numbers): `Ga-on-Fe` and the quenched control use the `scaf` history's σ. `Ge-on-Fa` takes its fragments from the ancestor's source (a), so it uses σ(18, 0, s), the same as the ancestor's own set at (a).
  - The block's maximum is 4,818,112.
- **Continuations (timing b):** 4,818,301 + h, h = 0–18.
- **Worlds:** `cont` 4,811,301–4,811,306; ancestor 4,818,401.
- Every seed is checked to be unused by earlier work in the 4,800,001–4,849,999 block. The R1″ assays end at 4,816,260.

## Code to build before any run

- **Labels and validation** for this block (`r3rep`) in `scaffold-assays.ts`, for `continue` and every `competence` variant:
  - each seed against the formula, for the labelled arm, history, timing and replicate;
  - the source: for (a), `ckpt/b100-pre.blck.gz` of the labelled history's run directory under `runs/scaffold/r3rep/main/` (or the ended history's terminal `b<e>-pre`, with `done.json` saying so), with the history's seed, the default mutation rate and step 10⁶ (or `e`·10⁴); the ancestor's `b1-pre` at seed 4,818,401 and step 10,000; for (b), a continuation whose recorded provenance names that (a) source, its state hash, the continuation seed and 2 × 10⁵ steps;
  - the variant's sources:
    - `Ge-on-Fa`: the fragment source is the ancestor's (a), with σ(18, 0, s); the genome donor is the labelled `scaf` history's (a). Both are validated, both state hashes are recorded, and the replacement words are recorded with their id and checked to equal that donor's dominant genome under the tie rule;
    - `Ga-on-Fe`: the fragment source is the labelled `scaf` history's (a), with that history's σ; the genome is `M3_FOUNDERS[2]` and nothing else;
    - quenched: the labelled `scaf` history's source at the labelled timing, with its σ;
  - the regime: `--k 8 --period 10000 --ref 103058 --side 8 --replicates 2 --census 100`;
  - provenance recorded in `assay.json`: the source path and state hash, its world seed, mutation rate and step, and the SHA-256 of this document.
- **A report stage** (`scaffold-report.ts r3rep`) that validates every set's labels, seeds, provenance and completeness, collects per-set failures as unavailable sets rather than stopping, applies the availability rule below, evaluates R3 with v1's evaluation, and writes the readout `experiments/scaffold/readouts/r3rep.json`.
- Production runs never use `--allow-any-seed`. This document is committed before any run, and the code is committed, with its commit recorded, before the instance starts.

## Rule (fixed now)

Applied in this order:

1. **Device check.** It must pass, or nothing else runs.
2. **Availability.**
   - A set is technically available when its `assay.json` and `assay.tsv` are complete (the full, unique 2 × 64 grid of replicate and pond) and its validation passes. A failed or incomplete set, continuation or history is rerun once with the same seeds. If it still fails, it is technically unavailable.
   - A biologically unavailable `Ge-on-Fa` set (no dominant genome; see "Extinction") is not a technical failure.
   - A history i is available when all of its sets are available, technically or as that biological record: `scaf`, `rand` and `cont` at (a) and (b), both swap arms, and both quenched controls. An unavailable history counts as failing both criteria.
   - **Quenched controls, checked first.** Any available quenched control above 0.05 makes R3 unreliable, whatever else is missing: the result is "does not replicate". Otherwise, all 12 quenched controls must be available, or the replication is uninformative.
   - Both ancestor sets must be available, or the replication is uninformative.
   - If fewer than 4 histories are available, the replication is uninformative.
3. **Rule.** R3 replicates if it is decisive, as defined above, over the 6 histories.
4. **Descriptive, never decision inputs:**
   - every competence, advantage and swap competence, and each criterion's margin in fragments;
   - each replicate's competences alone;
   - retained B+P and E distributions, and the truncation report as in v1;
   - mean pond trait trajectories to boundary 100, and extinct ponds at boundary 100;
   - a side-by-side with v1's R3 numbers.

## Disposition

- **R3 replicates.** Protocol v1's R3 result replicates on fresh histories, by a design fixed in advance. Re-entering v1's decision table with R1″ (fresh histories), R2 (as recorded on the v1 histories) and the replicated R3 reaches row C: integrate the cycle into the runner and lab, then draft a registration for a confirmatory scaffolding ensemble. Each of those is a separate dated decision. R2 has not been replicated on fresh histories, and that limitation is carried.
- **R3 does not replicate** (available, not decisive, or unreliable). v1's R3 result does not replicate. The table, with R1″ and R2 as recorded and R3 not decisive, reaches row B: integrate, then a withdrawal ladder re-testing R3 at each rung. That is a separate dated decision. Which criterion failed is reported.
- **Uninformative.** Report it and stop.
- **Earlier results.** Whatever the outcome, v1's R3 result stays recorded as it is in `docs/scaffold-protocol-v1.md`.

## Compute and budget

- **Total:** about 19 × 10⁶ 512² steps:
  - the device check, 1.2 × 10⁵;
  - 12 extensions × 6.6 × 10⁵;
  - 6 `cont` histories × 10⁶, and the ancestor world, 10⁴;
  - 19 continuations × 2 × 10⁵;
  - 62 competence sets (38 sources, 12 swaps, 12 quenched) × 2 × 10⁴.
- **Where:** one AWS g5.xlarge with six lanes (protocol v1's runs measured about 226 steps/s per lane), about 4 h.
- **Budget:** estimate about $5, hard stop $10, under the dated draw note in `docs/plan.md`.

## Results (2026-10-01)

**Run and provenance.**
- **Order of events:** the protocol was committed (4838f400) before any run, and the code (5aa706d2) before the instance started.
- **Device check: passed.** On the A10G, `scaf` i0's cycles 23–34 reproduced the Mac's `b34-pre` and `b34-post` state hashes, `ponds.tsv` and `lineages.tsv` byte for byte.
- **Histories:** all 18 completed 100 cycles with exact conservation, and none ended early.
- **Truncation:** none, in the histories or in the 7,936 assay rows.
- **Queue:** all 101 commands finished on their first attempt (no retry, no failure).
- **Screening:** all 62 sets passed, and all 38 recorded checkpoints were reloaded and verified (none unverifiable).
- **Independent re-derivation:** a separate re-derivation from the raw tables, by a different method, reproduced every number and every recorded success flag (7,936 of 7,936). Seeds, continuation provenance, copies and lane records all check out.
- **Readout:** `experiments/scaffold/readouts/r3rep.json`.

**Rule.**
- **Quenched controls:** 0 in 12 of 12.
- **Availability:** both ancestor sets and all 6 histories are available.
- **Result: R3 replicates.** The advantage over `rand`, `cont` and the ancestor at both timings holds in 6 of 6 histories, and the swap criterion in 6 of 6. The rule needs 4 of each.

Competences (out of 128 fragments; ancestor (a) 0.875, (b) 0.672):

| i | `scaf` a | `rand` a | `cont` a | `scaf` b | `rand` b | `cont` b | `Ge-on-Fa` | swap margin (fragments) |
|---|---|---|---|---|---|---|---|---|
| 0 | 0.977 | 0.836 | 0.633 | 0.945 | 0.859 | 0.695 | 0.930 | +0.5 |
| 1 | 0.984 | 0.000 | 0.727 | 0.930 | 0.062 | 0.688 | 0.938 | +1 |
| 2 | 0.977 | 0.438 | 0.523 | 0.961 | 0.445 | 0.641 | 0.945 | +2.5 |
| 3 | 0.961 | 0.773 | 0.727 | 0.961 | 0.742 | 0.688 | 0.930 | +1.5 |
| 4 | 0.992 | 0.031 | 0.617 | 0.938 | 0.055 | 0.688 | 0.938 | +0.5 |
| 5 | 0.984 | 0.766 | 0.664 | 0.969 | 0.641 | 0.594 | 0.930 | 0 |

**Disposition, by the rule.** Protocol v1's R3 result replicates on fresh histories, by a design fixed in advance.
- Re-entering v1's decision table with R1″ (fresh histories), R2 (as recorded on the v1 histories) and this R3 reaches row C: integrate the cycle into the runner and lab, then draft a registration for a confirmatory scaffolding ensemble.
- Each of those is a separate dated decision.
- R2 has not been replicated on fresh histories.
- v1's R3 result stays recorded as it is.

**Caveats (from the re-derivation; not decision inputs).**
- **The advantage is large and robust.**
  - Smallest margins are 11–15 fragments per history.
  - It holds 6 of 6 in each replicate alone, and 5 of 5 with any one history dropped.
  - Mass does not obviously explain it. At timing (a), `scaf` fragments have the lowest median retained B+P of the sources. Within the [2,500, 3,500) bin, pooled over histories, `scaf` succeeds 475 of 475, against `cont` 133 of 254. That is one bin, so it does not rule out confounding by mass.
- **The swap criterion passes at the threshold again.**
  - Margins are 0 to +2.5 fragments (v1: −3.5 to +3.5). i5 passes at exact equality, 7/128 ≥ 7/128.
  - Replicate 0 alone gives 6 of 6, replicate 1 alone 0 of 6.
- **The six swap tests are not independent.**
  - By v1's pairing design, every `Ge-on-Fa` set uses the ancestor's own fragments and physics streams (σ(18, 0, s)).
  - In replicate 1, all six evolved genomes score 58 of 64 on the same fragments, against the ancestor's 57.
  - Seven small ancestor fragments (retained B+P 1,172–1,690) are dead under every genome, six of them in replicate 1. Each dead fragment lowers the ancestor's competence and so raises the bar, while the gain stays the same.
  - So 6 of 6 is one fragment draw tested with six genomes, not six independent confirmations.
- **The direction of the genome effect is consistent.** In each history, `Ge-on-Fa` beats the ancestor on 7–9 paired fragments and loses on none (exact McNemar p 0.004–0.016 each, not independent across histories). What sits at the threshold is its size, "at least half the advantage", not its sign.
- **`Ga-on-Fe` is 0.031–0.062.** The ancestor genome mostly fails to grow in evolved fragments. No failure comes from the 4× requirement alone: every failed fragment also misses the 0.25·ref growth threshold.
  - The pattern is consistent with size-dependent establishment, which was not tested: the ancestor genome also fails on its own fragments below 3,500 retained B+P, and evolved genomes establish from smaller inocula.
  - If so, it would also limit the matched test's headroom on the ancestor's heavier fragments.
- **Ceilings:** the ancestor at (a) and the `scaf` sets sit near the competence ceiling.
- **For the separate registration decision (a recommendation, not part of this rule):** a confirmatory design should test the genome swap with independent fragment draws per history and more replicates.

**Descriptive.**
- **Mean pond trait, boundary 1 → 100:**
  - `scaf` 100,687–103,926 → 131,226–139,128;
  - `rand` → 5,158–105,029 (two histories collapsed to about 5,000);
  - `cont` → 129,541–131,180.
- **Extinct ponds at boundary 100:** `scaf` 0–4, `rand` 1–13, `cont` 0.
- **Cost:** $3.94 on one g5.xlarge, about 4 h.

## Post hoc note (2026-10-01): the swap control was not genome-only

*Written after the result, for the registration draft (`docs/scaffold-registration-v1.md`). It is not a decision input and changes no recorded number or rule.*

- **The comparison as run.** The swap criterion compared `Ge-on-Fa` with the unmodified ancestor set.
- **Why that is not genome-only.** The ancestor source world carries mutants after its period, and lineage ids enter the physics. So that comparison also removes the mutants, not only the evolved genome.
- **The pilot.** A Mac pilot ran the matched control `Ga-on-Fa` (`M3_FOUNDERS[2]` relabelled onto the same fragments, with the same seeds) on this replication's ancestor set and on protocol v1's. Outputs are in `runs/scaffold/reg-pilot/`.
- **Results.**
  - It founds 117 of 128 here, against the ancestor set's 112, and 111 against 105 in v1.
  - Against it, each evolved genome gains 2–4 fragments of 128 here, and 1–8 in v1.
  - No fragment goes the other way.
- **Reading.** The direction of the genome effect holds in all 12 histories. Its size does not reach half the advantage over the ancestor in any of them. The swap criterion's passes rested mostly on the control's mutants.
