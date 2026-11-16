# 3D mycelium: owner sizing and a dark floor (16 Nov 2026)

**EXPLORATION.** Follows the first trail screen (`experiments/mycelium3d/trail-screen-2026-11-15.md`), plan Phase 1 (`docs/3d-expansion-plan-2026-11-15.md`, section 3). There is no pre-registration, no gate and no label. Runs are judged by eye from the pictures plus descriptive numbers. Four fresh seeds per arm; a pattern seen in one seed only is marked as such.

**Bottom line.**
- **The dark floor works as a lever.** With the new `wasteShade` 2, the floor layer gets 9/256 of the light instead of 49/256 (seed means, no rule; every seed lower). The floor group holds a third of the particles it held before (471 against 1,387). The population holds (9,805 against 10,408), and the surface group gains particles on three of four seeds.
- **At sinking 6 the owner rules still do not form territories.** The gate and the conduit were raised to their limits: θ down to 1 (the strongest gate) and g up to 255. Owners by id never formed in any pilot. By genotype, at θ 1 and g 255, 0 of the 4 fresh seeds met the "formed" bar set before the pilots (1 of 2 pilot seeds did). The one high-sharing fresh seed (seed 11, share 0.61) is one genotype's patch: it holds 98% of the owned cells.
- **Without sinking, what forms is one owner, not territories.** The same setting met the bar on both pilot seeds at 50k (share 0.78 and 0.85). But one genotype held 88% and 99% of the owned cells over the late window, and seed 21 ended as a single owner on exactly 4,096 cells, a whole layer, near the surface. So these rules give one clone's sheet rather than many territories, and sinking 6 stops even that from holding.
- **Toll versus its movement cost.** The toll keeps trail (535k P, all four seeds). `moveCost` 12 alone keeps about 2% of that (11k mean, two seeds near zero), not clearly outside no-rule seed noise. So most of the toll's trail is not explained by the higher movement cost (the discount at `moveCost` 2 was not run).
- **The toll is two-state here, and differs from screen 1.** On seeds 13 and 14, the toll keeps trail in the surface groups (76k and 52k P in G1–2), and particles carry matter up strongly (net 2.3M and 2.1M matter-layers per 1,000 steps). A trail component runs from the surface group to the floor group in 13 of 13 late readouts on seed 13 and 8 of 13 on seed 14. Screen 1 found no such component late in any sinking run. On seeds 11 and 12 the toll is a floor bed, as in screen 1. No other arm has a surface-to-floor component late in any seed.
- **Dark floor plus owner rules: no ownership** (at most 561 owned cells in any seed).

## Part 1: the dark-floor lever, `wasteShade`

- **Rule.** Written into `tools/mycelium3d/RULES.md` ("Waste shading") before the code.
  - Optional key `wasteShade` k, an integer in 0..16, absent by default.
  - When set, a cell's shading matter becomes `m = min(P + Mb + (C >> k), MCAP)`, with C at the start of the step.
  - A cell still shades only the cells below it. So the waste pile on the floor layer shades nothing, and the floor darkens only from the waste falling through the water column above it.
  - No matter moves and no draw is taken, so both ledgers are untouched. `P + Mb + C` is at most the total matter (2^31), so the u32 sum is exact before the `min`.
- **Code.**
  - `world.ts`: `shade()` takes C; `validateConfig` knows the key.
  - `gpu.ts`: `k_shade` adds `fl(F_C + above) >> WSHIFT` under a `WS_SET` const.
  - `defaultConfig()` does not carry the key.
- **Absent key unchanged.**
  - Every digest of the 69 existing parity cases is unchanged: the run before the edit and the run after give the same digest set.
  - The two digests pinned from the pre-change `world.ts` (`cfabc7c1a99c0a85`, `c64187585962f447`) are now unit tests.
- **Parity.** `tests/deno/mycelium3d_gpu.ts` now has 79 cases, all bit for bit. The 10 new ones are:
  - `wasteShade` 0 with sinking 6;
  - 3 with sinking 4 and `lightK` 16;
  - 2 on the 13×9×5 odd shape with gradient light 3;
  - 4 on the default 32×32×16 with sinking 6;
  - 1 with sinking, the toll and the owner gate and conduit;
  - D = 1 equals no waste shading (`same: true`);
  - C saturating MCAP;
  - shift 16 with 2^19 waste per cell (so `C >> 16` is not 0);
  - a per-step case (`seg: 1`, id owners);
  - a resume variant (sinking 6, `wasteShade` 2, owner gate and conduit).

  The five lever cases and the two saturation cases are each checked against their keyless baseline, so none is vacuous; the D = 1 case is checked to equal its baseline.
- **CPU tests** (`tools/test/mycelium3d.test.ts`, 43 tests):
  - exact plane values for k 0, 1 and 16;
  - floor-layer waste shades nothing;
  - waste one layer above the floor shades only the floor;
  - the cap applies to the sum;
  - ledgers exact on every step for two new lever sets (3,000 steps);
  - a resume equals the continuous run with the key;
  - the floor is darker with the key on (16×16×8, sinking 6, 1,500 steps);
  - range validation;
  - the key absent from `defaultConfig()`;
  - the pinned digests.
- **Who exposes it.**
  - `/mycelium3d/` (`apps/lab/src/mycelium3d/settings.ts` sets `sinkShift` and does not know `wasteShade`) needs a control if the page is to show it. That page belongs to the other agent and was not touched.
  - The screen has it through the grids in `tools/mycelium3d/observe-screen.ts`, which `screen.ts --grid` selects.

### Choosing the value (probe, seeds 21 and 22, 20,000 steps, no rule, sink 6, `lightK` 64)

Late-window means (seed 21 / seed 22). The floor layer is z 31 alone; G8 averages layers 28 to 31.

