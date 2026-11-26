# grow-only arm (GATE_GROW only), 2026-11-18
Commands (cwd = worktree root, PATH with nvm 24): scripts run2.sh, run3.sh, run3b.sh (seed 2 rerun, first attempt killed), run4.sh, run5.sh here. Summaries: late.mjs, cmp.mjs, sum.mjs; outputs cmp-r2.txt, cmp-r3.txt. Numbers = mean over samples t>=10000, seeds 1/2/3.
Rung 1 pair --gates grow 12000 steps (r1-pair-grow-s*; plain control r1-pair-plain-s*): two patches, seam 0, 2 components at t=12000 in 3/3 (plain: 1 component, seam 5-10 permille, still 2 mark patches because marks never change). Bodies are 2 comps of 431-776 cells (not 170 each; extra roots appear).
Rung 2 crowd, no mutation, 3 distinct tags: 3 components, 3 clades, one clade holds 5499-6574 of ~6900 cells (grow-s1..3: 6562/6574/5499 at t=20000); ~40 basins; seam 0 (plain 17-25). All-same-tags + gate: 1 patch, gate inert. Grain = founder clade, not body.
Rung 3 mutation on (genes+marks), 20000 steps:
 A (tag-mut-rate 400, step 8 <= tol 16, every birth): marks drift as chains, still 3 comps, one clade ~95%. Not boundaries.
 B (--tag-mut-rate 65536 --tag-mut-bud --tag-step 40): comps 11/33/14, seam 0, patch births/deaths ~0 after the first boom (jammed mosaic). Blind control: 1 comp, seam 50-93 permille, 9-26 patches.
 D (B + --genome 16,60,16,0): comps 38/35/28, 26-34 big patches, median big patch 144/177/144 cells, 60-70 basin median. Blind: 1 comp, seam 74-141.
Wound-in-crowd on B (14000 steps, wound at 12000, radius 4): 36-37 killed, root spared; 1500 steps later disk refilled: 0/19/16 foreign tiles of 26/22/25. Blind control: 14/0/8 foreign of 31/24/25. No difference at this n.
Failure mode: jammed-mosaic (B, D), sweep-to-mat at clade level without mutation (rung 2, A). Frames looked at: r1-pair-grow-s1/s2 t12000, r2-crowd-grow-s1/s3 t20000, r3-B-grow-s1/s3, r3-A-grow-s3, r3-D-grow-s1, r3-W-B-s2 t12000/t13500.
