# Foundational reset execution log

## 2026-09-29: protocol and input preflight

The corrected trimmed workflow is authorized and saved in `foundational-reset-plan.md`; the expanded proposal is retained separately. Work is confined to the foundations workspace. Main checkout is read-only. The persistent goal is active; no biological reset assay has run yet.

- Input snapshot v1: 305 files, 3,545,503,696 bytes, SHA-256 `1aed396f53f714f0d32db45bdf4bea2552c0cf55473011bde6df02a8b61ba67e`. This pins exact working files as well as historical data; it is not a replay result.
- Snapshot v2: 307 files; prospectively adds the entity contract and main `validate.json`, and records the user-approved whole-history strategy refinement. Snapshot v1 remains preserved.
- `input-preflight-v1.json` failed because the new preflight incorrectly interpreted the runner's recorded checkpoint hash as an artifact hash. Inspection of the original runner established it is a physical-state hash; both digests are now recorded explicitly. No source corruption was inferred.
- `input-preflight-v2.json` correctly stopped on protocol drift while the requested prospective plan refinement was being saved. The new protocol is explicitly repinned in v2; no experiment ran under either failed preflight.
- `input-preflight-v3.json` completed: all 307 input hashes, 100 physical checkpoints with compatible persisted observer states, and all 200 sampled birth rows checked. Elapsed 17.182 seconds. Physical hashes authenticate state; the independently computed observer/artifact hashes pin observer bytes but do not independently prove their historical correctness.
- `original-replay-reconciliation-v1.json` independently rehashes `series.jsonl` and `lineages.tsv` for each of the ten source histories against original M4 outputs. All twenty comparisons match. Receipt SHA-256 `abfeb199806088e2d07b29955ef4915aa9e8d2728095aa427f9a84bdb2812a1f`. This is the precise scope of the existing replay validation, not a claim about all unrecorded provenance.

The two workspaces have identical `sim-ref`, `sim-gpu` and `metrics` TypeScript source bytes. Main's schema differences add genome hex helpers and optional single-founder initialization. Runner differences add optional lineage observations and solo initialization; `observe.ts` is identical. The historical runner forbids checkpoint continuation with `lineageObs` because auxiliary seen-genome/prior-census bookkeeping is not persisted. A reset adapter must restore the common observer and separately reconstruct event membership, not pretend that auxiliary output can resume unchanged.

## G0 / G1 status

Primary and independent strongest-model review accept the operational distinctions in `reset-entity-contract.md`. G0's source/contract work is established locally; global seed clearance and independent main-manifest reconciliation remain explicit prerequisites before new scientific inputs are used. Historical replay seeds are intentionally reused for exact audit, never counted as fresh confirmation. No new scientific seed range has been allocated.

G1 remains pending. Sol is implementing a passive mutation-enabled copy ledger with physically executed controls. Acceptance requires exact default-path transport/lottery reconstruction, event-local parent support rather than founder-origin matching, uncertainty after unobserved transitions, and independent state/observer parity. Whole-history replay is preferred only after actual instrumentation throughput and storage benchmarks. A GPU-resident implementation may be necessary; no 3–4× slowdown or cloud cost estimate has been adopted.

The main session's independent manifest is awaited for entry-by-entry, path-normalized reconciliation. Paid work has not started; the shared $30 allocation is conditional on a measured forecast and the main session's budget record. The one implementer and independent reviewer work in separate responsibilities; no broad founder search or rule change is underway.

## Independent input reconciliation and pure observation controls

The main manifest subsequently arrived at `experiments/foundations/probe-a-inputs.json`. `tools/reset-reconcile-inputs.ts` checked all 331 entries against actual bytes, all 202 required overlapping historical inputs against the earlier local inventory, and ten replay specifications. There were no discrepancies. It also pins 124 files not present in the earlier inventory. Receipt: `main-manifest-reconciliation-v1.json`, SHA-256 `7532b62cae0132f6e9a1fb3cfff2c95370025c04c985498d179dbc2f896baae1`, 9.749 seconds. This supersedes the earlier awaiting-manifest status without changing source files.

The first eight `reset-copy-ledger` controls pass; the primary independently reran that focused suite. They exercise unchanged physical replay, mutation-enabled copying, default displacement against an executed reference oracle, a minority-material lottery winner, same-lineage distinct-parent supports, skipped paths and malformed inputs. The clamped-proposal case is a constructed classification case, not evidence of its natural frequency. Independent review grants a bounded pass for this pure logic and requires an additional executed mutation-followed-by-death case. It does not approve GPU parity, separation or scientific replay.

