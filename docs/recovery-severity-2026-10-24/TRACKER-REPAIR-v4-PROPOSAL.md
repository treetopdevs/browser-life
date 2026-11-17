Implementation update: the reporting repair is now implemented and verified offline; see [v4 implementation](V4-IMPLEMENTATION.md). The original proposal below is retained as the design record. No native v4 execution or new science was launched.

# Tracker disagreement: diagnosis and proposed harness v4

2026-10-25. **Proposal only. No observer, simulation, selector, frozen protocol or acceptance criterion changed. No new simulation steps run.**

## Finding

The saved pair 2 mutant mass-targeted records reproduce the Stage 0 stop. This is temporal aliasing of the existing spatial-overlap identity rule: independent 25-step and 50-step updates can legitimately produce different retained histories. There is no demonstrated bookkeeping bug to repair in `Tracker` or `RemnantTrack`.

The [offline diagnostic](TRACKER-DIAGNOSIS.json) pins and validates the CPU25, GPU25 and GPU50 trace bytes against the retained Stage 0 audit inventory, authenticates the original target case, reconstructs each track from overlap evidence and checks trace rows against histories. CPU25 and GPU25 agree at all 81 observations. The two GPU schedules have identical persistent-state identities at all 41 shared observations, including initialization and final state. Labels below are census-local component labels, not persistent IDs.

| Recovery offset | 25-step retained label / mass | 50-step retained label / mass | Relevant overlap |
|---:|---|---|---|
| 0 | 0 / 2,463 | 0 / 2,463 | Same intervention state |
| 50 | 3 / 2,291 | 3 / 2,291 | Both views still agree |
| 75 | 2 / 2,057 | No observation | From label 3 at 50 to label 2 at 75: 11 eligible sites |
| 100 | 2 / 1,766 | null / 0 | Fast 75→100: 9 sites; slow 50→100: no outgoing eligible overlap from label 3 |

The smallest explanatory window has three physical observation times: 50, 75 and 100. Composing the two fast transitions retains a component; removing the intermediate observation loses it. These operations are not equivalent under spatial overlap. The intermediate label `2` must not be confused with label `2` at another time: label numbers are reassigned by each census.

`Tracker.update` creates continuations only from overlap with the immediately previous observed eligible components. A previous individual with no retained child dies; an eligible current component with no predecessor gets a new ID. `RemnantTrack` keeps the original retained ID and does not replace it with that new ID. Consequently, the 50-step result is the specified behavior, not a missed candidate that may simply be reacquired.

The first divergence is not caused by a split, fusion or tie. At each relevant fast transition the retained child has one predecessor and the retained parent one child. The slow retained parent has no outgoing edge at all. The fast track first splits at offset 150, first records incoming overlap at 250, and is lost at 400. The slow track is lost at 100. Six shared observations disagree, offsets 100–350. Both are lost at the end.

### Hypotheses checked

1. **Observation-cadence aliasing:** supported by the 11-site and 9-site intermediate overlaps and absent direct overlap. The independent overlap reader reproduces both histories.
2. **Tie/ownership bug:** unsupported at the first divergence; there is no competing edge for the retained fast continuation and no slow edge to resolve.
3. **CPU/GPU or observation-schedule physics divergence:** not observed; every saved shared persistent-state identity matches, and CPU25/GPU25 rows and tracks agree.
4. **Corrupt or inconsistent trace decisions:** not observed; file identities, complete cadences, independently derived continuity flags, retained labels and row masses validate.

The compact traces record eligible spatial-overlap counts, not the full intermediate cell-label fields or material ancestry. They establish why the observer loses continuity, but cannot separate motion, threshold crossings and shape change as the physical cause of the disappearing direct overlap. Calling it proven translation would exceed the evidence.

## Frozen disposition

PLAN.md requires independent views, no replacement of a lost ID, no incoming fusion/loss, and identical retained labels at shared observations for clean recovery. A cadence disagreement gives **T=2025 and no clean recovery**. Missing observations remain technical failures, not assigned penalties. This case also has later fast-view incoming overlap and loss, so it is a recovery failure independently of the initial disagreement.

The Stage 0 engineering paragraph separately requires equal tracked components at shared observations. That gate remains **not passed** and the retained attempt remains **TECHNICAL-STOP**. The endpoint's ability to classify this case as a failure is not permission to waive the engineering gate. The proposed repair cannot turn this deterministic record into a pass under unchanged rules.

## Proposed versioned repair: recovery-severity-stage0-v4

Repair the harness's evidence and error reporting, **not the historical track**. Keep the current tracker implementation, independent update schedules, original target and overlap initialization, lesion selection, physics, thresholds, return-time arithmetic and every frozen gate.

