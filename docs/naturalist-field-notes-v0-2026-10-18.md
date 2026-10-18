# Field notes in the lab, v0 (2026-10-18)

Status: **exploratory, code only.** The anomaly bell (`docs/naturalist-bell-v0-2026-10-17.md`, `docs/naturalist-bell-v1-plan-2026-10-17.md`)
and the field notebook's words (`tools/lib/notebook.ts`), brought into the lab as a panel that reads the world on screen while it
runs. No model call writes any word of it, nothing here changes physics, a rule, a checkpoint format or a golden pin, and no new
simulation is run to build it: its baseline is computed from bundles already on disk.

The section "Fixed before code" was written before any of the panel's code existed. Later changes go in dated sections below it;
this section is not edited after code lands. Nothing here amends the bell's or the notebook's notes.

## Fixed before code (2026-10-18)

### Which rule, per world

The brief for this panel: use v1's signal set and threshold where v1 defines a calibrated rule a single live world can be scored
by, and v0's calibrated Z\* at W = 50 where it does not. Read per preset, as the records are:

- **Bright to dim (searched founders), `gradient-m3`: the v1 envelope rule (part A).** Eleven signals (v0's thirteen without
  `maxGeneration` and `dominantShare`), Z = 4 with the bell's own `≥`, W = 50, windows starting at or after step 10,000, censuses up
  to step 300,000, against the 40 gradient-m3 neutral runs of the bell's corpus. It is a rule fixed before its run and judged on 70
  fresh neutral runs it had never seen: none rang (`experiments/naturalist/bell-v1-null.json`, A1 met, upper 95% bound 0.042).
  That is the calibration the brief asks for: a threshold whose false-alarm rate on fresh neutral worlds is measured. It needs no
  twin, so it can score one world as it runs. (v1's part B, the twin bell, did not meet its bar and needs a twin the lab cannot
  fork yet; it is not used.)
- **Even light (searched founders), `spots-m3`: v0's calibrated bell (the secondary readout).** v1 left spots-m3 out, so it has
  no v1 rule. Thirteen signals, W = 50, windows from step 10,000, ringing only **strictly above** Z\* = 11.4665 (the largest D at
  W = 50 among the 20 `replay-calib` spots-m3 neutral runs, `experiments/naturalist/bell-v0.json`,
  `summary.secondary.perPreset["spots-m3"].zStar`), done as the notebook does it: the bell's `≥` at the smallest double above
  Z\* (`nextUp`), so an exact tie never rings. Against the 30 spots-m3 neutral runs of the corpus. Held out, 0 of the 10
  `replay-m4` spots-m3 neutral runs scored above it (1 of 30 over both presets, about 1.4 expected).
- **Every other world: no baseline.** The panel says "The naturalist has no baseline for this world yet." and one line of why,
  and it does not ring.

The panel reads both worlds up to step 300,000, where its baseline ends (v0 scored spots-m3 to step 1,000,000; reading less of a
run is a shorter look under the same rule, not another rule). After it, the panel says the baseline ends there and reads nothing
more. D only grows as censuses arrive, so a ring found by a step is a ring of the whole run.

### The world on screen is a full-rules world; the baseline is neutral

