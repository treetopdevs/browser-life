# Droplet genes, linked templates: rules, calibration protocol and pass rule

**Date:** 2026-11-21. **Branch:** `claude/dropgenes-linked` from `c60d2e5a` (main plus the droplet-genes sandbox).
**First rung:** [../droplet-genes-2026-11-21/PLAN.md](../droplet-genes-2026-11-21/PLAN.md) and its `RESULTS.md`.
**Calibration record:** [CALIBRATION.md](./CALIBRATION.md).

Sandbox only. Changes are in `apps/lab/src/dropgenes/` and `experiments/dropgenes/`; nothing in `packages/`, no
`RULE_VERSION` change, CPU reference only.

## Outcome (2026-11-21)

**The line ended negative under the stop rule.** Linked K = 4 with the parasite was held gated on 0 of 2 seeds
at each of the 12 calibration settings (the last compartment gone by step 3,550 in all 24 runs), so no setting
could reach 3 of seeds 1 to 4. Nothing was frozen, no confirmation is proposed, and no seed above 8 was run.
The record, the diagnostics made afterwards and the limits are in [CALIBRATION.md](./CALIBRATION.md). The
pass rule at the end of this file was written before the screen and was never used.

## Question

The first rung found that at the `LARGE` setting a compartment holds two genes with the parasite present and
not four. The reason given was that sites are shared, so copies per gene fall as 1/K, and each gene is dealt
out separately at fission.

**Do linked genes (one template molecule that carries several genes and is copied and dealt out as a unit) let
a compartment hold more genes with the parasite present than separate genes do?**

## Rules as built

Rules 1 to 6 of the first rung are unchanged. With `linked` absent or false the kernel is the first-rung kernel
bit for bit (three state digests pinned at `c60d2e5a` before the kernel was edited:
`apps/lab/test/dropgenes-linked-pins.test.ts`). With `linked: true`, `A`, `F`, `W` and `T` follow the first-rung
kernel bit for bit for as long as the world holds no linked molecule (tested with joining off; with joining on
they do until the first join succeeds). The state digest of a linked world is another number, because it also
covers the `L` array. So the unlinked arm and the linked arm differ only in the rules below.

A **linked template** is one molecule carrying a set of two or more genes (a bitmask; each gene at most once).
Write `len` for the number of genes it carries. State: `L[tile][mask]` molecules, beside the first rung's
`T[tile][K + 1]` single copies and parasite. At most 8 genes when linking is on.

- **L1. Matter.** One molecule holds `len` units of matter. All matter is conserved:
  `A + F + W + sum T + sum len * L` never changes.
- **L2. Decay.** A linked molecule decays at `kDecT` per step, as a single copy does, and returns `len` units
  of `A`.
- **L3. Copying.** A linked molecule is copied at `(kRep / len) * free / sites` per step, and each copy is made
  from `len` units of fuel. So one molecule takes up fuel at the rate a single gene does, and its matter grows
  `len` times more slowly than a single gene's. The rate division is rounded down. Singles and the parasite
  copy exactly as in the first rung. Whether the singles or the linked templates of a tile are served first in
  a step is one hash bit, and the linked kinds present on the tile are served in a hashed random order (a
  shuffle, so a kind's place does not depend on its mask number; the orders are equally likely up to the
  modulo bias of a 32-bit hash).
- **L4. Sites** (`linkSites`, a setting: see "The site rule" below). Under `gene` a linked molecule takes `len`
  of the tile's template sites and a copy needs `len` free sites. Under `molecule` it takes one site whatever
  its length and a copy needs one free site. Sites are one shared pool with the singles and the parasite in
  both.
- **L5. Gene loss on copy** (`linkLoss`). With chance `linkLoss` a new copy is made without one of the genes
  (chosen by hash): a template of `len - 1` genes, made from `len - 1` units of fuel. It copies faster than its
  parent (L3). This is the linked genome's own parasite. A two-gene template that loses a gene leaves a single
  copy. Which copies are lossy is settled before the limits of fuel and free sites are applied, and each copy
  is limited at its own cost; whether a kind's whole or lossy copies are served first is one hash bit.
