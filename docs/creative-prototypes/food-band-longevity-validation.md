# Food-band longevity validation

Plan committed in 63de59bd after Claude Sonnet 5.5 High and Codex Sol 6.1 High reviews. Implementation committed in 4bc53cf5 after both reviews and fixes. Plan SHA ed1e1a0bf7c997868409b72a0481c5c2cbd60a58ab58a21780350803ab0597f3; unchanged model SHA 7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f; frozen runner SHA 28f6dabf14bae6a4ad3ea25dff3014ec6e1ee8cfed36fabcf023182240b22fa9. Runtime Node 24.2.0 darwin/arm64.

The single attempt was logged before launch and exited successfully. It ran moving then stationary, with independently initialized repeats, and logged the completed moving result before stationary began. No invalid attempt, retry, extra seed or automatic extension occurred. The tracked attempt record retains command, start/end time, exit code and stdout/stderr.

Both modes exactly reproduce their own PR #106 seed-1201 prefix: 151 samples, 151 frames, 3,000 tick rows and five full snapshots through tick 3,000, including the live tick-3,000 snapshot. New horizon-wide summaries differ by design. Each completed arm has 301 samples/frames, 6,000 rows and eight snapshots. Accounting, bounds, connectivity, lineage/history joins, independent repeats and source checks pass. Raw artifact sizes are 10,070,026 and 9,878,299 bytes, below 24 MiB. No model or storage-limit changes were needed.

Review fixes preceded outcomes: corrected output paths; compared initialized tick-zero builders against both references without stepping; aligned receipt predicates and negative fixtures; enforced source-map parity; added completed-moving disclosure; covered off-cadence and fixed-tick extinction schedules; and made diagnostics run check-only validation automatically after the committed-receipt guard and before overlap calculations.

Core evidence tests pass 10/10, diagnostic tests 14/14 and unchanged-model tests 2/2. Repository typecheck, strict standalone runner typecheck and production build pass. All 14 browser cases pass together, including actual accepted artifacts, 3,000/5,500/6,000 tick jumps, playback/pause and mobile accessibility/overflow. Historical models, runners, artifacts, companions and media remain unchanged. Only the running decision log receives an appended section.

The runner's check-only command passed on both new arm files without simulation. Parent viewed body-only images at 3,000, 5,500 and 6,000, then recorded named within-arm changes and the nonblind disclosure. Receipt and artifacts were committed in bb200631 before diagnostics. The helper revalidates the evidence check-only before computing overlap. No merge or deployment; local validation is not hosted CI proof.

Paired video: 301 exact saved frames at 10 fps, 30.1 seconds, 1304×1088. ffprobe frame count and full decode pass. Metadata binds model/runner/plan/viewer, both accepted and historical arm identities, index/receipt and video digest.

Parent independently verified every media hash/binding and preservation of the historical decision log. After final HTML video/description additions, paired video playback and desktop/phone Axe/overflow checks passed with no page errors (runs/food-band-longevity/delivery.log).

The supplemental final video playback and layout smoke checks were parent-run using a temporary local script; that script and delivery.log are not included in the PR. Their pass is reported here, not presented as a reproducible CI artifact. The committed Playwright suite provides reproducible saved-data, playback, accessibility and layout checks. [Saved overlap diagnostics](food-band-longevity-diagnostics-1201.json) bind the committed receipt and remain descriptive, not pass criteria.
