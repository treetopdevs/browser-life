# I05 controller locality: evidence and go/no-go

Exploratory. CPU only (deterministic integer reference simulator and controller probe); no GPU evidence. Bounded to the tested genomes, the one-step operator, the 26,244-point probe grid and three short 16x16 tiny-world assays. Nothing here is a confirmation. Artifacts: `evidence.json` (sealed payload), `manifest.json` (source hashes, provenance), checked by `tools/locality/matrix.ts --check` / `--replay-check`. Page: `apps/lab/controller-locality/` (local, off the deployed site).

## What was run

- Start genomes: hand-built generalist (positive control and measurement qualification, does not vote); M3 cluster 4 (sparse slot, passed the gate); M3 cluster 16 (dense slot, **failed** the viability gate: light-growth 924 permille, 19 permille under dark-persistence, so it is recorded as failed); M3 cluster 9 (dense slot, passed, used). The candidate order (sparse: 4 then 10; dense: 16 then 9) was written in PLAN.md before the outcomes, but the horizon and gate below were calibrated with the M3 baselines visible, and the floor is what excluded cluster 16 (924 permille against a 1000 floor), the plan's preferred dense genome.
- Neighbourhood per genome: 94 edits (62 single-locus, 16 matched-magnitude multi-locus at total |delta| 24, 16 equal-slot-count secondary), all through the real `mutateInPlace`.
- Assays: light-growth, dark-persistence, dim-transfer; 2 paired seeds; horizon 200; 24 stratified assayed edits per M3 genome, 8 for the generalist. Neutral fixtures give exactly 0 deviation; sensitivity check passed (zeroing `w2 h1->photo` moved generalist light-growth by -2005 against tau 167).

## Readouts (finite-panel counts, per genome, never pooled)

| | generalist (control) | M3 c4 (sparse) | M3 c9 (dense) |
|---|---|---|---|
| edits that change the genome | 91/94 | 90/94 (2 unchanged, 2 boundary-clamped) | 91/94 (2, 1) |
| genuine edits silent on the probe | 51/91 | 33/90 | 11/91 |
| genuine edits undone by one operator step | 90/91 | 89/90 | 90/91 |
| assayed genuine edits viable | 8/8 | 24/24 | 24/24 |
| assayed edits improving a response by tau (A) | 2/8 | 1/24 | 1/24 |
| of A, harming another (C) / harming none (K) | 0 / 2 | 0 / 1 | 0 / 1 |
| median actuators moved by genuine w1/b1 edits (real vs degree-matched null) | 0 vs 0 | 1 vs 0 | 5.5 vs 7 |

Probe-level locality: most genuine edits move few actuators; the dense M3 genome 9 is far less silent (12% vs 37% for the sparse genome) but its w1/b1 edits move *fewer* actuators than the same weights placed at random (5.5 against 7), so its breadth looks like dense wiring rather than locus-specific entanglement. Viability is 100% of the assayed edits at a loose floor (500 permille of starting biomass); improvement is rare (1 of 24 per M3 genome, about 4%, inverse-probability-weighted 35 permille).

## Decision rule outcome

**Inconclusive (underpowered).** Both M3 genomes have A = 1, below the pre-stated minimum of 5 improving edits, so no collateral-loss or useful-neighbourhood statement is made. The rule's entanglement branch also could not fire on the probe half alone (c9 breadth does not exceed its null).

## Go/no-go for a separately versioned controller architecture (advisory, exploratory, bounded)

**No-go on this evidence; not a refutation.** Nothing measured here supports starting a modular-controller fork: the dense genome's wide actuator footprint is matched by its degree-matched null, there is no observed collateral loss (C = 0, because improvements are too few to say), and the sparse genome's edits are mostly local or silent. What the data do show is that useful edits are rare in this neighbourhood (about 4% of assayed edits), which is a statement about search efficiency on two genomes, not about representation. A later plan would need more improving edits (assay every genuine edit, longer or more varied scenarios) before any collateral-loss claim, and a fork would have to be parameter-, mutation-opportunity- and initial-quality-matched with search and transfer reported separately.

## Deviations from PLAN.md, and what is not done

- Calibration measured about 0.3 to 0.9 s per 200-step run, not the 19 ms/step in the plan. H was fixed at **200** (not 60-100) because at 80 steps the M3 genomes do not separate light from dark, so the M3 baselines were seen when H was chosen. H, tile, radius 6 and the gate floor 1000 / margin 250 were chosen on baselines (the generalist and the M3 candidates), never on the improvement fraction of any neighbourhood. PLAN.md section 3 says the floor, margin and tau were frozen from the generalist before being applied to M3 genomes; that is not what happened, and cluster 16 fails both calibrated criteria (light-growth 924 below the 1000 floor, and a light-over-dark gap of -19 below the 250 margin). The decision rule thresholds were written before any outcome was computed; the gate was not fixed in advance of the M3 data. Dim scenario: light 20 + 60, nutrient 16.
- Assayed edits stay at 24 per M3 genome (not raised although runtime would allow more); this is the cause of the underpowered verdict. Duplicates and non-genuine edits are excluded from the draw.
- The worker pool was cut: serial runtime is about 75 s for the whole payload under Deno.
- Integer fluxes are not recorded; each run keeps initial and final B, P, E (first seed of light-growth in the row) and the replay-check compares final B, P, E, A, C for fixtures only.
- Multi-locus vs single-locus clean share is computed on assayed genuine edits only (multi 1/6, single magnitude 24: 0/8 per M3 genome).
- Image checks not run (no image built). No GPU evidence.
- Under vitest's node transform the replay is an order of magnitude slower than under Deno, so the replay test runs `--replay-check` as a Deno subprocess.

## Checking the artifacts

- `--check` validates the saved artifacts without simulating: seal, file hash, and recomputation of every field that is derivable from other saved numbers (row classes, L1 sums, breadth, participation, sensor reach and structural flags from slots and masks; assay deviations from sums and baselines; stratum counts from rows; tau, qualification and candidate selection from baselines; null medians from values; fixture and sensitivity pass flags; protocol from the code constants; every readout and the verdict). Raw measurements stay trusted in a no-simulation check: probe counts and deltas, null observations, baselines and assay sums and stocks. Only `--replay-check` tests those. It hashes only the locality library, `genotype.ts` and the tool itself, so an unrelated edit to the schema or the reference simulator does not break it.
- A dynamics change in `packages/schema` or `packages/sim-ref` is caught only by `--replay-check` (regenerates the payload, about 75 s under Deno), which is expected to fail until the evidence is deliberately rewritten with `--write --force`.
