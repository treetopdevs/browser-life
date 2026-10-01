# Lineage inspector: design draft (2026-10-01)

Status: **draft, exploratory.** Nothing here is registered. It changes no physics, no checkpoint format and no golden pin; everything proposed is observer or analysis code under RULE_VERSION 1. The panel sketch is `docs/lineage-inspector-sketch.html` (real data from one run, see §2).

Goal: show how one lineage's strategy changed, mutation by mutation, without overstating what a single history shows.

## Summary

- **The subject is a genotype lineage, and its ancestry is exact.** Every lineage's genome can be rebuilt from the founders, `mutations.tsv` and the seed, with no replay, because a mutation's locus and step are counter-PRNG draws keyed on (seed, step, cell). Checked twice: a CPU world (328 living lineages, 46,449 events, 0 mismatches) and the M4 replay of gradient-m3 treatment seed 1 (all 54 ancestors of the final dominant lineage match the GPU-recorded `genomes.tsv`).
- **Tracker individuals are context, not ancestry.** The reset found no immediate copy contribution in 135 of 200 tracker parent links, so component parenthood is shown as attribution, in its own row.
- **Decision: family trees first, built with population discipline.** Choose subjects by a stated rule, show each story beside a neutral twin, and show a population band behind every trace. The novelty map comes later, once a measure has passed the test-6 calibration. Test 6 already found phenotype-bin novelty flags 40 of 70 neutral runs.
- **Complexity has to be per capita and functional.** Proposed: functional measures of the controller's response, computed over the inputs the lineage actually meets, plus a driven-trend test on the exact genealogy. The test compares successful mutations with all mutations minted, which a bigger population can't move.
- **Build analysis-first.** Run bundles already hold what the panel needs, apart from per-lineage energy and environment. Lab integration follows.

## 1. What "one organism" can mean here

| Layer | Unit | Parent link | Evidence |
|---|---|---|---|
| Genotype lineage | id `(birth step + 1, birth cell)`, one immutable genome | Mutation event, child ← parent, logged every step (`mutations.tsv`) | **Exact.** A copy with one known change |
| Component ("individual") | Connected B + P ≥ 48 cells, mass ≥ 256, tracked by overlap | Fission, or budding credited to the nearest same-lineage individual within 24 cells | **Inferred.** 135 of 200 links show no immediate copy contribution (reset, 2026-09-29) |
| Material | Conserved quanta | — | **Not measurable** within the bounds found by the reset follow-up |

The person clicks something that looks like an organism, which is a component. The inspector resolves it to its dominant lineage and states the purity ("lineage 988713:40332, 89% of this component's cells"). From there it walks the genotype ancestry. This works around the entity problem without hiding it: what the panel calls ancestry is genome descent, and the panel says so.

A lineage id already encodes its origin. `988713:40332` was minted at step 988,712 in cell 40,332, which is (140, 157) on a 256² tile.

## 2. Feasibility, from a prototype on real data

The prototype dossier script ran on `runs/replay-m4/gradient-m3/treatment/seed-1`, a 10⁶-step replay with `lineageObs`. It takes 6 s, streams the tables and reads all 467,436 events. The script is a scratch file and not in the repo. All numbers below are descriptive, from one history.

- **Subject.** The most abundant lineage at step 10⁶ is `988713:40332`: 868 cells, 1.9% of 45,920 living. It descends from founder `0:10` through 54 mutations.
- **Reconstruction.** All 54 rebuilt ancestor genomes equal the recorded ones. Only 101,055 of the 467,436 minted lineages (22%) ever reach a census and get a `genomes.tsv` row. The rest exist only through reconstruction.
- **The ancestry runs through small lineages, not a series of winners.**
  - Median ancestor peak is 644 cells, and the smallest is 19 cells (`33136:37492`, alive for 300 steps).
  - The two largest expansions follow mutations to physics parameters, not to the controller. Motility gain went 0 → 17 at step 261,348 (that lineage peaked at 24,764 cells), and μ went 60 → 72 at step 367,949 (peak 24,561).
  - These are candidate beats, not findings. Hitchhiking and environmental change are untested.
