# The proposer's suggestions in the lab, v0 (2026-10-18)

Status: **exploratory, code only.** Field notes (`docs/naturalist-field-notes-v0-2026-10-18.md`, PR #52) files a note when a
world rings at its preset's calibrated rule. The experiment proposer (`docs/naturalist-proposer-v0-2026-10-18.md`, PR #34) turns a
ring into a run spec by a fixed rules table. This note puts the two side by side in the lab: beside each note, the proposer's
suggestion for it, the offline commands that would run it, and a **Try it here** button that applies the suggested intervention to
the world on screen as an ordinary hand edit. Nothing here calls a model, changes physics, a rule, a checkpoint format or a golden
pin, or runs anything offline.

The section "Fixed before code" was written before any of this code existed. Later changes go in dated sections below it; this
section is not edited after code lands. Nothing here amends the field-notes, proposer or bench notes.

## Fixed before code (2026-10-18)

### Four rules that hold everywhere

1. **The naturalist never acts on its own.** Nothing it computes changes the world. A suggestion is words and commands on the
   page. The only path from a suggestion to the world is a person's click on **Try it here**: no timer, no keyboard shortcut, no
   auto-focus, no retry, no "apply all". One click applies one suggestion once.
2. **Running is the person's choice.** The page runs nothing offline and starts no `tools/` command. It prints the commands a person
   could run from the repository root. The proposer's own yes gate (`tools/propose.ts approve --by "<a person's name>"`) still
   stands between a proposal file and its run, and the page says that only a person approves.
3. **This is not the bench.** A suggestion carries no score, and nothing on the page says or implies that the rules beat a random
   intervention, or that a suggestion is a good experiment. Whether the rules beat random forks is the bench's question
   (`docs/naturalist-bench-v0-2026-10-18.md`), which has not run, and the page says so beside every suggestion.
4. **Notes stop after the person intervenes, and the panel says so.** A click on Try it here is a change by hand like any wound,
   feed or drain: the panel stops reading at the next census, as #52 does, and keeps the notes filed before it, marked as filed
   before the change. Before the click, the suggestion says that this will happen and that the naturalist will therefore not say
   whether the prediction held in this world. After it, the suggestion says it was tried, at which step, and that reading stopped.

### What a suggestion is, and where it comes from

One suggestion per note, computed from the note alone: its (signal, side), its receipt (first window's start and end steps,
smallest |z|, the world's value and the neutral median at the window's start) and its spread (the bell's at the receipt's first
census, the σ the proposer calls `spread`). Not from its stretch, which changes as censuses arrive: a suggestion is fixed once its
note is filed.

Every rule is the proposer's, by import from `tools/lib/propose.ts` (the lab already imports `tools/lib/bell.ts` and
`tools/lib/notebook.ts` this way). Nothing of the rules table is copied:

- **The rule row:** `ruleFor(signal, side)` from `RULES`, the 26-row table (feed, drain, wound, or the replay control).
- **Where:** `rulesInterventions(row, cfg, S, A)`: the jar disc (`jarDisc`), one entry per tile at the tile's centre, radius
  `maxLesionRadius(cfg)`. Both presets with a baseline (gradient-m3, spots-m3) are one 256 × 256 tile, so a suggestion is one
  entry, centre (128, 128), radius 127, about 77% of the world's cells (`jarShare`).
- **How much:** A = `feedAmount(preset)`, the preset's `init.nutrient` (32 quanta per cell for both).
- **When:** S = the receipt's `endStep`, the first census at which the bell could have rung, as the proposer rules.
- **The words of the dose:** `interventionWords(action, cfg, A)`.
- **The hypothesis:** the proposer's `HYPOTHESIS[action]`, which this slice exports from `tools/lib/propose.ts` (an additive
  export; nothing else in that file changes).
- **The prediction:** `predictionFor(ring, row, spec, 0, RULES_V0)`, its statement shown as written: for a feed, drain or wound,
  "If <hypothesis>, then over steps <S + H − 4,900> to <S + H> the fork's <label> stays at least one spread (<σ>) <above|below>
  the source's, at the median."; for a replay control, that the fork's 13 signals equal the source's at every census. The
  constants are `RULES_V0` (W = 50, H = 20,000, one spread).
