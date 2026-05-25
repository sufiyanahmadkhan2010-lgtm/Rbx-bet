// Entry point for external hosts (NexusHost, Render, etc.)
// bot.js is the pre-built, self-contained bundle — no build step needed.
const path = require("path");
const fs = require("fs");

const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
if (!token) {
  console.error("[FATAL] No bot token found. Set TOKEN or DISCORD_TOKEN in your host's environment variables.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.warn("[WARN] DATABASE_URL is not set — economy/balance commands will not work.");
}

const botBundle = path.join(__dirname, "bot.js");
if (!fs.existsSync(botBundle)) {
  console.error("[FATAL] bot.js not found. The pre-built bundle is missing from this deployment.");
  console.error("Make sure you are using the latest version of the project from the repository.");
  process.exit(1);
}

console.log("[Boot] Starting Discord bot...");
require(botBundle);
