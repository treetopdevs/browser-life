# Mycelium world, rung R3: is the missing trail purged by selection? Result (14 Nov 2026 UTC)

**Label: PASS (purge supported).** All three pre-registered discriminators point the predicted way with Holm-adjusted p well under 0.05 and effects well beyond their floors, and the trail-mass concordance holds. Two analyses agree exactly on every readout and effect size and on every decision (their Monte Carlo p-values differ slightly, as noted). Everything is local and uncommitted, run on native WebGPU on one Mac; nothing is deployed and the `/mycelium/` page was not touched.

PASS is a statement about direction and dose: in this world the inherit arm's low trail is not just a difference from a random-controller baseline. It is not a measurement of selection (no per-lineage fitness is measured), and it says nothing about heredity against a trail-following null, structure, individuality or open-endedness. See "What this does not show".

## The numbers (confirmation, slots 6001-6016, 16 runs per arm, 100,000 steps)

Protocol `PROTOCOL.md`; Freeze 1 and Freeze 2 in `FROZEN`; analysis `confirm-report.txt` and `RESULT.json`; independent Python re-derivation `rederive-report.txt`.

| test | predicted | n | effect | raw p | Holm p | verdict |
|---|---|---|---|---|---|---|
| D1 late deposit `dL`, inherit vs blocked (cost 2) | inherit lower | 16 / 16 | Cliff's delta **-0.875** (floor 0.5) | 2.0e-6 | 6.0e-6 | SUPPORT |
| D2 change score g, inherit vs blocked | inherit falls more | 16 / 16 | Cliff's delta **-0.883** (floor 0.5) | 4.0e-6 | 8.0e-6 | SUPPORT |
| D3 dose: early deposit relative to blocked, cost 1, 2, 4 | falls as cost rises | 16 / 16 / 16 | Jonckheere-Terpstra tau **+0.500** (floor 0.25) | 1.98e-4 | 1.98e-4 | SUPPORT |
| C1 late trail mass per particle, inherit vs blocked | inherit lower | 16 / 16 | Cliff's delta **-0.875** (needs <= -0.33) | | | met |

(The two Mann-Whitney p-values are fixed-key permutation Monte Carlo with 1,000,000 permutations; the exact floor is 1e-6. The Python re-derivation uses its own RNG and gets 5e-6, 5e-6 and 1.6e-4, the same decisions.)

Medians per arm (window means; `dE` early (0, 5,000], `dL` late (50,000, 100,000], deposit per particle per step; `tm` trail mass per particle):

| arm | dE | dL | tmE | tmL | runs with dL exactly 0 (zero late deposit probes) |
|---|---|---|---|---|---|
| inherit | 0.0349 | 8.2e-7 | 3.91 | 1.8e-4 | 8 of 16 |
| blocked | 0.0766 | 0.0199 | 7.79 | 1.98 | 0 |
| frozen | 0.0526 | 0 | 5.73 | 0 | 13 |
| inherit-c1 | 0.1094 | 5.8e-5 | 10.99 | 0.0057 | 7 |
| blocked-c1 | 0.1502 | 0.1155 | 14.54 | 11.43 | 0 |
| inherit-c4 | 0.0108 | 8.3e-7 | 1.49 | 4.9e-5 | 8 |
| blocked-c4 | 0.0325 | 0.0064 | 3.54 | 0.633 | 0 |

**D1 and D2 replicate R2b.** In 15 of 16 inherit runs the late deposit is below every blocked run's. The median g is -1.00 for inherit (deposit gone from E to L) and -0.59 for blocked (blocked also loses deposit over time, through survivor filtering and age; the claim is only that inherit loses more).

A note on `dL = 0`: d is a next-step probe taken every 500 steps, not an accumulation of every deposit, so a run with `dL` exactly 0 can still have deposited between probes. The raw series show it: three of the zero-`dL` runs (frozen 6012 and 6013, inherit 6006) gain one unit of trail between two censuses of the late window. "No late deposit" in this document means zero late-window deposit probes.

**D3, the dose response.** The score is the inherit run's early deposit divided by the early deposit of the blocked run of the same slot at the same cost. Medians: **0.72 at cost 1, 0.44 at cost 2, 0.32 at cost 4**. Pairwise Cliff's deltas of the lower-cost group against the higher: cost 1 vs 2 +0.45, 1 vs 4 +0.63, 2 vs 4 +0.43. So the early-window ratio of inherit to blocked decreases across the three tested costs (blocked at each cost carries the mechanical effect of cost): the medians fall by 1.64 times from cost 1 to 2 and by 1.37 times from cost 2 to 4, about 1.5 times per doubling. D3 measures an early-window average at three cost levels; it does not measure a rate of decline or a time to purge, and three levels cannot show whether the dependence is smooth or has a threshold. Its tau of 0.50 is twice the floor. The calibration planting at f = 2 also multiplies the blocked arms by 1.2 and 0.7, so in the normalised score it is a change of 1.67 and 1.40 times per doubling (about 1.5 times), the same size as the observed one; it reached PASS in 95% of 100 resamples, which is consistent with D3 clearing here.

