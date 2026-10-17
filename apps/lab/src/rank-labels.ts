// What the breeder ranks ponds by, in the measures' own names: the Breed by hand panel's ranking menu and the
// session card's account of the pressure a world put on its ponds read from the same words.
import { pondScoreTerms, type PondTerm, type WorldConfig } from "@bl/schema";

/** What a pond is ranked by while picking: a term, or the world's own score ("score") when it has one. */
export type RankKey = PondTerm | "speed" | "score";
export const RANK_LABELS: Record<RankKey, string> = {
  score: "This world’s score",
  speed: "Speed",
  drive: "Moving mass",
  seed: "Seed packet",
  body: "Body size",
  mass: "Bound mass",
  reach: "Reach to the edge",
};
/** The world's own score, in the measures' names: "drive+seed+body" reads as "Moving mass, seed packet, body size". */
export const scoreLabel = (score: string) => `This world’s score: ${pondScoreTerms(score).map((k, i) => (i ? RANK_LABELS[k].toLowerCase() : RANK_LABELS[k])).join(", ")}`;

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
