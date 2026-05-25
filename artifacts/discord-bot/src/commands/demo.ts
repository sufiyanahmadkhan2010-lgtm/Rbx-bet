import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { winEmbed, errorEmbed, formatRobux, baseEmbed, BOT_COLOR } from "../utils/embed";

const DEMO_AMOUNT = 1000;
const DEMO_MS = 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName("demo")
  .setDescription("Claim 1,000 free Demo Robux to practice gambling (resets every 24h)");

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
    const now = new Date();

    if (user.lastDemo) {
      const diff = now.getTime() - user.lastDemo.getTime();
      if (diff < DEMO_MS) {
        const remaining = DEMO_MS - diff;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        await interaction.editReply({ embeds: [errorEmbed(`You already claimed demo cash! Come back in **${h}h ${m}m ${s}s**.\n\nCurrent demo balance: ${formatRobux(user.demoBalance)} Demo Robux`)] });
        return;
      }
    }

    await db.update(usersTable).set({ lastDemo: now }).where(eq(usersTable.id, interaction.user.id));
    const updated = await updateBalance(interaction.user.id, DEMO_AMOUNT, "demo_claim", "Demo cash claim", true);

    const embed = winEmbed("🎮 Demo Cash Claimed!", [
      `You received ${formatRobux(DEMO_AMOUNT)} **Demo Robux**!`,
      `New demo balance: ${formatRobux(updated.demoBalance)} Demo Robux`,
      ``,
      `> Demo mode has **better odds** than real Robux — great for practicing!`,
      `> Add \`demo: True\` to any gambling command to use demo cash.`,
      `> Demo winnings **cannot** be converted to real Robux.`,
    ].join("\n"));

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    console.error("[Demo Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong. Please try again.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: 64 });
    } catch {}
  }
}
