# Jar levers screen (2026-11-16)

Steps A2, A3 and A4 of the 3D plan (`docs/3d-expansion-plan-2026-11-15.md`, Phase 1, Bet A). This is exploration, judged by
eye and descriptive numbers. It is not a gate and has no pass/fail window. Everything ran on this Mac (Apple M1 Max) at
load average 300 to 390, sharing the GPU with another session's mycelium screen, so every rate here is rough. The runner is
`experiments/3d-slab/jar-levers.ts` (the arms are in `jar-levers-arms.ts`); raw results, the summariser and the pictures are in
`runs/jar-levers-screen/` (gitignored). `RULE_VERSION` is still 1: every lever is an optional key, absent by default.

## 1. The levers (A2)

The rules are in `docs/rules.md` ("Optional slab levers") and the arithmetic is in `docs/3d-rung1b-step-spec.md` section 17.
CPU (`step3d.ts`) and WGSL (`shaders3d.ts`) match bit for bit on eight new golden cases (`jar-sink`, `jar-floor-decay`,
`jar-upwell`, `jar-upwell-only`, `jar-levers` at 16 × 16 × 64; `jar-levers-cube` at 64³, gated in vitest behind `BL_SLAB_BIG`;
`slab-rps-mutate` and `slab-rps-mutate-k5` at 16 × 16 × 8). Each case was checked to fail when its lever is broken on the
CPU side alone (including the upwelling period and the mirror's draw). A key-absent config generates the same shader text as before, and every older pin is unchanged.

Energy content is `Σ (eA·A + eB·B + eC·C + eP·P) + E + S`, and it does not depend on where a quantum is. So moving `A` or `C`
between cells books no heat.

| lever | key (range) | exact definition | energy |
|---|---|---|---|
| sinking | `sinkShift` (1..16) | Each step, at cell load in react, a cell above the floor sends `mulFrac(C', 1, s, draw(SINK))` of its post-transport waste to the cell below, `C'/2^s` in expectation, and keeps the rest. Nutrient does not sink: it is the dissolved solute, and waste is the detritus channel (dead B and P decay into it). Bound matter only moves by flow and transport. | none (position-free) |
| floor decomposition | `floorDecay` (0..65535, /65536) | After abiotic recycling, a floor cell (`z = D − 1`) turns `q = mulFrac(C, floorDecay, 16, draw(FLOOR))` of its waste into nutrient. Booked in the `abio` flux. | heat `+= q·(eC − eA)`, exact (downhill, `eC ≥ eA`) |
| upwelling | `upwellPeriod` (1..2^31−1) with `upwellShift` (1..16) | On a step with `step mod period = period − 1`, each cell sends `A'/2^u` and `(C' − sink)/2^u` (stochastic rounding) to its mirror `(x, y, D − 1 − z)` and receives the mirror's. The mirror pairing is an involution with no fixed cell, so this is a set of pairwise swaps: conservative and order-free. Waste is taken after sinking, so the two outflows together never exceed `C'`. | none |
| surface founders | `InitParams.surface` (an init option, not a rule) | Every slab-spots founder's z is drawn in `0..surface − 1` instead of `0..D − 1`; x, y and the noise are unchanged. | n/a |
| vacancy kill with mutation | `rpsMutate` (0..65536, /65536), only with the four vacancy keys | It lifts the vacancy kill's `mutRate 0` rule (without it, that rule and the `rpsFlip`/`rpsEdge` refusals stand, so the old records stay valid). On a mutation event, `(draw(RPS_FLIP) & 0xffff) < rpsMutate` sends it to the type operator of `docs/3d-cyclic-rps-plan-2026-10-23.md` §4.4: `other = (t + 1 + deltaRnd mod (K − 1)) mod K`; half the events (`which & 0xff < 128`) flip mask bit `other`, the rest relabel `t = other` and clear the new own bit. One lineage id and one event per mutation; the MOT mirror is written from the genome afterwards. `InitParams.rpsCycle` types the founders in the ring. | none (no matter moves) |

Why `rpsMutate` was refused before: the vacancy transfer (Amendment 3, `experiments/3d-rps/TRANSFER-RECORD.md`) was an
engineering check of a mutation-free kernel. It deliberately added no type or edge operator and required `mutRate 0`,
leaving mutation to a later, separately specified step. The new key is that later step, opt-in.

All three channel levers run in react, right after the pool caps, as a gather. Each sender's amount is a function of its own
post-transport value and its own `cellBase`, which the receiver recomputes. So there is no new pass, buffer or binding, and
nothing depends on cell order. Over 60 random slabs with every lever on (`packages/sim-ref/test/slab-levers.test.ts`), matter
and the energy ledger are exact.

## 2. The enclosure census (A4)

`packages/metrics/src/enclosure3.ts`, `enclosureCensus3(state, { shell })`, unit-tested in `packages/metrics/test/enclosure3.test.ts`
on closed, open, cornerless, nested, wrapped and wall-touching shells and on spanning lids.

- **Bodies:** 26-connected components of living cells.
- **Shell:** cells with `P ≥ shell`.
- **Outside:** open space reachable by face steps from an open cell on the surface or floor layer. Face steps are what
  diffusion takes, so a shell whose cells only meet along edges or corners still holds.
- **Walls:** the z walls are not shell. A cup pressed against a wall is open; the shell has to close by itself.
- **Pockets and bands:** a pocket is a face-connected region of open space that is not outside. A pocket that wraps the torus
  in x or y (two polymer lids spanning the jar) is reported apart as a *band*.
- **Enclosure:** a bounded pocket holding living biomass. The census reports their count, enclosed B and living cells, and
  the largest.
- **Cost:** memory is a few n-word arrays, about 4 MB at 64³, with one flood per pass.

## 3. The screen (A3)

Every arm is the jar light screen's baseline: slab-spots at 64³ (eight generalist balls of radius 3, biomass 64), nutrient 24,
mu 50, sigma 8, `lightK` 4096, uniform light 240, `mutRate` at the default. Each arm adds one thing. Seeds are 101 and 102, and
every run is 30,000 steps.

One timed run sized the screen: base, seed 101, took 118 s (256 steps/s). The 14 runs took about 25 minutes as two GPU jobs.

| arm | adds | why this value |
|---|---|---|
| base | — | the 4096 / N 24 row of the light screen (its seed 101 numbers are reproduced exactly) |
| surface | founders in z 0..7 | tests whether the floor mats come from founders that landed near the floor |
| sink | `sinkShift` 6 | 1/64 per step. With six-way diffusion at about 0.13 per direction per step, the waste profile should fall off over roughly 8 layers: strong, but not a flat pile on the floor |
| floor | `sinkShift` 6, `floorDecay` 1024 | floor waste back to nutrient at 1/64 per step |
| upwell | `upwellPeriod` 500, `upwellShift` 2 | a quarter of A and C swaps with the mirror layer every 500 steps |
| all | surface + sink + floor + upwell | |
| rps | vacancy kill K 3, `rpsRate` 64, `rpsMin` 16, `rpsMutate` 32768, founders typed 0, 1, 2, 0, 1, 2, 0, 1 | rate 64 as the recorded vacancy runs. `rpsMin` 16 because the founders' biomass is 4 times the cyclic world's (as its rung S1). Half the mutations go to the type operator |

**Checks.** Every run conserved matter exactly, with energy residual 0, and dropped no events.

Living is a cell with a lineage. Activity is the sum of the four role counts (photo, grow, decomp, resp) of the last step. The
three turnovers are taken per 1,000 steps and averaged over the last 10,000:
- **id turnover:** living cells whose lineage id changed (mutation alone moves this);
- **occupancy turnover:** cells that became living or stopped living, over living cells;
- **lineage turnover:** lineage ids present now and absent 1,000 steps earlier, over the ids present now.

| arm | seed | living | living every 5k (%) | lineages | id turnover | occupancy turnover | lineage turnover | floor/surface light (group means, z 56–63 over z 0–7) | activity total |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| base | 101 | 75.9% | 12, 43, 53, 56, 65, 76 | 158 | 0.47 | 0.067 | 0.28 | 0.68 | 10388 |
| base | 102 | 55.0% | 34, 50, 52, 53, 54, 55 | 263 | 0.39 | 0.025 | 0.18 | 0.82 | 7993 |
| surface | 101 | 55.4% | 27, 40, 44, 44, 49, 55 | 61 | 0.49 | 0.062 | 0.40 | 0.76 | 8387 |
| surface | 102 | 54.2% | 29, 40, 43, 43, 47, 54 | 76 | 0.41 | 0.057 | 0.35 | 0.76 | 9618 |
| sink | 101 | 56.9% | 12, 42, 50, 51, 56, 57 | 255 | 0.34 | 0.058 | 0.19 | 0.81 | 6839 |
| sink | 102 | 67.2% | 34, 49, 52, 56, 64, 67 | 219 | 0.27 | 0.066 | 0.20 | 0.76 | 8695 |
| floor | 101 | 57.9% | 12, 42, 50, 51, 55, 58 | 256 | 0.31 | 0.035 | 0.20 | 0.81 | 8223 |
| floor | 102 | 54.6% | 34, 49, 53, 55, 57, 55 | 224 | 0.25 | 0.111 | 0.22 | 0.81 | 7410 |
| upwell | 101 | 59.4% | 12, 42, 53, 57, 55, 59 | 223 | 0.42 | 0.074 | 0.21 | 0.76 | 18006 |
| upwell | 102 | 58.9% | 34, 56, 52, 47, 47, 59 | 245 | 0.47 | 0.100 | 0.21 | 0.82 | 6578 |
| all | 101 | 49.4% | 27, 43, 42, 42, 46, 49 | 58 | 0.59 | 0.063 | 0.44 | 0.78 | 14771 |
| all | 102 | 52.2% | 29, 42, 40, 45, 47, 52 | 64 | 0.46 | 0.074 | 0.40 | 0.77 | 13350 |
| rps | 101 | 53.1% | 10, 40, 51, 51, 53, 53 | 238 | 0.19 | 0.028 | 0.23 | 0.82 | 7682 |
| rps | 102 | 67.0% | 32, 50, 58, 63, 66, 67 | 191 | 0.21 | 0.031 | 0.24 | 0.73 | 11813 |

**Living cells, % of the group** (groups of 8 layers, z 0–7 at the surface to z 56–63 at the floor)

| arm | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 101 | 99 | 99 | 99 | 96 | 82 | 67 | 30 | 37 |
| base | 102 | 100 | 100 | 95 | 58 | 0 | 0 | 2 | 85 |
| surface | 101 | 100 | 100 | 100 | 85 | 58 | 0 | 0 | 0 |
| surface | 102 | 100 | 100 | 100 | 87 | 47 | 0 | 0 | 0 |
| sink | 101 | 99 | 99 | 95 | 44 | 8 | 8 | 13 | 89 |
| sink | 102 | 98 | 94 | 88 | 89 | 78 | 50 | 1 | 39 |
| floor | 101 | 100 | 98 | 94 | 61 | 9 | 4 | 8 | 88 |
| floor | 102 | 100 | 99 | 95 | 59 | 0 | 0 | 0 | 82 |
| upwell | 101 | 100 | 100 | 100 | 100 | 16 | 2 | 0 | 56 |
| upwell | 102 | 100 | 100 | 100 | 81 | 0 | 0 | 9 | 81 |
| all | 101 | 100 | 100 | 100 | 93 | 2 | 0 | 0 | 0 |
| all | 102 | 100 | 100 | 100 | 94 | 24 | 0 | 0 | 0 |
| rps | 101 | 100 | 100 | 91 | 41 | 1 | 4 | 3 | 86 |
| rps | 102 | 100 | 100 | 100 | 98 | 90 | 15 | 0 | 33 |

**Activity, % of the run's total**

| arm | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 101 | 18 | 19 | 21 | 14 | 9 | 8 | 3 | 8 |
| base | 102 | 40 | 13 | 15 | 9 | 0 | 0 | 0 | 22 |
| surface | 101 | 37 | 33 | 6 | 15 | 9 | 0 | 0 | 0 |
| surface | 102 | 36 | 36 | 7 | 15 | 6 | 0 | 0 | 0 |
| sink | 101 | 25 | 23 | 14 | 7 | 2 | 2 | 2 | 26 |
| sink | 102 | 20 | 15 | 22 | 15 | 11 | 8 | 0 | 10 |
| floor | 101 | 24 | 23 | 17 | 10 | 2 | 1 | 1 | 23 |
| floor | 102 | 26 | 29 | 16 | 8 | 0 | 0 | 0 | 22 |
| upwell | 101 | 44 | 34 | 7 | 7 | 1 | 0 | 0 | 7 |
| upwell | 102 | 43 | 12 | 10 | 6 | 0 | 0 | 2 | 26 |
| all | 101 | 47 | 37 | 9 | 8 | 0 | 0 | 0 | 0 |
| all | 102 | 52 | 36 | 3 | 7 | 2 | 0 | 0 | 0 |
| rps | 101 | 35 | 12 | 21 | 6 | 0 | 1 | 0 | 24 |
| rps | 102 | 27 | 24 | 19 | 10 | 11 | 1 | 0 | 8 |

**Light reaching the group, mean per cell (surface 240)**

| arm | seed | z0–7 | z8–15 | z16–23 | z24–31 | z32–39 | z40–47 | z48–55 | z56–63 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 101 | 233 | 218 | 203 | 189 | 178 | 168 | 161 | 158 |
| base | 102 | 233 | 220 | 208 | 197 | 194 | 194 | 194 | 190 |
| surface | 101 | 233 | 216 | 203 | 190 | 180 | 176 | 176 | 176 |
| surface | 102 | 233 | 216 | 202 | 190 | 179 | 177 | 177 | 177 |
| sink | 101 | 234 | 221 | 208 | 199 | 196 | 195 | 194 | 189 |
| sink | 102 | 234 | 222 | 211 | 200 | 189 | 181 | 178 | 177 |
| floor | 101 | 234 | 221 | 209 | 198 | 194 | 194 | 193 | 188 |
| floor | 102 | 233 | 219 | 206 | 195 | 192 | 192 | 192 | 189 |
| upwell | 101 | 232 | 215 | 200 | 187 | 178 | 178 | 178 | 176 |
| upwell | 102 | 234 | 222 | 211 | 201 | 197 | 197 | 197 | 193 |
| all | 101 | 233 | 217 | 201 | 188 | 182 | 182 | 182 | 182 |
| all | 102 | 232 | 215 | 201 | 189 | 180 | 179 | 179 | 179 |
| rps | 101 | 233 | 220 | 208 | 198 | 197 | 196 | 196 | 192 |
| rps | 102 | 233 | 218 | 203 | 190 | 178 | 170 | 170 | 169 |

**Dissolved nutrient A and waste C, mean per cell**

| arm | seed | A z0–7 | A z24–31 | A z56–63 | C z0–7 | C z24–31 | C z56–63 |
|---|---:|---:|---:|---:|---:|---:|---:|
| base | 101 | 0.3 | 3.0 | 11.1 | 1.5 | 3.1 | 1.6 |
| base | 102 | 2.2 | 14.2 | 14.0 | 4.0 | 1.8 | 2.4 |
| surface | 101 | 0.4 | 12.1 | 15.9 | 1.9 | 3.1 | 0.0 |
| surface | 102 | 0.4 | 11.7 | 16.3 | 2.0 | 2.9 | 0.0 |
| sink | 101 | 1.2 | 14.2 | 17.2 | 2.0 | 1.9 | 3.0 |
| sink | 102 | 1.1 | 7.2 | 20.0 | 2.3 | 3.2 | 1.9 |
| floor | 101 | 1.3 | 13.3 | 17.7 | 2.5 | 2.2 | 2.0 |
| floor | 102 | 0.8 | 13.8 | 18.9 | 2.0 | 1.9 | 1.7 |
| upwell | 101 | 2.2 | 12.4 | 6.0 | 2.7 | 2.6 | 2.1 |
| upwell | 102 | 6.0 | 17.2 | 8.1 | 3.1 | 1.7 | 2.6 |
| all | 101 | 3.2 | 15.8 | 9.0 | 2.2 | 2.8 | 0.8 |
| all | 102 | 2.8 | 16.9 | 8.1 | 1.1 | 3.2 | 0.5 |
| rps | 101 | 3.7 | 14.7 | 13.7 | 3.9 | 1.5 | 2.5 |
| rps | 102 | 0.5 | 6.6 | 13.1 | 3.7 | 3.5 | 1.3 |

**Enclosure census and polymer at step 30,000**

| arm | seed | bodies | largest body (cells) | cells with P ≥ 1 / 4 / 16 / 64 | mean P in z56–63 | enclosures at shell 1 / 4 / 16 | bands |
|---|---:|---:|---:|---|---:|---|---:|
| base | 101 | 41 | 199,045 | 1895 / 971 / 367 / 0 | 0.39 | 0 / 0 / 0 | 0 |
| base | 102 | 3 | 115,633 | 1704 / 1477 / 1266 / 0 | 1.14 | 0 / 0 / 0 | 0 |
| surface | 101 | 1 | 145,109 | 1 / 0 / 0 / 0 | 0 | 0 / 0 / 0 | 0 |
| surface | 102 | 1 | 142,097 | 0 / 0 / 0 / 0 | 0 | 0 / 0 / 0 | 0 |
| sink | 101 | 13 | 111,819 | 2555 / 1778 / 1257 / 0 | 1.10 | 0 / 0 / 0 | 0 |
| sink | 102 | 26 | 163,152 | 3034 / 1996 / 1203 / 0 | 0.38 | 0 / 0 / 0 | 0 |
| floor | 101 | 1 | 151,773 | 2252 / 1643 / 1236 / 0 | 1.14 | 0 / 0 / 0 | 0 |
| floor | 102 | 3 | 116,085 | 2433 / 1511 / 1243 / 0 | 1.08 | 0 / 0 / 0 | 0 |
| upwell | 101 | 6 | 136,457 | 2113 / 1584 / 1291 / 0 | 1.06 | 0 / 0 / 0 | 0 |
| upwell | 102 | 3 | 124,819 | 2981 / 1606 / 1271 / 0 | 1.16 | 0 / 0 / 0 | 0 |
| all | 101 | 1 | 129,381 | 136 / 3 / 0 / 0 | 0 | 0 / 0 / 0 | 0 |
| all | 102 | 1 | 136,905 | 26 / 0 / 0 / 0 | 0 | 0 / 0 / 0 | 0 |
| rps | 101 | 4 | 139,166 | 1837 / 1479 / 1248 / 0 | 1.15 | 0 / 0 / 0 | 0 |
| rps | 102 | 2 | 164,818 | 2161 / 1639 / 511 / 0 | 0.72 | 0 / 0 / 0 | 0 |

The shell thresholds were moved down after the timed run's P histogram: no cell anywhere holds `P ≥ 64` (the largest bin is
32–63). The 256 and 1024 thresholds planned at first could never fire.

**Types in the rps arm, % of living cells (type 0 beats 1, 1 beats 2, 2 beats 0 at founding)**

| seed | 5k | 10k | 15k | 20k | 25k | 30k |
|---|---|---|---|---|---|---|
| 101 | 54 / 24 / 23 | 70 / 17 / 13 | 73 / 17 / 10 | 92 / 0.4 / 8 | 91 / 0.3 / 9 | 91 / 0.5 / 9 |
| 102 | 42 / 34 / 23 | 77 / 2 / 22 | 82 / 0.2 / 18 | 86 / 0.3 / 13 | 91 / 0.6 / 9 | 93 / 0.5 / 6 |

## 4. Pictures

- **Contact sheets** (the slab page's Volume view, ray march, side camera, step 30,000, one still per arm):
  `runs/jar-levers-screen/sheet-side-101/sheet.png` and `runs/jar-levers-screen/sheet-side-102/sheet.png`. They come from
  `tools/volume-capture/capture.ts --sheet`, with JSON sidecars beside them. The page re-runs each arm from step 0 with the
  same config and start (`apps/lab/src/slab/settings.ts` builds them from `jar-levers-arms.ts`). The browser's living count at
  step 30,000 equals the Deno run's in all 14 stills, so the sheets show the worlds in the tables.
- **Side views:** `runs/jar-levers-screen/side-views.png`, from the screen's own end states. Bound mass B + P is summed over y,
  with x across and z down (surface at the top), log scale, darker meaning more mass. Rows are arms; columns are seeds 101 and 102.

## 5. Reading

These are descriptions. With two seeds, nothing below separates cause from seed noise, and patterns seen at one seed only are
marked as such.

**The floor mat follows founders that start deep.**
- In every arm whose founders can land at any depth (base, sink, floor, upwell, rps), the floor group is 33–89% living at
  both seeds.
- In the two arms with founders in the top 8 layers (surface, all), the floor group is 0% at both seeds, and so are
  z 40–55.
- That matches the light screen's hypothesis that the floor mat comes from founder placement. It is 2 seeds of 2 per
  arm, with x and y unchanged, so it is a strong hint rather than a demonstration.
- Most of the polymer is in the floor group: mean P is 0.4–1.2 per cell in z 56–63. Elsewhere it is 0 to 0.1, with one
  exception: sink at seed 102 has 0.71 in z 0–7, more than its floor's 0.38.
- Without a floor mat there is essentially no polymer at all (0–136 cells with any P). Why the floor mats build more
  polymer than the surface mats is unexplained.

**Without floor founders, the lit mat has a sharp lower edge.**
- In the surface arm it stops at z 32–39 (47–58% living in that group at both seeds), with nothing below. In the all arm it stops one group higher (2–24% in z 32–39).
- Below the edge the water still has 73% of the surface light (176–177) and 12–16 nutrient per cell.
- So, as in the light screen, neither light nor nutrient in any simple sense sets the depth. Unexplained.

**Sinking did not leave dark waste on the floor.**
- Waste on the floor is 1.9–3.0 per cell, about what the surface group holds.
- Instead, nutrient piles up at depth: 17–20 per cell in z 56–63, against 11–14 in the baseline.
- At `lightK` 4096 the floor still gets about 75–80% of the surface light. A likely reading, which this screen does not
  test (the per-layer fluxes were not saved), is that light-driven abiotic recycling turns sunk waste back into nutrient
  wherever it lands. If so, sinking here moves nutrient downward rather than taking matter out of the light. Only the A
  and C profiles above are measured.
- The living profile under sinking differs a lot between the seeds: a hollow middle at 101, a mat down to z 47 at 102.

**Floor decay added little on top of sinking.** Floor waste is a little lower (1.7–2.0 against 1.9–3.0). The living and
activity profiles look like the sink arm's at seed 101 and like the baseline's at seed 102.

**Upwelling bends the nutrient profile.**
- The top gets more nutrient (2.2–6.0 against 0.3–2.2 in the baseline) and the floor less (6–8 against 11–14).
- The top group's share of activity rises to 43–44% at both seeds.
- Living is 59% at both seeds.

**All levers together look like surface founders.**
- There is no floor mat and no polymer, and living is 49–52%.
- It is the most top-heavy arm: the top two groups carry 84–88% of activity.
- The overturn reaches the floor (A falls from about 16 at z 24–39 to 8–9 at the floor), but nothing lives there to use it.

**The vacancy kill with mutation lost its ring within the run.**
- Type 1 fell below 1% of living cells by step 20,000 (seed 101) and by step 10,000 to 15,000 (seed 102), although it had
  as many founder balls as type 0 (three each, two for type 2).
- Type 0, which beats type 1 at founding, rose to 91–93%. Type 2 held 6–9%.
- No type went extinct. The masks were not recorded, so whether the survivors still form a ring is unknown.
- **Rate-0 control (added after the screen, scratch runs).** The same arm with `rpsRate` 0 (labels and mutation live, no
  kill) keeps type 1 at 24% (seed 101) and 28% (seed 102) at step 30,000; the type shares are 75 / 24 / 1 and 55 / 28 / 17.
  Matter and energy were exact. So the collapse of type 1 needs the kill, at both seeds. Without the kill, type 2 almost
  vanishes at seed 101 instead, so founder growth alone also moves the shares a lot.
- The rps arm has the lowest id turnover (0.19–0.21).

**No enclosures anywhere.**
- At shell thresholds of 1, 4 and 16 there are no bounded pockets at all, let alone ones with life inside.
- Polymer is too scarce: at most about 3,000 of 262,144 cells hold any, none holds 64, and it sits on the floor layer
  group.
- In each run the largest 26-connected body (the carpet) holds 75–100% of the living cells (112,000–199,000 cells). The
  census does not size the other bodies (1 to 41 per run).
- The census can only say something once there is a polymer builder.

**Turnover is low, and lineage counts track the founders.**
- Occupancy turnover is 2–11% of living cells per 1,000 steps. The carpets are mostly static.
- Lineage ids churn 18–44% per 1,000 steps, which is mutation (350–530 events per 1,000 steps).
- Arms founded at the surface end with fewer lineages (58–76 against 158–263) and higher lineage turnover (0.35–0.44).
  Their lineage count peaks near 90–100 at 15–20k and falls after that.

**By eye (side views).**
- At seed 101 only, ropes of life hang at mid-depth between the surface mat and the floor mat: in sink, floor and rps, with
  a thinner one in upwell. The side view is a projection over y, but the contact sheet shows them in 3D as tubes, some
  branching or arched, not sheets. Seed 102 has none, so this is a single-seed pattern.
- In the contact sheets, the surface mats of the surface and all arms are one or two lineage colours, which fits their low
  lineage counts. The floor mats are the most mixed in colour.
- Small round blobs hang at mid-depth (base, floor and upwell at seed 102). They look like the frozen founder balls of the
  light screen.
- The top mats show regular vertical striping in most arms.

## 6. Next steps

1. **Make the floor dark before judging sinking.** Repeat sink and floor at `lightK` 1024–2048, where the light screen's lid
   leaves the deep jar dimmer, or cut `kAbio`. Otherwise sunk waste is recycled by light wherever it lands.
2. **Confirm the floor-mat origin with more seeds** (three to five per arm), and add the inverse arm, founders in the bottom
   8 layers only.
3. **Give the enclosure census something to count.** Seed a polymer builder (a BUILD-biased founder, or a higher `kBuild`),
   or look at why floor-mat cells build P. The generalist barely builds polymer anywhere else.
4. **Vacancy kill with mutation:** record the masks, to see whether the survivors still form a ring and whether mask
   mutants spread. Run longer, and add the rate-0 control to the runner as a proper arm.
5. **The lower edge of the lit mat (z 32–39)** has now shown up in four arms. A per-layer look at U, flow and the growth
   bell near that edge would say whether it comes from the Lenia affinity rather than from chemistry.
