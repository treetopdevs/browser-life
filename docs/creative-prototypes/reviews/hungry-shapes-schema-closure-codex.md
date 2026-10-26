Closed: no unresolved correctness defect in the requested scope.

- All 7 counter fields and 19 census fields are explicitly required. Every snapshot history row, sample census, and final census receives validation ([schema checks](tools/hungry-shapes/explore.ts:199)).
- Rehashed regressions cover the original paired `attemptedMutations` deletion and an independent history-only deletion ([tests](tools/test/hungry-shapes-evidence.test.ts:183)).
- Terminal census, ledger, lineage, hash, environment, and sample bindings remain intact ([bindings](tools/hungry-shapes/explore.ts:621)). Source identity remains captured at module load and checked before execution and afterward ([guards](tools/hungry-shapes/explore.ts:496)).

Static inspection only; no tests, simulations, or edits.