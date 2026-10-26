# Ecosystem archive checks

Run the following from the repository root.

- `pnpm vitest run tools/test/ecosystem-library.test.ts` checks raw-record validation, provenance hash failures, summary mismatches, and mocked media-probe failures without requiring ffmpeg.
- `python3 tools/ecosystem-library/verify.py` checks committed raw histories, hashes, reaggregated summaries, staged tick-3,000 records, and delivered video files. It requires `ffprobe`.
- `python3 tools/ecosystem-library/verify.py --originals` also checks the original 576px movies in the source worktree; this optional check fails if that worktree or any original movie is absent.
- `node --experimental-strip-types tools/ecosystem-library/replay-3000.ts` runs the bounded three-seed model parity check. Use Node 24 from the repository root. It is kept as an explicit integration check instead of running inside every `pnpm test`, so routine unrelated tests do not require Node 24 or repeat the 9,000 model ticks. Run it when validating this transplant or changing the ecosystem model.

The 20,000-tick histories remain historical evidence; these checks do not recreate them.
- After `pnpm build`, run `python3 tools/ecosystem-library/check-packaging.py` to compare actual emitted pages/assets with Docker removal patterns. This does not run Docker or Caddy.