Sol's checkpoint-based engineering timing found approximately 0.139 ms per sampled source-site flow reconstruction, with additional small-support overhead. Full-world per-step CPU tracing is not a viable whole-history strategy. A passive GPU prototype is authorized only for bounded development controls (180 seconds total GPU, within the existing phase allocation). The only permissible production API edit is a read-only displacement-buffer accessor; physical commands and rule shaders remain unchanged. Scientific replay remains gated on actual parity, measured cost and a frozen run manifest. The selected checkpoint was used to measure support size and computation cost, not to tune outcome labels.

## GPU prototype and remaining interpretation boundaries

The first native 8-by-8 GPU control passed five mutation-enabled steps with 24 mutation events, including a four-step batch. Exact one-step winner/source/material diagnostics and final copy tags matched the reference; full terminal physics and mutation events matched an uninstrumented GPU twin. Receipt: `gpu-passive-control-1790696510694.json`. Independent review accepts this bounded prototype only, and identified a snapshot timestamp race and a missing maximum-step guard; Sol corrected both before further integration. A subsequent control exercises readback interleaving. None of these controls establishes natural separation, material heredity or full G1 readiness.

A 100-step 256-by-256 engineering benchmark on Apple M1 Max measured 96.20 ms bare GPU versus 117.43 ms with passive tracing (1.221 times baseline); terminal physics and all 58 mutation events matched. Receipt: `gpu-passive-benchmark-1790696621891.json`. The 1.043-second invocation is charged, not only the inner timer. This benchmark is too short and omits the full observer cadence, so a bounded 1,000-step cadence-inclusive benchmark is authorized before choosing the scientific replay strategy. No AWS cost forecast has yet been accepted.

Material-bound design warning: a tracer following only B/P can bound **continuously retained bound material**, but cannot claim total molecular ancestry. Parent material can leave B/P through decay, diffuse as C/A and later return through synthesis. A total-origin upper bound must account for that path or remain broad/unknown. Starting at step 0 does not repair a tracer that omits those paths. Any narrower retained-bound measurement must be named separately and must not turn dissolved-resource uptake into an invasion label.

## Completed cadence benchmark and immediate-parent reference

The cadence benchmark `gpu-passive-cadence-benchmark-1790696845662.json` runs 1,000 steps with 100-step readback, census, tracker and mutation draining. Bare time was 1.042 seconds; passive time 1.377 seconds (1.321 times). Terminal physical state, 518 mutation events and 151 tracker events match. Whole invocation was 3.098 seconds. Linear extrapolation gives 3.82 GPU-hours for ten million steps of this measured loop, excluding full historical observer, setup, additional measurements, writing, thermal changes and retries. It is not a final forecast or permission to exceed the allocation. The primary will prospectively revise the phase allocation within the total cap only after the completed observer benchmark.

Event-local tag reset and mutation-event join now have focused controls. A census reset marks the actual living sites at that census; ancestry thereafter refers to those sites, not to founders. Earlier mutation events remain exact event records but their effective/clamped classification is unavailable when only the final step's genotype diagnostic survives. This is a declared coverage limitation, not an inference that those mutations were ineffective. Total molecular ancestry remains unresolved.

Exact baseline source bytes (103 files) are preserved in `runs/foundational-reset/pinned-source-v1/` alongside their hashes. The new execution code requires its own exact-byte snapshot at final freeze. Intended plan and instrumentation changes after inputs-v2 do not retroactively change the baseline snapshot; scientific execution must bind both versions explicitly.

## Completed common-observer benchmark: launch remains gated

`gpu-observer-benchmark-1790697562933.json` restores the authenticated seed1 100k checkpoint and runs1,000steps with the original common observer, mutation joins, and the strict reset API's full state readback/hash comparison at every100steps. Bare time1.068s; instrumented2.357s (2.207×); whole invocation4.491s. Terminal physical hash `e062c0e9a918a300`, complete common-observer artifact `db1b4679ba2f095b`, all518 mutation events and zero drops match the uninstrumented twin.512 earlier-step genotype-effect classifications are correctly unavailable. This is twin parity at101k, not an independent original checkpoint at101k.

