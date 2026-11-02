# I01 — Behaviour atlas and stepping stones: slice 1 plan

**1 November 2026 · exploratory engineering, no scientific runs.** Source: idea I01 of the research
programme at `/Users/nicholas/develop/browser-life/docs/simulation-research-2026-11-01/report.md`
(written against `c975f834`, uncommitted in the default workspace; not copied here). This branch
(`claude/behaviour-atlas`) was written on `4c5c4500` (`claude/3d-line-bistability-c35648`) and then
rebased onto `main` for review; the soup commits it skipped touch none of its files.

## Bounded question

Does retaining diverse viable behaviours expose transferable capabilities that a
recovery-focused archive misses? This slice does **not** answer it. It builds what the question
needs before any search budget is spent: execution-contract slices 1–3 (evidence fixture, small
CPU path, replay and determinism), plus a comparison runner that can later be pointed at the GPU.

## What already exists and what it rules out

- `packages/search` has a MAP-Elites `Archive` over mass (log2) × speed. Its insertion score
  (`quality`, `qualityMaintenance`) and its gates read regeneration, lesion recovery and light
  dependence. **Those quantities are therefore selectors, not held-out capabilities**: a panel
  that reuses them cannot compare the existing archive fairly with a new one.
- Its speed descriptor follows `Tracker` individuals. The report asks for descriptors that stay
  valid when component identity is ambiguous, and `docs/plan.md` (foundations review, Test 6 and
  the reset decision) records that tracker parenthood and identity are measurement-limited.
- `docs/plan.md` also records that phenotype-bin novelty flagged 40 of 70 neutral runs. A filled
  atlas bin is a behaviour description, never a novelty or capability claim.

## Design

New module `packages/search/src/atlas.ts` (inside the existing package: no alias-map changes).

1. **Physical descriptors, versioned (`atlas-physical-v1`).** Read per-tile bound mass (B+P) at
   census steps; no individuals, no lineage ids.
   - `displacement`: the tile's centre of bound mass, as a circular mean on the tile torus; mean
     minimal-image distance between consecutive censuses, scaled to cells per 100 steps.
   - `persistence`: occupied cells (bound mass ≥ 48, the tracker threshold, fixed in the version)
     compared between consecutive censuses by Jaccard overlap, averaged.
   - The census interval is part of the descriptor identity: every descriptor records it, the
     atlas spec fixes it, and an offer at another interval is refused (persistence of the same
     motion differs with cadence). A short final growth census, which `runChunked` emits when
     `censusEvery` does not divide `growSteps`, is skipped. Streaming: each accumulator keeps one
     previous frame per tile.
   - Bin ranges (`displacement` 0–4, `persistence` 0–1, 8 bins each) are **provisional** until
     calibrated on GPU data ("descriptor calibration" is I01's listed dependency).
2. **Atlas archive with a viability-only insertion score.** Score = survived / reps on screening
   seeds. A strictly better score replaces a cell's elite; ties keep the incumbent. No
   regeneration, recovery, light dependence or reproduction enters selection.
3. **Proposal ledger (stepping stones).** Every offer, viable or not, is appended with a ledger
   id, genome key, parent ledger ids, operator (`seed`/`random`/`mutate`), proposal seed, batch,
   score, descriptors, cell, whether it was inserted, which entry displaced it, and the first
   entry with the same genome (`duplicateOf`). Genome identity is `atlasGenomeKey`: `genomeKey` plus
   the capability gene byte, which `genomeKey` omits. Replaying the ledger rebuilds the archive exactly.
   `steppingStones()` lists entries that are ancestors of a current elite without being elites.
4. **Separation of selectors and capability tests.** Each arm declares the `Evaluation` fields and
   descriptors its selector reads. A capability test declares the fields it reads.
   `assertSeparated` refuses any panel test that reads a field some arm selects on, including
   through per-replicate equivalents (`perRep.regenerated` is `regenerated`; a bare `perRep` reads
   every field of its assay). Declarations are trusted; review checks that `passes` reads only
   what it declares. The concrete
   held-out panel is an **open decision** (below); this slice ships the mechanism, not a panel.
5. **Evaluator hook.** `EvalEvidence` gains an additive `grow-census` event, emitted only when an
   observer is passed. `atlasObserver` turns those events into per-genome descriptors. No
   `EvalConfig` or `WorldConfig` key changes, so every golden pin stays untouched by construction.
   Background-medium screens are refused (the producer's mass would enter the descriptors).
6. **Comparison runner (`compareArms`).** Pure, evaluator injected. Arms `random-viable`,
   `mass-speed` (existing `Archive`), `physical` (atlas) share the starting pool and the
   evaluation budget, per search history. The `embedding` arm is recorded as `unimplemented`:
   no model calls in this slice. Selection only ever sees screening evaluations; capability
   testing on fresh seeds is a separate later call over the frozen selections.

## Fixtures (slice 1 evidence)

Synthetic trajectories: a static blob (displacement 0, persistence 1); a translating blob
(displacement equals its speed; persistence below 1); the same blob shifted across the torus
seam (identical descriptors); a repeated trajectory (identical cell, flagged duplicate when the
genome repeats); flicker noise — **the negative case**: it lands in a bin no real form occupies
yet passes no capability test, showing that a new bin is not a new capability. One CPU `RefSim`
run of an M3 founder exercises the descriptors on real dynamics, and an instrumented-versus-plain
twin proves the observer leaves the state hash unchanged.

Recolour/re-render controls apply to the future embedding arm; physical descriptors read mass,
not pixels, so no render test is faked here.

## Open decisions (before any pilot)

- **Held-out capability panel.** Must read nothing any arm selects on. Candidates: transfer to
  `presets.ts` worlds with moving light (rotating/wandering suns), a different wound geometry,
  reproduction on fresh seeds, exact-ledger maintained sites (`capabilities.ts`).
- Descriptor ranges and bins after a GPU calibration on the M3 founder set.
- Budget, seed reservations and the advance threshold (common-protocol table, below).

## Common protocol (exploratory, unfilled fields are blocking)

| Field | Content |
|---|---|
| Identity | I01; repo SHA at run time; RULE 1 / SCHEMA 3 / METRICS 2; `atlas-physical-v1`; arm versions in the comparison manifest |
| Sampling | Unit = one independent search history. Screening seeds for search; fresh confirmation seeds for capabilities. Reservations: **TBD** |
| Intervention | None (search comparison) |
| Estimand | Held-out capability coverage per history, atlas vs mass-speed vs random-viable. Threshold: **TBD after calibration** |
| Design | Equal evaluation budgets, same starting pool, paired histories |
| Decision | **TBD**; render-perturbation survival applies to the embedding arm |
| Provenance | Ledger, comparison manifest, evaluator config, commands |
| Budget | **TBD**: benchmark steps/s on the actual device first |
| Interpretation | Visual or descriptor breadth without capability breadth ships as a gallery, not a scientific improvement |

## Out of scope for this slice

GPU pilot or any scientific run; the embedding arm; the replay gallery UI; a CLI wrapper
(`tools/atlas.ts`) beyond what the runner needs. Each follows once the open decisions close.

## Verification

`pnpm typecheck`, `pnpm vitest run packages/search`, `pnpm test`; a GPU twin
(`tests/deno/atlas_twin.ts`: `evaluateBatch` with no observer, a state-hash observer, and the
atlas observer added gives identical evaluations, and identical phase hashes between the two
observed runs) if a WebGPU adapter is available, otherwise the CPU-only limit is stated. Codex
review with `gpt-6.1-sol` at high effort before commit, recorded in `REVIEW.md`.