**D4, the frozen arm (descriptive, not in the label).** Prediction written beforehand: FROZEN-LOW. **Observed FROZEN-LOW:** frozen's late deposit is below blocked's with Cliff's delta **-1.00** (p 1.0e-6); 13 of 16 frozen runs have zero late-window deposit probes. Inherit is not below frozen (Cliff's delta +0.31, p 0.084: if anything inherit is somewhat higher). Reading: **FROZEN-SUFFICES**. The low deposit appears without any mutation, with only the 1,024 random founders (and their exact copies) in the world, which is consistent with selection on the standing founder variation. Mutation is not needed for the low deposit. Stochastic drift among founder lineages (survival, reproduction and placement are random even without mutation) and state-dependent expression of a fixed controller are not separated from selection here. The arm with mutation shows more late trail in a few runs than the arm without it (5 inherit runs with late trail mass above 0.1, against 1 frozen), which is consistent with mutation re-introducing some deposit, but that comparison did not reach significance and is not claimed.

**The "drift would push toward the baseline" argument.** Inherit sits far below blocked, not near it, and the frozen arm (no mutation) is lower still. Mutational drift toward the random baseline is therefore not what is seen, though the expectation was never a proof, and drift among founder lineages without mutation is not excluded.

## Integrity and attainability

- **Ledger:** all 162 R3 runs (50 dev, 112 confirmation) have 1,000 ledger checks at residual 0.
- **Population guard:** no run tripped it (n >= 200 at every census of both windows, dev and confirmation).
- **Provenance:** protocol SHA-256 `e0541d13...3fa4` and code hash `f538f101...3a2a` verified by the runner before every logged run; Freeze 2 `calibration_sha256` `ae82ada1...89e1` equals the SHA-256 of `CALIBRATION.json`; every run file equals its seed-log hash; 328 seed-log lines, no invalid entry, no repeated finished run, no confirmation entry before calibration. `world.ts` and `gpu.ts` hash to R2b's FROZEN lines and `git diff HEAD` on `tools/mycelium/world.ts`, `gpu.ts`, `packages/`, `deno.json` and `RULES.md` is empty. The 40 reused R2b dev runs (inherit and blocked, slots 2001-2020) were accepted by R2b's own seed-log hashes and its code hash.
- **CPU cross-checks (acceptance gates):** dev `inherit-c4` slot 2003: CPU digest equals GPU digest `1252f5aa94f797c5`; confirmation `inherit-c4` slot 6004: CPU digest equals GPU digest `2c13ab79879fdb47` (both at the full 100,000 steps, `cpu-check-*.json`).
- **Seeds:** R2b's embargoed slots 5001-5016 and the reserved 8001-8099 were never run or read; every R3 world seed is 60,000 or above (`run.ts` and `r2.ts` already refuse them, tested). `run.ts` and `r2.ts` are in R2's frozen manifest, so no leaf-module edit was made to them.
- **Calibration (READY, `calibration-report.txt`):** attainability, not a positive-control gate. Planted dose response at n = 16: PASS 0.24 at 1.5-fold per cost doubling, 0.95 at 2-fold, 1.00 at 3- and 4-fold (gate: 0.80 at 4-fold). Dev data with inherit and blocked swapped: FAIL (D1 and D2 contradicted). Null deals: PASS 0.00, FAIL 0.01, INCONCLUSIVE 0.99. On the real dev data the rules gave INCONCLUSIVE (D1 and D2 supported; D3 tau +0.29 with n 10 / 20 / 10, Holm p 0.098, NULL), not gated: the dose response was visible on dev at the small dev size and reached its test at 16 per arm.
- **Compute:** 50 dev runs 02:01-02:50 UTC (`--jobs 8`, about 49 min); 112 confirmation runs 02:59-04:08 UTC (about 69 min); two CPU cross-checks about 8 min each beside idle GPU. The other exploration shared the GPU; it affected wall time only.

## What this shows

- In this world and these rules, three things line up that a mere baseline difference would not: (1) the inherit arm loses nearly all of its deposit and trail (D1), replicating R2b on fresh worlds; (2) it loses a larger share of its own deposit over the run than the blocked arm does (D2); (3) the early-window inherit-to-blocked deposit ratio falls as the laying cost rises (D3), against a blocked baseline at each cost that carries the mechanical effect of the cost itself.
- The frozen arm shows that the low deposit does not need mutation: with only the 1,024 random founders competing, 13 of 16 runs have zero late-window deposit probes. That fits selection on the controllers that happen to be around; it does not separate selection from drift among founder lineages.

## What this does not show

