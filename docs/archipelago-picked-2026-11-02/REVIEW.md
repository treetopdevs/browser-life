# S6 review log

## Plan review dispositions

Raw Codex Sol 6.1 xhigh review (read-only): `docs/archipelago-picked-2026-11-02/plan-review-codex.txt` (also
`/tmp/s6/final.txt`; prompt `/tmp/archipelago-picked-2026-11-02-plan-review.md`). Verdict: reuse foundation sound
(donor hook keyed on absolute step, `(start,end]` ownership matches); revise before implementation.

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | Sparse input log cannot pass `picksConsistencyError` as bundle `picks.jsonl` | Accepted. Plan now separates immutable sparse input log from complete applied history; bundle holds the applied history, checked against the input. |
| 2 | P2 | Stitched manifest keeps only last segment's picks digest/counts | Accepted. `stitchRun` recomputes the `picks` block over the whole run; test with a boundary-free final segment. |
| 3 | P1 | Gates pass for islands ignoring picks (rule-equal picks are hash-identical) | Accepted. Null-fixture rule: non-rule donors, differing hash vs rule control, exact assignments, an ignoring-picks control must fail, demo must show a non-rule donor row. |
| 4 | P2 | Incomplete strict log escapes terminal failure (plain Error, release for retry) | Accepted. Strict logs need full coverage at creation; all deterministic pick failures mapped to terminal `fail`; tests each. |
| 5 | P2 | PUT validation needs a preset the request lacks | Accepted. PUT is context-free; creation re-validates stored bytes in context. |
| 6 | P2 | Island-only GET blocks the stitch exporter | Accepted. `require_island_or_admin`, hex64 check before `blob_path`; auth matrix tests. |
| 7 | P2 | Cached export `existing()` ignores the pick log | Accepted. `existing()` validates picked bundles; tamper/delete tests. |
| 8 | P2 | Loader does not refuse lesions/feeds/pressures; fixtures contain them | Accepted. Submit-only refusal policy (incl. suns); existing fixtures become refusal cases; new clean picks-only fixture. |
| 9 | P3 | Export command lacks `--experiment`; run.ts flag is `--seeds` | Accepted. Commands fixed. |

All nine accepted; none rejected. Scope stays as planned (no model pickers, no pressures, no physics change).

## Landing status (2026-11-17)

Ported onto main b1d463f0 from the uncommitted workspace (base e8d75273). Only `tools/run.ts` conflicted (main added the slab
path and imports; the loader was kept moved to `tools/lib/pick-record.ts`, main's slab code kept). Dropped as scratch:
`plan-review-codex.full.log` (613 KB raw log; the 10 KB `plan-review-codex.txt` is kept). Not done, because they need GPU runs
that were out of scope: `tests/deno/picked_segments.ts`, the `it-picked` leg of `coordinator_integration.ts`, the Playwright
spec, and the manual demo with its `evidence.md`. They are written but unrun; the equality claims are unmeasured.

Codex Sol 6.1 High review of the ported diff (read-only): P2 JSONL submission silently dropped lesion/feed/sun/pressure lines
(fixed: `submitRefusal(lab, text)` names them, test added); P2 a 404 on the pick-log fetch was released for retry instead of
failed (fixed in `island.ts`, test added); P3 doc overstated that the API excludes schedules beside a pick log (doc narrowed);
P3 the GPU wrong-pick test in `tests/deno/picked_segments.ts` checks the failure line and absent pond rows but does not compare
state with a pre-cycle control, and uses a nonexistent pond (999) rather than an existing unoccupied one (open; needs a GPU run
to verify any change). Two test-sweep fixes from main's drift: `sun-v1` now precedes `picks-v1` in the capability lists, and
the picked-refusal message changed to "without a pick log" (three vitest expectations updated).
