# Soft Roam, chunk 3: big bodies, body steering, a leaf pool, a winter that costs (note, 2026-11-26)

Contract: `CONTRACT-3.md`. The owner asked for the first four ranked rule changes of `NOTE-2.md`. All are built as
optional kernel keys, absent from every earlier start: the garden pins and a new pin of the seasons start (seeds 1 and
2) are unchanged, and Codex checked that the absent-key path makes the same hash calls in the same order as `b62f26c2`.

## What was built

| Ask | Built | Key |
| --- | --- | --- |
| 1 bigger plans or regrowth | three founder plans of 21 to 25 cells (`herd`, `grove`, `pack` in `view.ts`), and **heal**: braces hold a body together, so a cell that dies inside it leaves a hole its mother grows again instead of splitting the body | `heal` |
| 2 body steering, prey size by mouths, crowd | one aim per body (the body turns, and every cell with a chase gene steers by it); a mouth may act on up to `pack` cells per mouth of its body in touch (in sight: per mouth it holds), and a pair that could act both ways does neither; a seeing mouth counts other hunters' mouths beside a candidate as distance | `steer`, `pack`, `crowd` |
| 3 separate leaf pool | a share of all upkeep goes to a pool, up to a cap, that only leaves are paid from | `leafPool`, `leafPoolMax` |
| 4 season as forcing | patches hold `patchFood` x the year's light; every cell pays a winter upkeep in proportion to how dark the year is | `patchSeason`, `winterCost` |

The plan's `regrow` cadence was built and dropped before review. The kernel already regrows a lost daughter, because
her mother goes back to the mode that made her. What kept bodies small was splitting, and Codex showed `regrow` could
stop a release loop for good. A probe showed plan size alone does nothing: 25-cell plans grow to 25 alone, but in the
seasons world the largest body stayed 10 to 19 with no cell in a body of 20+.

A new start `bodies` (the page default) is the seasons plus every key above, the three big types only, and over the
seasons' values: release cap 8, crack 2000, life 20,000, patches not gated by the day band (`patchSun` off), pack 6,
crowd 1, leafPool 0.3 up to 2000, winterCost 0.03. `seasons` and `garden` are unchanged and selectable.

## Evidence (frozen tree, 36,000 steps = three years, one history per seed)

Numbers from `runs/softroam/c3/final2/` (JSON summaries and TSV series). Pictures from `runs/softroam/c3/final/`: `series-s*.png`,
sheets, and a 900-step `movie.mp4` for seeds 1 and 2. The two batches ran the same worlds; every number but the feed counts came
out identical. The first batch read the prey's body size after the step, when a dead prey's slot may hold another cell (Codex
final review); `final2` reads it as touch saw it. Tool: `runs/softroam/c3/tools/tune2.ts`; plot `tools/plot3.gp`; tuning history
`runs/softroam/c3/tune/` and `runs/softroam/c3/ctl/` (pack 4 to 12, leaf 1 and 2, the pool at pack 4). Shares are over samples every 100 steps from step 6,000.

| seed | cells | year swing (max/min, years 2, 3) | cells in bodies 10-14 / 15-19 / 20+ | largest at end | leaves | kinds in bodies of 15+ (plain/shell/mouth/leaf %) | feeds on prey bodies 1-4 / 5-12 / 13+ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 582 | 1.40, 1.49 | 23.9 / 6.7 / 0.5 % | 15 | 4.4 % | 84/9/4/4 | 18,179 / 12,806 / 0 |
| 2 | 681 | 1.74, 1.74 | 21.7 / 8.3 / 1.5 % | 13 | 0.9 % | 73/24/1/1 | 21,498 / 12,937 / 388 |
| 3 | 572 | 1.40, 1.50 | 24.5 / 3.9 / 0.1 % | 16 | 3.9 % | 90/1/7/2 | 16,260 / 16,663 / 366 |
| 4 | 576 | 1.43, 1.49 | 24.2 / 7.6 / 0.9 % | 19 | 2.0 % | 80/14/3/4 | 14,657 / 8,981 / 38 |

