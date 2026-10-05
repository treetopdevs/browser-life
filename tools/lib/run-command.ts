// A child process with every wait bounded (wild sandbox; the pickers' `denoRun` and tools/picker-claude.ts): a deadline that ends
// the whole process tree, output read as a bounded stream instead of buffered whole, and no wait on a pipe a descendant holds open.
//
// At the deadline, or when either stream passes `maxBytes`, the child and its descendants (a `ps` snapshot of the tree) get SIGTERM;
// the survivors of `graceMs` get SIGKILL, and the child is reaped before the call returns. Deno has no process groups to signal, so
// a descendant that has already detached from the tree (reparented to init) is out of reach; its pipes are still not waited on:
// after the child exits the streams get `drainMs` to finish, never past the deadline (output that ends after it is a timeout,
// judged by the clock, so output seen only after the deadline counts as late even if it was written in time), and are
// cancelled after that.
//
// Deno only (it spawns); tests/deno/picked.ts runs it for real, the pickers' vitest tests inject a `RunCommand` instead.

/** The default cap on each of stdout and stderr: a pick answer is a few hundred bytes. */
export const OUTPUT_LIMIT = 1 << 20;

export interface BoundedOptions {
  cwd?: string;
  /** Written to the child's standard input, which is then closed; undefined closes it unread (`stdin: "null"`). */
  stdin?: string;
  timeoutMs: number;
  /** Per stream, default `OUTPUT_LIMIT`. */
  maxBytes?: number;
  /** SIGTERM to SIGKILL, and SIGKILL to giving up on the reap (default 1000). */
  graceMs?: number;
  /** How long the streams may stay open after the child has exited (default 1000). */
  drainMs?: number;
}

export interface BoundedResult {
  /** Exit code; null when the child was killed here. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The deadline passed before the child had exited and its output had ended. */
  timedOut: boolean;
  /** A stream passed `maxBytes`: the child was killed and the output is cut there. */
  overflow: boolean;
}

/** The result of `p` if it settles within `ms`, else undefined; the timer never outlives the call. */
async function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<undefined>((r) => (timer = setTimeout(() => r(undefined), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** pid to parent pid of every process, from one `ps` snapshot (empty when `ps` cannot run). */
async function snapshot(): Promise<Map<number, number>> {
  const parents = new Map<number, number>();
  try {
    const out = await new Deno.Command("ps", { args: ["-A", "-o", "pid=,ppid="], stdout: "piped", stderr: "null" }).output();
    for (const l of new TextDecoder().decode(out.stdout).split("\n")) {
      const m = /^\s*(\d+)\s+(\d+)/.exec(l);
      if (m) parents.set(Number(m[1]), Number(m[2]));
    }
  } catch { /* no ps: only the child itself is signalled */ }
  return parents;
}

/** `root` and every process below it in `parents`. */
function treeOf(parents: ReadonlyMap<number, number>, root: number): number[] {
  const tree = [root];
  for (let i = 0; i < tree.length; i++) for (const [pid, ppid] of parents) if (ppid === tree[i] && !tree.includes(pid)) tree.push(pid);
  return tree;
}

function signal(pids: Iterable<number>, sig: Deno.Signal): void {
  for (const pid of pids)
    try {
      Deno.kill(pid, sig);
    } catch { /* already gone */ }
}

/** Ends `child` and its descendants (SIGTERM, then SIGKILL after `graceMs`) and waits for it; null when it will not die. */
async function endTree(child: Deno.ChildProcess, graceMs: number): Promise<Deno.CommandStatus | null> {
  const exited = child.status.then((s) => s, () => null);
  const first = treeOf(await snapshot(), child.pid);
  signal(first, "SIGTERM");
  let status = await within(exited, graceMs);
  // Whatever of the tree outlived SIGTERM: a child that ignored it, or descendants it left behind.
  const now = await snapshot();
  const survivors = new Set([...first, ...treeOf(now, child.pid)].filter((pid) => now.has(pid)));
  if (status === undefined || survivors.size > 0) {
    signal(survivors, "SIGKILL");
    status = status ?? (await within(exited, graceMs));
  }
  return status ?? null;
}

/** One stream read into at most `max` bytes; `onOverflow` runs when it would pass that. */
function collect(stream: ReadableStream<Uint8Array>, max: number, onOverflow: () => void) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        const room = max - size;
        if (value.length > room) {
          if (room > 0) chunks.push(value.subarray(0, room));
          size = max;
          onOverflow();
          return;
        }
        chunks.push(value);
        size += value.length;
      }
    } catch { /* cancelled */ }
  })();
  return {
    done,
    cancel: () => reader.cancel().catch(() => {}),
    text() {
      const all = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      return new TextDecoder().decode(all);
    },
  };
}

/** Runs `argv` to its exit, the deadline or an output overflow, whichever comes first; see the header. Throws only when the process cannot be spawned. */
export async function runBounded(argv: readonly string[], o: BoundedOptions): Promise<BoundedResult> {
  const max = o.maxBytes ?? OUTPUT_LIMIT;
  const graceMs = o.graceMs ?? 1000;
  const child = new Deno.Command(argv[0], { args: argv.slice(1), cwd: o.cwd, stdin: o.stdin === undefined ? "null" : "piped", stdout: "piped", stderr: "piped" }).spawn();
  if (o.stdin !== undefined) {
    const writer = child.stdin.getWriter();
    writer.write(new TextEncoder().encode(o.stdin)).then(() => writer.close()).catch(() => {});
  }
  let overflow = false;
  let flood!: () => void;
  const flooded = new Promise<"overflow">((r) => (flood = () => ((overflow = true), r("overflow"))));
  const out = collect(child.stdout, max, flood);
  const err = collect(child.stderr, max, flood);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), o.timeoutMs)));
  // The deadline by the clock as well as by the timer: when this process's event loop was held up, the end of late output
  // can be delivered before the overdue timer, and which callback ran first must not decide.
  const began = performance.now();
  const overdue = () => performance.now() - began >= o.timeoutMs;
  let code: number | null = null;
  let timedOut = false;
  try {
    const first = await Promise.race([child.status.then(() => "exit" as const), late, flooded]);
    if (first === "exit") {
      code = (await child.status).code;
      // The answer is the output, so its end is held to the same deadline and cap as the exit: what a descendant writes after the deadline is late.
      const drained = within(Promise.all([out.done, err.done]), o.drainMs ?? 1000).then(() => "drained" as const);
      timedOut = (await Promise.race([drained, late, flooded])) === "timeout" || overdue();
    } else {
      timedOut = first === "timeout";
      await endTree(child, graceMs);
    }
  } finally {
    clearTimeout(timer);
    await Promise.all([out.cancel(), err.cancel()]);
  }
  return { code, stdout: out.text(), stderr: err.text(), timedOut, overflow };
}
