# Sol 6.1 High review: renewal Stage 1 tooling, fourth follow-up (narrow)

Raw final message, unedited. `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C /Users/nicholas/develop/browser-life-construction`, session `01a10811-4be3-7881-b278-2c53eba0816e`, 2026-10-04.

---

**PARTIAL — the carried P2 is not fully closed.**

- **Closed: audit identity and digest.** `auditCaseInner` checks case, attempt, status and finalStep, then records attempt and resultSha256. [construction-renewal-verify.ts:214](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal-verify.ts:214), [254](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal-verify.ts:254).
- **Closed: completed-case consistency.** The reader rejects mismatched case, attempt or final census stateHash. [construction-renewal.ts:518](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:518).
- **Partial: publication binding.** Pilot/control cases and confirmation cases with a verified final readout receive the attempt/hash check. Confirmation cases without that readout bypass it. [construction-renewal.ts:717](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:717).
- **Regression coverage present.** Both requested edits are tested, but against a pilot case with no confirmation panel. [construction_renewal_engineering.ts:235](/Users/nicholas/develop/browser-life-construction/tests/deno/construction_renewal_engineering.ts:235). I did not rerun the reported 43 checks or 1,946 tests.

**Residual P2: unaudited confirmation metadata can still be published.** Concrete scenario: an earned confirmation panel has one completed attempt, but no final readout. Edit that attempt’s `artifactBytes` or `finalStateHash`, then generate the report. The report labels confirmation incomplete, skips the audit check, and nevertheless copies those fields into `results.json`. [construction-renewal.ts:700](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:700), [742](/Users/nicholas/develop/browser-life-construction/tools/construction-renewal.ts:742). Fix: refuse whenever a completed confirmation attempt lacks a verified final readout, then apply the attempt/hash check unconditionally. Add a regression for this branch. This is a remaining path through the carried finding; I found no separate NEW defect.

**Freeze verdict:** Hold the freeze until that publication bypass is fixed and covered. The repair closes the audited publication paths, but does not yet enforce the stated requirement for every published result. This was source inspection only: no files changed, tests executed, freeze/run/verify invoked, or reservoir world stepped.
