# Set-loose bodies (exploratory)

Nothing here is pre-registered and there is no pass/fail gate. The rules are hand-designed (not searched or discovered), three seeds per arm, no statistics. Page: `/bodies/` (unlisted, noindex). Code: `apps/lab/src/bodies/model.ts` (rules v2 by default, v1 reachable with `version: 1`), runs `experiments/bodies/run.ts`, tests `apps/lab/test/bodies-*.test.ts`. v2 numbers below come from `v2-readouts.json` and `v2-sweep-*.json` in this folder (every number was recomputed from them); the v1 section further down is dated history.

# 2026-11-18 — v3: boundaries

Exploratory, no gates, no pre-registration, three seeds per arm (skeptic re-runs used seeds 4 and 5), no statistics. Seven arms explored the boundary knobs; three skeptic passes (seam-conflict, wildcard, grow-only) re-ran the headline configs with independent code. Where they disagree, the skeptic reading is used here, and I re-read the skeptic tables (`_skeptic/seam-conflict/table1.txt`, `basins.txt`, `events_summary.txt`; `_skeptic/grow-only/numbers.txt`; `_skeptic/wildcard/sum.py` output) before quoting numbers. Harness, knob table and readouts: `v3/HARNESS.md`. Machine summary: `v3/SUMMARY.json`. Only the frames linked from this page are kept in the repo; the other frames, state snapshots (`snaps.bin`) and run logs were moved out of the tree to keep it small, so scripts under `v3/` that read them need the runs regenerated with the commands in each arm's `NOTES.md`.

## Answer first

- **Recognition marks plus a contact gate can wall clades apart, but not bodies.** With the grow gate and foreign-mark buds the crowd becomes 11 to 43 physically separate pieces with zero mark seam, against one connected mat in the control. The pieces are clade patches (often with 2 or more root basins each), they are made by a lottery of mutant buds, and they freeze once the world is full.
- **The "1 component versus 35" contrast is true by construction.** The tag-blind control is the plain mat, and the gate does not reduce the count of big mark patches in a consistent direction (in the grow-only skeptic tables blind vs gated big patches are 36 vs 15 and 16 vs 40 for B seeds 4 and 5, so the direction flips by seed; ranges overlap). Body-scale measures do not improve: root basins are smaller and more numerous under the gate, while the control sits at the lone-body size of about 170.
- **No arm reached turnover with discrete bodies.** Rung 3 (a crowd that keeps changing) was met only as border churn, or as a jammed mosaic with patch births and deaths near 0.

## What was added (knob semantics)

Each cell carries a heritable mark (0..255, circular). Two neighbouring cells MATCH if their circular mark distance is <= TAG_TOL. Dynamics only ever compare the marks of two adjacent cells.

- `GATE_SHARE`: store transport along an edge between non-matching cells is blocked.
- `GATE_GROW`: a newborn (growth or bud) is not placed if its final mark does not match a neighbour. This zeroes the seam, so `SEAM_COST` and `RAID` never fire with it on. It also switches growth and budding to a per-step random-permutation scan (see bugs below).
- `GATE_SIGNAL`: the distance signal d does not propagate across non-matching neighbours.
- `SEAM_COST`: extra store burned at an upkeep tick by a cell that touches a non-matching 4-neighbour.
- `RAID`: a cell takes up to N from a richer non-matching 4-neighbour (at most half the gap), once per step.
- `TAG_TOL`, `TAG_STEP`: match distance; size of a mark mutation step.
- `TAG_TOL_GENE`: the tolerance is heritable (a pair matches under the lower of the two).
- `TAG_MUT_BUD`: marks mutate only at bud births (new bodies), not at growth births.
- World options: `tagMutRate` (mutation per birth, out of 65536) and `tagBlind` (control: marks mutate and are inherited, every gate/seam/raid treats all pairs as matching; physically the ungated raster-scan world).

Rungs used by the arms: 1 = a pair stays two; 2 = a crowd stays several distinct patches; 3 = same with mutation on and some turnover.

## Arms

"Control" below is the tag-blind control unless stated. Numbers are late means (t >= 10000) over three seeds unless stated; skeptic re-runs are marked.

| Arm | Rung | Failure mode | Key numbers vs control |
|---|---|---|---|
| share-only | 1 (pair) | sweep-to-mat | Gated pair keeps 2 patches in 3 of 3 seeds, but the ungated pair does too. Crowd: 1 component, 40 to 49 basins, ~6900 cells. Mutation on: 1 component in every arm; gated vs blind basins 66/72/64 vs 48/67/56; no difference readable at n=3. |
| grow-only | 2 (partial) | jammed-mosaic; clade sweep | Bud-only marks, step 40 (arm B): 11/33/14 components vs 1 in the control; D (bud gene 16): 38/35/28. Patch births and deaths ~0 after the first boom. Skeptic: mark-patch counts do not separate the arms and the direction flips by seed (30+ cells, blind vs gated: 36 vs 15, 16 vs 40, 41 vs 32, 34 vs 33 for B s4, B s5, D s4, D s5; the review also reports explorer seed 2 late means of 8.92 vs 32.14 for B and 14.65 vs 33 for D, blind first, which I did not recompute). Gated root basins median ~50 to 90 vs ~150 to 170 (blind). |
| signal-only | 1 | sweep-to-mat; dust of basins | Crowd stays one connected mat of ~6860 cells, one clade 94 to 95%. With per-body marks basins shatter: median 34/44/31 vs 165/128/143 in the control. No gene or wound difference from the control. |
| all-three-fixed | 2 (about 2.5) | sweep-to-mat plus frozen enclosed founders | Pair: seam 0 in 15 of 15 runs, identical for tol 0 to 64. Crowd, no mutation: 3 patches, one at 79 to 96%, the other two frozen and enclosed (seeds 1 and 2 about 145 to 175 cells each; seed 3 has [5499, 1306, 145], so the second patch holds 1306 cells, 18.8% of live cells, per `all-three-fixed/NOTES.md`). Bud-only mark mutation at rate 20000: 7 to 15 components, largest 42 to 73%, seam 0 vs 1.0 component and seam 22 to 75 permille in the control. |
| all-three-evolvable-tol | 1 | sweep-to-mat | Gated crowd: 3 patches, seam 0. Tolerance stays near 16 (median 16, 20, 16 vs 16, 12, 12 in the control); mostly frozen after t~10000, so 20000 steps are too short to see tolerance evolve. |
| seam-conflict | 3 (thin) | sweep-to-mat without GATE_GROW; jammed-mosaic with it | Seam cost and raid without the grow gate leave one clade at 66 to 97% over the original seeds (blind control 38 to 90%); skeptic seed 4 gives gated 44% vs blind 38%, outside that range. With all gates (config C): explorer 7.5/12.4/8.0 components; skeptic new seeds 12.2 and 19.5 vs 1.0 and 1.1 for `--tol 128`. Turnover: seam cost with share+signal gates replaces far more tiles than the control, about 10x on exact per-step counts, two-way border churn only. |
| wildcard | 3 (partial) | jammed-mosaic | Config F (5 founders, grow gate, bud-only marks, step 40): 34.9/34.5/39.1 components (skeptic seeds 1/4/5: 34.9, 38.1, 31.8), seam 0, patch births and deaths ~0 after t~4000, vs 1.0 to 1.5 components in the control. |

