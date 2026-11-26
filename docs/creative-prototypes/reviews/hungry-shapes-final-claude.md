# Final adversarial review: hungry shapes, seed 1201

I found no blocker on the outcome, the stop rule or the offered-versus-accepted comparison. The stop at 1201 follows the frozen gate. I'd fix three presentation items before commit.

I made no edits and ran no simulations. I did not run the 47 tests, the 11 browser checks or the build, and I'm treating those as your reports. What I did do was read files and run read-only hash and JSON comparisons on retained artifacts. I did not watch the mp4. I looked at the 1500 screenshot and the 3000 poster.

## Outcome and stop rules

- **Gate, outcome priority and text timing:** the plan's outcome priority puts extension first only if patches is alive at 3000, which it isn't. The v2 triggers are both scarce arms extinct with maximum-ever generation 0, or both with ≥100 late cap-48 ticks. Patches reached generation 8, and cap-48 ticks were 6 for uniform and 0 for patches. Every other case stops at 1201. The plan's last write (15:32:31) precedes the seed JSON (15:35:53), and the pre-pilot stop paragraph says no outcome was inspected. The gate text was therefore fixed before the result, not changed after it.
- **Source pins:**
  - **Pin hashes:** the development model (`49416b11…`), the development runner (`973ed60d…`), the hungry model (`a33a3312…`) and the new runner (`f49d2a63…`) match what the evidence and validation record.
  - **Timing:** the runner was last edited before the evidence was written.
  - **Original files:** `git status` shows `apps/lab/src/development` and `tools/development` unchanged.
- **Artifact hashes:** the SHA-256 of the raw JSON, the mp4 and the poster match `manifest.json` and `hungry-shapes-decision.json`.
- **Numbers agree across the table, the decision JSON, the HTML and the raw JSON:**
  - Late births: original 48, uniform 94, patches 0.
  - Cap-48 ticks: 340, 6 and 0 of 500.
  - Deaths by cause match the retained lineage counts.
  - The 94 late births and 94 late deaths in uniform are real per-tick sums.
- **Offered versus accepted at common tick 2040:**
  - **Match:** the figures in the decision JSON and the HTML equal the retained tick-2040 census environments. Both scarce arms offered 313,344. Uniform accepted 229,313 and patches 83,086. Original offered 3,760,128 and accepted 432,820.
  - **Identities:** offered equals 768 × 408 pulses and equals accepted plus overflow. The end-of-run figures follow the same pulse count: 9216 × 600 for original, 768 × 600 for uniform and 768 × 408 for patches.
- **Browser versus Node:** in the retained 3000-tick browser export, the environment, tick, food, occupancy, organisms and ledger are identical to the Node terminal snapshot for all three arms. The late and death summaries match too, and the model hash is `a33a…`. This independently supports your claim.

## Things to fix before commit

1. **Hard-coded local ports in shipped pages.**
   - `apps/lab/hungry-shapes/index.html:92` links to `http://127.0.0.1:5411/docs/creative-prototypes/hungry-shapes.html`.
   - `hungry-shapes.html:4` links to `127.0.0.1:5410/hungry-shapes/`.
   - Both are dead for anyone else, and no test covers the panel's link. Use relative paths or drop the link.
2. **Absolute paths in the committed manifest.** `manifest.json` records `/Users/nicholas/...` screenshot paths, and `sourceRecording.path` points into the gitignored `runs/`. Make these repo-relative, or note that they are local-only.
3. **The headline overstates one seed.**
   - "Scarcity keeps one world changing" implies original isn't changing. It had 48 late births and 48 deaths, and sat at the cap 68% of the time.
   - Original also offers 12× the food, so it isn't a clean comparison against the scarce arms. The body copy hedges well, but the headline and first paragraph carry the causal tone.
   - Something like "Uniform scarcity kept turning over; founder patches died out at 2,040" is accurate.

## Optional suggestions

- **Mixed horizons in the results table:** `hungry-shapes-seed-1201.md` shows accepted food at tick 3000 for two arms and 2040 for patches (309,822 versus 83,086). Add the common-2040 numbers or a one-line note. The HTML already handles this correctly.
- **Accepted food depends on the population:** accepted food is also an outcome of grazing, since a dying population leaves tiles full and increases overflow. The "does not isolate which mechanism" sentence covers it, but "changes both location and the amount actually accepted" reads causal.
- **The visual checklist is only partly recorded:** the validation text says only the 1500 and 3000 frames were inspected, not the planned 500, 1500 and 3000.
  - **Patch-mask share is unused:** the HTML leaves out the patch-mask occupancy share from the JSON, which at 1500 was 31% for patches against 15% for uniform and 15% for original. That matches the plan's expectation that newborns land outside the 4-tile patches.
  - **Where the screenshots agree:** both frames are consistent with the HTML's descriptive claims.
- **`decisions.html` carries a stale line:** an older section still says "Hungry shapes remains the next proposed implementation."
- **`hungry-shapes-final-claude.md` is empty:** it was 0 bytes at review time. Presumably it is meant to hold this review, so fill it or drop it.
