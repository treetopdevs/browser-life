# Design system

## Direction

The lab uses a compact instrument layout: controls on the left, the live world and history in the center, and evidence on the right. The public site uses the same typography, colors, and direct language while giving the world a larger editorial introduction. The approved direction combines the three-column layout of probe B with the dark graphite and restrained green styling of probe A.

## Color and type

- Dark graphite is the default. A light theme is available in the header and follows the user across pages.
- Surface, text, line, and accent colors are OKLCH tokens defined in `apps/lab/src/style.css` and `apps/lab/src/site.css`. Green is reserved for primary action, active navigation, and positive verification. Blue, green, neutral white, and brown identify simulation pools; labels accompany every color key.
- Use the system sans stack for reading and a monospace stack for coordinates, measurements, status, and section indexes. Large editorial type belongs to the public site; the lab stays compact and numeric.

## Components and behavior

- Buttons have a clear active or disabled state. View and tool selections expose `aria-pressed`; feedback appears beside the action and in live status regions.
- The field can be operated with a pointer or keyboard. Arrow keys move the field focus, Enter uses the selected tool, and plus/minus zoom. Ordinary keyboard behavior of focused form controls and links takes precedence over lab shortcuts.
- The evidence rail separates conservation, population, cell inspection, and replay verification. A successful replay reports the compared state hashes and the step range. The public research page distinguishes observations, calibrated measures, and pending claims.
- At narrow widths, the world comes first, followed by evidence, then controls. Navigation and view modes remain horizontally reachable without page overflow.
- Respect reduced-motion settings, visible keyboard focus, and text contrast in both themes.
