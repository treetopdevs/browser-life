# Droplet genes, linked templates: calibration record

**Date:** 2026-11-21. Protocol: [PLAN.md](./PLAN.md), "Calibration protocol". Raw files:
`runs/dropgenes/linked/` in the line's worktree (not in git).

Nothing here is evidence. Every run is on seeds 1 to 8 (all seen for this world); no seed above 8 was run.

## Development runs before the list was fixed

These were made while the rules were being built, before the list below was written. None is linked K = 4
with the parasite at the run set-up (the arm the stop rule is about). They changed the design in two places,
and both changes are stated.

**D1. Do worlds of linked templates sustain themselves with no parasite?** 32 x 32 test world, three founder
spots, seed 5, 3,000 steps, no parasite, founders holding only full templates, no joining, breaking or loss
(a throwaway script, `runs/dropgenes/linked/smoke1.ts`, not in git: it builds the world as the unit tests'
`build()` does, with `seedLinked(2)` or `seedTemplates(2, 0.125, 0)`, and steps it).

| physics | K | site rule, sites per tile | wall at step 3,000 (tiles' worth) | full templates at step 3,000 |
|---|---|---|---|---|
| default | 2 | gene, 16 | 64 | 172 |
| default | 3 | gene, 16 | 0 (gone by step 1,000) | 0 |
| `LARGE` | 2 | gene, 16 | 104 | 242 |
| `LARGE` | 3 | gene, 16 | 0 (gone by step 1,000) | 0 |
| `LARGE` | 4 | gene, 16 | 0 (gone by step 500) | 0 |
| `LARGE` | 4 | unlinked, 16 | 47 | (710 single copies) |
| default | 3 | molecule, 16 | 85 | 334 |
| `LARGE` | 4 | molecule, 16 | 104 | 274 |
| `LARGE` | 4 | gene, 64 | 96 | 296 |
| default | 3 | gene, 48 | 85 | 415 |

Reading: with one site per gene and 16 sites per tile, full three-gene and four-gene templates cannot keep
themselves going even with no parasite, and the cause is the site arithmetic (the same worlds live at 48 or 64
sites, and at 16 sites with one site per molecule). **Design change 1:** the site rule was first built as one
site per gene only; after D1 the second rule (`linkSites: molecule`) was added as a stated setting, and both
are in the list.

**D2. Runner check.** 64 x 64, `LARGE`, K = 2, `GATED_PAR`, seed 1, 3,000 steps, unlinked: the edited
`run.ts` writes the same file as the first-rung `run.ts` apart from the two timing fields.

**D3. Linked K = 2 with no parasite, run set-up** (64 x 64, `LARGE`, 16 sites, gated, seed 1, 3,000 to 4,000
steps; `runs/dropgenes/linked/plumb/`). Compartments at the last report row:

| run | site rule | founders | join | break | loss | compartments | note |
|---|---|---|---|---|---|---|---|
| unlinked | | single | | | | 47 | |
| link_none | gene | linked | 0 | 0 | 0 | 57 | every template still full |
| link_none_singlefounders | gene | single | 0 | 0 | 0 | 47 | equal to the unlinked run, number for number |
| link_breakloss | gene | linked | 0 | 0.01 | 0.01 | 49 | no linked template left by step 1,000 |
| link_join (first join rule) | gene | linked | 0.2 | 0 | 0 | 57 | nothing to join |
| first join rule, all three | gene | linked | 0.2 | 0.01 | 0.01 | 4 at step 2,000 | collapse |
| first join rule, all three | molecule | linked | 0.2 | 0.01 | 0.01 | 3 | collapse |
| first join rule, join only | gene | single | 0.2 | 0 | 0 | 2 | collapse |
| first join rule, join and break | gene | linked | 0.2 | 0.01 | 0 | 6 | collapse |
| mass-action join, join only | gene | single | 0.2 | 0 | 0 | 16 | |
| mass-action join, join only | gene | single | 1 | 0 | 0 | 1 at step 2,000 | collapse |
| mass-action join, all three | gene | linked | 0.2 | 0.01 | 0.01 | 35 | |
| mass-action join, all three | molecule | linked | 0.2 | 0.01 | 0.01 | 43 | |

Reading: the first join rule made one attempt per tile per step between two molecules of the tile whatever
their number, so a molecule on a thinly filled rim tile joined fastest; joined templates copy at half rate and
cannot copy beside singles, and worlds holding singles collapsed. **Design change 2:** joining was rebuilt as
mass action (rule L7 in PLAN.md). With it, joining in a world that holds single copies is still a load (16
compartments against 47 at `linkJoin 0.2` with single founders; collapse at `linkJoin 1`), which is a property
of rule L3 (a joined template copies more slowly than its parts and the parts keep the free share below what
it needs), not of how pairs are drawn. Breaking at 0.01 per step turned a linked K = 2 world into a world of
single copies within 1,000 steps.

**After the code review, before any calibration run,** two details of rule L3 and L5 changed (review findings,
PLAN.md): the linked kinds on a tile are served in a shuffled order instead of a rotation by mask number, and
lossy copies are limited by their own cost in fuel and sites. D1 and D3 were made before those two changes
and were not repeated; D1 has one kind of template and no loss, so it is unaffected.

What these runs say in advance about the test: under `gene` at 16 sites the linked four-gene arm is expected
to die at the founders; shorter templates displace longer ones inside a compartment; joining does not rebuild
them against that.

## The 12 settings (fixed before any calibration run)

All: linked, K = 4, `GATED_PAR`, `LARGE` (16 sites), `mutPar 1e-4`, 64 x 64, seeds 1 to 4, 50,000 steps at the
screen. Rates are per the rules in PLAN.md. The kernel holds `linkBreak` and `linkLoss` as multiples of
1/65536: 1e-4 is 7/65536 (1.07e-4) and 1e-3 is 66/65536 (1.007e-3).

| setting | site rule | founders | `linkJoin` | `linkBreak` | `linkLoss` | why it is in the list |
|---|---|---|---|---|---|---|
| c01 | molecule | linked | 0.05 | 1e-4 | 1e-4 | stable templates, little joining |
| c02 | molecule | linked | 0.05 | 1e-4 | 1e-3 | more shortened copies |
| c03 | molecule | linked | 0.05 | 1e-3 | 1e-4 | more breaking |
| c04 | molecule | linked | 0.05 | 1e-3 | 1e-3 | both |
| c05 | molecule | linked | 1 | 1e-4 | 1e-4 | stable templates, pieces rejoin as fast as the rule allows |
| c06 | molecule | linked | 1 | 1e-4 | 1e-3 | |
| c07 | molecule | linked | 1 | 1e-3 | 1e-4 | |
| c08 | molecule | linked | 1 | 1e-3 | 1e-3 | |
| c09 | molecule | single | 1 | 1e-4 | 1e-4 | linked templates must arise from single copies |
| c10 | gene | linked | 0.05 | 1e-4 | 1e-4 | the strict site rule with stable templates (expected to die at the founders, D1) |
| c11 | gene | single | 1 | 1e-4 | 1e-4 | the strict site rule, templates arising from single copies |
| c12 | gene | single | 0.05 | 1e-3 | 1e-3 | the strict site rule, little joining |

## Results

### Side check made first: unlinked K = 4 `GATED_PAR`, seeds 1 to 4, 50,000 steps

The link keys absent, so this is the first-rung kernel (pinned). Held on **0 of 4**; no compartment left at
step 6,300, 7,850, 5,250 and 3,850 (seeds 1 to 4). A run stops once no wall is left, 100 to 150 steps after
its last compartment; "no compartment left" in this file is the earlier of the two. The first rung's
confirmation on seeds 5 to 8 lost this cell with the runs stopping between step 3,750 and 7,850 (its last
compartments went between step 3,650 and 7,700). Residual 0 in all four.

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/linked/side --genes 4 --caps 16 \
  --seeds 1,2,3,4 --steps 50000 --mutPar 1e-4 --jobs 2 --arms GATED_PAR --tag unlinked \
  --ov '{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44}'
```

### The screen: linked K = 4 `GATED_PAR`, 50,000 steps

**Held on 0 of 2 seeds at every one of the 12 settings.** Each setting lost seeds 1 and 2, so by the protocol
it was dropped and seeds 3 and 4 were not run. 24 runs, residual 0 in all. No run reached the late window: in
every one the last compartment was gone by step 3,550.

| setting | site rule | founders | join | break | loss | seeds held | no compartment left at step (seed 1, seed 2) | fissions seen (seed 1, seed 2) |
|---|---|---|---|---|---|---|---|---|
| c01 | molecule | linked | 0.05 | 1e-4 | 1e-4 | 0 of 2 | 1,850, 2,650 | 45, 72 |
| c02 | molecule | linked | 0.05 | 1e-4 | 1e-3 | 0 of 2 | 1,800, 3,550 | 43, 101 |
| c03 | molecule | linked | 0.05 | 1e-3 | 1e-4 | 0 of 2 | 2,150, 550 | 18, 16 |
| c04 | molecule | linked | 0.05 | 1e-3 | 1e-3 | 0 of 2 | 2,800, 750 | 22, 15 |
| c05 | molecule | linked | 1 | 1e-4 | 1e-4 | 0 of 2 | 2,050, 2,350 | 58, 63 |
| c06 | molecule | linked | 1 | 1e-4 | 1e-3 | 0 of 2 | 2,400, 2,450 | 47, 61 |
| c07 | molecule | linked | 1 | 1e-3 | 1e-4 | 0 of 2 | 600, 800 | 14, 19 |
| c08 | molecule | linked | 1 | 1e-3 | 1e-3 | 0 of 2 | 550, 800 | 14, 20 |
| c09 | molecule | single | 1 | 1e-4 | 1e-4 | 0 of 2 | 750, 650 | 17, 13 |
| c10 | gene | linked | 0.05 | 1e-4 | 1e-4 | 0 of 2 | 350, 600 | 2, 2 |
| c11 | gene | single | 1 | 1e-4 | 1e-4 | 0 of 2 | 650, 600 | 4, 5 |
| c12 | gene | single | 0.05 | 1e-3 | 1e-3 | 0 of 2 | 1,850, 3,500 | 24, 50 |

The unlinked arm on the same two seeds lost its last compartment at step 6,300 and 7,850 (side check above),
later than every linked run.

```bash
python3 experiments/dropgenes/linked_calib.py screen   # runs experiments/dropgenes/sweep.ts once per setting
```

For one setting the command it runs is, for example (c01, seeds 1 and 2). Every other row is the same command
with its own `--tag`, `--templates` (the founders column) and the four link keys in `--ov` (the site rule, join,
break and loss columns); the diagnostics below use `--arms GATED_CLEAN` and another `--dir`:

```bash
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/linked/calib --genes 4 --caps 16 \
  --seeds 1,2 --steps 50000 --mutPar 1e-4 --jobs 2 --arms GATED_PAR --tag c01 --templates linked \
  --ov '{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44,"linked":true,"linkSites":"molecule","linkJoin":0.05,"linkBreak":0.0001,"linkLoss":0.0001}'
```

**Stop rule: fired.** No setting is held on 3 of seeds 1 to 4, so the line ends negative. Steps 3 to 5 of the
protocol (choice, the 200,000-step check, the side checks of a frozen setting) were not reached. Nothing was
frozen and no confirmation is proposed.

### Diagnostics made after the stop rule fired

These do not change the outcome. They were made to read why the listed settings failed. Seeds 1 to 4 only,
50,000 steps, same run set-up. `x00` is **not a calibration setting**: it has joining, breaking and loss all at
0, which the design rules out (linked templates must arise and break by local rules), so it could not have
been frozen whatever it showed. It is one site per molecule, linked founders.

**G1. The same 12 settings without the parasite** (linked K = 4 `GATED_CLEAN`, seeds 1 and 2), and `x00`:

| setting | site rule | founders | join | break | loss | seeds held | no compartment left at step (seed 1, seed 2) |
|---|---|---|---|---|---|---|---|
| x00 | molecule | linked | 0 | 0 | 0 | **2 of 2** | none; late compartments 60.3 and 60.6, complete share 0.997 and 0.995 |
| c01 | molecule | linked | 0.05 | 1e-4 | 1e-4 | 0 of 2 | 8,950, 11,400 |
| c02 | molecule | linked | 0.05 | 1e-4 | 1e-3 | 0 of 2 | 8,200, 7,900 |
| c03 | molecule | linked | 0.05 | 1e-3 | 1e-4 | 0 of 2 | 900, 750 |
| c04 | molecule | linked | 0.05 | 1e-3 | 1e-3 | 0 of 2 | 700, 700 |
| c05 | molecule | linked | 1 | 1e-4 | 1e-4 | 0 of 2 | 11,400, 15,800 |
| c06 | molecule | linked | 1 | 1e-4 | 1e-3 | 0 of 2 | 13,200, 9,150 |
| c07 | molecule | linked | 1 | 1e-3 | 1e-4 | 0 of 2 | 600, 650 |
| c08 | molecule | linked | 1 | 1e-3 | 1e-3 | 0 of 2 | 600, 800 |
| c09 | molecule | single | 1 | 1e-4 | 1e-4 | 0 of 2 | 950, 700 |
| c10 | gene | linked | 0.05 | 1e-4 | 1e-4 | 0 of 2 | 350, 600 |
| c11 | gene | single | 1 | 1e-4 | 1e-4 | 0 of 2 | 500, 900 |
| c12 | gene | single | 0.05 | 1e-3 | 1e-3 | 0 of 2 | 8,100, 20,950 |

26 runs, residual 0 in all. Every listed setting loses its last compartment without the parasite too. The
unlinked arm on the same seeds and horizon (K = 4 `GATED_CLEAN`, seeds 1 and 2, 50,000 steps, made last, in
`runs/dropgenes/linked/side`): held on 2 of 2, late compartments 14.2 and 10.7, complete share 0.98. The
first rung held that cell on 4 of 4 seeds (5 to 8, 200,000 steps) at 11.9 to 13.6 compartments.

Template lengths in the c01 runs without the parasite at step 2,000 (molecules carrying 1, 2, 3, 4 genes,
whole arena): seed 1: 545, 238, 6, 520; seed 2: 896, 165, 82, 380. At `linkBreak 1e-4` a template breaks about
once in 9,400 steps and lasts about 50, so breaking alone supplies few short templates; by step 2,000 the
short ones outnumber the full ones.

**G2. `x00` with the parasite** (linked K = 4 `GATED_PAR`). Made in two steps: seeds 1 and 2 first (before
G1), then seeds 3 and 4 after seeing 1 of 2 held. So it is a thirteenth configuration run on the arm the stop
rule is about, after the rule had fired, with its seed count extended after a look. Held on **1 of 4**. Seed 1 held
(late mean 29.9 compartments, 0.99 complete, parasite 0.23 of all copies, 5% of linked templates shortened by
parasite origin). Seeds 2, 3 and 4 lost their last compartment at step 18,750, 10,850 and 37,200. Residual 0.

```bash
python3 experiments/dropgenes/linked_calib.py x00par    # x00, GATED_PAR, seeds 1 and 2
python3 experiments/dropgenes/linked_calib.py clean     # x00 and c01 to c12, GATED_CLEAN, seeds 1 and 2
deno run -A --no-lock experiments/dropgenes/sweep.ts --dir runs/dropgenes/linked/diag-gated_par --genes 4 --caps 16 \
  --seeds 1,2,3,4 --steps 50000 --mutPar 1e-4 --jobs 2 --arms GATED_PAR --tag x00 --templates linked \
  --ov '{"diffT":0.1,"diffW":0.03,"diffF":0.6,"diffA":0.44,"linked":true,"linkSites":"molecule","linkJoin":0,"linkBreak":0,"linkLoss":0}'
```

## What the numbers show

*Note, 2026-11-22 (review of PR 183), on PLAN.md L3: "matter grows `len` times more slowly" compares the rate per
unit of matter already present. At the nominal rates the template's copy rate is divided by `len` and each copy
adds `len` units, so the absolute matter added per step is the same as for one single gene; its growth per unit of
its own matter is `len` times lower. PLAN.md is frozen and is not edited.*

1. **The stop rule fired.** Linked K = 4 with the parasite was held gated on 0 of 2 seeds at each of the 12
   settings; the last compartment was gone between step 350 and 3,550. The unlinked arm on the same seeds
   lasted to step 6,300 and 7,850. Linking, as built and at these settings, made four genes last less long.
2. **The parasite is not needed for the listed settings to collapse.** Without it all 12 still lose every
   compartment on both seeds (G1). This does not show what ended the runs that had the parasite: at breaking 1e-4 they ended
   earlier than the runs without it (below), so an effect of the parasite on them is not excluded. (Wording corrected 2026-11-22 after review
   of PR 183; the numbers are unchanged.) With linked founders under one site per molecule (c01 to c08), breaking at 1e-3 ends the
   world at step 550 to 2,800 with the parasite and 600 to 900 without; breaking at 1e-4 ends it at 1,800 to
   3,550 with the parasite and 7,900 to 15,800 without.
3. **A four-gene template that cannot break, lose a gene on copy, or be joined is carried well without the
   parasite and not well enough with it.** `x00` without the parasite: 2 of 2 held, about 60 compartments
   (unlinked four genes on the same seeds: 14.2 and 10.7; the first rung's two genes: about 50). With the parasite: 1 of 4 held, the
   other three ending at step 10,850 to 37,200, later than the unlinked arm's 3,850 to 7,850 on seeds 1 to 4.
   This is under one site per molecule, which gives linked templates more gene copies per site (PLAN.md).
4. **One site per gene at 16 sites does not carry full templates at all** (D1, c10: gone by step 600 with or
   without the parasite).

A reading that fits and was not measured directly: under rule L3 a shorter template copies faster and can
grow at a lower share of free sites (0.1 for one gene, 0.2 for two, 0.4 for four), so inside a compartment
short templates take the sites and full ones stop copying. Breaking, lossy copying and parasite origin all
make short templates. A compartment whose short templates do not cover every gene stops making wall. Joining
puts genes back into the slow form and does not reverse this (D3). Which genes were lost first, and whether
compartments ended by losing a gene or by losing wall for another reason, was not recorded.

## Limits

- The listed settings were run on seeds 1 and 2 only, as the protocol says for a setting that loses both.
- Breaking and loss rates below 1e-4 were not in the list. The diagnostic with all three rules at 0 bounds
  them from below: 1 of 4 with the parasite at 50,000 steps. No rate between 0 and 1e-4 was run.
- One physics setting (`LARGE`, 16 sites), one parasite rate (`mutPar 1e-4`, the top of the first rung's
  grid), one arena size, 50,000 steps. No run at 200,000 steps was made.
- Not run, because nothing was frozen: linked K = 2, any ungated linked arm, K = 6 or 8.
- The development runs D1 and D3 are single seeds of at most 4,000 steps, and D3 predates two small rule
  changes (noted above).
- Joining is one rule of several possible; the first version of it was replaced after D3 (design change 2).
- Run time: the 24 screen runs took 2 to 18 seconds each. The 60 recorded runs (screen, side checks, G1, G2)
  took about 0.4 core-hours together; the development runs a few minutes more.

