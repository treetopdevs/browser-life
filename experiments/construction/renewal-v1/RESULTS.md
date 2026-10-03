# Renewal v1: results

**Outcome (2026-10-04): no pilot habitat qualifies. The study is closed under its own rules as a valid negative; no confirmation was earned or run.** In the plan's words (section 9): this fixed reservoir/spread panel did not establish local renewal under rule 1. That is not a claim that all rule-1 transport is incapable of it.

- Protocol frozen before any trajectory: `runs/construction/renewal-v1`, protocol `af22151c…`, plan `5fef4345…`, manifest `0df114ad…`, source digest `24cef9e2…`; seeds 7,310,001 (pilot and controls) unused before the freeze. Thresholds V = 128, Qmin = 128, R ≥ 0, late window 9,000–10,000 were fixed in the plan and not changed.
- All 40 scheduled histories completed on the first attempt (16 controls, then 24 main cases; CPU `RefSim`, one at a time). Exact matter conservation and a zero energy-ledger residual held at every census and checkpoint. No mutation event occurred. Every spread-0 case kept off-source B at exactly zero.
- Verification: the predesignated A16/spread-1 `builder` and `ablation` cases matched on a complete CPU replay (101 censuses, every hash, ledger, cumulative observer value and checkpoint digest) and on a native GPU replay (100 censuses: state hash, ledger, flux and last-step roles). The independent audit (its own code, not the production readout) passed every case, and its per-case decisions and selection agree with the production readout. Audit `c3caf48a…` (`verify/pilot-attempt-1`), pilot readout `8dd797ef…`.
- RENEW is false in all 24 main cases. Therefore no spread-1 or spread-2 habitat is eligible, the selection is `none-eligible`, and the confirmation seeds 7,311,001–7,311,005 were never used.

## What the controls say

- **Capacity and division (spread 0, 3,000 steps):** in all four, both initialized sites held B ≥ 128 at every census 2,000–3,000 with Q ≥ 128. Finite persistence at spread 0 is possible at both densities and both reservoirs. Reaction balance over 2,000–3,000 (reported, not gated): negative at A4 (capacity −52 and −54, division −11 and −7) and positive at A16 (capacity +10 and +21, division +33 and +68), so at the low reservoir persistence coexists with slow local decline.
- **Small founders (10,000 steps):** at spread 0 every small founder, B64 or B128, maintained its own site under both reservoirs. At spread 1 and 2 every small founder went extinct, except at A16/spread 1, where a little biomass (77) remained without any maintained site. Two starting sizes do not locate a viability threshold.

## What the main cases say

- **Spread 0:** all eight cases persist at the source (final B 293–1,044) with nothing off-source, as the physics requires, so none can renew by definition. Construction is paid (BUILD ≈ 250 B in builder and ablation) without a renewal endpoint to show for it.
- **Spread 2:** all eight cases went extinct at both reservoirs.
- **Spread 1, A4:** all four went extinct.
- **Spread 1, A16:** the one regime with large growth. The matched nonbuilder ended at 11,753 B and the selected nonbuilder and the ablation peaked at 11,042 and 8,103 B before extinction; the builder ended at 163 B with its source empty.

Descriptive, post hoc (computed from the saved censuses after the readout; it cannot rescue the primary gate and was not part of the protocol): in `pilot-matched-A16-s1` the final 11,753 B was spread over 216 cells, no cell above 71 B. Sites were metabolically active in the late window: the best fixed site had Q = 564 and R = +57, but its minimum B was 66, below V = 128, and no site anywhere reached B ≥ 128 at all 11 censuses. The film sits at about the export band of the exact transport table (at spread 1 a cell sends bound matter to its cardinal neighbours from B = 69), which is consistent with the RESEARCH hypothesis that at spread ≥ 1 a site above the export threshold is drained unless its neighbours send mass back. V = 128 was chosen before any trajectory as the catalyst half-saturation scale, not as an estimated organism size; this observation is the kind of limitation the plan asked to keep visible rather than to re-threshold.

## The export-threshold hypothesis (RESEARCH, open question U4)

Descriptive, from the saved source accounting at the censuses (every 100 steps): how often each spreading source held at least the export threshold (69 B at spread 1, 37 B at spread 2) after step 0, and its gross bound-B traffic over the full horizon.

- All 24 sources at spread ≥ 1 were net exporters of bound B over the full horizon (net −28 to −1,836 B).
- None sustained the threshold. The longest run of consecutive censuses at or above it was 8 (`pilot-ablation-A16-s1`, steps 100–800); most sources reached it at one census or none after step 0. The most frequent was `pilot-matched-A16-s1` (31 of 100 censuses, at most 6 in a row), with heavy two-way exchange (11,961 B in, 13,240 B out).
- The small founders at A16/spread 1 never received inbound bound B (their neighbours never held enough to send any) and crossed the threshold only intermittently, at five censuses between steps 1,400 and 6,700, carried by local synthesis while exporting 1,752 and 1,836 B in total.

