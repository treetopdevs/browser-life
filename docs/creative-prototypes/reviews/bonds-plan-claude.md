**Reviewer:** Sonnet 5.5 (`claude-sonnet-5-5`), high effort, read-only. I read only the files you listed and ran nothing.

**Verdict:** No architectural blockers. Wrapping the base world, keeping the kernel untouched, and treating bonds as supplied steering is sound. The torus and ordering math holds up against `model.ts`. Fixing the four must-fix items (M1–M4) removes the remaining ambiguities, and none of them touches the kernel. After that, no blocking issues remain.

## Must-fix plan edits

**M1. Bond formation is ambiguous (Medium).**
- Source: `bonds-plan.md` Architecture, mechanics paragraph (~L7), "form same-family bonds from unbonded pairs".
- Failure mode: "unbonded pairs" can be read as "particles with degree 0". Chains and meshes could then never grow past pairs, and two implementers would get different graphs.
- Resolution: define the candidate set as same-family pairs with no existing edge between them and both degrees below the cap. Process the candidates greedily in (distance, lowId, highId) order, re-checking degrees as each edge is accepted.
- Also state:
  - Compare squared distances, with inclusive `≤ 0.06` to form and strict `> 0.12` to break, in both the mechanic and the summary.
  - `bornTick` is the base tick whose step first applies the edge. Without this, edge age is off by one between code and tests.
  - Formation runs before the impulses, so a new edge pushes in the same tick.

**M2. The "narrow world factory" contract is unspecified (Medium).**
- Source: `environment-page.ts:63,73-75` (`ParticleWorld[]`, `new ParticleWorld`), `comparison-clock.ts:4`, `model.ts:173`.
- Failure mode 1: `advanceComparison` and the page are typed on `ParticleWorld`. A composition wrapper won't typecheck unless both are widened.
- Failure mode 2: the base reassigns `this.particles = survivors.concat(newborns)` every tick (`model.ts:173`). If `BondedWorld` copies `particles` at construction, the page, the clock's extinction check and the renderer all read a stale array. The first symptom would be "extinction never detected".
- Resolution: add a structural type, for example `Pick<ParticleWorld, 'particles'|'food'|'history'|'environment'|'tick'|'step'|'census'|'snapshot'>`. Widen the type only, with no behavior change. Make `BondedWorld.particles` a getter that reads `base.particles`. State that `step()` delegates to a per-tick loop. The per-tick bond maintenance can't be skipped by calling `base.step(n)` once, and `step(n)` must equal n × `step(1)`.
- The page also needs optional hooks for per-card extra metrics and for an overlay drawn between the food and the particles. The card HTML at `environment-page.ts:80` is hardcoded.
- Existing pages must produce identical export JSON. Say so in the plan.

**M3. "Persist or churn", "coalesce" and "shapes differ" have no pre-stated definitions (Medium).**
- Source: Evidence and stops (~L15).
- Failure mode: three seeds and a visual judgement can be argued either way after the fact. This matters most for your "don't relabel lumps as organisms" rule.
- Resolution: before running, fix a small set of descriptive labels, with no statistics required.
  - Per sample, record:
    - isolated fraction
    - groups of size ≥2
    - largest group
    - mean degree
    - median edge age
    - formed/broken per 100 ticks
    - mean lifetime of removed edges, by cause (stretch vs death)
  - Define "persist" as median edge age ≥ N ticks. Define "churn" as removed-edge lifetime below M.
  - For chains, count cycles. A degree-2 graph is paths and rings, so the "chains" label should read "chains and rings".
  - Fix the screenshot and recording ticks in advance, for example 600, 3000 and 6000, or the last tick at which all three worlds are alive. Don't pick them after looking.

