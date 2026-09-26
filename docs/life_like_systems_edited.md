# Simulating Life-Like, Emergent, and “Anti-Entropic” Systems

*Edited copy of the Deep Research report, September 24, 2026. Formatting and mathematical markup repaired; substantive research claims retained. See the separate browser implementation addendum for a proposed build.*

## Executive summary

The strongest current research direction is **not** to simulate “negative entropy” in the literal thermodynamic sense. A physically coherent artificial-life system is an **open, driven, nonequilibrium system**: it may become more internally organized while consuming free energy or other resources and exporting entropy to its surroundings. Prigogine's theory of dissipative structures established that ordered structures can persist far from equilibrium through irreversible flows, while later stochastic-thermodynamics work provides practical ways to estimate entropy production from trajectories. “Anti-entropy” is also used in a more specialized biological sense by Bailly and Longo to denote increasing organization or phenotypic complexity rather than a violation of the second law. For artificial life, the most productive conceptual synthesis is:

Resource throughput → self-maintenance → reproduction and heredity → ecological interaction → evolutionary innovation.

with **multiple scales of organization allowed to emerge rather than being hard-coded**. Autopoiesis supplies the self-production/self-maintenance perspective; nonequilibrium thermodynamics supplies the physical bookkeeping; evolutionary theory supplies heredity, variation, selection, niche construction, and major transitions; open-ended-evolution research asks whether novelty and adaptive complexity continue rather than merely reaching an optimized endpoint. The field still lacks a universally accepted scalar measure of “complexity” or “open-endedness.” This is not merely a tooling gap: Shannon entropy, algorithmic incompressibility, structural organization, predictive information, adaptive complexity, evolutionary activity, and thermodynamic entropy production quantify fundamentally different things. Pure randomness, for example, can be maximally incompressible while being biologically uninteresting. Consequently, **a dashboard of thermodynamic, informational, structural, behavioral, ecological, and evolutionary metrics is considerably more defensible than one “anti-entropy score.”** Predictive information, statistical/causal organization, differentiation, phylogenetic depth, novelty rates, ecological diversification, perturbation recovery, and explicit energy/entropy fluxes are particularly complementary. Among simulation paradigms, no single approach dominates. **Digital evolution** systems such as Avida provide clean heredity and Darwinian dynamics; **continuous cellular automata** such as Lenia and Flow-Lenia provide rich self-organization and endogenous morphology; **neural cellular automata** provide trainable morphogenesis and regeneration; **agent-based models** provide flexible ecology; **embodied evolutionary robotics** supplies genuine sensorimotor niches; and **artificial chemistries** are best suited to studying autocatalysis, compositional organization, metabolism, and protocell-like closure. Recent results increasingly combine these ideas rather than treating them as competing paradigms. Several developments from 2020–2026 are especially important. Growing Neural Cellular Automata demonstrated learned local rules capable of growth and regeneration; Flow-Lenia introduced mass-conservative continuous cellular dynamics and localized evolvable parameters; Hamon and colleagues used intrinsically motivated/diversity-oriented exploration to discover robust sensorimotor agents in cellular automata; and ASAL used foundation models to automate searches across Boids, Particle Life, Game of Life, Lenia, and neural CA. The 2025 sensorimotor-agency work is particularly significant because it moved beyond visually life-like patterns toward **robust response to external perturbation**, while the 2025 Flow-Lenia study explicitly measured emergent evolutionary dynamics. The persistent bottleneck is **sustained open-endedness**. Classic artificial evolutionary systems readily produce adaptation but often eventually exhaust their effective novelty space. Bedau and colleagues found that artificial systems exhibited continual adaptive phenomena but did not reproduce the long-term cumulative evolutionary activity observed in the biosphere. POET attacked this by evolving problems and solutions together; novelty search and quality-diversity algorithms replace single-objective convergence with continued exploration of behavioral niches; and current systems add resource competition, changing environments, intrinsic motivation, developmental encoding, and multilevel selection. For a new experimental program, my strongest recommendation is a **hybrid Flow-Lenia/particle-world or sparse agent/chemistry substrate with explicit resource and waste flows, mutable developmental rules, endogenous reproduction, local interaction, and evolving niches**. Use QD or intrinsic-goal exploration to bootstrap viable forms, then evaluate prolonged evolution without directly rewarding “complexity.” Measure structured complexity at several scales, test robustness through controlled lesions and environmental changes, reconstruct complete lineages, and compare against neutral, no-mutation, no-ecology, no-energy-cost, and fixed-environment controls. A GPU implementation is strongly preferable for parameter sweeps or QD; ordinary CPU hardware is sufficient for proof-of-concept ABMs and digital-evolution experiments.

The most important methodological warning is this:

> **Do not optimize a complexity metric and then claim that complexity emerged.**

That procedure mostly demonstrates that an optimizer can exploit the metric. A much stronger experiment makes survival, reproduction, resource acquisition, and ecological interaction endogenous, then treats complexity measures as **held-out observables**. Novelty/QD may help initialize or diversify populations, but the decisive evidence should be continued organization and adaptive innovation under constraints the system itself must negotiate. This distinction is consistent with the motivation behind novelty search, POET, evolutionary-activity analysis, and recent work explicitly searching for substrate-independent open-endedness.

## Conceptual foundations: emergence, anti-entropy, autopoiesis, and open-ended evolution

**Emergence.** For simulation purposes, a useful operational definition is: a property is emergent when it is expressed at a collective or higher descriptive scale but is not explicitly encoded as that macro-level behavior in the local update rules. Flocking, morphogenesis, differentiation, self-repair, ecological cycles, and collective computation are examples. Importantly, emergence alone says nothing about whether the structure is adaptive or increasingly complex: a crystal, fixed-point attractor, or repetitive oscillator can be strongly emergent while exhibiting no Darwinian evolution.

