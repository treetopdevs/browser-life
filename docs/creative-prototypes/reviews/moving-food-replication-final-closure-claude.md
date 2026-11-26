**Blocker: one e2e test is incoherent with the viewer. The viewer change itself is clear.**

I made no edits and ran no simulations or tests. I used 3 of the 4 reads.

**Blocker: `tests/e2e/moving-food-replication.spec.ts:579-588`**, "two exact comparisons may pass while a missing third comparison and late endpoint stay false"
- `bindReceipt` is called with `passTicks: [1500, 3000]`, which sets `visualComparisons` to 1500 true, 2500 false, 3000 true.
- The test then sets `visualComparisons[2].pass = false`. Index 2 is tick 3000, so only 1500 still passes. It also sets `lateWithinMoving.pass = false`.
- `bindReceipt` forces `decision.status = "promising"`. Viewer lines 688-691 reject a promising decision unless at least 2 comparisons pass and `lateWithinMoving.pass` is true. This receipt has 1 pass and a false late flag, so the viewer will throw "promising decision conflicts…". The test expects `#decision-status` to read "Promising", so it will fail.
- The title's premise doesn't hold either. The moving arm in this fixture is a live 3000-tick arm, so it has exact 1500, 2500 and 3000 frames, and no comparison is missing a frame.
- An arm can't be missing a frame and also be promising. Promising needs `numericalPass`, which needs a full live run with every 20-tick frame.

Pick one fix:
- **Stop with a short arm (my recommendation):** use the extinct 1703 moving arm with `passTicks: [1500]` and `latePass: false`, and set `decision.status = "stop"` before re-hashing the receipt. Assert `#decision-status` reads "Stop". This covers false flags where frames are absent.
- **Promising with a full arm:** drop the two `= false` overrides and use `passTicks: [1500, 2500]` with `latePass: true`. Rename the test to say it checks the two-of-three rule.

**Viewer (`moving-food-replication-viewer.js:677-687`): coherent.**
- A true pass flag for a comparison tick requires an exact saved frame at that tick in both arms.
- A true late-moving pass requires moving-arm frames at exactly 2500 and 3000.
- The check runs only when a receipt exists, and the pending branch returns earlier.
- It runs before the `promising` consistency check, so the new message fires first.
- The status check at line 677 guarantees a non-null receipt before line 688 uses it.
- The first new test (line 572) matches this path. Its extinct-1703 moving arm has no 2500 frame, so the message "tick 2,500 as a pass without exact saved frames in both arms" is what the viewer throws. The 1500 frame exists in both arms, so the loop gets to 2500.

**Extinct-window deaths fix: consistent.**
- For the extinct 1703 arm, window 1 gets `deaths = 2`, matching the `tickRows` death of 2 at the terminal tick.
- With `gatePassing` and a 3000 arm, the births and deaths in the window and in the rows agree.
- The fixture's `numericalGate` flags match what the viewer recomputes at lines 408-420 for the extinct, 3000-passing and 3000-non-passing cases.

**Non-blocking:** every file `actualPair` reads exists on disk: the index, arm and receipt files for 1202 and 1203. They weren't in your git status snapshot, so make sure they're added before commit. I didn't touch the source biology.
