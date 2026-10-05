# Addendum: critique and counter-proposal from Claude Fable

2026-10-04 · Review of the proposal in this directory · No experiment run, no code changed, none of the five documents edited

**Reviewer.** Claude Fable 5.1 (`claude-fable-5-1`) in a Claude Code session, at the user's request. The [council packet](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/COUNCIL.md) asks for Fable 5; this is 5.1. It is one reviewer's reading. The Sol 6.1 High review that the repository policy requires has not been run, on the proposal or on this addendum.

**What I did.** I read the five documents and `BASELINE.json` (hashes at the end), the construction workspace's `STATUS.md`, `README.md`, `FABLE-REVIEW.md`, `NEXT-EXPERIMENT.md` and `RENEWAL-PLAN.md`, and this repository's `docs/plan.md`, `docs/reassessment-2026-09-30.md`, `docs/rules.md` and `plans/README.md`. I checked the transport, reaction and mutation arithmetic in `packages/sim-ref/src/step.ts`. I ran two things: a timing of the reference simulator on a 32×32 default world, and a script that calls the reference functions `w1d`, `mulShareD` and `cat` without stepping any world. I ran no trajectory in the witness habitat, with or without a nutrient reservoir. The renewal plan fixes its thresholds "before examining any trajectories", and a look from me would spoil that.

## Verdict

The documents are careful about what counts as evidence, and most of the data contracts are worth adopting as written. My disagreement is with the order of work and with the choice of worlds.

As planned, a renewal experiment that needs about half an hour of one CPU core waits behind two stages of infrastructure. The first experiment with mutation on is five stages away. Every world mapped before then has flow off, mutation off, and room for at most 40 to 136 cells of living biomass. The whole simulation budget through Stage 5, replays included, is about 41 core-hours at the rate I measured, so compute is not what limits progress.

What limits it is an untested premise: that a capability score from these small worlds predicts anything about evolution in the worlds the project cares about. Two earlier proxies in this project failed that test. I suggest three cheap experiments that would show whether the workbench has a subject, and a different unit of search if it does.

## What I would keep

- The three layers (feasibility, accessibility, opportunity) held apart, with no combined score.
- Finite batches reduced in canonical case order, so machine speed cannot steer a search.
- Case identity as a hash of the resolved spec; a digest of the source closure, since jj workspaces are often dirty; observation digests enforced at acceptance, which closes a real gap in the legacy segment check.
- Separate calibration, discovery and confirmation namespaces; a cached observation never counted as a fresh replicate; frozen project observables kept out of the optimizer.
- Extinctions retained, technical failure kept distinct from a biological negative, and "unsupported within the tested domain" as a valid result.
- Cloud allowance zero by default, with a termination deadline and not only alerts.
- Reviews marked pending, not implied.

## Findings

No P0: nothing has run and no frozen artifact is at risk. Each finding gives the evidence and the smallest repair I can see.

### P1-1. A half-hour experiment sits behind two stages of infrastructure

**Evidence.** [PLAN](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/PLAN.md) Stage 3 runs the renewal experiment "through the workbench adapter", after Stage 1 (schemas, CPU case runner) and Stage 2 (discovery queue, workers, two-host demonstration). The [renewal plan](/Users/nicholas/develop/browser-life-construction/experiments/construction/RENEWAL-PLAN.md) is already complete, with its own runner, verification and report. It caps at 612,000 steps including replays. I measured 384 steps per second for a 32×32 world on one core of the M1 Max (26.0 s per 10,000 steps, default rule-1 config with flow on, other sessions sharing the machine). That is about 27 minutes before observer overhead, which I did not measure. The council packet's first unresolved question, whether renewal exists in this witness family, is the one whose answer decides whether Stages 3 to 5 have anything to map.

**Repair.** Run the renewal experiment standalone in the construction workspace, as its own plan describes. The workbench imports the artifacts by identity later, which Stage 3 already permits.

