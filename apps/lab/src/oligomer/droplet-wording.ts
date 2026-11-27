/**
 * The page's wording for the per-world notes. droplet-worlds.ts is frozen (its hash is in
 * experiments/confirm/FROZEN.json), and its notes call the counted objects "droplets". The compartment check
 * (docs/b2-compartment-check-2026-11-21/RESULT.md) found they are patches of wall on moving waves, so the page
 * shows the frozen text with the nouns changed here. Figures are never touched. Every expected phrase must be
 * found, and no "droplet" may be left, or this throws: a later edit to the frozen text cannot bring the old
 * wording back unnoticed.
 */

import { armById, describeDropletArm } from './droplet-worlds.ts';

/** Frozen opening sentence of the three six-pattern worlds, and the page's sentence for it. */
export const SEED_SENTENCE_FROZEN = 'Droplets start in six wall patterns (the names and colours on this page are display labels only).';
export const SEED_SENTENCE_PAGE = 'The dish is seeded with patches of six wall patterns (the names and colours on this page are display labels only).';

/** Each frozen note quotes two late counts: the doc runs and the re-run. */
const LATE_COUNT = /\bheld (\d+ to \d+) droplets late\b/g;
export const LATE_COUNTS_PER_NOTE = 2;

/** Added at the end of the PHAGE note only; the figure is the check's PHAGE figure. */
export const CHECK_SENTENCE = 'The patches are crests of moving waves of wall, not closed bodies: in our check (seeds 13 to 16) 2 to 3 in 100 were still there 1,000 steps later.';

const count = (text: string, phrase: string): number => text.split(phrase).length - 1;

/** The page's wording of the text describeDropletArm returns for this world. Throws if the text is not as expected. */
export function rewordDropletNote(armId: string, frozen: string): string {
  const arm = armById(armId);
  const fail = (why: string): never => { throw new Error(`droplet-wording: the note for ${armId} ${why}; update droplet-wording.ts to match the frozen text`); };
  let text = frozen;

  const seeds = count(text, SEED_SENTENCE_FROZEN);
  if (seeds !== (arm.single ? 0 : 1)) fail(`has the opening sentence ${seeds} times, expected ${arm.single ? 0 : 1}`);
  text = text.replace(SEED_SENTENCE_FROZEN, SEED_SENTENCE_PAGE);

  const late = [...text.matchAll(LATE_COUNT)].length;
  if (late !== LATE_COUNTS_PER_NOTE) fail(`has ${late} "held N to M droplets late" phrases, expected ${LATE_COUNTS_PER_NOTE}`);
  text = text.replace(LATE_COUNT, 'held $1 wall patches late');

  if (/droplet/i.test(text)) fail('still says "droplet" after rewording');

  return arm.name === 'PHAGE' ? `${text} ${CHECK_SENTENCE}` : text;
}

/** The note the page shows under the world select. */
export function dropletPageNote(armId: string): string {
  return rewordDropletNote(armId, describeDropletArm(armId));
}
