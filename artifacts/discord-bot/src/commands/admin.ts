import {
  SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder,
} from "discord.js";
import { db, usersTable, transactionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { baseEmbed, winEmbed, errorEmbed, formatRobux, BOT_COLOR } from "../utils/embed";
import { checkOwnerInteraction } from "../utils/admin";

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("[Owner only] Admin panel")
  .addSubcommand(sub => sub
    .setName("setbalance")
    .setDescription("Set a user's real Robux balance to an exact amount")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("New balance amount").setRequired(true).setMinValue(0))
  )
  .addSubcommand(sub => sub
    .setName("addbalance")
    .setDescription("Add (or subtract) Robux from a user's balance")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("Amount to add (use negative to subtract)").setRequired(true))
    .addStringOption(opt => opt.setName("reason").setDescription("Reason for this adjustment").setRequired(false))
  )
  .addSubcommand(sub => sub
    .setName("setdemo")
    .setDescription("Set a user's demo balance to an exact amount")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("New demo balance amount").setRequired(true).setMinValue(0))
  )
  .addSubcommand(sub => sub
    .setName("resetbalance")
    .setDescription("Reset a user's real balance to 0")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName("lookup")
    .setDescription("View full profile info for any user")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName("txhistory")
    .setDescription("View recent transactions for a user")
    .addUserOption(opt => opt.setName("user").setDescription("Target user").setRequired(true))
    .addIntegerOption(opt => opt.setName("limit").setDescription("Number of transactions (default 10, max 20)").setRequired(false).setMinValue(1).setMaxValue(20))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!(await checkOwnerInteraction(interaction))) {
      await interaction.reply({ content: "❌ This command is restricted to the bot owner.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser("user", true);

    if (sub === "setbalance") {
      const amount = interaction.options.getInteger("amount", true);
      const user = await getOrCreateUser(target.id, target.username);
      const diff = amount - user.balance;

      await db.update(usersTable).set({ balance: amount }).where(eq(usersTable.id, target.id));
      await db.insert(transactionsTable).values({
        userId: target.id,
        type: "admin_setbalance",
        amount: diff,
        balanceBefore: user.balance,
        balanceAfter: amount,
        description: `Admin set balance to ${amount} (by ${interaction.user.username})`,
      });

      await interaction.editReply({
        embeds: [winEmbed("💰 Balance Set", [
          `**User:** ${target.username} (<@${target.id}>)`,
          `**Old Balance:** ${formatRobux(user.balance)}`,
          `**New Balance:** ${formatRobux(amount)}`,
          `**Change:** ${diff >= 0 ? "+" : ""}${formatRobux(Math.abs(diff))}`,
        ].join("\n"))],
      });

    } else if (sub === "addbalance") {
      const amount = interaction.options.getInteger("amount", true);
      const reason = interaction.options.getString("reason") ?? `Admin adjustment by ${interaction.user.username}`;
      const user = await getOrCreateUser(target.id, target.username);

      if (user.balance + amount < 0) {
        await interaction.editReply({ embeds: [errorEmbed(`This would make ${target.username}'s balance negative (${formatRobux(user.balance + amount)}). Use \`setbalance\` to set an exact value, or use a smaller amount.`)] });
        return;
      }

      const updated = await updateBalance(target.id, amount, "admin_adjustment", reason);

      await interaction.editReply({
        embeds: [winEmbed(`💰 Balance ${amount >= 0 ? "Added" : "Deducted"}`, [
          `**User:** ${target.username} (<@${target.id}>)`,
          `**Amount:** ${amount >= 0 ? "+" : ""}${formatRobux(Math.abs(amount))}`,
          `**New Balance:** ${formatRobux(updated.balance)}`,
          `**Reason:** ${reason}`,
        ].join("\n"))],
      });

    } else if (sub === "setdemo") {
      const amount = interaction.options.getInteger("amount", true);
      const user = await getOrCreateUser(target.id, target.username);
      const diff = amount - user.demoBalance;

      await db.update(usersTable).set({ demoBalance: amount }).where(eq(usersTable.id, target.id));
      await db.insert(transactionsTable).values({
        userId: target.id,
        type: "admin_setdemo",
        amount: diff,
        balanceBefore: user.demoBalance,
        balanceAfter: amount,
        description: `Admin set demo balance to ${amount} (by ${interaction.user.username})`,
      });

      await interaction.editReply({
        embeds: [winEmbed("🎮 Demo Balance Set", [
          `**User:** ${target.username} (<@${target.id}>)`,
          `**Old Demo Balance:** ${formatRobux(user.demoBalance)}`,
          `**New Demo Balance:** ${formatRobux(amount)}`,
        ].join("\n"))],
      });

    } else if (sub === "resetbalance") {
      const user = await getOrCreateUser(target.id, target.username);

      await db.update(usersTable).set({ balance: 0 }).where(eq(usersTable.id, target.id));
      await db.insert(transactionsTable).values({
        userId: target.id,
        type: "admin_resetbalance",
        amount: -user.balance,
        balanceBefore: user.balance,
        balanceAfter: 0,
        description: `Admin reset balance to 0 (by ${interaction.user.username})`,
      });

      await interaction.editReply({
        embeds: [baseEmbed("🔄 Balance Reset")
          .setDescription(`**${target.username}**'s balance has been reset from ${formatRobux(user.balance)} to ${formatRobux(0)}.`)],
      });

    } else if (sub === "lookup") {
      const rows = await db.select().from(usersTable).where(eq(usersTable.id, target.id)).limit(1);
      if (rows.length === 0) {
        await interaction.editReply({ embeds: [errorEmbed(`${target.username} has no profile yet — they've never used the bot.`)] });
        return;
      }
      const u = rows[0];
      const net = u.totalWon - u.totalLost;

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Admin Lookup — ${u.username}`)
        .setColor(BOT_COLOR)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "User ID", value: `\`${u.id}\``, inline: true },
          { name: "Affiliate Code", value: u.affiliateCode ?? "N/A", inline: true },
          { name: "Referred By", value: u.affiliateOf ? `<@${u.affiliateOf}>` : "None", inline: true },
          { name: "💰 Real Balance", value: formatRobux(u.balance), inline: true },
          { name: "🎮 Demo Balance", value: formatRobux(u.demoBalance), inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: "Total Won", value: formatRobux(u.totalWon), inline: true },
          { name: "Total Lost", value: formatRobux(u.totalLost), inline: true },
          { name: "Net P/L", value: `${net >= 0 ? "+" : ""}${formatRobux(Math.abs(net))}`, inline: true },
          { name: "Games Played", value: `${u.gameCount}`, inline: true },
          { name: "Messages", value: `${u.messageCount}`, inline: true },
          { name: "Invites", value: `${u.inviteCount}`, inline: true },
          { name: "Affiliate Earnings", value: formatRobux(u.affiliateTotalEarned), inline: true },
          { name: "Referral Count", value: `${u.affiliateCount}`, inline: true },
          { name: "Joined", value: `<t:${Math.floor(new Date(u.createdAt).getTime() / 1000)}:R>`, inline: true },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } else if (sub === "txhistory") {
      const limit = interaction.options.getInteger("limit") ?? 10;
      const rows = await db.select().from(transactionsTable)
        .where(eq(transactionsTable.userId, target.id))
        .orderBy(desc(transactionsTable.createdAt))
        .limit(limit);

      if (rows.length === 0) {
        await interaction.editReply({ embeds: [baseEmbed(`📜 Transactions — ${target.username}`).setDescription("No transactions found.")] });
        return;
      }

      const lines = rows.map((tx, i) => {
        const sign = tx.amount >= 0 ? "+" : "";
        const ts = Math.floor(new Date(tx.createdAt).getTime() / 1000);
        return `\`${i + 1}.\` <t:${ts}:R> **${sign}${tx.amount.toLocaleString()}** — \`${tx.type}\` — ${tx.description.slice(0, 50)}`;
      });

      await interaction.editReply({
        embeds: [baseEmbed(`📜 Last ${rows.length} Transactions — ${target.username}`)
          .setDescription(lines.join("\n").slice(0, 2000))],
      });
    }

  } catch (err: any) {
    console.error("[Admin Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], flags: 64 });
    } catch {}
  }
}
