# The sun letter: rules written before the code (2026-10-18)

Slice 37 of the backlog run. The shared garden brainstorm (`docs/shared-garden-brainstorm-2026-10-09.md`)
makes the sun the garden's scarcity dial ("dim, brighten or shift for a span: the scarcity dial, matter
stays closed"), and the stone horizon (`docs/garden-stone-horizon-2026-10-18.md`, PR #55) found stones too
small to carry, so "the sun is the first letter". Today nothing changes light mid-run and nothing logs
such a change. This note fixes the sun's rule, its bounds, its log, how it replays and why matter stays
closed, before any code. A change to anything below is a dated amendment at the end, never a silent edit.

It adds no rule change, no `RULE_VERSION` bump and no golden pin move: a sun is a logged intervention like
a lesion or a feed, and no existing config or schedule carries one.

## 0. What the code allows, and what it does not

- **The CPU reads light from its config at every cell of every step.** `RefSim.light(x, y, step)`
  (`packages/sim-ref/src/step.ts`) reads `this.cfg.lightBase`, `lightAmp`, `seasonAmp` and the
  day/wander/season periods each time react calls it, and nothing in the constructor caches them.
- **The GPU does not.** `prelude(cfg)` (`packages/sim-gpu/src/shaders.ts`) bakes `LIGHT_BASE`,
  `LIGHT_AMP`, `SEASON_AMP` and the periods into the WGSL source as constants, and `GpuSim.create`
  compiles its pipelines once. There is no light uniform. Only the react pass calls `light_at`. So
  the GPU changes light by compiling a second react pipeline from a derived config,
  `reactShader(sunConfig(cfg, percent))`, and swapping it in, along with its bind groups (they use the
  `"auto"` layout, so they belong to one pipeline). `shaders.ts` is not edited: it already builds a
  shader from any config.
- **The derived config never reaches state, or `sim.cfg`.** `encodeCheckpoint` serialises `state.cfg`,
  `GpuSim.readState()` returns `cfg: this.cfg`, `RefSim.cfg` is `state.cfg` by reference, and hosts
  read `sim.cfg` for boundaries, ponds and feeds (`execution.ts` `boundaryAt`, `applyBoundary`,
  `pondContext`). So on every simulation `cfg` stays the world's own config, and the active light is a
  separate getter, `activeLight` (the sun's three values, or null; not `light`, which is already `RefSim`'s per-cell method). The GPU swaps only the pipeline. The CPU
  is `SunRefSim` (`packages/sim-ref/src/sun.ts`), a `RefSim` subclass whose `light(x, y, step)` runs
  the spec's own `RefSim.prototype.light` with the sun config as its `this.cfg`. `RefSim.light` reads
  nothing else from `this`, so the light formula is not copied and `step.ts` is not edited. A test
  checks that `sim.cfg` is the start config at every step of a span, on both paths. A checkpoint taken
  during a sun says so in its observer state (section 4), never through its config.
