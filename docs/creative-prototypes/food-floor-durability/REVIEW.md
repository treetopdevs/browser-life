# Validation and review

28 October 2026. Documentation-only retrospective analysis against immutable evidence base `9085497e1561606d6209f42a7df43f05d165e0c7`.

## Saved-data validation

PASS: both raw source files match their committed bytes and existing summary artifact SHA-256 bindings. PR #115's seed-1203 raw bytes are unchanged in the evidence base.

PASS: every field of the 12,002 aligned tick rows and 24 aligned interval rows was independently recomputed from committed JSON. Tick-zero initialization is included. Empty fields are unsampled; no interpolation is used.

PASS: all 602 sample/frame pairs have matching saved state, census and frame digests; frame body/family counts match sampled census values. All 26 full snapshot endpoints agree with frame food and band occupancy. Digests were compared as saved identifiers; this is not a new full simulation-state replay or a recomputation of every original state digest.

PASS: the six continuation windows per seed agree with existing committed recovery summaries. Each interval offers 76,800 units, equal to accepted plus overflow. Each continuation window has positive births and deaths and zero cap-48 ticks. Descriptive minima, earliest minimum ticks, post-trough return to starting abundance, ticks at least 32, and seasonal interval counts were recomputed.

The provenance file records exact source and table hashes and derivation definitions. Validation only reads saved data; no model import, biological stepping, runtime tests, new controls, seeds, retries, or horizon extensions occurred. Existing evidence, plans, thresholds, conclusions and stops were not edited. Future metrics remain recommendations requiring separate authorization and review. No hosted CI success is claimed.

## Independent pre-commit review

Read-only Codex Sol 6.1 High review completed before commit. Final verdict:

No consequential findings.

Inspected all five files against immutable base `9085497e1561606d6209f42a7df43f05d165e0c7` and committed raw evidence, plans, results, and receipts. Saved-data checks passed for all 12,002 tick rows, 24 intervals, 602 sample/frame pairs, 26 snapshots, arithmetic, alignment, and provenance hashes.

Methodology caveats are accurate; frozen **1203 Promising / 1202 valid Stop** outcomes and stopping rules remain intact. Future metrics remain recommendations only.

Review stayed read-only: no edits, model imports, simulations, runtime tests, or PR actions.

After review, this receipt was updated with the verdict; no comparison or table changes were needed. Table hashes were additionally verified against Git staged bytes after LF normalization.