| `wasteShade` | particles | in G8 | light G8 /256 | light floor layer /256 | genotypes (final) |
|---|---|---|---|---|---|
| absent | 11,388 (12,111 / 10,666) | 1,457 | 53 | 49.0 (46.5 / 51.6) | 5,384 |
| 0 | 7,954 (8,533 / 7,375) | 98 | 3 | 0.0 (0.0 / 0.0) | 3,555 |
| 2 | 10,868 (10,926 / 10,810) | 489 | 18 | 6.3 (5.9 / 6.7) | 5,244 |
| 4 | 11,097 (11,327 / 10,868) | 1,020 | 36 | 25.9 (25.7 / 26.2) | 5,465 |
| 6 | 12,144 (12,314 / 11,975) | 1,298 | 46 | 40.0 (39.5 / 40.5) | 5,957 |

**Chosen: 2.** It is the mildest value that takes the floor layer to near dark (about an eighth of the unshaded floor) while the population stays within 5%. At 0, the floor is fully dark but the population falls by 30%. The value was chosen on a no-rule world; the owner-plus-shade arm was not piloted.

## Part 2: sizing the owner gate and conduit

### "Formed", fixed before the pilots ran

A run's owned territories have **formed** when, over the late window (readouts in the second half of the run), all three hold:

1. **Same-owner edge share ≥ 0.33**: at least a third of the directed face edges from owned cells reach a cell with the same owner.
   - A one-cell-thick filament has at most 2 of 6 same-owner faces (0.33), a sheet 4 of 6, and a solid blob 6 of 6.
   - Screen 1 had 0.04 to 0.09. The 2D territorial runs had 0.58 to 0.98 and the idle ones 0.02 to 0.07 (in 2D a cell has 4 faces).
2. **Median min(Q, Q) ≥ 4** on those same-owner edges. Below that, the conduit's extra rate `(min(Q, Q, q) · g) >> 4` is under g / 4. Screen 1 had 1.
3. **At least 1,000 owned cells** (0.8% of 131,072), so that a handful of cells cannot make the share.

A setting is **formed** when both pilot seeds meet all three, and **split** when one does. The bar was not moved after the runs.

### The levers and their direction

- **θ (`ownerDefend`).** The gate zeroes my eating request on a cell owned by a stranger with Q ≥ θ. Raising θ therefore weakens the gate. Screen 1's median min(Q, Q) was 1, so its θ 4 almost never fired.
  - The pilots swept θ over 1, 4, 16 and 64: down to the strongest value as well as up.
  - **This deviates from the task's "raise them".** Raising θ only weakens the gate.
- **g (`ownerConduit`).** g acts only on edges that already share an owner: the extra A rate is `min(De + ((min(Q, Q, q) · g) >> 4), 128) − De`, with headroom 88 at `diffA` 40. g 255 is the rule's maximum. At Q = 1, even g 255 gives only 15 of the 88.
- **Owner mode.** Both modes exist and both were tried: `gid` (clone) and `id` (individual).

### Pilots

- **Substrate.** The second screen's: sinking 6, `lightK` 64, 64×64×32, 8,192 founders.
- **Seeds.** 21 and 22, kept off the screen's seeds.
- **Length.** 20,000 steps; promising cells were extended to 50,000.
- **Diagnostics.**
  - No sinking (`sinkoff`) at θ 1, g 255.
  - The toll substrate the 2D territories formed on (`ownertoll`: the screen-1 toll plus the owner keys).
- **Columns.** Each cell is "seed 21 / seed 22", as late-window means.
  - **Extra rate** is the conduit's extra A rate on an edge at the late mean median min(Q, Q), rounded.
  - **Formed** is Y or n per seed.
- **Ledgers.** Every pilot run closed both ledgers at every read (every 20 steps).
- **Output.**
  - `runs/mycelium3d-owner-pilots-2026-11-16` (20k);
  - `runs/mycelium3d-owner-pilots-50k-2026-11-16`;
  - `runs/mycelium3d-owner-pilots-50k-v5-2026-11-16`, the chosen setting rerun with the owner-count readout. Its runs are deterministic, with the same final n and trail as the first 50k run.
  - `runs/mycelium3d-owner-pilots-sinkoff-50k-2026-11-16`, the no-sinking diagnostic at 50k with the owner-count readout.

