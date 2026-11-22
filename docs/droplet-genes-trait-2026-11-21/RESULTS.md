# Droplet genes, heritable trait: results of the confirmation

**Date:** 2026-11-22. **Rule, setting and commands:** [PLAN.md](./PLAN.md), frozen before any of these runs
(SHA-256 `8316a93e…cc7490`, unchanged). **Calibration:** [CALIBRATION.md](./CALIBRATION.md). **Full tables:**
[TABLES.md](./TABLES.md), generated; per-run figures in [confirm-summary.json](./confirm-summary.json).

Unseen seeds 25 to 32 in two blocks of four, four arms, two starts, 200,000 steps: 64 runs. Every run ran to
the end with conservation residual 0. None failed, none was interrupted, none was repeated, no seed was replaced.

## The reading

The summariser prints one reading under the outcome table. Verbatim:

- **Block 1 (seeds 25 to 28):** "Half the confirmation (one block of four seeds). The level is held by
  selection between compartments with or without the gate; at this setting the gate is not what sets it."
- **Block 2 (seeds 29 to 32):** "Half the confirmation (one block of four seeds). The level is held by
  selection between compartments with or without the gate; at this setting the gate is not what sets it."
- **Both blocks:** "The level is held by selection between compartments with or without the gate; at this
  setting the gate is not what sets it."

This is the second row of PLAN.md's outcome table, the one calibration predicted. **G passes. U fails. T
passes.** "Ungated matches gated" and "ungated response" both hold.

| block | seeds | G | U runs away | T twin valid | ungated matches gated | ungated response |
|---|---|---|---|---|---|---|
| 1 | 25, 26, 27, 28 | 4 of 4 | 0 of 4 | 4 of 4 | 4 of 4 | 4 of 4 |
| 2 | 29, 30, 31, 32 | 4 of 4 | 0 of 4 | 4 of 4 | 4 of 4 | 4 of 4 |

Against the question in PLAN.md: the first half is answered yes on these seeds (with gated templates the
trait moves to, and stays at, a level that passes the rule's test for selection between compartments). The
second half is answered **no**: without the gate the trait did not run away to the parasite end in any of the
16 ungated selected runs. Each rested within 0.05 of the gated run from the same start and seed.

Block 1's result was written to disk at 03:02 on 2026-11-22, before any block 2 run was started. Block 2 was
run whatever block 1 showed, as the plan says.

## Per-seed verdicts

The rule's conditions for each seed. "Apart" is the distance between the two gated selected levels (at most
0.25 to pass). The off-neutral figure is how far the lower gated selected level sits above the higher gated
neutral level (at least 0.4 to pass).

| seed | block | held | converged (apart) | off neutral (above the higher neutral run by) | response | **G** | **U** runs away | **T** twin valid | ungated matches gated | ungated response |
|---|---|---|---|---|---|---|---|---|---|---|
| 25 | 1 | yes | yes (0.015) | yes (1.30) | yes | **yes** | **no** | **yes** | yes | yes |
| 26 | 1 | yes | yes (0.015) | yes (1.33) | yes | **yes** | **no** | **yes** | yes | yes |
| 27 | 1 | yes | yes (0.017) | yes (1.18) | yes | **yes** | **no** | **yes** | yes | yes |
| 28 | 1 | yes | yes (0.007) | yes (0.65) | yes | **yes** | **no** | **yes** | yes | yes |
| 29 | 2 | yes | yes (0.023) | yes (1.18) | yes | **yes** | **no** | **yes** | yes | yes |
| 30 | 2 | yes | yes (0.007) | yes (1.36) | yes | **yes** | **no** | **yes** | yes | yes |
| 31 | 2 | yes | yes (0.018) | yes (1.21) | yes | **yes** | **no** | **yes** | yes | yes |
| 32 | 2 | yes | yes (0.004) | yes (0.86) | yes | **yes** | **no** | **yes** | yes | yes |

