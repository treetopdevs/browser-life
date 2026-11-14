export const meta = {
  name: '3d-rung2-jar',
  description: 'Rung 2 J0 (depth 64, jar-spots, depth-generic tools, jar goldens) and J1 (pack pass + jar.html renderer) in parallel, then integrate, Codex Sol review, audit, fix',
  whenToUse: 'After rung 1b says go and the claude/3d-rung2-jar worktree exists (docs/3d-rung2-plan-2026-10-23.md section 7). Pass args: { wt: "<absolute worktree path>" }.',
  phases: [
    { title: 'Preflight', detail: 'worktree has slab + volume sandbox + plan; baseline gates green' },
    { title: 'Build', detail: 'J0 depth and tools, J1 renderer, in parallel on disjoint files' },
    { title: 'Integrate', detail: 'jar.html at 64^3, all gates, screenshots' },
    { title: 'Review', detail: 'Codex Sol 6.1 High + adversarial auditor' },
    { title: 'Fix', detail: 'address findings, rerun every gate' },
  ],
}
if (!args || typeof args.wt !== 'string' || !args.wt.startsWith('/')) throw new Error('pass args: { wt: "<absolute path of the claude/3d-rung2-jar worktree>" }')
const WT = args.wt
const PLAN = `${WT}/docs/3d-rung2-plan-2026-10-23.md`
const RULES = `
Work ONLY inside the git worktree ${WT} (branch claude/3d-rung2-jar: the rung 1b slab line with claude/3d-volume-view merged in). Never run git commit, git push, git merge, jj commit/describe/bookmark, or create branches. If the Write/Edit tool refuses a path in this worktree, write with Bash heredocs or python inside ${WT}. Node: PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH. Deno: deno run -A --no-lock.
Design: ${PLAN} (read all of it); background: docs/3d-rung1b-plan-2026-10-23.md, docs/3d-volume-view-2026-10-22.md, docs/3d-rung1b-step-spec.md.
HARD RULES: no new physics rules (the slab rule line is reused unchanged); every existing golden pin, including the 16 slab-* cases, stays byte-identical, and every new optional config key stays absent from defaultConfig(); all arithmetic stays integer and deterministic, CPU and WGSL bit for bit; conservation residual exactly 0; the rung 1b readout of depth-8 bundles must not change. Never touch apps/lab/src/sim.worker.ts or apps/lab/src/execution.ts. This machine can be loaded: if unrelated slow tests time out, rerun just those files alone and report.`
const GATES = { type: 'array', items: { type: 'object', properties: {
  name: { type: 'string' }, command: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } },
  required: ['name', 'command', 'passed'] } }
const RESULT = { type: 'object', properties: {
  ok: { type: 'boolean', description: 'true only if the task is complete and every gate passed' },
  files_changed: { type: 'array', items: { type: 'string' } },
  gates: GATES, notes: { type: 'string' } }, required: ['ok', 'files_changed', 'gates', 'notes'] }
// Required gates per stage, by exact name. A stage passes only if it reports ok, every required gate is present and
// passed, and no reported gate failed.
const REQ = {
  preflight: ['install', 'typecheck', 'test', 'gpu_golden'],
  j0: ['typecheck', 'test', 'gpu_golden', 'jar_smoke', 'readout_tests', 'pick_tests', 'pins_untouched'],
  j1: ['typecheck', 'test', 'pack3d_truth', 'e2e_jar', 'e2e_volume'],
  integ: ['typecheck', 'test', 'gpu_golden', 'pack3d_truth', 'jar_smoke', 'e2e_golden', 'e2e_jar', 'e2e_volume', 'pins_untouched', 'screenshots'],
}
REQ.fix = REQ.integ
const gateNote = (stage) => `Report every gate you ran as one entry in gates (name, exact command, passed, short detail). These gate names are required, spelled exactly: ${REQ[stage].join(', ')} (pins_untouched = git diff shows no existing pin line in packages/sim-ref/test/golden-hashes.test.ts changed; screenshots = the images exist and you looked at each). Set ok to true only if the task is complete and every gate passed; never mark a gate passed that you did not run.`
const stageOk = (r, stage) => !!r && r.ok === true && Array.isArray(r.gates) && r.gates.every((g) => g && g.passed === true) &&
  REQ[stage].every((n) => r.gates.some((g) => g.name === n && g.passed === true))
const reviewOk = (r) => !!r && r.ran === true && Array.isArray(r.findings) &&
  r.findings.every((f) => f && typeof f === 'object' && ['P1', 'P2', 'P3'].includes(f.severity) && typeof f.issue === 'string')