So this panel cannot test the hypothesis that a source above the export threshold persists only when its neighbours send mass back: it contains no source that persisted above the threshold, with or without return flow. U4 stays open.

## Cost, measured

Controls of 3,000 steps took 4.2 s each and 1.3 MB; the 24 main cases of 10,000 steps took a median 16.2 s (90th percentile 16.6 s, maximum 18.9 s) and 3.7 MB (maximum 4.3 MB), and all 36 histories of 10,000 steps (small-founder controls included) a median 15.6 s, observer, census writing and checkpoints included, on the M1 Max (`mac-m1max`). All 40 histories: 576 s and 140 MB; the root with initial states, frozen sources and verification holds 149.2 MB (logical size; 157 MiB allocated on disk). The CPU replay took 15–17 s per case and the GPU replay 7 s.

## Next boundary

The plan stops here: no alternate habitat, no new threshold, seed, reservoir, controller, horizon or spread. A new law, resource sweep, mutation or disturbance study needs its own plan. For the evolvability-discovery workstream this outcome means no renewable regime is established for this panel: Stage 4a may still run as a diagnostic with a protocol that says what it diagnoses, and Stage 5 (selection) does not start.

<!-- GENERATED:BEGIN (tools/construction-renewal.ts report; do not edit inside) -->
Manifest `0df114ada3dfba34f601cd70afea764f1af6207565cf8ce1cca1cb882250f1e0`; protocol `af22151cfbf0a2f2aebd73f3e8985a75e106e416718e56daeaa91f6ffd12246a`; plan `5fef434533e07b376cf4e6b465929ee8561699471a2556f1a514406d9da4bf3d`; source digest `24cef9e2f79abaad6d9260e63585c30c1b0a3516d38e669321235ccd3d0e6362`.
Inputs: witness `7cbf49c409b137768b90c176b2a68c7034e3a870f81163cf969b0bbfc03e6019`, selected competitor `18b596eaf84a2724706e1b93988c40f0992ed25c182c248af0a17c7cf719ebdd`. Pilot readout `8dd797efeec1fccb78c56883f4cc7bd2a49015e2cde1a67728469e8563672e78`, pilot audit `c3caf48a0bc3d551efb472c40c71478e57cc9a432e2323052aa55d9ec86398c4`.

**Selection:** none-eligible. **Confirmation:** absent: not earned (no pilot habitat qualified).

