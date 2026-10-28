import calibration from '../../../../docs/creative-prototypes/vision-calibration.json';
import { rasterFrame, type CalibrationFixture, type ScreenFrame } from './core.ts';
import './style.css';

type CalibrationComparison = { targetId: string; negativeId: string; difference: number; pass: boolean };
type ScoredFixture = CalibrationFixture & {
  rgbSha256: string;
  scores: { targetCosine: number; oneCosine: number; uniformCosine: number; margin: number };
};
type CalibrationArtifact = {
  status: string;
  reason: string;
  prompts: Array<{ id: string; text: string }>;
  fixtures: ScoredFixture[];
  comparisons: CalibrationComparison[];
  repeatMaxDifference: number;
  provenance: {
    modelRepository: string;
    modelRevision: string;
    modelAssetSha256: Record<string, string>;
    device: string;
    dtype: string;
    python: string;
    architecture: string;
    packages: Record<string, string>;
    processor: { inputColorMode: string; resize: { shortestEdge: number; interpolation: string }; centerCrop: { width: number; height: number } };
  };
  runtime: { node: string; platform: string; arch: string };
};

const data = calibration as unknown as CalibrationArtifact;
const verdicts = {
  'stopped-calibration': { state: 'Selection stopped', title: 'Judge failed calibration — no worlds selected' },
  'calibration-passed': { state: 'Calibration passed · search not run', title: 'Calibration passed — no worlds selected' },
} as const;
if (!Object.hasOwn(verdicts, data.status)) throw new Error(`Unknown vision calibration status: ${data.status}`);
const verdict = verdicts[data.status as keyof typeof verdicts];
const comparisonPasses = data.comparisons.filter(row => row.pass).length;
const comparisonFailures = data.comparisons.filter(row => !row.pass);
const byId = new Map(data.fixtures.map(fixture => [fixture.id, fixture]));
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const gallery = el<HTMLDivElement>('gallery');
const countFilter = el<HTMLSelectElement>('count-filter');
const layoutFilter = el<HTMLSelectElement>('layout-filter');
const groupFilter = el<HTMLSelectElement>('group-filter');
const selectedPanel = el<HTMLElement>('selected-panel');
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const fixed = (value: number) => value.toFixed(6);

function setDownload(linkId: string, name: string, content: string, type: string) {
  const link = el<HTMLAnchorElement>(linkId);
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
}
setDownload('export-json', 'vision-calibration.json', `${JSON.stringify(calibration, null, 2)}\n`, 'application/json');

function renderVerdict() {
  el<HTMLElement>('verdict-state').textContent = verdict.state;
  el<HTMLHeadingElement>('verdict-title').textContent = verdict.title;
  el<HTMLElement>('verdict-counts').textContent = `${comparisonPasses} of ${data.comparisons.length} checks passed; ${comparisonFailures.length} failed.`;
  el<HTMLElement>('verdict-reason').textContent = data.reason;
  el<HTMLElement>('fixture-total').textContent = String(data.fixtures.length);

  const controlGroups = [
    ['1', 'One-cluster fixtures'],
    ['uniform', 'Uniform-spread fixtures'],
    ['blank', 'Blank controls'],
    ['one', 'One-dot controls'],
  ] as const;
  const failuresByGroup = new Map<string, number>();
  for (const row of comparisonFailures) {
    const negative = byId.get(row.negativeId);
    if (negative) failuresByGroup.set(negative.group, (failuresByGroup.get(negative.group) ?? 0) + 1);
  }
  el<HTMLElement>('failure-breakdown').innerHTML = controlGroups.map(([group, label]) =>
    `<span class="failure-count"><strong>${failuresByGroup.get(group) ?? 0}</strong><span>${label}</span></span>`
  ).join('');
  const degenerateFailures = (failuresByGroup.get('blank') ?? 0) + (failuresByGroup.get('one') ?? 0);
  el<HTMLElement>('degenerate-failure-note').textContent = degenerateFailures
    ? `${degenerateFailures} of ${comparisonFailures.length} failures involved blank or one-dot controls; the remaining failures compared a cluster fixture with one-cluster or uniform-spread fixtures.`
    : 'No failures involved blank or one-dot controls.';
}

function paint(canvas: HTMLCanvasElement, frame: ScreenFrame) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const rgb = rasterFrame(frame);
  const image = ctx.createImageData(128, 128);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    image.data[p] = rgb[i];
    image.data[p + 1] = rgb[i + 1];
    image.data[p + 2] = rgb[i + 2];
    image.data[p + 3] = 255;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.putImageData(image, 0, 0);
}

