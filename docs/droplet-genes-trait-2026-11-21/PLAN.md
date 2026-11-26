# Droplet genes, heritable trait: plan and pass rule

**Date:** 2026-11-21. **Branch:** `claude/dropgenes-trait` from `c60d2e5a` (main plus the droplet genes first
rung). **Builds on:** [the first rung](../droplet-genes-2026-11-21/PLAN.md) and its
[results](../droplet-genes-2026-11-21/RESULTS.md). **Calibration record:** [CALIBRATION.md](./CALIBRATION.md).

Sandbox only: `apps/lab/src/dropgenes/` and `experiments/dropgenes/`. No `RULE_VERSION` change, nothing in
`packages/` or `apps/lab/src/oligomer/` touched. CPU reference only.

## Question

In the first rung nothing evolved: the parasite was one fixed type and the one inherited quantity measured was
neutral. Here the templates get one heritable trait that mutation can change and that selection can act on in
opposite directions at two levels. Inside a compartment, faster copiers win. Between compartments, the ones
whose genes still work survive.

**Does the trait's distribution move to, and stay at, a level set by selection between compartments when
templates are gated, and run away to the parasite end when they are not?**

## Rules as built

All first-rung rules stand (PLAN.md of the first rung, rules 1 to 6). The ladder is behind three new optional
configuration keys, `ladderLevels`, `mutLevel`, `ladderNeutral`. They are absent from
`defaultDropGenesConfig()`. Without them the kernel is the first-rung kernel bit for bit: three state digests
taken at `c60d2e5a` before the kernel was edited are pinned in `apps/lab/test/dropgenes-pins.test.ts`, and the
32 first-rung tests are unchanged and pass.

With `ladderLevels = V`:

1. **Species.** Each of the K genes has V variants, "levels" 0 to V - 1. State per tile is `T[k * V + v]`,
   K x V species. There is no separate parasite species and `mutPar` must be 0.
2. **Copy rate by level.** `rate(v) = kRep * (V - 1 + v) / (V - 1)`: `kRep` at level 0, rising by equal steps to
   `2 * kRep` at level V - 1. In the kernel's integers: `rateQ16[v] = floor(kRepQ16 * (V - 1 + v) / (V - 1))`,
   which is exactly `2 * kRepQ16` at the top.
3. **Function by level.** A copy at level v counts as `(V - 1 - v) / (V - 1)` of a copy toward its gene's
   function: 1 at level 0, falling by equal steps to 0 at level V - 1. Wall synthesis on a tile is multiplied by
   `min_k min(n_k, geneSat) / geneSat`, where `n_k` is now the sum over the 3 x 3 patch and over gene k's levels
   of `copies * (V - 1 - v) / (V - 1)`. In integers: weights `V - 1 - v`, saturation `geneSat * (V - 1)`.
   So level 0 is the first rung's gene and **level V - 1 is the first rung's parasite** (twice the rate, no
   function): the parasite is one end of the ladder, not a separate type.