No condition was close. The narrowest off-neutral margin is 0.65 (seed 28, whose high-start neutral run ended
at 2.51). The smallest gap between a selected "between" term and a neutral one of the same seed is 0.092
(seed 26, ungated). U failed because all 16 ungated selected runs were held; none came near a runaway (highest
mean level of all copies at any census of any ungated selected run: 3.499, in a run that was held; at the last
census: 3.12 to 3.28).
No compared quantity is within 1e-9 of a threshold or a tie, so floating-point rounding decides nothing here.

An independent recomputation of every condition, block count and the reading from the raw run files
(`experiments/dropgenes/trait-confirm-check.py`, written separately from the summariser) agrees with the
summariser on all of them.

## Late levels by arm and start

Late level: the mean ladder level of copies inside compartments over the censuses of steps 180,001 to 200,000.
Every run was held, so every run has a level. All 400 late censuses of every run had copies in compartments.

| arm | start | seed 25 | seed 26 | seed 27 | seed 28 | seed 29 | seed 30 | seed 31 | seed 32 | range |
|---|---|---|---|---|---|---|---|---|---|---|
| `GATED_SEL` | 0 | 3.156 | 3.144 | 3.169 | 3.167 | 3.151 | 3.173 | 3.185 | 3.164 | 3.144 to 3.185 |
| `GATED_SEL` | 3 | 3.171 | 3.159 | 3.185 | 3.174 | 3.174 | 3.165 | 3.166 | 3.168 | 3.159 to 3.185 |
| `GATED_NEU` | 0 | 1.843 | 1.817 | 1.808 | 1.951 | 1.968 | 1.803 | 1.953 | 1.899 | 1.803 to 1.968 |
| `GATED_NEU` | 3 | 1.856 | 1.503 | 1.984 | 2.513 | 1.905 | 1.772 | 1.817 | 2.301 | 1.503 to 2.513 |
| `UNGATED_SEL` | 0 | 3.185 | 3.188 | 3.188 | 3.186 | 3.160 | 3.184 | 3.204 | 3.197 | 3.160 to 3.204 |
| `UNGATED_SEL` | 3 | 3.175 | 3.208 | 3.200 | 3.192 | 3.189 | 3.174 | 3.189 | 3.205 | 3.174 to 3.208 |
| `UNGATED_NEU` | 0 | 2.167 | 2.145 | 1.856 | 1.468 | 2.129 | 2.072 | 1.965 | 2.117 | 1.468 to 2.167 |
| `UNGATED_NEU` | 3 | 2.432 | 2.120 | 1.866 | 2.296 | 2.045 | 2.206 | 2.016 | 2.082 | 1.866 to 2.432 |

Late mean number of compartments:

| arm | start | seed 25 | seed 26 | seed 27 | seed 28 | seed 29 | seed 30 | seed 31 | seed 32 | range |
|---|---|---|---|---|---|---|---|---|---|---|
| `GATED_SEL` | 0 | 28.0 | 29.4 | 29.2 | 26.9 | 29.0 | 26.7 | 24.8 | 27.7 | 24.8 to 29.4 |
| `GATED_SEL` | 3 | 26.4 | 27.2 | 28.1 | 27.1 | 25.3 | 27.8 | 25.6 | 26.1 | 25.3 to 28.1 |
| `GATED_NEU` | 0 | 51.8 | 52.0 | 51.5 | 51.7 | 52.2 | 51.4 | 51.4 | 51.6 | 51.4 to 52.2 |
| `GATED_NEU` | 3 | 52.2 | 51.5 | 51.3 | 52.6 | 50.8 | 52.2 | 51.2 | 50.8 | 50.8 to 52.6 |
| `UNGATED_SEL` | 0 | 23.0 | 23.2 | 23.7 | 22.8 | 25.8 | 23.5 | 22.1 | 22.9 | 22.1 to 25.8 |
| `UNGATED_SEL` | 3 | 24.3 | 21.0 | 20.3 | 23.1 | 21.5 | 23.1 | 23.0 | 21.6 | 20.3 to 24.3 |
| `UNGATED_NEU` | 0 | 52.2 | 51.6 | 52.3 | 52.5 | 51.5 | 51.4 | 52.3 | 51.6 | 51.4 to 52.5 |
| `UNGATED_NEU` | 3 | 51.5 | 51.9 | 52.2 | 52.9 | 51.9 | 51.8 | 52.3 | 52.0 | 51.5 to 52.9 |

