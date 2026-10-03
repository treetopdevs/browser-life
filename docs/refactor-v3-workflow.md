# Workflow: artifact/coordinator/pre-registration refactor (v3)

*Plan only — no code changes yet. Written against branch `refactor/artifacts-v3`, base commit `68f2336`.*

## Why

Five external review rounds kept finding bugs in the same three structural places:

1. **Checkpoint/observer split.** `packages/schema/src/checkpoint.ts` encodes only the physics
   state (`WorldState`). Observer state (tracker, activity, counters, settings, `prevSym`) is a
   second, separately-serialized JSON file (`observer.json`) with its own upload
   (`apps/lab/src/sim.worker.ts` / `packages/runner/src/island.ts`), its own digest
   (`bytesDigest` in `packages/runner/src/runner.ts`, `observer_hash` plumbed through
   `apps/coordinator/lib/coordinator/queue.ex` and `api_controller.ex`), and its own ad hoc
   semantic check (`continuationError` in `runner.ts`). Two artifacts, two digests, two loaders,
   two places for the checks to drift apart — which is exactly what kept happening.
2. **Coordinator segment state.** `Coordinator.Queue` (666 lines) mixes queue bookkeeping, upload
   staging, and segment-status transitions inline in `handle_call` clauses, with no single table
   of legal transitions. Reviewers keep re-finding the same handful of edge cases (stale leases,
   double-reject, verify-vs-run completion) because there's no one place that enumerates them.
3. **Pre-registration drift.** `experiments/preregistration.md` is hand-written prose;
   `tools/analyze.ts` is a hand-written implementation of "the same" tests. Nothing enforces they
   agree, and the ecological-closure coexistence endpoint (≥2, and ≥3 for the M5 gate, roles
   coexisting continuously) isn't implemented at all — `analyze.ts` currently checks biotic vs.
   replenished recycling only, not coexistence duration.

Plus three small, independently-fixable bugs from review round 5 (item **D** below).

## Non-goals / invariants

- `RULE_VERSION` stays `1`. No physics change. Pinned hashes in
  `packages/sim-ref/test/golden-hashes.test.ts` must not move.
- `stateHash` (`packages/schema/src/accounting.ts`) keeps its current meaning: canonical digest of
  `(config, step, ledger, cells, canonical genome)`. It is not touched by this refactor; a second,
  clearly-scoped **artifact digest** is added alongside it (see Part 1).
- Old coordinator dev data (`apps/coordinator/data`, currently running on `:4000` — **do not
  touch that directory or stop that server**) is allowed to simply stop working after the schema
  bump. This is pre-launch infrastructure; there is no production data to migrate.

## Ordering and concurrency

```
        ┌─────────────────────────┐
        │  D1. sim.worker.ts      │  save/restore provenance fix — lands FIRST, A builds on it
        │  save/restore fork      │
        └────────────┬────────────┘
                      │
                      ▼
        ┌─────────────────────────┐        ┌─────────────────────────┐
        │  A. TS artifact side    │───────▶│  B. Elixir coordinator  │
        │  (schema, runner,       │  digest │  (content-addressed     │
        │  lab observer state)    │  format │  store, attempts;       │
        │                         │  frozen │  fixture regen is B's   │
        │                         │         │  first step, not A's)   │
        └─────────────────────────┘         └─────────────────────────┘
                    │
                    │ (no file overlap)
                    ▼
        ┌─────────────────────────┐
        │  C. pre-registration    │  independent of A/B — can run concurrently with A
        │  as data                │
        └─────────────────────────┘

        ┌─────────────────────────┐
        │  D2/D3. main.ts,        │  independent of everything above — land whenever
        │  island.ts idle wait    │
        └─────────────────────────┘
```

- **A and C touch disjoint files** (A: `packages/schema`, `packages/runner`, `apps/lab`; C:
  `experiments/`, `tools/analyze.ts`, plus a new `experiments/endpoints.ts`) — they can be built
  in parallel by two agents/sessions.
- **B depends on A's frozen format, but A does not hand B a regenerated fixture or updated
  coordinator tests** (see Part A's Tests section) — B regenerates
  `tools/fixtures/coordinator-checkpoint.ts`'s output and updates the pinned Elixir values itself,
  in the same commit as its `Coordinator.Checkpoint` v3 port, so `mix precommit` is only ever
  green against a decoder and fixture that agree. B's queue/store/attempt refactor (content
  addressing, pure transition functions) has no dependency on A's format and can be built and
  tested against the *current* v2 checkpoint shape in parallel; only the final `Checkpoint`-module
  port and fixture swap need A finished first.
- **D1 (`sim.worker.ts` save/restore) must land before A**, since A's item 6 (lab observer
  state) touches the same functions — doing D1 first avoids two changes editing the same
  save/restore logic out of order. **D2 (`main.ts`) and D3 (`island.ts` idle wait) have zero
  dependency on A/B/C** and can land whenever, independently.

Each part ends with: run its checks (below) → **Codex Sol 6.1 High read-only review**
(`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C /Users/nicholas/develop/browser-life ... < /dev/null`,
background, per the standing review policy) → address findings → commit.

## Part A — TS artifact unification

**Owns:** `packages/schema/src/{checkpoint.ts,accounting.ts,world.ts,config.ts}`,
`packages/runner/src/runner.ts`, `packages/runner/src/island.ts`,
`apps/lab/src/sim.worker.ts` (built on top of D1's save/restore fork fix, not touching D2/D3's
files), `packages/sim-ref/test/golden-hashes.test.ts` (read plus a new fixture, not the pinned hash
values), `tests/deno/segments.ts`. **Not** `tools/fixtures/coordinator-checkpoint.ts` or anything
under `apps/coordinator/` — see the Tests section below for why the fixture regen is B's job.

**Change:**

1. **One artifact.** `encodeCheckpoint(state, observer)` writes a single `Uint8Array` with two
   sections after the existing header: the physics section (today's cells + genome, byte-for-byte
   unchanged) and a new observer section. Observer state is a plain JSON-serializable object
   (tracker `TrackerState`, `ActivityState`, counters, settings, `prevSym`) — encode it as
   length-prefixed UTF-8 JSON (same technique the config section already uses:
   `u32 byteLength` + bytes, word-padded), not a new binary layout. This keeps the codec simple and
   the section trivially portable to Elixir via `Jason.decode/1`, matching how `cfg` is already
   handled in both `checkpoint.ts` and `Coordinator.Checkpoint.sections/3`.
2. **Bump `SCHEMA_VERSION` to 3** (`packages/schema/src/config.ts`). `decodeCheckpoint` keeps
   refusing any other schema version (no silent migration) — same behavior as today, just a new
   number.
