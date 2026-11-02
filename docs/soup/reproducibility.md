# Program soup evidence audit — 2026-10-31

Audited PR #126 tip `1b96658e026de81a5e3f39b2717bb7e36d722f4a` in a separate worktree. This supersedes the brief's `8e04dbb22d866d32a00acb31337915e6215dac47` as the inspected revision, not as the historical run revision (which is unknown).

Upstream inspected: https://github.com/paradigms-of-intelligence/cubff/tree/f212e849027c98fcf4b242eccfb5fed435223e23 . `common_language.h` implements the 13-partner, four-extra-generation CheckSelfRep assay and greedy spatial pairing; `bff.inc.h` defines the interpreter; `make_2d_pattern.py` enumerates non-wrapping radius-2 square neighbours. Source correspondence is not independent execution proof.

## What the evidence establishes

The seed-2 epoch-12609 fixture scores 64 in a finite, deterministic copying assay. This is a position-wise consensus score, not 64 independent successful births, nor a guarantee for arbitrary partners. The interpreter has byte-copy instructions; it has no whole-program reproduction operation. Existing Browser Life also infers individuals and reproduction rather than declaring an organism reproduction method.

A compression collapse and declining distinct count establish population restructuring if measured from authentic snapshots. Neither alone establishes replication: inert repeated material also compresses. A top-program probe does not measure population-wide replicator prevalence. Takeover requires frequency trajectories with an explicit family definition and representative copying assays; persistence requires later observations over a declared horizon. Evolution requires heritable changes and differential success; adaptation requires an explicit environmental performance comparison. None of these finite tests demonstrates open-ended evolution.

The upstream golden is compressed sizes, not state bytes. Originally the automated test checked only epochs 1 and 65; it now checks all five supplied rows through 257. CPU/WebGPU equality is a separate comparison between two ports sharing CPU initialization and pairing, so common-mode errors remain possible.

## Smallest durable evidence package

Publish an immutable archive with a DOI or stable release URL, plus a committed manifest with SHA-256 for every file. Do not move or rewrite historical outputs. For each seed 1, 2, 3, 4 include:

- Exact producing source SHA, dirty patch if any, command, runtime and GPU/driver, upstream SHA, compressor implementation/version and quality 2/window 24. Unknown historical provenance must remain explicitly unknown.
- Original params.json, complete log.csv and transition.json when present; retain resume commands, source snapshot hashes, original segment logs and stopping reasons. Current params.json is overwritten on resume and is not sufficient provenance.
- Seed; noheads; 131072 programs of 64 bytes; mutation integer 262144 (probability 1/4096); 8192 interpreter steps; well-mixed pairing; census every 64 (epochs 1,65,...); threshold H+ > 1 bit/byte; save 2048; after 1024; cap 16384. Confirm these against original metadata rather than assuming defaults.
- Seed 2: snapshot immediately before and at first measured threshold crossing, epoch 12609 fixture-source snapshot, and final post-transition snapshot. For seeds 1,3,4: final epoch-16384 snapshots and complete census series. Include initial-state hashes for all seeds. Every snapshot is 8388608 bytes.
- Full SHA-256 state hashes, compressed byte counts (avoid ambiguous MB), byte entropy, H+, distinct count, top count/share, top program bytes and assay seed/language/score at each retained snapshot. `tools/soup-receipt.ts` recomputes these without modifying the input; record compressor identity separately.

A first detected crossing at t only brackets onset between the preceding census and t. “No transition through 16384” means no sampled H+ crossing, not no replicators or no transient event between censuses. Seed 2's approximate 11800 / 7.76 MB to 1.3 MB and seeds 1,3,4's negatives remain reported, not independently verified here. No full historical soup outputs were found in the main checkout's runs directory; no population hashes should be invented.

## Independent repeats

Repeat all four seeds from initialization in fresh output directories, using the pinned producing revision and parameters, comparing hashes at every retained epoch and measurements with the same compressor. Seed 2 may stop after the original post-transition window; negative runs must reach 16384. A snapshot continuation checks replay, not emergence from randomness. One independent full repeat per seed establishes deterministic reproducibility, not transition probability; estimating rates requires a separately specified seed ensemble and uncertainty intervals.

