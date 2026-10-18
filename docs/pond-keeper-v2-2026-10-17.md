# Pond keeper v2: the family tree and the pond firsts (2026-10-17)

Stage 0b of the evolution game, third slice (`docs/evolution-game-brainstorm-2026-10-16.md`, §5.1,
§5.5 and §8). It builds on `docs/pond-keeper-v0-2026-10-17.md` and `docs/pond-keeper-v1-2026-10-17.md`,
whose rules stand unchanged. It adds what Stage 0b still lacked:

- the four firsts §8 names that v0 and v1 did not have (a moving pond, a long body, a change in which
  lineage leads a pond, a pond that outlives a wound) and a first new family, as rule set `firsts-v2`;
- a **family tree**: named families of lineages, with their purity, followed census by census, split
  by a stated persistence rule, with "gone to film" told apart from "extinct" (rule set `families-v1`).

Written before any code for the slice. It is observer work only: no physics changes, no golden pin
moves, no new intervention, no new lever. Everything below is read off what the census, the tracker,
the mutation ledger and the logged interventions already record, and the thresholds are design
choices stated so a player and a replay can check them, not measurements.

## 1. What the new rules read

As v0 (bodies, tracker matching and generations, lineage keys and cells), plus:

- **Where each living cell is and which lineage it carries** (the census's labels and the genome's
  lineage words), so a pond's lineages and a body's lineages can be counted.
- **The shape of a body**: the positions of its cells, unwrapped on its pond's torus by walking the
  body's own cells from its lowest-index cell, four-neighbour, as the census finds it.
- **Ancestry**: each lineage's parent, from the simulation's mutation ledger (the store the lineage
  inspector already keeps). Exact where it is known; see "roots" below for where it is not. A new key
  always comes with a recorded parent link, but a key's creation need not change the genome (a clamped
  mutation, a declared-cell birth), so a family is a branch of descent, not necessarily of genetic
  change.
- **The census's own phase.** Each census is read from the genome words captured with it, before its
  boundary's host-side transforms (pond cycle, declared cells), and from the edges drained before it;
  births a boundary's transforms add first count at the next census.
- **Wounds**: the lesions in the world's intervention log (`kind: "lesion"`, centre and effective
  radius). A lesion logged at step `w` happens after the census at `w`, so it is first seen by the
  census after `w`. The pond of a wound is the pond its centre lies in.
- **Pond cycles**: in a pond world whose arm reseeds (`scaf`, `rand`, `breed`; not `cont`, which only
  measures), every boundary `b` (a multiple of `pondPeriod`) grinds every pond back and reseeds it.
  The census at `b` is taken before its cycle, so it belongs to the cycle that ends there. "Within one
  cycle" below means: no reseeding boundary `b` with `start <= b < end` for a span of censuses from
  `start` to `end`. In a world without a reseeding cycle, the whole history is one cycle.

A world with one tile is one pond (the jar); the detail lines say "in pond n" only when there are
more.

## 2. The new firsts (rule set `firsts-v2`)

`firsts-v2` is `firsts-v1`'s fourteen rules and gene rules, unchanged, plus five. Same baseline, same
"already there", each fires at most once per history, at the census where its condition first holds.

