/**
 * The world catalogue: what each starting world is, in plain words, for the people choosing one.
 *
 * Two kinds of fact live here. Traits are computed from a preset's own config and init, so what the catalogue says
 * a world does (its light, its size, who is planted, which rules differ) is true by construction and cannot drift
 * from `packages/schema/src/presets.ts`. Notes are written by hand: the question a world asks, what to look for,
 * and what has been seen so far, each dated and in the voice of the journal (seen, measured and hoped-for kept
 * apart). `apps/lab/test/worlds.test.ts` holds the two in step: every preset has a note and sits in exactly one
 * family, and no trait leaks a config key or a file path.
 */
import { M3_FOUNDERS, PRESETS, defaultConfig, pondScoreTerms, presetConfig, type PondTerm, type Preset } from "@bl/schema";

/** The properties a world can differ in: the levers the sandboxes move. */
export type Lever = "light" | "season" | "size" | "founders" | "medium" | "cycle" | "migration" | "rules" | "wounds" | "mutation" | "signal";

export const LEVER_NAMES: Record<Lever, string> = {
  light: "Light",
  season: "Season",
  size: "Size",
  founders: "Who is planted",
  medium: "The water",
  cycle: "Pond cycle",
  migration: "Migration",
  rules: "Rule change",
  wounds: "Wounds",
  mutation: "Mutation",
  signal: "Signal",
};

export interface Trait {
  lever: Lever;
  /** A short plain phrase, the chip. */
  label: string;
  /** The numbers behind it, for the small print. */
  detail?: string;
}

