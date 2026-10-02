# Divergence control — decisions

The protocol is `../divergence-control-protocol.md` (frozen; never edited in place). Readable results are in `../divergence-control-findings.md`.

## 2026-10-02 UTC — Released and launched

The user authorized the release in chat after two independent read-only reviews (`reviews.json`). `release.json` (SHA-256 `0e822781…83ae`) names candidate `e125585a…77e4`. It authorizes 1,200 new competitions, 8 replays and their audits, capped at 25,000 s and 60 invocations of at most 600 s, locally at $0. Its `notStarted: true` records the state at release; the file is pinned by every invocation record and stays unchanged.

The supervisor launched at 13:34:55Z under `caffeinate -i`. All 8 replays matched their frozen originals before any new competition.

## 2026-10-02 UTC — Run complete

The supervisor exited at 17:50:34Z:

- 28 invocations, 1,200 of 1,200 results;
- 8 of 8 replays matching, and 28 of 28 audits;
- no recorded mismatch, no unresolved reservation, and no stop;
- 15,307.34 s charged of 25,000 s (forecast 15,593 s).

The study is technically complete.

## 2026-10-02 UTC — Analysis complete; four of six tests met

`tools/discovery_divergence_control_analyze.ts analyze` ran once (19 s) and wrote `analysis-v1/report.json` (SHA-256 `e72d47922ca0f95b221d78174fab537b69ef0a9d892c2f44773217d80b78638e`).

- **Test A:**
  - met for cluster-33 (8/8) and cluster-4 (7/8), both read *beyond divergence*;
  - not met for cluster-139 (6/8) or cluster-16 (2/8).
- **Test B:** met for cluster-33 `b2[PHOTO]` (8/8, mean 0.949) and cluster-139 `mu` (8/8, mean 0.477).
- **Descriptive:** the pooled block rule gives 7/8, mean 0.457, bootstrap [0.274, 0.614].

A fresh-context reviewer re-derived everything in Python from the raw files: CONFIRMED-WITH-QUALIFICATIONS, no numerical discrepancy (`analysis-v1/review.json`, script `analysis-v1/review-rederive.py`). The qualifications concern wording and are incorporated in the findings.

A post hoc description written after the analysis (`analysis-v1/post-hoc.ts`, output `post-hoc.json`, reproduced by the reviewer) splits random mutants by whether they carry the swept direction. It is not confirmatory.

Decision:

- **Supported:**
  - selection beyond divergence for cluster-33, and for cluster-4 by the fixed rule with no margin;
  - sufficiency, in the founder background, of the single swept change for most of cluster-33's and cluster-139's advantage.
- **Not supported:**
  - selection over divergence for cluster-139 or cluster-16;
  - necessity or mechanism;
  - any claim across founders.

No further simulation or assay is authorized by this result.

Counting clarification, not a change: the protocol's "480 frozen groups" counts distinct (genome pair, assay seed) configurations. The reviewer's 1,536 counts (draw, assay seed) observation groups. All are invariant under the label swap.

## Resources

Paid compute was $0 on owned hardware:

- the run: 15,307.34 s over 28 invocations;
- the engineering check: 12.49 s;
- the analysis: 19 s.