The lab plants a preset as it is: selection on (the bell corpus's `treatment` condition). The bell's envelope is the preset's
**neutral** runs (`cfg.neutral`: mutations change nothing an organism does). The bell defines this case: it scored the 10
gradient-m3 treatment runs against the neutral envelope, and under the v1 rule all 10 rang, 9 of them on living cells low in the
first window it counts (steps 10,000 to 14,900; seed 4 on mutations high from step 21,200). So a full-rules gradient-m3 world in
the lab is expected to ring at about step 14,900, and the ring says that its kind of world stands apart from the neutral runs,
which M4 already knew. The panel says so before any note, attributed to the record, not to the world on screen. For spots-m3, no
full-rules run was ever scored by the bell, so how a full-rules spots-m3 world compares with the neutral runs is **not yet
measured**, and the panel says that instead.

A world planted with `neutral: true` and nothing else changed (possible only through the worker's `load` overrides, not from the
page) is scored as a neutral world, and its notes are false alarms by definition, as the notebook's are; one whose seed is one of
the envelope's own runs (gradient-m3 seeds 1 to 20 and 1001 to 1020, spots-m3 seeds 1 to 10 and 1001 to 1020) gets no baseline,
because the bell scores those leave-one-out and the published baseline holds all of them.

### When a world matches

All of these, checked on the `loaded` manifest, or the world has no baseline:

- `presetId` is `gradient-m3` or `spots-m3`, and that preset's `presetIdentity`, computed in the page from current code, equals
  the one in the baseline's header (`e1c93a9384b5d921` and `a9f93070127a0c05` in the records). The asset builder refuses to write
  a header whose identity differs from current code.
- `ruleVersion` equals the header's (1). A rule change makes the panel say it has no baseline for this world's rules until the
  baseline is rebuilt and checked again.
- `manifest.cfg` equals `presetConfig(preset, seed)` in every key but `seed` and `neutral`, and `init` equals the preset's. Any
  other override: no baseline.
- `settings.censusEvery` is 100.
- Not opened from a file (`presetId` `imported`).

And, census by census:

- **Every census from the first.** Rates need the 10 censuses before, and windows need 50 in a row, so the panel reads a world only
  with every census from step 100 on. A world picked up later (restored from a checkpoint of an earlier visit, or any history the
  page did not watch from its first census) is shown as "Watching since t=…" and gets no notes.
- **Untouched.** The baseline is of worlds nobody wounded or fed. A census at step t is read only while no logged intervention has
  a step below t (the census at an intervention's own step comes before it). From the first wound, feed or drain on, nothing is
  read; notes filed before stay, marked as filed before the world was changed at that step.
- **Holding together.** Each census must pass v1's census check (`censusProblem` in `tools/lib/bell1.ts`: finite `livingCells` and
  `lineages`, the lineage rows summing to the living cells, one row per lineage) and every series field a signal is read from must
  be a finite number, or the panel stops for that world and says which census and why (the notebook's "only measured values"). A
  rate that is not yet defined, in the first 10 censuses before it has 10 earlier ones, is the bell's warm-up, not a stop.

### Generation identity

- Every census message from the worker carries the world's generation number and run id. A message from an older generation, or
  whose run id is not the loaded world's, is dropped, so a note never comes from a world that has been replaced.
- The panel keeps the censuses it has read of the world on screen's run (one run at a time), and its notes are a function of those
  censuses and the baseline, recomputed from them. A rewind inside the page (a jump or a restore of the same run) keeps the censuses
  up to the step it lands on and drops the rest; the notes are recomputed and the replayed censuses are read again. A world of
  another run starts afresh.
- The baseline is fetched only when a matching world is loaded, once per page, and its SHA-256 is checked against the header.
  Censuses read before it arrives are scored when it does. If it cannot be fetched or does not check, the panel never rings and
  says the baseline did not load.

### What makes a note

- **One note per ring:** a (signal, side) whose D at W = 50 reaches the threshold (≥ 4 for gradient-m3, > Z\* for spots-m3), with
  the bell's receipt: the first window's start and end steps, its smallest |z|, and the world's value and the envelope median at the
  window's first census. The receipt comes from the panel's scorer, which is the bell's arithmetic on the published baseline (see
  "Parity").
- **Its stretch, drawn from the same censuses:** from the receipt's start, how long side·z has stayed at or beyond the threshold in
  an unbroken run of read censuses, and whether it is still going at the latest census read. Nothing is scored from it.
- **Filing:** by the receipt's start step, then by its smallest |z|, largest first. The panel says beside the notes that this step
  is where the first 50 censuses in a row beyond the threshold begin, counted from step 10,000, and that it is not an onset. Notes
  filed together are not said to cause one another. (This is the notebook's filing, not the order of v1's `firstRing11`, which
  takes the earliest end step and then the signal table's order: the record's first ring is one of the notes, not necessarily the
  top one.)
- **No ring, no note.** Before step 10,000 the panel says it is listening and counts nothing yet (the first note can come at step
  14,900). After it, with no ring, it says it is quiet so far.

### Labels and words

- Each note carries **Measured** (its numbers) and **Unclear** (what the ring means). The panel's standing statements carry:
  the rule's fresh-null result (gradient-m3: 0 of 70 fresh neutral runs, **Measured**; spots-m3: 0 of 10 held out above Z\*,
  **Measured**), the arms (gradient-m3: full-rules runs stood apart from step 10,000 in 9 of 10, **Measured**; spots-m3: **Not yet
  measured**), and "the naturalist hears something arise inside a world" (**Not yet measured**). **Confirmed** and **Seen** are
  never used.
