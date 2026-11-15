# Sizing record (14 Nov 2026), written before any main-screen run

EXPLORATION. Sizing runs S1, S2, S2d, S3, S4 are dev slots 8209-8216 (2 or 4 seeds), none enters a table. Rules R1 to R6 of DESIGN.md section 7 were applied as written by `bootstrap-screen.ts --size`. The frozen result is `runs/mycelium-bootstrap/sizing-frozen.json` (gitignored); every main command passes that file.

## What the rules gave
- R1 settle: uniform light did not settle by step 400 (fallback t0 = 400, failure reported); gradient light settled at 300. t0 = 400 (larger of the two lights, the builder's reading; with G's own 300 the outcome is the same, see next line).
- R2: v = 32 (carpet binds: carpet v48 has 0.01 of laid cells at A >= 8 at step 10, patches 0.47). g_R = round(493/32) = 15.
- R3: median laid-edge x_e at default decay reaches q = 1 until step 350, q = 2 until 276, q = 3 until 200. t0 (400) exceeds all three, so PW(q) is empty at every plateau strength: **T is UNREADABLE at P1, P2, P3 by label rule 1**. With t0 = 300 (G's own settle) PW(1) would be (300, 350] = 50 steps and PW(2), PW(3) empty, still under 150. Neither v nor t0 is moved: R2 and the R1 fallback fix them.
- R5 (S3 pilot, 2 seeds, 20,000 steps): FREE-ONLY(16) inherit p50 trail per occupied cell 0.3, so F* stays 16. Median x_e between occupied cells is 0.0, so the fallback applies: Fg lo/mid/hi = 1/1/2 (lo and mid merge), pilot reported NO-BITE-LIKELY. The treated pilot (F 16, conduit g 1) has conduit effP50 = 0 and csat 0 in both seeds: the conduit is inert at this strength.
- R6 (S4, 4 seeds): theta lo/mid/hi = 2/4/8 (defended-particle share 0.92 at theta 1, 0.43 at 2, 0.10 at 4, 0.008 at 8); owned share of occupied cells 0.97 (stop rule not triggered).
- S2d (S0.2 at pDecay 66, 2 seeds, 1,000 steps): the durable road at v 32 has median laid-edge x_e 32 at step 10, 21 at step 400 and 15 at step 1,000; 77 percent of laid cells at A >= 8 at 1,000, desert share 0.08. So the durable road is alive across D0's window (400, 2,400]. (`--size` does not read S2d; the numbers were read by hand from the run files.)

## Deviations and things not applied (recorded before any main run)
1. **diffA (T twin) hand-added: 44.** R4 defines it over PW, which is empty, so the runner measured nothing. I used the median over 2 seeds of the mean Dd over all directed edges over reads in (0, 276] (t_alive of q = 2) of the keyless prelaid rows-v32 runs: 44.45 (other windows 44.8 to 45.0). Written into the frozen sizing file. Because T is UNREADABLE, the twin only matters for the descriptive windows.
2. **R4 check of g_R at t0 not applied**: at t0 = 400 median x_e is 0 (road dead), realised eff is 0, and the rule gives no direction to move. g_R stays 15.
3. **R5 "moved once if median eff outside [9, 53]" not applied**: x_med is 0, so there is nothing to scale; the design's fallback (Fg-mid 1, NO-BITE-LIKELY) stands. No target was invented.
4. **Merged strengths**: Fg lo and mid are both 1, so arms `T-16-lo` and `T-16-mid` are the same world (reported where they appear).
5. **DIFF arm equals FREE-ONLY**: diffAF = 40 is the default `diffA` (40). The DIFF arm (F 16, diffA 40, no conduit) is the same config as FREE-ONLY(16) and so runs the same world on the same seed.
6. **F pilot gate**: treated TMabove above FREE-ONLY in 1 of 2 seeds by the letter (seed 8209: 0.0015 against 0.00015 per particle; seed 8210: 0 against 0). Both far below 0.1. The gate passes by the letter; the magnitudes are the real reading.
7. **gOwner and gCpub not measured** (owner-edge readouts, step 3c, not built): the O arms with an owner conduit cannot be sized by rule R6, the C-pub matching is unmeasured, and `--label` issues no O label. O is INCOMPLETE (not run: sizing and analysis); see SCREEN.md for what, if anything, was run as descriptive rows at the runner's stand-in strengths.
