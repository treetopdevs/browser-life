# share-only arm (GATE_SHARE=1 only), 2026-11-18, exploratory, 3 seeds

All numbers from readout.json in this dir (sum.py / agg.py print them; agg = mean over samples t>=10000).
Commands (run from worktree root, node 24 on PATH):
- r1 pair, 12000 steps: `v3.ts --scenario pair --steps 12000 --seed S --gates share` (control r1-plain: no flags)
- r2 crowd, 20000, 3 founders (marks 0/85/170): `--scenario crowd --gates share` (control r2-plain: none); r2-share5/-plain5 add `--founders 5`
- r3 crowd, mutation ON: `--mut on --tag-mut-rate 32768 --tag-step 64 --tag-mut-bud --gates share`; control r3-blind adds `--tag-blind`; r3-same: `--mut on --tags same --gates share`
- r3w wound-in-crowd 9600 steps, wound at 8000, same flags as r3 / r3-blind
Note: with --tag-blind the gate is off, so r3-blind has the same cell/basin dynamics as r3-same (confirmed: identical basin numbers); marks differ only in the readout.

## Rung 1 (pair, no mutation): PASS but uninformative
Two tags, 2 patches at t=12000 in 3/3 seeds, mark seam 5-13 permille. The ungated control does exactly the same (2 patches, seam 5-10) because marks are clonal and nothing mutates. Bodies are not truly kept apart: they touch (1 component all run). Bodies grow beyond 170 (share s1 742 cells, s2 951, plain 477/453/712); basins 3-6 appear.

## Rung 2 (crowd, no mutation): FAIL, sweep-to-mat
Mat of ~6900 cells, 1 component (lcc 999-1000 permille), ~40 basins (median 165-181), like v2. One mark owns 97-99% of cells with the gate (r2-share), 91-94% without (r2-plain). The winner is whichever founder had budded most by t=1000 (702/1410/743 cells vs ~165 each): the sweep is the boom-phase land grab and is over by t=3000 with the gate off the critical path (growth into empty tiles is not gated). The gate does shrink the losers (6-9% -> 1-3%) and cuts mark seam (14-25 -> 3-5 permille). Losers survive as small discrete islands (r2-share-s1 frame: 99 and 42 cells in a blue sea). 5 founders: 2 big clades coexist in 2/3 gated seeds (4553+2018, 3754+2858) vs 2/3 ungated (4361+1760, 3063+2541); so coexistence of two clades is not a gate effect at n=3. Gate lowers seam (5-24 vs 48-61 permille) and patch count (7-17 vs 21-33).

## Rung 3 (mutation ON, bud-only mark mutation, step 64 > tol 16)
Mean t>=10000, seeds 1/2/3, share | blind | same-tags:
- comps 1.0/1.0/1.1 everywhere; lcc 1000: one mat in every arm.
- basins 66/72/64 | 48/67/56 | 48/67/56; median basin 103/92/100 | 143/103/120
- big patches 30.9/8.4/15.1 | 25.6/7.6/8.8 | 1
- seam permille 60/18/34 | 92/35/56 | 0
- distinct marks at end 9/5/6 both mark-mutating arms (36/6/20 mutations share vs 17/5/11 blind)
- patch births/deaths t>=10000: 46/48, 8/6, 8/6 (share) vs 1/2, 1/0, 0/0 (blind)
- grow mean 69.9/60.4/62.2 | 68.4/60.9/61.1; rim 5.1/7.9/6.0 | 3.9/7.6/4.9; dmax 16, bud 4 unchanged
- blockedGrow/blockedBud 0 (GATE_GROW off, as designed)
Drift alone makes tag patches (blind has 7-26 big patches). Gate: ~35-50% lower seam fraction, more patch turnover in s1 only, and more/smaller basins (+10 to +18). That last one is the only structural difference and could be a side effect (fewer shared stores, more orphan rooting); 3 seeds. Failure mode: sweep-to-mat (physically one mat, bodies only as observer basins, ~100 cells median), not dust: the tag mosaic has big patches whose borders cut across basins (frame r3-share-s1).
Frames looked at: r2-share-s1 t1000 (3 clades, blue has 4 touching bodies, discrete) and t20000 (blue sea, red/green islands, basin panel shows ~40 roots in one mat); r3-share-s1 / r3-blind-s1 t20000 (mosaic of coloured patches, white seam lines; control looks the same type of picture); r2-share5-s3 t20000 (two big clades with 1-cell seam lines); r1-share-s2 t12000 (pair: green + purple, purple is 4-6 basins).

## Wound (r3w, radius 4, root spared, 1500 steps)
Killed 36/35/35 (share) vs 33/35/41 (blind). Disk live again 28/28/27 share vs 25/24/27 blind (of ~35). Basin live 880/913/800 permille of pre-wound basin share vs 886/869/878 blind. No foreign mark into the disk in 2/3 share seeds (s3: 11 of 27 foreign), blind 1/3 (s1: 4 foreign). Root died in the target basin in share s1 and s3 (rootAlive False), 0/3 blind. Nothing distinguishes the arms at n=3.

## Why
Gating transport only stops store crossing a seam; it does not stop growth, the d signal or rooting, so cells fill all tiles the food budget allows. The seam is a conduit-free line, not a wall: the mat stays one component. Which mark wins is decided in the boom by who budded first. The gate shrinks a minority at the border (cut off from the majority's store flow) rather than protecting it.
