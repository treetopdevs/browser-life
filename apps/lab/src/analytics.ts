import { init, track as plausibleTrack } from "@plausible-analytics/tracker";

// Plausible Community Edition on the project's own server, bundled from npm so no script loads from another host.
// Pageviews are counted on every page that loads theme.ts, which is every page. Events are the few lab actions the
// privacy page names; props carry a world's catalogue id, never a file name, a seed or anything typed.

/** Query keys Plausible reads for where a visit came from. Everything else in a link (a world, a seed) stays on the device. */
const SOURCE_KEYS = new Set(["ref", "source", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);

/** The page without its fragment and without any query beyond the source keys. Anything unparseable is dropped, not sent. */
function cleanUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (!SOURCE_KEYS.has(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

let counting = false;
try {
  init({
    domain: "cadence.garden",
    endpoint: "https://plausible.zographos.net/api/event",
    logging: false,
    transformRequest: (payload) => {
      const u = cleanUrl(payload.u);
      if (!u) return null;
      const r = payload.r ? cleanUrl(payload.r) : null;
      return { ...payload, u, r };
    },
  });
  counting = true;
} catch {
  // Counting is best effort: a tracker that cannot start must not stop the page or the lab.
}

export type LabEvent = "World planted" | "World played" | "World paused" | "World saved" | "World restored" | "World downloaded" | "World opened";

/** Counts one lab action. Never throws: a blocked or unreachable counter must not touch the lab. */
export function track(event: LabEvent, world?: string): void {
  if (!counting) return;
  try {
    plausibleTrack(event, world ? { props: { world } } : {});
  } catch {
    // Counting is best effort.
  }
}
