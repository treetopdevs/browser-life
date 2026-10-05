# Astra review of the addendum (raw)

2026-10-04 · `gpt-6-astra`, reasoning effort high, read-only sandbox, Codex CLI 0.160.0 · session `01a10681-10f2-7dd0-a437-0d98e2899b32`

This is the reviewer's final message, unedited. It reviewed [ADDENDUM.md](ADDENDUM.md) at SHA-256 `d67a25f7ad3ee8934f5d6572fa6193db541fd55126b320cf49c4e486b1930a19`, before the errata section was added. Its absolute paths point at the checkout it ran in. Dispositions are in the [council record](COUNCIL.md).

---

The addendum is useful criticism, but I would not implement its replacement plan as written.  
Accept earlier construction-owned renewal, broader local-evidence coverage, and a smaller initial execution layer.  
Reject the isolated-cell “proof,” the population-cap interpretation, and unconditional claims that enumeration is cheap.  
Keep the proposal’s separate scientific layers, frozen protocols, provenance, isolation, and withheld validation.  
The supplied addendum hash matches; this review changed nothing, stepped no world, started no service, and spent nothing.

**(b) Defects in the addendum**

Citation prefixes below resolve to these exact locations:

- `review/`: `/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/`
- `proposal/`: `/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/`
- `construction/`: `/Users/nicholas/develop/browser-life-construction/experiments/construction/`
- Other repository-relative paths refer to the supplied checkout, at `03e5ff6`.

**P0: None found.**

**P1 — The isolated-cell calculation is not a valid rejection certificate.**

The conclusion at [`ADDENDUM.md:141–148`](/Users/nicholas/develop/browser-life/.claude/worktrees/codex-astra-critique-b22475/docs/evolvability-discovery-2026-10-04/ADDENDUM.md:141) exceeds its calculation in four ways.

1. **Stored E can fund GROW.** GROW consumes whatever E is available, not only energy released by that step’s decomposition. Respiration also supplies E. See `packages/sim-ref/src/step.ts:452–472`.
2. **Transport precedes reactions.** Catalysis uses post-transport B, and successive reactions change B before later catalytic calculations. A formula using one pre-transport `cat(B)` is not the exact reaction calculation.
3. **The maximization has an unstated range.** I reproduced every printed percentage with the following heuristic, maximizing over exporting integer B from 1 through **4,096**:
   \[
   \frac{(B+\operatorname{cat}(B,K)[160(255/256)/4096+0.2(96/4096)])(1-500/65536)-B-\operatorname{export}(B)}{B}.
   \]
   The habitats permit more than 4,096 matter quanta at one site. Even this heuristic’s spread-1/K512 maximum becomes **−2.67791%** over B≤5,120 and **−2.48372%** over B≤17,408, rather than −2.70%.
4. **An exporting-cell calculation cannot establish the statement about every single cell.** It explicitly excludes nonexporting states. Nor does a negative expected change establish monotonic decline for every stochastic realization or determine finite-window maintenance.

A concrete **arithmetic counterexample**, with no world stepped: at spread 1, K32 and initial B136, an isolated site exports four B, leaving B132. A legal controller with PHOTO=GROW=127 and other catalytic outputs zero, sufficient A and stored E, produces PHOTO=4 or 5 and GROW=3 or 4. Passive B decay removes 1 or 2. Final B is therefore **137–140**, exceeding initial B136. This refutes a universal negative per-step bound; it does **not** establish sustained renewal.

The useful integrated energy inequality is instead
\[
10\sum GROW\le E_{\rm start}-E_{\rm end}
+8\sum RESP+2\sum DECOMP+\operatorname{netImport}(E),
\]
before subtracting maintenance, work, emission and leakage. Consequently, respiration-funded growth alone cannot create net B, but stored/imported E and decomposition of imported C invalidate an unqualified “photosynthesis is the only net source of B” claim. Photosynthesis is the external energy-input mechanism here; that is a different statement.

**Smallest repair:** retain the exact transport table; label the last column an explicitly specified heuristic. Remove the isolated-cell impossibility conclusion and every descriptor/axis rejection derived from it until a valid integrated bound includes inventories, imports, reaction order and the complete state domain.

**P1 — Enumeration is substantially undercosted and changes the statistical target.**

The **1,344 candidates**, **21,504 logical cases**, and **155.3 bare simulation core-hours** are correct. “Under one Mac-day” omits the proposal’s full replay requirement.

At the addendum’s own 26 seconds per case:

| Workload | Executions | Bare simulation core-hours | Ideal eight-core elapsed time |
|---|---:|---:|---:|
| One enumerated 16-case table | 21,504 | 155.31 | 19.41 h |
| Same table, full replay | 43,008 | 310.61 | **38.83 h** |
| Three independent tables, full replay | 129,024 | 931.84 | **116.48 h** |

