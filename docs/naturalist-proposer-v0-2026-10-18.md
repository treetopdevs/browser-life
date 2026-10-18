# The experiment proposer, v0 (2026-10-18)

Status: **exploratory, code only.** Shape 3 of `docs/naturalist-brainstorm-2026-10-07.md`, the experiment proposer, in
its code baseline: fixed rules turn a field-notebook ring into a run spec, and nothing here calls a model. No new
physics, no rule change, no golden pin moved, no paid compute. A proposal is never run without a person's yes.

The section "Fixed before code" was written before any proposer code existed. Later changes to it go in dated sections
below it; this section is not edited after code lands.

## Fixed before code (2026-10-18)

### What a proposal is

A proposal answers one ring of one field notebook (`tools/notebook.ts`, its `.notes.json`; the bell and the notebook
rules are `docs/naturalist-bell-v0-2026-10-17.md`). It is a versioned JSON file holding:

- **The source**: the run bundle the notebook read (its run id, `presetIdentity`, steps, cadence and the SHA-256 of its
  `manifest.json`), and the notes file (path as given, SHA-256, notebook and bell versions, the bell record's SHA-256).
- **The ring it answers**: the note's signal, side, D and Z*, and the bell's receipt copied whole (first window's start
  and end steps, smallest |z|, value and envelope median at the window's start) with the first stretch.
- **The fork**: a step C at which the source's history is available, and how that is checked (below).
- **The run spec**: a full `RunSpec` (`packages/runner`), the interventions in the existing vocabulary only, and the
  exact `tools/run.ts` argv that produces it.
- **A reason in plain words** that cites only the receipt, the stretch and the fork (every number in it is one of those
  fields).
- **A prediction** phrased so that the fork's bundle and the source's bundle decide it (below).
- **A status**, `proposed` when written. Only `tools/propose.ts approve <file> --by <name>` sets it to `approved`.

### The vocabulary, in v0

- **Feed** and **drain** (`feed` with a positive or negative amount) and **lesion**, as `RunSpec.interventions`.
- **A replay control**: the fork with no intervention at all (the spec has no `interventions` key: the runner refuses
  an empty list).
- **Not in v0**: `pick` (pond worlds only, and a picked run never continues from a checkpoint); a config change for
  the next world (a fork must keep the source's config exactly: `continuationError` compares it, and a control twin
  under another condition would need runner changes this slice does not make); a source bundle that is a pond world,
  a branch, a picked or pressured run, a metapopulation member, a run with founder options, or a run that already
  carries interventions. Each is refused with its reason.

### Where a fork starts

- **The fork step C** is the largest step strictly before the intervention step S (below) at which the bundle's
  history is recoverable exactly: a checkpoint listed in the manifest's `checkpoints`, or step 0. Step 0 always
  counts: the start world is rebuilt from the spec, and its `stateHash` must equal the manifest's `initHash` before a
  proposal is written. A checkpoint counts only if its file exists, decodes (`decodeArtifact`) and its `stateHash`
  equals the manifest's entry. So a bundle with no checkpoints (`replay-m4` neutral seeds 6 to 20, all of
  `replay-calib`) forks from step 0 and replays its history up to S; one with checkpoints every 100,000 steps forks
  from the last one before S.
- **The intervention step S** is the receipt's `endStep`: the last census of the first window of 50 beyond Z*, the
  first census at which the bell could have rung. A naturalist watching the world live could not act earlier, so the
  proposer does not either.
- **The horizon H** is 20,000 steps after S (four windows of 50 censuses at cadence 100). The fork runs S − C + H steps.
  A ring with S + H past the source's last step gets no proposal: the source would not cover the comparison.
- **Execution.** A fork from step 0 is an ordinary `tools/run.ts` command with `--lesion`/`--feed`. A fork from a
  checkpoint needs `tools/run.ts --start-from <bundle> --start-step <C>`, an additive flag added for this purpose
  (start and observer from the checkpoint, the runner's own `continuationError`; intervention steps must lie in
  (C, C + steps]). The fork's spec copies the source's preset, condition, seed, cadence, deep cadence and activity
  threshold; drops `lineageObs` (the runner refuses it on a continuation, and it is observation only); sets
  `checkpointEvery` 0 and `experiment` to `naturalist-fork`.
- **The replay check.** Up to and including S the fork must be the source's history: after a run, every
  `series.jsonl` record of the fork at steps in (C, S] must equal the source's record at that step. Interventions apply
  after the census of their step, so the census at S is still shared. A mismatch fails the run (exit 4), whatever the
  rest says.

### Where an intervention lands

No bundle records where any of the 13 signals is concentrated: `series.jsonl` and `lineages.tsv` hold totals, and a
checkpoint holds the world only at C, never at S. So v0 never targets a place. Every intervention is the **jar disc**:
one entry per tile, centred on the tile's centre cell (x = tx·tileW + ⌊tileW/2⌋, y likewise), radius
`maxLesionRadius(cfg)` (127 on the 256 × 256 corpus presets, about 79% of the tile), in row-major tile order, all at
step S. A feed adds A = the preset's `init.nutrient` quanta per cell (32 for gradient-m3 and spots-m3), a drain asks to
remove A per cell (it floors at zero). A preset whose A is not in 1..`FEED_MAX` gets no feed or drain proposal.

### The rules, one row per (signal, side)

Three probes and a control. **Resource**: feed when the signal is low, drain when high; the hypothesis is that the
departure is held by the nutrient supply. **Disturbance**: lesion the jar disc; the hypothesis is that the departure is
held by the standing bodies and does not re-form from the survivors and the dissolved pool. **Replay control**: no
vocabulary intervention probes the departure without a place, so the proposal is the fork alone, which tests only that
the receipt replays from C.

| Signal | High: action, predicted direction | Low: action, predicted direction |
| --- | --- | --- |
| `livingCells` | drain, down | feed, up |
| `individuals` | drain, down | feed, up |
| `meanMass` | drain, down | feed, up |
| `lineages` | lesion, down | replay control |
| `lineageShannon` | lesion, down | replay control |
| `patternEntropy` | replay control | replay control |
| `bioticRecycling` | replay control | replay control |
| `maxGeneration` | lesion, down | replay control |
| `dominantShare` | lesion, down | replay control |
| `fissions` (rate) | drain, down | feed, up |
| `fusions` (rate) | drain, down | feed, up |
| `buddings` (rate) | drain, down | feed, up |
| `mutations` (rate) | drain, down | feed, up |

Seven feeds, seven drains, four lesions, eight replay controls. Every predicted direction is back toward the neutral
runs, the side opposite the ring. A lesion on a low diversity signal would push it further down, so those rows are
controls. These rows are a baseline to be beaten, not a claim that they are good experiments; whether they beat a
random fork is the bench's question (below), and nothing here says they will.

### The prediction, and how it is decided

- **Directional** (feed, drain, lesion). Let σ be the envelope spread in the note (`spread`, the bell's at the
  receipt window's first census). For each of the last 50 censuses of the horizon, d_t = (fork_t − source_t) / σ on the
  ring's signal, computed as the bell computes it (`SignalExtractor`; a rate over its last 10 censuses). The prediction
  holds iff the median of d_t times the direction (+1 up, −1 down) is at least 1. It fails otherwise, including when
  the fork moved the other way.
- **Replay control.** Holds iff the fork's 13 signals equal the source's at every census in (C, C + steps]. Every
  replay control should hold by construction; one that fails is a replay defect, not a finding.
- The statement in the file says the same in words: "If <hypothesis>, then over steps <S + H − 4,900> to <S + H> the
  fork's <label> stays at least one spread (<σ>) <above|below> the source's, at the median."
- The bell record is not re-read and the notebook is not re-run: the proposal trusts the notes file by its SHA-256 and
  checks that it describes this bundle (run id, `presetIdentity`, steps, cadence, and the byte sizes it lists for
  `manifest.json`, `series.jsonl` and `lineages.tsv`).

### Which rings get proposals

Every ring in the notes file, one proposal each, in the notebook's filing order. A notes file on a neutral run that
rang (`run.falseAlarm` set) still gets proposals, and each reason opens with "This ring is one of the bell's false
alarms by definition" (held-out) or "This ring is the bell ringing on neutral dynamics alone" (outside the corpus). A
ring whose S + H is past the source's end, or whose row needs a feed the preset cannot take, is listed as skipped with
its reason. Two rings that produce the same run spec (compared by the SHA-256 of the spec's canonical JSON, not by
proposal id, which includes the ring) yield one proposal citing the first ring in filing order; the other is listed as
a duplicate of it.

### The yes gate

- A proposal's identity is the SHA-256 of its body: the canonical JSON (keys sorted at every depth) of everything
  except `status` and `approval`. Its id is the first 16 hex digits; its file is `<id>.proposal.json`.
- `approve <file> --by <name>` re-validates the proposal, refuses unless its status is `proposed`, and writes status
  `approved` with `approval: {by, at, bodySha256}`. The name is a person's: 2 to 80 characters after trimming, with a
  letter, and not a model, agent or bot name (`claude`, `codex`, `gpt`, `gemini`, `agent`, `bot`, `assistant`,
  `model`, `ai` as whole words, any case). The gate is a guard against accidents, not a signature: it says who
  approved, and binds the yes to the exact body. The word list will also refuse a person whose given name is Ai; that
  refusal is accepted for v0.
- `run <file> --out <dir>` refuses unless the status is `approved`, the approval's `bodySha256` equals the body's, the
  body re-validates, the source manifest's SHA-256 is unchanged and the fork point re-checks (initHash or checkpoint
  hash). Only then does it run the stored `tools/run.ts` argv, with `--out <dir>/<id>`.
- Agents never run `approve`. Only the person does.

### Validation before any file is written

Every proposal passes, in order: `validateInterventions` (shape, `FEED_MAX`), `specConfig` (the config builds),
`interventionsError` (centre inside the world, `feedError`), `validateSpec`, every intervention step in
(C, C + steps], and the fork check above. The `tools/run.ts` argv is derived from the spec by one function, and a test
maps the argv back to a spec the way `tools/run.ts` does and requires it to be the same spec. A proposal that fails any
check is not written; the CLI names the ring and the check.

### Where output goes

`--out` is required for `propose`, `baseline` and `run`, and refused inside the repository's `runs/`, inside the runs
tree that holds the source bundle (the directory four levels above it, `<base>/<experiment>/<preset>/<condition>/seed-<n>`),
and inside the bundle itself, each checked as given and by real path, without case.

### The random baseline, for the bench

The brainstorm's test of this shape: proposals against random forks from the same checkpoints, scored by the bell.
`baseline` writes one random fork for every proposal that has an intervention (a replay control has none to
randomise), with the same budget:

- the same source, the same fork step C and the same total steps S − C + H;
- the same number of entries, each drawn independently: kind uniform over lesion, feed, drain; centre uniform over the
  world's cells; radius uniform in 1..`maxLesionRadius`; a feed or drain of A, as the rules use; step uniform over the
  census steps in (C, S], so at least H steps follow every entry; entries then sorted by step, stable;
- `mulberry32` (`@bl/metrics`) seeded per proposal with the first 32 bits of SHA-256 of `"<seed>:<proposal id>"`, so the
  same `--seed` and proposal always give the same fork, byte for byte, and adding a proposal changes no other fork;
- generator `random-v0`, the matched proposal's id, the seed, a reason that says it is random, and prediction kind
  `none` (a random fork states no hypothesis). It needs the same yes before it runs.

The bench itself (running pairs and scoring them by the bell) is not in v0: it needs GPU time and its own rules.

### Constants

W = 50 censuses, the burn-in step 10,000, H = 20,000 steps, the threshold of 1 spread and A = `init.nutrient` are the
values above. The library takes them as one parameter object so tests can use small bundles; the CLI always passes these
values and has no flag to change them, and every proposal records the values it was made with.

### Not in v0

The bench; location-targeted interventions (none is recorded); picks and next-world config changes; any model call;
running anything without a person's yes.

## Built (2026-10-18)

Code: `tools/lib/propose.ts` (the pure core), `tools/lib/propose-fs.ts` (bundle reads, fork checks, the `--out` guard, the
replay check), `tools/propose.ts` (the CLI), and an additive `--start-from DIR --start-step N` in `tools/run.ts`. Tests:
`tools/test/propose.test.ts` and `tools/test/propose-cli.test.ts` (spawned, no GPU). The section above is unchanged; where
the code had to choose something the section leaves open, the choice is recorded here.

- **File layout.** A proposal file is `{id, status, approval?, body}`. The body is everything the proposal says (source,
  notes, ring, rule, fork, intervention step, spec, argv, reason, prediction, constants, and for a random fork the matched
  id and seed); its SHA-256 over canonical JSON is the identity, and `id`, `status` and `approval` sit outside it.
  Canonical JSON sorts keys at every depth and writes numbers as `JSON.stringify` does (the receipts hold floats).
- **The source path** is stored as the bundle's absolute real path, and is the `--start-from` argument.
- **More source refusals** than the list above, each for the same reason (the argv or the replay could not be exact): a
  spec key outside the copied set (`speciesCensus`, `runId`, ...), overrides other than a lone `mutRate`, an unfinished run
  (no summary), a continuation segment (`startStep` other than 0, or no `initHash`), and a rule, schema or metrics version
  other than this checkout's. Step 0 also requires the manifest's `cfg` to equal the config its spec builds here.
- **More notes checks**: the `rings` count equals the notes filed; a receipt's window starts at or after the burn-in and
  ends within the run; the first stretch starts at the receipt's window.
- **The random baseline** draws `lesion` only when the preset has no feed amount (A outside 1..`FEED_MAX`); otherwise as
  above. Its entries are ordered by step with lesions before feeds within a step, which is the order `tools/run.ts` merges
  `--lesion` and `--feed` flags into, so the stored argv rebuilds the stored spec for every draw.
- **Deciding a replay control** compares signal vectors where the fork's rates are those of the whole history: the caller
  feeds the fork's `SignalExtractor` the source's censuses up to C before the fork's own, so a rate is defined from the
  fork's first census. A null equals only a null.
- **The runs tree** guarded by `--out` is the directory four levels above the bundle only when the bundle's last four path
  components are its own `<experiment>/<preset>/<condition>/seed-<n>`; otherwise the bundle itself is guarded (and the
  repository's `runs/` always).
- **`run`** refuses an existing `<out>/<id>`, copies the proposal file there as `proposal.json` before it starts
  `tools/run.ts` (with `Deno.execPath()` and the stored argv, from the repository root), and writes `run-receipt.json` (the
  approval, argv, exit code, fork bundle path and the replay check) whether the run succeeds or not. The fork bundle is
  `<out>/<id>/naturalist-fork/<preset>/<condition>/seed-<n>/`.
- **`tools/run.ts --start-from`** refuses any existing `manifest.json` in the run's directory, complete or not, since a
  fork's spec records no start and an earlier step-0 run of the same spec would look identical.
- **Names.** The model, agent and bot words are matched as whole words after splitting on anything that is not a letter or
  a digit ("codex bot", "gemini-2" and "My Agent" are refused; "Mx Botha" is not).
- **Real data, read only.** `propose` on the committed seed-15 notes and the real `replay-m4/gradient-m3/neutral/seed-15`
  bundle (out in a scratch directory) gives one proposal: `maxGeneration` high, lesion of the jar disc (128, 128, r 127) at
  step 77,500, fork from step 0 (initHash `19b7ccfcaa9db7f0` rebuilt and matched), 97,500 steps, the reason opening with the
  held-out false-alarm sentence. It is not approved: running it needs a person's yes and GPU time. After the review fixes
  below its id is `adad1a526b0c3eae` on this machine (the id includes the bundle's and the notes file's absolute paths), the
  same whether the paths are typed relative or absolute.
- **GPU smoke (scratch directory, synthetic notes, test approvals).** A 40,000-step `archipelago` neutral source (seed 3,
  checkpoints every 10,000) and a synthetic notes file with two rings gave a lesion fork from the checkpoint at 10,000, the
  same lesion from step 0 (on a copy whose manifest lists no checkpoints), and a replay control from 10,000. Each was
  approved as a test ("Smoke Test Approval") and run through `tools/propose.ts run`: the replay checks passed (99, 199 and 79
  censuses equal byte for byte), the checkpoint fork's whole `series.jsonl` equals the step-0 fork's from step 10,100 on
  (after the lesion too), and `predictionHolds` decided all three (the control holds, as it must; the lesion results on a
  synthetic ring are not findings). That smoke ran before the review fixes below, and its deciding step was a scratch script
  that is not in the repository: no command decides a prediction in v0 (below, "Not decided by any command").
- **One bad ring stops the file.** A ring whose proposal fails a validation check makes `propose` write nothing for any
  ring of that notes file (it names the ring and the check and exits 2), rather than writing the others.
- **`run` re-checks the spec against the source manifest** (its preset, condition, seed, cadences, threshold and overrides
  must be the source's, and the fork must end within it) besides the approval's binding, so a hand-edited body with a
  recomputed id and approval is refused with exit 2 instead of failing later in `tools/run.ts`. A relative `--out` is
  resolved against the caller's directory before `tools/run.ts` is started from the repository root.
- **"Before any GPU work"** in `tools/run.ts` means before a device is requested or any simulation runs: its refusals,
  `--start-from`'s included, come after the adapter query that every run.ts invocation makes for its host description.

## Review fixes (2026-10-18)

Three review lenses and a Codex (Sol 6.1) pass read the code above before it was committed. Where a fix changes something the
frozen section says, this section says so; the frozen section itself is unchanged, including its one slip (next item).

- **The jar disc's share.** The frozen section says the radius-127 disc is "about 79% of the tile". It is 50,617 of 65,536
  cells, about 77%.
- **A body is re-derived, not trusted.** `approve` and `run` no longer check only that the spec validates and the argv matches
  it. `validateProposal` re-derives everything it can from the body's own ring, fork and source and refuses any difference:
  the constants must be the proposer's (W 50, burn-in 10,000, H 20,000, threshold 1, A the preset's); S must be the receipt's
  last census and C must be before it (so the replay range is never empty); the spec must run S − C + H steps; a rules body's
  rule, interventions, reason, prediction and duplicate rings (below) must be exactly what the rules write for that ring; a
  random fork's entries must be exactly its seed's draw; the ring and receipt are checked as `parseNotes` checks them; unknown
  keys are refused. A malformed body is a refusal (exit 2), never a crash. A hand-edited body with a recomputed id and
  approval can still pass, but only if it is what the rules would have written.
- **What the random fork matches.** The frozen section calls it "the same budget". It matches the source, C, the length and the
  number of entries, and nothing else: the kind, the radius, the cells covered, the tiles hit and the timing are drawn at
  random. The proposals use discs of radius 127 (77% of the world) where a random entry has a radius uniform in 1..127, so a
  bench that scores proposals against these forks compares unequal doses, and the proposals could win on the dose alone.
  The random fork's reason now says "Only the entry count is matched, not the dose". A dose-matched baseline (the proposal's
  own kind and radius at a random centre and step, say) would be a new generator under new rules: that is a decision for
  whoever writes the bench's rules, not made here.
- **A random fork's replay check.** A random entry can come before S, so its fork departs from the source there. `run` used
  to check the replay up to S for every proposal, so every random fork with an entry before S would have failed with exit 4.
  The body now carries `replayThrough`: S for a rules proposal, the first entry's step for a random fork; `run` checks
  (C, replayThrough], and `validateProposal` re-derives it. A random fork can now run after the same yes, as the frozen
  section intended.
- **The random fork's seed.** The frozen section seeds mulberry32 with SHA-256 of `"<seed>:<proposal id>"`. A proposal id
  includes absolute paths (below), so moving the bundle would have changed the draw. The seed is now SHA-256 of
  `"<seed>:<the matched run spec's SHA-256>"`: the spec holds no path, so the same `--seed` gives the same draw wherever the
  files sit, and the body records the matched spec's hash (`baseline.specSha256`).
- **How strong the probes are.** The jar disc is close to the whole jar: a lesion is close to a wipe, and a drain removes up to
  the preset's starting nutrient level from 77% of the cells. Several directional predictions are close to guaranteed by that dose (a lesion pushing
  `maxGeneration`, `lineages` or `lineageShannon` down among the survivors; a drain pushing `livingCells` or `individuals`
  down), so a prediction that holds is weak evidence on its own; only the comparison with random forks can say more, and
  only once that comparison controls the dose (above). The slice brief suggested a replay control where no bundle records
  where a signal is concentrated; the frozen rules chose the jar disc instead. Changing the table would be a rules change and
  is left to the person: the rows are unchanged.
