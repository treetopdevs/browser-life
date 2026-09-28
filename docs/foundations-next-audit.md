# Foundations next phase-0 audit

Date: 2026-09-29. This is the phase-0 provenance and reservation audit for [the next-experiments plan](foundations-next-plan.md). It records local evidence and identity; it does not launch or authorize an experiment.

At the audit snapshot, `runs/foundations/` contained 180 files totaling 1,061,552,108 bytes. The machine-readable evidence index stores a SHA-256 and byte count for every file, plus hashes for all 481 `manifest.json` files found across the two local workspaces. It includes the post-baseline `copy-ancestry-preflight-source1-v1.json`; its location under the existing `runs/foundations/` directory does not make it part of the earlier investigation snapshot. Preserve these files and compare their recorded hashes before using them. The index is [evidence-index-v1.json](../runs/foundations-next/evidence-index-v1.json).

A recursive scan parsed 3,762 JSON files under the two workspaces' `runs/` and `experiments/` trees and found no numeric seed values from the proposed reservation ranges under seed-named fields. There were no local collisions for the 32 mutation-validation seeds `620060001–620060032`, mutation-smoke seeds `620069001–620069004`, ancestry/serial range `640020001–640029999`, paired M4 development seeds `650000001–650000002`, synthetic master seeds `650009001–650009002`, or future M4 range `700000001–700999999`. The two M4 development seeds are intentionally paired across conditions and presets. Synthetic development and validation masters are distinct. The exact audit file required by the mutation-validation CLI is [seed-audit.json](../runs/foundations-next/seed-audit.json); its SHA-256 is `829925aeaf8f0c0a858a490be88f26118d22aa427ea8ac0f45a9637480e13d12`. The audit file also records the separately reserved engineering smoke seeds `620069001–620069004`; the local scan covered that full range and found no collision. The broader allocation and status ledger is [seed-ledger-v1.json](../runs/foundations-next/seed-ledger-v1.json).

“Cleared” means no collision appeared in the files that could be inspected locally. The coordinator registry could not be inspected: `BL_DATA_DIR` was unset, the default `apps/coordinator/data` directory was absent, and no coordinator answered on `127.0.0.1:4000`. No cloud or external registry was queried. Therefore this is not proof of global freshness. At the phase-0 snapshot, the new reservations were unconsumed and the audit generated no scientific result. Later use is recorded separately in the live ledger.

The identity snapshot records foundations workspace jj revision `dd5cb9823991d932d9c2b2587e5cdad481b98100` (parent `c362d92a`) and original workspace revision `04df5c3b9961d586c180a499a0f9b443c84a6b71`. Both workspaces had concurrent working-copy changes, so a revision ID alone does not identify all reviewed source bytes; the index hashes the selected runtime, endpoint, metrics, and analysis files. The original workspace also contains concurrent edits to `docs/plan.md` and `tools/foundations.ts`, which were not modified for this audit.

The frozen input hash remains `10c22e94bcf1fca20d501e9c067c7c82f2555549a87813c311c6973fd2381975`. The preregistration hash matches the plan's expected SHA-256, `5e08b51d7b58d00ad11b192eca3195343f1fc96747a5b7972e847b1d73879b4d`. Runtime and device identity are in the evidence index (Node 26.10.0, Deno 2.9.7, pnpm 12.6.0; Apple M1 Max with 24 GPU cores / Metal 4). This records device identity only; no GPU work was performed.

The evidence index hashes preserved inputs but does not certify the scientific validity of every prior report. Before an execution, save its exact manifest and output path to the seed ledger, refuse existing paths, and preserve consumed seeds even after failure or unavailability. Recheck hashes if another agent changes a source file after this snapshot.

## Post-baseline C development smoke

After the phase-0 snapshot, one CPU-only neutral-drift development trial ran for gradient-m3: 64 paired seed slots, all three conditions, master seed `650009001`, trial 0. Total elapsed time was 22.733 seconds. Every late-window treatment-minus-neutral difference was zero, so the Student inference was degenerate/unavailable. This is a completed pipeline smoke and an easy null control; it does not calibrate the test near the effect floor or establish endpoint behavior. The master is consumed and must not be reused. The report, copied manifest and per-trial record are separately hashed in the evidence index; the live ledger records the consumed identity. No GPU or physical history was run.


The subsequent C CPU development benchmarks used the same development master `650009001` with distinct scenario/preset/trial identities. Recorded elapsed times were 1.821 s for four constructed activity scenarios (`v2`), 10.646 s for `longPeriodLoop` (`v3`), and 58.307 s for six old-factory condition/preset controls (`v4`). The complete manifests, per-trial rows and reports are hashed in the evidence index and ledger. These are calibration-development costs, not GPU or physical-run costs; only full frozen validation can estimate its own powered/calibration results.


## Post-baseline role-cohort smoke

The full-schedule engineering smoke used seed `620069001` under plan-v5 SHA `fcf72b383a8bb69fa8024645c3b43eea9ed5713cc9ef2445d2c3f294fb11ac96`. Its report hash is `93af56cd4b46cad8c8cde82405c13de171152156feb99e87e6413915e1bf25cb`. It completed in 54.03 seconds with 50 slots, 30 frames per slot, all 24 identity controls exact, an exact full parent repeat, and no overrun; it recorded no biological outcomes. The mutation validation seeds `620060001–620060008` are now marked started for the first scientific chunk, and the remaining seed status is in the live ledger.


## Post-baseline verification note

On 2026-09-29, the root-run full local CPU suite completed with exit code 0: 75 files, 825 tests, 85.41 seconds; TypeScript checks also passed. This is workspace verification, not new scientific evidence. A2-specific focused tests were added afterward and were reported separately as passing; they are not included in that full-suite count. Current seed execution and interruption status is tracked in the live [seed ledger](../runs/foundations-next/seed-ledger-v1.json), not this phase-0 snapshot.
