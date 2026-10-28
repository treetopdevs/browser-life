I've finished reading. Writing up the review now.

**Verdict: no hard blockers. Fix five items before the plan is frozen, and the first two are the ones that matter.**

I read the plan, `moving-food-replication-results.md`, `apps/lab/src/moving-food/model.ts`, and the gate lines of the replication plan. I ran nothing and edited nothing.

**Should fix before freezing**

1. **The visual gate is weaker and vaguer than the one the moving arm passed.**
   - The accepted moving gate (replication plan line 9) required cluster or gap differences from same-age uniform at two or more of 1500, 2500 and 3000. It also required within-arm change from 2500 to 3000.
   - The new plan only asks for "a shifted/expanded/cleared cluster or gap" at 2500 and 3000, with no reference frame. Shifted relative to what?
   - Say "within-arm change 2500→3000". Say whether the uniform comparison is dropped, since no uniform arm is rerun here.
   - Say explicitly that the moving arm is re-judged under this wording, and what happens if the re-judgment differs from the accepted receipt.

2. **A stationary failure cannot be read as "motion matters."** This is the main interpretive risk.
   - Stationary columns 0–47 cover about half the torus. Founders sit at x=12, 36, 60 and 84, so half of them (x=60 and 84) start outside the band and never get supply. The moving band reaches them around ticks 650 and 1850.
   - A stationary failure would therefore mostly confound motion with coverage of the world. The same confound is why the "only one passes" and "favor that arm" outcomes need softening. A pass by the stationary arm is the informative result.
   - Add one sentence: "a stationary failure does not isolate motion from coverage". Change "favor" to "the screen separated them on this seed".
   - Change "movement is not necessary" to "this screen did not distinguish the arms". These are lenient gates, and births and deaths merely being positive is a low bar.

3. **The moving arm's outcome is mostly predetermined.** Its numerical gates are fixed by the exact-match regression, so only its visual re-judgment is open. Say so. "Neither passes" is then effectively "stationary fails and the moving arm fails the new visual wording," which is odd.

4. **Make the stationary-mode wiring testable.**
   - `model.ts` branches on `mode === 'moving-band'` in `foodTargetTiles`, `supplyFood`, the `environment` getter and the `foodTargets` getter.
   - A missed branch silently yields 9216 uniform targets instead of 4608 band targets. This is the likeliest source of silent error.
   - Add a diff-confined-to-listed-hunks check against the moving model, and a pin of the copied source SHA in the header.
   - Add a cheap correctness check. The two arms should be state-identical through tick 49, because both use left edge 0 and the first divergent pulse is at tick 50. The first 9 pulses (ticks 5–45) should match exactly. This also guards the "no extra RNG calls, pulse index not reset" claim.

5. **Several definitions are loose.**
   - "Offered food is matched" only holds up to the shared horizon, because supply stops at extinction. State that.
   - "Cap48 ticks" and the window birth and death counting (cumulative differences at 1500, 2000, …) should be defined once.
   - "Overlap diagnostics" is inherited from the prior plan but never defined here. Define it or drop it.
   - Many spaces are missing, such as `to3000`, `actualterminal`, `all151` and `Node24.2.0`. In a frozen document these should be fixed.

**Checked and fine**
- Minimal design: one seed, one fixed placement at left edge 0, and the band width, stride, budget and rotation inherited unchanged.
- Source preservation: isolated copy, historical files untouched, runner pins and check-only validation first.
- Moving baseline: 151 samples, 3000 tick rows and 5 snapshots (151 = 3000/20 + 1) is a coherent exact comparison, and the metadata exception is stated honestly.
- Stops: stopping after the pair, no automatic replication, and unreached windows failing.
- Overclaim guards: no superiority, tracking or open-ended-evolution claims, and "no equality" for the both-pass case.
