# Continuation after the first sweep — protocol

Status: **FROZEN 2026-10-02, before any new competition.** The protocol's SHA-256 is pinned by `continuation/candidate.json`, and execution is authorized only by `continuation/release.json`. The first pre-freeze review (CLEAR-WITH-FIXES) found that independently drawn midpoint genomes are mostly collateral relatives of the late genomes. The design now pairs each late genome with its own midpoint ancestor, and a second review returned CLEAR; see "Review and rework". Any later change goes in a dated amendment below; never edit this text in place.

## Question

In the improvement study, descendants at 1,000,000 steps beat their founder. In the divergence control, much of that gain came from one early sweep: cluster-33 raised its photosynthesis bias by about 300k, and cluster-139 raised `mu` by about 600k. By the abundance proxy, cluster-33 and cluster-139 then plateaued, while cluster-4 kept rising. cluster-16 never moved. Competition scores exist only at 100k and 1M, and cluster-33's score against its founder is already at the ceiling (0.99). Nobody has measured whether competitive ability kept rising after the sweep.

**The continuation test, per founder.** Do a founder's 1M descendants beat their own 500k ancestors head-to-head, by more than random mutants of those ancestors carrying the same amount and kind of genetic change?

This is the divergence control's design moved forward in time: the 500k ancestor plays the founder's role.

