// The garden page's sun letter (docs/garden-sun-2026-10-18.md) against the contract's own fixture: the view's shape with a
// sun letter in it, the sun block, the body the form sends, and the words the page says.
import { describe, expect, it } from "vitest";
import fixture from "../../coordinator/priv/static/garden-contract.example.json";
import { letterBodyWords, parseGarden, postAnswer, sunBody, sunLandingWords, type GardenView } from "../garden/garden.ts";
import gardenHtml from "../garden/index.html?raw";

const copy = (): Record<string, any> => structuredClone(fixture) as Record<string, any>;
const view = (mutate: (v: Record<string, any>) => void = () => {}): GardenView => {
  const v = copy();
  mutate(v);
  const parsed = parseGarden(v);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.view;
};
const sunLetter = (v: Record<string, any>) => ({ ...v.letters.waiting[3], id: "ltr-8", kind: "sun", x: null, y: null, r: null, percent: 75, span: v.pace.stepsPerDay });

describe("the sun letter on the garden page", () => {
  it("reads a view holding a sun letter (x, y, r null) and its sun block, and an older view without either", () => {
    const v = view((w) => w.letters.waiting.push(sunLetter(w)));
    expect(v.sun).toEqual({ enabled: true, percents: [50, 75], span: 131072, nextLanding: { day: 4, step: 655360 } });
    expect(v.letters.waiting.at(-1)).toMatchObject({ kind: "sun", x: null, percent: 75 });
    expect(view((w) => { delete w.sun; for (const l of [...w.letters.waiting, ...w.letters.recent]) { delete l.percent; delete l.span; } }).sun).toBeUndefined();
    const bad = copy();
    bad.sun.percents = "50";
    expect(parseGarden(bad)).toMatchObject({ ok: false, reason: "sun.percents: expected a list" });
  });

  it("sends exactly {kind, percent}, only a percent the garden takes", () => {
    const v = view();
    expect(sunBody(v, 75)).toEqual({ ok: true, body: { kind: "sun", percent: 75 } });
    expect(sunBody(v, 125)).toEqual({ ok: false, words: "Choose how bright: 50%, 75%." });
    expect(sunBody(v, null)).toMatchObject({ ok: false });
    expect(sunBody(view((w) => { w.sun.percents = []; }), 50)).toEqual({ ok: false, words: "This garden takes no sun letters." });
    expect(sunBody(view((w) => { delete w.sun; }), 50)).toEqual({ ok: false, words: "This garden takes no sun letters." });
  });

  it("says where a sun lands and the day it shines", () => {
    expect(sunLandingWords(view())).toBe("Your sun would land at step 655,360, the end of day 4, and shine on day 5, all 131,072 steps of it; then the world’s own light returns.");
    expect(sunLandingWords(view((w) => { w.sun.nextLanding = null; }))).toMatch(/^No day before the last has room for a sun/);
    // A garden that takes no letters at all says its own reason, not the sun's.
    expect(sunLandingWords(view((w) => { w.sun.nextLanding = null; w.letters.nextLanding = null; w.state = "stopped"; }))).toBe("The garden takes no letters now: it has stopped until the keeper looks.");
    const v = view((w) => w.letters.waiting.push(sunLetter(w)));
    expect(letterBodyWords(v.letters.waiting.at(-1)!)).toBe("A sun of 75% (three quarters of the light), landing at step 655,360 (end of day 4); it shines on day 5, 131,072 steps. ");
    expect(letterBodyWords(v.letters.waiting[0])).toBe("A stone of radius 8 at (301, 77), landing at step 524,288 (end of day 3). ");
    const answer = postAnswer(201, { letter: { id: "ltr-8", landsAtStep: 655360, day: 4 } }, null, v, "sun");
    expect(answer.words).toBe("Posted as ltr-8. It is public now, lands at step 655,360 (end of day 4), shines on day 5, and counts once a second island replays that day.");
    expect(postAnswer(422, { error: "this garden's light takes a sun of 50 or 75 percent" }, null, v, "sun").words).toBe("The garden refused the sun: this garden's light takes a sun of 50 or 75 percent.");
    // A sun whose fate is unknown is named as a sun, not a stone.
    expect(postAnswer(0, null, null, v, "sun").words).toMatch(/^No answer came back, so this page cannot tell whether your sun arrived\./);
    expect(postAnswer(502, null, null, v, "sun").words).toMatch(/^The garden answered 502, so this page cannot tell whether your sun arrived\./);
    expect(postAnswer(0, null, null, v).words).toMatch(/whether your stone arrived/);
  });

  it("the page has the sun form beside the stone's", () => {
    for (const id of ["g-sun", "sun-form", "sun-choices", "sun-preview", "sun-send", "sun-why", "sun-answer"]) expect(gardenHtml).toContain(`id="${id}"`);
  });
});
