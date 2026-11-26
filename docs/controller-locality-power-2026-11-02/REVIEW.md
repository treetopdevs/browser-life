# Review log: I05b controller locality power-up

## Plan review dispositions

Reviewer: Codex Sol 6.1 xhigh, read-only. Raw output: `/tmp/controller-locality-power-2026-11-02-plan-review.out.txt`; final message: `/tmp/i05p/plan-review-final.txt`. Prompt: `/tmp/controller-locality-power-2026-11-02-plan-review.md`. PLAN.md revised accordingly. Review checked that the binomial probabilities in the plan are arithmetically correct, that the named APIs exist, and that re-pinning PR136 `manifest.sources` does not break its seal.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P1 | `entanglement-signal` unreachable for c4 (structural breadth <= 1 for most w1/b1 edits; rule needs median >= 3 actuators on both genomes) | Accepted. PLAN 2.2 adds an outcome-free freeze preflight and states up front that entanglement is untestable on c4; the go/no-go says so. Genome swap and rule change stay out of scope (separately versioned). |
| 2 | P1 | Power target A >= 5 ignores K >= 10% of assayed (K >= 20 at N = 192; P about 0.0002); "same A fraction" test claim false | Accepted. PLAN 2.2 reports reachable verdicts and P(A >= 20); aim restated as turning underpowered into a mechanically decided result; tests reworked with positive/boundary fixtures; false claim removed and replaced by an N = 24 vs 192 pin. |
| 3 | P2 | Allocation (multi 78/192, physics 2/192) changes the estimand and is outcome-informed; IID binomial is illustrative | Accepted. Declared in PLAN 2.4 and 2.2; allocation by a stated structural rule written before preflight; probabilities labelled illustrative; weighted estimates reported alongside. |
| 4 | P2 | PR136 hash exclusion conflicts with the population checker; some pools are short (c4: 4, 4, 0) | Accepted. Generated vs eligible populations, shared eligibility predicate, deficit rule frozen with final allocation (PLAN 2.5). |
| 5 | P2 | Panel omits candidate lists and null namespace; `nullBreadths()` hard-codes tags | Accepted. Panel gains `candidates` (singleton c4, c9) and `nullNamespace`, threaded through `nullBreadths()` and `runStudy`; tests for no-substitution gate failure and actual null seeds (PLAN 3.2, 2.1). |
| 6 | P2 | Negative fixtures can be vacuous; empty neutral-fixture set passes; `decide()` trusts `underpowered` | Accepted. Independent negatives for seed/salt/hash overlap; exact fixture inventory in the power checker; verdict fixtures built from consistent rows (PLAN 5 / 3.1). |
| 7 | P2 | 144 fallback and timing gate not frozen; calibration before amendment | Accepted. Amendment first with both allocations, baseline-only timing workload with a test that no mutant is assayed, deterministic N rule, stop condition (PLAN 6.2). |
| 8 | P2 | Source hashing omits `power.ts`/`pool.ts`; self-referential commit hash | Accepted. Own source closure incl. runner and worker; freeze binds to input/source hashes, commit resolved externally (PLAN 3.2, 3.5). |
| 9 | P2 | Worker-count equality not in gates; test deadlines (60 s / 600 s) vs 20 min run | Accepted. Explicit `--workers 1` and `2` replay gates, explicit deadlines; pool built only if serial projection exceeds budget (PLAN 3.3, 6). |
| 10 | P2 | Protected-file gate does not fail on diffs; protected set incomplete | Accepted. `git diff --exit-code e56077bd` over schema, sim-ref, sim-gpu, preregistration, FROZEN, rules.md. |
| 11 | P3 | Page row count wrong (310 not 1000); static import; no stratum filter exists | Accepted (PLAN 3.7). Measure first; add filter explicitly. |
| 12 | P3 | D14 absent from backlog log (ends at D13) | Accepted. PLAN header cites only D12 from the file and says D14 comes from the coordinator's task text. |

Not changed: the review judged baseline-only tau recomputation, all-hash exclusion and not pooling defensible.

## Source review dispositions

Reviewer: Claude (source review of the implementation, pre-freeze). All five accepted.

