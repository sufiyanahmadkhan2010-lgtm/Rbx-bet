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

const commands = [
  balance, daily, demo, coinflip, slots, blackjack, roulette, leaderboard,
  deposit, withdraw, give, stats, verify, setseed, promo, affiliate, statusbonus, banreacters, crash, mines, autoban,
].map(c => c.data.toJSON());

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID");
  process.exit(1);
}

const rest = new REST().setToken(token);

(async () => {
  console.log(`Registering ${commands.length} slash commands globally...`);
  const data = await rest.put(Routes.applicationCommands(clientId), { body: commands }) as unknown[];
  console.log(`✅ Successfully registered ${data.length} commands.`);
})();
