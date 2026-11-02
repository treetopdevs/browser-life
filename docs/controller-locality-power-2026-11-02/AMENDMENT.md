# Amendment 1 (2026-11-02): I05b power-up of the controller-locality assay

Status: written and committed BEFORE any edited genome of this panel was assayed, and before `freeze.json` existed (the freeze binds the SHA-256 of this file). Nothing below was chosen after seeing a mutant outcome of the new panel; the only outcome-like numbers used are PR136's, which are already public (`docs/controller-locality-2026-11-01/`). Exploratory, CPU only, no GPU evidence. Local, off the deployed site.

Scope as given by the coordinator (task text; decision D12 is in `docs/backlog-run-2026-11-01.html`, D14 is quoted from the task text and is not in that file): I05 (PR136) ended inconclusive (underpowered): only 1 of 24 assayed edits improved a response for each M3 genome, against the pre-stated minimum of 5 improving edits (`RULE.minImproving`), and its EVIDENCE.md says assayed edits stayed at 24 per genome though runtime allowed more. This slice re-asks the same question with enough assayed edits for the unchanged rule to be able to decide.

## 1. What does not change

- Genomes: M3 cluster 4 (sparse slot) and M3 cluster 9 (dense slot), the two genomes of PR136's verdict. The hand-built generalist stays a positive control only (sensitivity check, neutral fixtures, tau); it does not vote. The candidate lists are singletons (`sparse [4]`, `dense [9]`): if a genome fails the viability gate under the new seeds there is no substitution (no c10, no c16). The existing rule then applies: no qualifying genome is `measurement-limited`, one is a single-genome `inconclusive`.
- Operator: `mutateInPlace` through `editFromSlots`, magnitudes 6 and 24, matched multi-locus shapes (2 x 12, 4 x 6).
- Neighbourhood families: single6, single24, multi2, multi4 (the equal-slot-count secondary family never entered the rule and is not emitted in this panel).
- Scenarios, `ASSAY` values (tile 16, radius 3, horizon 200, founder, scenario parameters, gate 1000 / 250, `viableFloor` 500) except `seeds`; tau formula; `RULE` in full (deep-equality tests against PR136's recorded `protocol.rule` and the code constant). No threshold is moved.
- No physics, schema, golden or `RULE_VERSION` change. Protected paths are checked with `git diff --exit-code e56077bd`.

## 2. Fixed N, no optional stopping

**N = 192 assayed genuine non-duplicate edits per M3 genome** (8 for the generalist, as in PR136). The set is drawn and committed before the run (`freeze.json`); the run assays exactly that set once. A crashed or failed run is rerun from scratch with the same frozen set. The set is never extended, reduced, re-drawn or cherry-picked after any outcome; a defect found before the run restarts from the freeze commit with a new dated amendment.

### 2.1 Why 192: a power argument from PR136's observed rate

PR136 observed A / N = 1/24 (4.2 percent) improving edits per genome. Illustrative model: A ~ Binomial(N, p) per genome, independent genomes. The model is illustrative, not a guarantee: the real draw is stratified without replacement, loci recur across the two magnitudes, and multi-locus edits share constituents (PR136 PLAN 2.5 noted these dependencies). Exact rational values (reproduced by `binomialAtLeast` in `packages/lineage/src/locality/panel.ts` and pinned in `packages/lineage/test/locality-power.test.ts`):

| true improving rate p | P(A >= 5), N = 192, one genome | both genomes | N = 144, one genome | both | N = 24 (PR136), one genome |
|---|---|---|---|---|---|
| 6 percent | 0.990 | 0.982 | 0.937 | 0.878 | 0.012 |
| 1/24 (PR136) | **0.905** | **0.819** | 0.720 | 0.519 | 0.0027 |
| 3.5 percent | 0.804 | 0.647 | 0.569 | 0.324 | 0.0013 |
| 3 percent | 0.685 | 0.469 | 0.434 | 0.188 | 0.0006 |
| 2 percent | 0.339 | 0.115 | 0.163 | 0.026 | 0.0001 |

At the rate PR136 saw, the probability that A >= 5 on both genomes (so that the rule can leave its underpowered branch) is **0.82 at N = 192**, and under 0.01 at N = 24. N = 240 would give about 0.95 but is not affordable in the budget below. Power below p of about 3 percent is low: a second `inconclusive (underpowered)` is a legitimate outcome and is reported as such.

### 2.2 CPU budget and the deterministic choice of N

Budget: about 20 minutes on a loaded machine. Rule, applied to a baseline-only timing and fixed in code (`chooseN` in `tools/locality/power.ts`): N = 192 if the projected total is at most 1200 s, else N = 144 if that is, else stop and report without running (no third size). The timing workload is `power.ts --calibrate`: the start-genome baseline assays of the generalist, M3 c4 and M3 c9 under both seed pairs (36 runs) and one probe of each, median of 3 serial repetitions; it has no code path that assays an edited genome (a test asserts `mutantAssays` is 0 and the run count is 36). Projection = counted work times the median per-run and per-probe cost, where the counted work is 6 runs per assayed edit, the baselines, 100 runs for fixtures and slack, and every probe (each generated edit once, plus the null replicates).

Measured while writing this amendment on a machine at load average 20 to 30: about 0.13 s per run, 0.009 s per probe. Projection: **about 340 s at N = 192 and 270 s at N = 144 (freeze.json records its own re-measurement)**, both well inside 1200 s, so N = 192 is chosen. `freeze.json` re-measures and records the same numbers; the choice follows by the rule. Timing is provenance, not part of any deterministic payload.

**The worker pool of PLAN 3.3 is not built**: its own condition ("only if the serial projection exceeds the budget") is not met. `--workers n` is accepted, recorded in the manifest as requested 1 or 2 and used 1, and has no effect; serial is the reference path. The PLAN's 1-versus-2-workers equality test therefore does not exist.

### 2.3 What A >= 5 does and does not buy

`decide()` is unchanged. A >= 5 on both genomes moves the rule out of the `underpowered` guard into `broadly-useful`, `entanglement-signal`, or the residual `inconclusive` (the genomes disagree or neither rule is met). That residual `inconclusive` is a decided outcome of the rule, distinct from the underpowered one, and is reported as such.

- `broadly-useful` additionally needs K >= 10 percent of assayed genuine edits, i.e. K >= 20 at N = 192 (K >= 15 at 144), and K >= half of A, and a multi-locus clean share within 5 points of the single-locus one. Under the binomial model at p = 1/24, P(A >= 20) is 0.0002 at N = 192 (P(A >= 15) is 0.0011 at N = 144). A `broadly-useful` call is very unlikely unless the true improving rate is several times PR136's.
- `entanglement-signal` needs, on both genomes, collateral C >= half of A, median breadth (over all generated genuine single-locus w1/b1 edits, doubled units) >= 6 (3 actuators) and >= null + 2. An outcome-free preflight at freeze (`breadthUpperBound2` in `freeze.json`: the median of the wiring bound popcount of structurally reachable actuators over those edits, which bounds the realised breadth from above) gives **2 for M3 c4**: c4 cannot reach the breadth threshold on any outcome, so `entanglement-signal` is **unreachable on this pair**. For c9 the bound is 16 (reachable by the bound). This panel therefore cannot show entanglement and must not be advertised as able to; the achievable aim is to turn `inconclusive (underpowered)` into a mechanically decided `inconclusive (neither rule met)` or `broadly-useful`, and to report A, C, K with the finite-panel counts. Testing entanglement would need a different genome or a rule change, each a separately versioned protocol (not done here).

### 2.4 Pre-stated reading of the result for the go/no-go

- `broadly-useful`: no-go for an architecture fork; better search and incentives first (the page's own wording).
- `entanglement-signal`: advisory go for a separate, separately versioned study of a representation fork (unreachable on c4, so not expected).
- `inconclusive` (any branch), `measurement-limited`: no-go on this evidence; not a refutation. If still underpowered (A < 5 on a genome) RESULT.md says so and does not turn the low rate into a null.
- **Go is unreachable on this pair.** The only go outcome is `entanglement-signal`, which cannot occur here (section 2.3, c4 bound 2), so every possible outcome (`broadly-useful`, `inconclusive`, `measurement-limited`) maps to no-go by construction. RESULT.md and the page must say this plainly: the no-go is the design's only available reading, not evidence against an architecture fork, and the panel's real output is A, C, K and the mechanically decided rule outcome.
- In every case exploratory and bounded to these two genomes, the one-step operator, the 26,244-point probe grid and the three 16x16 tiny-world biomass assays; any controller-layout change needs its own versioned plan, migration and CPU/WGSL parity.

## 3. The larger neighbourhood and the allocation rule

New panel `power-v1` widens only the draw counts of the same families: single-locus slots per kind `w1 40, b1 8, w2 32, b2 8` (the b kinds exhaust their pools) plus the 3 physics slots, both magnitudes, sign by counter draw; `drawsPerMulti` 64 for multi2 and for multi4.

**Allocation rule (a structural rule written before any pool was counted; not tuned on PR136 improvement counts).** Equal share N/4 for each family (single6, single24, multi2, multi4). Within a single-locus family the share is split over w1, b1, w2, b2, physics proportionally to the ELIGIBLE pool sizes by largest remainder (ties by that order). A kind is capped at its pool and the deficit moves to w1 of the same family, then w2, b1, b2, physics while capacity remains. A multi family takes min(share, pool); its deficit moves to the other multi family, then to w1 of single24, then of single6. If the total cannot be placed the freeze stops. The allocation is recomputed from the saved rows by `--check` and must equal the frozen one.

Pools (genuine non-duplicate edits per stratum; "eligible" excludes edits whose genome hash occurs among PR136's edits of the same start genome, see section 4) and the rule's output at both sizes:

| stratum | c4 generated | c4 eligible | c4 N=192 | c4 N=144 | c9 generated | c9 eligible | c9 N=192 | c9 N=144 |
|---|---|---|---|---|---|---|---|---|
| single6/w1 | 40 | 36 | 22 | 16 | 40 | 37 | 23 | 17 |
| single6/b1 | 8 | 4 | 2 | 2 | 8 | 6 | 4 | 3 |
| single6/w2 | 32 | 31 | 19 | 14 | 32 | 28 | 17 | 13 |
| single6/b2 | 8 | 7 | 4 | 3 | 8 | 4 | 3 | 2 |
| single6/physics | 2 | 1 | 1 | 1 | 3 | 2 | 1 | 1 |
| single24/w1 | 40 | 36 | 22 | 17 | 40 | 36 | 23 | 17 |
| single24/b1 | 8 | 6 | 4 | 3 | 8 | 7 | 4 | 3 |
| single24/w2 | 32 | 31 | 19 | 14 | 32 | 26 | 17 | 13 |
| single24/b2 | 8 | 4 | 3 | 2 | 8 | 4 | 3 | 2 |
| single24/physics | 2 | 0 | 0 | 0 | 3 | 2 | 1 | 1 |
| multi2/multi | 63 | 63 | 48 | 36 | 64 | 64 | 48 | 36 |
| multi4/multi | 58 | 58 | 48 | 36 | 64 | 64 | 48 | 36 |

The generalist (control, 8 edits: single24 w1 2, w2 2, b1 1, b2 1, physics 1, multi2 1) has enough eligible edits in every stratum except single24/physics (eligible 1, needs 1), which is enough.

The frozen allocations (checked against `freeze.json` by a test):

```json
{
 "m3-c4": {
  "144": {
   "multi2/multi": 36,
   "multi4/multi": 36,
   "single24/b1": 3,
   "single24/b2": 2,
   "single24/w1": 17,
   "single24/w2": 14,
   "single6/b1": 2,
   "single6/b2": 3,
   "single6/physics": 1,
   "single6/w1": 16,
   "single6/w2": 14
  },
  "192": {
   "multi2/multi": 48,
   "multi4/multi": 48,
   "single24/b1": 4,
   "single24/b2": 3,
   "single24/w1": 22,
   "single24/w2": 19,
   "single6/b1": 2,
   "single6/b2": 4,
   "single6/physics": 1,
   "single6/w1": 22,
   "single6/w2": 19
  }
 },
 "m3-c9": {
  "144": {
   "multi2/multi": 36,
   "multi4/multi": 36,
   "single24/b1": 3,
   "single24/b2": 2,
   "single24/physics": 1,
   "single24/w1": 17,
   "single24/w2": 13,
   "single6/b1": 3,
   "single6/b2": 2,
   "single6/physics": 1,
   "single6/w1": 17,
   "single6/w2": 13
  },
  "192": {
   "multi2/multi": 48,
   "multi4/multi": 48,
   "single24/b1": 4,
   "single24/b2": 3,
   "single24/physics": 1,
   "single24/w1": 23,
   "single24/w2": 17,
   "single6/b1": 4,
   "single6/b2": 3,
   "single6/physics": 1,
   "single6/w1": 23,
   "single6/w2": 17
  }
 }
}
```

**Estimand change, declared.** The multi-locus share of the assayed set is 96/192 (PR136: 6/24 per genome) and physics edits fall to 1 or 2 of 192 (PR136: 2/24); both PR136 improvements were multi2 edits, so a larger multi share could raise A. The allocation follows the structural rule above, not those counts, but the effect exists. The verdict uses unweighted A, C, K and the unweighted multi-versus-single clean shares, and the breadth median includes unassayed edits, so the same numeric thresholds apply to a different mixture. This is "the same rule read on a larger, differently mixed, fresh panel"; the result is a statement about this panel's eligible neighbourhood, not about PR136's. Inverse-probability-weighted estimates (eligible population over chosen, per stratum) are reported alongside.

## 4. New disjoint seeds, fresh edits, eligibility

- Assay seeds `[101, 102]` (PR136: `[1, 2]`); same count, so the `3 x seeds` term of tau and the viable floor keep their meaning.
- Neighbourhood and selection salt `0x1c0de06` (PR136: `0x1c0de05`); degree-matched null replicate tags prefixed `power:` (`power:<genome>:null:<r>`).
- Every edit whose genome hash occurs anywhere in PR136's 94-edit neighbourhood of the same start genome (assayed or not) is excluded from the draw: zero inclusion probability. The evidence records `generated` (full, includes the excluded rows; used for breadth and descriptors) and `eligible` per stratum; selection, weighting and the population recomputation in `--check` use the same predicate; the exclusion lists are stored verbatim in the panel record, so `--check` does not need PR136 to recompute them (it compares them to PR136's saved hashes when present). Estimates describe the eligible complement.
- Tests: seeds disjoint, salt different, null namespace different, no assayed hash shared with any PR136 row; independent negative fixtures (overlapping seeds only, equal salt only, equal namespace only, one overlapping hash only, each failing for its own reason).
- Baselines, gate and tau under the new seeds are computed from baselines only (the same code) at freeze and written to `freeze.json`. They are baseline facts, not mutant outcomes.

## 5. The new panel is read on its own

PR136's 24 edits are NOT pooled: different seeds hence different baselines, tau and gate, and a different neighbourhood. No cross-panel statistic enters the decision. The page and RESULT.md show the two panels side by side only.

## 6. Procedure and guards

1. Library parameterisation (`Panel`; `PANEL_V1` is today's constants and PR136 `--replay-check` stays byte-identical, gate passed before this amendment: 59 s under Deno). Because `tools/locality/matrix.ts --check` hashes the locality sources, adding `panel.ts` and editing the others changes those hashes: only `manifest.sources` of PR136 is re-pinned, after the replay proved `evidence.json` byte-identical. `evidence.json` and its seal are untouched.
2. `power.ts --freeze` writes `freeze.json` (sealed): N, allocations at both sizes, panel record with exclusion lists, baselines, gate, tau, chosen edit ids and hashes, fixture inventory, preflight, timing, SHA-256 of this file, of PR136's `evidence.json` and of the source closure (library, `genotype.ts`, `tools/locality/matrix.ts`, `tools/locality/power.ts`).
3. A Codex Sol 6.1 xhigh review of this amendment and the freeze; defects fixed; then ONLY the freeze files (this amendment, PLAN.md, REVIEW.md, `freeze.json`, the code and tests, PR136's re-pinned manifest) are committed and pushed to `claude/i05-power`. No outcome file is in that commit.
4. `power.ts --write` refuses if `freeze.json` is missing, its seal fails, any frozen input or source differs from its frozen hash, any of them differs from `HEAD`, the freeze commit is not an ancestor of `origin/claude/i05-power`, or `evidence.json` exists. Before the first edited genome is assayed it rebuilds the neighbourhoods and asserts that the drawn ids and hashes equal the frozen set. It writes `evidence.json` and `manifest.json` once.
5. `--check` (no simulation: seal, freeze match, exact fixture inventory, recomputation of every derived field, the allocation from the eligible pools, disjointness, the verdict) and `--replay-check` (regenerate and require byte equality). The verdict is `decide()` on the saved rows, applied mechanically; RESULT.md reports A, C, K, the verdict, the go/no-go of section 2.4, deviations.
6. Page: `/controller-locality/` gets a panel selector and a side-by-side table. No physics, schema or golden change; no paid calls; no deploy.

## 7. Limits

Biomass responses are not independent capabilities (as in PR136). Short horizon (200), tiny tile, two seeds, one-step operator, two genomes. Not a claim about evolved creatures in general. Even with A >= 5 the go/no-go is advisory.

## 7. Disclosure: pre-commit harness runs

While building the post-run check harness (before this amendment and `freeze.json` were committed), a reduced N = 4 panel was assayed three times under the production seeds and draw salt, so 4 of the 192 edits per M3 genome and the 8 control edits were assayed in those harness runs. The N = 4 allocation was empty for the first two runs (a harness defect, fixed) and 4/4 in the last. Those outputs lived only in temp dirs and were not used for any choice: N, the allocation rule, the draw and the decision rule are fixed by this document and the freeze, none read an outcome, and the only value looked at was the verdict kind of the N = 4 payload (`inconclusive`). The harness now uses its own draw salt and excludes every edit of the real panel from its draw (and asserts that none it assays belongs to the real panel), so nothing further of this kind can occur. The real run is the single reading of this panel.
