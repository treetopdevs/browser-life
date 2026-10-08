# An AI naturalist: brainstorm (2026-10-07)

Status: **exploratory, a brainstorm and not a plan.** Nothing here is registered. Nothing proposed
changes physics, a checkpoint format or a golden pin; everything is observer, analysis or tooling
work under RULE_VERSION 1. The visual companion is `docs/naturalist-brainstorm-2026-10-07.html`.

The roadmap line this takes apart is bet 3 on the home page, marked "An idea":

> An AI naturalist. A model that watches worlds, notices unfamiliar behavior and helps steer the next
> experiment. A companion for exploring artificial life in the age of AI.

## Summary

- The line bundles three products with three different hard parts: **watching**, **noticing** and
  **steering**. Noticing is the hard one, has no baseline yet, and its one first look did not test it.
- That first look is the model picker of 2026-10-04 (`docs/sandbox-wild.md`, "First look: three
  pickers"): one seed, one draw, a vision model briefed on novelty, which ended with the fewest occupied
  ponds and a drive median of zero. It measured movement, not noticing, and one seed cannot separate
  the picker from the divergence of one chaotic history. It supplies hypotheses, not a verdict: the
  model saw stills, it had no notion of normal, and it had no control.
- Reframe: **noticing is a baseline problem, not a vision problem.** The naturalist's eye should be the
  substrate-native observers the repo already has (census, tracker, activity, lineage, the intervention
  log, the pond scores), with "unfamiliar" meaning "departed from a stated normal": a control twin
  forked from the same checkpoint, or the preset's ensemble envelope. A language model explains, names
  and proposes. Pixels are for the person.
- Seven shapes are laid out below. Recommendation: build the **anomaly bell** (shape 2), then the
  **experiment proposer** (shape 3), with the **field notebook** (shape 1) as the surface. The tenfold
  version is the **ensemble watcher** (shape 6) feeding the proposer, with the coordinator queueing
  approved proposals to islands.
- The riskiest assumption is "unfamiliar can be told from normal in these worlds". The cheapest test is
  the **blinded twin test** (§6.1) on the M4 replays already on disk, code first and the model second:
  no lab work, no new simulation, no physics. A call budget of a few dollars still needs a yes.
- Four decisions are open and belong to the user (§7): who it is for first, whether it may act or only
  propose, what counts as a first win, and whether its taste may be human taste.

## 1. Frame

**Why now.** The breeder is in the lab with hand picking, and the roadmap says the aim is "a loop where
people pick what fascinates them". The naturalist is the next step on that line, and it can be one of two
products: a watcher that *replaces* the person in that loop, or an instrument that *augments* them. The
rest of this note treats those as different bets with different tests.

**Who it is for.** Two audiences with different needs:

| Audience | Depth | What they want from a naturalist | Where it would live |
| --- | --- | --- | --- |
| The experimenter at the bench | one person, long sessions, knows the measures | "Did anything happen that I would have missed? What should I try next?" | the lab's panels, run bundles, the Worlds page notes |
| A visitor to cadence.garden | many people, minutes, no vocabulary | "What am I looking at? Is this one alive?" | the jar, the Worlds page, a shared garden later |

Recommendation: the bench first. A visitor-facing companion with no eye behind it is a chat skin, and the
visitor version falls out of a working bench version.

**Constraints the repo imposes, and that work in its favour.**

- Replay is bit for bit: a segmented run equals a continuous one, a jump restores a checkpoint and
  re-applies the logged interventions, and a picked run replays from its log. Anything the naturalist
  proposes can be a reproducible recipe rather than a vibe.
- The only ways a world is touched by hand are logged: `lesion`, `feed` and `pick`
  (`packages/schema/src/world.ts`). That is the whole vocabulary a steering naturalist needs, plus config
  for the *next* world.
- The controls are config transforms (`packages/runner/src/conditions.ts`: no-mutation, neutral,
  uniform-light and the rest), so a control arm of any world is a defined thing, not a judgment call.
- Individuals are inferred, never declared. Any "that creature did X" the naturalist says is an inference
  the lineage inspector already learned to label (component → dominant lineage, with purity stated).
- The posture since 2026-10-04 is bold exploration, frames first, and anything that costs money, pushes
  or lands on main needs a yes. Paid model calls are money.

**A great outcome.** The naturalist writes a note the experimenter would *not* have thought to write, and
the note carries the receipts (run, step range, measure, digest) to check it.

## 2. What the repo already knows about this bet

### 2.1 The model picker, 2026-10-04

`tools/picker-claude.ts` gave Sonnet a contact sheet of the 16 ponds, an album of its past picks and its
own notebook, and briefed it to pick the four eligible ponds "that look most unlike anything the notebook
and the album show, one sentence each on what is new". It was never shown the rule's choice, a score or a
rank. Preset `breeder`, seed 1, 16 cycles of 5,000 steps, one draw, against the arm's own rule and a seeded
random picker. Sixteen calls cost $0.54. The per-cycle table below is the copied report
`runs/wild-report/pick1-trajectory.tsv` (gitignored, on this machine); the full bundles under
`runs/wild/pick1` are not on disk here.

| Picker | Occupied ponds at cycle 16 | Ponds scoring movement | Drive median |
| --- | ---: | ---: | ---: |
| rule | 13 | 13 | 383,849 |
| random | 14 | 2 | 0 |
| model | 9 | 0 | 0 |

Per cycle, from the same table:

- **rule**: drive median positive from cycle 3 (33,868) and still rising at cycle 16 (383,849);
  scoring ponds 10 to 15 of the 12 to 16 occupied from cycle 3 on.
- **model**: drive median positive at cycles 3 to 7 (peak 19,706 at cycle 4, with 12 scoring ponds) and
  zero from cycle 8 on, with none to two scoring ponds per later cycle; occupied ponds 16 at cycle 1,
  then 8 to 15, ending at 9.
- **random**: drive median zero at every cycle, with none to three scoring ponds per cycle; occupied
  ponds 10 to 16, ending at 14.

The model's notebook "reads as descriptions of shape, and it names single-dot shells and sparse ponds as
'new' in most later cycles". Those are thinning ponds. A second model run of the same world and seed
picked different ponds from cycle 2 on, so a model run is one draw, replayable from its log and not
repeatable from its prompt.

The sandbox note is careful about what one seed and one draw cannot show, and this note keeps that care.
The run did not test noticing: it asked for novelty and measured movement, and "a drive median of 0 after
cycle 7 does not say the model picks badly, only that novelty and movement are not the same thing here".
Whether the three pickers differ by more than one history's seed-to-seed spread is open. The result is a
reason to design differently, not evidence that a model cannot notice.

### 2.2 Three things it lacked: hypotheses, not an ablation

1. **It saw stills.** Movement, heredity and lineage turnover are invisible in a contact sheet, and a
   thinned pond looks new. The movement overlay was withheld on purpose because it "would show a model
   what the rule rewards". For a picker that is a leak; for a naturalist it is the point. (The header of
   the picker script records that Haiku described an abstract frame as satellite imagery.)
