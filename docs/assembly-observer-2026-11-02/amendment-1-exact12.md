# Amendment 1 (2026-11-02, outcomeExposed): exact check of the 12-cell motifs

Written after `evidence.json` existed, so it is marked `outcomeExposed`. It changes no frozen rule, constant or verdict; it measures a limitation the frozen protocol could not see.

`random-dup-12` motifs are selected by the beam **bound** (n = 12 is above `exactMaxN`). The selection therefore prefers shapes the beam does badly on. `node tools/assembly/exact12-check.ts` re-solves the 16 chosen motifs exactly (the exact solver reaches 12 cells; result in `amendment-1-exact12.json`):

- `random-dup-12`: beam bound 10 to 11 (mode 11), exact 6 to 7.
- `hier-12`: beam bound 4, exact 4 in every replicate.

Reading: the reported cost gap between the matched pair (4 against 10 to 11) is inflated by about four joins by the weakness of the bounded search. With exact values the ordering is unchanged (4 below 6, every pair), so the sign of the separation does not depend on it, but its size does. The `sharedBound` and `reuseRatio` verdicts stay as sealed; nothing is re-tuned.
