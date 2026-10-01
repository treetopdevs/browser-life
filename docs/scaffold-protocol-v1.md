# Ecological scaffolding: protocol v1 (sandbox, not registered)

*2026-09-30. Opened by the dated decision "Ecological scaffolding (sandbox) — 2026-09-30" in `docs/plan.md`. This line is exploratory under RULE_VERSION 1. It does not answer the reset line's entity question and does not count toward M6. Its readouts are never confirmatory. Once the main run starts, any change to this document goes in a dated amendment at the end.*

## Question

The north star's hardest item is a collective that reproduces as a unit through a bottleneck. Experimental evolution has produced such collectives by imposing a group life cycle through the environment (Ratcliff et al. 2012; Hammerschmidt et al. 2014; Black, Bourrat & Rainey 2020, "ecological scaffolding"). This protocol imposes one on RULE_VERSION 1 worlds. Tiles are ponds. Each cycle, every pond is ground back to nutrient and reseeded by a small packet taken from a donor pond.

The questions, in order:

1. **Can the machinery see selection among ponds?** A positive control on standing variation, mutation off (P2).
2. **Does the scaffold take?**
   - Is pond-level heredity demonstrable (R1)?
   - With mutation, do ponds under selection improve beyond what the bottleneck alone gives (R2)?
3. **Does the evolved group-level trait survive removal of the scaffold (R3)?**

A descriptive side question (R4) asks whether evolution without the scaffold loses capability that evolution with it keeps. Test 5 measured lower regeneration in evolved lineages (0.168 against 0.979 for founders). That the loss happens because nothing pays for organisation is a hypothesis, not an established cause.

## World

- **Physics: RULE_VERSION 1, unchanged.** The per-step CPU and WGSL rules are not touched, no `WorldConfig` key is added, and no golden pin moves. The pond cycle is a host-side transform between steps: `GpuSim.readState()`, transform, check, `GpuSim.upload()`. `upload()` runs `validateState`.
- **Configuration: the M3 evaluator's.**
  - `defaultConfig({ ...DEFAULT_EVAL.world, tileW: 64, tileH: 64, tilesX: s, tilesY: s, seed })`. `DEFAULT_EVAL.world` is μ 60, σ 20, kernel radius 9, uniform light 40/160.
  - Mutation rate: the default, `mutRate` 429,497, as in the M4 treatment runs. The mutation-off arms set `mutRate: 0`.
  - s = 4 (16 ponds, 256²) in P1; s = 8 (64 ponds, 512²) everywhere else.
- **Initial state: the evaluator's seeding** (`evaluate.ts:181`). Every pond gets one disc at its centre (32, 32): radius 10, biomass 64, energy 128, in nutrient 32.
  - The ancestor is `M3_FOUNDERS[2]` (cluster 2) in every pond: one clone per history.
  - P2 plants the 12 M3 founders round-robin: pond t gets founder t mod 12.
  - `buildWorld` numbers lineage ids by planting index (`world.ts:79`). The tool therefore records the map from planting index to founder index in `meta.json`.

## Pond cycle

**When.** A cycle runs at every boundary step b·`period`, for b = 1, 2, …. Boundary b falls after the census at that step and after the mutation ledger has been drained. That order matters because `upload()` resets the EVENTS, DROPPED and FLAGS words. The transform at boundary b is called **cycle b**. Every quantity below is read from the **pre-cycle snapshot** at that boundary.

1. **Trait.** A pond's trait is its bound mass B+P, summed over its cells with B+P ≥ 48. That is the census support threshold, so scattered dust does not count. A pond is **eligible** (surviving) if its trait is above 0.
2. **Donors.** R is the number of ponds (64). Let D = R/4, and let D′ = min(D, number of eligible ponds).
   - `scaf`: the D′ eligible ponds with the highest trait. Ties are broken by ascending random key.
   - `rand`: D′ eligible ponds drawn without replacement, by taking the D′ smallest random keys among eligible ponds.
   - Both arms allocate recipients the same way. All R ponds, donors included, are ordered by ascending random key. The recipient at position p gets donor number p mod D′, where donors are numbered in selection order.
   - Every donor therefore seeds ⌊R/D′⌋ or ⌈R/D′⌉ recipients. Families are identified by the actual donor pond.
   - If no pond is eligible, the history has ended. The cycle still clears every pond, writes its rows and stops the run.
   - `cont` has no cycle. It writes the same pond-summary rows at the same boundaries.
