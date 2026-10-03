# Continuation after the first sweep — decisions

The protocol is `../continuation-protocol.md` (frozen; never edited in place). Readable results are in `../continuation-findings.md`.

## 2026-10-02 UTC — Released and launched

The user authorized the run in chat: "start the run once the reviews come back clear". The second independent review returned CLEAR.

`release.json` (SHA-256 `aa744f13…fb66`) names candidate `6ff0266a…255d`. It authorizes:
- 1,536 new competitions;
- 8 replays and their audits;
- a budget capped at 30,000 s and 70 invocations of at most 600 s each, run locally at $0.

The supervisor launched at about 20:03Z under `caffeinate -i`.

## 2026-10-03 UTC — Run complete

The supervisor exited at 02:04Z:
- 39 invocations, with 1,536 of 1,536 results;
- 8 of 8 replays matching, and 39 of 39 audits;
- no recorded mismatch, no unresolved reservation, and no stop;
- 21,624.26 s charged of 30,000 s (forecast about 19,600 s).

The study is technically complete.

## 2026-10-03 UTC — Analysis complete; no test met

`tools/discovery_continuation_analyze.ts analyze` ran once (38 s) and wrote `analysis-v1/report.json` (SHA-256 `017d63dc206cefa42419369fac0b1243c04a7e3fca01e54bb4713efaf9f791cc`).

| Founder | Certified seeds | Late-certified seeds | Reading |
| --- | ---: | ---: | --- |
| cluster-33 | 5/8 | 5/8 | not met |
| cluster-4 | 3/8 | 3/8 | not met |
| cluster-139 | 4/8 | 2/8 | not met |
| cluster-16 | 1/8 | 0/8 | not met |

Descriptive pooled block rule: 7/8 blocks, mean 0.170, bootstrap [0.119, 0.218].

A fresh-context reviewer re-derived everything in exact arithmetic from the raw files. That included every ancestor from the checkpoint chains and every null genome. The verdict was CONFIRMED-WITH-QUALIFICATIONS, with no numerical discrepancy (largest difference 2.2e-16; `analysis-v1/review.json` SHA-256 `600794f4…2268`, script `analysis-v1/review-rederive.py`). Its qualifications are incorporated in the findings. They cover the wording of *not met*, power, noise in N, the certified/late-certified distinction and replay coverage. It also found two table cells mis-rounded by at most 0.0054; both are corrected.

**Decision.** This applies the protocol's fixed table to cluster-33's *not met*.
- **The result is inconclusive.** It is not evidence of a stall, and it cannot support the physics-change pivot.
- **The cluster-16 clause is not triggered.**
- **M4 proceeds by the direct route:** the fresh ensemble under the 2026-09-29 growth contract, which the user adopted on 2026-10-02 in place of the withdrawn endpoint-2 draft the protocol names.
- **The launch decision is the user's.** It also covers:
  - the spots-m3 allocation;
  - envelope adequacy;
  - the development rehearsal, which ended incomplete at 2 of 12 histories (`experiments/m4/rehearsal-v1/execution.md`).
