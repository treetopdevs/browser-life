#!/usr/bin/env python3
"""ROOM: a screen for a regime in which a compartment holds many genes with a parasite source present
(docs/droplet-genes-room-2026-11-22/PLAN.md). Seeds 1 to 4 only; nothing here is evidence.

Every simulation is one experiments/dropgenes/sweep.ts invocation of one run (so sweep.ts checks an existing
file against the whole request), at most four at a time. Each mode decides what to run from the files on disk
by the rules in PLAN.md, so every mode can be invoked again after an interruption. A file is read for a
decision only after its whole configuration, set-up, horizon and residual have been checked here as well.

  python3 experiments/dropgenes/room.py list      # the grid, the settings and the file layout
  python3 experiments/dropgenes/room.py gate      # stage 1: no parasite source, gated, seeds 1 and 2, 50,000 steps
  python3 experiments/dropgenes/room.py par       # stage 2: each parasite setting of the brief on the cells that passed, seeds 1 and 2, 50,000 steps
  python3 experiments/dropgenes/room.py front     # stage 3: frontier cells, seeds 1 to 4, 200,000 steps, in the plan's order
  python3 experiments/dropgenes/room.py par-added # stage 2 for the added rate b4096 (only after tiers 1 to 6 of the brief's grid); then front again
  python3 experiments/dropgenes/room.py check     # re-runs up to two carried-over seeds at 200,000 steps (they must end at the same step)
  python3 experiments/dropgenes/room.py table     # tables, labels, outcome; --md FILE and --json FILE write them
  python3 experiments/dropgenes/room.py budget    # steps run, wall and CPU seconds so far
  python3 experiments/dropgenes/room.py confirm-read --dir D --setting a1e5 --phys fuel --K 6 --cap 64 --seeds 41,42,43,44[,45,46,47,48]
                                                  # reads a confirmation directory made with sweep.ts and applies the pass rule (starts nothing;
                                                  # only those two seed lists are accepted, or 1,2,3,4 as a self-test that gives no verdict)

  --dry prints what gate, par or front would run and runs nothing.

Environment: ROOM_JOBS (1 to 4, default 4), ROOM_MINUTES (no new run is started after this many minutes,
default 80; a background command is stopped at two hours), ROOM_BUDGET_STEPS (default 31,500,000),
ROOM_MAX_TIER (front starts nothing above this tier in this invocation; 6 keeps tier 13 back until the added
rate has had its turn, as PLAN.md orders).
ROOM_BASE and ROOM_TEST_STEPS exist only for a plumbing check in a scratch directory (never the real one).
"""
import datetime
import json
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REAL_BASE = os.path.join(ROOT, 'runs/dropgenes/room')
BASE = os.environ.get('ROOM_BASE', REAL_BASE)
SWEEP = os.path.join(ROOT, 'experiments/dropgenes/sweep.ts')
RUNNER = os.path.join(ROOT, 'experiments/dropgenes/run.ts')
KERNEL = os.path.join(ROOT, 'apps/lab/src/dropgenes/kernel.ts')

# ---- The grid (PLAN.md, "The grid"). Fixed before the first run. ---------------------------------------------
KS = [2, 3, 4, 6, 8]
PHYSICS = {  # exactly as recorded for the first rung's LARGE and FIRMUP B3's "fuel only"
    'large': {'diffT': 0.1, 'diffW': 0.03, 'diffF': 0.6, 'diffA': 0.44},
    'fuel': {'diffT': 0.1, 'diffF': 0.6, 'diffA': 0.44},
}
SITES = [16, 64]
LEVELS = 2  # source B: K * levels <= 17 (DG_MAX_SPECIES), so two levels is the only ladder that allows K = 6 and 8
# setting -> source, mutPar (source A), mutLevel (source B). a0 and b0 are the two "no parasite source" arms.
SETTINGS = {
    'a0': {'source': 'A', 'mutPar': 0, 'clean': True},
    'a1e4': {'source': 'A', 'mutPar': 1e-4, 'clean': False},
    'a1e5': {'source': 'A', 'mutPar': 1e-5, 'clean': False},
    'a1e6': {'source': 'A', 'mutPar': 1e-6, 'clean': False},
    'b0': {'source': 'B', 'mutLevel': 0, 'clean': True},
    'b64': {'source': 'B', 'mutLevel': 1 / 64, 'clean': False},
    'b256': {'source': 'B', 'mutLevel': 1 / 256, 'clean': False},
    'b4096': {'source': 'B', 'mutLevel': 1 / 4096, 'clean': False},  # added to the coordinator's grid before the first run (PLAN.md)
}
PAR_SETTINGS = ['a1e4', 'a1e5', 'a1e6', 'b64', 'b256', 'b4096']
ADDED = {'b4096'}  # not on the coordinator's grid: run after it at every stage, and never part of the brief-grid outcome
CLEAN_OF = {'A': 'a0', 'B': 'b0'}
SCREEN_SEEDS = [1, 2]
FRONT_SEEDS = [1, 2, 3, 4]
ALLOWED_SEEDS = {1, 2, 3, 4}  # seeds 41 to 48 are reserved for a confirmation this driver cannot run
TEST_STEPS = os.environ.get('ROOM_TEST_STEPS')
if TEST_STEPS is not None and os.path.abspath(BASE) == os.path.abspath(REAL_BASE):
    raise SystemExit('ROOM_TEST_STEPS is for a scratch ROOM_BASE only')
SHORT = int(TEST_STEPS) if TEST_STEPS else 50000
LONG = 2 * int(TEST_STEPS) if TEST_STEPS else 200000

# ---- Guard and readings (PLAN.md, "Guard against an empty pass"). Fixed before the first run. -----------------
FLOOR_A = 0.005
# The confirmation (PLAN.md, "Frozen regime"): its horizon, the report-row spacing of sweep.ts's set-up, and the
# one regime a verdict is given for. None of these follows the plumbing-test switch.
CONFIRM_STEPS = 200000
REPORT_EVERY = 2000
FROZEN_REGIME = ('a1e5', 'fuel', 6, 64)


def floor_of(setting):
    """Late parasite share (arena-wide) at or above which the parasite counts as present in effect."""
    s = SETTINGS[setting]
    return FLOOR_A if s['source'] == 'A' else max(FLOOR_A, s['mutLevel'])


LEVEL_CEILING = 0.5      # source B: late mean level inside compartments must be at most this ("the genes still work")
HELD_COMPARTMENTS = 10   # the first rung's "held", recomputed here from the two late figures
HELD_COMPLETE = 0.5
FOUNDERS_BY = 1000       # a run that ended by this step was lost "at the founders"
EARLY_BY = 10000         # ... by this step "in the first few thousand steps"; after it "late"
BUDGET_STEPS = int(os.environ.get('ROOM_BUDGET_STEPS', '31500000'))  # 25 core-hours at 350 steps a second
JOBS = max(1, min(4, int(os.environ.get('ROOM_JOBS', '4'))))
MINUTES = float(os.environ.get('ROOM_MINUTES', '80'))
MAX_TIER = int(os.environ.get('ROOM_MAX_TIER', '99'))  # front only: start nothing above this tier in this invocation
PROTOCOL = {'census': 50, 'report': 2000, 'heredityDelay': 500, 'founders': 'grid', 'spacing': 16, 'seedPerGene': 2}
RUNG = {None: 0, 2: 1, 3: 2, 4: 3, 6: 4, 8: 5}


# ---- One run ------------------------------------------------------------------------------------------------