- **Plain words** are the notebook's: each signal's label, meaning and side phrase from `SIGNAL_TEXT`, values in its formats
  (`fmtValue`, `fmtZ`, `group`), rates "in the last 1,000 steps". The note's sentence is the notebook's template with the
  threshold said in words for each rule: "<Phrase>: <value> at step <a>, against a neutral median there of <median>. At least four
  spreads <below|above> it for 50 censuses in a row, from step <a> to step <b>; the weakest of them was <k> spreads <below|above>
  the median." (gradient-m3) and "Beyond Z\* (11.47 spreads) for 50 censuses in a row, …" (spots-m3). A spread is the bell's
  (IQR/1.349 of the neutral runs at that census, floored).
- **No "event", no "discovery"** in anything the panel writes.
- **It says what it is:** code, not a model; it compares this world with neutral runs of its preset; no model reads this world.

### What this cannot tell you (the panel says all of it)

- It compares this world with the neutral runs of its preset, not with a twin of itself: a note says "unlike the neutral runs", not
  "something changed here". The twin bell did not meet its bar (v1 part B: 4 of 10 large wounds and 4 of 10 feeds heard).
- A full-rules world stands apart from the neutral runs from the first census counted (gradient-m3, 9 of 10 in the record): a note
  on it says its kind differs, not that something arose in it.
- A threshold calibrated on neutral runs can still be crossed by neutral dynamics alone (gradient-m3: 0 of 70 fresh, upper bound
  4.2%; spots-m3: Z\* is the largest of 20 calibration scores, one order statistic).
- Nothing about cause, mechanism or importance.
- It sees only its signals (eleven or thirteen), nothing before step 10,000, nothing after step 300,000, nothing after you wound or
  feed the world, and nothing of a world it did not watch from its first census.

### Parity

- The baseline is, per census and signal, the median and spread that `departure()` in `tools/lib/bell.ts` gives over all the
  envelope's runs (no run left out), as full-precision doubles. For a world that is not one of the envelope's runs, the bell's z is
  a function of exactly these two numbers, so z = (x − median) / spread is the bell's z bit for bit. Signals are the bell's
  `SignalExtractor` over the census's series fields, which the lab computes with the runner's formulas
  (`packages/runner/src/runner.ts`, the series record); windows use the bell's `RollingMin`; the receipt has the bell's shape.
- The asset builder (a `tools/` script, deterministic: the same inputs give the same bytes) reads the envelope runs' bundles
  read-only, refuses unless the runs, their manifests and identities are the record's, and before writing anything checks the
  panel's scorer against the records: gradient-m3, the 10 treatment runs' D over the eleven signals and first ring under the v1
  rule and the 70 fresh neutral runs' D against the published baseline, and each of the 40 envelope runs against the other 39
  (built the same way, in memory), equal to `bell-v1-null.json`'s exactly; spots-m3, each of the 30 neutral runs against the other
  29, built and scored the same way over its whole 1,000,000 steps, reproducing its D at W = 50 in `bell-v0.json` exactly, and Z\*
  recomputed from the 20 `replay-calib` runs equal to the record's. Any difference and nothing is written.
- The panel's scorer is tested against `BellScorer` on fixed series (D by signal and side, and receipts, deep-equal), and the lab's
  census signals for gradient-m3 seed 1 against `runs/replay-m4/gradient-m3/treatment/seed-1/series.jsonl` (a committed excerpt),
  which the world in the lab should reproduce census for census.

### Not in v0

- A neutral or no-mutation planting in the page, the twin bell, a within-arm envelope, presets other than these two, and anything
  after step 300,000.
- A model reading the notes, which needs a yes for paid calls.

## While writing the code (2026-10-18)

Nothing above is changed. What the code found that the section above did not say, and what was done about it:

- **The census check is a copy.** `tools/lib/bell1.ts` cannot be imported by the lab: the lab's typecheck holds every file it
  imports to `noUnusedLocals`, and that file imports one name it does not use (it is not edited). `censusProblem` is copied verbatim
  into `apps/lab/src/naturalist-score.ts`. `tools/naturalist-envelope.ts` imports both and stops unless they give the same answer on
  every census it reads (120 gradient-m3 bundles to step 300,000 and 30 spots-m3 bundles to step 1,000,000); the lab test holds
  them equal on fixed cases. `tools/lib/bell.ts` and `tools/lib/notebook.ts` are imported as they are.
