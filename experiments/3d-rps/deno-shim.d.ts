// For `tsc -p experiments/3d-rps/tsconfig.json` only: the Deno-only scripts of this directory (gate0.ts, rmf-sweep.ts, the spike's
// prototypes) use the `Deno` global, which Node's types do not declare. `deno check` (which does not read this file) covers them with
// the real types; here the global is `any`, so that everything else is checked by tsc as well.
declare const Deno: any;
