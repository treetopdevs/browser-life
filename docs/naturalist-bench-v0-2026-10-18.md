# The proposer bench, v0 (2026-10-18)

Status: **rules only; nothing has run.** The bench is the test the brainstorm gives shape 3, the experiment proposer
(`docs/naturalist-brainstorm-2026-10-07.md`, §6: "a model's proposals, as run specs, beat a random fork at producing a
departure; ten proposals vs ten random forks from the same checkpoints, scored by the bell"). Here the proposals are the rule
baseline of `docs/naturalist-proposer-v0-2026-10-18.md` (`tools/propose.ts`), not a model's: the bench asks whether those rules
beat random, so that a model's proposals have a bar to beat later. No new physics, no rule change, no golden pin moved, no paid
compute, no model call. The bench's GPU runs are local and cost no money, but they wait for a person's yes, given once for the
whole batch (below).

The section "Fixed before code" was written before any bench code existed and before any notes file for its sources was made.
Later changes go in dated sections below it; this section is not edited after code lands. **Amendment 1** (at the end, made
after review and before any approval or run) replaces its reading table, its rule for a fork with no difference, and its cost
figures for disk; where the two differ, the amendment holds. **Amendment 2** (after a second review, still before any approval
or run) adds integrity fixes and widens the footprint-matched role's caveat from kind to kind and placement. **Amendment 3**
(after a third review, still before any approval or run) serialises approvals and closes what a refused score opened.

## Fixed before code (2026-10-18)

All readings below are **exploratory**: ten pairs, one preset, one arm, rules not a model. None is a registered result.

### Sources, by a fixed rule

- **The ten sources** are `replay-m4/gradient-m3/treatment/seed-1` to `seed-10`, the bundles on disk (read only; never rerun,
  never written). They are the treatment worlds a naturalist would watch, the bases bell v1's part B used, and every one of them
  rings in the bell v0 record at the notebook's calibrated threshold (its D at W = 50 is 31 to 104 against Z* 7.04 for
  gradient-m3). Neutral, no-mutation and spots-m3 bundles are not sources. No other source is substituted for any of these.
- **The notes files** come from one command, run once, with a fixed date so the files are byte-reproducible:

  ```
  deno run -A tools/notebook.ts <base>/replay-m4/gradient-m3/treatment/seed-{1..10} \
    --base <base> --out <notes> --date 2026-10-18
  ```

  `<base>` is the main checkout's `runs/`; `<notes>` is a durable directory outside the repository and outside every runs tree
  (the proposer re-reads a notes file at its absolute path, by SHA-256, when a proposal is approved or run). The bench manifest
  records each notes file's absolute path, SHA-256 and this command.
- **One proposal per source**: `tools/lib/propose.ts`'s output for that notes file, in its order, and the first proposal whose
  rule is not the replay control (a feed, a drain or a lesion). Its duplicate rings (`alsoAnswers`) come with it. A source whose
  notes give no such proposal, or whose proposal or notes the proposer refuses, gives no pair; `plan` then writes no manifest
  and names the source. The bars below were set for ten pairs, so a bench of fewer is not planned; the person decides what next.

### The forks

Every fork is the proposer's fork (same source, fork step C, length S − C + H with H = 20,000, experiment `naturalist-fork`,
no checkpoints, no `lineageObs`), validated by the proposer's checks (`validateProposalSpec`, the fork-point check, the argv
built by `runArgv`). Per source:

| Role | Count | What it is |
| --- | --- | --- |
| rules | 1 | the proposal, as `tools/propose.ts` writes it (generator `rules-v0`) |
| count | 3 | `randomBaseline(proposal, seed)` with seeds 1, 2, 3: the proposer's `random-v0` fork, unchanged. It matches the source, C, the length and the entry count; kind, centre, radius in 1..127 and step in (C, S] are random |
| dose | 3 | new generator `dose-v0`, seeds 1, 2, 3 (below): the same entry count, radius, feed amount and step as the proposal; kind and centre random |

So the bench is 10 rules forks, 30 count forks and 30 dose forks: 70 runs.

