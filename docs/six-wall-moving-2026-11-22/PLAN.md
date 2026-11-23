# MOVING6: plan (written 2026-11-22, before any six-wall world with phage at `MIX25` and before any run at `MIX12` or `MIX37`)

**This is a second look after a gate stopped a setting.** The earlier screen
([../six-wall-spot-2026-11-22/PLAN.md](../six-wall-spot-2026-11-22/PLAN.md)) stopped `MIX25` at its no-phage
gate on one test ("stays put"), so no world with phage was run there. This plan replaces that test, and it
was written **with `MIX25`'s no-phage numbers already seen**. The new gate, the new definitions of a body's
birth and death and the tolerances of the validity condition were all fitted to those seen runs. `MIX25`
passing the new gate is therefore not a finding. Every run is on seeds 1 to 4, which have been used before:
this is a screen, not evidence. It stops before any unseen seed. Seeds 33 to 40 stay unseen.

## Question

Where six-wall bodies move, does the world with phage keep bodies that divide and die (turnover of
individuals), with phage alive and wall patterns turning over more than without phage?

## What had been seen when this plan was written

- Everything the earlier screen saw: its files, tables and snapshots for all six settings, including `MIX25`
  without phage on seeds 1 and 2 (steps 0 to 40,000).
- For this plan, the stored tracked windows listed below were **replayed** from their saved start states by
  this line's runner, to keep one more per-frame log (the "move log"). The runner stops unless the replay
  equals the stored window value for value (census rows, tracker records, birth notes, end state); all of
  them did. A replay is the same seen data, not a new run.
  - `MIX25` no phage, seeds 1 and 2, steps 0 to 10,000 and 20,000 to 40,000.
  - Controls: `MIX50` phage and no phage, seeds 1 and 2, steps 80,000 to 100,000; `SPOT` phage and no phage,
    seed 1, the same steps; `B2` phage and no phage, seeds 1 and 2, steps 20,000 to 40,000; and the founding
    windows (steps 0 to 10,000) of `MIX50` no phage, seeds 1 and 2, and `MIX75` no phage, seed 1.
- Nothing with phage at `MIX25`, and nothing at all at `MIX12` or `MIX37`, on any seed, by any tool. The
  first such run is the GPU against CPU check (100 steps), after this plan and its review.

## Method

**Kernel.** The frozen kernel, unedited. Every run starts by checking the files in
`experiments/confirm/FROZEN.json` against their hashes. A setting is a set of rate overrides.

**Runner.** `experiments/moving6/run.ts`, a copy of `experiments/spot6/run.ts` (a top-level script bound to
the earlier list of settings, so it cannot be imported). It differs in four ways: setting names resolve
through this line's list; tracked segments also keep the move log; a segment file written by the earlier
runner is accepted as this run's own if its header matches in everything but the `check` name (so the stored
`MIX25` runs are continued, not re-run); and the replay mode above. Also copied: the six-line body of
`buildSpec` in `experiments/moving6/settings.ts` (the earlier one refuses `MIX12` and `MIX37`; a unit test
checks the copy gives the earlier config key for key at `MIX25` and its variants) and
`experiments/moving6/gpu-check.ts` (the same reason). Everything else is imported unchanged: the tracker,
the window readouts and B1, B3 and the wave test (`experiments/b2check`), the body log, "phage alive",
pattern turnover, "above no phage", the five endpoints and the two-seed rule (`experiments/spot6`). The
runner refuses any seed outside 1 to 4.

**The move log** (`experiments/moving6/movelog.ts`). Every 50 steps, for each counted object: the tracker's
id, the id of the connected patch of total wall of 0.05 or more it lies in, and its centre. It is needed
because ids rarely last 500 steps where bodies move (below), so "does the daughter stand apart from its
parent 500 steps later" has to follow bodies, not ids.

**GPU form.** All runs use the kernel's GPU form. Before a setting and arm's first run it is checked against
the CPU reference after 100 steps on seed 1, comparing every value of all four fields and the step counter:
all four arms at `MIX25`, `MIX12` and `MIX37`; a phage variant gets the same check before its first run. At
every census, tracked or not, the runner stops if the matter residual is not zero or if the observer's
object count differs from `observeFindDroplets(W, 128, 128, 0.20).length`.

**Objects.** The confirmation's rule, unchanged: for one wall type, a connected patch (4 neighbours, edges
wrap) of at least 3 tiles with that type's wall at 0.20 of a tile or more.

**Size and seeds.** 128 x 128, the confirmation's arms and seeding, phage parameters at the frozen defaults.
Seeds 1 and 2 for the gate and the two-seed stage, seeds 1 to 4 for the four-seed stage. No other seed.

## Settings (three; none may be added after the first new run)

| Name | `kDeg` | `diffW` | `diffF` | What it is |
|---|---|---|---|---|
| `MIX25` | 0.06625 | 0.03375 | 0.225 | **The primary.** A quarter of the way from the confirmation's rates to the spot rates. The question is asked of it. |
| `MIX12` | 0.06313 | 0.03688 | 0.2125 | Secondary: an eighth of the way (`mixRates(0.125)`), between the wave world and `MIX25`. |
| `MIX37` | 0.06938 | 0.03063 | 0.2375 | Secondary: three eighths (`mixRates(0.375)`), between `MIX25` and the frozen lattice of `MIX50`. |

