# Droplet genes, linked templates, second screen: record

**Dates:** 2026-11-21 and 22. Protocol: [PLAN.md](./PLAN.md). Raw files: `runs/dropgenes/linked2/` in the line's
worktree (not in git), with the dated copy of the plan as it stood before the first linked run
(`PLAN-before-first-linked-run-2026-11-21T2236.md`) and the sha256 of the plan and code at that moment.

Nothing here is evidence. Every run is on seeds 1 to 4 (all seen for this world); no seed above 4 was run.
This is a second screen made after the first screen's stop rule had fired, with `x00` known in advance.

## Outcome

**The line ends negative under the second stop rule, and this time it is a clean no.** Nine of the 12 listed
settings passed the clean gate: linked four-gene templates held their compartments without the parasite on 4
of 4 seeds for 200,000 steps, with full templates 39% to 89% of all molecules over the last tenth of the run. **With the parasite
every one of the nine lost seeds 1 and 2** (the last compartment gone between step 1,450 and 14,100), so none
can reach 3 of 4. The capacity-matched unlinked arm also lost with the parasite, on 4 of 4 seeds (step 5,750 to
15,200). So at breaking and loss rates below `1e-4` and with matched capacity, linked genes did not let a gated
compartment hold four genes with the parasite present, and neither did separate genes. Nothing is frozen, no
confirmation is proposed, and seeds 17 to 24 stay unseen.

What changed against the first screen: its settings all died without the parasite, so their failure with it
said nothing. Here the templates are viable without the parasite and still fail with it.

## Before the screen

### The edited observer, runner and summariser report what they did

- **Summariser.** `summarize.ts` at `b1972800` and the edited one, each over the first screen's four run
  directories (`calib`, `side`, `diag-gated_clean`, `diag-gated_par`; 60 runs): every line the old one prints is
  printed by the new one in the same order, and the `--json` output is equal once the three new keys are
  removed. The new tables come after the last old one.
- **Runner, unlinked.** Replay of the first screen's unlinked K = 4, 16 sites, `GATED_PAR`, seed 1 (made before
  the plan was written; it is not a linked run): every field of the old file is equal in the new one apart
  from the two timing fields, and the report rows are identical.
- **Runner, linked.** Replay of the first screen's `c01`, seed 1, `GATED_PAR` and `GATED_CLEAN` (made after the
  review and the dated copy, before the gate): the same, for both. The new per-census length series has one
  entry per census from step 0, agrees with the report rows at their steps and with the end-of-run readout.
- In all 105 runs of this screen the new death readout's "deaths with a gene missing" equals the count the
  tracker already kept (`deathsIncomplete`), and its records equal the tracker's deaths (the cap on records was
  never reached).
- `observe.ts`, `run.ts` and `sweep.ts` have the same sha256 at the end as before the first step 0 run, so
  every run of this screen was made with one version of the code.

```bash
python3 experiments/dropgenes/linked2.py regress
```

### Review before the first linked run (Codex, Sol 6.1, High, read-only)

Two passes on 2026-11-21, both before any linked run.

| finding | severity | what was done |
|---|---|---|
| The driver skipped a run whose file existed before `sweep.ts` could check it, and took decisions from any file with the right name | P1 | Fixed: every seed is passed to `sweep.ts`, which checks an existing file against the whole request; the driver checks every file it reads (below) |
| The parasite stages could start past an incomplete gate, skip a setting silently, or succeed on empty directories | P2 | Fixed: each stage refuses until the stage before it is complete for every listed setting; "dropped on two losses" is told apart from "not run yet" |
| `step0-more` did not check "exactly 2 of 4" and mis-applied the 200,000-step rule to seeds 5 to 8 | P2 | Fixed (the mode was never needed: step 0 gave 0 of 4) |
| Second pass: the driver's own file check covered only the keys it sets, not defaults such as `kDecT`, nor the protocol | P1 | Fixed: the whole configuration (defaults read from the kernel) and the protocol record are compared; tampered copies with another decay rate, founders, horizon, an extra link key or a residual are refused |
| PLAN: the joining ratios hold only on a tile within its slot limit | P3 | Wording fixed |
| PLAN: "clean worlds at k = 7 ended at 8,000 to 16,000" was too broad | P3 | Wording fixed (which settings, exact steps) |
| The new summariser tables were printed before an old table | P3 | Moved after the last old table |
| The tests would not catch a wrong earliest date or a wrong median | P3 | A three-gene test with four deaths added |

