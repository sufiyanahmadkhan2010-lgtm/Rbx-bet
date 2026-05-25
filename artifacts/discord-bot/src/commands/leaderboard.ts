import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getLeaderboard } from "../utils/db";
import { baseEmbed, formatRobux } from "../utils/embed";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View the top 10 richest players")
  .addBooleanOption(opt => opt.setName("demo").setDescription("Show demo leaderboard?").setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const isDemo = interaction.options.getBoolean("demo") ?? false;
  const top = await getLeaderboard(isDemo);
  const medals = ["🥇", "🥈", "🥉"];
  const label = isDemo ? "Demo Robux" : "Robux";
  const lines = top.map((u, i) => `${medals[i] ?? `**${i + 1}.**`} **${u.username}** — ${formatRobux(isDemo ? u.demoBalance : u.balance)} ${label}`);
  const embed = baseEmbed(`🏆 ${isDemo ? "🎮 Demo " : ""}Leaderboard`)
    .setDescription(lines.length > 0 ? lines.join("\n") : "No players yet!");
  await interaction.editReply({ embeds: [embed] });
}
