# Sandbox: does a body pay when a genome owns its matter?

*Written 2026-10-02, before any run of this sandbox. Exploratory, not registered. RULE_VERSION 1 is
unchanged: every new `WorldConfig` key is optional and absent from `defaultConfig()`, so existing
configs, bundles and golden pins stay byte-identical. Nothing here counts toward any milestone.*

## Why

Under RULE_VERSION 1 the transport lottery gives the winning genome all incoming biomass, polymer
and energy at no cost (`packages/sim-ref/src/step.ts`, transport). Taking a neighbour's matter is
free and total. Evolution so far removes organisation (test 5: regeneration 0.168 evolved against
0.979 founders; R4 negative under the scaffold). The question: if taking foreign matter is lossy,
does evolution stop eroding bodies, or start building them?

## Arms (256 x 256, the 12 M3 founders, condition `treatment`)

| Arm | Preset | Difference from `gradient-m3` |
|---|---|---|
| control | `gradient-m3` | none |
| lossy | `own-lossy` | bound mass that loses the lottery to a non-kin winner becomes waste C; its released potential energy goes to the winner's E pool. Kin = same lineage id |
| match | `own-match` | the same, but kin = growth parameters mu and sigma within a tolerance, so most single mutants stay kin |
| seasons | `own-seasons` | no rule change; seasonal light forcing, the comparison `docs/plan.md` says predation must beat |

The spatial sibling first proposed (light separated from nutrient so that only a body can bridge
them) is not expressible in this chemistry: nutrient A moves only by diffusion and photosynthesis
needs A and light in one cell, so no body can carry it. It would need a second rule change. Seasons
(separation in time, bridged by stored energy) stands in for it.

## Measurement

The existing instrument, unchanged: test 5's lesion battery (`evaluateBatch`, `DEFAULT_EVAL`) on
the most numerous lineages of a checkpoint, against the founders' recorded 32-replicate retest.
Snapshots at 100k, 250k and 500k steps, 3 seeds per arm, top 4 lineages, 16 replicates each,
assay seeds from 4,900,001. Alongside: bound mass, waste share, lineage counts, age of the
dominant lineage, and a contact sheet of the worlds.

## Readout (a rule of thumb fixed in advance, not a test)

At the last snapshot, per arm, against the control arm of this same screen:

- **Promising:** in at least 2 of 3 seeds the arm's evolved lineages regenerate at a rate at least
  0.2 above the control's, the world holds at least half the control's bound mass, and the
  dominant lineages are mutants (born after step 0), so evolution is still running.
- **Dead end:** the world collapses, or evolution stalls (founders still dominate everywhere).
- **Unclear:** anything else. Extend once to 10^6 steps, then stop either way.

Promising earns a registration draft. It is not itself evidence for any claim.

## Follow-up ladder (added 2026-10-03 00:1x, before the first read; the user: "if anything promising lands, go further")

Local Mac only, $0, sandbox workspace only. No paid compute, no commit to `main`, no push, no
freeze of any document: those stay the user's decisions.

- **If an arm reads Promising at 500k (3 seeds):**
  1. *Replicate:* five fresh seeds (4-8) of that arm and of control, same settings.
  2. *Persist:* seeds 1-3 of that arm and of control to 10^6 steps, read at 750k and 10^6.
  3. *Rule out the cheap explanation:* regeneration could stay high only because evolution slowed.
     Compare, at matched snapshots, the dominant lineage's birth step and the number of mutant
     lineages of 16 cells or more against control. A retained score with founders still dominant
     is "stalled", not "bodies pay".
  The arm keeps its Promising label only if the replicate agrees (at least 4 of 5 fresh seeds at
  0.2 or more above control) and step 3 does not read as stalled.
- **If Unclear:** extend seeds 1-3 of every arm once to 10^6, read, stop.
- **If every arm is a Dead end:** record the numbers and stop.

## Result at 500k steps, 3 seeds (2026-10-03 02:17; `runs/ownership/screen1/summary.md`)

Regeneration rate of the top evolved lineages (founders 0.979), seeds 1 / 2 / 3:

