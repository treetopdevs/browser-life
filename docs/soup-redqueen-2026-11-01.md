# Red Queen for copiers (2026-11-01)

Step 2 of the papers plan ([mlst-evolution-papers-2026-10-31.md](mlst-evolution-papers-2026-10-31.md), "Red Queen for copiers"). It follows the post-takeover test: [run 1](soup-evolution-2026-10-31.md) and [the sharper rerun](soup-evolution-rerun-2026-10-31.md).

**Status: FROZEN 2026-11-01**, before the hall pilot or any Red Queen race ran. Nothing here had run except timing and GPU checks (under GPU rules and Compute). Any change after that goes in a dated amendment section above the readout, and names what it changes.

**What was known when.** The first draft was written before the rerun's results were seen. The rerun finished during the second and third reviews, and its readout was written before this freeze. Its results did not change the design: the competitors, panel, race design and tests were all fixed in the first two drafts; the changes since are the GPU rules, robustness fixes and wording. Run 1's results were known throughout; the competitors and pilot pairs come from them.

## The question

Run 1 found turnover in every lineage but could not show that later copiers beat earlier ones. "Copiers keep replacing each other" has two readings:
- **Accumulating.** Later copiers are better in general, so they would also beat strangers.
- **Red Queen turnover.** Each copier beats the one before it, at home, but gains nothing that carries over.

The Digital Red Queen paper (Kumar et al., arXiv 2601.03335) separates these in Core War with two tools. One is *generality*: how a warrior does against a fixed, held-out set of opponents. The other is *history*: selecting against every past champion instead of only the current one, which made warriors more general there. This test uses both, with no LLM:

- **Part A, held-out generality.** Do later leaders do better against copiers from soups they never met?
- **Part B, convergence (exploratory).** Do the four independent soups drift toward similar copiers?
- **Part C, hall-of-fame soups.** If a soup keeps having every past leader planted back, do its leaders end up more general than in a soup given the same dose of its current leader?

## Shared pieces

### The panel

The held-out opponents are the first and the last run-1 competitor of each lineage, in `runs/soup/evo/plan.json` order, with the representative forms frozen there:

| lineage | first | last |
|---|---|---|
| wm2 | e858e219 | b25d3a1b |
| wm6 | bd6f64ad | 55e27793 |
| wm8 | ee84be12 | b7dcde0d |
| g1 | d9daa193 | 3ec8492f |

`tools/soup-rq.ts plan` writes these eight with their exact forms to `runs/soup/rq/panel.json`. A copier from lineage X faces the six panel members of the other three lineages, never its own.

g1's copiers evolved on a grid. Every race here is well-mixed, so g1's copiers play away from home. That is reported, not corrected.

### Players and races

A **player** is a type id with exact forms (its representative, and mirror if any). Players are told apart by their forms: two players with the same type id but different forms are different players. A race job's id names both players by a hash of their forms, the rare side and the seed, so identical forms always get identical races, and only then are races shared.

A race is the rerun's fallback race, which its pilot chose (1,024 epochs gave wm8 too many unrelated programs):
- Well-mixed, 16,384 programs, paper mutation rate, the rare player at 2,048 (12.5%), 512 epochs, f recorded every 64.
- 8 seeds per direction, seeds 401–408. The soup seed is fnv(job id).
- Classification, f and the invalid-run rule are as in run 1, at 512.
- The pair outcome is the rerun's: the exact two-sided permutation test on D at p < 0.01, failed below 75% valid in either direction (6 of 8), coexist when every valid run in both directions ends above 0.125, the same tie allowance.
- The null of that test is that the two directions' runs are exchangeable (no difference between them in distribution). "A beats B" means A's rare-start runs end with a larger f than B's, beyond that null. It is not a claim about a mean advantage alone.
- 8 seeds, not 16: copiers from different soups should differ more than relatives, so their races should resolve more easily. This is a guess made before any cross-lineage race. If it is wrong, it shows up as many unresolved races and is reported as a limit; no seeds are added afterwards.

Races run on the GPU or the CPU, with the same result either way. The GPU can silently drop work (see GPU rules below), so a GPU race steps in checked batches that are redone when work was dropped; `tests/deno/soup_gpu.ts` checks a GPU race against the CPU race.

### GPU rules

