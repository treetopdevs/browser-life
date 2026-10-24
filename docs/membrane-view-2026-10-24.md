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
These images are local evidence, not committed fixtures. Adversarial review is
still running. The change may be published as a draft PR while it waits; the
coordinating agent will assess the review before marking it ready.
