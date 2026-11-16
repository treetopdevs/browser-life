# Jar light screen and canopy long runs (2026-11-15)

Step A1 of the 3D plan (`docs/3d-expansion-plan-2026-11-15.md`, Phase 1, "jar shapes and their own calibration").
This is exploration, judged by eye and descriptive numbers. It is not a gate and has no pass/fail window.
Everything ran on this Mac (Apple M1 Max) at load average 350 to 400 from other jobs, so every rate here is rough.
The runner is `experiments/3d-slab/jar-screen.ts`. Raw results are in `runs/jar-light-screen/`, `runs/jar-canopy-long/`
and `runs/jar-timing/` (gitignored).

## 1. The screen

**Setup.** Every run is `slab-spots` at 64 × 64 × 64: eight generalist balls of radius 3, biomass 64, at seeded
random (x, y, z); uniform light 240 at the surface. Mu is 50, sigma 8, and each run is 30,000 steps on `RULE_VERSION` 1.
The grid is `lightK` {256, 1024, 4096, 16384} × nutrient N {12, 24} at seed 101. The two most layered settings were
repeated at seed 102: `lightK` 4096 at N 12 and at N 24.
- Living means a cell with a lineage. Activity is the sum of the four role counts (photo, grow, decomp, resp) of the
  last step.
- Every run conserved matter exactly, with energy residual 0.
- Seed 101 ran twice. The per-layer living, light, activity and mass arrays and the traces are identical between the
  passes; the first pass is kept in `first-pass/`.
- The 30,000 steps took 2 to 3 minutes per run, so steps were not cut.
- `summarise.py` regenerates the tables and the contact sheet from the raw files. In those files, the job's
  `nutrient` was relabelled in place, because the first version wrote the per-layer nutrient over it; that array is
  now `nutrientByLayer`.
- `side-views.png` holds the side views: bound mass B + P summed over y, with x across, z down (surface at the top),
  log scale, darker meaning more mass.

| lightK | N | seed | living (all) | living every 5k (%) | floor/surface light (layer 63 / layer 0) | founders' z | activity total | steps/s |
|---:|---:|---:|---:|---|---:|---|---:|---:|
| 256 | 12 | 101 | 2.5% | 0.8, 0.8, 0.8, 0.8, 0.8, 2.5 | 0.90 | 15, 22, 32, 37, 52, 53, 55, 62 | 444 | 224 |
| 1024 | 12 | 101 | 20.6% | 3.2, 5.3, 16.5, 19.3, 20.3, 20.6 | 0.76 | 15, 22, 32, 37, 52, 53, 55, 62 | 2806 | 203 |
| 4096 | 12 | 101 | 44.7% | 11.9, 34.5, 43.2, 42.8, 43.3, 44.7 | 0.81 | 15, 22, 32, 37, 52, 53, 55, 62 | 6182 | 165 |
| 16384 | 12 | 101 | 47.0% | 16.2, 42.7, 47.7, 47.0, 47.0, 47.0 | 0.88 | 15, 22, 32, 37, 52, 53, 55, 62 | 6987 | 161 |
| 256 | 24 | 101 | 2.6% | 0.8, 0.8, 0.8, 0.8, 0.8, 2.6 | 0.90 | 15, 22, 32, 37, 52, 53, 55, 62 | 459 | 224 |
| 1024 | 24 | 101 | 24.3% | 3.2, 5.3, 21.1, 23.5, 24.1, 24.3 | 0.72 | 15, 22, 32, 37, 52, 53, 55, 62 | 3030 | 203 |
| 4096 | 24 | 101 | 75.9% | 12.0, 42.6, 53.4, 55.6, 65.3, 75.9 | 0.65 | 15, 22, 32, 37, 52, 53, 55, 62 | 10388 | 160 |
| 16384 | 24 | 101 | 76.6% | 17.0, 62.0, 66.8, 70.7, 72.7, 76.6 | 0.80 | 15, 22, 32, 37, 52, 53, 55, 62 | 12458 | 156 |
| 4096 | 12 | 102 | 40.4% | 27.6, 40.3, 40.4, 40.7, 40.6, 40.4 | 0.83 | 1, 3, 9, 22, 29, 30, 48, 61 | 6645 | 185 |
| 4096 | 24 | 102 | 55.0% | 34.1, 49.5, 52.3, 53.3, 54.1, 55.0 | 0.77 | 1, 3, 9, 22, 29, 30, 48, 61 | 7993 | 179 |

**Living cells, % of the group** (groups of 8 layers, z 0–7 at the surface to z 56–63 at the floor)