2. **It had no notion of normal.** The only reference was its own album. Without a baseline, "unfamiliar"
   collapses into "different from what I picked before", and decay is always different.
3. **It had no control.** The lineage-inspector draft decided every story must sit beside a neutral twin
   with a population band behind it. The picker had no control at all, so nothing could tell its "new"
   from drift.

No run has varied these one at a time. They are the three things a next design would add. §6.2 is the
ladder that would test the first two, and §6.1a the third.

### 2.3 What the measurement work already says

- `docs/lineage-inspector.md`: the novelty map waits until a measure passes calibration. Test 6's rule
  is the bar: a measure must separate the worlds known to differ with P(a > b) ≥ 0.8 and flag at most 2
  of the 70 neutral runs. Phenotype-bin novelty flagged 40 of 70 and failed; persistent novelty
  separated treatment from no-mutation at only 0.50. Any naturalist that says "new" has to clear that
  bar or say beside which control it is speaking.
- The M4 ensemble failed on endpoint 2 because the neutral condition grows too. The interesting findings
  in this project have been ensemble-level; a watcher of one jar could not have seen that.
- `docs/life_like_systems_edited.md` §"foundation models": a pretrained model judging novelty imports
  human taste from its training data. ASAL uses that prior deliberately. An experiment that wants
  intrinsic emergence reports model-scored novelty *beside* substrate-native measures, never instead.

