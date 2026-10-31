# Program soup in the garden (2026-10-31)

The BFF program soup (`tools/soup/*`, a byte-exact port of Google's cubff, PR #126) grows self-copying 64-byte programs out of random bytes. This note covers three things: the public `/soup/` page (Part A, built in this change), a shared soup on the archipelago (Part B, designed here and built as a minimal slice), and what tape genomes in the ecology would take (Part C, scoping only, no code).

## Part A. The page

`/soup/` ships with the site: it is no longer removed in `Dockerfile.site` or blocked in `deploy/Caddyfile`, it has a canonical link and a sitemap entry, it uses the site header, footer, paper theme and sun accent, and the Worlds page lists it under "A different chemistry". It is not a lab preset: it does not use the ecology's chemistry, and the existing "Random soup" preset is a different world.

The copy stays honest. On the paper's 240 × 135 grid, one of our two seeds produced copiers, after about 17,000 steps (grid seed 1, step 16,961). Grid seed 2's apparent transition at 38,913 was a short entropy dip in which every program stayed distinct, so it is not claimed.

## Part B. A shared soup on the archipelago

### Why the soup suits the archipelago

The soup is byte-deterministic. Every random draw is SplitMix64 keyed on (seed, epoch, pair, byte), and the CPU (`tools/soup/bff.ts`) and WebGPU (`tools/soup/gpu.ts`) paths produce identical bytes. A run resumed from a snapshot at epoch E equals a continuous run. So a segment is a pure function: snapshot at epoch E, plus N epochs, gives a snapshot at E + N. Any island can run any segment, and a second island can check it by recomputing it and comparing hashes.

### Why a separate plane, not a kind inside `Coordinator.Queue`

`Coordinator.Queue` is one serialized GenServer of about 3,000 lines, and most of it assumes the ecology:

- checkpoints are `.blck` artifacts that `Coordinator.Checkpoint` parses and validates, and `Coordinator.Store.put/3` re-validates them;
- runs carry observer state, bundle files and metrics versions;
- metapopulation rings, pond capabilities, interventions and garden days all hang off the segment.

None of this applies to a soup. Adding a soup kind would add a branch to every one of those paths. `Coordinator.Discovery` already shows the alternative: a plane with its own GenServer, data directory, state file and routes.

So the soup gets `Coordinator.Soup`, with its own data directory (`:soup_data_dir`, default `data-soup`), its own routes under `/api/soup`, and the same island identity. An island joins once through `POST /api/islands` and authenticates soup requests with the same island id and token. It shares no state with the queue. Snapshots are opaque blobs in its own content-addressed store, `Coordinator.Store.put_blob/3` under the soup data directory, and never pass through `Coordinator.Checkpoint`.

### Model

A **soup world** is registered by an administrator. It holds:

- `name`;
- `seed` (u32);
- either a grid (`width`, `height`, `radius`) or a well-mixed `num`;
- `mutation` (out of 2^30);
- `lang` (`noheads`);
- `epochsPerSegment`;
- `segments`, the number of segments in the chain;
- `verifyEvery`, an integer ≥ 1: every `verifyEvery`-th segment is replayed.

The world is a chain of segments. Segment k runs epochs `[k·N, (k+1)·N)`. Segment 0 starts from the seed (no upload, since the initial soup derives from it). Segment k > 0 starts from segment k − 1's accepted snapshot and is offered only once that snapshot is accepted.

Segment ids are `<world>.<k>` (world names have no dots). A segment moves through `pending → leased → done → verified`, or `diverged`; `blocked` is a separate flag on every segment after a divergence. `next` offers a pending verify before a run. The rules:

- **Run.** `POST /api/soup/next` leases the lowest pending segment whose predecessor is done to the asking island. The island fetches the start snapshot (`GET /api/soup/segments/:id/start`, not needed for segment 0), runs N epochs, uploads the end snapshot (`PUT /api/soup/segments/:id/snapshot`), then completes (`POST /api/soup/segments/:id/complete` with `{lease, sha}`, the SHA-256 of what it uploaded). An accepted end snapshot can be fetched with `GET /api/soup/segments/:id/snapshot`, which is how the chain's last snapshot is read. `GET /api/soup/status` (admin) lists every world's chain and head.
- **Upload check.** The coordinator streams the upload to a staging file and checks the header against the world: magic, version, seed, size, grid, mutation and lang, with end epoch = start + N and exact length. It records the file's SHA-256 against that attempt. A completion's hash must equal the hash its own attempt uploaded.
- **Verify.** Segment k is replayed when `k % verifyEvery == 0`, and the last segment always is. The replay goes to a different island than the one that ran it, through the same `next` route. The verifier uploads nothing and reports its end hash. If the hashes match, the segment is `verified`. If they differ, it is `diverged` and every later segment is blocked. The verifier's start snapshot is the accepted predecessor's, so a lying runner can only be caught one segment at a time, and blocking successors stops a bad history from spreading.
- **Uploads.** One upload per lease: the same bytes again are accepted, different bytes are refused. Snapshots are published durably (fsync, rename, fsync the directory) before any state names them. A snapshot nothing needs any more (an expired or refused attempt's, a diverged segment's) is deleted; accepted ones, blocked ones included, are kept.
- **Islands.** Every authenticated soup request counts as the island being seen. A soup lease also holds its island in the queue's island table until the lease ends, so a full table never drops an island that is still computing; the hold is set in the same call that authenticates, and re-applied for every live lease when the coordinator restarts. The Deno island retries a 429 (joins included) after the coordinator's suggested wait, and gives up a task only when that wait would outrun its lease. Snapshot downloads stream from an open file, so cleanup cannot cut one off.
- **Leases.** Leases expire after `:soup_lease_ms` (default 10 minutes; `BL_SOUP_LEASE_MS`). An expired lease returns the segment to pending (or the verify to waiting) on the next `next` call, and a late completion is refused.

### Snapshot format (`BLSOUP`, version 1)

All header fields are little-endian, 64 bytes in total:

| offset | field |
|---|---|
| 0 | magic `"BLSOUP\0\0"` (8 bytes) |
| 8 | version u32 = 1 |
| 12 | seed u32 |
| 16 | num u32 |
| 20 | width u32 (0 for well-mixed) |
| 24 | height u32 (0 for well-mixed) |
| 28 | radius u32 (0 for well-mixed) |
| 32 | mutation u32 (out of 2^30) |
| 36 | lang u32 (0 = noheads, 1 = heads) |
| 40 | epoch, low u32 |
| 44 | epoch, high u32 |
| 48–63 | reserved, zero |

Then `num × 64` program bytes, exactly what `Soup.programs` holds. The snapshot's identity is the SHA-256 of the whole file, header included, so the hash also pins the parameters and epoch. `tools/soup/snapshot.ts` encodes, decodes and resumes snapshots, on the CPU or the GPU.

### Size

| soup | programs | snapshot | 16 snapshots (16k epochs, N = 1024) |
|---|---|---|---|
| 240 × 135 grid | 32,400 | 2.07 MB | 33 MB |
| 2^17 well-mixed | 131,072 | 8.39 MB | 134 MB |

Uploads stream to disk, and each one is capped at its world's exact snapshot length; `num` is limited to 2^20 (a 64 MB snapshot). Random early soups do not compress, but a post-takeover soup is mostly copies and compresses well. That makes gzip on upload a cheap later win, though the minimal slice does not do it. Only the chain's accepted snapshots are kept. A future pruning rule could keep every k-th snapshot plus the head, because any dropped one can be recomputed from its predecessor.

### Minimal slice, as built

- `apps/coordinator/lib/coordinator/soup.ex` (`Coordinator.Soup`) and `CoordinatorWeb.SoupController`: register, next, start, snapshot upload, complete and status, with tests in `apps/coordinator/test/coordinator/soup_test.exs` and `apps/coordinator/test/coordinator_web/soup_api_test.exs`.
- `tools/soup/snapshot.ts`: the format, with vitest coverage in `tools/test/soup-snapshot.test.ts`.
- `tools/soup_island.ts`: a Deno island that joins, takes soup segments and runs them on WebGPU when available, otherwise on the CPU. It checks that its start snapshot hashes to the `startSha` it was given.
- `tests/deno/soup_island.ts`: end to end. It starts a scratch coordinator, registers a small grid soup, runs two islands until every segment is done and the verified ones match, and checks that the chain's last snapshot equals a continuous local run byte for byte. A second world has one island upload wrong bytes under a valid header; the other island's replay marks that segment diverged and blocks the rest.

### Not in the slice

- The browser island (`island.html`) taking soup work.
- A public view of the shared soup (its head snapshot drawn on `/soup/`).
- Gzip, pruning, and the status page.
- The deploy itself.

## Part C. Tape genomes in the ecology (scoping only)

The question: can cells in the ecology (`packages/sim-ref`, `packages/sim-gpu`) carry a 64-byte BFF tape whose *copying* provides heredity, so that inheritance comes from programs that happen to copy, not from a declared copy step?

### What heredity is today

Each cell has a 44-word genome: lineage id, μ, σ, motility gain and 160 int8 controller weights. When biomass flows into a cell, the cell's genome is chosen by a lottery weighted by incoming bound mass. Each step, each cell makes at most one mutation draw, with a probability that scales with the biomass it newly made; a mutation that happens mints a new lineage id. The copying is declared: transport copies the winner's genome.

### What a tape would change

1. **State.** 16 more u32 channels per cell, for the tape. That is 64 bytes per cell, 4 MB more per checkpoint at 256 × 256. The checkpoint encoding (`packages/schema`) needs a new section and a format version, and the census, tracker and lineage inspector need to read it.
2. **Pairing.** Where both cells hold biomass, neighbouring tapes are paired, concatenated, run with the BFF interpreter, and split back, as in the soup. The soup's grid pairing walks a shuffled order with "used" marks, which is sequential. On a GPU the ecology needs a conflict-free parallel matching: a domino tiling whose orientation and offset rotate with a step-keyed draw, so each cell is in at most one pair per interaction step. Interaction can run every K steps to bound cost.
3. **Energy, not matter.** Tape bytes are information, so matter conservation is untouched. Copying should still cost something. Charge E per executed instruction (capped at 8,192 per pair) and export it as heat, so the energy ledger stays exact. The bound needed is `ops × kOp ≤ POOL_MAX`, for example kOp ≤ 2^15 with ops ≤ 2^13. A pair that cannot pay stops early, and the stop is deterministic.
4. **Phenotype.** This is the crux. In the soup the program is both genotype and phenotype, because the only thing it does is copy. In the ecology a tape must also shape survival, or copiers spread as neutral parasites on the matter dynamics. Three options:
   - Read a few traits from fixed tape bytes, for example μ, σ, gain and a small controller. This is simple, but 64 bytes cannot hold 160 weights, so the controller would shrink, or most weights would stay on the old genome, which is still declared heredity.
   - Make the tape the controller: run it each step on the cell's inputs, and read the outputs from the tape. This is expensive, and its fitness landscape is unknown.
   - Keep tapes phenotypically inert at first and ask only whether copiers arise and persist inside a moving, dying, matter-limited world. That is the real first question.
5. **Mutation and lineage.** Mutation uses the existing counter PRNG keyed on (seed, step, cell, byte), which is already GPU-safe. Lineage ids would be minted when a tape changes. The genome lottery would either stop copying the tape (heredity only by BFF) or copy it as a control arm. The comparison between the two is the experiment.
6. **GPU.** The interpreter already exists in WGSL with a byte-exact CPU twin (`tools/soup/gpu.ts`, `tools/soup/bff.ts`). It would move into `packages/sim-gpu/src/shaders.ts` as a separate pass with the same golden discipline. The 8,192-step loop diverges badly on a GPU. The soup tolerates that, and the ecology can afford it every K steps.

### Rules it must respect

- **Integer physics.** BFF is pure byte arithmetic, so it fits.
- **Conservation.** Matter is untouched. Energy stays exact if the instruction cost is exported as heat.
- **`RULE_VERSION` and golden pins.** The tape is an optional `WorldConfig` key that `defaultConfig()` leaves absent, like `genes` and the cells sandbox, so every existing pin stays byte-identical and no bump is needed while it is a sandbox. New golden cases (`tape-pairing`, `tape-bounds` at ops = 8,192 and the maximum kOp) pin it. If it ever becomes the default, that is a `RULE_VERSION` bump and a deliberate re-pin.
- **Bounds.** Add the energy bound above to `docs/rules.md`, and have `validateConfig` cap kOp, K and the step limit.

### Suggested rungs

- **T0.** The tape as an inert passenger copied with the genome lottery. This tests plumbing, checkpoints and pins, and changes no dynamics when off.
- **T1.** Pairing on. The genome lottery no longer copies the tape, and tapes have no phenotype. Do copiers arise and hold ground in a living world? This is the null that most needs testing, because matter flow and death may erase tapes faster than copiers spread.
- **T2.** A few traits read from the tape's data bytes. Does selection on survival bend which copiers win?
- **T3.** Heredity only by tape: the genome is derived from the tape, and the lottery copies nothing.

Each rung is a screen with a pre-stated pass rule, the same way the sandboxes are judged. T1 is the cheapest real test and the one to run first.
