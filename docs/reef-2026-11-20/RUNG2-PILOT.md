# The Reef — Rung 2 Iterative Exploration Log: Grazing & Swimming (2026-11-21)

Worktree: `/Users/nicholas/develop/browser-life-reef` (branch `reef-world` off `main`).
Code: `apps/lab/src/reef/{model,observe,render,page}.ts`, live page `/reef/`, tests `apps/lab/test/reef.test.ts` (8/8 pass), runner `experiments/reef/run-rung2.ts`.

All runs: `40×20` vertical water column, `20,000` steps, 4 seeds/arm, late-half means, exact integer matter conservation (`Res = 0` in every single run across all iterations).

---

## Iteration 0 (Baseline Grazing + Linear Swimming)
- **Observation:** Grazing immediately split the trophic web (`GRAZE_NO_SWIM`: 29–41% phototrophs, 29–43% grazers, 27–29% mixotrophs; doubled `sArm`), **but** `MC%` collapsed from Rung 1's `70–87%` down to `4–20%` across all three arms.
- **Diagnosis:** (1) Unbonded cells with baseline `contract ≈ 0.22` got a free upward jetpack (`thrust > gravity`), bypassing stalks; (2) `kGraze = 0.26` shredded young stalks before they matured.

## Iteration 1 (+ Tissue Cohesion Defense + Higher Swimming ATP Cost)
- **Change:** Added multicellular tissue-cohesion defense (`+0.14` per bond, capped at `0.45`, so bonded interior stems resist micro-grazers while exposed tips remain grazable) and raised swimming ATP burn (`0.14 * contract * agility`).
- **Result:**
  - `GRAZE_NO_SWIM` exploded to **`MC% = 50–97%` (3/4 seeds `92–97%`, `MeanSz = 8.1–11.1`, `MaxSz = 51`)** — predation causally *strengthened* multicellularity over Rung 1 (`70–87%`), mirroring the classic *Chlorella* + rotifer size-refuge transition!
  - **Still open:** `r(P, D)` was positive (`+0.18..+0.36`, photosynthetic-cannibal generalists), and `SWIM_NO_GRAZE` / `GRAZE_FULL` still had `MC% = 3–21%` because linear thrust still lifted passive phototrophs off the seabed.

## Iteration 2 (+ Finite Cytoplasmic Packing `cytoScale` + Slower `kDiffNut = 0.006`)
- **Change:** `pigment + digest + contract` compete for finite cellular volume (`load > 1` scales all three by `1 / load`).
- **Result:** Immediately broke the photosynthetic-cannibal generalist: `GRAZE_FULL` shifted to **negative `r(P, D)` in 4/4 seeds (`-0.01, -0.50, -0.16, -0.47`)** and `GRAZE_NO_SWIM` held **`MC% = 80–95%`** with `Arm` climbing up to `0.37`. Linear swimming still lifted baseline `contract ≈ 0.16` cells off the seabed (`CanH90 = 77–96`, `MC% = 5–15%`).

## Iteration 3 (+ Quadratic Contractile Thrust `effCon^2` — Historical; the runner now uses `effCon^1.65`, see Iteration 5)
- **Change:** Propulsion thrust and power scale with `effCon^2` (`kSwim = 0.36`, ATP cost `0.22 * effCon^2 * agility`), so passive phototrophs (`effCon ≈ 0.15`) sink and must build anchored stalks, while dedicated swimmers (`effCon > 0.45`) easily overcome gravity.
- **Results (`40×20`, 20,000 steps, 4 seeds/arm, 39.7s total):**

| Arm | Cells | MC% | MeanSz | MaxSz | CanH90 | Ph% | Gr% | Det% | Mix% | `Arm` | `sArm` | `Dig` | `Con` | `r(P,D)` | Grazed | Res |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`GRAZE_FULL`** | 173–201 | **89.1–95.9%** | **5.08–7.83** | 34–43 | 19.0–21.0 | **29–36%** | **40–48%** | 0–1% | 20–24% | **0.23–0.31** | 0.07–0.12 | **0.36–0.53** | 0.12–0.16 | **−0.57..+0.07** | 111k–125k | `0` |
| `SWIM_NO_GRAZE` | 224–239 | 78.6–88.5% | 3.39–4.85 | 43–51 | 23.7–24.7 | 81–84% | **0%** | 5–6% | 11–13% | 0.15–0.22 | 0.06–0.08 | 0.15–0.21 | 0.14–0.20 | −0.47..+0.02 | 0 | `0` |
| `GRAZE_NO_SWIM` | 191–219 | 80.2–94.6% | 3.56–7.38 | 30–47 | 19.9–23.2 | 29–43% | 33–51% | 0% | 19–23% | 0.19–0.37 | 0.09–0.11 | 0.35–0.42 | 0.10–0.16 | −0.22..+0.12 | 99k–162k | `0` |

