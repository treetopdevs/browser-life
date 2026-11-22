# Droplet genes, firm-up: plan and pre-stated rules

**Date:** 2026-11-21. **Key:** FIRMUP. **Branch:** `claude/dropgenes-firmup` from `c60d2e5a` (main plus the
droplet-genes sandbox commit). **First rung:** [PLAN.md](./PLAN.md), [RESULTS.md](./RESULTS.md),
[TABLES.md](./TABLES.md).

This line changes no dynamics. The kernel and observer in `apps/lab/src/dropgenes/` and the runner
`experiments/dropgenes/run.ts` are used as committed. The only code change is in `experiments/dropgenes/summarize.ts`: one added table
(compartment properties) and an opt-in per-seed table (`--per-seed`); its existing tables are unchanged.

## Why

The first rung's result stands on one setting, `LARGE`: two genes with the parasite were held on 0, 1 and 0 of
4 seeds at the default compartments and on 4 of 4 at `LARGE`, where the ungated twin held on 0 of 4. `LARGE`
was chosen on seeds 1 to 4 and confirmed on seeds 5 to 8 only. Part A repeats that one comparison on eight
seeds this world has not been run on. Part B is planned here and not run.

Seeds 1 to 8 are seen. Before this plan was written, the recorded seed of every run file under
`runs/dropgenes/` in every worktree of the repository was read: 509 files, seeds 1 to 8 only (one file could
not be parsed as JSON). No run of this world on seeds 9 to 16 existed.

## The setting

`LARGE`, exactly as recorded in `summary.config` and `summary.protocol` of the first rung's
`confirm-v3/large-K2-cap16-GATED_PAR-s5.json`:

- 64 x 64, 200,000 steps, `genes 2`, `capPerTile 16`, `diffT 0.1`, `diffW 0.03`, `diffF 0.6`, `diffA 0.44`,
  `mutPar 1e-4` in the parasite arms and 0 in the clean arms, `kRepPar 0.4` (twice `kRep 0.2`), everything
  else `defaultDropGenesConfig()`;
- founders on a grid at spacing 16, 2 copies of each gene seeded per wall tile, census every 50 steps, report
  row every 2,000 steps, heredity read 500 steps after the split.

The command that produces it (`<seeds>` and `<dir>` vary):

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir <dir> --genes 2 --caps 16 --seeds <seeds> \
  --steps 200000 --mutPar 1e-4 --jobs 4 --tag large --ov '{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44}'
```

Two checks that this command is the first rung's, both made before any run on seeds 9 to 16 (outcomes are in
[FIRMUP-RESULTS.md](./FIRMUP-RESULTS.md)):

1. Configuration: `sweep.ts` refuses an existing file whose whole effective configuration, protocol or step
   count differs from the request. The 16 recorded `LARGE` two-gene files of seeds 5 to 8 were copied to a
   scratch directory and the command above was pointed at it with `--seeds 5,6,7,8`.
2. Bit for bit: `GATED_PAR` seed 5 was run again with the command above and compared with the recorded file:
   every field of the summary except the two wall-clock fields (`seconds`, `stepsPerSecond`), and all 100
   time-series rows. If it had not matched, the line would have stopped there.

## Part A: the gate on unseen seeds 9 to 16

**Runs:** `LARGE`, two genes, four arms (`GATED_PAR`, `GATED_CLEAN`, `UNGATED_PAR`, `UNGATED_CLEAN`), seeds 9
to 16, 200,000 steps, 64 x 64. 32 runs.

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/a-gate --genes 2 --caps 16 \
  --seeds 9,10,11,12,13,14,15,16 --steps 200000 --mutPar 1e-4 --jobs 4 --tag large \
  --ov '{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44}'
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/firmup/a-gate --per-seed --json
```

A background shell command on this machine is stopped at two hours, and a run writes its file only when it
finishes. The sweep is therefore invoked in parts (the same command with `--arms` and `--seeds` narrowed to
four runs at a time), all into the same directory. Each run is its own process with its own seed, so the files
are the same whichever way the sweep is cut. A run that was interrupted and started again with the same seed
and settings is the same run, not a replacement.

**"Held" for one run** is unchanged from PLAN.md: over the last tenth of the run the mean number of
compartments is at least 10 and at least half of them carry every gene.

**The rule, fixed before any of these runs:**

- **"Replicates":** `GATED_PAR` held on at least 6 of 8 seeds AND `UNGATED_PAR` held on at most 2 of 8.
- **"Does not replicate":** `GATED_PAR` held on 3 of 8 or fewer.
- **Anything else: "unclear"**, reported as such.
- Both clean arms are reported beside them (first rung: 4 of 4 each).
- No seed is replaced. A run with a non-zero conservation residual is a failure of the line, not a seed to
  drop.

