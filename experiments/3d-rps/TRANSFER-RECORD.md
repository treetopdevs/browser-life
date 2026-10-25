# Amendment 3: vacancy kernel transfer — 25 October 2026

**TRANSFER-PASS (engineering validation only).** The real CPU and GPU slab kernels
now implement the vacancy rule as an explicit, mutation-disabled option. This is
not an ecological replication or evidence of evolution. Gate 0 remains
**GATE-0-STOP**, and Amendment 2 remains an exploratory result.

## Prior evidence checked

- Preserved candidate: `7bb61be2014621b020968e6b60b8246b33990e04`, clean original
  worktree. Its copied work-Mac Amendment 2 bundles were read again with the
  original readout. Vacancy: DC/DC/LOSS; removal: LOSS/LOSS/LOSS; controls:
  CHURN/CHURN/CHURN with no sustained loss.
- Original rules SHA256: `1bc36ffbf0f2e5f9b1314e7698480a5363c61a92365b694f951edcdb86ffa8ae`.
  Amendment 2 record SHA256: `83a41e2bfd6e51c3de0c3fa1e76031277d67f77c406f6cdb0b368289ed336db4`.
- The controls also persisted. The useful evidence is directional cycling, not
  a demonstrated improvement in survival. Neither failed mobility calibration
  nor failed removal persistence was repeated as a new scientific experiment.

## Implementation and results

Four optional config keys select a vacancy-only, K=3..8 slab rule. Mutation must
be zero; unsupported mutation keys are refused. Genome encoding/decoding and
state validation preserve type, beats-mask and the MOT mirror. Invalid live
masks, types, padding, mirrors and unowned bound matter are rejected. Existing
transport inherits the metadata; no mutation operator or public preset was added.

| Check | Result |
|---|---|
| Small spike → real GPU, 16×16×4, seed 9001, rates 0/64/16384, steps 1/10/30 | 3/3 cases pass; exact cell, raw GPU genome and accounting hashes |
| Small CPU ↔ GPU | Canonical genome, all cell words, step, light, heat and every flux total match |
| Actual 256×256×4 shape, spread 8, seeds 401/402/403, rates 0/64 | 6/6 pass: 6000-step rate-0 burn-in and 1000/2000 run-step checkpoints |
| Reference versus real-GPU report files | Small and large JSON files are byte-identical |
| K=8/type 7/mask bit 31; min=1/4/255; saturation, below-min, closed-z, one face, rate zero | 15 hand-oracle CPU/GPU fixtures pass, including B=0/P>0 victims and zero kill flux |
| Invalid-state boundaries | CPU construction, GPU create/upload and checksum-valid checkpoint decode refuse a bad mirror |
| Default shader | Generated text identical to original for six representative absent-key configs |
| Inert optional keys | GPU states, genomes and ledgers identical to absent keys at steps 1/10/30 |
| Legacy defaults | All 43 native CPU/GPU goldens pass; each reported hash matches the unchanged PINNED table |
| Typechecking | Main and RPS projects pass |
| Companion | 31 tests pass under its documented Node 24 runtime |

Conservation is exact at every transfer checkpoint and fixture. Mutation events
and overflow are absent in the new-kernel transfer checks. The large handover
preserves cumulative ledgers. Its 2000 run steps are a replay budget, not a
replacement for the original 200000-step ecological horizon.

The initial focused legacy/readout suite passed 103 tests and skipped the six
opt-in large CPU pin cases. The full native GPU/CPU run subsequently covered all
43 golden cases, including those six, and checked their pinned hashes. The
schema, slab operators, transfer and spike suite initially passed 173/174: its
one obsolete Part-A source-text assertion forbade RPS anywhere in the source.
It now checks the unchanged key-absent generated shader; all 88 spike tests pass.
The four focused transfer tests also pass after the final boundary additions.

## Review, failures and corrections retained

Independent Sol 6.1 / High read-only review before implementation identified four
acceptance gaps: canonical empty-cell genomes, flux/events, entry-point
validation and boundary coverage. All were addressed; the final code review
reported no actionable bugs. The reviews are retained in `transfer/reviews/`.

No simulation mismatch or conservation failure occurred. A hand-oracle fixture
initially assumed its A/C/S values would not diffuse; the isolated fixture was
corrected to set diffA/diffC/diffS to zero. This changed the test setup, not the
kernel or ecological settings. Companion tests first failed under local Node 26,
which removed the `transform` mode used by the existing builder; all passed on
the already installed, documented Node 24.2.0 without changing that builder.
Earlier boundary reports and logs are retained locally under
`runs/rps/transfer-review/`; the final reports and golden output are committed
under `transfer/`. No threshold or ecological outcome was changed to obtain a pass.

## Reproduce

Install dependencies with `pnpm install --frozen-lockfile`. Keep an untouched
checkout of `7bb61be2` at `$OLD`; the harness refuses a different revision or
tracked edits there. Use fresh output paths: reports refuse overwrites.

```sh
deno run -A --no-lock experiments/3d-rps/transfer/check.ts baseline "$OLD" /tmp/rps-small.json small
deno run -A --no-lock experiments/3d-rps/transfer/check.ts kernel "$OLD" /tmp/rps-small.json small
deno run -A --no-lock experiments/3d-rps/transfer/check.ts baseline "$OLD" /tmp/rps-large.json large
deno run -A --no-lock experiments/3d-rps/transfer/check.ts kernel "$OLD" /tmp/rps-large.json large
deno run -A --no-lock experiments/3d-rps/transfer/edges.ts "$OLD" /tmp/rps-edges.json
deno run -A --no-lock tests/deno/gpu_golden.ts
pnpm typecheck
pnpm typecheck:rps
pnpm vitest run experiments/test/rps-transfer.test.ts
PATH="$HOME/.nvm/versions/node/v24.2.0/bin:$PATH" pnpm vitest run experiments/test/rps-companion.test.ts
```

The baseline reports were generated before editing the real kernel. They pin the
founding, configs, step values and full raw GPU buffers separately from config
hashes; optional configuration changes cannot masquerade as a physics mismatch.
`transfer/source-manifest.json` records the tested implementation and report hashes.

## Next decision, not executed here

Propose a separate predeclared, held-out replication at 256×256×4, spread 8,
rate 64 against paired rate-0 controls, with the full 200000-step horizon. Keep
cycling and simple survival as separate endpoints. Freeze fresh seeds and a
pass/fail rule before those runs. Do not automatically extend the sample, change
mobility, rerun removal or start mutation. Only after that replication should we
ask whether mutable dominance can produce heritable ecological change.

This branch is local and experimental. No merge into main, deployment, garden
opening, new scientific trial or mutation campaign occurred.
