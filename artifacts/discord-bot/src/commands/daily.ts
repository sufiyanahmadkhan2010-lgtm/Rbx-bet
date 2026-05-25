import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { winEmbed, errorEmbed, formatRobux } from "../utils/embed";

const DAILY_AMOUNT = 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily 1,000 virtual Robux (resets every 24 hours)");

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
    const now = new Date();
    if (user.lastDaily) {
      const diff = now.getTime() - user.lastDaily.getTime();
      if (diff < DAILY_MS) {
        const remaining = DAILY_MS - diff;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        await interaction.editReply({ embeds: [errorEmbed(`You already claimed your daily! Come back in **${h}h ${m}m ${s}s**.`)] });
        return;
      }
    }
    await db.update(usersTable).set({ lastDaily: now }).where(eq(usersTable.id, interaction.user.id));
    const updated = await updateBalance(interaction.user.id, DAILY_AMOUNT, "daily", "Daily claim");
    await interaction.editReply({ embeds: [winEmbed("Daily Claimed!", `You received ${formatRobux(DAILY_AMOUNT)}!\nNew balance: ${formatRobux(updated.balance)}`)] });
  } catch (err: any) {
    console.error("[Daily Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong. Please try again.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: 64 });
    } catch {}
  }
}
