import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getOrCreateUser, updateBalance, applyAffiliateBonus } from "../utils/db";
import { winEmbed, loseEmbed, errorEmbed, formatRobux } from "../utils/embed";
import { playCoinflip, CoinSide } from "../games/coinflip";
import { getFairContext, saveGameRecord } from "../utils/provably-fair";
import { isHoneypotActive, honeypotRoll } from "../utils/honeypot";
import { checkDemoExpiry, incrementCounts } from "../utils/gameUtils";

export const HOUSE_EDGE = 0.96;

export const data = new SlashCommandBuilder()
  .setName("coinflip")
  .setDescription("Flip a coin — win 0.96x your bet!")
  .addIntegerOption(opt => opt.setName("bet").setDescription("Amount to bet").setRequired(true).setMinValue(1))
  .addStringOption(opt => opt.setName("side").setDescription("heads or tails").setRequired(true)
    .addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" }))
  .addBooleanOption(opt => opt.setName("demo").setDescription("Use demo balance?").setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  const bet = interaction.options.getInteger("bet", true);
  const choice = interaction.options.getString("side", true) as CoinSide;
  const isDemo = interaction.options.getBoolean("demo") ?? false;
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (isDemo) { if (await checkDemoExpiry(user, interaction)) return; }

  const balance = isDemo ? user.demoBalance : user.balance;
  const label = isDemo ? "Demo Robux" : "Robux";
  if (balance < bet) {
    await interaction.reply({ embeds: [errorEmbed(`Not enough ${label}! Balance: ${formatRobux(balance)}`)], ephemeral: true });
    return;
  }

  const fair = await getFairContext(interaction.user.id);
  const honeypot = !isDemo && isHoneypotActive(user.gameCount);
  const roll = honeypot ? honeypotRoll(fair.roll, user.gameCount) : fair.roll;
  const { result, won } = playCoinflip(choice, roll, isDemo);

  const winnings = won ? Math.floor(bet * HOUSE_EDGE) : 0;
  const payout = won ? winnings : -bet;
  const coinEmoji = result === "heads" ? "🪙" : "🌕";
  const sideText = result === "heads" ? "**Heads**" : "**Tails**";

  const updated = await updateBalance(interaction.user.id, payout, "coinflip", `Coinflip ${won ? "win" : "loss"} (${result})`, isDemo);
  await incrementCounts(interaction.user.id, isDemo);
  if (won && !isDemo) await applyAffiliateBonus(interaction.user.id, winnings);

  const newBal = isDemo ? updated.demoBalance : updated.balance;
  const gameId = await saveGameRecord({ userId: interaction.user.id, gameType: "coinflip", fair, bet, payout, resultData: { choice, result, won }, isDemo });
  const demoTag = isDemo ? " 🎮 Demo" : "";
  const verifyLine = `\n\`Game ID: ${gameId}\` • \`/verify ${gameId}\``;

  if (won) {
    await interaction.reply({ embeds: [winEmbed(`Coinflip Win!${demoTag}`, `${coinEmoji} ${sideText}! Won ${formatRobux(winnings)} ${label}!\nBalance: ${formatRobux(newBal)} ${label}${verifyLine}`)] });
  } else {
    await interaction.reply({ embeds: [loseEmbed(`Coinflip Loss!${demoTag}`, `${coinEmoji} ${sideText}! Lost ${formatRobux(bet)} ${label}.\nBalance: ${formatRobux(newBal)} ${label}${verifyLine}`)] });
  }
}