Results are conditional on the four deliberately discovered founders, single-founder chambers (not M4's 12-founder ecology), the gradient competition and the fixed assay seeds.

## Fixed units

**L (late): existing genomes, new competitions.** These are the improvement study's 64 normal-arm draws at 1,000,000 steps (4 founders × 8 evolution seeds × 2 draws), from the frozen report (`085d55cf…`). They are the same genomes as the divergence control's E.

**H (midpoint ancestor): each L's own ancestor genome at 500,000 steps.** It is deterministic, so no sampling seeds are used.

- **Verification.** The frozen chain loader (`loadCheckpointChain`) runs unchanged on each history's whole chain. It verifies every receipt, hash, physical state, provenance record, mutation delta, biology check and scheduled sample. The two L genomes must be the history's verified 1M sample.
- **L's lineage.** This is the heaviest 1M lineage carrying L's genome; ties go to the lowest lineage key. The count of such lineages, and whether their midpoint ancestors share one genome, are recorded.
- **H.** H is the genome of the first lineage on L's mutation-parent path, L's own lineage included, that is present in the verified 500k state. *Present* means at least one cell with nonzero B+P mass carries that lineage label. That lineage was born at or before 500k and, having a descendant born later, was alive at 500k. The 500k state is loaded the same way, with the frozen loader running unchanged on hard links truncated at 500k.
- **Recorded per pair:** the number of generations walked and the number of slots that differ between H and L.
- **Shared ancestors.** In 10 of 32 units, both pairs share one 500k ancestor lineage (cluster-33 5 of 8, cluster-4 3 of 8, cluster-139 2 of 8). Their two pairs are therefore not independent below the unit.
- **Shared configurations.** If L's lineage was already present at 500k, then H = L. That pair's late and null genomes are then clones of H; their shared configuration runs once and scores exactly 0 by position symmetry.

**N (null): two type-matched mutants per pair, 128 genomes.** Each copies the change separating H from L in kind and size:

- weight-change magnitudes go to uniformly drawn weight slots;
- each changed parameter keeps its slot and magnitude;
- signs are uniform, with the same clamp and redraw rules as the divergence control's M, applied to H.

Mutant j = 1–128 uses Mulberry32 seed 6490100 + j.

**Bootstrap seed:** 6490300. All 649xxxx seeds were checked as unused. 6490001–6490064, reserved for the earlier independent-draw design, are released unused.

**Pre-run facts** (from the roster; no competition has run):
- Every L genome is carried by a single 1M lineage, and every one has a 500k ancestor. No pair has L = H, so all 1,536 configurations are distinct, and none repeats a frozen-study configuration.
- **H→L change.** The median slot change is 10 for cluster-33 (range 7–15), 7 for cluster-4 (4–16), 17 for cluster-16 (5–27) and 14 for cluster-139 (8–26). Generations walked are similar.
- **cluster-33.** In 14 of 16 pairs H already carries the raised photosynthesis bias. Neither H nor L carries it in seed 6410002. No pair gains or loses it after 500k, though one L raised it further (99 → 119, seed 6410006). This is the clean post-sweep case.
- **cluster-139.** H carries the raised `mu` in 11 of 16 pairs and L in 13. Both pairs of seed 6410007 gained it after 500k (33 → 47), so part of any late advantage there is the sweep itself. In seed 6410002 (both pairs) and seed 6410008 (one pair), neither H nor L carries it.
- **Founder-lineage mass, mean at 500k → 1M:** cluster-33 0.73M → 0.83M, cluster-4 1.01M → 1.07M, cluster-16 2.03M → 2.04M, cluster-139 2.00M → 2.06M.

## Competition observations

The frozen assay is used unchanged: gradient chamber, 20,000 steps, mutation disabled, assay seeds 6430001–6430004, assignments 0 and 1. Each pair runs 8 competitions:

- **L against H,** with L in the descendant role, so a positive score means the late genome wins;
- **each N against its H.**

That is 512 + 1,024 = 1,536 requested competitions, fewer if any are shared. In addition, 8 replays of frozen originals (2 per founder) and per-invocation audits run, as in the divergence control.

The invocation and provenance records in this study's output carry the divergence-control format names by design, because the invocation core is reused unchanged. The output directory, the candidate and release formats, and the study identity bound into every record keep the two studies apart.

## Estimands and decision

These follow the divergence control. Average each genome's 8 competitions, then the two mutants of each pair, then the two pairs of each founder × seed unit. Unavailable scores take their full [−1, 1] range in the bounds. A value is certified when its lower bound is strictly above 0.10.

**The continuation test (confirmatory, four separate tests, one per founder).**
- The unit contrast is L − N, with lower bound L lower − N upper.
- A founder meets the test with at least 7 of 8 certified seeds and a technically complete study.
- Each test's exact one-sided tail is 9/256 under independent seeds, and there is no family-wise claim. Units share their founder and the four assay seeds, and in 10 units the two pairs share an H. The tail is therefore optimistic. As in the divergence control, "certified" means the observed mean exceeds 0.10 when nothing is missing; the bounds carry no sampling uncertainty.

**Progress is counted per seed.** Separately, count the seeds in which L's own lower bound against H exceeds 0.10. This is the "late-certified" count, and it prevents a founder-level mean carried by a few large seeds from reading as progress.

**Readings, fixed now and evaluated in this order:**
1. *technically incomplete*, if any completeness condition fails;
2. *not met*: no evidence that change since the midpoint beats random change of the same size. This is not evidence that adaptation stopped;
3. *met, not clearly progressing*: met, but fewer than 7 of 8 seeds are late-certified. Late genomes beat random change of their size but do not clearly beat their own ancestors;
4. *met, continued beyond divergence*: met, at least 7 of 8 seeds late-certified, and the founder-level N lower bound ≤ 0.10;
5. *met, partly divergence*: met, at least 7 of 8 seeds late-certified, and N lower > 0.10.

**Descriptive only.** All of these are computed by the analyzer from the roster or the results, fixed before any result exists:
- L against H per founder and seed;
- the pooled block rule and its whole-block bootstrap;
- per founder: median H→L slot change and generations, pairs with L = H, mean founder-lineage mass at 500k and 1M, and median distinct genomes at 500k;
- for cluster-33 (`b2[PHOTO]`) and cluster-139 (`mu`): pairs whose H carries the swept increase, whose L carries it, and that gained or lost it after 500k.

**Technical completeness:** every requested result, all 8 replays matching, and an audit for every invocation that did work.

## Power

The divergence control's per-draw spread suggests a unit-contrast standard deviation of roughly 0.15–0.4. That spread comes from founder-versus-descendant pairs; for these closer ancestor-descendant pairs it is unmeasured. Under it, 80% power under the 7-of-8 rule at 0.10 needs a true unit contrast of about 0.3, 0.4 or 0.6 at a spread of 0.15, 0.25 or 0.4. At a true contrast of 0.2–0.3, "not met" is a likely outcome even when adaptation continues. The study detects only large continued gains reliably.

## What the outcomes mean for M4

**cluster-33 decides.** Its sweep was complete before 500k in 7 of 8 seeds; seed 6410002 never swept (pre-run facts above). It is the clean test of adaptation after a completed first sweep. The other founders are reported per founder and support, but do not decide:
- cluster-4 had no single sweep;
- in cluster-139 the sweep is incomplete or reversed in some seeds;
- cluster-16 never improved.

| cluster-33 reading | For the M4 pivot |
| --- | --- |
| Met, continued beyond divergence, or met, partly divergence | Adaptation continues after a completed first sweep: selectable variation is not used up within the window. The evolvability pivot is not indicated by this evidence. Proceed to the fresh M4 ensemble under the amended endpoint 2, unchanged physics. |
| Met, not clearly progressing | Inconclusive. Late change is better than random change but not clearly better than its ancestor; no stall claim. |
| Not met | Inconclusive. Given the power above, this is not evidence of a stall, and it cannot support the physics-change pivot. The pivot decision rests on other evidence: the fresh M4 ensemble under the amended endpoint 2 tests continued activity directly. |
| Technically incomplete | No reading. |

If cluster-16 reads continued or partly divergence, the assay or design may be detecting something other than adaptation, since cluster-16 never improved over its founder. Recovery from a decline between its measured points is the alternative explanation. The other founders' readings are then reported as uninterpretable for M4.

## Execution, budget and review

- **Code.** No divergence-control file is changed, so that study's release still verifies on the current tree.
  - `tools/discovery_continuation.ts` (generator) and `tools/lib/discovery-continuation.ts` (ancestry, roster, analysis) are new.
  - `tools/discovery_continuation_run.ts` (candidate, release, status, run, supervise, resolve, stop) is new. It imports the divergence-control invocation core unchanged: replays first, atomic results with provenance, per-invocation audits, budget, lock, signal, stop and recovery rules.
  - `tools/discovery_continuation_analyze.ts` is new. It uses the divergence-control collector unchanged.
  - The candidate re-verifies every history and re-traces every ancestor, requires the roster to be the generator's exact output, and pins the 500k and 1M receipts of every history. A candidate that re-derived only some histories never verifies as released.
  - Scratch hard links live in a temporary directory directly under `runs/`, outside the frozen study's tree, and are removed after use.
- **Budget.** At the 12.4 s per competition measured over the divergence run, including all overhead, 1,544 competitions plus audits take about 19,600 s (5.4 hours) over about 35 invocations. The cap is 30,000 s and 70 invocations of at most 600 s each. The run is local, on owned hardware, at $0, with a 20 GiB free-storage floor.
- **GPU path.** The 8 opening replays use founder ancestors only. No competition with a non-founder ancestor has run on the GPU. `executeAssay` has no founder gate, and the tests build every requested competition world, so none is expected to fail. If one does, its invocation fails with its full charge, supervision stops, and no result is affected. No study configuration is run outside the released study.
- **No interim analysis**, unless the study is formally stopped.
- **Review.** A fresh independent review (round 2) checked the rework before freezing: CLEAR.
- **Execution.** The run is supervised under `caffeinate -i`, with the GPU otherwise idle, since the ledger charges wall-clock time.

## Review and rework (pre-freeze, 2026-10-02)

The first independent review (`continuation/reviews.json`, round 1) re-derived the roster and analysis exactly but returned CLEAR-WITH-FIXES on design.

- **F1.** Independently drawn midpoint genomes were on the late genome's own lineage in only 7 of 64 pairs. The null therefore applied about 2.3× the real post-midpoint change. Fixed by pairing each L with its own 500k ancestor.
- **F2.** The M4 table read "not met" as a stall without an operational definition or power. Fixed by the table above.
- **F3.** Progress was counted only through a founder-level mean. Fixed by the per-seed late-certified count.
- **F6.** The descriptive items had no code. Fixed: they are computed from the roster before any result exists.
- **Lower-severity items:**
  - the candidate's re-derivation is recorded and enforced;
  - midpoint receipts are pinned;
  - the scratch area moved out of the frozen tree;
  - the budget figure is unified;
  - the reading order, independence caveat and format-name note are stated;
  - plan-refusal and pin-drift tests were added.
- **Not adopted, F4.** The same-time H0-versus-H1 baseline answers the independent-draw design, which ancestor pairing replaces.

**Round 2: CLEAR, no required fix.** Its optional suggestions are handled as follows:
- **Adopted as wording:** N1 (shared ancestors), N2 (cluster-33 seed 6410002), N3 (power), N6 (`caffeinate`), N7 (the cluster-16 alternative) and N8's definition of *present*.
- **Not adopted:**
  - N4, a cross-check of pinned receipts against the roster in `released()`. It is hardening only, and the candidate builds both consistently.
  - N5, a non-study GPU competition with a non-founder ancestor. A failure costs at most one invocation, and no study configuration runs outside the release.
  - N8's negative test for the 1M-sample binding. The reviewer checked it by hand.

## Decisions (user, 2026-10-02)

1. **Midpoint:** 500k.
2. **Null:** two type-matched mutants per pair, the default.
3. **Founders:** all four, the default, with cluster-16 as the no-adaptation reference.
4. **Run:** start once the reviews come back clear.
