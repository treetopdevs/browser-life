# S4 dev polish: plan (2026-11-02, revised after plan review)

Source: S1's walk, follow-ups F1, F2, F3 (`docs/prototypes-2026-11-02.md` on PR #151, not edited here). One PR, no
physics, `RULE_VERSION`, golden pin or `defaultConfig()` change, production Caddy untouched. Raw plan review:
`/tmp/dev-polish-2026-11-02-plan-review-raw.txt`; dispositions in REVIEW.md.

## Outcome

A person running the lab locally: (F1) opens any library page and every page's icon link resolves (no `/favicon.ico`
404); (F2) sends SIGINT/SIGTERM from another process to `bin/garden-dev` or `bin/dev` and finds the launcher and every
descendant gone; (F3) under bare `pnpm dev` with no coordinator, `/api/*` answers a clean `503` JSON body when the
connection is refused, with the pages' own unavailable path unchanged for that case.

## What is built or fixed

**F1.** Add `<link rel="icon" href="/favicon.svg" type="image/svg+xml" />` to `apps/lab/playground/index.html`,
`development/`, `hungry-shapes/`, `ecosystem/`, `ecosystem/archive/`. (Review confirmed: of 36 inputs then these five are the
only ones lacking it, and `apps/lab/public/favicon.svg` exists.) The standing test resolves the inputs exhaustively
(see Tests), not by a lossy regex.

**F2.** Hypothesis, confirmed first by the failing test: a launcher started with SIGINT ignored (`nohup`, `&` in a
non-interactive shell) cannot `trap` INT in POSIX sh, so cleanup never runs; SIGTERM works. Fix in `bin/garden-dev` and
`bin/dev`: after argument/food validation and before `cd`, unless `BL_SIGNALS_RESET` equals the launcher pid (`$$`; a stale exported `1` must not disable the reset), re-exec as
`BL_SIGNALS_RESET=$$ exec perl -e '$SIG{INT}="DEFAULT"; exec { $ARGV[0] } @ARGV or die "exec failed: $!\n"' /bin/sh "$0" "$@"`.
Reset INT only: SIGHUP disposition is left as inherited (so `nohup` keeps working). Exec failure is loud (non-zero exit,
message); if perl is absent, print a one-line note and continue without the re-exec. Re-exec goes through `/bin/sh "$0"`,
so non-executable script copies (as `garden-dev-food.test.ts` makes) work. `bin/garden-dev` unsets `BL_*` early, so the
guard variable is checked before that loop and dropped after. Children started with `&` in a non-interactive shell get
SIGINT ignored too; after the launcher's cleanup sends TERM to the process tree (`tree_pids`) that is irrelevant, and the
test asserts descendants (not just direct children) are gone. If the repro shows another cause, REVIEW.md records it and
the fix follows the evidence. `bin/dev` shares the trap pattern and gets the same guard.

**F3.** In `apps/lab/vite.config.ts` give `server.proxy["/api"]` and `preview.proxy["/api"]` an object form with
`configure(proxy)` hooking `proxy.on("error", ...)`. Answer only when the error code is `ECONNREFUSED` (proven refusal:
nothing was sent upstream), the response is a writable `ServerResponse` (not a websocket upgrade socket) and headers are
not sent: `503`, `content-type: application/json`, `{"error":"coordinator_unavailable","detail":"no coordinator is
listening on the dev proxy target; run bin/dev"}` (fixed text, nothing reflected from the request). Other errors
(ECONNRESET, timeouts: the write may have been committed upstream) are left to Vite's default so uncertain-write handling
in the garden page (`apps/lab/garden/garden.ts`, the 502 path near line 1407 and the 503 "busy" retry near 2140) is not
changed. Before the change, read those garden.ts paths and record in REVIEW.md what a 503 vs 502 from a refused
connection does on `/garden/` and `/status/`; a refused connection means no hand was counted, so "unchanged" is claimed
only after that read and an e2e check on `/garden/` and `/status/` showing their unavailable state. Pure helper
`coordinatorUnavailable(err, res)` lives in `apps/lab/dev-proxy.ts`. Honest limits: Chrome still logs "Failed to load
resource" for any 5xx, and Vite's own error-log listener (installed after `configure`) still logs a line per refusal;
the gain is a clean JSON body. Documented in README.md section "Run it" (line ~20); no page code is touched. If the
`dev-proxy.ts` import cannot be resolved from vite.config.ts under typecheck, inline the helper instead.

## Files

Add: `apps/lab/dev-proxy.ts`, `apps/lab/test/dev-proxy.test.ts`, `apps/lab/test/icons.test.ts`,
`tools/test/dev-launchers-signal.test.ts`, `tests/e2e/dev-polish.spec.ts`, REVIEW.md and evidence files.
Change: five HTML files, `bin/garden-dev`, `bin/dev`, `apps/lab/vite.config.ts`, `README.md` ("Run it").

## Tests (named cases; each must fail without its fix)

`apps/lab/test/icons.test.ts`
- "every rollup input html has an icon link whose href is served": load the resolved inputs by importing the config
  (`await import` of vite.config.ts default export, or `resolveConfig`) rather than regex; assert input count equals the
  36 then declared (43 after the port onto main, which added pages incl. food-bands) (a number named in the test, bumped deliberately) and that every file has `rel="icon"` whose href
  exists in `apps/lab/public`. Check run with the five links temporarily removed: fails naming five files.