- **The reason gives the dose.** The reason used to say only "lesions the jar disc", a term it never defined. It now says,
  for example, "lesions a disc of radius 127 cells centred on the world's one tile (together about 77% of the world's
  cells), close to a wipe of the whole jar", and a feed or drain names its quanta per cell. So the reason's numbers are the
  receipt's, the stretch's and the fork's, plus the intervention's radius, tile count, share of cells and quanta per cell.
  `approve` prints the reason and the prediction it approved.
- **The spread.** σ is the bell's spread at the receipt window's first census, and the prediction is judged about 20,000
  steps later. For a signal whose neutral spread grows with time (`maxGeneration` does), one spread at the receipt is a
  smaller share of the spread at the window than it reads, which makes the bar stricter than "one spread" suggests. v0 keeps
  the receipt's σ; the bench's rules should say whether to use the envelope's spread at the window instead.
- **Cadence.** v0 makes no proposal when H is not a whole number of censuses at the source's cadence, or when the W censuses
  of the prediction do not fit after S (the ring is listed as skipped with the reason). `validateProposalSpec` also requires
  the fork's length to be whole censuses. Every bundle in the corpus has cadence 100, so nothing there changes.
- **Bounds the runner would refuse or clamp.** Every entry's radius must be in 1..`maxLesionRadius` (the runner clamps a
  larger one silently, so the run would not be the stated one), and the source's matter plus every positive feed must stay
  within `MATTER_MAX` (the source is closed in matter and carries no interventions, so its start world's total is its total
  at every step; drains only lower it).
