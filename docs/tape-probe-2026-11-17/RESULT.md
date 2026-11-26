# Tape-program vs weight controller: how often does one mutation change behaviour?

Exploratory first rung, 2026-11-17. No pre-registration, no gate. Code: `experiments/tape-probe/`, tests: `experiments/test/tape-probe.test.ts`, data: `result.json` beside this file. Re-running a shard reproduces identical JSON (counter-based randomness, integer output).

## What was done

Two controller representations, both with a 160-byte genome, were run through one measurement: the same 10 sensors, the same 8 actuators (integer, -127..127, channels 0-5 rectified), the same 26,244-point probe grid (`PROBE_AXES` of `@bl/lineage`), the same diff and the same classifier. For each starting controller (a "parent") we applied single mutations and classified each mutant NEUTRAL (all 209,952 output values identical across the grid), CHANGED-VIABLE or LETHAL (proxy, below). Every mutant genome differs from its parent (a mutation that edits nothing is redrawn up to 8 times; no mutant was dropped), so NEUTRAL means "genome changed, grid behaviour identical".

- **Weights**: the real controller, 10 -> 8 -> 8 int8 network. W-step is the repository's real `mutateInPlace` (mutStep 24) with the target forced into the 160 controller bytes (the real operator also hits mu/sigma/gain, 3 of 163 slots; those are invisible to the probe and excluded). W-resample replaces one weight with a uniform int8.
- **TAPE-R (a designed arm, ours)**: a straight-line register program, 40 instructions x 4 bytes. 32 int32 registers reinitialised on every call (no persistent memory): R0-R9 sensors, R10-R17 outputs, R18-R31 scratch. 16 ops (NOP, MOVI, MOV, ADD, SUB, MUL, MAC, MAX, MIN, RELU, NEG, ABS, SELPOS, SHR, and MULI/MACI, which are the network's weight-edge primitive). Every op saturates to +-127, so products stay under 2^14 and no division by zero exists; execution runs each instruction once, so fuel is exactly 40 and cannot be exhausted. Mutations: T-byte-step (one byte += delta, drawn as W-step draws it: uniform over the 49 values -24..24 with 0 remapped to +1, so +1 is twice as likely as any other step; the one difference is at the edge, where weights clamp at +-127 and bytes wrap mod 256), T-byte-resample (one byte uniform 0-255), T-instr-resample (all 4 bytes of one instruction), T-insert, T-delete, T-dup (length stays 40; the last instruction falls off or a NOP is appended). A different instruction set could move every number here.
- **BFF (robustness check, small N)**: a BFF-style tape (`tools/soup/bff.ts`, 100 program bytes, sensors written to tape bytes 100-109, outputs read from 110-117, 1024 steps, program restored per call). One mutation (byte resample), two random priors (uniform bytes; "dense" = each byte one of the 10 instruction characters). No matched panel and no structural rows.

Panels (starting controllers): RAW (40 random controllers per representation: weights uniform +-64, the repository's `randomGenome` prior; tape uniform bytes), FUNC (the same priors, rejection-sampled until the controller does something: at least 2 of 8 channels with grid range >= 16), FOUNDERS (the 12 M3 founders for weights) and MATCHED (6 tapes found by search to approximate 6 of those founders on the grid, and the weight arm restricted to those same 6 founders, so the comparison is paired). 200 mutants per parent per mutation on RAW/FUNC (8,000 per cell), 400 per parent on founders/matched. BFF: 12 parents x 100 (4 x 100 on FUNC).

## Viability is a proxy, and the proxy was not validated

The tape controller cannot be plugged into the reference simulator without editing `packages/sim-ref` (the network is called inline in `react()`), so the biomass assay of `packages/lineage/src/locality` could not be used for tapes. Viability is instead a parent-relative output-envelope rule on grid means, applied to functional parents only: a channel is "carried" if the parent's grid mean >= 8; a mutant is LETHAL if a carried channel's mean falls below half the parent's, or the summed catalytic mean exceeds twice the parent's plus 32; otherwise CHANGED-VIABLE. Non-functional parents get no viability class ("n/a"). **Read LETHAL as "the catalytic output envelope moved a lot", not as "would die".**

Calibration against the real 16x16 biomass assay, weights only (12 founders as parents, real viable = every scenario keeps >= 50% biomass over both seeds):

| mutation | n | proxy NEUTRAL (real viable / not) | proxy CHANGED-VIABLE | proxy LETHAL | agreement | grid-blind |
|---|---|---|---|---|---|---|
| W-step | 240 | 37 / 0 | 202 / 0 | 1 / 0 | 99.5% | 0 |
| W-resample | 480 | 70 / 0 | 375 / 2 | 33 / 0 | 92.7% (1/4: 94.7%, 3/4: 87.5%) | 0 |

(cells are real-viable / real-not-viable.) The result is that founder-derived weight mutants almost never die in this assay: 2 of 720 were not viable, the proxy called both "viable", and all 34 proxy-lethal mutants were real-viable. So the assay shows no case where the proxy correctly detected a death and the proxy's LETHAL class is an over-strict envelope test, not a validated death predictor. There were no grid-blind cases (grid-identical but real non-viable) in 107 proxy-neutral mutants. The calibration used weights only, on founders (already selected as robust), so it says nothing direct about tapes or about random parents. The 1/4 to 3/4 sweep of the proxy factor is in the last table; it moves the LETHAL counts a lot (weights FUNC W-resample: 192, 326 and 699 of 8,000 at factors 1/4, 1/2, 3/4) and at 3/4 the weight-resample row overtakes the tape rows, so any LETHAL comparison is proxy-dependent.

## What fell out

All rates below are NEUTRAL permille unless stated; intervals are in the tables.

1. **On random starting controllers, tape mutants are far more often grid-neutral than weight mutants.** RAW: weights 7.2% (W-step) and 5.3% (W-resample) against tape 83.6-92.2% across the six tape mutations. FUNC: weights 10.6% and 9.0% against tape 72.7-84.9%. The gap is large and far outside both the pooled and the parent-resampled intervals; per-parent median neutral rates are 3.5-4.5% for weights and 86-100% for the tape mutations (RAW).
2. **On matched controllers the gap closes to a small difference.** Over the same 6 founders the weights give 24.1% (W-step) and 21.0% (W-resample); the matched tapes give 28.7% (T-byte-step) and 29.4% (T-byte-resample), with 16.7-25.2% for instruction-level edits. Parent-level spread is wide (per-parent neutral rate 0.2% to 65% for weights, 19.5% to 47.7% for tapes on the point mutations); per-parent medians are 9.5-11.7% for weights and 27-33% for tapes, so a few very neutral weight parents lift the weight pooled rate. With 6 parents the parent-resampled intervals overlap (weights 3.4-45.3%, tapes 22.3-37.9%). This is the like-for-like comparison, and it is inconclusive on grid-neutrality: similar pooled rates, a higher tape median, overlapping intervals.
3. **Most of the random-tape neutrality is the controller doing little, not the encoding.** About 10 of 32 bits per instruction are decode-dead, but among decode-changing tape mutants the neutral rate stays high on random starts (FUNC T-byte-step 82.4%, RAW 89.2%), so most of it is dataflow redundancy: dead code, writes to scratch registers that never reach an output, overwritten values. On the matched tapes, which use nearly all of the 40 instruction slots to reproduce a network's behaviour (6 NOP slots among the 240 slots of the six saved tapes; a non-NOP slot can still be dataflow-dead), the neutral rate among decode-changing byte edits is 22.0% (T-byte-step) against 28.7% overall, i.e. decode-dead bits account for about 30% of the neutral mutants there. Random tapes are mostly inert (only 11 of 40 RAW tapes are functional); the network with random weights is always functional (40 of 40).
4. **The choice of starting prior moves every number.** Tape neutrality goes from 84-92% (RAW) to 73-85% (FUNC) to 17-29% (matched); weight neutrality goes from 5-7% (RAW) to 9-11% (FUNC) to 15-18% (all 12 founders) and 21-24% (the 6 matched founders). No single headline rate exists. Acceptance of random controllers as functional: weights 40/40 draws, TAPE-R 40 of 113 draws (35%), BFF-dense 4 of 431 draws (0.9%); BFF-uniform produced no functional tape in 12 RAW parents and every one of 1,200 mutants was neutral.
5. **When a tape mutation does change behaviour, the change is big and the changed mutants collapse onto few behaviours.** Among changed mutants on RAW and FUNC, none changed under 1% of the grid and most changed over half of it; weight mutants range from tiny to large (FUNC W-step: 650 of 7,148 changed mutants under 1%, 2,157 over 50%). Mean absolute change per changed output value: weights 3 (W-step) or 10-12 (W-resample), tapes 40-52 units on RAW/FUNC (9-21 on matched tapes). Per parent, 96-99% of changed weight mutants are distinct behaviours; for tapes the share is 61-67% (byte edits), 47-52% (instruction resample), 35-48% (insert), 16-18% (delete) and 1-2% (dup): many different edits land on the same few output functions. In absolute numbers, 200 mutants of one weight parent reach about 176-186 distinct behaviours (of 179-190 changed) and 400 mutants of a founder about 316-332; 200 mutants of a random tape parent reach 12-24 distinct behaviours for byte and instruction edits (of 18-51 changed), about 3-5 for delete and under 1 for dup. For the matched tapes (400 mutants) it is about 179-183 distinct byte-edit behaviours against about 293-305 for the same founders' weights, although the changed counts are close (284.8 and 282.2 changed per parent for T-byte-step and T-byte-resample against 303.3 and 315.8 for W-step and W-resample, 6-11% fewer). There the gap is collapse onto repeated behaviours (pooled distinct/changed 63-65% for tape byte edits against 96.5% for weights), not fewer changed mutants. On RAW and FUNC both effects apply: tapes change about 10 times fewer mutants on RAW and about 6 times fewer on FUNC (byte edits), and those collapse as well.
6. **T-dup is near-neutral on random starts largely by construction here.** In a register-overwrite instruction set, copying an instruction next to itself is idempotent when it overwrites its destination from other registers, so a duplicate matters mainly for accumulating ops (MAC, MACI), when the last instruction was live and falls off the end, or when source and destination alias (for example `MOV R16,R0; NEG R16,R16`: duplicating the NEG flips -x back to x). On the matched tapes T-dup is 25.2% neutral, so it is not near-neutral there. Do not read the dup row as general evidence about duplication. T-insert and T-delete on matched tapes are shaped by the fixed length: with 6 NOPs among the 240 matched slots, the last instruction is usually a real one and is lost on insert or dup.
7. **Under the envelope proxy the LETHAL class is higher for tape step edits, but the proxy was not shown to track death and the comparison depends on its factor.** At factor 1/2: FUNC T-byte-step 4.2% against W-step 0.3%; matched 16.0% against 0.2%. For resample edits it is level on FUNC (T-byte-resample 4.2%, W-resample 4.1%) and higher for tapes on matched (17.0% against 5.3%). At factor 3/4 the weight-resample row exceeds every tape row on RAW (818 against at most 230), but on FUNC only the tape byte-edit rows (368 and 366): W-resample is 699 there, below T-instr-resample (713), T-dup (800) and T-insert (1,065). Given the calibration (the proxy flags weight mutants that stay viable), read this as the catalytic output envelope moving, consistent with item 5, and not as tapes dying more.
8. **Matching.** Matching achieved: 6 of 12 founders matched under the rule declared in advance (full-grid mean absolute error per output value <= 6, at most half the all-zero tape's error, and a functional tape), within 4 restarts x 30,000 hill-climb evaluations per founder. Clusters 4 and 10 (the sparse ones) matched almost exactly (error 0.5 and 0.6); four others matched approximately (4.9-6.0 against 19-41 for the zero tape) and 6 did not (6.03-9.02, still well below the zero-tape error, so they fail only the error threshold). The matching rule is loose relative to the signal: an error of 5 means outputs are off by about 5 on a -127..127 scale on average. The matched tapes are function-on-grid matches only; nothing is known about their behaviour off the grid.
9. **BFF.** With uniform random bytes the program is almost never output-relevant (1,200 of 1,200 mutants neutral). With the dense prior 90.4% of RAW mutants are neutral and all 115 changed mutants moved more than half the grid; no BFF parent on RAW was functional. On the 4 FUNC BFF parents 66.2% of mutants are neutral. N is small and this is a robustness check on "what a loop language does", not a comparison.

## Acceptance and matching

| representation | panel | draws | accepted as functional |
|---|---|---|---|
| weights | FUNC | 40 | 40 (100%) |
| TAPE-R | FUNC | 113 | 40 (35.4%) |
| BFF-dense | FUNC | 431 | 4 (0.9%), 2 of 6 parents never accepted within 100 draws |
| TAPE-R | RAW (no filtering) | 40 | 11 functional (27.5%) |
| weights | RAW (no filtering) | 40 | 40 functional |

Matching: **achieved** (6 of 12).

| founder cluster | full-grid mean abs error per output value | all-zero tape error | functional | matched |
|---|---|---|---|---|
| 0 | 4.938 | 20.128 | yes | YES |
| 1 | 5.649 | 32.777 | yes | YES |
| 2 | 7.666 | 29.452 | yes | no |
| 4 | 0.500 | 21.402 | yes | YES |
| 5 | 5.966 | 32.938 | yes | YES |
| 9 | 5.818 | 41.027 | yes | YES |
| 10 | 0.604 | 19.236 | yes | YES |
| 11 | 7.781 | 41.453 | yes | no |
| 12 | 6.075 | 24.163 | yes | no |
| 16 | 9.016 | 34.426 | yes | no |
| 17 | 6.033 | 22.949 | yes | no |
| 20 | 6.893 | 40.647 | yes | no |

## Tables

Generated from result.json (permille shown as percent).

### RAW random panel (40 parents, 200 mutants per parent per mutation; BFF: 12 parents x 100)

Cells: counts out of n, with rate and pooled Wilson 95% interval for NEUTRAL; parent spread = per-parent neutral rate min/median/max; boot = parent-resampled 95% interval for pooled neutral rate. CHANGED-VIABLE and LETHAL are proxy classes (functional parents only); n/a = changed mutants of non-functional parents.

| representation | mutation | parents | n | NEUTRAL | CHANGED-VIABLE | LETHAL (envelope) | n/a | parent spread | boot |
|---|---|---|---|---|---|---|---|---|---|
| bff-dense | B-byte-resample | 12 (0 functional) | 1200 | 1085 (90.4%) [88.6%-92.0%] | 0 (0.0%) [0.0%-0.4%] | 0 (0.0%) [0.0%-0.4%] | 115 | 75.0% / 94.0% / 100.0% | 84.5%-96.0% |
| bff-uniform | B-byte-resample | 12 (0 functional) | 1200 | 1200 (100.0%) [99.6%-100.0%] | 0 (0.0%) [0.0%-0.4%] | 0 (0.0%) [0.0%-0.4%] | 0 | 100.0% / 100.0% / 100.0% | 100.0%-100.0% |
| weights | W-step | 40 (40 functional) | 8000 | 580 (7.2%) [6.7%-7.9%] | 7394 (92.4%) [91.8%-93.0%] | 26 (0.3%) [0.2%-0.5%] | 0 | 0.0% / 4.5% / 32.5% | 4.8%-9.6% |
| weights | W-resample | 40 (40 functional) | 8000 | 430 (5.3%) [4.9%-5.9%] | 7177 (89.7%) [89.0%-90.4%] | 393 (4.9%) [4.4%-5.5%] | 0 | 0.0% / 3.5% / 23.0% | 3.6%-7.2% |
| tape-R | T-byte-step | 40 (11 functional) | 8000 | 7258 (90.7%) [90.0%-91.4%] | 241 (3.0%) [2.6%-3.5%] | 124 (1.5%) [1.3%-1.9%] | 377 | 65.5% / 93.0% / 99.0% | 88.5%-92.5% |
| tape-R | T-byte-resample | 40 (11 functional) | 8000 | 7300 (91.2%) [90.6%-91.9%] | 214 (2.6%) [2.3%-3.1%] | 134 (1.6%) [1.4%-2.0%] | 352 | 66.5% / 93.5% / 99.5% | 89.0%-93.2% |
| tape-R | T-instr-resample | 40 (11 functional) | 8000 | 6691 (83.6%) [82.8%-84.5%] | 346 (4.3%) [3.9%-4.8%] | 213 (2.6%) [2.3%-3.1%] | 750 | 44.5% / 86.0% / 97.5% | 80.0%-86.5% |
| tape-R | T-insert | 40 (11 functional) | 8000 | 6743 (84.2%) [83.4%-85.1%] | 208 (2.6%) [2.2%-3.0%] | 72 (0.9%) [0.7%-1.2%] | 977 | 0.0% / 91.0% / 96.0% | 76.4%-90.9% |
| tape-R | T-delete | 40 (11 functional) | 8000 | 7346 (91.8%) [91.2%-92.5%] | 204 (2.5%) [2.2%-3.0%] | 134 (1.6%) [1.4%-2.0%] | 316 | 65.0% / 94.5% / 100.0% | 89.2%-94.0% |
| tape-R | T-dup | 40 (11 functional) | 8000 | 7383 (92.2%) [91.6%-92.9%] | 12 (0.1%) [0.0%-0.3%] | 5 (0.0%) [0.0%-0.2%] | 600 | 0.0% / 100.0% / 100.0% | 84.2%-99.7% |

### FUNC random panel (rejection-sampled from the same priors until the controller is functional; BFF-dense: 4 parents x 100)

Cells: counts out of n, with rate and pooled Wilson 95% interval for NEUTRAL; parent spread = per-parent neutral rate min/median/max; boot = parent-resampled 95% interval for pooled neutral rate. CHANGED-VIABLE and LETHAL are proxy classes (functional parents only); n/a = changed mutants of non-functional parents.

| representation | mutation | parents | n | NEUTRAL | CHANGED-VIABLE | LETHAL (envelope) | n/a | parent spread | boot |
|---|---|---|---|---|---|---|---|---|---|
| bff-dense | B-byte-resample | 4 (4 functional) | 400 | 265 (66.2%) [61.4%-70.8%] | 55 (13.7%) [10.7%-17.5%] | 80 (20.0%) [16.3%-24.2%] | 0 | 45.0% / 71.0% / 81.0% | 51.5%-77.7% |
| weights | W-step | 40 (40 functional) | 8000 | 852 (10.6%) [9.9%-11.4%] | 7121 (89.0%) [88.3%-89.7%] | 27 (0.3%) [0.2%-0.5%] | 0 | 0.0% / 10.5% / 37.5% | 8.2%-13.5% |
| weights | W-resample | 40 (40 functional) | 8000 | 723 (9.0%) [8.4%-9.7%] | 6951 (86.8%) [86.1%-87.7%] | 326 (4.0%) [3.6%-4.6%] | 0 | 0.0% / 7.5% / 35.0% | 6.7%-11.4% |
| tape-R | T-byte-step | 40 (40 functional) | 8000 | 6788 (84.8%) [84.0%-85.7%] | 872 (10.9%) [10.2%-11.7%] | 340 (4.2%) [3.8%-4.8%] | 0 | 69.0% / 85.5% / 92.5% | 83.1%-86.3% |
| tape-R | T-byte-resample | 40 (40 functional) | 8000 | 6798 (84.9%) [84.1%-85.8%] | 865 (10.8%) [10.1%-11.6%] | 337 (4.2%) [3.7%-4.7%] | 0 | 67.5% / 85.0% / 92.5% | 83.3%-86.4% |
| tape-R | T-instr-resample | 40 (40 functional) | 8000 | 5959 (74.4%) [73.5%-75.5%] | 1366 (17.0%) [16.2%-18.0%] | 675 (8.4%) [7.8%-9.1%] | 0 | 52.5% / 75.5% / 85.5% | 72.1%-76.9% |
| tape-R | T-insert | 40 (40 functional) | 8000 | 5821 (72.7%) [71.7%-73.8%] | 1136 (14.2%) [13.4%-15.0%] | 1043 (13.0%) [12.3%-13.8%] | 0 | 0.0% / 89.0% / 94.5% | 61.3%-82.3% |
| tape-R | T-delete | 40 (40 functional) | 8000 | 6764 (84.5%) [83.7%-85.4%] | 852 (10.6%) [9.9%-11.4%] | 384 (4.8%) [4.3%-5.3%] | 0 | 66.0% / 84.5% / 96.0% | 82.4%-86.5% |
| tape-R | T-dup | 40 (40 functional) | 8000 | 6514 (81.4%) [80.5%-82.3%] | 686 (8.5%) [7.9%-9.3%] | 800 (10.0%) [9.3%-10.7%] | 0 | 0.0% / 100.0% / 100.0% | 69.1%-91.4% |

### FOUNDERS panel (weights only: all 12 M3 founders, 400 mutants each)

Cells: counts out of n, with rate and pooled Wilson 95% interval for NEUTRAL; parent spread = per-parent neutral rate min/median/max; boot = parent-resampled 95% interval for pooled neutral rate. CHANGED-VIABLE and LETHAL are proxy classes (functional parents only); n/a = changed mutants of non-functional parents.

| representation | mutation | parents | n | NEUTRAL | CHANGED-VIABLE | LETHAL (envelope) | n/a | parent spread | boot |
|---|---|---|---|---|---|---|---|---|---|
| weights | W-step | 12 (12 functional) | 4800 | 871 (18.1%) [17.0%-19.3%] | 3912 (81.5%) [80.3%-82.6%] | 17 (0.3%) [0.2%-0.6%] | 0 | 0.0% / 9.7% / 64.7% | 7.2%-31.5% |
| weights | W-resample | 12 (12 functional) | 4800 | 715 (14.8%) [13.9%-16.0%] | 3817 (79.5%) [78.3%-80.7%] | 268 (5.5%) [4.9%-6.3%] | 0 | 0.0% / 7.7% / 58.7% | 5.1%-27.1% |

### MATCHED panel, weights side (the 6 founders a tape was matched to, 400 mutants each)

Cells: counts out of n, with rate and pooled Wilson 95% interval for NEUTRAL; parent spread = per-parent neutral rate min/median/max; boot = parent-resampled 95% interval for pooled neutral rate. CHANGED-VIABLE and LETHAL are proxy classes (functional parents only); n/a = changed mutants of non-functional parents.

| representation | mutation | parents | n | NEUTRAL | CHANGED-VIABLE | LETHAL (envelope) | n/a | parent spread | boot |
|---|---|---|---|---|---|---|---|---|---|
| weights | W-step | 6 (6 functional) | 2400 | 580 (24.1%) [22.4%-26.0%] | 1814 (75.5%) [73.8%-77.3%] | 6 (0.2%) [0.1%-0.6%] | 0 | 0.2% / 11.7% / 65.0% | 4.4%-45.3% |
| weights | W-resample | 6 (6 functional) | 2400 | 505 (21.0%) [19.4%-22.8%] | 1768 (73.6%) [71.8%-75.4%] | 127 (5.2%) [4.4%-6.3%] | 0 | 1.5% / 9.5% / 57.0% | 3.4%-39.4% |

### MATCHED panel, tape side (the 6 matched tapes, 400 mutants each)

Cells: counts out of n, with rate and pooled Wilson 95% interval for NEUTRAL; parent spread = per-parent neutral rate min/median/max; boot = parent-resampled 95% interval for pooled neutral rate. CHANGED-VIABLE and LETHAL are proxy classes (functional parents only); n/a = changed mutants of non-functional parents.

| representation | mutation | parents | n | NEUTRAL | CHANGED-VIABLE | LETHAL (envelope) | n/a | parent spread | boot |
|---|---|---|---|---|---|---|---|---|---|
| tape-R | T-byte-step | 6 (6 functional) | 2400 | 691 (28.7%) [27.0%-30.7%] | 1325 (55.2%) [53.2%-57.2%] | 384 (16.0%) [14.5%-17.6%] | 0 | 19.5% / 32.5% / 44.5% | 22.3%-36.3% |
| tape-R | T-byte-resample | 6 (6 functional) | 2400 | 707 (29.4%) [27.6%-31.4%] | 1284 (53.5%) [51.5%-55.5%] | 409 (17.0%) [15.5%-18.6%] | 0 | 20.0% / 27.0% / 47.7% | 22.7%-37.9% |
| tape-R | T-instr-resample | 6 (6 functional) | 2400 | 403 (16.7%) [15.3%-18.4%] | 1409 (58.7%) [56.7%-60.7%] | 588 (24.5%) [22.8%-26.3%] | 0 | 9.0% / 14.0% / 35.7% | 10.6%-24.9% |
| tape-R | T-insert | 6 (6 functional) | 2400 | 560 (23.3%) [21.6%-25.1%] | 1731 (72.1%) [70.2%-73.9%] | 109 (4.5%) [3.7%-5.5%] | 0 | 0.0% / 0.0% / 73.5% | 0.0%-49.0% |
| tape-R | T-delete | 6 (6 functional) | 2400 | 533 (22.2%) [20.5%-24.0%] | 1394 (58.0%) [56.0%-60.1%] | 473 (19.7%) [18.1%-21.4%] | 0 | 11.0% / 22.7% / 37.0% | 15.6%-30.1% |
| tape-R | T-dup | 6 (6 functional) | 2400 | 605 (25.2%) [23.5%-27.0%] | 1772 (73.8%) [72.0%-75.6%] | 23 (0.9%) [0.6%-1.5%] | 0 | 0.0% / 0.0% / 79.0% | 0.0%-52.6% |

### Neutral rate among decode-changing mutants (tape encoding redundancy vs dataflow redundancy)

A tape mutant is decode-changing when the canonical instruction (op plus only the live fields of that op) differs from the parent's. Weight edits always change a live byte, so for weights the decode-changing rate is the plain rate.

| panel | mutation | decode-changing n / n | NEUTRAL among decode-changing | overall NEUTRAL |
|---|---|---|---|---|
| func | T-byte-step | 6869 / 8000 | 5657 (82.4%) | 84.8% |
| func | T-byte-resample | 6762 / 8000 | 5560 (82.2%) | 84.9% |
| func | T-instr-resample | 7970 / 8000 | 5929 (74.3%) | 74.4% |
| func | T-insert | 8000 / 8000 | 5821 (72.7%) | 72.7% |
| func | T-delete | 7983 / 8000 | 6747 (84.5%) | 84.5% |
| func | T-dup | 8000 / 8000 | 6514 (81.4%) | 81.4% |
| matched | T-byte-step | 2190 / 2400 | 481 (22.0%) | 28.7% |
| matched | T-byte-resample | 2137 / 2400 | 444 (20.7%) | 29.4% |
| matched | T-instr-resample | 2400 / 2400 | 403 (16.7%) | 16.7% |
| matched | T-insert | 2400 / 2400 | 560 (23.3%) | 23.3% |
| matched | T-delete | 2400 / 2400 | 533 (22.2%) | 22.2% |
| matched | T-dup | 2400 / 2400 | 605 (25.2%) | 25.2% |
| raw | T-byte-step | 6869 / 8000 | 6127 (89.2%) | 90.7% |
| raw | T-byte-resample | 6779 / 8000 | 6079 (89.6%) | 91.2% |
| raw | T-instr-resample | 7969 / 8000 | 6660 (83.5%) | 83.6% |
| raw | T-insert | 8000 / 8000 | 6743 (84.2%) | 84.2% |
| raw | T-delete | 7983 / 8000 | 7329 (91.8%) | 91.8% |
| raw | T-dup | 8000 / 8000 | 7383 (92.2%) | 92.2% |

### Size of change and distinct behaviours (changed mutants only)

Bins are shares of the changed mutants by fraction of the 26,244 grid points where any output differs (<1%, 1-10%, 10-50%, >50%). Mean |delta| is over changed output values (integer division); max delta is the mean per changed mutant; outputs moved = channels changing on >= 1% of the grid. Distinct = distinct exact behaviours (hash of the full output array) among the changed mutants of one parent; pooled ratio = distinct / changed.

| rep | panel | mutation | changed | bins <1 / 1-10 / 10-50 / >50 (counts) | mean abs delta | mean max delta | outputs moved | changed per parent | distinct per parent | pooled distinct/changed |
|---|---|---|---|---|---|---|---|---|---|---|
| bff-dense | func | B-byte-resample | 135 | 0 / 30 / 7 / 98 | 60 | 95 | 5.73 | 33.8 | 15.5 | 45.9% |
| bff-dense | raw | B-byte-resample | 115 | 0 / 0 / 0 / 115 | 50 | 47 | 1.73 | 9.6 | 3.7 | 38.2% |
| bff-uniform | raw | B-byte-resample | 0 | 0 / 0 / 0 / 0 | 0 | 0 | 0.00 | 0.0 | 0.0 | 0.0% |
| weights | founders-matched | W-step | 1820 | 92 / 244 / 789 / 695 | 3 | 6 | 3.26 | 303.3 | 293.0 | 96.5% |
| weights | founders-matched | W-resample | 1895 | 57 / 137 / 752 / 949 | 12 | 33 | 3.34 | 315.8 | 305.3 | 96.6% |
| weights | founders | W-step | 3929 | 238 / 618 / 1645 / 1428 | 3 | 6 | 3.54 | 327.4 | 315.6 | 96.3% |
| weights | founders | W-resample | 4085 | 202 / 450 / 1551 / 1882 | 12 | 31 | 3.60 | 340.4 | 332.0 | 97.5% |
| weights | func | W-step | 7148 | 650 / 1447 / 2894 / 2157 | 3 | 5 | 3.30 | 178.7 | 175.9 | 98.4% |
| weights | func | W-resample | 7277 | 452 / 1148 / 2699 / 2978 | 11 | 29 | 3.62 | 181.9 | 179.5 | 98.6% |
| weights | raw | W-step | 7420 | 630 / 1224 / 3315 / 2251 | 3 | 6 | 3.60 | 185.5 | 182.0 | 98.0% |
| weights | raw | W-resample | 7570 | 473 / 935 / 3117 / 3045 | 10 | 29 | 3.91 | 189.2 | 186.2 | 98.3% |
| tape-R | func | T-byte-step | 1212 | 0 / 6 / 540 / 666 | 42 | 60 | 1.25 | 30.3 | 18.4 | 60.8% |
| tape-R | func | T-byte-resample | 1202 | 0 / 15 / 469 / 718 | 43 | 62 | 1.25 | 30.1 | 19.4 | 64.7% |
| tape-R | func | T-instr-resample | 2041 | 0 / 16 / 792 / 1233 | 45 | 65 | 1.28 | 51.0 | 24.2 | 47.4% |
| tape-R | func | T-insert | 2179 | 0 / 10 / 848 / 1321 | 43 | 56 | 1.16 | 54.5 | 19.0 | 34.8% |
| tape-R | func | T-delete | 1236 | 0 / 17 / 493 / 726 | 44 | 64 | 1.21 | 30.9 | 5.0 | 16.1% |
| tape-R | func | T-dup | 1486 | 0 / 0 / 645 / 841 | 40 | 46 | 1.04 | 37.1 | 0.8 | 2.0% |
| tape-R | matched | T-byte-step | 1709 | 1 / 12 / 371 / 1325 | 19 | 41 | 2.08 | 284.8 | 179.3 | 62.9% |
| tape-R | matched | T-byte-resample | 1693 | 0 / 10 / 332 / 1351 | 21 | 45 | 2.08 | 282.2 | 182.8 | 64.7% |
| tape-R | matched | T-instr-resample | 1997 | 0 / 24 / 393 / 1580 | 21 | 47 | 2.18 | 332.8 | 120.7 | 36.2% |
| tape-R | matched | T-insert | 1840 | 0 / 2 / 49 / 1789 | 14 | 35 | 1.43 | 306.7 | 90.2 | 29.4% |
| tape-R | matched | T-delete | 1867 | 0 / 29 / 432 / 1406 | 18 | 39 | 2.01 | 311.2 | 28.3 | 9.1% |
| tape-R | matched | T-dup | 1795 | 0 / 0 / 30 / 1765 | 9 | 28 | 1.46 | 299.2 | 11.0 | 3.6% |
| tape-R | raw | T-byte-step | 742 | 0 / 1 / 265 / 476 | 47 | 64 | 1.11 | 18.6 | 12.4 | 67.1% |
| tape-R | raw | T-byte-resample | 700 | 0 / 1 / 220 / 479 | 51 | 68 | 1.15 | 17.5 | 11.8 | 67.4% |
| tape-R | raw | T-instr-resample | 1309 | 0 / 2 / 422 / 885 | 50 | 68 | 1.15 | 32.7 | 17.2 | 52.5% |
| tape-R | raw | T-insert | 1257 | 0 / 1 / 417 / 839 | 50 | 65 | 1.08 | 31.4 | 15.2 | 48.4% |
| tape-R | raw | T-delete | 654 | 0 / 0 / 217 / 437 | 49 | 66 | 1.09 | 16.4 | 2.9 | 17.8% |
| tape-R | raw | T-dup | 617 | 0 / 0 / 212 / 405 | 52 | 63 | 1.00 | 15.4 | 0.1 | 0.8% |

### Sensitivity of the LETHAL proxy (factor on the carried-channel loss rule; main table uses 1/2)

| rep | panel | mutation | LETHAL at 1/4 | at 1/2 | at 3/4 |
|---|---|---|---|---|---|
| weights | founders-matched | W-step | 2 | 6 | 29 |
| weights | founders-matched | W-resample | 82 | 127 | 226 |
| weights | founders | W-step | 3 | 17 | 53 |
| weights | founders | W-resample | 153 | 268 | 536 |
| weights | func | W-step | 9 | 27 | 105 |
| weights | func | W-resample | 192 | 326 | 699 |
| weights | raw | W-step | 8 | 26 | 87 |
| weights | raw | W-resample | 218 | 393 | 818 |
| tape-R | func | T-byte-step | 314 | 340 | 368 |
| tape-R | func | T-byte-resample | 310 | 337 | 366 |
| tape-R | func | T-instr-resample | 638 | 675 | 713 |
| tape-R | func | T-insert | 1022 | 1043 | 1065 |
| tape-R | func | T-delete | 371 | 384 | 402 |
| tape-R | func | T-dup | 800 | 800 | 800 |
| tape-R | matched | T-byte-step | 301 | 384 | 518 |
| tape-R | matched | T-byte-resample | 291 | 409 | 527 |
| tape-R | matched | T-instr-resample | 443 | 588 | 709 |
| tape-R | matched | T-insert | 83 | 109 | 154 |
| tape-R | matched | T-delete | 353 | 473 | 571 |
| tape-R | matched | T-dup | 23 | 23 | 47 |
| tape-R | raw | T-byte-step | 110 | 124 | 128 |
| tape-R | raw | T-byte-resample | 117 | 134 | 146 |
| tape-R | raw | T-instr-resample | 205 | 213 | 230 |
| tape-R | raw | T-insert | 61 | 72 | 76 |
| tape-R | raw | T-delete | 134 | 134 | 141 |
| tape-R | raw | T-dup | 5 | 5 | 5 |

## What this does and does not show

- This measures one-step mutational neighbourhoods on a fixed 26,244-point controller probe grid, for two designed-and-natural representations at equal byte budget; it does not measure evolvability, improvement, open-endedness or ecological fitness.
- The about-2-percent improving rate is not the baseline; the baseline is the weight controller run through this same probe.
- Viability is an output-envelope proxy (the tape controller cannot be plugged into RefSim without editing sim-ref), calibrated on weights only, and the calibration found almost no real deaths to detect; dead-bit and no-op encoding redundancy are reported separately.
- Neutral on the grid is not neutral where a lineage lives. The grid is canonical sensor states, not the states a lineage visits, and a mutant that is identical on the grid could still differ off it.
- The tape instruction set is our design; a different instruction set could move every number. Several rows (dup, insert, delete) are shaped by that design and the fixed 40-instruction length.
- Results depend strongly on the starting prior, so no single headline rate.
- Pooled Wilson intervals treat mutants as independent; mutants of one parent are not, so the parent spread and parent-resampled interval columns are the more honest uncertainty. With 6 matched parents they are wide.
- It says nothing about which representation would evolve better. It does say that, started from random controllers, a mutation to a weight vector almost always changes what the controller does and a mutation to a random register program usually does not, and that from controllers matched to the same behaviour the two are not clearly different on this measure.

## Deviations from the plan

- 12 M3 founders exist (clusters 0,1,2,4,5,9,10,11,12,16,17,20), not 11; the founder panel has 12 parents (4,800 mutants per kind).
- The shard split was nn-raw, nn-func, nn-founders, nn-founders-matched, tape-raw, tape-func, tape-matched and three small BFF shards; each ran in under 6 minutes, so no scaling down was needed. Parent counts were as planned (40 x 200).
- The first calibration (W-step, 20 per founder) found no non-viable mutant at all, so a second calibration with W-resample (40 per founder) was added; both are reported.
- BFF FUNC used a cap of 100 draws per parent (not 2000) and 6 requested parents (4 accepted), because a BFF probe costs 30-40 ms; BFF-uniform has no FUNC panel.
- The decode-changing split is exact for tapes; for weights it is not separately reported (every weight byte is live).
- Mean "outputs moved" counts channels changing on >= 1% of the grid, tested equal to `describeProbes` breadth.
- Review fixes (2026-11-17): T-byte-step originally drew 48 nonzero steps; it now uses the weight operator's 49-value draw with 0 remapped to +1, and the three T-byte-step cells (RAW, FUNC, matched) were rerun and the tables and prose regenerated (other cells and the matching are unchanged and bit-identical). The shifts were small (for example matched T-byte-step neutral 28.5% to 28.7%, FUNC 84.6% to 84.8%). `run.ts cell` now refuses panel/representation combinations that would misread genome bytes (founders on tapes, matched tapes on weights).
