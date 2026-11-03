# I07b protocol: destruction and reconstruction (frozen before any score-namespace row is produced)

Pairs with `PLAN.md` (sections 0 and 5b are binding) and the first rung's `docs/assembly-observer-2026-11-02/GRAMMAR.md`, reused unchanged by hash (grammar version 1, `ASSEMBLY_VERSION` untouched). Everything numeric lives in the fenced JSON block at the end; `packages/metrics/test/assembly-destruction.test.ts` checks that it deep-equals `packages/metrics/src/assembly/destruction/protocol.ts`. This file is never edited after the freeze commit; a change needs a dated `amendment-N` file. Observer only: CPU, no GPU, no physics change, no model calls.

## 1. Question

Take objects the frozen grammar scores as constructed (hier-12 and controls), destroy them, run a regrowth process, and ask whether the same object class (identical canonical key under translation) returns. The property tested is **recipe-dependent reconstruction**: the class is rebuilt after total destruction from information held outside the patch. It is not heredity: this assay has no transmission step, so heritable transmission is untestable here and is not claimed. A stored image and a stored program are indistinguishable to the classifier (the stored-image renderer is a positive by design, labelled so). No life-detection claim is made at any outcome.

## 2. Patches (init stream) and the four patch kinds

64 x 64 torus, exactly `M = 240` occupied cells (asserted). Objects sit on a slot lattice visited in a seeded Fisher-Yates shuffle (same recipe as the first rung's `slots`), so no two objects touch under 8-connectivity.

| kind | original | pitch | target key |
|---|---|---|---|
| `hier` | 20 x `COMPOSITE_12` | 8 | key of `COMPOSITE_12` |
| `dup12` | 20 copies of one connected 12-cell polyomino from a plain K=1 `growShape` draw (box 7, no scoring, no selection) | 8 | its key |
| `crystal` | 15 x `SQUARE_4X4` | 5 | key of `SQUARE_4X4` |
| `scatter` | 240 isolated monomers (no two touch under 8-connectivity) | n/a | the monomer key `0` |

## 3. Processes

Eight processes, 16 replicates each. Truth label (declared by construction, not measured): `recipe-dependent` = {`builder-hier12`, `stored-image-renderer`}; every other process is not recipe-dependent. Regrowth runs for 8 rounds, at most 2 objects per round, objects placed at free sites that overlap nothing and touch nothing under 8-connectivity on the torus, until adding another object would exceed `M` (residual mass is recorded, may be nonzero, and is a reported outcome). Surviving fragments are swept (removed, recorded as `sweptMass`) at the start of regrowth so only whole objects remain.

- `builder-hier12` (patch `hier`): a program store held outside the patch rebuilds `hier-12` by its program (`I3`, join with a copy shifted (1,0), join with a copy shifted (2,1)). Ablation arm `nostore`: the store is deleted at the damage step; the process is idle.
- `stored-image-renderer` (patch `hier`): a bitmap store holding the `COMPOSITE_12` cells; it pastes the image. Has its own `nostore` arm. Positive for C1 by design.
- `wrong-store-builder` (patch `hier`): store replaced by a different program (last shift (2,0), a solid 4 x 3 block, a different 12-cell class); activity preserved; rebuilds the wrong class. Has its own `nostore` arm.
- `template-hier12` (patch `hier`) and `template-dup12` (patch `dup12`): new objects are copies of PRNG-chosen surviving whole objects (information lives in the objects). With no survivors nothing is built.
- `fresh-random-dup12` (patch `dup12`): regrowth draws a new connected 12-cell polyomino from the regrow stream (K=1, no scoring, separate from the initial motif) and copies it. Whether the key collides with the original, and the level result, are recorded, not forced.
- `accretion-crystal` (patch `crystal`): passive edge accretion. With surviving 4 x 4 squares, new squares go to free lattice sites (pitch 5) next to existing squares. With none, one 2 x 2 nucleus is placed by the process PRNG (stated information source: the process itself, not the patch) and gains a row and column each round (2, 3, 4), then accretes squares. It has no store arm: C1 is false for it by definition (a documented `n/a`).
- `inert-scatter` (patch `scatter`): random monomers at free sites. Occupancy floor.

Three PRNG streams, all `rnd` from `predictability/movie.ts`: `init` (original patch), `damage` (disc centre, scramble), `regrow` (regrowth). Processes sharing a patch kind share the original patch and the lesion (paired); an ablation arm shares its parent's regrow stream. `regrow()` receives (process, store, seed, surviving whole objects); it never receives the pre-damage patch or the reference key.

## 4. Damage operators (synthetic occupancy deletion, PLAN R10)

Loosely modelled on the disc geometry of `applyLesion`, not a mirror of it: no B/P to C conversion, no heat, no motion or lineage reset, no radius clamp. Removed mass is recorded, no hidden mass.

- `lesion-partial`: disc removal, torus Euclidean `dx^2 + dy^2 <= r^2`, radius `lesionRadius`, centred on a cell of a PRNG-chosen object (so it always hits). Cells in the disc are removed (`removedMass`); surviving cells of hit objects are fragments (`sweptMass`); objects with no cell in the disc survive whole.
- `lesion-total`: every object of the target class is removed (here: the whole patch).
- `scramble`: occupancy-matched spatial randomisation of the whole patch (same 240 cells, each at a PRNG-chosen free cell).

Mass identity, tested exactly: `occupiedFinal = M - removedMass - sweptMass + regrownMass`, with `regrownMass` counted per regrowth operation (a nucleus growth step counts the cells it adds).

## 5. Readouts (kept separate; integers and exact rationals)

Counts `n0` (copies of the target key before damage), `n1` (right after damage, fragments present), `n2` (after the last round) come from segmentation (first rung `segment`, `tau = 1`, spanning objects excluded).

- `identityReturn = (n2 - n1) / (n0 - n1)`, clamped to [0, 1]. Defined only if `n0 >= minCopies` and `n1 < n0`; a survival-only outcome (`n1 = n2`) is 0; an undefined value rejects the run.
- `persistence`: the target key count at each of the last 3 rounds is at least `ceil(n0 / 2)`.
- `levelReturn`: with `cwBefore` the first rung's copy-weighted construction of the original patch and `cwAfter` that of the regrown patch (key ignored): true iff `4 * cwAfter >= 3 * cwBefore` (it does not fall more than 25 percent; the tolerance is read as a lower bound, as a naive level observer would). Undefined (null, counted false, never true) when `cwBefore = 0` or the final occupied mass is below `3/4 M`.
- `highAssembly(patch)`: the patch's shared construction DAG holds at least 2 distinct non-monomer keys, and its copy-weighted construction is at least 1/2 of the pre-damage hier-12 reference (the copy-weighted construction of the original `hier` patch, replicate 0). A level gate only. The crystal is expected to pass it: these readouts alone do not exclude the crystal as "high".
- Equivalence and segmentation variants: every count and label is recomputed at 8-connectivity (`c8`) and with D4 equivalence at 4-connectivity (`d4`: objects equal to the target up to rotation and reflection count as copies; the D4 label uses the translation `nostore` identity); a process label that differs from the primary (`c4`) is published as `segmentation-dominated`.

## 6. Classifiers and the decision rule

Per-replicate binary predictions of "recipe-dependent reconstruction" (accuracy = exact integer correct / total):

- C1: after `lesion-total`, `identityReturn >= 1/2` and `persistence`, and the paired `nostore` replicate has identity 0. A process with no store arm: C1 false.
- C2 (naive level classifier): `levelReturn` true after `lesion-partial`.
- C3 (occupancy return): final mass after `lesion-total` within one object of `M` (the process's object size).

Tables: **base** (6 processes: the five negatives and `builder-hier12`; 96 rows) and **extended** (all 8; 128 rows). Process aggregation label, precedence in this order, over all 16 replicates: `reconstructs` (C1 and `highAssembly` after total destruction in every replicate); `reappears-by-templating-only` (identity at least 1/2 after partial and exactly 0 after total in every replicate); `level-only` (`levelReturn` true and identity 0 after partial in every replicate); `absent` otherwise.

Scramble organisation control (hier and crystal patches): for `sharedBound` and `reuseRatio` (cost readouts, lower is the hierarchical direction), the post-scramble value must be strictly higher than the pre-damage value in at least `scrambleMin` of 16 replicates, counted exactly; a scramble patch with fewer than 2 non-monomer DAG keys is undefined and counted as moved. A failing kind gives `measurementLimited` for that kind's process rows only. Class loss after scramble (target copies) is measured, not forced. Not applicable to `inert-scatter`. The `dup12` patches are reported descriptively (the criterion is only stated for hier and crystal).

Missing rows, zero denominators or an incomplete replicate set reject the run.

## 7. Declared expectation (measured, never asserted by tests)

C1 correct on the base rows; C2 counts the templating processes, `wrong-store-builder` and `fresh-random-dup12` as positive; `accretion-crystal` passes the level gate and is separated only by C1's no-store-arm rule (its identity may return after total destruction through nucleation: a possible surprise, reported as measured); C3 reported as measured (after total destruction, 16 objects of 12 cells cannot restore 240, so C3 is false for every process: it is an analytical base-rate control, not a result: 80/96 base and 96/128 extended). A flipped outcome is a surprise to report. If C2 is right everywhere the result is "the second rung adds nothing over naive return" and is published as such. Nothing is tuned after scoring; any change is a dated amendment.

## 8. Freeze and scoring discipline

Seed namespaces: `dev` (tests, implementation-bug fixing, dry runs through `--write-dev`) and `score` (never used before the freeze commit). A test fails if they intersect. `tools/assembly/destruction.ts --write --freeze <sha>` refuses unless `<sha>` is a 40-hex ancestor of HEAD whose tree holds only the freeze files (no outcome) and the sha256 of `PROTOCOL.md`, `FREEZE.json` and every pinned source (this assay's decision path and the reused first-rung sources and `GRAMMAR.md`) matches `FREEZE.json`. After the freeze only evidence, `EVIDENCE.md`, `REVIEW.md`, pages and tests change; anything else is a dated amendment.

## 8b. Deviations from PLAN.md and declared interpretations (stated before scoring)

- `levelReturn` is one-sided (`4 * cwAfter >= 3 * cwBefore`), not the plan's two-sided "within 25 percent": a naive observer asking "did high construction come back" reads a floor, so overshoot is not a miss.
- The hier-12 reference copy-weighted construction is computed by this assay from its own `hier` replicate 0, not read from the first rung's `evidence.json`; the two coincide by construction (same `COMPOSITE_12`, same solver, same copy count).
- Lesion centres are seeded PRNG draws from the damage stream (a cell of a PRNG-chosen object), not a listed table of constants.
- `highAssembly` reads "at least 2 distinct non-monomer keys" from the shared construction DAG (targets and sub-objects), because a hier-12 patch holds a single class and would never have two keys otherwise.
- C3 cannot be true for any 12-cell-object process after total destruction by construction: 2 objects x 8 rounds = 16 objects = 192 cells, 48 short of 240, and one object is 12. Its accuracy there is a base rate, not a result. (For the crystal 11 squares at most, for monomers 16.)
- The crystal scramble control may fail by the stated rule: a one-class crystal patch has `sharedBound` 4 and a scrambled 240-cell field can have a cheaper shared bound (for example only a dimer and a tromino). A failure is declared here as a possible `measurement-limited` outcome for the crystal rows and is reported, not repaired (R7: per-row, not a global stop). Scatter is not applicable; dup12 is descriptive.
- `inert-scatter` identity is computed against the monomer key; it is expected below 1/2 because 16 monomers cannot replace the ~90 to 240 lost.
- Truth labels classify the aggregation label too: the second table (8 processes) includes the two controls; the first table (6 processes) is the plan's base set.

## 9. Constants

```json
{
  "destructionVersion": 1,
  "patch": {
    "w": 64,
    "h": 64,
    "mass": 240
  },
  "replicates": 16,
  "rounds": 8,
  "objectsPerRound": 2,
  "lesionRadius": 22,
  "levelKeepNum": 3,
  "levelKeepDen": 4,
  "identityNum": 1,
  "identityDen": 2,
  "minCopies": 8,
  "persistenceRounds": 3,
  "occupancyFloorNum": 3,
  "occupancyFloorDen": 4,
  "highMinKeys": 2,
  "highRefNum": 1,
  "highRefDen": 2,
  "scrambleMin": 14,
  "motifBox": 7,
  "pitch": {
    "object": 8,
    "crystal": 5,
    "monomer": 1
  },
  "crystalSeedSide": 2,
  "conns": [
    4,
    8
  ],
  "seeds": {
    "dev": {
      "init": 220094189,
      "damage": 232040165,
      "regrow": 226386081
    },
    "score": {
      "init": 1544428055,
      "damage": 1544399969,
      "regrow": 1544022368
    }
  },
  "processes": [
    "builder-hier12",
    "template-hier12",
    "template-dup12",
    "fresh-random-dup12",
    "accretion-crystal",
    "inert-scatter",
    "stored-image-renderer",
    "wrong-store-builder"
  ],
  "storeProcesses": [
    "builder-hier12",
    "stored-image-renderer",
    "wrong-store-builder"
  ],
  "recipeDependentTruth": [
    "builder-hier12",
    "stored-image-renderer"
  ],
  "baseProcesses": [
    "builder-hier12",
    "template-hier12",
    "template-dup12",
    "fresh-random-dup12",
    "accretion-crystal",
    "inert-scatter"
  ],
  "damage": [
    "lesion-partial",
    "lesion-total",
    "scramble"
  ]
}
```