function groupName(fixture: ScoredFixture) {
  if (fixture.group === 'uniform') return 'Uniform spread';
  if (fixture.group === 'seam6') return 'Six clusters across seam';
  if (fixture.group === 'blank') return 'Blank control';
  if (fixture.group === 'one') return 'One-dot control';
  const count = Number(fixture.group);
  return `${count} cluster${count === 1 ? '' : 's'}`;
}
function fixtureMeta(fixture: ScoredFixture) {
  return fixture.group === 'blank' || fixture.group === 'one'
    ? `${fixture.frame.population} ${fixture.frame.population === 1 ? 'dot' : 'dots'} · diagnostic control`
    : fixture.group === '3'
      ? `${fixture.count} dots · layout ${fixture.layout} · diagnostic fixture`
    : `${fixture.count} dots · layout ${fixture.layout}`;
}
function matchesFilters(fixture: ScoredFixture) {
  const group = groupFilter.value;
  const diagnostic = fixture.group === 'blank' || fixture.group === 'one';
  if (group === 'blank' || group === 'one') return fixture.group === group;
  if (countFilter.value === 'diagnostics') return diagnostic && (group === 'all' || fixture.group === group);
  if (diagnostic) return false;
  return fixture.count === Number(countFilter.value)
    && fixture.layout === Number(layoutFilter.value)
    && (group === 'all' || fixture.group === group);
}

function renderGallery() {
  const fixtures = data.fixtures.filter(matchesFilters);
  el<HTMLElement>('results-count').textContent = `${fixtures.length} ${fixtures.length === 1 ? 'image' : 'images'} shown · ${data.fixtures.length} saved in total`;
  gallery.replaceChildren();
  if (!fixtures.length) {
    gallery.innerHTML = '<p class="empty-state">No saved images match these filters.</p>';
    return;
  }
  for (const fixture of fixtures) {
    const card = document.createElement('article');
    card.className = 'fixture-card';
    const selection = el<HTMLHeadingElement>('selected-title').dataset.fixtureId === fixture.id;
    const linkedComparisons = data.comparisons.filter(row => row.targetId === fixture.id || row.negativeId === fixture.id);
    const failed = linkedComparisons.filter(row => !row.pass).length;
    const diagnostic = linkedComparisons.length === 0;
    card.innerHTML = `<button class="fixture-select" type="button" data-fixture="${esc(fixture.id)}" aria-pressed="${selection}" aria-label="Inspect ${esc(fixture.label)}">
      <span class="fixture-art"><canvas width="128" height="128" aria-hidden="true"></canvas><span class="still-tag">Saved still</span></span>
      <span class="fixture-copy"><span class="fixture-type">${esc(groupName(fixture))}</span><strong>${esc(fixture.label)}</strong><span class="fixture-meta">${esc(fixtureMeta(fixture))}</span>
      <span class="mini-scores"><span>Target <b>${fixed(fixture.scores.targetCosine)}</b></span><span>One cluster <b>${fixed(fixture.scores.oneCosine)}</b></span><span>Uniform <b>${fixed(fixture.scores.uniformCosine)}</b></span><span class="margin-value">Margin <b>${fixed(fixture.scores.margin)}</b></span></span>
      <span class="fixture-result ${failed ? 'has-failures' : diagnostic ? 'diagnostic-result' : 'no-failures'}">${failed ? `${failed} linked failed ${failed === 1 ? 'check' : 'checks'}` : diagnostic ? 'No required checks (diagnostic)' : 'No failed linked checks'}</span>
      </span></button>`;
    paint(card.querySelector('canvas')!, fixture.frame);
    gallery.append(card);
  }
}

function updatePressed(selectedId: string | null) {
  gallery.querySelectorAll<HTMLButtonElement>('.fixture-select').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.fixture === selectedId));
  });
}

