// The small live worlds on /story/: which world each jar runs, the one thing a reader can change, and the words that
// say what the change does. No DOM here, so the settings can be tested against the worlds' own pages (apps/lab/test/story.test.ts).
// Each jar starts the same world its own page starts, built by that page's own option builders; nothing here sets a
// rule or a number of its own.
import { DEFAULT_OPTIONS, recordedSentence, type ViewerOptions } from "../dropgenes/viewer-core.ts";
import { dialDefaults as roamDialDefaults, dialOptions as roamDialOptions } from "../roam/dials.ts";
import type { RoamOptions } from "../roam/view.ts";
import { dialDefaults as softDialDefaults, dialOptions as softDialOptions } from "../softroam/dials.ts";
import type { SoftRoamOptions } from "../softroam/view.ts";

export type JarId = "dropgenes" | "roam" | "softroam";

export interface JarChoice {
  id: string;
  /** The button. */
  label: string;
  /** What this choice does, said before it is used. */
  says: string;
}

export interface JarSpec {
  id: JarId;
  /** What the choices are a choice of, for the group's accessible name. */
  choiceLabel: string;
  choices: readonly JarChoice[];
  /** Steps of the world per second of watching. */
  pace: number;
  /** Canvas pixels per side. */
  side: number;
  /** How sure we are of what this jar shows, in the journal's words. */
  standing: string;
}

/** Seeds the Roam and Soft Roam notes were written from. Anything else is a seed nobody here has looked at. */
export const SEEN_SEEDS = [1, 2] as const;
/** Seeds the Soft Roam notes looked at once (NOTE-2 to NOTE-4), kept out of the "not looked at" draw. */
const LOOKED_AT = [1, 2, 3, 4];

/** A seed from 5 to 9999 from a number in [0, 1): never one of the seeds the notes looked at. */
export function freshSeed(u: number): number {
  const lo = Math.max(...LOOKED_AT) + 1;
  return lo + Math.min(9999 - lo, Math.max(0, Math.floor(u * (10000 - lo))));
}

export const JARS: Record<JarId, JarSpec> = {
  dropgenes: {
    id: "dropgenes",
    choiceLabel: "The wall",
    choices: [
      { id: "gated", label: "Walls keep genes in", says: "A gene copy can only hop where there is wall, so copies mostly stay in a compartment or its thin rim, the parasite’s included. This is the setting of the recorded runs, on their first seed." },
      { id: "ungated", label: "Let the genes leak", says: "Copies hop across the open water between compartments, the parasite’s included, so a parasite that arises in one compartment can reach them all." },
    ],
    pace: 240,
    side: 64,
    standing: "Exploratory",
  },
  roam: {
    id: "roam",
    choiceLabel: "Kinds of cell",
    choices: [
      { id: "kinds", label: "Shells and mouths", says: "A body’s plan can make shells, which are cheap to keep and cannot be eaten until cracked, and red mouths, the only cells that feed on other bodies." },
      { id: "alike", label: "Every cell alike", says: "No shells and no mouths: bodies only graze, and a body at least twice another’s size takes matter where they touch." },
    ],
    pace: 60,
    side: 512,
    standing: "Seen on seeds 1 and 2, not confirmed",
  },
  softroam: {
    id: "softroam",
    choiceLabel: "The seed",
    choices: [
      { id: "seed-1", label: "Seed 1", says: "One of the two seeds every Soft Roam setting was tuned on. What the notes describe, they describe here." },
      { id: "seed-2", label: "Seed 2", says: "The other seed the settings were tuned on." },
      { id: "fresh", label: "A seed nobody has looked at", says: "A seed drawn now, which we have not run. If it looks different from seeds 1 and 2, that is the reason nothing here is called confirmed." },
    ],
    pace: 60,
    side: 768,
    standing: "Seen on seeds 1 and 2, not confirmed",
  },
};

const ARENA = 128;

/** The droplet-genes world for a choice: its own page's opening world, with its gate (walls keep gene copies in) or without. */
export function dropgenesOptions(choice: string): ViewerOptions {
  return { ...DEFAULT_OPTIONS, gated: choice !== "ungated" };
}

/** What the recorded runs found for that choice, in the droplet page's own words. */
export function dropgenesRecorded(choice: string): string {
  return recordedSentence(dropgenesOptions(choice));
}

/** Roam as its own page opens it (six grown founders, compost, the dials at their defaults), with kinds of cell on or off. */
export function roamOptions(choice: string): RoamOptions {
  return roamDialOptions({ seed: 1, size: ARENA, start: "grown-all", compost: true, kinds: choice !== "alike", toughness: false }, roamDialDefaults());
}

/** Soft Roam as its own page opens it (the big bodies start, every dial at its default), on a seed. */
export function softRoamOptions(seed: number): SoftRoamOptions {
  return softDialOptions({ seed, size: ARENA, start: "bodies", kinds: true, toughness: false }, softDialDefaults("bodies"));
}

/** The seed a Soft Roam choice means; `u` in [0, 1) is used only by the fresh draw. */
export function softRoamSeed(choice: string, u: number): number {
  if (choice === "seed-2") return 2;
  if (choice === "fresh") return freshSeed(u);
  return 1;
}

const n = (x: number) => Math.round(x).toLocaleString("en-GB");

/** One line under a running Roam or Soft Roam jar. */
export function roamLine(c: { step: number; cells: number; bodies: number; largest: number; mouths: number; shells: number; residual: number }, kinds: boolean): string {
  const parts = [`Step ${n(c.step)}`, `${n(c.cells)} cells in ${n(c.bodies)} bodies`, `largest ${n(c.largest)}`];
  if (kinds) parts.push(`${n(c.mouths)} mouths, ${n(c.shells)} shells`);
  parts.push(c.residual === 0 ? "matter balanced" : `matter off by ${n(c.residual)}`);
  return parts.join(" · ");
}

/** One line under a running droplet-genes jar. */
export function dropgenesLine(f: { step: number; compartments: number; complete: number; residual: string; ended: boolean }): string {
  const parts = [`Step ${n(f.step)}`, `${n(f.compartments)} compartments, ${n(f.complete)} with both genes`];
  parts.push(f.residual === "0" ? "matter balanced" : `matter off by ${f.residual}`);
  if (f.ended) parts.push("no wall is left, so nothing can change again");
  return parts.join(" · ");
}
