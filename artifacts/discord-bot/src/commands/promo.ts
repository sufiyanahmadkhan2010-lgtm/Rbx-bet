import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { db, promoCodesTable, promoClaimsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { winEmbed, errorEmbed, baseEmbed, formatRobux } from "../utils/embed";
import { checkOwnerInteraction } from "../utils/admin";

export const data = new SlashCommandBuilder()
  .setName("promo")
  .setDescription("Promo code commands")
  .addSubcommand(sub => sub
    .setName("claim")
    .setDescription("Claim a promo code for free Robux")
    .addStringOption(opt => opt.setName("code").setDescription("The promo code").setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName("create")
    .setDescription("Create a new promo code (owner only)")
    .addStringOption(opt => opt.setName("code").setDescription("The promo code").setRequired(true))
    .addIntegerOption(opt => opt.setName("amount").setDescription("Robux amount per claim").setRequired(true).setMinValue(1))
    .addIntegerOption(opt => opt.setName("uses").setDescription("Max number of claims").setRequired(true).setMinValue(1))
  )
  .addSubcommand(sub => sub
    .setName("delete")
    .setDescription("Deactivate a promo code (owner only)")
    .addStringOption(opt => opt.setName("code").setDescription("Code to deactivate").setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName("list")
    .setDescription("List all promo codes (owner only)")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "claim") {
    await interaction.deferReply();
    const code = interaction.options.getString("code", true).toUpperCase().trim();
    const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

    const promos = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, code)).limit(1);
    if (!promos[0] || !promos[0].active) {
      await interaction.editReply({ embeds: [errorEmbed(`Promo code **${code}** is invalid or expired.`)] });
      return;
    }
    const promo = promos[0];
    if (promo.usesLeft <= 0) {
      await interaction.editReply({ embeds: [errorEmbed(`Promo code **${code}** has run out of uses.`)] });
      return;
    }

    const alreadyClaimed = await db.select().from(promoClaimsTable)
      .where(and(eq(promoClaimsTable.userId, user.id), eq(promoClaimsTable.code, code)))
      .limit(1);
    if (alreadyClaimed.length > 0) {
      await interaction.editReply({ embeds: [errorEmbed(`You've already claimed promo code **${code}**.`)] });
      return;
    }

    await db.update(promoCodesTable).set({ usesLeft: sql`${promoCodesTable.usesLeft} - 1` }).where(eq(promoCodesTable.code, code));
    await db.insert(promoClaimsTable).values({ userId: user.id, code });
    const updated = await updateBalance(user.id, promo.amount, "promo", `Promo code: ${code}`);

    await interaction.editReply({ embeds: [winEmbed("🎁 Promo Claimed!", `You received ${formatRobux(promo.amount)} from code **${code}**!\nBalance: ${formatRobux(updated.balance)}`)] });
    return;
  }

  await interaction.deferReply({ flags: 64 });

  if (!(await checkOwnerInteraction(interaction))) {
    await interaction.editReply({ embeds: [errorEmbed("Only the bot owner can manage promo codes.")] });
    return;
  }

  if (sub === "create") {
    const code = interaction.options.getString("code", true).toUpperCase().trim();
    const amount = interaction.options.getInteger("amount", true);
    const uses = interaction.options.getInteger("uses", true);

    const existing = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, code)).limit(1);
    if (existing.length > 0) {
      await interaction.editReply({ embeds: [errorEmbed(`Code **${code}** already exists.`)] });
      return;
    }

    await db.insert(promoCodesTable).values({ code, amount, maxUses: uses, usesLeft: uses, createdBy: interaction.user.username });
    await interaction.editReply({ embeds: [winEmbed("✅ Promo Created!", `Code: **${code}**\nAmount: ${formatRobux(amount)}\nUses: ${uses}`)] });

  } else if (sub === "delete") {
    const code = interaction.options.getString("code", true).toUpperCase().trim();
    await db.update(promoCodesTable).set({ active: false }).where(eq(promoCodesTable.code, code));
    await interaction.editReply({ embeds: [baseEmbed("🗑️ Promo Deactivated").setDescription(`Code **${code}** has been deactivated.`)] });

  } else if (sub === "list") {
    const codes = await db.select().from(promoCodesTable).orderBy(promoCodesTable.createdAt).limit(20);
    if (codes.length === 0) {
      await interaction.editReply({ embeds: [baseEmbed("Promo Codes").setDescription("No promo codes yet.")] });
      return;
    }
    const lines = codes.map(c =>
      `**${c.code}** — ${formatRobux(c.amount)} — ${c.usesLeft}/${c.maxUses} uses — ${c.active ? "✅ Active" : "❌ Inactive"}`
    );
    await interaction.editReply({ embeds: [baseEmbed("🎟️ Promo Codes").setDescription(lines.join("\n"))] });
  }
}