- **A jump forks the run id, so a rewind is recognised by its planting and its log.** A jump saves the present and restores an
  earlier checkpoint, and restoring any checkpoint but a run's latest gives the world a new run id (`<run id>-b<suffix>`,
  `sim.worker.ts` `forkRunId`; a second jump through an inherited checkpoint gives a sibling id). The lab's physics is deterministic,
  so two histories of one planting (the run id with every `-b<suffix>` removed) are the same history up to the first change by hand
  in either. When a world of the planting the panel is reading is loaded at step t, the panel keeps the censuses it has read up to
  the smaller of t and the loaded history's own first logged intervention, and reads on from there; if that history was changed by
  hand before t, the panel stops at the change, as it would have live. Past what it has read, it carries on only where its reading
  had already stopped for good inside the shared stretch (a census that did not hold together, lost records, the horizon, or the same
  first change by hand); anything else is another history and is read afresh ("Watching since t=…" when t is not 0). A Codex review
  (Sol 6.1 High) found that a run id alone was not enough: a checkpoint of the same run saved by another tab after a wound would have
  kept notes the wounded history never had.
- **A change by hand is said at once.** The worker tells the panel of a wound, feed or drain as soon as it is logged, so a paused
  world's notes are marked as filed before the change without waiting for the next census.
- **The seed must be the physics' seed.** A world whose config seed differs from the seed it is listed under (possible only through
  the worker's overrides) has no baseline, so the leave-one-out check reads the seed the world actually runs on.
- **Generation numbers on `loaded`.** The worker's `loaded` message now carries the world's generation number, the one every census
  message carries, so a census of a world since replaced is dropped by number as well as by run id.
- **Lost mutation records stop the reading.** When the lab's ledger drops mutation records at a census, its mutation count is not
  the one a run bundle would hold (the runner stops a run on it). The panel stops reading at that census and says why.
- **Which census the series record is read at.** The counters and flux rates of a census are read right after the census is
  observed and before the boundary's transforms (migration, the pond cycle, declared cells), as the runner writes its record; for
  these two presets nothing happens at a boundary, so both orders give the same numbers.
- **The spread in the panel's own words** is the bell's in full: the largest of the neutral runs' IQR / 1.349 at that census, 5% of
  their median, and the signal's floor.
- **A neutral world's standing line carries no label.** "This world is neutral, …" is a fact of its settings, not a result, so no
  Measured or other chip is put on it.
- **The baselines as built** (`tools/naturalist-envelope.ts`, run on the main checkout's `runs/`, read only, twice, byte for byte
  the same): `apps/lab/public/naturalist/envelope-gradient-m3-v1.bin` (528,000 bytes, SHA-256
  `6680621727b3c05581a404387b7fd7118fa7a06b5b37ea3ef853692c38d15894`) and `envelope-spots-m3-v0.bin` (624,000 bytes,
  `8678878c3a495f3211d257c4d78a0257d7ca29e6dc8837974519cbcb9c136f4c`), each with its header. Before writing, the builder
  reproduced, with the panel's scorer, `bell-v1-null.json`'s D11, ring and first ring for all 120 gradient-m3 runs (the 40 envelope
  runs each against the other 39, the 10 treatment and 70 fresh runs against the published baseline), and `bell-v0.json`'s D at
  W = 50 and its rings at Z = 4 for all 30 spots-m3 runs (each against the other 29, to step 1,000,000), with Z\* = 11.4665
  recomputed from the 20 `replay-calib` runs and 0 of the 10 held out above it.

## After review (2026-10-18)

Nothing above is changed. Three review lenses and a Codex review (Sol 6.1, xhigh) read the first build; what changed:

- **The rule is fixed in the lab, not read from the asset.** `NATURALIST_BASELINES` (`apps/lab/src/naturalist-score.ts`) now holds
  each preset's signals, threshold and number of envelope runs, and a header that differs in any of them does not load (Codex
  served the gradient header with Z = 1 and the committed seed-1 excerpt gained three notes below v1's threshold). The asset builder
  stops unless the lab's rule is v1 part A for gradient-m3 and `bell-v0.json`'s Z\* for spots-m3.
- **Each world cites only its own record.** The twin bell (v1 part B) ran only on gradient-m3's treatment bases, so the spots-m3
  header no longer carries its counts or cites `bell-v1-twins.json` and `bell-v1-null.json`; its panel says no twin bell has been
  run on it. The gradient-m3 line names the world the twin bell ran on.
