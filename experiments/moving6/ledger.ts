/**
 * MOVING6: bodies followed through their changes of id, and a ledger of their births and deaths that balances
 * (docs/six-wall-moving-2026-11-22/PLAN.md, "Bodies, births and deaths").
 *
 * Pure functions over what a tracked segment stores: the compartment check's tracker records, the earlier
 * screen's birth notes, and this line's move log. Nothing here reads frames or runs the kernel.
 *
 * Why this exists. The earlier screen classified births and ends separately: a birth could be set aside (a
 * return, a re-separation, a relabelling) while the end it answered still counted. Where bodies stay put that
 * hardly matters. Where they move, touch, part and get relabelled it gave about 290 ends against about 5
 * births in a window whose count was flat. Here every continuation joins exactly one end to exactly one
 * birth, so whatever is set aside is set aside on both sides.
 *
 * A **body** is a chain of tracker ids. An id continues an earlier one when
 * - *relabelled*: the earlier id ended by a type switch and this one is the switch birth that replaced it at
 *   that frame (the kernel's relabelling rule changed the body's wall type);
 * - *parted*: the earlier id was absorbed into a same-type object, and this one splits from that object (or
 *   from whatever absorbed or replaced it since) at most `partWithin` steps later (two bodies touched and
 *   came apart again);
 * - *returned*: this one is not a relabelling, and at least half its tiles lie on the last footprint of the
 *   earlier id, which ended at most 500 steps before (a body dipped under the counting line and came back; the
 *   earlier screen's test, unchanged). Only the first such birth continues the body: a further one begins a
 *   chain of its own, a "returned piece", which the division rule sets aside as the earlier rule did;
 * - *handed on*: the earlier id faded, or was absorbed into its own daughter, at most 500 steps after
 *   an object split from it (by fission or by a relabelling) that is still present. One of the two parts of
 *   the split is gone inside 500 steps, so the split did not hold: the body goes on in the part that is left,
 *   and the chain that part had begun stops there, unborn.
 * Each end is continued at most once and each birth continues at most one end.
 *
 * A chain is a body only if it stood as its own object for more than 500 steps in a row at least once (the
 * earlier screen's lasting rule, applied to the chain; a relabelling does not break the row). Chains that never
 * do are flicker: necks and fringes crossing the counting line.
 */

import type { TrackerResult, UidRecord } from '../b2check/observe.ts';
import { torusDist } from '../b2check/observe.ts';
import type { BirthNote, BodyLogResult } from '../spot6/bodylog.ts';
import { T } from '../spot6/rule.ts';
import type { MoveFrame, MoveLogResult } from './movelog.ts';

export const L = {
  /** A chain is a body if it was its own object for more than this many steps in a row (the earlier `lastingSteps`). */
  lastingSteps: T.lastingSteps,
  /** A merge undone within this many steps is a touch and part; one held longer is a fusion. */
  partWithin: 500,
  /** The earlier screen's return test. */
  returnShare: T.returnShare,
  returnSteps: T.returnSteps,
  /** A fission-born body is read against its parent body at the first move-log frame, from this many steps after the split to this many, at which both are present. */
  apartFrom: 500,
  apartTo: 1000,
  /** Daughter and parent distance is read this many steps after the split. */
  distanceAt: 1000,
  /** A split or cut whose other part is gone within this many steps did not hold (the hand-on rule). Not changed by the described-only variants of `partWithin`. */
  handWithin: 500,
  /** The ledger leaves out the window's first 500 steps (a continuation looks 500 steps back) and its last 1,000 (a split is read against its parent up to 1,000 steps after it). */
  marginStart: 500,
  marginEnd: 1000,
} as const;

export type Origin = 'initial' | 'fission' | 'relabel' | 'nothing';
export type LinkKind = 'relabelled' | 'parted' | 'returned' | 'handed on';
/** How a body ended: it faded, it fused into another body for good, or it was relabelled into nothing this line can follow. */
export type DeathKind = 'fade' | 'fusion' | 'relabelled away';
export type BirthKind = 'division' | 'split not shown apart' | 'relabel' | 'returned piece' | 'from nothing';
export type ApartReading = 'apart' | 'same patch' | 'not read';

