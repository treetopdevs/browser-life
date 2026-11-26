**Clear — the contradictory “Promising” expectation is resolved.**

- Final test uses moving tick `1703`, `passTicks: [1500]`, `latePass: false`, status `"stop"`, and expects `"Stop"`.
- Two-of-three passing coverage still uses the full saved record via `actualPair(1202)`.
- `indexFor` sets `"pending"` explicitly; `bindReceipt` assigns its defined `status` parameter. No undefined-status typo.

Read-only inspection; no edits, tests, or simulations.
