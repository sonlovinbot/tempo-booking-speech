// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { readFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Local dev only: load `.dev.vars` into process.env so server functions can read the
// secrets (GROQ_API_KEY, DEEPSEEK_API_KEY, GOOGLE_*, SESSION_SECRET). Plain `vite dev`
// does NOT read Cloudflare's `.dev.vars`, and the preset only injects VITE_* into the
// client. In production Lovable injects real env and `.dev.vars` doesn't exist (ignored).
try {
  const raw = readFileSync(new URL(".dev.vars", import.meta.url), "utf8");
  const loaded: string[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val && process.env[m[1]] === undefined) {
      process.env[m[1]] = val;
      loaded.push(m[1]);
    }
  }
  if (loaded.length) console.log(`[.dev.vars] loaded env: ${loaded.join(", ")}`);
} catch {
  // no .dev.vars (production/Lovable injects real env) — ignore
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
