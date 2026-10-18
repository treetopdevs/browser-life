# The breeder on the archipelago: the rules (2026-10-18)

Slice 11 of the backlog run. `docs/sandbox-wild.md` ("Not built") says islands and the coordinator do not
know the `breed` arm: no capability, no accepted condition. This note states, before any code changes, what
the archipelago will accept, which islands it hands that work to, what is verified, and the pass/fail criteria
of the proof. A criterion changed after work starts gets a dated amendment below, not an edit here.

Nothing here changes physics, `RULE_VERSION`, a golden pin, `step.ts`, the shaders or `config.ts`. The runner
already runs, continues and stitches the breeder (`tests/deno/breed.ts` §3); what is new is the coordinator's
side and the island's advertisement.

## What is distributed

- **Rule-bred worlds only.** The `breed` arm with its rule-computed donors (`applyPondCycle` on the
  pre-cycle snapshot), and its two controls. Picked runs (`RunSpec.picked`: a model, a file, a random or a
  hand picker, a lab pick log) and pressured runs (`RunSpec.pressures`, the lab's pond keeper) stay
  lab/`tools/run.ts`-only: their donors come from outside the segment chain. Branch runs stay undistributed.
- **Conditions.** All 21 of the runner's breeder conditions join config.exs's `:conditions`:
  `pond-breed-<s>`, `pond-mass-<s>`, `pond-drift-<s>` for every `s` in `POND_SCORES`
  (`mass drive reach seed body drive+seed drive+seed+body`). The score is fixed by the condition id, and the
  coordinator accepts no `overrides`, so a distributed `pondScore` is always one of these seven; nothing in
  Elixir re-implements `pondScoreTerms`. A sync test holds the list to the runner's `CONDITIONS`.
  `pond-nat`/`pond-shuf` stay out of `:conditions`, as the hunt protocol (§13) decided.
- **Preset.** `breeder` (4 × 4 ponds of 64 × 64, `pondPeriod` 5,000, arm `breed`, `drive+seed+body`,
  mutation × 10) joins `:presets`, `:pond_presets`, `:pond_period` (5,000) and `:world_size` (256 × 256).
- **Where a condition applies.** A breeder condition needs a pond preset (one dynamic rule in
  `Queue.incompatible/3`, keyed on the condition prefixes `pond-breed-`, `pond-mass-`, `pond-drift-`). On
  `breeder`, `uniform-light` and `fixed-env` are refused as on the other pond presets, and `pond-cont` is
  refused (an arm `cont` config with `pondScore` fails `validateConfig`). Any other refusal is whatever the
  runner refuses: a test enumerates every accepted preset × condition and requires the coordinator to refuse
  exactly the pairs where `validateConfig(specConfig(...))` fails or throws.
- **Cadence.** Unchanged: `segmentSteps` must be a multiple of `pondPeriod`, so the coordinator only ever
  cuts at a cycle step (the segment that steps to the boundary applies its cycle; the next starts after it).
  Mid-cycle cuts are not reachable from the coordinator; they are still proven below, because `tools/run.ts`
  continuations and any future cadence change rely on them.

## Who gets the work

New island capability **`breed-v1`**, added to `ISLAND_CAPABILITIES` beside `ponds-v1`, `ponds-v2` and
`interventions-v1`. It is asked for in addition to `ponds-v1`, never instead of it, and does not need
`ponds-v2`. An island built before the breeder has none of the 21 condition ids: on a continuation its
predecessor check would throw and falsely reject a valid predecessor, so the controls are gated as well as
the arm.

| Segment (run or verify) | Island must advertise |
| --- | --- |
| non-pond preset, no schedule | nothing (unchanged) |
| pond preset, v1 condition (`treatment`, `pond-rand`, `pond-cont`, ...) on `ponds`/`ponds-small` | `ponds-v1` (unchanged) |
| any pond preset, condition `pond-breed-*`, `pond-mass-*` or `pond-drift-*` | `ponds-v1` and `breed-v1` |
| preset `breeder`, any condition (`treatment` there *is* the breed arm) | `ponds-v1` and `breed-v1` |
| `pond-nat`/`pond-shuf` (only when a test adds them) | `ponds-v1` and `ponds-v2` (unchanged) |
| experiment with `interventions` | `interventions-v1` as well (unchanged, orthogonal) |

The preset gate is per experiment (config `:breed_presets`, the accepted presets whose config sets
`pondScore`, held to `PRESETS` by `coordinator-presets.test.ts`); the condition gate is per segment, so an
experiment mixing `treatment` and `pond-breed-drive` on `ponds-small` still hands its `treatment` run to a
`ponds-v1` island. Work an island cannot run is skipped, never waited for.

## What is verified

- Unchanged file set: a breed segment's `ponds.tsv` (with the breeder's columns: `score`, `donorScore`, and one
  column per term under a combined score) is a verified file; the donors the rule chose are its `donor` column.
  *[Amended 2026-10-18, review: this said the second island's replay "checks the choice as well as the physics".
  The choice is checked as physics (the donors' cells are in the checkpoint whose digest the verifier must
  match); `ponds.tsv` is compared as an observation file, which records a mismatch but never changes a segment's
  status. See amendment 2.]*
