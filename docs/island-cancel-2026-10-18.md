# Island cancellation: rules written before the code (2026-10-18)

Slice 21 of the backlog run closes a finding of slice 9 (`docs/garden-local-2026-10-17.md`,
"Bounded, honestly"): `runIsland` checks its abort signal only between tasks and while idle, so its
requests and its GPU work cannot be cancelled from outside. A headless island on Ctrl-C, or the
browser island page's Stop, can leave a request or a GPU segment running, and tests have to kill
processes. This note fixes what abort means before any code is written. It adds no physics, no
contract key, no golden pin, no route and no coordinator change. A change to the rules below is a
dated amendment at the end, never a silent edit.

## What the coordinator offers

- Every task carries a lease. An island keeps it alive with heartbeats; `Segment.reclaim` (run on
  each `POST /api/next`) expires an attempt whose heartbeat is older than `lease_ms` (10 minutes by
  default, `Coordinator.Queue.lease_ms/0`): a run attempt becomes `"abandoned"` and the segment goes
  back to `"pending"`; a verify attempt becomes `"abandoned"` and the segment stays `"done"`, to be
  verified later. Uploads belong to the attempt that made them: the next assignee must upload its
  own before it completes. Nothing an attempt uploaded is a result until its `complete` is accepted.
- `reject` says the predecessor's artifact is bad (the coordinator recomputes the predecessor);
  `fail` says the task cannot run as given (terminal, blocks the run). Neither is a way to give a
  task back, and the README offers no other. So a stopped island gives a task back by saying
  nothing: it stops heartbeating and lets the lease lapse.
- `lease_ms` has no runtime setting (`config/runtime.exs` reads no variable for it), so a dev
  coordinator cannot be started with a short lease without a coordinator change.

## Rules

**The signal.** `IslandOptions.signal?: AbortSignal` (the key already exists) is honoured in every
phase below. `RunOptions.signal?: AbortSignal` is new and optional; a run without it, or whose
signal never aborts, is byte for byte what it was (same files, same manifest, same digests).

**What abort means, by phase.**

| Phase when the signal aborts | What the island does |
| --- | --- |
| Before the join | Returns 0. No request is made; `onJoined` is not called. |
| During the join | The join request is aborted. Returns 0; `onJoined` is not called. |
| Idle wait, or `POST /api/next` in flight | The wait ends at once; the request is aborted. Returns the tasks completed so far. A task the coordinator assigned in the aborted answer is never seen; its lease lapses. |
| Downloading a start or import checkpoint | The download is aborted. Nothing is posted; the lease lapses. |
| Deciding a `reject` (bad predecessor) | A reject not yet sent is not sent; the next island finds the same defect. |
| During the run | `runExperiment` stops at the next census-chunk boundary (it checks the signal before running each chunk and after each chunk's GPU work finishes, before the readbacks). Its `finally` destroys the simulation's GPU buffers. No upload, no `complete`, no `fail`; the lease lapses. The latency is at most one census chunk of GPU work plus the census in progress. |
| Uploading (checkpoint or file PUTs) | The PUT in flight is aborted and no further PUT or `complete` is made. What was uploaded stays the abandoned attempt's own, never a result; the lease lapses. |
| `POST .../complete` in flight | It is **not** aborted: once sent, the island cannot know whether the coordinator applied it, so it waits for the answer. The task counts as completed if the coordinator accepted it (or is abandoned on a 409, as today). Then the island returns. |
| A `fail` (InterventionError) or `reject` already sent | Not aborted, for the same reason: it is a decision already reported. |

**Never a torn result.** The coordinator applies `complete` atomically (one Queue call), and nothing
before it is a result, so the only rule the island needs is the one above: after abort it sends no
request that changes the coordinator's record (no PUT, no reject, no fail, no complete, no
heartbeat) unless that request had already been sent. Abort never makes the island report anything
about a task it leaves, so the coordinator's record reads "abandoned by lease", not "rejected" or
"failed".

**Heartbeats.** The heartbeat in flight is aborted with the signal and its abort is not logged; the
interval is cleared as before. No heartbeat leaves after abort.

**What the caller sees.** `runIsland` resolves (never rejects) with the number of tasks completed,
whenever the abort lands, and logs one line naming the task it left, if any, and that the
coordinator offers it again once the lease lapses. An error that is not the abort still rejects as
it does today. An abort error seen while the signal is not aborted (a fetch aborted by something
else) is not swallowed.