| Case | Outcome | Extinct | Final B | Source B (final / late min) | Qualifying sites | BUILD B | Harvested light | Heat export | A depletion |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| control-capacity-A4 | both sites persist true | false | 1498 | 752, 746 / 752, 746 | 0 | 225 | 381320 | 385550 | -115 |
| control-capacity-A16 | both sites persist true | false | 2020 | 1012, 1008 / 998, 985 | 0 | 225 | 458440 | 456290 | 465 |
| control-division-A4 | both sites persist true | false | 778 | 390, 388 / 387, 388 | 0 | 223 | 188270 | 189203 | 46 |
| control-division-A16 | both sites persist true | false | 1339 | 659, 680 / 626, 612 | 0 | 224 | 276950 | 271027 | 668 |
| control-small-B64-A4-s0 | a site maintained true | false | 228 | 228 / 223 | 1 | 217 | 135450 | 132330 | 397 |
| control-small-B64-A4-s1 | a site maintained false | true | 0 | 0 / 0 | 0 | 31 | 6730 | 7000 | 165 |
| control-small-B64-A4-s2 | a site maintained false | true | 0 | 0 / 0 | 0 | 0 | 210 | 828 | 11 |
| control-small-B64-A16-s0 | a site maintained true | false | 762 | 762 / 721 | 1 | 243 | 430250 | 420306 | 1112 |
| control-small-B64-A16-s1 | a site maintained false | false | 77 | 65 / 58 | 0 | 140 | 70050 | 64945 | 2282 |
| control-small-B64-A16-s2 | a site maintained false | true | 0 | 0 / 0 | 0 | 0 | 210 | 828 | 11 |
| control-small-B128-A4-s0 | a site maintained true | false | 237 | 237 / 232 | 1 | 227 | 147690 | 145253 | 331 |
| control-small-B128-A4-s1 | a site maintained false | true | 0 | 0 / 0 | 0 | 30 | 7090 | 7986 | 172 |
| control-small-B128-A4-s2 | a site maintained false | true | 0 | 0 / 0 | 0 | 1 | 800 | 1980 | 45 |
| control-small-B128-A16-s0 | a site maintained true | false | 775 | 775 / 735 | 1 | 245 | 445240 | 435921 | 1061 |
| control-small-B128-A16-s1 | a site maintained false | false | 77 | 65 / 58 | 0 | 140 | 70550 | 66073 | 2288 |
| control-small-B128-A16-s2 | a site maintained false | true | 0 | 0 / 0 | 0 | 1 | 820 | 2000 | 45 |
| pilot-builder-A4-s0 | RENEW false | false | 492 | 492 / 492 | 0 | 249 | 505640 | 510381 | -78 |
| pilot-matched-A4-s0 | RENEW false | false | 296 | 296 / 289 | 0 | 0 | 250900 | 254827 | 1654 |
| pilot-selected-A4-s0 | RENEW false | false | 294 | 294 / 294 | 0 | 0 | 233250 | 237435 | 1850 |
| pilot-ablation-A4-s0 | RENEW false | false | 293 | 293 / 278 | 0 | 242 | 247240 | 250513 | 1686 |
| pilot-builder-A4-s1 | RENEW false | true | 0 | 0 / 0 | 0 | 298 | 55410 | 64000 | 715 |
| pilot-matched-A4-s1 | RENEW false | true | 0 | 0 / 0 | 0 | 0 | 297080 | 301568 | 2876 |
| pilot-selected-A4-s1 | RENEW false | true | 0 | 0 / 0 | 0 | 0 | 247530 | 251570 | 3100 |
| pilot-ablation-A4-s1 | RENEW false | true | 0 | 0 / 0 | 0 | 703 | 194010 | 197778 | 2821 |
| pilot-builder-A4-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 59 | 11440 | 21208 | 216 |
| pilot-matched-A4-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 0 | 12650 | 22396 | 247 |
| pilot-selected-A4-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 0 | 12120 | 21588 | 386 |
| pilot-ablation-A4-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 57 | 12150 | 21850 | 250 |
| pilot-builder-A16-s0 | RENEW false | false | 996 | 996 / 984 | 0 | 250 | 763060 | 761318 | 623 |
| pilot-matched-A16-s0 | RENEW false | false | 1044 | 1044 / 1029 | 0 | 0 | 837610 | 821253 | 8044 |
| pilot-selected-A16-s0 | RENEW false | false | 916 | 916 / 891 | 0 | 0 | 780270 | 765810 | 8684 |
| pilot-ablation-A16-s0 | RENEW false | false | 1037 | 1037 / 1025 | 0 | 250 | 834330 | 817296 | 8078 |
| pilot-builder-A16-s1 | RENEW false | false | 163 | 0 / 0 | 0 | 2190 | 691830 | 677979 | 9368 |
| pilot-matched-A16-s1 | RENEW false | false | 11753 | 67 / 65 | 0 | 0 | 8825260 | 8683700 | 15408 |
| pilot-selected-A16-s1 | RENEW false | true | 0 | 0 / 0 | 0 | 0 | 1832510 | 1811620 | 15565 |
| pilot-ablation-A16-s1 | RENEW false | true | 0 | 0 / 0 | 0 | 5993 | 1546510 | 1518704 | 15303 |
| pilot-builder-A16-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 71 | 18210 | 27396 | 502 |
| pilot-matched-A16-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 0 | 28940 | 37296 | 942 |
| pilot-selected-A16-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 0 | 41690 | 48304 | 1813 |
| pilot-ablation-A16-s2 | RENEW false | true | 0 | 0 / 0 | 0 | 98 | 24710 | 33354 | 768 |

Offered light is grid light-level exposure (sum of L over cells and executed steps): 2,611,200,000 units for 10,000 steps. Harvested light is the energy fixed by photosynthesis, an outcome.

Limitations:

- Finite-horizon local renewal only: not autonomous offspring, evolution, indefinite persistence or antifragility.
- Maintenance is sampled at censuses every 100 steps; no claim of survival between censuses, independence from dissolved resources supplied by the source, or autonomy from gross B exchanges.
- Q and reaction balance exclude static or purely imported deposits; they do not prove atom-by-atom material ancestry.
- All genomes are fixed (mutRate 0): this is not a heritable-selection endpoint.
- The reservoir changes available matter; different A levels are not an equal-resource comparison. Within an A/spread cell, arms share resources and light.
- Capacity and division controls apply only to spread 0 and their layouts; two small-founder sizes do not locate a viability threshold.
- The selected habitat is the first eligible one in a frozen order, not an optimum; arms sharing a seed are a paired block, not independent histories.
- Native GPU replays check state hash, ledgers, flux and last-step roles at censuses; they do not reconstruct the CPU observer's per-step history.
- This study's data are separate from the earlier nutrient-free construction runs.
<!-- GENERATED:END -->
