// Unit tests for tools/lib/report-html/write-all.ts's writeAll -- see that
// file's header for why this needs its own loop (Deno.FsFile.write can
// return fewer bytes written than given) and why it's testable directly
// under vitest (no Deno-specific types), unlike tools/report-html.ts itself.
import { describe, expect, it } from "vitest";

import { writeAll } from "../../lib/report-html/write-all.ts";

describe("writeAll", () => {
  it("writes the full buffer even when write() only accepts part of it each call (short-writing stub)", async () => {
    // A short writer that would have
    // kept only 1,024 of a much larger buffer with a single un-looped write().
    const data = new TextEncoder().encode("x".repeat(42150));
    const chunks: Uint8Array[] = [];
    const shortWrite = async (chunk: Uint8Array): Promise<number> => {
      const n = Math.min(1024, chunk.length);
      chunks.push(chunk.slice(0, n));
      return n;
    };
    await writeAll(shortWrite, data);
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(total).toBe(data.length);
    const reassembled = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      reassembled.set(c, offset);
      offset += c.length;
    }
    expect(reassembled).toEqual(data);
  });

  it("writes a single chunk in one call when write() accepts everything at once", async () => {
    const data = new TextEncoder().encode("hello");
    let calls = 0;
    const fullWrite = async (chunk: Uint8Array): Promise<number> => {
      calls++;
      return chunk.length;
    };
    await writeAll(fullWrite, data);
    expect(calls).toBe(1);
  });

  it("does nothing (zero calls) for an empty buffer", async () => {
    let calls = 0;
    const write = async (chunk: Uint8Array): Promise<number> => {
      calls++;
      return chunk.length;
    };
    await writeAll(write, new Uint8Array(0));
    expect(calls).toBe(0);
  });

  it("throws rather than looping forever if write() returns 0 with data remaining", async () => {
    const data = new TextEncoder().encode("hello");
    const stuckWrite = async (): Promise<number> => 0;
    await expect(writeAll(stuckWrite, data)).rejects.toThrow(/write\(\) returned 0/);
  });
});
