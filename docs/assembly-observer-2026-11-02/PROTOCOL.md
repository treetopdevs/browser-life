# I07 protocol (frozen before any calibration object or clip is scored)

Pairs with `GRAMMAR.md`. Everything numeric lives in the fenced JSON block at the end; `tools/test/assembly-evidence.test.ts` checks that it deep-equals `packages/metrics/src/assembly/protocol.ts`. Any change after the freeze commit needs a dated amendment file marked `outcomeExposed`; this file is never edited afterwards.

## 1. Question

Using the pre-stated assembly-inspired grammar, do construction length bound, copy count and persistence (each read separately) tell manually assembled hierarchies apart from random fields and from random fields with duplicated random motifs, at matched occupied mass and resolution; and how much do those readings move under segmentation and temporal-sampling choices? No life-detection claim is made at any outcome. No evolving-world clip is a positive case.

## 2. Calibration patches

Every synthetic patch is a `64 x 64` torus with exactly `M = 240` occupied cells (asserted per replicate; padding is zero for every class and recorded). Objects sit on a slot grid, each object placed with its min corner at a slot origin, slots visited in a seeded Fisher-Yates shuffle that depends only on `(placeSeed, replicate)` and the grid pitch (so classes sharing a pitch share placements). A slot pitch of `bbox + 1` guarantees that no two objects touch under 8-connectivity (so 4 and 8 segmentation agree on spaced patches). `R = 16` replicates per class, replicate index `0..15`. PRNG: `rnd(seed, a, b)` from `packages/metrics/src/predictability/movie.ts` (counter-based integer; no `Math.random`).

Random shape: `growShape(n, box, seed)` starts at the centre of a `box x box` square and repeatedly adds a cell drawn uniformly (index `rnd(seed, step, 0xf0) mod frontier size`) from the row-major-sorted list of unoccupied 4-neighbours inside the box.

Motif selection: `candidates` (256) shapes are grown with seeds `rnd(rnd(motifSeed, tag, replicate), k, cand)` for `cand = 0..255`; the shape with the highest `a` is kept (exact for 10 cells, beam bound for 12), ties broken by the lexicographically smallest canonical key; keys already used in the same patch are skipped. The chosen `a` and status are recorded per replicate.

Hand-built programs (cell coordinates `(x, y)`, y downward):

- `I3` (vertical tromino): (0,0) (0,1) (0,2).
- `BLOCK_2X3`: two `I3` side by side: x in {0,1}, y in {0,1,2}.
- `COMPOSITE_12`: two `BLOCK_2X3`, the second shifted by (2,1): cells x in {0,1} y in {0,1,2} plus x in {2,3} y in {1,2,3}. 12 cells, bounding box 4 x 4. Nested reuse: monomer, domino, `I3`, `BLOCK_2X3`, composite.
- `COMPOSITE_24`: two `COMPOSITE_12`, the second shifted by (4,0). 24 cells, 8 x 4. Four levels.
- `TILE_MOTIF`: rows `###`, `#..`, `##.`.
- `SQUARE_4X4`, `CRYSTAL_BLOCK` (12 wide, 20 tall): solid.
The solver computes and records `a` for each hand-built motif; no `a` is asserted by hand.

| id | construction | pitch | role |
|---|---|---|---|
| `tile-repeat` | `TILE_MOTIF` x 40 | 4 x 4 | repeated tile |
| `crystal-lattice` | one `CRYSTAL_BLOCK` at offset `(rnd(crystalSeed, r, 1) mod 52, rnd(crystalSeed, r, 2) mod 44)`; never crosses a seam (seam handling is tested separately) | n/a | deterministic crystal, one `large` object, bound only |
| `crystal-spaced` | `SQUARE_4X4` x 15 | 5 x 5 | crystal of copies |
| `random-field` | 40 pairwise-distinct (translation) random 6-cell shapes, box 7 | 8 x 8 | random, matched mass |
| `random-dup` | **key negative**: 4 distinct selected 10-cell motifs x 6 copies | 8 x 8 | duplicated random motifs |
| `random-dup-hi` | one selected 10-cell motif x 24 | 8 x 8 | extreme duplication |
| `random-dup-12` | one selected 12-cell motif x 20 | 8 x 8 | size-matched negative |
| `hier-12` | `COMPOSITE_12` x 20 | 8 x 8 | **primary positive** |
| `hierarchy` | `COMPOSITE_24` x 10 | 9 x 5 | secondary; sizes differ from the negatives, cannot carry the verdict |
| `hierarchy-mixed` | `BLOCK_2X3` x 10 and `COMPOSITE_12` x 15 | 8 x 8 | hierarchy at two scales |
| `random-scatter` | 240 isolated random cells, no two touching under 8-connectivity | n/a | occupancy floor |
| `seam-hier-12` / `seam-dup-12` | the `hier-12` / `random-dup-12` motif in 10 pairs; the second copy at the smallest Chebyshev-radius offset (then dy, then dx) giving diagonal contact with no edge contact and no overlap | max(pair bbox + 1, 12) | segmentation-sensitive control: 4-connectivity sees 20 objects, 8-connectivity sees 10 |