### 2.4 What a naturalist could read today, without new physics

| Observer | What it yields | Where |
| --- | --- | --- |
| Census | components, sizes, lineage stats, per census | `packages/metrics/src/census.ts` |
| Tracker | individuals by overlap; fissions, fusions, buddings, generations | `packages/metrics/src/tracker.ts` |
| Collectives | fission with propagules and composition similarity (not run by the standard observer) | `packages/metrics/src/collectives.ts` |
| Activity, ecology, complexity, biogeography | evolutionary activity, recycling rates, pattern entropy and compression, held-out measures | `packages/metrics/src/` |
| Individuality | mutual information, partial information decomposition, cross-world nulls (over replicate trajectories, offline) | `packages/metrics/src/individuality.ts` |
| Lineage | exact genotype ancestry, mutation replay, the controller probe | `packages/lineage/src/` |
| Pond scores | `drive`, `seed`, `body`, `mass`, combined | `packages/schema/src/ponds.ts` |
| Intervention log | `lesion`, `feed`, `pick`, each at its step, replayed on a jump | `packages/schema/src/world.ts`, `apps/lab/src/execution.ts` |
| The replica | a physics-only clone, same config, that verifies replay over a stretch | `apps/lab/src/execution.ts` |
| Checkpoints | physics and observer state under one digest | `packages/schema/` |
| Run bundles | `series.jsonl` (one record per census: individuals, mean mass, living cells, lineages and their Shannon entropy, pools, rates, activity, fissions, fusions, buddings, mutations, pattern entropy and more), `lineages.tsv`, `mutations.tsv`, `life.jsonl`, `births.tsv`, `genomes.tsv`, `ponds.tsv`, `picks.jsonl` | `runs/` (gitignored); header of `packages/runner/src/runner.ts` |
| Coordinator | segment bundles and state hashes across islands | `apps/coordinator` |
| Worlds catalogue | hand-written, dated notes per world | `apps/lab/src/worlds.ts` |

The physics is exact integer arithmetic; the observers' outputs include floating-point statistics
(entropies, similarities), and what is streamed per census is what `series.jsonl` and the tables record.
None of it is a picture.

## 3. The reframe

**Noticing is a baseline problem.** "Unfamiliar" has to mean *departed from a stated normal*, and the
repo offers three normals, in order of strength:

1. **A control twin from the same checkpoint.** A neutral or no-mutation replica forked where the live
   world stands, re-applying the same interventions. The lab's present replica verifies replay under the
   same config; a control twin is that mechanism under a control's config, and is new work. Headless,
   the control arms already exist as conditions, and runs from a checkpoint under another arm exist for
   the pond arms. A departure from the twin is the strongest statement one world can make.
2. **The preset's ensemble envelope.** The band that the registered and sandbox runs of this preset have
   traced before. Outside the band is worth a sentence.
3. **The world's own past.** Weakest, and the only one the picker had.

The language model's job starts *after* a departure is found: say what departed, in which measure, when,
name it in the catalogue's voice, and propose the cheapest next experiment. It is never the detector of
first resort. If a model is shown anything visual, it is shown motion (frame pairs or the movement overlay),
never a still.

## 4. Seven shapes

Two axes organise them. **The eye**: narrates numbers → detects against a baseline → sees across the
ensemble. **The hand**: observes → proposes → steers.