class Run:
    """One simulation: horizon, physics, setting, K, sites, gated or not, seed."""

    def __init__(self, steps, phys, setting, K, cap, gated, seed, check=False):
        if seed not in ALLOWED_SEEDS:
            raise SystemExit(f'seed {seed} is not one of 1 to 4; this driver runs no other seed')
        if phys not in PHYSICS or setting not in SETTINGS or K not in KS or cap not in SITES or steps not in (SHORT, LONG):
            raise SystemExit(f'not on the grid: {steps} {phys} {setting} K{K} cap{cap}')
        self.steps, self.phys, self.setting, self.K, self.cap, self.gated, self.seed, self.check = steps, phys, setting, K, cap, gated, seed, check
        self.s = SETTINGS[setting]
        self.source = self.s['source']

    @property
    def arm(self):
        gate = 'GATED' if self.gated else 'UNGATED'
        if self.source == 'B':
            return f'{gate}_SEL'
        return f'{gate}_{"CLEAN" if self.s["clean"] else "PAR"}'

    @property
    def stage(self):
        src = self.source.lower()
        if self.check:
            return 'carry-check'
        if self.steps == LONG:
            return f'{src}-front-200k'
        return f'{src}-gate-50k' if self.s['clean'] else f'{src}-par-50k'

    @property
    def tag(self):
        return f'{self.phys}-{self.setting}'

    @property
    def name(self):
        return f'{self.tag}-K{self.K}-cap{self.cap}-{self.arm}-s{self.seed}'

    @property
    def path(self):
        return os.path.join(BASE, self.stage, self.name + '.json')

    def sweep_args(self):
        ov = json.dumps(PHYSICS[self.phys], separators=(',', ':'))
        args = ['deno', 'run', '-A', '--no-lock', SWEEP, '--dir', os.path.join(BASE, self.stage), '--genes', str(self.K), '--caps', str(self.cap),
                '--seeds', str(self.seed), '--steps', str(self.steps), '--mutPar', repr(self.s.get('mutPar', 0)), '--jobs', '1',
                '--arms', self.arm, '--tag', self.tag, '--ov', ov]
        if self.source == 'B':
            args += ['--levels', str(LEVELS), '--mutLevel', repr(self.s['mutLevel']), '--startLevel', '0']
        return args

    def expected_config(self):
        cfg = {**defaults(), **PHYSICS[self.phys], 'genes': self.K, 'capPerTile': self.cap, 'seed': self.seed, 'width': 64, 'height': 64,
               'gated': self.gated, 'mutPar': self.s.get('mutPar', 0)}
        if self.source == 'B':
            cfg.update({'ladderLevels': LEVELS, 'mutLevel': self.s['mutLevel'], 'ladderNeutral': False})
        return cfg


_defaults = None


def defaults():
    """defaultDropGenesConfig() as the kernel gives it, read once per invocation (nothing is copied by hand)."""
    global _defaults
    if _defaults is None:
        code = f"import {{ defaultDropGenesConfig }} from {json.dumps('file://' + KERNEL)}; console.log(JSON.stringify(defaultDropGenesConfig()));"
        res = subprocess.run(['deno', 'eval', '--no-lock', code], cwd=ROOT, capture_output=True, text=True)
        if res.returncode != 0:
            raise SystemExit(f'could not read the default configuration: {res.stderr[-400:]}')
        _defaults = json.loads(res.stdout)
    return _defaults


_cache = {}


def read(run):
    """The run's figures, or None when its file is not there. A file that is not the run its name says is an error."""
    try:
        stamp = os.stat(run.path).st_mtime_ns
    except FileNotFoundError:
        return None
    hit = _cache.get(run.path)
    if hit and hit[0] == stamp:
        return hit[1]
    with open(run.path) as f:
        doc = json.load(f)
    s, rows = doc['summary'], doc['rows']
    want = run.expected_config()
    missing = object()
    wrong = sorted(k for k in set(want) | set(s['config']) if s['config'].get(k, missing) != want.get(k, missing))
    if s.get('protocol') != PROTOCOL:
        wrong.append('protocol')
    if s['steps'] != run.steps or s['size'] != 64:
        wrong.append('steps or size')
    if s['residual'] != '0':
        wrong.append('residual')
    if s.get('label') != run.name:
        wrong.append('label')
    lad = s.get('ladder')
    if (run.source == 'B') != (lad is not None) or (lad is not None and (lad['startLevel'] != 0 or lad['levels'] != LEVELS or lad['neutral'])):
        wrong.append('ladder')
    held = s['lateMeanCompartments'] >= HELD_COMPARTMENTS and s['lateCompleteShare'] >= HELD_COMPLETE
    if held != s['held']:
        wrong.append('held flag')
    if s['stepsRun'] > s['steps']:
        wrong.append('stepsRun')
    if wrong:
        raise SystemExit(f'{run.path} is not the run its name says (differs in: {", ".join(wrong)})')
    late_from = s['steps'] - s['steps'] // 10
    late = [r for r in rows if r['step'] > late_from]

    def late_mean(key):
        vs = [r[key] for r in late if r.get(key) is not None]
        return sum(vs) / len(vs) if vs else None

    ended = s['stepsRun'] < s['steps']
    out = {
        'file': os.path.relpath(run.path, BASE), 'steps': s['steps'], 'stepsRun': s['stepsRun'], 'endedEarly': ended, 'extinctAt': s['extinctAt'],
        'held': held, 'lateCompartments': s['lateMeanCompartments'], 'lateCompleteShare': s['lateCompleteShare'],
        # Arena-wide share of all template copies that are the parasite (source A) or at the top level (source B),
        # mean over the report rows of the last tenth: what summarize.ts prints as "late parasite share".
        'lateParasiteShare': late_mean('parasiteShare'), 'lateRows': len(late),
        'lateCopies': late_mean('meanCopies'), 'lateArea': late_mean('meanArea'),
        # Source B: mean ladder level of the copies inside compartments over every census of the last tenth
        # (with two levels this is the share of those copies at the top level).
        'lateLevel': lad['lateLevelMean'] if lad else None, 'lateTopShare': lad['lateTopShare'] if lad else None,
        'fissions': s['fissions'], 'deaths': s['deaths'], 'seconds': s['seconds'], 'carried': False,
    }
    out['lost'] = None if held else lost_where(ended, s['stepsRun'])
    out['against'], out['guard'] = guard(run, out)
    work = out['lateTopShare'] if run.source == 'B' else out['lateParasiteShare']
    out['copiesPerGene'] = None if out['lateCopies'] is None or work is None else out['lateCopies'] * (1 - work) / run.K
    _cache[run.path] = (stamp, out)
    return out


def lost_where(ended, steps_run):
    if not ended:
        return 'below the bar at the end'
    return 'founders' if steps_run <= FOUNDERS_BY else 'early' if steps_run <= EARLY_BY else 'late'


def guard(run, m):
    """(holds against the parasite, reason it does not). Only a held run with a parasite source can. The floor
    is read first: a seed that fails both floor and ceiling is "below the floor"."""
    if run.s['clean'] or not m['held']:
        return False, None
    share = m['lateParasiteShare']
    if share is None or share < floor_of(run.setting):
        return False, 'below the floor'
    if run.source == 'B' and (m['lateLevel'] is None or m['lateLevel'] > LEVEL_CEILING):
        return False, 'above the ceiling'
    return True, None


def result(phys, setting, K, cap, gated, seed):
    """Frontier-stage figures of one seed: the 200,000-step run, or, for a gated seed whose 50,000-step run of
    the same configuration ended early, that run carried over (the longer run is the same computation up to
    the step where no wall is left, and stops there). None when neither exists."""
    m = read(Run(LONG, phys, setting, K, cap, gated, seed))
    if m is not None:
        return m
    if gated and seed in SCREEN_SEEDS:
        short = read(Run(SHORT, phys, setting, K, cap, True, seed))
        if short is not None and short['endedEarly']:
            # The 200,000-step run would stop at the same step with nothing left: not held, whatever the short
            # run's own late window read.
            return {**short, 'carried': True, 'steps': LONG, 'held': False, 'against': False, 'guard': None, 'lost': lost_where(True, short['stepsRun']),
                    'lateCompartments': 0, 'lateCompleteShare': 0, 'lateParasiteShare': None, 'lateRows': 0, 'lateCopies': None, 'lateArea': None,
                    'lateLevel': None, 'lateTopShare': None, 'copiesPerGene': None}
    return None


