# I01 behaviour atlas and stepping stones: plan (2026-11-01)

Status: **exploratory, observer-only.** No physics change, `RULE_VERSION` and every golden pin untouched, no model
calls, no paid compute, local GPU only. Brief: `BRIEF.md` (same folder). Source: the I01 card of
`docs/simulation-research-2026-11-01/report.md` (main checkout, not yet on main).

This slice delivers the report's Phase A artefact, **archive manifest and descriptor calibration**, plus the
stepping-stone ledger. It does not run the four-arm comparison and builds no embedding arm.

## What is built (in the brief's order)

1. **Evidence fixture first** (`packages/search/src/descriptors.ts`, `packages/search/test/descriptors.test.ts`,
   `tools/atlas.ts fixture` -> `fixture-evidence.json`). Synthetic per-census tile sequences with known descriptor
   values and negative cases that fool the naive version of each descriptor. Written and passing before any real
   genome is described.
2. **CPU path and opt-in adapter.** Descriptors accumulate online from the census readbacks `evaluateBatch` already
   makes (no extra GPU reads) behind `EvalConfig.atlas`, absent from `DEFAULT_EVAL`, so every historical evaluation
   is byte-identical. `Archive` gets an opt-in descriptor-cell function beside the unchanged mass/speed
   `ArchiveSpec` (`DEFAULT_ARCHIVE`).
3. **Stepping stones.** Optional proposal ancestry on `Archive.offer` and on each `viable.jsonl` line, and a
   ledger method over the existing viable array. No second store. Old `archive.json` / `viable.jsonl` load and
   replay identically (script `tools/atlas.ts replay-check`, result in `replay-check.json`).
4. **Capability tests fixed in writing** (section below), before any descriptor archive runs.
5. **Qualification and calibration.** Instrumented-vs-plain twin on the GPU, then descriptor calibration on
   existing genomes. Simulator evaluations and wall time are reported separately.

## The descriptors (definitions fixed here)

Both read **raw cell state**, not tracker output, so they stay valid when component identity is ambiguous
(merging, splitting, fragments below `minMass`, speckle). Per replicate tile, per census, over the cells of that
tile (tile side T = 64, torus within the tile, as the existing `speed` already treats it):