- **spots-m3 is said as weakly as it is.** Its held-out line now carries the bound (0 of 10, upper 95% bound 25.9%), and the
  "cannot" list says Z\* = 11.4665 is set by one run (`replay-calib/spots-m3/neutral/seed-1002`), that the next largest of the 20
  calibration scores is 4.05 (`calibSecond` in the header), so it rings only far beyond anything else in its calibration, and that
  Z\* was set with each run against the other 29 while a live world is held against all 30. The strict threshold is printed as
  11.4665, not rounded (the sentence above, "Beyond Z\* (11.47 spreads)", now reads "Beyond Z\* (more than 11.4665 spreads below
  it)"), so a receipt of 11.47 does not read as a tie.
- **The arms sentence says 9 of 10.** All 10 gradient-m3 treatment runs rang; 9 first in the first window counted (steps 10,000 to
  14,900), the tenth later, by step 26,100 (`lastEndStep`). The panel now says a planted world "will most likely ring by about step
  14,900" rather than "is expected to".
- **Quiet carries the notebook's hedge.** With no note once one could have come (step 14,900 on), the panel shows its largest D so
  far against the threshold (**Measured**) and "that nothing is going on in this world" (**Not yet measured**), as the notebook's
  no-ring page does.
- **Rewinds.** A world loaded short of the next unread census (`limit < last + 100`) shares every census the panel has read, so it
  keeps its notes (it was read afresh before). A checkpoint saved right after a wound at its own step comes back marked as changed
  by hand (it lost the mark before). A jump's replay that re-applies a wound, feed or drain tells the panel at once, as a live
  change does (before, a paused world after such a jump showed its notes unmarked until the next census). A census off the
  100-step grid stops the reading and says so (lab saves settle at a census, so this is defensive).
- **The worker posts less.** It no longer posts censuses past the first one beyond step 300,000 or more than one census after the
  first change by hand, which the panel would drop.
- **Fetching.** The header is revalidated on every fetch and the numbers are asked for by their SHA-256, so a rebuilt baseline is
  never read from a stale cache under the same file name; a baseline that failed to load is asked for again by the next matching
  world; an insecure page (no `crypto.subtle`) says why it cannot check the baseline instead of showing a raw exception.
- **Words.** The lede says "Where it has a baseline, it compares…"; a world with no baseline lists what that means; a note's
  stretch says "at its last census read" once reading has stopped; the horizon badge reads "ended".
- **Tests added.** The headers are rebuilt from the committed records alone and must equal the committed files byte for byte
  (`apps/lab/test/naturalist.test.ts`), so every number the panel prints is pinned without `runs/`; both baselines hold finite
  medians and positive spreads at every census; `fetchBaseline` refuses an altered threshold, a 404, an odd file, a short or
  altered body, a thrown fetch and an insecure page; the model's quiet, retry, exact-step, between-censuses and replay-touch cases.
  `apps/lab/test/naturalist-series.test.ts` holds the lab's census record (`onSeries`) to the headless runner's `series.jsonl` and
  `lineages.tsv` for a small spots world on the CPU reference, field for field, through odd frame sizes and a checkpoint-and-resume.
  `tests/e2e/lab-naturalist.spec.ts` drives the real worker: a wound posts `naturalistTouched` and the next census carries it, and a
  jump whose replay re-applies the wound posts it again for the forked run; and the panel with a note in it passes axe in day and
  night colours.
- **What "bit for bit" covers.** The lab world's census signals are shown equal to a bundle's on Chrome (Playwright, WebGPU) for
  gradient-m3 seed 1 to step 16,000, and the lab's record equal to the runner's on the CPU reference for a small spots world; the
  GPU's own agreement with the CPU is the golden suite's. No spots-m3 GPU world was compared with a bundle.
- **Rebuilt.** Both headers changed (numbers and records only); the builder ran twice on the main checkout's `runs/` (read only,
  `--no-lock`), once verifying and once not, with the same bytes, and both `.bin` files are unchanged (SHA-256 `66806217…` and
  `8678878c…` as above). Header SHA-256: gradient-m3 `1424e3ca7467432b54b8ed421cbb95c20d2c3dfeb079eeb3d99bd719cb494de4`, spots-m3
  `9917dcea3f846e9f5893f3dcf1e574d5eab9a60efa8283e29ff8044a668d00b2`.
- **Not done.** The baselines still need the bell corpus under `runs/` to rebuild (a fresh checkout can check the headers against
  the records, not rebuild the numbers); the notebook and bell code still load with the lab page, not lazily.

## After the second review (2026-10-18)

