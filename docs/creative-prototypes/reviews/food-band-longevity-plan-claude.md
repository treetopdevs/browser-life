**Verdict: not clear to freeze yet, and I found one blocker.** The plan doesn't check whether the 6,000-tick run fits the lineage and byte limits, and a failure there would use up your single authorized pair. Everything else is a wording fix. I made no edits and ran nothing. I used my six reads on the plan, the frozen replication plan and results, two greps of `model.ts`, and one grep of the old runner. I did not open the PR #106 artifacts or the prior review files.

## Blocker

**B1. Headroom for the 6,000 horizon is checked for history only.**
- The history claim holds. `maxHistory` is 451 (`model.ts:35`) and 301 samples are needed.
- `maxLineage: 10_000` (`model.ts:36`) is not mentioned in that sentence beyond "unchanged", and nothing checks it. The old runner requires `droppedHistory === 0 && droppedLineage === 0` at the terminal state (`explore.ts:610`). Lineage grows with births, so at 6,000 ticks it is roughly twice the 3,000-tick count.
- The 24 MiB per-arm cap has the same problem. The new files hold 6,000 tick rows, 301 full frames and 8 snapshots, against 3,000, 151 and 5 historically.
- The plan already says "any … truncation … invalidates the pair". Hitting either limit would therefore void the one authorized pair, with no retry unless the rules change.
- **Fix before freezing:** read the final lineage node count and the byte size from the PR #106 seed-1201 arm files, and project them to 6,000 ticks. Write the numbers and the margin into the plan. If the margin is thin, decide now whether the limits are rule-changing or assay-only. Lineage limits are part of the frozen model, so any change to them needs its own review.

## Fix the wording before freezing

1. **Extinction versus fail-closed replay.** The plan says the replay fails closed on "missing true visual endpoints", but it also says an extinct arm stops at its actual tick with no 6,000 snapshot.
   - **Fix:** state that the actual terminal frame is the true endpoint for an extinct arm, and that the replay builder must accept it.
   - Say whether the parent still records a 5,500–6,000 observation for an arm that already fails numerically. I'd say yes, descriptive only.

2. **Visual versus biological failure.** "Unclear or biologically unreached endpoints fail" sits next to "Do not call a visual uncertainty a biological failure."
   - **Fix:** one sentence saying the gate verdict is a fail but the reported reason is categorized separately.

3. **Retry authorization.** You authorized one 1201 pair. The plan allows a "whole-pair retry" after an assay repair.
   - **Fix:** say that a retry is permitted only for an invalid pair, that it is still the same single authorized pair, and that outcomes seen in the failed attempt are disclosed.
   - This matters because moving runs to 6,000 and its result is seen before stationary starts. A stationary prefix mismatch would void the pair after moving's outcome is already known.

4. **Hardcoded 3,000 in the old runner.** `MAX_TICK`, `WINDOWS`, `FIXED_SNAPSHOTS` and `validateEvidence` all assume 3,000 (`explore.ts:29-32`, `301`, `563`, `566`, `567`).
   - The new runner cannot reuse them for 6,000 records.
   - **Fix:** the plan should require separate historical-horizon and new-horizon constants. A test should confirm the new validators accept the first 3,000 ticks of the PR #106 records.
   - The old model reads no `maxTick`, so a 6,000 run should not change the prefix. The prefix comparison is what tests that.

5. **Prefix scope.** The prefix list covers samples, frames, tick rows and five snapshots. Add that the historical terminal-only fields are excluded from the prefix comparison: sample and frame at tick 3000, `final`, `windows`, `repeat` and `numericalGate`.
   - Otherwise the tick-3000 records could be wrongly compared against, or treated as terminal in, the 6,000-tick run.

## Interpretation additions (not blockers)

- **The gate was written after the 3,000-tick results were known.** The family sizes at 3,000 are 2/14/22 (moving) and 0/33/6 (stationary). The stationary minority family had 6 bodies. Say so, and say the gate is not blind to those results.
- **Report the first tick each founder family reaches zero.** Also report the first window that fails. Only 4,501–6,000 is gated, and the 3,001–4,500 stretch is otherwise silent.
- **Moving band lap.** `floor(tick/50)%96` wraps at tick 4800, so the moving band completes a lap inside window 4,501–5,000. Ticks 4,801–6,000 re-cross the columns fed at ticks 1–1,200. This is a geometry fact to disclose, not a fault. It is also a confound for any cross-arm comparison.
- **Weak family gate.** "At least two nonzero founder families" can pass on a single body. The plan already requires reporting family sizes. Keep the "permissive screen" wording prominent in the results.

The stop rules, the single-pair limit, the no-escalation language and the diagnostics-after-receipt ordering are consistent with the frozen replication plan. I found no conflict there.