The neighbours say whether moving bodies are a band or a single point, and whether there is a setting between
"moving" and "frozen" where bodies creep less and still divide.

**Phage variants (two, carried over from the earlier plan, at `MIX25` only).** `PH_LONG@MIX25` (phage decay
`kDecayP` 0.02 to 0.002) runs only if `MIX25`'s two-seed stage reads *phage lost*; `PH_MILD@MIX25` (infection
`kInfect` 0.34 to 0.17) only if it reads *collapse*. A variant goes through the two-seed stage and, if sent
on, the four-seed stage, with all four arms built with the variant's phage parameter, under its own name. It
stands on `MIX25`'s gate. Nothing else may be added. Anything else run is a labelled diagnostic and decides
nothing.

## Step A: the ledger of the stored no-phage world

`MIX25` without phage, steps 20,000 to 40,000. The object count is flat (149 to 143 on seed 1, 148 to 154 on
seed 2), yet the earlier rule read 288 to 293 lasting ends against 3 to 6 new bodies. What the stored files
show:

| | Seed 1 | Seed 2 |
|---|---|---|
| Tracker ids in the window | 5,831 | 5,624 |
| Ids present at the first frame that are still present at the last | 0 of 149 | 0 of 148 |
| Ids that ended after 500 steps or less | 4,514 | 4,295 |
| Lasting births by the tracker's kind: fission / type switch / from nothing | 560 / 523 / 90 | 553 / 512 / 107 |
| Lasting ends by the tracker's kind: absorbed / faded / type switch | 555 / 302 / 317 | 596 / 281 / 298 |
| Lasting births less lasting ends | 1,173 - 1,174 | 1,172 - 1,175 |
| The earlier rule: new bodies | 6 | 4 |
| The earlier rule: lasting births set aside (switch / severed / returned / rejoined / one object at the start / not apart) | 523 / 73 / 341 / 123 / 16 / 91 | 512 / 81 / 352 / 115 / 14 / 94 |
| The earlier rule: lasting ends not returned; and ends set aside (returned / pieces / switch) | 293; 178 / 386 / 317 | 288; 208 / 381 / 298 |
| Lasting fission births whose "apart at 0.05 after 500 steps" the earlier note could read: apart / not apart / not readable (an id gone) | 72 / 13 / 475 | 71 / 14 / 468 |

So the tracker's own lasting births and lasting ends balance to within 3. The imbalance came from the earlier
rule setting aside 1,167 births (seed 1) and only 881 ends: births and ends were classified separately, so a
birth could be set aside (a return, a re-separation, a relabelling, a piece) while the end it answered still
counted. And its two tests that follow one id for 500 steps (apart at 0.05; rejoined on a footprint) mostly
could not be read, because no id lasts here: bodies of one type touch (one id is absorbed) and part (a new id
splits off) all the time, and the kernel's relabelling rule replaces ids.

**What carries the flow**, with every continuation made one-to-one (definitions in the next section; ledger
stretch steps 20,500 to 39,000; replayed windows):

| | Seed 1 | Seed 2 |
|---|---|---|
| Object count at the stretch's start and end | 161, 153 | 154, 155 |
| Bodies alive at its start and end | 162, 147 | 154, 155 |
| **Births**: by division (shown apart) | 43 | 45 |
| Births: split not shown apart from the parent (same low-wall patch / not readable) | 113 (101 / 12) | 106 (96 / 10) |
| Births: by the kernel's relabelling rule (part of a body relabelled, or a body cut by a relabelled strip) | 233 | 254 |
| Births: a further piece of a body that returned (it dipped, or joined another, and came back as more than one object) | 33 | 36 |
| Births: from nothing | 3 | 4 |
| **Deaths**: faded | 281 | 273 |
| Deaths: fused into another body of its type for good | 159 | 171 |
| Births less deaths, against the change in the object count | 425 - 440 = -15, against -8 | 445 - 444 = 1, against 1 |
| Not births and not deaths: whole body relabelled / touched and parted within 500 steps / dipped and returned / split that did not hold 500 steps | 410 / 1,624 / 133 / 543 | 397 / 1,462 / 133 / 594 |
| Object-steps in chains that never stood 500 steps in a row (necks and fringes at the counting line) | 4% | 5% |

Reading. This world is not a steady set of individuals with a few events. About 155 bodies have about 435
births and 440 deaths in 18,500 steps: the stock of bodies turns over about once in 6,500 steps (bodies times
steps over deaths; a turnover time, not a measured lifetime). Of the 162 bodies alive at the start of the
stretch on seed 1, 8 are alive at its end (97 faded, 57 fused). The flow is carried by, in order: fades (273
to 281), the relabelling rule cutting bodies (233 to 254), fusions (159 to 171) and splits (151 to 156, of
which 43 to 45 are shown apart by water within 1,000 steps), with 33 to 36 bodies that came back as more
than one object. Bodies of one type touching and parting within 500 steps (1,462 to 1,624 changes of id)
and splits that do not hold (543 to 594) are the bulk of the tracker's churn and are neither births nor
deaths. Bodies from nothing are few (3 to 4 per seed).
An independent count from the stored snapshots (objects at step 30,000 matched to objects at step 31,000 by
overlap, no tracker) gives the same size of flow: per 1,000 steps on seed 1, 5 to 17 splits, 6 to 11 merges,
16 to 22 objects gone and 27 to 29 with no predecessor in place, against 0 of each in the `MIX50` lattice.

