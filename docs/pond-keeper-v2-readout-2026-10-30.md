# Pond keeper v2 readout: do the new rungs fire? (2026-10-30)

Companion to `docs/pond-keeper-v2-2026-10-17.md`, whose rules (`firsts-v2`, `families-v1`) are unchanged by this note. That note
fixed its thresholds as design choices. This readout checks that they are reachable in realistic play before the Stage 0a retest.
Observer only: no physics, pin or rule changes, all runs on the local GPU.

## Answer

**On the breeder, every new rung fires on every seed**, and the family tree splits, loses families to extinction, and (on two seeds)
sends some to film. **On `ponds-small`, only `outlive-wound` is earned.** `moving-pond`, `pond-change` and `new-family` are not
reached in 30,000 steps. Every rung fires on at least one run, so no rung is dead. One rung is never *earned*: **`long-body` fires as
"already there" at the first census (t=100) on all four runs**, because the planted discs, as they break up, already measure 3.1 to
3.95 times as long as wide. The family tree costs about half a millisecond per census, and no ledger record was dropped.

The brief said the v3 session fixture shows no outlived wound. It does show one: `outlive-wound` at t=1,500. It also has
`long-body` (already there) and `pond-change`. The fixture lacks `moving-pond` and `new-family`. Its own history earns both if it
is played to t=6,400 (below).

## How it was run

`tests/deno/pond_keeper_v2_readout.ts` plays a world headless in the lab's own traversal, as `sim.worker.ts` plays it:
`LabExecution` over a real `GpuSim`, a census every 100 steps, and the ledger drained before each census. Every census goes through
`openFirstsLog` and `feedCensus` from `apps/lab/src/firsts-log.ts`, the worker's own calls. Breeder mode is off, so each pond
boundary takes the arm's own donors at once. That is auto-breed with the dial at the world's own score and nothing kept.

**Check of the harness.** With the v3 fixture's one wound (t=500, centre (96, 96), radius 10), breeder seed 1 gives the fixture's
log of firsts entry for entry, details included. It also gives its 12 family-tree events, up to the fixture's final step, t=5,400.
So these runs are what the lab would show. The fixture's pick at t=5,000 is the rule's donors, so it changes nothing. This is confirmed through the first cycle only. Later cycles take the rule's donors as the lab's auto-breed does with no dial setting, by construction, but no lab session covers them.