The reviews found no P1 or P2 in the plan, the observer, the runner, the summariser or the tests. The list,
the gates and the rules were not changed by them.

### Review of the final state (Codex, Sol 6.1, High, read-only, 2026-11-22)

After the runs. It checked the tables against the run files (565 table values, the run counts, the timers,
the residuals, the seeds used), the driver's decisions and the final plan against its dated copy, and found
no P1 or P2 in the code, the tests, the driver's decisions or how the protocol was carried out. Its findings
were all in this file's wording, and all were taken:

| finding | severity | what was done |
|---|---|---|
| "There is no slow decay" and "a steady 39% to 89%" said more than the runs show | P1 | Now "no collapse through 200,000 steps", with the window-pooled shares at both horizons for every setting, and "a slower decline is not ruled out" |
| "Compartments do not end by first losing a gene" and "the genes were not lost one by one" claimed an order a 50-step census cannot see | P1 | Now: most were complete at the census before; what happened in the last interval is not resolved |
| "Mostly lack all four" was true of family M at breaking k = 1 only | P2 | Restricted, with the shares for each group |
| "Short templates take the sites is true at the first screen's rates" turned an inference into a measurement | P2 | Now: short molecules dominated the composition there; displacement was not measured |
| s08's held seeds do hold a full template at a few censuses | P2 | "next to no full template", with the bound |
| The death table mixed per-run ranges with ranges over settings | P2 | Columns labelled; per-run ranges added |
| "2% at most" | P3 | "about 2%" |

## Step 0. The unlinked control at 64 sites

Unlinked (link keys absent), K = 4, 64 sites per tile, seeds 1 to 4. Read by the rule written before its first
run (PLAN.md, step 0).

| arm | horizon | seeds held | late compartments | complete share | no compartment left at step |
|---|---|---|---|---|---|
| `GATED_PAR` | 50,000 | **0 of 4** | 0 | n/a | 11,600, 14,450, 5,750, 15,200 |
| `GATED_CLEAN` | 50,000 | 4 of 4 | 39.8 to 41.3 | 0.99 | none |
| `GATED_CLEAN` | 200,000 | **4 of 4** | 41.2 to 41.9 | 0.99 | none |

`GATED_PAR` had no seed held at 50,000, so by rule 1 it was not run at 200,000. By rule 2 (at most 1 of 4) **the
screen is at K = 4**. The unlinked world is healthy at 64 sites without the parasite (about 41 compartments
against 11 to 14 at 16 sites in the first rung and the first screen), so its loss with the parasite is the
parasite's doing. More
room lengthens the unlinked arm's life with the parasite (the first screen's 16-site runs ended at step 3,850
to 7,850) and does not hold it. Residual 0 in all 12 runs.

```bash
python3 experiments/dropgenes/linked2.py step0       # 8 runs, 50,000 steps
python3 experiments/dropgenes/linked2.py step0-200   # GATED_CLEAN, 4 runs, 200,000 steps
```

## Step 2. The clean gate

The list is in PLAN.md (fixed before any linked run). Family M: one site per molecule, 16 sites. Family G: one
site per gene, 64 sites. All linked, K = 4, linked founders, `GATED_CLEAN`.

### Seeds 1 and 2, 50,000 steps

