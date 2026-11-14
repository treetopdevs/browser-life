# Rung 1b, M5 (runner, census3, layers.tsv, readout): implementation plan

Scope: milestone "M5 Runner and readout" of `docs/3d-rung1b-plan-2026-10-23.md` (§2 runner/observe, §5.1 founders, §5.2 readout, §6 M5), read at tree `bccc4c93`
(M0 `d5f1283d`, M1+M2 `071363d4`, M3 timing gate `bccc4c93`). No `step3d.ts`/`shaders3d.ts`/`gpu-sim3.ts` changes, and nothing under `experiments/3d-slab/m3-*`.
Hard rules: every existing golden pin and every 2D run bundle byte-identical; every slab-only behaviour gated on `isSlab(cfg)`; **the readout rule is fixed**
(thresholds, layer groups, seeds, cadence, decision branches), so this note only says how to execute it exactly.

## Facts found while reading the code

1. `runExperiment` hard-wires `GpuSim.create(device, actualInit)` (`runner.ts:1117`). `createSim` already exists in both `sim-ref` and `sim-gpu` (M2) but nothing uses it.
2. **Three existing suites mock `@bl/sim-gpu` with only `{ GpuSim }`**: `packages/runner/test/{sun,interventions,island-cancel}.test.ts`. If `runner.ts` imported `createSim`, vitest would throw
   on the missing mock export in all three. So the runner branches inline, `isSlab(cfg) ? GpuSim3.create(...) : GpuSim.create(...)`. The 2D line stays the same call, and
   `GpuSim3` is referenced only on the slab path (vitest's mock proxy throws on access, not on import; **verify by running the three suites first**; fallback: add `GpuSim3: undefined` to each factory).
3. `GpuSim3` has `run`, `step`, `drainLedger`, `readSnapshot(withRoles)`, `readStats`, `readState`, `readGenomeChannels`, `upload`, `destroy`, `cfg`, but **no `setLight`, `lesion`, `feed`**
   (needed at `runner.ts:1127, 1285, 1296`, `applyScheduled(sim, ...)`). `BoundarySim = Pick<GpuSim, "cfg"|"readState"|"upload">` is satisfied by both.
4. **`PRESETS` is the lab's catalogue.** `apps/lab/test/social-meta.test.ts:164` expects `Object.keys(cards)` to equal `PRESETS.map(id)`, `worlds.test.ts` demands a note and a family per id,
   `world-cards.ts`/`social-card.ts` call `initWorld` and render, `sim.worker.ts` would hand a slab to `GpuSim`. A `slab-spots` entry in `PRESETS` breaks `pnpm test` and the lab. Decision: a separate
   `SLAB_PRESETS` list and `presetById()`; only `specConfig` (`runner.ts:636`) and `runExperiment` (`runner.ts:959`) switch to it. Lines 434/440/456 (`?.init.kind !== "m3"`) already give the right
   refusal for a slab id, and `tools/stitch.ts:159`, `tools/analyze.ts:445`, `tools/run.ts:364` are pond/analysis/lab paths a slab never takes: left alone. The coordinator's preset list (Elixir, pinned by
   `coordinator-presets.test.ts` against `PRESETS`) stays 2D-only, which also keeps slabs off islands.
5. 2D geometry hides in `observeCensus` and the runner loop, each of which would **run without error on a slab and silently be wrong**: `census()` (4-neighbour, y wraps per tile, `tile` from `tilesX/Y`),
   `blockSymbols` (`H = n / W` flattens the layers into a tall 2D image), `tileDistance2` (x/y only) in the budding attribution, `morphology` (2D rim/core), `genomeRows` and
   `readGenomeChannels(0, GENOME_CHANNELS)` (44 words, a slab has 49), `tileSpeciesCensus`, `exchangePositions`. M5 either replaces, writes absent, or refuses each (§3).
6. Fine as they stand, because they are per-cell or label-overlap only: `lineageProfiles`/`roleSummary` (roles are cell-major `i * ROLE_WORDS`), `lineageBytes`, `Tracker.update` (needs only `labels`;
   `labelCount() === cellCount(cfg)` holds), `ActivityTracker`, `fluxRates`, `totalsOf`, `stateHash`/`artifactDigest`/`encodeCheckpoint` (take `genomeChannels(cfg)` since M0).
7. `RefSim3` already honours `cfg.neutral` with `generalistGenome3(defaultMu, defaultSigma)` (`step3d.ts:180`); no new sim code, only a runner-level neutral test.
8. `parseOverrides` allows only `mutRate`, `pondDeath` (`runner.ts`, `OVERRIDE_KEYS`); no test names its message. M4's grid needs `defaultMu`, `defaultSigma`, `lightK` per run, so the allowlist is
   widened (§2), not a private M4 harness: one code path, and `sameCompletedRun` already distinguishes overrides.
9. `requestDevice` (`gpu-sim.ts:77`) sizes from `GENOME_CHANNELS` = 44; `requestDevice3` (49) exists. `tools/run.ts:206` must pick by `isSlab`.
10. M3 built its world as `defaultConfig({tileW:256, tileH:256, tileD:8, lightK:1024, kernelRadius:3, seed:101, defaultMu:60, defaultSigma:20, lightMode:"uniform", lightBase:40, lightAmp:200})`
    and `slabSpotsWorld(cfg, generalistGenome3(60, 20), 8, 32, 64)`. The preset reproduces that exactly (test in §8.5). It reached 95 % living at step 7,020, so the placeholder
    parameters are a carpet; M4 chooses the real ones.