- A cell is **occupied** when its bound mass B + P >= `OCC_MIN` = 48 (the tracker's cell threshold). Not
  `Census.labels`, which drops fragments under 256 mass and so depends on identity bookkeeping.
- **Window.** The last 1,000 growth steps: censuses at steps >= `growSteps - 1000` (11 frames, 10 intervals with
  `censusEvery` 100 and `growSteps` 3000). Fixed so the establishment transient is excluded.

**D1, centre-of-mass displacement (cells per 100 steps).** Mass-weighted circular mean per axis over occupied
cells: angle = atan2(sum m sin, sum m cos), position = angle T / 2 pi; resultant length R = hypot / sum m. A frame
is *COM-defined* when both axes have R >= 0.25 (a mass spread evenly around the torus has no centre). Per interval
the displacement is the minimal wrapped vector between the two frames' centres. **D1 = |sum of interval vectors|
divided by the window steps, times 100**: the *net* transport of the tile's mass. A tile is D1-defined only when
every frame in the window is COM-defined. The path-length version (sum of |interval vector|) is stored as
`comPath` for audit and is the naive comparator; it is not an archive axis.
Known blind spots, kept as documented fixtures: two bodies separating symmetrically leave the tile's COM still
(net transport, not motion); an out-and-back body has net 0. Per-body speed stays the existing `speed` axis.

**D2, temporal occupancy persistence (0..1).** Mean over the window's consecutive census pairs of the Jaccard
index |A_t and A_t+1| / |A_t or A_t+1| of the occupied masks; pairs with an empty union are skipped; a tile is
D2-defined when at least one pair counts. Static = 1, fully turned-over = 0. The naive "occupied fraction is
constant" cannot tell a static pattern from an alternating checkerboard; Jaccard can.

**Candidate value** = the lower median over the candidate's D-defined replicate tiles, defined when at least
half the replicates are defined. A candidate with an undefined descriptor is still a viable offer (kept as a
stepping stone, ledgered, linked into lineages and passers) but has **no atlas cell** and is counted separately
(`undefinedFrac`). `cellOf` under the atlas spec throws on an evaluation that lacks the descriptor fields; it never
bins NaN or a missing value to 0.

**Bins.** 8 x 8, linear, clamped like the existing archive. Ranges are not guessed: they are set once, by the rule
below, from the calibration set, and then frozen in `ATLAS_V1` before any descriptor archive is searched.

## Archive adapter, ancestry and ledger

- `Archive` takes an optional fourth constructor argument, a descriptor-cell function. Default unchanged
  (`cellOf` as today). The atlas spec is recorded in `archive.json` `search.archive` only when non-default, as
  `score`/`gate` already are, and `searchedWith` is extended so `--resume` and `--confirm-only` replay under the
  searched archive; a flag that disagrees is listed in `ignored`. Replaying under the wrong spec would yield a
  different archive silently, so this is tested.
- `offer(genome, eval, born, prov?)` takes optional provenance `{ op, parent?, seed?, count? }`: `op` one of
  `generalist | random | generalist-mutant | mutant`, `parent` the viable index of the parent elite (null for
  fresh), `seed`/`count` the arguments of `mutateGenome`/`randomGenome` that produced it. A `mutant`'s genome is
  checked to equal `mutateGenome(parent.genome, seed, count)` in tests. `prov` is ignored by cells, passers and
  lineages. `tools/bootstrap.ts` records it for every new viable offer, in every archive mode.
- **Limit, stated plainly:** non-viable proposals (quality <= 0) are not logged today and still are not, so
  ancestry covers *accepted viable* candidates only. Their count is `evaluated - viableCount`.
- `Archive.ledger()` reports, for every viable offer in order: index, batch, genome key, quality, atlas cell (or
  null), `inserted` (took or replaced a cell), `displaced` (index it replaced), `passer`, `duplicate` (genome key
  seen earlier), `prov`. It is derived on replay, so it cannot disagree with the archive.
- Old lines have no `prov`: they decode to `undefined` and replay identically.

## Fixed before computing (2026-11-01)

Written before any real genome was described by D1/D2 and before any descriptor archive or capability test ran.

### Descriptor calibration (this slice, GPU, labelled calibration, not confirmation)

- **Set A.** 160 genomes from `runs/bootstrap-200/viable.jsonl`: distinct genome keys in file order, every k-th
  with k = floor(n_distinct / 160), first 160. Re-evaluated under `DEFAULT_EVAL` + `atlas`, seed 3000001 + batch.
  Also the 47 `archive.json` elites, as a stepping-stone audit (three more batches).
- **Set B.** The first 32 of set A again, seed 3000101 + batch, for replicate stability.
- **Plain twin.** The first batch of set A with `atlas` off, same seed: every pre-existing field of every
  `Evaluation` must be identical.
- **Range rule** (percentile = nearest rank, sorted[ceil(p n) - 1]; over set A's defined values). D1 range = [0, ceil-to-0.25 of the 95th percentile of defined D1]. D2 range = [floor-to-0.05 of
  the 5th percentile of defined D2, 1]. 8 bins each.
- **Verdict per descriptor**, all reported, none tuned after reading:
  - *usable* if defined for >= 80% of set A, and the 160 candidates occupy >= 12 of 64 cells under the final
    ranges, and the Spearman correlation between set A and set B values is >= 0.5;
  - *mostly-undefined* if defined for < 80%; *noisy* if the A/B correlation < 0.5; *sparse* if the pair occupies
    < 12 cells (a property of the pair, reported as `pair`, not a per-descriptor verdict);
  - *redundant* if |Spearman| >= 0.9 against its nearest existing axis (D1 against `speed`, D2 against
    log2 `meanMass`). Correlations of each descriptor against `speed`, log2 `meanMass` and `quality`, and the number of jointly defined
    A/B pairs, are reported in any case. The range rule's degenerate guards (D1 upper bound >= 0.25, D2 lower bound
    <= 0.95) only keep a range non-empty.
- A calibration that returns anything but "usable" for both descriptors stops here: the report says so and the
  descriptor archive is not built on it.

### Held-out capability tests (frozen for the later comparison slice; **not run in this slice**)

