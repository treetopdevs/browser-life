# How the MLST "Evolution" Episode's Papers Apply to Browser Life (Cadence Garden)

Saved 2026-10-31. The research summary below is the user's, kept as written. Two dated sections follow it: what a repo check corrected, and a brainstorm for doing it here.

---

The best use of this episode for Browser Life is to add ASAL's foundation-model observer as a pre-registered open-endedness signal, and to make the existing MAP-Elites search compete against past champions in the Digital Red Queen style. Both add new measuring and selection on top of the verified-replay archipelago you already run, without changing the integer physics. Most of the other papers are better treated as inspiration than as a build list.

## TL;DR
- **Episode:** Machine Learning Street Talk (MLST), "What Most People Get Wrong About Evolution | Akarsh Kumar", released 10 Oct 2026 (about 48 min). The show notes link nine papers. ASAL (FM-scored search over simulation spaces) and Digital Red Queen (LLM-mutated, MAP-Elites, self-play evolution) are the two that map most directly onto Browser Life.
- **Browser Life today:** a public WebGPU ALife ecology with exact integer physics, a CPU reference, and a Phoenix "archipelago" coordinator that hands segments to volunteer islands and replay-verifies them. It already ships MAP-Elites (packages/search), an anomaly "bell", a rule-based naturalist proposer and pre-registered experiments. Its registered open-endedness results are labelled **Negative**, and its bell and clade instruments have struggled to separate signal from neutral drift. Measurement is the bottleneck, and that is exactly the gap ASAL addresses.
- **Do first:** (1) an ASAL-style CLIP novelty signal, calibrated against your neutral null corpus before anyone trusts it; (2) FM-embedding descriptors plus hall-of-fame (Red Queen) evaluation in packages/search, distributed over islands; (3) an LLM-as-mutation arm for the naturalist proposer, run through Jido and gated by your existing replay verifier and "yes" approvals. Defer AutoML-Zero-style rule search and the FER-style representation analysis.

## Key Findings

### (a) Episode summary
- **Identification:** Spotify episode 1SZrP6xScEnK6p0imqgfOC is MLST's "What Most People Get Wrong About Evolution | Akarsh Kumar", released 2026-10-10. Spotify did not render the show notes, so they were taken from the full Apple Podcasts listing.
- **Guest and framing:** Kumar is an MIT PhD student working with Phillip Isola, works with Sakana AI, and is first author of the Fractured Entangled Representation paper. The core claim: evolution is not random search. "Selection hangs on to partial solutions, so mutations only need to be useful about 1% of the time for the search to keep making progress."
- **ASAL:** most of the conversation covers ASAL. Instead of predicting what a rule will do, ASAL "runs the simulation and asks a foundation model what happened". Across all 262,144 Life-like rules, "the most interesting worlds sit on one small island."
- **Other topics:** Game of Life, Lenia, neural cellular automata, Boids, Particle Life, path-dependent learning ("the path a learner takes may shape the structure of what it learns"), computational irreducibility, and Core War with LLMs as the mutation step.
- **Kumar on LLM autonomy:** he says plainly that when LLMs run autonomously, "nothing interesting happens". Evolution with a verifier in the loop is what makes them productive.

### (b) Papers linked in the show notes

