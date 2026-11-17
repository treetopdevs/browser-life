/** Role-bound trace checks for audit-attempt.ts: the cadence comes from the file's role, never from the trace. */
import { validateTrack } from "./continuity.ts";
import type { Trace } from "./branch-diagnostic.ts";
export const ROLES=[["cpu25",25],["gpu25",25],["gpu50",50]] as const;
export function validateRoleTraces(traces:Trace[],mass:number,start:number) {
  if(traces.length!==ROLES.length)throw Error("missing role trace");
  traces.forEach((t,i)=>{
    const [role,cadence]=ROLES[i];
    if(t.cadence!==cadence)throw Error(`trace cadence ${t.cadence} does not match role ${role}`);
    validateTrack(t.track,mass,cadence,start);
    if(t.rows.length!==t.track.history.length+1||t.rows[0].offset!==0||t.rows[0].label!==t.track.initialLabel||t.rows[0].mass!==t.initialMass)throw Error("initial trace mismatch");
    t.track.history.forEach((h,j)=>{const r=t.rows[j+1];if(r.offset!==h.step-start||r.mass!==h.mass||r.label!==h.label)throw Error("trace/history mismatch");});
  });
}
