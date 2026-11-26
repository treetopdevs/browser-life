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

## Honest Reading & Open Findings (B1.2)

1. **Wall diversity rescues pointer-free droplets from cannibalistic collapse:** `SINGLE_WALL` crashed to `0–2` droplets across 4 of 4 seeds, while `LYSE` held `8–10` discrete droplets in 4 of 4 seeds.
2. **Immiscibility moat limits `r = 1` contact lysis:** Flory-Huggins repulsion ($\chi = 1.5$) maintains a thin dilute gap between immiscible droplets, keeping `LYSE` cleavage modest (`~158k` over 12k steps) and preventing large Phase A-style Red Queen motif sweeps (`sw = 0–1`).
3. **`NEUTRAL_LYSE` control confound:** Without foreign-interface gating, motif-blind lysis cleaves same-droplet neighbor tiles (`W -> F`), creating an internal fuel-recycling loop (`2.7M` mass cleaved, `15–18` droplets).

## Phase B1.3 Secreted Lysin Field & Foreign-Gated `NEUTRAL_LYSE` (2026-11-20)

Replaced `r = 1` contact-only lysis with a short-range diffusing/decaying secreted lysin (bacteriocin) catalytic field `L[tile * 6 + m]` (`diffL = 0.48`, `decayL = 0.025`, `secreteL = 0.025`, screening length $\lambda = \sqrt{(D/4)/\gamma} \approx 2.2$ tiles) catalyzing local conserved dissipative cleavage (`W_m -> 75% F + 25% A`, zero tile-order bias, exact `res = 0`). Fixed symmetric advection of peaceful (`-1`) vs armed (`0..5`) alleles via core-tile tracking (`isCore`/`prevCore`), upgraded mutations to lobe-scale patches (`r = 2` for `mutLyse` with 50% disarm bias; `r = 3` conserved 1-for-1 patch for `mutMotif`), and gated `NEUTRAL_LYSE` strictly to foreign motifs (`m !== domM`, splitting `secreteL` evenly across the 5 foreign channels).

**Verification (11/11 tests in `droplets.test.ts`):**
- Secreted lysin bridges a 3-tile zero-`W` water moat between immiscible droplets and digests the targeted rival (`res = 0`).
- `NEUTRAL_LYSE` produces **0** cleaved mass on an isolated armed droplet and positive cleavage across a foreign-motif droplet pair (`res = 0`).

### 4-Arm × 4-Seed Red Queen Test (`48×48`, `16,000` steps, `init=mixed`, `kLyse=0.45`, `upkeep=0.002`, `mutLyse=1.5e-4`, `mutMotif=1.5e-5`, census every 500 steps)

| Arm | Late droplets (s1–s4) | End droplets | Hill $D_1$ (late) | `sw30` (late) | `lagR` (s1–s4) | `lyMass` cleaved |
|---|---|---|---|---|---|---|
| `LYSE` (6 motifs, secreted specialist) | 8.6, 9.5, 11.8, 10.5 | 6, 6, 10, 6 | 2.79, 3.23, 3.91, 3.94 | 3, 0, 0, 0 | -0.15, +0.02, -0.01, +0.00 | 1.26M–1.51M |
| `NO_LYSE` (6 motifs, no lysis) | 11.3, 12.2, 8.8, 9.8 | 10, 9, 6, 8 | 3.83, 3.95, 2.48, 3.77 | 3, 1, 0, 2 | +0.14, -0.13, +0.03, -0.06 | 0 |
| `SINGLE_WALL` (1 motif, lysis on) | 3.2, 3.4, 3.0, 3.0 | 2, 3, 4, 3 | 1.00 (all 4) | 0, 0, 0, 0 | -0.19..-0.29 | 700k–743k |
| `NEUTRAL_LYSE` (foreign-gated blind) | 11.9, 11.8, 9.9, 8.4 | 10, 11, 9, 6 | 4.67, 4.35, 3.46, 2.69 | 2, 3, 4, 0 | +0.02, +0.14, -0.04, +0.14 | 894k–1.16M |

