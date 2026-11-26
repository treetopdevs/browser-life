# Assembly-inspired construction grammar (I07, ASSEMBLY_VERSION 1)

Frozen before any calibration object is scored. Changes after the freeze commit go in a dated amendment file marked `outcomeExposed`, never an edit here. This is an *observer with a stated grammar*, explicitly assembly-inspired. It is not the published assembly index (different primitives, a 2D lattice, no chemistry, a target-fragment restriction). Every number it produces is called a **construction length under this grammar**.

## 1. Substrate and primitives

- A patch is a `w x h` torus of small integers. A cell is occupied iff `value >= tau`. Primary `tau = 1`; `tau in {1, 2, 4}` appears only in the sensitivity grid on clips. The amount of matter is ignored by the grammar (shape only); mass is matched at the fixture level.
- **Primitive:** the monomer, one occupied cell. Monomers are free and always available.
- **Object:** a finite set of occupied cells connected under the connectivity rule of section 2, stored as integer offsets from its min corner (min x and min y set to 0).

## 2. Segmentation (object boundaries)

- Primary: **4-connectivity** on occupied cells on the torus. Variant: **8-connectivity**. Both are in the frozen sensitivity grid; the primary is never chosen after seeing scores.
- Components are found by BFS from the row-major-first unvisited occupied cell. Each cell carries a *lifted* coordinate (the BFS path unrolled across seams). A neighbour reached at a different lift than it already has means the component wraps the torus: it is flagged `spans`, excluded from class tallies, and counted. A shape that sits across a seam is therefore the same class as the same shape in the interior.
- An object with more than `objMaxN` (40) cells is flagged `large`. On calibration patches a large object is scored by the bound only and counted. On movies a large object is counted and not classed or scored (budget).

## 3. Joining and construction length

- **Join.** Given two pool members A and B (A may equal B; reuse is free once built), place B at an integer offset relative to A so that the cells are disjoint and the union is connected under the connectivity rule. The union is a new pool member. Each join costs 1.
- **Restriction (stated, not hidden).** Every intermediate must be a connected sub-object of the target (up to the equivalence group). This is the usual "fragments of the target" restriction and makes the search finite.
- **Construction length `a(O)`:** the minimum number of joins to build O from monomers. Trivial bounds `ceil(log2 n) <= a <= n - 1`. A monomer has `a = 0`.
- **Exact search.** For `n <= exactMaxN` (10) iterative deepening over the number of distinct classes built, over connected sub-masks of the target; each class needs one split into two connected parts whose classes are already built; node counts are deterministic (fixed enumeration order). If `exactNodeBudget` is exhausted the status degrades to `bound`.
- **Bounded search (larger objects).** A beam search (width `beamW` 8, `maxCand` 10 children per expansion, `boundNodeCap` 20000 nodes) over partial construction DAGs. Candidates are copy-aware splits (a known pattern placed inside the object so that the remainder is connected) and prefix sweeps in six fixed cell orders. **Certificate rule:** a reported `bound` is always the join count of a *completed* construction DAG (every target cell reached, every join valid); a partial path is never reported. On exhaustion the monomer chain (`n - 1`) is the fallback. An independent validator re-checks every DAG in tests. A `bound` is an upper bound, never an exact index.
- **Beam details (frozen).** The state is the set of expanded classes (each with its chosen split) and the set of pending classes. Each step expands the largest pending class (ties: smallest key). Its candidate splits are (a) copy-aware: every known pattern (expanded, pending, or in the free pool) of 2 to n-1 cells placed at every alignment inside the object so that the pattern lies wholly inside and the remainder is connected; (b) prefix sweeps: for each of six cell orders (row-major, column-major, and the reverse of each, and BFS from the first and from the last cell in row-major order) the prefixes of every length 1..n-1 when n <= 16, otherwise lengths {1, floor(n/2), ceil(n/2), n-1}, kept when both parts are connected. Candidates are deduplicated by the unordered pair of part keys, ranked by (number of parts not already built or pending, ascending; larger part size, ascending; the concatenated part keys, ascending) and the best `maxCand` are kept. Children are ranked by (classes built plus pending, then total pending cells, then a state key built from the sorted class keys), the best `beamW` survive. The search stops when the top-ranked state has nothing pending (classes built plus pending never decreases, so it is then the beam optimum), or when `boundNodeCap` children have been created (then the chain fallback).
- **Exact search with a free pool.** Classes already built elsewhere in the patch cost nothing and may be used anywhere; the iteration over the cost bound starts at 1 whenever a free pool is supplied.
- **Caching.** A standalone answer is cached by `(connectivity, group T, canonical shape)`; solves that depend on a free pool (the shared bound) are never cached.
- **Solve order in a regeneration.** Classes in the order of the PROTOCOL.md table (the eleven calibration classes, then the two seam classes), replicates ascending, 4-connectivity then 8-connectivity; then the nine I14 movies; then the clips. One shared node counter.
- **`sharedBound`** (patch level, a **cost**; lower means more reuse): the join count of a completed construction DAG that builds every non-`spans`, non-`large` object of the patch with pool members shared across targets (each pool member a connected sub-object of at least one target). Distinct classes are built in descending size order (ties by key); classes already in the pool cost nothing. Always an upper bound (status `bound`).
- **Total node limit.** One counter spans all readout solves in a regeneration (`totalNodeLimit`). If it were reached, later solves would return the monomer chain flagged `limited`. Motif selection (fixture generation) is outside the counter.

