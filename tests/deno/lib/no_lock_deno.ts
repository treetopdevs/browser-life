// A `deno` for the PATH of a launcher or server a test starts that runs deno itself (bin/garden-dev's `deno eval`, the
// coordinator's discovery validator): it runs this deno with --no-lock added to run, eval, test, check and cache, so the
// test never rewrites deno.lock (tools/test/deno-no-lock.test.ts checks the tests' own deno starts). It execs, so it
// adds no process. POSIX sh only, like the tests that use it.

/** The shim's text for the deno at `deno`, single-quoted for sh so a `$` or backtick in the path is not expanded. */
export function noLockDenoShim(deno: string): string {
  const q = `'${deno.replaceAll("'", `'\\''`)}'`;
  return `#!/bin/sh\ncase "$1" in run|eval|test|check|cache) sub=$1; shift; exec ${q} "$sub" --no-lock "$@" ;; esac\nexec ${q} "$@"\n`;
}

/** Writes the shim for this deno as `<dir>/deno` (creating `dir`) and returns `dir`, to put first on the child's PATH. */
export async function noLockDenoBin(dir: string): Promise<string> {
  await Deno.mkdir(dir, { recursive: true });
  const shim = `${dir}/deno`;
  await Deno.writeTextFile(shim, noLockDenoShim(Deno.execPath()));
  await Deno.chmod(shim, 0o755);
  return dir;
}
