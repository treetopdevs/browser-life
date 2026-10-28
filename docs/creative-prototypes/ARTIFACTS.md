# Large artifacts kept out of git

The creative prototypes (PRs #85–#100) were squashed onto main without their large replay JSONs and videos: about 70 MB (67 MiB) in the 15 files below.

Without them:

- The lab pages still work. The ecosystem archive shows its census and hides the movies; the currents page runs without its replay manifest.
- Unit tests that read them skip, and so do the ecosystem-archive movie checks in `tests/e2e/ecosystem-archive.spec.ts` (one test checks the page without them instead).
- These need the files restored: `--check` and `--replay-check` in `tools/*/explore*.ts`; `tools/hungry-shapes/explore.ts` in every mode (it reads `development-pilot.json`); `tools/particles/check-seasons-compatibility.ts` and `check-still-compatibility.ts`.
- The videos embedded in `comparison.html` and `hungry-shapes.html` in this folder do not play.

Every file is still in git history at the tip of `codex/hungry-shapes` (`511d76c6`, on origin). From the repository root:

```bash
git fetch origin codex/hungry-shapes
grep -o '^| `[^`]*`' docs/creative-prototypes/ARTIFACTS.md | cut -d'`' -f2 | while read f; do mkdir -p "$(dirname "$f")"; git show "511d76c6:$f" > "$f"; done
```

Then compare with the hashes below using `shasum -a 256`. A copy also sits in the gitignored `runs/creative-prototypes-85-100/` of the main checkout on the Mac where the squash was made.

| Path | Bytes | SHA-256 |
|---|---|---|
| `apps/lab/src/ecosystem/archive-assets/ecosystem-archive-1101.mp4` | 6494328 | `f382495dea160080085ef462f0fe1649fb2fc023d3a05bf5d5430252111c962a` |
| `apps/lab/src/ecosystem/archive-assets/ecosystem-archive-1102.mp4` | 6500156 | `376c660c864379b72ea290ab7be33e897f958662757b4df45d01bee261722ae4` |
| `apps/lab/src/ecosystem/archive-assets/ecosystem-archive-1103.mp4` | 4678375 | `e87bac5cf0f14b4a90824d62db5d869f48623c8fb5d88c40a130136abd67f0ae` |
| `docs/creative-prototypes/comparison-media/development.mp4` | 559096 | `df183fa7e9e6883965cd371e82ebcfdf6747d811b75afdff29570141e6ee3a76` |
| `docs/creative-prototypes/comparison-media/spatial.mp4` | 284029 | `67cb6ba30cbfa0bd350a577a77f601fc41813c09ea4945326b33e5474f89cf7a` |
| `docs/creative-prototypes/current-pilot.json` | 6494355 | `79b61f91d86b22d773cdf485999ecc1a3cb1a3abfb0fcfe0cfbe51a76db17177` |
| `docs/creative-prototypes/development-pilot.json` | 5645934 | `a39b636dbbb9cf00c1302fab41e85984096e6a8e2fb2de3ae42447dca5ea7e5a` |
| `docs/creative-prototypes/history/oases-v3-pilot.json` | 1020910 | `e8c9f77ce698519c79fa772e529ac09f67f68c758fda1594a5959e49c4c34fd0` |
| `docs/creative-prototypes/hungry-shapes-media/seed-1201.mp4` | 4488619 | `3567079df26ef06f19a4605ac5c382972f3e7526849f2cfa198145a3ca6b1400` |
| `docs/creative-prototypes/hungry-shapes-seed-1201.json` | 3045614 | `2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520` |
| `docs/creative-prototypes/matter-pilot.json` | 5779744 | `029ceec08cc459f465ab0026835abd0570618ceabfa762df495241e45d2011c4` |
| `docs/creative-prototypes/motifs-pilot.json` | 2759102 | `9dc625890ec985a7dc05099d6c1981fee7a8784c7f86861e4e8f9209b779fe28` |
| `docs/creative-prototypes/oases-pilot.json` | 1020910 | `511364255bea5383f0a217520aa9e472e177cfd9efe65768d00fccd5e7eaf51f` |
| `docs/creative-prototypes/seasons-pilot.json` | 2772946 | `1797b21963f248ebda9953ef003a85ba5f5d3cb35780502e664f365924fb9ced` |
| `docs/creative-prototypes/spatial-pilot.json` | 18165195 | `a6f06a7e3cc4efd017651d71896710173873fca2592028ab029264bd843b8e5c` |
