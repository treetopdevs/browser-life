# A game of evolution: brainstorm (2026-10-16)

Status: **exploratory, a brainstorm and not a plan.** Nothing here is registered, nothing changes
physics, a checkpoint format or a golden pin, and no prototype has been built. It answers the
question asked on 2026-10-16: the open-ended, physically honest jar has been fun to watch; what
would it take to make a *game* of evolution from it, one that constrains the possibility space,
forces evolution and visible phase changes, and lets a person grow things and turn a few dials?
It takes the roadmap's bet 5 ("More ways to be alive: change the rules where today's worlds hit a
ceiling") and bet 2 (the breeder) and asks what they look like as play. The visual companion is
`docs/evolution-game-brainstorm-2026-10-16.html`, drawn from the brainstorm sections; the rung check
that ran afterwards is the last section of this note and is not on the page.

## Summary

- **The ask is a fork, not a tuning.** The lab's north star is to *infer* individuals, reproduction
  and transitions from local rules and never declare them. A game that "defines the tracks" declares
  some of those things on purpose. That is the right move for a game, and the repo's own record
  supports it: the registered test was not met, eight sandbox screens found no Promising arm,
  regeneration erodes under every founder, and the one confirmed result came from the one line
  that imposes its unit (the pond cycle). The lab stays the lab. The game is a sibling that shares
  the kernel, keeps exact conservation and bit-for-bit replay (those are game features: a sealed
  jar, a shareable seed, a verified history), and declares what the lab would not.
- **The repo already holds a game loop that works.** The breeder bred movement from almost none
  to 282 cells per 1,000 steps in 60 pond cycles, and a combined score kept nearly every pond
  alive while it bred about half that.
  At the lab's `breeder` preset a generation is about three seconds. Nothing else in the project
  has made evolution *visibly* happen on a timescale a person can sit through. Build the game on
  that first.
- **Five shapes** are laid out in §5, each tied to something the repo measured: the breeder as a
  game (no physics), tracks in the genome (capability genes, a physics change), epochs as designed
  regime shifts (mostly config over time), two substrates (a field for the medium and producers,
  declared creatures for consumers), and named species as the board (observer work only).
- **What the outside evidence says** (§6, §7): the devices with the best record are a size-dependent
  selective force with clonal offspring and a bottleneck (the snowflake-yeast recipe; the pond cycle
  is already most of it), an energy-paid ladder of rewarded capabilities with mild intermediate
  rewards (Avida), and staged environments that change *what pays* rather than tighten scarcity.
  Among games, the ones that feel like evolution let the world do the designing and spend their
  effort on legibility: named species that survive extinction scares, lineage trees, several views
  of one history. The ones that feel fake hand the player a creature editor. The survey found no
  independently verified case of a new body plan, multicellularity or predation emerging from a
  forced pressure in a game (developers claim it; the passes found no independent check). That
  is the gap in the record, and it is also the risk.
- **Recommendation**: a staged ladder (§8). Stage 0a costs nothing: put three people in front of
  the breeder panel the lab already has and ask what they saw. Stage 0b builds on what they could
  not see: a pressure chosen per cycle, a log of firsts with stated rules, a family tree. Stage 1
  is the physics bet: capability genes with a maintenance cost, so acquiring a capability is a
  discrete, costly, readable event, under its own rule version. Stage 2 adds a creature layer only
  if the field cannot carry predation.
- **Five decisions are the user's** (§9): fork or next phase; how much to declare; which prototype
  first; what the player may touch; solo jar or shared garden first.

## 1. Frame

**What was asked.** Less open-ended mathematical realism, more defined tracks: constrain the
possibility space so that evolution and phase changes reliably happen; make it slightly
interactive (grow things, tweak parameters, see what happens); think of it as a game. And
research the kinds of simulation, or hybrids, that could carry that.

**What a game needs that the lab does not have.**

| A game needs | The lab today |
| --- | --- |
| Units you can tell apart and name | pools of colour; individuals inferred by the census (connected cells with bound mass ≥ 48, total ≥ 256) and labelled by the lineage inspector with a stated purity |
| Something to want, and a way to tell you are getting it | measures (census, tracker, activity, lineage, pond scores); no goal, no score the person owns |
| Dials whose consequences show within a minute | config fixed at planting; brushes for lesion, feed and drain; donor picks at pond boundaries |
| Events: moments with a name and a time | the tracker infers births, deaths, fissions and fusions of census individuals (with the recorded doubt that 135 of 200 sampled parent links failed a copy test); the intervention log; no game-facing detector of firsts or speciations |
| Pace: a visible change every ten to sixty seconds | about 1,800 steps a second at 256² on the Mac; a 5,000-step pond cycle in about three seconds |
| Failure you can recover from | a dead jar stays dead; a jump back restores a checkpoint and replays the log |
| A reason to come back | "come back and see what changed" is already the site's promise; nothing yet marks what changed |

**What the game should keep from the lab, because it is better as a game for it.**

- *Exact conservation.* "The jar is sealed" is a promise a player can check, and the ledger panel
  already does. Feeding is the one exception and is logged as such.
- *Bit-for-bit replay.* The lab's run manifest (config, initialisation, rule version, observer
  settings and the ordered interventions) is a whole history for a world observed from step zero
  with a reconstructible start. Two people with the same manifest see the same world; two with
  different choices can compare, and a replay twin can verify a claimed result. Sharing it is
  sharing a game, once there is a versioned export to share: today an exported checkpoint omits
  the intervention log, an imported history gets a placeholder initialisation that the manifest
  does not reconstruct, the headless replay of a lab history takes picks but refuses lesions,
  feeds and histories not observed from step zero, differing observer settings can change the
  final hash, and the one proof of headless replay used a hand-built manifest. Stage 0b must
  either restrict sharing to step-zero starts or bundle a starting checkpoint with its observer
  state, and prove it on a real export.
- *The archipelago.* Islands already run segments of a world for a coordinator. A shared game
  world has its plumbing (bet 4).
- *Honesty about what is seen and what is measured.* The catalogue's labels (seen, measured,
  confirmed) are a good habit for a game too: a "first" should be a detector's verdict, with its
  rule stated, not a vibe.

**What it gives up.** "Never declared" at some level. Declared cells already moved the emergent
claim one level up (`docs/sandbox-cells.md`); capability genes (§5.2) would declare what a
lineage *can do*; a creature layer (§5.4) would declare bodies. Each is a different depth of
declaration, and §9 asks which.

**Who it is for.** The user first: someone who likes watching life grow and wants to see it
change. Visitors to cadence.garden second. The site's Spore line is the register: not the creature
editor, but the thing Spore reportedly tried early and dropped as not engaging enough, which is
evolution doing the designing while a person watches and nudges. This note bets that the
breeder's pace and the devices in §7 make it engaging now.

## 2. What the repo already knows

Everything a game shape below leans on was measured here. In order of how much a game can build
on it.

| Result | Where | What it says for a game |
| --- | --- | --- |
| **The breeder breeds.** Movement alone: commanded movement 0.6 at cycle 1, measured speed 74 by cycle 10 and 282 by cycle 60, in cells per 1,000 steps (64 ponds, 10,000-step cycles, one seed); occupied ponds fell to 23 of 64. Movement + seed mass: 135 at cycle 60 with 63 ponds alive. Movement + seed + body: 88 with 62 alive, heavier packets. | `docs/sandbox-wild.md`, breed1 and breed2 | A named pressure moved one trait a hundredfold in 60 cycles of 10,000 steps, and scoring the seed packet's mass kept the world alive. Movement is the only trait shown to respond; packet mass was preserved by scoring it; the body-size differences are descriptive (25.4 cells against 26.0 in the mass control). This is the only visible, fast evolution in the project. One seed each, so not yet repeatable. |
| **The pond cycle is a bottleneck with a size filter, and it confirmed heredity.** A packet under 2,800 bound mass founds a lasting pond 6% of the time; over 3,200, 95%. The registered scaffold ensemble confirmed H1 and H2 (24 histories per arm; the evolved genome alone beats the ancestor in 24 of 24, by a small margin). Packets are 8 × 8 windows copied site by site with no lineage filter; in the scaffold's main run they were measured nearly clonal (about 1.1 lineages, dominant share 0.99). | `docs/sandbox-wild.md` "Why bred ponds died"; `docs/scaffold-registration-v1.md`; `docs/reassessment-2026-09-30.md` §4a; `packages/schema/src/ponds.ts` | The repo already has most of the snowflake-yeast recipe (§6, item 1): nearly clonal packets, a bottleneck, selection on the group. It is the one line whose unit is defined by design. |
| **The registered test was not met.** M4 failed endpoint 2: runs where mutation changes nothing also read as growing. | `docs/plan.md`, M4 pivot | Open-ended complexity growth did not come for free. The reassessment's line: simple strategies win in steady worlds; evolution-like behaviour needs structure that punishes the cheap strategy. |
| **Erosion is general.** Regeneration of the founders 0.98; of evolved lineages 0.22 on average over 60 single-founder worlds, under every founder. Eight sandbox screens (lossy takeover, kin tolerances, wounds, heritable shape, declared cells, with and without walls and wounds) met no Promising bar. | `docs/sandbox-ownership.md`, `docs/sandbox-cells.md` | The reading "evolution strips what the environment does not pay for" is recorded there as an interpretation, and its test failed: recurring wounds did not keep regeneration. What stands is the loss itself. The design hypothesis this note takes from it: a game's pressures must *pay* for the capabilities it wants to see (Evoloops' lesson, §6), and whether paying works is untested here. |
| **Wounds restore turnover and change who wins.** With the wall held fixed, wounds raised median lineage depth 1.2 to 7 times, births 2.1 to 7.3 times, and changed the winning founder in 4 of 5 seeds. | `docs/sandbox-cells.md`, screens 7 and 8 | Disturbance is a dial that keeps a world evolving. It did not keep regeneration; it kept *change*. |
| **A sun's speed has a lethal end.** A sun lapping the world in 16,384 steps kills the M3 founders; 32,768 leaves 6,170 living cells; 131,072 leaves 11,019. The hand-built sleepers, drifters and sensors together survive the fastest sun (5,494 living cells). Separately, in the wandering-sun world (one small comparison, a lead), the sensing followers survived where the blind drifters failed. One seed each. | `docs/sandbox-wild.md`, storm first look; `apps/lab/src/worlds.ts`, `planet-wander` | An epoch dial (§5.3) has a lethal end and a dull end. That the window between pays for sensing is a lead from hand-built movers, not an evolved result. |
| **Worms, labyrinths and stripes have been seen, including at 10⁶ steps.** A quarter to a third of body cells sat in long bodies in two control seeds at the final snapshot; the shape arms reached 0.52; declared-cell worlds under 5%. The measure was chosen after seeing the frames, and no treatment effect was established. | `docs/sandbox-cells.md`, screen 5 | Body plans beyond a dot are within the chemistry's reach, with no measured cause and no measured persistence. A game could name them ("the first worm") and select for them (an elongation score is listed as not built). |
| **Bodies are mostly one lineage.** Census individuals are one lineage in 88% to 99% of cases in the control and 73% to 99% in the genome arms, mean purity 0.93 to 1.00. Founders differ from each other in 41 or 42 of 42 heritable words; neighbours of one founder's clade differ in a median of 3 to 36, and up to all 42 at the 90th percentile. | `docs/sandbox-ownership.md`, purity and trace | A body can be named by its dominant lineage with a stated purity. One lineage can hold many bodies, and clades spread across most of the genome, so a species boundary (§5.5) is a design with a tolerance to validate, not a fact in the data. |
| **Roles are inferred from flux.** Phototroph, chemotroph, decomposer, mixed, per lineage, from the catalytic profile at a census; no persistence or ancestry test. In one assay most "decomposer candidates" read as phototrophs beside their founder under bright light. | `packages/metrics/src/ecology.ts`; `docs/plan.md`, foundations tests | The game can announce role-dominance *events* without any physics change. Calling one an evolutionary first needs persistence across censuses and inherited change, which the inference does not check. |
| **A model picking for novelty bred no sustained movement.** One seed, one draw, a brief that asked for novelty and not movement: the model's picks ended with no scoring pond; the rule's with 13 of 16. The note says this does not show bad picking, and one seed cannot separate the picker from one chaotic history. | `docs/sandbox-wild.md`, three pickers | Whether a person's eye breeds well is untested. The game should let the player set the *pressure* (a named score) and treat picking by eye as a thing to measure. |
| **The full storm kills.** Every lever at once was extinct by step 29,000. | `docs/sandbox-wild.md` | Dose is the whole design problem of epochs. Levers must be turned up one at a time, and the game should say what each costs. |

Not in the record: any evolved predation, any evolved multicellularity, any arm that bred a new
body plan on purpose. These are what "phase changes" would mean in play, and nothing here has
produced one yet.

## 3. Substrate facts the shapes depend on

- **The genome.** 44 words: two lineage words, PARAM0 (μ and σ of the growth function), PARAM1
  (the motility gain in byte 0; bytes 1 to 3 are the heritable kernel-ring offsets in the `cells`
  sandbox, and are zero in every base world) and 40 words holding 160 int8 controller weights
  (10 → 8 → 8). There is no free word. Anything new a lineage inherits is a layout change.
- **Every cell carries every reaction, and the controller scales each one.** Photosynthesis,
  respiration, decomposition, growth, polymer building and signal emission run in a fixed order
  with world-wide rate constants (`kPhoto` 160, `kResp` 128, `kDecomp` 96, `kGrow` 128, `kBuild`
  64 in the default config), each multiplied by one of the controller's outputs, which can be
  zero (`packages/sim-ref/src/step.ts`, react). So a lineage can already run a reaction at
  nothing, by tuning weights; what it cannot do is *lack* the machinery, pay for carrying it, or
  gain it in one readable step. There is no "first decomposer" today, only a lineage whose flux
  happens to be decomposition-dominated at a census. Waste also arises by passive decay and is
  recycled abiotically under light, so respiration and decomposition are not a forced order.
- **Mutation is per synthesised quantum** and mints a lineage id on every event, so lineages are
  cheap and deep (dozens to hundreds of mutations in 10⁶ steps). Declared cells (`cellPeriod`)
  move mutation to a cell's birth instead.
