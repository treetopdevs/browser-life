# Arm all-three-evolvable-tol (GATE_SHARE+GATE_GROW+GATE_SIGNAL, TAG_TOL_GENE=1), seeds 1-3

Run scripts: run.sh, batch1..5.sh (flags inside), an.py/an2.py (readout tables), tolscan.ts (observer-only tolerance histogram every 1000 steps, uses the harness buildWorld). Outputs: r1-*, r2-*, r3*-*, r4*-*, tol/*.json.
Base flags: --gates share,grow,signal; evolvable arm adds --mut on --tag-mut-rate R --tol-gene; control adds --tag-blind; sametags adds --tags same.
(pair cannot take --tol-gene: pair forbids mutation. Rung 1 used fixed tol 16.)

- Rung 1 pair, 12000 steps, 3 seeds: two components every sample, seam 0, 2 patches. Budless founders hold ~160-190 cells each until ~2000-6000 then grow (seed 1: 850 cells at 6000; seed 2: 431 at 12000). Stays two bodies.
- Rung 2 crowd no mutation, distinct marks (0,85,170): 3 patches forever, seam 0, no patch births/deaths, comps 3.0-3.2, basins 42-46 (median 152-167). One founder clade takes ~6500 of ~6900 cells (seed 3: 5499 + 1306); the other two founders stay 145-175 cell disks inside a moat of empty tiles (frames).
- Rung 3, mutation ON (genes+marks+tol gene), tag-mut-rate 400 / 6000 / 32768, gated vs --tag-blind: gated keeps 3 patches, seam 0; blind fuses to 1 component with 4-75 patches and seam 10-92 permille. Tolerance: no run moves toward 128 or to all-zero. Distribution (tol/*.json): gated frac(tol<8) 0.1-7.5% vs blind 0.7-29%; median A 16/20/16 vs B 16/12/12 at rate 32768 (3 seeds each, not a test). Tolerance distribution is frozen after ~t=10000 (births ~0.07/cell/1000 steps late).
- All-same marks (rung 3 C): one patch, 1.0-1.3 comps; a mat as in v2.
- Wound (t=14000, rate 6000): target basin is inside the big clade; disk refills 59-95% by 1500 steps, 0 foreign cells gated; blind seed 1 has 20 foreign. 
