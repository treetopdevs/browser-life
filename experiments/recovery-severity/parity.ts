import { cloneState, canonicalObserverJSON, stateHash, totalsOf, ledgerResidual, validateState, worldW, type WorldState } from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { census } from "@bl/metrics";
import { RemnantTrack } from "../recovery-accessibility/observer.ts";
import { validateTrack } from "./continuity.ts";
import type { SeverityTarget } from "./selector.ts";

export interface Disc { center: number; radius: number }
export interface Backend {
  run(steps: number): void;
  lesion(x: number, y: number, radius: number): number | void;
  readState(): Promise<WorldState>;
  destroy(): void;
}
export type Factory = (state: WorldState) => Promise<Backend>;
export const referenceBackend: Factory = async state => {
  const sim = new RefSim(cloneState(state));
  return { run: n => { sim.run(n); }, lesion: (x,y,r) => applyLesion(sim,x,y,r),
    readState: async () => cloneState(sim.state), destroy() {} };
};
export function stateIdentity(s: WorldState): string {
  // Preserve explicit ledger/flux values alongside the canonical persistent-state hash.
  return canonicalObserverJSON({ hash: stateHash(s), cfg: s.cfg, step: s.step,
    lightIn: String(s.lightIn), heatOut: String(s.heatOut), flux: s.flux.map(String) });
}
export function assertConserved(initial: WorldState, next: WorldState): void {
  const errors = validateState(next), baseline = totalsOf(initial.cfg, initial.cells);
  // ledgerResidual expects the energy baseline at step zero.
  const energyDelta = (next.lightIn - initial.lightIn) - (next.heatOut - initial.heatOut);
  const adjusted = { ...next, lightIn: energyDelta, heatOut: 0n };
  if (errors.length || totalsOf(next.cfg,next.cells).matter !== baseline.matter || ledgerResidual(baseline,adjusted) !== 0n)
    throw new Error(`conservation/state invariant: ${errors.join(",")}`);
}
export function targetLabel(s: WorldState, target: SeverityTarget): number | undefined {
  const c = censusOf(s), votes = new Map<number,number>();
  for (const i of target.cells) if(c.labels[i]>=0) votes.set(c.labels[i],(votes.get(c.labels[i])??0)+1);
  return [...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0];
}
const censusOf = (s: WorldState) => census({cfg:s.cfg,step:s.step,cells:s.cells,genomeHead:s.genome},{threshold:48,minMass:128});
type TrackResult = ReturnType<RemnantTrack["result"]>;
/** Missing observations are errors; loss, fusion and cadence disagreement are biological failures. */
export function sustainedReturn(fast: TrackResult, slow: TrackResult, originalMass: number, start: number): number {
  validateTrack(fast,originalMass,25,start); validateTrack(slow,originalMass,50,start);
  if(originalMass<=0 || fast.initialLabel===null || fast.initialLabel!==slow.initialLabel || fast.lost || slow.lost || fast.merged || slow.merged
    || slow.history.some((r,i)=>r.label===null || r.label!==fast.history[2*i+1].label)) return 2025;
  // Initialization is eligible only when the immediate remnant itself meets 90%.
  // RemnantTrack does not retain initial mass; caller supplies it separately below.
  for(let offset=25;offset<=1800;offset+=25)
    if(fast.history.filter(r=>r.step>=start+offset).every(r=>10*r.mass>=9*originalMass)) return offset;
  return 2025;
}
export interface TraceRow { offset:number; identity:string; label:number|null; mass:number }
export async function branchTrace(factory:Factory, grown:WorldState, target:SeverityTarget, disc:Disc|null, cadence:25|50,
  guard:()=>void = ()=>{}, save: (phase:string,state:WorldState)=>Promise<void> = async()=>{}) {
  guard(); const backend=await factory(cloneState(grown));
  try {
    const uploaded=await backend.readState();
    if(stateIdentity(uploaded)!==stateIdentity(grown)) throw new Error("upload changed grown state");
    if(disc) backend.lesion(disc.center%worldW(grown.cfg),Math.floor(disc.center/worldW(grown.cfg)),disc.radius);
    const post=await backend.readState(); assertConserved(grown,post);
    const expected=cloneState(grown);
    if(disc) applyLesion(new RefSim(expected),disc.center%worldW(grown.cfg),Math.floor(disc.center/worldW(grown.cfg)),disc.radius);
    if(stateIdentity(post)!==stateIdentity(expected)) throw new Error("intervention/sham differs from CPU prescription");
    await save("post",post);
    const label=targetLabel(post,target), c=censusOf(post), track=new RemnantTrack(c,label,target.mass);
    const initialLabel=track.result().initialLabel;
    const initialMass=initialLabel===null?0:c.components[initialLabel].mass;
    const rows:TraceRow[]=[{offset:0,identity:stateIdentity(post),label:initialLabel,mass:initialMass}];
    for(let offset:number=cadence;offset<=2000;offset+=cadence) {
      guard(); backend.run(cadence); const s=await backend.readState(); guard();
      if(s.step!==grown.step+offset) throw new Error("wrong observation step");
      assertConserved(grown,s); track.update(censusOf(s));
      const r=track.result(); rows.push({offset,identity:stateIdentity(s),label:r.history.at(-1)!.label,mass:r.mass});
      if(offset===2000) await save("final",s);
    }
    return {cadence,initialMass,rows,track:track.result()};
  } finally {backend.destroy();}
}
export function compareTraces(a:Awaited<ReturnType<typeof branchTrace>>,b:Awaited<ReturnType<typeof branchTrace>>) {
  for(const row of b.rows) {
    const other=a.rows.find(r=>r.offset===row.offset);
    if(!other || other.identity!==row.identity) throw new Error(`physical state disagreement at ${row.offset}`);
    if(other.label!==row.label || other.mass!==row.mass) throw new Error(`tracked component disagreement at ${row.offset}`);
  }
}
export function returnTime(fast:Awaited<ReturnType<typeof branchTrace>>, slow:Awaited<ReturnType<typeof branchTrace>>, mass:number,start:number) {
  for(const trace of [fast,slow]) {
    if(trace.rows.length!==trace.track.history.length+1 || trace.rows[0].offset!==0 || trace.rows[0].label!==trace.track.initialLabel || trace.rows[0].mass!==trace.initialMass)throw new Error("trace initialization mismatch");
    for(let i=0;i<trace.track.history.length;i++) {
      const h=trace.track.history[i],r=trace.rows[i+1];
      if(r.offset!==h.step-start || r.mass!==h.mass || r.label!==h.label)throw new Error("trace/history disagreement");
    }
  }
  const t=sustainedReturn(fast.track,slow.track,mass,start);
  return t===25 && 10*fast.initialMass>=9*mass ? 0 : t;
}
