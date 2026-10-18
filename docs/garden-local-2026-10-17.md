# A garden on one machine: rules written before the code (2026-10-17)

Slice 9 of the backlog run: make the shared garden (`apps/coordinator/README.md`, "The garden",
contract `garden-v1`) a prototype that runs end to end on one machine. Every piece is already on
main (0a1179b): the coordinator's garden backend, `tools/stitch.ts`'s garden mode, the `/garden/`
page and the islands. This slice adds no physics, no contract key, no golden pin and no change to
the router, controllers, plugs or status code. It adds a dev launcher (`bin/garden-dev`), an end-to-end
check (`tests/deno/garden_e2e.ts`), one dev-only config line and documentation.

This note was written before any of that code. The pass criteria below are fixed here; a change to
them is a dated amendment at the end of this note, never a silent edit.

## Sizing: what a dev garden is

- **Preset `spots`** (256x256, no tile migration, no pond cycle, so no cadence constraint and no
  extra capability). It is the smallest preset that needs nothing beyond `interventions-v1`:
  `archipelago` (128x128) forces `stepsPerDay` to a multiple of its migration period (200) and
  `ponds-small` needs `ponds-v1` and a multiple of its pond period (1,000). The coordinator's own
  garden tests already run on `spots` (`config/test.exs`).
- **The only coordinator change** is `config/dev.exs` adding `garden_presets: ~w(wild-storm-large spots)`,
  the same list `config/test.exs` uses. `config/config.exs` keeps the production list (the big
  storm only) and `config/prod.exs` does not read `dev.exs`, so a production coordinator still
  refuses a `spots` garden with 422. Nothing in `lib/coordinator/garden.ex` changes.
- **No new clock.** `Coordinator.Clock` can be moved only from inside the BEAM (ExUnit's
  `Coordinator.TestClock`); moving it from outside would need a new route, which this slice may not
  add. The garden already accepts `dawnPeriodMs` down to 1,000, and a fast dawn grid *is* the test
  clock: a day may be released once a dawn has passed since the previous day's release, which on a
  one-second grid is at most a second of waiting.