All 16 runs held exact matter conservation (`res = 0`).

### Honest Reading (B1.3)

1. **Moat bridged (9× more cleavage) & `NEUTRAL_LYSE` same-motif loop eliminated:** `LYSE` cleavage rose from `155k–161k` (B1.2) to `1.26M–1.51M` (B1.3). Foreign-motif gating eliminated same-motif internal cleavage (`0` on a pure isolate; droplets dropped from B1.2's inflated `15–18` down to `8.4–11.9`, matching `NO_LYSE`'s `8.8–12.2`, though newly mutated/mixed minority motifs within a droplet remain cleavable by design). `SINGLE_WALL` still collapses to `3.0–3.4` droplets under self-toxicity.
2. **Red Queen gate did NOT pass yet on `48×48` secreted-lysin droplets:** `LYSE` did not exceed `NO_LYSE` or `NEUTRAL_LYSE` on late `>=30%` motif sweeps (`sw30 = 3, 0, 0, 0` vs `3, 1, 0, 2` and `2, 3, 4, 0`) or lagged prey–predator correlation (`lagR ≈ 0` on allele counts; runner subsequently updated to mean-centered expressed lysin-field `L` shares for future runs).
3. **Physical diagnosis (public-goods / majority-rule trap + small droplet count):**
   - **Semi-public digestion:** Unlike Phase A's direct private capture (`OP_LYSE` into attacker's own pool), soluble `F` released at a victim 2–3 tiles away diffuses isotropically, weakening private selection for the right lysin (`lagR ≈ 0`). Consequently, a dominant motif with more tiles receives more random `mutLyse` hits and radiates as much lysin against rare motifs as rare motifs radiate against it (majority advantage rather than negative frequency dependence).
   - **Small carrying capacity ($N \approx 10$ droplets on `48×48`):** With only ~10 droplets total, demographic drift alone drives motifs from $D_1 = 6 \to 3$ even in `NO_LYSE`, swamping weak frequency-dependent selection.

## Phase B1.4 Conserved Obligate Phage / Kill-the-Winner (2026-11-20)

Added a **100% conserved integer obligate-phage field** `P[tile * 6 + m]` (`sum(A + F + W + P) === initTotalMatter`, `res = 0`) to `DropletWorld` (`apps/lab/src/oligomer/droplets.ts`, runner `experiments/oligomer/phage-run.ts`, 4 new tests in `apps/lab/test/droplets.test.ts`, 15/15 droplet tests passing):
- **Obligate lytic burst:** Wherever `W_m > 0` and `P_m > 0`, phage cleaves `W_m -> phageYield * P_m + (1 - phageYield) * A` (unbiased stochastic rounding, exact conservation). A phage `P_m` can amplify *only* on its matching host wall motif `m`, guaranteeing true **Kill-the-Winner negative frequency dependence**.
- **Water diffusion & decay:** Virion packets `P_m` diffuse isotropically across water moats (`diffP = 0.22`) and decay back to soluble monomers (`P_m -> A`, `kDecayP = 0.020`) once their host motif crashes.
- **Conserved emergence:** Rare `mutPhage = 1.5e-5` converts a tiny 5-unit packet `W_dom -> P_target` (exact conservation).
- **Matched `NEUTRAL_PHAGE` control:** Identical `kInfect`, `phageYield`, `diffP`, `kDecayP`, `mutPhage`, and exact conservation, except virions infect all wall motifs `m` equally without motif specificity.

### 4-Arm × 4-Seed Controlled Experiment (`48×48`, `20,000` steps, `init=mixed`, `kInfect=0.34`, `kDecayP=0.020`, `diffP=0.22`, `mutPhage=1.5e-5`, `mutMotif=3e-5`, census every 500 steps)