3. **Packet.** For each recipient, one k×k window is taken from its donor.
   - **Centre:** an eligible cell of the donor (B+P ≥ 48), drawn with probability proportional to its B+P.
   - **Window:** offsets −⌊k/2⌋ … k−1−⌊k/2⌋ on each axis around the centre, wrapping **inside the donor tile**. k ≤ 64.
   - **Landing:** window cell (i, j) lands at recipient-local (32 − ⌊k/2⌋ + i, 32 − ⌊k/2⌋ + j). That fits in the tile for every k ≤ 64, so landing never wraps.
4. **Random keys.** Every key is `draw(cellBase((seed ^ POND_SALT) >>> 0, b, slot), purpose)`, with `POND_SALT` = 0x504F4E44 ("POND"). Slot is the pond index. Where the text says "ascending random key", the order is by (key, pond index) ascending. Purposes:
   - 0: tie-break key;
   - 1: `rand` selection key;
   - 2: recipient order key;
   - 3 and 4: the recipient's packet-centre draw, high and low words.

   A weighted draw computes `(hi · 2^21 + (lo >>> 11)) mod total` in safe-integer arithmetic, then walks the pond's cells in raster order (y, then x, tile-local), accumulating weights. The first cell whose cumulative weight exceeds the drawn value is chosen.
5. **Reset and copy.** Packets are copied from the snapshot, so they can repeat.
   - **Clear:** every cell of every pond is cleared first. A = B = C = P = E = S = 0, MOT = `MOT_ZERO`, and all 44 genome words are 0.
   - **Place packets:** each recipient's landing cells get the packet cells' B, P, E and MOT and all 44 genome words.
   - **Refill A:** the pond's A is set so its total matter equals M_r, the pond's matter A+B+C+P in the initial state. It is spread uniformly: ⌊(M_r − m_r)/4096⌋ per cell, plus one quantum per cell in raster order for the remainder. Here m_r is the landed B+P.
   - **Truncation:** if m_r > M_r, landing cells are dropped in reverse raster order until m_r ≤ M_r. Dropped cells stay cleared, and the row records requested and retained B+P and E, with `truncated` = 1. If more than 1% of recipient rows in a history are truncated, the history is flagged. Decisions use every history. A sensitivity result that leaves flagged histories out is reported beside them. If it would change a decision, the result is reported as sensitive to truncation.
   - **Matter:** M_r is constant over the whole history. Transport and diffusion never cross a tile edge, and the cycle restores M_r. The tool asserts, before every upload, that every pond's matter equals M_r.
6. **Energy ledger.** Two gross bookings, never netted:
   - `heatOut +=` Σ over every cell of the pre-cycle world of (eB−eA)·B + (eP−eA)·P + (eC−eA)·C + E + S;
   - `lightIn +=` Σ over every **retained** landing cell of (eB−eA)·B + (eP−eA)·P + E.

   Both are non-negative bigints, so the invariant Σe·X + E + S + heatOut − lightIn is unchanged. The tool checks, before each upload, that the post-transform state's ledger residual against the run's baseline is 0. It also checks matter and the residual at every census, as `runner.ts:698–701` does for world totals. Any violation stops the run.
7. **Records.**
   - **`ponds.tsv`:** one row per recipient per cycle. The columns are fixed in `tools/lib/ponds.ts` (`POND_COLUMNS`) and include:
     - cycle and step;
     - recipient and donor;
     - packet centre (x, y);
     - cells landed;
     - requested and retained B+P and E;
     - `truncated`;
     - distinct lineage ids in the packet, plus the dominant lineage and its share;
     - donor trait and recipient trait (pre-cycle), and the recipient's pre-cycle census individuals and distinct lineages;
     - heat and light booked for the recipient.
   - **Checkpoints:** full `encodeCheckpoint` states, gzipped, with the configuration and this protocol's SHA-256 in `meta.json`. They are taken at the initial state; post-cycle at cycles ⌊C/3⌋, ⌊2C/3⌋ and C; every 50 cycles, for resuming; and pre-cycle at the final boundary. A resumed run continues exactly from a full checkpoint.
   - **`packets/`:** per-cycle landed packets, for analysis only. They are not a continuation format.
   - **`frames/`:** optional pre-cycle PNG images.
8. **Observers.** The census right after each cycle is flagged. Tracker overlap links across a clearing are meaningless, and no analysis uses tracker parenthood.

## Pilots (Mac)

