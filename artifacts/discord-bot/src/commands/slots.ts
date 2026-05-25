import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getOrCreateUser, updateBalance, applyAffiliateBonus } from "../utils/db";
import { winEmbed, loseEmbed, errorEmbed, formatRobux } from "../utils/embed";
import { playSlots } from "../games/slots";
import { getFairContext, saveGameRecord } from "../utils/provably-fair";
import { isHoneypotActive, honeypotRolls } from "../utils/honeypot";
import { checkDemoExpiry, incrementCounts } from "../utils/gameUtils";

const HOUSE_EDGE = 0.96;

export const data = new SlashCommandBuilder()
  .setName("slots")
  .setDescription("Spin the slot machine!")
  .addIntegerOption(opt => opt.setName("bet").setDescription("Amount to bet").setRequired(true).setMinValue(1))
  .addBooleanOption(opt => opt.setName("demo").setDescription("Use demo balance?").setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  const bet = interaction.options.getInteger("bet", true);
  const isDemo = interaction.options.getBoolean("demo") ?? false;
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (isDemo) { if (await checkDemoExpiry(user, interaction)) return; }

  const balance = isDemo ? user.demoBalance : user.balance;
  const label = isDemo ? "Demo Robux" : "Robux";
  if (balance < bet) {
    await interaction.reply({ embeds: [errorEmbed(`Not enough ${label}!`)], ephemeral: true });
    return;
  }

  await interaction.deferReply();
  await new Promise(r => setTimeout(r, 800));

  const fair = await getFairContext(interaction.user.id);
  const honeypot = !isDemo && isHoneypotActive(user.gameCount);
  const rolls = honeypot ? honeypotRolls(fair.rolls, user.gameCount) : fair.rolls;
  const { reels, multiplier, won } = playSlots(rolls, isDemo, honeypot);

  const grossWin = won ? Math.floor(bet * multiplier) : 0;
  const winnings = won ? Math.floor((grossWin - bet) * HOUSE_EDGE) : 0;
  const payout = won ? winnings : -bet;
  const display = `[ ${reels[0]} | ${reels[1]} | ${reels[2]} ]`;

  const updated = await updateBalance(interaction.user.id, payout, "slots", `Slots ${won ? `win x${multiplier}` : "loss"}`, isDemo);
  await incrementCounts(interaction.user.id, isDemo);
  if (won && !isDemo) await applyAffiliateBonus(interaction.user.id, winnings);

  const newBal = isDemo ? updated.demoBalance : updated.balance;
  const gameId = await saveGameRecord({ userId: interaction.user.id, gameType: "slots", fair, bet, payout, resultData: { reels, multiplier, won }, isDemo });
  const demoTag = isDemo ? " 🎮 Demo" : "";
  const verifyLine = `\n\`Game ID: ${gameId}\` • \`/verify ${gameId}\``;

  if (won) {
    await interaction.editReply({ embeds: [winEmbed(`🎰 Slots Win!${demoTag}`, `${display}\n**${multiplier}x!** Won ${formatRobux(winnings)} ${label}!\nBalance: ${formatRobux(newBal)} ${label}${verifyLine}`)] });
  } else {
    await interaction.editReply({ embeds: [loseEmbed(`🎰 No Match!${demoTag}`, `${display}\nLost ${formatRobux(bet)} ${label}.\nBalance: ${formatRobux(newBal)} ${label}${verifyLine}`)] });
  }
}
