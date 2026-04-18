import esbuild from "esbuild";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outdir = path.join(root, "dist");
mkdirSync(outdir, { recursive: true });

const common = {
  entryPoints: [path.join(root, "src/index.ts")],
  bundle: true,
  sourcemap: true,
  target: ["es2019"],
  loader: { ".css": "text" },
  external: ["abcjs"],
  logLevel: "info"
};

await esbuild.build({
  ...common,
  format: "esm",
  outfile: path.join(outdir, "index.esm.js")
});

await esbuild.build({
  ...common,
  format: "cjs",
  outfile: path.join(outdir, "index.cjs")
});

// IIFE bundle: bundle abcjs in so the file is self-contained (no require()).
await esbuild.build({
  ...common,
  external: [],
  format: "iife",
  outfile: path.join(outdir, "index.iife.js"),
  platform: "browser",
  globalName: "AbcGui"
});

const css = path.join(root, "src/styles/abc-gui.css");
if (existsSync(css)) {
  copyFileSync(css, path.join(outdir, "abc-gui.css"));
}

console.log("build ok");