**`dose-v0`, the dose-matched fork.** For each entry of the proposal, in order: the step and the radius are the entry's (the
step is S; the radius is the jar disc's, 127 on gradient-m3); the kind is uniform over lesion, feed and drain (lesion only when
the preset has no feed amount A); a feed adds A per cell and a drain asks to remove A per cell, as the rules do; the centre is
uniform over the world's cells. Entries are then put in `tools/run.ts`'s merge order (`canonicalOrder`). The draws come from
`mulberry32` seeded with the first 32 bits of SHA-256 of `"dose-v0:<seed>:<the proposal's spec SHA-256>"`, a stream no
`random-v0` draw shares. Its replay check runs through S. It states no hypothesis.

What it controls, said plainly: on a 256 × 256 torus a radius-127 disc covers 77% of the world wherever it is centred, so the
dose fork has the proposal's footprint, timing and amount, and differs from it in the kind and in which 23% of the world is
spared. Beating it says the rules' **choice of action** for the ring mattered; it says nothing about place, which v0 never
chooses. A dose draw that picks the proposal's own kind is a near-copy of it; that is kept as drawn.

### The departure score

Bell v1's pair scorer, `PairScorer` in `tools/lib/bell1.ts`, unchanged (`docs/naturalist-bell-v1-plan-2026-10-17.md`, part B,
"Pair score"): the fork against its own source; for each of the 13 v0 signals, z(t) = (fork(t) − source(t)) / spread(t), the
spread v0's (max(IQR/1.349, 5% of |median|, floor)) over **the ten sources** at that census (the same ten treatment bundles
that were part B's unit); rates over 10 censuses from each run's own counters; windows of W_pair = 10 censuses; D_pair the
largest, over windows whose first census is from a + 100 to a + 5,000 and over both sides and all 13 signals, of the window's
smallest side·z, floored at 0.

- **The anchor a** is the fork's own first entry step: S for a rules or dose fork, the first random entry's step for a count
  fork. Each fork's departure is so scored in the 5,000 steps after its own intervention, and a count fork whose entry falls
  well before S is not judged after it has healed. One `PairScorer` is built per distinct anchor, with all ten sources pushed
  as its bases at every census.
- **Forks from a checkpoint** (C > 0) are given the source's censuses up to C as their own, so the scorer and the rates see the
  whole history. A fork from step 0 is read as written.
