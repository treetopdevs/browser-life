# Sandbox: wild (stacked levers and the breeder)

Started 2026-10-04. Exploratory, not registered: nothing here is a pre-stated endpoint, and no result
is read against a fixed decision rule. The aim is new and interesting life forms and a loop that can
push a chosen trait, not a confirmatory claim. `RULE_VERSION` stays 1, and every pinned golden hash is
unchanged; the new keys are optional and absent from `defaultConfig()`.

jj workspace `wild` at `../browser-life-wild`, bookmark `sandbox/wild`. Unlanded, not pushed.

## What is in the tree

One merge of four parents, so that every lever built so far can be used in one world:

| Parent | Brings |
| --- | --- |
| `main` (03e5ff64) | the pond cycle (`scaf`, `rand`, `cont`), the hunt's `nat` and `shuf` |
| `sandbox/cells` (on `sandbox/ownership`) | lossy takeover, recurring wounds, heritable kernel rings, declared cells |
| `sandbox/planet` | the rotating and wandering sun (`lightMode: "sweep"`), `signalGain`, hand-built movers |
| `sandbox/feed` | mid-run feeding as a logged lab intervention |

Six files conflicted and were joined by hand (`config.ts`, `presets.ts`, `migrate.ts`, `runner.ts`,
`golden-hashes.test.ts`, the lab's `execution.test.ts`); `step.ts` and the shaders merged without
conflict. The planet presets were moved after the pinned presets, whose order a test pins. A new golden
case, `wild-stack`, turns every optional lever on at once (wandering sun, seasons, signal gain, wounds,
far-ring shape); the GPU matches the CPU reference on it and on the 22 earlier cases.

## Storm world: first look

Presets `wild-storm` and six one-lever variants stack the levers at the dose each sandbox used.

- **The full stack is lethal to the M3 founders.** `wild-storm` at seed 1 was extinct by step 29,000.
- **The sun's speed is what kills.** One lever at a time on the calm gradient world, 60,000 steps, seed 1
  (living cells at the end): calm 7,795; shape 3,998; wounds 3,897; seasons 9,198; signal 6,691;
  sun at 1/64 cell per step 0 (dead by 40,000). The storm without the sun survives (1,564).
- **Sun speed ladder** (the M3 founders on the gradient world, 100,000 steps, living cells at the end):
  a lap of 256 cells in 16,384 steps, extinct; 32,768 steps, 6,170; 65,536 steps, 9,455; 131,072 steps,
  11,019. The hand-built sleepers, drifters and sensors survive the fastest sun (5,494).
- One seed each, so these are leads. The storm presets need a sun at half speed or slower before a sweep
  of the other levers is worth running.

## The breeder

The pond cycle already chooses which ponds seed the next cycle. The breeder makes *what they are chosen
for* a named score.

- `pondArm: "breed"` with `pondScore`: every pond is ground to nutrient and reseeded from a packet, as in
  v1, and the donors are the occupied ponds with the largest score, up to a quarter of all ponds (16 of 64;
  fewer when fewer are occupied). Equal scores are ordered as the `scaf` arm orders ponds (bound mass, then
  its random key), so while nothing scores the breeder *is* `scaf`, and a pond that scores at all outranks
  every pond that does not.
- Scores (`PondScore`, `pondScores` in `packages/schema/src/ponds.ts`), each an integer measure of the
  pre-cycle snapshot, so the cycle stays a pure function of that snapshot:
  - `drive`: moving mass. For each living cell at the census support threshold (bound mass 48 or more),
    bound mass times the size of the motility term that `flow` adds to its displacement (`|dx| + |dy|`, in
    1/64 cell per step). The term comes from `motilityTerm` and `motilityReader` in
    `packages/schema/src/world.ts`, which `flow` itself calls, so the score cannot drift from the rule.
    Thinner living cells move too and are left out on purpose: the score counts moving bodies, so a driven
    film under the threshold scores nothing.
  - `reach`: bound mass in the pond's edge zone (Chebyshev distance 28 or more from the landing centre).
  - `mass`: v1's trait, which makes `breed` the `scaf` arm exactly.
  - `seed`: the expected bound mass of a packet drawn from the pond: the mean, over the cycle's own draw of the
    packet centre, of the bound mass in the 8 x 8 window that would be copied (`pondSeeds`). It is the survival
    term; see "Why bred ponds died" below.
  - `body`: body size. A body is a set of cells at the support threshold joined through their four neighbours;
    the value is the size, in 1/256 cell, of the body an average unit of the pond's bound mass sits in
    (`pondBodies`).
- **Combined scores.** `pondScore` is one term or several joined by `+`, for example `drive+seed+body`. Under a
  combined score a pond is as good as its worst term: its score is the smallest, over the terms, of the number of
  ponds it beats on that term (`worstRanks`). The rule has no weights and does not depend on the terms' units, and
  a pond at the bottom of any term scores 0, so one term cannot be bought with another. Ties still fall back to
  bound mass and then `scaf`'s key.
- Controls record the same score without selecting on it: `pondScore` with `scaf` (the most massive ponds
  donate) or `rand` (random donors).
- Conditions: `pond-breed-<score>`, `pond-mass-<score>`, `pond-drift-<score>`, on any pond preset, for every term
  and for `drive+seed` and `drive+seed+body`. Any other combination is a valid `pondScore` in a config.
- `ponds.tsv` gains two columns, `score` and `donorScore`, only in runs with `pondScore`; under a combined score
  `score` is the rank, and one more column per term holds its value.

An earlier version ordered equal scores at random. With no pond scoring yet it behaved like the `rand`
arm, which is known to lose productivity, and a smoke world died out in 17 cycles; hence the fall-back to
bound mass.

### Picking donors by hand (the lab)

The lab's Breeder panel (pond worlds of arm `scaf`, `rand` or `breed`) has one switch: stop at each pond cycle
and let me choose the donors. With it on, the world runs to the boundary, takes that step's census, and waits
before the cycle. The field shows the pond grid with each pond's rank by a chosen measure (the world's own
score, speed, seed packet, body size, bound mass, moving mass, reach); the Pick tool adds or removes a pond;
"Top quarter" takes the best quarter by the chosen measure and "The rule's choice" the world's own donors. "Breed"
applies the cycle with the picked ponds as donors, in the order picked, and the world runs on to the next
boundary.

