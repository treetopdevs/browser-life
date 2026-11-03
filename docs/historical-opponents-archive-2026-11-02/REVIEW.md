
## Plan review dispositions

Reviewer: Codex Sol 6.1, xhigh, read-only, 2026-11-02. Raw output: `/tmp/historical-opponents-archive-2026-11-02-plan-review.out.txt` (final message) and `.raw.txt` (full transcript); prompt `/tmp/historical-opponents-archive-2026-11-02-plan-review.md`. Verdict on v1: do not freeze. PLAN.md is now v2. I verified findings 1 and 2 directly (born ranges 8-79, 5-297, 5-79 against evaluated 1280/4800/1280; `assay.ts` source enumeration and `--check` rejection).

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | `born` is a batch index, so evaluation-index bins put every elite in bin 0 | Accepted, verified. Bins now over horizon `H = max(born)+1` batches; all "evaluation index" wording corrected; a regression test uses the real ranges. |
| 2 | P1 | New file in `packages/metrics/src/opponents/` breaks the first rung's `--check` | Accepted, verified. Library moved to `packages/metrics/src/archive-tournament/index.ts`; test that first-rung `--check` passes with it present. |
| 3 | P1 | Permutation null not exchangeable (final survivors, related genealogy) | Accepted. Statistic demoted to descriptive rank `r_dir`, never called significant; scope stated as selected surviving elites. |
| 4 | P2 | Sources not independent; search seeds 1..300 overlap scoring seeds 201..210 | Accepted. Sources called related histories, no replication reading, `shared-genome` flag, scoring seeds 1001..1010, screen seeds 901..903, reserve block B 2001..2010. |
| 5 | P1 | Multiplicity reopened; Bonferroni makes a 4-snapshot source unable to reach significance | Accepted. No per-source significance test; confirmatory gates are instrument controls only; everything else exploratory. |
| 6 | P2 | strength-not-time not a real separation; vigour-only aligned archive passes | Accepted. Pure-matrix gate with frozen scrambled order of rank above 0.20 (candidate order from review rejected), added `vigour-only` fixture and `directional-vigour-only` label. |
| 7 | P2 | Cycles of length above 3 pass; precedence rows 5 and 6 contradict; 3-node fixture cannot show rejection | Accepted. General directed-cycle detector, `long-cycle-fools-naive` fixture, cycle is an independent graph flag, K=3 fixture only validates the flag. |
| 8 | P2 | "Confirmed edge" misstated; `edgesFromPayoffs` uses mean offset only | Accepted. Graph built from `PairSummary.edge` with the first rung's full rule. |
| 9 | P2 | Arbitrary archive weakening not a calibrated positive control | Accepted. Calibrated G/W is the gate; archive-genome weakening descriptive with solo viability; planted-chain uses calibrated instrument genomes. |
| 10 | P2 | Extinction rule weaker than the first rung (undefined denominator) | Accepted. Denominator is all scheduled pairs; any uninformative pair gives `partial-tournament`; mask moves with the snapshot in permutations. |
| 11 | P2 | `--freeze-check` does not freeze the analysis code | Accepted. Frozen path-to-SHA inventory of all scientific files; test mutates code after a temp-repo freeze; analysis-affecting amendment requires block B seeds. |
| 12 | P2 | Source compatibility undefined; arena differs from source configs | Accepted. Decidable gate (decode, `validateConfig`/`validateState` in arena config) and differences recorded as transfer conditions; `exact:false` resume of `bootstrap-200` recorded. |
| 13 | P2 | Wall-clock guard does not bound CPU; cumulative cost understated | Accepted. Cumulative CPU budget (cap 3 CPU-hours per command, target under 2 total), screen cost included, sampled replay allowed if needed, cut order retained. |

No P3 findings were raised. Scope note: v2 is deliberately a descriptive tournament; confirmatory historical-improvement claims would need sampling that records snapshots during the run and a selection-aware null, which is out of this slice.

