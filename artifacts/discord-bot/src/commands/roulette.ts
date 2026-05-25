import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getOrCreateUser, updateBalance, applyAffiliateBonus } from "../utils/db";
import { winEmbed, loseEmbed, errorEmbed, formatRobux } from "../utils/embed";
import { playRoulette, parseRouletteBet, colorEmoji } from "../games/roulette";
import { getFairContext, saveGameRecord } from "../utils/provably-fair";
import { isHoneypotActive, honeypotRoll } from "../utils/honeypot";
import { checkDemoExpiry, incrementCounts } from "../utils/gameUtils";

const HOUSE_EDGE = 0.96;

export const data = new SlashCommandBuilder()
  .setName("roulette")
  .setDescription("Spin the roulette wheel!")
  .addIntegerOption(opt => opt.setName("bet").setDescription("Amount to bet").setRequired(true).setMinValue(1))
  .addStringOption(opt => opt.setName("choice").setDescription("red, black, green, odd, even, low, high, or 0-36").setRequired(true))
  .addBooleanOption(opt => opt.setName("demo").setDescription("Use demo balance?").setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  const bet = interaction.options.getInteger("bet", true);
  const choiceStr = interaction.options.getString("choice", true);
  const isDemo = interaction.options.getBoolean("demo") ?? false;
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (isDemo) { if (await checkDemoExpiry(user, interaction)) return; }

  const balance = isDemo ? user.demoBalance : user.balance;
  const label = isDemo ? "Demo Robux" : "Robux";
  if (balance < bet) {
    await interaction.reply({ embeds: [errorEmbed(`Not enough ${label}!`)], ephemeral: true });
    return;
  }
  const betChoice = parseRouletteBet(choiceStr);
  if (betChoice === null) {
    await interaction.reply({ embeds: [errorEmbed("Invalid bet! Use: `red`, `black`, `green`, `odd`, `even`, `low`, `high`, or a number 0-36.")], ephemeral: true });
    return;
  }

  await interaction.deferReply();
  await new Promise(r => setTimeout(r, 1000));

  const fair = await getFairContext(interaction.user.id);
  const honeypot = !isDemo && isHoneypotActive(user.gameCount);
  const roll = honeypot ? honeypotRoll(fair.roll, user.gameCount) : fair.roll;
  const { number, color, won, multiplier } = playRoulette(betChoice, roll, honeypot);

  const grossWinnings = won ? bet * multiplier - bet : 0;
  const winnings = Math.floor(grossWinnings * HOUSE_EDGE);
  const payout = won ? winnings : -bet;
  const emoji = colorEmoji(color);

  const updated = await updateBalance(interaction.user.id, payout, "roulette", `Roulette ${won ? "win" : "loss"} (${number})`, isDemo);
  await incrementCounts(interaction.user.id, isDemo);
  if (won && !isDemo) await applyAffiliateBonus(interaction.user.id, winnings);

  const newBal = isDemo ? updated.demoBalance : updated.balance;
  const gameId = await saveGameRecord({ userId: interaction.user.id, gameType: "roulette", fair, bet, payout, resultData: { betChoice, number, color, won, multiplier }, isDemo });
  const demoTag = isDemo ? " 🎮 Demo" : "";
  const verifyLine = `\n\`Game ID: ${gameId}\` • \`/verify ${gameId}\``;

  if (won) {
    await interaction.editReply({ embeds: [winEmbed(`🎡 Roulette Win!${demoTag}`, `${emoji} **${number} ${color}**!\nWon ${formatRobux(winnings)} ${label} (${multiplier}x)!\nBalance: ${formatRobux(newBal)} ${label}${verifyLine}`)] });
  } else {
    await interaction.editReply({ embeds: [loseEmbed(`🎡 Roulette!${demoTag}`, `${emoji} **${number} ${color}**!\nLost ${formatRobux(bet)} ${label}.\nBalance: ${formatRobux(newBal)} ${label}${verifyLine}`)] });
  }
}
