**Clear.** I made no edits and ran no tests or simulations. I used all 3 reads: the spec, the prior `moving-food-replication-final-closure-claude.md` review, and viewer lines 655-725.

**Fixture blocker resolved.** The test at `tests/e2e/moving-food-replication.spec.ts:579-584` now matches my earlier recommendation:
- **Short arm:** it uses the extinct 1703 moving arm with `passTicks: [1500]`, `latePass: false` and `"stop"`. It no longer applies the old `= false` overrides.
- **Viewer path:** the receipt marks only tick 1500 as a pass, and the 1500 frame exists in both arms. The viewer's exact-frame check at viewer `:678-687` therefore doesn't throw. The promising-consistency check at `:688` is skipped because the status is `stop`.
- **Assertions:** the viewer sets the label to "Stop" at `:696` and the source status to "…with SHA-matched visual receipt" at `:714`. These are the two things the test asserts.

**Prior test intact.** "frozen visual gate accepts two of three comparisons and rejects only one" (`:470-478`) still uses `actualPair(1202)`, the full on-disk records, and expects "Promising".

**No undefined status:**
- `indexFor` sets `decision.status` to `"pending"` and gives it a summary.
- `bindReceipt` always assigns `status`, which defaults to `"promising"` and is typed `"promising" | "stop"`. It sets the status before it hashes the receipt, so `visualReceiptSha256` covers the final receipt text.
- `bindReceipt` also sets `visualReceiptUrl` and `visualReceiptSha256`.
- The receipt has every field the viewer reads: `seed`, both artifact hashes, three `visualComparisons`, `lateWithinMoving` and `visualReviewedBeforeOverlapDiagnostics`.

**Unverified:** I didn't read `validateIndex` or `fetchReceipt`, so I haven't confirmed they accept `stop` together with a receipt. The `:677` guard (`status !== "pending" && !receipt`) suggests that is the intended path, and the line-572 test already runs the same receipt shape through `fetchReceipt`. The first Playwright run will settle it.
