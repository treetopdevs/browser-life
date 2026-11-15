// The experiments ledger: one row per result the journal reports, grouped under the question it answered.
// It is the single source for the generated lists on /story/ and /experiments/ (apps/lab/test/experiments-ledger.test.ts
// fails when those pages are stale; BL_WRITE_LEDGER=1 rewrites them). Every row names a journal card by its heading, and
// the test checks that the card exists with the same label and date, so a verdict cannot drift from the journal.
// Add a row when an experiment closes: write the journal card first, then the row.

/** The journal's evidence labels (apps/lab/research/index.html). Do not invent new ones. */
export type Label = "Confirmed" | "Negative" | "Measured" | "Exploratory" | "Open" | "Unclear" | "Not yet measured";

export interface Chapter {
  n: number;
  /** Short name for the margin label. */
  short: string;
  /** The question, as the reader meets it. */
  question: string;
}

export interface Entry {
  chapter: number;
  /** Heading of the journal card this row summarises, exactly as printed there. */
  card: string;
  label: Label;
  /** Day and month as the journal card prints them, all 2026. */
  date: string;
  /** One or two plain sentences: what came back, and the caveat that matters most. */
  answer: string;
  /** Public pages for this result, if any. */
  pages?: { href: string; text: string }[];
  /** Repo paths the journal card was written from. */
  sources: string[];
}

export interface Plaything {
  href: string;
  title: string;
  blurb: string;
}

export const CHAPTERS: Chapter[] = [
  { n: 1, short: "The jar", question: "Can rules this simple grow something that mends itself?" },
  { n: 2, short: "The long run", question: "Left alone, does it keep evolving?" },
  { n: 3, short: "The instruments", question: "Were our instruments seeing what we thought?" },
  { n: 4, short: "A hand on the dial", question: "Can we turn it up by hand?" },
  { n: 5, short: "A second pair of eyes", question: "Can a machine notice for us?" },
  { n: 6, short: "Other worlds", question: "Is it the world’s fault?" },
  { n: 7, short: "Sharper questions", question: "What exactly are we asking?" },
];