| setting | family | join | break k | loss k | seeds held | late compartments | no compartment left at step | full-template share at 2,000 / 10,000 / 50,000 (seed 1, seed 2) |
|---|---|---|---|---|---|---|---|---|
| s01 | M | 0.05 | 1 | 1 | 2 of 2 | 58.3, 57.2 | none | 0.91, 0.91 / 0.88, 0.87 / 0.84, 0.96 |
| s02 | M | 0.05 | 1 | 4 | 2 of 2 | 56.3, 56.9 | none | 0.75, 0.93 / 0.82, 0.88 / 0.82, 0.84 |
| s03 | M | 0.05 | 4 | 1 | 2 of 2 | 43.5, 43.5 | none | 0.48, 0.67 / 0.58, 0.39 / 0.57, 0.56 |
| s04 | M | 0.05 | 4 | 4 | 2 of 2 | 42.8, 41.9 | none | 0.55, 0.63 / 0.53, 0.58 / 0.64, 0.63 |
| s05 | G | 0.05 | 1 | 1 | 2 of 2 | 56.6, 54.7 | none | 0.37, 0.38 / 0.56, 0.37 / 0.32, 0.55 |
| s06 | G | 0.05 | 1 | 4 | 2 of 2 | 51.5, 53.3 | none | 0.32, 0.42 / 0.41, 0.79 / 0.72, 0.52 |
| s07 | G | 0.05 | 4 | 1 | **0 of 2, dropped** | 0, 0 | 4,500, 3,250 | 0.11, 0.09 / n/a / n/a |
| s08 | G | 0.05 | 4 | 4 | 1 of 2 | 0, 38.2 | 2,600, none | 0.04, 0.09 / n/a, 0.00 / n/a, 0.00 |
| s09 | M | 1 | 1 | 1 | 2 of 2 | 57.4, 57.9 | none | 0.95, 0.99 / 0.89, 0.74 / 0.90, 0.85 |
| s10 | M | 1 | 4 | 4 | 2 of 2 | 44.0, 39.5 | none | 0.53, 0.58 / 0.75, 0.65 / 0.42, 0.57 |
| s11 | G | 1 | 1 | 1 | 2 of 2 | 55.4, 48.0 | none | 0.58, 0.63 / 0.40, 0.41 / 0.61, 0.55 |
| s12 | G | 1 | 4 | 4 | **0 of 2, dropped** | 0, 0 | 3,050, 2,650 | 0.04, 0.04 / n/a / n/a |

Ten settings go on. 24 runs, residual 0.

### Survivors, seeds 1 to 4, 200,000 steps (the gate)

"Full-template share" is the share of all gene-carrying molecules, whole arena, that carry every gene. The
four columns are single censuses (seeds 1 to 4 in order); "late" is pooled over the censuses of the last tenth.

| setting | seeds held | late compartments | full share at 2,000 | at 10,000 | at 50,000 | at 200,000 | late | gate |
|---|---|---|---|---|---|---|---|---|
| s01 | 4 of 4 | 56.9, 57.0, 57.2, 56.6 | 0.91, 0.91, 0.96, 0.87 | 0.88, 0.87, 0.91, 0.80 | 0.84, 0.96, 0.91, 0.80 | 0.77, 0.85, 0.87, 0.75 | 0.85 to 0.86 | **passes** |
| s02 | 4 of 4 | 57.0, 57.6, 56.9, 56.4 | 0.75, 0.93, 0.85, 0.89 | 0.82, 0.88, 0.76, 0.79 | 0.82, 0.84, 0.85, 0.72 | 0.83, 0.69, 0.86, 0.74 | 0.80 to 0.86 | **passes** |
| s03 | 4 of 4 | 41.5, 43.0, 42.6, 40.5 | 0.48, 0.67, 0.45, 0.44 | 0.58, 0.39, 0.52, 0.55 | 0.57, 0.56, 0.26, 0.59 | 0.52, 0.33, 0.50, 0.61 | 0.53 to 0.55 | **passes** |
| s04 | 4 of 4 | 41.5, 43.6, 42.7, 40.7 | 0.55, 0.63, 0.63, 0.46 | 0.53, 0.58, 0.49, 0.64 | 0.64, 0.63, 0.49, 0.45 | 0.50, 0.48, 0.37, 0.64 | 0.50 to 0.55 | **passes** |
| s05 | 4 of 4 | 53.1, 54.7, 56.2, 52.0 | 0.37, 0.38, 0.46, 0.70 | 0.56, 0.37, 0.42, 0.60 | 0.32, 0.55, 0.67, 0.37 | 0.46, 0.42, 0.33, 0.42 | 0.39 to 0.49 | **passes** |
| s06 | 4 of 4 | 55.2, 53.4, 54.1, 53.3 | 0.32, 0.42, 0.49, 0.68 | 0.41, 0.79, 0.52, 0.24 | 0.72, 0.52, 0.46, 0.48 | 0.41, 0.40, 0.73, 0.45 | 0.40 to 0.45 | **passes** |
| s08 | 2 of 4 | 0, 38.1, 0, 38.5 | 0.04, 0.09, 0.14, 0.01 | n/a, 0.00, n/a, 0.00 | n/a, 0.00, n/a, 0.00 | n/a, 0.00, n/a, 0.00 | 0.00 (two runs) | fails |
| s09 | 4 of 4 | 57.8, 56.8, 57.5, 57.1 | 0.95, 0.99, 0.96, 0.98 | 0.89, 0.74, 0.88, 0.80 | 0.90, 0.85, 0.94, 0.86 | 0.85, 0.88, 0.93, 0.82 | 0.88 to 0.89 | **passes** |
| s10 | 4 of 4 | 42.7, 44.8, 41.9, 43.7 | 0.53, 0.58, 0.62, 0.62 | 0.75, 0.65, 0.58, 0.49 | 0.42, 0.57, 0.49, 0.47 | 0.59, 0.48, 0.67, 0.43 | 0.58 to 0.62 | **passes** |
| s11 | 4 of 4 | 55.9, 52.6, 56.3, 50.2 | 0.58, 0.63, 0.29, 0.63 | 0.40, 0.41, 0.70, 0.60 | 0.61, 0.55, 0.32, 0.85 | 0.40, 0.52, 0.64, 0.35 | 0.39 to 0.50 | **passes** |

