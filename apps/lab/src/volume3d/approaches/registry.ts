// The renderers the volume view offers, in menu order. Each loads only when chosen.
import type { Approach, ApproachModule } from "../contract.ts";

export interface ApproachEntry {
  /** The stock renderers below, or a page's own (passed to VolumeView with the menu it offers). */
  id: "raymarch" | "slices" | "points" | (string & {});
  title: string;
  /** Plain words for the option text: what this look shows and why you would pick it. */
  text: string;
  load(): Promise<Approach>;
}

const from = (m: () => Promise<ApproachModule>) => async () => (await m()).create();

export const RENDERERS: readonly ApproachEntry[] = [
  { id: "raymarch", title: "Ray march (default)", text: "A glowing see-through layer of life: light falls from the top and the canopy shades what grows under it. Best for reading depth.", load: from(() => import("./raymarch/index.ts")) },
  { id: "slices", title: "Slices", text: "Three flat cuts drawn exactly as packed, one of them on the top layer left by the peel. Plain on purpose: the check that the cells are in the right layers.", load: from(() => import("./slices/index.ts")) },
  { id: "points", title: "Points", text: "One lit bead per living cell. Single cells stay crisp, but it shows no haze or see-through depth.", load: from(() => import("./points/index.ts")) },
];