export interface Part {
  readonly uid: number;
  readonly from: number;
  to: number | null;
}

export interface Chain {
  readonly id: number;
  readonly origin: Origin;
  /** Step of the first frame of its first id. */
  readonly born: number;
  /** For a fission or relabel origin: the chain that carries the object it was cut from (-1: none). Follows that object through a hand-on. */
  parent: number;
  /** For a fission origin: at its first frame it was joined to its parent by total wall of 0.20 or more (cut by another type's wall, as a partial relabelling does). */
  readonly severed: boolean;
  /**
   * It began on the last footprint of an id that ended at most 500 steps before (the earlier screen's return
   * test) and that something else had already continued: a body came back in more than one piece.
   */
  readonly returnedPiece: boolean;
  /** The ids it was, in order. `to`: the first frame at which it no longer was that id (null: it still is at the window's last frame). */
  readonly parts: Part[];
  /** links[k] joins parts[k] to parts[k + 1]. */
  readonly links: LinkKind[];
  /** Step of the first frame at which its last id was gone (null: present at the window's last frame). */
  end: number | null;
  endKind: DeathKind | null;
  /** Longest run of steps as its own object. */
  longest: number;
}

export interface Chains {
  readonly from: number;
  readonly to: number;
  readonly chains: Chain[];
  /** The chain every tracker id belonged to last. */
  readonly chainOf: Map<number, number>;
  readonly partWithin: number;
}

/**
 * Builds the chains of one tracked window. `partWithin` is the plan's 500 steps; other values are for the
 * described-only comparisons (they leave the hand-on rule at 500 steps).
 *
 * Within one frame: relabellings first; then the frame's ends, each read from the state before any of them
 * (so their order does not matter); then the frame's births in order of id, so of two daughters that could
 * continue one merged body, or two objects on one footprint, the lower id does.
 */