What the levels show:

- **Gated, selected.** The 16 runs end between 3.144 and 3.185. The two starts of one seed end 0.004 to 0.023
  apart. About a fifth of the copies in compartments are at the top level (0.19 to 0.23), and the spread of
  level among compartments is small (sd 0.23 to 0.25).
- **The low start arrives.** From level 0 the gated selected level was first within 0.25 of its late level at
  step 6,500 to 10,500. In seeds 30 and 31 it dipped back out for a few points of the 500-step series before
  step 15,000.
- **The level is not perfectly still afterwards.** In one run (gated selected, low start, seed 28) the level
  fell to 2.82 to 2.92 at four points of the 500-step series between steps 93,000 and 97,500, and steps 90,001
  to 100,000 averaged 2.97 (the 20,000-step stretch ending at step 100,000 averaged 3.07). From step 102,500 on
  its 500-step points range from 3.05 to 3.30, and the run's late level is 3.167. The dip ends as the rule's response
  windows begin (the first ends at step 102,000). Every other 20,000-step stretch after step 40,000, in all 16
  gated selected runs, averaged between 3.14 and 3.21. In calibration's four gated selected runs no point of the 500-step series after step 20,000 was more than 0.25
  from the late level.
- **Neutral twin.** The gated neutral runs end between 1.50 and 2.51, and their 20,000-step averages after
  step 40,000 range from 1.37 to 2.59: the level wanders, as in calibration. The spread among compartments is
  about four times the selected world's (sd 0.98 to 1.14). The selected world has about half as many
  compartments as the neutral twin (25 to 29 against 51 to 53).
- **Ungated, selected.** All 16 runs were held to the end, at 3.160 to 3.208, each within 0.05 of the gated
  run from the same start and seed. See "The gate" below for the small difference that is there.
- **Ungated, neutral.** Held in 16 of 16 runs at 200,000 steps (51 to 53 compartments), which calibration had
  seen only to 50,000 steps. Ungating alone does not end the world.

## Response terms, beside the neutral twins

Mean "between" term per 2,000-step window over the 50 windows ending at steps 102,000 to 200,000 (all 50
present and finite in every run). In brackets: how many of the 50 windows had a negative covariance.

| arm | start | seed 25 | seed 26 | seed 27 | seed 28 | seed 29 | seed 30 | seed 31 | seed 32 | range of the mean |
|---|---|---|---|---|---|---|---|---|---|---|
| `GATED_SEL` | 0 | -0.133 (50) | -0.131 (49) | -0.125 (48) | -0.144 (49) | -0.133 (48) | -0.134 (49) | -0.131 (48) | -0.127 (50) | -0.144 to -0.125 |
| `GATED_SEL` | 3 | -0.140 (49) | -0.134 (50) | -0.132 (48) | -0.140 (49) | -0.120 (49) | -0.132 (50) | -0.133 (48) | -0.137 (50) | -0.140 to -0.120 |
| `GATED_NEU` | 0 | +0.029 (22) | +0.007 (24) | -0.012 (24) | -0.018 (28) | -0.008 (29) | +0.028 (25) | +0.006 (25) | +0.037 (20) | -0.018 to +0.037 |
| `GATED_NEU` | 3 | -0.017 (28) | +0.005 (25) | +0.018 (25) | -0.001 (26) | +0.010 (24) | +0.014 (26) | +0.027 (21) | +0.007 (19) | -0.017 to +0.027 |
| `UNGATED_SEL` | 0 | -0.133 (50) | -0.112 (49) | -0.146 (49) | -0.111 (46) | -0.138 (48) | -0.130 (48) | -0.135 (49) | -0.130 (49) | -0.146 to -0.111 |
| `UNGATED_SEL` | 3 | -0.150 (49) | -0.150 (50) | -0.136 (47) | -0.121 (46) | -0.136 (48) | -0.125 (49) | -0.152 (49) | -0.136 (48) | -0.152 to -0.121 |
| `UNGATED_NEU` | 0 | -0.014 (27) | -0.001 (28) | -0.016 (25) | +0.013 (22) | +0.048 (22) | -0.003 (25) | +0.021 (24) | -0.009 (20) | -0.016 to +0.048 |
| `UNGATED_NEU` | 3 | -0.000 (24) | -0.020 (24) | -0.002 (25) | -0.005 (26) | +0.008 (26) | +0.017 (22) | -0.040 (31) | +0.001 (25) | -0.040 to +0.017 |

