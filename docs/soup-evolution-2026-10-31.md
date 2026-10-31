# Does evolution continue after the copiers take over? (2026-10-31)

The BFF program soup (`tools/soup*`, a byte-exact port of cubff) produces self-copying programs from random bytes:
- In well-mixed 2^17 soups, seeds 2, 6 and 8 out of 8.
- On the 240 × 135 grid, seed 1. Grid seed 2's "transition" at 38,913 was a false alarm: a short entropy blip in which every program stayed distinct.

The question here is what happens **after** the first copiers win. There are three possible answers:
- One copier wins and nothing more happens.
- Copiers keep replacing each other at random (drift).
- Later copiers are better than earlier ones (adaptation).

This note fixes the method and decision rules before any of the long runs below has finished. The readout goes at the end, in a dated section, and the rules above it are not edited afterwards.

## Lineages and runs

The four lineages are the soups that produced copiers:

| key | soup | resumed from (T0) | runs to | snapshot every |
|---|---|---|---|---|
| wm2 | well-mixed 2^17, seed 2 | 12,609 | 45,056 | 512 |
| wm6 | well-mixed 2^17, seed 6 | 4,609 | 36,864 | 512 |
| wm8 | well-mixed 2^17, seed 8 | 3,265 | 36,864 | 512 |
| g1 | grid 240 × 135 r2, seed 1 | 21,057 | 53,248 | 256 |

All four already hold copier families at T0 (copy test 64/64). Everything uses the paper's mutation rate (1 in 4,096 bytes per pairing).

The runs are `tools/soup.ts --load <T0 snapshot> --save 512` (256 for the grid), started from the queue in `runs/soup/evo-queue.txt`. A resumed run equals a continuous run, so these are the same soups as before, only longer.

## Revision before results

The first draft of the rules below was revised on 2026-10-31, before any long-run analysis or assay result existed, after two things:

- A Codex Sol review of the draft.
- A 128-epoch pilot of one pair assay and one neutral assay on the wm6 and wm8 T0 snapshots. The pilot showed that neutral drift in a 4,096-program soup is large: about ±0.06 in the rare fraction after 128 epochs, and 0 to 0.6 after 512.
- A distance check on the four T0 snapshots, which showed that a fixed match radius of 16 counts random programs as copies of small copiers.

What changed:
- Zero bytes now count in type keys.
- Fixed invasion thresholds were replaced by thresholds calibrated on neutral drift.
- Assays use 16,384 programs instead of 4,096, to halve the drift (sd ≈ √(p(1−p)·t/N): about 0.14 at 4,096 and 0.07 at 16,384). In the smoke test at 4,096, neutral runs ended anywhere from 0 to 0.6.
- Match radii are now relative to type size.
- A run is invalid only when a third copier takes over, not whenever "other" is large.
- The binomial test was replaced by a permutation test over the order of the leaders.
- INSUFFICIENT EVIDENCE is now a separate verdict.
- The marker must pass through 5 generations and is chosen by a misread pilot.
- Parasites must propagate serially.
- The headline rules now cover every case.

## Definitions (`tools/soup/evo.ts`)

The pilot on the T0 snapshots found that copiers come in mirror pairs: a copier writes its copy back to front, sometimes shifted, so every lineage appears as two families with near-equal counts (wm6: 4,537 and 4,536).

- **Copy test**: cubff's CheckSelfRep (`selfRep` in `tools/soup/bff.ts`, seed 0). It runs the program against 13 fixed noise partners for 1 + 4 generations and counts the byte positions that recur in more than 3 of the 13 runs; the result is the smaller count of the two halves, 0..64.
  - A **copier** or **host** scores at least 48.
  - A **non-copier** scores at most 16.
- **Key** of a program: its 64 bytes with instructions kept, zero bytes as `0` and every other byte as `_`. Loops test for zero, so zero is kept apart. Other data bytes mostly drift neutrally, but not always: types that differ only in non-zero data are merged, which can hide an adaptation carried by data bytes.
- **Family**: the programs with one key. Only programs with at least 6 instructions are keyed.
- **Type**: the class of a key under the 128 transforms "optionally reverse, then rotate by r". Its canonical key is the smallest of the 128 strings, and its id is FNV-1a-32 of that key. Rotated and reversed programs run differently, so the class does not claim the forms behave the same. It groups the forms one lineage alternates between. Assays always seed exact programs, never classes.
- **Representatives**: the most common exact program of the type's largest family (ties go to the smaller byte string), plus the most common exact program of the largest other family whose key is a reversed transform of the main key (the mirror form), if one exists.
- **Type distance**: from a program to a type, the smallest Hamming distance between the program's key and any transform of any representative's key. Ties go to the lowest (form, transform).
- **Radius** of a type: floor(0.4 × its symbols), at least 1, where symbols are the instructions and zeros in its main representative's key. Keys are mostly `_`, and the minimum over 128 alignments is small, so a fixed radius does not work. Random programs sit 1–2 below the symbol count: 19–22 for a 22-symbol copier, 8–10 for a 10-symbol one. Two unrelated copiers (wm2 and g1) are only 13 apart. A program is **of a type** when its distance is within the type's radius. The **probe radius** is floor(0.25 × symbols), at least 1.
- **Leader** of a snapshot: the largest type whose representative scores at least 48 on the copy test. The copy test runs on every type with at least 0.1% share (at most 1,000 types). The wm8 pilot has junk types of hundreds of programs with copy test 0, so this matters.

