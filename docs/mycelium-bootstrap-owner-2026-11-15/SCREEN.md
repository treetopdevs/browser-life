# Owner conduit, the fair screen: result (15 Nov 2026)

EXPLORATION, not a test: 8 seeds, round thresholds, one substrate, no pre-registration. Rules: `DESIGN.md` here (sections 1 to 6 written before any run; section 7 before any main run; section 8 after the core runs finished and before any result was read) and `docs/mycelium-bootstrap-2026-11-14/DESIGN.md`. Sizing: `SIZING.md`. Code: `tools/mycelium/bootstrap-screen.ts --series O [--extras]`, `observe-owner.ts`, `bootstrap-analyze.ts`. The kernel is unchanged.

## Label

**O (T-EC): ENCLOSURE-ONLY, qualifier TOLL-HELD.**

With the eating gate and the owner conduit both on (theta 4, `g` 30), trail is kept in 8 of 8 slots, and so it is with the gate alone (8 of 8); switching the conduit off never costs intake per particle (PAY against conduit off 0 of 8). By the design's ladder that is "exclusion is the whole effect". The qualifier says the passive world keeps trail too under the toll (6 of 8 slots), so on this substrate "kept" is mostly the toll's doing and the label says little about whether the owner rules keep trail.

What this screen adds over the stand-in runs of the first one: **the conduit's rate was raised on almost every edge and it still did not pay.** The first screen could not say that. (The readouts show the rate the rule applies, not matter measured moving through it.)

## Runs

176 runs (88 core, 88 extras) on the O screen slots 8265 to 8272, 17.88 million planned steps, about 32 minutes of wall time for the core and 37 for the extras on one local GPU (two processes of 3 jobs). Every run finished; every ledger check closed at residual 0; the intake identity is exact for every run; no branch errors. `run-log.jsonl` holds the 16 pilot and 176 main lines.

## Was the conduit operating? Yes

T-EC, late window, median over the 8 slots (range in brackets):

| readout | value |
|---|---|
| share of edges out of occupied cells with a positive owner extra rate | 0.97 (0.74 to 1.00) |
| median owner extra rate over all edges out of occupied cells, zero-rate ones included (band 9 to 53) | 29.7 (18.8 to 35.3) |
| share at the 128 limit (`csat`) | 0.018 (0.000 to 0.106) |
| median owned amount on same-owner edges | 17.4 |

So CONDUIT-IDLE and OUT-OF-BAND do not apply: all 8 slots are territorial, more than the 2 of 4 the sizing seeds showed.

## Does it pay? No, at any strength

PAY needs intake per particle-step up by at least 3 percent (or twice the noise floor) at both checkpoints (60,000 and 100,000), over the whole 2,000-step branch and its last 1,000, with population, deaths and births not worse.

| T-EC on, against | PAY | intake per particle-step, median over slots (60k / 100k) | population | births |
|---|---|---|---|---|
| conduit off | 0/8 | 0.0 / +0.1 percent | +4.8 / +4.7 | +1.1 / +1.1 |
| enclosure off | 0/8 | -0.1 / 0.0 | +1.1 / +0.9 | +23.3 / +20.9 |
| both off | 0/8 | -0.1 / 0.0 | +4.7 / +4.3 | +26.5 / +22.9 |
| owner ghost | 0/8 | 0.0 / 0.0 | +0.5 / +0.5 | -1.8 / -1.2 |
| public conduit (void match) | 0/8 | 0.0 / 0.0 | -0.4 / -0.4 | -1.0 / -0.5 |
| null twins A, B | - | 0.0 | 0.0 | medians within 0.7 |

Intake per particle does not move by more than 2 percent in any slot against any comparator. Two things do move, and neither is PAY:

- **The gate raises turnover.** Births and deaths per particle are both about 20 percent higher with the gate on than with it off, against enclosure off, in every slot at both checkpoints over the whole branch (smallest: births +11.6, deaths +11.4 percent).
- **The conduit holds more particles at the same intake per particle.** Population is higher with the conduit on than off in every slot at both checkpoints (+0.2 to +10.6 percent, median about +4.7), so total intake is higher by about the same amount (median +5.0 / +4.8 percent). PAY is per particle by design, so this is not PAY; it is a 2,000-step branch reading, not an evolved one, and not a labelled predicate.

By dose (report only): at `g` 7 PAY against conduit off is 0 of 8 (median extra rate 5.5); at `g` 120 it is 0 of 8 (median extra rate 88, `csat` 0.59). DAMP or HARM at the mid strength: 0 of 8 (at `g` 7, one slot, 8267, shows DAMP against conduit off; at `g` 120 slot 8269 is unresolved at 100,000 because its null twins differ by 14 percent in births).