| # | Paper (link) | Core problem → method | Key results | Limitations | Code/data |
|---|---|---|---|---|---|
| 1 | **ASAL**: Automating the Search for Artificial Life with Foundation Models (arxiv.org/abs/2412.17799) | Hand-designing ALife rules is trial and error. ASAL runs a parameterised substrate, renders frames, embeds them with a vision-language FM (CLIP), and searches three ways: a supervised text target; open-endedness (low historical nearest-neighbour similarity over time); and illumination (a diverse set, each far from its nearest neighbour). | New Lenia and Boids lifeforms; Life-like CA rules more open-ended than Conway's. Game of Life ranks in the top 5% of Life-like CAs by its OE score. The most open-ended CAs cluster on "a small island" in a UMAP of CLIP space. Historical NN novelty beat variance-based novelty. | Substrate must be renderable as an image. "Interesting" means interesting to a human-like FM observer, which is a proxy. Not a mechanistic theory. | github.com/SakanaAI/asal (JAX) |
| 2 | **Digital Red Queen**: Adversarial Program Evolution in Core War with LLMs (arxiv.org/abs/2601.03335) | Most LLM-evolution targets are static. DRQ evolves Redcode "warriors" in rounds, each against all previous champions. The LLM (GPT-4.1 mini) is the mutation operator; MAP-Elites runs within each round on (threads spawned, memory coverage). | Static one-round optimisation: per DRQ §4.1, the specialist set "can collectively defeat 89.1% of human warriors and defeat or tie 96.3%" (a zero-shot LLM warrior beats only 1.7%). But per the paper's Fig. 2, "on average, an evolved warrior can defeat or tie only 27.9% of all human warriors". Across 96 independent runs, full DRQ makes warriors more general while phenotype variance falls and "the variance of genotypes across runs remains approximately constant" (convergent evolution); moving from K=1 to full history gave "a 77% reduction in the total number of cycles". Per DRQ §4.5, swapping in a single-cell variant of MAP-Elites "significantly reduces optimization performance in each round", "especially in later rounds". A linear probe on code embeddings predicts generality with test R² = 0.461 (text-embedding-3-large; 0.442 with -small). | Core War only; two hand-chosen descriptors; generality measured against a fixed human set. | github.com/SakanaAI/drq |
| 3 | **Fractured Entangled Representation (FER) hypothesis** (arxiv.org/abs/2505.11581) | Does better performance imply better representations? Compares Picbreeder-evolved CPPNs with SGD-trained CPPNs that produce the same image. | Same outputs, very different internals. SGD nets show FER; evolved nets approach a "unified factored representation". Weight sweeps on evolved nets give semantic edits; on SGD nets they give chaotic distortions. | Position paper; tiny single-image networks; the link to large-model capability is hypothesised. | github.com/akarshkumar0101/fer (per secondary summary) |
| 4 | **Lenia: Biology of Artificial Life** (arxiv.org/abs/1812.05433) | A continuous space-time-state CA. | "More than 400 species in 18 families", many found by interactive evolution. Patterns are geometric, metameric, resilient and adaptive; a taxonomy is mapped over parameter space. | Mostly descriptive; species found by hand or interactively. | Lenia code (author's) |
| 5 | **Growing Neural Cellular Automata** (distill.pub/2020/growing-ca) | Learn a local update rule that grows a target image from one cell. | With damage in the training distribution, regeneration emerges without being explicitly rewarded. | Target-image objective; differentiable substrate. | Colab/notebooks on Distill |
| 6 | **MAP-Elites**: Illuminating search spaces by mapping elites (arxiv.org/abs/1504.04909) | Keep the best solution per cell of user-chosen behaviour dimensions, rather than one optimum. | Returns diverse high performers and often a better global best than objective-only search. | Descriptor choice is manual and decisive. | Many implementations |
| 7 | **AlphaEvolve** (arxiv.org/abs/2506.13131) | LLM ensemble edits code, automated evaluators score it, evolutionary loop. | Data-centre scheduling, hardware circuit simplification; 4×4 complex matrix multiplication in 48 scalar multiplications. | Needs a cheap, trustworthy automated evaluator; proprietary system. | White paper only |
| 8 | **AutoML-Zero** (arxiv.org/abs/2003.03384) | Evolve whole ML algorithms from basic math ops. | Rediscovers backprop-trained 2-layer nets; dropout-like tricks appear when data is scarce. | Huge compute; tiny tasks. | google-research repo |
| 9 | **Assembly theory** (nature.com/articles/s41586-023-06600-9) | Quantify selection by an object's minimal construction history (assembly index × copy number). | A framework for detecting selection and evolution from object abundance and complexity. | Disputed: Abrahão, Zenil et al. (PLOS Complex Systems, 2024) argue it "is an approximation to algorithmic complexity based on LZ compression that does not explain selection or evolution", and Jaeger (2024) makes a similar case. Designed for molecules, not CA states. | n/a |

The notes also cite Stanley & Lehman's *Why Greatness Cannot Be Planned* (book), Wolfram's computational irreducibility, Boids, Particle Life and Core War (tools/other).

### (c) Browser Life as understood from the repo
The repo is public. I read the README and around 20 PR descriptions. I could not open individual source files directly, so some internals below are inferred and marked as such.

- **What it is:** "Cadence Garden (browser-life)", "an open-ended artificial-life ecology that runs in the browser on WebGPU. It is closed in matter, open in energy, and uses exact integer physics. Individuals, reproduction, heredity and ecological roles are *inferred* from local rules, never declared." It is live at cadence.garden.
- **Layout:**
  - packages/schema
  - packages/sim-ref: the CPU reference, which serves as the specification
  - packages/sim-gpu: WGSL kernels and golden self-test
  - packages/metrics: census, tracking, collectives, activity, ecology, complexity, stats
  - packages/runner
  - packages/search: "M3 bootstrap: batch evaluation + MAP-Elites"
  - apps/lab: Vite lab
  - apps/coordinator: "Phoenix coordinator for the archipelago (segments + replay verification)"
  - Deno headless tools
- **Reproducibility discipline:** GPU results must match the CPU reference bit for bit. Any rule change bumps RULE_VERSION and re-pins golden hashes. Only runs whose final segment a second island has verified get exported.
- **Research instruments:** a 13-signal (v0) then 11-signal (v1) "anomaly bell".
  - v1 rang on 0 of 70 fresh neutral runs and 10 of 10 treatment runs.
  - It did not meet its bar for hearing wounds: L96 and F lesion/feed twins were above threshold on only 4 of 10 seeds each.
  - The "Part C" model calls (an estimated $7–11) still wait for approval.
  - Clade measures (TMRCA, sweeps, turnover) over 130 runs were Negative.
  - The registered worlds gradient-m3 and spots-m3 are labelled Negative "from the registered result".
- **Naturalist stack:** a field notebook, live Field notes in the lab, and a rule-based proposer v0 with a fixed 26-row rule table. Its proposals are replayable forks shown "never run without a click". A proposer bench (70 forks vs random and dose-matched controls) is pre-registered.
- **Coordinator stack (inferred):** a serialized GenServer queue (Coordinator.Queue) with state persisted to a state.bin data directory, plus ETS and :persistent_term. I saw no Oban, Ash, Ecto or LiveView in any PR text, but mix.exs could not be checked. It has 575 coordinator tests.
- **Agent safety precedent:** PR #6 prototypes a "fake-only agent capability proxy" with single-use leases and a durable audit trail.

**Interpretation:** the project's engineering is already strong (replay verification, pre-registration, blinded review). Its scientific bottleneck is an observer that can tell open-ended novelty from drift. ASAL is a direct, cheap attempt at exactly that.

## Details: Prioritised Application Ideas

| Priority | Idea | Paper(s) | Impact | Effort |
|---|---|---|---|---|
| P1 | FM novelty signal ("ASAL bell") | ASAL | High | Low–Med |
| P2 | FM-descriptor MAP-Elites + illumination map of presets | ASAL, MAP-Elites, DRQ | High | Med |
| P3 | Red Queen hall-of-fame founder search on ponds/breeder | DRQ, MAP-Elites | High | Med |
| P4 | LLM-as-mutation proposer arm (Jido), verifier-gated | DRQ, AlphaEvolve | Med–High | Med |
| P5 | Surrogate "will this fork depart?" probe | DRQ (linear probe) | Med | Low |
| P6 | Selection-for-regeneration (wounds during breeding) | Growing NCA, Lenia | Med | Low–Med |
| P7 | Assembly-style selection signature on inferred individuals | Assembly theory | Low–Med | Med |
| P8 | Perturbation "weight sweeps" of genomes; rule-program search | FER, AutoML-Zero | Exploratory | High |

**P1: ASAL open-endedness signal.**
- **What:** render census frames, which the lab renderer already produces, for each verified segment. Embed them with CLIP and compute ASAL's score: the mean over time of the maximum similarity to any earlier frame (lower means more novel).
- **Why first:** your bells failed mainly on drift versus signal. ASAL measures novelty in a human-aligned space rather than in hand-built statistics. It is also substrate-agnostic, with the single constraint that the world can be rendered.
- **How to keep it honest:** treat it exactly like bell v1. Freeze the rule, then score the 70 fresh neutral nulls and the treatment arm, then the lesion/feed twins.
- **Elixir sketch:**
  - Add Oban with the Lite (SQLite) engine so the state.bin design stays intact, or Postgres if you are willing to add it.
  - An `Observer.EmbedSegment` worker fires when a segment is verified.
  - Inference runs either in Bumblebee/Nx (CLIP is supported) or in the Deno tool with a pinned ONNX CLIP. Pin the model hash the same way you pin golden rule hashes.
  - Store embeddings as Ash resources (`Embedding`, `NoveltyScore`) and plot novelty-over-time in a LiveView ops page.
  - Expose a public read-only Vue panel in the lab.

**P2: FM-descriptor MAP-Elites and illumination.**
- **Search:** replace or augment packages/search's hand-chosen descriptors with 2-D projections of CLIP embeddings, which is ASAL's illumination.
- **Distribution:** spread batch evaluation over islands. The coordinator owns the archive (a GenServer or Ash resource) and islands return descriptor + fitness with replay-verified hashes.
- **Visible output:** a UMAP "map of worlds" for /worlds/, so the catalogue shows where each preset sits and whether your worlds land on an "island" the way the Life-like CAs did.
- **Evidence:** DRQ's ablation shows the diversity archive matters most in later rounds.

**P3: Red Queen founder search.**
- **What:** you already have competition (ponds, donors, breeder). Run DRQ-style rounds in which each new founder set is evolved to persist against all earlier champions sharing a pond.
- **What to measure:**
  - generality against held-out founders, analogous to DRQ's held-out human warriors;
  - phenotypic variance across independent seeds, which tests for convergence.
- **Why:** this turns a static fitness into a moving objective, and DRQ's static baseline shows why that matters: specialists beat their training opponent, but per the paper an average evolved warrior defeats or ties only 27.9% of human warriors.
- **Implementation:** an Oban Pro workflow (or plain Oban chains) per round, made of fan-out segment jobs and a reduce step.

**P4: LLM-as-mutation proposer arm.**
- **What:** add a third arm to the pre-registered proposer bench: an LLM that sees field notes and proposes fork specs in the existing lesion/feed/sun vocabulary.
- **Guardrails:** the runner validators and replay verification act as the AlphaEvolve-style evaluator.
- **Jido sketch:** a `Naturalist` agent with Actions `ReadNote`, `ProposeFork` and `ValidateSpec`, and Directives that only *enqueue* a proposal awaiting a human yes, reusing PR #6's lease and audit pattern.
- **Expectation:** Kumar's own caution ("nothing interesting happens" when LLMs run autonomously) suggests the gain comes from the selection loop, not from the model.

**P5: Surrogate probe.** Embed fork specs and genomes and fit a linear probe to predict "departure" from bell outcomes, following DRQ's R² = 0.461 result. Use it only to *order* the queue, never to skip verification.

**P6: Select for regeneration.** NCA regeneration emerged once damage was in the training distribution. Add scheduled lesions inside the breeder's selection regime and test whether recovery (your recovery assays) improves against a no-lesion control.

**P7 and P8.** An assembly-index proxy (minimal construction steps × copy number of inferred bodies) could add a selection signature that is independent of CLIP. FER-style single-parameter sweeps of evolved genomes could show whether evolved founders are "factored". AutoML-Zero-style search over rule programs collides with the RULE_VERSION/golden-pin discipline. Keep all three exploratory.

## Recommendations
1. Pre-register the ASAL bell (P1) this month, using the existing bell-v1 corpus as the null. It costs only CPU or GPU inference, with no paid model calls.
2. If P1 separates treatment from neutral, use its embedding as the descriptor space for P2 and P3. If it does not, publish that as a Negative result. It is still informative, because it tests whether a human-aligned observer sees what your hand-built signals miss.
3. Introduce Oban (Lite engine) and Ash only around new observer and archive work. Leave the proven Coordinator.Queue alone.
4. Gate any LLM arm (P4) behind the bench and an explicit spend approval, as Part C already is.

## Caveats
- **CLIP is a proxy observer.** It may reward colour churn or rendering artefacts. The renderer and palette must be frozen, and a "shuffled frames" control is needed. Don Yin's "The Self-Replication Phase Diagram" (arXiv:2603.25239) found no correlation between ASAL open-endedness and self-replication across Life-like rules ("ρ = -0.002, p = 0.24"). FM novelty is therefore not the same thing as lifelike dynamics.
- **Different substrates.** ASAL's island result comes from binary Life-like CAs. Browser Life's conserved-matter, energy-open integer world may not show the same structure.
- **DRQ convergence is double-edged.** In an ecology meant to be open-ended, Red Queen pressure that *reduces* diversity across runs could work against your goal. Track diversity explicitly.
- **Determinism.** FM inference is floating point and model-version dependent. Keep it strictly as an observer outside the replay-verified physics, and pin model weights.
- **Repo uncertainty.** I could not read docs/plan.md, packages/search or mix.exs directly. The descriptor details, the coordinator dependencies and the exact registered criterion still need confirming.
- **Source conflicts.** Jido 2.0 appears on Hex on 22 Feb 2026, while a wiki and HN cite 5 Mar 2026; the Hex date is the publish record. Several paper figures here (the FER code repo) come from secondary summaries.

---

## Repo check (2026-10-31)

These are the summary's guesses, checked against the repo:

- **Coordinator dependencies:** `apps/coordinator/mix.exs` has no Oban, Ash, Ecto-backed jobs, Jido or Nx/Bumblebee. The Oban, Ash and Jido sketches above would each add a new framework. Every analysis instrument so far is a Deno tool under `tools/` that writes records under `runs/` and `experiments/`, and the coordinator only schedules and verifies segments. A new observer fits that pattern without touching the coordinator.
- **Lab:** the lab is Vite and TypeScript (`apps/lab`), not Vue.
- **Bell status:** the bell is at v2, not v1. Bell v2's readout ([naturalist-bell-v2-2026-10-18.md](naturalist-bell-v2-2026-10-18.md)) is **Negative**: lesion twins (L96) rang on 4 of 10 seeds and feed twins (F) on 2 of 10 against a bar of 8, while the nudge nulls rang on 0 of 10. Its run directories are still on this machine (`~/browser-life-bell-v2/runs`), so they are a ready corpus where hand-built signals missed.
- **Search:** `packages/search` descriptors are size and speed, with lesion recovery and light dependence as quality (`packages/search/src/evaluate.ts`).
- **CLIP locally:** neither torch nor open_clip is installed, but `uv` is, so a pinned CLIP can run in an isolated `uv run --with ...` environment without touching the project's dependencies.
- **Program soup:** this summary predates the BFF program soup (`tools/soup*`, PR #126). Core War is the closest relative of the soup, where 64-byte programs copy themselves on a shared tape. The soup also has a ground truth the garden lacks: a known copier takeover, confirmed by cubff's copy test. That changes what should come first (below).

## Bringing it here: brainstorm (2026-10-31)

Three things are already on this machine that make the two best ideas cheap:
- the post-takeover soup test, which already races later leaders against earlier ones (`docs/soup-evolution-2026-10-31.md`);
- grid-soup frame sequences, one with a takeover (seed 1, 166 frames) and one without (seed 2, 338 frames);
- the bell v2 corpus.

### Step 1. Calibrate the ASAL observer where the answer is known (soup frames, about half a day, free)

- **Observer**: `tools/observe/clip.py`, run with `uv run --with open_clip_torch==<pinned>`. It uses one pinned CLIP checkpoint, with its SHA-256 recorded in the record, and embeds PNG frames. `tools/observe.ts` computes ASAL's scores on those embeddings: open-endedness is the mean over time of the maximum similarity to any earlier frame, and illumination is nearest-neighbour distance across runs. The observer stays entirely outside the physics.
- **Test**: does the observer see the copier takeover in grid seed 1, at about step 17,000, and nothing comparable in grid seed 2? Grid seed 2 never made copiers but had an entropy blip at 38,913. This directly tests the Yin caveat (ASAL novelty did not track self-replication in Life-like rules) on a substrate where replication is known.
- **Controls, fixed before looking**:
  - **Shuffled frames**: the same frames in random order, which keeps colour statistics but breaks history.
  - **Palette swap**: the same states drawn with a permuted byte palette. The score should not depend on colour choices.
  - **Families view and bytes view** scored separately.
- **Outcome either way**: a calibration record. If CLIP cannot see a takeover that cubff's copy test sees at 64/64, it will not see subtler garden events, and Step 3 needs a different observer.

### Step 2. Red Queen for copiers (soup, after the current runs, CPU only)

The soup test's time-shift races are already "against past champions". DRQ adds generality against held-out opponents, convergence across runs, and selection against a hall of fame.

- **2a. Cross-lineage generality (free, uses `runAssay`).** Race each lineage's leaders, from early to late, against the other three lineages' leaders, which play the role of DRQ's held-out human warriors. Question: do later copiers beat more foreign copiers than earlier ones? This is a cleaner "better" than within-lineage races, because the opponents share no history.
- **2b. Convergence.** Measure type distances between the four lineages' leaders over time. Do independent soups drift toward similar copier motifs (DRQ: genotypes stay varied while phenotypes converge)? The canonical keys and mirror-aware distances already exist.
- **2c. Hall-of-fame soup.** Add a `tools/soup.ts --hall <file> --hall-every N` that plants a small patch of past champions every N epochs, so the living soup must keep beating every earlier leader. Compare it with plain runs of the same seeds on 2a's held-out generality. This is DRQ's history-length (K) ablation on a substrate with no LLM: K = 0 is the plain run, and full history is the hall of fame. Pre-register it like the current test.

### Step 3. The ASAL bell for the garden (pre-registered, free)

Only if Step 1 shows the observer can see a known event.
- **Frames**: render frames from the bell v2 bases, twins and nudges. That needs a headless garden renderer. `pnpm gen:cards` already draws worlds with Chrome/WebGPU; reuse that path, or write a CPU palette renderer from census snapshots. Which one is cheaper still needs checking.
- **Rules, fixed before scoring**: the same rule shape as bell v2. The threshold comes from the nudge nulls, and the result is how many of the lesion/feed twins exceed it.
- **What it tests**: whether a human-aligned observer hears what the 11 hand-built signals missed. A Negative result is still publishable, as the summary says.

### Step 4. FM descriptors in `packages/search` (only if Step 3 separates)

Add CLIP-projection descriptors next to size and speed, plus a hall-of-fame quality term that reuses Step 2c's code path. The `/worlds/` "map of worlds" (a UMAP of preset embeddings) is a cheap, visible by-product, and can be built even if Step 3 is Negative, as an illustration rather than a claim.

### Later or gated

- **LLM-as-mutation (P4)**: paid calls, so it needs a spend yes, like Part C. The verifier-in-the-loop framing fits the soup well: an LLM proposes BFF programs, and the copy test plus races judge them. Kumar's "nothing interesting happens" caution argues for running it only inside a selection loop.
- **Selection for regeneration (P6)**: the breeder (`tools/breed.ts`) already exists. Scheduled lesions during breeding against a no-lesion control is a small garden experiment. The 2026-10-23 breeder shell test found one heritable climb, under plain wounds.
- **P5, P7, P8**: exploratory, as the summary says.

### Not doing

- No Oban, Ash or Jido just for this. Keep observers as Deno/uv tools, and move them onto islands only if they need to run at archipelago scale.
- No change to integer physics or `RULE_VERSION`. Every observer here is read-only.
