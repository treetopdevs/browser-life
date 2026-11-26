# Pond keeper v3: wounds the pond's builders can weather (2026-10-22)

Stage 0b of the evolution game, fourth slice. It builds on `docs/pond-keeper-v0-2026-10-17.md`,
`docs/pond-keeper-v1-2026-10-17.md` and `docs/pond-keeper-v2-2026-10-17.md`, whose rules stand unchanged
(`firsts-v2`, `families-v1`, session file version 3). Line cites are to this checkout (`6fe65016`), under
`apps/lab/src` unless a path is given; the lab page is `apps/lab/lab/index.html`.

**Why.** The polymer-world screen (`docs/evolution-game-brainstorm-2026-10-16.md`, "Polymer world", 2026-10-22)
added the kernel key `WorldConfig.injuryShell` (commit `6fe65016`; `docs/rules.md`, last paragraph): with
recurring injury, a wounded cell holding at least `injuryShell` polymer loses exactly that polymer and
survives; a cell with less is lost as before. In its one informative pair, shells lifted polymer builders from
0 % to 86.5 % (shell 4) and 94.9 % (shell 8, slow decay) of the cells under the same wounds. That is one seed
and one founder assignment, in a gene world on `gradient-m3`, and the screen's pass rule was not met (no world
passed): where to look, not a result. The user asked on
2026-10-22 for the shell as a Pond keeper lever: "wounds the pond's builders can weather". This slice offers it
at planting, says in plain words what it does, counts the cells it could spare, and says so on the breeder
panel when the wounds leave its ranking with nothing to rank by.

Written before any code for the slice. **What is declared:** nothing about life. Three worlds that differ
only in their weather (§1), a readout of the cells that could weather a wound, as a chart and a row (§3), one
display-only line on the breeder panel when its score ties at zero (§3), and words (§2). The physics is
`injuryShell`, already in both twins with its golden case; no `RULE_VERSION` bump, no pin moves. **What is not
declared:**

- *A builder.* Pond worlds set no `genes` (`packages/schema/src/presets.ts`, `breeder`), so the gene result of the screen does not
  carry over. "Builders" is the user's phrase for the slice and appears in no player text. The readout counts
  living cells holding at least the shell's worth of membrane (the lab's name for polymer, `main.ts:982-984`).
  Nothing says those cells are one lineage or inherit it.
- *That the shell makes builders.* The sizing run (§1) reads as selection over several cycles, not protection.
- *An intervention.* The weather is the world's, from step 0, like its pond cycle.
- *A scoring term, a first, or a view.* §6.

## 1. The choice: three weathers, three worlds, one control

**The worlds.** Two presets appended after `breeder` in `PRESETS` (the pinned prefix `FIRST_WORLDS` is
untouched), each the breeder's config plus the injury keys and nothing else:

| Choice | Preset id (in a link) | Name | Config beyond the breeder's |
| --- | --- | --- | --- |
| Calm | `breeder` (as now) | The breeder | none |
| Wounds, no shells | `breeder-wounded` | The breeder (wounded) | `wounds(3, 3250)`: period 13, radius 3, each cell hit about once per 3,250 steps |
| Wounds and shells | `breeder-wounded-shell` | The breeder (wounded, shells) | the same, plus `injuryShell: 2` |

The names follow the Storm worlds' pattern ("Storm (rare wounds)", `presets.ts:304-306`) and read whole in the
sentence `syncPlant` builds (`main.ts:221-232`): "the world on screen is still The breeder (wounded, shells),
seed 7." Every world's name must be its own (`worlds.test.ts`).

`wounds` is a private helper in `packages/schema/src/presets.ts:51-55`; this slice exports it (no behaviour
change) so the presets and the tests build the same keys. The dose is the physics survey's heavy level
(`runs/pond-shell/read-all.md`, gitignored; the numbers are copied here so the note stands alone): a radius-3
disc has 29 cells, so a 64 × 64 pond takes about 43 wounds per 1,000 steps and each cell about 1.5 hits per
5,000-step cycle. The survey's runs were 22 headless runs on `breeder`, seeds 1 and 2, 30,000 steps (six
cycles), 2026-10-22:

| Setting | Living cells (seed 1 / 2) | Ponds fit to donate, mean (min) | Boundaries where every donor scored 0 |
| --- | --- | --- | --- |
| Calm | 23.2k / 18.8k | 14.0 / 13.3 (13 / 10) | 0 of 6 / 0 of 6 |
| Wounds | 7.4k / 4.7k | 9.0 / 7.7 (4 / 3) | 6 of 6 / 5 of 6 |
| Wounds and shells (2) | 15.6k / 15.4k | 9.8 / 12.3 (8 / 10) | 3 of 6 / 3 of 6 |