### P1-2. Every world through Stage 5 has flow off, mutation off and a very small population

**Evidence.** Stage 4 uses "the witness's rule-1 settings" and Stage 5 preserves "all other settings". `witness-v1.json` has `dtQ` 0, `motility` false and a 32×32 tile. With those two settings displacement is identically zero (`step.ts:240-251`), so the Lenia affinity field moves nothing and only the box spread moves bound matter. Total matter in the two habitats is 5,120 and 17,408 quanta (renewal plan, section 4). At the readout's own threshold of 128 B per cell that is at most 40 and 136 cells, if every quantum were biomass. A mutation rewrites a whole cell's genome in place (`step.ts:502-514`), so the number of genotype-bearing units is the number of occupied cells.

**Why it matters.**
1. The method is borrowed from Flow-Lenia universe search, and flow is zero in every universe mapped.
2. Stage 6 needs "coexisting inherited variation capable of differential success". In a population of at most about a hundred cells, only large fitness differences can be told from drift.
3. The main ecology runs 256×256 tiles with 256 nutrient per cell, `dtQ` 51, `spread` 8 and `gateK` 64. No mapped point is near it, so nothing learned transfers by default.

**Repair.** Name the world family that Stage 6 will use before building Stage 1, and make tile size and total matter explicit axes. The renewal observer rejects any config with flow; require a census-based version that works with flow on before any search depends on it.

### P1-3. The searched axes change what survives, not what can evolve

**Evidence.** Stages 4 and 5 vary four rate constants: `kCatHalf`, coupled `diffA`/`diffC`, `spread` and `gateK`. The reaction menu, the controller (10 → 8 → 8, all eight outputs in use) and the mutation operator are untouched. Light, geometry, mutation rate and founders are held fixed. The project's evidence points at the fixed ones:

| Evidence in the project | Axis it implicates |
|---|---|
| Variation gate: viable role-changing mutants for 1 founder of 12 (`docs/plan.md`, gate results) | Genotype-to-phenotype map, mutation supply |
| Founder diagnostic: 11 of 24 genomes count against 1 of 12 founders | Founder set |
| Scaffold registration, H1 and H2 confirmed 2026-10-03: `scaf` 0.979 against `cont` 0.623 and `rand` 0.025 under one physics | Population structure and life cycle |
| Planet sandbox: blind drifting beats sensing on a steady sun and crashes on a wandering one | Forcing |
| User's informal report that `seasons` and `soup` break the static-lattice attractor | Forcing, initial diversity |

`docs/plan.md` decision 7 itself imagined environment generation over light and cycle regimes.

**Repair.** If worlds are to be searched, start with axes that have prior evidence of changing evolutionary outcomes: forcing (`seasonPeriod`, `seasonAmp`, light mode), mutation supply (`mutRate`, `mutStep`), population structure (tile size, migration, the pond-cycle keys) and founder set. All are existing rule-1 config keys. Rate constants come later, as viability tuning.

### P1-4. Nothing tests whether a capability score predicts an evolutionary outcome

**Evidence.** PRD requirement S8 calibrates descriptors against positive and negative controls inside the assay's own habitat. That shows the assay measures what it says. It does not show the measurement matters. `plans/README.md` records two proxies that passed their own checks and failed in open worlds: founder 7's mutants change role in the evaluator in 27 to 32 of 32 seeds, yet it originates no role in open worlds; and the weights-only probe failed validation. Foundations test 6 found none of four activity, novelty and role measures eligible. [RESEARCH](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/RESEARCH.md) cites the warning, but no gate in the plan checks prediction.

**Repair.** A retrodiction gate before Stage 1. The project has pairs of worlds whose evolutionary outcomes are already known to differ: the three pond regimes, `gradient-m3` against `spots-m3`, steady against wandering sun. Write down what the capability battery predicts for each pair, compute it, and see whether it orders them correctly. Two outcomes are already foreseeable and both are informative: the pond regimes share one physics, so a physics-capability score cannot separate them; and the renewal observer cannot run on any of these worlds, because they have flow.