const n = (v: number) => v.toLocaleString("en-US");
const cellsInDisc = (r: number) => {
  let disc = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) disc++;
  return disc;
};
const POND_TERM_NAMES: Record<PondTerm, string> = { mass: "mass", drive: "movement", reach: "reach to the pond's edge", seed: "the seed packet's mass", body: "body size" };
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** What `p` is, read off its config and its founding: the light, the size, who is planted, and every rule that differs from the base rules. */
export function worldTraits(p: Preset): Trait[] {
  const cfg = presetConfig(p, 0);
  const base = defaultConfig();
  const traits: Trait[] = [];
  const lo = cfg.lightBase, hi = Math.min(255, cfg.lightBase + cfg.lightAmp);
  switch (cfg.lightMode) {
    case "uniform":
      traits.push({ lever: "light", label: "Even light everywhere", detail: `${hi} of 255` });
      break;
    case "gradient":
      traits.push({ lever: "light", label: "Brighter toward the bottom", detail: `${lo} of 255 at the top, ${hi} at the bottom` });
      break;
    case "patches":
      traits.push({ lever: "light", label: "A checkerboard of light", detail: `32-cell squares, ${hi} of 255 in the bright ones and ${lo} in the dark` });
      break;
    case "sweep": {
      const day = cfg.dayPeriod ?? 0, wander = cfg.wanderPeriod ?? 0, amp = cfg.wanderAmp ?? 0;
      const tent = `${hi} of 255 under the sun, ${lo} on the far side`;
      // The label carries what tells two suns apart, so a difference line can name it.
      if (day > 0 && wander > 0) traits.push({ lever: "light", label: `A sun that turns every ${n(day)} steps and wanders`, detail: `drifting ${n(amp)} cells each way over ${n(wander)} steps on top of its lap; ${tent}` });
      else if (day > 0) traits.push({ lever: "light", label: `A moving sun, one lap every ${n(day)} steps`, detail: tent });
      else traits.push({ lever: "light", label: `A sun that wanders east, then west, turning back every ${n(wander / 2)} steps`, detail: `${n(amp)} cells each way at a steady pace; ${tent}` });
      break;
    }
  }
  if (cfg.seasonPeriod > 0) traits.push({ lever: "season", label: `A season every ${n(cfg.seasonPeriod)} steps`, detail: `light rises by up to ${cfg.seasonAmp} at the height of each season` });

  const tiles = cfg.tilesX * cfg.tilesY;
  if (tiles === 1) traits.push({ lever: "size", label: `${cfg.tileW} × ${cfg.tileH} cells` });
  else if (cfg.pondPeriod) traits.push({ lever: "size", label: `${tiles} ponds of ${cfg.tileW} × ${cfg.tileH}`, detail: `${cfg.tilesX} × ${cfg.tilesY} ponds; nothing crosses between them except by the cycle` });
  else traits.push({ lever: "size", label: `${tiles} islands of ${cfg.tileW} × ${cfg.tileH}`, detail: `${cfg.tilesX} × ${cfg.tilesY} islands, each its own wrapped world` });

  const f = p.init.founders;
  switch (p.init.kind) {
    case "generalist": traits.push({ lever: "founders", label: `${f} hand-built founders`, detail: "the same generalist genome in each, placed at random" }); break;
    case "m3":
      traits.push(f === M3_FOUNDERS.length
        ? { lever: "founders", label: `The ${f} searched founders`, detail: "genomes found by search, each regrowing after a wound and dying without light" }
        : { lever: "founders", label: `${f} discs of the ${M3_FOUNDERS.length} searched founders`, detail: `the ${M3_FOUNDERS.length} searched genomes planted in turn, ${f / M3_FOUNDERS.length} discs each` });
      break;
    case "soup": traits.push({ lever: "founders", label: `${f} random founders`, detail: "random controllers; most die" }); break;
    case "followers": traits.push({ lever: "founders", label: `${f / 2} sleepers and ${f / 2} sun-followers`, detail: "the followers are built to drift east at the sun's speed; the sleepers go dormant at night" }); break;
    case "sensing": traits.push({ lever: "founders", label: `${f / 2} sleepers and ${f / 2} sensing followers`, detail: "the followers signal in the dark and move away from signal, so their own dark side pushes them toward the light" }); break;
    case "motile": traits.push({ lever: "founders", label: `${f} founders that can move but have no heading`, detail: "random motility, no direction: any heading has to be a mutation" }); break;
    case "motile-drift": traits.push({ lever: "founders", label: `${f} drifters with random headings`, detail: "random motility and a random constant direction each" }); break;
    case "three-way": traits.push({ lever: "founders", label: `${f / 3} each of sleepers, blind drifters and sensing followers` }); break;
    case "ponds":
      traits.push(p.init.start === "clone"
        ? { lever: "founders", label: "One disc of the same searched founder in every pond", detail: `founder ${p.init.founder} of the 12, a disc of radius 10` }
        : { lever: "founders", label: "The 12 searched founders, one per pond in turn", detail: "a disc of radius 10 in each pond" });
      break;
  }
  if (p.init.waste) traits.push({ lever: "medium", label: "Waste already in the water", detail: `${p.init.waste} waste and ${p.init.nutrient} nutrient per cell, instead of nutrient alone` });

  if (cfg.pondPeriod) {
    const arm = cfg.pondArm;
    const packet = `an ${cfg.pondK} × ${cfg.pondK} packet from a donor seeds each pond`;
    const detail =
      arm === "scaf" ? `donors are the heaviest quarter of the ponds; ${packet}`
      : arm === "rand" ? `donors are drawn at random; ${packet}`
      : arm === "cont" ? "nothing is cleared; the ponds are only measured at each boundary"
      : arm === "breed" ? `donors are the ponds that rank best on ${list(pondScoreTerms(cfg.pondScore).map((t) => POND_TERM_NAMES[t]))} together; ${packet}`
      : "ponds die at random and are reseeded in proportion to what each exports";
    traits.push({ lever: "cycle", label: `Ponds cleared and reseeded every ${n(cfg.pondPeriod)} steps`, detail });
  }
  if (cfg.migrationPeriod) traits.push({ lever: "migration", label: `Islands trade ${cfg.migrantCount} cells every ${n(cfg.migrationPeriod)} steps` });

  if (cfg.takeover === "lossy") {
    const kin = cfg.takeoverKin ?? "lineage", tol = cfg.takeoverTol ?? 0;
    const [by, unless] =
      kin === "lineage" ? ["by lineage", "unless the two share a lineage"]
      : kin === "growth" ? ["by growth settings", `unless their growth centre is within ${tol} and its width within ${tol >> 2}`]
      : [`by genome, within ${tol} word${tol === 1 ? "" : "s"}`, `unless their genomes differ in at most ${tol} of 42 words`];
    traits.push({ lever: "rules", label: `Taking a stranger's matter is lossy unless kin ${by}`, detail: `what the lottery winner takes turns to waste, ${unless}; the energy stays with the winner` });
  }
  if (cfg.shapeReach) {
    traits.push(cfg.shapeReach > cfg.kernelRadius
      ? { lever: "rules", label: `Body shape is heritable out to radius ${cfg.shapeReach}`, detail: `a genome weights the two rings of the usual radius-${cfg.kernelRadius} kernel and a far ring beyond it` }
      : { lever: "rules", label: "Body shape is heritable within the usual kernel", detail: `a genome weights the two rings of the radius-${cfg.shapeReach} kernel` });
  }
  if (cfg.cellPeriod) traits.push({ lever: "rules", label: "Declared cells", detail: `every ${n(cfg.cellPeriod)} steps each body gets its own id, and a genome changes only at a cell's birth` });
  if (cfg.injuryPeriod && cfg.injuryRadius !== undefined && cfg.injuryProb) {
    // The preset stored a rounded probability, so the rate it was built from comes back to three figures ("about").
    const every = Number(((2 ** 32 * cfg.injuryPeriod) / (cellsInDisc(cfg.injuryRadius) * cfg.injuryProb)).toPrecision(3));
    traits.push({ lever: "wounds", label: `Recurring wounds, each cell hit about once per ${n(every)} steps`, detail: `discs of radius ${cfg.injuryRadius}, landing every ${cfg.injuryPeriod} steps` });
  }
  if (cfg.mutRate === 0 && !cfg.cellPeriod) traits.push({ lever: "mutation", label: "No mutation" });
  else if (cfg.mutRate > 0 && cfg.mutRate !== base.mutRate) {
    const ratio = Math.round((cfg.mutRate / base.mutRate) * 10) / 10;
    traits.push({ lever: "mutation", label: `Mutation ×${ratio}`, detail: "compared with the base rules" });
  }
  if (cfg.signalGain) traits.push({ lever: "signal", label: "A readable signal", detail: `signal gain ${cfg.signalGain}${cfg.kSDecay < base.kSDecay ? ", and signal lasts far longer" : ""}` });
  return traits;
}

