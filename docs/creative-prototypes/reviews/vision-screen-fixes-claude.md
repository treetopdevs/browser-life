One scoped defect remains. The other fixes resolve their findings.

**Remaining defect**
- **Keyboard focus ring is probably clipped.** I read the CSS but did not render it in a browser.
  - `.fixture-select` fills its card (`width/height:100%`, `style.css:76`), and `.fixture-card` has `overflow:hidden` (`style.css:74`).
  - The only focus style is the global `button:focus-visible {outline:3px; outline-offset:3px}` (`style.css:71`), which draws outside the button, so the card clips it.
  - No `:focus-within` or `.fixture-select:focus-visible` override exists.
  - The e2e test only asserts `toBeFocused()`, so it wouldn't catch this.
  - Fix with a negative `outline-offset` on `.fixture-select:focus-visible`, or a `.fixture-card:focus-within` border or box-shadow.

**Resolved**
- **`check.ts` and the Vitest wrapper:**
  - It now requires the exact source-hash key set, runtime fields, score hash, pinned model and asset provenance, package versions, and processor and limit fields.
  - It cross-checks `scorerSourceSha256` and the asset pins against `score.py`.
  - It compares the processor config and requires byte-equal Markdown.
  - The wrapper's negative cases are empty `sourceSha256`, empty `provenance`, empty `runtime` and null `scoreFileSha256`. It also rejects pixel drift and an inverted status.
- **`calibrate.ts` preflight:** The `existsSync(runDir)` check throws before `mkdir`, any PPM or manifest write, or the scorer run. A rerun can no longer overwrite the retained evidence or the scorer log.
- **Packaging test:** It pins the Vite entry and chunk rule, the Dockerfile removals and the Caddy regex, including the `/vision-screen-other` negative case. The Dockerfile and Caddyfile entries are present.
- **Gallery:**
  - The verdict, counts and reason are derived from the artifact, and an unknown status throws.
  - The per-negative-type failure breakdown and the blank/one-dot note are computed from the comparisons.
  - The comparison heading and explainer now read "Target fixture margin − control margin".
  - Group 3 cards say "No required checks (diagnostic)".
  - `showFixture` no longer rebuilds the gallery, it only updates `aria-pressed`, and Close restores focus to the tile.
  - `scrollIntoView` honors `prefers-reduced-motion`. `style.css` has no transitions or animations, so no CSS rule is needed.
- **Provenance limits:** The thread counts, missing CPU name and single repeated fixture are documented in `vision-runtime.md:75`.

I ran nothing: no tests, browser or inference.
