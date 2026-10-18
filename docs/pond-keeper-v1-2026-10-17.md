# Pond keeper v1: a pressure dial, auto-breed, keep a lineage, and what's next (2026-10-17)

Stage 0b of the evolution game, second slice. It builds on `docs/pond-keeper-v0-2026-10-17.md`
(the firsts log, the session card, the session file), whose rules stand unchanged.

**Why.** The user ran Stage 0a on 2026-10-17 with v0 in the lab: "basically a pass, but it isn't a
lot of fun, needs more interactivity, and a few more _whats next_". This slice adds play verbs (a
pressure the player sets, breeding that runs on its own, a lineage the player keeps) and visible goals
(a ladder of next firsts with progress). The user approved the one new kind of logged intervention,
the pressure, on 2026-10-17.

Written before any code for the slice. What is declared: nothing new about life. The pressure is a
change to the pond cycle's selection rule, which the breeder already imposes; it touches no physics,
moves no golden pin and is logged so a replay holds.

## 1. The pressure dial (new intervention kind `pressure`)

- **What it is.** In a pond world of arm `breed` (the breeder), the rule chooses each cycle's donors
  by a score (`pondScore`, fixed in the config at planting). A pressure replaces that score from a
  given cycle on: `{ step, kind: "pressure", cycle, score }`, where `score` is any valid `PondScore`
  (one term of `mass`, `drive`, `reach`, `seed`, `body`, or distinct terms joined by `+`).
- **Which cycles it governs.** Cycle `b` (the boundary at step `b × pondPeriod`) uses the score of the
  latest pressure in the log with `cycle ≤ b`, or the config's `pondScore` when there is none.
  `cycle` is the first cycle not yet applied when the player set it: the waiting cycle if one waits
  for donors, else the next boundary after the world's step. `step` is the world's step when it was
  logged. The log stays in one step order.
- **Where it applies.** Only to donors the rule chooses: a cycle with a pick takes the pick's donors,
  as now. While a cycle waits, setting the dial re-ranks that cycle's suggested donors ("The rule's
  choice") under the new score. Refused in any world whose arm is not `breed`, and while the world has
  failed.
- **Replay.** The lab's own replay (jump, replay check) and `tools/run.ts --picks-from` (a lab run
  manifest or a session file) both apply it: the runner's pond boundary uses the active score. A run
  with no pressure behaves, hashes and writes its files exactly as before. A pressured run cannot be
  segmented or sent to an island (as a picked run cannot).
- **The record.** What `ponds.tsv` records under a pressure follows the runner's existing columns;
  a run with no pressure writes byte-identical files.

## 2. Auto-breed

"Breed on its own for N cycles" (N = 1, 5, 20, or until stopped) with Breeder mode on: at each waiting
cycle the page answers with the rule's choice under the current pressure (adjusted by Keep, below),
which is logged as an ordinary `pick`. A Stop button ends it; it also ends when the world is replaced,
fails, or is paused by the player. No new intervention: the log holds picks.

## 3. Keep a lineage

The player marks one lineage (from the lineage list or a probed cell) as kept. When auto-breed or
"The rule's choice" answers a waiting cycle, the **kept pond** is the pond holding the most living
cells of that lineage in the pre-cycle state (ties: the lower pond index). If the kept pond is not
among the rule's donors, it replaces the rule's last donor; if it is, the donors stand. If no pond
holds the lineage, Keep says the lineage is gone and the rule's donors stand. A hand pick is never
changed. The donors applied are logged as an ordinary `pick`. No new intervention.

## 4. What's next: a ladder of firsts (rule set `firsts-v1`)

`firsts-v1` is `firsts-v0`'s rules, unchanged, plus five rungs. Same baseline, same "already there",
same "fires once at the first census where the condition holds":

| id | Name | Fires at the first census where |
| --- | --- | --- |
| `body-250` | First huge body | some body has 250 cells or more |
| `gen-10` | Tenth generation | some living body is of generation 10 or more |
| `far-traveller` | First far traveller | the `traveller` condition with 32 cells instead of 16 |
| `lineage-20k` | First lineage to last 20,000 steps | the `new-lineage` condition with 20,000 steps instead of 5,000 |
| `takeover-2` | Second takeover | the `takeover` condition, by a non-starting lineage other than the one named by `takeover` (counting starts at the census after `takeover` fired) |

**The ladder's order** (what Next up offers first): body, big body, split, grandchild, traveller,
new lineage, large body, takeover, fifth generation, far traveller, huge body, lineage to last 20,000
steps, second takeover, tenth generation, then the gene rules.

**Next up** shows the first three rungs in ladder order not yet reached, each with its progress, all
read off the detector's own counters, so a replay shows the same numbers:

| Rungs | Progress shown |
| --- | --- |
| body, big, large, huge body | the largest body seen so far, of the threshold |
| split | splits since watching began, of 1 |
| grandchild, fifth, tenth generation | the deepest generation seen so far, of the target |
| traveller, far traveller | the farthest a tracked body has moved from where it was first seen, of 16 or 32 cells |
| new lineage, lineage to last 20,000 steps | the longest unbroken run now held by a non-starting lineage at 16 cells or more, of 5,000 or 20,000 steps |
| takeover, second takeover | the longest current lead by an eligible lineage, of 10 censuses |
| gene carrier bodies | the largest share of a body's cells carrying the gene, of more than half |

Progress is shown as "seen so far" for the first four rows and "now" for the last three, and says
which. A rung reached moves into the log with its step as before.

Thresholds are design choices, stated so a player and a replay can check them, not measurements.

## 5. The session file

Version 2 of `cadence-garden.session`: version 1's fields, with `pressure` entries allowed in
`interventions` and `firsts.rules` = `firsts-v1`. A version 1 file (rule set `firsts-v0`, no pressure)
still validates and replays. `tools/run.ts --picks-from` replays both.

## 6. Gates for this slice

- vitest: pressure semantics on reference physics (the cycle a pressure governs, the waiting cycle
  re-ranked, log order, refusal outside arm `breed`), a lab replay of a pressured, auto-bred, kept
  history to the same state hash; the runner's boundary under a pressure equals the lab's; a run
  without pressure is unchanged (existing tests and pins); the new rungs and the progress numbers on
  hand-built censuses; keep's donor rule; session file v2 validation and v1 still valid.
- Playwright (Chrome): on the breeder world, set a pressure, auto-breed a few cycles with a lineage
  kept, see Next up and the log, download the session file (kept as a fixture).
- Deno: `tests/deno/pond_keeper_replay.ts` replays the v1 fixture and the new v2 fixture through
  `tools/run.ts`, each "matches the lab's checkpoint at t = …".

## Clarifications made during review (2026-10-17, same day, before any session was recorded)

- **Survey revisions.** Each waiting cycle's survey (its suggested donors under the governing pressure and
  its kept pond) has a revision that changes whenever the dial or Keep re-ranks it. A hand pick names the
  revision it was made from and is refused if the survey has changed since, leaving the cycle waiting. An
  auto-breed answer names no donors: the worker applies the rule's choice with Keep to the survey waiting
  when the answer arrives. Either way the log holds an ordinary pick.
- **A pressure for a boundary's own cycle needs that boundary's pick.** A pressure with
  `cycle × pondPeriod = step` is one the lab logs only while that cycle waits, and a waiting cycle always
  ends in a logged pick (nothing can be saved or exported while it waits), so a log where such a pressure
  is not followed by a pick at its step is refused as not the observed history.
- **The dial commits on Set, not on choosing**, so moving through the options logs nothing.