| setting | steps | particles | trail P | same-owner share | median min(Q,Q) | owned cells | extra rate (of 88) | formed |
|---|---|---|---|---|---|---|---|---|
| `sink6.owner.gid.t1.g120.k64` | 20k | 11,584 / 6,695 | 32,281 / 356,166 | 0.35 / 0.65 | 4.2 / 2.4 | 1,842 / 32,501 | 30 / 15 | Y / n |
| `sink6.owner.gid.t1.g255.k64` | 20k | 11,392 / 6,968 | 62,175 / 288,189 | 0.66 / 0.59 | 7.0 / 2.0 | 1,832 / 37,137 | 88 / 31 | Y / n |
| `sink6.owner.gid.t1.g30.k64` | 20k | 12,120 / 10,941 | 20,090 / 29,992 | 0.09 / 0.41 | 1.0 / 2.4 | 5,109 / 3,271 | 1 / 3 | n / n |
| `sink6.owner.gid.t16.g120.k64` | 20k | 12,591 / 11,892 | 13,893 / 4,815 | 0.07 / 0.10 | 1.0 / 1.0 | 3,704 / 1,399 | 7 / 7 | n / n |
| `sink6.owner.gid.t16.g255.k64` | 20k | 12,074 / 11,897 | 10,572 / 3,339 | 0.11 / 0.08 | 1.0 / 1.0 | 3,033 / 974 | 15 / 15 | n / n |
| `sink6.owner.gid.t16.g30.k64` | 20k | 12,180 / 11,582 | 4,833 / 11,415 | 0.10 / 0.07 | 1.0 / 1.0 | 1,424 / 3,379 | 1 / 1 | n / n |
| `sink6.owner.gid.t4.g120.k64` | 20k | 12,216 / 11,906 | 1,042 / 4,312 | 0.06 / 0.06 | 1.0 / 1.0 | 323 / 1,291 | 7 / 7 | n / n |
| `sink6.owner.gid.t4.g255.k64` | 20k | 11,335 / 11,421 | 60,506 / 10,712 | 0.31 / 0.14 | 4.6 / 2.6 | 3,938 / 1,329 | 79 / 47 | n / n |
| `sink6.owner.gid.t4.g30.k64` | 20k | 12,445 / 12,262 | 72 / 3,623 | 0.04 / 0.06 | 0.4 / 1.0 | 26 / 1,073 | 0 / 1 | n / n |
| `sink6.owner.gid.t64.g120.k64` | 20k | 12,724 / 11,115 | 15,104 / 6,168 | 0.08 / 0.06 | 1.0 / 1.0 | 3,801 / 1,795 | 7 / 7 | n / n |
| `sink6.owner.gid.t64.g255.k64` | 20k | 12,709 / 10,924 | 13,037 / 11,794 | 0.10 / 0.08 | 1.0 / 1.0 | 3,295 / 3,159 | 15 / 15 | n / n |
| `sink6.owner.gid.t64.g30.k64` | 20k | 12,536 / 11,797 | 25,116 / 951 | 0.09 / 0.05 | 1.0 / 1.0 | 6,126 / 344 | 1 / 1 | n / n |
| `sink6.owner.id.t1.g120.k64` | 20k | 12,350 / 11,685 | 3,790 / 7,904 | 0.07 / 0.06 | 1.0 / 1.0 | 1,128 / 2,129 | 7 / 7 | n / n |
| `sink6.owner.id.t1.g255.k64` | 20k | 11,834 / 12,012 | 353 / 7,263 | 0.04 / 0.07 | 1.0 / 1.0 | 96 / 1,770 | 15 / 15 | n / n |
| `sink6.owner.id.t1.g30.k64` | 20k | 11,908 / 11,916 | 7,875 / 8,753 | 0.08 / 0.06 | 1.0 / 1.0 | 2,121 / 2,641 | 1 / 1 | n / n |
| `sink6.owner.id.t16.g120.k64` | 20k | 11,784 / 11,549 | 5,263 / 9,080 | 0.08 / 0.04 | 1.0 / 1.0 | 1,593 / 2,584 | 7 / 7 | n / n |
| `sink6.owner.id.t16.g255.k64` | 20k | 11,685 / 11,383 | 974 / 11,907 | 0.05 / 0.08 | 1.0 / 1.0 | 280 / 2,912 | 15 / 15 | n / n |
| `sink6.owner.id.t16.g30.k64` | 20k | 11,276 / 12,281 | 1,190 / 9,753 | 0.06 / 0.06 | 1.0 / 1.0 | 359 / 2,401 | 1 / 1 | n / n |
| `sink6.owner.id.t4.g120.k64` | 20k | 12,705 / 10,498 | 3,061 / 1,951 | 0.09 / 0.06 | 1.0 / 1.0 | 854 / 560 | 7 / 7 | n / n |
| `sink6.owner.id.t4.g255.k64` | 20k | 12,408 / 10,137 | 3,067 / 58,485 | 0.10 / 0.07 | 1.0 / 1.0 | 775 / 11,421 | 15 / 15 | n / n |
| `sink6.owner.id.t4.g30.k64` | 20k | 12,375 / 11,055 | 1,705 / 23,530 | 0.10 / 0.05 | 1.0 / 1.0 | 485 / 6,428 | 1 / 1 | n / n |
| `sink6.owner.id.t64.g120.k64` | 20k | 12,149 / 12,317 | 7,154 / 1,396 | 0.08 / 0.05 | 1.0 / 1.0 | 2,145 / 430 | 7 / 7 | n / n |
| `sink6.owner.id.t64.g255.k64` | 20k | 12,444 / 11,709 | 8,517 / 15,111 | 0.07 / 0.08 | 1.0 / 1.0 | 2,477 / 4,410 | 15 / 15 | n / n |
| `sink6.owner.id.t64.g30.k64` | 20k | 12,547 / 11,925 | 842 / 7,221 | 0.06 / 0.05 | 1.0 / 1.0 | 255 / 2,025 | 1 / 1 | n / n |
| `sink6.ownertoll.gid.t1.g120.k64` | 20k | 5,241 / 5,083 | 519,435 / 502,821 | 0.21 / 0.80 | 1.0 / 3.0 | 54,425 / 36,619 | 7 / 22 | n / n |
| `sink6.ownertoll.gid.t4.g120.k64` | 20k | 4,975 / 5,192 | 602,695 / 528,485 | 0.08 / 0.07 | 1.0 / 1.0 | 29,115 / 29,191 | 7 / 7 | n / n |
| `sink6.ownertoll.id.t1.g120.k64` | 20k | 5,359 / 5,154 | 519,344 / 518,154 | 0.14 / 0.11 | 1.0 / 1.0 | 52,786 / 43,735 | 7 / 7 | n / n |
| `sink6.ownertoll.id.t4.g120.k64` | 20k | 5,292 / 5,240 | 525,360 / 519,482 | 0.04 / 0.05 | 1.0 / 1.0 | 25,771 / 29,433 | 7 / 7 | n / n |
| `sinkoff.owner.gid.t1.g255.k64` | 20k | 13,943 / 12,918 | 143,272 / 325,924 | 0.68 / 0.84 | 20.2 / 16.0 | 4,219 / 8,969 | 88 / 88 | Y / Y |
| `sinkoff.owner.id.t1.g255.k64` | 20k | 15,363 / 15,793 | 449 / 1,205 | 0.12 / 0.11 | 1.0 / 1.0 | 295 / 866 | 15 / 15 | n / n |
| `sink6.owner.gid.t1.g120.k64` | 50k | 10,743 / 5,883 | 4,146 / 472,377 | 0.10 / 0.75 | 1.0 / 3.0 | 1,019 / 37,506 | 7 / 22 | n / n |
| `sink6.owner.gid.t1.g255.k64` | 50k | 11,495 / 4,893 | 35,823 / 481,667 | 0.66 / 0.76 | 7.1 / 2.0 | 1,062 / 50,302 | 88 / 31 | Y / n |
| `sink6.owner.gid.t1.g30.k64` | 50k | 12,371 / 10,757 | 14,028 / 3,928 | 0.09 / 0.26 | 1.0 / 1.5 | 3,713 / 675 | 1 / 1 | n / n |
| `sinkoff.owner.gid.t1.g255.k64` | 50k | 12,467 / 13,036 | 157,936 / 328,841 | 0.78 / 0.85 | 26.1 / 15.8 | 4,081 / 8,762 | 88 / 88 | Y / Y |
| `sink6.owner.gid.t4.g255.k64` | 50k | 11,634 / 11,330 | 26,803 / 2,959 | 0.32 / 0.05 | 3.8 / 1.0 | 1,649 / 897 | 63 / 15 | n / n |