## 4. Equivalence and copy identity

- Primary group **T** (translation only): two objects are copies iff their normalised sorted cell lists are equal. Variant group **D4** (translation plus the 8 dihedral images): the canonical form is the lexicographically least normalised list over the 8 images (compared by length, then numerically). Reflection is in D4 and flagged: chirality is a real distinction on a lattice.
- Cell code `y * 1024 + x`. A class key is the comma-joined canonical list.
- Primary reading uses T. The **equivalence-class uncertainty** is the spread (max - min) of the class count across T, D4 and D4-on-8-connectivity segmentation.

## 5. Readouts (always separate, never blended)

For a patch (or a pooled movie):

1. **Construction length.** Per class `a` with status `exact | bound`. Patch summaries: `sumA` (over objects, copies included), `maxA`, `meanA = sumA / objects` (rational), `reuseRatio = sum a / sum (n - 1)` over non-`spans` objects with `n >= 2` (rational; the ratio of sums), and `sharedBound`.
2. **Copy count.** Per group (T, D4): number of classes, classes with copies >= 2, `maxCopies`, `copyExcess = sum (copies - 1)`, `copyWeightedConstruction = sum over classes with copies >= 2 of a_class * (copies_class - 1)` (the naive metric under test), and copy pairs `sum C(copies, 2)`.
3. **Persistence** (movies only; static patches are `n/a`, not 1): over lag `dt` frames, `sum_t |C_t intersect C_(t+dt)| / sum_t |C_t|` as an exact rational, `C_t` the set of T classes present at frame t, taken over all t with t+dt in range. Lag is distinct from sampling stride: stride subsamples the movie first.
4. **Equivalence-class uncertainty** as in section 4.
5. **Baselines** (independent columns): occupied cell count, deflate length of the bit-packed patch (fflate level 6; the version is recorded), object count, mean object size (rational), max class multiplicity.
6. **Incremental value.** For a class pair, the exact order-accuracy of each readout and of each baseline over all replicate pairs, as an integer rational `(2 wins + ties) / (2 pairs)` (ties count one half). "Adds value over baselines" means the readout orders pairs where the best baseline (scored in whichever direction suits it best, the conservative bar) does not. This is a discrimination statement on a fixed fixture set, not a predictive model.

**Frozen directions.** `sharedBound` and `reuseRatio` are costs; the declared direction for the hierarchical positive is **lower**. `copyWeightedConstruction` (a naive "more assembled" score) has declared direction **higher**. `meanA` and `maxCopies` are declared **not directional** at matched size and multiplicity (tied by design); they are reported and cannot separate.

**Undefined values.** A monomer has no `reuseRatio`; a patch whose eligible set is empty gives `null`, and the readout verdict is `measurement-limited`, never pass or fail.

## 6. What is deliberately not here

No physics change, no GPU, no destruction or reconstruction interventions (a later rung, recorded as not done), no claim about life at any outcome, no optimisation of the metric.
