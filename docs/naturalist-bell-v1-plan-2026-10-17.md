# The anomaly bell, v1: plan (2026-10-17)

Status: **a plan, nothing of v1 has run.** The bell's v0 readout is in
`docs/naturalist-bell-v0-2026-10-17.md`: at its pre-stated setting it rang on 30 of 70 neutral runs ("rings
on drift"). Its hits on treatment were arm-level, not events: treatment worlds are smaller than neutral ones
from step 10,000. v1 has three parts, each with rules fixed below before any of it runs:

- **A. Envelope bell on fresh nulls.** A rule changed in the light of v0, judged on neutral runs it has never seen.
- **B. Twin bell.** A world against its own twin, with a known intervention at a known step. The bell has to
  tell an event from the chaos that any perturbation sets off.
- **C. Part b, redesigned.** The model reads blinded digests of the same twins, and is scored against the
  same ground truth as the code. The model calls are paid and wait for a yes.

The GPU runs (A and B) are local and cost no money, but take hours of this shared machine; they wait for a
yes too. Nothing here changes physics, a checkpoint format or a golden pin.

## Pilot facts (measured 2026-10-17, before the rules were fixed)

All on the local Mac (native WebGPU through Deno), at a load average of 80 to 180. The design pilot used
gradient-m3 neutral seed 2001, which no test below uses. Outputs stayed in the session scratchpad.

- **Speed.** One run: 810 steps/s (50,000 steps in 63 s). Three in parallel: 670 to 730 steps/s each, about
  2,090 combined. So a 3×10⁵-step run takes about 6 minutes alone, and three run in about 7.
- **The bundles on disk can serve as twin bases.** A Mac rerun of `replay-m4` gradient-m3 neutral seed 1
  matched its A10G bundle at all 500 censuses of 50,000 steps. A rerun of treatment seed 1 under another
  experiment name matched for 10,000 steps, in `series.jsonl` and `lineages.tsv` both. The experiment name does
  not enter the physics.
- **A twin equals its base up to the intervention.** With a lesion at step 30,000, the census at 30,000 is
  still identical (the census comes before the intervention), and the first difference is at 30,100.
- **Footprints**, lesions and a feed centred at (128, 128) at step 30,000; living cells about 36,900 before:

  | Intervention | Change at 30,100 | Back within the base's range |
  | --- | --- | --- |
  | lesion r = 32 | −1,400 living cells (4%) | about 2,000 steps |
  | lesion r = 64 | −5,400 (15%); lineages −13 | about 10,000 steps |
  | lesion r = 96 | −13,000 (35%); lineages 78 → 50 | cells about 5,000 steps; lineages still about 50 at 35,000, recovered by 40,000 |
  | feed r = 32, 64 quanta per cell (+205,376 matter) | +5 cells at first, then about +3,000 | not back by 50,000 (20,000 steps later) |

  A lesion is an acute event that the world heals within thousands of steps. v0's persistence (50
  consecutive censuses) would mostly miss one. A feed is a sustained event.

## Fixed before running (2026-10-17)

### A. Envelope bell v1 on fresh nulls

**Rule.** v0's departure score (`docs/naturalist-bell-v0-2026-10-17.md`, "The departure score"): z with
spread max(IQR/1.349, 5% of |median|, floor); rates over 10 censuses; windows starting at or after step 10,000;
Z = 4, W = 50; D as in v0. Two changes, both chosen from v0's readout:

- **Eleven signals:** v0's thirteen without `maxGeneration` and `dominantShare`. These two produced all but one
  of v0's 30 false alarms; under drift they have heavy upper tails.
- **Horizon:** censuses at steps up to 300,000 only.

**Envelope.** The 40 gradient-m3 neutral runs of v0 (`replay-calib` seeds 1001 to 1020, `replay-m4` seeds 1 to
20), cut at the horizon. A fresh run is not a member, so it is scored against all 40.

