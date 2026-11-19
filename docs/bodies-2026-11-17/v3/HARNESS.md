# Rules v3 and the v3 harness (2026-11-18, exploratory)

No gates, no pre-registration. v3 = v2 plus optional boundaries: a heritable recognition mark `kin` per cell and gates/costs that compare the marks of two *neighbouring* cells. With every knob at its default, physics, PRNG stream, `hashState` and every pinned v1/v2 hash are unchanged (`apps/lab/test/bodies-v3.test.ts` pins six 2000-step hashes recorded from the untouched model, and a 20000-step crowd run reproduces the stored v2 `stateHash` 2445250181, see `timing-crowd-plain/readout.json`).

Code: `apps/lab/src/bodies/model.ts` (rules, dynamics), `apps/lab/src/bodies/observe.ts` (observer-only readouts), `experiments/bodies/v3.ts` (harness, header comment lists every flag), `experiments/bodies/png.ts` (`writeFrameV3`).

## The mark and the match

- `kin` (Uint8, 0..255, circular) and `kinTol` (Uint8) per live cell, separate from the lineage `tag`. Founders get chosen marks (`founderTags`); every daughter and every bud copies its parent's mark and tolerance exactly.
- Mutation: per birth, with probability `tagMutRate/65536` (world option, `--tag-mut-rate`, default 0), the newborn's mark moves by +-`TAG_STEP` (circular). It uses its own PRNG channel (hash channel 21), never the gene stream, `mutations` or `nextTag`. (The scan permutations used with `GATE_GROW` / `RAID` use channels 18-19, 22-23 and 24-25; v2 uses 1-15.) `TAG_MUT_BUD=1` restricts mark mutation to bud births (daughter bodies); the default mutates at every birth. `TAG_STEP <= TAG_TOL` gives slow drift chains (a mutant still matches its parent); `TAG_STEP > TAG_TOL` makes every mutant foreign to its parent.
- Match of two neighbouring cells: circular mark distance <= tolerance. The tolerance is the rule constant `TAG_TOL` (default 16; 128 or more matches every pair) or, with `TAG_TOL_GENE=1`, the **lower** of the two cells' own heritable tolerances (symmetric, so each edge is decided once; one permissive mutant cannot force acceptance; a gene-blind world reads the constant). With the gene on, half of the mark-mutation events move the tolerance by +-4 instead of the mark.
- Matching is not transitive when the tolerance is above 0.
- `tagBlind` (world option, `--tag-blind`): marks mutate and are inherited, but every gate, the seam cost and the raid treat all pairs as matching. Test-checked: physically identical to the gates-off world (all state arrays, all counters, `hashState`).

## Knobs (rule constants, all default off; `--rules-override` takes any of them, shortcut flags in brackets)

| knob | semantics |
|---|---|
| `GATE_SHARE` 0/1 [`--gates share`] | store transport along a live 4-neighbour edge happens only if the two cells match |
| `GATE_GROW` 0/1 [`--gates grow`] | contact inhibition: a growth birth is blocked if the empty tile touches (8-neighbourhood) any live cell that does not match the newborn, judged on the newborn's FINAL mark and tolerance (after any mark mutation of that birth, which is computed before the test and then applied unchanged); bud landings are checked the same way. With the gate on, growth, budding and raids scan the tiles in a random per-step permutation (not the rotated raster scan), so neither side of a contested gap wins by position; with it off the scan is v2's. `blockedGrow` / `blockedBud` count blocked attempts that would otherwise have succeeded, one per tile per step, so the same tile blocked on 100 steps counts 100 |
| `GATE_SIGNAL` 0/1 [`--gates signal`] | the distance signal d relaxes only over matching 8-neighbours; a cell with no matching neighbour gets d = 255 and can only re-root as an orphan; the basin observer follows only matching neighbours while this is on |
| `SEAM_COST` n [`--seam-cost`] | a cell with a non-matching live 4-neighbour burns 1 + n (at most what it holds) at its upkeep tick; it dies only when it holds nothing at its tick, as before. Extra burn is in `seamBurned` and in `burned` |
| `RAID` n [`--raid`] | once per step, a cell with room takes min(n, half the gap, room) from one richer non-matching live 4-neighbour (random per-step permutation scan, random start direction); works even with `GATE_SHARE`. Only the poorer cell takes, so it is a leak that equalises across a seam, not lineage-specific predation. Moves matter between stores only; `raided` counts units |
| `TAG_TOL` n [`--tol`] | match tolerance (above) |
| `TAG_STEP` n [`--tag-step`] | mark mutation step (above) |
| `TAG_TOL_GENE` 0/1 [`--tol-gene`] | tolerance is a heritable gene (min of the pair) |
| `TAG_MUT_BUD` 0/1 [`--tag-mut-bud`] | mark mutation only at bud births |

