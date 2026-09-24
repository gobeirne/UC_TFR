import { defineConfig, type Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

declare const process: { env: Record<string, string | undefined> };
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

/** Writes dist/sw.js with an explicit precache list of every built asset. */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "tfr-service-worker",
    apply: "build",
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split(sep).join("/"));
        }
      };
      walk(outDir);
      const skip = (f: string) => f === "sw.js" || f.endsWith(".map") || /nosimd|module_internal/.test(f) || f.endsWith(".gitkeep") || f.endsWith("README.md") || f === "_headers";
      const precache = ["./", ...files.filter((f) => !skip(f)).map((f) => `./${f}`)];
      const hash = createHash("sha256");
      for (const f of files.filter((f) => !skip(f)).sort()) hash.update(f + statSync(join(outDir, f)).size);
      const version = `${pkg.version}-${hash.digest("hex").slice(0, 10)}`;
      const tpl = readFileSync("src/sw-template.js", "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache, null, 2));
      writeFileSync(join(outDir, "sw.js"), tpl);
      if (!existsSync(join(outDir, "models", "face_landmarker.task"))) {
        console.warn("\n⚠  public/models/face_landmarker.task is missing — run `npm run setup`. The app will fall back to downloading the model from Google and won't work offline.\n");
      }
      console.log(`service worker: ${precache.length} files precached, version ${version}`);
    },
  };
}

export default defineConfig({
  base: "./", // works at a domain root or a sub-path (e.g. GitHub Pages /repo/)
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`) },
  build: { target: "es2020", chunkSizeWarningLimit: 2000 },
  server: { host: true },
  // HTTPS=1 npm run dev → self-signed HTTPS so phones on the LAN can use the camera.
  plugins: [serviceWorker(), ...(process.env.HTTPS ? [basicSsl()] : [])],
});