- In all 32 selected runs, gated and ungated, the term is between -0.11 and -0.15 per window, with a negative
  covariance in 46 to 50 of the 50 windows: compartments with a higher level leave fewer descendant
  compartments.
- In all 32 neutral runs the term is between -0.04 and +0.05, with a negative covariance in 19 to 31 of the 50
  windows: about half, as expected when the level is invisible to selection. Its mean is negative in 15 of
  the 32 neutral runs, so a negative sign alone does not tell selected from neutral. The rule's test is the
  comparison: every selected mean is below both neutral means of its seed and gate, by at least 0.092.
- The "within" term mirrors it in the selected worlds (+0.11 to +0.15 per window) and is near zero in the
  neutral ones (-0.05 to +0.04). The two terms are an accounting split of the change in mean level, and at
  rest they cancel: the level inside lines of descent rises by about 0.13 per 2,000 steps, and the lower
  tracked descendant output of higher-level compartments takes about the same away. Descendant output mixes
  splitting, surviving and being absorbed in a fusion; the term does not say which of these does it.
- The ungated neutral twin's second-half term at 200,000 steps had not been seen before these runs (PLAN.md,
  last section). It reads the same as the gated neutral twin's.

## The gate

The rule's reading is that at this setting the gate is not what sets the level, and the data support that as
far as the rule goes: all 16 ungated selected runs were held, each within 0.05 of its gated partner (the rule
allows 0.25), with the same negative response term.

Three differences between the gated and ungated selected worlds are visible in the tables. None was a
pre-stated condition, so all are observations, not confirmed results:

- The ungated level is higher than the gated level from the same start and seed in 16 of 16 pairs, by 0.004 to
  0.049 (mean 0.022).
- The ungated world holds fewer compartments: 20 to 26 against 25 to 29 (means 22.8 and 27.2).
- Daughters resemble their parents slightly less and are lost slightly more often in the ungated world (see
  "Heredity of level").

So "the gate is not what sets the level" should not be read as "the gate does nothing".

## Heredity of level (reported, not a pass condition)

Resemblance between a daughter compartment's mean level and its parent's, over the splits of the second half
of each run. Ranges over the 16 runs of each arm. Each cell: parent / parent's nearest neighbour / an unrelated
compartment. Per-run figures are in TABLES.md.

| arm | at the split | 500 steps later, survivors only | scored when last seen | daughters gone by 500 steps | level at the split: lasted, gone |
|---|---|---|---|---|---|
| `GATED_SEL` | 0.77 to 0.80 / 0.05 to 0.10 / -0.03 to 0.04 | 0.28 to 0.37 / 0.00 to 0.07 / -0.01 to 0.03 | 0.50 to 0.53 / 0.02 to 0.07 / -0.02 to 0.03 | 43 to 46% | 3.06 to 3.07, 3.21 to 3.24 |
| `GATED_NEU` | 0.94 to 0.96 / 0.27 to 0.36 / 0.11 to 0.20 | 0.82 to 0.88 / 0.24 to 0.35 / 0.08 to 0.20 | 0.84 to 0.89 / 0.25 to 0.34 / 0.09 to 0.18 | 30 to 32% | 1.79 to 2.33, 1.81 to 2.36 |
| `UNGATED_SEL` | 0.74 to 0.77 / 0.06 to 0.12 / 0.00 to 0.06 | 0.24 to 0.32 / 0.00 to 0.09 / -0.02 to 0.06 | 0.47 to 0.52 / 0.04 to 0.10 / -0.00 to 0.07 | 46 to 48% | 3.07 to 3.10, 3.22 to 3.26 |
| `UNGATED_NEU` | 0.91 to 0.93 / 0.24 to 0.38 / 0.12 to 0.27 | 0.75 to 0.80 / 0.21 to 0.38 / 0.11 to 0.27 | 0.78 to 0.82 / 0.21 to 0.37 / 0.11 to 0.26 | 30 to 31% | 1.62 to 2.45, 1.57 to 2.47 |

