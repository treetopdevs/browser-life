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
  { n: 8, short: "A body of its own", question: "Can a world hold real individuals?" },
  { n: 9, short: "Going to the food", question: "What if a body has to go to its food?" },
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
  { chapter: 3, card: "A null matched on demography", label: "Exploratory", date: "19 Oct",
    answer: "No treatment run had a neutral run of similar size and lineage count to match, in either world, so the existing runs cannot supply a matched null. The confound stays open; a fail would not have shown selection absent either.",
    sources: ["docs/clade-measures-2026-10-18.md"] },
  { chapter: 3, card: "A recovery check that stopped itself", label: "Open", date: "25 Oct",
    answer: "A planned mass-targeted recovery test stopped at its engineering stage: with the physical states matching, two observation schedules followed different remnants. A technical stop, with no recovery claim.",
    sources: ["docs/recovery-severity-2026-10-24/STAGE0.md", "docs/recovery-severity-2026-10-24/TRACKER-DIAGNOSIS.json", "docs/recovery-severity-2026-10-24/V4-IMPLEMENTATION.md"] },
  { chapter: 3, card: "Can the observer tell rebuilding from copying?", label: "Exploratory", date: "2 Nov",
    answer: "On a toy with answers we set, a readout that needs the class back after total destruction and a deletable store was right on 128 of 128; a naive level check on 48 of 128. It cannot tell a stored recipe from a stored image, and heredity is untested.",
    sources: ["docs/assembly-destruction-2026-11-02/PROTOCOL.md", "docs/assembly-destruction-2026-11-02/evidence.json", "docs/assembly-destruction-2026-11-02/REVIEW.md"] },

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
    answer: "Could a thin 3D slab hold a sparse living world that shades its own floor? Sixty settings on three seeds each, and none qualified. Eighty more the next day gave the same answer and the 3D line closed; it reopened on 15 Nov.",
    pages: [{ href: "/slab/", text: "Slab viewer" }],
    sources: ["docs/3d-rung1b-plan-2026-10-23.md", "experiments/3d-slab/m4-pick-output.md", "experiments/3d-slab/m4b-pick-output.md"] },
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
  { chapter: 6, card: "A conduit on trail that is already there", label: "Exploratory", date: "15 Nov",
    answer: "Given trail to run along, a nutrient conduit still did not pay: 0 of 8 seeds on a lasting road, and 0 of 8 with owned trail at each of three strengths. Screens of eight seeds, not tests; one arm without the toll kept trail in 6 of 8 single runs and is an open lead.",
    pages: [{ href: "/mycelium/", text: "Mycelium world" }],
    sources: ["docs/mycelium-bootstrap-2026-11-14/SCREEN.md", "docs/mycelium-bootstrap-owner-2026-11-15/SCREEN.md", "docs/mycelium-conduit-2026-11-14/SCREEN.md"] },
  { chapter: 6, card: "The slab becomes a jar", label: "Exploratory", date: "16 Nov",
    answer: "The 3D line reopened. In a 64-cell cube, light gave a nearly empty jar, a lid or thick mats, not the layering of the thin slab, and a floor mat appeared only where founders could start deep. Judged by eye on one or two seeds; no sealed pockets, because almost no polymer was built.",
    pages: [{ href: "/slab/", text: "Slab viewer" }],
    sources: ["docs/3d-expansion-plan-2026-11-15.md", "experiments/3d-slab/jar-light-screen-2026-11-15.md", "experiments/3d-slab/jar-levers-screen-2026-11-16.md"] },
  { chapter: 6, card: "A mycelium world with depth", label: "Exploratory", date: "16 Nov",
    answer: "In a 3D mycelium world, depth alone did not keep trail and bonded bodies mostly vanished under the smallest upkeep. On twelve fresh seeds, with bars written first, a world of bodies was not seen again (0 of 12) and a surface-to-floor trail was rare (1 of 12).",
    pages: [{ href: "/mycelium3d/", text: "Mycelium in a jar" }],
    sources: ["experiments/mycelium3d/trail-screen-2026-11-15.md", "experiments/mycelium3d/owner-darkfloor-screen-2026-11-16.md", "experiments/mycelium3d/bonds-screen-2026-11-16.md", "experiments/mycelium3d/leads-screen-2026-11-16.md"] },

  // 7 · Sharper questions
  { chapter: 7, card: "A map of behaviours", label: "Open", date: "1 Nov",
    answer: "A tool that keeps one example of each kind of behaviour now runs end to end, but its first comparison could not tell the search methods apart. A second line calibrated two descriptors: the displacement one was mostly undefined, the persistence one usable, and no calibrated archive was built on them.",
    sources: ["docs/behaviour-atlas-2026-11-01/PLAN-2.md", "docs/behaviour-atlas-2026-11-01/PLAN-ledger.md", "docs/behaviour-atlas-2026-11-01/calibration.json"] },
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

  // 8 · A body of its own
  { chapter: 8, card: "Tape genomes against weights", label: "Exploratory", date: "17 Nov",
    answer: "On random genomes, program mutants were far more often unchanged than weight mutants, mostly because random programs do little. On controllers matched to our founders the gap nearly closed. Never run inside a world.",
    sources: ["docs/tape-probe-2026-11-17/RESULT.md"] },
  { chapter: 8, card: "Bodies set loose", label: "Exploratory", date: "18 Nov",
    answer: "A body we designed held alone for thousands of steps, then merged into one mat in a crowd. Recognition marks walled families apart, not bodies, and the pieces froze. Three seeds per arm.",
    pages: [{ href: "/bodies/", text: "Set-loose bodies" }],
    sources: ["docs/bodies-2026-11-17/README.md", "docs/bodies-2026-11-17/v3/SUMMARY.json"] },
  { chapter: 8, card: "A wall made of matter", label: "Exploratory", date: "19 Nov",
    answer: "Cells with walls of conserved matter divide by pinching, with no rule to divide. Heredity carried in the wall kept them alive in 4 of 4 worlds, but a control without it did too at a slow mutation rate, so the cause is confounded.",
    pages: [{ href: "/vesicle/", text: "Vesicle world" }],
    sources: ["docs/vesicle-2026-11-18/README.md", "docs/vesicle-wall-genes-2026-11-19/README.md", "docs/vesicle-thread-2026-11-19/README.md"] },
  { chapter: 8, card: "Threads, jobs and glue", label: "Exploratory", date: "20 Nov",
    answer: "A thread genome held cells less well than wall heredity over long runs. Genes given two jobs ended as one generalist in 8 of 8 worlds. A glue gene made clumps with no life cycle of their own. Four seeds per arm.",
    pages: [{ href: "/vesicle/", text: "Vesicle world" }],
    sources: ["docs/vesicle-thread-2026-11-19/stage-1-3.md", "docs/vesicle-thread-2026-11-19/stage-2.md", "docs/vesicle-thread-2026-11-19/stage-4.md"] },
  { chapter: 8, card: "Six wall patterns and a parasite", label: "Exploratory", date: "20 Nov",
    answer: "With a phage for each of six wall patterns, the leading pattern kept changing (6 to 9 times late in a run, against 0 to 2 without phage). Short pilots on tuning seeds, and the counted patches were later found to be waves.",
    pages: [{ href: "/oligomer/", text: "Oligomer world" }],
    sources: ["docs/oligomer-2026-11-20/PHASE-A.md", "docs/oligomer-2026-11-20/PHASE-B1.md", "docs/oligomer-2026-11-20/PHASE-B2-GPU.md", "docs/reef-2026-11-20/RUNG1-PILOT.md", "docs/reef-2026-11-20/RUNG2-PILOT.md"] },
  { chapter: 8, card: "Droplets against the Reef", label: "Measured", date: "21 Nov",
    answer: "On eight unseen seeds, with the rule frozen first, both worlds passed and a tie-break written beforehand chose the droplets. Not labelled Confirmed: a check then changed what three of the five droplet endpoints mean.",
    pages: [{ href: "/oligomer/", text: "Oligomer world" }],
    sources: ["experiments/confirm/PREREGISTRATION.md", "experiments/confirm/RESULT.md", "experiments/confirm/verdict.json"] },
  { chapter: 8, card: "The droplets were waves", label: "Measured", date: "21 Nov",
    answer: "The patches the confirmation counted as droplets are crests of moving waves: 2% to 3% kept their identity for 1,000 steps, on 4 of 4 unseen seeds. The verdict stands as computed; the count is not a number of individuals.",
    pages: [{ href: "/oligomer/", text: "Oligomer world" }],
    sources: ["docs/b2-compartment-check-2026-11-21/PLAN.md", "docs/b2-compartment-check-2026-11-21/RESULT.md"] },
  { chapter: 8, card: "Compartments that keep their genes", label: "Exploratory", date: "22 Nov",
    answer: "With two genes and a parasite, compartments that keep gene copies inside held on 12 of 12 unseen seeds, and leaky ones on 0 of 12. One setting; rules written first but not registered. Nothing evolved here.",
    pages: [{ href: "/dropgenes/", text: "Droplet genes" }],
    sources: ["docs/droplet-genes-2026-11-21/RESULTS.md", "docs/droplet-genes-2026-11-21/FIRMUP-RESULTS.md", "docs/droplet-genes-2026-11-21/FIRMUP-B-RESULTS.md"] },
  { chapter: 8, card: "A trait held by selection between compartments", label: "Confirmed", date: "22 Nov",
    answer: "With the rule frozen first, on 8 of 8 unseen seeds a heritable trait settled at a level held by selection between compartments. The other half of the question came back no: without the gate it did not run away. The ladder is ours.",
    sources: ["docs/droplet-genes-trait-2026-11-21/PLAN.md", "docs/droplet-genes-trait-2026-11-21/RESULTS.md"] },
  { chapter: 8, card: "Linked genes, and room for six", label: "Exploratory", date: "22 Nov",
    answer: "Linking genes into one template did not help a compartment hold four genes against the parasite. With more gene sites and a rarer parasite, six were held. Screens on seen seeds; the confirmation has not been run.",
    sources: ["docs/droplet-genes-linked-2026-11-21/CALIBRATION.md", "docs/droplet-genes-linked2-2026-11-21/CALIBRATION.md", "docs/droplet-genes-room-2026-11-22/RESULTS.md"] },
  { chapter: 8, card: "Six walls at rest and on the move", label: "Exploratory", date: "22 Nov",
    answer: "At compartment-making rates six wall patterns froze into a lattice that stopped dividing. Where bodies move, they divide and die with or without phage, and phage added almost no pattern turnover. Seen seeds only.",
    sources: ["docs/six-wall-spot-2026-11-22/CALIBRATION.md", "docs/six-wall-moving-2026-11-22/CALIBRATION.md"] },

  // 9 · Going to the food
  { chapter: 9, card: "Roam: bodies that go to their food", label: "Exploratory", date: "23 Nov",
    answer: "Bodies of bonded cells travelled between food patches, ate them empty and died, and chasers displaced sitters and wanderers. Seeds 1 and 2 only, rules we wrote, and nothing confirmed on unseen seeds.",
    sources: ["docs/roam-2026-11-23/NOTE.md"] },
  { chapter: 9, card: "Roam: growth plans, hunters and armour", label: "Exploratory", date: "24 Nov",
    answer: "With heritable growth plans one new shape took over, once, on one seed. Hunters and grazers coexisted on both seeds. The one test with a bar stated first failed. Seeds 1 and 2 only; nothing confirmed on unseen seeds.",
    sources: ["docs/roam-2026-11-23/NOTE.md"] },
  { chapter: 9, card: "Soft Roam: off the grid", label: "Exploratory", date: "25 Nov",
    answer: "Off the grid, bodies slide and bend smoothly, but they stayed small, mouths took over and no hunter was seen to turn toward prey. Seeds 1 and 2 only; nothing confirmed on unseen seeds.",
    sources: ["docs/softroam-2026-11-25/NOTE.md"] },
  { chapter: 9, card: "Soft Roam: a year, bigger bodies, speeds", label: "Exploratory", date: "26 Nov",
    answer: "A yearly cycle showed in the cell count on four seen seeds, and healing made bodies of 10 or more common, though 20 or more stayed rare. The speed round failed half its own bar. Nothing confirmed on unseen seeds.",
    sources: ["docs/softroam-2026-11-25/NOTE-2.md", "docs/softroam-2026-11-25/NOTE-3.md", "docs/softroam-2026-11-25/NOTE-4.md"] },
];

/** Pages you can run or watch. Explorations and prototypes: a place to look, not evidence. */
export const PLAYTHINGS: Plaything[] = [
  { href: "/lab/", title: "The lab", blurb: "The main jar: plant a world, wound it, feed it, save it." },
  { href: "/worlds/", title: "World catalogue", blurb: "Every starting world, with notes on what has been seen in it." },
  { href: "/soup/", title: "Program soup", blurb: "A grid of tiny programs that run each other. Watch for self-copiers." },
  { href: "/mycelium/", title: "Mycelium world", blurb: "Particles with small neural controllers that eat, lay trail and split." },
  { href: "/slab/", title: "Slab viewer", blurb: "The two thin 3D worlds and the taller jar, drawn layer by layer or as a volume you can turn. Neither thin world passed its gate, and the jar has only been judged by eye." },
  { href: "/mycelium3d/", title: "Mycelium in a jar", blurb: "The mycelium world in 3D, lit from the top, drawn as a volume you can turn, with bonds and a cursor to wound or feed it. Explored with screens, not tests: on twelve fresh seeds a world of bodies was not seen again." },
  { href: "/garden/", title: "The shared garden", blurb: "One world grown in turns by whoever is tending it. It is open: visitors can drop a stone in it or send a sun." },
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
