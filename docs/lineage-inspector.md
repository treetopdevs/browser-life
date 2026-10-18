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
   - Pond subjects (`tools/lineage.ts pond`, reader in `tools/lib/pond-lineage.ts`). A node is a pond's pre-cycle state at a boundary; its parent is the donor whose packet reseeded it at the previous boundary. The dossier holds ancestry, exact offspring, clade size per cycle, the population trait band and each node's packet-dominant genotype. On scaffold `main` i0, the top pond at cycle 100 descends through 99 transfers and 48 distinct donor ponds. Every pond at cycle 100 shares that line up to cycle 72 in `scaf` (54 in `rand`). Standalone histories have no `mutations.tsv`, so the packet genotypes can't be opened as genotype dossiers until runner bundles exist (superseded 2026-10-17 for runner bundles: §8, `pond --genotype`).
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
4. **Built 2026-10-01: lab integration.** The genotype core moved to a package, `@bl/lineage` (`packages/lineage`), which `tools/lib/lineage.ts` re-exports.
   - `LabExecution` appends each census's ledger drain to a `MutationEdges` store: 16 B per event, held sorted by child id, so a parent is a binary search. Each checkpoint writes its own OPFS sidecar, `<checkpoint>.edges`, holding the run's edges up to it. A failed save therefore cannot damage another checkpoint's genealogy, and a restore reads the sidecar back. The checkpoint format and observer state are unchanged.
   - The selected-cell card has "Inspect lineage". The worker settles at the next census, because edges are drained there, then replays the ancestry with `lineageAncestry`. The controller probes, the slow part, run afterwards in cancellable slices (`probeLineage`), so the world keeps rendering. Replay starts from the earliest ancestor whose genome is known exactly: the start world (rebuilt from the preset and accepted only at the manifest's new `startHash`), the state a world was restored or imported from, or the live world. Every replayed genome that a known source also holds is checked against it, and a mismatch refuses the view. A world loaded from a file knows its genealogy only from that step, and the view says so.
   - The drawer shows the subject, its response to light, and the ancestry with each mutation's locus, change and expression class. "Highlight on field" tints that lineage's cells and dims the rest, using the renderer's 3 spare uniform words. Highlighting a whole clade would need a key set on the GPU and is not built.
   - "Jump" (per ancestor) saves the present, restores the latest checkpoint at or before the ancestor's minting, and replays to it. The lab now also writes an automatic checkpoint every 20,000 steps and keeps the newest 6 of each run's own; a fork never prunes the checkpoints it inherited from its parent. Jumps only target checkpoints whose files still exist. The Playwright test `tests/e2e/lab-lineage.spec.ts` checks that a jump back, replayed forward, reaches a world with the same state hash as the saved present.
   - Decided: tracker history does not survive checkpoints. The tracker keeps counts and living individuals only. Keeping its event history would change the observer state that the runner, the coordinator and checkpoint digests share. The lab panel therefore shows genotype descent only, and says that tracker births are not kept.
5. **Observer additions** for the gaps:
   - per-lineage E and mass, and realized motility and emission, in `profiles.tsv`;
   - a bounded sample of realized sensor vectors per lineage at deep censuses (for Proposal A).

   Bump `metricsVersion`; registered runs are unaffected.
6. **Complexity measure**: a dated decision on the definition, then computation on the M4 replays (10 treatment, neutral and no-mutation, all with `lineageObs` and checkpoints), then test-6 eligibility.

## 7. Open questions

- **Decided 2026-10-01: analysis-first.** Bundles already contain the data, and the lab needs new retention.
- **Decided 2026-10-01: a scaffold pond is a second subject type.** Pond → packet → pond descent is exact by construction, and row C of the scaffold protocol already calls for lab integration, so one panel can serve both lines. The pond reader parses `ponds.tsv` by header name and imports nothing from the pond code, because the runner integration (`docs/scaffold-integration-v1.md`, in the scaffold workspace) is moving that code into `packages/schema` while this is built.
- **Proposal B's success threshold.** Should it be ≥1% at a deep census, or persistence for ≥10⁵ steps? Fix it in the dated decision, before computing.

## 8. Pond-cycle runner bundles: the descent rule (2026-10-17, before code)

Status: pre-stated rule for the headless tool, written before any code. No physics, checkpoint, golden pin or observer change. It replaces the refusals in `tools/lineage.ts` ("genotype dossiers do not support pond runs yet", "pond dossiers do not support runner bundles yet") and the §6 note that packet genotypes wait for runner bundles.

**What the lab already does, and what stays the same.** The lab's lineage panel works on pond worlds with mutation edges alone. That is sound because the cycle mints no lineage id and `landPacket` (`packages/schema/src/ponds.ts`) copies every genome word of a landed cell, `LIN_HI`/`LIN_LO` included. So genotype descent in a pond run is exactly `mutations.tsv`, as in any run, and the headless tool adopts that rule unchanged. The lab does not check where a lineage lived; everything below is additional, and only the headless tool does it.

**Premises, each from the code or a config check.**
1. Ponds are independent tori: no physics step moves matter or genome words between tiles. Pond configs exclude migration and ring exchange (`validateConfig`, docs/scaffold-integration-v1.md). So the only way a genome enters a pond is a landed packet at a boundary.
2. At the end of every step, a cell holds a lineage id only if B+P > 0. Transport clears the id where no bound mass arrives, react clears it where B and P reach 0, and a lesion clears it (`packages/sim-ref/src/step.ts`). So a packet's `packetLineages`, `domHi:domLo` (counted over retained cells with B+P > 0) name every lineage the packet carried.
3. Boundary c is step c·P (P = `pondPeriod`). The census and ponds.tsv row (c, ·) read the state at that step before the transform. A lineage `hi:lo` first exists in the state at step `hi`. So its **birth node** is (pond, cycle) = (the tile of cell `lo`, ⌈hi / P⌉): minted in period ((c−1)·P, c·P] means present in node c's snapshot. A founder `0:i` is born at cycle 0, in the tiles where the initial world (rebuilt and accepted only at the manifest's `initHash`) holds it.
4. Row (c, r)'s `donor` names where pond r's contents come from after boundary c. In arms scaf, rand and breed every pond is reseeded, so node (r, c+1) descends from (donor, c) alone. In cont nothing moves: (r, c+1) descends from (r, c). Donor −1 in scaf, rand or breed means r was refilled with nutrient only: nothing alive crosses that boundary into r. (The hunt's nat and shuf write −2 for a surviving pond, which descends from itself, and −1 for a dying pond with no packet.)

**The rule.** For each edge parent → child on a genotype ancestry, walk the pond records back from the child's birth node to the parent's birth cycle, one boundary at a time by premise 4. The walk must land on the parent's birth pond (for a founder, on one of the tiles that held it). Within one period the two birth ponds must be equal.
- **Exact:** the walk lands there. The boundaries, donors and packets it passed are the recorded route of the parent's genome into the child's pond, and the dossier lists them per edge.
- **Per packet on the route:** the parent's lineage must be in it. If `dom` is the parent, the record names it, with its share. If `packetLineages` ≥ 2 and `dom` is another lineage, the record neither names the parent nor rules it out ("not excluded"; amended 2026-10-17 from "carried, not named", which claimed more than the record shows). If `packetLineages` is 0 (whatever `dom` says, and also when the table lacks `domHi`/`domLo`; amended 2026-10-17, second review), or 1 with another dominant, the records contradict each other; a count of 1 or more with no dominant is a malformed row. Without the packet columns the parent's presence is not checked, and the crossing says "not recorded". "Exact" means the walk landed; the dossier counts its crossings by these three classes, so a route is never reported as checked further than its packets were.
- **Refused (the tool reports nothing):** the walk lands elsewhere, the ponds differ within a period, a needed packet is empty or names only another lineage, or the walk meets a nutrient-only refill. This means ponds.tsv, mutations.tsv or the run disagree, as a genomes.tsv mismatch does today.
- **Not recorded (that edge only):** ponds.tsv lacks a boundary the walk needs (the bundle starts later, a torn last append, or the file is absent). The edge keeps its exact genotype descent and its pond route says "not recorded", with the reason. Nothing is inferred across the missing boundary. The packets the walk passed before reaching the gap are still checked, so a contradiction already in the record refuses (amended 2026-10-17). A torn last append keeps a prefix of its line: a last line with fewer fields than the header, or (amended 2026-10-17, second review) one with every field whose last field in file order is empty or not a valid value, as a cut right after the final tab leaves it. It is dropped and named in the gaps, and its cycle counts as incomplete. The same line anywhere else is malformed and refuses, and so is a last line with a bad field before its last one. A cut inside the last number leaves a value that still parses; it cannot be told from a whole row and is kept. In the runner's table that field is `light` (or a score column), which no route reads.
- **Picks (`picks.jsonl`).** Amended 2026-10-17: the check follows the runner's own (`applyPondCycle`, `picksConsistencyError`), not set equality. For each logged boundary c, rank all ponds by `randomKey(seed, c, pond, 2)` (ties by pond); recipient r must name donor `donors[rank(r) mod D]` of the log's ordered donors, or −1 when the log names none. Order matters: [1, 3] and [3, 1] assign different recipients. Because the rank is over all ponds, a boundary with rows missing still checks the rows it has ("partial"). A disagreement is refused. Each crossing carries the pick's `by` (a picker's name, `recorded`, ...). A picked run logs every boundary, so a ponds.tsv boundary the log lacks (after a torn last pick line) is counted as not logged and named in the gaps; its crossings carry no `by`. The log is a cross-check only: the descent comes from ponds.tsv, the verified file.

