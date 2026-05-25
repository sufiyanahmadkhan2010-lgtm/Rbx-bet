const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const required = ["DISCORD_TOKEN"];
const missing = required.filter((k) => !process.env[k] && !process.env["TOKEN"]);
if (missing.length > 0) {
  console.error("[FATAL] Missing environment variable: DISCORD_TOKEN (or TOKEN)");
  console.error("Set it in your host's environment/dashboard.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.warn("[WARN] DATABASE_URL is not set — economy commands may fail.");
}

const distEntry = path.join(__dirname, "artifacts/discord-bot/dist/index.js");
const buildScript = path.join(__dirname, "artifacts/discord-bot/build.mjs");

if (!fs.existsSync(distEntry)) {
  console.log("[Startup] dist/index.js not found — building now (this takes ~5 seconds)...");
  try {
    execSync(`node "${buildScript}"`, {
      stdio: "inherit",
      cwd: path.join(__dirname, "artifacts/discord-bot"),
    });
    console.log("[Startup] Build complete.");
  } catch (err) {
    console.error("[FATAL] Build failed:", err.message);
    process.exit(1);
  }
}

console.log("[Boot] Starting Discord bot...");

try {
  require(distEntry);
} catch (err) {
  console.error("[FATAL] Failed to start bot:", err.message);
  process.exit(1);
}
