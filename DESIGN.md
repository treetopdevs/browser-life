# Design system

## Direction

The lab uses a compact instrument layout: world setup, tools and checkpoints on the left, the live world with its transport and history in the center, and evidence on the right. The world's name is the page heading, and a run strip under it carries the run id, seed, rule version, ledger state and replay state beside the field they describe. The public site uses the same typography, colors, and direct language while giving the world a larger editorial introduction. The approved direction combines the three-column layout of probe B with dark graphite and neutral chrome: color belongs to the world and to verification state, not to the interface (2026-10-04, replacing the restrained green accent of probe A).

## Color and type

- Dark graphite is the default. A light theme is available in the header and follows the user across pages.
- Surface, text, line, and accent colors are OKLCH tokens defined in `apps/lab/src/style.css` and `apps/lab/src/site.css`. The accent (`--accent`) is ink: near-white in the dark theme, near-black in the light one, and it carries primary actions, active navigation, links and focus. Green means life and a clean verification only: `--life` for the brand mark and the site's hero emphasis, `--success` for exact and identical results. Blue, green, neutral white, and brown identify simulation pools; labels accompany every color key.
- Use the system sans stack for reading and a monospace stack for coordinates, measurements, and status. Large editorial type belongs to the public site, where display headings are set in a serif (Georgia) as a field notebook, with an amber annotation colour (`--field-amber`) for notebook marks and numbering (2026-10-04); the lab stays compact and numeric. The lab's type scale is six fixed steps (`--t-micro` 11px to `--t-title` 20px); nothing is set smaller than 11px.
- Pool colors mean pools and nothing else: history charts are drawn in the text color. Inputs and selects take `--control-line`, which holds 3:1 against every surface; `--soft` text holds 4.5:1.

## Components and behavior

- Buttons have a clear active or disabled state. View and tool selections expose `aria-pressed`; feedback appears beside the action and in live status regions. Play is the one primary action and sits under the field; while running it reads Pause and loses its fill.
- An action that would lose unsaved steps, and deleting a checkpoint, ask inline beside the action (`.guard`), with a save-first choice. No native dialogs.
- A badge is green only for a clean pass. A true statement that is not one (a fed ledger, a replay check of an earlier segment, a computed curve) takes the neutral `.badge.note`.
- The field can be operated with a pointer or keyboard. Arrow keys move the field focus, Enter uses the selected tool, and plus/minus zoom. Ordinary keyboard behavior of focused form controls and links takes precedence over lab shortcuts.
- The evidence rail separates conservation, population, cell inspection, and replay verification. A replay result reports the compared state hashes and the step range it covers, and says so when the world has moved past that range or was changed by hand. The inspected cell is marked on the field with a square; the round marker is the keyboard focus point. History charts run from zero, with the scale top printed. The public research page distinguishes observations, calibrated measures, and pending claims.
- At narrow widths, the world and its transport come first, followed by evidence, then controls. A failure stays on the field until dismissed or until a world loads. Navigation and view modes remain horizontally reachable without page overflow.
- Respect reduced-motion settings, visible keyboard focus, and text contrast in both themes.
