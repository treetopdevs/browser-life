# Scaffold integration: design v1 (row C, step 1)

*2026-10-01. The user's decision to proceed by protocol v1's row C (`docs/plan.md`, "Row C"). This document fixes the design and its acceptance tests before any code. It is engineering, not an experiment: no recorded result changes, nothing here is registered, and it runs on the Mac at $0. A later change of design goes in a dated amendment at the end.*

## Goal

The pond cycle of `docs/scaffold-protocol-v1.md` ("Pond cycle") becomes a feature of the shared stack: configs, the runner, checkpoints, segments and stitching, the lab, and the archipelago (coordinator and islands). A pond run must then be expressible as an ordinary preset plus condition, run by `tools/run.ts`, an island or the lab, and give the same bytes whichever runs it and however it is segmented.

That is what the registration step needs. A confirmatory ensemble must run through the registered machinery, with segment verification, rather than through a sandbox tool.

**Scope note.** The sandbox decision of 2026-09-30 (`docs/plan.md`, "Scope") said that no `WorldConfig` key is added. That applied to Stage 1. Row C's text calls for "optional config keys, conditions, segment parity", and this document is the dated decision that adds them.

## Fixed constraints

- **Physics is unchanged.**
  - RULE_VERSION stays 1. The per-step rules, WGSL and golden pins do not change.
  - The cycle stays a host-side transform between steps, like tile migration.
- **Existing configurations are unaffected.** They hash identically, and every existing preset identity, digest, test and bundle is unchanged.
  - New `WorldConfig` keys are optional and absent from `defaultConfig()`.
  - New observer and bundle fields appear only in pond runs.
- **The standalone tool stays as it is.** `tools/scaffold.ts` and the recorded scaffold results are untouched; the tool keeps producing the same bytes.
- **No new randomness.** The transform's keys stay `draw(cellBase((seed ^ POND_SALT) >>> 0, b, slot), purpose)` with b = step / period.

## Design

### Config (packages/schema)

Three optional `WorldConfig` keys, absent from `defaultConfig()` and validated explicitly, as `migrationPeriod` is:

| Key | Meaning |
|---|---|
| `pondPeriod` | Steps per cycle (> 0). The cycle runs at every step s > 0 with s mod `pondPeriod` = 0. |
| `pondK` | Packet side k, 1–64. |
| `pondArm` | `"scaf"` (truncation donors), `"rand"` (random surviving donors) or `"cont"` (no transform; per-boundary rows only). |

**Validation.** All three keys must be present together. Tiles must be 64 × 64, with at least 4 of them. Migration and exchange move matter between ponds or runs, which breaks the per-pond matter invariant, so pond runs exclude them at every level:
- `validateConfig`: no `migrationPeriod > 0` and no `ringNamespace`;
- the runner's entry: no `immigrant` and no metapopulation member;
- the coordinator, at experiment creation: no metapopulation spec for a pond preset, and no pond condition on a non-pond preset (its `:incompatible` table).

**D** is `max(1, floor(R / 4))`, as in protocol v1. It is not a key.

### The transform (packages/schema/src/ponds.ts)

The pure CPU transform moves from `tools/lib/ponds.ts` into `@bl/schema` unchanged in behaviour:
- `applyPondCycle`, `contRows`, `pondMatter`, `pondTraits`, `ledgerEnergy`, `assertConserved` and their helpers;
- `POND_SALT` and `POND_COLUMNS`;
- `MOT_ZERO`, exported from `world.ts`.

`tools/lib/ponds.ts` re-exports them, and keeps `pondConfig`, `cloneWorld`, `foundersWorld` and the assay helpers, which depend on `@bl/search`. Every importer of `tools/lib/ponds.ts` keeps working, and `tools/test/ponds.test.ts` stays green.

### Per-pond matter M_r

Ponds are independent tori. The physics conserves each pond's matter, and the cycle restores it exactly. So M_r equals `pondMatter` of any state of the run, and each segment computes it from its own start state. Nothing about M_r is carried, and the transform's own check (pre-cycle matter = M_r) still runs at every cycle.

### Runner (packages/runner)

**Hook.** A boundary helper is shared by the runner and the lab, generalising `migrate.ts`. It runs at the existing migration hook (`runner.ts`, after the census and the ledger drain, before the checkpoint and species readback). That is protocol v1's order:

1. step to the boundary;
2. census and observers on the pre-cycle state;
3. read the state, transform, check conservation, upload;
4. checkpoint the post-cycle state.

**Cycle index.** b = step / `pondPeriod`, taken from the absolute step. A segment never runs a cycle at its start step.

**Cadence guards** are the same as migration's: `pondPeriod` mod `censusEvery` = 0, and the start step mod `censusEvery` = 0.

**Observer state.** Pond runs only add a field `ponds: { lastCycle }`, the last boundary whose cycle has been applied (or recorded, for `cont`), equal to floor(step / `pondPeriod`). Non-pond runs omit it, so their digests do not change.