## What holds after the skeptic pass

- **Reproduction is exact.** Skeptics re-ran headline configs with their own union-find and component code. `stateHashFull` matched bit for bit for pair all-gates s1, crowd C s2 and sc20 s1; wildcard seed 1 matched (34.9 components). The ledger residual is 0 in every run. New seeds 4 and 5 give the same picture.
- **The gate does what it was written to do.** Gated worlds have 0 live 8-adjacent pairs with non-matching marks after the first boom; blind controls have ~1800 to 3600. Gaps of 1 to 2 empty tiles separate clades, and the mosaic holds for at least 2x longer (checked 40000 steps on one seed each for C, D and F).
- **It is not a founder-spacing or founder-mark effect.** All founders at mark 0, one founder alone, random founder positions, and 10 founders still give 8 to 38 components in the explorer runs; the one-founder C seed 5 run is the exception (2.0 components, `_skeptic/seam-conflict/table1.txt`). The clades come from bud-born mark mutants.
- **Mosaic size is set by mutation luck.** C with 1 founder: 1 mutation gave 2 components; 15 mutations gave 10. The body count in F scales inversely with dmax area (dmax 12: 59 to 68 components; 16: 35 to 38; 24: 17 to 18; seed 4).
- **Border churn under SEAM_COST with the share and signal gates is real** (about 10x the control on exact counts), but flows are roughly symmetric (mark 0 to 40: 85 tiles, 40 to 0: 52), so no clade replaces another, and 60 to 80% of events fall before t=10000.
- **Cells turn over inside the frozen tiling.** 13 to 32% of tiles live at t=10000 hold a different cell later; only 0.7 to 4.6% carry a non-matching mark (gated), against 4.9 to 11.6% in the control. Patches do not move; cells do.

## What does not hold (explorer claims corrected)

- **"Pairs stay two, 9 of 9" is nearly empty.** The plain pair also stays at 2 mark patches (marks never mutate in pairs), and patches are mark-defined. Pairs end with 2 to 14 roots; only 3 of 9 skeptic pairs held ~130 to 230 cells per patch with 2 roots.
- **"About 35 compact cell-like bodies" is too neat.** Component sizes are broad (largest 847, 513, 1080 vs median ~150 to 195); only 53%, 81% and 53% of cells (seeds 1, 4, 5) are in components of 85 to 340 cells; 19 to 22 of ~30 to 35 big components hold two or more roots. A component is a clade patch.
- **The mosaic is not "bodies".** In the seam-conflict C runs, 4 to 8 components of 85 to 340 cells are trapped mutant buds holding 10 to 21% of cells (660, 1434 and 1201 of about 6900 on seeds 2, 4 and 5, from `comp_sizes.txt`). The rest sit in larger components, but not uniformly giant ones: the largest component holds 4075 of 6905 cells (59.0%) on seed 4, 2932 (42.6%) on seed 2, and only 1974 (28.7%) on seed 5, where none reaches 2000 cells.
- **Basins get worse under the gate.** End-of-run basins (n / median): C s4 82/77, C s5 68/100; `--tol 128` 45/148 and 44/161; tag-blind 39/173 and 41/173.
- **Patch counts do not separate gated from blind.** Blind has 4 to 15 (up to 40+) big mark patches and 5 to 6 mark classes; only component count separates them, and that is the gate's definition.
- **"Zero turnover" is true for patches only** (cells churn ~4 to 5% per 1000 steps).
- **Scarcity "turnover" (SUPPLY 15 to 19) is mostly threshold-crossing.** Patch births and deaths over t=10000 to 20000 on seed 4: SUPPLY 15 gated 783/814 at min patch size 10, 72/77 at size 100; blind 1202/1245 and 255/257. The blind control has equal or more. Real replacement cannot be separated from observer relabelling of lacy patches.
- **Wound recovery does not discriminate gated from blind.** Disk refill at +1500: C 30/26/30 of 32/34/40 vs blind 25/24/27 of 33/35/41. Cloned-wound test (8 disks near a foreign clade): gated 21 to 22% of tiles taken over vs 18 to 31% blind. Refill by neighbouring clades is as common as the control because a wound removes the cells holding the boundary.
- **Sweep to 66 to 97% is mostly baseline.** Dominant mark share, sc20 vs blind: 67/58, 95/90, 81/77, 44/38, 74/68 (seeds 1 to 5); the knob adds about 6 to 9 points.
- **Boom timing is a lottery in either world.** "Three ~170-cell bodies persist to ~8400 steps" in a seed is not a recognition effect (plain v2 seed 4 does the same to t=3900).

## Model bugs and confounds

