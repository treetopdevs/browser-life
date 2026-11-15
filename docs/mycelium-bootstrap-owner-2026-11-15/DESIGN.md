# Owner conduit, the fair screen: design addendum (15 Nov 2026), written before any run of it

EXPLORATION. This finishes series O of `docs/mycelium-bootstrap-2026-11-14/DESIGN.md` (called "the design" below). That screen left O INCOMPLETE: the owner conduit strength `gOwner` and the matched public strength `gCpub` were never sized, the owned-edge readouts were not built, and the 80 O runs used stand-in strengths. Nothing in the kernel changes here (`world.ts`, `gpu.ts` and the parity cases are untouched). The design's rule (section 6), arms (8), predicates (9.5) and label ladder (10.3) stand as written; this note only fixes what the design left open, and says where it departs from the design's letter.

## 1. What had been seen before this note was written

Stated so the reader can discount it. The stand-in O runs (theta 4, `ownerConduit` 16, public 8, the 8 O screen slots, 100,000 steps) are in the merged record: 0 of 8 PAY for EC against every comparator, trail kept in every toll arm. From those run files I also read, before writing the rules below:

- passive owner planes (T-P): about 3 percent of directed edges join two cells of one owner, and the median owned amount `Q` is 1;
- with the eating gate on (T-E, theta 4): 37 to 100 percent of directed edges are same-owner and the median `Q` is 9 to 21.

So the owner conduit has almost nothing to conduct across unless the gate is on, and the world the labelled arm (EC) lives in is the gated one. The rules below follow from that, not from any PAY reading.

## 2. Sizing (dev slots only; nothing from it enters a table)

