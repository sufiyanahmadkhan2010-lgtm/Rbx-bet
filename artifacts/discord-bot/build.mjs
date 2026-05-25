import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { rm } from "node:fs/promises";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  const sharedConfig = {
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    logLevel: "info",
    sourcemap: "linked",
    nodePaths: [path.resolve(workspaceRoot, "node_modules")],
    external: [
      "*.node",
      "bufferutil",
      "utf-8-validate",
      "zlib-sync",
      "pg-native",
    ],
  };

  // Primary output — used by the Replit workflow (pnpm start)
  await esbuild({ ...sharedConfig, outdir: distDir });

  // Root-level output — single file for external hosts (NexusHost, Render, etc.)
  // This file is git-tracked so it travels with the repo without needing a build step.
  await esbuild({
    ...sharedConfig,
    outfile: path.resolve(workspaceRoot, "bot.js"),
    sourcemap: false,
  });

  console.log("✅ Discord bot built to dist/index.js and bot.js");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
