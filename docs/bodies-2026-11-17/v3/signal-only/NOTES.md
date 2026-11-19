# signal-only arm (GATE_SIGNAL only), 2026-11-18, exploratory, 3 seeds

All dirs here hold readout.json (+ frames). `summ.py` prints the table rows. Run scripts: run-r3.sh, run-r3b.sh, run-w.sh. Control for a gate-only arm = the ungated run (rung 1/2) or --tag-blind (rung 3; physically identical to ungated, same stateHash).

Commands (root of worktree, PATH with nvm 24):
- r1-*: --scenario pair --steps 12000 --seed S [--gates signal]   (plain = control)
- r2-*: --scenario crowd --steps 20000 --seed S [--gates signal]
- r3-*: crowd --mut on --tag-mut-rate 400 --gates signal [--tag-blind | --tags same]
- r3b-*: crowd --mut on --tag-mut-rate 65536 --tag-mut-bud --tag-step 40 --gates signal [--tag-blind]   (tol 16 < step 40: every bud body gets a foreign mark)
- w-*: wound-in-crowd 9600 steps, wound at 8000, r3b settings, seeds 1,2, sig vs blind

Findings
- Rung 1: pair stays two patches with a seam (5-13 permille) in all 3 seeds, signal and plain alike; marks never mutate there so this is trivial. Seed 2 (both arms): one founder outgrows (1047-cell patch) while the other holds ~153.
- Rung 2: crowd, no mutation: the signal gate does not stop the mat (one component, ~6860 cells, largest patch 6433-6526 = 94-95%). It makes more, smaller root basins (51-53 late mean vs 37-42 plain; median 144-150 vs 177-181 in the last census) and gives the losing founders' clades enclaves ringed by seam (frame r2-sig-s1). Failure: sweep-to-mat.
- Rung 3 (marks mutate at all births, rate 400/65536): sig vs blind patches: seed1 44 patches (4407/1591 big), seeds 2,3 one patch ~6600. Marks drift in clades, bodies are not marked. Gene means same as blind within noise (dmax 16.0, grow 61-69, bud 4.0, rim 4-8). Sweep-to-mat in 2 of 3 seeds, 2-clade jammed mosaic in 1 (turnover ~0 births/deaths per 200 steps).
- Rung 3b (per-body marks): signal gate shatters basins: 125-150 late-mean basins (median 31-44 at t=20000, quartile1 8-15 cells) vs 48-67 and median ~130-165 in blind. Mark patches are a mosaic (23, 10, 20 big patches; seam 70-127 permille vs 50-93 blind), but they do not coincide with bodies. Patch turnover 0.1-0.24 births/deaths per sample vs 0-0.04 blind. Failure: dust-of-basins plus mat (one connected mat, comps ~1.04).
- Wound (2 seeds, 1500 steps): basin and disk refill in both arms; basin targets are tiny (83-97 cells); foreign marks in the disk: sig s1 7 at the end (max 11) vs blind 5; seed 2 zero in both. Nothing to claim.
- Why: the gate acts only on d. Growth, absorption and transport are ungated, so a mat forms regardless; the signal gate only splits the observer/rooting structure. Clonal marks give clade-level, not body-level, separation.
