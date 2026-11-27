# Droplets vs Reef: result on unseen seeds (2026-11-21)

**Decision under the frozen rule: droplets get the next month.** Both worlds passed, so the pre-stated tie-break decided it. Rule and kernels were committed in `b4f26d15` before any seed 5–12 run. Run files and `verdict.json` are in the main checkout at `runs/confirm-2026-11-21/` (gitignored).

All 56 runs completed with zero matter residual. No seed was replaced. The droplet job hit the 2-hour background limit at 22 of 32 runs and was resumed with the same frozen code.

## Pass or fail (final 20% of each run, seeds 5–12, 7 of 8 needed)

| World | Endpoint | Seeds |
|---|---|---|
| Droplets | More droplets than pattern-blind phage | 8/8 |
| Droplets | More droplets than single wall | 8/8 |
| Droplets | More leader sweeps than no phage | 8/8 |
| Droplets | Higher diversity than pattern-blind phage | 8/8 |
| Droplets | Persists | 8/8 |
| Reef | More armor than no grazing | 7/8 (seed 9 lost) |
| Reef | Larger bodies than no grazing | 7/8 (seed 9 lost) |
| Reef | Multicellular bodies, grazers and phototrophs coexist | 7/8 (seed 10 lost) |

## Direction

**Droplet diversity holds and is flat.** With phage, Hill D1 by fifths of the run is 4.65, 4.64, 4.57, 4.63, 4.58, and droplets stay near 70. All 8 seeds read as sitting. The maximum possible D1 is 6, because the world has six patterns.

**Without phage, droplets lose their diversity.** No-phage worlds fall from D1 3.9 in the first fifth to 1.1 from the third fifth on, with about 33 droplets. The 20k pilots could not show this: at that length no-phage diversity was still higher than phage.

**Reef bodies are not getting bigger. More cells are joining bodies.** Mean body size by fifths is 4.04, 4.62, 5.05, 5.76, 6.63, but that average counts single cells as bodies of one. The share of cells in multicellular bodies rises from 0.66 to 0.84, while the size of a multicellular body barely moves (9.6 to 10.0 cells) and the largest body is flat (31.4 to 32.2). Per seed, the pre-stated reading is mixed: 4 climbing, 2 sitting, 2 falling, one seed short of the 5 needed for "climbing".

**The Reef without swimming (reading only).** GRAZE_NO_SWIM coexists in 8 of 8 seeds and has larger mean bodies than the full world (8.04 against 6.63 in the final fifth), so swimming is not what builds the bodies.

## Limits on this decision

- The tie-break favored droplets by construction. The Reef could win a double pass only if droplet diversity failed to hold.
- The tie-break branch that fired is the substantive one: droplet diversity held and Reef body size did not read as climbing.
- The Reef passed at the minimum, 7 of 8 on all three endpoints. Its seed 7 armor win is 0.0661 against 0.0625. If that seed had flipped, the Reef would fail and droplets would win outright, so the winner does not depend on that margin.
- The Reef's no-grazing control is split: 5 of 8 seeds collapse to single cells (size 1.0) and 3 stay multicellular. Where the control stayed multicellular, grazing had larger bodies in 2 of 3 seeds, so much of the body-size separation comes from the control's collapse.
- Pattern-blind phage is extinct in all 8 seeds, so the droplet comparisons against it show that it kills the world. They do not measure a margin between two living worlds.
- Droplets are a steady cycle among six fixed patterns. These runs show durable coexistence and turnover, not open-ended novelty.
- **Note added 2026-11-22.** The droplet count is a count of connected patches of wall above 0.20. A later check (docs/b2-compartment-check-2026-11-21) found that in the PHAGE and NO_PHAGE worlds these patches are crests of moving waves, not compartments: 2% to 3% (PHAGE) and under 0.1% (NO_PHAGE) keep their identity for 1,000 steps. D1, D2 and D5 compare amounts and fragmentation of wall pattern, not numbers of individuals. D3 and D4 do not use the count.

## Exploratory check (after the verdict, not part of the rule)

Leader changes could have been flicker between near-tied patterns. In the final 100k steps of each PHAGE run, a new leader reached at least 40% of wall matter 21–30 times, and all six patterns led at some point. The turnover is real.
