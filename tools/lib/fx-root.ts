// Founder-set / cloud origination counts against each candidate's own clade root (plan 002).
// Pure functions; I/O stays in tools/founders-x.ts.

/** Fixed subject ids: the 12 B clouds, then the C sets. Index = numeric subject for originationCandidates. */
export const SUBJECT_IDS = [...Array.from({ length: 12 }, (_, k) => `founder-${k}`), "S1", "S2", "S4", "S5"] as const;
export const subjectIndex = (id: string) => {
  const i = (SUBJECT_IDS as readonly string[]).indexOf(id);
  if (i < 0) throw new Error(`unknown subject id ${id}`);
  return i;
};
/** Runs each subject must have: 5 mutation + 3 no-mutation, each finished at 1e6 steps. */
export const RUNS_PER_SUBJECT = { mutation: 5, noMutation: 3 } as const;

/**
 * A candidate's clade root, checked before it is gardened beside the candidate; returns the root's genome hex. The parent
 * walk must end at a founder lineage (key hi = birth step + 1 = 0): any other endpoint means mutations.tsv lacks a birth
 * record on the path. The root's genome must differ from the candidate's, or the garden compares a genome with itself.
 */
export function checkedRootHex(c: { descendant: string; hex: string }, rootKey: string, rootHex: string | undefined, where: string): string {
  if (!/^0:\d+$/.test(rootKey)) throw new Error(`${where}: clade root ${rootKey} of candidate descendant ${c.descendant} is not a founder lineage (mutations.tsv lacks a birth record on the path)`);
  if (!rootHex) throw new Error(`${where}: root genome missing for lineage ${rootKey} (candidate descendant ${c.descendant})`);
  if (rootHex === c.hex) throw new Error(`${where}: candidate descendant ${c.descendant} has the genome of its clade root ${rootKey}; the garden would compare it with itself`);
  return rootHex;
}

/** A planting is whole when it has `reps` distinct tiles and every tile holds `slots` lineage slots. */
export function wholePlanting(p: { tiles: { tile: number; lineages: unknown[] }[] } | undefined, slots: number, reps = 16): boolean {
  return !!p && new Set(p.tiles.map((t) => t.tile)).size === reps && p.tiles.every((t) => t.lineages.length === slots);
}

/** Per subject: distinct mutation-run seeds with at least one originating candidate; counts when >= 3. */
export function countSubjects(rows: { subjectId: string; seed: number; originates: boolean }[]) {
  return SUBJECT_IDS.map((id) => {
    const seeds = new Set(rows.filter((r) => r.subjectId === id && r.originates).map((r) => r.seed));
    return { id, runsOriginating: seeds.size, counts: seeds.size >= 3 };
  });
}