- **Fixed before the arms were summarised** (harness audit, all in `v3/HARNESS.md`): GATE_GROW judged the parent's mark rather than the newborn's final mark (seam pairs, 25 of 234 before, 0 after); a rotated-raster growth order biased which side of a gap grew first (934/0 before, now 407/450 etc.); turnover missed marks replaced in place (now `patches.replacedTiles`). These affected only gate-on runs and are fixed; the skeptics reproduced the current model's hashes bit for bit, and I found no arm that reports results from the pre-fix model, but I did not audit each run's `stateHashFull` against a pre-fix build. Default (v2) behaviour is unchanged: the 20000-step crowd seed 1 still reproduces stored v2 hash 2445250181.
- **Codex review fixes (2026-11-18, after the write-up).** (1) The replacement scan multiplier was rounded up to the next unit mod 9216, which weighted multipliers 5 mod 6 about twice 1 mod 6 (tiles one row apart: precedence probability 0.493, not 0.5, per the review). `scanPerm` now draws the multiplier by rejection from successive hash channels, uniform over the units. **This changes dynamics whenever `GATE_GROW` or `RAID` is on** (default v2 and the ungated, share-only and signal-only paths never call it; the 20000-step crowd seed 1 default hash 2445250181 and the golden pins are unchanged, tests pass). (2) The v3 knobs moved out of `RULES_V1`/`RULES_V2` into `V3_KNOBS` (merged in the constructor, all off), so the default rule objects have no v3 keys; readouts that serialize the resolved `w.R` still list all keys with their defaults. (3) A test checks the multiplier split is about 50/50.
- **STALE after fix (1):** every stored number from a run with `GATE_GROW` or `RAID` on, in `v3/grow-only`, `v3/all-three-fixed`, `v3/all-three-evolvable-tol`, `v3/seam-conflict`, `v3/wildcard`, `v3/_skeptic/*`, `v3/example-pair-gated`, `v3/example-wound-crowd`, `v3/timing-crowd-all-knobs`, and the tables quoted above for them (hashes, exact counts, 10x churn, 40000-step checks). Not stale: share-only, signal-only, the plain controls, `v3/example-pair-plain`, `v3/timing-crowd-plain`. Their qualitative reading was not re-derived, except the one re-check below.
- **Post-fix re-run of the skeptic headline (seam-conflict config C, 3 founders, 20000 steps, seeds 4 and 5; files in `v3/_rerun_scanfix/`, one seed each, no statistics).** Components, mean over t >= 10000: C 11.9 (s4) and 11.1 (s5), against 1.0 and 1.1 for `--tol 128`. Final basins n / median: C 59 / 106 and 68 / 94; `--tol 128` 37 / 184 and 40 / 175. Seam 0, residual 0 in all four. So the picture holds (about a dozen pieces against one mat, smaller basins under the gate), but the pre-fix figures (12.2 / 19.5 components, basins 82 / 77 and 68 / 100) are not reproduced; read them as stale. Other arms were not re-run.
- **No new model bug was reported by any explorer or skeptic before the Codex review.**
- **Open confound, not a bug: GATE_GROW changes the scan.** It switches growth and budding to a random-permutation scan, so a gate-on world differs physically from `--tag-blind` (raster scan) even before any mark differs. Boom timing differs by seed in both directions (seam-conflict explorer: slower on seeds 1 to 3; skeptic: faster on seeds 4 and 5 for the matched `--tol 128`). Use `--tol 128` or `--tags same` as the control for GATE_GROW arms; `--tag-blind` is correct for share, signal, seam-cost and raid.
- **Control caveats.** `--tag-blind` turns every gate off, so it is an ungated mutation control; `--tags same` is not a no-boundary control when `--tag-mut-bud` is on (buds still get new marks); `A_same` equals `A_blind` on the v2 `stateHash` only (`stateHashFull` differs).
- **Process incidents (not model bugs).** One explorer's `pkill` killed other arms' running jobs (those arms re-ran); several arms lost runs to tool timeouts or heavy machine load and re-ran them; the evolvable-tol arm did not read seed 3 of its budless run.
- **Observer cautions.** `rootAlive` can go false long after a wound while the body persists; wound-in-crowd refuses radius 8 on seed 3 and radius 11 on seeds 1 to 3 (no centre that spares the roots).

## Best frames

- Gated crowd, marks | components | basins (skeptic C seed 4): [`FRAME1_C_s4_t20000...png`](v3/_skeptic/seam-conflict/frames/FRAME1_C_s4_t20000_marks_components_basins.png)
- Its matched control (`--tol 128`, same marks, one mat, larger basins): [`FRAME2_control_tol128_s4_t20000...png`](v3/_skeptic/seam-conflict/frames/FRAME2_control_tol128_s4_t20000_marks_components_basins.png)
- Wildcard F, seed 5, gated (irregular clade patches, dark walls, snaking regions): [`Fs5b/frame-end.png`](v3/_skeptic/wildcard/runs/Fs5b/frame-end.png)
- Same seed, tag-blind (fused mat, the control that matters): [`Bs5b/frame-end.png`](v3/_skeptic/wildcard/runs/Bs5b/frame-end.png)
- Cleanest tidy case for the explorer's reading (seed 1; overstates the other seeds): [`wildcard/L-F/frame-t20000.png`](v3/wildcard/L-F/frame-t20000.png)
- Grow-only D seed 4, gated vs blind: [gated](v3/_skeptic/grow-only/runs/D-grow-s4-frame-t20000.png), [blind](v3/_skeptic/grow-only/runs/D-blind-s4-frame-t20000.png)

## What remains open

- Do marks that mutate at the **root** level (a new root founds a new mark) line patches up with basins? Today marks mutate at buds, and basins are not the unit that gets a mark.
- A clean matched comparison for GATE_GROW (scan held fixed) on every headline number. Only a few skeptic runs use `--tol 128`.
- Whether any regime gives **clade replacement** (whole patches born and dying) with compact patches. Scarcity gives lacy patches whose births and deaths the observer cannot separate from relabelling.
- Whether tolerance evolves at all: 20000 steps is too short because births drop to ~0.07 per cell per 1000 steps once the mat is full.
- The 96x96 torus is fixed by typed arrays, so mosaic scale vs world size is only tested by a resized skeptic copy (128x128: components rose ~1.45x for 1.78x the area, median clade size did not move).
- Rungs 1 and 2 of grow-only were re-read, not re-run, by the skeptic.