| id | Name | Fires at the first census where |
| --- | --- | --- |
| `moving-pond` | First moving pond | some pond has at least two bodies, and at least half of its bodies' cells, in bodies that moved 8 cells or more over the last 5 censuses: matched as the same body at each of the 6 censuses, within one cycle, distance between its centroids then and now on its pond's torus |
| `long-body` | First long body | some body of 40 cells or more is at least 3 times as long as it is wide: the square root of the ratio of the two principal second moments of its cells' unwrapped positions, each cell counted as a unit square (so a straight line of n cells has ratio n, a 3 by 9 block 3) |
| `pond-change` | First change of hands in a pond | in some pond, within one cycle, a lineage has had strictly the most cells of the pond (no other lineage tied) at 5 censuses in a row, and later a different lineage has had strictly the most at 5 censuses in a row, a run that began after the first lineage's fifth census (fires at the second lineage's fifth) |
| `outlive-wound` | First pond to outlive a wound | a pond took a wound at step `w` that counts (below), and has held at least one body at every census after `w` up to the first census at or after `w + H`, where `H` = 1,000 steps, or half the pond period if that is shorter, all within one cycle (fires at that census; the entry gives the wound's radius and the cells its bodies lost) |
| `new-family` | First new family | the family rule (§3) split a family for the first time |

**A wound that counts.** A lesion centred in the pond, at a step `w` with a census of the same cycle at
or before it (the last census at a step ≤ `w`, with no reseeding boundary `b` where that census's step
≤ `b` ≤ `w`), after which the pond's bodies hold fewer cells at the first census after `w` than at that
last census before it. So a lesion in an empty patch, or just after a reseeding, does not count. A
wound's clock ends unfired at a reseeding boundary.

Per-pond leads (`pond-change`) start afresh at each reseeding cycle: the first census after a boundary
is a pond's first census of its cycle. When several leads qualify at once, the one whose run began
first, then the smaller pond, then the smaller key is named. Each wound has its own clock; a pond
wounded again still counts its earlier wound. When several qualify at one census, the earlier wound,
then the smaller pond, is named. For `moving-pond`, the pond named is the one with the largest share
of moving cells, then the smaller pond.

**The ladder's order** (what Next up offers first): body, big body, split, grandchild, traveller,
moving pond, new lineage, large body, long body, takeover, pond to outlive a wound, fifth generation,
change of hands in a pond, new family, far traveller, huge body, lineage to last 20,000 steps, second
takeover, tenth generation, then the gene rules.

**Next up's progress** for the new rungs, read off the detector's counters as v1's are:

| Rung | Progress shown |
| --- | --- |
| moving pond | the largest share (whole percent, floored) of a pond's body cells in bodies moving by the rule, now, of 50 % |
| long body | the longest ratio (one decimal, floored) of a body of 40 cells or more seen so far, of 3 |
| change of hands | the longest run now held by a lineage other than its pond's established leader, in a pond that has one, of 5 censuses |
| outlive a wound | the longest a wounded pond has now held a body since a wound that counts and is still on its clock, of `H` steps (0 with no such wound) |
| new family | the longest run now held by a split candidate (§3), of 5,000 steps |

## 3. The family tree (rule set `families-v1`)

**What a family is.** A family is a clade: the lineages descending from one founding lineage, less
the ones that belong to a family founded further down. It is told apart by descent, not by genome
distance. §5.5 of the brainstorm warned that distance clusters are not stable from frame to frame and
that no tolerance has been validated on evolved populations; descent is exact (every new key comes
with a parent link the ledger records), stable, and never needs a tolerance. The price: two
families can be genetically closer than two lineages within one, and the tree says so on screen.

- **Roots.** A lineage with no known parent is a root: a founder's key (minted at planting, hi 0),
  or a key whose parent the lab cannot know (minted before the lab's genealogy begins, after opening
  a file or restoring a checkpoint without its edges; or whose ledger record was dropped). Every root
  among the living lineages' ancestries at the first watched census founds a **starting family**. A
  root first seen later founds a family then, marked "of unknown descent", as is any root that is not
  a founder's key.
- **Dropped records stop the tree.** The ledger's buffer can overflow, and which records it keeps then
  is not the same from one run of the same physics to the next. So if any ledger record is dropped
  while the tree is watching, the tree stops and says why (the log of firsts carries on), and a session
  file is refused, as for a stopped log. Unknown ancestry from before the tree began watching is
  allowed (the roots above).
- **Membership.** A lineage belongs to the family founded at its nearest ancestor-or-self that founds
  one. A family's cells are its member lineages' living cells, bodies and film alike.
- **The split rule.** In family F (founded at f), a candidate is any lineage L ≠ f on the ancestry of
  a living member, between it and f, L itself living or not. L's half is the cells of F's members
  descending from L or equal to it; the rest of F is the other half. L qualifies at a census when both
  halves hold 16 cells or more. F splits at L when L has qualified at every census for 5,000 steps (at
  the census completing them): L founds a new family whose parent is F. At most one split per family
  per census: among qualifying candidates, the one whose run began first, then the larger half, then
  the older key (birth step, then cell). A split clears the runs of every candidate in F and in the
  new family; they count afresh from the next census. Families already split from F whose founding
  lineages descend from L move beneath the new family (their names stay). Families never merge
  (descent has no merge).
- **A body's family.** The family holding the most of the body's cells that carry a lineage (ties:
  the older founding key); a body with no such cell has no family. Its **purity** is that family's
  share of the body's cells. A family's purity is the share of its bodies' cells that are its own:
  Σ own cells / Σ cells, over the bodies whose family it is; none (shown "—") when it has no body.
- **Status, with strict persistence.** A family *is in a body* at a census when any of its cells lies
  in a census body, whichever family that body counts as. It is *living* while it is in a body. It has
  **gone to film** when it has held living cells but none of them in a body at 5 censuses in a row
  (logged at the fifth, saying since when); it is **back from film** when, after that, it is in a body
  at 5 censuses in a row. It
  is **extinct** at the first census at which it holds no living cell. Extinction is final: a new key
  is only ever minted from a living parent, so a family with no living cell can gain none.
- **Names**, given once by the game, the same in every replay. A starting family or a family of
  unknown descent gets a *genus* word: index FNV-1a-32(founding key) mod 64 into a fixed list of 64,
  moving on to the next unused word (wrapping) when taken, in founding order (ties: key birth order).
  A split family gets "<its root family's genus> <epithet>", the epithet chosen the same way from a
  fixed list of 64, unique within the genus. When a list is used up, the name takes a numeral
  ("Reed 2"). So every descendant carries its root's genus, and the tree shows each family's parent.
- **What the tree shows.** Every family: name, founding lineage, parent family, founded at, status,
  cells, bodies, purity, and its share of the jar's living cells; and the tree's own log of events
  (split, gone to film, back from film, extinct), newest first. The rule is stated beside it, with
  "seen, not measured".

## 4. Rewind, the card and the session file

- The family tree follows the log of firsts' rewind policy (v0 §"Rewind"), with one more condition:
  it is snapshotted with the log at each checkpoint, together with the genealogy it was read against
  (the step the edges begin at and how many there were), and restored with it only when the
  checkpoint's step and hash match and the restored world's genealogy is that same one (its own edges
  file was read back whole). Otherwise it starts afresh at the first census after, saying "watching since t = …". A tree
  that errors stops, as a stopped log does, and a session file is refused.
- The card adds: families named (starting and split), living, gone to film, extinct.
- **Session file version 3**: version 2's fields with `firsts.rules` = `firsts-v2`, plus `families`:
  `{ rules: "families-v1", watchedFrom, families: [{ name, founder, parent, founded, unknownDescent,
  status, cells, bodies, purity }], events: [{ step, kind, family, detail }] }`. Versions 1 and 2 still
  validate and replay; `tools/run.ts --picks-from` replays all three.

## 5. Gates for this slice

- vitest: each new first on hand-built censuses, including the cycle rule (a reseeding boundary
  inside the span stops it, the boundary census itself does not), ties, and snapshot/restore
  mid-history continuing exactly; the elongation ratio on a line, a block, and a body across the
  pond's wrap; the family rule on hand-built ancestries (no split for a chain whose remainder is
  empty, a split at 5,000 steps not 4,900, the tie order, film and back with persistence, extinction,
  names stable and unique, unknown descent); session file v3 validation and v1, v2 still valid.