Lenia illustrates the distinction exceptionally well. Its continuous local interaction rules can generate persistent localized “creatures,” locomotion, symmetry, self-repair, pattern emission, replication-like behavior, and colonies even though these macroscopic forms are not individually programmed. Yet classic Lenia by itself does not automatically provide an indefinitely evolving hereditary system.

**Anti-entropy and negentropy.** The term requires unusual care. In thermodynamics, an isolated system does not simply drive its entropy downward. Living systems instead maintain highly non-equilibrium states through throughput: free energy and low-entropy resources enter, work and organized processes occur, and heat/waste are expelled. Prigogine's dissipative-structure framework formalized how macroscopic order can be sustained by irreversible processes far from equilibrium. A schematic open-system balance is

System entropy change equals entropy exchanged with the surroundings plus entropy produced internally. Internal entropy production is nonnegative; the system's entropy may fall if export to the environment is large enough.

Internal entropy can locally fall when sufficiently negative entropy exchange overwhelms positive internal entropy production; total entropy production still respects the second law. Modern stochastic-thermodynamics methods can sometimes infer production rates directly from short nonequilibrium trajectories, though this requires a substrate for which states, currents, and thermodynamic quantities have physically meaningful interpretations. Bailly and Longo use **anti-entropy** differently: as a descriptor of biological organization and increasing phenotypic complexity, explicitly intended to characterize organizational dimensions not captured by ordinary entropy alone. It is therefore better treated as an organizational construct than as “minus thermodynamic entropy.” For simulations, I recommend reserving:

- **thermodynamic entropy / entropy production** for physically defined energy-and-matter models;
- **information entropy** for uncertainty or diversity in state distributions;
- **organization/complexity** for structured dependencies, differentiation, hierarchy, predictive memory, functional integration, and evolutionary innovation.

Conflating these is one of the easiest ways to obtain misleading results.

**Autopoiesis.** Varela, Maturana, and Uribe's 1974 formulation characterizes an autopoietic system as a network of processes that continually produces the components that constitute and regenerate the same organizational network and its boundary. Their work also included a computational model. Autopoiesis is therefore a stronger target than persistence: a pattern that passively remains stable is not equivalent to one whose internal processes actively regenerate the organization that makes those processes possible.

Autopoiesis also should not be equated with reproduction. A system may self-maintain without producing descendants; conversely, a replication algorithm can copy itself without metabolically maintaining an individualized organization. For life-like simulation, **self-maintenance, reproduction, heredity, and evolution should be measured separately**.

**Dissipative structures.** A dissipative structure can acquire and maintain order because it exists under sustained nonequilibrium driving. This gives a physically respectable route to apparent “anti-entropic” behavior. But dissipative structure by itself is too weak a definition of life: hurricanes, convection cells, flames, and many chemical oscillations also dissipate energy and self-organize. A life-like simulation needs additional organizational closure, memory/heredity, adaptation, or evolutionary capacity. Prigogine's work supplies the thermodynamic foundation; recent multilevel-evolution theory emphasizes that explaining biological organization requires more than dissipation alone.

**Open-ended evolution (OEE).** OEE research asks how an evolutionary process can continue generating genuinely new forms, functions, niches, organizational scales, or problems instead of merely optimizing within a fixed predefined landscape. The 2016 OEE workshop synthesis emphasized that this remains an unsolved central problem in artificial life. POET later operationalized one important idea: evolve environments and agents together and permit successful solutions to transfer between environmental niches, so the system generates both challenges and stepping stones. The distinction can be represented as:

An organized entity takes in resources, maintains itself, and exports waste. Reproduction introduces heritable variation into a population. The population creates ecological niches and new selection pressures; novel forms can then change the niches again or form new levels of organization.

The last feedback loop is crucial. A conventional evolutionary algorithm has a fixed problem outside the population; a genuinely open-ended system ideally **creates part of its own future problem space** through ecological, developmental, and organizational innovation. POET supplies an engineered example of this principle, while multilevel-evolution theory provides a broader account of how new evolutionary scales can arise. A useful historical trajectory is:

**Selected milestones:** 1974 — computational autopoiesis; 1977 — dissipative structures; 1990s–2004 — digital evolution and Avida; 2011 — novelty search; 2015–2016 — MAP-Elites and modern open-ended-evolution framing; 2019 — POET; 2020 — Growing Neural CA and expanded Lenia; 2025 — Flow-Lenia, sensorimotor agency, and automated ALife search; 2026 — multiscale measures explored in preprints.

The cited foundations for this timeline include Varela et al., Prigogine, Avida, novelty search, MAP-Elites, POET, Lenia/NCA, and recent Flow-Lenia and automated-ALife work.

## Measuring increasing order, complexity, and evolutionary openness

There is no defensible single metric that simultaneously measures thermodynamic order, biological organization, computation, morphological complexity, behavioral sophistication, and open-ended evolution. A rigorous experiment should therefore define a **measurement model before running the simulation**.

| Dimension | Candidate measure | What it detects | Main failure mode |
|---|---|---|---|
| Thermodynamic | Entropy-production rate entropy-production rate | Irreversibility and resource dissipation | Meaningless if “energy” is only an arbitrary score |
| Energetic | Free-energy/resource throughput, work/resource efficiency | Cost of maintenance and reproduction | Can reward inert efficiency |
| Information | Shannon entropy Shannon entropy | State diversity/uncertainty | Random noise scores highly |
| Temporal structure | Predictive information predictive information | Memory and learnable temporal organization | Estimation becomes difficult in high dimensions |
| Statistical structure | Statistical/causal complexity | Information stored in predictive states | Model-estimation dependence |
| Algorithmic | Compression ratio, Lempel–Ziv proxies | Regularity/incompressibility | Noise can appear maximally “complex” |
| Morphological | Components, differentiation, modularity, hierarchy, symmetry-breaking | Internal structural organization | Sensitive to segmentation choices |
| Functional | Number/diversity of functions, task-independent capabilities | Behavioral sophistication | Requires defining “function” |
| Robustness | Recovery after lesion, perturbation tolerance, viability envelope | Active self-maintenance | Static robust attractors can score well |
| Evolutionary | Evolutionary activity, innovation rate, lineage depth, adaptive turnover | Persistent adaptive evolution | Depends on phenotype/genotype classification |
| Ecological | Niche richness, interaction-network complexity, trophic depth | Endogenous ecology | Arbitrary niche discretization |
| Open-ended | Continued rate of novel adaptive classes across expanding scales | Non-plateauing innovation | Any finite observation window can mimic openness |

