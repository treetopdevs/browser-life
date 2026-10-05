import { describe, expect, it } from "vitest";
import { parentMap, rootWalker } from "../lib/clade.ts";

async function* rows(ls: string[]): AsyncGenerator<string> {
  for (const l of ls) yield l;
}

const HEADER = "childHi\tchildLo\tparentHi\tparentLo";

describe("clade roots", () => {
  it("walks a chain to the lineage that is nobody's child", async () => {
    const map = await parentMap(rows([HEADER, "2\t10\t0\t11", "5\t3\t2\t10"]));
    const root = rootWalker(map);
    expect(root("5:3")).toBe("0:11");
    expect(root("2:10")).toBe("0:11");
    expect(root("0:11")).toBe("0:11");
    expect(root("9:9")).toBe("9:9");
  });

  it("keeps the first parent row for a child", async () => {
    const map = await parentMap(rows([HEADER, "2\t10\t0\t11", "2\t10\t0\t12", ""]));
    expect(map.get("2:10")).toBe("0:11");
    expect(rootWalker(map)("2:10")).toBe("0:11");
  });

  it("throws on a parent cycle", async () => {
    const map = await parentMap(rows([HEADER, "1\t1\t2\t2", "2\t2\t1\t1"]));
    expect(() => rootWalker(map)("1:1")).toThrow(/cycle/);
  });

  it("keeps keys exact where hi * 2^32 + lo would collide", async () => {
    const hi = 2 ** 22 + 1;
    const map = await parentMap(rows([HEADER, `${hi}\t5\t0\t7`, `${hi}\t6\t${hi}\t5`]));
    const root = rootWalker(map);
    expect(root(`${hi}:6`)).toBe("0:7");
  });
});