- **`setLight(light | null)` is async on the GPU**: it compiles under a validation error scope as
  `create` does, and pipelines are cached by percent (at most four, plus the world's own). It takes
  effect for the steps encoded after the returned promise settles, so the runner and the lab worker
  both await it with the simulation idle before the next `run`. `SunRefSim.setLight` is the same
  signature, and takes effect at once.
- **The lab's Light view** (`packages/sim-gpu/src/renderer.ts`) also bakes `prelude(cfg)`. It gets
  the same pipeline swap, so the view shows the light the physics is using.
- **Shift is not possible without kernel edits.** `light_at` and `RefSim.light` take `step` directly
  for the day, the wander and the season. Moving the sun's phase needs a new term in both kernels
  (section 8). This slice builds dim and brighten only.

## 1. The rule

A sun is the schedule entry

    {"step": s, "kind": "sun", "percent": p, "span": N}

At step `s`, in the interventions slot (after that step's census and boundary transforms, in list
order with the other entries at `s`, before any checkpoint at `s`), the world's light becomes that of
the **sun config**

    sunConfig(cfg, p) = cfg with
      lightBase = floor(cfg.lightBase * p / 100)
      lightAmp  = floor(cfg.lightAmp  * p / 100)
      seasonAmp = floor(cfg.seasonAmp * p / 100)

for the physics steps that start at `s, s + 1, ..., s + N - 1`. At step `s + N` the world's own light
returns. Every other key stays as it was, so the sun keeps its mode, its position, its day, its wander and
its season's phase. Only the brightness changes. The season is scaled with the rest because it is the
same sun's swing over the year. Without it a dimmed storm would keep its full seasonal 60.

- **`percent` is one of 50, 75, 125, 150**: half, three quarters, a quarter more, half more. 100 is
  not a sun (it changes nothing), and 0 is not offered (a dark jar is a death, not a dial).
- **The rounding is floor**, on integers, in TypeScript, before any kernel sees the values. CPU and GPU
  both receive the same three integers, so the parity is by construction and is then tested.
- **No clamping.** A sun is refused (`sunError(cfg, p)`) if any of the three scaled values is above 255,
  the bound `validateConfig` puts on each. So every sun config is a valid `WorldConfig`, and the
  arithmetic bounds argument in `docs/rules.md` holds unchanged: it covers every valid config. On the
  storm (20, 170, 60), 150 gives 30, 255, 90 and is accepted. On the gradient preset (20, 220, 0), 125
  gives a lightAmp of 275 and is refused. **(Wrong: the bound is on the sum too, so the storm takes only
  50 and 75 and the gradient's 125 fails on the sum as well. See amendment 1 below.)** The per-cell light is still clamped to 255 at the end of
  `light_at` as always. So "75 percent" names the config change, not the exact ratio of any cell's light.
- **`span` is an integer from 1 to 2^24**, and `s + span <= MAX_STEP` (the observer's sun too: amendment 2026-10-18 after review, item 4).
- **Suns do not overlap.** A sun whose step is before the previous sun's `step + span` is refused, in
  list order. Back-to-back suns are allowed: at `s + N` the old sun ends first, then the entries at
  `s + N` apply in list order, so a sun there starts after the old one has gone.
- **A sun must set inside its run** where the run's last step is known: `tools/run.ts` and the
  coordinator refuse `step + span > steps`, as they already refuse an entry after the last step. The
  runner itself does not check this (a segment does not know where the run ends). A span still open
  at the end of a call is carried in the final observer (section 4).
- **Pond worlds take suns.** Light is energy, so a pond's matter, which its cycle fixes, is unaffected.

## 2. Why matter stays closed

A sun changes no cell, no channel and no total. The physics it governs is the ordinary react pass with
other light constants. Photosynthesis (A + light -> B) turns existing nutrient into bound matter, and the
light it uses is booked in the ledger as `lightIn`. The conservation checks are unchanged:
`matter == startMatter` exactly, and `energy + heatOut - lightIn - baseline == 0` exactly. A dim sun books
less `lightIn` and a bright one more. Neither baseline moves (unlike a feed). The tests assert both
residuals are zero through a sun, and that the sun did something (the final hash and the `lightIn`
differ from the same run without the sun).

## 3. The log

- **One line, when it starts**: the segment that owns step `s` (`ownedInterventions`: the segment
  that stepped to `s`) writes `{"step":s,"kind":"sun","percent":p,"span":N}` to `interventions.jsonl`
  when it applies it. The keys are always in that order. The line is the entry itself, so a log still
  replays as a schedule.
- **The end is not logged.** The return of the world's light at `s + N` follows from the entry. A
  second line would make the log differ from the schedule.
- `checkInterventionLog`, `sameIntervention`, `formatInterventionLine`, `parseInterventionLog` and
  `labHistory` compare and parse by kind. A sun matches when `step`, `percent` and `span` are equal.

## 4. Replay across segments and checkpoints

- **The active sun at step t** of a schedule is the sun entry with `step <= t < step + span`, if any
  (`sunAt(list, t)`; there is at most one, because suns do not overlap). It is a function of the
  schedule alone, and the whole schedule rides in every segment's task.
- **The observer carries it.** `ObserverState.sun` is `{step, percent, span}`, present only when a sun
  is active at the observer's own step, the same way `fed` is present only in fed histories. Every other
  observer state, artifact and digest is byte for byte what it was. A checkpoint taken during a sun,
  and the final observer of a call that ends during one, say which sun governs the next step, so a
  checkpoint artifact on its own determines its continuation.
- **At the start of a call** at step `t > 0`: if the spec has a schedule, `opts.observer.sun` must
  equal `sunAt(schedule, t)` (both absent, or the same entry). Otherwise the run refuses before
  touching a GPU ("the start checkpoint was taken under another sun than this schedule's"). If the
  spec has no schedule, the observer's sun, if any, governs until its end, and nothing is logged. In
  both cases the simulation is built with the world's own config and the active sun is installed
  before the first step. A fresh run (t = 0) has no observer sun, and its step-0 entries, suns
  included, are applied before the first step.
- **Branches refuse a sun.** A branch (`RunOptions.branchFrom`, a pre-cycle checkpoint) whose source
  observer holds an active sun is refused ("a branch cannot start under a sun"), as a picked run
  cannot continue from a checkpoint. Otherwise the source's sun would carry silently into a spec
  that has no schedule.
- **Splitting.** The runner already splits a census chunk at every scheduled step inside it. A sun adds
  one more kind of split point, its end `s + N`, where the world's light is restored with the
  simulation idle. An end at a census step is restored at the start of that step's interventions slot,
  which is physics-neutral, before any entry at that step and before the checkpoint, which therefore
  carries no `sun`.
- **The garden case.** A letter on day d lands at `(d + 1) * D`, the end of day d, and is owned by
  day d. With a span of one day it governs all of day d + 1, whose segment starts at the sun's own
  step. That segment does not own the sun, but it inherits it from day d's final observer and checks
  it against the schedule. Day d + 1 is verified by its own replay from the same checkpoint, so both
  islands run the same sun.
- **Segmented equals continuous**: `tests/deno/sun.ts` cuts a run inside a span, at its start step and
  at its end step, and requires the same final state hash and the same artifact digest as the
  continuous run. It also checks that the logs join into the continuous run's, and that `stitchRun`
  rebuilds the bundle.

## 5. The garden letter

- **Body**: `{"kind": "sun", "percent": p}`, exactly those keys. The span is not chosen: it is one
  garden day (`steps_per_day`). So a sun posted today shines on the day after its landing day, the
  whole of that day, and then the world's light returns.
- **Which percents**: those `sunError` accepts for the garden's preset. The coordinator learns a
  preset's light from a new `:world_light` map in `config.exs` (`{lightBase, lightAmp, seasonAmp}` per
  preset), held to `presets.ts` by `packages/runner/test/coordinator-presets.test.ts` as `:world_size`
  already is. A preset missing from the map takes no sun letters.
- **Where it lands**: the first day at or beyond the frontier with a free letter place (a sun takes
  one of `letters_per_day`, and the same per-network letter budget as a stone) that has no live sun,
  and is not the last day (a sun on the last day would shine past the horizon). One sun a day.
- **Frontier soundness**: a sun on day d affects day d + 1, and day d + 1 > d >= frontier holds no
  attempt when it is posted or dropped. So no attempted segment's history changes, the same argument as
  for stones.
- **Schedule order** at one step: stones, then foods, then suns, each by `seq`.
- **The view (contract `garden-v1`, additive)**: a sun letter's view has the stone keys, with `x`,
  `y` and `r` as `null` (a sun has no place), plus `percent` and `span`. A stone's view gains no key.
  The top level gains `sun: {percents: [...], span}`. The page's shape check accepts `null` for a
  letter's `x`, `y` and `r`. A page older than this change fails on a garden that holds a sun letter.
  The page and the coordinator ship from one repo, and the README's contract table gets the amendment.
- **Islands**: a run or verify task whose schedule holds a sun goes only to an island that advertises
  `sun-v1` (`ISLAND_CAPABILITIES`, `Queue`'s gating, the ops status list). An `interventions-v1`-only
  island would refuse the spec, or an older build would run it without the sun and diverge.

## 6. The lab and the CLI

- **Lab Sun tool**, beside Wound, Feed and Drain. It is not a brush: choose a percent (each option
  says what it does to this world's light, from its config) and a span in steps, then send. It logs
  the entry in the run manifest. It is refused, with the reason, when `sunError` refuses the world, and
  disabled while a sun is active ("the world's own light returns at step X"). The traversal splits at
  the sun's end, a jump back replays suns from the log, and a checkpoint loaded during a sun restores
  it from its observer state.
- **`tools/run.ts --sun STEP:PERCENT,SPAN`**, repeatable, merged after `--feed` and stable-sorted by
  step, like the other flags.

## 7. What this does not do

- No shift, no darkness (0) and no continuous dial. No sun chosen by vote or by the keeper's schedule
  beyond the founding list.
- No naturalist or firsts handling of suns beyond ignoring them where kinds are switched on.
- No change to the commons' settings: whether the commons takes sun letters is the user's decision.

## 8. The kernel edits shift would need (not done here)

1. `packages/schema/src/config.ts`: an optional `sunShift` key (cells, `0..tileW-1`), absent from
   `defaultConfig()`, so it is bounded, validated and kept out of every existing hash.
2. `packages/sim-ref/src/step.ts` `light()`: `sun = (sun + (c.sunShift ?? 0)) % c.tileW` in the sweep
   branch.
3. `packages/sim-gpu/src/shaders.ts` `prelude` and `light_at`: a `SUN_SHIFT` constant and the same
   term.
4. `packages/sim-gpu/src/golden.ts`: a golden case with a shift, and a new pin in
   `packages/sim-ref/test/golden-hashes.test.ts` for it (existing pins unchanged).
5. `docs/rules.md`: the term and its bound.

Those files are held by the gene v2 peer session, so shift waits for it to land.

## Amendment, 2026-10-18 (during the build)

What the code showed, and what changed in the rules above because of it. Nothing here changes a kernel, a config or a pin.

1. **The light bound is a sum too.** `validateConfig` refuses `lightBase + lightAmp + seasonAmp > 255`, not only each value
   above 255. `sunError` refuses both, so every sun config is still a valid config. Section 1's storm example was wrong: on the
   storm (20 + 170 + 60 = 250) every brightening is refused (125 gives 25 + 212 + 75 = 312), and the storm takes 50 and 75
   only. Even light (40 + 160) takes 50, 75 and 125; the gradient (20 + 220) takes 50 and 75. No preset takes 150 today.
2. **Every letter view has every key.** The garden's contract test holds every letter to one key set (the contract's own
   "every key always present"), so a stone's view gains `percent` and `span` as `null`, rather than a sun alone having them
   (section 5 said a stone's view gains no key). A sun's `x`, `y` and `r` are `null`, as planned. The page's shape check
   still refuses a stone without a place. The top-level `sun` block also says where the next sun would land
   (`nextLanding`, `{day, step}` or `null`).
3. **Conditions that change the light.** `uniform-light` and `fixed-env` change a preset's light, and the coordinator's
   `:world_light` is the preset's own, so an experiment with either condition takes no sun (`:light_conditions` in
   config.exs, held to packages/runner's conditions by the same test as `:world_light`). The runner itself checks the
   condition's real config, so this only keeps the coordinator from accepting what islands would refuse.
4. **A garden is not founded with a sun.** Its suns are its letters; a founding sun with a long span could overlap the first
   sun letter, which every island would then refuse.
5. **Branches, in two places.** `runExperiment` refuses a branch whose schedule has a sun active at the branch's start, and
   `tools/run.ts --branch-from` refuses a source pre-cycle checkpoint whose observer holds a sun (the runner never sees the
   source's observer).
6. **Session files.** No session file version holds a sun yet, so the lab refuses to write one for a history that holds a
   sun, saying so, and the file's facts never count a sun as a pick.
7. **The lab.** `LabSimulation.setLight` is optional: a simulation without it takes no sun, and a checkpoint saved during a sun
   cannot be loaded on one. The verify twin runs under the live world's sun. A sun set by hand is logged at the world's step,
   after that step's census, like a lesion.

## Amendment, 2026-10-18 (after review)

Three review lenses and a Codex pass read the build. What they found that changed a rule above, or a claim in the first amendment.
Nothing here changes a kernel, a config or a pin.

1. **Session files, for real this time.** The first amendment's item 6 said the lab refuses to write a session file for a history
   that holds a sun. It did not: `exportRefusal` could not see the interventions, and `buildSessionFile` copied the sun into a file
   that `sessionFileError` then refused. Now `exportRefusal` refuses a history with a sun, in words (its checkpoint download and
   its run manifest still carry the sun), and `buildSessionFile` throws on one. The Session card's "By hand" counts Suns beside
   Wounds, Feeds and Drains (`SessionFacts.suns`, present only when there is one, so a file's facts never carry the key).
2. **A continuation from a step-0 checkpoint.** (Its second half is wrong; the second review below replaces it, item 1.) The lab can set a sun before its first step and save the world there: state at
   t = 0 and an observer carrying the sun. Section 4 said a fresh run has no observer sun, and the runner refused this valid
   artifact. Now a call given a start state and its observer at t = 0 is a continuation like any other: its observer's sun is
   checked against the schedule as at t > 0 (or governs alone, with no schedule), and its step-0 entries, which the checkpoint
   already holds, are neither applied nor logged again (this also stops a step-0 lesion being applied twice there). An observer at
   t = 0 without its start state is a fresh run's and still may not carry a sun. The runner never writes a step-0 checkpoint itself
   (its checkpoints follow a census, after stepping).
3. **A fork from a checkpoint taken under a sun.** (At step 0, see the second review, item 1.) `tools/run.ts --start-from` refused any schedule there, because a schedule
   holding only new entries has no sun at the fork's start and the CLI refuses entries at or before it. Now a fork with a schedule
   of its own starts that schedule with the sun the checkpoint's observer carries. It is at or before the fork's start, so it is
   neither applied nor logged again; `sunAt` then agrees with the observer, and a new `--sun` is checked against its end by the
   ordinary overlap rule. The fork's `manifest.spec` therefore names the sun it ran under, as a coordinator segment's does. A fork
   with no schedule keeps the observer's sun to its end, as before.
4. **The observer's sun ends by `MAX_STEP`.** `decodeArtifact` refuses an observer sun whose `step + span` passes `MAX_STEP`, as the
   schedule already did.
5. **"A sun must set inside its run" is the CLI's rule for suns it is given, not for histories.** A lab world saved while a sun still
   shines replays headless (`--picks-from` a lab manifest) to the lab's last step with the sun open; the final observer carries it,
   and the comparison with the lab's checkpoint is unaffected. The sun a fork inherits (item 3) may also end after the fork's last
   step. Every other `--sun` and every coordinator sun still sets inside its run.
6. **A sun ending at a pond boundary that waits for donors.** The lab's walk stopped at such a boundary before the sun's end there
   could set, so after the donors were chosen the dim light stayed installed and a new sun was refused. The sundown now also runs
   after `resolvePond`, in the walk's order (census, cycle, sundown, the entries of that step), and before `applySun` checks for an
   active sun, so a sun may start at the step another ends.
7. **Exact values from the page.** The lab worker passes a sun's percent and span to `applySun` as sent, which refuses a fraction or
   a string, rather than rounding them into another sun. `labHistory` refuses a logged sun with a key it never writes rather than
   dropping the key.
8. **Proposals refuse a sun.** `tools/lib/propose.ts`'s `validateProposalSpec` refuses a proposal whose interventions hold a sun: a
   proposal's fork is a lesion or a feed, and its bench (`tools/lib/bench.ts`, `bench-fs.ts`) draws and compares by centre and
   radius, which a sun does not have. This was in the build but not in the note.
9. **The light view compiles once.** `Renderer.setLight` is a no-op for the light it already draws, so a load without a sun compiles
   the view's pipeline once, as before.
10. **The copy.** On most presets a sun can only dim (the storm and the gradient take 50 and 75, even light 125 too), so the lab's
    tool, the garden form and the README say "dims, or on some worlds brightens". A garden whose light takes no sun has
    `sun.nextLanding: null`, as every sun letter there would be refused.
11. **What the tests now guard.** CPU and GPU parity in every light mode at every percent each takes (not only the sweep at 50); a
   check that only the react shader reads light and that `RefSim.light` reads nothing of `this` but `cfg`, the two facts the
   pipeline swap and `SunRefSim` rest on, which a later kernel edit could break silently; every malformed observer sun through
   `decodeArtifact`. Not covered: a sun in a pond or migrating world on the GPU, and an end-to-end reload of a lab checkpoint taken
   mid-span (unit-tested on the reference physics only).

## Amendment, 2026-10-18 (second review)

A second Codex pass read the fixes above. What changed:

1. **A run from step 0 owns its step-0 entries, checkpoint or not.** The first fix treated every start state with an observer at
   t = 0 as already holding its step-0 entries and skipped them. A world saved before its step-0 entries holds none, so a
   sun-less resume lost a step-0 lesion or feed that it applied before suns existed, and a resumed step-0 sun wrote an empty log
   that `stitchRun` refused. Now the rule is the one before suns: a call from step 0 applies and logs its step-0 entries
   (`ownedInterventions`), with or without a start checkpoint. A step-0 checkpoint taken under a sun is still accepted: with a
   schedule, the schedule's step-0 sun must be the observer's, and installing it again changes nothing, since a sun changes no
   state; with no schedule, the observer's sun governs to its end. A step-0 lesion in such a checkpoint's schedule applies again,
   as it always did (the lab's own reload does not go through the runner). A CLI fork from step 0 likewise installs and logs
   the sun it inherits as its own step-0 entry.
2. **The Sun button follows the world on screen.** Setting a sun while a replacement world loads applied the old world's choice to
   the new one. The button is disabled with the other world controls while a world loads, a click that races the repaint is not
   sent, and the request names the world on screen, which the worker refuses once that world is replaced.
3. **The garden says its own reason first.** A garden that takes no letters (stopped, finished, the queue or log full) says so on
   the sun form too, rather than that no day has room for a sun.
4. **Tests.** The worker's refusal of a fraction, a string and a replaced world is tested at the worker's message boundary (the
   e2e test), not only on `applySun`; the GPU's parity is checked inside the span (t = 25), not only after it.

## Amendment, 2026-10-18 (third review)

1. **An island rejects a predecessor under the wrong sun.** The runner's check that a start observer's sun is the schedule's
   (or, with no schedule, one the world's light takes) is now `sunContinuationError`, which `runExperiment` throws and an
   island's predecessor preflight sends as a rejection, like the rest of `continuationError`. Before, such a predecessor passed
   the preflight and the runner's throw ended the island with no `/reject`, so the lease expired and the next island met the
   same failure. `continuationError` itself is unchanged, since tools/run.ts calls it before it puts an inherited sun first in a
   fork's schedule.

## Amendment, 2026-10-18 (the founding switch, slice 41)

Written before the code. Merging draft PR #60 found that every garden whose world's light takes a sun took sun letters
(the big storm takes 50 and 75), with no switch, although section 7 calls whether the commons takes them the user's
decision; and that the page's letters copy ("a place and a size") is not true of a sun. Nothing here changes a kernel, a
config, a schedule that exists today or a pin.

1. **A founding key `sun`.** `POST /api/gardens` takes `sun`, `true` or `false`, default `true`. Anything else is a 422,
   "sun must be true or false". The default keeps what #62 shipped: a garden founded without the key takes suns as
   before. The keeper's choice is stored on the garden record as `sun`. A record without the key (any garden founded
   before this change) reads as `true`: one accessor, `Garden.sun?/1`, is the rule for both. There is no route that
   changes it after founding; turning suns off (or on) later means a new garden, as for food and meteor. No config key
   is added: the default is a literal, as food's `false` is.
2. **With `sun: false`, a sun letter is refused.** After the body's shape check (exactly `kind` and `percent`, a percent
   of 50, 75, 125, 150; unchanged, and with no knowledge of the garden), the Queue refuses it with **422**
   `{"error": "this garden takes no sun letters"}`, checked before the light's percents and before the landing, so a
   garden with suns off says that and nothing else. Nothing is stored or scheduled: the record's letters and
   `next_letter`, and the experiment's `interventions`, are as they were. The refusal is charged to the address like
   any refused letter. Stones are unaffected. **Why 422 and not 409:** the README's split is that 409 means the garden
   takes no letters *now* (stopped, finished, full, no day with room), while 422 means a letter this garden does not
   take; a founding switch is the second kind, the same as "this garden's light takes no sun".
3. **The view (contract `garden-v1`, additive).** The `sun` block gains `enabled`, a boolean: whether the garden takes
   sun letters. It is named as the food and meteor blocks' `enabled` are, rather than `on`. With `enabled: false`,
   `percents` is `[]` and `nextLanding` is `null` (every sun letter would be refused, which is what both already say),
   and `span` is still one day. With `enabled: true` the block is as before. The contract fixture shows
   `enabled: true`.
4. **The page.** The sun form is shown only when the view has a `sun` block, its `enabled` is not `false`, and its
   `percents` is not empty. A `sun` block without `enabled` (a coordinator from #62 or #64) reads as enabled, the
   coordinator's own rule for a record without the key. The letters paragraph says what each kind carries, true for
   stones, suns, foods and meteors: a stone its place and size, a sun its brightness, a food or a meteor only what the
   garden's rule sets; none names who sent it.
5. **The commons.** `bin/garden-found` sends every key, so its body gains `"sun":true`, and `"meteor":false`, which #64
   left out although the checklist sends every key so that a later change to a coordinator default cannot change the
   commons. docs/garden-opening-2026-10-18.md gains both rows in its founding table: `sun` on (your decision; #62) and
   `meteor` off (#64, meteor note section 0). The smoke test compares both against the public view's `sun.enabled` and
   `meteor.enabled`.
6. **Tests.** Pure (`Garden`): sun off refuses and changes nothing; the default takes suns; a record without the key
   takes suns; the view's `enabled`, `percents` and `nextLanding` on and off. Queue: founding with `sun: false` and with
   a non-boolean; a `state.bin` whose garden record has no `sun` key loads after a restart and takes a sun. HTTP: the
   key passes through founding; the 422 and its words; the contract fixture and its drift tests. Page: the form's
   condition (vitest) and the form hidden for `enabled: false` (Playwright, mocked contract). `tests/deno/garden_e2e.ts`
   founds without the key and must still pass unchanged.

**Review fixes to this amendment, 2026-10-18 (written before their code).** Three review lenses and a Codex pass found
no fault in the rule above; these are the smaller corrections they led to.

- **What `enabled` means.** It is the keeper's founding switch and nothing else. A garden founded with suns on whose
  light takes no sun reads `enabled: true`, `percents: []`, and refuses every sun ("this garden's light takes no sun").
  A client that wants to know whether a sun can be sent reads both, as the page does. The README says so.
- **The record.** `Garden.sun?/1` reads a missing key or a `nil` as on, and only `false` as off, so the view's
  `enabled` is always a boolean.
- **The letters paragraph.** Item 4's sentence named a food and a meteor even in a garden with neither, and said they
  carry "what the garden's rule sets", which cannot be checked. The paragraph now names only the kinds this garden
  takes: a stone carries only its place and size; a sun, when the garden takes suns or holds one, only its brightness;
  a hand for food or a meteor, when the garden has either, carries nothing (its body is exactly `{}`). None of them
  names who sent it. This is the garden page's copy only. The privacy page (`apps/lab/privacy/index.html`) still says
  a letter "carries only a place and a size", which a sun letter does not; that page belongs to draft PR #60 and is
  left to it.
- **Tests added.** The refusal is charged to the address (two refusals spend a refusal budget of two, then a stone is
  a 429); a garden founded with `sun: false` stays off across a restart; the page hides a shown sun form when a live
  refresh brings `enabled: false`; and the founding smoke test now fails a commons whose view has `sun.enabled` false,
  `meteor.enabled` true, or no `sun.enabled` at all. `bin/garden-found`'s printed summary now reads its `meteor` and
  `sun` lines from the values it sends.