Notes on applying it, also fixed now:

- The verdict is read from the per-seed `held` flags. `summarize.ts` marks a cell "(held)" by the first rung's
  rule (at least 4 seeds, at least 3 held); that marker is not this rule and is not used for the verdict.
- Heredity is reported and is not part of the verdict. PLAN.md's heredity rule is stated for 4 seeds (margin
  at least 0.2 on 3 of 4); for 8 seeds the count of seeds with margin at least 0.2 is given, with both
  controls (nearest neighbour, nearest unrelated compartment), and no pass mark is attached.
- Reported per arm, with ranges over the eight seeds and the per-seed table: held, late compartments, late
  complete share, late parasite share, late copies per compartment, step at which a run ended early, the
  heredity readouts, the bookkeeping counts, and the same figures for seeds 5 to 8 beside them.

## Part B: planned, not run

The coordinator releases these later, one at a time, in this order. No planned 200,000-step run of this part
has been made on any seed (the only Part B option sets executed are the short smoke checks on calibration seed 1
listed at the end of this file). Each uses seeds 9 to 12. Every command writes to its own directory and tag, because
`summarize.ts` names a cell by (tag, K, sites, arm) and refuses a directory where one tag has two
configurations or two parasite rates. `<LARGE>` below stands for
`'{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44}'`.

For a cell of 4 seeds the first rung's cell rule applies: **held** = at least 3 of 4 seeds held. In the
readings below, **not held** = at most 1 of 4, and exactly 2 of 4 is **unclear**.

Part A's runs on seeds 9 to 12 are the `LARGE`, K = 2, `mutPar 1e-4`, 64 x 64 reference for every comparison
below (same seeds). Their figures are taken from the per-seed rows of
`summarize.ts runs/dropgenes/firmup/a-gate --per-seed`, seeds 9 to 12 only; the cell ranges printed for that
directory cover all eight seeds and are not the reference.

### B1. Three genes

`LARGE`, K = 3, four arms, seeds 9 to 12. 16 runs.

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/b1-k3 --genes 3 --caps 16 \
  --seeds 9,10,11,12 --steps 200000 --mutPar 1e-4 --jobs 4 --tag large --ov <LARGE>
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/firmup/b1-k3 --json
```

Known beforehand: on seeds 5 to 8 the gated parasite arm held two genes on 4 of 4 and four genes on 0 of 4
(ended at step 3,750 to 7,850); without the parasite four genes held on 4 of 4 with 10.5 to 13.6 late
compartments against a bar of 10.

Reading, fixed now. `GATED_CLEAN` is read first:

- **"Three genes not held at all":** `GATED_CLEAN` not held (1 of 4 or fewer). Then the failure is not the
  parasite's and the parasite arms are not read, whatever they show.
- `GATED_CLEAN` held on exactly 2 of 4: unclear, and the parasite arms are not read.
- With `GATED_CLEAN` held (3 of 4 or more):
  - **"Three genes held under the parasite":** `GATED_PAR` held (3 of 4 or more).
  - **"Three genes not held under the parasite":** `GATED_PAR` not held (1 of 4 or fewer).
  - Either way the result is reported beside the two-gene and four-gene outcomes already recorded, each with
    its own seeds (two genes: seeds 5 to 16; four genes: seeds 5 to 8). It is not turned into a single
    "capacity", because a gene count that fails does not show that every larger count fails.
  - `GATED_PAR` held on exactly 2 of 4: unclear.
- The twin counts by PLAN.md's rule: `UNGATED_CLEAN` held and `UNGATED_PAR` not held where `GATED_PAR` is.
- A run that misses "held" on the compartment count alone (late complete share at least 0.5, fewer than 10
  compartments) is named as such in the write-up; the verdict does not change.
- Anything else is unclear.

### B2. Parasite dose

`LARGE`, K = 2, `mutPar 1e-5` and `1e-6`, `GATED_PAR` and `UNGATED_PAR`, seeds 9 to 12. 16 runs. The `1e-4`
dose is Part A's seeds 9 to 12.

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/b2-dose --genes 2 --caps 16 \
  --seeds 9,10,11,12 --steps 200000 --mutPar 1e-5 --jobs 4 --arms GATED_PAR,UNGATED_PAR --tag large-m1e5 --ov <LARGE>
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/b2-dose --genes 2 --caps 16 \
  --seeds 9,10,11,12 --steps 200000 --mutPar 1e-6 --jobs 4 --arms GATED_PAR,UNGATED_PAR --tag large-m1e6 --ov <LARGE>
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/firmup/b2-dose --json
```