| Arm | 100k | 250k | 500k | Bound mass vs control at 500k | Dominant lineage a mutant |
|---|---|---|---|---|---|
| control | 0.078 / 0.375 / 0.063 | 0.203 / 0.094 / 0.031 | 0.031 / 0.078 / 0.219 | 1.00 | 3 of 3 |
| lossy, lineage kin | 0.854 / 1.000 / 0.917 | 0.854 / 1.000 / 0.958 | 0.938 / 1.000 / 0.938 | 0.71 | 0 of 3 |
| lossy, growth-match kin | 0.156 / 0.578 / 0.031 | 0.406 / 0.047 / 0.125 | 0.594 / 0.031 / 0.109 | 0.91 | 3 of 3 |
| seasons | 0.328 / 0.297 / 0.609 | 0.422 / 0.078 / 0.125 | 0.156 / 0.141 / 0.141 | 1.06 | 3 of 3 |

Readout by the rule fixed above: lineage kin **Dead end** (stalled: in seeds 2 and 3 one founder
holds every occupied cell and no mutant lineage reaches 16 cells; in seed 1 two founders share the
world); growth-match kin **Unclear** (1 of 3 seeds above control + 0.2); seasons **Unclear** (0 of 3;
slower erosion at 100k, level with control by 500k).

Reading, exploratory: the two lossy arms bracket the question. Strict kin keeps regeneration by
stopping evolution (every mutant is foreign to its parent). Growth-match kin lets controller
mutants (about 98% of mutations) stay kin, so takeover among them is as free as under
RULE_VERSION 1, and erosion proceeds in 2 of 3 seeds. Neither arm tests the middle: variation
gets through, yet takeover between diverged genomes is lossy.

Per the ladder (Unclear): every arm, seeds 1-3, once to 10^6 steps in `runs/ownership/screen2`,
read at 500k (replay check against screen1) and 10^6, then stop.

## Result at 10^6 steps, 3 seeds (2026-10-03 05:20; `runs/ownership/screen2/summary.md`). Screen stopped here.

The 500k rows of this rerun equal screen1's exactly (replay check). Regeneration, seeds 1 / 2 / 3:

| Arm | 500k | 10^6 | Bound mass vs control at 10^6 | Dominant lineage a mutant |
|---|---|---|---|---|
| control | 0.031 / 0.078 / 0.219 | 0.141 / 0.188 / 0.219 | 1.00 | 3 of 3 |
| lossy, lineage kin | 0.938 / 1.000 / 0.938 | 0.906 / 1.000 / 0.938 | 0.67 | 0 of 3 |
| lossy, growth-match kin | 0.594 / 0.031 / 0.109 | 0.797 / 0.156 / 0.078 | 0.99 | 3 of 3 |
| seasons | 0.156 / 0.141 / 0.141 | 0.078 / 0.063 / 0.047 | 1.01 | 3 of 3 |

Readout unchanged: lineage kin **Dead end** (stalled), growth-match kin **Unclear** (1 of 3),
seasons **Unclear** (0 of 3, below control). No arm read Promising, so the replicate and persist
steps of the ladder did not run. Control's 0.182 mean agrees with test 5's 0.168 at 9 x 10^5.

One observation worth a follow-up, from a single seed and therefore a lead only: growth-match
seed 1 rises at every snapshot (0.156, 0.406, 0.594, 0.797) while mutants dominate and 234
lineages hold 16 cells or more. It is the only history in the project in which evolved lineages
regain regeneration. Not examined: which founder its dominant lineages descend from, and whether
the border between non-kin species is where the effect lives.

Suggested next variant (not built): a kin test on the whole genome with a tolerance (for example
the number of differing controller words), so close mutants stay kin and diverged genomes pay.
The two lossy arms bracket that setting from either side.

## Trace of `own-match` seed 1 (2026-10-03 08:05; `tools/own-trace.ts`, no GPU)

The tool resolves every living lineage to its founder through `mutations.tsv`, and reads from each
checkpoint the growth classes (mu/sigma), the share of occupied cells with a non-kin occupied
neighbour ("border cells", growth test at tolerance 8), and how many of the 42 heritable genome
words differ between neighbouring cells of different lineage.