### P1-5. Stage 5 cannot answer its own question, and its domain is small enough to enumerate

**Evidence.**
- The domain is 8 × 6 × 4 × 7 = 1,344 candidates. Each method gets 16 proposals after 8 shared anchors, in 3 campaign blocks. With three paired blocks the smallest possible one-sided sign-test p-value is 0.125, so no outcome can separate the methods from chance.
- The first descriptor is a minimum over habitats of a mean of six pass/fail outcomes. In the witness study the five seeds agreed in every arm, so expect about four distinct levels. The second descriptor is zero at `spread` 0 and close to a function of the first at `spread` ≥ 1 (see the arithmetic section). A 4 × 4 archive will have few reachable cells, and goals sampled in unreachable cells waste proposals.
- Michel et al. searched a high-dimensional continuous space with on the order of two thousand runs per search (as I read the paper's HTML; not checked against the PDF). Sixteen proposals over four integer axes is a different regime.
- Enumerating all 1,344 candidates under the full 16-case protocol is 21,504 cases, about 155 core-hours at the measured rate: under a day on the Mac's eight performance cores.

**Repair.** Enumerate the domain. Then compare IMGEP with random search offline, by replaying both against the stored table with thousands of search seeds. That costs no simulation and has real statistical power. Bring search back when a domain outgrows enumeration.

### P2-1. Four problems in the renewal readout

1. **The threshold is tied to one value of a varied axis.** V = 128 was chosen because it equals `kCatHalf`. Stage 4 varies `kCatHalf` from 64 to 256 and Stage 5 from 32 to 512, while keeping B ≥ 128. Catalytic efficiency `cat(B)/B` at B = 128 runs from 0.80 at `kCatHalf` 32 to 0.20 at 512. The map then mixes a change in physics with a change in how strict the threshold is. *Repair:* state the threshold in units of `kCatHalf`, or lead with the flux conditions Q and R.
2. **The off-source clause barely discriminates.** At `spread` 0 nothing moves, so 144 of Stage 4's 432 logical cases cannot register the primary endpoint. At `spread` ≥ 1 no isolated cell can hold itself (arithmetic below), so a maintained source already implies dense neighbours, and the qualifying site may be the adjacent cell. RENEW then means roughly "a patch at least two cells wide persists". *Repair:* require a minimum distance from the founder, or score growth in the number of maintained sites between two windows. Treat `spread` 0 rows as a separate persistence question.
3. **The threshold sits inside the coarsest transport band.** At `spread` 1 a cell sends exactly one quantum per edge for every B from 69 to 136, and nothing below 69. The B64 small-founder probe at `spread` 1 is therefore the `spread` 0 probe unless it grows past 68. *Repair:* tabulate the bands for each candidate before running, and relabel or drop degenerate probes.
4. **Imported free energy can pay for local synthesis.** E travels with B at the same share (`step.ts:290-299`) and GROW spends E. A neighbour could meet Q ≥ 128 and R ≥ 0 while growing on energy harvested at the source. The plan disclaims independence from dissolved resources, not from imported energy. I think this is unlikely to be the main support, since every cell carries the same photosynthesising genome, but the readout cannot tell. *Repair:* report each qualifying site's net E transport and photosynthesis over the window.

### P2-2. The seed policy repeats the shared-mutation-stream confound

**Evidence.** [DESIGN](/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/DESIGN.md) section 3 has paired arms share a physics seed. Whether a mutation fires at a given step and cell, which weight it hits and by how much are all draws keyed on seed, step and cell (`step.ts:502-508`). Arms that share a seed share those draws. That is what produced the construction study's five improvements in two seed blocks with overlapping events, corrected in its 2026-10-04 reporting amendment.

**Repair.** Shared seeds are right for mutation-off comparisons. For mutation-on arms, either give each founder arm its own seed, or count a seed block as one unit however many arms it holds. Say which in the frozen protocol.

### P2-3. A fixed founder panel does not separate physics from founder fit

**Evidence.** The three biological arms are the witness, its one-byte variant and one selected nonbuilder, all designed or selected at the anchor point. S9 says crossing candidates with fixed founders distinguishes environment from physics. It holds founders fixed, so a world where these particular controllers are miscalibrated scores as a world that does not support renewal.

**Repair.** Widen the panel to a disclosed family that spans controller space. The 103 comparators from the construction search, which include the 12 M3 founders, are on disk. Report "best of panel" and "fraction of panel" separately. Otherwise call the map what it is: the witness genome's tolerance to parameter change.

### P2-4. With mutation off, new seeds sample only rounding noise

The proposal already calls its 4-of-5 rule a screening gate, which is right. I would add that with mutation off, a new seed changes only stochastic rounding and lottery draws. The generalisation that matters is across founders and habitats, where n is 3 and 2. Spend confirmation budget there.

### P2-5. The infrastructure is sized for a workload that fits on one laptop

**Evidence.** Stage 4 is at most 1,104 case executions and Stage 5 is 4,608 with full replay. At 26 s each that is about 41 core-hours, or roughly five hours on eight cores; double it for observer overhead and it is still one night. The project's proven fleet path is shell lanes, a supervisor and a device golden check, which ran the registration's 757 commands with no failures. `tools/assay.ts` already splits resumable work with `--part k/N`. `plans/README.md` rejected "scheduling exploratory runs through the coordinator" as a large build before cheap readouts say which lever binds, and I see nothing since that reverses it. Separately, Stage 4's ablation arm needs `polymerTransport`, which exists only in the unlanded construction workspace beside rule-2 code. Landing that is a decision the plan mentions and does not cost.

**Repair.** Keep Stage 1. In place of Stage 2 for now: a frozen manifest, a runner with `--shard k/N` that writes each case into a directory named by its case ID and skips cases already present, and a reducer that refuses an incomplete set. Two machines then means two shards and a directory copy. Build the discovery plane when a registered campaign exceeds about one Mac-day, which will most likely be when worlds need the GPU. Decide then whether a second queue or validated overrides on the existing island path is the smaller change.

### P2-6. The research summary leaves out the project's own closest evidence

The "existing local head start" table lists the engine, the search package and the queue. It does not mention the scaffold registration, the frozen transition hunt (Stage 0 passed, Stage 1 awaiting its draw), the foundations review, the entity-measurement limitation, the ownership and cells screens, or the planet sandbox. Several requirements re-pose questions those lines already have instruments or results for:

| Requirement | Already in the project |
|---|---|
| S4, heredity by common garden | Scaffold registration H2: evolved genome against a relabelled-ancestor control on the same fragments, 24 of 24 |
| S5, frozen mutant panel | Foundations test 2: 2,400 mutants, 12.9% viable and changed; `tools/assay.ts mutants` |
| S7, disturbance benefit | Ownership and cells screens with recurring wounds (unlanded sandboxes): more turnover, no consistent gain in regeneration |
| Selection among coexisting variants | Foundations test 4b: late implants beat early ones in the early state in all 10 histories; neutral control 0 of 5 |

**Repair.** Add these to RESEARCH with what each does and does not establish, and reuse the two instruments that have separated treatment from null here (the matched genome control and the time-shift implant).

### P3

- 576 of Stage 5's 2,304 cases are ablation-arm cases, which the descriptors exclude. They cannot affect the Stage 5 comparison.
- Michel et al.'s goal space is built from evolutionary activity, compression and multi-scale entropy. This project's null calibration rejected its own activity and novelty measures, so the proposal is right not to import them. Say so in RESEARCH, so nobody adds them later.
- Replaying every case with the same code on a deterministic integer simulator detects host faults and nondeterminism, not errors in shared logic. DESIGN says this. The export should not label such replays independent evidence.
- `BASELINE.json` records git head `5f73fac`; the documents themselves are in commit `7a96fd7` in the main checkout.

## Arithmetic the map should start from

DESIGN section 1 asks for cheap feasibility checks before expensive histories, and the plan then uses none. Here is a first one, computed with the reference functions for a cell with zero displacement, at the witness's rates and uniform light 255. No world was stepped.

| `spread` | Bound mass leaving a cell per step, large B | Smallest B that exports anything | One quantum per edge up to B = | Isolated cell's best net change per step at `kCatHalf` 32 / 128 / 512 |
|---:|---:|---:|---:|---|
| 0 | 0 | none | – | no transport |
| 1 | 5.97% | 69 | 136 | −0.17% / −1.45% / −2.70% |
| 2 | 11.42% | 37 | 72 | −3.31% / −4.76% / −5.78% |
| 4 | 20.99% | 21 | 40 | −8.28% / −9.68% / −10.44% |
| 8 | 36.00% | 13 | 24 | −15.45% / −16.71% / −17.07% |

The last column takes the most favourable B for an exporting cell that receives nothing: photosynthesis at full output, plus the most growth that decomposition energy can fund, minus decay and export. It is negative everywhere in the Stage 4 and Stage 5 domains.

What follows from it:

1. At `spread` ≥ 1 no single cell can sustain itself. Persistence needs a patch whose cells feed each other and lose only at the perimeter. Whether such a patch exists depends on production against perimeter loss and on total matter. At the lower reservoir level the world holds five quanta per cell on average.
2. The parameters that govern this balance are production (`kPhoto`, light), `spread` and total matter. Stage 4 varies only `spread` among them.
3. Integer floors create a state that exports nothing. A cell below the first-export threshold keeps all its mass, which is a property of the arithmetic and should not be read as a regime.
4. With `gateK` 1 the gate is `floor(D / (1 + P_s + P_t))` (`step.ts:351`). Once the polymer on a pair of cells reaches D, that face is sealed completely. The diffusion axis values 50, 100 and 200 mostly move that sealing point.

This is not a prediction that renewal fails. It says what renewal would take. It should become a tested fixture before anyone relies on it; the reactions round stochastically, and I computed expected values.

## The council's ten questions

1. **Can the readout pass wrongly?** Yes in the ways listed under P2-1. Passive deposits and rotating sites are handled by the plan as written.
2. **Does the map isolate physics from founders and habitat?** No (P2-3). Compute is not the constraint; 9 of the 27 points cannot show renewal at all.
3. **A different axis?** Replace the coupled diffusion axis with total matter per cell at four or more levels, or with `kPhoto`. The arithmetic says those govern whether a patch can exist.
4. **Are the descriptors useful?** Not shown (P1-4), and nearly one-dimensional (P1-5). The retrodiction gate is the falsifying experiment.
5. **Sample-size inflation?** Shared seeds under mutation (P2-2) and seeds standing in for founders (P2-4).
6. **A simpler test of combinability?** Yes, experiment 2 below. Before a Stringmol-style chemistry, the project's own unbuilt mechanisms (duplication, silent slots, modular weight blocks; `docs/plan.md` decision 4 and M4's registered pivot) are the natural candidates for a new law.
7. **Selection without declared organisms?** Yes. Minimum evidence: two marked genotypes in one world with mutation off, started at 10:90 and at 90:10; the log ratio of genotype-labelled biomass moves the same way in both starts and in most blocks; and the direction follows the genome when the two starting positions are swapped. Split the change into synthesis and lottery takeover, because the lottery relabels a cell's whole content at no cost (`step.ts:311-335`). Single-site mutation accumulation cannot produce that pattern.
8. **The stress experiment?** Sound as written. Add a minimum population size (P1-2) and start from the wound screens' finding.
9. **Namespace and acceptance?** The design is right. I confirmed only that queue creation keeps a fixed key list with `Map.take` and that `RunSpec.overrides` exists in `packages/runner/src/runner.ts`; I did not audit the acceptance path.
10. **Is the two-machine path simple enough?** CPU first, yes. Shards are simpler than a queue at this scale (P2-5).