The loop-only ten-history projection is6.55hours, leaving insufficient margin. Scientific launch is not approved on this implementation. The primary authorized a GPU-side tag rebase that reads the actual current physical buffers at an expected step, removing redundant full-state copies and hashes. The strict externally supplied-state reset remains validated separately. Exact original physical and common-observer checkpoint comparisons remain required. The completed benchmark must be repeated with the optimized API and controls before deciding the allocation.

## Optimized benchmark, fresh review and seed status

The GPU-side rebase benchmark `gpu-observer-benchmark-1790697751375.json` brings the full common-observer loop to1.400s instrumented versus1.048s bare for1,000steps (1.337×;3.410s invocation). Physical state, complete common-observer artifact and all518 mutations match, with zero drops. Its3.89-hour linear projection makes a six-hour Probe A allocation plausible, but topology/window/output integration is not benchmarked yet. No scientific replay is launched and no final reallocation is adopted.

A fresh strongest-model G1 reviewer found a race in the strict externally supplied-state reset and missing origin-map geometry checks in extraction/fragmentation. Sol fixed both and added regression controls; native receipt `gpu-passive-control-1790697977544.json` passes. The source-freeze utility now also authenticates all103 saved baseline source payloads against the original inputs-v2 hashes and copies their exact bytes into the execution snapshot. Integrated endpoint/CLI controls and final independent gate review remain pending.

`reset-seed-status-v1.json` (SHA-256 `ac12b83a5be3afc3c7dc359369235aec085df1388de5188c5259f55340068226`) pins the earlier local seed audit and both21-record workspace ledgers. Probe A intentionally reuses historical treatment seeds1–10. Constructed engineering seeds2/17 are not fresh scientific evidence. No new scientific seed is allocated; all prior620/640/650-million work and the untouched700-million confirmation reservation remain protected. Global coordinator clearance is not claimed; any conditional fresh-world assay needs a separately audited reservation.

## Prospective sample and window design frozen

`probe-a-design-v1.json` (SHA-256 `a80b875618988ef99edf65382a2cb1ccfc1b15b397d297f46356cc9ff0000e53`) binds the exact200 original rows, original row order,20 rows per history, ten full-history replay schedules, all100 checkpoint boundaries,11 follow-up samples per link, the two graph definitions, and ten independently scheduled continuous windows. It also binds the current observation protocol's bytes. All follow-up times fit within the original million-step histories. This is a prospective design snapshot, not launch approval; final controls, integrated benchmark, independent gate review and execution/source/cap manifest remain required. No historical link has been classified.

The primary independently reran the five focused reset test suites:23/23tests pass. Fresh review confirmed both provenance fixes and independently rehashed all103 baseline source payloads with no discrepancies.

## Execution-freeze utility validation

The real-input validation snapshot `source-freeze-tool-validation-v1/manifest.json` completed in9.985seconds:331 historical inputs rehashed,103 exact baseline payloads authenticated/copied, and155 current source files preserved. It is explicitly not launch approval and will be superseded by the final source snapshot after integration/review. The utility subsequently gained an additional source-inventory comparison to reject files added/removed during copying; its typecheck passes and the final freeze will exercise that strengthened version.

Primary review also caught two follow-up status conflations before historical execution: live copies below a graph threshold were labelled copy loss, and unknown origins could be treated as resolved loss/disconnection. These now have separate unavailable/threshold statuses and targeted tests. A child support with zero genome-bearing sites also has an explicitly unavailable fraction endpoint. No historical observations were used to select those semantics.

## Continuous-window timing and prospective allocation

`gpu-window-benchmark-1790698538871.json` uses the authenticated seed1 100k state for100steps. Bare common-observer time0.136s; per-step passive tracing, both graphs and fragmentation scoring3.198s; whole invocation4.054s. Full terminal physical hash `236e80aa6b61268c`, common-observer artifact `cff006eb9633dcd8`, and mutation accounting match the bare twin with zero drops. No selected-link labels or candidate counts were reported. The roughly32ms/step measured window suggests about six minutes for the fixed11,000 per-step observations; density variability remains an uncertainty.

