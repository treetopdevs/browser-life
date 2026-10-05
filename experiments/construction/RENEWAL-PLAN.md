# Execution plan: finite resources and local renewal

2026-10-04. Implements the diagnostic proposed in [NEXT-EXPERIMENT.md](NEXT-EXPERIMENT.md), following the [Fable review](FABLE-REVIEW.md).

**Status: planning only. No implementation or experimental runs have started.** This plan fixes the scientific choices that were open in the decision note. The implementation must encode them, pass verification, and freeze its protocol and source snapshots before executing any scientific trajectory. The existing frozen preregistration and completed construction studies remain separate.

## 1. Question, scope and completion

Can a finite, initially supplied nutrient reservoir support a retained source and new, metabolically maintained sites under the existing rule-1 dynamics? If so, is the paid polymer-retention mechanism necessary for that result among the four specified arms?

The experiment measures **finite-horizon local renewal**, not autonomous offspring, evolution, indefinite persistence or antifragility. Connected growth is admissible. Growth by a nonbuilder is useful evidence of a renewal regime, even when construction is unnecessary. A new site's ability to survive removal of the source is outside this experiment.

Work in `/Users/nicholas/develop/browser-life-construction`, starting from reviewed revision `002b12944b2af5b87c1e89446548565cea531754` or its documented descendant. Use jj; Git from this sibling directory can resolve the wrong repository. Preserve other workspaces and their running experiments. A future execution request for this plan covers implementation, verification, the fixed pilot, conditional confirmation, and reporting; continue through passing gates without another routine approval request.

Completion means a reproducible result for every scheduled case, an independently reconstructed decision, and a report that closes the experiment under its original rules. A valid negative is a completed experiment. An infrastructure failure or failed measurement invariant is **incomplete**, not biological failure. Neither result starts a new law, resource sweep, mutation study or disturbance study automatically.

## 2. Lock the experimental inputs

Use the complete configuration and builder genome in `witness-v1.json`, overriding only seed, spread, and the specified ablation. Do not reconstruct the configuration from future defaults. In particular retain ruleVersion=1, a 32×32 single torus, dtQ=0, motility=false, mutRate=0, uniform light255, seasonPeriod=0, kAbio=0 and gateK=1. Keep adhesion, drag, migration and pond cycling absent. Keep every reaction rate and controller weight unchanged except the matched BUILD0 intervention below.

Bind these existing inputs in the frozen manifest:

| Input | SHA-256 |
|---|---|
| `experiments/construction/witness-v1.json` | `7cbf49c409b137768b90c176b2a68c7034e3a870f81163cf969b0bbfc03e6019` |
| `experiments/construction/selected-competitor-v1.json` | `18b596eaf84a2724706e1b93988c40f0992ed25c182c248af0a17c7cf719ebdd` |

Use the same four arms in every main-pilot and confirmation habitat:

| ID | Genome and mechanism |
|---|---|
| `builder` | Exact witness BUILD16 genome, ordinary polymer transport gate |
| `matched` | Same genome with only `b2(OUT.BUILD)` changed from16 to0; feedback wiring unchanged |
| `selected` | Exact previously selected nonbuilder; its stationary ranking is not claimed to hold in this new habitat |
| `ablation` | Exact builder genome with `polymerTransport:false`; construction still consumes B and E |

For all four, initialize one founder at `(16,16)` with B=1024 and E=2048. Add exactly A=4 or A=16 to **every** cell, including the founder cell. Start C=P=S=0. Use the existing neutral MOT encoding. No feeding, reseeding, lesions, transfers or light changes occur during a trajectory. Validate that initial matter and free-energy arrays are byte-identical across arms within a habitat; genome arrays and the ablation configuration intentionally differ.

Seeds are fixed: pilot and all diagnostic controls use `7_310_001`; confirmation uses `7_311_001` through `7_311_005`. The current construction manifests have no occurrence of these seeds. Recheck before freezing; an existing result for one of these cases is contamination to report, not a reason to silently replace a seed. Arms sharing a seed are a paired block, not independent replicate histories.

## 3. Fixed matrix and budget

