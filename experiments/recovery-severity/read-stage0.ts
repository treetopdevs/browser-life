/** Independent artifact reader: deno run -A experiments/recovery-severity/read-stage0.ts OUT */
import { canonicalObserverJSON } from "@bl/schema";
import { type FilePin, readBranchRecord } from "./branch-record.ts";
import {
  resolveUniqueDebit,
  verifyBudgetDebit,
  verifyFirstPairReplays,
} from "./attempt-gates.ts";
const sha = async (b: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
/** Hold budget.ts's exclusive lock while reading and verifying the settled budget,
 * so no attempt can open between the marker checks and debit verification. */
export async function withSettledBudget<T>(
  budgetPath: string,
  verify: (budget: ReturnType<typeof JSON.parse>) => Promise<T> | T,
): Promise<T> {
  let lock: Deno.FsFile;
  try {
    lock = await Deno.open(`${budgetPath}.lock`, {
      write: true,
      createNew: true,
    });
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      throw new Error("budget unsettled");
    }
    throw e;
  }
  // Only the lock this reader created is released.
  try {
    try {
      await Deno.stat(`${budgetPath}.tmp`);
      throw new Error("budget unsettled");
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    return await verify(JSON.parse(await Deno.readTextFile(budgetPath)));
  } finally {
    lock.close();
    await Deno.remove(`${budgetPath}.lock`);
  }
}
export async function readStage0(out: string, budgetPath?: string) {
  const scan = async (path: string) => {
    for await (const e of Deno.readDir(path)) {
      if (e.name === "failure.json" || e.name.endsWith(".tmp")) {
        throw new Error("incomplete/failed attempt");
      }
      if (e.isDirectory) await scan(`${path}/${e.name}`);
    }
  };
  await scan(out);
  const result = JSON.parse(await Deno.readTextFile(`${out}/result.json`));
  const expected = JSON.parse(
    await Deno.readTextFile(`${out}/result-digest.json`),
  );
  if (
    await sha(new TextEncoder().encode(canonicalObserverJSON(result))) !==
      expected.sha256
  ) throw new Error("result digest mismatch");
  if (
    result.status !== "STAGE0-PARITY-PASS" || result.scientificSeedsRun !== 0 ||
    !Array.isArray(result.artifacts) || !result.artifacts.length
  ) throw new Error("invalid engineering result");
  const seen = new Set<string>();
  for (const a of result.artifacts) {
    if (
      typeof a.path !== "string" || a.path.startsWith("/") ||
      a.path.split("/").some((x: string) => !x || x === ".." || x === ".") ||
      seen.has(a.path)
    ) throw new Error("invalid artifact inventory");
    seen.add(a.path);
    const b = await Deno.readFile(`${out}/${a.path}`);
    if (b.length !== a.bytes || await sha(b) !== a.sha256) {
      throw new Error(`artifact mismatch: ${a.path}`);
    }
  }
  if (
    !seen.has("manifest.json") || !seen.has("inputs.json") ||
    result.results.length !== 12
  ) throw new Error("incomplete Stage 0 inventory");
  const manifest = JSON.parse(await Deno.readTextFile(`${out}/manifest.json`));
  if (
    manifest.protocol !== "recovery-severity-stage0-v4" ||
    manifest.observerVersion !== "recovery-continuity-v1"
  ) throw new Error("unsupported Stage 0 manifest version");
  let verifiedAccounting: {
    spentMs: number;
    spentBytes: number;
    debitOut: string;
    debitedMs: number;
    debitedBytes: number;
  } | undefined;
  {
    if (manifest.stage !== "engineering-only") {
      throw new Error("saved reanalysis is not an engineering pass");
    }
    const ids = new Set(
      [2026102401, 2026102402].flatMap((seed) =>
        ["parent", "mutant"].flatMap((subject) =>
          ["legacy", "mass-targeted", "sham"].map((arm) =>
            `${seed}-${subject}-${arm}`
          )
        )
      ),
    );
    const replayRows: { id: string; gpu25: string; gpu50: string }[] = [];
    const selections = new Map<string, string>();
    for (const row of result.results) {
      if (
        !ids.delete(row.id) || !seen.has(row.diagnosticPath) ||
        !seen.has(`${row.diagnosticPath}.digest.json`)
      ) throw new Error("missing/duplicate branch diagnostic");
      const { record, diagnostic } = await readBranchRecord(
        row.diagnosticPath,
        (p) => Deno.readFile(`${out}/${p}`),
      );
      if (
        record.evidence.manifest.path !== "manifest.json" ||
        record.evidence.inputs.path !== "inputs.json"
      ) throw new Error("branch/root manifest binding mismatch");
      if (
        record.mode !== "engineering-execution" ||
        diagnostic.stage0 !== "PASS" || diagnostic.facts.id !== row.id ||
        diagnostic.endpoint.T !== row.T
      ) throw new Error("branch does not support Stage 0 pass");
      const seed = row.id.split("-")[0],
        selection = record.evidence.selection.sha256;
      if (selections.has(seed) && selections.get(seed) !== selection) {
        throw new Error("inconsistent joint pair prescription");
      }
      selections.set(seed, selection);
      replayRows.push({
        id: row.id,
        gpu25: record.evidence.gpu25.path,
        gpu50: record.evidence.gpu50.path,
      });
      const evidence = Object.entries(record.evidence).filter(([key]) =>
        key !== "sources"
      ).map(([, pin]) => pin as FilePin).concat(record.evidence.sources);
      for (const pin of evidence) {
        const root = result.artifacts.find((a: { path: string }) =>
          a.path === pin.path
        );
        if (!root || root.sha256 !== pin.sha256 || root.bytes !== pin.bytes) {
          throw new Error("branch evidence absent from result inventory");
        }
      }
    }
    if (ids.size) throw new Error("incomplete engineering branch set");
    await verifyFirstPairReplays(
      replayRows,
      result.artifacts,
      (p) => Deno.readFile(`${out}/${p}`),
    );
    if (!budgetPath) {
      throw new Error("shared budget required for global acceptance");
    }
    verifiedAccounting = await withSettledBudget(budgetPath, async (budget) => {
      const debit = await resolveUniqueDebit(
        budget.attempts ?? [],
        out,
        async (path) => {
          try {
            return await Deno.realPath(path);
          } catch (e) {
            if (e instanceof Deno.errors.NotFound) return null;
            throw e;
          }
        },
      );
      if (
        result.artifacts.reduce((sum: number, p: FilePin) => sum + p.bytes, 0) !==
          result.writtenBytes
      ) throw new Error("artifact byte accounting mismatch");
      const finalBytes = (await Deno.stat(`${out}/result.json`)).size +
        (await Deno.stat(`${out}/result-digest.json`)).size;
      verifyBudgetDebit(
        manifest.priorBudget,
        budget,
        result,
        debit,
        finalBytes,
      );
      return {
        spentMs: budget.spentMs,
        spentBytes: budget.spentBytes,
        debitOut: debit.out,
        debitedMs: debit.elapsedMs,
        debitedBytes: debit.bytes,
      };
    });
  }
  return { ...result, verifiedAccounting };
}
/** Failed branch records remain independently readable, never a global pass. */
export async function readStage0Branch(out: string, path: string) {
  const rejectTemps = async (dir: string) => {
    for await (const e of Deno.readDir(dir)) {
      if (e.name.endsWith(".tmp")) {
        throw new Error("incomplete branch evidence");
      }
      if (e.isDirectory) await rejectTemps(`${dir}/${e.name}`);
    }
  };
  await rejectTemps(out);
  const { record, diagnostic } = await readBranchRecord(
    path,
    (p) => Deno.readFile(`${out}/${p}`),
  );
  // Do not convert a readable, failed diagnostic into a successful attempt.
  return {
    status: diagnostic.stage0 === "TECHNICAL-STOP"
      ? "TECHNICAL-STOP"
      : "BRANCH-VERIFIED",
    mode: record.mode,
    globalStage0Pass: false,
    diagnostic,
  };
}
if (import.meta.main) {
  if (Deno.args.length === 3 && Deno.args[1] === "--branch") {
    console.log(
      JSON.stringify(
        await readStage0Branch(Deno.args[0], Deno.args[2]),
        null,
        2,
      ),
    );
  } else {
    if (Deno.args.length !== 2) {
      throw new Error(
        "usage: read-stage0.ts OUT SHARED_BUDGET_JSON | OUT --branch DIAGNOSTIC.json",
      );
    }
    const r = await readStage0(Deno.args[0], Deno.args[1]);
    console.log(
      `${r.status}: ${r.results.length} branches, ${r.artifacts.length} authenticated artifacts; ${r.elapsedMs} ms; no fresh scientific worlds`,
    );
  }
}