## Freeze review (Sol 6.1 xhigh, read-only, 2026-11-02, IMPLEMENT stage, before the freeze commit)

Raw: `/tmp/i03-freeze-review.out` (final message), `/tmp/i03-freeze-review.raw`; prompt `/tmp/i03-freeze-review.md`. Verdict on the draft: hold the freeze; 1 P1, 6 P2, 1 P3. All accepted and fixed before the freeze commit (the library, CLI and tests were re-run after the fixes; no second review pass).

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P1 | Freeze inventory omitted stats.ts, schema and sim-ref sources, PLAN and calibration | Fixed: `frozenFiles()` now includes them. |
| 2 | P2 | `--check` did not establish freeze provenance | Fixed: `checkSaved` runs `freezeCheck` against the manifest (real tree) and validates the freeze commit shape (copied trees). |
| 3 | P2 | Sampled replay skipped full verification; full replay spent seeds before reading evidence | Fixed: `replayCheck` runs `checkSaved` first for both branches and refuses without evidence. |
| 4 | P2 | A partial planted chain could pass the amended gate | Fixed: all scheduled chain pairs must be informative; test added. |
| 5 | P2 | `screens[].viable` trusted over counts | Fixed: counts validated and the flag recomputed with the floor rule; tests added. |
| 6 | P2 | Mini test asserted `assayOk` with a 3-member chain (floor 1/6) | Fixed: mini chain has four members; the test checks the machinery only. |
| 7 | P2 | Pre-freeze tests used reserved scoring seeds 1001/1002 | Fixed: test-only seeds 7001/7002. Disclosure: the first version of the mini and arena tests (G vs 80%-weakened G, twin F1) ran with seeds 1001 and 1002 at 60 steps before this fix, and one full mini run used them (60-step mini, not 300-step scoring runs); the outputs were only checked for crashes and were not read as outcomes. |
| 8 | P3 | Amendment overstated calibration (six of seven at 1/24) | Fixed in PLAN.md. |

## Final review (Sol 6.1 xhigh, read-only, after scoring, 2026-11-02)

Raw: `/tmp/i03-final-review.out`. No P1. Freeze intact (39 inventory files identical to 2a012b9f), `--check` with RUNS and the first-rung checker pass. P2 page text overstated the residual ("explained by vigour"): fixed (cutoff wording). P2 descriptive weakened-copy row showed a fabricated pass: fixed (`n/a (descriptive)` plus a caught column; e2e asserts it). P3 largest b200 offset 0.415 not 0.37: fixed in EVIDENCE.md. P3 fixture count (five pure plus chain): fixed.

## Source review dispositions

No P1 or P2 findings, so no follow-up Codex review was run.

| Finding | Reviewer | Disposition | Evidence |
|---|---|---|---|
| Source-switch e2e passes with stale results (P3, tests/e2e/opponents-archive.spec.ts) | sol | Fixed. The spec now loops over all three sources (m3, b200, div) and asserts, per source, the label text, matrix column and row headers, observed D, residual-free rank, and the first-column payoff against evidence.json. | Removing the `change` listener in page.ts makes the spec fail (toHaveText on matrix headers); restored, it passes. |
| Dead `${ex ? '' : ''}` and missing excluded count in uninformative cells (P3, render.ts) | claude | Fixed. Uninformative text now ends with the excluded count ("N of M blocks excluded"). | apps/lab/test/opponents-archive-render.test.ts asserts "7 of 10 blocks excluded" for an uninformative cell; vitest passes. |
| Ungrammatical b200 offset sentence in EVIDENCE.md (P3) | claude | Fixed. Reworded to "offset 0.415 exceeds the mean twin place effect 0.093". The numeric claims were otherwise verified by the reviewer. | EVIDENCE.md line 21; archive evidence test (tools/test/opponents-archive-evidence.test.ts) still passes. |

Checks rerun: opponents-archive-render and opponents-archive-evidence vitest, pnpm typecheck, Playwright opponents-archive spec (chrome, port 5331).
