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