- **Defaults of `bin/garden-dev`**: preset `spots`, seed 1, `stepsPerDay` 2,048, `censusEvery` 256,
  `days` 365, `dawnPeriodMs` 60,000 (a day a minute, so the page visibly rests and wakes), the
  production letter budget (`lettersPerDay` 8, `queueMax` 64), founding a step-0 feed
  `{x: 128, y: 128, r: 64, amount: 16}` (the commons' founding scaled to the smaller jar). Name
  `commons`, so the page's default route (`/api/public/garden`, config `:public_garden`) shows it with
  no query; the data directory is a scratch one, never the real commons. Every value is an
  environment variable override. The per-address letter limit (3 per hour) is not raised in dev: a
  dev garden behaves as production does, and restarting `bin/garden-dev` starts a fresh limiter.
- **Islands in `bin/garden-dev`**: `GARDEN_ISLANDS` (default 2, may be 0) headless `tools/island.ts`
  processes. Two are the minimum for verification (a day is replayed by a different island id).
  Both report the machine's real adapter, so their replays count as `same-device-type`, and the
  page says "replayed here, not yet verified elsewhere". (Corrected 2026-10-17, see the
  amendments: the device type is the adapter description, not the computer.)

## What `tests/deno/garden_e2e.ts` does

One scratch `mix phx.server` (MIX_ENV dev, its own port, `BL_DATA_DIR` a temp dir), one GPU device,
two in-process islands sequenced by the test: **A** (producer) and **B** (verifier). Each keeps its
id across calls (`runIsland`'s `identity`), so B is always a different island from A and tending
counts two islands. Both report the same, real adapter description.

Garden `e2e`: preset `spots`, seed 1, `stepsPerDay` D = 256, `censusEvery` 64, `days` 4 (so after
three days the garden is neither finished nor out of days), `lettersPerDay` 1 (so a second letter
spills to the next day), `dawnPeriodMs` 1,000, founding F = the feed above.

Sequence:

1. Found the garden through `POST /api/gardens`. Post letter L1 (a stone) through
   `POST /api/public/gardens/e2e/letters`: frontier 0, so it goes on day 0 and lands at step D.
2. A runs day 0. Post L2: day 0 holds an attempt, so the frontier is 1 and L2 goes on day 1
   (lands at 2D). Post L3: day 1 is full (`lettersPerDay` 1), so L3 goes on day 2 (lands at 3D).
3. B replays day 0.
4. A runs day 1 (its task carries F, L1, L2 and L3). Then the keeper drops L3
   (`POST /api/gardens/e2e/letters/ltr-3/drop`): allowed, because day 2 holds no attempt. This is
   the stitch rule's case 4 for real: a letter in an earlier day's list and in no later one.
5. B replays day 1; A runs day 2; B replays day 2.
6. Restart the coordinator against the same data directory in a fresh OS process.
7. `deno run -A tools/stitch.ts --experiment e2e` into a scratch `--out` (never `runs/`), then
   `tools/run.ts` unsegmented over the same 3D steps with `--interventions` the stitched schedule,
   into another scratch directory.

An island that asks before a day is released gets "idle" (`runIsland` with `maxTasks` then
returns). The test retries after a short sleep, bounded by a deadline; that is waiting for the dawn,
not a failure.

## Pass criteria (every one must hold)

The public view is read from `GET /api/public/gardens/e2e`, which may be up to two seconds old, so
each read polls until its condition holds or ten seconds pass; a condition still false then fails.

After step 1 (before any island):
- `contract` is `"garden-v1"`; `state` is `"waiting-for-island"`; `clock` is
  `{step: 0, verifiedStep: 0, releasedStep: D, horizonStep: 4D, daysDone: 0, daysTotal: 4}`;
  `tip`, `fork` and `census` are `null`; `verification.share` is `null`.
- L1 answers 201 with `status "waiting"`, `day 0`, `landsAtStep D`; `letters.queued` is 1 and
  `letters.nextLanding.day` is 1 (day 0 is full).

After step 2:
- `clock.daysDone` 1, `clock.step` D, `clock.verifiedStep` 0, `tip.day` 0 with `tip.verified`
  false, `fork` `null`; `census` non-null with `conservationOk` true.
- L1 is `"landed"` with `landedIn` equal to `tip.digest`; L2 is `"waiting"` on day 1 at 2D; L3 is
  `"waiting"` on day 2 at 3D.
- A fourth letter answers 429 with a `Retry-After` header and a `retryAfterMs` integer (the
  limit is 3 per address per hour; all of the test's posts come from loopback).
- `GET /api/public/gardens/e2e/checkpoints/<tip.digest>` is 404: day 0 is done, not verified.

After step 3:
- `verification` `{daysDone: 1, daysVerified: 1, bySameDeviceType: 1, byDifferentDeviceType: 0, share: 1}`;
  `clock.verifiedStep` D; `fork` `{day: 0, step: D, digest: days[day 0].digest}`; L1 is `"verified"`.
- The fork checkpoint (`fork.checkpoint`) answers 200 and its bytes decode (`decodeArtifact`) to a
  state at step D whose `artifactDigest` is `fork.digest`.

After step 4:
- Dropping L3 answers 200 with `status "dropped"`; dropping L1 answers 409 (its day was assigned).
- Day 1's uploaded `manifest.json` (read through the admin file route) lists L3's lesion at 3D:
  the drop happened after day 1 was assigned, so the case is not vacuous.

After step 5 (three days run and replayed):
- `clock` `{step: 3D, verifiedStep: 3D, releasedStep: 3D, daysDone: 3}`; `verification`
  `{daysDone: 3, daysVerified: 3, bySameDeviceType: 3, byDifferentDeviceType: 0, diverged: 0, failed: 0, share: 1}`;
  `fork.day` 2 and `fork.digest` equal to `tip.digest`; every `days[]` entry for days 0 to 2 is
  `"verified"` with `verification "same-device-type"`.
- `days[]` letters: day 0 `[ltr-1]`, day 1 `[ltr-2]`, day 2 `[]`. Letters: L1 and L2 `"verified"`
  with `landedIn` their day's digest; L3 `"dropped"`; `letters.queued` 0.
- `tending.islandsToday` 2 and `tending.deviceTypesEver` 1.
- Pacing: once `pace.releaseDue` is true, `clock.releasedStep` is still 3D and `state` is
  `"waiting-for-island"` (a garden nobody asks releases nothing), and `pace.nextReleaseAt` is the
  first dawn after day 2's `releasedAt`. Over the whole test, released days never exceed one plus
  the dawns elapsed since `createdAt`.

After step 6:
- The view's `clock`, `verification`, `fork` and letter statuses equal those read before the
  restart.

After step 7:
- `tools/stitch.ts` exits 0 and writes one bundle, steps (0, 3D].
- The stitched `spec.interventions` is exactly `[F, L1, L2]` with L1 and L2 as lesions at D and 2D
  with their posted `x`, `y`, `r`; L3 is absent. `interventions.jsonl` has three lines at steps
  0, D and 2D, and the manifest's `interventions.applied` is 3. These equal the letters the
  public view shows as verified, plus the founding.
- The stitched `summary.finalHash` equals `fork.digest` and the unsegmented `tools/run.ts` run's
  `finalHash`, and every file in `VERIFIED_FILES` is byte-identical between the two bundles.

The test prints `uptime` first and its wall time last, exits 0 only if every check passed, and
kills its coordinator and removes its scratch directories however it exits. A run that times out
is rerun once alone before it counts as a failure.

## Not covered here

- The `different-device-type` branch: neither this test nor `bin/garden-dev`'s headless islands
  exercise it (both islands report the same adapter description). One machine can reach it, with a
  browser island beside a headless one (see the amendments). The coordinator's ExUnit garden tests
  cover it with adapter labels.
- The garden island token: `runIsland`'s join body has no `gardenToken` field, so a headless or
  browser island cannot tend a garden whose coordinator sets `BL_GARDEN_ISLAND_TOKEN`.
  `bin/garden-dev` leaves the token unset. Adding the field is a runner change outside this slice.
  (Since slice 15 the client sends it, and this test runs with the token set: see the amendment
  "2026-10-18: slice 15, the garden token and the fork's first read".)
- The page against a live coordinator in Playwright: the public-garden spec stays hermetic (route
  interception). `bin/garden-dev` is how a person looks at the page on a live garden.

## Amendments

### 2026-10-17: the pacing check after step 5 does not assume day 3 stays unreleased

Found while reading the release path, before the test was written. The coordinator releases a
day at the top of every `POST /api/next` (`release_gardens`), and a day counts as finished for the
release rule once it is `"done"`, not only `"verified"`. So when B asks for day 2's replay, day 2
is already done and, if a dawn (one second) has passed since day 2's release, day 3 is released on
that same request, before B is handed the replay. Whether that happens depends on how long A's run
of day 2 took, so a check that `clock.releasedStep` is still 3D, or that `pace.nextReleaseAt` is
the first dawn after day 2's release, would pass or fail by timing.

The check is replaced by the claim it was meant to test, "a garden nobody asks releases nothing":

- After B's last request, read the view and record `clock.releasedStep` as R (3D or 4D).
- Make no `POST /api/next` for at least two dawn periods, then read again: `clock.releasedStep`
  is still R and `state` is `"waiting-for-island"` (either day 3's release is due and nobody has
  asked, or day 3 is released and nobody has taken it).
- Only when R is 3D: `pace.releaseDue` is true and `pace.nextReleaseAt` is the first dawn after
  day 2's `releasedAt`. When R is 4D, day 3 is `"waiting"` in `days[]` with a `releasedAt`, and
  `pace.nextReleaseAt` is `null` (the newest released day is not done).

The invariant check (released days never exceed one plus the dawns elapsed since `createdAt`) is
unchanged. The step-5 `clock` check therefore reads `{step: 3D, verifiedStep: 3D, daysDone: 3}`
with `releasedStep` R.

### 2026-10-17: the fork checkpoint read polls, as the view reads do

Found on the first run of the test (every other check passed). The checkpoint route's lookup of
servable digests is cached for the same two seconds as the view
(`LetterLimiter.fetch_checkpoints`), and step 2's 404 read for day 0's unverified digest had just
filled that cache with an empty set. So right after step 3 the view already names the fork while
its checkpoint still answers 404, for up to the cache age. The step 3 checkpoint read now polls
for up to ten seconds, like every view read; the criterion (200, decodes to step D, digest equal to
`fork.digest`) is unchanged, and the test prints how long the 200 took. A page that follows a
fresh `fork.checkpoint` can meet the same 404 for up to two seconds; that is the coordinator's
cache, outside this slice, and is reported rather than changed.

### 2026-10-17: a check added after the restart

After step 6, the fork checkpoint (day 2's, at 3D) must still answer 200 and decode to a state at
step 3D whose artifact digest is `fork.digest` (polled like the step 3 read). The route needs the
garden's world from the letter limiter, which the limiter loads when it starts; this checks that a
restarted coordinator still serves the fork. An added check, so no earlier criterion is weakened.

### 2026-10-17: after review (three reviewers and Codex Sol 6.1)

Corrections, and checks added; no earlier criterion is weakened.

- **The device type is the adapter description.** `Garden.verification_kind` compares the adapter
  strings the producer and the verifier reported at join. A second computer with the same GPU
  stays `same-device-type`; a browser island (`/island.html`, adapter `<engine> <GPU>`) replaying a
  headless island's day (adapter `wgpu <GPU>`) on this one machine counts as
  `different-device-type`. The sizing and "Not covered here" sections said one machine cannot
  produce it; they are corrected above.
- **A poll that times out fails.** "A condition still false then fails" was the rule, but the code
  returned the last (stale) read and let the next check decide. `viewWhen` now throws, naming the
  condition, so no check runs on a read that never reached it.
- **Pacing release by release.** Added to the invariant read on every view: for each pair of
  consecutive released days, day d + 1's `releasedAt` falls in a later dawn period than day d's
  (`Garden.maybe_release/3`), and is not before day d's `doneAt`. The aggregate bound (released
  days at most one plus the dawns since `createdAt`) stays.
- **Mid-run honesty numbers.** After step 4 (day 1 run, not replayed): `clock` `{step: 2D,
  verifiedStep: D}`, `verification` `{daysDone: 2, daysVerified: 1, bySameDeviceType: 1,
  byDifferentDeviceType: 0, diverged: 0, failed: 0, share: 0.5}`, `tip` day 1 unverified, `fork`
  day 0, L2 `"landed"` in day 1's digest, L1 `"verified"`.
- **The verified prefix as a prefix.** Also after step 4, `tools/stitch.ts` exports one bundle of
  D steps whose `spec.interventions` is exactly `[F, L1]` (`interventions.applied` 2): L2 landed in
  day 1, which is done and not verified, and is not exported.
- **Durability of the release record.** The step 6 comparison also covers every `days[]` entry's
  day, status, `releasedAt`, `doneAt`, `verifiedAt` and digest. No island takes a day after the
  restart (that would cost a GPU day on a loaded machine); this comparison stands in for it.
- **The letter window.** The limiter counts in fixed windows of the wall clock (one hour), not a
  sliding hour. If less than three minutes are left in the current window before L1, the test
  waits for the next one, and the 429 check also requires that L1 and the fourth post fell in the
  same window, saying "rolled over, rerun" if not.
- **Isolation.** The coordinator gets none of the caller's `BL_*` variables (an admin token would
  401 the founding, a garden island token would starve the islands, a forwarded-for setting would
  change the letter limit's keys), and `BL_DISCOVERY_DATA_DIR` is in the test's other scratch
  directory (discovery refuses one inside the queue's). The port is one the OS reports free unless `BL_E2E_PORT` names one; the test refuses
  to start (and to restart) when something already answers there, fails as soon as its own server
  exits, and checks with `lsof` that the listener is its own process before founding anything.
- **Exits.** The GPU and the scratch directories are acquired inside the protected run. SIGINT,
  SIGTERM and SIGHUP stop the coordinator (SIGTERM to its process tree, SIGKILL after 20 s) and any
  running `tools/` subprocess, then remove the scratch directories. When a check fails, the
  directories are kept and their paths printed, so the coordinator log and both bundles are there
  to read; "removes its scratch directories however it exits" now holds for a passing run and for a
  signal only.
- **`bin/garden-dev`** gets the same `BL_*` isolation, a lock directory in the data directory (two
  launchers never run coordinators on one garden's state), the lab port checked before anything
  starts, the listener checked to be its own coordinator, SIGHUP handled like SIGINT and SIGTERM
  with SIGKILL after 20 s, integers without leading zeros, and a re-tended garden's own world in the
  printed commands. `tests/deno/garden_dev_smoke.ts` checks these without the GPU.

### 2026-10-17: after a second Codex Sol 6.1 review

Checks added and gaps closed; no earlier criterion is weakened.

- **Each day's own record.** Read on every view, beside pacing: a `done` or `verified` day carries an
  integer `doneAt` no earlier than its `releasedAt`, a `verified` one an integer `verifiedAt` no
  earlier than its `doneAt` (a `done` one `verifiedAt` null), and a `waiting` or `growing` day carries
  neither (the test already rejects `diverged` and `failed`).
  The release-by-release check now fails, rather than skips, a predecessor with no `doneAt` (no day
  is redone here). Step 2 also requires `clock.lastMovedAt` to be day 0's `doneAt` and day 0's
  `verifiedAt` null; step 5 requires `lastMovedAt` to be day 2's `doneAt`. Before this, a
  coordinator that never recorded completion left those fields null and passed.
- **Bounded waits.** Every request to the coordinator (body included) times out after 30 s, and
  each island call gets the work deadline as its abort signal, so a coordinator that accepts and
  never answers fails the run instead of hanging it. (Corrected after the third review: the
  island's signal is checked between tasks and while idle only; see below.)
- **`lsof` is required.** Without it the listener check now fails instead of passing unchecked; the
  launcher refuses to start without it, and the smoke's "port free" checks throw.
- **Signals.** A signal while the e2e probes the port no longer lets a coordinator start after the
  cleanup ran; the coordinator is registered for cleanup as it is spawned. The smoke test stops
  its launchers on its own SIGINT, SIGTERM and SIGHUP.
- **`bin/garden-dev`.** A lock with no pid is refused, never taken over (its launcher may be alive
  between `mkdir` and writing its pid). The trade-off: a launcher SIGKILLed in that instant leaves
  a named directory refused until its lock is removed by hand (the message names the path). An automatic directory is renamed while the lock is still
  held, then removed, so a launcher that names that path gets a fresh directory. A second signal
  during the stop is ignored; the stop says so when it starts, and the smoke test sends a second
  SIGTERM then and requires a clean exit 143.
- **Runtime.** "Under a minute" is the usual run; the letter-window wait can add up to three
  minutes near the top of an hour.

### 2026-10-17: after a third Codex Sol 6.1 review

Checks added and gaps closed; no earlier criterion is weakened.

- **Stale-lock takeover, one launcher at a time.** Two launchers that both found a dead lock could
  each remove it and both start. Now the taker holds a second lock directory
  (`.garden-dev.lock-recovery`), reads the record again under it, refuses if it is empty, malformed
  or names a live process, and only then replaces the lock and releases the second one. A launcher
  killed while it holds the second lock leaves it to be removed by hand (the message names it). The
  pid record is written whole (a temporary file renamed over it).
- **Removing an automatic directory.** It is moved into a directory `mktemp -d` has just created
  beside it, and that directory is removed; before, a pre-existing `<dir>.removing.<pid>` (someone
  else's directory) would have received it and been removed with it. If either step fails, the
  directory and its lock stay and the launcher says it could not remove it.
- **Ownership after boot.** Something has just answered on the port, so an empty `lsof` answer
  means it could not look: the launcher now fails there instead of accepting. The smoke's port
  check throws on any `lsof` failure other than its silent "nothing found".
- **The fork's step.** Steps 4, 5 and 6 require `fork.step` to equal `clock.verifiedStep` (D, 3D,
  3D after the restart); before, a fork that named the right day and digest at the wrong step passed.
- **Bounded, honestly.** `runIsland` checks its abort signal between tasks and while idle; its
  requests and GPU work do not take it, and `packages/runner` is outside this slice. So an island
  call still running 30 s past its deadline now fails the run: the cleanup stops the coordinator and
  the process exits, ending the stuck call with it. The call itself is not cancelled. `tools/stitch.ts`
  and `tools/run.ts` get ten minutes each, then SIGKILL and a failed check.
- **The smoke harness.** A signal's cleanup is awaited by the main flow, so its exit code stands and
  its cleanup finishes; no launcher starts once it began. A launcher that has not exited a minute
  after SIGTERM has its whole process tree killed and fails the smoke, and the scratch directory is
  kept (and printed) if anything is still running. The second-signal case stops the coordinator
  (SIGSTOP) first, so the cleanup is still waiting on it when the second SIGTERM lands, and requires
  the launcher to be alive half a second after it; the coordinator is continued afterwards.
- **Wording.** The stop takes "about 20 s at most" (twenty one-second waits plus the work between
  them), not a strict 20 s.

### 2026-10-17: after a fourth Codex Sol 6.1 review

Checks added and gaps closed; no earlier criterion is weakened. The third amendment's takeover lock is
withdrawn, as below.

- **No lock takeover.** The second lock directory did not make takeover safe: a taker could still
  decide from a record read before its owner added the coordinator's pid, or remove a lock a fresh
  launcher had just made. Each fix had opened the next race, so `bin/garden-dev` no longer takes
  over a lock at all. A lock it did not create is refused, with the pids it records and whether
  each still runs, and is removed by hand when no launcher uses the directory. A launcher removes
  its own lock on every exit but SIGKILL.
- **An automatic directory is removed only under its own lock.** One this launcher never locked is
  kept and printed.
- **`lsof` is checked everywhere in the launcher.** Every port check accepts only success (pids) or
  lsof's silent "nothing found". Any other answer at the preflight stops the launcher before
  anything starts; after boot (when the coordinator, and the lab, are already running) it stops
  the launcher before the garden is founded.
- **The smoke's orphans.** Each launcher's process tree is recorded once it is up; after the
  launcher exits, any of those processes still running is killed and fails the smoke. The scratch
  directory is kept (and printed) only if something still runs after that SIGKILL. The per-signal
  checks look at that tree as well as the listener.
- **The second signal.** With the coordinator held (SIGSTOP), the launcher must still be running
  three seconds after the second SIGTERM, by its raw exit status rather than its drained output; a
  trap that only deferred the signal until the cleanup's `sleep 1` returned would usually be gone by
  then. That check alone is a heuristic (a foreground command slower than three seconds under load
  would also hold a deferred signal), but together with the named directory's lock check and the
  orphan check it caught the mutation: with `trap '' 1 2 15` removed, the smoke fails all three.
- **The island budget.** `BL_E2E_WORK_MS` (default 120,000) raises the per-step island budget on a
  machine slow enough to need it; the watchdog stays that budget plus 30 s.

### 2026-10-18: after a fifth Codex Sol 6.1 review

- **Signals while a process starts.** A signal between starting a process (`&`) and recording its
  pid (`$!`) left the cleanup without that pid: it could release the lock, or remove an automatic
  directory, under a coordinator still running. `bin/garden-dev` now holds SIGINT, SIGTERM and SIGHUP
  across each start and its recording (coordinator, lab, each island) and across taking the lock,
  and acts on a held one right after; so every exit but SIGKILL releases the lock with every
  process recorded.
- **The smoke records processes by identity.** A recorded process is its pid and its start time
  (`ps -o lstart`); liveness is read with `ps` (a zombie is not running), and nothing is signalled
  unless the pid still has the recorded start time, so a pid reused by an unrelated process is not
  SIGSTOPped, continued or killed unless it was reused within the same second (`lstart` has
  whole seconds). The old liveness probe sent SIGCONT. On a launcher that does not stop within a
  minute, its tree is looked up again only while its own exit is unreaped and its spawn-time
  identity still matches, checked both before and after the walk; the tree recorded when a
  launcher is up is taken the same way (amended after the sixth and seventh reviews).
- **Left as is (sixth review, P2):** a Ctrl-C to the whole process group that kills the `mkdir` of
  the lock after it made the directory but before it exited leaves that lock behind; the launcher
  then refuses with "pids: none recorded" and the lock's path, to remove by hand. Nothing is lost,
  and the window is the few milliseconds `mkdir` runs.
- **Left as is:** the three-second second-signal check stays a heuristic, as the fourth amendment
  now says; the mutation it targets is caught by the three checks together.

### 2026-10-18: slice 15, the garden token and the fork's first read

Slice 15 (`docs/garden-hardening-2026-10-18.md`, its rules written before its code) changes three
things this test checks; every criterion above still holds.

- **The token is set.** The coordinator now gets `BL_GARDEN_ISLAND_TOKEN`, a fixed per-run test value
  set after the `BL_*` scrub (the restart reuses it), and islands A and B join with it in their join
  body (`IslandOptions.gardenToken`). `tending.islandsToday` at step 5 stays 2.
- **Island C (new, step 1b).** Right after step 1, while day 0 is released and unassigned, a third
  island joins without the token and asks once (`maxTasks` 1): it takes no task, and day 0 is still
  waiting and `releasedStep` still D. That a tokenless island still gets ordinary work is pinned by
  ExUnit (`garden_queue_test.exs`, "without one, any island may; an ordinary experiment is never
  gated") and is not spent on the GPU here.
- **The fork is served on the first read.** A day becoming verified now invalidates the garden's
  cache from the queue (`Queue.record_garden_day/3`), so the polling added by the amendment "the
  fork checkpoint read polls" is removed: at step 3 and at step 6 the first read of
  `fork.checkpoint` must be 200 (and decode as before). The view reads still poll, since a day that
  is only done may be up to two seconds behind in the view.