Before scientific outcomes, the primary reallocates the unchanged eight-hour total to1h development/calibration,6h Probe A,0.5h conditional B–E and0.5h reserve. The first bounded development tranche is conservatively charged at its entire180-second allowance, rather than treating incomplete historical invocation timing as zero. Final integrated timing, controls and independent gate review are still mandatory; this allocation does not approve launch or any paid compute.

## Window descriptor clarification and exact initial states

Before outcomes, designv2 supersedes v1 solely to make the already planned100-step continuous-window follow-up executable. For every raw flag at step s, it freezes each qualifying branch support and scores copy-associated persistence/connectivity at s+1 through s+100, retaining loss, unknown origins, shared support and incomplete coverage. Raw flags are not merged into unique births. A rolling in-memory record avoids per-cell disk histories; no candidate-count cutoff may replace the time/storage caps. The200 links and window schedules are unchanged. Designv2 SHA-256: `2b91a2d3c318fb44b78f4c057c1adbdd60a5643b3883dc19f282ac4580dba163`.

`initial-state-preflight-v1.json` verifies all ten step-zero physical hashes against the original manifests and compares the complete canonical configurations. All match; CPU elapsed0.488seconds. This establishes initialization compatibility, not replay compatibility. A separately capped original-checkpoint control from step0 to100k is still required before G1; the primary authorized at most180seconds for that control within the one-hour calibration allocation.

## Original checkpoint parity established

The live original-history control `gpu-original-100k-1790699102958.json` passed from step0 through100,000 on Apple M1 Max in136.929seconds, under its separate180-second calibration cap. Initial physical hash `ae8841a41f564873`; terminal physical hash `843c842713e2b493`; complete common-observer artifact `f7ffd62745c1af64`. The terminal hashes exactly match the original historical checkpoint, not just a new twin.39,287 mutation events were observed with zero drops;38,911 earlier-step genotype effects remain explicitly unavailable under the retained-last-step diagnostic policy. The primary inspected the receipt and rehashed all eight bound code files; before/after and current bytes match. No selected-link classifications or natural candidate counts were loaded. This establishes one actual historical boundary; the scientific replay must still verify all100 prescribed checkpoints.

## Window persistence controls and memory boundary

The per-flag100-future-step descriptor now preserves separate branch references through every one-step copy map. A constructed256² load case of100 overlapping flags with100 samples each completed in2.024seconds using about25MiB of active label arrays (`cpu-window-load-1790699289166.json`); this is not a natural flag-frequency estimate. Primary review caught loss of unknown ancestry after a subsequent known immediate source. The implementation now propagates an explicit unknown marker per reference, with a two-step regression control.

The primary prospectively approves512MiB for active copy-label arrays (not a claim about total process/GPU memory). It must be explicit in the execution manifest. Reaching it makes the affected attempt technically incomplete and preserves the triggering raw flag and all pending descriptors. Candidate skipping and biological-negative interpretation remain forbidden. The protocol's200 links, fixed windows and observation definitions are unchanged.

## Integrated window control and execution-path review

The integrated1,100-step window control `gpu-integrated-window-1790700100365.json` completed in43.819seconds on Apple M1 Max. The passive window and100-step persistence loop took41.930seconds versus1.072seconds for the bare common observer. Terminal physics `50e94fb7c7b129ba`, common-observer artifact `ff4a3f2fdb2479ab`, and563 mutation events match. Every started descriptor completed its prescribed follow-up. This supports an order-of-magnitude estimate of seven additional minutes for ten fixed windows at the measured density; it does not establish performance at every historical window.

The descriptive summary is being frozen before outcomes. It retains all200 original links, admits only complete postvalidated histories with exact checkpoint and mutation/life/lineage stream agreement, separates unavailable denominators from zero, and reports copy fractions and graph observations separately. Its ten focused admission/denominator tests and Deno typecheck pass. It makes no reproduction verdict or population confidence-interval claim.

Independent integrated G1 review found three prelaunch defects: historical baseline payloads were incorrectly checked against intentionally changed live paths; raw window frames could be lost on a cap/error before the next census; and the lineage stream hash omitted the historical TSV header. These are implementation defects, not biological findings. Sol is repairing them with regression controls. Scientific launch remains gated.

The same review identified two further execution/reporting defects: summary admission bypassed terminal result digests and the plan-bound checkpoint preflight; result writes could exceed the global storage cap before checking it. The primary corrected summary authentication and added altered-result/source-freeze regression coverage;11 tests and typecheck pass, and the independent reviewer confirmed that finding resolved. The summary also reports current bound-carrier copy-fraction bounds, explicitly distinct from inherited material. Sol owns the remaining execution repairs, including preserving partial evidence if a storage write fails. No scientific replay has begun.