Contact for `SEAM_COST` and `RAID` is 4-neighbour contact (the transport edges); a diagonal-only touch costs and raids nothing, while `GATE_GROW`, `GATE_SIGNAL` and the patch observer use the 8-neighbourhood.

Ledger: the residual is exactly 0 with every knob on (tested over 2000 steps each, with a wound); `checkedRules` bounds: gates and the two 0/1 switches in {0,1}, `TAG_TOL <= 255`, `TAG_STEP <= 128`, `SEAM_COST + 1 <= CAP`, `RAID <= CAP`; `tagMutRate` integer in 0..65536.

What a mismatch does, by combination (warning 2 from the earlier sandboxes): with only `GATE_SHARE` a foreign cell still absorbs, grows into and roots from the mat, it just does not get or give transport. Matching is not transitive, so with `GATE_SHARE` store can still cross between two cells that do not match through a chain of cells that match each neighbour (marks 0, 16, 32 at tolerance 16: stores 9/8/7 after 30 steps). `GATE_GROW` judges the newborn's final mark against all 8 neighbours at birth and marks never change in place, so once marks are consistent at the start it never creates a mark seam: the seam share stays exactly 0 even with mark mutation on (checked with steps above the tolerance, growth and bud paths; founders that touch at step 0 with foreign marks start with a seam). Then `SEAM_COST` and `RAID` do nothing (they have nothing to act on); to make them bite leave `GATE_GROW` off. Because the gate reads the newborn's final mark, a mutant that would touch a cell it does not match is simply blocked (and counted), so mark mutation with `GATE_GROW` slows growth where marks differ.

## Harness

```
PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH node --no-warnings experiments/bodies/v3.ts --scenario pair|crowd|wound-in-crowd --out <dir> [flags]
```

Run it from the worktree root. Flags are strict: unknown flags, bad values, a flag without its value and flags that would silently do nothing all print `error: ...` and exit 2. The header comment of `experiments/bodies/v3.ts` has the same list. FINAL usage, verbatim:

