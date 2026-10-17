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

**Revision.** The rules were first committed in df81ac9. A read-only Codex Sol 6.1 xhigh review found seven
P1s and five P2s, and the section below replaces that version. Nothing of v1 had run then; the earlier text
is in git. What changed and why is under "Review" at the end.

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

## Fixed before running (2026-10-17, revised the same day before any run)

All readings below are **exploratory**: a bar met or missed by small samples, with the power stated. None is a
registered result.

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
steps. Spots-m3 is left out of v1. The command:

```
deno run -A tools/run.ts --experiment bell-v1-null --preset gradient-m3 --conditions neutral --seeds 2002-2071 \
  --steps 300000 --census 100 --deep 10 --lineage-obs --out /Users/nicholas/develop/browser-life/runs
```

The launcher splits the seed range across three processes. A fresh run counts only if it exits 0 and its
manifest has a summary. It must also have all 3,000 censuses and the lineage census cross-checks of v0
(`mergeCensuses`).

**Criterion A1.** At most 2 of the 70 fresh runs ring (binomial upper 95% bound below 0.1, test 6's null rule).
Not called if fewer than 70 count. Reading: A1 met → **quiet on fresh drift (exploratory)**; missed →
**still rings on drift**.

**Power, stated now.** If the true false-alarm rate is 2%, A1 is met with probability about 0.84; at 5%,
about 0.31. A1 can tell a bell near 2% from one near 10%; it cannot certify 5%.

**Reported beside it, not deciding:**
- the same rule on v0's 70 at the 300,000 horizon (leave-one-out; a post-hoc look at seen data);
- v0's 13-signal rule on the fresh 70;
- the 10 treatment runs against the envelope under the v1 rule (does the bell still see the arm);
- the calibrated bell: Z* = the largest 13-signal D among the 40 envelope runs (each scored leave-one-out),
  applied to the fresh 70. Descriptive only. The calibration runs have 39 references and the fresh runs
  40, so no distribution-free rate is claimed.

### B. Twin bell

**Bases.** `replay-m4` gradient-m3 treatment seeds 1 to 10, the bundles on disk, not rerun. Treatment worlds
are the ones a naturalist would watch. These histories were scored in v0; what is new here is the interventions.

**Arms.** Five per base, each run once, with one intervention at step **S = 200,000**:

| Arm | Intervention | Centre |
| --- | --- | --- |
| nudge | lesion r = 1 (the 5 sites with dx² + dy² ≤ 1) | the cell with biomass B > 0 nearest (128, 128) |
| nudge2 (held out) | lesion r = 1 | the cell with B > 0 nearest (64, 64) |
| L64 | lesion r = 64 | (128, 128) |
| L96 | lesion r = 96 | (128, 128) |
| F | feed r = 32, 64 quanta per cell | (128, 128) |

- **How a nudge centre is found.** From the base's checkpoint `checkpoints/t000200000.blck` (the state at S,
  before any intervention). Distance is squared Euclidean on the torus, the lesion's own neighbourhood. Ties go
  to the smaller y, then the smaller x.
- **Why.** A fixed centre can land on empty cells: treatment seed 7 has no biomass, polymer or free energy at
  the five sites around (128, 128) at S, so a nudge there would change nothing. A centre with B > 0 makes
  every nudge a real perturbation. Its centre and dose are recorded before launch.
- **Dose.** Recorded per twin: living cells and matter moved at S + 100, against the base.

50 twins. The command per arm and seed:

```
deno run -A tools/run.ts --experiment bell-v1-twins-<arm> --preset gradient-m3 --conditions treatment --seeds <k> \
  --steps 300000 --census 100 --deep 10 --lineage-obs <intervention> --out /Users/nicholas/develop/browser-life/runs
```

`<intervention>` is `--lesion 200000:<x>,<y>,<r>` or `--feed 200000:128,128,32,64`. One experiment name per
arm keeps the 50 output directories distinct, because a run's directory does not include its interventions.
The launcher checks that all 120 destinations of A and B are distinct and absent before it starts.

**Valid twin.** A twin counts only if all of these hold, and is void otherwise:
- it exits 0, and its manifest has a summary and 3,000 censuses;
- its `interventions.jsonl` holds exactly the one scheduled entry, applied;
- its `series.jsonl` and `lineages.tsv` equal its base's at every census up to and including step S;
- it differs from its base at some census after S.

Void twins are reported.
- **Arm-level calls.** Criteria are called only when all 10 nudge twins and all 10 twins of the arm are valid.
- **Nudge2.** B3 is called only when all 10 nudge2 twins are valid.

**Pair score.** For signal s (all thirteen of v0) at census t:

- z_s(t) = (x_twin(t) − x_base(t)) / spread_s(t);
- spread_s(t) = max(IQR/1.349, 5% of |median|, floor of s), over the 10 treatment bundles at t (the base is
  one of them, the twin is not). This is a unit per signal, not a reference set.