**Owner counts for the chosen setting** (`sink6.owner.gid.t1.g255.k64`, 50k, readout v5). Each entry is distinct owners / largest owner's share of the owned cells / owned cells, at steps 2k, 8k, 14k and so on:

- seed 21: 301/0.07/6,880, 21/0.57/2,128, 10/0.55/1,869, 12/0.63/1,720, 23/0.65/1,572, 18/0.59/1,292, 8/0.67/1,100, 10/0.90/820, 7/0.95/494. There were 5,076 live genotypes at the end.
- seed 22: 626/0.07/10,846, 429/0.38/14,688, 421/0.88/26,390, 225/0.99/56,794, then 150 owners at 0.99 with about 50,000 cells to the end. There were 99 live genotypes at the end, and 4,893 particles against 11,495.

**What the pilots show.**
- **Owners by id never formed** (all 12 sink-6 id settings, the no-sinking id pair and both toll id pairs: share 0.04 to 0.14, min(Q, Q) 1).
- **By genotype, only θ 1 moves the share.** θ 4 to 64 stayed at 0.04 to 0.14 except θ 4, g 255, seed 21 (0.31 at 20k; 0.32 at 50k, falling to 0.12 at the end).
- **At θ 1, g matters.** g 30 stays near idle on seed 21. g 120 and g 255 each formed on seed 21 at 20k. **The 20k flags were unstable:** g 120 seed 21 fell from share 0.35 at 20k to 0.10 at 50k.
- **The worlds have two states, as in 2D.** At θ 1 with g 120 or 255, each world ends in one of two states:
  - **Seed 21: a small patch held by a few owners, mostly one.** About 1,000 owned cells, 7 to 23 owners, the largest holding 55% to 95%, shrinking late. Population about 11,500.
  - **Seed 22: a carpet held by one genotype.** About 50,000 owned cells, 99% of them held by one gid, median Q 2 to 3, about 480,000 trail. The population halves (about 4,900) and live genotypes fall to 99. That fails the min(Q, Q) bar (2.0; the extra rate there is 31 of 88). It is not many territories, so it is not counted as formed.
- **Without sinking it forms, but as one owner.** Without sinking, the same gid θ 1, g 255 met the bar on both seeds, at 20k and again at 50k. At 50k (readout v5, `runs/mycelium3d-owner-pilots-sinkoff-50k-2026-11-16`): share 0.78 and 0.85, median min(Q, Q) 26 and 16, extra rate at the cap, 4,081 and 8,762 owned cells.
  - The owner counts show one clone. Over the late window there were 8 and 51 owners on average, with the largest holding 88% and 99% of the owned cells.
  - Seed 21 ended with 1 owner on 4,096 cells, a whole 64 × 64 layer: the largest trail component is 4,096 cells at layers 0 to 1. Seed 22 ended with one owner holding 99% of 8,813 cells in layers 0 to 3.
  - Live genotypes stayed at about 4,300, so the population did not collapse; one clone owns the trail.
  - So sinking stops this sheet from forming. Without sinking, though, the pre-set bar is met by one owner, not by many territories.
- **The toll substrate did not help.** It carpets the floor with about 500k of mostly stranger-owned trail. Its one high share (gid θ 1, seed 22: 0.80) has min(Q, Q) 3.
- **Sized strength: `trailOwner` gid, `ownerDefend` 1, `ownerConduit` 255, cap absent.**
  - Of the levers the task named, it is the only setting that held a share above 0.33 on both seeds at 50k, and it formed on one of the two.
  - It is labelled **split** by the bar above.
  - θ is at its minimum and g at its maximum, so these levers are exhausted at sinking 6. No 7th arm was added: the toll substrate is not what forms territories here.
  - The bar did not count owners. Judged by owner counts, no pilot formed **territories** (several owners each holding their own region). What formed is one genotype's patch, sheet or carpet.

## Part 3: the second screen

### Setup

- **Rule.** `mycelium3d-r0` with the new optional `wasteShade`, on the GPU twin. The kernel files (`packages/*/src`) were not touched.
- **World.** As in screen 1: 64 × 64 × 32, 8,192 founders, `maxParticles` 65,536, every other key `defaultConfig()`. All arms use `sinkShift` 6 and `lightK` 64. No birth was refused in any run.
- **Seeds.** 11, 12, 13 and 14 (fresh). 50,000 steps. 6 arms × 4 seeds = 24 runs.
- **Arms** (`observe-screen.ts` `SCREEN2`):
  - `none`: no rule.
  - `toll`: screen 1's toll, `trailMoveDiscount` 64 toll **and `moveCost` 12**.
  - `move12`: `moveCost` 12 only, no toll keys. It separates the toll from its movement cost.
  - `owner`: gid, θ 1, g 255, cap absent (sized above), no toll.
  - `owner ws2`: the same plus `wasteShade` 2.
  - `none ws2`: no rule plus `wasteShade` 2.
