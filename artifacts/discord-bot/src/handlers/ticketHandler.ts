import { ButtonInteraction, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { db, ticketsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { winEmbed, loseEmbed, errorEmbed, formatRobux, WIN_COLOR, LOSE_COLOR } from "../utils/embed";

async function autoDelete(interaction: ButtonInteraction, delayMs = 5000) {
  setTimeout(async () => {
    try { await interaction.channel?.delete(); } catch {}
  }, delayMs);
}

export async function handleTicketButton(interaction: ButtonInteraction) {
  const { customId } = interaction;
  const approveMatch = customId.match(/^ticket_approve_(\d+)$/);
  const denyMatch = customId.match(/^ticket_deny_(\d+)$/);
  if (!approveMatch && !denyMatch) return;

  const member = interaction.guild?.members.cache.get(interaction.user.id)
    ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator)
    || member?.permissions.has(PermissionFlagsBits.ManageGuild);

  if (!isAdmin) {
    await interaction.reply({ embeds: [errorEmbed("Only admins can approve or deny tickets.")], flags: 64 });
    return;
  }

  const ticketId = parseInt((approveMatch ?? denyMatch)![1]);
  const rows = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1);
  const ticket = rows[0];

  if (!ticket) {
    await interaction.reply({ embeds: [errorEmbed("Ticket not found.")], flags: 64 });
    return;
  }
  if (ticket.status !== "pending") {
    await interaction.reply({ embeds: [errorEmbed(`This ticket was already **${ticket.status}**.`)], flags: 64 });
    return;
  }

  await interaction.deferReply();

  if (approveMatch) {
    await db.update(ticketsTable).set({ status: "approved", handledBy: interaction.user.username }).where(eq(ticketsTable.id, ticketId));

    let newBalance: number;
    if (ticket.type === "deposit") {
      await getOrCreateUser(ticket.userId, ticket.username);
      const updated = await updateBalance(ticket.userId, ticket.amount, "deposit", `Deposit approved by ${interaction.user.username}`);
      newBalance = updated.balance;
    } else {
      const user = await getOrCreateUser(ticket.userId, ticket.username);
      if (user.balance < ticket.amount) {
        await interaction.editReply({ embeds: [errorEmbed(`User only has ${formatRobux(user.balance)} — not enough to withdraw ${formatRobux(ticket.amount)}.`)] });
        return;
      }
      const updated = await updateBalance(ticket.userId, -ticket.amount, "withdraw", `Withdrawal approved by ${interaction.user.username}`);
      newBalance = updated.balance;
    }

    const embed = new EmbedBuilder()
      .setTitle(`✅ ${ticket.type === "deposit" ? "Deposit" : "Withdrawal"} Approved`)
      .setColor(WIN_COLOR)
      .addFields(
        { name: "User", value: `<@${ticket.userId}>`, inline: true },
        { name: "Amount", value: formatRobux(ticket.amount), inline: true },
        { name: "New Balance", value: formatRobux(newBalance), inline: true },
        { name: "Approved By", value: interaction.user.username, inline: true },
      ).setTimestamp();

    await interaction.message.edit({ embeds: [embed], components: [] });
    await interaction.editReply({ embeds: [winEmbed("Approved!", `${ticket.type === "deposit" ? "Deposit" : "Withdrawal"} of ${formatRobux(ticket.amount)} approved.\nDeleting ticket channel in 5 seconds...`)] });
    try { const u = await interaction.client.users.fetch(ticket.userId); await u.send({ embeds: [embed] }); } catch {}
    autoDelete(interaction, 5000);

  } else {
    await db.update(ticketsTable).set({ status: "denied", handledBy: interaction.user.username }).where(eq(ticketsTable.id, ticketId));

    const embed = new EmbedBuilder()
      .setTitle(`❌ ${ticket.type === "deposit" ? "Deposit" : "Withdrawal"} Denied`)
      .setColor(LOSE_COLOR)
      .addFields(
        { name: "User", value: `<@${ticket.userId}>`, inline: true },
        { name: "Amount", value: formatRobux(ticket.amount), inline: true },
        { name: "Denied By", value: interaction.user.username, inline: true },
      ).setTimestamp();

    await interaction.message.edit({ embeds: [embed], components: [] });
    await interaction.editReply({ embeds: [loseEmbed("Denied", `Request denied. Deleting ticket channel in 5 seconds...`)] });
    try { const u = await interaction.client.users.fetch(ticket.userId); await u.send({ embeds: [embed] }); } catch {}
    autoDelete(interaction, 5000);
  }
}
