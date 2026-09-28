/** Authenticated same-manifest recovery. Filesystem/process exclusion lives in the CLI. */
export interface CalibrationSchedule {
  phase: string;
  masterSeed: number;
  pairs: number;
  trials: number;
  strata: { scenario: string; preset: string }[];
}
export function trialKey(row: { scenario: string; preset: string; trial: number }): string {
  return `${row.scenario}:${row.preset}:${row.trial}`;
}
export function validateTrialPrefix(rows: any[], schedule: CalibrationSchedule, manifestHash: string): Map<string, any> {
  const expected = schedule.strata.flatMap(s => Array.from({length:schedule.trials},(_,trial)=>({...s,trial})));
  if (rows.length > expected.length) throw new Error("checkpoint exceeds frozen trial schedule");
  const map = new Map<string, any>();
  rows.forEach((row,index)=>{
    const e=expected[index];
    if (!row || trialKey(row)!==trialKey(e) || row.manifestHash!==manifestHash ||
      row.identity?.kind!=="synthetic" || row.identity?.generatorIdentity!==`${schedule.phase}:${schedule.masterSeed}:${e.scenario}:${e.preset}:${e.trial}` ||
      row.endpoint2?.n!==schedule.pairs || !Number.isFinite(row.endpoint2?.mean) || typeof row.endpoint2?.supported!=="boolean" ||
      !["ok","degenerate"].includes(row.endpoint2?.status) || row.endpoint1?.kind!=="test" ||
      !Array.isArray(row.endpoint1?.rows) || row.endpoint1.rows.length!==2 ||
      !Number.isFinite(row.wallSeconds) || row.wallSeconds<0) throw new Error(`invalid or non-prefix checkpoint trial ${index}`);
    if(map.has(trialKey(row)))throw new Error("duplicate checkpoint trial");
    map.set(trialKey(row),row);
  });
  return map;
}
export function validateResumeReport(report: any, manifestHash: string, logHash: string, capSeconds: number): number {
  if (!report || report.manifestHash!==manifestHash || report.trialLogSha256!==logHash || report.terminal!==true ||
    !Number.isFinite(report.cumulativeWallSeconds) || report.cumulativeWallSeconds<0 || !Number.isInteger(report.attempt) || report.attempt<1) {
    throw new Error("resume requires an authenticated terminal attempt and unchanged trial log");
  }
  if(report.complete)throw new Error("calibration is already complete");
  if(report.cumulativeWallSeconds>=capSeconds)throw new Error("cumulative calibration budget exhausted");
  return report.cumulativeWallSeconds;
}
