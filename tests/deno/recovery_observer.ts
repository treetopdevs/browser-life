// Engineering-only readback invariance, including a non-multiple-of-50 horizon.
import { stateHash } from "@bl/schema";
import { requestDevice } from "@bl/sim-gpu";
import { DEFAULT_EVAL, evaluateBatch, type EvalObserver } from "@bl/search";
import { subjects } from "../../experiments/recovery-accessibility/protocol.ts";
const device = await requestDevice(navigator.gpu);
try {
  for (const recoverSteps of [100, 125]) {
    const config = { ...DEFAULT_EVAL, side: 1, reps: 1, seed: 2_026_102_201, growSteps: 200, recoverSteps, darkSteps: 100, perRep: true };
    const plain = await evaluateBatch(device, [subjects().parent], config);
    const states25: Record<string, string> = {}, states50: Record<string, string> = {};
    const observe = (out: Record<string, string>): EvalObserver => async e => { if (e.kind === "state") out[e.phase] = stateHash(e.state); };
    const at25 = await evaluateBatch(device, [subjects().parent], config, observe(states25));
    const at50 = await evaluateBatch(device, [subjects().parent], config, observe(states50), 50);
    if (JSON.stringify(plain) !== JSON.stringify(at25) || JSON.stringify(plain) !== JSON.stringify(at50) || JSON.stringify(states25) !== JSON.stringify(states50)) throw new Error(`readback invariance failed at ${recoverSteps}`);
    console.log(`PASS baseline/25/50 readbacks, horizon ${recoverSteps}, all seven state hashes`);
  }
} finally { device.destroy(); }
