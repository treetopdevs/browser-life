# Does a broad food band need to move?

26 October 2026. New slice from reviewed PR 104 tip ff49229987c2e57788be7c8ac1e609474efc08f6. Moving food passed three descriptive screens, but uniform food also keeps changing. Tiny earlier patches failed; do not repeat that geometry. Compare the successful broad moving band with exactly the same broad band held still.

## Smallest frozen test

Only seed 1202 (the first replication seed, chosen before stationary outcomes), mutation enabled, from initialization to 3000 or actual extinction. Two arms: moving-band and stationary-band. Independently initialized exact repeat of each. No other seeds or longer horizon in this slice, even on pass. Previously accepted moving 1202 is the exact regression reference, not another independent success.

Create an isolated copy of the PR103 moving-food model at apps/lab/src/stationary-food/model.ts. Add stationary-band only: 48 columns spanning 96 rows, left edge 0 forever. Moving remains floor(tick/50)%96. Same initial 20 food on every tile, 768 integer food units each 5 ticks, deterministic stride 2053 and seed rotation over 4608 targets. Stationary targets use the existing moving mapping at geometry tick 0, without resetting the pulse index or adding RNG calls. No change to biology, founding layout, reproduction, mortality, mutation, reserves, caps, history 451 or energy accounting. Deposited food remains after a moving band leaves. Offered food is matched; accepted food need not match. Stationary placement 0 is fixed, not optimized after seeing outcomes.

## Gates and stop rules

Correctness, source, accounting, independent-repeat, truncation or moving-reference mismatch: halt acceptance and further outcome runs, preserve logs, repair the assay without rule tuning and review before retry. Unresolved invalid evidence closes inconclusive. Never delete failed attempts or relabel them as another seed.

Apply the same numerical criteria separately to both arms: alive with positive population at 3000, at least 2 nonzero founder families, births AND deaths positive in each late window 1501–2000,2001–2500,2501–3000, and at most 99 cap 48 ticks per 500-tick window. Unreached windows fail. Parent judges within-arm change in occupied-body arrangements from 2,500 to 3,000: at least one concrete shifted/expanded/cleared cluster or gap; IDs, colors, food brightness or band outline alone cannot pass. Unclear judgments fail. Record named observations before computing overlap diagnostics, with committed SHA-bound visual receipt first.

If both pass, retain both as varied prototypes and report that this screen did not distinguish the arms on this seed; do not claim equality or no effect. If only one passes, report that the screen separated the arms on this seed and list the failed criteria. If neither passes, stop promotion. In every case stop after this pair. Same-age comparisons at 1500/2500/3000 are descriptive, not an extra advantage gate: ordinary trajectory divergence is not proof of better behavior. No superiority, fitness, tracking, adaptation or open-ended-evolution claim from one seed. A promising outcome can nominate a separate reviewed replication plan; no automatic replication in this slice.

## Evidence and replay

New runner tools/stationary-food/explore.ts, explicit --write/--check --seed 1202 only, no import execution or overwrite, Node 24.2.0 darwin/arm64. Commit reviewed plan before implementation and pin its SHA. Commit reviewed runner before outcomes. Pin historical dependencies, PR 104 moving 1202 artifact/data and the original model/runner. Validate the frozen historical record check-only before writing. The new moving arm must exactly match all 151 sample/state/frame payload projections, 3000 tick rows and all 5 saved full snapshots at 0/500/1500/2500/3000 from accepted moving 1202. Metadata/source hashes necessarily differ between runners; never normalize simulation state. Report precisely what was compared.

Keep per-tick safety, conservation, connectivity and census checks; exact independently initialized repeat states/frames every 20 ticks plus actual terminal; all 151 samples/frames when alive; all tick rows; full snapshots 0/500/1500/2500/3000 plus actual terminal. Preserve exact schemas, history/lineage joins, maximum-ever generation, food offered/accepted/overflow, max 24 MiB per arm, no invented postextinction frames. Record both stationary and moving geometry truthfully. Report in-band occupancy only as a diagnostic using each arm's actual band, not comparable fitness.

Separate new artifacts, pair manifest and parent receipt bind plan, arm raw hashes and decisions. Replay shows moving versus stationary with explicitly labeled outlines on both, shared actual-tick scrubber, paused default, honest terminal hold, family populations, turnover and resource counters. Fail closed on wrong seed/mode/source/hash/receipt/numerical gate, missing true visual endpoints or inconsistent promising decisions. Add saved-frame animations and body-only comparison images. Keep all historical models, runners, receipts, viewers and media unchanged.

## Workflow

Plan → Claude Sonnet 5.5 High and Codex Sol 6.1 High adversarial reviews → implementation and meaningful tests → implementation review/fixes → first seed → parent visual receipt committed before overlap diagnostics → final reviews/fixes → commit and PR based on codex/moving-food-replication. Update running decisions.html and companion. No merge or deployment. Use delegated mechanical work; parent owns plan, interpretation and integration.

## Review resolutions before freezing

Claude identified interpretive and assay clarifications; Codex found no blockers. The visual gate is explicitly **within-arm change from 2,500 to 3,000**. The prior moving-versus-uniform difference gate is deliberately dropped because this new question compares two band designs, not uniform food. Re-judge moving under the new per-arm wording; a different judgment does not overwrite the historical receipt and must be explained as a new screen decision. Its numerical outcome is predetermined by exact regression to the saved moving record, not an independent confirmation.

A stationary failure does not isolate motion from coverage: the fixed band never directly replenishes the other half of the torus, whereas moving replenishment reaches other columns. Both passing means this screen did not distinguish them, not equal behavior or proof motion has no benefit. Keep the simpler stationary world if it remains varied; differences in any direction motivate a separate bounded next plan.

Tests must cover all stationary-mode wiring (target creation, foodTargets getter, environment, supply). Both modes have 4,608 targets and width 48; stationary left edge is always zero. Compare exact snapshots and food arrays through tick 49; compare environment after excluding only its mode label. The first nine pulses match; tick 50 is the first destination change. No normalization is permitted in the moving-to-historical regression. Review the isolated model diff and confine changes to adding stationary mode, geometry selection and provenance; the header names the copied source SHA b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0.

Matched offered food means equal per-pulse budget through shared executed time; an extinct arm stops receiving food. Window births/deaths are cumulative-counter differences over the named 500 executed ticks; cap 48 counts post-tick population exactly 48 in those rows. Overlap diagnostics mean occupied-tile intersection/union between saved frames, computed only after the committed visual receipt; these do not decide the screen. Every outcome-producing attempt is logged. Stop after seed 1202 regardless of result.