3. **One loader, "parse don't validate", for artifact-intrinsic checks.**
   `decodeCheckpoint(bytes): { state: WorldState; observer: ObserverState }` performs every check
   that depends only on the bytes and returns fully-validated data or throws: magic, schema, rule
   version, section bounds/trailing-data, ledger values `< 2^63` (already checked physics-side by
   `validateState` in `world.ts` — no new check needed there, just keep it in the one-loader
   path), plus the observer section's own intrinsic checks: tracker cross-reference integrity
   (already done today inside `Tracker.fromJSON` in `packages/metrics/src/tracker.ts`, not in
   `validIndividual` which only checks one individual's shape — call it from here, don't
   reimplement it), component-label count matching `cellCount(cfg)`, settings shape, counter
   types, `prevSym` decodability. Callers get `{state, observer}` back and never parse raw JSON or
   bytes themselves.

   **`continuationError` is *not* deleted — it is narrowed and kept.** It checks two things
   `decodeCheckpoint` cannot: that the artifact's config matches the *requested run spec*
   (`sameConfig(start.cfg, specConfig(spec))`) and that its observation `settings` match the
   spec's (`censusEvery`/`deepEvery`/`activityThreshold`). Those are run-context checks, not
   artifact-intrinsic ones — an artifact can decode perfectly and still be the wrong artifact for
   this run. Post-refactor, `continuationError(spec, state, observer)` (still in `runner.ts`)
   is called on the already-decoded `{state, observer}` and only performs the two run-compatibility
   checks above (config match, settings match); the checks it currently duplicates from decoding
   (tracker/activity shape, `prevSym` decodability, label count) are removed from it since
   `decodeCheckpoint` now guarantees them. `island.ts` calls `decodeCheckpoint` then
   `continuationError`, in that order; a decode failure and a `continuationError` result are both
   still "reject the predecessor", just via two functions with two different jobs. The in-memory
   `RunOptions.start`/`observer` continuation inside `runExperiment` keeps calling
   `continuationError` too — it never touches raw bytes, but it still needs the run-compatibility
   check.

   Delete the separate `observer.json` read/write/digest call sites in `island.ts` and
   `sim.worker.ts`'s `save`/`restore`/`exportRun` (that part of the original plan stands) — those
   are replaced by the single artifact, not by removing the compatibility check.
4. **Two digests, clearly scoped, both computed by `decodeCheckpoint`'s caller from the *decoded*
   artifact (never re-derived from raw bytes by two different paths):**
   - `stateHash(state)` — unchanged, physics-only, used for `startHash` continuity checks,
     `golden-hashes.test.ts`, and the predecessor-index check in the coordinator.
   - `artifactDigest(state, observer)` (new, in `accounting.ts`) — `digestWords` chained over
     the state's canonical bytes *and* the canonical observer JSON bytes (same length-prefix +
     `digestWords` chaining `stateHash` already uses for the config section — reuse
     `canonicalConfig`'s pattern for the observer section: sort keys via `JSON.stringify` of a
     re-keyed object, since the observer payload is caller-constructed, not user JSON). This one
     digest replaces `endHash` *and* `observer_hash` in the coordinator protocol: run completion,
     replay verification, and the predecessor-start check all compare `artifactDigest`, not two
     separate hashes.
5. Runner (`runner.ts`) exposes `{ finalHash: string /* = artifactDigest */ }` in `RunSummary`
   instead of the current `finalHash` (state-only) + separate observer hash reported at the call
   site in `island.ts`. `island.ts`'s upload sequence becomes: encode once, PUT once, `complete`
   with one digest.
6. **Lab worker: actually produce and restore observer state, not just stop uploading it
   separately.** Today `apps/lab/src/sim.worker.ts`'s `World`/`adopt` has no activity tracker, no
   observation settings and no `prevSym` — `save()` only ever encodes physics
   (`encodeCheckpoint(state)`), and `adopt`/`restore` (re)create a fresh `Tracker` and reset
   mutation counters rather than restoring any prior observer state. This part is wider than "swap
   the call sites": it means adding an in-worker `Tracker`/`ActivityTracker` (matching what
   `runner.ts` already does for headless runs), threading `censusEvery`/`deepEvery`/
   `activityThreshold` settings through `newManifest`/`load`, and having `save`/`restore`/
   `exportRun`/`adopt` carry that state through `encodeCheckpoint`/`decodeCheckpoint`'s observer
   section instead of the physics-only path they use today.

**Files NOT touched by A:** anything under `apps/coordinator/`, `experiments/`, `tools/analyze.ts`.
(A does reach into `apps/lab/src/sim.worker.ts` more deeply than "upload call sites", per item 6
above — the earlier, narrower framing undersold the work.)

**Tests:**
- Extend `packages/sim-ref/test/golden-hashes.test.ts` (or a sibling test) with an
  encode/decode round-trip of `{state, observer}` at the new schema version — golden *hash* values
  for `RULE_VERSION`/physics stay pinned and untouched; only the container format is new.
- Unit tests for `decodeCheckpoint` rejecting each corruption case (bad magic, wrong schema,
  truncated observer section, ledger overflow, dangling `prevIds` reference, bad settings) —
  this is the "parse don't validate" contract's actual test surface.
- `deno run -A tests/deno/segments.ts` updated for the single-artifact upload path.
- `pnpm -s typecheck`, `pnpm -s test`, `pnpm -s test:e2e`.

**A does *not* run or update `apps/coordinator`'s tests.** `tools/fixtures/coordinator-checkpoint.ts`
writes into `apps/coordinator/`, and `apps/coordinator/test/coordinator/checkpoint_test.exs` pins
values against the *current* (v2) `Coordinator.Checkpoint` decoder — regenerating the fixture to
v3 output before B's decoder exists would break `mix precommit` on a codebase that can't parse it
yet. So: A leaves the fixture generator and the coordinator's pinned test values untouched, and
merely defines and freezes the v3 binary layout and digest functions A actually needs (encode,
decode, `stateHash`, `artifactDigest`) as its deliverable. **Regenerating the fixture and updating
the pinned Elixir values is B's first step**, done together with the `Coordinator.Checkpoint` v3
port in one commit, so `mix precommit` is green exactly once, on B's side, immediately after the
port — never on a commit where the two disagree.

**Exit criteria:** a checkpoint round-trips through one encode/decode call with one digest; no
call site outside `packages/schema` parses raw JSON or bytes from an artifact; golden hashes
unchanged; the v3 layout and digest functions are frozen (stable enough for B to port) even though
the coordinator-side fixture/tests are updated in B, not A.

## Part B — Coordinator: content-addressed store + attempts

**Owns:** `apps/coordinator/lib/coordinator/{queue.ex,checkpoint.ex}` (new: `attempt.ex`,
`store.ex`, `segment.ex` or similar — exact module split is an implementation decision, not fixed
here), `apps/coordinator/lib/coordinator_web/controllers/api_controller.ex`,
`apps/coordinator/lib/coordinator_web/router.ex`, `apps/coordinator/test/**`.

**Change:**