| Phase | Cases | Initial state | Spread | Horizon |
|---|---:|---|---|---:|
| Original-density capacity | 2 | Builder at `(8,16)` and `(24,16)`, each B1024/E2048; one case per A level | 0 | 3,000 |
| Same-budget division | 2 | Builder at the same two sites, each B512/E1024; one case per A level | 0 | 3,000 |
| Small-founder probes | 12 | One builder at `(16,16)`, B64/E128 or B128/E256; both A levels | 0,1,2 | 10,000 |
| Main pilot | 24 | Four arms × two A levels × three spreads, each B1024/E2048 | 0,1,2 | 10,000 |
| Conditional confirmation | 20 at most | All four arms in exactly one selected A/spread habitat × five fixed seeds | Selected1 or2 | 10,000 |

The diagnostic controls all use the exact builder genome with the gate enabled. Founder ordering in each two-site control is the listed left site first, so lineage IDs are deterministic. Run all16 controls before the24 main cases. A control's biological failure does not invalidate the software or forbid the main cases; it limits what the report can conclude. A technical invariant failure stops the batch.

The scientific cap is **40 pilot/control histories**, plus **20 confirmation histories only if earned**: 372,000 initial simulated steps and at most572,000 scientific steps in total. No additional seed, reservoir level, controller, horizon or spread is added after results are visible. Verification adds two CPU and two GPU replays of already specified trajectories, at most40,000 additional steps, not new histories. Short engineering fixtures and the existing golden suite are separate validation work.

Use CPU `RefSim` as the primary backend, one case at a time. At this scale it supplies per-step roles and exact local accounting without GPU readback on every step or a physics change. The earlier 10,000-step drag cases took approximately13–21 seconds each on this machine; this is a sizing reference, not an estimate for the new observer. Record actual elapsed time and artifact size. Native GPU is an independent replay check, not a second experimental treatment.

## 4. Resource accounting

The reservoir changes available matter. It does not make different A levels an equal-resource comparison. Within each A/spread cell of the matrix, arms have the same resources and light exposure.

| Initial layout | Total B | Total E | Matter at A4 / A16 | Chemical + free energy |
|---|---:|---:|---:|---:|
| Main / same-budget division | 1,024 | 2,048 | 5,120 / 17,408 | 10,240 + 2,048 =12,288 |
| Original-density capacity | 2,048 | 4,096 | 6,144 / 18,432 | 20,480 + 4,096 =24,576 |
| Small founder64 | 64 | 128 | 4,160 / 16,448 | 640 + 128 =768 |
| Small founder128 | 128 | 256 | 4,224 / 16,512 | 1,280 + 256 =1,536 |

These numbers follow eA=0, eB=10 and initial C=P=S=0. No compensating energy is added. Capacity controls deliberately have a different B/E budget and are labeled accordingly.

Record offered light as grid light-level exposure (`sum of L over cells and executed steps`), not as absorbed energy: 2,611,200,000 exposure units for10,000 steps at32×32×255. Actual `lightIn` is energy harvested by reactions and is an outcome. Report both, alongside heat export and each initial channel total. Assert exactly constant matter and zero energy-ledger residual at every census and checkpoint.

## 5. Prespecified endpoints

Choose **V=128 B**, **Qmin=128 newly synthesized B**, and a **1,000-step late window**, before examining any trajectories. V equals the existing catalyst half-saturation scale; it is a conservative operational cutoff, not an estimated minimum viable organism size. Qmin demands at least one threshold-sized amount of synthesis over the window. Do not fit either value to the controls. Report raw outcomes so their limitations remain visible, without replacing the primary threshold after a negative.

For each spatial cell i, retain:

- `B_i(t)` at censuses every100 steps, including step0.
- `Q_i(a,b)`: exact sum of PHOTO+GROW at i over transitions a→a+1 through b−1→b.
- `R_i(a,b)`: exact net change in B due to reactions at i over those transitions, excluding bound transport. This includes all local B production and losses.
- Exact cumulative incoming/outgoing bound B, plus A/C transport across the fixed founder-site boundary. Gross traffic and net traffic are different measurements.

Define **maintained(i,a,b)** when all three hold:

1. B_i≥128 at **every** one of the11 censuses a,a+100,…,b.
2. Q_i(a,b)≥128.
3. R_i(a,b)≥0: local reactions at least replace local reaction losses over the window.

