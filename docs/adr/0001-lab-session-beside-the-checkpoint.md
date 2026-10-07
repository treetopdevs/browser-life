# Lab session beside the Checkpoint

The page was keeping a second account of what would be lost if the Lab world on screen were replaced: dirty flags, a save queue, and a hand-edit count incremented before the worker had logged the lesion or feed. We decided the Lab session lives in the worker, beside the Checkpoint it describes. The page paints that account and does not keep another one.

A page-side ledger was the obvious place, because the question is asked on the page. It loses locality. Jump writes a Checkpoint of the present and never posts a save acknowledgement, so the page was reconstructing the account from replies that do not mean the same thing. The worker already knows which Checkpoint was manual, which was automatic, and whether the hand edit made it into the log.

## Considered options

- **Page ledger, worker unchanged.** Two operations, offer and settle, fold the replies into one module on the page. The worker protocol stays wide, and the account is still inferred from crumbs. Rejected: that is the scatter behind one function.
- **Installable pursuits on the page.** Each intent is a kind that emits effects into a sealed ledger. Rejected: the effect list becomes the wide interface, and the account still sits away from the Checkpoint.
- **A snapshot the page still matches.** The worker publishes step, hand, and held step, and the page keeps the save-then continuation. Rejected: the continuation is the second account.
- **Lab session in the worker.** Chosen. One account, published as a view. An in-memory adapter and the worker postMessage adapter both implement that seam, so tests of uncovered work, `keep`, jump's present, a refused save, and a stamped Replay twin reading need no GPU.

## Consequences

- Plant, restore, and open ask from the painted view when the Lab world has uncovered work, then send `keep` as save or discard. A jump does not ask: it writes a Checkpoint of the present, then restores.
- A hand edit counts only after it is in the log. The strip and the stroke toast read the session view. A hand edit at a Replay twin reading's end step marks that reading. The check itself stays in `LabExecution`.
- `loaded` remains the adoption receipt (config, identity, step). It must not update the loss account. `saved` goes away. The Checkpoint list arrives on the session view. Census, stats, probe, field view, resize, and speed stay direct messages.
- A waiting pond cycle remains `LabExecution`'s refusal. The session records that fact and does not re-decide it.