- **Levers that exist as config today**: light mode (uniform, gradient, patches, sweep) with
  period and amplitude, seasons, tiles and migration, the pond cycle and its arm and score, lossy
  takeover and kin tolerance, recurring wounds, heritable shape, declared cells, signal gain,
  mutation rate. **Interventions that exist**: lesion, feed, drain, pick, each logged and replayed
  (`packages/schema/src/world.ts` knows only these three kinds). A config value cannot change
  mid-run: the GPU pipelines are built from the config at construction and light and injury
  settings are shader constants. A "dial" the player turns while the world runs would be a new
  intervention kind, logged like the others, with the pipeline rebuilt or the setting moved into a
  runtime parameter, the transition validated, checkpoints carrying it, and the runner applying it
  headless for replay to hold. **Pond worlds refuse feeding and draining** (each pond's matter is
  fixed by the cycle) and cannot migrate between tiles, so some ages (§5.3) and the breeder cannot
  share one jar as the rules stand.
- **Pace.** Three measured numbers and one expectation. Measured: 1,830 to 2,060 steps a second
  at 256² on the Mac (730 a lane on an A10G); the lab's 16-pond `breeder` preset (256² of sites)
  runs a 5,000-step cycle in about three seconds; and breed1, on the 64-pond preset (512² of
  sites, 10,000-step cycles), showed movement at 74 by cycle 10, which is 100,000 steps. The
  expectation: at the 16-pond preset that is about a minute of play, so a ten-minute session is
  about 10⁶ steps, the length of every registered history. Untested: whether the 16-pond preset
  responds like the 64-pond one (one look had four of sixteen ponds empty at cycle 9, and the
  picker comparison ran it for 16 cycles without measuring speed), and
  whether any of it holds across seeds.

## 4. The design problem in one sentence

Evolution here is fast, cheap and good at stripping; the game must make the things we want to
see *pay*, give them names and a time, and keep the dose of disturbance between dull and lethal.

## 5. Five shapes

Each shape says what the player does, what evolves, what is declared, what it costs, what
evidence it rests on, and its main risk. They combine; §8 says how.

### 5.1 The breeder as a game ("Pond keeper")

**Play.** A jar of sixteen (or sixty-four) ponds. Every cycle, a few seconds, the ponds that score
best reseed the rest. The player's move is to choose the *pressure* for the next stretch: movement,
reach, body size, seed mass, mass, or later elongation, sensing and anything the metrics can
score; or to pick donors by eye for a cycle or two. A log of firsts announces thresholds
(first pond moving, first body over forty cells, first worm, first pond that survives a storm).
Progress unlocks levers: a gentle sun, then seasons, then wounds, then heritable shape, each with
its known dose. A session ends with a card: what was bred, how far, what died.

**What evolves.** Whatever the chemistry can do under group selection. Shown so far: speed, on
one seed. Preserved by scoring it: packet mass. Descriptive only: body size. Not built: scores
for shape and sensing.

**Declared.** Nothing new. The pond cycle is already imposed and the breeder already exists in the
lab, with hand picking and the `breeder` preset.

**Cost.** Lab and observer work: a pressure selector per cycle (today the score is fixed in the
config, so switching pressures mid-run needs the pick-style intervention and the runner's
replay of it), a firsts detector with stated rules, lineage colour and a tree in the jar, a
session card. No physics, no pins.

**Evidence.** breed1 and breed2: movement responds by cycle 10 (100,000 steps, on the 64-pond
preset) and the combined score keeps the ponds alive. That this is a minute of play on the
16-pond preset is the extrapolation in §3, not a measurement. The lab's breeder mode already logs picks and replays them exactly.

