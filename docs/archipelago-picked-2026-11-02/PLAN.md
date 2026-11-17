# S6 plan: picked breeder runs on islands via a content-addressed pick log

Branch `claude/archipelago-picked-runs` (from origin/main e8d75273). Stage PLAN, 2026-11-02. No physics change:
`RULE_VERSION`, golden pins, `step.ts`, shaders and `defaultConfig()` stay untouched.

## User-visible outcome

Today a run whose donors were hand-picked in the lab (pond keeper / breeder hand picks) can be replayed only by
`tools/run.ts --picks-from` on one machine. After this slice a person can take the lab's exported pick history,
submit it to a local coordinator with one command, and watch two separate islands run it in segments and verify
each other by state hash; `tools/stitch.ts` then exports a bundle equal to the `tools/run.ts` replay of the same
pick log. The pick log is fixed before the run: no model picker, no live hand picks, no paid calls.

## Design (reuse, do not reinvent)

- **Two logs, never conflated (review P1-1).** The *input pick log* is the immutable, possibly sparse, content-addressed
  blob (explicit choices only). The *applied history* is the complete per-boundary `picks.jsonl` a run writes (every
  boundary, implicit ones included). The bundle's `picks.jsonl` is the applied history; the input log is checked against
  it (every input entry appears identically in the applied history; every other boundary is the arm's rule donors, only
  when `pickImplicit`).
- **Input pick log = existing `picks.jsonl` text, canonicalised.** Entries only (`{"step","kind":"pick","cycle","donors"}`,
  ascending, one per line, no `by`/`suggested`), produced from `mergePickLogs`/`parsePickLog` in
  `packages/runner/src/picks.ts`. Its SHA-256 (lowercase hex of the exact bytes) is the address.
- **Store:** `Coordinator.Store` already has `put_blob/3`, `blob_path/2`, `sha256_file/1` (content-addressed under
  `files/<sha[0..1]>/<sha>`). Pick logs reuse them (a pick log is a blob, validated before it is stored).
- **Spec:** experiment spec gains `pickLog: "<64 hex>"` and optional `pickImplicit: true` (a lab history is sparse:
  an unlisted boundary takes the arm's rule donors, today's `implicitRule`). Task spec carries `picked: true`,
  `pickLog`, and `pickImplicit` only for such experiments; every other task payload stays byte-identical.
  Runner `RunSpec` gains optional `pickLog?: string` (hex64, needs `picked: true`, no `pressures`, no `branch`).
- **Runner:** a picked run with *recorded picks and no picker* may continue from a checkpoint (`opts.start` +
  `opts.observer`): `picksPreflightError(entries, cfg, startStep, steps, implicit)` already takes a start step; the
  runner's blanket refusal of `start`/`observer` for picked runs is narrowed to "live picker run cannot continue".
  A picker run (model/hand/random) still refuses it. Entries are absolute-step keyed, so the donor hook is unchanged.
- **Metadata aggregation (review P2-2).** Each segment's manifest `picks` block is segment-local. `stitchRun` replaces it
  with a block recomputed from the stitched `ponds.tsv` plus the input log: `digest` = `picksDigest` over the complete
  applied history, boundary/recorded/implicit counts over the whole run, live count 0. Tested with a final segment that
  contains no pond boundary.
- **Island:** new capability `picks-v1` (asked for with `ponds-v1` and `breed-v1`). `specRefusal` stops refusing
  `picked` when `pickLog` is present (still refuses `pressures`, `branch`, picked without `pickLog`). The island
  fetches the log (`GET /api/pick-logs/:sha`, island-authenticated), checks the SHA-256 itself, parses it, keeps the
  entries in `(startStep, startStep+steps]`, and passes them as `opts.picks`. `picks.jsonl` stays an unverified,
  never-uploaded file.