- **Ledger.** Full state read back every 20 steps (2,500 reads per run, 60,000 in all): both residuals exactly 0 at every read. `validateState` ran every 2,000 steps and found nothing.
- **Readouts.** Everything screen 1 recorded (`observe-screen.ts`), plus:
  - the floor layer's own light;
  - in owner worlds, the owned cells, the median Q over them, the distinct owners, and the largest owner's share. These came from a review: share and median Q cannot tell one owner's carpet from many territories.

  `READOUT_VERSION` 5.
- **Timing.** One 50k owner pilot run took 133 to 158 s at `--jobs 2`, so 24 runs were projected at about 28 minutes, well under the 3-hour limit. The screen took 27.4 minutes of wall time (06:22 to 06:49 UTC); runs took 129 to 152 s each at `--jobs 2`, on a machine at load about 370.
- **Commands.**
  ```
  deno run -A --no-lock tools/mycelium3d/screen.ts --grid shade-pilots --out runs/mycelium3d-shade-pilots-2026-11-16 --steps 20000 --jobs 2
  deno run -A --no-lock tools/mycelium3d/screen.ts --grid owner-pilots --out runs/mycelium3d-owner-pilots-2026-11-16 --steps 20000 --jobs 2
  deno run -A --no-lock tools/mycelium3d/screen.ts --grid owner-pilots --out runs/mycelium3d-owner-pilots-50k-2026-11-16 --steps 50000 --jobs 2 --only sink6.owner.gid.t1.g   (and --only sink6.owner.gid.t4.g255)
  deno run -A --no-lock tools/mycelium3d/screen.ts --grid owner-darkfloor --out runs/mycelium3d-owner-darkfloor-2026-11-16 --steps 50000 --jobs 2
  deno run -A --no-lock tools/mycelium3d/screen.ts --grid owner-darkfloor --out runs/mycelium3d-owner-darkfloor-2026-11-16 --table   (and --render)
  ```
- **Raw output.** `runs/mycelium3d-owner-darkfloor-2026-11-16/` (gitignored): `runs/<id>.json`, `run-log.jsonl`, `table.md` (the full table, including the transport and flux rows and the by-depth tables), `png/`, `contact-sheet.png`.
- **Contact sheet.** `experiments/mycelium3d/owner-darkfloor-screen-2026-11-16-contact-sheet.png`. It has one row per arm and one column per seed (11 to 14), at step 50,000.
  - Each tile has top views above (x by y, summed over z) and side views below (x by z, surface up).
  - Particles are orange and trail is green, on one log scale shared by every tile.

### Results per arm

Late window, steps 25,000 to 50,000. Each cell is "seed mean (11 / 12 / 13 / 14)".