No selector (quality, gate, either archive axis) sees these, and they use environments and seeds the search never
used. They do reuse the growth outcomes `survived` and `mass`, which `quality` also reads: they are **transfer
tests of survival in shifted environments**, not a new measured quantity, and are described that way. A genome
selected for survival in the standard environment may pass them without any archive-specific advantage, which is
why the comparison includes random viable sampling as an arm. `experiments/endpoints.ts` observables stay excluded.

Each test evaluates a genome in `side 8, tile 64, reps 16` (4 genomes per batch), `growSteps 3000`,
`recoverSteps 500`, `darkSteps 500` (the arms are unused; only growth outcomes `survived` and `mass` count),
seed range 4000001+ (4000001 + 100 x test + batch). Test configs, as patches on `DEFAULT_EVAL`:

| id | capability | patch (selector value in brackets) |
|---|---|---|
| H0 | control: the standard environment | none |
| H1 | establishing from a small inoculum on a lean medium | `nutrient 16` [32], `biomass 32` [64] |
| H2 | persisting under dim light | `lightBase 20` [40], `lightAmp 80` [160] |
| H3 | persisting under patchy light | `lightMode "patches"` [uniform], `lightBase 20` [40], `lightAmp 160` |

A genome **passes** H1-H3 when `survived >= 12` of 16 and its mean bound mass is >= 0.5 of its own H0 mass on
H0's seeds. H0 is a within-genome denominator, not a capability.

- **Primary endpoint** per archive: the number of distinct genetic clusters (`geneticClusters`, `CLUSTER_DISTANCE`)
  among the arm's evaluated members that pass **all three** of H1-H3. Secondary: per-test pass counts, cluster
  counts per test, duplicate-genotype rate, archive retention, extinction (tiles dead).
- **Unit of replication**: an independent search history (own search seed), not an archive member. >= 5 histories
  per arm, equal simulator-evaluation budgets, the same starting candidate pool, arms: random viable sampling,
  the existing mass/speed archive, the physical-descriptor archive. Embedding arm: deferred (needs the user's
  decision, render/cadence/encoder frozen first, with recolour/repeat/static/noise controls).
- **Members evaluated per history**: up to 64: stratified by archive cell for the two archives, uniform over
  viable offers for random viable; ties by lower viable index.
- **Decision rule**: advance only if the physical archive's primary endpoint exceeds both other arms in >= 4 of 5
  paired histories and its median exceeds the mass/speed arm's by >= 2 clusters. Otherwise it ships as a
  discovery gallery, and nothing is claimed beyond breadth of descriptor cells. A rise in occupied cells without a
  rise in the primary endpoint is *visual breadth, not capability*.
- **Seed ledger** (disjoint by construction, asserted in a test): search 1..300 (bootstrap-200) and any new
  history seeds from 5000001 up in steps of 10000; confirmation 1000001..1000210 (bootstrap-200); calibration
  3000001..3000199; held-out 4000001..4999999.
- Sensitivity of the held-out tests is not yet known; if H0-normalised pass rates over the *existing* archive's
  genomes are 0% or 100% the test is *measurement-limited* and is reported as such, not tuned on outcomes.

## Evidence classes

CPU-only: fixture, descriptor maths, adapter, ancestry, ledger, replay-identity on the real `bootstrap-200` log.
Local GPU: plain-twin qualification and descriptor calibration. Not run: golden GPU suite (no shared dynamics
touched; run once anyway as a guard if cheap), hosted/physical-GPU, held-out tests, any arm comparison.

## Out of scope

Embedding arm; four-arm comparison; any model call; the held-out tests; new physics; lab or coordinator changes.

## Results (2026-11-01), recorded against the rules above

Files here: `fixture-evidence.json`, `replay-check-bootstrap-200.json`, `calibration.json`,
`manifest-bootstrap-200.json`, `manifest-atlas-smoke.json`, `replay-check-atlas-smoke.json` (replay checks also
compare passer membership with gate.json). Raw rows:
`runs/atlas-calibration/rows.jsonl` in the worktree (gitignored).

