# SPOT6: plan (written 2026-11-22, before any six-wall run at a non-default rate)

## Question

Is there a setting of the frozen droplet kernel where a six-wall world with phage has compartments (bodies
that last, stay put, are bounded and arise by division) and also keeps the turnover among wall patterns that
won the confirmation?

Background: `docs/b2-compartment-check-2026-11-21/RESULT.md` found that at the kernel's default rates the
counted "droplets" of the six-wall phage world are crests of moving waves (4 of 4 seeds), and that a one-wall,
no-phage 64 x 64 world at the sandbox line's spot rates is a fixed lattice of about 120 small bodies (4 of 4
seeds). Nothing has yet been run with six walls at any rate other than the default.

Every run in this plan is on seeds 1 to 4, which have been used before. Nothing here is evidence. The plan ends
at the point where a setting would be frozen for unseen seeds 33 to 40; those are not run.

## What had been seen when this plan was written

- The confirmation's files and result (seeds 5 to 12) and the compartment check's (seeds 13 to 16, and its
  seed 1 development runs).
- This line's parity check (below): all four arms at the **default** rates, seed 1, 5,000 steps.
- No six-wall world at a non-default rate, on any seed, by any tool. The first such run is the GPU against CPU
  check in step 0 below (100 steps), after this plan and its review.

## Method

**Kernel.** The frozen kernel, unedited. Every run starts by checking the files in
`experiments/confirm/FROZEN.json` against their hashes. A setting is a set of config overrides.

**Runner.** `experiments/spot6/run.ts`. It builds each arm as `experiments/confirm/run-droplets.ts` does
(`defaultDropletKernelConfig({ width: 128, height: 128, seed, ...arm.ov })`, the same seeding of 25 patches of
radius 3) and lays the setting's rate overrides over that. The compartment check's runner refuses the
pattern-blind arm and is a script, so its segment loop is copied; its tracker, readouts, thresholds and segment
cutter are imported unchanged. The runner refuses any seed outside 1 to 4.

**Parity (done before this plan, default rates only).** With no overrides (setting `B2`) the runner gave the
same seven fields as `run-droplets.ts` at every one of 10 censuses, on all four arms, seed 1, 5,000 steps, and
the same config key for key. Output: `runs/spot6/logs/parity.log`.

**GPU form.** All runs use the kernel's GPU form. Step 0 checks it against the CPU reference after 100 steps
on seed 1, comparing every value of all four fields and the step counter (not a digest): `PHAGE` and
`NEUTRAL_PHAGE` at each of the five non-default settings, and all four arms at `SPOT`. A phage variant gets the
same check before its first run. At every census, in tracked and untracked stretches alike, the runner stops if
the matter residual is not zero or if the observer's object count differs from
`observeFindDroplets(W, 128, 128, 0.20).length`.

**Objects.** The confirmation's rule, unchanged: for one wall type, a connected patch (4 neighbours, edges
wrap) of at least 3 tiles with that type's wall at 0.20 of a tile or more.

**Size and seeds.** 128 x 128, as the confirmation. Seeds 1 and 2 for stages 1 and 2, seeds 1 to 4 for stage 3.
No other seed is run.

## Settings (six; none may be added after the first six-wall run at a non-default rate)

The three rates that differ between the kernel's defaults and the spot rates are the wall's decay (`kDeg`),
the wall's diffusion (`diffW`) and the fuel's diffusion (`diffF`).

| Name | `kDeg` | `diffW` | `diffF` | Fuel to wall diffusion ratio | What it is |
|---|---|---|---|---|---|
| `B2` | 0.060 | 0.040 | 0.200 | 5 | The confirmation's rates. Known reference: wave patches. |
| `MIX25` | 0.06625 | 0.03375 | 0.225 | 6.7 | A quarter of the way to the spot rates, all three together. |
| `MIX50` | 0.0725 | 0.0275 | 0.250 | 9.1 | Half way. |
| `MIX75` | 0.07875 | 0.02125 | 0.275 | 12.9 | Three quarters. |
| `SPOT` | 0.085 | 0.015 | 0.300 | 20 | The pure spot rates. |
| `DIFF_ONLY` | 0.060 | 0.015 | 0.300 | 20 | The default decay with the spot diffusion pair. |

