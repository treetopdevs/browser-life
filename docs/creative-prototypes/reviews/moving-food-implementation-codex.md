**First pilot blocked pending four closure fixes.**

1. **P2 — Default extinction fixture cannot load.** Terminal frames retain 184,320 food units, but the window endpoint declares zero. The viewer rejects that contradiction before positive replay tests can exercise their assertions. Derive endpoint food from the saved frame. Evidence: [fixture:100](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/tests/e2e/moving-food.spec.ts:100), [viewer rejection:292](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/docs/creative-prototypes/moving-food-viewer.js:292).

2. **P2 — Terminal-hold test targets a nonexistent button name.** It requests `"Jump to 1,500"`; the HTML button’s accessible name is `"1,500"`. Fix the locator or label so the terminal assertions are reachable. Evidence: [test:225](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/tests/e2e/moving-food.spec.ts:225), [button:66](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/docs/creative-prototypes/moving-food.html:66).

3. **P2 — Replenishment overlay is filled, despite the outline-only requirement.** `drawBandOutline` paints a translucent rectangle over food and bodies, creating visible regional changes from the overlay itself. Remove its fill. Evidence: [viewer:395](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/docs/creative-prototypes/moving-food-viewer.js:395).

4. **P2 — Window generation metric loses extinct generations.** Window endpoints copy `census.maxGeneration`, which scans living organisms only. The required maximum-ever generation can therefore decrease or become zero after extinction. Compute it from lineage born through the actual endpoint and update the viewer join. Evidence: [runner:315](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/tools/moving-food/explore.ts:315), [living-only calculation:733](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/apps/lab/src/moving-food/model.ts:733), [plan requirement:19](/Users/nicholas/.codex/worktrees/moving-food-region/browser-life/docs/creative-prototypes/moving-food-plan.md:19).

No additional material blocker found in the inspected pulse arithmetic, food-only model diff, unchanged uniform prefix, accounting joins, repeat/source guards, mode/seed bindings, or first-seed gate.

Completed within 12 read/search calls. No tests, simulations, edits, or pilot executed.