### P1: regime (seeds 4,800,001 + 100·g + s, g = 0–14)

- **Setup:** 16 ponds, ancestor clone, arm `rand` (so D = 4), mutation on, 15 cycles, s ∈ {0, 1}.
- **Grid:** g indexes k ∈ {3, 5, 8} × period ∈ {1,000, 3,000, 10,000} in row-major order, g = 0–8.
- **Reference.** ref(period) is the median of the boundary-1 trait, the pre-cycle trait at boundary 1, pooled over all ponds of every run with that period (every k and both seeds). Boundary 1 is the ancestor growing for one period from its standard disc, before any cycle, so k does not affect it. If ref = 0, the period fails.
- **Success rule for a recipient of cycle b:** its trait at boundary b+1 is at least 0.25·ref, and at least 4× its retained landed B+P. The second condition means regrowth rather than persistence.
- **A regime passes if each seed separately meets all of these,** over the recipients of cycles 1–14 and boundaries 2–15. If a history ends early, its scheduled but uncompleted recipients count as failures, and each missing boundary counts as fully ineligible with CV 0.
  - (a) the success fraction is between 0.3 and 0.9. At the top this leaves room for improvement; at the bottom it requires viability.
  - (b) the mean fraction of ineligible ponds per boundary is at most 0.5;
  - (c) the mean coefficient of variation of the trait across ponds is at least 0.1. A boundary with mean trait 0 counts as CV 0.
  - (d) matter and the ledger are exact at every census and every transform.
- **Choice:** the smallest passing k, then the shortest passing period.
- **Fallback:** if nothing passes, k ∈ {12, 16} × the same periods (g = 9–14), once. If that also fails, the line stops at P1.
- **Calibration for R3,** at the chosen regime (seeds 4,802,001 + 10·v + s, where v = 0 is the ancestor source world, v = 1 ancestor competence and v = 2 quenched competence):
  - the ancestor competence (as defined in R3) must be between 0.2 and 0.9;
  - the quenched control's competence must be at most 0.05.
  - The quenched control is the same fragments with the 40 controller weight words and E set to 0, relabelled.
  - Otherwise the next-smallest passing regime is tried.
- **Throughput:** P1 records steps per second, and the other GPU processes running on the Mac are logged.

### P2: positive control (seeds 4,805,001+)

- **Ranking assay** (seeds 4,805,001 + s):
  - 64 ponds with founders round-robin, mutation off, no cycle, one period.
  - A founder's rank score is its mean pond trait at boundary 1, over its ponds and both seeds.
  - The **high set** is the 6 founders with the highest rank score, ties broken by founder index.
- **Selection runs** (seeds 4,805,101 + 10·arm + s, where arm 0 is `scaf` and arm 1 is `rand`):
  - 64 ponds, founders round-robin, mutation off, the P1 regime, 20 cycles.
  - Founder identity comes from lineage ids through the planting map. With mutation off, lineage ids never change.
- **High share at boundary b:** the fraction of the world's trait mass (cells with B+P ≥ 48) that belongs to high-set founders.
- **Passes if both hold, in both seeds:**
  - Δ = high share at boundary 20 − high share at boundary 1 is at least 0.10 in `scaf`, and exceeds `rand`'s Δ for the same s;
  - the mean trait at boundary 20 is higher in `scaf` than in `rand`.
- **If P2 fails, the line stops:** the machinery cannot see selection among ponds.

**Freeze.** The P1 regime, the calibration numbers, P2's result and the frozen main configuration are recorded in a dated amendment, with the configuration's SHA-256, before the main run.

## Main run (seeds 4,810,001 + 100·arm + i)

- 64 ponds, ancestor clone, the frozen regime, mutation on.
- Arms: 0 = `scaf`, 1 = `rand`, 2 = `cont`. Histories i = 0–5.
- C = ⌈10⁶ / period⌉ cycles; census every 100 steps.

## Readouts (assay seeds)

`assaySeed(r, h, t, v, s)` = 4,820,001 + 5000·r + 250·h + 100·t + 20·v + s. The fields are:
- r: 0 = R3's no-cycle continuations, 1–4 = R1–R4;
- h = 6·arm + i: the history index (0–17), or 18 for the ancestor;
- t: time or timing (0 = time 0 or R3 timing (a); 1 = time C or timing (b));
- v: the inoculum variant (0 fragment, 1 disc, 2 `swap-ea`, 3 `swap-ae`, 4 quenched);
- s: the replicate (0–9). s = 9 is reserved for R1's donor selection.