Why `DIFF_ONLY`: wall grows only where wall already is and uses up fuel, so separate bodies need fuel that
travels further than wall spreads. The spot rates raise that ratio from 5 to 20 and also make wall decay faster.
`DIFF_ONLY` moves the ratio alone. If it gives bodies, they keep the default decay, and so more standing wall
per body, which is what phage feeds on. It moves both diffusion rates (to the spot pair), not the ratio by one
of them, so that it shares two of its three rates with `SPOT`.

Phage parameters are the frozen defaults in all six. `mutMotif`, `mutPhage` and everything else are the
confirmation's.

**Phage variants (two, pre-listed, labelled as variants wherever they appear).**

| Name | Change | For |
|---|---|---|
| `PH_LONG` | phage decay `kDecayP` 0.02 to 0.002 | "phage lost": small separate bodies may lose phage to decay before it reaches the next body of its type |
| `PH_MILD` | infection `kInfect` 0.34 to 0.17 | "collapse": phage that empties the dish |

A variant runs only if no setting advances to stage 3. Then `PH_LONG` runs at the best setting among those that
read *phage lost* at stage 2, and `PH_MILD` at the best among those that read *collapse*. "Best" is the setting
whose `NO_PHAGE` reading windows (seeds 1 and 2 together) had the most new bodies by fission (defined below); a
tie goes to the one listed first in the table above. A variant is written `PH_LONG@<setting>`; it goes through stage 2
and, if it advances, stage 3, with all four arms built with the variant's phage parameter.

## Stages

One GPU, one job at a time.

**Step 0.** The GPU against CPU check above.

**Stage 1, clean-arm gate.** `NO_PHAGE`, seeds 1 and 2, all six settings. A setting passes only if its reading
window is settled and reads **bodies** (B1 to B3 below) on both seeds. Nothing with phage is run or read for a
setting that fails. One exception, stated now: `B2` is the known reference, so its `PHAGE` world is run on seeds
1 and 2 whatever its gate result, to show what the readouts give on the known wave world. `B2` is not a
candidate and cannot go to stage 3.

**Stage 2.** `PHAGE`, seeds 1 and 2, at the settings that passed the gate (and `B2` as reference). The stage 2
rule below gives each setting an outcome or sends it on.

**Stage 3.** All four arms, seeds 1 to 4, at the settings that advanced: at most three (phage variants
included). If more than three advance, the three with the most new bodies by fission (defined below) in their
stage 2 `PHAGE` reading windows (seeds 1 and 2 together) go on; a tie goes to the one listed first. A setting
gets a stage 3 reading only when all four arms have run to the end on all four seeds. A setting that advanced
and was not run, or not finished, reads *mixed / unclear* with that reason.

## Run lengths and windows

Layout of every `PHAGE` and `NO_PHAGE` run: steps 0 to 10,000 tracked (the **founding window**), 10,000 to
20,000 untracked, then every 20,000-step window tracked. The pattern-blind and one-wall arms (stage 3 only) are
needed for their census rows, so only their last 20,000 steps are tracked. Tracked means read back every 10
steps. All tracked windows after the founding window are 20,000 steps, at every setting.

**Stages 1 and 2: 40,000 steps, extended by rule.** The reading window is steps 20,000 to 40,000 if it is
settled by the compartment check's test (the mean counts of its two halves differ by less than 10% of the
larger). If it is not, that run is extended by 20,000 steps and the new window is tested, up to 80,000 steps.
The reading window is the first settled one. If none is settled by 80,000 steps: in stage 1 the setting fails
the gate ("not settled"); in stage 2 the last window (60,000 to 80,000) is read and flagged. The rule is applied
per run, so two seeds may have different reading windows. For the "alive" tests of stage 2, "the end" is the
last census of the reading window.

