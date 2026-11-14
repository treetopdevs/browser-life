DRAFT: the rule was not frozen when this was read (runs/regime/rule-draft.md). Nothing here is a result of the registered programme.

# Stage 0 readout (R9.0), run 1 of 3

Rule: DRAFT /Users/nicholas/develop/browser-life/.claude/worktrees/3d-regime-meters/runs/regime/rule-draft.md (SHA-256 0bed3086bae784d7cc5ef27fad07285435894cb3ee657b4c874c4147182a3d24). Jobs read: 18 (dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu30-s8-k256-seed9001-t20000, dev-slab-mu30-s8-k256-seed9002-t20000, dev-slab-mu30-s8-k256-seed9003-t20000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000).
The run number defaulted to 1; pass --run=<n> for a repeat (the development log R0.2 lists the earlier Stage 0 runs).

STAGE 0 FAIL (run 1 of 3). Causes by combination: (P1, net) REF-UNDEFINED, CARPET-UNDEFINED, DUST-LIMITED, DUST-AMBIGUOUS, FROZEN-NOT-ORDERED, MARGINAL; (P1, occ) REF-UNDEFINED, CARPET-UNDEFINED, DUST-LIMITED, DUST-AMBIGUOUS, FROZEN-NOT-ORDERED, MARGINAL; (P2, net) REF-UNDEFINED, CARPET-UNDEFINED, N-NOT-SATURATED, FROZEN-NOT-ORDERED, NO-CONTRAST-WITH-CONTROLS, MARGINAL; (P2, occ) REF-UNDEFINED, CARPET-UNDEFINED, FROZEN-NOT-ORDERED, NO-CONTRAST-WITH-CONTROLS, N-NOT-SATURATED, MARGINAL.
Threshold trigger: not fired.
By rung (a failure fails that rung's two combinations only; thetaB is never re-derived): P1 bank: dust floor holds, trigger not fired; P2 bank: dust floor holds, trigger not fired.

Causes by combination, in detail:
- (P1, net): 6 causes
  - REF-UNDEFINED: spots-m3@50000, spots-m3@100000, gradient-m3@50000, gradient-m3@100000
  - CARPET-UNDEFINED: dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - DUST-LIMITED: spots-m3@50000, spots-m3@100000
  - DUST-AMBIGUOUS: spots-m3@50000, spots-m3@100000, gradient-m3@50000, gradient-m3@100000, carpet
  - FROZEN-NOT-ORDERED: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - MARGINAL: dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
- (P1, occ): 6 causes
  - REF-UNDEFINED: spots-m3@50000, spots-m3@100000, gradient-m3@50000, gradient-m3@100000
  - CARPET-UNDEFINED: dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - DUST-LIMITED: spots-m3@50000
  - DUST-AMBIGUOUS: spots-m3@50000, spots-m3@100000, gradient-m3@50000, gradient-m3@100000, carpet
  - FROZEN-NOT-ORDERED: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - MARGINAL: dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000
- (P2, net): 6 causes
  - REF-UNDEFINED: spots-m3@50000, spots-m3@100000, gradient-m3@50000, gradient-m3@100000
  - CARPET-UNDEFINED: dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - N-NOT-SATURATED: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - FROZEN-NOT-ORDERED: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - NO-CONTRAST-WITH-CONTROLS: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - MARGINAL: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000
- (P2, occ): 6 causes
  - REF-UNDEFINED: spots-m3@50000, spots-m3@100000, gradient-m3@50000, gradient-m3@100000
  - CARPET-UNDEFINED: dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - FROZEN-NOT-ORDERED: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-slab-mu60-s8-k1024-seed9001-t20000
  - NO-CONTRAST-WITH-CONTROLS: dev-2d-gradient-m3-seed9001-t100000, dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-gradient-m3-seed9002-t50000, dev-2d-gradient-m3-seed9003-t100000, dev-2d-gradient-m3-seed9003-t50000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-2d-spots-m3-seed9003-t50000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - N-NOT-SATURATED: dev-2d-gradient-m3-seed9003-t100000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9002-t50000, dev-2d-spots-m3-seed9003-t100000, dev-slab-mu60-s8-k1024-seed9001-t20000, dev-slab-mu60-s8-k1024-seed9002-t20000, dev-slab-mu60-s8-k1024-seed9003-t20000
  - MARGINAL: dev-2d-gradient-m3-seed9001-t50000, dev-2d-gradient-m3-seed9002-t100000, dev-2d-spots-m3-seed9001-t100000, dev-2d-spots-m3-seed9001-t50000, dev-2d-spots-m3-seed9002-t100000, dev-2d-spots-m3-seed9003-t100000, dev-slab-mu60-s8-k1024-seed9001-t20000

## Selection (first combination that satisfies G2, G3, G5, G6, G7, the margin condition and the go/no-go reports of its rung)

| combination | G2 | G3 | G5 | G6 | G7 | marginal jobs | dust floor holds (b) | trigger fired | satisfies |
|---|---|---|---|---|---|---|---|---|---|
| (P1, net) | no | no | yes | no | no | 13 | yes | no | no |
| (P1, occ) | no | no | yes | no | no | 12 | yes | no | no |
| (P2, net) | no | no | yes | yes | no | 6 | yes | no | no |
| (P2, occ) | no | no | yes | yes | no | 7 | yes | no | no |

Margin condition, (P1, net): dev-2d-gradient-m3-seed9001-t50000 (ratioU); dev-2d-gradient-m3-seed9002-t100000 (s30); dev-2d-gradient-m3-seed9002-t50000 (ratioU); dev-2d-gradient-m3-seed9003-t100000 (ratioU, s30); dev-2d-gradient-m3-seed9003-t50000 (ratioU); dev-2d-spots-m3-seed9001-t100000 (ratioU); dev-2d-spots-m3-seed9002-t100000 (ratioU); dev-2d-spots-m3-seed9002-t50000 (ratioU); dev-2d-spots-m3-seed9003-t100000 (s30); dev-2d-spots-m3-seed9003-t50000 (ratioU); dev-slab-mu60-s8-k1024-seed9001-t20000 (ratioU, s30); dev-slab-mu60-s8-k1024-seed9002-t20000 (ratioU, s30); dev-slab-mu60-s8-k1024-seed9003-t20000 (ratioU).
Margin condition, (P1, occ): dev-2d-gradient-m3-seed9001-t50000 (ratioU); dev-2d-gradient-m3-seed9002-t100000 (ratioU); dev-2d-gradient-m3-seed9002-t50000 (ratioU, s30); dev-2d-gradient-m3-seed9003-t100000 (ratioU); dev-2d-gradient-m3-seed9003-t50000 (ratioU); dev-2d-spots-m3-seed9001-t100000 (ratioU); dev-2d-spots-m3-seed9001-t50000 (ratioU); dev-2d-spots-m3-seed9002-t100000 (s30); dev-2d-spots-m3-seed9002-t50000 (ratioU); dev-2d-spots-m3-seed9003-t100000 (ratioU); dev-2d-spots-m3-seed9003-t50000 (ratioU); dev-slab-mu60-s8-k1024-seed9001-t20000 (ratioU).
Margin condition, (P2, net): dev-2d-gradient-m3-seed9001-t100000 (s30); dev-2d-gradient-m3-seed9002-t50000 (ratioU); dev-2d-gradient-m3-seed9003-t100000 (s30); dev-2d-spots-m3-seed9002-t50000 (grid); dev-2d-spots-m3-seed9003-t100000 (grid); dev-2d-spots-m3-seed9003-t50000 (s30).
Margin condition, (P2, occ): dev-2d-gradient-m3-seed9001-t50000 (ratioU, s30); dev-2d-gradient-m3-seed9002-t100000 (ratioU); dev-2d-spots-m3-seed9001-t100000 (s30); dev-2d-spots-m3-seed9001-t50000 (ratioU); dev-2d-spots-m3-seed9002-t100000 (ratioU, s30); dev-2d-spots-m3-seed9003-t100000 (s30); dev-slab-mu60-s8-k1024-seed9001-t20000 (ratioU).

## Go/no-go reports

(a) the Z twin is exactly zero in every Stage 0 job (C1): yes
(b) the dust floor: the U twin's block-net n_dec(30) / liveblk_R is at most SAT = 0.05 in every metered job that has a U twin (a job without one is named below and counts as neither a pass nor a failure), read in each rung's bank (a failure fails that rung's two combinations only): yes; largest 0.0441
U twin read (R9.0 missing evidence): P1 bank 18 of 18 metered jobs, P2 bank 18 of 18 metered jobs.
(c) the U twin's median |dB_blk| over its nonzero blocks at step 30, next to thetaB (it feeds the threshold trigger, which fails the combinations of a rung whose bank fires it with DUST-THRESHOLD): 36 job and rung readings (a U log with no block of nonzero difference has no median, NA, and does not fire (c)), 0 above thetaB; the 10 highest relative to thetaB:

| job | rung | median |dB_blk| | thetaB | exceeds thetaB |
|---|---|---|---|---|
| dev-2d-gradient-m3-seed9001-t100000 | P1 | 2 | 6 | no |
| dev-2d-gradient-m3-seed9001-t50000 | P1 | 2 | 6 | no |
| dev-2d-gradient-m3-seed9002-t100000 | P1 | 2 | 6 | no |
| dev-2d-gradient-m3-seed9002-t50000 | P1 | 2 | 6 | no |
| dev-2d-gradient-m3-seed9003-t100000 | P1 | 2 | 6 | no |
| dev-2d-gradient-m3-seed9003-t50000 | P1 | 2 | 6 | no |
| dev-2d-spots-m3-seed9001-t100000 | P1 | 2 | 6 | no |
| dev-2d-spots-m3-seed9001-t50000 | P1 | 2 | 6 | no |
| dev-2d-spots-m3-seed9002-t100000 | P1 | 2 | 6 | no |
| dev-2d-spots-m3-seed9002-t50000 | P1 | 2 | 6 | no |

## The gate worlds on the development seeds

| job | (P1, net) | (P1, occ) | (P2, net) | (P2, occ) |
|---|---|---|---|---|
| dev-2d-gradient-m3-seed9001-t100000 | CHAOTIC AMBIG ratio 0.39 | MIXED AMBIG ratio 0.37 | MIXED CLEAR ratio 0 | MIXED CLEAR ratio 0.14 |
| dev-2d-gradient-m3-seed9001-t50000 | CHAOTIC AMBIG ratio 0.41 | MIXED AMBIG ratio 0.41 | MIXED CLEAR ratio 0.04 | MIXED CLEAR ratio 0.2 |
| dev-2d-gradient-m3-seed9002-t100000 | CHAOTIC AMBIG ratio 0.39 | MIXED AMBIG ratio 0.27 | MIXED CLEAR ratio 0.11 | MIXED CLEAR ratio 0.19 |
| dev-2d-gradient-m3-seed9002-t50000 | CHAOTIC AMBIG ratio 0.34 | MIXED CLEAR ratio 0.25 | MIXED CLEAR ratio 0.17 | MIXED CLEAR ratio 0.15 |
| dev-2d-gradient-m3-seed9003-t100000 | CHAOTIC AMBIG ratio 0.28 | MIXED AMBIG ratio 0.4 | MIXED CLEAR ratio 0 | MIXED CLEAR ratio 0.06 |
| dev-2d-gradient-m3-seed9003-t50000 | CHAOTIC AMBIG ratio 0.29 | MIXED AMBIG ratio 0.49 | MIXED CLEAR ratio 0.07 | MIXED CLEAR ratio 0.13 |
| dev-2d-spots-m3-seed9001-t100000 | CHAOTIC LIMITED ratio 0.57 | MIXED CLEAR ratio 0.23 | MIXED CLEAR ratio 0.01 | MIXED CLEAR ratio 0 |
| dev-2d-spots-m3-seed9001-t50000 | CHAOTIC AMBIG ratio 0.35 | CHAOTIC AMBIG ratio 0.28 | MIXED CLEAR ratio 0.13 | CHAOTIC AMBIG ratio 0.31 |
| dev-2d-spots-m3-seed9002-t100000 | CHAOTIC LIMITED ratio 0.52 | CHAOTIC AMBIG ratio 0.37 | MIXED CLEAR ratio 0.07 | MIXED CLEAR ratio 0.2 |
| dev-2d-spots-m3-seed9002-t50000 | CHAOTIC AMBIG ratio 0.48 | MIXED LIMITED ratio 0.52 | MIXED CLEAR ratio 0.08 | MIXED CLEAR ratio 0.13 |
| dev-2d-spots-m3-seed9003-t100000 | CHAOTIC AMBIG ratio 0.4 | MIXED AMBIG ratio 0.45 | MIXED CLEAR ratio 0 | MIXED CLEAR ratio 0.03 |
| dev-2d-spots-m3-seed9003-t50000 | CHAOTIC LIMITED ratio 0.52 | MIXED AMBIG ratio 0.44 | MIXED CLEAR ratio 0 | MIXED CLEAR ratio 0.04 |
| dev-slab-mu60-s8-k1024-seed9001-t20000 | MIXED AMBIG ratio 0.41 | ORDERED AMBIG ratio 0.47 | MIXED CLEAR ratio 0 | MIXED CLEAR ratio 0.15 |
| dev-slab-mu60-s8-k1024-seed9002-t20000 | MIXED AMBIG ratio 0.31 | ORDERED CLEAR ratio 0 | MIXED CLEAR ratio 0 | MIXED CLEAR ratio 0 |
| dev-slab-mu60-s8-k1024-seed9003-t20000 | MIXED CLEAR ratio 0.25 | ORDERED AMBIG ratio 0.37 | MIXED CLEAR ratio 0 | MIXED CLEAR ratio 0 |

MIXED and UNSTABLE rate among the metered gate jobs (A-F07):

| combination | MIXED or UNSTABLE | of |
|---|---|---|
| (P1, net) | 3 | 15 |
| (P1, occ) | 10 | 15 |
| (P2, net) | 15 | 15 |
| (P2, occ) | 14 | 15 |

## mu30-s8-k256 (informational: the sweep's own base reading and dust state)

| job | (P1, net) | (P1, occ) | (P2, net) | (P2, occ) |
|---|---|---|---|---|
| dev-slab-mu30-s8-k256-seed9001-t20000 | CHAOTIC CLEAR ratio 0.25 s30 2.6 | MIXED AMBIG ratio 0.39 s30 1.37 | MIXED CLEAR ratio 0 s30 0.93 | CHAOTIC LIMITED ratio 0.6 s30 2.51 |
| dev-slab-mu30-s8-k256-seed9002-t20000 | CHAOTIC AMBIG ratio 0.48 s30 2.55 | CHAOTIC AMBIG ratio 0.4 s30 2.05 | MIXED CLEAR ratio 0 s30 0.86 | CHAOTIC LIMITED ratio 0.7 s30 2.54 |
| dev-slab-mu30-s8-k256-seed9003-t20000 | CHAOTIC AMBIG ratio 0.39 s30 2.26 | MIXED CLEAR ratio 0.17 s30 1.05 | MIXED CLEAR ratio 0 s30 0.76 | MIXED AMBIG ratio 0.41 s30 1.96 |

Constant screen (descriptive, decides nothing): mu30-s8-k256 seed 9001 at T = 20000, rung P1 with net; base n_dec,S(30) = 28.09, n_1(100) = 25309.91.
| constant | factor | value | n_dec,S(30) / base | n_1(100) / base |
|---|---|---|---|---|
| dtQ | 0.5 | 26 | 0.41 | 0.04 |
| dtQ | 2 | 102 | 3.14 | 1.14 |
| spread | 0.5 | 4 | 0.45 | 0.07 |
| spread | 2 | 16 | 1.15 | 0.94 |
| thetaMass | 0.5 | 256 | 0.78 | 1.01 |
| thetaMass | 2 | 1024 | 0.98 | 0.99 |
| massUnit | 0.5 | 128 | 0.43 | 0.01 |
| massUnit | 2 | 512 | 0.61 | 0.25 |
| diffA | 0.5 | 100 | 1 | 1 |
| diffA | 2 | 256 | 1 | 1 |
| diffC | 0.5 | 100 | 0.99 | 1.01 |
| diffC | 2 | 256 | 1.05 | 1.01 |
| diffS | 0.5 | 75 | 1 | 1 |
| diffS | 2 | 256 | 1 | 1 |
| gateK | 0.5 | 32 | 1 | 1 |
| gateK | 2 | 128 | 1 | 1 |
| mutRate | 0.5 | 214749 | 1 | 1 |
| mutRate | 2 | 858994 | 1 | 1 |

## Next

The finalizer may change J constants (R1) and rerun Stage 0, at most 2 more time(s); every run and change goes into the development log (R0.2). Declining to rerun closes the candidate (STAGE0-CLOSED, recorded in that log).

