# Frozen v1 cadence-identity audit — 2026-10-24

The [PR 72 finding](https://github.com/treetopdevs/browser-life/pull/72#discussion_r4368800566) is valid: the frozen v1 endpoint requires independently recovered 25-step and 50-step continuations, but does not require those continuations to retain the same component at shared observations. After a split, independent retained-ID choices can select different daughters. Two true recovery booleans alone do not establish cadence agreement.

This read-only audit compares initial labels and all 40 shared 50-step labels in every retained v1 case. Both views use the same threshold and the same physical snapshot at shared times, so component labels are directly comparable there. Labels from different times are not compared as persistent identities.

## Saved-record impact

The [machine-readable audit](audit-cadence.json) covers **78 cases**: 64 scientific genotype trials, eight calibration trials, two calibration replays and four scientific replays. It verifies the pinned manifest, all 64 scientific case-file hashes against the earlier [proposal audit](audit.json), and all **546 checkpoint file hashes**. It checks exact observation cadence before comparing labels; missing observations fail the audit.

Only the following shared observations disagree. Step is absolute; recovery begins at step 3000. `null` means the view has already lost the retained continuation.

| Frozen case | Step | 50-step label | 25-step label | Recorded R / R_clean |
|---|---:|---:|---:|---|
| science-mutant-2026102404 | 3150 | 1 | null | 0 / 0 |
| science-mutant-2026102407 | 3200 | 2 | null | 0 / 0 |
| science-mutant-2026102407 | 3250 | 4 | null | 0 / 0 |

Both cases already fail both cadence recovery checks and the frozen outcomes. They are two of the mutant's four severe-injury failures. All **56 scientific clean successes**, all calibration records/replays and all four scientific replays have shared-label agreement. There is no recorded case in which both cadence views recover while disagreeing on a retained daughter.

An additional agreement guard would therefore disqualify **zero** recorded clean successes. Parent and mutant remain 28/32 for both frozen endpoints, with four mutant wins and four parent wins, and the first-stage stop remains **NO-LEAD-IN-FIRST-32**. This is a retrospective sensitivity check, not a replacement endpoint or new scientific denominator. The original observer, protocol, manifest, checkpoints, cases and summary are unchanged.

## Future severity guard

The [severity proposal](PLAN.md#endpoints-fixed-before-launch) already requires equal retained component labels at initialization and every shared 50-step observation. Its future runtime and independent reader must both enforce that condition in addition to retained continuity, no incoming merge/fusion, and mass thresholds. Equality of two `null` labels does not rescue a lost track. Any disagreement disqualifies clean recovery and receives the proposed T=2025 penalty, with a separate cadence-disagreement reason; absent observations remain a technical stop.

Before launching that separately versioned experiment, add a fixture in which two individually recovering cadence views retain different split daughters, and require rejection by both runtime and reader. Also retain a clean agreement fixture, a transient disagreement fixture even if labels later agree, a lost/null fixture and a missing-observation fixture. Do not retrofit this guard into frozen v1 decision code or silently rewrite its outcomes.

## Reproduce without simulations

Point `V1_RUN` at the retained, unmodified v1 campaign directory, then run from the repository root:

```sh
python3 docs/recovery-severity-2026-10-24/audit-cadence.py "$V1_RUN" > /tmp/recovery-cadence-audit.json
cmp docs/recovery-severity-2026-10-24/audit-cadence.json /tmp/recovery-cadence-audit.json
```

The script only reads the source directory and prints a report. It neither advances physics nor edits inputs. It refuses a different frozen manifest, changed scientific records, incomplete/expanded case sets, invalid observation cadence or mismatched checkpoint bytes.
