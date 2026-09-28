import { describe, expect, it } from "vitest";
import { parseCopyDiagnosticArgs } from "../foundation-copy-diagnostic.ts";

const planArgs = ["--source", "/source", "--cache", "/cache", "--catalog", "/catalog",
  "--rule", "/rule", "--prior-serial", "/prior.json", "--max-seconds", "180",
  "--out", "/new-output"];

describe("A1 natural diagnostic execution boundary", () => {
  it("requires a bounded plan with all provenance inputs", () => {
    expect(parseCopyDiagnosticArgs(planArgs)).toMatchObject({ execute: false, maxSeconds: 180,
      priorSerial: "/prior.json" });
    expect(() => parseCopyDiagnosticArgs(planArgs.filter((x) => x !== "/prior.json")))
      .toThrow(/invalid|prior-serial/);
    expect(() => parseCopyDiagnosticArgs([...planArgs, "--source", "/other"]))
      .toThrow(/duplicate/);
    expect(() => parseCopyDiagnosticArgs(planArgs.map((x) => x === "180" ? "181" : x)))
      .toThrow(/<=180/);
    expect(() => parseCopyDiagnosticArgs(planArgs.map((x) => x === "180" ? "NaN" : x)))
      .toThrow(/finite/);
  });

  it("execution can only consume a previously saved plan path", () => {
    expect(parseCopyDiagnosticArgs(["--execute", "--out", "/new-output"]))
      .toEqual({ execute: true, out: "/new-output", maxSeconds: undefined,
        source: undefined, cache: undefined, catalog: undefined, rule: undefined,
        priorSerial: undefined });
    expect(() => parseCopyDiagnosticArgs(["--execute", ...planArgs]))
      .toThrow(/only --out/);
    expect(() => parseCopyDiagnosticArgs(["--execute", "--out", "/new-output", "--max-seconds", "1"]))
      .toThrow(/only --out/);
  });
});
