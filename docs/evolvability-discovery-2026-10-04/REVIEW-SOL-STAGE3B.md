**P0: none found. Stage 3b still has four P1 blockers. Eight previous Stage 3a findings are closed; four are only partially repaired.** Findings below are from static tracing of this uncommitted worktree. The quoted plane run demonstrates representative one-machine integration, but does not cover these failure scenarios.

1. **P1 — Filesystem aliases bypass registered-storage isolation.** [discovery.ex:84](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator/discovery.ex:84)  
   `Path.expand` compares lexical paths without resolving symlinks. A discovery directory symlinked into registered storage passes the overlap guard. An alias of the queue directory also shares its `state.bin`: on a fresh installation the processes can overwrite each other’s state; with existing registered state, discovery rejects its version and prevents application startup. Resolve both paths through their deepest existing ancestors before checking overlap.

2. **P1 — Plane acknowledgments are not power-loss durable.** [discovery.ex:659](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator/discovery.ex:659), [discovery_controller.ex:385](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator_web/controllers/discovery_controller.ex:385)  
   State and blobs are file-synced and renamed, but their containing directories are never synced. Blob `sync_file` also ignores sync failures. Power loss after acknowledged acceptance can lose the latest state or referenced blob entries. This directly violates DESIGN §7’s explicit durability requirement. Propagate sync errors and sync the relevant directory changes before acknowledgment.

3. **P1 — The plane does not enforce campaign budgets, and rejected uploads can consume unlimited storage.** [discovery.ex:390](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator/discovery.ex:390), [discovery_controller.ex:126](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator_web/controllers/discovery_controller.ex:126)  
   `campaignWallSeconds` and `campaignBytes` are stored but never consulted by scheduling, worker deadlines or publication. Additionally, `put_file` publishes bytes **before** `record_file` rejects completed attempts or conflicting digests. A worker can repeatedly PUT distinct 256 MiB checkpoints against its completed lease; every rejected request leaves another orphan blob. Persist and enforce campaign deadlines, reserve storage before publication, and prevent rejected mutations from leaving published bytes.

4. **P1 — Local campaign bounds remain bypassable across interrupted or concurrent invocations.** [discovery.ts:119](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:119), [discovery.ts:307](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:307), [discovery.ts:345](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/tools/discovery.ts:345)  
   Two stale-lock contenders can both read the dead holder, then one removes the other’s newly acquired lock; both proceed. Publication serialization is invocation-local, so concurrent cap checks can exceed storage, concurrency and attempt limits. Separately, an invocation killed before its first five-second usage tick contributes no usage. Make stale takeover ownership-safe, coordinate reservations across invocations, and account conservatively for interrupted usage.

5. **P2 — Acknowledged heartbeat extensions disappear on restart.** [discovery.ex:197](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator/discovery.ex:197)  
   Heartbeats update expiry only in memory. A worker can heartbeat beyond its original deadline, then lose its renewed lease after a restart if no intervening mutation persisted it. Its valid completion becomes late, consuming another technical attempt. Persist renewals or implement explicit recovery semantics that preserve acknowledged extensions. The current restart test does not cross the original expiry.

6. **P2 — Heartbeats do not cover the full leased operation.** [discovery-transport.ts:194](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/packages/runner/src/discovery-transport.ts:194)  
   Heartbeats start after artifact downloads and stop immediately after execution. Self-validation, uploads and server validation then run without renewal. The server validator permits 300 seconds against a default 120-second lease. An honest slow transfer or validation therefore causes correct results to be rejected as late; retries can exhaust the attempt cap. Maintain heartbeats from lease acquisition through acknowledgment, with cleanup in `finally`.

7. **P2 — A state-read error silently starts an empty plane.** [discovery.ex:104](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator/discovery.ex:104)  
   Every `File.read` error is treated as missing state. If an existing `state.bin` is unreadable while its directory remains writable, the next join or registration overwrites the previous campaign and acceptance history. Initialize empty state only for `:enoent`; fail startup for other errors.

8. **P2 — Unbounded history creates unbounded work inside the serialized GenServer.** [discovery.ex:143](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator/discovery.ex:143), [discovery.ex:662](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator/discovery.ex:662)  
   Every join creates a permanently retained worker. Expired qualification attempts also lack an effective retry bound. Every persistent mutation serializes and fsyncs the entire accumulated state inside the GenServer; scheduling and indexing scan historical maps. Repeated joins or qualification failures increase memory and critical-section duration until heartbeats queue behind storage work and expire valid leases. Bound admission/history and use bounded journal/checkpoint persistence.

9. **P2 — Continuity observer digests are not bound to the checkpoint observer.** [discovery.ts:518](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/packages/runner/src/discovery.ts:518)  
   Replace both continuity observer digests with the same arbitrary hash and regenerate the readout and file digests. Validation still succeeds: `restored.final(end, fin.continuity)` echoes the supplied continuity, and the readout compares the supplied digests only with each other. Recompute the segmented observer digest from the checkpoint’s complete observer section and validate the digest fields.

10. **P2 — Intermediate observation counter types remain permissive.** [discovery.ts:435](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/packages/runner/src/discovery.ts:435)  
    `DEC.test` coerces its input. Replacing an intermediate decimal-string counter with numeric `0` or `[0]`, then resealing the observations, passes structural validation. Endpoint recomputation does not inspect intermediate records. Require strings before regex checks for totals, flux, ledger and site counters; complete the final-record field validation too.

