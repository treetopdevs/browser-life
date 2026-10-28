**B1 is closed for what it asked: the runner's derived-field logic now has real coverage. I found one small residual, which doesn't block outcomes.**

I used 4 reads and ran nothing. I did not check the runner SHA, so `18d9c74d…` is your figure, not one I confirmed.

**Why it's closed**
- `validEvidenceStructure` (`explore.ts:559-627`) does not just clone the saved record. On each saved arm it recomputes these from the saved observations:
  - **Windows:** `summarizeWindow` via `validateWindow` (`explore.ts:532`, `:620`), compared with `same()`.
  - **Gate:** `evaluateGate` against the recomputed windows (`:621`).
  - **Final summaries:** `final` census, ledger, lineage and `stateSha256` against the terminal snapshot, plus `deathsByCause` and `maxEverGeneration` from the lineage (`:614-618`).
  - **Repeat counts:** `stateChecks` and `frameChecks` against the sample and frame lengths (`:623`).
  - **Tick rows:** cadence, births/deaths and population transitions against lineage and samples (`:619`).
- It then runs the exact historical comparison (`validatePrefixRecord`, `:625`).
- A pass on both historical records (10/10) therefore shows that the runner's `summarizeWindow` and `evaluateGate` reproduce the saved windows and gate on real data. It also shows the `final` and `repeat` summaries are consistent with the saved data. Calls to `summarizeWindow` and `evaluateGate` in `runArm` and in validation are the same code, so the window shape and key order match by construction.
- The test also rejects resealed wrong baseline hash, wrong source hash and flipped gate. That covers the identity and gate paths. No export or runner change is needed.

**Residual, not a blocker**
- The test starts from the historical payload. It cannot show that `runArm`'s own object literals for `run`, `final`, `repeat` and `snapshots` (`explore.ts:434-441`) have the same key order as the saved JSON. The final `same(a[field], prior[field])` comparison is order-sensitive, as the earlier review noted, though I did not re-check `same()` here. A mismatch would surface only after a full run, at `runArm`'s own validation call (`:442`), and burn a logged attempt.
- The risk looks low, since the runner mirrors the historical shape.
- If you want it closed without simulation, add one assertion. Check that `Object.keys(prior.run)`, `.final`, `.repeat`, `.snapshots[0]`, `.samples[0]`, `.frames[0]` and `.tickRows[0]` match the literal orders in `explore.ts`. It would also change the test file, not the runner, so the runner SHA stays the same.

**Parent-side controls you listed**
These are all outside the runner, and I did not check any of them:
- Schedule and attempt logging.
- Preserving stdout, stderr and error text.
- Halting on an invalid 1201 before 1203.
- Checking the saved evidence before diagnostics.

**Verdict:** B1 is clear. Proceed. Add the key-order assertion first only if you want to be sure no attempt is burned by a runner-versus-historical key-order mismatch.
