# S4 dev polish: review log

## Plan review dispositions

Raw Codex Sol 6.1 xhigh review: `/tmp/dev-polish-2026-11-02-plan-review-raw.txt` (prompt `/tmp/dev-polish-2026-11-02-plan-review.md`). Verdict: request changes. All findings accepted; PLAN.md revised.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P1 | `pkill -INT -f bin/garden-dev` could hit other slices; Vite left running | Accepted. Gates use captured PIDs and an EXIT teardown trap; no `pkill -f`. |
| 2 | P2 | Resetting SIGHUP breaks `nohup` | Accepted. Reset INT only; HUP inherited; test added. |
| 3 | P2 | perl exec failure exits 0; non-executable script copies; guard placement | Accepted. `exec ... or die`, re-exec via `/bin/sh "$0" "$@"`, guard after food validation before `cd`, before the BL_* unset; loud-failure test. |
| 4 | P2 | Hook cannot remove Vite's own error log (listener added after `configure`) | Accepted. Promise dropped; documented as a remaining limit. |
| 5 | P2 | 503 for every proxy error changes garden semantics (busy/retry, uncertain write) | Accepted. Only ECONNREFUSED on a writable response; others untouched; garden.ts paths read and recorded before claiming "unchanged"; e2e on /garden/ and /status/. |
| 6 | P2 | F3 tests pass without proxy wiring; e2e may hit another slice's coordinator | Accepted. Config-wiring test, real http-proxy test, e2e with own Vite and verified-closed upstream, never waived. |
| 7 | P2 | F2 fixtures have no descendants; real gate passes if startup fails | Accepted. Wrapper/grandchild stubs, readiness and nonzero pid-count assertions, real gate requires listening before signal; mix deps note. |
| 8 | P2 | Favicon e2e passes vacuously (404 is not requestfailed) | Accepted. `response` events, fetch of resolved href, page count asserted. |
| 9 | P2 | `pnpm dev -- --port` ignores flags | Accepted. Use `pnpm dev --port 5361 --strictPort`. |
| 10 | P3 | Icon guard tolerates dropped inputs (regex parse) | Accepted. Resolve config inputs and assert exact count 36. |
| 11 | P3 | README section is "Run it", not "Dev" | Accepted. PLAN names "Run it". |

## Landing record (2026-11-17)

Ported from the uncommitted `browser-life-s4-dev-polish` checkout (base e8d75273) onto main b1d463f0 by three-way apply.
Conflicts: `apps/lab/vite.config.ts` (main added the `SCREENS` import; both imports kept) and `apps/lab/ecosystem/index.html`
(main rewrote the `<head>`; main's head kept, icon link re-added). Main has since added `food-bands/index.html` with no icon
link; the standing icon test caught it, so the link was added and `tests/e2e/dev-polish.spec.ts` now also visits `/food-bands/`.
The icon test's input count moved from 36 to 43 (main added pages). Dropped as scratch: nothing referenced was dropped;
the four screenshots in `shots/` are the ones the e2e spec writes.

Honest status of the original work: the plan review above is the only review the source checkout recorded. No
implementation review, no pre-fix failing-test evidence (plan promised "SIGINT cases fail on old code") and no
`garden.ts` 503-vs-502 read were recorded in REVIEW.md. The README states the garden/status outcome; that claim rests on the
e2e screenshots, not on a recorded code read. The real-launcher gate (`bin/garden-dev` with mix and deno, SIGINT, ports
free afterwards) was **not measured** in this landing.
