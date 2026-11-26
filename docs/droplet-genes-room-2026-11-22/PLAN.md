# Droplet genes, ROOM: is there a regime where a compartment holds many genes?

**Date:** 2026-11-22. **Key:** ROOM. **Branch:** `claude/dropgenes-room` from `0d3bb712`. **Builds on:**
[the first rung](../droplet-genes-2026-11-21/PLAN.md) ([results](../droplet-genes-2026-11-21/RESULTS.md)) and
[the heritable trait](../droplet-genes-trait-2026-11-21/PLAN.md) ([results](../droplet-genes-trait-2026-11-21/RESULTS.md)).
Also read, in other checkouts: FIRMUP-PLAN.md and FIRMUP-B-RESULTS.md (three genes, dose, the parts of `LARGE`)
and the LINKED2 calibration record (four unlinked genes at 64 sites).

**This is a screen, not evidence.** Every run is on seeds 1 to 4, which this world has been run on many times.
The unseen block reserved for a later confirmation is seeds 41 to 48. This line does not run it, and the driver
refuses any seed outside 1 to 4.

No dynamics change. `apps/lab/src/dropgenes/kernel.ts`, `observe.ts`, `experiments/dropgenes/run.ts` and
`sweep.ts` are used as committed at `0d3bb712` and are not edited. The only code is a new driver,
`experiments/dropgenes/room.py`, which starts `sweep.ts` one run at a time and reads the run files.
`summarize.ts` is not changed.

## Question

The number of genes K is a setting of a run. So far a gated compartment holds two genes against the parasite,
three thinly (3 of 4 seeds) and four never, and every four-gene test ran at the highest parasite dose
(`mutPar 1e-4`). Before building a genome that can grow: **does any regime of the existing kernel hold six or
more genes with a parasite source present?**

## The grid

- **Gene count K:** 2, 3, 4, 6, 8.
- **Physics:** `LARGE` (`diffT 0.1`, `diffW 0.03`, `diffF 0.6`, `diffA 0.44`) and **fuel only** (`diffT 0.1`,
  `diffF 0.6`, `diffA 0.44`, wall diffusion at the default 0.015), exactly as recorded for the first rung and
  for FIRMUP B3. Everything else is `defaultDropGenesConfig()`.