## Measurements

Per snapshot (`soup-evo.ts census`):
- Types by count: share, representatives and copy test.
- Number of types with at least 0.1% share. Census rows are kept for the 64 largest types and for every type with at least 0.1% share.
- Shannon diversity over types (keyed programs only).
- Copier share: the share of all programs in types that score at least 48.
- The leader.

### Q1. Turnover

A **sustained leader change**: a snapshot's leader differs from the current leader and is also the leader at the next snapshot; it then becomes the current leader. The current leader starts as the first leader. A brief flicker A, B, A is not a change, and snapshots with no copier leader are skipped. **TURNOVER**: at least 3 sustained leader changes between T0 and the end. **No turnover**: zero changes.

### Q2. Adaptation (time-shift competition)

**Competitors**: L0 is the leader at T0, then every other type that made a sustained change to the lead, in order of that first change. A type's representatives are frozen at the first snapshot where it was the leader at all, sustained or not.
- With more than 12, keep the indices round(k · (n − 1) / 11) for k = 0..11. These are distinct because the spacing is above 1, and they always include the first and the last.
- Each distinct unordered pair is assayed once. "Later" means it first led later.

**Assay A vs B (well-mixed).** A fresh well-mixed soup of 16,384 programs at the paper's mutation rate.
- The rare type gets 2,048 programs (12.5%) and the common type the other 14,336. Each type's programs alternate between its representatives, so a two-form type is split 50/50.
- Run 512 epochs. Every 64 epochs, classify each program. A program counts for a type if it is within that type's radius and strictly nearer to it than to the other type; otherwise it is "other". Programs with few instructions are simply far from both.
- Report rare/N, common/N and other/N. f = rare / (rare + common), which starts at 0.125.
- Run both directions, A rare and B rare, with 3 assay seeds each.
- A run is **invalid** if, at epoch 512, a third copier type outnumbers A and B together. That is a type with copy test at least 48, at least 1% share, and a representative within neither side's radius. "Other" by itself does not invalidate a run. About 30% of a post-takeover soup is debris (broken partial copies), as in the real soups, where copier types hold only 20–30% of programs.

**Neutral calibration.** For each lineage's L0, assay L0* against L0, where L0* is L0 with one data byte changed.
- **Marker position**: scan data positions from 0. Skip any that are zero or an instruction, or whose byte differs at the mirror position. The first 8 positions that pass transmission are candidates. A position passes transmission when, in at least 7 of 13 lines of [L0* | random] → offspring half → [offspring | fresh random] … over 5 generations, the offspring is of the type and carries the marker at the aligned position after every generation. Each candidate then gets a 128-epoch neutral pilot soup (seed 99, marked type rare). The one with the fewest misreads (aligned programs whose marker byte is neither value) is chosen, ties to the lower position. The smoke test showed position 0, where the heads start, misread about 10% of aligned programs, against about 1% at position 50.
- **Marker value**: the first byte value from (original + 97) mod 256 upward that is not zero, not an instruction and not the original.
- **Classification**: align each program to L0 (within its radius), then read the aligned marker byte: marker → L0*, original → L0, anything else → other.
- Two batches, each of 3 seeds × 2 directions (L0* rare, L0 rare) × 4 lineages. A lineage without a usable marker is reported as such and contributes no runs.
- **Calibration batch** (seeds 1–3): σ0 is the standard deviation of the final f over all its valid runs.
- **Validation batch** (seeds 4–6): each lineage's neutral pair is scored with the rule below. The **expected outcome is unresolved**. Any lineage whose neutral pair resolves is reported as a calibration failure, and the headline is then marked "calibration failed: provisional".
- The mean final f of the neutral runs is also reported, as a check that the marker is neutral (expected 0.125).
- No verdict is final until every assay, including both neutral batches, has run and all 4 lineages cover exactly their T0 to end snapshots. Until then the headline is reported as INCOMPLETE.

**Pair outcome.** D = mean final f with A rare − mean final f with B rare, over valid runs. The threshold is θ = 2.5 · σ0 · √(1/nA + 1/nB).
- **A beats B** if D > θ; **B beats A** if D < −θ.
- Otherwise **coexist** if both rare types gained by more than 2.5 · σ0 / √n (each direction separately), else **unresolved**.
- **Failed** if either direction has fewer than 2 valid runs.

