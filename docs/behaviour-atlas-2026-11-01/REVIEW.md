# I01 review dispositions (2026-11-01)

Three lenses by the implementing session, then Codex `gpt-6.1-sol` at high effort, read-only
(`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only`), on the uncommitted worktree.
Codex ran no tests; it read the diff and ran two in-memory probes. Verdict: no P1; six P2; three P3.

## Own lenses (before Codex)

- **Conservation / ledger.** `Archive.ledger()` is derived from the same array that `viableLog`/`replay` use and from
  a parallel `outcome` array written in `offer`; it carries no state of its own. Checked: `current` agrees with the
  cells map, `displaced` points at an entry that is no longer current and shares the cell, replay rebuilds the ledger
  exactly (tests). Null-cell offers (undefined atlas descriptor) stay viable and join lineages and passers. The
  limit is stated in PLAN.md: non-viable proposals are counted (`evaluated - viable`), not logged, so ancestry covers
  accepted viable candidates only.
- **Determinism / replay compatibility.** Candidate generation and RNG advance are unchanged (only a `Provenance`
  object is recorded beside each candidate). `bootstrap-200`'s 1,990 lines replay to its archive.json
  (47 elites, 62 lineages, counts, passers vs gate.json). Default `ec`, `search` and `provenance` blocks gain no key
  unless `--archive atlas-v1`, so old archives resume exactly. Descriptors are binned from the stored JSON float (a
  double round-trips exactly), never recomputed on replay.
- **Test coverage.** Fixture values and negative cases; candidate summary; atlas-cell throw on missing descriptors;
  ledger vs archive; prov / no-prov equivalence; `proposalGenome` regenerates every logged mutant (also on the
  30 real smoke proposals: `provenanceRegenerated` 30 of 30); calibration verdicts; seed ledger disjointness.

## Codex findings

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P2 | Manifest `passers` counted offers, not distinct passers | Fixed: `passersDistinct` (matches `gatePassing()` and gate.json) and `passingOffers`; manifests regenerated |
| 2 | P2 | `atlasCell` accepted NaN/Infinity; JSON turns NaN into null so replay would change the cell | Fixed: throws on non-finite descriptors and empty ranges; test added |
| 3 | P2 | Resume/replay ignored the recorded atlas definition | Fixed: `provenance.atlasSpec` compared with `ATLAS_V1` by definition (`sameAtlasSpec`) in `tools/bootstrap.ts` and `tools/atlas.ts`; mismatch throws; test added |
| 4 | P3 | `--resume` requires the same `--archive` (fails closed) whereas the comment promised adoption | Fixed in the header comment: `--confirm-only` adopts, `--resume` must repeat the flag |
| 5 | P2 | "sparse" absent from per-descriptor verdicts | Accepted as stated and clarified: sparse is a property of the pair; added `pair` to the report, PLAN wording and test |
| 6 | P2 | Held-out tests described as using no field the selector reads, but `survived` and `mass` are read by `quality` | Fixed: PLAN and `heldout.ts` now call them transfer tests of survival in shifted environments, with random viable sampling as the arm that separates archive effect from plain survival selection |
| 7 | P3 | Undeclared range safeguards (D1 hi >= 0.25, D2 lo <= 0.95) | Documented in PLAN and `calibration.ts`; they did not bind (D1 1.75, D2 0) and were in code before any calibration row existed |
| 8 | P3 | Cross-axis correlations incomplete | Fixed: each descriptor against speed, log2 meanMass and quality, plus jointly defined A/B pair counts (D1 12, D2 32). Finding: D2 vs speed -0.80, recorded in PLAN |
| 9 | P3 | Replay evidence compared summaries only | Fixed: `replay-check` compares passer membership with gate.json; ledger tests for equal-quality ties and non-viable offers added |

Noted, not changed: the same-process determinism test does not establish cross-runtime stability of
`sin/cos/atan2` at bin boundaries (a qualification limit; replay uses stored floats). "Recoloured copy" is a
mass-scale invariance check on raw state, not a rendered-image control (the learned-embedding arm that would need
one is deferred). The plain twin covers one batch of 16 genomes.

Gates after the fixes are in the final report of the slice (typecheck, `packages/search` tests 111, full vitest with the
load-induced timeouts re-run in isolation, `tests/deno/bootstrap-resume.ts`, `tests/deno/gpu_golden.ts`).