def cell(phys, setting, K, cap, gated=True):
    """A frontier-stage cell: four seeds of one arm."""
    seeds = {seed: result(phys, setting, K, cap, gated, seed) for seed in FRONT_SEEDS}
    known = [m for m in seeds.values() if m is not None]
    n_held = sum(1 for m in known if m['held'])
    n_lost = len(known) - n_held
    n_against = sum(1 for m in known if m['against'])
    status = 'held' if n_held >= 3 else 'not held' if n_lost >= 2 else 'open'
    carry_lost = all(seeds[s] is not None and seeds[s]['carried'] for s in SCREEN_SEEDS)
    label = None
    if not SETTINGS[setting]['clean'] and gated:
        if status == 'not held':
            label = 'not held'
        elif status == 'held' and n_against >= 3:
            label = 'held, parasite in effect'
        elif status == 'held' and len(known) == 4:
            reasons = {m['guard'] for m in known if m['held'] and not m['against']}
            label = ('held, parasite absent in effect' if reasons == {'below the floor'}
                     else 'held, level above the ceiling' if reasons == {'above the ceiling'} else 'held, guard not met (mixed)')
    return {'phys': phys, 'setting': setting, 'K': K, 'cap': cap, 'gated': gated, 'seeds': seeds, 'known': len(known), 'held': n_held,
            'lost': n_lost, 'against': n_against, 'status': status, 'complete': len(known) == 4, 'carryLost': carry_lost, 'label': label}


# ---- Stage decisions ------------------------------------------------------------------------------------------

def gate(source, phys, K, cap):
    """Stage 1 for one cell: (seeds held of 2, or None while a run is missing; the two runs' figures)."""
    ms = [read(Run(SHORT, phys, CLEAN_OF[source], K, cap, True, seed)) for seed in SCREEN_SEEDS]
    if any(m is None for m in ms):
        return None, ms
    return sum(1 for m in ms if m['held']), ms


def screen(phys, setting, K, cap):
    """Stage 2 for one cell: (seeds held of 2; None while a run is missing or the cell did not pass the gate)."""
    passed, _ = gate(SETTINGS[setting]['source'], phys, K, cap)
    if passed != 2:
        return None, []
    ms = [read(Run(SHORT, phys, setting, K, cap, True, seed)) for seed in SCREEN_SEEDS]
    if any(m is None for m in ms):
        return None, ms
    return sum(1 for m in ms if m['held']), ms


def groups():
    return [(setting, phys, cap) for setting in PAR_SETTINGS for phys in PHYSICS for cap in SITES]


def alive_ks(setting, phys, cap):
    """K alive after stage 2: passed the clean gate (both seeds held) and at least one of two seeds held with the source."""
    return [K for K in KS if (screen(phys, setting, K, cap)[0] or 0) >= 1]


def frontier_ks(setting, phys, cap):
    """The K run at the frontier stage for one group, in the order they become due: the largest K alive after
    stage 2 and the K just above it; then, down from the largest alive K, while the lowest cell of that chain is
    not held (two seeds not held), the next lower K that was alive; and while the highest K run is held (three
    seeds held), the next K above it."""
    alive = alive_ks(setting, phys, cap)
    kf = max(alive) if alive else None
    ks = ([kf] if alive else []) + [K for K in KS if kf is None or K > kf][:1]
    k = kf
    while kf is not None:  # step down
        c = cell(phys, setting, k, cap)
        lower = [K for K in alive if K < k]
        if c['status'] != 'not held' or not lower:
            break
        k = max(lower)
        ks.append(k)
    k = max(ks)
    while cell(phys, setting, k, cap)['status'] == 'held' and any(K > k for K in KS):  # step up
        k = min(K for K in KS if K > k)
        ks.append(k)
    return ks


def stage_complete(mode, settings=None):
    if mode == 'gate':
        return all(gate(src, phys, K, cap)[0] is not None for src in 'AB' for phys in PHYSICS for K in KS for cap in SITES)
    return all(gate(SETTINGS[st]['source'], phys, K, cap)[0] != 2 or screen(phys, st, K, cap)[0] is not None
               for st in (settings or PAR_SETTINGS) for phys in PHYSICS for K in KS for cap in SITES)


BRIEF = [st for st in PAR_SETTINGS if st not in ADDED]


def front_tiers_open(settings, top):
    """True while a frontier run of these settings in tiers 1 to `top` is still due."""
    return any(tier <= top and run.setting in settings | {'a0', 'b0'} for tier, run in jobs_for('front'))


def order_key(run):
    return (-run.K, run.source, list(SETTINGS).index(run.setting), -run.cap, list(PHYSICS).index(run.phys), run.arm, run.seed)


def jobs_for(mode):
    """[(tier, Run)] still to do for a mode, in the plan's order."""
    out = []
    if mode == 'gate':
        for src in 'AB':
            for phys in PHYSICS:
                for K in KS:
                    for cap in SITES:
                        out += [(0, Run(SHORT, phys, CLEAN_OF[src], K, cap, True, seed)) for seed in SCREEN_SEEDS]
    elif mode in ('par', 'par-added'):
        if not stage_complete('gate'):
            raise SystemExit('stage 1 (gate) is not complete')
        if mode == 'par-added' and (not stage_complete('par', BRIEF) or front_tiers_open(set(BRIEF), 6)):
            raise SystemExit("the added rate's screen waits until tiers 1 to 6 of the brief's grid are done")
        for st in (BRIEF if mode == 'par' else sorted(ADDED)):
            for phys in PHYSICS:
                for K in KS:
                    for cap in SITES:
                        if gate(SETTINGS[st]['source'], phys, K, cap)[0] == 2:
                            out += [(0, Run(SHORT, phys, st, K, cap, True, seed)) for seed in SCREEN_SEEDS]
    elif mode == 'front':
        if not stage_complete('gate') or not stage_complete('par', BRIEF):
            raise SystemExit('stages 1 and 2 are not complete')
        clean_tier = {}
        for st, phys, cap in groups():
            if st in ADDED and not stage_complete('par', [st]):
                continue  # the added rate joins the frontier once its own screen is complete
            src = SETTINGS[st]['source']
            for K in frontier_ks(st, phys, cap):
                c = cell(phys, st, K, cap)
                # Tiers 1 to 3: the brief's grid, K of 4 or more (with the source, without, ungated); 4 to 6: the
                # brief's grid, K of 3 or less; 7 to 9 and 10 to 12: the same for the added rate; 13: cells that
                # could never be held.
                base = (0 if K >= 4 else 3) + (6 if st in ADDED else 0)
                tier = 13 if c['carryLost'] else base + 1
                out += [(tier, Run(LONG, phys, st, K, cap, True, seed)) for seed in FRONT_SEEDS if c['seeds'][seed] is None]
                key = (src, phys, K, cap)
                clean_tier[key] = min(clean_tier.get(key, 99), 13 if c['carryLost'] else base + 2)
                if c['status'] == 'held' and c['complete']:
                    u = cell(phys, st, K, cap, gated=False)
                    out += [(base + 3, Run(LONG, phys, st, K, cap, False, seed)) for seed in FRONT_SEEDS if u['seeds'][seed] is None]
        for (src, phys, K, cap), tier in clean_tier.items():
            c = cell(phys, CLEAN_OF[src], K, cap)
            out += [(tier, Run(LONG, phys, CLEAN_OF[src], K, cap, True, seed)) for seed in FRONT_SEEDS if c['seeds'][seed] is None]
    else:
        raise SystemExit(f'no jobs for mode {mode}')
    todo = [(tier, run) for tier, run in out if read(run) is None]
    todo.sort(key=lambda j: (j[0],) + order_key(j[1]))
    return todo


# ---- Running --------------------------------------------------------------------------------------------------

_steps = {}


# The screen's own stage directories: the confirmation (made with sweep.ts into a directory of its own, for
# example runs/dropgenes/room/confirm) is not charged to the screen's allocation.
SCREEN_STAGES = {f'{src}-{part}' for src in 'ab' for part in ('gate-50k', 'par-50k', 'front-200k')} | {'carry-check'}


