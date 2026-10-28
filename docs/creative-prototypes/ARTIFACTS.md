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
sed '/^# Food-band line/q' docs/creative-prototypes/ARTIFACTS.md | grep -o '^| `[^`]*`' | cut -d'`' -f2 | while read f; do mkdir -p "$(dirname "$f")"; git show "511d76c6:$f" > "$f"; done
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

# Food-band line (PRs #101–#119)

The food-band experiments (PRs #101–#119, including #118's foothold seed-1203 replication) were squashed onto main the same way: 58 replay JSONs, archives and videos, about 304 MB, are kept out of git.

Without them:

- The lab pages and the result pages in this folder still load. Their videos do not play, and viewers that fetch a full replay JSON report it as missing.
- Unit tests in `tools/test/` and browser tests in `tests/e2e/` skip what needs these files. Each `tools/<experiment>/explore.ts` hashes its pinned replays when imported, so every test that imports it skips, pure gate checks included; tests that use only `apps/lab/src/*/model.ts` still run. `tools/test/food-schedule-769.test.ts` is left out by `vitest.config.ts` instead of being edited, because its published replay pins that file's hash.
- Every `tools/<experiment>/explore.ts` `--check`/`--replay-check` mode, each launcher's exact-regression preflight, and the capture scripts need the files restored. Most of those modules also pin `docs/creative-prototypes/hungry-shapes-seed-1201.json`, which the first section above lists; restore both sets.
- `food-band-foothold-replication-delivery-manifest.json` records hashes of two test files that the squash changed; nothing checks those hashes, so that record is out of date rather than broken.

Every file is still in git history on origin: in `codex/food-schedule-769` (`8c84eed5`, PR #117) or, for the foothold seed-1203 files, `codex/food-band-foothold` (`43c69124`, PR #118). From the repository root:

```bash
git fetch origin codex/food-schedule-769 codex/food-band-foothold
sed -n '/^# Food-band line/,$p' docs/creative-prototypes/ARTIFACTS.md | grep '^| `' | while IFS='|' read -r _ file _ _ commit _; do f=$(echo "$file" | tr -d ' `'); c=$(echo "$commit" | tr -d ' `'); mkdir -p "$(dirname "$f")"; git show "$c:$f" > "$f"; done
```

Then compare with the hashes below using `shasum -a 256`. A copy also sits in the gitignored `runs/food-line-101-119/` of the main checkout on the Mac where the squash was made.

| Path | Bytes | SHA-256 | Commit |
|---|---|---|---|
| `docs/creative-prototypes/alternating-food-media/seed-1203-paired.mp4` | 1520635 | `0780f2a12e847f4195195b0e9b3f4a92acbd7907fba205da43e9f3ddf5eb926b` | `8c84eed5` |
| `docs/creative-prototypes/alternating-food-replication-media/seed-1202-paired.mp4` | 1460574 | `cb9181bcddfe1c99bb1b19e4cfd95ed75ef502d521f285b430f607e95dd40527` | `8c84eed5` |
| `docs/creative-prototypes/alternating-food-replication-seed-1202.json` | 4422855 | `69f00e582d085d69964f087f337cc8175392ee2bd48afcb0708a76b8f83d8117` | `8c84eed5` |
| `docs/creative-prototypes/alternating-food-seed-1203.json` | 4846380 | `f4f5e28294c4806b2b31b4776dbdd42ab9cf70d4307279787c2649298d34123b` | `8c84eed5` |
| `docs/creative-prototypes/food-band-foothold-media/seed-1202-paired.mp4` | 1606562 | `89b640fff1ef2a4dc3a1372a0522dbd5da134565067bfb2a9f10ba95fc9c04c6` | `8c84eed5` |
| `docs/creative-prototypes/food-band-foothold-replication-attempt-20261027T224410Z.tar.gz` | 2310162 | `8b12fb2b341afa52c4d905fde2b20aaa7268617e76d6233069e89bbf25c75443` | `43c69124` |
| `docs/creative-prototypes/food-band-foothold-replication-media/seed-1203-paired.mp4` | 1476362 | `c2f7220a119815fc359b24335f9b77ef230ff7c667977bfe15d3133a5376a1e1` | `43c69124` |
| `docs/creative-prototypes/food-band-foothold-replication-seed-1203.json` | 4973223 | `e832d1f707439a36439668469eabe7e0da349e5aabef426941ccad8a4042683d` | `43c69124` |
| `docs/creative-prototypes/food-band-foothold-seed-1202.json` | 5193411 | `eb8da3c6df9e52d5a4d35a34837c611f737f9fa696fdc1fdbe982fd157803bad` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-media/seed-1201-paired.mp4` | 3851626 | `6f139d6736dc03f4d313a0167681e9d96dded08ea9ebe751eba9850b9a7af977` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-moving-band-seed-1201.json` | 10070026 | `17696e963d1112254207ad0ec6f36927709a9b9859c498ca276ae0bf0358bf43` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-replication-media/seed-1202-paired.mp4` | 3815931 | `45fe0b5edfbfe83ce81f02d9b8f3583de5b4fe517fc75a86d32e4f4c2f537eeb` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-replication-media/seed-1203-paired.mp4` | 3790673 | `d18ac7c04bfb3bd5b7a6a528c073b73e37cf51c9b2a22f274a0eb248ec5c00e0` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-replication-moving-band-seed-1202.json` | 10143551 | `6dd8473c87bbf2750e4946b0bf687fd670615c00e7043a630503298c1d25bc91` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-replication-moving-band-seed-1203.json` | 10020915 | `098cd4c1cfb2df6376536a5cdd97b93eee449809aa03bb4b781eb08c7d71e15a` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-replication-stationary-band-seed-1202.json` | 10009150 | `a68f6c74c9db9caa7ca037d01a71e322a5c85103398aa05cff532793440a7007` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-replication-stationary-band-seed-1203.json` | 10085826 | `9d3605b74a1af17dd3a944810c3f161d6d2f71d45bce6ea18b4e0ef2f3760e6f` | `8c84eed5` |
| `docs/creative-prototypes/food-band-longevity-stationary-band-seed-1201.json` | 9878299 | `8e6a43d01a3b1a78820eac403c320822ea22efc00cb89917087924254052b468` | `8c84eed5` |
| `docs/creative-prototypes/food-floor-longevity-media/seed-1203.mp4` | 1722885 | `a80c39a87017cf31b40121a38ba9e9a3c770b273ca029b2543b23da15ca6ba6d` | `8c84eed5` |
| `docs/creative-prototypes/food-floor-longevity-replication-media/seed-1202.mp4` | 1805231 | `3a016f0c222b1cea7dc3220045375b158157400416ba62bacfd88aaf28203ae0` | `8c84eed5` |
| `docs/creative-prototypes/food-floor-longevity-replication-seed-1202.json` | 10120626 | `14565a78528152556140b68bedbd6d074e5f5dca556ecf0439094e945d5cef60` | `8c84eed5` |
| `docs/creative-prototypes/food-floor-longevity-seed-1203.json` | 9908912 | `25e2e563350c1f70ac3307c1d766c61f29fac4935f68f0e7f0ef37ad9c43dfd4` | `8c84eed5` |
| `docs/creative-prototypes/food-floor-replication-media/seed-1203-paired.mp4` | 1665189 | `8bfa2488c890069f2fb0cae308396946ef7781e50e416ddba3a25938021b401e` | `8c84eed5` |
| `docs/creative-prototypes/food-floor-replication-seed-1203.json` | 4971241 | `7b535bf0eb53c1c3ee192974efd7de61fa15bb99fe84308478b1639eaa8b753d` | `8c84eed5` |
| `docs/creative-prototypes/food-schedule-769-gate-3000-seed-1202.json` | 5119674 | `12c11952eeb15c61f86a7fd32fb04d12cd5bf4c9fd3991b4352988a869ee0a9e` | `8c84eed5` |
| `docs/creative-prototypes/food-schedule-769-media/seed-1202.mp4` | 2867193 | `181031996399639fa463e9ee6f772cb7f9a3270080f57e0691167ce08e48b224` | `8c84eed5` |
| `docs/creative-prototypes/food-schedule-769-seed-1202.json` | 10268263 | `b85338b80f163d80ffb40c54beb6c95f51a38cd2462d44c4ecd510fecaab2823` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-media/seed-1201-paired.mp4` | 948966 | `8bb48bb21b65e71509d091ad6cc395a50944f794ca5878b5fde20f7b377880d8` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-moving-band-seed-1201.json` | 4806861 | `46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-replication-media/seed-1202-paired.mp4` | 2968803 | `85ac884908f032ffdbbbd77be4cfff40a42e553fd06b4b32c88cf3c0efa91f5b` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-replication-media/seed-1203-paired.mp4` | 2941069 | `de41f53edc0c8b6ce6a679e325b9cefa6f7d234d27bf7a511275e117ed354797` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-replication-moving-band-seed-1202.json` | 4859286 | `183d90f551dcaf6c29ab4f397bba52d93365c22ad3315787423a49926a792a83` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-replication-moving-band-seed-1203.json` | 4842286 | `8ce7be228812002e2d03a2f68a15b9d1107e6fff022006ae9059003bb66e0c9b` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-replication-uniform-seed-1202.json` | 4752628 | `008c047b984c55236dc8fcec27f39083cd028e7790f8eaa1b963ca88bc5cce9f` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-replication-uniform-seed-1203.json` | 4732942 | `11b6ec8dd59de3fdd2e2447674b13e9409cf8cc1af04e69d8b2d3c90eea8e761` | `8c84eed5` |
| `docs/creative-prototypes/moving-food-uniform-seed-1201.json` | 4678532 | `1ae6bdc3c9f5bedd2b6f6cfb70aa9dc94e8acb8177f4c2ecda9c2859bf1e4458` | `8c84eed5` |
| `docs/creative-prototypes/split-food-media/seed-1202-paired.mp4` | 1727137 | `593d6fb2ca6d81fe33bed554e08b8566f37120a54f0d6e263c773dc38919c97a` | `8c84eed5` |
| `docs/creative-prototypes/split-food-replication-media/seed-1203-paired.mp4` | 1704886 | `54c5d03db3020a5cde816358c958dd0d05e1bd871debf2982714da0e269a7186` | `8c84eed5` |
| `docs/creative-prototypes/split-food-replication-seed-1203.json` | 4771666 | `edc38df48f5d08d198fe59d18a5eb9af0dbd068e37a30a49de82ab91797b5f14` | `8c84eed5` |
| `docs/creative-prototypes/split-food-seed-1202.json` | 4678730 | `3f99cf98531a9908a1a2ab9adb7ce2dd6566d2edd08afb4855d99267fbee033b` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-media/seed-1202-paired.mp4` | 2681413 | `9357039c7bd9753e0e3bf85aa443653a5571c4cc5a7333854326174e29ff418f` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-moving-band-seed-1202.json` | 4858272 | `1ba5caec32d22feef2482e13eab9550552bec974a6f9f7791c21714d375e598a` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-replication-media/seed-1201-paired.mp4` | 1780813 | `db2c45730c9899f6f0e3b05043418fd150a93ddd7eef936adecfd9463fd93218` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-replication-media/seed-1203-paired.mp4` | 1818775 | `4dc2048c20af3db815a49fdf0f13b882f679d391f610d577907cc586e2f9520d` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-replication-moving-band-seed-1201.json` | 4809751 | `570aba2c02c52b7f949c60990b8bf33aa929a5352728c75d01d547666299c294` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-replication-moving-band-seed-1203.json` | 4843971 | `000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1201.json` | 4757085 | `65e160a97cd829b6e740db757eaee7364228c4890116a8cb2422f56795675d2b` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1203.json` | 4788838 | `234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c` | `8c84eed5` |
| `docs/creative-prototypes/stationary-food-stationary-band-seed-1202.json` | 4708390 | `1c85fd8477644da9fb2bd54df0f5c1a463103db6ac49022e2caa2b0611badd39` | `8c84eed5` |
| `docs/creative-prototypes/uniform-endurance-media/seed-1201-ticks-6000-9000.mp4` | 498220 | `1ea0a372c4677c6d22742e1d93aacb5be45863251db3f43f6c277aa653edd09f` | `8c84eed5` |
| `docs/creative-prototypes/uniform-endurance-media/seed-1202-ticks-6000-9000.mp4` | 500353 | `d231540608834a8ee98e0b3671ac688f4a8cf07a8c1aa708d9a8a3aae0cf12ab` | `8c84eed5` |
| `docs/creative-prototypes/uniform-endurance-media/seed-1203-ticks-6000-9000.mp4` | 498659 | `e31835171e6c31b004c8b3617dadf1288b0babe1b6c5abb6b0be19cfce141a86` | `8c84eed5` |
| `docs/creative-prototypes/uniform-endurance-seed-1201.json` | 14299176 | `6b480bced89b1c7bf9ab759c84fb28c9bfdcd1f9c2a6ecc7e922ddba1a590221` | `8c84eed5` |
| `docs/creative-prototypes/uniform-endurance-seed-1202.json` | 14329719 | `a67a99bde41317f59c3b0fdf6521cc561c9a2b4db38d12783ea2f9be0d5f5602` | `8c84eed5` |
| `docs/creative-prototypes/uniform-endurance-seed-1203.json` | 14288399 | `94fa6328fb74038793f859d629ef9535e5f610dd22eceeaa74d4677218b2b15d` | `8c84eed5` |
| `docs/creative-prototypes/uniform-food-seed-1201.json` | 9465669 | `af3c651b4b6115ff084b3089ccdf87143d541a7833c87636efe6fb77c2313850` | `8c84eed5` |
| `docs/creative-prototypes/uniform-food-seed-1202.json` | 9460791 | `9c2c0cf304fb8a015e746b96ee1d1c137404f4d3022767f207de57fe9bd092c7` | `8c84eed5` |
| `docs/creative-prototypes/uniform-food-seed-1203.json` | 9407129 | `96fe9be0c678fa40cea90341dae25d1f83f474b1813a4fc40fa19a0c547f86ae` | `8c84eed5` |