### Key Takeaways (Iteration 3)
1. **4/4 non-overlapping predator-driven arms race (`GRAZE_FULL` vs `SWIM_NO_GRAZE`):**
   - **Stronger multicellularity:** `MC% = 89.1–95.9%` (`MeanSz = 5.08–7.83`) vs `78.6–88.5%` (`MeanSz = 3.39–4.85`).
   - **Higher armor:** `Arm = 0.23–0.31` vs `0.15–0.22` (4/4 non-overlapping).
   - **Rich multi-trophic web:** `29–36%` phototrophs + `40–48%` grazers + `20–24%` mixotrophs (`111k–125k` grazed, `r(P, D)` reaching `-0.57` and `-0.41`), vs `81–84%` phototrophs / `0%` grazers in `SWIM_NO_GRAZE`.
2. **One genuinely interesting open frontier:** Under quadratic thrust, dedicated pelagic swimmers (`Con > 0.45`) did **not** yet emerge spontaneously from the `Con = 0.15` founder in 20k steps (`Con` stayed `0.12–0.16`, so `GRAZE_FULL` and `GRAZE_NO_SWIM` look similar right now). That's a classic **mutational valley** (at `Con = 0.15..0.30`, swimming burns ATP without yet beating gravity!). To get **true free-swimming pelagic hunters cruising above the armored kelp forest**, either a lower buoyancy/threshold for unbonded grazers OR a slightly higher `kSwim` / softer exponent (`effCon^1.5`) will bridge that valley.

---

## Iteration 4 (+ Pneumatocyst Kelp Buoyancy + `effCon^1.35` + Surface-Reflecting Headings)
- **Change:** Bonded sunlit photosynthetic fronds gain pneumatocyst buoyancy (`buoy = 0.036`), unbonded swimmers reflect headings off the water surface/seabed instead of stalling on the ceiling, and thrust uses `effCon^1.35` (`kSwim = 0.30`).
- **Result:** Cleanly bracketed the phase boundary — `GRAZE_FULL` seed 2 hit full coexistence (`MC% = 61.4%`, `Span = 27.2`, `CanH90 = 57.5`, `Ph = 65%`, `Gr = 18%`, `r(P,D) = -0.16`, `r(A,C) = -0.14`, `51.8k` grazed), while seeds 1, 3, 4 tipped back to unicellular pelagic swimmers (`MC% = 10–12%`, `CanH90 = 67–86`).

## Iteration 5 (Sweet Spot: `effCon^1.65`, `kSwim = 0.34`, Stronger Kelp Buoyancy `0.055` — Current Kernel)
- **Results (`40×20`, 20,000 steps, 4 seeds/arm, 40.1s total, 8/8 tests + build clean):**

| Arm | Cells | MC% | MeanSz | MaxSz | Span | CanH90 | Ph% | Gr% | Mix% | `Arm` | `Dig` | `Con` | `r(P,D)` | Grazed | Res |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **`GRAZE_FULL`** | 160–201 | **53.9–91.6%** | **1.92–5.83** | 24–39 | **20.3–29.9** | **20.7–62.6** | **37–70%** | **14–38%** | 16–25% | 0.20–0.29 | 0.25–0.38 | 0.17–0.23 | **−0.30..−0.12 (4/4 neg!)** | 55k–106k | `0` |
| `SWIM_NO_GRAZE` | 169–231 | 61.1–82.5% | 2.11–3.88 | 27–50 | **27.1–41.6** | 26.1–28.6 | 83–92% | **0%** | 6–13% | 0.17–0.24 | 0.21–0.27 | 0.15–0.22 | −0.42..+0.06 | 0 | `0` |
| `GRAZE_NO_SWIM` | 189–216 | 92.5–94.3% | 5.88–7.71 | 28–45 | 23.7–32.0 | 19.9–23.4 | 33–43% | 32–45% | 21–24% | 0.20–0.37 | 0.31–0.37 | 0.11–0.17 | −0.45..+0.27 | 98k–143k | `0` |

### Key Takeaways (Iteration 5)
1. **4/4 coexistence + 4/4 trait specialization in `GRAZE_FULL`:** Every seed sustained **54–92% multicellular kelp towers** (`Span = 20–30`, `MaxSz = 24–39`) alongside **14–38% active grazers** (`55k–106k` mass grazed) with **negative `r(P, D)` in 4 of 4 seeds (`−0.12` to `−0.30`)** and `Res = 0`.
2. **Seed 4 run-level aggregates (not cell-level observations):** `GRAZE_FULL` seed 4 shows a high canopy percentile (`CanH90 = 62.6`), `Con = 0.23` and `r(A, C) = −0.25` together with a 54%-multicellular population (`Span = 20.3`, `MaxSz = 24`, `Gr% = 14%`) in the same tank. These are late-half means over the whole run; they do not show that the same cells swim high, move or graze, so "pelagic swimmers cruising above the kelp" is a reading of the aggregates, not an observed behavior.
3. **Vertical span with pneumatocyst buoyancy:** `SWIM_NO_GRAZE` reached vertical spans up to **`41.6` world units** (`MaxSz = 50`). This log has no matched buoyancy-off run, and thrust settings also changed between iterations, so the span is reported as measured; no doubling is claimed.