## Three cheap experiments before any build

Each needs its own short frozen protocol (seeds, thresholds, decision rule) and a Sol review before it runs. I have not written those.

1. **The renewal experiment, standalone** (P1-1). About half a core-hour. It decides whether there is a renewal regime to map.
2. **A second-opportunity test in conditioned fields.** This tests the README's own hypothesis directly: that one capability creates an opportunity for another. Run the builder for a fixed time and snapshot the fields. Plant each of the 103 disclosed genomes into the conditioned field and into an unconditioned field matched in matter and energy, mutation off, with the transfer logged as an analytical intervention. Ask whether any genome does better because of what the builder left behind. If none does, try to design the complement by hand, for example a genome that lives on the waste a sealed patch leaks. The construction witness shows what building by hand buys. If someone who knows the rules cannot build the second link, a search over four rate constants will not find it, and that is much stronger evidence for a new law than a finite failed search.
3. **The retrodiction check** (P1-4). Mostly reading existing run bundles.

## A different unit of search

If those experiments leave a subject, I would change what one evaluation is.

- **Unit.** One candidate is one GPU world of many independent tiles with mutation on and a fixed founder set, beside a twin with mutation off. The existing machinery already batches tiles this way: the M3 evaluator, and pond worlds with 64 tiles of 64×64.
- **Readout.** The gain of evolved populations over their own ancestor in a common garden, against a matched control. "Cumulative" then has a plain operational meaning: the gain at twice the time exceeds the gain at the earlier time, and later populations beat earlier ones as well as the ancestor.
- **Role of the capability assays.** Maintenance and renewal become viability filters that reject dead worlds cheaply. They stop being the descriptors.
- **Axes.** Those in P1-3.

