import { expect, test } from "@playwright/test";

// Real OPFS sync handles and Web Locks in independent workers, without requiring a GPU.
test("same-run storage rejects a stale tab before replacing either recoverable history", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright WebKit has no OPFS");
  await page.goto("/selftest.html");
  const result = await page.evaluate(async () => {
    const source = `
      import { readManifest, writeManifest, writeFile, readFile, recordCheckpoint } from ${JSON.stringify(new URL("/src/opfs.ts", location.href).href)};
      let manifest;
      onmessage = async ({ data: { id, command, runId, tab } }) => {
        try {
          if (command === 'create') {
            manifest = {runId, checkpoints: [], interventions: []};
            await writeManifest(manifest);
          }
          if (command === 'resume') manifest = await readManifest(runId);
          if (command === 'save') {
            const file = manifest.runId + '-' + crypto.randomUUID() + '.blck';
            await writeFile(file, new Uint8Array([tab]));
            await writeFile(file + '.edges', new Uint8Array([tab, tab]));
            manifest.interventions.push({kind: 'feed', step: 1, x: tab, y: 0, r: 1, amount: tab, matter: tab});
            manifest.checkpoints.push({file, step: 2, hash: String(tab), interventions: 1});
            await writeManifest(manifest);
            await recordCheckpoint({file, runId: manifest.runId, step: 2, bytes: 1, savedAt: 'now'});
          }
          const saved = await readManifest(runId);
          const bytes = saved.checkpoints.length ? [...await readFile(saved.checkpoints[0].file)] : [];
          postMessage({ id, saved, local: manifest, bytes });
        } catch (e) { postMessage({ id, error: e.message, local: manifest }); }
      };`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const workers = [new Worker(url, { type: "module" }), new Worker(url, { type: "module" })];
    let id = 0;
    const call = (worker: Worker, command: string, runId: string, tab = 0): Promise<any> => new Promise((resolve, reject) => {
      const request = ++id;
      const timer = setTimeout(() => reject(new Error("storage worker timed out")), 15_000);
      const receive = (event: MessageEvent) => {
        if (event.data.id !== request) return;
        clearTimeout(timer);
        worker.removeEventListener("message", receive);
        resolve(event.data);
      };
      worker.addEventListener("message", receive);
      worker.postMessage({ id: request, command, runId, tab });
    });
    try {
      const runId = `concurrency-${crypto.randomUUID()}`;
      const created = await call(workers[0], "create", runId);
      if (created.error) throw new Error(created.error);
      await Promise.all(workers.map((worker) => call(worker, "resume", runId)));
      const outcomes = await Promise.all(workers.map((worker, i) => call(worker, "save", runId, i + 1)));
      const winner = outcomes.find((o) => !o.error);
      const loser = outcomes.find((o) => o.error);
      const final = await call(workers[0], "inspect", runId);
      return { outcomes, winner, loser, final };
    } finally {
      workers.forEach((worker) => worker.terminate());
      URL.revokeObjectURL(url);
    }
  });
  expect(result.outcomes.filter((o: any) => !o.error)).toHaveLength(1);
  expect(result.loser.error).toContain("Another tab changed");
  expect(result.final.saved).toEqual(result.winner.saved);
  expect(result.final.saved.checkpoints).toHaveLength(1);
  expect(result.final.saved.interventions).toHaveLength(1);
  expect(result.final.bytes).toEqual([result.winner.saved.interventions[0].x]);
  expect(result.loser.local.interventions[0].x).not.toBe(result.final.bytes[0]);
});