40 runs, residual 0. **Nine settings pass the gate** (s01 to s06, s09, s10, s11). s07, s08 and s12 are "not
viable without the parasite". s08 lost seeds 1 and 3 at step 2,600 and 4,400; its two held seeds hold next to
no full template from step 10,000 on (one or two molecules at a few censuses, at most 0.011% of molecules;
99% are single copies), so they are worlds of separate genes at 64 sites, at 38 compartments against the
unlinked control's 41.

Reading of the gate:

- **The first stop rule does not fire.** Linked four-gene templates are viable without the parasite at every
  listed rate under one site per molecule, and at breaking k = 1 under one site per gene.
- **No collapse through 200,000 steps.** On seeds 1 and 2, late compartments at 200,000 steps are within 6 of
  those at 50,000 in every passing setting (largest: s10 seed 2, 39.5 then 44.8). The full-template share at
  single censuses moves a good deal within a run (s01 seed 1: 0.91 at step 2,000, 0.77 at 200,000; s03 seed
  2: 0.67, then 0.33). Pooled over the last tenth of the run, it differs between the 50,000-step and the
  200,000-step run of the same setting and seed by -0.09 to +0.07, lower at the longer horizon in 9 of the 18
  pairs, higher in 8, equal in 1. So no decline shows in these runs; a slower one is not ruled out. The first
  screen's worlds at k = 7 ended by step 15,800; at k = 4 and below they do not end in 200,000 steps.
- **Breaking costs more than loss.** In family M, breaking at k = 4 against k = 1 takes late compartments from
  about 57 to about 42 and the full share from about 0.85 to about 0.53; loss at k = 4 against k = 1 changes
  neither. In family G, breaking at k = 4 ends the linked world (s07, s08, s12).
- **`linkJoin 1` against 0.05 changes little** (s09 against s01, s10 against s04, s11 against s05): late
  compartments within 2, late full share 3 to 8 points higher in family M and equal in family G.
- **How the family G worlds at breaking k = 4 ended** (six runs: s07 and s12 on seeds 1 and 2, s08 on seeds 1
  and 3): at the last census with a compartment, 99.4% to 100% of the molecules were single copies, and in
  five of the six one gene made up 91% to 100% of all gene copies in the arena (gene 0 twice, gene 3 twice,
  gene 2 once); in the sixth, genes 0 and 3 shared them and genes 1 and 2 had no copy. So these worlds ended
  as single copies of mostly one gene, which cannot make wall.

```bash
python3 experiments/dropgenes/linked2.py gate50
python3 experiments/dropgenes/linked2.py gate200     # run in three invocations, see "What was run and how"
```

## Step 3. The parasite screen

The nine settings that passed, linked, `GATED_PAR`, seeds 1 and 2, 50,000 steps. A dash where the run had ended
before the report row at step 2,000.