- **`picks.jsonl` is not a verified file and is never part of a distributed run.** *[Amended 2026-10-18: a
  standard island never writes it for a distributed run; the coordinator does store any validly named file a
  producer uploads, and nothing verifies, stitches or reads one of this name. See amendment 2.]* Only a picked run writes it,
  `specRefusal` refuses picked and pressured specs before fetching anything, the coordinator's spec whitelist
  cannot carry `picked`/`pressures`/`branch`, and `stitchRun` refuses a picked manifest. This matches the runner
  (`PICKS_FILE` is deliberately in no file list). Tests assert `VERIFIED_FILES` lacks it and that a creation
  request carrying those keys is stored and tasked without them.

## Proof criteria

Every FAIL blocks landing. A GPU script that times out is rerun once alone before it counts; `uptime` is
recorded beside each result.

1. **`tests/deno/breed_segments.ts` (new, GPU, short).** The island's path, not in-memory hand-off: each
   continuation goes `encodeCheckpoint` → `decodeArtifact` → `continuationError(spec, state, observer) === null`
   → `runExperiment`, with the coordinator's task-spec shape (`censusEvery` 100, `deepEvery` 10,
   `checkpointEvery` 0, no overrides, no activity threshold).
   - `breeder`, `treatment`, seed 1, 10,500 steps, cut at 2,500 (mid-cycle), 5,000 (cycle step) and 7,600
     (mid-cycle); and `ponds-small`, `pond-breed-drive+seed+body`, seed 1, 3,500 steps, cut at 1,000 (cycle
     step), 1,750 (mid-cycle) and 3,000 (cycle step).
   - PASS iff, for each: the chain's `finalHash` and `stateHash` equal the continuous run's; `stitchRun` of the
     chain equals the continuous run in every `VERIFIED_FILES` file present, byte for byte; `ponds.tsv` is
     present with `breedPondColumns(score)` as its header and one row per pond per boundary (32 and 12 rows);
     every segment conserves exactly; and the cycle-step artifact continued under a different condition
     (`pond-mass-drive+seed+body`) is refused by `continuationError`.
2. **`tests/deno/breed.ts` (existing, GPU)** passes unchanged: mid-period and cycle-step cuts with the scored,
   high-mutation overrides, where the breeder departs from its mass control.
3. **`tests/deno/coordinator_integration.ts` (extended, GPU)**: experiment `it-breed`, `ponds-small`,
   conditions `pond-breed-drive+seed+body` and `pond-mass-drive`, seed 1, 2,000 steps in segments of 1,000,
   `verifyFraction` 1 (4 segments). PASS iff an island advertising `ponds-v1 ponds-v2 interventions-v1` is idle
   while the run tasks wait and again while the verify tasks wait; a real `runIsland` runs all 4 and a second
   verifies all 4; both runs are verified with no divergence or blocking; every segment uploaded `ponds.tsv`
   with its score's header, none uploaded `picks.jsonl`, and every verifier's observation digests matched;
   `tools/stitch.ts` exports both runs and each equals a single unsegmented `tools/run.ts` run of the same spec
   (finalHash and every verified file); and creation answers 422 for `pond-breed-drive` on `spots`, `pond-cont`
   on `breeder`, and `breeder` with `segmentSteps` 1,000.
4. **Static gates:** `pnpm typecheck`; `vitest` over `packages/runner`; `mix precommit` in
   `apps/coordinator`; `tests/deno/segments.ts` unchanged.

**Vacuity caveat.** A distributed run has no overrides, so `ponds-small` runs its stock mutation rate and a
1,000-step period; within 2,000 steps no pond is likely to score, and the breeder then is its mass control
physically. Criterion 3 proves transport, gating, verification and stitching, not selection. Selection on the
GPU is criterion 2's (scored overrides), and criterion 1's `breeder` run is the preset as distributed.

## Not built, with reasons

- Branch runs of a bred world (`branchError`/`branchTransform` take only `nat`/`shuf`): branches are not
  distributed at all (`specRefusal`, stitch), so widening them gives the archipelago nothing, and the hunt's
  branch GPU tests would have to be repeated.
- Picked and pressured runs on islands (above).
- `overrides` in a coordinator spec, so a shorter period or a higher mutation rate needs a preset.