What it found:

- **The recovery is in founder 1's clade.** All four assayed lineages at 10^6 descend from founder 1
  (key `0:1`, mu 59, sigma 17), 46 to 49 mutations deep. Founder 12 (mu 32, sigma 22) coexists
  until about 700k (5% of cells at 250k, 31% at 500k, 0 at 750k); its assayed lineages regenerate
  0 of 16 at every snapshot.
- **The effect does not live at non-kin borders.** Border cells are 0.5% of occupied cells at 250k,
  2.2% at 500k, and exactly 0 at 750k and 10^6, when every living cell is growth-kin to every
  other. From then on the lossy rule never fires and the world runs as RULE_VERSION 1. The assayed
  founder-1 lineages have border shares of 0 to 3%.
- **Regeneration was lost and then regained inside that clade.** Founder-1 lineages regenerate
  0, 8 and 2 of 16 at 100k (6 to 7 mutations deep), 4, 8 and 14 at 250k, 13, 12 and 13 at 500k and
  15, 14, 13 and 9 at 10^6.
- **Which founder wins differs by arm, and no other evolving history is held by founder 1.**
  Control: founder 10, 3, 3 (seeds 1, 2, 3). `own-match`: founder 1, 3, 10. `own-lossy`: founders
  1 + 12 (frozen), 3, 3. So in seed 1 both lossy arms hand the world to founder 1 where the control
  hands it to founder 10. `own-match` seeds 2 and 3 have almost no non-kin contact from 100k on
  (border cells <= 1%) and erode like the control.
- **Scale for a whole-genome tolerance.** Neighbouring cells of different lineage and the same
  founder differ in a median of 3 to 36 of 42 words (p90 up to 42) from 250k on, in every arm that
  evolves; lineages are 13 to 140 mutations deep. Founders differ from each other in 41 or 42.
  So any small word tolerance makes most late neighbours non-kin.

Reading: the seed 1 result is not evidence that lossy borders protect bodies. Two readings remain.
(a) Founder effect: founder 1's clade regains regeneration under any rule, and the lossy rule's
only part was to let founder 1 win seed 1. (b) History: the early lossy phase against founder 12
put the clade on a different path. A control founded from founder 1 alone separates them:
`runs/ownership/solo1` (`gradient-m3 --solo-founder 0`, seeds 1 to 3, 10^6 steps), started 07:55.
Fixed before its read: regeneration >= 0.6 at 10^6 in at least 2 of 3 seeds means (a); <= 0.3 in at
least 2 of 3 means (b); otherwise undecided.

## Whole-genome kin variant (built 2026-10-03 08:00, screen started 08:04, readout fixed before any result)

`takeoverKin: "genome"` with `takeoverTol` = the largest number of heritable genome words (PARAM0,
PARAM1 and the 40 weight words; 42 in all) that may differ between a source's genome and the lottery
winner's for the source to count as kin. Equal lineage ids are kin; a (0,0) lineage falls back to
lineage equality as in growth mode. Tolerance 1 keeps a single mutant kin to its parent. Presets
`own-genome-1`, `own-genome-3`, `own-genome-8`. Gates: typecheck clean; the 14 earlier pins
unchanged plus a new pin `takeover-genome dfb56d29a4d59f7a`; GPU equals CPU on all 15 golden cases;
conservation exact over 2,000 steps; 1,398 tests pass. Not reviewed (no Codex or agy pass).

Screen: `runs/ownership/screen3`, the three presets, seeds 1 to 3, 10^6 steps, read at 250k, 500k
and 10^6 against the control histories of screen2 (copied in). Readout rule as above (Promising =
at least 2 of 3 seeds with regeneration >= control + 0.2 at 10^6, bound mass >= 0.5 of control,
dominant lineages mutants), with two additions from the trace, fixed now: the dominant lineage's
mutation depth at 10^6 must be at least a quarter of the same seed's control depth (58, 142, 102),
so a nearly frozen world does not pass as evolving; and each world's founder is reported, since
founder identity is a confound.

