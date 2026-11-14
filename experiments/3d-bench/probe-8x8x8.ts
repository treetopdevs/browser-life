// Probe: why does R=4 8x8x8 b1 (4096-word tile = the 16 KiB workgroup-storage limit) return wrong results? Looks for GPU errors.
import { defaultConfig } from "@bl/schema";
import { affinity3dRef, buildKernel3, makeFill } from "./kernel3d.ts";
import { dispatchOnce, getDevice, makeAff3, readU } from "./harness.ts";
const { device, env } = await getDevice(navigator.gpu);
const cfg = defaultConfig();
for (const [R, split] of [[4, 2048], [4, 1024], [4, 512], [3, 2048]] as const) {
  device.pushErrorScope("validation"); device.pushErrorScope("internal"); device.pushErrorScope("out-of-memory");
  const fill = makeFill(32 ** 3, 5);
  const v = await makeAff3(device, `R=${R} 8x8x8 split ${split}`, { sx: 32, sy: 32, sz: 32, radius: R, wg: [8, 8, 8], block: 1, split, massUnit: cfg.massUnit, defMu: cfg.defaultMu, defSigma: cfg.defaultSigma }, fill, env);
  await dispatchOnce(device, v);
  const got = await readU(device, v);
  const want = affinity3dRef(32, 32, 32, buildKernel3(R), fill, cfg.massUnit, cfg.defaultMu, cfg.defaultSigma);
  let bad = 0; for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) bad++;
  const errs = [await device.popErrorScope(), await device.popErrorScope(), await device.popErrorScope()].filter(Boolean).map((e) => e!.message.slice(0, 200));
  console.log(v.name, v.note, "bad", bad, "errors", errs, "got[0..3]", [...got.slice(0, 3)], "want", [...want.slice(0, 3)]);
}
Deno.exit(0);
