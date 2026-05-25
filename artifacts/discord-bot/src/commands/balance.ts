import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getOrCreateUser } from "../utils/db";
import { baseEmbed, formatRobux } from "../utils/embed";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Check your virtual Robux balance")
  .addUserOption(opt => opt.setName("user").setDescription("User to check balance of").setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const user = await getOrCreateUser(target.id, target.username);
  const embed = baseEmbed(`💰 ${target.username}'s Balance`)
    .addFields(
      { name: "💰 Real Robux", value: formatRobux(user.balance), inline: true },
      { name: "🎮 Demo Robux", value: formatRobux(user.demoBalance), inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Total Won (Real)", value: formatRobux(user.totalWon), inline: true },
      { name: "Total Lost (Real)", value: formatRobux(user.totalLost), inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
    )
    .setThumbnail(target.displayAvatarURL());
  await interaction.reply({ embeds: [embed] });
}