| # | Sev | Finding | Disposition | Evidence |
|---|---|---|---|---|
| 1 | P2 | Post-run check path (`powerProblems`, `checkPower`, `replayCheck`, verdict recomputation, manifest binding) untested until `evidence.json` exists; sources are hash-frozen so a later fix would void the freeze | Fixed. New `tools/locality/power-reduced.ts` builds an N = 4 payload with a synthetic freeze in a temp dir and runs all of them (including negatives: dropped assayed row, changed seeds, wrong freeze hash, emptied exclusion list, missing freeze, altered file under replay). The vitest test runs it as a Deno subprocess (about 2 min). Building it exposed a real defect: `planFreeze(cal, 4)` silently produced empty allocations because allocations were only computed for 192/144; now a forced size gets its own allocation. `generate` and `replayCheck` take optional freeze/evidence paths. | `deno run -A --no-lock tools/locality/power-reduced.ts` prints `--reduced ok`; the real freeze was regenerated from the same calibration and differs from the old one only in `sources[power.ts]`, `inputs.amendmentSha256` and the seal (n = 192, allocations and plans unchanged); `--freeze-check ok` |
| 2 | P3 | Undocumented `--no-remote-check` bypassed the pushed-ancestor guard that AMENDMENT 6.4 says `--write` enforces | Fixed. Flag removed; `--write` calls `writeRefusals()` with the default `requirePushed: true`. Tests reach the unguarded path only through the `writeRefusals` argument. | `grep no-remote-check tools/locality` empty; write-guard tests pass |
| 3 | P3 | Static page text promised two panels and no pooling even when only one panel was loaded | Fixed. Heading and prose come from `summaryIntro(panels)`; the one-panel text says the power-up has not been run yet. | `apps/lab/test/controller-locality-render.test.ts` |
| 4 | P3 | New render logic (`panelSummaryTable`, `panelNote`, `kind` filter) untested | Fixed. Tests check A/C/K and denominators against the readouts for every genome and panel, the note text and per-genome counts, the kind filter alone and composed, and the intro. | same file, 7 tests pass |
| 5 | P3 | Only go outcome is unreachable by design; RESULT.md and the page must not present go/no-go as open | Fixed. AMENDMENT 2.4 gains a binding bullet "Go is unreachable on this pair" (every outcome is no-go by construction, not evidence against a fork); the page prints the same sentence when both panels are shown; RESULT.md must repeat it. | AMENDMENT.md 2.4; `summaryIntro` test; freeze regenerated for the new amendment hash |

Checks rerun: `pnpm typecheck`; vitest for `tools/test/locality-power-evidence.test.ts`, `apps/lab/test/controller-locality-{render,packaging}.test.ts`, `packages/lineage/test/locality-power.test.ts` (30 passed, 5 skipped awaiting evidence.json); `deno run -A --no-lock tools/locality/power.ts --freeze-check`; `tools/locality/matrix.ts --check` (PR136); the reduced-payload script.

### Follow-up review of the fixes (Codex Sol 6.1 xhigh; `review-sol-fixes.txt`)

| # | Sev | Finding | Disposition | Evidence |
|---|---|---|---|---|
| F1 | P2 | The reduced harness used the production salt and seeds, so it assayed 4 of the 192 edits per M3 genome and the 8 control edits of the real panel before the freeze commit | Accepted. The harness now has its own draw salt (0x7e57) and excludes every real-panel edit from its draw (a different salt alone redrew the same genome: the first attempt failed the new overlap assertion). `power-reduced.ts` asserts that no edit it assays is in the real freeze. The earlier runs are disclosed in AMENDMENT section 7 (nothing read except the verdict kind of the N = 4 payload; no choice depends on it). Freeze regenerated for the new amendment hash. | `power-reduced.ts` prints `--reduced ok`; freeze differs from the pre-fix one only in `inputs`, `sources[power.ts]`, seal; plans and allocations identical |
| F2 | P3 | Manifest `freezeSha256`, `n` and worker metadata unchecked by `checkPower` | Fixed. New `manifestProblems` called from `checkPower`; the reduced harness covers deleted hash, wrong n, invalid and missing worker metadata. | `power-reduced.ts` |
| F3 | P3 | Summary test could not tell reused panel statistics | Fixed. The power panel gets distinct A, C, K and verdict; rows are asserted per panel. | render test |
| F4 | P3 | "24 edits per controller" overstated the control | Fixed to "per M3 controller" in the page prose and panel label. | render.ts, page.ts |
| F5 | note | The reduced harness bypasses the `--write` / `--check` CLI dispatch, worker-metadata construction and the file write/rename | Deferred, with reason: those lines are straight-line glue guarded by `writeRefusals` (tested) and `--check` / `--replay-check` run as subprocesses after the real run; making `--write` path-injectable would add more frozen code than it covers. N = 4 also cannot reach powered verdict branches; `decide()` has its own boundary fixtures in `packages/lineage/test/locality-power.test.ts`. | none needed |

No second follow-up review was run on the small F1-F4 edits above; they are covered by the reduced harness, the render tests and `--freeze-check`.

Checks rerun after F1-F4: `pnpm typecheck`; vitest (power evidence, PR136 evidence, render, packaging, lineage power: 38 passed, 5 skipped awaiting evidence.json); `tools/locality/power-reduced.ts`; `power.ts --freeze-check`.
