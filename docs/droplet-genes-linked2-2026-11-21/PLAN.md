# Droplet genes, linked templates, second screen: low rates at matched capacity

**Date:** 2026-11-21. **Branch:** `claude/dropgenes-linked2` from `b1972800`.
**First screen:** [../droplet-genes-linked-2026-11-21/PLAN.md](../droplet-genes-linked-2026-11-21/PLAN.md) (rules L1 to
L10) and its [CALIBRATION.md](../droplet-genes-linked-2026-11-21/CALIBRATION.md). **First rung:**
[../droplet-genes-2026-11-21/PLAN.md](../droplet-genes-2026-11-21/PLAN.md) and `RESULTS.md`.
**Record of this screen:** [CALIBRATION.md](./CALIBRATION.md).
**Status (2026-11-22):** run to its end; negative under the second stop rule. See "Outcome" at the foot.

## What this is, stated first

**This is a second screen, made after the first screen's stop rule had fired**, and with one result known in
advance that the first screen's list did not contain: the diagnostic `x00` (joining, breaking and loss all 0,
one site per molecule), which held four genes without the parasite on 2 of 2 seeds at about 60 compartments,
and with the parasite on 1 of 4. So the settings below were chosen knowing where the first list failed and
roughly where a ceiling lies. Nothing here is evidence: every run is on seeds 1 to 8, all seen for this world.
A setting can only be frozen for a later confirmation on unseen seeds 17 to 24, which this line does not run.

The first screen did not isolate the question, for two reasons this screen is built around:

1. All 12 of its settings lost every compartment **without** the parasite too, so their failure with the
   parasite says nothing about the parasite. Here the clean arm is a gate, judged before any parasite run.
2. `x00` lived under one site per molecule at 16 sites, which holds four times the gene copies of the unlinked
   arm it was compared with. Here the unlinked arm is given the same room.

## Question

**At breaking and loss rates below `1e-4`, with site capacity matched between the linked and unlinked arms, do
linked genes let a gated compartment hold four genes with the parasite present where separate genes do not?**

## Fixed

- **No kernel edit.** `apps/lab/src/dropgenes/kernel.ts` is byte-identical to `b1972800`. Nothing in `packages/`,
  no `RULE_VERSION` change. Changes: `apps/lab/src/dropgenes/observe.ts` (new readouts only),
  `experiments/dropgenes/` and tests.
- `LARGE` exactly as the first rung froze it: `diffT 0.1`, `diffW 0.03`, `diffF 0.6`, `diffA 0.44`, `mutPar 1e-4`
  (0 in a clean arm), everything else `defaultDropGenesConfig()`; 64 x 64; founders a 4 x 4 grid of spots with two
  copies of every gene on every wall tile, as two full templates in a linked run. Only the link keys and the
  sites per tile vary.
- **Seeds 1 to 4 decide everything. Seeds 5 to 8 only for the repeats named below. No seed above 8.**
- "Held" for a run is the first rung's: over the last tenth of the run a mean of at least 10 compartments, at
  least half of them carrying every gene (a gene counted wherever it sits). A run "loses" when it is not held.
- An **admissible** setting has `linkJoin`, `linkBreak` and `linkLoss` all above 0. A setting with any of them
  at 0 is a labelled diagnostic and can never be frozen.

## The rates that exist below 1e-4

The kernel holds `linkBreak` and `linkLoss` as k / 65536 (rounded to the nearest k), so below `1e-4` there are six
rates. The driver passes k / 65536 exactly.

| k | realised rate | mean steps to one break, per molecule |
|---|---|---|
| 1 | 1.526e-5 | 65,536 |
| 2 | 3.052e-5 | 32,768 |
| 3 | 4.578e-5 | 21,845 |
| 4 | 6.104e-5 | 16,384 |
| 5 | 7.629e-5 | 13,107 |
| 6 | 9.155e-5 | 10,923 |

The first screen's `1e-4` was k = 7 (1.068e-4). A template lasts about 50 steps (`kDecT 0.02`). `linkBreak` is per
molecule per step; `linkLoss` is per new copy. A rate between 0 and k = 1 cannot be set without a kernel change.

## Capacity matching

Two families of linked settings, each against **the unlinked arm at 16 x K sites per tile** (64 at K = 4):

- **M** (`M16`): `linkSites: molecule`, 16 sites per tile.
- **G** (`G64` at K = 4): `linkSites: gene`, 16 x K sites per tile.

What "matched" means, and what it does not:

- With every template full, a tile at wall 1.0 holds the same number of gene copies in the linked arm and in
  the unlinked arm: 16 x K.
- Under **G** every molecule takes one site per gene in both arms, so the room is the same whatever the
  templates' lengths. A copy of a full template needs K free sites at once.
- Under **M** the match holds for full templates only. A shortened template or a single copy takes a whole one
  of 16 sites, and so does a parasite copy, against one of 16 x K in the unlinked arm. So in M a tile of
  single copies holds a quarter of what the unlinked arm's tile holds, and a parasite copy displaces a full
  template, not a single gene.
- Sites on a tile are `floor(min(wall, 1) * sites)`, so at 16 sites a thin-walled tile has room in coarser
  steps than at 64.
- **Joining is not matched by its number.** A join attempt draws two of the tile's `capPerTile` slots, so on a
  tile holding no more molecules than `capPerTile` the chance per attempt that two given molecules meet is
  2 / (16 x 15) = 1/120 at 16 sites and 2 / (64 x 63) = 1/2,016 at 64 sites, about 17 times lower. There,
  `linkJoin 0.05` at 64 sites is per pair what `linkJoin 0.003` would be at 16, and `linkJoin 1` at 64 sites is
  per pair 1.19 times `linkJoin 0.05` at 16. A tile holding more molecules than `capPerTile` (hops and breaks
  can overfill one) draws from as many slots as it has molecules, so the chance per pair is lower there (1/190
  for 20 molecules) and these ratios do not apply.

The two families bracket the site rule; neither is "the" matched comparison alone.

## Protocol

### Step 0. The unlinked control, first

Unlinked (link keys absent, the first-rung kernel), K = 4, 64 sites per tile, `GATED_CLEAN` and `GATED_PAR`,
seeds 1 to 4, 50,000 steps. This cell had never been run. How it is read was written down before the first
step 0 run (`runs/dropgenes/linked2/STEP0-READING-2026-11-21.md`, copied here):

1. **Horizon.** An arm with at least one seed held at 50,000 steps is run again on all four seeds at 200,000
   steps (a run is deterministic, so a seed that lost its last compartment before 50,000 repeats that). The
   count that decides is the count of seeds held at the longest horizon the arm was run at.
2. **Branch on `GATED_PAR`** by that count.
   - At most 1 of 4: go on at K = 4.
   - 3 of 4 or more: capacity alone is enough at K = 4. Repeat step 0 at K = 6 with 96 sites, then K = 8 with
     128 sites (sites = 16 x K; family G at the same sites, family M at 16). The screen is run at the smallest K
     where the unlinked arm with the parasite is held on at most 1 of 4, with the same list (the table below
     with K and the G sites replaced), the same gates and the same rules. If it is still held at K = 8, stop
     and report "capacity suffices up to eight genes; linking is not needed in this range".
   - Exactly 2 of 4: seeds 5 to 8 as well, both arms, and decide on 8 seeds: at most 2 of 8 goes on; 6 of 8 or
     more is "capacity suffices"; between, report "unclear control" and go on at K = 4 with that stated.
3. **`GATED_CLEAN` has no branch.** If it is held on fewer than 3 of 4 at its longest horizon, the write-up says
   the unlinked world at 64 sites is not viable without the parasite either, so its loss with the parasite is
   not evidence about the parasite. The branch in 2 is still taken by its count.

**Known when the list below was fixed:** the four `GATED_PAR` runs of step 0 had finished (held on 0 of 4 at
50,000 steps; the last compartment gone at step 11,600, 14,450, 5,750 and 15,200), so by rule 1 that arm is not
run at 200,000 and by rule 2 **the screen is at K = 4**. The `GATED_CLEAN` runs of step 0 were still running. No
linked run had been made.

### Step 1. The list (fixed before any linked run; at most 12; none added later)

All: linked, K = 4, linked founders, `LARGE`, 64 x 64. Family M is `linkSites: molecule` at 16 sites; family G is
`linkSites: gene` at 64 sites.

