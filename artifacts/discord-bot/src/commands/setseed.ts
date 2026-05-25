import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser } from "../utils/db";
import { winEmbed, baseEmbed } from "../utils/embed";

export const data = new SlashCommandBuilder()
  .setName("setseed")
  .setDescription("Set your client seed for provably fair games")
  .addStringOption(opt => opt.setName("seed").setDescription("Your custom seed string").setRequired(true).setMaxLength(64));

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ flags: 64 });
    const seed = interaction.options.getString("seed", true).trim();
    const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
    await db.update(usersTable).set({ clientSeed: seed }).where(eq(usersTable.id, interaction.user.id));

    const embed = winEmbed("🔑 Client Seed Updated", [
      `Your new client seed: \`${seed}\``,
      `Previous nonce: \`${user.nonce}\``,
      ``,
      `All future games will use this seed in the hash:`,
      `\`SHA256(serverSeed:${seed}:nonce)\``,
    ].join("\n"));

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    console.error("[SetSeed Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong. Please try again.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: 64 });
    } catch {}
  }
}