- **Coordinator:** `PUT /api/pick-logs/:sha` (admin: `require_admin`, tokenless on loopback in dev) does only *context-free*
  validation (review P2-5): hex64 path, size cap, UTF-8 JSON lines, shape, strictly ascending steps, cycle >= 1, digest =
  path. `GET /api/pick-logs/:sha` uses the existing `require_island_or_admin` (the exporter is admin, review P2-6), validates
  hex64 before `Store.blob_path` (which does not), serves bytes, 404 unknown. Experiment creation with `pickLog` requires the blob to exist and *re-validates the stored bytes in context*
  (never trusting existence in the shared blob store): a breeder-capable pond preset whose arm chooses donors
  (`:breed_presets`, plus `ponds`/`ponds-small` under `pond-breed-*` conditions), no `overrides`, exactly one
  condition and one seed, steps multiples of the preset's pond period, cycle = step/period, every entry in `(0, steps]`,
  `pickImplicit` true-or-absent, and, when `pickImplicit` is absent (strict), *complete coverage*: an entry at every
  pond boundary in `(0, steps]` (review P2-4; empty or gappy strict logs are 422 at creation). Creation records the digest. Queue gate: such segments
  (run or verify) go only to islands advertising `picks-v1` with `breed-v1`/`ponds-v1`. Donor validity against the
  state (occupied, distinct) is the island's. Every deterministic pick failure on the island (a `PickError`, and the
  runner's plain `Error` from `picksPreflightError`, runner.ts:970, plus a fetched log that fails its SHA or parse) is
  mapped to the existing terminal segment `fail` path, not released for retry (island.ts:732 propagates other errors);
  a test covers each.
- **Stitch:** `stitchRun` accepts a picked manifest only when `spec.pickLog` is present and the spec equals the
  task's (`taskSpecError` learns `picked`/`pickLog`/`pickImplicit`). `tools/stitch.ts` downloads the input blob (admin GET), checks its
  SHA-256, materialises the *applied history* `picks.jsonl` from the stitched `ponds.tsv` (explicit entries from the
  input log, implicit boundaries as rule picks, as the runner writes them) and runs `picksConsistencyError` against it.
  `existing()` (cached export check, tools/stitch.ts:289; amendment-3 class) also validates a picked bundle: `picks.jsonl`
  present, consistent with `ponds.tsv`, explicit entries equal to the coordinator's blob, aggregated `picks` block
  correct; tests delete/alter the log with unchanged fingerprints and require a re-export or refusal. Equality claim
  to `tools/run.ts`: same `finalHash`, same bytes in every `VERIFIED_FILES` file, same `picks.digest` and counts,
  same applied entries; `picks.jsonl` bytes differ only if `by`/`suggested` columns differ, so compared as parsed entries.
- **Submit command:** `tools/submit-picks.ts` (Deno, no GPU). Loads a lab run manifest (`<runId>.run.json`), a
  session file, or a `picks.jsonl` through the same loader as `tools/run.ts`, which is extracted unchanged into
  `tools/lib/pick-record.ts` (behaviour-preserving; `tools/run.ts` imports it). `run.ts`'s loader *accepts* lesions, feeds,
  pressures and suns (`labHistory`, interventions.ts:348; review P2-8), so refusal is an explicit **submit-only policy**
  applied to the loader's returned history: refuse any lesion, feed, pressure, sun/schedule entry (named in the
  message, never dropped silently), `edgesFrom > 0`, config/seed/ruleVersion/startHash mismatch. It canonicalises,
  `PUT`s the log, then `POST`s the experiment and prints the run id and digest.

## How to try it