Shannon entropy is

Shannon entropy: H(X) = −Σₓ p(x) log p(x).

It measures uncertainty, not “organization.” A perfectly random lattice may have high Shannon entropy, whereas a highly structured periodic organism can have lower Shannon entropy. Consequently, simply observing a decrease in Shannon entropy does not establish that biological complexity has increased.

A better temporal-organization measure is **predictive information**,

Predictive information: the mutual information between past and future states.

which asks how much information the past contains about the future. Bialek, Nemenman, and Tishby explicitly developed this as a complexity-related quantity and analyzed how its scaling distinguishes finite-parametric from richer processes. Related statistical-complexity approaches attempt to quantify how much information a process must retain about its past to predict its future. But complexity measures are not interchangeable, and longstanding analysis by Feldman and Crutchfield warns that useful statistical complexity measures must identify structure rather than simply interpolate between “ordered” and “random.” **Compression-based measures** are attractive because they scale to large simulation logs:

Compression ratio ≈ compressed bytes ÷ uncompressed bytes.

They should never be used alone. White noise is difficult to compress but possesses almost none of the organized, adaptive complexity ordinarily meant in artificial life. A useful compromise is to jointly report **compressibility and predictability**: highly organized life-like dynamics tend to occupy a middle region between trivial repetition and independent noise.

For morphology, measure quantities such as:

Structural complexity can be evaluated using the number of component types and modules, hierarchy depth, modularity, interfaces, and functions. Report these separately unless a composite has validated weights.

This is conceptually close to Bailly and Longo's proposal to treat anti-entropy as biological organization/complexification rather than merely inverse entropy. The weights in such a composite are **unspecified unless the experiment defines and validates them**, so reporting the components separately is generally preferable.

For evolutionary systems, Bedau-style **evolutionary activity statistics** are especially relevant because they seek continual adaptive activity rather than raw population diversity. Bedau and colleagues compared artificial evolutionary systems against neutral analogues and concluded that the metrics detected adaptive success, while also finding an important negative result: the artificial systems they studied did not display the biosphere's long-run increase in cumulative evolutionary activity. That historical result is one reason modern OEE research focuses on expanding niches and problem spaces rather than merely faster mutation or larger populations.

For robust agency, controlled perturbation is indispensable. The 2025 Sensorimotor Lenia study used obstacles and other environmental perturbations to distinguish robust, responsive artificial agents from attractive but fragile localized patterns; intrinsically motivated goal exploration produced substantially more such responsive agents than simple random search or earlier hand-search procedures. A good **minimum measurement battery** is therefore:

**Minimum measurement battery:** resource and energy throughput; physically meaningful entropy production; predictive information and entropy rate; morphological differentiation and hierarchy; recovery from perturbation; behavioral repertoire; population and ecological diversity; phylogenetic and evolutionary activity; and innovation relative to neutral controls.

For “anti-entropic” evolution, the strongest evidence would not be a decreasing entropy trace. It would be something closer to:

Organized complexity grows over time.

over a long interval while

Total thermodynamic entropy production remains nonnegative.

with organized complexity increasing across **independent held-out measures**, persistence depending on resource throughput, and equivalent neutral/control systems failing to show the same trend. The first quantity is an informational/organizational observable; the second is the thermodynamic constraint. They should not be conflated. For OEE specifically, I would require evidence for four things simultaneously: continued novelty, continued adaptive relevance, expanding or changing niches/tasks, and no statistically detectable long-term saturation over the tested horizon. That is still evidence for **practical open-endedness over an observation window**, not mathematical proof of unbounded evolution. In any simulator with fixed finite memory and a finite state space, literal unbounded complexity is impossible; eventually the accessible informational capacity is bounded.

## Modeling approaches and mechanisms that promote increasing complexity

The modeling paradigms are best viewed as exposing different ingredients of life.

| Approach | Core representation | Particular strength | Characteristic limitation for OEE | Representative source |
|---|---|---|---|---|
| Agent-based models | Explicit agents with local state/actions | Ecology, social structure, heterogeneous individuals | Agent boundary and ontology often hard-coded | NetLogo/MASON/Repast ecosystems |
| Discrete cellular automata | Local lattice states/rules | Emergence from minimal local physics | Heredity and evolvability difficult without added mechanism | Autopoiesis and CA tradition |
| Continuous CA | Continuous fields and kernels | Rich spontaneous morphology and locomotion | Classic global rules do not automatically localize heredity | Lenia/Flow-Lenia |
| Digital evolution / evolutionary algorithms | Genomes/programs plus variation and selection | Clean heredity, phylogeny, replicator evolution | Fixed fitness landscapes and instruction sets can cause saturation | Avida; ECJ |
| Neural cellular automata | Learned local neural update rule | Morphogenesis, regeneration, differentiability | Training objective normally specifies desired morphology | Growing NCA |
| Neuromorphic/spiking systems | Event-driven neurons/synapses | Local computation, temporal dynamics, plausible energy costs | Usually controller-centric rather than autonomous evolving ecology | Architecture must be paired with evolutionary substrate |
| Embodied/evolutionary robotics | Body + controller + physics | Sensorimotor niches and morphology–control coupling | Expensive evaluation; simulator exploits; physical transfer | MAP-Elites demonstrated QD in simulated/real soft-robot domains |
| Artificial chemistry | Molecules/reaction networks/reaction–diffusion | Metabolism, autocatalysis, compositional heredity | Difficult genotype–phenotype identification and scaling | Closely aligned with autopoietic and nonequilibrium framing |
| Hybrid ecological ALife | CA/particles + genomes + energy + learning + ecology | Can combine emergence, heredity, metabolism, and niches | Highest implementation and analysis complexity | Flow-Lenia points toward this direction |