1. Split the combined `compareTraces` operation into physical-state comparison and retained-component comparison. Validate observation completeness, continuity evidence and row/history consistency before interpreting either. Keep CPU/GPU agreement checks at the same cadence separate from the cross-cadence sensitivity check.
2. Produce a typed branch diagnostic before stopping: `physicalParity`, `sameCadenceObserverParity`, `cadenceConcordance`, first/all shared disagreement offsets, per-grid loss/fusion history, frozen endpoint disposition, and the separate Stage 0 gate disposition. A physically matching branch with valid but discordant tracks records `CADENCE-DISAGREEMENT`, `T=2025`, `cleanRecovery=false`, and **Stage0=TECHNICAL-STOP**. This is a reporting category, not a new accepted outcome.
3. Persist the source/observer version, input and trace digests, initial target/remnant identities, actual grids, overlap edges and candidate-selection arithmetic with that diagnostic, using the existing shared budget and artifact-publication protections. Failure evidence must remain readable without masquerading as a successful result. The independent reader must derive the same dispositions from evidence rather than trust saved outcome bits.
4. Stop after persisting the failed branch diagnostic. Do not run the missing mutant sham as an automatic continuation, choose another engineering pair, retry unchanged trajectories, substitute a new retained component or launch fresh science. Preserve v1/v2 artifacts and their charges; v4 receives a new source/manifest identity and output directory if a future execution is separately authorized.

**Explicitly excluded:** feeding both views the same 25-step updates and merely downsampling output (makes the identity comparison tautological); centroid/nearest-neighbor or genotype-based reacquisition; bridging a lost coarse ID with fast-view edges; equating two null labels with successful continuity; dropping transient disagreements because final booleans match; widening gates or revising v1 outcomes. Such changes alter the observer/assay meaning and are not a repair within this frozen protocol.

### Offline acceptance tests before any execution decision

- Preserve this authenticated saved-record counterexample. Runtime comparison and independent reader must both report first disagreement at 100, all six offsets, physical agreement, T=2025, no clean recovery and no Stage 0 pass.
- Preserve a minimal synthetic three-frame overlap bridge with no split or fusion: the fine view retains continuity and the coarse view loses it. Removing the middle frame removes the fine continuation.
- Cover complete clean agreement; individually recovered views following different split daughters; transient disagreement followed by final agreement; one/both views lost; missing/duplicate/out-of-order observations; physical-state mismatch; corrupted files; contradictory overlap flags/trace rows; and failed budget accounting.
- Re-run the saved-evidence audit and focused regressions. Required read-only Sol 6.1 High review precedes an implementation phase boundary/commit. None of these steps needs GPU simulation or new worlds.

## What this does and does not unblock

V4 makes the failure reproducible and correctly separated from a physical parity defect. It does **not** meet the frozen Stage 0 identity requirement. There is no evidence-backed code correction that can make the existing overlap rule cadence-invariant on this record while also preserving its independent 50-step semantics. Under the user's constraints, the appropriate outcome is to retain the blocker, not promise a passing tracker fix.

Pair 2 mutant sham remains unexecuted, and v3 has no new end-to-end empirical run. The saved shared ledger charges 989,751 ms and 94,403,653 bytes, leaving 210,249 ms and 442,467,259 bytes before additional charges. A full repeat comparable to the 459,745-ms stopped attempt already exceeds that remaining time; this proposal does not reset or enlarge the cap. No empirical rerun is recommended or launched here.

## Reproduce offline

From the Stage 0 checkout, using the original v1 bundle as read-only input:

```sh
deno run -A experiments/recovery-severity/diagnose-cadence.ts \
  runs/recovery-severity/stage0-v2 /absolute/path/to/v1
```

The deterministic red-capable command adds `--assert-concordant`; it prints the same diagnostic and exits 3 for the recorded disagreement. Normal diagnosis exits 0 only after authenticating and validating the saved evidence; it never emits a Stage 0 pass. No source checkpoints or original traces are edited. The diagnostic program is implemented; the v4 harness repair above remains a proposal.

## Review and verification

Read-only Sol 6.1 High review confirmed the diagnosis, scope limits and absence of hidden frozen-criterion changes. It identified one missing integrity check in the new diagnostic: the input evidence file was not checked against its saved inventory pin. That check is now present; a deliberately altered input file is rejected before its case bindings are used. Positive diagnosis and the concordance-failure mode reproduce the same report byte for byte. Deno checking and all 33 focused recovery/selector/parity regressions passed. No simulation was advanced or scientific pair launched.