Expectation written before the read: a tolerance cannot stop a chain of single-mutant sweeps, each
kin to the resident it replaces, so if erosion proceeds that way all three arms erode like the
control; tolerance 1 may instead come close to the frozen `own-lossy` world.

## Founder-1 control result (2026-10-03 08:40; `runs/ownership/solo1/summary.md`)

Unchanged rule (`gradient-m3`), all discs founded from founder 1 (M3 index 0, mu 59, sigma 17).
Regeneration of the top lineages at 250k / 500k / 10^6:

| Seed | 250k | 500k | 10^6 | Note |
|---|---|---|---|---|
| 1 | 0.703 | 0.609 | 0.703 | 278 lineages, 34 mutations deep, growth class still 59/17 |
| 2 | 0.609 | 0.391 | 0.625 | 223 lineages, 47 deep, growth class moved to 80/17 |
| 3 | 0.422 | 0.328 | 0.000 | world collapsed: bound mass 23,693 at 250k, 5,470 at 10^6, one lineage left |

By the rule fixed above (>= 0.6 at 10^6 in at least 2 of 3 seeds) this is reading (a): **a founder
effect.** Founder 1's clade keeps regeneration near 0.6 to 0.7 through 10^6 steps of evolution
under the unchanged rule, against 0.14 to 0.22 in the mixed-founder control, which founders 3 and
10 win. The `own-match` seed 1 result needs no help from the lossy rule beyond letting founder 1
win. Seed 3 shows the other thing founder 1 does alone: collapse.

Follow-up on existing data, started 08:42, fixed before its table: the 60 single-founder histories
of the foundations review (`runs/solo/gradient-m3/treatment` in the main checkout, 12 founders x 5
seeds, 10^6 steps, unchanged rule, `--lineage-obs`) have never been assayed for regeneration. 
`tools/own-solo.ts` assays the top 4 lineages (>= 16 cells) of each final census, 16 reps. Read
per founder as the mean over its 5 seeds: "keeps" at >= 0.5, "erodes" at <= 0.25. The question is
whether erosion is general or belongs to the clades that win mixed-founder worlds (founders 3 and
10, M3 indices 2 and 9).

## The 60 existing single-founder histories (2026-10-03 09:28; `runs/ownership/solo-existing/solo.tsv`)

Unchanged rule, one founder per world, 10^6 steps, top 4 lineages of the final census, 16 reps.
Regeneration per seed and the founder's mean ("f1" is M3 index 0, the key `0:1` of the trace):

| Founder | mu/sigma | Seeds 1 to 5 | Mean | Worlds under 5,000 occupied cells |
|---|---|---|---|---|
| f1 | 59/17 | 0.56 0.39 0.56 0.30 0.16 | 0.39 | 2 |
| f2 | 28/24 | 0.19 0.06 0.25 0.17 0.31 | 0.20 | 0 |
| f3 | 80/26 | 0.09 0.12 0.16 0.16 0.03 | 0.11 | 0 |
| f4 | 60/20 | 0.16 0.09 0.22 0.09 0.02 | 0.12 | 0 |
| f5 | 42/18 | 0.00 0.03 0.16 0.02 0.44 | 0.13 | 0 |
| f6 | 32/26 | 0.00 0.19 0.12 0.20 0.25 | 0.15 | 0 |
| f7 | 60/20 | 0.11 0.22 0.22 0.09 0.22 | 0.17 | 0 |
| f8 | 37/12 | 0.19 0.00 0.41 0.03 0.17 | 0.16 | 0 |
| f9 | 38/25 | 0.00 0.77 0.23 0.25 0.08 | 0.27 | 3 |
| f10 | 38/27 | 0.36 0.25 0.45 0.42 0.19 | 0.33 | 0 |
| f11 | 38/25 | 0.50 0.98 0.08 0.14 0.69 | 0.48 | 3 |
| f12 | 32/22 | 0.23 0.00 0.00 0.20 0.00 | 0.09 | 0 |

- **Erosion is general.** By the rule fixed above no founder "keeps" (mean >= 0.5) and 8 of 12
  "erode" (mean <= 0.25). The mean over all 60 worlds is 0.22, against 0.98 for the founders
  themselves. It is not confined to the clades that win mixed worlds: founder 10 alone averages 0.33.