| setting | family | join | break k | loss k | seeds held | no compartment left at step (seed 1, seed 2) | compartments at step 2,000 | parasite share of all copies at step 2,000 | full-template share at step 2,000 |
|---|---|---|---|---|---|---|---|---|---|
| s01 | M | 0.05 | 1 | 1 | **0 of 2** | 12,650, 5,550 | 42, 16 | 0.20, 0.20 | 0.77, 0.46 |
| s02 | M | 0.05 | 1 | 4 | **0 of 2** | 10,900, 3,100 | 23, 16 | 0.29, 0.20 | 0.66, 0.46 |
| s03 | M | 0.05 | 4 | 1 | **0 of 2** | 5,750, 3,450 | 12, 13 | 0.23, 0.10 | 0.74, 0.55 |
| s04 | M | 0.05 | 4 | 4 | **0 of 2** | 3,450, 6,500 | 5, 12 | 0.05, 0.10 | 0.50, 0.62 |
| s05 | G | 0.05 | 1 | 1 | **0 of 2** | 1,700, 2,300 | -, 5 | -, 0.74 | -, 0.36 |
| s06 | G | 0.05 | 1 | 4 | **0 of 2** | 1,750, 2,400 | -, 4 | -, 0.88 | -, 0.97 |
| s09 | M | 1 | 1 | 1 | **0 of 2** | 14,100, 3,000 | 30, 19 | 0.14, 0.25 | 0.79, 0.48 |
| s10 | M | 1 | 4 | 4 | **0 of 2** | 1,500, 4,200 | -, 13 | -, 0.23 | -, 0.39 |
| s11 | G | 1 | 1 | 1 | **0 of 2** | 1,450, 2,300 | -, 7 | -, 0.78 | -, 0.34 |
| unlinked, 64 sites (step 0) | | | | | 0 of 4 | 11,600, 14,450 (seeds 3 and 4: 5,750, 15,200) | 35, 27 | 0.13, 0.17 | |

18 linked runs, residual 0. **Every setting lost seeds 1 and 2 and was dropped**; by the protocol seeds 3 and 4
were not run, and no setting went to 200,000 steps with the parasite. No run reached the late window.

**Stop rule: fired** (the second one). Settings passed the clean gate and none is held with the parasite on 3
of 4. The line ends negative, and it is a clean no for these nine settings. Steps 3.2, 3.3 and 4 of the
protocol (the 200,000-step check, the choice, the freeze) were not reached.

```bash
python3 experiments/dropgenes/linked2.py par50
```

## Labelled diagnostic, not a listed setting: `d-g0`

Family G with joining, breaking and loss all 0 (the first screen's `x00` under one site per gene at 64 sites),
linked founders, seeds 1 to 4, 50,000 steps. Pre-stated in PLAN.md; it can never be frozen. Made after the
gate's 200,000-step stage and the parasite screen (the plan said "after the 50,000-step stage of the gate";
it was queued behind them and no decision depends on it).

| arm | seeds held | late compartments | complete share | no compartment left at step | full-template share |
|---|---|---|---|---|---|
| `GATED_CLEAN` | 4 of 4 | 63.2 to 64.2 | 1.00 | none | 1.00 throughout |
| `GATED_PAR` | **0 of 4** | 0 | n/a | 2,050, 2,250, 2,200, 2,200 | 0.99 to 1.00 at step 2,000 |

So a four-gene template that cannot break, lose a gene on copy or be rejoined, under one site per gene at 64
sites, is carried well without the parasite (64 compartments against the unlinked 41) and is ended by the
parasite in about 2,200 steps on every seed, sooner than the unlinked arm (5,750 to 15,200). At step 2,000 the
parasite was 40% to 99% of all copies. The same diagnostic under one site per molecule is the first screen's
`x00`: without the parasite 2 of 2, with it 1 of 4, the three losses at step 10,850 to 37,200.

```bash
python3 experiments/dropgenes/linked2.py diag
```

## The two readouts

**1. Molecules by length.** In the tables above. The runs' files hold the counts at every census
(`lengths.byLength`); the summariser prints the shares at steps 2,000, 10,000, 50,000 and 200,000. What it
measured: at the first screen's rates short molecules came to dominate the arena's composition (its
CALIBRATION.md; whether they displaced full ones tile by tile was not measured, there or here). At these
rates, in the nine passing settings, they do not: short molecules stay a minority or about half, and full
templates are still 40% to 87% of molecules at step 200,000. Shares of
molecules carrying 1 / 2 / 3 / 4 genes at step 200,000, summed over the four seeds:

| setting | 1 gene | 2 | 3 | 4 (full) |
|---|---|---|---|---|
| s01 | 0.09 | 0.09 | 0.01 | 0.81 |
| s02 | 0.16 | 0.06 | 0.00 | 0.77 |
| s03 | 0.37 | 0.14 | 0.02 | 0.48 |
| s04 | 0.30 | 0.20 | 0.01 | 0.50 |
| s05 | 0.45 | 0.15 | 0.00 | 0.40 |
| s06 | 0.44 | 0.08 | 0.00 | 0.47 |
| s09 | 0.09 | 0.04 | 0.01 | 0.87 |
| s10 | 0.31 | 0.14 | 0.02 | 0.52 |
| s11 | 0.46 | 0.09 | 0.01 | 0.45 |
| s08 (two held seeds, failed the gate) | 0.99 | 0.01 | 0.00 | 0.00 |

