# Foundation extraction catalog

This tool inventories candidate material in an authenticated replay cache. It does not extract cells, transplant them, normalize resources, or test viability. A selected component is a deterministic **structural candidate**, not an organism, offspring, or successful inoculum.

Run it with an explicit rule file:

```text
deno run -A tools/foundation-extract.ts \
  --source /absolute/path/to/source-bundle \
  --cache /absolute/path/to/verified-replay-cache \
  --rule /absolute/path/to/predeclared-rule.json \
  --out /absolute/path/to/new-catalog.json
```

The output path must be new. The tool rereads and checks every cached checkpoint through the replay verifier, then streams SHA-256 and byte counts for the original `manifest.json` and all six observation files. Every source file must match the identities recorded in the replay cache. A source file that changed after replay makes the catalog unavailable. This is a read-only CPU pass over the cache and source bundle.

A rule file has this shape; freeze and hash it before inspecting candidate rankings:

```json
{
  "version": 1,
  "selectionSeed": "foundations-feasibility-1",
  "perStratumPerTime": 3,
  "strata": [
    { "id": "rare", "minCells": 1, "maxCells": 9 },
    { "id": "intermediate", "minCells": 10, "maxCells": 99 },
    { "id": "abundant", "minCells": 100, "maxCells": null }
  ],
  "censusThreshold": 48,
  "minComponentMass": 256
}
```

Strata cover all positive lineage cell counts with no gaps. At each requested time, the tool inventories every living lineage and every connected bound-mass component before selecting up to `perStratumPerTime` structurally clean components in each stratum. Selection order is SHA-256 of the frozen seed, step, tile, component index, lineage key and packed genome digest. Component IDs and cells come from the same toroidal census algorithm as the runner. Empty or extinct times remain explicit entries; subthreshold, mixed-lineage, background-admixed and mixed-genotype components remain in the catalog with reasons. Sampling never silently drops these observations.

The catalog lists exact cell indices for every component. Each time entry records the tile and whole-world dimensions, a canonical configuration SHA-256, and energy coefficients. A linear index is `y * worldW + x`. The source run specification and preset identity also appear in provenance. For every lineage it separately groups the full 44 packed genome words per cell, retaining a representative word vector and exact member indices for each group. The genotype SHA-256 covers words 2–43, excluding the two lineage-address words: identical controller/parameter genomes under different lineage IDs have the same genotype identity. The full word vector retains the lineage address for reconstruction. This checks within-lineage heterogeneity instead of inferring identical genomes from a shared lineage ID. Current checkpoint validation itself rejects conflicting genome words under one lineage ID; the catalog performs the check independently and preserves its own result. A mixed component is never treated as a pure lineage or genotype.

For each component and the whole world, it records A/B/C/P/E/S quanta, bound mass B+P, matter A+B+C+P, and energy in the world's configured ledger units. The world record also includes light input, heat output and each flux counter. The component inventory covers only its exact member indices; pools outside those cells remain in the world inventory. A future transplant would need to account for both the moved cells and the source/destination pools. The catalog does not perform that accounting transfer.

Tracker IDs and `trackerJoinEligible` appear only when all original observation-file hashes matched during replay **and** the stored tracker label array exactly matches the newly computed census labels. If either condition fails, IDs are null and the join flag is false; the catalog remains usable for genome and resource inventory. The flag validates only a join between this component and a saved observer ID. A mixed or fused component can still have a valid join. The observer ID reflects an inferred overlap history; it is not proof of clean ancestry, reproduction or heredity. No genotype group or structural candidate is called viable without the separately planned extraction/sham and common-garden assays.

Provenance records the creation time, source/cache path hints, original schema/rule/metrics versions, declared original code revision, run specification, preset identity, and SHA-256 plus byte count for the extraction CLI, catalog library, census, accounting, and layout source files. This source-file list is **partial**: it identifies selected implementation files, not the entire dependency closure or a verified repository revision. The original bundle's manifest and six observation files are hashed separately; the replay cache verifier checks its own authenticated contents before cataloging.