**Agent-based models** are ideal when organisms, groups, resources, and spatial ecology are already meaningful model objects. Their weakness is ontological: if the programmer creates an `Organism` class with a fixed nervous system, genome layout, reproduction method, and set of behaviors, many of the interesting organizational transitions are impossible by construction.

For anti-entropic/OEE research, a better ABM makes as much structure as possible *evolvable*: variable-length genomes, mutable interaction networks, changing group membership, externalized constructions, persistent environmental modifications, and resource-dependent costs.

**Cellular automata and continuous cellular automata** move in the opposite direction. They make the low-level substrate primary and let “organisms” emerge as patterns. Lenia is a continuous generalization of Game-of-Life-like dynamics and has produced hundreds of localized forms with locomotion, symmetry, self-repair, and other life-like behavior. Flow-Lenia adds mass conservation and, importantly, allows rule parameters defining emerging forms to become localized in the dynamical substrate, enabling multispecies interactions and evolutionary dynamics. That localization step matters conceptually: if a mutation changes a global simulator parameter, it changes the “laws of physics” for every individual. For Darwinian evolution, hereditary information needs to be associated with a lineage or localized structure rather than globally imposed.

**Evolutionary algorithms and digital evolution** solve heredity cleanly. Avida consists of self-replicating digital organisms whose instruction sequences mutate and compete; it has long been used to investigate evolution computationally. The open-source Avida distribution is C++ based and includes testing/documentation infrastructure. Its conceptual limitation—and that of most conventional evolutionary algorithms—is that a fixed genotype language plus a fixed objective/environment provides a finite collection of obvious adaptive opportunities.

**Neural cellular automata** replace hand-designed transition rules with differentiable local neural updates. Growing Neural Cellular Automata trained local update functions that can grow a desired pattern from a seed and regenerate it after damage. This is an excellent architecture for self-repair and development, but the original approach is not open-ended evolution: the target morphology and loss function come from the experimenter. A promising next step is to evolve NCA developmental programs in an ecosystem rather than train each one toward a specified target.

**Embodiment** adds a qualitatively useful source of novelty. Bodies change what can be sensed and done; altered behavior modifies encountered environments; environmental effects change future selection. This feedback is one reason QD methods have been successful in evolutionary robotics. MAP-Elites was demonstrated across domains including modular networks and simulated/physical soft-robot design and explicitly stores many high-performing solutions distributed across behavioral descriptors. **Artificial chemistry** is arguably the most natural model class if the goal is autopoiesis rather than animal-like agency. Molecules, catalysts, membranes, reaction cycles, and resource gradients can generate organizational closure without a hard-coded “organism object.” Its principal research challenge is establishing robust heredity and evolutionary individuality: reaction networks readily self-organize, but determining what counts as an individual, genome, offspring, or lineage may itself be part of the phenomenon.

The main mechanisms for preventing premature evolutionary stagnation are complementary rather than mutually exclusive.

**Novelty search.** Lehman and Stanley replaced objective fitness with behavioral novelty and demonstrated that objective-free search can find solutions that deceptive objective optimization misses. It helps avoid convergence, but novelty by itself can generate endless behavioral variation with little adaptive structure.

**Quality diversity.** MAP-Elites and related QD algorithms retain high-performing representatives throughout a behavioral feature space, producing an archive rather than one optimum. This is often a better bootstrap mechanism for ALife than a single “complexity fitness.”

**Differentiable QD** can exploit gradients when the simulator and descriptors are differentiable; MEGA, for example, brought first-order information into QD search. **Intrinsic motivation / goal exploration.** Instead of specifying every goal, let the learner generate goals or seek regions of behavioral space where competence or novelty is changing. The Sensorimotor Lenia work is a concrete modern demonstration: an intrinsically motivated goal-exploration process found localized, moving, obstacle-responsive CA agents more effectively than simple random or traditional manual searches. **Environment–agent coevolution.** POET generates environmental challenges while optimizing solutions to them and transfers solutions across environments. Its experiments found sophisticated solutions to environmental challenges that direct optimization or a direct curriculum control did not solve, illustrating the role of serendipitous stepping stones. **Energy/resource constraints.** Make sensing, computation, motion, maintenance, construction, and reproduction consume locally obtained resources. Include waste or resource transformation. This can turn “survival” from an arbitrary reward into an emergent consequence of maintaining resource balance. Flow-Lenia's explicit mass conservation is an important move in this direction, though mass conservation alone is not a full thermodynamic metabolism. **Niche construction.** Let entities persistently alter their world: excavate, deposit material, secrete signals, change chemical gradients, construct shelters, or redistribute resources. Then organismal innovations create future environmental states, producing endogenous selection pressure instead of a fixed benchmark.

**Multilevel selection.** Permit collections of lower-level entities to acquire differential persistence or reproduction as wholes. Group-level bottlenecks, resource sharing, division of labor, policing, and conflict create the possibility of major transitions in individuality. A recent theoretical synthesis frames evolution as multilevel learning and highlights the importance of selection operating at distinct scales. The most promising practical recipe is therefore:

**Ingredients to combine:** local physics, resource constraints, heredity, development, ecology, niche construction, and variation at multiple organizational levels.

with novelty/QD/intrinsic motivation used primarily to **expand the reachable repertoire**, rather than to define what “life” must look like.

## Software platforms and engineering choices