export function buildChains(tr: TrackerResult, log: BodyLogResult, partWithin: number = L.partWithin): Chains {
  const rec = new Map<number, UidRecord>();
  const bornAt = new Map<number, UidRecord[]>();
  const endAt = new Map<number, UidRecord[]>();
  const push = (m: Map<number, UidRecord[]>, k: number, r: UidRecord) => {
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  };
  for (const r of tr.records) {
    rec.set(r.uid, r);
    push(bornAt, r.born, r);
    if (r.end !== null) push(endAt, r.end, r);
  }
  const notes = new Map<number, BirthNote>();
  for (const b of log.births) notes.set(b.uid, b);

  const chains: Chain[] = [];
  const chainOf = new Map<number, number>();
  /** Per live id: the chains merged into it and not yet parted, with the step each was absorbed. */
  const guests = new Map<number, { chain: number; t: number }[]>();
  /** Per ended chain that is a guest: the id hosting it. */
  const hostOf = new Map<number, number>();
  /** Per chain: the chains that began as a piece cut from it. */
  const cutFrom = new Map<number, number[]>();
  const lastUid = (c: Chain): number => c.parts[c.parts.length - 1].uid;
  const start = (r: UidRecord, origin: Origin, returnedPiece = false): void => {
    const note = notes.get(r.uid);
    const severed = origin === 'fission' && note !== undefined && note.mates.includes(r.parent);
    const parent = origin === 'fission' || origin === 'relabel' ? chainOf.get(r.parent) ?? -1 : -1;
    const id = chains.length;
    chains.push({ id, origin, born: r.born, parent, severed, returnedPiece, parts: [{ uid: r.uid, from: r.born, to: null }], links: [], end: null, endKind: null, longest: 0 });
    chainOf.set(r.uid, id);
    if (parent >= 0) {
      const list = cutFrom.get(parent);
      if (list) list.push(id);
      else cutFrom.set(parent, [id]);
    }
  };
  const carryOn = (chain: number, r: UidRecord, kind: LinkKind): void => {
    const c = chains[chain];
    c.parts.push({ uid: r.uid, from: r.born, to: null });
    c.links.push(kind);
    c.end = null;
    c.endKind = null;
    chainOf.set(r.uid, chain);
    const host = hostOf.get(chain);
    if (host !== undefined) {
      const list = guests.get(host);
      if (list) {
        const k = list.findIndex((g) => g.chain === chain);
        if (k >= 0) list.splice(k, 1);
      }
      hostOf.delete(chain);
    }
  };
  const moveGuests = (fromUid: number, toUid: number): void => {
    const mine = guests.get(fromUid);
    if (!mine) return;
    guests.delete(fromUid);
    if (mine.length === 0) return;
    const list = guests.get(toUid);
    if (list) list.push(...mine);
    else guests.set(toUid, mine);
    for (const g of mine) hostOf.set(g.chain, toUid);
  };
  /** The ended chain whose last id is `uid`, if nothing has continued it. */
  const endedChainOf = (uid: number): number => {
    const chain = chainOf.get(uid);
    if (chain === undefined) return -1;
    const c = chains[chain];
    return c.end !== null && lastUid(c) === uid ? chain : -1;
  };
  /**
   * Handed on: chain `p` lost its id at step `t` (`kind`), and `d`, a piece cut from it at most `handWithin`
   * steps ago, is still present. The body goes on as `d`'s id; `d` stops at `t` with the end `p` would have
   * had; and what was cut from `d` meanwhile now counts as cut from `p`, which carries `d`'s object.
   */
  const handOn = (p: number, d: number, t: number, kind: DeathKind): number => {
    const pc = chains[p];
    const dc = chains[d];
    const part = dc.parts[dc.parts.length - 1];
    part.to = t;
    pc.parts.push({ uid: part.uid, from: t, to: null });
    pc.links.push('handed on');
    pc.end = null;
    pc.endKind = null;
    chainOf.set(part.uid, p);
    dc.end = t;
    dc.endKind = kind;
    const moved = cutFrom.get(d);
    if (moved) {
      cutFrom.delete(d);
      for (const child of moved) chains[child].parent = p;
      const mine = cutFrom.get(p);
      if (mine) mine.push(...moved);
      else cutFrom.set(p, moved);
    }
    return part.uid;
  };
  /**
   * The piece chain `p` hands on to at step `t`, read from the state before any of this frame's ends: cut from
   * `p` at most `handWithin` steps ago, never ended, and its id not ending in this frame. With `uid`: only the
   * piece that is that id. Of several, the one cut last (then the lower chain id).
   */
  const freshPiece = (p: number, t: number, uid = 0): number => {
    let best = -1;
    for (const d of cutFrom.get(p) ?? []) {
      const dc = chains[d];
      if (dc.end !== null || t - dc.born > L.handWithin || dc.born >= t) continue;
      if (uid !== 0 && lastUid(dc) !== uid) continue;
      if ((rec.get(lastUid(dc)) as UidRecord).end === t) continue;
      if (best < 0 || dc.born > chains[best].born) best = d;
    }
    return best;
  };

  const steps = [...new Set([...bornAt.keys(), ...endAt.keys()])].sort((a, b) => a - b);
  for (const t of steps) {
    const ends = endAt.get(t) ?? [];
    const births = (bornAt.get(t) ?? []).slice().sort((a, b) => a.uid - b.uid);
    // 1. Relabelled: an id that ended by a type switch, and the switch birth that replaced it at this frame.
    const replacedBy = new Map<number, UidRecord>();
    for (const b of births) {
      if (b.birth !== 'switch') continue;
      const p = rec.get(b.parent);
      if (p && p.end === t && p.endKind === 'switch' && !replacedBy.has(p.uid)) replacedBy.set(p.uid, b);
    }
    const continued = new Set<number>();
    for (const [uid, b] of replacedBy) {
      const c = chains[chainOf.get(uid) as number];
      c.parts[c.parts.length - 1].to = t;
      carryOn(c.id, b, 'relabelled');
      moveGuests(uid, b.uid);
      continued.add(b.uid);
    }
    // 2. Ends. Every hand-on is decided from the state before any of this frame's ends, so the order in which
    // the frame's ends are taken does not matter.
    const ending = ends.filter((e) => !replacedBy.has(e.uid)).sort((a, b) => a.uid - b.uid);
    const plan = ending.map((e) => {
      const chain = chainOf.get(e.uid) as number;
      const kind: DeathKind = e.endKind === 'absorbed' ? 'fusion' : e.endKind === 'switch' ? 'relabelled away' : 'fade';
      // Faded with a fresh piece still present, or absorbed into its own fresh piece: the split did not hold.
      const piece = kind === 'fade' ? freshPiece(chain, t) : kind === 'fusion' ? freshPiece(chain, t, e.into) : -1;
      return { e, chain, kind, piece };
    });
    for (const { chain, kind } of plan) {
      const c = chains[chain];
      c.parts[c.parts.length - 1].to = t;
      c.end = t;
      c.endKind = kind;
    }
    for (const { e, chain, kind, piece } of plan) {
      if (kind === 'fusion') {
        // The body that is gone into the absorbing object: this chain, or, after a hand-on, the piece's chain.
        const gone = piece >= 0 ? piece : chain;
        if (piece >= 0) handOn(chain, piece, t, 'fusion');
        const list = guests.get(e.into);
        if (list) list.push({ chain: gone, t });
        else guests.set(e.into, [{ chain: gone, t }]);
        hostOf.set(gone, e.into);
        moveGuests(e.uid, e.into);
      } else if (piece >= 0) {
        // The body goes on in the piece, and takes with it the bodies that had merged into it.
        moveGuests(e.uid, handOn(chain, piece, t, 'fade'));
      } else {
        guests.delete(e.uid);
      }
    }
    // 3. Births that no relabelling accounts for.
    for (const b of births) {
      if (continued.has(b.uid)) continue;
      if (b.birth === 'initial') {
        start(b, 'initial');
        continue;
      }
      if (b.birth === 'switch') {
        start(b, 'relabel');
        continue;
      }
      const note = notes.get(b.uid);
      const onFootprint = note !== undefined && note.of !== 0 && note.share >= L.returnShare;
      if (b.birth === 'fission') {
        // Parted: the object it split from holds a body that merged into it at most `partWithin` steps ago.
        const held = (guests.get(b.parent) ?? []).filter((g) => g.t < t && t - g.t <= partWithin && chains[g.chain].end !== null);
        if (held.length > 0) {
          // The body that merged last (of several in one frame, the lower chain id), unless the footprint names one.
          let pick = held[0];
          for (const g of held) if (g.t > pick.t || (g.t === pick.t && g.chain < pick.chain)) pick = g;
          if (onFootprint) {
            const match = held.find((g) => lastUid(chains[g.chain]) === (note as BirthNote).of);
            if (match) pick = match;
          }
          carryOn(pick.chain, b, 'parted');
          continue;
        }
      }
      // Returned: on the last footprint of an id that ended at most 500 steps before. The first such birth
      // continues that body; a further one begins a chain of its own, marked as a piece of a return.
      const recent = onFootprint && (note as BirthNote).gap <= L.returnSteps;
      if (recent) {
        const chain = endedChainOf((note as BirthNote).of);
        if (chain >= 0) {
          carryOn(chain, b, 'returned');
          continue;
        }
      }
      start(b, b.birth === 'fission' ? 'fission' : 'nothing', recent);
    }
  }

  // Longest run as its own object. A change of id with no frame between (a relabelling, a hand-on) does not break the run.
  for (const c of chains) {
    let run = 0;
    c.parts.forEach((part, k) => {
      if (!(k > 0 && part.from === c.parts[k - 1].to)) run = 0;
      run += (part.to ?? tr.lastStep) - part.from;
      if (run > c.longest) c.longest = run;
    });
  }
  return { from: tr.firstStep, to: tr.lastStep, chains, chainOf, partWithin };
}

