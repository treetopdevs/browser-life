# Two unchanged replications of food-band longevity

26 October 2026. Base: reviewed PR #107 tip 111c290c643e4248186f3c0d11a656370602191d. Moving and stationary seed 1201 both stayed varied through 6,000. Replicate that unchanged screen on the two remaining previously used seeds. Both moving and stationary tails are new outcomes here; neither is a predetermined 6,000-tick control.

## Frozen schedule and stop rules

Run seed 1202, then seed 1203. Each pair runs moving first, then stationary, from initialization to 6,000 or actual extinction, with one independently initialized exact repeat per arm. Both modes must exactly reproduce their own accepted 0–3,000 prefix. Only ticks 3,001–6,000 are new. Do not rerun seed 1201.

Run the second scheduled seed even if the first has a valid biological or visual-screen failure. A source, accounting, correctness, repeat, truncation, byte-limit or prefix failure invalidates that pair and halts further outcome runs. Preserve failed attempts; only a reviewed assay-only repair permits retry of the whole invalid pair, never a new seed or changed rule. An unresolved invalid 1202 prevents 1203 and leaves the aggregate incomplete/inconclusive. Valid biological failures are never retried. Log each attempt before launch and preserve stdout/stderr; disclose completed arm outcomes before continuing so a later failure cannot hide them.

Moving must validate before stationary starts, but a valid moving biological failure does not cancel stationary. Extinction stops that arm at its true terminal tick; otherwise run through 6,000 even after family loss. Stop after these two scheduled pairs regardless of result. No extra seed, parameter sweep, horizon increase, rule tuning or rescue.

## Unchanged model and gates

Use apps/lab/src/stationary-food/model.ts unchanged, SHA256 7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f. Bands span 48 columns by 96 rows; stationary left edge 0, moving floor(tick/50)%96. Initial food 20 per tile, 768 units every 5 ticks, unchanged biology, mutation, reserves, stride/rotation, caps, history and lineage. Offered food matches per pulse through shared executed time; accepted food may differ and deposited food remains. History capacity 451 covers 301 samples. The moving band completes its first lap at 4,800 by design.

Each arm passes only if alive at 6,000 with at least two nonzero founder families; births AND deaths positive in EACH window 4,501–5,000, 5,001–5,500, 5,501–6,000; and at most 99 cap-48 ticks in EACH 500-tick window. Missing/partial windows fail, without extrapolation. No earlier window is an extra gate.

Parent judges occupied-body arrangements from 5,500 to 6,000: name at least one concrete shifted, expanded or cleared cluster or gap. Colors, IDs, food or outlines alone cannot pass. Unclear judgments fail the screen but are not biological failure. Biologically unreached endpoints fail with that reason; assay-caused missing data invalidates the pair. Record an observation for both arms even if one already fails numerically. Actual extinction frames remain truthful replay endpoints and are held; a true visual pass requires both exact late frames. Commit SHA-bound observations before overlap diagnostics.

## Frozen aggregate interpretation

For each new seed, report both-pass, moving-only, stationary-only or neither, and list failed numerical windows/criteria and visual uncertainty separately. Aggregate the two NEW seeds as this four-category tally, plus each mode's pass count out of two. Historical seed 1201 is separate; an optional three-seed descriptive total must explicitly identify it as historical. If either new pair is invalid, the planned aggregate is incomplete, never convert invalidity into biological failure.

Both passing means the permissive screen did not distinguish arms, not equality, superiority or lasting diversity. A one-body minority can pass. If outcomes differ, describe seed sensitivity rather than a population-wide advantage. Stationary failure confounds motion with coverage because half the torus never receives direct stationary replenishment. Report family sizes, programs, first observed absent-family samples at 20-tick resolution, resource totals and which late windows fail as descriptive diagnostics. Prior 3,000-tick outcomes and media are known; disclose that judgment is not blind. No adaptation, fitness improvement or open-ended-evolution claim.

Any next creative rule or further replication needs a separate reviewed plan. These outcomes do not authorize automatic additional trials.

## Evidence and implementation contract

New tools/food-band-longevity-replication/explore.ts, explicit seed 1202 or 1203 only, outputs under docs/creative-prototypes/food-band-longevity-replication-*. No import execution or overwrite. Keep historical horizon 3,000 separate from new horizon 6,000. Node 24.2.0 darwin/arm64. Commit reviewed plan before implementation and reviewed runner before outcomes. Preserve every old model, runner, artifact, receipt, viewer and media file; append only the running HTML decision log.

