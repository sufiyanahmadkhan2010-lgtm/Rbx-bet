import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm } from "node:fs/promises";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    outdir: distDir,
    logLevel: "info",
    sourcemap: "linked",
    // Resolve packages from the pnpm workspace root (monorepo setup)
    nodePaths: [path.resolve(workspaceRoot, "node_modules")],
    // Packages with native bindings — must stay as runtime requires
    external: [
      "*.node",
      "bufferutil",
      "utf-8-validate",
      "zlib-sync",
      "pg-native",
    ],
  });

  console.log("✅ Discord bot built to dist/index.js");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