export const ENTRIES: Entry[] = [
  // 1 · The jar
  { chapter: 1, card: "Regenerating founders", label: "Confirmed", date: "27 Sep",
    answer: "A screen found genetically distinct seeds that regrow after a wound removes about 30% of a body, and die without light. Passing this gate does not establish open-ended evolution.",
    sources: ["docs/plan.md"] },

  // 2 · The long run
  { chapter: 2, card: "Open-ended evolution (M4)", label: "Negative", date: "28 Sep",
    answer: "All 170 registered runs finished with exact conservation, but the milestone was not met: neutral runs, where mutations change nothing, also counted as “growing”.",
    sources: ["docs/plan.md", "experiments/preregistration.md"] },
  { chapter: 2, card: "Where variation stalls", label: "Measured", date: "29 Sep",
    answer: "Genomes are copied faithfully, but mutation rarely changes what a genome does: the mutants of only 1 of the 12 founders reliably took up a new role.",
    sources: ["docs/plan.md"] },
  { chapter: 2, card: "Founders and environments", label: "Measured", date: "30 Sep",
    answer: "What the founders were mattered more than how varied they were. Whether new roles keep arriving after niches first fill is mixed.",
    sources: ["docs/plan.md", "docs/reassessment-2026-09-30.md"] },
  { chapter: 2, card: "A search for self-renewing habitats", label: "Negative", date: "4 Oct",
    answer: "None of the 24 main pilot cases qualified as a self-renewing habitat. A negative for this panel only, with one pilot seed per habitat.",
    sources: ["docs/evolvability-discovery-2026-10-04/README.md"] },
  { chapter: 2, card: "Recovery, retested", label: "Negative", date: "24 Oct",
    answer: "A mutant that had looked better at regrowing tied its founder: both recovered in 28 of 32 trials, with four wins either way. A futility screen, not proof that recovery cannot improve.",
    sources: ["docs/recovery-accessibility-2026-10-24/RESULTS.md"] },

  // 3 · The instruments
  { chapter: 3, card: "What counts as an individual", label: "Measured", date: "29 Sep",
    answer: "In 135 of 200 sampled births, the parent our tracker credited had contributed no copied material at the time of the birth. A tracked birth is not, by itself, evidence that an individual reproduced.",
    sources: ["docs/plan.md"] },
  { chapter: 3, card: "Measures that need work", label: "Measured", date: "1 Oct",
    answer: "None of the four activity, novelty and role measures met every validation requirement; three flagged too many neutral runs.",
    sources: ["docs/plan.md"] },
  { chapter: 3, card: "Change read from the mutation tree", label: "Negative", date: "18 Oct",
    answer: "Three measures read from who descends from whom all failed their checks; in one world every one of them ranked neutral runs as more “selective” than real ones.",
    sources: ["docs/clade-measures-2026-10-18.md"] },
  { chapter: 3, card: "Which “how predictable” scores are fooled?", label: "Exploratory", date: "1 Nov",
    answer: "On test movies with known answers, nine copies of one glider gave exactly nine times the errors of one. Error count alone shows no new structure.",
    pages: [{ href: "/predictability/", text: "Predictability atlas" }],
    sources: ["docs/predictability-atlas-2026-11-01/EVIDENCE.md"] },
  { chapter: 3, card: "Can a measure see repeated building blocks?", label: "Exploratory", date: "2 Nov",
    answer: "Two readouts told a hand-built hierarchy from duplicated random shapes; a naive copies-times-cost score got it backwards every time. Nothing was read from real ecology clips.",
    pages: [{ href: "/assembly/", text: "Assembly observer" }],
    sources: ["docs/assembly-observer-2026-11-02/EVIDENCE.md"] },

  // 4 · A hand on the dial
  { chapter: 4, card: "A life cycle for groups", label: "Measured", date: "1 Oct",
    answer: "Under an imposed pond life cycle, heritable differences between ponds appeared in 6 of 6 histories. Random-donor ponds showed them too, so the cycle’s causal role is not shown.",
    sources: ["docs/scaffold-protocol-v1.md", "docs/scaffold-heredity-replication-v1.md"] },
  { chapter: 4, card: "The pond result, registered", label: "Confirmed", date: "3 Oct",
    answer: "With rules frozen first and 24 histories per arm, both primary hypotheses were confirmed: cycled worlds founded new ponds more often than the controls. A separate genome-swap test found a small benefit; it does not measure the genome’s share of the advantage.",
    sources: ["docs/scaffold-registration-v1.md"] },
  { chapter: 4, card: "Can ponds select themselves?", label: "Not yet measured", date: "3 Oct",
    answer: "The next step takes our hand off the ranking. Its entry checks passed; the evolutionary stage is prepared and has not run.",
    sources: ["docs/scaffold-transition-hunt-v1.md"] },
  { chapter: 4, card: "Breeding, storms and bodies", label: "Measured", date: "4 Oct",
    answer: "Sandbox looks, one seed each. Eight screens of rules meant to make evolution keep bodies produced no arm that met its pre-stated bar for promising.",
    sources: ["docs/sandbox-wild.md", "docs/sandbox-ownership.md", "docs/sandbox-cells.md"] },
  { chapter: 4, card: "A first gene", label: "Measured", date: "16 Oct",
    answer: "A gainable decomposition gene swept to about 99% of living cells in all three seeds. It paid for the lineage, not for the world: the worlds ended as a decomposing film.",
    sources: ["docs/evolution-game-brainstorm-2026-10-16.md", "docs/announce-gene-v0-2026-10-16.md"] },
  { chapter: 4, card: "A second gene", label: "Unclear", date: "16 Oct",
    answer: "Confounded by its own rule: a gene that costs the same and does nothing reached about half the living cells in two of three control seeds.",
    sources: ["docs/evolution-game-brainstorm-2026-10-16.md"] },
  { chapter: 4, card: "A gene that does", label: "Unclear", date: "21 Oct",
    answer: "With and without forced building, the paid gene stayed at or under 1% of living cells. Unclear: no difference these seeds can see, not proof that there is none.",
    sources: ["docs/evolution-game-brainstorm-2026-10-16.md"] },
  { chapter: 4, card: "A world that rewards building", label: "Negative", date: "22 Oct",
    answer: "We looked for a world where building pays. In the second screen, seven worlds and 103 runs, none passed its pre-stated test, so the gene arms never ran.",
    sources: ["docs/evolution-game-brainstorm-2026-10-16.md"] },

  // 5 · A second pair of eyes
  { chapter: 5, card: "An anomaly bell", label: "Negative", date: "17 Oct",
    answer: "A bell meant to ring when a run strays from neutral rang on 30 of 70 neutral runs, where its bar allowed at most 2. It rings on drift.",
    sources: ["docs/naturalist-bell-v0-2026-10-17.md"] },
  { chapter: 5, card: "A quieter bell", label: "Measured", date: "18 Oct",
    answer: "With its two noisiest signals dropped, the bell rang on none of 70 new neutral runs and on all 10 treatment runs. It tells kinds of run apart; it does not hear something arise inside one.",
    sources: ["docs/naturalist-bell-v1-plan-2026-10-17.md"] },
  { chapter: 5, card: "Can the bell hear a wound?", label: "Negative", date: "18 Oct",
    answer: "Given twin worlds that differ by one deliberate wound, the bell rang on 4 of 10 for the largest wound, where its rule needed 8 of 10.",
    sources: ["docs/naturalist-bell-v2-2026-10-18.md"] },
  { chapter: 5, card: "Can an image model see a takeover?", label: "Exploratory", date: "31 Oct",
    answer: "On one known takeover it passed, thinly. A rise in its score means “something visibly changed”, not “life happened”.",
    pages: [{ href: "/soup/", text: "Program soup" }],
    sources: ["docs/soup-asal-calibration-2026-10-31.md"] },
  { chapter: 5, card: "Can we predict what a nudge will do?", label: "Negative", date: "2 Nov",
    answer: "A simple trend rule was wrong on 73 of 96 held-out cases and scored worse than a baseline that ignores the evidence.",
    sources: ["docs/prediction-confirm-2026-11-02/RESULT.md", "docs/prediction-envelope-2026-11-01/EVIDENCE.md"] },

  // 6 · Other worlds
  { chapter: 6, card: "How long a stone stays findable", label: "Unclear", date: "18 Oct",
    answer: "For the shared garden: how long does a wound stay findable in a stormy world? The measure saturates, so what the numbers say about that is unclear.",
    pages: [{ href: "/garden/", text: "The shared garden" }],
    sources: ["docs/garden-stone-horizon-2026-10-18.md"] },
  { chapter: 6, card: "A stone against a nudge", label: "Measured", date: "18 Oct",
    answer: "Two controls for the stone test. A wound that changes no cell left its twin identical; against a one-cell nudge, none of the three readings is firm.",
    pages: [{ href: "/garden/", text: "The shared garden" }],
    sources: ["docs/garden-stone-horizon-2026-10-18.md"] },
  { chapter: 6, card: "A thin 3D world: no setting fits", label: "Exploratory", date: "23 Oct",
    answer: "Could a thin 3D slab hold a sparse living world that shades its own floor? Sixty settings on three seeds each, and none qualified. The 3D line is closed.",
    pages: [{ href: "/slab/", text: "Slab viewer" }],
    sources: ["docs/3d-rung1b-plan-2026-10-23.md", "experiments/3d-slab/m4-pick-output.md"] },
  { chapter: 6, card: "Can we measure how far a kick spreads?", label: "Open", date: "24 Oct",
    answer: "A meter for ordered, critical or chaotic worlds failed its ground-truth gate and was closed instead of being tuned. A result about the instrument, not the worlds.",
    sources: ["experiments/3d-slab/regime-stage0-run1-readout.md", "experiments/3d-slab/regime-rule-closed.md"] },
  { chapter: 6, card: "Rock, paper, scissors on a slab", label: "Open", date: "24 Oct",
    answer: "Three kinds that eat each other in a ring. A plain grid model passed its registered check; on our slab the pilot stopped at its first gate.",
    pages: [{ href: "/slab/", text: "Slab viewer" }],
    sources: ["experiments/3d-rps/GATE0-RECORD.md", "experiments/3d-rps/results/lattice-readout.md"] },
  { chapter: 6, card: "Where the food falls", label: "Measured", date: "28 Oct",
    answer: "In a small prototype world, only the pattern of food delivery changed. Even food kept three seeds alive and changing; the screen could not tell a moving band from a still one.",
    pages: [{ href: "/food-bands/", text: "Food bands" }, { href: "/hungry-shapes/", text: "Hungry shapes" }],
    sources: ["docs/creative-prototypes/uniform-food-results.md", "docs/creative-prototypes/stationary-food-results.md", "docs/creative-prototypes/alternating-food-replication-results.md"] },
  { chapter: 6, card: "Programs that learn to copy themselves", label: "Exploratory", date: "31 Oct",
    answer: "In a soup of random programs, self-copiers took over in 3 of 8 well-mixed soups. Copiers keep replacing each other; improvement is not shown. The long soups were unchecked GPU runs, so not exact runs of the published soup.",
    pages: [{ href: "/soup/", text: "Program soup" }],
    sources: ["docs/soup-garden-2026-10-31.md", "docs/soup-evolution-2026-10-31.md", "docs/soup-evolution-rerun-2026-10-31.md", "docs/soup/reproducibility.md", "docs/soup-redqueen-2026-11-01.md"] },
  { chapter: 6, card: "A world of particles with tiny brains", label: "Open", date: "13 Nov",
    answer: "Does inheriting a controller matter, against a fresh random one for every child? Two designs could not answer it. Measurement-limited, not a fail.",
    pages: [{ href: "/mycelium/", text: "Mycelium world" }],
    sources: ["docs/mycelium-r2-2026-11-13/RESULT.md", "docs/mycelium-r2b-2026-11-13/RESULT.md"] },
  { chapter: 6, card: "Trail: purged, kept, not shown to be used", label: "Exploratory", date: "14 Nov",
    answer: "When laying trail only costs, inheritance drops it. A toll rule keeps it, and four readouts of whether controllers follow its gradient stayed inside the margin set beforehand.",
    pages: [{ href: "/mycelium/", text: "Mycelium world" }],
    sources: ["docs/mycelium-r3-2026-11-13/RESULT.md", "docs/mycelium-r4-2026-11-14/RESULT.md", "docs/mycelium-conduit-2026-11-14/SCREEN.md"] },

  // 7 · Sharper questions
  { chapter: 7, card: "A map of behaviours", label: "Open", date: "1 Nov",
    answer: "A tool that keeps one example of each kind of behaviour now runs end to end, but its first comparison could not tell the search methods apart.",
    sources: ["docs/behaviour-atlas-2026-11-01/PLAN-2.md"] },
  { chapter: 7, card: "Better than the past, or just different?", label: "Open", date: "2 Nov",
    answer: "Old and new genomes competed in small arenas. Nothing shows improvement against the past under the frozen rules, and that is not a finding of no improvement: two of three archives failed a control.",
    pages: [{ href: "/opponents/", text: "Historical opponents" }, { href: "/opponents/archive/", text: "Archive tournament" }],
    sources: ["docs/historical-opponents-2026-11-01/EVIDENCE.md", "docs/historical-opponents-archive-2026-11-02/EVIDENCE.md"] },
  { chapter: 7, card: "Do small edits to a controller stay local?", label: "Open", date: "2 Nov",
    answer: "Too few edits improved anything to say: 3 and 4 of 192, where the rule needed five. Inconclusive, because underpowered.",
    pages: [{ href: "/controller-locality/", text: "Controller locality" }],
    sources: ["docs/controller-locality-2026-11-01/EVIDENCE.md", "docs/controller-locality-power-2026-11-02/RESULT.md"] },
  { chapter: 7, card: "Can one body’s building help another?", label: "Open", date: "2 Nov",
    answer: "The test could not decide: builders left too little behind for it to detect even a hand-built wall. Not “no benefit”.",
    pages: [{ href: "/niche/", text: "Niche construction" }],
    sources: ["docs/niche-construction-2026-11-01/EVIDENCE.md", "docs/niche-construction-fe-2026-11-02/EVIDENCE.md"] },
  { chapter: 7, card: "Do bodies that cluster follow the sun better?", label: "Open", date: "2 Nov",
    answer: "The test could not decide: its noise floor was above its own frozen limit. Not “no benefit”.",
    pages: [{ href: "/moving-light/", text: "Moving light" }],
    sources: ["docs/moving-light-2026-11-02/EVIDENCE.md"] },
];

