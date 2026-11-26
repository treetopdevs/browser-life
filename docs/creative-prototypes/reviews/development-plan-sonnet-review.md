I've read the plan and the prior-art clock and Caddy patterns, and I'm now writing up the review. It is returned here because my tools can't write files, so `development-plan-sonnet-review.md` is untouched. I did not call the advisor tool, since you ruled out recursive reviewer calls.

# Plan review: `development-plan.md` (Sonnet 5.5 High, read-only)

Line numbers refer to the plan. I checked `apps/lab/src/worlds.ts:269` and `:463-497` (own-shape/own-cell entries), `boundaries/comparison-clock.ts` and `deploy/Caddyfile:13`. I did not open `Dockerfile.site`, because its matching line was omitted as too long.

No energy-ledger or overflow problem: the ledger closes by construction, and all values stay far below 2^31. Add one sentence of bounds:
- Food sum ≤ 368,640.
- Stores ≤ 48 × 160 = 7,680.
- Structure ≤ 1,536 × 4 = 6,144.
- Cumulative counters must pass `Number.isSafeInteger`.

A unit-test pin: the initial ledger is 9216 × 20 + 12 × (24 + 4) = 184,656.

## Blockers

Two implementers could build different worlds from the current text, or the evidence would not reproduce.

**B1. Loop shape (L15).** The text doesn't say whether the loop runs steps 3→4→5 per organism, or runs each step across all organisms before the next.
- **What differs:** which tiles bodies compete for, and whether the cap check at step 5 sees deaths from later IDs.
- **Fix:** state "one loop over starting IDs ascending; each runs 3, then 4, then 5." That matches the "append newborns after all starting parents" wording. Add a unit fixture where a low-ID parent and a high-ID dying body interact.

**B2. Tick numbering and pending births (L15, L19).**
- **Tick numbering:** "supply if tick%5==0" doesn't say whether `tick` is read before or after the increment. Say "increment tick, then supply if tick%5==0", or the reverse.
- **Pending births:** state that at placement the child gets the next monotonic ID, its root tile is marked occupied, and it counts toward the cap. It is appended to the live list after the loop and neither feeds nor grows that tick. IDs are never reused. This is the only way the "pending children occupy tiles and count" contract is testable.

**B3. Geometry is not pinned (L17, L25).** `developmentDirections` and `wrappedNeighbor` are hand-check seams, but these are undefined:
- the heading-to-vector map;
- the sign of left/right and of `turn = +1`;
- tile index (suggest `y*96+x`, with 0=+x, 1=+y, 2=−x, 3=−y, left = (f+3)%4, right = (f+1)%4);
- the attempt order (suggest [forward, left, right]);
- that an attempt tests only its own target tile;
- that the root is `depth === 0`, so the branch rule is `depth === 0 || depth % branchEvery === 0`.

Mirror-image implementations would both "pass" otherwise.

**B4. RNG protocol (L11, L19).** Specify all of these:
- The primitive, for example `floor(mulberry32() * n)`.
- Whether birth placement draws lazily, stopping at the first empty tile, or always draws 16 (dx, dy) pairs. It must be lazy or fixed, and the draw order must be dx, dy, then heading after acceptance.
- The founder permutation algorithm (Fisher–Yates direction) and when founder headings are drawn. A suggested order is permutation first, then 12 headings, with family `i%3` over the permuted sites.
- The mutation stream: the literal xor constant, and a fixed three draws per attempt (probability, field, sign) even when the field is clamped.
- That `blockedCapBirth` is counted only after the age, size and store conditions pass (L5 versus L19).

**B5. Upkeep failure accounting (L15, L21).** The current text allows two readings. Pick one: "if store < upkeep, `dissipated += store`, store = 0, die, `deathLoss = 4*cells`". The residual is zero either way, but the counters, and so the evidence, differ.

**B6. The fixture seam (L25) is deferred to review, so I'm defining it here.**
- **Export:** `createDevelopmentFixture(spec)` from a separate module (`fixture.ts`) that stays out of the viewer chunk.
- **Spec:** `{seed, mutation, tick?, food: number | Uint8Array, nextId, organisms: [{id, parentID, family, generation, age, store, births, genome, cells: [{tile, heading, depth}], queue, cursor}]}`.
- **Validation:** unique tiles; connectivity; depth and heading consistent with parent links; `genome` through `validateGenome`; at most 3 queue entries per cell, each referencing an existing cell with a direction in 0..3; cursor ≤ queue length; store ≤ 160; food 0..40; caps.
- **Ledger and RNG:** it recomputes the initial ledger from the supplied state, and it starts fresh RNG streams from `seed`.
- **Assay founder:** the one-founder, food-40 assay founder is built through the same root-queue code the production constructor uses. The fixture should not hand over a queue for that case.