- **The run specs:** `buildForkSpec` on a source spec described below, with C = 0, checked by `validateProposalSpec` (which
  runs the runner's `validateInterventions`, `specConfig`, `interventionsError` and `validateSpec`, the fork window, the radius
  bound and the `MATTER_MAX` bound); the commands are `runArgv` of those specs. A suggestion whose spec the validators refuse is
  shown with the refusal in words and no Try button, never silently dropped.

The reason is the lab's own sentence, not the proposer's `reasonText`, because three of `reasonText`'s phrases are untrue of a
live gradient-m3 world: it says "beyond Z\*" where the lab's gradient-m3 rule is v1's "at least four spreads" (no Z\*), it cites
the stretch, which is still growing, and it says "still going at the run's end". The lab's reason cites only the note's receipt
(its steps, value, median, smallest |z|), the rule's threshold as the panel already words it, S, and the dose numbers
(radius, tile count, share of cells, quanta per cell); it states the hypothesis with the proposer's words. A neutral world's
reason opens by saying that its notes are false alarms by definition, as the panel's standing line does.

When two notes give the same run spec (for example living cells low and individuals low, both feeds at one S), each keeps its own
suggestion and prediction, and each says it is the same run as the other (by `specHash`), as the proposer's `alsoAnswers` does.

### The commands a person could run offline

The world on screen has no bundle on disk, so the fork starts from step 0 (C = 0): an ordinary `tools/run.ts` plant of the same
preset, condition and seed, replayed to S, then the intervention. The lab's physics is deterministic and #52 showed a lab
gradient-m3 world reproducing its run bundle census for census (seed 1, to step 16,000, on Chrome); no spots-m3 lab world has been
compared with a bundle, and the page says so for spots-m3.

