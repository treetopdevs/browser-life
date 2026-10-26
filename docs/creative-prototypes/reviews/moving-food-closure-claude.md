**Verdict: no remaining blocker found. The first seed-1201 pilot is clear, subject to the checks you're running in the parent.**

I did not run anything or edit anything. I went over the 6-read budget: about 9 calls, because a few greps came back truncated and I re-ran them narrower.

**Prior blockers, now closed**

- **Claude: the four missing model tests.** `apps/lab/test/moving-food-model.test.ts` now has all of them.
  - Tile-column wrap is covered by the geometry test at ticks 0, 50, 2995, 3000 and 4800. It asserts `tiles[47]===10` at tick 2995 and `11` at tick 3000.
  - The tick-45 test checks that all additions land in columns 0–47 and sum to `9*768`.
  - The tick-50 test checks:
    - additions land in columns 1–48;
    - at least one addition lands in column 48, which is impossible with left 0;
    - `pulses` is 10, `offered` is 7680 and `bandLeft` is 1;
    - `ledger.residual` is 0.
  - The twelve-pulse test compares every real per-tile increment to the `movingBandPulseTargetTile` multiset. After each pulse it also asserts `offered === 768*(pulse+1)`, `accepted + overflow === offered` and `residual === 0`.
- **Codex #4: max-ever generation.**
  - `maxEverGenerationAt` in `explore.ts:285-288` filters lineage on `birthTick <= tick`. Lineage includes dead nodes, so extinct generations count.
  - It returns `null` when the endpoint tick is `null`, which is the not-reached case.
  - The window endpoint at `explore.ts:320` uses it.
  - The final summary at `explore.ts:382` and the check at `explore.ts:569` are consistent with it.
  - The viewer recomputes the same value from `data.final.lineage` (`moving-food-viewer.js:300-303`). It requires null for not-reached windows (`:266`) and a safe integer otherwise (`:275`).
- **Codex #3: band fill.** The `drawBandOutline` body has no `fillStyle` or `fillRect`. Those calls appear only in the background, food and body drawing, so the overlay is outline-only.
- **Codex #1: fixture food.** The fixture's endpoint `foodRemaining` is `96*96*20`, and `EMPTY_FOOD` is 9216 tiles at 20 each, which sums to the same 184,320. The viewer's check at `:294` should now pass.
- **Codex #2: terminal-jump locator.** The test now uses `[data-jump-tick="1500"]`. The HTML button at `moving-food.html:66` carries that attribute, and the viewer binds to it.

**Verification limits**

- I did not see `validateWindow` in `explore.ts`. I believe it enforces the runner's `maxEverGeneration` through full-window recomputation, but I only saw that the runner computes it correctly.
- I did not confirm that every e2e fixture frame uses `EMPTY_FOOD`, only that the terminal and endpoint totals agree.
- I did not confirm that the fixture lineage generations are all 0, as its `maxEverGeneration: 0` implies.
- No vitest, typecheck, e2e, pinned-hash or `assertPinnedInputs` results were seen. Before pilot execution, the parent's focused tests, browser spec and typecheck must pass.

**Non-blocking, carried over from the earlier Claude review**

- No code generates the pair index or receipt. `moving-food-validation.md` should say how it is made.
- The viewer does not cross-check `decision.status` against the arm gates.
