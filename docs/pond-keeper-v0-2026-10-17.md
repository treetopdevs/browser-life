# Pond keeper v0: firsts, a session card and a session file (2026-10-17)

Stage 0b of the evolution game (`docs/evolution-game-brainstorm-2026-10-16.md`, §5.1 and §8), first
slice: the lab gains a log of firsts with rules stated here in advance, a card that sums up a
session, and a versioned session file that `tools/run.ts` replays to the same final state. It is
observer work only. No physics changes, no golden pin moves, nothing new is declared, and the
player gets no new lever: the pressures and donor picks the Breeder panel already has (and the
existing brushes) are all they touch.

This note was written before any code for the slice. The rules below are the contract the detector
(`packages/metrics/src/firsts.ts`) implements; a change to them is a new rule set id, not an edit.

## What the detector reads

Only what the census and the tracker already infer, at each census the lab's observers take (every
`censusEvery` steps, 100 in the lab, the same census the headless runner takes):

- **Bodies**: the census's individuals, connected cells whose bound mass (B + P) is at least 48 per
  cell with total mass at least 256 (`DEFAULT_CENSUS`). Each has a cell count, a centroid and a
  pond (tile).
- **Life events and descent**: the tracker's overlap matching across censuses: fissions (one body
  whose cells become two or more bodies above the threshold), and each living body's generation
  (a body born of a split or, as the runner attributes it, a bud of a nearby same-lineage body, is
  one generation below its parent).
- **Lineages**: genome identity keys (the census's lineage table, cells per key). A new key comes
  only from a mutation the physics made.
- **Genes** (gene worlds only, `WorldConfig.genes`): the gene byte each cell's genome carries
  (byte 3 of PARAM1). Every founder carries none, so a carrier exists only by a mutation the
  physics made.

Nothing else: no pond score, no config-declared category, no controller output.

## The baseline

The log starts with the first census it watches (`watchedFrom`). For a world planted here that is
the census at t = `censusEvery`; after opening a file, or restoring a checkpoint whose log this
page did not keep, it is the first census after that, and the log says "watching since t = …".
The lineages present at that census are the **starting lineages**. A first whose condition already
holds at the first watched census is recorded as **already there when watching began**, not as a
first, and is shown that way.

## The rules (rule set `firsts-v0`)

Each fires at most once per history, at the census step where its condition first holds.

| id | Name | Fires at the first census where |
| --- | --- | --- |
| `body` | First body | some body exists (on a world planted with founder discs this is usually already there) |
| `body-40` | First big body | some body has 40 cells or more |
| `body-100` | First large body | some body has 100 cells or more |
| `split` | First split | the tracker's fission count has risen since the first watched census |
| `grandchild` | First grandchild | some living body is of generation 2 or more |
| `gen-5` | Fifth generation | some living body is of generation 5 or more |
| `traveller` | First traveller | some body, matched as the same body at every census since the log first saw it, has its centroid 16 cells or more from where the log first saw it (distance on its pond's torus) |
| `new-lineage` | First new lineage to last | a lineage that is not a starting lineage has held 16 cells or more at every census for 5,000 steps (fires at the census that completes the 5,000 steps) |
| `takeover` | First takeover | a lineage that is not a starting lineage has had the most cells of any lineage at 10 censuses in a row (fires at the tenth; the entry says when its lead began) |
| `gene-<b>` | First carrier body of gene b | gene worlds only, one rule per gainable gene bit b: some body has more than half of its cells carrying gene bit b |

The thresholds (40 and 100 cells, 16 cells of travel, 16 cells and 5,000 steps of persistence,
10 censuses of lead, a majority of a body's cells) are design choices, stated so a player and a
replay can check them, not measurements. The 40-cell body is the brainstorm's own example; 16
cells is about twice the diameter of a 40-cell body, so a body that merely grows lopsided does not
count as travelling.

What the rules do not say: a first is a detector's verdict on a census, not a claim about
selection. The breeder's notes already warn that reordering four donors changes a whole history,
so a first reached in one session and missed in another says nothing about whether the player's
pressure caused it. The card says so in plain words.

## Following the world on screen

The log belongs to the history on screen.

- Planting starts a new log.
- A jump back, or a restore of a checkpoint this page saved for this run, restores the log as it
  stood at that checkpoint; the replay forward re-derives the later firsts from the same censuses.
- A checkpoint saved on an earlier visit, or a file opened, has no log kept with it (storing it
  in the checkpoint would change the observer digest, which this slice does not touch): the log
  starts afresh with "watching since t = …".
- The replay twin (Does it replay the same?) never feeds the log.

## The session card

On request, and offered once the world has grown for ten minutes of wall time: what was bred (the
world's pressure in words, and how many cycles took the player's donors against the rule's), how
far (bodies, the largest body, the deepest generation and the lineages, at the first watched census
and now), what died (bodies the tracker lost, most of them at pond cycles in a pond world, starting lineages no longer present, and whether
the jar emptied), the firsts with their steps, the wounds, feeds and drains made by hand, and the
latest replay check. Nothing on it is a score.

## The session file (`cadence-garden.session`, version 1)

A JSON file with the lab run manifest's history fields (`presetId`, `seed`, `ruleVersion`, `cfg`,
`init`, `startHash`, `settings`, the ordered `interventions`), plus `final` (the step, the
`stateHash` of the world settled at that census, and how many interventions were logged up to it),
the firsts (rule set id, `watchedFrom`, entries with steps) and the card's summary. Export is
offered only for a history the runner can rebuild from step 0: one planted here from a preset
(a `startHash` and complete edges from step 0). A world opened from a file is refused with the
reason, and its checkpoint download stays available.

The file is a superset of the lab run manifest, so `tools/run.ts --picks-from <file>.session.json`
needs no new code: it replays it as it replays a lab run manifest (picks, wounds and feeds as
logged), and the file's `checkpoints` holds one entry for the final state (`step`, `hash` =
`final.stateHash`, `interventions`), which the runner's existing check compares when `--steps`
equals `final.step`: "matches the lab's checkpoint at t = …", or both hashes and exit 4. The state hash
covers the physics only, so the observer settings do not enter it; the file still records them so
the replay can use the lab's census cadence. The file's own `replay` field gives the exact command.

## Gates for this slice

- vitest: the detector's rules on hand-built censuses (each rule, the start case, the persistence
  and lead counters, snapshot and restore), and the lab execution on the reference physics: a
  session with a pick, a wound and a feed exports a file whose replay reaches the same state hash
  and the same firsts.
- Playwright (Chrome, WebGPU): the firsts log fills on the breeder world, the card opens, and the
  session file downloads; the downloaded file is kept as a fixture.
- Deno (native WebGPU): `tests/deno/pond_keeper_replay.ts` runs `tools/run.ts` on that real export
  and requires "matches the lab's checkpoint at t = …" for the final step.

## Clarifications made during review (2026-10-17, same day, before any session was recorded)

The review of the first implementation found two places where the table above left a choice open. Both
are settled here, in words, rather than left to the code; neither changes a threshold.

- **Ties for the most cells (`takeover`).** Every lineage tied for the most cells at a census has "the
  most cells" at that census. A lineage's streak ends only at a census where it is not among them. When
  two lineages complete ten censuses at the same census, the entry names the one whose lead began
  earlier, then the smaller lineage key.
- **A session file needs a census.** A world that has not yet reached its first census has no history
  to replay (the runner refuses `--steps 0`), so no file is offered until then.