These exclude observer computation, census/checkpoint serialization, independent analysis, retries and contention. The observer reconstructs transport and records per-cell cumulative accounting every step/census; its cost has not been measured. See `construction/RENEWAL-PLAN.md:135–159`, `proposal/DESIGN.md:124–132`, and `proposal/PLAN.md:104`.

Thousands of optimizer seeds on one fixed table can estimate performance **conditional on that table**. They do not create thousands of independent physics panels or establish performance on new founders, habitats or physics seeds.

**Smallest repair:** make enumeration conditional on measured complete-case cost and an explicit resource cap. State whether the estimand is fixed-table algorithm performance or generalization across independently generated tables. Preserve fresh-condition validation.

**P1 — Failure of a hand-built complement is wrongly promoted toward an impossibility argument.**

`review/ADDENDUM.md:170` says that if a knowledgeable person cannot build the second link, a search over four rate constants will not find it. That implication is false. Different rates can make an otherwise unsuccessful complement viable; the human search is neither exhaustive nor bounded by a demonstrated impossibility theorem.

Likewise, failure of 103 selected genomes in one conditioned habitat only bounds that panel and intervention. The comparator family was selected for a different stationary assay, and includes M3 founders with BUILD disabled (`construction/README.md:30`).

The construction study’s previous conditional second-opportunity test was **not earned**. It remains closed; a new conditioned-field experiment needs a distinct protocol, not a retrospective continuation (`construction/EVOLUTION-RESULTS.md:54`).

**Smallest repair:** replace the impossibility language with a bounded negative result and a separately reviewed decision about the next hypothesis. Define and validate the conservation-preserving intervention before pricing or running it.

**P2 — The population argument confuses an assay threshold with the number of hereditary units.**

The bounds
\[
5120/128=40,\qquad17408/128=136
\]
are correct for **simultaneous sites with B≥128**. They do not bound all occupied or genotype-bearing cells.

The engine recognizes a living lineage independently of that threshold, reacts at B>0, and transports genomes using **B+P** lottery weights (`step.ts:171–172, 304–334, 417`). Subthreshold sites can carry and express genomes; P-only sites can retain genomic labels. The spatial upper bound is 1,024 sites in these tiles, not 40 or 136. Neither count supplies an effective population size or a power calculation for selection.

The stated comparison ecology is also inaccurate: `gradient-m3` and `spots-m3` initialize **32 nutrient per cell**, not 256 (`packages/schema/src/presets.ts:60–74`). Some construction helper defaults use 256; that is not the registered preset.

**Smallest repair:** say “at most 40/136 threshold-qualified sites,” report actual occupancy and demographic turnover, and remove the unsupported drift claim.

**P2 — Several proposed readout “repairs” change the scientific question.**

The renewal protocol explicitly permits connected expansion and disclaims autonomous offspring. An adjacent maintained site therefore is not a false positive for its stated endpoint (`construction/RENEWAL-PLAN.md:11, 83–99`).

Similarly:

- B128 is a common absolute cutoff, explicitly not an estimated universal viability threshold. Changing it proportionally to K changes the endpoint across candidates.
- Imported E can support local synthesis without violating the stated connected-renewal endpoint. It matters for an **autonomy** claim, which the proposal does not make.
- Spread-zero rows are already labeled transport-disabled diagnostics (`proposal/PLAN.md:53`).

**Smallest repair:** preserve the renewal primary endpoint. Add normalized sensitivity, distance/extent, and energy-dependence measurements as secondary readouts or separate registered assays.

**P2 — The small-founder “equivalence” is false even before biomass exports.**

At spread 1, B64 exports zero B, but the probe starts with E128. Each cardinal neighbor receives
\[
\lfloor128\times64/4356\rfloor=1
\]
E quantum. Thus it exports **four E immediately**. B, P and E are transported separately with the same fractional weights (`step.ts:280–299`).

**Smallest repair:** say “initially no B export,” not “the spread-zero probe unless B grows past 68.” Do not drop the probe as degenerate.

**P2 — The proposed retrodiction gate tests unsupported applicability as if it were predictive failure.**

The restricted observer rejects flow by design (`construction/RENEWAL-PLAN.md:135`). Calling it on flow-on worlds and recording failure cannot falsify biological relevance. It establishes missing measurement support.

The pond contrasts additionally change an imposed life cycle. A physics-only score is not obligated to distinguish treatments that share physics but differ in ecological scaffolding. The proposal explicitly separates laws, habitats and founders (`proposal/DESIGN.md:28–36`).

