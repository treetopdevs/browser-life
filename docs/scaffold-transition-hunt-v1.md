# Transition hunt v1 (DRAFT, exploratory, not frozen)

*2026-10-01. A draft for the user's decision, written after the user chose to keep the scaffolding registration (`docs/scaffold-registration-v1.md`) at 24 histories per arm and to draft a hunt beside it. The two are separate decisions: this document changes nothing in the registration. Nothing here binds until the user approves it and it is frozen (see "Freeze and order of events"). Its settings were decided by the user on 2026-10-02 (see "Freeze and order of events"). No run, assay or data of this design exists. After the freeze, any change goes in a dated amendment at the end and the original text stays. The line stays exploratory under RULE_VERSION 1: it does not count toward M6 and does not answer the reset line's entity question.*

## Why a hunt

The registration confirms one known effect, near its ceiling, under a life cycle the experimenter imposes in full:
- the experimenter **ranks** ponds on a trait it chose (bound mass) and lets only the top quarter reproduce;
- the experimenter takes the propagule from **anywhere in the donor**, centred by mass;
- **every pond dies** at every boundary.

The north star's hardest item is a collective that reproduces as a unit through a bottleneck, without being told to. Black, Bourrat & Rainey (2020) describe the route experimental evolution has taken:
1. an environment of patches, with a means of dispersal and a birth–death process for collectives, gives collectives Darwinian properties (variation, heredity, differential reproduction) from outside;
2. the transition proceeds as those properties become the collectives' own ("endogenisation").

This hunt takes the next step on that route that RULE_VERSION 1 allows. It removes the ranking and replaces the obligate reset with random disturbance. It also takes propagules only from where a pond's own growth has put material: its edge.

What stays imposed is the environment. The host still fixes:
- ponds as patches;
- the edge zone, the packet size and the schedule;
- a "current" that carries edge material to emptied ponds, with offspring numbers in proportion to it;
- the disturbance.

Tiles are isolated tori under RULE_VERSION 1, so no physical process moves matter between ponds: transport has to be host-side.

**What the hunt looks for (the "seeds"), in order of weight:**
1. **Primary: a response to selection among collectives on reproductive output.** Ponds whose offspring number follows their own export evolve higher export performance, measured in a common garden, than ponds whose offspring number is decoupled from their export.
2. **Hypotheses that a hit would raise, each needing further discrimination (secondary here):**
   - the response is carried by the genome;
   - it is heritable at the pond level;
   - it involves placing more of the pond at the edge;
   - in ponds that first evolved under the registration's scaffold, it continues once ranking stops.

## What a hit would and would not mean

- **A hit would mean:** under export-proportional donor selection, ponds evolved higher common-garden export performance than under shuffled weights, with everything else in the regime the same. That is a candidate seed: a response to selection among ponds on their own export, without ranking. The host still defines export and turns it into offspring numbers.
- **It would not establish:**
  - **collective reproductive organisation.** A cell-level trait, for example faster spread that carpets the tile and puts heavier packets at the edge, could produce the same hit. The secondary tests narrow this but cannot settle it;
  - **genetic attribution.** The Genome secondary addresses it only in part, and only under the condition stated there;
  - **reproductive specialisation or a germ line.** The edge-share secondary measures spatial share only;
  - **autonomous collective reproduction.** Transport stays host-side, and collectives do not decide when to reproduce;
  - individuality in the tracker's sense, or anything about the reset line's entity question;
  - **M7 by itself.** M7 as written in `docs/plan.md` specifies adhesion and signalling with a collective tracker, and is registered separately.
- **It is exploratory.** A hit is a candidate. Only a replication on fresh histories at α = 0.01 (Stage 2, a separate registration draft) supports a claim.
- **No hit** means "not found in this regime within these histories": 200 cycles from the ancestor, or 100 after the scaffold. It does not show that the regime cannot produce one.

## World

- **Physics: RULE_VERSION 1, unchanged.** The per-step rules, WGSL and golden pins are not touched. The new pond arms are host-side transforms between steps, like the integrated pond cycle (`docs/scaffold-integration-v1.md`). Their configuration keys are optional and absent from every existing configuration, so every existing preset, bundle and digest stays byte-identical.
- **Configuration:** the registration's (preset `ponds`):
  - `DEFAULT_EVAL`'s physics at 64 × 64 ponds, 8 × 8 ponds;
  - period 10,000, k = 8;
  - a clone start of `M3_FOUNDERS[2]`;
  - the default mutation rate (429,497).
- Only the pond arm and the two new keys below differ.

## The current: arms `nat` and `shuf`