11. A slab bundle is big: a state is 7 cell channels (14.7 MB) + 49 genome channels (103 MB); the end-of-run `readState` and `artifactDigest` handle ~118 MB. `lineages.tsv` is written per census for
    every lineage (living cells up to 50 % of 524,288), so it can reach hundreds of MB per run (§10).

## 0. Pre-change capture (before any edit)

On the unmodified tree:

1. **Byte-identity pin.** Write `packages/runner/test/bundle-2d-pin.test.ts` first. It runs `runExperiment` through a `vi.mock("@bl/sim-gpu")` fake backed by `RefSim` (copy `sun.test.ts`'s
   `FakeGpuSim` shape: `create/run/drainLedger/readSnapshot/readStats/readState/readGenomeChannels/upload/destroy`, plus `setLight/lesion/feed` for the intervention spec), with an in-memory `Sink`, for small
   2D specs (overrides shrink the tiles as `sun.test.ts` does):
   (a) `spots` 32 x 32, 60 steps, census 10, deep 2, checkpoint 20; (b) the same with `lineageObs` and `speciesCensus`; (c) `archipelago` shrunk (migration fires);
   (d) `ponds-small` shrunk (pond cycle, `ponds.tsv`); (e) `spots` with one lesion and one feed in `interventions`.
   Digest every written file (SHA-256 over sorted `path\0bytes`); for `manifest.json` strip `startedAt`, `finishedAt`, `summary.wallSeconds`, `summary.stepsPerSecond`, `host` before digesting.
   `.blck` bytes, `series.jsonl`, `lineages.tsv`, `life.jsonl`, `activity-final.json`, `heredity.tsv`, `mutations.tsv` pin as they are.
   Commit the digests as literals; the test must pass green on the unedited tree **before** any runner edit, and pass again, literals untouched, at the end.
2. **Real-GPU A/B baseline.** `git archive HEAD | tar -x -C <scratchpad>/base` (read-only on VCS: no worktree, no branch), `ln -s` the repo's `node_modules`, then with Deno
   (`deno run -A --no-lock tools/run.ts ...`) write bundles to `<scratchpad>/ab-base`: `spots` 2,000 steps census 100 deep 10 checkpoint 1000, with and without `--lineage-obs`; `archipelago` 1,000 steps
   census 100; `ponds-small` through one boundary. After M5, rerun the same commands from the worktree into `ab-new` and `diff -r` with the five manifest fields normalised (a scratchpad script): the diff must be empty.
3. Run once, record green: `pnpm test` (the three `vi.mock` suites by name), `golden-hashes.test.ts`, `deno run -A --no-lock tests/deno/{gpu_golden,segments,stitch}.ts`.

## 1. New files

| path | contents |
|---|---|
| `packages/metrics/src/census3.ts` | `census3`, `layerRoles`, `LAYERS_HEADER`, `layersRows` |
| `packages/metrics/test/census3.test.ts` | §8.1 |
| `tools/lib/slab-readout.ts` | pure readout: TSV parse, exact rationals, the fixed check, markdown |
| `tools/test/slab-readout.test.ts` | §8.4 |
| `tools/slab-readout.ts` | Deno CLI over the bundles; writes `readout.md`, `readout.json` |
| `tools/slab-screen.ts` | Deno CLI: run the arms and seeds through `tools/run.ts`, skip finished bundles |
| `packages/runner/test/slab-run.test.ts` | §8.2, `RefSim3`-backed fake `GpuSim3` |
| `packages/runner/test/bundle-2d-pin.test.ts` | §0.1 / §8.3 |
| `packages/schema/test/slab-preset.test.ts` | §8.5 |
| `tests/deno/slab_run.ts` | §8.6, real GPU against `RefSim3` in lockstep |

## 2. Shared-code edits (all gated; 2D paths unchanged)

- **`packages/schema/src/presets.ts`.** `InitKind` gains `"slab-spots"`. `foundingWorld` gains a case before the `default`:
  `slabSpotsWorld(cfg, generalistGenome3(cfg.defaultMu, cfg.defaultSigma), init.founders, init.nutrient, init.biomass)`. `presetIdentity` takes its existing non-pond path unchanged.
  New `export const SLAB_PRESETS: Preset[]` and `export function presetById(id)` (`PRESETS.find` then `SLAB_PRESETS.find`). `PRESETS` itself is not touched, so `presetIdentity` pins,
  the lab catalogue and the coordinator copy test are unaffected.
- **`packages/metrics/src/census.ts`.** `Component` gains an optional `cz?: number`; `census()` is not edited (no `cz` key, so serialised individuals and 2D outputs are identical).
  `packages/metrics/src/index.ts` exports `census3.ts`.
