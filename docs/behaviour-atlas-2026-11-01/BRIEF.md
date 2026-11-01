# I01 — Behaviour atlas and stepping stones: brief (2026-11-01)

Written by the coordinating session before any work. This is the WHAT and WHY; the dated plan doc
the agent writes beside it is the HOW.

## Source of the idea

`/Users/nicholas/develop/browser-life/docs/simulation-research-2026-11-01/report.md` (research
programme, 1 Nov 2026; not yet on main, read it by that absolute path). Read in full: the
"Three things to start / resist" opening, the I01 card ("I01 — Behaviour atlas and stepping
stones"), "Implementation slices and acceptance", "Suggested sequence" (Phase A), and the MAP-Elites,
ASAL and Digital Red Queen dossier entries. The user's one-line charge:

> Extend the existing archive with carefully separated search descriptors and independent
> capability tests. Preserve stepping stones instead of selecting only one impressive survivor.

## Goal

A reproducible, auditable behaviour archive that (a) keeps every accepted candidate and its proposal
ancestry rather than only the current elite per cell, (b) adds two predeclared *physical* descriptors
as an opt-in adapter beside the existing mass/speed `ArchiveSpec`, and (c) tests capabilities with
assays that were never used as a selector, written down before any descriptor archive runs.

Phase A deliverable (report): **archive manifest and descriptor calibration**. The four-arm
comparison (random viable / existing archive / physical-descriptor archive / embedding archive) is a
later slice; do it only if calibration finishes cleanly and cheaply, and then only as a bounded pilot.

## Order of work (report §Implementation slices; do not reorder)

1. **Evidence fixture first.** Before any search pressure: a deterministic fixture set on which the
   two descriptors have known values, including a *negative case that fools the naive descriptor*
   (for example a recoloured or re-rendered copy, a repeated trajectory, a static pattern, noise,
   drift of the whole tile vs. motion of a body). Descriptor definitions must remain valid when
   component identity is ambiguous (that is the reason these two were chosen).
2. **Small CPU path.** Descriptors computed from existing readbacks / `Evaluation` outputs where
   possible (`packages/search/src/evaluate.ts` already yields speed, overlap-tracked identity,
   recovery). Opt-in adapter in `packages/search/src/mapelites.ts`; the default `ArchiveSpec` and
   every existing caller stay unchanged. Produce a manifest plus machine-readable evidence.
3. **Stepping stones.** `Archive.viable`, `passers` and the lineage tracking already keep every
   viable offer, and `viable.jsonl` + `--resume` replay them. Extend *that* with proposal ancestry
   (which parent, which operator, which batch) and an accepted-candidate ledger. Do not invent a
   parallel store. Old `archive.json` / `viable.jsonl` must still load and replay identically.
4. **Capability tests fixed in writing before running.** A "Fixed before computing" section in the
   plan doc, in the style of `docs/clade-measures-2026-10-18.md`: which held-out capability tests,
   on which fresh environments and seeds, with what decision rule. Existing held-out ecology and
   multilevel metrics (`experiments/endpoints.ts`) stay excluded from search.
5. **Replay/backend qualification** for whatever changed, then **bounded pilot** only if budget
   remains. Report simulator evaluations and wall time separately. Local GPU only.

## Starting material (absolute paths; `runs/` exists only in the main checkout)

- Existing archives: `/Users/nicholas/develop/browser-life/runs/bootstrap-200/` (archive.json,
  viable.jsonl, gate.json, confirm.json), also `runs/bootstrap-m3/`, `runs/bootstrap-r50/`.
  Read-only; write new outputs under this worktree's own `runs/` (gitignored) or `docs/behaviour-atlas-2026-11-01/`.
- Search code: `packages/search/src/{mapelites,evaluate,bootstrap}.ts`, `tools/bootstrap.ts`.
- Conventions for dated analysis docs: `docs/clade-measures-2026-10-18.md`.

## Non-goals / hard constraints

- No physics change. Every golden pin in `packages/sim-ref/test/golden-hashes.test.ts` stays
  byte-identical; `RULE_VERSION` does not move. New optional config keys stay out of `defaultConfig()`.
- No model calls inside `step()`; no model calls at all in this slice. The learned trajectory
  embedding arm is **deferred**: if any scaffolding for it is written, it is a separate arm with
  render, frame cadence, encoder version and preprocessing frozen, and recolour / repeat / static /
  noise controls. Any paid model call needs the user's explicit yes; stop and report rather than spend.
- Integer arithmetic within `docs/rules.md` bounds; analysis code streams per census.
- A new package means updating all four alias maps (tsconfig paths, vitest aliases, deno.json
  imports, apps/lab vite aliases).
- A new visual bin is not a new capability. Do not claim scientific improvement from breadth alone.
- No merge, no deploy, no edits to the main checkout, no `jj` commands.

## Workflow (the project's slice process)

1. Write `docs/behaviour-atlas-2026-11-01/PLAN.md` (dated; includes "Fixed before computing")
   before code. Consult the advisor/your own review before committing to it.
2. Implement with tests. Gates: `pnpm typecheck`, focused `pnpm vitest run <files>`, `pnpm test`;
   `deno run -A tests/deno/gpu_golden.ts` if anything near shared dynamics was touched.
3. Review lenses (conservation/ledger, determinism/replay compatibility, test coverage), then a
   Codex Sol 6.1 High read-only review before commit, exactly:
   `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C <worktree> - < prompt.md > review.txt`
   Record dispositions in `docs/behaviour-atlas-2026-11-01/REVIEW.md`.
4. Commit on `claude/i01-behaviour-atlas`, push the branch, open a **draft** PR against main.
5. Final report: what is implemented, what evidence is local-CPU vs local-GPU, what the fixture
   showed, what was left out and why, and the decision the next slice needs from the user.

## Environment

- Node: prefix PATH with `~/.nvm/versions/node/v24.2.0/bin` (homebrew node 26 is broken).
- Run `pnpm install` in this worktree before any `deno run`.
- Do not use the `bl-builder` / `bl-auditor` agents (bound to another workspace).
