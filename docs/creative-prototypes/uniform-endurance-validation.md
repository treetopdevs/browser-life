# Uniform endurance validation

26 October 2026. Branch `codex/uniform-food-endurance`, based on PR101 tip `8161900f109afa2260d66e804f5bd6e2e2fd8222`. Local exploration only; no merge or deployment.

## Completed checks

- Parent inspected the literal model diff: one provenance comment and observation capacity 301→451. The runner mechanically restores those bytes and requires the original model digest; no biology, RNG, food, lineage cap or other rule changes.
- All three accepted runs passed independent primary/repeat comparisons through 9,000. Every seed matched its own pinned 6,000-tick prefix: 301 samples, 301 frames, 6,000 tick rows and five full checkpoint comparisons. The intermediate old checkpoints are compared during execution; their recorded comparison hashes do not let structural validation reconstruct absent full states.
- Old same-seed structural checks ran before writing each new output. New `--check` passed for all three seeds: source identity, exact fields, accounting, frame/body/lineage/history joins, prefix proof, repeat record and Markdown. No dropped history or lineage; zero energy residuals; each JSON remains below 24 MiB. Structural checks are not an extra fresh replay; independently initialized repeats run inside each accepted execution.
- 75 focused tests pass across endurance evidence, preceding uniform/hungry evidence and the hungry/development models. This includes accepted-artifact corruption with recomputed digests, wrong-seed or absent proof, extra normalized fields, altered biological state, prefix boundary, cap 99/100, zero births/deaths and off-cadence terminal schedules. The extinction fixture tests schedules; these actual uniform worlds did not become extinct.
- Repository typecheck, strict standalone runner typecheck and Vite build pass. 13 focused browser tests pass, including rejected hashes/decisions, cadence and accessibility fixtures.
- Actual-data playback advances saved frames; desktop (1440) and phone (390) checks have no page errors, accessibility violations or horizontal overflow. Parent viewed the accepted phone presentation and all three four-frame contact sheets. Final-copy checks pass too; all three 15.1-second clips load and advance, and their provenance matches the delivered sources. See the final review disposition and media verification record.

## Decisions and review

Claude Sonnet 5.5 High and Codex Sol 6.1 High reviewed the plan, implementation and boundary repair before the pilot. The prefix-boundary bug and missing test export were corrected and both reviewers explicitly cleared the first run. Reviews are retained under `reviews/uniform-endurance-*`.

Seed 1203 passed all numerical criteria and three parent visual comparisons before seeds 1201 and 1202 ran. Both earned seeds also pass. Visual receipts were written before overlap diagnostics. All runs stop at 9,000. This is a descriptive longevity screen, not an adaptation or increasing-complexity demonstration. Final adversarial outcome review and its disposition accompany the commit.