**Exact generation recipes.** Slot shuffle: slots are listed row-major, then Fisher-Yates for `i = len-1 .. 1` with `j = rnd(placeSeed, replicate, 0x5107 + i) mod (i + 1)`, swapping `i` and `j`; object `i` goes to slot `i`. Motif seed for candidate `cand`: `rnd(rnd(motifSeed, tag, replicate), k, cand)` with tag 21 and `k` the motif index for `random-dup`, tag 31 for `random-dup-hi`, tag 41 for `random-dup-12` and for `seam-dup-12` (the same motif as `random-dup-12` of that replicate). `random-field` shape `attempt`: seed `rnd(rnd(motifSeed, 11, replicate), attempt, 0xfe1d)`, attempts 0.. in order, a shape whose translation class was already taken is skipped, cap 4000 attempts (an error, never a retry). `random-scatter`: attempt `a` draws `x = rnd(scatterSeed, r, 2a) mod 64`, `y = rnd(scatterSeed, r, 2a+1) mod 64` and keeps the cell iff no cell in its 3 x 3 torus neighbourhood is occupied; cap 200000 attempts. `random-dup` copies of motif `k` take shuffled slots `6k .. 6k+5`. `hierarchy-mixed`: the 10 blocks take shuffled slots 0..9, the 15 composites slots 10..24. Seam pairs: slot pitch `max(pair bounding box + 1, 12)` on both axes; the first copy sits at the slot origin shifted by `(max(0,-dx), max(0,-dy))`, the second at that point plus `(dx, dy)`.

**Failure policy (frozen).** Every 10-cell motif candidate must be solved exactly within `exactNodeBudget`, otherwise generation aborts with an error (no fallback, no retry). A selected 10-cell `random-dup` motif with `a < floorA10` aborts generation. An abort is a protocol failure to be reported, not a reason to change a constant silently.

The `random-dup` floor: `a >= floorA10` (6) for every selected 10-cell motif. The plan's floor of 7 is not met by every selection (a benchmark with throwaway seeds reached 7 for about a third of selections and 6 otherwise); 6 is the frozen floor and the chosen `a` is recorded.

**Matching.** `hier-12` and `random-dup-12` have the same object size (12), object count (20), copy multiplicity (20) and placement. They are the only pair that may carry a `separates` verdict. Every other pair is descriptive; size and count differences are stated in the evidence.

## 3. Reused fixtures and clips

- Nine I14 movies imported unchanged (`packages/metrics/src/predictability/fixtures.ts`): `life-block`, `life-blinker`, `life-pulsar`, `life-glider`, `life-gliders-dup`, `life-soup-early`, `random-bits`, `random-static`, `blobs-diffuse`. Mass is not matched; they are labelled `unmatched` and cannot enter the separation rule. Segmentation: `{4, 8}` at `tau = 1`.
- Three sim-ref clips by the I14 recipe (`presetConfig`, `RefSim`, channel B, shift 5, cap 15), presets `spots`, `gradient`, `seasons`, seed 1, `32 x 32` override, 96 frames, run stride 4. Segmentation grid `{4, 8} x tau {1, 2, 4}`. A lazy frame iterator over `RefSim` is used; the movie is never held whole; its sha256 is incremental over the I14 `movieBytes` format. Dense worlds may be one giant object at `tau = 1`; that is reported as "objects not defined" (`spans` or `large`) and counts as a sensitivity finding.
- Movies score: object count per frame, share of cells in `large` and in `spans` objects, class counts (T, D4), `maxCopies`, `copyExcess`, persistence at lags {1, 2, 4}, and exact construction length for classes with `n <= 10` (objects with more cells are counted, not scored). Temporal sampling: stride {1, 2, 4, 8} frames, each its own observer fed from the same pass.
- Clip rule (all at stride 1, whole run pooled over the 96 frames, for each of the six `{4, 8} x tau` variants): `objectsPerFrame` = non-`spans` objects in all frames / 96 (large objects included); `largeOrSpansCellShare` = (cells in `large` objects + cells in `spans` objects, summed over frames) / (occupied cells summed over frames), `null` when no cell is ever occupied; `classesT` = number of distinct T classes over the run among non-`spans`, non-`large` objects (monomers included). A variant whose value is `null` is left out. A clip is `segmentation-dominated` iff for any of the three quantities the largest variant value is positive and either the smallest is zero or the largest is at least `segmentationFactor` (2) times the smallest. Persistence classes are the T classes of non-`spans`, non-`large` objects of every size, monomers included. No clip is a positive case; nothing is scored to select anything.

