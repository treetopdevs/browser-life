**No blocking correctness defects found in the model, runner, UI or packaging. No pilot reports exist, so outcomes and the visual gate are unreviewed.**

I changed no files and ran no tests, typecheck, build, Playwright or simulations, so everything below comes from reading. The vitest parity test is a 3000-tick run, so I left it to you. I read the stale `apps/lab/dist` that was already there. `hungry-shapes-implementation-claude.md` is empty and I did not write to it.

## What checks out
- **Original bytes unchanged:** `git status` is clean for `apps/lab/src/development/model.ts` and `tools/development/explore.ts`. Their hashes (`49416b11…` and `973ed60d…`) match both the header comment in the copy and `development-pilot.json`'s `sourceSha256`.
- **Original-mode parity:** the diff against the original is only mode plumbing, `foodTargetTiles`, `supplyFood`, the `environment` and `foodTargets` getters, the fixture `mode` argument and two exports. `snapshot()` is unchanged. `empty()` sets every new private field, which `Object.create` needs.
- **Baseline for the runner's original arm:** the 1201, 1202 and 1203 mutation-on runs are all alive at 3000, with snapshots at exactly 0, 1000, 2000 and 3000. Their Node version string (24.2.0) matches the runner's.
- **Pulse formula and ledger:**
  - The formula `((p*768+j)*2053 + seed%N) % N` matches the plan.
  - 2053 is coprime with 9216 and with 972, and 768 < 972, so targets are distinct within a pulse.
  - `supplyFood` touches no RNG.
  - The identities `offered = accepted + overflow`, `accepted = ledger.supplied`, `offered = pulses × budget` and `pulses = ⌊tick/5⌋` hold, including on the extinction tick.
- **Late window:**
  - Rows are pushed only for executed ticks, including the extinction tick, with the fixed denominator of 500.
  - Births are final minus the count at 2500, with a zero branch when extinction comes before 2501.
  - Milestone and terminal snapshots, and the sample at an extinction tick that is a multiple of 20, agree between the writer and the validator.
  - Max-ever generation comes from lineage, and dropped lineage and history are asserted zero.
- **Per-tick safety and replay:**
  - Connectivity uses the toroidal neighbour relation.
  - Occupancy-to-body agreement, caps, unique IDs, parent generation and family, and zero residual are all checked.
  - The primary and replay worlds are separate instances stepped in lockstep with full-state comparison at each census and milestone. `--replay-check` rebuilds the whole artifact.
- **CLI:** the main-module guard prevents a run on import. Writes use `wx`. The seed is explicit, there is exactly one action, and source hashes are compared before and after the run.
- **Packaging:**
  - The three emitted files (`hungry-shapes-model-*.js`, `hungryShapes-*.js`, `hungryShapes-*.css`) all fall under the Dockerfile removal globs.
  - The Caddy regex is anchored and case-insensitive. The page has noindex, the sitemap is untouched, and the directory count goes 14 → 15 in all three places.
- **Decision log:** `decisions.html` claims no outcome.

## Issues, ranked (none block the pilot)
1. **Food rendering seams** (`page.ts:111,117`): translucent fills use `Math.ceil(tile)` at fractional tile sizes (about 5.1 px at 1× on a 1920-wide desktop). Neighbouring tiles overlap and double-composite, which draws a lattice across the food and target layers. Food is what the parent judges visually. Fix: use integer edges (`round(x*tile)` to `round((x+1)*tile)`), or draw a 96×96 `ImageData` and scale it.
2. **Page dies on an insecure origin** (`page.ts:12`): `sha256(modelSource)` runs at module top level. Over `http://<lan-ip>` (for example a phone test), `crypto.subtle` is undefined, the module throws, and nothing renders. Compute the hash lazily in `downloadObservations` and show a message if it is unavailable.
3. **Shared-clock extinction and horizon logic is untested.** The plan lists extinction and horizon checks, and `development` has `comparison-clock.ts` with unit tests. Here the logic is inline in `page.ts`, and the e2e covers only start-paused, export, hidden and axe. I found no defect in the logic by reading.
4. **Runner paths are never executed by tests.** `evidence.test.ts` is synthetic. `runMode`, `assertWorld`/`connected` (including the failure paths) and extinction inside the late window (for example at 2500, 2600 or 3000) first run during the pilot. Small fixture tests would de-risk this.
5. **`--check` is too strict:** `checkEvidence` requires the current runtime (Node patch, platform, arch) to equal the recorded one. On another host it fails with "recorded seed/runtime differs". Compare the recorded Node to `EXPECTED_NODE` instead.
6. **Main guard can silently no-op:** it compares `resolve(argv[1])` to `import.meta.url`. If the checkout is reached through a symlinked path, `--check` or `--write` exits 0 with no output. Use `realpathSync`.
7. **Export hash test is weak:** the e2e only checks a 64-hex pattern. Assert it equals the SHA-256 of `apps/lab/src/hungry-shapes/model.ts` on disk.
8. **No emitted-file smoke:** the packaging test only string-matches configs. The plan wants a check that every `dist/assets/hungry*` file falls under a removal glob.
9. **Card header padding:** `body.hungry-page header` also matches `header.world-head`, adding 30/20/14 px side padding inside the cards. The same pattern exists in `development`.

## Optional
- The structure check does not cross-check late rows against census samples, `finalStateHash` against the last snapshot hash, or `finalCensus` against the last sample. `--replay-check` covers this.
- `SOURCE_PATHS` omits `development-pilot.json`, which the original arm depends on. The plan only requires the models and the runner.
- The "768 distinct additions" model test could get a `cells ∩ expectedAmounts = ∅` assertion. The founder's growth cell could land on a target tile.
- `environment.initialFoodPerTile` is hardcoded to 20, which is wrong for fixtures built with other food.
- The legend uses one amber swatch for "Living bodies", but bodies are family-coloured.
- The Caddy comment "Developmental bodies…" now sits above the hungry block.
- Uniform and patches carry `baselineCheckpoints: []` while the original run deletes the key.
- The decision panel says "will link… once the pilot is complete". Replace it with the real readout and link after the pilot.
- `role="status"` on the live tick clock will flood screen readers. `development` does the same.
- `assertWorld` calls `snapshot()` twice and `lineage` several times per tick, on both worlds. The pilot may run slowly, so record the runtime.
- The UI seed range (0 to 2³²−1) is wider than the CLI's (1 to 2³¹−1).

## Not yet reviewable
No `hungry-shapes-seed-*.json` or `.md` exists, so these are unexercised:
- the `--write`, `--check` and `--replay-check` paths;
- JSON/Markdown agreement;
- the original-arm parity against the baseline;
- outcomes and the visual comparison/gate.