- A pick is `applyPondCycle`'s `picks`: the donors replace the arm's choice and everything else is the arm's
  (which recipient takes which donor in turn, the packet centres, the landing). A cycle whose picks are the
  arm's own donors in its order is the arm's cycle bit for bit.
- Every cycle resolved in breeder mode is logged as an intervention of kind `pick` (step, cycle, donors), the
  rule's own choice included, so the log says what happened at every boundary a person saw.
- Replay is exact. A jump back restores a checkpoint and replays the log; a logged pick is applied as part of
  its boundary, boundaries of the replayed stretch without a pick take the rule's donors as they did, and none
  of them waits. The verification twin takes the same picks. A jump back drops the log beyond its destination
  (the present is saved as a checkpoint first), as it always has for lesions and feeds; boundaries beyond the
  history that is left are new choices and wait again (`replayPlan` in `apps/lab/src/checkpoints.ts`).
- While a cycle waits the world holds a pre-cycle state, which no checkpoint may carry: saving, exporting,
  verifying, a lineage reading, a jump and a lesion all wait for the pick, and the automatic checkpoint is
  skipped until then. Leaving breeder mode with a cycle waiting applies the rule's choice.
- Breeder mode is a setting of the lab, not of the world: nothing enters the config or the state hash.
- Preset `breeder`: 4 x 4 ponds, a 5,000-step cycle, arm `breed` with `drive+seed+body`, mutation x10. At 512
  steps per frame a cycle takes about 3 seconds on the Apple GPU this was built on (about 1,750 steps a
  second; about 11 seconds while two headless runs shared the GPU).

### Picking donors outside the lab

`tools/run.ts --picker` takes the donors of every pond boundary from a picker instead of the arm's rule, with no
lab and no browser: the same `applyPondCycle` `picks`, the same bit-exact cycle. It needs a pond preset of arm
`scaf`, `rand` or `breed` (`pickedConfigError`).

```bash
# the rule through the picker path: identical to the unpicked run, bit for bit
deno run -A tools/run.ts --experiment pick1 --preset breeder --conditions treatment --seeds 1 --steps 80000 \
  --census 1000 --deep 20 --checkpoint 0 --pre-cycle 1,4,8,12,16 --out runs/wild --picker rule --pick-label rule
# a seeded random control, then a model (tools/picker-claude.ts; its header says how it is called)
deno run -A tools/run.ts ... --picker random --pick-seed 1 --pick-label random
deno run -A tools/run.ts ... --picker command --pick-label model \
  --pick-cmd '["deno","run","-A","/abs/tools/picker-claude.ts","--model","sonnet"]'
# an exact replay of any picked run's log, checked against it; a lab run manifest works too
deno run -A tools/run.ts ... --picks-from runs/.../picks.jsonl --verify-against runs/.../seed-1
# the three side by side: frames.png and trajectory.tsv (a picked run is read by its directory name)
deno run -A tools/breed.ts read --dir runs/wild/pick1/breeder \
  --conditions treatment-by-rule,treatment-by-random,treatment-by-model --out runs/wild/pick1/report
```
Repeat the same flags for each picker. A model run leaves `picker/notebook.md`, `picker/album.png` and, per cycle, a
contact sheet and the donors the run applied (`b<NNN>-applied.json`) beside its bundle, and spends one call a cycle from the call log at `runs/wild/review/model-calls.log`
(`--max-calls` stops it at the cap).

