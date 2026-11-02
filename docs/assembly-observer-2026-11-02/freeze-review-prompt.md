You are reviewing the FREEZE FILES of a small research-tooling slice (I07, assembly-inspired observer) before they are committed and pushed, and before any calibration object is scored. Read-only review.

Read: docs/assembly-observer-2026-11-02/GRAMMAR.md, PROTOCOL.md, and the already-reviewed PLAN.md and REVIEW.md in the same directory. The library code (packages/metrics/src/assembly/{grammar,segment,exact,bound,fixtures,protocol,version}.ts) exists on disk but readouts/verdict/stream/CLI are not written yet. No calibration outcome has been computed.

Check, and report findings with severity P1/P2/P3 and a concrete fix each:
1. Is every rule needed to score without further choices actually fixed (definitions of readouts, directions, ties, grid cells, verdict branches, undefined values, clip rules, persistence, segmentation factor)? Name any ambiguity that could let a choice be made after seeing outcomes.
2. Do GRAMMAR.md/PROTOCOL.md agree with PLAN.md, and where they deviate (box 7 / pitch 8 instead of 5/6, floor a>=6 not 7, hier-12 built from I-trominoes not L-trominoes, reuseRatio as ratio of sums, movies exact-only for n<=10) is each deviation justified and stated? Is the I-tromino correction right (two translated L-trominoes cannot tile a 2x3 block)?
3. Do the fixture recipes in PROTOCOL.md match fixtures.ts (pitches, slot counts: confirm every class fits its slot grid with at least one empty cell between objects under 8-connectivity on the torus, including seam-touch pairs, hierarchy at pitch 9x5, tile pitch 4x4)? Is the matched pair really matched?
4. Decision rule soundness: can a readout be declared "separates" vacuously? Is the primary-cell dup-negative requirement coherent with 'only the matched pair may carry separates'? Any flaw in the grid-cell definition (spaced 8-connectivity equals spaced 4 by construction; is that a vacuous grid cell and should it be stated)?
5. Anything in the exact solver (exact.ts) or bound certificate rule (bound.ts) that violates GRAMMAR.md.
Be concise. Output a numbered findings list, then a one-line verdict (approve / request changes).
