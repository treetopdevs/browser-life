# Adversarial implementation review: nutrient currents

I reviewed read-only and ran nothing. I did not run `--check`, vitest, or the browser, and I did not decode the `.gz` files or verify their hashes. The pilot JSON and the three replay `.gz` files already exist. I read `current-pilot.md` and one regex-bounded slice of the JSON's `replay` header, not the full JSON.

**Summary:** there is one blocking defect: the replay loader cannot accept the manifest the runner wrote. The model, runner accounting and packaging look correct apart from low-severity items.

## Blocking

**1. Replay manifest schema mismatch: the browser rejects the real pilot artifact.**
- The runner writes `conditions` as the objects `{id, mode, current}`. That is in the top-level `data.conditions` (`tools/currents/explore.ts:223`) and in `replay.conditions` (`:124`). The runner's own validator pins that shape (`:244`, `:357`), and the JSON on disk has it: `"conditions":[{"id":"closed-still","mode":"closed","current":"off"},…`.
- `replay.ts` compares each entry to the string ids in `REPLAY_CONDITION_IDS`. This happens at `replay.ts:49` for `assertReplayManifest` and at `:60` for `assertReplayPilotArtifact`.
- `loadReplayPilot` therefore throws "conditions are not in the required order". The page shows "Pilot replay is unavailable" and no seed ever loads.
- Even if the checks were loosened, the decode loop at `replay.ts:100` uses `manifest.conditions` entries as the Map keys. `page.ts:169` looks them up by id string, so every frame would be `undefined` and the canvases would stay blank.
- `tests/e2e/currents.spec.ts:60-87` will fail now that `current-pilot.json` exists, because the `test.skip` guard no longer fires.
- The unit tests miss this because `currents-replay.test.ts:10,14` build a synthetic manifest with string ids. `currents-evidence.test.ts:45` builds one with objects. The two test files use different manifest formats.

**Fix (not frozen, and `replay.ts` is not in `SOURCE_PATHS`, so evidence stays valid):**
- Accept the object form and compare `c.id` and `c.mode`/`c.current` against `CURRENT_CONDITIONS`.
- Key the decoded Map by `.id`.
- Change the replay test fixture to the runner's exact shape, ideally by building it from the same `CURRENT_CONDITIONS` objects the runner emits.

## Low / latent

**2. Replay manifest is refetched and re-parsed per seed.**
- `loadReplaySeed` (`replay.ts:136-143`) fetches and revalidates the full pilot JSON again on every seed switch. `initializeReplay` (`page.ts:254`) has already loaded it.
- That JSON holds all snapshots and histories, up to the 16 MiB budget. Pass the already-validated `replayPilot` into `decodeReplaySeed` instead.
- Optionally, bound the decompressed read. `replay.ts:93` buffers the whole stream before checking its size. The compressed hash is already pinned, so the risk is low.

**3. `lateSummary` is brittle (`explore.ts:133`).**
- It requires exactly 21 history rows between 5000 and 6000. Extinction records an extra row at the exact extinction tick.
- A run going extinct at a non-multiple-of-50 tick inside (5000, 6000) would make `--write` throw, and so would validation. Extinction ticks are multiples of 10, so 80% of in-window extinctions would hit this.
- It did not trigger here: all four still conditions went extinct before 5000, and all current conditions survived.
- It's latent for this frozen batch, but it should be fixed before any rerun with different parameters. Filter to ticks that are multiples of 50, or record the extra row separately.

**4. Test gap: relax versus circulate order is not pinned.**
- `currents-model.test.ts:93-102` checks only that the fields differ at tick 4 and that `circulated` is 1000. A swap to relax-then-circulate passes both, because relaxation conserves the sum.
- The rain test pins rain-before-circulate, because the exact expected field would differ otherwise. It does not pin the other ordering.
- Add one exact-array assertion for the 1000-unit spike after tick 4.

**5. Pump arrows are drawn at the wrong rows.**
- `page.ts:78-79` draws the top arrow at y=1 and the bottom arrow at y=46. Those are grid lines between rows 0/1 and 45/46. The real turns happen at rows 0 and 47, so the bottom arrow sits about 1.5 rows too high. The same coordinates are repeated in the replay code at `page.ts:196`.
- Use y=.5 and y=47.5. This is cosmetic, but the bottom row is where detritus recycles, so the arrow should show it.

**6. Minor wording.** The report shows "none" for rain-versus-closed divergence on closed conditions, where it is not applicable (`explore.ts:402`).

## Checked and sound

- **Permutation:** `currentSuccessor` (`model.ts:158-164`) matches the authoritative paired-column spec on all four corners. The tests enumerate all 3072 cells and the 32×96 cycles, each reaching rows 0 and 47.
- **Phase order:** rain runs first, then the translate-all pulse (`tick%4`, from a copy), then relaxation. Mortality precedes extension, and everything else is as in the legacy model. `circulateNutrient` validates and copies its input and never aliases it.
- **Exact-off compatibility:** the unit tests cover seeds 0 and 1201 through 1000 ticks plus chunked stepping. The runner compares the legacy stepper every 100 ticks through 6000 for all 6 off-worlds. It strips only `current`, `rules.current` and `circulated`.
- **Per-step accounting (`assertWorld`):**
  - Global and per-pool identities, B ≤ 64 and no subthreshold biomass.
  - Immutable phases and monotonic reservoir.
  - Sediment 0, no resurrection, and rain import schedule.
  - `circulated` changes only on `tick%4==0` and equals the post-rain nutrient stock.
  - The pair-equality check before tick 4 and the first-divergence tracking are correct.
- **Replay binary:** LE condition-major, sorted ticks, N/B/D order is consistent across encoder, runner validator and browser decoder. The browser checks compressed size and hash, then decompressed size and raw SHA before decoding with a LE `DataView`.
- **Replay UI:** the 109-tick union matches in the runner and `replay.ts`. Dense and coarse playback run at 100 ms per frame. Stale seed loads are guarded by an abort controller plus a request counter.
- **UI clock:** all four worlds advance together and past extinction. The page starts paused and caps at 6000. Hidden pages stay paused.
- **Signed difference view:** it is computed from same-tick matched fields, clamped to ±8, and zero for still cards. The live and replay views agree at saturation.
- **Production exclusion:**
  - Dockerfile removals match Vite's asset naming. That covers the page, `currents-*.js`, `.css` and `.gz`, and `current-pilot-*.json`.
  - The Caddy regex is anchored and tested.
  - `/currents/` is in the public-routes `DIAGNOSTIC` list (noindex and unlisted).
  - The `/matter/` page has the one allowed navigation-only link.
- **Pilot report (md only):** labels are appropriately hedged ("Sampled peak", "alive at 6000", no adaptation claim). All four still conditions are extinct (790–1000) and all six current conditions are alive at 6000, so the negative baseline is retained.

## Parent to-do

After fixing item 1, run `--check` and the full e2e replay test. I'd also confirm that `import.meta.glob(...?url&no-inline)` returns the three `.gz` assets in your Vite build. I couldn't verify that.