- In the selected worlds a daughter's level tracks its parent's at the split (0.74 to 0.80) well above the
  nearest neighbour (0.05 to 0.12). The resemblance fades within 500 steps (0.24 to 0.37 among survivors, 0.47
  to 0.53 when daughters are scored as last seen, the ones that dissolved included; that reading leaves out
  the 4 to 6% of daughters that merged with another compartment or were still unresolved at the end). Level differences between compartments are small there
  (sd about 0.23) and are remade all the time.
- In the selected worlds the daughters that were gone by 500 steps had the higher level at the split (3.21 to
  3.26 against 3.06 to 3.10) and a higher one still when last seen (3.36 to 3.44). In the neutral twins the
  two groups do not differ. This points the same way as the response term: higher-level compartments do
  worse.
- Gated and ungated share this pattern. Post hoc, the ungated selected world reads a little weaker in all 16
  pairs of the same start and seed: the parent correlation is lower at the split (by 0.002 to 0.043) and when
  last seen (by 0.005 to 0.059), and more daughters are gone by 500 steps (by 1.6 to 4.2 percentage points).

## Against calibration seeds 1 and 2

Calibration figures are from the final kernel (CALIBRATION.md, Amendment B, item 3). Late levels, the "between"
term over the second half, and late compartments:

| | calibration, seeds 1 and 2 | confirmation, seeds 25 to 32 |
|---|---|---|
| gated selected level | 3.153 to 3.169 | 3.144 to 3.185 |
| distance between the two starts | 0.000, 0.016 | 0.004 to 0.023 |
| gated neutral level | 1.72 to 2.35 | 1.50 to 2.51 |
| lower selected level above the higher neutral run | 1.30, 0.80 | 0.65 to 1.36 |
| "between", gated selected | -0.148 to -0.121 | -0.144 to -0.120 |
| "between", gated neutral | -0.004 to +0.029 | -0.018 to +0.037 |
| ungated selected level | 3.164 to 3.194 | 3.160 to 3.208 |
| "between", ungated selected | -0.141 to -0.129 | -0.152 to -0.111 |
| ungated selected held | 4 of 4 | 16 of 16 |
| ungated neutral held | 4 of 4 at 50,000 steps | 16 of 16 at 200,000 steps |
| compartments, gated selected | 23 to 29 | 25 to 29 |
| compartments, ungated selected | 22 to 26 | 20 to 26 |
| low start within 0.25 of its late level by step | 7,000, 6,000 | 6,500 to 10,500 |
| heredity at the split, gated selected (parent / neighbour) | 0.78 to 0.82 / 0.07 to 0.14 | 0.77 to 0.80 / 0.05 to 0.10 |

The unseen seeds reproduce the calibration pattern in every row; some ranges are wider on eight seeds than on
two and some are narrower. The neutral twin wandered further (down to 1.50, up to 2.51), which brought the narrowest
off-neutral margin to 0.65; the rule asks for 0.4. Calibration's prediction for the confirmation, "G passes, U
fails", is what happened.

## What this does and does not show

It shows, on eight unseen seeds at the one frozen setting:

- With gated templates, the trait climbs from level 0 to within 0.25 of its resting level by step 6,500 to
  10,500 and ends at 3.14 to 3.19 at 200,000 steps, the same place a start at level 3 stays.
- That level is not where mutation and drift leave it: the neutral twin, with the same ladder, mutation,
  species and compartments, wanders, and the higher of its two runs on each seed ends 0.65 to 1.36 below the
  selected level.
- At that level, compartments with a higher level leave fewer descendant compartments: the "between" term is
  negative in every selected run and lower than in both neutral runs of the same seed, where it is near zero
  with either sign. That is the rule's direct check for selection between compartments, and it is what the
  reading rests on.