This is the workload where the GPU and extra machines matter, and where the proposal's case contract and, eventually, its coordinator design earn their place.

The risks are real. Time-shift assays in this project have hit an extinction floor (test 4). Short horizons measure fast adaptation, not open-endedness. Each candidate costs dollars, not seconds, so candidates number in the tens and the design is a factorial, not a search.

## Suggested order

| Order | Step | Rough cost | What it decides |
|---:|---|---|---|
| 1 | Renewal experiment, standalone | Half a core-hour plus the implementation its plan describes | Whether Stages 3 to 5 have a subject |
| 2 | Conditioned-field test | Hours of CPU | Whether rule 1 supports the second link of the causal chain |
| 3 | Retrodiction check | Mostly existing bundles | Whether capability scores track known evolutionary differences |
| 4 | Stage 1 contracts, sharded runner, reducer | Engineering only | – |
| 5 | Enumerate the rule-1 domain, if step 1 is positive | Under one Mac-day | The map itself, and an offline search comparison |
| 6 | Evolution-on world evaluation | GPU, dollars per candidate | Whether any axis changes cumulative gain |
| 7 | Discovery plane in Phoenix | When a campaign exceeds one Mac-day | – |

If step 1 confirms renewal and step 2 finds a genome that benefits from the builder's field, the rate-constant map becomes worth making and I would withdraw part of P1-3.