The following comparison reflects project documentation and research use as of September 24, 2026. “OEE suitability” is **my analytical rating**, not a claim by the project maintainers. It asks how naturally the framework supports hereditary variation, endogenous ecology, changing behavioral niches, and very long experiments without extensive architectural replacement.

| Platform | Primary paradigm | Languages / implementation | Scaling model | OEE suitability | Best use in this research program | Sources |
|---|---|---|---|---|---|---|
| **NetLogo** | General ABM | NetLogo language; JVM/Scala implementation | Desktop-oriented; excellent interactive model iteration | **Low–Medium** | Rapid ecological prototypes, teaching, validation of local rules | Official NetLogo project and code |
| **MASON** | High-performance discrete-event ABM | Java | Efficient single-machine/JVM simulation; custom visualization | **Medium** | Long custom ecological ABMs with fine implementation control | George Mason MASON project/repository |
| **Repast Simphony / HPC / Repast4Py** | ABM family | Java; C++ HPC; Python-oriented Repast4Py | Workstation through parallel/HPC variants | **Medium–High** | Large spatial ecosystems and distributed population models | Official Repast documentation |
| **FLAME GPU 2** | GPU ABM | C++/CUDA ecosystem | GPU-parallel, designed for large agent populations | **High** | Massive populations, spatial ecology, evolutionary sweeps | Official FLAME GPU project and software publication |
| **ECJ** | Evolutionary computation | Java | Population/evaluation parallelism; highly configurable evolutionary operators | **Medium** | Genotype evolution, genetic programming, coevolution; pair with an ecological simulator | George Mason evolutionary-computation ecosystem |
| **Avida** | Digital evolution | C++ | Efficient digital-organism populations | **High for Darwinian evolution** | Clean heredity, lineage tracking, evolution of computation | Open-source Avida distribution; canonical Avida description |
| **Lenia** | Continuous CA | Official implementations include Python, R, Jupyter, MATLAB, JavaScript; GPU variants exist | Vectorizable/FFT/GPU friendly | **Medium–High** | Emergent morphology and spontaneous spatial organization | Official Lenia project/code page |
| **Flow-Lenia** | Mass-conservative continuous CA | Research implementation; exact canonical production stack is **unspecified here** | Naturally GPU/vectorization friendly | **High experimental potential** | Localized mutable rules, multispecies morphogenesis, endogenous evolutionary dynamics | 2025 Artificial Life study |
| **OpenWorm** | Multiscale biological simulation | Python-centric ecosystem plus NeuroML/LEMS and visualization infrastructure | Computationally intensive biophysical simulation | **Low for OEE; High for biological fidelity** | Validation against a real organism; nervous-system/body integration | OpenWorm project, repositories, foundational paper |
| **Morphognosis** | Hierarchical spatiotemporal learning / CA worlds | Java in key public projects | Small-to-medium experimental simulations | **Low** | Studying context, compositional behavior, foraging, nest building | Original model and open projects |
| **Neural CA implementations** | Differentiable self-organizing systems | Commonly Python/JAX/PyTorch/TensorFlow | GPU-friendly | **Medium–High if evolution is added** | Regeneration, developmental encoding, differentiable morphogenesis | Growing NCA |
| **POET-style custom systems** | Environment–agent coevolution | Research-specific | Embarrassingly parallel across environments/agents | **High conceptually** | Expanding curricula/niches rather than fixed fitness landscapes | POET |

A few distinctions matter more than raw performance.

**NetLogo** is often the best place to falsify an idea cheaply. Its weakness is not scientific validity but scale and architectural flexibility. A model that cannot exhibit OEE in NetLogo because its ontology is too fixed will not become open-ended merely by moving to a GPU.

**MASON and Repast** are better choices when individual agents and ecological objects are meaningful from the beginning. MASON emphasizes a relatively lean Java simulation library; Repast provides multiple frameworks, including versions targeting HPC and Python workflows. **FLAME GPU 2** is attractive when the research question demands hundreds of thousands or more independently updated agent-like entities or enormous evolutionary parameter sweeps. Its architecture exposes GPU-native agent populations, communication, and birth/death mechanisms, making it significantly better aligned with population-scale experimental ALife than a general desktop ABM environment. **ECJ** is a search/evolution framework rather than an ecology. That is an important distinction. It is useful for evolving controllers, morphology parameters, developmental programs, genetic programs, or ecosystem rules, but an OEE experiment normally needs to embed ECJ-like evolutionary machinery into a simulator whose ecological opportunities themselves can change.

**OpenWorm** addresses a different question entirely: how much of a real organism, *C. elegans*, can be reproduced through multiscale computational modeling? The project is valuable as a reality check for embodiment and nervous-system/body coupling, but it is not designed primarily as an open-ended evolution engine. **Morphognosis** is similarly easy to misclassify. It is a hierarchical representation of spatial and temporal contexts used in simulated behavior-learning problems; public examples include foraging, bee cooperation, pufferfish nest-building, and related tasks. It is interesting for memory and modular behavioral learning but is not itself a platform for unrestricted artificial evolution. **Lenia/Flow-Lenia currently provides one of the most interesting research substrates for the user's specific goal.** It begins below the organism level, produces localized life-like structures spontaneously, is highly parallelizable, and Flow-Lenia introduces conservation and localized parameters that reduce the gap between emergence and Darwinian individuality. The 2025 journal study explicitly used evolutionary-activity and other metrics to analyze its emergent evolutionary dynamics.

## Representative empirical research, from seminal systems to the 2026 frontier

The recent literature has shifted from producing visually intriguing patterns toward **agency, robustness, endogenous evolution, automated discovery, and open-ended search**.