Known beforehand (exploratory, calibration seeds 1 to 4, 20,000 steps, RESULTS.md): ungated at `1e-5` ended
on 2 of 4 seeds; ungated at `1e-6` all four alive with the parasite share up to 0.19; gated at both rates
kept 46 to 52 compartments.

Reading, fixed now, per dose:

- **"The gate is needed at this dose":** `GATED_PAR` held and `UNGATED_PAR` not held.
- **"The gate is not needed at this dose":** `UNGATED_PAR` held (and `GATED_PAR` held).
- **"Lost even with the gate":** `GATED_PAR` not held. A lower dose losing what the higher dose kept would
  be unexpected and is reported as a finding to look into, not explained away.
- Anything else is unclear.

Across doses: the gate's effect is **"graded in the dose"** if it is needed at `1e-4` and not needed at
`1e-6` or at `1e-5`; it **"holds across two decades"** if it is needed at all three; anything else across
doses is unclear. Where the ungated arm is
held, its late compartments and late parasite share are reported beside the gated arm's; a held ungated world
with fewer compartments or more parasite is a cost, reported as numbers, not a third verdict.

### B3. Unbundle `LARGE`

K = 2, 16 sites, `diffT 0.1`, `mutPar 1e-4`, arms `GATED_PAR`, `UNGATED_PAR`, `GATED_CLEAN`, seeds 9 to 12.
Two new settings, 24 runs:

| setting | tag | `diffW` | `diffF` | `diffA` |
|---|---|---|---|---|
| default | (none) | 0.015 | 0.3 | 0.22 |
| wall only | `wall` | 0.03 | 0.3 | 0.22 |
| fuel only | `fuel` | 0.015 | 0.6 | 0.44 |
| `LARGE` | `large` | 0.03 | 0.6 | 0.44 |

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/b3-unbundle --genes 2 --caps 16 \
  --seeds 9,10,11,12 --steps 200000 --mutPar 1e-4 --jobs 4 --arms GATED_PAR,UNGATED_PAR,GATED_CLEAN \
  --tag wall --ov '{"diffT":0.1,"diffW":0.03}'
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/b3-unbundle --genes 2 --caps 16 \
  --seeds 9,10,11,12 --steps 200000 --mutPar 1e-4 --jobs 4 --arms GATED_PAR,UNGATED_PAR,GATED_CLEAN \
  --tag fuel --ov '{"diffT":0.1,"diffF":0.6,"diffA":0.44}'
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/firmup/b3-unbundle --json
```

Where the other two settings come from: `LARGE` is Part A, seeds 9 to 12. The default physics has been run
only on seeds 5 to 8 (`confirm-v3`, files `K2-cap16-*`). So that all four settings are compared on the same
seeds, an extra sweep is listed for the coordinator to release with B3 or not (12 runs; on seeds 5 to 8 three
of four gated parasite runs ended early, so it is cheaper than it looks):

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/b3-unbundle --genes 2 --caps 16 \
  --seeds 9,10,11,12 --steps 200000 --mutPar 1e-4 --jobs 4 --arms GATED_PAR,UNGATED_PAR,GATED_CLEAN \
  --ov '{"diffT":0.1}'
```

If it is not released, the default column is taken from seeds 5 to 8 and labelled as other seeds in every
table.

A risk known beforehand and not tested: the spot regime depends on fuel diffusing much faster than wall
(PLAN.md: the Phase B2 defaults, where wall diffuses almost as fast as fuel, give travelling rings and no
compartments). `LARGE` keeps the ratio `diffF / diffW` at 20; wall only halves it to 10 and fuel only doubles
it to 40. Either single change may leave the spot regime. That is why `GATED_CLEAN` is in the arm list.

Reading, fixed now, per new setting:

- **"Does not make a lasting compartment world":** `GATED_CLEAN` not held. The setting's parasite arms are
  then not read for the gate.
- **"This change alone is enough":** `GATED_CLEAN` held, `GATED_PAR` held and `UNGATED_PAR` not held.
- **"This change alone is not enough":** `GATED_CLEAN` held and `GATED_PAR` not held.
- Anything else is unclear.

Across the two: **"wall is what matters"** (wall only enough, fuel only not), **"fuel and waste are what
matter"** (the reverse), **"either is enough"**, **"it takes both"** (both settings read exactly "this change alone is not enough"), or
unclear. A setting whose own reading is unclear or "does not make a lasting compartment world" makes the
reading across the two unclear.

