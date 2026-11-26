# Prototype PR merge record — 24 October 2026

The user authorized merging ready PRs in dependency order, resolving conflicts and rerunning relevant checks, with **no deployment**. This record is published last through [PR79](https://github.com/treetopdevs/browser-life/pull/79). Draft PR60 (public opening) and draft PR69 (new bell protocol) remain untouched.

## Merge sequence and provenance

All feature PRs below are confirmed merged. Merge commits preserve their reviewed source ancestry. PR83 was retargeted to main only after its PR74 dependency merged. The status/decision record in PR79 is the final merge in the sequence.

| Order | PR | GitHub merge commit |
|---|---|---|
| 1 | [#72](https://github.com/treetopdevs/browser-life/pull/72) | `bddbfc82e49dad7eed301e01219e9c1626867ceb` |
| 2 | [#73](https://github.com/treetopdevs/browser-life/pull/73) | `41c3b5609ea0c415802a5cebdd8a8e0882a7952a` |
| 3 | [#74](https://github.com/treetopdevs/browser-life/pull/74) | `44545851e276ea125f1e30a6cb6c473ce7c4f24e` |
| 4 | [#75](https://github.com/treetopdevs/browser-life/pull/75) | `2a25eef28635722dfb47d9fb8f19b1df4094529b` |
| 5 | [#76](https://github.com/treetopdevs/browser-life/pull/76) | `2e6ecc397d7be787f9e03f18f6d18f746f4b3c73` |
| 6 | [#77](https://github.com/treetopdevs/browser-life/pull/77) | `f32abe5397f7341c62269fdf3112a1b5e5d51d6d` |
| 7 | [#78](https://github.com/treetopdevs/browser-life/pull/78) | `df272bf3612af1a782136bdfffae166e0c8d5c0a` |
| 8 | [#80](https://github.com/treetopdevs/browser-life/pull/80) | `9f353046bbb43cb0e56e5405b5d8c6f7c2be27a9` |
| 9 | [#81](https://github.com/treetopdevs/browser-life/pull/81) | `b696f3b037cf206e40add292a3c55e0aec4bffaa` |
| 10 | [#82](https://github.com/treetopdevs/browser-life/pull/82) | `0dbbe155884f3bcfec8fefc29971a62428a2bd61` |
| 11 | [#83](https://github.com/treetopdevs/browser-life/pull/83) | `7d91e09fa508ab9407b2c856e7b24c84a8f41b04` |
| 12 | [#79](https://github.com/treetopdevs/browser-life/pull/79) | This record and refreshed status; GitHub records its final merge SHA |

Feature main immediately before the status merge is `7d91e09fa508ab9407b2c856e7b24c84a8f41b04`. The ready-feature candidate used for the fresh checks was `4b64bcea442b9f5733711402a488797e7e9a68a4`. Source branches were updated against each successive main before merging, with expected head SHAs pinned on every GitHub merge request.

Conflicts during source-branch updates were confined to the shared HTML decision log in PR73, PR74, PR83 and PR79. Complete numbered entries were retained; no runtime conflict or product repair was needed. GitHub briefly reported stale mergeability after a push; the merge was retried only after the updated head and mergeable state were confirmed. No branch or worktree was deleted.

## Fresh pre-merge verification

- **306 unit tests across 15 files passed** in 452.36 seconds. The original CPU simulation run was retained through completion.
- **59 Chrome checks passed**, zero failures and zero skips, in 4.0 minutes. Coverage includes operator controls, membrane/receipt/Pond keeper flows, supplied wound/drain actions, public analytics/routes, real cross-origin retry, Stop and immediate leave.
- **575 coordinator tests passed** in the final quiet `mix precommit` run, including compilation with warnings as errors, unused-dependency and formatting checks.
- Typecheck and production build passed.

The first backend invocation ran alongside CPU/browser work and had two timing failures: a 100,000-segment speed assertion took 1,154,736 microseconds against a one-second limit, and a discovery fixture lease expired before qualification. Both passed in an isolated rerun; the full quiet rerun passed all 575 tests in 15.3 seconds. No code or timeout thresholds were changed. This is recorded as non-reproducing timing failures under concurrent test load, not silently discarded evidence.

Local logs are retained at `/tmp/prototype-merge-unit.log`, `/tmp/prototype-merge-build.log`, `/tmp/prototype-merge-browser.log`, `/tmp/prototype-merge-backend.log`, `/tmp/prototype-merge-backend-isolated.log`, and `/tmp/prototype-merge-backend-contended-failure.log`. They are local execution evidence, not portable repository attachments.

## Reproduction commands

```sh
pnpm typecheck
pnpm build
pnpm exec vitest run experiments/test/recovery-accessibility.test.ts experiments/test/recovery-severity-selector.test.ts apps/lab/test/pond-ranking.test.ts apps/lab/test/execution.test.ts apps/lab/test/shell.test.ts apps/lab/test/naturalist.test.ts apps/lab/test/naturalist-suggest.test.ts apps/lab/test/naturalist-series.test.ts packages/runner/test/island.test.ts packages/runner/test/island-page.test.ts packages/runner/test/island-cancel.test.ts packages/runner/test/island-backoff.test.ts packages/runner/test/island-retry-requests.test.ts apps/lab/test/analytics.test.ts tools/test/garden-dev-food.test.ts
(cd apps/coordinator && mix precommit)
BL_E2E_PORT=5272 BL_ISLAND_BACKOFF_WIRE=1 BL_EXPECT_ISLAND_LEAVE=1 BL_REQUIRE_BUILD_CHECK=1 pnpm exec playwright test tests/e2e/coordinator-ops.spec.ts tests/e2e/island-backoff-wire.spec.ts tests/e2e/lab-membrane.spec.ts tests/e2e/lab-naturalist-actions.spec.ts tests/e2e/lab-naturalist-receipts.spec.ts tests/e2e/lab-naturalist.spec.ts tests/e2e/lab-pond-keeper-v3.spec.ts tests/e2e/public-analytics.spec.ts tests/e2e/public-not-found.spec.ts --project=chrome --workers=1
```

For reliable wall-clock-sensitive backend checks on this host, run the backend suite after CPU/browser workloads finish. Real browser/coordinator tests use scratch data and cleaned-up local listeners; they do not contact or change the deployed service.

## Boundaries and final verification

The final feature branch runtime/test tree was compared against the tested candidate before PR83 merged, with no non-document differences. PR79 changes only status/evidence documentation after its base update. Final verification checks the resulting main against the candidate and confirms all twelve PRs merged.

The primary checkout remains on its existing recovery branch with its four untracked research files preserved; its working state is not reset or checked out to main. Source worktrees and the local integration branch remain recoverable. No deployment command, production configuration change, public founding, new scientific trial, paid computation or human playtest was performed.

