# Evolving ecosystem sandbox — 2026-10-25

## Intent and scope
Optimize for sustained, varied, legible life-like behavior. Build an explicitly engineered, browser-playable descendant of Candidate 9's cyclic ecology. The invasion result (four seeds, both markers) showed supplied inherited advantages can spread, not improved ecosystem survival or spontaneous evolution. This sandbox uses a separate, small CPU lattice model, not the native 3D kernel. It deliberately introduces reproduction, inheritance, bounded mutation and external food. Existing physics, frozen experiments and results remain unchanged. No deployment.

## First playable version
A seeded 96×96 toroidal world with three cyclic founding families. Each occupied site has family, attack, defense, energy and age. Local offspring inherit traits; occasional one-point attack or defense mutations remain in 0–4. Family colors stay stable; brightness shows defense. Trait upkeep costs energy each turn, including for the engineered immune and counter-predator families. Empty neighboring sites allow reproduction, splitting parental energy. Predation uses cyclic target eligibility plus attack versus defense; successful attacks replace prey with an offspring. Age and starvation create vacancies. Resources regrow locally; uptake and resource supply are explicitly engineered, not matter-conserving research physics.

At tick 100 seed a protected descendant of family 0; at tick 300 seed a costly predator that can attack it. Mark these interventions in the event log. They occur once per reset, never silently rescue extinct families. Manual introductions and drought are also labeled. The protected family retains family 0's target; the counter-predator targets the protected family and remains vulnerable to a founding family. Weak attacks have a small success probability, so protection is relative rather than absolute immunity.

Spatial fertility varies continuously. Fixed refuge patches reduce attack success and improve protected-family feeding, allowing space for different strategies. Every 500 ticks a local, temporary drought reduces food renewal in a circle, never globally. User can toggle mutation and automatic weather, pause, step, change speed, reset the seed and stage interventions manually. Seed, settings and events appear in downloadable JSON; reset reproduces the default trajectory for a given seed. Changes mid-run are recorded.

## Presentation
Dedicated `/ecosystem/` page, dark pond-like canvas, family legend and counts, population history, mean traits, births/mutations/deaths, and chronological intervention/extinction/recovery notices. Explain engineering directly on the page. Responsive layout, keyboard controls through standard labeled buttons, reduced-motion starts paused. Bounded histories and event log; avoid DOM updates every simulation step. Link from documentation without rewriting research evidence.

## Validation and exploration
Unit tests: deterministic replay; bounds and occupancy; inherited traits with mutation disabled; actual variation when enabled; trait upkeep cost; introductions are one-shot; refuge and drought behavior; no implicit resurrection. Run 3 fixed seeds for 3000 ticks, record population diversity, mutation events and turnover. This is a creative diagnostic, not a survival claim or statistical gate. Revise if all worlds empty/freeze/monopolize; report remaining limitations honestly. Inspect browser rendering and controls and run typecheck plus relevant legacy hash tests and build.

## Workflow
1. Save plan, Claude read-only review; resolve findings.
2. Implement model, page, meaningful tests and exploration report.
3. Claude read-only implementation review; fix findings and rerun relevant checks.
4. Record decisions and validation, commit. No deploy.

### Execution decisions
- Use floating-point energy/resource budgets in the separate sandbox; do not imply exact conservation or native-kernel equivalence.
- Randomized, once-per-tick update order with newborns deferred to next tick avoids directional or repeated-birth artifacts. Eight-neighbor movement and toroidal boundaries.
- Population traces are per founding family (not individual phylogeny). The trait histogram and mutation count expose within-family change; do not call every mutation a new species.
- Event history and chart history are bounded; exports explicitly state their retention windows. Interventions never claim that extinct families recovered spontaneously.

