# Growing families validation

Status: implementation and initial fixed evidence complete; complete for this local prototype slice; review fixes and final source-freshness batch verified. No merge or deployment.

## Evidence

The unchanged ample-food assay passed for all three supplied programs: 24 founder cells by tick 240, first birth at tick 160, and three distinct normalized footprints at tick 144. All six seed/settings combinations reached tick 3000. The runner checks every live tick for bounds, connected bodies, unique occupancy, caps, lineage truth and exact zero energy residual, with independent repeats and retained milestone snapshots. The evidence agent completed `--replay-check`; the parent independently verified `--check` against current sources.

The six runs ended with 47–48 bodies and seven generations. Mutation-on runs had 48–56 effective mutations and 20–25 living program variants. Death records show 190–192 age deaths and 2–7 starvation deaths per run; 931–977 birth opportunities were blocked by the 48-body ceiling. These are supplied demographic pressures, not evidence of adaptation. No rule or preset was tuned after the pilot.

## Local checks

- Parent: all 44 model, clock, packaging and evidence tests passed after the final source freeze.
- Parent: project typecheck and final production build passed; standalone strict runner compilation passed with Node types explicitly selected.
- Parent: all 10 Chrome tests passed (five development checks and five public/private-route checks). The controlled-frame test advances the actual page/model at 2×, verifies current growth/selection, exact selected-body death at tick600, and the6000-tick stop. Exports explicitly assert browser runtime labeling.
- Parent: the original full `--replay-check` passed, reproducing complete JSON and Markdown exactly. A subsequent frozen-source regeneration matched all original JSON data excluding only sourceSha256; the final checker-only additions were also regenerated successfully, and the final comparison receipt confirms exact equality of every outcome excluding only source hashes.
- Parent: all eight earlier evidence freshness guards passed unchanged after this slice.
- Parent: final built-file production removal smoke passed using actual Docker removal patterns: public index retained, development entry/chunks/domain markers absent. This is not a Docker image or Caddy runtime test.

## Reviews and visual record

Claude Sonnet High plan review completed with explicit resolutions in the plan. Codex Sol6.1 High implementation review completed with two actionable findings: Buffer-backed fixture food could alias live state, and the quick evidence checker did not validate unique conditions or full snapshot coverage. Both fixes and targeted regression tests pass. Claude Sonnet High implementation review completed with no blockers and several low-severity findings. We also address viewer cache freshness, browser runtime labeling, explicit mutation-off assertions and generated demographic columns. Its evidence-scope statements reflect files observed earlier during the concurrent run; the parent subsequently verified the captures, replay, typecheck/build and packaging smoke described here. Browser capture used seed 1201 at actual ticks 0, 1002, 3007 on Chrome at 1440×1100, without page errors. The UI agent inspected all three stills; the parent independently inspected the tick 3007 still. Connected branching bodies and interleaved families are visible in both panels, with cyclic cohort dips in the histories. Selected mutation-world body 206 had parent 169, generation 6 and turnEvery 5; its turn 0 makes that particular changed field neutral for shape. A 53.24-second continuous WebM was recorded but not independently reviewed in full. Artifacts are ignored local files under `runs/development/browser/`; they are not included in the PR. Claude follow-up confirmed the main fixes. Final Codex Sol6.1 High follow-up found no remaining actionable findings in the latest scoped source, and executed bounded Buffer, malformed-evidence, lineage-consistency, runtime and extinction-milestone probes. Its attempt to run Vitest was blocked before execution by its read-only environment; the parent ran the full focused suite separately.

## Final-run integrity

The first post-review regeneration was rejected before writing artifacts because the runner source changed during execution. Its outcomes are not accepted. The existing pilot remains intact; a frozen-source regeneration completed successfully and matched every prior JSON outcome exactly, excluding only sourceSha256 (see development-replay-comparison.json). The parent also identified a validator edge case for snapshots taken before eventual extinction; the correction and focused regression now pass.

Claude follow-up statically confirmed the model/UI fixes and independently identified the already-corrected pre-extinction milestone case. The additional sample/history and snapshot/lineage consistency checks now pass targeted tamper tests and independent Codex probes. The follow-up Codex process recovered from a temporary rate limit and completed without remaining actionable findings.
