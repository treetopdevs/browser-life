// Channel-major state layout shared by the CPU reference, the WGSL kernels,
// checkpoints and analysis. buffer[ch * N + cell].

export const CH = {
  A: 0, // dissolved nutrient
  B: 1, // biomass (carries the genome)
  C: 2, // dissolved waste
  P: 3, // structural polymer / membrane
  E: 4, // free energy pool carried with biomass
  S: 5, // signal (stored energy that diffuses and decays)
  MOT: 6, // controller motility, (mx+128) | (my+128) << 8
} as const;
export const CELL_CHANNELS = 7;

// Controller: I inputs -> H hidden (ReLU) -> O outputs, int8 weights.
export const NN_I = 10;
export const NN_H = 8;
export const NN_O = 8;
export const W1_OFF = 0;
export const B1_OFF = W1_OFF + NN_I * NN_H;
export const W2_OFF = B1_OFF + NN_H;
export const B2_OFF = W2_OFF + NN_H * NN_O;
export const NN_BYTES = B2_OFF + NN_O; // 160
export const NN_WORDS = NN_BYTES / 4; // 40

export const OUT = { PHOTO: 0, RESP: 1, DECOMP: 2, GROW: 3, BUILD: 4, EMIT: 5, MX: 6, MY: 7 } as const;
export const IN = { A: 0, B: 1, C: 2, P: 3, EPB: 4, LIGHT: 5, S: 6, SGX: 7, SGY: 8, U: 9 } as const;

export const G = {
  LIN_HI: 0, // birth step + 1 (0 for founders)
  LIN_LO: 1, // birth cell (founder index + 1 for founders)
  PARAM0: 2, // mu | sigma << 16 (Lenia growth function, /1024)
  PARAM1: 3, // motility gain (u8)
  W0: 4, // first of NN_WORDS packed int8 weights
} as const;
export const GENOME_CHANNELS = G.W0 + NN_WORDS; // 44

// Per-reaction flux counters (u64 each). Matter flows in quanta; EMIT in energy units.
export const FLUX_NAMES = ["photo", "resp", "decomp", "grow", "build", "emit", "starve", "pdecay", "bdecay", "abio"] as const;
export type FluxName = (typeof FLUX_NAMES)[number];
export const FLUX_COUNT = FLUX_NAMES.length;

// Ledger buffer (u32 words).
export const LEDGER = {
  LIGHT_LO: 0,
  LIGHT_HI: 1,
  HEAT_LO: 2,
  HEAT_HI: 3,
  EVENTS: 4,
  EVENTS_DROPPED: 5,
  STEP: 6,
  /** Sticky flags: bit 0 a 64-bit ledger wrapped, bit 1 the event counter saturated. */
  FLAGS: 7,
  FLUX: 8, // FLUX_COUNT (lo, hi) pairs
} as const;
export const LEDGER_WORDS = 32;

/** Diagnostic per-cell role buffer: last step's (photo | grow << 16), (decomp | resp << 16), saturated at 65535. */
export const ROLE_WORDS = 2;
export const FLAG_LEDGER_OVERFLOW = 1;
export const FLAG_EVENTS_SATURATED = 2;
export const EVENT_WORDS = 4; // childHi, childLo, parentHi, parentLo

// Random-draw purposes (keeps CPU and GPU streams aligned).
export const RND = {
  LOTTERY: 0,
  DIFF: 1, // + dir*3 + species, 12 slots
  PHOTO: 20,
  RESP: 21,
  DECOMP: 22,
  GROW: 23,
  BUILD: 24,
  EMIT: 25,
  COST: 26,
  MAINT: 27,
  PDECAY: 28,
  BDECAY: 29,
  ELEAK: 30,
  SDECAY: 31,
  ABIO1: 32,
  ABIO2: 33,
  MUT: 34,
  MUT_WHICH: 35,
  MUT_DELTA: 36,
} as const;