```
Scenario
  --scenario S        pair | crowd | wound-in-crowd                                   (default crowd)
  --seed N            world seed                                                      (default 1)
  --steps N           steps to run                                                    (default 20000)
  --founders N        crowd / wound-in-crowd: founders 1..5 at the v2 long-run spots  (default 3; pair always has 2)
  --genome a,b,c,d    founder genome dmax,grow,bud,rim                                (default 16,60,4,0; pair 16,60,0,0 = budless)
  --tags a,b,..|same  founder marks 0..255, one per founder; `same` gives every founder mark 0
                      (default: spread evenly, 256*i/n; pair: 64,192 which are 128 apart, the maximum)
  --gap N             pair: distance between the two founders along the row y=48      (default 14; bodies of dmax 16 reach 8 each)
  --upkeep on|off     upkeep switch (default on; off is the fed world)
Mutation (all independent)
  --mut on|off        gene mutation (dmax, grow, bud, rim)                            (default off)
  --mut-rate N        gene mutation rate per birth out of 256, used when --mut on     (default 3 = the v2 value)
  --gene-blind        neutral control: genes mutate, every dynamics read uses the founder genome
  --tag-mut-rate N    recognition-mark mutation per birth out of 65536               (default 0 = marks never mutate)
  --tag-blind         control: marks mutate and are inherited, every gate/seam/raid treats all pairs as matching
  pair has no mutation: --mut on or --tag-mut-rate > 0 is an error there.
v3 rule knobs (shortcuts for --rules-override; the shortcuts win when both are given)
  --gates share,grow,signal   any subset, comma separated (GATE_SHARE, GATE_GROW, GATE_SIGNAL = 1)
  --seam-cost N       SEAM_COST: extra store burned at an upkeep tick by a cell that touches a non-matching 4-neighbour
  --raid N            RAID: a cell takes up to N from a richer non-matching 4-neighbour (at most half the gap), once per step
  --tol N             TAG_TOL: match when the circular mark distance is <= N (128 or more matches every pair)   (rule default 16)
  --tag-step N        TAG_STEP: a mark mutation moves the mark by +-N, circular                                  (rule default 8)
  --tol-gene          TAG_TOL_GENE=1: the tolerance is a heritable gene (starts at TAG_TOL; a pair of cells matches under the LOWER of the two tolerances)
  --tag-mut-bud       TAG_MUT_BUD=1: marks mutate only at bud births (new bodies), not at growth births
  --rules-override J  JSON object of any rule constants, e.g. '{"UPK":6,"GATE_SHARE":1}'; unknown keys are an error
Flags that would silently do nothing are errors (exit 2): --founders with pair, --gap without pair, --wound-* without wound-in-crowd, --mut-rate or --gene-blind
  without --mut on, --tag-step / --tol-gene / --tag-mut-bud (also as --rules-override keys) without --tag-mut-rate > 0, --tag-blind without any gate / seam cost / raid,
  --frames or --frame-scale with --no-frames. --tol is always allowed (the readouts use it).
Readouts and output
  --out DIR           output directory (required); writes readout.json and frame PNGs
  --sample-every N    readout row every N steps (default 200)
  --min-patch N       patches smaller than this are not counted in births/deaths/ages (default 10)
  --lone-ref N        reference body size for the basin `within2Permille` readout (default 170)
  --frames a,b,..     steps at which to write a 3-panel frame (mark | lineage | d); `end` allowed; default depends on the scenario
  --no-frames         write no PNGs;  --frame-scale N  pixels per tile (default 5)
  --quiet             no progress lines
wound-in-crowd only
  --wound-at N        step of the wound (default 8000; must be < --steps)
  --wound-radius N    wound disk radius (default 4);  --wound-d N  wound centre at chamfer d near N inside the target basin (default 14, about 7 tiles from its root)
  --wound-watch N     steps tracked after the wound (default 1500);  --wound-every N  tracking interval (default 50)
  The target is the root basin (observer label) whose size is the median of basins of at least 60 cells; its root is spared (no root tile is inside the disk).
  woundTrack rows count the basin's tiles and the disk's tiles that are live again and how many of those carry a mark matching the pre-wound majority mark.
```

Defaults for `--frames`: pair at steps 0, 100, 300, 1000, 3000 and the end; crowd at 0, 1000, 5000, 10000 and the end; wound-in-crowd at 0, 5000, the end, plus the wound step, +150 and +`--wound-watch` (and `-before`). Use `--no-frames` for timing or many-seed runs.

Boolean flags take no value: `--gene-blind --tag-blind --tol-gene --tag-mut-bud --no-frames --quiet`. Everything else takes one value. `--steps 0` is allowed. The resolved settings are written to `readout.json` under `meta` (`rules` is the full resolved rule set, `rulesOverride` only what you passed).

