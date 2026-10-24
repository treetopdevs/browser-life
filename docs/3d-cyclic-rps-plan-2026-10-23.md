# Cyclic competition on the slab: plan (2026-10-23)

Rung 1b's M4 calibration stopped without a qualifying setting (`docs/3d-rung1b-plan-2026-10-23.md`, amendment of
2026-10-23; `experiments/3d-slab/m4-pick-output.md`): at R = 3 the slab starves, stays sparse, or carpets. This note does
not tune the growth rule again. It adds, to the slab as it is, the one interaction that spatial theory says keeps three
species together indefinitely: cyclic dominance (rock beats scissors beats paper beats rock). It asks three questions, in
this order:

1. **Do we understand the model?** A standalone lattice implementation of the model in the literature (Reichenbach,
   Mobilia and Frey) must reproduce its mobility threshold. This is the only quantitative comparison with the literature.
2. **Does the kernel host it?** The slab with a predation rule must show a coexistence cliff along a mobility knob. This
   is qualitative: the kernel has no exchange rate, so its numbers cannot match the lattice's.
3. **Does the cycle grow?** With the dominance relation heritable and mutable, does a three-type cycle ever become a
   longer one? The literature gives no support for this (section 1). It is a pre-registered long shot.

This note fixes the design and the order of work before any code is written. The numeric rules for the three questions
are drafted in `runs/rps/rule-draft.md`; the main session freezes that file (as `RULES.md`, hashed into `FROZEN`) before Gate 0 and the lattice sweep, and hashes the Gate-0 record after Gate 0, before the first Part B registered run (every open item was settled on 2026-10-24: section 12). Ecology is
the starting condition here, not the hoped-for result.

**Revision of 2026-10-24.** Two reviews of the first draft (a Codex review with a triage, and an adversarial review that ran a
scratch GPU prototype of the kill) found that the rules could not tell predation from neutral churn, that several literals did
not follow the budgets they depended on, and that the plan's own substrate was likely to fail its first test. This version adds a
pilot (Gate 0, rule draft 3.0) before any build, a chirality statistic with paired predation-off controls, a burn-in and an
early stop, a substrate arm in the mutation section, and the corrections listed in section 12. It builds nothing and runs
nothing; the prototype and lattice numbers it cites are scratch evidence from the reviews, not results of this line.

**Decisions of 2026-10-24.** The main session then settled every item that revision left open and added one rung to Gate 0 (D1 to D16,
listed in section 12). Gate 0 runs before M0, on the spike, which is committed as `experiments/3d-rps/gate0-spike/`. The kernel (M0 to
M2 and its drivers) is Part B and is built only after Gate 0 gives GO for some rung; everything that touches no kernel, schema or
shader file, the companion page included, is Part A and comes first (section 8). Gate 0's fourth rung, V, empties the cell instead of
removing a fraction of its `B` (4.3a). `runs/rps/rule-draft.md` carries the same decisions.

**Decisions after the review of Part A, 2026-10-24.** A review of the code of Part A (a conformance review, a Codex review and a spike
check) left nine open readings; the main session settled them and ruled on the order of the freeze (D17 to D30, section 12).
In short: the rungs of Gate 0 are taken in the order S0, S1, S2, V and Gate 0 stops at the first GO; `RULES.md` is frozen before Gate 0
and the lattice sweep, and the Gate-0 record, `GATE0-RECORD.md`, is hashed into `FROZEN` after it; a job that does not start stops at the
hand-over; `spread*` needs an informative `v`; the horizon rung is tried when every rung that passed rows 1 and 2 failed at row 3.

**Final review of Part A, 2026-10-24.** A last Codex review of Part A (Sol 6.1 at High effort, read-only) found the rules not yet ready to
freeze and the code sound with fixes; its ten findings and three more from the triage, with what was done, are in section 12 (FR1 to FR13).
In short: the registered readouts take the operating point from the hashed Gate-0 record, which is completed with the dense rate before it
is hashed; the horizon rung is a diagnostic and is not run on S2; the turnover threshold is compared exactly; the mutation rates are rounded
down; and a rerun that passes but loses the publish race no longer erases an earlier conservation failure.

Code references are to the tree at `caf9a431` (branch `claude/3d-cyclic-rps`, cut from `claude/3d-rung1b-slab`). Numbers
marked "probe" come from the feasibility probes of 2026-10-23 (`runs/rps/probe/`, run on a loaded M1 Max with load average
15 to 47; they are scratch measurements, not results of this line).

## 0. Decisions at a glance