- **"Silent" needs two tests.** 6 of the 54 mutations change no controller output on the probe grid.
  - 4 of them are μ or motility gain, which act through Lenia affinity and transport, not the controller.
  - 2 are `∇Sy→h4`, and the probe grid holds ∇Sy at 0.
  - So silence has to be judged on the inputs the lineage actually meets, and physics parameters need their own evidence.
- **Role is a context label, not a strategy.** Within the subject's single genome, 78% of cell-censuses read phototroph and 22% decomposer. Strategy has to be read from the controller's response; realized flux is the outcome in context.
- **Offspring.**
  - *Exact.* 62 children minted in its 11,288 steps, 10 of which reached a census; 87 descendants in all.
  - *Inferred.* The tracker credits 35 births involving the subject (18 fission, 17 budding). In one fission the tracked parent is a mixed component whose plurality genotype is a different lineage, holding only 10% of its cells. That one row shows the attribution problem.
- **Neutral twin.** The same procedure on neutral seed 1 also tells a story: depth 34, median ancestor peak 2,746, and one ancestor that never reached a census and exists only through reconstruction. In `neutral` none of those mutations is expressed. A story view without its neutral twin would generate just-so stories.

Gaps in current bundles:
- Per-lineage free energy and mass history. `profiles.tsv` has four fluxes, cells and mass at deep censuses, but no E.
- The environment each lineage experiences. It can be recomputed only from checkpoints, which replays write every 10⁵ steps.
- Per-individual trajectories. The tracker's dead and its history are not persisted.
- The lab drops mutation events after counting them (`execution.ts:110-115`).

## 3. The entity panel

Sketch: `docs/lineage-inspector-sketch.html`.

**Entry and placement.** Entry points:
- the Inspect tool's probe ("Open lineage" on the selected-cell card);
- a clickable row in "Largest lineages";
- a subject rule in analysis mode.

The panel opens as a wide drawer over the evidence rail, with the world still visible, so the living world stays central. The canvas highlights the subject's cells and dims the rest; the renderer's uniform has 3 spare words for this.

**Header.** It shows:
- the id, decoded into minted step and cell;
- founder and depth;
- cells now, and share of living cells;
- alive or extinct;
- the components it dominates, with purity;
- how the subject was chosen ("most abundant at step 10⁶", "random lineage ≥1% at t, seed s", or "picked on canvas", which is flagged as chosen by eye).

Every number carries an evidence chip:
- **exact**: logged or reconstructed and checked;
- **inferred**: tracker attribution;
- **context**: realized, depends on environment;
- **not recorded**.

Colour never carries this alone (PRODUCT.md).

**Sections**, in reading order:

1. **Ancestry.** One row per ancestor, from founder to subject.
   - Each row is a bar from first to last census, shaded by cells over time.
   - The tick that starts each row is the minting mutation, marked by expression class.
   - Sibling children that died are summarised as a count per row, not drawn.
   - A population-share trace sits on top: the share of living cells held by whichever ancestor is alive.
2. **Mutations.** One row per edge, with step, locus (`h3→photo`, `bias emit`, `μ`), before → after, and expression class:
   - controller output changed (which outputs, and by how much);
   - physics parameter;
   - no effect on realized inputs;
   - clamped no-op.

   The row also shows what followed: peak cells, and share relative to the parent over the same window. A deterministic sentence template turns a controller change into words, for example "photosynthesis output +24 at every input". There is no free-form interpretation.
3. **Strategy.** The controller's response, computed exactly from the genome with the same integer forward pass as `step.ts`:
   - response curves (output against light, other inputs at typical values) for the founder, a selected ancestor and the subject;
   - a strip of mean outputs along the ancestry;
   - μ, σ and motility gain beside them.
4. **Energy history.** Realized fluxes per cell (photosynthesis, respiration, decomposition, growth) from `profiles.tsv`. Free energy per unit biomass, and capture against cost, need a new observer column (§6).
5. **Behaviour.** The role mix over time. Motility and emission come from the controller; their realized values need new columns.
6. **Offspring.**
   - *Exact:* children minted, children censused, descendants, and a small clade.
   - *Inferred:* tracker births, listed with parent and child purity.
