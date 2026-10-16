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