const key = (t: Trait) => `${t.lever}|${t.label}|${t.detail ?? ""}`;

export interface WorldDiff {
  /** Traits of the world that the base has no counterpart to. */
  added: Trait[];
  /** Traits whose label the base shares but whose numbers differ (a dimmer gradient, say). */
  changed: { trait: Trait; from: Trait }[];
  /** Traits of the base on a lever the world has nothing on. */
  removed: Trait[];
}

/** How `world` differs from `base`, trait by trait, computed from the two configs. */
export function worldDiff(world: Preset, base: Preset): WorldDiff {
  const a = worldTraits(world), b = worldTraits(base);
  const bKeys = new Set(b.map(key));
  const aLevers = new Set(a.map((t) => t.lever));
  const added: Trait[] = [], changed: WorldDiff["changed"] = [];
  for (const t of a) {
    if (bKeys.has(key(t))) continue;
    const from = b.find((x) => x.lever === t.lever && x.label === t.label);
    if (from) changed.push({ trait: t, from });
    else added.push(t);
  }
  return { added, changed, removed: b.filter((t) => !aLevers.has(t.lever)) };
}

/** The first worlds, the pinned prefix of the preset list: the base the sandboxes vary. */
export const FIRST_WORLDS = new Set(["spots", "gradient", "spots-m3", "gradient-m3", "gradient-m3-waste", "soup", "seasons", "large", "archipelago", "ponds", "ponds-small"]);
/** The worlds that ran in a registered test (decisions written down before the data): the M4 ensemble and the pond registration. */
export const REGISTERED = new Set(["spots-m3", "gradient-m3", "ponds"]);

export type WorldStatus = "registered" | "base" | "sandbox";
export const worldStatus = (id: string): WorldStatus => (REGISTERED.has(id) ? "registered" : FIRST_WORLDS.has(id) ? "base" : "sandbox");
export const STATUS_LABELS: Record<WorldStatus, [label: string, meaning: string]> = {
  registered: ["Registered", "Ran in an experiment whose decisions were written down before its data"],
  base: ["Base world", "One of the first worlds, the base the sandboxes vary; not used in a registered test"],
  sandbox: ["Sandbox", "Exploratory, not registered: nothing seen here counts toward a milestone"],
};

export type SeenState = "confirmed" | "measured" | "observed" | "negative" | "unclear" | "pending";

export const SEEN_LABELS: Record<SeenState, string> = {
  confirmed: "Confirmed",
  measured: "Measured",
  observed: "Seen",
  negative: "Negative",
  unclear: "Unclear",
  pending: "Not yet measured",
};

/** The journal's chip colours: green only for a confirmed or replicated result, sun for a measurement, red for a negative, grey otherwise (a thing merely seen included). */
export const SEEN_TONE: Record<SeenState, "observed" | "measured" | "negative" | "pending"> = {
  confirmed: "observed",
  measured: "measured",
  observed: "pending",
  negative: "negative",
  unclear: "pending",
  pending: "pending",
};

export interface WorldNote {
  /** The question this world was built to ask, one sentence. */
  asks: string;
  /** What to watch for in the lab, and which view shows it. */
  look: string;
  /** What has been seen so far, honestly, with its date; `pending` when nothing has been looked at. */
  seen: { state: SeenState; text: string };
  /** The world this one is a variant of; the catalogue says what differs, computed from the configs. */
  base?: string;
}