- **Primary D** is the 13-signal D_pair above. Reported beside it, not deciding: the 11-signal D (bell v1 part A's signals,
  without `maxGeneration` and `dominantShare`, read from the scorer's per-signal D), and the count of forks per role with
  D_pair > 5.7026 (part B's Z*_pair, `experiments/naturalist/bell-v1-twins.json`; calibrated at S = 200,000 on nudges, so out
  of its context here and descriptive only).
- The score is **undirected**: it rewards any large early departure, a wipe as much as a bloom. Whether a fork moved the way
  its proposal said is the prediction's question (below), not the bell's.

### Valid forks

A fork counts only if all of these hold, and is void otherwise:

- its run receipt has exit code 0, so the proposer's replay check through its replay step and its identity check passed;
- its manifest has a summary and (S − C + H) / 100 censuses, and every census passes bell v1's finite-field and lineage-match
  checks (`censusProblem`);
- its `interventions.jsonl` holds exactly its scheduled entries, applied;
- the pair scorer finds no difference from the source at or before its anchor and some difference after it.

Void forks are reported with their reasons. A pair (one source, one baseline role) counts only if its rules fork and all three
of that role's forks are valid. A comparison is called only if all ten of its pairs count.

### The test

For source i and baseline role b (count, dose): m_b(i) is the median of the three D values of that role's forks, and the rules
**win** pair i when D_rules(i) > m_b(i) strictly; a tie is not a win. W_b is the number of wins in ten pairs.

- **Rules beat b** iff W_b ≥ 9. **b beats the rules** iff the rules lose (D_rules(i) < m_b(i) strictly) in at least 9 pairs.
- **Why 9.** If the rules fork and the three draws of a pair are exchangeable, the rules fork is above the median of three
  with probability exactly 1/2, so W_b is Binomial(10, 1/2) under that null: P(W_b ≥ 9) = 11/1024 ≈ 0.011 for each role, about
  0.021 for either of the two. A bar of 8 (P ≈ 0.055 each) was not chosen because two baselines are tested.
- **Power, stated now.** If the rules win a pair with probability p independently: p = 0.9 gives W_b ≥ 9 with probability
  about 0.74; p = 0.8, about 0.38; p = 0.7, about 0.15. The bench can see a strong, consistent advantage and nothing smaller.
- **Independence.** The ten pairs come from ten distinct histories; the three draws and the rules fork of a pair share one.

**Reading**, per role and then together:

| Count-matched | Dose-matched | Reading |
| --- | --- | --- |
| rules beat it | rules beat it | **rules beat random, dose controlled (exploratory)**: the rules' choice of action for a ring gives larger early departures than a random action of the same size and timing |
| rules beat it | not | **beats random on dose alone**: the proposer's caveat holds; its win over v0's random forks comes from the jar disc's size and its timing, not from its choice of action |
| not | rules beat it | **mixed**: the rules beat a same-sized random action but not v0's smaller, earlier random forks; reported with the per-pair D and the count forks' anchors |
| not | not | **did not beat random** |

If a baseline beats the rules, that is said beside the reading, naming the role (for example, random lesions of the jar disc
departing further than the rules' feeds). The record lists every proposal's kind: if the rules chose one kind for most sources,
the dose comparison is in effect that kind against a random one, and the reading says so.

### The predictions

Every rules proposal's prediction, and each of its `alsoAnswers`, is decided by `predictionHolds`
(`tools/lib/propose.ts`) over the last 50 censuses of the horizon (S + H − 4,900 to S + H), from the source's and the fork's
signal tracks (`SignalExtractor`; a fork from C > 0 is given the source's censuses up to C first). σ is the receipt's spread,
as v0 stores it; the window's own spread is not substituted (for a signal whose spread grows, the bar is stricter than one
spread reads). Reported, not deciding:

- how many of the rules' predictions hold;
- **specificity**: the same prediction applied to each of the source's count and dose forks, and how many of those hold. A
  prediction that holds as often on the dose forks is not specific to the action the rules chose; this is the check on the
  proposer's second caveat (a jar-disc dose that nearly guarantees some directional predictions).

### The yes gate

- The manifest's identity is the SHA-256 of the canonical JSON (keys sorted at every depth, as the proposer's) of its body:
  everything except `status` and `approval`.
- `tools/bench.ts approve <manifest> --by <name>` takes a person's name under the proposer's rule (`isPersonName`), re-derives
  the whole body from the files it names, and writes status `approved` with `approval: {by, at, manifestSha256}`. One yes covers
  all 70 forks and binds them to that exact body. Agents never run `approve`.
- `run` refuses unless the status is `approved`, the approval's `manifestSha256` equals the body's, and the body re-derives
  byte for byte: every source manifest and notes file at its recorded path with its recorded SHA-256, this checkout's rule,
  schema, metrics, proposer and bell versions equal to the recorded ones, every fork point re-checked, the plan rebuilt and equal
  in canonical JSON. An edited body with a recomputed hash and approval is refused unless it is exactly what the plan writes.
- **A version bump voids the plan.** The sources ran under rule version 1. If `RULE_VERSION` (or the schema or metrics version)
  changes, the proposer refuses these sources and `run` refuses the manifest. A bench on new sources is a new plan for the person.

### Running

- `run` writes each fork to `<out>/<entry id>/` with the proposer's receipt (`run-receipt.json`) and replay and identity checks.
  `<out>` defaults to `$HOME/browser-life-bench/<first 16 hex of the manifest SHA-256>`; it is refused inside the repository's
  `runs/`, inside the runs tree that holds the sources, and inside any source bundle.
- **Resume.** An entry whose receipt has exit code 0 is skipped. An entry directory without such a receipt is refused by name
  (nothing is deleted or overwritten; the person moves it aside).
- **Time cap.** `--max-minutes` (default 240): no fork starts after the cap; running forks finish. Three forks at a time by
  default (`--jobs`, as bell v1's launcher).
- `score` runs only on a complete set of receipts for an approved manifest and writes the record once (refused if it exists).

### Cost, stated now

Each fork runs S − C + 20,000 steps; C is the last checkpoint before S (every 100,000 steps in these bundles) or 0, so a fork is
at most 120,000 steps and the bench at most 8.4 × 10⁶ steps. Bell v1's pilot ran about 2,090 steps/s for three processes at a
load of 80 to 180, so the bench takes at most about 67 minutes of the local GPU (about 1.1 GPU-hours), and much less if the
rings are early. `dry-run` prints the exact total; a short pilot is timed before the manifest is committed, and both go in the
section below. Disk: a 300,000-step treatment bundle is about 62 MB, so the bench needs at most about 1.8 GB outside `runs/`.

### Not in v0

A model's proposals; place-targeted interventions; replay controls (nothing to randomise); any source other than the ten above;
running or approving anything in the slice that builds the bench.

## Built (2026-10-18)

Code: `tools/bench.ts` (CLI: `plan`, `dry-run`, `approve`, `run`, `score`), `tools/lib/bench.ts` (the pure core: the plan, `dose-v0`,
the manifest and its gate, the dry-run lines, the readout), `tools/lib/bench-fs.ts` (loading, re-deriving, running, scoring),
`tools/lib/bench-exec.ts` (the Deno executor `run` spawns forks with); tests `tools/test/bench.test.ts`,
`tools/test/bench-cli.test.ts` and `tools/test/bench-plan.test.ts` (the committed plan against this section's numbers).
`tools/lib/propose*.ts` is unchanged. **Nothing was
approved, run or scored.** The only GPU use was the pilot below.

### What the plan gives

- **Notes files.** The command above, run once (43 s, CPU), wrote the ten notes files to `$HOME/browser-life-bench/notes-v0/`;
  a second run into another directory gave the same bytes for all ten. Every source's D equals its bell v0 record.
- **Manifest.** `experiments/naturalist/bench-v0-plan.json`, status `planned`, manifest SHA-256
  `a5d0c39a5187798a643835cf18102dde039028759817694993a167c5e183bad9`. Planning twice gives the same bytes. `dry-run` validates
  every spec and re-derives the plan from its files. (The first plan, `cd12e2b5…`, had no source content digests; amendment 1
  added them, and the new plan differs from the first only in those twenty fields.) The plan records this machine's absolute
  paths (the main checkout's `runs/` and `$HOME/browser-life-bench/notes-v0/`), so `dry-run`, `approve` and `run` work only where
  those files are; elsewhere they refuse, naming the first file they cannot find.
- **Totals.** 70 forks and 2,683,100 steps: 383,300 for the 10 rules forks, 1,149,900 for the 30 count forks and 1,149,900 for
  the 30 dose forks.
- **Fork point.** Every S is below the first checkpoint (100,000), so every fork starts from step 0 and is checked by `initHash`.

| Source | Ring (first proposal that is not a control) | Action | S | Fork steps | Count-fork anchors |
| --- | --- | --- | --- | --- | --- |
| seed-1 | livingCells low | feed | 19,400 | 39,400 | 5,400 · 8,500 · 9,200 |
| seed-2 | livingCells low | feed | 14,900 | 34,900 | 6,400 · 14,100 · 13,500 |
| seed-3 | livingCells low | feed | 14,900 | 34,900 | 2,400 · 900 · 7,900 |
| seed-4 | livingCells high | drain | 33,600 | 53,600 | 13,500 · 23,600 · 23,100 |
| seed-5 | livingCells low | feed | 20,500 | 40,500 | 7,600 · 19,300 · 9,400 |
| seed-6 | livingCells low | feed | 14,900 | 34,900 | 6,400 · 11,000 · 9,000 |
| seed-7 | livingCells low | feed | 18,100 | 38,100 | 6,800 · 11,700 · 3,200 |
| seed-8 | livingCells low | feed | 14,900 | 34,900 | 14,600 · 5,500 · 4,400 |
| seed-9 | mutations high | drain | 17,200 | 37,200 | 13,500 · 7,600 · 10,500 |
| seed-10 | livingCells low | feed | 14,900 | 34,900 | 9,000 · 10,800 · 10,000 |

- **The rules mostly chose one kind: 8 feeds and 2 drains.** As "Reading" says, the dose comparison is therefore in effect a
  jar-disc feed against a random kind, and its reading must say so. None of the ten proposals has `alsoAnswers`.
- **Dose draws.** The 30 dose forks drew 16 drains, 10 lesions and 4 feeds (seed by seed, D drain, L lesion, F feed: DLD, DDD,
  LFD, DDD, LLD, FDL, DLD, LLL, DLD, FDF). That is chance, kept as drawn: the stream is fixed by the rule, not chosen. The 30
  count forks drew 11 drains, 10 lesions and 9 feeds. `tools/test/bench-plan.test.ts` checks both tallies.
- **Count forks.** Every count fork's anchor comes before its S, some by 14,000 steps or more. This is the case the per-fork anchor
  was fixed for.

### Pilot timing and cost

A single process, `tools/run.ts --experiment bench-pilot --preset gradient-m3 --conditions treatment --seeds 1 --steps 5000`
into a scratch directory, ran at 1,038 steps/s (5 s of wall time) at a load of 104 (`uptime` before and after: 104.1 and 103.7).

- **Run time.** 2,683,100 steps take about 43 minutes in series at the pilot rate, and about 21 minutes at bell v1's rate for
  three processes (2,090 steps/s). Either way it is well inside the 240-minute cap, and below the "at most 67 minutes" stated
  above, because every ring is early. Both rates are for a young world (the pilot ran its first 5,000 steps); a fork runs 35,000
  to 54,000 steps, and a fuller world may step more slowly, so these figures are optimistic. The cap, not the estimate, bounds the
  run: at 240 minutes it leaves about five times the series estimate.
- **Disk.** The 5,000-step pilot bundle is 112 KB. A fork keeps no checkpoints and no lineage observer, so it writes
  `series.jsonl`, `lineages.tsv`, `mutations.tsv`, `heredity.tsv` and `life.jsonl` only. At the pilot's rate the bench writes
  about 60 MB; at the sources' own whole-run rate for those five files (86 to 166 MB per 10⁶ steps, seed-5 lowest, seed-10
  highest) about 0.45 GB at most. The "a 300,000-step treatment bundle is about 62 MB" figure and the 1.8 GB bound stated above
  were not from these sources and are replaced by this one.

### Choices made in code (the section above left them open)

- **One `PairScorer` per fork, not one per distinct anchor.** A scorer's state for one twin depends only on that twin and on the
  bases. Every scorer is pushed all ten sources at every census, so the scores are the same either way. One per fork lets each
  scorer stop at its own fork's last census.
- **Pair count.** `--pairs` exists only for test fixtures. A manifest records its own number of pairs, and a comparison is called
  only when that number is 10. `dry-run`, `approve`, `run` and `score` refuse a manifest of any other size unless `--pairs` names
  that size, so a body cut to fewer sources is refused even when its hash and approval are recomputed. The body must also have
  sources seed-1 to seed-N in order, each with exactly one rules fork and the six draws.
- **The time cap.** It is checked again after an entry's directory is claimed and before its fork is spawned. If the cap has passed
  in that interval, that one directory (made by this run, holding only `entry.json`) is removed, and the fork stays unstarted.
- **The reading's qualification.** When one kind holds a majority of the sources, the record's `readingNote` says that the dose
  comparison is in effect that kind against a random action. On this manifest that kind is the feed, 8 of 10.
- **The notes directory** is refused inside the repository, inside the sources' runs tree and inside any source bundle.
- **The record** is written once: a complete temp file is hard-linked into place, which fails if the record already exists.
- **Malformed files.** A receipt or fork manifest that is valid JSON but not an object voids its fork; it does not stop the
  score.
- **`dry-run` checks every entry before the manifest hash,** so a hand-edited spec is reported by its entry id. `approve` and
  `run` refuse on the hash first.
- **Resume.** An entry is "done" only when its receipt is this manifest's (by SHA-256), names this entry and its spec hash, and
  has exit code 0. Each fork's tools/run.ts output goes to `<out>/<id>/run.log`. A copy of the manifest goes to
  `<out>/bench-manifest.json`, and a run into an `--out` that holds another manifest's copy is refused.
- **`score`** needs a receipt for every entry. An entry whose receipt has a non-zero exit code is void, and its reason is recorded.
- **Exit codes of `run`:** 0 all done; 2 a refusal; 3 the time cap left forks unstarted (run it again to resume); 4 a fork failed,
  or an entry hit a file-system error (amendment 1).
- **Directories guarded.** The manifest's directory (at `plan` and `approve`) and the record's directory (at `score`) are guarded
  like `--out`.

## Amendment 1 (2026-10-18, after review, before any approval or run)

Four reviews (three lenses and Codex Sol 6.1) read the built bench before anyone approved it. Nothing had been approved, run or
scored, and nothing has been since; the plan was re-made once, only to add the source digests below. These changes are fixed now,
before any fork exists, and replace the rules above where they differ.

### Reading, replacing the table in "The test"

The frozen table read a positive count comparison with an inconclusive dose comparison as "beats random on dose alone", which
claims that dose explains the win; a comparison that misses its bar explains nothing. It read everything below 9 wins as "did not
beat random", which sounds like a negative result although the bench's power at a true win rate of 0.7 is about 0.15. And the
dose role controls less than its name says (below). The readings are now:

| Count-matched | Footprint-matched (`dose`) | Reading | Chip |
| --- | --- | --- | --- |
| rules beat it | rules beat it | **rules beat both random baselines (exploratory)** | Measured |
| rules beat it | neither way | **rules beat v0's random forks; the footprint-matched comparison is inconclusive** | Measured |
| rules beat it | it beats the rules | **rules beat v0's random forks; a random action of the same footprint and timing beats the rules** | Measured |
| not | rules beat it | **mixed: rules beat a random action of the same footprint and timing, but not v0's random forks** | Unclear |
| neither beats the other, one baseline beats the rules | | **a random baseline beats the rules** | Negative |
| neither way | neither way | **no clear advantage seen (the bench sees only a strong one)** | Unclear |
| either not called | | **not called** | Unclear |

"Rules beat it" is still W ≥ 9 of 10 and "it beats the rules" still at least 9 losses; nothing about the bar moved. The chip is
DESIGN.md's word for how sure a result is (`SEEN_LABELS`): an exploratory bench is never Confirmed. Measured means the rules beat
v0's random forks (the count-matched baseline) at the bar fixed before any run, whatever the footprint-matched comparison says;
a footprint-matched win alone is "mixed" and Unclear; Negative means a baseline beat the rules at that bar and the rules beat
neither; everything else is Unclear. (This sentence first said "at least one baseline", which contradicted the table's "mixed"
row; corrected in amendment 2 to match the table and `chipOf`, which did not change.) The record carries the reading and its chip, and `score` prints both.

### What the `dose` role matches

It matches the proposal's footprint (the jar disc), timing (S) and *requested* amount (±A per cell); it does not match the
physical dose. A drain asks to remove A per cell and removes nothing where there is no nutrient; a feed of +A on the same disc adds
up to 1.6 × 10⁶ quanta; a lesion converts bound structure in place and conserves matter. So the role is called
footprint-matched in prose (its key stays `dose`, which every entry id carries), and a win over it says the rules' action (its
kind at its centre) beat a random kind at a random centre with the same radius and step, not that dose was held equal, nor that
kind alone made the difference (amendment 2: the centres differ, and on gradient-m3 the spared 23% matters). (The 1.6 × 10⁶ is a radius-127 disc's
cells on the 256 × 256 torus, about 50,600, times 32: Codex's in-memory probe gave 1,619,744.) Each fork's record now carries `delivered`:
its applied feeds' logged `matter` (from `interventions.jsonl`; null for a lesion-only fork), and at its first census after its
anchor its living cells and matter minus its source's (bell v1's dose readout). The summary gives per-role medians. Reported, not
deciding.

### Valid forks, changed

- **No difference is D = 0, not void.** The frozen rule voided a fork that never differs from its source after its anchor. A fork
  whose receipt is exit 0 (replay and identity checks passed), whose manifest is complete, whose `interventions.jsonl` is exactly
  its schedule and whose stream is clean has had its action applied; if its history is still identical, the action did nothing,
  and that is an outcome (D = 0), not a failure. Voiding it would make one ineffective random draw (a radius-1 lesion on empty
  ground) void a whole comparison. A fork that differs at or before its anchor is still void.
- **Every scored field must be a finite number.** A census whose `livingCells` and lineage rows check but whose `meanMass` (or any
  of the twelve series fields the 13 signals read) is missing or null would have been scored as 0 (`SignalExtractor`'s
  `finiteOrZero`), a large spurious departure. Now such a census voids its fork; in a source it refuses the score. Every census of
  the ten sources has all twelve fields as numbers (checked: 10,000 censuses each).
- **A file that cannot be read voids its own fork** (a directory where a file should be, a permission error), with the reason; it
  no longer aborts the whole score.

### Sources bound by content

The plan records each source's `series.jsonl` and `lineages.tsv` SHA-256 beside its manifest's and its notes file's. `dry-run`,
`approve` and `run` re-hash them when they re-derive the plan, before anything runs; `score` re-hashes them before it streams. An edit to a source's censuses
after the plan, even one that keeps the file's length, is refused by name. Checkpoint artifacts are already bound: a fork from
C > 0 is checked against the checkpoint's recorded hash (`forkPointError`); every fork of this plan starts from step 0 and is
checked by `initHash`.

### Caveats fixed now, written into every record

The record's `caveats` list, and the reading of any result:

1. **The scorer did not pass its own test.** Bell v1's readout B did not meet its exploratory bar: at Z*_pair = 5.70 the pair
   scorer heard a lesion removing over a third of the living cells, or a feed, on only 4 of 10 seeds
   (`docs/naturalist-bell-v1-plan-2026-10-17.md`, "B: did not meet the exploratory bar"). The bench uses that scorer as its
   ruler because it is the bell the brainstorm names; a result here is a result in that ruler's units.
2. **Healing favours persistent actions.** Acute lesions heal inside the scorer's 10-census windows (readout B, point 2). The
   rules chose 8 feeds and 2 drains; the footprint-matched draws are 16 drains, 10 lesions and 4 feeds, and the count draws 11
   drains, 10 lesions and 9 feeds. If the rules win, part of the win can be the scorer's blind spot for lesions. The summary's
   `dByKind` gives each role's median D per kind, so a reader can see whether the baselines' lesions are what lose.
3. **The unit moves with time.** z is in units of the between-source spread at each census. The count forks' anchors (900 to
   23,600) are earlier than the rules' (14,900 to 33,600), so the count comparison compares departures measured in units that may
   differ; the "mixed" row cannot separate timing from the unit.
4. **`pWins` is descriptive.** It is the Binomial(10, 1/2) tail the "Why 9" paragraph gives, and that null assumes the rules fork
   and the draws are exchangeable, which they are not (kind mix, radius and timing differ). It is reported, never quoted as a
   p-value.

### Failed and interrupted forks

The frozen rules said a failed entry's directory is refused until a person moves it aside, and did not say what then. Now:

- **The remedy is a re-run of the same spec.** A person moves the directory aside (for example into `<out>/aside/`) and runs
  again; `run` re-runs that fork from the start. The physics is deterministic, so a re-run of a spec gives the same history: a
  re-run cannot pick a better outcome, it can only finish one that failed for a technical reason (a crashed or killed process,
  a full disk, a replay or identity mismatch). A fork that fails the same way twice stays failed, and its pair is void.
- **Re-runs are reported.** `bench-run.jsonl` is only appended to: one `start` line written before each fork is spawned and one
  `finish` line after its receipt, so a launch that never finished (an interrupted run) is still counted. The record's `reruns`
  lists every entry with more than one `start`, with the count, and `score` prints them. A log a person edits or deletes is not
  detected; the receipts and the fork bundles are the evidence, the log is the account.
- **An interrupted run** (Ctrl-C, a crash, a sleeping machine) leaves its running forks' directories without a receipt; the next
  `run` names them and refuses until they are moved aside, as above. Nothing is deleted automatically.
- **No per-fork timeout.** The cap stops new forks from starting; a fork already running is not killed. A stalled fork shows in
  its `run.log` and the person stops it; it is then an interrupted fork.

### Running, hardened

- `bench-run.jsonl` is checked to be a regular file and opened once without following a link (`O_NOFOLLOW`; amendment 2 moves the
  check onto the open handle and adds the link count); every line goes
  through that handle. A link planted there (for example into a source bundle) is refused before anything runs.
- A file-system error on one entry (its claim, its `entry.json`, its receipt), or an entry directory that another process created
  first, is recorded against that entry; the other workers go on, so no started fork is left running unwatched. `run` then exits
  4 and names the entries.
- `run` and `score` also refuse a manifest whose recorded `manifestSha256` is not its body's, or whose approval time is not an
  ISO 8601 UTC timestamp. Each command takes only its own flags: `run --by <name>` is refused, since only `approve` records a yes.
- `dry-run` refuses a file that is JSON but not a manifest (`null`, an array, a missing body) with exit 2.

### The yes gate is a check of the record

`run` checks that the approval names a person (`isPersonName`), binds this exact body and re-derives from its files. It cannot
check who wrote it: a hand-written approval naming a person passes, as the proposer's does. That the person runs `approve`
themselves, and that agents never do, is a rule of practice, not something the code enforces. The approval is visible in the
manifest, in every receipt and in the record.

### Not changed

The sources, the selection rule, the three draws per role, the dose-v0 and random-v0 streams (every spec and draw is as before),
the departure score, the anchors, the bar of 9 and the predictions. One `PairScorer` per fork stays (about 700 extractor pushes
per census against 10 for one shared set): it is correct, the parsing of the 80 streams dominates the cost, and scoring has not
run. No end-to-end run of the real executor on a real fork exists; the slice that builds the bench runs nothing, so the first real
execution is the approved batch, and `tools/test/bench-cli.test.ts` covers the executor only on a harmless command.

## Amendment 2 (2026-10-18, after a second review, before any approval or run)

A second Codex Sol 6.1 pass read amendment 1's fixes. Nothing had been approved, run or scored, and nothing has been since. The
plan is not re-made: no spec, draw, digest or other planned field changed, so the manifest SHA-256 is still `a5d0c39a…`. These
changes hold from now on.

- **Scored bytes are the bound bytes.** `score` checked the sources' digests and then opened the files again to stream them, so a
  file changed in between was scored unchecked; and the digest helper memoised by path, size and mtime, so an equal-length edit
  that kept the mtime reused the old digest. Now nothing is memoised, and `score` hashes each source's `series.jsonl` and
  `lineages.tsv` from the very stream it scores, reading on to the end of that open file after scoring; a digest that is not the
  plan's refuses the record. (`run`'s replay check reads the source on its own; a source changed during a run fails that fork's
  replay check or, if it does not, is refused at `score`.)