## Amendments

- **2026-10-18, before the first GPU run of criterion 1.** The `ponds-small` cut at 1,750 is moved to 1,700 (still
  mid-cycle, period 1,000). A pond run must start on a multiple of `censusEvery` (`runExperiment` throws otherwise:
  "pond runs must start on a multiple of censusEvery"), and the coordinator only ever cuts at multiples of it, so a
  1,750 cut at `censusEvery` 100 is not a continuation any island can be handed. Nothing else in the criteria moves.

- **2026-10-18, after review (three lenses and Codex Sol 6.1 xhigh), amendment 2.** What changed and why:
  - *Donor record.* A producer could run a breed segment honestly, then upload a `ponds.tsv` with fabricated donor and
    score cells: the checkpoint digest still matches (status `verified`), only `observationsVerified` is false, and
    `tools/stitch.ts` exported such a run with a warning. This is the inherited rule for every observation file, but a
    bred run's donor record is what the run is for. Now (a) `tools/stitch.ts` refuses to export a bred run (config with
    `pondScore`) with any segment whose observations mismatch, with or without `--require-observations-verified`
    (`null`, no comparison, stays the flag's); (b) `checkPondsFile` holds a scored run's rows to each other: `donor` is
    -1 or a pond index, and `donorScore` is that donor's own row's `score` (0 without a donor); (c) an Elixir test
    shows a tampered `ponds.tsv` leaves the segment `verified` and listed with `observationsVerified: false` and in
    `observationMismatches`. Segment status semantics (digest only) are unchanged.
  - *Manifest binding.* `stitchRun` compared manifests only with each other, and no verifier's digest covers a
    manifest, so a producer could declare `spec.overrides` and a matching `cfg` (for example `pondScore: "body"`)
    on an honest run. `tools/stitch.ts` now binds every downloaded manifest to the coordinator's task
    (`taskSpecError`, packages/runner/src/stitch.ts): its spec must be exactly the spec `task/4` builds from the
    listing (no other key; `metapopulation` with the run's `ringNamespace`; a garden's schedule by presence only),
    and its config exactly the one that spec builds. This applies to every exported experiment, not only bred ones.
  - *Proof of selection.* Criterion 1's `breeder` leg now asserts, from `ponds.tsv`, that at every boundary no
    occupied non-donor outranks a donor (score, then bound mass), that some pond scores above 0, and that the rule
    chose a donor over a pond with more bound mass (so not the mass control's donors). Criterion 3 adds experiment
    `it-breeder` (`breeder`, `treatment`, seed 1, 10,000 steps in two 5,000-step segments, `verifyFraction` 1): run
    and verified by two real islands, observation digests matched, stitched equal to an unsegmented `tools/run.ts`
    run, and its `ponds.tsv` has rows whose donor scored above 0. `it-breed` is now created with `picked`,
    `pressures` and `branch` keys in the request, which the stored spec must lack.
  - *Coverage stated, not run on a GPU:* the 512 × 512 `ponds` preset under a breed condition (accepted by
    `validateConfig`, never run); `pond-rand` on `breeder`, and a scheduled intervention in a bred run (accepted and
    gated, never run). If one of them threw in `applyPondCycle`, every island would fail that segment and the run
    would stop at `/fail`; nothing would be verified wrongly.
  - *Not changed:* the coordinator still stores any upload whose name matches its pattern (an allowlist would refuse
    legitimate unverified files such as `cells.tsv`), so the `picks.jsonl` claim is narrowed above instead; the 422
    text for an unknown condition lists all 31 names (cosmetic, existing format).

- **2026-10-18, after a second Codex Sol 6.1 xhigh pass, amendment 3.**
  - *Cached exports.* Amendment 2's manifest binding ran only on download: an export already on disk whose
    fingerprint (accepted digests and verification metadata) still matched was kept as "already present" without it,
    so an export written before the binding, or edited since (an injected `overrides.pondScore`, say), survived.
    `tools/stitch.ts`'s `existing()` now holds the export's own manifest to the same `taskSpecError` over the steps it
    covers (the experiment's steps; a garden prefix's end), and moves a failing export aside and writes it again, as it
    already did for a failing `ponds.tsv` or schedule. `tests/deno/garden_export.ts` step 5b and a vitest case show it.
    One consequence for old exports: one whose manifest config lacks a key its task's config now has (the hunt test's
    "export older than the arm", a `cfg` without `pondArm`) is no longer kept on its `ponds.tsv` header; it is moved
    aside (kept, not deleted) and stitched again, which fails loudly if its segments' own manifests are as old. The
    real exports in `tests/deno/coordinator_integration.ts` (plain, ponds, bred) pass the new check. The "already
    present" path itself is exercised there only for the plain run and `it-ponds`; for ring, scheduled (non-garden)
    and bred runs it is covered by the vitest case alone.
  - *What the donor check proves.* Criterion 1's donor check is an ordering property: no occupied non-donor outranks a
    donor (score, then bound mass). It does not check the number of donors or which recipient each one feeds, so a
    run that chose too few donors could pass it. Where the results below say the donors "are the breed arm's", read
    "are ordered as the breed arm orders them, and are not the mass control's". The full donor set and assignment are
    held by the replay itself (the donors' cells are in the checkpoint every verifier recomputes), not by this check.

## Results (2026-10-18)

All criteria PASS. The machine was heavily loaded throughout (load averages 400 to 560); every result below passed
on its first run except criterion 3's first attempt, which never reached a check: the coordinator's cold `mix
phx.server` compile outlived the script's 30 s readiness wait. After `MIX_ENV=dev mix compile` it ran and passed.

1. **`tests/deno/breed_segments.ts`: PASS** (32 checks, 47 s wall; load 386 at start, 446 at end). Both legs, cut
   through the artifact bytes, equal their continuous runs in `finalHash`, `stateHash` and every verified file;
   `ponds.tsv` has the `drive+seed+body` header (27 columns) and 12 and 32 rows; every segment conserves; the
   cycle-step artifact is refused under `pond-mass-drive+seed+body` ("start state config differs"). Largest pond
   score: 0 on `ponds-small` (stock mutation, as the caveat expects), 11 on `breeder` (its tenfold mutation rate),
   so the `breeder` leg's donors were chosen by a non-zero score at least once.
2. **`tests/deno/breed.ts`: PASS** unchanged (103 checks; load 541 at start, 411 at end).
3. **`tests/deno/coordinator_integration.ts`: PASS** (80 checks, 0 FAIL; load 459 at start, 431 at end). The
   `it-breed` block: the three 422 refusals; an island with `ponds-v1 ponds-v2 interventions-v1` idle while the
   run tasks and again while the verify tasks wait; 4 segments run, 4 verified, both runs verified with no
   divergence or blocking; every segment's `ponds.tsv` starts with its score's header, no segment has
   `picks.jsonl`, every verifier's digests matched; the stitched bundles equal the unsegmented `tools/run.ts`
   runs (finalHash and every verified file; 8 `ponds.tsv` rows each, no `picks.jsonl`). The vacuity caveat holds:
   this proves transport, gating, verification and stitching, not selection.
4. **Static gates: PASS.** `pnpm typecheck`; `vitest` over `packages/runner` (18 files, 423 tests);
   `mix precommit` (356 tests, 0 failures, warnings as errors, no `mix.lock` change); `tests/deno/segments.ts`
   unchanged. The truth-table test found no existing `:incompatible` mismatch: with the three `breeder` rows and
   the prefix rule, the coordinator refuses exactly what the runner refuses on all 12 presets x 31 conditions.

## Results after amendment 2 (2026-10-18)

All PASS, each on its first run (load averages 250 to 440).

1. **`tests/deno/breed_segments.ts`: PASS** (38 checks; load 388 at start, 369 at end). The `breeder` leg: largest
   pond score 11, and 40 donor/heavier-non-donor pairs, so its donors are the breed arm's and not the mass control's;
   the donor rule holds at every boundary of both legs.
2. **`tests/deno/breed.ts`: PASS** (96 PASS lines, 0 FAIL; load 330 at start, 497 at end). Rerun because its stitched
   comparison goes through `stitchRun`, and so through the new `checkPondsFile` donor rule, on scored rows.
5. **Not exercised:** a metapopulation (ring) export through `tools/stitch.ts` with the new binding; the
   `ringNamespace` derivation is covered by vitest only (no Deno script drives the tool on a ring experiment).
3. **`tests/deno/coordinator_integration.ts`: PASS** (86 checks, 0 FAIL; load 328 at start, 252 at end). The new
   manifest binding accepted every real export in the script (plain, migration, ponds, scheduled, bred). `it-breeder`:
   both segments run and verified by two islands with matching observation digests, stitched equal to the unsegmented
   run, and 28 of its 32 `ponds.tsv` rows have a donor that scored above 0. The stored `it-breed` spec lacks the
   `picked`, `pressures` and `branch` keys its creation request carried.
4. **Static gates: PASS.** `pnpm typecheck`; `vitest` over `packages/runner` (18 files, 429 tests); `mix precommit`
   (358 tests, 0 failures); `tests/deno/segments.ts` (0 FAIL); `tests/deno/garden_export.ts` (all PASS; its fake
   listing now carries each segment's `condition` and `seed`, as the coordinator's does).