Scenarios: `pair` = two budless (16,60,0,0) founders `--gap` (14) tiles apart on row 48 with marks 64 and 192 (128 apart, the maximum), no mutation allowed. `crowd` = `--founders` (3) founders at the v2 long-run spots, genome 16,60,4,0, marks spread 0/85/170 (`--tags same` gives all 0). `wound-in-crowd` = crowd, then at `--wound-at` a radius-4 disk is wounded inside the observer root basin whose size is the median of basins of at least 60 cells (centre at chamfer d near `--wound-d`, chosen so that no root tile at all is in the disk) and the basin's tiles and the disk's tiles are tracked every `--wound-every` steps. `wound` in `readout.json` records `rootsInDisk` (live roots inside the disk, 0 by construction) and `rootSpared` (computed from it); `refKin`/`refTol` are the most common mark and tolerance in the disk before the wound, and "matching" in `woundTrack` means matching that mark under the real rule.

Output: `<out>/readout.json` (`meta`, `series` every `--sample-every` steps starting at t=0, `wound`, `woundTrack`, `final` = the last row plus `residual`, `validate`, `stateHash` (the v2 hash, ignores marks) and `stateHashFull` (adds marks, tolerances and v3 counters), `frames`, `timingMs`) and `<out>/frame-tNNNNN.png`: three panels, mark hue (cells touching a non-matching 4-neighbour are white) | lineage colour (roots white) | distance d (roots red). Exit codes: 0 ok, 2 bad flags or an impossible scenario (the message goes to stderr).

## Readouts (observer only; the dynamics never read them)

Each `series` row has: world census (cells, components, largest share, interior, roots); `basins` (root basins: count, quartiles, unrooted, top 8 sizes); `patches` (tag-connected patches: components of live 8-neighbour cells joined only by matching pairs, chain-linked when the tolerance is above 0; count, count >= `--min-patch`, top 8 sizes, largest share, births/deaths since the previous sample, ages, completed lifetimes of dead patches); `seams` (live 4-neighbour pairs, mismatched pairs and permille, cells on a seam, share of mark seams that lie on a basin border); `kin` (distinct marks, 16-bucket histogram, dominant share, mean tolerance, generation median/mean/max = births along the parent chain, reported beside any integrity number as the mutation-depth check); `dEq255Cells` (orphans under `GATE_SIGNAL`); and the counters. Matching in the readouts always uses the real marks, also in a `tagBlind` world.

Patch turnover rule (`PatchTracker`): between two samples an earlier big patch and a later big patch are linked when they share at least half of the smaller one's tiles. A tile is shared only if it is live at both samples and its mark at the later sample still matches the mark the same tile had at the earlier one, so a clade replaced in place (a foreign mark over the same tiles, or over the footprint of a patch that vanished) is a death plus a birth, not a patch that lives on. A later big patch with no link is a birth, an earlier big patch with no link dies, a linked later patch inherits the age of the linked earlier patch with the largest overlap plus the interval. Merges kill nobody; a half retaken by a foreign mark gives one birth (the retaken half) and the untouched half keeps the old patch's age. `replacedTiles` (in `patches`, null at the first sample) counts the tiles live at both samples whose mark changed beyond the tolerance, over all tiles, not only big patches. The tracker is only as fine as `--sample-every`; ages and `deadLifeMean` are measured at samples, so a patch born between samples starts at age 0 at the first sample that sees it and one that dies between samples loses its last interval (true lifetimes are longer by up to about one interval at each end).

## Two examples that were run (re-run with this version of the model)

```
node --no-warnings experiments/bodies/v3.ts --scenario pair --steps 2000 --seed 1 --quiet --gates share,grow,signal --seam-cost 1 --out docs/bodies-2026-11-17/v3/example-pair-gated
node --no-warnings experiments/bodies/v3.ts --scenario wound-in-crowd --steps 9600 --seed 1 --quiet --tag-mut-rate 400 --gates grow --wound-at 8000 --out docs/bodies-2026-11-17/v3/example-wound-crowd
```