- **`packages/runner/src/observe.ts`.** `observeCensus` takes `const slab = isSlab(cfg)`: `const c = slab ? census3(...) : census(...)`. For a slab: no budding attribution (every `birth` stays
  a `birth`; `buddings` stays 0); `sym = new Uint8Array(0)` and `obs.prevSym` stays `null` (so `prevSym` serialises as before, and `CensusObservation`'s type is unchanged for the lab).
  New export `SLAB_ABSENT_METRICS` (§3). The 2D branch is the existing code, unmodified.
- **`packages/runner/src/runner.ts`.**
  1. `specConfig` and `runExperiment` use `presetById`.
  2. `slabSpecError(spec, cfg, opts)` (exported; called in `runExperiment` next to `branchError`, before anything is built or the GPU touched, and by `tools/run.ts`'s preflight, exit 2): when `isSlab(cfg)`
     it refuses `speciesCensus`, `lineageObs`, `preCycleCheckpoints`, `branch`, `picked`, `pressures`, `metapopulation`, `interventions` (non-empty), and `opts.start`, `opts.observer`, `opts.immigrant`,
     `opts.branchFrom`, `opts.picker`, `opts.picks`. A slab run is one whole history from step 0; each refusal names its reason. `checkpointEvery > 0` stays allowed (forensics only;
     `tools/run.ts` warns each checkpoint is about 120 MB).
  3. Simulation: `const sim = isSlab(cfg) ? await GpuSim3.create(device, actualInit) : await GpuSim.create(device, actualInit)`, typed `GpuSim | GpuSim3`. The three intervention call sites
     (`sim.setLight` x2, `applyScheduled(sim, e)`) go through a small `gpu2d(sim): GpuSim` guard (`sim instanceof GpuSim`, else throw "unreachable on a slab: slabSpecError refused the schedule"); they are
     reachable only when a schedule or sun exists, which a slab refuses. With a mocked `GpuSim` class the guard is true for the fake, so the 2D mocked suites are unaffected. `pnpm typecheck` confirms
     `GpuSim3` is assignable at every other call; if a signature differs, narrow with `Pick<GpuSim, ...>` rather than casting.
  4. After `manifest.json`'s first write, slab only: `await sink.writeText("layers.tsv", LAYERS_HEADER)`; the manifest gains `layers: { file: "layers.tsv", depth: tileD }` and
     `absentMetrics: SLAB_ABSENT_METRICS` (slab only, so a 2D manifest keeps its exact shape).
  5. In the census loop, after `observeCensus`: `if (slab && deep && snap.roles) await sink.appendText("layers.tsv", layersRows(c.step, layerRoles(cfg, snap.roles)))`.
     The 2D-only metrics are wrapped: `rec.patternEntropy`/`temporalMI` only when `!slab`; inside `if (deep && snap.roles)`, `lineageCompression` stays (a 1D stream), while `patternCompression`
     and `morphology` are `!slab` only. `rec.roles`/`rolesPresent` stay.
  6. `OVERRIDE_KEYS` becomes `["mutRate", "pondDeath", "defaultMu", "defaultSigma", "lightK"]`; the doc comment and the error text list them. Range and slab-pairing checks stay `validateConfig`'s
     (`lightK` on a 2D preset fails with "tileD and lightK are set together"). A run without `--override` is unchanged.
- **`packages/runner/src/interventions.ts`.** `interventionsError` returns "interventions are not defined for a slab" when `isSlab(cfg)` and the list is non-empty, checked first (a z-less x/y
  check would otherwise misjudge it).
- **`packages/sim-gpu/src/create.ts`.** Add `requestDeviceFor(gpu, cfg)`: `isSlab(cfg) ? requestDevice3(gpu, cfg) : requestDevice(gpu, cfg)`.
- **`tools/run.ts`.** `requestDeviceFor` at line 206 and the preflight call to `slabSpecError`; header comment gains the slab notes (`layers.tsv`, the new override keys, no forks).
  `README.md` gets a two-line entry for the two new tools.

`METRICS_VERSION` stays as it is: no 2D metric changes, and bumping it would change every 2D manifest. The slab bundle says what it omits in `absentMetrics`.

## 3. The slab census and the "absent for slabs" list

**`census3(inp, opt = DEFAULT_CENSUS): Census`** (same `Census` shape, so `Tracker` and `ActivityTracker` consume it unchanged). Throws if `!isSlab(cfg)`. Index `i = z*W*H + y*W + x`. Cells with
`B + P >= opt.threshold` (48) are bound; components are **6-connected**: `±x`, `±y` wrap within the tile (as the dynamics do), `±z` do not wrap (z is closed). `labels: Int32Array(n)` (-1 background);
per component: `cells, mass, biomass, lineage, purity, mu, sigma` as in 2D; `tile = 0`; centroid `cx, cy` from unwrapped x/y offsets accumulated in the BFS and wrapped back into `[0, W)`, `[0, H)`
as 2D does; `cz` the mass-weighted mean z. `lineages` and `livingCells` are the same tally as 2D (cells with a nonzero lineage id, per key cells and mass, sorted by mass); the ~15 tally lines are
duplicated rather than extracted, so `census()` is not edited. The default thresholds are kept; a ball of radius 3 at biomass 64 is 123 cells of mass ~64, far above `minMass` 256.

**`layerRoles(cfg, roles): LayerRoles[]`** with `LayerRoles = { z, photo, grow, decomp, resp, saturated }`, one entry per layer; `roles` is cell-major (`roles[i*ROLE_WORDS]` = `photo | grow << 16`,
`roles[i*ROLE_WORDS+1]` = `decomp | resp << 16`, as `step3d.ts:680`). Sums are plain JS numbers (at most 65,536 cells x 65,535 < 2^53, exact). **`saturated`** counts, in the layer, the 16-bit count fields
equal to 65,535 (0..4 per cell); this is the plan's "saturated role words", read per counter because saturation is per counter ("each saturated at 65,535"). It is reported only (§7).

`LAYERS_HEADER = "step\tz\tphoto\tgrow\tdecomp\tresp\tsaturated\n"`; `layersRows(step, rows)` emits one line per layer, ascending z, so a deep census adds exactly D = 8 lines.

**`SLAB_ABSENT_METRICS`** (exported from `observe.ts`, written to the slab manifest as `absentMetrics`, each with its reason in a comment):

| metric | why absent |
|---|---|
| `patternEntropy`, `temporalMI`, `patternCompression` | `blockSymbols` 2 x 2 blocks of a flattened layer stack; no 3D analogue defined |
| `morphology` | rim/core, membrane fraction and differentiation assume 2D neighbours |
| `buddings` and `budding` life events | attribution uses `tileDistance2` (x/y only); births stay `birth` events, `buddings` is 0 |
| `species.tsv` (`speciesCensus`) | per-tile species census over 44-word genomes; **refused** |
| `profiles.tsv`, `genomes.tsv`, `births.tsv` (`lineageObs`) | `genomeRows`/`readGenomeChannels` hard-code 44 words; **refused** |
| `migrations.tsv`, `exchanges.tsv`, `ponds.tsv`, `cells.tsv`, `interventions.jsonl` | the mechanisms are out of the slab (plan §1); **refused or never written** |

Kept and valid on a slab: `individuals`, `meanMass`, `livingCells`, `lineages`, `lineageShannon`, `pools`, `rates`, `bioticRecycling`, `activity`, `fissions`, `fusions`, `maxGeneration`, `mutations`,
`conservationOk`, `roles`, `rolesPresent`, `lineageCompression`; `life.jsonl`, `heredity.tsv`, `mutations.tsv`, `lineages.tsv`, `activity-final.json`.

## 4. The `slab-spots` preset

`SLAB_PRESETS = [{ id: "slab-spots", name: "Slab spots", description: ..., init: { kind: "slab-spots", founders: 8, nutrient: 32, biomass: 64 }, cfg }]` with
`cfg = { tileW: 256, tileH: 256, tileD: 8, kernelRadius: 3, lightK: 1024, defaultMu: 60, defaultSigma: 20, lightMode: "uniform", lightBase: 40, lightAmp: 200 }`
(plan §5.1: light at the surface 240, seasons off). `mu`, `sigma`, `lightK` are **M3's fixed placeholders and the preset's parameters**: M4 chooses the real ones, and the check's runs pass them
explicitly as overrides (§6), so the preset never has to move after the M4 amendment. Founders: 8 balls of radius 3 at `lowbias32(seed*313 + i)` positions, as `slabSpotsWorld` does; both arms start
from `generalistGenome3`, the neutral reference. The `neutral` condition (`{ neutral: true }`) needs no change; `uniform-light` and `fixed-env` throw on this preset, as they do on `spots`.

## 5. Bundle shape for a slab run

Written: `manifest.json` (+ `layers`, `absentMetrics`), `series.jsonl`, `mutations.tsv`, `lineages.tsv`, `life.jsonl`, `heredity.tsv`, `activity-final.json`, `layers.tsv`, optional `checkpoints/`.
Not written: everything in the §3 refused rows. Run settings the screen uses: census 1,000, deep 1, checkpoint 0, threshold unset.

## 6. `tools/slab-screen.ts` (running only; reading is `slab-readout.ts`)

```
deno run -A --no-lock tools/slab-screen.ts --out runs/3d-slab/check1 --mu M --sigma S --light-k K \
   [--arms evolving,neutral] [--seeds 1-3] [--steps 300000] [--experiment slab-check] [--census 1000] [--checkpoint 0] [--dry-run]
```

- `--mu`, `--sigma`, `--light-k` are **required, with no default**: the M4 pick is typed in, never assumed. They go to `tools/run.ts` as
  `--override defaultMu=M,defaultSigma=S,lightK=K`, so they sit in every manifest's `spec.overrides` and `cfg`.
- Arms map to conditions: `evolving` = `treatment`, `neutral` = `neutral`. Preset `slab-spots`. `--deep 1` is always passed (not a flag). Seeds outer, arms inner (as `own-screen.ts`), so an interrupted
  queue leaves matched pairs. `--seeds` accepts lists and ranges (`1-3`, `4-6`, `2`), so the two Macs take disjoint subsets; the extension is the same command with `--seeds 4-6`.
- Per run directory `<out>/<experiment>/slab-spots/<condition>/seed-<n>/`: manifest with `summary` present and `sameCompletedRun` true -> `skip (complete)`; a complete manifest with a different spec
  or config -> exit 2 (never overwritten silently); an incomplete directory is removed and re-run from step 0 (`run.ts` rewrites the text files, removal also clears `checkpoints/`).
  "Resumable" means exactly this: re-running the command picks up at the first unfinished run. A mid-run resume would need a ~120 MB checkpoint per save and a continuation observer for
  `layers.tsv`; it is out of scope and refused by `slabSpecError`.
- `--dry-run` prints each run, its state (complete, incomplete, absent) and a minutes estimate (steps at 200 steps/s, from the M3 note) and runs nothing.
- Per run: wall time and `st/s` (same parse as `own-screen.ts`); the first failure stops with a non-zero exit.

## 7. The readout, executed exactly

### The rule (brainstorm §5, rung 1b, verbatim) and plan §5.2

> - *Activity.* The role buffer holds each cell's last-step photo, grow, decomp and resp counts (saturated
>   at 65,535; saturation is reported, not corrected). For a layer group, sum each of the four counts over
>   its cells and over the 10 censuses ending at step 300,000, so one quiet step does not decide anything.
> - *Photo share* of a layer group = photo / (photo + grow + decomp + resp). If the total is zero, the
>   share is undefined.
> - *D* = photo share of the top two layers − photo share of the bottom two. If either share is undefined,
>   that seed fails.
> - *Bar.* Run 3 neutral seeds. Let m be the mean of their D and r the range (max − min). An evolving seed
>   passes if its D > m + r.
> - *Decision.* 3 of 3 evolving seeds pass: go to rung 2. 0 of 3: depth did nothing beyond the light, and
>   the line pauses. 1 or 2 of 3: run 3 more seeds of each arm, recompute m and r over all 6 neutral seeds,
>   and go only if at least 5 of the 6 evolving seeds pass; otherwise pause.

Plan §5.2 fixes: top = z in {0, 1}, bottom = z in {6, 7}; seeds 1, 2, 3 for both arms, 4, 5, 6 for the extension; the ten censuses are steps 291,000 ... 300,000; an undefined neutral D is not dropped,
replaced or rerun and gives **pause: control undefined**, in the first 3 + 3 and in the extension; an undefined evolving D fails that seed.

### Module `tools/lib/slab-readout.ts` (pure: no Deno, no fs; the CLI loads text and passes it in)

- Constants, not options: `TOP = [0, 1]`, `BOTTOM = [6, 7]`, `DEPTH = 8`, `CENSUS_EVERY = 1000`, `FINAL_STEP = 300000`, `WINDOW = 10`, `FIRST_SEEDS = [1,2,3]`, `EXTENSION_SEEDS = [4,5,6]`.
- `parseLayers(text)`: exact header, 7 integer columns, `z` in `0..DEPTH-1`, no duplicate `(step, z)`. Failures throw `InputError` (an operational failure, never a verdict).
- `seedStats(layersText, manifest)`: validates the manifest (`summary` present, `summary.steps === FINAL_STEP`, `spec.censusEvery === 1000`, `spec.deepEvery === 1`, `cfg.tileD === 8`) and that **every** step in
  `291000, 292000, ..., 300000` has all 8 layers, else `InputError`; it does not trust that `layers.tsv` happens to hold ten censuses. Rows at other steps are ignored. Sums photo, grow, decomp, resp over
  (window steps x group layers) as **BigInt**, and the saturated count likewise. Output per group: the four sums, `shareTop`, `shareBottom` as exact rationals or `undefined`, `D` exact or `undefined`.
- Arithmetic is an exact rational `{n: bigint, d: bigint}` (normalised): share = photo / (photo + grow + decomp + resp); D = shareTop − shareBottom; m = (sum of neutral D) / k; r = max − min;
  pass iff `D > m + r` **strictly**, by cross-multiplication. No floats in the decision; decimals are printed beside the fractions for reading.
- `decide({ evolving: Map<seed, SeedStats>, neutral: Map<seed, SeedStats> })` is the whole rule and returns `{ phase, verdict, reason, bar, perSeed }`:
  1. Both arms must hold seeds 1-3 (else `InputError`). **Phase 1 uses seeds 1-3 only**; seeds 4-6, if present, are listed "not used" unless phase 1 says extend.
  2. Any of the three neutral D undefined -> verdict **`pause: control undefined`** (the bar cannot be formed; nothing is dropped, replaced or rerun; the extension is not consulted).
  3. Otherwise m, r from the three neutral D. An evolving seed with D undefined fails; the others pass iff `D > m + r`. Count p of 3: 3 -> **`go`** ("go to rung 2"); 0 -> **`pause`** ("depth did nothing
     beyond the light"); 1 or 2 -> **`extend`**.
  4. On `extend`: seeds 4-6 must be present in both arms. If any is missing -> **`extend: waiting for seeds ...`** (the CLI exits 3). If present: any of the six neutral D undefined ->
     **`pause: control undefined`**; else m, r are **recomputed over all six neutral D**, each of the six evolving seeds is judged against that bar (undefined evolving D fails; seeds 1-3 are re-judged against
     the new bar), and `>= 5` of 6 pass -> **`go`**, else **`pause`**.
- `render(decision)` produces the markdown: per seed and arm the group sums, shares, D (fraction and decimal), the bar `m`, `r`, `m + r`, pass/fail, the saturation table, the verdict line.
- **Saturation** is a column and a paragraph: per seed, saturated count fields in the top group, the bottom group and all layers, over the `WINDOW x cells x 4` fields examined, with the note "reported, not
  corrected". A non-zero count prints a flag line but **never enters `decide`** (a test asserts the verdict is unchanged when saturation counts change).

### CLI `tools/slab-readout.ts`

`deno run -A --no-lock tools/slab-readout.ts --out runs/3d-slab/check1 [--experiment slab-check]`. Reads `manifest.json` and `layers.tsv` of the up to 12 bundles, checks that **all bundles agree on
`cfg` except `seed` and `neutral`** (and on `ruleVersion` and `spec.overrides`), and prints the shared `defaultMu/defaultSigma/lightK` so the M4 amendment can be compared by eye. Writes `<out>/readout.md` and
`readout.json` (rationals as `"n/d"` strings). Exit codes: 0 a verdict, 2 `InputError`, 3 extension seeds incomplete. A hidden `--rehearsal-steps N` (the final step of a short rehearsal run) swaps `FINAL_STEP`
for N and writes only `readout-rehearsal.md` under a "REHEARSAL, not a check result" banner; the real file names are written only for 300,000.

## 8. Tests

1. **`census3` (`packages/metrics/test/census3.test.ts`).** Two balls touching only diagonally (a shared corner) are two components under 6-connectivity; a ball straddling the x seam and one straddling the
   y seam are single components with centroids that wrap back into range; layers 0 and 7 never connect (z closed) while 0 and 1 do; threshold and `minMass` through the tracker; `labels` covers all `n` cells;
   **equivalence with the 2D census**: a slab with all mass in one layer yields the same components (cells, mass, lineage, purity), lineages and `livingCells` as `census()` on that layer as a 2D config;
   `Tracker.update` over two censuses of a moving ball gives the expected event sequence and `labelCount() === n`; `layerRoles`: indexing by layer, the four sums, saturation counted per 16-bit field
   (a word with both halves 65,535 counts 2), an all-zero layer; `layersRows` line count and format.
2. **Slab through `runExperiment` (`packages/runner/test/slab-run.test.ts`).** A `vi.mock("@bl/sim-gpu")` fake exposing `GpuSim3` (and a throwing `GpuSim`), backed by `RefSim3` (roles from `ref.roles`,
   events from `run`), overrides `tileW/tileH: 32`. (a) 40 steps, census 10, deep 1, evolving: the bundle holds the §5 files and none of the refused ones; `layers.tsv` has the header and 4 censuses x 8 rows,
   its sums equal an independent lockstep `RefSim3` + `layerRoles` recomputation; `series.jsonl` has `roles`, `rolesPresent`, `lineageCompression`, `conservationOk: true` and none of the absent keys; the manifest
   has `layers`, `absentMetrics`, `cfg.tileD: 8`; (b) `deepEvery: 2` writes `layers.tsv` rows only at deep censuses; (c) the **neutral** condition runs and, with `mutRate: 0`, ends with the same `stateHash`
   as treatment (both start from the lifted generalist); (d) every `slabSpecError` refusal and the `interventionsError` slab message fires before the device is touched (`fakeDevice = {}`), with its message;
   (e) `parseOverrides` accepts the three new keys and still refuses unknown ones; `specConfig` resolves `slab-spots` and still throws for an unknown id. The three existing `vi.mock` suites run unchanged.
3. **2D byte identity (`bundle-2d-pin.test.ts`).** §0.1's digests, captured before the runner edit, never edited.
4. **Readout (`tools/test/slab-readout.test.ts`)** on synthetic `layers.tsv` text from a helper `layersFor({z: {photo, grow, decomp, resp, sat}}, steps)`: counts in layers 0/1 and 6/7 are the
   group totals; layers 2-5 carry large decoy counts, and rows outside the window are decoys too; neither may change anything.
   - **go**: three neutral seeds with D near 0 and three evolving seeds well above m + r -> `go` in phase 1, seeds 4-6 listed unused even when present with failing data.
   - **pause (0/3)**: evolving D equal to the neutral ones -> `pause`, reason "depth did nothing beyond the light".
   - **extend -> go**: 2 of 3 pass, seeds 4-6 supplied, at least 5 of 6 under the **recomputed** bar -> `go`; and a variant where a first-three seed passed the 3-seed bar but fails the 6-seed bar so the count is 4 -> `pause`.
   - **extend -> pause**: exactly 4 of 6 -> `pause`; exactly 5 of 6 -> `go` (the boundary).
   - **extend waiting**: 1 of 3 with seeds 4-6 absent or partly present -> `extend: waiting for seeds`, the exit-3 shape.
   - **undefined evolving D**: one evolving seed with an empty top (or bottom) group fails that seed; with the others passing the result is 2/3 -> `extend`, not `go`; all three undefined -> 0/3 `pause`.
   - **undefined neutral D** in seeds 1-3 (empty bottom group in one neutral seed) -> `pause: control undefined`, even when all three evolving seeds are far above any bar and even when seeds 4-6 exist;
     the same for an undefined neutral D **only in seeds 4-6** during an extension.
   - **tie**: `D == m + r` exactly (integer counts chosen so the fractions are exact) does **not** pass (strict); one more photo count does.
   - **exactness**: two D values equal as rationals but not equal as naive floats compare equal; m with k = 3 and k = 6 is exact.
   - **saturation**: non-zero saturated counts appear in the table and the flag line; changing them changes no verdict, bar or share.
   - **input errors** (`InputError`, no verdict): a missing census in the window, a duplicate `(step, z)`, a bad header, `summary.steps !== 300000`, `deepEvery !== 1`, `tileD !== 8`, seeds 1-3 missing.
5. **Preset (`packages/schema/test/slab-preset.test.ts`).** `PRESETS` contains no `slab-spots`; `presetById("slab-spots")` resolves and `presetById("spots")` still does; `presetConfig(slab-spots, 101)` deep-equals M3's
   literal `defaultConfig({...})`; `stateHash(initWorld(cfg, init))` equals the hash of M3's `slabSpotsWorld(cfg, generalistGenome3(60, 20), 8, 32, 64)`; `validateConfig` is clean; `presetIdentity` is stable.
6. **`tests/deno/slab_run.ts` (real GPU).** `slab-spots` shrunk to 32 x 32 x 8, 60 steps, census 20, deep 1, both conditions, through the real `runExperiment`/`GpuSim3`; in lockstep a `RefSim3` produces the expected
   `layers.tsv`, `lineages.tsv` and the `series.jsonl` fields (roles, living cells, individuals), asserted equal as text. Then a **rehearsal at full size**: 256 x 256 x 8, 3,000 steps, census 1,000, deep 1, one seed per
   arm through `slab-screen.ts --steps 3000` and `slab-readout.ts --rehearsal-steps 3000`: it exercises the pipeline end to end and measures the census cost per 1,000 steps, the size of `lineages.tsv` and `layers.tsv`,
   and whether the mutation event buffer overflows at 1,000-step censuses on the slab (the 2D default `eventCap` is 65,536; if it overflows, `eventCap` becomes a preset parameter, which has no dynamical effect).

## 9. Gates and order of work

Gates: `pnpm typecheck`; `pnpm test` (rerun an unrelated timeout alone when the machine is loaded); `packages/sim-ref/test/golden-hashes.test.ts` untouched and green; the `bundle-2d-pin` literals untouched and green;
the three `vi.mock("@bl/sim-gpu")` suites green; `deno run -A --no-lock tests/deno/{gpu_golden,segments,stitch,slab_run}.ts`; `deno check tools/slab-screen.ts tools/slab-readout.ts tools/run.ts`; the §0.2 real-GPU 2D
A/B diff empty. The Codex Sol review before the commit belongs to the parent session (read-only, phase boundary); this work commits nothing.

Order, each step ending green:
1. §0 capture (pin test green on the unedited tree; A/B baseline bundles; baseline test run; check the mock-export assumption).
2. `census3` + tests (metrics only; nothing else imports it yet).
3. Preset: `SLAB_PRESETS`, `presetById`, `InitKind` branch, `requestDeviceFor`, preset tests.
4. Runner: `slabSpecError`, inline `GpuSim3` branch and union guard, `observeCensus` routing, `layers.tsv`, gated metrics, manifest keys, `OVERRIDE_KEYS`, `interventionsError`; `slab-run.test.ts`; re-run the pin and the three mocked suites.
5. `tools/run.ts` device and preflight; `slab-screen.ts`.
6. Readout lib + tests, then the CLI.
7. `tests/deno/slab_run.ts` and the full-size 3,000-step rehearsal; record the measured numbers for the parent's result section.
8. §0.2 A/B diff, then the full gate list.

## 10. Risks and decisions for the parent

- **"Saturated role words"** is not defined in the fixed text. This plan counts 16-bit count fields at 65,535 per layer (per counter). If the intended unit is the 32-bit word (either half saturated),
  only a reported column changes. It never enters the decision.
- **`OVERRIDE_KEYS` widened** to `defaultMu`, `defaultSigma`, `lightK` so `slab-screen` serves both M4 (grid, seeds 101-103, `--steps 50000`) and M6. 2D runs without `--override`, and existing manifests, are unaffected.
- **M4's light qualifier** (light at layer 7 averaged, 5 % to 80 % of layer 0) needs per-layer light, which the fixed `layers.tsv` columns do not carry and which is derived, not state. This plan leaves it out of
  `layers.tsv`; M4's tool can compute it from the final state with `new RefSim3(state).lightColumn()` (public) or `GpuSim3.readLight()`. Say if a `light` column should be added instead (a format change to a fixed file).
- **Disk and time.** `lineages.tsv` per run may be hundreds of MB at a carpet; the rehearsal measures it. Twelve runs at roughly 25 to 50 minutes each; the two Macs split by `--seeds` or `--arms`.
- **Slab bundles are not stitchable or analyzable** (`tools/stitch.ts`, `tools/analyze.ts`, islands, coordinator) and cannot be forked (`--start-from`); `slabSpecError` and the 2D-only preset list keep them out.
- **Mock-export assumption** (fact 2) is checked in step 1 of the order of work, with a stated fallback.
- **M3 cross-check.** The preset must equal the M3 protocol config; the test in §8.5 is the guard if either file changes.
- **Census thresholds** stay at the 2D defaults (48, 256). Individuals-per-seed numbers are informational for this check; nothing in the decision uses them.

## Review

Codex Sol and an independent audit reviewed M5. No threshold, layer group, seed, cadence or decision branch changed; every fix is in what the readout accepts as input, in one ordering inside `decide`, or in reporting. Outcomes, in the order of the findings:

1. **P1, slot identity (`tools/slab-readout.ts`). Accepted and fixed.** `checkBundleIdentity` (`tools/lib/slab-readout.ts`) now runs on every finished bundle: the manifest's `spec.experiment`, `presetId`, `condition`, `seed` and `steps` must equal the slot the directory names, `cfg.seed` must equal the seed, `cfg.neutral` must equal `arm === "neutral"`, and the whole `cfg` must equal what `specConfig` builds for that spec (an arm's `neutral` flag and seed included). `checkDistinctHistories` additionally refuses two slots holding the same `summary.finalHash`, and a missing hash (the repeated-layout slip survives a rewritten manifest only if the histories are byte-identical, which this catches). Both throw `InputError` (exit 2). Tests: `tools/test/slab-readout.test.ts` ("what a bundle must be") and the CLI test ("not the run of its slot"), including the repro (seed-1 copied into treatment 1, treatment 2 and neutral 3).
2. **P1, fixed configuration (`tools/lib/slab-readout.ts:161`). Accepted and fixed.** The same check pins the protocol world independently of the code's preset: `PROTOCOL_CFG` (256 x 256 x 8, one tile, kernel radius 3, uniform light 40 + 200, seasons off) and `PROTOCOL_INIT` (slab-spots, 8 founders, nutrient 32, biomass 64), then full equality with `specConfig` (so a changed `kBuild` or the like also fails; `ruleVersion` is excluded there and stays the cross-bundle agreement's business). `spec.overrides` must be exactly `defaultMu`, `defaultSigma`, `lightK`, integers, equal to the `cfg` values, and are otherwise whatever the bundles record (M4's pick is never assumed or hard-coded). The rehearsal is held to the same world (it is a full-size 3,000-step run). The old "not one check" cross-bundle test stays and still fires for bundles that are individually valid but disagree.
3. **P1, extension ordering (`slab-readout.ts:301`). Accepted and fixed.** The plan's wait-first ordering did conflict with the fixed rule ("an undefined neutral D (any neutral seed in play) is pause: control undefined"). In `decide`, after phase 1 says extend and before the missing-seed check, any finished neutral extension seed with undefined D returns `pause: control undefined` (no `waitingFor`, exit 0, `readout.json` written). Defined extension neutral seeds still wait; when phase 1 settles the decision the extension seeds are still not consulted. §7 step 4 above reads "If any is missing -> extend: waiting" first; this supersedes that order for the undefined-D case only. Unit test over holes in the top or bottom group and seeds 4, 5, 6 and 4+6 present; CLI test.
4. **P2, half-written bundle skipped (`tools/slab-screen.ts:89`). Accepted and fixed.** Complete now means: summary present, `sameCompletedRun`, `activity-final.json` exists (the runner's last write) and `layersIncomplete(layers.tsv, steps, censusEvery)` is null (newline-terminated, exact header, `ceil(steps/census) x 8` rows, last row layer 7 of step `steps`). Otherwise the state is `incomplete` (removed and rerun from step 0, with the reason printed). A complete manifest with a different spec still stops the queue before any file check. Tested with `--dry-run` on whole, no-activity, cut-off and no-layers bundles.
5. **P2, malformed dimensions. Accepted and fixed.** `seedStats` requires `cfg.tileW` and `tileH` to be safe positive integers (type-checked, no `Number()` coercion) and throws `InputError` otherwise, so the CLI exits 2 and never reaches `BigInt(NaN)`. Unit test over eight malformed shapes; CLI test (no `RangeError` in the output).
6. **P3, `interventions: []` on a slab (`runner.ts:573`). Accepted in part; the premise is wrong.** `validateSpec` already refuses an empty schedule ("interventions must be a non-empty array", `interventions.ts:96`) before `slabSpecError` runs, so `runExperiment` never wrote `interventions.jsonl` for a slab with `[]`; the finding's "passes validation" does not hold. As defence in depth the two pure checks now refuse any defined schedule on a slab (`slabSpecError`: `interventions !== undefined`; `interventionsError`: any array for a slab). 2D behaviour is unchanged (both are gated on `isSlab(cfg)`). Test asserts the run rejection message and both pure messages.
7. **P3, Codex checks 2, 3, 5 passed. Nothing to do.** Noted: the 2D byte-identity pin reproduces against HEAD; the founder `biomass: 64` is the existing noisy founding parameter.
8. **P3, verdict logic matches (audit). No change needed.** The audit's 900-bundle CLI diff and 60,000-case `decide()` fuzz had no mismatch; I reran `experiments/3d-slab/audit_readout_pure.ts` after fix 3: 60,000 cases, 0 mismatches (its generator does not produce the partial-extension-with-undefined-D case that fix 3 changes). `audit_readout_diff.ts` writes manifests without the identity fields and now stops with exit 2 by design; it is the auditor's file and is left as it is.
9. **P2, slot not checked (audit duplicate of 1).** Fixed by 1. The audit's three requirements (`cfg.neutral`, `cfg.seed`, `spec.condition` against the directory; refuse shared `finalHash`) are all implemented as stated, exit 2.
10. **P3, malformed `tileW`/`tileH` (audit duplicate of 5).** Fixed by 5.
11. **P3, strict `parseLayers` over the whole file and over unused bundles. Rejected, documented.** A duplicate `(step, z)`, a `z >= 8`, a trailing blank line or CRLF anywhere means the directory is damaged or was edited, and the fixed check forbids quietly working around a seed. Unused extension bundles (seeds 4-6 when 1-3 settled it) are still validated for the same reason: a malformed one exits 2 rather than letting a damaged tree pass. The cost is a possible exit 2 on rows the rule never reads; that is the conservative direction. No change.
12. **P3, stale `readout.*` and unreported `conservationOk`/`extinct`. Accepted and fixed.** The CLI removes the previous `readout.md`/`readout.json` (rehearsal: `readout-rehearsal.md`) before reading, so an exit 2 leaves no earlier verdict beside it. `readout.md` gains a "Run summaries (reported, not part of the decision)" table with `conservationOk` and `extinct` per bundle and a FLAG line when any bundle is not `true`/`false`; `readout.json` gains `bundles`. No threshold or branch reads them (CLI test: a non-conserving, extinct evolving seed still yields `go`).
13. **P3, 2D bundles unchanged (audit). No change needed.** Confirmed by the audit's 100-file SHA-256 A/B; the `bundle-2d-pin` literals are untouched, and this round's only runner edit is gated on `isSlab`.
14. **P3, end-to-end sanity (audit). No change needed.** `layerRoles` was not independently checked against a role-buffer read; the CPU and WGSL writers do match the 16-bit packing, and `tests/deno/slab_run.ts` compares the real-GPU `layers.tsv` to `RefSim3` as text.

Gates after the fixes: `pnpm typecheck` clean; `pnpm test` 160 files, 3813 passed, 5 skipped (the one failure of the first pass was my own test expecting the slab message for `interventions: []`, which `validateSpec` pre-empts, fixed above); `packages/sim-ref/test/golden-hashes.test.ts` and `packages/runner/test/bundle-2d-pin.test.ts` untouched and green; `deno check tools/slab-screen.ts tools/slab-readout.ts tools/run.ts` clean.

### Follow-up review (Codex Sol, 2026-10-23)

No P1. Three fixed by the lead: slab-screen now parses `activity-final.json` (an empty or cut-off last write is incomplete, not complete); slab-readout compares `spec.overrides` with sorted keys; the Markdown readout prints "not judged" (not "FAIL") for evolving seeds when no bar exists.
