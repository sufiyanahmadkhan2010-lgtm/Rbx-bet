import { SlashCommandBuilder, ChatInputCommandInteraction, ActivityType } from "discord.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOrCreateUser, updateBalance } from "../utils/db";
import { winEmbed, errorEmbed, baseEmbed, formatRobux } from "../utils/embed";

const REQUIRED_STATUS = "best robux casino discord.gg/v47te8Z6Yn";
const BONUS_AMOUNT = 10;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName("statusbonus")
  .setDescription(`Claim ${BONUS_AMOUNT} free Robux daily for having the required text in your Discord status`);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ embeds: [errorEmbed("This command can only be used in a server.")], ephemeral: true });
    return;
  }

  const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
  const now = new Date();

  if (user.lastStatusBonus) {
    const diff = now.getTime() - user.lastStatusBonus.getTime();
    if (diff < COOLDOWN_MS) {
      const remaining = COOLDOWN_MS - diff;
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      await interaction.reply({ embeds: [errorEmbed(`You already claimed the status bonus today! Come back in **${h}h ${m}m**.`)], ephemeral: true });
      return;
    }
  }

  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({ embeds: [errorEmbed("Could not fetch your member data.")], ephemeral: true });
    return;
  }

  const customStatus = member.presence?.activities.find(a => a.type === ActivityType.Custom);
  const statusText = (customStatus?.state ?? "").toLowerCase();
  const hasStatus = statusText.includes(REQUIRED_STATUS.toLowerCase());

  if (!hasStatus) {
    await interaction.reply({
      embeds: [baseEmbed("❌ Status Not Found")
        .setDescription([
          `Your current Discord custom status doesn't contain the required text.`,
          ``,
          `**Required text in your status:**`,
          `\`\`\`${REQUIRED_STATUS}\`\`\``,
          `Set this as your custom status on Discord, then run \`/statusbonus\` again.`,
          ``,
          `> ⚠️ Make sure status visibility is set to your server members!`,
        ].join("\n"))],
      ephemeral: true,
    });
    return;
  }

  await db.update(usersTable).set({ lastStatusBonus: now }).where(eq(usersTable.id, user.id));
  const updated = await updateBalance(user.id, BONUS_AMOUNT, "status_bonus", "Daily status bonus");

  await interaction.reply({
    embeds: [winEmbed("📣 Status Bonus Claimed!", `You earned ${formatRobux(BONUS_AMOUNT)} for supporting the casino!\nBalance: ${formatRobux(updated.balance)}`)],
  });
}
