# Pond keeper v3b: choose donors by shells

2026-10-24. Implements the display-only donor-picker slice deferred in section 6 of
`pond-keeper-v3-2026-10-22.md`.

## Plan and decisions

At a waiting pond cycle in a world with `injuryShell`, offer **Cells wearing a shell**
in the existing ranking menu. Rank by the percentage of that pond's living cells
holding at least `injuryShell` membrane, descending. A percentage asks whether the
trait is common in a pond; an absolute count would largely reward larger populations.
Show both the percentage and exact numerator/denominator, so a small pond's high
percentage is visible as such. A cell is living exactly when its two lineage words
are not both zero, as in the existing whole-world shell readout. No living cells
means a zero ranking value and a readout saying “no living cells”.

Keep the picker's existing eligibility (positive bound mass) and equal-value tie
breaks (bound mass descending, then pond index ascending). Zero-shell worlds still
have a useful, explicitly tied ranking; worlds with no shell setting have no option.
The initial selection stays the rule's score. Changing the menu only changes the
view. The existing **Top** button selects the ranked donors and **Breed** applies
them with the existing confirmation. The rule button and Auto-breed remain governed
by the rule and Keep. Text beside the menu explains this and that membrane now is
not a promise of surviving a later wound.

## Implementation boundary

`LabExecution.survey` counts from the full state held immediately before a cycle,
not the post-cycle reseeding or a cached census. The worker sends `shells`, one
`{wearing, living}` pair per tile or null, in `PondAwaitMsg`. Pressure/Keep refreshes
recount that same held state and retain the existing revision protection. This
field is a display message only. It enters no observer, checkpoint, digest or
session file. Explicit shell-ranked donors are ordinary existing pick interventions.

The picker ranking functions are now pure helpers in `pond-ranking.ts` so share
ordering and existing ties/eligibility can be exercised without a DOM. The page
shows count details on selected donors and hover readouts; selected donor labels
include them for assistive technology. The overlay uses the same ranking helper.

No `PondTerm`, score, schema, physics, default config, golden pin, session version,
preregistration or runner change is needed. This is a choice offered to the player,
not a new selection rule or evidence that shell selection improves the ecology.

## Validation and results

- Hand-built tile-grid counts test both horizontal and vertical tile
  boundaries, either lineage word, inclusive threshold, nonliving membrane,
  no-shell config and empty ponds; their sum equals the whole-world count.
- Ranking tests distinguish percentage from absolute shell count, exclude massless
  ponds, retain equal-share mass/index ties and prove the survey/rule donors are
  unchanged. All-zero shell shares follow bound mass.
- The execution replay test independently recounts each pond before breeding,
  refreshes the survey under a changed pressure, selects shell-ranked donors and
  compares the replayed state and shell counts with the original history.
- The Chrome page flow plants the wounded shell breeder, chooses shell-ranked
  donors at cycle 1, checks that changing the menu alone preserves picks, captures
  desktop/mobile panels, breeds, replay-checks and exports the unchanged session
  format containing those explicit donors.

Checked on 2026-10-24:

- `pnpm typecheck`, `pnpm build` and `git diff --check` passed.
- Shell, ranking and rank-label suites: 16 tests passed. The ranking fixture also
  checks null and absent shell display fields: finite zero values with existing ties.
- The targeted execution replay test passed in 46.74 seconds (57 unrelated tests
  skipped). Independent pre-cycle recount, pressure refresh, shell-picked donors,
  replay state hash and final per-pond shell counts all matched.
- Chrome page test passed in 23.1 seconds using port 5192. Its shell-ranked donors
  were ponds 3, 11, 6 and 4, with 20.0%, 5.0%, 3.2% and 1.2% shell shares.
  Replay reported Identical, and the exported version 3 session held those donors.
- Inspected `test-results/pond-shell-ranking-desktop.png` and
  `test-results/pond-shell-ranking-mobile.png`: the narrow desktop sidebar wraps
  the counts cleanly; the 390px mobile layout keeps the menu and counts readable.
  These are local validation artifacts, not committed fixtures.
- Coordinating-agent Sol 6.1 High read-only review reported no findings; its request
  for a missing-field compatibility fixture was added and passed. Adversarial
  review is arranged separately before finalizing the slice.

The broader run finished with 73 passed and one failure in 257.46 seconds. It had
loaded the earlier replay-test fixture whose scaffold arm cannot accept a pressure
change. That fixture was corrected to a breed arm before the targeted replay run
above, which passed. The other 57 execution tests passed in the broad run; this is
combined evidence, not a claim of one entirely green full-suite invocation. No new
scientific result or GPU golden run is claimed.

Argon 4 High review is running against a self-contained source packet (headless tool access is unavailable). Publication remains draft until that review is assessed; no Argon verdict is claimed yet.
