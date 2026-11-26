# Nutrient currents validation — 26 October 2026

## Result and interpretation

The fixed three-seed, four-condition pilot completed through tick 6,000. All six pump-enabled worlds retain 469–496 biomass units on 33–36 cells; all six still controls lose biomass by ticks 790, 1,000 and 790. The surviving patches continue growth, mortality and recycling during ticks 5,000–6,000. The supplied pump improves persistence in this model. The early bloom contracts sharply; rain-fed tanks are still shrinking after their finite source ends at 4,096. This is neither indefinite survival nor inherited evolution.

Late visual inspection shows small bright patches concentrated in a narrow horizontal band, with nutrient movement above and below. This is a useful survival mechanism, but not yet richly varied late behavior. Preserve this baseline before considering a separate experiment with less uniform transport geometry.

## Checks

- 21 focused tests across model, clock, replay decoder, evidence validator and packaging passed.
- All five Chrome currents tests passed, including live clocks through 6,000, hidden/mobile controls, verified playback of each of the three seeds, failed-download recovery and stale-request cancellation. Corrected captures explicitly select and check seeds 1201, 1202 and 1203; nine stills and a combined animation are retained locally.
- Repository typecheck and strict standalone runner/evidence-test typecheck passed under Node 24.2.0.
- Production build passed; all five public-route checks passed against the completed build.
- Source/evidence freshness guard passed. Full rerun matched all twelve accepted runs, independent repeats, original-stepper baselines, replay censuses and compressed bytes exactly.
- Built-file removal smoke passed: page, model/UI bundles, all three replay assets and manifest are removed by the production packaging patterns. This does not claim execution of Docker or Caddy.
- The original matter model retains SHA-256 `e4d0ef43757ceeb01f5437c2e3bee27c1415b998195559a409d540a38f358bea`.

## Reviews and fixes

[Claude plan review](reviews/current-plan-claude.md) rejected the initial nested rings because they could not reach the sediment boundary. Before implementation, the plan changed to 32 full-height paired-column cycles. The counter is explicitly repeated unit movements, not net nutrient delivery.

[Claude implementation review](reviews/current-implementation-claude.md) and [Codex implementation review](reviews/current-implementation-codex.md) prompted fixes to the replay manifest schema, late-extinction interval reporting, arrow positions and phase-order coverage. [Claude follow-up](reviews/current-fixes-claude.md) cleared the scoped correctness issues. [Codex follow-up](reviews/current-fixes-codex.md) identified the recovery test needing to reload a healthy seed; that test was corrected. A same-seed retry button remains an optional usability improvement; choosing another seed and returning works.

Browser transport required neutral `.replay` filenames so the browser does not decompress before compressed-byte verification. [Comparison receipt](current-replay-comparison.json) proves every numerical outcome and compressed byte stayed unchanged. A synthetic evidence test was corrected to supply its own byte map instead of inadvertently reading real assets; a typed-array test annotation was corrected for the repository TypeScript version. Neither correction changed model or runner behavior.

One combined browser run raced a concurrent build and encountered a disappearing generated route file. The subsequent route suite ran against the completed build and passed all five checks. Initial captures mislabeled seed 1203 as seed 1201 after a stale-request test; the capture loop now selects and checks every seed explicitly. Simulation artifacts were unaffected.

No merge or deployment. Browser recordings remain local under `runs/current/captures/`; durable replay data for all seeds is committed beside the pilot report.
