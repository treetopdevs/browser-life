**Clear.** I found no remaining blocker in the changed bindings. I used 5 reads and ran no tests.

- **`launch.sh` hash:** `shasum -a 256 tools/alternating-food/launch.sh` gives `1b113a8a…0da958e8`. That matches the pin in `explore.ts:51`, `alternating-food.js:18` and the `alternating-food.spec.ts:91` fixture. The launcher doesn't contain its own hash, so there is no circularity.
- **Launcher dependency (the closure-claude blocker):**
  - `launch.sh:21` requires `launch.sh` to be tracked, clean against `HEAD` and byte-equal to the committed blob.
  - `launch.sh:63` records `launcherSha256` in the intent.
  - `explore.ts:299` includes `launcherSha256` in the exact-key list for the intent.
  - `explore.ts:44-52` has `PINNED_INPUTS` with the launcher entry, and `explore.ts:650` adds it to `assertCommittedInputs`.
- **Historical key (the closure-codex blocker):** `explore.ts:48-50` uses full paths for the three split-food artifacts. The viewer and spec use the same full paths. The viewer's `EXPECTED_SOURCE_KEYS` is the pinned set plus the alternating model and `explore.ts`, which comes to 9 keys. The spec fixture has 9 keys as well.
- **Launcher pins:** `launch.sh:26-28` and the intent JSON hold the same historical artifact, index and validation hashes as the runner. The data hash and the other pins match `BASELINE_IDENTITY`.

Two things the parent should know:
- **Not read:** `explore.ts` lines 304-305 and 651 were long lines the grep omitted, so I didn't read them. They presumably hold the `launcherSha256`, `runnerSha256` and `modelSha256` comparisons. Check them if you want certainty.
- **Commit first:** `tools/alternating-food/` and the model are still untracked. `launch.sh:21-24` will refuse to run until those files are committed with these exact bytes. That is by design, but the parent must commit before launch, with no edits after the hash is pinned.
