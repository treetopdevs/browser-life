# Pre-stated rules: cyclic competition on the slab (FROZEN 2026-10-24; decisions D1 to D30 applied)

**Status: frozen 2026-10-24** (SHA-256 in `experiments/3d-rps/FROZEN`; every later change is a dated amendment at the end of this file). Written with `docs/3d-cyclic-rps-plan-2026-10-23.md` ("the plan"; "plan N" is its section N). Nothing
here has been run. This revision answers two reviews (the last section of the plan lists every finding and what was done with it)
and then applies the main session's decisions of 2026-10-24, D1 to D16, which settle every item the reviews left open and add rung V
to Gate 0 (3.0), and a second round after the review of Part A, D17 to D30; the plan's section 12 lists each decision and where it
landed. The text was corrected afterwards where a final Codex review of Part A found it wrong or ambiguous (plan 12, FR1 to FR15).

**The order of the freeze (D28).** The main session copies this file to `experiments/3d-rps/RULES.md` and records its SHA-256 in
`experiments/3d-rps/FROZEN` (the convention of `experiments/FROZEN`) **before Gate 0 and before the lattice sweep**: both are registered
runs. The Gate-0 record `experiments/3d-rps/GATE0-RECORD.md` (8.5) is written at the final GO (or GATE-0-STOP). Its dense rate may be
entered later (G0.6), and its SHA-256 is appended to FROZEN in a dated line once it is complete. Part B (plan 8) may be built after the
final GO; its registered runs start only after the completed record is hashed into FROZEN. RULES.md itself never changes after the freeze
except by a dated amendment (8.3). The Gate-0 and lattice readouts require the recorded hash of RULES.md; an existing, unhashed Gate-0
record remains provisional and may be completed with G0.6, while every registered Part B readout (3.1, 3.2 and 4 to 7) requires the
record's current hash in FROZEN. `gate0.ts --gate0` and the registered lattice sweep refuse to start before the freeze. A run made under
an earlier version of the rules is reported under that version.

**What Gate 0 may set, and what it may not.** The Gate 0 pilot (3.0) runs after the freeze and sets the kernel's operating point, which
is not part of this file: the substrate rung (S0, S1, S2, or V, the vacancy kill, which keeps the substrate of the rung it runs on), the
spread grid `G_spread`, the calibration spread `v_cal`, the rate grid `R_cal` and the horizon `h0`, each by the fixed rule of
3.0 and from pilot seeds only (Appendix A); the setting goes in the Gate-0 record. The kernel shape is not among them: it is 128 x 128 x 4
(1.1), and the 256 x 256 x 4 horizon rung of 3.0 is diagnostic only. The step budgets marked **[budget]** may take the
reduced schedule of 1.2, on the one rate measured in G0.6. Nothing else moves on evidence. Every threshold taken from scratch data is
accepted as written and frozen with these rules, and Gate 0 may not move any of them (D13): the chirality bars 0.2 and 0.1, the 5
levels, the ratio 1.3, the correlation length of 6 cells, the mutant supply of 64 cells and the burn-in of 6,000 steps. A pilot is not a
result: its numbers go in the Gate-0 record, whose hash is recorded beside this file's. If Gate 0 ends in GATE-0-STOP, the main session
strikes sections 3.1 to 7 and their appendix rows by a dated amendment (8.3), and what remains (sections 0 to 2, 3.0, 8 and the
appendices) is the registered programme: the lattice reference is then the whole of it.

**How the rules are applied.** Every statement below is computed by `experiments/3d-rps/readout.ts` from the per-job files
(Appendix B); nobody reads a plot and decides. The readout has a synthetic-data test for every row of every outcome table.
A situation no row covers is a stop: the readout exits with code 3 and the main session writes an amendment before anything
continues. Values in [brackets] are given with their reason; after the decisions of 2026-10-24 they are fixed, except the ones 3.0 lets Gate 0 set.

## 0. Definitions

Used by every rule below.

- **Burn-in, job step, run step.** Every kernel job starts with a *burn-in* of `B_in` = 6,000 steps with `rpsRate` 0 and `mutRate` 0
  (everything else the job's own), then runs with its own settings (1.3). A job and a control of the same seed are one trajectory
  until the end of the burn-in. The readout compares the `burnHash` values of the jobs of one seed and one burn-in configuration (the
  kill form is not part of the configuration: the removal build and the vacancy build of a seed share a burn-in) and exits with code 3
  if any two of them differ (D20). The *run
  step* is the job step minus `B_in`; every window, every `T_*` and every census number below counts run steps. [The kill crashes a
  young film (scratch: 37 % living at the first census at rate 128), so the clocks start once the carpet exists.]
- **Census.** Every 1,000 steps, from `GpuSim3.readSnapshot()` (cells and the genome head). *Run censuses* are those at run steps
  1,000, 2,000, ...; the burn-in's censuses (job steps 1,000 to `B_in`) are recorded, and used only for the NOSTART test and as the
  "previous census" of the first run census.
- **Living, label, fraction.** A cell is living iff its two lineage words are not both 0. Its *label* is the type byte
  (PARAM1 byte 1) of its lineage. `liv(c)` = living cells / all cells at census `c`.
- **Present.** The share of label `x` is (living cells of label `x`) / (living cells). `x` is *present* iff its share is at
  least `s0 = 0.02` [2 %: about 1,000 to 1,300 living cells at 128 x 128 x 4; a label below it is a few censuses from extinction at
  the turnovers expected, and above it the count is statistically solid]. `S_c` is the set of present labels, `n_c = |S_c|`.
- **Coexist.** `F` is the set of founding labels, `{0, ..., K0 - 1}`. `coexist(c)` iff `F` is a subset of `S_c`.
- **Turnover.** Among cells living at both census `c - 1` and `c`, the fraction whose label changed. If no cell is living at both, the
  turnover of census `c` is undefined: a run whose class needs it (FC, CHURN or DC, below) then stops the readout with code 3 (a
  situation no row covers), while SPARSE and LATE, which do not need it, are decided as usual. A run's turnover over a window is the
  exact mean over the window's censuses (the census file holds each turnover as the quotient of two cell counts and the readout recovers
  the counts, so a mean of exactly 0.02 is dynamic and floating-point rounding decides nothing).
- **Median.** The median of an even number of values is the mean of the two middle values, except the lower middle for `Tmed` (4.2),
  `v_mid` and `v_cal` (G0.3) and `T_ctl` (G0.4), whose controls that keep every label count as infinite (D19). The medians that follow
  the general convention: `M_c` (2.3), `B_meter` (G0.2), the controls' `|chi_fw|` (G0.3, 4.2), the `xi` of 6.1 and the supply `u_C` of
  7.5.
