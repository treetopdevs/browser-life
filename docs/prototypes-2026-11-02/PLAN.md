# S1 plan: all app surfaces working locally, fresh prototype status (2026-11-02)

Branch `claude/s1-surfaces-1102` from `origin/main` 0bdd7a70. Coordinator log decisions D1 and D3. Planning source:
`docs/prototypes-2026-10-18.md` (seven sections) and `docs/creative-prototypes/README.md`. Note `docs/prototypes-2026-10-24.md`
already exists as an intermediate snapshot; the new page supersedes both and cites PRs merged since 18 Oct (#57 .. #149).

## 1. Outcome

After this slice a person can open one page, `docs/prototypes-2026-11-02.md` (and its `.html` twin), and for each of the
seven surfaces see what it is now, the exact verified command or URL to try it, what is not built, and what waits on them.
Every "How to try it" line has been run on this checkout, with a screenshot at 1280 and 375 px and a verdict
(works / partly / broken). Small local breakage found on the way is fixed; anything bigger is a named follow-up slice with an
exact repro. The 18 Oct file gets a one-line pointer to the new page and nothing else.

## 2. Walk-through (IMPLEMENT stage does this first, all ports in the slice's own range)

Setup once: `export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH; pnpm install`. `RUNS=/Users/nicholas/develop/browser-life/runs` (read only).
`mix` and `deno` are installed; `apps/coordinator/deps` is absent so run `(cd apps/coordinator && mix deps.get)` first (record if it fails).

| # | Surface | Command | What a person does | Evidence |
|---|---------|---------|--------------------|----------|
| A | Public site | `pnpm dev --port 5301 --strictPort` (no `--` separator: pnpm would pass it on and Vite would ignore the flags and use 5173; verify with `curl -sI localhost:5301`) | `/`, `/research/`, `/worlds/`, `/how-it-works/`, `/about/`, `/participate/`, `/status/`, `/no-such-page/` (404) | shots + console errors |
| B | Lab, three worlds | same server | `/lab/?world=breeder&seed=1`, `?world=gradient-m3&seed=1` (Field notes ring), a pond world from the catalogue (`/worlds/` link); let it run, click Keep a lineage, open pond keeper family tree and firsts | shots, family-tree shot |
| C | Selftest and pages | same server | `/selftest.html` (GPU vs CPU all pass), `/playground/`, `/particles/`, `/particles/picker/` | shots, selftest result text |
| D | Shared garden | `GARDEN_FOOD=1 LAB_PORT=5301 PORT=6301 GARDEN_DAWN_MS=5000 bin/garden-dev` (food is read at founding, so it must be on the founding invocation; verify the public food setting from the API; record separately 'food enabled', 'request accepted', 'collective actually fed', since one machine cannot meet the five-network threshold) (servers run one at a time on 5301/6301: stop the previous one and confirm with `lsof -i :5301 -i :6301` before starting the next; never any other port) | `/garden/` with local food (`GARDEN_FOOD=1`), send a stone, watch a day release | shots, curl letter response |
| E | Archipelago | `LAB_PORT=5301 PORT=6301 bin/dev`, fresh scratch data dir (`/tmp/s1-coord-data`, set through the coordinator's data-dir env var named in `bin/dev`/`config/runtime.exs`), create one uniquely named tiny experiment by curl with the body and expected response recorded, then `deno run -A --no-lock tools/island.ts --coordinator http://localhost:6301 --max-tasks 1` under `timeout 600` (flag spelled as `tools/island.ts` header says; checked first) | one segment `done` for that experiment id; say whether independent verification by a second island was exercised (it is not unless a second island runs); status page `http://localhost:6301/index.html` shows that experiment | shot, island log tail, segment state JSON |
| F | Research instruments | `deno run -A --no-lock tools/run.ts <experiment> --out /tmp/s1-runs ...` with explicit small steps (exact flags from the file header, fixed before the walk and written in walkthrough.md; bare `run.ts` defaults to 20,000 steps and checkout `runs/`, so never bare), then `deno run -A --no-lock tools/lineage.ts --dir <resulting bundle>` | dossier JSON and `report-html.ts` HTML | exit codes, shot of report |
| G | Naturalist | lab Field notes (B) plus `deno run -A --no-lock tools/notebook.ts ...` (exact args from its header; input needs the neutral envelope corpus under `$RUNS`, not just one seed dir; if the corpus is absent record it as 'needs data' and use the committed `docs/examples/field-notebook-*.html` only as the CPU fallback, labelled as such) and `docs/examples/field-notebook-*.html` | note with receipts, proposal suggestion shown | shots |
| H | Evolution game | lab pond worlds (B) with `pond-keeper` panels; the pond specs by variant: `lab-pond-keeper.spec.ts` (ponds-small, firsts/card), `-v1` (pressure, Keep a lineage), `-v2` (family tree), `-v3` (weather/shells), plus `lab-naturalist-actions.spec.ts` (wound/drain suggestions) as the repeatable checks | firsts, pressure dial, family tree | shots |

**Frozen inventory (first act of the walk, before any run).** Under the seven umbrella sections, the walk enumerates every
destination, from the code and not from memory: all inputs in `apps/lab/vite.config.ts` (including soup, predictability, assembly, niche,
moving-light, controller-locality, opponents, island.html, privacy), every site route, and all 15 destinations of the playground
library (`apps/lab/src/playground/page.ts`: oases, seasons, bonds, motifs, boundaries, development, hungry shapes, matter, currents,
spatial, ecosystem and its archive, vision screen, and the rest). `walkthrough.md` starts with this inventory as a table
(route, section, action that must complete, evidence kind: shot / log / spec). Each row gets a verdict; a library page shot proves only
that page. Pages owned by I03/I06 are visited as pages but their tools/ files are not touched. The 404 row's expected result is
status 404 plus the site's not-found body (not a pass on 200).

**Capture matrix.** 30+ routes at two widths exceeds the 16-shot cap, so shots are representative: one per umbrella section per
width for the main action (about 14 files) plus the family-tree shot; every other inventory row is evidenced by an action log line
(status, final DOM assertion text, console count) in `walkthrough.md`. The matrix is written into walkthrough.md before capturing.

Browser checks use the playwright MCP at 1280x800 and 375x800. WebGPU needs Chrome flags: if the MCP browser lacks WebGPU,
the lab shots are taken with the repo's Playwright Chrome (`BL_E2E_PORT=5311`, `channel: chrome`; native Deno runs `island.ts`/`run.ts` need real GPU regardless, record if absent) through a throwaway
script in `/tmp`, and the page says which. Screenshots go to `docs/prototypes-2026-11-02/shots/NN-surface-WIDTH.png`:
between 8 and 16, each PNG under 300 KB (downscale or crop with `sips`; jpeg not allowed). A filename suffix is not trusted: the test reads the PNG header, requires the real width to be 1280 or 375 (a crop or downscale is recorded in the table, with the browser viewport named separately), and a shots.json manifest lists file, route, viewport, crop/scale, and the walkthrough row it evidences.

Verdict rules fixed before the walk: **works** = loads, no console error, the surface's main action visibly completes;
**partly** = loads but a named action fails or needs an unlisted step; **broken** = does not load or crashes. A 200 alone is
never "works" for a GPU page. `/selftest.html` works only if its expected-results list is non-empty, every case passed and `window.__golden.error` is unset (it renders failures as page text, so a clean console is not enough). A shot of an error page is evidence of broken, never works. Each verdict row also records the outcome-specific assertion that decided it. Console errors are copied into the evidence file verbatim.

## 3. Fix policy

Fix only if: at most about 3 files, no change to `packages/sim-ref`, `packages/sim-gpu` shaders, `RULE_VERSION`,
golden pins or `defaultConfig()`, no `tools/` files that I03 (historical opponents) or I06 (niche construction) touch, no
frozen preregistration GENERATED sections. Each fix gets a regression test where the code is testable (vitest or Playwright
spec). Launchers: `bin/garden-dev` starts islands without `--no-lock`; run launchers with the PATH shim `tests/deno/lib/no_lock_deno.ts` provides (or confirm after every launcher run) and check `git status` shows no change to `package.json`, `pnpm-lock.yaml`, `deno.lock`; restore any stray change. Everything else goes in the page's "Follow-up slices" table: surface, exact repro commands, observed vs expected, suspected file.

## 4. Files

Add:
- `docs/prototypes-2026-11-02.md` (superseding status; per surface: What it is now, How to try it, Not built, Waits on you; PR citations; "How this page was written" with rules fixed first; command table with Ran/Read/Needs data; Follow-up slices; verdict table with shot links).
- `docs/prototypes-2026-11-02.html` (twin in the style of `prototypes-2026-10-18.html`: same CSS tokens, Day/Night button, no external requests; screenshots inline via relative `<img>` with alt text and width/height).
- `docs/prototypes-2026-11-02/walkthrough.md` (raw evidence: per surface command, time, exit, console messages, verdict, shot names; written during the walk, source for the page).
- `docs/prototypes-2026-11-02/shots/*.png` (at most 16, each under 300 KB).
- `docs/prototypes-2026-11-02/REVIEW.md` (Codex review record, created at the review stage).
- `tools/test/prototypes-status.test.ts` (see section 5).

Change:
- `docs/prototypes-2026-10-18.md` and `.html`: one pointer line at the top of each to the new page, nothing else (the test diffs the rest against `origin/main`).
- Small fixes found in the walk: unknown until the walk; listed in the page and in the PR body with their tests.

Not touched: `docs/prototypes-2026-10-24.*` (the new page links it as the intermediate snapshot), `apps/coordinator` config, deploy files,
`experiments/preregistration.md`, I03 and I06 tooling.

## 5. Tests (named cases, vitest, CPU only, no GPU)

`tools/test/prototypes-status.test.ts`:
1. `new page has the seven surface sections in order` (headings Lab, Public site, Archipelago, Shared garden, AI naturalist, Evolution game, Research instruments, each followed by the four labels).
2. `html twin matches md` : normalized text of both is compared (headings, commands from fenced blocks AND inline code and tables, verdict table cells, link targets, follow-up rows); extraction must be non-empty (zero fenced blocks fails); fragment links resolve to unique anchors in the same file.
3. `every local link and screenshot in both twins resolves to a file`, and the screenshot set is non-empty.
4. `screenshots: png only, 8 to 16, each under 300 KB, header width 1280 or 375, each in shots.json and cited by the page, each manifest row names an existing walkthrough row`.
5. `every surface and every inventory row has a verdict of works, partly or broken with a nonempty assertion and an evidence reference that exists`; negative cases: a fixture with missing evidence, an unknown verdict, or a 'works' row whose evidence is flagged error-page fails validation.
6. `18 Oct pages unchanged but for one pointer line`: pinned sha256 of the original md and html blobs (from 0bdd7a70) in the test; each edited file minus its single inserted pointer line must hash to the pinned value; no skip path.
7. `every PR cited as #N appears in the link definitions` (formatting only). Provenance is separate and checked by hand with `gh pr view`: cited PRs are merged (#85 and #101 were closed unmerged, their work landed via #120 and #121, so cite those), and the draft PRs #60/#69/#130 are named as drafts.
Each fix adds its own named case beside the code it fixes.

## 6. Acceptance gates (all runnable)

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm typecheck
pnpm vitest run tools/test/prototypes-status.test.ts
pnpm test                                  # no regressions, golden pins unchanged
git diff --exit-code origin/main -- packages/schema packages/sim-ref packages/sim-gpu tools/opponents tools/niche experiments/preregistration.md experiments/FROZEN deno.lock pnpm-lock.yaml package.json   # must exit 0; tools/opponents and tools/niche are I03/I06's
git status --porcelain | grep -v 'docs/prototypes-2026-1' # untracked additions accounted for
BL_E2E_PORT=5311 npx playwright test <the existing specs covering each fixed route, e.g. the pond-keeper v-variants and lab-naturalist-actions> --project=chrome   # if any lab file was fixed; the two original named files do not cover pressure, family tree or weather
(cd apps/coordinator && mix precommit)     # only if coordinator code was touched
```
Plus: the HTML twin rendered at 1280 and 375 px, light and dark, no horizontal scroll, no console error, no external request;
every command in the page appears in its command table with a check; every surface has a verdict backed by a shot or log in
`walkthrough.md`; Codex review (Sol 6.1, xhigh, read-only) addressed in `REVIEW.md`.

## 7. How to try it (what the finished page tells a person)

```bash
pnpm install
pnpm dev                       # lab, site, /selftest.html, /playground/, /particles/ on :5173
bin/dev                        # lab + coordinator (:5173, :4000); LAB_PORT / PORT to move them
bin/garden-dev                 # whole local garden at /garden/ (GARDEN_FOOD=1 for food)
deno run -A --no-lock tools/island.ts --coordinator http://localhost:4000
deno run -A --no-lock tools/run.ts ...     # exact short form fixed by the walk
deno run -A --no-lock tools/lineage.ts ... # on that run
```
The printed commands are the port-qualified forms actually run (5301/6301), each marked with the default-port form (5173/4000) as a documented translation that was read, not run, so the page never claims to have run what it did not.
URLs: `/lab/?world=breeder&seed=1`, `/lab/?world=gradient-m3&seed=1`, `/worlds/`, `/garden/`, `http://localhost:4000/index.html`.


## 8. Non-goals and limits

No physics, `RULE_VERSION`, `defaultConfig()` or preregistration change. No deploy, no paid or model call, no AWS, no
`tools/bench.ts approve`, no PRs #60/#69/#130, no I01, no gene-v2 direction, no I03/I06 files. Not a redesign: a surface that
is broken for a large reason is documented, not rebuilt. Status is reported on four separate axes per surface: implemented, locally verified (verdict), data available, deployed/externally verified. Live-host-only things (HTTPS, real phones) are 'not externally verified', not 'not built'.
Waits-on-you items are copied from merged PRs and D-numbers with their defaults, not invented. If the MCP browser has no WebGPU
the lab verdicts rest on Playwright Chrome and say so. One PR; no commits until the stage that allows it.
