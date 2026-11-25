/** Steps a Soft Roam world off the main thread for /softroam/: one request, one answer. */

import { SoftRoamSession, type SoftRoamFromWorker, type SoftRoamToWorker } from './view.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: SoftRoamSession | null = null;
let gen = -1;

scope.onmessage = (event: MessageEvent<SoftRoamToWorker>) => {
  const m = event.data;
  if (m.type === 'recycle') {
    // Pixels the page has drawn and sent back: the next frame is painted into them.
    if (session && m.gen === gen) session.recycle(new Uint8ClampedArray(m.buffer));
    return;
  }
  try {
    let alpha = 1;
    if (m.type === 'reset') {
      gen = m.gen;
      session = new SoftRoamSession(m.opts, m.scale);
    } else if (!session || m.gen !== gen) {
      return;
    } else if (m.type === 'advance') {
      session.advance(m.steps, m.budgetMs ?? 100);
      alpha = m.alpha;
    } else {
      alpha = m.alpha;
    }
    const frame = session.frame(m.paint, alpha);
    const answer: SoftRoamFromWorker = { type: 'frame', gen, frame };
    scope.postMessage(answer, [frame.pixels.buffer]);
  } catch (error) {
    session = null;
    const answer: SoftRoamFromWorker = { type: 'error', gen: m.gen, message: error instanceof Error ? error.message : String(error) };
    scope.postMessage(answer);
  }
};