4. **Mutation.** Of the `b` copies of one species made on a tile in a step, `m` are made one level away from
   their template, where `m` is `b * mutLevel` stochastically rounded (mean exactly `b * mutLevel`). All `m` go
   up or all go down, by one hash bit, each direction half the time. A move off either end of the ladder is
   dropped (those copies keep their template's level). So per new copy: `mutLevel / 2` up, `mutLevel / 2` down,
   where that direction exists. `mutLevel` is stored to 1 / 65536.
5. **Neutral twin** (`ladderNeutral`): the same ladder, the same mutation, the same species, but every level
   copies at `kRep` and counts as a full copy. The level is then a label that selection cannot see.
6. **Ungated twin** (`gated: false`): as in the first rung, template hops are not scaled by wall. Nothing else
   differs.
7. **Service order.** When a tile's free sites or fuel run short, the species served first gets the copy. The
   first rung serves species in index order from a hashed start, which is not even-handed among the species
   present (with species 0 and 1 present out of ten, 0 goes first for nine of the ten starts). On a ladder the
   index is the level, so a ladder world does it differently: the species present on the tile are served in a
   uniformly random order (a shuffle, one hash per swap). What a species gets then depends on its own count and
   the counts of the others, not on anyone's level or gene. (Found by review after the first calibration, in
   two steps; see CALIBRATION.md, Amendments A and B. The first rung's order is unchanged.)

Everything else is the first rung's: sites, decay, hops, the gate, fuel, wall chemistry.
Founders: the first rung's 4 x 4 grid of spots, two copies of each gene per wall tile, **all at one start
level**.

Checked by tests (`apps/lab/test/dropgenes-ladder.test.ts`, 25 tests; the readouts below by
`apps/lab/test/dropgenes-trait-observe.test.ts`, 11 tests): the rate and function tables; the
neutral twin's tables; conservation at every step in six settings including the extremes; determinism; no
level change with `mutLevel` 0; with `mutLevel` 1 every new copy is exactly one level away and never two;
moves off the ends are dropped; the realised rate is `mutLevel / 2` each way; copy rates and gene function
follow the tables; under scarce fuel and under scarce sites the copy goes to each species present equally
often in the neutral twin (two, three and five species), and with unequal counts a rare species gets the same
whichever levels the common ones hold, while the first rung's order is unchanged; and a
two-level, one-gene ladder with no mutation and no top-level copies equals the first-rung kernel with one
gene bit for bit, gated and ungated (which ties the ladder path to the pinned path).

### Arithmetic bounds

- Species: `K * V <= 17`, the first rung's largest species count, so the per-species hash channels of different
  passes (500 + s, 520 + s, 600 + s, and the new 570 + s for mutation) cannot collide; the new service-order
  channels are 542 to 557 (one per swap of at most 17 species), between the first rung's 540 and 560.
- Rates: `kRep <= 0.5` is required, so every `rateQ16[v] <= 65536`, the range the stochastic multiply is defined
  for. The largest intermediate is `kRepQ16 * (2V - 2) <= 32768 * 32 = 2^20`.
- Function: the weighted patch sum is at most `(V - 1) *` (all matter in nine distinct tiles) `<= 16 * (2^30 - 1)
  < 2^34`. That is exact in the CPU reference's number type; a 32-bit port must saturate each term at
  `geneSat * (V - 1) <= 1024 * 16`, which does not change the result because the sum is clamped there anyway.
  `geneQ <= 1024` as before.
- Mutation: `m <= b`, and the `b` new copies are already in `T[s]`, so moving `m` of them cannot take a count
  below zero. Mutation only changes a copy's species, so `A + F + W + sum T` is untouched by it.
- Conservation residual is exactly 0 in every run made so far.

## Readouts (all new, all additive; first-rung runs still summarise unchanged)

"Level" of a set of copies is their copy-weighted mean ladder level (0 to V - 1).

- **Level through time:** mean level of copies inside compartments (and per gene); the share of copies at each
  level; across compartments, the distribution of each compartment's own mean level (mean, sd, quantiles,
  counts by nearest level); the same for free templates outside compartments (all, and bare tiles only). On
  every report row (2,000 steps), plus a finer series every 500 steps.
- **Late level:** the mean level inside compartments averaged over every census of the last tenth of the run.
  This is the number the pass rule reads.
- **Held:** as in the first rung (late mean of at least 10 compartments, at least half complete). In a ladder
  world a compartment is complete when every gene has at least one copy **below the top level** (a top-level
  copy has no function); in the neutral twin any level counts.
- **Resemblance of daughter to parent in mean level,** with the first rung's two controls (the parent's
  nearest neighbour; the nearest compartment that is not a close relative), read three ways: at the census
  that first shows the split (at most 50 steps after it); 500 steps after the split, **survivors only**; and
  "last seen", which scores every daughter by the copies it had when last seen unmerged, the ones that
  dissolved before 500 steps included (daughters that merged with or were absorbed by another compartment are
  left out and counted). Beside them: how many daughters were read, gone, merged; the mean parent level of
  daughters that lasted against those that did not; the mean level at the split of each group; and the mean
  last level of the gone. Each is given for the whole run and for the splits of the second half only: while
  the level is still climbing, every compartment resembles every other through the time trend, which inflates
  parent and control figures alike.
- **Response check:** per 2,000-step window, the covariance across compartments between mean level at the
  start and the number of compartments descended from it at the end (by tracker id), and the two Price terms:
  "between" (covariance over mean descendants) and "within" (the rest of the change in mean level). A
  descendant is a compartment that holds at least one copy, so the two terms are over the same compartments
  and add up to the change exactly. Compartments count equally. A line absorbed by a fusion is lost to the
  absorber. Given over all windows, over the windows of the second half of the run, and over the last tenth.

