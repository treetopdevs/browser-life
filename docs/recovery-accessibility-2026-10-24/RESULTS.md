# Recovery accessibility: first 32 pairs

Date: 2026-10-24. **NO-LEAD-IN-FIRST-32. Stop; extension not earned.**

The fixed founder-0 / mutant-138 comparison did not reproduce the retrospective lead. Both recovered in 28/32 fresh matched trials, with four mutant-only wins and four parent-only wins. This is a futility-screen outcome, not proof that improvement is impossible. No second candidate, changed endpoint, retry, or extension was run.

| Measure | Parent | Mutant |
|---|---:|---:|
| Legacy regeneration | 28/32 | 28/32 |
| Clean recovery | 28/32 | 28/32 |
| Survival | 32/32 | 32/32 |
| Light dependence | 32/32 | 32/32 |
| Low-threshold sensitivity recovery | 28/32 | 28/32 |
| High-threshold sensitivity recovery | 28/32 | 28/32 |

All 32 pairs had eligible targets. Median mutant/parent pre-lesion target mass was 0.9891774814 (required at least 0.8). Viability and target-mass gates passed. Both gain gates failed: zero additional recoveries, versus the required two. The exact paired tail is 163/256 = 0.63671875 for both endpoints, descriptive only at this screening stage; no final 128-pair significance claim is made.

## Assay validation and a limitation

- Engineering controls passed: founder 4/4 legacy recoveries, generalist 0/4.
- Two calibration replays and all four scientific replay cases matched their original payloads and seven checkpoint hashes exactly.
- Every accepted case passed identity/configuration, checkpoint, exact matter/energy conservation, trace and outcome validation. A separate post-run reader revalidated the campaign successfully. Independent read-only Sol 6.1 High review confirmed the counts, replay equality, all 546 checkpoint file hashes, observation cadence, recorded zero residuals, absence of failure/extension artifacts, and the stop decision.
- All eight failed scientific cases removed 55.2–59.2% of original target mass, outside the registered 20–50% clean-recovery band. In all eight, the tracked remnant was also lost; these are not merely score failures caused by the clean-recovery cutoff. The 56 successful cases met the clean criteria.

This pattern suggests that actual damage severity deserves attention before another search. It does **not** establish causation or justify excluding failures, changing the lesion, or rerunning this candidate under revised thresholds. Any subsequent damage-controlled assay needs a new prospective protocol. The assay passed its stated validation gates, but this batch gives no evidence of a recoverability advantage for the chosen mutation, autonomous reproduction, or sustained evolution.

## Execution and provenance

- Implementation commit: `83bbcd3` on `codex/recovery-accessibility`.
- Frozen manifest SHA-256: `8c68136f8e68f551a8ec5f34a93349c729ef0268ad7e2182c6fd2431877dc1f7`.
- Hardware: local Apple M1 Max; Deno 2.9.7. One GPU lane; no cloud spend.
- Engineering seeds: 2026102301–2026102304. Scientific seeds used: 2026102401–2026102432. Reserved seeds 2026102433–2026102528 were not run.
- 78 accepted cases: eight controls, two control replays, 64 scientific cases, four scientific replays; 546 phase checkpoints. No retries or partial failures.
- Budgeted execution: 813,240 ms (13 min 33.240 sec) of 60 minutes. Output tree after independent reread: 474,208,510 bytes (about 452 MiB), below 2 GiB. Standalone development tests and post-run inspection are outside that runner counter.
- Calibration had projected 2,704,833 ms and 1,890,513,791 bytes for the full possible campaign; both were within cap. The scientific gain stop, not the resource cap, ended execution.

Local evidence (gitignored bundles retained in this checkout):

- [Manifest](../../runs/recovery-accessibility/v1/manifest.json)
- [Calibration](../../runs/recovery-accessibility/v1/calibration.json)
- [32-pair summary](../../runs/recovery-accessibility/v1/summary-32.json)
- [Case records](../../runs/recovery-accessibility/v1/cases-32.jsonl)
- [Generated readout](../../runs/recovery-accessibility/v1/readout.md)
- [Budget](../../runs/recovery-accessibility/v1/budget.json)

See [implementation validation](IMPLEMENTATION.md), [fixed protocol](PLAN.md), and [prior-work audit](../recovery-improvement-prior-art-2026-10-24.md).