- **Chirality** (jobs with `mutRate` 0, whose masks never change: label `y` kills label `x` iff `x = (y + 1) mod K0`). Among the cells
  counted in the turnover, `n_dom(c)` is the number whose label changed from `x` to `y` with `y` killing `x` (a victim's cell taken
  over by its predator's label) and `n_anti(c)` the number that changed from `x` to `y` with `x` killing `y`; changes between labels
  with no kill relation (possible for `K0` of 4 or more) count in neither. Over a set of censuses
  `chi = (sum n_dom - sum n_anti) / (sum n_dom + sum n_anti)`, and 0 when `sum n_dom + sum n_anti` is below 200: the floor counts these
  changes only, not the changes between labels with no kill relation (D20). `chi_fw` is `chi`
  over the final window (0 for a job that stopped before it had one); `chi_all` is `chi` over every run census up to the last one
  before a sustained loss (all of them if there is none; a sustained loss that completes at an EXT census is one too, and its three censuses are left out). [Neutral label churn is symmetric, `chi` near 0. A kill lowers the victim's `B`, which hands its cell to a predator's
  label: `chi > 0`. Scratch at the plan substrate, 128 x 128 x 4, spread 16: controls -0.04 to +0.06, rate 32 0.24 to 0.28, rate 128
  0.47 to 0.8. 0.2 and 0.1 are the thresholds used below, frozen as written (D13); they were set on S0 scratch under removal and are
  not calibrated for rung V (3.0), where a kill empties the cell and the refill comes mostly from the predator side of a front, so
  positive chirality is still expected.]
- **Dynamic.** A run is *dynamic* iff its turnover over its final window is at least 0.02 [a label field that changes by less than
  2 % per 1,000 steps is a mosaic, not a spiral]. Dynamic alone does not mean cyclic: the neutral control's turnover is 0.3 to 0.6
  (scratch). The cyclic signature is `chi_fw >= 0.2`.
- **Sustained loss.** `coexist` false at three consecutive run censuses. `T_cx` is the run step of the first of the three, or
  CENSORED if there is none by the end of the run. [Three, so that a one-census dip does not end a run.]
- **Extinct, alive.** `liv(c) < 0.01` at any run census stops the job and classes it EXT. A run is *alive* iff `liv(c) >= 0.20` at all
  censuses of its final window [below that the world is not a carpet].
- **Run class** (sections 3 to 6; the first row that holds; every job has exactly one):

| class | condition | `T_cx` |
|---|---|---|
| NOSTART | at the last burn-in census `liv < 0.50` or `coexist` false, or `liv < 0.01` at any burn-in census | none: the job is excluded from every count and listed; it stops at the hand-over census (1.5) |
| EXT | `liv(c) < 0.01` at some run census | the stop step |
| LOSS | a sustained loss | the first census of the loss |
| SPARSE | not alive | CENSORED |
| LATE | `coexist` false at some census of the final window (a dip of one or two censuses at the end) | CENSORED |
| FC | not dynamic (*frozen coexistence*) | CENSORED |
| CHURN | dynamic and `chi_fw < 0.2` (coexisting and turning over, with no cyclic signature) | CENSORED |
| DC | dynamic and `chi_fw >= 0.2` (*dynamic coexistence*) | CENSORED |

- **Modal mask, dominance graph, clean cycle.** For `x` in `S_c`, the modal mask is the beats-mask held by most living
  cells of label `x` (ties to the smaller value). The graph `G_c` on `S_c` has an edge `x -> y` iff `x != y` and bit `y` of
  `x`'s modal mask is set. A *clean cycle* at `c` is: `n_c >= 3`, `G_c` has a directed cycle through every label of `S_c`
  (a Hamiltonian cycle; chords allowed), and `G_c` has no pair with both `x -> y` and `y -> x`. `Y_c = n_c` if a clean cycle
  exists, else 0.
- **z-coherence.** Among columns with at least one living cell, the fraction whose living cells all carry one label.
  Reported, never a criterion.
- **Correlation length.** For a snapshot and a layer, `P(r)` is the fraction of pairs of living cells `r` apart along x (and,
  separately, along y) that carry the same label, `P0` is the sum of the squared label shares of that layer's living cells, and
  `g(r) = (P(r) - P0) / (1 - P0)` (0 when `P0` = 1, and 0 at a lag with no pair of living cells). Lags are periodic (the lattice wraps
  in x and y). `xi` is the smallest integer `r` in 1..32 with `g(r) < 1/e`, 33 if there is none, averaged over the two axes and the
  layers (a layer with no living cell has no value and is left out of the average) (D20). [Scratch: `g` at lags 1, 2, 4, 8, 16 is 0.45,
  0.30, 0.20, 0.12, 0.05 in the neutral carpet, `xi` = 2: the noise scale.]
- **Windows.** The *final window* is the last 20 run censuses of a run in sections 3 to 6 and the last 50 in section 7.

## 1. Settings fixed before any run

1.1 **Kernel runs** use the preset `slab-rps` and the values of plan 7.1, with the substrate of the Gate-0 record (rung S0 of 3.0
unless Gate 0 chose another; rung V has the substrate of the rung it was run on): 128 x 128 x 4, `kernelRadius` 3, uniform light 40 + 200,
`lightK` 16384, `defaultMu` 50,
`defaultSigma` 12, `rpsTypes` 3, `rpsMin` 4 (16 at rung S1, 32 at S2), `mutRate` 0, every other key default, founding `rps-mix` with
`K0` 3, `occupied` 75, `columns` true, `nutrient` 20, `biomass` 16 (the rung's values otherwise). The kill is removal (plan 4.3),
except at rung V, where it is the vacancy kill (plan 4.3a). Each job below lists what it
changes. The shape is 128 x 128 x 4 (D4) [the smallest that holds about four wavelengths of a spiral of wavelength 30;
the M4 shape (256 x 256 x 8) is about eight times dearer per step]; 256 x 256 x 4 appears only as Gate 0's horizon rung (3.0), which is
diagnostic only.

1.2 **Step budgets and the reduced schedule [budget].** Fixed in every schedule: the census interval (1,000 steps), the burn-in
(6,000), the meter (5,000 steps), the calibration (20,000) and every window (counted in censuses back from a run's last census).
`T_end` (sections 4 to 6) is the Gate-0 horizon `h0`, at most 200,000; `T_end7` (section 7) is `5 T_end`, at most 1,000,000. They are
budgets, not waiting times: the literature's `t = N` generations is about 3.7 x 10^7 steps here (plan 1). **Reduced schedule:**
if the dense rate of the M3 Pro (idle, as in the rung 1b M3 gate), measured on the spike during Gate 0 (G0.6), is below 600 steps/s, two
thirds of the planning rate of plan 9, `T_end` is `min(h0, 100,000)` and `T_end7` is `5 T_end`, so both budgets halve at most; nothing
else changes, and every other length below (`T_end / 4`, the windows) is a function of these. The rule is keyed to the M3 Pro's rate
(D3) [the M1 Max is shared and often loaded (scratch: 307 to 541 steps/s at 128 x 128 x 4 on a loaded M1 Max), so keying the rule to it
would probably fire it].

1.3 **Burn-in and failed jobs.** Every kernel job starts with the burn-in of section 0 (6,000 steps, `rpsRate` 0, `mutRate` 0) and
then switches to its own settings by creating a new simulator from the state read back at the end of the burn-in (the rule
constants are in the shader text). Controls do the same, so a control and its treatment differ only by the constant.
The burn-in stays as drafted (D5), rather than founding the carpet directly (all columns occupied) [the burn-in
costs 6,000 steps per job (3 % of a 200,000-step run) and makes a control and its treatment one trajectory until the switch].
A job that crashes, or stops because the matter or energy check failed, is rerun once from step 0 with the same seed. A second
failure marks the job MISSING. A nonzero energy residual or a matter change at any census is a bug, not a result: the whole stage
stops and is reported. This holds whether or not the rerun passes (D22): the failures of an earlier attempt stay in the job's
`summary.json` (`retried`), the readout lists a conservation or invariant failure there as a bug indicator (8.4), and the Gate-0 driver
stops the stage on it; a crash alone is only recorded. If another process has published the job first, a conservation or invariant
failure behind a rerun that passed, or behind a MISSING marker, stays in a hidden file `.retried-<id>-*.json` beside the jobs, which the
readout and the driver treat in the same way and which does not replace the job that was published.

1.4 **Every job** writes its full config (both phases), seed, host, GPU description, steps per second, residual, `burnHash` and
`census.tsv`.

1.5 **Early stop.** Jobs of sections 3 to 6 (`mutRate` 0) stop at the census that completes a sustained loss (class LOSS), at an
EXT census, and, for a job whose burn-in ends in NOSTART (section 0), at the hand-over census (job step `B_in`): the class is fixed by
then and nothing after it is used. A NOSTART job is its six burn-in censuses alone, and its `summary.json` says `nostart` (B.3); the
test is the readout's own, applied by the job harness at the hand-over, and no run simulator is built (D21). Section 7 has its own rule
(7.2a) and no NOSTART class.

## 2. Q1: the lattice reproduces the literature

2.1 **Model.** Plan 6, exactly: K = 3, `sigma = mu = 1`, `epsilon = M N / 2` with `N = L^2`, four neighbours, periodic,
random start with probability 1/4 each of empty, 1, 2, 3, one generation = N reaction steps, the geometric exchange count of
plan 6, stop at absorption (at most one species) or at `t = N` generations.

2.2 **Grid.** `L` in {20, 30, 40, 60}; `M` in {1e-5, 3e-5, 1e-4, 2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4, 1e-3, 2e-3};
`R = 600` realizations per cell [standard error about 0.02 at most]; seeds by Appendix A.
`P_ext(L, M)` = `k / R`, `k` the number of realizations with at most one species at absorption or at `t = N`. The error used
below is that of the add-one estimate `p' = (k + 1) / (R + 2)`: `SE = sqrt(p' (1 - p') / (R + 2))`. It is never 0 [a count of 0 or
`R` must not give a zero error].

2.3 **The crossing.** For each of the six pairs `L1 < L2`: `D(M) = P_ext(L2, M) - P_ext(L1, M)`, `SE_D(M) = sqrt(SE1(M)^2 + SE2(M)^2)`. A
**sign change** is two adjacent grid values `Ma < Mb` with `D(Ma) <= 0 < D(Mb)`. It is **supported** iff (i) some grid value
`M <= Ma` has `D(M) < 0` and `D(M) <= -2 SE_D(M)`, and (ii) some grid value `M >= Mb` has `D(M) > 0` and `D(M) >= +2 SE_D(M)` [the larger
world survives better below the threshold and dies faster above it; a bare step from 0 to positive, which two counts of zero
make, is not a crossing]. The pair is **valid** iff it has a supported sign change; its crossing is the supported sign change
with the lowest `Ma`. The pair's estimate is the zero of the straight line through `(log10 Ma, D(Ma))` and `(log10 Mb, D(Mb))`
(`Ma` itself if `D(Ma) = 0`). `V` is the number of valid pairs and `M_c` the median of their estimates (for an even `V`, the mean
of the two middle values). The negative lobe stays required, as a strict `D < 0` and a strict `D > 0` per crossing (D6): dropping it
would make a crossing easier to find and a false one easier too.

2.4 **Trend R3.** `P_ext(60, 2e-3) - P_ext(60, 1e-5) >= 0.20`.

2.5 **Wavelength: not a v1 measurement.** The first draft's check (`L` = 200, 300 generations, the peak of the radial spectrum of
the label field, a log-log slope of 0.35 to 0.65 against `M`) is dropped. A scratch run of it found a peak at wavenumber 1 to 3
for every `M` (slope 0.08). The review's reading of JTB08 (not re-checked here) is that the continuum scaling holds for
`epsilon = M N / 2` of about 5 or more (here 0.06 to 4), more than 1,000 generations and `L` of 500 or more, and the peak of a
bin-averaged spectrum is biased to the lowest wavenumbers. With the check
inside row 1 below, LAT-PASS was unreachable. What replaces it: the live canvas (plan 6) lets a viewer see wavelength against `M`;
a measurement is deferred (plan 11) until the paper's own correlation-length definition has been read from the primary source.
It is dropped, and no number is reported in its place (D7): the live canvas shows the wavelength qualitatively.

2.6 **Outcome** (the first row that holds; exhaustive):

| row | condition | name | consequence |
|---|---|---|---|
| 1 | `V >= 4`, `M_c` in [3e-4, 6e-4], R3 | **LAT-PASS** | the reference reproduces the literature; the visuals and the words "like the lattice reference" in 4.5 may cite it |
| 2 | `V >= 4`, `M_c` in [2.25e-4, 9e-4], R3, not row 1 | **LAT-CAVEAT** | consistent within a factor 2 (convention, finite size); every use says so |
| 3 | `V >= 4`, R3, `M_c` outside [2.25e-4, 9e-4] | **LAT-OFFSET** | not reproduced; check the `epsilon`/`M` convention against JTB08 eq. 3 and 21 (report `epsilon/N` and `2 epsilon/N`) and whether a generation counts exchange events, then 2.7 |
| 4 | `V >= 4`, not R3 | **LAT-TREND** | a crossing without a rising `P_ext`: look for a bug first, then 2.7 |
| 5 | `V < 4` | **LAT-NOCROSS** | no threshold seen at these sizes; 2.7 |

[The tight band is the paper's 4.5 +- 0.5 x 10^-4 widened by a third; the wide band is a factor 2, the uncertainty of the
mobility convention (plan 1). **Registered expectation:** two independent scratch implementations of plan 6 (not results of this
line) put `M_c` at 3.0 to 3.2 x 10^-4, on the lower edge of row 1, so row 1 against row 2 will be decided by noise; the readout
prints `M_c`, the spread of the valid-pair estimates and `M_c / 4.5e-4`, and the write-up does not make the difference between
rows 1 and 2 a finding. Both bands stand as drafted (D8): row 1's lower edge is not widened and rows 1 and 2 are not merged.]

2.7 **Contingency** (only after rows 3, 4 or 5): add `L = 100`, `R = 300`, `M` in {2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 8e-4}, seeds
by Appendix A (about 3.9 x 10^11 events, plan 6). Pairs `(L, 100)` are tested by 2.3 on those six values; `V` and `M_c` are
recomputed over all valid pairs and 2.6 is applied again. A result still in rows 3 to 5 is **LAT-FAIL**: the reference is not
trusted for quantitative claims, the live canvas is shown with no claim of reproducing the literature, and the kernel results
are read without a lattice comparison. `L = 100` stays a contingency and is not in the main grid (D9; plan 6 gives the cost of the alternative).

2.8 **What the lattice outcome gates.** Nothing in sections 3 to 7 (the stages are independent). It changes only the wording
of claims (4.5) and the visuals.

2.9 **Before the sweep:** the unit tests of plan 6 pass, the module's events per second are measured (plan 6 cost), and a
rehearsal (`L = 20`, `M = 2e-3`, 50 realizations, seeds 900 and up) completes in seconds. The rehearsal is plumbing and is not a
result.

## 3. Gate 0 and the kernel preliminaries

### 3.0 Gate 0: the pilot that sets the operating point

**Why it exists.** Scratch runs of the plan's design (a shader-text prototype of plans 4.2 and 4.3, not bit-checked against a CPU
twin, on seeds 9001 and up, outside every reserved block; plan 10 lists them) point at a replacement-like regime on the plan's
substrate: at 128 x 128 x 4 every killing rate of the first draft's grid that was tried (32, 128 and 512) lost a founding label by
step 20,000, the last by step 3,000, while the neutral control kept all three for 100,000; the mobility knob had two or three
effective levels at 28 quanta per cell; spread 32 was extinct at 3,000 steps. That is evidence for a prediction, registered here:
**the plan's substrate (rung S0) is expected to fail Gate 0.** Gate 0 is the cheap, pre-stated way to find out, and to find the
next rung, before the rest is built or run for a substrate that cannot host the question. Rung V changes the kill and not the
substrate: in the same scratch runs removal in place on a full carpet acts as replacement (plan 4.3, 10), and a kill that empties the
cell leaves a vacancy that the neighbours must refill, which is the May-Leonard picture (plan 11).

**What it may set, and nothing else:** the rung (S0, S1, S2 or V), `G_spread`, `v_cal`, `R_cal` and `h0` (hence `T_end`); all from pilot
seeds (Appendix A) and by the rules below. The registered kernel shape is 128 x 128 x 4 (D4); the 256 x 256 x 4 horizon rung below is
diagnostic only and cannot produce GO or select an operating point. It moves no threshold: every threshold taken from scratch data is
frozen as written (D13, stated in the header).

**Code.** The spike: the review prototype (a text patch of `reactShader3` that adds the kill and the mask-mirror OR, and a driver
with the founding of plan 4.4), copied from `runs/rps/review/proto` to `experiments/3d-rps/gate0-spike/` and committed, so that the
pilot that chooses the operating point is reproducible from the repository (D16). The spike holds only what Gate 0 uses: the
prototype's own scratch drivers, its shell and python scripts and its `out/` logs and snapshots are not carried over and never added
(D29). The original is never written: the copy, and only the
copy, gets the V switch (G0.1: the vacancy kill beside the removal kill, chosen per job) and the Gate-0 driver (the job tables of G0.2
to G0.6, with `census-rps.ts` doing the census). The copy imports nothing from `runs/` (the prototype takes two helpers from
`runs/rps/probe/lib.ts` and reaches `packages/` by paths relative to its old place; the copy carries the helpers and the new paths), and
nothing in `packages/` imports the copy. Gate 0 runs on the spike, after the freeze of this file (header, D28) and before M0 (D1): the
kernel of plan M0 to M2 (Part B) is built only after Gate 0 gives GO for some rung. The spike patches the shipped shader text when it
runs, so it runs only against the tree it was written for; the Gate-0 record names that revision. The SHA-256 of the spike is the
SHA-256 of the sorted per-file listing printed by
`(cd experiments/3d-rps/gate0-spike && git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256)`, taken on the committed
files after the V switch and the driver are added and before the first Gate-0 job; it goes in the Gate-0 record (8.5) with the revision
of `census-rps.ts`. `git ls-files` cannot list files that are not yet committed, so the hash is first computed over the exact list of the
files kept, sorted with `LC_ALL=C`, and that list is written beside the hash (`experiments/3d-rps/gate0-spike.sha256`); the committed
files must give the same value (D29), and a test fails when the directory and the recorded list differ.

**Procedure.** Every job: the shape of 1.1, the burn-in of 1.3, `mutRate` 0, `rpsTypes` 3. **The rungs are taken in the order of
preference S0, S1, S2, V** [one departure from the plan at a time: S0 is the plan's substrate with removal, S1 and S2 change the matter
scale, V changes the kill], and Gate 0 **stops when the highest-preference rung that is not yet excluded gives GO**: that rung is used,
and the rungs after it are not run (D24). A rung is *excluded* when it ends in a NO-GO verdict (a V whose check fails is void and
excluded too: G0.1). So S1 is run after S0 is excluded; S2 only if S0 and S1 both end NO-GO: LEVELS; and V, which is run on the
substrate of the first rung of S0, S1, S2 that passes verdict row 1 and shares jobs with it (G0.1), once S0, S1 and S2 (if it ran) are
excluded. What V needs of its host is row 1: its rows start once the host has passed row 1 and do not wait for the host's rows 2 to 5,
which in this order means after the host is excluded, and under `--plan-all` beside the host's later rows (D27). A rung runs a later
step only if it passed the rows before it (G0.3 to G0.5). The jobs are queued in that order, S0's first, the jobs V shares with its host
being the host's (G0.1). **The readout's overall verdict stays *pending* until the highest-preference rung not yet excluded has a
verdict, or every rung is excluded** (GATE-0-STOP): a GO of a rung with a rung ahead of it still pending is that rung's own verdict,
printed as provisional and never as the result, and a rung after a GO is reported as not run and its jobs are not asked for. S0 and S1
are independent, so the second Mac may run S1 beside S0 (D2: the driver's `--plan-all`, or a process given S1 alone); if S0 then gives
GO the finished S1 jobs are listed in the record and not used, and the record names the rungs tried (8.5).

- *G0.1 Rungs.* S0 = the substrate of plan 7.1 (matter scale `s` = 1, `rpsMin` 4). S1 = `s` 4: `nutrient` 80, `biomass` 64, `kCatHalf` 512,
  `massUnit` 1,024, `thetaMass` 2,048, `rpsMin` 16. S2 = `s` 8: `nutrient` 160, `biomass` 128, `kCatHalf` 1,024, `massUnit` 2,048,
  `thetaMass` 2,048 (its cap), `rpsMin` 32. [Finer quanta. Scaling the matter, `kCatHalf` and `massUnit` together leaves the
  catalysis fluxes and the affinity argument in the same proportion to the mass, and the generalist's controller reads only light
  and energy per biomass, so a rung changes the integer granularity and little else. `thetaMass` cannot follow beyond 2,048, which
  is why S2 is not an exact rescale. S2 answers a LEVELS failure, which finer quanta may cure, and nothing else.] The rung constants are
  derived from the arithmetic of `cat`, affinity and flow, not tested; S0 and S1 are accepted as written (D2), and Gate 0 is where they
  are tried.
- *G0.1 Rung V, the vacancy kill (D14).* A rung that changes the kill and not the matter. (This `V` is the rung; the `V` of 2.3 and 2.6
  is the count of valid pairs.)
  - *Substrate:* that of the first rung of S0, S1, S2 that passes verdict row 1 (its matter scale, constants and `rpsMin`); V needs that
    rung's `G_spread`.
  - *Kill:* in `react`, at the place of the removal kill (after the pool caps, before the controller), a living cell with `ndom >= 1`
    (`ndom` counted exactly as for removal, `rpsMin` included) is **emptied** iff
    `(draw(base, RND_RPS.KILL) mod 2^16) < min(2^16, rpsRate * ndom)`, `RND_RPS.KILL` being slot 40; `rpsRate` is then a probability per
    dominant face per step in units of 2^-16, not a fraction of `B`. *Emptied* is the lesion of the 2D injury rule
    (`packages/sim-ref/src/step.ts`, the injury branch of `react`), mirrored and not reinvented: all of the cell's `B` and all its `P`
    become `C`, with the heat terms `B (eB - eC)` and `P (eP - eC)`; its `E` goes to heat; `MOT` is the at-rest word with the mirror bits
    24 to 31 equal to 0 (the path's `mot = MOT_ZERO`, which is `MOT_ZERO3` in the slab); both lineage words are 0; the fluxes are booked
    as that path books them (it books none: the heat total only); `A` and `S` are untouched; the ledger residual stays exactly 0.
    There is no `B > 0` condition: a living cell with `B` = 0 and `P` > 0 beside a predator is emptied too. `rpsRate` ranges 0 to 10,922
    under removal and 0 to 16,384 under the vacancy kill (plan 4.1 and 5); the spike refuses a rate above the bound of its kill (D27).
    Plan 4.3a has the full rule.
  - *Rate grid* of V's G0.3: {0, 64, 256, 1024, 4096} (probability per dominant face per step, in units of 2^-16). [The removal grid's
    numbers mean a fraction of `B` and would set V up to fail EFFECT for a reason unrelated to the mechanism. The probe's colonization
    front of 0.003 to 0.007 cells per step refills a one-cell vacancy in about 150 to 330 steps; May-Leonard has selection about equal to
    reproduction, so the kill probability per dominant face should be near 1/150 to 1/330 per step, about 200 to 440 per 2^16; the grid
    brackets that from about 4 times slower to about 10 times faster.]
  - *Shared jobs:* rate-0 jobs are identical under both kill rules (the kill test is never satisfied at rate 0), so V shares its
    substrate rung's G0.2 control scan and meter jobs, its G0.4 horizon jobs and the rate-0 jobs of its G0.3 table; a shared job is run
    once and counted for both. V adds only its own G0.3 rows at the four nonzero rates (4 rates x 3 spreads x 3 seeds = 36 jobs) and its
    own G0.5 confirmation, on the same pilot seeds (Appendix A); they run once the substrate rung has passed row 1. *The V check:* the
    Gate-0 driver runs one rate-0 job (the table's job at `v_mid`, seed 401, of the substrate rung) with the V build and with the removal
    build and compares the two `census.tsv` files byte for byte; it records the result (8.5), and files that differ are a bug in the V
    switch (8.4: the readout exits with code 3 and no V job counts). A V check that is absent, or has only one of its two builds, when V
    jobs were run is the same bug indicator and voids V in the same way: V's verdict is printed, flagged void, and never decides (D23).
  - *Verdict:* rows 2 to 5 below, as for every rung; row 1 is the substrate rung's. *Chirality:* the same bar, `chi_fw >= 0.2` (section 0),
    set on S0 scratch and not calibrated for V (under a vacancy kill the refill comes mostly from the predator side of a front, so
    positive chirality is still expected). `R_cal` for V = {`kappa_w / 2`, `kappa_w`, `2 kappa_w`, `4 kappa_w`}, each capped at 16,384, so
    that its largest is min(16,384, `4 kappa_w`) (D27).
  - *If V is the rung used,* the kernel's M1 and M2 implement the vacancy kill instead of removal (one more value of a kill-form key,
    plan 4.1), and removal stays the documented alternative.
- *G0.2 Control scan and meter.* For each candidate spread in C = {2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32}: one rate-0 job (seed
  401, 20,000 steps after the burn-in) and the meter of 3.1 (seed 405) with `B_meter` = the median over the carpet jobs of (`B` + `P`)
  per living cell at their last census, rounded to an integer. `carpet(v)` iff `liv >= 0.50` at every run census. *Grid rule:* scanning the carpet spreads
  in increasing order, `G_spread` takes the first and then each `v` with `D_lab(v) >= max(1.3 D_lab(last taken), 0.005)`, keeping
  at most 8; `levels = |G_spread|`. A MISSING meter job (1.3) of a carpet spread leaves that spread without `D_lab`: no row covers that,
  and the readout exits with code 3 (the main session decides by amendment, 8.3).
- *G0.3 Rate table.* Run only for a rung that passed row 1. `v_lo`, `v_mid`, `v_hi` are the lowest, the median (the lower middle for
  an even count) and the highest spread of `G_spread`. For each of them and each rate in {0, 8, 16, 32, 64} ({0, 64, 256, 1024, 4096}
  for V, G0.1): seeds 401 to 403, 20,000 steps after the burn-in. A cell
  `(v, kappa)` with `kappa > 0` **works** iff at least 2 of its 3 jobs are class DC and the rate-0 jobs of `v` are informative in the
  sense of 4.2 (at least 2 of 3 alive with `coexist` at every census of the final window, median `|chi_fw|` at most 0.1). A rate
  works *at* a spread when its cell does. `kappa_w` is the smallest rate that works at 2 or more of the three spreads, and `v_cal` the
  median of the spreads where `kappa_w` works (the lower middle if two); both are undefined if no rate works at 2 or more spreads.
- *G0.4 Horizon.* At `v_mid`, rate 0, seeds 401 to 403, 200,000 steps after the burn-in: `T_ctl` is the median run step of the first
  sustained loss (the lower middle for an even count; a control that keeps every label counts as infinite, so two usable controls, one
  lost at 50,000 and one that keeps every label, give 50,000) (D19). `h0` is the largest of 50,000, 100,000 and 200,000 that is at
  most `T_ctl / 4`, and none if `T_ctl / 4` is below 50,000. [The factor 4 keeps most controls inside the horizon, which is what
  `informative(v)` needs.] G0.4 is run only for a rung that passed rows 1 and 2 below, and once for a substrate rung and V together: it
  is run when either has passed them, and its jobs (rate 0, so identical under both kills) serve both.
- *G0.5 Confirmation.* At `v_cal` and `kappa_w` (defined below; V: its own), seeds 401 to 403, `h0` steps after the burn-in. Run only for a rung
  that passed rows 1 to 3 below. [The table is a 20,000-step screen and the scratch runs lost labels between 20,000 and 30,000
  steps; this is the same cell run for the horizon the sweep will use.]
- *G0.6 Dense rate.* After GO, on the idle M3 Pro (nothing else running on it): one rate-0 job at `v_mid` of the rung used, seed 404,
  20,000 steps after the burn-in, on the spike. Its `stepsPerSec` (B.3) is the dense rate to which 1.2 keys the reduced schedule (D3), and
  goes in the Gate-0 record (8.5). It runs before Part B's registered runs and not before Gate 0's verdict, which does not use it: the
  M3 Pro may not be reachable while the pilot runs, and the readout exits 2 on a later stage whose operating point has no dense rate
  (D27). The job counts only as the dense case it names: a rate-0 carpet (`liv` at least 0.50 at every run census, as in G0.2) that ran
  its 20 run censuses, so not class NOSTART, EXT, LOSS or SPARSE. For any other the dense rate stays unavailable (`denseRate` null), the
  Gate-0 readout exits 3 (no row covers it), and a repeat measurement is a dated amendment (8.3). [A rate-0 carpet is the dense case of
  plan 9; the M3 Pro and not the M1 Max, because the M1 Max is shared and often loaded.]

**Verdict, per rung** (the first row that holds; V is judged from row 2, row 1 being that of its substrate rung):

| row | condition | verdict | consequence |
|---|---|---|---|
| 1 | `levels < 5` | **NO-GO: LEVELS** | too few distinct mobilities (the integer staircase of plan 4.5): the rung is out; S2 is run only if S0 and S1 both end here, and V needs a rung that passed this row |
| 2 | no rate works at 2 or more of `v_lo`, `v_mid`, `v_hi` | **NO-GO: EFFECT** | at this rung the kill does not make a coexisting film with a cyclic signature: the rung is out |
| 3 | `h0` is none | **NO-GO: HORIZON** | the neutral control loses labels too soon to test anything: the rung is out, and the horizon rung below is tried if every rung that passed rows 1 and 2 failed here |
| 4 | fewer than 2 of the 3 confirmation jobs are class DC | **NO-GO: CONFIRM** | the cycle does not hold for the horizon even in the best cell: the rung is out |
| 5 | otherwise | **GO** | write the Gate-0 record (8.5); Part B may be built for this rung (plan 8); the record, once the dense rate of G0.6 is in it, is hashed into FROZEN (header), and the registered runs of Part B start after that. The rung used is the highest-preference rung not yet excluded: the first of S0, S1, S2, V with GO, and the rungs after it are not run (D24) |

On GO the record fixes: the rung; the kill form (removal, or the vacancy kill at V); `G_spread`; `kappa_w` and `v_cal` (G0.3); `R_cal` =
{`kappa_w / 2`, `kappa_w`, `2 kappa_w`, `4 kappa_w`}, each rounded to an integer of at least 1 (at V also capped at 16,384); `h0`; the
shape (128 x 128 x 4, 1.1: recorded, not set); the dense rate (G0.6, which may be entered after the first writing of the record: 8.5).

**If no rung gives GO (GATE-0-STOP).** When every rung that passed rows 1 and 2 failed at row 3 (HORIZON), the horizon rung is tried
once, at the first such rung in the order S0, S1, S2, V: 256 x 256 x 4, G0.4 alone (about four times the cost per step); this is the only
use of that shape (D4). A rung that failed at row 1 or 2 (LEVELS, EFFECT) is out for another reason and counts neither for nor against,
but at least one rung must have reached row 3, and a rung that failed at row 4 (CONFIRM) puts the horizon rung out (D17). The horizon rung
is not run on S2, nor on V when V ran on S2: the specified founding of S2 (160 nutrient and 128 biomass per cell) at 256 x 256 x 4 exceeds
the kernel's total-world matter bound (2^26 = 67,108,864) for seeds 401 and 403 (67,136,207 and 67,140,915); Gate 0 then reports
GATE-0-STOP, and a dated amendment is needed before its founding or shape change. The horizon rung is diagnostic only: after its G0.4 jobs
Gate 0 remains GATE-0-STOP irrespective of their result, any continuation requires a dated amendment (8.3), and no 256 x 256 x 4 kernel
programme is authorised by these rules. In every case no further rung is pre-registered and the main session decides by dated amendment
(8.3). The options, cheapest first: a substrate with persistent vacancies (less matter per cell) put through the same table, with either
kill; the exchange knob; the deferred transfer; or stopping the kernel half and reporting the lattice reference alone (plan 11). [The kill
that empties the cell is not on this list: it is rung V.]

### 3.1 The mobility meter (label mixing index)

Purpose: give the sweep a measured x-axis and its spread grid (plan 4.5). It decides nothing else.

For each candidate `spread` build an *inert stripe world*: the shape of 1.1, every rate constant (`kPhoto`, `kResp`, `kDecomp`,
`kGrow`, `kBuild`, `kEmit`, `kCost`, `kMaint`, `kPDecay`, `kBDecay`, `kELeak`, `kSDecay`, `kAbio`) set to 0, **`dtQ` set to 0** (the
affinity gradient is not zero near the z walls, so with `dtQ` 51 the end layers gain mass and the world is not inert), `rpsRate`
0, `mutRate` 0, seed 205 (405 in Gate 0); every cell living with `B = B_meter` (the integer of G0.2, about 28 at rung S0), `P = 0`,
`E = 2 B_meter`, `A = C = S = 0`. *x-stripes:* columns `x` in 0..63 carry label 0, 64..127 label 1 (two interfaces, at 64 and at
0/128). *y-stripes:* the same with `y`. Run `T_meter` = 5,000 steps. Let `m(u)` be the fraction of label 1 in line `u` (averaged
over the other two coordinates) and `W = sum over u of m(u) (1 - m(u))`. For two diffusing erfc interfaces
`W = 2 sqrt(2 D t / pi)`, so

`D = pi W^2 / (8 t)` with `t` the number of steps run [the constant is `integral of (1 - erf^2(u)) / 4 du = 1 / sqrt(2 pi)` per unit width].

`D_x` and `D_y` are the x-stripe and y-stripe values in cells^2 per step, and **`D_lab` = (`D_x` + `D_y`) / 2**; both are reported with
their ratio, and a spread whose axes differ by more than a factor 2, or where one is 0 and the other is not, is flagged
*anisotropic* (scratch: spread 8 at 28 quanta has `D_x` 0 and `D_y` 0.035). **`D_lab` is a mixing index, not a diffusivity:** the
formula assumes the deterministic erfc profile, and a sampled label field has line-averaged fluctuations that lower
`sum m (1 - m)` by an unmeasured amount (it may reach tens of percent when label clusters are a sizeable part of a line), so the
number orders spreads and is never compared with a diffusion constant. The live runs keep `dtQ` 51; the flow it drives near the z
walls is part of the substrate and is not measured here. A spread with `D_lab < 0.005` is flagged *flat*.

**Ordering.** The edge logic of 4.3 runs on `G_spread` in spread order and assumes mobility rises along it. The registered meter
(seed 205) measures `G_spread` again; if some consecutive pair has `D_lab(next) < D_lab(previous) / 1.3`, the readout exits with
code 3. A non-monotone `D_lab` over *all* candidate spreads is expected at 28 quanta per cell (scratch: 0, 0, 0, 0.018, 0.041,
0.039, 0.041, 0.031 for spread 1, 2, 4, 8, 12, 16, 24, 32: a staircase from integer floors, flat at 1, 2 and 4, then a plateau
from 12 up in which 16 sits below 12 and 32 below 24): the grid rule of G0.2 exists for that.

### 3.2 Kill-rate calibration

Purpose: choose the one predation rate used everywhere else, before the sweep, by a fixed rule.

Jobs: spread `v_cal`; `rpsRate` in `R_cal` and, besides, 0; seeds 201 and 202 (the rate-0 jobs are the paired controls: one
trajectory with the treatment through the burn-in); 20,000 steps after the burn-in; `mutRate` 0. A rate **qualifies** iff in *both*
seeds: (a) the job is class DC (every label at every census of the 20-census final window, alive, turnover at least 0.02,
`chi_fw >= 0.2`); (b) `liv >= 0.50` at the last census; and (c) the rate-0 job of that seed is alive, has `coexist` at every census
of its final window and `|chi_fw| <= 0.1` [the control is a carpet that keeps its labels and churns without a signature, so a
qualifying rate is a statement about the kill]. `kappa*` is the smallest qualifying rate.

If no rate qualifies: **KAPPA-NONE**. The sweep and everything after it do not run; the result section reports the table (class,
`chi_fw`, turnover and `liv` per rate and seed, with the paired control's values) and the main session writes an amendment (a
longer budget, other rates, another rung, the deferred transfer) before anything continues. There is no second spread: Gate 0
has scanned `G_spread`, and the first draft's fallback to spread 32 reused two seeds on a spread whose control died within 3,000
steps (scratch).

[`R_cal` is Gate 0's. The first draft's grid {32, 128, 512, 2048} lay above the range where the scratch runs kept three labels:
rate 8 kept them with `chi` near 0 and rate 32 lost one by 20,000 steps. 20,000 steps is a screen, not evidence of long-run
coexistence. Rung V's rates are probabilities per dominant face and run from the hundreds to the thousands (3.0, G0.1).]

## 4. Q2: the kernel shows a coexistence cliff along the mobility knob

### 4.1 Jobs

All with `rpsTypes` 3, `mutRate` 0, the Gate-0 substrate and shape, the burn-in of 1.3 and `T_end` of 1.2. `G_spread` is the grid of
the Gate-0 record (at least 5 and at most 8 spreads, in order of measured mobility).

- **Treatment:** `rpsRate = kappa*`; `spread` in `G_spread`; seeds 211 to 215 (5 per spread).
- **Control:** `rpsRate = 0` (labels, masks and mirror live, nothing kills); the same spreads; seeds 211 to 213, the first three
  treatment seeds: a control and its treatment are one trajectory until the end of the burn-in, so each pair differs only by the kill.
- **Rate arms:** spread `v_cal`, `rpsRate` in {max(1, floor(kappa*/4)), min(10,922, 4 kappa*)} (min(16,384, 4 kappa*) at rung V, whose
  key ranges to 16,384: plan 4.1); seeds 231 to 233 (3 each).
  Reported beside the table; not part of the outcome.

### 4.2 Per-spread quantities

For a spread `v` in `G_spread` (finished jobs only; NOSTART jobs, which section 0 excludes, are listed and not counted):

- `informative(v)` iff at least 2 of the 3 control jobs are alive with `coexist(c)` at every census of their final window, and the
  median of the `|chi_fw|` of all the finished control jobs is at most 0.1 [a control that loses a label or the world is a physics
  failure at that spread, not an RPS result; a control with a cyclic signature would be a bug]. A spread with fewer than 4
  treatment jobs or fewer than 2 control jobs finished is *incomplete* and counts as not informative.
- Class counts of the treatment jobs: `n_dyn` (DC), `n_fc` (FC), `n_churn` (CHURN), `n_lost` (LOSS and LATE), `n_ext` (EXT),
  `n_sparse` (SPARSE). They add up to the number of finished treatment jobs. `n_sig` is the number of treatment jobs with
  `chi_all >= 0.2` or `chi_fw >= 0.2`, whatever their class.
- `Tmed(v)` = the median of the finished treatment jobs' `T_cx` (the lower of the two middle values when the count is even), with
  CENSORED counted as `T_end + 1,000`; the `T_cx` of an EXT job is its stop step.
- `I` = the number of informative spreads.

### 4.3 Edges: what "a cliff exists" means

An **edge pair** is two *consecutive* values `a < b` of `G_spread`, both informative, of one of three kinds:

- **L, lattice-like cliff:** `n_dyn(a) >= 4`, `n_dyn(b) <= 1`, `Tmed(b) <= T_end / 4`, and every informative `v > b` has `n_dyn(v) <= 2`.
- **I, inverted cliff:** `n_dyn(a) <= 1`, `n_dyn(b) >= 4`, `Tmed(a) <= T_end / 4`, and every informative `v < a` has `n_dyn(v) <= 2`.
- **F, freeze edge:** `n_fc(a) >= 4`, `n_dyn(b) >= 4`, and every informative `v < a` has `n_dyn(v) <= 1`.

[L and I: four of five seeds coexist to the end with the cyclic signature on one side and at most one on the other; the loss on the
bad side happens in the first quarter of the run (`T_end / 4`, 50,000 at `T_end` 200,000), so it is a collapse and not a late
drift; no re-entry beyond the pair. F: below `a` the film is frozen (at least four of five runs keep every label and hardly
change); at `b` four of five keep every label, move and show the signature. The mobility staircase of plan 4.5 makes a frozen
low-spread region the likeliest shape, so this is a go case and not an anomaly. `G_spread` is ordered by measured mobility (3.1),
so "consecutive" means adjacent mobilities.] The three kinds exclude each other: a run is DC or FC, not both; F needs a CENSORED
median at `a`, and I needs an early loss there.

### 4.4 Outcome (the first row that holds; exhaustive)

| row | condition | name | consequence |
|---|---|---|---|
| A7 | `I < 4` | **UNINFORMATIVE** | stop and report; the controls fail at most spreads: a physics problem (Gate 0 should have prevented it), not an RPS result |
| A9 | exactly one F pair `(a1, b1)` and exactly one L pair `(a2, b2)`, no I pair, `b1 <= a2`, and `n_dyn(v) >= 3` for every informative `v` with `b1 <= v <= a2` | **DYNAMIC WINDOW** | M3c and M4 run |
| A1 | exactly one L pair, no F or I pair | **CLIFF, lattice-like orientation** | M3c and M4 run |
| A2 | exactly one I pair, no F or L pair | **CLIFF, inverted orientation** | M3c and M4 run; the plan predicted this is possible (colonization and mobility are one transport) |
| A8 | exactly one F pair `(a, b)`, no L or I pair, and `n_dyn(v) >= 3` for every informative `v >= b` | **FREEZE EDGE** | M3c and M4 run |
| A3 | no edge pair, `n_dyn(v) >= 4` for every informative `v` | **COEXISTENCE THROUGHOUT (within the budget)** | M3c and M4 run; not evidence of stable coexistence (the budget is not a waiting time) |
| A11 | no edge pair, `n_sig(v) <= 1` for every informative `v`, and `n_churn(v) >= 4` for some informative `v` | **NO DETECTABLE PREDATION EFFECT** | stop; labels coexist and churn as in the control and the kill leaves no cyclic signature, so at `kappa*` the kill is washed out. The next step is another substrate rung (3.0), not a wider sweep |
| A6 | no edge pair, `n_dyn(v) <= 1` for every informative `v`, and `n_fc(v) >= 4` for some informative `v` | **FROZEN COEXISTENCE ONLY** | stop; the deferred exchange knob (plan 11) is the next step |
| A10 | no edge pair, `n_dyn(v) <= 1` for every informative `v`, and `n_sparse(v) >= 3` for some informative `v` | **SPARSE FILM** | stop; persistent sparse films are not a carpet: a substrate question (3.0), not an RPS result |
| A4 | no edge pair, and `n_dyn(v) <= 1`, `n_fc(v) <= 3` and `n_lost(v) + n_ext(v) >= 3` for every informative `v` | **LABEL LOSS THROUGHOUT** | stop; the deferred transfer (plan 11) or another substrate rung is the next step |
| A5 | anything else: other combinations of edge pairs, or no edge pair and mixed values | **RAGGED OR GRADUAL** | M3c and M4 do not run; the readout prints the table and the main session decides by amendment (the options of plan 4.5) |

"Go" rows are A1, A2, A3, A8 and A9; they are the rows that define `spread*` (4.6) and open sections 5 to 7.

### 4.5 Wording the write-up may use

- A1: "the kernel shows a coexistence cliff along `spread` with the lattice's orientation (coexistence with a cyclic signature at low
  mobility, loss at high). This is a qualitative resemblance. The kernel has no exchange rate and no `M_c` was measured in it."
  If the lattice outcome is LAT-PASS or LAT-CAVEAT the sentence may add "like the lattice reference"; otherwise it may not.
- A2: "the cliff is inverted: coexistence needs mobility. Colonization and mobility are one transport in this kernel."
- A8: "below `spread` `a` the film is frozen (every label kept, almost no change); from `b` up, at least three of five runs at every
  informative spread keep every label for `T_end` steps and move with a cyclic signature."
- A9: "dynamic coexistence with a cyclic signature in a window of `spread` (from `b1` to `a2`): frozen below it, labels lost above it."
- A3: "at every informative `spread`, at least four of five runs kept every label for `T_end` steps with a cyclic signature."
- A4, A6, A7, A10, A11, A5: the table of the class counts, `n_sig`, `Tmed` and `D_lab` per spread, and the sentence of the
  consequence column.
- Never: "reproduces the literature's threshold" for the kernel; never "stable" for a run that was censored at `T_end`.

### 4.6 `spread*`

Defined for the go rows A1, A2, A3, A8 and A9: the smallest *informative* `v` in `G_spread` with `n_dyn(v) >= 4` whose informative
neighbours in `G_spread` (the previous and the next value) all have `n_dyn >= 3`; if there is none, the smallest informative `v` with
`n_dyn(v) >= 4` (D18). [An interior point of the dynamic region, so the mutation runs do not start at the edge of a cliff or of the
frozen region. `v` itself must be informative: a spread whose control lost a label is a physics failure and not an RPS result, and must
not be the point the mutation runs start at.]

## 5. Longer cycles as given (M3c)

Runs iff 4.4 gave a go row (A1, A2, A3, A8 or A9). Jobs: `K0` = 4 with seeds 241 to 243 and `K0` = 5 with seeds 244 to 246;
`rpsTypes = K0`; the cyclic masks `1 << ((t + 1) mod K0)`; `spread*`, `rpsRate = kappa*`, `mutRate` 0, the Gate-0 substrate, the
burn-in of 1.3 and `T_end` of 1.2.

A job is **VIABLE** iff it is class DC (chirality by the `K0` cyclic rule of section 0) and `Y_c = K0` at every census of its
final window. An arm (`K0`) is viable iff at least 2 of its 3 jobs are VIABLE. Reported only: it does not gate section 7, but the
write-up must state it next to section 7's verdicts, because growth beyond three types means little if a four-cycle is not
viable at all.

## 6. The deep volume (conditional)

6.1 **Precondition.** All of: 4.4 gave a go row (A1, A2, A3, A8 or A9); and at `spread*`, among the treatment jobs of class DC (at
least 4), the median `xi` of the final snapshot (Appendix B.1) is at least 6 cells. [A 64 x 64 x 32 volume then holds about ten
correlation lengths across. The neutral carpet's `xi` is 2, the noise scale (scratch), so a film that passes has domains larger
than noise. The first draft's conditions, a spectral wavelength of at most 16 cells and a z-coherence of at least 0.9, are
dropped: the wavelength of a noise-scale label field is trivially small, and at four layers the coherence was 0.23 to 0.36
whenever the film mixes (scratch), so it could not hold together with DC.] The z-coherence of the final snapshots is reported.

6.2 **If it holds:** three runs (seeds 261 to 263) of 64 x 64 x 32 (`tileD` 32, 131,072 cells), `lightK` 16384, uniform
light 40 + 200, `rps-mix` with `columns` false (a three-dimensional random start), `spread*`, `rpsRate = kappa*`, `mutRate`
0, the burn-in of 1.3, `T_end` of 1.2, everything else as 1.1.

6.3 **Reported only; no pass or fail.** The number of layers with at least 20 % living cells at the end; the vertical
coherence `C(d)` for `d` in {1, 2, 4, 8, 16, 31} (among cells living at both `z` and `z + d` in the same column, the fraction
with equal labels, averaged over `z`); the per-layer label shares; the final label volume; an exploratory render. **No
scroll-wave claim is made in v1.**

6.4 **If it fails:** the write-up names the condition that failed (no DC job, `xi` too small) and shows no deep render.

## 7. Q3: does the cycle grow

7.1 **Gate.** Section 7 runs iff 4.4 gave a go row (A1, A2, A3, A8 or A9). Otherwise the readout reports "mutation runs not made:
gate closed". Inside the section, arm Z runs first and the other five arms are queued only if the horizon check of 7.4 is passed.

7.2 **Arms.** Every arm: `spread*`, founding `K0` 3, the Gate-0 substrate, the burn-in of 1.3, then `T_end7` = `5 T_end` (at most
1,000,000) **[budget]**, seeds 251 to 255 (the same five in every arm, so initial conditions are paired), the default
`eventCap` drained at every census. The `mutRate` values below are those of rung S0; at a substrate of matter scale `s` (3.0: 4 at S1,
8 at S2; rung V takes the scale of its substrate rung) each arm uses `mutRate` = floor(the table's S0 value / `s`), arm W included (at S1
10,737 for arms A, B, C and N and 107,374 for W; at S2 5,368 and 53,687), because events are per synthesised quantum and would
otherwise rise with `s`.

| arm | what it tests | `rpsTypes` | `rpsFlip` | `rpsEdge` | `rpsRate` | `mutRate` |
|---|---|---|---|---|---|---|
| **Z** substrate | whether the unmutated cycle holds for `T_end7` at all: the horizon check of 7.4 | 3 | 0 | 0 | `kappa*` | 0 |
| **A** edges | the 3-cycle's stability when mask bits mutate (a cycle through more than 3 labels is impossible) | 3 | 4,294,967,295 | 256 | `kappa*` | 42,950 |
| **B** labels | immune clones and their relatives (plan 4.4): types change, masks are copied | 5 | 4,294,967,295 | 0 | `kappa*` | 42,950 |
| **C** both | whether a long cycle grows | 5 | 4,294,967,295 | 128 | `kappa*` | 42,950 |
| **N** null | arm C's operators with predation off: what random mask drift builds without selection | 5 | 4,294,967,295 | 128 | 0 | 42,950 |
| **W** weights | whether ordinary controller evolution breaks the cycle | 3 | 0 | 0 | `kappa*` | 429,497 |

[`mutRate` 42,950 is about 10^-5 per synthesised quantum: about 33 mutation events per 1,000 steps at rung S0, so about 33,000
per 1,000,000-step run. `rpsFlip` is compared as `draw < rpsFlip`, so 4,294,967,295 sends every event but one draw in 2^32 to the
RPS operator: the expected number of controller mutations in a run is below 10^-5, and the controller is frozen up to that
probability. W uses the default rate 429,497 and no RPS events. The mutation rate is a guess, a rate ten times higher or lower being
as defensible, and the choice cannot be improved without runs; it stays as drafted (D10).]

7.2a **Early stop.** A run stops at an EXTINCT census. In arms Z, A and W (no label can appear: types never change) it also stops
at the census that completes three consecutive censuses with `n_c <= 1`, and is class MONO. Arms B, C and N run to `T_end7`: a
type change can bring a label back.

7.3 **Run class** (the first row that holds, from the run's run censuses; the burn-in is not part of it):

| class | condition |
|---|---|
| EXTINCT | `liv(c) < 0.01` at some census |
| LONG | `Y_c >= 4` at every census of the final window (the last 50) |
| THREE | `Y_c = 3` at every census of the final window |
| LOOSE | `n_c >= 2` at every census of the final window |
| MONO | otherwise (some census of the final window has `n_c <= 1`), or the run stopped early as MONO (7.2a) |

Also recorded for every run: EVER-LONG (a stretch of 20 consecutive censuses with `Y_c >= 4` anywhere), the largest `Y_c` seen,
the first step with `n_c >= 4`, the number of mutation events, and the **supply**: the largest value of `supply` (B.2: lineages
born after the start that hold at least 64 living cells) over the run's censuses. They are reported, not deciding, except that
the median supply of arm C enters rows 1 and 2 of 7.5.

7.4 **Horizon check.** Arm Z needs all five runs (with fewer the readout exits with code 4). If at least 3 of its 5 runs are MONO
or EXTINCT, section 7 is **HORIZON-VOID**: the other arms are not run, or, if they already ran, the readout prints every verdict
of 7.5 marked void, and the write-up says that the unmutated cycle does not hold for `T_end7`, so no verdict, a collapse least of
all, says anything about mutation. [At the plan substrate the scratch runs lost a label by 20,000 steps at every killing rate that
was tried, and the neutral control had not lost one by 100,000 (at 64 x 64 x 4 it lost one by 37,000); `T_end7` is five times a
horizon that 3.0 already limits to a quarter of the control's loss time, so a void section is a live possibility, and arm Z is
five runs, not twenty-five.]

7.5 **Arm verdict** (the first row that holds). `g_L`, `g_T`, `g_Lo`, `g_M`, `g_E` are the numbers of runs of an arm in LONG,
THREE, LOOSE, MONO and EXTINCT; `k_c = g_M + g_E`; `k_s = g_T + g_L`; `gN_L` is `g_L` of arm N; `u_C` is the median over arm C's runs
of the supply of 7.3.

| row | arm | condition | verdict |
|---|---|---|---|
| 1 | C | `g_L >= 4`, `gN_L <= g_L - 4` and `u_C >= 1` | **GROWS**: a clean cycle through four or more types held at the end in most seeds, drift alone does not do that (the count test is the one-sided exact Fisher test at 0.05: 4 against 0, 5 against 0, 5 against 1), and mutants did reach a size at which selection can act |
| 2 | C | `g_L >= 3` and not row 1 | **UNDISTINGUISHED**: long clean cycles appear, but not distinguishably from drift at this size, or `u_C < 1` (no mutant lineage reached 64 cells in most runs) |
| 3 | any | `k_c >= 3` | **COLLAPSE**: the cycle is lost in most seeds |
| 4 | any | `k_s >= 3` | **STABLE**: a clean 3-cycle (or longer) is held in most seeds |
| 5 | any | otherwise | **INCONCLUSIVE** |

Rows 1 and 2 are defined for arm C only and need all five runs of arm N (with fewer, the readout exits with code 4). Rows 3
and 4 cannot both hold (3 + 3 > 5). LONG cannot occur in arms Z, A, B or W (Z, A and W have three labels; in B no mask has a bit for a new
label, so no cycle passes through one): if it does, the readout exits with code 3, because that is a bug in the operator or the
readout, not a result. Arm Z's own row is its horizon check (7.4); its verdict is printed for the record.

7.6 **Predictions, registered before any run** (the write-up states hit or miss for each):
Z: STABLE; the section is void only when the horizon check of 7.4 says so. W: STABLE, if Z is not void. A: STABLE or COLLAPSE (no
prediction which). B: COLLAPSE, or INCONCLUSIVE with LOOSE strictly more frequent than every other class [at `K` = 5 with three founded
labels a type change gives an immune clone in half of the cases, a toothless clone (empty mask) in a quarter, and a relabel to a founded
label with the old prey, which makes a mutual pair, in a quarter (plan 4.4); no prediction is made about the commonest class beyond
that]. C: not GROWS (UNDISTINGUISHED, COLLAPSE, STABLE or INCONCLUSIVE). N: no prediction. The type-change operator is the one of plan
4.4, as built (D11), and the prediction for arm B above is the one restated for it; making a relabel always an immune clone was not
adopted.

7.7 **What cannot be concluded.** With five seeds a count of 2 against 3 is within chance; GROWS needs 4 against 0, 5 against 0
or 5 against 1, one test (arm C against N), no correction across arms because no other arm is tested for growth. GROWS is a
statement about this operator set, this substrate and this budget, not about open-ended evolution. INCONCLUSIVE and
UNDISTINGUISHED are not evidence for or against growth. A COLLAPSE of arm B or C does not show that a four-cycle cannot exist,
only that these mutations did not build one; section 5 says whether one is viable at all. Neutral mutants are critical
branching lineages in this lottery (scratch: about one expected offspring per step), so most mutants die at once; `supply` is the
number that says whether the arms had anything to select among. Five seeds per arm stand, with arm Z first (D12); more seeds were
not adopted (plan 9 gives the cost).

## 8. Reporting

8.1 The result section lists every job of every stage with its inputs (Appendix B), including MISSING jobs and the
controls. No run is dropped, replaced or rerun except by 1.3.

8.2 Every outcome table is printed in full by the readout, with the row that held and the numbers that decided it.

8.3 Any deviation (a changed value, a skipped stage, a different machine split) is a dated amendment under the result
section, written before the affected run, quoting the frozen hash. A run made before an amendment is reported under the
version it ran under. A line of `experiments/3d-rps/FROZEN` is `<sha256>  <file>` and may be dated, before or after the hash
(`2026-11-02  <sha256>  GATE0-RECORD.md`); the file is the word that ends in `.md`, a line without one is a bare hash, and any recorded
hash of a file counts, so an amendment that records the new hash of RULES.md beside the old one keeps the readout working.

8.4 Exit codes of `readout.ts`: 0 a verdict; 2 unusable input; 3 a situation no row covers, or a bug indicator; 4 jobs still
missing. When several apply, the readout exits with the first of 2, 3, 4 in that order. Bug indicators: a nonzero residual or a matter
change (1.3); jobs of one seed and one burn-in config whose `burnHash` differ (section 0); a control with
`|chi_fw|` above 0.3; LONG in arm A, B, W or Z (7.5); a D_lab ordering that fails 3.1; a V check whose two `census.tsv` files are not
byte-identical, or that is absent when V was run (3.0, G0.1); a conservation or invariant failure of an earlier attempt of a job (1.3).
Unusable input (exit 2) also covers a `census.tsv` that does not follow the schedule of B.2 (a census every 1,000 steps from step 1,000,
six burn-in censuses, none missing) and a job whose recorded settings are not those the rules give for its stage: `mutRate` 0, `rpsTypes`
3 and K0 3 in Gate 0 and in sections 3 and 4, `rpsTypes` = K0 in section 5, the arm table of 7.2 (`mutRate` = floor of the S0 value
divided by the matter scale) in section 7, the vacancy kill for every rung-V job, the removal kill for a substrate rung's job at a nonzero rate.

8.5 The Gate-0 record (`experiments/3d-rps/GATE0-RECORD.md`, written by the main session from the readout's Gate-0 table at the
final GO or GATE-0-STOP) lists every Gate-0 job, the verdict row of each rung tried (S0, S1 and S2 if run, and V with the rung it ran
on; a rung after the first GO is named as not run), the operating point (rung, kill form, `G_spread`, `v_cal`, `kappa_w`, `R_cal`, `h0`,
shape), the SHA-256 of the spike (the directory listing of 3.0, taken before the first Gate-0 job) with the revision of the tree it ran
against, the revision of `census-rps.ts`, the dense rate of G0.6 (idle M3 Pro) and the steps per second of the other jobs, and, when V
was run, the result of the V check of G0.1 (byte-identical or not). The dense rate may be measured after the verdict (G0.6): at GO the
initial record may contain `denseRate: null`, G0.6 completes it when it has run, and the record's hash is taken only then; at GATE-0-STOP
the operating point and the dense rate are recorded as not applicable. The record's SHA-256 is appended to `experiments/3d-rps/FROZEN`
in a dated line (8.3) before any Part B registered run. The registered readouts (3.1, 3.2 and 4 to 7) take the operating point from the
hashed record: a `--op` file must agree with it in every field the record holds (`kappa*`, which only the calibration gives, is added to
it). RULES.md was frozen before Gate 0 (header) and does not change. Gate-0 numbers are pilot numbers: no write-up quotes one as a
result.

## Appendix A: seeds

| use | seeds | note |
|---|---|---|
| 3D depth check (rung 1b) | 1 to 6 | never used here: no calibration may see them |
| rung 1b M4 calibration | 101 to 103 | not reused |
| slab golden cases | 301 to 316; RPS golden cases 321 to 327 | not reused for runs |
| Gate 0 pilot (kernel) | 401 to 499 | 3.0: 401 the control scan, 401 to 403 the rate table, the horizon and the confirmation, 404 the dense rate (G0.6), 405 the meter; rung V uses the seeds of the rung it shares jobs with; pilot only, never reused by a registered stage |
| kill-rate calibration | 201, 202 | 3.2; rate 0 on the same two seeds is the paired control |
| mobility meter | 205 | 3.1 |
| sweep treatment | 211 to 215 | 4.1 |
| sweep control | 211 to 213 | 4.1: the first three treatment seeds, so a control and its treatment are one trajectory through the burn-in; 221 to 223 are unused |
| rate arms | 231 to 233 | 4.1 |
| longer cycles | 241 to 243 (`K0` 4), 244 to 246 (`K0` 5) | 5 |
| mutation arms | 251 to 255 | 7.2, one block for every arm (Z, A, B, C, N, W) |
| deep volume | 261 to 263 | 6.2 |
| lattice realizations | `2,000,000 + 100,000 * iL + 1,000 * iM + r`, `iL` the index in (20, 30, 40, 60, 100), `iM` the index in the `M` grid of 2.2, `r < 1000` | 2.2, 2.7 |
| scratch of the reviews | kernel 9001 and up; lattice 3,500,000 and up, 7,000,000 and up, 8,000,000 and up | scratch, never reused for a result |
| rehearsals of scripts | 900 and up | plumbing only, never results |

## Appendix B: formulas and files

**B.1 Correlation length** (kernel 6.1, reports). Defined in section 0; computed from `final.bin` (layers 0 to 3 of the film), lags
along x and along y separately, then averaged. The radial power spectrum and the wavelength estimate of the first draft are not
used in v1 (2.5).

**B.2 `census.tsv`** (kernel jobs), tab separated, one header line, one row per census, the burn-in's included: `phase` (`burn` or
`run`), `step` (job step), `rstep` (run step; 0 or negative in the burn-in), `living` (cells), `turnover` (`changed / both`, the
quotient of two cell counts in full precision, as section 0 has it; empty on the first row and where no cell lives at both censuses),
`ndom` and `nanti` (the counts of section 0; empty in jobs with `mutRate` above 0), `zcoh`, `n`, `Y`, then `cells0` to
`cells7` (living cells per label), `mass0` to `mass7` (`B + P` summed over those cells), `modal0` to `modal7` (modal mask, two
hex digits, `--` for a label with no cells) and `supply` (section 7: distinct lineages with a nonzero birth step that hold at
least 64 living cells; empty elsewhere). Sections 3 to 7 are computed from this file alone, plus `summary.json`; the run class,
`T_cx`, `chi_all` and `chi_fw` are computed by the readout, not stored by the driver.

**B.3 `summary.json`** (kernel jobs): `id`, `stage`, the complete `WorldConfig` and `InitParams` of both phases (Gate-0 jobs, which run
on the spike, also write `rung`: `S0`, `S1`, `S2` or `V`; `kill`: `removal` or `vacancy`; and the kill's parameters, which the spike
keeps outside `WorldConfig`), `seed`, `steps`
(job steps run), `stop` (`end`, `ext`, `loss`, `mono` or `nostart`, and the run step; 0 for `nostart`, whose job ends at the hand-over,
1.5), `host`, `device`, `stepsPerSec`, `matterOk`,
`residual` (decimal string; must be `"0"`), `burnHash` (`stateHash` at the end of the burn-in; equal for jobs of one seed and one
burn-in config),
`extinctAt` or null, `events` (count), `attempts` (1 or 2), `retried` (the failures of the earlier attempt of a job that passed on the
rerun, each with its kind `crash`, `conservation` or `invariant`, step and message; absent when the first attempt passed), `failures`
(in a MISSING marker), `final` (path of `final.bin` when written). `final.bin` is little-endian `u32`:
`W, H, D, K0`, then the 7 cell channels and the 4 genome-head channels, channel major (about 3 MB at 128 x 128 x 4).

**B.4 Lattice results**, one JSON per `(L, iM)`: `L`, `M`, `iM`, `N`, `epsilon`, `epsOverN`, `twoEpsOverN`, `R`, `k` (realizations with
at most one species left), `pExt` (`k / R`), `absorbedBy` (histogram of absorption generation in tenths of `N`), `seeds` (first,
last), `seconds`, `eventsPerSecond`.

## Appendix C: stages, order and gates

| stage | needs | runs when |
|---|---|---|
| 3.0 Gate 0 pilot | the freeze of RULES.md (D28); the spike, committed as `experiments/3d-rps/gate0-spike/` with its V switch and driver (D16, D29) | always, after the freeze and before M0; the rungs in the order S0, S1, S2, V, stopping at the first GO (D24); **GATE-0-STOP** ends the kernel half |
| 2 lattice | the freeze of RULES.md | always, after the freeze (2.7 only after rows 3, 4 or 5) |
| 3.1 mobility meter | `G_spread` of the Gate-0 record, whose hash is in FROZEN | always |
| 3.2 kill-rate calibration | the Gate-0 record, whose hash is in FROZEN | always; **KAPPA-NONE** stops 4 to 7 |
| 4 sweep | `kappa*` | unless KAPPA-NONE |
| 5 longer cycles | the readout of 4 (a go row) and `spread*` | 4.4 gave a go row |
| 6 deep volume | the readout of 4, `final.bin` of the DC treatment jobs | 4.4 gave a go row and 6.1 holds |
| 7 mutation arms | the readout of 4, `spread*`, `kappa*` | 4.4 gave a go row |

Order of work. **Part A** touches nothing under `packages/sim-ref/src`, `packages/sim-gpu/src` or `packages/schema/src`, and every
golden pin stays byte-identical. It is: the lattice module with its tests (the code of stage 2), `census-rps.ts` and the core of the
readout, the spike committed as `experiments/3d-rps/gate0-spike/` with its V switch and the Gate-0 driver (D16, D29), and the companion
page with the live lattice canvas and the kernel result slots labelled "not yet run" (plan M5a, D15). **Then the freeze (D28):** the
main session copies this file to `experiments/3d-rps/RULES.md` and records its SHA-256 in `experiments/3d-rps/FROZEN`; nothing registered
runs before that, and RULES.md changes afterwards only by dated amendment. **Then Gate 0 itself on the spike (D1), and the lattice
sweep** (stage 2), which does not depend on Gate 0: Gate 0 takes the rungs in the order S0, S1, S2, V and stops at the first GO (D24; one
to two hours per rung, scratch code on pilot seeds; S1 after S0 is excluded, S2 only after two LEVELS failures, V only after S0 and S1
are excluded; S1 beside S0 on the second Mac only on request, D2). The Gate-0 record is written at the final GO (or GATE-0-STOP),
completed after a GO with the dense rate of G0.6 (at GATE-0-STOP it is not applicable, 8.5), and its hash appended to FROZEN. **Part B**
may be built after Gate 0 gives GO for some rung: plan M0 to M2 for the kill form of the rung used, and the kernel drivers (plan 8); its
registered runs start only after the completed record's hash is in FROZEN. Then 3.1 and 3.2 (cheap); then 4, whose queue is the jobs of
4.1. Stages 5 and 7 start only after the readout of 4 has printed its outcome row (they need `spread*`); their jobs join the same
two-machine queue. Then 6, then the write-up.