| readout | none | toll | move12 | owner | owner ws2 | none ws2 |
|---|---|---|---|---|---|---|
| particles | 10,408 (11,773 / 10,524 / 10,192 / 9,145) | 5,021 (5,339 / 5,034 / 4,724 / 4,987) | 8,979 (9,396 / 8,684 / 8,922 / 8,913) | 10,561 (11,033 / 10,761 / 10,007 / 10,443) | 9,332 (10,332 / 8,906 / 8,444 / 9,644) | 9,805 (10,566 / 10,029 / 8,378 / 10,249) |
| in G1 | 1,657 (3,434 / 1,011 / 957 / 1,227) | 204 (3 / 0 / 456 / 356) | 963 (1,304 / 497 / 1,790 / 262) | 1,449 (1,945 / 1,348 / 677 / 1,826) | 1,707 (2,914 / 783 / 737 / 2,392) | 2,547 (3,616 / 2,780 / 808 / 2,983) |
| in G8 | 1,387 (1,162 / 1,461 / 1,528 / 1,398) | 978 (1,213 / 966 / 834 / 899) | 1,337 (1,190 / 1,377 / 1,251 / 1,531) | 1,482 (1,307 / 1,411 / 1,640 / 1,568) | 546 (413 / 631 / 500 / 641) | 471 (369 / 380 / 619 / 514) |
| trail P | 910 (122 / 3,486 / 34 / 0) | 535,050 (537,837 / 592,277 / 509,436 / 500,652) | 11,164 (37,261 / 0 / 7,353 / 43) | 10,632 (34,034 / 8,479 / 14 / 0) | 469 (0 / 1,854 / 23 / 0) | 5,143 (0 / 20,211 / 361 / 0) |
| P in G1-2 | 32 (0 / 110 / 18 / 0) | 32,130 (387 / 0 / 75,774 / 52,360) | 210 (221 / 0 / 619 / 0) | 812 (20 / 3,229 / 0 / 0) | 32 (0 / 126 / 2 / 0) | 57 (0 / 182 / 44 / 0) |
| P in G8 | 667 (122 / 2,534 / 11 / 0) | 212,693 (244,014 / 296,118 / 146,183 / 164,457) | 2,996 (10,025 / 0 / 1,945 / 12) | 8,577 (33,857 / 440 / 9 / 0) | 64 (0 / 243 / 11 / 0) | 2,411 (0 / 9,577 / 67 / 0) |
| occ. cells with trail | 0.006 (0.001 / 0.024 / 0.000 / 0.000) | 0.986 (0.998 / 0.995 / 0.973 / 0.979) | 0.056 (0.182 / 0.000 / 0.042 / 0.001) | 0.035 (0.070 / 0.069 / 0.000 / 0.000) | 0.004 (0.000 / 0.016 / 0.000 / 0.000) | 0.017 (0.000 / 0.064 / 0.003 / 0.000) |
| largest comp | 35 (7 / 132 / 3 / 0) | 61,018 (32,462 / 36,139 / 93,890 / 81,582) | 3,140 (12,444 / 0 / 111 / 3) | 2,451 (8,899 / 905 / 1 / 0) | 8 (0 / 31 / 2 / 0) | 2,417 (0 / 9,664 / 5 / 0) |
| z-span | 1.3 (1.4 / 2.2 / 1.7 / 0.0) | 19.5 (10.8 / 11.1 / 32.0 / 24.2) | 6.1 (15.5 / 0.0 / 7.2 / 1.7) | 3.3 (4.2 / 8.1 / 1.1 / 0.0) | 1.3 (0.0 / 3.8 / 1.3 / 0.0) | 3.2 (0.0 / 10.7 / 2.2 / 0.0) |
| z-span max | 3 (3 / 4 / 3 / 0) | 24 (18 / 12 / 32 / 32) | 11 (26 / 0 / 14 / 3) | 5 (5 / 11 / 2 / 0) | 2 (0 / 6 / 2 / 0) | 4 (0 / 12 / 3 / 0) |
| largest comp above floor | 8 (2 / 25 / 2 / 0) | 56,922 (28,366 / 32,043 / 89,794 / 77,486) | 2,754 (10,944 / 0 / 68 / 3) | 1,427 (4,803 / 905 / 1 / 0) | 8 (0 / 31 / 2 / 0) | 2,069 (0 / 8,270 / 5 / 0) |
| its z-span | 1.4 (1.1 / 2.8 / 1.7 / 0.0) | 18.5 (9.8 / 10.1 / 31.0 / 23.2) | 6.4 (14.9 / 0.0 / 8.9 / 1.7) | 3.0 (3.2 / 8.1 / 0.8 / 0.0) | 1.3 (0.0 / 3.8 / 1.3 / 0.0) | 3.0 (0.0 / 9.7 / 2.2 / 0.0) |
| net up (particles) | -40,288 (1,612,890 / -167,128 / -218,977 / -1,387,938) | 1,200,200 (75,692 / 277,672 / 2,323,309 / 2,124,129) | -149,035 (904,730 / -599,860 / -819,363 / -81,647) | -168,243 (-2,050 / 75,200 / -133,050 / -613,072) | 152,065 (1,297,326 / -151,490 / -304,189 / -233,387) | 766,261 (1,703,351 / 1,162,823 / -167,851 / 366,721) |
| gross up (particles) | 5,350,831 (5,640,796 / 2,214,517 / 5,420,565 / 8,127,444) | 2,487,679 (484,267 / 1,416,444 / 5,016,931 / 3,033,076) | 3,419,462 (2,707,088 / 1,907,114 / 7,386,643 / 1,677,001) | 5,953,387 (5,348,516 / 2,256,769 / 9,026,160 / 7,182,101) | 4,356,104 (4,261,141 / 2,983,379 / 3,382,789 / 6,797,109) | 6,283,749 (5,405,580 / 6,142,342 / 6,481,899 / 7,105,177) |
| matched share | 0.956 (0.971 / 0.939 / 0.936 / 0.978) | 0.951 (0.945 / 0.960 / 0.941 / 0.959) | 0.956 (0.959 / 0.952 / 0.960 / 0.954) | 0.948 (0.947 / 0.931 / 0.952 / 0.964) | 0.953 (0.940 / 0.939 / 0.975 / 0.960) | 0.957 (0.957 / 0.945 / 0.980 / 0.946) |
| sinking down (C+P, expected) | 44,688,152 (43,608,566 / 45,953,153 / 44,833,951 / 44,356,940) | 51,854,766 (51,212,840 / 52,520,472 / 52,101,674 / 51,584,077) | 40,426,700 (40,175,316 / 40,378,034 / 39,312,525 / 41,840,925) | 44,326,410 (43,615,534 / 45,713,850 / 44,012,446 / 43,963,810) | 46,098,693 (45,692,934 / 47,461,905 / 45,902,191 / 45,337,740) | 45,415,666 (45,573,106 / 45,994,216 / 44,887,952 / 45,207,392) |
| diffusion up, C (expected) | 44,679,218 (42,094,975 / 45,836,477 / 45,102,351 / 45,683,070) | 50,853,697 (51,333,138 / 52,565,967 / 49,828,148 / 49,687,535) | 39,759,972 (38,799,828 / 39,944,200 / 39,002,486 / 41,293,374) | 44,512,962 (43,653,323 / 45,184,652 / 44,687,309 / 44,526,563) | 46,007,925 (44,638,149 / 47,560,250 / 46,176,135 / 45,657,165) | 44,745,306 (44,194,211 / 44,863,627 / 44,805,987 / 45,117,399) |
| diffusion up, A (expected) | 117,188 (152,780 / 138,245 / 132,873 / 44,854) | -236,242 (-320,683 / -150,551 / -141,853 / -331,881) | 732,071 (625,645 / 797,610 / 912,115 / 592,915) | 120,419 (114,938 / 155,713 / 116,550 / 94,473) | 59,762 (-4,908 / 153,261 / 2,121 / 88,574) | 53,286 (32,316 / -7,115 / 198,245 / -10,302) |
| net field down (expected) | -108,254 (1,360,810 / -21,570 / -401,273 / -1,370,984) | 1,237,311 (200,386 / 105,056 / 2,415,380 / 2,228,423) | -65,343 (749,843 / -363,777 / -602,076 / -45,363) | -306,971 (-152,727 / 373,484 / -791,414 / -657,226) | 31,006 (1,059,693 / -251,607 / -276,065 / -407,998) | 617,074 (1,346,579 / 1,137,704 / -116,281 / 100,295) |
| births /1k particle-steps | 2.94 (2.01 / 3.90 / 4.28 / 1.57) | 3.54 (4.28 / 3.19 / 3.78 / 2.92) | 2.56 (2.41 / 2.78 / 2.30 / 2.74) | 3.48 (3.39 / 4.39 / 3.54 / 2.59) | 3.08 (3.80 / 3.94 / 1.82 / 2.76) | 2.95 (2.80 / 3.43 / 2.06 / 3.50) |
| deaths | 2.94 (2.01 / 3.90 / 4.28 / 1.57) | 3.54 (4.28 / 3.19 / 3.78 / 2.92) | 2.56 (2.40 / 2.78 / 2.31 / 2.73) | 3.48 (3.39 / 4.40 / 3.54 / 2.59) | 3.08 (3.80 / 3.94 / 1.82 / 2.76) | 2.95 (2.80 / 3.43 / 2.07 / 3.50) |
| genotypes (final) | 4,852 (5,302 / 4,806 / 5,124 / 4,176) | 2,206 (2,474 / 2,176 / 1,888 / 2,284) | 3,985 (4,386 / 3,834 / 3,599 / 4,119) | 4,902 (4,843 / 4,649 / 5,524 / 4,592) | 4,511 (5,045 / 4,308 / 4,591 / 4,099) | 4,742 (4,770 / 4,535 / 5,168 / 4,495) |
| C share in G8 | 0.848 (0.834 / 0.847 / 0.849 / 0.861) | 0.902 (0.912 / 0.911 / 0.892 / 0.892) | 0.844 (0.840 / 0.843 / 0.848 / 0.845) | 0.849 (0.846 / 0.845 / 0.853 / 0.854) | 0.847 (0.838 / 0.849 / 0.849 / 0.852) | 0.842 (0.836 / 0.839 / 0.847 / 0.847) |
| A in G1 | 65,142 (67,798 / 64,626 / 65,345 / 62,799) | 110,474 (122,786 / 99,935 / 108,745 / 110,430) | 121,621 (130,043 / 118,388 / 122,488 / 115,567) | 69,111 (69,207 / 72,351 / 64,486 / 70,400) | 67,589 (70,403 / 63,575 / 64,255 / 72,121) | 70,797 (68,957 / 73,380 / 64,126 / 76,727) |
| light G1/256 | 227 (199 / 241 / 239 / 230) | 247 (256 / 256 / 234 / 243) | 239 (235 / 250 / 217 / 252) | 231 (222 / 236 / 242 / 223) | 227 (210 / 244 / 242 / 213) | 214 (195 / 214 / 241 / 206) |
| light G8/256 | 53 (40 / 53 / 59 / 58) | 37 (44 / 40 / 32 / 34) | 54 (49 / 57 / 53 / 57) | 56 (52 / 51 / 63 / 58) | 21 (17 / 22 / 22 / 25) | 20 (15 / 16 / 30 / 20) |
| light floor layer /256 | 48.7 (37.9 / 49.3 / 54.8 / 52.6) | 27.4 (30.7 / 27.1 / 25.3 / 26.3) | 49.5 (44.0 / 52.6 / 49.0 / 52.4) | 51.7 (48.2 / 47.5 / 58.1 / 52.9) | 8.7 (5.7 / 8.5 / 7.0 / 13.7) | 9.2 (4.7 / 6.0 / 18.1 / 8.2) |
| same-owner edge share | - | - | - | 0.199 (0.607 / 0.173 / 0.016 / 0.000) | 0.036 (0.000 / 0.130 / 0.013 / 0.000) | - |
| same-owner share (final) | - | - | - | 0.185 (0.600 / 0.138 / 0.000 / 0.000) | 0.028 (0.000 / 0.111 / 0.000 / 0.000) | - |
| median min(Q,Q) | - | - | - | 0.6 (1.2 / 1.0 / 0.3 / 0.0) | 0.3 (0.0 / 1.0 / 0.2 / 0.0) | - |
| owned cells | - | - | - | 2,447 (7,556 / 2,225 / 6 / 0) | 142 (0 / 561 / 7 / 0) | - |
| distinct owners | - | - | - | 75 (24 / 274 / 1 / 0) | 24 (0 / 93 / 2 / 0) | - |
| largest owner's share of owned cells | - | - | - | 0.476 (0.981 / 0.251 / 0.671 / 0.000) | 0.196 (0.000 / 0.119 / 0.666 / 0.000) | - |
| median Q (owned cells) | - | - | - | 0.9 (2.0 / 1.0 / 0.8 / 0.0) | 0.5 (0.0 / 1.0 / 0.9 / 0.0) | - |
| conduit extra rate at median edge | - | - | - | 8 (15 / 15 / 0 / 0) | 4 (0 / 15 / 0 / 0) | - |