/** Pages you can run or watch. Explorations and prototypes: a place to look, not evidence. */
export const PLAYTHINGS: Plaything[] = [
  { href: "/lab/", title: "The lab", blurb: "The main jar: plant a world, wound it, feed it, save it." },
  { href: "/worlds/", title: "World catalogue", blurb: "Every starting world, with notes on what has been seen in it." },
  { href: "/soup/", title: "Program soup", blurb: "A grid of tiny programs that run each other. Watch for self-copiers." },
  { href: "/mycelium/", title: "Mycelium world", blurb: "Particles with small neural controllers that eat, lay trail and split." },
  { href: "/slab/", title: "Slab viewer", blurb: "The two thin 3D worlds, drawn layer by layer. Neither passed its gate." },
  { href: "/garden/", title: "The shared garden", blurb: "One world meant to be grown in turns by whoever is tending it. Its page is here; the garden itself is not open yet." },
  { href: "/ecosystem/", title: "Evolving ecosystem", blurb: "An engineered toy ecosystem of five families, with an archive of saved runs." },
  { href: "/food-bands/", title: "Food bands", blurb: "Run the food-delivery screens live, side by side, with the food drawn as it moves." },
  { href: "/hungry-shapes/", title: "Hungry shapes", blurb: "Bodies run by small programs, under even or patchy food." },
  { href: "/particles/", title: "Particle playground", blurb: "Particle worlds with oases, seasons, bonds and motifs." },
  { href: "/spatial/", title: "Spatial particle worlds", blurb: "The particle playground in a volume." },
  { href: "/development/", title: "Growing families", blurb: "Bodies that develop from a seed, compared side by side." },
  { href: "/boundaries/", title: "Boundary fields", blurb: "A standalone field prototype about edges." },
  { href: "/matter/", title: "A counted aquarium", blurb: "A small world where every unit of matter is counted." },
  { href: "/currents/", title: "Nutrient currents", blurb: "A toy with selective nutrient currents. Its recorded replay needs files that are not on this site." },
  { href: "/vision-screen/", title: "Vision screen", blurb: "A saved gallery from calibrating a vision model as a judge." },
  { href: "/playground/", title: "Prototype library", blurb: "A directory of the creative prototypes." },
];
