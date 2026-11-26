# Independent implementation review findings

Codex Sol6.1 High, read-only. Model schedule/ledger diff preserves old modes. Historical151samples/frames,3000rows and7snapshot regression precedes new outcome construction; sticky reservation, tracked launcher and committed-source checks align with plan. No biology stepping in new core tests.

Concrete pre-outcome findings and required repairs:

- Browser used final lineage without full parent/generation/death/mutation semantics or recomputing final maximum-ever generation and deaths-by-cause. Add structural and derived-summary checks with rehashed rejection coverage.
- Browser checked only selected rules; bind the complete new rules object to the pinned historical rules, with a rehashed biology-rule drift rejection case.
- Both core and browser checked each per-band ledger independently but not cumulative transitions. Require per-band accepted and overflow never decrease and accepted delta not exceed offered delta; test individually valid samples whose transition is impossible.

All three findings are resolved in the closure review. No simulation, edits or tests by reviewer. These affect evidence validation only, not frozen feeding or biology.
