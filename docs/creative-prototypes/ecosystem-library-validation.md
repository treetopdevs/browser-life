# Ecosystem library integration validation — 26 October 2026

## Scope

Fresh dependent branch `codex/ecosystem-prototype-library` from PR97 tip `aa049a1e28ab6e0868ae0bd334130d99b8fa6575`. Candidate9 model imported from `f1f98f3966ec36ec50577deec8a5914a20df8c51`, byte-identical SHA-256 `71b8cc9cd77651026430eac3913f9b0ad8ceafa4532c4bfa8703214ebccffed0`. Source worktree preserved. This integrates historical footage, not a new 20,000-tick batch.

Three live/archive/library pages are included in local builds and excluded from production packaging. No merge, deployment, Docker execution or live Caddy verification is claimed.

## Checks

- 27 focused tests pass: 11 original model tests, 15 archive/provenance fixtures and one packaging guard.
- Node24 bounded replay: all three complete 3,000-tick censuses exactly match prior staged v4 observations. Seed1101: 8,145 individuals / 73 classes;1102: 8,403 /70;1103: 8,602 /32. Standalone replay tool also passes strict TypeScript checking.
- Archive verifier validates source hashes, 603 censuses, trait arithmetic, summary regeneration and ffprobe metadata. Optional original-media check also passed locally.
- Three delivered movies total17,672,859 bytes, below32MiB; each192×192,801 frames,20fps,40.05seconds. Original movies remain outside Git. Video hashes and metadata are provenance evidence, not a pixel-to-census proof.
- Eleven Chrome checks pass after repairs. Browser checks cover live controls/export, archive metadata and playback/failure recovery, fourteen directory routes, mobile/axe and production-route guards. Hidden-page behavior uses synthetic visibility events in headless Chrome; this verifies the handler, not operating-system focus behavior.
- Typecheck and Vite build pass. `python3 tools/ecosystem-library/check-packaging.py` checks actual emitted filenames against Docker removal patterns; a separate temporary built-file removal smoke also passed.

Reproduction: `pnpm verify:ecosystem` with Node24 and ffprobe; focused Vitest tests and browser specs named `ecosystem`, `ecosystem-archive`, `playground`, plus `public-routes`. Logs and screenshots are locally retained under ignored `runs/ecosystem-library/`.

## Review disposition

Claude Sonnet5.5 High and Codex Sol6.1 High reviewed plan and implementation. Source reviews are in `reviews/ecosystem-library-*`. The first repair reviews found additional native-control/concurrent-retry cancellation cases and cramped phone chart heights. These now have fixes and passing browser regressions; both scoped closure reviews report no unresolved blockers. A final test-only hardening waits for all 1,005 trajectory table rows before the accessibility scan. The optional very narrow pause-resume/aggregate-status races noted by Claude are retained as nonblocking limitations; per-video load errors remain visible. Findings include retry state, interrupted playback, small-screen chart readability, frame callback ownership, and completeness of provenance/probe checks. The explicit replay gate is separate from the fast default unit suite and is exposed as a package command.

## Interpretation

Historical seeds1101 and1102 retain all five families at20,000;1103 loses Hunter and Jade and ends Protected-heavy. Late activity persists, but late mutations largely revisit known combinations. These are varied recurring ecological regimes, not evidence of endless novelty or improved survival caused by evolution.