| Work | Method | Main finding relevant here | Data / artifacts | Code availability |
|---|---|---|---|---|
| **Varela, Maturana & Uribe, 1974 — Autopoiesis** | Computational organization of component-production processes | Demonstrated that autopoietic organization could be given a formal/computational treatment | Simulation-generated | Modern repository status not applicable/unspecified | |
| **Ofria & Wilke / Avida, 2004** | Populations of mutable self-replicating digital programs | Established a versatile experimental system for digital Darwinian evolution | Simulation populations and genomes | **Yes**, open Avida repository | |
| **Lehman & Stanley, 2011 — Novelty Search** | Select behavioral novelty instead of objective performance | Novelty search can escape deceptive objective landscapes and find solutions without explicit objective pressure | Simulation-generated behaviors | Original-paper implementation status not verified here | |
| **Mouret & Clune, 2015 — MAP-Elites** | Archive elite solutions over user-defined behavioral dimensions | Produces diverse high-performing repertoires and illuminates reachable behavior space | Generated archives; several demonstration domains | Implementations widely exist; archival code for original experiments **not verified here** | |
| **Wang et al., 2019 — POET** | Coevolve environments and solutions; transfer agents among environments | Generated challenging environments and solutions not reached by direct optimization/control curricula | Procedurally generated environments and policies | Exact archival code status **unspecified here** | |
| **Mordvintsev et al., 2020 — Growing Neural CA** | Differentiable local neural rule trained for morphogenesis | Local learned interactions can grow and regenerate target forms after damage | Interactive generated trajectories | **Yes/interactive implementation available through the publication ecosystem** | |
| **Chan, 2020 — Expanded Lenia** | Continuous CA exploration | Large space of persistent, moving, replicating, communicating, and polymorphic structures | Species/configuration collections | **Yes**, official multi-language repository | |
| **Plantec et al., 2025 — Flow-Lenia** | Mass-conservative continuous CA; localized rule parameters; evolutionary-activity analysis | Produced complex localized patterns, multispecies configurations, and measurable emergent evolutionary dynamics | Simulation-generated trajectories/species | Exact archival package from sources reviewed: **unspecified** | |
| **Hamon et al., 2025 — Sensorimotor Agency** | Diversity search / intrinsically motivated goal exploration in Flow-Lenia-like CA; obstacle perturbations | Discovered robust moving agents responsive to perturbations; IMGEP substantially outperformed random/hand-search baselines on agency-related tests | Agent parameters, videos, perturbation tests | **Yes; paper states experimental code/results are reproducible and companion resources are provided** | |
| **Kumar et al., 2025 — ASAL** | Vision-language/foundation models search ALife substrates by target phenomena, novelty, and diversity | Automated discovery across Boids, Particle Life, Game of Life, Lenia and NCA; found new Lenia/Boids forms and open-ended-like CA behavior | Generated simulations and model-scored embeddings | **Yes**, project site and `SakanaAI/asal` project are identified | |
| **Multi-Scale Path Divergence, 2026** | Proposed cross-scale trajectory-divergence objective/measure for directing OEE | Reports higher held-out complexity and transfer across artificial-life substrates | Simulation-generated | Status **unspecified from sources reviewed** | **Preprint; not yet equivalent to peer-reviewed evidence** |

Several lessons emerge.

First, **self-repair is becoming experimentally separable from merely stable appearance**. NCA work trains forms to regenerate following damage, while the Sensorimotor Lenia work explicitly challenges patterns with obstacles and out-of-distribution perturbations. Second, **conservation laws help**. Flow-Lenia's mass conservation removes one common pathology of continuous CA—unbounded spontaneous growth or disappearance of “mass”—and localized parameters make it possible for distinct forms to carry different effective rules within a shared world. It still should not be interpreted as a complete physical thermodynamic model: a conserved scalar field is not automatically chemical free energy, temperature, or entropy.

Third, **search algorithms increasingly operate over the space of possible artificial worlds rather than only organism parameters**. POET evolves environmental niches; ASAL uses foundation-model representations to search for interesting simulations across multiple substrates. This is a major conceptual shift from classical optimization.

Fourth, foundation models are potentially powerful scientific instruments but introduce a new confound. If a pretrained visual-language model is used to judge novelty or “interestingness,” part of the effective objective comes from human-generated training data embedded in that model. ASAL deliberately uses this human-aligned prior. That is useful for discovery, but an experiment seeking **intrinsic** emergence should separately report FM-scored novelty and substrate-native complexity metrics. Fifth, recent work does not resolve the classic OEE problem. Bedau's older comparison remains sobering: sustained cumulative adaptive activity characteristic of biological history was not reproduced by the then-existing artificial evolutionary systems. Recent systems make meaningful progress on particular pieces—morphogenesis, robust agency, ecological challenge generation, and automated novelty search—but **no current mainstream simulator has demonstrated an experimentally uncontested equivalent of the biosphere's indefinitely expanding organizational complexity**.

## Evaluation, reproducibility, safety, and a practical experimental program

A credible evaluation should treat “increasing complexity” as a scientific hypothesis with controls, rather than as a visual judgment.

**Benchmark structure.** There is no universally accepted OEE benchmark comparable to ImageNet or standard reinforcement-learning suites; indeed, OEE is partly about escaping a fixed benchmark. Taylor and colleagues' OEE synthesis and subsequent POET work make clear why open-endedness is more naturally assessed through continuing novelty and expanding challenges than a single terminal task score. A useful experimental battery should therefore test the following properties jointly:

| Test | Experimental intervention | Primary readout |
|---|---|---|
| Persistence | Normal environment | Viability/lifetime distribution |
| Active maintenance | Stop resource input or metabolic processes | Difference from ordinary intact dynamics |
| Regeneration | Lesion/remove 10–50% of structure | Recovery probability/time |
| Environmental robustness | Temperature/resource/obstacle shifts | Viability envelope and behavioral adaptation |
| Reproduction | Observe without explicit reproduction command if possible | Parent–offspring identification, fidelity |
| Heredity | Mutation/lineage analysis | Trait parent–offspring mutual information |
| Evolvability | Controlled mutation experiment | Distribution of viable/novel descendants |
| Ecological diversification | Shared limited resources | Persistent niches/species/interactions |
| Open-ended novelty | Very long uninterrupted run | Novel adaptive class arrival rate |
| Complexity growth | Time series across multiple metrics | Slope/change point of structured complexity |
| Multilevel organization | Permit group persistence/reproduction | New stable selection levels |
| Thermodynamic consistency | Resource/energy accounting | Input, stored free energy, work, dissipation/waste |

