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
