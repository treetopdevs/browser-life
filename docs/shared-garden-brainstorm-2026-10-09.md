# The shared garden: brainstorm (2026-10-09)

Status: **exploratory, a brainstorm and not a plan.** Nothing here is registered. Nothing proposed
changes physics, a checkpoint format or a golden pin: the work named is coordinator, runner, schema (one
new intervention kind) and site work under RULE_VERSION 1. The visual companion is
`docs/shared-garden-brainstorm-2026-10-09.html`.

The roadmap line this takes apart is bet 4 on the home page, marked "Someday":

> The shared garden. A persistent archipelago. Creatures moving between islands. Visitors feeding a
> world, shifting its sun or dropping a meteor. Games and collaborative spaces that keep evolving while
> we're away.

## Summary

- The line bundles four promises: a **persistent world**, **movement between islands**, **visitor
  interventions** and **games**. The repo has substrate under three. The one with none is the thing
  itself: an open-ended, publicly tended run that advances at a pace people can follow.
- Three decisions were taken in the session, by the user. The garden's clock is **archipelago time with
  Tamagotchi honesty**: volunteer islands advance it, the step count is a public number, and it sleeps
  when nobody tends it. The first garden is a **commons on a planet world**, the big storm
  (`wild-storm-large`). The garden is **paced**: it advances at a fixed rate when tended, not flat out.
- Reframe: **the garden is a log, not a server.** One canonical chain of content-addressed checkpoints
  plus a sequenced log of letters. Anyone can advance it, verify it or fork it. Verification is already
  an island's job; forking is the recovery from a bad letter.
- **Letters, not chat.** Interventions land at the next segment boundary, are public before they land,
  and are replayed on a second island before they count. Stones (lesions) are daily; the sun is the
  scarcity dial; food is the founding ritual and after that rare and collective, or absent.
- **The storm is the weather; visitors are authors.** The storm's own wounds, wandering sun and seasons
  are what keep it evolving while we are away. The user's sighting of 2026-10-09 (the big storm needs a
  lot of food at the very beginning, is robust after that, and makes worms when food gets scarce) is the
  first for that jar, by eye and unmeasured. The note's hypothesis from it is that the dangerous
  letter is food, not stones.
- The riskiest assumption is that the big storm keeps building over a hundred million steps rather than
  dying early or settling. The cheapest tests are the storm without feeding, start nutrient doubled,
  beside the catalogued version (§6.1), and the **stone horizon**, which sets the pace (§6.2). Both run
  on a Mac for nothing; neither touches physics. §6.1 ran the same evening: the catalogued jar died
  before its first wander on all three seeds, the doubled jar filled with a carpet on all three, and
  the middle arm (nutrient 48) gave populated jars on two seeds of three, one with a corner of worms
  by eye, and starved on the third. Founding food is a dial; 48 gave populated jars on two seeds of
  three, the band's width is unmeasured, and one seed in three still starving argues for the founding
  feed as a letter.
- The decisions taken and the ones still open are in §7.

## 1. Frame

**Why now.** The catalogue is open, the lab has Wound, Feed and Drain as logged hand edits, islands exist
in the browser and in Deno, and the public site says in three places that the persistent garden is "a
future direction". Of the five roadmap bets this is the one the About page calls the thing wanted since
Spore. It is also the most expensive to get wrong in public: a dead world with a step counter is worse
than no garden.

**The four promises, and what stands under each.**

| Promise | Substrate today | Gap |
| --- | --- | --- |
| A persistent archipelago | the coordinator segments runs, stores checkpoints by content, re-runs a fraction on a second island | no open-ended run: every experiment has a fixed step count; no pace |
| Creatures moving between islands | ring exchange between runs of one metapopulation at segment boundaries, verified like any segment | same preset and positions only; transplant with offset and relabel is a to-do |
| Feeding, shifting the sun, a meteor | lesion and feed are logged interventions the lab replays; wounds and meteors are config | headless runs refuse lesions and feeds; the coordinator carries no interventions; the sun is config, not an event |
| Games that keep evolving while we're away | everything is logged, so receipts are free | M4 did not establish open-ended growth, so a plateau is the standing worry; nothing public tends anything |