The source spec is: experiment `naturalist-fork` (the proposer's `FORK_EXPERIMENT`, so `validateProposalSpec` holds for the
source too), the world's preset and seed, condition `treatment` (or `neutral` for a neutral world), S + H steps, census every
100, deep census every 10, no checkpoints, no activity threshold, no overrides. Deep cadence 10 is the bell corpus's
(`replay-m4` manifests) and `tools/run.ts`'s default; the lab runs deep 5, and neither enters the series fields or lineage rows
the bell reads (#52's seed-1 parity was a deep-5 lab world against a deep-10 bundle). The source is that spec with no
interventions, which is exactly the proposer's replay-control spec; the fork is the same spec with the suggestion's entry.

Shown, in this order, each as one line a person can copy (wrapped on screen, never scrolled sideways):

1. **The source and the fork,** two `tools/run.ts` commands, `--out naturalist-lab/<preset>-<condition>-seed-<n>-t<S>/source`
   and `.../fork-<action>` (outside `runs/`; `tools/run.ts` would write under `runs/` without `--out`). For a replay control the
   fork is a second source run. The prediction is decided between those two bundles, never on the world on screen. No command
   decides it in v0 (the proposer note, "Not decided by any command"); `predictionHolds` in `tools/lib/propose.ts` is the
   function the bench will call. The page says both.
2. **Through the proposer,** four commands on the source bundle: `tools/notebook.ts` (needs the bell corpus under `--base`,
   `runs/` in the main checkout), `tools/propose.ts propose`, `tools/propose.ts approve ... --by "<your name>"` (a person, never
   an agent) and `tools/propose.ts run`. The proposal's file name is printed by `propose`, so that one path holds `<id>`.
   **This path may not file this note.** The notebook rings at bell v0's calibrated Z\* strictly, over all thirteen signals. For
   spots-m3 that is the panel's own rule and envelope. For gradient-m3 it is not: the panel uses v1 part A (eleven signals, at
   least four spreads), while the notebook's gradient-m3 Z\* is 7.04 (`experiments/naturalist/bell-v0.json`); a gradient-m3 note
   whose weakest |z| is at or below 7.04 (seed 1's living cells note is 5.49) gets no notebook ring, so `propose` makes no
   proposal for it and may make others for rings it does file. The page says this for gradient-m3, before the commands.

### Try it here

- **What it applies:** the suggestion's entries (one, for both presets) as the lab's own Wound or Feed/Drain messages, with the
  suggestion's centre, radius and amount, never the brush sliders' values or the selected tool. The worker logs each as an
  ordinary intervention (`manifest.interventions`), counted on the session card, and saved (when the world is saved), replayed and exported as any hand edit.
- **When it lands:** at the step the world is on when the person clicks, T, which is usually after S (the panel files a note when
  the census at S arrives, and a running world moves on). So it is the suggested intervention at a later step, on a world with no
  untouched twin on screen: not the proposal's fork. The page says "at step T, not step S" whenever T ≠ S, and that the
  prediction is decided only offline.
- **When it is offered:** only while all of these hold, checked when the button is drawn and again on the click: the suggestion's
  world generation and run id are the loaded world's; the world has no logged change by hand (not a Try, not a brush stroke); the
  world has not failed; no world is being planted, restored or opened; the validators accepted the spec; the row is not a replay
  control (nothing to apply: the suggestion says the control is an offline check only); and no Try has been sent for this world.
  Otherwise the button is not shown and one line says why.
- **Stale suggestions are dropped.** A suggestion belongs to one (generation, run id) and a note key (signal, side, receipt end
  step). A load of another world, a jump or restore (which forks the run id), or a rewind that removes the note, removes its
  suggestion; a click on a button drawn for an older world applies nothing.
- **One click, once.** The first click marks the world as tried at once, so a second click before the worker answers applies
  nothing. If the worker refuses the edit (it reports an error for that request), the suggestion says the lab did not apply it
  and why, and offers the button again only if the world is still untouched.

### Labels and words

- Dose, place and step are facts of the spec: no chip. The prediction carries **Not yet measured** (no fork has been run). The
  standing line under the suggestions, "whether these rules make good experiments, or beat a random intervention", carries **Not
  yet measured**, with a pointer to the bench note. **Measured** is never put on a suggestion; **Confirmed** and **Seen** are
  never used.
- The words say "suggestion", "the proposer's rule", "try"; never "event" or "discovery", never that the naturalist decided,
  wants or recommends. The probe's strength is said as the proposer note says it: the jar disc is close to the whole jar, so a
  wound is close to a wipe and a prediction that holds is weak evidence on its own.
- The panel's lede gains one sentence: each note carries the proposer's suggestion, fixed rules, never applied unless you click.

### What this cannot tell you (the panel says all of it)

- Whether a suggestion is a good experiment, or whether these rules beat random forks (the bench's question; not run).
- Whether its prediction holds: the world on screen is not the fork (later step, no untouched twin), and the naturalist stops
  reading after any change by hand.
- Where a departure is concentrated: no bundle and no census records it, so every suggestion targets the jar disc.
- For gradient-m3, whether the offline proposer would file this note at all (above).

### Tests (written with the code)

- vitest, `apps/lab/test/naturalist-suggest.test.ts`: the lab's suggestion for the committed seed-1 note (living cells low, end
  step 14,900) equals, in run spec, argv and prediction, what `proposeFromNotes` makes for the same ring on a synthetic
  gradient-m3 treatment source with a step-0 fork (`tools/test/propose-fixture.ts`); every (signal, side) the two baselines can
  ring on gets the row `ruleFor` gives and the interventions `rulesInterventions` gives; both commands map back, flag by flag, to
  their specs and pass `validateProposalSpec`; every number in a reason is a receipt field, S, the threshold or a dose number; the
  model never calls its apply function while censuses arrive and views are drawn, calls it once on `tryHere`, never twice, and
  never for a suggestion of an older generation, another run, a touched or failed world, or a replay control; the words never
  say event, discovery, Confirmed or Seen.
- Playwright, `tests/e2e/lab-naturalist.spec.ts` (the existing seed-1 ring run, extended, not a second long run): after the
  ring, the living cells note shows its suggestion (feed, (128, 128), radius 127, 32 quanta, step 14,900, the prediction and
  the not-the-bench line); the session card shows no feed before the click; one click logs exactly one feed; the panel stops
  reading and says so; the button is gone; axe passes on the panel with the suggestion in day and night colours.
  `public-a11y.spec.ts`, `lab-execution.spec.ts` and `lab-feed.spec.ts` stay green.

### Not in v0

- Applying an intervention at S itself (a jump back to S before applying), a twin or control world in the page, deciding a
  prediction anywhere, location-targeted interventions, picks, config changes, a model reading notes or suggestions, any
  worker or protocol change.

## Built (2026-10-18)

Code only; nothing was run offline and no model was called. The section above is unchanged.

- **`apps/lab/src/naturalist-suggest.ts`** (pure, no DOM, loaded lazily by the panel when the first note is filed, so the page's
  first load does not bring `@bl/runner`). `suggestFor(ring, world, header)` builds one suggestion from the note alone, all of it
  by import from `tools/lib/propose.ts`: `ruleFor`, `rulesInterventions`, `feedAmount`, `jarShare`, `interventionWords`,
  `HYPOTHESIS`, `predictionFor` with `RULES_V0`, `buildForkSpec` on `labSource(world, S)` (the replay-control spec described
  above, as a minimal `SourceManifest`), `validateProposalSpec` on the source and the fork, `runArgv`, `specHash`. Its own words
  are the facts line, the reason (receipt, threshold, S, dose numbers only), the button's label (which names the dose), the two
  offline paths and their caveats. Bell v0's Z* per preset (`NOTEBOOK_ZSTAR`, for the gradient-m3 caveat) is pinned with a test
  against `experiments/naturalist/bell-v0.json` rather than importing that 180 KB record into the page.
- **`apps/lab/src/naturalist.ts`**: each note has a key (`noteKey`: generation, run id, signal, side, receipt end step) and a
  suggestion view (pending, failed to load, or ready with its offer). The model takes `{ apply, loading }`; `tryHere(key)` re-checks
  everything (the note is one of the loaded world's; not sent, landed or tried for another note on this world; the world not
  failed, not touched by hand, not loading; the spec not refused; not a replay control), marks the world tried, then calls `apply`
  once. `onTouched` records the step the edit landed at; `onApplyRefused` marks a waiting Try refused, and it is offered again only
  while the world is untouched and has not failed. Suggestions are cached per key and dropped on every load. The "cannot" list
  gains the four lines of "What this cannot tell you" above.
- **`apps/lab/src/naturalist-panel.ts`**: notes are drawn by key and updated in place (stretch, "filed before", "same run as", the
  offer), so a live census never replaces a button under the pointer; one delegated click listener on `#naturalist-notes`. The
  offline commands sit in a closed "Run it offline" block, in wrapped `<pre>` (style.css), never scrolled sideways.
- **`apps/lab/src/main.ts`** (wiring only): `tryHand(entries)` sends each entry as the lab's own `lesion` or `feed` message from the
  entry's numbers, counted in `pendingHands` like a brush patch, no toast. A `refused` for a lesion or feed, and any `error`, go to
  `onApplyRefused` (the model ignores them unless a Try is waiting: the worker's messages carry no request id). A `refused` offers
  Try again while the world is untouched; an `error` does not (the edit may still land), and the suggestion says it is not known
  whether it was applied. `loading` is `loadingWorld` or any plant, restore, open or jump sent and not yet answered (`replacing`,
  counted in `send`): restores, opens and jumps never set `loadingWorld`, and a lesion or feed queued behind one would land on the
  new world.
- **`apps/lab/lab/index.html`**: the lede's sentence. **`tools/lib/propose.ts`**: `HYPOTHESIS` exported; nothing else changed.
- **Tests.** `apps/lab/test/naturalist-suggest.test.ts`: the seed-1 note's fork spec, argv and prediction deep-equal what
  `proposeFromNotes` makes for the same ring (Z* 5, source of 34,900 steps, fork from step 0), its source is the fork without its
  entries, and its entry is `{step 14,900, feed, (128, 128), r 127, 32}`; every (signal, side) of both baselines gets `ruleFor`'s
  row and `rulesInterventions`' entries and validates; both command lines map back flag by flag (tools/run.ts's mapping, copied
  from `tools/test/propose.test.ts`) and pass `validateProposalSpec`; nothing is written under `runs/` and the proposer chain names
  the bundle and notes file the earlier commands make; every number in a reason is a receipt field, S, the threshold, 0 or a dose
  number; `apply` is never called while censuses arrive and views are drawn, once on `tryHere`, never twice, and never for an older
  generation, another run id, a touched or failed world, a replay control or while loading; the words test covers every
  suggestion string. Two #52 tests in `naturalist.test.ts` now compare notes without their key, since the key names the world.
  `tests/e2e/lab-naturalist.spec.ts`: the existing seed-1 ring run, extended: the suggestion's words and command, `#k-fed` "none"
  before the click, axe on the panel with the suggestion (commands open) in day and night colours, then one click: one feed, one
  change by hand, reading stopped, no Try button left, "Tried here at step T".

### Changed after the first review (2026-10-18)

A Codex Sol 6.1 High read-only review of the first build found, and this build fixes:

- **The proposer's path needs a corpus-length source.** `tools/notebook.ts` holds a bundle to the bell corpus's steps and cadence
  (`checkGroupIdentity`, `checkAgainstRecordCorpus`), 1,000,000 steps at cadence 100 for both presets, so a source of S + H steps
  cannot be read by it. Path 2 now starts with its own `tools/run.ts` source of 1,000,000 steps (`--out .../long-source`,
  `NOTEBOOK_STEPS`, pinned with a test against `bell-v0.json`); path 1 keeps the S + H source. A test shows `proposeFromNotes` on
  that long source makes the same fork spec as the suggestion. The above section's "four commands on the source bundle" is
  therefore five on a separate source.
- **Try during a restore, open or jump** was not refused (only a plant set `loadingWorld`); now `replacing` covers all four.
- **An unrelated worker error** re-offered a Try whose edit could still land; now only a `refused` re-offers.
- **A change by hand after reading stopped for another reason** (a gap, a census that did not hold together) left the offer up,
  because `onTouched` returns early once reading has stopped; the model now keeps the world's earliest change by hand
  (`handAt`: its log, `onTouched`, any census's `touched`) regardless.
- Deep census cadence is said in censuses (every 5th, every 10th), not steps; the e2e badge check is scoped to the note's head.

### Changed after the second review (2026-10-18)

Three review lenses and a Codex Sol 6.1 xhigh read-only review of the build above found, and this build fixes:

- **An old suggestion could edit a replacement world.** `replacing` was reset to zero by any worker `error`, and errors name no
  request: a failed open followed by a pending restore let a Try queue its edit behind the restore, and the worker applied it to
  the restored world. The page cannot count this soundly (frame-loop errors are indistinguishable, and a jump with no world
  answers nothing), so the check moved to the worker, the way `pick`, `pressure`, `keep` and `sessionExport` already work: the
  `lesion` and `feed` messages take an optional `world` (`protocol.ts`), Try it here names the suggestion's generation, and the
  worker refuses (`refused` with that request) an edit named for a world that is no longer on screen (`staleHand` in
  `sim.worker.ts`). The brush omits `world` and is unchanged. `replacing` and its resets in `main.ts` are removed; `loading` is
  `loadingWorld` again, and a Try clicked while a restore, open or jump waits is refused by the worker and said like any refusal.
  These two files are outside this slice's listed area; the change is additive and changes no dynamics.
- **A refused Try was later reported as tried.** `onTouched` now resolves only a waiting (`sent`) or `unknown` Try; after a
  refusal, a later change by hand is said as a change by hand. A brush edit logged while a Try waits is still taken for the Try
  (no request id), and a brush refusal arriving first can still be taken for the Try's: both are narrow and stay disclosed here.
- **The gradient-m3 notebook caveat** compared the first window's weakest |z| with Z\*, but the notebook rings on the strongest
  window (D). It now words both cases from `ring.D` when the suggestion is made and says "may" for the no-note case (the panel's
  envelope is not the notebook's).
- **Focus and announcements.** The offer is a `role="status"` region that stays in place while its contents are redrawn, and
  after a click focus moves to it instead of falling to the page's body.
- **A suggester that throws** for a note (an unknown signal or preset) now marks that note's suggestion failed instead of stopping
  every redraw of the panel.
- Words: the Try line says the edit is saved only when the world is saved; "Run it offline" says everything runs locally (the `tools/run.ts`
  lines and `propose.ts run` on the GPU; `tools/notebook.ts` on the CPU; `propose` and `approve` only check and write files) and that `naturalist-lab/` at the repository root is not ignored by git; a caveat says S is the first window to cross the
  threshold, not the strongest.
- Tests: Try on a wound row and a drain row (the exact lesion and negative-feed payloads, named for the world), a change by hand
  after a refused Try, a throwing suggester, the shared-run line on two notes that do share a run (seed 1 files only one), and a
  worker test (`tests/e2e/lab-naturalist.spec.ts`) where a feed and a wound named for a replaced world are refused and one named
  for the world on screen is logged.

### Changed after the third review (2026-10-18)

A third Codex Sol 6.1 xhigh read-only pass found no P0–P2 and accepted the `protocol.ts` / `sim.worker.ts` world check as the
narrowest reliable fix. Its one P3: "Run it offline" said each command writes under its own `--out`, but `approve` has none and
rewrites the proposal file in place (`tools/propose.ts`). The panel now says everything the commands write stays under
`naturalist-lab/`, outside `runs/`, each under its own `--out` except `approve`, which rewrites the proposal file in place.
