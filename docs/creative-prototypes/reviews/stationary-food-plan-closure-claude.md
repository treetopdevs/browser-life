**Clear: no blockers.** I made two reads (the plan and the prior Claude review), with no edits, tests or simulations. The four items you named are covered.

- **Coverage confound:** Covered at plan line 34. "A stationary failure does not isolate motion from coverage" is stated outright and gives the reason. The fixed band never replenishes the other half of the torus, while the moving band reaches it. "Both pass" is worded as "did not distinguish", not equality or no benefit. Line 17 uses "separated the arms on this seed" instead of "favor".
- **Within-arm visual gate:** Covered at line 33. The gate is "within-arm change from 2,500 to 3,000". The uniform comparison is dropped deliberately, with the reason that this question compares two band designs. The moving arm is re-judged under the new wording. A different judgment doesn't overwrite the historical receipt and is explained as a new screen decision. The plan also says the moving arm's numerical outcome is predetermined by the exact regression.
- **Equality through tick 49:** Covered at line 37. It compares exact snapshots and food arrays through tick 49, and environment with only the mode label excluded. It states that the first nine pulses match and that tick 50 is the first destination change. That matches the moving model's `floor(tick/50)%96` and a pulse every 5 ticks (ticks 5–45 are 9 pulses). It also states no normalization in the moving-to-historical regression.
- **Frozen reference:** Covered at lines 21 and 37. It pins the historical dependencies and the PR 104 moving 1202 artifact. It runs a check-only validation before writing. The regression compares 151 samples, 3000 tick rows and 5 snapshots. It admits that metadata and source hashes differ between runners. The header pins the copied source SHA, which is 64 hex characters.

The other prior findings (testable stationary wiring, definitions of matched offered food, window counts, cap 48 and overlap diagnostics) are also resolved at lines 36–39.

**Non-blocking tidy-ups before freezing:**
1. Line 15 still gives the visual criterion without "within-arm 2,500→3,000". Only the resolutions section at line 33 adds it. Folding it into line 15 would remove any chance of reading two gates.
2. Missing spaces remain in the frozen text: `exactly48`, `actualtick`, `postextinction` and the unspaced window list `1501–2000,2001–2500,2501–3000`.
3. I didn't check that the pinned `b7aa0a3f…` hash matches the actual PR103 `model.ts`. The runner's check-only validation should assert it.