**The clarifying question was whose clock the garden keeps.** Three honest answers: server time (a GPU
always on, about $1 an hour for an A10G), Tamagotchi time (the garden sleeps unattended and says so), or
archipelago time (volunteer islands advance it, and the count climbs when people tend it). The user chose
archipelago time with Tamagotchi honesty. The second question was which world; the user chose a commons
on a planet world, the big storm. The third was pace, raised in §3; the user chose paced.

## 2. What the repo already knows about this bet

### 2.1 The coordinator can already hold a very long run

`apps/coordinator` splits a run into segments; segment k starts from the end checkpoint of k−1, stored
by content (`.blck`). A deterministic fraction of segments (the experiment's `verifyFraction`) and the
final one are replayed by a different island than the one that ran them and compared by the checkpoint
artifact's digest, physics and observer state together; a mismatch marks the segment "diverged" and
blocks everything after it. A segment may continue from a predecessor that is done but not yet
verified. `Coordinator.Queue` accepts `steps` from 1 to 1,000,000,000 and at most 100,000 segments an
experiment, summed over its conditions and seeds. Islands
are `apps/lab/island.html` and `tools/island.ts`, both through `packages/runner/src/island.ts`, which
advertises `ponds-v1` and `ponds-v2` and refuses branch runs and picked runs.

So a standing garden is a run whose step count is set far ahead, or a chain of runs each starting from
the last one's end checkpoint, which is what the segment mechanism already does inside a run. The tip
of the chain, the latest verified end checkpoint, is the garden. What does not exist is a run that
advances at a stated rate, or one that takes inputs after it starts.

Rings exist: `packages/schema/src/exchange.ts` rotates packets between runs of one metapopulation at
segment boundaries. The packet is a pure function of the predecessor's accepted checkpoint, the
metapopulation's salt and the boundary step, so producer, importer and verifier derive it independently
and matter is conserved across the archipelago. It needs the same preset and the same positions.
`docs/plan.md` lists the transplant tool (offset and relabel) as a to-do.

### 2.2 Interventions, and where each can run

`packages/schema/src/world.ts` has three kinds: a **lesion** (converts matter in place, books the heat,
the world stays closed), a **feed** (adds or drains dissolved nutrient in a disc; the one deliberate
exception to closed in matter, logged with the exact quanta moved, refused in pond worlds; built
2026-10-03 and merged into main 2026-10-05, `docs/sandbox-feed.md`), and a **pick** (the breeder's
donors at a pond boundary).

| Where | Lesion | Feed | Pick |
| --- | --- | --- | --- |
| Lab, by hand and replayed on a jump (`apps/lab/src/execution.ts`) | yes | yes | yes |
| Headless `tools/run.ts` from a manifest | refused | refused | replayed at boundaries |
| Coordinator segments and verify | none | none | none |

A letter therefore needs three things that do not exist: a slice of the log in the segment spec, the
headless runner applying lesions inside a segment, and verify re-applying the same slice. The third is
nearly free once the slice is part of the task, because the task is what the second island replays.

**The sun is config.** `lightMode` is uniform, gradient, patches or sweep; `lightBase`, `lightAmp`,
`seasonPeriod`, `seasonAmp`, `dayPeriod`, `wanderPeriod` and `wanderAmp` are set when a world is
planted. Nothing changes light mid-run and nothing logs such a change. "Shifting its sun" is a fourth
intervention kind, not a brush.

### 2.3 The storm worlds

The storm (`packages/schema/src/presets.ts`, `STORM`) stacks every sandbox lever at its own dose: a
wandering sun (sweep, base 20, amplitude 170, wander period 65,536 and amplitude 512), a season of 4,000
steps and amplitude 60, a readable signal, heritable shape, and wounds of radius 3 at about one per
13,000 steps per cell, on the M3 founders with nutrient 32 and biomass 64. `wild-storm-large` is the
same at 512², with the wander period and amplitude doubled so the sun moves at the same cell speed over
four times the ground, twice the founders and the same start nutrient.

Until today the catalogue (`apps/lab/src/worlds.ts`) said: the small storm was extinct by step 29,000
at seed 1 on 4 October; moving one lever at a time showed the sun's speed is what kills; every storm
variant is marked "not yet run" until the sun is at half speed or slower; the big jar is "not yet run".

**The user's sighting, 2026-10-09**, by eye in the lab, one seed, unmeasured: the big storm needs a lot
of food at the very beginning, after that it is robust, and it makes worms when food gets more scarce.
That is the first sighting for the jar. The big storm's card now carries §6.1's result (state
negative: three early deaths, a carpet under doubled start nutrient) beside the sighting, which it keeps
as a by-eye line. Worms already have a measure: `cells_long` in `tools/own-shape.ts`, the
share of body cells in bodies with elongation 2 or more (`docs/sandbox-cells.md`).

### 2.4 Cost and speed

`docs/plan.md` plans on 1,024² at 1,000 to 3,000 steps a second on an M-series GPU; the big jar has a
quarter of the cells. The M4 ensemble's A10G ran six lanes at about 730 steps a second each at 256²,
about $1 an hour. Volunteer islands cost nothing, and a garden with no lender sleeps.

A sun wander on the big jar is 131,072 steps. At the smoke run's rate, one Mac tending flat out for
eight hours is about 14.4 million steps, about 110 wanders. Whether a stone dropped in the morning is
still findable by dawn after that is what §6.2 measures; the prediction there is that it is not.

### 2.5 What the site promises

No account, no install, no cookies, nothing asking for your email; the privacy page is the measure of
any promise (`DESIGN.md`). Anything that needs a visitor to be the same visitor tomorrow is a change to
that promise. This rules out per-visitor budgets kept on the server.

## 3. The reframe: a log, not a server

The garden is one canonical history: a chain of verified checkpoints and a sequenced log of letters.

- **Advance.** An island takes the next segment, as today. The segment's spec carries the letters whose
  steps fall inside it. The end checkpoint is the new tip once verified.
- **Verify.** The replay island applies the same letters and must reach the same digest. A stranger's
  GPU re-runs your stone bit for bit before it counts; that is the garden's distinguishing feature. The
  coordinator today replays a fraction of segments and lets a run continue from a day that is done but
  not yet verified. The garden sets the fraction to one, every day replayed, and shows a day as verified
  only after a second island agreed. The verifier must be a different island from the one that ran the
  day. Two tabs on one computer are two islands to the coordinator, which makes a replay, not an
  independent check, so the page says which it was: verified by another computer, or only replayed on
  the keeper's own. With one keeper the honest line is "advanced, replayed here, not yet verified
  elsewhere" until a second computer comes.
- **Fork.** Replay from any checkpoint with any edit of the log: the garden without your stone, the
  garden with one more. The counterfactual is a toy, and it is also the recovery from a bad letter:
  nothing in a log is lost, so a day can be re-cut without it. A bad letter can still spoil a day in
  public before that happens, which is what the public queue and the keeper's veto are for.
- **Honesty.** The page shows the step count, when the garden last moved, how many islands tended it
  today, the letters waiting for the next dawn, the share of segments verified, and what changed since
  your last visit (the last-seen step kept on the device, nothing on the server). "The garden slept 14
  hours. Your stone lands at step 4,120,000."
- **Pace.** Pace is a coordinator policy, not an island throttle: the garden releases at most so many
  steps per real hour, and islands take segments as they are released. One Mac is then enough to
  advance it; a second island is what verification needs, and further islands add the ring, not speed.
  It still sleeps unattended, which keeps the count honest.
- **Letters, not chat.** A letter lands at the next boundary, the garden's dawn. It is public in the queue
  before it lands, and the keeper can drop it before dawn. Latency is the aesthetic: you write to the
  garden, you come back tomorrow to see what it did.

## 4. The parts of a first garden

| Part | First version | Later |
| --- | --- | --- |
| Clock | archipelago time, Tamagotchi honest (decided) | |
| World | `wild-storm-large`, with founding food in the preset if a start-nutrient arm finds the middle ground (§6.1: 32 starves, 64 carpets, 48 is populated on two seeds of three) | a slower sun, since §6.1 shows early deaths; only a slower-sun arm beside the same seeds can say the sun did it |
| Pace | one sun wander a day, provisional, until the stone horizon (§6.2) says otherwise | |
| Stone | a lesion at a chosen place, landing at dawn | radius as a choice, a meteor as the rare large one |
| Sun | dim, brighten or shift for a span: the scarcity dial, matter stays closed | |
| Food | in the preset if §6.1 bears it out, so the garden is closed from step 0; otherwise a founding feed, once, by the first visitors | a feast by vote, or never |
| Budget | the garden's, not the visitor's: so many letters a day, the rest wait for the next dawn; one per device per dawn kept on the device as a courtesy, not a rule | |
| Keeper | the user's Mac, and the page says so | |
| Between gardens | a second garden and the existing ring exchange | cuttings: take a piece home, bring a creature in (you give to receive, since the garden is closed); needs the transplant tool |
| Games | letters with a budget; dawn predictions (which lineage holds the field tomorrow) with free receipts; naming a lineage that crossed a threshold; the garden without your stone | the breeder made social as the second garden in the ring |

"Creatures moving between islands" under this clock means a ring of gardens exchanging packets at
boundaries, and later cuttings. It does not mean a creature crossing from one tab to another, which the
bet's wording suggests and which nothing here does.

## 5. Provocations

- **The strongest case against the whole bet.** Persistent shared worlds die of indifference. The ones
  that are remembered, r/place and Twitch Plays Pokémon, were time-bounded with visible collective
  authorship. So the promise that survives is not "it is always there" but "it changed since you were
  here, and here is what happened". That is the naturalist's field notebook pointed at one world, which
  makes bets 3 and 4 one bet with two surfaces.
- **Feeding is the dangerous letter.** The bet says "visitors feeding a world". The user's sighting, one
  seed by eye, suggests the storm needed food to get going and made worms once food got scarce. The
  note's hypothesis from it is that food is what makes the storm dull and hunger is what makes it
  build; §6.1 does not test that, and a fed arm beside a hungry one would. If so, a garden whose
  visitors can feed it at will gets fat. Hence the flip: stones daily, the sun as the scarcity dial, food
  as founding only.
- **Flat out outruns its visitors.** A tended jar at hundreds of steps a second runs about 110 wanders
  in a working day; if the stone horizon is shorter than that, as predicted, every letter is washed out
  before anyone sees it. Honesty does not require speed; it requires that the count only climbs when
  someone tends it.
- **Tending should not earn letters.** Most visitors are on phones and can only watch. Lending a GPU is
  a gift; letters are for everyone, or the garden is a club for people with desktops.
- **The sun question comes first.** The small storm died of its sun by step 29,000, and the catalogue
  says the storm needs a slower sun before anything else is worth sweeping. The big jar's sun moves at the
  same cell speed over four times the ground, which may be why it survived by eye. A garden that dies of
  its sun in public is the one failure that cannot be forked away, because the fork is also public.
- **Who would hate it.** The experimenter, if garden letters ever pass for experiment inputs. Rule: a
  garden is a run in the same store with its letters logged like picks, and never a registered
  experiment or a source of registered evidence.
- **Nothing to trust, only to re-run.** A letter replays bit for bit. There is no moderation question
  about whether a stone "really" landed; there is only whether a second island reached the same hash.

## 6. Converge

**Recommendation.** Build the commons on the big storm, paced, with stones as the first letter and the
sun as the second. Make founding food part of the preset if §6.1 bears it out, and keep feeding out of
the running garden. Put the honesty numbers on the page before any game. Add the second garden and the
ring before cuttings. Run §6.1 and §6.2 before writing a line of coordinator code, because together they
decide whether the big storm can be a garden at all and how fast it should go.

| Assumption | Cheapest test |
| --- | --- |
| the big storm holds up without hand feeding | §6.1: three seeds, nutrient 32 and 64, a million steps, headless, free |
| a stone stays legible long enough to set a day's pace | §6.2: the stone horizon on twins forked from one checkpoint |
| the storm keeps building rather than settling | the same §6.1 runs read for `cells_long` at their 250k, 500k and 1M checkpoints and lineage turnover per census, then one long seed |
| letters can be verified like segments | follows from the log slice being part of the task, with every day replayed and a different island replaying it; a determinism test like `tests/deno/segments.ts` with a lesion inside a segment |

### 6.1 First test: the big storm without feeding, and its sun

Headless, `tools/run.ts`, `wild-storm-large`, three seeds, a million steps, two arms: the catalogued
preset (nutrient 32) and a variant with the start nutrient doubled. Read living mass, lineage count and
the activity statistic per census, `cells_long` from the checkpoints at 250,000, 500,000 and 1,000,000
steps (`tools/own-shape.ts` reads a screen layout and needs a path adaptation), and the step of
extinction where there is one. The variant is a one-line preset entry and changes no pin, because no
existing config hashes it.

The user's feeding was by hand, in a place, after the start; doubled start nutrient is uniform and
dissolved from step 0. They are not the same lever. If the variant dies where the fed world lived, the
founding feed is a real letter and §6.3's first build (feeds in headless segments) moves ahead of the
garden itself. If the base arm dies early, the next arm is the wander period doubled, which the
catalogue already asks for and which is the arm that could lay the death at the sun's door.

This is a catalogue test, not an experiment: a dated "seen" line on the world's card and no claim. It
costs a few hours of a Mac's GPU and nothing else.

**Pre-stated reading, written 2026-10-09 before any run finished.** An arm *holds up* if living mass is
above zero at a million steps on every seed, and *dies early* if any seed is extinct before the first
full wander (131,072 steps), where the small storm died at 29,000. Both arms keep the same sun, so this
test cannot say the sun did it; only a slower-sun arm beside the same seeds could. Worms are read as `cells_long`
at 250,000, 500,000 and 1,000,000 steps, reported per seed with no threshold, because the cells sandbox
found the control itself at a quarter to a third in some seeds. The runs: `wild-storm-large` and the
doubled-nutrient variant, seeds 1 to 3, a million steps, a census every 1,000 steps, a checkpoint every
50,000, into `runs/garden-storm/`, through a scratch wrapper that adds the variant preset at run time
and changes nothing in the repo. A 2,000-step smoke run went at about 500 steps a second on this Mac,
so the six runs take about three and a half hours. Started 2026-10-09; results are appended below as
they land.

**Results (2026-10-09, by the pre-stated reading; seeds 1 to 3; bundles in `runs/garden-storm/`).**

| Arm | Seed 1 | Seed 2 | Seed 3 |
| --- | --- | --- | --- |
| nutrient 32, as catalogued | extinct at 121,000 | extinct at 28,000 | extinct at 66,000 |
| nutrient 64 | alive at 1,000,000: 262,004 of 262,144 cells living, 10 bodies, the largest 257,822 cells | alive at 1,000,000: 254,660 cells living, 427 bodies, the largest 58,208 cells | alive at 1,000,000: 262,018 cells living, one body of 261,075 cells |
| nutrient 48, run after the two above | alive at 1,000,000: 197,606 cells living, 2,961 bodies, the largest 3,848 cells | extinct at 84,000 | alive at 1,000,000: 229,946 cells living, 2,345 bodies, the largest 59,883 cells |

- The catalogued arm *dies early* on every seed: all three extinct before the first full wander, as the
  small storm did. Living cells peaked at 35,000 to 73,000, about 13 to 28 percent of the jar, inside
  the first 13,000 steps and fell from there. This test cannot say the sun did it; a slower-sun arm
  beside the same seeds could.
- The doubled arm *holds up* on every seed by the letter of the rule. The measurements: at 1,000,000
  steps 97 to 100 percent of the jar's cells are living on every seed; on seeds 1 and 3 the census
  counts 10 and 1 bodies, the largest holding 98 and 99.6 percent of the jar; seed 2 counts 427 bodies,
  the largest a fifth of the jar, and it was at 66 percent living at 300,000 before filling. Our
  reading of that is a carpet: the census's bodies are pieces of one mat cut by its mass threshold,
  not a population. Frames rendered from the checkpoints (kept in the session's scratch space, not in
  the repo) look the same way: a patchwork of a few hundred lineages filling the jar. Seed 3 at 250,000
  still had a lattice of discrete dot-bodies on about a third of the jar beside the carpet; seed 2 kept
  holes and a bright band to the end.
- Worms: `cells_long` is 0.000 to 0.018 at 250,000 and 500,000 on every seed. At 1,000,000 it is
  0.001 (seed 1), 0.000 (seed 3) and 0.902 (seed 2). The seed-2 number is not worms. The ring-weight
  triple 64/40/0 holds 98 percent of occupied cells at 1,000,000 where 64/64/0 held them at 500,000,
  which reads as a shape-weight sweep (ancestry not traced), and the carpet's pieces sprawl, the
  largest 58,000 cells, a fifth of the jar. On a carpet the measure does not mean what it meant on the
  cells screens.
- The middle arm, nutrient 48, ran the same evening with the same reading. By its letter the arm *dies
  early* (seed 2 extinct at 84,000) and does not *hold up* (not every seed). The two surviving seeds
  are the first populated jars: 2,961 and 2,345 census bodies at a million steps, median about 20
  cells, living cells 75 and 88 percent of the jar, the largest body 1.5 percent of the jar on seed 1
  and 23 percent on seed 3, lineages in the thousands. Ring-weight triples turn over on seed 3 (64/64/0
  at 79 percent of occupied cells at 250,000; 64/46/0 at 61 percent at 500,000; 47/31/0 at 37 percent
  beside two others at 1,000,000), which reads as heritable shape under selection, ancestry not traced.
  `cells_long` on seed 1: 0.073, 0.018, 0.009; on seed 3: 0.142, 0.441, 0.051, the middle value with a
  43,000-cell body present. Frames: seed 1 at a million is a lattice of thousands of small dot-bodies
  in many colours with a few carpet patches; seed 3 at 500,000 is a central mat ringed by dot
  lattices; seed 3 at a million is dot lattices over most of the jar and, in one dark corner, tangled
  elongated bodies that look like the worms and labyrinths the user described. By eye, one snapshot.
- So start nutrient is a dial: starvation at 32, a populated jar at 48 on two seeds of three, a carpet
  at 64. The garden's founding food sits near 48 and is not safe there, since one seed in three still
  starves, and uniform start nutrient is not the user's lever, which was food by hand in places after
  the start. Next: more seeds at 48 and its neighbours (40, 56) to see how wide the populated band is,
  and the founding feed as a letter inside a headless run (§6.3 build 1) as the way to widen it by
  hand.
- Side reading: the doubled arm ran at 290 to 350 steps a second against the smoke run's 500, because a
  full jar costs more per step. The catalogued arm's runs were stopped at extinction.

### 6.2 Second test: the stone horizon, which sets the pace

Lesions in headless runs come first (`tools/run.ts` refuses them today). Then, from one checkpoint of a
surviving §6.1 arm, two twins: one undisturbed, one with a single radius-8 stone at the checkpoint
step. Per census, compare the twins near the stone (a disc of twice its radius) and far from it (the
same measure over the rest of the jar). Far is the baseline every fork drifts to in a chaotic world;
near is the stone. The horizon is the first census where near is no larger than far, by a rule written
down before the run. Repeat for three checkpoints and three seeds, and for radii 8, 32 and 64 (a lesion on a 512 jar may be
up to radius 255).

**Prediction, written before the test.** The storm already wounds every cell about once per 13,000
steps with a radius-3 disc, so one wander is about ten wounds per cell. A radius-3 or radius-8 stone is
one more wound among them, and its horizon should be under one wound period. If so, a visitor's stone
is a meteor (radius 32 or more) or it is a mark with a receipt and no lasting effect, and the sun is the
letter that carries.

The garden's day is then the horizon, with a floor of one sun wander so that something visibly
changed, and the pace is that many steps per real day. Until it is measured the day is one wander (§7).
If the horizon is shorter than a wander, stones are too small to be letters and the sun is the first
letter instead.

### 6.3 What must be built, smallest first

1. **Lesions and feeds inside headless segments**, replayed from a log slice (`packages/runner`,
   `tools/run.ts`), with a determinism test that a segmented run with a lesion equals the continuous
   one byte for byte.
2. **The garden in the coordinator**: a run with a release policy (pace), a letter queue, segment specs
   that carry the letters falling inside them, a public garden endpoint with the honesty numbers, and a
   fork from any verified checkpoint. Verify follows from the spec.
3. **The garden page**: the numbers, the queue, the letter form with its dawn preview, and "since your
   last visit" from a step kept on the device.
4. **The sun letter**: a fourth intervention kind in `world.ts`, applied in the runner and the lab,
   with the same closure (light is energy). No pin moves because no existing config carries one.
5. **The ring**: a second garden and the metapopulation exchange that exists.

Later: feeds as a collective letter; cuttings through the transplant tool; the breeder made social, which
needs the coordinator to know the `breed` arm (`docs/sandbox-wild.md`, "Not built").

### 6.4 Set aside for now

- **Server time.** An always-on GPU is about $700 a month for the first garden and buys nothing the
  paced garden lacks except a count that climbs while nobody watches.
- **Visitor identity.** Per-visitor budgets kept on a server, names on letters, accounts. The budget is
  the garden's. The privacy page still gains two lines: letters are public, and the courtesy budget
  lives on the device.
- **Creatures crossing between tabs** as a literal. The ring and cuttings are the honest readings.
- **The breeder made social**, until the coordinator knows the breed arm; pond worlds also refuse feeds
  and have no sun to shift, so it would lock out two of the three letters.

## 7. Decisions

Taken by the user in the session (2026-10-08 and 09):

1. **Clock:** archipelago time with Tamagotchi honesty.
2. **World:** a commons on a planet world, the big storm.
3. **Pace:** paced ("pace it"). Setting the day by the stone horizon is the note's rule, not the user's.
4. The rest by this note's recommendations ("go with your recommendations for the rest"): founding
   food as config if §6.1 bears it out; the budget flipped (stones daily, the sun as the scarcity dial,
   food as a ritual); the storm as the weather and visitors as authors; the ring before cuttings; tending
   earns no letters; the budget belongs to the garden and not the visitor.

Taken by this note on "just make reasonable recommendations and go" (2026-10-09), each one reversible:

5. **Provisional pace:** one sun wander a day, 131,072 steps, released at dawn and taken by whichever
   island shows up. At the smoke run's rate that is under five minutes of one Mac, so tending a day is
   cheap and the count still climbs only when someone tends it. §6.2 can move the number.
6. **No food after founding.** The first garden is closed in matter from its founding on. A feast by vote
   is a later garden's question.
7. **A letter's receipt** is the boundary frame before and after, and the near-against-far number over
   the following day. The fork without the letter comes later, as a toy.
8. **Working name:** the commons. While the only keeper is one Mac, the page says "kept by one computer
   so far" and shows the hours it slept.
9. **The catalogue** carries §6.1's result on the big storm's card (state negative) with the sighting
   kept as a by-eye line, and the storm family's summary gained a sentence (§2.3).
10. **The visual companion** exists (`docs/shared-garden-brainstorm-2026-10-09.html`).
11. **Test §6.1 has run** on this Mac (free), with its reading pre-stated: the catalogued jar starves,
    the doubled jar carpets, the middle arm (nutrient 48) is populated on two seeds of three and
    starves on the third. Test §6.2 waits on lesions in
    headless runs, which is the first build and the next phase.

Still the user's, and needing a yes: landing this note, the companion and the catalogue line on main;
any coordinator or runner work; any paid compute.

## 8. Provenance

This note was written from: the home page roadmap (`apps/lab/index.html`), `docs/public-site-plan.md`,
`docs/plan.md` (§7 and the cost and throughput lines), `docs/naturalist-brainstorm-2026-10-07.md`,
`docs/sandbox-feed.md`, `docs/sandbox-cells.md`, `docs/sandbox-wild.md` ("Not built"),
`packages/schema/src/world.ts`, `exchange.ts`, `config.ts` and `presets.ts` (`STORM`,
`wild-storm-large`), `packages/runner/src/island.ts` and `runner.ts`, `tools/run.ts`,
`apps/coordinator/lib/coordinator/queue.ex`, `apps/lab/src/worlds.ts`, `execution.ts` and `main.ts`,
`apps/lab/privacy/index.html`, and the user's words in the session: "archipelago time with Tamagotchi
honesty"; "commons on a planet world; the storm 512 x 512 seems to need a bunch of food in the very
beginning but after that, it seems quite robust and can make worms when food gets more scarce";
"pace it; go with your recommendations for the rest". The sighting is one seed by eye, not a
measurement, and is reported as such throughout.