- **A failed world stops the reading.** When the world on screen fails (a lost GPU, or an execution that cannot go on), the page
  tells the panel, which says "Stopped reading after step t: the world stopped and sends no more censuses", keeps the notes
  filed so far, stops saying "so far" of a stretch, and reads nothing more of that world. The next load reads again by the usual
  rules (a restore of the same history no later than the last census read takes the reading up). The model's stop is tested
  (`apps/lab/test/naturalist.test.ts`); the page's wiring from the worker's `failed` error to the panel is not, since a fatal
  failure cannot be brought about in Playwright.
- **The baselines follow the build's base URL.** They are fetched from `import.meta.env.BASE_URL` + `naturalist/`, so a build
  mounted under a sub-path still finds them; a test fetches both files under `/preview/`.
- **The builder never writes under `--base`.** `--fixture` is checked as `--out` is (through its directory and, when the file
  exists, any symlink), and nothing is written until every asset asked for has built (and, by default, verified). A rebuild with
  `--no-verify` into a scratch directory gave the committed four files and the test fixture byte for byte.

## After the third review (2026-10-18)

- **The builder replaces files, it never writes through them.** Each destination's directory is resolved first (an `--out` that
  does not exist yet through its nearest existing ancestor, before anything is created), and each file is written to a fresh
  temporary file in that directory, synced, then renamed over its name. So a symlink at the destination (even one pointing at a
  file that does not exist yet inside `--base`) or a hardlink to a bundle file is replaced, never written through, and a run cut
  off mid-write leaves a stray temporary file, not a half-written asset. Each preset's `.bin` is published before its `.json`: a
  run cut off between the two leaves a header whose pinned SHA-256 the old numbers do not match, and the lab's fetch refuses
  that. Tried on a scratch base: a file inside it, a new file inside it, an outside symlink to a file inside it, an `--out` deep
  inside it that does not exist yet (all stop, nothing created), an outside dangling symlink into it and an outside hardlink to a
  file in it (both replaced by a plain file); the base was byte for byte unchanged.
- **An error the worker did not handle stops the reading too.** The page listens for the worker's own `error` event (an
  exception its frame and message handlers did not catch; they post the ones they catch). Such an error does not end the worker,
  so the panel does not say the world stopped: it says "Stopped reading after step t: the lab’s worker reported an error it did
  not handle", and that the world may still be running but the naturalist no longer reads its censuses. A world's own failure,
  if one follows, is the reason named. The model's side is tested; the page's wiring is not (it cannot be brought about in
  Playwright).
- **The base URL is read when the baseline is fetched**, so the sub-path test now sets the build's base and calls the fetch
  without a root; it fails if the root is fixed at `/naturalist/` again.
- **Not supported: a relative base.** The lab is built with Vite's default absolute base (`apps/lab/vite.config.ts` sets none).
  With a relative base (`./`) the page cannot tell where the app's root is from the base alone, so the baselines would be asked
  for beside the page, not under the app's root, and the panel would say they are unavailable. Nothing here builds that way, so
  it is left as a known limit.

## After the fourth review (2026-10-18)

- **What the builder's guard promises, said exactly.** It refuses any destination that resolves under `--base`, and publishes by
  rename, so it never writes through a file. It now also refuses an `--out` or `--fixture` with `..` in it (a `..` after a
  directory that does not exist yet let the recursive `mkdir` create directories under `--base` before the check saw them),
  refuses a `--fixture` that would take the name of a baseline file in `--out` (it would have replaced a verified asset), and
  checks just before each write that the destination directory still resolves to the one it checked. That last check narrows a
  race (a directory swapped for a link to the corpus during the build) but does not close it: the builder is a local tool run by
  hand, and holding directory handles is not worth it here. "Never writes under `--base`" above should be read as this. Tried
  with the real corpus as `--base` and scratch destinations: `--out <scratch>/missing/../x`, `--fixture <base>/../runs/x.json`,
  and `--out <scratch>/col --fixture <scratch>/col/ENVELOPE-gradient-m3-v1.json` all stop before building, nothing is created
  (no `missing`, no `x`, `col` stays empty, no `x.json` under the base). These checks are by hand, not automated tests.
- **A failed automatic copy that fails the world says so.** The worker's automatic checkpoint can settle the world to its next
  census; when that settling fails the world, the error now carries `failed`, so the page marks the world failed and Field notes
  stops reading, as for any other failure. This path has no automated test (it needs a settlement to fail inside the worker).
- **Still not supported: a relative base** (see above); nothing here builds that way.
