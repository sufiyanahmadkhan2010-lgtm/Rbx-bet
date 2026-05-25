import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { User } from "@workspace/db";
import type { ChatInputCommandInteraction } from "discord.js";
import { errorEmbed, formatRobux } from "./embed";

const DEMO_GAME_LIMIT = 10;

export async function incrementCounts(userId: string, isDemo: boolean): Promise<void> {
  if (isDemo) {
    await db.update(usersTable)
      .set({ demoGamesUsed: sql`${usersTable.demoGamesUsed} + 1` })
      .where(eq(usersTable.id, userId));
  } else {
    await db.update(usersTable)
      .set({ gameCount: sql`${usersTable.gameCount} + 1` })
      .where(eq(usersTable.id, userId));
  }
}

export async function checkDemoExpiry(user: User, interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (user.demoGamesUsed >= DEMO_GAME_LIMIT) {
    if (user.demoBalance > 0) {
      await db.update(usersTable).set({ demoBalance: 0 }).where(eq(usersTable.id, user.id));
    }
    await interaction.reply({
      embeds: [errorEmbed(
        `Your **demo period has ended** (${DEMO_GAME_LIMIT} free games used).\n\n` +
        `Demo Robux has been removed. Ask an admin for real Robux to keep playing!\n` +
        `Use \`/balance\` to check your real balance.`
      )],
      ephemeral: true,
    });
    return true;
  }

  if (user.demoBalance <= 0) {
    await interaction.reply({
      embeds: [errorEmbed(`You have no Demo Robux left! Use \`/demo\` to claim more (if your ${DEMO_GAME_LIMIT}-game limit hasn't been reached).`)],
      ephemeral: true,
    });
    return true;
  }

  return false;
}
