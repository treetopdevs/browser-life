/** Join exact drained mutation events to the final passive frame without inventing earlier frames. */
import { RING_CELL_MASK, cellCount, packLineageLo, type WorldConfig } from "@bl/schema";
import type { MutationEvent } from "@bl/sim-ref";
import { diagnosticWord, type ResetGpuSnapshot } from "./reset-gpu-copy-audit.ts";

export interface ResetJoinedMutation {
  childStep: number; site: number; parentLineage: string; childLineage: string;
  /** An event emitted before the last audited step has no retained pre/post genome comparison. */
  effect: "effective-genotype-change" | "clamped-or-no-change-proposal" |
    "transient-after-death" | "unavailable-earlier-step";
  copySourceAtReference: number | null;
  referenceStep: number;
}

export function joinResetMutationEvents(cfg: WorldConfig, windowStart: number,
  snapshot: ResetGpuSnapshot, events: readonly MutationEvent[]): ResetJoinedMutation[] {
  const n = cellCount(cfg);
  if (!Number.isSafeInteger(windowStart) || windowStart < 0 ||
      snapshot.referenceStep !== windowStart || snapshot.step <= windowStart ||
      snapshot.tags.length !== n || snapshot.diagnostics.length !== n * 10)
    throw new Error("mutation join lacks the exact audited physical window");
  const seen = new Set<string>(), result: ResetJoinedMutation[] = [];
  for (const event of events) {
    const site = cfg.ringNamespace === undefined ? event.childLo : event.childLo & RING_CELL_MASK;
    const key = `${event.childHi}:${event.childLo}`;
    if (seen.has(key) || event.childHi <= windowStart || event.childHi > snapshot.step ||
        !Number.isSafeInteger(site) || site < 0 || site >= n ||
        event.childLo !== packLineageLo(cfg, site))
      throw new Error("mutation event is duplicate or outside audited window/site");
    seen.add(key);
    let effect: ResetJoinedMutation["effect"] = "unavailable-earlier-step";
    let copySourceAtReference: number | null = null;
    if (event.childHi === snapshot.step) {
      const d = snapshot.diagnostics;
      if (diagnosticWord(d, n, 6, site) !== event.parentHi ||
          diagnosticWord(d, n, 7, site) !== event.parentLo)
        throw new Error("last-step mutation parent differs from passive lottery winner");
      const afterHi = diagnosticWord(d, n, 8, site);
      const afterLo = diagnosticWord(d, n, 9, site);
      if (afterHi === 0 && afterLo === 0) effect = "transient-after-death";
      else if (afterHi === event.childHi && afterLo === event.childLo) {
        effect = diagnosticWord(d, n, 5, site) !== 0 ?
          "effective-genotype-change" : "clamped-or-no-change-proposal";
        const tag = diagnosticWord(d, n, 4, site);
        copySourceAtReference = tag === 0 ? null : tag - 1;
      } else throw new Error("last-step mutation child differs from passive postreaction genome");
    }
    result.push({ childStep: event.childHi, site,
      parentLineage: `${event.parentHi}:${event.parentLo}`,
      childLineage: `${event.childHi}:${event.childLo}`,
      effect, copySourceAtReference, referenceStep: windowStart });
  }
  return result;
}