Found while drafting this test (2026-11-01; also recorded in the rerun's readout):
- **The defect.** On this Mac, the GPU soup can silently drop work: some pairs in an epoch don't finish, with no error. Two GPU processes at once almost always trigger it; a single process sometimes does too. Two soups inside one process were exact.
- **Rule 1: one GPU process at a time.** `tools/soup/device.ts` takes a machine-wide lock before handing out a device; a second process waits.
- **Rule 2: every GPU step is checked.** Each pair adds to a done counter when it finishes. After each batch of at most 64 epochs the count must be exactly epochs × pairs; otherwise the batch is undone from the copy taken before it and run again, up to 20 times, then the run stops with an error. A run never continues on a short batch.
- **Checked.** Two deliberately competing processes without the lock: one redid 17 batches and ended byte-identical to the solo run, with the CPU's instruction counts. The other kept being starved and stopped with the error, as designed.
- Hall runs record how many batches were redone (`gpuBatchesRedone`).

### Score against the panel

For a player C and its six panel opponents:
- wins, losses, others (coexist or unresolved) and failed, out of 6.
- **net(C) = (wins − losses) / 6.** The denominator stays 6, so a failed race counts as neither, and C is never scored against fewer opponents.
- net can rise through fewer losses alone, so wins and losses are always reported next to it.
- **Failed-race check.** Each verdict below is also computed with failed races filled in two other ways, given under Part A and C1. If the verdict differs between these, it becomes **INSUFFICIENT (failed races)**. For Part A this is a sensitivity check, not a bound: failures filled in mixed ways could still move the verdict.

## Part A: held-out generality

**Who.** All 24 run-1 competitors (wm2 4, wm6 6, wm8 7, g1 7), in run 1's sustained first-lead order, each against its six panel opponents, with the forms frozen in run 1.

**Per lineage.** ρ_X = Spearman correlation between competitor order (1, 2, …) and net, with average ranks for ties. If every net in a lineage is equal, ρ_X = 0.

**Pooled.** T = Σ ρ_X over the four lineages. Null: competitor order is a random labelling within each lineage, shuffled independently. p is two-sided, the share of shuffles with |T'| ≥ |T| (same tie allowance). There are 4!·6!·7!·7! joint shuffles, so p comes from 200,000 random ones with generator seed 1, p = (hits + 1) / 200,001.

The scores are fixed and only the order labels move, so coupling between scores (a race between two panel members feeds both their scores) does not break the shuffle. But a shuffle null treats order as uninformative, and drift alone can give a lineage a trend: successive leaders are relatives, and a random walk in generality looks like a trend. So this test asks only whether later leaders are more general *than a random ordering of the same leaders would be*. It cannot by itself tell selection from drift; Part C is the test of a mechanism.

**Verdict.**
- **LATER MORE GENERAL** if T > 0 and p < 0.05.
- **LATER LESS GENERAL** if T < 0 and p < 0.05.
- **NOT SHOWN** otherwise. This is inconclusive, not evidence of no gain: there is no equivalence margin.
- **INCOMPLETE** if any Part A race has no result file.
- **INSUFFICIENT (failed races)** if the verdict differs when every failed race is counted as a win for both of its players' scores, or as a loss for both.

Per-lineage ρ, wins and losses are reported; they have no verdicts of their own.

**Reading it with the rerun** (its within-lineage verdicts, as frozen there). Interpretation only; each test keeps its own verdict, and the two may concern different lineages:

| rerun: later beats earlier at home | Part A | reading |
|---|---|---|
| ADAPTIVE | LATER MORE GENERAL | consistent with improvement that carries over |
| ADAPTIVE | NOT SHOWN | consistent with Red Queen turnover, not shown to be it |
| no direction | NOT SHOWN | nothing shown either way |
| no direction | LATER MORE GENERAL | a general gain the home races did not see |

## Part B: convergence (exploratory)

From run 1's census snapshots:
- **Times:** Δ = 0, 2,048, 4,096, … epochs after each lineage's start (`from` in run 1's plan), up to the shortest lineage's end. At each Δ, each lineage's sustained leader at its last snapshot at or before from + Δ, using run 1's sustained-leader rule over that lineage's snapshots.
- **Distance:** for leaders x and y, (d_x(y) / symbols_x + d_y(x) / symbols_y) / 2, where d_x(y) is TypeRef distance from y's representative to x's forms. This is symmetric, 0 for identical keys.
- **Reported:** a table of the six lineage-pair distances at each Δ, and each pair's Spearman ρ against Δ (from unrounded distances, at least 3 points). Distances above 1 mean the keys share almost nothing.

