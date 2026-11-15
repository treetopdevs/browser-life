# Mycelium bootstrap screen (14 to 15 Nov 2026)

Label: EXPLORATION, not a test. No pre-registration, 8 seeds per cell, no multiplicity control, thresholds are the round numbers of DESIGN.md section 9 and 10 fixed before any run. Plan: `DESIGN.md` (kernel rules P, F, O; sizing section 7; predicates section 9; labels section 10). Runner `tools/mycelium/bootstrap-screen.ts`; readouts `observe-bootstrap.ts`; analysis `bootstrap-analyze.ts`. Sizing record, written before any main run: `SIZING.md`. Raw outputs `runs/mycelium-bootstrap/{sizing,main,r7}/runs/<id>.json` (gitignored, 103 MB), one line per start and finish in `run-log.jsonl` (this folder). Nothing is committed.

## Result in one paragraph

None of the three bootstrap rules shows a conduit that pays on trail that is already there. **Pre-laid trail (P): the T series is UNREADABLE at every strength** (P1, P2, P3 and R): at default decay the laid road is alive for only 200 to 350 steps while the founder die-off has not settled by step 400 in uniform light, so every primary window is empty, and no T label is issued. Read descriptively anyway, in 208 runs the 8-seed median of conduit-on minus conduit-off intake is within 0.9 percent in every pair and window (single seed-pairs run from -5.4 to +4.9 percent, and the six at +3 percent or more each fail a safeguard). PAY passes in 0 of 8 seeds wherever it is defined; it is undefined for lat-G, pat-G, rows-U and phys-rows-G (no butterfly twin) and unresolved in 8 of 8 for cols-G W3. The durable-road read (D0, 24 runs, a 2,000-step window on a road alive for about 2,750 steps) gives **V(PAY-D0) = N**: intake +0.2 percent, births -10.7 percent, deaths -9.4 percent, population +3.1 percent, and DAMP in 7 of 8 seeds (per particle-step the conduit damps turnover and does not raise intake; total intake is +3.8 percent and population +3.1 percent, the size of the butterfly noise, so only the turnover drop stands out; see the Skeptic check). Because T is unreadable and D0 is N, **D and B were not run** (gate). **Free first layer (F): SUBSIDY-ONLY** at the labelled strength `T-16-mid` (6 of 8 seeds keep trail only as the free layer, 2 of 8 lose it; in no seed does the treated arm keep twice FREE-ONLY's above-layer trail, which is what K needs), with the anchor verdict MIXED (0 of 8 pay, 0 damp). The F conduit at `Fg` 1 was at or near the floor: median effective rate 0 in the pilot and in the main runs, late 90th-percentile effective rate at most 1 unit of 88 in the treated arms, 7 in the physarum anchor and 2 in the blind anchor. It was weak, not provably absent. The label is decided by the free layer and says nothing about a working conduit, and the F branch rows are floor results. **Owner conduit (O): INCOMPLETE (no label)**: the owner-edge readouts and the sizing of `gOwner` and `gCpub` were not built, so the O core ran only as descriptive rows at stand-in strengths (all 80 runs finished, all ledgers exact). Nothing here warrants a pre-registered rung (DESIGN 10.4). With 8 seeds, no noise-floor calibration and sizing that failed for T and F, this says the screen found no use of a conduit on existing trail, not that no conduit-like rule can work.

## Setup

- 128 x 128, `defaultConfig()` plus the arm's delta, GPU (`GpuMycelium`, native WebGPU through Deno), 2 processes x 3 jobs. Series lengths: T 3,000, D0 5,000, F 100,000 (anchors 40,000), O 100,000 (anchors 30,000), sizing 400 to 20,000. Branches of 2,000 steps (F at 50,000 and 100,000, anchors at 20,000 and 40,000; O at 60,000 and 100,000, anchors at 20,000 and 30,000), variants conduit off, ghost, free layer off, null A and null B (O: conduit off, enclosure off, both off, owner ghost, public conduit, null A, null B).
- Both ledgers (matter, energy) and `validateState` on the full state at every read, and the intake identity (telescoped sum and the independent matter-ledger route) at every read and branch read: **582 run files (sizing 114, main 464, R7 4), 319,179 ledger checks, 0 residuals, 872 branch variants with 0 residuals, 0 failed runs, 0 failed variants.** No run was rerun.
- Counts (non-smoke, finished = started in `run-log.jsonl`): S1 8, S2 40, S2d 40, S3 10, S4 16 (sizing, 114); main series T 208, D0 24, F core 88, F extras 64, O 80; R7 smoke timing 4 (smoke lines in the log are marked).

| series | planned | done | failed | cut / not run |
|---|---|---|---|---|
| sizing S1 S2 S2d S3 S4 | 114 | 114 | 0 | none |
| T (unconditional) | 208 | 208 | 0 | none (label impossible, see below) |
| D0 (unconditional) | 24 | 24 | 0 | none |
| D | 88 | 0 | 0 | gated off: T not TRANSIENT (it is UNREADABLE) and V(PAY-D0) = N |
| B | 32 | 0 | 0 | gated off: needs D to pay or F core V(K) = Y (neither) |
| F core | 88 | 88 | 0 | none |
| F extras | 64 | 64 | 0 | none (pilot gate passed by the letter, see deviations) |
| O core | 80 | 80 | 0 | none run under the gate; run with `--no-gate` as descriptive rows |
| O extras | 88 | 0 | 0 | not run: no sized strengths, no O label possible, extras are the first cut |
| extension to 16 seeds | 0 | 0 | 0 | not triggered: no headline vote read I |

## Seeds and the audit

`bootstrap-screen.ts --audit` at base 8209, run before sizing and again after the last run, exit 0, `audit clean: zero collisions`: 76 slots (S 8209-8216, T 8217-8232, D 8233-8248, F 8249-8264, O 8265-8280, SMOKE 8281-8284), 304 world seeds and 608 derived null seeds; 0 world and 0 derived collisions against every registered set (R2b 216 seeds, R2 10, R3 162, R4 180, NOT_R3 99, the conduit screen's 32, the shaping range, the conduit and trail-use run-logs); derived null seeds equal to a world seed 0 and shared between two rows 0; all 304 below 9001 and none refused by `run.ts`; images inherit 8209-8284, blocked 8409-8484, physarum 8609-8684, blind 8809-8884. The bootstrap run-log reconciles against the table (101 distinct world seeds logged after the screen, 0 not in the table). This screen used the first 8 slots of each series block; the held 8 were not used.

## Deviations, in order (the sizing ones are in `SIZING.md`, written before the main run)

1. **t0 and the T windows.** R1 found no settle in uniform light by step 400 (fallback t0 = 400); gradient light settles at 300. The runner takes the larger of the two. Neither choice rescues T: with t0 = 300 PW(1) is 50 steps and PW(2), PW(3) are empty. v was not moved (R2 fixes 32: carpet v48 has 0.01 of laid cells at A >= 8 at step 10). All four strengths are UNREADABLE by label rule 1.
2. **diffA twin hand-added** (44, from reads in (0, 276]): R4's window (PW) is empty. Only descriptive.
3. **R4 and R5 "move once" checks not applied**: the realised conduction at t0 is 0 (T) and x_med is 0 (F), the rules give no direction. F sizing fell to the written fallback `Fg` lo/mid/hi = 1/1/2 (NO-BITE-LIKELY); lo and mid merge, so `T-16-lo` is the same world as `T-16-mid` (identical numbers in the tables) and the dose check (e) holds only through that merge, not through a dose-response.
4. **DIFF arm = FREE-ONLY.** diffAF 40 is the default `diffA`, so F's DIFF runs the same configuration on the same seeds as FREE-16 (identical numbers); it is not an independent control. Predicate (f)'s DIFF count (8 of 8 keep) is therefore FREE-ONLY's own keep count.
5. **F pilot gate passed on a technicality**: treated TMabove 0.0015 against FREE-ONLY 0.00015 per particle in seed 8209 (0 against 0 in seed 8210), both far below 0.1. The extras were run; they add dose and toll-stratum rows and no label.
6. **O ran under `--no-gate`**. `gOwner` and `gCpub` are unmeasured (the owner-edge readouts, step 3c, are not built). The runner's stand-ins were used for the O arms: theta 4 (the measured R6 mid), `ownerConduit` 16, public conduit 8 (stand-ins), so every O number is descriptive and the strengths are not sized by rule. The same 160 O lines in `run-log.jsonl` carry `standIn: true`. `--label` issues no O label.
7. **The label command prints a PROVISIONAL-sizing warning** because gOwner and gCpub are not in the measured list. The T, D0 and F label computations use only measured fields (`SIZING.md`), so the warning does not change them; it is kept as the runner printed it.
8. **D and B not run** (gates), **O extras not run**, and no 16-seed extension (no vote read I). No cut was made for time: the whole run took about 1 h 40 min of main-series wall time.
9. **No kernel or runner edit during the screen.** `git rev-parse HEAD` 11ff7e1d before and after; sha256 of `world.ts`, `gpu.ts`, `bootstrap-screen.ts`, `observe-bootstrap.ts` identical at start and end; no file under `packages/*` or the earlier records was touched. The GPU parity run was not repeated during the screen; it was rerun afterwards on the final tree (exit 0, "all 157 cases match bit for bit": the 69 originals plus the appended cases). (At screen time: the builder's last gate: `all 156 cases match bit for bit`, exit 0). `git diff` of `tests/deno/mycelium_gpu.ts` removes 4 lines, all in the pre-existing `firstDiff` helper (rewritten as a strict version); the case bodies are untouched, but "unedited" is not literally true of the helper.

## What each variant shows, against its matched control

Tables of the numbers are at the end. "On" means conduit on, "off" the same world with the conduit absent; a "pair" is read per seed against a noise floor taken from butterfly twins (T) or null-seed branches (F, O); every PAY needs intake up by at least max(3 percent, twice the noise floor) with population, deaths and births not worse by 3 percent.

**Pre-laid trail (P, series T and D0).** The laid road is real (at default decay median laid-edge x_e is 28 at step 10 and 0 by step 400; at `pDecay` 66 it is 32, 21 and 15 at steps 10, 400 and 1,000) but the conduit does not move intake: median rel_i on-minus-off is between -0.9 and +0.8 percent for rows, cols, carpet (ceiling), lattice, patches, rows in uniform light and the physarum follower, at every strength (P1, P2, P3, R) and in every window (0 to 300, 300 to 1,000, 1,000 to 3,000). Median births and deaths mostly fall, but the range is -5.5 to +2.2 percent (births) and -6.2 to +3.0 percent (deaths): rows-U W3 rises, 13 of the 36 rows do not fall by 1 point, and cols-G W3 and phys-rows-G W3 pass 5 points (DAMP in up to 6 of 8 seeds for the carpet ceiling in W2). Median population is within +/- 2 percent in most G rows; six gradient rows are outside it (-3.3, +2.5, +2.2, +2.3, +2.4 and +4.0 percent), and the carpet gives about +8 to +9 percent in the first 300 steps, where intake is +0.5 percent or less. The conduit-on road is gone by about step 300 (median x_e 28, 4, 1, 0 at steps 10, 200, 300, 400), so W2 and W3 read a dead road and carry no information on whether a road pays; only W1 (0, 300] reads a live road (+0.1 percent intake against a 0.1 percent floor), during the founder growth from n = 1,024 to about 2,022. The diffA-matched twin gives the same flat picture, so the faster-diffusion explanation is not needed. rows against cols differs by under 1 point of intake. The durable-road read D0 repeats it on a road that is alive through the window: intake +0.2 percent, births -10.7 percent, deaths -9.4 percent, population +3.1 percent (window (400, 2,400]), PAY 0 of 8, DAMP 7 of 8. Reading: the conduit operates (mean `Dd` rises by +11 to +26 units of 40; the stored cross-flux `xflux` is about zero or negative, -0.18 on and -0.45 off, so it does not rise) and turnover per particle-step falls, with the same per-particle food intake. Total intake is +3.8 percent and population +3.1 percent, against butterfly noise floors of 0.65 percent (intake), 5.0 (births), 4.6 (deaths) and 2.4 (population), with 3 of the 8 twins never diverging from off; the fixed 3 percent DAMP threshold sits inside that noise, and the turnover drop is beyond the largest twin difference in 5 of 8 seeds. At `pDecay` 66 the whole world fills with trail (share of edges with x_e at least 2 is 1.00 at step 1,000 and 0.99 at 2,000; particles on laid cells stay near the 0.125 laid-area share), so D0 tests a conduit on a trail carpet, not a road against no road. It is one pattern (rows), one strength (q 2), one decay, gradient light, inherit, 8 seeds.

**Free first layer (F).** The subsidy works as a subsidy. FREE-16 inherit keeps 39.7 trail per particle (median) against 0.0 in the keyless base, and 28.8 in the blocked world (free units 0.29 of a unit per particle-step, paid 0.135 in inherit), but only 3.0 per particle sits above the layer (0.7 blocked). The treated arm (F 16 plus conduit g 1) does not reach twice FREE-ONLY's above-layer trail in any of the 8 seeds (K 0 of 8; classes S S S S L S S L); the ratio runs 0 to 1.57 (slot 8254 has 1.94 against 1.24 above the layer, 57 percent more, short of the twofold K needs). Its conduit was at the floor (effective rate median 0; 2,000-step branches with the conduit off move intake by -0.1 percent, births and deaths by -0.1 percent, 0 of 8 PAY), so SUBSIDY-ONLY holds by rule (S in 6 of 8) and FREE-ONLY alone keeps 3.0 per particle above the layer; K is out of reach for a near-inert conduit. The ghost control is void in 1 seed (no trail, constant field) and shows the same nothing. Removing the free layer for 2,000 steps (nofree) moves per-particle intake by -5.2 percent (on minus nofree: per-particle intake is higher without the layer) and population by +3.5 percent, deaths and births by about -0.5 percent: the layer costs a little per-particle intake and does not change turnover. On the frozen physarum and blind anchors (free layer plus conduit g 1; trail 98 to 99 per particle, 43 to 82 above the layer) conduit off and ghost move intake by 0.0 percent and nofree by 0.0 to -3.8 percent and 0 of 8 pass PAY, 0 of 8 DAMP. Dose rows (descriptive): FREE-4 keeps 2.2 trail per particle and T-4-mid 1.3 (K 1 of 8 above the ceiling 16, seed 8255; 2 of 8 above its own layer of 4, seeds 8250 and 8255), T-16-hi (conduit g 2) keeps 40.1 with K 0 of 8. Toll stratum (descriptive, no twin): toll-base, toll-C and toll-FC all keep 99 to 102 trail per particle; intake per particle-step 2.39, 2.43, 2.34. Trail per particle in T-16-mid is lower than in FREE-16 (16.6 against 39.7). FREE-ONLY alone spans 31 to 59 across seeds (blocked 28 to 29); the 0 in the range belongs to the treated arm. Paired by slot, T-16-mid has less trail than FREE-16 in 8 of 8 seeds (two-sided sign p = 0.008; GHOST also 8 of 8), but the unpaired permutation test gives p = 0.056, there is no multiplicity control, blocked is equal (28.77 against 28.76) and g 2 (T-16-hi) is not lower. This is suggestive of a small adverse effect of the weak conduit, not shown, and it is not ruled out. Every F treated arm departs from its twin by the first read at step 100, and the two L seeds, so the exactly-6-of-8 margin, come from this difference.

**Owner conduit (O, descriptive only).** Passive owner planes leave the world byte for byte as the keyless toll world: T-P equals T-base in all 8 slots at 100,000 steps (identical snaps). Trail is kept in every toll arm (92.9 to 98.9 per particle, 34 to 40 above 16) and in none of the no-toll world (N-base 0.00), so the toll, not the owner rules, is what keeps trail. Over 2,000-step branches at 60,000 and 100,000 steps, with the stand-in strengths, EC against conduit off, enclosure off, both off, owner ghost and public conduit: 0 of 8 PAY in every row at both checkpoints; per-particle intake moves by +0.1 percent or less. The tables are on minus variant. Owner conduit on against off: births and deaths -1 percent in the evolving world (DAMP 1 to 2 of 8, a count null branches reach with nothing changed), but population +3.0 percent against a null floor of 0.15 to 0.2 percent and total intake +2.8 percent at 60,000 and +3.2 percent at 100,000 (per seed up to +9 percent). Enclosure on against off: births and deaths +18 to +24 percent, so enclosure raises turnover (raw counts at 100,000: 18,896 births with it on, 15,392 with it off; this is E alone, not a payment). On the frozen anchors, the on-minus-off difference for the conduit is -6 to -7 percent in births and deaths in all 8 seeds of both physarum and blind (DAMP 8 of 8), so switching the conduit off raises turnover (physarum, 30,000: 5,706 births on, 6,128 off, +7.4 percent when off), with per-particle intake +0.1 percent. In the blind anchor total intake is +2.2 percent and population +2.1 percent in 8 of 8 seeds against a floor of 0.07 percent. PAY is per capita and cannot score a conduit that works by supporting more bodies. These are not labelled; the design requires gOwner and gCpub sized by rule, the owner-edge readouts and the (b), (c), (d) predicates, none built.

## Does it pay on existing trail (births, deaths, population, intake together)

No, at every place this screen could read it, and the common signature is damping:

| where | trail source | on-minus-off intake | births / deaths | population | PAY seeds | DAMP seeds |
|---|---|---|---|---|---|---|
| T rows-G P2, three windows | laid road, decays | -0.5 to +0.5 percent | -1 to -3 percent each | +1.4 to +1.5 percent | 0/8 | 0 to 4 of 8 |
| T carpet-G (ceiling) | laid carpet | -0.1 to +0.5 percent | -2 to -4 percent each | +8.4 to -0.5 percent | 0/8 | 2 to 6 of 8 |
| D0 rows-G, (400, 2,400] | durable laid road | +0.2 percent | -10.7 / -9.4 percent | +3.1 percent | 0/8 | 7/8 |
| F anchors (physarum, blind), conduit off (floor result: conduit near-inert, eff p90 2 to 7 units of 88) | frozen followers with the free layer | 0.0 percent | -1.1 to +0.2 percent | -0.0 to +0.1 percent | 0/8 | 0/8 |
| O anchors (physarum, blind), on minus conduit off (so off raises turnover) | toll trail with owner planes | +0.1 percent | -6 to -7 percent | -0.1 to +2.1 percent | 0/8 | 8/8 |
| O EC inherit, on minus conduit off | toll trail with owner planes | +0.1 percent | -1 percent | +2.6 to +3.0 percent | 0/8 | 1 to 2 of 8 (null level) |

Per-capita intake never passes PAY in any pair where PAY is defined (individual seed-pairs reach +4.9 percent in T but fail a safeguard); the largest median effect on most rows is the turnover change per particle-step, which is lower with the conduit on in the T, D0 and O anchor rows. DAMP counts of 1 to 2 of 8 are null level (null branches give 0 to 2 of 8); only D0 (7 of 8) and the O anchors (8 of 8) stand out. The evolving-world rows are survivor-conditioned (in T-16-mid inherit, 2 seeds have 0 trail at 100,000 and 3 are under 10 at 50,000, so those branch pairs compare nothing with nothing; the ghost control is void in seed 8256), and the F anchors carry the weakest conduit, so they cannot carry the "pays" reading as the design hoped.

## Labels, per variant and strength

| arm | strength | label | note |
|---|---|---|---|
| T rows-G (and carpet-G, cols-G, lattice, patches) | P1, P2, P3, R | **UNREADABLE** (no label issued) | PW empty at all four: t_alive 350 / 276 / 200 below t0 400; label rule 1 |
| D0 (durable rows-G P2) | (400, 2,400] | V(PAY-D0) = **N** | PAY 0 of 8, DAMP 7 of 8 (DAMP is printed as a descriptive count, no T label rests on it) |
| D | P2, R | not run | gate not met |
| B | R + F | not run | gate not met |
| F | `T-16-mid` (g 1) | **SUBSIDY-ONLY** | S 6 of 8, L 2 of 8, K 0 of 8; anchor verdict MIXED (physarum 0/8 pay, blind 0/8 pay, 0 damp; floor result, conduit near-inert); (b) 4 of 8, (c) H 1 of 8, G 8 of 8; (f) DIFF 8/8 (equals FREE-ONLY), GHOST 7/8 |
| F dose rows | `FREE-4`, `T-4-mid`, `T-16-lo` (= mid), `T-16-hi` | no label (dose rows) | K 0, 1 (2 above its own layer of 4), 0, 0 of 8 |
| O | `T-EC` (stand-in strengths) | **INCOMPLETE (not run to label: owner-edge sizing and readouts)** | descriptive only; the runner prints no O label |

The F label is the first match of DESIGN 10.2 (S in at least 6 of 8) and does not depend on the extras. S is satisfied by FREE-ONLY's layer in every seed that kept trail, so the label measures the layer and not the conduit. I did not soften or strengthen any label; the T and F lines are the program's output and the O line is the program's own refusal to label.

## Whether anything justifies a pre-registered rung

No (DESIGN 10.4): the T label does not exist, D0 is N, F is SUBSIDY-ONLY (named in the design as a negative on "use"), O is unlabelled. The one thing the screen did produce that the earlier conduit screen did not is a trail that exists and is connected (the F toll arms and anchors at 99 trail per particle, the laid roads), and on that trail no pair passed PAY; where intake did rise by 3 percent or more in a single pair, a safeguard failed (for example rows-G P1, seed 8217, window (1000, 3000]: intake +4.9 percent with population -3.7 percent), and the consistent per-capita change was lower births and deaths together.

## What this does and does not say

- It says: with a connected road laid at the start, a 2,000-step window on a durable road, a free first layer sized by the written rule, and frozen followers on their own trail, switching a conduit on gave no qualifying PAY in any pair where PAY is defined (a few single pairs reach +3 percent intake or more and each fails a safeguard), and where it changed things consistently per particle-step it lowered births and deaths together (D0, O anchors). It does not exclude a conduit that raises total intake by supporting more bodies (D0 +3.8 percent, O +2.8 to +3.2 percent, blind anchor +2.2 percent in total intake), which PAY cannot score.
- It does not say the T question is answered: T is UNREADABLE by the design's own rule (the settle never finished and the road is short at default decay), so the "pays while the road lasts" half is unread; D0's N covers a durable road, a different decay.
- It does not say anything about F's conduit at a working strength: at sized `Fg` 1 with x_med 0 the conduit was at the floor (eff p90 at most 1 to 7 units of 88), so F reads the subsidy only. A strength that bites would need a different sizing rule (not invented here).
- It does not say anything about O's label or its owner-specific question: no owner-edge readouts, no sized strengths, no C-pub matching.
- 8 seeds, no pre-registration, round-number thresholds, no multiplicity control; a clean negative is the design's stated prior and is what was found.

## Skeptic check

Method. After the screen, a separate pass (standard-library Python, `rederive.py`, output `rederive-report.txt`, exit 0; no Deno table code, no GPU job, no parity run) rebuilt the counts and tables from the 582 raw run files and 582 claim files and from `run-log.jsonl`, rebuilt the seed sets, re-applied the fixed predicates to the stored values, and checked each prose sentence of this file against the numbers. I then spot-checked the contested items against the report and the stored counts (raw births 18,896 and 15,392 at T-EC 100,000; 5,706 and 6,128 in the physarum anchor; the per-slot trail table of section 4.6; seed 8254 above-layer 1.94 against 1.24; the per-seed rel_i extremes) before editing.

Confirmed. 582 files and 582 claims; 1,164 log lines for the three real out dirs (582 started, 582 finished, no duplicates, failures or orphans; 574 more lines belong to 16 smoke dirs that are not on disk and used only slots 8281-8284); 319,179 ledger checks, 0 bad; 391,819 consecutive reads with births minus deaths equal to dn, whole light units, non-negative integer intake and monotone counters; 872 branch variants; run configs equal defaults plus the hard-coded delta (0 of 464 differ); no held slot used; 0 seed collisions for 87 world seeds and 112 derived null seeds against the sets that could be rebuilt (seeds of runs that never reached a run-log cannot be). All 36 T pair rows, both arm tables and the counts of all 90 branch cells reproduce; 67 of 360 branch median entries differ by one printed digit (at most 0.1 point), cause unknown because the scratch script is not in the repo. Labels all reproduce: T UNREADABLE at every strength (PW empty), D0 PAY 0 of 8 and DAMP 7 of 8 (per-seed rel_i -0.3 1.8 -0.8 0.2 0.6 0.6 -1.5 0.2), F classes S S S S L S S L so SUBSIDY-ONLY with anchor verdict MIXED, (b) 4, H 1, G 8, GHOST 7, DIFF 8 re-applied to the stored values (heavy censuses were not kept, so those were not rederived from them). Sizing R1 to R3 reproduce.

Corrections made to this file (no label changed):
1. O direction. The tables are on minus variant. Enclosure on raises births and deaths (18,896 against 15,392 births at 100,000); the text said switching it off raises them. The anchors' conduit: switching it off raises births (5,706 on, 6,128 off, +7.4 percent); the text said it lowers them. Both reversed in the prose and the table row labels.
2. "Within 0.9 percent in every pair and window" is about 8-seed medians; single seed-pairs run -5.4 to +4.9 percent (six at +3 or more, each failing a safeguard). Also "intake never rises by 3 percent in any pair" now says per capita, where PAY is defined.
3. "Births and deaths both fall 1 to 5 percent" and "population within +/- 2 percent in G" contradicted their own table; ranges and exceptions are now given.
4. "0 of 8 seeds pass PAY in any of them": PAY is undefined for lat-G, pat-G, rows-U and phys-rows-G (no twin) and unresolved for cols-G W3.
5. "F's conduit never operated / was inert": it was at or near the floor (late eff p90 at most 1 unit of 88 in the treated arms, 7 physarum, 2 blind; Sol also reports that pilot 8209 has mean edge rate 40.000035 above 40 and that six of eight main treated runs have positive late excess conduction; I did not recheck those two). Reworded to weak, not provably absent. The F anchor rows are floor results and no longer read as "does it pay" evidence.
6. "Nothing above the layer beats FREE-ONLY in any seed" is false in seed 8254 (1.94 against 1.24); K fails there only because it needs twofold. Reworded.
7. "Within the seed spread (0 to 59)": FREE-ONLY alone spans 31 to 59 and the 0 is the treated arm's. Paired, treated is lower in 8 of 8 seeds (sign p 0.008; unpaired permutation p 0.056); suggestive, not shown.
8. D0 "same food intake" is per particle-step; "cross-flux rises" is not what `xflux` shows (mean `Dd` does rise). Total intake, population and the noise floors added; the carpet-of-trail caveat added.
9. T windows W2 and W3 read a dead road; stated.
10. Dose row K for T-4-mid depends on the ceiling (1 above 16, 2 above its own layer of 4).
11. PAY is per capita: the O rows show population +3.0 percent and total intake +2.8 to +3.2 percent that PAY cannot score. DAMP counts of 1 to 2 of 8 are null level. Survivor conditioning stated.
12. Also noted, not in the text before: 24 of the 872 branch variants are `relax-*` and are not analysed; the D0 and rows-G butterfly floors are soft (twins that never differ from off: carpet-U 8 of 8, rows-G 2, carpet-G 2, cols-G 2, D0 3); the `firstDiff` helper edit in the parity test.

What the reading rests on and where it is weaker than the headline. The headline "no conduit pays on existing trail" rests on per-capita PAY with 8 seeds and round-number thresholds. It holds where PAY is defined. It is weaker because: T is unreadable and its descriptive windows mostly read a dead road; D0 is one pattern, one strength, one decay, on a trail carpet, with noise floors close to the effects; F's conduit sat at the floor, so F says nothing about a working conduit and SUBSIDY-ONLY measures the free layer; O is unlabelled and its conduit appears to work by supporting more bodies, which PAY does not score; butterfly floors are soft. The exploratory conclusion that no qualifying payment was demonstrated stands; "the conduit never raised intake" does not.

Labels. No label changes: T UNREADABLE, D0 N, F SUBSIDY-ONLY (anchor MIXED), D and B not run, O INCOMPLETE. Correctly applied, the fixed predicates give the same labels.

## Sol review

Codex Sol 6.1 at High effort, read-only, exit 0; it fixed nothing (output `review-result.txt`). No P1 findings and five P2 findings, all about wording in this file, none about labels; it recomputed the labels and they match the fixed predicates. The five: (1) both O switch-off effects described backwards; (2) medians stated as claims about every pair (seed 8217 rows-G P1 +4.88 percent, carpet-G P2 +4.49, patches-G -5.42); (3) F's conduit weak, not universally inert; (4) K = 0 does not mean FREE-ONLY always keeps more (slot 8254, 1.94 against 1.24); (5) across-seed spread cannot dismiss the paired retention difference (lower in 8 of 8 pairs, -2.89 to -35.28 per particle). All five are applied above. It also checked timing: `SIZING.md` and `sizing-frozen.json` were written at about 03:54:40 UTC, before the first main start at 03:54:45.884 and first result at 03:55:03.993, so the sizing is pre-main by local timestamps (not immutable registration evidence). Not verified by either pass: the GPU parity run, and the "no run was rerun" and wall-time statements.

## Runtime and files

- Wall time: audit and sizing about 15 minutes (S1 to S4 and S2d), R7 timing smoke 3 to 7 s per run (jobs 1), T 208 runs about 13 minutes, D0 about 3 minutes, F core 88 runs about 1 hour (2 processes sharing the GPU with O), O 80 runs 56 minutes (23:12 to 00:08), F extras 64 runs about 37 minutes (23:58 to 00:35). Main-series wall time from 22:54 to 00:35 (15 Nov), about 1 h 40 min, against the 3.5 h limit and the 3.0 h projection gate (projections were 0.06 h T, 0.78 h F, 0.75 h F extras at 0.3 to 0.4 s per 1,000 steps). Per-run seconds: T 9 to 18 s, D0 6 to 7 s, F 48 to 111 s, O 47 to 67 s.
- Files (all uncommitted): `docs/mycelium-bootstrap-2026-11-14/{SCREEN.md, SIZING.md, run-log.jsonl}` (+ existing DESIGN, BUILD-NOTES, review files); `runs/mycelium-bootstrap/sizing-frozen.json` (the sizing every main command used), `runs/mycelium-bootstrap/{label-final.txt, table-all.txt, br-all.md, desc-T.md, agg-F.md, agg-O.md}` (generated tables, gitignored).
- Reproduce: `node 24 on PATH`; `R="deno run -A --no-lock tools/mycelium/bootstrap-screen.ts"`; `$R --audit`; the S series with `--out runs/mycelium-bootstrap/sizing` and `--size` (then add `diffA` 44 by hand and `S2d` read by hand, see SIZING.md); `$R --series T|D0|F --sizing runs/mycelium-bootstrap/sizing-frozen.json --out runs/mycelium-bootstrap/main` (F again with `--extras`; O with `--no-gate`); `$R --out runs/mycelium-bootstrap/main --label --sizing runs/mycelium-bootstrap/sizing-frozen.json` and `--table`. The descriptive pair tables below (T windows, per-arm means, branch counts) come from small scratch scripts over the run files that call the runner's own `windowSide`, `ratesOf`, `pairRels`, `noiseFloor` and `judge`; they are not part of the runner.

## Generated tables

Label output (`runs/mycelium-bootstrap/label-final.txt`, as printed):

```
WARNING: the sizing is PROVISIONAL (not measured): windows, strengths and the diffA twin are stand-ins. Smoke only.
T windows: W1 (0,300], W2 (300,1000], W3 (1000,3000]; primary window PW(q) = (t0 = 400, min(t_alive(q), 1000)] from the sizing step.

| strength | PW | PW length | readable | PAY rows-G (votes Y/N/I) | DAMP | per-seed rel_i (on vs off) | thr_i |
|---|---|---|---|---|---|---|---|
| P1 | none | 0 | UNREADABLE | - | - | - | - |
| P2 | none | 0 | UNREADABLE | - | - | - | - |
| P3 | none | 0 | UNREADABLE | - | - | - | - |
| R | none | 0 | UNREADABLE | - | - | - | - |

P2 has no readable primary window: no T label can be issued.

D0 (durable rows-G, window (400,2400]): PAY N (per-seed rel_i -0.3% 1.8% -0.8% 0.2% 0.6% 0.6% -1.5% 0.2%, thr_i 0.030)

D: not run

F (labelled at T-16-mid, 8 inherit slots): K classes per slot S S S S L S S L
(f) controls: GHOST kept 7/8, DIFF kept 8/8 -> does not hold or arms missing
anchor verdict MIXED (phys 0/8 pay, 0 damp; blind 0/8 pay, 0 damp; 8 treated slots)
(b) import: layers above non-layers with both groups at the minimum size in at least half the late heavy censuses, in 4/8
(c) behaviour: H (occx, sens or acute branch) in 1/8, G (movement guard) in 8/8; (e) dose holds (low dose F = 4, trail above F* = 16)
**F label (T-16-mid): SUBSIDY-ONLY**

O: the owner-edge readouts (b)(c)(d) of DESIGN 9.5 (observe-owner.ts) are not built in this step: no O label is issued here. K, owner census and the PAYALL branch pairs are in the tables.

Intake identity exact for every run.
```

T pairs, descriptive only (no label rests on them; medians over 8 seeds of on-minus-off relative differences; noise floor from the butterfly twin where one exists; PAY, DAMP, HARM are per-seed counts against that floor; the row named `rows-G` is the P2 strength):

| pair | window | seeds | intake | births | deaths | population | nf_i | PAY | DAMP | HARM | unresolved |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rows-G.on-P1 vs rows-G.off | (0,300] | 8 | 0.1% | -1.2% | -1.2% | 0.1% | 0.1% | 0/8 | 0/8 | 0/8 | 0 |
| rows-G.on-P1 vs rows-G.off | (300,1000] | 8 | 0.3% | -1.5% | -0.6% | 0.3% | 0.6% | 0/8 | 1/8 | 0/8 | 0 |
| rows-G.on-P1 vs rows-G.off | (1000,3000] | 8 | 0.8% | -2.9% | -2.9% | -3.3% | 1.2% | 0/8 | 4/8 | 5/8 | 0 |
| rows-G vs rows-G.off | (0,300] | 8 | 0.1% | -1.1% | -2.8% | 1.4% | 0.1% | 0/8 | 1/8 | 0/8 | 0 |
| rows-G vs rows-G.off | (300,1000] | 8 | 0.1% | -2.1% | -1.4% | 1.4% | 0.6% | 0/8 | 0/8 | 0/8 | 0 |
| rows-G vs rows-G.off | (1000,3000] | 8 | 0.5% | -3.1% | -3.0% | 1.5% | 1.2% | 0/8 | 4/8 | 1/8 | 0 |
| rows-G.on-P3 vs rows-G.off | (0,300] | 8 | 0.2% | -0.2% | -1.8% | 2.5% | 0.1% | 0/8 | 0/8 | 0/8 | 0 |
| rows-G.on-P3 vs rows-G.off | (300,1000] | 8 | 0.1% | -3.1% | -1.1% | 1.3% | 0.6% | 0/8 | 2/8 | 0/8 | 0 |
| rows-G.on-P3 vs rows-G.off | (1000,3000] | 8 | 0.5% | -0.7% | -0.8% | -0.9% | 1.2% | 0/8 | 3/8 | 2/8 | 0 |
| rows-G.on-R vs rows-G.off | (0,300] | 8 | -0.2% | -1.1% | -0.5% | 0.1% | 0.1% | 0/8 | 0/8 | 0/8 | 0 |
| rows-G.on-R vs rows-G.off | (300,1000] | 8 | 0.3% | -0.3% | -0.0% | -1.4% | 0.6% | 0/8 | 1/8 | 0/8 | 0 |
| rows-G.on-R vs rows-G.off | (1000,3000] | 8 | 0.2% | -0.2% | -0.1% | -0.5% | 1.2% | 0/8 | 2/8 | 3/8 | 0 |
| rows-G.diffA vs rows-G.off | (0,300] | 8 | 0.0% | -0.5% | -0.3% | 1.9% | 0.1% | 0/8 | 1/8 | 0/8 | 0 |
| rows-G.diffA vs rows-G.off | (300,1000] | 8 | -0.0% | -1.6% | 0.7% | 0.2% | 0.6% | 0/8 | 1/8 | 0/8 | 0 |
| rows-G.diffA vs rows-G.off | (1000,3000] | 8 | 0.7% | -3.9% | -4.0% | 0.4% | 1.2% | 0/8 | 3/8 | 2/8 | 0 |
| carpet-U vs carpet-U.off | (0,300] | 8 | 0.1% | -1.6% | -4.0% | 9.0% | 0.0% | 0/8 | 3/8 | 0/8 | 0 |
| carpet-U vs carpet-U.off | (300,1000] | 8 | 0.1% | -3.7% | -1.5% | 1.6% | 0.0% | 0/8 | 4/8 | 0/8 | 0 |
| carpet-U vs carpet-U.off | (1000,3000] | 8 | -0.4% | -3.7% | -3.5% | -0.9% | 0.0% | 0/8 | 3/8 | 1/8 | 0 |
| carpet-G vs carpet-G.off | (0,300] | 8 | 0.5% | -2.1% | -4.3% | 8.4% | 0.0% | 0/8 | 2/8 | 0/8 | 0 |
| carpet-G vs carpet-G.off | (300,1000] | 8 | 0.0% | -4.5% | -3.8% | 0.9% | 0.4% | 0/8 | 6/8 | 0/8 | 0 |
| carpet-G vs carpet-G.off | (1000,3000] | 8 | -0.1% | -2.0% | -1.9% | -0.5% | 2.1% | 0/8 | 2/8 | 3/8 | 0 |
| cols-G vs cols-G.off | (0,300] | 8 | 0.1% | -1.1% | 0.3% | 0.5% | 0.2% | 0/8 | 0/8 | 0/8 | 0 |
| cols-G vs cols-G.off | (300,1000] | 8 | 0.6% | -2.2% | -2.2% | 0.7% | 0.8% | 0/8 | 2/8 | 1/8 | 0 |
| cols-G vs cols-G.off | (1000,3000] | 8 | -0.1% | -5.5% | -6.2% | 0.3% | 5.2% | 0/8 | 0/8 | 0/8 | 8 |
| lat-G vs lat-G.off | (0,300] | 8 | 0.3% | -0.3% | -1.6% | 2.2% | - | - | - | - | - |
| lat-G vs lat-G.off | (300,1000] | 8 | 0.2% | -2.4% | -1.9% | 0.8% | - | - | - | - | - |
| lat-G vs lat-G.off | (1000,3000] | 8 | 0.1% | -2.2% | -3.3% | -0.2% | - | - | - | - | - |
| pat-G vs pat-G.off | (0,300] | 8 | 0.1% | -0.8% | -0.3% | 2.3% | - | - | - | - | - |
| pat-G vs pat-G.off | (300,1000] | 8 | -0.1% | -2.5% | -1.8% | 1.4% | - | - | - | - | - |
| pat-G vs pat-G.off | (1000,3000] | 8 | -0.2% | -4.5% | -3.8% | 2.4% | - | - | - | - | - |
| rows-U vs rows-U.off | (0,300] | 8 | 0.0% | -0.1% | -0.4% | 2.2% | - | - | - | - | - |
| rows-U vs rows-U.off | (300,1000] | 8 | -0.2% | -1.9% | -1.3% | 1.4% | - | - | - | - | - |
| rows-U vs rows-U.off | (1000,3000] | 8 | -0.9% | 2.2% | 3.0% | 0.7% | - | - | - | - | - |
| phys-rows-G vs phys-rows-G.off | (0,300] | 8 | 0.5% | -2.9% | -4.2% | 4.0% | - | - | - | - | - |
| phys-rows-G vs phys-rows-G.off | (300,1000] | 8 | 0.0% | -4.5% | -3.1% | 1.6% | - | - | - | - | - |
| phys-rows-G vs phys-rows-G.off | (1000,3000] | 8 | 0.1% | -4.7% | -5.2% | 1.5% | - | - | - | - | - |

Series F, per-arm medians over 8 seeds in the late window (second half; anchors second half of their length). TM is trail per particle; TM above F* is above the ceiling 16; `T-16-lo` equals `T-16-mid` and `DIFF` equals `FREE-16` (see deviations):

| arm | heredity | runs | steps | window | pop N (mean) | births per 1000 p-s | deaths per 1000 p-s | intake per p-s | TM per particle | TM above F* | free / paid per p-s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| COND | inherit | 8 | 100000 | (50000,100000] | 5110 | 1.469 | 1.469 | 2.2967 | 0.04 | 0.000 | - |
| DIFF | inherit | 8 | 100000 | (50000,100000] | 4430 | 0.478 | 0.479 | 2.3269 | 39.69 | 3.033 | 0.288 / 0.135 |
| FREE-16 | blocked | 8 | 100000 | (50000,100000] | 4610 | 0.311 | 0.311 | 2.2229 | 28.76 | 0.716 | 0.249 / 0.042 |
| FREE-16 | inherit | 8 | 100000 | (50000,100000] | 4430 | 0.478 | 0.479 | 2.3269 | 39.69 | 3.033 | 0.288 / 0.135 |
| FREE-4 | inherit | 8 | 100000 | (50000,100000] | 4740 | 0.412 | 0.412 | 2.3456 | 2.15 | 0.000 | 0.017 / 0.004 |
| GHOST-blocked | blocked | 8 | 100000 | (50000,100000] | 4610 | 0.300 | 0.301 | 2.2230 | 28.93 | 0.722 | 0.250 / 0.042 |
| GHOST | inherit | 8 | 100000 | (50000,100000] | 4632 | 0.717 | 0.717 | 2.2820 | 33.22 | 0.687 | 0.245 / 0.047 |
| T-16-hi | inherit | 8 | 100000 | (50000,100000] | 4434 | 0.395 | 0.395 | 2.3245 | 40.08 | 1.995 | 0.284 / 0.108 |
| T-16-lo | inherit | 8 | 100000 | (50000,100000] | 4780 | 0.539 | 0.539 | 2.3247 | 16.55 | 1.058 | 0.129 / 0.037 |
| T-16-mid | blocked | 8 | 100000 | (50000,100000] | 4606 | 0.299 | 0.299 | 2.2247 | 28.77 | 0.716 | 0.248 / 0.042 |
| T-16-mid | inherit | 8 | 100000 | (50000,100000] | 4780 | 0.539 | 0.539 | 2.3247 | 16.55 | 1.058 | 0.129 / 0.037 |
| T-4-mid | inherit | 8 | 100000 | (50000,100000] | 4695 | 0.505 | 0.504 | 2.3363 | 1.26 | 0.000 | 0.004 / 0.008 |
| anchor-blind-T-16-mid | blind | 8 | 40000 | (20000,40000] | 3789 | 2.250 | 2.250 | 2.3749 | 98.73 | 43.506 | 0.148 / 0.849 |
| anchor-phys-T-16-mid | physarum | 8 | 40000 | (20000,40000] | 2245 | 1.285 | 1.285 | 2.6477 | 98.83 | 82.168 | 0.000 / 0.998 |
| base | blocked | 8 | 100000 | (50000,100000] | 4710 | 0.321 | 0.321 | 2.2779 | 2.07 | 0.001 | - |
| base | inherit | 8 | 100000 | (50000,100000] | 4768 | 0.469 | 0.469 | 2.3574 | 0.00 | 0.000 | - |
| toll-C | inherit | 8 | 100000 | (50000,100000] | 3891 | 0.686 | 0.685 | 2.4273 | 101.53 | 38.319 | - |
| toll-FC | inherit | 8 | 100000 | (50000,100000] | 4049 | 1.212 | 1.213 | 2.3391 | 98.96 | 36.072 | 0.068 / 0.943 |
| toll-base | inherit | 8 | 100000 | (50000,100000] | 3952 | 0.781 | 0.779 | 2.3858 | 99.40 | 35.362 | - |

Series O, the same (stand-in strengths, descriptive):

| arm | heredity | runs | steps | window | pop N (mean) | births per 1000 p-s | deaths per 1000 p-s | intake per p-s | TM per particle | TM above F* | free / paid per p-s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| N-base | inherit | 8 | 100000 | (50000,100000] | 4798 | 0.414 | 0.414 | 2.3386 | 0.00 | 0.000 | - |
| T-C-pub | inherit | 8 | 100000 | (50000,100000] | 3938 | 2.887 | 2.887 | 2.3362 | 98.25 | 34.740 | - |
| T-C | inherit | 8 | 100000 | (50000,100000] | 4234 | 1.683 | 1.682 | 2.3046 | 98.61 | 35.047 | - |
| T-EC-ghost | inherit | 8 | 100000 | (50000,100000] | 3700 | 2.341 | 2.340 | 2.3342 | 94.94 | 35.635 | - |
| T-EC | inherit | 8 | 100000 | (50000,100000] | 3883 | 2.582 | 2.579 | 2.3409 | 96.37 | 34.417 | - |
| T-E | inherit | 8 | 100000 | (50000,100000] | 3619 | 2.907 | 2.906 | 2.3109 | 92.85 | 39.676 | - |
| T-P | inherit | 8 | 100000 | (50000,100000] | 4183 | 2.183 | 2.184 | 2.3095 | 98.89 | 38.062 | - |
| T-base | inherit | 8 | 100000 | (50000,100000] | 4183 | 2.183 | 2.184 | 2.3095 | 98.89 | 38.062 | - |
| anchor-blind-EC | blind | 8 | 30000 | (15000,30000] | 3898 | 2.722 | 2.722 | 2.3045 | 98.70 | 45.649 | - |
| anchor-phys-EC | physarum | 8 | 30000 | (15000,30000] | 2556 | 1.126 | 1.126 | 2.3164 | 98.91 | 84.048 | - |

Branch pairs (variant against the run, same state; pairs = seeds; PAY whole is the 2,000-step window, PAY whole+last also the last 1,000; the medians are on-minus-variant relative differences):

| run set | heredity | checkpoint | variant | pairs | PAY whole | PAY whole+last | DAMP | HARM | unresolved | med rel intake | med rel pop | med rel deaths | med rel births |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GHOST | inherit | 100000 | noconduit | 8 | 0 | 0 | 0 | 0 | 1 | -0.1% | +0.1% | +2.9% | +1.4% |
| GHOST | inherit | 100000 | nofree | 8 | 0 | 0 | 4 | 1 | 1 | -6.5% | +6.3% | +0.2% | -0.4% |
| GHOST | inherit | 100000 | nullA | 8 | 0 | 0 | 2 | 0 | 1 | +0.0% | -0.1% | -0.7% | -1.1% |
| GHOST | inherit | 100000 | nullB | 8 | 0 | 0 | 0 | 0 | 1 | +0.0% | +0.0% | -0.8% | -0.7% |
| GHOST | inherit | 50000 | noconduit | 8 | 0 | 0 | 1 | 0 | 0 | -0.0% | -0.0% | -0.2% | -1.1% |
| GHOST | inherit | 50000 | nofree | 8 | 0 | 0 | 3 | 1 | 0 | -6.5% | +6.2% | +1.0% | +2.6% |
| GHOST | inherit | 50000 | nullA | 8 | 0 | 0 | 1 | 0 | 0 | +0.0% | +0.2% | -0.3% | -0.2% |
| GHOST | inherit | 50000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | -0.1% | +0.1% | +0.0% | +0.1% |
| T-16-mid | blocked | 100000 | ghost | 8 | 0 | 0 | 0 | 0 | 0 | -0.1% | +0.1% | +0.9% | +1.6% |
| T-16-mid | blocked | 100000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | -0.0% | +0.0% | +0.5% | +0.4% |
| T-16-mid | blocked | 100000 | nofree | 8 | 0 | 0 | 0 | 0 | 0 | -4.0% | +4.4% | +5.7% | +26.4% |
| T-16-mid | blocked | 100000 | nullA | 8 | 0 | 0 | 1 | 0 | 0 | -0.0% | -0.0% | +0.1% | +0.0% |
| T-16-mid | blocked | 100000 | nullB | 8 | 0 | 0 | 1 | 0 | 0 | -0.1% | +0.1% | +0.2% | +0.5% |
| T-16-mid | blocked | 50000 | ghost | 8 | 0 | 0 | 0 | 0 | 0 | +0.1% | -0.1% | -0.1% | +0.0% |
| T-16-mid | blocked | 50000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.1% | +0.5% | +0.5% |
| T-16-mid | blocked | 50000 | nofree | 8 | 0 | 0 | 0 | 0 | 0 | -4.8% | +5.1% | -1.4% | +6.2% |
| T-16-mid | blocked | 50000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | +0.6% | +0.1% |
| T-16-mid | blocked | 50000 | nullB | 8 | 0 | 0 | 2 | 0 | 0 | +0.0% | +0.0% | +0.1% | +0.1% |
| T-16-mid | inherit | 100000 | ghost | 8 | 0 | 0 | 1 | 0 | 1 | -0.0% | +0.0% | -0.8% | +0.0% |
| T-16-mid | inherit | 100000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | -0.1% | +0.0% | -0.1% | -0.1% |
| T-16-mid | inherit | 100000 | nofree | 8 | 0 | 0 | 3 | 0 | 0 | -5.2% | +3.5% | -0.6% | -0.3% |
| T-16-mid | inherit | 100000 | nullA | 8 | 0 | 0 | 1 | 0 | 0 | +0.0% | -0.0% | -0.6% | -0.0% |
| T-16-mid | inherit | 100000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | +0.1% | -0.1% | -0.9% | -0.7% |
| T-16-mid | inherit | 50000 | ghost | 8 | 0 | 0 | 0 | 0 | 1 | +0.1% | -0.1% | +0.3% | +0.0% |
| T-16-mid | inherit | 50000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | +0.1% | -0.1% | +0.1% | +0.0% |
| T-16-mid | inherit | 50000 | nofree | 8 | 0 | 0 | 3 | 2 | 0 | -1.7% | +0.6% | -0.5% | -0.5% |
| T-16-mid | inherit | 50000 | nullA | 8 | 0 | 0 | 1 | 0 | 0 | +0.2% | -0.2% | -1.8% | -1.4% |
| T-16-mid | inherit | 50000 | nullB | 8 | 0 | 0 | 1 | 0 | 0 | +0.2% | -0.3% | +0.9% | +0.1% |
| T-EC | inherit | 100000 | both | 8 | 0 | 0 | 0 | 0 | 0 | +0.1% | +3.0% | +16.6% | +17.5% |
| T-EC | inherit | 100000 | coff | 8 | 0 | 0 | 2 | 0 | 0 | +0.1% | +3.0% | -1.0% | -0.1% |
| T-EC | inherit | 100000 | cpub | 8 | 0 | 0 | 0 | 0 | 0 | +0.1% | +1.4% | -0.4% | -0.1% |
| T-EC | inherit | 100000 | eoff | 8 | 0 | 0 | 0 | 0 | 0 | -0.1% | +0.5% | +18.2% | +18.5% |
| T-EC | inherit | 100000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | -0.0% | +0.0% | +0.8% | +0.8% |
| T-EC | inherit | 100000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | -0.0% | +0.0% | +1.0% | +0.9% |
| T-EC | inherit | 100000 | oghost | 8 | 0 | 0 | 2 | 0 | 0 | +0.0% | +0.2% | -1.7% | -1.6% |
| T-EC | inherit | 60000 | both | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.8% | +19.9% | +20.5% |
| T-EC | inherit | 60000 | coff | 8 | 0 | 0 | 1 | 0 | 0 | +0.1% | +2.6% | -0.9% | -0.4% |
| T-EC | inherit | 60000 | cpub | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +1.0% | -0.2% | -0.1% |
| T-EC | inherit | 60000 | eoff | 8 | 0 | 0 | 0 | 1 | 0 | -0.0% | -0.5% | +23.9% | +23.9% |
| T-EC | inherit | 60000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | -0.1% | -0.1% | +0.9% | +0.8% |
| T-EC | inherit | 60000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | -0.0% | -0.1% | +0.7% | +0.7% |
| T-EC | inherit | 60000 | oghost | 8 | 0 | 0 | 3 | 0 | 0 | +0.1% | +0.1% | -1.5% | -1.4% |
| anchor-blind-EC | blind | 20000 | both | 8 | 0 | 0 | 0 | 0 | 0 | -0.2% | +0.5% | +35.5% | +35.9% |
| anchor-blind-EC | blind | 20000 | coff | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | +2.1% | -6.9% | -6.6% |
| anchor-blind-EC | blind | 20000 | cpub | 8 | 0 | 0 | 2 | 0 | 0 | +0.0% | +0.6% | -2.8% | -2.8% |
| anchor-blind-EC | blind | 20000 | eoff | 8 | 0 | 0 | 0 | 0 | 0 | -0.2% | -0.6% | +44.2% | +44.0% |
| anchor-blind-EC | blind | 20000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.1% | -0.1% | -0.1% |
| anchor-blind-EC | blind | 20000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | -0.1% | -0.2% |
| anchor-blind-EC | blind | 20000 | oghost | 8 | 0 | 0 | 7 | 0 | 0 | +0.0% | +0.1% | -3.7% | -3.8% |
| anchor-blind-EC | blind | 30000 | both | 8 | 0 | 0 | 0 | 0 | 0 | -0.1% | +0.7% | +28.9% | +29.4% |
| anchor-blind-EC | blind | 30000 | coff | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | +2.1% | -7.0% | -6.8% |
| anchor-blind-EC | blind | 30000 | cpub | 8 | 0 | 0 | 1 | 0 | 0 | -0.0% | +0.8% | -2.6% | -2.5% |
| anchor-blind-EC | blind | 30000 | eoff | 8 | 0 | 0 | 0 | 0 | 0 | -0.2% | -0.6% | +38.5% | +38.5% |
| anchor-blind-EC | blind | 30000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | +0.1% | +0.1% |
| anchor-blind-EC | blind | 30000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | -0.0% | +0.0% | +0.3% | +0.4% |
| anchor-blind-EC | blind | 30000 | oghost | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | +0.0% | -4.0% | -4.0% |
| anchor-blind-T-16-mid | blind | 20000 | ghost | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | -0.6% | -0.5% |
| anchor-blind-T-16-mid | blind | 20000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.1% | -1.1% | -1.1% |
| anchor-blind-T-16-mid | blind | 20000 | nofree | 8 | 0 | 0 | 0 | 0 | 0 | -3.8% | +4.4% | +2.0% | +3.1% |
| anchor-blind-T-16-mid | blind | 20000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | -0.2% | -0.1% |
| anchor-blind-T-16-mid | blind | 20000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.0% | -0.7% | -0.6% |
| anchor-blind-T-16-mid | blind | 40000 | ghost | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.0% | -0.5% | -0.6% |
| anchor-blind-T-16-mid | blind | 40000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.1% | -0.9% | -0.8% |
| anchor-blind-T-16-mid | blind | 40000 | nofree | 8 | 0 | 0 | 0 | 0 | 0 | -3.8% | +4.4% | +2.0% | +3.1% |
| anchor-blind-T-16-mid | blind | 40000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.0% | -0.3% | -0.3% |
| anchor-blind-T-16-mid | blind | 40000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | -0.1% | -0.1% |
| anchor-phys-EC | physarum | 20000 | both | 8 | 0 | 0 | 7 | 0 | 0 | +0.1% | -0.3% | -4.0% | -4.2% |
| anchor-phys-EC | physarum | 20000 | coff | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | -0.1% | -6.3% | -6.6% |
| anchor-phys-EC | physarum | 20000 | cpub | 8 | 0 | 0 | 4 | 0 | 0 | -0.0% | -0.1% | -3.0% | -2.9% |
| anchor-phys-EC | physarum | 20000 | eoff | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.2% | +2.5% | +2.3% |
| anchor-phys-EC | physarum | 20000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.0% | -0.1% | -0.1% |
| anchor-phys-EC | physarum | 20000 | nullB | 8 | 0 | 0 | 1 | 0 | 0 | +0.0% | +0.0% | +0.2% | +0.1% |
| anchor-phys-EC | physarum | 20000 | oghost | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | -2.0% | -10.4% | -11.3% |
| anchor-phys-EC | physarum | 30000 | both | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | -0.3% | -4.1% | -4.4% |
| anchor-phys-EC | physarum | 30000 | coff | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | -0.1% | -6.8% | -7.0% |
| anchor-phys-EC | physarum | 30000 | cpub | 8 | 0 | 0 | 3 | 0 | 0 | +0.0% | -0.1% | -2.7% | -2.6% |
| anchor-phys-EC | physarum | 30000 | eoff | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.2% | +2.3% | +2.1% |
| anchor-phys-EC | physarum | 30000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | +0.7% | +0.6% |
| anchor-phys-EC | physarum | 30000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | -0.0% | -0.0% | +0.3% | +0.4% |
| anchor-phys-EC | physarum | 30000 | oghost | 8 | 0 | 0 | 8 | 0 | 0 | +0.1% | -2.1% | -10.4% | -11.2% |
| anchor-phys-T-16-mid | physarum | 20000 | ghost | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.2% | +0.4% | +0.2% |
| anchor-phys-T-16-mid | physarum | 20000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | +0.1% | +0.2% |
| anchor-phys-T-16-mid | physarum | 20000 | nofree | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | -0.3% | -0.3% |
| anchor-phys-T-16-mid | physarum | 20000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | +0.5% | +0.7% |
| anchor-phys-T-16-mid | physarum | 20000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.0% | +0.0% | -0.2% |
| anchor-phys-T-16-mid | physarum | 40000 | ghost | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.2% | +0.3% | +0.3% |
| anchor-phys-T-16-mid | physarum | 40000 | noconduit | 8 | 0 | 0 | 0 | 0 | 0 | -0.0% | -0.0% | -0.5% | -0.8% |
| anchor-phys-T-16-mid | physarum | 40000 | nofree | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | -0.0% | +0.1% | +0.2% |
| anchor-phys-T-16-mid | physarum | 40000 | nullA | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | +1.0% | +0.9% |
| anchor-phys-T-16-mid | physarum | 40000 | nullB | 8 | 0 | 0 | 0 | 0 | 0 | +0.0% | +0.0% | +0.4% | +0.5% |

## Astra review (15 Nov 2026)

A Codex Astra (medium effort, read-only) adversarial pass over the final uncommitted tree, after the round 2 fixes. No P1. Four P2 and one P3, all fixed:

1. One checkpoint could earn the full F label (a run made with a short `--steps` plans only one). `payOnTrail` and `dampOnTrail` now need two planned checkpoints to pass; fewer is unresolved.
2. An unreadable butterfly twin lowered the noise floor (the floor came from the readable twins only). The floor is now unresolved unless every slot has its twin.
3. A missing cols flux satisfied MECH. It now fails.
4. Two sentences above said intake "never" rose and turnover "always" damped. Reworded: no qualifying PAY; single pairs at +3 percent intake fail a safeguard.
5. `--jobs 0` or a non-number ran nothing and reported success. It is now refused.

The labels above were re-derived with the fixed analyzer and are unchanged (see the commit message for the command). Astra found no defect in ledger closure, bounds, CPU/WGSL correspondence, owner claims, checkpointing, the seed audit, resume or branch config stripping, and did not rerun GPU parity.