/** The earlier lasting rule on a chain: its own object for more than 500 steps in a row. */
export const isBody = (c: Chain): boolean => c.longest > L.lastingSteps;

const aliveAt = (c: Chain, t: number): boolean => c.born <= t && (c.end === null || c.end > t);

export interface NewBody {
  readonly chain: number;
  readonly born: number;
  readonly kind: BirthKind;
  /** For a fission origin that was not severed: how it reads against its parent body. */
  readonly apart: ApartReading | null;
  /** Tiles between its centre and its parent body's, 1,000 steps after the split (null: not readable). */
  readonly distance: number | null;
  /** Steps it lived, if it ended inside the window (null: still present at the last frame). */
  readonly lived: number | null;
}

export interface Ledger {
  /** The stretch the ledger covers: the tracked window less its first 500 steps and its last 1,000. */
  readonly from: number;
  readonly to: number;
  /** Bodies alive at its two ends (present as an object, or between two ids of one chain). */
  readonly bodiesAtStart: number;
  readonly bodiesAtEnd: number;
  /** Bodies born and bodies ended inside it, by kind. */
  readonly births: Record<BirthKind, number>;
  readonly deaths: Record<DeathKind, number>;
  readonly birthsTotal: number;
  readonly deathsTotal: number;
  /** New bodies the division rule counts (division and from nothing), in each half of the stretch. */
  readonly newFirstHalf: { division: number; nothing: number };
  readonly newSecondHalf: { division: number; nothing: number };
  /** Why fission-born bodies were not shown apart from their parent. */
  readonly notApart: { samePatch: number; notRead: number };
  /** Continuations inside the stretch on bodies: not births, not deaths. */
  readonly continuations: Record<LinkKind, number>;
  /** Every body that was alive in the stretch, by how it arose (or "present at the start") and what became of it by the stretch's end. */
  readonly fates: Record<string, Record<DeathKind | 'alive', number>>;
  /** Chains that never stood 500 steps in a row: how many began in the stretch, and their share of all object-steps in the window. */
  readonly flickerChains: number;
  readonly flickerShare: number;
  /** Object-steps of bodies in the stretch, in thousands (the denominator of the per-body rates). */
  readonly bodyKiloSteps: number;
  readonly newBodies: NewBody[];
}