Three-gene templates are rare everywhere (about 2% of molecules at most).

**2. Genes missing when a compartment ended.** Read from the observer, no kernel change. Shares are of the
compartments the tracker saw end; "missing" is at the compartment's last census, a gene counted wherever it
sits.

| runs | compartments that ended, per run | share with a gene missing at the last census, per run | of those, how many genes were missing (seeds pooled within a setting; ranges are over settings) |
|---|---|---|---|
| unlinked, 64 sites, clean, 200,000 | 7,403 to 7,515 | 0.19 to 0.20 | one gene in 93% |
| unlinked, 64 sites, parasite | 232 to 431 | 0.23 to 0.30 | one gene in 76% |
| linked, the nine passing settings, clean, 200,000 | 5,597 to 8,958 | 0.16 to 0.18 | all four in 20% to 64% (breaking k = 1 in family M: 61% to 64%; family G: 32% to 35%; breaking k = 4: 20% to 21%) |
| linked, the nine, parasite | 64 to 601 | 0.16 to 0.28 | all four in 53% to 88% |
| `d-g0`, clean | 679 to 707 | 0.18 to 0.20 | all four in 100% |

Per run, the "all four" share runs from 19% to 65% in the clean linked runs and from 50% to 100% in the
parasite ones.

In every arm, with or without the parasite, linked or not, 70% to 85% of the compartments that ended still
had every gene at their last census, 50 steps or less before they were gone. Of those that lacked a gene,
almost all lacked it at that one census only (seen missing at two censuses or more: 0% to 7%, one cell at
17%), and the median time from "first seen missing" to "gone" is one census interval everywhere. So most
compartments that ended were complete at the census before, and a gene was rarely seen missing for longer
than one census before the end. What happened inside the last 50 steps (whether a gene went first, and what
ended the wall) is not resolved by a 50-step census. Under one site per molecule at breaking k = 1 the
linked compartments that lacked a gene mostly lacked all four (61% to 64%); under one site per gene (32% to
35%) and at breaking k = 4 (20% to 21%) they mostly lacked fewer. A gene is missing from the linked
compartments no more often than from the unlinked. Compartment size at the end was not tabled.

**Which gene.** Compartments that ended, summed over the seeds run, and at how many of those ends each gene
was missing at the last census (one end can count for several genes). Counts only; no rule was attached.

| setting | arm, seeds | ended | with a gene missing | gene 0 | gene 1 | gene 2 | gene 3 | inner genes (1, 2) over outer (0, 3) |
|---|---|---|---|---|---|---|---|---|
| s01 | clean, 200,000 steps, seeds 1 to 4 | 22,798 | 4,044 | 3,272 | 3,662 | 3,651 | 3,251 | 1.12 |
| s02 | clean, 200,000 steps, seeds 1 to 4 | 22,830 | 3,888 | 3,106 | 3,538 | 3,542 | 3,129 | 1.14 |
| s03 | clean, 200,000 steps, seeds 1 to 4 | 35,434 | 6,315 | 3,711 | 5,224 | 5,236 | 3,729 | 1.41 |
| s04 | clean, 200,000 steps, seeds 1 to 4 | 35,593 | 6,238 | 3,730 | 5,114 | 5,097 | 3,615 | 1.39 |
| s05 | clean, 200,000 steps, seeds 1 to 4 | 25,950 | 4,512 | 3,032 | 3,981 | 3,957 | 3,052 | 1.30 |
| s06 | clean, 200,000 steps, seeds 1 to 4 | 26,711 | 4,670 | 3,090 | 4,057 | 4,069 | 3,082 | 1.32 |
| s09 | clean, 200,000 steps, seeds 1 to 4 | 22,442 | 3,887 | 3,199 | 3,573 | 3,574 | 3,155 | 1.12 |
| s10 | clean, 200,000 steps, seeds 1 to 4 | 34,860 | 6,276 | 3,775 | 5,174 | 5,240 | 3,766 | 1.38 |
| s11 | clean, 200,000 steps, seeds 1 to 4 | 26,242 | 4,509 | 3,065 | 3,971 | 3,939 | 2,992 | 1.31 |
| s08 (failed the gate) | clean, 200,000 steps, seeds 1 to 4 | 15,548 | 3,057 | 815 | 897 | 925 | 833 | 1.11 |
| unlinked, 64 sites | clean, 200,000 steps, seeds 1 to 4 | 29,883 | 5,886 | 1,542 | 1,578 | 1,557 | 1,654 | 0.98 |
| `d-g0` | clean, 50,000 steps, seeds 1 to 4 | 2,786 | 530 | 530 | 530 | 530 | 530 | 1.00 |
| s01 | parasite, seeds 1 and 2 | 682 | 123 | 112 | 117 | 119 | 112 | 1.05 |
| s02 | parasite, seeds 1 and 2 | 509 | 90 | 88 | 90 | 87 | 81 | 1.05 |
| s03 | parasite, seeds 1 and 2 | 264 | 48 | 37 | 40 | 42 | 37 | 1.11 |
| s04 | parasite, seeds 1 and 2 | 272 | 47 | 37 | 42 | 44 | 41 | 1.10 |
| s05 | parasite, seeds 1 and 2 | 168 | 39 | 37 | 38 | 38 | 34 | 1.07 |
| s06 | parasite, seeds 1 and 2 | 158 | 41 | 39 | 40 | 39 | 37 | 1.04 |
| s09 | parasite, seeds 1 and 2 | 725 | 135 | 122 | 129 | 128 | 124 | 1.04 |
| s10 | parasite, seeds 1 and 2 | 186 | 34 | 28 | 31 | 28 | 22 | 1.18 |
| s11 | parasite, seeds 1 and 2 | 163 | 38 | 33 | 34 | 37 | 34 | 1.06 |
| unlinked, 64 sites | parasite, seeds 1 to 4 | 1,430 | 376 | 134 | 148 | 116 | 84 | 1.21 |
| `d-g0` | parasite, seeds 1 to 4 | 339 | 62 | 60 | 61 | 61 | 60 | 1.02 |

