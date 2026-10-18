// The proposer bench's executor under Deno (tools/bench.ts `run`): spawns one fork's tools/run.ts command and pipes its stdout and
// stderr to the fork's run.log. Kept apart from the CLI so a test can call it on a harmless command (tools/test/bench-cli.test.ts).
// Deno only; tools/lib/bench-fs.ts takes it as an injected Exec.
import type { Exec } from "./bench-fs.ts";

/** Where a fork's output goes: the subset of Deno.FsFile the executor writes through (a test injects a failing one). */
export interface LogSink {
  write(p: Uint8Array): Promise<number>;
  close(): void;
}
const openLog = async (logPath: string): Promise<LogSink> => await Deno.open(logPath, { write: true, createNew: true });

/**
 * Runs argv (argv[0] is "deno", replaced by this Deno's own executable) from cwd; the log file is created new, never replaced. If
 * writing the log fails, the child is killed and waited for before the error is thrown, so a worker never moves on while its fork
 * still runs (amendment 2).
 */
export const makeDenoExec = (open: (logPath: string) => Promise<LogSink> = openLog): Exec => async (argv, cwd, logPath) => {
  const file = await open(logPath);
  try {
    const child = new Deno.Command(Deno.execPath(), { args: argv.slice(1), cwd, stdin: "null", stdout: "piped", stderr: "piped" }).spawn();
    let failure: { err: unknown } | null = null;
    const pump = async (r: ReadableStream<Uint8Array>) => {
      try {
        for await (const chunk of r) for (let off = 0; off < chunk.length;) off += await file.write(chunk.subarray(off));
      } catch (err) {
        if (failure === null) {
          failure = { err };
          try {
            child.kill("SIGKILL");
          } catch {
            // it has already exited
          }
        }
        // Drain the rest so the child is never blocked on a full pipe while it dies.
        await r.cancel().catch(() => {});
      }
    };
    await Promise.all([pump(child.stdout), pump(child.stderr)]);
    const status = await child.status;
    if (failure !== null) throw (failure as { err: unknown }).err;
    return status.code;
  } finally {
    file.close();
  }
};
export const denoExec: Exec = makeDenoExec();
