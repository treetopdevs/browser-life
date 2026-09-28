// Writes `data` fully via `write`, looping to handle a partial write --
// Deno's `Deno.FsFile.write` (like POSIX `write(2)`) is permitted to write
// fewer bytes than it was given in one call, so a single `await file.write(x)`
// can silently truncate the output with no error (see
// tools/report-html.ts's exclusive-create write path, this function's only
// real caller).
//
// No Deno-specific types here (just a plain callback), so unlike
// tools/report-html.ts itself -- a Deno CLI script that ends in a top-level
// `await main()` and cannot be imported under Node/vitest -- this module can
// be unit-tested directly under vitest with a fake short-writing stub.
export async function writeAll(write: (chunk: Uint8Array) => Promise<number>, data: Uint8Array): Promise<void> {
  let written = 0;
  while (written < data.length) {
    const n = await write(data.subarray(written));
    if (n <= 0) {
      throw new Error(
        `writeAll: write() returned ${n} bytes (must be > 0 while data remains) after writing ${written}/${data.length} bytes`,
      );
    }
    written += n;
  }
}