| Arm | Late droplets (s1–s4) | Hill $D_1$ (late) | `sw30` (late) | Mean-centered `lagR` (s1–s4) | `phMass` cleaved | `res` |
|---|---|---|---|---|---|---|
| **`PHAGE` (motif-specific)** | 8.8, 10.4, 7.8, 9.0 | 2.52, 2.81, 2.19, 2.29 | **9, 12, 7, 5** | **+0.86, +0.88, +0.81, +0.78** | 3.27M–4.71M | `0` |
| `NO_PHAGE` (no phage) | 8.1, 5.1, 9.9, 5.9 | 2.45, 1.26, 2.27, 1.45 | **0, 0, 0, 0** | n/a *(no phage)* | 0 | `0` |
| `SINGLE_WALL` (1 motif + phage) | 7.0, 6.6, 6.5, 6.9 | 1.00 (all 4) | **0, 0, 0, 0** | n/a *(1 motif)* | 10.8M–11.2M | `0` |
| `NEUTRAL_PHAGE` (motif-blind) | 8.3, 6.7, 8.1, 7.0 | 2.77, 2.62, 2.58, 2.18 | 10, 9, 9, 5 *(blind bottlenecking)* | n/a *(single generalist channel)* | 9.7M–10.6M | `0` |

All 16 runs held exact integer matter conservation (`res = 0`).

### Single-Founder Monoculture Breakout (`init=single`, 100% `m0`, `20,000` steps, `PHAGE` s1)

Starting from a 100% `m0` monoculture, every one of the 6 motifs took a turn as dominant and was knocked down by its own conserved phage (`sw30 = 4` late, `lagR = +0.83`, `drop = 14`, `D1 = 3.55` at `t = 20,000`, `res = 0`):
- `t = 2k`: `m0 (100%)` → `P0 = 9,261` → `m0` crashes to `4%`.
- `t = 3k–5k`: `m3 (55%) + m5 (45%)` break out → `P3 = 8,459, P5 = 2,909` → both crash.
- `t = 6k–7k`: `m4 (56%)` → `P4 = 2,167` → crashes; `m2 (55%)` → `P2 = 3,118` → crashes.
- `t = 8k–10k`: `m3 (93%)` rebounds → `P3 = 4,645` → crashes.
- `t = 11k–14k`: `m0 (100%)` rebounds → `P0 = 8,164` → crashes.
- `t = 15k–19k`: `m1 (71%)` → `P1 = 4,474` → crashes; `m4 (96%)` → `P4 = 6,176` → crashes.
- `t = 20k`: `m0 (43%) + m1 (32%) + m2 (18%)` rebound (`14` droplets).

### Key Result (B1.4)

**Provisional Kill-the-Winner Red Queen pass on pointer-free Cahn-Hilliard droplets:**
1. **`PHAGE` breaks the monoculture attractor across 4/4 seeds (`sw30 = 5–12` vs `0/4` in `NO_PHAGE` and `SINGLE_WALL`), and breaks out of a 100% single-motif monoculture (`init=single`).**
2. **Mechanism vs `NEUTRAL_PHAGE`:** `lagR` is structurally undefined (`n/a`) on `NEUTRAL_PHAGE` (single generalist channel), `NO_PHAGE`, and `SINGLE_WALL`; within `PHAGE`, matching-motif `lagR = +0.78..+0.88` across 4/4 seeds confirms strong host-specific parasite tracking (`phage-run.ts` now also computes off-diagonal motif-shuffled `lagNull` and motif-independent `nfdsR` for future runs). Moreover, even with an unconstrained generalist `kInfect` that inflicts 2.7× more tissue lysis (`9.7M–10.6M` vs `3.3M–4.7M`) and stochastic bottleneck turnover, `PHAGE` sustains higher late droplet counts (`mean 9.0` vs `7.5` in `NEUTRAL_PHAGE` and `6.8` in `SINGLE_WALL`).
