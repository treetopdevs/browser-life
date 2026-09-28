# Founder ancestry audit

`tools/foundation-ancestry.ts` reads existing run bundles without replaying physics or invoking a GPU. It currently supports only the ten `m4/gradient-m3` treatment and no-mutation sources at seeds 1–5, sampling censuses at steps 100,000, 500,000 and 900,000. It rebuilds the registered initialization, checks the recorded preset/configuration and `initHash`, and rejects unsupported or incomplete sources (`tools/lib/foundation-ancestry.ts:73-124`). Run it with:

```sh
deno run -A tools/foundation-ancestry.ts --runs-root runs/m4 --out runs/foundations/founder-ancestry.json
```

The output path must be new. The report records SHA-256 and byte count for each source manifest, mutation, series and lineage file, along with selected current-source hashes. It preserves all ten expected source rows, including unavailable or partial runs, and reports audited coverage separately (`tools/foundation-ancestry.ts:149-180`). All 10/10 selected sources passed the sampled audit: their series schedules were complete, and each of the three selected lineage-row totals matched its series count. The lineage file is streamed and hashed in full, but row-count consistency is checked only at those three targets, not at every census. Each recorded schema/rule/metrics version was 3/1/2 and each initialization declared 12 M3 founder instances. The preset derives that count from `M3_FOUNDERS.length` (`packages/schema/src/presets.ts:50-56`); the audit does not use `m3World`'s separate default count of 13 (`packages/schema/src/world.ts:223`). It rebuilds the actual seeded placement and checks its hash before assigning origins.

The audit keeps the founder *instance* (the initialization lineage ID) separate from the M3 genome-set index. That distinction matters because `m3World` assigns genome slot `i % M3_FOUNDERS.length` to initialization instance `i` (`packages/schema/src/world.ts:227-238`). Mutation rows are streamed in causal order; each child must be unique and have a previously known parent, and their count must equal the manifest summary (`tools/lib/foundation-ancestry.ts:127-159`, `tools/foundation-ancestry.ts:52-69`). The per-lineage mutation depth counts logged ID-minting events, including clamped or no-op changes. It is not a count of functional innovations or evidence that a mutation caused a later outcome.

## Observed sample summaries

The table gives mean extant lineages and cells across five runs, with the lineage range. “Founder origins by seed” is the count of distinct initial founder instances still represented by at least one lineage, ordered seeds 1–5. Treatment depth is the mean across runs of the cell-weighted mean mutation-event depth at that census. Values are descriptive snapshots, not independent replicate-level estimates of a treatment effect.

| Condition | Step | Mean lineages (range) | Mean cells | Founder origins by seed | Mean cell-weighted event depth |
|---|---:|---:|---:|---|---:|
| Treatment | 100,000 | 381 (33–662) | 40,031 | 1 / 1 / 3 / 1 / 1 | 10.43 |
| Treatment | 500,000 | 343 (74–535) | 44,216 | 1 / 1 / 1 / 1 / 1 | 44.23 |
| Treatment | 900,000 | 521 (429–638) | 37,638 | 1 / 1 / 1 / 1 / 1 | 69.40 |
| No mutation | 100,000 | 2.8 (1–4) | 27,220 | 3 / 1 / 4 / 4 / 2 | 0 |
| No mutation | 500,000 | 2.0 (1–3) | 26,921 | 2 / 1 / 2 / 3 / 2 | 0 |
| No mutation | 900,000 | 2.0 (1–3) | 26,164 | 2 / 1 / 2 / 3 / 2 | 0 |

The treatment bundles contained 2,937,018 mutation edges total (per seed: 467,436; 926,375; 708,473; 490,216; 344,518). No-mutation bundles contained zero mutation edges. Yet every no-mutation run at every sampled step had at least one founder origin lost from the extant census; the origin counts above show that sorting among standing founder variation occurs without mutation. Conversely, treatment's late single-origin censuses show lineage-origin concentration, not that the surviving genome's success was caused by a particular mutation.

## What this establishes—and what it does not

The report assigns each observed lineage to the founder-instance root reached by following the logged genome-lineage parent edges. It checks that the stored mutation table has one edge per manifest-reported mutation, that every edge can be traced to an initialized founder, and that mutation IDs fit the source's final-step and cell-index bounds. At sampled censuses, lineage IDs cannot be from the future and summed lineage cells cannot exceed world capacity. A missing census is represented as unavailable (`null`), while a recorded census with zero lineages is explicitly `zero-extant`; missing data is never converted to a zero (`tools/lib/foundation-ancestry.ts:145-212`).

This is genetic-origin accounting, not a complete organism pedigree. Fission, fusion, budding, tissue mixing and ecological interactions can make a copied-genome root inadequate to explain organism-level history or fitness. Only three censuses are summarized, so intermediate turnover is not measured. The sample supports the narrower conclusion that no-mutation histories still sort among standing founders and that logged mutation ancestry becomes deeper in the treatment samples. It cannot attribute treatment/no-mutation differences to mutation, establish functional novelty, or prove that a particular founder or mutation caused a population outcome. Matched founder-genotype reconstructions and functional/lifecycle transmission assays remain necessary for those claims.
