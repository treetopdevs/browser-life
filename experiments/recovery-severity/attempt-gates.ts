import { type FilePin, stable } from "./branch-record.ts";

interface BudgetState {
  maxMs: number;
  maxBytes: number;
  spentMs: number;
  spentBytes: number;
}
interface Debit {
  elapsedMs: number;
  bytes: number;
}
export function verifyBudgetDebit(
  prior: BudgetState,
  budget: BudgetState,
  result: { elapsedMs: number; writtenBytes: number },
  debit: Debit | undefined,
  finalBytes: number,
): void {
  for (const b of [prior, budget]) {
    if (
      !b || b.maxMs !== 1200000 || b.maxBytes !== 536870912 ||
      ![b.spentMs, b.spentBytes].every((x) =>
        Number.isSafeInteger(x) && x >= 0
      ) || b.spentMs > b.maxMs || b.spentBytes > b.maxBytes
    ) throw new Error("invalid/exhausted aggregate budget");
  }
  if (
    !debit ||
    ![
      debit.elapsedMs,
      debit.bytes,
      result.elapsedMs,
      result.writtenBytes,
      finalBytes,
    ].every((x) => Number.isSafeInteger(x) && x >= 0) ||
    debit.elapsedMs < result.elapsedMs ||
    debit.bytes < result.writtenBytes + finalBytes ||
    budget.spentMs < prior.spentMs + debit.elapsedMs ||
    budget.spentBytes < prior.spentBytes + debit.bytes
  ) throw new Error("attempt not fully debited");
}

/** Separate global replay gate; branch parity alone cannot establish this. */
export async function verifyFirstPairReplays(
  rows: { id: string; gpu25: string; gpu50: string }[],
  artifacts: FilePin[],
  load: (path: string) => Promise<Uint8Array>,
): Promise<void> {
  const expected = new Set(
    ["parent", "mutant"].flatMap((subject) =>
      ["legacy", "mass-targeted", "sham"].map((arm) =>
        `2026102401-${subject}-${arm}`
      )
    ),
  );
  const parse = async (path: string) =>
    JSON.parse(new TextDecoder().decode(await load(path)));
  for (const row of rows) {
    if (!row.id.startsWith("2026102401-")) continue;
    if (!expected.delete(row.id)) {
      throw new Error("duplicate/wrong first-pair replay branch");
    }
    if (
      row.gpu25 !== `${row.id}-gpu25.json` ||
      row.gpu50 !== `${row.id}-gpu50.json`
    ) throw new Error("incorrect primary replay source path");
    for (
      const [cadence, source] of [[25, row.gpu25], [50, row.gpu50]] as const
    ) {
      const replay = `${row.id}-replay${cadence}.json`;
      if (
        !artifacts.some((a) => a.path === replay) ||
        !artifacts.some((a) => a.path === source)
      ) throw new Error("missing replay inventory");
      if (
        stable(await parse(replay)) !== stable(await parse(source))
      ) throw new Error(`first-pair replay mismatch: ${replay}`);
    }
  }
  if (expected.size) throw new Error("incomplete first-pair replays");
}

/** One canonical output identity is shared by global reading and audit reporting. */
export async function resolveUniqueDebit(
  attempts: (Debit & { out: string })[],
  out: string,
  normalize: (path: string) => Promise<string | null>,
) {
  const root = await normalize(out);
  if (!root) throw new Error("output directory absent");
  const matches = [];
  for (const debit of attempts) {
    if (typeof debit.out !== "string") continue;
    if (debit.out === out || await normalize(debit.out) === root) {
      matches.push(debit);
    }
  }
  if (matches.length !== 1) throw new Error("missing/duplicate budget debit");
  return matches[0];
}