| # | Shape | Eye | Hand | Reads | Cheapest version | What is missing today | Main risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | The field notebook | narrates | observes | the per-census records of one run | notes written offline from a bundle | an event digest | narrates what the dashboard shows |
| 2 | The anomaly bell | detects | observes | live world vs a control twin, or vs the ensemble envelope | no model at all: a flag when the twin and the world part | the control twin in the lab; the envelope per preset | false alarms on neutral drift |
| 3 | The experiment proposer | detects | proposes | the flag, the intervention vocabulary, config | proposals as run specs: fork, feed, lesion, next world | the spec format; a "yes" gate | fluent but untestable proposals |
| 4 | The visitor docent | narrates | observes | the catalogue note and the current census | a sentence per jar | an eye behind it | a chat skin |
| 5 | The breeder's eye, redone | detects | steers | motion, per-pond numbers, a trait brief | the picker rerun, several seeds and draws | the movement overlay on the sheet | steering by taste, as before |
| 6 | Many eyes, one notebook | ensemble | observes | bundles and hashes across islands | ensemble digests over existing runs | the coordinator does not know the breed arm | cost and cadence |
| 7 | Humans notice, AI collates | ensemble | observes | what people chose to share | the issue-tracker sharing that exists, with the receipts captured | automatic provenance capture | few sharers |

Each in a few lines:

1. **The field notebook.** The model reads the per-census records of a run and writes dated notes in the
   catalogue's voice. It never steers. Cheapest to build, and it would replace the hand-written notes on
   the Worlds page. The risk is prose about numbers the dashboard already shows.
2. **The anomaly bell.** The remove-something option: no language model in the noticing step. "Unfamiliar"
   is a departure from a control twin or from the envelope, found by code. A model is called only to
   explain a flag. This gives the 40 of 70 problem a handle, because the detector can be calibrated on
   neutral runs before it ever speaks.
3. **The experiment proposer.** The naturalist speaks only in the replayable vocabulary: fork from a
   checkpoint, feed, drain, lesion, pick, or a config change for the next world. Every proposal is a run
   spec, so it can be run, replayed and compared with its twin. Byte-exact replay makes a model's
   proposals auditable. This is the project's unfair advantage.
4. **The visitor docent.** A sentence about any jar on cadence.garden. High on companionship, low on
   noticing. Worth building once there is an eye to put behind it.
5. **The breeder's eye, redone properly.** The picker again with the three things it lacked: motion shown,
   per-pond numbers given, a trait brief instead of a novelty brief. Three seeds, two draws each, against
   rule and random. It answers the honest question "does a model add anything over the rule?". An inverse
   brief ("pick the ponds that will die") is a sanity check that it can see anything causal at all.
6. **Many eyes, one notebook.** Watch the ensemble, not one jar: "seed 17 under storm is the only one of
   40 where a lineage outlasts the second winter". The coordinator already holds bundles and hashes, and
   analysis already streams per census.
7. **Humans notice, AI collates.** The opposite of a watcher. The participation page already points
   people at the issue tracker with the starting world, seed, settings and step typed by hand. Capture
   those receipts for them, with the checkpoint digest, and let a model cluster what many people found
   worth sharing. This fits "people pick what fascinates them" better than a watcher does.

## 5. Provocations

- **The strongest case against the whole bet.** The project's hard problem is measurement: no novelty
  measure has passed calibration and the neutral arm grows too. A language model does not solve a
  measurement problem; it hides it behind fluent prose. A naturalist that narrates neutral drift as a new
  behaviour is worse than nothing, because it is persuasive. The mitigation is structural: it may only
  speak beside a control, the way the lineage inspector was designed.
- **Who would hate it.** The experimenter in six months, when nobody can tell which Worlds-page notes a
  model wrote. Provenance rule: every naturalist note carries what it read (run id, step range, digests,
  which twin), and human notes stay visibly distinct.
- **Nondeterminism.** A model's draw is replayable from its log and not from its prompt (the picker's
  lesson). So the log is the artifact: inputs, output, model, and the run spec it proposed, kept beside the
  bundle as `picks.jsonl` is today.
