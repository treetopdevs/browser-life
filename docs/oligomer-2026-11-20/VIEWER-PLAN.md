# Plan: Live Browser Viewer (`/oligomer/`) for Phase A & Phase B1

A lightweight, unlisted lab page (`apps/lab/oligomer.html` + `apps/lab/src/oligomer/page.ts`) to watch the combinatorial oligomer ecology and (later) pointer-free Zwicker active droplets live in the browser — without touching the main kernel or lab shell.

## Goals

1. **Make Red Queen dynamics legible at a glance:** You should be able to *see* a dominant wall motif sweep across the dish, a lysin wave ignite on its border, crash it, and trigger the next motif breakout in real time.
2. **Support both Phase A (grid compartments) and Phase B1 (continuous active droplets)** through one shared renderer/HUD layout.
3. **Zero impact on physics determinism:** The viewer runs the exact same `OligomerWorld` (Phase A) or `DropletWorld` (Phase B1) step function and reads state purely via typed arrays and `OligomerObserver`.

## Visual Encodings (View Modes)

| Mode | What each pixel shows | Why it's useful |
|---|---|---|
| **Wall Motif** *(default)* | Each of the 6 balanced wall tetramers (`0011`, `0101`, `0110`, `1001`, `1010`, `1100`) mapped to a distinct perceptual hue (Okabe–Ito / Paul Tol 6-color palette); brightness = wall density (`wTotal`); empty tiles show subtle grey/blue external feedstock density. | Immediately reveals motif sweeps, coexistence, and Red Queen oscillations. |
| **Lysin Overlay** | Same wall-motif base, with bright white/red border pips or tint on cells carrying an active `OP_LYSE` catalyst (colored by the *target* motif they attack). | Shows predator fronts eating into prey patches in real time. |
| **Trophic Flux** | Primary degraders (teal), mixed generalists (gold), secondary cross-feeders/predators (magenta), based on rolling `feedCleaves` vs. `secCleaves`. | Shows ecological role structure separately from wall identity. |
| **External Chemistry** | Heatmap of external feedstock (`0001`/`1110`), dimer intermediates (`00`/`01`/`10`/`11`), or monomer depletion. | Reveals nutrient shadows, lysis spills, and cross-feeding halos. |

## Controls & Presets

- **Presets:**
  - `Red Queen (LYSE)` — 6 mixed wall founders, `enableLyse: true`, `pRuptureQ16: 64`, Brownian drift on (default).
  - `No Lysis (NO_LYSE)` — identical start without predation (control).
  - `Motif-Blind (NEUTRAL_WALL)` — shows rapid cannibalistic crash to 1 motif.
  - `Single Wall (SINGLE_WALL)` — shows collapse without chemical wall diversity.
  - `Phase B1: Active Droplets` *(added once B1 lands)* — continuous phase-separating Zwicker droplets.
- **Transport:** Play / Pause, Step, Speed slider (`1`, `5`, `20`, `100` steps/frame), Seed selector, Reset.
- **Inspector (click any tile):** Shows `wall[0..5]` counts, `energy`, `int` top species, and decoded human-readable genome (`CLV(00|01) | LIG(01|10) | LYS(10|01) | ...`) using `formatCatalyst()`.

## Live Telemetry Strip (Side Panel)

- **Stacked area sparkline** of the 6 wall-motif shares over the last 40k steps (rolling buffer of 200 census points) — visually displays Red Queen waves!
- **Live counters:** `step`, `live`, `divisions`, `dLy`, `wD1` (Wall Hill diversity), `sw` (motif switches), and exact conservation badge (`res: 0, 0` in green, red if ever non-zero).

## Minimal Implementation Footprint

1. `apps/lab/oligomer.html` — Unlisted (`noindex`) entry point matching `apps/lab/vesicle.html` / `bodies.html` conventions.
2. `apps/lab/src/oligomer/page.ts` — Canvas `ImageData` renderer (scaled with `image-rendering: pixelated` for Phase A, smooth bilinear/pixelated for Phase B1), `requestAnimationFrame` loop, sparkline canvas, click-to-inspect panel.
3. `apps/lab/src/oligomer/style.css` — Dark-mode lab layout matching existing sandbox pages.
4. `apps/lab/vite.config.ts` — Add `oligomer.html` to `build.rollupOptions.input` (only if sandbox pages are listed there; verify before editing).

## Verification

- `pnpm typecheck` passes.
- `pnpm dev` serves `/oligomer.html` cleanly with zero console errors.
- Clicking Play advances steps with `res: 0, 0` and displays Red Queen motif waves within ~10–20 seconds on `24×24` or `32×32`.