Development accounting is prospectively charged at780seconds before final freeze: the prior540seconds of conservatively charged tranches, another180seconds covering the integrated window control, and a separately authorized at-most60second stream-prefix control. This intentionally overcounts any overlap with earlier development allowances rather than understating consumption. It remains within the one-hour calibration allocation; the six-hour Probe A and eight-hour overall caps are unchanged. The prefix control must compare byte formatting and ordering with the historical event streams and preserve an exact source-bound receipt.

## Stream-prefix parity and focused verification

`gpu-stream-prefix-1790700556542.json` passed an exact1,000-step seed1 replay-prefix comparison in2.773seconds against the pinned original mutation, life and lineage files. All three byte sequences match, including TSV headers. This control binds historical input hashes before/after; its script and the runtime serializers are preserved in the final source freeze. The primary inspected the runtime header/row serializers against the control. It is a prefix-format control, not a substitute for the complete-stream checks required in every scientific history.

The primary independently ran all11 reset Vitest suites:51 tests passed. The freeze, summary and execution entrypoints typechecked. The implementer reports all execution-review fixes ready; an independent final re-review is underway. Final execution snapshot and G1 approval have not yet been issued.

## G1 approved and first scientific replay launched

Independent final G1 implementation review passed after all five findings were resolved. The primary reran the final cap-edge/plan suite (4/4) and final entrypoint typechecks. `execution-source-v1/manifest.json` preserved172 execution sources,103 historical baseline payloads and control evidence, and reauthenticated331 historical inputs in11.614seconds. Its SHA-256 is `7ca8f2b3cca99095117e139de03aa229770d3a074d2b489982a339502d619ddd`.

The immutable execution plan `probe-a-run-v1/plan.json` has SHA-256 `69b7d19355bb069beff41685ad74db0d1819bb745aee1ab1ba8fd82f26e0c140`. It retains all200 rows, ten full histories, original mutation settings, fixed windows,780seconds conservatively charged development time, a21,600second cumulative Probe A cap and3,600second per-attempt ceiling. `probe-a-run-v1/g1-approval.json` binds the plan, design and source freeze. The measured-order forecast is about13,693seconds baseline plus420seconds of windows; it is not a guarantee. No paid compute is used.

History1 attempt1 launched with this approval on the local GPU. Its process session is89081. A live process or partial checkpoint is not an admitted result; all ten original checkpoint comparisons, full event-stream agreement and post-run source authentication remain required for each history. Source files are now frozen; only execution logs and result artifacts may be added without a separately recorded protocol/source amendment.

## History1 admitted; remaining frozen histories running sequentially

History1 attempt1 completed successfully in1,245.935seconds. The frozen summary tool authenticated its terminal receipt and admitted the complete history: all ten physical/common-observer checkpoints and complete mutation/life/lineage streams agree, and source postvalidation passed. `probe-a-run-v1/summary-after-history-1.json` retains200 original rows with exactly one admitted history; its overall status is explicitly incomplete. This is execution/admission evidence, not the final biological interpretation.

Histories2–10 were launched as one sequential shell batch using the unchanged frozen CLI, plan and G1 approval. Each uses attempt1 with the3,600second ceiling; cumulative phase/resource checks remain enforced by the CLI. The shell exits on the first nonzero result and performs no automatic retries or sample substitution. Batch process session52324 is the authoritative live handle; history1's former session89081 is terminal with exit0. No parallel GPU worker was launched.

The inline batch launcher (session52324) exited before reserving history2: the conservative GPU process detector matched the parent's embedded Deno command and reported that launcher as a worker. Its process is terminal, and no history2 attempt directory was created. No scientific attempt or retry was consumed. The exact sequential commands are now in `probe-a-run-v1/run-remaining.sh`, SHA-256 `57e2a17668eb38364f28fa7e646afe6046c83dffce9cfeae9354d6d7c5b34351`, invoked by filename so its command line cannot match the embedded Deno-worker pattern. This changes only orchestration, not frozen execution sources or protocol. The replacement batch's live process session is61274;52324 is obsolete. The CLI still authenticates every history and exits the batch on any failure.