No gene stands out with the parasite. Without it, in the linked worlds the two inner genes (1 and 2) are
missing at an end more often than the two outer ones, by 12% to 14% where breaking is at k = 1 under one site
per molecule, 30% to 32% under one site per gene, and 38% to 41% where breaking is at k = 4; the unlinked
world shows no such difference (0.98). Why was not measured.

For the runs that lost every compartment with the parasite, the last census that still had one: the arena
held at most 28 copies of each gene in 12 of the 18 linked runs, and 76 to 1,257 parasite copies in 17 of 18.
A compartment that was still complete was there in 14 of 18. So at that census the parasite outnumbered
every gene in most runs and the genes were mostly all still present; in what order they went after it is
not seen.

## What the numbers show

1. **The second stop rule fired.** Nine settings pass the clean gate at 200,000 steps; with the parasite each
   is held on 0 of 2 seeds at 50,000 steps. A clean no for these nine: linked K = 4, loss of k = 1 and k = 4
   (1.5e-5 and 6.1e-5), `linkJoin` 0.05 and 1, capacity matched for full templates, under one site per molecule
   at breaking k = 1 and k = 4 (s01 to s04, s09, s10) and under one site per gene at breaking k = 1 (s05, s06,
   s11). One site per gene at breaking k = 4 (s07, s08, s12) failed the clean gate and was never run with the
   parasite, so this result does not cover it. (Wording corrected 2026-11-22 after review of PR 183.)
2. **Below 1e-4 the linked genome is viable without the parasite.** This is new against the first screen and
   it removes that screen's confound. Under one site per molecule, worlds at k = 4 (the run files record
   `linkBreak` x 65536 = 4 exactly) are alive at 200,000 steps on four seeds, and the first screen's at k = 7
   (its `1e-4`, 6.55 rounded to 7) were gone by step 15,800 on two seeds. So something changes between k = 4
   and k = 7; k = 5 and 6 were not run, and whether it is a sharp threshold was not measured.
3. **Linking does not help against the parasite at matched capacity, and under one site per gene the linked
   worlds end sooner than the unlinked one** (all 10 family G runs with the parasite, `d-g0` included, ended by
   step 2,400; the earliest unlinked end is 5,750).
   The unlinked arm at 64 sites lasted to step 11,600 and 14,450 on seeds 1 and 2 (5,750 and 15,200 on seeds 3
   and 4). Family M at breaking k = 1 (s01, s02, s09) lasted to 10,900 to 14,100 on seed 1 and 3,000 to 5,550
   on seed 2; family M at breaking k = 4 to 1,500 to 6,500; family G to 1,450 to 2,400 at every rate, and to
   2,050 to 2,250 with the link rules off.