- **Cost and cadence.** A picker call was about 4,000 input tokens and $0.018 to $0.030. A watcher called
  at census cadence, every 1,000 steps, would make 1,000 calls per million steps. So: notice locally and
  cheaply with code, speak rarely and only when something departed. Events, not frames.
- **Human taste.** Any pretrained model's "interesting" is human interesting. That is fine for a
  companion and a confound for a claim. Report it as such, beside the measures, and never let it select
  what gets registered.
- **The tenfold version.** Shape 6 plus shape 3: an ensemble watcher whose proposals the coordinator can
  queue to volunteer islands, each behind a human yes. Notice, propose, run on the archipelago, notice
  again. That is the roadmap's "age of AI" line made literal, and it is also what makes the shared garden
  more than a screensaver.

## 6. Converge

**Recommendation.** Build shape 2, then shape 3, with shape 1 as the surface. Run shape 5 as the honest
test of steering. Set aside shapes 4 and 6 until their prerequisites exist (§6.3).

The riskiest assumption under each recommended shape, and its cheapest test:

| Shape | Riskiest assumption | Cheapest test |
| --- | --- | --- |
| 2, the bell | a departure from a control twin is rare between controls and common between treatment and control | §6.1a, code alone on the M4 replays and test 6's neutral corpus |
| 3, the proposer | a model's proposals, as run specs, beat a random fork at producing a departure | ten proposals vs ten random forks from the same checkpoints, scored by the bell |
| 1, the notebook | its notes say something the dashboard does not | the experimenter reads ten notes blind to source and marks the ones worth keeping |
| 5, the picker redone | motion plus numbers plus a trait brief beats the rule at the trait | 3 seeds × 2 draws × {rule, random, model} |

### 6.1 First test: the blinded twin test

The riskiest assumption of the whole bet is "unfamiliar can be told from normal in these worlds". The
cheapest honest test has two parts, scored separately, because a model reading digests and a code
detector are two different instruments:

- **Material, on disk here.** The M4 replay of `gradient-m3` under `runs/replay-m4`: treatment (10
  seeds), neutral (20) and no-mutation (5), each with `series.jsonl`, the lineage and mutation tables
  and `life.jsonl`; checkpoints every 100,000 steps on every treatment and no-mutation seed and on
  neutral seeds 1 to 5 only. Test 6's null corpus is also here: the 70 neutral runs
  `tools/foundations.ts` reads (`replay-calib` gradient and spots, 20 each; `replay-m4` gradient 20
  and spots 10). The breeder and picker runs exist here only as copied reports under
  `runs/wild-report`, and the storm runs not at all; including them means regenerating their bundles
  first.
- **Digest.** One line per census from what the bundles already record: living cells, individuals and
  mean mass, lineage count and Shannon entropy, fissions, fusions and buddings, mutations, the activity
  statistic, pattern entropy, pond scores where present, and any intervention at that step. Component-size
  quantiles and collective-fission similarity are not recorded and would need reconstruction from
  checkpoints or a new observer; they wait. A few hundred tokens per census, a window of censuses per
  prompt.
- **Part a, the code detector.** Candidate departure measures over matched pairs of digests, with the
  thresholds fixed in a dated section of this note before anything runs. False-alarm rate from
  control-against-control pairs (neutral seeds against each other, no-mutation likewise); hit rate from
  treatment-against-control pairs. The bar is test 6's rule: separate the arms with P(a > b) ≥ 0.8 and
  flag at most 2 of the 70 neutral runs, applied to the same 70-run corpus test 6 used. The 20 M4
  neutral seeds alone give a preliminary number, and pairing seeds does not make more runs. This is
  the anomaly bell's calibration and needs no model call.
- **Part b, the model.** Pairs of digests from the same preset and seed, one treatment and one control,
  in random order under blinded labels. The model says which is which, names the census where they
  parted, and writes three field notes, each with its receipts (step, measure, value). Scored on
  accuracy of the arm call, on the named census against the first census where a pre-stated measure
  separates the arms, and on its own false-alarm rate: how often a control digest alone draws a "new"
  note. Reported beside part a, never pooled with it.