| setting | family | `linkJoin` | `linkBreak` (k, rate) | `linkLoss` (k, rate) | why it is in the list |
|---|---|---|---|---|---|
| s01 | M | 0.05 | 1, 1.526e-5 | 1, 1.526e-5 | the lowest rates that exist |
| s02 | M | 0.05 | 1, 1.526e-5 | 4, 6.104e-5 | more loss on copy |
| s03 | M | 0.05 | 4, 6.104e-5 | 1, 1.526e-5 | more breaking |
| s04 | M | 0.05 | 4, 6.104e-5 | 4, 6.104e-5 | both, still below 1e-4 |
| s05 | G | 0.05 | 1, 1.526e-5 | 1, 1.526e-5 | as s01 under one site per gene |
| s06 | G | 0.05 | 1, 1.526e-5 | 4, 6.104e-5 | as s02 |
| s07 | G | 0.05 | 4, 6.104e-5 | 1, 1.526e-5 | as s03 |
| s08 | G | 0.05 | 4, 6.104e-5 | 4, 6.104e-5 | as s04 |
| s09 | M | 1 | 1, 1.526e-5 | 1, 1.526e-5 | pieces rejoin as fast as the rule allows, lowest rates |
| s10 | M | 1 | 4, 6.104e-5 | 4, 6.104e-5 | the same at the higher rates |
| s11 | G | 1 | 1, 1.526e-5 | 1, 1.526e-5 | joining per pair about equal to family M at 0.05 |
| s12 | G | 1 | 4, 6.104e-5 | 4, 6.104e-5 | the same at the higher rates |

Why `linkJoin 1` is in the list at all:

- **Family G (s11, s12):** at 64 sites `linkJoin 0.05` is 17 times less joining per pair of molecules than the
  same number at 16 sites (above), so s05 to s08 are close to "no rejoining". `linkJoin 1` at 64 sites is the
  value whose rate per pair is nearest family M's 0.05. Without s11 and s12 a difference between the families
  could be the joining rate and not the site rule.
- **Family M (s09, s10):** in the first screen's clean diagnostic, the `linkJoin 1` settings lost their last
  compartment later than their `linkJoin 0.05` twins on all four comparisons (c05 against c01: step 11,400
  and 15,800 against 8,950 and 11,400; c06 against c02: 13,200 and 9,150 against 8,200 and 7,900). Two seeds,
  no rule attached then; it is the only sign so far that rejoining helps a world started from full templates.

Joining acts only on pieces: a full template shares a gene with every other gene-carrying molecule, so it
never joins.

### Step 2. Clean gate (a gate, not a diagnostic)

Each listed setting, linked, `GATED_CLEAN`:

1. Seeds 1 and 2 at 50,000 steps. A setting that loses both is dropped.
2. Survivors: seeds 1 to 4 at **200,000 steps** (four new runs; the 50,000-step runs are not continued).
3. A setting **passes the gate** only if it is held on at least 3 of 4 at 200,000 steps.

The first screen's clean worlds with linked founders, one site per molecule and breaking at k = 7 (c01, c02,
c05, c06) lost their last compartment at step 7,900 to 15,800. (Its other clean worlds ended before step
1,000, except c12, single founders under one site per gene, at 8,100 and 20,950.) A lower rate could move the
same decay past 50,000 steps, which is why the gate is judged at 200,000. A setting that fails
(at either stage) is labelled "not viable without the parasite" and gets no parasite run.

### Step 3. Parasite screen

Only settings that passed the gate, linked, `GATED_PAR`:

1. Seeds 1 and 2 at 50,000 steps. A setting that loses both is dropped. Otherwise seeds 3 and 4 at 50,000.
2. A setting held on at least 3 of 4 at 50,000: seeds 1 to 4 at 200,000 steps.
3. **Choice** among the settings held on at least 3 of 4 at 200,000 steps: most seeds held, then the higher
   mean of late compartments over its four seeds at 200,000, then the lower list number.

The unlinked arm it is compared with is step 0's (`GATED_PAR`, 64 sites, seeds 1 to 4).

### Step 4. Stop at the pre-confirmation boundary

No seed above 8 is run. If a setting is chosen it is frozen below with the pass rule for seeds 17 to 24, the
exact commands and a run-time estimate. The confirmation itself is not run by this line.

## Stop rules

- No setting passes the clean gate: the line ends "linked four-gene templates are not viable at any settable
  rate (k at least 1)". Report whether `x00`-like diagnostics at 64 sites under `gene` live, and name a finer
  rate resolution as the follow-up. Do not build it.
- Settings pass the clean gate and none is held with the parasite on 3 of 4: the line ends negative, and this
  time it is a clean no for those settings.
- At most 12 listed settings. No setting is added after the first linked run.

How the second rule is applied: "held with the parasite on 3 of 4" is at 200,000 steps. A setting that is not
held on 3 of 4 at 50,000 steps is not run at 200,000 and counts as not held.

## Readouts added (observer and summariser; the kernel is not touched)

