# Alternating-food replication validation

Plan d82bdd5d was committed before implementation or outcomes. Claude Sonnet 5.5 High and Codex Sol 6.1 High reviewed it and its clarifications; both closure reviews are clear. The plan explicitly defines the internal data hash, requires successful static regression before either new alternating world is constructed, freezes the known static deltas, and separates full-screen recurrence from descriptive trough/recovery.

Plan SHA256: 2070ef956ca73855e9b032a7cbaa5e53e594dddaa9ed82f84f72c49256f5c743. Base PR #111 tip: 5948c8abd1e586ccac4975bf4709b47ef98051db. Model 5dc6ce46 remains unchanged.

Implementation is prepared but not committed or run. Fifteen focused core tests pass (including rehashed disconnected-frame and body-cap rejection); ten synthetic Chrome cases, typecheck and build pass. Historical split-food seed1202 check-only passes. All nine assay dependencies are tracked/staged; no ignored file is required. The frozen alternating model and prior source/evidence files remain unchanged.

Codex's initial implementation review found every-frame connectivity/cap checks missing and two actual-test assumptions (text mismatch and early-terminal handling). Those fixes are implemented and the Codex Sol6.1 High closure review is clear; no remaining launch, schema or gate blockers were found in its scope. Actual-data and media tests are pending because no new outcome exists.

The required second implementation review is blocked by quota. Claude Sonnet5.5 High returned its weekly-limit message (reset reported as2am America/New_York, without a date). agy listed gemini-4-argon-high, but the authorized High-effort fallback invocation returned RESOURCE_EXHAUSTED/HTTP429, individual quota reached, approximately105hours to reset. Neither completed an implementation review. This is not a scientific failure or an experiment attempt.

No attempt reservation, full static regression, alternating outcome, receipt, animation, implementation commit or PR has been created. Preserve this worktree and finish the pending review rather than starting a duplicate slice. Do not run or commit the implementation until Claude or the authorized Argon reviewer is available and clears it. No merge or deployment.
