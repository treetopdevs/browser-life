/** Run-file and freeze helpers shared by the confirm runners and the analyzer (Deno). */

import { DROPLET_CENSUS, REEF_CENSUS } from './rule.ts';

const ROOT = new URL('../../', import.meta.url);

export async function sha256File(rel: string): Promise<string> {
  const bytes = await Deno.readFile(new URL(rel, ROOT));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Refuses to run if any frozen kernel file differs from FROZEN.json. */
export async function assertFrozen(world: 'droplets' | 'reef'): Promise<Record<string, string>> {
  const manifest = JSON.parse(await Deno.readTextFile(new URL('experiments/confirm/FROZEN.json', ROOT)));
  const files: Record<string, string> = manifest[world];
  for (const [rel, want] of Object.entries(files)) {
    const got = await sha256File(rel);
    if (got !== want) throw new Error(`frozen file changed: ${rel}\n  want ${want}\n  got  ${got}`);
  }
  return files;
}

export function parseSeeds(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let s = a; s <= (b ?? a); s++) out.push(s);
  }
  if (out.length === 0 || out.some((s) => !Number.isInteger(s))) throw new Error(`bad seeds: ${spec}`);
  return out;
}

export function argOf(name: string, fallback?: string): string {
  const i = Deno.args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < Deno.args.length) return Deno.args[i + 1];
  if (fallback === undefined) throw new Error(`missing --${name}`);
  return fallback;
}

export function runPath(out: string, arm: string, seed: number): string {
  return `${out}/${arm}/seed-${seed}.jsonl`;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes rows to a temporary file and renames it, so a finished path is always a whole run. */
export async function writeRun(path: string, meta: unknown, rows: readonly unknown[]): Promise<void> {
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  const tmp = `${path}.tmp-${Deno.pid}`;
  const body = [JSON.stringify(meta), ...rows.map((r) => JSON.stringify(r))].join('\n') + '\n';
  await Deno.writeTextFile(tmp, body);
  await Deno.rename(tmp, path);
}

export function dropletMeta(arm: string, seed: number, steps: number, frozen: Record<string, string>) {
  return { world: 'droplets', arm, seed, steps, census: DROPLET_CENSUS, size: 128, frozen };
}

export function reefMeta(arm: string, seed: number, steps: number, frozen: Record<string, string>) {
  return { world: 'reef', arm, seed, steps, census: REEF_CENSUS, gw: 40, gh: 20, founders: 24, frozen };
}

/** A finished file counts only if its header names this exact world, arm, seed, length and frozen code. */
export async function assertRunMeta(path: string, want: unknown): Promise<void> {
  const text = await Deno.readTextFile(path);
  const got = text.slice(0, text.indexOf('\n'));
  if (got !== JSON.stringify(want)) throw new Error(`run header mismatch: ${path}\n  want ${JSON.stringify(want)}\n  got  ${got}`);
}

export async function readRows<T>(path: string, want: unknown): Promise<T[]> {
  await assertRunMeta(path, want);
  const lines = (await Deno.readTextFile(path)).trim().split('\n');
  return lines.slice(1).map((l) => JSON.parse(l) as T);
}
