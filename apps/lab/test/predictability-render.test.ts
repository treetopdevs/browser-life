import { expect, it } from 'vitest';
import { esc, pct, shade, skillText, stripIndices, tableRows, type FixtureView } from '../src/predictability/render.ts';
it('formats rates and skills', () => {
  expect(pct(1, 4)).toBe('25.00%');
  expect(pct(0, 0)).toBe('-');
  expect(skillText(null)).toBe('–');
  expect(skillText({ num: 1, den: 2 })).toBe('+50.0%');
  expect(skillText({ num: -1, den: 4 })).toBe('-25.0%');
  expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
});
it('picks strip frames and shades the ramp', () => {
  expect(stripIndices(96, 6)).toEqual([0, 19, 38, 57, 76, 95]);
  expect(shade(0, 2)).not.toEqual(shade(1, 2));
});
it('table rows carry erased views as a stated absence', () => {
  const f: FixtureView = { id: 'x', family: 'f', q: 2, byResolution: { '1': { erased: true, loss: { '1': { persistence: { errors: 3, cells: 30, skillVsBest: null } } } } } };
  expect(tableRows([f], 1, 1, 'persistence')[0]).toMatchObject({ errors: '3', rate: '10.00%', skill: '– (erased)' });
});