function showFixture(id: string) {
  const fixture = byId.get(id);
  if (!fixture) return;
  const title = el<HTMLHeadingElement>('selected-title');
  title.textContent = fixture.label;
  title.dataset.fixtureId = fixture.id;
  const diagnosticNote = fixture.group === '3' ? 'This three-cluster fixture is diagnostic; it is not part of the required ordering checks.' : '';
  el<HTMLElement>('selected-summary').textContent = `${groupName(fixture)} · ${fixtureMeta(fixture)}. Saved at scheduled tick ${fixture.frame.scheduledTick} (actual tick ${fixture.frame.actualTick}); population ${fixture.frame.population}; mean speed ${fixed(fixture.frame.meanSpeed)}. ${diagnosticNote}`;
  const selectedCanvas = el<HTMLCanvasElement>('selected-image');
  selectedCanvas.setAttribute('aria-label', `${fixture.label}, saved static calibration image`);
  paint(selectedCanvas, fixture.frame);
  el<HTMLElement>('selected-scores').innerHTML = [
    ['Target prompt cosine', fixture.scores.targetCosine],
    ['One-cluster prompt cosine', fixture.scores.oneCosine],
    ['Uniform-spread prompt cosine', fixture.scores.uniformCosine],
    ['This fixture target margin (target minus stronger alternative)', fixture.scores.margin],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${fixed(Number(value))}</dd></div>`).join('');
  const rows = data.comparisons.filter(row => row.targetId === id || row.negativeId === id);
  el<HTMLElement>('comparison-rows').innerHTML = rows.map(row => {
    const other = byId.get(row.targetId === id ? row.negativeId : row.targetId)!;
    const role = row.targetId === id ? 'negative control' : 'target fixture';
    return `<tr class="${row.pass ? 'pass-row' : 'fail-row'}"><td><strong>${esc(other.label)}</strong><span>${role} · ${esc(other.id)}</span></td><td class="numeric">${row.difference > 0 ? '+' : ''}${fixed(row.difference)}</td><td><span class="status-pill ${row.pass ? 'pass' : 'fail'}">${row.pass ? 'Passed' : 'Failed'}</span></td></tr>`;
  }).join('') || '<tr><td colspan="3">This fixture has no required ordering checks; it is shown as a diagnostic.</td></tr>';
  selectedPanel.hidden = false;
  selectedPanel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  updatePressed(id);
}

function renderPrompts() {
  const labels: Record<string, string> = { target: 'Target prompt', one: 'Alternative 1', uniform: 'Alternative 2' };
  el<HTMLElement>('prompts').innerHTML = data.prompts.map(prompt => `<article><span>${labels[prompt.id] ?? prompt.id}</span><p>“${esc(prompt.text)}”</p></article>`).join('');
  const p = data.provenance;
  const assets = Object.entries(p.modelAssetSha256).map(([name, hash]) => `<li><code>${esc(name)}</code><span>${esc(hash)}</span></li>`).join('');
  el<HTMLElement>('provenance').innerHTML = `<div class="provenance-summary"><p><strong>Model</strong>${esc(p.modelRepository)}</p><p><strong>Model revision</strong><code>${esc(p.modelRevision)}</code></p><p><strong>Run</strong>${esc(p.device)} · ${esc(p.dtype)} · Python ${esc(p.python)} · ${esc(p.architecture)}</p><p><strong>Image preparation</strong>${esc(p.processor.inputColorMode)} · ${p.processor.resize.shortestEdge}px ${esc(p.processor.resize.interpolation)} resize · ${p.processor.centerCrop.width}×${p.processor.centerCrop.height} center crop</p><p><strong>Repeat check</strong>Maximum score difference ${fixed(data.repeatMaxDifference)}</p><p><strong>Fixture renderer</strong>128×128 RGB · ${data.fixtures.length} saved images</p><p><strong>Recorded browser-independent runtime</strong>Node ${esc(data.runtime.node)} · ${esc(data.runtime.platform)} ${esc(data.runtime.arch)}</p></div><details><summary>Model file hashes</summary><ul class="hash-list">${assets}</ul></details>`;
}

renderVerdict();
renderPrompts();
renderGallery();
for (const filter of [countFilter, layoutFilter, groupFilter]) filter.addEventListener('change', renderGallery);
gallery.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-fixture]');
  if (button) showFixture(button.dataset.fixture!);
});
el<HTMLButtonElement>('close-selection').addEventListener('click', () => {
  const previouslySelected = el<HTMLHeadingElement>('selected-title').dataset.fixtureId;
  selectedPanel.hidden = true;
  delete el<HTMLHeadingElement>('selected-title').dataset.fixtureId;
  updatePressed(null);
  if (previouslySelected) gallery.querySelector<HTMLButtonElement>(`[data-fixture="${CSS.escape(previouslySelected)}"]`)?.focus();
});