| lightK | N | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 256 | 12 | 101 | 16 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| 1024 | 12 | 101 | 98 | 67 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4096 | 12 | 101 | 84 | 60 | 45 | 28 | 32 | 16 | 14 | 80 |
| 16384 | 12 | 101 | 68 | 43 | 34 | 45 | 38 | 23 | 36 | 89 |
| 256 | 24 | 101 | 17 | 1 | 1 | 1 | 0 | 1 | 0 | 0 |
| 1024 | 24 | 101 | 100 | 94 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4096 | 24 | 101 | 99 | 99 | 99 | 96 | 82 | 67 | 30 | 37 |
| 16384 | 24 | 101 | 100 | 100 | 100 | 97 | 91 | 34 | 3 | 88 |
| 4096 | 12 | 102 | 88 | 84 | 47 | 0 | 2 | 2 | 12 | 90 |
| 4096 | 24 | 102 | 100 | 100 | 95 | 57 | 0 | 0 | 2 | 85 |

**Activity, % of the run's total (photo + grow + decomp + resp fluxes of the last step)** (groups of 8 layers, z 0–7 at the surface to z 56–63 at the floor)

| lightK | N | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 256 | 12 | 101 | 88 | 2 | 5 | 2 | 0 | 3 | 0 | 0 |
| 1024 | 12 | 101 | 71 | 28 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4096 | 12 | 101 | 27 | 14 | 11 | 7 | 8 | 4 | 3 | 27 |
| 16384 | 12 | 101 | 24 | 10 | 9 | 10 | 9 | 4 | 8 | 27 |
| 256 | 24 | 101 | 88 | 2 | 4 | 2 | 0 | 4 | 0 | 0 |
| 1024 | 24 | 101 | 72 | 28 | 0 | 0 | 0 | 0 | 0 | 0 |
| 4096 | 24 | 101 | 18 | 19 | 21 | 14 | 9 | 8 | 3 | 8 |
| 16384 | 24 | 101 | 24 | 20 | 15 | 13 | 11 | 3 | 0 | 14 |
| 4096 | 12 | 102 | 31 | 25 | 12 | 0 | 1 | 0 | 1 | 30 |
| 4096 | 24 | 102 | 40 | 13 | 15 | 9 | 0 | 0 | 0 | 22 |

**Light reaching the group, mean per cell (surface 240)** (groups of 8 layers, z 0–7 at the surface to z 56–63 at the floor)

| lightK | N | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 256 | 12 | 101 | 228 | 220 | 219 | 218 | 218 | 217 | 217 | 217 |
| 1024 | 12 | 101 | 221 | 190 | 181 | 181 | 181 | 181 | 181 | 181 |
| 4096 | 12 | 101 | 234 | 224 | 217 | 212 | 209 | 205 | 204 | 199 |
| 16384 | 12 | 101 | 237 | 233 | 230 | 227 | 223 | 221 | 219 | 214 |
| 256 | 24 | 101 | 227 | 220 | 219 | 217 | 217 | 217 | 216 | 216 |
| 1024 | 24 | 101 | 221 | 188 | 174 | 174 | 174 | 174 | 174 | 174 |
| 4096 | 24 | 101 | 233 | 218 | 203 | 189 | 178 | 168 | 161 | 158 |
| 16384 | 24 | 101 | 236 | 228 | 221 | 213 | 205 | 199 | 198 | 195 |
| 4096 | 12 | 102 | 234 | 223 | 212 | 210 | 210 | 210 | 210 | 204 |
| 4096 | 24 | 102 | 233 | 220 | 208 | 197 | 194 | 194 | 194 | 190 |

**Light at living cells, mean (— where nothing lives)** (groups of 8 layers, z 0–7 at the surface to z 56–63 at the floor)

| lightK | N | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 256 | 12 | 101 | 196 | 186 | 206 | 180 | 225 | 193 | 156 | 140 |
| 1024 | 12 | 101 | 221 | 192 | 176 | 159 | — | 174 | 155 | — |
| 4096 | 12 | 101 | 234 | 222 | 211 | 207 | 211 | 210 | 206 | 199 |
| 16384 | 12 | 101 | 237 | 232 | 228 | 226 | 224 | 220 | 218 | 214 |
| 256 | 24 | 101 | 196 | 186 | 206 | 180 | 229 | 193 | 151 | 137 |
| 1024 | 24 | 101 | 221 | 188 | 167 | 129 | — | 168 | — | — |
| 4096 | 24 | 101 | 233 | 218 | 203 | 189 | 174 | 162 | 164 | 167 |
| 16384 | 24 | 101 | 236 | 228 | 221 | 213 | 205 | 198 | 196 | 195 |
| 4096 | 12 | 102 | 234 | 221 | 212 | — | 207 | 198 | 212 | 204 |
| 4096 | 24 | 102 | 233 | 220 | 207 | 197 | 188 | 192 | 197 | 190 |

**Dissolved nutrient A, mean per cell** (groups of 8 layers, z 0–7 at the surface to z 56–63 at the floor)