- Without the gate the same holds and nothing runs away.

It does not show:

- **That the gate matters, or that it could.** The second half of the question got the answer no. This says
  nothing about a ladder where the gate might matter: a shorter ladder where the top level's edge over the
  level below is larger, a different function saturation, or a different mutation rate were not run.
- **Anything beyond one ladder, one mutation rate, one saturation and one arena:** five levels, `mutLevel`
  1/64, `geneSat` 2, 64 x 64, 200,000 steps.
- **Arrival from above.** The high start (level 3) is close to the resting level, so it tests staying, not
  arriving. The two-start test is one-sided: what converges is the low start.
- **What the resting level is made of beyond its mean.** About 3.17 is a mixture centred on level 3, the top
  working level, with about a fifth of copies at the non-working top level. The response term shows the
  direction of selection between compartments; it does not by itself rule out that the top level's
  lethality does part of the holding.
- **Open-ended change.** The trait moved to one level and stayed. Nothing else evolved.

## What ran

All runs on this machine, CPU reference kernel, two at a time, branch `claude/dropgenes-trait-confirm` from
`fedf2809`. Sweep commands exactly as in PLAN.md, each start as its own command:

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
OV='{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44,"geneSat":2}'

# Proof on a seen seed first (8 runs, residual 0):
for START in 0 3; do
  deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/trait/prove-seed1 --genes 2 --caps 16 \
    --seeds 1 --steps 2000 --mutPar 0 --jobs 2 --arms GATED_SEL,GATED_NEU,UNGATED_SEL,UNGATED_NEU \
    --levels 5 --mutLevel 0.015625 --startLevel $START --tag L$START --ov "$OV"
done

# Block 1, then block 2 (SEEDS=25,26,27,28 then 29,30,31,32); START=0 then 3, each its own command:
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/trait/confirm --genes 2 --caps 16 \
  --seeds $SEEDS --steps 200000 --mutPar 0 --jobs 2 --arms GATED_SEL,GATED_NEU,UNGATED_SEL,UNGATED_NEU \
  --levels 5 --mutLevel 0.015625 --startLevel $START --tag L$START --ov "$OV"

# Summaries:
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/trait/confirm --trait --confirm --seeds 25,26,27,28 --json
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/trait/confirm --trait --confirm --seeds 29,30,31,32 --json
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/trait/confirm --trait --confirm --seeds 25,26,27,28,29,30,31,32 --json > runs/dropgenes/trait/confirm-summary.txt

# Independent recomputation (exits 1 on any disagreement with the summariser's JSON line):
python3 experiments/dropgenes/trait-confirm-check.py runs/dropgenes/trait/confirm --seeds 25,26,27,28,29,30,31,32 \
  --against docs/droplet-genes-trait-2026-11-21/confirm-summary.json --calib <calibration runs, v3-cand-c01>