*Living cells* is the mean over the censuses from step 5,000, of the 65,536 cells in the 16 ponds (calm is about
a third of them, wounds about one in ten). *Ponds fit to donate* is the survey's own measure, a pond holding at
least 48 bound mass of 16; the rule itself takes any occupied pond. *Every donor scored 0*: the rule's score
(`worstRanks`, `packages/schema/src/ponds.ts:314-323`) is a pond's worst rank across its measures, so 0 means
tied for last on at least one of them; when every occupied pond scores 0 the rule's order falls to bound mass
(`armDonors`, `ponds.ts:574`).

- **One dose.** Light wounds (`wounds(3, 13000)`, about 0.38 hits per cell per cycle) read like calm (living
  18.4k / 19.1k; ponds fit to donate 12.5 to 13.3 on average) and a shell added nothing there. They earn no slot.
- **Shell 2.** Membrane is nearly absent in this pond: calm's checkpoints held it in 2.0 %, 0.8 % and 0.3 % of
  living cells at 1, 2 and 4 or more. Shell 2 recovered both seeds; shell 1 gave 6.1k and 15.9k and shell 4 gave
  9.0k and 11.4k, which at two seeds is noise. So 2 is the one value seen to work twice, not an optimum.
- **Fixed, not a number.** The player cannot see membrane, so the choice is on or off, never a dial.

**The control.** A fieldset in "Plant a world" (`apps/lab/lab/index.html`, after `#preset-desc`, before the Seed
field), shown only when the world chosen in the select is one of the set.

- *Legend and lead line.* "Weather for the breeder", then "Set when you plant; to change it, plant again. Keep
  the seed number and the ponds start exactly the same under each weather, so you can compare." Checked: for
  seeds 1, 7 and 4242 the three presets' start states are equal in every cell word and every genome word
  (`initWorld`, scratch, 2026-10-22). On the reference at seed 7, calm and wounds first differ at step 13, the
  first injury round, and wounds and wounds-with-shells at step 26, the second round (the first to hit a cell
  holding 2 membrane). The lab opens on a fresh seed each visit (`main.ts:197-206`) and a radio leaves the Seed field
  alone, which is why the line says to keep the number.
- *Three radios, one detail block.* Each radio shows its word and a gist of a few words; below them one block
  shows the chosen level's two sentences, so the rail does not carry six sentences ahead of the Seed field and
  Plant:

| Word | Gist | What it does (computed from the config) | Why it matters (fixed text) |
| --- | --- | --- | --- |
| Calm | Only your own wounds. | "No wounds of its own: the only wounds are the ones you make with the Wound tool." | "Most ponds can still donate, and the donors are the ponds that score best." |
| Wounds, no shells | For comparing with shells. | "Small holes keep getting punched in the ponds at random: discs of radius 3, each cell hit about once per 3,250 steps, which is about 1.5 hits per cell between cycles. A hit cell is cleared: its body turns to waste." | "Far fewer cells live, and the rule's score can stop telling the ponds apart, so the choice under “The rule breeds for” may have little to grip." |
| Wounds and shells | Membrane can save a hit cell. | "Small holes keep getting punched in the ponds at random: discs of radius 3, each cell hit about once per 3,250 steps, which is about 1.5 hits per cell between cycles. A cell holding at least 2 membrane survives a hit and spends 2 of its membrane; any other hit cell is cleared." | "Membrane is one of the four kinds of matter in the matter bar (Is the jar still sealed?), and most cells hold little or none at first, so early wounds still take nearly everything. Does it spread in yours? Watch Cells wearing a shell: a chart in How it's going and a row in Who's living here?" |

  Wounds, no shells is the control: on all three rows of the survey table it is the worst of the three, so
  read as a menu it would never be picked. Its word and gist say it is there for comparison, and the lead
  line says how to compare (plant, watch, plant again under another weather with the same seed number).

The numbers in the second sentence come from the config by the functions `worldTraits` already uses (the rate
from `injuryProb` via `cellsInDisc`, `worlds.ts:39,129-133`), shared so the control, the chips and the "Like X,
except" line cannot disagree. The "why it matters" sentences are fixed text and carry no figure from a run: they
state the mechanism, and what has been seen is dated in the catalogue (§2). A vitest holds them to that (§5).

- Choosing a radio sets the select to that level's id and runs what the catalogue's chooser runs
  (`showPresetDesc`, `syncPlant`; `main.ts:233-243`). Nothing is planted until Plant is pressed. The select, the
  catalogue and a link (`?world=breeder-wounded`, `main.ts:202-208`) move the radio. The control is a view of the
  preset id, not a second state: `syncPlant`, the tab title and links compare preset and seed only
  (`main.ts:221-232`), so anything outside the id would be invisible to them.
- It is a data table in `worlds.ts`, `WEATHER = { base: "breeder", legend, lead, levels: [{ id, word, gist, matters }] }`.
  A vitest guard holds each level's config to the first level's plus only the four injury keys, so "only the
  weather differs" is checked, not asserted.
- The weather cannot change mid-run. Planting again is how to change it, and the lead line says so; the replace
  guard (`guard-new`) already says what planting over a run loses.
- Hidden for every other world. Offered on `breeder` only: the sizing run was on `breeder`; `ponds` and
  `ponds-small` (a 1,000-step cycle) have no measurement, and the lever is not offered where it is unmeasured.

