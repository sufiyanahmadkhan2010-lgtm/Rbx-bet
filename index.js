/**
 * Alternative startup file — same as main.js.
 * Render can start the bot with either `node index.js` or `node main.js`.
 */

// Validate required environment variables before booting
const required = ["DISCORD_TOKEN"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error("[FATAL] Missing required environment variables:");
  for (const key of missing) {
    console.error(`  - ${key}`);
  }
  console.error("Set them in Render Dashboard → Environment Variables.");
  process.exit(1);
}

// Optional: warn about DATABASE_URL but don't crash (bot works without DB for basic features)
if (!process.env.DATABASE_URL) {
  console.warn("[WARN] DATABASE_URL is not set. Economy / balance commands may fail.");
}

console.log("[BOOT] Starting Discord bot...");

// Run the bundled bot
try {
  require("./artifacts/discord-bot/dist/index.js");
} catch (err) {
  console.error("[FATAL] Failed to start bot:", err.message);
  process.exit(1);
}
