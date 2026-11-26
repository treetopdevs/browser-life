# Spatial prototype validation — 26 October 2026

## Scope

A separate 3D particle model and local browser page, based on the previously watchable2D particle family. Genuine z coordinates affect interaction distances, alignment, food seeking/uptake, speed/energy cost, birth placement and spatial census. Canvas2D projects the actual3D state. Camera and depth slice change the view only. This is not a scientific-kernel port or proof of adaptation.

Original particles/model.ts is unchanged at SHA-256 `028cb90df07dacd4771cdbf6e9918ad7b691775d77fa090cf2dceca5e8f0b56f`. The new model is frozen at `d7c666ceb6969a52e7ac151625f03864cc583a742e17104913f12ad9e7f3fe30`. The nine-run matrix was chosen before viewing its outcomes; no physics parameters were tuned afterward.

## Findings

All nine fixed runs retain all three founding families at tick6,000. Final populations are130–170. All show late births/deaths and nonzero motion in depth. Pursuit varies significantly: late occupied bins average8.2–18.2 and depth bands2.08–4.41, whereas flocks remain concentrated around supplied food centers. Population ceilings do not bind in the final1,000 ticks. The maximum observed floating-point energy residual is below3e-8, within the predeclared1e-6 tolerance. Exact integer conservation is not claimed for this float toy.

Browser captures use seed1201 for each recipe, fixed yaw37°/pitch−20°, and actual ticks0,1,000,6,000. The parent inspected the flocks1,000 and pursuit6,000 stills; the UI implementer inspected all recipe captures. Flocks form compact knots, pursuit has separated clusters and dispersed individuals, colonies form separated groups. These are bounded visual observations; the complete videos were not independently reviewed end-to-end by the parent. Captures precede a heading-only copy edit. Media and manifest remain local under `runs/spatial/browser/`; committed model/evidence reproduce the worlds within the same runtime.

## Review record

[Claude plan review](reviews/spatial-plan-claude.md) and [Codex plan review](reviews/spatial-plan-codex.md) informed explicit geometry, late-window coverage, clock timing, perspective, overlap disclosures and the independent model boundary. Their resolutions are in the [plan](spatial-plan.md).

[Claude implementation review](reviews/spatial-implementation-claude.md) and [Codex implementation review](reviews/spatial-implementation-codex.md) found no model physics defect, but identified clock overshoot, a fabricated history point, lagged labels, blank manual-pause status and evidence-tool issues. Those were corrected. The page stops exactly at6,000 and exports separate extinction/horizon flags. Explicit form submission applies new settings, intentionally avoiding repeated resets while typing.

The runner import is now inert, so tests cannot accidentally start a pilot. The initial parent test invocation was interrupted when this import issue was discovered; it produced no accepted artifact. The accepted fixed batch ran only after the import and boundary-accounting corrections. Early and late windows include first-step and extinction-step events, while motion means use living steps. Every scheduled census and full snapshot is retained and checked. Wrong-runtime preflight does not invalidate good saved evidence.

[Claude follow-up](reviews/spatial-fixes-claude.md) cleared the main fixes; its locale issue was fixed by explicit en-US formatting. The actual renderer slice test now verifies the retained seam particle's projected position, addressing the optional filter-test gap. [Codex follow-up](reviews/spatial-fixes-codex.md) found that repeat validation could borrow primary records and that particle schema checks omitted heredity/lifecycle fields; both were fixed with rehashed negative fixtures. The final targeted review is retained in [validation fixes](reviews/spatial-validation-fixes-codex.md).

The fast evidence guard checks structure, source freshness, snapshots and retained records. It is not a second simulation: some per-tick window aggregates are established by the full reproduction command rather than recomputed from100-tick census samples. Do not describe the fast guard as independently proving every aggregate.

## Local checks

- 15 focused tests passed across model, renderer, packaging and evidence validation.
- 3 Chrome spatial checks plus5 public-route/build checks passed; the live playback test reached exactly6,000.
- Repository typecheck, strict standalone runner/evidence typecheck, and production build passed.
- Evidence freshness/structure/report guard passed. The post-validator batch exactly matches every original outcome and snapshot, excluding only source and artifact hashes; see [comparison receipt](spatial-replay-comparison.json).
- Full final-version replay check passed: all nine primary runs and independent repeats reproduce exactly in Node24.2.0.
- Final targeted Codex review reports no remaining findings within the requested scope. Production build and built-file removal smoke remove the spatial page/model/UI/style from deployment output. This does not claim Docker/Caddy runtime execution. No merge or deployment.
