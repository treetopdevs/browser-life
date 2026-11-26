# Motif workshop validation

Dependent slice from PR91 tip30d24878, implemented in a fresh worktree. No change to existing ParticleWorld, BondedWorld, prior evidence, or the research kernel. No merge or deployment.

## Fixed observations

All twelve grammar compositions crossed with seeds1201–1203 through3,000 ticks. Each has an independently initialized unchanged replay, plus a fresh replay perturbed at1500 by moving the smallest living particle ID one spatial bin in x. Before the move, full state must match. Later occupancy distance and full-state hashes are distinct measures. Six known-preset controls match old pursuit/flock snapshots. All36 populations survived; aligned seasonal gathering lost Amber in seed1202. These are descriptive outcomes, not proof of evolution or increased survival.

The first evidence process was stopped after parent inspection found a stalled paired-clock loop: its nominal clock advanced only on sample boundaries. No results from that process were accepted. Corrected every-tick clock progression, added a bounded guard and a scheduling test, strengthened per-tick bounds, initialized the first texture interval from tick0, and handled exact1500 extinction. The complete corrected batch passed invariants and controls. A final fixed-batch rerun after reporting-only review fixes is compared against it, with source hashes handled separately from unchanged numerical outcomes.

All seven prior evidence guards passed unchanged: baseline particles, picker, oases, flock-oases, seasons, bonds and boundaries. New freshness checks pin model/grammar/observer/runner source, Node24.2.0 and zlib, recipes/settings, all36 outcomes, and exact generated Markdown. Full histogram counts and scalar trajectories are in [pilot JSON](motifs-pilot.json); [report](motifs-pilot.md) retains every recipe/seed and both quiet and active results.

## Browser evidence

Actual all-twelve-card recording at seed1201, pace2x: `runs/motifs/browser/motifs-seed1201-through-3000.webm`. Screenshots at ticks0,1502,3004; pauses for screenshots retained. Browser viewport1440×4400 captures the tall gallery. The [independent visual review](reviews/motifs-visual-review.md) inspected stills, not the full continuous video. It found a readable three-column gallery: chase remains dispersed with changing arrangements, gather forms food-associated clumps. Geometry/interaction tests separately cover phone layout; real-device performance is unverified. Browser capture is illustrative same-source evidence, not a cross-engine bit-identity claim.

Parent review caught a two-tick frame crossing a100-tick sample boundary without refreshing cached history. Changed cache detection to completed sample age. Codex also caught a stale-cache export when pausing before the next metric update; pause/export now synchronize samples. These are display/observation fixes, not physics changes.

## Reviews and checks

[Claude Sonnet5.5 High plan review](reviews/motifs-plan-sonnet-review.md) preceded implementation, with [resolutions](motifs-plan.md). Claude implementation review and repository-required Codex Sol6.1 High review cover model, observers, UI, runner and packaging. Codex found unused runner declarations and blank manual-pause status in addition to cached export; all are fixed before closure. The new runner test imports the CLI, bringing its types into root typechecking; strict standalone runner compilation also runs explicitly.

The focused Codex follow-up found no remaining concrete source blockers. It ran while regeneration was pending, so its temporary source-hash mismatch is resolved by the parent’s final artifact check below.

## Final verification

43 unit checks (motif model, clock, runner schedule, packaging and existing social metadata) and10 Chrome checks (5 gallery,5 public-route/build) passed after fixes. Typecheck, strict runner compilation and build passed. The actual Dockerfile removal globs were applied to a temporary build copy: the motif entry, stylesheet and model/observer chunk were removed, no motif code markers remained, and the public index survived. Receipt: `runs/motifs/package-check.json`; no Docker image or Caddy runtime execution is claimed.

Further Sonnet resolutions: capture source hashes before generation and reject edits during it; exclude unscheduled extinction observations from the fixed late-window aggregate; reject malformed/inconsistent compiled constructor inputs; show occupied-bin sample age; assert generated table column counts. No prior model rules or experimental parameters changed. The full source review artifacts retain findings even when later corrected.

The final fixed-batch rerun exactly matched the earlier complete numerical payload, excluding only the expected source-hash changes. Runtime, settings, every sample, perturbation and replay/control record were included in the equality comparison. Parent independently repeated that comparison and verified36 runs with31 scheduled samples each. [Durable comparison receipt](motifs-replay-comparison.json). Final source/runtime/rules/matrix/Markdown freshness passed. No additional literal `--replay-check` was needed after this full rerun; the command remains available.