**Headless island (`tools/island.ts`).** The first SIGINT or SIGTERM aborts the island and prints
that a second one quits at once. When `runIsland` returns, the island destroys its GPU device,
prints the tasks it finished and exits 130 (SIGINT) or 143 (SIGTERM). A second signal exits at once
with the same code. With no signal the exit is unchanged (0 after `--tasks` or idle). SIGTERM
listening is skipped where Deno does not offer it (Windows).

**Browser island page.** The page already threads its Stop `AbortController` into `runIsland`; with
the rules above Stop now ends the current task at the next chunk instead of after it. The page
destroys the attempt's GPU device when `runIsland` returns, so Join/Stop cycles do not pile up
devices. Stop's message says the current task is left for the coordinator to offer again after its
lease lapses.

## Checks

- vitest, fake coordinator (a `fetch` stub that honours `init.signal` and can hold a request open)
  and a fake GPU simulation (the RefSim-backed stand-in of `interventions.test.ts`): abort before
  join, during `/next`, mid-run between chunks (the run stops at the next chunk boundary, the
  simulation is destroyed, nothing is uploaded or posted), during a checkpoint upload, and racing a
  completion (the completion stands and counts); heartbeats stop; an unaborted control completes.
- Deno, native WebGPU (`tests/deno/island_cancel.ts`): an island aborted mid-run against an
  in-process fake coordinator with a one-second lease leaves no upload and no completion and
  returns promptly; a second island on the same device is offered the same segment once the lease
  lapses, completes it, and reports the digest a direct unaborted run of the same spec gives; and
  `tools/island.ts`, spawned against the same fake and sent SIGINT mid-run, uploads and completes
  nothing and exits 130. A fake,
  because the real coordinator's lease cannot be shortened without a coordinator change (above);
  the real reclaim path is covered by `apps/coordinator/test/coordinator/queue_test.exs`.

## Follow-ups outside this slice

- Coordinator: a `POST /api/segments/:id/release` under the lease (give a task back at once, the
  attempt marked `"abandoned"`), so a stopped island's segment is not idle for up to `lease_ms`; and
  a `BL_LEASE_MS` runtime setting for dev and tests.
- `apps/lab/island.html`: "Press Stop or close the tab to stop taking new work" could say that Stop
  also ends the current task.

## Amendment 2026-10-18 (review)

Four review passes (three lenses and Codex Sol 6.1) found no torn result; these rules change or are made explicit.

- **Checked after every callback.** A `reject` or `fail` was checked against the signal before its log line, and the
  caller's log callback can itself stop the island (the page's Stop runs on any event). Each request that changes the
  coordinator's record is now checked immediately before it is sent, after any log line: a stop requested from inside
  the "rejecting" or "cannot apply the schedule" line sends no `reject` or `fail`.
- **A `/next` answered as the abort lands.** The table above says such a task "is never seen". That holds when the
  request itself is aborted; when the answer was already read, the island logs the task (`run … #n`), the run stops
  before building anything, and it logs that it left the task. Either way nothing is written and the lease lapses.
- **A garden join whose answer body is still arriving.** Reading the body is now outside the parse that withholds a
  bad answer, so an abort while the body arrives is recognised as a stop (resolves 0) instead of being reported as a
  malformed answer. A read error quotes nothing of the body.
- **Stop's message is phase-neutral** (`STOP_MESSAGE` in `packages/runner/src/island.ts`, used by the page and by
  `tools/island.ts`): Stop may land while idle, with no task in hand, or while a `complete` is in flight, whose task then
  counts. runIsland's own log line says which happened.
- **`tools/island.ts` startup is inside the guarded lifecycle.** A signal during adapter or device acquisition followed
  by that acquisition failing still removes the listeners and exits 130 or 143. When runIsland throws while stopping,
  the tool prints the error and no task count (the count is unknown there).
- **The page's device** is destroyed whatever ends the attempt, from its creation on (not only when runIsland returns).

Costs accepted, not changed:

- **A join answered as the abort lands** registers an island the caller never learns of (`onJoined` is not called; the
  page would drop the identity anyway, since its `onJoined` saves nothing once Stop aborted). The row idles until the
  coordinator prunes it (`Coordinator.Queue`: `:max_islands`, forgotten after `:island_prune_after_ms`, or after
  `:island_prune_grace_ms` under pressure), the same as a tab closed mid-join. Removing it at once needs a coordinator
  route (below).
- **A `complete`, `reject` or `fail` already sent has no bound.** A coordinator that never answers leaves the page in
  "Stopping…" until a reload, and the headless island until a second signal. Bounding it would let the island return
  without knowing the outcome, which the lease already handles, but changes the count the caller sees; left for the
  coordinator follow-up.

Checks added for these (beyond the Checks above):