**Stage 3: 100,000 steps.** The reading window is steps 80,000 to 100,000 for every arm and seed, and the five
endpoints use the same stretch (the final 20% of the run, as the confirmation's rule defines it). Seeds 1 and 2
are continued from their stage 1 and stage 2 runs, not re-run. A stage 3 window that fails the settled test is
flagged and still read. The confirmation judged steps 400,000 to 500,000; these windows are earlier, a stated
limit.

Why these lengths: the one-wall spot reference at 64 x 64 was full and unchanging well inside 10,000 steps, and
the default six-wall phage world's count is flat from 10,000 steps. Nothing is known about six walls at other
rates, which is why the lengths are a rule and not a number picked after looking.

## Readouts

Per tracked window, from the compartment check's code unchanged: count; kept id after 100, 500 and 1,000
steps; move; tiles kept; tiles still wall against chance; solid, isolated, moat; peak wall; area; births and
ends by kind.

New in this line (`experiments/spot6/rule.ts`, `bodylog.ts`), all fixed here:

1. **Lasting births by kind and by half of the window.** A lasting birth is an object first seen inside the
   window at least 500 steps before its end and still present 500 steps after it appeared. The tracker's
   kinds: by fission (it split from an object of its type), from nothing (no object of its type overlapped it
   one frame earlier), by type switch (at least half its tiles were in an object of another type one frame
   earlier).
2. **New bodies.** A lasting birth counts as a new body unless it is one of six things. The compartment
   check counted every fission and every switch as a birth with a parent; this line does not, or a lattice that
   only changes colour, flickers at the counting threshold, or has neighbours that touch and part would read
   as dividing. This is a departure from the compartment check's division rule; its count is reported beside
   this one.
   - *switch*: the kernel's `mutMotif` rule relabelled a patch of radius 3 (at spot sizes a whole body). The
     body was already there.
   - *severed*: a fission daughter that, at its first frame, is joined to its parent by total wall (all types
     summed) of 0.20 or more. The patch was cut by wall of another type, which is what a partial relabelling
     does, not by water.
   - *returned*: at least half its tiles lie on the last footprint of a same-type object that ended at most
     500 steps earlier. A body that dipped under the counting rule and came back.
   - *rejoined*: a fission daughter where it, or the part that kept the parent's id, lies (at least half) on
     the last footprint of an object that had been absorbed, directly or through a chain of absorptions, into
     its parent or any object its parent descends from by fission, at any earlier time in the window. Two
     bodies were bridged and came apart again.
   - *one object at the window's start*: a fission daughter at least half of whose tiles were, at the
     window's first frame, inside an object in its own line of descent (its parent, the object that one split
     from, and so on) or an object later absorbed into that line. The tracker starts afresh in every window,
     so a join made before the window cannot be seen; a split of what was one object when the window began is
     left out as unverified, however many splits it takes.
   - *not apart at 0.05*: a fission daughter that, 500 steps after it appeared, is still joined to its parent
     by total wall of 0.05 or more (the low-wall level the "isolated" readout uses), or whose parent is gone by
     then. Two lobes whose neck wobbles round the 0.20 counting threshold split and merge under the counting
     rule without ever separating.

   The end of a *piece* (a severed daughter, or any fission daughter that did not stand apart from its parent
   at 0.05) is not counted as the end of a body.

   These exclusions are cautious. A daughter that fills the site of a body that ended less than 500 steps
   before is read as a return, a fission beside a touching body of another type as severed, and a bud already
   on its parent when the window began as unverified. A parent that grows into an empty site and separates
   from the daughter by water is counted, including into the site of a body that ended more than 500 steps
   before. Each excluded class is reported with its count.
3. **Body turnover.** Per body per 1,000 steps: new bodies, and lasting ends (an object present more than 500
   steps that ends by fading or absorption, and that nothing returned to or rejoined from). Objects present at
   the start of a window are aged from the window's start, so ends in a window's first 500 steps are not
   counted. Switches are reported on their own, as pattern changes per body per 1,000 steps.