**Risk.** Only movement has been shown to respond, on one seed, on the larger preset. "Every
body marching in step" may read as a lattice, not as life. Whether a player's eye breeds as well
as the rule is untested (the model picker's run cannot say). A pressure the chemistry cannot meet
breeds nothing, and the game must say so rather than let the player wait. Reordering four donors
changes a whole history, so two sessions looking different is not evidence that the pressure did
it; that needs matched rule and random choices across seeds.

### 5.2 Tracks in the genome ("capability genes")

**Play.** The world starts with one kind of life that can only photosynthesise, respire and
grow (photosynthesis makes biomass and not free energy; growth spends free energy; respiration
or decomposition must fund it, and a cell that cannot pay its maintenance starves into waste
whatever its controller says). Every other capability is a gene a lineage can gain by mutation
and must pay to keep: decomposition, polymer building, signal emission, motility, sensing (controller inputs), adhesion,
a wall, and later eating (taking a stranger's biomass as nutrient). The player does not flip genes.
The environment decides which ones pay, and the player sets the environment. The game announces
each first: "the first decomposers appeared at step 412,000 and now hold 14% of the living
matter."

**Why this is "defining the tracks."** The possibility space becomes the lattice of gene sets,
which the game can name every corner of. Prerequisites can be hard (a wall needs polymer) or soft
(a gene is useless until another is on, so it is shed by its cost). Gating does not make a rung
*reliable*; it makes reaching one *identifiable*: a discrete, inherited, costly change the game
can detect and date, instead of a continuous weight the controller tunes for free.

**Why the chemistry has most of a ladder in it.** Photosynthesis makes biomass; respiration makes
waste; decomposition pays more once there is waste to eat (waste also arises by passive decay and
is recycled abiotically, so the order is a tendency, not a rule). Crowding makes moving pay; a
moving sun makes sensing pay. Today every cell carries the six existing reactions from step 0 at
no cost, so the succession is invisible. Eating is not among them: it is new physics, and that
neighbours' biomass would make it pay once bodies are dense is a hypothesis. With genes
and a cost, the ecology's succession can become the story, if the costs are such that genes are
gained when they pay and shed when they do not. That is the thing to test first, on the smallest
version: two capabilities, a cost, several seeds, and the question whether acquisitions happen,
spread and persist. Cheaper still, before any genome machinery: the world-wide rate constants can
already switch a reaction off for everyone, so hand-built capability sets (photosynthesis and
growth alone; with respiration; with decomposition) can be run under the existing rules to
measure survival, the free-energy balance and the reaction fluxes of each rung. If the bottom
rung cannot live, the ladder has no first step.

**Declared.** What a lineage can do. Cells and bodies stay inferred, so individuals and
reproduction are still results of the physics, as in the lab.

**Cost.** A physics change: a genome word for the gene set (a layout change; the ring review
found about ten consumers of `Genome` that must carry a new word), a per-gene maintenance cost in
`react`, reactions gated by their gene, a mutation operator for gene bits at a lower rate than
weight mutations, the WGSL twin of all of it, and new golden cases. It cannot leave RULE_VERSION 1
pins untouched, so it is a game kernel with its own version line, or RULE_VERSION 2. Weeks, and a
Codex pass on the parity.

**Evidence.** Avida: rewarding tasks with energy evolves complex functions that build on
simpler ones, with no single intermediate strictly required (§6, item 2). In this repo, nothing
yet: the role inference detects role dominance at a census, not inherited acquisition; and the
ecology-first search's 209 "obligate" genomes turned out to be founding-density specialists
(four times the seeding biomass rescued 11 of 12 representatives), so the record holds no lineage
shown to need another. Gene gating is meant to make such dependence common, and that is a
hypothesis.

**Risk.** Calibration. If a gene's cost is small, everything flips on at once and the ladder is
climbed in the first minute; if large, nothing flips and the world stays photosynthetic. Avida's
answer is mild rewards for intermediates and a rich reward at the top. The chemistry pays in
energy only (matter is closed), so a reward is an energy bonus or a feedstock the environment
supplies, never created matter. Eating is the hardest gene: nothing in the repo has shown
predation, and the eating rule itself (what is taken, at what cost, from whom) is a design in its
own right.

### 5.3 Epochs (designed regime shifts)

**Play.** The world moves through named ages, on a schedule, by the player's hand, or both: Dawn
(uniform dim light), the Long Day (a gradient), the Turning Sky (a sweeping sun, slow then faster),
the Seasons, the Wounds, the Meteor (one large lesion with a feed in its crater), the Flood and
the Drought (feed and drain everywhere), the Drift (tiles that begin to exchange migrants, or stop).
Each age opens a door; the game names the moment the population walks through it (role shares
shift, drive rises, bodies lengthen, turnover jumps), or the moment it fails to.

**What evolves.** Whatever each age pays for. What the record says: a sun's speed sets survival
(one seed per speed); one wandering-sun comparison of hand-built movers suggests sensing may pay,
and says nothing about sensing evolving; wounds raise turnover; seasons alone changed little.

**Declared.** Nothing in the physics. The ages are config over time.

**Cost.** The regimes exist one at a time, as worlds; the ages do not. A schedule fixed at
planting needs the step function to read its settings by step (seasons already do this for light,
but sun mode, injury and the rest are shader constants built with the pipeline), so it is a rule
change with golden cases even before any player touches it. Player-triggered ages are the "dial"
intervention of §3: pipeline rebuild or runtime parameters, transition validation, checkpoints
that carry the age, headless replay. A detector per door. Doses need a sweep: the storm first
look used one seed per lever. And the Meteor's feed, the Flood, the Drought and the Drift are
refused in pond worlds, so ages and the breeder need either a non-pond jar or a change to pond
matter accounting.

**Evidence.** The sun ladder and the storm's lethality (one seed each); wounds restoring turnover
(five seeds); outside, modularly varying goals promote modularity and speed adaptation (contested
replication), selective extinctions reshape communities where random culls do not, and POET's
lesson that environments must be kept barely passable and solutions moved between them (§6,
items 3 and 4).

**Risk.** Extinction, which a player experiences as a dead jar. The Flow-Lenia authors' own
later result is reported to say that dissipation and shared limited resources *lowered*
evolutionary activity in their system (a search summary, unverified against the paper); if so,
an age that only tightens scarcity may dull a world, and the design hypothesis here is that ages
should change what pays. Scripted stages were the thing critics held against Spore and Thrive:
the ages must open doors, not decide what comes through.

### 5.4 Two substrates (a field and creatures)

**Play.** The chemistry field stays the medium and the producers: the mat, the plants, the
waste, the recycling. Above it live declared creatures: small bodies of a few cells with a
position, a genome and a controller, that eat the field, eat each other, and die back into it.
Predation, chasing, body plans and herding live in the creature layer; the ecology and the sealed
jar live in the field. The Bibites and Biogenesis are the models.

**What evolves.** Creature controllers and bodies under predation, which the field alone has
not produced.

**Declared.** Creatures, outright. Matter still moves from field to creature and back, so the jar
stays sealed, but a creature is an object, not an inference.

**Cost.** A second kernel with its own determinism problem (agents must be ordered and their
collisions resolved with the counter PRNG, in integers), the coupling to the field in WGSL and
in the reference, conservation accounting across the two layers, a renderer, and every observer
taught about the second population. The largest shape by far.

**Evidence.** Practitioner, not published: the Bibites report emergent predation and parasitism
with brains and genes that both mutate; Biogenesis and EvoLife are the same architecture. The
research pass found no published hybrid that switches between a field and agents.

**Risk.** It becomes a different game that happens to sit on the field, and the field's elegance
(one rule set, two implementations, bit for bit) is diluted. The practitioner record also warns
that differentiation and multicellularity do not come for free even with declared cells (Thrive's
multicellular stage has only budding; EEvol's developer sees filaments and no differentiation).
Keep it as the fallback for predation if §5.2's eating gene fails in the field.

### 5.5 Named species (the board)

**Play.** The jar's living things have names, portraits and a family tree. Species are clusters
of lineages by genome distance at a stated tolerance; a species persists across censuses, is
named once (by the game or the player) and passes its name to descendants; it splits when a
cluster divides and both halves last; it goes extinct when no living genome of it remains
(bodies hold only 15% to 48% of occupied cells; a species whose last countable body dies but
which lives on as film has "gone to film", a different event). The event log is
the game's story: speciations, extinctions, firsts, a dominance change. A "keep" on a species
makes the game stop at its last stand so the player can intervene, or just watch it go.

**What evolves.** Nothing new; this shape is how the player *sees* what the others make happen.

**Declared.** A species boundary, which is a tolerance on genome distance and a persistence
rule, stated on screen as the catalogue states "seen, not measured."

**Cost.** Observer work, and more than it looks: the existing genetic clustering works on genome
slots and its cluster ids are not stable from one frame to the next, so species need
longitudinal matching across censuses, split and merge rules, names that follow the match, and a
distance tolerance validated on evolved populations (within one founder's clade neighbours
differ by up to all 42 words at the 90th percentile). Then the tree panel and portraits (the
lineage inspector already renders a genome's probe); the lab's Lineages view already colours the
jar one colour per lineage. "Extinct" must distinguish the last countable body dying from a
lineage that lives on as film. No physics.

**Evidence.** Purity makes "this body is that lineage" sound; the boundary between species is a
design choice the numbers above constrain but do not settle. The Bibites' catalogue of
legibility devices (auto-tracked species, inherited names, favouriting, lineage tree, a lineage
mesh of relative populations, spatial distribution) is the best outside record of what players
use.

**Risk.** Over-claiming: an inferred cluster named like a species is a claim the catalogue's
honesty rule would flag. State the rule and the purity. A taxonomy that misfires (a species that
"dies" and "reappears") confused at least one Bibites player; persistence rules must be strict.

## 6. Devices that force evolution, with the evidence behind them

From the techniques research pass (abstracts and project pages; items marked unverified rest on
search summaries). Ranked by how much evidence they have and how cheaply they graft onto this
chemistry.

1. **A size-dependent selective force, clonal offspring, a bottleneck.** Settling selection on
   yeast produced branched multicellular clusters in about two months; the clusters are clonal and
   propagate through single-cell bottlenecks. Avida's Volvocales models evolved germ and soma when
   survival and reproduction traded off. The pond cycle already supplies nearly clonal packets
   (measured, not enforced) and a bottleneck, and packet mass already filters founding. What is
   missing is a force in the field that favours *size or attachment* within a cycle: a current
   that carries thin film out of the lit zone and leaves heavy bodies, or a packet draw that
   favours one attached body over a scatter. Either is a new optional rule and new runs, outside
   the frozen scaffold registration (which excludes claims beyond its regime and any reproduction
   result). What it would test is attached propagules under an imposed cycle: whether a size
   force makes packets one body and bodies larger (the census's size distribution, the share of
   packets that are one body). That is not the north star's fourth item, which asks for a
   collective that reproduces as a unit *by itself*; the registration says in so many words that an
   imposed life cycle does not meet it. It is the cheapest step this note can see toward it, and
   "the first colony" in the game would mean the propagule result, said plainly.
2. **An energy-paid ladder of rewarded capabilities, with mild intermediate rewards.** Lenski,
   Ofria, Pennock and Adami: complex functions evolve when simpler ones are rewarded too, no
   single rung is mandatory, and some deleterious steps become stepping stones. Goldsby's
   task-switching cost evolved division of labour between genetically identical neighbours, who
   then could not replicate alone. The passes found no application to a chemistry CA; the chemistry-native
   form is §5.2's genes with a maintenance cost, or a reward for a multi-step conversion completed
   inside one body. Risk: organisms game the detector.
3. **Staged environments kept barely passable, with transfer between them.** POET co-evolves
   environments and agents and moves stepping-stone solutions across; many of its environments
   could not be solved by direct optimisation or a straight curriculum. Minimal criterion
   coevolution does it with no fitness function at all. The game analogue is the player (or a
   generator) as the environment, and ponds or islands as the places solutions move between. Not
   tested on Lenia.
4. **Varying what pays, and selective rather than random extinctions.** Modularly varying goals
   evolved modular networks that adapt fast (one failed replication attempt on record). In Avida,
   extinctions that change the environment reshape recovery where random culls do not. A game
   should offer both a meteor and an ice age, and expect them to differ. Cheap: a schedule on
   existing config.
5. **Offline search to choose the constrained region and the founders.** Leniabreeder
   (quality-diversity on Lenia), curiosity-driven exploration of Flow-Lenia, and ASAL (a
   vision-language model as the judge) all find more varied starts than random search; the M3
   MAP-Elites search is this project's version. It finds interesting starts and does not drive
   evolution, so it is a tool for designing the game's worlds, not a mechanic in them.

Two warnings from the same pass. Evoloops (Sayama) show the default fate of evolving replicators
in a CA: selection converges on the smallest, fastest form. That is what erosion and the shrinking
bodies under movement breeding look like here, and it is why this note's design hypothesis is
that every capability the game wants must be paid for by the environment. And the Flow-Lenia
authors' later paper is reported to find *less* evolutionary activity under dissipation and food
limits than in the plain system (unverified against the full text), which would match the
plateau and would argue that an age should change goals, not just scarcity.

## 7. What other games got right and wrong

From the games survey (Steam pages, devblogs, reviews; single comments marked as such).

**What makes evolution legible and fun to a watcher.**

- *Species you can name, that survive extinction scares.* The Bibites auto-track species, let you
  name one, pass the name to descendants, and let you favourite a species so near-extinction
  relatives merge into it and it stays in the record.
- *Several views of one history.* Species: Artificial Life offers a tree of life, a clade
  diagram, a satellite map and a gene-diversity web. The Bibites add a lineage mesh of relative
  populations over time and a spatial distribution view.
- *Prediction before you act.* Thrive's editor shows the predicted population while you edit
  (search-only), tying a visible choice to a visible result. For this project the honest form is
  a replay twin of a different choice, side by side.
- *Build the rules up one at a time.* Primer's videos explain selection by adding one rule per
  episode. Nothing tests it inside a game, but it is how the catalogue already explains worlds.
- *Visible traits.* The Bibites' appearance follows its genes; Niche surfaces dominant and
  recessive genes as play.

**What produces staged phase changes, in games.**

- Player-triggered or scheduled regime shifts: Species' ice ages and floods and its rovers that
  decide who eats; Thrive's patch events; Gene Pool's ecology panel and migration wall; Cell Lab's
  changeable environment with populations re-adapting.
- Unlock ladders tied to challenges: Cell Lab's 45 challenges unlock genes; the Bibites have
  challenge levels; Cell to Singularity is an idle ladder of milestones with a prestige reset.
- Hard stage changes: Spore's five, Thrive's nine planned (one complete after four years of Early
  Access, with the developers' own estimate of about ten years to finish).
- Roguelite restarts with an inherited bloodline (Niche).
- **The survey found no independently verified case of a new body plan, multicellularity or
  predation emerging from a forced pressure.** The stages are scripted, or the emergence is a
  developer's claim (the Bibites on predation and parasitism). The passes were limited and
  nothing was tested first hand, so this is a gap in the record, not a proof of absence; either
  way the passes turned up no verified recipe for such a transition to copy.

**Failure modes, each one a design rule here.**

| Failure | Where it was seen | Rule for this game |
| --- | --- | --- |
| The editor replaces evolution | Spore ("intelligent designer," its designer's words); Equilinox's mutation button | No creature editor. The player sets pressures and ages; the world designs. |
| The stages are scripted | Spore, Cell to Singularity | Ages open doors; firsts are detected, never scheduled. |
| The same winner every time | Species: Artificial Life (player comment) | Seeds and founders vary; the catalogue's ensembles already measure spread. |
| Nothing visibly changes | The Bibites ("only the colour," one comment); EvoLife ("needs a guiding hand") | A pressure the chemistry cannot meet must say so, fast; the firsts log is the proof of change. |
| Everyone dies | Gene Pool's own notes; the storm here | Doses stated and bounded; a jump back is one click. |
| No stakes | Keiwan's Evolution (by design) | A session card, a keep on a species, firsts that are hard to reach. |
| A lesson, not a game | Niche (6/10 twice: "a better science lesson than game") | Watching has to be the pleasure, so the jar comes first and the panels second, as the lab already lays out. |
| Careful mutation is not engaging | Spore's early prototypes, per its designer | Pace: a visible change per minute, which the breeder's rate allows. |

## 8. Recommendation: a staged ladder

**Stage 0a: the test before the build. Nothing to build.** The lab's Breeder panel already
stops at each cycle, ranks ponds by a chosen measure, offers "Top quarter" and "The rule's
choice", lets a person pick, and logs every pick. Put three people in front of the `breeder`
world for ten minutes each, with the Lineages view on, and ask afterwards what happened. This
measures enjoyment and comprehension only: pass if each can name a change they saw and wants to
play again; fail if they describe a lattice or nothing. Whether their choices *caused* anything
is a separate question (reordering four donors changes a history), answered by matched rule and
random pickers across several seeds on the same preset, which `tools/run.ts --picker` can run
headless. Cost: an afternoon and some GPU time.

**Stage 0b: Pond keeper, in the lab. No physics, no pins.** Shapes 5.1 and 5.5, built on what
Stage 0a's people could not see.

- A pressure the player chooses at each cycle (the existing score terms, plus elongation and
  sensing if cheap), logged as a pick-style intervention so replay holds.
- A firsts log with stated rules (first moving pond, first body over a threshold, first long body,
  first role-dominance change that persists for some censuses, first pond to outlive a wound).
- A family tree with named clusters and their purity, with the longitudinal matching §5.5 costs.
- A session card at ten minutes: what was bred, how far, what died, and a versioned manifest
  export (config, initialisation, rule version, observer settings, ordered interventions) that the
  headless runner can replay.
- *What fun looks like:* Stage 0a's test again, with the added question whether the firsts log
  and the tree are what people point at when they say what changed.
- *Cost:* days to a couple of weeks, mostly the detectors, the per-cycle pressure and the tree.

**Stage 1: Tracks, under a game kernel. The physics bet.** Shapes 5.2 and 5.3.

- First, with no genome work at all, the rung check of §5.2: hand-built capability sets under
  the existing rate constants, several seeds, measuring survival, the free-energy balance and the
  reaction fluxes of each rung. Then the smallest genome version: one gainable capability on top
  of the starting set, a maintenance cost, several seeds, and the question whether acquisitions
  happen, spread and persist, with a failure criterion written before the run. Only then the full gene set, a schedule of ages at planting, and
  player-triggered ages as logged dials.
- Its own rule version line, new golden cases, CPU and WGSL parity, a Codex pass. The lab's
  RULE_VERSION 1 worlds are untouched.
- *What fun looks like:* in ten minutes without the player, the world climbs at least two rungs
  (say decomposition, then polymer building) in most seeds and the log names each; with
  the player, the rungs and their order differ by the ages chosen; and at least one world shows a
  door the population fails to pass, which is a story too.
- *Cost:* weeks. The eating gene is its own sub-project and may not work in the field.

**Stage 2: Creatures, only if needed.** Shape 5.4, for predation and body plans, if the eating
gene does not produce chasing and being chased in the field. Months.

**In parallel, as a separate exploratory follow-up:** the snowflake move (§6, item 1) in the
pond cycle, a size-or-attachment force within a cycle, built as an optional rule key, run on new
seeds and read by the scaffold line's own instruments plus a stated propagule test (§6, item 1).
It sits outside the frozen registration and claims nothing for it, and it tests attached
propagules under an imposed cycle, not the north star's endogenous transition. The game would get
"the first colony" from it if it works, meaning exactly that.

**Not recommended as a first move:** a creature editor, parameter sliders over the raw physics
(μ, σ, rate constants: a player cannot read them, and the catalogue's rule is to explain levers in
audience terms), or the full storm.

## 9. Decisions for the user

1. **Fork or next phase.** Is the game a sibling of the lab with its own kernel line that may
   declare things, with the lab's north star untouched? Or does the lab itself take the turn, and
   "never declared" is retired?
2. **How much to declare.** Nothing new (Stage 0 only), capabilities (Stage 1), cells (the
   declared-cell worlds, built and in the catalogue under "Shape and cells"), or creatures
   (Stage 2).
3. **Which prototype first.** Stage 0a, an afternoon, no code, and it tests whether watching
   bred evolution is fun before any physics is written; or straight to tracks, the bigger bet, on
   the argument that the breeder's lattice-of-dots will not hold anyone's attention.
4. **What the player may touch.** Pressures and ages only ("slightly interactive"); plus the
   existing brushes (lesion, feed, drain); plus donor picks by eye. Anything more is a god game.
5. **Solo jar or shared garden first.** The breeder works in one browser today; ages do not
   exist yet in any form. The shared garden (bet 4) would make ages the commons' events and
   species the things people name together; it needs the coordinator to carry the `breed` arm and
   the dial interventions, which it does not.

## 10. Provenance

Written from `docs/plan.md` (north star, six decisions, M4 pivot), `docs/reassessment-2026-09-30.md`,
`docs/rules.md`, `docs/sandbox-ownership.md`, `docs/sandbox-cells.md`, `docs/sandbox-wild.md`,
`docs/sandbox-feed.md`, `docs/naturalist-brainstorm-2026-10-07.md`, `apps/lab/src/worlds.ts`
(families, notes, start-here), `apps/lab/index.html` (the leads and the five bets),
`packages/schema/src/genome.ts`, `packages/schema/src/config.ts`, `packages/schema/src/presets.ts`,
`packages/metrics/src/ecology.ts`, `PRODUCT.md`, `DESIGN.md` and `CONTEXT.md`; and two read-only
research passes on 2026-10-16, one over evolution games and playable simulations (Spore, Thrive,
Cell Lab, Niche, Keiwan's Evolution, Ecosystem, Equilinox, Planetary Life, the Bibites, Species,
Gene Pool, Biogenesis, EvoLife, Primer, Cell to Singularity, Lenia and Particle Life toys) and one
over techniques (Avida and Lenski's task rewards, Lenia and Flow-Lenia and their search tooling,
Leniabreeder, curiosity-driven Flow-Lenia, ASAL, neural CA, primordial particle systems, GRN
morphogenesis, snowflake yeast and Avida's germ-soma and task-switching results, MAP-Elites,
minimal criterion coevolution, POET, modularly varying goals, Bak–Sneppen, Avida extinctions,
Evoloops, the Bibites and Biogenesis). The passes worked from abstracts, store pages and devblogs;
their unverified items are marked above. No simulation was run and no code was changed.

One read-only Codex Sol 6.1 High pass on the first draft, nineteen findings, all taken: the
ecology-first "obligate" pool had been cited as interdependence when the plan records it as a
density effect; the colony follow-up had been placed inside the frozen registration; pond packets
had been called clonal when they are sampled windows measured nearly clonal; the sun-speed ladder
and the wandering-sun comparison had been fused into one result; ages had been described as
working today; the breeder's trait evidence disagreed between the shape and its risk; the body
purity range had dropped the genome arms' lower values; the tracker's life events had been
overlooked; feeds and migration are refused in pond worlds; "seed plus log" understated what a
replay needs; pacing had crossed the 64-pond measurement with the 16-pond preset's cycle time;
relaxed selection had been stated as a mechanism its own test did not support; the novelty picker
had been judged against an objective it was not given; "worms do not hold" was a conclusion the
source does not draw; species had been priced as if the clustering were stable; role inference had
been called succession; capability gating had been called reliable rather than identifiable; the
survey's gap had been called a proof of absence; and Stage 0 had skipped the test the existing
Breeder panel allows. The pass also found that the controller already scales every reaction,
which §3 now says.

A second pass on the corrected note: fifteen of the nineteen held everywhere, four had regressed
in other passages (the sun lead in §5.3, pacing in §5.1, the survey gap in the summary and §6,
replay's limits in §1) and are now carried through, and eight new findings, all taken: eating had
been listed among the existing reactions; the species extinction rule contradicted the film
caveat; the colony follow-up had been pointed at the north star's endogenous transition when it
tests attached propagules under an imposed cycle; Stage 1's starting life could not fund its
maintenance without respiration, and the rungs can be tried with the existing rate constants
before any genome work; the lab manifest reconstructs only step-zero starts; and three
overstatements of what the research passes can say.

## Rung check (2026-10-16)

Stage 1's first step (§5.2, §8), run headless on the local GPU with no rule change, no golden pin
touched and no file under `packages/` or `tools/` changed. The question: can each rung of a
capability ladder live on its own when the world-wide rate constants switch the other reactions
off for everyone? Posture: exploration, no paid compute, nothing committed.

**Arms.** All on the `gradient-m3` preset (RULE_VERSION 1, 256², light gradient 20 + 220, the 12
M3 founders, mutation on) with only the rate constants below changed. The note's proposed starting
life (photosynthesis, respiration and growth) is **arm b**; arm a is one rung *below* that floor.

| arm | capability set | kPhoto | kResp | kDecomp | kGrow | kBuild | kEmit |
|---|---|---|---|---|---|---|---|
| a | photosynthesis + growth | 160 | **0** | **0** | 128 | **0** | 64 |
| b | + respiration (the note's floor) | 160 | 128 | **0** | 128 | **0** | 64 |
| c | + decomposition | 160 | 128 | 96 | 128 | **0** | 64 |
| d | control: preset unchanged | 160 | 128 | 96 | 128 | 64 | 64 |
| a′ | arm a with signal emission off too (extra, beyond the brief; added before any result was read) | 160 | **0** | **0** | 128 | **0** | **0** |

Three seeds (1, 2, 3) per arm, 200,000 steps, census every 5,000 (40 rows per run), every census
deep, no checkpoints. Twelve runs in the brief plus three for a′, 70 to 115 s each on the Mac
(1,700 to 2,900 steps a second).

**How they were run.** `tools/run.ts --override` only admits `mutRate` and `pondDeath`, so the
runs went through `@bl/runner`'s `runExperiment` from a 70-line Deno script that builds the same
`RunSpec` the tool builds and puts the rate constants in `RunSpec.overrides` (a
`Partial<WorldConfig>`, applied last by `specConfig`; the manifest's `cfg` records them). The
script and the pre-stated rule sit beside the bundles at `runs/evolution-game/rungs/` (gitignored,
main checkout). Its substance, so this section stands without it:

```ts
// rungs.ts: deno run -A --config deno.json rungs.ts --arm a|b|c|d|a-noemit --seeds 1-3 --steps 200000 --census 5000 --out <runs>
const ARMS = {
  a: { kResp: 0, kDecomp: 0, kBuild: 0 },
  b: { kDecomp: 0, kBuild: 0 },
  c: { kBuild: 0 },
  d: {},
  "a-noemit": { kResp: 0, kDecomp: 0, kBuild: 0, kEmit: 0 },
};
const spec: RunSpec = {
  experiment: "evolution-game", presetId: "gradient-m3", condition: "treatment", seed,
  steps: 200_000, censusEvery: 5_000, deepEvery: 1, checkpointEvery: 0,
  overrides: ARMS[arm], runId: `evolution-game/rungs/${arm}/seed-${seed}`,
};
// validateSpec(spec), validateConfig(specConfig(spec)), then
// runExperiment(device, spec, fsSink(`${out}/${spec.runId}`), host, log)   — as tools/run.ts does
```

```bash
cd <checkout>
for arm in a b c d a-noemit; do
  deno run -A --config deno.json runs/evolution-game/rungs/rungs.ts --arm $arm --seeds 1-3 --steps 200000 --census 5000 --out /Users/nicholas/develop/browser-life/runs
done
# the control re-run through the sanctioned tool, same observer settings, to check the script changes nothing:
deno run -A tools/run.ts --experiment rungs-verify --preset gradient-m3 --conditions treatment --seeds 1 --steps 200000 --census 5000 --deep 1 --out <scratch>
```

**Pre-stated rule** (written to `rule.md` before the first run; amended once, before any result
was read, to add the B-alone column, count emission in E spent, and add a′):

- LIVES: at step 200,000, at least one census individual (a connected component of cells with
  B + P ≥ 48 whose total mass is ≥ 256) in at least 2 of 3 seeds, **and** the arm's mean bound
  mass (world B + P) at 200,000 is at least 10% of the control arm's mean.
- DIES: no individual at 200,000 in at least 2 of 3 seeds.
- UNCLEAR: anything else.
- FUNDED (secondary, descriptive, not part of LIVES): over the last ten censuses the median E
  pool is above zero and the mean starvation flux is under 10% of the mean photosynthesis flux.
  A rung can live without being funded: starvation turns biomass to waste only as fast as the
  maintenance bill asks, and photosynthesis replaces biomass from light alone.

All numbers come from each run's `series.jsonl` (no new instrument). "Living cells" are cells
carrying a lineage id, which says nothing about their energy. Heat is not written per census, so
it is derived exactly from the ledger's invariant (photosynthesis flux × (eB − eA) minus the change
in energy content, A·eA + B·eB + C·eC + P·eP + E + S), under the `conservationOk` flag the runner
checks at every census; it read exact on every row of every run.

**Per arm and seed, at step 200,000.** Living cells are cells with a lineage id; individuals are
census components with mass ≥ 256; starve/photo and median E are over the last ten censuses.

| arm | seed | individuals | living cells | lineages | B+P | B | E pool | starve/photo (last 10) | median E (last 10) | mutations | fissions | conservation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a | 1 | 89 | 14,916 | 86 | 700,196 | 700,196 | 0 | 0.921 | 0 | 22,295 | 152 | exact | complete |
| a | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0.000 | 0 | 26 | 0 | exact | complete |
| a | 3 | 119 | 6,347 | 76 | 446,755 | 446,755 | 0 | 0.920 | 0 | 13,528 | 1 | exact | complete |
| b | 1 | 265 | 15,761 | 211 | 902,448 | 902,448 | 2,245,739 | 0.010 | 2,504,455 | 43,220 | 10 | exact | complete, funded |
| b | 2 | 211 | 20,878 | 199 | 772,655 | 772,655 | 1,176,096 | 0.182 | 1,402,430 | 36,451 | 0 | exact | complete |
| b | 3 | 256 | 15,664 | 268 | 836,316 | 836,316 | 2,771,723 | 0.002 | 2,756,636 | 46,587 | 20 | exact | complete, funded |
| c | 1 | 263 | 62,032 | 103 | 1,852,500 | 1,852,500 | 1,629,782 | 0.530 | 1,435,802 | 77,295 | 18 | exact | complete |
| c | 2 | 466 | 40,596 | 415 | 2,066,841 | 2,066,841 | 543,754 | 0.652 | 640,204 | 145,332 | 26 | exact | complete |
| c | 3 | 623 | 51,745 | 311 | 2,287,292 | 2,287,292 | 4,880,236 | 0.164 | 5,117,015 | 123,918 | 17 | exact | complete |
| d | 1 | 623 | 42,741 | 507 | 2,291,808 | 2,288,735 | 4,002,454 | 0.067 | 4,241,671 | 88,450 | 16 | exact | complete, funded |
| d | 2 | 375 | 39,373 | 444 | 1,942,836 | 1,935,819 | 35,177 | 0.816 | 30,898 | 169,880 | 29 | exact | complete |
| d | 3 | 573 | 40,518 | 387 | 2,173,439 | 2,116,636 | 1,496,634 | 0.482 | 1,618,364 | 122,507 | 74 | exact | complete |
| a-noemit | 1 | 217 | 12,081 | 188 | 701,499 | 701,499 | 0 | 0.923 | 0 | 28,378 | 23 | exact | complete |
| a-noemit | 2 | 103 | 3,499 | 108 | 360,330 | 360,330 | 0 | 0.932 | 0 | 24,509 | 0 | exact | complete |
| a-noemit | 3 | 135 | 5,233 | 143 | 529,965 | 529,965 | 0 | 0.926 | 0 | 26,645 | 2 | exact | complete |

**Verdicts against the pre-stated rule** (as the reader script printed them).

- **a (photo+grow)** LIVES: 2/3 seeds with individuals at 200,000; mean bound mass 382,317 = 17.9% of control's 2,136,028; funded in 0/3
- **b (+respiration)** LIVES: 3/3 seeds with individuals at 200,000; mean bound mass 837,140 = 39.2% of control's 2,136,028; funded in 2/3
- **c (+decomposition)** LIVES: 3/3 seeds with individuals at 200,000; mean bound mass 2,068,878 = 96.9% of control's 2,136,028; funded in 0/3
- **d (control)** LIVES: 3/3 seeds with individuals at 200,000; mean bound mass 2,136,028 = 100.0% of control's 2,136,028; funded in 1/3
- **a′ / a-noemit (photo+grow, kEmit 0, extra)** LIVES: 3/3 seeds with individuals at 200,000; mean bound mass 530,598 = 24.8% of control's 2,136,028; funded in 0/3

**Time course** (individuals / living cells / B+P / B / E pool).

| arm | seed | t=0 | t=5,000 | t=25,000 | t=50,000 | t=100,000 | t=150,000 | t=200,000 |
|---|---|---|---|---|---|---|---|---|
| a | 1 | – | 16 / 2,838 / 90,073 / 90,073 / 0 | 14 / 3,803 / 102,930 / 102,930 / 0 | 15 / 3,750 / 103,658 / 103,658 / 0 | 19 / 4,106 / 114,800 / 114,800 / 0 | 73 / 12,241 / 595,004 / 595,004 / 0 | 89 / 14,916 / 700,196 / 700,196 / 0 |
| a | 2 | – | 0 / 190 / 1,438 / 1,438 / 0 | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| a | 3 | – | 27 / 2,148 / 125,399 / 125,399 / 0 | 27 / 4,526 / 155,503 / 155,503 / 0 | 19 / 4,635 / 138,123 / 138,123 / 0 | 22 / 3,871 / 121,412 / 121,412 / 0 | 20 / 4,417 / 134,417 / 134,417 / 0 | 119 / 6,347 / 446,755 / 446,755 / 0 |
| b | 1 | – | 69 / 4,831 / 237,408 / 237,408 / 810,060 | 135 / 7,305 / 510,087 / 510,087 / 1,974,329 | 146 / 7,063 / 561,547 / 561,547 / 2,195,232 | 171 / 9,088 / 646,733 / 646,733 / 2,374,402 | 186 / 10,157 / 704,965 / 704,965 / 2,500,480 | 265 / 15,761 / 902,448 / 902,448 / 2,245,739 |
| b | 2 | – | 28 / 1,177 / 100,676 / 100,676 / 364,534 | 52 / 3,977 / 207,350 / 207,350 / 691,225 | 129 / 6,845 / 449,170 / 449,170 / 1,503,640 | 177 / 6,579 / 623,528 / 623,528 / 2,111,157 | 215 / 7,706 / 727,587 / 727,587 / 2,253,041 | 211 / 20,878 / 772,655 / 772,655 / 1,176,096 |
| b | 3 | – | 91 / 6,936 / 318,707 / 318,707 / 1,200,016 | 158 / 8,350 / 562,706 / 562,706 / 2,191,787 | 157 / 7,715 / 587,767 / 587,767 / 2,331,112 | 179 / 11,263 / 633,752 / 633,752 / 2,284,831 | 231 / 13,285 / 758,411 / 758,411 / 2,630,901 | 256 / 15,664 / 836,316 / 836,316 / 2,771,723 |
| c | 1 | – | 75 / 16,563 / 482,099 / 482,099 / 1,098,661 | 263 / 30,944 / 1,107,336 / 1,107,336 / 3,263,215 | 473 / 51,575 / 1,761,213 / 1,761,213 / 5,715,867 | 489 / 57,720 / 1,812,551 / 1,812,551 / 4,998,211 | 452 / 57,174 / 2,019,009 / 2,019,009 / 3,873,995 | 263 / 62,032 / 1,852,500 / 1,852,500 / 1,629,782 |
| c | 2 | – | 127 / 17,055 / 594,087 / 594,087 / 742,883 | 390 / 41,909 / 1,861,962 / 1,861,962 / 762,713 | 459 / 39,400 / 2,026,856 / 2,026,856 / 540,751 | 450 / 40,033 / 2,042,726 / 2,042,726 / 395,681 | 509 / 36,158 / 2,119,408 / 2,119,408 / 611,151 | 466 / 40,596 / 2,066,841 / 2,066,841 / 543,754 |
| c | 3 | – | 115 / 11,394 / 454,521 / 454,521 / 1,570,637 | 370 / 36,310 / 1,397,921 / 1,397,921 / 4,202,871 | 605 / 39,274 / 2,125,754 / 2,125,754 / 6,224,284 | 674 / 36,472 / 2,240,450 / 2,240,450 / 6,093,530 | 663 / 48,581 / 2,270,656 / 2,270,656 / 4,572,560 | 623 / 51,745 / 2,287,292 / 2,287,292 / 4,880,236 |
| d | 1 | – | 96 / 15,326 / 472,326 / 443,247 / 1,102,593 | 162 / 33,304 / 1,066,131 / 1,021,844 / 2,658,965 | 436 / 53,180 / 1,714,769 / 1,700,227 / 4,369,300 | 703 / 32,532 / 2,273,105 / 2,272,990 / 5,586,708 | 650 / 45,139 / 2,241,569 / 2,239,935 / 4,517,306 | 623 / 42,741 / 2,291,808 / 2,288,735 / 4,002,454 |
| d | 2 | – | 110 / 17,710 / 577,948 / 577,428 / 683,428 | 349 / 31,213 / 1,550,873 / 1,548,121 / 1,038,571 | 346 / 40,960 / 1,934,749 / 1,927,301 / 48,354 | 335 / 43,074 / 1,945,524 / 1,938,498 / 24,677 | 383 / 36,662 / 2,037,411 / 2,030,123 / 19,948 | 375 / 39,373 / 1,942,836 / 1,935,819 / 35,177 |
| d | 3 | – | 133 / 13,353 / 499,194 / 448,742 / 1,449,104 | 290 / 26,106 / 1,245,297 / 1,116,713 / 3,079,436 | 473 / 40,994 / 1,913,528 / 1,827,745 / 2,909,711 | 548 / 43,863 / 2,180,299 / 2,077,243 / 2,234,257 | 598 / 44,590 / 2,165,947 / 2,050,258 / 2,096,140 | 573 / 40,518 / 2,173,439 / 2,116,636 / 1,496,634 |
| a-noemit | 1 | – | 21 / 2,344 / 111,029 / 111,029 / 0 | 23 / 5,646 / 151,949 / 151,949 / 0 | 18 / 4,765 / 125,769 / 125,769 / 0 | 58 / 7,690 / 289,796 / 289,796 / 0 | 159 / 7,848 / 556,672 / 556,672 / 0 | 217 / 12,081 / 701,499 / 701,499 / 0 |
| a-noemit | 2 | – | 8 / 1,711 / 41,261 / 41,261 / 0 | 37 / 2,541 / 135,688 / 135,688 / 0 | 57 / 3,569 / 218,652 / 218,652 / 0 | 82 / 4,068 / 300,686 / 300,686 / 0 | 102 / 3,236 / 358,276 / 358,276 / 0 | 103 / 3,499 / 360,330 / 360,330 / 0 |
| a-noemit | 3 | – | 37 / 3,024 / 144,005 / 144,005 / 0 | 48 / 4,015 / 225,665 / 225,665 / 0 | 48 / 3,620 / 223,309 / 223,309 / 0 | 48 / 4,772 / 247,165 / 247,165 / 0 | 103 / 5,836 / 428,867 / 428,867 / 0 | 135 / 5,233 / 529,965 / 529,965 / 0 |

**Reaction fluxes**, mean over the last ten censuses (quanta per step), and the energy balance
(E income counts resp × 8 and decomp × 2; E spent counts grow × 10, build × 2 and emit × 1; heat
derived per step as above).

| arm | seed | photo | resp | decomp | grow | build | emit | starve | bdecay | abio | E income/step (resp+decomp) | E spent/step (grow+build+emit) | heat/step (derived) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a | 1 | 2,531.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 2,329.9 | 199.1 | 2,527.1 | 0 | 0 | 25,286 |
| a | 2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0 | 0 | 0 |
| a | 3 | 1,023.7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 941.9 | 75.5 | 1,011.4 | 0 | 0 | 10,162 |
| b | 1 | 2,323.9 | 2,192.1 | 0.0 | 137.1 | 0.0 | 1,006.1 | 23.1 | 241.9 | 2,456.2 | 17,537 | 2,377 | 23,202 |
| b | 2 | 2,160.3 | 1,547.8 | 0.0 | 0.0 | 0.0 | 2,668.5 | 393.5 | 218.2 | 2,159.6 | 12,382 | 2,669 | 21,617 |
| b | 3 | 2,442.4 | 2,455.5 | 0.0 | 259.8 | 0.0 | 333.8 | 4.5 | 240.7 | 2,700.0 | 19,644 | 2,932 | 24,404 |
| c | 1 | 3,536.8 | 1,129.2 | 3,193.8 | 20.4 | 0.0 | 3,415.6 | 1,874.0 | 557.3 | 366.5 | 15,421 | 3,620 | 35,448 |
| c | 2 | 4,053.4 | 4,272.0 | 7,269.8 | 3,501.4 | 0.0 | 5,130.2 | 2,644.1 | 639.8 | 286.0 | 48,716 | 40,144 | 40,547 |
| c | 3 | 5,193.9 | 3,914.2 | 5,359.6 | 272.9 | 0.0 | 6,221.2 | 849.3 | 703.0 | 107.2 | 42,033 | 8,951 | 51,931 |
| d | 1 | 4,653.7 | 3,720.2 | 4,626.3 | 79.0 | 1.9 | 8,257.6 | 310.9 | 698.7 | 105.5 | 39,014 | 9,051 | 46,537 |
| d | 2 | 3,981.7 | 5,059.0 | 8,606.8 | 4,928.2 | 7.5 | 3,759.3 | 3,249.7 | 595.5 | 304.7 | 57,686 | 53,056 | 39,835 |
| d | 3 | 3,981.9 | 3,577.4 | 6,008.9 | 2,219.3 | 81.3 | 4,141.5 | 1,918.9 | 622.2 | 192.2 | 40,637 | 26,497 | 39,831 |
| a-noemit | 1 | 2,612.5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 2,412.4 | 197.2 | 2,607.1 | 0 | 0 | 26,091 |
| a-noemit | 2 | 1,636.6 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1,525.8 | 110.8 | 1,636.5 | 0 | 0 | 16,366 |
| a-noemit | 3 | 2,116.5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1,960.4 | 154.1 | 2,112.5 | 0 | 0 | 21,141 |

**Readout against the rule.**

- **Arm b, the note's floor (photosynthesis + respiration + growth): LIVES, 3 of 3 seeds**, bound
  mass 39% of the control's, funded in 2 of 3 (the third sits at starve/photo 0.18 with E in the
  millions, which is "funded" by any looser reading). Respiration pays: E income of 12,000 to
  20,000 a step against 2,400 to 2,900 spent on growth and signal. The ladder has a first step.
- **Arm a, one rung below the floor (photosynthesis + growth only): LIVES by the rule, 2 of 3
  seeds, but never funded.** E is exactly zero from the first census on in every seed. There is no
  growth flux at all after step 5,000: what persists is a film that photosynthesis builds from
  light and starvation tears down at nearly the same rate (starve/photo 0.92), with the waste
  recycled abiotically. Seed 2 died by step 10,000. In seed 1 the film sat near 100,000 B for
  125,000 steps and then grew four-fold within two censuses (steps 125,000 to 135,000) and
  five-fold by 150,000, a jump
  consistent with a mutant lineage spreading; which mutation was not examined. So a
  photosynthesis-only life is possible here, but it is a starving film, not an organism that pays
  its way: a game that opens on it opens on something that cannot grow, build or move with intent.
- **Arm c (+ decomposition): LIVES, 3 of 3**, bound mass 97% of the control's. Adding decomposition
  brings bound mass to about two and a half times arm b's and the fluxes to the control's scale.
- **Arm d (control): LIVES, 3 of 3**, as expected. Polymer is a small part of its bound mass
  (0.1% to 2.6%), so the missing kBuild in a to c does not explain their shortfalls.
- **Arm a′ (extra; arm a with signal emission off too): LIVES, 3 of 3**, bound mass 25% of the
  control's, never funded, the same starving film (starve/photo 0.92 to 0.93, E zero throughout).
  It lives in seed 2, where arm a died: at the first census its biomass is thirty times arm a's
  there. Read this carefully. Once E is zero, emission (E → S) does nothing, so after the founders'
  starting energy is gone a and a′ run the same rules; what differs is where that energy went in
  the first few thousand steps (to signal, or to growth) and every chaotic consequence of it. Three
  seeds cannot separate "emission off lets the film establish" from "three different histories",
  and a′'s rows are in this section as three more histories of the photosynthesis-only film from
  the same three founder layouts (the seed fixes placement), not as three new seeds and not as a
  test of emission.

**FUNDED separates less than hoped.** The control itself is funded in only 1 of 3 seeds by the
stated marker (seed 2 holds its E near 35,000 with starve/photo 0.82), and arm c in 0 of 3: a
rich world spends its E down to the bone and starves at the margin by choice of its evolved
controllers, so a low E pool is not by itself a sign of want. The marker does its job only at the
bottom: arm a's E is not low, it is zero, and its starvation is the whole bill.

**What this does and does not say.**

- *Zeroing a rate constant is not lacking the machinery.* `react` charges the catalysis work on the
  sum of all six controller outputs, whatever each reaction's rate constant, and the maintenance
  bill is unchanged. A cell in arm a still pays work for respiration, decomposition and building
  outputs that make nothing. This biases every switched-off arm toward death, so a rung that lives
  here is a strong result; one that died would not have been conclusive.
- *The founders evolved under the full chemistry.* The 12 M3 genomes were selected with every
  reaction on, and mutation was on in these runs (up to 170,000 events per run). What was
  measured is whether a full-chemistry population can re-tune to each rung within 200,000 steps,
  not the rung in the abstract. The jump in arm a seed 1 is a reminder that the controller keeps
  evolving inside the arm.
- *Three seeds show 0/3 to 3/3 and nothing finer.* Arm a's 2 of 3 could be 1 of 3 or 3 of 3 on
  the next three seeds; its one death came early (by step 10,000) in a seed that held under 2% of the
  other seeds' biomass at the first census, which reads as a failure to establish (the founders'
  starting energy spent before a film formed) rather than a slow decline, but one seed shows one
  history, and a′'s seed 2 lived.
- *200,000 steps is a fifth of a registered history.* Whether arm a's film or arm b's funded
  population holds at 10⁶ steps was not tested. Arm c seed 1's individuals fell from 489 to 263
  between steps 100,000 and 200,000 while its bound mass held, which is a change in grain, not
  a decline, as far as these columns show.
- *No comparison between arms is a test.* The bound-mass shares (18%, 39%, 97%) are three seeds'
  means with no spread stated beyond the per-seed rows; they order the rungs and nothing more.
- *The control re-run through `tools/run.ts`* (same preset, condition, seed, steps and observer
  settings) is the check that the side script changed nothing: its manifest's `finalHash`
  (`9dba14341ca48505`), its `initHash` and its whole `series.jsonl` are byte-identical to arm d
  seed 1's.

**What it means for Stage 1.** The note's starting set is viable as it stands and does not need
rescuing; the ladder's first step exists under the current constants. The lower floor (light
alone) exists too, but only as a starving film, which argues for keeping respiration in the
starting set rather than making it the first gene to gain. The smallest genome version proposed in
§8 (one gainable capability over the starting set, a maintenance cost, several seeds, a failure
criterion written first) can start from arm b, with decomposition as the natural first gene: in
this check it was worth two and a half times the bound mass. That is what a whole population
gets when everyone has the reaction; whether one lineage that gains it among respirers is
favoured is a different question, and the one the genome version is for.

## Gene v0: the smallest genome version (2026-10-16)

Stage 1's second step (§8), following the rung check above: one gainable capability gene,
decomposition, over arm b's starting set (photosynthesis, respiration, growth; kBuild 0), on a
game kernel line that leaves every RULE_VERSION 1 pin untouched. This section was written in two
parts. The **design and the criterion** below were written before the first run (13:09); the
**readout** at the end was written after the six runs finished, against them, with the review
fixes to the design text noted there. Posture as before: exploration, local GPU only,
nothing committed, nothing landed.

### Design

**Kernel line.** Not a new `ruleVersion` (validateConfig pins that to 1 for every checkpoint and
the lab's whole catalogue) but a kernel flag in the style of every sandbox lever: three optional
`WorldConfig` keys, absent from `defaultConfig()` and from every preset, so a config that never
sets them serialises, hashes and steps exactly as before. `stateHash` and the checkpoint digest
hash the config's own JSON, which is why the keys are optional rather than defaulted to "off".

| key | meaning | bounds | gene-v0 value |
|---|---|---|---|
| `genes: "decomp"` | the gene set: bit 0 of the gene byte is decomposition; nothing else is gainable yet | the one named set | `"decomp"` |
| `kGene` | maintenance per carried gene, kGene/65,536 of B per step, paid in E like kMaint (starvation when E runs short) | 0..65,535 | 100 |
| `geneFlip` | share of mutation events that flip a gene bit instead of nudging a weight, geneFlip/2³² | 0..2³²−1 | 2²⁶ (1 in 64) |

Set together. Exclusive with `shapeReach` (which owns PARAM1's bytes 1..3) and with `neutral`
(every cell would express the reference genome, whose gene byte is 0, so the gene could never be
gained).

**Where the bit lives.** §3 is right that the genome has no free word; it has a free byte. PARAM1
is the motility gain in byte 0, and bytes 1..3 are the heritable kernel-ring offsets of the
`cells` sandbox, zero in every RULE_VERSION 1 genome (`ringsOf` treats absence and (0, 0, 0) as
one genome). Byte 3 (bits 24..31) is the **gene byte**; bit 0 is decomposition; the other seven
bits are inert until a later gene set names them. The kernel reads the packed word
(`PARAM1 >>> 24 & 1`), so the ten `Genome` consumers the ring review counted are untouched by the
physics. `Genome` gains an optional `genes` field, and `decodeGenome` reads it **only when told
the config has genes** (a second argument); every existing caller decodes exactly as before, which
means a caller not yet taught the layout (the lab's inspector today) would show a carrier's gene
byte as a far-ring offset of +1. No lab world can plant genes yet, so none does; teaching the
config-aware consumers is part of any lab-facing version. `encodeGenome` refuses a genome that
sets both a far-ring offset and a gene byte, and the lineage inspector's mutation replay mirrors
the flip dispatch so a gain or loss reconstructs as itself. Genes are refused with declared cells
(`cellPeriod`), whose birth mutation never flips a gene. `canonicalGenome` and the state hash copy PARAM1
whole, so the bit rides in checkpoints and digests with no format change. Founders: every genome
in the M3 set has byte 3 = 0, so **every founder starts without the gene**, as the brief asks.

**The gate, in `react`.** A living cell with the gene runs decomposition exactly as RULE_VERSION 1
does (C → A + 2 E per quantum, capacity from the DECOMP controller output and kDecomp) and pays
one extra maintenance term, `mulFrac(B, kGene, 16, draw(RND.GENE))`, added to the cost before the
E ≥ cost test. A living cell **without** the gene skips the reaction and its DECOMP output is
left out of the catalysis work sum (`sumr`): the machinery is not there to pay for. This is the
one place the gene-off world differs from the rung check's arm b, which charged work on all six
outputs with kDecomp 0; the gene-off baseline is therefore "arm b minus one catalysis charge",
and arm b's 39% bound-mass figure is not this run's gene-off expectation. Arithmetic: the new term
is bounded like kMaint's (B ≤ 2²⁶, kGene ≤ 65,535, so `mulFrac` with s = 16 is exact), and the
cost sum stays under 2³² (the work term is under 2²⁹, the two maintenance terms under 2²⁶ each).
No new state, no new channel, one new flux-free draw purpose (`RND.GENE` = 38; purposes are
indexed, so nothing shifts).

**Mutation.** A mutation event (rate per newly synthesised quantum, as before) first draws
`RND.GENE_FLIP` (39): below `geneFlip` it flips bit 0 of the gene byte (gain or loss, symmetric)
and changes no weight; otherwise it nudges a weight, μ, σ or the gain as RULE_VERSION 1 does.
Either way it mints a new lineage id and a `mutations.tsv` row. With geneFlip = 2²⁶ one event in
64 is a flip. Arm b's runs logged 36,000 to 47,000 mutation events in 200,000 steps, so about
**560 to 730 flips a run** are expected, most of them gains early (everyone starts off) and both
directions once carriers exist. That is plenty for "acquisitions happen" to be well powered; the
question is spread and persistence.

**The cost, and why 100.** Costed against decomposition's *private* payoff, not against arm c's
whole-population gain. Per quantum decomposed a cell gets 2 E (eC − eA), against 8 for
respiration, and the A it makes is only partly private: growth runs after decomposition in the
same `react`, so fresh A can be grown on at once, but what is not is carried to neighbours by
diffusion (diffA 200/1,024 per side per step), payers and non-payers alike. Capacity at full
output is cat(B) × 127/128 × 96/4,096 ≈ 0.024 × cat(B) quanta a step; a cell of B = 50 (arm b
holds about 50 B per living cell) has cat(50) = 15 (14 after the ×127/128 of a saturated output),
so about 0.33 quanta and 0.67 E a step when
waste is there to take, about 0.013 E per B per step; a cell of B = 200 about 0.029. Arm b's
standing waste is 3 to 4 quanta per cell everywhere, replenished by diffusion, respiration and
decay. The population-scale figure from arm c, where everyone decomposed and the waste was shared
out, is 0.003 to 0.008 E per B per step (2 × decomp flux over world B). kMaint is 200/65,536 =
0.0031. **kGene = 100 (0.0015 E per B per step, half the maintenance bill)** sits below the
population-scale income and an order of magnitude below the private capacity, so a lone carrier
in waste should pay for its gene several times over, and a world of carriers should still cover
it, while a carrier in a waste-free spot (arm c's abiotic recycling fell tenfold once decomposers
took the waste) pays for nothing. If this is too cheap the null arm below says so; if too dear,
nothing spreads and the next version halves it.

**Arms.** All on `gradient-m3` (256², light 20 + 220, the 12 M3 founders, mutation on at the
preset's rate), kBuild 0 as in arm b, census every 5,000 with every census deep, `lineageObs` on
(so `genomes.tsv` records every lineage's genome when first counted and `profiles.tsv` its cells
and mass at every census), seeds 1, 2, 3, 200,000 steps.

| arm | genes | kGene | geneFlip | kDecomp | kBuild | what it tests |
|---|---|---|---|---|---|---|
| treat | "decomp" | 100 | 2²⁶ | 96 (preset) | 0 | the gene gates a reaction that pays |
| null | "decomp" | 100 | 2²⁶ | **0** | 0 | the same gene, cost and flips, gating a reaction that makes nothing: drift and hitchhiking alone |

The null is the control that separates "spreads because it pays" from "spreads anyway". Three
seeds a side is the brief's scale and shows 0/3 to 3/3 and nothing finer.

**Instruments** (all from the bundle, no new observer). A lineage's genome is immutable (a
mutation mints a new id), so `genomes.tsv` gives each lineage's gene bit once and `profiles.tsv`
gives its cells and mass at every census. *Gene share* at a census = carriers' living cells over
all living cells, and the same by bound mass; a world with no living cells has share 0.
*Acquisitions* = flip-on births: children in `mutations.tsv` whose own genome (when first counted)
has the gene and whose parent's does not (a founder's never does); flip-off births the other way;
a child never counted at a census, or whose non-founder parent never was, is unknown and is
reported as such, and only classified births count for HAPPENS. `series.jsonl` gives individuals, bound mass, E and the fluxes as in the rung check.

### Pre-stated criterion (written before the first run)

Share means gene share of living cells unless mass is named; "the last ten censuses" are steps
155,000 to 200,000.

- **HAPPENS**: in every treatment seed, at least one flip-on birth is counted at a census by step
  200,000.
- **SPREADS**: in at least 2 of 3 treatment seeds, the share reaches **≥ 25%** at some census.
  (The step of first reaching it is reported; under 25,000 is "in the first minute".)
- **PERSISTS**: at least 2 of 3 treatment seeds each satisfy SPREADS **and** hold the share
  **≥ 25% at every one of the last ten censuses**.
- **PAYS**: in each of the three seed pairs, the treatment's share at 200,000 exceeds the null's,
  and the null's share at 200,000 is **< 25%** in at least 2 of 3 null seeds.
- **PASS** = HAPPENS and SPREADS and PERSISTS and PAYS.
- **CONFOUNDED** = the null's share is ≥ 25% at 200,000 in at least 2 of 3 null seeds: whatever
  the treatment did, the gene spreads without paying; the cost is too low or the flip rate too
  high to read selection.
- **FAIL** = not CONFOUNDED and the treatment reaches 25% in at most 1 of 3 seeds: the gene is
  not favoured as built. The known reading to test next is the public-good leak (fresh A diffuses
  to non-payers), which a lower diffA or a local-A variant would discriminate; a too-dear cost is
  the other.
- **UNCLEAR** = anything else (for example SPREADS without PERSISTS, or PAYS failing in one pair).
- Descriptive, not part of the verdict: share by mass beside share by cells; bound mass and E of
  the treatment against the null (same seeds, so the same founder layout) and against arm b
  (whose work charge differs, see the design); flip-off births; whether carriers hold the lit or
  the dim end of the gradient (from `profiles.tsv` roles, if it is legible).

What three seeds cannot show is unchanged from the rung check. What this version cannot show at
all: whether a *second* gene would be gained on top of the first (the ladder), or anything about
a player.

### Readout (written after the runs, 2026-10-16)

Six runs, 13:18 to 13:28 on the Mac (M1 Max, 1,900 to 2,500 steps a second, 83 to 103 s each),
through `@bl/runner` from a script beside the bundles (`runs/evolution-game/gene-v0/gene.ts`,
`read.ts`, `rule.md` and `tables.md`, gitignored, in the main checkout's `runs/`), with the gene
keys in `RunSpec.overrides` as the rung check put the rate constants. Conservation read exact on
every row of every run. One review pass on the design text landed between the pre-stated rule and
this readout; it changed wording (the cat(50) figure, the decoder claim, the unknown-parent rule,
the PERSISTS quantifier, extinct share = 0), refused genes with declared cells, and taught the
lineage replay the flip. None of it touched the physics the runs used, the thresholds or the
arms; the pre-run copy is `rule.md` beside the bundles.

**Per arm and seed, at step 200,000.** Share is the gene share of living cells; "first ≥ 25%" is
the first census at or above the spread bar; "min, last 10" is the smallest share over steps
155,000 to 200,000; flip-on and flip-off births are the classified ones (a child and its parent
both counted at a census, or a founder parent) and "unknown" the rest.

| arm | seed | individuals | living cells | lineages | B+P | E pool | decomp flux (last 10) | share, cells | share, mass | carrier lineages | first ≥ 25% | min, last 10 | flip-on | flip-off | unknown | mutations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| treat | 1 | 148 | 43,354 | 52 | 1,199,134 | 1,148,480 | 1,279.8 | 99.4% | 99.1% | 50 of 52 | 35,000 | 99.2% | 4 | 19 | 39,753 | 41,105 |
| treat | 2 | 66 | 29,926 | 24 | 816,429 | 555,677 | 1,053.4 | 99.1% | 99.8% | 23 of 24 | 50,000 | 99.1% | 7 | 7 | 33,073 | 34,009 |
| treat | 3 | 45 | 42,230 | 29 | 1,240,796 | 964,678 | 1,195.3 | 98.9% | 98.9% | 26 of 29 | 75,000 | 98.9% | 11 | 13 | 44,122 | 45,745 |
| null | 1 | 257 | 17,877 | 190 | 1,008,675 | 2,448,746 | 0.0 | 2.2% | 2.2% | 8 of 190 | never | 2.2% | 21 | 1 | 41,092 | 42,806 |
| null | 2 | 276 | 9,519 | 270 | 908,746 | 2,062,749 | 0.0 | 7.5% | 7.4% | 23 of 270 | never | 5.3% | 32 | 8 | 34,771 | 36,862 |
| null | 3 | 264 | 14,977 | 247 | 811,195 | 2,838,885 | 0.0 | 7.4% | 8.0% | 21 of 247 | never | 7.4% | 26 | 5 | 45,758 | 47,637 |

**Against the rule, as the reader printed it.**

- HAPPENS: classified flip-on births in 3 of 3 treatment seeds (4, 7, 11; the first at steps
  19,731, 38,403 and 18,176). Most flips are never classified: about 40,000 mutation events a run
  mint lineages that no census counts, as in every run of this chemistry.
- SPREADS: 3 of 3, the share first ≥ 25% at steps 35,000, 50,000 and 75,000. None under 25,000,
  the frozen bar for "in the first minute"; by each run's measured speed those crossings came
  18, 25 and 36 seconds of wall clock into the run.
- PERSISTS: 3 of 3, the share never below 98.9% over the last ten censuses.
- PAYS: the treatment beats the null in 3 of 3 pairs (99.4% against 2.2%, 99.1% against 7.5%,
  98.9% against 7.4%), and the null is under 25% in 3 of 3.
- **PASS.** Acquisitions happen, spread and persist, and they do so only where the gated reaction
  makes something.

**Time course** (gene share of living cells / B+P).

| arm | seed | t=5,000 | t=10,000 | t=25,000 | t=50,000 | t=75,000 | t=100,000 | t=150,000 | t=200,000 |
|---|---|---|---|---|---|---|---|---|---|
| treat | 1 | 0.0% / 222,478 | 0.0% / 346,704 | 3.0% / 514,911 | 93.5% / 1,203,183 | 99.7% / 1,217,516 | 99.7% / 1,192,251 | 99.0% / 944,956 | 99.4% / 1,199,134 |
| treat | 2 | 0.0% / 109,006 | 0.0% / 107,127 | 0.1% / 363,684 | 37.7% / 1,131,220 | 86.0% / 1,149,846 | 99.3% / 1,279,617 | 99.7% / 1,109,606 | 99.1% / 816,429 |
| treat | 3 | 0.0% / 334,754 | 0.0% / 495,189 | 0.7% / 596,285 | 11.4% / 639,268 | 34.8% / 966,196 | 63.0% / 1,384,244 | 99.3% / 1,162,337 | 98.9% / 1,240,796 |
| null | 1 | 0.0% / 222,478 | 3.3% / 346,054 | 1.4% / 509,834 | 1.3% / 551,240 | 1.9% / 579,454 | 2.8% / 612,084 | 4.5% / 881,236 | 2.2% / 1,008,675 |
| null | 2 | 0.0% / 108,935 | 0.0% / 106,341 | 0.7% / 245,711 | 2.7% / 448,595 | 6.7% / 518,897 | 10.5% / 545,253 | 6.1% / 693,020 | 7.5% / 908,746 |
| null | 3 | 0.4% / 337,099 | 0.5% / 488,421 | 1.8% / 583,080 | 5.7% / 610,769 | 8.2% / 611,462 | 9.1% / 616,261 | 10.8% / 649,031 | 7.4% / 811,195 |

The share at every census, in percent, one run a line (the sweep is a logistic rise over 20,000
to 100,000 steps; the null sits at a mutation–selection balance of a few percent):

- treat 1: 0 0 0 1 3 15 51 73 86 94 98 100 99 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 100 99 100 100 100 100 100 99 100 100 100 99
- treat 2: 0 0 0 0 0 0 0 1 11 38 58 70 74 86 86 92 93 93 96 99 99 99 99 100 99 100 99 100 100 100 100 99 99 100 100 100 100 99 99 99
- treat 3: 0 0 0 1 1 1 5 7 8 11 13 17 19 24 35 33 50 53 66 63 80 84 88 95 95 95 100 100 100 99 100 100 100 100 100 100 100 100 100 99
- null 1: 0 3 1 2 1 2 1 1 1 1 1 2 1 1 2 2 3 3 3 3 3 4 5 5 5 4 4 5 8 4 6 8 5 4 4 4 3 2 2 2
- null 2: 0 0 0 0 1 1 2 2 2 3 4 4 6 6 7 6 8 8 8 11 9 8 9 7 10 9 8 7 8 6 5 7 7 8 7 6 8 7 7 8
- null 3: 0 0 1 1 2 3 4 5 5 6 6 6 6 7 8 8 9 9 9 9 9 10 11 11 11 13 14 13 11 11 10 9 9 9 9 10 9 8 8 7

**Fluxes**, mean over the last ten censuses (quanta a step; E income = resp × 8 + decomp × 2,
E spent = grow × 10 + emit).

| arm | seed | photo | resp | decomp | grow | emit | starve | abio | E income/step | E spent/step |
|---|---|---|---|---|---|---|---|---|---|---|
| treat | 1 | 2,110.5 | 1,343.2 | 1,279.8 | 0.0 | 2,072.4 | 401.4 | 825.7 | 13,306 | 2,072 |
| treat | 2 | 1,619.2 | 966.5 | 1,053.4 | 0.0 | 1,444.5 | 343.4 | 572.4 | 9,839 | 1,444 |
| treat | 3 | 1,846.3 | 1,156.2 | 1,195.3 | 0.0 | 1,658.6 | 327.6 | 649.6 | 11,640 | 1,659 |
| null | 1 | 2,410.9 | 2,208.8 | 0.0 | 98.8 | 262.9 | 12.7 | 2,507.4 | 17,670 | 1,251 |
| null | 2 | 2,452.3 | 2,178.3 | 0.0 | 1.3 | 3,850.6 | 22.6 | 2,447.6 | 17,426 | 3,864 |
| null | 3 | 2,364.5 | 2,435.2 | 0.0 | 301.8 | 307.4 | 6.0 | 2,660.7 | 19,482 | 3,325 |

**What the numbers say beyond the rule** (descriptive; three seeds).

- *A sweep, and it looks like one.* The treatment ends with 24 to 52 lineages against the null's
  190 to 270, and 23 to 50 of them carry the gene: a dominant carrier clade replaced most of the
  founders' descendants (carriers first appear in a census at steps 20,000, 25,000 and 20,000;
  walking each final carrier's ancestry in `mutations.tsv` up to the first gene-off parent finds
  one acquisition root in seeds 1 and 3 and three in seed 2, holding 20, 2 and 1 of its 23
  carrier lineages). That is the game's "carriers first exceeded a quarter of the living cells at step
  35,000 and now hold 99% of them", dated by a detector with a stated rule rather than by eye.
- *The gene paid for the lineage, not for the world.* Carriers' bound mass at 200,000 is 0.8 to
  1.24 million against the null's 0.81 to 1.01 million on the same founder layouts, about a fifth
  more on average and within the spread of three seeds; nowhere near arm c's 1.85 to 2.29 million,
  where everyone decomposed from step 0 under the full work charge. The carriers' world is
  poorer in other ways: two to three times the living cells but a sixth to a little over half of the census
  individuals (film, not bodies), an E pool of 0.56 to 1.15 million against 2.0 to 2.8 million,
  no growth flux at all over the last ten censuses, and starvation at 330 to 400 quanta a step
  against 6 to 23. Decomposition took the waste that light used to recycle (abiotic flux fell
  from about 2,500 to 570 to 830 a step) and photosynthesis fell with it. So the gene is favoured
  the way the design hoped (a lone carrier in waste pays its gene several times over) and the
  world that results is a decomposing film with less free energy. The design's lone-carrier
  arithmetic (a carrier in waste paying its gene several times over) is a capacity prediction
  these bundles do not measure; what they show is that the gene spread under it. Which of these
  a game wants is a design question the next version has to face: the cost and the reward decide
  what kind of life the ladder's first rung makes.
- *The null's few percent.* With flips at one event in 64 and kGene at half the maintenance
  bill, carriers in the null arm hover at 2 to 14% of living cells and never approach the bar;
  flip-on births were classified 21 to 32 times a run there against 4 to 11 in the treatment,
  where the sweep left fewer lineages for a census to count. That the cost is what holds them
  down (rather than drift alone) is the design's reading, not a measurement: it needs a kGene 0
  null to show. If it is the cost, it is mild enough that a cheaper gene might not be readable
  against drift.
- *Leakage did not prevent a PASS at diffA 200.* The fresh A a carrier makes still diffuses to
  non-payers; the runs do not isolate how much that cost the carriers. Whether a higher diffusion
  would stop the sweep, or a lower one speed it, is untested.
- *Not in the first minute.* 35,000 to 75,000 steps to a quarter and 60,000, 100,000 and 135,000
  to the first census at or above 99%, about half a minute to a minute of wall clock at these
  runs' speed. The rate was not tuned; geneFlip and kGene are the two dials, and this version
  turned neither.

**What this does not say.** Three seeds show 3/3 and nothing finer; 200,000 steps is a fifth of
a registered history and the sweep's aftermath (the film at 99%) was watched for 100,000 steps
at most. The null separates the gene bit's own drift from selection but not what the sweeping
clade's other mutations did: the clade that fixed carried weight changes too, and whether
decomposition or some controller tuning it hitchhiked on was the favoured trait is not
separable here (the 0/3 null sweeps argue for the gene; they do not prove it). The gene-off
baseline is not arm b (it pays no work on the DECOMP output); the null is the comparison, and
its bound mass (0.81 to 1.01 million) sits near arm b's (0.77 to 0.90 million) on the same
seeds, 12% and 18% above and 3% below; those histories also differ in the flips and the
carriers' maintenance, so the work charge's own effect would need a matched ablation. Nothing here tests a second gene, a schedule of ages
or a player.

**What it means for Stage 1.** The smallest genome version works as a detector of acquisition:
a discrete, inherited, costly change that spreads where it pays and lingers at a few percent
where it does not. The ladder's second rung (polymer building as a gene over this starting set,
with the same null) is the natural next run, and the open design question is what the first
rung should make: as built, decomposers win by turning the world into film. Code: the three
optional config keys and the gene byte; every RULE_VERSION 1 pin unchanged; the GPU golden check
bit-exact on all 25 cases; two Sol 6.1 High read-only passes, the first on the kernel and design (nine findings taken:
the lineage replay, declared cells, the decoder claim, unknown parents, the catalyst figure, the
PERSISTS quantifier, the missing readout, the flip test and the bounds wording) and the second
on the fixes, this readout and the reader (eight taken: the inspector's expression class, five
attributions and figures above, and the reader's extinct-census and horizon handling; no P1 in
either, the tables unchanged).

## Gene v1: the ladder's second rung (2026-10-16)

The run Gene v0's readout named as the natural next one: polymer building as a second gainable
gene over the same starting set, with the same null design. Two parts again: the **design and
the criterion** below were written before the first run (15:02); the **readout** at the end was
written after the runs, against them. Posture as before: exploration, local GPU only, nothing
landed; the kernel change sits uncommitted on a worktree branch.

### Design

**Kernel generalisation.** `WorldConfig.genes` gains a second named set, `"ladder"`: bit 0 of the
gene byte is decomposition as in v0, bit 1 is polymer building (`GENE_BIT.BUILD`). Each gene gates
one reaction: a living cell without the BUILD bit skips polymer building (B + E → P) and leaves
its BUILD controller output out of the catalysis work sum, exactly as v0 treats decomposition. Each
*carried* gene pays the same maintenance, so the extra cost term is `carried × mulFrac(B, kGene, 16)`
with `carried` the population count of the gene byte masked to the set (one draw, one term,
multiplied; `kGene × carried` inside `mulFrac` would break its exactness bound). The flip operator
is unchanged: a set's bits are contiguous from bit 0 and `flipGene` picks `which mod geneCount`.
The `"decomp"` set reduces to v0's arithmetic exactly (its two pins and the 23 RULE_VERSION 1 pins
are the gate on that); `"ladder"` gets two golden cases and pins of its own, the lineage inspector's
replay names the second locus, and `genomeDistance` counts differing gene bits rather than a
differing byte, since a flip moves one gene. Bound, for the whole byte: at most eight carried genes
at 2²⁶ each, so the gene term is under 2²⁹ and the cost sum under 2³¹.

**The gene-off baseline shifts again.** A non-carrier of build pays no work on its BUILD output,
so this version's gene-off world is not v0's treatment (which charged BUILD work at kBuild 0), just
as v0's was not arm b. The decomposition result is therefore a *replication under a changed
baseline and a split flip rate*, read descriptively, not re-tested.

**What polymer buys, by the arithmetic.** Building costs eP − eB = 2 E per quantum, the same as
decomposition pays. Polymer decays at kPDecay 66/65,536 per step (a half-life near 700 steps) back
to waste, releasing eP − eC = 10 per quantum as heat, so a built quantum is a loan against a
standing cost. What it does while it stands: it gates A and C diffusion across every edge it sits
on by gateK/(gateK + P_s + P_t), gateK 64, so 64 P on each side cuts leakage to a third; and it
counts in bound mass M for affinity and the mass term, so a built cell holds its place better. The
private payoff is retention (nutrient kept from leaking, waste kept for a decomposer to eat) and
cohesion; both accrue to the cell and its neighbours alike. At full output a cell of B = 50 can
build cat(50) × 127/128 × 64/4,096 ≈ 0.22 quanta a step (0.43 E) against a gene bill of
0.0015 × 50 = 0.076 E a step, so the *capacity* to pay is there; whether the controller spends on
it is the question. The rung check's control (kBuild 64 for everyone, free) held polymer at 0.1% to
2.6% of bound mass, so these founders barely build even when building is free. The honest prior is
that the second rung is a door, and the run is to find out whether a cost turns a rarely used
reaction into a shed gene, a kept one, or nothing readable.

**Arms.** All on `gradient-m3` as v0 (256², light 20 + 220, the 12 M3 founders, mutation on at the
preset's rate), kDecomp 96 (preset) in both arms, census every 5,000 with every census deep,
`lineageObs` on, seeds 1, 2, 3, 200,000 steps. Every founder starts with neither gene.

| arm | genes | kGene | geneFlip | kDecomp | kBuild | what it tests |
|---|---|---|---|---|---|---|
| treat | "ladder" | 100 | 2²⁷ | 96 | 64 (preset) | both genes gate reactions that make something |
| null | "ladder" | 100 | 2²⁷ | 96 | **0** | the build gene, at the same cost and flip rate, gating a reaction that makes nothing; decomposition still pays in both arms |

geneFlip is doubled from v0's 2²⁶ so that **each gene's** flip rate is v0's (one event in 64 per
gene; one event in 32 flips something). The null is the control for the build bit only; the
decomposition bit has the same meaning in both arms and the same reading as v0.

**Instruments.** As v0, per bit: a lineage's gene byte from `genomes.tsv`, its cells and mass at
every census from `profiles.tsv`; gene share per bit, the share carrying both, flip-on and flip-off
births per bit from `mutations.tsv` (a flip changes exactly one bit, so each classified birth is
one gene's gain or loss), and the build and decomposition fluxes from `series.jsonl`. New: the
*order* of the rungs, the first census at which each gene's share reaches 25%, per seed.

### Pre-stated criterion (written before the first run)

Share means the build gene's share of living cells unless mass or the decomposition gene is named;
"the last ten censuses" are steps 155,000 to 200,000. HAPPENS, SPREADS, PERSISTS and PAYS are v0's
four tests applied to the build bit, with the null's build bit as the comparison.

- **HAPPENS**: in every treatment seed, at least one classified build flip-on birth by step 200,000.
- **SPREADS**: in at least 2 of 3 treatment seeds, the build share reaches ≥ 25% at some census.
- **PERSISTS**: at least 2 of 3 treatment seeds satisfy SPREADS and hold ≥ 25% at every one of
  the last ten censuses.
- **PAYS**: in each seed pair the treatment's build share at 200,000 exceeds the null's, and the
  null's is < 25% in at least 2 of 3 seeds.
- **PASS** = all four: a second rung is climbed where it pays and not where it does not.
- **CONFOUNDED** = the null's build share is ≥ 25% at 200,000 in at least 2 of 3 null seeds.
- **DOOR** = not CONFOUNDED, HAPPENS holds, and the treatment's build share reaches 25% in at most
  1 of 3 seeds: the rung exists but is not climbed at this cost in this world. This is an
  informative outcome, the "door the population fails to pass" the staged ladder asked for; its
  known next readings are a cheaper gene, a dearer polymer (eP), or a world where retention pays
  (lower diffA or a wound regime).
- **UNCLEAR** = anything else.
- **Replication, descriptive**: the decomposition share in the treatment arm at 200,000 and its
  first census ≥ 25%, against v0's 35,000 / 50,000 / 75,000; expected to sweep again in most seeds.
  (The per-gene flip rate equals v0's, the doubled flips being split between two genes, so a
  slower sweep, if seen, would need another explanation, such as the second gene's cost on a cell
  that carries both. This sentence was corrected after the runs and before the readout was read; the
  pre-run copy in rule.md beside the bundles wrongly blamed the split flips.)
- **Order, descriptive**: in each seed, which gene first reaches 25% (if either), and whether the
  build share among decomposition carriers differs from the share among non-carriers at 200,000
  (the hard-prerequisite reading: polymer paying only once there is waste retained to eat).

What three seeds cannot show is unchanged. What this version cannot show: whether a different
cost or payoff would open the door, or anything about ages or a player.

### Readout (written after the runs, 2026-10-16)

Six runs, 15:46 to 15:58 on the Mac (M1 Max, 1,800 to 2,030 steps a second, about 100 s each),
through `@bl/runner` from a script beside the bundles (`runs/evolution-game/gene-v1/gene.ts`,
`read.ts`, `rule.md` and `tables.md`, gitignored, in the main checkout's `runs/`), the gene keys
in `RunSpec.overrides` as v0 put them. Conservation read exact on every row of every run. The
kernel the runs used is the generalised one described under Design, with every RULE_VERSION 1 pin
and both v0 gene pins unchanged and the GPU golden check bit-exact on all 27 cases; one Sol 6.1
High read-only pass on the kernel and the design text landed before the runs were read (no P1 or
P2; the flip-rate sentence above was its one substantive catch), and nothing in it touched the
physics, the thresholds or the arms.

**Per arm and seed, at step 200,000.** Columns as v0's table, per bit (decomposition / build);
"both" is the share carrying both genes; "min build share, last 10" is the smallest build share
over steps 155,000 to 200,000; "first ≥ 25%" gives the first census at or above the spread bar
for each bit.

| arm | seed | individuals | living cells | lineages | B+P | P | E pool | decomp flux (last 10) | build flux (last 10) | decomp share, cells | build share, cells | build share, mass | both | carrier lineages (decomp / build) | first ≥ 25% (decomp / build) | min build share, last 10 | flip-on (decomp / build) | flip-off (decomp / build) | unknown | mutations | conservation | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| treat | 1 | 16 | 3,114 | 21 | 78,469 | 0 | 116,570 | 468.7 | 0.0 | 85.9% | 2.2% | 9.4% | 2.2% | 20 / 2 of 21 | 30,000 / 90,000 | 0.2% | 4 / 25 | 15 / 1 | 36,494 | 37,920 | exact | complete |
| treat | 2 | 116 | 43,243 | 58 | 1,302,646 | 0 | 1,817,014 | 1,418.8 | 0.0 | 99.7% | 49.3% | 50.6% | 49.3% | 56 / 19 of 58 | 65,000 / 75,000 | 39.0% | 7 / 25 | 22 / 8 | 40,825 | 42,889 | exact | complete |
| treat | 3 | 399 | 46,218 | 157 | 1,800,625 | 5,303 | 2,100,894 | 3,965.2 | 2.7 | 99.6% | 1.8% | 1.5% | 1.8% | 153 / 6 of 157 | 65,000 / never | 0.2% | 13 / 62 | 32 / 3 | 66,360 | 69,911 | exact | complete |
| null | 1 | 228 | 47,908 | 74 | 1,537,771 | 0 | 2,367,601 | 1,952.3 | 0.0 | 100.0% | 0.6% | 0.4% | 0.6% | 74 / 2 of 74 | 25,000 / never | 0.0% | 3 / 25 | 29 / 1 | 44,464 | 46,194 | exact | complete |
| null | 2 | 155 | 42,356 | 78 | 1,195,911 | 0 | 1,885,268 | 1,479.9 | 0.0 | 99.4% | 49.7% | 46.3% | 49.7% | 73 / 14 of 78 | 80,000 / 185,000 | 13.0% | 5 / 33 | 18 / 3 | 43,137 | 45,359 | exact | complete |
| null | 3 | 377 | 46,746 | 119 | 1,755,157 | 0 | 2,186,883 | 3,722.5 | 0.0 | 99.8% | 52.1% | 50.8% | 52.1% | 114 / 70 of 119 | 35,000 / 120,000 | 52.1% | 16 / 25 | 19 / 16 | 72,469 | 75,305 | exact | complete |

**Against the rule, as the reader printed it.**

- HAPPENS: classified build flip-on births in 3 of 3 treatment seeds (25, 25 and 62; the first
  at steps 9,932, 3,719 and 9,982).
- SPREADS: 2 of 3, the build share first ≥ 25% at steps 90,000 (seed 1) and 75,000 (seed 2);
  seed 3's peak was 17% at 120,000.
- PERSISTS: 1 of 3 (the smallest share over the last ten censuses 0.2%, 39.0% and 0.2%).
- PAYS: the treatment beats the null in 1 of 3 pairs (2.2% against 0.6%, 49.3% against 49.7%,
  1.8% against 52.1%), and the null's build share is ≥ 25% at 200,000 in 2 of 3 seeds.
- **CONFOUNDED.** The null build gene, gating a reaction that makes nothing, reached half the
  living cells in two null seeds, so the treatment's one high share says nothing about polymer.
  The rule's PASS, DOOR and UNCLEAR do not apply; DOOR was defined as "not CONFOUNDED" and is not
  claimed, though the observation it was written for is in the fluxes below.
- Replication, descriptive: the decomposition gene swept again in 6 of 6 runs (it has the same
  meaning in both arms): first ≥ 25% at 30,000, 65,000 and 65,000 in the treatment and 25,000,
  80,000 and 35,000 in the null, against v0's 35,000, 50,000 and 75,000, and 85.9% to 100% of
  living cells at 200,000 (the 85.9% is treat seed 1 after the collapse described below). Not
  slower; the same logistic rise, here over 25,000 to 150,000 steps.
- Order, descriptive: decomposition first in every seed where either bit reached 25%, and build
  never first; at 200,000 every build carrier also carries decomposition (the "both" column equals
  the build column in all six runs), so the build share among decomposition carriers (2.6%, 49.4% and 1.8% in the
  treatment; 0.6%, 49.9% and 52.2% in the null) is the population's build share divided by its
  decomposition share, and among non-carriers it is 0% (undefined in null seed 1, which has no
  non-carriers at 200,000). This is consistent with the hard-prerequisite reading
  and equally with the build bit only ever lasting inside clades that already carried
  decomposition (the first classified build flips, at steps 3,719 to 9,982, arrived while
  decomposition was near 0%, and those early carriers did not last: treat seed 2's 18.8% at
  5,000 was gone by 10,000); three seeds cannot tell the two apart.

**Time course** (decomposition share / build share of living cells / B+P).

| arm | seed | t=5,000 | t=10,000 | t=25,000 | t=50,000 | t=75,000 | t=100,000 | t=150,000 | t=200,000 |
|---|---|---|---|---|---|---|---|---|---|
| treat | 1 | 0.0% / 0.0% / 225,023 | 1.7% / 0.3% / 343,929 | 23.1% / 0.7% / 608,835 | 77.2% / 1.7% / 923,466 | 90.3% / 2.4% / 1,206,760 | 99.7% / 14.3% / 1,053,794 | 99.8% / 0.2% / 1,030,925 | 85.9% / 2.2% / 78,469 |
| treat | 2 | 0.0% / 18.8% / 109,346 | 0.0% / 0.0% / 112,682 | 0.0% / 2.4% / 250,535 | 3.7% / 5.9% / 455,038 | 45.4% / 28.8% / 768,862 | 63.9% / 50.6% / 965,772 | 99.0% / 76.1% / 1,056,309 | 99.7% / 49.3% / 1,302,646 |
| treat | 3 | 2.9% / 0.0% / 337,004 | 1.3% / 0.1% / 477,162 | 2.9% / 0.4% / 568,304 | 11.4% / 2.6% / 596,558 | 37.1% / 2.6% / 676,844 | 57.5% / 7.2% / 851,224 | 99.0% / 0.8% / 1,463,697 | 99.6% / 1.8% / 1,800,625 |
| null | 1 | 0.0% / 0.0% / 225,023 | 1.7% / 0.3% / 343,929 | 43.0% / 0.6% / 633,087 | 88.1% / 1.9% / 515,227 | 99.3% / 0.0% / 896,111 | 98.9% / 0.0% / 796,651 | 99.7% / 0.0% / 1,259,332 | 100.0% / 0.6% / 1,537,771 |
| null | 2 | 0.0% / 19.3% / 109,386 | 0.0% / 0.0% / 112,578 | 0.0% / 4.4% / 219,588 | 0.6% / 9.8% / 483,435 | 10.1% / 10.4% / 573,877 | 77.5% / 7.4% / 1,002,454 | 97.5% / 14.4% / 1,302,462 | 99.4% / 49.7% / 1,195,911 |
| null | 3 | 2.9% / 0.0% / 337,004 | 1.4% / 0.0% / 475,440 | 9.9% / 0.5% / 562,938 | 39.4% / 2.0% / 755,217 | 47.5% / 2.7% / 864,661 | 99.6% / 1.1% / 1,597,542 | 99.7% / 97.9% / 1,568,097 | 99.8% / 52.1% / 1,755,157 |

Decomposition share at every census, in percent, one run a line:

- treat seed 1: 0 2 11 14 23 29 41 58 66 77 87 94 92 92 90 97 98 98 98 100 100 100 100 99 99 99 100 100 100 100 100 100 100 100 100 100 100 100 90 86
- treat seed 2: 0 0 0 0 0 0 0 0 0 4 15 18 41 44 45 46 65 63 56 64 78 73 70 69 69 82 85 93 97 99 99 99 99 100 100 100 99 100 99 100
- treat seed 3: 3 1 2 3 3 4 6 7 9 11 16 22 31 37 37 40 47 49 55 58 60 64 73 79 85 89 92 95 98 99 99 99 99 99 99 100 99 100 100 100
- null seed 1: 0 2 15 17 43 63 79 92 94 88 96 97 98 100 99 100 100 100 100 99 99 99 99 99 99 100 99 99 100 100 100 100 100 100 100 100 100 100 99 100
- null seed 2: 0 0 0 0 0 0 0 0 0 1 0 2 4 6 10 31 52 68 72 77 88 87 88 89 88 84 82 92 94 98 99 99 100 100 100 100 99 100 99 99
- null seed 3: 3 1 1 6 10 18 30 36 38 39 38 39 41 44 48 55 73 88 96 100 100 100 100 99 100 99 99 100 99 100 100 100 100 100 99 100 100 100 100 100

Build share at every census:

- treat seed 1: 0 0 0 1 1 1 2 1 1 2 0 0 0 1 2 4 11 26 23 14 10 5 1 1 0 0 0 1 0 0 0 0 0 0 0 1 1 2 2 2
- treat seed 2: 19 0 0 1 2 3 3 3 3 6 13 11 18 24 29 24 40 51 42 51 61 52 52 50 51 62 60 63 74 76 72 56 69 63 39 53 62 74 65 49
- treat seed 3: 0 0 0 0 0 2 1 2 3 3 2 2 3 2 3 4 5 5 4 7 7 10 11 17 10 11 6 2 2 1 0 1 1 1 1 1 0 1 1 2
- null seed 1: 0 0 1 1 1 0 1 0 1 2 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 1 1 0 0 0 1 0 0 1 2 2 2 2 1
- null seed 2: 19 0 0 7 4 14 3 10 9 10 10 11 10 11 10 6 5 8 8 7 8 5 11 6 7 10 12 11 14 14 13 18 19 24 17 17 25 23 42 50
- null seed 3: 0 0 1 1 1 1 0 1 1 2 2 2 3 3 3 3 6 2 1 1 0 5 13 35 53 75 85 89 94 98 99 99 97 99 97 97 89 76 62 52

**Fluxes**, mean over the last ten censuses (quanta a step; E income = resp × 8 + decomp × 2, E
spent = grow × 10 + build × 2 + emit).

| arm | seed | photo | resp | decomp | grow | build | emit | starve | pdecay | abio | E income/step | E spent/step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| treat | 1 | 893.5 | 521.0 | 468.7 | 0.0 | 0.0 | 780.2 | 245.0 | 0.0 | 447.9 | 5,105 | 780 |
| treat | 2 | 2,120.5 | 1,488.3 | 1,418.8 | 0.0 | 0.0 | 2,038.0 | 315.6 | 0.0 | 699.6 | 14,744 | 2,038 |
| treat | 3 | 3,124.0 | 4,424.6 | 3,965.2 | 1,939.2 | 2.7 | 54.3 | 113.1 | 2.6 | 1,094.8 | 43,328 | 19,452 |
| null | 1 | 2,873.1 | 2,041.8 | 1,952.3 | 0.0 | 0.0 | 2,966.2 | 385.5 | 0.0 | 913.6 | 20,239 | 2,966 |
| null | 2 | 2,808.1 | 2,298.7 | 1,479.9 | 0.0 | 0.0 | 2,801.5 | 136.6 | 0.0 | 1,332.5 | 21,350 | 2,802 |
| null | 3 | 2,652.3 | 2,822.6 | 3,722.5 | 1,254.3 | 0.0 | 50.0 | 584.3 | 0.0 | 180.6 | 30,026 | 12,593 |

**What the numbers say beyond the rule** (descriptive; three seeds).

- *The gate opened and almost nobody walked through it.* Build flux in the treatment, where
  carriers may build, peaks at 16 quanta a step (seed 3, 80,000 to 135,000, with 4 to 17% of
  cells carrying the bit) and reads 0.0 over the last ten censuses in seeds 1 and 2, seed 2 with
  49% of living cells carrying the bit and a P pool of exactly zero. Polymer never exceeded 2% of
  bound mass in any run, the range the rung check's ungated control showed (0.1 to 2.6%). What the
  fluxes establish is that polymer was not made in quantity even where it could be. The reading
  (not a measurement: the reaction also depends on the carrier's biomass, its E and the catalysis
  arithmetic, and only a controller probe on carriers or an ablation that forces the BUILD output
  would settle it) is that the founders' controllers barely drive the BUILD output, so unlocking
  it changes almost nothing a carrier does. If that holds, the treatment's build gene is in effect
  as null as the null's, the two arms ran nearly the same experiment, and that is why they look
  alike. The door prior was right in substance (polymer did not pay here); whether the mechanism
  is upstream of the rung's economics, a gene that only opens a gate paying off only if the
  organism already pushes on it, is the reading to test next.
- *What a near-neutral gene does at this cost: it rides.* In every run where the build share
  passed 25%, one clade carried it there. Null seed 3: lineage 109759 (both genes) held 42% of
  living cells at 125,000 and both-gene lineages held all six top places at 150,000 and 175,000
  (98% build share at 150,000); by 200,000 new decomposition-only lineages
  were taking over (161218 at 17%) and the build share was falling, 52% and dropping. Null seed
  2: lineage 137124 (both) at 47% at 200,000, the share still rising. Treat seed 2: a
  both-gene lineage led at 27% at 150,000; at 200,000 a decomposition-only lineage led at 20%
  with both-gene lineages second and fourth.
  The reading is that the build bit rode: it was on in a clade that rose for some other
  reason, or by drift and turnover, which the bundles cannot separate (carrier abundance and
  ancestry do not identify a selected trait, or show there was one). v0's null never did this,
  and the difference in the background is at least descriptive: v0's null world had 190 to 270 lineages and no
  sweeps, a mutation–selection balance of a few percent; v1's null world is a decomposer film
  (decomposition above 97% by 65,000 to 150,000 in every null seed) with 74 to 119 lineages and
  clade turnover, and a bit that costs 6 to 12% of a cell's energy income (kGene 100 against mean B per
  living cell and mean E income per living cell over the last ten censuses: 26 to 41 B a cell
  and 0.32 to 1.05 E a step across the six runs) is not purged within 200,000 steps against that turnover. So the
  null design is informative only when the background is quiet; on a background with clade
  turnover a costly, unexpressed gene can reach a 25% bar, as it did twice here.
- *Decomposition replicated, including the film.* Six of six runs became a decomposer world and four of
  them the v0 film: seeds 1 and 2 of both arms have no growth flux and emission as the main E
  sink. The two seed-3 runs are different: they grew, at 1,939 (treat) and 1,254 (null) quanta
  a step over the last ten censuses, growth taking all but a fraction of a percent of the listed reaction spending (which
  leaves out maintenance) and emission only 50 a step, the first growth seen in a decomposer world on this starting set. Starvation
  runs at 100 to 580 a step across the six. Bound mass at
  200,000 is 1.20 to 1.80 million where the film held, against v0's 0.82 to 1.24 million, the
  null's three (1.20 to 1.76 million) overlapping the treatment's two standing films (1.30 and
  1.80 million); nothing here separates the arms.
- *One film collapsed.* Treat seed 1 held 36,000 to 39,000 living cells and 1.0 to 1.19 million
  B from 100,000 through 150,000 (99.8% decomposition, 0.2% build, one lineage, 71603, at two thirds of the
  cells), then lost nine tenths of both over the next 50,000 steps: 3,114 cells and 78,469 B at
  200,000, the E pool from 0.98 million at 150,000 to 0.12 million, the A pool from 1.16 to
  2.31 million as cells died, photosynthesis from 1,900 to 230 a step while starvation held above 250 a step through
  180,000. The dominant lineage fell from 67% at 150,000 to 10% at 195,000 and twenty-one lineages,
  most of them younger than 185,000, share what is left. The build bit was on in 0.2% of cells and this run's build flux had been zero since
  60,000, so a direct role for it is unlikely but not excluded (null seed 1, on the same seed,
  did not collapse); the collapse began 60,000 steps after decomposition fixed, in the aftermath v0 said it had watched for 100,000 steps at
  most. Null seed 1, identical to this run through step 10,000 (same founders, same first
  censuses), did not collapse. One seed, no cause assigned: the film can fail, which v0 did not
  show, and whether it is an energy trap (a film that respires its pool down) or chance is for a
  run with more seeds and a longer horizon.
- *Not in the first minute, again.* Where the build bit reached a quarter it did so at 75,000
  steps or later, in each case inside one rising clade (in treat seed 2 while decomposition was
  itself still rising, at 45%); a rung climbed on its own merits was not seen.

**What this does not say.** Three seeds show 2/3 and 1/3 and nothing finer. The verdict is the
pre-stated CONFOUNDED and is a statement about this null design on this background, not about
polymer: no run here tests a polymer gene that is expressed. It does not say what kGene would
purge an unexpressed bit on a sweeping background (a kGene 0 null would show the drift floor;
a dearer gene the purge rate), nor whether a controller that drives BUILD exists among the
founders or is reachable by weight mutation in 200,000 steps (the 15 quanta a step in treat 3
says some lineage pushed a little). The two arms differed in kBuild only, and the build fluxes
say that difference was rarely exercised; whether the arms' other differences (treat 1's
collapse against null 1's survival on the same seed, the growth in seed 3 of both arms) are
seed-to-seed spread or a downstream effect of the little polymer that was made is left
unresolved. The 6 to 12% cost figure is an
average over living cells from the fluxes, not a measurement on carriers. Nothing here tests ages or a
player.

**What it means for Stage 1.** The detector still works (decomposition replicated 6/6 with the
same rule) and the second rung as designed does not. The reading above, if it holds, names a
condition the design did not test for: a capability gene that opens a gate on a controller
output is only a capability if the controller already uses the output. The first rung's
founders do drive DECOMP (the rung check's arm c made 2.5× the bound mass with it); whether they
drive BUILD is the probe to run before the next version is built. On that reading the next
version has two choices, and the choice is a design decision for the user: (a) genes that *do* rather than
*permit* (a build gene sets the build rate directly, or scales the controller's output by a
fixed factor, so a carrier builds whether or not its weights say so), which makes the rung a
pure cost-against-payoff test; or (b) keep permissive genes and choose rungs whose outputs the
founders already express, which keeps the controller in the loop but limits the ladder to what
the starting set can already do. Either way the null needs a second control: a kGene 0 arm (the
drift and hitchhiking floor) beside the no-payoff arm, since on a decomposer background the
no-payoff arm alone reached 50%. The film collapse in treat seed 1 is the first failure of the
first rung's world and deserves its own look before the ladder is built on top of it.
Code: the gene-set generalisation (`"ladder"`, `geneMasks`, per-gene cost by popcount),
every RULE_VERSION 1 pin and both v0 gene pins unchanged, two new pins, the GPU golden check
bit-exact on all 27 cases, typecheck clean; the vitest suite was not run green today: two
full runs under a machine load average above 300 from other work on the Mac timed out 11 and 8
of the long conservation tests (per-test limits of 30 to 120 s; never an assertion, apart from
the known timing flake in `tools/test/hunt1-ops.test.ts`), and a rerun of the nine timed-out
files alone passed golden-hashes, feed and measures6 and timed out the other six again, so a
quiet rerun of `pnpm test` is owed before this lands; two Sol 6.1 High read-only passes, the first on the kernel and the design text before
this readout was read (no P1 or P2; two P3 nits, the flip-rate sentence and the then-missing
readout, both taken) and the second on this readout and the reader (no P1; four P2s, all
mechanisms stated as fact and now marked as readings: the controllers, hitchhiking, the order
of fixation and the arms' other differences; four P3 figure corrections: the conditional
shares, the cost window, the growth share and the collapse pools; all eight taken, the tables
unchanged).