- **Checkpoints the fork cannot continue.** A checkpoint now counts as a fork point only if it is on the census grid and the
  runner's `continuationError` accepts it for the fork's spec (config and observer settings). `run` re-asks before anything
  is created, rather than leaving `tools/run.ts` to refuse after `<out>/<id>` exists.
- **Duplicate rings.** A ring whose run spec an earlier ring's proposal already has is still listed as a duplicate, and is
  now recorded on that proposal as `alsoAnswers` (its index, signal, side, label, spread and its own prediction), so the bench
  decides both predictions of the one run. A `maxGeneration` and a `dominantShare` ring at one S give one lesion and two
  predictions.
- **Identity and paths.** The notes path is now stored as the file's absolute real path, like the source's, so the same file
  named another way gives the same id. Ids still include both absolute paths, so the same inputs at another location give
  another id (and another file name); the random draw does not depend on them.
- **The yes gate.** `approve` refuses to rewrite a file inside the repository's `runs/`, the runs tree that holds the source,
  or the source bundle (the same guard as `--out`, on the file's directory, by real path). Names are NFKC-normalised and
  dots and apostrophes dropped before the word check ("A.I." is "ai", full-width "Ｃｌａｕｄｅ" is "Claude"); the list adds
  `chatgpt`, `sonnet`, `opus`, `haiku`, `grok`, `llama`, `copilot`, `mistral`, `deepseek`, `qwen`, `robot` and `llm`, and a
  model name followed by digits ("gpt4o") is refused. As before, a person whose name is a listed word ("Ai Tanaka", "Claude
  Monet") is refused too; that is accepted. It is still a guard against accidents:
  anyone who can write the file can write an approval, since the canonical-JSON recipe is public. A terminal prompt on
  `approve` was considered and not added: the spawned tests drive `approve`, and it would not stop a hand-written approval.
- **Deciding a prediction.** `predictionHolds` refuses vectors that are not 13 numbers or nulls (an empty vector used to
  compare `undefined` with `undefined` and pass a replay control) and a window off the census grid.
- **Not decided by any command.** No command decides a prediction in v0; `predictionHolds` is a library function the bench
  will call, and `run`'s receipt carries only the replay check.
- **The replay check is byte for byte.** It splits lines on `\n` only, so a fork series written with CRLF does not equal an LF
  source. The step after `run` (receipt, replay check, exit code) is `finishRun` in `tools/lib/propose-fs.ts`, now tested on
  files, and the file side runs on `node:fs` so vitest tests it directly (`tools/test/propose-fs.test.ts`).
- **`tools/run.ts --start-from`** also refuses `--verify-against`. A lab manifest already arrives only through
  `--picks-from`, which it refused; a plain `--interventions` schedule is allowed and window-checked like the flags.
- **The argv against the real parser.** A spawned test runs a stored checkpoint-fork argv (with `--threshold` and
  `--override mutRate=0`) through `tools/run.ts` against a target that already holds a run: it parses every flag, decodes the
  checkpoint, passes `continuationError` and the window check, and only then refuses; with `mutRate=1` it refuses at
  `continuationError` instead. That proves the argv without a GPU.

## Review fixes, pass 2 (2026-10-18)

A second Codex (Sol 6.1, xhigh) pass read the fixes above. What it found and what changed:

- **A body is re-derived from its files, not only from itself.** The re-derivation above checks a body against its own ring,
  so a body could swap in a ring its notes file does not hold (a `livingCells` high drain rewritten as a low feed, with the
  rule, interventions, reason and prediction regenerated), name a matched proposal that does not exist, or name an earlier
  checkpoint than the rules pick, and still validate. `approve` and `run` now also re-derive the proposal from the files it
  names (`rederive` in `tools/lib/propose-fs.ts`): the bundle at `source.dir`, which must be the bundle's absolute real path
  with the recorded manifest SHA-256; the notes at `notes.path`, likewise an absolute real path with the recorded SHA-256,
  describing that bundle; then the rules run again, fork points re-checked. A rules body must be one of the proposals they
  give, in canonical JSON; a random fork must be its seed's draw of the proposal it names. So the ring, C, the duplicates,
  the source's run id and the matched proposal are all bound to the two files. The notes file must therefore still be at its
  path, unchanged, when the proposal is approved and run.
- **`approve` guards the directory it writes.** It used to guard `dirname(resolve(file))`, which resolves `link/..`
  lexically, while the write followed the link: a file named `outside/link/../p.proposal.json`, with `link` pointing into a
  runs tree, passed the guard and was rewritten inside the tree. `approve` now takes the file's real path, guards its
  directory and writes there. The run key for the runs-tree guard comes from the source's manifest, not from the body's
  `source.runId` (an edited `runId` such as `../archipelago/neutral/seed-1` used to switch that guard off; it now also fails
  the re-derivation).
- **A relative `source.dir`.** `run` resolved it against the caller's directory and `tools/run.ts` against the repository
  root, so the two could read different bundles. It must now be absolute and the bundle's real path.
- **The fork bundle's identity.** After `tools/run.ts` exits 0, `run` checks that the fork's manifest starts at C (from step 0,
  that its initHash is the source's) and that the source's manifest is byte for byte the one checked before the run; either
  failing is exit 4 (`identityCheck` in the receipt). `tools/run.ts` re-reads the source's checkpoint and checks it against
  the source's manifest, not against the proposal's hash; the replay check and these identity checks are what bind the run
  to the proposal's source afterwards. A source swapped and swapped back during the run is not detected; the source bundles
  are read-only data, so this is left.
- **`tools/run.ts --start-from` never reuses a run.** Its first refusal of an existing manifest ran before the device was
  requested; a run that appeared in the directory after it would have been skipped as "complete, identical spec" (the
  fork's spec records no start). The later reuse step now refuses too when `--start-from` is given. (Pass 3 found that this
  still let two forks race into one directory; see below.)
- **`predictionHolds`** requires both ends of the window on the census grid (a window shifted by half a census, with tracks
  at those steps, used to pass) and a positive cadence.
- **A test that pins `run`'s replay boundary.** `run` builds `finishRun`'s input with `finishInput`, which a test checks for a
  random fork whose first entry is before S: the check stops at that entry, not at S.

## Review fixes, pass 3 (2026-10-18)

A third Codex (Sol 6.1, xhigh) pass checked the pass-2 fixes. It found the `approve` real-path fix, the prediction grid and
the replay-boundary wiring correct; four things were left, and changed:

- **The runs tree is found without case.** `runsTreeOf` compared the bundle's last four path components with its run key
  case-sensitively, so on macOS (APFS is case-insensitive) a source reached as `runs/x/archipelago/Neutral/seed-1`, whose
  manifest says `neutral`, had no runs tree and `approve` could rewrite a proposal inside it. The components are now compared
  without case, as the rest of the guard is. On a case-sensitive filesystem this can guard a directory that is not the
  source's tree: a refusal too many, never a write too many.
- **The notes file is hashed and parsed from one read.** `rederive` (and `propose`) hashed the notes file and then read it
  again to parse it, so a file replaced between the two reads could be parsed under the old file's SHA-256. Both now read
  the bytes once (`readNotesFile`) and hash and parse that buffer. The binding is still only as strong as the file at the
  moment it is read: approve and run each read it once and check it then.
- **A fork claims its directory.** Two `tools/run.ts --start-from` forks with the same flags but different start steps target
  the same directory (the spec records no start); both could pass the existence checks and the second would write over the
  first. A fork now creates its run directory with a `mkdir` that fails when it exists, just before it runs, and is refused
  (exit 2) if it does; `propose.ts run` claims its `<out>/<id>` the same way. A fork that fails after the claim leaves the
  directory behind, so a new `--out` or `--experiment` is then needed. No test reaches this claim in `tools/run.ts`: it
  comes after the device is requested, and the tests use no GPU; the planted-manifest test stops at the earlier check.
- **The receipt's `exitCode` is the one `run` exits with.** An identity or replay failure after `tools/run.ts` exited 0 wrote
  `exitCode: 0` beside `identityCheck: {ok: false}`. The receipt now records the final exit code as `exitCode` and
  `tools/run.ts`'s own as `runExitCode`.

A fourth Codex pass checked these. The single read, the claims and the receipt held; the case fix did not cover every alias:
APFS folds more than JavaScript's `toLowerCase` does (a directory stored as `ſ` is the same directory as `s`), so a bundle
stored under such a spelling, with a manifest that spells it `s`, still had no runs tree. The spelling test now also folds
Unicode normalisation (NFC), and when it fails the guard asks the filesystem: the directory four levels up is the runs tree
when `<it>/<experiment>/<preset>/<condition>/seed-<n>`, spelled as the manifest spells it, is the bundle itself (the same
real path; `realpath` returns the stored spelling). A fifth, narrow pass on this fix moved it from device and inode to real
paths (a FUSE filesystem may repeat inode numbers) and made a lookup that fails other than "not found" a refusal, not a pass. A sixth pass on that held it correct and found one boundary
left from before: a bundle four levels below the filesystem root (`/<experiment>/<preset>/<condition>/seed-<n>`) had no runs
tree; the root is now recognised as one. Its test follows the host filesystem (on a case-sensitive one the alias does not exist and there is no tree).
Not tested, and left: that `readNotesFile` is one read (it is one `readFile` call by construction; a race test needs a
filesystem seam the module does not have), and that the atomic claims in `tools/run.ts` and `run` beat a concurrent
contender (the existing tests pre-create the target, which the old checks also refused; a contention test needs a device
seam).

Left as it is: the CLI test for an edited `source.runId` is refused by the re-derivation before the guard is reached, so it
would not catch a guard that went back to the body's `runId`; a unit test now calls the guard with the manifest's spec as
the key, which is what `approve` and `run` pass.