## Not verified

- The licensing table and the external repositories.
- The paper, beyond a machine summary of its arXiv HTML page.
- The construction study's raw data. I relied on its README and STATUS.
- The ownership and cells results, which come from write-ups in unlanded workspaces.
- The coordinator beyond the two points under question 9.
- My timing is one run on a shared machine, and the per-step observer's cost is unmeasured.

## Provenance

SHA-256 of the bytes reviewed, in `/Users/nicholas/develop/browser-life/docs/evolvability-discovery-2026-10-04/`:

| File | SHA-256 |
|---|---|
| `README.md` | `194e97a70f6bb7586f4d9573fda1a2cbe03d4f82d44e6b499397b26bec6ebe14` |
| `RESEARCH.md` | `3697ae398987cec217129ee35794751746baffdd4b29b71dd0a4f7edfa70d29b` |
| `PRD.md` | `17407a7426766f0b69d938114e6bdb8c7ca08f3d1683afdbf82460661bde5e77` |
| `DESIGN.md` | `a3077b3aa12b3d05242c83b0c8f882e5f47fc118ab993fe997e9ae79298e849d` |
| `PLAN.md` | `42aa33bf98497bb958cda105c9ef1a52e0fd963cecb98632018a0862f42bf177` |
| `COUNCIL.md` | `7ade476301f36ffce3fc35b556df8577170956d4acd16cf97cc447781530037e` |
| `BASELINE.json` | `82f3842c78a4fa8ebdd3531ac8c2d19c536318b178beb33ed350bee08a64980d` |

