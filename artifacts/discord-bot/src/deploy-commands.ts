import { REST, Routes } from "discord.js";

import * as balance from "./commands/balance";
import * as daily from "./commands/daily";
import * as demo from "./commands/demo";
import * as coinflip from "./commands/coinflip";
import * as slots from "./commands/slots";
import * as blackjack from "./commands/blackjack";
import * as roulette from "./commands/roulette";
import * as leaderboard from "./commands/leaderboard";
import * as deposit from "./commands/deposit";
import * as withdraw from "./commands/withdraw";
import * as give from "./commands/give";
import * as stats from "./commands/stats";
import * as verify from "./commands/verify";
import * as setseed from "./commands/setseed";
import * as promo from "./commands/promo";
import * as affiliate from "./commands/affiliate";
import * as statusbonus from "./commands/statusbonus";
import * as banreacters from "./commands/banreacters";
import * as crash from "./commands/crash";
import * as mines from "./commands/mines";
import * as autoban from "./commands/autoban";
import * as ping from "./commands/ping";
import * as admin from "./commands/admin";

const commands = [
  balance, daily, demo, coinflip, slots, blackjack, roulette, leaderboard,
  deposit, withdraw, give, stats, verify, setseed, promo, affiliate, statusbonus, banreacters, crash, mines, autoban, ping, admin,
].map(c => c.data.toJSON());

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("Missing DISCORD_TOKEN env var");
  process.exit(1);
}

const rest = new REST().setToken(token);

async function getClientId(): Promise<string | null> {
  try {
    const me = await rest.get("/users/@me") as any;
    return me?.id ?? null;
  } catch (err: any) {
    console.error("Failed to fetch bot identity:", err?.message ?? err);
    return null;
  }
}

(async () => {
  const clientId = process.env.DISCORD_CLIENT_ID || await getClientId();
  if (!clientId) {
    console.error("Missing DISCORD_CLIENT_ID and couldn't auto-fetch it. Set DISCORD_CLIENT_ID env var to your bot's Application ID.");
    process.exit(1);
  }

  console.log(`Registering ${commands.length} slash commands globally for client ${clientId}...`);
  try {
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commands }) as unknown[];
    console.log(`Successfully registered ${data.length} commands.`);
  } catch (err: any) {
    console.error("Failed to register commands:", err?.message ?? err);
    process.exit(1);
  }
})();
