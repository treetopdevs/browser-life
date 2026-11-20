# Phase B1 (Direction 2): Pointer-Free Zwicker Active Phase-Separating Droplets (2026-11-20)

Code: `apps/lab/src/oligomer/droplets.ts`, tests `apps/lab/test/droplets.test.ts`, runner `experiments/oligomer/droplets-run.ts`.
Sandbox on branch `oligomer-droplets` (leaves main kernel and all `RULE_VERSION 1` pins untouched).

## Summary

- **Zero declared compartments:** No `Compartment` struct, no `alive[]` array, no `split()` function, and no pointers. Droplets emerge purely from conserved discrete Cahn-Hilliard phase separation (9-point isotropic Laplacian, double-well chemical potential, 6 immiscible wall motifs with Flory-Huggins repulsion $\chi$, exact integer edge fluxes) coupled to a conserved active chemical cycle ($A \xrightarrow{\text{light in dilute solvent}} F$, $F + 2W_m \to 3W_m$, $W_m \to A$).
- **Physics core verification (8/8 tests in `droplets.test.ts`):**
  1. **Exact integer matter conservation:** $\sum(A + F + \sum_m W_m) = \text{const}$ (`res = 0`), non-negative throughout, with constructor-enforced `Int32`-safe matter bounds.
  2. **Spontaneous pointer-free multiplication:** 1 seeded circular droplet expands and breaks into $\ge 4$ (observed 6) discrete droplets via the conserved quadratic autocatalytic reaction-diffusion instability ($F + 2W_m \to 3W_m$, $W_m \to A$) coupled with Cahn-Hilliard surface tension and immiscibility, inferred purely by a connected-components observer.
  3. **Cross-motif immiscibility:** Adjacent droplets of different motifs have strictly lower cross-motif overlap (`sum W_0 * W_1`) with $\chi = 2.0$ than with $\chi = 0$.
  4. **Dark-world dissolution (`kLight = 0`):** All droplets dissolve cleanly into soluble pools (`W = 0`, matter conserved in `A` and `F`, `res = 0`).
  5. **Bit-determinism** across identical seeds.
  6. **Heritable mass-flow advection & causal contact lysis:** `lyseTarget` advects along the largest incoming `W` mass flux; an `m1` droplet targeting `m0` physically digests an adjacent `m0` droplet (`W_0 -> F_1`, `res = 0`) and grows faster than a matched off-target control.

## Phase B1.2 Ecology Transfer Pilot (48×48, 12,000 steps, 4 seeds, census every 500 steps)

| Arm | Late droplets (s1–s4) | End droplets | Hill $D_1$ (late) | Max motif share | `lyMass` cleaved | Switches (late) |
|---|---|---|---|---|---|---|
| `LYSE` (6 motifs, motif-specific) | 6.5, 6.9, 5.9, 6.4 | 9, 10, 8, 9 | 5.06, 5.30, 5.16, 5.18 | 29–32% | 155k–161k | 0, 0, 1, 1 |
| `NO_LYSE` (6 motifs, no lysis) | 11.8, 12.6, 11.7, 10.1 | 13, 14, 9, 15 | 5.95, 5.15, 5.97, 5.90 | 21–32% | 0 | 7, 6, 8, 6 *(tie noise near 16.7%)* |
| `SINGLE_WALL` (1 motif, lysis on) | 2.5, 2.4, 2.3, 1.9 | 1, 1, 0, 2 | 1.00 (all 4) | 100% | 83k–89k | 0, 0, 0, 0 |
| `NEUTRAL_LYSE` (motif-blind) | 17.2, 14.5, 16.4, 17.2 | 16, 18, 15, 16 | 3.80–4.88 | 35–37% | 2.66M–2.78M | 4, 1, 3, 2 |

All 16 runs held exact matter conservation (`res = 0`).

## Honest Reading & Open Findings

1. **Wall diversity rescues pointer-free droplets from cannibalistic collapse:** `SINGLE_WALL` crashed to `0–2` droplets across 4 of 4 seeds, while `LYSE` held `8–10` discrete droplets in 4 of 4 seeds.
2. **Immiscibility moat limits `r = 1` contact lysis:** Flory-Huggins repulsion ($\chi = 1.5$) maintains a thin dilute gap between immiscible droplets, keeping `LYSE` cleavage modest (`~158k` over 12k steps) and preventing large Phase A-style Red Queen motif sweeps (`sw = 0–1`).
3. **`NEUTRAL_LYSE` control confound:** Without foreign-interface gating, motif-blind lysis cleaves same-droplet neighbor tiles (`W -> F`), creating an internal fuel-recycling loop (`2.7M` mass cleaved, `15–18` droplets). Future B1.3 runs should replace `r = 1` contact lysis with a short-range secreted/diffusing lysin field and gate `NEUTRAL_LYSE` to foreign-motif interfaces.