- **Sites per tile (`capPerTile`):** 16 and 64.
- **Parasite source A, a free parasite species** (the first rung's rule 5; first-rung kernel):
  `mutPar` 1e-4, 1e-5, 1e-6. Keys `a1e4`, `a1e5`, `a1e6`. Arms `GATED_PAR`, `UNGATED_PAR`.
- **Parasite source B, the ladder** (the trait line's rules; no separate parasite): `ladderLevels` 2,
  `mutLevel` 1/64 (0.015625) and 1/256 (0.00390625), every founder copy at level 0. Keys `b64`, `b256`. Arms
  `GATED_SEL`, `UNGATED_SEL`. **Added to the coordinator's grid before the first run:** `mutLevel` 1/4096
  (0.000244140625, 16 of the kernel's 65,536ths), key `b4096`; see "Why a third rate" below.
- **No parasite source:** `a0` is the first rung's `GATED_CLEAN` (`mutPar 0`). `b0` is the ladder world with
  `mutLevel 0` (arm `GATED_SEL`), in which no top-level copy can ever arise.
- 64 x 64, founders on the grid at spacing 16, two copies of each gene per wall tile, census every 50 steps,
  report row every 2,000 steps: the set-up `sweep.ts` always uses.

A **cell** is (parasite setting, physics, sites, K). A **group** is (parasite setting, physics, sites): 6 x 2 x 2
= 24 groups, each with five K (20 groups on the coordinator's grid, 4 for the added rate).

### Why two levels for source B, and what that makes it

The kernel refuses `genes * ladderLevels` above `DG_MAX_SPECIES` = 17 (`kernel.ts`, `dgLadderTables`; 17 is
`DG_MAX_GENES` + 1, the species count the per-species hash channels are laid out for). So:

| levels | largest K allowed | K of this grid allowed |
|---|---|---|
| 2 | 8 | 2, 3, 4, 6, 8 |
| 3 | 5 | 2, 3, 4 |
| 4 | 4 | 2, 3, 4 |
| 5 (the trait line's ladder) | 3 | 2, 3 |

Two levels is the only ladder that reaches K = 6 and 8, and it is used for every K. With two levels each gene
has a working form (level 0: copies at `kRep`, full function) and a parasite form (level 1: copies at
`2 * kRep`, no function). Known differences from source A, stated before the runs:

- **Dose is per new copy, not per tile per step.** A new copy of a working template is born as that gene's
  parasite with probability `mutLevel / 2` (1/128, 1/512 or 1/8192). Source A tries one origin per tile per
  step with probability `mutPar`. The two scales are not the same thing; a rough conversion is under "Why a
  third rate".
- **Back-mutation.** A new copy of a parasite template is born working with probability `mutLevel / 2`. Source
  A's parasite never reverts.
- **K parasites, not one.** Each gene has its own parasite form.
- **Service order.** A ladder world serves the species on a tile in a shuffled order (trait PLAN, rule 7); the
  first-rung kernel serves them in index order from a hashed start. Only the one-gene case is pinned equal. So
  the first rung's `GATED_CLEAN` is not source B's no-parasite world, and `b0` is run as its own arm.
- The trait line's results (five levels, a resting level of 3.16) do not carry over: there are no part-working
  levels here.

### Why a third rate

The brief gives 1/64 and 1/256. Two things seen before the first run say both may be far heavier than anything
source A tests, which would leave source B saying nothing about room:

- **Arithmetic.** At rest a copy is replaced about once per lifetime (`kDecT 0.02` per step), so a tile holding
  n working copies makes about `0.02 n` new copies a step and about `0.02 n * mutLevel / 2` parasite origins.
  With n = 10 that is 1.6e-3 per tile per step at 1/64 and 3.9e-4 at 1/256: 16 and 4 times source A's top dose
  (`1e-4`), at which four genes have never been held. At 1/4096 it is 2.4e-5, between source A's `1e-5` and
  `1e-4`.
- **The plumbing check** (listed under "Runs made before this plan was fixed"): at 2,000-step horizons the
  ladder world with K = 2, `LARGE`, 16 sites, 1/64, seed 1 ended at step 1,100, and one K = 2 fuel-only run at
  1/256 stood at a top-level share of 0.53 with 16 compartments at step 2,000.

So one lower rate is added, 1/4096, chosen by the arithmetic above and not tuned on any run: of the powers of
four below 1/256, 1/1024 comes to 9.8e-5, which is source A's top dose again (where four genes have never been
held), and 1/4096 to 2.4e-5, near the middle of source A's range. It is an addition by this line, not part of
the brief. **The outcome is named on the brief's grid alone** (20 groups); the same reading with the added
rate is given beside it and every table marks it. The added rate is run only after tiers 1 to 6 of the brief's grid
(see "Order"), so it cannot take budget from a cell of the brief that decides the outcome name or fills the
table. The two rates
of the brief are run as given.

## Readouts and labels, fixed before the first run

**Held, one run** (the first rung's rule, unchanged): over the last tenth of the planned run the mean number
of compartments is at least 10 and at least half of them are complete. Complete means at least one copy of
every gene; in a ladder world, at least one **working** (level 0) copy of every gene. The driver recomputes the
flag from the run's two late figures and refuses a file where they disagree.

**Late parasite share, one run:** the mean of `rows[].parasiteShare` over the report rows of the last tenth
(ten rows at 200,000 steps), as `summarize.ts` prints it. It is the share of all template copies in the arena
(compartments, rim and bare tiles) that are the parasite (source A) or at the top level (source B; `run.ts`
fills the same field), so one definition serves both sources.

**Late level, one run (source B):** `summary.ladder.lateLevelMean`, the mean ladder level of copies inside
compartments over every census of the last tenth. With two levels this is the share of those copies that are
parasite forms.

### Guard against an empty pass

A cell can be held with the source switched on only because the parasite never got going. So a seed counts
only if it **holds against the parasite**: it is held, and

- **source A:** its late parasite share is at least **0.005**;
- **source B:** its late parasite share is at least **the larger of 0.005 and `mutLevel`** (0.015625 at 1/64,
  0.005 at 1/256 and at 1/4096), **and** its late level is at most **0.5** ("the genes still work": the level sits at least
  0.5 below the top level of 1, so at least half of the copies inside compartments are working forms, and the
  compartments are complete in the ladder's sense because the run is held). The floor is read first: a held
  seed that fails both is counted as below the floor.

Why these numbers (all from records made before this plan; no run of this line was used):

- Source A, gated, held, two or three genes, late share per seed: 0.101 to 0.160 at `1e-4` (first rung seeds
  5 to 8; FIRMUP seeds 9 to 12, `LARGE`, fuel only, K = 3); **0.008, 0.012, 0.014, 0.020 at `1e-5`**, where the
  ungated twin was lost on 4 of 4 seeds, so the parasite there ends a world that does not contain it;
  **0, 0.00004, 0, 0.0004 at `1e-6`**, where the parasite was present on 19 to 24 of 100 report rows and the
  ungated twin was held on 4 of 4. The floor 0.005 lies between the last two: it is 12 times the largest share
  recorded where the parasite did not get going and 0.6 of the smallest share recorded where it demonstrably
  mattered. Placing it nearer the tested side means a cell must show a share close to one already known to be
  dangerous.
- Source B has no such record at two levels. Fresh mutants alone, never copied again, would make a standing
  share of about `mutLevel / 2` (a new copy lasts as long as any other). The floor is twice that, `mutLevel`:
  at or above it at least half of the parasite forms are there because parasites were copied, not because
  they were just made. Source A's floor is kept as a minimum.
- The ceiling 0.5 mirrors the held rule's "at least half complete". For comparison, the trait line's gated
  world rested with about a fifth of its copies at the top level, and source A's held worlds carry 0.10 to 0.16.

The guard is read at the frontier stage only (200,000 steps), never at 50,000 steps.

**Cell labels at the frontier stage** (gated arm with the source, seeds 1 to 4, 200,000 steps):

| label | rule |
|---|---|
| **held, parasite in effect** | at least 3 of the 4 seeds hold against the parasite |
| **held, parasite absent in effect** | at least 3 of 4 seeds held, fewer than 3 hold against the parasite, and every held seed that does not is below the floor. **Does not count as holding against a parasite.** |
| **held, level above the ceiling** | the same, where every held seed that does not hold against is above the ceiling (source B). Does not count. |
| held, guard not met (mixed) | the same, with both reasons among the seeds. Does not count. |
| **not held** | at least 2 of the 4 seeds not held |

"Held" for a cell is 3 of 4 seeds, as in the first rung. A cell's own no-source arm is reported beside it and
is not part of the label; a cell held with the source whose no-source arm is not held is flagged as unexpected
and still counts.

**Where a run was lost** (a run that is not held): **at the founders** if it ended (no wall left) by step
1,000; **early** if it ended by step 10,000; **late** if it ended after that; **below the bar at the end** if
it reached the last step.

**Copies per gene per compartment:** late copies per compartment (mean of `rows[].meanCopies` over the late
report rows; all species, inside compartments) x (1 - parasite share) / K. For source B the share is the late
top-level share inside compartments (`lateTopShare`). For source A the run file has only the arena-wide share,
so the figure is approximate there. `run.ts` writes no per-species count inside compartments and may not be
edited.

## Stages

Every run is gated unless it says ungated.

### Stage 1: clean gate

Each (source, K, physics, sites) with no parasite source (`a0` for source A, `b0` for source B), seeds 1 and
2, 50,000 steps: 40 cells, 80 runs. **A cell goes on only if both seeds are held.** Source A cells go on by
`a0`, source B cells by `b0`.

### Stage 2: parasite screen

Each cell that passed its gate, at each parasite setting of its source (three doses for A, three rates for B),
seeds 1 and 2, 50,000 steps: at most 240 runs. **A cell is dropped if neither seed is held; it is alive after
stage 2 if at least one is.**

### Stage 3: the frontier

For each group, the cells run are the **largest K alive after stage 2** and **the K just above it** on the
ladder 2, 3, 4, 6, 8 (K = 2 if nothing is alive; nothing above K = 8). For each: seeds 1 to 4, 200,000 steps,
with the source and without (`a0` or `b0`; one no-source cell serves every dose or rate of its source).

- **Carry-over.** A gated seed whose 50,000-step run of the same configuration ended early (no wall left) is
  not run again: a 200,000-step run is the same computation up to that step and stops there, so it is counted
  as not held, lost at that step, and marked "carried". `room.py check` re-runs up to two such seeds at 200,000
  steps and stops the line if they do not end at the same step with the same tracker counts.
- **Step down.** If the largest alive K has two seeds not held, the next lower K that was alive after stage 2
  is run the same way, and so on down that chain, until a cell of the chain is held (3 seeds held) or K runs
  out. What the K just above does has no bearing on the step down. No step down is made from a cell that is
  held but does not count (parasite absent, or level above the ceiling): if no cell of the group is "held,
  parasite in effect", that group's entry is then **"not established"**, which is not the same as "none", and
  the group is left out of the in-effect column of the factor comparison.
- **Step up.** As soon as the highest K run in a group has three seeds held, the next K above it is run too.
- **Ungated.** For every frontier cell held on 3 of 4 with the source (whatever its guard label): the ungated
  arm with the source, seeds 1 to 4, 200,000 steps. Reading per cell: **the gate is needed** (ungated held on
  at most 1 of 4), **the gate is not needed** (at least 3 of 4), unclear (2 of 4).

**Order, which is also the order of cuts.** The brief's grid goes first at every stage: stage 2 and tiers 1
to 6 of stage 3 for the brief's settings, then stage 2 for the added rate (`par-added`, which refuses to start
earlier), then its tiers. Before every launch the driver re-reads what is due and starts the first run of the
lowest tier, so a cell added by a step up or step down takes its place as soon as the seed that triggers it
has finished. Within a tier: larger K first, then source A before B, higher dose or rate first, 64 sites
before 16, `LARGE` before fuel only, then seed.

| tier | which cells | arm |
|---|---|---|
| 1 | the brief's grid, frontier cells with K of 4 or more that could still be held | with the source |
| 2 | the same cells | without the source |
| 3 | those of them that are held | ungated, with the source |
| 4 to 6 | the brief's grid, K of 3 or less | as tiers 1 to 3 |
| 7 to 9 | the added rate, K of 4 or more | as tiers 1 to 3 |
| 10 to 12 | the added rate, K of 3 or less | as tiers 1 to 3 |
| 13 | cells that could never be held because seeds 1 and 2 were both carried over as lost | seeds 3 and 4 with the source, and the no-source arm; where-lost detail only |

A no-source cell shared by several doses or rates takes the earliest tier any of them gives it. A cell added
by a step up or step down takes the tier of its own K.

A run is started only if the steps actually run so far, plus the full length of every run in flight, plus its
own full length, fit in the budget; while runs are in flight the driver waits for them before it decides that
the budget is reached. Whatever is not run then is **cut**, and the write-up lists it. Only one driver runs at
a time (a lock file), and it refuses to start while a `sweep.ts` or `run.ts` of this checkout is alive
(started by absolute path, or by a relative path from inside this checkout), so there are never more than four
runs.

The outcome name is **determined** when, on the brief's grid, no frontier cell with K of 4 or more is open and
no open cell is the highest K run in its group (held, it would trigger a step up, and a step up from K = 3
adds a K = 4 cell in tier 1). This holds for "room found" too: until then K* could still rise. A cell is open while it has neither two seeds not held nor a label. If the
budget is reached before that, the outcome is reported as not determined and the coordinator is asked; no K of
4 or more is dropped silently.

## Outcome names (exactly one applies)

Let K* be the largest K, over the 20 groups of the brief's grid, of a frontier cell labelled **held, parasite
in effect**. The same is computed over all 24 groups and reported beside it as "with the added rate"; it does
not change the outcome name. The added rate's stage 2 and tiers come after tiers 1 to 6 of the brief's grid, so
they can take budget only from tier 13.

- **Room found:** K* is 6 or 8.
- **Limited room:** K* is 4 (5 is not on the grid).
- **No room:** K* is 3, 2 or none, with the outcome determined in the sense given under "Order". A group that
  reads "not established" counts as none for K*; such groups are listed with the outcome.

Reported either way: for every group the largest K held, the largest K held with the parasite in effect, every
cell's label, and the clean-gate result for every K beside it, so it can be seen whether a group's limit is
the parasite (the K above passes the gate without the source and is lost with it) or the compartments' own
capacity (the K above fails the gate).

## Also reported

- Per held frontier cell and seed: late compartments, complete share, copies per compartment, copies per gene
  per compartment, late parasite share (and late level for source B), and the same against K from the stage 1
  and stage 2 runs (the first rung's reading was that copies per gene fall as 1/K).
- Where each lost run was lost, by the classes above.
- **Which single factor moved the frontier most.** A group's frontier is put on the ladder none, 2, 3, 4, 6, 8
  (rungs 0 to 5). For each factor, groups that differ in that factor only are paired: dose `1e-4` to `1e-6`
  within source A (4 pairs; the two single steps are tabled beside it), rate 1/64 to 1/256 within source B
  (4 pairs), physics `LARGE` to fuel only (10 pairs), sites 16 to 64 (10 pairs), all on the brief's grid; the
  added rate's pairs are tabled apart and do not enter the naming. The factor named is the one
  with the largest mean absolute change in rungs of **the largest K held** (with the source on, whatever the
  guard says), because the guard turns a low dose into "none" by definition; the same figure for "held,
  parasite in effect" is tabled beside it. A pair with an open cell is left out and counted; a cell closed by
  two losses keeps its label even if its other seeds were cut (it could not be held). A tie, or no change
  anywhere, is reported as no single factor.

## Budget

**25 core-hours, counted as 31,500,000 simulated steps.** Recorded full-length runs of this world took 290 to
540 steps per second of one core (first rung, FIRMUP; medians 350 to 417); 25 core-hours at 350 steps a second
is 31.5 million steps. Steps are used because the machine is saturated today (0.1% idle): the timing smoke
runs below got 131 to 141 steps a second with four at a time and 281 alone, so wall seconds are not core
seconds. The driver also records wall and CPU seconds of every run.

| stage | runs | steps, upper bound | expected |
|---|---|---|---|
| 1, clean gate | 80 | 4.0 million | about 3 million (K = 8 at 16 sites died at the founders in the first rung) |
| 2, parasite screen | at most 240 | 12 million | 4 to 7 million (lost runs end early) |
| 3, frontier | set by the order above | the rest of the budget | about 21 million: about 105 full-length runs |

Stage 2's added rate is at most 40 of those 240 runs (2 million steps).

At most four runs at a time. At today's speeds a 50,000-step run takes 3 to 6 minutes and a 200,000-step run
12 to 26 minutes; the whole budget is 5 to 16 hours of wall time. A background command is stopped at two
hours, so the driver starts no new run after 80 minutes and is invoked again; it refuses to start while a
`run.ts` of this checkout is still alive.

## Commands

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
python3 experiments/dropgenes/room.py list     # the grid and the sweep.ts options of each setting
python3 experiments/dropgenes/room.py gate     # stage 1; invoke again until "nothing left to run"
python3 experiments/dropgenes/room.py par      # stage 2
python3 experiments/dropgenes/room.py check    # carry-over check
python3 experiments/dropgenes/room.py front    # stage 3, in tier order (the brief's grid)
python3 experiments/dropgenes/room.py par-added  # stage 2 for the added rate, then `front` again
python3 experiments/dropgenes/room.py table --md docs/droplet-genes-room-2026-11-22/TABLES.md \
  --json docs/droplet-genes-room-2026-11-22/room-summary.json
python3 experiments/dropgenes/room.py budget
```

Run files: `runs/dropgenes/room/<a|b>-<gate-50k|par-50k|front-200k>/<physics>-<setting>-K<K>-cap<sites>-<ARM>-s<seed>.json`
(not in git). One example of what the driver starts (source B, `b64`, fuel only, K = 6, 64 sites, seed 3):

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/room/b-front-200k --genes 6 --caps 64 \
  --seeds 3 --steps 200000 --mutPar 0 --jobs 1 --arms GATED_SEL --tag fuel-b64 \
  --ov '{"diffT":0.1,"diffF":0.6,"diffA":0.44}' --levels 2 --mutLevel 0.015625 --startLevel 0
```

Before any file is read for a decision the driver checks its whole configuration (defaults read from the
kernel), the set-up record, the horizon, the label, the ladder record and a residual of 0, and stops on any
difference.

## The pre-confirmation boundary

If the outcome is room found or limited room, one regime is frozen here for a later confirmation and nothing
above seed 4 is run by this line.

- **The regime:** the cell of the brief's grid with K = K* (4 or more) labelled held, parasite in effect. Ties: more seeds
  holding against the parasite, then more late compartments (mean over those seeds). If the added rate holds
  a larger K than the brief's grid, that cell is named beside it as a second candidate for the coordinator to
  choose from; it is not frozen by this line.
- **Confirmation runs (not run here):** unseen seeds 41 to 48 in two blocks of four (41 to 44, 45 to 48),
  200,000 steps, three arms: gated with the source, gated without, ungated with the source.
- **Pass rule, fixed now:** "holds against the parasite" for a seed is as defined above, with the same floor
  and ceiling. **Confirmed:** the gated arm with the source holds against the parasite on at least 3 of 4
  seeds in each block. **Not confirmed:** fewer than 3 of 4 in a block that was run. If only the first block
  is run the result is stated for that block alone and called half the confirmation. No seed is replaced; a
  non-zero residual is a failure of the line.
- **Reported, not pass conditions:** the no-source arm (held on 3 of 4 per block, or flagged) and the ungated
  arm (gate needed, not needed, unclear, per block).
- The exact commands and run times are written under "Frozen regime" below once the regime is known.

## Runs made before this plan was fixed

Five smoke runs with `run.ts` directly, seed 1, 64 x 64, no output file, to time the kernel and to see that
the options are accepted. Only the residual, the speed and the number of steps run were printed.

| run | steps | what was seen |
|---|---|---|
| first-rung kernel, K = 2, 16 sites, `LARGE`, no source | 2,000 | residual 0, 141 steps a second (four at a time) |
| first-rung kernel, K = 8, 64 sites, `LARGE`, no source | 2,000 | residual 0, 131 steps a second |
| ladder, two levels, `mutLevel` 1/64, K = 8, 64 sites, fuel only | 2,000 | residual 0; **the run ended at step 500** (no wall left) |
| first-rung kernel, K = 4, 64 sites, fuel only, `mutPar 1e-4` | 2,000 | residual 0, 131 steps a second |
| first-rung kernel, K = 2, 16 sites, `LARGE`, no source | 4,000 | residual 0, 281 steps a second (alone) |

The third run says that K = 8 at 64 sites under fuel only, in a ladder world, died at the founders on seed 1.
It mixes the physics with the kernel path and was not followed up outside the protocol; stage 1 runs that cell
without a source in both kernels. No setting, floor or rule was chosen from these runs.

After this plan was first written and before its review, a plumbing check of the driver was made in a scratch
directory: the whole protocol with horizons of 2,000 and 4,000 steps in place of 50,000 and 200,000
(`ROOM_BASE`, `ROOM_TEST_STEPS`; seeds 1 to 4; files outside `runs/`). What was looked at: exit codes, the
number of runs and failures per stage, the tier counts of the dry listing, the last lines of each log, and the
tables' shape. Two outcomes were seen in those lines and are stated because they bear on the grid: the
carry-over check picked the ladder world K = 2, `LARGE`, 16 sites, `mutLevel` 1/64, seed 1, which **ended at
step 1,100**; and the last line of the stage 2 log was the ladder world K = 2, fuel only, 16 sites, 1/256,
seed 2, at **top-level share 0.53 with 16 compartments at step 2,000** (its no-source twin had 83). The third
rate was added after seeing these (see "Why a third rate"). The tables printed from those scratch files were
read for their shape; their figures are from the first 4,000 steps of a run and are not results. No floor,
ceiling or label was changed after the check; the stage rules changed only as the review table below lists.
The check ran 541 short runs (1.4 million steps) and none failed.

Known from other lines before the runs (all on other seeds unless said): `LARGE`, 16 sites, `1e-4`: K = 2 held
on 12 of 12 seeds, K = 3 on 3 of 4, K = 4 on 0 of 4; without the source K = 4 held on 4 of 4 with 12 to 14
compartments and K = 8 died at the founders. `LARGE`, 64 sites, K = 4: without the source 4 of 4 with about 41
compartments, with `1e-4` 0 of 4 (seeds 1 to 4, ended at step 5,750 to 15,200). `LARGE`, K = 8, 64 sites,
without the source, seeds 1 and 2: ended at step 23,900 and 24,200. Fuel only, 16 sites, K = 2, `1e-4`: held on
4 of 4 with about 62 compartments. `LARGE`, 16 sites, K = 2: `1e-5` held on 4 of 4 gated and 0 of 4 ungated;
`1e-6` held on 4 of 4 both ways.

## Limits known before the runs

- Seeds 1 to 4, all seen; two seeds decide stages 1 and 2. A cell that fails its gate on one seed of two is
  out, although it could have been held on 3 of 4.
- One arena size, 200,000 steps. "Held" at 200,000 steps does not make a cell stable (the first rung's
  default-physics cell held on one seed and was lost at steps 13,050 to 106,200 on the others).
- The grid's K ladder has gaps (5 and 7 are not run), so "largest K held" means largest on the ladder.
- Source A's dose is per tile, so the pressure per copy falls as sites rise; source B's is per new copy. A
  comparison across sites or across sources mixes these.
- The floor is a judgement fixed in advance from two recorded doses at K = 2 and 16 sites. Shares at other
  K, sites and physics may sit differently; every share is reported so the label can be re-read.
- No step down is made from a held cell that does not count, so a group can end with "not established".
- Tracker counts depend on the 50-step census. CPU reference only.

## Changes after this plan was first written

(Each change is dated and says whether any run had been made. A copy of the plan as it stood before the
first run of stage 1 is kept in `runs/dropgenes/room/`.)

**2026-11-22, before any run of the protocol** (only the smoke runs and the plumbing check above existed):

1. The third ladder rate `b4096` was added (see "Why a third rate"), after the plumbing check.
2. First Codex review (Sol 6.1, High, read-only) of the plan and driver. Findings and what was done:

| finding | severity | what was done |
|---|---|---|
| A step up needed all four seeds while the label needed three, so an unfinished fourth seed could let the table name an outcome a step up might still change | P1 | Step up now fires at three seeds held; the cell it adds is open, and an open cell of K 4 or more, or an open highest cell, keeps the outcome "not determined" |
| The added rate could set the outcome name and take budget from the brief's grid | P1 | The outcome is named on the brief's 20 groups; the added rate is reported beside it and runs after the brief's grid at each stage (tiers 4 to 6 and 10 to 12) |
| Nothing stopped two driver invocations running eight simulations between them | P1 | A lock file allows one driver per output directory; it also refuses while a `sweep.ts` or `run.ts` of this checkout is alive |
| The step down stopped when the K just above was held, which the plan did not say | P2 | The step down now follows its own chain only, as written |
| A source B seed could fail floor and ceiling at once, matching two labels | P2 | The floor is read first; stated |
| Runs that ended early kept their full length reserved, so the budget gate could stop too soon | P2 | The gate now uses steps actually run plus runs in flight |
| "Not established" was printed and compared as "none" | P2 | Printed as "not established"; such pairs are left out of the in-effect factor figure and counted |
| The reason given for 1/4096 over 1/1024 was wrong arithmetic | P2 | Corrected: 1/1024 comes to source A's top dose, 1/4096 to the middle of its range |

3. Second Codex pass on the fixes, also before any run of the protocol: no P1. What was done:

| finding | severity | what was done |
|---|---|---|
| The added rate's tiers and its stage 2 still came before the brief's K of 3 or less | P2 | The whole of the brief's grid (stage 2, tiers 1 to 6) now comes first; the added rate's stage 2 is its own mode and refuses to start earlier |
| A step up waited for the rest of its tier's batch | P2 | What is due is re-read before every launch |
| A reservation held by a run that then ended early could stop the driver on "budget" for good | P2 | The driver waits for runs in flight before deciding the budget is reached |
| "Room found" was exempt from "not determined"; a regime to confirm was printed for "no room" | P2 | Not exempt; a regime is named only for K* of 4 or more, and a second candidate only if the added rate holds a larger K |
| The orphan check missed a `run.ts` started by a relative path | P2 | It now also reads the working directory of any `dropgenes/run.ts` or `sweep.ts` process |
| A cell closed by two losses with its other seeds cut still enters the factor comparison | P3 | Kept, and the plan now says so (such a cell cannot be held) |

**2026-11-22, during stage 3** (after the first `front` invocation: tiers 1 and 2 and part of tier 3 run):

4. The driver gained `ROOM_MAX_TIER`. As first written, `front` would have gone on into tier 13 before the
   added rate's screen existed, against the order above (the added rate before tier 13). The second and later
   `front` invocations for the brief's grid were made with `ROOM_MAX_TIER=6`. No rule, label or order changed.

5. **After the frontier runs, before the write-up** (driver only; no rule, label, floor or order changed):
   - `table` treated the brief's groups as not ready while the added rate's screen had not been run, and
     printed an empty frontier; it now reads each group's own stage 2.
   - A run that is "held" by the rule although it ended inside its late window is now marked as such in the
     tables (one ungated run; see RESULTS.md).
   - `confirm-read` was added: it reads a confirmation directory made with `sweep.ts` and applies the pass
     rule below. It starts no run. It was tested on copies of the seed 1 to 4 files of the frozen regime.
6. **Cuts.** The step budget was reached with 31,382,000 steps run. 66 runs were not started: tier 12 (12 runs)
   and tier 13 (54 runs). They are listed in RESULTS.md. Nothing in tiers 1 to 11 was cut.

7. **Final Codex review (Sol 6.1, High, read-only) of the finished state.** It recomputed every stage decision,
   all 39 frontier-cell labels, the 24 group frontiers, the factor comparisons, the outcome name, K* and the
   regime to confirm from the raw run files with its own script, and they agree with the driver; it confirmed
   435 files, residual 0, seeds 1 to 4 only, 31,382,000 steps, the 66 cuts as tiers 12 and 13, the prelaunch
   hashes, and an empty diff on the protected code. Findings and what was done:

| finding | severity | what was done |
|---|---|---|
| `confirm-read` accepted any seed list in multiples of four, so it could print a verdict from repeated or seen seeds | P1 | It now accepts only 41 to 44 or 41 to 48 in order; 1,2,3,4 is a self-test that prints no verdict |
| Nine figures in RESULTS.md were rounded twice (off by one in the last digit) | P2 | Corrected from the raw values |
| Three ranges in RESULTS.md were loose (a combined range, "1 to 4%" for all `1e-5` cells, the four-gene cell's compartments with and without the source) | P2 | Corrected or split |
| One loss at step 950 was listed as early, not at the founders; one below-the-bar stage 2 run was left out | P2 | Corrected and added |
| Three readings said more than was run: the ungated loss was put down to the parasite without an ungated no-source control at six genes; "count reaching zero" left out the below-bar survivors; "alive at the end" misdescribed held | P2 | Reworded to what was observed |
| "Every held ladder seed" should say seeds of held cells | P3 | Reworded |

   A short follow-up pass on these fixes found no P1 and four P2, all taken: `confirm-read` ignored a
   complete second block when the first was incomplete (a complete block under 3 of 4 now gives "not
   confirmed" whichever it is, and an incomplete block is never read); it printed a missing control arm as
   "0 of 4" (it now says how many were run); and two sentences of RESULTS.md still put the ungated losses at
   `1e-6` down to the parasite or called them deaths where two runs reached the end (reworded).

8. **Last revision of RESULTS.md** (after a second reviewer's read, no run made): the reading "copies per gene
   do not fall as 1/K" was wrong as stated. Per tile they do (the per-tile table was added); per compartment
   they do not, because compartments grow in area. The ungated twin is no longer given as support for the
   guard (no ungated no-source control was run at six genes). The six-gene ceiling is described as the edge
   of the grid's site axis. The cost of the added rate against the tier 13 cuts is stated. **Recommended to
   the coordinator, not done here:** add `UNGATED_CLEAN` as a reported arm when the frozen regime is
   confirmed, so the ungated reading can be told apart from ungating alone. The pass rule does not use it.

9. **Coordinator's pass, 2026-11-22** (after the line reported; no run made, no label or outcome changed). A
   Codex review (Sol 6.1, High) of the final state recomputed the outcome, all 24 group frontiers and the 39
   frontier-cell labels from the raw files and agreed, and found two P1 and four P2, all taken:
   - `confirm-read` followed the plumbing-test switch, so it could print a verdict on shortened runs. It now
     refuses that switch and has its own fixed horizon of 200,000 steps.
   - It averaged whichever late report rows were present. A full-length run must now carry every report row
     (one every 2,000 steps), and so all ten late rows.
   - It gave a verdict for any cell of the grid. Seeds 41 to 48 are now read for the frozen regime only; any
     other cell can be read on seeds 1 to 4 as a self-test, which never gives a verdict.
   - RESULTS.md: "tiles covered" recomputed row by row (it had multiplied two separate means; the fall with K
     is unchanged); the "factor of 2 to 8" margin now names the 0.005 floor; the ladder's loss times at the
     brief's two rates are given in full; the clean eight-gene count is 20 of 20, 16 of them in stage 1.

## Frozen regime

Written 2026-11-22 after the screen; no seed above 4 has been run by this line. The outcome on the brief's
grid is **room found**, K* = 6, with two cells at that K labelled held, parasite in effect, both on 4 of 4
seeds. By the tie rule (more late compartments: 28.8 against 19.5) the regime frozen is:

| | |
|---|---|
| parasite source | A, free parasite, `mutPar 1e-5` (key `a1e5`) |
| physics | fuel only: `diffT 0.1`, `diffF 0.6`, `diffA 0.44`; everything else `defaultDropGenesConfig()` |
| genes, sites | K = 6, `capPerTile` 64 |
| arena, horizon | 64 x 64, 200,000 steps, `sweep.ts`'s set-up (founders on the grid at spacing 16, two copies per gene per wall tile, census every 50 steps, report row every 2,000) |
| arms | `GATED_PAR` (decides), `GATED_CLEAN`, `UNGATED_PAR` (reported) |
| seeds | 41 to 44 (block 1), 45 to 48 (block 2); unseen |

The other candidate, the same cell at `LARGE`, is not frozen and is not part of the confirmation. The added
rate holds no larger K, so there is no second candidate from it.

**Pass rule** (as fixed above, restated for this regime). A seed **holds against the parasite** if its
`GATED_PAR` run is held (late mean of at least 10 compartments, at least half complete, over steps 180,001 to
200,000) and its late parasite share (mean of `rows[].parasiteShare` over the ten report rows of steps 182,000
to 200,000) is at least 0.005. **Confirmed:** at least 3 of 4 seeds in each block. **Not confirmed:** fewer
than 3 of 4 in a block that was run. One block alone is half the confirmation. No seed is replaced; a
non-zero residual is a failure of the line. Reported beside it per block: `GATED_CLEAN` held on how many of 4;
`UNGATED_PAR` held on how many of 4 (gate needed: at most 1; not needed: at least 3; else unclear).

On seeds 1 to 4 this regime read: `GATED_PAR` 4 of 4 (26.9 to 32.0 late compartments, share 0.015 to 0.038),
`GATED_CLEAN` 4 of 4 (30.5 to 33.7), `UNGATED_PAR` 0 of 4 (ended at step 2,050 to 2,500).

**Commands** (not run; the coordinator releases them). `room.py` refuses seeds above 4, so the runs are made
with `sweep.ts` directly, and `room.py confirm-read` only reads them.

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
OV='{"diffT":0.1,"diffF":0.6,"diffA":0.44}'

# Block 1: seeds 41 to 44 (12 runs)
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/room/confirm --genes 6 --caps 64 \
  --seeds 41,42,43,44 --steps 200000 --mutPar 1e-5 --jobs 4 --arms GATED_PAR,GATED_CLEAN,UNGATED_PAR \
  --tag fuel-a1e5 --ov "$OV"
python3 experiments/dropgenes/room.py confirm-read --dir runs/dropgenes/room/confirm --setting a1e5 --phys fuel \
  --K 6 --cap 64 --seeds 41,42,43,44

# Block 2: seeds 45 to 48 (12 runs), run whatever block 1 showed
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/room/confirm --genes 6 --caps 64 \
  --seeds 45,46,47,48 --steps 200000 --mutPar 1e-5 --jobs 4 --arms GATED_PAR,GATED_CLEAN,UNGATED_PAR \
  --tag fuel-a1e5 --ov "$OV"
python3 experiments/dropgenes/room.py confirm-read --dir runs/dropgenes/room/confirm --setting a1e5 --phys fuel \
  --K 6 --cap 64 --seeds 41,42,43,44,45,46,47,48
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/room/confirm --json   # the same figures, independently
```

That the first command is this screen's configuration was checked without running anything: pointed at
copies of the twelve seed 1 to 4 files of this cell with `--seeds 1,2,3,4`, `sweep.ts` (which compares the
whole effective configuration, the set-up and the horizon) reported "0 runs to do". `confirm-read`
was run on the same copies as a self-test (it read 4 of 4, 4 of 4 and 0 of 4 and printed no verdict).

**Run time.** In this screen the gated six-gene runs at 64 sites took 417 to 523 seconds each with four at a
time on a busy machine (about 380 to 480 steps a second), and the ungated ones ended within 2,500 steps. A
block is 8 full-length runs and 4 short ones: about 1.3 core-hours, about 20 minutes of wall time at four at a
time. Both blocks: about 2.6 core-hours. Each block fits well inside one two-hour background command; if one
is stopped, the same command resumes it (check first that no `run.ts` of this checkout is alive).