| # | question | decision |
|---|---|---|
| 1 | Encoding | Type `t` in PARAM1 byte 1, beats-mask `m` in byte 2 (bit `j` set: this lineage kills neighbouring type `j`; bit `t` and bits at or above `K` clear), byte 3 stays 0. The lottery already copies all 49 words, so both are inherited. `m` is cached in `MOT` bits 24-31 so react can read neighbours without reading their genomes. Five new optional keys (`rpsTypes`, `rpsRate`, `rpsMin`, `rpsFlip`, `rpsEdge`), absent from `defaultConfig()` (a sixth, the kill-form key, only if Gate 0 chooses rung V). Keys absent: every pin (27 2D + 16 slab) and every hash byte-identical. |
| 2 | Predation | **Removal, not transfer.** In `react`, after the pool caps and before the controller, a cell with `ndom` dominant face neighbours converts `q = min(B, mulFrac(B, rpsRate * ndom, 16, draw))` of its own `B` to `C` in place and exports `q * (eB - eC)` as heat (booked under the existing `bdecay` flux, as a sum with the passive decay). Matter never leaves the cell, so conservation is exact by construction, there is no scatter and no receiver. The kill itself leaves `E`, `P`, `S` and lineage alone. The gather-style `B -> B` transfer is the deferred alternative (4.3). On a full carpet removal is expected to behave like replacement (scratch evidence, section 10); row 10 tests that before anything is built, and its rung V tests the alternative: if Gate 0 chooses V, the kill is instead the vacancy kill of 4.3a, which empties the cell with probability `rpsRate * ndom / 2^16` as the 2D injury rule empties one, and removal stays the documented alternative. |
| 3 | Dominance | Starting ecology `K0 = 3`: type `t` kills type `(t + 1) mod 3`. The type space is `rpsTypes` (3 to 8). Mutation flips one mask bit or changes the type (mask kept); exact operators in 4.4. |
| 4 | Mobility | The knob is `spread`; its grid is chosen by Gate 0 from {2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32}, keeping the carpet spreads whose *measured* label mixing index (inert stripes, `dtQ` 0) rises by a factor of 1.3 or more, at least 5 of them. Motility gain is rejected: a uniform drift is not exchange. The kernel check is a cliff within a step budget; the literature's `M_c` is checked only in the lattice reference. |
| 5 | Depth | v1 is quasi-2D: 128 x 128 x 4, `lightK` 16384, uniform light 240. A 32-layer volume stays alive at `lightK` >= 16384 (probe), so one deep run is feasible, but scroll-wave work is conditional on a measured label correlation length (rule draft section 6) and is not built in the implement phase. |
| 6 | WGSL | No new entry point and no new binding: predation is a block of the existing react shader, which keeps its 96-byte workgroup array, so the ~8 KiB single-declaration cliff is not approached. A separate pass is the route for the deferred transfer (4.7). |
| 7 | Milestones | Two parts. **Part A** touches no kernel, schema or shader file (every pin untouched): the lattice module, `census-rps.ts`, the readout, the committed spike with the V switch and the Gate-0 driver, the companion page (M5a); then the freeze of `RULES.md` (D28), then Gate 0 itself, before M0, on the spike, and the lattice sweep. **Part B**, which may be built after Gate 0 gives GO for some rung (its registered runs start only after the completed Gate-0 record is hashed into `FROZEN`): M0 schema, M1 CPU, M2 WGSL + goldens (for the kill form of the rung used), the kernel drivers (M3) and the mutation driver (M4, arm Z first). Then the rest of the run phase: every kernel run and M5b. |
| 8 | Rules | `runs/rps/rule-draft.md`: lattice reproduction, Gate 0, kernel cliff with a predation signature, mutation outcomes, all as numbers, every outcome covered. |
| 9 | Sizing | About 12 h wall on both Macs, about 29 h on the M1 Max alone for the registered stages, at the 450 steps/s the reviews measured on a loaded M1 Max (9 h and 22 h at the first draft's 600 steps/s); Gate 0 is on top, 0.8 to 4.5 h of M1 Max time (the rungs in the order S0, S1, S2, V, stopping at the first GO: 1.8 h when S0 gives GO); no paid compute (section 9). v1 and deferred lists in 2.2. |
| 10 | Gate 0 | A pilot before the build, after the freeze of `RULES.md`, before M0 and on the committed spike (D1, D16, D28): the review prototype, pilot seeds, a fixed table of jobs. It takes the rungs in the order S0, S1 (matter scale 1 and 4), S2 (matter scale 8, only if S0 and S1 both fail on levels) and V (the vacancy kill, on the substrate of the first of those to have enough levels), and stops at the first GO (D24): that rung is used, with the spread grid, the rate grid and the horizon it sets; or, if every rung is excluded, it stops. The scratch evidence predicts that S0, the plan's own substrate, fails it (section 10). Rule draft 3.0. |

## 1. What the literature gives, and what it does not

Read for this note (arXiv versions): RMF07 = Reichenbach, Mobilia and Frey, Nature 448:1046 (2007), arXiv:0709.0217;
JTB08 = J. Theor. Biol. 254:368 (2008), arXiv:0801.1798; SzRev14 = Szolnoki et al., J. R. Soc. Interface 11:20140735,
arXiv:1408.6828; SF07 = Szabo and Fath, Phys. Rep. 446:97, cond-mat/0607344. Abstracts or secondary citations only:
Mobilia 2010 (arXiv:0912.5179), Park, Pichugin and Traulsen (eLife 9:e57857, 2020), Peltomaki and Alava (PRE 78:031906,
2008), Lamouroux et al. (PRE 86:021911), Cliff (arXiv:2410.03807), Sinadjan (arXiv:2508.16639). Not read: May and Leonard
(1975), Tainaka (1989, 1994), Frey (2010); they are cited only as the papers above cite them.

**Two models share one name.**

- *May-Leonard, dominance removal* (RMF07, JTB08): selection `AB -> A0` at rate sigma (the loser dies, leaving a vacancy),
  reproduction `A0 -> AA` at rate mu, neighbour exchange at rate epsilon, on a 2D square lattice with four neighbours.
  The mean field has a heteroclinic cycle. On the lattice there are spiral waves and coexistence below a mobility
  threshold `M_c = (4.5 +- 0.5) x 10^-4` (sigma = mu = 1, `M = 2 epsilon / N`, lattice length 1); above it two of the three
  species go extinct. The wavelength grows as `sqrt(M)` up to `M_c`.
- *Cyclic Lotka-Volterra, replacement* (`AB -> AA`): total density is conserved, the mean field has neutral orbits, and
  in 2D species coexist in rough voter-like domains with extinction only at very small L (SF07 section 7.1). Spirals need a
  non-conserved total density (Peltomaki and Alava).

The threshold and the regular spirals belong to the first model. A rule that moves `B` from the loser to the winner would
be the second.

**How RMF measured the threshold.** `P_ext` is the probability that two species are extinct after waiting `t = N`
generations from a random start with the internal fixed point's densities (a quarter each of A, B, C and empty); sizes
`N = 20^2, 30^2, 40^2, 100^2, 200^2`, 500 to 2000 realizations per point. `M_c` is where the `P_ext` curves for growing
`N` sharpen into a step (extinction time proportional to `N` is the marginal case).

**What is uncertain.** The meaning of "mobility" is not pinned down: JTB08 eq. 21 gives `D = epsilon / (2N)` in 2D, which
makes `M = 4D`, yet its Fig. 5 reads `D` as `M`; SzRev14 uses `m = 2 gamma / N`. Lamouroux et al. find the transition not
sharp. Cliff (2024) finds that five-species outcomes can need 10^7 or more Monte Carlo steps, and Sinadjan (2025) that GPU
replications are sensitive to size and run length.

**3D.** Scroll waves are predicted (JTB08 section 3.8 says they are "expected"; it simulates only d = 2). Tainaka's cubic
zero-sum model gives vortex strings that close into rings (via SF07). No 3D May-Leonard simulation with mobility, no 3D
`M_c`, and nothing on how thick a slab must be for scroll waves instead of quasi-2D behaviour was found.

**Longer cycles and mutation.** Cyclic models with `Q` species freeze into blocked domains for `Q >= Q_th(d)` (SF07:
`Q_th = 5` in 1D, pair approximation 14 in 2D and 23 in 3D). Four-species spirals form only when total density is not
conserved (Peltomaki and Alava, via SzRev14). Neutral alliances win at high mobility in four-species systems (Dobrinevski et al. 2014, via
SzRev14). Mobilia (2010) mutates species identity inside a fixed cycle (well mixed): a Hopf bifurcation at
`mu_c = (epsilon - 1) / 18` turns the heteroclinic cycle into a limit cycle. Park, Pichugin and Traulsen find cyclic
dominance rarely evolves from mutants similar to existing types. **No source was found on spatial models in which
dominance edges mutate and cycles lengthen.** "The cycle grows" is unsupported, and the evidence points against it.

**What this fixes in the design.**

1. Predation is removal (a victim's `B` becomes `C`), because that is the model with the threshold and the spirals. Whether
   removal in place on a full carpet is that model is what Gate 0 tests; the scratch evidence says it acts like replacement
   there (section 10).
2. The quantitative comparison lives in a plain TypeScript lattice reference (sizes 20 to 60 sites per side, with a
   100-site contingency), and the pass band is wide enough to absorb the factor-2 uncertainty in `M`.
3. The kernel cannot use RMF's waiting time: `t = N` generations at `N = 65,536` cells and a turnover time of about 570
   steps is about 3.7 x 10^7 steps. The kernel check uses a fixed step budget, and "no cliff within the budget" is an
   outcome, not evidence of stable coexistence.
4. Depth is quasi-2D in v1.
5. The mutation question gets a null arm (same operators, predation off), because random mask drift produces cycles by
   chance, and a substrate arm (no mutation), because a collapse at the mutation horizon says nothing about mutation if the
   unmutated cycle collapses too.
6. The substrate is piloted before it is built for (Gate 0, rule draft 3.0), and every kernel claim is measured against a
   paired predation-off control by a chirality statistic, because turnover alone cannot tell a cyclic film from neutral churn.

## 2. What is built

### 2.1 The model in one paragraph

*In plain words.* Three kinds of living cell; each kind kills one other kind a little every step wherever the two touch;
what is killed turns to detritus, the detritus is recycled to food, and whoever is next to the empty patch regrows it.
Spread them on a table and they chase each other round in spirals, as long as they do not mix too fast. Then let a kind
change whom it kills.

*Technically.* A cell's lineage carries a type `t` and a beats-mask `m` in the genome word PARAM1 (bytes 1 and 2). In
`react`, a living cell counts the face neighbours whose mask contains its own type and converts a fraction of its `B` to
`C` per such neighbour. Reproduction into vacancies is the kernel's own growth and flow; ownership of a refilled cell is
the genome lottery; mobility is the blur width `spread`. Everything is integer and bounded.

### 2.2 v1 and deferred

| v1 (this note) | deferred |
|---|---|
| Gate 0 pilot on the committed spike (rule draft 3.0: substrate rungs S0 to S2, and rung V, the vacancy kill), then the kill of the rung chosen in react (removal, or the vacancy kill of 4.3a at V), `K <= 8` type space, `K0 = 3` cyclic start | `B -> B` transfer with a `rpsYield` key (needs its own pass); a substrate with persistent vacancies (less matter per cell) |
| Quasi-2D shape 128 x 128 x 4 (256 x 256 x 4 as Gate 0's horizon rung), sweep over `spread`, measured label mixing index | An explicit exchange (swap) knob |
| RMF lattice reference at K = 3, sizes 20-60 (100 as contingency), live 2D canvas on the companion page (Part A) | Lattice wavelength or correlation-length measurement; lattice runs of 4- and 5-cycles |
| Kill-rate calibration with paired rate-0 controls, longer cycles as given (K0 = 4, 5) | Size scaling of extinction time in the kernel |
| Mutation arms: substrate (no mutation), edges, labels, both, null, weights-only | Lineage-inspector replay of RPS mutations |
| One conditional 64 x 64 x 32 run with an exploratory render | Scroll-wave identification as a claim |
| Direct Deno drivers, JSON and TSV outputs | Runner and bundle integration, lab UI, `OVERRIDE_KEYS` |

## 3. Where the code goes

The pass is small and lives in existing files; there is no new simulator module. The variant is slab-only and key-gated,
so it is branched inline in `step3d.ts` and `shaders3d.ts` (as the slab's own optional rules are), and **with the keys
absent no branch executes**.

| package | file | change |
|---|---|---|
| schema | `layout3d.ts` | constants only: `RPS_MAX_TYPES = 8`, `RPS_TYPE_SHIFT = 8`, `RPS_MASK_SHIFT = 16`, `RPS_MIRROR_SHIFT = 24`, and `RND_RPS = { KILL: 40, FLIP: 41 }` as its own export (not in `RND3`) |
| schema | `config.ts` | five optional keys after `lightK` (`config.ts:398`), `validateRps`, doc comments (a sixth, the kill-form key of 4.1, only if rung V is chosen) |
| schema | `genome3.ts` | `Genome3.rps?: { type, beats }`; `encodeGenome3` writes it; `decodeGenome3(words, { rps: true })` reads it (the default stays strict); `genomeFromHex3(hex, { rps: true })` forwards the option (today `genomeHex3` writes what `genomeFromHex3` would refuse); `cyclicMask(t, k)`. Neither hex helper has a caller outside tests; a lab genome panel or the lineage inspector will need the option |
| schema | `world.ts` | `validateState`: the slab reserved-byte guard (`world.ts:192-199`) becomes conditional on the keys; the field and mirror checks of 4.2 |
| schema | `world3.ts` | `rpsMixWorld` (4.4) |
| schema | `presets.ts` | `InitKind` `"rps-mix"`, optional `InitParams.occupied` and `columns` (`K0` is `InitParams.founders`), the `foundingWorld` cases (`generalist`, `rps-mix`, and a default that throws), preset `slab-rps` in `SLAB_PRESETS` (`presets.ts:339-347`), `presetIdentity` includes the two new fields when present |
| sim-ref | `step3d.ts` | predation block, `mutateRps`, mirror write, all in `react`; the `F[FX.bdecay]` assignment becomes a sum; `rpsDominant()` exported for tests |
| sim-gpu | `shaders3d.ts` | RPS constants in `prelude3` (emitted only when the keys are present), the same three blocks in `reactShader3` and the summed `F[FX_BDECAY]` |
| sim-gpu | `golden.ts` | seven `slab-rps-*` cases (milestone M2); `tests/deno/gpu_rps_inert.ts` beside it |
| sim-ref | `test/golden-hashes.test.ts` | seven new pins under `PINNED[1]`, with the usual comment that every pin above is untouched |
| sim-ref | `test/step3d-helpers.ts` | `mirrorZ` masks the z byte (`& 0xff`) and keeps bits 24-31 (it reads `mot >>> 16` today, `step3d-helpers.ts:71-72`) |
| metrics | `census-rps.ts` | per-label census, modal masks, clean-cycle length, turnover, chirality counts, correlation length, z-coherence, mutant supply |
| experiments | `3d-rps/` | `rmf-lattice.ts`, `rmf-worker.ts`, `rmf-sweep.ts`, `kernel-meter.ts`, `kernel-kappa.ts`, `kernel-sweep.ts`, `kernel-mutation.ts`, `readout.ts`, `lib/` (with `kernel-job.ts`: burn-in, switch, early stop), `gate0-spike/` (the committed review prototype with the V switch and the Gate-0 driver, D16, D29; nothing in `packages/` imports it), `gate0-spike.sha256` (its recorded hash and file list), `RULES.md` and `FROZEN` (written by the main session at the freeze), `GATE0-RECORD.md` (written at the end of Gate 0) |
| experiments | `test/` | tests of the lattice, the readout (synthetic data for every outcome row) and the drivers (tiny runs) |
| docs | `rules.md` | "The RPS pass" subsection under "The slab" with the bounds of section 5, and the note that the kill is booked under `bdecay` so only the census measures predation (at rung V: that an emptying books no flux) |
| docs | `3d-cyclic-rps-companion.html` | M5a, Part A (D15): the companion page, with the live lattice canvas and the result slots |

If Gate 0 chooses rung V (D14), the predation block of the `step3d.ts` and `shaders3d.ts` rows is the vacancy kill of 4.3a, without the
`bdecay` sum (an emptying books no flux), and `config.ts` also carries the kill-form key of 4.1. In this table Part A is `census-rps.ts`,
`rmf-lattice.ts`, `rmf-worker.ts`, `rmf-sweep.ts`, `readout.ts`, `lib/kernel-job.ts` (the two-phase job: the Gate-0 driver runs on it, and
the Part B drivers reuse it), `gate0-spike/` and the companion page; Part B is every `schema`, `sim-ref` and `sim-gpu` row and the kernel
drivers (`kernel-*.ts`) (section 8).

Not touched: `gpu-sim3.ts` (the react bind group, the pipeline list, `encodeStep`, the profile branch and
`requestDevice3` are unchanged), affinity, flow, transport, light, `runner.ts`, `observe.ts`, `conditions.ts`,
`FLUX_NAMES`, `CELL_CHANNELS`, `GENOME_CHANNELS3`.

**Traps that would move a pin or break a test, and how each is avoided.**

| trap | where | rule |
|---|---|---|
| Mutation modulus `which % 180` | `step3d.ts:109`, `shaders3d.ts:595` | untouched. The RPS branch decides *before* `mutateInPlace3` is called; a second mutation draw in one cell-step would mint two lineage ids. |
| `RND3` is asserted equal to `RND` above slot 20 | `layout3d.test.ts:24-37` | slots 40 and 41 live in `RND_RPS`, with their own prelude line emitted only when the keys are present. |
| Reserved PARAM1 bytes | `world.ts:192-199`, `genome3.ts:45`, tests `genome3.test.ts:35-50`, `world3.test.ts:111-133` | the guard is conditional on the keys; `decodeGenome3` stays strict unless asked. With the keys absent the old refusals are exercised unchanged. |
| New flux name | `FLUX_NAMES` is in `stateHash` (`accounting.ts:95`) | none added; the kill is booked under `bdecay`. |
| New genome word | `genomeChannels` is used by the hash, checkpoints and buffer sizes | none added; PARAM1 has room. |
| New binding or pass | auto layouts drop unused bindings; the profile branch lists the passes | none added. |
| Default config bytes | `slab-compat.test.ts:35` pins 592 bytes | keys absent from `defaultConfig()`. |
| `neutral` | expression reads `REF` everywhere, so a genome-borne type would still act | `validateRps` refuses `neutral`, as `validateGenes` does. The key-absent run is the control for the pins. |
| `MOT` consumers | flow reads bytes 0-2 only (`shaders3d.ts:341-346`, `step3d.ts:319-326`); golden worlds write arbitrary bytes | the mirror is read and written only when the keys are present, and checked by `validateState` only then. |
| `foundingWorld` default | `presets.ts:447-467` serves `generalist` (it has no case) and any kind whose case is forgotten, with a 2D-style world | add `case "generalist"` and `case "rps-mix"`, and make the default throw; M0 builds every kind |
| Flux assignment | `F[FX.bdecay] = q` (`step3d.ts:653`) and `F[FX_BDECAY] = q` (`shaders3d.ts:772`) overwrite what an earlier kill booked | both become sums (M1 test (i)); a kill with no passive decay would otherwise pass unnoticed |
| Test helper `mirrorZ` | `step3d-helpers.ts:71-72` reads `mot >>> 16` as the z byte, so mirror bits 24-31 corrupt the mirrored word | mask the byte, keep bits 24-31, or keep the helper off RPS states (M1 test (k)) |

## 4. The rules

Indexing, `nb3`, `OUTSIDE`, the 6-direction numbering (0..5 = +x, -x, +y, -y, +z, -z) and the RNG are those of
`docs/3d-rung1b-step-spec.md` section 0. Nothing in affinity, flow, transport, light or tick changes.

### 4.1 Keys

All five are optional `WorldConfig` fields, absent from `defaultConfig()`, checked in the explicit optional loop of
`validateConfig` (`config.ts:685-703`), and **set together** (like `genes`, `kGene`, `geneFlip`: `validateGenes`,
`config.ts:781-796`).

| key | range | meaning |
|---|---|---|
| `rpsTypes` | 3 to 8 | `K`, the size of the type space. The founding count `K0` is a property of the preset (3 for the starting ecology); `K > K0` is the only way a longer cycle can appear. |
| `rpsRate` | 0 to 10,922 | expected fraction of a victim's `B` killed per step *per dominant face neighbour*, in 1/65,536. 0 switches predation off while labels, masks and mutation stay live (the controls). The bound `6 * rpsRate < 2^16` is `mulFrac`'s exactness limit. |
| `rpsMin` | 1 to 255 | a face neighbour counts as a predator only if its post-transport `B` is at least this. It keeps one-quantum fringes of a domain from killing like a full cell. |
| `rpsFlip` | 0 to 2^32 - 1 | share of mutation events (in 1/2^32, the test being `draw < rpsFlip`) that are RPS events instead of controller mutations. 0: weights only. 2^32 - 1: every event but one draw in 2^32, which is the largest value and not exactly "always" (the golden cases use it as "every event"). |
| `rpsEdge` | 0 to 256 | within an RPS event, share (in 1/256) that flips a mask bit; the rest change the type. |

`validateRps` refuses the keys on a non-slab config, a partial set, `neutral`, and any value outside its range. It leaves
`SLAB_EXCLUDED_KEYS` alone (still 26 keys, `config-slab.test.ts:31-33`). `genes`, `kGene` and `geneFlip` stay excluded from
the slab: their gate-and-cost semantics have no slab rule and the RPS keys do not reuse them.

**If Gate 0 chooses rung V (D14),** a sixth optional key, the kill form (provisional name `rpsKill`), is set together with the five and
takes the one further value `"vacancy"`, which selects the vacancy kill of 4.3a in place of removal (4.3); removal stays the documented
alternative and is not built. Under `"vacancy"`, `rpsRate` is the probability, in units of 2^-16, that one dominant face empties the
cell in one step, and ranges 0 to 16,384 [the cap of rung V's `R_cal`; the bound `6 * rpsRate < 2^16` above is `mulFrac`'s and does not
apply to a threshold test, 5]; the other four keys mean what they mean above. Without rung V the sixth key does not exist and every
statement above stands.

### 4.2 Encoding, and the mask mirror

**Genome.** `PARAM1` stays a motility-gain word with three more bytes defined:

| byte | field | range |
|---|---|---|
| 0 | `motGain` | unchanged (flow reads `& 0xff`; mutation slot 179 keeps bytes 1-3: `step3d.ts:127-131`, `shaders3d.ts:614-618`) |
| 1 | type `t` | 0 .. K-1 |
| 2 | beats-mask `m` | bit `j` set: this lineage kills neighbouring type `j`; bit `t` clear (no cannibalism); bits `>= K` clear |
| 3 | reserved | 0 |

The genome lottery copies all 49 words with the winner (`step3d.ts:439-441`, `shaders3d.ts:472-475`), so type and mask
are inherited with no new code, and the existing rule that a lineage id names exactly one set of genome words
(`validateState`, `world.ts:214-225`) covers them: a type or mask change always mints a new lineage id, through the
mutation event.

**Why the predator's mask and not a "beaten by" mask.** If a lineage stored whom it is beaten by, a prey lineage could
mutate to immunity by clearing its own bits, and selection would reward that at once. With the predator's mask, immunity
needs *other* lineages to drop predation.

**The mirror.** `react` cannot read a neighbour's genome: it mutates its own genome in place, and a neighbour's read would
race on the GPU and depend on order on the CPU. It can read `cells[1]`, the post-transport cell buffer, which it already
does for `S` (`step3d.ts:556-562`). So the keys add one invariant: **`MOT` bits 24-31 of a living cell hold the cell's
beats-mask `m`; of a non-living cell they hold 0.** Flow reads only bytes 0-2 of `MOT`, and the bits are written by
the cell's own `react` and carried by the lottery:

- founding (`rpsMixWorld`) writes `MOT_ZERO3 | (m << 24)` for living cells;
- transport already copies the whole `MOT` word from the lottery winner (`step3d.ts:441`, `shaders3d.ts:475`) and writes
  `MOT_ZERO3` when nothing arrives, so after transport `cells[1].MOT[j]` carries the mask of `genome'[j]` (the winner's
  genome, or the same lineage if the copy is skipped);
- `react` ORs `m << 24` into the word it stores (`step3d.ts:672`, `shaders3d.ts:791`), taking `m` from its own genome
  *after* mutation and *after* the lineage clear (`step3d.ts:662-665`, `shaders3d.ts:781-784`), and 0 for a cleared cell.

Only the mask is mirrored: the victim knows its own type, so a neighbour's type is never needed. That is why the type space
reaches 8 labels (8 mask bits). `validateState`, when the keys are present, checks for every living cell that type `<` K,
mask has no bit `>=` K and no bit `t`, byte 3 is 0, and `MOT >>> 24` equals the mask; for every non-living cell that
`MOT >>> 24` is 0; and that a cell with `B > 0` or `P > 0` is living. The last check is what makes "a neighbour with
`B >= rpsMin` has a valid mirror" true by induction (a target with mass has a lottery winner with mass, and a living cell
is cleared only when both `B` and `P` are 0). It runs on every entry path: founding, `GpuSim3.upload`, checkpoint decode.

### 4.3 Predation: removal in place

**Where.** In `react`, after the cell load and its two pool caps (CPU `step3d.ts:538-546`, WGSL `shaders3d.ts:643-645`)
and before the `living && B > 0` block (CPU :548, WGSL :647). Competition happens before reproduction: the controller,
catalysis, growth and mutation of the victim all see the reduced `B`. (This ordering is a choice; the alternative, killing
after growth, would let a cell outgrow its predators within a step.)

**The rule.** For a cell `i` with `living` and `B > 0` (post-transport `B`, the cell's own genome), let
`t = (PARAM1[i] >>> 8) & 0xff`. For each direction `d` in 0..5:

1. `j = nb3(x, y, z, d)`; skip `j == OUTSIDE` (a missing z neighbour never preys).
2. `j` is *dominant* iff `cells1.B[j] >= rpsMin` and `((cells1.MOT[j] >>> (24 + t)) & 1) == 1`, where `cells1` is the
   post-transport buffer (`cells[1]` on the GPU; `this.state.cells` after the swap on the CPU).

Let `ndom` be the number of dominant `j` (0 to 6). If `ndom > 0`:

```
k = rpsRate * ndom
q = min(B, mulFrac(B, k, 16, draw(base, RND_RPS.KILL)))      // base = cellBase(seed, step, i)
B -= q ;  C += q ;  heat += q * (eB - eC) ;  F[bdecay] += q      // the passive decay's own q is added to it, not assigned over it
```

*Worked example.* `B = 1000`, `rpsRate = 128`, two dominant neighbours: `k = 256`; `mulFrac` has `hi = 0`, `lo = 256,000`
= 3 * 65,536 + 59,392, so `q = 4` when `draw & 0xffff < 59,392` (probability 0.90625) and `q = 3` otherwise: the expectation
3.90625 = 1000 * 256 / 65,536. *Mirror example.* A type-0 lineage in the starting cycle has `m = 0b010`; its `MOT` word with
no controller output is `0x02808080`; a type-1 victim reads `(0x02808080 >>> 25) & 1 = 1`, so it counts that neighbour.

**What the kill does and does not touch.**

- `E` stays in the victim's pool, `P` is not eaten (structure is not food), `S` and `A` are untouched. The eaten `B`
  becomes `C`, a dissolved channel, so it carries no lineage and no genome.
- The released energy `q * (eB - eC)` (8 per quantum at defaults) is exported as heat in the same expression that
  `bdecay` uses (`step3d.ts:653`, `shaders3d.ts:772`), so the energy residual stays exactly 0. It is booked under the
  `bdecay` flux because a kill is a `B -> C` conversion with the same heat per quantum; no flux name is added. The two
  existing assignments, `F[FX.bdecay] = q` on the CPU and `F[FX_BDECAY] = q` in WGSL, become sums with the kill's `q`, so a
  cell-step with both a kill and a passive decay books both and the identities of `capabilities.ts:263-267` (which give `bdecay`
  to the loss of `B` and the gain of `C`) keep holding. The price is that no ledger readout separates predation from decay:
  predation is measured from the census (chirality, rule draft 0), not from the flux.
- The genome of the victim and of every predator is unchanged. The victim keeps its lineage unless `B` and `P` both reach
  0, and then the existing clear (`step3d.ts:662-665`) applies. There is **no receiver**: the predator gains nothing
  directly, and nothing in the rule reserves the depleted site for its attacker. Its advantage is indirect, as in
  May-Leonard: a vacancy beside it, detritus that diffuses to it (`diffC = 200`), and a head start in refilling.
- The light pass runs before `react`, so it shades by the post-transport `B + P`, before the kill. The controller's `B`
  input and `EPB` use the post-kill `B`.

**Gather structure.** The rule reads `cells[1]` (read-only in `react`) and writes only the cell's own outputs: no scatter,
no atomics beyond the existing ledger, no cross-cell write, so CPU and WGSL are bit-exact by construction and the order
of cells is irrelevant. Matter never leaves the cell: `A + B + C + P` is conserved cell by cell, not only in total.

**Why removal, and what transfer would cost.** The alternative the task text describes is a gather-style `B -> B`
transfer: the victim's cell computes the portion it loses toward each dominant direction, remainders stay at the source,
receivers recompute and gather, the receiver keeps its own genome and lineage, and only quanta move. It is deferred for
three reasons. (i) It is the replacement model of section 1, whose mean field is neutral and whose lattice spirals need
non-conserved density. The scratch runs of section 10 suggest that removal in place on a full carpet already behaves as
replacement, in which case (i) separates the two rules less than it seems. Nobody has derived the mean field of the
thresholded, lottery-owned transfer, so that it is the neutral Lotka-Volterra equation is a claim of this note and not a result:
derive it before building the transfer. (ii) Inside transport it hits the stay problem: a source's stay can be as small as 0.8 % of `q`
when displaced at the speed cap (scratch arithmetic in the kernel map: 8 of 1000 at three axes, 16 of 64 at one axis), so
a fraction-of-`q` move can underflow; the move would have to be computed from the stay, and every target would recompute
26 `share3` per converting source or read a pre-pass buffer. (iii) After react, or between light and react, it needs a
delta buffer and a pass (see 4.7). If built, it is a key `rpsYield` (share of the killed `B` that the predator keeps, 0 =
this rule) with the predator's gain recomputed from the victim's `B`, `rot` and `draw` exactly as diffusion's receiver
recomputes `diffOut6`.

### 4.3a The vacancy kill (rung V; built only if Gate 0 chooses it)

Gate 0's fourth rung (rule draft 3.0, G0.1; D14) changes the kill and not the substrate. In the scratch runs removal in place on a
full carpet behaves as replacement (section 10); a kill that **empties** the cell leaves a vacancy that the neighbours must refill,
which is the May-Leonard picture (section 1). It is built (M0 to M2, section 8) only if V is the rung used, as one more value of a
kill-form key (4.1); removal (4.3) stays the documented alternative. Where this text and the rule draft's V block differ, the rule
draft wins.

**Where.** Where removal acts: in `react`, after the cell load and its two pool caps (CPU `step3d.ts:538-546`, WGSL
`shaders3d.ts:643-645`) and before the `living && B > 0` block (CPU :548, WGSL :647).

**The rule.** `ndom` is counted exactly as in 4.3: the face neighbours `j` of `cells[1]` with `B >= rpsMin` and mirror bit `24 + t` set,
`t` the cell's own type, a missing z neighbour never preying. A cell with `living` (its lineage words not both 0) and `ndom >= 1` is
**emptied** iff

```
(draw(base, RND_RPS.KILL) & 0xffff) < min(65536, rpsRate * ndom)          // RND_RPS.KILL = slot 40, as removal's
```

so `rpsRate` is the probability, in units of 2^-16, that one dominant face empties the cell in one step, and a cell with four dominant
faces at `rpsRate` 16,384 is emptied with certainty. At `rpsRate` 0 the test is never met, so a rate-0 job is bit for bit the removal
build's rate-0 job (Gate 0 checks this on one job). There is no `B > 0` condition: a living cell with `B = 0` and `P > 0` beside a
predator is emptied too.

**Emptied** is the 2D injury rule's lesion, mirrored and not reinvented: `packages/sim-ref/src/step.ts` lines 663-672, the injury
branch of `react` (`applyLesion` does the same between steps). In the slab's `react`, with `eB`, `eC`, `eP` the energy ladder:

```
heat += B * (eB - eC) + P * (eP - eC) + E ;  C += B + P ;  B = 0 ;  P = 0 ;  E = 0 ;  mot = MOT_ZERO3
```

`A` and `S` are untouched. Because the block sits before `living && B > 0`, the emptied cell skips the controller, catalysis, growth and
mutation of that step; `mot` keeps its at-rest value `MOT_ZERO3` (the 2D path's `mot = MOT_ZERO`); the existing clear at the end of the
cell-step (CPU :662-665, WGSL :781-784) sets both lineage words to 0, because `living && B == 0 && P == 0`; and the mirror OR at the
`MOT` store writes 0 for a cleared cell, so `MOT >>> 24` is 0 (4.2). Its passive processes (`C` to `A`, `S` decay) run as for any vacant
cell. **Fluxes:** as the 2D path books them, which is not at all: no `F[...]` entry changes and the heat goes to the heat total only. The
`bdecay` sum of 4.3 is therefore not used here, the flux identities of `capabilities.ts:263-267` do not hold on a step with an emptying
(as on a 2D injury or lesion step), and the matter and energy ledgers close exactly: matter moves from two channels of one cell into a
third, and the energy difference leaves as heat. Predation is measured from the census, as for removal (rule draft 0).

**Gather structure** as in 4.3: the rule reads `cells[1]`, which `react` never writes, and writes only the cell's own outputs; there is
no scatter and no cross-cell write, CPU and WGSL are bit-exact by construction, and the order of cells is irrelevant.

**The rate scale** is Gate 0's to test, in the units above: {0, 64, 256, 1024, 4096} (rule draft G0.1). A one-cell vacancy is refilled
in about 150 to 330 steps (the probe's colonization front of 0.003 to 0.007 cells per step) and May-Leonard has selection about equal to
reproduction, so a kill probability of about 200 to 440 per 2^16 per dominant face is where a cycle should live.

### 4.4 Dominance, founding and mutation

**The starting cycle.** `K0 = 3` types, type `t` kills type `(t + 1) mod 3`: mask `cyclicMask(t, 3) = 1 << ((t + 1) mod 3)`,
i.e. `0b010`, `0b100`, `0b001` for `t = 0, 1, 2`. The PARAM1 words are `0x00020000`, `0x00040100`, `0x00010200`
(`motGain` 0). The founder genome is the lifted generalist (`generalistGenome3(mu, sigma)`) with these three PARAM1 words,
so the three types differ in nothing else. The lineage ids are `(0, 1 + t)` (one genome per id, `lo < N`).

**Founding (`rps-mix`, new `InitKind`), exactly.** Every hash is `lowbias32` of an argument formed in doubles and read as `x >>> 0`.
For each cell `i = (z * H + y) * W + x`, let `key = y * W + x` (the column index) when `columns` is true and `key = i` otherwise,
and `h = lowbias32(seed * 317 + key)` (317 is a new salt, distinct from the slab spots' 313). The cell is occupied iff
`h % 100 < occupied`; its type is `draw(h, 5) % K0`, so a `columns` world is z-invariant in occupancy and type. An occupied cell
gets lineage `(0, 1 + type)`, `B = draw(bBase, i) % (2 * biomass + 1)` with `bBase = lowbias32(seed ^ 0x5eed)` and `i` the **full cell
index in both modes** (so `B` differs between the layers of a column, as in `buildWorld3`, whose base is per founder and whose
index is the full cell index; mean `B` is `biomass`), `E = 2 * B`, and `MOT = MOT_ZERO3 | (m << 24)`; every cell gets
`A = nutrient`. `K0` is carried by `InitParams.founders`; `occupied` and `columns` are new optional fields of `InitParams`, absent
from every existing preset. This is the lattice protocol's random start (a quarter of the sites empty at `occupied = 75`). For the
kernel runs `nutrient = 20`, `biomass = 16`, `occupied = 75` at rung S0, which puts about 32 quanta of matter per cell into the
world, the budget of the M4 carpets (nutrient 32 plus founders). `presetIdentity` (`presets.ts:376-392`) must include `occupied`
and `columns` when present, or the density and the start are invisible to it. **`foundingWorld` (`presets.ts:447-467`)** gets
`case "generalist"` and `case "rps-mix"` and a `default` that throws: today `generalist` has no case of its own and is served by the
`default`, which would also serve a forgotten `rps-mix` with a 2D-style world on a slab config. These formulas are the review
prototype's, so a world founded here is the world the spike ran (8, spike agreement).

**Mutation (exact).** In `react`, where a mutation event fires (`draw(base, MUT) < p`, unchanged), replace the single call
`mutateInPlace3(...)` (`step3d.ts:641`, `shaders3d.ts:746`) by

```
if (rps && draw(base, RND_RPS.FLIP) < rpsFlip) mutateRps(...)  else  mutateInPlace3(...)
```

so there is still exactly one lineage mint and one event per cell-step, and `which % 180` is not touched. `mutateRps`
takes the two draws `which = draw(base, MUT_WHICH)` and `deltaRnd = draw(base, MUT_DELTA)` that an event already takes:

```
p1 = PARAM1[i] ;  t = (p1 >>> 8) & 0xff ;  m = (p1 >>> 16) & 0xff
other = (t + 1 + deltaRnd % (K - 1)) % K          // uniform over the K - 1 labels other than t
if ((which & 0xff) < rpsEdge)  m ^= 1 << other     // edge: add or remove "kills type other"
else  { t = other ; m &= ~(1 << other) }           // type: relabel, keep the mask (clear the new own bit)
PARAM1[i] = (p1 & 0xff) | (t << 8) | (m << 16)
```

Then the lineage becomes `(step + 1, i)` and the event is recorded as for any mutation. The type change keeps the mask on
purpose: a relabelled lineage is a clone with a new name, so it inherits its parent's prey (and loses it when the new label is that
very prey, since bit `t` must stay clear). The RPS events scale with newly synthesised `B` like every event; at `mutRate` 42,950
(about 10^-5 per quantum) a 128 x 128 x 4 carpet at rung S0 makes about 33 events per 1,000 steps, so about 33,000 over a million
steps, all but one draw in 2^32 of them RPS events when `rpsFlip = 2^32 - 1` (the branch is `draw < rpsFlip`, so that value is
not exactly "always": seed 378360421, step 0, cell 0 has an RPS draw of 4,294,967,295 and a mutation that fires, and the event is
a controller mutation; over 33,000 events the expected number of such draws is below 10^-5, and a test records the case).

**How a longer cycle could arise, and the pre-registered prediction.** At `K` = 5 with three founded labels, a type change from a
founding mask of one bit has three outcomes, whose counts are a test (8). In half of the cases (two of the four new labels) the
clone takes an unfounded label that no mask contains: *nothing preys on it* until some other lineage flips the matching bit, and it
inherits its parent's prey, so it is a strict competitor of its parent and is expected to sweep and then collapse the cycle (a
hierarchy, or a neutral pair), unless mask flips that make it prey (or make it prey on something that preys on it) arrive first.
In a quarter the new label is the lineage's own prey: the mask bit is cleared (no cannibalism) and the clone has **no prey at
all**. In a quarter it is the label of its own predator, with the old prey kept: a mutual pair with the third label, which a
clean cycle excludes. (At `K` = 3 only the last two cases exist, half each.) A genuine four-cycle needs at least two mutations on
different lineages: a clone `3` of type `2` (prey: 0), then an edge flip on type 2 adding prey 3, which gives `2 -> 0`,
`2 -> 3`, `3 -> 0` besides `0 -> 1 -> 2`: a chorded four-cycle `0 -> 1 -> 2 -> 3 -> 0`. The rule draft counts such a chorded
cycle as a long cycle if it is *clean* (no mutual pair, one cycle through every sustained type). **Prediction, registered before
any run: no arm grows a long cycle that beats its null.** Labels-only mutation can never produce a cycle through a new label (no
edge points into it), and edges-only with `K = 3` cannot exceed length 3, by construction; both arms are stability tests. The
operator is unchanged by the review that found the three cases, and stays as built (D11); making a relabel always an immune clone
was considered and not adopted (it would have changed the arm B reading, not the physics), and the arm B prediction above is the one
restated for the operator as built.

### 4.5 Mobility: the knob that is actually varied

The lattice's `M = 2 epsilon / N` is a neighbour-swap rate. The kernel has none. Matter moves by (i) the at-rest blur of
transport (`spread`), (ii) flow along the gradients of the growth field and of mass (`dtQ`, `thetaMass`, `massUnit`), and
(iii) the controller's motility term (`motGain` times the `MX`, `MY`, `MZ` outputs). Dissolved `A`, `C`, `S` diffuse
separately and carry no type.

**Motility gain is not a mobility knob.** Founders have gain 0 and zero `MX`, `MY`, `MZ` weights (`generalistGenome3`;
the probe confirms the flag and the gain do nothing for them). Giving every cell one bias gives a uniform drift: it moves
all types together and changes nothing between them (probe: a ball with gain 255 and an `MX` bias of +64 drifts 0.05 cell
per step and leaves a frozen low-mass trail; drift 0.014 at gain 64). A mobility that mixes types needs a direction that
varies from cell to cell, and no weight of the founders' controller makes one (their `MX`, `MY`, `MZ` weights are zero);
evolving one would be a different experiment.

**`spread` is the isotropic term**: a cell at rest spreads its `B`, `P`, `E` over the 27 cells covered by a box of
half-width `32 + spread` (units of 1/64 cell), nominal diffusivity `D = spread / (64 + 2 spread)` cells^2 per step per
axis (0.10 at 8, 0.25 at 32), range 0 to 32. Three things make it a rougher knob than the lattice's `epsilon`:

1. **Integer floors.** `share3` floors axis by axis, so a resting cell exports nothing in a face direction below a
   minimum `q` (probe, `share_thresholds`):

   | spread | 1 | 2 | 4 | 8 | 16 | 32 |
   |---|---|---|---|---|---|---|
   | min `q`, +x / +y / +z face | 198 / 137 / 72 | 102 / 73 / 40 | 54 / 41 / 24 | 30 / 25 / 17 | 18 / 18 / 14 | 16 / 16 / 16 |

   The carpet holds 28.5 `B + P` per living cell (probe), so at spread 1, 2 and 4 it exports almost nothing laterally,
   at 8 only in `y` and `z`, and from about 12 to 16 in every direction. The probe's still ball spreads at
   `D_xy = 0.0036` cells^2 per step against a nominal 0.1 at spread 8. The scratch meter (rule draft 3.1) found the label mixing
   index flat at spreads 1, 2 and 4, anisotropic at 8 (0 along x, 0.035 along y) and a plateau from 12 up that is not monotone.
2. **Colonization and mobility are one transport.** The lattice separates reproduction from exchange; here a vacancy is
   refilled only by flow and the lottery from its neighbours. At spread 0 nothing moves and nothing refills (inert); at
   low spread the film freezes. So a cliff, if there is one, may appear at the *low*-mobility end, the opposite of the
   lattice's orientation. The rule draft names that outcome (A2) rather than forcing the lattice's reading.
3. **`spread` also sets cohesion**: the speed cap `dmax = 64 - spread` and the stay fraction `(64 / (64 + 2 spread))^3`
   (0.512 at 8).

The x-axis of every plot is therefore a measurement, not the nominal `D`: before the sweep, an inert uniform carpet (all rate
constants 0, **`dtQ` 0**, `B` at the carpet's level, half the lines labelled 0 and half labelled 1 in two stripes, once along x and
once along y) runs 5,000 steps at each spread, and a label **mixing index** (cells^2 per step, reported along x and along y and
averaged) is computed from the integrated width of the two label interfaces (rule draft 3.1). `dtQ` is 0 in the meter because the
affinity gradient is not zero at the z walls: with `dtQ` 51 the displacement is one 64th of a cell toward the walls at every
spread, the end layers gain mass (scratch: a start of 28 per cell became 31, 25, 25, 31 in the four layers after 1,200 steps at
spread 4) and the stripes are not inert. The live runs keep `dtQ` 51, and that flow is part of the substrate. The index is not a
diffusivity: the erfc formula assumes the deterministic profile and a sampled label field biases it by an amount nobody has
measured. This is the probe's second-moment method applied to the quantity that matters here, the label field.

**Grid:** chosen, not fixed. Candidates {2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32}; Gate 0 (rule draft 3.0) keeps the spreads whose
control is a carpet and whose index rises by a factor of 1.3 or more over the previous one kept, at most 8, and fails a substrate
that leaves fewer than 5 (at 28 quanta the scratch meter found three levels). Spread 0 is inert and is not swept; it is kept only
as the meter's baseline. Whether to add an explicit swap knob instead is an open decision, routed by section 11: only if the
sweep ends in A6 (or in A5 by the main session's choice); A7 and the other stops are substrate questions.

### 4.6 Depth and light

v1 is the thinnest slab, `tileD = 4`, because the spiral literature is about a film and a 128 x 128 x 4 world is much
cheaper per step than the M4 shape. The radius-3 kernel reaches every layer from every layer (z offsets 0 to 3), so the
four layers couple strongly; the census reports *z-coherence* (the share of columns whose living cells all carry one
label) every time, as a diagnostic and not a gate (scratch: 0.23 to 0.36 whenever the film mixes, 0.85 to 0.90 only in frozen films).

**Light.** `lightK = 16384`, uniform light, `lightBase 40 + lightAmp 200 = 240`, seasons off. Each occupied layer costs
exactly 1 light unit when `lightK >= 255 (B + P)` (probe), so a four-layer column of 32 quanta per cell sees 240, 239,
238, 237 (floor fraction 0.988): shading is out of the experiment, which is what a lattice analogue wants. (At rungs S1 and S2, with
110 and 220 quanta per cell, a layer costs 2 and 4 units and the bottom layer keeps 97 and 95 % of the surface light.) Gradient light
is not used; the probe infers, from the uniform-light thresholds and without running it, that the generalist could live
only in the brightest 20 to 35 % of rows.

**Deep volumes.** The probe says a 32-layer column stays alive throughout at uniform 240 and `lightK` 16384 (floor light
209, 100 % living through z = 31 with mu 50, sigma 12), is marginal at 4096 and reaches only 14 to 16 layers at 1024.
`tileD` is capped at 32 (`validateConfig`), so 64 layers is arithmetic only. The 3D scroll-wave render is therefore *not*
out of reach on light grounds. It is out of reach for the implement phase, and in the run phase it is conditional: only if
the quasi-2D sweep shows dynamic coexistence with a cyclic signature (class DC) and a measured label correlation length of at
least 6 cells (rule draft 6.1) is one 64 x 64 x 32 run (131,072 cells, three seeds) made, and what it yields is an exploratory
render. The first draft's conditions, a spectral wavelength of at most 16 cells and a z-coherence of at least 0.9, are dropped: the
scratch z-coherence of the four layers was 0.23 to 0.36 whenever the film mixed, so it could not hold together with dynamic
coexistence, and the wavelength of a noise-scale label field (correlation length 2) is trivially small. No scroll-wave claim is
made in v1, and no 3D render is expected from this substrate. If the condition fails, the companion page states the reason: no
job in dynamic coexistence, or a correlation length at the noise scale, so there is no spiral state to extend.

### 4.7 WGSL

**No new entry point and no new binding.** The additions live in `reactShader3`: the predation block, the
`mutate_rps` function (a function, not a declaration in workgroup memory), the mirror OR at the final `MOT` store, and one changed
line, the `F[FX_BDECAY]` assignment, which becomes a sum with the kill's `q`.
`reactShader3` keeps `var<workgroup> wg: array<atomic<u32>, 24>` (96 bytes) and its 8 storage bindings, so the Deno
single-declaration cliff (about 8 KiB per declaration; affinity's 7,840-byte tile is the only large one) is not
approached, and `maxStorageBuffersPerShaderStage` (requested up to 10, `gpu-sim3.ts:41`; WebGPU's floor is 8) is not
asked for more. `prelude3` emits the RPS constants (`RPS_ON`, `RPS_K`, `RPS_RATE`, `RPS_MIN`, `RPS_FLIP`, `RPS_EDGE`,
`RND_RPS_KILL`, `RND_RPS_FLIP`) *only* when the keys are present, and the react template inserts the blocks only then, so
the key-absent shader text is unchanged. If Gate 0 chooses rung V, the block the template inserts is the vacancy kill of 4.3a, selected
by the kill-form key, in the same place; the `F[FX_BDECAY]` sum is then not needed (an emptying books no flux), and nothing else in this
section changes.

**Alternatives considered.** A separate pass between light and react with its own entry point (workgroup size
`WG3`, dispatch `(W/8, H/8, D/4)`, no workgroup memory because six face reads come straight from storage, as transport's
diffusion does) would read the post-lottery genome directly and need no mirror. It needs a per-cell kill store with no free
buffer: words `N..2N-1` of the light buffer (allocated `2N` only with the keys), or a ninth react binding. It also touches
`gpu-sim3.ts`'s pipeline list, bind groups, dispatch and profile branch. It is the right shape for the deferred transfer;
for removal it buys nothing the mirror does not.

## 5. Bounds for `docs/rules.md`

Added to the slab table (`docs/rules.md`, "The slab"); nothing there changes. States stay valid on entry as before:
matter <= `MATTER_MAX = 2^26`, `E, S <= 2^27`.

| quantity | bound | why |
|---|---|---|
| `k = rpsRate * ndom` | <= 10,922 * 6 = 65,532 < 2^16 | `mulFrac(q, k, s)` needs `s <= 16` and `k < 2^(32 - s)` |
| `mulFrac(B, k, 16, rnd)` | `hi = (B >> 16) * k <= 1024 * 65,532 < 2^27`; `lo = (B & 0xffff) * k < 2^32`; result <= `ceil(B * k / 2^16) <= B` | `B <= 2^26`, `k < 2^16` |
| kill `q` | `q <= B`; the `min(B, .)` is kept so a future change cannot break it | so `B - q` cannot wrap |
| `C + q` | <= total matter <= 2^26 | matter is closed; the kill moves quanta between two channels of one cell |
| heat `q * (eB - eC)` | <= 2^26 * 31 < 2^31 | the per-cell heat is already a 64-bit pair (`hadd`) |
| `E`, `P`, `S`, `A` | untouched by the kill | `E` during react stays <= 2^27 + 31 * 2^26 < 2^32 |
| vacancy kill (rung V): `k = rpsRate * ndom` | <= 16,384 * 6 = 98,304 < 2^17 | the test is `(draw & 0xffff) < min(65,536, k)`: no `mulFrac`, so the bound `6 * rpsRate < 2^16` above does not apply to it |
| emptying heat `B (eB - eC) + P (eP - eC) + E` | <= 31 * 2^26 + 2^27 < 2^32 | `B + P <= 2^26`, the energy gaps are <= 31, `E <= POOL_MAX3` after the cap; each term is added with its own `hadd` |
| `C + B + P` after an emptying | <= total matter <= 2^26 | the emptying moves two channels into a third in one cell; `A` and `S` are untouched |
| mirror | `MOT >>> 24 = m <= 255`; bytes 0-2 untouched | flow reads bytes 0-2 only |
| mask and type | `m < 2^K`, `K <= 8`; `t < K`; bit `t` clear | `validateState` |
| mutation | `deltaRnd % (K - 1)`, `K >= 3`; `which & 0xff` against `rpsEdge <= 256` | |
| lineage ids | unchanged, `(step + 1, cell)`, one mint per cell-step | the RPS branch replaces the mutation call, it does not add one |
| draw slots | 40 (kill), 41 (RPS-or-controller choice) are unused elsewhere on the cell key | `migration.ts`, `exchange.ts`, `ponds.ts` use salted seeds; `RND3` ends at 39 |
| `rpsFlip` | the RPS branch is `draw(base, 41) < rpsFlip` with `rpsFlip <= 2^32 - 1` | strict, as the mutation test is; 2^32 - 1 is "every event but one draw in 2^32", never exactly "always" (a counterexample is a test, 8) |
| founding hash | `lowbias32((seed * 317 + key) >>> 0)`, `seed * 317 + key` formed in doubles | host side only (founding is not in the shader); exact below 2^53, and `lowbias32` itself reads its argument as `x >>> 0` |

## 6. The lattice reference

A plain TypeScript module, outside the kernel, with no GPU and no imports from the simulator packages
(`experiments/3d-rps/rmf-lattice.ts`). It is the only quantitative comparison with the literature, and the source of the
inline 2D canvas.

**Model and units** (JTB08 section 2, as read for this note).

- `N = L^2` sites on a periodic square lattice with four neighbours. A site is empty or holds species 1, 2 or 3; species
  `s` kills species `s mod 3 + 1` (1 kills 2, 2 kills 3, 3 kills 1). The code takes the cycle length `K` as a parameter
  (3 in v1).
- Rates `sigma = mu = 1`; exchange rate `epsilon = M * N / 2`, so the reported mobility is `M = 2 epsilon / N`. The module
  reports `epsilon`, `N`, `epsilon / N` and `2 epsilon / N` for every run, because the literature's meaning of "mobility"
  is not pinned down (section 1).
- **One reaction step.** Pick a site `a` uniformly and one of its four neighbours `b` uniformly. Draw `u` uniform in
  `[0, mu + sigma)`. If `u < mu`: reproduction, `b <- a` when `a` is occupied and `b` empty. Otherwise selection: `b <- empty`
  when both are occupied and `a` kills `b`. Attempts that do nothing still count as a step.
- **One generation = N reaction steps.** Before each reaction step, `E` exchanges happen, each picking a site and a
  neighbour uniformly and swapping their contents (a swap with an empty site is a hop). `E` is geometric,
  `P(E = e) = q^e (1 - q)` with `q = epsilon / (mu + sigma + epsilon)`, drawn by repeated integer Bernoulli trials against
  the 32-bit threshold `floor(q * 2^32)`; no floating-point logarithm, so draws are identical on every host. Whether RMF's
  generation counts the exchange events among its `N` steps is not settled; the two readings differ by a factor
  `1 + epsilon / 2` in time, which is 1.18 at `L` = 40 and 1.4 at `L` = 60 for `M` = 4.5 x 10^-4.
- Random start: every site independently empty or species 1, 2, 3 with probability 1/4 each.
- Stop when at most one species is left (absorbed) or after `N` generations.
- PRNG: xoshiro128** seeded through splitmix32 from the run's seed; site index `floor(u32 * N / 2^32)`, direction
  `u32 >>> 30`.

**What is measured** (the numbers are fixed in rule draft section 2).

- `P_ext(L, M)`: the fraction of realizations with at most one species left at `t = N` generations. Sizes
  `L = 20, 30, 40, 60`; 11 values of `M` from 10^-5 to 2 x 10^-3; 600 realizations per cell, so the standard error is
  about 0.02 at most; the error the rules use is the add-one one, never 0.
- The crossing: for each pair of sizes, `D(M) = P_ext(L_2) - P_ext(L_1)` is negative at low `M` (the larger world survives
  better), positive above `M_c`; a pair counts only if a significantly negative value precedes the sign change and a
  significantly positive one follows it (two counts of zero are not a crossing); `M_c` is the median (for an even count, the
  mean of the middle two) of the log-interpolated zeros. Six pairs.
- The wavelength is not measured in v1, and no number is reported in its place (rule draft 2.5, D7; section 11).
- A well-mixed sanity check: at large `M` the densities in the first generations stay near 1/4 each.

**Cost.** A run is `N^2` reaction steps (`t = N` generations), with a mean of `epsilon / 2 = M N / 4` exchanges per reaction step
(1.8 at `L = 60`, `M = 2 x 10^-3`). Per `M` value with 600 realizations the four sizes sum to about 1.0 x 10^10 reaction steps;
over the 11 values the events come to 1.55 x 10^11, an upper bound because absorbed runs stop early. At an assumed 30 million
events per second per core (to be measured when the module is written) that is 1.4 core-hours, 10 minutes on eight workers; a
naive scratch implementation reached 9 million reaction steps per second on a loaded core, which would make it 4.8 core-hours,
36 minutes on eight workers. The contingency, `L = 100` at 300 realizations and six values of `M` around the crossing, is 3.9 x 10^11
events (3.6 core-hours at the assumed rate, 12 at the scratch rate; 27 minutes to 1.5 hours on eight workers) and is run only if the
first sweep ends in rows 3 to 5 of rule draft table 2.6. `L = 100` in the main grid at 600 realizations would cost about ten times
the first sweep (1.5 x 10^12 events as an upper bound); it was not adopted (D9). `L = 200` at the paper's 500 to 2000 realizations (1.6 x 10^9 steps per
run) is out of scope.

**Tests (vitest, `experiments/test/rmf-lattice.test.ts`).** Determinism (a fixed seed gives a pinned state hash after 50
generations); the cycle (each species kills exactly the next); reproduction only into empty sites, selection only by the
killing species, swaps conserve the species counts; the geometric sampler's mean is `q / (1 - q)` within tolerance; the
absorbing condition; the mean-field densities near 1/4; the hash of the first frame of the browser copy equals the
TypeScript module's. The crossing rule has its own synthetic-data tests in the readout's (zero counts at both sizes are not a
crossing; an even number of valid pairs gives the mean of the middle two).

**Visual.** The companion page runs the same simulator live in a canvas (type-stripped copy of the module, hash-tested
against the TypeScript source) with a mobility slider across `M` = 10^-5 to 2 x 10^-3 (the registered grid of rule draft 2.2), so the spirals and the
extinction above `M_c` can be watched; the wavelength against `M` is seen there, not measured.

## 7. Kernel runs, observables and seeds

### 7.1 Fixed physics of every kernel run

Preset `slab-rps` (new, in `SLAB_PRESETS`, headless runs only like `slab-spots`) at the substrate of the Gate-0 record; rung S0 is:
128 x 128 x 4, `kernelRadius` 3, uniform light 40 + 200, `lightK` 16384, `defaultMu` 50, `defaultSigma` 12 (the M4 carpet: 100 %
living at `lightK` 1024 and 4096; the probe kept it alive in 16 x 16 x 4 at `lightK` 65536 and through 32 layers at 16384),
`mutRate` 0 unless a run says otherwise, `rpsTypes` 3, `rpsMin` 4, every other key default (`dtQ` 51, `thetaMass` 512, `massUnit` 256,
`diffA/C/S` 200/200/150). Founding `rps-mix`: `K0 = 3`, `occupied` 75, `columns` true, `nutrient` 20, `biomass` 16. Every job starts
with a burn-in of 6,000 steps with no kill and no mutation, then continues with its own settings in a new simulator built from the
state read back (the rule constants are in the shader text). Per run only `seed`, `spread`, `rpsRate`, `rpsTypes`, `rpsFlip`,
`rpsEdge`, `mutRate`, `K0` and the step budget vary, and the rule draft lists which. The carpet is the substrate on purpose: M4's
"neither dead nor carpet" gap is moot here, because a lattice ecology wants a full lattice. The scratch runs say that on this
carpet removal acts as replacement (section 10); Gate 0 is where that is put to the test, and where a rung with finer quanta
replaces the matter constants, or the vacancy kill of rung V (4.3a) replaces removal.

### 7.2 Observables (`rpsCensus`, in `@bl/metrics`)

Computed on the host from `readSnapshot()` (cells plus the genome head, which already holds PARAM1: `gpu-sim3.ts:281-285`),
at every census (every 1,000 steps), in the style of `census3`'s head loop (`census3.ts:28-36`). No GPU stats widening.

- per label `x` in 0..7: living cells, `B + P` mass, the modal beats-mask (ties to the smaller value);
- `living` fraction, the labels above the share threshold, the clean-cycle length `Y` (rule draft 0);
- turnover since the previous census (fraction of cells living at both whose label changed), and, in jobs without mutation, the two
  chirality counts: cells whose label changed to the killer of the old label, and the reverse (rule draft 0);
- z-coherence (share of columns whose living cells share one label), per-layer label counts, the label mixing index where
  applicable; the correlation length of a final snapshot;
- in jobs with mutation, the mutant supply: lineages with a nonzero birth step that hold at least 64 living cells;
- from the drivers: `flux` and the ledger residual (must be 0 at every census; a nonzero residual stops the run), and the
  `burnHash` at the end of the burn-in.

Outputs per job: `census.tsv` (one row per census, the burn-in's included), `summary.json` (config, seed, host, steps/s, residual,
outcome inputs), and for the sweep treatment runs a final snapshot (`final.bin`, 3 MB) for the correlation length and the render.
Drivers follow `experiments/3d-slab/m4-calibrate.ts`: one JSON per job, a job whose result exists is skipped, two machines share
one queue (`--reverse`). The slab runner path (`runner.ts`, `OVERRIDE_KEYS` is a five-key allowlist at `runner.ts:530`, and the
slab legal-run check) is not used in v1. If the line moves into the runner, `census.tsv` becomes `types.tsv` beside
`layers.tsv`, with the same columns.

### 7.3 Seeds

Seeds 1 to 6 belong to the 3D depth check and are never used here (no calibration may see them). 101 to 103 were rung 1b's
M4 calibration. 301 to 316 are the slab golden cases and 321 to 327 will be the RPS golden cases, so they are not reused for
runs. Fresh blocks: lattice realizations `2,000,000 + 100,000 * iL + 1,000 * iM + r` (`iL` the size index, `iM` the `M`
index, `r < 1000`); kernel: 401-499 the Gate 0 pilot (never reused by a registered stage; rung V uses the seeds of the rung it shares jobs with, and 404 is the dense-rate job), 201-202 kill-rate calibration (rate 0 on
the same seeds is the paired control), 205 mobility meter, 211-215 sweep treatment with 211-213 as the paired controls, 231-233
kill-rate arms, 241-246 longer cycles as given, 251-255 mutation arms (one block for every arm, so initial conditions are paired),
261-263 deep volume. The reviews' scratch runs used kernel seeds 9001 and up and lattice seeds from 3,500,000, 7,000,000 and
8,000,000; those are never reused for a result. Rehearsals of the scripts (a few thousand steps, plumbing only) use seeds 900 and
up and are never results.

## 8. Milestones

Each milestone ends green on `pnpm typecheck` and `pnpm test` with every existing pin untouched (27 2D + 16 slab), and is
reviewed by Codex (Sol 6.1 at High effort, read-only, standing instruction; not Astra) at the phase boundary and before
its commit. **The work comes in two parts (D1), which together are the implement phase; the run phase follows them: every run and M5b.**

**Part A (no kernel change).** It touches no file under `packages/sim-ref/src`, `packages/sim-gpu/src` or `packages/schema/src`, so
every golden pin stays byte-identical (`deno run -A --no-lock tests/deno/gpu_golden.ts` still prints 43 PASS: 27 2D + 16 slab). It is
the lattice module with its tests and sweep CLI (M3a code); `census-rps.ts` and the readout (M3); the committed spike with the V switch
and the Gate-0 driver (below, D16); the companion page (M5a, D15); then the freeze of `RULES.md` (D28); and then Gate 0 itself, run on the
spike. **Part B (only after Gate 0 gives GO for some rung)** is M0, M1 and M2 for the kill form of the rung used, the kernel drivers (M3)
and the mutation driver (M4); the Gate-0 record's hash is appended to `FROZEN` before any of its registered runs; then the run phase.

**Gate 0 comes first: before M0, on the spike (D1), after the freeze of `RULES.md` (D28).** The spike is the review prototype (rule draft
3.0), committed as `experiments/3d-rps/gate0-spike/` (D16), with `census-rps.ts` and the Gate-0 table of the readout as its instruments.
It takes the rungs in the order S0, S1, S2, V and stops at the first GO (D24). Its cost is in section 9 (1.8 h of M1 Max time for a
substrate rung that gets to the end, 1.0 h for one that fails at the table, then V's own jobs when S0 and S1 are both excluded; S1 beside
S0 on the second Mac is possible on request and costs S1's jobs if S0 gives GO). The rung decides what M0 to M2 are built for (the substrate, the kill form and, on a stop,
whether to build anything), the prototype already exists, and the price of a wrong guess is three milestones of schema, CPU and WGSL
work: that is why Part B waits for a GO. The alternative that was weighed, Gate 0 after M2 on the shipped kernel with the same rules,
was not adopted: the build would come first and the spike-versus-kernel gap (section 10) would disappear, at the price just named.
Part A does not wait for Gate 0, because it depends on nothing in the kernel.

**Spike agreement** (Gate 0 runs on the spike, D1): M2's acceptance includes one run of the shipped GPU kernel from the spike's
founding (4.4) at 64 x 64 x 4, spread 16, rate 128, seed 9001, 2,000 steps with no burn-in (as the scratch logs were made), which
must reproduce exactly the per-census label counts of the spike run on the same configuration; a difference is a bug in one of the
two. That spike run is made at the end of Part A, from `experiments/3d-rps/gate0-spike/` on the tree of the Gate-0 record, and kept in
`runs/rps/gate0/`: the spike patches the shader text that M2 changes, so it cannot be rerun once M2 is merged. If V is the rung used,
the run uses the vacancy kill at the Gate-0 record's `v_cal` and `kappa_w` in place of spread 16 and rate 128, on both sides.

- **Gate-0 spike and driver (Part A, D16).** `runs/rps/review/proto` is copied to `experiments/3d-rps/gate0-spike/` (the original is
  never written); the copy imports nothing from `runs/`, and nothing in `packages/` imports it. The copy, and only the copy, gets the V
  switch (the vacancy kill beside the removal kill, chosen per job) and the Gate-0 driver: the job tables of rule draft G0.2 to G0.6,
  writing `census.tsv` and `summary.json` per B.2 and B.3 under the driver conventions of 7.2, and the V check (one rate-0 job run with
  both builds, the two `census.tsv` compared byte for byte). It is tested by a rehearsal on seeds 900 and up (plumbing, not a result).
  The SHA-256 of the committed copy (rule draft 3.0) is taken before the first Gate-0 job and goes in the Gate-0 record. The copy holds
  only what Gate 0 uses (D29): the review's scratch drivers, scripts and `out/` logs and snapshots are not carried over and never added.
  Until the files are committed `git ls-files` cannot list them, so the hash is first computed over the exact sorted list of the files
  kept, which is written beside it in `experiments/3d-rps/gate0-spike.sha256`, and the committed files must give the same value. The
  reference run for the spike agreement below is made at the end of Part A.

- **M0 Schema (Part B).** `layout3d.ts` constants, the five keys and `validateRps`, `genome3.ts` fields and decode option
  (`decodeGenome3` and `genomeFromHex3` both take `{ rps: true }`, strict by default), `validateState`'s key-conditional checks,
  `rpsMixWorld`, the preset and its identity, the `foundingWorld` cases (`generalist` and `rps-mix`, and a default that throws).
  Tests: every validation refusal; the default config still 592 bytes with digest `3459f056,65cdb756`; the old reserved-byte
  refusals still fire with the keys absent; encode/decode round trip for every K, and the same through `genomeHex3` and
  `genomeFromHex3` for a type 1, mask 4 genome; every `validateState` rps check (type, mask bits, own bit, byte 3, mirror
  mismatch, non-living mirror, mass without lineage); founding determinism, lineage ids, mirror words, the biomass base and index of
  4.4 for `columns` true and false pinned by a hash; every existing preset kind still builds the world it built.
- **M1 CPU reference (Part B).** `step3d.ts` and the `docs/rules.md` subsection. Tests: (a) keys absent: the slab pins
  hold, and a world with the keys present but inert (`rpsRate 0`, `rpsFlip 0`, one type, mask 0) steps cell for cell and
  word for word like the key-absent world at steps 1, 10, 30 (only the config differs); (b) exact matter and energy
  conservation over 200 random RPS slabs (random types, masks, `B`, `rpsRate` to the maximum, `rpsMin`); (c) hand examples
  of `ndom`: z walls, the gate at `rpsMin - 1` and `rpsMin`, one test per mask bit and type, no self type, empty and
  non-living victims; (d) locality, the gather structure: the kill of a cell (`rpsDominant` and the amount for a fixed
  draw) changes only when the cell's own `B` or type, or a face neighbour's `B` or mirror, changes, and never with any
  cell's `E`, `P`, `S` or `A` or with a non-neighbour (the whole react output also moves with light, which is why the test
  is on the kill and not on the output); (e) mirror consistency and `validateState` after every step of heavy-mutation
  runs; (f) `mutateRps`: invariants (bit `t` clear, bits `>= K` clear, bytes 0 and 3 kept, exactly one bit flipped by an
  edge event, label uniform over the other `K - 1` within tolerance over 10^5 draws, `K = 3, 5, 8`), and the three outcome
  classes of a type change from a founding mask of one bit (empty mask, relabel to a founded label, relabel to an unfounded
  label) with their counts for `K` = 3, 4, 5, 8; (g) lineage immutability under heavy mutation; (h) `B` at the 2^26 end with the
  maximum rate: no wrap, `q <= B`; (i) the `bdecay` flux of a cell-step with both a kill and the passive decay is the sum of
  the two (the existing assignments become accumulations), and the flux identities of `capabilities.ts:263-267` hold; (j)
  `rpsFlip` at 2^32 - 1 against the counterexample draw (seed 378360421, step 0, cell 0: the flip draw is 4,294,967,295 and the
  event is a controller mutation), documenting "every event but one draw in 2^32"; (k) the test helper `mirrorZ`
  (`packages/sim-ref/test/step3d-helpers.ts`) masks the z byte (`& 0xff`) and keeps bits 24-31, or is not used on states with the
  keys. The z-mirror symmetry test of the deterministic operators does not apply to the kill (the draw is cell-indexed, as for
  diffusion).
- **M2 WGSL twin (Part B).** The `prelude3` constants and the three `reactShader3` blocks (the `F[FX_BDECAY]` assignment becomes a
  sum); seven golden cases (seeds 321-327), all on `slabCfg`: `slab-rps-default-32x32x8` (K = 5 type space, 3 founding types,
  `rpsRate` 2048, half the events RPS, `mutRate` 60,000,000), `slab-rps-surround-16x16x8` (a checkerboard of types 0 and 2 so every
  even cell has six dominant neighbours, maximum rate, `B` in {1, 7, 4095, 16381}), `slab-rps-k8-16x16x8` (K = 8, mask bit 7,
  `MOT` bit 31), `slab-rps-gate-16x16x8` (`rpsMin` 255 with `B` in {254, 255, 256}), `slab-rps-walls-16x16x8` (predators at z = 0
  and z = D - 1, and a full column), `slab-rps-off-16x16x8` (keys present, `rpsRate` 0, `rpsFlip` 0), and `slab-rps-bigb-16x16x8` (a
  checkerboard with 16 victims at `B` in {65,536, 65,537, 2^20 - 1, 2^22}, maximum rate, so the high word of `mul_frac` is used
  at `k` near 65,532, within the world's matter bound; living cells with `B` = 0 and `P` in {1, 100} beside predators, whose mirror
  must keep its mask, and cells that clear). Pins under `PINNED[1]` after the CPU run (add the case, run `golden-hashes.test.ts`,
  paste the hash, confirm Deno prints the same one); bit for bit in Deno (`tests/deno/gpu_golden.ts`, which enumerates
  `goldenCases()`) and in Chrome (`/selftest.html`); a test that the key-absent `reactShader3` text equals the text at `caf9a431`
  and that no new `var<workgroup>` or binding appears with the keys; a Deno GPU check (`tests/deno/gpu_rps_inert.ts`, not a golden
  case) that the inert keys-present world equals the key-absent world cell for cell at steps 1, 10 and 30 on the GPU. Reported,
  not gating: steps per second at 128 x 128 x 4 dense (carpet, mu 50 / sigma 12) with the keys on and off, on the M1 Max, and the
  share of a run taken by the census readback (one snapshot is 2.9 MB); the step-budget rule of the rule draft (1.2) does not key to
  this figure but to the idle M3 Pro's dense rate measured on the spike during Gate 0 (G0.6, D3).
- **If rung V is the rung used (D14).** M0 to M2 implement the vacancy kill of 4.3a in place of removal, which stays the documented
  alternative and is not built. *M0:* a kill-form key (provisional name `rpsKill`, with the one value `"vacancy"`) joins the keys of 4.1
  and `validateRps`, and `rpsRate` ranges 0 to 16,384 under it; the other M0 tests stand. *M1:* 4.3a replaces 4.3. Tests (a), (b) with
  the vacancy kill in the random slabs, (c), (d), (e), (g), (j) and (k) stand; (h) becomes the heat bound (a victim with `B + P` near
  2^26 at the maximum rate: no wrap, `B (eB - eC) + P (eP - eC) + E < 2^32`); (i) becomes "an emptying books no flux": the cell-step
  changes no flux counter, moves exactly `B + P` into `C` and `E` into heat, and the matter and energy residuals are 0 (the flux
  identities of `capabilities.ts:263-267` are not asserted on such a step, as on a 2D injury or lesion step); new: (l) an emptied cell
  has `B = P = E = 0`, both lineage words 0, `MOT = MOT_ZERO3` and `A`, `S` untouched; (m) the kill is exact at the threshold: with
  `k = rpsRate * ndom` and `t = min(65,536, k)` a cell is emptied iff `(draw & 0xffff) < t`, checked at `k` in {0, 1, 65,535, 65,536,
  98,304} on draws whose low 16 bits are 0, `t - 1`, `t` and 65,535 where those exist. *M2:* the same blocks in WGSL (without the `F[FX_BDECAY]` sum, since an emptying books no flux) and the seven
  golden cases with the vacancy kill, where `slab-rps-bigb`, which exists for the high word of `mul_frac`, is replaced by a case whose
  victims have `B + P` and `E` near their bounds at the maximum rate (the emptying's heat sum).
- **M3 Lattice reference and kernel sweep.**
  *Implement, Part A:* `rmf-lattice.ts` (+ worker, sweep CLI; no wavelength tool) with its tests; `census-rps.ts` with tests (per-label
  census, modal masks, clean-cycle length, turnover, chirality counts, correlation length, z-coherence, mutant supply); and
  `readout.ts`, which applies the frozen rule draft (run classes, per-spread counts, the Gate-0 table, the outcome rows) and has a
  synthetic-data test for every outcome row; `lib/kernel-job.ts` (the two-phase job: burn-in, switch to the job's settings, early
  stop, `burnHash`; the Gate-0 driver needs it, so it is Part A).
  *Implement, Part B:* `kernel-meter.ts`, `kernel-kappa.ts` and `kernel-sweep.ts` (the drivers, which reuse `lib/kernel-job.ts`, with
  tiny-run tests).
  *Run:* M3a the `M_c` sweep; M3g Gate 0 (above; Part A, on the spike); M3m the label-mixing meter; M3k the kill-rate calibration; M3b
  the `spread` sweep with controls and kill-rate arms; M3c longer cycles as given (`K0` = 4 and 5, three seeds each).
- **M4 Mutation runs.** *Implement, Part B:* `kernel-mutation.ts` and its readout rows (arm Z first, the horizon check, the mutant supply).
  *Run:* arm Z (five seeds), then, if section 7 is not void, five arms times five seeds, `T_end7` steps (edges with K = 3; labels
  with K = 5; both with K = 5; the null, both with `rpsRate` 0; weights only with K = 3). Gated on the sweep outcome (rule draft 7.1).
- **M5 Readout and visuals.** *M5a (Part A, D15):* the self-contained companion page `docs/3d-cyclic-rps-companion.html`, in
  the style of `docs/3d-brainstorm-2026-10-22.html` (theme tokens, both colour schemes, phone width), with the live 2D RPS
  canvas (a type-stripped copy of the lattice module, hash-tested against the TypeScript source, 6) and the result slots. The kernel
  result slots (the Gate-0 table, the sweep, the mutation arms, the deep run) are present and labelled "not yet run" instead of being
  hidden, and so are the lattice sweep's until M3a has run. *M5b (run):* the plots filled from the result files (`P_ext` against `M`
  for each size with the crossing marked; sweep outcome against `spread` and against the mixing index; the Gate-0 table; the mutation
  outcome table), kernel label-field snapshots drawn as images, the conditional deep run and its render or the stated reason it is not
  shown, and dated result sections appended to this note.

**Freeze (D28).** The order is fixed by the main session's ruling of 2026-10-24. Part A is merged first. Then, **before Gate 0 and before the
lattice sweep**, the main session reads `runs/rps/rule-draft.md` (every open value was settled on 2026-10-24, D1 to D30; the only values
that may still move on evidence are the ones Gate 0 sets by its fixed rule, which go in the Gate-0 record and not in the rules, and the
reduced step-budget schedule of rule draft 1.2 on the dense rate of G0.6), copies it to `experiments/3d-rps/RULES.md`, and records its
SHA-256 in `experiments/3d-rps/FROZEN` (the convention of `experiments/FROZEN`); `readout.ts` refuses a rules file whose hash is not
recorded, and `gate0.ts --gate0` and the lattice sweep refuse to start before it. Gate 0 then runs. The Gate-0 record
`experiments/3d-rps/GATE0-RECORD.md` is written at the final GO (or GATE-0-STOP), the dense rate of G0.6 is entered in it when measured
(at GO the first writing may hold `denseRate: null`), and its SHA-256 is appended to `FROZEN` in a dated line once it is complete, before
any Part B registered run. `readout.ts` requires the recorded hash of `RULES.md` for every command; an existing, unhashed record stays
provisional (the Gate-0 table and the lattice still run, and G0.6 completes the record), while every registered Part B readout (meter,
calibration, sweep, cycles, deep, mutation) requires the record's current hash in `FROZEN` and takes the operating point from it.
`RULES.md` itself never changes after the freeze except by a dated amendment. If Gate 0 stops, the kernel
sections of the rules are struck by a dated amendment and only the lattice is registered and run (the lattice does not depend on Gate 0).

**Order and parallel work.** Part A first, in this order of need: the lattice module (M3a code; it depends on nothing and can start at
once); `census-rps.ts` and the readout (`census-rps.ts` needs nothing from M0: until M0 exists it holds the byte positions of PARAM1
itself, type at bits 8 to 15 and mask at bits 16 to 23, pinned by a test, and M0 turns them into imports of the `layout3d.ts`
constants); the committed spike with the V switch and the Gate-0 driver (the driver needs `census-rps.ts`); the companion page (M5a
needs M3a); then the freeze of `RULES.md`, and Gate 0 (the rungs in the order S0, S1, S2, V, stopping at the first GO) beside the
lattice sweep. Part B may be built after the final GO, and its registered runs start only after the completed Gate-0 record is hashed into
`FROZEN`: M0 next; M1 and M2 both need M0
and run side by side (separate files); M2's pins need M1; the kernel drivers need M0 and `GpuSim3` and are tested against `RefSim3`. In
the run phase: M3a, M3m and M3k first (cheap), then M3b from one two-machine queue, then M3c, and M4 (arm Z first) if the gate passes,
then the conditional deep run, then M5b.

## 9. Sizing

The first draft derived its planning rates for 128 x 128 x 4 (65,536 cells), dense carpet, from the probe's timings (256 x 256 x 4:
495 steps/s sparse and 250 dense; 128 x 128 x 8: 808 and 523; per-cell cost 8 to 15 ns, so about 1,000 steps/s idle at this size)
scaled by 0.6 for the load the probes ran under (load average 15 to 47 on ten cores): 600 steps/s on the M1 Max (range 400 to
1,000) and 900 on the M3 Pro (the rung 1b M3 gate ran 234.5 steps/s there against 130 to 158 on the M1 Max for 256 x 256 x 8, about
1.5 times). **Measured since, by the two reviews** (a prototype with the kill and a census every 1,000 steps, on a loaded M1 Max,
load average 3.7 to 8): 307 to 541 steps/s at 128 x 128 x 4 in one, 430 to 540 in the other, up to about 1,000 when the film is
sparse. The totals below therefore use **450 steps/s on the M1 Max and 675 on the M3 Pro** (the loaded rate) and give the first
draft's 600 and 900 (idle) in brackets. M2 measures the rate of the shipped kernel; the reduced schedule of rule draft 1.2 keys to
the idle M3 Pro's dense rate, measured on the spike during Gate 0 (G0.6, D3), not to that figure. The RPS block adds six neighbour
reads to react for living cells; the measured rates include it.

Per run, 206,000 steps is the burn-in (6,000) plus `T_end` at its longest (200,000). The early stop of rule draft 1.5 makes a run
that loses a label shorter, so every figure in the table is a ceiling.

| stage | runs | steps | per run, M1 Max at 450 (600) | total, M1 Max time at 450 (600) |
|---|---|---|---|---|
| Gate 0, per substrate rung (in the order S0, S1, S2, V, a rung after a GO not run; S2 only after two LEVELS failures) | 12 scan + 24 meter + 42 table (45 cells; the three rate-0 seed-401 cells are the scan jobs) + 3 horizon + 3 confirmation | 2.8 M in all (0.43 M for a rung that fails on levels) | scratch jobs | 1.8 h (1.3 h) for a rung that gets to the end, 1.0 h for one that fails at the table, 0.3 h for one that fails on levels |
| Gate 0, rung V (on the jobs of its substrate rung) | 36 table (the four nonzero rates) + 3 confirmation, and 3 horizon if the substrate rung did not run them | 1.6 M (2.2 M with the horizon jobs) | scratch jobs | 1.0 h (0.7 h) to the end, 1.3 h (1.0 h) with the horizon jobs, 0.6 h (0.4 h) for a V that fails at the table |
| M3a lattice sweep | 4 sizes x 11 `M` x 600 | `N^2` each | 1.4 core-hours at an assumed 30 M events/s, 4.8 at the 9 M reaction steps/s a naive scratch implementation reached (2.9 measures it) | 10 to 40 min on eight workers |
| M3m meter | 8 spreads x 2 stripes | 5,000, inert | 11 s | 3 min |
| M3k calibration | 5 rates x 2 seeds | 26,000 | 58 s (43 s) | 10 min (7 min) |
| M3b sweep, treatment | 8 spreads x 5 seeds = 40 | 206,000 | 7.6 min (5.7) | 5.1 h (3.8 h) |
| M3b controls | 8 x 3 = 24 | 206,000 | 7.6 min (5.7) | 3.1 h (2.3 h) |
| M3b rate arms | 2 x 3 = 6 | 206,000 | 7.6 min (5.7) | 46 min (34 min) |
| M3c longer cycles | 2 x 3 = 6 | 206,000 | 7.6 min (5.7) | 46 min (34 min) |
| M4 arm Z (first) | 5 | 1,006,000 | 37 min (28) | 3.1 h (2.3 h) |
| M4 arms A to W | 5 x 5 = 25 | 1,006,000 | 37 min (28) | 15.5 h (11.6 h) |
| deep volume (conditional) | 3 at 64 x 64 x 32 (twice the cells, half the rate) | 206,000 | 15 min (11) | 46 min (34 min) |

**Total** about 29 hours of M1 Max time at 450 steps/s (22 at 600) for the registered stages with every run at full length, about **12
hours wall (9) on both Macs** from one queue (the M3 Pro counts as 1.5 M1 Maxes: 29 / 2.5), plus the lattice sweep and analysis, plus
Gate 0, which comes first and is not in that figure: 0.8 to 4.5 hours of M1 Max time. The rungs are taken in the order S0, S1, S2, V and
Gate 0 stops at the first GO (D24), so 1.8 h when S0 gives GO (S1 and V are not run), 0.8 h when S0, S1 and S2 all fail on levels, and
4.5 h when S0 and S1 both run to the end without a GO and V runs on S0 (1.75 + 1.75 + 0.96 h). The wall time is less when the two Macs
share the queue of the rung in hand (`--machine-share`), or when S1 runs beside S0 on request (`--plan-all`, D2), which costs S1's jobs
if S0 gives GO. If the deep run is not made, subtract 46 minutes; if arm Z is void or the gate is closed, subtract 15.5 hours (11.6) for arms
A to W; if M4 does not run at all, 18.6 hours (13.9). The early stop only subtracts: a sweep in which most runs lose a label by 30,000
steps costs about a sixth of its line in the table. If Gate 0 stops, only its 0.8 to 4.5 hours are spent (plus 1.5 h if the 256 x 256 x 4
horizon rung is tried, which it is not on S2: three 206,000-step jobs at four times the cost per step, a diagnostic only). Three 26,000-step jobs, the two of the V check of rule
draft G0.1 (one per build) and the dense rate of G0.6, are not in the table. No paid compute.

**Implement phase** (rough, to be re-estimated by whoever takes it): Part B is M0 about 350 lines with tests, M1 about 160 lines of
simulator and 550 of tests, M2 about 140 lines of WGSL and golden worlds, and the drivers about 700 (the two-phase job with burn-in and
early stop included); Part A is the lattice module about 300 lines with 250 of tests (no wavelength tool), and `census-rps.ts` and the
readout about 900 lines with tests (run classes, chirality, the Gate-0 table), with the Gate-0 driver, the V switch in the spike copy
and the companion page not yet estimated. Two to four reviewed commits.

## 10. Risks

- **Scratch evidence against the design as drafted (2026-10-24; not results of this line).** An adversarial review ran a
  shader-text prototype of 4.2 and 4.3 (not bit-checked against a CPU twin; energy residual 0 and matter exact in about 100 runs)
  at the plan's substrate and shape, on seeds 9001 and up. Spread 16, 128 x 128 x 4: the neutral control kept all three labels for
  100,000 steps (smallest share 3.1 % at step 83,000); at rate 32 one label was at 1.0 % at 20,000 steps and one species was left
  from 28,000; at rate 128 one species from 24,000; at rate 512 a label was lost at 3,000. Rate 8 kept all three labels but with
  `chi` (the direction of label change, rule draft 0) near 0, the control's noise. The first draft's screen (spread 16, 20,000
  steps, last five censuses) failed at rate 32 in four of four seeds. The living fraction stays above 98 % from step 4,000: removal
  on this carpet is replacement. Mobility: at 28 quanta per cell the inert-stripe meter gave 0, 0, 0, 0.018, 0.041, 0.039, 0.041,
  0.031 for spread 1, 2, 4, 8, 12, 16, 24, 32; spreads 1, 2 and 4 are sparse frozen films (living 0.23 to 0.31), spread 32 is
  extinct at 3,000 steps, the neutral turnover at spreads 8 to 24 is 0.3 to 0.6 against a "dynamic" bar of 0.02, and the
  z-coherence of the four layers is 0.23 to 0.36 whenever the film mixes. The label correlation length is about 2 cells, and the
  images show noise and then rough single-label domains, no spiral arms. **Registered consequence:** the first rung of Gate 0
  (rule draft 3.0) is expected to fail, and nothing is built for the kernel until a rung has not (8).
- **Gate 0 is a spike, not the kernel.** Its prototype is a text patch of the shipped shader, so a verdict on it transfers only if
  the shipped kernel behaves the same: M2's acceptance includes a spike-agreement run (8), for the kill form of the rung used. The
  spike is committed (`experiments/3d-rps/gate0-spike/`, D16), so the pilot that chose the operating point is reproducible from the
  repository; because it patches the shipped shader text when it runs, it runs only against the tree it was written for, and the
  Gate-0 record names that revision.
- **Rung V is a different rule, not a different substrate.** It is first a switch in the spike (a text patch like the removal kill,
  not bit-checked against a CPU twin until M1 and M2 exist) and, if chosen, a new rule in the kernel (4.3a; M1 and M2 scope, 8). It
  shares its substrate rung's rate-0 jobs because the kill test is never met at rate 0, which the Gate-0 driver checks on one job. Its
  rate grid (a probability per dominant face, 64 to 4,096 in units of 2^-16) is argued from the colonization front, not measured. Its
  chirality bar was set on S0 scratch under removal. The living-fraction thresholds (`carpet` 0.50, `alive` 0.20, calibration 0.50) are
  the draft's, and under removal the scratch film stayed above 98 % living; vacancies lower the living fraction by an amount nobody has
  measured.
- **Expected character, a guess made from the probe's rates and to be compared with the outcome (the scratch runs above bear it
  out).** A boundary cell of a prey domain loses 0.05 to 3 % of its `B` per step per predator face, against growth of about 0.2 %
  per step, and the invader's mass flows into the depleted cell within a few hundred steps. In the carpet the kernel is therefore
  likelier to behave like replacement with a delay than like May-Leonard with persistent vacancies. If so, the lattice's spirals and
  threshold are not expected to transfer, and rows A3, A4, A5, A8, A9, A10 or A11 of the rule draft are likelier than A1.
- **The kernel is not May-Leonard.** Colonization and mobility are the same transport (4.5), so the cliff may be inverted
  or absent, and the lattice's `M_c` has no counterpart. The rules name those outcomes (A2 to A11) instead of hoping for A1.
- **Predators gain only indirectly.** Removal gives a predator a vacancy, detritus and a head start, nothing else. If that
  is too weak to sustain a cycle, the deferred transfer (`rpsYield`) is the next step, and the sweep will show it as A4.
- **Mobility is a staircase.** Integer floors make lateral export switch on between spread 4 and 16 at carpet density, so
  the grid may contain only two or three effective levels (measured: three, above). The meter orders the spreads and Gate 0's
  grid rule keeps only spreads whose index rises by a factor of 1.3 or more, and fails the rung if fewer than five remain.
- **Slow dynamics.** The carpet's colonization front moves 0.003 to 0.007 cells per step (probe): 200,000 steps is 600 to
  1,400 cells of front travel, 20 to 47 traversals of a wavelength of 30. Whether spirals form within the budget is not known;
  the budget is a limit, not a waiting time, "coexists to the end" is not "stable", and the neutral drift of the substrate caps
  the horizon (Gate 0, G0.4).
- **Frozen coexistence and neutral churn.** A frozen mosaic keeps all three labels; turnover separates it from a moving film. It
  does not separate a cyclic film from neutral churn, whose turnover is 16 to 30 times the "dynamic" bar: that is what the
  chirality of rule draft 0 is for.
- **Nutrient coupling.** The carpet is nutrient-limited (`A` about 0.7 per cell, probe); a kill releases `C` that diffuses
  fast (`diffC` 200), so killing feeds the neighbourhood, predators included. The net sign for the cycle is unknown.
- **Fringe predators.** `rpsMin` 4 blocks one-quantum fringes; a smoother mass-weighted kill is a small change if the
  sweep shows fringe artefacts. Not tuned in advance.
- **Literature conventions.** `M` is uncertain by a factor 2, the transition is not sharp, replication is sensitive to size
  and run length (section 1). Two independent scratch implementations of section 6 put the crossing at 3.0 to 3.2 x 10^-4,
  about 1.5 times below the paper's 4.5 x 10^-4 and on the edge of the narrow pass band; the convention of `M` and of a generation are the
  first suspects, and a narrow pass would be reported as such.
- **Mutation is probably a null result, and the test is weak.** Five seeds per arm cannot separate a small effect from
  drift; the null arm exists because random mask drift builds cycles by chance. A mutant is a one-cell lineage and a critical
  branching process in this lottery (scratch: about one expected offspring per step), so most die at once; the mutant supply is
  recorded, and arm Z (no mutation) says whether the unmutated cycle even holds for the horizon. INCONCLUSIVE is a likely honest
  verdict. The immune-clone mechanism (4.4) accounts for half of the type changes at `K` = 5; the others give toothless or
  mutual-pair clones.
- **The mirror is a cache of a genome field inside `MOT`.** Any future code that writes `MOT` for a slab (a lab feed, a
  lesion) must keep it consistent. `validateState` checks it on every entry path, and `MOT` bits 24-31 mean nothing
  without the keys. The test helper `mirrorZ` reads `mot >>> 16` as the z byte and is wrong on a state that carries mirror bits
  (8, M1).
- **Quasi-2D may decouple.** Four layers under a radius-3 kernel are strongly coupled, but columns could still hold
  mixed labels; z-coherence is reported every census. Measured 0.23 to 0.36 in the mixing regime, so no 3D scroll-wave render
  is expected from this substrate.
- **Shared machine.** The M1 Max is often loaded: both reviews measured 307 to 541 steps/s at 128 x 128 x 4 with a census
  every 1,000 steps (the planning rate of 600 was an idle extrapolation), and a heavily loaded day can double a run. Drivers
  resume, so a stopped run costs only its unfinished job.

## 11. Deferred, and what would bring each back

The routing is the consequence column of rule draft 3.0 and 4.4 and nothing else: A6 (frozen coexistence only) goes to the exchange
knob; A4 (label loss throughout), A10 (sparse film), A11 (no detectable predation effect) and A7 (uninformative) go to the
substrate, through Gate 0's rungs first, and then to the options below; A5 (ragged) is the main session's decision by amendment.

- **`B -> B` transfer (`rpsYield`)**: if the sweep ends in A4 at every kill rate, if Gate 0 stops at every rung, or if the lattice
  is run in its replacement form. Needs its own pass (or a delta buffer) and the receiver gather of 4.3. Derive its mean field
  first: that the thresholded, lottery-owned transfer is the neutral Lotka-Volterra equation is a claim of this note that nobody
  has checked.
- **A substrate with persistent vacancies** (less matter per cell): if Gate 0 stops, put through the same table with either kill. The
  scratch runs say that removal in place on a full carpet acts as replacement (4.3, 10); a rule that leaves a vacancy the neighbours
  have to refill is the May-Leonard picture, and the kill that empties the cell is no longer deferred: it is Gate 0's rung V (4.3a),
  built (M1 and M2 scope) only if V is the rung used.
- **An explicit exchange knob** (neighbour label swap at a given rate inside the lottery stage of transport): if the sweep ends in
  A6, or in A5 by the main session's choice. A7 is a substrate question, not an exchange question. It would restore a
  lattice-like mobility axis at the price of a new transport rule and new goldens.
- **A lattice wavelength or correlation-length measurement** (`L` of 500 or more, `epsilon = M N / 2` of about 5 or more, 1,000
  generations or more, the paper's own definition read from the primary source): the first draft's `L` = 200 check could not
  work (rule draft 2.5).
- **Scroll-wave identification as a claim** (phase-singularity filaments, filament length per volume): after a deep run
  shows spirals extend through depth, and only with a pre-stated rule of its own.
- **Lattice runs of 4- and 5-cycles and the freezing threshold**: the module takes `K`; the runs wait for a reason.
- **Extinction-time scaling in the kernel** (two sizes, time proportional to `N`): the only route to a quantitative kernel
  statement; costs about sixteen times the sweep for a doubled side (four times the cells and four times the steps).
- **Runner and bundle integration, lab UI, lineage-inspector replay of RPS mutations** (the replay still replays the 2D operator,
  `packages/lineage/src/genotype.ts:179-195`; the genome decoders need the RPS option before the inspector touches an RPS genome):
  if the line continues past a positive result.

## 12. Review findings and how they were handled

Two reviews of the first draft of this note and of `runs/rps/rule-draft.md`, both of 2026-10-24: a Codex review (Sol 6.1 at High
effort, read-only), triaged by a second agent who re-checked each finding against the code, and an adversarial Claude review
(three lenses: exactness, ecology, hygiene) that ran a scratch GPU prototype of the kill. Neither review ran the code this note
specifies: the prototype is a shader-text reading of 4.2 and 4.3, not bit-checked against a CPU twin, on seeds outside every
reserved block, and the two lattice implementations are scratch too. Their numbers are cited as scratch evidence, none is a
result of this line, and none is quoted as a fact in the rules except as the reason for a threshold. Every finding was checked
against the code or against the review's own logs before it got a verdict: *valid* (applied), *partly* (applied in part, with the
reason), *noted* (no change needed), *n/a*. No finding was found invalid. "Rules" is `runs/rps/rule-draft.md`. The ids are the
reviewers' own, and "A1" occurs twice (triage and adversarial), which the source column tells apart.

| id | source | severity | verdict | action |
|---|---|---|---|---|
| F1 | Codex | P1 | valid | Rules 1.2 rewritten: one list of what never changes (census interval, burn-in, meter, calibration, windows counted back from the last census) and a reduced schedule that halves only `T_end` and `T_end7`; the cliff cutoff is `T_end / 4`; the meter's `t` is the steps run. Plan 9 points at the rules. Checked: `m4-calibrate.ts:41-47` tolerates a short final batch but supplies no census. Which machine's rate drives the rule: settled, the idle M3 Pro's, measured on the spike (D3) |
| F2 | Codex | P1 | valid (the "all six pairs" outcome is overstated: the exposure is the larger sizes at the lowest `M`) | Rules 2.2 and 2.3: add-one error (never 0), strict `D < 0` and `D > 0` in the two lobes, lobes tested per sign change, and the median of an even number of pairs is the mean of the middle two; synthetic tests in the readout |
| F3 | Codex | P1 | valid (`step3d.ts:662-665` clears a lineage at `B` = `P` = 0) | Rules 0: run classes. DC and FC need `coexist` at every census of the final window; a one- or two-census loss at the end is LATE and counts as neither; the A3 and A8 wording no longer says no label was lost |
| F4 | Codex | P1 | valid; confirmed by scratch (a rate-0 control passed all three old criteria with turnover 0.59 against the bar 0.02) | Rules 0 (chirality, CHURN), 3.0 (a rate works only against its paired control), 3.2 (rate 0 on paired seeds, `chi_fw >= 0.2`, control within 0.1), 4.4 (A11, NO DETECTABLE PREDATION EFFECT). The rate grid is Gate 0's and starts at 8 |
| F5 | Codex | P2 | valid | Rules 0 and 4.4: SPARSE class and row A10; A4 needs `n_lost + n_ext >= 3` and is renamed LABEL LOSS THROUGHOUT |
| F6 | Codex | P2 | valid (`dtQ` ranges 0 to 1024 and `step3d.ts:317` multiplies the displacement by it; scratch: 28 per cell became 31, 25, 25, 31 in the layers); the variance bias is real in principle and its size is unmeasured | Rules 3.1: `dtQ` 0, `D_x` and `D_y` reported separately, anisotropy flagged, the output called a mixing index. Plan 4.5 rewritten |
| F7 | Codex | P2 (triage: P3) | valid (`genome3.ts:59-68`; no caller outside tests) | Plan 3 and M0: `genomeFromHex3(hex, { rps: true })`, strict by default; a round-trip test through both hex helpers |
| F8 | Codex | P2 | valid (`world3.ts:65,77-78`; `presets.ts:13-28,464-465`) | Plan 4.4: exact founding formulas (the review prototype's), the full cell index in both modes, `K0` is `InitParams.founders`; `foundingWorld` gets `case "generalist"` and `case "rps-mix"` and a throwing default (a throwing default alone would break `generalist`, which has no case today) |
| F9 | Codex | P3 | valid (reproduced: seed 378360421, step 0, cell 0; `golden.ts:541-543` uses 2^32 - 1 as "every event") | Wording only: "every event but one draw in 2^32" in plan 4.1, 4.4, 5 and rules 7.2; M1 test (j) records the case. No code change |
| CX-U1 | Codex (unverified items) | info | valid | Plan 6 cost recomputed: 1.55 x 10^11 events (1.4 core-hours at 30 M/s) and 3.9 x 10^11 for the contingency (3.6), with the 9 M/s scratch rate beside the assumed one |
| CX-U2 | Codex (unverified items) | info | valid | Plan 10: 600 to 1,400 cells of front travel is 20 to 47 traversals of a wavelength of 30, not "a handful"; plan 4.3: nothing in the rule reserves the depleted site for its attacker, so the predator's gain is indirect |
| CX-U3 | Codex (unverified items) | info | noted | Plan 4.3 and 11: the neutral Lotka-Volterra mean field of the transfer is not derived; derive it before building the transfer |
| CX-U4 | Codex (unverified items) | info | noted | Plan 8 M2: the census share of a run is reported (one snapshot is 2.9 MB); no design change |
| T1 | triage | P3 | valid | Plan 9: the deep run is twice the cells at half the rate, 15 min per run (11 idle), 46 min for three, not 18 |
| T2 | triage | P3 | valid (both reviews measured 307 to 541 and 430 to 540 steps/s) | Plan 9 totals use 450 steps/s with 600 in brackets; rules 1.2 notes that the reduced schedule is not a hypothetical |
| T3 | triage | info | supported | Rules 2.6: a registered expectation (`M_c` of 3.0 to 3.2 x 10^-4 puts row 1 against row 2 on noise); `L` = 100 stays a contingency (D9; its cost in plan 6) |
| A1 (triage) | triage | info | confirmed | None. Race-freedom, bounds, the `bdecay` caveat, config bytes, RND slots, the transport table and the sizing were re-verified |
| note-review-dir | triage | P3 | n/a | Untouched. This revision writes only under `runs/rps/revision/` |
| B1 | adversarial | P1 | valid, as a prediction from scratch evidence (the logs in `runs/rps/review/proto/out/` agree with the notes; the prototype is not bit-checked) | Gate 0 added (rules 3.0): numeric go/no-go, ordered rungs, pilot seeds. Its criteria differ from the review's single 100,000-step screen: a 20,000-step table against paired controls, a horizon run and a confirmation run at the horizon, to keep a rung near two hours. Plan 8 puts it first; plan 10 and rules 3.0 register that rung S0 is expected to fail. A Gate-0 number is a pilot number. Its position is settled: before M0, on the spike (D1) |
| B2 | adversarial | P2 | valid | Chirality; DC needs `chi_fw >= 0.2`; the CHURN class; control seeds paired with treatment seeds (211 to 213; 201 and 202); `informative(v)` needs the controls' median chirality within 0.1 |
| B3 | adversarial | P2 | valid, extrapolated (not run to 200,000) | Rules 3.0 G0.4 sets `h0` from the control's own loss time; the grid keeps carpets only (spreads 1 to 4 are sparse and 32 is extinct in the scratch runs; 6, 10 and 20 are candidates); the cliff cutoff is `T_end / 4`. Not applied: a run-by-run survival comparison of `T_cx`; `informative(v)` stays (the controls must hold) and the chirality contrast carries the treatment-against-control comparison |
| B4 | adversarial | P2 | valid | Rules 3.0 grid rule (index rises by 1.3, at least 5 levels) and the 3.1 ordering check (exit code 3); plan 4.5 documents the staircase |
| C1 | adversarial | P2 | valid | Rules 0: `T_cx` of an EXT job is its stop step; classes EXT, SPARSE, LOSS, LATE; the per-spread counts add up |
| C2 | adversarial | P2 | valid (rate 128 was 37, 24, 79 % living at censuses 1 to 3) | A burn-in of 6,000 steps with no kill and no mutation; the clocks start after it; a control and its treatment are one trajectory through it. Kept over founding the carpet directly (D5) |
| C3 | adversarial | P2 | partly (the 4 to 11 % false-GROWS figures come from an assumed null, not a measurement) | Rules 7: arm Z first and HORIZON-VOID; `T_end7` = 5 `T_end`, capped; GROWS needs 4 against 0, 5 against 0 or 5 against 1 (exact Fisher at 0.05) and a mutant supply; the W prediction depends on Z. Not applied: restart on fixation or immigration (it changes the model; arm Z makes the consequence visible instead). Seeds per arm: five (D12) |
| C4 | adversarial | P2 | partly | Applied: the even-`V` median, per-crossing lobes, the wavelength check dropped (it made LAT-PASS unreachable). Not applied: moving the pass band after a scratch result; a registered expectation instead. The band stands as drafted (D8) and `L` = 100 stays a contingency (D9) |
| C5 | adversarial | P2 | valid | Gate 0 before M0 (settled, D1); the freeze may take only what Gate 0's fixed rule sets, plus the reduced schedule (plan 8) |
| B5 | adversarial | P3 | valid | Rules 6.1 uses the correlation length (at least 6 cells) and drops the z-coherence condition of 0.9; plan 4.6 and 10 say no 3D scroll-wave render is expected |
| C6 | adversarial | P3 | valid | Rules 1.5: sections 3 to 6 stop at the census that completes a sustained loss, section 7 by 7.2a; plan 9 gives its table as a ceiling |
| C7 | adversarial | P3 | valid (six items) | (i) lobes per crossing, rules 2.3; (ii) `T_end / 4` as a formula; (iii) paired control seeds; (iv) one routing, plan 11 and rules 4.4; (v) the dependency note in Appendix C; (vi) the spread-32 fallback removed |
| C8 | adversarial | P3 | valid (enumerated: at `K` = 5 the three cases are 25, 25 and 50 %) | Plan 4.4 and rules 7.6 restated as the mixture; M1 test (f) counts the three classes. The operator is unchanged and stays so (D11) |
| A1 (adversarial) | adversarial | P3 | valid | Plan 8 M2: a seventh golden case `slab-rps-bigb` (the high word of `mul_frac` at the largest rate, `B` = 0 with `P` > 0, cells that clear), `tests/deno/gpu_rps_inert.ts`, and the `mirrorZ` mask (checked: `step3d-helpers.ts:71-72` reads `mot >>> 16`) |
| A2 (adversarial) | adversarial | P3 | valid | Plan 3 and `rules.md`: predation is measurable from the census only; the genome decoders and the lineage inspector need the option (plan 3, 11); the `rpsFlip` wording as F9 |
| A0 | adversarial | P3 | informational | None. Agrees with Codex's "checked and correct" list |

**Decisions of the main session, 2026-10-24.** Every item the rule draft had left open is settled, and one rung is added to Gate 0.
The decisions are applied to the rule draft (`runs/rps/rule-draft.md`, which carries the same ids) and to this note; the rows above
point here for the ones they mention.

| id | decision | where it landed |
|---|---|---|
| D1 | Gate 0 runs before M0, on the spike (the earlier option a). Part B (M0 to M2 and the kernel drivers) is built only after Gate 0 gives GO for some rung. (Gate 0 itself runs after the freeze of `RULES.md`: D28.) | plan 0 (rows 7, 10), 8, 10; rules 3.0 (Code), Appendix C |
| D2 | Rungs S0 and S1 as written; their Gate-0 jobs may run in parallel on the two Macs. S2 is run only if both S0 and S1 end NO-GO: LEVELS. When more than one rung gives GO, the rung used is the first in the order S0, S1, S2, V (one departure from the plan at a time). (Amended by D24: the rungs are taken in that order and Gate 0 stops at the first GO; running S1 beside S0 is now the explicit `--plan-all`.) | rules 3.0 (Procedure, G0.1, verdict table); plan 0, 9 |
| D3 | The reduced schedule (rules 1.2) is keyed to the idle M3 Pro's dense rate, measured on the spike during Gate 0. | rules 1.2, 3.0 (G0.6), 8.5; plan 8 (M2), 9 |
| D4 | Kernel shape 128 x 128 x 4; 256 x 256 x 4 only as Gate 0's horizon rung. | rules 1.1, 3.0 |
| D5 | The 6,000-step burn-in (predation and mutation off), as drafted. | rules 0, 1.3 |
| D6 | Lattice: the negative lobe is kept (strict `D < 0` and `D > 0`, per crossing). | rules 2.3 |
| D7 | Lattice wavelength: dropped from v1 (no measurement and no reported number); the live canvas shows it qualitatively. | rules 2.5; plan 6 |
| D8 | LAT-PASS band [3e-4, 6e-4] and LAT-CAVEAT band [2.25e-4, 9e-4] as drafted, with the registered expectation of 3.0 to 3.2e-4. | rules 2.6 |
| D9 | `L` = 100 stays a contingency only. | rules 2.7; plan 6 |
| D10 | Mutation rate as drafted: `mutRate` 42,950 at S0, divided by the matter scale at other rungs. | rules 7.2 |
| D11 | The type-change operator as built, with the restated arm B prediction. | rules 7.6; plan 4.4 |
| D12 | Five seeds per arm, arm Z first; GROWS only on 4-0, 5-0 or 5-1 (one exact Fisher test at 0.05). | rules 7.2, 7.5 to 7.7 |
| D13 | Every threshold taken from scratch data (chirality 0.2 and 0.1, 5 levels, the ratio 1.3, correlation length 6, mutant supply 64 cells, the 6,000-step burn-in) is accepted as written and frozen with the rules; Gate 0 may not move any of them. | rules header, 0, 3.0 |
| D14 | New rung V, the vacancy kill: the substrate of the first of S0, S1, S2 to pass row 1, whose scan, meter, horizon and rate-0 jobs it shares; its own rate grid {0, 64, 256, 1024, 4096}; a cell is emptied as the 2D injury rule empties it; `R_cal` capped at 16,384; if V is used, M1 and M2 implement it instead of removal through a kill-form key, and removal stays the documented alternative. | rules 3.0 (G0.1 and the tables), 4.1, 8.4, 8.5, Appendices A to C; plan 0, 2.2, 3, 4.1, 4.3a, 4.7, 5, 7.3, 8, 9, 10, 11 |
| D15 | M5a moves into Part A: the companion page with the live 2D lattice canvas (a type-stripped copy of the lattice module, hash-tested against the TypeScript source), and the kernel result slots present and labelled "not yet run" rather than hidden. | plan 3, 8 (M5, Order and parallel work); rules Appendix C |
| D16 | The Gate-0 spike is committed: `runs/rps/review/proto` is copied to `experiments/3d-rps/gate0-spike/` (the copy, never the original, gets the V switch and the driver), its SHA-256 goes in the Gate-0 record, and nothing in `packages/` imports it. (What the copy holds: D29.) | rules 3.0 (Code), 8.5; plan 3, 8, 10 |

The thresholds taken from scratch data are no longer proposals: D13 freezes them with the rules, and their bracketed reasons stay as
the reasons.

**Decisions of the main session after the review of Part A, 2026-10-24.** A conformance review, a Codex review and a spike check of the
code of Part A found nothing that moved a threshold or a row; they left nine open readings (O-1 to O-9) and asked for approval of eight
clarifying text changes (T-1 to T-5, PT-1 to PT-3). The main session ruled on all of them and on the order of the freeze. The decisions are
applied to the rule draft (which carries the same ids), to this note and to the code of Part A, each with a test where it changes
behaviour.

| id | decision | where it landed |
|---|---|---|
| D17 | (O-1) The horizon rung (256 x 256 x 4, G0.4 alone) is tried when every rung that passed rows 1 and 2 failed at row 3 (HORIZON), at the first such rung in the order S0, S1, S2, V. A rung that failed at row 1 or 2 counts neither way; a rung that failed at row 4 puts the horizon rung out. | rules 3.0 (verdict row 3, GATE-0-STOP); `readout-gate0.ts`; tests "3.0 (O-1) ..." |
| D18 | (O-2) `spread*` needs `v` itself to be informative. | rules 4.6; `readout-kernel.ts` (`spreadStar`); tests, oracle |
| D19 | (O-3) Medians are the mean of the two middle values, except the lower middle for `Tmed`, `v_mid`, `v_cal` and `T_ctl`. | rules 0 (Median), G0.4; tests ("ratified readings") |
| D20 | (O-4) Census readings ratified as sentences of rule 0: the `P0` of `xi` is that of the layer; `g(r)` is 0 at a lag with no pair of living cells; lags are periodic; the 200-change floor counts `n_dom + n_anti` only; `burnHash` is compared within one seed and one burn-in config. | rules 0, 8.4, B.3 |
| D21 | (O-5) A NOSTART job stops at the hand-over census: `stop` is `nostart`, at run step 0, and no run simulator is built. | rules 0, 1.5, B.3; `lib/kernel-job.ts` (`nostartStop`), `readout-jobs.ts` (`isNoStart`); tests |
| D22 | (O-6) The strict reading of 1.3 stands (T-2): a conservation or invariant failure of an earlier attempt stops the stage even if the rerun passes. | rules 1.3, 8.4; code unchanged |
| D23 | (O-7) An absent or incomplete V check voids V as files that differ do (T-3). | rules 3.0 (G0.1), 8.4; code unchanged |
| D24 | (O-8) Gate 0 takes the rungs in the order S0, S1, S2, V and stops when the highest-preference rung not yet excluded gives GO; later rungs are not run. The readout's overall verdict stays pending until then (or until every rung is excluded), a GO behind a pending rung is printed as provisional, and a rung after a GO is reported as not run. The driver queues the jobs in that order, one rung at a time, by default; the side-by-side mode is the explicit `--plan-all`. | rules 3.0 (Procedure, verdict table), Appendix C; plan 0, 8, 9; `readout-gate0.ts`, `readout.ts`, `gate0-spike/plan.ts`, `driver.ts`, `cli.ts`; tests |
| D25 | (O-9) The sentence for `docs/rules.md` ("The RPS pass": the emptying acts before the reactions and the passive block, so the abiotic step sees the victim's `B` + `P`; `A` and `S` of the victim are untouched) belongs to Part B; no action now. | Part B (M1) |
| D26 | T-1 to T-5 (rules 0 chirality, 1.3, G0.1 V check, 8.4, B.3) and PT-1 to PT-3 (plan 6 Visual, 3 and 8, 9) approved as made. | rules and plan as listed |
| D27 | The decision agent's readings ratified: the emptied cell's `MOT` is the at-rest word `MOT_ZERO3` with mirror bits 0; an emptying books no flux (heat total only, as the 2D lesion path); `rpsRate` ranges 0 to 10,922 under removal and 0 to 16,384 under vacancy, `R_cal` of V is capped at min(16,384, 4 `kappa_w`); there is no `B > 0` guard for V; V's rows start once the host rung passes row 1; G0.6 (seed 404, the idle M3 Pro's dense rate) runs before Part B's registered runs and not before Gate 0's verdict, because the work Mac is not reachable now; the D16 hash recipe with `git ls-files`; D4 as read. | rules 3.0 (G0.1, G0.6, Procedure), 8.5; plan 4.3a |
| D28 | Sequencing: `RULES.md` is frozen before Gate 0 and the lattice sweep. The Gate-0 record `GATE0-RECORD.md` is written at the final GO (or GATE-0-STOP) and its SHA-256 is appended to `FROZEN` in a dated line before any Part B registered run. `RULES.md` never changes after the freeze except by dated amendment. | rules header, 3.0, 8.3, 8.5, Appendix C; plan header, 0 (rows 7, 10), 3, 8 (Freeze, Order), 9; `gate0.ts` (`--gate0` refuses before the freeze), `frozen.ts`, `readout.ts` |
| D29 | The committed spike holds only what Gate 0 uses: the review's scratch scripts (`proto.ts`, `proto2.ts`, `meter.ts`, `batch*.sh`, `chain*.sh`, `sheet.py`) are not carried over and no `out/` or snapshot is ever added. Its SHA-256 is recomputed by the D16 recipe over the exact sorted list of the files kept, and the list is written beside the hash. | rules 3.0 (Code); plan 8; `gate0-spike/README.md`, `gate0-spike.sha256`; tests |
| D30 | `experiments/3d-rps/RULES.md` and `FROZEN` are written by the main session at the freeze; the code of Part A creates neither. | rules header; plan 8 (Freeze) |

**Final review of Part A, 2026-10-24.** A last Codex review (Sol 6.1 at High effort, read-only) of Part A after D17 to D30, triaged by a
second agent who re-checked each finding against the code: the rules text was not yet ready to freeze (four findings would have to change it
first) and the code was sound with fixes. All ten findings hold in substance; the triage added three of its own (FR11 to FR13). The fixes
are applied to the rule draft, to this note and to the code, each with a test; the rule-draft sentence each one changed is listed in
`runs/rps/review-final/fix-table.md`. Where the triage left a choice, the choice made is in the action column and can be overridden before
the freeze.

| id | severity | verdict | action |
|---|---|---|---|
| FR1 | P1 (triage: P2) | valid | A rerun that passes but loses the publish race no longer erases its earlier conservation or invariant failure: the failures go to a hidden `.retried-<id>-<pid>-<n>.json` beside the jobs, the harness throws StageStop, the readout lists the file as a bug indicator (exit 3) and the driver stays stopped on it; the published job is not replaced. Both job kinds. Rules 1.3; `lib/kernel-job.ts` (`retainLostRace`), `gate0-spike/jobs.ts`, `driver.ts`, `readout.ts` |
| FR2 | P1 | valid | The registered readouts (meter, calibration, sweep, cycles, deep, mutation) need the hashed Gate-0 record and refuse a `--op` file that differs from it in any field the record holds; `kappaStar`, which only the calibration gives, is the one addition. Rules 8.5; `readout.ts` (`operatingPointDiffs`) |
| FR3 | P1 | valid | The window mean of the turnover is exact: each turnover is recovered as the quotient of two cell counts, the quotients are summed as rationals and compared with 1/50, so a mean of exactly 0.02 is dynamic; no tolerance, no change to `census.tsv`. A value that is no such quotient is unusable input where the class needs it. Rules 0 (Turnover); `readout-jobs.ts` (`turnoverRatio`, `windowTurnover`); the oracle sums integers |
| FR4 | P2 | valid, freeze-blocking | The record sequence can be followed: the Gate-0 table and the lattice need `RULES.md` only, an unhashed record is provisional and G0.6 completes it before its hash is taken, the registered Part B readouts need the hash, and Part B may be built after the final GO and runs only after the hash. Rules header, 3.0 (row 5), 8.5, Appendix C; plan 0 (row 7), 8 (Freeze, Order); `readout.ts` |
| FR5 | P2 | valid, freeze-blocking | The horizon rung is diagnostic only: Gate 0 stays GATE-0-STOP whatever its G0.4 jobs say, the readout exits 0, a continuation is a dated amendment, and the shape is no longer among the things Gate 0 sets. Rules header, 1.1, 3.0; `readout-gate0.ts`, `readout.ts` |
| FR6 | P2 | valid, freeze-blocking | The horizon rung is not run on S2, nor on V when V ran on S2: its founding at 256 x 256 x 4 is over the kernel's total-matter bound for seeds 401 and 403 (also 404 and 405). The harness checks the founding's bounds before any step and treats a breach as an invariant failure; the founding totals of every rung, shape and seed 401 to 405 are pinned. Rules 3.0; `lib/kernel-job.ts` (`foundingProblems`), `readout-gate0.ts` |
| FR7 | P2 | valid, freeze-blocking | `mutRate` at matter scale `s` is `floor(S0 value / s)`, W included, and the readout accepts exactly that integer. Rules 7.2, 8.4; `readout-mutation.ts` (`armMutRate`, `mutRateOk`) |
| FR8 | P2 (triage: P3) | valid | Rules 7.6 agrees with 7.4 and the code: arm Z's section is void only by the horizon check, B needs LOOSE strictly more frequent than every other class, C's "not GROWS" includes STABLE. Tests for Z with five LOOSE runs, C with five THREE runs and the B tie |
| FR9 | P2 (triage: P3) | partly | The gap is real, but 0 would class a film in which no cell persists as frozen. The turnover is undefined when no cell lives at both censuses; the readout stops with code 3 where the class needs it (FC, CHURN, DC), and SPARSE and LATE, which do not, are decided as before (an empty field used to stop them with code 2). Rules 0; `readout-jobs.ts`; end-to-end tests through the harness |
| FR10 | P2 | valid | G0.6 counts only as the dense case it names, a rate-0 carpet that ran its 20 run censuses; a NOSTART, early-stopped or sparse job leaves `denseRate` null and the Gate-0 readout exits 3 (a repeat measurement is a dated amendment). Rules G0.6; `readout-gate0.ts` |
| FR11 | P3 (triage) | valid | Rules 8.4 states the precedence of the exit codes (2, then 3, then 4), which the readout already applied |
| FR12 | P3 (triage) | not applied | A V whose host ended HORIZON shares the host's horizon jobs and can only end in EFFECT or HORIZON; its 36 table jobs and check (about 1 h of M1 Max time) cannot change the answer. Optional, no effect on a result, and a logic change to the verdict loop that the freeze should not wait for |
| FR13 | P3 (triage) | valid | A MISSING meter job of a carpet spread leaves its spread without `D_lab`: exit 3 naming the marker, instead of an exit 4 that no driver can clear. Rules G0.2; `readout-gate0.ts` |

**Verification round, 2026-10-24.** A Codex pass (Sol 6.1 at High effort) over the fixes above found two of them incomplete and two
rule sentences to tighten; all four are fixed, each code fix with a regression test.

| id | severity | finding | action |
|---|---|---|---|
| FR1a | P2 | FR1 incomplete: a job that failed twice with a conservation or invariant failure, while another process published a clean job first, stopped only the current invocation | `publishMissing` writes its MISSING marker (failures, partial census) to a hidden `.retried-<id>-<pid>-<n>.json` before it throws StageStop, which names the file; the driver's next run stops on it and the readout lists it as a bug indicator (exit 3) with its own wording. `lib/kernel-job.ts`, `gate0-spike/driver.ts` (log line), `readout.ts`; tests in rps-kernel-job and rps-gate0-driver (a fresh invocation stops) |
| FR10a | P2 | FR10 incomplete: a LOSS completing at census 20, and a carpet at a nonzero rate, were taken as the dense rate | G0.6 also requires rate 0 and excludes NOSTART, EXT, LOSS and SPARSE by class, not only through the census count. `readout-gate0.ts`; both regressions in rps-readout |
| FR14 | P3 | the freeze order asked for the record to be completed with G0.6 also after GATE-0-STOP, where 8.5 makes it not applicable | Rules Appendix C (order): completed with the dense rate only after a GO |
| FR15 | P3 | rules 1.3 promised the hidden file for any lost race, also after a plain crash, which the code deliberately leaves to the log | Rules 1.3: the hidden file holds a conservation or invariant failure, behind a rerun that passed or a MISSING marker |

Results and amendments are appended below as dated sections.
