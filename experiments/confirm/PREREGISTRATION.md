# Droplets vs Reef: confirmation on unseen seeds (2026-11-21)

Written before any seed 5–12 run. The rule is executable in `rule.ts`. If this text and `rule.ts` differ, `rule.ts` decides.

## Why

Every headline so far was a short pilot on the seeds it was tuned on. Seeds 1–4 are development seeds and do not count here.

## Frozen kernels

SHA-256 of each kernel file, plus the runners and this rule's code, is in `FROZEN.json`, and the runners refuse to start if one differs. Droplets are from `main` at `e8e06c18`. The Reef is a snapshot of the uncommitted Iteration 5 kernel from the `reef-world` worktree.

## Runs

| World | Size | Steps | Census | Arms | Seeds |
|---|---|---|---|---|---|
| Droplets | 128×128 | 500,000 | 500 | PHAGE, NO_PHAGE, SINGLE_WALL, NEUTRAL_PHAGE | 5–12 |
| Reef | 40×20 | 200,000 | 1,000 | GRAZE_FULL, SWIM_NO_GRAZE, GRAZE_NO_SWIM | 5–12 |

No seed is replaced. An extinct or collapsed run counts as a loss for its world. A nonzero matter residual in any run invalidates the comparison and stops the decision.

## Pass rule

All endpoints use the final 20% of the run. Comparisons are paired by seed and strict, so a tie is a loss. **A world passes only if every one of its endpoints holds in at least 7 of 8 seeds.**

**Droplets**

- D1: PHAGE holds more droplets than NEUTRAL_PHAGE.
- D2: PHAGE holds more droplets than SINGLE_WALL.
- D3: PHAGE has more leader sweeps than NO_PHAGE (a change of leader among censuses where the leader holds at least 25%).
- D4: PHAGE has higher Hill D1 diversity than NEUTRAL_PHAGE.
- D5: PHAGE persists: at least half the droplets of same-seed NO_PHAGE, Hill D1 at least 2, phage matter above zero at the last census.

**Reef** (from the Rung 2 question: does grazing drive an arms race?)

- R1: GRAZE_FULL has higher mean armor than SWIM_NO_GRAZE.
- R2: GRAZE_FULL has larger mean body size than SWIM_NO_GRAZE.
- R3: GRAZE_FULL coexists: in at least 80% of final-window censuses, the same census has at least 50% of cells multicellular, at least 10% grazers and at least 10% phototrophs, and the tank is alive at the last census.

Grazer share alone is not a separation, because it is zero by construction with grazing off. The R3 thresholds were chosen after seeing seeds 1–4, and they only test coexistence inside the treatment arm. GRAZE_NO_SWIM is run for reading only.

**Collapse.** A treatment world dead at its last census (no droplets, no cells) loses that seed on every endpoint. A dead NO_PHAGE or SWIM_NO_GRAZE control also makes that seed a loss on the endpoints that use it, so a dying control cannot hand the treatment a win. NEUTRAL_PHAGE and SINGLE_WALL may collapse, because their collapse is the effect D1, D2 and D4 measure.

**Run integrity.** A run counts only if its header names the exact world, arm, seed, length and frozen file hashes, and its censuses fall on every expected step.

## Direction readout (not part of pass or fail)

Each seed compares the mean over 40–60% of the run with the mean over the final 20%: a ratio of at least 1.10 is **climbing**, at most 0.90 is **falling**, otherwise **sitting**. A headline needs 5 of 8 seeds, otherwise it is **mixed**. Droplets report diversity and droplet count in PHAGE. The Reef reports mean and maximum body size in GRAZE_FULL.

## Decision

1. Exactly one world passes: it gets the next month.
2. Both pass: the Reef wins only if its body size is climbing and droplet diversity is not holding (holding means climbing or sitting). Otherwise droplets win, including when the direction does not separate them, because their kernel is bit-exact on the GPU and already scales to 256×256.
3. Neither passes: neither gets the month, and the next direction starts from the ceiling these runs measured.

## Pre-run check

Before seeds 5–12, seeds 1–4 are rerun at the pilot length to confirm the frozen kernels reproduce. Reef must match the Iteration 5 table. Droplets must match the re-run column in PR #180.
