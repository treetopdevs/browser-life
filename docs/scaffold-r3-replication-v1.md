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