Measured properties of a compartment compared across the four settings, each as the range over the four
seeds, read on `GATED_CLEAN` (the arm expected to last at every setting, so the property is not mixed with
parasite damage) and again on `GATED_PAR` where it is held:

| property | source | in the summariser |
|---|---|---|
| compartment count | `summary.lateMeanCompartments` (every census in the last tenth) | already |
| mean area, tiles | mean of `rows[].meanArea` over report rows in the last tenth | added (was in `--json` only) |
| copies per compartment | mean of `rows[].meanCopies` over report rows in the last tenth | already |
| lifetime: median age at death, steps | `summary.ages.observedDeaths.median`, observed deaths only, in units of the 50-step census | added |
| lifetime: turnover time, steps | mean of `rows[].compartments` over all report rows x steps run / `summary.deaths` (compartment-steps per observed death), for runs that reached the planned end | added |
| median age of compartments alive at the end | `summary.ages.aliveAtEnd.median` | added |

Both lifetime figures are bookkeeping that depends on the 50-step census (PLAN.md), and the median age at
death leaves out compartments absorbed by a merge and those still alive. They are compared between settings
observed the same way, not read as absolute lifetimes.

Reading of the properties, fixed now. The reading is made only if all four settings qualify: `GATED_CLEAN`
is held (3 of 4 or more) and `GATED_PAR` is either held (3 of 4 or more) or not held (1 of 4 or fewer). If any
setting does not make a lasting compartment world, or has either of those arms on exactly 2 of 4, the
properties are tabled and no "lines up" reading is made. The value compared is the property's range over all
four `GATED_CLEAN` seeds of the setting (four numbers, none missing; if a value is missing the reading is not
made). A property **"lines up with holding"** if every setting where `GATED_PAR` is held has a larger value
than every setting where it is not held, or every one a smaller value, with no overlap of those ranges; otherwise the property **"does not line up with holding"**. With
four settings this can rule a property out; it cannot show a cause, since area, lifetime, count and copies all
move together when diffusion changes. If all four settings fall on one side (all held or none), no property
is read. The `GATED_PAR` values, where that arm is held, are tabled beside these and are not part of the
rule.

### B4. Bigger arena

