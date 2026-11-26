// Hall-of-fame soups for the Red Queen test (docs/soup-redqueen-2026-11-01.md,
// Part C): the sustained-leader history each run keeps, what it plants, and
// where. Pure functions; the GPU driver is tools/soup-hall.ts.
import { TAPE } from "./bff.ts";
import { rng, unhex } from "./evo.ts";

export const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };

export type Arm = "HALL" | "CTRL";
export const ARMS: Arm[] = ["HALL", "CTRL"];
export const GROUPS = 4; // groups of P copies planted every interval, in every arm

export interface LeaderRow { id: string; rep: string; mirror: string | null }
export interface Member { id: string; forms: string[]; since: number }

/** A run's sustained leader (exact type id, two consecutive censuses) and every type that has been it (doc: Each interval, 2-3). */
export class History {
  members: Member[] = [];
  current = -1; // index into members
  changes = 0;
  rr = 0; // HALL's round-robin counter
  returned = false;
  prev: string | null = null; // census leader id at the previous census

  /** Feeds one census leader (null when no copier leads). The first leader seen is the sustained leader at once. */
  observe(row: LeaderRow | null, epoch: number): void {
    const id = row?.id ?? null;
    if (row && this.current < 0) this.current = this.admit(row, epoch);
    else if (row && id !== this.members[this.current].id && id === this.prev) {
      const i = this.members.findIndex((m) => m.id === id);
      this.current = i >= 0 ? i : this.admit(row, epoch); // a type that leads again keeps its first forms
      this.returned = i >= 0; // the current leader had been displaced and came back
      this.changes++;
    }
    this.prev = id;
  }

  private admit(row: LeaderRow, epoch: number): number {
    this.members.push({ id: row.id, forms: row.mirror ? [row.rep, row.mirror] : [row.rep], since: epoch });
    return this.members.length - 1;
  }

  /** History without the current leader, in history order. */
  past(): Member[] { return this.members.filter((_, i) => i !== this.current); }

  save() { return { members: this.members, current: this.current, changes: this.changes, rr: this.rr, prev: this.prev, returned: this.returned }; }
  static load(s: ReturnType<History["save"]>): History { return Object.assign(new History(), s); }
}

/** This interval's GROUPS groups (forms per group) for an arm; HALL advances its round-robin counter (doc: Arms). */
export function plantGroups(arm: Arm, h: History): string[][] {
  if (h.current < 0) return [];
  const lead = h.members[h.current].forms;
  const past = h.past();
  if (arm === "CTRL" || past.length === 0) return Array.from({ length: GROUPS }, () => lead);
  const g = Array.from({ length: GROUPS }, (_, j) => past[(h.rr + j) % past.length].forms);
  h.rr += GROUPS;
  return g;
}

/** `count` distinct slots out of `num`, from a generator keyed on (soup seed, epoch). */
export function plantSlots(num: number, count: number, seed: number, epoch: number): number[] {
  if (count > num) throw new Error("more slots than programs");
  const r = rng(fnv(`plant:${seed}:${epoch}`));
  const idx = new Map<number, number>(); // sparse Fisher-Yates
  const get = (i: number) => idx.get(i) ?? i;
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const j = k + Math.floor(r() * (num - k));
    const vk = get(k), vj = get(j);
    idx.set(k, vj); idx.set(j, vk);
    out.push(vj);
  }
  return out;
}

/** Writes the groups into `programs`: group g takes slots [g*P, (g+1)*P), its forms alternating. Returns the count written. */
export function plant(programs: Uint8Array, groups: string[][], P: number, seed: number, epoch: number): number {
  const num = programs.length / TAPE;
  const slots = plantSlots(num, groups.length * P, seed, epoch);
  groups.forEach((forms, g) => {
    const bytes = forms.map(unhex);
    for (let c = 0; c < P; c++) programs.set(bytes[c % bytes.length], slots[g * P + c] * TAPE);
  });
  return slots.length;
}