Source lines cite `packages/sim-ref/src/step.ts` as it stands at `03e5ff6`, which is byte-identical to the main checkout's copy. Session `c7c46545-1fcd-4a81-9a30-695683f6331c`. The timing and arithmetic scripts were scratch files and are not kept in the repository; both are a few lines and I can add them under `tools/` if they are wanted as fixtures.

## Errata after Astra's review (added 2026-10-04)

Everything above this heading is the text Astra reviewed (SHA-256 `d67a25f7ad3ee8934f5d6572fa6193db541fd55126b320cf49c4e486b1930a19`). Its review is in [REVIEW-ASTRA.md](REVIEW-ASTRA.md) and the item-by-item dispositions are in the [council record](COUNCIL.md). The plan to implement is the revised document set, not this addendum. Errors of fact and overstatements above, all confirmed against the sources:

1. **Nutrient in the main ecology.** "256 nutrient per cell" is wrong. The registered presets start with 32 (`packages/schema/src/presets.ts`); 256 is a helper default.
2. **Population cap.** "At most 40 to 136 cells of living biomass" should read "at most 40 or 136 sites at the readout threshold at once". Cells below the threshold still react and carry genomes, and the tile has 1,024 cells. The drift argument built on the cap is unsupported.
3. **Isolated-cell column.** It is a heuristic in expectation, not a bound. With stored free energy a cell can gain biomass in a step (Astra's B = 136 example). The maximum was taken only over B ≤ 4,096, and non-exporting states are not covered. What P2-1 part 2, P1-5 and answers 3 and 4 concluded from it is withdrawn as conclusion and kept as hypothesis.
4. **Small-founder probe.** The B64 probe at `spread` 1 is not the `spread` 0 probe. It starts with E = 128 and sends four quanta of free energy on its first step.
5. **Enumeration cost.** "Under a day" left out the proposal's full replay (38.8 hours on eight cores at the measured rate) and all observer cost.
6. **Renewal cost.** "A half-hour experiment" understates P1-1. The runner, observer and verifier are planned, not built.
7. **Hand-built complement.** The claim that a failed hand design means a rate-constant search cannot succeed is withdrawn. Other rates could make a complement viable.
8. **Retrodiction.** Withdrawn as a gate. An observer that cannot run on a world returns "unsupported", which is not evidence about that world.
9. **Seed policy.** P2-2 misdescribed the proposal, which already counts shared-seed arms as one block.
10. **Axes.** P1-3's heading is too strong. Rate constants can change which variants are viable and which opportunities exist.
11. **Wounds.** The summary conflated two results. Wounds lowered lineage turnover in the ownership screens and raised it in the cells wall arm.
12. **Config keys.** Founder sets are initialization inputs, not config keys, and migration and pond cycling have compatibility constraints.
13. **GPU unit of search.** The batch evaluator fixes `mutRate` 0, pond tiles are coupled by the cycle, and no price per candidate exists. It is a later design option, not a ready replacement.
