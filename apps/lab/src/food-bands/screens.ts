/**
 * The food-schedule screens that /food-bands/ can run live.
 *
 * Source of truth: each tools/<dir>/explore.ts (arms, seeds, horizon, model). Every
 * entry below names the tool directories it came from; apps/lab/test/food-bands-screens.test.ts
 * parses those files and fails if a seed, mode or horizon here drifts from them.
 *
 * This file holds descriptions and identifiers only. Band geometry and pulse
 * budgets are read from each model at run time, never retyped here.
 */

/** Directory name under apps/lab/src that holds a hash-pinned model.ts copy. */
export type ModelKey =
  | 'hungry-shapes'
  | 'uniform-endurance'
  | 'moving-food'
  | 'stationary-food'
  | 'split-food'
  | 'alternating-food'
  | 'food-band-foothold'
  | 'food-schedule-769';

export type FoodModeId =
  | 'uniform'
  | 'moving-band'
  | 'stationary-band'
  | 'split-band'
  | 'alternating-band'
  | 'foothold-band'
  | 'schedule-769';

export interface ArmSpec {
  readonly id: string;
  readonly mode: FoodModeId;
  readonly label: string;
  /** One plain sentence: how food is offered in this arm. */
  readonly differs: string;
  /**
   * Recorded runs (file names under docs/creative-prototypes/) of this arm, by seed.
   * Several files per seed are alternative recordings of the same arm and seed.
   */
  readonly replays: Readonly<Record<number, readonly string[]>>;
  /** Shown only when the person ticks "also run" (no recorded paired arm exists for it). */
  readonly optional?: boolean;
}

export interface ToolSource {
  /** tools/<dir>/explore.ts */
  readonly dir: string;
  /** Seeds the tool accepts. */
  readonly seeds: readonly number[];
  /** Food modes the tool constructs worlds with. */
  readonly modes: readonly FoodModeId[];
  readonly maxTick: number;
  /** Where in explore.ts the arms and seeds were read from. */
  readonly provenance: string;
}

export interface ScreenSpec {
  readonly id: string;
  readonly title: string;
  /** The question the screen was run to ask, one sentence. */
  readonly question: string;
  /** What the choice in the picker means, in plain words. */
  readonly choiceText: string;
  readonly arms: readonly ArmSpec[];
  readonly seeds: { readonly primary: number; readonly replication: readonly number[] };
  /** Ticks the screen ran to (or to extinction). */
  readonly horizon: number;
  /** The model.ts the screen's own explore tool imports. */
  readonly ownModel: ModelKey;
  readonly sources: readonly ToolSource[];
  /** Note shown under the picker when the screen has a quirk worth knowing. */
  readonly note?: string;
}

const pair = (dir: string, seeds: readonly number[], modes: readonly FoodModeId[], maxTick: number, provenance: string): ToolSource =>
  ({ dir, seeds, modes, maxTick, provenance });