## Arms and starts

| key | gate | ladder |
|---|---|---|
| `GATED_SEL` | on | rates and function follow the ladder |
| `GATED_NEU` | on | neutral twin |
| `UNGATED_SEL` | off | rates and function follow the ladder |
| `UNGATED_NEU` | off | neutral twin |

Each arm is run from two starts: every founder copy at level 0, and every founder copy at the high start (a
high level that still works; fixed with the setting).

## Frozen setting

Chosen on calibration seeds 1 and 2 by the rules in [CALIBRATION.md](./CALIBRATION.md): twelve settings were
listed before any was run; the stop rule did not fire; setting `c01` has the largest pre-stated score among
the settings that qualify. The kernel's service order was corrected twice after review (rule 7), and the
choice was re-made with the final kernel; it came out the same.

| | |
|---|---|
| physics | `LARGE`: `diffT 0.1`, `diffW 0.03`, `diffF 0.6`, `diffA 0.44`; everything else `defaultDropGenesConfig()` |
| genes, sites | K = 2, `capPerTile` 16 |
| ladder | `ladderLevels` 5: copy rate 1, 1.25, 1.5, 1.75, 2 times `kRep`; function per copy 1, 0.75, 0.5, 0.25, 0 |
| function saturation | `geneSat` 2 (the first rung's value) |
| mutation | `mutLevel` 1/64 = 0.015625 per new copy (1/128 up, 1/128 down) |
| starts | every founder copy at level 0; every founder copy at level 3 |
| arena, horizon | 64 x 64, 200,000 steps, census every 50 steps, report row every 2,000 |

## What calibration showed at this setting (seeds 1 and 2, final kernel; not evidence)

Full record in CALIBRATION.md, "Amendment B, item 3". In short:

- **Gated, selected:** from both starts the level went to about 3.16 and stayed there to 200,000 steps (late
  level 3.167 and 3.153 from level 0; 3.168 and 3.169 from level 3), with 23 to 29 compartments and about a
  fifth of copies at the top level. The low start was within 0.25 of its late level by step 7,000 and 6,000.
- **Gated, neutral:** late level 1.72 to 2.35 at 200,000 steps, and it wanders (1.73 to 2.54 over 20,000-step
  stretches after the first 40,000 steps). The gated selected level was 1.30 and 0.80 above the higher neutral
  run of its seed.
- **The response check is negative there and near zero in the neutral twin:** over the windows of the second
  half, the "between" term was -0.12 to -0.15 per 2,000 steps in the four gated selected runs (negative in 49
  or 50 of 50 windows) with the "within" term +0.12 to +0.15, against -0.004 to +0.029 in the four neutral runs
  (negative in 17 to 27 of 50).
- **Level differences between compartments are passed on.** In the gated selected world, over the splits of
  the second half, a daughter's mean level tracks its parent's at 0.78 to 0.82 at the split, 0.30 to 0.42 after
  500 steps among survivors and 0.50 to 0.56 scored when last seen, against 0.02 to 0.14 for the parent's
  nearest neighbour. 43 to 45% of daughters are gone by 500 steps, and the gone ones had the higher level.
- **The high start does not test much.** Level 3 is close to where the selected world rests, so that start
  barely moves. What the two starts show is that the low start arrives at the same level; the neutral twin
  from level 3 falls toward mid-ladder, which the selected ladder does not.
- **Ungated, selected: it did not run away.** All four runs (both starts, seeds 1 and 2) were still held at
  200,000 steps at level 3.16 to 3.19 with 22 to 26 compartments, the same level as the gated world, and with
  the same negative response term. So on calibration seeds the second half of the question has the answer no
  at this setting. By a bar written before those runs, the setting was not re-chosen on that outcome. **The
  confirmation is expected to return "G passes, U fails" below;** it is run to see whether both hold on unseen
  seeds.
- **Ungated, neutral:** held on 4 of 4 at 50,000 steps.

Two things calibration did not do: it used two seeds, not four; and it ran the ungated arm at this one
setting only, so it does not say whether a different ladder would run away without the gate.

## Pass rule, fixed before any confirmation run

"Level" is the late level: the copy-weighted mean ladder level of copies inside compartments, averaged over
every census of steps 180,001 to 200,000. A run that is not held has no level. Each seed has eight runs (four
arms, two starts).

**G: the gated world rests at a level set by selection between compartments.** For one seed, all four of:

1. *Held:* both `GATED_SEL` runs are held.
2. *Converged:* their two levels differ by at most **0.25**.
3. *Off neutral:* both `GATED_NEU` runs are held, and both `GATED_SEL` levels are at least **0.4** above the
   higher of the two `GATED_NEU` levels, or both at least 0.4 below the lower (outside the neutral twin's
   range, with a margin).
4. *Response:* the "between" term of the response check, mean over the 50 windows that end in steps 100,001
   to 200,000 (when the level is at rest; in calibration the low start had arrived by step 7,000), is negative
   in both `GATED_SEL` runs and lower than its value in both `GATED_NEU` runs.

**U: the ungated world runs away to the parasite end.** For one seed: both `UNGATED_SEL` runs are not held,
and in each the mean level of all copies at the last census that still had at least 50 copies is at least
**3.5** (past halfway from the highest working level to the top level).

**T: the twin is valid.** For one seed: both `UNGATED_NEU` runs are held, so ungating alone does not end the
world and U is not confounded with dilution.

Also reported, not a pass condition: *ungated matches gated*, both `UNGATED_SEL` runs held with a level
within 0.25 of the `GATED_SEL` run from the same start; and *ungated response*, condition 4 of G read on the
ungated arms (the "between" term over the same 50 windows is negative in both `UNGATED_SEL` runs and lower
than its value in both `UNGATED_NEU` runs). Both are used only to choose between readings when U fails.

A "between" term counts only if all 50 windows (ending at steps 102,000, 104,000, ..., 200,000) are present
with a finite value; otherwise the condition that needs it is not met.

**Over seeds.** The unseen seeds are 25 to 32, in two blocks of four (25 to 28, 29 to 32). A part (G, U or T)
passes when it holds on **at least 3 of 4 seeds in each block**. If only the first block is run, the result
is stated for that block alone and called half the confirmation.

**Reading the outcome:**

| G | U | T | reading |
|---|---|---|---|
| passes | passes | passes | both halves of the question: the gated level is set between compartments, and without the gate it runs away |
| passes | fails, with "ungated matches gated" and "ungated response" each on at least 3 of 4 seeds per block | any | the level is held by selection between compartments **with or without the gate**; at this setting the gate is not what sets it (what calibration saw) |
| passes | fails, with "ungated matches gated" on at least 3 of 4 seeds per block and "ungated response" not | any | the gated half holds and the ungated level matches the gated one; what holds it there without the gate is not shown |
| passes | fails otherwise | any | the gated half holds; the ungated world neither ran away nor matched, described as found |
| passes | passes | fails | the gated half holds; the ungated comparison is confounded with dilution and says nothing about the gate |
| fails | any | any | not confirmed; which of the four conditions failed is reported per seed |

What each condition is there to rule out:

- *Converged* alone could be met by any force that does not depend on the start. *Off neutral* rules out
  mutation and drift as that force: the neutral twin has the same ladder, mutation, species and compartments.
- *Converged* and *off neutral* together could still be met by selection inside compartments plus the top
  level being lethal, with no selection between compartments at the resting level. *Response* is the direct
  check: compartments with a higher level leave fewer descendant compartments, and the neutral twin shows what
  that term reads when level is invisible to selection.
- The level is read from compartments that exist, so compartments that died are not in it. That is the effect
  being measured, not a bias in it; the heredity readout, where conditioning on survival is a bias, has the
  "last seen" version beside the survivors-only one.

Heredity is reported and is not a pass condition.

## Confirmation runs (not run; the coordinator releases them)

Unseen seeds 25 to 32, 200,000 steps. 64 runs: 4 arms x 2 starts x 8 seeds. No seed above 8 has been run by
this line. Finished runs are skipped, so each command can be re-invoked after an interruption.

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
OV='{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44,"geneSat":2}'

# Block 1: seeds 25 to 28 (32 runs)
for START in 0 3; do
  deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/trait/confirm --genes 2 --caps 16 \
    --seeds 25,26,27,28 --steps 200000 --mutPar 0 --jobs 2 \
    --arms GATED_SEL,GATED_NEU,UNGATED_SEL,UNGATED_NEU \
    --levels 5 --mutLevel 0.015625 --startLevel $START --tag L$START --ov "$OV"
done

# Block 2: seeds 29 to 32 (32 runs)
for START in 0 3; do
  deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/trait/confirm --genes 2 --caps 16 \
    --seeds 29,30,31,32 --steps 200000 --mutPar 0 --jobs 2 \
    --arms GATED_SEL,GATED_NEU,UNGATED_SEL,UNGATED_NEU \
    --levels 5 --mutLevel 0.015625 --startLevel $START --tag L$START --ov "$OV"
done

# Tables, per-seed verdicts, the block rule and the reading. --confirm refuses the directory unless every
# requested seed has all eight runs of the frozen setting (configuration, set-up, starts 0 and 3, 200,000 steps
# in every arm), takes no threshold options and reads the seeds in blocks of four in the order given.
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/trait/confirm --trait --confirm --seeds 25,26,27,28   # block 1 alone: half the confirmation
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/trait/confirm --trait --confirm --seeds 25,26,27,28,29,30,31,32 --json > runs/dropgenes/trait/confirm-summary.txt
```

`--jobs 2` is this line's share of the machine; raise it only if the coordinator frees cores.

A background command on this machine is stopped after 2 hours, and one block's two starts take longer than
that together. Launch each `START` (each pass of the loop) as its own command, and re-invoke it until it
prints `0 runs to do`: finished runs are skipped and an interrupted run leaves no file behind.

**Run time.** With the final kernel, on this machine, a 200,000-step run took 425 to 595 seconds of process
time in calibration (about 500 on average), near one full core each. 64 runs are therefore about 9
core-hours: about 4.5 hours of wall time at two at a time when both get a full core, about 2.2 hours per
block. Earlier in the day, with the machine busier, the same runs got between a fifth and two thirds of a core
and took up to three times as long.

## Limits known before the runs

- **The ungated half is expected to fail** at this setting (calibration, two seeds). If it does, with
  "ungated matches gated" and "ungated response", the result is that the resting level is held by selection
  between compartments whether or not templates are gated; with the match alone, what holds the ungated level
  is not shown. Either way it says nothing about a ladder where the gate might matter.
- **The two-start test is one-sided.** The high start (level 3) is close to the resting level, so it tests
  staying, not arriving from above. No start above the resting level holds a population (level 4 has no
  function).
- **One ladder, one mutation rate, one saturation, one arena, 200,000 steps.** The resting level of about 3.16
  is a mixture centred on level 3, the top working level, with about a fifth of copies at the top level and
  some below level 3; a different function saturation
  moves where the cost bites (CALIBRATION.md, Step 0), and at `geneSat` 8 with this mutation rate the gated
  world died in the first screen.
- **The neutral twin wanders** by several tenths of a level between seeds and over time. The 0.4 margin was
  set from 20,000-step neutral runs and checked on four 200,000-step ones.
- **Mutation is fast** (1 new copy in 64 changes level). At the slower rates screened the low start had not
  arrived within 20,000 steps (1/256) or had barely moved (1/1024); those were not run to 200,000 steps.
- **Calibration used seeds 1 and 2 only**, and the kernel's service order was corrected twice during it. Only
  the runs listed under "Amendment B" in CALIBRATION.md are from the final kernel.
- Tracker counts (fissions, deaths, descendants) depend on the 50-step census. The response check weights
  compartments equally and loses a line that is absorbed in a fusion.
- CPU reference only; no WGSL port, no lab page.

## Changes after the last review, before any confirmation run (2026-11-22, by the coordinator)

A Codex review of the final state found that the summariser could give a passing verdict from a partial or
wrong directory, did not apply the block rule, and could read the response from fewer than 50 windows; and that
the reading for "U fails, ungated matches gated" named a mechanism the rule did not test. Changed, with no
confirmation run made and no seed above 4 run:

- `trait-summarize.ts` gained `--confirm` (the commands above now use it), the block rule, the printed reading,
  and the requirement that all 50 second-half windows are present for any "between" term a verdict uses.
- The outcome table's second row was split in two by a new reported condition, *ungated response*, defined
  above. On calibration seeds 1 and 2 the ungated selected "between" term was -0.129 to -0.141; the ungated
  neutral twin was run to 50,000 steps only there, so its second-half term at 200,000 steps has not been seen.
- The sentence on what the resting level of 3.16 is made of was corrected, and two rounding slips in
  CALIBRATION.md were fixed (0.24 for 0.25, -0.148 for -0.149).

G, U, T, their thresholds and the 3-of-4-per-block rule are unchanged.
