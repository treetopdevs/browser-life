# I05b controller-locality power-up: result

Exploratory, CPU only (deterministic integer reference simulator and controller probe). No GPU evidence, no physics or schema change. Bounded to M3 clusters 4 (sparse) and 9 (dense), the one-step operator, the 26,244-point probe grid and three 16x16 tiny-world biomass assays. Frozen by `AMENDMENT.md` and `freeze.json` (pushed as commit 410eb40a before any mutant assay); the run was made once, with no rerun and no reinterpretation.

## Verdict

**`inconclusive (underpowered)`**, applied mechanically by the unchanged `decide()`:

- m3-c4: A = 3 improving edits of 192 assayed genuine edits, below the pre-stated minimum of 5.
- m3-c9: A = 4 improving edits of 192, below 5.

The power-up did what it was built to try: it raised assayed edits per genome from 24 to 192 and the improving counts from 1 to 3 (c4) and 4 (c9). It did not reach 5 on either genome, so the rule makes no statement about collateral or a broadly useful neighbourhood. The question PR136 left open is still open; the answer to "can the rule decide on these genomes at N = 192" is no.

## Counts per genome (this panel, `power-v1`, seeds 101 and 102)

| genome | assayed | viable | A (improving) | C (collateral) | K (clean) | light-growth improving | transfer (dim) improving | median breadth (doubled units) | null median |
|---|---|---|---|---|---|---|---|---|---|
| m3-c4 sparse | 192 | 192 | 3 | 0 | 3 | 3 | 1 | 0 | 0 |
| m3-c9 dense | 192 | 192 | 4 | 0 | 4 | 0 | 0 | 12 | 12 |

Where the improving edits sit (assayed genuine in brackets):

- c4: single24 2 of 48 (b1 1, b2 1), multi2 1 of 48; single6 0 of 48, multi4 0 of 48; by kind: b1 1 of 6, b2 1 of 7, multi 1 of 96, w1 0 of 44, w2 0 of 38.
- c9: single24 3 of 48 (physics 1, b1 1, w1 1), multi4 1 of 48; single6 0 of 48, multi2 0 of 48; by kind: b1 1 of 8, physics 1 of 2, w1 1 of 46, multi 1 of 96, w2 0 of 34, b2 0 of 6.

Inverse-probability weighted improving rate over the eligible complement: c4 14 per mille, c9 23 per mille (viable 1000 per mille on both). These describe this panel's eligible neighbourhood, not PR136's.

Multi-locus edits (96 assayed per genome): 1 clean improvement each. Single-locus edits in the verdict comparison (48 for c4, 47 for c9): 2 clean each. The multi-versus-single comparison is underpowered by the same guard.

## Collateral

C = 0 on both genomes, but with A below 5 the rule does not read collateral, and 0 of 3 and 0 of 4 is not evidence of low collateral. No improving edit lost a scenario beyond tau.

## Reversibility

Undo-exactness (the inverse edit restores the original genome hash) holds for 300 of 301 genuine c4 edits and 309 of 310 genuine c9 edits. Reversibility is a property of the operator and is not what limits the decision.

## What was and was not reachable

- Reachable and delivered: a mechanically decided outcome under the unchanged rule on a fresh, larger panel with disjoint seeds, fresh edits and a declared estimand ("the same rule read on a larger, differently mixed, fresh panel", AMENDMENT section 2). It landed on `inconclusive (underpowered)`.
- Not reachable on this pair: `entanglement-signal` for c4. The freeze preflight bounds c4 median breadth at 2 doubled units against a threshold of 6, so no outcome of the assays could have produced it (AMENDMENT section 2.3). The null result here is therefore not evidence about entanglement in either direction.
- Not tested: other genomes, other operators, other scenarios, longer horizons, any search or evolution run, GPU behaviour.
- The panel mixture is outcome-informed (it raises the multi-locus share, since both PR136 improvements were multi2 edits); the AMENDMENT declares this. It does not change the verdict above: the rule's count threshold was missed regardless.

## Go or no-go on a separately versioned controller architecture

**No-go, by construction and by result.** The only outcome that could have been advisory-go was `entanglement-signal`, which the AMENDMENT shows cannot occur on c4. The result is `inconclusive (underpowered)`, so there is no evidence that fixing local controller edits is entangled, and no evidence against it either. Reading this no-go as evidence against an architecture fork would be wrong; it only says this slice supplies no reason to open one. Improving single-locus edits are rare (about 1 to 2 percent of the neighbourhood, tilted to bias and 24-unit edits) and where they occur they are clean, which is weakly in the direction of locality, but the count is below the pre-stated floor and is not used for a conclusion.

If someone wants the question settled, the remaining routes each need their own versioned protocol: a different genome pair with reachable breadth, a larger panel (about 2x more assays per genome would be needed at the observed rate of 1.6 to 2.1 percent to expect A = 5 with margin, which is a planning remark and not a statistic), or a rule change.

## Checks

`power.ts --check` ok. `--replay-check --workers 1` ok (349 s) and `--replay-check --workers 2` ok (351 s): byte-identical regeneration. PR136 `matrix.ts --check` and the freeze check passed before the run. The `--write` run took 356 s. In a browser at 1280 and 375 px the page shows both panels, no console errors and no horizontal page overflow.

## Deviations

None in the run. The `--workers` flag is accepted and recorded but has no effect, as stated in the tool header and AMENDMENT (the serial projection was inside budget, so no pool was built). Run time 356 s.