```

Each of the four sweep commands finished inside one invocation (60 to 66 minutes), so the two-hour stop never
fired and no run was interrupted. Each was re-invoked once and printed `0 runs to do`. Wall time from the first
confirmation run to the last: 4 hours 15 minutes (00:53 to 05:08). Elapsed time summed over the 64
simulation processes: 30,279 seconds (8.4 process-hours, 335 to 767 seconds per run), which is about 8.4
core-hours if each process had a full core throughout; CPU time was not measured.

Recorded before the first run on a seed above 4, outside git in `runs/dropgenes/trait/confirm-prerun-record.txt`:
the time, the commit, and the SHA-256 of PLAN.md, `trait-summarize.ts`, `kernel.ts`, `observe.ts`, `run.ts`,
`sweep.ts` and `summarize.ts`. All seven hashes were the same after the last run.

## Departures from the plan

None in the rule, the thresholds, the setting, the seeds or the sweep parameters. These things were added
around them:

1. **The summariser was changed before any confirmation run** (next section).
2. **Block 2 was also summarised alone** (`--seeds 29,30,31,32`), which PLAN.md's commands do not list, so that
   each block has its own printed reading. The summariser calls any single block "half the confirmation".
3. **The sweeps were launched through a small wrapper** that logs start and end times and refuses to start
   while a `run.ts` of this checkout is still alive (so a stopped sweep's leftover run cannot be started twice).
   It passes the plan's parameters unchanged.
4. **The block 1 summary was run with `--json`**, which PLAN.md's block 1 command does not have, so that its
   figures could be cross-checked. The tables and the reading are the same with or without it.
5. **Checks that PLAN.md does not list:** eight proving runs on seed 1 at 2,000 steps, the synthetic tests of
   the scorer, and the independent recomputation in `trait-confirm-check.py`.

## Changes to the summariser, made before any run on a seed above 4

PLAN.md's last section says `--confirm` was added after the last code review. Before running anything, the
confirmation logic was checked line by line against the rule, tested on synthetic run files built from the
seed-1 proving runs (each of the six readings, 2 of 4 against 3 of 4 in a block, 49 of 50 windows, a not-held
run, thresholds on both sides, and the refusals), and reviewed by Codex (Sol 6.1, High).

**No departure was found in the rule logic:** the per-seed conditions, the 50-window requirement, the block
rule and the choice among the six readings were as PLAN.md writes them, and they were not edited. The review
found that `--confirm` would accept run files whose own records are inconsistent, which the runner does not
produce but which the scorer should refuse. Changed in `experiments/dropgenes/trait-summarize.ts`:

- A file whose recorded seed disagrees with its recorded configuration is refused (before, the name was
  checked against one and the run was filed under the other).
- In `--confirm`: a file whose ladder section does not say five levels, or whose response window is not 2,000
  steps, is refused; a run that stopped short of 200,000 steps is accepted only with a recorded extinction; a
  held run with no recorded level, or a file with no yes-or-no held record, is refused.
- In `--confirm` the runaway level is 3.5 as written in the rule, not derived from what a file says its ladder
  is.
- U reads the last-census record only if it has at least 50 copies, a finite level and a step the run reached.
- A level that is missing or not finite is treated as no level (before, a missing value could slip through
  the comparison in "ungated matches gated").
- The set-up comparison between files no longer depends on the order of keys.
- Display only: a run that is not held shows no level in the late-state table (the rule says it has none),
  and a second-half "between" mean that lacks windows is marked as not counted.

None of these changed any output on real files: the calibration summary (seeds 1 and 2) is byte-identical
before and after. The review also noted that the comparisons are made in floating point; no tolerance was
added, and it was written down before the runs that any value within 1e-9 of a threshold would be reported
both ways. None is (see "Per-seed verdicts").

Three points from that review concern the rule or the readouts and were left alone:

- The late level averages only the late censuses that had copies in compartments. Here every run had all 400.
- A run that ends early stops being observed, so "the last census with at least 50 copies" would be the last
  one executed. Here no run ended early.
- Two sweeps writing the same run at once could collide. The wrapper checks for a live run before starting (a
  check, not a lock), and the logs show the four sweeps ran one after another.

## Limits

- **One setting.** One ladder (five levels), one mutation rate (1/64), one saturation (`geneSat` 2), one arena
  (64 x 64), one horizon. The setting was chosen in calibration by a score that favours a level a neutral
  ladder would not reach.
- **The ungated half failed as expected**, and nothing here tests a ladder where the gate might matter.
- **The high start is close to the resting level** (3 against about 3.17). No start above the resting level
  holds a population.
- **Mutation is fast** (1 new copy in 64 changes level). The slower rates screened in calibration had not
  arrived within 20,000 steps and were not run further.
- **The neutral twin wanders** by several tenths of a level between seeds and over time; its late level in
  one run came within 0.65 of the selected level.
- **The response check** weights compartments equally, loses a line absorbed in a fusion, and depends on the
  50-step census. Tracker counts are not rates.
- **Eight seeds, two blocks of four.** Every verdict was 4 of 4 or 0 of 4, so the 3-of-4 rule was never tested
  at its edge.
- The comparisons of ungated with gated levels, compartment counts and heredity in "The gate" and "Heredity of
  level" are post hoc.
- CPU reference only; no WGSL port, no lab page.