- Pickers: `rule` (the arm's own donors), `random` (seeded, uniform over the ponds able to found a pond, the
  rule's count), `file` (writes `b<NNN>-request.json` and a contact sheet `b<NNN>-sheet.png` into the pick
  directory and waits for the file the request's `answer` names, `b<NNN>-picks-<nonce>.json`: one per request, so
  a late answer to an earlier attempt of the boundary lands elsewhere), `command` (the same files, then a command
  with the request on stdin and `{"donors":[...]}` on stdout; at the deadline the command and its descendants are
  ended, SIGTERM then SIGKILL, output that ends after the deadline is late even if the command itself exited in
  time (judged by the clock, not by which event arrived first), and more than 1 MiB on either stream fails the pick). Once a boundary is committed, replayed ones included,
  `b<NNN>-applied.json` (the request's `applied`) holds the donors the run applied there, so an answerer that keeps
  a memory can tell a choice the run took from one it never applied. A pick directory belongs to one run
  (`owner.json` names its bundle directory in canonical form, so a recovery through a symbolic link is the same
  run): another run pointed at it is refused before any GPU work and before recovery changes anything. The sheet is drawn from the state alone, in pond-index order, coloured
  by bound mass, labelled white for a pond able to found a pond. Neither it nor the request carries the rule's
  donors, scores or ranks. The visible state still carries what the rule reads (bound mass drives `scaf` and the
  mass term, the packet mass is a breeder term), so a picker that favours the heaviest eligible ponds agrees
  with the rule because the picture shows what the rule uses, not because it saw the rule.
- Log: `picks.jsonl`, one line per pond boundary, `{step, kind: "pick", cycle, donors, by, suggested}`; the first
  four keys are the lab's `pick` intervention. `suggested` is the arm's own donors, kept for agreement
  statistics and never shown to a picker. The manifest carries `spec.picked` and a `picks` block (counts, digest),
  so a picked run is never the same run as a rule-bred one, and the bundle goes to `<condition>-by-<label>/`
  (`tools/breed.ts read` reads those names; the ensemble tools refuse picked runs).
- Failure rule: any picker error (a throw, a non-zero exit, a timeout, unparsable output, an invalid answer, a
  recorded entry that is not a valid pick) stops the run at that boundary with the world exactly as it was,
  a `failed` line in the log and exit 3. Nothing retries or falls back to the rule. Recovery: re-run the same
  command with `--picks-from <bundle>/picks.jsonl`; recorded boundaries replay (seconds) and only the missing
  ones are asked. The record replayed is every boundary that `--picks-from`, `picks.jsonl` and
  `picks.recovery.jsonl` hold between them, so a given record of later cycles cannot displace committed earlier
  ones, and whether the record covers the run is judged on that merged record; it is written to `picks.recovery.jsonl`, as pick lines whatever the source's format, before anything is
  truncated. Recovery refuses (exit 2) rather than guess: a log damaged anywhere but its last record is left as it
  is, and logs that disagree on the cycle or ordered donors at a shared step are not merged. A last record cut by a crash (unterminated, not JSON) is the one repair: its complete picks
  are used and the original is kept as `picks.jsonl.torn`.
- Replay and replay-then-continue: the record wins where it has an entry, so `--picks-from` alone is an exact
  replay (same final hash and `ponds.tsv` bytes; the replayed `picks.jsonl` has the same `step`, `cycle` and
  `donors` per line but `by: "recorded"`, so its bytes are not the original's), and with `--picker` it is a continuation that spends calls
  only on new boundaries. A picked run cannot resume from a checkpoint, be segmented, stitched or run on an
  island.
- Lab histories: `--picks-from` takes a lab run manifest (`<runId>.run.json` in the lab's storage; the Export
  button makes a `.blck`, not this). Its `pick` interventions replay, a boundary it has none for takes the
  rule's donors as the lab's own replay does, and lesions, feeds or an observation that starts after step 0 are
  refused. This reproduces the physics, not the lab's observer settings, so `finalHash` can differ from the
  lab's. It was proven on a manifest built by hand from a log, not on a real lab export.
- Eligibility: a pond can found a pond when its expected packet mass (`pondSeeds`) is at least 3,000, from the
  survival table under "Why bred ponds died". That table was measured at 10,000-step cycles on 64 ponds; the
  breeder preset cycles every 5,000 steps, where the threshold is unmeasured. The runner does not enforce it
  (an ineligible pick is a valid pick); the model script does, for its own answers.

### Tests

- `packages/schema/test/breed.test.ts`: the key and its validation, the scores (truncation as in `flow`,
  the support threshold, motility off), donor ranking, exact matter and ledger, purity, `mass` = `scaf`,
  the controls adding only the two columns; `seed` against the packet window by definition (even and odd k,
  wrapping inside the pond), `body` on hand-built bodies, combined scores and their columns, and picks (order,
  bit-identity with the arm's own donors, refusals).
- `apps/lab/test/execution.test.ts`, "lab execution in breeder mode": the world stops pre-cycle with the census
  taken; picked donors give `applyPondCycle`'s state; the rule's choice gives the world the rule makes without
  breeder mode, physics and observer; a replay of logged picks reaches the observed world live and in the twin
  without waiting; refusals leave the world usable and an upload failure marks it failed.
  `apps/lab/test/checkpoints.test.ts`: what a jump replays and how far its no-wait horizon runs.
- `packages/sim-ref/test/motility-term.test.ts`: `motilityReader` against `flow` itself (the displacement
  with motility on minus off), for thick and thin cells, cells without a lineage, a neutral run and
  motility off.
- `packages/runner/test/breed-runner.test.ts`: conditions, columns, `applyBoundary`, and the stitch rules
  (a scored run must carry the breeder's header and nonnegative integer scores below 2^53; a run without a
  score must not carry the columns).
- `tools/test/breed-stats.test.ts`: the trajectory summaries and the displacement estimator.
- `tests/deno/breed.ts` (GPU): conservation; every boundary's rows and written checkpoint equal
  `applyPondCycle` on its pre-cycle checkpoint, and that state stepped one period on a fresh simulation is
  the next boundary's readback (for the last boundary, the run's final readback is the transform's state), so
  every upload is checked on the GPU itself; a run cut mid-period and at a
  cycle step, then stitched, equals the continuous run in every verified file; the controls have the physics
  and v1 rows of `treatment` and `pond-rand`; the breeder is its mass control until a pond scores, then seeds
  from the best-scoring pond and ends in a different physical state. The same checks run for
  `pond-breed-drive+seed+body`, and picked donors are checked on the GPU through `applyBoundary`.
- `packages/runner/test/picks.test.ts`, `tools/test/pond-sheet.test.ts`, `tools/test/pickers.test.ts` and
  `tools/test/picker-prompt.test.ts`: the log and its refusals, the donor hook and its failure rule, the sheet
  and its scale rule, the pickers with a fake clock and file system, the prompt, the result parser, answer
  validation and the call budget.
- `tests/deno/picked.ts` (GPU): the rule picker equals the unpicked run; a random picker's run equals the replay
  of its log, with every pre-cycle checkpoint; replay-then-continue with a record longer than the live count in
  reversed order (rows equal `applyPondCycle`'s on each boundary's own checkpoint); the file and command
  pickers; the model script against a stub `claude`; eight failure modes (and a readback of the simulation
  after the rejection equal to the state before it); a throwing `applied`; a failed recovery through
  `tools/run.ts` that keeps all ten recorded picks; recovery from a torn log, from logs that disagree, from a given
  record of later cycles only, and from a lab manifest after two failed attempts; real child processes (a
  process tree at the deadline, floods, an answer that arrives late from a descendant); preflight, resume and
  stitch refusals; a hand-built lab manifest, sparse and with a lesion.

### Reviews

Eight read-only passes by Codex Sol 6.1 High (`runs/wild/review/review-sol-1.md` to `-8.md`, gitignored), and one
of the picker slice's plan before it was built (`plan-picker-review.md`: 22 findings, six of them P1, all taken
into the plan).

- **First** (the breeder): one P0 (the drive score did not share flow's definition of a moving cell: fixed by
  `motilityTerm` and `motilityReader`), one P1 (branch runs refuse the breeder: left unbuilt, see below) and
  four P2.
- **Second**: no P0 or P1, two P2 (the GPU test compared a CPU-produced state; score validation accepted
  integers a reader cannot hold exactly) and one P3, all fixed; the third pass confirmed them.
- **Third** (combined scores and the lab's breeder): no arithmetic, window, rank or donor-order defect. One P1:
  after a jump back, a second jump further forward treated steps the history no longer covered as replayed, so
  a boundary there took the rule's donors without asking (fixed: `replayPlan` bounds the horizon to the known
  history). Three P2: a failed load hid a surviving world's waiting picker; `breed.ts read` changed its
  one-term report format; the last cycle's upload was not checked on the GPU. All fixed.
- **Fourth**: confirmed those four fixes. Two new P2, both fixed and not re-reviewed: a late pick could reach a
  different world waiting at the same step (a pick now names its world), and a jump refused because a cycle was
  waiting left the lineage panel expecting a restore (refusals are now a message of their own, which clears
  it).
- **Fifth** (the picker slice: `--picker`, `--picks-from`, the model picker): three P1 and eight P2. Fixed, each
  with a test that fails without it:
  - a command's deadline ended only the direct child, so a descendant holding a pipe, or a child ignoring SIGTERM,
    kept the run waiting, and output was buffered without limit: both pickers now run commands through
    `tools/lib/run-command.ts` (the tree gets SIGTERM then SIGKILL and is reaped, each stream is capped at 1 MiB and
    overflow stops the child, a pipe a leftover process holds is not waited on);
  - recovery from a pick log with a torn last record ignored the log and let a live rerun truncate it, and recovery
    could mix two histories (an equal-length external log won a tie): a torn last record now recovers its complete
    picks (original kept as `picks.jsonl.torn`), other damage and any disagreement at a shared step refuse the
    recovery before anything is copied, cleared or truncated;
  - a file answer: one answer path per request (`b<NNN>-picks-<nonce>.json`), an answer without the request's nonce
    must be newer than the request, each poll is bounded by the deadline and an answer that completes after it is
    not taken;
  - a picker that threw null, undefined or a string lost its failed line (`thrownMessage`, also on the post-commit
    path); `Picker.applied` gets a copy of the donors, so it cannot change the manifest's digest;
  - concurrent model pickers could pass the call cap together: the check and the `started` line are one step under
    a lock beside the call log.
  Replay not reproducing `picks.jsonl` byte for byte is by design (plan 1.3: replayed lines say `by: "recorded"`):
  resolved by saying so here and in `tools/run.ts`. One P2 was in the lab: a Verify refused with a waiting
  boundary left its pending state stuck (`main.ts` cleared it only for lineage and jump). Fixed after the sixth
  pass: a refused verify clears `verifying`, brings the button back and says the check did not run. It was not
  exercised in a browser.
- **Sixth**: confirmed the fifth pass's fixes. One new P1 and three P2, all in failure paths, fixed with tests:
  - recovery took the longest log alone, so a given record of later cycles displaced the bundle's committed
    earlier ones (P1), and a lab manifest chosen that way was copied into `picks.recovery.jsonl` as its own JSON,
    which the next recovery could not read: recovery now merges every agreeing log by boundary (`mergePickLogs`),
    checks the merged record against the run, and writes it out as pick lines;
  - a command that exited at once while a descendant wrote the answer after the deadline was accepted: the end of
    the output is now held to the same deadline as the exit;
  - the model's notebook promoted a pending block whenever a later cycle was asked, even when a recovery had
    replayed other donors at that cycle: the dir picker now records what the run applied at each boundary
    (`b<NNN>-applied.json`), and a block enters the notebook only when its donors are the ones on record.
- **Seventh**: confirmed the sixth pass's fixes (the merge keeps agreeing boundaries; the recovery copy is always
  pick lines). No P0 or P1; three P2, fixed with tests:
  - with no live picker, a given record of later cycles was refused as short before recovery could merge the
    bundle's committed ones: the given record is now checked for structure first and for coverage after the merge;
  - when this process's event loop was held up past a command's deadline, late output could still win the race
    against the overdue timer: the deadline is now also read off the clock;
  - two runs sharing a pick directory could pass one run's applied record for the other's: a pick directory now
    belongs to one run (`owner.json`, `claimPickDir`), and a second run is refused before any GPU work.
- **Eighth**: confirmed those three and the lab's refused-Verify fix (read, not run). No P0 or P1; two P2, both in
  the ownership check just added, fixed with tests and **not re-reviewed**:
  - owners were compared as spelled, so a recovery through another spelling of the same directory (`/tmp` for
    `/private/tmp`, a symbolic link) was locked out, and a link followed by `..` could make two runs look like
    one: owners are now compared by canonical path on both sides (`canonicalPath`);
  - the refusal came after recovery had written its copy and cleared the bundle's checkpoints: ownership is now
    checked (read-only, `pickDirTaken`) before recovery changes anything, and claimed after it.

Final state (after the eighth pass's fixes): typecheck clean; vitest 2,078 passed in 90 files in one full run;
`tests/deno/picked.ts` 92 PASS lines, ALL PASS. `tests/deno/breed.ts` (92 PASS lines, ALL PASS) and the GPU golden
cases (23 of 23) were last run after the sixth pass's fixes; nothing they exercise changed after that. The lab's
picker was exercised by hand in a browser before the picker slice (pick, the rule's choice, leaving breeder mode,
save and restore, a failed load while waiting); the worker and page code has no tests of its own beyond
`LabExecution`'s and the checkpoint helpers'.

### How to run and read

```bash
deno run -A tools/run.ts --experiment breed1 --preset ponds --conditions pond-breed-drive,pond-mass-drive \
  --seeds 1 --steps 600000 --census 1000 --checkpoint 0 --pre-cycle 1,5,10,20,30,40,50,60 \
  --override mutRate=4294970 --out runs/wild
deno run -A tools/breed.ts read   --dir runs/wild/breed1/ponds
deno run -A tools/breed.ts motion --dir runs/wild/breed1/ponds --boundary 10
```

`read` writes a per-cycle trajectory and a frame sheet from the pre-cycle checkpoints. `motion` steps a
pre-cycle checkpoint on and measures how far each pond's pattern actually moved. A combined score is a condition
like any other; quote it, since its name holds a `+`:

```bash
deno run -A tools/run.ts --experiment breed2 --preset ponds --conditions 'pond-breed-drive+seed+body' \
  --seeds 1 --steps 600000 --census 1000 --checkpoint 0 --pre-cycle 1,5,10,20,30,40,50,60 \
  --override mutRate=4294970 --out runs/wild
```

In the lab: `pnpm dev`, preset "Wild: breeder (4×4 ponds)", tick the Breeder panel's box and press Play.

## First run: breeding for movement (2026-10-04)

`runs/wild/breed1`: preset `ponds` (64 ponds, a clone of M3 founder 2, which is sessile: motility gain 0),
seed 1, mutation ×10 (`mutRate` 4,294,970), 60 cycles of 10,000 steps, `pond-breed-drive` against
`pond-mass-drive`. One seed, so a first look and not an estimate.

| Cycle | Bred: occupied ponds | Bred: commanded movement | Bred: measured speed | Control: occupied | Control: commanded | Control: measured |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 64 | 0.6 | | 64 | 0.6 | |
| 10 | 40 | 68.5 | 74 | 54 | 0.1 | 0.1 |
| 20 | 39 | 151.2 | 178 | 61 | 0.2 | 0.1 |
| 40 | 27 | 226.9 | 240 | 63 | 0.2 | 0.1 |
| 60 | 23 | 273.7 | 282 | 64 | 0.0 | 0.1 |

Speeds are cells per 1,000 steps. Commanded movement is the mass-weighted motility term over all ponds
(`breed.ts read`); measured speed is the median over occupied ponds of how far the bound-mass pattern
actually moved (`breed.ts motion`, 32 steps on at cycle 10, 16 at cycle 20, 8 at cycles 40 and 60; a second,
shorter gap gave the same speed each time, within 3%).

- **The trait responds, and the movement is real.** Every occupied bred pond moved at every boundary measured;
  no control pond did. At cycle 10 the measured direction agrees with the commanded one (median cosine 0.999).
  For scale, the planet sandbox's hand-built follower moves at 15.6.
- **What it looks like.** Each surviving pond is a lattice of bodies marching in step. Around cycle 20 the
  bodies are oblong and tilted along their travel, and a few ponds hold striped forms; by cycle 60 they are
  round dots again, every cell moving at once.
- **The cost is survival.** Bred ponds occupied at a boundary fall from 64 to between 13 and 36 after cycle
  30 (median 27; 23 at cycle 60), while the control holds 61 to 64 and its median bound mass rises from
  108,000 to 140,000. The breeder ranks the ponds that are alive; nothing in the score rewards a packet that founds a
  pond which lasts.
- **It is slowing.** Commanded movement rises about 8 per cycle up to cycle 20 and about 2.3 per cycle from
  40 to 60. The displacement clamp is near 1,000.

Not looked at: other seeds, the default mutation rate, score `reach`, why the measured speed is about 1.8
times the speed the mass-weighted commanded vector implies at cycle 10, and whether the empty ponds fail at
founding or later in the cycle.

## Why bred ponds died (2026-10-04)

Read from the first run's `ponds.tsv`: each row is a founding (a packet landed in a pond), and the same pond's row
one cycle later says whether it was occupied.

- **A pond lasts if its packet is heavy enough.** Over cycles 10 to 59 of `pond-breed-drive`, a packet under
  2,800 bound mass founded a pond that was occupied a cycle later 53 times in 872 (6%); 2,800 to 3,199, 963 in
  1,794 (54%); 3,200 and over, 505 in 534 (95%). No packet was empty: the centre is always a living cell.
- **Breeding for movement alone shrank the bodies to that edge.** Bodies went from about 4,800 bound mass at
  cycle 1 to about 2,460 from cycle 10 on (the mass control's settle at about 3,200), and the expected packet
  mass of the surviving ponds (median over ponds) sat at 2,890 to 3,020 against the control's 3,150 to 3,270.
- From cycle 20 on, a donor's bound mass per body predicts its offspring ponds' survival (lowest third of donors
  33%, highest third 57%); its speed predicts it the other way (49% against 38%).

Hence the term `seed`: it scores what decides founding, on the pre-cycle snapshot alone.

## Second run: combined scores (2026-10-04)

`runs/wild/breed2`: the first run's world and settings (preset `ponds`, seed 1, mutation x10, 60 cycles of 10,000
steps) under `pond-breed-drive+seed` and `pond-breed-drive+seed+body`, beside the first run's two conditions. One
seed each, so a first look.

| Cycle | Movement alone: occupied, speed | Movement + seed: occupied, speed | Movement + seed + body: occupied, speed | Mass control: occupied, speed |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 40, 74 | 62, 46 | 57, 23 | 54, 0.1 |
| 20 | 39, 178 | 62, 83 | 63, 51 | 61, 0.1 |
| 40 | 27, 240 | 64, 108 | 63, 86 | 63, 0.1 |
| 60 | 23, 282 | 63, 135 | 62, 88 | 64, 0.1 |

Occupied is ponds of 64 at the boundary; speed is the measured one, in cells per 1,000 steps (`breed.ts motion`,
median over occupied ponds; 32 steps on at cycle 10 and 16 after for the second run, and at cycle 60 an 8-step
gap gave 138 and 88).

| At cycle 60 (median over occupied ponds) | Movement alone | Movement + seed | Movement + seed + body | Mass control |
| --- | ---: | ---: | ---: | ---: |
| Expected packet mass (`seed`) | 3,022 | 5,023 | 5,857 | 3,264 |
| Body size, cells (`body`) | 20.3 | 23.2 | 25.4 | 26.0 |
| Bound mass | 112,870 | 107,969 | 105,768 | 139,610 |

- **The ponds stay alive.** From cycle 31 on, 60 to 64 ponds are occupied under `drive+seed` and 62 to 64 under
  `drive+seed+body`, against 13 to 36 under movement alone. Packets stay at or above the founder's 5,060, far
  above the founding threshold of about 3,000; even the mass control lets them fall to 3,260.
- **Movement is still bred, at about half the pace.** From cycle 20 on every occupied pond moved at least half
  a cell in the measured gap, but for one pond at cycle 40. `drive+seed`
  reaches 135 at cycle 60 and is still rising (108 at cycle 40). `drive+seed+body` reaches 86 by cycle 40 and
  stays there (88 at cycle 60) while its packets keep getting heavier.
- **What it looks like.** Fewer and larger bodies than the dot lattices of the first run, each trailing a
  streak of thin mass along its travel. Around cycles 5 to 10 a few ponds in both runs held rings and
  maze-like merged forms; they did not last (at cycle 60 no pond's `body` is over 28 cells).
- The measured speed is again above what the mass-weighted commanded vector implies (135 against 85 at cycle 60
  under `drive+seed`).

Not looked at: other seeds, the default mutation rate, longer runs (does `drive+seed` keep rising?), and the
lab's `breeder` preset beyond trying it (4 x 4 ponds and a 5,000-step cycle: under `drive+seed+body` four of its
16 ponds were empty at cycle 9 in the one world watched).

## First look: three pickers (2026-10-04)

Preset `breeder`, seed 1, condition `treatment` (arm `breed`, `drive+seed+body`), 16 cycles of 5,000 steps (80,000),
census every 1,000 steps, the same world and seed under three pickers (`runs/wild/pick1/breeder/treatment-by-{rule,random,model}`,
report in `runs/wild/pick1/report`: `frames.png`, `trajectory.tsv`). The rule run is also the unpicked run, bit for
bit (final hash b0eb4c1474bb222e and `ponds.tsv` bytes against `pick1-ref`, checked by `--verify-against`). The
random picker is seeded (`--pick-seed 1`) and names four ponds a cycle among those able to found a pond, the rule's
count. The model is `claude -p` on Sonnet through `tools/picker-claude.ts`: one tool (Read), no MCP server, no user
settings, a three-sentence system prompt, the contact sheet and the album of what it has already picked, and its own
notebook pasted into every prompt. Its brief: pick four eligible ponds that look most unlike anything the notebook and
the album show, one sentence each on what is new. It is never shown the rule's choice, a score or a rank. Sixteen calls
took 5.2 to 11.0 seconds each and cost $0.54 in all; the call log holds 27 attempts across the whole slice (3 flag
trials, a probe, a 7-call build run and this run's 16). The model run is slower than the others (about 420 steps a
second against 1,700) because each boundary waits for a call.

| picker | occupied at cycle 16 | scoring ponds | drive median | seed median | body median (cells) | individuals (mean per pond) |
| --- | --- | --- | --- | --- | --- | --- |
| rule | 13 | 13 | 383,849 | 4,322 | 5,682 | 18.2 |
| random | 14 | 2 | 0 | 4,276 | 11,362 | 20.4 |
| model | 9 | 0 | 0 | 3,219 | 6,388 | 16.1 |

Across the 16 cycles (`trajectory.tsv` has each one): the rule's drive median is nonzero from cycle 3 on and rises
to 3.8e5 by cycle 15; scoring ponds are 10 to 15 of 16 occupied. The random control's drive median is 0 at every
cycle, with at most three scoring ponds at a cycle (and none at cycles 7, 8 and 11). The model's drive median is
nonzero from cycle 3 to cycle 7 (peaking at 19,706 at cycle 4, 12 scoring ponds) and 0 from cycle 8 to the end, with
none to two scoring ponds at each later cycle. Occupied ponds at a cycle: rule 12 to 16, random 10 to 16, model 8 to 16
(8 at cycle 8, 9 at cycle 16). The model's picks overlap the rule's four donors in 22 of 64 places, random's in 19 of 64.

What was seen in `frames.png` (rows: rule, random, model; two rows each, lineage colour and movement; boundaries 1,
4, 8, 12, 16): the three worlds are the same at cycle 1 and then separate. The rule's ponds stay full of dot lattices
and a movement field (orange) covers much of most ponds from cycle 4 on. The random control thins to small halos and
single dots by cycle 4 and 8, then regrows to large, regular, square-ish lattices by cycle 16 with almost no
movement. The model's ponds are the most mixed: several empty at every boundary, lattices with red wall frames, ring
cells, and single-dot shells; movement shows at cycle 4 and then mostly not. Its notebook (15 blocks; the last cycle's
stays pending by design) reads as descriptions of shape, and it names single-dot shells and sparse ponds as "new" in
most later cycles. `album.png` is mostly such shells and lattice variants, not the rule's heavy lattices.

An earlier 7-cycle model run of the same world and seed (the build's own, not kept as a result) kept a nonzero drive
median through cycle 7, as this one does, but its picks from cycle 2 on were different ponds (only cycle 1 named the
same four, in another order, which changes the recipient assignment). The model is not deterministic, so a model
run is one draw of the model picker, replayable from its log and not repeatable from its prompt.

What one seed and 16 cycles cannot show, and this run does not claim:

- whether the model's choices differ from random's by more than the seed-to-seed spread of one condition (one seed
  and one model draw each); the second model run above is one hint that a model draw varies;
- whether "new-looking" tracks anything measurable (the model was asked for novelty, not for drive, so a drive
  median of 0 after cycle 7 does not say the model picks badly, only that novelty and movement are not the same
  thing here);
- whether the three terms' differences are the picker or the divergence of one chaotic history (the worlds are
  identical until the first boundary and then diverge; a lone reordering of four donors changes a world);
- the founding threshold at 5,000-step cycles (unmeasured; the table above was taken at 10,000 steps on 64 ponds,
  the model was told 3,000, and this run's founding survival by packet mass was not read);
- anything past cycle 16: the rule's movement is still rising at 16 and the model's and random's histories are
  not at a steady state.

## Not built

- Branch runs (`RunSpec.branch`, the hunt's way to start from a pre-cycle checkpoint under another arm)
  still take only `pond-nat` and `pond-shuf`. Branching a bred world to another score would need the branch
  rules, `branchError` and `branchTransform` widened and their GPU tests repeated.
- Islands and the coordinator do not know the `breed` arm (no capability, no allowed condition).
- `tools/run.ts --picks-from` replays a lab history, proven on a hand-built manifest only (no real lab export
  could be made headless); it reproduces the physics, not the lab's `finalHash`.
- Not built around the pickers: resume from a checkpoint for a picked run (replay costs seconds), islands and
  the coordinator, branch runs, a movement overlay on the sheet (it is the `drive` term's picture and would
  show a model what the rule rewards), enforcing eligibility in the runner, retries or a fallback in the runner,
  several conditions or seeds in one picked invocation, `tools/lineage.ts` on picked runs, a multi-seed or
  repeated-draw model demo (the first look is one seed, one draw, 16 cycles), founding survival by packet mass at
  5,000-step cycles (the 3,000 threshold is the 10,000-step table's), and a model brief other than novelty.
- Scores for elongation and for sensing. Productivity (bound mass) is a term but is in neither combined
  condition.
- `tools/run.ts --override` takes only `mutRate` and `pondDeath`, so a shorter pond period needs a preset.
