# Founder-policy input inventory

Snapshot verification passed for all 19 manifest entries. Their recorded byte counts and SHA-256 values match the files under `experiments/foundations/selection-audit-v1/inputs/`. The manifest SHA-256 is `79c0b26e028f88ddf6f05b93f4d0f94cee681786fcee2afd4b0e3e0576a36e96`. Four current source files (`codeEvaluate, codeMapelites, codeBootstrap, codeFoundations`) differ from their pinned code snapshots; those snapshot files still match their manifest records.

The archive records a committed viable prefix of **1990** observations and legacy resume `[{"from":200,"exact":false}]`. All 1990 prefix observations satisfy `survived >= 1`; full-genome deduplication leaves **1990** genomes. Hamming distance across `mu`, `sigma`, `motGain`, and all 160 signed weights, threshold 10, single-linkage yields **62 genetic clusters (not cohorts)**, with 35606 within-threshold pairs and 4 singleton clusters. Largest cluster sizes: 265, 157, 136, 127, 84, 79, 78, 77, 65, 61. These counts are conditional on the archived viable prefix; quality-zero candidate identities are absent.

## Pinned input hashes

| ID | SHA-256 | Bytes |
|---|---|---:|
| archive | `9504ecb73592c396e9fd73d7af424099a423353ce6edbda5ff9210dd5a882fc6` | 99708 |
| viable | `e6eaebf84ada1410a0591d7383a32eeb1eea4da97d212b1e63eea2c8d7032645` | 1567348 |
| gate | `f28b30c01e743de3780e5231cecdcb8eb6bdb2415ad4d90359b5e9118fb795a1` | 1463731 |
| confirm | `44ac88b232e44017ac6c651dde8b88a36948494687443d2030a42c819a5d7389` | 1707193 |
| retest | `44f3bda3c3145f6b96b2dbfc06dde0c513e1c9a1fde01953bc159fb58caad475` | 86016 |
| replicate | `56fafd86e505c4737bc1623b35720389219a7a624ded8eda14887d609e47f6db` | 10793 |
| founders | `db5da8085a8f01a27f42cb1033e59efb4cbba3743e1d9c0ff41a92b1e34da436` | 8951 |
| fdSubjects | `a31f93bbabbcefd5f11272d9479c2a374ba5a99d7e6e3bf73c0b3ea67461265c` | 12381 |
| fdPool | `2d96aa3c99e475dd27374f6f7f549f102a434b1b3231e964870852ad0a7785d1` | 393353 |
| fdResults | `d97d7723e18529c7e47191b3e49762cca005d0d6547e818c5c3175cae8851876` | 150925 |
| codeEvaluate | `a8d6cc30cd41c752da7907ee66e10dc947209df9b8497ea0160a66cc306a8cc0` | 15515 |
| codeMapelites | `bc2b4402c58342b847411b95d249847fa451924e692b9a39bae35590b32b1d08` | 9605 |
| codeRetest | `80ea2e3a723af000d4ab94740c139765b4b114203478851ce5fc2d00c69bdfb9` | 6367 |
| codeGenome | `77a1a3cc32bd4bd3bc638ba9e0fec5e7a552fd815631b02f63f3ac566d63cdd9` | 3849 |
| codeGenetics | `ac96945f62a9f675b76aea1e2939d9288f66cac947c8850ec51e52ee243ccb93` | 2457 |
| codeProbability | `da12ccc972b40b416b70ae8a2892cbfbb9fd44a1b8fd88529576297d9ed5c854` | 15580 |
| codeBootstrap | `2b98289a9bb32f1ea9eedaf9f2e8b6deb6851046cfac8073b4f81ae2454240dd` | 18454 |
| codeRetestTool | `69723b499890de7277fa5a5dc1ebc298e1cf2f3239106fa9acda02a02eee7f31` | 11905 |
| codeFoundations | `3c6efdff3ce09a0b0523a09c4f343f3a54fb50b1d773f831d13536e245daed8c` | 73780 |

## Seed provenance and collision check

The source main plan is `/Users/nicholas/develop/browser-life/docs/plan.md` (SHA-256 `da13bf7c68f1b271ce5b1b9f892e2be61b83ee44c0110d773e35535d9570dcbb`); its explicit reservations are 4,000,001–4,599,999 at line 192 and 4,700,001–4,799,999 at line 446. The Gate A protocol `/Users/nicholas/develop/browser-life-foundations/docs/gate-a-protocol-v1.md` (SHA-256 `dec7efd7b1f38f6607be0d955c6d972950d280a568990b9e7e2fbdb6a7cc2618`) specifies seed 6,100,001 at line 15. The approved allocations below are recorded at line 49 of `docs/founder-policy-protocol-v1.md` (SHA-256 `69312672eb199396715b43637b74034cf5112cb4cd2f4b887978088c00775b05`). Allocation ranges are pairwise disjoint and clear the recorded prior blocks. Historical numeric seed mentions are not classified as reserved ranges unless the source explicitly reserves them.

| Allocation | Seed range | Count |
|---|---:|---:|
| cohortDraws | 6200001–6200008 | 8 |
| evolution | 6210001–6210004 | 4 |
| pilotArchiveSelection | 6220001–6220001 | 1 |
| pilotAssays | 6220101–6220104 | 4 |
| mainAssays | 6230001–6230004 | 4 |
| sampling | 6240001–6245184 | 5184 |
| bootstrap | 6250001–6250001 | 1 |
| repairAssays | 6260101–6260104 | 4 |
| permutation | 6270001–6270004 | 4 |

Total allocated seed values: **5214**.
