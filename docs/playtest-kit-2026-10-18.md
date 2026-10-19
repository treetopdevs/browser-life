# Pond keeper playtest kit (2026-10-18)

Status: **ready to run; no session has been held.** Section 6 (what counts as a pass, how each
item is scored, and what each result changes in the next build) was drafted first on 2026-10-18
and revised the same day after six reviews, still before any session. The other sections were
checked against the lab (see "How this kit was checked" at the end).

**Section 6 is frozen.** Its SHA-256, from the line `## 6. What counts, fixed before any session`
up to but not including the line `## 7. Consent and privacy`, is
`343c7f0344187cb49470bacc2382de187967028f757736445be6d660b020c596`. Check it before each session from the repository root:

```bash
sed -n '/^## 6\. /,/^## 7\. /p' docs/playtest-kit-2026-10-18.md | sed '$d' | shasum -a 256
```

The commit that adds this note to the repository is the freeze; the readout cites it. A change to
section 6 after that is a dated amendment at the end of this note, never an edit in place.

This kit runs the evolution game's Stage 0a test (`docs/evolution-game-brainstorm-2026-10-16.md`,
§8, "Stage 0a") again on the lab as it stands on main after Pond keeper v0 and v1
(`docs/pond-keeper-v0-2026-10-17.md`, `docs/pond-keeper-v1-2026-10-17.md`), with three people who
have not used the lab, and adds Stage 0b's question: does the log of firsts help people say what
changed? The user ran Stage 0a himself on 2026-10-17 with v0 ("basically a pass, but it isn't a
lot of fun, needs more interactivity, and a few more _whats next_", quoted in the v1 note); v1
added the pressure dial, auto-breed, Keep a lineage and the What's next ladder in answer. So the
question here is the next one: with v1's verbs and ladder, do newcomers see change, want more,
reach for the verbs, and point at the firsts?

Two deliberate differences from Stage 0a as the brainstorm writes it: the core is twelve minutes,
not ten, because v1 has three tasks where v0 had one; and the fail rule needs two of the three
participants, not one (section 6 says why).

**What to bring.** A Mac (or other laptop) that serves the lab and has WebGPU, this note printed or
open on a second screen, three copies of the observation sheet (section 4) and of the
questionnaire (section 5), a pen, and a watch or phone timer. About 45 minutes a participant: 30
for the session, the rest for scoring section 6 and resetting the machine.

**Run it locally, not on cadence.garden.** As of 2026-10-18 the deployed lab still has v0's
"Breed by hand" panel but not v1's dial, auto-breed, Keep, What's next ladder or session card
offer. Every session runs on a local dev server at the commit pinned in section 1.

## 1. Setup

### The code

The kit was checked against main at `c16b5a6` (2026-10-18). Main keeps moving (other lab and
site changes landed the same day), so the sessions run on that commit, in a worktree of its own
beside the repository:

```bash
git fetch origin
git worktree add --detach ../cadence-playtest-lab c16b5a6
cd ../cadence-playtest-lab
```

A newer commit is fine only after the lab steps in section 3 have been walked again on it, and
the commit used is noted in the readout. All three sessions run on the same commit; write it on
each observation sheet.

### Install and start

```bash
PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH pnpm install --frozen-lockfile
PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH pnpm dev    # serves http://localhost:5173
```

`pnpm dev` refuses to start when port 5173 is busy (another dev server or agent session). Then run
the lab on a free port instead and use that port everywhere below:

```bash
PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH node node_modules/vite/bin/vite.js apps/lab --port 5175 --strictPort
```

### Browser and GPU

- **Current Chrome on the machine that serves the lab.** The lab names its supported browsers:
  current Chrome, Edge or Opera; Safari 26 or later on a Mac with macOS 26 Tahoe or later; Firefox
  141 or later on Windows, or 145 or later on an Apple silicon Mac with macOS 26 Tahoe or later.
  Use Chrome: it is what this kit was checked on.
- **Once per session day**, open `http://localhost:5173/selftest.html` and wait for it to finish:
  after the first line (`adapter: …`), every line should start with `PASS`, none with `FAIL` or
  `ERROR`. Optionally, `chrome://gpu`
  should say "WebGPU: Hardware accelerated".
- **Stop other GPU-heavy work** on that machine during sessions: headless runs, agent sessions,
  other lab tabs. They share the GPU and slow the world down.

### Fallback when there is no WebGPU

WebGPU needs a secure context: `localhost` counts, a LAN address such as `http://192.168.1.20:5173`
does not, so a participant's own laptop cannot open the facilitator's server over Wi-Fi. In order:

1. Current Chrome with hardware acceleration on (Settings, System, "Use graphics acceleration when
   available"), then re-open `selftest.html`.
2. Seat the participant at the facilitator's machine instead.
3. A remote participant: share the facilitator's Chrome window over a video call with remote
   control granted. Note it on the sheet; the session counts if the lab itself does not fail.

Never use the LAN address and never use cadence.garden (no v1 there, see above).

### A dry run, once, before P1

The walkthrough was headless, so it could not try the Guest window, `chrome://gpu` or screen
sharing. Before the first participant, take ten minutes in a Guest window on the session machine:
do the steps below, play to the first pond cycle, try Feed once (section 3 says what happens),
then do section 2's end-of-session steps through to a downloaded session file. Delete that file
and close the window. If anything reads differently from this kit, fix the kit (outside section 6)
before P1.

### Before each participant sits down

1. Open a **new Chrome Guest window** (profile menu, Guest). It starts with empty site storage, so
   no earlier participant's saved copies show up, and it keeps no history when closed. If Guest is
   not available, use one spare Chrome profile and clear the site data for `localhost` between
   participants.
2. Open `http://localhost:5173/lab/?world=breeder&seed=S`, with `S` the seed chosen below.
3. Wait until the heading reads **The breeder** and the status in the top right reads **Paused**.
   The GPU chip at the bottom of the left column names the adapter (on the checked Mac:
   "apple metal-3").
4. Make the window at least 1,280 pixels wide, so the three columns (controls on the left, the
   field in the middle, the evidence on the right) sit side by side with no sideways scroll. At
   900 pixels tall, "Breed by hand" starts below "Plant a world" in the left column and "What
   happened first?" below "Who’s living here?" in the right one: finding them by scrolling is part
   of the test.
5. **Check the pace.** With Speed at its default, **×4**, press Play for about ten seconds and
   read the rate beside the step counter: about 220 steps/s on the checked Mac, one pond cycle
   (5,000 steps) every 20 to 25 seconds. Note the rate on the sheet. Then reload the page (same
   link), so the participant starts at `t = 0`; reloading puts Speed and the view back to their
   defaults.
6. Only if the rate read under 170 steps/s: move Speed to **×8** now, after the reload.
7. Show the **Lineages** view: the "Lineages" button under the field, or press `2` with nothing
   focused. The caption under the field then reads "Showing Lineages: one colour per lineage,
   brighter where there is more bound mass". (Stage 0a asks for the Lineages view on.)
8. Leave everything else as it loads, scrolled to the top: "Stop at each pond cycle and let me
   choose the donor ponds" unchecked, the dial ("The rule breeds for") as planted, no lineage
   kept, Look in the hand. Don't press Play.
9. Write on the sheet: the time, `uptime`'s load averages, the commit, the seed, the browser and
   the adapter.

### The seed

All three participants get the same seed, so every history starts the same and the differences
are theirs (this is for comparing what people do, not a causal test; see "What this cannot say"
in section 6). The
rule, fixed before any session: use **seed 1** if, with nobody touching it, the breeder world on
seed 1 has at least 8 of 16 ponds occupied at every pond cycle from 1 to 30 (t = 5,000 to
150,000); otherwise try seed 2, 3 and so on, and use the first that passes. The check was run
while writing this kit and seed 1 passed (fewest occupied ponds 12 of 16; see the end of this
note), so **S = 1**: the link is `http://localhost:5173/lab/?world=breeder&seed=1`.

## 2. Facilitator script (about 30 minutes)

Read the words in quotation marks as written. Everything else is for you.

| Part | Minutes | Clock |
| --- | --- | --- |
| Welcome and consent | 3 | 0:00 |
| Think-aloud, with one practice | 1 | 0:03 |
| Task 1 | 2 | 0:04 |
| Task 2 | 6 | 0:06 |
| Task 3 | 4 | 0:12 |
| Offer to stop, then watch | up to 3 | 0:16 |
| Pause, then the questionnaire | 5 | 0:19 |
| You save the session file | 1 | 0:24 |
| Debrief | 3 | 0:25 |

Tasks 1 to 3 are the twelve-minute core that section 6 counts.

**Welcome and consent (read).** "Thanks for doing this. I'm trying out a small simulation of
artificial life, and I want to see what it's like for someone who hasn't used it. I'm testing the
thing, not you: there are no wrong answers, and if something is confusing, that's what I need to
know. It takes about half an hour. I'll take handwritten notes and keep the file the simulation
saves at the end. I won't write down your name, and I won't record audio or video. Afterwards I'll
write up what I learned in a note that is public on the internet, with short quotes of what you
said, under a code like P1 and never with your name; I'll cut anything that would point to you.
You can stop at any time, without saying why, and you can ask me later to leave you out. The note
goes up at least a week after the last session: until then I can take your part out completely.
After that I can still cut it, but the website keeps a history of its old versions, so an earlier
copy would stay there. Is that all right?" Wait for a clear yes; without one, thank them and stop.

Only if you want a recording, and only after that yes (read): "Would you also be all right with me
recording [the audio / the screen] while you play? It's fine to say no." Write the answer on the
sheet. The default is no recording.

Then ask (read): "Have you used this simulation before, or the website it comes from?" (Ask it when
you invite them, too.) A yes means they are not a participant in this test (section 6): thank
them, let them play if they'd like, but take no notes, keep no file and give no P-code. For a no,
write their P-code (P1, P2, P3, in order; replacements P4, P5) on the sheet, never their name.

**Think-aloud (read).** "While you use it, please say what you're thinking out loud: what you're
looking at, what you're trying to do, what you expect to happen, anything that surprises you.
Let's practise: tell me what you think this screen is for." Let them answer, say "Thanks, just
like that," and nothing more.

**During the tasks: what you may say.**

- If they go quiet for about 20 seconds: "What are you thinking?"
- If they say something short you want more of: "Say more about that."
- If they ask what something does or how to do something: "What do you think it does?" or
  "What would you try?" If they ask the same thing a **second time**, answer in the fewest words
  that name where to look (not what to choose), and mark that control **prompted** on the sheet:
  every later use of it in the session is marked **P** too, and its verb does not count for D.
- Nothing else. Don't name a control, a panel or a word on the screen; don't praise or react to
  what grows; don't explain the pond cycle.

**When to stay silent.** While the world runs and nothing is asked. While they read a panel. When
they hesitate: count to 20 before the prompt above. When something fails: note the time and what
the page says, and only then say "That's the simulation, not you; let's stop here." A failure of
the lab means the session does not count (section 6).

**One alert is not a failure.** Feed and Drain are refused on this world: a click with either shows
"This world has stopped" with the text "feeding is not defined for pond worlds: the pond cycle
fixes each pond's matter", and the world pauses. Nothing is broken. Log it as **feed-refused** or
**drain-refused**, say nothing, and let them find Dismiss and Play; if they ask twice, the usual
rule applies ("the button under the message", then Play). The session goes on.

**When they use the lab's history controls.** Pressing "Plant it again" or "Plant this world",
reloading the page, restoring or jumping to a copy under "Keep a copy" (the lab saves one by itself
every 20,000 steps), or opening a saved file all start or fork a history. Typing a new seed number
or choosing another world does not: nothing changes until Plant is pressed (the note under it says
"Not planted yet: …"). Don't stop them and don't comment. Log it with code **history** and what
they pressed once the new world is on screen, start a new block in the per-cycle table from that
point, and go on with the tasks on the clock. The session file and the card then describe only the
history that was on screen at the end.

**If they stop early.** Someone who uses "stop at any time" during the tasks keeps their session:
go straight to the questionnaire if they are willing, and write the clock time they stopped. Only
someone who also asks to be left out is withdrawn (section 7).

**Offer to stop (read, at 0:16).** "That's all the tasks. You can stop here, or keep going for a
bit if you'd like." Start the timer. If they keep going, stay silent and let them play up to three
minutes; write down how many seconds they played after the offer (section 6, item B). If they
stop, write 0.

**Pause, then the questionnaire (at about 0:19).** If the transport button reads "Pause", press
it; leave a waiting pond cycle waiting and touch nothing else. Note whether the Session card
button is lit. Turn the screen away from the participant (remote: stop sharing the window, and
keep it stopped through the session file) and ask the questions in section 5 in order, word for word, writing the answers in their words. The card and the file come after the
questions, so that nothing on them feeds the answers.

**The session file (you, at about 0:24, the participant's screen still turned away).**

1. If a pond cycle is waiting (a bar under the field offers "Breed from N ponds"), the file can't
   be made yet. If the transport button reads "Run after breed", hover it: if its tooltip starts
   "On:", press it once (it then starts "Off:") so the world stays paused afterwards. Then press
   "The rule’s choice", "Breed from N ponds" and confirm, and mark that cycle **F** in the
   per-cycle table. The button then reads "Play" and `t` stays at the cycle's step.
2. Press **Session card** (bottom of "What happened first?"), then **Download session file**.
3. Read the note under the button. "Saved …": copy the receipt fields onto the sheet (section 4)
   and close the card. A note that a pond cycle is waiting (saving can run the world on to its next
   census, which may be a cycle): close the card, do step 1 again and retry. Any other note, or a
   button that stays disabled: copy what it says onto the sheet in place of the receipt and go on.
   The receipt is not one of section 6's items.

**Debrief (3 minutes, after the questionnaire).** Now you may answer their questions and explain
anything. Nothing they say here is scored. Give them a slip with their P-code, and
say (read): "If you'd rather be left out later, tell me this code and I'll take your part out.
Before the date on this slip, it all goes; after it, I cut it from the note, but an old version
stays in the site's history." Write on the slip the earliest date the readout may be committed
(a week after the last planned session; section 7). Thank them.

**After they leave.** Score section 6's items A to F from the sheet, before the next participant,
and write their words beside each score. Close the Guest window. Move the session file into the
playtest folder (section 7).

## 3. Tasks

Say each task as written, at its time on the clock. The tasks name goals, never controls.

1. **Task 1 (2 minutes):** "Start it running and tell me what you see. Don't change anything yet."
2. **Task 2 (6 minutes):** "Grow something you like."
3. **Task 3 (4 minutes):** "Now try to get things that move, and keep as much alive as you can
   while you do it."

If they can't find how to start it in Task 1, the usual rule applies: after the second ask, "the
button at the top of the field".

**What you'll see, for your eyes only.** These are the controls and the words the lab shows, so
you can log what they used; never read them out.

- **Task 1.** Play starts the world (`t = …` counts up). The status line under the run strip
  reads "breed · cycle every 5,000 steps" until the first cycle, then "cycle 1 · breed · donor
  ponds …": at each pond cycle every pond is cleared and reseeded from a few donor ponds. The
  three charts under "How it’s going" get a dashed line at each cycle.
- **The firsts come early on this world.** In the walkthrough on seed 1, ten firsts were in
  the log by t = 8,600 (under a minute at ×4), up to "Tenth generation", "First huge body" and
  "Second takeover", after three marked "Already there when watching began", and by t = 15,200
  "What’s next?" showed a single rung left, "First lineage to last 20,000 steps". So most firsts
  land during task 1, before the participant has touched anything, and the log changes little
  after that. That is the lab as it stands; score item C as
  section 6 says, and note in the readout when the log was already full.
- **Task 2: the controls a participant may find.**
  - The checkbox **"Stop at each pond cycle and let me choose the donor ponds"** in "Breed by hand".
    At the next cycle the world stops: the status at the top right reads "Cycle N: choose the
    donors, then the world runs on" (without the second half if the world was paused), Play reads
    "Run after breed", and a bar under the field reads
    "Cycle N: Breed clears all 16 ponds and reseeds them from ponds a, b, c, d, in that order."
    The panel reads "Cycle N at t=… is waiting. K of 16 ponds are occupied. The rule’s choice
    ranks them by …" (copy K into the per-cycle table). At the same moment the lab puts a sixth
    tool, **Pick**, in the hand in place of whatever they held (so a click that was a wound
    now picks a pond), and zooms the field out once to show all 16 ponds. That is the lab, not
    the participant: log only what they do next. After Breed the hand goes back to the tool they
    held before.
  - **The donors start filled in with the rule's choice** (adjusted by Keep when a lineage is
    kept: the pond holding most of it replaces the rule's last donor). While they are untouched
    they follow a dial or Keep change made while the cycle waits. So pressing "Breed from 4
    ponds" without changing anything accepts that default (log it **R**, and note "Keep" when a
    lineage was kept). Picking by hand:
    clicking ponds on the field to add or remove them, "Clear" (the bar then reads "Cycle N waits
    for its donors. Select ponds on the field."), or "Top 4 by the rule’s score" (the button
    follows "Rank the ponds by": "The rule’s score: …", "Speed", "Seed packet", "Body size",
    "Bound mass", "Moving mass", "Reach to the edge"). Breed asks "Replace all 16 ponds with seed
    from ponds …? This cannot be undone." with "Breed from N ponds" and "Keep picking". Afterwards
    the status line reads "cycle N · by hand · donor ponds …".
  - **The dial**, "The rule breeds for", with "Set for the next cycle"; once set, it reads
    "Set 1 time; in force from cycle N". Its options: "As planted: Moving mass, seed packet, body
    size together", "Bound mass", "Moving mass", "Reach to the edge", "Seed packet", "Body size",
    "Moving mass, seed packet together".
  - **Breed on its own:** "1 cycle", "5 cycles", "20 cycles", "Until I stop it", "Stop". Until
    the checkbox is on, it says "Turn on “Stop at each pond cycle” first". Running, it reads
    "Auto-breeding: cycle 1 of 5"; stopped by hand, "Stopped: you pressed Stop after 1 cycle."
  - **Keep a lineage:** "Keep" beside a lineage in "Biggest lineages", "Keep this lineage" on a
    cell looked at with Look, or "Keep for breeding" in a lineage's drawer (Look, click a cell,
    "Open its lineage"). The panel then says where it lives:
    "Waiting for the next cycle to say where it lives.", "Lives in pond N", or "Gone from the jar
    as of cycle N: the rule’s donors stand." (lineages come and go fast on this world).
  - **In your hand:** Look, Wound, Feed, Drain, Move (and Pick while a cycle waits). Wound works:
    a toast reads "Wounded a patch, radius 10 · 1 change by hand, unsaved". **Feed and Drain are
    refused on this world:** the first click pauses the world and shows "This world has stopped",
    "feeding is not defined for pond worlds: the pond cycle fixes each pond's matter", "The world
    is paused. Your saved copies are still listed under Keep a copy." and a Dismiss button; the
    status reads "World stopped". Dismiss, then Play, and the world runs on unchanged (section 2
    says how to handle it). The card counts no feed or drain for it.
  - **The world's summary** sits under "Plant a world" in the left column: "Can we breed ponds
    toward a trait we can see?", then lines including "Ponds cleared and reseeded every 5,000
    steps". Tick on the sheet if they read it aloud: it tells them part of what question 6 asks.
  - **What happened first?**: the log of firsts, "What’s next?" with three rungs and progress
    bars, and **Session card**. After ten minutes of growing the card's button lights, unless
    the card was already opened in this history, and its hint reads "Ten minutes of growing: the
    card sums it up and the file replays it." It counts only time the world runs in a visible tab
    with no cycle waiting, so with the checkbox on and long waits at cycles it may not light within
    the core.
- **Task 3.** Ways to go after movement: the dial on "Moving mass" then Set; "Rank the ponds by"
  Speed or Moving mass and "Top 4 by …"; picking fast ponds by eye. Auto-breed follows the dial
  and Keep, not the ranking menu or a list of donors picked by hand: those take effect only when
  Breed is confirmed.
  The 64-pond version of this world, bred for movement alone, bred real movement but left only 23
  of 64 ponds occupied (the world's own note, 4 Oct); this 16-pond world has not been measured.
  The tension between the two halves of the task is the point.

## 4. Observation sheet

One sheet per participant. Print this section.

**Header.**

| Field | Value |
| --- | --- |
| P-code | |
| Spoken consent to the session, notes, session file and public quotes | yes, at (time) ____ |
| Used the lab or cadence.garden before? (asked at the welcome) | no (a yes is screened out, with no sheet) |
| Date and start time | |
| Commit | |
| Seed | |
| Browser and adapter (GPU chip) | |
| `uptime` load averages, before | |
| Steps/s at ×4 before the session | |
| Remote (screen share)? | yes / no |
| Audio or screen recording consented? | no (default) / yes: what |

**Timed log.** One line per thing they do or say that matters. Verb codes for section 6, item D:
**dial** (set the dial), **auto** (breed on its own), **keep** (keep a lineage), **hand** (Breed
pressed with donors they chose), **wound**. Judge **hand** against **rule** by the donor list at
the moment Breed is pressed, order included, against the rule's choice at that moment (what "The
rule’s choice" would fill in then, after any dial or Keep change made while the cycle waited): if
it differs, it is **hand**, however they got there (ponds clicked on the field, "Clear", or "Top 4
by …" on another ranking); if it is the same list in the same order (untouched, "The rule’s
choice", or clicked off and back on in the same order), it is **rule**, which is not a verb. So
setting the dial while a cycle waits and accepting the donors that follow it is **dial** plus
**rule**, not **hand**. Also
logged, but not verbs: **feed-refused** and **drain-refused** (section 2), **history** (section
2), turning the checkbox on, changing views, and Look. Mark **P** on every use of a control after you
answered a repeated question about it, for the rest of the session (prompted: that verb is not
counted for D, even if it is used again later).

| Clock | What they did | What they said (their words) | Verb | P? |
| --- | --- | --- | --- | --- |
| | | | | |
| | | | | |
| | | | | |

**Per pond cycle.** The status line says "by hand" for every cycle answered with Breed or by
auto-breed while the world was stopped (a hand pick, the filled-in donors, "The rule’s choice",
auto-breed), and "breed" for a cycle the world ran through with the checkbox off. Two cases also
read "breed": unticking the checkbox while a cycle waits (the rule's own donors are applied; log
it **W** and note "unticked"), and a cycle with no occupied pond, which never stops. The session
file can't tell an auto-breed answer from a hand pick either, so this table is the only record of
who chose.

| Cycle | t | Who chose: H (hand), R (the filled-in default or "The rule’s choice"), A (auto-breed), W (world: checkbox off, or unticked while waiting), F (facilitator) | Occupied ponds (K of 16, when it stopped) | Notes (Keep in force?) |
| --- | --- | --- | --- | --- |
| 1 | 5,000 | | | |
| 2 | 10,000 | | | |
| 3 | 15,000 | | | |

At ×4 a twelve-minute core can pass 25 or more cycles. Cycles the world ran through can share a
row ("cycles 1 to 8: W"); every cycle that stopped gets its own row with K.

**Seen or not (tick, with the clock time).**

- [ ] Looked at or read the "What happened first?" log
- [ ] Looked at or read "What’s next?"
- [ ] The Session card button lit during play
- [ ] Opened the Session card themselves
- [ ] Opened a lineage's drawer
- [ ] Changed the view away from Lineages
- [ ] Read the world's summary under "Plant a world" aloud
- [ ] Used a history control (**history** in the log): which ____
- [ ] Stopped early, at clock ____
- [ ] Seconds played after the offer to stop: ____

**Receipt** (from the card and the file, after the session).

| Field | Value |
| --- | --- |
| Session file name (`breeder-s<seed>-<run>-t<step>.session.json`) | |
| `final.step` | |
| First 12 characters of `final.stateHash` | |
| The card's cycle line ("N cycles: … with your donors, … the rule’s own", with "… ran without stopping for you" when any did) | |
| The file's `replay` command, copied (or "in the file") | |

The file holds the history's interventions in order, but it logs an auto-breed answer as an
ordinary pick, and the card counts a cycle as "with your donors" whenever the donors differ from
the rule's order, so a cycle that Keep changed counts as yours. Read who chose from the per-cycle
table, not from the file or the card.

## 5. Questionnaire

Ask in this order, word for word, right after the pause and before the card or the file, with
the screen turned away. Write the answers in their words. Don't prompt beyond "Say more about that."
The screen is away on purpose: questions 1 and 2 ask what stayed with them, not what they can read
off the page now, and section 6 scores them that way.

1. "What happened in the jar, from the start to the end?"
2. "Did anything change? If so, what?"
3. "How much fun was it, from 1, not fun, to 5, a lot of fun?" ____
4. "What was the best moment? And the most boring moment?"
5. "Would you play this again on your own time?" yes / maybe / no
6. "What do you think happens at a pond cycle?"
7. "Was there anything you wanted to do and couldn't?"

## 6. What counts, fixed before any session

### Which sessions count

Only someone who says at the welcome that they have not used the lab or cadence.garden before is
a participant; anyone else is screened out there and takes no P-code and no replacement. A
participant's session counts when they start the core (tasks 1 to 3) on the breeder world at the
pinned commit, and the lab does not fail for a reason outside the participant's play: WebGPU lost,
the page crashed or froze, or a "This world has stopped" alert whose text is anything other than
"feeding is not defined for pond worlds: the pond cycle fixes each pond's matter". That one alert
is the lab refusing Feed or Drain on this world (section 3); it is play and the session counts. So
is a jar the participant emptied, by wounds or donor choices, and so is any use of the history
controls (section 2): the items are scored from everything they did and said, the per-cycle table
has a block for each history, and the receipt covers the history on screen at the end.

A session ends short in one of three ways, each decided here:

- **The lab fails** (as above): not counted, replaced.
- **They withdraw their data** (section 7): not counted, replaced, and nothing of it is kept.
- **They stop early by choice** and let their session stand: counted. Items A, C, E and F are
  scored from whatever they said and answered, D from the verbs they used before stopping, and B is
  **No**. Replacing a bored participant would hide exactly what this test looks for.

A question not answered (an early stop who skips the questionnaire, or "I'd rather not say") is
scored low, never left out: A **Nothing** when question 1 is unanswered (written "Nothing (not
answered)"), B **No**, F **No**, and C
from the think-aloud and whichever of questions 1 and 2 were answered (the think-aloud alone when
neither was). E is "not answered": the median rating is taken over the ratings
given, with how many there were ("median 3, from 2 ratings"), "rated low" counts only ratings
given, and an unanswered boring moment is in no bin.

A session is replaced at most twice; with fewer than three counted sessions the readout says
"incomplete" and gives no verdict.

### Items scored per participant

The facilitator scores each item from the observation sheet and the questionnaire right after the
session, before the next one, and writes the participant's own words beside the score. No item is
scored from memory later. When unsure between two scores, give the lower one (for A: Lattice or
Nothing, not Change; for B, C and F: No) and write why; the readout keeps the words beside every
score, so a second reader can re-score from it.

| Item | Read from | Scored as |
| --- | --- | --- |
| **A. What happened** | Question 1, asked first, before any other question, with the screen turned away: "What happened in the jar, from the start to the end?" | **Change**: names at least one change over time in what lives in the jar, specific enough that the facilitator could point at it on the field or a chart (bodies got bigger, started moving, split, one colour took over, a pond kept dying). Example: "the blobs got bigger and then some started wandering off". **Lattice**: the main thing said is a grid, a pattern or repeated dots, with no change in the life itself. Example: "it's squares with dots in them that sort of flicker". **Nothing**: nothing happened, it was random, or cannot say. Example: "stuff moved about, I don't really know". Changes the participant made by hand ("I wiped that pond"), or the pond cycle's reseeding on its own ("every so often it resets"), are not a change in what lives there. |
| **B. Wants to play again** | Question 5 ("Would you play this again on your own time?") and the offer to stop at the end of task 3 | **Yes** when they answer yes, or answer maybe and kept playing for 60 seconds or more after the offer to stop. **No** otherwise, and always **No** for someone who stopped early by choice. |
| **C. Points at the firsts** | Think-aloud notes during tasks 1 to 3 and after the offer to stop; and the answers to questions 1 and 2, which are given from memory | **Yes** when, without the facilitator naming it, they use the "What happened first?" log, its What's next ladder or the session card to say what changed: reading or pointing at an entry while saying what changed during play ("look, it says first split, they've started splitting"), or using a first's or a rung's own words to say what changed in questions 1 and 2 ("it got to tenth generation"). **No** otherwise. Reading or pointing at the log without tying it to a change ("what's 'Already there'?") is **No**, written as "noticed only", so the readout can tell noticing from use. |
| **D. Reaches for the verbs** | The observation sheet's verb column | The number of distinct verbs used during tasks 2 and 3, out of five that work on this world: set the pressure dial, breed on its own, keep a lineage, breed from donors picked by hand, wound. Feed and Drain are refused on this world (section 3): attempts are reported beside D ("tried: feed") but not counted. The tasks name goals, never controls, so every use counts as unprompted unless the participant asked twice and the facilitator answered (section 2): from then on that control is prompted, and its verb is not counted for D however often it is used afterwards. |
| **E. Fun** | Question 3, 1 (not fun) to 5 (a lot of fun), and question 4 (best moment, most boring moment) | Reported as given. The rating is used only in the next-build table ("rated low"); the most boring moment is put in one of four bins, fixed here: **waiting** (slow, waiting, nothing happening for a while), **couldn't tell** (couldn't tell what it was, what changed or what to look at), **nothing to aim for** (no goal, nothing to do, what I did didn't matter), **other**. |
| **F. Understands the cycle** | Question 6: "What do you think happens at a pond cycle?" | **Yes** when they say in their own words that some ponds are copied into, or seed, the others. Example: "the best few get copied into all of them". **No** otherwise, for example "it resets" or "everything dies". Scored the same when they read the world's summary aloud (sheet tick), but the readout marks it "after the summary". |

### Verdicts over the three counted sessions

| Question | Pass | Fail | Otherwise |
| --- | --- | --- | --- |
| **Fun**: do newcomers see change and want more? (Stage 0a's pass rule, on v1) | All three score Change on A and Yes on B | Two or more score Lattice or Nothing on A, or two or more score No on B | Mixed |
| Does the firsts log help? (Stage 0b's question) | Two or three score Yes on C | None scores Yes on C | Weak (one of three) |
| Are there enough things to do? (the user's v0 note) | Two or three use two or more verbs (D) | None uses two or more | Thin (one of three) |
| Is the pond cycle legible? | Two or three score Yes on F | None scores Yes | Gap (one of three) |

The Fun row is the brainstorm's Stage 0a rule ("each can name a change they saw and wants to play
again"); it does not use the 1 to 5 rating, which is why the row is named for what it measures and
the rating is reported beside it. Its fail side deliberately needs two of three: the brainstorm's
sentence ("fail if they describe a lattice or nothing") can be read as one person failing the
test, but with three people one Lattice is one person's reading, and Mixed keeps it visible
without deciding the next build alone. The user's own v0 run ("basically a pass") was one person
and is not comparable on this rule. B's "maybe plus 60 seconds" stays: a minute of play after a
neutral offer to stop is behaviour, which politeness moves less than an answer.

The firsts row reads a confounded measurement on this world: most firsts land during task 1,
before the participant has touched anything (section 3). A Weak or Fail says that people do not
use a log that is mostly written before they look, not that firsts cannot help, and the
next-build row below answers that reading.

The family tree (Pond keeper v2, PR #31) is not on main and is not tested. If it merges before
the first session, a dated amendment here adds an item "points at the tree", scored as C, before
that session; if it merges after the first session, all three sessions stay on the pinned commit
and the tree waits for another round.

### What each result changes in the next build

"Two or more" below means two or more of the three counted sessions. The **boring bin** is the E
bin (waiting, couldn't tell, nothing to aim for) that two or more participants share; when no bin
is shared by two, there is no boring bin.

| Result | Next build |
| --- | --- |
| Fun Pass and firsts Pass | Carry on with Stage 0b as planned: land the family tree, then run this kit again with the tree item. |
| Fun Pass, and two or more rate it 1 or 2 on question 3 ("rated low") | Stakes, as in the Fun Fail on B row below, alongside whichever firsts row applies. |
| Firsts Weak or Fail (any Fun result) | Stop adding rungs to the ladder; bring the firsts to the jar (said on the field when they happen) before any new detector. |
| Fun Fail on A, two or more Lattice | Legibility before mechanics (§7's "Nothing visibly changes"): how a lineage or a body reads in the jar comes first, and the result counts for the brainstorm's argument in §9, decision 3, for going straight to tracks. |
| Fun Fail on A, two or more Nothing | Pace: a breeder world sized so a cycle and its change come faster, as a new world beside `breeder`, not a change to it. |
| Fun Fail on A, exactly one Lattice, one Nothing and one Change | The boring bin decides: waiting is the Pace row, couldn't tell is the Legibility row, nothing to aim for is the Stakes row. No boring bin: the Legibility row. |
| Fun Fail on B (whatever A scored) | Stakes (§7's "No stakes"): goals and their payoff, such as naming and keeping a species, before more verbs. When A fails as well, A's row comes first and this one second. |
| Fun Mixed | The boring bin decides: waiting is the Pace row, couldn't tell is the Legibility row, nothing to aim for is the Stakes row. No boring bin: no build from the Fun result; the other rows decide. Either way, no physics work (Stage 1) on this result alone. |
| Verbs Thin or Fail | The verbs are not found: move the dial and auto-breed beside the jar before adding any. |
| Cycle Gap or Fail | Say what a pond cycle does on the field at the first cycle. |

Every combination of verdicts matches at least one row, and the three A rows never overlap: two
or more Lattice, two or more Nothing, or exactly one of each with one Change. More than one row
can apply; the readout lists every row that does, in this table's order.

### What this cannot say

Three people, who probably know the facilitator, are a gut check, not a measurement. No result
here says that a participant's choices bred anything: the breeder's own notes warn that
reordering four donors changes a whole history, so that question belongs to matched rule and
random pickers across seeds (`tools/run.ts --picker`), not to a playtest. In the shared
vocabulary of the journal and the Worlds catalogue (`DESIGN.md`), any result of this kit is
**Seen**, never Measured or Confirmed, whatever its Pass or Fail here.

## 7. Consent and privacy

- **Consent is spoken and recorded on the sheet** with the script in section 2: what the session
  is, about half an hour, handwritten notes, the session file kept, no name written down, a public
  note with short quotes under a P-code, stop at any time, and ask later to be left out: completely
  until the note goes up (no sooner than a week after the last session), after which the site's
  history keeps the old version. No yes, no
  session.
- **No recording by default.** No audio, video or screen recording unless the participant agrees
  to it separately, after the main consent, with section 2's optional line, and the sheet says
  what was recorded. A recording stays with the facilitator, outside the repository, and is
  deleted once the readout is written.
- **P-codes only.** The sheets, the file names and the readout carry P1, P2, P3 (and P4, P5 for
  replacements). No names, initials, ages, jobs or anything else that would identify someone, in
  the repository or in a file name, and no written list that links a P-code to a person. The
  participant holds the link instead: the slip with their P-code from the debrief. Quotes in the
  readout are cut where they name a person, a workplace or a place, or say something that would
  let someone who knows the facilitator tell who it was.
- **Where the files go.** Session files and scanned sheets go in a folder outside the repository,
  for example `~/cadence-playtest-2026-10/P1/`. Not in `runs/`, not in git, not in a shared
  drive. The Guest window's own copies vanish when it closes. The readout's optional replay
  (section 8) writes a run bundle under `runs/`, which git ignores; it carries the world's history
  and nothing about the participant, and is deleted with the session file if the participant
  withdraws.
- **The file name is a timestamp.** `breeder-s1-<run>-t<step>`: `<run>` is the planting time in
  base 36, to the millisecond. It goes on the sheet, never in the readout or a commit; the readout
  names each receipt by its P-code. Each session's date also stays on the sheet; the readout gives
  only the week the round ran.
- **What the session file holds.** The world's settings, seed, ordered interventions, firsts and
  card, and three things about the session itself: `createdAt` (when it was saved), `adapter` (the
  GPU's name, such as "apple metal-3") and `runId`, whose last part encodes when the world was
  planted. Nothing the participant typed or said, no browser or device details beyond the GPU
  name. Tell the participant this if they ask.
- **No request left `localhost` in the walkthrough.** The lab's page counter (Plausible, on the
  project's own server) does not report from `localhost` by default, and in the walkthrough a
  whole session made 222 requests, none of them off `localhost`. Re-check in Chrome's network
  panel during the dry run (section 1). A remote session is different: the shared window goes
  through the video call's service, so say so in that participant's consent ("your view of the
  screen goes through [the call service]").
- **If asked, leave them out.** A participant who quotes their P-code and asks to be left out has
  their sheet, file, any replay bundle and quotes deleted, and the readout records the session as
  withdrawn, with no reason given. Before the readout is committed that removes everything. After
  it, their quotes and scores are cut in a new commit, but the repository is public and its history
  keeps the earlier version (the consent script and the slip say so). To keep that window open a little, the readout is
  committed no sooner than a week after the last session.

## 8. Readout template

Copy this into a dated readout note under `docs/` after the third counted session, and commit it
no sooner than a week after the last session (section 7). Score from the sheets; don't re-score
from memory.

**Sessions.** The week the round ran (not each session's date, which stays on the sheets), the
commit the sessions ran on, the commit that froze section 6 and its
SHA-256 as checked before each session, seed, machine and adapter, load averages before each
session.

| P-code | Counted? (if not, why) | New to the lab (asked at the welcome)? | Remote? | Stopped early? (clock) | History controls used | A. What happened | B. Play again (seconds after offer) | C. Points at the firsts (or noticed only) | D. Distinct verbs (which; tried and refused) | E. Fun 1 to 5; best; most boring (bin) | F. Cycle (after the summary?) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | | | | | | | | | | | |
| P2 | | | | | | | | | | | |
| P3 | | | | | | | | | | | |

**Their words.** For each P-code, verbatim: the answers to questions 1, 2, 4, 5, 6 and 7, the quote
behind the C score, and the seconds played after the offer to stop. Mark any question not answered
"not answered".

**Who chose each cycle.** For each P-code: cycles that were H, R, A, W and F, from the per-cycle
table, and the occupied ponds at the last stop.

**Verdicts** (section 6's table, filled in).

| Question | Verdict | Counts behind it |
| --- | --- | --- |
| Fun: do newcomers see change and want more? | Pass / Fail / Mixed (median rating on question 3: __, from __ ratings) | |
| Does the firsts log help? | Pass / Fail / Weak | |
| Are there enough things to do? | Pass / Fail / Thin | |
| Is the pond cycle legible? | Pass / Fail / Gap | |

**Next build.** Every row of section 6's "What each result changes" table that applies, in that
table's order, quoted.

**Receipts.** For each P-code: `final.step` and the first 12 characters of `final.stateHash`. Not
the session file name: its middle part is the planting time in base 36 (`runId`), which dates the
session to the millisecond, so the file name, `createdAt` and the file stay on the sheet and in
the private folder (section 7). Optionally, a replay of each file on a machine with a GPU, from the repository
root: the command the file states in its `replay` field (also shown under "Download session file"
once it is saved), with the file's path after `--picks-from`. It writes a run bundle under
`runs/` and should print "matches the lab's checkpoint at t=…" with the state hash. Note which
P-codes' files were replayed.

**Excluded and replaced sessions**, each with its reason.

**Caveats.** Three people, probably known to the facilitator, scored by one facilitator who knows
what the kit hopes for. A result here is Seen, never Measured (section 6). The firsts log fills
during task 1 on this world (section 3), so C reads whether people use a log that is mostly
already written; say when each participant's log was already full. The Fun rule needs two of
three to fail, where the brainstorm's sentence can be read as one (section 6). The seed was the
same for everyone. An A score from an unanswered question 1 is written "Nothing (not answered)",
so a Pace row reached that way can be read as such. Anything that went differently from this kit.

## How this kit was checked

On 2026-10-18 the lab steps in sections 1 to 3 were walked by a script driving Chrome (headless,
WebGPU on, through Playwright) against the lab served from a checkout of main at `c16b5a6` on a
spare port, on an Apple silicon Mac (adapter "apple metal-3") that was busy with other work (load
averages between 56 and 147 during the walk). A second, shorter walk the same day (load averages
40 to 46) covered the reload, Feed and Drain, the Pick tool and the end-of-session path, after
review. The scripts and their screenshots are kept outside the repository and are not committed;
the pull request that adds this note points at them. The lab was served with section 1's
busy-port command (on port 5176). Not walked, since the walk was headless: the Guest window,
`chrome://gpu` and screen sharing. Section 1's dry run covers them.

- **The page.** `/lab/?world=breeder&seed=1` loaded with the heading "The breeder", the status
  "Paused", "Breed by hand" with "The rule breeds for" and the checkbox unchecked, the seven dial
  options quoted in section 3, "None kept. …" under Keep a lineage, and "What happened first?"
  with three rungs under "What’s next?". Pressing `2` switched the view to Lineages, and it stayed
  on through every later step.
- **Speed.** With the default ×4 the rate read "220 steps/s · 58 fps", one cycle about every 23
  seconds. The rate is the multiplier times the frame rate: ×2 read 120 steps/s, ×8 459 and ×16
  851, all near 60 fps. The rest of the walk ran at ×8.
- **Task 1.** Play with nothing changed: "cycle 1 · breed · donor ponds 6, 7, 15, 2" at t = 5,000.
- **Stopping at a cycle.** With the checkbox on, cycle 2 stopped with "Cycle 2 at t=10,000 is
  waiting. 16 of 16 ponds are occupied. The rule’s choice ranks them by moving mass, seed
  packet, body size.", the donors filled in, and the status "Cycle 2: choose the donors, then the world runs
  on". Clicking four ponds on the field and pressing Breed asked "Replace all 16 ponds with seed
  from ponds 5, 6, 9, 10? This cannot be undone."; confirming gave "cycle 2 · by hand · donor
  ponds 5, 6, 9, 10".
- **The dial.** "Moving mass", "Ranks ponds by moving mass: the best-ranked ponds become the
  donors.", "Set for the next cycle", then "Set 1 time; in force from cycle 3".
- **Keep and auto-breed.** Keep on the first of "Biggest lineages", "5 cycles", "Auto-breeding:
  cycle 1 of 5", Stop, "Stopped: you pressed Stop after 1 cycle." The kept lineage was then "Gone
  from the jar as of cycle 3: the rule’s donors stand."
- **The hand.** Wound, Feed, Drain and Look each said what they do under "In your hand". A wound
  on the field gave the toast "Wounded a patch, radius 10 · 1 change by hand, unsaved". A click
  with Feed, and then with Drain, each paused the world with "This world has stopped" and "feeding
  is not defined for pond worlds: the pond cycle fixes each pond's matter", status "World
  stopped"; Dismiss, then Play, and the world ran on (t went on climbing, no alert). The card
  later counted 1 wound, 0 feeds, 0 drains.
- **Reload.** After Speed ×8, the Lineages view and about 3,600 steps, reloading the same link came
  back "Paused" at t = 0 with Speed ×4 and the Everything view.
- **The world's summary.** Under "Plant a world": "Can we breed ponds toward a trait we can see?",
  then lines including "Ponds cleared and reseeded every 5,000 steps"; the button below reads
  "Plant it again".
- **A waiting cycle's hand.** At cycle 2 the hand gained Pick, selected in place of Look, with the
  keyboard note "Cycle 2 is waiting. The Pick tool is selected: select ponds on the field to choose
  donors."; after Breed the hand was back on Look.
- **The end of a session.** At that waiting cycle "Run after breed" had the tooltip "On: the world
  runs on once you breed"; one press made it "Off: the world stays paused once you breed". "The
  rule’s choice", "Breed from 4 ponds" and the confirm left the world paused at t = 10,000 with the
  button reading "Play" and "cycle 2 · by hand · donor ponds 7, 13, 12, 11". The card read "2
  cycles: 0 with your donors, 1 the rule’s own, 1 ran without stopping for you", and "Download
  session file" saved `breeder-s1-mvdhk4cr-t10000.session.json` at once, with `final.step` 10,000
  and the interventions `lesion@1840` and `pick@10000`.
- **The card and the file.** The card read "3 cycles: 1 with your donors, 1 the rule’s own, 1 ran
  without stopping for you" (the auto-bred cycle, its kept lineage gone, counted as the rule's
  own). "Download session file" saved `breeder-s1-mvdgenkw-t15300.session.json` (version 2, rule
  set `firsts-v1`, `createdAt`, `adapter` "apple metal-3"), and the note under the button gave the
  `deno run -A tools/run.ts … --picks-from …` command. The card's button was not lit: the walk
  took under three minutes.
- **Layout.** At 1,440 by 900 and at 1,280 by 800 the left column (with "Breed by hand"), the
  field and the right column (with "What happened first?") sat side by side with no sideways
  scroll; both panels start below the first screenful of their columns.
- **Network.** No request left `localhost`.
- **Self-test.** `/selftest.html` printed the adapter and 27 lines, all `PASS`.

**The seed rule** (section 1), run the same day at ×512, each stopped cycle answered with the
donors as filled in, the rule's own choice at every cycle:
**seed 1 passes.** All 30 cycles stopped; the fewest occupied ponds at any cycle was 12 of 16
(cycles 9, 12, 18, 23 and 26), and cycle 30 at t = 150,000 had 16 of 16. The card counted "30
cycles: 0 with your donors, 30 the rule’s own". At t = 150,000 "What’s next?" still showed one
rung, "First lineage to last 20,000 steps". A look at a cell there gave "Open its lineage", whose
drawer read "Census at t = 150,300. Ancestry replayed exactly from the mutation ledger." with
"Highlight on field" and "Keep for breeding". Load averages 87 at the start, 50 at the end.
**Use S = 1.**

## Amendments

None yet. A change to section 6 after the first session goes here, dated, with its reason.

### 2026-10-18: amendment to how section 6 reads its alert exception (Feed and Drain become a notice)

Reason: backlog slice 36 fixes the lab so that a Feed or Drain refused on a pond world is no longer shown as a
failure of the world. Section 6's text is not edited (its hash stands); this changes how its one alert exception
applies on a build that carries the fix. Before any session counts under it, it is dated here, as the Amendments
section asks.

From the lab build that carries slice 36 on, Feed and Drain on a pond world are refused as a short notice at the top
right of the field ("feeding is not defined for pond worlds: the pond cycle fixes each pond's matter"), and the world
keeps running: no "This world has stopped" alert, no pause, no Dismiss and Play. Where sections 2 and 3 describe that
alert for Feed or Drain, read the notice instead; the observation codes **feed-refused** and **drain-refused** stay as
they are, logged when the notice shows. Section 6 excepts that one alert because it was play, not a failure; on such a
build it no longer arises, so the exception has nothing to cover and any "This world has stopped" alert there is a
failure of the lab, as section 6 counts every other alert. A session run at a pinned commit from before slice 36
follows the kit as first written, exception included.
