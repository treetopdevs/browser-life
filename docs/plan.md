# Plan: An Open-Ended Ecology in the Browser

*September 25, 2026. Builds on `life_like_systems_edited.md` (the report) and `browser_artificial_life_addendum.md` (the addendum). The addendum's three milestones are the first 40% of this plan; this document sets the goal they lead to.*

## North star

> **Across ≥100 independent browser-hosted histories, a world that is closed in matter and open in energy produces, without being told to: (1) self-maintaining individuals, (2) heritable reproduction by fission, (3) a recycling ecology with ≥3 functionally distinct trophic roles, and (4) at least one major transition: a collective that reproduces as a unit through a bottleneck. Held-out complexity measures must rise above neutral and ablation controls, with no saturation detected over the observation window.**

This combines three of the report's hardest open problems into one falsifiable target:

- **Ecological closure** (open problem 7): producers, consumers and decomposers that recycle each other's waste.
- **Emergent individuality** (open problem 2): no `reproduce()`, no `Organism` class. Individuals, parents and offspring are *inferred* from the dynamics.
- **Major transitions** (the report's "particularly strong positive result"): a new reproducing unit at a higher level.

The plan is built so that **failure is informative**. If the system plateaus, as Bedau found in earlier systems, a well-controlled ensemble that records *where* it plateaued and *which ablation* caused it is still a real result.

## Six design decisions that make it ambitious (and tractable)

### 1. Matter closed, energy open (like Earth)
Total matter is fixed and exactly conserved. Energy enters as a light field (spatially and temporally varying) and leaves as exported heat. There is no external food replenishment, so waste *must* be recycled or everything stalls. This makes decomposers and nutrient cycling selectively favored rather than scripted, and gives the "anti-entropy" framing an honest physical shape: local organization is paid for by energy throughput and heat export.

### 2. Exact integer physics
Mass is stored as `u32` quanta and controllers run in fixed-point `i32`. Transport is gather-based: each cell recomputes, deterministically, what each neighbor sends it, with rounding remainders assigned to the source. Consequences:
- The conservation residual is **exactly zero**, not "small".
- Runs are **bitwise-replayable across GPUs**. f32 cannot promise this; integer WGSL can.
- Distributed runs become **verifiable**: the coordinator can spot-check any volunteer's segment by replaying it (see §7).

### 3. Heredity rides on matter (the Flow-Lenia move)
Every cell carries a genome vector that is advected with its mass. When mass from several sources merges into one cell, the resulting genome is chosen by mass-weighted lottery using a counter-based PRNG keyed on `(seed, step, cell)`. Mutation happens at copy time with a fixed per-quantum rate. Each genome also carries a `u32` lineage ID; a mutation mints a new ID and appends a birth event to a GPU event buffer.

### 4. The genome is a developmental program, not a parameter list
The genome holds the weights of a small fixed-topology local network (about 12 sensors → 8 hidden → 8 actuators, fixed-point). It reads local chemistry, gradients, signals and its own state channels. Actuators: catalysis rate for each reaction, flow bias (motility), adhesion, signal secretion, and deposition of structural polymer (a membrane). Evolvability features are built in from the start: modular per-reaction weight blocks, silent slots available for neutral drift, and a duplication mutation that copies one module into a silent slot.

### 5. A chemistry whose loops are open but not scripted
Start with about five species (roughly `A`, `B`, `C`, a structural polymer `P`, and signal `S`). Each species has a potential energy, and every reaction balances matter + energy + heat:

| Reaction | Energy | Role it *permits* (not assigns) |
|---|---|---|
| `A + light → B` | stores energy | producer |
| `B → C + work` | releases | consumer |
| `C → A + work` (slow unless catalyzed) | releases a little | decomposer |
| `B → P` | costs | builds membrane/structure |
| `P → C` | decays | makes maintenance necessary (autopoiesis) |

Which reactions a cell catalyzes, and how strongly, is entirely genomic. Catalysis costs work, so a lineage that catalyzes everything pays for it. This is still *abstract* energy accounting, not calibrated thermodynamics. Report it as "resource-accounting entropy" per the report.

### 6. Individuality is detected, never declared
A GPU label-propagation pass finds connected biomass components, bounded by membranes and grouped by genome similarity. It tracks them across frames. A **fission** (one component becoming two viable components with shared lineage) is recorded as reproduction. The same machinery runs one level up. Components linked by adhesion or signaling form *collectives*, and a collective that fissions into collectives, each regrowing the parent's composition from a small propagule, is a candidate **major transition**.

### 7. An archipelago of browsers
Each browser tab is an **island** running an independent world. A lightweight Phoenix coordinator (it fits your Elixir interests, and the dense compute stays in WGSL as the addendum advises) does four things:
- Assigns **run manifests**: seed, condition (treatment or one of the controls, randomized and blinded in the UI), rule version, and environment regime.
- Exchanges **migration packets** (small patches of matter and genomes, schema-validated, data only) between islands of the same metapopulation. This creates stepping stones and gene flow.
- Collects metric streams, event logs and periodic checkpoints.
- **Verifies** by assigning a random fraction of segments to a second browser for replay and comparing state hashes, which is only possible because of §2.

Later, the coordinator can generate island environments POET-style: mutate the light and cycle regimes and keep environments where life persists under strain. That selection signal never touches the held-out metrics.

## Measurement: pre-registered, held out, controlled

Freeze `experiments/preregistration.md` and commit its hash **before** any M4+ ensemble runs. It fixes the metrics, thresholds, controls, observation window and analysis code.

**Metric vector** (recorded separately, never collapsed into one score):
- *Thermo/resource:* energy in, heat out, stored chemical energy, matter-cycling index (Finn's cycling index over the species flux network).
- *Information:* compression ratio **and** predictive-information estimate on coarse-grained fields, always reported together.
- *Structure:* components, membrane-bounded compartments, nesting depth, differentiation (distinct cell states within one individual).
- *Robustness:* automated lesion battery (remove 10/30/50%), obstacle and light-shift perturbations, recovery probability and time.
- *Evolution:* Bedau evolutionary-activity statistics against a **neutral shadow** (identical run whose lineage labels are reassigned at random), phylogenetic depth, innovation rate.
- *Ecology:* trophic-role clustering from each lineage's reaction-flux profile, interaction network (who consumes whose output), coexistence time.
- *Multilevel:* collective-level heritability (parent/offspring collective composition correlation), bottleneck size, and fitness decoupling between levels.

**Held out:** at least one-third of these, including ecology, multilevel and predictive information, are never used by the bootstrap search or the environment generator.

**Controls** (same seed protocol, randomized assignment):
- no mutation
- neutral shadow
- no light gradient (uniform energy)
- fixed environment
- matter replenished externally (breaks closure)
- no migration
- no adhesion/signal actuators (blocks transitions)

## Milestones and gates

Each gate is a pass/fail check. The **pivot** column is what we do instead of pushing on.

| # | Milestone | Gate | Pivot if it fails |
|---|---|---|---|
| **M0** | Harness: Vite + TS, WebGPU in a worker, ping-pong integer transport, CPU reference, OPFS checkpoints, headless test runner | 100k steps, conservation residual = 0; GPU hash = CPU hash on 64²; identical hashes on 2 different GPUs; checkpoint/restore round-trips bit-exact | Fall back to f32 with tolerance-based checks; drop cross-device verification from §7 |
| **M1** | Chemistry + energy ledger, globally fixed catalysis | Energy ledger closes exactly every step; dissipative patterns persist under light; no-light control relaxes to equilibrium | Simplify to 3 species |
| **M2** | Heredity substrate: genomes, mixing lottery, mutation, lineage IDs, event log | Neutral markers drift at a rate consistent with neutral-theory expectation for the effective population size; complete phylogeny reconstructable from the log | Revisit mixing rule (mass-weighted blend vs lottery) |
| **M3** | Individuals: bootstrap search (MAP-Elites / IMGEP over many small worlds batched in one texture array), component tracker, fission detector, lesion battery | ≥20 distinct seeds that recover from a 30% lesion with p > 0.8 **and** die in the no-light control (active, not passive, maintenance) | Switch substrate to particle chemistry (addendum §"When the substrate changes") and keep M0–M2 infrastructure |
| **M4** | Open evolution: bootstrap off, long runs | Evolutionary activity exceeds neutral shadow in ≥70% of runs over 10⁷ steps | Strengthen evolvability (duplication rate, modularity) before scaling up |
| **M5** | Ecological closure | ≥3 trophic roles coexist for ≥10⁶ steps in a majority of runs; cycling index clearly above the "matter replenished" control | Add spatial heterogeneity (light patches, slow currents) to support niches |
| **M6** | Archipelago (run alongside M5): coordinator, manifests, migration, replay verification, run-bundle export | 100 verified independent histories across ≥3 device types, with all controls | Run the ensemble on your own machines headlessly and defer the volunteer network |
| **M7** | Major-transition hunt: adhesion and signaling enabled, collective tracker | North star met, or a documented negative result naming the level and ablation where organization saturated | Publish the negative result with the full ensemble |

Rough timeline for one person working part-time: M0–M3 in about 4 months, M4–M6 in about 4 more, and M7 open-ended. Throughput is unknown until it is measured in M0. For planning, assume 1024² at 1–3k steps/s on an M-series GPU, which puts a 10⁷-step history at about 1–3 hours.

## Architecture

```
apps/
  lab/            UI: controls, field views, metric plots, lesion tools, run compare
  coordinator/    Phoenix: manifests, migration relay, ingest, replay verification
packages/
  sim-gpu/        WGSL kernels + TS host (worker, fixed-step loop, device-loss recovery)
  sim-ref/        CPU reference with the same integer rules (small grids, golden hashes)
  schema/         Versioned state layout, checkpoint format, migration packet schema
  metrics/        GPU reductions + CPU analysis (activity stats, cycling index, trackers)
experiments/      Configs, preregistration.md (frozen + hashed), control definitions
analysis/         Reproducible notebooks/scripts over exported run bundles
```

Per-cell state at 1024² comes to about 64 × 32-bit channels (species ×5, energy, heat, genome ×~48, lineage, component label, spare) ≈ 256 MB for each of the two ping-pong copies. That is fine on desktop GPUs. Mobile gets 512².

## Safety and ethics

- Genomes are numeric weights interpreted by a fixed kernel. There is no code in any genome and no path from the substrate to the network.
- Migration packets are schema-validated data, size-capped and rate-limited. The coordinator holds no credentials beyond its own database.
- Browser compute is opt-in, visibly running, and pausable. Use per-tab GPU budgets and a coordinator-side kill switch.
- Following the report and Witkowski & Schwitzgebel, the project neither asserts nor rules out moral status. Log the question in the pre-registration and revisit it if M7 succeeds.

## First week

1. Scaffold the pnpm workspace plus `apps/lab`, `packages/sim-gpu` and `packages/sim-ref`.
2. Write the integer gather-transport kernel (one species, diffusion + advection by a fixed flow field) in both WGSL and TS.
3. Add a golden test: 64², 1,000 steps, same seed, comparing GPU and CPU state hashes, run headlessly in Chrome via Playwright.
4. Add a conservation assertion (sum of quanta, via GPU reduction) checked every step in debug builds.
5. Draft `packages/schema` v0 and the checkpoint format (header, checksum, schema version, rule version).
