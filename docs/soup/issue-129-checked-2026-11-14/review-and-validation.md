# Adversarial review and post-run validation

The full runs and their archived sources predate these review fixes. Their
snapshots, receipts, comparisons and checksummed archives were not rewritten.
No claim is made that the four long runs exercised the amended code.

## Review disposition

Claude's first read-only adversarial review reported no blockers in the frozen
results and listed six evidence/robustness improvements plus optional hardening.
The CLI model-usage record identifies `claude-opus-5-5` and `claude-fable-5-2`.
The required Codex review used `gpt-6.1-sol`, high effort, read-only. It requested
supervisor and GPU initialization fixes before commit and independently verified
the frozen evidence. Both review outputs are retained locally under
`runs/issue-129-pr-2026-11-14/`.

| Finding | Disposition |
|---|---|
| Evidence parsing/spawn failure abandons remaining seeds | Per-seed exception/finalization handling records the failure, continues independent seeds, and exits 1. Source drift aborts explicitly. |
| Missing terminal census, pre-crossing snapshot, or shortened independent run | Validate the protocol's CSV schema, finite measurements, crossing consistency, census schedule and required snapshot sizes. Seeds 1/3/4 now continue to 16384 even after an early crossing. |
| Resume upload can fail without throwing | Fresh/resumed uploads settle the queue, check error scopes and read back exact bytes before invocation evidence is written. |
| Shared-device soups can consume each other's error scopes | Device-wide operation exclusion; creation pops its scopes before yielding. |
| Assay helper not fingerprinted / check ends before receipts | Include `soup-receipt.ts` and recheck sources after receipt generation. Preserve failed stdout and validate snapshot hash, size, language and encoder metadata. |
| Assay compressor not recorded | Snapshot receipts now use a resolved, hashed encoder, verify it around measurement and retain its identity; the supervisor requires equality with the run encoder. This does not retroactively attest old receipts. |
| Patch omits untracked sources | Explicit flags declare copies authoritative and patch incomplete for untracked files. |
| Unbounded child wait | Six-hour timeout per experiment child, ten minutes per snapshot receipt; timeout is recorded and the queue continues. |
| Summary assertions lack committed generator | `summary-derivation.json` identifies supporting raw receipts and a fresh 67-source rehash. |
| Rollback upload could be silently omitted | Read back and compare checkpoint bytes before retry. A mismatch poisons the instance. |
| Unused unlocked device helper / stale comment | Removed unused export and corrected the reference. |
| Lock test uses live user's lock | Test children receive an isolated temporary HOME. Production uses the cooperating per-user lock. |
| Optional GPU fixture silently assumes seed/epoch | Require the raw 131072-program `soup-12609.bin` fixture explicitly. It is a historical seed-2 test, not a general snapshot loader. |
| Invalid load consumes evidence directory | Validate input filename, size and epoch before reserving output. |
| Historical examples differ from current protocol | Added explicit historical qualification and current tool link. |
| Absolute original paths are not portable download URLs | Retained acquisition paths in frozen provenance; ZIP `member` fields locate archived content. Remote publication remains open. |
| Python tests not in pnpm / missing success path | Separate command documented below; tests now cover successful completion, mismatches, invalid counts/receipts, spawn/parse/missing files and timeout. |
| Strong wording attributes count deficit to omitted GPU work | Report now states the observed counter deficit and successful retry, allowing counter/readback fault as another explanation. |

A per-epoch key checksum (Claude's optional suggestion) is deferred: it would
provide another diagnostic, not establish full shader correctness. Current
completion counts and sampled CPU parity have explicit limits. Likewise,
independent CPU replay across the historical divergence intervals is still
outstanding; no cause has been assigned to the seed-1/2 historical mismatches.

## Focused validation after fixes

- `pnpm typecheck`
- `pnpm vitest run tools/test/soup.test.ts tools/test/deno-no-lock.test.ts`
  — 20 passed; one optional upstream golden skipped.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/test -p 'soup_*_test.py'`
  — 11 passed. These Python tests are separate from `pnpm test`.
- `deno check --no-lock tools/soup.ts tools/soup-receipt.ts tools/soup_island.ts tests/deno/soup_gpu.ts tests/deno/soup_evidence.ts tests/deno/soup_lock.ts`
- `deno run --no-lock -A tests/deno/soup_evidence.ts`
- `deno run --no-lock -A tests/deno/soup_lock.ts`
- `deno run --no-lock -A tests/deno/soup_gpu.ts runs/issue-129-checked-2026-11-14/ensemble/historical/seed-2/soup-12609.bin`
  — real GPU: byte/instruction parity for noheads/heads/grid; retry rollback and
  exhaustion; destroyed device and non-throwing validation failures; silent
  rollback upload omission; checked resume upload and silent start-upload omission; shared-device exclusion.
  Historical snapshot 12609 → 12610: exact CPU/GPU bytes and 120548221 instructions.

The first post-fix GPU test run failed because the new rollback-byte check caught
an injected invalid upload before the old assertion's expected error prefix.
The diagnostic prefix was made consistent; the complete rerun passed. No
experiment evidence was changed to make a test pass.

Claude's focused follow-up again reported no blockers. Its remaining requests
for encoder equality, failed receipt status and receipt timeout/exit tests were
implemented. Sol's follow-up additionally required byte verification of starting
uploads and stronger CSV/crossing validation; those were implemented and tested.

A 20-epoch, 512-program CPU/GPU evidence smoke exercised `deno run --frozen`
on both paths after those fixes. Both final files and completion receipts match
`c67f95e2379acfbba37d50b76c528037af8e3c72a926ba3738729b28b49c29a6`.
The GPU accepted 20 epochs and 5120 pair completions with no rejected batch.
This is focused validation, not another full ensemble.

The final Sol 6.1 High read-only commit gate reported **no blockers** and
confirmed closure of all three follow-up findings. Its review did not run tests
or experiments. The closure changes were staged after its inspection.
