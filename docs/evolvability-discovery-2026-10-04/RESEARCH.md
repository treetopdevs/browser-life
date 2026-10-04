# Research and reuse decisions

Research date: 2026-10-04. Primary literature, author repositories, and official infrastructure documentation were inspected. External software was not installed or executed. Findings below distinguish published results, inspected code, and proposed adaptations.

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

## Existing local head start

Inspected working tree: `/Users/nicholas/develop/browser-life`; Git HEAD was `5f73fac4427a8dfccedd0da5202b0add2dd04859`. The checkout already contained unrelated changes. This is a working-tree inspection, not a claim that every inspected byte is committed or deployed. [Selected source hashes](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/BASELINE.json) bind the main implementation findings to the inspected bytes.

| Existing component | Evidence and fit | Gap for this proposal |
|---|---|---|
| Exact physics | [config](/Users/nicholas/develop/browser-life/packages/schema/src/config.ts), [CPU rules](/Users/nicholas/develop/browser-life/packages/sim-ref/src/step.ts), WGSL and golden tests | Current main supports rule 1; construction workspace changes must not be presumed integrated |
| Quality-diversity search | [MAP-Elites](/Users/nicholas/develop/browser-life/packages/search/src/mapelites.ts) | Archive is genome-specific, with mass/speed descriptors. World discovery needs a separate adapter and definitions |
| Assay machinery | [evaluator](/Users/nicholas/develop/browser-life/packages/search/src/evaluate.ts) | Already tests maintenance/lesions/light, but is GPU-specific and not the proposed exact per-step renewal observer |
| Distributed queue | [Queue](/Users/nicholas/develop/browser-life/apps/coordinator/lib/coordinator/queue.ex) | Leases, retries, persisted state, version/capability matching exist. Creation accepts preset-based specs and drops arbitrary overrides |
| Results and replay | [Segment](/Users/nicholas/develop/browser-life/apps/coordinator/lib/coordinator/segment.ex), [Store](/Users/nicholas/develop/browser-life/apps/coordinator/lib/coordinator/store.ex) | Physics+observer digest governs verification; observation-file comparison is informational |
| Collection | [stitch CLI](/Users/nicholas/develop/browser-life/tools/stitch.ts) | Already has `--require-observations-verified`; with segmented runs this requires observation verification for every included segment |
| Workers | [Deno CLI](/Users/nicholas/develop/browser-life/tools/island.ts), [shared island client](/Users/nicholas/develop/browser-life/packages/runner/src/island.ts), browser island page | Existing shared runner takes a GPU device. CPU discovery execution, signed-off task schemas, and private research admission remain work |
| Deployment | [Compose](/Users/nicholas/develop/browser-life/compose.dokploy.yaml), [deployment notes](/Users/nicholas/develop/browser-life/deploy/README.md) | Existing site/coordinator packaging is reusable; live availability and other machines were not tested |

The [construction review](/Users/nicholas/develop/browser-life-construction/experiments/construction/FABLE-REVIEW.md) and [renewal proposal](/Users/nicholas/develop/browser-life-construction/experiments/construction/NEXT-EXPERIMENT.md) were read directly. They motivate a bounded nutrient/transport diagnostic. They do not establish an engine-wide inability to reproduce or prove that a new law is necessary. The construction witness establishes finite persistence benefit, not indefinite maintenance.

Useful warning from [earlier local plans](/Users/nicholas/develop/browser-life/plans/README.md): analytic founder evolvability proxies previously failed to predict open-world novelty, and several novelty measures failed null calibration. This proposal therefore makes proxy calibration and withheld ecological validation prerequisites, rather than restarting those claims under another name.

## Compute options

| Option | Assessment |
|---|---|
| Phoenix coordinator + HTTPS TypeScript workers | Recommended. Closest to inspected implementation; compute stays local, coordination stays centralized; supports intermittently connected machines |
| Distributed Erlang nodes on every worker | Useful inside a trusted backend cluster, unnecessary for a browser or mixed laptop fleet. Erlang's default distribution is cleartext and cookie-based; TLS requires configuration ([official guide](https://www.erlang.org/doc/system/distributed.html)) |
| Pure JS coordinator | Technically viable, but would duplicate the existing lease/persistence machinery. Keep the wire format runtime-neutral |
| WASM CPU kernel | Possible future acceleration after profiling; WASM is not a scheduler. Preserve integer semantics and golden equality. WASM alone does not eliminate all nondeterminism ([official FAQ](https://webassembly.org/docs/faq/)) |
| BOINC | Established precedent for work units and redundant validation ([platform paper](https://boinc.berkeley.edu/boinc_a_platform_for_volunteer_computing.pdf)); adopting its full stack is excessive for the initial handful of private workers |
| AWS Batch | Array jobs fit parameter sweeps and support up to 10,000 children ([official docs](https://docs.aws.amazon.com/batch/latest/userguide/array_jobs.html)). Optional later launcher; do not let it become a second authority for accepting scientific results |

For a private fleet, [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) can expose the combined site/API over private HTTPS. A managed work laptop may be better served by the browser route through an approved HTTPS endpoint. The workbench should require neither inbound laptop ports nor Elixir installation on workers.

AWS Spot interruptions must be survivable without receiving notice: AWS describes the usual two-minute notice as best effort ([documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-termination-notices.html)). Short independent cases and leases already fit that requirement. Choose CPU versus GPU from measured accepted cases per dollar, including verification and transfer, not advertised GPU throughput. No price estimate or cloud account state was verified in this research.

## What research does not settle

No source supplies a guaranteed recipe for open-ended evolution. A diverse behavioral archive is a discovery tool. A catalytic network is a feasibility clue. Repair is a capability. None alone demonstrates cumulative inherited innovation. The proposed workbench makes those distinctions explicit and cheap to test.
