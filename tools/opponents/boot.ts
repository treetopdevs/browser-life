// Registers the @bl/* resolver for plain Node 24 (a parent's hook does not reach worker threads, so each worker calls this first).
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
let hooked = false;
export function registerAliases(): void {
  if (hooked || process.env.VITEST) return;
  hooked = true;
  try {
    registerHooks({
      resolve(specifier, context, next) {
        const m = /^@bl\/(.+)$/.exec(specifier);
        return m ? next(pathToFileURL(`${REPO}packages/${m[1]}/src/index.ts`).href, context) : next(specifier, context);
      },
    });
  } catch { /* already resolved by a loader (vitest) */ }
}
