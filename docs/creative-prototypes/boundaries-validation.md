# Boundary-field validation

Local standalone Candidate1 prototype, dependent on PR90 (`0f3bd188`). No deployment, merge, Docker image execution, Caddy runtime test, research-kernel or old-particle model changes.

## Evidence

- Four modes × six fixed seeds1201–1206 ×3,000 ticks, with all outcomes retained. No tuning or rescue. Full records and source hashes: [pilot JSON](boundaries-pilot.json), [readable report](boundaries-pilot.md).
- Same-seed initial fields matched exactly across modes. Every tick checked finite ranges, disabled walls, independent density/nutrient diffusion residuals, density clamp and cumulative accounting bounds. All24 runs remained populated; no early-extinction stop applied.
- All six pre-existing particle evidence freshness checks passed unchanged: baseline, picker, oases, flock-oases, seasons and bonds.
- Full field replay and source freshness results are recorded at closure below. Browser recording is same-source illustrative evidence; it is not claimed bit-identical across JavaScript engines.

## Checks and inspection

Targeted model/clock/packaging and existing social metadata tests, typecheck, build, Chrome controls/mobile/exports and public routes were run locally. Production removal globs were applied to a temporary copy of the build; boundary HTML, entry JS/CSS and model chunk were removed, no boundary code markers remained, and public index survived. Receipt: `runs/boundaries/package-check.json`. This is packaging evidence, not a container launch.

The first independent screenshot inspection found unstyled tiny fields despite passing control tests: adding the history stylesheet had overwritten the base stylesheet. Restored full styling and strengthened browser tests to require two desktop columns, one mobile column, square canvases over300px, and no mobile overflow. The initial capture is preserved separately in `runs/boundaries/browser-unstyled/`; it is not the delivered animation. A new capture follows the fix, retaining actual displayed ticks rather than rerunning for round numbers.

## Reviews

[Claude Sonnet5.5 High plan review](reviews/boundaries-plan-sonnet-review.md), with [explicit resolutions](boundaries-plan.md), preceded implementation. Separate Claude Sonnet5.5 High and repository-required Codex Sol6.1 High implementation reviews run before commit. [Visual inspection](reviews/boundaries-visual-review.md) distinguishes silhouettes from scalar growth; continuous video inspection is not inferred from stills.

## Closure

Final local checks:41 unit tests (10 model,4 clock,2 packaging,25 existing metadata);8 Chrome checks (3 viewer,5 public-route/build), typecheck and build passed. Full deterministic24-run replay passed before a subsequent type-only runner correction; final source freshness is rechecked after that correction. The supplied-math model source is unchanged.

Codex Sol6.1 High found one reporting type mismatch: the declaration retained a combined diffusion residual field after generation switched to separate density/nutrient maxima. Correcting the declaration and compiling the runner explicitly addresses this; the root typecheck does not include tools. The model, UI and packaging review found no other concrete blockers. Codex’s focused follow-up confirmed the fixes. Claude’s minor status/hidden-tab/seed-feedback issues were subsequently fixed and covered by browser checks; generated Markdown freshness now joins JSON freshness. [Finding resolutions](reviews/boundaries-resolutions.md).

Styled recording: `runs/boundaries/browser/boundaries-seed1201-through-3000.webm`, from tick0 through3004 with pauses for screenshots at505 and1503. Independent screenshot inspection confirms the layout fix and nearly unchanged combined-mode silhouettes.
