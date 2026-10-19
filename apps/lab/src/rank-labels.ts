// What the breeder ranks ponds by, in the measures' own names: the Breed by hand panel's ranking menu and the
// session card's account of the pressure a world put on its ponds read from the same words.
import { POND_SCORES, pondScoreTerms, type PondScore, type PondTerm, type WorldConfig } from "@bl/schema";

/** What a pond is ranked by while picking: a term, or the score the rule ranks the waiting cycle by ("score") when there is one. */
export type RankKey = PondTerm | "speed" | "score";
export const RANK_LABELS: Record<RankKey, string> = {
  score: "The rule’s score",
  speed: "Speed",
  drive: "Moving mass",
  seed: "Seed packet",
  body: "Body size",
  mass: "Bound mass",
  reach: "Reach to the edge",
};
/** The score the rule ranks a waiting cycle by (the dial's, else the world's own), in the measures' names: "drive+seed+body" reads as "The rule’s score: moving mass, seed packet, body size". */
export const scoreLabel = (score: string) => `The rule’s score: ${pondScoreTerms(score).map((k) => RANK_LABELS[k].toLowerCase()).join(", ")}`;

/** The measures a score is made of, in words ("Moving mass, seed packet, body size"), or null when `score` is not one. */
export function scoreWords(score: string | undefined): string | null {
  if (score === undefined) return null;
  try {
    return pondScoreTerms(score).map((k, i) => (i ? RANK_LABELS[k].toLowerCase() : RANK_LABELS[k])).join(", ");
  } catch {
    return null;
  }
}

/**
 * The pressure the world's rule puts on its ponds, in words, or null when it has no pond cycle. A world with no
 * score of its own picks the ponds with the most bound mass (arm scaf) or any ponds at random (arm rand).
 */
export function pressureWords(cfg: Pick<WorldConfig, "pondPeriod" | "pondArm" | "pondScore">): string | null {
  if (cfg.pondPeriod === undefined) return null;
  const score = scoreWords(cfg.pondScore);
  if (cfg.pondArm === "cont") return "None: this world only measures its ponds and never reseeds them";
  if (cfg.pondArm === "rand") return score ? `Donors chosen at random (the world also records ${score.toLowerCase()})` : "Donors chosen at random";
  return score ?? "Bound mass";
}

/** A score in the dial's words: one measure is its name, several are "…, together" (the rule ranks ponds by their worst rank across them). */
export function dialWords(score: PondScore): string {
  const words = scoreWords(score) ?? score;
  return pondScoreTerms(score).length > 1 ? `${words} together` : words;
}

const COUNT_WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven"];
/** "a", "a and b", "a, b and c". */
const listed = (words: readonly string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/**
 * What a score makes the rule do, in one line under the dial and on its option: one measure ranks the ponds by itself;
 * several rank them by each and take each pond's worst rank (`worstRanks`), so a pond must do well on every one to donate.
 */
export function pressureDescribes(score: PondScore): string {
  const terms = pondScoreTerms(score).map((k) => RANK_LABELS[k].toLowerCase());
  if (terms.length === 1) return `Ranks ponds by ${terms[0]}: the best-ranked ponds become the donors.`;
  return `Ranks ponds by ${listed(terms)}, and takes each pond’s worst rank of the ${COUNT_WORDS[terms.length] ?? terms.length}: a pond must do well on all of them to donate.`;
}

/**
 * The options of the pressure dial (docs/pond-keeper-v1-2026-10-17.md, section 1): the world's own score first, as planted, then
 * every other score the lab names, each said in the measures' words. `current` joins the list when a replayed history set a
 * score the lab has no name for, so the dial can always show what governs.
 */
export function pressureOptions(cfg: Pick<WorldConfig, "pondScore">, current?: PondScore | null): { value: PondScore; label: string }[] {
  const planted = cfg.pondScore ?? null;
  const out: { value: PondScore; label: string }[] = [];
  if (planted !== null) out.push({ value: planted, label: `As planted: ${dialWords(planted)}` });
  for (const score of POND_SCORES) if (score !== planted) out.push({ value: score, label: dialWords(score) });
  if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: dialWords(current) });
  return out;
}

/** What governs the next cycle, in words: "As planted: …" until the dial is moved, the score's words after. */
export function pressureNow(m: { base: PondScore | null; current: PondScore | null }): string {
  if (m.current === null) return "No score of its own: the rule picks the ponds with the most bound mass";
  return m.current === m.base ? `As planted: ${dialWords(m.current)}` : dialWords(m.current);
}