This mixed-radix formula is collision-free by construction. Every variant of one assay on a given source, time and replicate uses the same σ = `assaySeed(r, h, t, 0, s)` for fragment sampling and for the assay world's physics seed. That is deliberate pairing, with common random numbers: swap and quenched arms get the same physical fragments and the same physics stream as their unmodified arm. The v field only labels the variant, except for R2's disc inoculum, which uses v = 1 as its own seed. Its maximum is 4,844,690, within the reserved range, and the tools assert every field's range. P1's seeds end at 4,801,402 and the calibration uses 4,802,001–4,802,022, so they do not collide.

### Assay world

Every assay plants material into fresh ponds:
- each pond's total matter is the fixed budget M_assay = 151,552 (= 4096 × 37). That is close to an ancestor pond's initial matter: nutrient 32 × 4096, plus a disc of about 20,000. The planted B+P is taken out of that pond's A, which is spread uniformly with the raster remainder rule. If the planted B+P exceeds M_assay, cells are dropped in reverse raster order, exactly as in the cycle, and requested and retained B+P and E are recorded. Every arm and control uses the same rule;
- mutation off unless stated;
- 64 ponds at 512².

Before an assay world is built, every distinct genome in it is relabelled to lineage id (0, k+1), where k is its order of first appearance in raster order. That makes every id valid at any step. The assay world's step is 0.

### Standard fragment

Fragment f (0–63) of a source world, with assay seed σ:
- **Source pond:** drawn uniformly, with replacement, from the source's eligible ponds. It uses the weighted draw with equal weights and keys from `draw(cellBase((σ ^ POND_SALT) >>> 0, 0, f), 5 and 6)`.
- **Window:** a k×k window about a centre drawn by the packet rule, with keys `(σ, 0, f)` and purposes 3 and 4.
- **Landing:** at the fresh pond's centre, keeping its B, P, E and MOT.
- **No eligible ponds:** every fragment is absent and counts as a failure.

### Competence of a source world

The fraction of 64 standard fragments, one per pond, that meet the P1 success rule after one period. Rule: trait ≥ 0.25·ref and ≥ 4× the retained landed B+P.

### R1: pond-level heredity (standardised transmission)

- **Sample:** at two times, in every `scaf` and `rand` history: time 0 is the initial world, and time C is the pre-cycle world at the final boundary.
  - Donors are chosen once per history and time, with keys from `assaySeed(1, h, t, 0, 9)`, and reused by both replicates.
  - If at least 16 ponds are eligible, the donors are the 16 eligible ponds with the smallest purpose-1 key.
  - If 2–15 are eligible, every one is a donor.
  - If fewer than 2 are eligible, R1 is not demonstrated for that history.
