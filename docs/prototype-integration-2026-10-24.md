# Local prototype integration validation — 2026-10-24

## Scope and provenance

This is a local combination and validation checkout, not a merge to main or deployment. No PR was opened or pushed from the integration branch. Source worktrees were not changed. No new scientific experiment was run; browser simulations are engineering fixtures.

- Checkout: `/Users/nicholas/.codex/worktrees/prototype-integration-2652/browser-life`
- Integration branch: `codex/prototype-integration-validation`
- Base: `b3fab90605401c9cf61822ea4e79839950948d45` (local `origin/main` snapshot).
- Local `main` independently points to `3f44c3197dd485d70998d5f1de63abd29f598eb0`; it was not moved or used as this integration base.
- Runtime integration commit: `42e7a8b6f5ee844881a269a70e56e156481ee65d`.

| Input branch | Exact included tip |
| --- | --- |
| `codex/recovery-severity-prototype` | `2340d0928d45cac3a3395151e1603a652a85fd1e` |
| `codex/pond-shell-ranking` | `8f28c0156d86cc578e319aca7054fa87b108f2e8` |
| `codex/island-leave` | `c572dcd9a2503a8a0d92179c2a299ca40c994a6a` |
| `codex/operator-counters` | `4a791b105e31638ac3d38be5ca402cc531b04d33` |
| `codex/membrane-view` | `8f2c200bca7d25a401892a8db182949941a6581a` |
| `codex/naturalist-receipts` | `95957cbfe9e3aeef1d208232bf31f8c7a985fa1e` |
| `codex/island-lease-config` | `ace5cacab34d07a0f121f0abbb67119dd6ddfc6a` |
| `codex/prototype-status` | `890b71c142092beca3e2bff71ef680d5c7581314` |

The lease branch was initially merged at `2cf9acd687b96608a09758ac0f0de9fbdaa60d6e`, then its documentation/moduledoc review follow-up `ace5cacab34d07a0f121f0abbb67119dd6ddfc6a` was merged before tests. Naturalist uses the final follow-up `95957cbfe9e3aeef1d208232bf31f8c7a985fa1e`, not its earlier `27a27c7` tip.

## Merge handling

All inputs were merged with ordinary local `--no-ff` merges, preserving their original commits. Recovery merged cleanly. Pond ranking, island leave, operator counters, membrane, naturalist receipts, lease configuration and status each conflicted only in appended entries of `docs/decisions-2026-10-17-backlog-run.html`. The lease follow-up merged cleanly.

Decision conflicts were resolved by retaining complete, byte-identical article blocks from each immutable input, keyed and sorted by decision id. This preserves each D35–D49 exactly once and avoids dropping closing tags where Git shares trailing HTML delimiters between appended articles. No runtime conflict resolution or integration-only product fix was needed.

Automatic code merges combined Queue leave/provenance with operator observations, and lab ranking, membrane legend and Naturalist receipt changes in main/protocol/worker. Their combined behavior is subject to the checks below; clean textual merging alone is not correctness evidence.

## Validation results

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass, exit 0 |
| `pnpm build` | Pass, exit 0 |
| Full coordinator `mix precommit` | 573 tests, 0 failures; compile warnings-as-errors and format complete |
| Combined Chrome feature suite | 41 passed, 0 failed, 0 skipped, 2.6 minutes |
| Focused unit suite | 11 files, 247 tests passed; exit 0, 329.26 seconds |
| Input ancestry and decision integrity | All eight final tips reachable; D35–D49 occur once and match source article contents |

Chrome uses reserved `BL_E2E_PORT=5262`, one worker, and a separate Vite child with strict port checking. Dependencies were freshly installed from frozen JS and tracked Elixir lockfiles; no dirty source checkout dependencies or code were copied.