export interface Family {
  id: string;
  name: string;
  /** The property this family plays with, as a phrase after "Plays with". */
  lever: string;
  /** Why we think this property might matter for whether evolution gets going. */
  why: string;
  /** Where the family stands, in one or two sentences. */
  seen: string;
  ids: string[];
}

export const FAMILIES: Family[] = [
  {
    id: "steady",
    name: "Steady jars",
    lever: "how the light falls, and who is planted",
    why: "The first worlds. Every jar shares one chemistry; what changes here is where the light falls and who is planted at step 0. Light is the only thing that enters a jar, so where it lands decides where living is cheap and where it is dear. These are the worlds the registered experiments were built on.",
    seen: "The two planted with the searched founders ran the registered 10⁶-step test for open-ended evolution (170 runs). Lineages diversified and recycling held, but the test was not met: runs where mutations change nothing also read as growing.",
    ids: ["spots", "gradient", "seasons", "large", "soup", "spots-m3", "gradient-m3", "gradient-m3-waste"],
  },
  {
    id: "ponds",
    name: "Islands and ponds",
    lever: "many small worlds in one jar",
    why: "Split the jar into tiles. Islands trade a few cells now and then. Ponds are cleared on a schedule and reseeded from the ponds that did best: a life cycle for groups, borrowed from experiments on microbes. Selection then acts on whole ponds, not only on cells.",
    seen: "The pond cycle gave the one confirmed result so far (3 Oct): worlds evolved under it founded new ponds more often than three controls. The cycle is imposed, not discovered; the evolved genome alone had a small measured effect, and how much of the worlds' advantage it carries was not measured.",
    ids: ["ponds", "ponds-small", "archipelago"],
  },
  {
    id: "sun",
    name: "A moving sun",
    lever: "light that moves",
    why: "Under a steady light, staying put is free. A sun that crosses the sky makes every place good and then bad, so moving and sensing might start to pay. These worlds ask whether anything learns to follow the light, with hand-built movers as the yardstick: if they win, the environment rewards moving; it does not mean moving evolved.",
    seen: "One seed each, so leads. Hand-built sensing followers survived a wandering sun where blind drifters failed. The searched founders die under a fast sun and do better the slower it turns.",
    ids: ["planet", "planet-m3", "planet-followers", "planet-sensing", "planet-wander", "planet-motile", "planet-drifters", "planet-still", "planet-large"],
  },
  {
    id: "owning",
    name: "Who owns the matter",
    lever: "the cost of taking",
    why: "In the base rules, when matter from two lineages meets, a lottery picks a winner that takes it all for free. Evolution has used that to erode bodies rather than build them: evolved lineages regrow after a wound far less often than the founders did (0.17 against 0.98). These worlds make taking a stranger's matter lossy, or add recurring wounds, and ask whether a body starts to pay off.",
    seen: "Four screens of these arms (2 to 3 Oct), three seeds per arm, each read against a bar fixed in advance. No arm met it; each reads unclear or dead end.",
    ids: ["own-lossy", "own-match", "own-genome-1", "own-genome-3", "own-genome-8", "own-seasons", "own-injury-light", "own-injury-heavy", "own-injury-coarse"],
  },
  {
    id: "cells",
    name: "Shape and cells",
    lever: "what is inherited, and what counts as a cell",
    why: "Every base world shares one round growth kernel, and a genome can tune only two numbers of the growth function on top of it, so shape is barely heritable: evolution has mostly been changing metabolism. These worlds let the kernel's shape be inherited, or declare a cell outright (a body with its own id, mutating only at birth) and ask what evolves one level up.",
    seen: "Four screens (3 to 4 Oct): three seeds per arm, then five fresh seeds for the wall arm with and without wounds. No arm met its pre-stated bar. Longer, more elaborate bodies (worms and labyrinths) appeared in a few runs, and in the control worlds too, so no difference in shape was established.",
    ids: ["own-shape", "own-shape-far", "own-cell", "own-cell-wall", "own-cell-injury", "own-cell-wall-injury"],
  },
  {
    id: "wild",
    name: "Storms and the breeder",
    lever: "every lever at once, and selection by hand",
    why: "The storm stacks everything the sandboxes built: a wandering sun, seasons, a readable signal, recurring wounds and heritable shape. The breeder turns the pond cycle into a selection loop for a trait we name, or for whatever you choose at each cycle. Both chase interesting life, not a registered claim.",
    seen: "The full storm was extinct by step 29,000 in its one seed; the sun's speed is what kills. On the 64-pond world (4 Oct, one seed each), breeding for movement alone bred real movement and emptied most ponds; adding the seed packet's mass to the score kept them occupied at about half the pace, and body size too at about a third.",
    ids: ["breeder", "wild-storm", "wild-storm-w01", "wild-storm-w10", "wild-storm-meteor", "wild-storm-m10", "wild-storm-3way", "wild-storm-large"],
  },
];

