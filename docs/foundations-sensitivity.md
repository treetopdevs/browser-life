# Natural-history observer sensitivity

This is an exploratory measurement assay on **one** natural physical history, executed twice from the same checkpoint for a mechanical control. The measured execution asks whether the existing topology and morphology observers change their answers when per-cell bound-mass threshold, minimum component mass, or observation cadence changes. The reference execution repeats the same physical steps with no census or morphology and must have the exact same terminal physics hash. The 27 observer rows and the reference are dependent views of one history, not replicate histories or a biological sensitivity estimate.

The command defaults to a plan-only manifest, with no GPU request:

```sh
deno run -A tools/foundation-sensitivity.ts \
  --source runs/m4/gradient-m3/treatment/seed-1 \
  --cache runs/foundations/replay-gradient-treatment-1 \
  --checkpoint-step 100000 --steps 2000 \
  --out runs/foundations/sensitivity-plan-1.json
```

After the corresponding replay cache is complete and verified, one capped continuation can be requested at a **new** report path:

```sh
deno run -A tools/foundation-sensitivity.ts --execute \
  --source runs/m4/gradient-m3/treatment/seed-1 \
  --cache runs/foundations/replay-gradient-treatment-1 \
  --checkpoint-step 100000 --steps 2000 --max-seconds 600 \
  --out runs/foundations/sensitivity-result-1.json
```

The example paths must be replaced with the actual source and verified cache paths. The tool refuses an existing output file. It re-hashes the original source observation files and the replay code, verifies every cache checkpoint, and requires the source's combined physics-and-observer terminal artifact digest plus matching observation files. A physics-only or observer-incompatible replay is reported as `unavailable` before any GPU request. The selected checkpoint is read again and its bytes, physical state and artifact digest are checked before continuation. The same source and observer code identities are checked after both executions. The report keeps source/cache identity, selected source hashes, runtime adapter details, failures, total and per-execution elapsed time, and overrun status. Unavailable or over-budget execution exits nonzero while retaining its report. GPU blocks cannot be interrupted halfway; the two executions share one cap, and an overrun before the reference hash is incomplete, never a successful result or a physics mismatch.

The simulator resumes the checkpoint's exact configuration, seed and absolute step. It reads a coherent cell/genome-head snapshot at the baseline and every 25 physical steps through at most 2,000 steps. Every observer setting receives these same arrays in memory; the report records the step and digest of each readback. The settings are per-cell thresholds `24/48/96`, minimum component masses `128/256/512`, and cadences `25/100/200`. The local trackers start a new cohort at the checkpoint baseline. Baseline individuals are recorded as a left-truncated cohort, not counted as births. Each cadence then measures its own subsequent snapshots; the report lists actual steps and denominators for at-risk individual intervals, eligible and tracked components, and morphology samples with individuals. It records fission, fusion, birth, death, fission-child counts and fusion absorption *references* (which need not be unique), plus positive differentiation and compartment samples.

The reference replays from the identical checkpoint and configuration in 100-step blocks, draining the mutation event buffer to avoid saturation. It makes no census or morphology measurements. Completion requires its terminal **physics** hash to equal the fine-observed execution's terminal hash; unequal hashes are a failed mechanical control. The event labels come from the repository's overlap-based `Tracker`, and morphology comes from its rim-versus-core classifier. Transport without overlap can appear as death plus birth; coarse sampling can miss transient splits or compartments. The report therefore assesses the observer, not the physical existence of an inherited life cycle or novel function. A matched reference does not claim equality with an original source endpoint beyond the cached checkpoint, because no separately authenticated endpoint for that branch is provided.