1. **Molecules by length.** `run.ts` writes, for a linked run, the number of gene-carrying molecules carrying
   1 to K genes over the whole arena at every census (every 50 steps, from step 0): `lengths.byLength` in the
   run file. The report rows (every 2,000 steps) already carried the same counts. The summariser prints the
   share of molecules that are full templates at steps 2,000, 10,000, 50,000 and 200,000, per seed, and the
   shares by length summed over seeds. A run that had ended before a step, or was not planned that long, shows
   n/a there. For the gate runs these four steps are reported in CALIBRATION.md.
2. **Which gene was missing when a compartment ended.** This can be read from the observer without a kernel
   change. The tracker already kept, for each compartment it saw end (nothing overlaps it at the next census),
   whether it was complete at its last census. It now also keeps which genes were missing then and since which
   census (`deathRecords`; a compartment born by a split starts from its parent's record; a gene that comes
   back clears its date). `summary.deathGenes` gives: deaths recorded, deaths with a gene missing at the last
   census, deaths by gene, deaths by the number of genes missing, the median steps from "first seen missing" to
   "gone", and the share seen missing at two censuses or more. Limits: a census is every 50 steps, about one
   template lifetime, so "missing at the last census" is at most 50 steps before the wall was last seen, and a
   gene lost and regained between censuses is not seen. Compartments absorbed by a fusion are not deaths.
   `summary.lastCompartments` gives, for a run that lost every compartment, the copies per gene over the whole
   arena and inside compartments at the last census that still had one.

The edit must not change what existing runs report. Checks, recorded in CALIBRATION.md:

- the old and the new `summarize.ts` over the first screen's four run directories: every table that existed
  prints the same, in the same order; the new tables are printed after the last of them;
- a replay of a first-screen unlinked run (K = 4, 16 sites, `GATED_PAR`, seed 1; made before this plan was
  written, it is not a linked run): every field of the old file is equal in the new one apart from the two
  timing fields;
- a replay of the first screen's `c01`, seed 1, `GATED_PAR` and `GATED_CLEAN` (linked, 16 sites): made after this
  plan was reviewed and its dated copy taken, before the gate. Same comparison.

## Runs outside the list (all labelled, none can be frozen or change a choice)

- **Replays** above (`regress`).
- **`d-g0`:** family G with joining, breaking and loss all 0 (the `x00` of one site per gene at 64 sites), linked
  founders, `GATED_CLEAN` and `GATED_PAR`, seeds 1 to 4, 50,000 steps. Made after the 50,000-step stage of the
  gate, whatever the gate shows. It is the bound "rates go to 0" for family G, and the first stop rule asks
  for it. The same diagnostic for family M is the first screen's `x00` (clean 2 of 2 on seeds 1 and 2; with the
  parasite 1 of 4), which is not repeated.
- **Only if the first stop rule fires:** `d-g0` and `d-m0` (family M, all three at 0), `GATED_CLEAN`, seeds 1 to 4,
  200,000 steps, so the write-up can say whether a failed gate is breaking and loss at k at least 1 or the
  200,000-step horizon itself.
- **Only if a setting is chosen:** a repeat of the chosen setting on seeds 5 to 8, linked `GATED_PAR` and
  `GATED_CLEAN`, 200,000 steps, and the unlinked control on seeds 5 to 8 (`GATED_PAR`, 64 sites, 50,000 steps,
  200,000 by rule 1 of step 0 applied to those seeds). Reported beside the screen. The freeze stands whatever
  it shows; the write-up gives both counts.
- **Only if a setting is frozen:** side checks on seeds 1 to 4 at 50,000 steps, linked K = 2 `GATED_PAR` and
  `GATED_CLEAN` with the frozen setting's keys (only `genes` changed). If linked K = 2 `GATED_PAR` is not held on
  3 of 4 the write-up says linking breaks what the first rung held.
- **Not run by this line:** any ungated arm, K = 6 or 8 (unless step 0 sends the screen there), any seed above
  8, any rate between 0 and k = 1.

## Pass rule for the confirmation (unseen seeds 17 to 24, 200,000 steps, 64 x 64)

Carried over from the first screen's plan; written before any linked run of this screen. Used only if a
setting is frozen.

**The rule is decided on seeds 17, 18, 19 and 20**, the same four for every arm and control. Seeds 21, 22, 23
and 24 are a second block, run on the same arms and judged by the same rule, reported beside the first as a
repeat. The verdict is the first block's. If the second block gives another verdict the result says "not
repeated" and reports both. Every "of 4" is within one block. K is the K of the screen (4).

