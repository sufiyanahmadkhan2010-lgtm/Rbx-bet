import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} from "discord.js";
import { db, ticketsTable } from "@workspace/db";
import { getOrCreateUser } from "../utils/db";
import { baseEmbed, errorEmbed, formatRobux, BOT_COLOR } from "../utils/embed";

const MIN_DEPOSIT = 50;

export const data = new SlashCommandBuilder()
  .setName("deposit")
  .setDescription("Request a Robux deposit — creates a private ticket for admin approval")
  .addIntegerOption(opt =>
    opt.setName("amount").setDescription(`Amount of Robux to deposit (minimum ${MIN_DEPOSIT})`).setRequired(true).setMinValue(MIN_DEPOSIT)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!interaction.guild) {
      await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });

    const amount = interaction.options.getInteger("amount", true);
    await getOrCreateUser(interaction.user.id, interaction.user.username);

    const channel = await interaction.guild.channels.create({
      name: `deposit-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 100),
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: interaction.client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ],
    });

    const [ticket] = await db.insert(ticketsTable).values({
      channelId: channel.id,
      userId: interaction.user.id,
      username: interaction.user.username,
      type: "deposit",
      amount,
      status: "pending",
    }).returning();

    const embed = new EmbedBuilder()
      .setTitle("💰 Deposit Request")
      .setColor(BOT_COLOR)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: "User", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Amount", value: formatRobux(amount), inline: true },
        { name: "Status", value: "⏳ Pending", inline: true },
      )
      .setFooter({ text: `Ticket #${ticket.id} • Channel deletes automatically on approval/denial` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`ticket_approve_${ticket.id}`).setLabel("✅ Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ticket_deny_${ticket.id}`).setLabel("❌ Deny").setStyle(ButtonStyle.Danger),
    );

    await channel.send({ content: `<@${interaction.user.id}> Your deposit ticket is open. An admin will review it shortly.`, embeds: [embed], components: [row] });
    await interaction.editReply({
      embeds: [baseEmbed("🎫 Ticket Created!").setDescription(`Deposit request for ${formatRobux(amount)} submitted.\n\nHead to ${channel} to track it.`)],
    });
  } catch (err: any) {
    console.error("[Deposit Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong creating the ticket.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong creating the ticket.")], flags: 64 });
    } catch {}
  }
}