**Per-lineage verdict.** k = the number of competitors. With the resolved pairs fixed, the permutation p is the share of the k! orders (20,000 seeded random orders if k > 8) that give at least as many later-wins as observed. q = later-wins / resolved.
- **INSUFFICIENT EVIDENCE**: fewer than 2 resolved pairs, or more than a third of the pairs failed.
- **ADAPTIVE**: at least 5 resolved pairs, q ≥ 0.8 and p < 0.05.
- **REVERSED**: at least 5 resolved pairs and q ≤ 0.2.
- **ADAPTIVE (weak)**: 2 to 4 resolved pairs, all won by the later type.
- **NO DIRECTION**: otherwise.
- **CYCLIC** is noted when the resolved relations contain an intransitive triple. Coexisting pairs are listed.

**Grid assays (g1 only, secondary).** The same pairs, both directions and 3 seeds, on a 64 × 64 grid with radius 2. The rare type is planted as one central square patch of 512 programs (a 23 × 23 square, trimmed row by row). Same classification and outcome rule. σ0 comes from a grid neutral control: L0* against L0 on the same grid, 3 seeds × 2 directions, with the marked or plain type as the central patch. Reported beside the well-mixed verdict; the headline uses only the well-mixed one.

### Q3. Interactions and parasites

Probed at T0, the middle snapshot and the last (`soup-evo.ts interact`).
- **Probed types**: the 16 largest types, plus every type with share at least 0.5% and copy test at most 16.
- For each ordered pair (X, Y) and every combination of their representative forms, evaluate [X | Y] once without mutation (evaluation is deterministic). Label each output half X or Y when it is within that type's probe radius and strictly nearer to it than to the other, else "?". The outcome matrix is reported.
- A **parasite** is a type with share at least 0.5% and copy test at most 16, so it does not copy itself onto random partners. With some host (copy test at least 48), in some form combination and order, it must propagate serially: three rounds in a row of [P | fresh host] or [host | P] in which both halves end up labelled P, each round continuing from the half that was the host's.
- **PARASITES PRESENT**: a parasite at any probed snapshot in at least 2 lineages.

### Q4. Trends (descriptive, no verdict)

For the leader at each snapshot, against 13 seeded random partners:
- Number of instructions.
- Copy test.
- Mean instructions run per pairing.
- Fidelity: the share of runs in which both halves are within type distance 2 of the leader.
- Robustness: the mean copy test of 8 seeded single-byte mutants.

Each gets a Spearman correlation with time.

### Similarity graph and Muller plots

This is not a true genealogy: convergence and unsampled intermediates can mislead it.
- For every type that is ever in a snapshot's top 8, its nearest type in the previous snapshot's top 64 is recorded, with the distance between their representatives' keys. If that distance is over the parent's radius, the parent is "unknown". Ties go to the larger type.
- The leader chain is reported with the key differences at each step.
- A Muller plot of type shares over time is drawn per lineage.

## Headline rule (exhaustive, fixed before results)

These are taken in order:
1. **"Evolution continues: later copiers beat earlier ones"**: at least 2 of the 4 lineages are both TURNOVER and ADAPTIVE.
2. **"Copiers keep replacing each other; improvement not shown"**: otherwise, if at least 2 lineages are TURNOVER.
3. **"Stasis after takeover"**: otherwise, if at least 2 lineages have no turnover.
4. **"Little turnover"**: otherwise.

ADAPTIVE (weak), REVERSED, INSUFFICIENT EVIDENCE, CYCLIC, coexistence, PARASITES PRESENT and the grid assays are reported beside the headline. Claims of improvement apply to the well-mixed assay environment only.

## Limits known in advance

- Four lineages from one rule set and mutation rate.
- The grid lineage's headline assays are well-mixed: a type that wins in space can lose in a stirred soup.
- Assays use only the leaders, not whole populations.
- The neutral control uses only the T0 leaders.
- 512 epochs in 16,384 programs can miss slow advantages.
- Assay seeding splits two-form types 50/50, which may not match their natural phase ratio.

## Exploratory additions (after seeing the leader sequences)

Added on 2026-10-31, after the censuses of the first ~9,000 post-T0 epochs of wm2 and wm6 were seen, and before any assay result. These cannot change the headline.

wm2 had one leader change and then a stable leader. In wm6, from about step 8,700 a different type led at almost every snapshot, which the sustained-change rule hardly counts. That looks like a cloud of near-equal variants trading the lead. Two additions follow:

- **Time-point assays (xpair)**: the leaders at 5 evenly spaced snapshots (indices round(q · (n − 1) / 4), q = 0..4), deduplicated, with representatives frozen at that snapshot. They use the same assays, outcome rule and verdict as Q2, and are reported as "exploratory".
- **Clade view**: the Muller plot colours each type by the nearest competitor within its radius, with the rest grey. This shows whether a churning cloud of types is one clade.

## Readout

_Not yet run._