```sh
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install
LAB_PORT=5381 PORT=6381 bin/dev                      # lab http://localhost:5381 + coordinator :6381 (dev: tokenless local admin)
# 1. In the lab, load the Breeder world, turn on breeder mode, hand-pick a few cycles, save/download the run
#    (a <runId>.run.json from lab storage, or the downloaded .session.json).
# 2. Submit it:
deno run -A tools/submit-picks.ts --coordinator http://localhost:6381 --picks-from <file> \
  --experiment picked-demo --preset breeder --seed 1 --steps 10000 --segment-steps 5000 --verify-fraction 1
# 3. Two islands (separate terminals):
deno run -A tools/island.ts --coordinator http://localhost:6381
deno run -A tools/island.ts --coordinator http://localhost:6381
# 4. Watch http://localhost:6381/ (status page lists the run, segments, verified) then export and compare:
deno run -A tools/stitch.ts --coordinator http://localhost:6381 --experiment picked-demo --out /tmp/picked-demo
deno run -A tools/run.ts --experiment picked-demo --preset breeder --seeds 1 --steps 10000 --picks-from <file> --out /tmp/picked-run
# compare: tools/compare-picked.ts (or the evidence script) diffs finalHash, VERIFIED_FILES bytes, picks digest/entries
```
The existing `pond-keeper-session*.json` fixtures all contain pressures or lesions (review P2-8) and are *refused* by
submit (a test uses them as refusal cases). A new clean picks-only fixture `tests/e2e/fixtures/picks-only-session.json`
(non-rule donors, see Tests) is the usable input.

## Files

Add: `tools/submit-picks.ts`, `tools/lib/pick-record.ts`, `tests/deno/picked_segments.ts`,
`tests/e2e/lab-picks-to-coordinator.spec.ts` (+ small fixture if needed), `apps/coordinator/test/coordinator/pick_log_test.exs`,
`apps/coordinator/test/coordinator_web/pick_log_api_test.exs`, `tools/test/submit-picks.test.ts`,
`packages/runner/test/picked-continuation.test.ts`.

