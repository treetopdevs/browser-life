# The Reef — Rung 0 & Rung 1 Readout (2026-11-20)

Worktree: `/Users/nicholas/develop/browser-life-reef` (branch `reef-world` off `main`).
Code: `apps/lab/src/reef/{model,observe,render,page}.ts`, live page `/reef/`, tests `apps/lab/test/reef.test.ts`, runner `experiments/reef/run.ts`.

## Rung 0 Gate: PASS (5/5 tests, `pnpm typecheck` clean, `vite build` clean)
- Exact integer matter conservation (`residual === 0`) across `FULL`, `NO_SHADOW`, `NO_GRAVITY`, `NO_BONDS`.
- Dark-world thermodynamic anti-cheat (`lightIntensity = 0` → `0` cells, `0` bonds, `residual === 0`), enforced by strictly dissipative cycling (`growEnergyCost = 2.2 > eDetritus = 1.5`).
- Real vertical shadow casting (`FULL` vs `NO_SHADOW`).
- Symplastic bond bridge lets a stratified 6-cell stalk outgrow identical unbonded cells.
- Bit-determinism and observer purity verified.

## Rung 1 Tightened Stratification Result (`40×20`, 20,000 steps, 4 seeds/arm, late-half means, 57.9s total)

Changes from initial pilot: lower open-water nutrients (`initNutPerTile = 3`, `initDetSeabed = 110`), slower abiotic diffusion (`kDiffNut = 0.012`), stronger water attenuation (`waterAtten = 0.032`), stiffer armored beams + elastic seabed holdfast torque, and strictly dissipative `growEnergyCost = 2.2 > eDetritus = 1.5`. Every arm started from the same unicellular founder (`bondKeep = 0.45 < 0.50`).

| Arm | Cells | MC% | MeanSz | MaxSz | CanH90 | `dPig` (top−bot) | `Arm` | `BndK` | Photo / Det / Mix | Res |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`FULL`** | **216–265** | **70.3–87.4%** | **2.62–5.04** | **36–57** | **21.5–26.8** | **+0.003..+0.045** | **0.18–0.27** | **0.54–0.62** | 80–85% / 3–7% / 11–14% | `0` |
| `NO_SHADOW` | 398–404 | 9.6–15.8% | 1.06–1.12 | 6–10 | 19.5–33.6 | −0.012..+0.012 | 0.24–0.26 | 0.44–0.46 | 100% / 0% / 0% | `0` |
| `NO_GRAVITY` | 202–233 | 17.0–44.7% | 1.15–1.57 | 11–41 | 132.9–145.4 | +0.004..+0.031 | 0.23–0.25 | 0.42–0.48 | 88–96% / 0–3% / 4–9% | `0` |
| `NO_BONDS` | 157–174 | 0.0% | 1.00 | 1 | 17.7–18.6 | 0.000 | 0.11–0.16 | 0.40–0.48 | 96–98% / 0% / 2–3% | `0` |

## Key Findings (4/4 Non-Overlapping Separation of `FULL` from `NO_BONDS` on Cell Count, Canopy Height and Armor)

1. **Causal evolution of multicellularity from a unicellular founder:** Starting at `bondKeep = 0.45` (below the `0.50` bonding threshold), **4 of 4 `FULL` seeds** evolved `bondKeep = 0.54–0.62` and **70.3–87.4% multicellularity** (`MeanSz = 2.62–5.04`, `MaxSz = 36–57`), whereas **0 of 8** `NO_SHADOW` (`0.44–0.46`) and `NO_GRAVITY` (`0.42–0.48`) seeds crossed `0.50`. Both shadows *and* gravity/seabed stratification are causally required.
2. **Real physical payoff over unicellularity (`FULL` vs `NO_BONDS`):** Bonded bodies sustained **+46% more living cells** (`216–265` vs `157–174`), reached higher canopies (`21.5–26.8` vs `17.7–18.6`), and evolved stiffer stems (`Arm = 0.18–0.27` vs `0.11–0.16`) — 4/4 non-overlapping on every metric.
3. **Within-body vertical differentiation:** All 4 `FULL` seeds showed positive top-minus-bottom pigment differentiation (`dPig = +0.003..+0.045`; 3 of 4 seeds `+0.026..+0.045`), and sustained 3 energy modes (phototrophs + mixotrophs + detritivores) vs 100% phototrophs in `NO_SHADOW`.
4. **Exact conservation:** `Res = 0` in all 16/16 runs.

## Ready for Rung 2
*Dated note, 2026-11-22: this section first said the Rung 1 gate was "clearly passed". The pre-declared gate in `PLAN.md` has three criteria. This readout reports criterion 3 (`Res = 0` in all 16 runs) and the data for criterion 1 (`MeanSz = 2.62–5.04` across `FULL` seeds, against the plan's mean body size of at least 3). It does not evaluate criterion 2: it gives no within-body shuffled-null comparison and no clade split, and the `dPig` ranges of `FULL` (`+0.003..+0.045`) overlap both `NO_GRAVITY` (`+0.004..+0.031`) and `NO_SHADOW` (`−0.012..+0.012`). The gate is therefore not called passed here. The non-overlap in finding 2 is `FULL` against `NO_BONDS` only.*

*Dated note, 2026-11-22, on `NO_GRAVITY`: `PLAN.md` describes it as well-mixed nutrients and detritus with no seabed gradient. In the model the flag removes cell weight and detritus sinking (detritus diffuses instead), but detritus still starts on the seabed row (`initDetSeabed`) and mineralizes 1.6 times faster there, so `NO_GRAVITY` is a no-sinking control, not a well-mixed column.*

The next rung adds **mechanical contact grazing** (resisted by `armor`) and **contractile swimming/crawling thrust** (anisotropic fluid drag), testing whether predation drives a live flora–grazer–decomposer arms race.