- **There is a founder gradient, and it is noisy.** Founders 1 and 11 retain the most (0.39 and
  0.48), with wide spreads, and those are also the founders whose worlds collapse.
- **This weakens the founder-1 control above.** Its three seeds read 0.70, 0.63 and 0.00; these
  five read 0.16 to 0.56. Over all eight, founder 1's clade averages about 0.41 and reaches 0.6 in
  2 of 8 worlds. So the fair statement for `own-match` seed 1 (0.80) is: it sits at the top of what
  founder 1's clade does without any rule change, the trace finds no border mechanism, and one
  seed cannot separate a small contribution of the rule from chance.

## Whole-genome kin result (2026-10-03 10:34; `runs/ownership/screen3/summary.md`, `trace.tsv`)

Regeneration of the top 4 evolved lineages (founders 0.979), seeds 1 / 2 / 3:

| Arm | 250k | 500k | 10^6 | Bound mass vs control at 10^6 | Dominant a mutant | Median lineage depth at 10^6 | World's founder |
|---|---|---|---|---|---|---|---|
| control `gradient-m3` | 0.203 / 0.094 / 0.031 | 0.031 / 0.078 / 0.219 | 0.141 / 0.188 / 0.219 | 1.00 | 3 of 3 | 58 / 142 / 102 | f10 / f3 / f3 |
| `own-genome-1` | 0.000 / 0.391 / 0.188 | 0.203 / 0.016 / 0.141 | 0.141 / 0.125 / 0.109 | 0.98 | 3 of 3 | 88 / 84 / 69 | f10 / f3 / f3+f4 |
| `own-genome-3` | 0.016 / 0.047 / 0.125 | 0.172 / 0.172 / 0.000 | 0.000 / 0.219 / 0.641 | 1.00 | 3 of 3 | 56 / 101 / 91 | f10 / f3 / f3 |
| `own-genome-8` | 0.000 / 0.000 / 0.219 | 0.156 / 0.047 / 0.016 | 0.297 / 0.109 / 0.109 | 0.98 | 3 of 3 | 25 / 75 / 56 | f7 / f3 / f10 |