**Tracker births in pond runs.** Births are reported only from censuses inside a period. A birth row at the first census after a transforming boundary links across the grind (protocol v1). It is excluded and counted, and the dossier says so. The census is known from `afterCycle` in series.jsonl. Without series.jsonl the grid is rebuilt as the runner lays it out (amended 2026-10-17): censuses every `censusEvery` from the start step, the last chunk possibly shorter, so the census before step s is s − ((s − start) mod censusEvery, or censusEvery when that is 0), and the birth crosses when that census is a positive multiple of P. That census is a boundary step because the runner requires `censusEvery` to divide P, and a segment starting at a boundary flags its first census the same way. **Deviation from protocol v1, stated:** the runner flags `afterCycle` in every arm, cont included, and protocol v1 calls tracker outputs uninterpretable across any cycle. The inspector keeps cont's rows, because cont grinds nothing: its boundary moves no matter and no genome, so no tracker link crosses anything there.

**Pond dossiers on runner bundles.**
- The arm and P come from `manifest.cfg`. ponds.tsv is read by header name, so the extra columns of breed runs are ignored.
- The pond set is the run's, `tilesX · tilesY`, not whatever the first cycle holds (amended 2026-10-17, second review). A first cycle short of ponds is refused: since a short line before the last one already refuses, such a table is a single torn cycle, and no complete cycle establishes the pond set.
- The twin note says two bundles start from one world only when, besides configs equal apart from the arm and score and initial worlds equal at their `initHash`, nothing the runner applies after that world and before the first boundary differs (amended 2026-10-17, second review): the same scheduled interventions at steps before P, in order (step-0 lesions and feeds change the start itself; an entry at step P comes after that boundary's census and cycle), and no import or branch transform, neither of which `initHash` covers.
- The runner keeps stepping after an ended history, writing all-trait-0, donor −1 cycles. The history ends at the first of them, and the later ones are noted and not read.
- A bundle that starts after step 0 (a continuation, or a branch) has ponds.tsv rows only from its own first boundary. Its earliest nodes have no recorded parent, and the dossier says the ancestry continues in the earlier bundle instead of saying they grew from the initial disc.
- Arm breed reads like scaf, with the same selection caveat, its donors being the best-scoring ponds or a picker's.
- nat and shuf (survivors carry over, donor −2) are out of scope for pond dossiers in this change and refused by name. Their genotype dossiers use the walk above.

**Opening a packet's genotype.** With `mutations.tsv` present, the pond tool can open the dominant lineage L of the subject node (p, c)'s founding packet, row (c−1, p), as a genotype dossier.
- Its census step is (c−1)·P, where the packet was measured: L was alive in the donor's snapshot there.
- Its pond walk is anchored at (donor, c−1), not at L's own birth node. L must be born at or before cycle c−1, on that node's pond line.
- A subject with no founding packet in the bundle (its first cycle, or arm cont) is refused by name.
- The packet rule of the route applies to the opened packet itself (amended 2026-10-17, second review): a count of 0 refuses whatever dominant it names, and a count with no dominant is malformed. The anchored walk starts at the donor node and never passes this packet, so it is checked here.
- The census at (c−1)·P reads the same pre-cycle state as the packet's row, and lineages.tsv lists every lineage id held by any cell (no mass floor). So if L has no row there, the records contradict each other and the dossier is refused (amended 2026-10-17).

**Scale (amended 2026-10-17).** The genotype path streams ponds.tsv twice. The first pass keeps one donor per (cycle, pond); the walks run on those. The second pass keeps the full rows of the boundaries the walks pass, and nothing else. picks.jsonl is read line by line. Pond dossiers (`pond`) still hold the whole history, as they always have, because their clade series reads every node.

**Not claimed.** Which pond a lineage occupies at a census (lineages.tsv is world-wide), how many ponds it spread to, and anything between boundaries.

**Built (2026-10-17).** `tools/lib/pond-descent.ts` implements the rule above. `tools/lib/lineage.ts` adds `pond` (the route, null outside pond runs) and `trackerBirths.excludedAcrossCycle` to genotype dossiers. `tools/lib/pond-bundle.ts` reads runner bundles for pond dossiers and chooses the packet genotype. `tools/lineage.ts` drops both refusals and adds `pond --genotype [--genotype-cycle C] [--genotype-out file]`. The birth-cycle formula was checked against the CPU reference: `react` writes `LIN_HI = step + 1` before the step counter moves, so an id `hi` first exists in the state at step `hi`. In a real 30-step RefSim pond history (`tools/test/pond-bundle-fixture.ts`), every lineage born in the current period sat only in its birth tile at every census.

Real data: four 6,000-step ponds-small runs on the GPU, `deno run -A tools/run.ts --experiment slice8 --preset ponds-small --conditions treatment,pond-rand,pond-cont --seeds 1 --steps 6000 --census 100 --lineage-obs`, and the same with `--experiment slice8-picked --conditions treatment --picker random --pick-seed 7` (the pick seed is from the first build's notes; the manifest does not record it, but its `picks.digest` 510faf222af840e9 fixes the picks). Two are kept as test fixtures, trimmed to the files the tools read, each kept file byte-identical: `tools/test/fixtures/pond-runner/scaf-picked` (initHash 9efb956e1093d4e0, finalHash 51fb1cebe778a3dc) and `cont` (initHash 2b398e4e77c57db0, finalHash e423dc5a413bdc95). `tools/test/pond-bundle.test.ts` re-derives their numbers on every run. In scaf-picked, the ancestries of the 42 lineages in genomes.tsv give 85 edge walks, all exact, none refused or not recorded (an edge counts once per lineage whose ancestry holds it). 37 of them cross at least one boundary, and all 80 crossings name the parent as the packet's dominant. The ordered pick log agrees with ponds.tsv at all 6 boundaries. In cont, 197 lineages give 294 edge walks, all exact, with no crossings. births.tsv holds no row at a first census after a boundary in scaf-picked (the cut is a guard there), and cont keeps its 21 such rows, as the rule says. The plain scaf and rand bundles were run once and not kept. The first build reported 465 walks over all four runs; the two kept bundles account for 379 of them. Because every real crossing named its parent, the "not excluded" path and the refusal paths are exercised only on hand-built tables. Not done: the HTML panel does not draw the route yet (a gap line says so), and nat and shuf remain refused in pond mode.
