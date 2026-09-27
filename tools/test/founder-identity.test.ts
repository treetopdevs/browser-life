import { describe, expect, it } from "vitest";
import { G, M3_FOUNDERS, defaultConfig, m3World } from "@bl/schema";
import { census } from "@bl/metrics";
import { founderAbundance, founderClusterMap, founderLineageKey } from "../lib/founder-identity.ts";

describe("founderLineageKey / founderClusterMap (matches m3World's real assignment)", () => {
  it("predicts the exact lineage key m3World actually assigns each founder", () => {
    const cfg = defaultConfig({ tileW: 64, tileH: 64, kernelRadius: 5, seed: 3 });
    const founderCount = 4;
    const world = m3World(cfg, founderCount, 32, 64);
    const n = cfg.tileW * cfg.tileH;
    // Read the lineage key straight off the initial genome buffer, the same
    // way census.ts's own lin() does, for one cell known to belong to each
    // founder (founder i's own placement centre, ((h % W, (h>>>12) % H)) --
    // reproduced from world.ts's own hash so this test doesn't need to
    // flood-fill to find a representative cell).
    for (let i = 0; i < founderCount; i++) {
      const key = founderLineageKey(cfg, i);
      const [hiStr, loStr] = key.split(":");
      // Confirm at least one living cell in the world actually carries this
      // exact key (i.e. the predicted key is not just internally consistent
      // but genuinely present in the world m3World built).
      let found = false;
      for (let c = 0; c < n && !found; c++) {
        if (world.genome[G.LIN_HI * n + c] === Number(hiStr) && world.genome[G.LIN_LO * n + c] === Number(loStr)) found = true;
      }
      expect(found).toBe(true);
    }
  });

  it("maps every founder's key to its m3World genome's actual cluster (via mu/sigma, which are cluster-specific)", () => {
    const cfg = defaultConfig({ tileW: 64, tileH: 64, kernelRadius: 5, seed: 7 });
    const founderCount = 6;
    const world = m3World(cfg, founderCount, 32, 64);
    const n = cfg.tileW * cfg.tileH;
    const clusterMap = founderClusterMap(cfg, founderCount);
    expect(clusterMap.size).toBe(founderCount);
    const c = census({ cfg, step: 0, cells: world.cells, genomeHead: world.genome });
    for (const lin of c.lineages) {
      expect(clusterMap.has(lin.key)).toBe(true);
    }
    // Assert the actual assigned cluster *values*, not just presence in the
    // map: a constant-cluster (or any wrong-index) implementation would
    // still pass a presence-only check while silently merging distinct
    // founders' abundances together. Expected values are read straight
    // off M3_FOUNDERS's own array order/`cluster` field -- independent of
    // `founderClusterMap`'s internal `i % M3_FOUNDERS.length` computation --
    // and are all-distinct for `founderCount=6` (clusters 0,1,2,4,5,9), so a
    // constant-cluster (or any wrong-index) bug fails this immediately.
    const expectedClusters = M3_FOUNDERS.slice(0, founderCount).map((f) => f.cluster);
    expect(new Set(expectedClusters).size).toBe(founderCount); // guard: fixture only proves the point if all-distinct
    for (let i = 0; i < founderCount; i++) {
      expect(clusterMap.get(founderLineageKey(cfg, i))).toBe(expectedClusters[i]);
    }
  });

  it("an unmapped lineage key (only possible with mutRate > 0) is not silently dropped", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 1 });
    const clusterMap = founderClusterMap(cfg, 2); // founders 0,1 only
    const lineages = [
      { key: founderLineageKey(cfg, 0), cells: 10 },
      { key: founderLineageKey(cfg, 1), cells: 20 },
      { key: "999:12345", cells: 5 }, // a mutation-minted id, not a founder's
    ];
    const abundance = founderAbundance(clusterMap, lineages);
    expect(abundance.other).toBe(5);
    const totalByCluster = Object.values(abundance.byCluster).reduce((a, b) => a + b, 0);
    expect(totalByCluster + abundance.other).toBe(35);
  });

  it("metric picks which field to aggregate (biomass instead of living-cell count)", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 1 });
    const clusterMap = founderClusterMap(cfg, 2);
    const lineages = [
      { key: founderLineageKey(cfg, 0), cells: 10, mass: 100 },
      { key: founderLineageKey(cfg, 1), cells: 20, mass: 50 },
      { key: "999:12345", cells: 5, mass: 5 },
    ];
    const byMass = founderAbundance(clusterMap, lineages, (l) => l.mass!);
    expect(byMass.byCluster).toEqual({ [clusterMap.get(founderLineageKey(cfg, 0))!]: 100, [clusterMap.get(founderLineageKey(cfg, 1))!]: 50 });
    expect(byMass.other).toBe(5);
  });
});
