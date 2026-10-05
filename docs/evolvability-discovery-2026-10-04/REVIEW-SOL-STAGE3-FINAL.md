# Sol 6.1 High: final review before commit and its two confirmation passes

## Final review (session 01a10776-6ee0-70c2-b945-b91292ee8109)

**Not ready to commit.** No P0 found; two P1s and one P2 remain.

- **P1 — Duplicate blob acknowledgment still has a durability race.** [discovery_controller.ex:408](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator_web/controllers/discovery_controller.ex:408): two concurrent admin uploads of the first blob can race. The duplicate flushes the file, prefix directory and `blobs`, but omits the data root containing the newly created `blobs` entry. It can return 200 before that entry is durable; power loss can lose the acknowledged blob. Flush the data root too. This follow-up item remains **partial**.

- **P1 — Local publication leaves directory entries unflushed.** [discovery.ts:152](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:152), [discovery.ts:224](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:224): freeze syncs file contents and the campaign root, but omits its parent and artifact/case directories; replay similarly leaves new ancestors unflushed. Power loss after successful publication can lose initial artifacts, case specs or replay paths. Durably create directories and sync every containing directory.

- **P2 — Export lacks the source-root lock.** [discovery.ts:440](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:440): after checking index freshness, export copies live files. Concurrent replay or validation can change attempts or `acceptance.json`, producing an export whose report does not reproduce. Hold the existing root lock through validation and copying.

- **P3 — Stale stage summaries.** [PLAN.md:3](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:3) says no stage has executed; [README.md:3](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/README.md:3) says Stage 3a passed without qualifying its pending calibration gate. Align both with Implementation status.

The acquisition-time deadline, manifest config validation/block uniqueness, two-phase upload, and collection tolerance repairs are closed. Browser same-origin calls, fragment-only URL token intake, fragment clearing, sessionStorage and explicit start are present.

The O1–O9 evidence table, Stage 0 records and D6 agree with the supplied two-host evidence. I found no claim that the PRD or scientific requirements are complete; S1’s structural-only qualification is explicit. Run artifacts were unavailable for independent verification.

**Checks:** 136 coordinator tests passed; five CLI/test Deno entry points passed. Vitest was blocked by sandbox temporary-file restrictions. Checking the browser page with Deno’s current config failed on missing DOM types. No source edits, services or spending.
## Confirmation (session 01a1077f-0513-7450-9db3-f6f1e8f14a7a)

Three findings are closed; finding 2 remains **partial**.

1. **Closed:** duplicate blob acknowledgment flushes the file, prefix, `blobs/` and data root — [discovery_controller.ex:406–411](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator_web/controllers/discovery_controller.ex:406).
2. **Residual P1:** [discovery-fs.ts:89](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/lib/discovery-fs.ts:89) skips existing ancestors. Freeze A creates `/data/new`, then pauses before flushing `/data`. Freeze B publishes `/data/new/B`, sees `new` already exists, and succeeds without flushing `/data`. Power loss before A’s flush can lose B’s acknowledged campaign. Flush the ancestor chain through a durable boundary even when entries already exist.
3. **Closed:** export holds the source lock through freshness checking and copying — [discovery.ts:445](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:445).
4. **Closed:** [PLAN.md:3](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/PLAN.md:3) and [README.md:3](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/README.md:3) qualify the engineering and calibration gates.

No other new P0–P2 found. Static review only; reported tests were not rerun. No edits, services or spending.

not ready to commit

## Second confirmation (session 01a10782-90bb-70d2-bc46-ea085fd5140f)

Finding 2 is **closed**: [mkdirDurable](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/lib/discovery-fs.ts:88) now flushes every ancestor through `/`, including existing ones, eliminating the described race. No new P0–P2 found in this change; tests were not rerun. The code is ready on static inspection, but the repository-required Sol review could not launch under sandbox restrictions, so that commit gate remains unverified.
