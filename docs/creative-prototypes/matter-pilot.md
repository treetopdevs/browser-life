# Matter flow aquarium pilot evidence

Fixed descriptive evidence for a deliberately engineered integer-matter toy. Generated with Node 24.2.0 on darwin/arm64.

## Method

The pre-batch gate retains exactly two specified fixtures. The growth/extension recipe runs seed 0, closed mode, N=16 per tile, one B=24 patch at (8,12), zero D, zero phases, and no reservoir for 24 ticks. The empty-biomass continuation recipe runs seed 0, rain+burial mode, only D=16 at bottom tile (0,47), zero N/B and phases, and reservoir 4 through 100 ticks. Their expected values are fixed by the reviewed plan; a mismatch stops the batch without tuning.

The batch crosses seeds 1201, 1202, 1203 with all four modes (closed, rain, burial, rain-burial) through 3000 ticks, retaining all 12 outcomes. Modes share the same seeded initial physical state. Bounds, exact pool identities, cumulative counters, exchange switches, and no-resurrection are checked every tick. Independent repeats are compared as complete state hashes every 50 ticks and at the final tick. Clocks and physical fields continue to update after biomass reaches zero. Census is retained every 50 ticks and at exact extinction; full snapshots are retained at 0, 1000, 2000, 3000.

Late activity is computed from consecutive retained sample intervals within 2000–3000. It reports endpoint biomass change per tile per tick and changed active-cell mask fraction per tick, plus exact growth, mortality, recycled, relaxed and settled counter differences. Those counter differences are unit counts across the 1,000-tick window, not rates. Endpoint activity can miss turnover that cancels between samples; zero biomass activity alone does not establish physical quiescence. Relaxed and settled totals are unit-moves, not net pool conversions.

Rain follows a prescribed source schedule. At tick 3000 it has imported 24,000 units and retains 8,768 in its reservoir; exhaustion is scheduled at tick 4096. This pilot does not observe standard-rain exhaustion or its aftermath. Rain import is a supplied schedule, not an ecological result.

Source hashes were captured before the fixtures and checked again before persistence. Every unfavorable outcome remains in the JSON. No survival benefit, adaptation, or general ecological claim is made.

## Pre-batch fixtures

| Pre-batch fixture           | Gate | Horizon | Residual |
| --------------------------- | ---- | ------- | -------- |
| growth-extension            | pass | 24      | 0        |
| empty-physical-continuation | pass | 100     | 0        |

## Fixed batch

| Seed | Mode        | Outcome         | N     | B   | D   | Reservoir | Sediment | Imported | Buried | Active cells | Late absolute B change/tile/tick | Late mask flips/tick | Late counter differences                                     | First physical divergence vs closed | First burial/control divergence |
| ---- | ----------- | --------------- | ----- | --- | --- | --------- | -------- | -------- | ------ | ------------ | -------------------------------- | -------------------- | ------------------------------------------------------------ | ----------------------------------- | ------------------------------- |
| 1201 | closed      | extinct at 790  | 24384 | 0   | 0   | 32768     | 0        | 0        | 0      | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:0, settled:0      | n/a                                 | n/a                             |
| 1201 | rain        | extinct at 790  | 48384 | 0   | 0   | 8768      | 0        | 24000    | 0      | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:54542, settled:0  | 8                                   | n/a                             |
| 1201 | burial      | extinct at 790  | 23850 | 0   | 0   | 32768     | 534      | 0        | 534    | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:0, settled:0      | 32                                  | 32                              |
| 1201 | rain-burial | extinct at 790  | 47850 | 0   | 0   | 8768      | 534      | 24000    | 534    | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:54542, settled:0  | 8                                   | 32                              |
| 1202 | closed      | extinct at 1000 | 24949 | 0   | 0   | 32768     | 0        | 0        | 0      | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:50, relaxed:217, settled:0   | n/a                                 | n/a                             |
| 1202 | rain        | extinct at 1000 | 48949 | 0   | 0   | 8768      | 0        | 24000    | 0      | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:50, relaxed:54468, settled:0 | 8                                   | n/a                             |
| 1202 | burial      | extinct at 1000 | 23985 | 0   | 0   | 32768     | 964      | 0        | 964    | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:0, settled:0      | 32                                  | 32                              |
| 1202 | rain-burial | extinct at 1000 | 47985 | 0   | 0   | 8768      | 964      | 24000    | 964    | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:54251, settled:0  | 8                                   | 32                              |
| 1203 | closed      | extinct at 790  | 24582 | 0   | 0   | 32768     | 0        | 0        | 0      | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:18, relaxed:74, settled:0    | n/a                                 | n/a                             |
| 1203 | rain        | extinct at 790  | 48582 | 0   | 0   | 8768      | 0        | 24000    | 0      | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:18, relaxed:54042, settled:0 | 8                                   | n/a                             |
| 1203 | burial      | extinct at 790  | 24034 | 0   | 0   | 32768     | 548      | 0        | 548    | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:0, settled:0      | 32                                  | 32                              |
| 1203 | rain-burial | extinct at 790  | 48034 | 0   | 0   | 8768      | 548      | 24000    | 548    | 0            | 0                                | 0                    | growth:0, mortality:0, recycled:0, relaxed:53968, settled:0  | 8                                   | 32                              |

First physical divergence compares N/B/D/reservoir/sediment against Closed for that seed. First burial/control divergence compares Burial with Closed and Rain+burial with Rain. For an applicable comparison, “none” means exact equality persisted through tick 3000; “n/a” means the comparison does not apply to that mode. 6 of 12 outcomes recorded burial; report the paired differences without tuning.

Interpretation is limited to this engineered toy, its fixed rules, three seeds, and 3,000-tick horizon. Run `--check` to verify source hashes, the exact matrix, observation schedules, snapshot stocks, history consistency, and generated Markdown; `--replay-check` compares a full rerun with the retained artifact.