**Smallest repair:** first specify the prediction target and admissible interventions; then validate a compatible observer. Treat existing outcomes as calibration evidence, with prospective withheld validation. Do not require every known ecological contrast to be ordered by one feasibility descriptor.

**P2 — The seed-confound finding overlooks an explicit existing safeguard.**

`proposal/DESIGN.md:108` already says:

> Never count shared-seed arms, retries, or cross-host replays as independent replicates.

The reducer also reports paired differences and independent-block counts (`DESIGN.md:130`). This is precisely the second repair the addendum proposes.

**Smallest repair:** retain paired streams where useful and require the later mutation-on protocol to make its inferential unit explicit. Do not describe the existing seed policy as repeating the earlier reporting error.

**P2 — The GPU replacement assumes independence and measurement capability that do not exist generically.**

M3’s batching is real, but its evaluator explicitly sets **mutRate=0** (`packages/search/src/evaluate.ts:274`). Pond worlds have multiple tiles, but the cycle chooses donors and reseeds other ponds: those tiles are **coupled**, not independent evolutionary histories (`packages/schema/src/config.ts:197–224`).

The existing scaffold genome-swap assay measures a dominant genome’s effect on matched ancestral fragments. It is not a general assay of inherited improvement in arbitrary evolved mixed populations. The time-shift instrument transfers physical contents as well as genomes and historically encountered extinction floors (`tools/assay.ts:356–367`; `docs/plan.md:136`).

**Smallest repair:** define candidate, independent replicate, transfer unit and endpoint before selecting hardware. Reuse instruments only within their demonstrated interpretation; price histories **plus assays**, not just source worlds.

**P2 — Replacing the discovery plane with directory copying drops acceptance requirements unless explicitly repaired.**

Sharding can preserve isolation and provenance, but “skip existing case directories” is not validation. The cited assay implementation checks file existence (`tools/assay.ts:60–81`); a discovery runner must also validate completeness, identity and digests before reuse.

Two shards copied between machines do not demonstrate the PRD’s browser/CLI onboarding, lease failure handling, coordinator restart recovery or late-upload behavior. Reopening “validated overrides on the existing island path” also conflicts with the proposed protection of legacy registered jobs (`proposal/DESIGN.md:81,112`; `PRD.md:38–46`).

**Smallest repair:** retain a separate namespace and acceptance validator in the local version. Mark distributed acceptance pending. Defer transport/UI engineering without weakening the contract or calling the full PRD complete.

**P3 — Smaller factual and framing errors.**

- **Renewal is planned, not implemented.** `construction/RENEWAL-PLAN.md:5,125–167` explicitly describes future runner, observer, verifier and tests. The addendum later acknowledges implementation cost, but its headline obscures it.
- **“Nothing tests prediction” is too strong.** Stage 5 explicitly requires fresh seeds and withheld founder/habitat transfer (`proposal/PLAN.md:78`); Stage 6 tests evolutionary outcomes. What remains underspecified is the *predictive bridge*, including low-score controls and sensitivity.
- **“All are WorldConfig keys” is false.** Founder panels are separate initialization inputs. Migration and pond cycling also have compatibility constraints (`packages/schema/src/config.ts:211–213,515–518`).
- **The wound-results summary conflates different findings.** Ownership wounds **reduced** lineage turnover (`/Users/nicholas/develop/browser-life-ownership/docs/sandbox-ownership.md:365–367`); the cells wall comparison increased it (`/Users/nicholas/develop/browser-life-cells/docs/sandbox-cells.md:883–893`).
- **Commit provenance is not a discrepancy.** `BASELINE.json` identifies the dirty working-tree inspection, not the future documentation commit. `5f73fac` and `7a96fd7` can both be correct.

**Arithmetic and factual audit**

I evaluated the actual extracted `w1d`, `mulShareD` and `cat` functions without constructing or stepping a world.

| Spread | Large-B export | First B export | Exactly one B per cardinal neighbor through | First diagonal B export |
|---:|---:|---:|---:|---:|
| 0 | 0% | Never | — | Never |
| 1 | 5.968779% | 69 | 136 | 4,356 |
| 2 | 11.418685% | 37 | 72 | 1,156 |
| 4 | 20.987654% | 21 | 40 | 324 |
| 8 | 36.000000% | 13 | 24 | 100 |

These verify the printed transport fractions and thresholds. “Per edge” should mean the four cardinal transfers, not all eight neighbors. The formula is
\[
export_s(B)=4\left\lfloor\frac{64sB}{4(32+s)^2}\right\rfloor+
4\left\lfloor\frac{s^2B}{4(32+s)^2}\right\rfloor.
\]