**Continuation guard.** One shared check, `pondContinuationError(cfg, observer, step)`, enforces two things. The field must be present exactly when the config has pond keys and the step is above 0. And `lastCycle` must equal floor(step / `pondPeriod`). It runs on every path that adopts a mid-run state:
- the runner's `continuationError`, which covers `tools/run.ts` continuations and islands;
- the lab's adoption of an imported or restored world, before `LabExecution` is built.

This rejects a continuation from a pre-cycle state at a boundary, which would otherwise silently skip a cycle.

**`ponds.tsv`** is written in every pond run (header only if the run or segment crosses no boundary) and never in other runs. It has protocol v1's `POND_COLUMNS` in the same order: one row per recipient per cycle (`scaf`/`rand`), or one row per pond per boundary (`cont`). The two census columns keep protocol v1's definitions exactly:
- `recipientIndividuals` comes from the census callback, `census()` / `individuals()` with their default parameters on the pre-cycle state, as in `tools/scaffold.ts`;
- `recipientLineages` is the transform's own count of distinct nonzero lineage ids among the pond's cells with B+P ≥ 48.

**After a cycle.** In pond runs the series row of the first census after each cycle carries `"afterCycle": true`. Tracker-derived outputs (`life.jsonl`, `heredity.tsv`, buddings, generations) link across the grind and are not interpretable across cycles. Analysis of pond runs must not use them; this is protocol v1's rule. Resetting the tracker at a cycle is deferred.

**Ended histories.** When no pond is eligible, the cycle clears every pond, as in v1, and later cycles take the no-donor path. Unlike `tools/scaffold.ts`, the run does not stop. It keeps stepping an A-only world deterministically, with `donor` = −1 rows.

### Presets and conditions

- **Init kind `ponds`:** `tiledWorld(cfg, genomes, 32, 10, 64, 128)`. This is founder for founder what `cloneWorld` / `foundersWorld` build.
  - Its parameters are `start: "clone"` with `founder: 2` (one genome, `M3_FOUNDERS[2]`), or `start: "founders"` (the 12 founders round-robin).
  - `presetIdentity` includes, for this kind only, the start, the founder index and the M3 founder-set identity, so a different founder or founder set is a different preset. Existing identities are unchanged.
- **Preset `ponds`:** protocol v1's frozen main regime, which is `DEFAULT_EVAL`'s physics at 64 × 64 ponds, 8 × 8, with `pondPeriod` 10,000, `pondK` 8 and `pondArm` `"scaf"`. Clone start, default mutation rate.
- **Preset `ponds-small`:** the same physics at 2 × 2 ponds, `pondPeriod` 200, `pondK` 8, `pondArm` `"scaf"`. It is for tests and the lab.
- **Conditions:**
  - `pond-rand` sets `pondArm: "rand"`;
  - `pond-cont` sets `pondArm: "cont"`;
  - both throw on a config without pond keys;
  - the default `treatment` condition leaves the preset's `scaf`.

### Stitching and the archipelago

- **Stitching.** `ponds.tsv` joins `VERIFIED_FILES`.
  - When the config has pond keys, every segment must carry it (header-only allowed), and its absence anywhere rejects the stitch. Otherwise its presence rejects the stitch.
  - Its step-range check, (startStep, endStep], reads the `step` column by header, not column 0.
- **Coordinator, presets.** The presets and conditions go in `config.exs`. A `:pond_period` cadence fact applies the existing rule, `segmentSteps` mod period = 0, as for migration.
- **Coordinator, verified files.** `ponds.tsv` goes in `segment.ex`'s optional observation files and `api_controller.ex`'s observation files, in lockstep with `stitch.ts`. A test fails when the TypeScript and Elixir lists disagree.
- **Old islands.** An island without this code cannot run pond segments. On a continuation it would also report a valid predecessor as invalid, because its runner throws on the unknown preset inside the predecessor check. So pond work is gated by capability:
  - islands built with this code advertise `capabilities: ["ponds-v1"]` when they ask for work;
  - the coordinator hands segments and verify tasks of experiments whose preset is in its `:pond_presets` list only to islands that advertise it;
  - old islands never receive them.
- **No change** to the experiment-spec whitelist or `state.bin`. The island entry points change only to send the capability.

### Lab (apps/lab)

- **Hook.** `LabExecution` calls the shared boundary helper where it calls migration, for the live world and for the verify twin.
- **Checks.** It applies the cadence check, and the census-grid realignment for imported worlds, to pond worlds too.
- **UI.** The `ponds-small` and `ponds` presets appear in the preset list. The hover readout shows the pond index. A small status line shows the cycle count and the last cycle's donors, through a display-only message, so a display error never marks the world lost.
- **Stale readbacks** stay display-only. Conservation stays exact.
- **Unknown preset ids.** The worker's `load` currently falls back silently to `PRESETS[0]`; it now reports an error instead.