For a main/confirmation case, the **renewal indicator RENEW** is true when `maintained(source,9000,10000)` and `maintained(j,9000,10000)` for at least one **same fixed site j outside the initial one-site footprint**. A different site at each census does not qualify. Record all qualifying sites, not only the best. The test is explicitly sampled maintenance; it does not assert survival between censuses, independence from dissolved resources supplied by the source, or autonomy from gross B exchanges. Polymer mass alone never qualifies.

The source can export B while maintaining itself. Requiring Q and reaction balance prevents static or purely imported deposits from being scored as locally maintained; it does not prove atom-by-atom material ancestry. All genomes in the primary experiment are fixed, so this is not a heritable-selection endpoint.

Controls have distinct interpretations:

- **Capacity/division:** report whether both initialized sites have B≥128 at all11 censuses2000–3000 and Q≥128 during that window; report their R separately. Finite persistence may coexist with decline. These controls apply only to spread0; failure of one layout does not prove incapacity at other densities or spreads.
- **Small-founder probe:** report whether any one same site, including the initial site, satisfies `maintained(i,9000,10000)`, plus all raw source/field outcomes. Two starting sizes do not locate a universal viability threshold.
- **Spread0 main cases:** every off-source B must remain exactly zero at every step. Any off-source B here is a technical failure, not a discovery.

Secondary readouts, fixed in advance, are final active B; exact step-summed active-B area; final and late-minimum source B; qualifying-site count; sampled support extent; local Q/R/imports; total construction expenditure; reservoir depletion; harvested light; and all global reaction totals. These explain a primary outcome and do not rescue a failed primary gate. Observational masks are fixed cells, not declared organisms.

## 6. Candidate selection and confirmation

Finish and validate **all40** pilot/control cases before selecting. Only main-pilot habitats with spread1 or2 can qualify. A habitat is eligible if **at least one** of its four arms has RENEW=true. Construction specificity is not required to advance.

Select the first eligible habitat in this frozen order:

1. A4, spread1.
2. A4, spread2.
3. A16, spread1.
4. A16, spread2.

This deterministic preference tests the lower resource requirement first and avoids ranking habitats by an outcome-dependent biomass score. There is no claim that the selected habitat is optimal. Freeze its identity and the complete pilot readout digest before opening any confirmation trajectory. If none is eligible, write the negative report and stop.

In the selected habitat, run all four arms on all five confirmation seeds. Classify separately:

- **Confirmed local renewal:** at least one **same arm** has RENEW=true in at least4 of its5 blocks. Five blocks in which different arms each happen to pass do not meet this rule. Report the full4×5 Boolean matrix and counts. This is a finite consistency criterion over the prespecified panel, not a population-wide significance test.
- **Construction-specific result among tested arms:** in at least4 of the5 paired blocks, the builder has RENEW=true, all three other arms have RENEW=false, and both builder and ablation have positive recorded BUILD expenditure. The ablation must still debit B and E. Otherwise report construction necessity as not established; quantitative differences can still be descriptive.

An extinct trajectory has RENEW=false and zero final active B. Retain its earlier flux and expenditure; do not erase its costs. Never replace an extinct/failed biological replicate, average only survivors, or pool A levels. A technical failure leaves the phase incomplete; it is not inserted as an extinction.

If confirmation fails, preserve any isolated successes, report that the selected regime failed the fixed consistency gate, and stop. Do not fall back to the next pilot habitat, promote a secondary endpoint or extend the seeds.

## 7. Implementation work packages

All paths below are proposed new files unless noted. Keep the executed witness, drag and evolution runners, their protocols and their artifacts unchanged. No CPU/WGSL rule change, schema version bump or package alias change is expected.

### A. Encode and freeze the contract

Create `experiments/construction/renewal-v1/protocol.json` as the declarative source of truth for factors, seeds, input hashes, placements, endpoints, selection order and stage gates. Create `tools/lib/construction-renewal.ts` for validated case enumeration and initialization, using existing `constructionWorld`/genome helpers. Serialize full resolved configs and exact genome strings; reject unspecified overrides and mismatched input hashes.

Tests in `tools/test/construction-renewal.test.ts` must verify the40/20 matrix and step budget, exact resources, cell-array equality across paired arms, the one-byte matched comparator, positions/lineages, no drag/migration/pond fields, and mutation-off behavior. Initialization tests do not execute scientific seeds. Dynamics fixtures use explicit artificial states, not an early peek at the pilot.

