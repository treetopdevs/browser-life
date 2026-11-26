# all-three-fixed (GATE_SHARE+GATE_GROW+GATE_SIGNAL, fixed tol), exploratory, seeds 1-3
Commands: commands.txt (exact flags); run.sh wrapper; r2.py / summ.py summarise readout.json (means over t>=10000).
Prefixes: p-* pair 12000 steps; c2-* crowd mut off 20000; m-*/n-* crowd mut ON; w-F-* wound-in-crowd.
## Rung 1 pair (tol 0,8,16,32,64; marks 128 apart): two bodies stay two, seam 0 pairs, 12000 steps, 3/3 seeds.
Results identical for every tol < 128 (same hashes). Each clade grows past 170 (total 431-776 cells, 3-5 root basins).
Controls: no gates seam 5-11 permille, one component; tol 128 (all match) one patch, seam 0 (they fuse).
## Rung 2 crowd, mut off, marks 0/85/170: gates stop fusion but NOT sweeping. 3 patches, largest 79-96% of cells (6562/6574/5499),
the other two frozen at 144-174 (s1,s2) or 145 and 1306 (s3), enclosed by the dominant clade. tol 0/16/64 identical.
No births/deaths of patches. Basins 42-46 (median 152-167), as no-gate (37-42, 166-183). Same-tags control: 1 patch.
## Rung 3
A (tol16 step8, rate 400, all births): marks drift but gate keeps clades; 3 patches, 95-96% mat; blind control 1 component with seam 10-57 permille.
D/E (bud-only, rate 400): tagMutations 0 in all seeds (too few buds). n-F/G (bud-only rate 20000, tol0 step8 / tol16 step64): 7-15 big patches,
largest 42-73%, seam 0, comps 7-15, vs blind 1 component seam 22-75 permille. n-H (rate 4000 all births): back to 3 patches.
Wound (F): seed1 wound happened at 477 cells (lone founders, not a crowd); seeds 2,3 disk refilled 75-100% with matching marks within 150-1500 steps.