- **Cost.** Part a is CPU time over existing GPU-run bundles; no new simulation. Part b is tens of calls,
  a few dollars, which is paid compute and gets a yes first.

If part a finds no measure that clears the bar, the bell has no clapper yet and the bet waits behind
measurement work. If part b cannot separate treatment from control from the digest, the model has no eye
and the naturalist stays code-only (shape 2 without a model) until it does.

### 6.2 Second test: the picker redone, one input at a time

The same world and settings as the first look (`breeder`, condition `treatment`, 16 cycles), as a ladder
of model arms that adds one input per rung, so that §2.2's first two hypotheses become an ablation:

| Arm | Sheet | Request | Brief |
| --- | --- | --- | --- |
| A, the first look again | stills | none | novelty |
| B | stills plus the movement overlay | none | novelty |
| C | as B | per-pond census numbers and pond scores | novelty |
| D | as B | as C | a named trait |
| E, the sanity check | as B | as C | the inverse: pick the ponds that will die |

Each arm on three seeds with two model draws, beside the rule and the seeded random picker on the same
seeds; read with `tools/breed.ts read` as before. Comparing A with B isolates the stills; C with B the
numbers; D with C the brief. The third hypothesis, the missing control, is not a picker input and is
tested by §6.1a instead. At the first look's measured cost per call (about $0.018 to $0.030, sixteen calls
a run) the five model arms are about 480 calls, on the order of $10 to $15, which is paid compute and gets
a yes first.

### 6.3 Set aside for now

- **Shape 4, the visitor docent**, until a bench version has an eye.
- **Shape 6 as a live loop**, until the coordinator knows the `breed` arm and picked runs can be
  segmented and stitched. Both are listed under "Not built" in `docs/sandbox-wild.md`. The offline
  version, ensemble digests over existing bundles, is available now and is part of the first test.
- **Anything that selects what gets registered.** The naturalist proposes; the pre-registration process
  stays as it is.

## 7. Decisions open

1. **Who is the companion for first:** the experimenter at the bench, or a visitor at cadence.garden?
   This note recommends the bench.
2. **May it act, or only propose?** Proposals as run specs keep the human in the loop and fit the rule
   that paid compute needs a yes. Acting would mean a naturalist that forks and runs on its own.
3. **What counts as a first win:** a note the experimenter would have written, or one they would not have
   thought to write? Only the second deserves the name.
4. **May its taste be human taste?** ASAL's choice, reported beside the substrate measures. Or must the
   first version be code only (shape 2 without a model), with language added later?

## 8. Provenance

This note was written from: the home page roadmap (`apps/lab/index.html`), `docs/public-site-plan.md`,
`docs/sandbox-wild.md` (the breeder, the pickers, "Not built"), `tools/picker-claude.ts`,
`docs/lineage-inspector.md`, `docs/life_like_systems_edited.md`, `docs/sandbox-feed.md`,
`packages/metrics/src/index.ts` and its modules, `packages/schema/src/world.ts`,
`packages/runner/src/conditions.ts` and `runner.ts`, `apps/lab/src/execution.ts`,
`apps/lab/participate/index.html`, `docs/plan.md` (north star and M4 pivot), and the copied picker
report `runs/wild-report/pick1-trajectory.tsv`. Two read-only Codex Sol 6.1 High passes, no P0. The
first found thirteen findings, all taken: the lab's replica had been mistaken for a control, the picker's
first look had been promoted to evidence, a drive median had been drawn as "any movement", the digest and
the material on disk had been overstated, the first test had conflated the model with the detector, the
coordinator branch had bypassed the approval gate, paid calls had been called free, and five smaller
wording and file-name errors. The second confirmed those and found six more, all taken: test 6's bar
needs its 70-run corpus and not the 20 M4 neutral seeds, the picker rerun had promised an ablation
without specifying one, the summaries still called the first look evidence, the disk inventory had
checkpoints and storm reports it does not have, "none moving" had stood for "none scoring", and the
model's occupancy range had left out cycle 1.
