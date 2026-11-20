# Phase A (Direction 3): Combinatorial Oligomer Chemistry — Rungs 0–2 (2026-11-20)

Code: `apps/lab/src/oligomer/{chem,model,observe}.ts`, runner `experiments/oligomer/run.ts`, tests `apps/lab/test/oligomer.test.ts`.
Sandbox on branch `oligomer-droplets` (leaves main kernel and all `RULE_VERSION 1` pins untouched).

## Summary

- **Rung 0 (Mechanics & Conservation): PASS (6/6 tests).** Exact monomer conservation (`sum n0` and `sum n1` residual = `0` at every step across photochemistry, hydrolysis, permeability, catalysis, contact lysis, division, Brownian drift, and diffusion); dark world (`light = 0`) decays monotonically to monomers and `0` live cells; bit-deterministic and observer-pure.
- **Rung 1 (Cross-Feeding without Lysis): FAIL on two-role split, PASS on adaptive evolution.** In 3 of 4 `TREAT` seeds (convex specificity tradeoff $k_0/4^w$), cells evolved secondary dimer cleavage in their spare catalyst slot, lifting carrying capacity by ~50% (`983, 820, 994, 644` live cells vs. `605–614` in `NEUTRAL` and `FLAT`). As in `vesicle` Stage 2, evolution built a better generalist (`M = 64–90%`) rather than splitting into two separate trophic classes.
- **Rung 2 (Red Queen Wall-Motif Lysis): PROVISIONAL PILOT PASS (40k steps).** After fixing three mechanical bottlenecks discovered during pilot runs (Hamming-distance-2 mutational valley between balanced wall tetramers, a neighbor-loop early `break`, and 100%-occupancy immortal-grid freeze), `LYSE` produced sustained, causal Red Queen motif turnover while **0 of 12 control runs** (`NO_LYSE`, `SINGLE_WALL`, `NEUTRAL_WALL`) switched dominant wall motifs. Note: `PLAN.md` specifies 500k-step confirmation runs; these 40k-step pilots are provisional, and `NEUTRAL_WALL` also disables self-toxicity and uses a fixed flat rate (so it tests motif-blind disturbance rather than an isolated motif-specificity ablation).

## Rung 2 Results (40,000 steps, 24×24, 4 seeds, census every 500 steps)

| Arm | Late live (s1–s4) | Lysis deaths (`dLy`) | Wall Hill $D_1$ | Motif switches (last 20k) |
|---|---|---|---|---|
| `LYSE` (motif-specific) | 379, 455, 573, 319 | 8,554 / 5,340 / 2,771 / 6,656 | 2.46, 1.32, 1.00, 1.52 | **12, 2, 0, 2** |
| `NO_LYSE` (no predation) | 575, 574, 574, 574 | 0, 0, 0, 0 | 1.00, 1.01, 1.56, 1.05 | **0, 0, 0, 0** |
| `SINGLE_WALL` (1 motif) | 184, 132, 205, 183 | 14,184 / 13,355 / 8,899 / 17,485 | 1.00 (all 4) | **0, 0, 0, 0** |
| `NEUTRAL_WALL` (motif-blind) | 103, 76, 78, 62 | 15,985 / 11,506 / 10,408 / 8,624 | 1.00, 1.01, 1.04, 1.00 | **0, 0, 0, 0** |

All 16 runs held `res0 = 0, res1 = 0`.

## Causal Red Queen Trace (`LYSE` seed 1)

At `t = 14k`, `1001` held 100% of the world. At `t = 20k`, a `1001`-targeting lysin emerged (`23 -> 54 -> 102` carriers), wiping out `1001` by `t = 26k` as `0101` took over (`79%`). At `t = 28k`, a `0101`-targeting lysin surged (`79` carriers), crashing `0101` (`79% -> 33% -> 9%`) and allowing `1100` and `1001` to rebound (`wD1 = 3.82`). By `t = 38k`, four wall motifs (`0101`, `0110`, `1001`, `1100`) and three competing lysins coexisted dynamically, followed by `0110` breaking out to `82%` at `t = 40k` as `0101`-lysers surged again (`59`).

## Key Diagnostic Lessons (Carried into Phase B1)

1. **Mutational reachability across balanced motifs:** Balanced tetramers (`n0 = n1 = 2`) are all at Hamming distance $\ge 2$; bit-transposition + specialist slot resampling are required so wall switching and lysin discovery do not sit behind multi-step valleys.
2. **Fluid mixing matters:** Without Brownian droplet drift, motif-specific predators wall themselves behind their own clonal daughters. In Phase B1 (active droplets), physical drift and advection happen naturally.
3. **Turnover prevents immortal-grid freeze:** Without background thermal/shear rupture (`pRuptureQ16`), a winning monoculture can jam 100% of space and halt the mutation clock.

## Decision

Phase A's 40k-step pilots provisionally demonstrate that combinatorial lock-and-key oligomer chemistry with self-toxic motif-specific lysis breaks the single-generalist attractor and produces genuine Red Queen turnover (full 500k-step confirmation remains open). Proceeding early to **Phase B1 (pointer-free Zwicker active phase-separating droplets)** at user request.
