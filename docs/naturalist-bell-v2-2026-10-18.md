# The anomaly bell, v2: the eleven-signal twin bell on fresh twins (2026-10-18)

Status: **rules fixed, nothing run.** No v2 base, twin, pilot or score exists yet. A dated "Pilot facts" section and the
"Readout" are added below later; neither changes a rule in "Fixed before running". The rules were amended once on review,
before any run (listed at the end of "Fixed before running"); no bar, arm, S, radius, amount or seed count changed.

## Why v2

Bell v1's part B (`docs/naturalist-bell-v1-plan-2026-10-17.md`, readout of 2026-10-18;
`experiments/naturalist/bell-v1-twins.json`) **did not meet its exploratory bar**: at its frozen threshold
Z*_pair = 5.70, set by the seed-5 nudge on `dominantShare`, the L96 lesion and the feed were each heard on 4 of 10
seeds against a bar of 8. Its readout then scored the same pairs after the fact on part A's eleven signals (v0's
thirteen without `maxGeneration` and `dominantShare`). That gave Z* = 2.58 from the nudges, with L96 above on 10 of 10,
F on 8 of 10, L64 on 5 of 10 and nudge2 on 1 of 10. v1 called that "a post-hoc look at seen data, not a pass … a
hypothesis a v2 could fix in advance and test on new twins". v2 is that test: the post-hoc rule fixed exactly, then
scored on twins of worlds no earlier corpus has used.

**The post-hoc reading, reproduced.** Recomputed from the committed v1 record: for each twin, the largest D among
the eleven signals in its `dBySignal`. Z*₁₁ is the largest over the 10 nudge twins, **2.580695652173913** (nudge
seed 9, on `fusions`), and the hits (strict >) are nudge 0, nudge2 1, L64 5, L96 10 and F 8 of 10. A vitest pins these numbers
(`tools/test/bell2.test.ts`, "v1 post-hoc reproduces from the committed record").

**v1's own record still reproduces** with the one additive option on its scorer (below). On 2026-10-18 at 19:59 (load average
445), `deno run --no-lock -A tools/bell1.ts twins --runs <main>/runs --base <main>/runs --launch-log
<main>/runs/bell-v1-launch/jobs.jsonl --nudges experiments/naturalist/bell-v1-nudges.json --record <scratch>` (the main
checkout's `runs/`, read only) wrote a record that `cmp` finds byte-identical to `experiments/naturalist/bell-v1-twins.json`.
A vitest also pins the default `PairScorer.results()` on a fixed input to the output of v1's committed scorer (before the
option), by value and by SHA-256.

Exploratory throughout, as in v1. Nothing here changes physics, a checkpoint format or a golden pin. The GPU runs are
local, cost no money, use no model and are capped (below). Part C of v1 (the model on digests) is not part of v2 and
still waits on a yes for paid calls.

## Fixed before running (2026-10-18)

### The pair rule (v1's part B rule, with part A's signal set)

For twin and base at census t, and signal s of the eleven:

- z_s(t) = (x_twin(t) − x_base(t)) / spread_s(t)
- spread_s(t) = max(IQR/1.349, 5% of |median|, floor of s), taken over the 10 v2 bases at t. The base is one of
  them; the twin is not. v1's replay-m4 worlds are not used.
- **The eleven signals and their floors** (`tools/lib/bell.ts`, SIGNALS):

  | Signal | Kind | Floor |
  | --- | --- | --- |
  | livingCells | level | 1 |
  | individuals | level | 1 |
  | meanMass | level | 1 |
  | lineages | level | 1 |
  | lineageShannon | level | 0.01 |
  | patternEntropy | level | 0.01 |
  | bioticRecycling | level | 0.01 |
  | fissions | rate | 1 |
  | fusions | rate | 1 |
  | buddings | rate | 1 |
  | mutations | rate | 1 |

  A rate is the rise of the run's own cumulative counter over the last 10 censuses. `maxGeneration` and
  `dominantShare` are computed and reported, but they are not part of the rule.
- **W_pair = 10** consecutive censuses (1,000 steps). A window counts only if its first census is at a step from
  S + 100 to S + 5,000, so the last window ends at S + 5,900.
- D_pair (D₁₁) = the largest, over counted windows, both sides and the eleven signals, of the window's smallest
  side·z, floored at 0.