### Commands and coverage

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test experiments/test/recovery-accessibility.test.ts experiments/test/recovery-severity-selector.test.ts apps/lab/test/pond-ranking.test.ts apps/lab/test/execution.test.ts apps/lab/test/shell.test.ts apps/lab/test/naturalist.test.ts apps/lab/test/naturalist-suggest.test.ts apps/lab/test/naturalist-series.test.ts packages/runner/test/island.test.ts packages/runner/test/island-page.test.ts packages/runner/test/island-cancel.test.ts
cd apps/coordinator
mix deps.get
mix precommit
```

From the repository root:

```sh
BL_E2E_PORT=5262 pnpm exec playwright test --project=chrome --workers=1 tests/e2e/lab-pond-keeper-v3.spec.ts tests/e2e/lab-membrane.spec.ts tests/e2e/lab-naturalist.spec.ts tests/e2e/lab-naturalist-receipts.spec.ts tests/e2e/coordinator-ops.spec.ts
```

Chrome breakdown: 31 operator-dashboard checks, three membrane checks, one Naturalist receipt check, five existing Naturalist checks, and one Pond Keeper scenario including shell readout and session replay. Membrane checks include pixels and unchanged simulation hashes. Operator HTTP is fixture-backed here; coordinator checks independently exercise real Queue/controller behavior. This is not deployment or production evidence.

The focused unit invocation includes the full CPU simulation execution suite. It took longer than the browser suite; read-only process sampling confirmed active `sim-ref` stepping and advancement between named tests, so the original run was retained rather than interrupted/restarted.

Dependency installation printed advisories for existing pinned Elixir dependencies. No dependency lockfile was changed as part of this validation.


## Outcome and limits

All requested integrated checks passed: typecheck, build, 247 focused unit tests, 573 coordinator tests and 41 Chrome checks. The original unit process completed normally after 329.26 seconds. No meaningful product failure or integration-only code repair was found. `git diff --check` is clean, and the runtime integration tree was unchanged by testing.

Keep three states separate:

1. **Main:** the base remains the local `origin/main` snapshot `b3fab906`; neither local `main` nor GitHub main was changed here.
2. **Feature branches / open PRs:** the table records exact source tips. Review approvals, hosted checks and readiness remain the root agent's independently tracked responsibilities. Local success does not merge those PRs.
3. **Local integration:** `42e7a8b6` combines the listed tips and has the evidence above. Subsequent integration documentation changes add this report and decision D50, without changing tested runtime files. The branch was not pushed.

No scientific trial, production deployment, shared-garden opening, human playtest or live production behavior is established by this result. The broader prototype goal is not declared complete.


## Incremental validation: public follow-ups and local food

The same local integration branch additionally combines PR80 at `25f692de0244afd13bdef272fd911c56b543b075` and PR81 at `a2b1f5c84d6443ebf0cdf623bcbba0b106d779bc`. Tested runtime integration commit: `b3070a0`. Only decision-log append conflicts occurred; complete existing entries were preserved and D51/D52 appended. No runtime conflict or repair was needed.

Validation passed: seven analytics/launcher unit tests, typecheck, production build, and all 13 Chrome analytics/not-found checks. The browser checks exercise real local Caddy and Vite preview/dev responses; analytics requests are intercepted. An initial pre-build run skipped nine artifact-dependent checks because its build was stale; the fresh-build rerun passed all 13 with no skips.

Commands: `pnpm exec vitest run apps/lab/test/analytics.test.ts tools/test/garden-dev-food.test.ts`, `pnpm typecheck`, `pnpm build`, and `BL_E2E_PORT=5262 pnpm exec playwright test tests/e2e/public-analytics.spec.ts tests/e2e/public-not-found.spec.ts --project=chrome --workers=1`. These incremental checks do not rerun or expand the previous backend/physics evidence. PR82 and island backoff remain outside this tested tree. No GitHub merge or deployment occurred.


## Incremental validation: island backoff with graceful leave

Local integration starts at `7a677beff12e9077f455ef5d9b54c0ebce45931b` and merges `codex/island-backoff` / PR83 at exact tip `754e022d740757d4ab2932a0738cba2bb91a8f38`. The existing immediate-leave input remains `c572dcd9a2503a8a0d92179c2a299ca40c994a6a` (PR74). The merge commit containing this section records both integration parents; no source branch, main or hosted PR is changed.

Only appended decision articles conflicted. All existing articles remain byte-identical, D54 is copied exactly from the backoff input, and D56 records this integration. D53 is absent from these inputs and is not invented. Runtime client, controller, limiter and CORS files merged automatically. Inspection confirms leave still uses a direct independent two-second fetch outside the retry gate, and CORS retains both DELETE and exposed retry headers.

The initial client run identified seven fixture expectation failures: backoff-only tests expected no HTTP call after Stop, whereas the combined lifecycle correctly sends DELETE for a known identity. The integration test fixture now accepts 204 leave, requires one final DELETE after successful known-identity scenarios, and requires leave at the same fake-clock timestamp as the refusal when Stop lands (no cooldown delay). Unknown aborted joins still send no leave. This is an integration-specific test adjustment, not a runtime defect or a fix to import into the backoff-only source branch unchanged.

Final checks:

| Check | Result |
| --- | --- |
| Five island/backoff/cancellation/page Vitest files | 148 tests passed, 39.86 seconds |
| Coordinator Queue and island HTTP limit suites | 124 tests, 0 failures, 11.6 seconds |
| Real cross-origin Chrome/Phoenix wire suite with combined leave | 3 passed, 0 skipped, 37.4 seconds |
| Typecheck | Passed |

```sh
pnpm exec vitest run packages/runner/test/island-backoff.test.ts packages/runner/test/island-retry-requests.test.ts packages/runner/test/island-cancel.test.ts packages/runner/test/island.test.ts packages/runner/test/island-page.test.ts
# In apps/coordinator:
mix test test/coordinator_web/island_limits_test.exs test/coordinator/queue_test.exs
# From repository root:
pnpm typecheck
BL_EXPECT_ISLAND_LEAVE=1 BL_ISLAND_BACKOFF_WIRE=1 BL_E2E_PORT=5272 BL_ISLAND_WIRE_PORT=5273 pnpm exec playwright test tests/e2e/island-backoff-wire.spec.ts --project=chrome --workers=1
```

Wire checks use the actual runner against a scratch Phoenix server: marked refusal delays the next join, accepted identity unregisters once with zero active rows, Stop during unknown-join cooldown produces no retry, and capacity-refusal headers are readable across origins. Existing held complete/reject/fail unit cases verify settlement before leave. No GPU or production behavior is claimed.

### Portable integration test patch

Apply this patch when combining the two source branches; do not weaken the exact leave assertions in the combined tree. It is retained here so the local integration-only change is reviewable and portable alongside the source-tip merge instructions.

```diff
diff --git a/packages/runner/test/island-retry-requests.test.ts b/packages/runner/test/island-retry-requests.test.ts
index 60cbd877..f7a1c934 100644
--- a/packages/runner/test/island-retry-requests.test.ts
+++ b/packages/runner/test/island-retry-requests.test.ts
@@ -26,6 +26,7 @@ function setup(target: string, options: { status?: number; stop?: AbortControlle
       options.stop?.abort("stop during refusal");
       return refused(options.status);
     }
+    if (key === "DELETE /api/islands/isl") return new Response(null, { status: 204 });
     if (key === "POST /api/islands") return json({ id: "isl", token: "secret" });
     if (key === "POST /api/next") {
       if (gaveTask) return json({ kind: "idle" });
@@ -72,6 +73,8 @@ describe("runIsland retries complete HTTP requests without redoing work", () =>
       expect(attempts[1].init.signal).toBeUndefined();
     }
     expect(run).toHaveBeenCalledTimes(mode === "reject" ? 0 : 1);
+    expect(seen.at(-1)?.key).toBe("DELETE /api/islands/isl");
+    expect(seen.filter((request) => request.key.startsWith("DELETE"))).toHaveLength(1);
   });
 
   it.each(paths)("Stop after refused %s prevents another attempt", async (path) => {
@@ -82,7 +85,8 @@ describe("runIsland retries complete HTTP requests without redoing work", () =>
     expect(await promise).toBe(0);
     expect(seen.filter((request) => request.key === path)).toHaveLength(1);
     const at = seen.findIndex((request) => request.key === path);
-    expect(seen.slice(at + 1)).toEqual([]);
+    expect(seen.slice(at + 1).map((request) => request.key)).toEqual(path === "POST /api/islands" ? [] : ["DELETE /api/islands/isl"]);
+    if (path !== "POST /api/islands") expect(seen.at(-1)?.at).toBe(seen[at].at); // leave bypasses the still-active retry cooldown
   });
 
   it.each(paths)("Stop during the %s backoff wait wakes immediately", async (path) => {
```

No push, hosted merge or deployment was performed. PR82 remains outside the tree tested in this section.


## Incremental validation: Naturalist action UI coverage

After island integration commit `b1c8919`, this local branch merges PR82's exact tip `afa9e24aa82171a39fe13cd3bb0c8706048334a1`. The input contains the reviewed Naturalist action assertions, its evidence document and DESIGN notes; it changes no runtime implementation. The only merge conflict was appended decision history. D53 is retained exactly from that input, all previous articles are unchanged, and D1–D56 are now each present once.

On the combined receipt/membrane/shell/backoff/leave tree, this command passed **2 Chrome checks, 0 failures, 0 skips, 45.6 seconds**:

```sh
BL_E2E_PORT=5272 pnpm exec playwright test tests/e2e/lab-naturalist-actions.spec.ts --project=chrome --workers=1
```

Both supplied lesion and drain suggestions at 375 px traverse the real worker and apply once. Their supplied suggestion fixtures and receipt assertions are engineering coverage, not evidence of a scientific benefit or a human playtest. No integration-only test or runtime adjustment was needed for PR82. `git diff --check` and decision-integrity checks pass. The merge commit containing this section records PR82's exact parent; no push, GitHub merge or deployment occurred.

The parent task will separately publish the stricter backoff-plus-leave test expectations on a source PR stacked over island leave, rather than leave that patch only in local integration. The frozen input hashes and measured results above remain the provenance of these runs; subsequent publication heads must be recorded separately.


## Source publication alignment: stacked backoff over leave

Finally, local integration `3ae458b0` merges the stacked PR83 publication tip `8d97f038568549d8d6b80577492061b3205ea22a`. That source branch now includes PR74 and the exact strict leave assertions retained above. The only conflict is the decision-log append; D57 is copied from the source tip while D1–D56 remain unchanged. All D1–D57 occur once.

The source alignment changes only decision/backoff evidence documents in this integration tree. A diff against the pre-alignment HEAD confirms **no changes to runner source/tests, coordinator source or browser specs**. The source task independently reports the same five island suites at 148 passing tests (38.15 seconds) plus typecheck. The existing combined 148-client, 124-coordinator and three wire-check evidence, and the two PR82 action checks, therefore apply to the unchanged runtime/test tree. No physics rerun is necessary for this documentation/ancestry merge.

This retains published source ancestry rather than relying on an unshared integration patch. The final integration merge remains local; no main/PR merge, deployment or new scientific trial occurred here.
