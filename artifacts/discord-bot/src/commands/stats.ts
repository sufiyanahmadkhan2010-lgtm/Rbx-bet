import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getOrCreateUser } from "../utils/db";
import { baseEmbed, formatRobux } from "../utils/embed";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View your gambling stats")
  .addUserOption(opt => opt.setName("user").setDescription("User to check").setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const user = await getOrCreateUser(target.id, target.username);
  const net = user.totalWon - user.totalLost;
  const netStr = net >= 0 ? `+${formatRobux(net)}` : `-${formatRobux(Math.abs(net))}`;
  const embed = baseEmbed(`📊 ${target.username}'s Stats`)
    .addFields(
      { name: "Balance", value: formatRobux(user.balance), inline: true },
      { name: "Total Won", value: formatRobux(user.totalWon), inline: true },
      { name: "Total Lost", value: formatRobux(user.totalLost), inline: true },
      { name: "Net Profit/Loss", value: netStr, inline: true },
      { name: "Invites", value: `${user.inviteCount}`, inline: true },
      { name: "Messages", value: `${user.messageCount}`, inline: true },
    )
    .setThumbnail(target.displayAvatarURL());
  await interaction.reply({ embeds: [embed] });
}
