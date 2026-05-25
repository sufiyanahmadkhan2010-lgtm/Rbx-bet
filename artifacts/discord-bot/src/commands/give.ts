import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { winEmbed, errorEmbed, formatRobux } from "../utils/embed";

export const data = new SlashCommandBuilder()
  .setName("give")
  .setDescription("Give some of your Robux to another user")
  .addUserOption(opt => opt.setName("user").setDescription("User to give to").setRequired(true))
  .addIntegerOption(opt => opt.setName("amount").setDescription("Amount to give").setRequired(true).setMinValue(1));

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);

    if (target.id === interaction.user.id) {
      await interaction.editReply({ embeds: [errorEmbed("You can't give Robux to yourself!")] });
      return;
    }
    if (target.bot) {
      await interaction.editReply({ embeds: [errorEmbed("You can't give Robux to a bot!")] });
      return;
    }

    const sender = await getOrCreateUser(interaction.user.id, interaction.user.username);
    if (sender.balance < amount) {
      await interaction.editReply({ embeds: [errorEmbed(`You only have ${formatRobux(sender.balance)}.`)] });
      return;
    }

    await getOrCreateUser(target.id, target.username);
    await updateBalance(interaction.user.id, -amount, "give_sent", `Gave to ${target.username}`);
    const updated = await updateBalance(target.id, amount, "give_received", `Received from ${interaction.user.username}`);
    await interaction.editReply({ embeds: [winEmbed("Gift Sent! 🎁", `**${interaction.user.username}** gave ${formatRobux(amount)} to **${target.username}**!\n${target.username}'s new balance: ${formatRobux(updated.balance)}`)] });
  } catch (err: any) {
    console.error("[Give Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong. Please try again.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: 64 });
    } catch {}
  }
}
