/** Separate, create-new seed-use receipts. The immutable allocation ledger stays reserved. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, type FileDigest } from "./foundation-replay.ts";

export interface V2SeedReservation {
  format: "foundation-serial-v2-seed-reservation/v1";
  stage: 0 | 1 | 2; seed: number; outputPath: string;
  planPath: string; planFile: FileDigest; allocationSha256: string; startedAt: string;
}
export interface V2SeedCompletion {
  format: "foundation-serial-v2-seed-completion/v1";
  stage: 0 | 1 | 2; seed: number; reservationFile: FileDigest;
  status: "complete" | "incomplete-time-cap" | "failed";
  resultPath: string; resultFile: FileDigest; endedAt: string;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const outputRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../runs/foundations-next");
export function assertV2OutputPath(out: string): void {
  if (dirname(resolve(out)) !== outputRoot)
    throw new Error("A2 output must be a direct new directory under runs/foundations-next");
}
const receiptDir = (out: string, seed: number) => join(dirname(resolve(out)), `seed-use-${seed}`);

export async function assertV2SeedAvailableForOutput(out: string, seed: number): Promise<void> {
  const path = join(receiptDir(out, seed), "reservation.json");
  try {
    const saved = JSON.parse(await Deno.readTextFile(path)) as V2SeedReservation;
    if (saved.outputPath !== resolve(out))
      throw new Error(`A2 seed ${seed} is already bound to a different output: ${saved.outputPath}`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

export async function reserveV2Seed(out: string, stage: 0 | 1 | 2, seed: number,
  planFile: FileDigest, allocationSha256: string): Promise<V2SeedReservation> {
  if (!Number.isSafeInteger(seed) || !/^[a-f0-9]{64}$/.test(allocationSha256))
    throw new Error("A2 seed reservation lacks exact seed/allocation identity");
  const directory = receiptDir(out, seed);
  await Deno.mkdir(directory); // create-new. A failed or interrupted use is never silently replaced.
  const reservation: V2SeedReservation = {
    format: "foundation-serial-v2-seed-reservation/v1", stage, seed,
    outputPath: resolve(out), planPath: join(resolve(out), "plan.json"), planFile,
    allocationSha256, startedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(join(directory, "reservation.json"),
    JSON.stringify(reservation, null, 2) + "\n", { createNew: true });
  return reservation;
}

export async function completeV2Seed(reservation: V2SeedReservation,
  status: V2SeedCompletion["status"]): Promise<V2SeedCompletion> {
  const directory = receiptDir(reservation.outputPath, reservation.seed);
  const reservationBytes = await Deno.readFile(join(directory, "reservation.json"));
  if (!same(JSON.parse(new TextDecoder().decode(reservationBytes)), reservation))
    throw new Error("A2 seed reservation changed before completion");
  const resultPath = join(reservation.outputPath, "result.json");
  const completion: V2SeedCompletion = {
    format: "foundation-serial-v2-seed-completion/v1", stage: reservation.stage,
    seed: reservation.seed, reservationFile: sha256(reservationBytes), status,
    resultPath, resultFile: sha256(await Deno.readFile(resultPath)),
    endedAt: new Date().toISOString(),
  };
  await Deno.writeTextFile(join(directory, "completion.json"),
    JSON.stringify(completion, null, 2) + "\n", { createNew: true });
  return completion;
}

export async function verifyV2SeedCompletion(out: string, stage: 0 | 1 | 2,
  seed: number, planFile: FileDigest, resultFile: FileDigest,
  allocationSha256: string): Promise<void> {
  const directory = receiptDir(out, seed);
  const reservationBytes = await Deno.readFile(join(directory, "reservation.json"));
  const reservation = JSON.parse(new TextDecoder().decode(reservationBytes)) as V2SeedReservation;
  const completion = JSON.parse(await Deno.readTextFile(join(directory, "completion.json"))) as V2SeedCompletion;
  if (reservation.format !== "foundation-serial-v2-seed-reservation/v1" ||
      reservation.stage !== stage || reservation.seed !== seed ||
      reservation.outputPath !== resolve(out) ||
      reservation.planPath !== join(resolve(out), "plan.json") ||
      !same(reservation.planFile, planFile) ||
      reservation.allocationSha256 !== allocationSha256 ||
      completion.format !== "foundation-serial-v2-seed-completion/v1" ||
      completion.stage !== stage || completion.seed !== seed || completion.status !== "complete" ||
      completion.resultPath !== join(resolve(out), "result.json") ||
      !same(completion.reservationFile, sha256(reservationBytes)) ||
      !same(completion.resultFile, resultFile))
    throw new Error("A2 prior seed-use receipt does not match exact completed stage evidence");
}