No verdict and no p. Repeated leaders make the points dependent. Labelled exploratory everywhere it appears.

## Part C: hall-of-fame soups

### Runs

- **Branch points.** The three well-mixed lineages, from the snapshot each run-1 lineage starts at: wm2 at 12,609, wm6 at 4,609, wm8 at 3,265 (131,072 programs, `runs/soup/noheads/seed-{2,6,8}/soup-<epoch>.bin`). g1 is left out: planting on a grid needs its own spatial rule.
- **Arms.** HALL and CTRL, below. Each lineage gets 3 runs per arm.
- **Soup seeds** are distinct for every run, so runs share no random stream: wm2 HALL 2501–2503, CTRL 2511–2513; wm6 HALL 6501–6503, CTRL 6511–6513; wm8 HALL 8501–8503, CTRL 8511–8513. Run k of HALL is paired with run k of CTRL only for the analysis.
- **Length.** 16,384 epochs past the branch point, 32 intervals of 512, on the GPU under the GPU rules. All 18 runs share one process, 3 at a time.

Runs of one lineage share their starting population, so the 9 pairs are 3 lineages × 3, not 9 independent soups.

### Each interval

At the end of each interval, in this order:
1. **Census.** Types as in run 1. Copy tests run only on types with share ≥ 0.5%, at most 16, largest first. The census leader is the largest tested type with selfRep ≥ 48 (run 1's copier mark), or none.
2. **Sustained leader.** As in run 1, by exact type id: the sustained leader changes to a type when it is the census leader at two consecutive censuses. At the branch point it is the branch snapshot's census leader.
3. **History.** Each run keeps every type id that has been its sustained leader, in the order they first became it. A type's forms are frozen at the census where it first became sustained leader (the second of the two), from that census's representative and mirror. A type that leads again keeps its first forms.
4. **Planting** (not after the last census). The dose is fixed: **4 groups of P copies every interval**, in every arm. Slots are drawn without replacement by a generator keyed on (soup seed, epoch); group g takes the next P slots, with its forms alternating, as in races. Planting happens after the census, before the next interval runs.

### Arms

- **HALL.** The past list is the history without the current sustained leader, in history order. If it is empty, all 4 groups are the current leader. Otherwise the 4 groups are the next 4 entries in a round-robin over the past list: a counter c starts at 0; group j is past[(c + j) mod m] with m the past list's length; then c increases by 4. So every past leader keeps coming back, however long the history.
- **CTRL.** All 4 groups are the current sustained leader. The same dose, with no history.

HALL and CTRL plant the same number of programs at every interval. They differ only in what the planted programs are. CTRL's planting of its own leader may slow its turnover; that is part of what "no history" means here, and is a limit.

**No-planting reference.** Run 1's own continuation from the same snapshot is an unplanted run of each lineage. Its sustained leader at branch + 16,384 is reported next to the arms, with its Part A score. This is descriptive, one run per lineage, and has no verdict.

### Plant size P: pilot

P must be large enough that a better past leader can come back from a planting, and small enough that 4P is not most of the soup.
- **Candidates:** P = 256 (4P = 0.8% per interval) and P = 1,024 (3.1%).
- **Pilot pairs** (resolved in run 1; winner over loser): wm2 989bcdcb over e858e219 (D = −0.39) and wm6 a240625b over bd6f64ad (D = −0.18), with run 1's frozen forms.
- **Pilot run:** a 131,072-program soup filled with the loser's forms (alternating), P winner copies planted at epoch 0 by the planting generator, 512 epochs on the GPU, seeds 951–952. That is 4 runs per candidate.
- **Counting:** the race classification with the winner as the rare side and the loser as the common side (strictly nearer type, within its radius). At epoch 0 the winner count must be exactly P; otherwise the pilot code is wrong and nothing proceeds. A run passes when the winner count at 512 is at least 2P and the run is valid by the race rule (no third copier type outnumbering both).
- **Go rule:** P is the smaller candidate for which all 4 runs pass. If neither passes, P = 2,048 by the same rule (4P = 6.25%). If that fails too, Part C stops and is reported as "planting cannot bite at a usable size"; Parts A and B still run.

The pilot plants one invader into a soup of one resident. In the hall soups each planted group is one invader among many types, so the pilot is a lower bound on what a planting needs, not a guarantee that it works.

### Endpoints

The **final leader** of a run is its sustained leader after the last census, with its frozen forms. Its share of the final soup is reported, counted over every type; if it is below 0.5%, the run is flagged "final leader rare", and still scored.

- **C1 (primary): does history make leaders more general?** For pair k of lineage X: d = net(HALL final) − net(CTRL final), each against the six panel opponents outside X. d = 0 when the two finals have identical forms (then their races are the same), and also when two different finals happen to score the same; both count as zero for the rule below.
  - Test: exact two-sided sign-flip permutation on mean d over all 2⁹ sign patterns (same tie allowance). The runs use independent seeds, so under "the arm does not change the distribution of net", each d is symmetric about 0 and independent of the others given its branch point.
  - **INSUFFICIENT EVIDENCE** if fewer than 6 of the 9 d are non-zero: below that, no sign pattern can reach p < 0.05.
  - **HISTORY MAKES MORE GENERAL** if mean d > 0 and p < 0.05; **HISTORY MAKES LESS GENERAL** if mean d < 0 and p < 0.05; **NO DIFFERENCE SHOWN** otherwise (inconclusive, as for Part A).
  - **INCOMPLETE** if any C1 race or run is missing (C2's races do not count for this); **NOT RUN** if the pilot stopped Part C; **INVALID** if any hall run used a P other than the pilot's.
  - **INSUFFICIENT (failed races)** if the verdict differs between d as is, d at its lowest (HALL's failed races counted as losses and CTRL's as wins), and d at its highest (the reverse). These are each pair's extremes.
- **C2 (secondary): head to head.** HALL final against CTRL final of the same pair, as a race. Reported as counts of HALL wins, CTRL wins, others (coexist, unresolved or failed) and pairs with identical forms, with its own completeness.
- **Descriptive, per run:** sustained leader changes, history size, whether the final leader became leader by coming back (its last change was to a type already in the history), total programs planted, and at each census copier share, type diversity (run 1's Shannon diversity over keyed programs), types above 0.1% and distinct programs. The papers plan warns that Red Queen pressure can cut diversity; this records whether it does here.

## Compute

Timing checks, the only things run before freezing:
- **Races.** One rerun race replayed on the GPU took 12 s, against about 300 s on the CPU, with the same final counts as the saved CPU result. Eight GPU races in one process took 118 s, no faster than one after another.
- **Hall soups.** Smoke runs in the scratchpad (not the pilot) took 70–110 s per interval. They ran two GPU processes at once, which is how the GPU defect was found, so their timing is only a rough guide.

Budget:
- **Races:** Part A has 120 distinct pairs (24 players × 6 opponents, minus the 24 panel-against-panel pairs counted twice). Part C adds up to 108 more (18 finals × 6) and 9 head-to-head pairs. Each pair is 16 races: up to about 3,800 races. One GPU worker does about 300 an hour and 7 CPU workers about 84, so roughly 10 hours of race time in all.
- **Hall soups:** 18 runs × 16,384 epochs in one GPU process, about 6–8 hours.
- **Order:** Part A's races first (GPU and CPU workers sharing one list through lock files that hold each worker's process id, so a dead worker's lock is taken over and each race runs once). Part A is analysed as soon as its races are done. Then the hall pilot, the hall soups, Part C's races and the full analysis. Roughly 16–20 hours, local only, no paid compute.

## Not claimed

- Generality here means against six copiers from three other soups, in well-mixed races of 512 epochs. It is not generality in any wider sense.
- Part A shows whether later leaders are more general than a random order would make them, not why.
- Part C has 9 pairs from 3 starting soups. A real but small effect can easily show as NO DIFFERENCE SHOWN.
- CTRL is a dose control, not a perfect one: replanting the current leader may itself slow turnover.

## Code

- `tools/soup/gpu.ts`: the done counter, `stepChecked` and `advance`. `tools/soup/device.ts`: the one-process GPU lock.
- `tools/soup/evo-gpu.ts`: `runAssayGpu`, the GPU path of `runAssay`, on checked steps.
- `tools/soup-evo.ts assay --gpu`: the existing race runner on the GPU.
- `tools/soup/hall.ts`: history, round-robin planting and slots (pure). `tools/soup-hall.ts`: the pilot and the hall soups.
- `tools/soup-rq.ts`: the panel, the race plan, and the analysis of Parts A–C into `runs/soup/rq/results.json`.
- Tests: `tools/test/soup-rq.test.ts` (history, planting, scores, the pooled and sign-flip tests, the failed-race bound), `tests/deno/soup_gpu.ts` (a GPU race equals the CPU race).

## Readout

_Not yet run._