/** Where to begin, and why each. */
export const START_HERE: { id: string; why: string }[] = [
  { id: "spots", why: "The simplest jar. Watch biomass condense into spots that grow, split and drift." },
  { id: "seasons", why: "A checkerboard of light with a season every 4,000 steps. Press 8 for the Light view and watch the season turn." },
  { id: "planet-followers", why: "A race you can watch: sun-followers against sleepers under a moving sun. The Lineages view shows who holds the field after a few days." },
  { id: "planet-wander", why: "Sleepers, blind drifters and sensing followers under a sun that turns back. The sensors are the ones that survived in our one look." },
  { id: "breeder", why: "Breed by hand: sixteen ponds, a cycle every 5,000 steps, and you choose the donors." },
];

export const WORLD_NOTES: Record<string, WorldNote> = {
  spots: {
    asks: "What does the chemistry do when left alone under even light?",
    look: "Biomass condenses into spots that grow, split and drift. The Lineages view shows which founders' descendants end up holding the field.",
    seen: { state: "measured", text: "The base world of the registered ensemble, run there with the searched founders rather than these hand-built ones." },
  },
  gradient: {
    asks: "Does a jar with a bright end and a dim end grow different lineages in different places?",
    look: "The bottom is bright and the top is dim. Watch whether the two ends settle on different lineage colours, and who moves between them.",
    seen: { state: "pending", text: "Not run as an experiment with these founders; its searched-founder twin was." },
    base: "spots",
  },
  seasons: {
    asks: "Does light that comes and goes keep a world from settling down?",
    look: "Press 8 for the Light view and watch the season turn. Lineages that boom in the bright season have to last through the dim one.",
    seen: { state: "pending", text: "Not yet run as an experiment. A seasonal control on the searched founders read unclear in the ownership screens." },
    base: "spots",
  },
  large: {
    asks: "Does a bigger jar give evolution more room over a long run?",
    look: "Four times the cells of the 256 world, and slower on most GPUs. Fit view shows the whole map; the Lineages view at that scale is a map of territories.",
    seen: { state: "pending", text: "Not yet run as an experiment." },
    base: "spots",
  },
  soup: {
    asks: "Can anything get going from random controllers, with no hand-built founder at all?",
    look: "Most founders die within the first few thousand steps. Watch which survive, and whether the survivors come to look alike.",
    seen: { state: "pending", text: "Not measured in any experiment. The picture on the home page was captured in this world." },
    base: "spots",
  },
  "spots-m3": {
    asks: "What do the searched founders do under even light over a long run?",
    look: "Twelve genomes, each found by search. In the Lineages view some colours spread and others shrink to nothing within the first ten thousand steps.",
    seen: { state: "negative", text: "One of the two worlds of the registered 10⁶-step ensemble (28 Sep). New adaptive activity beat the no-mutation control here but missed the bar against the neutral one, and the second test failed: runs where mutations change nothing also read as growing. Not open-ended by the registered definition." },
    base: "spots",
  },
  "gradient-m3": {
    asks: "The searched founders with a bright end and a dim end; the base every sandbox below compares itself against.",
    look: "Watch whether lineages sort by brightness. This is the control world for the ownership, cells and storm screens, so it is worth knowing by eye.",
    seen: { state: "negative", text: "The main world of the registered 10⁶-step ensemble (28 Sep). New adaptive activity beat both controls here, but the second test failed: runs where mutations change nothing also read as growing. Evolved lineages also lost the founders' ability to regrow after a wound (0.17 against 0.98)." },
    base: "gradient",
  },
  "gradient-m3-waste": {
    asks: "Does starting with waste already dissolved in the water, and less food, open a niche for something that eats waste?",
    look: "Press 4 for the Waste view. Does the brown get eaten anywhere, or does it just sit?",
    seen: { state: "measured", text: "One recipe of the founders-and-environments screen (30 Sep). Whether new ways of living keep arriving once the niches fill read mixed across the screen." },
    base: "gradient-m3",
  },
  archipelago: {
    asks: "Do four small worlds that trade a few migrants evolve differently from one big one?",
    look: "Four 64 × 64 islands under a gradient. Every 200 steps each island sends four cells to a neighbour. Watch a lineage colour hop islands.",
    seen: { state: "pending", text: "Built for a planned gate on migration; not yet run as an experiment. Islands that trade cells are not independent histories, so they never count toward the registered ensembles." },
    base: "gradient",
  },
  ponds: {
    asks: "If ponds are cleared every 10,000 steps and reseeded from the heaviest ones, do their descendants get better at founding ponds?",
    look: "Sixty-four ponds. At each cycle the whole field resets, and dashed lines on the charts mark the cycles. Turn on Breed by hand to choose the donors yourself.",
    seen: { state: "confirmed", text: "The registered pond test (3 Oct, 24 histories per arm) confirmed both primary hypotheses: worlds evolved under the cycle founded new ponds from fragments more often than random-donor worlds, uncycled worlds and the ancestor, and the evolved genome alone founded more ponds than the ancestor's in 24 of 24. That measured effect was small (a median of 19 more successes in 512), and the comparison does not measure how much of the worlds' advantage the genome carries. The life cycle is imposed rather than discovered, and by a decision made beforehand this counts toward no milestone." },
  },
  "ponds-small": {
    asks: "The pond cycle at a size that fits a laptop: four ponds, a cycle every 1,000 steps.",
    look: "A cycle comes round every few seconds at speed, so this is the quickest way to see clearing and reseeding happen. Breed by hand works here too.",
    seen: { state: "pending", text: "Built for tests and the lab, not for an experiment." },
    base: "ponds",
  },
  planet: {
    asks: "What happens to hand-built generalists when the sun moves?",
    look: "Press 8 for the Light view, then Play: the bright meridian crosses from left to right. Does anything keep up, or does life go dormant at night and wait?",
    seen: { state: "measured", text: "In a ladder of sun speeds on the searched founders (4 Oct), the fastest sun was lethal and each slower one left more living cells. One seed each." },
    base: "gradient",
  },
  "planet-m3": {
    asks: "Do the searched founders survive a day and a night?",
    look: "The same moving sun as the planet, with the twelve searched genomes. Compare the living mass chart against the planet's.",
    seen: { state: "measured", text: "In the sun-speed ladder (4 Oct) this speed, one lap in about 16,000 steps, was lethal to these founders at seed 1. A lap in 32,768 steps left 6,170 living cells; slower suns left more." },
    base: "gradient-m3",
  },
  "planet-followers": {
    asks: "Does moving with the sun beat sleeping through the night?",
    look: "Eight sleepers against eight followers built to drift east at exactly the sun's speed. Press 2 for the Lineages view and see who holds the field after a few days.",
    seen: { state: "observed", text: "A yardstick world: the followers are built by hand, so their winning shows the environment rewards moving, not that moving evolved. Hand-built movers survived the fastest sun in the ladder (4 Oct), one seed." },
    base: "planet",
  },
  "planet-sensing": {
    asks: "Can a cell that signals in the dark and runs from signal find the light when the sun outpaces any fixed drift?",
    look: "Press 6 for the Signal view: the followers call out when they are in the dark. The sun does a lap in 11,000 steps, half again as fast as a drifter can match.",
    seen: { state: "pending", text: "Built as the sensing yardstick for the wandering-sun world below; not looked at on its own." },
    base: "planet",
  },
  "planet-wander": {
    asks: "Sleepers, blind drifters and sensing followers under a sun that wanders east, then west: who survives?",
    look: "Six of each. The sun turns back every 32,768 steps, so a fixed heading is wrong half the time. The Lineages view shows the three kinds in different colours.",
    seen: { state: "observed", text: "In one small comparison (4 Oct) the sensing followers survived where the blind drifters failed. A lead about environment and sensing, not an evolved capability." },
    base: "planet",
  },
  "planet-motile": {
    asks: "Can a heading evolve? These founders can move but have no direction.",
    look: "Random motility, no heading. Any consistent direction has to come from a mutation. Compare with the drifters and with the still control.",
    seen: { state: "pending", text: "Not yet looked at." },
    base: "planet",
  },
  "planet-drifters": {
    asks: "Does a random fixed heading help or hurt when the sun moves?",
    look: "Sixteen drifters, each with its own random direction. Some head east with the sun by chance; watch whether those are the ones that last.",
    seen: { state: "pending", text: "Not yet looked at." },
    base: "planet",
  },
  "planet-still": {
    asks: "The control for the two above: the same placements, no movement at all.",
    look: "Everything here goes dormant at night. Any difference from the motile worlds is down to moving.",
    seen: { state: "pending", text: "Not yet looked at." },
    base: "planet",
  },
  "planet-large": {
    asks: "The moving sun on the big world.",
    look: "The same sun speed as the 256 planet, so a lap over twice the width takes twice as long, and a slightly narrower light range. Slower on most GPUs.",
    seen: { state: "pending", text: "Not yet looked at." },
    base: "large",
  },
  "own-lossy": {
    asks: "If taking a stranger's matter turns it to waste, do bodies stop being eroded?",
    look: "Press 4 for the Waste view: every takeover between lineages leaves brown behind. Watch whether lineages keep to themselves.",
    seen: { state: "negative", text: "Dead end (3 Oct). Regeneration stayed high, but only because evolution stalled: in two seeds of three one founder held every occupied cell and no mutant lineage got going." },
    base: "gradient-m3",
  },
  "own-match": {
    asks: "The same lossy rule, but kin means similar growth settings, so most single mutants stay kin.",
    look: "Mutants no longer pay to take from their parent. Does evolution keep running while bodies still cost something to take?",
    seen: { state: "unclear", text: "Unclear (3 Oct): one seed of three regenerated well above the control, two did not." },
    base: "own-lossy",
  },
  "own-genome-1": {
    asks: "Lossy taking where kin means a genome within one word of the winner's.",
    look: "The strictest genome kin: any genome within one word of the winner's counts, which keeps a single mutant kin to its parent.",
    seen: { state: "unclear", text: "Unclear (3 Oct): no seed reached the bar; nothing collapsed or stalled." },
    base: "own-lossy",
  },
  "own-genome-3": {
    asks: "Lossy taking where kin means a genome within three words of the winner's.",
    look: "Between the one-word and eight-word worlds.",
    seen: { state: "unclear", text: "Unclear (3 Oct): one seed read high at the end after reading low earlier, the pattern of a lineage that lost regrowth and regained it." },
    base: "own-lossy",
  },
  "own-genome-8": {
    asks: "Lossy taking where kin means a genome within eight words of the winner's.",
    look: "The loosest genome kin: whole families of mutants count as kin.",
    seen: { state: "unclear", text: "Unclear (3 Oct): no seed reached the bar; nothing collapsed or stalled." },
    base: "own-lossy",
  },
  "own-seasons": {
    asks: "The comparison the ownership screen had to beat: no rule change, just a season every 4,000 steps.",
    look: "Press 8 for the Light view and watch the season. Does stored energy carry bodies through the dim half?",
    seen: { state: "unclear", text: "Unclear (3 Oct): no seed above the control." },
    base: "gradient-m3",
  },
  "own-injury-light": {
    asks: "Do recurring small wounds select for bodies that regrow?",
    look: "Wounds land every 13 steps, each cell hit about once per 13,000 steps; a radius-3 wound takes about a third of a small body. Watch for regrowth where the brown appears.",
    seen: { state: "unclear", text: "Unclear (3 Oct): no seed reached the regeneration bar; nothing collapsed." },
    base: "gradient-m3",
  },
  "own-injury-heavy": {
    asks: "The same wounds four times as often.",
    look: "A body is touched about every 1,000 steps. Does anything keep a body together under that?",
    seen: { state: "unclear", text: "Unclear (3 Oct): no seed reached the bar; living mass fell to about 0.9 of the control's." },
    base: "own-injury-light",
  },
  "own-injury-coarse": {
    asks: "The same area wounded, in big discs that remove whole bodies.",
    look: "Radius-8 wounds, rarer. A wound here clears a patch outright; watch who refills it.",
    seen: { state: "unclear", text: "Unclear (3 Oct): no seed reached the bar." },
    base: "own-injury-light",
  },
  "own-shape": {
    asks: "If the shape of the growth kernel is heritable, does evolution change the shape of bodies?",
    look: "A genome weights the inner and outer rings of the kernel. Look at a cell to see its ring weights once they leave neutral.",
    seen: { state: "negative", text: "Dead end (3 Oct): the ring weights moved, but no seed's bodies differed from the control's." },
    base: "gradient-m3",
  },
  "own-shape-far": {
    asks: "Heritable shape with a far ring, so a body can reach past the usual kernel.",
    look: "Longer bodies are possible here. Watch for strands and tangles rather than dots.",
    seen: { state: "unclear", text: "Unclear (3 Oct): one seed of three differed from the control, on elongation. Worms and labyrinths appeared here and in the control world too; with three seeds and a measure chosen after seeing the frames, that is a description, not a difference." },
    base: "own-shape",
  },
  "own-cell": {
    asks: "If a cell is declared (its own id, one mutation at birth), what evolves one level up?",
    look: "Every 1,000 steps each body that shares its id with a heavier one becomes a daughter with a new id. The Lineages view recolours at each pass.",
    seen: { state: "unclear", text: "Unclear (3 Oct): one seed of three met the bar; nothing collapsed or stalled." },
    base: "gradient-m3",
  },
  "own-cell-wall": {
    asks: "Declared cells where taking another cell's matter is lossy, so a cell's matter is never simply absorbed.",
    look: "Press 4 for the Waste view: the walls between cells show as brown. Do cells stay distinct?",
    seen: { state: "unclear", text: "Unclear (3 Oct): two seeds met the regeneration bar, though under a later, stricter reading evolution here would count as frozen. Unclear again on five fresh seeds (4 Oct)." },
    base: "own-cell",
  },
  "own-cell-injury": {
    asks: "Declared cells under recurring wounds: a wound that cuts a body in two makes a daughter at the next pass.",
    look: "Wounds make cells. Watch whether the daughters live.",
    seen: { state: "unclear", text: "Unclear (3 Oct): no seed reached the regeneration bar; nothing collapsed." },
    base: "own-cell",
  },
  "own-cell-wall-injury": {
    asks: "Declared cells with lossy taking and recurring wounds together.",
    look: "The most cell-like rules in the catalogue. One seed died out.",
    seen: { state: "unclear", text: "Unclear (3 Oct) on three seeds, and again on five fresh ones: one of five met the bar, and one world died out." },
    base: "own-cell-wall",
  },
  "wild-storm": {
    asks: "What happens when every lever is on at once?",
    look: "A wandering sun, a season, a readable signal, recurring wounds and heritable shape, all at the dose each sandbox used. Watch the living mass chart.",
    seen: { state: "negative", text: "Extinct by step 29,000 at seed 1 (4 Oct). Moving one lever at a time on the calm world showed the sun's speed is what kills; the storm without its sun survives." },
    base: "gradient-m3",
  },
  "wild-storm-w01": {
    asks: "The storm with a tenth of the wounds.",
    look: "Each cell is hit about once per 130,000 steps.",
    seen: { state: "pending", text: "Not yet run: the storm needs a sun at half speed or slower before its other levers are worth sweeping." },
    base: "wild-storm",
  },
  "wild-storm-w10": {
    asks: "The storm with ten times the wounds.",
    look: "Each cell is hit about once per 1,300 steps.",
    seen: { state: "pending", text: "Not yet run: the storm needs a slower sun first." },
    base: "wild-storm",
  },
  "wild-storm-meteor": {
    asks: "The storm with meteors: rare big wounds that remove whole bodies.",
    look: "Radius-8 wounds at the same per-cell rate as the storm's small ones.",
    seen: { state: "pending", text: "Not yet run: the storm needs a slower sun first." },
    base: "wild-storm",
  },
  "wild-storm-m10": {
    asks: "The storm at ten times the mutation rate.",
    look: "More to select on, and more to lose. The Lineages view fills with new colours.",
    seen: { state: "pending", text: "Not yet run: the storm needs a slower sun first." },
    base: "wild-storm",
  },
  "wild-storm-3way": {
    asks: "The storm founded by hand-built movers instead of the searched founders.",
    look: "Six each of sleepers, blind drifters and sensing followers. The hand-built movers survived the fastest sun on the calm world; can they survive the storm?",
    seen: { state: "pending", text: "Not yet run." },
    base: "wild-storm",
  },
  "wild-storm-large": {
    asks: "The storm on the big world, with the sun at the same speed.",
    look: "Twice the founders, four times the cells. Slower on most GPUs.",
    seen: { state: "pending", text: "Not yet run." },
    base: "wild-storm",
  },
  breeder: {
    asks: "Can we breed ponds toward a trait we can see?",
    look: "Sixteen ponds at ten times the mutation rate, a cycle every 5,000 steps, donors ranked on movement, the seed packet's mass and body size together. Turn on Breed by hand and choose the donors yourself.",
    seen: { state: "measured", text: "Measured on the 64-pond, 10,000-step world (4 Oct), one seed each: breeding for movement alone bred real movement and left 23 of 64 ponds occupied; adding the seed packet's mass kept 63 occupied at about half the pace, and body size too kept 62 occupied at about a third. This 16-pond, 5,000-step version is sized for the lab and has not been measured. A vision model picking the most unusual-looking ponds bred no movement in one try: novelty and movement are not the same thing." },
    base: "ponds",
  },
};

export const byId = (id: string | null | undefined): Preset | undefined => (id ? PRESETS.find((p) => p.id === id) : undefined);
export const familyOf = (id: string): Family | undefined => FAMILIES.find((f) => f.ids.includes(id));
export const noteOf = (id: string): WorldNote | undefined => WORLD_NOTES[id];
