# Sol 6.1 High review: renewal Stage 1 tooling, follow-up on the repairs

Raw final message, unedited. `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C /Users/nicholas/develop/browser-life-construction`, session `01a107ed-c577-7682-85c6-3e3fcf546e7d`, 2026-10-04. Prompt: the seven first-pass findings and a description of each repair.

---

**Freeze should wait. Findings 1, 3 and 6 are partial; 2, 4, 5 and 7 are closed.** Three additional defects remain in the repaired paths.

Nothing was modified. `deno check` passed for both CLIs and the engineering script. Vitest was blocked before running tests by a sandbox-denied temporary-directory creation. The accounting reproduction below used mocked, in-memory files and stepped no world.

The seven earlier findings:

| # | Status | Evidence |
|---|---|---|
| 1. Frozen execution bypass | **Partial** | The hash chain is checked at [store.ts:122](/Users/nicholas/develop/browser-life-construction/tools/lib/construction-renewal-store.ts:122), and ordinary direct invocation relaunches with restricted flags. However, [store.ts:149](/Users/nicholas/develop/browser-life-construction/tools/lib/construction-renewal-store.ts:149) accepts the public digest environment variable without verifying the effective loader configuration. |
| 2. Confirmation selection binding | **Closed** | Confirmation freeze recomputes selection before creating the panel at [runner.ts:576](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:576). Subsequent reads validate the chain, prescribed case fields and regenerated initial hashes at [runner.ts:304](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:304). The independent panel check is at [verify.ts:406](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal-verify.ts:406). |
| 3. Inconsistent measurements accepted | **Partial** | Residuals and observer identities are reconstructed at [verify.ts:109](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal-verify.ts:109), and checkpoint observer comparisons are substantially stronger. But [verify.ts:224](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal-verify.ts:224) still omits decoded-state comparisons for complete channel totals and flux. |
| 4. Verification retryability | **Closed** | Exclusive numbered directories and passing-attempt discovery are implemented at [store.ts:177](/Users/nicholas/develop/browser-life-construction/tools/lib/construction-renewal-store.ts:177). Replay exceptions become incomplete records at [verify.ts:457](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal-verify.ts:457). See the downstream retry regression below. |
| 5. Initialization versus copied bytes | **Closed** | Phase 1 hands initialization to the verified copy at [runner.ts:206](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:206); phase 2 checks copied protocol/input pins and initializes there at [runner.ts:210](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:210). |
| 6. Publication completeness | **Partial** | Required outputs and accounting fields exist at [runner.ts:685](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:685), with Markdown preservation at [runner.ts:713](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:713). Final publication nevertheless trusts an unchecked final readout. |
| 7. Pending confirmation labelled unearned | **Closed** | The absent, earned-but-unfrozen and incomplete branches are distinct at [runner.ts:654](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:654). The complete branch has the separate publication defect below. |

Two original blockers remain:

- **Finding 1:** Supplying `BL_RENEWAL_FROZEN_LAUNCH=<source digest>` while directly running the copied entrypoint with another configuration satisfies the return branch. All copied files can hash correctly while aliases resolve elsewhere. **Fix:** verify effective module resolutions and enforce launch through a trusted bootstrap; the public digest alone cannot attest how Deno was launched.
- **Finding 3:** I reproduced `auditCase` returning `complete` after changing final totals by **A +1, C −1, S +2**, preserving matter and energy, and changing recorded emission flux while leaving the checkpoint untouched. **Fix:** compare every census checkpoint’s complete totals and every flux counter against the decoded state; also validate counter domains. The current identities do not establish those equalities.

Additional defects in the repairs, ranked:

1. **P1 — Publication can announce unaudited confirmation success.**  
   [runner.ts:650](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:650) parses `final-readout.json`; line 660 declares confirmation complete merely because it exists. Its manifest, audit path/hash, confirmation-freeze binding and decision are unchecked. **Scenario:** after a legitimate confirmation freeze, a fabricated or cross-root final readout reports `confirmed: true`; `report` publishes it despite missing confirmation results or audit. **Fix:** add a verified final-readout loader and validate the decision against the bound passing final audit before publication.

2. **P1 — Another passing pilot audit invalidates an immutable confirmation freeze.**  
   Confirmation stores the original audit hash at [runner.ts:591](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:591), but final verification requires the latest passing hash at [verify.ts:415](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal-verify.ts:415). **Scenario:** attempt 1 passes, readout and confirmation are frozen, then attempt 2 passes identically. Its timestamp changes its hash; final verification rejects the existing confirmation. Fixed readout filenames and exclusive confirmation creation prevent recovery through the normal commands. **Fix:** validate the audit pinned by the confirmation freeze; later equivalent audits should not revoke that binding.

3. **P1 — Two-phase freeze can certify a seed check for different protocol bytes.**  
   Seeds are checked from the early live protocol at [runner.ts:175](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:175), before copying; phase 2 independently loads the copied protocol at [runner.ts:214](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:214). **Scenario:** a concurrent edit changes seeds between validation and copying. Initialization uses the new seeds, while provenance records the old contamination check. **Fix:** bind phase 1’s protocol digest to the copied protocol and reject changes, or perform the contamination check using the copied protocol before completing the freeze.

**Verdict:** The freeze should not proceed yet. Initialization now uses the frozen bytes, confirmation panel enforcement is substantially repaired, and publication includes the requested outputs. However, the remaining execution and measurement gaps prevent full closure of the original P0 findings, while unchecked final publication and audit retry handling can produce incorrect completion claims or block a valid root. Address these gaps and rerun focused regression checks before freezing; this review performed no scientific execution.