7. **Environmental pressures.** Light, nutrient and waste the lineage's cells experience, set against the whole world's distribution. Also its neighbours: which lineages share its components and border it. And a local selection readout: its share growth against co-located lineages in the same window. v1 reads these from checkpoints; v2 adds an observer.

**Footer.** Provenance:
- bundle path, final hash, census cadence;
- the reconstruction check ("54 of 54 genomes verified against `genomes.tsv`");
- "Jump to step": restore the nearest checkpoint at or before the step and advance. This is exact, since replay is deterministic, but lesions made after that checkpoint are not re-applied.

**Neutral twin.** The same subject rule applied to the same-seed neutral run, as a ghost row: depth, expansions, and how many mutations were expressed (none, by construction).

## 4. Decision: family trees or a novelty map

**Recommendation: lineage-first, on the genotype genealogy, with guardrails taken from the population view.**

Why trees first:
- The genealogy is the one exact structure here. A story built on it is checkable mutation by mutation.
- Stories are how candidate measures get found. A single spine already showed that silence needs two tests and that role isn't strategy; no population plot would have shown either.
- A novelty map built now would show measures the project has already ruled ineligible.
  - Phenotype-bin novelty flags 40 of 70 neutral runs, because genome μ and σ drift there by design.
  - Persistent novelty separates treatment from no-mutation at only 0.50.
  - Such a map would show emergence in neutral runs too, which is exactly the "visual pattern as proof" anti-reference.

Why not trees alone: N = 1, survivorship (the subject is chosen *because* it won), and narrative fallacy. The guardrails:
1. **Subject by rule.** The panel states the rule, and the same rule picks the neutral twin.
2. **Every trace over a band.** The population's cell-weighted quantiles sit behind the subject's trace, and, where a run exists, the matched neutral and no-mutation runs.
3. **Beats are candidates.** "A mutation followed by an expansion" is labelled untested until a common-garden or time-shift assay has been run on it. The transplant tooling from foundations test 4 already does this.

When to switch the emphasis: for a confirmatory claim the population view *is* the claim, and the tree becomes its illustration. The population view (§5) is built once a complexity measure passes calibration, and it uses the same reconstructed genomes.

## 5. Complexity rather than population

**Principle.** A complexity observable describes what each unit does, not how many units there are. Any candidate must pass three invariance checks before it is computed on registered data:

1. **Duplication.** Two copies of the world side by side, or twice the births with the same genotypes, leave it unchanged.
2. **Neutral.** In `neutral` (genomes mutate, expression is fixed) it stays flat.
3. **No mutation.** Without new variation it stays flat or falls.

What the project has measured so far fails at least one of these:

| Observable | Fails | Evidence |
|---|---|---|
| Lineage count, births, cumulative new activity | Duplication | M4 endpoint 2: all 30 neutral runs "growing"; treatment has about twice neutral's births |
| Phenotype-bin novelty (μ, σ, role) | Neutral | 40 of 70 neutral runs flagged (test 6) |
| Role count | Capped at 4, and context-dependent | 3.04 roles already at M4; one genome reads as two roles (§2) |
| Tracker generation depth | Parenthood not causal | 135 of 200 links fail the copy test |

**Proposal A: functional complexity of the expressed controller.** Computed on *realized* inputs: sensor vectors sampled from the lineage's own cells at deep censuses. Each genome gets three numbers, reported separately, never collapsed into one:

- *Dependencies*: (sensor, actuator) pairs where moving the sensor within its realized range changes the actuator's output.
- *Regimes*: the effective number (exp of entropy) of distinct hidden-unit activation patterns visited. Each unit is off, linear or saturated.
- *Conditionality*: mutual information between coarse-grained sensors and catalytic outputs, Miller-Madow corrected as in `individuality.ts`.

