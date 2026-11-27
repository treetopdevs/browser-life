// The ladder on /story/: what we are trying to see, rung by rung, and how far each world got.
// Hand-written and dated, like the catalogue's notes: update it when a result lands (journal card first, then the
// ledger row, then this). apps/lab/src/experiments/render.ts turns it into the generated blocks on the story page,
// and apps/lab/test/story-ladder.test.ts holds the rules (one marker, in order; sources and pages that exist).

/** How a rung stands in the world we are working in now. No rung here is Confirmed: that word is the journal's. */
export type RungState = "Seen" | "A first version" | "Not yet";

export interface Rung {
  n: number;
  name: string;
  /** What you would see if this rung held. */
  means: string;
  state: RungState;
  /** Where it stands, with the caveat that matters most. */
  stands: string;
}

/** The world the rungs are read in, and the seeds everything in it was seen on. */
export const LADDER_WORLD = { name: "Roam and Soft Roam", seeds: "seeds 1 and 2", asOf: "26 Nov 2026" } as const;

/** The lowest rung that does not hold yet: the one being worked on. */
export const HERE = 4;

export const RUNGS: Rung[] = [
  { n: 1, name: "Individuals that divide and die", state: "Seen",
    means: "Bodies you can point at, that make more bodies and stop existing, without the program declaring what a body is.",
    stands: "Bodies are groups of bonded cells, found each step by walking the bonds. They grow, let daughters go, starve and break." },
  { n: 2, name: "Heredity", state: "Seen",
    means: "A daughter is like her mother because something was copied, and the copy can differ.",
    stands: "Each cell carries genes and a growth plan, copied with occasional errors." },
  { n: 3, name: "Selection between individuals", state: "Seen",
    means: "Some bodies leave more descendants because of what they inherited.",
    stands: "Bodies that chase food displaced sitters and wanderers on both seeds. Chasing was a dial we wrote, so this is the least we could ask." },
  { n: 4, name: "Heredity that can invent", state: "A first version",
    means: "Genes whose effects are not picked from a list we wrote, so evolution can make a form nobody drew.",
    stands: "Growth plans are a first version. One clearly new outline, a two-wide strip we call the ladder, arose from one changed plan entry and took over on one seed. It did not on the other." },
  { n: 5, name: "Creatures that differ from their ancestors, and between runs", state: "Not yet",
    means: "Run it twice and get two different worlds, each full of things the founders were not.",
    stands: "Seen once each way, on two seeds, and only under a size rule and a size limit that we wrote. Most of the many outlines are one plan grown crooked." },
  { n: 6, name: "It keeps going", state: "Not yet",
    means: "Arms races and new ways of making a living that keep arriving, with no hand on the dial.",
    stands: "Armour and hunters swung one way and back in one history. A later change that shifted the histories erased it, and we withdrew it." },
];

export interface Reach {
  /** The world, in the words the site uses for it. */
  world: string;
  when: string;
  /** The page to run or watch it, when the site builds one. */
  href?: string;
  /** The world we are working in. */
  now?: true;
  /** What it had going for it. */
  had: string;
  /** The rung it stopped on, and why. */
  stopped: string;
  /** The rung it stopped on. */
  rung: number;
}

/** Each kind of world we tried, in the order we tried it, by the rung it stopped on. */
export const REACHES: Reach[] = [
  { world: "The jar", when: "from 26 Sep", href: "/lab/", rung: 1,
    had: "Exact matter, light as the only input, and rich genomes: every cell runs a small evolved controller. Nothing declares an organism.",
    stopped: "No individuals we could trust. In 135 of 200 sampled births, the credited parent had copied nothing into the child. Mutation rarely changed what a genome did." },
  { world: "The program soup", when: "31 Oct", href: "/soup/", rung: 1,
    had: "The richest heredity here: programs that learn to copy themselves, then replace each other.",
    stopped: "A copier is a string of bytes, not a body. Later copiers were not shown to be better than earlier ones." },
  { world: "The mycelium world", when: "13 Nov", href: "/mycelium/", rung: 1,
    had: "Particles with small neural controllers that eat, lay trail and split. Inheritance drops a trail that only costs.",
    stopped: "We wrote the individuals in, so the first rung was never tested. Whether inheriting a controller matters could not be measured." },
  { world: "Bodies set loose", when: "17 Nov", href: "/bodies/", rung: 1,
    had: "Hand-built growth rules that hold a clean disc and regrow it after a wound.",
    stopped: "In a crowd the bodies run together into one mat. Recognition marks walled families apart, not bodies, and the pieces froze." },
  { world: "Vesicles", when: "18 Nov", href: "/vesicle/", rung: 4,
    had: "Real individuals: walls made of conserved matter that grow, pinch in two and burst. Nobody tells a cell to divide.",
    stopped: "What a cell inherits is a few numbers on its wall. Given two jobs to split, every world ended with one generalist." },
  { world: "Droplets with genes", when: "21 Nov", href: "/dropgenes/", rung: 4,
    had: "Compartments that split and die, genes they keep when their walls hold the copies in, and a trait held by selection between compartments.",
    stopped: "The one trait that could evolve was a five-step dial we wrote. It moved to one level and stayed, and the world is static to watch." },
  { world: "Roam and Soft Roam", when: "from 23 Nov", href: "/softroam/", rung: HERE, now: true,
    had: "A body takes up space and has to go to its food. Bodies grow by a heritable plan, hunt, armour themselves and break.",
    stopped: "Where we are. Everything in it is seen on two seeds and not yet confirmed on seeds we have not looked at." },
];

/** Dated figures for "how it gets made". Counted by hand from the repository on the day given; update them together. */
export const MADE = { first: "26 Sep 2026", asOf: "26 Nov 2026", days: 61, commits: 880 } as const;
