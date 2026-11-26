# I14 implementation evidence (2026-11-01, CPU only)

Findings recorded as measured (thresholds not changed):
- Life soup, glider, dup-glider: local-stats learns the Life rule exactly at r=1,h=1, so all label `exact`. A 3x3 context predictor is the rule itself.
- blobs-diffuse labels `noise-like` (marginal ties best predictor).
- random-bits: highest persistence error among q=2 fixtures; `noise-like`; deflate ratio 1000 per mille.
- rankFlipAcrossR = false (recorded as computed). Limit: this check is nearly vacuous on these fixtures. At r=1 almost every Life fixture has skill exactly 1/1, ties are not flips, and an erased or null view is dropped from the ranking instead of counting as a sensitivity event. The false value says little; the page caption states this.
- Duplicated motif: errors(dup) = 9 x errors(single) for all 4 predictors, r in {1,2}, all h.
- ecology-clip: quantiser shift fixed at 5 by the stated rule (initial max biomass 480 -> 15); the 32x32 clip is dense and low contrast; label `partial`.
- Deviations from PLAN: added `ecology.ts` (needs @bl/*, so kept out of the barrel); atlas.ts/ecology.ts not exported from index.ts (node:crypto / sim-ref); CLI registers an @bl resolver hook (node:module registerHooks) since sim-ref imports @bl/schema.

Commands: see final report. Image checks (Dockerfile.site build) not run.