| lightK | N | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 256 | 12 | 101 | 10.3 | 11.2 | 11.6 | 11.9 | 12.0 | 12.0 | 12.1 | 12.1 |
| 1024 | 12 | 101 | 3.5 | 6.6 | 8.3 | 8.7 | 8.9 | 8.9 | 9.0 | 9.0 |
| 4096 | 12 | 101 | 0.9 | 1.5 | 2.2 | 2.9 | 3.3 | 3.8 | 3.8 | 2.6 |
| 16384 | 12 | 101 | 1.2 | 1.8 | 2.2 | 2.4 | 2.8 | 3.2 | 2.8 | 1.7 |
| 256 | 24 | 101 | 22.3 | 23.2 | 23.6 | 23.9 | 24.0 | 24.0 | 24.1 | 24.1 |
| 1024 | 24 | 101 | 12.4 | 17.7 | 19.9 | 20.6 | 20.7 | 20.8 | 20.8 | 20.8 |
| 4096 | 24 | 101 | 0.4 | 0.5 | 1.2 | 3.0 | 6.2 | 8.8 | 10.7 | 11.1 |
| 16384 | 24 | 101 | 0.9 | 1.7 | 3.6 | 5.7 | 8.2 | 10.5 | 11.2 | 9.6 |
| 4096 | 12 | 102 | 1.2 | 1.9 | 3.1 | 4.3 | 4.6 | 4.6 | 3.9 | 2.4 |
| 4096 | 24 | 102 | 2.2 | 7.2 | 11.5 | 14.2 | 15.7 | 16.1 | 15.7 | 14.0 |

## 2. Reading

What follows are descriptions. The screen does not show what causes any of these shapes.

**`lightK` 256: nearly empty.**
- Living cells are 2.5% of the jar, and total activity is about 450, against 2,800 to 12,500 elsewhere.
- The founder balls sit where they started as round blobs. In the side view they are frozen balls, with almost no
  activity outside the top group.
- One lens hangs under the surface. It only began to grow after 25,000 steps.
- Nutrient is untouched.
- Self-shading does not obviously explain this. In the 8-layer slab at `lightK` 64 (part 4), full layers grow at a
  mean light of 157 and 126. Unexplained.

**`lightK` 1024: a lid.**
- The top 12 to 16 layers are carpeted (98 to 100% in z 0–7, 67 to 94% in z 8–15).
- Below that the jar is empty, apart from two or three small blobs that survived from deep founders.
- The empty depth still has light 174 to 181 (72 to 76% of the surface). It also has nutrient 9 per cell (N 12) or
  21 (N 24), close to the starting value.
- The lid's sharp lower edge is not set by light or by nutrient in any simple way. Unexplained.
- It was close to flat from 15k to 30k (16.5% to 20.6% at N 12, 21.1% to 24.3% at N 24).

**`lightK` 4096 and 16384: thick mats, usually two.**
- A mat hangs from the surface with a scalloped lower edge, reaching z 30 to 45.
- In most runs a second mat grows up from the floor wall: 80 to 90% living in z 56–63, carrying 14 to 30% of all
  activity, as much as the surface groups. The exception is `lightK` 4096, N 24, seed 101, where the floor group is
  37% living and has 8% of the activity.
- Both seeds had a founder within 3 layers of the floor (z 62, z 61), so the floor mat may come from where the
  founders landed. Whether a floor mat forms without a floor founder is untested. Unexplained.
- The floor is only a little darker: floor-to-surface light is 0.65 to 0.88, and mean light at living cells falls by
  at most 30%.
- At N 12, dissolved nutrient is 1 to 4 per cell everywhere, and living plateaus at 40 to 47% at both seeds. That
  fits the matter budget capping the total, but it does not say where the life sits.
- At N 24, nutrient is drawn down to 0.4 to 2 in the top groups. Yet 9 to 16 per cell is left exactly where life is
  thin or absent, and seed 102's empty band also has light 194. So neither nutrient nor light at depth explains the
  thin middle.
- At seed 102, both N 12 and N 24 leave an empty middle band (roughly z 24–55) between the two mats. The two seeds differ
  a lot at the same settings. Changing the seed also changes founder placement, noise, rounding and mutations, so
  this shows seed sensitivity; that founder placement is the cause (both seeds had a founder near the floor) is a
  hypothesis, not tested here.
- At 16384 the shading is mostly the truncation regime of rung 2 §3 (T is 255 for m ≤ 64, so any mass costs at least
  one unit of light per layer). That setting differs from 4096 mainly by a flatter light gradient.