1. **Content-addressed store.** Replace `checkpoint_path/2` and `files_dir/2` (segment-id-keyed,
   mutable-by-overwrite paths) with a store keyed by the artifact digest from Part A:
   `data_dir/objects/<digest[0..1]>/<digest>.blck` (two-level fan-out, standard git-style, keeps
   directories small), written once with a rename-from-tmp (already the pattern in
   `with_staged/3`) and never overwritten — a second write of the same digest is a no-op (content
   is already known-identical because the digest is content-derived), not an error. Bundle files
   (`series.jsonl` etc., not content-addressed — they're append/attempt-scoped, not
   deduplicated data) keep a segment/attempt-scoped path.
2. **Attempt records.** Add an explicit record per (segment, island-lease) with: `id` (= the
   lease — `pick_task`'s existing `rand(12)`, not the island's `rand(32)` bearer token; those stay
   two separate things: the token authenticates the island across many tasks, the lease/attempt-id
   identifies one assignment), `kind` (`:run | :verify`), `island`, `assigned_at`,
   `heartbeat_at`, `uploaded_digest` (set on `publish`; **only `:run` attempts upload** — see
   below), `reported_digest` (set on `complete`), `outcome`
   (`:pending | :done | :rejected | :diverged | :abandoned`). A segment's `attempts: [Attempt.t()]`
   replaces today's flat `island`/`lease`/`assigned_at`/`checkpoint_hash`/`observer_hash` fields on
   the segment map, plus its separate `verify: %{...}` sub-map (a verify attempt is now just
   another entry in the same list, tagged `kind: :verify`).

   **Verify attempts don't upload anything, today or in v3.** `runIsland` in
   `packages/runner/src/island.ts` only PUTs a checkpoint and files when `task.kind === "run"`; a
   verifier replays locally and reports the digest it computed. So a verify attempt's
   `reported_digest` is compared against **the segment's accepted run attempt's `uploaded_digest`**
   (`match = end_hash == seg.end_hash and observer_hash == seg.observer_hash` today, becoming
   `match = verify_attempt.reported_digest == run_attempt.uploaded_digest`), not against anything
   the verify attempt itself uploaded — there is nothing to check that against. This is unchanged
   from today's `complete_verify`; the refactor's job is to name it correctly (one comparison, one
   digest, against the *run* attempt), not to invent a verifier upload.
3. **Pure state-transition functions.** Extract `Coordinator.Segment.transition(segment, event) ::
   {:ok, segment} | {:error, reason}` (or similar; a small module of pure functions, unit-testable
   without the `GenServer`) implementing the table below. `Queue`'s `handle_call` clauses become
   thin: validate auth/lease, build the event, call `transition/2`, persist, reply.
4. **State table.** A segment's status and its list of attempts are tracked together; "verify"
   does **not** move the segment out of `done` the way a naive single-status table suggests —
   today a completed run stays `status: "done"` while its verify attempt runs independently
   alongside it (successors can start once a segment is `done`, without waiting for verification),
   and that must not regress:

   | Segment state | Event | Guard | Next state | Notes |
   |---|---|---|---|---|
   | `pending` | assign (run) | predecessor `done`/`verified` or is segment 0 | `assigned` (new `:run` attempt) | predecessor's accepted run attempt's digest becomes this segment's `startFrom`/`startHash` |
   | `assigned` | heartbeat | lease matches the current `:run` attempt | `assigned` | refreshes `heartbeat_at` |
   | `assigned` | lease expired (no heartbeat within `lease_ms`) | — | `pending` | stale-lease reclamation; the `:run` attempt's `outcome` becomes `:abandoned`, segment reassignable |
   | `assigned` | publish (checkpoint/file upload) | lease matches | `assigned` | sets the `:run` attempt's `uploaded_digest` |
   | `assigned` | complete (kind: run) | lease matches, `reported_digest == uploaded_digest` | `done` | segment's accepted digest is now this attempt's; a `:verify` attempt can now be assigned (see below), independently of what happens next in the run |
   | `assigned` | reject (kind: run) | lease matches | `pending` (this segment, `:run` attempt `outcome: :rejected`) **and** predecessor segment reset to `pending` if the rejection reason is a predecessor-artifact defect | invalidates the producing segment, per existing behavior |
   | `done` | assign verify | only for the final segment of a run, or the sampled fraction, by an island that isn't the run attempt's island, no pending/assigned `:verify` attempt already exists | segment stays `done`; a new `:verify` attempt is `assigned` | verification is tracked as an attempt *on* a `done` segment, not a segment-status transition |
   | (verify attempt) `assigned` | heartbeat | lease matches | (unchanged) | |
   | (verify attempt) `assigned` | lease expired | — | verify attempt `outcome: :abandoned`; segment **stays `done`**, re-verifiable later | expiring a verifier must not touch the already-accepted run result |
   | (verify attempt) `assigned` | complete (kind: verify), match | `reported_digest == ` the segment's accepted run-attempt `uploaded_digest` | segment → `verified` | terminal success |
   | (verify attempt) `assigned` | complete (kind: verify), mismatch | digests differ | segment → `diverged`, **and** `block_descendants`: every later segment of the same run — pending, assigned, `done` *and* `verified` alike — is reset and moved to `blocked`, cancelling any of their own in-flight or completed verify attempts | matches `Coordinator.Queue.block_descendants/2` today: a diverged predecessor invalidates everything computed from it, including already-"done"/"verified" descendants, not just not-yet-done ones |
   | `blocked` | admin unblock/requeue | (existing admin policy; no new endpoint proposed here) | `pending` for the unblocked segment, `pending` for its previously-blocked descendants (`unblock_after/2`) | this refactor keeps the existing admin-triggered requeue path as-is; it is not part of the pure `transition/2` table since it is an operator action, not a segment/attempt event |

   This is the same set of guarantees `Queue`'s moduledoc already promises (tokens, leases,
   heartbeats, mandatory final-segment verification, reject path from either runner or verifier,
   divergence blocking that cascades to completed descendants, admin policy, preset/condition
   compatibility, predecessor index, staged-upload cleanup) — the refactor makes the table
   explicit and the functions pure/testable, it does not change the guarantees, and in particular
   it must not accidentally *narrow* `block_descendants`' cascade the way an earlier draft of this
   table did.
