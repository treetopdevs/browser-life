/** Generate a diagnostic copy of the exact pinned reference stepper.
 * Only passive snapshot/flux captures are inserted. The normal stepper is
 * never edited, and the feasibility runner checks full state/event parity.
 */
const sourceUrl = new URL("../packages/sim-ref/src/step.ts", import.meta.url);
const outputUrl = new URL("../runs/foundational-reset/material-bounds-feasibility-v1/ref-step.instrumented.ts", import.meta.url);
const source = await Deno.readTextFile(sourceUrl);
const bytes = new TextEncoder().encode(source);
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
  .map(x => x.toString(16).padStart(2, "0")).join("");
if (hash !== "1a7e4acd0a286dd1644e98a0c0293bdd731b46d8fb3b9c3c7222954ebb751f85")
  throw new Error(`reference source changed: ${hash}`);
let instrumented = source;
function inject(anchor: string, replacement: string) {
  if (instrumented.split(anchor).length !== 2) throw new Error(`nonunique injection anchor: ${anchor}`);
  instrumented = instrumented.replace(anchor, replacement);
}
inject("  readonly roles: Uint32Array;", `  readonly roles: Uint32Array;
  readonly diagnosticLocalFlux: Uint32Array;
  diagnosticDisplacement: Uint32Array;
  diagnosticTransportedCells: Uint32Array;
  diagnosticTransportedGenome: Uint32Array;`);
inject("    this.roles = new Uint32Array(this.n * ROLE_WORDS);", `    this.roles = new Uint32Array(this.n * ROLE_WORDS);
    this.diagnosticLocalFlux = new Uint32Array(this.n * FLUX_COUNT);
    this.diagnosticDisplacement = new Uint32Array(this.n);
    this.diagnosticTransportedCells = new Uint32Array(this.n * CELL_CHANNELS);
    this.diagnosticTransportedGenome = new Uint32Array(this.n * GENOME_CHANNELS);`);
inject("    this.transport();\n    const r = this.react();", `    this.transport();
    this.diagnosticDisplacement.set(this.disp);
    this.diagnosticTransportedCells.set(this.state.cells);
    this.diagnosticTransportedGenome.set(this.state.genome);
    const r = this.react();`);
inject("        for (let k = 0; k < FLUX_COUNT; k++) fluxTotal[k] += F[k];", `        for (let k = 0; k < FLUX_COUNT; k++) {
          fluxTotal[k] += F[k];
          this.diagnosticLocalFlux[i * FLUX_COUNT + k] = F[k];
        }`);
await Deno.mkdir(new URL(".", outputUrl), { recursive: true });
await Deno.writeTextFile(outputUrl, instrumented);
console.log(JSON.stringify({ sourceSha256: hash, injectionCount: 4, output: outputUrl.pathname }));