def steps_spent():
    """Steps actually run, summed over every finished run file in the screen's stage directories."""
    total = 0
    for sub in sorted(os.listdir(BASE)) if os.path.isdir(BASE) else []:
        d = os.path.join(BASE, sub)
        if not os.path.isdir(d) or sub not in SCREEN_STAGES:
            continue
        for name in os.listdir(d):
            if name.endswith('.json'):
                path = os.path.join(d, name)
                stamp = os.stat(path).st_mtime_ns
                if _steps.get(path, (None, 0))[0] != stamp:
                    with open(path) as f:
                        _steps[path] = (stamp, json.load(f)['summary']['stepsRun'])
                total += _steps[path][1]
    return total


def orphans():
    """Pids of any sweep.ts or run.ts of this checkout that is still alive."""
    pids = []
    res = subprocess.run(['pgrep', '-fl', r'experiments/dropgenes/(run|sweep)\.ts'], capture_output=True, text=True)
    for line in res.stdout.splitlines():
        pid, _, cmd = line.partition(' ')
        if SWEEP in cmd or RUNNER in cmd:
            pids.append(pid)
            continue
        # A relative path: ours if the process's working directory is inside this checkout.
        cwd = subprocess.run(['lsof', '-a', '-p', pid, '-d', 'cwd', '-Fn'], capture_output=True, text=True).stdout
        if any(l[1:] == ROOT or l[1:].startswith(ROOT + os.sep) for l in cwd.splitlines() if l.startswith('n')):
            pids.append(pid)
    return pids


_lockfile = None
_checkout_lockfile = None
CHECKOUT_LOCK = os.path.join(REAL_BASE, '..', '.room-checkout.lock')  # beside the real output directory: one per checkout