**M4. Stop criteria are incomplete (Medium).**
- Source: Evidence and stops (~L15).
- "If every bonded world empties before 1000" is ambiguous. It could mean all 6 bonded runs, or per seed.
- It also doesn't say what happens in these cases:
  - **Invariant failure:** a none-equivalence mismatch, a ledger residual over tolerance, a bounds violation or a degree-cap violation. Resolution: stop, fix, and discard that data.
  - **Dead pairing:** the none world itself goes extinct, so the same-age comparison is void. Resolution: record it and still report the others.
  - **Inert bonds:** bonds never form or never persist. Resolution: report "inert", with no tuning.
- Resolution: add these cases, and specify that the ledger residual is `initial + renewed − dissipated − deathLoss − (particleEnergy + foodEnergy)`, with a stated tolerance. Define "bounds" explicitly: finite values, positions in [0,1), energy within [0, max], population ≤240, degree ≤ cap.

## Should-fix (Low–Medium)

**S1. The ledger can't see the steering.**
- Source: Architecture (~L7), `model.ts:157-160`.
- The impulses change velocity, and only `movementCost × speed` reaches the ledger. Residual ≈ 0 is therefore true by construction and says nothing about bonds.
- Resolution: add a cumulative "steering supplied" counter (Σ|Δv| per tick) to the summary and export. Word the UI as "ledger excludes the free steering impulses".

**S2. Test the impulses before drag and the clip.**
- Source: `model.ts:141,148`.
- Drag (×0.92) and the speed clip act after the impulse, so the resulting velocities are not equal and opposite.
- Resolution: export a pure `computeBondImpulses(particles, edges)`. Test that the per-edge impulses are exact negations and that the total is zero within a tolerance, since float summation order can leave a tiny nonzero total. Sum in canonical edge order.

**S3. Newborns bond with their parents by default.**
- Source: `model.ts:168`.
- Newborns appear within about 0.0125 per axis of a same-family parent, which is well inside 0.06. Most early bonds will be parent-child, so a bonded colony is largely a lineage chain.
- Resolution: expect this and report it. Optionally log the share of edges that are parent-child (a parent id is derivable only if the wrapper records it at birth; skip if that's costly).

**S4. Edge storage and replay details.**
- Edge-key packing must be safe above 2^26 ids, or use nested maps.
- Look up particles by id each tick and don't hold references across ticks.
- Sort edges in the snapshot canonically.
- Add replay tests: same seed gives the same snapshot, `step(100)` equals 100×`step(1)`, and chains/mesh equal none until the first formation.
- The wrapper needs its own bounded bond history, since the base keeps only 300 samples (`model.ts:174`). Include it in the export.

**S5. Torus drawing.**
- Draw each edge from `a` to `a + torusDelta(b − a)`, replicated over the 9 tiles. Cull by bounding box, as the particle loop does (`environment-page.ts:180-185`).
- Test an edge across the x seam, the y seam, and the corner.

## Optional

- Draw edges under the particles, thin, and low alpha. Dense meshes will turn into a haze, so consider colouring by age or by new versus old.
- Derive the UI text from the exported constants: form 0.06, rest 0.045, break 0.12, cap 2 or 4. Say plainly that "group" does not mean organism.
- Use a distinct export `kind` and a `version: 1` field. Put each world's `mode` in its own snapshot.
- Register `/particles/bonds/` wherever sibling pages are registered (Vite inputs, Docker/static copy, nav and world-picker links, production-exclusion smoke). I didn't read those files.

## Checked and fine

- **Ordering:** break, then form, then compute the impulses from pre-impulse positions, then add them to the velocities, then `base.step`, then death cleanup. This works with the base order. In-place `vx` writes are consumed correctly at `model.ts:131-150`.
- **RNG:** the base RNG is untouched, so none-mode equivalence is plausible.
- **Distances:** form at 0.06 and break at 0.12 can't thrash in one tick.
- **Impulse size:** the clamp of 0.0015 is under `speedMax` 0.008, so the steering is real but not dominant.
- **Clock:** the shared clock and the extinction-freeze behavior work unchanged for the bonded worlds once M2 is done.
