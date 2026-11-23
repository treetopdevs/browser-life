/**
 * Steps the droplet-genes kernel off the main thread for the /dropgenes/ page. One request, one answer: the page
 * sends a reset or a tick and waits for the frame (or the error) that carries the same generation number, so
 * there is never more than one tick in flight and a frame of an abandoned world is recognised and dropped.
 */

import { TICK_BUDGET_MS, ViewerSession, type FromWorker, type ToWorker } from './viewer-core.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let session: ViewerSession | null = null;
let gen = -1;

function answer(message: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function sendFrame(): void {
  if (!session) return;
  // The picture is a fresh array made for this frame, never one of the kernel's own, so handing it over is safe.
  const frame = session.frame();
  answer({ type: 'frame', gen, frame }, [frame.rgba.buffer]);
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  try {
    if (m.type === 'reset') {
      gen = m.gen;
      session = null;
      session = new ViewerSession(m.opts);
      sendFrame();
    } else if (m.type === 'tick') {
      // A tick for a world that has since been replaced, or that failed, has nothing to step and nobody waiting.
      if (!session || m.gen !== gen) return;
      session.advance(m.steps, TICK_BUDGET_MS);
      sendFrame();
    }
  } catch (error) {
    session = null;
    answer({ type: 'error', gen: m.gen, message: error instanceof Error ? error.message : String(error) });
  }
};