**Fresh null corpus.** 70 new gradient-m3 neutral runs, seeds 2002 to 2071 (2001 was the pilot), each 300,000
steps: `tools/run.ts --experiment bell-v1-null --preset gradient-m3 --conditions neutral --steps 300000
--census 100 --deep 10 --lineage-obs`. Spots-m3 is left out of v1.

**Criterion A1.** At most 2 of the 70 fresh runs ring (binomial upper 95% bound below 0.1, test 6's null rule).
Not called if fewer than 70 load. Reading: A1 passes → **quiet on fresh drift**; fails → **still rings on drift**.

**Reported beside it, not deciding:**
- the same rule on v0's 70 at the 300,000 horizon (leave-one-out; a post-hoc look at seen data);
- v0's 13-signal rule on the fresh 70;
- the 10 treatment runs against the envelope under the v1 rule (does the bell still see the arm);
- the calibrated bell: Z* = the largest 13-signal D among the 40 envelope runs at the horizon, applied to the
  fresh 70. Under exchangeability the count above a max-of-40 threshold among 70 new runs is at most 2 with
  probability about 0.75, whatever the signals do. So this checks that thresholds transfer to new seeds and
  a new host; it says nothing about the signals themselves.

### B. Twin bell

**Bases.** `replay-m4` gradient-m3 treatment seeds 1 to 10, the bundles on disk, not rerun. Treatment worlds
are the ones a naturalist would watch.

**Twins.** For each base seed, four runs of `tools/run.ts --experiment bell-v1-twins --preset gradient-m3
--conditions treatment --seeds <k> --steps 300000 --census 100 --deep 10 --lineage-obs`. Each run carries one
intervention at step **S = 200,000**, centred at (128, 128):

| Arm | Intervention |
| --- | --- |
| nudge | `--lesion 200000:128,128,1` |
| L64 | `--lesion 200000:128,128,64` |
| L96 | `--lesion 200000:128,128,96` |
| F | `--feed 200000:128,128,32,64` |

40 twins. The realized dose (living cells and matter moved at S + 100, against the base) is recorded per twin.

**Void rule.** A twin is void if its `series.jsonl` or `lineages.tsv` differs from its base's at any census up
to and including step S, or if its intervention is refused. Void twins are reported and left out. A criterion
is not called for an arm with any void twin.

**Pair score.** For signal s (all thirteen of v0) at census t:

- z_s(t) = (x_twin(t) − x_base(t)) / spread_s(t);
- spread_s(t) = max(IQR/1.349, 5% of |median|, floor of s), over the 10 treatment bundles at t (the base is
  one of them, the twin is not). This is a unit per signal, not a reference set.
- Rates use each run's own counters, over 10 censuses.
- The score counts censuses at steps S + 100 to S + 20,000 (200 censuses).
- **W_pair = 10** consecutive censuses (1,000 steps), chosen from the pilot footprints.
- D_pair = the largest, over windows and both sides, of the window's smallest side·z, floored at 0, then the
  maximum over signals. This is v0's rolling minimum on the difference.

**Null.** The nudge pairs. Z*_pair = the largest D_pair among the 10 nudge pairs. A one-cell lesion is a real
perturbation, so this null holds chaos fixed: whatever a one-cell nudge grows into within 20,000 steps.

**Criteria**, for each primary arm A ∈ {L96, F} (L64 is reported):

- **B1, separation:** P(D_A > D_nudge) ≥ 0.8, the Mann–Whitney effect with ties counted half.
- **B2, hits:** at least 8 of the 10 twins of A have D_A > Z*_pair.

**Reading.** Both arms pass B1 and B2 → **hears events**. One arm → **hears some events** (name which). Neither →
**deaf to events beyond chaos**.

**Reported beside it:** for each hit, where its first window above Z*_pair starts (the bell should say
*when*); the share of hits whose first window starts at S + 100 to S + 5,000; L64's B1 and B2; and how fast
nudge pairs part (median D_nudge, and the step of their first nonzero difference).

### C. Part b, redesigned on the twins

C needs B's twin runs, not B's readout. It needs a yes for paid calls before any call is made.

**Digests.**
- **Window.** 30,000 steps per item, starting at S − U. U is drawn per item from {5,000, 5,200, …, 15,000}
  with mulberry32 seeded at 6,100,001, so the event does not sit at a fixed line.
- **Lines.** One line per 200 steps (151 lines), with steps written relative to the window start (t = 0 to
  30,000), so a round absolute step does not give the event away.
- **Fields per line:** living cells, individuals, mean mass, lineages, lineage Shannon, pattern entropy,
  biotic recycling, max generation, dominant share, and fissions, fusions, buddings and mutations over the
  last 1,000 steps.
- **Never shown:** run ids, seeds, conditions and interventions.

**T1, paired: 40 items** (10 seeds × 4 arms). Two digests labelled X and Y, a twin and its base, in a seeded
random order. The questions:
1. Did one of these two worlds suffer a sudden outside intervention, beyond the drift two near-identical
   worlds show? (yes or no)
2. If yes: which one, at what t, and was something removed or added?
3. Three field notes, each with its receipts (t, measure, values).

**T2, single: 50 items.** The 40 twin digests alone, plus 10 base digests with their own U. Each line also
gives the median and interquartile range of the 10 treatment runs at that step, as the stated normal. The
questions: did this world suffer a sudden outside intervention in this window? If so, at what t, and of
what kind? Plus three field notes with receipts.

**Scoring.** Ground truth: lesion = removal, feed = addition, at the line nearest S. In T1 the nudge counts as
"no"; in T2 a base digest counts as "no".

| | Struck correctly (yes, the right twin in T1, t within ±1,000 steps of S) | Kind correct | False alarms |
| --- | --- | --- | --- |
| T1 | on L96 and F (20 items) | on hits | "yes" on the 10 nudge items |
| T2 | on L96 and F (20 items) | on hits | "yes" on the 10 base digests |

**Bars, each task scored apart:** struck correctly on at least 16 of 20, and at most 2 of 10 false alarms.
L64 is reported. The model's results sit beside the code bell's on the same twins and are never pooled with
them.

**Calls.** The current Sonnet, its exact id logged, one draw per item, 90 calls. Every call's prompt, digest
hashes, output and model id go to a log beside the record, as `picks.jsonl` is kept for the picker.

**Cost estimate, to be confirmed against the price sheet before asking:** a T1 prompt is about 15,000 input
tokens and a T2 prompt about 12,000. Scaling the picker's measured cost (about 4,000 input tokens, $0.018 to
$0.030 a call) gives about $0.07 to $0.11 a call, so $6 to $10 for the 90.

