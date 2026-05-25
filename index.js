/**
 * Backup startup file — same as main.js.
 * Render can start the bot with either `node index.js` or `node main.js`.
 */

const http = require("http");

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

if (!process.env.DATABASE_URL) {
  console.warn("[WARN] DATABASE_URL is not set. Economy / balance commands may fail.");
}

console.log("[BOOT] Starting Discord bot...");

try {
  require("./artifacts/discord-bot/dist/index.js");
} catch (err) {
  console.error("[FATAL] Failed to start bot:", err.message);
  process.exit(1);
}

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", bot: "online" }));
    return;
  }
  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`[HTTP] Health server listening on port ${PORT}`);
});