For comparison, in the chunk 2 seasons default 0.1 percent of cells were in bodies of 10+, and the largest body was 12.

Each key off in turn, seed 1 (default row first):

| off | cells | swing | 10+ / 20+ | largest end | leaves | feeds 1-4 / 5-12 / 13+ | body size winter / summer | fewest of each kind (plain/shell/mouth/leaf) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| (none) | 582 | 1.40, 1.49 | 31.1 / 0.5 % | 15 | 4.4 % | 18,179 / 12,806 / 0 | 5.79 / 6.45 | 392/5/12/13 |
| heal | 728 | 2.19, 2.25 | 11.1 / 0.0 % | 11 | 0.4 % | 18,245 / 4,750 / 0 | 3.65 / 4.65 | 384/0/1/0 |
| steer | 581 | 1.47, 1.52 | 36.0 / 1.3 % | 13 | 1.8 % | 7,074 / 7,259 / 0 | 6.15 / 6.59 | 405/2/7/2 |
| pack | 565 | 1.41, 1.52 | 30.2 / 0.2 % | 19 | 1.3 % | 8,202 / 4,753 / 0 | 5.76 / 6.19 | 406/3/3/1 |
| crowd | 598 | 1.51, 1.51 | 33.7 / 0.2 % | 15 | 3.3 % | 14,629 / 13,197 / 636 | 5.59 / 6.30 | 399/0/8/10 |
| leafPool | 600 | 1.42, 1.60 | 29.1 / 1.0 % | 11 | 4.9 % | 24,477 / 15,669 / 662 | 5.40 / 6.36 | 383/10/8/16 |
| patchSeason | 642 | 1.35, 1.24 | 35.5 / 2.6 % | 16 | 2.2 % | 17,600 / 11,306 / 0 | 5.86 / 6.24 | 452/36/9/5 |
| winterCost | 746 | 1.16, 1.19 | 31.9 / 0.8 % | 16 | 2.9 % | 15,129 / 12,926 / 514 | 6.25 / 6.37 | 577/25/16/14 |

What did what, on this one seed:
- **heal** carries the big bodies. Without it, cells in bodies of 10+ fall from 31 to 11 percent, none are in bodies of 20+, the
  largest at the end is 11, and shells and leaves die out.
- **steer** more than doubles feeding on crumbs (7,074 to 18,179 feeds on prey bodies of 1 to 4) and raises it on bodies of 5 to 12.
- **pack** at 6 more than doubles feeding on bodies of 5 to 12 (4,753 to 12,806). At pack 4, which the plan proposed, it did
  nothing: three mouths x 4 is 12, no more than the twice-the-size rule already allows. Feeding on bodies over 12 cells comes and
  goes by seed (0, 388, 366, 38 feeds). In tuning, pack 9 and 12 opened more of them but leaves died out on seed 1 (those tuning
  counts used the first, slightly wrong, feed measure).
- **crowd**: with it off, feeding on bodies of 13+ is 636 feeds instead of 0, and shells reach 0. Whether hunters spread out or
  pile up was not measured (no count of hunters per prey was run), so this says only where the feeding went, not why.
- **winterCost** is what makes the year: without it the swing falls from about 1.45 to 1.17, and the mean body size is the same
  in winter and summer (6.25, 6.37). With it, bodies are 10 to 16 percent smaller in the dark half of the year on every seed
  (5.26 to 5.86 against 6.21 to 6.57). **Winter now thins bodies, not only their number.**
- **patchSeason** adds a little swing (1.35, 1.24 without it). No run had it alone (leaf income follows the year in every run),
  so what it does on its own is not shown. A likely reason it does little: with patches not gated by the day band the
  reservoir runs near empty (about 1,000 to 4,000 in tuning), and then smaller winter patches mostly change when matter
  lands, not how much.
- **leafPool**: mixed. In tuning at pack 4 it roughly tripled leaves on seeds 1 and 2 (2.1 to 6.2 percent, 0.5 to 1.7). At the
  final settings on seed 1 leaves are 4.9 percent without it and 4.4 percent with it. Not shown to matter.