4. **Phage alive.** With `mutPhage` on, the kernel turns 5 units of wall into phage at random tiles at every
   step, so "phage above zero at the last census" (the confirmation's test) can hardly fail. If phage never
   grew in wall, the dish could hold at most `tiles x mutPhage x 5 / kDecayP` units on average: 41 units at the
   default phage rates (the default phage world holds 20,000 to 50,000). That is an upper bound, since only
   tiles with at least 10 units of a leading wall make phage. **Phage alive** means: above zero at the last
   census of the window, and a mean of at least 10 times that bound (410 units at the default rates, 4,096
   under `PH_LONG`) both over the second half of the window and over its last 2,000 steps. An early bloom that
   has died back does not count. Limit, stated now: phage that does grow in wall but holds under 410 units in a
   sparse dish reads as not alive. The mean, the confirmation's test and phage by type are reported beside it.
5. **Pattern turnover.** For each pair of censuses 1,000 steps apart in a window: half the summed absolute
   change of the six wall shares (0 if the shares did not move, 1 if all wall changed type). The readout is the
   mean over the window's pairs. **Above `NO_PHAGE`** on a seed means, over steps 80,000 to 100,000: the
   no-phage world has objects at the end, and the phage world's turnover is at least 0.01 and at least 1.5
   times the no-phage world's. This is not D3. It measures movement of the dish-wide shares, as the
   confirmation's endpoints did. It does not see two types swapping equal ground, or a cycle that comes back
   every 1,000 steps. Two more readouts are reported with no role in the rule: the same at a lag of 5,000
   steps, and place-wise, of the tiles with total wall of 0.05 or more, the share that still have it with the
   same leading type 1,000 steps later.
6. **Erosion** (for settings with bodies and phage; described, no threshold). The runner keeps, every 50 steps,
   each object's area, own-type wall and own-type phage on its tiles, and for every object that ends, the same
   at each of its last 20 frames. For objects with at least 20 such samples in a window: a *dip* is a stretch
   with own wall under half the object's own median; it *recovers* if the same id is later back at 80% of its
   median. Reported for `PHAGE` beside `NO_PHAGE`: recovered dips, ends after a dip, ends not after a dip
   (per 1,000 body-steps), and the own-type phage per tile at each, against its usual level.
7. **Settling of wall, not only of count.** The share of tiles inside objects and the share with total wall of
   0.05 or more are reported for each half of every window.

## Thresholds, fixed now

**Reading of a window** (the compartment check's, imported unchanged): *bodies* needs B1 (kept id after 1,000
steps at least 50%), B2 (tiles kept after 1,000 steps at least 50%) and B3 (solid at least 80%, isolated at
least 50%, median moat at least 0.50). *Wave patches* needs V1 (kept id at most 10%), V2 (tiles still wall
within 0.10 of chance) and V3 (isolated at most 25%). *Persistent domains, not bounded*: B1 and B2 without B3.
Otherwise *mixed*.

**Eligible seeds.** A seed is eligible if its `PHAGE` world has objects at the end, its reading window reads
bodies and passes the settled test, and phage is alive. Division, pattern turnover and D4 are read on eligible
seeds only. A seed that reads waves, or whose window has not settled, cannot supply them.

**Division, settled windows only.** Over the settled `PHAGE` windows of a setting's eligible seeds pooled:

- at least 20 new bodies (lasting births left after the six exclusions above);
- at least 80% of them by fission;
- at least 25% of them in the second half of the window (births that die away inside the window are the tail
  of the founding fill);
- lasting ends at least half the number of new bodies (new bodies with no ends are a dish still filling);
- at least 3 eligible seeds with at least 5 new bodies each.

Fewer than 20: "division not observed". The founding window (steps 0 to 10,000) is reported separately and
decides nothing.

**Stage 2 rule (two seeds; the first that applies).** A seed with no objects at the last census of its reading
window counts as dead whatever that window read.

1. *collapse*: dead on both seeds.
2. *back to waves*: not dead, and the reading window reads wave patches, on both seeds.
3. *phage lost*: not dead and bodies on both seeds, phage alive on neither.
4. *advance to stage 3*: on both seeds, not dead, bodies, and phage alive.
5. *mixed / unclear*: anything else, with the criteria each seed failed.

**Stage 3 rule (four seeds, all four arms complete; the first that applies).** A seed with no objects at step
100,000 counts as dead whatever its window read.

1. *collapse*: dead on at least 3 of 4 seeds.
2. *back to waves*: wave patches on at least 3 of 4.
3. *mixed / unclear* if bodies on fewer than 3 of 4.
4. *phage lost*: bodies without phage alive on at least 3 of 4. *mixed / unclear* if neither "bodies with
   phage alive" nor "bodies without" reaches 3 of 4.
5. *mixed / unclear* if fewer than 3 seeds are eligible (bodies with phage alive, but the window not settled).
6. *frozen mosaic*: at least 3 eligible seeds, and either fewer than 20 new bodies in their settled windows
   pooled, or pattern turnover above `NO_PHAGE` on fewer than 3 eligible seeds.
7. *bodies with turnover*: at least 3 eligible seeds, division holds, pattern turnover above `NO_PHAGE` on at
   least 3 eligible seeds, and D4 holds on at least 3 eligible seeds.
8. *mixed / unclear*: anything else, with the failed criteria named.

**One outcome per setting, whatever path it took** (`settingOutcome` in `rule.ts`).

- Fails the clean-arm gate: *mixed / unclear*, with the reason "did not pass the clean-arm gate" and what its
  `NO_PHAGE` world read. No phage world is run or read for it.
- A phage variant stands on the gate of its rate setting (its no-phage world is that setting's: with no
  infection the phage rates do nothing). It gets its own stage 2 outcome, and at stage 3 all four of its arms
  are run under its own name.
- Stopped by the stage 2 rule: that rule's outcome.
- Advanced and read at stage 3: the stage 3 rule's outcome.
- Advanced and not run or not finished at stage 3: *mixed / unclear*, with that reason.
- `B2`, the reference: the stage 2 rule's outcome (it is read at stage 2 whatever its gate result). If that
  rule said "advance", which needs bodies, it would read *mixed / unclear*: it is not a candidate.

**The five endpoints** (stage 3 settings; reported, 3 of 4 in place of the confirmation's 7 of 8). The frozen
`judgeDroplets` is fixed to seeds 5 to 12 and 500,000 steps, so its five tests are restated in
`experiments/spot6/rule.ts` from its exported pieces, and a unit test checks the two agree seed by seed. D1
(more patches than pattern-blind phage), D2 (more patches than one wall) and D5 (at least half the no-phage
patch count, diversity at least 2, patches and phage present) compare **patch counts**, not numbers of
individuals. D3 (more leader sweeps than no phage) is reported and decides nothing: a no-phage lattice whose
six types hold near-equal shares has no leader at 25%, so any sweep with phage wins. D4 (diversity above
pattern-blind phage) is the one the outcome uses; it is free if the pattern-blind world is dead (its diversity
then reads 0), so whether that arm is alive is reported per seed beside it. The endpoint table covers all four
seeds; the outcome counts D4 on eligible seeds only.

## What else is recorded for a setting with bodies and phage

- **Is a body's wall pattern inherited by its daughters.** The tracker links objects within one type, so a
  fission daughter has its parent's type by construction, and the kernel makes wall only from wall of the same
  type. What can be read: among lasting births, how many are new bodies by fission, how many are new bodies
  from nothing (a body with no same-type source: where a daughter of another type would show up), and how many
  are switches. What cannot be read: a daughter's type independently of the link.
- **How often a body changes pattern.** Lasting switch ends per body per 1,000 steps, with and without phage.
- **Does phage of a pattern kill whole bodies or erode them.** The erosion readouts above.

## Stop rules

- No setting passes the gate: stop. The spot regime does not carry to six walls; report with snapshots.
- Settings pass, and every one reads *back to waves*, *collapse* or *phage lost* (after the variants, if the
  rule above lets them run): stop; negative for the listed settings, described by outcome.
- At most the six settings and two variants listed. None added after the first six-wall run at a non-default
  rate. Anything else run is labelled a diagnostic and decides nothing.
- Stop at the pre-confirmation boundary in every case.

## If a setting reads *bodies with turnover*

It is frozen here with these commands and this pass rule, and not run. Unseen seeds 33 to 40, all four arms,
100,000 steps, the same layout. Pass: the stage 3 rule gives *bodies with turnover* with 7 of 8 seeds in place
of 3 of 4 everywhere (eligible seeds, turnover, D4, seeds with at least 5 new bodies) and at least 40 new
bodies in place of 20 (`CONFIRM_RULE` in `rule.ts`). The runner refuses those seeds until its allowed list is
changed, which is the freeze's one code change.

## Budget

About 8 GPU-hours, counted as the wall time of this line's jobs (`runs/spot6/logs/gpu-seconds.log`). Measured
on seed 1 at the default rates: about 350 steps per second tracked and over 1,000 untracked. Expected: step 0
about 15 minutes (mostly the CPU reference); stage 1 about 20 minutes; stage 2 about 20 minutes; stage 3 about
45 minutes per setting; extensions and variants on top. If the total heads past 8 hours, stage 3 settings are
cut from three to two to one by the rank above. No arm is dropped: a setting either runs all four arms on all
four seeds or gets no stage 3 reading. Whatever is cut is listed in CALIBRATION.md.

## Commands

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
experiments/spot6/run-all.sh parity     # done before this plan (default rates)
experiments/spot6/run-all.sh check      # step 0
experiments/spot6/run-all.sh stage1 "B2 MIX25 MIX50 MIX75 SPOT DIFF_ONLY"
experiments/spot6/run-all.sh run <setting> NO_PHAGE <seed> 60000      # an extension under the rule
experiments/spot6/run-all.sh stage2 "B2 <settings that passed>"
experiments/spot6/run-all.sh check-variant PH_LONG@<setting>           # only if the variant rule lets it run
experiments/spot6/run-all.sh stage3 "<settings that advanced>"
deno run -A --no-lock experiments/spot6/summarize.ts --runs runs/spot6 --json docs/six-wall-spot-2026-11-22/summary.json > docs/six-wall-spot-2026-11-22/tables.md
```

## Review before the first run

Codex (Sol 6.1, High) reviewed the first draft of this plan and the code on 2026-11-22, before any six-wall run
at a non-default rate, and found ten things. All were changed before running:

1. Division could be decided by an unsettled window, or by fissions on a seed that did not read bodies: now
   read on eligible seeds only, with at least 3 seeds contributing.
2. Dropping switch births did not stop bridged neighbours, a partial relabelling or threshold flicker from
   reading as fission: the "new bodies" rule above, tested on frames of each case.
3. The budget fallback dropped the one-wall arm: removed; settings are cut, never arms.
4. A setting that failed the gate, or advanced and was not run, had no named outcome: it now reads
   *mixed / unclear* with the reason.
5. The object count was checked against the confirmation's function in tracked stretches only: now at every
   census.
6. "Phage alive" could pass on an early bloom: it now needs the second half and the last 2,000 steps.
7. "Turnover higher than `NO_PHAGE`" could be won by a tiny wobble or a dead control: a living control, a
   minimum and a margin; its blind spots are stated.
8. Twenty fissions in a lattice still growing would have passed: lasting ends must be at least half the new
   bodies, and wall cover is reported by half-window.
9. The GPU check compared a digest: it now compares every value, and variants are checked before they run.
10. The stage 2 "back to waves" rule and the code disagreed about a seed with no objects at the end: the plan
    now states the dead-seed rule for stage 2.

A second Codex pass on the changed plan and code, still before any six-wall run at a non-default rate, closed
seven of the ten and found three more things, also changed before running:

11. Two lobes whose neck wobbles round 0.20 gave a lasting fission and then a lasting end: the "not apart at
    0.05" rule, and ends of pieces are not ends of bodies.
12. The memory of absorbed footprints ran out after 5,000 steps, and a join made before the window could not
    be seen: the memory now lasts the whole window and follows chains of absorptions, and a split of what was
    one object at the window's start is left out.
13. A phage variant stopped at stage 2 had no outcome, because it has no no-phage runs of its own: it now
    stands on its rate setting's gate.

A third pass confirmed 11 and 13 closed and found one case left in 12, changed before running:

14. Three lobes joined at the window's start: the second split's daughter has the first daughter as its parent,
    not the object that held its tiles at the start, so it was counted. Window-start ownership and absorbed
    footprints are now followed through the whole line of descent.

## Changes to this plan after the first six-wall run at a non-default rate

Nothing above this section was changed: no setting, window, threshold, rule or outcome. A copy of this plan as
it stood before that run is kept in `runs/spot6/PLAN-before-first-run-2026-11-22T0559.md` (not in git); this
file differs from it only in this section.

- 2026-11-22, after stage 2 was read: a "phage load" table was added to the summariser (`phageLoad` in
  `rule.ts`: how many body samples carry their own phage, and their size). Described only; it feeds no rule.
- 2026-11-22, after stage 3: `experiments/spot6/regrowth.ts`, a diagnostic that reads the stored run files
  (where from-nothing bodies stand relative to objects that faded earlier; patch counts at 0.10 and 0.05).
  It runs no simulation and feeds no rule.
- Outcome of the plan's stop rules: three settings passed the gate and advanced; all three read *frozen
  mosaic*; the phage variants were not allowed to run (settings advanced); no setting was frozen for seeds 33
  to 40. See CALIBRATION.md.