**By depth, seed means (G1 surface, G8 floor):**

| group | none: particles / light | none ws2: particles / light | owner: particles / light | owner ws2: particles / light | toll: particles / P | move12: particles / P |
|---|---|---|---|---|---|---|
| G1 | 1,657 / 227 | 2,547 / 214 | 1,449 / 231 | 1,707 / 227 | 204 / 16,636 | 963 / 48 |
| G2 | 979 / 185 | 1,262 / 158 | 843 / 193 | 1,009 / 184 | 143 / 15,494 | 681 / 162 |
| G4 | 804 / 141 | 746 / 117 | 834 / 151 | 802 / 139 | 107 / 11,746 | 821 / 555 |
| G6 | 1,847 / 96 | 1,581 / 82 | 1,937 / 103 | 1,827 / 96 | 344 / 23,157 | 1,671 / 2,599 |
| G7 | 1,846 / 69 | 1,381 / 54 | 2,064 / 75 | 1,615 / 62 | 3,032 / 231,828 | 1,698 / 3,362 |
| G8 | 1,387 / 53 | 471 / 20 | 1,482 / 56 | 546 / 21 | 978 / 212,693 | 1,337 / 2,996 |

**"Formed" applied to the 8 owner runs:** 0 of 4 for `owner` (seed 11: share 0.61, min(Q, Q) 1.2, 7,556 owned cells, 98% held by one owner, so it fails only on Q; seed 12: 0.17; seeds 13 and 14: 6 and 0 owned cells) and 0 of 4 for `owner ws2` (at most 561 owned cells).