const FIX_RESULT = { type: 'object', properties: {
  ...RESULT.properties,
  resolutions: { type: 'array', items: { type: 'object', properties: {
    index: { type: 'integer' }, outcome: { type: 'string', enum: ['fixed', 'rejected'] }, reason: { type: 'string' } },
    required: ['index', 'outcome', 'reason'] } } }, required: [...RESULT.required, 'resolutions'] }
const PREFLIGHT = { type: 'object', properties: {
  ok: { type: 'boolean' }, missing: { type: 'array', items: { type: 'string' } }, gates: GATES }, required: ['ok', 'gates'] }
const FINDINGS = { type: 'object', properties: {
  ran: { type: 'boolean', description: 'true only if the review actually ran to completion (for Codex: exit code 0 and a non-empty final message)' },
  findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['P1', 'P2', 'P3'] }, file: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' } },
    required: ['severity', 'issue'] } } }, required: ['ran', 'findings'] }

const J0_FILES = 'packages/schema/src/{config,presets,world3}.ts, tools/lib/slab-readout.ts, tools/slab-readout.ts, tools/slab-screen.ts, experiments/3d-slab/*.ts, packages/sim-gpu/src/golden.ts, packages/sim-ref/test/golden-hashes.test.ts, and tests for those'
const J1_FILES = 'packages/sim-gpu/src/pack3d.ts (+ one export line in packages/sim-gpu/src/index.ts), apps/lab/src/volume/** (contract.ts role codes, bake.ts external-light option, every consumer of role or material codes, field.ts), apps/lab/jar.html, apps/lab/src/jar/**, the jar.html entry in apps/lab/vite.config.ts build inputs, tests/deno/pack3d_truth.ts, tests/e2e/jar*.spec.ts, tests/e2e/volume*.spec.ts'

phase('Preflight')
const pre = await agent(`${RULES}

Preflight only; change nothing except running pnpm install. Check that ${WT} exists and has packages/sim-gpu/src/gpu-sim3.ts, packages/sim-ref/src/step3d.ts, apps/lab/src/volume/contract.ts, apps/lab/volume.html and ${PLAN}; that git status is clean; then run pnpm install, pnpm typecheck, pnpm test, and deno run -A --no-lock tests/deno/gpu_golden.ts. ok = every file present and every gate green. ${gateNote('preflight')}`, { phase: 'Preflight', schema: PREFLIGHT, label: 'preflight' })
if (!stageOk(pre, 'preflight')) { log('preflight failed or returned nothing; stopping before any change'); return { stopped: 'preflight', preflight: pre } }