## Three most promising next moves

1. **Make a body the unit that carries the mark.** Test root-born mark mutation (a new root, rather than any bud, draws a new mark) so a mark patch can equal a root basin, and score patches against basins directly, with `--tol 128` as the control. This addresses the main finding: walls exist but at the wrong grain.
2. **Fix the controls, then re-measure.** Add a gate-off permutation-scan option (or use `--tol 128` everywhere for GATE_GROW arms) and recompute the headline contrasts on components, basin median and cell turnover, on 5 or more seeds, ignoring mark-patch counts.
3. **Give the walls something to do.** Combine the share+signal gates plus seam cost (the only setting with measurable border churn) with scarcity and a longer horizon (40000+ steps), to ask whether a wall-holding clade can ever displace another and make births and deaths of whole clades, rather than a frozen tiling.

# v2 (2026-11-18): foraging and transport, scarcity throughout

## Answer first

**Do discrete bodies hold under scarcity? Partly, and only alone.**

- **Alone, yes for thousands of steps, then no.** One budless founder (genome dmax 16, grow 60, bud 0, rim 0) with upkeep on holds as a single ~170-cell disk with one root: 161 to 175 cells at every 200-step sample from t=1000 to t=6000, all 3 seeds. In all 3 seeds the body then outgrows that state (in seeds 1 and 3 a second root appears at the same time; seed 2 shows a root replaced and a larger body): the first sample above 230 cells is at t=12800, 7400 and 6600, and at t=20000 the three bodies have 347, 216 and 337 cells. The same founder with its budding gene (bud 4) breaks out at those same steps and then fills the whole world (6916, 6864, 6922 cells at t=20000). A lone body therefore persisted for 6600 to 12800 steps, not indefinitely. The constants were chosen so that a lone dmax-16 body holds, so "holds" is partly by construction.
- **Crowded, no.** With three founders every arm booms to 9058 to 9216 cells (the stored food in the rain-fed world), crashes, and settles at 6827 to 6996 cells (about 75% of the 9216 tiles). That is one connected mat with small holes: at t>=10000 only 28 of 765 samples have more than one component, and the largest component holds at least 999 permille of cells in all of them. Bodies are discrete only to an observer that groups each cell with the root it drains to along the distance signal ("root basins"): about 40 basins in the OFF world with a median of 174 cells, close to the lone-body size of about 170.
- **The mat size is set by the world's energy budget, not by geometry.** Rain is 24/256 = 0.094 per tile per step on 9216 tiles (864 per step); a cell burns 1 per UPK=8 steps = 0.125 per step; so 864/0.125 = 6912 cells. Observed mean over all late samples (t>=10000, 15 runs): 6898 (this is also why v1's mat was about 3456 cells at UPK 4, the README's 3656 and 3791 included stock and turnover).
- **Mutation:** with mutation on, gene means move away from the neutral baseline in the same direction in all 3 seeds in the 8x arm (details below). It mostly shows up as more, smaller root basins (57 vs 40 basins; median 122 vs 174 cells), not as a different total.
- **ON vs NEUTRAL:** suggestive of selection for spread (larger reach dmax and more rim-rooting), consistent in 3 of 3 seeds at both mutation rates for rim and grow, and for dmax only at the 8x rate. Three seeds, no test; I do not call it more than suggestive.

## Diagnosis checked

