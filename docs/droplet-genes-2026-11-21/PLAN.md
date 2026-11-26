# Droplet genes: plan and pass rules

**Date:** 2026-11-21. **Branch:** `claude/droplet-genes` from `main` `e8e06c18`. **Worktree:** `../browser-life-dropgenes`.

Sandbox only: own files under `apps/lab/src/dropgenes/` and `experiments/dropgenes/`, no `RULE_VERSION` change,
nothing in `packages/` touched, the Phase B2 kernel and shaders untouched. CPU reference only; no WGSL yet.

## Question

The Phase B2 droplets inherit one thing: which of six wall types they are. Give them genes made of the same
conserved matter and ask **how many genes a compartment can hold**. A turnover that goes round in a circle
cannot raise that number.

## What changed from the direction as pitched

At the Phase B2 defaults a one-wall world with no phage does not make compartments. Wall never passes about
0.3 of a tile and the pattern is travelling rings (probe: 64 x 64, seed 1, 3,000 steps; nothing with wall above
0.25 survives from one 100-step census to the next). The chemistry `F + 2W -> 3W`, `W -> A`, `A -> F` is a
Gray-Scott system, and the B2 defaults sit in its wave regime (wall diffuses almost as fast as fuel).

The sandbox therefore uses a self-replicating-spot regime of the same chemistry: `kDeg 0.085`, `diffW 0.015`,
`diffF 0.30`, everything else as B2. One seeded spot becomes about 110 to 130 spots on 64 x 64 by 6,000 steps,
by fission, with empty water between them. With templates off the sandbox kernel equals the B2 reference on
one wall motif bit for bit (tested), so this is the same physics at different rates.

Compartments here are small (a few tiles of dense wall), so "droplet size" below means two things: the number
of template sites a compartment has (`capPerTile`, the main axis), and a physically larger spot if the scouts
find one.

## Rules (all conserved: `A + F + W + sum T` never changes)

State per tile: `A`, `F`, `W` (one wall), `T[K+1]` (K essential templates, then one parasite).

1. **Sites.** A tile has `floor(min(W, 1.0) * capPerTile)` template sites, one shared pool for all K + 1 species.
2. **Decay.** Each step a template copy turns into `A` with rate `kDecT`.
3. **Copying.** `F + T_s -> 2 T_s` at rate `kRep_s * free / sites` per copy, limited by free sites and by `F` on
   the tile. The parasite's `kRepPar` is twice `kRep`. Species are served in a hashed order each step.
4. **Function.** Wall synthesis on a tile is multiplied by `min_k min(n_k, geneSat) / geneSat`, where `n_k` is
   the number of copies of gene k in the 3 x 3 patch. No copy of some gene nearby: no wall is made there.
   The parasite is not counted.
5. **Parasite origin.** With probability `mutPar` per tile per step, one essential copy on that tile (gene chosen
   by hash) becomes one parasite copy. A discrete rare event, not a mass-action rate.
6. **Movement.** Each step, for each species on a tile, `copies * diffT * gate` copies hop to one neighbour
   chosen by hash. `gate` is 0 when the lower wall of the two tiles is at or below `gateLo`, 1 at or above
   `gateHi`, linear between. In the **ungated** twin `gate` is always 1. Nothing else differs between twins.

What makes more genes harder: the sites are shared, so copies per gene fall as 1/K. Copy numbers are small
integers and births and deaths are stochastic, so a compartment can lose its last copy of a gene by drift or
when a fission deals the copies unevenly. A compartment that loses a gene stops making wall and dissolves.

Known routes for a template to change compartment even when gated: two compartments touching (the gate
opens where their walls meet), and copies left on bare tiles being covered by a growing neighbour before they
decay. Both are counted (fusions, stranded share) and reported.

## Arms

Two by two, named by key:

| key | gate | parasite |
|---|---|---|
| `GATED_PAR` | on | `mutPar` > 0 |
| `GATED_CLEAN` | on | 0 |
| `UNGATED_PAR` | off | `mutPar` > 0 |
| `UNGATED_CLEAN` | off | 0 |

## Readouts

- **Held** (one run): over the last tenth of the run the mean number of compartments is at least 10 and at least
  half of them carry every gene (at least one copy of each). **Held at (K, size, arm):** 3 of 4 seeds.
- **Largest K held** per arm and size, on the ladder K = 2, 4, 8, 16.
- Heredity: daughter against parent (trait at the census before the split, daughters at the census after) for
  the share of gene 0 among essential copies and for the parasite share, beside the same daughters against the
  parent's nearest neighbour. Variance of those shares among compartments.
- Bookkeeping: fissions, fusions, deaths (complete and not), stranded share, tracking misses (`denovo`),
  conservation residual (must be 0).

Compartments, fissions, fusions and deaths are inferred by the observer from tile overlap between censuses
50 steps apart. The kernel declares none of them.

## Calibration (seeds 1 to 4 only), then freeze

Scouts may tune, on seeds 1 to 4 and runs of at most 50,000 steps:

