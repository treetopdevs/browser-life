# Adversarial read-only review: bodies v3 ("boundaries")

You are reviewing UNCOMMITTED work in /Users/nicholas/develop/browser-life-bodies (branch claude/bodies-loose). Do not modify anything. Be adversarial; assume the author is optimistic. Posture of the project is exploratory (no gates, no pre-registration) but claims must be honest, including nulls.

## Scope
1. The v3 additions in `apps/lab/src/bodies/model.ts` (v2 is the default; v3 knobs are optional and gate contact/growth/sharing/signalling by a heritable recognition mark).
2. The v3 harness under `experiments/bodies/` (`v3.ts`, `run.ts`, `png.ts`) and `docs/bodies-2026-11-17/v3/HARNESS.md`.
3. The new tests: `apps/lab/test/bodies-v3.test.ts` (and changes to `bodies-model.test.ts`, `bodies-experiment.test.ts`).
4. The new "2026-11-18 — v3: boundaries" section at the top of `docs/bodies-2026-11-17/README.md`, checked against the raw outputs in `docs/bodies-2026-11-17/v3/` (SUMMARY.json, per-arm JSON/TSV, `_skeptic/`, `_audit/`).

You may read files and run read-only commands (no writes, no network). Do not run the full test suite; you may run single named test files with `PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH pnpm vitest run <file>` only if it writes nothing.

## Project rule that must hold
Body ids must not appear in the dynamics. Any "self" recognition must be a LOCAL comparison of a heritable tag carried by two neighbouring cells; never root identity, never a component label, never a basin id. Observer-only code (metrics, root basins, components, PNGs) may label anything.

## Check specifically
- Body ids / root ids / component or basin labels leaking into dynamics (including via the observer feeding back into the step, shared arrays, or ordering).
- Ledger exactness: matter/energy conservation is exact under every new knob (share, signal, wound, bud, turnover, patch replacement); any rounding, remainder or sink that is not accounted for.
- v2 hashes unchanged by default: with no v3 knob set, state hashes and RNG draw order must be identical to v2 (new optional keys absent from default config; no extra RNG draws). Verify against stored v2 hashes (e.g. crowd seed 1 20000 steps = 2445250181) and the tests.
- Gates leaking across seams: any path (growth, bud, share, signal, wound, turnover, diffusion, recolouring) where a gated interaction still crosses a foreign-mark boundary; mark compare done on parent vs newborn vs neighbour; tolerance semantics (`tol`) off by one; wraparound/edge seams.
- Update-order bias: raster or rotated-raster ordering, sequential in-place updates, first-come advantages that bias which side wins; check the claimed fix (407/450 etc.) is genuinely unbiased and that other loops are not biased.
- Observer metrics: definitions of components, root basins, seam counts, mark patches, "clade patches", turnover/replacedTiles; off-by-one, double counting, differing definitions between arms and skeptic code, metrics that are true by construction.
- Every README claim against the JSON: overclaims, numbers that do not match the files, claims lacking a matched control comparison (tag-blind control, tol 128 control, plain/NEUTRAL arms), seeds cherry-picked, explorer vs skeptic disagreements resolved in the favourable direction, claims that rest on pre-fix runs (the README admits stateHashFull was not audited against a pre-fix build; judge how serious that is), unsupported causal language, "freeze" and "lottery" claims.

## Output format
Numbered findings, each tagged P1 (wrong/invalid result or broken invariant), P2 (material overclaim, missing control, real bug with limited blast radius) or P3 (minor), each with `file:line` (use the real line numbers in the working tree) and a one-to-three sentence justification, plus the concrete evidence (the number in the file versus the number in the README, or the code path). Order by severity. End with a short list of README claims you verified as true, and a one-line overall verdict. If you find nothing in an area, say so explicitly.