**B7. Lineage truncation and live parents (L27).**
- **Never drop living records:** never drop a record for a living organism.
- **Live parents:** a live organism keeps its own `parentID`, and the viewer reads it from the organism, not the lineage record. When the parent's record is dropped, show `parent record dropped`, from an explicit flag rather than a missing key.
- **Record schema:** the plan doesn't give one, but the UI needs it. Suggested fields: `{id, parentID, family, generation, birthTick, genome, mutation: {field, from, to} | null, deathTick | null, cause | null}`. The dead-selected message and the births list rest on `deathTick`, `cause` and `mutation`.
- **Cap arithmetic:** say whether founders count toward the 10,000.
- **Reachability:** births could exceed 10,000 under headless `step(100000)`, because a 16-cell genome can give birth at age 80. At 6000 UI ticks the births stay below 10,000 (≤3,600 even at the 0.6 births/tick ceiling).

**B8. Extinction and frozen worlds (L27, L31).** Define `step()` after extinction as a no-op: the tick freezes and no supply runs. This is the same as `advanceBoundaryComparison`, which skips extinct worlds while the shared tick continues, so reuse it. "Frozen world ticks distinguished" can then mean the panel shows its own extinction tick against the shared clock. State also that history records ticks 0, every 20, and extinction exactly once.

## Should fix (cheap, prevents ambiguity)

- **S1. History records (L27).**
  - Mark counters as cumulative, so dropped history loses nothing.
  - Store integer sums (`totalCells`, `totalEnergy`) instead of means.
  - Compute the ledger residual from a fresh sum of food and living bodies, not from incremental counters, so it can't be tautological.
- **S2. Assay arithmetic (L37).**
  - **First birth tick:** cells ≤ 1 + floor(age/6), which is 14 at age 80. So with a threshold of 18 the first possible birth is age 160, and by tick 240 there are two chances, at 160 and 240. Record the first-birth tick and the cell trajectory.
  - **Growth hand trace:** my partial trace of the bushy program (L11) reaches 12 cells with no queue exhaustion, so the geometry looks viable.
  - **Amendments:** L37 says "no altered coefficients" and also allows "program amendment". Say that an amended preset must re-pass the assay before the batch and be recorded in the batch settings.
- **S3. Genome validation (L25).**
  - Check with property descriptors, a plain-prototype test and `Object.isFrozen`.
  - Normalise `-0` to `0`.
  - Fix the canonical tuple order as [turnEvery, turn, branchEvery, maxCells].
- **S4. Selection and preview.**
  - **Occupancy and selection:** the occupancy copy holds organism IDs, and selection is per panel by ID.
  - **Preview:** the growth preview (L33) should come from a model export that runs the real growth routine on a scratch grid, with a test that it matches the fixture's growth.
- **S5. UI clock (L31).**
  - **Pace:** "1x/2x" conflicts with "max 4 ticks/frame". Define a tick rate with an accumulator, clamped to ≤ 4 per frame, and no catch-up burst after the tab is hidden.
  - **Tick cap:** the viewer enforces the 6000 cap by clamping `min(n, 6000 − tick)`. The model has no cap, and its `step` limit of 100000 (L25) stays.
  - **Seed field:** accept digits only, 0..2^32−1.
- **S6. Export (L31).** One JSON file with both panels and a schema version. Measure the serialized byte length against 8 MiB and refuse the download rather than truncate.
- **S7. Packaging (L33).**
  - Mirror the boundaries matcher: `(?i)^/development(?:/|$)`, a separate `respond 404`, placed before the public routes.
  - Add a test that the `development-*` removal glob catches the chunk and nothing public.

## Optional polish, no scope change

- **Strong built-in pressure toward `maxCells = 16`.** A 16-cell genome needs 12 cells and can give birth at age 80, where a 24-cell genome waits until age 160. With mutation on, expect bodies to shrink. By my arithmetic, starvation should also be rare, because each tile yields 0.2 per tick against at most 0.125 per cell upkeep (a one-cell body pays 1). Most deaths would then come at age 600, in synchronised cohorts. This fits the plan's existing "static mature bodies" and no-adaptation wording (L39), so report it and don't tune.
- **Neutral genome variants.** `turnEvery` has no effect when `turn` is 0, so the variant count mixes neutral and shape-changing genomes. Label it as such.

## Coordination resolutions

The review completed successfully and was captured externally into this file; its opening statement that the output file is untouched refers only to the reviewer's own read-only tools.

The parent selected immediate pending-child occupancy reservation with deferred newborn processing. A deliberately narrower fixture seam will accept validated copied one-cell founders, food arrays, age and store, using production root-queue construction; arbitrary resumable body queues are unnecessary. All three supplied programs will use the same assay origin and heading, achieve at least 18 cells and a birth by tick 240, and compare normalized footprints at age 144 to establish whether their supplied genes actually produce distinct shapes.

A fully specified mutation draw protocol is necessary, but exactly three draws on every birth is not: probability first, with field/sign only on an attempted mutation, is also deterministic if documented. Digits-only seed syntax, replacing means with sums, and a separate executable preview API are optional choices rather than correctness gates. The fixture need not validate nonexistent parent-cell links or broaden into a resume format.
