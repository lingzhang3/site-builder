/**
 * Module resolution for running the app's source directly under Node.
 *
 * The source is written the way Next expects: `@/lib/...` aliases and
 * extensionless relative imports. Bare Node does neither, so rather than
 * contorting production code to suit the tooling, this hook teaches Node the
 * same two rules the bundler follows:
 *
 *   1. `@/x` resolves to `<repo>/src/x`
 *   2. a specifier with no extension tries `.ts`, `.tsx`, then `/index.ts(x)`
 *
 * Node 22 runs TypeScript directly (type stripping), so no build step is
 * needed on top of this. Used by `pnpm test` and `pnpm db:seed`, both of which
 * run source files without going through the Next bundler.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "src");
const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".mjs"];

/** Returns a file:// URL for `absolutePath`, trying each candidate suffix. */
function firstExisting(absolutePath) {
  if (existsSync(absolutePath) && !absolutePath.endsWith("/")) {
    return pathToFileURL(absolutePath).href;
  }
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${absolutePath}${suffix}`;
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // `@/lib/widgets/palette` -> <repo>/src/lib/widgets/palette.ts
    if (specifier.startsWith("@/")) {
      const url = firstExisting(resolvePath(SRC_ROOT, specifier.slice(2)));
      if (url) return { url, shortCircuit: true };
    }

    // `./palette` -> ./palette.ts, relative to the importing file.
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const url = firstExisting(resolvePath(parentDir, specifier));
      if (url) return { url, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