**Fixture (CPU).** All 14 constructed histories give their known values. The negative cases do what they were
built for: out-and-back reads path-length COM 1.000 (a steady mover to the naive metric) against net D1 0.000;
a flickering static body reads path 0.577, net 0.000; an alternating checkerboard and a static one have the same
occupied fraction (0.5) but D2 0 against 1; speckle noise and a sliding texture have no centre of mass (D1
undefined) and D2 0.140 and 0.600; a recoloured (mass x7) and a translated copy of a trajectory give D1 and D2
identical to the original. Known blind spot kept as a fixture: two bodies separating symmetrically give D1 0.

**Replay compatibility (CPU).** `runs/bootstrap-200` (1,990 viable lines, no `prov`) replays under the changed
code to the archive.json that the old code wrote: 47 elites and 62 lineages identical, counts equal. Its ledger:
1,990 viable offers, 77 ever inserted, 30 displaced, 47 current elites, 839 passers, so 1,943 viable candidates
are stepping stones that no cell holds today; 2,810 non-viable proposals are counted, not logged. `bootstrap-m3`
and `bootstrap-r50` have no `viable.jsonl` (legacy) and cannot be replayed exactly; they are not used.

**Plain twin (GPU).** The first calibration batch (16 genomes x 4 tiles, seed 3000001) with `atlas` off is
identical to the same batch with it on in every pre-existing `Evaluation` field.

**Calibration (GPU), set A of 160 genomes, set B of 32, 47 elites.**

| | D1 centre-of-mass displacement | D2 occupancy persistence |
|---|---|---|
| defined | 55 / 160 (34%) | 160 / 160 |
| set A vs set B Spearman (jointly defined pairs) | 0.62 (12 pairs) | 0.99 (32 pairs) |
| vs `speed` | 0.63 | **-0.80** |
| vs log2 `meanMass` | -0.10 | -0.15 |
| vs `quality` | -0.11 | -0.16 |
| verdict | **mostly-undefined** | usable |

D2 tracks per-body `speed` strongly (-0.80) without reaching the 0.9 redundancy line; that is a warning for any
future two-axis use, not a verdict. Rule-derived ranges: D1 [0, 1.75], D2 [0, 1]. The 160 candidates occupy 12 joint atlas cells (22 mass/speed cells
for the same candidates); D1 and D2 correlate -0.80 where both exist. D1 is undefined in every replicate for 91 of
the 160 candidates, almost all of them alive (157 of 160 survived all four replicates): their bound mass spreads
evenly enough round the 64-cell torus tile after 3,000 steps that its circular mean has resultant length under
0.25. D2 is defined everywhere and stable but a fifth-percentile persistence of 0 sets its lower bound to 0, so
its binning has a wide empty band. The 47 elites re-described: 11 have both descriptors, in 8 atlas cells.

**Decision under the stated rule.** Calibration is not "usable" for both descriptors, so **no descriptor archive
is built on it**: `ATLAS_V1` records its rule-derived ranges and `calibration: failed`, and `tools/bootstrap.ts
--archive atlas-v1` refuses to search unless `--uncalibrated-smoke` is passed. D1 was not rescued after reading the
data (no threshold change, no resampling). The held-out tests were not run, and the four-arm comparison was not
started. A replacement D1 (for example a registration-based shift of the occupancy pattern, defined for spread
mass) would be a dated amendment with its own fixtures and a fresh calibration on new seeds (3000200..3000399 are
reserved for it); D2 alone cannot make a two-axis atlas.

**Tool smoke (GPU, not a pilot).** `--archive atlas-v1 --uncalibrated-smoke`, 3 batches (stop after 2, `--resume`
to 3), `--confirm-reps 0`, seed 5000001..5000003 (these three history seeds are spent). It exercised search,
ancestry recording, atlas-cell placement, resume and the ledger: 48 evaluated, 30 viable (all with `prov`), 22 with
no atlas cell (D1 undefined again), 3 in cells. It says nothing about the atlas as an archive.

**Cost.** Calibration: 16 batches, 255 genome evaluations (1,020 tile replicates), 765 s of evaluation wall time,
47.8 s/batch, under a machine load average above 300 (bootstrap-200 logged about 22 s/batch unloaded), so the
timing is an upper bound. The smoke: 3 batches, 48 evaluations, about 156 s.
