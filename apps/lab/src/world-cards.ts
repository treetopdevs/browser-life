// Whether the drawn world cards (public/og/worlds/manifest.json, from `pnpm gen:cards`) still say what the world
// catalogue says. The build refuses to write world pages from stale cards (vite.config.ts) and the unit test fails
// on them (test/social-meta.test.ts): a card is a picture of its words, so a renamed world or a reworded question
// means drawing it again.
import { PRESETS } from "@bl/schema";
import type { WorldCard } from "./social-meta.ts";
import { familyOf, noteOf, worldTraits } from "./worlds.ts";

/** Every way the cards differ from the catalogue, one line each; empty when they agree. */
export function cardDrift(cards: Record<string, WorldCard>): string[] {
  const out: string[] = [];
  const ids = PRESETS.map((p) => p.id);
  for (const id of Object.keys(cards)) if (!ids.includes(id)) out.push(`${id}: a card for a world that no longer exists`);
  for (const p of PRESETS) {
    const card = cards[p.id];
    if (!card) { out.push(`${p.id}: no card`); continue; }
    const want = { id: p.id, name: p.name, family: familyOf(p.id)?.name, asks: noteOf(p.id)?.asks, image: `/og/worlds/${p.id}.jpg` };
    for (const [key, value] of Object.entries(want)) {
      if (card[key as keyof WorldCard] !== value) out.push(`${p.id}: the card's ${key} is ${JSON.stringify(card[key as keyof WorldCard])}, the catalogue's ${JSON.stringify(value)}`);
    }
    const labels = worldTraits(p).map((t) => t.label);
    if (card.traits.some((t, i) => labels[i] !== t)) out.push(`${p.id}: the card's traits ${JSON.stringify(card.traits)} are not the first of ${JSON.stringify(labels)}`);
  }
  return out;
}