Readout by the rule fixed above: seeds above control + 0.2 at 10^6 are 0, 1 and 0 of 3. No arm is
Promising. None collapsed or stalled (bound mass 0.98 to 1.00 of control, mutants dominant, depths
well over a quarter of the control's), so by the letter each is Unclear; the horizon is already
10^6 and the screen stops here. In substance this is no effect: the nine worlds average 0.19
against the control's 0.18.

- **The penalty fires everywhere and changes nothing.** Under tolerance 1, between 12% and 52% of
  occupied cells have a non-kin occupied neighbour at 10^6, and 60% to 97% of neighbouring pairs of
  different lineage are non-kin (tolerance 3: 8% to 23% of cells; tolerance 8: 5% to 22%). Under
  tolerance 1 waste C is 1.5 to 2.2 times the control's. Bound mass, lineage counts, mutation depth and the erosion
  of regeneration all match the control.
- **Tolerance 1 is not close to frozen** (the half of the written expectation that was wrong). Once
  a single mutant is kin to its parent, evolution runs at the control's pace. Strict lineage kin
  froze the world only because a mutant was foreign to the body it arose in.
- **The one high world repeats the "lost then regained" pattern.** `own-genome-3` seed 3 reads 0 of
  16 for all four top lineages at 500k and 14, 12, 15 and 0 of 16 at 10^6, in a founder-3 clade
  whose mu has drifted from 80 to 141. With `own-match` seed 1 that is 2 high worlds among the 12
  lossy worlds that evolve; single-founder worlds under the unchanged rule give 5 of 63 at or above
  0.6. The two rates are not distinguishable.

## Bodies are already genetically uniform (`tools/own-purity.ts`, `runs/ownership/purity.tsv`)

`census()` individuals (connected cells with B + P >= 48, mass >= 256; median 15 to 30 cells): the
share whose cells all carry one lineage is 0.88 to 0.99 in the control and 0.73 to 0.99 in the
genome arms; mean purity is 0.93 to 1.00 everywhere. Bodies hold 15% to 48% of occupied cells;
the neighbouring cells of different lineage counted above are almost all in the thin halo between
bodies.

## Where this leaves the direction (my reading, 2026-10-03)

- **Lossy takeover is a dead end as a way to make evolution keep bodies.** Strict kin keeps
  regeneration by stopping evolution. Every looser kin test (growth match; 1, 3 or 8 genome words)
  lets evolution run and regeneration erode exactly as in the control, however often the penalty
  fires. The premise "a genome does not own its matter" was wrong about where matter changes
  hands: bodies are already clonal, and what the transport lottery mixes is the halo between them.
- **Erosion is general and the trait is labile.** All 12 founders' clades lose regeneration under
  the unchanged rule (mean 0.22 over 60 worlds), some clades regain it later, and world-to-world
  spread is wide (0.00 to 0.98).
- **Interpretation, not a finding:** the founders were selected for regeneration by the M3 search
  and then released into a world that never injures a body. Nothing in an evolving world pays for
  regeneration, so it is free to decay or drift. On this reading test 5's erosion measures relaxed
  selection on a trait the environment does not demand, and the lever is the environment, not the
  takeover rule: a world with recurring injury (lesions applied by the runner during evolution)
  should hold regeneration where the control loses it. Not built or tested here.

## Injury variant (built 2026-10-03; readout fixed before any evolution result)

Tests the reading above: nothing in an evolving world injures a body, so nothing pays for
regeneration. The variant adds recurring wounds and changes nothing else (no takeover keys).

**Rule.** Optional keys `injuryPeriod`, `injuryRadius`, `injuryProb` (absent = RULE_VERSION 1). On
every step with `(step + 1) % injuryPeriod == 0`, each cell is a wound centre with probability
`injuryProb / 2^32` (counter PRNG, new stream `RND.INJURY`), and react ends by destroying the bound
structure of every cell within `injuryRadius` of a centre exactly as `applyLesion` does (B and P to
waste C, excess chemical energy and E to heat, motility reset, lineage cleared). This is the same
operation the assay's lesion uses, applied in the world at random places and times.

**Gates.** Typecheck clean; the 15 earlier pins unchanged plus `injury 1fd51d2042631706`; GPU equals
CPU on all 16 golden cases; a step with injury equals a plain step followed by `applyLesion` at each
centre (cells, genome, heat) over 60 steps; identical to RULE_VERSION 1 before the first injury
step; matter constant and ledger residual 0 over 2,000 steps; 1,403 tests pass. A 40,000-step smoke
of each arm runs at 1,830 to 2,060 steps/s with conservation exact and 112 to 232 individuals
(control 296).

**Arms** (`gradient-m3` plus wounds every 13 steps; "every" = mean steps between hits on one cell):

| Preset | Radius | Every | What a wound does |
|---|---|---|---|
| `own-injury-light` | 3 (29 cells) | 13,000 | takes about 30% of a 20-cell body; a body is touched about every 4,000 steps |
| `own-injury-heavy` | 3 | 3,250 | the same wound four times as often (a body about every 1,000 steps; the assay allows 2,000 to recover) |
| `own-injury-coarse` | 8 (197 cells) | 13,000 | the same area rate in large wounds that remove whole bodies and cut the ones at the rim |

**Screen.** `runs/ownership/screen4`, seeds 1 to 3, 10^6 steps, read at 250k, 500k and 10^6 against
the control histories of screen2. Same measurement as every screen above.

**Readout, fixed now.** Promising = at least 2 of 3 seeds with regeneration >= control + 0.2 at
10^6, bound mass >= 0.5 of control, dominant lineages mutants, and median lineage depth at least a
quarter of the same seed's control (58, 142, 102). Dead end = collapse (bound mass under 0.5 of
control in at least 2 seeds) or stalled evolution. Unclear otherwise.