- **L6. Breaking** (`linkBreak`). Each linked molecule breaks with chance `linkBreak` per step into two pieces,
  between two genes that are neighbours in gene order (cut point by hash). No matter moves.
- **L7. Joining** (`linkJoin`). With chance `linkJoin` per tile per step, two different slots are drawn by hash
  from the tile's `capPerTile` slots; the tile's gene-carrying molecules fill the first slots. If both slots
  hold a molecule and the two share no gene, they become one molecule with both gene sets. Mass action: a
  tile with few molecules joins rarely. A tile that holds more molecules than `capPerTile` (hops and breaks
  can overfill one) draws from as many slots as it has molecules, so there every draw finds two molecules. The
  parasite never joins. No fuel is used.
- **L8. Function.** Rule 4 counts a gene wherever it sits: single copies plus linked templates that carry it,
  over the 3 x 3 patch.
- **L9. Parasite origin.** Rule 5 is the same event at the same rate per tile, with the gene chosen among the
  genes present on the tile in any form. The carrier is then chosen by hash among all molecules on the tile
  that carry that gene. A single copy becomes a parasite copy; a linked template loses that gene (it becomes
  the template of the rest) and one parasite copy is added. The free parasite itself is unchanged: one unit,
  one site, copies at `2 * kRep`, never linked.
- **L10. Movement.** Rule 6 per molecule: the same hop rate, gate and one-neighbour rule as a single copy.

What is not free and what is:

- Matter, fuel, decay and movement: no advantage per unit of matter or per molecule.
- Copy rate: a full four-gene template copies at a quarter of a single gene's rate. Against the parasite
  (`2 * kRep`, one unit) that is an 8-fold disadvantage per molecule where an unlinked gene has 2-fold. A
  template needs a free-site share above `len * kDecT / kRep` to grow (0.4 for four genes at the frozen rates;
  0.1 for a single gene; 0.05 for the parasite).
- Joining costs no fuel and, under `molecule`, frees a site.
- **Under `linkSites: molecule` a tile's sites hold up to `len` times more gene copies when they are linked.**
  That is a stated advantage in sites (not in matter, fuel or rate), and it removes the 1/K sharing of sites by
  construction. See the next section.

## The site rule

The brief leaves the number of sites to this design. Both answers are built and both are in the calibration
list:

- `gene` (sites count matter) is the stricter reading of "no free lunch". Development runs with no parasite
  (CALIBRATION.md, D1) showed that at 16 sites per tile founders holding only full three-gene or four-gene
  templates die within 500 steps: a copy needs `len` free sites at once and a free share above 0.3 or 0.4, and
  a tile whose wall is below 0.5 has fewer than 8 sites. At 64 sites the same world lives. So under `gene` at
  `LARGE` (16 sites) the linked four-gene genome is not viable even without the parasite.
- `molecule` (a site binds one molecule) makes the linked genome viable at 16 sites. It also gives the linked
  arm more gene copies per site, so a pass under `molecule` cannot by itself separate "copied and dealt out as
  a unit" from "more gene copies fit". The confirmation therefore carries a control for capacity (below).

## Arms and readouts

Arms as in the first rung: `GATED_PAR`, `GATED_CLEAN`, `UNGATED_PAR`, `UNGATED_CLEAN`. The **unlinked** arm is
the same kernel with the link keys absent. Founders: a 4 x 4 grid of spots, two copies of every gene on every
wall tile; in the linked arm as two full templates (the same matter), unless a setting says single copies.

Readouts: everything in the first rung, with a gene counted wherever it sits (the tracker is given per-tile
gene copies, single plus linked, so "complete", copies per compartment and the parasite share are in units of
matter). **Held** is unchanged: over the last tenth of the run a mean of at least 10 compartments, at least half
of them carrying every gene; a cell is held at 3 of 4 seeds. Added, over the whole arena, pooled over the
censuses of the last tenth:

- the share of each gene's copies that sit in linked templates;
- the mean number of genes per gene-carrying template molecule (a single copy counts 1);
- the share of linked templates that are shortened (carry fewer than all K genes);
- the share of all gene-carrying molecules that carry every gene, and the count of molecules by length.

## Calibration protocol (fixed before the first calibration run)

All at `LARGE` exactly as the first rung froze it: `diffT 0.1`, `diffW 0.03`, `diffF 0.6`, `diffA 0.44`, 16 sites
per tile, `mutPar 1e-4`, everything else `defaultDropGenesConfig()`. Only link keys and the founders' form vary.
Seeds 1 to 4 only. No seed above 8 is run by this line.

1. **Screen:** each of the 12 settings in CALIBRATION.md, linked, K = 4, `GATED_PAR`, 50,000 steps (the first
   rung's calibration horizon), held judged by the rule above at that horizon. Seeds 1 and 2 first; a setting
   with neither held is dropped (it cannot reach 3 of 4). Otherwise seed 3; a setting that has lost two seeds
   is dropped; otherwise seed 4.
2. **Stop rule:** if no setting is held on at least 3 of seeds 1 to 4 at the screen, the line ends negative.
3. **Choice:** among the settings held on at least 3 of 4, the one held on most seeds; ties by the higher mean
   of late compartments over its seeds, then by the lower number in the list.
4. **Check at the confirmation horizon:** the chosen setting, linked K = 4 `GATED_PAR`, seeds 1 to 4, 200,000
   steps. If it is held on fewer than 3 of 4 there, the next setting by rule 3 is checked the same way. At most
   two settings are checked. If neither is held on 3 of 4 at 200,000 steps the line ends negative.
5. **Side checks of the frozen setting**, seeds 1 to 4, 50,000 steps, none of which can change the choice:
   linked K = 4 `GATED_CLEAN`; linked K = 2 `GATED_PAR` and `GATED_CLEAN`; unlinked K = 4 `GATED_PAR`.
   If linked K = 2 `GATED_PAR` is not held on 3 of 4 the write-up says that linking breaks what the first rung
   held.
6. **Not run in calibration:** any ungated arm with the parasite and linking on, and anything on a seed
   above 8.

## Pass rule for the confirmation (unseen seeds 17 to 24, 200,000 steps, 64 x 64)

Written before any confirmation run; the frozen setting and the exact commands are added below once
calibration has chosen it.

Seeds, fixed now: **the rule is decided on seeds 17, 18, 19 and 20**, the same four for every arm and control.
Seeds 21, 22, 23 and 24 are a second block of four, run on the same arms and judged by the same rule, and
reported beside the first as a repeat. The verdict is the first block's. If the second block gives another
verdict the result says "not repeated" and reports both. Every "of 4" below is within one block.

- **Pass:** linked K = 4 `GATED_PAR` is held on at least 3 of 4 unseen seeds, and unlinked K = 4 `GATED_PAR`
  is held on at most 1 of 4.
- **The compartment is the cause** only if, as well, linked K = 4 `UNGATED_PAR` is held on at most 1 of 4 and
  linked K = 4 `UNGATED_CLEAN` is held on at least 3 of 4 (so ungating alone does not kill the linked world).
  `UNGATED_CLEAN` is not in the arm list this line was given; it is proposed here as four more runs, because
  without it a failure of the ungated linked arm cannot be told from dilution. If linked `UNGATED_PAR` is held
  on 3 of 4, linking holds the genes without a closed compartment and the result says so.
- **Linking, not capacity** (only if the frozen setting uses `linkSites: molecule`): unlinked K = 4
  `GATED_PAR` at 64 sites per tile (the gene copies a tile's 16 sites hold as full four-gene templates) is held
  on at most 1 of 4. If it is held, more room for gene copies is enough and the result says that linking was
  not shown to matter. Proposed as four more runs.
- **Linking does not break the first rung:** linked K = 2 `GATED_PAR` held on at least 3 of 4.
- Also run and reported, no rule attached: linked and unlinked K = 4 `GATED_CLEAN`.
- K = 6 and K = 8 are run only after a pass, as a ladder, not as part of the rule.
