One remaining defect:

- **P2 — Recovery test never reloads a seed after the intentional failure.** At [currents.spec.ts:124](/Users/nicholas/.codex/worktrees/circulating-aquarium/browser-life/tests/e2e/currents.spec.ts:124), `#replay-window` remains disabled and replay frames are cleared, so `selectOption('coarse')` times out. After removing the route, select seed 1201 and await successful loading before continuing.

All other named fixes cleared by source/test inspection. No edits or reruns performed.