`LARGE`, K = 2, four arms, 128 x 128, seeds 9 to 12. 16 runs, each about four times the tiles of a Part A run.

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/firmup/b4-128 --genes 2 --caps 16 \
  --seeds 9,10,11,12 --steps 200000 --mutPar 1e-4 --jobs 4 --size 128 --tag large128 --ov <LARGE>
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/firmup/b4-128 --json
```

With the grid at spacing 16 a 128 x 128 arena starts from 64 founders (16 on 64 x 64). Parasite origin is
tried per tile per step, so the arena as a whole has four times as many tiles on which an origin can be tried
each step at the same per-tile rate. An origin happens only on a tile that holds an essential copy, so the
number of origin events depends on how many tiles are occupied, not on area alone.

Reading, fixed now:

- **"Carries over to the larger arena":** `GATED_PAR` held, `UNGATED_PAR` not held, both clean arms held.
- **"Does not carry over":** `GATED_PAR` not held, whatever the ungated arm shows. If `UNGATED_PAR` is held
  where `GATED_PAR` is not, that is still "does not carry over", and is reported as an unexpected finding to
  look into.
- **"The gate is not needed in the larger arena":** `GATED_PAR` held and `UNGATED_PAR` held.
- Anything else is unclear (including `GATED_PAR` held with `UNGATED_PAR` not held while a clean arm is not
  held, where the gate comparison is confounded as in PLAN.md).

The "held" bar of 10 compartments is an absolute number and is four times easier to clear on four times the
area. So two more figures are reported beside the verdict and do not change it: whether late compartments
reach 40 (the bar scaled by area), and late compartments per 4,096 tiles beside Part A's 64 x 64 figures for
the same seeds. For `UNGATED_PAR` the step at which each run ended is reported beside Part A's.

### Run-time estimates (added after Part A)

Part B above this heading was first written before any seed 9 to 16 run, and some of its readings were amended
after Part A's results were known and before any Part B run; every amendment is listed under "Changes to this
file after the Part A launch". The estimates below were added after Part A, from its measured speeds.

Measured in Part A, four runs at a time on the shared machine: a 64 x 64 `LARGE` two-gene run that reaches
step 200,000 took 434 to 621 s (322 to 461 steps a second, median 350), so a batch of four full-length runs
takes about 10 minutes. A run that ends early costs seconds (the ungated parasite runs took 5 to 10 s). The 32
Part A runs took 56.7 minutes. Speed moved by a factor of three with machine load during this work (the same
run alone took 1,789 s earlier in the evening and 703 s in the first rung), so each figure below can stretch
to about three times as long on a busy machine. Among the first rung's full-length runs looked at for
this (`LARGE` with two and with four genes, default physics at 16 sites), gated `LARGE` with two genes was
the slowest, so its speed is used for every 64 x 64 estimate.

| part | runs | if every run goes the full length | likely (ungated parasite runs end early, as in Part A) |
|---|---|---|---|
| B1, three genes | 16 | about 40 to 45 minutes | about 30 minutes or less (12 full-length runs; fewer if three genes are lost early) |
| B2, parasite dose | 16 | about 40 to 45 minutes | 20 to 45 minutes: 8 gated runs go the full length; the ungated runs at the lower doses may or may not end early |
| B3, wall only and fuel only | 24 | about 60 to 65 minutes | about 40 to 45 minutes (16 full-length runs; fewer if a setting does not make compartments) |
| B3 extra, default physics on seeds 9 to 12 | 12 | about 30 minutes | about 15 to 25 minutes (on seeds 5 to 8 three of four gated parasite runs ended early) |
| B4, 128 x 128 | 16 | about 2 hours 40 minutes | about 2 hours (12 full-length runs) |

B4: four times the tiles is taken as four times the time per step, about 85 to 90 steps a second, so about 40
minutes per full-length run with four running. One check of that scaling: on calibration seed 1, `GATED_PAR`,
the first 4,000 steps, one run at a time, 128 x 128 ran at 142 steps a second and 64 x 64 at 528, a ratio of
3.7. A full-length 128 x 128 run was not timed. One invocation of the whole B4
sweep would run into the two-hour stop on a background command with four runs in flight, so B4 should be
invoked one arm at a time (the same command with `--arms GATED_PAR`, then `--arms GATED_CLEAN`, then
`--arms UNGATED_CLEAN`, then `--arms UNGATED_PAR`): each is one batch of four runs, about 40 minutes, and all
write to the same directory. The other parts fit in one invocation each; if one is stopped, re-invoking the
same command resumes it (check first that no `run.ts` process from the stopped sweep is still running).

## Changes to this file after the Part A launch

The file as it stood when the first seed 9 to 16 run started (2026-11-21 20:54:44 EST) has SHA-256
`40de1991b43ff235c3c2a798dd0c81cde34abcd879828e2a8845e8188a0f5613`, recorded with the hashes of the runner,
kernel and observer in `runs/dropgenes/firmup/prelaunch.txt` (not in git; the work could not be committed by
this line). A copy of the file with that hash is kept beside it as `FIRMUP-PLAN.prelaunch.md`; the Part A rule
in it is word for word the rule above. The Part A rule is unchanged. Changed since (the Part B readings among
them, as listed):

- the run-time estimates above;
- `--per-seed` added to the Part A summarise command and to the description of the summariser change, after
  an opt-in per-seed table was added to `summarize.ts` (the verdict needs per-seed `held` flags);
- this section;
- after the Codex review of this file (made after Part A, before any Part B run), three Part B readings were
  made unambiguous: B1 now reads `GATED_CLEAN` first (before, `GATED_PAR` held with `GATED_CLEAN` not held
  matched two labels); B4's "gate not needed" now requires `GATED_PAR` held (before, `GATED_PAR` not held with
  `UNGATED_PAR` held matched two labels); B3's property reading now says which settings and values it uses and
  when it is not made. The sentence on parasite origin in B4 was corrected (tries per tile, not events), and
  the sentence that nothing in Part B had been run was narrowed to allow for the smoke checks below. Two more
  clarifications in the same pass: the `LARGE` reference for Part B is the per-seed rows of seeds 9 to 12, not
  the eight-seed cell ranges; and B2's across-dose reading gained "anything else is unclear". These edits were
  made after the Part A results were known and before any Part B run;
- after a second Codex review, by the coordinator, also before any Part B run: B1 no longer states a
  "capacity" (three genes held or not is reported beside the recorded two-gene and four-gene outcomes); B3's
  "it takes both" now needs both single-change settings to read exactly "this change alone is not enough";
  B3's property reading gained "does not line up with holding" for the remaining case; and the sentence above
  the run-time estimates now says that Part B was amended after Part A.

Also after Part A, each Part B option set was smoke-checked on calibration seed 1 with `run.ts` directly and
no output file, to see that the options are accepted: K = 3; ungated at `mutPar 1e-5` and at `1e-6`; wall
only; fuel only (200 steps each); and 128 x 128 (4,000 steps, for the timing above). All ran with residual 0.
Only the exit, the residual and the speed were read. No Part B run on seeds 9 to 12 has been made.