**Series S5** (the S block's first 4 slots, toll substrate, `"gid"`, inherit, 20,000 steps): `pass` (`trailOwner` only) and `E` (`ownerDefend` = the measured theta mid, 4). Every heavy census stores two histograms: `x = min(Q_k, Q_nb)` over directed edges with `Z_k == Z_nb != 0` (values above 255 counted at 255, exact because the cap `q` is 255), and `min(P_k, P_nb)` over all directed edges, the same clamp. With those, the mean extra rate of either conduit at any `g` is integer arithmetic: `eff(x, g) = min(De + ((x * g) >> 4), 128) - De`.

- **O1, owner strength (departs from R6's letter).** R6 sizes on passive worlds. There the median owned `x` is 1, which gives `g` 255, and in the gated world (median `x` in the teens) that puts most owned edges at the 128 limit, which risks failing (d). So: `gOwner.mid = clamp(roundDiv(480, xE), 1, 255)`, `xE` = the median over the 4 seeds of each E run's median `x` (pooled over its late censuses, steps above 10,000). `lo = max(1, mid >> 2)`, `hi = min(255, 4 * mid)`, as the design says. No same-owner edge in the E runs: `mid` = 255 and the result is reported NO-BITE-LIKELY. If the rule lands on 16 (the stand-in), the runs are still redone, because the old files do not hold the owned-edge readouts.
- **O2, the passive-sized strength.** The same formula on the `pass` runs gives `gPassive` (expected 255). It is used by one added report-only arm, `T-C-pas` (conduit only, no gate, `ownerConduit` = `gPassive`), so the conduit-only question is asked at a strength that bites in its own world. `T-C` stays at `gOwner.mid` as the design's control for EC.
- **O3, matched public strength.** On the E runs' late censuses: `own(g)` = mean over all directed edges of the owner extra rate, `pub(g')` = the same for the public conduit on `P` (`q'` 255). **Both are extra rates, base `diffA` subtracted** (a ratio of rates that include the base 40 passes a 10 percent test for almost any `g'`). `gCpub` = the grid value minimising |median over seeds of `pub(g') / own(gOwner.mid)` - 1|; void beyond 10 percent. **Realised check:** per slot, mean public extra rate over the T-C-pub run's late window over mean owner extra rate over the T-EC run's late window; the control is void if the median over slots is outside 0.9 to 1.1.
- **O4, band check, report only.** The median over slots of the late median owner extra rate on edges out of occupied cells in T-EC should sit in 9 to 53. Outside it the strength is printed OUT-OF-BAND next to the label. It is not moved: moving it after main runs would be choosing on outcomes.
- Theta stays 2 / 4 / 8 (measured, R6). The S0.4 stop rule did not fire.

## 3. Readouts built here (`observe-owner.ts`)

The owner analogue of the conduit census, on `Z` and `Q` with `ownerRate`; for an arm without `ownerConduit` the sized `gOwner.mid` is used as a hypothetical. Per heavy census, over directed edges out of occupied cells: `csat` (share at 128), extra-rate percentiles, `live` (share with extra rate above 0), `x` percentiles on same-owner edges; import `imp` for layers against non-layers (the design's reused (b)) and for OWN against not-OWN particles (`ownerImp`, report only); residence `occx` and its half-torus shift on the owner rate map; the two histograms.

Predicates, as the design's 9.5 with the open points fixed:

- **K**: late trail per particle at least 0.1 and at least half the same slot's T-P. An extinct or unread run is unread, not a fail.
- **(b)**: layers' mean import positive and above non-layers', both groups at 20 or more in at least half the late censuses.
- **(c)** is read within `"id"` (design 9.5): H and G from T-EC-id against blocked-id T-EC on the same slot; the acute branch uses the physarum-EC anchors' median.
- **(d)**: owner `csat` at most 0.5.
- **KEPT-UNPAID's "with HARM or DAMP"** had no count: it holds when DAMP(on against conduit off) at every checkpoint, or HARM in any PAYALL pair at every checkpoint, is seen in at least half the slots.
- **(g)** counts T-C-pub runs that are K; a void or unmatched C-pub fails it (design).

## 4. Two qualifiers fixed now (they never change a label)

- **TOLL-HELD**: T-P has late trail per particle of at least 0.1 in at least 6 of 8 slots. Then "kept" in the ladder is most likely the toll's doing: T-E and T-C-pub are then expected to be K too, which fails (g), and a label of ENCLOSURE-ONLY or KEPT-BY-PRESENCE-ONLY says nothing about whether the owner rules keep trail. (Expected, not forced: an arm could still lose trail under the toll.) Expected to apply.
- **CONDUIT-IDLE**: fewer than 6 of 8 T-EC slots have late `live` of at least 0.25. Then, in the slots below 0.25, a PAY of N is not evidence about a working conduit (the V1 failure). PAY is also printed over the operating slots alone, report only.

## 5. Runs, gates, slots

- Core (unconditional): the design's 64 runs and 16 anchor runs, plus `T-C-pas` (8). Extras (88) run if the core's V(K) is Y, which the toll makes likely; the runner's 3.0 hour projection gate applies to the whole.
- Slots: the O screen slots, the same ones the stand-in runs used. T-P, T-E, T-base and N-base have the same configs as before (theta 4 was measured), so they repeat those worlds; they are rerun for the new readouts.
- Fresh output folder; the frozen sizing file of the first screen is read, not rewritten (a new file adds `gOwner`, `gCpub`, `gPassive`). Run log in this folder.

## 6. Not built, and not claimed

`leak`, the cohort hazard, `kinShare` and `claimTies` need per-step particle tracking and enter no label: not built. The `relax-*` continuations run and are stored but not analysed. The label is exploratory: 8 seeds, round thresholds, one substrate. Only KEPT-AND-USED would justify a pre-registered rung (design 10.4).

## 7. Changes made before any main run (15 Nov 2026)

After the sizing pilot and a Sol 6.1 High review of this note and the code. No main run existed when these were made; the sizing record is `SIZING.md`.

1. **The sizing pilot is S5L, 100,000 steps** (section 2 said 20,000). At 20,000 steps the gated world's territories are still forming. The 20,000-step runs are kept as a recorded first pilot and size nothing.
2. **O1 and O3 read the territorial runs only.** The gated world settles in one of two states and stays there: clan territories (most edges same-owner) or almost no shared ownership. A median across both sizes for neither. A sizing run is territorial when at least 0.25 of its directed edges are same-owner (the same 0.25 as CONDUIT-IDLE); with fewer than two territorial runs the rule falls back to every run and says so. The every-run value is printed beside it.
3. **The two `g` dose arms branch** (T-EC-gLo, T-EC-gHi, no relaxations), so PAY is read at three strengths. Report only; the label stays at the mid strength.
4. **Review fixes (label code).** PAYALL joins the per-seed conjunctions (design 10, joint votes). A headline predicate that reads I gives INCONCLUSIVE, never a negative label. A run that went extinct is unread for K. Only run files whose config equals their arm's definition at this sizing are read (old stand-in files are left out). A dose median needs every slot read. The acute branch needs the whole physarum anchor cohort.
5. **Wording.** Sections 2 and 4 claimed three things as certain that are only likely (saturation failing (d), TOLL-HELD forcing (g) to fail, CONDUIT-IDLE meaning "did not operate"); reworded above.
6. **Ghost arm.** The owner census of T-EC-ghost reads the real owner map, not the displaced one the rule used; that arm enters the label nowhere (only its K and its correlation are reported).
7. **Projection.** The 3.0 hour gate is checked once for the whole screen (core and extras together) with `--count --extras` before the core starts; the figure is in `SIZING.md`.

## 8. Label-code fixes made after the core runs finished and before any result was read (15 Nov 2026)

A second Sol 6.1 High pass ran while the 88 core runs did. Its findings were fixed before the first label report was printed; none was chosen with a result in view, and each can only move a label towards INCONCLUSIVE or INCOMPLETE, never towards a positive one.

1. **(e) and T-E's K join the same-seed votes.** KEPT-AND-USED, the sponge and CONDUIT-PAYS-NOT-USED need (e) on the same seeds as the rest; ENCLOSURE-ONLY needs T-EC and T-E kept on the same seeds.
2. **A negative label needs a definite failure.** KEPT-BY-PRESENCE-ONLY is given only when some headline predicate votes N or a control fails; if every open predicate merely reads I (or the dose medians are unread), the label is INCONCLUSIVE. The note names both lists.
3. **Whole-config equality.** A run file is read only when its config is exactly what its arm, heredity and seed build, so a file carrying a key the arm does not define is left out.
4. **TOLL-HELD's printed text** now says "most likely", as section 4 does.
