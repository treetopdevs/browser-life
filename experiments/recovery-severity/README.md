# Recovery severity prototype

Implements the **zero-step feasibility gate** in [the plan](../../docs/recovery-severity-2026-10-24/PLAN.md). It does not implement or authorize the later eight-pair recovery campaign.

From this checkout, using the retained v1 campaign as a read-only input:

```sh
deno check experiments/recovery-severity/feasibility.ts
pnpm vitest run experiments/test/recovery-severity-selector.test.ts
deno run -A experiments/recovery-severity/feasibility.ts /path/to/runs/recovery-accessibility/v1 runs/recovery-severity/new-feasibility
```

The source is the exact v1 campaign pinned by its manifest digest and the 64 case-file hashes in the plan's audit. It must include case records, case digests, and grown checkpoints. It is not bundled into Git; missing evidence is an error, not permission to simulate replacement cases.

The CLI checks case and checkpoint identity, actual state validity and exact conservation, and then applies candidate lesions only to CPU state copies without advancing time. It enumerates all prescribed circles, uses exact fractional gates and deterministic joint selection, and writes one record per pair plus a result digest and source manifest. Original input files are untouched. A used output directory is refused.

`FEASIBILITY-PASS-ENGINEERING-PENDING` requires at least30/32 feasible pairs. `DOSE-CONTROL-NOT-READY` stops this protocol with exit code 3. The result digest is written first and result.json is published last by atomic rename. Readers must require both, verify the digest, and reject any failure.json or leftover .tmp file. Exceptions leave incomplete evidence or `TECHNICAL-STOP`, never an accepted pass. Neither status says anything about subsequent recovery or genotype advantage. A new result directory is required after source changes; retain prior attempts.

Next work is native CPU/GPU intervention equality and observer/endpoint validation, then the planned three-arm runner. Only those gates can admit fresh scientific seeds. Physics, rule version, golden hashes and v1 stop rules remain unchanged.