### Claude plan review resolution
Review: `ecosystem-sandbox-reviews/plan-claude.md` (Claude Sonnet, read-only; initial default-model attempt stalled and was stopped).
- Separate PRNG streams for scheduling, births, combat, weather and introductions. Same-browser reproducibility only. Export is a bounded observation record, **not** a replay/checkpoint format; includes current state, constants, settings and dropped counts. Reset replay is tested.
- Target sets: 0→1, 1→2, 2→0 and protected (3), protected→1, counter (4)→protected; family 1 also attacks counter. No automatic reintroductions after the one-shot staging. Seed 24 cells near the protected patch, replacing existing occupants explicitly.
- Baseline: resource cap 8, renewal 0.65×fertility, uptake cap 1.8, upkeep 0.45+0.18×attack+0.23×defense, birth threshold 10, half energy to offspring; max age 160. Thus 4/4 upkeep=2.09 exceeds uptake. Successful predation grants 3 food-energy units (explicit external subsidy) before energy split. Attack probability clamp(0.35+0.16×(attack-defense),0.03,0.9), ×0.25 in refuge.
- Drop family-specific refuge feeding subsidy. Refuges reduce predation for everyone. Mutation probability 0.04 per birth, one coordinate ±1 reflected at boundaries.
- Record Shannon diversity over family/attack/defense, occupied trait classes, and turnover=(births+deaths)/(sites×ticks). Diagnostic flags: under 5% occupancy, >95% one-family share, or no births over last 100 ticks. Compare staged/un-staged runs for each of 3 seeds.
- Cap per-frame work, suspend advancement while hidden, reduced-motion pause, standard controls, bounded UI history (300 samples/100 notices), accessible textual counts. Export versioned observation snapshot with retention metadata.

### Exploration-driven revision (model v2)
V1 sustained founding diversity but both introduced families vanished in all 3 seeds: a failed staged arms race. Retained readouts: `ecosystem-sandbox-exploration-v1.json`. Revised explicitly, not selected as confirmatory evidence:
- Food renewal 1.2×fertility; uptake cap 2.4. Upkeep 0.45+0.25×attack+0.35×defense (4/4 cost 2.85 > uptake).
- Protected founders: attack 1, defense 3, energy 20. Hunter: attack 4, defense 0, energy 20. Still 24 introduced cells each.
- Plant protected family in the richest currently Amber-occupied patch. Hunter seeds near a living protected cell when available.
- Deliberately restore the immune-clone idea: Violet cannot attack protected descendants with defense ≥2. Mutation can lose that protection. Hunter ignores this special immunity. This categorical rule is engineered and labeled in the page.
All three v2 staged worlds retain all five families at tick 3000, with 70–73 occupied family/trait classes. Both introduced families grow and fluctuate after planting. This earns a playable prototype, not claims of open-ended evolution or survival improvement.

### Review correction (model v3)
Codex precommit review caught movement reusing the newborn marker: moving adults incorrectly became immune for the rest of that tick. Separate the already-acted set from birth tick. Newborn deferral remains intentional; moved adults remain vulnerable. Added a fixed-order regression. Reran all six diagnostic worlds: all three staged worlds still retain five families, now 69–73 occupied trait classes. V2 readouts retained separately; the unsuffixed exploration file is the corrected v3 result. Export browser verification now parses the saved payload.

### Claude implementation review resolution (model v4)
- Fixed census side effects: pure `census()` for display/export, `sample()` only for the engine's recorded cadence. Tick-based chart; observations do not change notices, peaks or stored history. Added regression.
- Label averages as population-wide, not within-lineage drift. Reset recovery peak at every explicit planting; add regression. Mix seed and stream channel before creating PRNGs; randomize hunter target among protected cells. These change trajectories, so final diagnostics rerun rather than reusing v3 numbers.
- Share refuge geometry, initialize form values from model, remove repeating live announcements, label drought replacement and manual planting superseding scheduled arrivals, explain attack births/energy subsidy, assert nonempty mutation-off test, validate constructor inputs.
- Bounded intervention notices and no replay remain deliberate scope choices, declared in UI/export. A separate unbounded intervention log would contradict bounded memory. Building a route does not deploy it: retain build integration, test accessibility in the sandbox browser test, and do not deploy. `Fast` is a qualitative pace bounded by available CPU; no promised achieved rate.
- Do not infer causal effects of mutation or immunity from these exploratory trajectories; no ablation claim is made. Long-horizon collapse, full ancestry tracking and an adaptive chart scale remain possible follow-ups, not requirements for the first playable world.
- Final v4: seeds 1101/1102 retain five families; 1103 loses Jade and Hunter, retaining three with 67% Protected. All six staged/un-staged runs remain populated, reproducing and below the 95% monopoly flag. Keep this variable outcome; don't tune for a perfect score.