def take_lock():
    """One running driver per output directory, so two invocations cannot pass four runs between them or race on a file.
    And one per checkout whatever its output directory: the four-run limit and the orphan check are about this
    checkout's processes, so a driver on another ROOM_BASE must not pass its own four beside ours. Both locks are
    taken before the orphan check and held until this process exits."""
    global _lockfile, _checkout_lockfile
    import fcntl
    os.makedirs(os.path.dirname(os.path.abspath(CHECKOUT_LOCK)), exist_ok=True)
    _checkout_lockfile = open(os.path.abspath(CHECKOUT_LOCK), 'w')
    try:
        fcntl.flock(_checkout_lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit('another room.py is running in this checkout')
    os.makedirs(BASE, exist_ok=True)
    _lockfile = open(os.path.join(BASE, '.lock'), 'w')
    try:
        fcntl.flock(_lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit(f'another room.py is running on {BASE}')
    if orphans():
        raise SystemExit(f'sweep.ts or run.ts of this checkout is still running (pids {", ".join(orphans())}); wait for it')


_lock = threading.Lock()


def run_one(run):
    os.makedirs(os.path.dirname(run.path), exist_ok=True)
    logdir = os.path.join(BASE, 'logs', run.stage)
    os.makedirs(logdir, exist_ok=True)
    t0 = time.time()
    with open(os.path.join(logdir, run.name + '.log'), 'a') as log:
        proc = subprocess.Popen(run.sweep_args(), cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        _, status, ru = os.wait4(proc.pid, 0)
        proc.returncode = os.waitstatus_to_exitcode(status)
    wall = time.time() - t0
    m = read(run) if proc.returncode == 0 else None
    with _lock:
        with open(os.path.join(BASE, 'ledger.jsonl'), 'a') as f:
            f.write(json.dumps({'t': datetime.datetime.now().isoformat(timespec='seconds'), 'file': os.path.relpath(run.path, BASE), 'exit': proc.returncode,
                                'wall': round(wall, 1), 'cpu': round(ru.ru_utime + ru.ru_stime, 1), 'stepsRun': m['stepsRun'] if m else None}) + '\n')
        if m is None:
            print(f'FAILED {run.name} (exit {proc.returncode}); see logs/{run.stage}/{run.name}.log', flush=True)
        else:
            extra = '' if m['lateParasiteShare'] is None else f' share={m["lateParasiteShare"]:.4f}'
            print(f'{run.stage}/{run.name}: held={m["held"]} comps={m["lateCompartments"]:.1f} complete={m["lateCompleteShare"]:.2f} '
                  f'stepsRun={m["stepsRun"]}{extra} ({wall:.0f}s)', flush=True)
    return proc.returncode == 0


def execute(mode, dry):
    """Run a mode's jobs. Before every launch the list of what is due is re-read from disk, and the first run
    of the lowest tier that is not already in flight is started, so a step up or step down takes its place in
    the order as soon as the seed that triggers it has finished."""
    if dry:
        todo = jobs_for(mode)
        for t, run in todo:
            print(f'tier {t}  {run.stage}/{run.name}')
        print(f'{len(todo)} runs due now ({sum(r.steps for _, r in todo):,} steps if every one goes the full length); '
              f'{steps_spent():,} of {BUDGET_STEPS:,} budget steps used')
        return
    take_lock()
    t_start = time.time()
    state = {'flying': {}, 'stop': None, 'failed': 0, 'started': 0}
    print(f'{mode}: {len(jobs_for(mode))} runs due; {steps_spent():,} of {BUDGET_STEPS:,} budget steps used', flush=True)

    def next_run():
        """The next run to start, or None to finish this worker; waits while runs in flight may still change what is due."""
        while True:
            with _lock:
                if state['stop']:
                    return None
                todo = [(t, r) for t, r in jobs_for(mode) if r.path not in state['flying'] and t <= MAX_TIER]
                if not todo:
                    if not state['flying']:
                        return None
                elif time.time() - t_start > MINUTES * 60:
                    state['stop'] = 'time'
                    return None
                else:
                    tier, run = todo[0]
                    # Steps actually run so far, plus the full length of every run in flight, plus this one.
                    if steps_spent() + sum(state['flying'].values()) + run.steps <= BUDGET_STEPS:
                        state['flying'][run.path] = run.steps
                        state['started'] += 1
                        print(f'start tier {tier}: {run.stage}/{run.name}', flush=True)
                        return run
                    if not state['flying']:
                        state['stop'] = 'budget'
                        return None
                    # Otherwise wait: a run in flight may end early and free its reservation.
            time.sleep(2)

    def worker():
        while True:
            run = next_run()
            if run is None:
                return
            ok = False
            try:
                ok = run_one(run)
            finally:  # a raise inside run_one still frees the reservation and counts as a failure (the other workers stop)
                with _lock:
                    del state['flying'][run.path]
                    if not ok:
                        state['failed'] += 1
                        state['stop'] = state['stop'] or 'failure'

    threads = [threading.Thread(target=worker) for _ in range(JOBS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    left = len(jobs_for(mode)) if not state['failed'] else None
    if state['stop']:
        print(f'{mode}: stopped ({state["stop"]}) after starting {state["started"]} runs; {left} still due. '
              + ('Invoke again to go on.' if state['stop'] == 'time' else 'The step budget would be passed: see PLAN.md, order of cuts.' if state['stop'] == 'budget' else ''))
    else:
        print(f'{mode}: nothing left to run ({state["started"]} runs started)')
    if state['failed']:
        raise SystemExit(f'{state["failed"]} runs failed')


def check_carry():
    """Re-run up to two carried-over seeds (one per source) at 200,000 steps: they must end at the same step."""
    picks = {}
    for st, phys, cap in groups():
        for K in KS:
            for seed in SCREEN_SEEDS:
                m = read(Run(SHORT, phys, st, K, cap, True, seed))
                src = SETTINGS[st]['source']
                if m is not None and m['endedEarly'] and m['stepsRun'] > FOUNDERS_BY and src not in picks:
                    picks[src] = (phys, st, K, cap, seed, m)
    take_lock()
    for src, (phys, st, K, cap, seed, short) in sorted(picks.items()):
        run = Run(LONG, phys, st, K, cap, True, seed, check=True)
        if read(run) is None and not run_one(run):
            raise SystemExit('check run failed')
        m = read(run)
        same = all(m[k] == short[k] for k in ('stepsRun', 'extinctAt', 'fissions', 'deaths')) and not m['held']
        print(f'{run.name}: 50,000-step run ended at {short["stepsRun"]}, 200,000-step run at {m["stepsRun"]}: {"SAME" if same else "DIFFERENT"}')
        if not same:
            raise SystemExit('a carried-over seed does not repeat: the carry-over rule cannot be used')
    if not picks:
        print('no carried-over seed that ended after the founders yet')


# ---- Tables -----------------------------------------------------------------------------------------------------

def fmt(v, d=2):
    return 'n/a' if v is None else f'{v:.{d}f}'


def rng(vs, d=1):
    xs = [v for v in vs if v is not None]
    return 'n/a' if not xs else (f'{min(xs):.{d}f}' if min(xs) == max(xs) else f'{min(xs):.{d}f} to {max(xs):.{d}f}')


def seed_note(m):
    if m is None:
        return 'not run'
    if m['held']:
        # run.ts counts the censuses after a world has ended as zeros, so a run that ended inside its own late
        # window can still clear the bar. It is held by the rule as written; the table says what happened.
        return 'held' + (f' by the rule, but ended at step {m["stepsRun"]:,}' if m['endedEarly'] else '')
    where = {'founders': 'at the founders', 'early': 'early', 'late': 'late', 'below the bar at the end': 'below the bar at the end'}[m['lost']]
    return f'lost {where}' + (f' ({m["stepsRun"]:,})' if m['endedEarly'] else '') + (' [carried]' if m['carried'] else '')


def strip(m):
    return None if m is None else {k: v for k, v in m.items()}


def build():
    """Everything the tables and the outcome need, from the files on disk."""
    data = {'grid': {'K': KS, 'physics': PHYSICS, 'sites': SITES, 'levels': LEVELS, 'settings': SETTINGS, 'floors': {s: floor_of(s) for s in PAR_SETTINGS},
                     'levelCeiling': LEVEL_CEILING, 'short': SHORT, 'long': LONG},
            'gate': [], 'screen': [], 'groups': [], 'cells': [], 'clean': [], 'ungated': []}
    for src in 'AB':
        for phys in PHYSICS:
            for cap in SITES:
                for K in KS:
                    n, ms = gate(src, phys, K, cap)
                    data['gate'].append({'source': src, 'phys': phys, 'cap': cap, 'K': K, 'held': n, 'passed': n == 2, 'runs': [strip(m) for m in ms]})
    for st, phys, cap in groups():
        src = SETTINGS[st]['source']
        for K in KS:
            n, ms = screen(phys, st, K, cap)
            if ms:
                data['screen'].append({'setting': st, 'phys': phys, 'cap': cap, 'K': K, 'held': n, 'alive': (n or 0) >= 1, 'runs': [strip(m) for m in ms]})
        ready = stage_complete('gate') and stage_complete('par', [st])  # the added rate's screen is run later than the brief's
        alive = alive_ks(st, phys, cap) if ready else []
        ks = frontier_ks(st, phys, cap) if ready else []
        cells = {K: cell(phys, st, K, cap) for K in ks}
        held_raw = [K for K, c in cells.items() if c['status'] == 'held']
        in_effect = [K for K, c in cells.items() if c['label'] == 'held, parasite in effect']
        open_ks = [K for K, c in cells.items() if c['label'] is None]
        # No step down is made from a held cell that does not count, so below it nothing is established.
        not_est = not in_effect and bool(held_raw) and not open_ks
        data['groups'].append({'setting': st, 'source': src, 'phys': phys, 'cap': cap, 'added': st in ADDED, 'aliveAfterStage2': alive, 'frontierKs': ks,
                               'largestHeld': max(held_raw) if held_raw else None, 'largestInEffect': max(in_effect) if in_effect else None,
                               'inEffectNotEstablished': not_est, 'open': open_ks, 'labels': {str(K): c['label'] for K, c in cells.items()}})
        for K, c in cells.items():
            cl = cell(phys, CLEAN_OF[src], K, cap)
            # PLAN.md: a held cell whose no-source control is not held is flagged; the cell's own label does not change.
            # Only a control that is settled as not held counts, not one that is still open.
            data['cells'].append({**{k: c[k] for k in ('phys', 'setting', 'K', 'cap', 'held', 'lost', 'against', 'known', 'status', 'complete', 'carryLost', 'label')},
                                  **({'controlNotHeld': True} if c['status'] == 'held' and cl['status'] == 'not held' else {}),
                                  'seeds': {str(s): strip(m) for s, m in c['seeds'].items()}})
            if not any(x['phys'] == phys and x['setting'] == CLEAN_OF[src] and x['K'] == K and x['cap'] == cap for x in data['clean']):
                data['clean'].append({**{k: cl[k] for k in ('phys', 'setting', 'K', 'cap', 'held', 'lost', 'known', 'status', 'complete')},
                                      'seeds': {str(s): strip(m) for s, m in cl['seeds'].items()}})
            if c['status'] == 'held':
                u = cell(phys, st, K, cap, gated=False)
                reading = None if not u['complete'] else 'the gate is not needed' if u['held'] >= 3 else 'the gate is needed' if u['held'] <= 1 else 'unclear'
                data['ungated'].append({**{k: u[k] for k in ('phys', 'setting', 'K', 'cap', 'held', 'lost', 'known', 'status', 'complete')}, 'reading': reading,
                                        'seeds': {str(s): strip(m) for s, m in u['seeds'].items()}})
    def outcome(gs):
        best = [g['largestInEffect'] for g in gs if g['largestInEffect'] is not None]
        kstar = max(best) if best else None
        # An open cell can change the outcome name only if its K is 4 or more, or if it is the highest K run in
        # its group (held, it triggers a step up).
        pending = [f'{g["setting"]}/{g["phys"]}/{g["cap"]}' for g in gs
                   if not g['frontierKs'] or any(K >= 4 or K == max(g['frontierKs']) for K in g['open'])]
        name = 'room found' if kstar and kstar >= 6 else 'limited room' if kstar and kstar >= 4 else 'no room'
        out = {'largestKInEffect': kstar, 'name': name if not pending else f'not determined yet (so far: {name})', 'groupsWithOpenCells': pending, 'confirm': []}
        # The regime to confirm: highest K held with the parasite in effect; ties by seeds holding against, then late compartments.
        keys = {(g['setting'], g['phys'], g['cap']) for g in gs}
        cands = []
        for c in data['cells']:
            if kstar and kstar >= 4 and c['label'] == 'held, parasite in effect' and c['K'] == kstar and (c['setting'], c['phys'], c['cap']) in keys:
                comps = [m['lateCompartments'] for m in c['seeds'].values() if m and m['against']]
                cands.append((c['against'], sum(comps) / len(comps), c))
        cands.sort(key=lambda t: (-t[0], -t[1]))
        # The ranking can still change while a cell at this K has seeds outstanding: a candidate's own mean moves with
        # its fourth seed, and an open cell can become a candidate. The settled outcome name is not touched.
        cand_cells = [c for _a, _m, c in cands]
        outstanding = [c for c in data['cells'] if kstar and c['K'] == kstar and (c['setting'], c['phys'], c['cap']) in keys and not c['complete'] and c['label'] != 'not held']
        provisional = bool(cands) and bool(outstanding) and (len(cands) > 1 or any(c not in cand_cells for c in outstanding))
        out['confirm'] = [{'setting': c['setting'], 'phys': c['phys'], 'cap': c['cap'], 'K': c['K'], 'against': a, 'meanLateCompartments': m, **({'provisional': True} if provisional else {})}
                          for a, m, c in cands]
        return out

    # The outcome is named on the coordinator's grid; the same reading with the added rate is given beside it.
    data['outcome'] = outcome([g for g in data['groups'] if not g['added']])
    data['outcomeWithAddedRate'] = outcome(data['groups'])
    if (data['outcomeWithAddedRate']['largestKInEffect'] or 0) <= (data['outcome']['largestKInEffect'] or 0):
        data['outcomeWithAddedRate']['confirm'] = []  # a second candidate is named only if the added rate holds a larger K
    data['factors'] = factors(data['groups'])
    return data


def factors(gs):
    """Change in the frontier, in rungs of the K ladder (none, 2, 3, 4, 6, 8), between groups that differ in one factor."""
    by = {(g['setting'], g['phys'], g['cap']): g for g in gs}
    out = {}

    def pairs(name, lo_hi):
        rows = []
        for a, b in lo_hi:
            ga, gb = by[a], by[b]
            if ga['open'] or gb['open'] or not ga['frontierKs'] or not gb['frontierKs']:
                rows.append({'from': '/'.join(map(str, a)), 'to': '/'.join(map(str, b)), 'raw': None, 'inEffect': None})
                continue
            # "Not established" is not "none": such a pair is left out of the in-effect comparison.
            eff = None if ga['inEffectNotEstablished'] or gb['inEffectNotEstablished'] else RUNG[gb['largestInEffect']] - RUNG[ga['largestInEffect']]
            rows.append({'from': '/'.join(map(str, a)), 'to': '/'.join(map(str, b)), 'raw': RUNG[gb['largestHeld']] - RUNG[ga['largestHeld']], 'inEffect': eff})
        done = [r for r in rows if r['raw'] is not None]
        eff = [r for r in done if r['inEffect'] is not None]
        out[name] = {'pairs': rows, 'compared': len(done), 'meanAbsRaw': sum(abs(r['raw']) for r in done) / len(done) if done else None,
                     'meanRaw': sum(r['raw'] for r in done) / len(done) if done else None, 'comparedInEffect': len(eff),
                     'meanAbsInEffect': sum(abs(r['inEffect']) for r in eff) / len(eff) if eff else None}

    pairs('dose: 1e-4 to 1e-6 (source A)', [(('a1e4', p, c), ('a1e6', p, c)) for p in PHYSICS for c in SITES])
    pairs('dose: 1e-4 to 1e-5 (source A)', [(('a1e4', p, c), ('a1e5', p, c)) for p in PHYSICS for c in SITES])
    pairs('dose: 1e-5 to 1e-6 (source A)', [(('a1e5', p, c), ('a1e6', p, c)) for p in PHYSICS for c in SITES])
    pairs('rate: 1/64 to 1/256 (source B)', [(('b64', p, c), ('b256', p, c)) for p in PHYSICS for c in SITES])
    pairs('rate: 1/256 to 1/4096 (source B; added rate)', [(('b256', p, c), ('b4096', p, c)) for p in PHYSICS for c in SITES])
    pairs('rate: 1/64 to 1/4096 (source B; added rate)', [(('b64', p, c), ('b4096', p, c)) for p in PHYSICS for c in SITES])
    brief = [s for s in PAR_SETTINGS if s not in ADDED]
    pairs('physics: LARGE to fuel only', [((s, 'large', c), (s, 'fuel', c)) for s in brief for c in SITES])
    pairs('sites: 16 to 64', [((s, p, 16), (s, p, 64)) for s in brief for p in PHYSICS])
    pairs('physics: LARGE to fuel only (added rate)', [((s, 'large', c), (s, 'fuel', c)) for s in sorted(ADDED) for c in SITES])
    pairs('sites: 16 to 64 (added rate)', [((s, p, 16), (s, p, 64)) for s in sorted(ADDED) for p in PHYSICS])
    return out


NAMES = {'a1e4': 'A, mutPar 1e-4', 'a1e5': 'A, mutPar 1e-5', 'a1e6': 'A, mutPar 1e-6', 'b64': 'B, mutLevel 1/64', 'b256': 'B, mutLevel 1/256', 'b4096': 'B, mutLevel 1/4096',
         'a0': 'A, no source', 'b0': 'B, no source (mutLevel 0)'}
PHYS_NAMES = {'large': '`LARGE`', 'fuel': 'fuel only'}


def table(md_path, json_path):
    d = build()
    L = []
    for title, o in (("Outcome on the coordinator's grid", d['outcome']), ('With the added rate `b4096` included', d['outcomeWithAddedRate'])):
        L.append(f'**{title}: {o["name"]}.** Largest K held at the frontier stage with a parasite source present in effect: '
                 f'{o["largestKInEffect"] if o["largestKInEffect"] else "none"}.'
                 + (f' Groups with cells that could still change it: {", ".join(o["groupsWithOpenCells"])}.' if o['groupsWithOpenCells'] else '') + '\n')
    L.append('\n## Stage 1, clean gate (no parasite source, gated, seeds 1 and 2, 50,000 steps)\n')
    L.append('Seeds held of 2; a cell goes on only on 2 of 2. In brackets: where each seed that was not held was lost (step the run ended).\n')
    L.append('| source | physics | sites | ' + ' | '.join(f'K = {K}' for K in KS) + ' |')
    L.append('|---|---|---|' + '---|' * len(KS))
    for src in 'AB':
        for phys in PHYSICS:
            for cap in SITES:
                cs = []
                for K in KS:
                    g = next(x for x in d['gate'] if (x['source'], x['phys'], x['cap'], x['K']) == (src, phys, cap, K))
                    if g['held'] is None:
                        cs.append('not run')
                    else:
                        lost = '; '.join(seed_note(m) for m in g['runs'] if not m['held'])
                        comps = rng([m['lateCompartments'] for m in g['runs'] if m['held']])
                        cs.append(f'{g["held"]} of 2' + (f', {comps} comps' if g['held'] else '') + (f' [{lost}]' if lost else ''))
                L.append(f'| {src} | {PHYS_NAMES[phys]} | {cap} | ' + ' | '.join(cs) + ' |')
    L.append('\n## Stage 2, parasite screen (gated, seeds 1 and 2, 50,000 steps)\n')
    L.append('Seeds held of 2; a cell is alive on at least 1 of 2. "gate" = did not pass stage 1.\n')
    L.append('| parasite setting | physics | sites | ' + ' | '.join(f'K = {K}' for K in KS) + ' |')
    L.append('|---|---|---|' + '---|' * len(KS))
    for st, phys, cap in groups():
        cs = []
        for K in KS:
            x = next((x for x in d['screen'] if (x['setting'], x['phys'], x['cap'], x['K']) == (st, phys, cap, K)), None)
            if x is None:
                cs.append('gate')
            elif x['held'] is None:
                cs.append('not run')
            else:
                lost = '; '.join(seed_note(m) for m in x['runs'] if not m['held'])
                cs.append(f'{x["held"]} of 2' + (f' [{lost}]' if lost else ''))
        L.append(f'| {NAMES[st]} | {PHYS_NAMES[phys]} | {cap} | ' + ' | '.join(cs) + ' |')
    L.append('\n## Stage 3, the frontier (seeds 1 to 4, 200,000 steps)\n')
    L.append('| parasite setting | physics | sites | alive after stage 2 | largest K held | largest K held, parasite in effect | cells run (K: seeds held of 4, seeds holding against the parasite, label) | clean gate, K passed at 50,000 |')
    L.append('|---|---|---|---|---|---|---|---|')
    for g in d['groups']:
        cells = [c for c in d['cells'] if (c['setting'], c['phys'], c['cap']) == (g['setting'], g['phys'], g['cap'])]
        cells.sort(key=lambda c: c['K'])
        desc = '; '.join(f'K {c["K"]}: not run yet' if c['known'] == 0 else
                         f'K {c["K"]}: {c["held"]} of {c["known"]}{"" if c["complete"] else " (seeds run so far)"}, {c["against"]} against, {c["label"] or "open"}'
                         + (', FLAG: the no-source control is not held' if c.get('controlNotHeld') else '') for c in cells)
        passed = [str(x['K']) for x in d['gate'] if (x['source'], x['phys'], x['cap']) == (g['source'], g['phys'], g['cap']) and x['passed']]
        eff = g['largestInEffect'] or ('not established (a held cell does not count; nothing below it was run)' if g['inEffectNotEstablished'] else 'none')
        L.append(f'| {NAMES[g["setting"]]}{" (added)" if g["added"] else ""} | {PHYS_NAMES[g["phys"]]} | {g["cap"]} | {", ".join(map(str, g["aliveAfterStage2"])) or "none"} | '
                 f'{g["largestHeld"] or "none"} | {eff} | {desc or "not run"} | {", ".join(passed) or "none"} |')
    L.append('\n### Frontier cells, per seed (gated, with the parasite source)\n')
    L.append('Share: late share of all copies that are the parasite (A) or at the top level (B), arena-wide. Level: late mean level inside compartments (B). '
             'Copies per gene: late copies per compartment x (1 - parasite or top-level share) / K.\n')
    L.append('| parasite setting | physics | sites | K | seed | result | late compartments | complete share | share (floor) | level | copies per compartment | copies per gene | holds against |')
    L.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for c in sorted(d['cells'], key=lambda c: (list(SETTINGS).index(c['setting']), c['phys'], c['cap'], c['K'])):
        for s, m in c['seeds'].items():
            if m is None:
                L.append(f'| {NAMES[c["setting"]]} | {PHYS_NAMES[c["phys"]]} | {c["cap"]} | {c["K"]} | {s} | not run | | | | | | | |')
                continue
            L.append(f'| {NAMES[c["setting"]]} | {PHYS_NAMES[c["phys"]]} | {c["cap"]} | {c["K"]} | {s} | {seed_note(m)} | {fmt(m["lateCompartments"], 1)} | {fmt(m["lateCompleteShare"], 3)} | '
                     f'{fmt(m["lateParasiteShare"], 4)} ({floor_of(c["setting"]):.4f}) | {fmt(m["lateLevel"], 3)} | {fmt(m["lateCopies"], 1)} | {fmt(m["copiesPerGene"], 1)} | '
                     f'{"yes" if m["against"] else "no" + (" (" + m["guard"] + ")" if m["guard"] else "")} |')
    L.append('\n### The same cells without the parasite source (gated; seeds 1 to 4, 200,000 steps)\n')
    L.append('| source | physics | sites | K | seeds held | per seed | late compartments | copies per compartment | copies per gene |')
    L.append('|---|---|---|---|---|---|---|---|---|')
    for c in sorted(d['clean'], key=lambda c: (c['setting'], c['phys'], c['cap'], c['K'])):
        ms = list(c['seeds'].values())
        held = [m for m in ms if m and m['held']]
        L.append(f'| {NAMES[c["setting"]]} | {PHYS_NAMES[c["phys"]]} | {c["cap"]} | {c["K"]} | {c["held"]} of {c["known"]}{"" if c["complete"] else " (incomplete)"} | '
                 f'{"; ".join(seed_note(m) for m in ms)} | {rng([m["lateCompartments"] for m in held])} | {rng([m["lateCopies"] for m in held])} | {rng([m["copiesPerGene"] for m in held])} |')
    L.append('\n### Ungated, with the parasite source, for the held frontier cells\n')
    L.append('| parasite setting | physics | sites | K | seeds held | per seed | late compartments | late share | reading |')
    L.append('|---|---|---|---|---|---|---|---|---|')
    for c in sorted(d['ungated'], key=lambda c: (list(SETTINGS).index(c['setting']), c['phys'], c['cap'], c['K'])):
        ms = list(c['seeds'].values())
        held = [m for m in ms if m and m['held']]
        L.append(f'| {NAMES[c["setting"]]} | {PHYS_NAMES[c["phys"]]} | {c["cap"]} | {c["K"]} | {c["held"]} of {c["known"]} | {"; ".join(seed_note(m) for m in ms)} | '
                 f'{rng([m["lateCompartments"] for m in held])} | {rng([m["lateParasiteShare"] for m in held], 4)} | {c["reading"] or "not run in full"} |')
    L.append('\n## Copies per gene against K (stage 1 and stage 2 runs that were held; seeds 1 and 2, 50,000 steps)\n')
    L.append('| setting | physics | sites | ' + ' | '.join(f'K = {K}: compartments / copies per compartment / copies per gene' for K in KS) + ' |')
    L.append('|---|---|---|' + '---|' * len(KS))
    for st in SETTINGS:
        for phys in PHYSICS:
            for cap in SITES:
                cs = []
                for K in KS:
                    ms = [read(Run(SHORT, phys, st, K, cap, True, seed)) for seed in SCREEN_SEEDS]
                    held = [m for m in ms if m and m['held']]
                    cs.append(f'{rng([m["lateCompartments"] for m in held])} / {rng([m["lateCopies"] for m in held])} / {rng([m["copiesPerGene"] for m in held])}' if held else '-')
                L.append(f'| {NAMES[st]} | {PHYS_NAMES[phys]} | {cap} | ' + ' | '.join(cs) + ' |')
    L.append('\n## Which factor moved the frontier (rungs of the ladder none, 2, 3, 4, 6, 8; groups that differ in that one factor)\n')
    L.append('| factor | pairs compared | mean change, largest K held | mean absolute change, largest K held | mean absolute change, parasite in effect | per pair (largest K held / in effect) |')
    L.append('|---|---|---|---|---|---|')
    for name, f in d['factors'].items():
        per = '; '.join(f'{r["from"]} to {r["to"]}: ' + ('not compared' if r['raw'] is None else f'{r["raw"]:+d} / ' + ('n.e.' if r['inEffect'] is None else f'{r["inEffect"]:+d}')) for r in f['pairs'])
        L.append(f'| {name} | {f["compared"]} of {len(f["pairs"])} | {fmt(f["meanRaw"])} | {fmt(f["meanAbsRaw"])} | {fmt(f["meanAbsInEffect"])} ({f["comparedInEffect"]} pairs) | {per} |')
    L.append('\nn.e.: not established in one of the two groups, so the pair is left out of the in-effect figure.')
    for title, o in (("Regime to confirm, coordinator's grid", d['outcome']), ('Regime to confirm, with the added rate', d['outcomeWithAddedRate'])):
        if o['confirm']:
            c = o['confirm'][0]
            L.append(f'\n## {title}\n\n{NAMES[c["setting"]]}, {PHYS_NAMES[c["phys"]]}, {c["cap"]} sites, K = {c["K"]} '
                     f'({c["against"]} of 4 seeds holding against the parasite, {c["meanLateCompartments"]:.1f} late compartments). Candidates at this K: {len(o["confirm"])}.'
                     + (' PROVISIONAL: a cell at this K still has seeds outstanding, and they can change which regime ranks first.' if c.get('provisional') else ''))
    text = '\n'.join(L) + '\n'
    print(text)
    if md_path:
        with open(md_path, 'w') as f:
            f.write(text)
    if json_path:
        with open(json_path, 'w') as f:
            json.dump(d, f, indent=1)


def confirm_read(rest):
    """Read a confirmation directory made with sweep.ts (PLAN.md, "Frozen regime") and apply the pass rule. It
    reads files only; this driver starts no run on a seed above 4."""
    opt = {rest[i][2:]: rest[i + 1] for i in range(0, len(rest), 2)}
    d, st, phys, K, cap = opt['dir'], opt['setting'], opt['phys'], int(opt['K']), int(opt['cap'])
    seeds = [int(x) for x in opt['seeds'].split(',')]
    if st not in PAR_SETTINGS or phys not in PHYSICS:
        raise SystemExit('confirm-read: --setting or --phys not understood')
    # The confirmation's horizon is fixed. The plumbing-test switch shortens LONG, so the reader refuses it.
    if TEST_STEPS or LONG != CONFIRM_STEPS:
        raise SystemExit('confirm-read: not available with ROOM_TEST_STEPS set (the confirmation horizon is 200,000 steps)')
    # The confirmation's blocks are fixed: 41 to 44, then 45 to 48. Seeds 1,2,3,4 are accepted only as a
    # self-test of this reader on the screen's own files, and never give a verdict.
    selftest = seeds == [1, 2, 3, 4]
    if not selftest and seeds not in ([41, 42, 43, 44], [41, 42, 43, 44, 45, 46, 47, 48]):
        raise SystemExit('confirm-read: --seeds must be 41,42,43,44 or 41,42,43,44,45,46,47,48 (1,2,3,4 for a self-test)')
    # A verdict is given for the frozen regime only (PLAN.md, "Frozen regime"). Any other cell can be read as a
    # self-test on seeds 1 to 4, which never gives a verdict.
    if not selftest and (st, phys, K, cap) != FROZEN_REGIME:
        raise SystemExit('confirm-read: seeds 41 to 48 are read for the frozen regime only (--setting a1e5 --phys fuel --K 6 --cap 64)')
    src = SETTINGS[st]['source']
    probe = Run(LONG, phys, st, K, cap, True, 1)

    def load(arm_key, seed):
        is_with = arm_key == 'with'
        gated = arm_key != 'ungated'
        setting = CLEAN_OF[src] if arm_key == 'without' else st
        r = Run(LONG, phys, setting, K, cap, gated, 1)
        path = os.path.join(d, f'{probe.tag}-K{K}-cap{cap}-{"GATED_CLEAN" if arm_key == "without" and src == "A" else r.arm}-s{seed}.json')
        if arm_key == 'without' and src == 'B':
            path = os.path.join(d, f'{phys}-{CLEAN_OF[src]}-K{K}-cap{cap}-{r.arm}-s{seed}.json')
        try:
            with open(path) as f:
                doc = json.load(f)
        except FileNotFoundError:
            return None
        s_, rows = doc['summary'], doc['rows']
        want = {**r.expected_config(), 'seed': seed}
        missing = object()
        wrong = sorted(k for k in set(want) | set(s_['config']) if s_['config'].get(k, missing) != want.get(k, missing))
        if s_.get('protocol') != PROTOCOL or s_['steps'] != LONG or s_['residual'] != '0':
            wrong.append('protocol, steps or residual')
        # The arm that feeds the pass rule may not be an early stop that still clears the bar on post-end zeros. A control
        # is only reported, with its stop step beside it: held or not by run.ts's rule (both thresholds).
        if s_['stepsRun'] > LONG or (is_with and s_['stepsRun'] < LONG and s_['lateMeanCompartments'] >= HELD_COMPARTMENTS):
            wrong.append('stepsRun (a run that stopped early cannot be held)')
        # A full-length run must carry every report row, and so all ten late rows (steps 182,000 to 200,000);
        # a late mean over whichever rows happen to be there is not the pass rule's figure.
        if s_['stepsRun'] == LONG and [x['step'] for x in rows] != list(range(REPORT_EVERY, LONG + 1, REPORT_EVERY)):
            wrong.append(f'report rows (expected one every {REPORT_EVERY:,} steps to {LONG:,})')
        if wrong:
            raise SystemExit(f'{path} is not the frozen regime (differs in: {", ".join(wrong)})')
        late = [x['parasiteShare'] for x in rows if x['step'] > LONG - LONG // 10]
        if s_['stepsRun'] == LONG and (len(late) != 10 or any(v is None for v in late)):
            raise SystemExit(f'{path}: the late parasite share needs all ten late report rows')
        lad = s_.get('ladder')
        m = {'held': s_['lateMeanCompartments'] >= HELD_COMPARTMENTS and s_['lateCompleteShare'] >= HELD_COMPLETE, 'lateCompartments': s_['lateMeanCompartments'],
             'lateParasiteShare': sum(late) / len(late) if late else None, 'lateLevel': lad['lateLevelMean'] if lad else None, 'stepsRun': s_['stepsRun']}
        m['against'], m['guard'] = guard(Run(LONG, phys, setting, K, cap, gated, 1), m)
        return m

    print(f'Regime: {NAMES[st]}, {PHYS_NAMES[phys]}, {cap} sites, K = {K}. Floor {floor_of(st)}' + (f', ceiling {LEVEL_CEILING}' if src == 'B' else '') + '.\n')
    print('| block | seed | gated, with the source | late compartments | late parasite share | holds against | gated, without | ungated, with the source |')
    print('|---|---|---|---|---|---|---|---|')
    verdicts = []
    for b in range(0, len(seeds), 4):
        block = seeds[b:b + 4]
        n = n_without = n_ungated = run_without = run_ungated = 0
        done = True
        for seed in block:
            w, c, u = load('with', seed), load('without', seed), load('ungated', seed)
            done = done and w is not None
            n += bool(w and w['against'])
            n_without += bool(c and c['held'])
            n_ungated += bool(u and u['held'])
            run_without += c is not None
            run_ungated += u is not None
            show = lambda m: ('not run' if m is None else (f'held by the rule, but ended at step {m["stepsRun"]:,} (post-end censuses count as zeros)' if m['stepsRun'] < LONG else 'held')
                              if m is None or m['held'] else f'not held (ran {m["stepsRun"]:,})')
            print(f'| {b // 4 + 1} | {seed} | {show(w)} | {fmt(w and w["lateCompartments"], 1)} | {fmt(w and w["lateParasiteShare"], 4)} | '
                  f'{"n/a" if w is None else "yes" if w["against"] else "no" + (" (" + w["guard"] + ")" if w["guard"] else "")} | {show(c)} | {show(u)} |')
        verdicts.append((block, n, done, n_without, run_without, n_ungated, run_ungated))
    print()
    for block, n, done, n_without, run_without, n_ungated, run_ungated in verdicts:
        print(f'Block {block[0]} to {block[-1]}: holds against the parasite on {n} of 4' + ('' if done else ' (block incomplete: no reading)')
              + f'; without the source held on {n_without} of the {run_without} run; ungated held on {n_ungated} of the {run_ungated} run.')
    # The pass rule: at least 3 of 4 in each block. A complete block under 3 settles "not confirmed" whatever
    # the other block is; an incomplete block is never read.
    full = [v for v in verdicts if v[2]]
    if selftest:
        print('SELF-TEST on seen seeds 1 to 4: not a confirmation, no verdict.')
    elif any(v[1] < 3 for v in full):
        print('NOT CONFIRMED (' + ', '.join(f'block {v[0][0]} to {v[0][-1]}: {v[1]} of 4' for v in full if v[1] < 3) + ').')
    elif len(full) == 2:
        print('CONFIRMED.')
    elif len(full) == 1 and len(verdicts) == 1:
        print('Half the confirmation: the first block passes.')
    elif len(full) == 1:
        print(f'Block {full[0][0][0]} to {full[0][0][-1]} passes; the other block is incomplete, so there is no verdict yet.')
    else:
        print('No complete block.')


def budget():
    spent = steps_spent()
    wall = cpu = n = 0
    try:
        with open(os.path.join(BASE, 'ledger.jsonl')) as f:
            for line in f:
                e = json.loads(line)
                wall += e['wall']
                cpu += e['cpu']
                n += 1
    except FileNotFoundError:
        pass
    print(f'{spent:,} steps in finished run files ({spent / BUDGET_STEPS:.1%} of the {BUDGET_STEPS:,}-step budget = {spent / 350 / 3600:.1f} core-hours at 350 steps a second)')
    print(f'{n} sweep invocations: {wall / 3600:.2f} hours of wall time summed, {cpu / 3600:.2f} hours of CPU time (user + system, sweep.ts and run.ts)')


def listing():
    print(f'K: {KS}; sites: {SITES}; levels (source B): {LEVELS}; horizons: {SHORT:,} and {LONG:,} steps; output: {BASE}')
    for name, ov in PHYSICS.items():
        print(f'physics {name}: --ov {json.dumps(ov, separators=(",", ":"))}')
    for name in SETTINGS:
        r = Run(SHORT, 'large', name, 2, 16, True, 1)
        print(f'setting {name} ({NAMES[name]}): arm {r.arm}; floor {floor_of(name) if name in PAR_SETTINGS else "n/a"}')
        print('   ' + ' '.join(r.sweep_args()[3:]))


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    mode, rest = args[0], args[1:]
    dry = '--dry' in rest
    if mode == 'list':
        listing()
    elif mode in ('gate', 'par', 'par-added', 'front'):
        execute(mode, dry)
    elif mode == 'check':
        check_carry()
    elif mode == 'table':
        table(rest[rest.index('--md') + 1] if '--md' in rest else None, rest[rest.index('--json') + 1] if '--json' in rest else None)
    elif mode == 'budget':
        budget()
    elif mode == 'confirm-read':
        confirm_read(rest)
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
