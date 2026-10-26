# Moving versus stationary: validation

Plan committed in 690d8d3f after Claude Sonnet 5.5 High and Codex Sol 6.1 High review and closures. Model and runner committed in ddee2323 after both implementation reviewers cleared the core. The companion issues were repaired separately before delivery.

One logged outcome-producing attempt ran seed 1202, moving then stationary, each with an independently initialized repeat. It exited successfully. There was no retry, additional seed, parameter change or horizon extension. The moving reference is a regression, not a new independent finding. The [attempt record](stationary-food-attempts.json) preserves the start, completion, command and output.

Frozen model SHA 7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f; runner SHA ab692de5ede5ece9cfdc1af8d0e44c651a0bc30ff8aa6493b35e6a02672250f6; plan SHA ba835f94fddbd48a823fb6264d3e4f9d8a815014c5bc5e4997fec56e6f7aaa51. Runtime Node 24.2.0 darwin/arm64. Historical source and evidence bytes remain untouched.

Before outcomes, model tests verified identical snapshots, food arrays and environment excluding only its mode label through tick 49, with nine identical pulses, then different supply destinations at tick 50. The stationary band has 4,608 targets, width 48 and fixed left edge 0. The isolated model diff changes food-mode wiring only; supply sequencing, RNG and biology remain unchanged.

Both accepted artifacts retain 151 samples and frames, 3,000 tick rows and five full snapshots at 0/500/1500/2500/3000. Independent-repeat, connectivity, food/energy accounting, lineage/history joins and source checks pass. Both are below 24 MiB. The moving arm exactly matches the accepted PR 104 moving 1202 record across all those observations without state normalization.

Parent judged body-only comparison images before cross-frame overlap diagnostics. Each arm's named 2500→3000 change is in a separate plan- and arm-hash-bound receipt, committed before the helper permits overlap calculation. Same-age comparisons are descriptive; they are not an advantage gate. Diagnostics use each arm's own band position.

Completed test totals and companion checks are recorded below. Local proof is separate from hosted CI. No merge or deployment.


Completed local checks:
- Four focused test files: 29 tests pass, including both real artifacts, resealed invalid plan/model/geometry/prefix/snapshot records and committed-receipt ordering fixtures.
- Repository typecheck, strict standalone model/runner TypeScript check, and production build pass.
- `node --experimental-strip-types tools/stationary-food/explore.ts --check --seed 1202` passes. Historical moving-reference check passes without a new simulation.
- `BL_E2E_PORT=56332 pnpm exec playwright test tests/e2e/stationary-food.spec.ts --project=chrome` passes 14/14, including actual saved data, receipt binding, endpoint availability, desktop/phone accessibility and overflow, tick jumps and play/pause.
- Visual receipt committed in e87c477c before the saved-frame diagnostic helper ran. It binds both arm hashes and the plan; overlap measurements do not decide the gate.
- Paired animation: 151 exact saved frames at 10fps, 15.1 seconds, 1304×1088. ffprobe and full decode pass. Metadata binds model/runner/plan/viewer, both artifacts and internal data, pair manifest, visual receipt and video digest.
- Parent independently recomputed media source hashes, played the video in a real browser, and repeated Axe/overflow checks at 1440px and 390px after the video and comparison image were added. All pass.

Final Claude and Codex reviews found no blockers. The stationary legend accessibility label was corrected after review. [Saved overlap diagnostics](stationary-food-diagnostics-1202.json) bind the committed receipt and remain descriptive, not a gate. The committed index and receipt retain their original wording and hashes.

Delivery: [PR #105](https://github.com/treetopdevs/browser-life/pull/105), dependent on #104. The initial hosted status query returned no commit statuses; local checks are not a claim of hosted CI success.
