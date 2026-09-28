# Constructed observer controls

Run the deterministic CPU-only controls with `deno run -A tools/foundation-controls.ts`. The command emits a versioned JSON report containing each constructed condition, expected measurement, observed measurement, assertion status, sample denominator, cadence/threshold sensitivity, and explicit limits. Tests run with `pnpm vitest run tools/test/foundation-controls.test.ts`.

These are hand-built readback arrays passed through the existing `census`, `Tracker`, `CollectiveTracker`, and `morphology` functions. They test detector behavior only. They do not step the physics, establish viable organisms, demonstrate reproduction, or measure evolutionary fitness.

## Controls and observed behavior

| Control | Expected condition | Measured result | What it establishes |
|---|---|---|---|
| Separate vs contacting | Two disconnected 2×2 patches; then the same patches touching, with distinct lineage IDs | Census returns 2 components when separate; contact returns 1 component while preserving 2 lineage records | Census components are connected bound-mass regions, not one-per-lineage organisms |
| Proximity collective | Three disconnected census components; compare link distances 5 and 3 cells with `minMembers=3` | One collective at distance 5; zero at distance 3 | Collective membership is a centroid-distance grouping rule, even when members have no shared bound-mass component |
| Split readback | One tracked component divides into two components that each overlap the parent | 1 tracker `fission` event | Observer detects the topology transition across these readbacks |
| Fusion readback | Two tracked components connect into one, with both contributing overlapping cells | 1 tracker `fusion` event | Observer detects the topology transition across these readbacks |
| Zero-overlap translation | Same 3×3 patch appears at a distant position with no overlapping occupied cells | 1 `death` plus 1 `birth` | Overlap tracking cannot distinguish transport without overlap from extinction followed by a new appearance |
| Membrane rim/core | Filled component has membrane fraction 0.9 at its rim and 0.1 in its core; uniform control has 0.5 in both | `compartmentalised=1` for the first and 0 for uniform | The current classifier responds to its rim-versus-core fraction contrast |
| Hollow shell limit | One-cell-thick membrane-rich ring with no bound-mass core | `compartmentalised=0` | Enclosure alone does not qualify; this implementation requires in-component core observations as well as a membrane-rich rim |

The compartment classifier compares mean per-cell membrane fraction `P/(B+P)` at the component rim with the mean in its core. It requires both rim and core cells and a rim-minus-core difference greater than 0.15 (`packages/metrics/src/complexity.ts:145`). The positive control therefore encodes the detector's actual inequality, not an independent biological definition of a compartment.

## Sampling and cutoff sensitivity

The scripted split-and-rejoin sequence yields 1 `fission` and 1 `fusion` when every frame is observed (`censusEvery=1`). Sampling only frames 0 and 2 (`censusEvery=2`) observes the same connected shape at both ends and records neither event. For the transient membrane-positive frame, `deepEvery=1` measures compartment counts `[0,1,0]` (mean 1/3); `deepEvery=2` samples frames 0 and 2 and measures `[0,0]` (mean 0). Both deep schedules have complete denominators for the observations they schedule; the skipped middle frame is not entered as a zero.

For a pair of 3×3 patches joined by a single cell with bound mass 48, cell threshold 48 produces one component of mass 1,848 and threshold 49 removes the bridge, producing two components. With the constructed `minMass=300`, the resulting component(s) are tracked as individuals; with `minMass=2,000`, none qualify. These are deliberate sensitivity values for the fixture, not a recommendation to change the configured observer thresholds.

## Event-label limits

`Tracker` uses cell-label overlap between observed censuses. Its `fission` and `fusion` labels describe one-to-many and many-to-one overlap/topology transitions. They do not show that a daughter survives, reproduces again, acquires resources, or inherits a functional organization. A `birth` can also be generated for a component with no prior overlapping predecessor; the transport control shows why a tracker event alone can overstate a biological birth. Census spacing can hide transient topology changes, and the cell-mass threshold plus individual `minMass` cutoff change which objects enter tracking.

Every JSON control carries `frames`, `expectedMeasurements`, `measuredMeasurements`, and `missingMeasurements`. Numeric summaries separately record scheduled observations and finite readbacks. If no finite values exist, the value is `null` with a nonzero missing denominator; the helper never replaces unavailable measurements with zero. Assertion statuses mean only that the constructed detector output matched, failed, or lacked the fixture's expected readback.