phase('Build')
const [j0, j1] = await parallel([
  () => agent(`${RULES}

Track J0 (depth and tools), plan sections 2, 3, 5.1, 5.2 and milestone J0. Your files: ${J0_FILES}. Another agent is building J1 in parallel on these files, never touch them: ${J1_FILES}.
1. tileD range [4, 64] in validateConfig; grep the whole repo (packages, tools, experiments, tests) for any other place that assumes tileD <= 32 or depth 8 and fix or report each.
2. jar-spots in SLAB_PRESETS exactly as plan 5.1.
3. tools/lib/slab-readout.ts: DEPTH/TOP/BOTTOM become functions of tileD (top and bottom quarter; D must be a multiple of 4). At D = 8 the groups must be {0,1} and {6,7}, and every existing readout test must pass unchanged. The identity checks (PRESET_ID, PROTOCOL_CFG, PROTOCOL_INIT) become a protocol table keyed by preset id: slab-spots keeps exactly today's strict checks, jar-spots gets its own; a bundle must match its preset's protocol exactly. Add tests for D = 16 and 64, a 64-layer synthetic layers.tsv (go, pause, extension, undefined neutral), and each protocol rejecting the other's bundle.
4. tools/slab-readout.ts and tools/slab-screen.ts take --preset (default slab-spots, so existing commands behave identically); layer completeness from tileD.
5. experiments/3d-slab/m4-calibrate.ts, m4-pick.ts, m3-timing.ts take --preset and --lightK=<list>; defaults reproduce rung 1b exactly. Each calibration result records preset, config, steps and RULE_VERSION. m4-pick validates them against the requested protocol, requires distinct seeds 101-103 per setting, requires every setting of the requested grid (60 for slab-spots, 80 for jar-spots) before it prints a PICK, and uses the deepest layer of the preset's tileD for the light window. Test the picker refusing an incomplete grid, a repeated seed and a result from another preset; it must still give the same answer on rung 1b's results.
6. Golden cases jar-deep (16x16x64: default, neutral, a shaded column) and jar-cube (32x32x32: default, motility and signalGain on, seasons on). Run deno run -A --no-lock tests/deno/gpu_golden.ts until GPU and CPU match bit for bit on every case; pin the new hashes under PINNED[1] with a comment; confirm with git diff that no existing pin line changed.
7. A Deno smoke script experiments/3d-slab/jar-smoke.ts: jar-spots 64^3, seed 101, 1,000 steps on GpuSim3, exact matter conservation and energy residual 0; run it and report steps/s.
Gates: pnpm typecheck, pnpm test, gpu_golden.ts, jar-smoke.ts, the readout and picker tests. ${gateNote('j0')}`, { phase: 'Build', schema: RESULT, label: 'J0-depth-tools' }),
  () => agent(`${RULES}

Track J1 (renderer), plan section 4 and milestone J1. Your files: ${J1_FILES}. Another agent is building J0 in parallel on these files, never touch them: ${J0_FILES}. Until J0 widens tileD, develop at 64x64x32 or smaller (tileD <= 32 validates today); the integrator moves the page to 64^3.
1. packages/sim-gpu/src/pack3d.ts: one compute pass reading GpuSim3's current cells, current genome, light and roles buffers (same device, no CPU copy; the public buffers already exist) and writing the contract's word buffer and a u32 light buffer exactly per plan 4.1 (field table, role rule, axis flip voxel (x, D-1-z, y)). Every constant and the hue hash fixed and documented in the file. Also export a pure CPU function packReference(cfg, state, light, roles) returning the same two Uint32Arrays.
2. apps/lab/src/volume/bake.ts: an option to take an external light buffer and skip the column scan; with it off, behaviour is unchanged. contract.ts role codes per plan 4.1 (0 none, 1 photo, 2 grow, 3 decomp, 4 dead, 5 resp); grep every consumer of role and material codes in apps/lab/src/volume/** (bake tints, points sediment filter, slices flags and legend, isosurface material shading, field.ts) and keep volume.html drawing what it drew.
3. apps/lab/jar.html + apps/lab/src/jar/**: standalone page per plan 4.2 (GpuSim3 from a slab preset, steps, pack, draw via the VolumeSource contract). Default view: ray march with the surface skin on bodies above a density threshold (port from apps/lab/src/volume/approaches/raymarch and isosurface; no three.js); slices; layer peel; cut-away; camera presets; controls and URL hash; HUD with steps/s, fps, 1% low, GPU stage times, living cells, depth profile from a role readback once a second. Add jar.html to the vite build inputs.
4. tests/deno/pack3d_truth.ts: (a) 16x16x16 world, 50 steps, GPU word and light buffers read back == packReference word for word; (b) hand-built cells (B=0 with P>0, P only, B=P, all role counts zero, ties among roles, saturated counts, light 0 and 255, z=0 and z=D-1, B+P above 255) checked against expected words written out literally in the test. Run it.
5. tests/e2e/jar.spec.ts: jar.html loads, steps, non-empty frame in each view, no GPU errors. tests/e2e/volume.spec.ts (create if missing): volume.html loads and draws every approach with no GPU errors. Run both with BL_E2E_PORT=5298 npx playwright test <spec>.
Gates: pnpm typecheck, pnpm test, the tests above. ${gateNote('j1')}`, { phase: 'Build', schema: RESULT, label: 'J1-renderer' }),
])
if (!stageOk(j0, 'j0') || !stageOk(j1, 'j1')) { log(`a build track failed or returned nothing (J0 ${stageOk(j0, 'j0')}, J1 ${stageOk(j1, 'j1')}); stopping before integration`); return { stopped: 'build', preflight: pre, j0, j1 } }

phase('Integrate')
const integ = await agent(`${RULES}

Integrate J0 and J1. J0 report: ${JSON.stringify(j0)}
J1 report: ${JSON.stringify(j1)}
1. Move jar.html's default world to jar-spots 64x64x64 now that tileD allows it; check the page at 64^3 in Chrome via Playwright.
2. Run every gate: pnpm typecheck, pnpm test, deno run -A --no-lock tests/deno/gpu_golden.ts, tests/deno/pack3d_truth.ts, experiments/3d-slab/jar-smoke.ts, the Playwright specs tests/e2e/golden.spec.ts (the Chrome selftest), jar.spec.ts and volume.spec.ts (BL_E2E_PORT=5298). Confirm with git diff that no existing pin line changed.
3. Measure the frame budget of plan 4.3 as far as headless Chrome allows (live 64^3, ray march + skin, 4 steps per frame, 1280x860, Side camera, 60 s): report median fps and 1% low, and say plainly that the deciding measurement is on the M1 Max in headed Chrome in J2.
4. Save screenshots of each view (ray march + skin from Side and from above, slices, layer peel) after 2,000 steps to docs/3d-rung2-jar/*.png and LOOK at each one; report what is visible and anything that looks wrong (empty, all one colour, upside down, sediment hiding life) in notes. ${gateNote('integ')}`, { phase: 'Integrate', schema: RESULT, label: 'integrate' })
if (!stageOk(integ, 'integ')) { log('integration failed a gate or returned nothing; stopping before review'); return { stopped: 'integrate', preflight: pre, j0, j1, integ } }

