import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  campaignCore,
  campaignCoreDigest,
  canonicalJSON,
  caseIdOf,
  digestOf,
  hexToUint,
  manifestDigest,
  seedCollisions,
  sha256Hex,
  sha256HexJS,
  typedArrayHex,
  validateProtocol,
  validateResultManifest,
  type CampaignManifest,
  type CaseSpec,
} from "@bl/schema";

const vectors = JSON.parse(readFileSync(new URL("./discovery-vectors.json", import.meta.url), "utf8"));

describe("canonical encoding", () => {
  it("encodes typed arrays little-endian at their element width and round-trips them", () => {
    expect(typedArrayHex(Uint32Array.of(1))).toBe("01000000");
    expect(typedArrayHex(Uint16Array.of(0x1234, 0xffff))).toBe("3412ffff");
    expect(typedArrayHex(Int8Array.of(-1, 1))).toBe("ff01");
    expect(typedArrayHex(BigUint64Array.of(2n ** 64n - 1n))).toBe("ffffffffffffffff");
    const a = Uint32Array.of(0, 1, 0xdeadbeef, 0xffffffff);
    expect(Array.from(hexToUint(typedArrayHex(a), 4))).toEqual(Array.from(a));
    const b = Uint8Array.of(0, 255, 7);
    expect(Array.from(hexToUint(typedArrayHex(b), 1))).toEqual([0, 255, 7]);
    expect(() => hexToUint("010", 1)).toThrow();
    expect(() => hexToUint("010000", 4)).toThrow();
  });

  it("sorts keys recursively, writes wide counters as decimal strings and keeps array order", () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, 1], c: 2n ** 70n } })).toBe('{"a":{"c":"1180591620717411303424","d":[3,1]},"b":1}');
  });

  it("emits keys in sorted order even when they look like integers, and keeps an own __proto__ key", () => {
    expect(canonicalJSON({ "10": 1, "2": 2, b: 3 })).toBe('{"10":1,"2":2,"b":3}');
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":2}');
    expect(canonicalJSON(parsed)).toBe('{"__proto__":{"x":1},"a":2}');
    expect(canonicalJSON(parsed)).not.toBe(canonicalJSON({ a: 2 }));
  });

  it("rejects values that have no exact canonical form", () => {
    expect(() => canonicalJSON({ x: 0.5 })).toThrow(/safe integer/);
    expect(() => canonicalJSON({ x: NaN })).toThrow();
    expect(() => canonicalJSON({ x: Infinity })).toThrow();
    expect(() => canonicalJSON({ x: 2 ** 53 })).toThrow();
    expect(() => canonicalJSON({ x: -0 })).toThrow();
    expect(() => canonicalJSON({ x: undefined })).toThrow(/undefined/);
    expect(() => canonicalJSON({ x: new Map() })).toThrow(/unsupported/);
    expect(() => canonicalJSON({ x: () => 1 })).toThrow(/unsupported/);
  });
});

describe("SHA-256 without WebCrypto", () => {
  it("matches WebCrypto on edge lengths and the FIPS vectors", async () => {
    expect(sha256HexJS(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256HexJS(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 70_000]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff);
      expect(sha256HexJS(b)).toBe(await sha256Hex(b));
    }
  });
});

describe("shared test vectors (DESIGN 4)", () => {
  it("canonical bytes and digest of a payload with a typed array and a wide counter", async () => {
    const v = vectors.canonical;
    const payload = { counter: BigInt(v.input.counter), words: Uint32Array.from(v.input.words as number[]), label: v.input.label };
    expect(canonicalJSON(payload)).toBe(v.canonicalJSON);
    expect(await digestOf(payload)).toBe(v.sha256);
    expect(await sha256Hex(new TextEncoder().encode(v.canonicalJSON))).toBe(v.sha256);
  });

  it("campaign core digest, case ID and manifest digest", async () => {
    const m = vectors.manifest.value as CampaignManifest;
    const core = await campaignCoreDigest(m);
    expect(core).toBe(vectors.manifest.coreDigest);
    expect(Object.keys(campaignCore(m))).not.toContain("orderedCaseIds");
    expect(Object.keys(campaignCore(m))).not.toContain("proposalBatches");
    const spec = { ...(vectors.case.spec as CaseSpec), campaignDigest: core };
    const id = await caseIdOf(spec);
    expect(id).toBe(vectors.case.caseId);
    const full = { ...m, orderedCaseIds: [id], proposalBatches: [[id]] };
    expect(await manifestDigest(full)).toBe(vectors.manifest.manifestDigest);
    // The case list never feeds back into the core: no hashing cycle.
    expect(await campaignCoreDigest(full)).toBe(core);
  });
});

describe("protocol validation", () => {
  const proto = () => JSON.parse(readFileSync(new URL("../../../experiments/discovery/engineering-v1/protocol.json", import.meta.url), "utf8"));

  it("accepts the reviewed engineering protocol", () => {
    expect(validateProtocol(proto())).toEqual([]);
  });

  it("rejects unknown keys, duplicate fixtures, duplicate blocks and seeds outside the namespace", () => {
    const p = proto();
    p.extra = 1;
    p.fixtures.push({ ...p.fixtures[0] });
    p.blocks.push({ id: "eng-a", seed: 8500001 });
    p.blocks.push({ id: "eng-c", seed: 9000000 });
    const errs = validateProtocol(p).join("\n");
    expect(errs).toMatch(/unknown key extra/);
    expect(errs).toMatch(/fixtures\[6\]\.id: bad or duplicate/);
    expect(errs).toMatch(/blocks\[2\]\.id: bad or duplicate/);
    expect(errs).toMatch(/blocks\[2\]\.seed: collides/);
    expect(errs).toMatch(/blocks\[3\]\.seed: outside the campaign namespace/);
  });

  it("rejects a per-fixture seed, an unknown config key and an out-of-run segment step", () => {
    const p = proto();
    p.fixtures[0].config.seed = 5;
    p.fixtures[1].config.notAKey = 1;
    p.fixtures[2].segmentAt = [p.fixtures[2].steps];
    const errs = validateProtocol(p).join("\n");
    expect(errs).toMatch(/seed is set per block/);
    expect(errs).toMatch(/notAKey is not a default config key/);
    expect(errs).toMatch(/segmentAt/);
  });
});

describe("seed collisions", () => {
  it("finds reuse within the campaign and overlap with registered ranges, but not the campaign's own reservation", () => {
    const reg = [
      { first: 7310001, last: 7310001, owner: "construction renewal" },
      { first: 8500001, last: 8500999, owner: "discovery-engineering" },
    ];
    expect(seedCollisions([{ id: "a", seed: 8500001 }], reg, "discovery-engineering")).toEqual([]);
    const c = seedCollisions(
      [
        { id: "a", seed: 7310001 },
        { id: "b", seed: 7310001 },
      ],
      reg,
      "discovery-engineering",
    );
    expect(c.some((x) => x.includes("reuses seed"))).toBe(true);
    expect(c.some((x) => x.includes("construction renewal"))).toBe(true);
  });
});

describe("result manifest validation", () => {
  it("rejects unknown keys and malformed digests", () => {
    const errs = validateResultManifest({ schemaVersion: "discovery-v1", canonical: { caseId: "x" }, execution: {}, extra: 1 });
    expect(errs.join("\n")).toMatch(/unknown key extra/);
    expect(errs.join("\n")).toMatch(/missing/);
  });
});