### B. Add read-only local accounting

Create `tools/lib/construction-renewal-observer.ts`. Before every step, compute post-transport B for all cells using the existing rule-1 integer `mulShareD`/`w1d` functions with zero displacement, eight outgoing neighbors, torus wrapping and the unsent remainder at the source. Reject configs outside this restricted rule1/dtQ0/motility-off/no-drag domain. Do not approximate the transport by floating-point diffusion.

Then execute `RefSim.step()` and compute local reaction change as `B_after − B_after_transport`. Sum PHOTO/GROW from `RefSim.roles` after **every** step. Copy or compute required pre-step values before stepping: RefSim reuses/swaps its cell buffers, so holding a reference to the old array does not preserve old values.

The role channels saturate at65,535. Here total matter is at most18,432, and the largest fixed reaction rate among the recorded roles is160/4096; even a whole-world concentration yields at most720 quanta per role per step. Prove/check this bound for the resolved protocol before using roles as exact counters. Reconcile summed per-cell roles to the simulator's global flux increments. Assert global B change equals photo+grow−resp−build−starve−bdecay, total net B transport is zero, and all accumulated counters remain safe integers or use bigint.

Reuse `patchTransport` for exact founder-mask A/C accounting. Implement tests in `tools/test/construction-renewal-observer.test.ts`: passive transport at spreads0/1/2; wrapping; nonzero initial step; self-retained rounding; reacting worlds' local/global budgets; no state mutation by the observer; and buffer-aliasing protection. Compare transport predictions with actual passive RefSim results, not another copy of the predictor formula.

### C. Pure readout and durable runner

Create `tools/lib/construction-renewal-readout.ts` for endpoint, selection and confirmation decisions from persisted records. Test exact threshold boundaries, one missing/low census, different sites qualifying at different times, passive imported deposits with Q=0, active but negative-R sites, source loss, extinction, incomplete records,4/5 versus3/5, different winning arms across blocks, construction specificity, and deterministic habitat ordering. An alternate implementation of the final audit must not call this decision function.

Create `tools/construction-renewal.ts` with separate freeze, controls, pilot, pilot-readout, confirmation-freeze, confirmation and final-readout operations. Later commands shown below are implementation targets, not currently available CLIs.

Store output under a fresh `runs/construction/renewal-v1/`. Require an exclusive new root at freeze and exclusive case/attempt directories. Write protocol, full manifest, resolved initial states, source snapshots and verified SHA-256 hashes **before any scientific step**. Cover the executable dependency closure, including input genomes, schema/int/kernel/accounting/checkpoint code, CPU physics, observer, reader and this plan. Record jj revision, dirty-source hashes and tool versions; a revision alone is insufficient.

Include the Deno import map/configuration in a self-contained copied source tree. Execute cases and replays from that verified tree with an explicit import map and absolute output root, rather than continuing to import live worktree files after freeze. Bind analysis code likewise; a corrected reader gets a new versioned audit artifact and never replaces its predecessor.

Stream one census record at a time. Persist per-cell B and cumulative Q/R/B-transport values needed to independently reconstruct the late windows, together with global flux/ledger totals, source A/C flows, last-step role digest and exact state hash. Keep step0 and all100-step censuses. Save physics+observer checkpoints under one artifact digest at0,3000,9000,10000 where reached; 3,000-step controls stop at3000. Do not terminate an extinct case early or rewrite its prior output.

The first implementation has no within-case resume. On interruption, retain the partial attempt and rerun the **same** case/seed/config/source snapshot from its saved initial state in a new attempt directory. Record the reason; a complete valid attempt is immutable and cannot be replaced because of its outcome. A source correction requires a versioned provenance record and replay of affected cases. Changing a scientific choice after seeing outcomes ends this protocol; it cannot silently become a harness fix.

### D. Verification and reports

Create `tools/construction-renewal-verify.ts` for replay and independent artifact validation. Predesignate pilot A16/spread1/seed7_310_001 `builder` and `ablation` for complete CPU replay and native GPU replay, regardless of their outcomes. CPU replays compare every census's hashes, ledgers, cumulative observer values and checkpoints. GPU replays compare every census's state hash, global ledger/flux and last-step roles against the CPU records. They need no per-step GPU readback and make no claim to independently reconstruct the CPU observer's entire per-step history.

