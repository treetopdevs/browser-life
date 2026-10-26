import { PRESETS, RULES, recipeForPreset, validateRecipe } from './model.ts';
import type { ParticleRecipe, PresetId } from './model.ts';

export const MAX_SELECTIONS = 30;
export const MAX_IMPORT_BYTES = 128 * 1024;
export const MAX_REASON_LENGTH = 240;
export interface RecipeNode { id: string; parentId: string | null; recipe: ParticleRecipe }
export interface Selection { round: number; candidateIds: [string,string,string]; chosenId: string; seed: number; evaluationTick: number; reason: string; nextSlate: [string,string,string] }
export interface Exploration { kind: 'particle-recipe-selections'; formatVersion: 1; modelVersion: number; generatorVersion: 1; seed: number; preset: PresetId; mutation: boolean; nodes: RecipeNode[]; slate: [string,string,string]; selections: Selection[] }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
export function recipeNode(session: Exploration, id: string): RecipeNode { const node=session.nodes.find(n=>n.id===id); if(!node) throw new Error('Unknown recipe ID'); return node; }
export function createExploration(seed: number, preset: PresetId, mutation=true): Exploration {
  if (!Number.isInteger(seed)||seed<0||seed>0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer');
  if (!PRESETS.some(p=>p.id===preset)||typeof mutation!=='boolean') throw new Error('Invalid founding settings');
  const order=[preset,...PRESETS.map(p=>p.id).filter(id=>id!==preset)];
  return freeze({kind:'particle-recipe-selections',formatVersion:1,modelVersion:RULES.version,generatorVersion:1,seed,preset,mutation,nodes:order.map((id,i)=>({id:`r${i}`,parentId:null,recipe:recipeForPreset(id)})),slate:['r0','r1','r2'],selections:[]});
}
function hash(value: string) { let h=2166136261; for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619); return h>>>0; }
function variant(parent: RecipeNode, seed: number, round: number, slot: number, other?: ParticleRecipe): ParticleRecipe {
  const key=hash(`${seed}:${parent.id}:${round}:${slot}`),start=key%11,sign=(key>>>8)&1?1:-1;
  for(let attempt=0;attempt<22;attempt++){
    const recipe=structuredClone(parent.recipe),coordinate=(start+Math.floor(attempt/2))%11,direction=attempt%2?-sign:sign;
    const lo=coordinate<9?-1:coordinate===9?0:.3,hi=coordinate<9?1:coordinate===9?.2:1;
    const previous=coordinate<9?recipe.rows[Math.floor(coordinate/3)][coordinate%3]:coordinate===9?recipe.alignment:recipe.foodRenewal;
    const step=coordinate<9?.15:coordinate===9?.03:.1;
    let next=previous+direction*step;
    if(next<lo)next=lo+(lo-next);if(next>hi)next=hi-(next-hi);
    next=Math.round(next*1000)/1000;
    if(coordinate<9)recipe.rows[Math.floor(coordinate/3)][coordinate%3]=next;else if(coordinate===9)recipe.alignment=next;else recipe.foodRenewal=next;
    if(JSON.stringify(recipe)!==JSON.stringify(parent.recipe)&&(!other||JSON.stringify(recipe)!==JSON.stringify(other)))return validateRecipe(recipe);
  }
  throw new Error('Could not generate distinct recipe variations');
}
export function keepFavorite(session: Exploration, slot: 0|1|2, evaluationTick: number, reason=''): Exploration {
  if(!Number.isInteger(slot)||slot<0||slot>2)throw new Error('Choose one of the three recipes');
  if(!Number.isSafeInteger(evaluationTick)||evaluationTick<0||evaluationTick>10_000_000)throw new Error('Evaluation tick is out of bounds');
  if(typeof reason!=='string'||reason.length>MAX_REASON_LENGTH)throw new Error('Reason must be at most 240 characters');
  if(session.selections.length>=MAX_SELECTIONS)throw new Error('Selection limit reached. Export and start a new session.');
  const round=session.selections.length+1,parent=recipeNode(session,session.slate[slot]);
  const first=variant(parent,session.seed,round,1),second=variant(parent,session.seed,round,2,first);
  const ids:[string,string,string]=[parent.id,`r${session.nodes.length}`,`r${session.nodes.length+1}`];
  const next=structuredClone(session);
  next.nodes.push({id:ids[1],parentId:parent.id,recipe:first},{id:ids[2],parentId:parent.id,recipe:second});
  next.selections.push({round,candidateIds:[...session.slate],chosenId:parent.id,seed:session.seed,evaluationTick,reason,nextSlate:ids});next.slate=ids;
  return freeze(next);
}
function canonical(value: unknown, depth = 0): string {
  if(depth > 12) throw new Error('Selection file has unsupported nesting');
  if(Array.isArray(value))return `[${value.map(child => canonical(child, depth + 1)).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v, depth + 1)}`).join(',')}}`;
  return JSON.stringify(value);
}
export interface ExplorationImport { session: Exploration; migratedFrom: number | null }
export function parseExplorationWithNotice(text: string): ExplorationImport {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_IMPORT_BYTES)throw new Error('Selection file exceeds 128 KiB');
  let input: unknown;try{input=JSON.parse(text);}catch{throw new Error('Selection file is not valid JSON');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Selection file must be an object');
  const data=input as Exploration;
  const sourceVersion=data.modelVersion;
  if(data.kind!=='particle-recipe-selections'||data.formatVersion!==1||data.generatorVersion!==1||(sourceVersion!==2&&sourceVersion!==RULES.version))throw new Error('Unsupported selection-file version');
  if(!Array.isArray(data.selections)||data.selections.length>MAX_SELECTIONS)throw new Error('Invalid selection history length');
  let rebuilt=createExploration(data.seed,data.preset,data.mutation);
  // Rebuild the complete historical graph under the file's declared version before upgrading it.
  if(sourceVersion!==RULES.version)rebuilt=freeze({...rebuilt,modelVersion:sourceVersion});
  for(const selection of data.selections){
    if(!selection||typeof selection!=='object')throw new Error('Invalid selection record');
    const slot=rebuilt.slate.indexOf(selection.chosenId);
    if(slot<0)throw new Error('Chosen recipe was not in its recorded slate');
    rebuilt=keepFavorite(rebuilt,slot as 0|1|2,selection.evaluationTick,selection.reason);
  }
  // Reconstructing the whole bounded graph rejects invented parents, recipes, IDs and extra fields.
  if(canonical(data)!==canonical(rebuilt))throw new Error('Selection file recipes or relationships do not match its recorded choices');
  const session=sourceVersion===RULES.version?rebuilt:freeze({...rebuilt,modelVersion:RULES.version});
  return Object.freeze({session,migratedFrom:sourceVersion===RULES.version?null:sourceVersion});
}
export function parseExploration(text: string): Exploration { return parseExplorationWithNotice(text).session; }
export function serializeExploration(session: Exploration): string { return JSON.stringify(session,null,2); }
