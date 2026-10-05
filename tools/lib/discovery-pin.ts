// Decision D5 (2026-10-04): cases that need the construction workstream's
// renewal observer run pinned to a named construction revision. The pin is
// vendor/construction-renewal-v1/, a byte-for-byte copy of the frozen
// renewal-v1 source tree whose digest is recorded in PIN.json. This module
// verifies the pin and runs tools/discovery-pin-case.ts under the pin's own
// deno.json, so `@bl/schema` and `@bl/sim-ref` resolve to the pinned
// packages and no workbench physics is mixed in.
//
// Uses node: APIs for hashing so the Vite config (Node) and Deno compute the
// same values.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

export const PIN_DIR = "vendor/construction-renewal-v1";
export const PIN_SCRIPT = "tools/discovery-pin-case.ts";
/** The backend contract of a pinned renewal case. */
export const RENEWAL_BACKEND = "cpu-ref-renewal-pin-v1" as const;

export interface PinRecord {
  name: string;
  constructionRevision: string;
  constructionChange: string;
  renewalManifestSha256: string;
  renewalProtocolSha256: string;
  sourceDigest: string;
  files: Record<string, string>;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * The one pin this build accepts (decision D5). Hard-coded, not read from
 * PIN.json, so a vendored tree whose code and hashes were changed together
 * cannot pass; equal to RENEWAL_PIN in @bl/schema (checked by the tests).
 */
export const EXPECTED_PIN = {
  name: "construction-renewal-v1",
  constructionRevision: "ca8a4dbd08000ae406e48acf242469d48d04b6c2",
  sourceDigest: "24cef9e2f79abaad6d9260e63585c30c1b0a3516d38e669321235ccd3d0e6362",
  fileCount: 36,
} as const;

/** Reads PIN.json and verifies the expected identity, every vendored file and the tree digest. Throws on any mismatch. */
export function verifyPin(repoRoot: string): PinRecord {
  const dir = join(repoRoot, PIN_DIR);
  const pin = JSON.parse(readFileSync(join(dir, "PIN.json"), "utf8")) as PinRecord;
  if (pin.name !== EXPECTED_PIN.name || pin.constructionRevision !== EXPECTED_PIN.constructionRevision || pin.sourceDigest !== EXPECTED_PIN.sourceDigest || Object.keys(pin.files).length !== EXPECTED_PIN.fileCount) {
    throw new Error(`pin: PIN.json does not describe the pin this build accepts (${EXPECTED_PIN.name} at ${EXPECTED_PIN.sourceDigest})`);
  }
  for (const [path, hash] of Object.entries(pin.files)) {
    const actual = sha256(readFileSync(join(dir, path)));
    if (actual !== hash) throw new Error(`pin: vendored ${path} differs from the frozen construction tree (${actual} != ${hash})`);
  }
  const text = JSON.stringify(Object.keys(pin.files).sort().map((p) => [p, pin.files[p]]));
  if (sha256(new TextEncoder().encode(text)) !== pin.sourceDigest) throw new Error("pin: tree digest differs from PIN.json");
  return pin;
}

/** Repository-relative paths the pin contributes to the workbench's source closure. */
export function pinClosureFiles(repoRoot: string): string[] {
  const pin = JSON.parse(readFileSync(join(repoRoot, PIN_DIR, "PIN.json"), "utf8")) as PinRecord;
  return [`${PIN_DIR}/PIN.json`, ...Object.keys(pin.files).map((p) => `${PIN_DIR}/${p}`), PIN_SCRIPT, "tools/lib/discovery-pin.ts"];
}

/** The manifest's record of the pin. */
export function pinManifestRecord(pin: PinRecord): { name: string; constructionRevision: string; sourceDigest: string } {
  return { name: pin.name, constructionRevision: pin.constructionRevision, sourceDigest: pin.sourceDigest };
}

/**
 * Runs one verb of the pinned case script with a JSON request on stdin and
 * returns its JSON reply. Binary fields travel as base64. The child gets the
 * pin's configuration and no remote, npm or lock-resolved modules.
 */
export async function pinCall<T>(repoRoot: string, verb: string, request: unknown, timeoutMs = 0): Promise<T> {
  const root = resolve(repoRoot);
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", `--config=${join(root, PIN_DIR, "deno.json")}`, "--no-lock", "--no-remote", "--no-npm", join(root, PIN_SCRIPT), verb],
    cwd: root,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(request)));
  await writer.close();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const out = await child.output();
  if (timer !== undefined) clearTimeout(timer);
  if (!out.success) {
    const err = new TextDecoder().decode(out.stderr).trim().split("\n").filter((l) => l.trim()).slice(-3).join(" | ");
    throw new Error(timeoutMs > 0 && out.signal === "SIGKILL" ? `pinned ${verb} exceeded its wall-time limit (${timeoutMs / 1000} s)` : `pinned ${verb} failed: ${err}`);
  }
  return JSON.parse(new TextDecoder().decode(out.stdout)) as T;
}

export const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// deno-lint-ignore no-explicit-any
type Any = any;
const FILES = ["observations.jsonl", "readout.json", "end.blck"] as const;

/** The pinned validator for validateAttempt (packages/runner/src/discovery.ts PinnedValidator). */
export function pinnedValidator(repoRoot: string) {
  return async (req: { spec: Any; caseId: string; result: Any; initial: Uint8Array; files: Record<string, Uint8Array> }): Promise<{ errors: string[]; readout: Any }> => {
    try {
      verifyPin(repoRoot);
      return await pinCall(repoRoot, "validate", {
        spec: req.spec,
        caseId: req.caseId,
        result: req.result,
        initial: b64(req.initial),
        files: Object.fromEntries(FILES.map((f) => [f, b64(req.files[f])])),
      });
    } catch (e) {
      return { errors: [`pinned validation failed: ${(e as Error).message}`], readout: null };
    }
  };
}

/** Runs one pinned renewal case; returns the result manifest and the three result files. */
export async function pinRunCase(repoRoot: string, spec: Any, caseId: string, initial: Uint8Array, opts: Any, timeoutMs: number): Promise<{ result: Any; files: Record<string, Uint8Array> }> {
  verifyPin(repoRoot);
  const out = await pinCall<{ result: Any; files: Record<string, string> }>(repoRoot, "run", { spec, caseId, initial: b64(initial), opts: { ...opts, deadlineMs: opts.deadline } }, timeoutMs);
  return { result: out.result, files: Object.fromEntries(FILES.map((f) => [f, unb64(out.files[f])])) };
}