/** The first move-log frame at or after step `t` (null: the log ends before it). */
function frameFrom(move: MoveLogResult, t: number): MoveFrame | null {
  if (move.frames.length === 0) return null;
  const k = Math.max(0, Math.ceil((t - move.frames[0].t) / move.every));
  return move.frames[k] ?? null;
}

/**
 * The ledger of one tracked window. `counts` are the confirmation's object counts at the censuses, used only to
 * place the ledger's ends on censuses; the balance against them is taken in rule.ts.
 *
 * `move` null (a stored window of the earlier screen that was not replayed): the apart reading falls back to
 * the earlier note, which follows ids, not bodies. `size` is the side of the (square) dish in tiles.
 */
export function ledgerOf(tr: TrackerResult, log: BodyLogResult, move: MoveLogResult | null, dt: number, size: number, built: Chains = buildChains(tr, log)): Ledger {
  const { chains } = built;
  const from = tr.firstStep + L.marginStart;
  const to = tr.lastStep - L.marginEnd;
  const mid = (from + to) / 2;
  const notes = new Map<number, BirthNote>();
  for (const b of log.births) notes.set(b.uid, b);
  /** The id of chain `c` present at step `t` (0: none). */
  const idAt = (c: Chain, t: number): number => {
    for (const part of c.parts) if (part.from <= t && (part.to === null || part.to > t)) return part.uid;
    return 0;
  };
  const place = (f: MoveFrame, uid: number): number => (uid === 0 ? -1 : f.uid.indexOf(uid));

  const births: Record<BirthKind, number> = { division: 0, 'split not shown apart': 0, relabel: 0, 'returned piece': 0, 'from nothing': 0 };
  const deaths: Record<DeathKind, number> = { fade: 0, fusion: 0, 'relabelled away': 0 };
  const newFirst = { division: 0, nothing: 0 };
  const newSecond = { division: 0, nothing: 0 };
  const notApart = { samePatch: 0, notRead: 0 };
  const continuations: Record<LinkKind, number> = { relabelled: 0, parted: 0, returned: 0, 'handed on': 0 };
  const fates: Record<string, Record<DeathKind | 'alive', number>> = {};
  const newBodies: NewBody[] = [];
  let atStart = 0;
  let atEnd = 0;
  let flickerChains = 0;
  let flickerSteps = 0;
  let allSteps = 0;
  let bodySteps = 0;

  for (const c of chains) {
    let own = 0;
    let ownInside = 0;
    for (const part of c.parts) {
      const end = part.to ?? tr.lastStep + dt;
      own += end - part.from;
      ownInside += Math.max(0, Math.min(end, to + dt) - Math.max(part.from, from));
    }
    allSteps += own;
    if (!isBody(c)) {
      flickerSteps += own;
      if (c.born > from && c.born <= to) flickerChains++;
      continue;
    }
    bodySteps += ownInside;
    if (aliveAt(c, from)) atStart++;
    if (aliveAt(c, to)) atEnd++;
    c.parts.forEach((part, k) => {
      if (k > 0 && part.from > from && part.from <= to) continuations[c.links[k - 1]]++;
    });
    const bornInside = c.origin !== 'initial' && c.born > from && c.born <= to;
    const endedInside = c.end !== null && c.end > from && c.end <= to;
    let kind: BirthKind | null = null;
    if (bornInside) {
      let apart: ApartReading | null = null;
      let distance: number | null = null;
      if (c.origin === 'relabel' || c.severed) kind = 'relabel';
      else if (c.returnedPiece) kind = 'returned piece';
      else if (c.origin === 'nothing') kind = 'from nothing';
      else {
        const parent = c.parent >= 0 ? chains[c.parent] : null;
        apart = 'not read';
        if (move && parent) {
          for (let f = frameFrom(move, c.born + L.apartFrom); f !== null && f.t <= c.born + L.apartTo; f = frameFrom(move, f.t + move.every)) {
            const a = place(f, idAt(c, f.t));
            const b = place(f, idAt(parent, f.t));
            if (a < 0 || b < 0) continue;
            apart = f.low[a] !== f.low[b] ? 'apart' : 'same patch';
            break;
          }
          const f = frameFrom(move, c.born + L.distanceAt);
          if (f && f.t < c.born + L.distanceAt + move.every) {
            const a = place(f, idAt(c, f.t));
            const b = place(f, idAt(parent, f.t));
            if (a >= 0 && b >= 0) distance = torusDist(f.cx[a], f.cy[a], f.cx[b], f.cy[b], size, size);
          }
        } else if (!move) {
          const low = notes.get(c.parts[0].uid)?.apartLow;
          apart = low === true ? 'apart' : low === false ? 'same patch' : 'not read';
        }
        kind = apart === 'apart' ? 'division' : 'split not shown apart';
        if (apart === 'same patch') notApart.samePatch++;
        if (apart === 'not read') notApart.notRead++;
      }
      births[kind]++;
      const half = c.born <= mid ? newFirst : newSecond;
      if (kind === 'division') half.division++;
      if (kind === 'from nothing') half.nothing++;
      newBodies.push({ chain: c.id, born: c.born, kind, apart, distance, lived: c.end === null ? null : c.end - c.born });
    }
    if (endedInside) deaths[c.endKind as DeathKind]++;
    if (aliveAt(c, from) || bornInside) {
      const row = aliveAt(c, from) ? 'present at the start' : (kind as BirthKind);
      const fate = endedInside ? (c.endKind as DeathKind) : 'alive';
      (fates[row] ??= { fade: 0, fusion: 0, 'relabelled away': 0, alive: 0 })[fate]++;
    }
  }
  const birthsTotal = births.division + births['split not shown apart'] + births.relabel + births['returned piece'] + births['from nothing'];
  const deathsTotal = deaths.fade + deaths.fusion + deaths['relabelled away'];
  if (atEnd - atStart !== birthsTotal - deathsTotal) throw new Error(`ledger does not balance: ${atStart} bodies at the start, ${atEnd} at the end, ${birthsTotal} births, ${deathsTotal} deaths`);
  return {
    from,
    to,
    bodiesAtStart: atStart,
    bodiesAtEnd: atEnd,
    births,
    deaths,
    birthsTotal,
    deathsTotal,
    newFirstHalf: newFirst,
    newSecondHalf: newSecond,
    notApart,
    continuations,
    fates,
    flickerChains,
    flickerShare: allSteps > 0 ? flickerSteps / allSteps : 0,
    bodyKiloSteps: bodySteps / 1000,
    newBodies,
  };
}