Follower anchors (physarum and blind, 30,000 steps): ANCHOR-DAMPS, 8 of 8 each. With the conduit on, births and deaths are about 7 percent lower than with it off in the physarum anchor (it damps turnover); intake per particle is unchanged.

## The other predicates (the label does not reach them)

- (b) import, layers above non-layers: 3 of 8, 4 unread (in 4 slots nearly every particle lays, so there is no non-layer group of 20).
- (c) behaviour within `"id"`: H 2 of 8, G 5 of 8. In `"id"` worlds same-owner edges are 1 percent of edges (every particle is its own owner), so the conduit is idle there and (c) has little to read.
- (d) `csat` at most 0.5: 8 of 8. (e) territory sanity: 8 of 8.
- (f) dose, median late trail per particle: theta lo 98.6, `g` lo 91.9, mid 93.4, theta hi 91.8, `g` hi 92.9. Does not hold (the lo theta arm is above mid). The medians are within 7 percent of each other, but kept counts are 7, 8, 8, 7, 7 of 8 in that order, and in slot 8271 the hi theta arm loses its trail where mid keeps 99.
- (g) public control: VOID. The realised public / owner extra-rate ratio is 1.186 (0.9 to 1.1 allowed), as the sizing predicted. T-C-pub keeps trail in 7 of 8.
- T-EC-ghost keeps trail in 8 of 8.

## Trail kept, slot by slot (late trail per particle)

| arm | 8265 | 8266 | 8267 | 8268 | 8269 | 8270 | 8271 | 8272 |
|---|---|---|---|---|---|---|---|---|
| toll, passive (T-P) | 98.8 | 98.9 | 109.3 | 99.1 | 108.1 | 0.0 | 98.9 | 0.0 |
| toll, gate (T-E) | 98.6 | 63.5 | 124.1 | 82.0 | 97.9 | 87.9 | 98.9 | 12.3 |
| toll, gate and conduit (T-EC) | 98.7 | 84.3 | 141.6 | 88.3 | 98.5 | 75.2 | 99.0 | 72.9 |
| no toll, passive (N-P) | 0.2 | 0.0 | 0.0 | 0.0 | 13.1 | 0.1 | 0.0 | 0.0 |
| no toll, gate (N-E) | 98.7 | 57.6 | 0.0 | 0.0 | 0.0 | 0.1 | 98.9 | 3.3 |
| no toll, gate and conduit (N-EC) | 98.7 | 60.1 | 123.7 | 72.5 | 1.2 | 0.3 | 98.9 | 98.8 |

Two observations, both outside the label and both worth a closer look:

1. **Under the toll, the passive world lost its trail in 2 of 8 slots (8270, 8272); the gated worlds kept it there.** T-C and T-C-pas (conduit without the gate) lost it in the same two slots.
2. **Without the toll, the gate with the conduit holds substantial trail (above 50 per particle) in 6 of 8 slots, the gate alone in 3 of 8, the passive world in none.** The tool prints BOOTSTRAPS for the no-toll substrate because N-EC is above the 0.1 floor in 8 of 8; two of those (1.2 and 0.3) are near the floor, so "6 of 8" is the honest count. No branch was run on N arms, so whether the conduit pays there is not known; the difference between 6 and 3 of 8 is one run per slot and is not a vote.

Population is lower where trail is kept (roughly 3,100 to 4,400 in the toll arms against 4,100 to 5,700 where it is lost), as in every earlier rung: trail is a cost the world carries, not a gain.

## What can and cannot be said

- The owner conduit as built, sized where it has edges and with its rate raised on nearly every occupied-cell edge, does not raise intake per particle in the gated toll world at `g` 7, 30 or 120. That closes the "it never operated" objection for this variant on this substrate.
- "Trail is kept" in the toll world is not evidence for the owner rules (TOLL-HELD).
- The owner rules visibly change whether trail persists in two places: toll slots 8270 and 8272 (the gate keeps what the passive world lost; T-E's 8272 is at 12.3) and the no-toll rows. The no-toll rows are 8 single runs per arm with no branches and no dose arms; they suggest a follow-up, not a result.
- Not built, as the design said: `leak`, the cohort hazard, `kinShare`, `claimTies`. The `relax-*` continuations are stored and not analysed.

## Deviations

Those of `SIZING.md` (pilot lengthened to 100,000 steps; sized on territorial runs; C-pub void; projection by `--rate`) and of `DESIGN.md` sections 7 and 8 (label-code fixes from two Sol 6.1 High reviews, the second applied after the core runs finished and before the first label was printed). None was made with a main result in view.