(`example-pair-plain` is the first command without the gate and seam flags.) First look, from those readouts, one seed each, no claim: the pair with no gates ends at t=2000 with 316 cells, two patches and a seam of 7 permille of live pairs; with all three gates and a seam cost it ends with 349 cells, two patches and a seam of 0 permille, and `GATE_GROW` blocked 5124 growth attempts (tile-steps; `example-pair-gated`). In the wound run the target basin had 138 cells, the radius-4 disk held 36 live cells and all 36 were killed (no root inside the disk, `rootsInDisk` 0); 1500 steps later every one of the basin's 138 tiles and the disk's 36 tiles was live again, all carrying the pre-wound mark (`diskForeign` 0 at every tracked step), and `rootAlive` is true in all 31 tracked rows. With `GATE_GROW` on and a single clade around the wound that is expected.

Crowd, 3 founders, seed 1, 20000 steps (`timing-crowd-plain`, `timing-crowd-all-knobs`; means over the samples at t >= 10000 unless noted): with no gates the mat is one component (1.04) with about 40 root basins (40.4, median basin 173 cells), 4.1 big patches and a mark seam of 17 permille of live pairs. At t=20000 the largest patch holds 6489 of 6910 cells (the mark histogram has 6490 cells in the 160-175 bucket), so one founder's clade took over almost the whole mat, which is warning 3 in practice. With `--tag-mut-rate 400 --gates share,grow,signal --seam-cost 1 --raid 2` the world is 3.24 components, 44 basins (median 155), 3.0 big patches (6562, 162 and 149 cells at t=20000), no seam at all (`SEAM_COST` and `RAID` never fire: `seamBurned` and `raided` are 0), and 7 distinct marks at the end from 101 mark mutations, with 69131 growth attempts blocked. So the gates keep the three founder clades apart (a seam of exactly 0), but they do not separate the roughly forty bodies inside the dominant clade: marks are clonal inside a clade. A recognition test that separates bodies rather than clades needs marks that differ between bodies, e.g. `--tag-mut-bud` with `--tag-step` above `--tol`; that has not been run through the harness (only the unit test with a lone budding founder, which shows a seam of 0 with `GATE_GROW` on).

The plain crowd run reproduces the stored v2 `stateHash` 2445250181 (`timing-crowd-plain/readout.json`, `final.stateHash`); its `stateHashFull` is 2084384177 and the all-knobs run's is 2303766363.

Timing (single seed-1 crowd run, 20000 steps, `--no-frames`, one run at a time on this Mac, observing every 200 steps): 43.3 s of stepping plus 0.5 s of observing with every knob at default; 73.1 s plus 0.3 s with `--tag-mut-rate 400 --gates share,grow,signal --seam-cost 1 --raid 2` (the signal gate calls the match test for every neighbour of every cell). Budget about 45 s and 75 s per 20000-step crowd run, about 3 to 4 s per 2000-step pair run.

## Known limits (read before drawing a conclusion)

- No run here tests the question that matters (marks that separate bodies, not clades). The pair and wound examples are one seed each.
- Matching is not transitive (tolerance above 0): patches are chain-linked sets, and `GATE_SHARE` leaks across chains.
- Growth under `GATE_GROW` is first-come-first-served within a step, in a random permutation per step, and the multiplier is drawn by rejection, uniform over the units mod N (an earlier round-up rule gave a measurable bias, 0.493 precedence for tiles one row apart; fixed 2026-11-18, which changed gate-on dynamics; a test checks the 1 vs 5 mod 6 split). The facing-block fixture (24 seeds, two orientations, within 20 percent in the test) shows no gross bias, which does not prove unbiasedness, but a single step can still be won by either side.
- `RAID` is one-way and only as strong as the poorer cell's room; it is a leak across a seam, not predation specific to a lineage.
- Dynamics read only the marks of two adjacent cells; observers (patches, basins, generation counter) are never read by `model.ts`.