Single worlds are noisy (unchanged-rule single-founder worlds reach 0.6 in 5 of 63) and three arms
are read, so a Promising arm is not a result until it replicates: five fresh seeds (4 to 8) of
that arm and of the control to 10^6, same read; the label stands only if at least 3 of the 5 arm
seeds are at or above the fresh control's mean + 0.2. That replicate runs automatically on a
Promising read and not otherwise.

**Expectation written before the read.** If relaxed selection is the right reading, `light` and
`heavy` hold regeneration well above the control and `coarse` less so, since large wounds reward
recolonising a gap more than regrowing a body. If all three erode like the control, the reading
is wrong or these wounds do not select for what the assay measures.

### Injury result (2026-10-03, `runs/ownership/screen4`)

Regeneration of the top four lineages at 10^6 steps (founders 0.979):

| Arm | Seed 1 | Seed 2 | Seed 3 | Mean | Seeds at control + 0.2 | Bound mass vs control | Median lineage depth |
|---|---|---|---|---|---|---|---|
| control | 0.141 | 0.188 | 0.219 | 0.182 | | 1.00 | 58, 142, 102 |
| `own-injury-light` | 0.000 | 0.219 | 0.266 | 0.161 | 0 of 3 | 0.98 | 31, 70, 100 |
| `own-injury-heavy` | 0.000 | 0.156 | 0.109 | 0.089 | 0 of 3 | 0.90 | 36, 61, 38 |
| `own-injury-coarse` | 0.125 | 0.125 | 0.125 | 0.125 | 0 of 3 | 0.99 | 41, 78, 70 |

**Readout.** No arm is Promising: none of the nine worlds reaches control + 0.2, and every arm's
mean is at or below the control's. Nothing collapsed, and evolution did not stall (the depth
numbers in the rule are the control's depths, so the thresholds are a quarter of them: 15, 36 and
26; every arm clears them). By the rule as written the label is Unclear for all three. In
substance the expectation failed: `light` and `heavy` were to hold regeneration well above the
control and they do not. The replicate was not triggered.

**What else the worlds show.**
- Seed 1 goes to founder 12's clade in all three injury arms (founder 10 in the control). Under
  `light` and `heavy` its top lineages do not survive the assay at all (0 of 64 at 500k and at
  10^6), and bodies nearly vanish first: cells with B + P of 48 or more fall to 569 and 615 at
  250k against 11,501 in the control, then recover to 7,922 and 2,975 by 10^6. Wounds there
  selected a form that does without bodies, not one that repairs them.
- By eye (`frames.png`, seed 1): under `light` and `heavy` the brighter half of the world is a
  continuous film at 250k, with dots only along its upper edge. Dots return under `light` by
  10^6; under `heavy` the film still covers most of the world. `coarse` is a mix of film patches
  and dots. This is the first arm in the sandbox that is not the same lattice of dots, and it
  gets there by replacing bodies with a mat.
- Seeds 2 and 3 keep the control's winners (founder 3, and founder 4 in `heavy` seed 3) and
  erode as the control does. `heavy` seed 3 held 0.42 at 250k and lost it by 500k.
- Lineage depth is lower under injury (31 to 100 against 58 to 142), with 260,000 to 720,000
  mutation events against 470,000 to 930,000: wounds slow the turnover of lineages somewhat,
  they do not redirect it.

**Reading.** Wounds that destroy bound structure exactly as the assay's lesion does, recurring at
three rates and scales in the evolving world, do not keep the regeneration the founders were
selected for. The relaxed-selection reading is not supported. Either the evolving world answers
wounds some other way (regrowing from the film between bodies, or doing without bodies, as seed 1
did), or the assay's trait (one isolated body regaining 90% of its mass in a 64 x 64 tile) is not
what a wound selects for in a packed 256 x 256 world.

**Codex review of the injury rule (Sol 6.1 High).** No defect in CPU and WGSL parity,
conservation, lesion equivalence or compatibility. Its coverage findings (heat at the arithmetic
bounds, tile isolation, the largest radius, a weak proxy in the conservation test) are closed in
the `cells` workspace, which sits on top of this one: `injury.test.ts` there and the golden case
`injury-extremes`.

The next two ideas, heritable kernel shape and declared cells, are in `docs/sandbox-cells.md` of
the `cells` workspace.