- Leaf income (tuning, seed 1, at pack 4; `runs/softroam/c3/ctl/`): at 1 leaves died out, at 1.3 and 2 they were 2 to 6 percent
  of cells. At the defaults, leaves reach 0 at some point after step 6,000 on seed 4.

## What is NOT shown, against the best case

- **Bodies of 20 or more are rare**: 0.1 to 1.5 percent of cells at the defaults, and the largest body at the end of year 3 is
  13 to 19. On seed 1 bodies of 20+ come in year 1 (largest 22) and last a few hundred steps into year 2 (a 21-cell body at step
  12,100), then are gone; bodies drift smaller over the years.
- **The big plans can release before they are whole.** The front spine cell enters its release loop once its own sides are in,
  while other cells may still be building. Codex grew a herd and a grove alone on thin food (20 a tile) and saw the first
  release at 11 cells. So the release cap (8) and the plan order do not hold a body back until it is grown, which is likely part
  of why bodies stay at 10 to 19. Release caps of 14 and 18 were tried in tuning and gave fewer releases without more big bodies.
- **Armour still holds against packs.** At the bodies start's crack (2,000) feeding on bodies over 12 cells does happen on 3 of
  4 seeds, but a short fixture at the seasons' crack (10,000) shows three mouths on a shell column crack nothing in 300 steps
  (one hit per mouth a step; 900 hits against 10,000 per shell). Bodies of 10 to 19
  are common (about 30 percent of cells). Gating patches by the day band too (chunk 2's starved economy) gave 8.7 percent in
  20+ on seed 1 but 1.8 on seed 2, with a third of the matter idle and leaves near 0, so it was not kept.
- Big bodies are several kinds, but mostly plain: 73 to 90 percent plain in bodies of 15+.
- **Leaves are still a few percent**: 0.9 to 4.4 percent of cells on the four seeds (chunk 2: 2 to 9), and 0 for a while on seed
  4. Ask 3 (leaves more than a few percent) is not met.
- **Armour is barely opened**: shells cracked are 0 to 2 per 1,000 steps on seeds 1 and 2 (`look-s*.log`, crack/k), so the
  feeds on bodies over 12 cells are on their plain cells, not through armour.
- **A hunter body visibly turning after prey: shown in a unit test** (a sideways 8-cell hunter turns, reaches and eats prey with
  steer, and drives past without). **Not judged by eye in the world runs.** The 90-step strip I looked at from seed 1's year 3
  shows slow bodies and no clear chase. The movies are there to watch.
- Prey turning away: unit test only.
- About 30,000 food (30 percent of the matter) lies on the ground uneaten in every run. Not explained: it is the same with steer
  off.
- Every number is one history per seed. Seeds 1 and 2 were tuned on; seeds 3 and 4 ran once. Nothing is registered. The first
  year starts in deepest winter with 120 founders, most of whom die.

## Known limits and choices

- `heal` keeps bodies joined by braces; a body still parts where no brace spans a hole, and a piece's head then restarts its plan
  (a cutting). A cell kept in by a brace keeps its mode and has no mother; it restarts if a later death makes it a head (Codex
  kernel review fix).
- `pack` counts distinct mouths in a chosen contact pair (four contacts a cell, as before), per stage and per grip substep.
- `crowd` counts mouths of other bodies within 1.25 D of a candidate, capped at 8.
- `leafPool` takes its share from upkeep and winter upkeep only, not from thrust. When the pool is full the rest goes to the
  reservoir. A pool with no leaves to pay holds up to its cap idle (2,000).
- Reviews: Codex Sol 6.1 High on the contract (6 findings: regrow dropped, standoff added, crowd pre-square bound kept, tests
  added); on the kernel diff (3 fixed: heal head restart, a stronger slot-order test with every key on, a distinct-mouth test
  that pair counting would fail); and on the surfaces and this note (8 findings: the feed measure fixed and rerun, the founder
  test now removes the founder and needs a descendant to release, an armour fixture added, a dial for the pool's cap added, and
  four claims here cut back to what the runs show; the early release is reported above, not fixed).
