# Selection mismatch: where the seven genomes left the founder funnel

2026-09-29. Completed; independent review passed. Plan: [selection audit](selection-mismatch-audit-plan-v1.md).

## Finding

The raw records support a more specific explanation than the claim that regeneration is the antagonist of evolvability. All seven later archive role-originators passed the available screening observation with 4/4 survival, regeneration and light dependence. None reached the 32-replicate M3 retest.

| Diagnostic subject | Confirmation label | Regeneration at confirmation | First observed exclusion and reconstructed reason |
|---|---|---:|---|
| 0 | a543 | 14/16 | Confirmed under the earlier gate, but below the stricter regeneration-bound requirement for admission from its strong cluster. No 32-replicate result exists. |
| 1 | a452 | 10/16 | Measured confirmation failure on regeneration; survival and light dependence were each 16/16. |
| 3 | a718 | 10/16 | Measured confirmation failure on regeneration; survival and light dependence were each 16/16. |
| 4 | a414 | 16/16 | Eligible strong-cluster member at position 56, beyond the reconstructed admission limit. Never retested. |
| 5 | a118 | 16/16 | Eligible strong-cluster member at position 30, beyond the reconstructed admission limit. Never retested. |
| 6 | a73 | 16/16 | Eligible strong-cluster member at position 14, beyond the reconstructed admission limit. Never retested. |
| 7 | a374 | 16/16 | Eligible strong-cluster member at position 53, beyond the reconstructed admission limit. Never retested. |

All five confirmation passers belong to **historical M3 cluster 2**, called cluster 3 in the diagnostic's independently recalculated clustering. The four perfect regenerators also had 16/16 survival and light dependence. They did not lose an evaluated comparison with the eventual founder: their 32-replicate outcomes were never measured.

The admission program selects only the first qualifying members of a strong cluster, preserving confirmation-row order. The historical retest does not record its `perStrong` argument. An independent reconstruction finds that four is the only admission limit matching the complete observed roster under the pinned code. This is evidence of consistency with that reconstruction, not a recovered historical command or proof of its code version.

## Why the cluster context matters

Cluster 2 was not eliminated. Its retested members c2.0, c2.1 and c2.3 each passed all three criteria in 32/32 replicates; c2.2 failed regeneration at 28/32. c2.0 won the exact tie by retest order and appears in the final founder set at index 2. That is a real ranking event, but none of the seven audited targets participated in it.

Five of the seven targets therefore do not constitute five independent missing genetic clusters. The diagnostic deliberately sampled ecological strata and several members of a cluster represented once in the founder set. Comparing its raw genome counts with the founder cohort cannot isolate the effect of the regeneration score or establish an independent-genome success probability. This audit does not identify which omitted genomes would have passed the later retest or improved a future ensemble.

## What the claim becomes

The founder pipeline omitted genomes with subsequently demonstrated role-origination potential through **both regeneration requirements and limited, order-dependent admission within a cluster**. Four omitted examples had perfect measured regeneration at confirmation. This contradicts the claim that all these examples were lost because they were poor regenerators.

The records do not identify the causal effect of the 0.5 regeneration weight in `quality()`. Every target already passed screening, and the retained history has an inexact legacy resume and no identities for quality-zero candidates. Nor do later role outcomes establish organism reproduction or unlimited evolvability. The historical Variation verdict remains recorded and does not select a new mechanism.

## Reconciliation, scope and next steps

The executable reconstruction accounts for 839 screening and confirmation records, 99 retests, 13 replication candidates and 12 pooled passers. Their ordered genomes reproduce founder-set identifier `m3-50886563ec90fb39`. The sole pooled exclusion is c23.0, with regeneration 56/64 and survival and light dependence each 64/64. All 13 focused tests and the CLI type check passed. Independent review verified the raw histories, full rosters, identities and interpretation; a separate root rerun matched all eight deterministic output hashes. See the [review record](../experiments/foundations/selection-audit-v1/independent-review.md) and [validation receipt](../experiments/foundations/selection-audit-v1/results-v3/validation-receipt.json).

Machine-readable outputs include the [observation ledger](../experiments/foundations/selection-audit-v1/results-v3/observation-ledger.json), [seven-target summary](../experiments/foundations/selection-audit-v1/results-v3/seven-summary.json), [all 16 archive histories](../experiments/foundations/selection-audit-v1/results-v3/histories.json), and [full reconciliation](../experiments/foundations/selection-audit-v1/results-v3/reconciliation.json). The [input manifest](../experiments/foundations/selection-audit-v1/input-manifest.json) pins 19 data and code snapshots. Only the 1,990 committed viable-log records are admissible historical evidence.

The immediate decision is to retain regeneration as a measured trait while investigating the broader selection policy. The evidence particularly motivates testing whether limited, input-order-dependent admission loses useful candidates. It does not yet select an alternative policy as better.

The next stages remain exactly the plan's gates: establish an operational unit and usable evaluation; prospectively validate any accessibility surrogate on separate candidates; compare minimally screened cluster-balanced random selection with accessibility-based selection from a common eligible pool, retaining the original founders as a fixed reference; then vary co-culture and seasonal context separately. Audit endpoint/proxy leakage before selection. Future logs must preserve all candidate identities and outcomes, row order, admission settings, seed/config provenance and complete resumption history.

No new simulations, founder modifications, rule changes or paid compute were performed by this audit. The material-observer limitation is unchanged. A progenote interpretation remains an analogy.

## Reproducing the audit

From the foundations workspace, run the command below with a new output directory. It reads pinned records only; no simulator or cloud access is involved.

```sh
deno run --no-lock --allow-read --allow-write tools/selection-funnel-audit.ts --manifest experiments/foundations/selection-audit-v1/input-manifest.json --out /tmp/selection-funnel-audit-new
```

`results/` and `results-v2/` are superseded development outputs. `results-v3/` is the authoritative reviewed output directory. Execution sources are preserved under `execution/` with a separate manifest. Input hashes are checked before reconstruction; discrepancies block a definitive reconstruction. Run metadata is separate from deterministic analytical outputs.

Validation resource use remained below 40 seconds for substantive audit, test and type-check commands, including development attempts and independent reruns, versus the 600-second stopping limit. Read/hash and documentation work are excluded from that command-runtime estimate. No paid compute was used.