This decides what a birth and a death have to mean here: they must be defined on bodies followed through
their changes of id, and anything set aside must be set aside on both sides.

## Bodies, births and deaths (`experiments/moving6/ledger.ts`)

**A body is a chain of tracker ids.** An id continues an earlier one when:

- *relabelled*: the earlier id ended by a type switch and this one is the switch birth that replaced it in
  that frame;
- *parted*: the earlier id was absorbed into an object of its type, and this one splits from that object (or
  from whatever absorbed or replaced it since) at most 500 steps later;
- *returned*: at least half of this one's tiles lie on the last footprint of the earlier id, which ended at
  most 500 steps before (the earlier screen's test, unchanged), and nothing has continued that id yet;
- *handed on*: the earlier id faded, or was absorbed into its own daughter, at most 500 steps after a piece
  was cut from it (by fission or by a relabelling) that is still present. One of the two parts of the split
  is gone inside 500 steps, so the split did not hold: the body goes on in the part that is left.

Each end is continued at most once and each birth continues at most one end. Within one frame: relabellings
first; then the frame's ends, each read from the state before any of them, so their order does not matter;
then the frame's births in order of id (of two daughters that could continue one merged body, or two objects
on one footprint, the lower id does). A piece handed on to must not itself end in that frame. When a body is
handed on, the bodies that had merged into it, and the pieces cut from the part that takes over, go with it.

A chain is a **body** only if it stood as its own object for more than 500 steps in a row at least once (the
earlier lasting rule, on the chain; a relabelling or a hand-on does not break the row). Other chains are
*flicker*.

The one number behind all of this is the earlier screen's 500 steps, used the same way on both sides: a
split, a merge, a dip or a cut counts only if it holds for more than 500 steps.

**Births**, by kind:

- *by division*: the chain begins with a fission daughter that is not a continuation and is not severed, and
  at the first move-log frame from 500 to 1,000 steps after the split at which both it and its parent body
  are present, the two lie in different patches of total wall of 0.05 or more;
- *split not shown apart*: the same, but the two lie in one such patch ("same patch"), or there is no such
  frame ("not readable": one of the two is merged, dipped or dead at every frame from 500 to 1,000 steps);