### Tools

- `tools/run.ts` runs pond presets and conditions like any other, with `ponds.tsv` in the bundle.
- `tools/stitch.ts` adds `ponds.tsv` to its optional files.
- Not in v1:
  - `--resume` for incomplete runs, a known gap of `tools/run.ts` that the registration's long runs will avoid by segmenting;
  - an opt-in pre-cycle snapshot at the final boundary (R3-style sources are rebuilt by replaying the last period from the previous post-cycle checkpoint).

## Acceptance tests (fixed now)

The integration is complete only when all of these pass.

1. **Nothing else changes.**
   - `pnpm typecheck`, `pnpm test` and `deno run -A tests/deno/gpu_golden.ts` pass, with every golden pin untouched.
   - Every existing preset's identity is unchanged.
   - `tests/deno/{segments,stitch,migration,exchange}.ts` pass unchanged.
   - A fixed non-pond run's `finalHash` and verified files equal their values from before the change.
   - `cd apps/coordinator && mix precommit` passes.
2. **Standalone equivalence** (`tests/deno/ponds.ts`, Mac GPU). The runner with preset `ponds` reproduces the standalone histories of `tools/scaffold.ts`. The comparison uses a physical digest (step, ledger, cells, genome; the configs differ only by the pond keys) and `ponds.tsv` rows compared by header.
   - `scaf` at seed 4,811,001 (condition treatment): the post-cycle state at boundary 11 equals the standalone `runs/scaffold/rep/main/scaf/i0/ckpt/b11-post`, and `ponds.tsv` rows for cycles 1–11 equal the standalone rows.
   - `rand` at seed 4,811,101 (condition `pond-rand`): the same against `rep/main/rand/i0`.
   - `cont` at seed 4,811,301 (condition `pond-cont`): `ponds.tsv` rows for boundaries 1–11 equal `r3rep/main/cont/i0`'s.
3. **Segment parity** (`tests/deno/ponds.ts`, `ponds-small`, 6 cycles, with `speciesCensus` on):
   - a continuous run;
   - runs segmented at a mid-period census step, exactly at a cycle step, and at three boundaries in one run.

   All must give the same `finalHash` and byte-identical verified files after stitching, for `scaf`, `rand` and `cont`.
   - Each join at a cycle step has exactly one post-cycle species row.
   - One run continues through no-donor cycles: a world with every pond ineligible, segmented across a cycle step.
   - Stitching rejects a pond run with `ponds.tsv` missing from any segment, and a non-pond run that carries one.
4. **Continuation guard.** Continuing from a pre-cycle state at a cycle step is rejected, in the runner (`continuationError`) and in the lab (import or restore). That covers both a runner artifact edited to `lastCycle` − 1 and a standalone `b<C>-pre` checkpoint. A post-cycle artifact is accepted.
5. **Controls.**
   - `pond-cont` gives the same physical digest as the same config with the pond keys removed.
   - `pond-rand` and `scaf` differ from it.
   - Default-off parity: a config without pond keys writes no `ponds.tsv` and no `ponds` observer field.
   - Exclusions: a pond config with migration or `ringNamespace` fails validation; a pond run with an immigrant fails at the runner's entry; pond conditions on a non-pond preset throw.
   - `recipientLineages` keeps protocol v1's definition, tested on a pond with a mixed-lineage component and with sub-threshold cells.
6. **CPU reference.** A pinned hash of `ponds-small` after 3 cycles, on the CPU reference, guards the transform against drift in vitest.
7. **Lab** (Playwright, Chrome with WebGPU):
   - `ponds-small` run in the lab for 4 cycles has the same physical digest as the Deno runner;
   - the verify twin agrees;
   - save, export, import and play continue it identically;
   - `apps/lab/test/execution.test.ts` covers the hook, the cadence check and realignment on the CPU reference;
   - the lab rejects importing a pre-cycle artifact, and reports an error for an unknown preset id.
8. **Archipelago.**
   - `tests/deno/coordinator_integration.ts` runs a `ponds-small` experiment through the coordinator with Deno islands, including a verify task. Its stitched bundle equals the single-run bundle, `ponds.tsv` included.
   - Coordinator tests:
     - an island without the `ponds-v1` capability is never given a pond segment or verify task, while non-pond work still flows to it;
     - pond-plus-metapopulation experiments, and pond conditions on non-pond presets, are refused at creation;
     - a test fails when the TypeScript and Elixir lists of verified files disagree.

## Order of work and review

1. **I1, core:** config, transform move, runner, observer field, presets and conditions, stitching, tools, and acceptance tests 1–6.
2. **I2, lab:** acceptance test 7.
3. **I3, archipelago:** acceptance test 8.

Each step runs the build, audit and gate pattern of the earlier scaffold work, gets an Astra code review, and is committed before the next starts. The Astra design review of this document comes before any code.