The crucial controls are equally important. Run an identical world with mutations disabled; a neutral-selection version; a version without resource gradients; a fixed-environment version; a no-niche-construction version; and, where possible, randomized or temporally shuffled trajectories. Bedau's use of selectively neutral analogues is an important precedent for separating genuine adaptive activity from activity produced by baseline dynamics. **Do not classify species only by genome identity.** In developmental systems, small genomic changes can produce major phenotype changes and distinct genomes can converge phenotypically. Maintain at least three identifiers:

Record genotype, phenotype, and behavioral or ecological role together.

This also lets you distinguish increasing genomic length from genuine functional differentiation.

**Record complete lineage information.** For each birth event, store parent IDs, child ID, mutation events, local environmental state, resource holdings, and phenotype descriptors. This supports phylogenetic depth, diversification-rate, lineage-survival, and major-transition analyses that cannot be reconstructed reliably from occasional population snapshots.

**Longitudinal analysis matters more than final score.** For metric complexity over time, estimate not merely

A final complexity value at time T.

but its slope, saturation behavior, innovation intervals, and dependence on observation scale. A practical model comparison is:

A linear growth model for complexity over time.

versus a saturating alternative such as

A saturating growth model in which complexity approaches a finite ceiling.

A system that initially becomes complex and then asymptotes is interesting self-organization but weaker evidence of OEE than one whose held-out measures continue acquiring new scales or structures.

**Use multiple independent complexity measures and reserve some from optimization.** At least one-third of key evaluation measures should ideally be completely absent from the search objective. This is the equivalent of a test set: if MAP-Elites is explicitly filling morphology bins, morphological-bin coverage cannot simultaneously serve as independent evidence that the system spontaneously evolves increasing morphological diversity.

**Archive the complete computational environment.** At minimum, preserve source-control commit, simulator configuration, compiler/interpreter version, dependency lockfile, random seeds, hardware type, deterministic/non-deterministic GPU settings, initial conditions, objective/descriptor definitions, checkpoints, event logs, analysis code, and exact plotting scripts. Avida's source distribution includes testing infrastructure, while modern projects such as Sensorimotor Lenia explicitly provide code/resources intended to reproduce their experiments; these are the standards worth emulating. For very long OEE runs, avoid storing every complete lattice. Store periodic checkpoints plus an event log and compressed metric streams; save high-frequency windows around reproduction, extinction, innovations, major lesions, and detected phase transitions. Full-state snapshots can be adaptively retained for newly classified morphotypes.

**Recommended compute stack.** These are engineering recommendations, not requirements from the cited projects:

| Scale | Suggested hardware | Suitable experiments |
|---|---|---|
| Prototype | 8–16 modern CPU cores, 32–64 GB RAM | NetLogo/MASON, small CA, artificial chemistry |
| Serious single-node | 24–64 CPU cores, 128 GB RAM plus 16–24+ GB VRAM GPU | Flow-Lenia, NCA, moderate QD |
| High-throughput | 1–8 datacenter GPUs plus high-core-count CPU node | Thousands of parallel morphogenesis/QD evaluations |
| Large ecology/OEE campaign | Cluster with distributed jobs, high-capacity object storage | Hundreds of independent long runs / extensive ablations |

For CA/NCA work, GPU acceleration usually gives the highest return because update rules are spatially parallel. For complex agent logic with sparse interactions, multicore CPU simulation can be competitive. FLAME GPU is attractive where the entities map naturally to GPU agents, while Repast's HPC family is a better fit for explicitly distributed agent models. **A practical first experiment.** I would implement a two-dimensional world containing three coupled fields:

R(x, y, t): usable resource at a location and time.

B(x, y, t): organism or material mass at a location and time.

W(x, y, t): waste or degraded resource at a location and time.

Allow local reactions such as

Resource + biomass → additional biomass + waste, when catalyzed by a local rule. This schematic reaction needs a separately specified material and energy budget.

only when a local developmental/controller rule catalyzes them. Make the controller parameters spatially localized and heritable rather than global. Require maintenance costs; allow mass redistribution and motility; introduce slow external resource inflow and waste removal; and make reproduction a dynamical consequence of growth/fission rather than a simulator-level `reproduce()` method.

This borrows Flow-Lenia's emphasis on conservation/localized parameters while adding a more explicit resource/waste distinction. It would still be an abstract chemistry unless rates and energies were physically calibrated, so any “entropy” measured from it should initially be described as **information-theoretic or resource-accounting entropy**, not literal thermodynamic entropy.

Run the experiment in two phases. During **bootstrap**, use QD or intrinsically motivated goal exploration to discover viable self-maintaining forms, following the logic of MAP-Elites and Sensorimotor Lenia. During **ecological evolution**, remove explicit complexity/novelty rewards. Entities survive, reproduce, compete, cooperate, and alter niches based only on endogenous resource flows. This separation makes later complexity growth scientifically much more persuasive.

A reasonable primary endpoint would be:

Track a vector of predictive, structural, ecological, and phylogenetic complexity, plus innovation rate, at each point in time. Keep the measures separate.

rather than collapsing everything into one scalar. Test whether these dimensions trend upward beyond neutral/control trajectories while viability and resource budgets remain physically coherent.

A particularly strong positive result would look like this sequence:

Autocatalytic pattern → bounded self-maintaining entity → reproducing lineage → differentiated organism → ecological specialization → cooperative collective → a new reproducing individual at a higher level.

