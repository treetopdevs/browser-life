// Throwaway: serves the 3D benchmark page with the repo's @bl aliases. Does not touch apps/lab/vite.config.ts.
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const pkg = (n: string) => path.join(root, "packages", n, "src/index.ts");
export default defineConfig({
  root: path.dirname(fileURLToPath(import.meta.url)),
  resolve: { alias: { "@bl/schema": pkg("schema"), "@bl/sim-gpu": pkg("sim-gpu"), "@bl/sim-ref": pkg("sim-ref") } },
  server: { fs: { allow: [root] } },
});