## 4. Decision rule

Readouts R: `meanA` (patch mean per object), `sharedBound`, `reuseRatio`, `maxCopies`, `copyWeightedConstruction`. Declared directions as in `GRAMMAR.md` section 5.

Branch precedence (frozen), applied per readout:

1. `measurement-limited`: any score needed is undefined (an empty eligible set gives `null`).
2. `not directional`: `meanA` and `maxCopies`. These are excluded on purpose, not because size matching forces a tie: `meanA` could differ between a nested composite and a random shape of the same size, but a smaller mean cost per object is not a declared life-like direction, and `maxCopies` is tied by construction (20 against 20). Both are reported with accuracy in both directions.
3. Global duplicated-motif veto (disclosed, evaluated once on the primary patches, not per grid cell): if any of `random-dup`, `random-dup-hi`, `random-dup-12` is not ordered strictly worse than **every** `hier-12` replicate on R in R's declared direction (accuracy exactly 1 against each), then the duplicated random motif scores as strongly as the weakest hierarchy replicate and the verdict is `fails to separate`.
4. Otherwise a grid cell separates iff, over all `R x R` replicate pairs of `hier-12` against `random-dup-12`, R is ordered in its declared direction in every pair (accuracy exactly 1; ties are not separation). The identical predicate is used in all four grid cells: spaced patches at 4-connectivity (primary), the same spaced patches at 8-connectivity (identical to the primary by construction since no objects touch; reported and verified by object-count equality, not counted as independent evidence), `seam-hier-12` against `seam-dup-12` at 4-connectivity, and the same at 8-connectivity.
   - no cell separates: `fails to separate`;
   - some but not all: `segmentation-dominated` (published as a sensitivity failure, no boundary is changed to rescue the treatment);
   - all separate: compared with baselines. `separates, adds value over simple baselines` iff the readout accuracy (1) exceeds the best baseline accuracy (each baseline tried in both directions) on the same primary pairs; otherwise `separates, but not beyond baselines`.

For every `fails to separate` the report states in those words that **no life-detection claim is made** from R. `random-field`, `hierarchy`, `hierarchy-mixed`, the crystals and the tile are reported descriptively and never enter a verdict.

Sampling sensitivity applies to movies only; static verdicts carry `n/a` for sampling, never `stable`.

Declared before running (so surprises are visible): the naive `copyWeightedConstruction` is expected to fail on the duplicated-motif classes (high `a`, many copies); `maxCopies` cannot separate at matched multiplicity; `reuseRatio` and `sharedBound` may separate; none of this is tunable after the fact. Passing the hand-built hierarchy shows the readout tracks that construction, not that nature does.

## 5. Sensitivity extras

- Boundary perturbation: for replicate 0 of every class, the patch is dilated (an unoccupied cell with an occupied 8-neighbour becomes occupied) or eroded (an occupied cell with an unoccupied 4-neighbour becomes empty) once, then re-segmented at 4-connectivity; object count, class count and `maxCopies` before and after are reported. Mass is not preserved by design.
- Equivalence: T, D4 and D4 on 8-connectivity class counts per class.

## 6. Streaming and cost

One frame in memory at a time; the sampler's own `retainedFrames()` counter reports at most one; only the class tally and a ring of the last `max(lags)` class sets are carried. Nothing reads a run bundle or `lineages.tsv`. Standalone exact and bound solves are cached by `(connectivity, group T, canonical shape)`; solves given a free pool are not cached. Regeneration is expected under 10 minutes on a loaded machine; budgets (nodes), not wall-clock, bound the search, so the payload is deterministic.

## 7. Evidence

`evidence.json` (deterministic payload only, sealed), `manifest.json` (hashes, freeze commit, non-replayed provenance). `node tools/assembly/observer.ts --write | --check | --replay-check`. Statements recorded verbatim: CPU only; no GPU evidence; no score here selected anything; destruction/reconstruction interventions: not done (later rung); no evolving-world positive case.