- Rates use each run's own counters, over 10 censuses. Before S + 100 every difference is exactly 0.
- **W_pair = 10** consecutive censuses (1,000 steps), chosen from the pilot footprints.
- **Early windows only.** A window counts only if its first census is at a step from S + 100 to S + 5,000;
  the last such window ends at S + 5,900.
- D_pair = the largest, over counted windows and both sides, of the window's smallest side·z, floored at 0,
  then the maximum over signals.
- So a hit is necessarily a departure that begins within 5,000 steps of the intervention and holds for 1,000
  steps; a late divergence cannot count.

**Null.** Z*_pair = the largest D_pair among the 10 nudge twins: whatever a nudge of five cells grows into
early on. Ties of D at Z*_pair do not count as hits (strict >).

**Criteria**, for each primary arm A ∈ {L96, F}:

- **B2, hits:** at least 8 of the 10 twins of A have D_A > Z*_pair.
- **B3, the threshold held out:** at most 2 of the 10 nudge2 twins have D > Z*_pair. Reported with its
  binomial bound.

**Reading.**

| Outcome | Reading |
| --- | --- |
| B2 met for both arms and B3 met | **hears events (exploratory)** |
| B2 met for one arm and B3 met | **hears some events**, naming the arm |
| B3 missed | **its threshold does not hold out**, whatever B2 says |
| otherwise | **did not meet the exploratory bar** |

**Power, stated now.**
- **B2.** A true 80% hit rate gives 8 of 10 with probability about 0.68, and 8 of 10 observed has a one-sided
  95% lower bound of about 0.49.
- **B3.** A max-of-10 threshold has a true exceedance above 10% in about 35% of samples (0.9¹⁰). So B3 is a
  coarse check, and the bound is reported with it.
- **Shared histories.** All arms share the same ten base histories.

**Reported beside it:** the Mann–Whitney effect P(D_A > D_nudge) for each arm (B2 implies it is at least 0.8,
so it is not a criterion); L64's B2; the step at which each hit's first window above Z*_pair starts; the
nudges' median D and the step of their first nonzero difference; and everything per seed.

### C. Part b, redesigned on the twins

C needs B's twin runs, not B's readout. It needs a yes for paid calls before any call is made. A twin that is
void in B is void here: its items are left out and reported, and a task is not called if any of its scored
items is missing.

**Items, frozen in a manifest before the yes.**
- **The manifest is built by `tools/bell-digest.ts` and committed:** task, seed, arm, U and (in T1)
  orientation for every item.
- **Enumeration.** T1 first: seeds 1 to 10, each with arms nudge, L64, L96 and F. Then T2: the same 40
  twins, then nudge2 for seeds 1 to 10, then the 10 bases.
- **Randomness.** One mulberry32 stream seeded at 6,100,001, consumed in item order: U first, then the
  orientation coin in T1. T2 draws its own U, so a twin's T1 and T2 windows differ.
- **The window.** 30,000 steps from S − U, with U from {5,000, 5,200, …, 15,000}. With line spacing 200,
  line t = U is the census at S, before the intervention, and t = U + 200 is the first line after it.

**Digests.**
- **Lines.** One line per 200 steps (151 lines); steps relative to the window start.
- **Fields per line:** living cells, individuals, mean mass, lineages, lineage Shannon, pattern entropy,
  biotic recycling, max generation, dominant share, and fissions, fusions, buddings and mutations over the
  last 1,000 steps (C(t) − C(t − 1,000), from the run's own history, including before the window).
- **Number format:** integers as integers, other values to 3 decimals.
- **Never shown:** run ids, seeds, conditions and interventions.

**T1, paired: 40 items, a positive control.** Two digests labelled X and Y, a twin and its base, in the
manifest's orientation. They are identical up to line t = U, so the timing is given away by an equality scan,
and T1 does not score timing. It asks whether the divergence is an outside intervention or the drift a tiny
nudge grows into, which twin, and what kind. Scored on: "yes" on L96 and F and "no" on nudge; the right twin
and kind on hits. The code baseline is B's pair score on the same items.

**T2, single: 60 items, the primary model task.** One digest alone: the 40 T1 twins, then the 10 nudge2 twins
and the 10 bases, each with its own U.
- **The stated normal:** each line also gives the median and the 25th and 75th percentiles of the 9 other
  treatment bundles at that step, leaving out the item's own seed, so positives and negatives are built the
  same way.
- **The question:** did this world suffer a sudden outside intervention in this window? If so, at what t, and
  of what kind?
- **Scored on:**
  - L96 and F (20 items): "yes" with |t − U| ≤ 1,000. Kind is reported on hits.
  - False alarms: "yes" on any of the 30 negatives (10 nudge, 10 nudge2, 10 bases), reported per class.

**Answer contract.** The prompt asks for one JSON object:

```
{"intervention": "yes" | "no",
 "world": "X" | "Y" | null,          // T1 only
 "t": integer | null,                 // relative step, a multiple of 200
 "kind": "removal" | "addition" | null,
 "notes": [{"t": integer, "measure": string, "values": string, "note": string}, x3]}
```

- **Retries and failures.** One retry on a reply that fails the schema. A reply that still fails, or a
  refusal, counts as a miss on a positive item and as a false alarm on a negative one.
- **What is scored.** `intervention`, `world`, `t` and `kind` only. The notes are kept and reported, with
  receipts checked against the digest, but not scored.
- **What gets frozen.** The prompt text, the schema, the model id (the current Sonnet), its settings and the
  item manifest are committed, and their SHA-256 recorded, before the yes. A change after that voids the run.

**Bars, each task scored apart.**

| Task | Bar |
| --- | --- |
| T1 | right on at least 16 of the 20 L96 and F items, and at most 2 "yes" of 10 nudges |
| T2 | at least 16 of 20 hits, and at most 3 false alarms of the 30 negatives |

The model's results sit beside the code's on the same items and windows: B's pair score for T1. For T2, the
v1 envelope rule is applied to the digest's window against the 9-run band, as a code baseline. They are never
pooled. The 20 primary items share ten base histories, so their binomial bounds are optimistic.

**Calls.** 100 (40 + 60), one draw each. Every call's prompt hash, digest hash, output and model id go to a
log beside the record, as `picks.jsonl` is kept for the picker.

**Cost estimate, to be confirmed against the price sheet before asking:** a T1 prompt is about 15,000 input
tokens and a T2 prompt about 14,000. Scaling the picker's measured cost (about 4,000 input tokens, $0.018 to
$0.030 a call) gives about $0.07 to $0.11 a call, so $7 to $11 for the 100.

