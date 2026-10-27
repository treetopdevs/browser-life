**No blockers.** I found no actionable defects in these fixes.

- **Coefficient wording** (`picker.ts:84`): The wording is correct.
  - Sign flips and added or removed terms get their own phrases.
  - A positive coefficient that shrinks reads "less attraction", and a negative one that gets more negative reads "stronger repulsion". Neither is called repulsion unless the sign changes.
  - `-0` is handled, because `-0 === 0`.
- **Keep errors and canvas labels** (`picker.ts:43`, `picker.ts:107`):
  - `install()` builds the new worlds before swapping the session. If `keepFavorite` or `buildWorlds` throws, the session stays unchanged, the message goes into `#keep-help`, and the reason text is kept.
  - `showRecipes()` rewrites each canvas `aria-label` from the current heading on every install.
- **Bounded canonical depth** (`comparison.ts:47`):
  - A real file nests about 6 levels, so the limit of 12 leaves room.
  - `canonical(data)` is evaluated first, so a deeply nested extra field throws "unsupported nesting" before any recursion can overflow the stack.
  - The error reaches the import handler's `catch` as "Import refused … Current worlds are unchanged."
- **`--check`** (`explore-picker.ts:14`): It validates the arguments, then compares both source hashes (`model.ts`, `comparison.ts`) with `deepStrictEqual` and compares `rulesVersion`. It exits before any simulation or `writeFileSync`. A missing or malformed pilot file also fails, because the read or comparison throws.
- **`advanceComparison`** (`comparison-clock.ts`):
  - It returns early when every world is extinct or the tick limit is reached.
  - Otherwise it advances the shared tick once, steps every living world, and records `extinctionTicks[i] = nextTick` for each world that empties.
  - The `return` inside `forEach` only skips that one world, so one extinction never blocks the others.
  - The frame loop and Step button both go through it, and a tick completes before the loop can yield.

**Cosmetic nits, no action needed:**
- While running, `metrics()` only fires every 10 ticks. "Extinct at tick N" can therefore appear up to about 0.3 s late. It does appear immediately once the run pauses.
- `explore-picker.ts:19` calls `process.exit(0)` right after `console.log`. If stdout is a pipe, the message could in principle be cut off. It is harmless because the exit code is correct.

**Static-review limits:**
- I read only the four files, ran nothing, and executed no tests or typecheck.
- I did not check that `picker-pilot.json`'s hashes are fresh. `model.ts` is modified in the working tree, so run `--check` after the final edit.
- I assumed the `ParticleWorld.step()`, `census()` and `particles` semantics from `model.ts` without reading it.
- Behaviour that depends on a browser (live-region announcements, `ResizeObserver`, pacing) is unverified.