export const SCREENS: readonly ScreenSpec[] = [
  {
    id: 'uniform-food',
    title: 'Scarce food, spread evenly (6,000 ticks)',
    question: 'Does a world fed one scarce, evenly spread food budget keep its bodies alive to tick 6,000?',
    choiceText: 'One world. Every pulse offers 768 food units to random tiles over the whole 96 by 96 map. Runs to 6,000 ticks, twice as long as the original uniform page.',
    arms: [{
      id: 'uniform', mode: 'uniform', label: 'Scarce, spread evenly',
      differs: 'Food is offered to 768 tiles per pulse, chosen across all 9,216 tiles. There is no band.',
      replays: { 1201: ['uniform-food-seed-1201.json'], 1202: ['uniform-food-seed-1202.json'], 1203: ['uniform-food-seed-1203.json'] },
    }],
    seeds: { primary: 1201, replication: [1202, 1203] },
    horizon: 6000,
    ownModel: 'hungry-shapes',
    sources: [pair('uniform-food', [1201, 1202, 1203], ['uniform'], 6000, 'tools/uniform-food/explore.ts: runUniform(seed), MAX_TICK = 6000, seeds 1201 to 1203')],
  },
  {
    id: 'uniform-endurance',
    title: 'Scarce food, spread evenly (9,000 ticks)',
    question: 'Does the same evenly spread world keep going from tick 6,000 to tick 9,000?',
    choiceText: 'One world, the same food rule as the 6,000-tick screen, run 3,000 ticks further. The model is a copy with a longer population history.',
    arms: [{
      id: 'uniform', mode: 'uniform', label: 'Scarce, spread evenly',
      differs: 'Food is offered to 768 tiles per pulse across the whole map. There is no band.',
      replays: { 1201: ['uniform-endurance-seed-1201.json'], 1202: ['uniform-endurance-seed-1202.json'], 1203: ['uniform-endurance-seed-1203.json'] },
    }],
    seeds: { primary: 1201, replication: [1202, 1203] },
    horizon: 9000,
    ownModel: 'uniform-endurance',
    sources: [pair('uniform-endurance', [1201, 1202, 1203], ['uniform'], 9000, 'tools/uniform-endurance/explore.ts: runUniform(seed), MAX_TICK = 9000, seeds 1201 to 1203')],
  },
  {
    id: 'moving-food',
    title: 'A moving band against even food',
    question: 'Does confining the same scarce food to a 48-column band that slides east change how well bodies do?',
    choiceText: 'Two worlds, one seed. Left: food spread over the whole map. Right: the same budget confined to a band 48 columns wide that moves one column east every 50 ticks.',
    arms: [
      { id: 'uniform', mode: 'uniform', label: 'Spread evenly',
        differs: '768 food units per pulse over all 9,216 tiles.',
        replays: { 1201: ['moving-food-uniform-seed-1201.json'], 1202: ['moving-food-replication-uniform-seed-1202.json'], 1203: ['moving-food-replication-uniform-seed-1203.json'] } },
      { id: 'moving', mode: 'moving-band', label: 'Moving band',
        differs: 'The same 768 units per pulse, offered only inside a 48-column band whose left edge moves one column east every 50 ticks.',
        replays: { 1201: ['moving-food-moving-band-seed-1201.json'], 1202: ['moving-food-replication-moving-band-seed-1202.json'], 1203: ['moving-food-replication-moving-band-seed-1203.json'] } },
    ],
    seeds: { primary: 1201, replication: [1202, 1203] },
    horizon: 3000,
    ownModel: 'moving-food',
    sources: [
      pair('moving-food', [1201], ['uniform', 'moving-band'], 3000, 'tools/moving-food/explore.ts: new HungryWorld(1201,true,mode), run.mode uniform|moving-band, MAX_TICK = 3000'),
      pair('moving-food-replication', [1202, 1203], ['uniform', 'moving-band'], 3000, 'tools/moving-food-replication/explore.ts: runArm(mode, seed 1202|1203), MAX_TICK = 3000'),
    ],
  },
  {
    id: 'stationary-food',
    title: 'A moving band against a band that stays put',
    question: 'Is it the band moving that matters, or only that food is confined to a band?',
    choiceText: 'Two worlds, one seed. Left: the 48-column band sliding east. Right: the same band fixed at the left edge. Same food budget, same founders.',
    arms: [
      { id: 'moving', mode: 'moving-band', label: 'Moving band',
        differs: 'A 48-column band whose left edge moves one column east every 50 ticks.',
        replays: { 1201: ['stationary-food-replication-moving-band-seed-1201.json'], 1202: ['stationary-food-moving-band-seed-1202.json'], 1203: ['stationary-food-replication-moving-band-seed-1203.json'] } },
      { id: 'stationary', mode: 'stationary-band', label: 'Stationary band',
        differs: 'The same 48-column band, never moving: columns 0 to 47 only.',
        replays: { 1201: ['stationary-food-replication-stationary-band-seed-1201.json'], 1202: ['stationary-food-stationary-band-seed-1202.json'], 1203: ['stationary-food-replication-stationary-band-seed-1203.json'] } },
    ],
    seeds: { primary: 1202, replication: [1201, 1203] },
    horizon: 3000,
    ownModel: 'stationary-food',
    sources: [
      pair('stationary-food', [1202], ['moving-band', 'stationary-band'], 3000, 'tools/stationary-food/explore.ts: runArm(mode moving-band|stationary-band, seed 1202), MAX_TICK = 3000'),
      pair('stationary-food-replication', [1201, 1203], ['moving-band', 'stationary-band'], 3000, 'tools/stationary-food-replication/explore.ts: runArm(mode, seed 1201|1203), MAX_TICK = 3000'),
    ],
  },
  {
    id: 'food-band-longevity',
    title: 'Moving against stationary band, to 6,000 ticks',
    question: 'Do the moving and stationary 48-column bands still differ when the run is twice as long?',
    choiceText: 'Two worlds, one seed, the same pair as the 3,000-tick screen but run to tick 6,000 or until the bodies die out.',
    arms: [
      { id: 'moving', mode: 'moving-band', label: 'Moving band',
        differs: 'A 48-column band that moves one column east every 50 ticks.',
        replays: { 1201: ['food-band-longevity-moving-band-seed-1201.json'], 1202: ['food-band-longevity-replication-moving-band-seed-1202.json'], 1203: ['food-band-longevity-replication-moving-band-seed-1203.json'] } },
      { id: 'stationary', mode: 'stationary-band', label: 'Stationary band',
        differs: 'The same band fixed at columns 0 to 47.',
        replays: { 1201: ['food-band-longevity-stationary-band-seed-1201.json'], 1202: ['food-band-longevity-replication-stationary-band-seed-1202.json'], 1203: ['food-band-longevity-replication-stationary-band-seed-1203.json'] } },
    ],
    seeds: { primary: 1201, replication: [1202, 1203] },
    horizon: 6000,
    ownModel: 'stationary-food',
    sources: [
      pair('food-band-longevity', [1201], ['moving-band', 'stationary-band'], 6000, 'tools/food-band-longevity/explore.ts: new HungryWorld(seed,true,mode), seed 1201, MAX_TICK = 6000'),
      pair('food-band-longevity-replication', [1202, 1203], ['moving-band', 'stationary-band'], 6000, 'tools/food-band-longevity-replication/explore.ts: runArm(mode, seed 1202|1203), MAX_TICK = 6000'),
    ],
  },
  {
    id: 'split-food',
    title: 'Two small bands against one fixed band',
    question: 'Does splitting the fixed band into two narrower bands change how well bodies do?',
    choiceText: 'Two worlds, one seed. Left: one fixed band 48 columns wide. Right: two fixed bands 24 columns wide (columns 0 to 23 and 48 to 71). Same food budget.',
    arms: [
      { id: 'stationary', mode: 'stationary-band', label: 'One fixed band',
        differs: 'Columns 0 to 47 receive all of the food.',
        replays: { 1202: ['stationary-food-stationary-band-seed-1202.json'], 1203: ['stationary-food-replication-stationary-band-seed-1203.json'] } },
      { id: 'split', mode: 'split-band', label: 'Two fixed bands',
        differs: 'Columns 0 to 23 and 48 to 71 share the food. Half the width each, 4,608 tiles in total.',
        replays: { 1202: ['split-food-seed-1202.json'], 1203: ['split-food-replication-seed-1203.json'] } },
    ],
    seeds: { primary: 1202, replication: [1203] },
    horizon: 3000,
    ownModel: 'split-food',
    sources: [
      pair('split-food', [1202], ['stationary-band', 'split-band'], 3000, 'tools/split-food/explore.ts: new HungryWorld(1202,true,stationary-band|split-band), MAX_TICK = 3000'),
      pair('split-food-replication', [1203], ['stationary-band', 'split-band'], 3000, 'tools/split-food-replication/explore.ts: new HungryWorld(1203,true,stationary-band|split-band), MAX_TICK = 3000'),
    ],
  },
  {
    id: 'alternating-food',
    title: 'Two bands fed together against one band at a time',
    question: 'If the whole food budget goes to one of the two bands and switches sides every 100 pulses, do bodies do better than when both bands are fed at once?',
    choiceText: 'Two worlds, one seed. Left: both 24-column bands share the food at once. Right: the whole budget goes to one band, then switches sides every 100 pulses (500 ticks).',
    arms: [
      { id: 'split', mode: 'split-band', label: 'Both bands at once',
        differs: 'Columns 0 to 23 and 48 to 71 share the food on every pulse.',
        replays: { 1202: ['split-food-seed-1202.json'], 1203: ['split-food-replication-seed-1203.json'] } },
      { id: 'alternating', mode: 'alternating-band', label: 'One band at a time',
        differs: 'All 768 units per pulse go to one 24-column band, which switches between the two every 100 pulses.',
        replays: { 1202: ['alternating-food-replication-seed-1202.json'], 1203: ['alternating-food-seed-1203.json'] } },
    ],
    seeds: { primary: 1203, replication: [1202] },
    horizon: 3000,
    ownModel: 'alternating-food',
    sources: [
      pair('alternating-food', [1203], ['split-band', 'alternating-band'], 3000, 'tools/alternating-food/explore.ts: new HungryWorld(1203,true,split-band|alternating-band), MAX_TICK = 3000'),
      pair('alternating-food-replication', [1202], ['split-band', 'alternating-band'], 3000, 'tools/alternating-food-replication/explore.ts: new HungryWorld(1202,true,split-band|alternating-band), MAX_TICK = 3000'),
    ],
  },
  {
    id: 'food-band-foothold',
    title: 'A small food floor in both bands',
    question: 'Does keeping a small guaranteed trickle of food in the band that is not currently favoured help bodies survive the switch?',
    choiceText: 'Two worlds, one seed. Left: the alternating band, all food to one side. Right: the same budget, but 96 units per pulse always go to each band and only the remaining 576 follow the switching side.',
    arms: [
      { id: 'alternating', mode: 'alternating-band', label: 'One band at a time',
        differs: 'All 768 units per pulse go to the favoured band, which switches every 100 pulses.',
        replays: { 1202: ['alternating-food-replication-seed-1202.json'], 1203: ['alternating-food-seed-1203.json'] } },
      { id: 'foothold', mode: 'foothold-band', label: 'With a food floor',
        differs: '96 units per pulse always go to each band (the floor); the other 576 go to the favoured band, which switches every 100 pulses.',
        replays: { 1202: ['food-band-foothold-seed-1202.json'], 1203: ['food-band-foothold-replication-seed-1203.json', 'food-floor-replication-seed-1203.json'] } },
    ],
    seeds: { primary: 1202, replication: [1203] },
    horizon: 3000,
    ownModel: 'food-band-foothold',
    note: 'Seed 1203 was run twice under two tool names (food-band-foothold-replication and food-floor-replication) with the same arms; both recordings are accepted for the compare button here.',
    sources: [
      pair('food-band-foothold', [1202], ['alternating-band', 'foothold-band'], 3000, 'tools/food-band-foothold/explore.ts: new HungryWorld(1202,true,alternating-band|foothold-band), MAX_TICK = 3000'),
      pair('food-band-foothold-replication', [1203], ['foothold-band'], 3000, 'tools/food-band-foothold-replication/explore.ts: new HungryWorld(1203,true,foothold-band); the alternating-band arm is replayed from the earlier recording (replayHistorical), not constructed; MAX_TICK = 3000'),
      pair('food-floor-replication', [1203], ['alternating-band', 'foothold-band'], 3000, 'tools/food-floor-replication/explore.ts: new HungryWorld(1203,true,alternating-band|foothold-band), MAX_TICK = 3000 (same arms and seed as food-band-foothold-replication)'),
    ],
  },
  {
    id: 'food-floor-longevity',
    title: 'The food floor, run to 6,000 ticks',
    question: 'Do bodies fed with the food floor keep going past tick 3,000?',
    choiceText: 'One world with the food-floor schedule, run to tick 6,000 or until the bodies die out.',
    arms: [{
      id: 'foothold', mode: 'foothold-band', label: 'With a food floor',
      differs: '96 units per pulse always go to each band; the other 576 go to the band that switches every 100 pulses.',
      replays: { 1203: ['food-floor-longevity-seed-1203.json'], 1202: ['food-floor-longevity-replication-seed-1202.json'] },
    }],
    seeds: { primary: 1203, replication: [1202] },
    horizon: 6000,
    ownModel: 'food-band-foothold',
    sources: [
      pair('food-floor-longevity', [1203], ['foothold-band'], 6000, 'tools/food-floor-longevity/explore.ts: new HungryWorld(1203,true,foothold-band), MAX_TICK = 6000'),
      pair('food-floor-longevity-replication', [1202], ['foothold-band'], 6000, 'tools/food-floor-longevity-replication/explore.ts: new HungryWorld(1202,true,foothold-band), MAX_TICK = 6000'),
    ],
  },
  {
    id: 'food-schedule-769',
    title: 'A different order of food targets (schedule 769)',
    question: 'With the food floor kept, does stepping through the targets 769 at a time instead of 768 change what the bodies do?',
    choiceText: 'One world. The same budget as the food floor (96 + 96 floor, 576 to the favoured band) but the target order advances by 769 per pulse instead of 768. Optionally add the earlier schedule beside it.',
    arms: [
      { id: 'schedule-769', mode: 'schedule-769', label: 'Schedule 769',
        differs: 'Same floor and same 576 units for the favoured band as the earlier schedule, but the target index advances by 769 per pulse.',
        replays: { 1202: ['food-schedule-769-seed-1202.json'] } },
      { id: 'foothold', mode: 'foothold-band', label: 'Earlier food-floor schedule', optional: true,
        differs: 'The earlier schedule with the same floor; its target index advances by 768 per pulse.',
        replays: { 1202: ['food-band-foothold-seed-1202.json'] } },
    ],
    seeds: { primary: 1202, replication: [] },
    horizon: 6000,
    ownModel: 'food-schedule-769',
    note: 'The recorded run was gated at tick 3,000 and then continued to 6,000. The earlier schedule is shown only as an optional second world; its saved comparison stays on its own result page.',
    sources: [pair('food-schedule-769', [1202], ['schedule-769', 'foothold-band'], 6000, 'tools/food-schedule-769/explore.ts: new HungryWorld(1202,true,schedule-769), regression world foothold-band, MAX_TICK = 6000')],
  },
];

export const SCREEN_IDS: readonly string[] = SCREENS.map(screen => screen.id);

export function getScreen(id: string): ScreenSpec | undefined {
  return SCREENS.find(screen => screen.id === id);
}

/** Seeds the screen ran, primary first. */
export function screenSeeds(screen: ScreenSpec): readonly number[] {
  return [screen.seeds.primary, ...screen.seeds.replication];
}

/** Arms shown by default; optional arms need an explicit request. */
export function defaultArms(screen: ScreenSpec): readonly ArmSpec[] {
  return screen.arms.filter(arm => !arm.optional);
}
