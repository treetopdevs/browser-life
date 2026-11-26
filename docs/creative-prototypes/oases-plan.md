# Travelling oases — Candidate 3

New worktree from reviewed picker tip `f122e23` (PR86; depends on PR85). Shared main remains904a05a1. Previous goal turn was progress: reviewed, tested, committed world picker and open PR86. This slice targets visibly changing opportunities rather than more recipe knobs.

## Outcome
At `/particles/oases/`, compare the same recipe/seed under Still, Slow oases and Faster oases. Food patches move while carrying their stock; no particle relocation, forced births or extinction rescue. Look for following, regrouping and population dips/rebounds. Existing food seeking is engineered and disclosed. This is not proof of adaptation.

## Model contract
Add optional fifth constructor argument `ParticleEnvironment = {kind:'still'} | {kind:'travelling',speed:0.0001|0.00025}`. Validate and freeze it; no other values accepted. Default still must preserve all recorded default numerical trajectories. Keep recipe rows/alignment/renewal untouched. Before each living-world tick, move nine food patches horizontally: row0 east, row1 west, row2 east, by exactly speed on the unit torus. Keep stock and radius; wrap without any food reset or RNG draw. Feeding/steering see new positions. Empty worlds remain frozen under existing step semantics. Snapshot includes explicit environment. Toy model version3.

A separate environment module/helper may keep mutation small. Test seam travel and stock preservation, ledger, feeding at new rather than old positions, replay, no resurrection and still/default compatibility.

## Saved recipe compatibility
The picker stays a still-world recipe tool. Accept valid model2 selection files only after reconstructing their complete canonical graph under the old version, then upgrade modelVersion to3 with no recipe/history changes. Record an import notice in the UI when a supported old file was migrated; export onlyversion3. Never interpret old choices as having occurred in moving environments. Wrong versions, malformed graph and hostile values remain rejected atomically. No environment breeding in this slice.

## Page
Three synchronized canvases use the shared comparison clock. Global preset(seeddefaultpursuit), seed, mutation, pause/step/reset/pace; population histories, food-contact fraction, births/deaths, extinction tick. Show actual patch outlines and stock. Export an observation of allthree worlds with comparison tick/environment/settings, not resumable. Reducedmotion starts paused; hidden pages pause and remain paused. Clearly label inherited mutation versus supplied environment/steering. Link from particle page/picker. Local diagnostic route; existing /particles pathblock covers nestedroute; verify entry/sharedmodel assets excluded from image build.

## Evidence and stops
Run seeds1201–1203 under still/slow/faster for6000ticks, pursuitrecipe/mutationon, no intervention. Every100ticks record census, eachpatch occupancy/stock, fractioninanypatch. Everytick record mean minimum-image particle displacement (for IDs surviving that tick; births/deaths excluded), population min/max and caps; extinction retained. Show two recordings spanning patch travel and different encounters.
If every moving run empties before1000ticks, record result and make at most one speed reduction, with new version/evidence. If movement simply carries rigid groups with little regrouping, report it and queue seasonal renewal; do not tune until allsurvive. No expensive3D port/search.
Preserve historical pilotrecords before regenerating currentdefault/picker provenance. Compare allsaved defaultnumeric outcomes withpriorversion. Current --check commands must pass, or deliberatelyversion scopes rather than weaken them.

## Workflow
Claude Sonnet5.5High plan review, then isolated implementation ownership; meaningful unit/browserchecks, typecheck/build, focused source/evidence review with Claude and required CodexSol6.1High. Fix findings, logdecisions in HTML, commit and open dependent PR targetingpickerbranch. No merge/deploy. Review prompts must avoid reading entire largeJSON: inspect scripts/reports and bounded samples, use verified hash/comparison output.

## Plan-review resolutions
- Still performs no coordinate writes at all; even wrapping x+0 can alter floating-point low bits. No additional random draws. Environment values are exact-schema, copied and frozen. Movement preserves stock; normal subsequent renewal/feeding remains separately accounted.
- Migration accepts only model2/current3, reconstructs the full graph under the claimed source version and compares it before upgrading. `parseExplorationWithNotice` returns the current session and an explicit migrated-from notice; old histories remain still-world histories.
- Patch occupancy means geometric inclusion, not demonstrated feeding. Per-patch counts may overlap; the union fraction counts each particle once. First-containing-patch contact uses array order. Surviving-ID contact changes include entries/exits and are a proxy for changing contact, not tracked colony regrouping. Visual inspection supplies the qualitative group interpretation. Empty denominators are null.
- Minimum-image displacement measures motion between positions on the torus for surviving IDs; births/deaths are excluded. Supplied steering does not guarantee following. We reject either inference from the reviewer that following is inevitable or that displacement is invalid merely because it is measured once per tick.
- Shared comparison age is distinct from a stopped world's extinction tick. Charts show the last3000ticks and disclose retention. Evidence saves the full census timeline.
- Historical version2 default and picker records are preserved. Regenerated current defaults must match every prior numerical outcome, allowing only source/version metadata changes. Picker histories may change modelVersion only; recipes and observed results must remain equal.

## Descriptive follow-up after the browser recording
The seed1201 flock recording suggested a larger population contrast than the pursuit pilot. Run a separate fixed flock follow-up: the same three seeds, three environments and6000ticks, no tuning, census every100ticks, retain all outcomes. Save `oases-flocks.json` and its own runner/source hashes. This is a post-observation creative follow-up, not confirmation of an adaptation hypothesis or a replacement for the original pilot.
