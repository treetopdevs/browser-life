export interface ComparisonRelease {
  format: "founder-policy-comparison-release/v1";
  manifestSha256: string;
  pilotGateSha256: string;
  approvedAt: string;
  execution: "local" | "paid";
  allInHourlyUSD: number;
  priceSource: string;
  forecast: { histories: 72; requestedAssays: 82944; conservativeUniqueAssays: number; evolutionSeconds: number; assaySeconds: number; storageUSD: number; teardownUSD: number };
  globalRemainingUSD: number;
  comparisonSpentUSD: number;
  externalSpentUSD: number;
  priorReceiptsSha256: string;
  spentThroughAt: string;
  maxInvocationSeconds: number;
}

function money(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x) && x >= 0; }
export function validateRelease(release: ComparisonRelease, manifestSha256: string, pilotGateSha256: string, requestedSeconds: number, priorReceiptsSha256: string, priorInvocationUSD: number, minimumConservativeUniqueAssays: number): { projectedTotalUSD: number; invocationCostCeilingUSD: number } {
  if (release.format !== "founder-policy-comparison-release/v1" || release.manifestSha256 !== manifestSha256 || release.pilotGateSha256 !== pilotGateSha256 || !Number.isFinite(Date.parse(release.approvedAt))) throw Error("comparison release identity drift");
  if (!Number.isFinite(Date.parse(release.spentThroughAt)) || release.priorReceiptsSha256 !== priorReceiptsSha256 || new Date(release.spentThroughAt).getTime() > new Date(release.approvedAt).getTime()) throw Error("comparison release has stale cumulative-spend ledger");
  if (release.execution !== "local" && release.execution !== "paid") throw Error("comparison execution mode missing");
  if (![release.allInHourlyUSD, release.forecast.evolutionSeconds, release.forecast.assaySeconds, release.forecast.storageUSD, release.forecast.teardownUSD, release.globalRemainingUSD, release.comparisonSpentUSD, release.externalSpentUSD, release.maxInvocationSeconds, priorInvocationUSD].every(money)) throw Error("comparison release has invalid cost/time field");
  if (Math.abs(release.comparisonSpentUSD - (release.externalSpentUSD + priorInvocationUSD)) > 1e-9) throw Error("comparison cumulative paid spend disagrees with prior receipts and external spend");
  if (!release.priceSource || release.forecast.histories !== 72 || release.forecast.requestedAssays !== 82944 || !Number.isSafeInteger(release.forecast.conservativeUniqueAssays) || release.forecast.conservativeUniqueAssays < minimumConservativeUniqueAssays || release.forecast.conservativeUniqueAssays > 82944) throw Error("comparison forecast below conservative complete-roster bound");
  if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0 || requestedSeconds > release.maxInvocationSeconds) throw Error("requested runtime exceeds released ceiling");
  if (release.execution === "paid" && release.allInHourlyUSD <= 0) throw Error("paid comparison requires positive all-in hourly price");
  if (release.execution === "local" && release.allInHourlyUSD !== 0) throw Error("local comparison must explicitly price at zero");
  const projectedTotalUSD = (release.forecast.evolutionSeconds + release.forecast.assaySeconds) * release.allInHourlyUSD / 3600 + release.forecast.storageUSD + release.forecast.teardownUSD;
  const comparisonRemaining = 35 - release.comparisonSpentUSD;
  const globalLessCloseout = release.globalRemainingUSD - 5;
  if (comparisonRemaining < 0 || globalLessCloseout < 0 || projectedTotalUSD > comparisonRemaining || projectedTotalUSD > globalLessCloseout) throw Error("complete comparison forecast exceeds $35/global reserve");
  const invocationCostCeilingUSD = requestedSeconds * release.allInHourlyUSD / 3600;
  if (invocationCostCeilingUSD > comparisonRemaining || invocationCostCeilingUSD > globalLessCloseout) throw Error("invocation can exceed released remaining budget");
  return { projectedTotalUSD, invocationCostCeilingUSD };
}