- vitest: a verify task aborted mid-run, and after the run's last readback (while its digests are computed); an abort as
  the last file PUT is answered (no `complete`); stops requested from inside the "rejecting" and "cannot apply the
  schedule" log lines (no `reject`, no `fail`, with a control that does fail); a `/next` answered as the abort lands;
  aborts during a census's readbacks and the last census's (no further chunk, no final `readState`); custom abort
  reasons (a string, a `TimeoutError`); the idle wait with a long `idleMs`; a garden join whose body is aborted after
  its headers; the page's Stop message. Each was checked against a copy with the matching fix reverted.
- Deno: no progress line after the abort (the proof that the run itself stopped, not only that nothing was uploaded),
  and a fourth part: `tools/island.ts` with its `complete` held open keeps waiting after one SIGTERM and exits 143 at
  once on a second. The spec is now 1000 steps (was 4000); the child runs with `--no-lock`, its stderr is drained
  alongside stdout, and the time guard kills it.
- Not tested: a signal during GPU startup followed by a failed startup (needs a GPU mock in Deno; fixed by reading),
  and the lab page's `device.destroy()` wiring (needs a DOM).

A second Codex pass (Sol 6.1, xhigh) found no torn result and no P0 or P1; its five P2s are fixed:

- **An abort reason of `NaN`** was not recognised as the stop (`NaN !== NaN`), so runIsland rejected instead of
  resolving. The comparison is now `Object.is`; a vitest covers `NaN` mid-run and during `/next`.
- **The verify digest race was not tested.** The earlier test aborted in the final `readState`, before hashing began,
  so a guard moved ahead of the digest await would still pass. A new test aborts inside the first SHA-256 of
  `observationDigests` and asserts no `complete`.
- **Deno part 3 could fail correct code on a loaded machine.** If the parent is descheduled after the first progress
  line, the signal can land after the child's run has ended, and its upload and complete are then correct. The check
  now reads where the child's own "SIGINT: stopping" line falls among its progress lines: after its last one (t=1000)
  the mid-run checks are reported as skipped (part 1 covers that stop in process); otherwise at most one progress line
  may follow it, and nothing may be uploaded or completed. The exit code (130) is checked either way.
- **Deno part 4 could coalesce the two SIGTERMs.** The second is now sent only after the child prints its
  "SIGTERM: stopping" line for the first.
- **`uptime`** is best effort, so the check does not fail at its last line where the command is missing.

A third Codex pass (Sol 6.1, xhigh) confirmed those five fixes and found no P0 or P1. Its two P2s and one P3 are fixed:

- **An unrelated `AbortError` was swallowed after Stop.** The stop test accepted any error named `AbortError` once
  the signal had aborted, so a GPU readback failing with one as Stop landed (a lost device) resolved as a stop. A stop
  is now recognised by identity with the signal's reason only. A fetch or body read that the signal aborted, and that
  rejects with a new `AbortError` instead of the reason (not every engine rethrows it), is mapped to the reason where
  the request is made (the join and every coordinator call that carries the signal; a complete, reject or fail is sent
  without it, so an `AbortError` from one still rejects); an engine without `AbortSignal.reason` (none that has
  WebGPU) keeps the name match. Vitests: a GPU `AbortError` as the stop lands rejects with that error; a fetch that
  rejects with a new `AbortError` under a custom reason is still the stop, at the join, `/next` and the upload; an
  `AbortError` from the complete as the stop lands rejects.
- **An explicit `null` reason was replaced** by a new `AbortError` (`reason ?? ...`) in the runner and the island, so
  `runExperiment` did not reject with the signal's reason as documented. Both now throw the reason as it is. Vitests:
  `runExperiment` rejects with `null`, `"x"` and `0`; runIsland resolves for `abort(null)` mid-run and during `/next`.
- **Deno part 4 left a child that ignores SIGTERM to the 15-minute guard.** If the first signal is not acknowledged in
  60 s, or the second does not end the child in 5 s, the child is now killed and reaped there, within a bound, and
  the held complete is released.

Further follow-ups outside this slice: a coordinator `DELETE /api/islands/:id` (or leave on release) so a stopped
island's row goes at once; and `apps/lab/island.html`'s static copy (above).

## Amendment 2026-10-24: runtime task lease

The runtime-setting follow-up is implemented: `BL_LEASE_MS` configures the normal
island run/verify lease at coordinator startup. Unset/blank keeps the ten-minute
default; supplied values must be positive whole milliseconds. This supersedes
the historical no-runtime-setting statement above. Reclamation and cancellation
semantics are unchanged; the separate immediate release route remains outside
this slice. See [design and validation](island-lease-config-2026-10-24.md).