## History2 technical stop: conservative host guard

History2 attempt1 terminated as `incomplete-gpu-contention` after five matching checkpoints. Its terminal receipt authenticates the retained partial result and charges667.087seconds. Batch session61274 is terminal with exit1; it did not start history3. The reported PID57121 is the main workspace's `deno run -A tools/analyze.ts runs/m4-ext/gradient-m3 --registry extension`, which remained live when inspected. The guard's broad argument match treats `m4` in that CPU analysis path as a GPU-worker signal. Inspection of `tools/analyze.ts` finds analysis/metrics imports and no GPU device/simulation call. This is a conservative occupancy stop, not a replay parity failure or biological outcome.

Preserve the frozen sources and failed attempt. Wait for the reported external process to finish before repeating history2 from step0 with the same inputs as technical attempt2, under the existing retry and cumulative budget limits. No external process is stopped or altered. The partial history stays excluded from summary admission. The host guard's overly broad analysis-path matching is recorded as an infrastructure limitation for a later version, not silently patched during this audit.

A replacement sequential launcher waits for the exact identified PID57121 to exit, then runs history2 attempt2 followed by histories3–10 attempt1, stopping on any nonzero exit. Launcher `probe-a-run-v1/retry-history2-then-remaining.sh` SHA-256 `d45c37b87f01eb3b663141f97f60c68ba978622202597a617f8582ca1f1bb947`; live session62062 supersedes terminal61274. No scientific source or input changed. `summary-after-history-2-stop.json` retains all200 links and admits only history1, preserving the failed history2 attempt as incomplete.

## History2 retry admitted; history3 active

After the external analysis PID exited, history2 attempt2 repeated the original input from step0 and completed in1,127.798seconds. The frozen summary tool authenticated its terminal receipt, all ten checkpoints and complete event streams. `summary-after-history-2.json` admits histories1 and2 while retaining history2 attempt1 as excluded incomplete evidence; all200 original rows remain in the report. Completed attempt charges total3,040.820seconds (including the667.087second interruption), plus780seconds conservative development charge. History3 attempt1 started under the same live sequential batch session62062. No source, input, threshold or observation schedule changed.

## History3 replay complete; batch proceeds

History3 attempt1 completed in1,141.344seconds. The primary independently authenticated its terminal result digest/length and plan/design/freeze binding, complete status, source postvalidation,20 evidence rows, ten checkpoints and all three full event-stream equalities. The sequential batch proceeds to history4 on live session62062. To avoid the overly broad host guard treating a brief CPU `deno run` summary as a worker, remaining summary admission will run after the batch stops. Histories1–2 have already passed frozen summary admission; history3 has authenticated complete replay evidence pending that final combined admission. This changes orchestration timing only, not the scientific analysis or frozen code.

## History4 replay complete

History4 attempt1 completed in1,130.344seconds. Its terminal result digest/length, plan/design/freeze identities, source postvalidation, ten checkpoints,20 rows and all three stream equalities were independently checked. The unchanged batch continues to history5 on session62062. Final combined summary admission and scientific interpretation remain pending. No additional technical retry has been needed.

## History5 replay complete

History5 attempt1 completed in1,136.362seconds. Its terminal result digest/length, plan/design/freeze identities, source postvalidation, ten checkpoints,20 rows and all three full-stream equalities were independently checked. Five of the ten histories now have authenticated complete replay evidence; final combined summary admission remains pending. The unchanged batch continues to history6 on session62062.

## History6 replay complete

History6 attempt1 completed in1,119.440seconds. Its terminal result digest/length, plan/design/freeze identities, source postvalidation, ten checkpoints,20 rows and all three full-stream equalities were independently checked. Six histories now have authenticated complete replay evidence; combined frozen-summary admission and scientific interpretation remain pending. The unchanged sequential batch continues to history7 on session62062. A report scaffold and independent post-A review checklist were prepared without inspecting biological outcomes.

## Main-line context snapshot

During history7, read-only inspection found the main plan now records the registered secondary extension result. Preserved the exact main plan and extension JSON under `main-context-2026-09-29-v1/`, with hashes and an explicit context-only designation. The saved report has five growing treatment and five growing neutral histories; this does not amend Probe A. Founder diagnostic Part B and extension time-shift results were absent from the captured plan. No main file was changed and no extension assay was rerun.