- wall physics, only to check the spot regime holds and to find one physically larger compartment setting;
- `kRep`, `kDecT`, `diffT`, `geneSat`, `gateLo`, `gateHi`, using gated arms with K = 1 and K = 2;
- `mutPar` by this rule and no other: the largest value in {1e-7, 1e-6, 1e-5, 1e-4} at which `GATED_PAR` with
  K = 1 is held on 3 of 4 seeds at 50,000 steps.

Scouts do not run the ungated arms with K >= 2 or any ungated arm with a parasite. `capPerTile` is not tuned;
it is the size axis. `kRepPar = 2 * kRep` is fixed.

The frozen values, the number of tuning rounds and anything the scouts saw that bears on the test are recorded
in `RESULTS.md` before the confirmation runs start.

## Confirmation runs (seeds 5 to 8, 200,000 steps, 64 x 64)

1. **K = 2**, four arms, three sizes (`capPerTile` 8, 16, 32, and the larger-spot physics if found). This decides
   the stop rule.
2. If K = 2 is held in `GATED_PAR` at some size: climb K = 4, 8, 16 at the sizes that held, all four arms.

## Decision rules, fixed now

- **Stop** (the direction's "stop if"): K = 2 is not held in `GATED_PAR` at any size.
- **Next rung reached:** K = 2 is held in `GATED_PAR` at some size, and the ladder gives a largest held K for
  each arm. The next rung is templates that join end to end (linked genes).
- **The twin counts** only if `UNGATED_CLEAN` is held at K = 2 (so ungating alone does not kill the world)
  and `UNGATED_PAR` is not held where `GATED_PAR` is. If `UNGATED_CLEAN` is not held, the gate comparison is
  confounded with dilution and is reported as such. If `UNGATED_PAR` is held, the gate did not matter for
  holding genes and the result says so.
- **Heredity counts** in the gated arms if daughter-parent correlation exceeds daughter-neighbour correlation
  by at least 0.2 on 3 of 4 seeds; otherwise the compartments hold genes without passing differences on.

Every number from seeds 1 to 4 is calibration and is labelled as such.

## Amendment 1 (2026-11-21, after the audit and calibration, before any confirmation run)

Three reviewers audited the kernel, observer and runner; one worker applied the confirmed findings; three
scouts calibrated on seeds 1 to 4; a fourth agent re-ran the proposed settings. Changes to the above:

1. **Heredity is read 500 steps after the split, not at the next census.** A template copy lasts about 50 steps
   (`1 / kDecT`), so a daughter read 50 steps after the split mostly holds copies it was carrying, and the
   50-step correlation was high in an ungated world too (an auditor's check, seeds 3 and 4, up to 12,000 steps:
   parent 0.72 against neighbour 0.10 to 0.15). The rule is now: daughter (looked up by its tracker id 500 steps
   after the split) against parent before the split, minus the same against the parent's nearest neighbour, at
   least 0.2 on 3 of 4 seeds. Daughters that no longer exist at 500 steps are left out and counted. The 50-step
   figure is still written to each run file.
2. **Parasite origin** now picks among the genes present on the tile (before, the event was dropped when the
   hashed gene had no copy there, which made the rate fall with K). `kRepPar` follows `2 * kRep` unless given,
   and the runner refuses any other ratio.
3. **Frozen settings:** `diffT 0.1` (default was 0.2), `mutPar 1e-4`, everything else the defaults in
   `defaultDropGenesConfig()`. The larger-compartment setting is `LARGE`: `diffW 0.03`, `diffF 0.6`,
   `diffA 0.44` (all diffusion doubled; compartments about 2.7 times the area), run at `capPerTile` 16.
4. **Sizes for the K = 2 confirmation:** `capPerTile` 8, 16, 32 at the default physics, and `LARGE` at 16.

Known before the runs, and to be carried into the results:

- `mutPar 1e-4` is the top of its grid: `GATED_PAR` with K = 1 was held on 4 of 4 seeds at every value, so the
  rule found no ceiling. It is a heavy setting (late parasite share 0.07 to 0.37 depending on size).
- The parasite origin is per tile, so per copy it is rarer where a tile holds more copies. A size comparison
  in the parasite arms mixes site number with parasite pressure.
- Fission, fusion and death counts, and whether a compartment was complete at its last census before dying,
  change with the census interval. They are bookkeeping, not rates or causes of death.
- "Complete" and the heredity traits count copies on compartment tiles (wall at least `gateHi`). About a third
  of all copies sit on the soft rim (wall between `gateLo` and `gateHi`) and are reported as the halo share.
- With K = 1 and no parasite at 16 and 32 sites the arena is a static lattice after it fills (no deaths).
- Seen in calibration that bears on the test: `GATED_CLEAN` with K = 2 was held on 12 of 12 runs (seeds 1 to
  4, three sizes, 50,000 steps) at the default `diffT` and again at 0.1. No `GATED_PAR` run with K = 2 and no
  ungated run with a parasite was made. The only ungated K = 2 runs were the auditor's short checks above.