- S = **200,000**, census cadence 100.

### Threshold: one primary, one reported

- **Primary: Z*₂.** The largest D₁₁ among the 10 fresh nudge twins. This is the post-hoc rule's own construction
  (v1's B, nudges set the null) applied to new nudges. nudge2 is held out, as in v1. A hit is D₁₁ > Z*₂ (strict).
- **Reported, not deciding: Z₁ = 2.580695652173913**, the post-hoc number carried over unchanged. Under it, both
  nudge arms are held out. It is reported with its own bars (below) and does not change the reading. The two are
  never swapped after the fact.

### Corpus: fresh worlds

- **Bases.** gradient-m3, condition treatment, seeds **3901 to 3910**, each run from step 0 to step **206,000**
  (`--census 100 --deep 10`). Each takes one checkpoint, at step C = 190,000 (`--checkpoint 190000`). There are no
  interventions, and no `--lineage-obs` (see Execution).
- **Pilot seed: 3900.** Used for timing and the fork mechanics only. Its outputs are not scored.
- **Replacement seeds**, 3911 to 3920, used in order, only for the rule below. If all ten are used up, the launch
  stops for good (a final stop) and nothing is called.
- **A dead base.** If a base's census at S has livingCells = 0, it is replaced by the next unused seed. This is
  decided from that base's `series.jsonl` alone, before any of its twins run, and every replacement is recorded. A
  base that is merely small stays. Its dose is recorded, as in v1.
- **How freshness was checked (2026-10-18, before any v2 run).**
  1. Every `seed-*` directory under the main `runs/` (72 experiments, depth 4). The seeds in use were 1–20,
     101–105, 1001–1020, 1101–1110, 2002–2071, and blocks in 4,200,001–4,740,038. gradient-m3 treatment uses
     1–20 (m4), 1–10 (replay-m4 and bell-v1-twins-*), 101–105 (m4-ext), and 4,210,001–4,740,035 (founders-*).
  2. The same search over the other checkouts and worktrees of this repo (outside `runs/` and `node_modules`), over
     `~/browser-life-bench`, and over this session's scratchpad: no `seed-39*` directory anywhere.
  3. A grep of `docs/`, `experiments/`, `tools/`, `packages/schema/src`, `packages/runner/src` and `apps/lab/src`
     for a seed from 3,900 to 3,999 (a `seed`, `seeds` or `seed-` prefix): no hit.
  4. A grep of `experiments/`, `docs/` and `apps/coordinator/priv` for a JSON `"seed": 39xx`: no hit.
  5. The in-code corpus constants: v0's `corpusRuns()`, v1's `NULL_SEEDS` (2002–2071) and `BASE_SEEDS` (1–10),
     v1's pilot (2001), every number under a key naming a seed (and every two-number seed range) in every committed
     `experiments/**/*.json`, and the seed families the code defines (m4 1–20, the extension 101–105, the founder
     layouts `LAYOUT_SEED0`, the pond assays' R1′, τ and registration blocks, all above 4,200,000). A vitest pins that
     the v2 seeds, the pilot seed and the ten replacement seeds are disjoint from all of them, and that no TypeScript
     source outside v2 (tools, experiments, packages, the lab) names a number from 3,900 to 3,920. Steps 1–2 (the
     bundles on disk) stay a check by hand: a review repeated it over 61 worktrees and the bench (1,481 manifests) and
     found no seed from 3,900 to 3,999.

### Twins: v1's construction

Six arms per base, one intervention each at step S = 200,000, applied after that step's census as in v1:

| Arm | Slug | Intervention | Centre |
| --- | --- | --- | --- |
| sham (replay control) | `sham` | none | n/a |
| nudge | `nudge` | lesion r = 1 (the 5 sites with dx² + dy² ≤ 1) | the cell with B > 0 nearest (128, 128) |
| nudge2 (held out) | `nudge2` | lesion r = 1 | the cell with B > 0 nearest (64, 64) |
| L64 | `l64` | lesion r = 64 | (128, 128) |
| L96 | `l96` | lesion r = 96 | (128, 128) |
| F | `f` | feed r = 32, 64 quanta per cell | (128, 128) |

- **Nudge centres**, as v1 defined them: from the world's state at S before any intervention. Distance is squared
  Euclidean on the torus, and ties go to the smaller y, then the smaller x (`nearestBiomass` in
  `tools/lib/bell-v1-jobs.ts`, reused). The state at S comes from the sham's checkpoint at step 200,000 (below).
  Its hash is checked against the sham's manifest, and only after the sham passes its replay check over (C, 206,000].
  The centres go to `experiments/naturalist/bell-v2-nudges.json` before any nudge twin runs.
- **Dose**, as in v1: living cells and matter (A + B + C + P) at S + 100, against the base.
- Experiment names: `bell-v2-base` and `bell-v2-twins-<slug>`. All 70 destinations must be distinct and absent
  before launch.

### Execution: the one deliberate departure from v1

v1 reran every twin from step 0 to 300,000. In v2 each twin is a **fork** of its base from the base's checkpoint
at C = 190,000 (`tools/run.ts --start-from <base> --start-step 190000 --steps 16000`), so it ends at 206,000. The
world, S, the arms, the centres, the radii, the amounts and the pair score are v1's. Only the execution path
differs. It rests on the runner's determinism: a run continued from a checkpoint, with its observer, equals the
continuous run byte for byte (`tests/deno/segments.ts`). It is checked per twin below, not assumed.

- **Why.** 70 jobs of 206,000 steps each would not fit the cap at today's load (load average about 430 at
  18:49 on 2026-10-18). Forks cost 10 × 206,000 + 60 × 16,000 ≈ 3.0 × 10⁶ steps, against 1.4 × 10⁷.
- **Why 206,000 and not 300,000.** Nothing in the pair rule reads past S + 5,900. The last 100 steps are a margin.
- **Why one checkpoint.** The disk had 18 GiB free (99% used). Checkpoints every 10,000 steps would cost about
  3 GB. One checkpoint per base at C, plus the sham's at S, costs about 0.3 GB.
- **No `--lineage-obs`.** A fork refuses it. The files the bell reads (`series.jsonl`, `lineages.tsv`) are written
  either way and are byte-identical with or without it (the runner's comment at the lineage observers). The flag is
  left off the bases too, which saves disk and time.
- **What the scorer sees.** For censuses at steps ≤ C, the twin's input is its base's own census, since the fork has
  none there. From C + 100 on, it is the fork's. Equality with the base is therefore verified over (C, S], 100
  censuses per twin, not from step 0. Rates at S + 100 and later come from the fork's own censuses (their 10-census
  lag starts at S − 900 > C).
- **The sham** is a fork with no intervention, and it also writes the checkpoint at S (`--checkpoint 10000`, which
  counts from the fork's start). It is a correctness check, not a statistical control. It must equal its base at
  every census in (C, 206,000], series records and lineage rows both, so its D₁₁ is exactly 0. **If any sham differs
  from its base, the run is void and nothing is called.** That would mean a fork is not the base's history.
- **Stopping early.** If a base fails, or a sham fails (exits nonzero twice, or fails its manifest, replay or
  checkpoint check), R cannot be met, so no criterion can be called. The launcher checks each sham's replay over
  R's whole horizon, (C, 206,000], before it reads the centres. The launcher then finishes the other shams,
  writes the nudge file, and stops for good before the 50 other twins. No called outcome is lost; only the reported
  numbers of those twins are.

### Validity (a twin that fails any check is void, and void twins are reported)

- **The launch log** records exit 0 for the job, and the manifest has a summary. The manifest spec states the arm's
  experiment, gradient-m3, treatment, the seed, steps 16,000, census 100 and deep 10, and the preset identity is the
  base's.
- **interventions.jsonl** holds exactly the scheduled entry, applied (sham: no entry).
- **160 censuses**, at steps 190,100 to 206,000. Each passes v1's strict check: finite `livingCells` and
  `lineages`, and lineage rows that match them exactly.
- **Equal to its base** at every census in (C, S]: its `series.jsonl` lines byte for byte and its lineage rows, and
  the parsed census the pair scorer compares. A non-sham twin must differ from its base at some census after S.
- **A base counts** when its launch log records exit 0, its manifest has a summary and the spec above, it has 2,060
  censuses (each passing the strict check), its checkpoint at C is listed with a matching hash, and it holds no
  intervention. A base that fails is not replaced (only a dead one is). Its six twins are void.
- **A job that exits nonzero** may be rerun once, blind: its output is moved aside (not deleted) and nothing from it
  is read. Once means once across all launches: every attempt is logged in `launch.jsonl` before it is spawned, and
  the attempts are counted from those entries. An attempt cut short by a killed launcher counts. One the cap ended
  does not, because the cap stopped it, not the job. A job that fails twice is not run again; a base that fails twice
  stays (it is void, not dead) and its six twins are void. The record lists every rerun. A job that `jobs.jsonl`
  records as finished with exit 0 is never run again: if its bundle is gone, the launcher stops until it is put back.
  A job killed at the cap never counts as finished, even if its child exited 0 as the kill landed; if the launcher
  died before moving its bundle aside, the next launch moves it aside, and the scorer never reads it.
- **A twin the launch planned not to run** is void with that reason, and it is not "missing". This covers L64 when
  the scale-down drops it, which leaves the run complete. It also covers every job after a final stop that was not
  "finished" (the cap, or a failed base or sham), which leaves the run incomplete. The reason is decided per job from
  its own lines in `jobs.jsonl`: a job whose last line is a clean exit 0 must have its bundle, and its absence is
  "missing" whatever else happened; a job killed at the cap, or one whose last attempt exited nonzero, was moved
  aside and is void with that reason.
- **An attempt cut short by a signal** (SIGINT or SIGTERM to the launcher) is recorded as finished only when its
  child had already exited 0 on its own. Otherwise it is left unfinished and counts as an attempt.
- **A final stop before the nudge file exists, or before every base ran**, gives a record that says **not called
  (incomplete)**, with the run facts, and nothing scored. So do fewer than two valid bases (plain **not called** if
  the run finished).
- **A final stop that was not "finished"** (the cap before L64's phase, or a failed base or sham) calls nothing, even
  when every twin a criterion needs has run: each criterion is reported with its counts and the reason, and the
  readout is **not called (incomplete)** (or, if a sham differs from its base, R's own reading).

### Criteria

| | Bar | Over |
| --- | --- | --- |
| **B2 (L96)** | D₁₁ > Z*₂ on at least 8 of 10 | L96 twins |
| **B2 (F)** | D₁₁ > Z*₂ on at least 8 of 10 | F twins |
| **B3** | D₁₁ > Z*₂ on at most 2 of 10 | nudge2 twins |
| **R (replay)** | all 10 shams equal their bases at every census in (C, 206,000] | sham twins |

- A criterion (at Z*₂ or at Z₁) is called only when all 10 nudge twins and all 10 twins it reads are valid, as in
  v1, and R is met.
- **R's eligibility.** A sham counts for R when every check other than equality with its base passes (launch log,
  manifest, interventions, census stream). R is called when all 10 shams count: met when all 10 equal their bases,
  missed otherwise. If R is not called, or is missed, no criterion is called (at Z*₂, at Z₁ or under v1's rule).
- The brief's bar of "≤ 2 of 10 for no-intervention controls" is met trivially by R, because a sham that passes has
  D₁₁ = 0. The informative false-alarm checks are B3, and under Z₁ both nudge arms.

**Reading (primary).**

| Outcome | Reading |
| --- | --- |
| R not met | **not called: a fork is not its base's history** |
| R met, B3 met, B2 met for L96 and F | **hears events (exploratory): the post-hoc rule holds on fresh twins** |
| R met, B3 met, B2 met for one arm | **hears some events**, naming the arm |
| R met, B3 missed | **its threshold does not hold out**, whatever B2 says |
| R met, B3 met, B2 missed for both | **the post-hoc rule did not replicate** |
| a needed twin void | **not called** for that criterion, as in v1 |

**Reported beside it, not deciding.**
- **The fixed threshold Z₁ = 2.5807.** L96 and F above on at least 8 of 10 each; nudge and nudge2 above on at most
  2 of 10 each. Read with the same table, labelled "at v1's post-hoc threshold".
- **v1's own rule on the v2 twins:** all thirteen signals, with Z*₁₃ from the fresh nudges. Does v1's frozen rule
  miss again?
- **Per arm:** L64's B2; the Mann–Whitney effect P(D_arm > D_nudge); the median D₁₁; per seed, the step at which the
  first window above Z*₂ starts, the signal and side that gave D, and the dose.
- **The nudges:** their D₁₁ values, the signal that set Z*₂, and the step of each first difference.
- **Run facts:** per-job seconds and load average, reruns, replacements, and disk used.
- v1 and v2 are never pooled.

**Power and expectations, stated now.**
- **B2.** A true 80% hit rate gives 8 of 10 with probability about 0.68. 8 of 10 observed has a one-sided 95% lower
  bound of about 0.49.
- **B3.** A max-of-10 threshold has a true exceedance above 10% in about 35% of samples (0.9¹⁰), so B3 is coarse. Its
  bound is reported.
- **Shared histories.** All arms share the same ten base histories.
- **Z*₂ has no floor.** If the ten fresh nudges barely diverge, Z*₂ is small and L96 and F clear it easily. That is
  the rule as v1's post-hoc reading defined it, so v2 tests it as is. Z₁ is reported beside it so a low Z*₂ is
  visible, and the readout states both.
- **The likelier failure is F.** In v1's post-hoc look, F was exactly at the bar (8 of 10; its two weakest hits were
  D 2.82 and 3.12 against 2.58), and L96's smallest D cleared 2.58 by 0.31. A new nudge set can also raise Z*₂, since one v1 nudge2 scored
  2.75. So an F miss, or a higher Z*₂, is the likelier way for v2 to fail. That is written here so the readout cannot
  reframe it.

**What each outcome means.**
- **Hears events.** The eleven-signal pair rule, fixed in advance, hears an acute lesion and a feed against a
  nudge-set null on fresh worlds. It becomes the code comparator for part C's T1 (which still waits on a yes for
  paid calls) and a candidate for a lab twin bell (fork at the moment an experimenter acts). It still says nothing
  about events in a single world without a twin.
- **Hears some events.** The named arm is heard. The other arm's miss is reported as such and not explained away.
- **Did not replicate.** v1's post-hoc reading was selection on seen data. The next idea, fixed in advance, would be
  v1's readout item 2: a unit from the nudge pairs' own differences, or the first census after S scored alone.
  Either belongs to a v3 with fresh twins, not to this one.
- **Threshold does not hold out.** The weak link is the max-of-10 nudge null. The same v3 direction applies.
- **Not called.** Nothing is concluded. A void that comes from a fault in the launcher or scorer code may be fixed,
  and the affected jobs rerun to new destinations under these same rules, before anything is concluded. A job that
  exits 0 is not otherwise rerun.

### Cap, pilot, scale-down

- **The machine.** The local Mac, native WebGPU through Deno. Jobs run **serially**, one GPU job of ours at a time.
  Before each job the launcher checks `ps` for another GPU user. That means a `deno` process (its program is deno,
  not a shell that mentions it) running a repo entry point that opens a WebGPU device, or a Chrome started by
  Playwright or `gen:cards`. The entry points are `tools/` `run`, `island`, `bootstrap`, `calibrate`, `retest`,
  `scaffold`, `scaffold-assays`, `breed`, `horizon`, `assay`, `obligates-x`, `biogeo-sweep` and `biogeo-smoke`, plus
  every `tests/deno/*` script. A bare script name (`run.ts`, `./run.ts`: run from inside `tools/`) counts too. A vitest keeps this list equal to the `tools/*.ts` that open a device. If one is
  running, the launcher waits, polling every 60 s. The wait is logged and counts toward the cap. `uptime` is recorded
  with every job in `jobs.jsonl`.
- **The pilot** (seed 3900, outputs outside `runs/`) runs a base of 16,000 steps with a checkpoint at 10,000. Then
  it runs four forks from 10,000 for 6,000 steps each: a sham, an L96 lesion at 15,000, an F feed at 15,000, and a
  nudge (r = 1) at 15,000. The nudge's centre is read from the sham's checkpoint, the way the main run reads it at
  S. Every fork flag the main run uses is exercised once. The pilot measures steps per second for a base and for a
  fork, and the fixed cost per job. It also confirms the fork mechanics. The sham's series and lineage rows must equal
  the base's over (10,000, 16,000]. Each other fork must equal it over (10,000, 15,000]. L96 and F must differ after
  15,000; for the nudge this is reported, not required, because a one-site nudge in a young world may not show
  within 1,000 steps. Each fork's manifest and interventions must have the shape the validity checks expect. Its
  own hard cap is 1 h. Its facts, including its wall time, go into `experiments/naturalist/bell-v2-pilot.json` and a
  dated section below. It changes no rule.
- **The projection.** T = 10 × 206,000 / r_base + 60 × (16,000 / r_fork + o), where r_base and r_fork are the pilot's
  rates and o is its fixed cost per job, multiplied by 1.25, plus the budget already used. The pilot's world is
  young. In v1's twin logs, the runner's mean rate at step 200,000 was 0.75 to 1.08 of its rate at step 16,000 across
  the 50 twins, so a fork of a mature world can be up to about a quarter slower than the pilot says. So once a job of
  a kind has run in the main run, each later job of that kind is projected at the larger of the pilot's figure and
  1.25 × the slowest one seen.
- **The cap is one budget of 5 hours** of wall time, waits included, over the pilot and every launch of the main run
  together. Each launch's clock starts where the budget stood. Every launch event records the cumulative time, and
  a heartbeat every 60 s bounds what a killed launch leaves uncounted. That allowance is charged once, to the next
  launch's clock. The pilot's launches share its own 1 h the same way, so an interrupted pilot's time counts, and
  its recorded wall time (the main run's starting point) is cumulative. A pilot interrupted late leaves little of
  its hour, and its rerun needs its destinations cleared by hand. If the rerun does not fit, the pilot records its
  mechanics as not passed, the main run refuses to start, and only a dated amendment can go on. A job starts only if its projected end,
  checked again just before it is spawned, is within the cap. A job still running at the cap is killed, logged as a
  timeout and moved aside, and the run stops. Each child also runs under a `perl` alarm set to the cap plus 90 s,
  which survives `exec`, so a child cannot outlive a killed launcher by more than that. If a launcher is killed
  (no closing event) while a child runs, the next launch refuses to start while that child is alive. Once it is not,
  the next launch charges it through its alarm, which means the budget is spent and the run stops at the cap.
  Nothing records when the child ended (a stalled child can stop writing long before it dies), and no clock that
  outlives the launcher is safe from a stepped wall clock, so the whole alarm is charged. SIGINT and SIGTERM stop
  the child and close the launch cleanly; only a launcher killed outright (SIGKILL, a crash) mid-job costs this. The
  child in question is the killed launch's last attempt with no `jobs.jsonl` line of its own (each line names its
  launch and attempt number); a launcher killed between jobs is charged a heartbeat. The main run starts from the pilot's whole ledger, every pilot launch in the pilot
  root's `launch.jsonl`, and the pilot record must come from that ledger's last pilot launch; otherwise the main
  run refuses. The record carries every launch's events and time, and the pilot's facts.
- **The scale-down**, decided once, at the first launch of the main run, and kept by every resume:
  1. If T > 5 h, L64 is dropped. It is reported, not a criterion, and its absence leaves the run complete.
  2. If it is still over, the jobs run in their fixed order (bases; shams; centres; L96, F, nudge, nudge2; L64) and
     no job starts once its projected end would pass the cap. L64 runs last. If the cap is reached in L64's phase,
     L64 is dropped and the run is finished. If it is reached earlier, the run stops for good and the readout is
     **not called (incomplete)**.
  - **A stop is final** when the run finishes, when it stops early for a failed base or sham, or when the cap is
    reached. After a final stop no launch starts and the scorer may run. A launch that ended by an error or a signal
    is not final: `--resume` continues it under these rules, on the same budget, and the scorer refuses to run.
  - S, the arms, the seed count and the bars are never changed to fit. More budget would be a new, dated amendment.
- **Disk.** At least 2 GB free under the output root at launch (about twice the estimate), or no launch.
- **Where outputs go.** `/Users/nicholas/browser-life-bell-v2/` (`runs/`, `pilot/`, launch logs). Not the repo's
  `runs/`, which v2 only reads. The launcher refuses a root inside either checkout's `runs/`, and any symlink below
  the root on a path it writes, the files it appends to or truncates included (`jobs.jsonl`, `launch.jsonl`, the
  lock, each job's `.log` and `.err`). The pilot record and the nudge file are written in the repo's
  `experiments/naturalist/`, not under the root.

### Amended on review, before any run (2026-10-18)

Eight review passes (three lenses and five Codex Sol passes) read this note and the code before any GPU job. These changes
followed. None touches a bar, an arm, S, a radius, an amount, a seed or the pair rule.

- The cap is one 5 h budget over the pilot and every launch. Before, each `--resume` had its own 5 h.
- The projection takes in the slowest job seen in the main run, and a job running at the cap is killed. Before, the
  projection was the pilot's alone, and the cap only blocked a job from starting.
- A failed base or sham stops the run before the other twins.
- A twin the launch planned not to run (L64 dropped, or after a final stop) is void with that reason, not "missing".
  A dropped L64 leaves the run complete.
- The cap reached in L64's phase drops L64 and finishes the run.
- Attempts are counted from `attempt-start` entries logged before each spawn. Interrupted attempts count;
  attempts the cap killed do not.
- The pilot also runs an F fork and a nudge fork.
- The list of GPU users now covers every repo entry point that opens a device, and matches deno processes only.
- Second Codex pass: the pilot's launches count toward its own cap and the shared budget; a killed launch's
  allowance is charged once; a child that outlived a killed launcher is charged, blocks a new launch while alive,
  and runs under a `perl` alarm at the cap plus 90 s; an attempt whose child had exited 0 before a signal is
  recorded as finished; an absent bundle's reason is decided per job; a stop before the nudge file gives a "not
  called (incomplete)" record; the launcher checks each sham over (C, 206,000], not (C, S]; bare GPU script names
  count; the symlink check covers the files the launcher writes. None touches a bar, an arm, S, a radius, an amount,
  a seed or the pair rule.
- Third Codex pass: a final stop that was not "finished" calls nothing, even for criteria whose twins all ran
  (before, a cap stop in the nudge2 phase could still call B2); a child that outlived a killed launcher is charged up
  to the next launch's start, never past its alarm (before, up to the newest file it wrote, which a stalled child
  undercounts); the main run starts from the pilot's whole ledger and refuses a pilot record that does not close it
  (before, an older record could leave a later pilot launch out); a job recorded as finished with exit 0 whose bundle
  is gone stops the launcher instead of being rerun; fewer than two valid bases gives a "not called" record instead
  of no record. None touches a bar, an arm, S, a radius, an amount, a seed or the pair rule.
- Fourth Codex pass: the orphaned attempt is matched by launch and attempt number, not counted per job (before, a
  finished retry after an interrupted attempt could be charged up to its alarm); a job killed at the cap whose child
  exited 0 is never taken as finished by the launcher or the scorer; used-up replacement seeds end the run with a
  final stop (before, an error that left the run open). None touches a bar, an arm, S, a radius, an amount, a seed or
  the pair rule.
- Fifth Codex pass: a child that outlived a launcher killed outright is charged through its alarm (the cap plus 90 s),
  so the budget is spent; before, it was charged up to the next launch's start by the wall clock, which a clock
  stepped back could undercount. None touches a bar, an arm, S, a radius, an amount, a seed or the pair rule.

## Work, in order

1. **This note.** Committed before any v2 code runs on the GPU, and before any pilot.
2. **Code.** CPU tests, then a read-only Codex Sol review of this note and the code before any GPU job.
   - `tools/lib/bell2.ts`: plan, validity, stitching, summary and the post-hoc reproduction.
   - `tools/bell2-launch.ts`: pilot, then the main run.
   - `tools/bell2.ts`: the scorer. It writes `experiments/naturalist/bell-v2-twins.json`.
   - One additive, optional parameter on v1's `PairScorer.results` (a signal filter, defaulting to all thirteen).
     v1's records must still reproduce: a test, plus a rerun of `tools/bell1.ts twins` diffed against the committed
     record. Both done 2026-10-18; see "The post-hoc reading, reproduced".
3. **Pilot** (timing and mechanics only), then the main run under the cap.
4. **Readout**, recorded against these rules whatever it says.

## Not in v2

- New arms, new radii, or a new S.
- Part C (model calls).
- Spots-m3 and the no-mutation arm.
- Pooling with v1.

## Pilot facts

(Added after the pilot. Changes no rule.)

## Readout

(Added after the run.)
