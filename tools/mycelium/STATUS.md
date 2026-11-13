# Mycelium world: status (13 Nov 2026)

Kept apart from `RULES.md` on purpose: `RULES.md` is covered by the R2 `code_hash` (`docs/mycelium-r2-2026-11-13/PROTOCOL.md` section 10), so editing it would invalidate the frozen R2 calibration. This file is not hashed.

- **R0** (CPU reference, `world.ts`): done. Matter and energy residuals are exactly 0.
- **R1** (WebGPU port, `gpu.ts`): CPU and GPU match bit for bit on all 19 cases of `tests/deno/mycelium_gpu.ts`. Three unfixed edge-case review notes (counters and step past 2^53, read/upload overlap) are listed in `docs/mycelium-r2-2026-11-13/RESULT.md`. The physarum arm is CPU only.
- **R2** (does heredity matter?): **MEASUREMENT-LIMITED** on the five dev seeds (no readout kept, confirmation not run). Not a FAIL and not evidence about heredity either way. See `docs/mycelium-r2-2026-11-13/RESULT.md`. Restarting needs a dated amendment or a new protocol R2b.
- **R3 and later** (genotype pool, bonds, learning, lesions, lineage files): not started, and the R2 gate they wait on was not passed.
