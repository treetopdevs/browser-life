/** Steps a roam world off the main thread for /roam/: one request, one answer. */

import { type RoamFromWorker, RoamSession, type RoamToWorker } from './view.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: RoamSession | null = null;
let gen = -1;

scope.onmessage = (event: MessageEvent<RoamToWorker>) => {
  const m = event.data;
  try {
    if (m.type === 'reset') {
      gen = m.gen;
      session = new RoamSession(m.opts, m.scale);
    } else if (!session || m.gen !== gen) {
      return;
    } else {
      session.advance(m.steps, 100);
    }
    const frame = session.frame(m.paint);
    const answer: RoamFromWorker = { type: 'frame', gen, frame };
    scope.postMessage(answer, [frame.pixels.buffer]);
  } catch (error) {
    session = null;
    const answer: RoamFromWorker = { type: 'error', gen: m.gen, message: error instanceof Error ? error.message : String(error) };
    scope.postMessage(answer);
  }
};