## 8. Deviations from PLAN.md, with reasons

- Motif box 7 and slot pitch 8 (plan: box 5, pitch 6): a benchmark with throwaway seeds showed the plan's box produces compact shapes that top out at `a = 6`; 12-cell copies at pitch 8 still fit 64 slots (20 needed).
- Floor `a >= 6` (plan: 7): see above.
- `hier-12` is built from I-trominoes, not L-trominoes: two identically oriented L-trominoes cannot tile a 2 x 3 block under translation, so the plan's program was not a translation-only construction.
- `reuseRatio` is the ratio of sums, `sum a / sum (n-1)` over non-`spans` objects with `n >= 2`, so it stays an exact rational.
- Movies score exact construction length only for classes with `2 <= n <= 10`; larger objects are counted, not scored (a 50% random field has thousands of distinct mid-sized classes and the beam search would not fit the time budget).
- The duplicated-motif requirement is a global veto (finding 2 of the freeze review) rather than part of one grid cell.
- Fixture generation and solver algorithms are the files pinned below. The freeze commit holds only the two documents, so these hashes pin the code that will be committed afterwards; the evidence test compares them with the files on disk.

## 9. Constants

```json
{
  "assemblyVersion": 1,
  "patch": {
    "w": 64,
    "h": 64,
    "mass": 240
  },
  "replicates": 16,
  "tau": 1,
  "tauGrid": [
    1,
    2,
    4
  ],
  "connPrimary": 4,
  "connGrid": [
    4,
    8
  ],
  "objMaxN": 40,
  "exactMaxN": 10,
  "exactNodeBudget": 2000000,
  "boundNodeCap": 20000,
  "beamW": 8,
  "maxCand": 10,
  "totalNodeLimit": 100000000,
  "motif": {
    "box": 7,
    "pitch": 8,
    "candidates": 256,
    "floorA10": 6,
    "randomFieldN": 6,
    "dupN": 10,
    "dupCopies": 6,
    "dupMotifs": 4,
    "hiCopies": 24,
    "matchedN": 12,
    "matchedCopies": 20
  },
  "seeds": {
    "motif": 437018349,
    "place": 9546981,
    "scatter": 97155045,
    "crystal": 205608865
  },
  "persistenceLags": [
    1,
    2,
    4
  ],
  "strides": [
    1,
    2,
    4,
    8
  ],
  "segmentationFactor": 2,
  "clips": {
    "presets": [
      "spots",
      "gradient",
      "seasons"
    ],
    "seed": 1,
    "side": 32,
    "frames": 96,
    "stride": 4,
    "channel": "B",
    "shift": 5,
    "cap": 15
  },
  "movieFixtures": [
    "life-block",
    "life-blinker",
    "life-pulsar",
    "life-glider",
    "life-gliders-dup",
    "life-soup-early",
    "random-bits",
    "random-static",
    "blobs-diffuse"
  ]
}
```

## 10. Pinned source files (sha256 at the freeze)

These files define the computation and the fixtures. `tools/test/assembly-evidence.test.ts` compares them with the files on disk; a legitimate later change needs a dated amendment file marked `outcomeExposed`.

| file | sha256 |
|---|---|
| `packages/metrics/src/assembly/version.ts` | `c3b3d16f73da096fcf94457fa4c3a32766c5312e9f52f0a8c3c8279d4152b1ff` |
| `packages/metrics/src/assembly/protocol.ts` | `46318fb63c796ff465f6fc263c2f7a06c71384194a384da604cd7d65ff31072f` |
| `packages/metrics/src/assembly/grammar.ts` | `968e87914caebee221cbe86c30fe1738e116eead8660f0d104935a6b3cdc48b6` |
| `packages/metrics/src/assembly/segment.ts` | `11fc12d1015e3eeac46a8b4aebd01aafef837e15318cff160e86d891e9c679b8` |
| `packages/metrics/src/assembly/exact.ts` | `a78a42a609037ba5675aded821a33a6697a56e716c9d6daad0aa1ae0fd030a6e` |
| `packages/metrics/src/assembly/bound.ts` | `35860395d9efa5a4e593ba641c334c914be0b5ef6036734fb973e56d7b926546` |
| `packages/metrics/src/assembly/fixtures.ts` | `cdb1e6da128180d4ae98ea7510050a82a6ef81ed840cdcb58e3f39d8f7cdaba6` |
