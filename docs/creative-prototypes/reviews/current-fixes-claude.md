Quick status: I've read both reviews and checked the fixes in the source and tests. Everything is cleared except one low-severity item.

**Cleared**
- **`lateSummary`:** `explore.ts:128-155` accepts 21 or 22 rows. It requires either a scheduled tick or the exact extinction tick strictly inside (5000, 6000). It checks that `intervalFromTick` and `intervalToTick` are contiguous and that the interval durations total exactly 1000. The new test at `currents-evidence.test.ts:59-74` covers extinction at 5051 and gets `intervalCount` 21, `durationTicks` 1000 and the expected per-tick means.
- **Manifest and decoder:** `isExpectedConditions` (`replay.ts:48-53`) compares `id`, `mode` and `current` against `CURRENT_CONDITIONS`, for both the top-level and `replay.conditions`. The decoded map is keyed by `condition.id` (`replay.ts:108`), which is what `page.ts:169` looks up. The replay test fixtures now use the runner's object shape.
- **`.replay` containers:** The files have a neutral extension and are fetched as raw bytes. `decodeReplaySeed` checks compressed size and SHA first, then gunzips with `DecompressionStream`, then checks raw size and SHA before decoding any frame.
- **Packaging:** `Dockerfile.site` and `currents-packaging.test.ts` cover `currents-*.replay` and `current-pilot-*.json`. The Caddy regex is anchored, and the test checks it against `/currents`, `/currents/` and `/CURRENTS/...`.
- **Manifest reuse:** `selectReplaySeed` (`page.ts:234-251`) passes the already-validated `replayPilot` to `decodeReplaySeed`, so there is no per-seed refetch.
- **Pump arrows:** Both the live and replay paths now draw at y=.5 and y=47.5 (`page.ts:76-79,196`).
- **Phase-order oracle:** `currents-model.test.ts:53-58,131-145` builds two independent references, current-before-relax and relax-before-current. It asserts they differ, that the real run equals the first, and that it does not equal the second. That pins the order.

**Remaining (low, optional)**
- After a seed load fails (`page.ts:247-250`), the seed select is re-enabled, but picking the same seed again fires no `change` event. The user has to switch to another seed and back to retry. A retry button, or re-running the load on `focus` or `click`, would fix it. This is not a correctness issue.
- `loadReplaySeed` (`replay.ts:144-151`) still refetches the manifest and revalidates it on every call. It is now unused by the page. I'd delete it, or leave it because it's harmless.

I did not run tests, the build or the browser, and I did not read the pilot JSON. Numeric outcomes, the `?url&no-inline` Vite asset names, and browser captures are still yours to confirm.