**Why no new intervention kind.** An intervention is something the player does at a step, logged so a replay
repeats it (`pick`, `pressure`, `lesion`, `feed`, `sun`). Weather is not done mid-run: it is a rule from step 0,
and the whole config is already carried everywhere a world is carried. The manifest stores `cfg: state.cfg`
(`sim.worker.ts:423-428`); a checkpoint stores it as JSON and `validateConfig` runs on decode
(`packages/schema/src/checkpoint.ts:27-50,111-112`); `stateHash` covers every key (`canonicalConfig`, `packages/schema/src/accounting.ts:83-99`);
restore, jump and import use the stored config; and injury is a counter PRNG keyed on seed, step and cell
(`RND.INJURY`, `packages/schema/src/layout.ts:85`; `packages/sim-ref/src/step.ts:660-681`), so nothing outside the config needs replaying. A "start the
wounds now" button would be an intervention kind with its own replay rule. It is not asked for and not built.

**Why presets, not a planting override.** The load message can carry overrides (`protocol.ts:305`,
`sim.worker.ts:440-444`), but an overridden world is refused or invisible in five places: `exportRefusal`
refuses any config that differs from `presetConfig(preset, seed)` (`session-file.ts:101`);
`tools/run.ts:364-372` refuses a lab manifest whose config differs from `specConfig(spec)`, and
`OVERRIDE_KEYS` is `mutRate` and `pondDeath` (`packages/runner/src/runner.ts:520`); `replayCommand` emits no `--override`
(`session-file.ts:125-131`); `worldTraits` reads `presetConfig(p, 0)` (`worlds.ts:49`), so chips, catalogue and
cards would not show it; and `syncPlant` and links compare preset and seed only. Presets pass all five. The
price is that each level is a world: wound level × shell level multiplies, which is why this slice offers three.
A dose dial would be the slice that pays for override plumbing, and a session-file bump with it.

**Naming.** Seven presets are already called "The storm" or "Storm (…)" under "Storms and the breeder" (`worlds.ts:267-274`, ids
`wild-storm*`, and the jargon test rejects `wild-storm` in visitor text), so no player-facing text this slice
writes says "storms". The control is "Weather for the breeder"; the lever is "wounds" and "shells"; polymer is
always "membrane". The family heading itself, and the two near-twin entries the select now lists, are the
user's to settle (§6).

## 2. What the choice says, and where else the shell is named

- **A trait, computed from the config** (`worldTraits`, lever `wounds`, after the recurring-wounds trait): label
  "A wounded cell holding at least 2 membrane survives", detail "the wound takes the 2 membrane and spares the
  cell; a cell with less is lost". It appears only when `injuryShell` is set. The jargon regex
  (`worlds.test.ts:15`) holds: no key, no id.
- **A chain of bases.** `breeder-wounded`'s `base` is `breeder`; `breeder-wounded-shell`'s is `breeder-wounded`,
  so each "Like X, except" line (`diffLine`, `worlds-ui.ts:58`) shows exactly one step: the wounds, then the shell.