## History7 technical stop and identical-input retry

History7 attempt1 stopped as `incomplete-gpu-contention` after six checkpoint comparisons, charging756.211seconds. Its terminal result digest/length and terminal status were authenticated. Batch session62062 is terminal with exit1; histories8–10 were not launched. The detected PID91718 is the main workspace command `deno run -A tools/foundations.ts fd-plan`. Read-only inspection of fdPlan, fdRuns, soloRuns and originationCandidates shows saved-run reading and garden-plan preparation, rather than GPU execution on that path. The frozen conservative process-name guard again appears overbroad. The external process is left untouched.

The new file launcher waits for PID91718 to exit, then runs history7 attempt2 from step0 with identical frozen inputs and histories8–10 attempt1 sequentially. It stops on any failure and changes no source, endpoint, threshold or observation schedule. `retry-history7-then-remaining.sh` SHA-256: bc6a16900210e690d4bed3ac9750e1b738a91af74c34178f7f55d4f7ecca0a39. All terminal attempt charges now total8,324.520seconds, plus780seconds development, within the frozen budget. Partial history7 remains excluded from admission and is not a biological negative.

Replacement batch session72893 is live and supersedes terminal62062. Its first action waits for the identified external PID to exit; waiting time is not GPU assay time.

## History7 retry complete; history8 active

History7 attempt2 completed in1,662.334seconds after the external preparation process exited. Its terminal result digest/length, plan/design/freeze identities, source postvalidation, ten checkpoints,20 rows and all three full-stream equalities were independently checked, with zero dropped mutations. Seven histories now have authenticated complete replay evidence, pending final combined frozen-summary admission. Both failed attempts (history2 attempt1 and history7 attempt1) remain preserved and charged. The unchanged batch proceeds to history8 attempt1 on live session72893.

## History8 complete; history9 active

History8 attempt1 completed in1,649.054seconds. Its terminal result digest/length, plan/design/freeze identities, source postvalidation, ten checkpoints,20 rows and all three full-stream equalities were independently checked, with zero dropped mutations. Eight histories now have authenticated complete replay evidence, pending final combined frozen-summary admission. The unchanged sequential batch continues to history9 on session72893. No additional technical retry was needed.

## History9 complete; history10 active

History9 attempt1 completed in1,324.831seconds. Its terminal result digest/length, plan/design/freeze identities, source postvalidation, ten checkpoints,20 rows and all three full-stream equalities were independently checked, with zero dropped mutations. Nine histories now have authenticated complete replay evidence, pending final combined frozen-summary admission. The unchanged batch proceeds to history10 on session72893.

## Probe A execution complete and all ten histories admitted

History10 attempt1 completed in1,593.102seconds and batch session72893 is terminal with exit0. The unchanged frozen summary ran on all12 terminal attempt results, including both technical interruptions, and returned `complete-descriptive-audit`:10 admitted histories and all200 original rows. Output `probe-a-run-v1/summary-final-v1.json`, SHA-256 7b8aa48a0f2b07de590c510651fb2b8f033ab44729aa7c562b38cb774c6af3bb. Admission authenticates100 physical/common-observer checkpoints, complete mutation/life/lineage streams, zero mutation drops and source postvalidation. All12 terminal result digests/lengths were also rechecked independently. Total attempt charge is14553.841seconds, plus780seconds conservative development charge; no paid compute.

Scientific outcomes are now exposed. The descriptive summary has135 local-parent-copy-zero links,17 all-parent and48 mixed, with all200 denominators available. These are t−100 copy-reference observations, not inherited-material or reproduction classifications. Independent post-A review has been requested before conditional-probe decisions.

## Final closure — 2026-09-29

All ten histories and all 200 original links admitted by the frozen summary. Independent post-A and final closure reviews PASS. Resource ledger records all 12 attempts, 4.26 GPU-associated hours including development, conservative CPU elapsed envelope 5.88 hours, 50,030,667-byte output snapshot and no paid compute. Integrity verification passed 806 checks; both root and reviewer rehashed all 750 v1 index entries without mismatch. Root also checked all 200 CSV identities against original summary order. Final report and handoff record measurement-limitation exit with explicit B–E omissions. No new biological assays after the resource receipt. Preserved v1 and emitted v2 to bind final reports. Main remains unedited by this work; frozen plan remains its original execution contract.