- *by relabelling*: the chain begins with a switch birth whose old body went on, or with a fission daughter
  joined to its parent by total wall of 0.20 or more at its first frame (cut by another type's wall);
- *returned piece*: the chain begins with an object (by fission or with no predecessor) that meets the return
  test above, but the id it lies on has already been continued: a body came back as more than one object;
- *from nothing*: the chain begins with an object that overlapped no object of its type one frame earlier
  and does not meet the return test.

The kinds are tried in that order, relabelling and returned piece before the other two.

**Deaths**, by kind: *faded*; *fused* (absorbed and not parted within 500 steps); *relabelled away* (ended by
a type switch with no switch birth to continue it).

**The ledger** covers the tracked window less its first 500 steps (a continuation looks 500 steps back) and
its last 1,000 (a split is read against its parent up to 1,000 steps after it, so every counted split has
its whole reading time inside the log): steps 20,500 to 39,000 of a window from 20,000 to 40,000. Over that
stretch, bodies alive at the end less bodies alive at the start equals births less deaths, exactly; the code
stops if it does not.

**A limit of the "parted" rule, stated now.** If body A merges into B and, within 500 steps, B puts out a
daughter somewhere else while A stays merged, the ledger cannot tell that from A coming out again: it reads
a touch and part, and so leaves out one division and one fusion. The stored files do not hold the evidence
to tell the two apart where bodies move (a footprint match is used when there is one). The error can only
remove a birth and a death together, never add one, and the validity condition below cannot see it. To show
how much hangs on it, every ledger is also printed with no parting allowed at all (every merge a fusion,
every later split a birth): on the stored `MIX25` windows that gives 63 to 64 divisions per seed in place
of 43 to 45, and 205 to 212 fusions in place of 159 to 171. The same holds for the hand-on rule: a real
division whose parent dies inside 500 steps is read as one body going on.

**New bodies** for the division rule are births by division and births from nothing. Births by relabelling,
splits not shown apart and returned pieces are set aside, as the earlier rule set aside switches, severed
pieces, daughters not apart at 0.05 and returns; they stay in the ledger with their deaths.

### What changed from the earlier "new bodies" rule, and why

Each change is tested on hand-built frames in `experiments/test/moving6-ledger.test.ts`.

| Earlier exclusion | Now | Why |
|---|---|---|
| *switch*: every switch birth is set aside; a switch end is not an end | A whole-body relabelling joins the old id to the new one: no birth, no death (unchanged in effect). A relabelling of part of a body, the rest going on, is a birth "by relabelling": in the ledger, not a new body for the division rule. | 523 lasting switch births against 317 switch ends on seed 1: 206 relabellings left the old body in place and added an object. Setting those births aside while their later deaths counted is part of the imbalance. |
| *severed* | Unchanged test; the piece is a birth "by relabelling" with its own death in the ledger. | The earlier rule dropped the end of a piece but not of the body it was cut from. |
| *returned* (on the footprint of an id that ended at most 500 steps before) | Unchanged test, made one-to-one: the first birth on the footprint continues the body. A further one is a "returned piece": a birth in the ledger, set aside from new bodies as every return was. | 341 returns pointed at 178 ends on seed 1: a body often comes back as more than one object. The second is an added object and has to be in the ledger; it is not a body from nothing. |
| *rejoined* (a fission daughter on the last footprint of an id absorbed into its parent's line, at any earlier time in the window) | *parted*: by line of descent, not by footprint, and only within 500 steps. A merge held longer is a death by fusion and a later split a birth. | Bodies move, so a body that parts is often not on the footprint it had when it joined. And with no time limit a body that ever touched another could never be read as dividing: with "any time" the ledger reads 11 to 13 divisions per seed in place of 43 to 45 (below, described only). |
| *one object at the window's start* | Replaced by leaving the window's first 500 steps out of the ledger. | With a 500-step limit on parting, what happened before the window matters only for its first 500 steps. |
| *not apart at 0.05 after 500 steps* (read on ids) | Kept, read on bodies, at the first frame from 500 to 1,000 steps after the split where both are present. A split not shown apart is set aside from new bodies and stays in the ledger. | The id-based note was unreadable for 475 of 560 lasting fissions on seed 1. |
| The end of a *piece* is not an end | Dropped. Every body's death counts, whatever its birth. | 386 lasting ends per seed were set aside as ends of pieces against 164 births set aside as pieces. |
| (none) | *handed on*: a split or cut whose other part is gone inside 500 steps is not a birth and a death. | Without it, a wobbling neck that happens to leave the id with the daughter read as a division and a fusion: 543 to 594 per seed. |

Described only, and reported beside every ledger: the same ledger with no parting allowed, with a merge
allowed 2,000 steps, and with any length of time, before it counts as a fusion (the hand-on rule stays at 500
steps in all three); and the earlier rule's counts on the same window. On the stored `MIX25` windows, per
seed, as division / split not shown apart / by relabelling / returned piece / from nothing; faded / fused:
no parting 63 to 64 / 52 to 59 / 261 to 282 / 46 to 48 / 1 to 2; 233 to 239 / 205 to 212. 2,000 steps 17
to 19 / 124 to 128 / 217 to 235 / 30 to 35 / 4 to 6; 315 to 317 / 89 to 96. Any time 11 to 13 / 118 to 128
/ 217 to 237 / 28 to 34 / 5 to 8; 333 to 336 / 61 to 64.

### The validity condition

The balance of bodies holds by construction, so it cannot be the test. What can fail is whether the ledger
of bodies is a ledger of the **counted objects**. Three tests, per window (`validityOf` in `rule.ts`). They
catch births or deaths left out on one side; they cannot catch a birth and a death left out together (the
limit above).

1. **Net.** Births less deaths of bodies must equal the change in the confirmation's object count between the
   stretch's two ends, to within 10% of the mean count and never less than 5. This catches births or deaths
   set aside on one side only: the earlier rule's 5 births against 290 deaths would miss by more than 250.
2. **Flicker.** At most 10% of the window's object-steps may lie in chains that never stood 500 steps in a
   row. This catches a world whose objects are not bodies.
3. **Readable splits.** Where there are at least 20 fission-born bodies, at most 25% of them may be
   unreadable against their parent.

If a seed's ledger fails any of the three, division for that seed reads **not readable**, which is neither
"division" nor "no division". On the stored `MIX25` windows: net 7 and 0 (allowed 15.5), flicker 4% and 5%,
unreadable splits 8% and 7%. **These tolerances were set after seeing those numbers**, with room to spare.

## The gate (replacing "stays put")

The compartment check's reading with one test replaced (`classifyMoving` in `rule.ts`). *Bodies* needs:

- **B1**, unchanged: at least 50% of sampled objects keep their id for 1,000 steps;
- **SAME**, new, in place of "tiles kept": of the objects that kept their id for 1,000 steps, at least 75%
  have an area within a factor of 2 of what it was;
- **B3**, unchanged: solid at least 80%, isolated at least 50%, median moat at least 0.50.

*Wave patches* (V1 to V3), *persistent domains, not bounded* (B1 and SAME without B3) and the 10% settled test
are the compartment check's. Frame-to-frame self-overlap was not made a test: the tracker assigns ids by
overlap, so it cannot fail.

SAME can fail on a stored world, though only where B1 has already failed: in the wave world the few ids that
last 1,000 steps change size (33% to 63% within a factor of 2, of 6 to 85 objects), against 86% to 87% at
`MIX25` and 98% to 100% in the lattices. No stored world passes B1 and fails SAME, so in effect **the gate is
B1 plus B3**, with SAME as a guard that has not yet been needed. The 75% was chosen after seeing these
numbers. **This gate was written after seeing `MIX25`'s no-phage numbers, so `MIX25` passing it is not a
finding.** It is a finding only for the neighbours and for the worlds with phage.

`MIX25` clears B1 by 4 to 5 points and "isolated" by 10 to 11, so phage could push a seed just under a
threshold. For every seed with phage that is run, eligible or not, the tables give the ledger, births and
deaths, pattern turnover and the erosion readouts, marked "described only" where the seed is not eligible,
and a *mixed / unclear* outcome names each failed test with its value and threshold.

## Step A2: controls from the stored runs

The new gate and the new births and deaths on stored windows of the earlier screen (replayed with the move
log; full rows in `runs/moving6/tables-pre.md`, and in the final tables under "Controls").

**Gate.**

| World | Same id +1,000 | Size kept | Isolated | Moat | Reading under the new gate | Earlier reading |
|---|---|---|---|---|---|---|
| `B2` no phage, seeds 1, 2 (waves) | 0%, 0% | 33% of 6, 63% of 8 | 0%, 0% | 0.09, 0.09 | mixed, mixed (not bodies) | mixed |
| `B2` phage, seeds 1, 2 (waves) | 3%, 2% | 44% of 85, 50% of 62 | 5%, 6% | 0.24, 0.23 | wave patches | wave patches |
| `MIX50` no phage and phage, seeds 1, 2, steps 80,000 to 100,000 (lattice) | 79% to 81% | 100% | 100% | 0.95 to 0.97 | bodies | bodies |
| `SPOT` no phage and phage, seed 1 (lattice) | 91%, 88% | 100% | 75%, 97% | 0.89, 0.96 | bodies | bodies |
| `MIX25` no phage, seeds 1, 2, steps 20,000 to 40,000 | 54%, 55% | 86%, 87% | 60%, 61% | 0.66 | bodies | mixed |

**Births and deaths.**

| World and window | Births: division / split not shown apart / by relabelling / returned piece / from nothing | Deaths: faded / fused | Ledger | Division read on the window alone | The earlier rule: new bodies (by fission) |
|---|---|---|---|---|---|
| `MIX50` no phage, seeds 1, 2, steps 80,000 to 100,000 | 0 / 0 / 0 / 0 / 0 on both | 0 / 0 | valid | not observed | 0 |
| `MIX50` phage, seeds 1, 2, the same steps | 0 / 0 / 0 / 0 / 0 on both | 0 / 0 | valid | not observed | 0 |
| `SPOT` no phage, seed 1, the same steps | 0 / 0 / 0 / 0 / 2 | 0 / 0 | valid | not observed | 1 (0) |
| `SPOT` phage, seed 1, the same steps | 0 / 0 / 0 / 0 / 81 | 86 / 0 | valid | does not hold (0 of 81 by division) | 48 (0) |
| `B2` no phage, seeds 1, 2, steps 20,000 to 40,000 | 0 / 9 / 2 / 56 / 98; 0 / 11 / 4 / 43 / 98 | 148 / 21; 137 / 21 | **not readable** (86% and 87% flicker; net 7 on seed 2, allowed 5.6) | not readable (its counts: 0 by division) | 32, 35 (0) |
| `B2` phage, seeds 1, 2, the same steps | 10 / 61 / 51 / 131 / 306; 10 / 60 / 52 / 102 / 292 | 496 / 67; 454 / 63 | **not readable** (49% and 51% flicker; 31% and 39% of splits unreadable; net 20 on seed 2, allowed 7) | not readable (its counts: 3% by division) | 117 (5), 111 (9) |
| Positive control: `MIX50` no phage, founding window, seeds 1, 2 | 122 / 57 / 54 / 6 / 0; 110 / 58 / 52 / 8 / 1 | 1 / 0; 0 / 0 | valid | fails only "second half" and "deaths" (a founding fill) | 71, 65 |
| Positive control: `MIX75` no phage, founding window, seed 1 | 264 / 29 / 11 / 6 / 0 | 0 / 0 | valid | the same | 205 |

The lattice still reads no division (no birth and no death of any kind in 18,500 steps, with or without
phage; about 1,150 whole-body relabellings per window, all joined as continuations). The waves still read
"not bodies" at the gate, and their ledger is not readable. The founding fill, where the earlier rule read
division, reads division here too (and more of it: the earlier rule set aside splits of what was one object
at the window's start). `SPOT` with phage still reads bodies appearing from nothing with no parent.

## Division, in settled windows only

Read over the ledgers of a setting's eligible seeds whose ledger is valid, pooled (`readDivision` in
`rule.ts`). The earlier thresholds, unchanged in number:

- at least 20 new bodies (by division or from nothing);
- at least 80% of them by division;
- at least 25% of them in the second half of the stretch;
- body deaths at least half of body births, **every kind on both sides** (changed in what it counts, not in
  the number: the earlier rule compared its ends with its new bodies; here a death cannot be tied to a kind
  of birth without following each body, and the test's purpose, a dish still filling, is about all of them);
- at least 3 eligible, readable seeds with at least 5 new bodies each.

Fewer than 20 new bodies: "division not observed". The founding window (steps 0 to 10,000) is reported on its
own and decides nothing. Division printed for any single window is marked "not readable" where that window's
ledger is not valid.

Known before any phage run, and stated so it is not read as a result: by this rule the stored `MIX25`
**no-phage** windows already read division, each on its own (43 of 46 new bodies by division on seed 1, 45
of 49 on seed 2; 25 of them in the second half on each; 440 and 444 deaths against 425 and 445 births). So
division in the world with phage would not by itself show that phage does anything: bodies here pinch, fade
and fuse without it. What phage has to add is in the other criteria (phage alive, pattern turnover above
the no-phage world, D4), and the no-phage world's own division reading is printed beside the phage world's
at every stage. If splits not shown apart were also counted as divisions there would be 156 and 151 per
seed in place of 43 and 45; the plan keeps the caution, and both figures are reported for every window.

Also reported, with no role in the rule: tiles between a daughter and its parent body 1,000 steps after the
split, and how long bodies born by division live.

## Other definitions, imported and not restated

"Phage alive", "pattern turnover", "above no phage" (at least 0.01 and at least 1.5 times the no-phage
world's, the no-phage world having objects at the end), "eligible seed" (objects at the end, reading window
reads bodies and is settled, phage alive) and the five endpoints are the earlier plan's, imported from
`experiments/spot6/rule.ts`. "Bodies" in "eligible seed" is this plan's gate.

## Stages, lengths and windows

The earlier layout, so the two screens can be read side by side. Every `PHAGE` and `NO_PHAGE` run: steps 0
to 10,000 tracked (founding), 10,000 to 20,000 untracked, then every 20,000-step window tracked. The
pattern-blind and one-wall arms have only their last 20,000 steps tracked. Tracked means read back every 10
steps.

**The gate.** `NO_PHAGE`, seeds 1 and 2, 40,000 steps, reading window steps 20,000 to 40,000 if settled; if
not, the run is extended by 20,000 steps at a time up to 80,000 and the first settled window is read; none
settled by 80,000 fails. A setting passes only if both seeds read bodies in a settled window. For `MIX25`
the stored runs are this stage (it passes: table above). Nothing with phage is run for a neighbour that
fails.

**The two-seed stage.** `PHAGE`, seeds 1 and 2, the same lengths and extension rule (a run not settled by
80,000 is read on its last window and flagged). The earlier rule, first match: *collapse* (no objects at the
end on both seeds); *back to waves* (wave patches on both); *phage lost* (bodies on both, phage alive on
neither); *sent on* (bodies with phage alive on both); else *mixed / unclear*, naming each failed test with
its value.

**The four-seed stage.** All four arms, seeds 1 to 4, 100,000 steps, reading window steps 80,000 to 100,000
(ledger stretch 80,500 to 99,000). Seeds 1 and 2 are continued from the earlier stages. `MIX25` always goes
here if its two-seed stage sends it on. A setting gets a reading only when all four arms have run to the end
on all four seeds. The rule (`stage3Outcome`), first match; a seed with no objects at step 100,000 is dead
whatever its window read:

1. *collapse*: dead on at least 3 of 4 seeds.
2. *back to waves*: wave patches on at least 3 of 4.
3. *mixed / unclear* if bodies on fewer than 3 of 4, naming each seed's failed tests.
4. *phage lost*: bodies without phage alive on at least 3 of 4; *mixed / unclear* if neither "bodies with
   phage alive" nor "bodies without" reaches 3.
5. *mixed / unclear* if fewer than 3 seeds are eligible.
6. *mixed / unclear*, "division not readable", if fewer than 3 eligible seeds have a valid ledger.
7. *moving bodies, no division*: fewer than 20 new bodies over the readable seeds' windows pooled.
8. *mixed / unclear*, "division does not hold", with the failed criteria, if there are 20 or more and any
   division threshold is missed.
9. *bodies with turnover*: division holds, pattern turnover above no phage on at least 3 eligible seeds, and
   D4 on at least 3 eligible seeds.
10. *division without pattern turnover*: division holds, and either of those two is short.

From step 6 on, whichever outcome is read, its notes also say whether pattern turnover and D4 fall short
and by how much, and give the failed tests of every seed that is not eligible. A seed's failed tests are
given with their values: the bodies tests against their
thresholds, and phage by its three means against the bar.

**One outcome per setting, whatever path it took** (`settingOutcome`): fails the gate, *mixed / unclear* with
what its no-phage world read; stopped by the two-seed rule, that rule's outcome; read at the four-seed stage,
that rule's outcome. A setting whose next stage was not run when the work stopped (the rank, the budget, a
stop rule) reads *mixed / unclear* with that reason, whether it had not been started, had passed its gate,
or had been sent on by the two-seed stage.

**The neighbours.** They go through the gate and the two-seed stage. At most one joins `MIX25` at the
four-seed stage: among those sent on, the one with the most births by division in its two `PHAGE` reading
windows; a tie goes to `MIX37`. Whether it runs there depends on the budget (below).

**The late window.** If a four-seed setting reads *bodies with turnover* or *division without pattern
turnover*, its `PHAGE` and `NO_PHAGE` worlds are continued on seeds 1 and 2 to 200,000 steps and the same
ledger and division reading are reported for steps 180,000 to 200,000. Division late is read on the `PHAGE`
windows that meet what an eligible, readable seed meets (objects at the end, bodies, settled, phage alive,
valid ledger); others are described only. It is reported and does not change the outcome.

**Order.** `MIX25` runs through all of its stages (and a variant, if the rule allows one) before any
neighbour run starts. Then, in this order and only inside the budget: the late window for `MIX25` if it
qualifies; the neighbours' gates; their two-seed stages; the ranked neighbour's four-seed stage; a late
window for that neighbour.

## What else is recorded for a setting with bodies and phage (described, no threshold)

- Whether phage of a pattern kills whole bodies or erodes them: the earlier erosion readouts and phage load,
  phage beside no phage; and deaths by fade and by fusion per body per 1,000 steps.
- How often a body changes pattern: whole-body relabellings, and births by relabelling, per body per 1,000
  steps, with and without phage.
- Body size (median area) and speed (median move in 1,000 steps) with and without phage.
- What became of bodies by how they arose (faded, fused, still alive).

## Stop rules

- `MIX25` reads *back to waves*, *collapse* or *phage lost* at the two-seed stage and the allowed variant
  does not change that: stop; negative for `MIX25`, described by outcome. A neighbour may still finish its
  gate and two-seed stage; it goes on only under the rank above.
- At most the three rate settings and the two variants. None added after the first new run.
- After the first new run, no setting, window, threshold, rule or outcome changes.
- Stop at the pre-confirmation boundary in every case. No seed outside 1 to 4.

## Budget

**3 GPU-hours** of wall time for this line's jobs, finished or failed, logged in
`runs/moving6/logs/gpu-seconds.log` (replays included; 12 minutes used by the replays and the `MIX25` GPU
check before this plan was frozen). `MIX25`'s own stages are not cut by
the budget. Expected: `MIX25` two-seed stage about 5 minutes, four-seed stage about 50 minutes. Extras are
started only if the logged total plus the extra's expected time stays under 3 hours: late window about 20
minutes, the neighbours' gates and two-seed stages about 20 minutes, a neighbour's four-seed stage about 55
minutes. If the total heads past 3 hours the neighbours are dropped first, then the late window. No arm or
seed is ever dropped from a four-seed setting: it runs all four arms on all four seeds or gets no four-seed
reading. Whatever is not run is listed in CALIBRATION.md.

## If a setting reads *bodies with turnover*

It is frozen here with these commands and this pass rule, and not run. Unseen seeds 33 to 40, all four arms,
100,000 steps, the same layout. Pass: the four-seed rule gives *bodies with turnover* with 7 of 8 seeds in
place of 3 of 4 everywhere (eligible seeds, readable seeds, turnover, D4, seeds with at least 5 new bodies)
and at least 40 new bodies in place of 20 (`CONFIRM_RULE` in `rule.ts`). The commands a confirmation would
use, none of which works today because the runner refuses those seeds:

```bash
# The freeze's one code change: in experiments/moving6/settings.ts, the line
#   export const ALLOWED_SEEDS: readonly number[] = [1, 2, 3, 4];
# becomes
#   export const ALLOWED_SEEDS: readonly number[] = [33, 34, 35, 36, 37, 38, 39, 40];
CHECK_SEED=33 experiments/moving6/run-all.sh check "<setting>"
experiments/moving6/run-all.sh confirm <setting>        # writes runs/moving6-confirm
deno run -A --no-lock experiments/moving6/summarize.ts --runs runs/moving6-confirm --confirm
```

`--confirm` reads seeds 33 to 40 with `CONFIRM_RULE` and prints that one reading (and stops with a message if
the folder holds no such runs).

## Commands

```bash
export PATH=/Users/nicholas/.nvm/versions/node/v24.2.0/bin:$PATH
# Before the freeze (the same seen data, replayed): done.
experiments/moving6/run-all.sh adopt 1; experiments/moving6/run-all.sh adopt 2
experiments/moving6/run-all.sh replay <setting> <arm> <seed> <a-b>          # the control windows listed above
# After the freeze.
experiments/moving6/run-all.sh check "MIX25"
experiments/moving6/run-all.sh stage2 "MIX25"
experiments/moving6/run-all.sh run MIX25 PHAGE <seed> 60000                  # an extension under the rule
experiments/moving6/run-all.sh check-variant PH_LONG@MIX25                   # all four arms; only if the variant rule lets it run
experiments/moving6/run-all.sh stage3 "MIX25"
experiments/moving6/run-all.sh late MIX25                                    # only if the outcome qualifies
experiments/moving6/run-all.sh check "MIX12 MIX37"
experiments/moving6/run-all.sh gate "MIX12 MIX37"
experiments/moving6/run-all.sh stage2 "<neighbours that passed>"
experiments/moving6/run-all.sh stage3 "<the ranked neighbour>"               # only inside the budget
deno run -A --no-lock experiments/moving6/summarize.ts --runs runs/moving6 --json docs/six-wall-moving-2026-11-22/summary.json [--notrun "<setting>=<why a due stage was not run>"] > docs/six-wall-moving-2026-11-22/tables.md
```

## Review before the first new run

Codex (Sol 6.1, High, read-only) reviewed the first draft of this plan and the code on 2026-11-22, before any
new run. It re-implemented the chain rules from the plan's prose in its own script and got the same births,
deaths and body counts on both stored `MIX25` windows, the same gate checks and the same control readings. It
found thirteen things; all were changed before running, except the fourth, which is answered:

1. The ledger depended on the order in which one frame's ends were taken (436 births against 433 on seed 1):
   every hand-on is now decided from the state before any of the frame's ends, and the plan states the order
   within a frame. Checked on all 17 replayed windows: the ledger is the same with the ends reversed.
2. A body that faded and was handed on lost the bodies merged into it: they now go with it (test).
3. A piece cut from a part that was then handed on kept pointing at the discarded chain, so its split could
   not be read: it now follows the body that took the part over (test).
4. "Parted" can leave out a real division and a fusion together (B buds elsewhere while A stays merged), and
   the validity condition cannot see it. Answered, not fixed: the stored files hold no evidence to tell the
   two apart where bodies move; the error only removes a birth and a death together; the limit is stated
   above, and every ledger is printed with no parting allowed as the other bound.
5. A split late in the window could lose part of its 500 to 1,000 step reading time, and a chain open at the
   last frame counted as a body at exactly 500 steps: the ledger now stops 1,000 steps before the window's
   end, and a body needs more than 500 steps, with no exception.
6. Numbers in step A and A2 were stale after an edit made during the review (the returned-piece kind):
   every number in this plan was regenerated after the fixes.
7. The late window printed "division holds" for a window whose ledger was not valid or not settled: it now
   reads division only on windows that meet what an eligible, readable seed meets.
8. A neighbour stopped by the budget before its gate, or after it, had no named outcome: it now reads
   *mixed / unclear* with the reason.
9. A phage variant's GPU check covered two arms: all four now.
10. A failed job's GPU time was not logged: it is now.
11. Notes of a *mixed / unclear* outcome named "phage not alive" without numbers and left out other failed
    criteria: they now carry the phage means and the bar, and the turnover and D4 shortfalls.
12. The confirmation recipe could not be run as written: the commands, a `confirm` step in the script and
    the summariser's `--confirm` reading are now given.
13. "A body lasts about 6,500 steps" claimed a measured lifetime: it is a turnover time, and says so.

Also changed during that review, from this line's own re-reading: a body that comes back as more than one
object had its second object counted as "from nothing"; it is now a "returned piece", set aside from new
bodies as the earlier rule set every return aside (the change that moved the stored no-phage windows from
74% to 92% by division; stated here because it was made with those numbers in view). And a piece whose own
id ends in the frame of the hand-on is not handed on to.

A second Codex pass on the changed plan and code, still before any new run, recomputed the ledger again from
the current prose (the same births, deaths, bodies, validity numbers and division readings on both stored
`MIX25` windows and on two controls), found the ledger the same with one frame's ends reversed on all 17
replayed windows, confirmed findings 1 to 5, 8 to 10 and 13 closed, and called the answer to finding 4
acceptable for a screen that stops before unseen seeds. It found six more things, none in the ledger or in
a rule's outcome, all changed before running:

14. The confirmation recipe still could not work (the allowed seeds were imported, and the GPU check was
    fixed to seed 1): this line now has its own one-line list of allowed seeds, checked equal to the earlier
    screen's, and the GPU check takes a seed.
15. `--confirm` on the screen's folder printed seen controls and no warning: it now stops with a message
    when there are no confirmation runs, and prints the many-seed reading alone.
16. A seed that was not eligible lost its failed tests from the notes of later outcomes: they are now in
    the notes of every outcome from step 6 on.
17. The summary JSON gave "division does not hold" for a window whose ledger is not valid: it now gives
    "not readable", with what the counts alone would read beside it.
18. Every ledger table was shifted one column against its header: fixed.
19. Two labels: the founding stretch is steps 500 to 9,000, and the short-id row counts ended ids.

A third pass confirmed items 14, 15, 17 and 19 closed and found that the fix for item 16 had changed an
outcome: the notes about a seed that was not eligible were counted as a shortfall, so three eligible seeds
passing everything read *division without pattern turnover* where they should read *bodies with turnover*.
Those notes are now notes only, on every outcome, with a test at 3 of 4 and at 7 of 8. It also found one
separator cell too many in the ledger tables (item 18); removed.

## Changes to this plan after the first new run

Nothing above this section was changed after the first new run: no setting, window, threshold, rule or
outcome. A copy of this plan as it stood before that run is kept in
`runs/moving6/PLAN-before-first-run-2026-11-22T1128.md` (not in git); this file differs from it only in this
section.

- 2026-11-22, outcome of the plan's rules: `MIX25` was sent on by its two-seed stage and reads *division
  without pattern turnover* at the four-seed stage; its late window was run (it qualifies). The phage
  variants were not allowed to run (the two-seed stage read neither *phage lost* nor *collapse*). `MIX12`
  failed the gate. `MIX37` passed, was sent on, was the only neighbour to rank, and reads *moving bodies, no
  division*; no late window for it. No setting is frozen for seeds 33 to 40. 1 h 58 min of the 3 GPU-hours
  were used; nothing was cut. See [CALIBRATION.md](CALIBRATION.md).
- No code under `experiments/moving6/` or its tests was changed after the first new run (the files' hashes
  equal the list saved at the freeze).
- 2026-11-22, a correction of wording found by the final review, made here and not above: step A2 says the
  founding fill "reads division here too". What it shows is that the ledger counts the fissions of a
  founding fill (110 to 264 births by division per seed); the thresholded reading of those windows is
  "does not hold", as that section's table says.