**Export zone.** The cells of a pond whose Chebyshev distance on the 64-torus from the landing centre (32, 32) is at least 28: tile-local x ∈ {0–4, 60–63} or y ∈ {0–4, 60–63}. That is 1,071 cells, 26.1% of the pond, and at least 24 cells beyond the edge of a landed packet.
- **How it was chosen.** It was chosen after an exploratory read of existing checkpoints, at $0 on the Mac. That read is not a decision input:
  - the ancestor clone grown one period holds 16% of its trait mass in the zone, with mass there in 64 of 64 ponds;
  - protocol v1's six `scaf` and six `cont` worlds at boundary 100 hold 23.5–26.7%, in 60–64 of 64 ponds, with median export mass per pond 32,876–37,421;
  - v1's six `rand` worlds hold 13.3–24.8%, in 16–64 of 64 ponds, with a median of 0 in three of them.
- So the ancestor reaches the zone within one period, and a pond's edge mass varies between ponds and between regimes.

**Terms.**
- **Export mass** X_p of pond p: the sum of B+P over cells of its export zone with B+P ≥ 48 (the census support threshold), in the pre-cycle snapshot.
- **Occupied:** a pond whose trait (v1's: B+P over cells with B+P ≥ 48) is above 0.
- **Exporting:** a pond with X_p > 0. An occupied pond with no export is not extinct: it survives unless disturbed, and may reach the zone later.

**At each boundary b** (every period, b = step / period, absolute), from the pre-cycle snapshot:
1. **Death.** A pond dies if it is not occupied, or if `randomKey(seed, b, p, 12) < pondDeath · 65,536`. The hunt uses `pondDeath` = 32,768, so e = 1/2: an occupied pond lives two periods on average.
2. **Weights.**
   - `nat`: w_p = X_p.
   - `shuf`: the same multiset of weights, assigned at random:
     - list the exporting ponds in ascending pond index, with values x_1 … x_m;
     - order the same ponds by ascending (`randomKey(seed, b, p, 1)`, pond index);
     - the j-th pond in that order gets x_j.

     Ponds that do not export have weight 0. Fixed points of the permutation are allowed.
3. **Donors.** Each dying pond r, in ascending index, draws one donor with probability w_p / Σw:
   - v = `weightedPick(randomKey(seed, b, r, 10), randomKey(seed, b, r, 11), Σw)`;
   - then walk the ponds in index order, accumulating weights; the first pond whose cumulative weight exceeds v is the donor.

   Any pond with weight can be a donor, including dying ponds and the recipient itself: propagules are released before the disturbance strikes, and are copied from the snapshot.
4. **Packet.**
   - **Centre:** an eligible cell (B+P ≥ 48) of the donor's export zone, drawn with probability proportional to its B+P, by v1's weighted draw (purposes 3 and 4, slot r) over the zone's cells in tile-local raster order.
   - **Window:** k × k, wrapping inside the donor tile.
   - **Landing:** at the recipient's centre.
5. **Reset and copy, for dying ponds only.** v1's rules for clearing, copying, refilling A to M_r, and truncation.
6. **Survivors are untouched:** state, genome and lineage ids carry over bit for bit.
7. **No export anywhere** (Σw = 0). Every dying pond is cleared and refilled with A only. If no pond is then occupied, the history has ended. As in the registration, it keeps stepping, and that is a valid biological outcome.
8. **Ledger.** v1's two gross bookings, over the dying ponds only:
   - `heatOut` gets everything ground up;
   - `lightIn` gets every retained landed cell.

   Matter and the ledger are asserted before every upload, as for the integrated cycle.

**`ponds.tsv` rows.** One row per pond per boundary, with three appended columns: `died`, `exportMass` (X_p) and `weight` (w_p).

| Pond | `died` | `donor` | Packet fields |
|---|---|---|---|
| Recipient with a packet | 1 | the donor | filled |
| Dying with no export anywhere | 1 | −1 | 0 |
| Survivor | 0 | −2 | 0 |

**Derived rates and their denominators.**
- **Truncation rate:** truncated rows over recipient rows (died = 1 with a donor). v1's 1% flag applies to that rate.
- **Recolonisation success:** pooled over the stated boundaries. It is the number of recipients at b that meet v1's success rule at b + 1 (pre-cycle) over the number of recipients at b. Boundaries with no recipient add nothing.
- **Zero denominators.** Either rate is reported as not estimable (null), never as 0, whenever its recipient denominator is zero, for one boundary or for a whole pooled interval. A collapsed history stays valid data with null rates. G1's rule for the not-estimable case is stated under G1.

**What `shuf` controls for.** Given the same pre-cycle snapshot and death mask, `shuf` gets:
- the same recipients;
- the same multiset of weights;
- the same propagule rule and packet structure.

Only the link between a pond's own export and its number of offspring is cut.
- **Trajectories still diverge.** Once trajectories diverge, deaths of unoccupied ponds, recipient numbers, weight multisets and donor concentration can differ between the arms, for example if `shuf` collapses. Those differences are consequences of the intervention, not things held equal.
- **One exporter.** When only one pond exports, the two arms coincide.
- **`shuf` still selects on whether a pond exports.** In both arms a pond with no export cannot reproduce: the current carries only what reaches the edge. So `shuf` removes selection on how much a pond exports, not on whether it exports. The contrast tests selection on the amount of reproductive output, beyond its presence.

**Why not a migrant pool.** A migrant pool (propagules mixed from several donors) would also remove collective-level heredity. But building a k × k packet from several donors cuts individuals at every join, a structural confound that `shuf` avoids.

**Why e = 1/2.** It sits between v1's obligate reset (e = 1) and none. Ponds persist, and within-pond evolution runs for about two periods between bottlenecks. e = 1 is G1's pre-listed fallback.

## Arms and histories

24 histories per arm, i = 0–23. The `-a` histories run 2 × 10⁶ steps (200 cycles) under their arm, and the `-s` histories 10⁶ steps (100 cycles) after their 100 scaffold cycles. Every history therefore ends at absolute boundary 200.

| Arm | Origin | Regime |
|---|---|---|
| `nat-a` | the ancestor clone (preset `ponds`'s initial world) | `nat` from boundary 1 |
| `shuf-a` | the ancestor clone | `shuf` from boundary 1 |
| `nat-s` | source i: the boundary-100 pre-cycle state of a `scaf` history (below) | `nat` from boundary 100 |
| `shuf-s` | the same source i | `shuf` from boundary 100 |

- **Time C** is the pre-cycle state at boundary 200 (step 2 × 10⁶), written as an opt-in pre-cycle checkpoint (the registration's runner feature):
  - for the `-a` arms, after transforms 1–199;
  - for the `-s` arms, after transforms 100–199.
- **Sources of the `-s` arms (fixed now).** When Stage 1's queue is built, the 24 sources are chosen by one rule:
  - **The registration's histories,** if all 24 of its `scaf` histories have a boundary-100 pre-cycle checkpoint whose hash matches the registration's manifest.
    - An ended registration history is a valid source.
    - The hunt reads only these checkpoint files from the registration. It reads no assay, report or result, so the registration's analysis is unaffected.
  - **Otherwise, the hunt's own:** 24 `scaf` histories under the registration's configuration, with the hunt's seeds, run to boundary 100. All 24 sources then come from there, with no mixing.
- **Branch contract.** A branch:
  1. loads its source and verifies its hash;
  2. sets the configuration to the source's, with `pondArm`, `pondDeath` and `pondExport` set and `seed` replaced by the branch seed (the physics keys are unchanged);
  3. keeps the world step (10⁶), the lineage ids and M_r, the source's per-pond matter;
  4. takes the ledger baseline as `ledgerEnergy` of the loaded source;
  5. applies the boundary-100 transform immediately, with the branch seed's keys;
  6. starts its observers fresh on the post-transform state (`ponds.lastCycle` = 100), carrying over no tracker;
  7. steps to 2 × 10⁶, transforming at boundaries 101–199;
  8. records the source path and hash in its manifest.

  **Replay checks (in the build's tests):**
  - the first transform equals the CPU transform applied to the decoded source;
  - a branch run in two segments equals the continuous branch byte for byte.
- **Pairing.** Within each `-s` index i, `nat-s` and `shuf-s` share their source and differ in regime and seed. The `-a` arms are independent histories.
- **Ancestor worlds:** 4 clone worlds grown one period (`pond-cont`, 10,000 steps). They are the time-0 reference of the `-a` arms (descriptive), and world 0 supplies the genome-only assay's fragments.

## Assay: export performance W (one life cycle in a common garden)

W is the **family-uniform offspring export performance** of a source state S: for each exporting pond of S, the mean export mass reached by ponds founded from its edge propagules in a fresh pond with mutation off, then averaged with equal weight over ponds. It is not the population's realised reproductive success:
- in the regime, donors are used in proportion to their export, which W does not weight;
- survivors also persist across boundaries, which a one-period assay omits.

**Procedure,** for a source S at its pre-cycle step:
- **Families:** every exporting pond of S, in ascending pond index, with m the number of families. If m = 0, W(S) = 0: a measured outcome, because the world releases no propagules.
- **Fragments.** Four replicates, s = 0–3. Each replicate is one assay world of 64 fresh ponds:
  - per-pond matter M_assay = 151,552, mutation off, one period of 10,000 steps, no transform.
  - **Source family:** the fragment in assay pond f of replicate s, with global index g = 64·s + f, comes from family g mod m. With m = 64, each pond of S is a family with four fragments.
  - **Centre:** drawn as in step 4 of the current, within that family's export zone, with keys (σ(h, s), 0, f) and purposes 3 and 4.
  - **Landing:** the window lands at the assay pond's centre, with v1's truncation and relabelling rules.
- **Measured per fragment, at the end of the period:**
  - X_f, the assay pond's export mass;
  - its trait;
  - v1's success flag (trait ≥ 0.25 · 103,058 and ≥ 4 × retained landed B+P), descriptive.
- **W(S):** the mean over families of each family's mean X_f, with equal weight per family whatever m is.
- **Also reported:** the export-weighted version Σ_p X_p · (family mean of p) / Σ_p X_p, which follows the regime's donor weighting.
- **Quenched control:** S's replicate-0 fragments with the controller weight words and E set to 0, relabelled (64 fragments). It runs on every `nat` source at time C.

**Genome-only variant.** It addresses the genetic-attribution question in part.
- **Fragments:** ancestor world 0's fragments, by the procedure above with σ(96, s) for sampling and physics. Every history's genome set uses these same fragments, in the same physics stream.
- **Genome:** every cell's genome words are replaced by G_h, the dominant genome of history h's time-C state, and relabelled to one id. G_h is the lineage with the largest trait mass over cells with B+P ≥ 48, ties to the smallest (hi, lo).
- **Score:** W_G(h) is W on that set. A history with no eligible cell at time C has no genome, and its W_G is 0 by definition, in either arm.
  - W_G is therefore a composite of genome availability and genome performance.
  - The number of histories with a genome is reported per arm.
- **Control:** one set of the same fragments carrying `M3_FOUNDERS[2]`, relabelled. It is descriptive.
- **Scope:** only the dominant genome is tested, so a community-level effect can be missed.

**Why W.** Export is what `nat` selects on, and W measures it in a common environment with mutation off, on offspring rather than on the selected ponds themselves. It is continuous, and the earlier read suggests it is not near a ceiling:
- the ancestor's median export mass after one period was 16,594;
- v1's `scaf` and `cont` worlds hold 32,876–37,421 at boundary 100, and `rand` worlds 0–24,017 (medians per world).

Competence, by contrast, is near its ceiling in evolved worlds.

## Stage 0 (Mac, $0): build, then two gates and a diagnostic

**Build** (see "Code to build"). G1 and G2 must pass, in order, before Stage 1 can be proposed.

**G1, viability and selection strength.**
- **What runs:** `nat` and `shuf` from the ancestor, mutation on, 2 seeds each, boundaries 1–30.
- **A `nat` run is viable if:**
  - it has not ended;
  - the mean fraction of occupied ponds over boundaries 2–30 is at least 0.5;
  - pooled recolonisation success over recipients of boundaries 1–29 is at least 0.3. With no recipient in that interval the success is not estimable, and the run is not viable;
  - matter and the ledger are exact at every census and transform.
- **Selection strength.** A `nat` run has a non-negligible contrast if the mean coefficient of variation of X among exporting ponds, over boundaries 2–30, is at least 0.1. Boundaries with fewer than two exporters count as 0.
- **Recorded per boundary for all four runs** (descriptive):
  - the number of exporters;
  - that coefficient of variation;
  - the effective number of donors (Σw)² / Σw²;
  - the Spearman correlation between X_p and realised offspring count, among exporting ponds. It should be positive in `nat` and near 0 in `shuf`.

  A diagnostic is reported as not estimable (null) when it is undefined: fewer than two exporters, constant values, or Σw = 0.
- **`shuf` runs** need only exact conservation. A collapse or an ending in `shuf` is a biological outcome, the one the control exists to reveal.
- **Decision:**
  - if either `nat` run is not viable, G1 reruns once with e = 1 (`pondDeath` 65,536) at the fallback seeds;
  - if that fails too, or if either viable `nat` run lacks selection strength, the hunt stops and is reported.

**G2, a sensitivity check of the instrument.**
- **What runs:** W on protocol v1's main-run states at boundary 100, pre-cycle: `scaf` i0–i5 and `rand` i0–i5 (`runs/scaffold/main`).
- **It passes if:**
  - W(`scaf` i) > W(`rand` i) for at least 5 of the 6 indices;
  - X_f > 0 in at most 5% of each `scaf` source's quenched fragments.
- **What it shows.** The known difference between these regimes is in productivity, not W. So passing shows only that W registers a large difference in evolved material, and that the quenched control is dead.

**D3, a non-genetic-effects diagnostic (no gate).**
- **What runs:** four pairs of `nat` and `shuf` histories from the ancestor clone with **mutation off**, boundaries 1–30, then W at the boundary-30 pre-cycle state, with 4 replicates.
- **Reported:** the four history-level differences in W, beside the spread of W among the four `nat` histories.
- **What it can and cannot show.**
  - Without genetic variation, a difference would come from selection on the ponds' non-genetic state.
  - Four pairs cannot exclude such effects, and 30 ancestral cycles cannot speak for 200 cycles or for scaffold-derived material.
  - So D3 informs interpretation and never decides. Genetic attribution is addressed, in part, by the Genome secondary.

The gates' and the diagnostic's outputs are recorded in a dated amendment before any Stage 1 draw. Stage 0 also measures throughput.

## Stage 1 tests (the hunt)

One-sided, exact, at α = 0.05 with Holm over the two contrasts. Here α is a discovery threshold: every hit must replicate at α = 0.01 before any claim.

- **Contrast A (from the ancestor).** W(`nat-a`) against W(`shuf-a`) at time C, by an exact one-sided Mann–Whitney test, 24 against 24 (`mannWhitney(…, "exact").pGreater`).
  - The arms are independent histories, so under the null their values are exchangeable.
- **Contrast S (after the scaffold).** d_i = W(`nat-s` i) − W(`shuf-s` i) at time C, by an exact one-sided Wilcoxon signed-rank test over the 24 pairs (`wilcoxonSignedRank(d, "exact").pGreater`).
  - The null is that the two branches of one source are exchangeable: same source, independent seeds, and a regime label that does not matter. Then d_i is symmetric about 0, which the signed-rank test needs.
  - The registration's H2 had no such exchangeability, which is why it uses a sign test.
  - Zero differences (both branches at W = 0, say) are dropped, the standard treatment.
- **Hit.** A contrast is a hit when its Holm-adjusted p is at most 0.05.
- **Inputs.** Every input value is checked to be finite before any test.

**Secondary (Holm over the seven tests below, at α = 0.05; never changes a hit).** p is exact except where stated. This family's guarantee is separate from the primary family's: there is no experiment-wide 0.05 across both.
- **Genome composite** (two tests). W_G(`nat-a`) > W_G(`shuf-a`) by Mann–Whitney, and the paired W_G differences of `nat-s` and `shuf-s` by Wilcoxon signed-rank.
  - **A composite endpoint:** genome availability and genome performance together.
  - **Genome performance alone.** A test is read as genome performance only if every history in both compared arms has a genome. Otherwise it is reported as the composite, with the availability counts, and with a descriptive comparison of measured W_G among histories that have a genome. That comparison is conditional on survival, so it is never tested.
  - **Even then, it is limited:** the comparison concerns dominant genomes on one fixed ancestral background, and does not establish that the genome causes the W difference.
- **Heredity** (two tests, `nat-a` and `nat-s`).
  - **Per history at time C:** the one-way ICC(1) of X_f, with families as groups.
  - **Its p** is a Monte Carlo permutation p: 1,000 permutations of family labels by R1's Fisher–Yates scheme, with stream σ(h, 8) in place of R1's σ8, and p = (1 + #{permuted ICC ≥ observed}) / 1001.
  - **Not significant** for that history, without a test: fewer than two families, or a family with only one fragment, or a constant X_f across all fragments.
  - **The arm's test:** the count of histories with ICC > 0 and p < 0.05, among a fixed 24. Its p is the exact binomial upper tail under a per-history rate of 0.05.
  - **`shuf` arms** get the same statistic, descriptively: heredity is expected under both, as R1″ found in `rand`.
  - **What it measures:** transmitted differences between families, including copied mass, energy and structure, not only genes.
- **Edge share** (two tests).
  - **Per history:** E_h = Σ X_f / Σ trait_f over its 256 fragments, with E_h = 0 when Σ trait_f = 0.
  - **Tests:** `nat-a` > `shuf-a` by Mann–Whitney, and `nat-s` against `shuf-s` paired by Wilcoxon signed-rank.
  - **Reference:** reported beside the zone's area share, 0.261.
  - **What it measures:** a spatial share. A faster-spreading carpet raises it too, so it does not establish reproductive allocation or a germ line.
- **Improvement after withdrawal** (one test). The count of sources i with W(`nat-s` i, time C) > W(source i), among 24. Its p is the exact sign-test p.
  - It is a sign test because a history's states at two times are not exchangeable.
  - It tests improvement, not maintenance: a source whose W is unchanged counts as not improved.
  - The same count for `shuf-s` is descriptive.

**Descriptive (never decision inputs):**
- from `ponds.tsv`, per boundary:
  - occupancy and exporting ponds;
  - recolonisation success;
  - offspring-number distributions and the effective number of donors;
  - mean export share, distinct lineages and truncation rate;
- the export-weighted W of every history;
- W of the 4 ancestor worlds and of the 24 `-s` sources, and each history's W against them;
- the ancestor-genome control's W_G;
- the success fraction of every assay set;
- retained B+P and E of every set's fragments.

## Validity, missing data and availability

The registration's rules, applied before any test, in this order:
1. **Device check** as every instance's first command: arm `nat` from preset `ponds`'s initial world, seed 4,905,001, 20,000 steps. Its `finalHash` must equal the Mac's.
2. **Infrastructure failures** are rerun with the same seeds.
3. **Event overflow** is rerun at census 100.
4. **Unresolved failures** are never dropped.
   - A Mann–Whitney or signed-rank comparison that would include an unresolved value is **not assessed**, with Holm slot p = 1. That covers the contrasts, Genome and Edge share.
   - In Heredity and Improvement, an unresolved history counts as not significant or not improved, with the denominator fixed at 24.
   - More than 6 unresolved histories in any arm makes Stage 1 **uninformative**.
5. **Quenched gate.** If X_f > 0 in more than 5% of any quenched set's fragments, Stage 1 is **invalid**.
6. **Biological outcomes are data.** An ended history, W = 0 and W_G = 0 are measured values.
7. **Reproducibility.**
   - Two histories are chosen: the first two distinct values of `randomKey(4,905,101, 0, k, 0) mod 96`, for k = 0, 1, …, indexing the histories in seed order.
   - Each is rerun on the Mac for 34 boundaries from its start: to boundary 34 for the `-a` arms, 134 for the `-s` arms.
   - Its pre-cycle checkpoint there, which the instance run also writes, must match the instance's hash, or Stage 1 is **invalid**.
- **No interim analysis.** Until the queue completes, only technical status is examined.
- **Budget stop.** If the hard stop comes first, nothing is analysed. Stage 1 is **uninformative** unless a further dated draw completes the same queue with the same seeds.

## Outcomes and disposition

The first three rows apply to the whole stage, first match:

| Outcome | Statement | Next |
|---|---|---|
| Stopped at Stage 0 | G1 (with its fallback) or G2 failed. | Report; any redesign only by dated amendment. |
| Invalid | The device, quenched or reproducibility check failed. | Report; no claim. |
| Uninformative | More than 6 unresolved histories in an arm, or the budget stopped the queue. | Report; decide whether to complete. |

Otherwise each contrast, A and S, is reported as one of:

| Contrast status | Statement | Next (each a separate dated decision) |
|---|---|---|
| **Hit** | Higher export performance under export-proportional selection than under shuffled weights, from that origin: a candidate seed, as defined above. | Stage 2: a registration draft replicating it on fresh histories (24 per arm, α = 0.01). Then discrimination (genome, structure, cell-level spread) and the M7 question. |
| **No hit** | Not found from that origin in this regime within its histories. | Candidates: e = 1, longer histories, a multi-founder start, a different export zone. |
| **Not assessed** | An unresolved value entered the comparison. | Report; decide whether to rerun. |

- **Comparing origins.** A hit from one origin and no hit from the other does not show that the effect depends on origin. There is no test of the difference.
- The secondary results are reported beside the contrasts and never change them.

## Sample size

The `-s` arms have 24 histories because the registration has 24 `scaf` histories, each branched into both arms; the `-a` arms match. No effect size is assumed from earlier data.
- v1's ranking (`scaf` against `rand`) produced very large differences, for example median productivity 136,940 against 30,977 at the end.
- But proportional selection on export is weaker than truncation on mass.

Power is therefore given for generic effect sizes. It is per contrast, at α = 0.025 (the strictest Holm step). It comes from `tools/hunt-power.ts`: normal shifts, 2,000 simulations per cell (Monte Carlo standard error at most 0.011), seed 20,261,002.

**Zero-inflated scenario.** With probability z, a history's value is replaced by a value tied below every other value. That is an extinct export, W = 0:
- independently for each of the 48 values in contrast A;
- for both members of a pair in contrast S, which then drops out as a zero difference.

| Effect (among histories whose export is not extinct) | 0.65 | 0.70 | 0.75 | 0.80 |
|---|---|---|---|---|
| Contrast A: Mann–Whitney 24 v 24, effect P(X > Y) | 0.44 | 0.69 | 0.87 | 0.97 |
| Contrast A, z = 0.25 | 0.17 | 0.27 | 0.39 | 0.54 |
| Contrast S: signed-rank on 24 pairs, effect P(d > 0) | 0.42 | 0.66 | 0.87 | 0.97 |
| Contrast S, z = 0.25 | 0.31 | 0.55 | 0.75 | 0.89 |
| A sign test on 24 pairs, for comparison (needs 18 of 24) | 0.21 | 0.39 | 0.61 | 0.81 |

The output is `experiments/scaffold/hunt-power.json`.

- **What the table says:**
  - At 24 per arm, each contrast detects a moderate effect (about 0.75) with probability of roughly 0.9, and would likely miss an effect below about 0.7.
  - Extinct exports cost power, contrast A's most. If each history independently has no export with probability 1/4, A's power at 0.75 falls to about 0.4; S keeps about 0.75, because its shared extinctions only drop pairs.
- **What it does not say:** it is conditional on these planning models. It is not the probability of finding any seed.

## Seeds (block 4,900,001–4,949,999, reserved for the hunt)

- **G1:** 4,900,001 + 10·arm + s (arm 0 `nat`, 1 `shuf`; s 0–1). Fallback (e = 1): 4,900,101 + 10·arm + s.
- **G2:** σ(h, s) = 4,900,201 + 10·h + s, with h 0–5 for `scaf` i0–i5 and 6–11 for `rand` i0–i5, and s 0–3. At most 4,900,314.
- **D3:**
  - worlds 4,900,401 + 10·arm + j (j 0–3);
  - assays σ = 4,900,501 + 10·(4·arm + j) + s with s 0–3, at most 4,900,574.
- **Histories:** 4,901,001 + 100·a + i, with a 0 `nat-a`, 1 `shuf-a`, 2 `nat-s`, 3 `shuf-s`, and i 0–23. At most 4,901,324.
- **Ancestor worlds:** 4,901,401 + j (j 0–3).
- **Own scaffold phase** (only under the sources rule): 4,901,501 + i.
- **Stage 1 assays:** σ(h, s) = 4,902,001 + 10·h + s, with:
  - h = 24·a + i (0–95) for the histories at time C;
  - 96 + j (96–99) for the ancestor worlds; world 0's σ also serves every genome-only set and its control;
  - 100 + i (100–123) for the `-s` sources.

  s 0–3 are the replicates and 8 the permutation stream. At most 4,903,239.
  - Every variant on one source (quenched included) uses that source's σ(h, s), for fragment sampling and for the assay world's physics.
- **Other:** device check 4,905,001; reproducibility draw 4,905,101.
- **Purposes.** The new random-key purposes 10–12 are unused by every existing pond, assay and permutation stream, which use purposes 0–9.
- **No collisions.** No seed in this block is used by earlier work. That was checked on 2026-10-01 against `docs/`, `experiments/`, `tools/`, `packages/` and the sibling workspaces' docs.

## Code to build (Stage 0)

Built, tested and reviewed by Astra before any gate runs:
- **Schema (`packages/schema/src/ponds.ts`, `config.ts`):**
  - arms `nat` and `shuf`;
  - optional keys `pondDeath` (1–65,536) and `pondExport` (1–32, the Chebyshev threshold, here 28), set exactly when the arm is `nat` or `shuf`;
  - the `ponds.tsv` rows above;
  - every existing configuration, preset identity and `ponds.tsv` stays byte-identical.
- **Conditions** `pond-nat` and `pond-shuf`.
- **Runner:**
  - branch runs by the branch contract;
  - stitch and continuation rules extended to the new arms;
  - the island capability `ponds-v2`, so the coordinator never hands these runs to a `ponds-v1` island.
- **Lab:** it refuses `nat` and `shuf` configurations with a clear message, as it refused pond configurations before integration step I2.
- **Assays:**
  - the export assay in `tools/scaffold-assays.ts`: families, X_f, the edge share, the ICC, quenched and genome-only sets, the hunt's seeds and provenance;
  - a report stage `scaffold-report.ts hunt1` writing `experiments/scaffold/readouts/hunt1.json`.
- **Tests:**
  - the transform: matter and ledger exact; survivors bit-identical; death frequency; weights; `shuf` a permutation; the zero-export path; self-donation; determinism; row sentinels and denominators;
  - golden pins and preset identities unchanged;
  - segmented runs equal to continuous ones for both arms, on a small preset;
  - the branch replay checks;
  - stitch rules, the assay's seed formulas, and the decision procedure on crafted inputs, including the undefined-statistic rules.

## Compute and budget

- **Stage 0 (Mac, $0):** about 4.5 × 10⁶ 512² steps:
  - G1: 1.2 × 10⁶, plus 1.2 × 10⁶ for the fallback if needed;
  - G2: 0.5 × 10⁶;
  - D3: 2.7 × 10⁶.

  The Mac measured 250–470 steps/s per lane at 512² in the heredity replication, so about 3–5 hours.
- **Stage 1, with the registration's sources:** about 153 × 10⁶ steps:
  - 48 `-a` histories × 2 × 10⁶ and 48 `-s` histories × 10⁶;
  - 124 W sets × 4 × 10⁴;
  - 96 genome-only sets and their control × 4 × 10⁴;
  - 48 quenched sets × 10⁴;
  - the ancestor worlds and device checks.

  On AWS (three g5.xlarge, six lanes each), that is about 11 hours: about $32 of compute at the R3 replication's $0.21 per 10⁶ steps, an estimate of about $38 and a hard stop of $48.
- **Stage 1 with its own scaffold phase** (only under the sources rule): about 177 × 10⁶ steps, about 13 hours: about $37 of compute, an estimate of about $44 and a hard stop of $55.
- **Where (decided 2026-10-02): AWS**, on the registration's instance setup, after the registration's queue has completed. On the Mac it would have been $0 but roughly 4–8 days of a shared GPU.
- **Funding.** The spend comes from the cohort reserve (about $117.18), only by a dated draw note approved by the user before any paid run.
  - With the registration (estimate about $28, hard stop $40) and its sources, the two together come to about $66 estimated, or $88 at the hard stops. That leaves at least $29.18.
  - If the hunt has to run its own scaffold phase, the hard stops come to $95, leaving at least $22.18.
  - A Stage 2 replication is costed in its own draft. It may need more than what remains.
  - The $60 RULE_VERSION 2 go/no-go is untouched.

## Design choices, and what was left out

Within one budget, the hunt puts its histories into one regime with a sharp control and two origins, rather than many regimes with few histories each. Each regime needs a matched control and enough histories to see a moderate effect, and four arms of 24 is what the reserve holds beside the registration. Of the cheap levers, longer histories came first: the `-a` arms run 200 cycles. Using every exporting pond as a family, rather than a sample, makes W a census of the world's collectives at no extra cost.

Considered and left for later, each as a dated decision:
- **e = 1:** stronger collective selection, but less withdrawn. It is G1's fallback.
- **A multi-founder start:** consortia, an egalitarian route. It would lose comparability with the scaffold line.
- **Adhesion:** its cohesion effect is not demonstrated, about 1% at the maximum gain (`WorldConfig.adhesion`), and enabling it is M7's registered route.
- **Narrower bottlenecks:** k = 5 failed P1's viability.
- **A migrant pool:** the packet-structure confound, above.
- **Release into one connected torus with the collective tracker:** evolved ponds carpet their tile, so proximity collectives would merge into one.

## Freeze and order of events

1. **Settings decided by the user (2026-10-02):**
   - **Death rate:** e = 1/2, with G1's fallback to e = 1.
   - **Export zone:** Chebyshev distance at least 28 from the centre.
   - **Length:** 200 cycles for the `-a` arms.
   - **Thresholds:** α = 0.05 for discovery, with replication at 0.01.
   - **Where:** Stage 1 on AWS.
   - **Order:**
     1. The registration is settled, frozen and run first.
     2. Stage 0 runs on the Mac meanwhile.
     3. Stage 1 starts only after the registration's queue has completed, and branches from the sources the sources rule above designates (the registration's, or the hunt's own as the fallback).

   **Still open:** approval of this document as a whole. The registration was frozen on 2026-10-02.
2. **Freeze,** after the registration's: a review of the final text, then a commit. The document's SHA-256 goes in `experiments/scaffold/HUNT-v1` and a dated note in `docs/plan.md`.
3. **Stage 0:** code, its Astra review and commit; then G1, G2 and D3 on the Mac; then a dated amendment with their results.
4. **Stage 1:** a dated draw note, approved by the user; the runs; the report; an independent re-derivation of every number; an Astra review; the dated result entry.