- **The run log is checked on its open handle.** `bench-run.jsonl` is opened with `O_NOFOLLOW` and then `fstat`ed: it must be a
  regular file with exactly one link, so a hard link into a source bundle is refused as a symbolic link is. If its last line was
  torn by an interruption, a newline is written first, so the next launch's `start` line is counted.
- **No file is replaced by a race.** `plan` and the run's copy of the manifest are published by hard-linking a complete temporary
  file into place, which fails if another process published first (as the record already was); `approve` refuses if the
  manifest changed between its check and its write (amendment 3: that check and the write are now held under a lock).
- **A fork whose log cannot be written is killed.** The executor kills its child and waits for it before reporting the failure, so a
  worker never moves on, and `--jobs` is never exceeded, while a fork still runs.
- **An entry directory that cannot be read voids its own fork** at `score` instead of aborting the record (the receipt preflight
  no longer throws on a permission error).
- **The footprint-matched role differs in kind and placement.** Its centre is random and the rules' is fixed, and on gradient-m3 the
  23% a disc spares is not the same wherever it sits. A win over it, or a loss to it, is about the rules' action (its kind at its
  centre), not its kind alone. This is now a sixth caveat in every record (the record's fourth is the dose-role caveat stated in "What the `dose` role matches", so the numbered list above has four), and the reading note for a dominant kind says so.
- **The chip's prose matches its table.** See "Reading" above; the table and the code were already the same.

## Amendment 3 (2026-10-18, after a third review, before any approval or run)

A third Codex Sol 6.1 pass read amendment 2's fixes, found every one of them closed except the approval race, and raised four
contained problems (no P0 or P1). Nothing had been approved, run or scored, and nothing has been since; the plan is not re-made and
its manifest SHA-256 is still `a5d0c39a…`.

- **Approvals are serialised.** `approve` re-read the manifest and then renamed its approved copy into place, so two approvals
  made at once could both pass the re-read and the later rename would replace the earlier yes. Now the re-read and the rename
  are held under `<manifest>.lock`, created exclusively: of two approvals at once one is written and the other refused. A lock
  left by a crash is named in the refusal and never broken by the tool. An editor that ignores the lock can still race the
  rename; the approval's bound hash then refuses that body at `run` and `score`.
- **A refused score closes the sources.** The source files `score` streams and hashes stayed open when scoring was refused part
  way; every exit now closes them and waits for the descriptors to be released.
- **A failed temporary write leaves nothing.** `publishOnce`'s temporary file is written inside its cleanup scope.
- **The scored-bytes binding is tested at `score`.** A test changes a source after `score`'s pre-checks and before it streams
  (an equal-length edit in place, a rename over, a truncation) and expects the record refused; with the final digest comparison
  removed, the first two would be scored without complaint.