Example (substitute each seed and a new directory):

```sh
deno run -A tools/soup.ts --seed 2 --num-log2 17 --lang noheads --mutation 0.000244140625 --epochs 16384 --every 64 --transition 1 --after 1024 --save 2048 --out runs/independent/seed-2
```

Cross-check representative epochs with CPU and GPU, and independently compiled pinned cubff if available. Compression equality is weaker than full-state equality. Do not change seeds, mutation, pairing or stopping rules to obtain a desired outcome.

## Grid is a separate experiment

The 240x135 radius-2 non-wrapping grid uses greedy neighbour matching; unmatched slots still mutate. It has no upstream golden dataset. Property tests and CPU/GPU equality validate consistency, not upstream equivalence. Require an independently generated upstream state fixture including boundary cells, unmatched slots, pairing order and mutation, then full grid repeats with separate manifests. Never pool its transition times with well-mixed results. Planted copier demonstrations do not establish spontaneous emergence.

## Local verification receipts

On 2026-10-31, Deno 2.9.8: `tests/deno/soup_gpu.ts` passed all three 40-epoch cases (4096 programs, seed 7, mutation 1/64). Differing bytes: zero; CPU/GPU instruction totals: noheads 4337632, heads 6819374, grid 64x64 radius 2 3364444. These are representative checks, not full experiment repeats.

The original 19-test suite including the two-row upstream golden passed. `deno check --no-lock tools/soup-receipt.ts` passed. A 512-program seed-2 CPU run for 20 epochs produced SHA-256 `c67f95e2379acfbba37d50b76c528037af8e3c72a926ba3738729b28b49c29a6`, independently matched by `shasum`; receipt measurements with brotli 1.2.1: 32631 compressed bytes, 512 distinct programs, top count 1, top selfRep 0. This small population is only a receipt-tool smoke check.

The expanded suite also passed: 19/19 tests, all five upstream compressed sizes through epoch 257, in 207.98 seconds. Expected bytes: 8388776, 8286015, 8216575, 8161711, 8114689. No upstream full-state comparison or full seed-1/2/3/4 repeat was performed.

## Capturing the extra checkpoints

The default save cadence alone does not retain all required states. After the full run, read the first-crossing epoch t from its transition.json and the previous census epoch p from log.csv. Replay from the latest saved snapshot strictly before p into a NEW directory, with the original seed and all original parameters, `--epochs p --after 16384`; the CLI writes a final snapshot at p. Similarly replay to 12609 for seed 2. For example, if the checkpoint before the desired epoch is 10240:

```sh
deno run -A tools/soup.ts --seed 2 --num-log2 17 --lang noheads --mutation 0.000244140625 --epochs 12609 --every 64 --transition 1 --after 16384 --save 2048 --load runs/independent/seed-2/soup-10240.bin --out runs/independent-capture/seed-2-12609
deno run -A tools/soup-receipt.ts runs/independent-capture/seed-2-12609/soup-12609.bin noheads > runs/independent-capture/seed-2-12609/receipt.json
```

Use the actual preceding checkpoint and p, not the example numbers, for the pre-crossing capture. Keep original/replay manifests distinct because their stopping settings differ. After capturing p, continue from that snapshot in another fresh directory to the original transition epoch t, using the same seed and original parameters with --epochs t --after 16384. Compare the resulting soup-t.bin SHA-256 to the original soup-t-transition.bin before accepting p as evidence. Comparing only the loaded checkpoint does not validate replay. For the 12609 capture, compare directly to the original soup-12609.bin when available; otherwise continue to the next original saved epoch and compare there. Do not overwrite old receipts.

Capture initial-state hashes directly with the pinned implementation (run once per seed, writing to a fresh evidence file):

```sh
deno eval 'import { Soup } from "./tools/soup/bff.ts"; const s = new Soup({num:131072, seed:2, lang:"noheads", mutation:262144}); const h = new Uint8Array(await crypto.subtle.digest("SHA-256", s.programs)); console.log(Array.from(h, x => x.toString(16).padStart(2,"0")).join(""));'
```

The Sol 6.1 High read-only review found no implementation defects; its documentation finding about extra checkpoint capture is addressed above.