- It does not measure selection: no lineage's fitness, no selection coefficient, no tracking of which lineages replace which. The three tests are directional implications of the purge hypothesis, each of which a competing explanation (age structure of the blocked arm, mutational drift) predicts differently, but a mechanism not yet considered could also fit.
- It does not test heredity against a trail-following null, structure of the trail, individuality or open-endedness (R2b's questions), and it does not rescue R2b's label.
- The cost arms are 1, 2 and 4, never 0, and the dose effect is moderate: the early-window ratio, not the late deposit, carries it, because inherit's late deposit is at or near zero at every cost (a floor, as the protocol said). Nothing is said about costs above 4 or below 1.
- One world (128 x 128, uniform light, default rules, 100,000 steps). The inherit arm is strongly seed dependent: 8 of 16 runs have zero late-window deposit probes and 5 hold more than 0.1 trail per particle (one run at cost 1 has a late deposit of 0.39, higher than every blocked cost-2 run). PASS is a statement about the arm's distribution, not about every world.
- The calibration planting shows the rules can reach PASS and FAIL and at what multiplicative effect; it is not a power calculation for a real dose trajectory.
- Per-census values come from stored series (raw fields and genomes are not stored); drift past 100,000 steps is extrapolation.

## Two analyses

The TypeScript analysis (`r3-analyze.ts confirm`) and an independent Python re-derivation (`rederive.py`, reading the raw `series.json` with sequential accumulation, its own RNG, scipy-free statistics, its own slot pairing, Holm, guard rule and frozen reading) agree: 0 of 560 readout mismatches (bit equal), effects equal to 0.0, the same verdict on D1, D2 and D3, the same frozen reading and the same label. They share the protocol's definitions, so neither can see a flaw in the design choices, only in the execution.

## Amendments and deviations

- **Amendments: none.** `PROTOCOL.md` is unedited since Freeze 1 (`protocol_sha256` verified before every run).
- **Deviations:** none from what ran under the frozen code, with one prose discrepancy found by the final review: PROTOCOL.md section 6 specifies 1,000,000 permutations for the Mann-Whitney tests and section 8 does not state the calibration's own counts. Confirmation used 1,000,000 as specified; the calibration used 20,000 (planted and null datasets) and 200,000 (real and flipped dev data), as coded before Freeze 1 and printed in the calibration report. No decision depends on it (every calibration rate had wide margins). Before Freeze 1, three Sol passes changed the draft (below); these are design changes, not amendments.
- **Disclosure:** the windows and the change score g were fixed after looking at R2b's dev series (inherit and blocked deposit by step), which is dev data; an earlier draft used (5,000, 25,000] and an absolute change. No confirmation data existed then.
- `rederive.py` was corrected after the third Sol pass (it is outside the hashed code). Nothing hashed changed after Freeze 1.

## Reviews (Codex Sol 6.1 High, read-only)

Texts in the session scratchpad (`sol1-review.txt` ... `sol3-review.txt`, final review below).

| pass | finding | disposition |
|---|---|---|
| 1 | **P1** D3's permutation null invalid (a shared estimated blocked mean makes scores dependent) | Fixed: scores are slot-paired ratios of independent runs; protocol text and tests (including Sol's scenario) |
| 1 | P2 a complete early purge (dE = dL = 0) read as a D2 contradiction (g 0/0 := 0) | Fixed: g(0,0) := -1, tested |
| 1 | P2 CPU checks were not acceptance gates | Fixed: `cpuCheckProblems`, required by calibrate (dev) and confirm |
| 1 | P2 concurrent batches could repeat runs | Fixed: exclusive lock, log transition checks |
| 1 | P2 D4 inferred mutation necessity from non-rejection | Fixed: five-way reading with NO-PURGE precedence and a direct inherit-vs-frozen comparison |
| 2 | P2 null calibration lost D3 pairs when slots scattered | Fixed: dealt arms are re-slotted |
| 2 | P2 lock per `--out` root | Fixed: one lock beside the canonical seed log, also taken by cpu-check |
| 2 | P2 `rederive.py` still on the old rules | Fixed |
| 2 | P2 D4 mutation branch fired with no purge | Fixed: NO-PURGE first |
| 3 | P2 x4 in `rederive.py` (bit-equal sums, D3 undefined, guard rule, frozen reading) | Fixed (outside the hash); the script now gives bit-equal readouts |
| final | P1 "no late deposit" overstated (dL is a probe every 500 steps); P2 frozen "no drift" and "selection suffices"; P2 dose/calibration scale comparison; P2 "smooth, faster, not a switch"; P2 calibration permutation counts undisclosed; P3 "every number" | All corrected in this file and STATUS.md (wording and disclosure only; the PASS, the numbers and every hashed file are unchanged). Sol also re-ran the confirmation analysis, the Python re-derivation (0 of 560 mismatches) and the calibration resamples, recomputed all 39 manifest hashes and the code, protocol and calibration hashes (match), and found no hashed file or protocol change after Freeze 1, Freeze 2 (02:59:13Z) before the first confirmation entry (02:59:19Z), and no embargoed slot in the log |

## Reproducing this result (note added 14 Nov 2026, when the line landed on main)

`FROZEN` covers `tools/mycelium/world.ts`, `gpu.ts` and `RULES.md`. The later trail-conduit commit (`3e4a51a1`) changed all three, so at the tip of the branch, and on main, the freeze check refuses to run. Check out commit `eef9c043` to re-run or re-analyse: every file `FROZEN` covers matches its recorded hash there (checked 14 Nov 2026). The recorded hashes are unchanged, and nothing in this result was re-derived.