Change: `packages/runner/src/runner.ts` (`RunSpec.pickLog`, validateSpec, narrowed start refusal), `picks.ts`
(canonical text helper + `pickLogDigest`), `island.ts` (`picks-v1`, `specRefusal`, fetch+verify+slice), `stitch.ts`
(`taskSpecError`, picked check, `DistributedTask`), `tools/run.ts` (import loader), `tools/stitch.ts` (blob, picks.jsonl,
consistency), `tools/island.ts` only if capability plumbing needs it, `apps/coordinator/lib/coordinator/{store,queue}.ex`,
`coordinator_web/{router,controllers/api_controller}.ex`, `config/config.exs`, `apps/coordinator/README.md` + root README
(one paragraph each), `tests/deno/coordinator_integration.ts` (new `it-picked` leg), `tests/deno/segments.ts` only by
reference (unchanged), `packages/runner/test/coordinator-presets.test.ts`/`coordinator-conditions.test.ts` (sync of new
config), and `docs/archipelago-breed-2026-10-18.md` (dated amendment 2026-11-02 appended under "Amendments"; the "What
is distributed" and "Not built" text is not edited). Slice evidence in `docs/archipelago-picked-2026-11-02/`.

## Tests (named cases)

vitest (`packages/runner/test/picked-continuation.test.ts`, extend `stitch.test.ts`, `island` spec tests):
- "recorded-only picked run may take a start checkpoint; picker run still refuses it"
- "picksPreflightError with startStep>0 slices to the window and rejects outside entries"
- "specRefusal allows picked with pickLog, refuses picked without it, pressures and branch"
- "island rejects a fetched pick log whose SHA-256 differs from spec.pickLog"
- "taskSpecError accepts picked+pickLog+pickImplicit exactly; refuses a changed digest or extra key"
- "stitchRun accepts a picked chain with pickLog and still refuses picked without it"
- "canonical pick log: key order, no by/suggested, digest stable under merge of file and lab manifest"

tools tests (`tools/test/submit-picks.test.ts`): manifest with lesion/feed/pressure/sun refused (existing fixtures); mismatched seed refused;
sparse lab manifest sets `pickImplicit`; same input gives the same digest twice; `run.ts` loader unchanged
(existing `pickers.test.ts`, `picked` tests pass untouched).

ExUnit: `pick_log_test.exs` ("put stores once and is idempotent", "wrong digest refused", "unsorted refused",
"oversize refused", "malformed sha refused on GET", "off-boundary/beyond-steps/wrong-period refused at creation",
"strict log empty or with a missing middle boundary refused at creation; same log with pickImplicit accepted",
"creation needs stored blob and re-validates it", "creation refuses overrides/non-breed preset/step beyond
steps", "task carries picked+pickLog only for such experiments", "gate: island without picks-v1 gets nothing, with it
gets the run and the verify"); `pick_log_api_test.exs` (admin vs island vs unauthenticated vs tokenless-dev on PUT/GET, 404 for unknown sha, existing
experiment payloads byte-identical).

**Null-fixture rule (review P1-3).** Every equality gate uses a pick log that *differs from the rule donors*: valid,
ordered, non-rule donors at a boundary that is a segment end and at one in a later segment, one implicit boundary and
one boundary window with no entries; the test first asserts the non-rule fixture produces a different post-cycle state
hash and exact donor assignments from the rule-control run (picked.ts:148 shows rule-equal picks are hash-identical, so
those prove only transport). The island-level test uses a spy/second control that ignores picks and must fail the
equality. The real coordinator demo must show a `ponds.tsv` row whose donor is the non-rule pick, recorded in evidence.md.

GPU (Deno, `tests/deno/picked_segments.ts`): breeder, mid-history cuts at cycle step and mid-cycle, recorded picks with
a sparse implicit log; each continuation goes encodeCheckpoint -> decodeArtifact -> continuationError -> runExperiment;
chain `finalHash`/`stateHash` equal the continuous picked run; `stitchRun` bytes equal in every VERIFIED_FILES; pick
entries equal; conservation exact; a wrong pick (unoccupied pond) fails at its boundary with the world unchanged.
`coordinator_integration.ts` `it-picked`: real coordinator + two real islands, `verifyFraction` 1, all verified,
observation digests match, stitched equals `tools/run.ts --picks-from`, creation 422 cases.

Playwright (`BL_E2E_PORT=5391`, chrome): the lab Breeder world, hand-pick two cycles, export the session; the spec writes
it to a temp dir; the script then feeds it to `submit-picks` against a throwaway coordinator and asserts the
coordinator lists the experiment with its digest. Screenshot of the lab export and of the coordinator status page, read
by me. (Real GPU islands run under Deno in the GPU leg; a browser island as verifier is stretch, not a gate.)

## Acceptance gates (runnable)

```sh
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm typecheck
pnpm vitest run packages/runner tools/test packages/sim-ref/test/golden-hashes.test.ts   # pins untouched
(cd apps/coordinator && mix precommit)
deno run -A tests/deno/segments.ts                  # unchanged, must still pass
deno run -A tests/deno/breed_segments.ts            # unchanged
deno run -A tests/deno/picked.ts                    # unchanged
deno run -A tests/deno/picked_segments.ts           # new
deno run -A tests/deno/coordinator_integration.ts   # includes it-picked
BL_E2E_PORT=5391 npx playwright test tests/e2e/lab-picks-to-coordinator.spec.ts --project=chrome
git diff origin/main -- packages/schema packages/sim-ref packages/sim-gpu   # empty
```
Plus the manual "How to try it" run recorded in `docs/archipelago-picked-2026-11-02/evidence.md` (commands, run id,
digest, both islands' logs, stitched vs run.ts comparison). Codex Sol 6.1 xhigh read-only review before commit.

## Non-goals and limits

- No model pickers, no live/hand picks during a run, no pressured runs (lab pond keeper `pressure` entries are refused
  by submit), no lesions/feeds combined with picks, no branch runs, no `overrides`, no paid calls, no deploy.
- A picked experiment is one condition x seed per pick log (a pick log is a history of one world); `seeds` has one entry.
- Donor validity is checked on islands, so a log with an unoccupied pick fails its segment at run time (terminal
  `fail`), not at creation (the coordinator checks shape, boundaries and strict coverage).
- Segments must cut at pond boundaries as today (`segmentSteps` multiple of `pondPeriod`).
- Verification is by state hash, as today; `ponds.tsv` is an observation comparison; the pick log's integrity is its digest.
- The browser island as a picked-run verifier is not gated.
