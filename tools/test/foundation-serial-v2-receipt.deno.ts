import assert from "node:assert/strict";
import { join } from "node:path";
import { sha256 } from "../lib/foundation-replay.ts";
import { assertV2SeedAvailableForOutput, completeV2Seed, reserveV2Seed,
  verifyV2SeedCompletion } from "../lib/foundation-serial-v2-receipt.ts";

Deno.test("A2 receipt binds one exact plan/result and rejects fresh seed reuse", async () => {
    const root = await Deno.makeTempDir({ prefix: "foundation-v2-receipt-" });
    try {
      const out = join(root, "stage0"), other = join(root, "replacement");
      await Deno.mkdir(out);
      const planBytes = new TextEncoder().encode("frozen-plan");
      const resultBytes = new TextEncoder().encode("complete-result");
      await Deno.writeFile(join(out, "plan.json"), planBytes);
      await Deno.writeFile(join(out, "result.json"), resultBytes);
      const planFile = sha256(planBytes), resultFile = sha256(resultBytes);
      const allocation = "a".repeat(64);
      await assertV2SeedAvailableForOutput(out, 640020101);
      const reservation = await reserveV2Seed(out, 0, 640020101, planFile, allocation);
      await assert.rejects(assertV2SeedAvailableForOutput(other, 640020101), /already bound/);
      await assert.rejects(reserveV2Seed(other, 0, 640020101, planFile, allocation));
      await completeV2Seed(reservation, "complete");
      await verifyV2SeedCompletion(out, 0, 640020101, planFile, resultFile, allocation);
      await assert.rejects(verifyV2SeedCompletion(out, 0, 640020101, planFile,
        { ...resultFile, sha256: "0".repeat(64) }, allocation), /exact completed/);
      await assert.rejects(verifyV2SeedCompletion(out, 0, 640020101,
        { ...planFile, sha256: "0".repeat(64) }, resultFile, allocation), /exact completed/);
      await assert.rejects(verifyV2SeedCompletion(out, 0, 640020101, planFile,
        resultFile, "0".repeat(64)), /exact completed/);
      await assert.rejects(completeV2Seed(reservation, "complete"));
    } finally { await Deno.remove(root, { recursive: true }); }
});

Deno.test("A2 failed seed use remains unavailable for replacement stream", async () => {
    const root = await Deno.makeTempDir({ prefix: "foundation-v2-failed-" });
    try {
      const out = join(root, "stage0"), other = join(root, "replacement");
      await Deno.mkdir(out);
      const bytes = new TextEncoder().encode("failed-result");
      await Deno.writeFile(join(out, "result.json"), bytes);
      const planFile = sha256(new TextEncoder().encode("plan"));
      const allocation = "b".repeat(64);
      const reservation = await reserveV2Seed(out, 0, 640020101, planFile, allocation);
      await completeV2Seed(reservation, "failed");
      await assert.rejects(verifyV2SeedCompletion(out, 0, 640020101, planFile,
        sha256(bytes), allocation), /exact completed/);
      await assert.rejects(assertV2SeedAvailableForOutput(other, 640020101), /already bound/);
    } finally { await Deno.remove(root, { recursive: true }); }
});