- **Pass:** linked K `GATED_PAR` at the frozen setting is held on at least 3 of 4, **and** the capacity-matched
  unlinked arm (unlinked K `GATED_PAR` at 16 x K sites) is held on at most 1 of 4.
- **The compartment is the cause** only if, as well, linked K `UNGATED_PAR` is held on at most 1 of 4 and linked
  K `UNGATED_CLEAN` is held on at least 3 of 4 (so ungating alone does not end the linked world). If linked
  `UNGATED_PAR` is held on 3 of 4, linking holds the genes without a closed compartment and the result says so.
- **Linking does not break the first rung:** linked K = 2 `GATED_PAR` with the frozen setting's keys held on at
  least 3 of 4.
- Also run and reported, no rule attached: linked and unlinked `GATED_CLEAN`.
- A pass under family M is a pass for "linked templates at one site per molecule against separate genes with
  the same room for full templates"; the limits of that match (above) go in the result. A pass under family G
  has the stricter match.

Frozen setting, commands and run-time estimate: see "Outcome" below, filled in when the screen ends.

## Cost, measured before the list was fixed

The four step 0 `GATED_PAR` runs took 36 to 73 seconds each with two running at once on a heavily loaded
machine (load average about 90 on 10 cores); they ended between step 5,750 and 15,200, so about 200 to 330
steps per second. At that speed a run that lives costs about 3 to 4 minutes at 50,000 steps and 10 to 17
minutes at 200,000. Upper bound if all 12 settings pass the gate and are held with the parasite: 24 + 48 runs
for the gate, 48 + 48 for the parasite screen, about 25 core-hours, 12 to 13 hours at two at a time. A setting
that dies costs seconds to a few minutes. All 12 slots are used.

## Review before the first linked run

Codex (Sol 6.1, High, read-only) reviewed this plan and the code on 2026-11-21, in two passes, before any
linked run. It found no P1 or P2 in the plan, the observer, the runner, the summariser or the tests. In the
driver it found one P1 and two P2 on the first pass (it trusted a file by its name; it could go on past an
incomplete stage; `step0-more` did not check its own condition) and one more P1 on the second (its own check
of a file covered only the keys it sets, not the defaults or the protocol). All four were fixed before the
first linked run, with the first pass's four smaller points (two wordings above, the order of the
summariser's tables, thinner tests). The findings and what was done are in
CALIBRATION.md. The list, the gates and the rules were not changed by the review.

## Changes to this plan after the first linked run

The first linked run was made on 2026-11-21 at 22:48 (the replays, then the gate). The copy of this file as it
stood before it is `runs/dropgenes/linked2/PLAN-before-first-linked-run-2026-11-21T2236.md` (not in git), with
the sha256 of the plan and the code at that moment.

- 2026-11-22: the "Outcome" section below was filled in and the status line under the title was added. No
  setting, gate, rule or readout was changed, added or removed.
- 2026-11-22: "Review before the first linked run" was corrected. As copied before the first linked run it
  named only the first review pass (one P1, two P2); the second pass's P1 had been found and fixed before
  that copy was taken, and the sentence had not been updated.
- Not a change to the plan, recorded here because it is a change after the first linked run: the driver
  `experiments/dropgenes/linked2.py` got a filter (`LINKED2_ONLY`) that limits which settings one invocation
  runs, after the gate's first two settings had finished at 200,000 steps. What is eligible is still decided
  from every setting.
- A departure in order, not in rule: `d-g0` was made after the parasite screen, not after the 50,000-step stage
  of the gate. No decision reads it.

## Outcome (2026-11-22)

**The line ended negative under the second stop rule: a clean no for the nine settings that passed the gate.**

- Step 0: unlinked K = 4 at 64 sites, held without the parasite on 4 of 4 (200,000 steps), with it on 0 of 4.
  The screen ran at K = 4.
- Clean gate: nine of 12 settings passed (s01 to s06, s09, s10, s11: held on 4 of 4 at 200,000 steps, full
  templates 39% to 89% of molecules over the last tenth of the run). s07 and s12 were dropped at 50,000 steps and s08 was held on 2
  of 4: "not viable without the parasite".
- Parasite screen: each of the nine lost seeds 1 and 2 at 50,000 steps (last compartment gone at step 1,450 to
  14,100) and was dropped. None is held on 3 of 4.
- Nothing is frozen. The pass rule above was never used, no confirmation is proposed, no seed above 4 was run.

The record, the readouts, the diagnostics and the limits are in [CALIBRATION.md](./CALIBRATION.md).