4. **Why, as far as these readouts go.** A parasite copy takes one site and copies at `2 * kRep`; a full
   four-gene template copies at `kRep / 4` and, under one site per gene, needs four free sites at once. Under
   family G the parasite is 74% to 88% of all copies at step 2,000 in the three listed runs that got that far
   (40% to 99% in `d-g0`). Under family M it is 5% to 29% there and the compartments thin out over thousands
   of steps, as in the unlinked arm (13% and 17%). Low breaking and loss rates
   do not change the 8-fold copy-rate gap per molecule between a full template and the parasite, which PLAN.md
   of the first screen stated as a cost.
5. **Capacity alone is not enough either** (step 0): 64 sites triples the unlinked arm's compartments without
   the parasite and does not hold four genes with it.

## Limits

- Seeds 1 and 2 only with the parasite, as the protocol says for a setting that loses both. Two seeds cannot
  rule out a setting that would hold on a minority of seeds; the rule asks for 3 of 4.
- No parasite run at 200,000 steps (no setting earned one).
- Rates: k = 1 and k = 4 only. k = 2, 3, 5 and 6 were not run. No rate between 0 and k = 1 exists without a
  kernel change; the diagnostics at 0 bound that range from below with 0 of 4 (family G) and 1 of 4 (family M,
  first screen), so a finer resolution is not a promising follow-up for the parasite question.
- One physics setting (`LARGE`), one parasite rate (`mutPar 1e-4`, the top of the first rung's grid), one arena
  size, K = 4 only. The first rung held K = 2 at this parasite rate; whether a lower parasite rate would give
  linking room to matter was not tested.
- The capacity match is exact under family G and for full templates only under family M (PLAN.md).
- The gate asks for held compartments, not for surviving templates; s08's two held seeds show the difference.
  It failed the gate on its count anyway.
- The death readout sees a compartment every 50 steps, about one template lifetime.
- Linked founders only; `linkJoin` 0.05 and 1 only.

## Not run

- Seeds 3 and 4 with the parasite for any setting; any parasite run at 200,000 steps (both by the drop rule).
- `step0-more`, K = 6 or 8 (step 0 gave 0 of 4).
- `d-g0` and `d-m0` at 200,000 steps (only if the first stop rule had fired).
- The repeat on seeds 5 to 8 and the K = 2 side checks (only for a chosen setting). No seed above 4 was used.
- Any ungated arm, any confirmation run, any seed 17 to 24.

## What was run and how

105 runs, residual 0 in every one, no failed or partial file: step 0 (12), replays (3), gate (24 + 40),
parasite screen (18), `d-g0` (8). About 7.6 core-hours of simulation by the runs' own timers (gate at 200,000
steps: 5.7; a run that lives takes 2 to 4 minutes at 50,000 steps and 8 to 11 minutes at 200,000 on this
machine under load), two simulations at a time.

Things that did not go to plan, none of which changed a decision:

- The first invocation of the gate's 200,000-step stage sat idle for 74 minutes because its guard against
  running more than two jobs also waited on other sessions' droplet runs, and was stopped by the two-hour
  limit of a background shell after s01 and s02. No file was lost or left partial. The rest ran as two shorter
  invocations.
- For that, a filter `LINKED2_ONLY` was added to the driver after the dated copy was taken (it limits which
  settings one invocation runs; eligibility is still computed from every setting). The driver in the dated
  copy differs from the final one by that filter only.
- `d-g0` was made after the parasite screen, not between the two stages of the gate.

```bash
python3 experiments/dropgenes/linked2.py list        # the settings with their exact --ov
python3 experiments/dropgenes/linked2.py table       # everything on disk, phase by phase
deno run -A --no-lock experiments/dropgenes/summarize.ts runs/dropgenes/linked2/gate-200k   # and the other phases
```

One setting's command, for example s01 at the gate (every other run is this with its own `--dir`, `--tag`,
`--caps`, `--seeds`, `--steps`, `--arms` and link keys, as `list` prints them):

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/linked2/gate-200k --genes 4 --caps 16 \
  --seeds 1,2,3,4 --steps 200000 --mutPar 1e-4 --jobs 2 --arms GATED_CLEAN --tag s01 --templates linked \
  --ov '{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44,"linked":true,"linkSites":"molecule","linkJoin":0.05,"linkBreak":1.52587890625e-05,"linkLoss":1.52587890625e-05}'
```
