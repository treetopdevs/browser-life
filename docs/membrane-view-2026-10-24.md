# Membrane view

2026-10-24. Implements the membrane display deferred in section 6 of
`pond-keeper-v3-2026-10-22.md`. Based on main `b3fab906`, independently of the
shell-ranking branch.

## Scope and decisions

Append **Membrane** as view nine, retaining all existing renderer mode IDs and
keyboard keys. Key 9 selects it; Light remains key 8. The existing horizontally
scrolling view picker keeps the active button visible on a narrow screen.

The view reads channel P directly from the GPU cell buffer, including membrane
outside living cells. Unhighlighted pixels use white grayscale with intensity
`sqrt(min(P / unit, 1))`; the lab's unit is 256. Zero is black, brighter means more
membrane, and 256 or more is white. Boosting low amounts makes P=1 and P=2 visible
without creating a shell cutoff or coloring cells as protected. This is an amount
view, not a linear measuring scale or a survival map.

Existing tile borders and lineage highlights remain overlays. A highlighted
lineage can therefore tint a zero-membrane cell; the legend says that these overlays
modify the colours. The cell inspector remains the place to read an exact amount.

In a world with `injuryShell`, the legend names that world's actual threshold,
not a hardcoded 2. It distinguishes scheduled world wounds from the Wound tool,
which still cuts through shells. It also says the view shows current membrane,
not a forecast of surviving later wounds. Worlds without a shell setting show no
threshold. The legend refreshes when a world loads, so changing worlds while
Membrane stays selected cannot leave the previous world's shell explanation.
Choosing a preset without planting it leaves the displayed world's legend alone.

## Change boundary

Only the renderer, page view picker/legend and keyboard-help text change. The
existing `GpuViewMode` type automatically carries the appended value through the
worker protocol; no new protocol field is needed. Rendering reads buffers, never
writes simulation state. Physics, scores, config/defaults, rules, golden pins,
checkpoint/session formats and preregistration remain untouched.

## Validation

- Frozen pnpm install completed in the new isolated worktree.
- Typecheck and production build passed.
- Chrome tests cover all nine mode IDs, the old Light key 8 and pixels, the new
  Membrane key 9, selection visibility at 390px, and shell-to-calm world replacement
  while the mode remains selected.
- Direct GPU pixel readback checks P values 0, 1, 2, 4, 4, 64, 256 and 512 against
  expected grayscale bytes 0, 16, 23, 32, 32, 128, 255 and 255 (one byte tolerance).
  Other matter channels and lineage differ independently; equal P still draws
  equally. The pixel output is identical with no shell and with shell threshold 2.
- Explicit lineage highlighting of a zero-P cell produces the existing yellow
  tint, as disclosed in the legend.
- State hashes match before and after rendering. After one subsequent physics
  step, hashes also match a second simulation that was never rendered. This is
  checked in both shell and no-shell worlds, with no WebGPU validation errors.

Final Chrome run passed all four tests in 6.5 seconds, including overlay disclosure,
scheduled-versus-hand-wound wording, zero-P highlight behavior and a mobile document
overflow assertion. Latest typecheck and `git diff --check` passed; the production
build passed after the final renderer/legend changes.

Inspected local screenshots `test-results/membrane-view-desktop.png`,
`test-results/membrane-view-night.png` and `test-results/membrane-view-mobile.png`.
The selected Membrane button and legend remain readable in day/night and at 390px;
the small early membrane amounts appear faintly against black at step 100. Pixel
readback, rather than screenshot brightness, supplies the quantitative render check.
These images are local evidence, not committed fixtures. Adversarial review was
subsequently assessed; the findings and follow-up validation are recorded below.

## Adversarial review disposition

Argon's packet review was assessed against the full checkout on 2026-10-24:

- **Rejected the proposed zero-shell guard.** `injuryShell: 0` is invalid, not a
  disabled setting. `packages/schema/src/config.ts` `validateInjury` requires a
  supplied shell to be an integer in 1..65535, and requires all wound parameters.
  The new browser assertion confirms zero is rejected. Worker planting calls
  `initWorld`/world construction, whose `allocState` validates config; `GpuSim.create`
  also validates state. Worker imports call `decodeArtifact` → `decodeCheckpoint`,
  which validates config before constructing state and then validates state.
  Thus neither a planted nor imported valid world can reach the legend with zero.
  Adding disabled-zero semantics here would contradict the existing contract.
- **Fixed retained-world legend restoration.** Both `unblankWorld` (a held
  replacement) and the failed-load restoration path repaint after restoring
  `cfgBeforeLoad`. Planting also repaints after blanking config. A real worker/page
  regression test queues a wound, plant and Membrane selection in one page task;
  the worker holds the plant for unsaved work, and the restored shell legend
  remains correct after Cancel.
- **Fixed modified numeric shortcuts.** All view keys 1–9 now ignore Meta, Control
  and Alt, preserving browser/OS shortcuts. Browser assertions exercise each
  modifier across every numeric key; plain keys 8 and 9 still select their views.
- **Accepted the documented display scale.** The actual lab draw call in
  `apps/lab/src/sim.worker.ts` explicitly passes unit 256, so its saturation copy
  matches its renderer. The renderer's general-purpose unit parameter does not
  change that lab contract. A threshold above 256 may have cells below it already
  white; the view deliberately saturates and is not an eligibility map. No physics
  or threshold adjustment was made.
- **Added extracellular membrane evidence.** The equal-P pixel pair now includes
  a cell with no biomass and no lineage. It still renders the same P=4 grayscale
  as the living cell, confirming that the image shows material, not living-cell
  shell eligibility.

Post-review validation: typecheck, build and diff check passed; all **five** focused Chrome tests
passed in **8.4 seconds**, including unchanged Light behavior, quantity/highlight
pixels, immediate/future state hashes, modifier guards and the held/cancel race.