Seed 1202: use PR #105 stationary-food-moving-band-seed-1202.json and stationary-food-stationary-band-seed-1202.json with stationary-food-index-1202.json; historical kind hungry-shapes-stationary-food-arm. Seed 1203: use PR #106 stationary-food-replication-moving-band-seed-1203.json and stationary-food-replication-stationary-band-seed-1203.json with its corresponding index; historical kind hungry-shapes-stationary-food-replication-arm. Validate their distinct provenance/source schemas with their own frozen check-only runners, pin raw/data/index identities, then compare exact simulation projections. Never conflate wrappers or alter historical source hashes.

For EACH arm compare rules and seed/mode/mutation, all 151 prefix samples and frames through 3,000, all 3,000 tick rows, and five complete snapshots at 0/500/1500/2500/3000. Tick-3,000 sample/frame remain included, and its live snapshot terminal flag remains false. No normalization. Longer-run maxTick/finalTick, final/windows/repeat/gate and provenance wrappers differ by design. Compare prefixes as produced, stopping immediately on mismatch; validate them again in accepted artifacts.

Save every 20-tick sample/frame plus actual off-cadence terminal, all executed tick rows, and snapshots at 0/500/1500/2500/3000/4500/5500/6000 plus terminal. Retain per-tick bounds, conservation, connectivity, census and repeat checks, full repeat state/frame checks every 20 ticks plus terminal, lineage/history joins and maximum-ever generation. No fabricated postextinction data. Keep the 24 MiB per-arm and 10,000-node limits.

Capacity preflight: historical 1202 moving/stationary have 4,858,272/4,708,390 bytes and 466/444 lineage nodes; 1203 has 4,843,971/4,788,838 bytes and 472/480 nodes. A three-times-largest planning estimate is 14,574,816 bytes and 1,440 nodes, below unchanged limits of 25,165,824 bytes and 10,000 nodes. These are estimates, not guarantees. PR #107's completed arms were about 10 MB. Hard checks remain authoritative; no silent limit increase.

New arm kind hungry-shapes-food-band-longevity-replication-arm and pair kind hungry-shapes-food-band-longevity-replication-pair. Seed-scoped manifests/receipts bind plan, raw hashes and verdicts. Companion offers the two seed choices with actual-tick shared replay, paused default, truthful terminal hold, families/resources/turnover, animations and body-only images at 3,000/5,500/6,000. Consumers must agree on receipt wording/schema, numerical gates and source pins. Fail closed on contradictions. Diagnostics must require an unchanged committed receipt and automatically run successful check-only validation before overlap; no simulation in --check. --replay-check is not a routine validation step.

## Workflow

Claude Sonnet 5.5 High and Codex Sol 6.1 High adversarial plan reviews; implementation and meaningful no-outcome tests; both implementation reviews/fixes; frozen runner; two scheduled pairs; parent visual receipts committed before diagnostics; final media/results/decision log; both final reviews/fixes; commit and dependent PR on codex/food-band-longevity. No merge or deployment.

## Pre-freeze review clarifications

Run and validate both scheduled numerical pairs before parent visual judgments, unless a correctness stop prevents 1203. The receipts explicitly disclose that the parent knows both seeds' numerical outcomes and prior prefix media. Visual thresholds remain frozen; knowing later numbers cannot alter the criteria or schedule.

Before any new outcome run, execute the correct historical check-only runners and verify old runner SHAs, reference/index hashes and their transitive baseline pins. No new run begins on failed historical validation. Source preservation is not delegated to a post-outcome check.

If either pair is invalid, disclose any completed arm outcomes from that attempt but exclude the entire invalid pair from all pass tallies. Report mode counts as x of n valid pairs while marking the planned two-seed aggregate incomplete; never imply an invalid missing pair was a biological failure.

Extinction exactly at 6,000 is extinction with terminal true and zero population, not a survivor. It fails alive-at-6,000 even though both late frames may exist.

The 24 MiB and 10,000-node limits remain unchanged in this slice. A genuine capacity exceedance closes the pair inconclusive; retry may repair an assay bug but may not raise either limit. Any limit change needs a separate amended plan outside this experiment.

A moving failure after the 4,800-tick lap also mixes the designed revisit effects; it does not isolate a general motion deficit. Both designs are engineered environments.