5. **Checkpoint/digest port.** `Coordinator.Checkpoint` gains the observer-section parse (mirrors
   Part A's TS decoder: same bounds checks, same `< 2^63` ledger check it already has, plus the
   observer section's own bounds/JSON-parse checks) and `artifact_digest/1` alongside (replacing)
   `state_digest/1` + `bytes_digest/1`. `put_checkpoint` stays the endpoint for the single
   physics+observer artifact; **`put_file`/`get_file` are kept as the generic bundle-file
   endpoints** (`series.jsonl`, `mutations.tsv`, `lineages.tsv`, `life.jsonl`, `heredity.tsv` — the
   files `runner.ts`'s `Sink` writes and `island.ts` uploads via `MemorySink`) — only the
   `observer.json`-specific branch inside `put_file` (the one computing `observer_hash` via
   `Checkpoint.bytes_digest/1`) is removed, since there's no more separate observer file to
   special-case. `complete/7` drops `observer_hash` as a separate argument — one digest end to end
   for the run/verify comparison; bundle files carry no digest (unchanged from today).
6. **Persistence/migration.** `state.bin` (currently `:erlang.binary_to_term/2`) gains a version
   tag. On load, if the tag doesn't match, **refuse to start** with a clear error naming the data
   directory to delete — no migration code for pre-v3 dev data, per the stated policy. (The live
   `:4000` dev instance is explicitly out of scope for this refactor to touch; this refusal path
   is what a *fresh* coordinator restart against old data will hit, documented so the user knows
   what to expect if they ever do restart it against this branch.)

**Which digest goes where (closing the ambiguity a first draft of this plan left open):**
`startHash`/`startFrom` (continuity: "does this island's local physics match what the predecessor
actually ended with") stays `stateHash` — physics-only, the same value `golden-hashes.test.ts`
pins and the same one `sameConfig`/`continuationError` reason about. `endHash` in `complete`, and
the value compared during verification, becomes `artifactDigest` — state *and* observer together,
since a verifier must reproduce the observations too, not just the physics. The coordinator's
`Coordinator.Checkpoint` therefore still needs to produce *both* digests from an uploaded
checkpoint: `state_digest`-equivalent (physics-only, for the next segment's `startHash`) and
`artifact_digest` (physics+observer, for `complete`/verification) — Part A's note that
`artifactDigest` "replaces `endHash` *and* `observer_hash`" was correct; it does not also replace
`stateHash`'s role in `startHash`, which stays separate and physics-only end to end.

**Files NOT touched by B:** `packages/schema`, `packages/runner`, `apps/lab`, `experiments/`,
`tools/` (other than reading, not modifying, `tools/fixtures/coordinator-checkpoint.ts`'s output).

**Tests:**
- New `Coordinator.SegmentTest` (or similarly named) exercising the transition table directly:
  one test per row, plus the double-complete, double-reject, wrong-lease, lease-expiry-race, and
  "verify attempt expires without touching the `done` run result" cases reviewers keep
  re-finding, plus a regression test that a `diverged` verify blocks and resets already-`done`
  *and* already-`verified` descendants (not just pending ones) — this is the specific behavior an
  earlier draft of this table almost narrowed by mistake, so it gets its own explicit test.
- `Coordinator.CheckpointTest` regenerated against `tools/fixtures/coordinator-checkpoint.ts`'s
  new (v3) output, committed together with the fixture regen and the `state_digest`/
  `artifact_digest` port, in B's first commit (see Part A's Tests section on sequencing).
- Store test: same digest uploaded twice is idempotent; different digests never collide;
  directory fan-out matches the digest.
- `cd apps/coordinator && mix precommit`.
- **New coordinator integration test** (does not exist today — `tests/deno/gpu_golden.ts` only
  exercises GPU-vs-CPU physics and `tests/deno/segments.ts` passes state/observer directly between
  in-process runner calls, neither one drives the HTTP API): start a coordinator against a
  scratch `--data-dir`, create a small experiment, run one or two islands against it via
  `runIsland` (from `packages/runner/src/island.ts`, which already knows the HTTP protocol),
  through `next` → publish → `complete`, including one `verify` task, and assert the store layout,
  final segment status and (for a deliberately corrupted upload) the `diverged`/`blocked` cascade.
  This is new test infrastructure this part must add, not a reuse of the two existing Deno scripts.

**Exit criteria:** `Queue` has no inline status-mutation logic outside `transition/2`; every
completed segment's digest is traceable to exactly one attempt's upload; a second full run against
fresh `--data-dir` reproduces the same store layout; old-format `state.bin` fails fast with a named
error, never silently misreads.

## Part C — Pre-registration as data

**Owns:** `experiments/endpoints.ts` (new), `experiments/preregistration.md` (generated section
only — surrounding prose is hand-edited), `tools/analyze.ts`, a new `tools/gen-prereg.ts` (or a
`deno task`) and a new staleness test (e.g. `tests/deno/prereg-sync.ts`).

**Change:**

1. **`experiments/endpoints.ts`**: a typed spec, one entry per primary/held-out endpoint —
   `{ id, kind: "test" | "threshold" | "coexistence", comparisons: [{a, b, relation:
   "pGreater"|"pLess", alpha}], statistic: (run) => number, description }` (exact shape is an
   implementation decision; the constraint is that it's the single source both the doc generator
   and `analyze.ts` read). Ports today's hard-coded endpoints 1–3 from
   `experiments/preregistration.md` (including endpoint 3's existing recycling comparison,
   `bioticRecycling(treatment) > bioticRecycling(replenished)`, which is **unchanged**, not folded
   into the new endpoint below) plus a **new, separate coexistence endpoint**: continuous
   coexistence durations of ≥2 roles (≥3 for the M5 gate), computed by scanning `series.jsonl`
   census records in step order for runs of consecutive censuses where `rolesPresent` (only
   present on deep censuses — the spec must handle the sparser sampling, e.g. treat a role as
   "present" for the gap until the next deep census that says otherwise, or explicitly restrict
   the durations calculation to deep-census steps only — decide and document this in the
   endpoint's `description`) shows the required roles present, requiring the qualifying duration
   to reach ≥1e5 steps, then the endpoint's verdict is "a majority of treatment runs qualify" —
   this is the pre-registered coexistence hypothesis on its own, no Mann–Whitney involved (it's a
   proportion/majority count, like `growthVsSaturation`'s verdict counting, not a two-sample test).
   The **existing** `mannWhitney(...).pGreater`/`holm` machinery from
   `packages/metrics/src/stats.ts` is reused only for the recycling comparison (endpoint 3), which
   this new endpoint sits *alongside*, per "the treatment-majority verdict for coexistence **plus**
   biotic recycling treatment > replenished" in the task's phrasing — two endpoints, not one
   fused test.
2. **`tools/analyze.ts`** imports `experiments/endpoints.ts` and executes each entry instead of
   the current hard-coded primary-endpoints block; exploratory statistics stay as they are (the
   spec only covers pre-registered endpoints, per the file's own stated scope).
3. **Doc generation.** `experiments/preregistration.md`'s "## Primary endpoints" and "## Held-out
   observables" sections (or wherever the generated content lives — mark the boundaries with
   HTML comments, e.g. `<!-- GENERATED:endpoints:start -->` / `:end`) are written by a small
   script from `endpoints.ts`'s `description` fields, run via a `deno task gen-prereg`. A test
   (`tests/deno/prereg-sync.ts`) regenerates the section into memory and diffs it against the
   committed file, failing if they differ — the mechanism the task description asks for ("a test
   that fails if the doc is stale").
4. **Freeze policy, corrected.** The note at the top of `preregistration.md` freezes *this file* —
   the living repo doc itself, not some separate copy — and says any later change needs a dated
   amendment section while the original text stays. That applies to the generated section exactly
   like the hand-written prose around it: before a freeze, `gen-prereg` can rewrite the generated
   section freely (that's what the sync test enforces against drift during development). **After**
   a freeze (recorded via its SHA-256 in `experiments/FROZEN`), the generated section is part of
   the frozen text — a later run of the generator must not silently overwrite it. Concretely: the
   generator checks `experiments/FROZEN` first and, if the current file's hash is already listed
   there, refuses to overwrite the generated section in place and instead tells the operator to
   add a dated amendment (appended, per the existing convention), same as any other post-freeze
   change would require.

**Files NOT touched by C:** anything under `packages/`, `apps/`.

**Tests:**
- `deno test` (or equivalent) for `endpoints.ts`'s coexistence duration calculation against a
  small synthetic `series.jsonl` fixture (roles flipping in and out, gaps at non-deep censuses,
  boundary at exactly 1e5 steps).
- `tests/deno/prereg-sync.ts` (new) as described above — wire it into whatever currently runs
  `deno run -A tests/deno/gpu_golden.ts` / `segments.ts` so it's part of the standard check list.
- Re-run `tools/analyze.ts` against an existing run bundle (or a small synthetic one) and confirm
  its primary-endpoints output is unchanged for the endpoints that already existed, and produces a
  coexistence verdict for the new one.

**Exit criteria:** `experiments/preregistration.md`'s endpoint section has a single generator; a
hand-edit to that section without regenerating is caught by the sync test; the coexistence
endpoint runs against real `series.jsonl` output end to end.

## Part D — Small lab/runner fixes

**Owns:** `apps/lab/src/main.ts`, `packages/runner/src/island.ts` (fully independent — do these
two first, any time). **`sim.worker.ts`'s `save`/`restore` fix (item 1 below) overlaps Part A's
item 6** (A already has to touch `save`/`restore`/`adopt` to add observer capture) — do **D1 before
A**, as its own small commit, so A is built on top of correct provenance behavior instead of the
two changes fighting over the same functions. D2 and D3 have no file overlap with A/B/C and can
land whenever.

1. **`sim.worker.ts` (~L314–351, `save`/`restore`/`importedManifest`):** restoring an earlier
   checkpoint and then saving again currently reuses `m.runId` and truncates the *same* manifest's
   checkpoint list (`m.checkpoints.slice(...)`), so a later save after a restore-to-an-earlier-point
   overwrites the run manifest and destroys the provenance of checkpoints taken after the restored
   point. Fix: on `restore`, mint a new `runId` for the branch (e.g.
   `${meta.runId}-b${Date.now().toString(36)}`) whenever the restored checkpoint isn't the
   manifest's *last* one — i.e. only continue in place when resuming exactly where the run left
   off; any restore to an earlier point forks. **`importedManifest`'s fallback does *not* already
   fork correctly and needs the same fix, not just keeping as-is**: it calls `newManifest(...)`
   (which does mint a fresh id internally) but then overwrites that with `{ ..., runId }` using
   the *caller-supplied* `meta.runId` — so the manifest-missing/parse-failure fallback still
   reuses the old run's id today. Fix both call sites the same way: mint and use a genuinely new
   id (not `meta.runId`) whenever there's no confirmed, intact prior manifest to safely continue.
   This also covers the case of a restore whose checkpoint entry is missing from an otherwise
   intact manifest (currently falls into the same `catch` as a fully missing manifest).
2. **`main.ts` (~L325, the `"loaded"` case):** the worker pauses on load but `main.ts` doesn't
   read that back — `playing` state and the Pause/Play button label go stale. Fix: either have the
   `"loaded"` message carry the worker's actual `playing: false`, or have `main.ts` explicitly send
   a `pause` on load before flipping its own `playing` flag — whichever matches how `playing` is
   already tracked elsewhere in `main.ts` (check for an existing `setPlaying`-style helper before
   adding a second place that writes the button label).
3. **`island.ts` idle wait (~L78–91):** the `setTimeout`-based idle wait always runs the full
   `idleMs` even if `signal` is already aborted (e.g. Stop hit while `/next` was in flight and
   returned `idle`). Fix: check `signal.aborted` before entering the wait (skip it entirely) —
   the existing abort-listener inside the `Promise` already handles abort *during* the wait, this
   just needs the pre-check for the already-aborted case.

**Tests:** targeted — a lab test (or manual check via `pnpm -s test:e2e`) for save-after-restore
*and* restore-from-a-broken-manifest each producing a fresh run id; a `main.ts` unit/e2e check
that the Pause/Play label matches worker `playing` state after a `load`; an `island.ts` unit test
asserting the idle wait resolves immediately when `signal.aborted` is already true at call time.

**Exit criteria:** all three fixed with a regression test each; D1 lands before A touches the same
functions; D2/D3 have no interaction with A/B/C's files.

## Cross-cutting checks (run before every commit, per part)

```
pnpm -s typecheck
pnpm -s test                              # vitest, ~80s
deno run -A tests/deno/gpu_golden.ts   < /dev/null
deno run -A tests/deno/segments.ts     < /dev/null
pnpm -s test:e2e                          # Playwright Chrome golden
(cd apps/coordinator && mix precommit)
deno run -A tools/fixtures/coordinator-checkpoint.ts < /dev/null   # regenerate after any format change;
                                                                     # update pinned values in apps/coordinator/test
```

Redirect stdin from `/dev/null` for every `deno`/`codex` invocation.

## Review process

Per the standing review policy: at each part's boundary (A, B, C, D) — checks green → background
`codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C /Users/nicholas/develop/browser-life ... < /dev/null`
read-only review of the diff → address findings → commit. A final Sol 6.1 High review of the whole branch
before it's considered done, in addition to the per-part reviews.

## Open questions to resolve during implementation (not blocking the plan)

- Exact byte layout of the observer section (field order, whether tracker `alive`/`prevIds` need a
  more compact encoding than plain JSON for large populations) is an A-phase implementation
  detail, not fixed here — the constraint this plan sets is *one* section, *one* JSON-shaped
  payload, decoded by *one* function.
- Exact Elixir module boundaries inside `apps/coordinator/lib/coordinator/` for the new
  attempt/store/transition code (one module vs. three) is a B-phase call.
- Whether the coexistence endpoint treats "not a deep census" as "unknown" (excluded from the
  duration run) or "same as last known" is called out above but the final choice belongs to
  whoever implements C, documented in `endpoints.ts`.

## Review resolutions

A background `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only` review of this document against the current
code (base commit `68f2336`) found 15 issues, most of them factual mismatches between the plan and
`apps/coordinator/lib/coordinator/queue.ex`, `packages/runner/src/runner.ts` and
`apps/lab/src/sim.worker.ts`. All 15 were verified against the source before fixing; every one was
addressed in place above rather than left as a caveat:

1. **B weakens descendant invalidation** — fixed: the state table now says `block_descendants`
   resets and blocks `done`/`verified` descendants too, matching `queue.ex`'s current behavior,
   not just not-yet-done ones.
2. **A can't move every continuation check into `decodeCheckpoint`** — fixed: Part A now keeps a
   narrowed `continuationError` for the two run-context checks (`sameConfig`, settings match) that
   `decodeCheckpoint` structurally cannot perform, instead of deleting it outright.
3. **B's verification lifecycle was internally inconsistent** — fixed: the table now tracks verify
   as an attempt *on* a `done` segment rather than a segment-status transition, so a run stays
   `done` (successors unblocked) while verification proceeds or expires independently, matching
   `complete_run`/`reclaim_stale` today.
4. **B assumed verifier uploads that don't exist** — fixed: attempt records now say explicitly
   that only `:run` attempts upload, and a verify attempt's `reported_digest` is compared against
   the segment's accepted **run** attempt's `uploaded_digest`, matching `complete_verify` today.
5. **A's fixture handoff conflicted with its own scope and `mix precommit`** — fixed: A now
   freezes the v3 format but leaves `tools/fixtures/coordinator-checkpoint.ts`'s output and the
   pinned Elixir test values untouched; regenerating the fixture and porting `Coordinator.Checkpoint`
   happen together as B's first commit.
6. **A assumed a lab observer implementation that doesn't exist** — fixed: Part A gained an
   explicit item 6 describing that `sim.worker.ts`'s `World`/`adopt` currently has no tracker,
   activity state or settings to serialize, and that adding them is in scope for A, not a
   drop-in swap of existing call sites.
7. **The predecessor-digest contract was self-contradictory** — fixed: Part B now states plainly
   that `startHash`/`startFrom` stay `stateHash` (physics-only) while `endHash`/verification use
   `artifactDigest` (state+observer); the coordinator computes both from one uploaded checkpoint.
8. **D's stated fallback ("`importedManifest` already forks") was wrong** — fixed: Part D now
   describes the actual bug (the fallback reuses the caller-supplied `meta.runId`, not a fresh
   one) and folds its fix into the same `save`/`restore` change.
9. **"Only upload endpoint" would have dropped required bundle uploads** — fixed: B now keeps
   `put_file`/`get_file` as the generic bundle-file endpoints and removes only the
   `observer.json`-specific branch and its digest metadata.
10. **C conflated the coexistence verdict with the recycling comparison** — fixed: Part C now
    describes them as two separate endpoints (a majority/proportion verdict for coexistence,
    the existing Mann–Whitney comparison for recycling), not one fused test.
11. **D was not file-disjoint from A** — fixed: the ordering section and Part D now split D1
    (`sim.worker.ts`, sequenced before A) from D2/D3 (`main.ts`, `island.ts`, fully independent),
    instead of claiming all of D was independent.
12. **B's named checks don't exercise a running coordinator** — fixed: Part B's Tests section now
    calls for a new HTTP-level coordinator integration test built on `runIsland`, rather than
    implying the existing `gpu_golden.ts`/`segments.ts` scripts already cover that path.
13. **Stale descriptions of existing safeguards** — fixed: tracker cross-reference checking is now
    attributed to `Tracker.fromJSON` (not `validIndividual`), and `Coordinator.Checkpoint` is
    described only as gaining a parser/digest port, never as an encoder.
14. **B misidentified the lease and assumed new admin machinery** — fixed: attempt records now
    cite `pick_task`'s actual `rand(12)` lease (distinct from the island's `rand(32)` bearer
    token), and the `blocked`/admin-unblock row explicitly keeps today's existing operator path
    rather than proposing a new one.
15. **C misstated the freeze policy** — fixed: Part C's freeze-policy paragraph now says the
    generated section is unrestricted only pre-freeze, and after a freeze recorded in
    `experiments/FROZEN` the generator must refuse to overwrite it in place and point at a dated
    amendment instead, matching `preregistration.md`'s actual note.

## Post-review changes (refactor review round 2)

- **One observation path.** `packages/runner/src/observe.ts` (`observeCensus`, `restoreObservers`, `serializeObservers`) is the only code that advances persisted observers. `runExperiment` and the lab worker both call it at census boundaries: every `censusEvery` steps after the last observation, from the world's start step. The lab's frame loop never steps past a boundary until it has been observed. Save and export first advance to the next boundary (with a notice to the user); verify observes every boundary it crosses and may end between boundaries. A failed observation cannot be retried exactly (the ledger drain is destructive and observers update in place), so it marks the world's observer history as lost: stepping stops, pending steps are dropped, and save and export refuse until a checkpoint is restored or the lab is reloaded. Wall-clock UI censuses are display-only and never drain the mutation ledger. So identical physics and settings give identical observer state, whatever the playback timing.
- **Uncalibrated thresholds.** `observerSettings` stores an infinite activity threshold as `null` (its JSON form), so explicit `Infinity` specs resume from checkpoints.
- **Canonical JSON parity.** `Coordinator.Checkpoint` sorts keys by UTF-16 code units and escapes strings exactly as `JSON.stringify` does (fixture `unicode.blck`).
- **Store healing.** `Coordinator.Store.put/3` replaces a stored object that no longer validates or no longer has its digest.

## Held-out observables: made executable (resolves the "Deferred" item below)

The item below ("Held-out observables are not yet executable") is resolved: `experiments/endpoints.ts`
now has a `HELD_OUT_SPECS` array (one entry per observable) alongside `PRIMARY_ENDPOINTS`,
`tools/gen-prereg.ts` renders both into `experiments/preregistration.md` (a second
`<!-- GENERATED:held-out:start/end -->` block, next to the existing primary one), and
`tools/analyze.ts` executes `HELD_OUT_SPECS` via a new `evaluateHeldOut` and renders it in its own
"## Held-out observables" section, clearly separate from "## Primary endpoints (pre-registered)". The
pre-registration is still unfrozen (no `experiments/FROZEN`), so this landed without tripping the
freeze ratchet.

This first landed as a version this section originally described, which was then reviewed (findings
below) and revised per explicit user decisions -- see "Amendment, 2026-09-26" further down for exactly
what changed and why. What follows describes the *current* (post-amendment) design; the amendment
subsection is the record of what it replaced.

**Trend statistic.** Per run, the OLS slope (`trendSlope` in `packages/metrics/src/stats.ts` -- fits
exactly the points it's given, no internal windowing) of the observable against step. The fit window
itself is `scheduledTrend` (packages/metrics/src/stats.ts, pure and unit-tested in isolation): the
second half of the run's *scheduled* census positions (0-indexed row position in `series.jsonl` is
exactly the observer's `censusIdx`; deep-only fields are scheduled at `position % deepEvery === 0`) --
not the second half of whichever censuses happen to carry a finite value (a round-1 review finding:
filtering to finite values before windowing let a missing late observation quietly move the window
earlier instead of being reported). `tools/analyze.ts`'s `trendFor`/`trend` are a thin, stateful wrapper
that supplies `scheduledTrend` with a run's `steps`/`values` and tallies its returned status
(`"ok"`/`"excluded"`/`"short"`) across the ensemble into `trendDiagnostics`, rendered per observable. A
scheduled observation that is unexpectedly missing excludes that run from that observable's trend,
rather than silently shrinking the window. Slopes are scaled ×1e5 (change per 1e5 steps, matching
`growthSlope`'s existing convention) purely for readable output -- Mann–Whitney/Wilcoxon are invariant
under a positive rescaling, so this changes no test result. `MIN_TREND_POINTS = 4` is a short-run guard
only (>=3 points for any residual degrees of freedom, +1 margin), not a statistical requirement -- it
essentially never binds at the registered schedule, which gives ~500 points in a deep-only second-half
window alone. Because the window keeps `ceil(n/2)` of the `n` scheduled positions before halving, "too
short" means fewer than `MIN_TREND_POINTS` positions survive that halving (7 scheduled positions retain
4; 6 retain only 3 and is short) -- a round-2 review finding caught an earlier version of this
paragraph and the rendered diagnostic stating a wrong, off-by-one total ("8 scheduled censuses
required"); both now state the retained-count requirement directly instead of a derived total.

**Absolute + relative, controls declared per preset, restricted direction, one shared FIXED-size Holm
family.** See the pre-registration's own "Amendment, 2026-09-26" note (`experiments/preregistration.md`)
for the four decisions themselves -- they're pre-registration content, recorded there as the source of
truth. In code: `HELD_OUT_PRESET_CONTROLS` declares each registered preset's control set;
`HeldOutSpec.directional` marks which 4 of the 6 observables count; `evaluateHeldOut(views, presetId)`
computes each directional observable's one-sample `wilcoxonSignedRank` (absolute, forced to the exact
method) and its Mann-Whitney rows against every declared control (relative). The shared Holm family is
**fixed to the declared size** -- every test of every directional observable always occupies a slot (24
for gradient, 20 for spots), whether or not that slot has data; an empty slot contributes the most
conservative possible value, `p = 1`, for *that test alone* (an observable missing only one declared
control still uses its real p for every other test it has data for). A round-1 version of this pooled
only *fully decidable* observables, which shrank the family whenever any observable lacked data -- a
round-2 review reproduced this manufacturing support purely by losing a control's runs (family 20 -> 15
flipped an unrelated observable's outcome with no change to its own numbers). Fixing the family size is
the correction; per-observable/per-row `available`/`supported` are still reported separately from
whether a slot merely occupies space in the family.

Fixing the family's *size* was not sufficient on its own: because real data replacing a `p = 1`
placeholder changes that slot's rank, it can shift every *other* slot's Holm multiplier too, so
`establishedCount + unavailableCount` is not a valid upper bound on how many observables could
eventually be established (a round-3 review reproduced an already-available observable's own adjusted p
improving purely because a third, unrelated observable's missing data was completed). `evaluateHeldOut`
now computes a second, purely-optimistic recomputation of the whole family (`poolAndAdjust(0)`,
substituting the most favorable value, `p = 0`, for every missing slot instead of the real `p = 1`) and
counts how many directional observables would pass under it (`summary.optimisticCount`) -- that count,
not the conservative sum, is what "not-supported" checks against.

**Review findings and their resolutions:**

| # | Round | Finding | Resolution |
|---|---|---|---|
| P1 | 1 | Relative superiority (treatment beats controls) does not establish "treatment increases"; a declining-slower-than-controls run passed | Amendment point 1: added the absolute one-sample test |
| P1 | 1 | Neither registered preset can ever satisfy "require every present control" as coded (each preset always lacks some ablation) | Amendment point 2: controls declared per preset in code, not inferred from what's present |
| P2 | 1 | Uniform "up is more organised" is not justified for compression ratio or pattern entropy | Amendment point 3: only 4 of 6 observables are directional; the other 2 are descriptive-only |
| P2 | 1 | Per-observable Holm does not bound the error rate of the resulting "at least 2 of N" count | Amendment point 4: one shared Holm family across every directional observable's tests |
| P2 | 1 | Filtering to finite values before windowing let a missing observation silently move the window | Fixed (no sign-off needed): window is now defined by scheduled census position; a missing scheduled value excludes and is reported, never silently absorbed |
| P2 | 1 | Markdown's 4-decimal formatter hid small slopes as "0.0000" | Fixed (no sign-off needed): slopes scaled ×1e5 for display, matching `growthSlope` |
| — | 1 | `minPoints = 6` borrowed from `growthVsSaturation` without independent justification | Re-justified (not removed): `MIN_TREND_POINTS = 4`, justified directly (residual degrees of freedom for a line fit), not by analogy |
| P1 | 2 | Excluding an undecidable observable shrank the Holm family and could manufacture support (family 20 -> 15 flipped an unrelated observable's outcome) | Fixed: the family is now a FIXED size per preset (24/20); an unavailable slot contributes p=1, never shrinking the family |
| P2 | 2 | An entire missing declared control made every observable unavailable, but the summary still returned a plain `supported: false` | Partially fixed: `HeldOutSummary.outcome` became three-valued (`"supported"` / `"not-supported"` / `"unavailable"`), with "not-supported" only when crediting every unavailable *observable* as a hypothetical pass couldn't reach the threshold -- round 3 found this per-observable crediting itself unsound (see below) |
| P2 | 2 | The endpoint's Wilcoxon call used `"auto"`, which silently falls back to the normal approximation above `EXACT_MAX`, contradicting decision 1's "exact" requirement | Fixed: forced to `"exact"`; refuses (marks unavailable) rather than approximate above `EXACT_MAX`; reports which method ran |
| P2 | 2 | `docs/refactor-v3-workflow.md` and `preregistration.md` misdescribed already-decided choices as open, and the amendment's intro overstated that the original "where controls do not" wording was unchanged | Fixed: both docs corrected (see below) |
| P3 | 2 | The short-window diagnostic said "8 scheduled censuses required"; the actual guard (`half.length < minPoints`) needs 7 | Fixed: wording now states the retained-observation count directly (`>= 4 retained`), not a derived total |
| P1 | 3 | `establishedCount + unavailableCount` is not a valid upper bound on eventual support: completing one observable's missing data can improve *another*, already-available observable's own Holm-adjusted p (reproduced at both spots/10-seed and gradient/10-seed sample sizes) | Fixed: `outcome` now checks an explicit optimistic recomputation of the whole family (`summary.optimisticCount`, missing slots at `p = 0`) instead of the conservative established+unavailable sum |
| — | 3 | `tools/analyze.ts`'s rendered "not-supported" text claimed every directional observable was decidable, which isn't required by the (corrected) definition | Fixed: text now cites `optimisticCount` directly instead of describing decidability |
| — | 3 | `preregistration.md` implied a partially-available observable's *entire* slot set gets `p = 1`, and stated the pre-round-3 "not-supported" rule | Fixed: both corrected (see the amendment text below) |
| — | 3 | `experiments/endpoints.ts`'s own top comment still listed Wilcoxon-exact and α=0.01 as awaiting sign-off, contradicting the "Choices that remain flagged" paragraph just below | Fixed: comment now matches -- only OLS-vs-Theil–Sen remains open |

**Choices that remain flagged for sign-off:** only OLS (`linearFit`) over Theil–Sen for the trend slope
itself -- the amendment doesn't touch how the slope is computed, only how it's tested. Wilcoxon
signed-rank (exact) and α = 0.01 as the shared family's alpha are **not** open: the user explicitly
decided both (decisions 1 and 4 of the amendment) -- Wilcoxon signed-rank, forced to its exact method
(round-2 review finding: the endpoint used to default to `"auto"`, which silently falls back to the
normal approximation above `EXACT_MAX` nonzero slopes; it now passes `"exact"` explicitly and marks the
absolute test unavailable, rather than approximating, for any sample size the exact method can't
handle), and one shared Holm family at α = 0.01 across every test of every directional observable.

**`lineageCompression` determinism.** The main session confirmed on the archipelago that
`lineageCompression`/`patternCompression` are not engine-deterministic: identical physics/observer
digests across 16 runs, but the two backends' `CompressionStream`
(`packages/metrics/src/complexity.ts`) differ by a few percent on byte-identical input wherever a
segment was produced by Chrome vs. Deno (e.g. 0.18846 vs. 0.18228 at the same step). The separate metrics-version-2 change
has since landed: `compressionRatio` uses a bundled deterministic deflate (fflate 0.8.3, same raw-deflate
format and level), run manifests record `metricsVersion`, and `tools/analyze.ts`, `stitchRun` and the
coordinator refuse to mix versions. Pre-switch data is not comparable to post-switch data. The
observable is descriptive-only regardless (amendment point 3), so this doesn't affect the ">= 2 of 4"
claim. The earlier open question (whether to gate freezing on that check) is
therefore resolved: it has landed and is enforced.

**Tests.** `packages/metrics/test/stats.test.ts` covers `trendSlope` (exact slope recovery, no internal
windowing, the `minPoints` floor, sort-before-fit, sparse/uneven points), `wilcoxonSignedRank` (exact
monotonic and tied cases hand-checked against the doubled-rank subset-sum distribution, zero-dropping,
the all-zero edge case, normal-approximation sanity), and `scheduledTrend` (the pure windowing/exclusion
helper: the off-by-one short-window boundary the round-2 review probed directly, deep-only position
selection, a missing scheduled observation excluding the run, a missing *non-deep* position not
excluding it). `experiments/test/endpoints.test.ts` covers `HELD_OUT_SPECS`/`HELD_OUT_PRESET_CONTROLS`'s
shape (including the declared family sizes, 24/20); `evaluateHeldOut`'s preset-declared-controls
enforcement (unavailable, not partially evaluated, on an undeclared preset or a missing/too-small
declared control); the reviewer's own round-1 counterexamples (declining-slower-than-controls,
flat-while-controls-decline, both correctly unsupported); NaN/excluded-run handling; a descriptive
observable never counting regardless of separation; forcing the exact Wilcoxon method and refusing
above `EXACT_MAX`; a dedicated check that the Holm-adjusted p-values exactly match `holm()` applied
once to the FIXED-size pooled family (not once per observable, and not only over decidable
observables); the reviewer's round-2 shrinkage repro directly (losing one control's data for one
observable must not shrink the family or flip an unrelated observable's established status); the
three-valued outcome (`"supported"`/`"not-supported"`/`"unavailable"`, including a fully-evaluated
all-refuted negative distinct from missing evidence); and the reviewer's round-3 repro directly, for
both `spots` (10 seeds) and `gradient` (10 seeds -- gradient's larger 5-control family needs its own
worked example, not the reviewer's original 20-seed one, to land in the same borderline zone):
completing one observable's missing data must not be
required to avoid a premature "not-supported" while it's still genuinely possible for two other
observables to be established once that data arrives (`optimisticCount` reaching >= 2 keeps the outcome
"unavailable" instead). `experiments/test/prereg-sync.test.ts` and
`tests/deno/prereg-sync.ts` both check the held-out generated section for staleness, the same way they
already checked the primary one, plus a held-out-only freeze-ratchet regression case.

### Amendment, 2026-09-26

Codex-astra reviewed the first cut of the above (git history: the version that shipped before this
amendment) and raised four findings the user then decided on directly (not left to this session's
judgement, since they narrow what the pre-registration commits to): absolute-plus-relative testing,
per-preset declared controls, restricting directional claims to 4 of the 6 observables, and one shared
Holm family across every directional test. Those four decisions are pre-registration content and are
recorded as the dated amendment in `experiments/preregistration.md` itself (see its "## Held-out
observables" section) -- this entry exists so the workflow history shows *why* the design above differs
from what this section described a revision ago, without duplicating the decisions' own wording.
Three further findings from the same review (missing-scheduled-observation handling, slope-magnitude
formatting, and the unjustified `minPoints` borrowing) needed no sign-off and are folded into the
"Review findings and their resolutions" table above as ordinary engineering fixes.

A second review round found the implementation of those same four decisions still incomplete: the Holm
family shrank instead of staying fixed (contradicting decision 4's "every test of every directional
observable"), the overall outcome collapsed missing evidence into a plain "no" instead of a distinct
unavailable state, and the Wilcoxon call could silently approximate instead of honoring decision 1's
"exact" requirement. None of these are new decisions -- they're the round-1 implementation not yet
matching what was already decided -- so they're fixed directly (see the table above, rows marked round
2) rather than added as a second dated amendment to the pre-registration; the pre-registration's own
text needed only a factual correction (`preregistration.md`'s intro no longer claims the original
wording is unchanged) rather than a new decision record.

A third review round found the round-2 fix to the overall outcome incomplete in turn: fixing the
family's *size* stopped it from shrinking, but the "not-supported" check still summed the conservative,
per-observable established/unavailable counts, which is not a valid upper bound once a fixed-size
family is involved -- completing one observable's missing data shifts every slot's rank, which can
improve an unrelated, already-available observable's own adjusted p. Also not a new decision (decision
4 already said "every test... Holm-corrected together as one family"; round 3 is the implementation
finally computing what that family-wide interaction actually implies for the three-valued outcome), so
it's fixed directly (table rows marked round 3) rather than a further dated amendment. The same round
also caught three lingering documentation inaccuracies (this file's and `preregistration.md`'s
description of which slots get `p = 1`, and `endpoints.ts`'s own comment still listing Wilcoxon/α as
open) -- all fixed alongside.

## Deferred

(Nothing outstanding from this list; the held-out observables item above is resolved.)
