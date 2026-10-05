# Research and reuse decisions

Research date: 2026-10-04, revised the same day after the [council](COUNCIL.md). Primary literature, author repositories and official infrastructure documentation were inspected. External software was not installed or executed. The sections on this project's own evidence, the rule arithmetic and the measured costs were added in the revision. Findings distinguish published results, inspected code, recorded project results and proposed adaptations.

## Scientific starting points

| Work | What it supplies | What we should reuse | Important limitation |
|---|---|---|---|
| [Michel et al., Flow-Lenia universe exploration](https://arxiv.org/html/2505.15998v1), [research code](https://github.com/Thomick/Exploring-Flowlenia), [interactive archive](https://developmentalsystems.org/Exploring-Flow-Lenia-Universes/) | Goal-directed exploration of system-level behavior; comparison with random search | Sample desired outcomes, perturb nearby known worlds, retain an archive, inspect trajectories | More descriptor coverage does not establish adaptation or indefinitely continuing innovation |
| [Plantec et al., Flow-Lenia](https://arxiv.org/abs/2212.07906), [implementation](https://github.com/erwanplantec/FlowLenia) | Conserved mass and localized parameters allowing different patterns to share a world | Compare localization and mixing mechanisms; treat transport and heredity together | Floating-point JAX implementation is not a replacement for our integer CPU/WGSL contract |
| [Pyribs](https://docs.pyribs.org/en/stable/), [source](https://github.com/icaros-usc/pyribs) | Modular quality-diversity archives, emitters, and ask/tell scheduling | Algorithm reference; optional offline optimizer speaking the same case/result format | A Python runtime is unnecessary for the initial existing TypeScript archive |
| [POET](https://arxiv.org/abs/1901.01753), [POET/Enhanced POET code](https://github.com/uber-research/poet) | Co-development of environments and solutions, with transfer between environments | Later: test whether a solution from one habitat enables progress in another | RL agents and external optimization differ from intrinsic ecological evolution |
| [Stringmol](https://stringmol.york.ac.uk/index.htm), [source](https://github.com/franticspider/stringmol) | Molecules can act as both programs and catalysts; a chemistry with richer genotype/phenotype interaction | Mechanistic inspiration for reusable components and alterable interactions; separate reference experiments | Repository documents repeatability and logging issues; it cannot serve as our replay oracle |
| [Hordijk and Steel, autocatalytic sets](https://arxiv.org/abs/1206.1017), [CatReNet](https://github.com/husonlab/catrenet) | Structural analysis of catalytic reaction networks, including inhibition | Cheap feasibility questions before simulation; optional network visualization if chemistry expands | Structural closure alone does not establish persistence under our rates, losses, spatial transport, or energy budget |
| [CAX](https://github.com/maxencefaldor/cax) | JAX implementations of many cellular/particle systems, including Flow-Lenia | A separate benchmark sandbox if substrate comparison becomes necessary | Adopting it now would introduce another simulator and numerical contract |
| [Taylor, requirements for open-ended evolution](https://www.tim-taylor.com/papers/taylor2015requirements.web.html) | A proposed framework covering reproduction, expressive media, viable mutations, and continued evolutionary drive | Organize diagnostics around distinct prerequisites | An argued framework, not a theorem or sufficient engineering checklist |

The closest methodological match is Michel et al. Their v1 paper reports greater goal-space coverage than random search, and explicitly identifies difficulty separating meaningful adaptation from random variation. We should reproduce the search idea on our own substrate while requiring causal evidence before upgrading an interesting trajectory to an evolutionary result. We have not reproduced their quantitative comparison. Their companion website and executable research repository are separate resources.

Our working hypothesis is that **capabilities that can be combined and reused** deserve priority. A paid structure that changes transport could create a resource gradient; that gradient could support another strategy; the second strategy could alter the first strategy's prospects. This is our proposed causal chain, not a demonstrated property of browser-life. Each arrow needs an intervention test. Optimizing visual complexity or mutation counts alone would not test it.

Two things about Michel et al. shape how we use it. Its goal space is built from non-neutral evolutionary activity, compression-based complexity and multi-scale entropy. This project's own activity, novelty and role measures failed their null calibration (next section), so we do not import those descriptors. That says nothing about the paper's measures on its own substrate, or about redesigned measures here. Its searches also run at a different scale: 256×256 grids, 10,000 steps, and 2,000 iterations in the one experiment where the paper states a count. Our first domains have a few integer axes and are sampled by factorial.

## Reuse and licensing inventory

GitHub repository metadata and root files were inspected on the research date. These are reconnaissance findings; pin a revision and inspect the actual relevant file license before importing code.

| Repository | Observed licensing / maturity | Decision |
|---|---|---|
| `Thomick/Exploring-Flowlenia` | GitHub reports no detected license; recursive tree at `d09d0d3f3c19be31e473eb5d8acbaa3da815f78c` contained no license/copying path. Includes `flowlenia/autodisc/imgep_explorer.py` | Use the published method and cite it. Do not vendor code unless its reuse terms are resolved |
| `erwanplantec/FlowLenia` | No license detected by GitHub metadata | Method/reference comparison only for now |
| `icaros-usc/pyribs` | MIT detected | Optional external optimizer; no need to port wholesale |
| `maxencefaldor/cax` | MIT detected | Preferred permissively licensed external simulation sandbox if needed |
| `uber-research/poet` | Apache-2.0 detected; inspected repository uses Python/Fiber/Gym | Reuse the transfer idea, not its cluster deployment |
| `franticspider/stringmol` | GPL-2.0 detected; README describes Linux-oriented build and restart limitations | Separate reference tool, not embedded production code |
| `husonlab/catrenet` | GitHub returned `NOASSERTION`; licensing not resolved in this pass | Optional inspection/export target; no code import planned |

Metadata is available at the corresponding `https://api.github.com/repos/<owner>/<repo>` endpoints. No third-party source was copied into this project.

## Evidence already in this project

The first draft of this page looked outward and at the construction workspace. The lines below are closer to the question than any external source, and the plan now builds on them. Sources are `docs/plan.md`, `docs/reassessment-2026-09-30.md`, `plans/README.md` and the workspaces named.

| Line | What it established | What it did not | Use in this plan |
|---|---|---|---|
| M4 ensemble (registered, 170 runs of 10⁶ steps) | Populations in the main ecology maintain themselves and spread: no run went extinct. Treatment beats neutral on new activity on `gradient-m3` | Endpoint 2 failed because neutral runs also classify as growing | Maintenance and spread are not what the main ecology lacks. Activity-style measures do not separate evolution from drift here |
| Foundations test 2 | 310 of 2,400 one-step mutants (12.9%) are viable and changed; `tools/assay.ts mutants` | Viable role-changing mutants for only 1 founder of 12 | The mutant-panel instrument exists; its role readout is narrow |
| Foundations test 4b | With 256-cell implants, late lineages beat early ones in the early state in all 10 histories; the neutral control cleared the margin in 0 of 5 | Formally inconclusive: in the late state both groups sat at the extinction floor in half the histories. The implant transfers physical contents as well as genomes | The time-shift implant separated treatment from null descriptively. Any reuse must avoid inference from extinction floors |
| Foundations test 5 | Evolved lineages keep survival and light dependence | Regeneration falls to 0.168 against the founders' 0.979 | Bodies erode under evolution; do not assume capability is retained |
| Foundations test 6 and its rebuild (`t6-v2.json`) | The compartment detector works on fixtures | None of four activity, novelty and role measures passes its null check | No such measure may drive search or carry a claim |
| Foundational reset, Gate A | 135 of 200 sampled parent links show no immediate copy contribution | The entity question is unresolved: a measurement limitation | Readouts here are stated on genotypes and matter, never on tracker births |
| Founder diagnostic | 11 of 24 genomes originate a role in both gardens, against 1 of 12 chosen founders | – | Founder choice is a major lever; a three-arm panel is too narrow |
| Proxy failures (`plans/README.md`) | Founder 7's mutants change role in the evaluator in 27 to 32 of 32 seeds, yet it originates no role in open worlds; the weights-only probe failed validation | – | A small-world score needs a predictive check before it selects worlds |
| Scaffold registration (2026-10-03) | H1 and H2 confirmed. Under one physics, competence is 0.979 in `scaf` against 0.623 in `cont` and 0.025 in `rand`. The evolved genome beats a matched relabelled-ancestor control in 24 of 24 histories | The genome effect is small (median 19 of 512 fragments); no endogenous life cycle; one regime | Population structure changes outcomes strongly under one physics. The matched genome control separated treatment from null. It measures a dominant genome's effect on matched ancestral fragments, not inherited improvement in arbitrary mixed populations |
| Obligate characterisation (`docs/plan.md`, 2026-09-30) | 12 of 12 representative genomes die alone and live beside a producer | 11 of 12 are rescued by a fourfold inoculum, which raises seeded energy as well as biomass; one (cluster 9) is not. Dependence on another lineage's products was not established. Candidates displace the producer; they do not coexist with it | A conditioned-field result needs an inoculum control before it is read as opportunity |
| Transition hunt | Frozen; Stage 0 passed | Stage 1 not launched (draw not approved) | Untouched by this plan |
| Ownership and cells sandboxes (unlanded) | Eight screens of takeover, wound, shape and declared-cell variants. Wounds lowered lineage turnover somewhat in the ownership screens and restored it in the wall arm of the cells screens | No arm met its pre-stated Promising rule; neither wound result gave a consistent gain in regeneration | Prior for the disturbance stage |
| Planet sandbox | Blind drifting beats sensing under a steady sun and crashes under a wandering one | Single worlds, small n | Forcing changes which strategy wins |
| Construction workspace (unlanded) | A designed genome's paid polymer retention keeps it alive where matched nonbuilders die (stationary, five seeds). Mutations sometimes improve it | No propagation: `spread` 1, 2 and 4 kill all 60 runs without a reservoir. The mutation screen failed its consistency rule (0 of 3 founders). Renewal is planned, not run | The witness, its comparators and the renewal plan are inputs to Stages 1 and 3 |

## Existing local head start

Inspected working tree: `/Users/nicholas/develop/browser-life`; Git HEAD was `5f73fac4427a8dfccedd0da5202b0add2dd04859`. The checkout already contained unrelated changes. This is a working-tree inspection, not a claim that every inspected byte is committed or deployed. [Selected source hashes](BASELINE.json) bind the main implementation findings to the inspected bytes.

| Existing component | Evidence and fit | Gap for this proposal |
|---|---|---|
| Exact physics | [config](../../packages/schema/src/config.ts), [CPU rules](../../packages/sim-ref/src/step.ts), WGSL and golden tests | Current main supports rule 1; construction workspace changes must not be presumed integrated |
| Quality-diversity search | [MAP-Elites](../../packages/search/src/mapelites.ts) | Archive is genome-specific, with mass/speed descriptors. World discovery needs a separate adapter and definitions |
| Assay machinery | [evaluator](../../packages/search/src/evaluate.ts) | Already tests maintenance/lesions/light, but is GPU-specific and not the proposed exact per-step renewal observer |
| Distributed queue | [Queue](../../apps/coordinator/lib/coordinator/queue.ex) | Leases, retries, persisted state, version/capability matching exist. Creation accepts preset-based specs and drops arbitrary overrides |
| Results and replay | [Segment](../../apps/coordinator/lib/coordinator/segment.ex), [Store](../../apps/coordinator/lib/coordinator/store.ex) | Physics+observer digest governs verification; observation-file comparison is informational |
| Collection | [stitch CLI](../../tools/stitch.ts) | Already has `--require-observations-verified`; with segmented runs this requires observation verification for every included segment |
| Workers | [Deno CLI](../../tools/island.ts), [shared island client](../../packages/runner/src/island.ts), browser island page | Existing shared runner takes a GPU device. CPU discovery execution, signed-off task schemas, and private research admission remain work |
| Deployment | [Compose](../../compose.dokploy.yaml), [deployment notes](../../deploy/README.md) | Existing site/coordinator packaging is reusable; live availability and other machines were not tested |
| Run tool | `tools/run.ts` writes run bundles for GPU histories. Its `--override` flag accepts only `mutRate` and `pondDeath` | Any other axis needs the allowlist in `packages/runner/src/runner.ts` extended under a reviewed change |
| Assay tools | `tools/assay.ts` (mutant panel, time-shift, common garden, retest), resumable with `--part k/N`; the scaffold assays | It skips a unit when its file exists, which is not validation. Each instrument is valid only within its demonstrated interpretation |
| Batch evaluator | `packages/search/src/evaluate.ts` runs many tiles in one GPU world | It fixes `mutRate` at 0. Pond tiles are coupled by the cycle, so they are not independent histories |
| Second machine | An M3 Pro with Deno, golden-verified (`docs/reassessment-2026-09-30.md`) | Unused by this plan so far; a candidate second physical host |

The [construction review](../../../browser-life-construction/experiments/construction/FABLE-REVIEW.md) and [renewal proposal](../../../browser-life-construction/experiments/construction/NEXT-EXPERIMENT.md) were read directly. They motivate a bounded nutrient/transport diagnostic. They do not establish an engine-wide inability to reproduce or prove that a new law is necessary. The construction witness establishes finite persistence benefit, not indefinite maintenance.

Useful warning from [earlier local plans](../../plans/README.md): analytic founder evolvability proxies previously failed to predict open-world novelty, and several novelty measures failed null calibration. This proposal therefore makes proxy calibration and withheld ecological validation prerequisites, rather than restarting those claims under another name.

## Rule arithmetic

Exact facts come first. Both reviewers computed them independently with the reference functions `w1d` and `mulShareD`, for a cell with zero displacement. No world was stepped.

Bound matter leaves a cell in integer shares, to its four cardinal and four diagonal neighbours. For an amount `q` at `spread` `s` the amount leaving is `4·floor(64·s·q / (64+2s)²) + 4·floor(s²·q / (64+2s)²)`.

| `spread` | Share leaving per step, large amounts | Smallest amount that sends anything to a cardinal neighbour | One quantum per cardinal neighbour up to | Smallest amount that sends anything diagonally |
|---:|---:|---:|---:|---:|
| 0 | 0% | never | – | never |
| 1 | 5.97% | 69 | 136 | 4,356 |
| 2 | 11.42% | 37 | 72 | 1,156 |
| 4 | 20.99% | 21 | 40 | 324 |
| 8 | 36.00% | 13 | 24 | 100 |

What follows exactly:

- With `dtQ` 0 and motility off, displacement is zero, so at `spread` 0 nothing bound moves (`packages/sim-ref/src/step.ts:240-251`).
- The thresholds apply to B, P and E separately (`step.ts:280-299`). A founder with B 64 and E 128 at `spread` 1 sends no biomass on its first step and four quanta of free energy.
- With `gateK` 1 the gate on dissolved A and C is `floor(D / (1 + P_s + P_t))` (`step.ts:351`). It is zero once the polymer on a pair of cells reaches D. Below that point D still changes the flow.
- Total matter in the two renewal habitats is 5,120 and 17,408 quanta, so at most 40 or 136 sites can hold B ≥ 128 at once. This caps threshold-qualified sites only. The engine reacts at any B > 0 and carries genomes on B + P, and the tile has 1,024 cells.
- Over any window and any set of cells, with the witness's energies, `10·ΣGROW ≤ E_start − E_end + 8·ΣRESP + 2·ΣDECOMP + net E import`, before maintenance, work, emission and leak are subtracted. Respiration alone cannot fund net growth. Stored or imported free energy can, and so can decomposition of imported waste. Photosynthesis is the only route by which light energy enters.

One heuristic, which is not a bound. The addendum computed an isolated exporting cell's best expected net change per step and found it negative across the proposed rule-1 domains, for example −0.17% per step at `spread` 1 and `kCatHalf` 32. Astra reproduced the numbers and showed their limits: the maximum was taken only over B ≤ 4,096; it assumes no stored free energy, and with it a cell at B 136 can gain in one step; it uses one pre-transport catalyst value; and it says nothing about non-exporting states or about any single stochastic run. It motivates one hypothesis: at `spread` ≥ 1, a source above the export threshold persists only if its neighbours send mass back. It must not be used to reject a candidate or a descriptor. Stage 1 turns the exact table into fixtures, and the renewal accounting tests the hypothesis.

## Measured and derived costs

One number is measured: the reference simulator ran 10,000 steps of a 32×32 default rule-1 world in 26.0 s on one core of an M1 Max, with other sessions sharing the machine. Everything below is extrapolated from it. The figures exclude the per-step observer, serialization, analysis, retries and contention, none of which has been measured. Stage 3 replaces them with a benchmark of complete cases.

| Workload | Executions | Bare core-hours | Elapsed on eight cores |
|---|---:|---:|---:|
| Renewal experiment, every phase with its replays (612,000 steps) | 64 | 0.44 | – |
| Diagnostic map with confirmation as first proposed, full replay | 1,104 | 8.0 | 1.0 h |
| Search comparison as first proposed, full replay | 4,608 | 33.3 | 4.2 h |
| Enumeration of the 1,344-point domain, 16 cases each | 21,504 | 155.3 | 19.4 h |
| The same with full replay | 43,008 | 310.6 | 38.8 h |

For GPU histories the project has recorded figures, which are context and not a quote for any workload here. On an AWS g5.xlarge, six lanes ran about 730 steps per second each on 256×256 worlds, about $0.07 per 10⁶-step run; the Mac takes about 22 minutes per 10⁶ steps (`docs/plan.md`). Assays cost more than the histories they read: the default time-shift matrix is 80 assays per history. No price exists yet for an evolving-world candidate.

## Compute options

| Option | Assessment |
|---|---|
| Frozen manifest, shards and directory collection on local machines | Recommended first, as the core the plane wraps. Needs no service and keeps research output in its own root. Preserves provenance only if the runner validates a result before accepting or reusing it. Does not demonstrate leases, restart recovery or browser onboarding |
| Phoenix coordinator + HTTPS TypeScript workers | Recommended for the distributed plane (Stage 3b). Closest to inspected implementation; compute stays local, coordination stays centralized; supports intermittently connected machines |
| Distributed Erlang nodes on every worker | Useful inside a trusted backend cluster, unnecessary for a browser or mixed laptop fleet. Erlang's default distribution is cleartext and cookie-based; TLS requires configuration ([official guide](https://www.erlang.org/doc/system/distributed.html)) |
| Pure JS coordinator | Technically viable, but would duplicate the existing lease/persistence machinery. Keep the wire format runtime-neutral |
| WASM CPU kernel | Possible future acceleration after profiling; WASM is not a scheduler. Preserve integer semantics and golden equality. WASM alone does not eliminate all nondeterminism ([official FAQ](https://webassembly.org/docs/faq/)) |
| BOINC | Established precedent for work units and redundant validation ([platform paper](https://boinc.berkeley.edu/boinc_a_platform_for_volunteer_computing.pdf)); adopting its full stack is excessive for the initial handful of private workers |
| AWS Batch | Array jobs fit parameter sweeps and support up to 10,000 children ([official docs](https://docs.aws.amazon.com/batch/latest/userguide/array_jobs.html)). Optional later launcher; do not let it become a second authority for accepting scientific results |

For a private fleet, [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) can expose the combined site/API over private HTTPS. A managed work laptop may be better served by the browser route through an approved HTTPS endpoint. The workbench should require neither inbound laptop ports nor Elixir installation on workers.

AWS Spot interruptions must be survivable without receiving notice: AWS describes the usual two-minute notice as best effort ([documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html)). Short independent cases and leases already fit that requirement. Choose CPU versus GPU from measured accepted cases per dollar, including verification and transfer, not advertised GPU throughput. No price estimate or cloud account state was verified in this research.

## What research does not settle

No source supplies a guaranteed recipe for open-ended evolution. A diverse behavioral archive is a discovery tool. A catalytic network is a feasibility clue. Repair is a capability. None alone demonstrates cumulative inherited innovation. The workbench makes those distinctions explicit and cheap to test.

Nothing here shows that a capability score predicts which worlds go on to evolve useful inherited gains. That link is the predictive bridge in the [plan](PLAN.md), Stage 8, and it is untested. Until it is tested, the capability map is a bounded result about what the physics permits for a disclosed founder panel, and no more.
