# Soft Roam chunk 5: levels, a slanted picture, and an inner pulse

2026-11-26. Rules: the "Depth" and "Inner pulse" paragraphs in the header of `apps/lab/src/softroam/kernel.ts` (there is no separate
contract file for this chunk). Probes: `experiments/softroam/depth.ts`, `experiments/softroam/pulse.ts`; outputs in
`runs/softroam/depth/` and `runs/softroam/pulse/`. Seeds 1 and 2 only, one year (12,000 steps) each, so everything here is on seen
seeds and nothing is confirmed.

## What was built (every key optional; every earlier start's digest unchanged)

- **Levels** (`depth` 2 to 4, with `depthGap`, `depthCost`, `depthDive`, `depthDim`, `depthShade`): the top-down world gets a floor,
  a surface and levels between. Bodies push, touch and feed only on their own level and see through all of them; ground food is on
  the floor; light comes from above and is dimmed and shaded on the way down. A heritable `lift` gives a body its home level; a hungry
  body dives to the floor and goes home once it has stopped growing and filled up; a hunter goes to its prey's level and prey leaves a
  threat's. New start `deep`: the bodies start with three levels.
- **The slanted garden** (picture only): with levels, the garden draws each level 1.5 tiles further up the screen than the one under
  it. The floor stays put, a little paler, and a body's shadow falls straight under it, so how far a body is from its shadow is how
  high it is. A body that changes level slides there over some steps. "Garden from straight above" (`top`) is the old view.
- **Inner pulse** (`pulse`, with `pulseThrust`, `pulseFlex`, `pulseMut`): every cell carries a network of 40 inherited weights and two
  signals. Each step it reads its own signals, its mother's, the mean of its daughters', how full it is, the stretch of its bond and
  its body's aim, and gives its next two signals, a "go" that holds back its thrust (never adds to it) and a "flex" that shortens or
  lengthens its springs by up to a quarter. No clock and no rhythm gene: a beat is whatever the weights and the bonds make. A start
  option draws each founder's weights between -64 and 64 (`pulseSpread`). In the picture a cell is brighter or dimmer with its signal.
- Dials for all of it (groups "Depth" and "Inner pulse"), readouts "Levels" and "Inner pulse".

## Numbers at step 12,000

Levels, the deep start against the same world flat (`runs/softroam/depth/tune`, `v1` and `d0`):

| seed | floor / middle / surface (share of cells) | level changes | cells, deep vs flat | pack hunters | groves |
| --- | --- | --- | --- | --- | --- |
| 1 | 88% / 6% / 5% | 1,521 | 335 vs 456 | 115 vs 241 | 42 vs 99 |
| 2 | 80% / 18% / 2% | 961 | 348 vs 382 | 130 vs 201 | 54 vs 64 |

All three levels stay occupied all year, but the floor holds most of the life, and hunters and groves do worse than in the flat
world; herds do better. Without the hunger dive everything off the floor starved within 2,000 steps.

Inner pulse, the bodies start (`runs/softroam/pulse`). A cell "beats" when its go or flex swings by 24 or more of 254 over 128 steps
in a rhythm of 3 steps or longer; "flickers" when it swings every step or two.

| seed | arm | cells | cells beating / flickering / still | bodies of 4+ that beat | period, median (10th to 90th) | travel per cell per 1,000 steps |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | no pulse | 456 | | | | 23.8 |
| 1 | signals only (both effects at 0) | 456 | 149 / 61 / 246 | 18 of 53 | 5 (3 to 11) | 23.8 |
| 1 | pulse | 421 | 104 / 120 / 197 | 18 of 56 | 6 (3 to 15) | 27.1 |
| 1 | still founders, copy errors only | 509 | 0 / 0 / 509 | 0 of 64 | | 24.2 |
| 2 | no pulse | 382 | | | | 18.6 |
| 2 | signals only | 382 | 95 / 69 / 218 | 9 of 45 | 10 (3 to 28) | 18.6 |
| 2 | pulse | 565 | 134 / 31 / 400 | 17 of 65 | 10 (4 to 37) | 25.5 |
| 2 | still founders, copy errors only | 380 | 0 / 0 / 380 | 0 of 46 | | 21.9 |

What this shows, and what it does not:

- **The substrate beats with no clock.** On a still body, about a third of networks drawn at spread 64 give a rhythm of 3 steps or
  longer (median about 18), about a fifth flicker and about a third do nothing (1,000 draws each on a chain of 6 and a tree of 21). In
  the world a quarter to a third of cells beat all year, at periods from 3 to a few tens of steps.
- **The beat reaches the body, a little.** A beating cell's bond swings by 0.11 to 0.17 of its length over the window, against 0.01 to
  0.05 for the rest and 0.01 with the effects at 0. At the page's scale that is about one pixel, so in the picture the pulse reads
  mostly as light moving along a body, less as squeezing. `pulseFlex` goes to a half.
- **Not shown: that beating matters.** The share of cells that beat is about the same with the effects on as with signals that do
  nothing, so nothing here says selection favours or removes a beat. Cells and travel differ from the no-pulse world in both
  directions on two seeds, which is inside what one seed changes.
- **Not shown: a gait.** Springs act equally on both ends, so flex gives a body no push of its own (rounding and the per-cell speed clamp can leave a small drift); only go, by holding thrust back, changes
  where a body goes. No body was seen crawling by its beat.
- **Copy errors alone do not start a beat.** From still founders, no cell beat in a year on either seed (one weight in 40 moves by 16,
  in a tenth of births). The beats seen are the founders' draws, inherited and drifting, not invented in the run.

## Known limits

- In the slanted garden the shadow that falls on a body that is gliding between two levels is placed for the level it is drawn on, so
  for the few steps of a glide it is off by less than one level's slant.
- The slanted picture wraps at the top edge like everything else on the torus: a high body near the top is drawn at the bottom.
- Kinds off on the bodies or deep start at default dials drops `jaws` (as before this chunk; the dials test skips that case).