The last transition—the emergence of a higher-level reproducing unit—is much stronger evidence of increasing organizational complexity than simply evolving a larger neural network. Multilevel-evolution theory specifically motivates looking for changes in the scale at which selection and learning become organized.

**Safety and ethics.** Purely sandboxed cellular automata and digital organisms pose little direct biological hazard, but open-ended systems introduce risks that ordinary fixed-task simulations do not. An evolving process can discover unintended computational strategies, consume uncontrolled resources, exploit simulator bugs, or—if connected to external systems—turn environmental feedback into real-world actions. Accordingly, OEE experiments should have no production credentials, no unrestricted network access, strict process/container limits, storage and compute quotas, immutable experiment configurations, audit logs, and a host-level termination mechanism outside the evolving substrate.

For embodied/robotic experiments, separate simulation from deployment. Physical evaluation should add force, velocity, power, workspace, and collision limits that evolving controllers cannot modify. The fact that an agent evolved safely in simulation is not evidence that its out-of-distribution physical behavior is safe.

There is also a less immediate but serious ethical issue: sufficiently elaborate artificial life may eventually raise questions of moral status. Witkowski and Schwitzgebel's 2024 *Artificial Life* paper argues that researchers should at least consider whether future artificial-life entities could become morally considerable, including possibilities not reducible to conventional human-like consciousness. Nothing in present Lenia, Avida, NCA, or comparable systems establishes sentience, and visual life-likeness is not evidence of subjective experience. The appropriate current practice is therefore neither to assert consciousness nor to assume indefinitely that moral status is impossible.

The same caution applies to foundation-model judges. ASAL demonstrates that pretrained models can accelerate discovery of novel simulations, but such models should not be allowed to become an unexamined oracle for “life,” “complexity,” “agency,” or ethical status.

## Open problems and research priorities

The deepest unsolved problem is **how to make the space of possibilities itself expand**. An evolutionary algorithm can explore a vast fixed genome space for an extremely long time without ever undergoing the sort of qualitative transitions seen in biological evolution. POET partly addresses this by expanding environments; Flow-Lenia partly addresses it by making localized rules part of the dynamics; multilevel selection can potentially create new individuals; but a general mechanism that reliably produces indefinite major innovations remains unknown. A second problem is the **emergence of evolutionary individuality**. Most simulators decide in advance what reproduces. The stronger experiment is one in which boundaries, parenthood, individuality, and perhaps even the unit of selection must be inferred from the dynamics. Autopoiesis supplies the conceptual starting point, while Flow-Lenia's localized patterns offer a promising computational substrate. Third is **thermodynamic realism without destroying tractability**. Many ALife systems call a scalar variable “energy,” subtract a movement cost, and then invoke thermodynamic language. That is adequate for an ecological budget but insufficient for claims about entropy production. Genuine thermodynamic interpretation requires explicit reservoirs, transition probabilities or physical dynamics, energy states, and identifiable irreversible currents of the type studied by stochastic thermodynamics. A useful near-term compromise is to distinguish clearly between abstract metabolic resource accounting and physically calibrated thermodynamics.

Fourth is the **complexity-measure problem**. Shannon entropy rewards disorder; compression rewards incompressibility; behavioral counts depend on chosen descriptors; network complexity can be inflated by useless structure; foundation-model novelty inherits human priors. Predictive information helps but is difficult to estimate at high dimensions. There is therefore no metric immune to gaming. Progress probably requires metric ensembles plus adversarial controls rather than discovering a magical universal scalar.

Fifth is **scale selection**. A life-like process can be trivial at the cell scale and extraordinarily structured at the organism scale, or vice versa. Recent 2026 work on multi-scale path divergence explicitly targets this issue by measuring divergence across scales and reports encouraging results on held-out complexity and cross-substrate transfer, but as of September 24, 2026 this work should be treated as a research frontier rather than established consensus. Sixth is **the origin of evolvability itself**. It is not enough that mutations occur; successful systems need developmental organizations in which mutation produces a useful distribution of phenotypic variation. Modularity, duplication, neutral variation, developmental reuse, and genotype–phenotype degeneracy may matter more in the long run than mutation rate alone. QD helps discover evolvable regions of a search space, but it does not by itself explain how biological systems evolve architectures that continue producing useful novelty. Seventh is **ecological closure**. Most artificial-life worlds still contain externally replenished “food” and externally defined tasks. A substantially stronger system would evolve producers, consumers, decomposers, signaling relationships, and resource recycling so that niches are created by other organisms. Such closure would turn niche construction from a secondary effect into the engine of continuing evolution.

Eighth is **reproducibility under extreme path dependence**. OEE experiments may involve millions or billions of stochastic events before a rare innovation transforms the trajectory. A single spectacular movie is therefore weak evidence. The correct unit of evidence is an ensemble of independent histories with lineage archives, predeclared metrics, ablations, neutral controls, and transparent analysis. Bedau's neutral-system comparisons and the recent provision of reproducible Sensorimotor Lenia artifacts offer useful precedents. The field's most promising near-term objective is consequently **not “create a simulator whose entropy always decreases.”** It is:

**Research target:** Build an open, resource-driven world in which localized entities must maintain themselves, reproduce with heritable variation, alter their niches, and sometimes form new levels of organization. Demonstrate sustained growth across several independent measures of adaptive complexity while respecting the model's global resource constraints.

Current results show that the ingredients are increasingly available: autopoietic conceptual models, dissipative thermodynamics, digital heredity, Lenia-class spontaneous morphogenesis, NCA regeneration, Flow-Lenia conservation and localized parameters, novelty/QD exploration, POET-style environment generation, intrinsic-goal discovery of robust sensorimotor agents, and automated ALife search with foundation models. What remains unsolved—and therefore scientifically most valuable—is getting these mechanisms to **bootstrap one another indefinitely rather than merely coexist in a sophisticated but ultimately bounded simulator**.