The diagnosis in the brief holds per cell: v1 has SUPPLY 24 so rain is 24/256 = 0.094 per tile per step, and UPK 4 costs 0.25 per cell per step, so a cell needs the rain of 0.25/0.094 = 2.7 tiles and a cell that only absorbs from its own tile cannot pay for itself. It also fixes the world-level count: cells = N x rain / burn = 3456 at v1 constants (v1's long runs sat at 3656 and 3791 mean cells).

## Rule v2

Same cells, genome (dmax, grow, bud, rim), distance signal, growth, budding and root rules as v1. What changed (all hand-designed; no new genes):

1. **Surface foraging.** After absorbing from its own tile, a live cell with room in its store may take 1 unit from one adjacent empty tile (4-neighbours, start direction from the hash), but only the food above KEEP=3, so a tile keeps enough (C=3) to found a new cell. Rotated scan start; counted in the ledger as food to store.
2. **Internal transport.** Along each live edge (east and south, rotated scan) the cell with more stored food hands half the difference (rounded down, at most 8) to the other. Equalising, order-biased only by the rotation; no body id, no direction toward the root. Matter only moves between stores, so the ledger residual stays 0.
3. **Constants.** UPK 4 to 8 (upkeep halves to 0.125 per cell per step, 1.33 times the rain on one tile; this ratio is what makes the lone body sit at about 170 cells), INIT_FOOD 32 to 4 (the initial food stock of 32 per tile otherwise masks scarcity for thousands of steps), orphan re-rooting 2/256 to 16/65536 per step per orphan cell (ORPH16; lets a fragment pick a root before most of its cells have rooted separately).
4. Root bookkeeping (when a cell became a root, how long roots lived) and the root-basin labelling are observer-only; a test checks the dynamics never read them.

**Neutral control.** `blind: true`: genes still mutate, are inherited and are tagged exactly as in the mutation-on arm, but every dynamics read (dmax, grow, bud, rim) uses the founder genome. A test checks that the cells, food, store and d arrays and every counter equal the mutation-off run step for step, and that only genes and tags differ. So the NEUTRAL arm's cells, components and basins are by construction the OFF arm's; it supplies only the drift baseline for genes and variant counts.

**v1 kept reachable.** `new BodiesWorld({ version: 1 })` and `node experiments/bodies/run.ts --rules 1` run the old rule. I checked it bit for bit against the 20000-step, upkeep-on, 3-founder state hashes in `readouts.json` (seed 1: OFF 1749091233, ON 2979838439, both match) and the unit test pins the fed 300-step hash. The v1 section below is unchanged.

## Variants tried and dropped

Lone budless body, dmax 16, seeds 1-3, cells at t=1000 / 2000 / 4000 (`v2-sweep-variants.json`, `v2-sweep-ablation.json`, `v2-sweep-orphan.json`):

| variant | result | why dropped / kept |
|---|---|---|
| A: forage + transport on v1 constants (UPK 4, INIT_FOOD 32) | 101/455/1543, 211/482/1146, 246/463/1875 cells; 83 to 120 components, 7 to 16 roots | needs 2.7 tiles per cell, so the body runs away into a ragged mat |
| B: A with INIT_FOOD 4 | 290/512/1476, 546/685/1936, 182/527/1743 | same: constants, not stock, are the issue |
| C: UPK 6 (upkeep 1.77x rain) | 320/607/965, 116/358/727, 533/731/1478; 3 to 6 components, 4 to 9 roots | still too hungry: body fragments and re-roots |
| D: final constants, orphan rooting 2/256 | lone result identical to final (164/173/172, 164/172/169, 166/169/169) | kept ORPH16: the root-killed wound ends at 2453 to 3343 permille with 2/256 versus 1426 to 2306 with ORPH16 16 |
| E: KEEP 0 | 149/156/157, 149/154/157, 146/151/156 | smaller disk (146 to 157 cells); did not turn the three-founder mat into separate bodies (scratch run) |
| F: KEEP 1 | 149/155/160, 150/157/159, 154/158/163 | same |
| final: UPK 8, INIT_FOOD 4, ORPH16 16, KEEP 3 | 164/173/172, 164/172/169, 166/169/169, 1 component, 1 root | kept |

Ablation at the final constants (cells at t=1000/2000/4000, seeds 1-3): full v2 at dmax 12 is 105 cells every time; with no transport (FLOW 0) it sprawls to 764 to 1207 cells (dmax 12) and 1726 to 2819 (dmax 16); with no foraging every body dies (0 cells); with neither, dmax 12 dies and dmax 16 sprawls to 2399 in 1 seed and dies in 2. So forage and transport are both needed, and the retuned constants alone do not hold a body. I did not try a gradient toward the root or a protected root; the cap on variants was reached.

## Lone body (upkeep on, 20000 steps, `v2-lone-*.png`)

Cells at t=2000 / 5000 / 10000 / 20000:

| genome | seed | cells | first sample over 230 cells | roots created / ended |
|---|---|---|---|---|
| shape (bud 0) | 1 | 173 / 171 / 170 / 347 | t=12800 | 4 / 2 |
| shape | 2 | 172 / 167 / 220 / 216 | t=7400 | 2 / 1 |
| shape | 3 | 169 / 163 / 340 / 337 | t=6600 | 3 / 1 |
| founder (bud 4) | 1 | 173 / 171 / 170 / 6916 | t=12800 | 95 / 43 |
| founder | 2 | 172 / 167 / 6737 / 6864 | t=7400 | 127 / 89 |
| founder | 3 | 169 / 163 / 6882 / 6922 | t=6600 | 123 / 78 |

Roots end only when their own cell dies of starvation; the budless bodies' ended roots had mean lives of 7394, 7088 and 6312 steps (2, 1, 1 roots ended). The founder genome with budding breaks out at the same steps as the shape genome, so the first breakout does not need a bud; I did not trace its cause beyond the root counts.

Dmax trade-off (lone budless body, cells at t=4000, seeds 1-3, `v2-sweep-sweep.json`): dmax 8: 49, 49, 49; 12: 105 x 3; 14: 180, 134, 163; 16: 172, 169, 169; 20: 828, 937, 251; 24: 1894, 1029, 351; 32: 3148, 2081, 2155. Size follows dmax up to about 12 (gene-limited) and sits near the energy limit of about 170 cells at 16. At dmax 20 and above most seeds break out into several roots and spread within 4000 steps, but not all: seed 3 at dmax 20 and at dmax 24 kept its original single root and ended at 251 and 351 cells. So the sweep supports seed-dependent breakouts that become more likely and larger as dmax rises, not a sharp cliff and not an optimum; I did not measure breakout probability beyond three seeds. Sprawl is not a loss for a lineage in a crowded world.

## Wound under scarcity (lone budless body, settled 2000 steps, radius-4 wound, 1500 steps watched)

| wound | seed | cells before | killed | cells at +25 / +150 / +500 / +1500 | roots at +1500 | recovered |
|---|---|---|---|---|---|---|
| root spared | 1 | 173 | 35 | 138 / 166 / 167 / 170 | 1 | 982 permille |
| root spared | 2 | 172 | 35 | 137 / 165 / 180 / 171 | 1 | 994 |
| root spared | 3 | 169 | 34 | 139 / 157 / 171 / 167 | 1 | 988 |
| root killed | 1 | 173 | 42 | 139 / 399 / 399 / 399 | 3 | 2306 |
| root killed | 2 | 172 | 43 | 136 / 252 / 252 / 252 | 1 | 1465 |
| root killed | 3 | 169 | 40 | 130 / 241 / 241 / 241 | 1 | 1426 |

The wound is placed from the roots alive at that moment and its class is recorded in the JSON (`woundClass`): root spared = the live cell whose nearest root is about 6 tiles away (centre (48,42) in all three), root killed = the oldest live root ((48,48)); an earlier draft used fixed founder coordinates, which can hit a root that has moved. Root-spared regrowth works: 982, 994 and 988 permille at +1500, with no second root in any seed (the 'seed 3 grew to 241' result in the earlier draft came from the old wound spot, not from this one). Root-killed overgrowth is reduced (1.4 to 2.3 times; v1 fed was 2.2 to 3.0 times) but **not fixed**: the fragment re-roots off-centre and its dmax disk around the new root extends past the old edge.

## Long runs (upkeep on, 3 founders, genome dmax 16 / grow 60 / bud 4 / rim 0, 20000 steps, seeds 1-3)

Arms: OFF (mutation off), ON (mutation 3 in 256 per birth), NEUTRAL (same mutation, rules read the founder genome), plus two 8x arms I added for power, ON24 and NEUTRAL24 (mutation 24 in 256). Late means (t>=10000, 51 samples per run, seed means):

| arm | cells | interior permille | roots | root basins | median basin | cells in basins within 2x of 170 (permille) |
|---|---|---|---|---|---|---|
| OFF (= NEUTRAL, NEUTRAL24 dynamics) | 6894 | 335 | 40 | 40 | 174 | 993 |
| ON | 6903 | 314 | 57 | 57 | 122 | 873 (959, 771, 891) |
| ON24 | 6908 | 309 | 46 | 46 | 149 | 945 |

Components: 1 at nearly every sample (samples with more than one component at t>=10000: OFF 4 of 153, ON 5, ON24 11; every run is a single component from some step on: t=10600 / 12200 / 8800 (OFF), 11200 / 12000 / 16800 (ON), 8600 / 18400 / 19400 (ON24)). Component-based readouts (median, share within 2x of the lone size) are therefore degenerate (0 permille within 2x, one 6900-cell component); the basin readouts are the usable ones. Interior share ranged 285 to 358 permille over all late samples. Roots: OFF created 142 / 149 / 145 and ended 104 / 113 / 106 over 20000 steps (mean life of ended roots 4286 / 4350 / 5019 steps); ON created 194 / 223 / 193, ended 151 / 170 / 144 (mean life 5326 / 5379 / 5029). The median age of live roots at t=20000 was 9804 / 9974 / 6584 (OFF), 8788 / 19165 / 18608 (ON). So bodies in the mat are not individually long-lived: 104 to 170 roots ended per run, while 33 to 79 roots were alive at the late samples.

Boom and bust: at t=1000 the OFF runs had 1025 / 1738 / 1083 cells and the ON runs 1028 / 9216 / 1136, while ON24 was already at 9216 / 8986 / 9216; every run's sampled peak was 9058 to 9216 and it was back at 6854 to 6909 by t=5000.

## What mutation did, and ON versus NEUTRAL

Mutation events by t=20000: ON 217 / 224 / 227, NEUTRAL 176 / 187 / 194 (births differ because ON dynamics differ), ON24 2004 / 1872 / 2023, NEUTRAL24 1463 / 1544 / 1491. Births per step at t=10000 to 20000: OFF 0.40 to 0.47, ON 0.47 to 0.52, ON24 0.56 to 0.58, so the 3/256 arms have only a couple of hundred events (v1 had about 25000); that is why I added the 8x arms. Living genome variants at the end: ON 28 / 24 / 27, NEUTRAL 21 / 19 / 16, ON24 278 / 237 / 286, NEUTRAL24 106 / 146 / 101.

Mean genes at t=20000 (dmax / grow / bud / rim, seeds 1 / 2 / 3):

| arm | seed 1 | seed 2 | seed 3 |
|---|---|---|---|
| ON | 16.0 / 68.4 / 4.0 / 3.9 | 16.0 / 60.9 / 4.0 / 7.6 | 16.0 / 61.1 / 4.0 / 4.9 |
| NEUTRAL | 16.0 / 59.8 / 4.0 / 0.0 | 15.9 / 59.9 / 3.9 / 1.2 | 15.9 / 60.7 / 4.0 / 0.0 |
| ON24 | 18.3 / 71.9 / 4.0 / 13.3 | 19.7 / 76.3 / 4.1 / 8.0 | 19.5 / 68.9 / 3.7 / 13.7 |
| NEUTRAL24 | 16.3 / 57.3 / 3.9 / 0.6 | 15.6 / 55.7 / 5.6 / 4.0 | 16.1 / 56.9 / 4.1 / 1.4 |

Reading it: the NEUTRAL arms show what drift does (dmax stays at 16.0; rim creeps up from its floor of 0 to 0.4 at 3/256 and 2.0 at 24/256; grow drifts down at 24/256). In the 8x arm ON is above NEUTRAL in all three seeds for dmax (18.3 to 19.7 vs 15.6 to 16.3), grow (68.9 to 76.3 vs 55.7 to 57.3) and rim (8.0 to 13.7 vs 0.6 to 4.0), with no overlap between arms, and the founder genome holds 3% to 4% of cells (ON24) against 6% to 33% (NEUTRAL24). At 3/256, ON beats NEUTRAL in all three seeds for rim (3.9 / 7.6 / 4.9 vs 0 / 1.2 / 0) and grow (68.4 / 60.9 / 61.1 vs 59.8 / 59.9 / 60.7) but not dmax. Both directions (more reach, more rim rooting, more growth) raise the chance that a lineage spreads, which is what the lone-body breakouts and the retests below also show. **That is consistent with selection for spread beyond what neutral drift gives, with three seeds per arm and no test.** It did not produce bigger bodies: total cells are fixed by food, and basins got more numerous and smaller. Whether bodies lived longer is not established either way: mean completed root lifetime was ON 5326 / 5379 / 5029 steps against OFF 4286 / 4350 / 5019, and the median age of live roots at t=20000 was ON 8788 / 19165 / 18608 against OFF 9804 / 9974 / 6584 (higher in ON in seeds 2 and 3, lower in seed 1).

## Late-genome retest (alone, upkeep on, test seeds 11 to 13, 3000 steps)

Cells at t=1000 and t=3000, and a bud-off copy (dmax, grow and rim as evolved, bud 0) wounded after a 2000-step settle (`retests` in `v2-readouts.json`). The wound is placed from the live roots and classified: all 36 distinct genome x seed wounds were root-spared (0 hit a root), and the helper is the same one used for the lone wound table. The genome is the same in every arm that carries it, so the figures below are for 12 distinct genomes. Regrowth is cells at +1500 over cells before, in permille; a value far above 1000 is a breakout, not recovery. 8 of the 36 wound runs were already saturated before the wound (flagged `woundSaturated`) and say nothing.

- Founder (bud 4, rim 0): 162 / 229 / 162 cells at t=1000 and 8580 / 9004 / 7546 at t=3000 (saturated 3 of 3 by t=3000, 60 to 89 roots). Bud-off copy: 269 / 229 / 170 cells before the wound, regrowth 1000 / 1187 / 1005 permille (the seed-12 case that the earlier draft wounded on the sole root is now root-spared at (51,40): 229 to 272 cells).
- ON dominant genome 16,60,4,8 (ON seeds 2 and 3): 235 / 9216 / 1392 cells at t=1000 and 238 / 6784 / 7881 at t=3000: it saturates in 2 of 3 test seeds, earlier than the founder in one of them. Wound: 974 permille in seed 11; seeds 12 and 13 were saturated before the wound.
- ON top-2 genome 16,76,4,8 (ON seeds 1 and 2): 163 / 229 / 164 at t=1000 and 173 / 231 / 170 at t=3000 unwounded: holds as one root in 3 of 3. In the wound test the bud-off copy recovered to 960 and 1030 permille in seeds 12 and 13 and broke out to 9216 cells within 1500 steps after the wound in seed 11 (53894 permille).
- ON24 dominant genomes: 16,76,4,8 (seed 1) as above; 18,76,4,8 (seed 2) saturates 3 of 3 (9216 / 311 / 9216 at t=1000), its wound test broke out in seed 12 (1712 to 9187 cells); 18,60,4,8 (seed 3) saturates 2 of 3, 980 permille in the third. ON24 top-2 20,60,4,16 broke out after the wound in seed 13 (242 to 9216 cells) and was saturated in the other two.
- NEUTRAL-drift genomes under the real rules: 16,60,2,0: 4453 / 809 / 6179 cells at t=3000, wound as the founder's bud-off copy (1000 / 1187 / 1005); 16,44,4,0 (NEUTRAL24 seeds 1 and 3): 9026 / 170 / 172, wound 1273 / 987 / 1000; 14,60,6,0: holds 3 of 3 at about 136 cells, wound 1007 / 1007 / 1030.

Of the 28 wound runs that were not saturated before the wound, 25 ended between 888 and 1273 permille (19 of them between 960 and 1030) and 3 broke out (5366, 38082 and 53894 permille). So late genomes are not uniformly better or worse bodies than the founder: the retest tracks the genes (reach and rim rooting spread; a few late genomes hold better than the founder, which itself spreads in every test seed by t=3000), and breakout timing is stochastic with only 3 test seeds. Several runs saturated the world, so size comparisons there say little. I would not claim evolved bodies regrow better or worse.

## Limits and unfinished

One hand-designed rule family, 96 x 96 torus, three seeds per arm, 20000 steps, no statistics; constants were set on lone dmax-16 bodies and a handful of variants. The ecology result is a no: with budding, bodies fill the world (the boom then the food-limited mat) and touch. Not done: a protected or reserve-holding root, a gradient toward the root in transport, sparse founders with a dispersal limit, a single root per fragment, and the root-killed overgrowth. The 8x mutation arms are an addition beyond the three requested arms. The cause of the lone body's first breakout was not traced beyond the root counts.

Files: `v2-readouts.json` (lone, wound, long arms with series every 200 steps and retests), `v2-sweep-{sweep,ablation,variants,orphan}.json`, frames `v2-lone-{shape,founder}-s*-t*.png`, `v2-wound-{spared,killed}-s*-p*.png`, `v2-long-{off,on,neutral,on24,neutral24}-s*-t*.png` (lineage colours left, distance d right, roots white/red). Reproduce: `node experiments/bodies/run.ts --only lone|woundv2`, `--only longv2 --arm A --seed S --lone-size 170`, `--only sweep --group sweep|ablation|variants|orphan`, `--only merge`.

---

# v1 (2026-11-17, first rung; history, rule kept as `version: 1`)

A standalone 96x96 integer cellular automaton (`apps/lab/src/bodies/model.ts`). A body is only a pile of live cells; no body id, no Organism object, no membership list. Connected components are labelled only by an observer (`census`) for readouts and the page. Page: `/bodies/` (unlisted, noindex, not in nav or sitemap). Runs: `experiments/bodies/run.ts`; all numbers below come from `readouts.json` in this folder. Nothing here is pre-registered and there is no pass/fail gate.

## Everything about the rule is designed

The rule is hand-built, not searched or discovered. Designed ingredients: **root cells** (d = 0), the **distance signal d** (each cell sets d = 1 step + the minimum over live neighbours, chamfer 2/3, so it relaxes cell by cell), and the **size gene dmax** (growth may reach dmax/2 tiles from a root). Growth, upkeep, budding and "rim rooting" are also designed rules. A diffusive-inhibitor design was tried first and abandoned: the field just outside a body's edge saturates at about the same level for every radius, so the threshold window is too narrow and bodies either stall at radius 3 or fill the grid. It was not retried. No search was run.

Each cell carries a genome (dmax, grow, bud, rim). Born cells copy their parent's genome; with mutation on, a birth changes one gene by one step with probability 3/256. Budding places a seed cell (a new root) several tiles away, which is how bodies found bodies. Matter is an exactly conserved integer ledger (food + stored + 3 per cell = initial + supplied - burned - overflow - wound-destroyed); the residual is 0 in every run. Upkeep (cells burn stored food, starve at zero) is the only real sink and is what makes food scarce.

## Growth and wound (fed world: one founder, upkeep off, no budding)

Growth: one root with genome [16,60,0,0] reaches 181 cells (a filled disk, radius about 8) first at t=35 to 50 (seeds 2, 1, 3) and stays at 181 through t=200, all 3 seeds (interior share 779 permille, one component).

| wound (radius 4) | seeds | cells before | killed | cells at +150 | recovered |
|---|---|---|---|---|---|
| root spared (6 tiles from root) | 1,2,3 | 181 | 35 | 181, 181, 181 | 1000 permille (back by +25..75) |
| organiser killed (on the root) | 1,2,3 | 181 | 49 | 548, 399, 491 | 3027, 2204, 2712 permille |

Regrowth with the root spared works. Killing the root does not give a regrown body: the fragment re-roots at its edge (4 to 6 roots afterwards) and **overgrows to 2.2 to 3.0 times the original size**. That is a real limitation of the orphan rule; it is reported, not tuned away (`wound-killed-*.png`).

Deviation from the plan: a lone body on rain food alone cannot live. With upkeep on, the root starved at about t=100 and the body churned and spread, so the "stable disk" and wound tests are run in a fed world (upkeep off), and the model has an `upkeep` switch (default on; the page exposes it). The plan's growth numbers (181 cells, 35 killed) reproduced exactly in the fed world.

## Long runs (upkeep on, 3 founders, 20000 steps, seeds 1-3)

Means over samples with t >= 10000, three seeds pooled:

| | cells | components | largest share | interior | coverage | roots |
|---|---|---|---|---|---|---|
| mutation OFF | 3656 | 138 | 649 permille | 185 | 396 | 56 |
| mutation ON | 3791 | 142 | 780 permille | 231 | 411 | 30 |

Per run at t=1000 / 5000 / 20000 (cells, components, largest share permille, interior permille, variants):

| seed | mutation | t=1000 | t=5000 | t=20000 |
|---|---|---|---|---|
| 1 | off | 4104, 118, 850, 286, 1 | 3440, 174, 440, 175, 1 | 3584, 163, 670, 169, 1 |
| 1 | on | 3747, 92, 623, 259, 30 | 3749, 121, 766, 164, 79 | 3192, 190, 688, 168, 77 |
| 2 | off | 3846, 157, 355, 256, 1 | 3676, 132, 685, 185, 1 | 3341, 148, 250, 140, 1 |
| 2 | on | 4075, 96, 924, 247, 32 | 2960, 220, 428, 125, 79 | 3236, 184, 437, 212, 70 |
| 3 | off | 3914, 107, 777, 211, 1 | 4008, 113, 825, 201, 1 | 3629, 155, 426, 224, 1 |
| 3 | on | 3869, 140, 883, 205, 33 | 3957, 139, 860, 203, 79 | 3129, 191, 588, 180, 70 |

Mutation events by t=20000: about 24500 to 25200 per ON run, with 70 to 77 living genome variants.

## What the bodies did

**They did not hold as discrete disks even with mutation off.** With upkeep on, the founder genome fills about 40% of the grid with a ragged, hole-riddled mat: 140 to 170 components, only 14 to 29% of cells interior, largest component share swinging between 250 and 920 permille. Individual sample points near 900 permille are fleeting percolation of that mat, not a stable single body. The clean 181-cell disk exists only in the fed world, so "body held" is true only there.

**Mutation ON drifts toward a film intermittently; OFF never does.** My readout definition of film-like is largest share above 800 permille and coverage above 500. Over the 153 samples per arm at t >= 10000 (three seeds pooled), coverage ranged 319 to 449 permille with mutation OFF and 212 to 620 with mutation ON. Largest share was above 800 in 46 OFF samples and 99 ON samples. Samples meeting the full film definition: 0 OFF, 15 ON (seed 1: 5, seed 2: 8, seed 3: 2; peaks of 561, 620 and 526 permille coverage). So with mutation on, all three runs visit film-like states, but only briefly and they fall back (end-of-run coverage 339 to 351 permille, largest share 437 to 688), so the bodies neither stay discrete nor settle into a stable film. This is the one aggregate readout that separates the arms; with three seeds I do not call it more than suggestive.

**Mutation changed the genes a lot and the other shape numbers little.** In all three ON runs no cell of the founder genome (dmax 16, grow 60, bud 4, rim 0) is left at t=20000 (counted over every living cell, not only the top three genomes). Mean genes at t=20000, OFF vs ON (dmax, grow, bud, rim): OFF 16.0, 60, 4.0, 0 (unchanged); ON dmax 49.4/52.6/45.6, grow 161/219/127, bud 10.5/7.0/5.4, rim 52/92/12 (seeds 1/2/3). All four means rose in the founder-at-floor directions in every seed. That is **not evidence of selection**: founder dmax, grow, bud and rim sit at or near the lower end of their ranges and mutation is a one-step walk clamped at the bounds (about 25000 events per run), so a neutral reflecting walk would also raise every mean, in every seed, with no selection. I ran no neutral control (for example a gene-blind copy), so whether the drift is selection or neutral drift is undetermined. The other aggregates moved modestly: components 138 vs 142, interior 185 vs 231 permille, mean coverage 396 vs 411, roots 56 vs 30.

**Retests of late genomes (alone, fed, 3 test seeds): saturated, so uninformative.** The founder alone for 300 steps (budding on) makes 856 to 1638 cells in 1 to 2 components; with budding off it grows 181 cells and regrows 1000 permille after a root-spared wound. Every late ON genome (dominant and top 3) fills essentially the whole 96x96 torus (9054 to 9216 cells; flagged `saturated` in readouts.json) in the fed world, so a radius-4 wound kills about 49 of 9216 cells and the world refills to 1000 permille. The 1000 permille for late genomes therefore says nothing about whether evolved bodies regrow better or worse than the founder; it only shows the late genomes have far larger reach. The retest is also fed (upkeep off), so it says nothing about regrowth under the scarcity the long runs evolved in. Mutation OFF has no late-vs-founder contrast. Treat the regrowth-of-late-genomes question as not answered.

## Limits

One rule family, hand-designed roots and distance signal, a 96x96 torus, three seeds per arm, 20000 steps, no controls beyond mutation on/off, no statistics. Growth uses a rotated scan with mild order bias; matter stays exact. No neutral-drift control. The late-genome regrowth retest is saturated by grid size and fed. Organiser-killed overgrowth is unresolved. The page and PNGs show the model as it is, designed ingredients included.

Files: `readouts.json`; `growth-s*-t*.png` (lineage colours left, distance d right, roots white/red), `wound-{spared,killed}-s*-p*.png`, `long-{off,on}-s*-t*.png`.