phase('Review')
const [codex, audit] = await parallel([
  () => agent(`${RULES}

Run a read-only Codex Sol review of the uncommitted J0+J1 changes in ${WT} (git diff HEAD plus untracked files). Write the prompt to a scratch file; ask it to check: no physics change and every existing pin untouched; tileD 64 bounds per plan section 3; the readout's quarter groups give {0,1}/{6,7} at D=8 and rung 1b behaviour is unchanged; --preset and --lightK defaults reproduce rung 1b; pack3d WGSL equals packReference (axis flip, role argmax ties, DMAX clamp, hue hash, B=0 cells); GPU resource lifetime and device loss on jar.html; no edits to sim.worker.ts or execution.ts; test adequacy. Run:
codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only -C ${WT} - < <prompt file> > <scratch>/codex-rung2.txt
(timeout up to 600000 ms; if it times out, rerun once with a narrower prompt). Set ran to true only if codex exited 0 with a non-empty final message; return its findings.`, { phase: 'Review', schema: FINDINGS, label: 'codex-sol-rung2' }),
  () => agent(`${RULES}

Adversarial auditor (edit nothing except scratch scripts named experiments/3d-slab/audit_*.ts). Try to break J0+J1: (a) pack truth at the edges: B=0 with P>0, P only, all four role counts tied and all zero, saturated role counts, light 0 and 255, z=0 and z=63 at 64^3, density above DMAX; GPU texture readback vs packReference byte for byte. (b) Run tools/slab-readout.ts on synthetic depth-8 bundles before and after (git stash is shared with other sessions, so instead compare against the committed tools/lib/slab-readout.ts loaded from git show HEAD:... into a scratch file) and confirm identical readout.json. (c) 64^3 bounds: a jar-spots state with E and S at 2^27 everywhere for 5 steps on RefSim3 and GpuSim3 at 16x16x64, bit-identical and conserved. (d) the protocol table and the picker's grid checks. Set ran to true when you finished all four; return findings with concrete repro inputs.`, { phase: 'Review', schema: FINDINGS, label: 'auditor' }),
])
if (!reviewOk(codex) || !reviewOk(audit)) { log(`a review did not run or returned malformed findings (codex ${reviewOk(codex)}, auditor ${reviewOk(audit)}); stopping without fixes`); return { stopped: 'review', preflight: pre, j0, j1, integ, codex, audit } }
const all = [...codex.findings, ...audit.findings]
log(`${all.length} findings (${all.filter(f => f.severity === 'P1').length} P1)`)

phase('Fix')
const fixed = await agent(`${RULES}

Address these review findings on J0+J1 (fix what is right; explain each rejection). Rerun every gate from the integrate stage and confirm no existing pin line changed. Append a "Review (J0+J1)" section to ${PLAN} listing each finding and its outcome, and a "Built" section with the measured jar-smoke steps/s and the headless frame numbers.
${gateNote('fix')} Also return resolutions: one entry per finding, by its index in the list below (0-based), with outcome fixed or rejected and a reason. Every P1 must be fixed.
Findings: ${JSON.stringify(all.map((f, i) => ({ index: i, ...f })), null, 2)}`, { phase: 'Fix', schema: FIX_RESULT, label: 'fix' })
const resolved = !!fixed && Array.isArray(fixed.resolutions) && all.every((f, i) => {
  const r = fixed.resolutions.find((x) => x && x.index === i)
  return !!r && (r.outcome === 'fixed' || (r.outcome === 'rejected' && f.severity !== 'P1'))
})
const done = stageOk(fixed, 'fix') && resolved
if (!done) log(`the fix stage is not clean (gates ${stageOk(fixed, 'fix')}, every finding resolved and every P1 fixed ${resolved}): do not commit; read its report`)

return { ok: done, preflight: pre, j0, j1, integ, findings: all, fixed }