### Plain reading

- **No rule (`none`).** Trail is purged, as in screen 1: 910 P on average, 0 to 3,486 by seed.
  - The floor layer gets 49/256 at sinking 6. Screen 1's 80 to 156 was at sinking 4, so this screen does not retest that figure.
  - Floor light here comes from the clear water column. The floor group holds 1,387 particles, as many as G2 and G3 together.
- **Waste shading (`none ws2` against `none`).**
  - The floor layer goes from 49 to 9/256 (every seed lower: 4.7 to 18.1 against 37.9 to 54.8). G8 light goes from 53 to 20.
  - Particles move up: G8 holds 471 (from 1,387) and G1 holds 2,547 (from 1,657). G8 falls on every seed; G1 rises on three (seed 13: 808 against 957). The total is 9,805 against 10,408.
  - Trail is still purged on three seeds. Seed 12 keeps 20,211 P as a diagonal sheet in the top view (single seed; no-rule seed 12 also had the most trail).
  - **So the lever does what the plan's premise needs** (a dark floor, with the life near the top). In these 50k runs it does not, by itself, bring trail or lifting structure.
- **Toll.** Keeps trail on all four seeds (535k P; 99% of occupied cells hold trail). The trail itself shades the floor layer to 27/256, and the population is half of `none`.
  - **Two states by seed.** On seeds 11 and 12 the trail is a floor bed (P in G1–2: 387 and 0), the bed screen 1 saw. Bodies sit near the floor; the side views are dark above it.
  - On seeds 13 and 14, trail fills the surface groups too (P in G1–2: 75,774 and 52,360). Particles lift matter strongly (net up 2.3M and 2.1M matter-layers per 1,000 steps, against 76k and 278k on seeds 11 and 12). The largest component spans all 32 layers on seed 13 through the late window, and on seed 14 at times. A component reaches from G1 to G8 in 13 of 13 late readouts on seed 13 and 8 of 13 on seed 14.
  - **This differs from screen 1**, where no sinking run had such a component late (seeds 1 and 2). Here it is 2 of 4 seeds. No other arm in this screen has one late on any seed.
- **`moveCost` 12 alone.** 11k P on average, but 37,261 / 0 / 7,353 / 43 by seed. That is about 2% of the toll's trail, and below the toll on every seed by more than tenfold.
  - It is not clearly outside seed noise: no-rule worlds reached 20k P on one seed in this screen (`none ws2` seed 12) and 6k to 14k in the probe.
  - Nutrient is higher everywhere (A in G1 is 122k against 65k), with fewer particles (8,979).
  - **So the extra movement cost does not explain the toll's trail.** The discount without the cost (`moveCost` 2) was not run.
- **Owner at sized strength.** Ownership does not hold at sinking 6 on fresh seeds.
  - Seed 11 shows the screen-1 kind of diagonal trail bands in its top view (34k P), with one genotype owning 98% of the owned cells: a one-owner patch, not territories.
  - Seeds 13 and 14 have essentially no owned trail.
  - Trail averages 10,632 against 910 for `none`, but that rests on seeds 11 and 12.
  - The pilot's carpet state (seed 22) did not appear on any fresh seed.
- **Owner plus `wasteShade`.** Darkens the floor exactly as on the no-rule world (8.7/256; G8 holds 546 particles), and ownership is gone (0 to 561 owned cells). One reading: the shaded, crowded upper layers leave less room for an owned patch. With one value and four seeds, that is not shown.

## Next steps

1. **Decide what the owner rules are for.** At their limits they make one clone's sheet (without sinking) or one clone's patch or carpet (with sinking 6), not many territories. Before spending more runs on them:
   - Add a readout of owners per connected owned region, so "territories" can be measured directly.
   - Try the setting at slower sinking (`sinkShift` 8 to 10) on 4 or more fresh seeds, to see whether several owners can coexist there.
   - A rule variant where sinking trail keeps its owner is possible. It is a rule change and needs `RULES.md` first.
2. **`wasteShade` with a lift.** The floor is now dark. The plan's question (does anything lift matter back up?) can be asked at `wasteShade` 2: compare upward transport and surface A over longer runs (100k+), and try `wasteShade` 2 with the toll.
3. **The toll's two states.** On 2 of 4 seeds, the toll held a surface-to-floor trail with strong upward transport by particles; on the other 2, only a floor bed. Run the toll on more seeds, and at `wasteShade` 2, and look at a seed-13 world with the B3 renderer.
4. **The toll's parts.** `moveCost` 12 alone kept little (not clearly above seed noise). Run the discount at `moveCost` 2 to separate the discount from its cost.
5. **Expose `wasteShade` on `/mycelium3d/`** (that page's owner), so the dark floor can be looked at in the renderer.

## Caveats

- Four seeds per arm. Several readouts are bimodal by seed, so the means move with one seed. The per-seed values are in every cell.
- The pilot grid ran 20k steps first. The 20k "formed" flags did not hold at 50k for g 120 (seed 21).
- The 20k pilot process was stopped by a 30-minute background time limit after 56 of 60 runs. The 4 remaining runs were taken with `--reclaim`. Finished runs are not rerun (fingerprint check), so this changes no result.
- The first start of this screen was stopped after 6 minutes, to add the owner-count readout (`READOUT_VERSION` 5). It was restarted in a fresh directory, and nothing from the stopped start is used.
- `wasteShade` 2 was chosen on a no-rule world at 20k steps.

## Follow-up

The toll's surface-to-floor trail was rerun on twelve fresh seeds the same day: one of them spans by a bar fixed beforehand (`leads-screen-2026-11-16.md`).