At population level, report the cell-weighted distribution (median and upper quantile), never a sum. A larger population with the same genotypes leaves a distribution unchanged.

**Proposal B: driven-trend test on the exact genealogy** (after McShea 1994, on passive and driven trends).
- For every mutation event, compute Δc = c(child) − c(parent), with both evaluated on the *parent's* realized inputs, so environmental change is held fixed.
- Compare two sets:
  - *minted*: all events, about 467k per 10⁶ steps. Their genomes come from reconstruction, so no replay is needed.
  - *successful*: children that reach ≥1% of living cells at a deep census, or persist ≥10⁵ steps.
- **Selection skew** = P(Δc > 0 | successful) − P(Δc > 0 | minted).
- It is a ratio among events, so doubling births doubles both sets and leaves it unchanged.
- *Subclade check*: restrict to parents above the run's median c. A passive trend drifting up from a floor shows no skew there; a driven trend still does.
- *Expected directions, stated now, before any computation:*
  - treatment: skew > 0, if selection favours more conditional controllers;
  - `neutral`: skew ≈ 0, since expression is fixed and selection can't see the controller;
  - no-mutation: undefined, with no events;
  - single-founder no-mutation: undefined.

**Proposal C: show that it matters.** For a few high-Δc successful pairs, put parent and child in a common garden. Use one environment where the new conditional behaviour should matter (patchy light) and one where it shouldn't (uniform light). Complexity that changes nothing there is decoration.

**Eligibility.** Before registration, apply test 6's rule unchanged: the measure must separate the worlds known to differ with P(a > b) ≥ 0.8, and flag at most 2 of the 70 neutral runs.

**Not yet computed, deliberately.** The M4 replays already hold everything Proposal B needs (genomes, events, checkpoints). Computing it should follow a dated decision that fixes the definition, sampling and expected directions. The prototype computed only canonical-grid regime counts along one spine (147 to 180) and none of the proposed measures. Those numbers are not evidence: the grid hides ∇Sy, and the proposed measures use realized inputs.

**How to show it and explain it** (wireframes in the sketch):

1. **Traitgram.** x is step, y is one complexity component. The subject's ancestry is a path; dead siblings are short stubs; the population's cell-weighted quantile band sits behind it. The neutral twin's panel sits beside it. It reads as "climbed" or "wandered".
2. **Selection skew.** Δc histograms for minted against successful mutations, treatment beside neutral. The gap between them is the explanation in one sentence: "mutations are blind; what spread was biased toward more conditional controllers", or "it wasn't".
3. **Decoupling plot.** One dot per run: x is log change in living cells, y is change in the cell-weighted median complexity, coloured by condition with shape redundancy. It shows that population can grow without complexity rising.
4. **In the inspector.** Each mutation card says whether Δc moved and whether the child spread, using the template sentence. The story and the statistic use one vocabulary.

## 6. Build plan

Each phase is observer or analysis only, and each is a separate change.

1. **Built 2026-10-01: shared pure helpers** in `tools/lib/lineage.ts`, not `packages/metrics`. They import `@bl/sim-ref`, which the metrics package doesn't depend on; they move to a package when the lab needs them.
   - `applyMutation` recomputes slot and delta from the counter PRNG and applies `mutateInPlace` itself.
   - `initialGenomes` rebuilds the start state as the runner does, and uses it only when it reproduces the manifest's `initHash`.
   - `probeGenome` and `expressionOf` evaluate the controller through `controllerForward`, now exported from `packages/sim-ref/src/step.ts`. `react` calls it, the arithmetic is unchanged, and the golden pins are byte-identical.
   - The probe grid includes ∇Sy, so the prototype's two grid-artifact "silent" mutations now show as controller changes. The classes are `controller`, `probe-silent`, `physics` and `clamped`.

   Tests (`tools/test/lineage.test.ts`): a CPU history rebuilt exactly from its initial world and mutation log; single-slot mutation and clamps; the subject rules; a refusal when a reconstructed genome differs from `genomes.tsv` or the root genome is unknown.