- Playwright (Chrome): on the breeder world, wound a pond, run, see the family tree and its log, the
  new rungs in Next up and the log, and download a version 3 session file (kept as a fixture).
- Deno: `tests/deno/pond_keeper_replay.ts` replays the v1, v2 and v3 fixtures through
  `tools/run.ts`, each "matches the lab's checkpoint at t = …".
- No golden pin moves; the typecheck is clean.

## Clarifications made during review (2026-10-17, same day, before any code was committed or any session recorded)

A Codex review of this note against the code found these; the rules above already read as amended.

- **`pond-change` is strict**: a lead tied with another lineage is no lead, so the incumbent cannot keep
  leading through the successor's run.
- **`outlive-wound`**: the horizon is `H` = min(1,000, pondPeriod / 2), so a wound in the middle of a
  `ponds-small` cycle (period 1,000) can count; a wound counts only when the pond's bodies lost cells
  between the censuses either side of it, within one cycle, so a lesion in an empty patch or just after a
  reseeding earns nothing; a wound's clock ends unfired at a reseeding boundary.
- **The census's phase**: genome words captured with the census, before its boundary's transforms.
- **Dropped ledger records stop the tree** and refuse the session file: which records survive an
  overflow is not deterministic, so a tree read from them would not replay.
- **Rewind** restores a tree only against the same genealogy, not only the same physics hash.
- **Reparenting**: a split at L moves families already split below L beneath the new family.
- **Film** means the family has no cell in any body, not that it lost the plurality in a shared body;
  purity is none for a family with no body; a body with no lineage cell has no family.
- **Wording**: a new key is a recorded parent link and need not change the genome.