## Work, in order

1. **This note.** Commit the rules first, before any v1 computation, run or digest.
2. **Code.** CPU; tests; a Codex Sol review before any run.
   - `tools/lib/bell.ts`: a horizon, a signal subset per rule, a `PairScorer` (the twin−base z with an
     ensemble unit and an early-window range, reusing `RollingMin` and `departure`), and the validity checks.
   - `tools/bell.ts`: `v1-null` and `v1-twins` subcommands, writing `experiments/naturalist/bell-v1-null.json`
     and `bell-v1-twins.json`.
   - `tools/bell-nudge.ts`: finds the nudge centres from the S checkpoints.
   - `tools/bell-digest.ts`: builds the manifest and digests, and scores answers against the contract.
   - A launcher that checks all 120 destinations, then runs the `tools/run.ts` invocations three at a time.
3. **GPU runs (wait for a yes).** 70 nulls and 50 twins, 3.6×10⁷ steps: about 4.8 hours on this machine,
   three at a time.
   - **Disk.** A 300,000-step neutral bundle is about 26 MB; a treatment one is about 62 MB (median of the
     bases cut at 300,000). That is about 1.8 GB for the nulls and 3.1 GB for the twins, so budget 6 GB under
     `runs/` in the main checkout.
4. **Readouts A and B.** CPU, minutes; recorded against the rules above, whatever they say.
5. **Part b.** Build the manifest and digests (CPU), commit them, then ask for the yes; only then the calls,
   and scoring.

## Not in v1

- Spots-m3 and the no-mutation arm.
- An envelope of the arm's own runs (a within-treatment bell).
- Twins forked in the lab at the moment an experimenter acts. B is the headless version of that.

## Review

The first version (df81ac9) had a read-only Codex Sol 6.1 xhigh review before anything ran. Its findings
and what changed:

1. **P1. T1 gave the event step away.** The pair is identical up to S, so an equality scan finds the step.
   T1 became a positive control that does not score timing; T2, a single digest, is the primary model task.
2. **P1. B could count a divergence 19,000 steps late as a hit.** Only windows starting within 5,000 steps of
   S count now.
3. **P1. A one-cell nudge at a fixed centre could hit nothing.** At treatment seed 7, the five sites at
   (128, 128) are empty at S. Nudges now land on the biomass cell nearest the centre; "r = 1" is stated as 5
   sites.
4. **P1. T2 left out the null B uses.** Nudges count as negatives in T2 now. The stated normal leaves out the
   item's own seed, so positives and negatives are built the same way.
5. **P1. The commands were not runnable as written.** A had no `--seeds`, the twins' arms shared one output
   directory, and `--out` defaulted to the worktree. All are now explicit and checked by the launcher.
6. **P1. The void rule missed crashed and unscheduled twins**, and the nudges' role in every arm's call. The
   validity checks above cover both.
7. **P1. Part b had no scoring contract.** It has a schema, failure handling, relative-step timing and a
   frozen manifest now.
8. **P2. The calibrated bell's 0.75 assumed a construction it does not have.** It is now descriptive.
9. **P2. B1 was implied by B2.** It is reported, not a criterion. B3 (a held-out nudge) checks the threshold.
10. **P2. The categorical readings overstated small samples.** Readings are now exploratory, with power
    stated.
11. **P2. The digests could be built two ways.** The manifest, the enumeration, the PRNG order, the number
    format and the rate formula are fixed now.
12. **P2. The disk estimate used neutral sizes for treatment twins.** It is budgeted per corpus now.