- **Plant:** 64 fragments per replicate. Fragment f comes from donor number f mod (number of donors). Its window uses the packet rule within that donor, with keys `(σ, 0, f)`. Two replicates, s = 0–1, each one period.
- **Statistic:** the one-way ICC(1) of the end trait, with families = donors. Both replicates' fragments are pooled within their donor's family, so a donor is one family, never two.
  - The ICC is computed on residuals from an OLS of the end trait on log(1 + retained B+P) and log(1 + retained E), fitted over every fragment of that history and time. This reduces the dependence on copied mass and energy. It does not control copied composition, geometry or MOT. A demonstrated R1 therefore means heritable variation among donor ponds, genetic or structural. R2's standardised inoculum is the genome-only check.
  - **p-value:** from 1,000 permutations of the family labels over the pooled fragments. Fragments are ordered replicate 0's f = 0–63, then replicate 1's. Permutation p (0–999) is a Fisher–Yates shuffle: for i from N−1 down to 1, swap position i with j = `weightedPick(randomKey(σ8, p, i, 8), randomKey(σ8, p, i, 9), i+1)`, where σ8 = `assaySeed(1, h, t, 0, 8)`. p = (1 + #{permuted ICC ≥ observed ICC}) / 1001.
- **Pond-level heredity is demonstrated in an arm** if the ICC at C is above 0 with p < 0.05 in at least 4 of 6 histories.
- **Reported descriptively:** in-run donor-family repeatability, the same ICC on in-run recipients grouped by actual donor, with retained packet B+P as a covariate. The covariate is fitted by OLS of the next-boundary trait on log(1 + retained B+P) within each cycle, and the ICC is taken on the residuals. It is confounded by truncation and copied physical state, so it is never a decision input.
- **A failed R1 means "not demonstrated",** not "absent".

### R2: adaptation (common garden)

- **Inocula**, at times 0 and C for every `scaf` and `rand` history, from the same worlds as R1. The post-cycle checkpoints at ⌊C/3⌋ and ⌊2C/3⌋ are descriptive only.
  - **raw**: 64 standard fragments;
  - **standardised**: the dominant genome of each fragment (by B+P), planted as the standard disc (radius 10, biomass 64, energy 128).
- **Run:** one period, mutation off, s = 0–1.
- **Gain** of a history = mean end trait from time C's inoculum − mean end trait from time 0's, on the standardised inoculum.
- **Genome-level adaptation beyond the bottleneck is shown if both hold.** The standardised inoculum measures genomes, not transmission of a mixed collective.
  - `scaf` gain > 0 in at least 4 of 6 histories;
  - the median `scaf` gain is above the median `rand` gain.
- The raw inoculum is reported alongside.

### R3: removal (the result that counts)

- **Source worlds**, per history:
  - **(a)** the pre-cycle state at the final boundary;
  - **(b)** that state run 2×10⁵ further steps with no cycle and mutation on, seed `assaySeed(0, h, 1, 0, 0)`.
- **Ancestor source:** a clone world grown one period from the standard discs for (a), and that world run 2×10⁵ steps with no cycle, mutation on, for (b).
- **Competence:** of every source world, with s = 0–1, so 128 fragments.
- **Dominant genome:** the lineage with the largest trait mass (cells with B+P ≥ 48). Ties go to the smallest (hi, lo). A source with no eligible cell has no dominant genome, and that history cannot support R3.
- **Swap arms**, for each `scaf` history i, with F = standard fragments. These are the matched-inoculum control: the same physical fragments, with only the genome changed.
  - `Ge-on-Fa`: fragments from the ancestor source with every cell's genome words replaced by G_e, the history's dominant genome by B+P over cells with B+P ≥ 48 in source (a), under one fresh id;
  - `Ga-on-Fe`: fragments from the history's source (a) with genomes replaced by `M3_FOUNDERS[2]`, under one fresh id.
- **Advantage:** adv_i(X) = competence(`scaf`_i) − competence(X), where X is `rand`_i, `cont`_i (paired by i) or the ancestor, each at the same timing, (a) or (b).
- **Decisive if both hold:**
  - adv_i(X) > 0 for every X at both timings, in at least 4 of 6 histories i;
  - competence(`Ge-on-Fa`_i) − competence(ancestor) ≥ 0.5 · adv_i(ancestor) at timing (a), in at least 4 of 6 histories i.
- **Unmatched comparisons:** comparisons of `scaf` against `rand`, `cont` and the ancestor use fragments that differ in mass and E, so their retained B+P and E distributions are reported. The swap criterion is the matched test, which is why decisiveness requires it.
- **Quenched control:** repeated on `scaf` sources. If it exceeds 0.05, R3 is unreliable and cannot be decisive; the decision table then treats R3 as not decisive.

### R4: capability (descriptive)

- **Genomes:** the dominant genome of each history's source (a).
- **Evaluation:** `evaluateBatch` with `DEFAULT_EVAL`.
- **Reported:** quality, recovery and regeneration for `scaf`, `rand`, `cont` and the ancestor.
- **Limitation:** the ancestor is near the ceiling (regenerated 58 of 64), so R4 can show only a loss.

No readout selects on, or is replaced by, a held-out measure, a role or `compartmentalised`.

## Decision table (exhaustive; first matching row applies)

| Outcome | Disposition |
|---|---|
| P1 fails, fallback included | Stop. Report that no workable regime exists. Any new regime space needs a dated amendment. |
| P2 fails | Stop. The machinery does not see selection among ponds even on standing variation, which points to heredity. Recommend a heredity rule variant (genome retention in bodies) as a separate dated decision. |
| R1 not demonstrated in `scaf` | Same as P2 failing: pond-level heredity is not demonstrated under RULE_VERSION 1 even with an imposed bottleneck. |
| R1 demonstrated, R2 not shown | Heredity is present but no pond-level adaptation appeared within C cycles. Possible next step, by dated amendment: a longer run or more ponds. No integration. |
| R1 and R2 shown, R3 not decisive | **B:** integrate the cycle into the runner and lab (optional config keys, conditions, segment parity). Then a withdrawal ladder, re-testing R3 at each rung: longer periods, partial clearing, dispersal by migration packets only. |
| R1 and R2 shown, R3 decisive | **C:** integrate, then draft a registration for a confirmatory scaffolding ensemble (an M7 candidate). Any AWS draw is recorded by a dated note before paid runs. |

## Budget and compute

$0: Mac only through R4. An AWS draw needs a dated note in `docs/plan.md` after the pilots. It would come from the $200's margin, quantified against the earmarked $60 and $120, under the existing cost and stop rules.

## Amendment 1 — 2026-09-30: pilot results and the frozen main configuration

This amendment was written after P1, the R3 calibration and P2, and before any main run. Results are in `experiments/scaffold/p1.json`, `calibrate.json` and `p2.json`. The tools are at commit 319f8794.

- **P1: one regime passes.** k = 8 with period 10,000 passes in both seeds:
  - success fraction: 0.594 (s = 0) and 0.821 (s = 1);
  - mean ineligible fraction: 0.134 and 0.071;
  - mean CV: 0.84 and 0.47;
  - conservation exact.

  ref(10,000) = 103,058. The other eight regimes fail:
  - k = 3 goes extinct by cycle 2 at every period;
  - k = 5 at 10,000 fails because seed 0's mean ineligible fraction is 0.549, above 0.5 (seed 1 passes); at 1,000 and 3,000 it fails on regrowth;
  - k = 8 at 1,000 and 3,000 steps fails on regrowth.

  The fallback grid was not needed.
- **R3 calibration at k = 8, period 10,000.**
  - Ancestor competence is 0.859 and quenched competence is 0.000, on identical fragments (both pass).
  - The source world is the ancestor clone grown one period (seed 4,802,001).
  - **Correction to P1's calibration seeds.** The quenched set uses the ancestor set's streams (4,802,011 + s), not 4,802,021 + s. That is what the common-random-numbers rule under "Readouts (assay seeds)" requires. An earlier quenched set seeded 4,802,021 + s (also 0.000) was run before this was noticed. It is kept in `runs/`, but it is not a matched control and not a decision input.
  - **Headroom.** The ancestor's competence of 0.859 leaves at most 0.141 of headroom for R3's advantage over the ancestor.
- **P2 passes in both seeds.**
  - In `scaf`, the high-set share rose by +0.211 and +0.203. In `rand` it changed by −0.802 and −0.021.
  - Mean trait at boundary 20: `scaf` 83,125 and 83,293; `rand` 3,148 and 14,953.
  - High set: founders 2, 3, 5, 6, 9 and 11.
  - The ranking runs used the P1 period (one period of 10,000 steps).
  - **Descriptive only:** the `rand` arm drifted toward low-trait founders, and its productivity collapsed in one seed.
- **Frozen main configuration:** `experiments/scaffold/main-config-v1.json`. Its SHA-256 is recorded in `docs/plan.md`'s dated scaffolding draw note.
  - 64 ponds, the ancestor `M3_FOUNDERS[2]`;
  - k = 8, period 10,000, D = 16, C = 100 cycles (10⁶ steps), census every 100 steps;
  - default mutation rate;
  - arms `scaf`, `rand` and `cont`, 6 histories each, seeds 4,810,001 + 100·arm + i.
- **R3's ancestor source.** For timing (a) it is the calibration source world above (seed 4,802,001). For timing (b), that world is continued 2×10⁵ steps with no cycle and mutation on, at seed `assaySeed(0, 18, 1, 0, 0)`.
- **Where it runs.** The main run and the readout assays run on one AWS g5.xlarge with six lanes, under the dated draw note in `docs/plan.md`. The tools, seeds and outputs are the same as on the Mac.

## Results (2026-09-30)

The main run (seeds 4,810,001 + 100·arm + i) and the R1–R4 assays ran to the frozen configuration on AWS, with the tools at commit 319f8794.
- All 18 histories completed 100 cycles.
- Conservation was exact, and no truncation occurred anywhere.
- All 172 queued commands finished, and none failed.

The readouts and the decision table were applied as written. The outputs are in `experiments/scaffold/readouts/`: `r1.json` to `r4.json`, `decide.json` and `trajectories.json`. Every readout was re-derived independently from the raw files, by separate scripts, and no number was disputed.

**Matched row: 3, "R1 not demonstrated in `scaf`."** P1 and the calibration passed, and P2 passed in both seeds, so the first matching row is R1's. The disposition is the one for P2 failing:
- stop, with no integration;
- a heredity rule variant (genome retention in bodies) is recommended as a separate dated decision.

That decision is not taken here.

**The numbers each rule used.**
- **R1: not demonstrated.** The rule needs ICC > 0 with p < 0.05 at time C in at least 4 of 6 `scaf` histories.
  - `scaf` met it in 0 of 6. ICC ranged from −0.028 to 0.076, and the smallest p was 0.054 (i5).
  - Only 3 of 6 ICCs were positive at all.
- **R2: shown.** `scaf` standardised gain was positive in 6 of 6, from +35,021 to +37,547 (the rule needs at least 4). The median `scaf` gain, +36,684, beat the median `rand` gain, −61,826.
- **R3: decisive by its rule, but at the threshold.**
  - Advantage over `rand`, `cont` and the ancestor at both timings held in 5 of 6 histories. The failure was i4 against `rand`.
  - The swap criterion held in exactly 4 of 6, with margins of −3.5 to +3.5 fragments out of 128.
  - The quenched control was 0.000 in 12 of 12 sets.
  - `scaf` competence at timing (a) was 0.945–0.992, against `cont` 0.555–0.688 and the ancestor 0.820.
- **R4 (descriptive).** Mean regeneration out of 4: `scaf` 0.5, `rand` 1.33, `cont` 0.33, the ancestor 4. The side hypothesis, that the scaffold keeps capability that evolution without it loses, is not supported.

**Descriptive (not decision inputs).**
- Median mean pond trait from boundary 1 to 100:
  - `scaf` 102,589 → 136,940;
  - `rand` 102,465 → 30,977;
  - `cont` 102,689 → 130,104.
- Median extinct ponds at boundary 100: `scaf` 1.5, `rand` 4.5, `cont` 0.
- `rand` met R1's criterion at time C in 6 of 6 histories (ICC 0.164–0.936). At time 0, 1 of 12 sets passed, about chance.

**Post hoc (written after the result; not a decision input and not a change to the rule).** One plausible explanation of R1's non-result in `scaf` is a ceiling.
- At time C, 92.2–100% of `scaf` fragments ended at 80% or more of the assay budget, and donor-family means were compressed to 104,882–142,006. That may have left little between-donor variance for the covariate-adjusted ICC.
- The same assay found strong between-pond heritable variation in `rand` (6 of 6).
- P2, R2 and R3 each responded to selection among ponds.

These observations do not establish that selection depleted heritable variance, or that R1 missed heredity that exists. The result stays "not demonstrated", not "absent". Whether to follow the table's recommendation, or to test heredity with a design that avoids this possible confound, is a separate dated decision.

**Limitations.**
- A sandbox line: not registered, and not an entity result.
- One regime and 6 histories per arm.
- The ancestor sits near the competence ceiling.
- The assay regime is the same as the cycle regime.
- R3's swap pass sits on the threshold.
- R4 evaluates one genome per history.

## Amendment 2 — 2026-09-30: R1′, an amended heredity test (post hoc; made after the R1 result)

The user decided on 2026-09-30, after seeing R1's result, to amend R1. Because the amendment follows that result, everything below is exploratory. Its outcome changes only the recommendation (see "Disposition"). It cannot by itself move the line to integration (B) or registration (C). R1's own result and row 3 stand as recorded.

**What changes, and why.** R1 at time C may have been limited by a ceiling (Results, post hoc paragraph):
- in-run trait CV at boundary 100 was 0.01–0.26 in `scaf`;
- 92–100% of `scaf` assay fragments ended at 80% or more of the assay budget.

R1′ changes two things, the time and the trait. Everything else is R1 unchanged: donors, fragments, the assay world, the OLS covariates, the ICC, the permutation test and the 4-of-6 rule.

1. **Time.**
   - The primary time is boundary 34, the pre-cycle state there.
   - Secondary times, descriptive only, are boundaries 67 and 100.
   - Boundary 34 was chosen because it is the earliest state recoverable from a saved checkpoint (the post-cycle checkpoint at cycle 33), and because the in-run trait CV there is 0.35–0.62 in `scaf`. The CV is in-run pond-trait variation, already in the main run's records. No heredity outcome at boundary 34 or 67 has been computed or seen.
2. **Reconstructing the states.** The pre-cycle states at boundaries 34 and 67 are rebuilt with the frozen main-run code itself: the tools and protocol at commit d198ceb4, in a separate workspace at that commit.
   - **Replay.** Each history's run directory is copied with every checkpoint after cycle 33 (or 66) removed. Then `scaffold.ts evolve --resume --cycles 34` (or 67) runs with the history's own configuration, seed, mutation rate and 100-step census and drain cadence. That is the resume path shown byte-identical in the build gate, and it writes the pre-cycle checkpoint at the new final boundary.
   - **Per-history check.** Every one of the 64 rows the replay writes for cycle 34 (or 67) must equal the original `ponds.tsv` row byte for byte. A row includes the heat booked from the whole pre-cycle world, and the packet's lineage ids and dominant lineage. Trait equality alone is only a consistency check.
   - **Mechanism check.** Before any R1′ assay, one `scaf` history and one `rand` history (i = 0) are replayed from the cycle-50 checkpoint with `--cycles 66`. The resulting `b66-post` must equal the saved `b66-post` in `stateHash`.
   - **Validity.** A history-time is valid when the mechanism check has passed, its own rows match, and its R1′ assay and analysis complete. Otherwise it is technically unavailable.
   - Boundary 100 uses the existing `b100-pre` checkpoint.
3. **Trait.** A fragment's trait is its pond trait at step τ of the assay period, instead of at the end. τ is an observation time calibrated on the ancestor, meant to reduce ceiling effects; it does not guarantee that evolved fragments are unsaturated. It is fixed before any R1′ assay, by a calibration on the ancestor only:
   - **Calibration run.** The competence assay on the R3 ancestor source (seed 4,802,001 world), k = 8, two replicates, seeds 4,849,001 + s. The trait is recorded at every census (every 100 steps).
   - **τ** is the first census step at which the median trait of the 128 ancestor fragments is at least 0.25 · ref = 25,764.5.
   - If no census reaches it, τ = 10,000, and R1′'s trait is R1's end trait.
   - τ is recorded in the result before any R1′ assay is analysed.
4. **Seeds.** These come from a new block that does not overlap `assaySeed` (whose maximum is 4,844,690): 4,845,001 + 250·h + 100·t′ + s.
   - h = 6·arm + i, with arm 0 for `scaf` and 1 for `rand`, so h runs 0–11.
   - t′ = 0 for boundary 34, 1 for boundary 67 and 2 for boundary 100.
   - s = 0–1 are the replicates, s = 8 the permutation stream and s = 9 the donor selection.

   The block's maximum is 4,847,960. The τ calibration uses 4,849,001–4,849,002. The replays use each history's main-run seed, with no new randomness.

**Rule.** Availability is evaluated first:
- If fewer than 4 `scaf` histories are valid at boundary 34, R1′ is uninformative.
- Otherwise, pond-level heredity is demonstrated in an arm (R1′) if, at boundary 34, the ICC of the trait at τ is above 0 with p < 0.05 in at least 4 of 6 histories.
- A valid history with fewer than 2 eligible donors is a biological outcome. As in R1, it counts as not demonstrated.
- A technically unavailable history also counts as not demonstrated.

The rule is applied to `scaf` and reported for both `scaf` and `rand`.

**Reported descriptively:**
- the same statistic at boundaries 67 and 100;
- the end-of-period trait at all three times;
- each set's between-donor variance:
  - the one-way ANOVA between-family variance component (MS_between − MS_within)/n₀ on the OLS-adjusted trait, with replicates pooled and negative estimates reported as they are;
  - the variance of the raw family means;
  - both at τ and at the end of the period;
- saturation: the share of fragments at 80% or more of the assay budget at τ and at the end. It is reported only, and never used to retune τ.

**Disposition (replaces only row 3's recommendation).**
- **R1′ demonstrated in `scaf`.** Row 3's recommendation, a heredity rule variant, is withdrawn. The new recommendation is to replicate on fresh histories: a new main run with fresh seeds and with R1′ fixed in advance as the primary heredity readout. Only that replication can reach rows B or C.
- **R1′ not demonstrated in `scaf`.** Row 3 and its recommendation stand, now resting on two designs.
- **Fewer than 4 `scaf` histories valid at boundary 34.** R1′ is reported as uninformative, and row 3 stands.

**Compute.** About 1.2 × 10⁶ 512² steps: 24 one-period replays, 36 transmission assays of two periods each, and the τ calibration. It runs on the Mac at $0.
