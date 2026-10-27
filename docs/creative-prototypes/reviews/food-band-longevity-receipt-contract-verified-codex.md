**Clear.** [Helper line 74](tools/food-band-longevity-diagnostics.mjs:74) and [viewer line 526](docs/creative-prototypes/food-band-longevity-viewer.js:526) use identical regex checks: `/not blind|non.?blind/i` and `/historical (?:moving )?media/i`.

Both test files assert rejection of the same negative wording, “Not blind: media are historical” ([helper test](tools/test/food-band-longevity-diagnostics.test.ts:90), [viewer test](tests/e2e/food-band-longevity.spec.ts:237)).

One `rg` read; no tests, edits, or outcomes.