`apps/lab/test/dev-proxy.test.ts`
- "answers 503 JSON for ECONNREFUSED" (real `http` server and `http-proxy` instance on a closed port, hooked with the
  helper; asserts status 503, JSON body, `error` key).
- "leaves ECONNRESET and other errors alone", "does nothing when headers are already sent", "does nothing for a
  websocket socket (no setHeader)".
- "vite config wires the helper": load the config, assert `server.proxy['/api']` and `preview.proxy['/api']` have a
  `configure` function and target the coordinator url (so the unit tests cannot pass with the wiring absent).

`tools/test/dev-launchers-signal.test.ts` (stubs for mix/pnpm/deno/curl/lsof on PATH as in `garden-dev-food.test.ts`)
- Stub children are wrapper fixtures: each stub is `sh -c 'sleep 60 & echo $! >> pids; wait'`, so a direct child and a
  grandchild exist; the test first waits for readiness (pid file reaches the expected nonempty count) and fails if it never
  does, then signals.
- "bin/garden-dev stops launcher and all descendants on SIGINT sent with SIGINT ignored at start" (spawn
  `sh -c 'trap "" INT; exec sh bin/garden-dev'`), "...on SIGTERM", "bin/dev ..." both, and "garden-dev scratch directory is
  removed after SIGINT". Assert the exact recorded pids (by pid, verified `kill -0` fails, within 25 s) and that the
  recorded count is the expected nonzero number; unconditional teardown kills any survivor so a failing test leaves nothing.
- Pre-fix evidence: run on current main code first; the SIGINT cases fail, SIGTERM cases pass (recorded in REVIEW.md).
- "re-exec failure is loud": run with PATH lacking nothing but a fake perl that exits 1; assert a non-zero exit.
- "SIGHUP disposition is preserved": under `nohup`, the launcher's inherited HUP is still ignored (probe via `/proc` or a
  `trap -p`-style check where available; skip with a stated reason otherwise).

`tests/e2e/dev-polish.spec.ts` (Playwright, BL_E2E_PORT=5371)
- Per page (five plus `/about/` control): assert an icon link exists, `fetch(link.href)` returns 200 with an image
  content type, and no `/favicon.ico` response is 404 (use `page.on('response')`, since a 404 is not `requestfailed`);
  count observed pages so an empty set fails.
- F3: the spec starts its own Vite with `COORDINATOR_PORT` set to a port it verified closed (so another slice's
  coordinator cannot answer), requests `/api/status` and loads `/status/` and `/garden/`: asserts 503 JSON
  `coordinator_unavailable` and that the pages show their unavailable state. The check is mandatory, never waived; if the
  harness cannot supply a dedicated server the spec fails, not skips. Screenshots saved for REVIEW.md.

## Acceptance gates

Run from the worktree; the real-process check uses captured PIDs, never `pkill -f`.

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install
pnpm vitest run apps/lab/test/icons.test.ts apps/lab/test/dev-proxy.test.ts tools/test/dev-launchers-signal.test.ts tools/test/garden-dev-food.test.ts
pnpm typecheck && pnpm test
sh -n bin/dev && sh -n bin/garden-dev
BL_E2E_PORT=5371 npx playwright test tests/e2e/dev-polish.spec.ts --project=chrome
# real launcher: only if mix deps and deno are present; otherwise REVIEW.md states the real check was not possible
# (apps/coordinator/deps is missing in a fresh worktree: run (cd apps/coordinator && mix deps.get) first)
bash -c '
  trap '"'"'[ -n "$L" ] && kill -KILL -- $(pgrep -P $L) $L 2>/dev/null; true'"'"' EXIT
  nohup sh -c "GARDEN_ISLANDS=0 LAB_PORT=5361 PORT=6361 exec sh bin/garden-dev" >/tmp/s4-gd.log 2>&1 & L=$!
  n=0; until curl -sf localhost:6361/api/status >/dev/null && curl -sf localhost:5361/ >/dev/null; do kill -0 $L 2>/dev/null || exit 1; n=$((n+1)); [ $n -lt 60 ] || exit 1; sleep 2; done  # readiness, 120 s cap
  lsof -nP -iTCP:5361 -iTCP:6361 -sTCP:LISTEN | grep -q LISTEN        # nonempty before the signal
  kill -INT $L; sleep 25
  ! lsof -nP -iTCP:5361 -iTCP:6361 -sTCP:LISTEN'
```

## How to try it

```bash
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install
pnpm dev --port 5361 --strictPort            # no `--`: it would make Vite ignore the flags
# /playground/, /development/, /hungry-shapes/, /ecosystem/, /ecosystem/archive/ : jar icon, no favicon 404
curl -i localhost:5361/api/status            # 503 {"error":"coordinator_unavailable",...}
LAB_PORT=5361 PORT=6361 bin/garden-dev &  L=$!; sleep 60; kill -INT $L   # then: lsof -nP -iTCP:5361 -iTCP:6361 -sTCP:LISTEN is empty
```

## Non-goals and limits

No page code, no 200-masking, no change to `deploy/Caddyfile`, no new artwork, no launcher changes beyond the signal
guard. perl is assumed for the re-exec (guarded, loud on failure). F2 cause stays a hypothesis until the failing test
reproduces it. Vite's own proxy error log line and Chrome's console line for a 503 remain. Slice ports 5361/6361,
Playwright 5371.
