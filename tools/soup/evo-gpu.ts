// The GPU path of runAssay (tools/soup/evo.ts): the same race, stepped by
// GpuSoup with checked steps, which is byte-identical to the CPU soup. Measurements and the
// invalid-run rule run on the CPU copy after each read, at the same epochs as
// runAssay, so a result never depends on which path ran it
// (tests/deno/soup_gpu.ts checks).
import { DEFAULT_MUTATION } from "./bff.ts";
import { GpuSoup } from "./gpu.ts";
import { type AssayJob, type AssayPoint, type AssayResult, assayIntruder, classify, seedAssay, TypeRef, unhex } from "./evo.ts";

export async function runAssayGpu(job: AssayJob, device: GPUDevice): Promise<AssayResult> {
  const seeded = seedAssay(job);
  const gpu = await GpuSoup.create(device, { num: seeded.num, seed: job.seed, mutation: DEFAULT_MUTATION, grid: job.grid });
  try {
    gpu.cpu.programs.set(seeded.programs);
    gpu.upload();
    const soup = gpu.cpu;
    const epochs = job.epochs ?? 512, every = job.every ?? 64;
    const rareRef = new TypeRef(job.rareForms.map(unhex));
    const commonRef = new TypeRef(job.commonForms.map(unhex));
    const points: AssayPoint[] = [];
    const measure = () => {
      const c = classify(soup.programs, job, rareRef, commonRef);
      points.push({ epoch: soup.epoch, ...c, f: c.rare + c.common ? c.rare / (c.rare + c.common) : NaN });
    };
    const intruderNow = (pt: AssayPoint) => assayIntruder(soup.programs, soup.epoch, pt, rareRef, commonRef);
    const extra = new Set((job.validAt ?? []).filter((e) => e < epochs));
    const validAt: Record<number, boolean> = {};
    measure();
    while (soup.epoch < epochs) {
      // Next epoch at which runAssay looks at the soup.
      let t = soup.epoch + 1;
      while (t < epochs && t % every !== 0 && !extra.has(t)) t++;
      await gpu.advance(t - soup.epoch); // checked: a batch with dropped work is redone
      if (soup.epoch % every === 0 || soup.epoch === epochs) measure();
      if (extra.has(soup.epoch)) {
        if (points.at(-1)!.epoch !== soup.epoch) measure();
        validAt[soup.epoch] = intruderNow(points.at(-1)!) === null;
      }
    }
    const final = points[points.length - 1];
    const intruder = intruderNow(final);
    const { rareForms: _r, commonForms: _c, ...meta } = job;
    return { id: job.id, job: meta, points, final, valid: intruder === null, intruder, ...(extra.size ? { validAt } : {}) };
  } finally {
    gpu.destroy();
  }
}
