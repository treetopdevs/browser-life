# Amendment 2 (2026-11-02, outcomeExposed): fixes from the source review

Written after `evidence.json` existed, so it is marked `outcomeExposed`. The source review (Codex Sol 6.1 xhigh, `review-sol-src.txt`) and the Claude review found defects in the implementation. None of them changes a frozen rule, constant, threshold or verdict branch; they make budgets bind, make streaming real, stop a vacuous verdict, correct text, and report more. Dispositions are in `REVIEW.md` ("Source review dispositions").

Because `bound.ts` (and the other files named in `PROTOCOL.md` section 10) changed after the freeze, the freeze-time hashes no longer match. `amendment-2-source-review.json` records the hashes of every `packages/metrics/src/assembly/*.ts` file after the fixes; `checkPins()` accepts a pinned file if it equals the `PROTOCOL.md` hash or the amendment pin, and fails otherwise.

## What changed

- `bound.ts`: the child budget `nodeCap` binds child creation (checked before each child, `>=`), not only between layers; on exhaustion the prescribed chain fallback is returned. For the reviewer's probe `[0, 1, 1024, 1025]` with `nodeCap: 4` the result is the chain fallback after at most 4 nodes.
- `construct.ts`: `totalNodeLimit` is a hard allowance. Each solve gets `min(its own budget, remaining)`, the check is `remaining <= 0` (not `>`), and the allowance is rechecked before the bounded fallback. The allowance is a constructor argument (default `PROTOCOL.totalNodeLimit`) only so a test can exhaust it.
- `stream.ts`: a movie's construction score keeps the solver status. Objects whose solve was not exact are left out of `reuseRatio` and counted in the new field `inexactObjects`. In the saved run no object was inexact.
- `readouts.ts`: the "D4 on 8-connectivity" diagnostic always segments with 8-connectivity (it used 4-connectivity when the primary segmentation was 8-connectivity).
- `verdict.ts`, `observer.ts`: `isOne` requires a positive denominator; `validateCalibration` rejects a missing class, a wrong replicate count or wrongly numbered replicates; `deriveVerdicts` throws on an invalid set; `--check` validates structure before deriving verdicts. Verdict sentences for `sharedBound` and `reuseRatio` carry the bound-selection caveat below.
- `lazy.ts` (new): lazy byte-equivalent twins of the nine I14 base fixtures. The evidence driver hashes incrementally and never materialises a movie. A test checks byte equality with the I14 movies and that detaching each frame after use changes nothing.
- `observer.ts`: clip swing is split into connectivity at a fixed threshold and threshold at fixed connectivity (`connAtFixedTau`, `tauAtFixedConn`), next to the frozen factor-2 rule, which is unchanged. Replicate 0 of every class now stores its occupied cells so the page draws without regenerating.
- `tools/assembly/observer.ts`: `--check` also validates the freeze commit (well-formed, exists, ancestor of HEAD, holds exactly `GRAMMAR.md` and `PROTOCOL.md` with today's bytes, no outcome file) and the pinned hashes. It skips the git checks only when history is genuinely unavailable (no repository, or a shallow clone). Amendment files are now part of the manifest's source list.

## Corrected statements

The sealed statement "no score here selected anything" (also on the page and in `PROTOCOL.md` section 7) was false: the motifs of `random-dup`, `random-dup-hi` and `random-dup-12` are chosen by construction-length score. It now reads: "no score selected which worlds or clips were shown; negative-class motifs are selected by construction-length score (best of 256 candidates)". The frozen `PROTOCOL.md` text is not edited; this amendment supersedes it.

## Bound-selection caveat

The 12-cell negatives are picked by the beam bound, which favours shapes the beam handles worst. Beam bound 10 to 11 against exact 6 to 7 for `random-dup-12`, 4 against 4 for `hier-12` (`amendment-1-exact12.json`). The ordering survives with exact values; the size of the gap does not. This is now stated next to the matched-pair verdicts on the page and in the `sharedBound` and `reuseRatio` verdict sentences.

## Not fixable after the fact

The freeze pinned seven of thirteen algorithm files. The decision path (`verdict.ts`, the veto in `observer.ts`, `readouts.ts`, `stream.ts`, `construct.ts`, `clips.ts`) was not pinned at the freeze, and that cannot be undone. The pins in the JSON are post hoc: they stop silent drift from here on, and they say nothing about what the code looked like before the evidence existed.
