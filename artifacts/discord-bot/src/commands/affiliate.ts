import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getOrCreateUser } from "../utils/db";
import { winEmbed, errorEmbed, baseEmbed, formatRobux, BOT_COLOR } from "../utils/embed";

export const data = new SlashCommandBuilder()
  .setName("affiliate")
  .setDescription("Affiliate system — earn 10% of your referrals' winnings for life")
  .addSubcommand(sub => sub
    .setName("info")
    .setDescription("View your affiliate code, earnings, and referrals")
  )
  .addSubcommand(sub => sub
    .setName("claim")
    .setDescription("Enter someone's affiliate code to link them as your referrer")
    .addStringOption(opt => opt.setName("code").setDescription("The 6-character affiliate code").setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

  if (sub === "info") {
    await interaction.deferReply({ flags: 64 });
    const lines = [
      `Your affiliate code: \`${user.affiliateCode ?? "N/A"}\``,
      ``,
      `Share this code with others. When they use \`/affiliate claim ${user.affiliateCode}\`, you earn **10% of every Robux they win** — forever.`,
      ``,
      `**Total Earned from Affiliates:** ${formatRobux(user.affiliateTotalEarned)}`,
      `**Total Referrals:** ${user.affiliateCount}`,
    ];
    if (user.affiliateOf) {
      const ref = await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, user.affiliateOf)).limit(1);
      lines.push(`\n**Your Referrer:** ${ref[0]?.username ?? "Unknown"}`);
    }

    await interaction.editReply({ embeds: [baseEmbed("🤝 Affiliate System").setDescription(lines.join("\n"))] });

  } else if (sub === "claim") {
    await interaction.deferReply();
    if (user.affiliateOf) {
      await interaction.editReply({ embeds: [errorEmbed("You already have a referrer linked. This cannot be changed.")] });
      return;
    }

    const code = interaction.options.getString("code", true).toUpperCase().trim();
    if (code === user.affiliateCode) {
      await interaction.editReply({ embeds: [errorEmbed("You can't use your own affiliate code.")] });
      return;
    }

    const refs = await db.select().from(usersTable).where(eq(usersTable.affiliateCode, code)).limit(1);
    if (!refs[0]) {
      await interaction.editReply({ embeds: [errorEmbed(`No user found with affiliate code **${code}**.`)] });
      return;
    }
    const referrer = refs[0];

    await db.update(usersTable).set({ affiliateOf: referrer.id }).where(eq(usersTable.id, user.id));
    await db.update(usersTable).set({ affiliateCount: sql`${usersTable.affiliateCount} + 1` }).where(eq(usersTable.id, referrer.id));

    await interaction.editReply({
      embeds: [winEmbed("🤝 Affiliate Linked!", `You're now referred by **${referrer.username}**.\nThey'll earn **10% of all your future winnings** as a bonus on top of your payouts — this doesn't cost you anything!`)],
    });

    try {
      const refUser = await interaction.client.users.fetch(referrer.id);
      await refUser.send(`🎉 **${interaction.user.username}** just claimed your affiliate code **${code}**! You'll now earn 10% of their winnings for life.`);
    } catch {}
  }
}