11. **P2 — Frozen-manifest structural validation remains incomplete.** [discovery.ts:524](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/packages/schema/src/discovery.ts:524)  
    `validateManifest` requires metadata keys but never validates the structures of `resolvedParameterDomain`, `habitats`, `encodedFounderPanel`, `assayDefinitions` or `seedNamespaces`. For example, a consistently rehashed campaign with `seedNamespaces: null` passes loading and attempt-context validation despite violating the declared schema. Validate these nested structures and their relevant references.

12. **P2 — Result worker and lease provenance are not checked.** [discovery_controller.ex:202](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/apps/coordinator/lib/coordinator_web/controllers/discovery_controller.ex:202)  
    An otherwise valid upload can name another `execution.workerId` and set `execution.leaseId` to `null` or an unrelated string. The controller checks attempt, role and host, but omits these identities; TS checks only their types. The result is accepted with contradictory audit provenance. Compare both fields with `a.worker` and `a.lease`, including qualification attempts.

**Stage 3a repair verification**, using the numbering of the verbatim previous review:

| Previous finding | Verdict | Evidence |
|---|---|---|
| 1. Stale acceptance index | **Closed** | `tools/discovery.ts:397–400` rebuilds and compares before reduction. |
| 2. Incomplete/malformed observation histories | **Partial** | Exact schedule and rejection wrapper are present; counter types remain permissive, finding 10. |
| 3. Summaries versus checkpoint contents | **Closed for the reported defect** | `packages/runner/src/discovery.ts:511–523` recomputes endpoints/final summaries and derives `passed`. Finding 9 is an additional continuity-binding gap. |
| 4. Hard campaign caps | **Partial** | Active workers receive the campaign deadline; publication checks exist. Interrupted usage and concurrent invocations remain vulnerable, finding 4. |
| 5. Local acceptance durability | **Closed** | `tools/lib/discovery-fs.ts:72–93` propagates directory-sync errors and atomically publishes indexes/reports. The plane introduces finding 2 separately. |
| 6. Concurrent-invocation caps | **Partial** | Ordinary live-holder exclusion works; concurrent stale takeover is unsafe, finding 4. |
| 7. Duplicate rows / strict frozen loading | **Partial** | Reducer schema/policy and duplicate/unexpected-row checks are present; nested manifest validation remains incomplete, finding 11. |
| 8. Continuity failure classification | **Closed** | `packages/metrics/src/capabilities.ts:430–431` returns invalid; attempt validation rejects that status. |
| 9. Required initial artifact | **Closed** | `initialFor` verifies bytes; normal attempt validation requires them. |
| 10. Local filesystem-alias isolation | **Closed** | `tools/discovery.ts:79–101` resolves existing ancestors; writing destinations are guarded. The plane has a separate alias defect. |
| 11. Recursive export destination | **Closed** | `tools/discovery.ts:421` rejects destinations inside or containing the root. |
| 12. Canonical key preservation/order | **Closed** | `packages/schema/src/discovery.ts:75–98` emits sorted keys directly, preserving integer-like and own `__proto__` keys. |

**What I checked and found sound:**

- Ordinary HTTP completion requires the TS validator. Missing validator configuration, validation failure and malformed verdict output fail closed. I found no HTTP acceptance path that bypasses it.
- Finalization checks expiry again after validation. A late lease cannot replace a completed attempt’s canonical payload; repeated completion preserves that payload and attempt verdict.
- Uploaded file digests become immutable once recorded.
- For validated scientific attempts, `Discovery.decide` matches `decideCase`: disagreement quarantines; acceptance requires an agreeing primary and replay spanning two host IDs.
- For an intact, quiescent campaign, collection preserves rejected/unfinished attempts, excludes them from acceptance, and revalidates plane-valid attempts. Its scientific decisions reproduce the plane’s decisions.
- Artifact hashing and TS validation run outside the GenServer. The serialized workload concern is whole-state persistence and history scans.
- Worker responses and browser build configuration expose no admin credential. Workers use the research join token and individual credentials.
- Registered/public queue acceptance code is unchanged. Normal discovery paths use separate state and storage, subject to finding 1.
- I found no competing renewal implementation or renewal experiment routed through the plane. D2 remains respected.

**Operational status**, based on the author’s quoted plane run, current tracing and the checks below:

| Criterion | Current evidence |
|---|---|
| O1 | Browser and CLI routes demonstrated on one Mac. **Second physical host still required.** |
| O2 | **Demonstrated on one machine:** CPU execution and useful incompatibility explanations. |
| O3 | Representative fault/restart/idempotency flow demonstrated; **partial** because of durability and lease-recovery defects. |
| O4 | Core identities are bound, but **partial** because continuity and execution provenance checks remain incomplete. |
| O5 | Agreement/quarantine and complete-set reduction work; **partial** because validation gaps remain. Physical cross-host reproducibility is pending. |
| O6 | **Not met:** plane campaign budgets are unenforced; local cap repairs remain partial. Default cloud refusal works. |
| O7 | Deferred until search exists. |
| O8 | **Demonstrated on one machine** for the intact engineering campaign: collection and reduction reproduce the shard result while retaining rejected/abandoned attempts. |
| O9 | Separate namespace/storage demonstrated for ordinary paths; **partial** because filesystem aliases bypass isolation. |

D6 still requires the Mac plus another physical host to complete and cross-replay all 12 cases through the required routes. Different labels on one Mac do not establish that proof. Fixing the implementation findings also remains necessary before closing the phase boundary.

Verification: coordinator `mix test` passed **130 tests, zero failures**. `deno check` passed for the CLI, worker and both integration scripts. Vitest and typecheck were blocked before execution by pnpm dependency-lock permissions; `discovery_local.ts` was blocked at temporary-directory creation. I made no source edits, started no services, ran no reservoir simulations, and did not run `discovery_plane.ts`.