2. **Built 2026-10-01: `tools/lineage.ts`** (Deno, streaming).
   - Genotype subjects: subject rules (`--subject`, or `--rule top|random|longest` at `--step`), a neutral twin (`--twin`) and dossier JSON. On the M4 replay of gradient-m3 treatment seed 1 it takes about 7 s and verifies 55 of 55 ancestors against `genomes.tsv`. The original M4 bundle, which has no `genomes.tsv`, gives the identical ancestry.
   - The log is called complete only when its distinct children equal the run's mutation count. A root that is not a founder is reported as ancestry unknown before its minting, even when `genomes.tsv` supplies its genome. Censuses with no living lineage come from `series.jsonl`, so an extinct run is not shown as alive at its last non-empty census.
   - Pond subjects (`tools/lineage.ts pond`, reader in `tools/lib/pond-lineage.ts`). A node is a pond's pre-cycle state at a boundary; its parent is the donor whose packet reseeded it at the previous boundary. The dossier holds ancestry, exact offspring, clade size per cycle, the population trait band and each node's packet-dominant genotype. On scaffold `main` i0, the top pond at cycle 100 descends through 99 transfers and 48 distinct donor ponds. Every pond at cycle 100 shares that line up to cycle 72 in `scaf` (54 in `rand`). Standalone histories have no `mutations.tsv`, so the packet genotypes can't be opened as genotype dossiers until runner bundles exist.
3. **Built 2026-10-01: static panel** rendered from a dossier, as the `lineage` track of `tools/report-html.ts` (renderer `tools/lib/report-html/lineage.ts`). It uses inline SVG on the shared report tokens and page contract, with no libraries and no interpretive prose beyond the templates. Every section and key number carries an evidence chip.
   - Genotype dossiers get five figures:
     - ancestry lanes with the mutation table (locus, change, expression class and probe-grid effect per mutation);
     - population, with the line and clade shares;
     - light-response curves for root, peak ancestor and subject;
     - mean outputs along the ancestry;
     - realized flux per cell, when `profiles.tsv` exists.

     Sections for offspring, tracker births, the neutral twin, what is not recorded, and provenance follow.
   - Pond dossiers get the subject's ancestry over the population trait band, and descent (descendants of each ancestor, then clade size). A pond twin shows both arms side by side.
   - On the M4 replay of seed 1 the page is about 315 KB. Series longer than the plot's pixel columns are drawn as per-column minimum-to-maximum bands, so no spike is dropped.
4. **Lab integration.**
   - `LabExecution` keeps mutation edges. About 16 B per event, roughly 7.5 MB per 10⁶ steps at M4 rates; persist them with the observer state in OPFS.
   - New messages `lineage` and `highlight`, and a renderer highlight mode.
   - The probe resolves to a lineage.
   - "Jump to step" through checkpoint restore. The lab writes checkpoints only on Save today, so add periodic automatic checkpoints.
   - Decide whether tracker history should survive checkpoints.
5. **Observer additions** for the gaps:
   - per-lineage E and mass, and realized motility and emission, in `profiles.tsv`;
   - a bounded sample of realized sensor vectors per lineage at deep censuses (for Proposal A).

   Bump `metricsVersion`; registered runs are unaffected.
6. **Complexity measure**: a dated decision on the definition, then computation on the M4 replays (10 treatment, neutral and no-mutation, all with `lineageObs` and checkpoints), then test-6 eligibility.

## 7. Open questions

- **Decided 2026-10-01: analysis-first.** Bundles already contain the data, and the lab needs new retention.
- **Decided 2026-10-01: a scaffold pond is a second subject type.** Pond → packet → pond descent is exact by construction, and row C of the scaffold protocol already calls for lab integration, so one panel can serve both lines. The pond reader parses `ponds.tsv` by header name and imports nothing from the pond code, because the runner integration (`docs/scaffold-integration-v1.md`, in the scaffold workspace) is moving that code into `packages/schema` while this is built.
- **Proposal B's success threshold.** Should it be ≥1% at a deep census, or persistence for ≥10⁵ steps? Fix it in the dated decision, before computing.