**Closest to a canopy over a darker floor: `lightK` 4096, N 24, seed 101.**
- Living is 99% in the top four groups, then 82, 67 and 30%, and 37% on the floor.
- Mean light falls from 233 to 158, the steepest gradient in the screen.
- Activity falls with depth: 18 to 21% per group at the top, 3 to 8% at the bottom.
- It had not settled: living climbed from 65 to 76% between 25k and 30k.
- Seed 102 at the same setting settled at a thinner 55%, with the empty middle band.
- N 24 at 16384 looks similar, but carpets further (91% down to z 39).

**Overall.** Light does not stratify the jar the way it stratified the 8-layer slab.
- At `lightK` 1024 and below, life stays a thin lid or does not grow at all.
- At 4096 and above, the mats are thick and lit almost to the floor.

What sets the depth of a mat is open. The most useful next steps are:
1. `lightK` 2048, between the lid and the deep mats.
2. Founding at the surface only, or with no founder near the floor, to separate light layering from founder and
   wall effects.
3. Longer runs for the N 24 settings, which were still rising.

Seed 102 differs a lot from seed 101 at the same setting, so any pick needs at least three seeds.

## 3. Timing (Part 2)

The rung 1b M3 protocol, run with `jar-screen.ts --mode=time` after every other job of this session had finished.
- It is slab-spots: N 32, mu 60, sigma 20, `lightK` 4096, seed 101, evolving.
- Each shape had 2,000 warm-up steps, then 5 trials of 1,000 steps in batches of 100, timed by wall clock to
  `onSubmittedWorkDone`.
- The steps ran on an M1 Max under load average 360 to 390. That is a different machine from the M3 Pro that
  measured 234 steps/s for the slab, so the numbers are rough. The rates also fall trial by trial as the world fills.

| shape | cells | trials (steps/s) | median steps/s | cell-steps/s |
|---|---:|---|---:|---:|
| 64 × 64 × 64 | 262,144 | 400, 384, 364, 347, 336 | 364 | 9.5e7 |
| 64 × 64 × 32 | 131,072 | 646, 588, 546, 520, 519 | 546 | 7.2e7 |
| 256 × 256 × 8 (reference, same session) | 524,288 | 211, 185, 166, 158, 155 | 166 | 8.7e7 |

Per cell, the 64³ jar steps about as fast as the slab. At this rate 300,000 steps of 64³ would take about 14 minutes,
but that is a lower bound: the timed world was about half full (128,396 living cells) and its rate was still
falling. The
screen runs themselves ran at 156 to 224 steps/s while they shared the GPU with the long runs below.

## 4. Long runs of the 8-layer canopy (Part 4)

These runs used the M4b canopy setting: 256 × 256 × 8, N 12, mu 50, sigma 8, `lightK` 64. Seeds 101 to 103 ran to
150,000 steps. Matter and energy were exact at every row. The table gives living as a % of all cells at every
10,000 steps.

| seed | 10k | 20k | 30k | 40k | 50k | 60k | 70k | 80k | 90k | 100k | 110k | 120k | 130k | 140k | 150k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 101 | 3.4 | 18.0 | 34.8 | 43.3 | 43.6 | 42.6 | 41.5 | 40.1 | 39.7 | 39.7 | 40.0 | 40.2 | 40.3 | 40.3 | 40.4 |
| 102 | 9.8 | 34.1 | 43.0 | 43.9 | 45.0 | 45.0 | 45.0 | 44.7 | 44.3 | 44.1 | 43.9 | 43.6 | 43.4 | 43.1 | 42.0 |
| 103 | 14.5 | 43.0 | 44.3 | 44.2 | 42.9 | 41.3 | 39.9 | 38.7 | 38.5 | 38.4 | 38.1 | 37.4 | 37.5 | 37.5 | 37.8 |

At 150k, living by layer (z 0 to 7, %) and floor light were:
- seed 101: 97/97/86/42/1/0/0/0, floor light 104 of 240;
- seed 102: 98/92/85/44/13/4/0/0, floor light 104;
- seed 103: 98/99/88/17/0/0/0/0, floor light 107.

**Reading: it settles; it does not climb to a carpet.**
- Every seed peaks at 43 to 45% between 30k and 70k, eases down, and holds.
- Over the last 50k, seed 101 stayed in 39.7–40.4% and seed 103 in 37.4–38.4%. Seed 102 is still drifting slowly
  down, 44.1% to 42.0%.
- The structure holds: three full layers, a ragged fourth layer that moves between 11 and 44%, and an empty floor
  with about 43% of the surface light.
- Cells with B + P ≥ 64 are nearly flat over the last 40k for seed 101 (20,300 to 20,800). They are still rising for seed 102
  (15,300 to 17,700 over the last 50k) and seed 103 (19,000 to 21,500).
- Seed 102 is the one still moving: its layer 3 fell from 63% at 100k to 44% at 150k, while denser cells increased.
  Whether it levels off near seeds 101 and 103 (about 38 to 40%) is open.