| Claim | Verification |
|---|---|
| Printed isolated-cell percentages | Numerically reproduced by the bounded heuristic above; **not verified as valid physical bounds**. |
| `cat(128)/128` at K32/K512 | Exact values **103/128=0.8046875**, **26/128=0.203125**. Printed 0.80/0.20 are appropriate rounding. |
| Gate seals when P sums to D at gateK1 | **Correct:** `floor(D/(1+Ps+Pt))=0` when `Ps+Pt≥D`. “Diffusion mostly moves the sealing point” is unproved; it also changes transport below that point. |
| Production balance depends only on listed axes | **Incomplete:** K directly changes catalysis and is varied. The heuristic itself shows its effect. |
| 1,344 candidates; 21,504 cases | **Correct:** 8×6×4×7; then ×16. |
| Sign-test floor | **Correct:** three positive paired signs give one-sided p=1/8=0.125. This limits that test, not every practical method comparison. |
| 144/432 spread-zero cases | **Correct**, and already intentional diagnostics. |
| 576/2,304 ablation cases | **Correct**; excluded from archive descriptors, but still informative causal controls. |
| 1,104 Stage-4 executions | **Correct:** 2×(432+120). |
| 4,608 Stage-5 executions | **Correct for the base comparison:** 2×2,304. Excludes the separately budgeted shortlist test. |
| About 41 core-hours “through Stage 5” | **41.25 h for those Stage-4/5 executions only.** Excludes renewal, calibration, engineering cases, Stage-5 shortlist validation and observer overhead. |
| 612,000 renewal steps | **Correct:** 4×3,000 + 12×10,000 + 24×10,000 + 20×10,000 + 4×10,000. |
| About 27 minutes renewal compute | **Correct extrapolation** from 26 s/10,000: 26.52 minutes. Not an observed runtime for renewal or its observer. |
| Witness flow/mutation settings | **Verified:** 32×32, dtQ0, motility false, mutRate0; witness hash matches the renewal plan. |
| Cited `step.ts` ranges | **Correct locations:** displacement 240–251; E transport 290–299; lottery 311–335; gate 351; mutation 502–514. Target/delta implementation continues at 654–675. |
| 10→8→8 controller, occupied outputs | **Verified:** `docs/plan.md:185–188`, `docs/rules.md:19,50`. |
| Variation and founder results | **Verified as recorded results:** 1/12, 11/24, 310/2,400=12.9167%; `docs/plan.md:134–137,337–338` and `experiments/foundations/t2.json`. |
| Scaffold numbers and 757 commands | **Verified against the recorded report and compact readout:** 0.978515625/0.623046875/0.025390625; H2 24/24; `docs/plan.md:666–690`, `experiments/scaffold/readouts/reg1.json`. |
| Proxy failures and coordinator deferral | **Accurately quoted:** `plans/README.md:46–47`. They are contextual prior decisions, not a permanent prohibition on a differently scoped workbench. |
| Michel descriptors and search scale | Activity, compression and multiscale entropy verified; **2,000 iterations is explicitly stated for the movement experiment**, not established as the budget of every experiment. [Primary paper](https://arxiv.org/html/2505.15998v1). |
| Addendum/proposal provenance | Supplied addendum hash and all seven proposal hashes match. `step.ts` is byte-identical across the two checkouts. Documentation commit `7a96fd7` verified. |

**(c) Ruling table**

“Accept” below accepts the stated bounded point, not every inference attached to it.

| Addendum item | Ruling | Reason / required change |
|---|---|---|
| P1-1: renewal behind infrastructure | **ACCEPT WITH CHANGE** | Advance the construction-owned implementation and experiment. Describe its implementation/review work honestly; Stage 3 already permits later import. |
| P1-2: small, flow-off worlds | **ACCEPT WITH CHANGE** | Correct domain limitation; replace population caps with threshold-site caps. Require flow-capable measurement only before a study that needs flow. |
| P1-3: axes change survival, not evolvability | **REFUTE** | Rate constants can change fitness differences, accessible viable states and ecological opportunities. No evidence supports “only survival.” Keep alternative axes as hypotheses, separated into law, habitat, mutation and founder factors. |
| P1-4: no predictive validation | **ACCEPT WITH CHANGE** | Specify a stronger prospective bridge; acknowledge existing withheld validation and Stage 6. Reject the proposed unsupported-observer gate. |
| P1-5: Stage 5 cannot answer; enumerate | **ACCEPT WITH CHANGE** | Three-block sign-test limitation is real. Practical comparison remains possible. Enumeration requires a measured budget and a conditional estimand. |
| P2-1.1: B threshold versus K | **ACCEPT WITH CHANGE** | Report normalized sensitivity alongside the fixed absolute endpoint. Do not replace the construction primary threshold. |
| P2-1.2: off-source clause | **REFUTE** | Connected adjacent renewal is expressly admissible; spread-zero controls are intentional. The isolated-cell argument does not establish redundancy. |
| P2-1.3: transport bands/probe equivalence | **ACCEPT WITH CHANGE** | Keep band diagnostics; delete equivalence and the proposed dropping of probes. E already exports at B64/E128. |
| P2-1.4: imported energy | **ACCEPT WITH CHANGE** | Useful dependency measurement, not a demonstrated false positive for connected renewal. Add gross/net E transport, E inventory, PHOTO and energy-producing reactions. |
| P2-2: seed policy repeats confound | **REFUTE** | `proposal/DESIGN.md:108,130` already requires block-level inference. |
| P2-3: founder fit | **ACCEPT WITH CHANGE** | Limit claims to the panel and test held-out founders. The 103 nonbuilders are a disclosed comparison family, not representative controller-space coverage. |
| P2-4: mutation-off seeds | **ACCEPT WITH CHANGE** | Their variation comes from rounding/lotteries here, but can have large biological effects. Add founder/habitat coverage without treating seeds as useless or replaceable by fiat. |
| P2-5: oversized infrastructure | **ACCEPT WITH CHANGE** | Defer operational transport/UI where useful; preserve isolation, validator, immutable attempts and two-host acceptance as pending requirements. Correct costs. |
| P2-6: missing local evidence | **ACCEPT WITH CHANGE** | Add it, including its limitations and the opposite turnover findings. Time-shift 4b remains formally inconclusive despite descriptive gains. |
| P3: ablation cases excluded | **ACCEPT WITH CHANGE** | Correct for primary descriptors; they can affect causal interpretation and confirmation yield. Consider concentrating them in calibration/shortlist validation under a new protocol. |
| P3: external activity/novelty measures | **ACCEPT WITH CHANGE** | Document local calibration failures. They do not permanently invalidate every redesigned measure or the paper’s different measures. |
| P3: replay is not independent science | **ACCEPT** | Already explicit in the proposal; preserve that distinction in exports. |
| P3: baseline/document commit difference | **ACCEPT WITH CHANGE** | Record both as provenance, not as an error. |
| Council answer 1 | **ACCEPT WITH CHANGE** | Passive/rotating controls are handled. P2-1 does not establish all the claimed false positives. |
| Council answer 2 | **ACCEPT WITH CHANGE** | Panel dependence is real; fixed crossings estimate conditional effects. Nine diagnostic rows are not nine accidentally useless candidates. |
| Council answer 3 | **UNRESOLVED** | No evidence yet establishes total matter or kPhoto as a better replacement for diffusion. Use renewal accounting to choose; keep matter a habitat factor. |
| Council answer 4 | **UNRESOLVED** | Descriptor usefulness and dependence need measured outcomes and prospective validation. Seven persistence fractions are possible, not necessarily four; near-one-dimensionality is unproved. |
| Council answer 5 | **ACCEPT WITH CHANGE** | Preserve block-level reporting; the proposal already handles the shared-seed issue. Founders and seeds answer different generalization questions. |
| Council answer 6 | **ACCEPT WITH CHANGE** | A conditioned-field test is promising after controls are defined. Failure cannot choose new chemistry; duplication/modularity also remain unvalidated mechanisms. |
| Council answer 7 | **ACCEPT WITH CHANGE** | Good sufficient competition design. Add genotype-neutral/relabel controls, extinction rules and replication. Frequency-dependent coexistence can be selection even without one direction at both starting ratios. |
| Council answer 8 | **ACCEPT WITH CHANGE** | Keep the stress design and prior wound evidence; choose demographic/sensitivity criteria, not an arbitrary population minimum derived from B128. |
| Council answer 9 | **ACCEPT WITH CHANGE** | Design direction is sound, implementation unproved. Legacy observation comparison is informational (`segment.ex:333–344`); preserve required new acceptance validation. |
| Council answer 10 | **ACCEPT WITH CHANGE** | CPU-first local execution is appropriate. Shards alone do not fulfill the two-machine product contract. |
| Experiment 1: standalone renewal | **ACCEPT WITH CHANGE** | One construction owner; implement, validate, review and freeze A–D before any scientific trajectory. |
| Experiment 2: conditioned field | **ACCEPT WITH CHANGE** | New protocol, conservation-defined controls, panel screening followed by fresh confirmation, no impossibility conclusion. |
| Experiment 3: retrodiction | **REFUTE** | As a pre-Stage-1 gate it conflates unsupported measurement with negative evidence and is not “mostly reading bundles” for missing exact observables. |
| Different unit of search | **ACCEPT WITH CHANGE** | A later experimental design option, not a ready replacement. Define independent histories, transferable unit, assay sensitivity and full cost first. |
| Suggested order | **ACCEPT WITH CHANGE** | Renewal first after ownership/contracts; conditional mapping next; opportunity/evolution assays after measurement readiness. Enumeration and Phoenix timing follow evidence and requirements, not one-Mac-day slogans. |

**(d) What the addendum gets wrong or leaves out**

**1. It partly attacks a stronger claim than the proposal makes.**

The proposal’s initial release is S1–S3, explicitly **not demonstrated evolvability** (`proposal/PRD.md:32`). A capability map is a legitimate bounded deliverable even if it does not predict evolutionary success. The proposal also:

- separates feasibility, accessibility and opportunity;
- forbids treating a failed witness construction as impossibility;
- includes resource-matched conditioned-field interventions already;
- requires fresh seeds and withheld founder/habitat conditions;
- permits a bounded diagnostic map after failed renewal, while withholding adaptive renewal search.

See `proposal/DESIGN.md:28–38,63,77` and `PLAN.md:39,61,78–86`.

The strongest surviving criticism is narrower: the proposal does not yet specify a sufficiently concrete experiment connecting its capability descriptors to *which worlds subsequently evolve useful inherited gains*. Add low- and high-capability comparisons, matched survival/resource controls, and a prospective endpoint before claiming predictive usefulness.

The addendum also neglects closely related **conditioned-medium evidence** already in `docs/plan.md:896–916`: producer-dependent candidates, waste controls and density rescue. Those results warn that apparent ecological dependence can be an Allee/density effect rather than a new trophic opportunity.

**2. Offline optimizer comparison is valid—but only for a declared target.**

A fixed enumerated table is a valid deterministic oracle. Freeze algorithms, bins, anchors, proposal budgets, duplicate handling and stopping rules; reveal only queried entries to each optimizer; then compare independent search-seed replicates.

That measures expected coverage on **this table**. Thousands of seeds can reduce Monte Carlo uncertainty about that conditional difference.

It does not remove:

- uncertainty from the two physics seeds used to construct each table entry;
- winner’s-curse effects from selecting noisy descriptor values;
- dependence across entries using common physics seeds;
- overfitting algorithms or bins after inspecting the completed table;
- the need for unseen founder/habitat validation.

Use multiple independent tables for across-panel claims, or explicitly report a fixed-table benchmark and reserve new scientific cases for transfer. Full enumeration is optional; the budget calculation above does not support making it the default.

**3. “Matched unconditioned field” is not yet a defined conservation-preserving control.**

Matching total matter and total energy alone permits materially different A/C/B/P/E/S inventories and spatial arrangements. Those differences can themselves explain performance. Equal original resources also do not imply equal terminal energy: successful builders may harvest more light.

Two distinct questions need different controls:

| Question | Defensible control |
|---|---|
| Does conditioning, as a complete process, change a receiver’s prospects? | Builder versus matched nonbuilding/cost-retaining ablation histories from identical initial budgets and offered light, with terminal inventories explicitly reported. |
| Does the resulting spatial organization help at fixed inventories? | A reconstructed/permuted field preserving **each channel total**, with a fixed receiver footprint and treatment-independent reconstruction rule. Call it a scrambled/reconstructed field, not an untouched unconditioned field. |

To avoid smuggling resources:

- Reserve an identical receiver inoculum within the declared total budget before conditioning, or debit its matter and energy exactly during reconstruction.
- Do not overwrite occupied cells without accounting for removed material.
- Specify whether living builders remain. If they remain, this is a co-culture test; if removed, specify the transformation of their B, P, E and genomic labels.
- Record pre/post matter, stored chemical/free/signal energy, and any analytical heat/work transfer. Removing P or turning it into A is not energy-neutral unless its energy is explicitly reassigned.
- Use identical receiver-genome placement/relabeling in all comparison arms.

Channel-preserving spatial permutations can conserve inventories exactly without new resources, but isolate spatial organization rather than the entire conditioning mechanism. A positive result still needs removal/reconstruction controls and fresh confirmation. Screening 103 genomes is not 103 independent confirmations.

**4. The proposed retrodiction check is unfair as a gate, useful as an applicability audit.**

A flow-rejecting observer returns **unsupported**, not biological failure. Existing census bundles also cannot reconstruct missing exact per-step Q/R merely by reading them (`proposal/DESIGN.md:53`).

The fair sequence is:

1. Define the claim the descriptor should predict.
2. Select historical contrasts relevant to that claim.
3. Establish that their required measurements exist or can be reconstructed validly.
4. Use them as calibration, with their inspected status disclosed.
5. Test a frozen prediction on new conditions.

The pond results concern imposed selection/life cycles; gradient versus spots also changes habitat; the planet sandbox uses a different experimental setting. They are not interchangeable “known rankings of physics evolvability.”

**5. One GPU candidate is neither priced nor fully measurable yet.**

Let H be the terminal evolution horizon and J the garden horizon. A mutation-on/off twin requires **2H GPU-world steps per independent history block**, before any transfer assays.

A simple illustrative design with two sampling times and three garden panels—evolved, mutation-off history, ancestral control—adds **6J world steps per garden replicate**, provided each panel fits one GPU world. Direct late-versus-early competitions, multiple founders, reconstructed populations, replay and preparation add further work.

For H=10⁶ and J=10⁴, that is already **2.06 million world steps per block** under those simplifying assumptions. A 64×64-tile world with 64 tiles has **262,144 cells**; it is not comparable to one 32×32 witness case.

Existing instruments show why the assay cost matters:

- The scaffold assay uses 64 recipient ponds, 10,000 steps and four or eight replicate worlds per set (`docs/scaffold-registration-v1.md:98–110`).
- The default two-time time-shift matrix has four origin/environment combinations × five implants × four positions = **80 assays per history**. At 50,000 steps, that is **4 million assay-world steps**, beyond source evolution (`tools/assay.ts:45,395–430`).

There is no defensible dollar price for the proposed generic candidate yet. Benchmark a fully specified candidate, including source histories, observation, transfers, validation and storage. Existing paid-cohort costs are context, not a quote for this workload.

Also decide whether the readout concerns a dominant genotype or a mixed population. The former can miss cooperative inherited organization; the latter needs controlled composition and state-transfer rules. Neither is automatically supplied by the current M3 evaluator.

**6. Deferring Phoenix need not weaken science, but it defers product acceptance.**

A local manifest/runner/reducer can enforce:

- exclusive research roots;
- source-closure and input hashes;
- immutable attempts;
- exact observation validation;
- complete-case reduction;
- explicit seed blocks;
- no access to registered queues.

That preserves scientific isolation. It still needs crash-safe publication and validated reuse; a directory’s existence is insufficient.

Keep O1/O3’s two-host, browser/CLI and fault-injection requirements pending until demonstrated. If the user wants the distributed workbench now, Phoenix Stage 2 remains necessary work, irrespective of campaign size. If the priority is scientific diagnosis, it can follow the local experiment without being deleted from the product contract.

**7. Renewal belongs to the construction workstream; a named owner remains unresolved.**

`proposal/PLAN.md:7` explicitly requires agreement on one owner and forbids creating a competing runner. `proposal/DESIGN.md:42` forbids silently executing that workspace’s protocol from the workbench workstream.

Standalone execution is compatible with `construction/RENEWAL-PLAN.md:13,167–171`; it explicitly specifies that workspace and does not require merging or deployment. It also fits later artifact import under `proposal/PLAN.md:35`.

Thus: designate the construction implementation owner, build the one planned observer/runner/verifier there, and have the workbench consume its stable API or exact artifacts. No document presently identifies a specific person or agent as that agreed owner.

**(e) The plan I would stand behind**

| Order | Work | Gate | Original proposal disposition |
|---:|---|---|---|
| 0 | Resolve ownership, dependencies and claims. Record exact source closures and separate construction, discovery and existing registered namespaces. Add the omitted local evidence with limitations. | One renewal owner; reviewed dependency/API boundary; no ambiguous inherited authority to run science. | **Stage 0 stays and becomes more explicit.** |
| 1 | Implement construction renewal A–D: protocol, observer, durable runner, independent verifier. Add exact transport-band fixtures and tests for stored/imported energy accounting using artificial states. | Required tests, historical pins, CPU/GPU checks and required review pass. Freeze before scientific trajectories. | **Move renewal implementation ahead of distributed infrastructure. Reuse Stage-1 contracts where helpful; no duplicate runner.** |
| 2 | Execute only the frozen renewal pilot and earned confirmation under its existing protocol. Close it with its original thresholds and negative-result rules. | Independent audit and predetermined replay agree; complete or explicitly incomplete report. | **Stage 3 changes order, not scientific contract.** |
| 3 | Build the minimal local workbench adapter and calibration battery. Preserve source, observation and acceptance identities. Benchmark complete cases, observer and artifacts included. | Passive/light controls behave correctly; output/storage/retry costs bounded; imported artifacts validate exactly. | **Stage 1 stays; remaining Stage 3 calibration stays.** |
| 4 | Run a bounded diagnostic parameter map if justified. Initially retain the registered proposal’s separate law/habitat/founder factors; revise axes only before freezing, based on renewal accounting. | Domain-specific observer bounds; disclosed founder panel; clear null/floor handling; measured budget. | **Stage 4 stays, with stronger interpretation and budget gates.** A negative renewal study does not automatically erase its diagnostic value. |
| 5 | Define a small selection/accessibility study in a demonstrated renewable regime. Add neutral/relabel controls, genotype-specific competition and a usable common garden. In a separately registered branch, define the conditioned-field opportunity intervention. | Selection distinguishable from drift/lottery artifacts; transfer sensitivity demonstrated; no hidden resource changes or extinction-floor inference. | **Stage 6 is split into concrete protocols.** Opportunity feasibility may be tested early, but cannot substitute for accessibility. |
| 6 | Decide whether an optimizer comparison is useful. Inspect calibrated descriptor resolution and measured evaluation costs. Use random/factorial sampling by default; enumerate only if explicitly affordable. | Frozen comparison estimand, meaningful uncertainty, and independently priced fresh-condition validation. | **Stage 5 becomes optional.** Automatic enumeration and claims of broad superiority from three blocks **go**. |
| 7 | Build/qualify the isolated Phoenix discovery plane when distributed participation is required. Demonstrate both physical hosts, browser/CLI routes and failure recovery. | All PRD operational acceptance checks pass; registered/public execution unchanged. | **Stage 2 stays as a deferred product milestone**, not a prerequisite to construction renewal. |
| 8 | Run prospective evolutionary-world comparisons; only then stress/antifragility studies with source costs, extinctions and inherited gains retained. | Independent histories, assay power/sensitivity and total candidate cost established; laws frozen during evolution. | **Later Stage 6 stays.** GPU use is earned by measurement and throughput, not assumed. |

The proposal’s **S1–S10 remain**, with S8’s predictive-validation boundary made concrete and S9 explicitly restricted to tested panels. **O1–O9 remain**; some are pending during local scientific work. Case identity, canonical batch reduction, cached-result provenance, full initial replay, exact observation acceptance and separate namespaces stay.

The research/software direction also stays: TypeScript computation, Phoenix coordination when needed, no new chemistry by default, no automatic WASM/second scheduler, and zero default cloud allowance. The unsupported isolated-cell rejection certificate, arbitrary one-Mac-day infrastructure trigger, and historical-observer retrodiction gate go.

Decisions that belong to the user:

| Decision | Recommended default |
|---|---|
| Is the immediate deliverable scientific diagnosis or the distributed contributor product? | **Scientific diagnosis first**, while retaining explicit pending product acceptance. |
| Who owns renewal, and which construction revision is authoritative? | **One construction-workstream owner**, using the reviewed revision or documented descendant required by its plan. |
| Is the later target autonomous local ecology, imposed pond life cycles, or both? | **Separate tracks.** Use pond results as methodological evidence; do not count imposed reproduction as autonomous reproduction. |
| What local runtime/storage and future cloud budget is acceptable? | **Bounded local pilot first; cloud zero.** No full enumeration until observer-inclusive cost is known. |
| How should unlanded ablation dependencies be integrated? | **Minimal reviewed extraction or pinned construction execution**, preserving the cost-retaining intervention and leaving unrelated rule-2 work isolated. |
| Which second physical host and permitted browser/CLI route will satisfy the PRD? | Choose them before distributed implementation acceptance; do not substitute two tabs on one machine. |
| When should new laws be considered? | After a specific, controlled bottleneck result—not merely failed human design or a finite negative search. |

**(f) What I did not verify**

- I ran **no simulation**, including no nutrient-reservoir witness trajectory with any seed. I did not rerun timing, scientific tests, golden tests or services.
- The 384 steps/second measurement, observer overhead, multicore scaling, storage demand, GPU candidate throughput and current cloud prices remain unverified.
- Historical scientific claims were checked against source, tracked reports and selected compact results; I did not independently reconstruct all raw scaffold, foundations, planet, construction or wound histories.
- Renewal existence, descriptor dimensionality, capability-to-evolution prediction, and success of the conditioned-field intervention remain experimentally unresolved.
- I checked the paper’s primary HTML, not its complete implementation, PDF figures, licensing inventory or quantitative reproducibility.
- The proposed discovery acceptance path does not yet exist. I inspected relevant legacy behavior, not a running deployment or complete security/failure-recovery implementation.
- All seven `BASELINE.json` source hashes match the **main checkout**. Four differ in this earlier review checkout: config, island client, queue and stitch. I did not treat those checkouts as interchangeable; `step.ts` is identical.
- This report does not certify that the separately required Sol 6.1 High phase-boundary review has occurred.