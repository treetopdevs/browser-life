# Sol 6.1 High review: Stage 3a calibration repairs (confirmation)

Raw final message, unedited. Session `01a10866-8d50-73a0-a6bc-d77de4b86ef6`, 2026-10-04, read-only.

---

All five findings are **closed** in the current working copy.

1. **P1 frozen-source identity — closed.** The importer checks `sources.json`, every listed source file, the tree digest, protocol, plan and freeze context ([discovery-import.ts:37](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/lib/discovery-import.ts:37)). Secondary thresholds are read only after verification ([discovery-renewal-secondary.ts:25](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery-renewal-secondary.ts:25)). The edited-protocol regression is present at [discovery_renewal.ts:234](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tests/deno/discovery_renewal.ts:234).

2. **P2 replay coverage and supporting artifacts — closed.** Required case/backend pairs must match; standalone replay artifacts are cross-checked and hashed; extra audit entries are rejected; initial files are checked ([discovery-import.ts:62](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/lib/discovery-import.ts:62)). Independent rehashing passed for 36 source files, 40 cases, 152 checkpoints and all four replay artifacts. The stored import digest reproduces as `5678befe…`.

3. **P2 validation cost — closed.** Stats time full validation and calculate per-attempt execution-plus-validation before computing role percentiles ([discovery.ts:517](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:517)). Both regenerated summaries reproduce arithmetically. Benchmark complete p90 is **18.919 s primary / 15.539 s replay**; the 120-second cap provides **6.34×** headroom. The figures and original cap-setting basis are disclosed at [PLAN.md:38](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:38) and [COUNCIL.md:81](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/COUNCIL.md:81).

4. **P2 energy over-attribution — closed.** The wording limits conclusions to measured PHOTO/GROW shares and accounting bounds, explicitly leaving energy-origin attribution untested ([PRD.md:47](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PRD.md:47); [SECONDARY-EXPLORATORY.md:69](/Users/nicholas/develop/browser-life/runs/discovery/renewal-v1-imported/SECONDARY-EXPLORATORY.md:69)).

5. **P3 stale summaries — closed.** Current stage status and dependency history are reconciled at [PLAN.md:3](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:3), [PLAN.md:28](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:28) and [COUNCIL.md:146](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/COUNCIL.md:146).

**No new P0–P3 defect found within this narrow scope.** Nothing was modified; simulations and mutation harnesses were not executed.

The initial release may now be recorded as **met with its stated limits**: S2 retains the disclosed 3/4 positive-control sensitivity; S3 supplies a bounded negative over the frozen panel, with exploratory secondary readouts; imported evidence remains distinct from discovery replay; pinned renewal campaigns use shards, while the plane supports `cpu-ref-v1`; and later scientific extensions remain gated. This confirms the repairs against the existing release evidence, without re-auditing the earlier plane demonstration.
