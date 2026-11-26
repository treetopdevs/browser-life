**Verdict: no blockers in the schedule, accounting, gate or evidence logic I reviewed. One new runner change, and the launcher, need a re-check before the committed-source launch.**

**Scope.** The runner was rewritten while I reviewed. I read `tools/alternating-food/explore.ts` at 643 lines. It is now 689 lines (sha `f44576bb…`) and adds `AttemptRecorder`, `--attempt-dir`, `recorder.failure` and `candidate-evidence.json`. I did not review that new code, and I read the old launcher and test file before any change to them. The model diff and the schedule, gate and validator findings below are against the earlier read, and I only spot-checked those against the current runner. Re-run the review on the final bytes.

I made no edits and ran no simulations. I couldn't write the plan file because this session has no Write tool.

**Verified clear**
- **Schedule.** Pulse `p = tick/5 − 1`, active band `floor(p/100)%2`. That gives band 0 at 500, band 1 at 505, band 1 at 1000, band 0 at 1005 and band 1 at 3000. `activeBand` is 0 before the first pulse, and `foodTargets` returns the last-supplied band's ascending tile list.
- **Targets.** The rank formula matches the plan. 2053 is coprime to 2304, so 768 targets per pulse are distinct. The seed is reduced mod 2304 and the arithmetic stays well inside safe integers.
- **Static parity.** Split-band `environment` and `targetCount` are untouched, and the new fields exist only in alternating mode. `makeSample`, `makeFrame`, `frameProjection` and `tickRow` are identical to the historical runner, so the baseline regression's `JSON.stringify` equality should hold. The baseline compares only the five historical snapshots, and the outcome saves seven.
- **Per-band accounting.** The `first`/`second` offered formula is correct for every pulse count. The identities `offered = accepted + overflow` and sums equal to global are enforced per tick (`explore.ts:128`) and per sample (`:414`).
- **Per-tick checks.** Both worlds run `assertWorld` every tick, including toroidal 4-neighbor connectivity, bounds, ledger and lineage. The two worlds are compared by census, environment, tick row and extinction every tick, and by full state and frame at every sample.
- **Extinction and gates.** Extinction on or off a fixed snapshot tick, and extinction exactly at 3000, handle correctly. An extinction at 3000 fails the activity gate. Missing endpoints give null and fail without extrapolation. The ±20 and 10-tile thresholds are inclusive.
- **Pins and non-overwrite.**
  - The plan sha, copy-source model, historical runner, raw artifact, index and validation document match both the runner and the launcher.
  - `Pinned input changed` is checked at load and again after the run. The historical data sha is checked inside `validateHistoricalReference`.
  - Non-overwrite is a pre-check plus `wx` writes.
  - The legacy `--check` runs first.
- **Importing.** Importing the runner does not start a simulation.

**Should fix before launch (none is a hard blocker)**
1. **Launcher `run-attempt.sh:54`.** `exec` throws away the runner's stdout and exit status. On a cap exceedance or invariant throw, nothing durable is left. The new `AttemptRecorder` appears to address this, but I haven't read it. Check that the launcher passes `--attempt-dir` and that `intent.json` is verified by `verifyAttemptReservation`.
2. **Launcher intent is incomplete.** It omits `git rev-parse HEAD`, the node version, the split model and runner shas, and the launcher's own sha. The launcher sits in gitignored `runs/`, so its content isn't bound anywhere. Also, the overwrite pre-check at `:16` covers only the two output files, though the runner re-checks.
3. **Test gaps against plan line 29.**
   - The "unchanged static behavior" test (`tools/test/alternating-food.test.ts:34–45`) checks tick 0 only. Add a short stepped comparison of the old split-food model against the new one in split-band mode, about 100–200 ticks, comparing snapshot, environment and census every 20 ticks.
   - Gate boundary cases are missing:
     - cap48 at 99 versus 100.
     - zero births or deaths in a window.
     - a single family at 3000.
     - extinction exactly at 3000.
     - spatial 9 versus 10 tiles, and a missing endpoint.
     - `summarizeWindow` on early extinction.
   - Malformed-evidence tests cover only `{schemaVersion:1}` and the repeat proof. Nothing tampers with `validateFrame`, `validateSnapshot` or `validateTickRows`.
   - Add a test that calls `assertPinnedInputs()`.
   - The 600-pulse offered-budget check is tautological, because it sums the same schedule function. Per-band accounting past tick 505 (1000/1005, overflow) is only checked at runtime. A 1,005-tick stepped test would cover it.
4. **The 3,000-tick validators have never run against a real alternating artifact.** The `validateEvidenceStructure` path is about 270 lines, and the horizon is hard-coded to 3000. A validator bug would burn the single attempt. If you can parameterize the horizon without changing frozen behavior, a short-horizon dry-run would de-risk it.

**Nits**
- `explore.ts:128`: `env.bandAccepted?.[0]!+env.bandOverflow?.[0]!==undefined` is always true. The real identities follow it, so it is harmless.
- `explore.ts:641`: the Markdown error string still says "split-food JSON", and the success line omits the seasonal gate.
- `model.ts:689`: `alternatingBandAtPulse(pulse)` is evaluated per slot in every mode. It is pure, so parity holds.
- `assertCommittedInputs` runs `git status` relative to the current directory.
- There is no exported classifier that turns the numerical, spatial and seasonal gates into the stop or Promising status. The later pair index and receipt must derive it from the gates only.