- **The catalogue.** Both worlds join the family `wild` ("Storms and the breeder"), right after `breeder`; its
  `why` gains one sentence ("Wounds on the breeder, with and without a shell that lets a cell holding membrane
  survive one, ask whether cells that store a little membrane can sit out the wounds that kill everything
  else."). Notes, state `observed` ("Seen"), each `seen` one dated line:
  - *Wounded.* Asks "Does breeding still work when the ponds are wounded all the time?" Look: "Breed by hand and
    read the ranks: when every pond ties at the bottom, the rule falls back to the heaviest ponds, and the panel
    says so." Seen: "22 Oct, two seeds, 30,000 steps: about one cell in ten alive (calm, about a third); at 11 of 12
    cycle boundaries every donor scored 0. Not read against a bar."
  - *With shells.* Asks "Can cells that store a little membrane sit out the wounds that kill everything else?"
    Look: "Watch Cells wearing a shell under How it's going: it starts near zero. Your own Wound tool still cuts
    through shells." Seen: "22 Oct, the same two seeds: living cells were 1.6 and 7.7 times the wounded runs'
    at 15,000 steps, with shells on 1 living cell in 5 in one seed and about 1 in 70 in the other. A look, not a
    result."
- **Cards.** `pnpm gen:cards` redraws both (the manifest keys must equal the `PRESETS` order,
  `social-meta.test.ts:164`, and `vite.config.ts:122-124` refuses a build on stale cards); look at them.
- **The Wound tool.** In a world with a shell, its line (`TOOL_SAYS`, `main.ts:471`) adds: "This tool is a cut,
  not weather: it clears whatever it touches, shell or not. Only the world's own wounds can be weathered." The
  brush always lesions (`injuryShell` is read only in the recurring-injury branch, `packages/sim-ref/src/step.ts:660-681`).
  The line depends on the loaded config, and `setTool` runs only on a click (`main.ts:484,497`), so the `loaded`
  handler (`main.ts:~1815-1835`) re-runs `setTool(tool)`.

## 3. What the player sees: a chart, a row and a line

**The count.** At a census, the living cells (lineage words not both zero, the census's own definition,
`packages/metrics/src/census.ts:65-77`, whatever their mass) whose membrane `P` is at least `injuryShell`, read from the census's
own snapshot (`cells[CH.P * n + i]`). Whole world, not per pond. It is **the snapshot's eligibility, not a
forecast**: the rule reads a cell's membrane after the step's BUILD and decay (`packages/sim-ref/src/step.ts:598-604`
and `652-654`, before the injury at `660-681`), so a cell below the shell now can build up to it before the next round, a cell at it can decay or be
spent by an earlier hit and fall short, and cells are born and die in between. Later protection can be higher
or lower than the count.

- **Where it is computed.** Not from the `Census` object, which holds labels and lineage tallies, not per-cell
  membrane. `LabExecution.advanceLive` already holds the snapshot (`execution.ts:651-654`) and the paused path
  `sendCensus` reads one (`sim.worker.ts:631-642`). A pure function in a new `apps/lab/src/shell.ts` (in the
  style of `pond-play.ts`) returns `{ wearing, living }` or null when the config has no shell; nothing runs in a
  world without one.
- **Where it goes.** A new optional last argument of `onObservation` (`execution.ts:81`), the worker stores
  nothing (`postCensus` runs inside the census callback, so it carries that census's own count) and adds an
  optional `shell` to `CensusMsg` (`protocol.ts:116`); `sendCensus` computes its own.
  **Display only:** not in `ObserverState` (`artifactDigest` would move), the session file, a checkpoint or any
  digest.

**Where it shows.** Two places, both hidden unless the world has a shell, both fed by `CensusMsg.shell`:

1. *A fourth chart in "How it's going"* (`lab/index.html:~130-135`, `.history-lines`): "Cells wearing a shell
   (share of living)". The share tells the two seeds of the sizing run apart and the count does not: at the
   pre-cycle censuses (5,000 to 30,000 steps) the share of living cells holding 2 or more membrane was 1.7, 6.9,
   20, 28, 47 and 40 % in seed 1 and 1.2, 1.2, 1.4, 2.7, 4.9 and 6.2 % in seed 2. The chart is where a
   player can watch the first cycles for a rise. What the spec needs of the existing chart code:
   - The value pushed is the percentage, not the fraction, because `Series` scales to the largest value pushed
     (`sparkline.ts:62-63`; its floor is 1, which suits a percentage).
   - `Series` prints its top and latest value with `fmtShort`, which rounds to whole numbers
     (`sparkline.ts:98-108`), so a share of 1.7 would read "2". The constructor takes an optional formatter as
     a third argument; this chart's prints one decimal and a percent sign ("47.2%"); the other three are
     unchanged. The section's hint already says "each chart runs from 0 to the number at its top" and "dashed
     lines mark pond cycles", which hold.
   - A fourth `.spark` makes the grid four across while it shows (`style.css:298`, a class on `.history-lines`);
     the narrow layout is one column as now (`style.css:585`). The canvas's `aria-label` is "Share of living
     cells wearing a shell, over time".
   - It joins the other three at their three call sites: `redraw()` in the theme-change listener
     (`main.ts:862`), `clear()` in `resetEvidence` (`main.ts:883`) and `mark()` in `onPonds` (`main.ts:1054`).
2. *A row in "Who's living here?"* (`lab/index.html`, the `k-` list; `onCensus`, `main.ts:927`), "Cells wearing a
   shell": "1.7% of living cells (372 of 21,769)", the share first. At zero the row reads "none yet" with a
   line under it: "No living cell holds 2 membrane right now, so a wound now would take whatever it hits." (The 2
   is the config's shell.) The
   row's tooltip says "A snapshot at this census. Cells build and shed membrane between censuses, so the next
   wound can find more or fewer."

The zero branch is rare in practice. On the CPU reference (`breeder` with the shell world's keys, seed 1, no pond
cycle applied, 2026-10-22, `runs/pond-shell/review/early-membrane.ts`) the count of living cells holding 2 or
more membrane was 0 at step 0, 2 of 6,354 at step 2, 38 of 8,693 at step 14 and 93 of 10,485 at step 40. So the
row reads "none yet" at planting and for the first step or two, and a number from then on; the chart is where a
trend shows. There is no probe-card row: the probe already shows "Membrane (P)" (`CHANNEL_LABELS`,
`main.ts:~982`) for the one cell it looks at.

**What to expect, from the sizing run.** The share of living cells holding at least 2 membrane, averaged over the
30,000 steps (checkpoints every 500): calm 1.3 % and 0.4 %; wounds 0.7 % and 0.6 %; wounds and shells 13.3 % and
2.0 % (seeds 1 and 2). Shells ran at 1.2 to 1.7 % at the first pre-cycle census in both seeds, then diverged:
one seed reached 20 % by the third cycle (15,000 steps), the other had 1.4 % there.

**The breeder panel's line.** Under wounds the rule's score often ties at zero (§1): in the survey, 11 of 12
boundaries without shells and 6 of 12 with, so the pressure dial moves nothing and "The rule's choice" quietly
means the heaviest ponds. When a cycle waits, the arm is `breed`, a score is in force (`a.ruleScore ?? a.score`)
and `rankValues(a, "score")` is 0 for every occupied pond (`a.terms.mass[p] > 0`; the same `worstRanks` over the
survey's `terms` the engine uses, `main.ts:1095-1099`), `#breeder-call` (`syncPicks`, `main.ts:1259`) gains a
sentence, in a normal-weight span: "The occupied ponds are all tied on {the measures every occupied pond is at the
bottom of}, so the rule's score cannot tell them apart and the rule picks the heaviest ponds instead. Another
choice under “The rule breeds for” may separate them." When no single measure is flat for all of them, the first
clause reads "Each occupied pond is at the bottom of at least one of {the score's measures}". A pure function in `rank-labels.ts` (`tiedAtZero(a)`: the words, or null) decides it. It
reads only the waiting cycle's message: no scoring, no donor, no log entry changes. It fires in any breed world
where the tie happens, not only the wounded ones.

## 4. Replay, the session file, the manifest and tools/run.ts: nothing changes

| Surface | Change | Why |
| --- | --- | --- |
| Lab replay (jump, replay check, restore) | none | the config is whole in the manifest and checkpoint; injury is keyed on seed, step and cell |
| Run manifest, OPFS records | none | `isManifest` checks only `runId`, `checkpoints`, `interventions` (`opfs.ts:212`) |
| Session file | **no version bump** (stays 3; `firsts-v2`, `families-v1`) | `exportRefusal` passes, since the config is the preset's (`session-file.ts:101`) |
| `tools/run.ts --picks-from` | none | `--preset` takes any `PRESETS` id; `specConfig(spec)` is `presetConfig` plus the `treatment` condition, which adds no keys (`conditions.ts:23`; `run.ts:364-372`) |
| Coordinator, islands | none | lab-only worlds; `config.exs` lists accepted presets, and `coordinator-presets.test.ts` checks only those |
| `RULE_VERSION`, golden pins | untouched | `injuryShell` and its `injury-shell` golden case landed in `6fe65016` |
| Frozen fixtures v1 to v3 | untouched | they replay as before; this slice adds no fixture |

An older checkout does not know the two ids: its `specConfig` throws "unknown preset"
(`packages/runner/src/runner.ts:637`), which is the whole cost of adding a world. The proof that a wounded,
shelled session replays is two-fold: a vitest through `LabExecution` (§5) on the reference physics, and the
browser spec's own replay check (`#btn-verify`, "Latest replay check" reading "matched", as `lab-pond-keeper-v2`
does) on the lab's GPU twin. No Deno replay of a new fixture: nothing here changes the session format or adds an
intervention kind, so a second host would be checking the same config-carrying the vitest already checks. The
session file the spec downloads can be replayed once by hand
(`deno run -A tests/deno/pond_keeper_replay.ts <file>` takes paths), before the slice lands; that is not a gate
and nothing is committed.

## 5. Gates for this slice

- `pnpm typecheck` clean; `pnpm test` passes with the new presets in every loop over `PRESETS`
  (`presets.test.ts`, `breed-runner.test.ts`, `ponds.test.ts`, …). `golden-hashes.test.ts` untouched.
- vitest, new:
  - `shell.test.ts` (a hand-built state: a cell at the shell counts, one below does not, a cell with no lineage
    does not even holding membrane, no shell in the config gives null; and a hand-built wound, stepped once on
    the reference, under a wound at every cell, in which a cell holding far more than the shell keeps its
    lineage and one holding none loses it, so the weathered case is pinned here, with margins wide enough
    that BUILD and decay between cannot flip either, and not left to chance in a run).
  - `rank-labels.test.ts` for `tiedAtZero`: a hand-built `terms` where every occupied pond ties at the bottom
    of a measure gives the sentence with that score's measures; one pond above 0 gives null; a single-measure
    score; an arm other than `breed` gives null; empty ponds do not count as occupied.
  - `execution.test.ts`, on `ponds-small` with `pondPeriod: 20` and `wounds(3, 3250)` plus `injuryShell: 2`
    (`pondWorld(0, { … })` takes the override; reference physics, via `pondSetup`), over **40 steps**, censuses
    every 2 (`pondSettings`). The period and horizon are chosen so the world is wounded across its cycles: the
    boundaries fall at 20 and 40 and injury rounds at 13, 26 and 39 (`(step + 1) % 13 === 0`,
    `step.ts:493`), one before the first boundary and two between the boundaries; the first census to see a
    round is 14. (The existing fast setup, `pondPeriod: 4`, finishes at step 8 and sees no round.) It asserts:
    at every census the `shell` the execution reports equals a recount written in the test, from the snapshot
    the census was built from (at a boundary census the reference state is already past the cycle); at least one census from step 14 to step 20 reads
    `wearing > 0` (scratch run of the reference: 10 to 17 cells), so the test cannot pass on zero equals zero;
    it does **not** require `wearing > 0` at every census or after the first cycle, which was not measured.
    A history in the same world with a hand lesion at step 6 and a hand pick at the step-20 boundary replays
    through a second `LabExecution` to the first one's `stateHash`. The timeout is set from a first run; the
    existing pond tests allow 60 s for about 28 steps of this world.
- vitest, extended: `worlds.test.ts` (coverage and one family for both presets, unique names, the jargon regex,
  the `WEATHER` guard, the shell trait carries 2 and appears only with a shell, the diff of each step is one
  added trait, the control's sentences name the config's numbers, and no "why it matters" line contains a
  digit, which keeps run figures out of fixed text); `session-file.test.ts` (`exportRefusal` null for both,
  `replayCommand` names them); `social-meta.test.ts` after `pnpm gen:cards`.
- Playwright (Chrome), still passing: `lab-worlds`, `lab-pond-keeper`, `-v1`, `-v2`, `lab-ponds`,
  `lab-pond-refusal`. New: `tests/e2e/lab-pond-keeper-v3.spec.ts` (v2 spec as template): on `?world=breeder`
  the Weather control shows Calm chosen and no shell row or fourth chart; choosing "Wounds and shells" shows the
  detail block and makes the Plant note say nothing is planted yet; plant it; the fourth chart appears and the
  row reads "none yet" before any step; step by hundreds until the row reads a number (poll, not a fixed step:
  the reference had 2 cells by step 2) and check its form, "N% of living cells (K of M)" with K at least 1; the
  Wound tool's line says hand wounds are cuts; wound a pond by hand, play to the first cycle, breed with the
  rule's donors, replay-check the history (`#btn-verify`, "matched"), download the session file
  (`sessionFileError` null). The spec does not assert whether the breeder panel's tied-at-zero line fires at the
  first cycle: it depends on the seed and the hand wound, and the vitest covers the rule.
  No `BL_WRITE_FIXTURE`, no new fixture.
- The lab builds (`pnpm build`) with fresh cards. Codex Sol 6.1 High, read-only, reviews this note and then the
  diff before any commit. Nothing is pushed or opened as a PR without the user's yes.

## 6. Deferred, and why

- **A pond-score "shell" term** for the pressure dial: `PondTerm` and `POND_TERMS` are part of the config and of
  the preregistered scores, and the term would touch runner scoring.
- **A per-pond shell rank in the donor picker (v3b).** The one change that would make the shell a decision about
  which ponds to breed from. `PondAwaitMsg.terms` is already per pond (`protocol.ts:174`) and the picker already
  ranks by "speed", which is not a `PondTerm` (`main.ts:1161`, `1095-1099`), so a display-only key would follow
  that pattern without touching scoring. It needs a per-pond count in the survey (a protocol field and a worker
  computation on the pre-cycle state) while §3 is whole-world by design, so it gets its own note after this slice
  has been played.
- **A "Hail" tool:** one world-style wound dropped where the player clicks, which a shell can weather. It needs a
  new intervention kind and a replay rule. It is named here so the gap between the Wound tool (a cut, shell or
  not) and the world's weather has a name.
- **The Wound brush respecting shells:** `applyLesion` is kernel; changing it is a rule change and a pin.
- **A new first** (for example the first pond whose bodies live through the world's own wounds): the log never
  sees recurring wounds, and a rule needs a rule set id and its own note.
- **A membrane or shell view:** the renderer has none (`VIEW_MODES`, `packages/sim-gpu/src/renderer.ts:7`); a display shader change.
- **Light wounds, a dose dial, shell values:** §1.
- **Weather other than at planting,** and weather on `ponds` or `ponds-small`: unmeasured.
- **The family heading and the near-twin entries (the user's call).** The worlds sit under "Storms and the
  breeder" (`worlds.ts:269`), a heading this slice's own rule keeps out of its player text, and the storm worlds
  there are another matter (a wandering sun, extinct in the one seed). A family such as "The breeder and its
  weather" is possible; `worlds.test` only needs each preset in exactly one family. Choosing a radio also sets
  the Starting world select, which then lists two near-duplicates of `breeder`. The legend "Weather for the
  breeder" is the least change and what this note does.

## 7. What it cannot show

- **A look, not a result.** Two seeds, 30,000 steps, one machine, no bar written in advance. The shell value was
  picked by a look.
- **Selection, not protection.** Few cells hold membrane (§1), so almost no wound lands on a shelled cell at
  first, and the count (§3) is a snapshot that can move either way before a round. Living cells recovered in
  both seeds; membrane climbed in only one, over three or more cycles (15,000 steps or more). The lever may read
  as nothing for a long stretch, and the chart is how a player can tell.
- **Not whether builders spread by themselves.** No `genes` here. That is gene v2's arms in a shell world, a
  separate track (screen v2 and its follow-up), and nothing in this slice runs them.
- **The pressure dial is near-inert under wounds.** In the Wounds runs every donor scored 0 at five or six of
  six boundaries, so the ranking falls to bound mass (`packages/schema/src/ponds.ts:574`); shells brought that to three of six.
  Ponds fit to donate dropped as low as three or four of sixteen. The cycle itself held: 16 of 16 packets landed
  every cycle in every run and nothing went extinct. The breeder panel now says so when it happens (§3); it
  does not make the dial work.
- **Hand wounds and the firsts.** `outlive-wound` reads only hand wounds (`woundsBetween`, `firsts-log.ts:111`;
  rule `packages/metrics/src/firsts.ts:836-907`). In a wounded world a hand wound can count because the world's own wounds took the
  cells between censuses, so the entry may overstate it, and the card's wound count leaves the recurring ones out.
- **Cells, not lineages.** The readout counts cells, not whether they are kin or descend from one another.
- **No wall-clock promise.** The default speed is 4 steps a frame (`lab/index.html:101`, `sim.worker.ts:125`), about
  240 steps a second only at 60 frames a second, and the lab shows the rate it really gets, so no player text
  says how long a cycle takes.
- **Determinism only.** Injury plus a shell across three pond cycles on `ponds-small` ran twice on the GPU to the
  same final hash with conservation exact (survey, 3,000 steps). That is the physics being sound, not the world
  being interesting.

## Clarifications made during review (2026-10-22, before any code)

A Codex review and a player critique of this note found these; the sections above already read as amended.
Each claim was checked against the code or the survey before it was taken.

**Changed.**

- **The execution gate** (Codex P2). The old gate named `pondSetup` and "at least two pond cycles", whose
  existing fast setup (`pondPeriod: 4`, `execution.test.ts:278`) ends at step 8, while the first injury round is
  step 13 (`(step + 1) % 13 === 0`). §5 now fixes `pondPeriod: 20` and 40 steps, so boundaries fall at 20 and
  40 and rounds at 13, 26 and 39, and requires a nonzero observation from step 14 to 20 (reference scratch: 10
  to 17 cells) so the test cannot pass on zero equals zero. It deliberately does not require a nonzero count at
  every census or after the first cycle, which was not measured, and moves the weathered hit into
  `shell.test.ts`'s hand-built state, since a run with a handful of wounds on 20 shelled cells is not a
  reliable place to see one.
- **Post-plant assertion** (Codex P3). Membrane is exactly zero at planting (`pSum` 0 at step 0, 2026-10-22) and
  adoption pauses at step 0 (`sim.worker.ts:331`), so the row reads "none yet" first; §5 asserts that, then
  polls until a number shows and checks its form. The same scratch found 2 cells of 6,354 by step 2, so "none
  yet" is a planting-moment state, which §3 now says.
- **The count is a snapshot** (Codex P3). BUILD raises `P` in the same step before decay and injury
  (`step.ts:598-604`, run for every living cell with `B > 0` when no genes gate it, `step.ts:579`), so a cell
  below the shell can reach it before the next round as well as a cell at it falling short. "Upper bound" is
  gone from §3; the count is the snapshot's eligibility, either direction, and the zero line is worded for "right
  now".
- **The dial message** (critic 1; was deferred in §6 as "dial messaging"). Under wounds every donor scored 0 at 11
  of 12 boundaries, so the panel the player already uses stops responding. §3 adds one display-only sentence to
  `#breeder-call`, decided by a pure function from the waiting cycle's own `terms`. Two corrections to the
  critic's wording: the sentence is keyed to the score in force and says "scores above 0 on {measures}", because
  the score is a worst rank (a pond that ties for last on one measure scores 0), not an absolute amount of
  movement; and "your pressure setting has nothing to grip" became "another measure under the dial may separate
  them", since a single-measure score can separate ponds the three-measure one cannot.
- **Radio texts and legend** (critic 2). Legend "Weather for the breeder" with the lead line (verified: the
  three start states are identical for seeds 1, 7 and 4242, and a radio leaves the seed alone); the middle
  level renamed "Wounds, no shells" with a gist that says it is the comparison; one detail block under three
  radios instead of six sentences. The old Wounds line "few ponds hold anything fit to donate" contradicted the
  note's own 9.0 and 7.7 of 16; it now describes the ranking ("the rule's score can stop telling the ponds
  apart"). The old Calm line "most ponds fill" overclaimed (calm is about a third of the cells alive); it now
  says most ponds can still donate (14.0 and 13.3 of 16).
- **Chart and share** (critic 3). A fourth chart in "How it's going" and a share-first row ("1.7% of living cells
  (372 of 21,769)"), because the share separates the two seeds (1.7 to 40 % against 1.2 to 6.2 %) where the
  count does not and the row sits in the rail's fourth section. Found while checking `Series`: it prints whole
  numbers (`fmtShort`) and floors its scale at 1, so §3 specifies a formatter argument and a percentage value.
  The critic's extra hint was dropped because the section's hint already covers the scale and the dashed lines.
  The probe-card "Shell" row is dropped: the probe shows "Membrane (P)" already, for one cell.
- **Wound tool line** (critic 4): reworded as a cut, not weather. The `loaded` handler must refresh it
  (`setTool` runs only on a click), which §2 now says. The "Hail" tool is named in §6.
- **"Builders"** (critic 5): out of the family `why`, the notes and the radios, which removes the contradiction
  (the note said it declares no builder while the player text called the cells builders). "Lines that make
  membrane" and "before they can count" are gone with the old radio texts. Preset names follow the "Storm (…)"
  pattern (`presets.ts:304-306`); the critic left the names to the user, so they are cheap to change before any
  code exists.
- **Size** (critic 7): the Deno replay fixture and `BL_WRITE_FIXTURE` are cut, the two "Seen" notes are one
  dated line each, and §4 and §5 now agree on what proves the replay (vitest plus the browser spec's own replay
  check, and an optional by-hand Deno replay of the downloaded file). The cost is that `tools/run.ts --picks-from`
  is not run on a shelled session by any gate; the config it compares is the preset's by construction.
- **Small corrections.** The lab page is `apps/lab/lab/index.html` (the note said `index.html`); the survey table
  now says what "ponds fit to donate" and "every donor scored 0" measure; "What to expect" gives the checked
  per-boundary shares; no wall-clock figure appears in any player text (the default is 4 steps a frame, which is
  about 240 a second only at 60 frames a second).

**Not taken, with the reason.**

- **Two-seed multiples inside the radio text** (critic 2: "1.6 and 7.7 times", "1 in 5 against 1 in 70", "about a
  minute"). Run figures in fixed control text go stale and cannot be checked against the config; the note keeps
  fixed text qualitative and dated results in the catalogue's "Seen" lines (now with the critic's figures, one
  line each), and a vitest keeps digits out of the "why it matters" lines. "About a minute at the default
  speed" is also unmeasured (see above).
- **A per-pond "Cells wearing a shell" rank in the donor picker** (critic 7). It is the change most likely to make
  the shell a decision, but it needs a protocol field and a worker computation, and §3 is whole-world by design.
  Deferred to v3b, with its shape written down in §6; the grown slice would not be one slice.
- **A new first or goal** (critic 7). The chart, the "Does it spread in yours?" line and the dial sentence are
  the goal-shaped additions; a new first needs a rule set id and its own note (§6).
- **Moving the worlds to a new family, or hiding the near-duplicate select entries** (critic 6). Both are valid
  observations and are flagged for the user in §6; the first reorganises the catalogue and the second changes
  the select, and neither is this slice's to decide. The legend is the mitigation taken.
- **The critic's "dashed lines" hint** (critic 3): the section's hint already says it.

## Changes made during implementation and review (2026-10-22, before commit)

The code was reviewed three ways (Codex Sol 6.1 High against this note, a note-to-code drift check, a replay and
UI audit) and by screenshots. These changes were made then; the text above now quotes what ships.

- **Player words.** "Pressure dial" and "pressure setting" are not words on the page: the Wounds level's "why it
  matters" and the breeder panel's line now name the control by its label, "The rule breeds for". "Scores above
  0" is gone from the panel line and from the wounded world's catalogue note ("when every pond ties at the
  bottom").
- **The breeder panel's line** names only the measures every occupied pond is tied at the bottom of (the audit
  found it named all of them when only one tied), with a fallback when no single measure is flat, and sits in a
  normal-weight span inside the bold waiting-cycle line.
- **The shells level's "what it does"** says the holes sentence in full instead of "The same holes.", so it reads
  on its own; its "why it matters" says where to watch (the chart and the row).
- **Radio words end in a period** ("Calm.", "Wounds, no shells.", "Wounds and shells."), as the tool picker does.
- **Small shares** read "<0.1%" in the row and the chart instead of "0.0%".
- **Layout.** The four charts' canvases are aligned to the bottom of each chart box (two titles wrap at 1440 px);
  the shell row's value sits on its own line under its label, so the list does not re-flow when it changes.
- **Plumbing, as built.** Nothing is stored in the worker (§3 "Where it goes"); the execution test recounts from
  the census's own snapshot (§5); the preset descriptions describe rounds of discs and say "membrane (the physics
  calls it polymer)"; `breeder`, `breeder-wounded` and `breeder-wounded-shell` share one config literal, with
  `breeder`'s config unchanged (the frozen v1–v3 fixtures still replay).
- **The browser spec's tie check** (review on PR #71): it reads the tie from the ranks the panel shows (the top pond by the
  rule's score reads 0) and asserts the panel's line is present exactly then and absent otherwise, instead of gating on the line's
  own text. It still does not expect the tie to fire at the first cycle either way.
- **Not taken:** the Weather control showing Calm after a shelled session is restored (the control is a view of the
  select's preset, as §1 says); the new cards' chips (the card keeps the first three traits); the extra
  accessibility attributes and tests the drift check listed as beyond the note, which stay.

