import { Message, EmbedBuilder } from "discord.js";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { baseEmbed, winEmbed, loseEmbed, errorEmbed, formatRobux, BOT_COLOR } from "../utils/embed";
import { playCoinflip } from "../games/coinflip";
import { playSlots } from "../games/slots";
import { playRoulette, parseRouletteBet, colorEmoji } from "../games/roulette";
import { getFairContext, saveGameRecord } from "../utils/provably-fair";
import { isHoneypotActive, honeypotRoll, honeypotRolls } from "../utils/honeypot";
import { incrementCounts } from "../utils/gameUtils";

const PREFIX = ".";
const HOUSE_EDGE = 0.96;

function parseBet(str: string): number | null {
  const n = parseInt(str);
  return isNaN(n) || n < 1 ? null : n;
}

async function replyEmbed(msg: Message, embed: EmbedBuilder) {
  await msg.reply({ embeds: [embed] });
}

export async function handlePrefixMessage(message: Message) {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const raw = message.content.slice(PREFIX.length).trim();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  const user = await getOrCreateUser(message.author.id, message.author.username).catch(() => null);
  if (!user) return;

  if (cmd === "balance" || cmd === "bal") {
    await replyEmbed(message, baseEmbed(`💰 ${message.author.username}'s Balance`)
      .addFields(
        { name: "💰 Real Robux", value: formatRobux(user.balance), inline: true },
        { name: "🎮 Demo Robux", value: formatRobux(user.demoBalance), inline: true },
      ));

  } else if (cmd === "daily") {
    const DAILY_AMOUNT = 1000;
    const DAILY_MS = 24 * 60 * 60 * 1000;
    if (user.lastDaily && Date.now() - user.lastDaily.getTime() < DAILY_MS) {
      const rem = DAILY_MS - (Date.now() - user.lastDaily.getTime());
      const h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
      await replyEmbed(message, errorEmbed(`Already claimed! Come back in **${h}h ${m}m**.`));
      return;
    }
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db.update(usersTable).set({ lastDaily: new Date() }).where(eq(usersTable.id, user.id));
    const updated = await updateBalance(user.id, DAILY_AMOUNT, "daily", "Daily claim");
    await replyEmbed(message, winEmbed("📅 Daily Claimed!", `You got ${formatRobux(DAILY_AMOUNT)}!\nBalance: ${formatRobux(updated.balance)}`));

  } else if (cmd === "stats") {
    const net = user.totalWon - user.totalLost;
    await replyEmbed(message, baseEmbed(`📊 ${message.author.username}'s Stats`)
      .addFields(
        { name: "Balance", value: formatRobux(user.balance), inline: true },
        { name: "Won", value: formatRobux(user.totalWon), inline: true },
        { name: "Lost", value: formatRobux(user.totalLost), inline: true },
        { name: "Net", value: `${net >= 0 ? "+" : ""}${formatRobux(Math.abs(net))}`, inline: true },
        { name: "Affiliate", value: user.affiliateCode ?? "N/A", inline: true },
      ));

  } else if (cmd === "cf" || cmd === "coinflip") {
    const bet = parseBet(args[0]);
    const side = args[1]?.toLowerCase();
    if (!bet || !["heads", "tails"].includes(side ?? "")) {
      await replyEmbed(message, errorEmbed("Usage: `.cf <bet> <heads/tails>`"));
      return;
    }
    if (user.balance < bet) { await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user.balance)}`)); return; }

    const fair = await getFairContext(user.id);
    const honeypot = isHoneypotActive(user.gameCount);
    const roll = honeypot ? honeypotRoll(fair.roll, user.gameCount) : fair.roll;
    const { result, won } = playCoinflip(side as any, roll, false);
    const payout = won ? Math.floor(bet * HOUSE_EDGE) : -bet;
    const updated = await updateBalance(user.id, payout, "coinflip", `Coinflip ${won ? "win" : "loss"}`);
    await incrementCounts(user.id, false);
    const gameId = await saveGameRecord({ userId: user.id, gameType: "coinflip", fair, bet, payout, resultData: { side, result, won }, isDemo: false });
    const coinEmoji = result === "heads" ? "🪙" : "🌕";
    if (won) {
      await replyEmbed(message, winEmbed("Coinflip Win!", `${coinEmoji} **${result}**! Won ${formatRobux(Math.abs(payout))}!\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
    } else {
      await replyEmbed(message, loseEmbed("Coinflip Loss!", `${coinEmoji} **${result}**! Lost ${formatRobux(bet)}.\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
    }

  } else if (cmd === "slots") {
    const bet = parseBet(args[0]);
    if (!bet) { await replyEmbed(message, errorEmbed("Usage: `.slots <bet>`")); return; }
    if (user.balance < bet) { await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user.balance)}`)); return; }

    const fair = await getFairContext(user.id);
    const honeypot = isHoneypotActive(user.gameCount);
    const rolls = honeypot ? honeypotRolls(fair.rolls, user.gameCount) : fair.rolls;
    const { reels, multiplier, won } = playSlots(rolls, false, honeypot);
    const grossWin = won ? Math.floor(bet * multiplier) : 0;
    const payout = won ? Math.floor((grossWin - bet) * HOUSE_EDGE) : -bet;
    const updated = await updateBalance(user.id, payout, "slots", `Slots ${won ? "win" : "loss"}`);
    await incrementCounts(user.id, false);
    const gameId = await saveGameRecord({ userId: user.id, gameType: "slots", fair, bet, payout, resultData: { reels, multiplier, won }, isDemo: false });
    const display = `[ ${reels[0]} | ${reels[1]} | ${reels[2]} ]`;
    if (won) {
      await replyEmbed(message, winEmbed("🎰 Slots Win!", `${display}\n**${multiplier}x!** Won ${formatRobux(Math.abs(payout))}!\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
    } else {
      await replyEmbed(message, loseEmbed("🎰 No Match!", `${display}\nLost ${formatRobux(bet)}.\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
    }

  } else if (cmd === "rl" || cmd === "roulette") {
    const bet = parseBet(args[0]);
    const choice = args[1];
    if (!bet || !choice) { await replyEmbed(message, errorEmbed("Usage: `.rl <bet> <red/black/green/odd/even/low/high/0-36>`")); return; }
    const betChoice = parseRouletteBet(choice);
    if (!betChoice && betChoice !== 0) { await replyEmbed(message, errorEmbed("Invalid bet choice.")); return; }
    if (user.balance < bet) { await replyEmbed(message, errorEmbed(`Not enough Robux! Balance: ${formatRobux(user.balance)}`)); return; }

    const fair = await getFairContext(user.id);
    const honeypot = isHoneypotActive(user.gameCount);
    const roll = honeypot ? honeypotRoll(fair.roll, user.gameCount) : fair.roll;
    const { number, color, won, multiplier } = playRoulette(betChoice, roll, honeypot);
    const grossWin = won ? bet * multiplier - bet : 0;
    const payout = won ? Math.floor(grossWin * HOUSE_EDGE) : -bet;
    const updated = await updateBalance(user.id, payout, "roulette", `Roulette ${won ? "win" : "loss"} (${number})`);
    await incrementCounts(user.id, false);
    const gameId = await saveGameRecord({ userId: user.id, gameType: "roulette", fair, bet, payout, resultData: { betChoice, number, color, won, multiplier }, isDemo: false });
    const emoji = colorEmoji(color);
    if (won) {
      await replyEmbed(message, winEmbed("🎡 Roulette Win!", `${emoji} **${number} ${color}**! Won ${formatRobux(Math.abs(payout))} (${multiplier}x)!\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
    } else {
      await replyEmbed(message, loseEmbed("🎡 Roulette!", `${emoji} **${number} ${color}**! Lost ${formatRobux(bet)}.\nBalance: ${formatRobux(updated.balance)}\n\`Game ID: ${gameId}\``));
    }

  } else if (cmd === "lb" || cmd === "leaderboard") {
    const { db, usersTable } = await import("@workspace/db");
    const top = await db.select().from(usersTable).orderBy(usersTable.balance).limit(10).then(r => r.reverse());
    const medals = ["🥇", "🥈", "🥉"];
    const lines = top.map((u, i) => `${medals[i] ?? `**${i + 1}.**`} **${u.username}** — ${formatRobux(u.balance)}`);
    await replyEmbed(message, baseEmbed("🏆 Leaderboard").setDescription(lines.join("\n") || "No players yet!"));

  } else if (cmd === "help") {
    await replyEmbed(message, baseEmbed("📋 Prefix Commands (.)")
      .setDescription([
        "`.balance` / `.bal` — Check balance",
        "`.daily` — Claim daily Robux",
        "`.stats` — View your stats",
        "`.cf <bet> <heads/tails>` — Coinflip",
        "`.slots <bet>` — Slot machine",
        "`.rl <bet> <choice>` — Roulette",
        "`.lb` — Leaderboard",
        "",
        "For blackjack and demo games, use slash commands (`/`).",
      ].join("\n")));
  }
}