**Wounds.** One wound every 5,000 steps: radius 10 (the v2 spec's), right after the census at `k × 5,000 + offset`, on the pond with
the most body cells at that census, centred on its largest body. The offset is 2,500 on the breeder (mid-cycle; H = 1,000). On
`ponds-small` it is 300: H = 500 there, and the clock must finish before the boundary at 1,000.

```bash
deno run -A --no-lock tests/deno/pond_keeper_v2_readout.ts --preset breeder --seed 1 --steps 30000 --offset 2500 --out DIR
deno run -A --no-lock tests/deno/pond_keeper_v2_readout.ts --preset ponds-small --seed 1 --steps 30000 --offset 300 --out DIR
deno run -A --no-lock tests/deno/pond_keeper_v2_readout.ts --preset breeder --seed 1 --steps 15000 --fixed "500:96,96,10" --out DIR
```

Each run takes 30 to 40 s on this machine and gives the same steps when run again. Output per run: `<run>.censuses.jsonl` (one
line per census: progress of the v2 rungs, tree summary, edges, drops, timings, the longest body) and `<run>.summary.json`.

## Steps at which each rung fired

| Run (30,000 steps) | moving-pond | long-body | pond-change | outlive-wound | new-family |
| --- | --- | --- | --- | --- | --- |
| breeder seed 1 | 6,300 | 100 (already) | 2,100 | 3,500 | 5,500 |
| breeder seed 2 | 8,200 | 100 (already) | 2,000 | 3,500 | 5,200 |
| breeder seed 3 | 11,800 | 100 (already) | 2,300 | 3,500 | 5,400 |
| ponds-small seed 1 | not reached (best 46 % of 50 %, t=28,700) | 100 (already) | not reached (best 3 of 5 censuses) | 800 | not reached (best 800 of 5,000 steps) |
| breeder seed 1, fixture's wound | 6,300 | 100 (already) | 2,100 | 1,500 | 5,500 |

What fired, in the log's own words (breeder seed 1):

- `pond-change` 2,100: lineage 0:5 led from t=100; lineage 1374:26656 ahead since t=1,700, in pond 5.
- `outlive-wound` 3,500: wounded at t=2,500 (radius 10, 136 cells lost), 18 bodies now, in pond 2.
- `new-family` 5,500: Poppy humble from Poppy, 1408 and 269 cells.
- `moving-pond` 6,300: pond 8, 2 of 2 bodies, 40 of 40 cells, moving.

On the breeder, `pond-change` and `new-family` behave more like clocks than feats. The change of hands is always the planted
founder lineage (key 0:n) giving way to a mutant lineage, around t=2,000. The first split comes 100 to 400 steps after the earliest it can
(t=5,100: watching from t=100, plus 5,000 steps). `outlive-wound` fires as soon as its clock allows: the wounded pond, the fullest
one, never ran out of bodies. `moving-pond` is the only new rung whose step varies widely (6,300 to 11,800).

## The family tree

| Run | named (starting + split) | split events | extinct | gone to film (families) | back from film | at t=30,000 |
| --- | --- | --- | --- | --- | --- | --- |
| breeder seed 1 | 29 (16 + 13) | 13 | 23 | 0 | 0 | 6 living, all Poppy |
| breeder seed 2 | 33 (16 + 17) | 17 | 30 | 6 | 1 | 2 living, 1 in film |
| breeder seed 3 | 31 (16 + 15) | 15 | 28 | 1 | 0 | 3 living, all Cedar |
| ponds-small seed 1 | 4 (4 + 0) | 0 | 3 | 0 | 0 | 1 living (Maple) |

Splits come in bursts just after the pond boundaries (seed 1: 5,500, 5,800, 5,800, 5,900, then 10,600, 11,200, …). Extinction
dominates: each cycle reseeds every pond from four donors, so by t=30,000 one root's genus holds every living family. "Gone to film"
does happen (seed 2: Poppy plain, Rush glassy, Sage downy at t=11,400–11,500; Rush glassy back at 12,800), but rarely, and never on
seed 1.

**No ledger record was dropped** on any run (85,000 to 91,000 edges by t=30,000 on the breeder; 439 on `ponds-small`), so the
tree never stopped.

## Cost of the tree per census

Milliseconds per census on this machine (heavily loaded), over the 300 censuses of each run. `observe` is `FamilyTree.observe`
alone. `input` is `buildFamilyInput`, which includes the per-cell lineage read that the log of firsts reuses. `feed` is the whole
`feedCensus`: tree and detector.

| Run | observe median / p95 / max | input median / p95 | feed median / p95 / max |
| --- | --- | --- | --- |
| breeder seed 1 | 0.62 / 1.79 / 3.4 | 1.33 / 2.45 | 2.6 / 5.6 / 7.3 |
| breeder seed 2 | 0.66 / 2.23 / 12.0 | 1.28 / 2.65 | 2.7 / 6.3 / 17.5 |
| breeder seed 3 | 0.43 / 2.02 / 8.4 | 0.98 / 3.05 | 2.0 / 7.0 / 15.3 |
| ponds-small seed 1 | 0.02 / 0.05 / 0.6 | 0.10 / 0.17 | 0.25 / 0.41 / 4.2 |

The cost does not grow with the genealogy: `observe` was 0.3 to 1.4 ms at t=30,000 with 63,000 to 91,000 edges, about what it was at
t=7,500. A census interval of the breeder (100 steps) took 100 to 125 ms of wall time here, so the tree is about 1 % of it and the
whole feed about 2 %.

## Rungs that are not earned: suggestions (not applied)

Every rung fired on some run, so no threshold is dead. These are offered as a possible new rule set. Nothing here changes
`firsts-v2`.

- **`long-body` (all four runs: already there at t=100).** At t=100 the longest body of 40+ cells measures 3.95, 3.11, 3.32 (breeder
  seeds 1–3) and 3.14 (`ponds-small`): planted discs pulled long as they break up. On the breeder the ratio first reaches 5 at
  t=3,800, 2,600 and 3,800, and 6 at 3,900, 2,600 and 3,800. Over the run it peaks at 9.3, 12.7 and 11.7. **Suggestion: in a
  `firsts-v3`, `longRatio` 5** (or 6), which every breeder seed earns in its first cycle. The highest first-census ratio in these four runs is 3.95, so 5 sits above it, but four samples are no bound. On
  `ponds-small` the ratio never passes 3.14 after t=100, and most of its censuses have no body of 40 cells. That is a quiet world,
  not a fault of the rung.
- **`ponds-small` is too short-cycled for two rungs.** A 1,000-step cycle has 10 censuses (b+100 to b+1,000), and leads start afresh
  each cycle. So, by the rule's wording, `pond-change` (5 censuses strictly ahead, then 5 for a later lineage) can fire only if one lineage
  strictly leads at the cycle's first five censuses and another at its last five, with no tie at any of them. Its best was 3 of 5. `new-family` needs one candidate's two halves at 16+ cells at every census
  for 5,000 steps, across five reseedings, at the base mutation rate (439 edges in 30,000 steps). Its best run was 800 steps.
  `moving-pond` came close (46 % of 50 %). If `ponds-small` is meant to be played, and not only tested, a later rule set could scale
  the `pond-change` streak to the cycle (for example, min(5, censuses per cycle / 4)). Nothing here asks for that change.

## A better fixture (proposal)

The v3 fixture's own history earns the two rungs it lacks if it plays on a little. That history is breeder seed 1, the wound at
t=500 at (96, 96) radius 10, and the rule's donors at t=5,000. Played on, it logs `new-family` at t=5,500 (Poppy humble from
Poppy), splits at 5,500, 5,800 and 5,800, and `moving-pond` at t=6,300. So this is the proposal:

- `tests/e2e/lab-pond-keeper-v2.spec.ts` with `BL_WRITE_FIXTURE=1` writes a second file, `pond-keeper-session-v3-long.json`, from the
  same session played to t ≥ 6,400. That is about 1,000 more steps of play. It checks that the log holds `new-family` and
  `moving-pond` and that the tree shows a split family.
- `tests/deno/pond_keeper_replay.ts` adds it to its defaults beside the v3 fixture, so `tools/run.ts --picks-from` replays it and
  confirms "matches the lab's checkpoint at t = …".
- The replay check matches the physics checkpoint, but not the log or the tree. `pond_keeper_v2_readout.ts --fixed` does that part:
  above, it rebuilt the v3 fixture's entries and family events exactly. It could become the replay check's second half: replay the
  file's lesions, then compare the file's `firsts.entries` and `families.events` with the ones it rebuilds.

The breeder's mid-cycle wound (t=2,500) gives every rung too, but the fixture's own wound already does, and a canvas click lands
more easily on (96, 96) than on a body's centroid.