## Work, in order

1. **This note.** Commit the rules first, before any v1 computation, run or digest.
2. **Code.** CPU; tests; a Codex Sol review before any run.
   - `tools/lib/bell.ts`: a horizon, a signal subset per rule, a `PairScorer` (the twin−base z with an
     ensemble unit and a scoring window, reusing `RollingMin` and `departure`), and the void check.
   - `tools/bell.ts`: `v1-null` and `v1-twins` subcommands with their corpora, writing
     `experiments/naturalist/bell-v1-null.json` and `bell-v1-twins.json`.
   - `tools/bell-digest.ts`: builds the blinded T1/T2 items from the twins, and scores answers against
     ground truth.
   - A launcher that runs the 110 `tools/run.ts` invocations three at a time.
3. **GPU runs (wait for a yes).** 70 nulls and 40 twins, 3.3×10⁷ steps. About 4.5 hours, three at a time, on
   this machine. About 27 MB per run, about 3 GB under `runs/bell-v1/` in the main checkout.
4. **Readouts A and B.** CPU, minutes; recorded against the rules above, whatever they say.
5. **Part b.** Build the digests (CPU), then ask for the yes; only then the calls, and scoring.

## Not in v1

- Spots-m3 and the no-mutation arm.
- An envelope of the arm's own runs (a within-treatment bell).
- Twins forked in the lab at the moment an experimenter acts. B is the headless version of that.