Independently recompute every case's endpoint from saved census/cell records and the phase selection/confirmation decisions, without importing the production readout functions. Recheck all artifact/source digests, initial resources, mutation counts and conservation records. Tests alone are insufficient if this audit disagrees.

Publish a compact tracked `experiments/construction/renewal-v1/results.json`, `RESULTS.md` and reproducible figure source/output. Include all40 original cases and, if earned, all20 confirmation cases, explicit absent-versus-incomplete confirmation status, the selected habitat, the4×5 matrix, control outcomes, input and artifact hashes, and limitations. Plot B alongside local synthesis, reaction balance and net B imports so visible growth can be interpreted. Clearly separate this study's data from earlier nutrient-free runs.

## 8. Execution gates and commands

1. **Implement A–D without running scientific cases.** Use focused tests first. Run `pnpm typecheck`, Deno checks for new CLIs/libraries and the affected Vitest tests. Run the unchanged golden-pin tests and standard native GPU golden suite. Run the full Vitest suite once before freeze. Resolve failures without weakening conservation or old hash pins. Get the repository-required read-only **Sol6.1 High** phase-boundary review and address findings.
2. **Freeze before science.** Verify exact input hashes, fresh seed status, output exclusivity and protocol/source snapshots. A freeze operation initializes states but executes zero simulation steps. Bind the human protocol and machine JSON together by hash. No required numeric choice remains open in this plan.
3. **Controls and pilot.** Execute all16 controls then all24 main cases to their fixed horizons. Stop on a technical invalidity; preserve every valid negative. Complete predetermined replays and independent audit before the candidate decision.
4. **Conditional confirmation.** If no habitat qualifies, close the study. Otherwise freeze the selected habitat/readout digest and automatically execute the20 prescribed confirmation cases. Reconstruct the final decision independently. No discretionary new search is allowed by this gate.
5. **Close and review.** Write the full result report, update construction status, and get a read-only Sol6.1 High review of the final code/artifact interpretation before any commit. Keep the work isolated; merging or deployment is not needed to execute this experiment. A later population-selection study requires its own plan.

Planned commands after implementation, from the construction workspace:

```sh
deno run -A tools/construction-renewal.ts freeze --out runs/construction/renewal-v1
deno run -A tools/construction-renewal.ts controls --root runs/construction/renewal-v1
deno run -A tools/construction-renewal.ts pilot --root runs/construction/renewal-v1
deno run -A tools/construction-renewal-verify.ts pilot --root runs/construction/renewal-v1
deno run -A tools/construction-renewal.ts pilot-readout --root runs/construction/renewal-v1
# Only after a qualifying, audited pilot:
deno run -A tools/construction-renewal.ts confirmation-freeze --root runs/construction/renewal-v1
deno run -A tools/construction-renewal.ts confirmation --root runs/construction/renewal-v1
deno run -A tools/construction-renewal-verify.ts final --root runs/construction/renewal-v1
deno run -A tools/construction-renewal.ts final-readout --root runs/construction/renewal-v1
```

## 9. What the outcome permits

| Outcome | Interpretation and next boundary |
|---|---|
| No pilot habitat qualifies | This fixed reservoir/spread panel did not establish local renewal. Report controls and budgets; stop without claiming all rule1 transport is incapable of it. |
| Pilot qualifies, confirmation fails | A selected pilot effect did not meet the fixed fresh-block consistency criterion. Stop; no alternate-habitat retry. |
| Renewal confirms, construction-specific criterion fails | A useful renewal regime exists within the tested conditions; construction necessity is unestablished. A future selection study may use the successful phenotype/regime. |
| Both criteria confirm | Paid construction enables the defined local-renewal outcome relative to these comparators in this habitat. A future study can test competition and inherited variation there. |
| Measurement, provenance or replay fails | The affected result is invalid/incomplete. Correct the implementation to the frozen contract, preserve attempts, and revalidate affected cases; do not label this a biological negative. |

Even the strongest outcome does not establish antifragility. It earns the next causal question: whether inherited variants compete in this renewable regime. Only after that should bounded disturbance histories be tested for improvements in later population performance and inherited capability, with costs and extinctions retained.
