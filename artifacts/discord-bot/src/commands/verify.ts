import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { db, gameRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { baseEmbed, errorEmbed } from "../utils/embed";
import { hashSeed, computeFairHash } from "../utils/provably-fair";

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify the fairness of any game using its Game ID")
  .addIntegerOption(opt => opt.setName("game_id").setDescription("The Game ID shown after each game").setRequired(true).setMinValue(1));

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    const gameId = interaction.options.getInteger("game_id", true);
    const rows = await db.select().from(gameRecordsTable).where(eq(gameRecordsTable.id, gameId)).limit(1);

    if (rows.length === 0) {
      await interaction.editReply({ embeds: [errorEmbed(`No game found with ID **${gameId}**.`)] });
      return;
    }

    const record = rows[0];
    const recomputedHash = computeFairHash(record.serverSeed, record.clientSeed, record.nonce);
    const serverSeedHash = hashSeed(record.serverSeed);
    const hashMatch = recomputedHash === record.fairHash;
    const serverSeedHashMatch = serverSeedHash === record.serverSeedHash;
    const verified = hashMatch && serverSeedHashMatch;

    let result: Record<string, unknown> = {};
    try { result = JSON.parse(record.resultData); } catch {}

    const embed = baseEmbed(`🔍 Game Verification — #${gameId}`, verified ? 0x2ecc71 : 0xe74c3c)
      .addFields(
        { name: "Game Type", value: record.gameType.toUpperCase(), inline: true },
        { name: "Mode", value: record.isDemo ? "🎮 Demo" : "💰 Real", inline: true },
        { name: "Bet", value: record.bet.toLocaleString(), inline: true },
        { name: "Payout", value: (record.payout >= 0 ? "+" : "") + record.payout.toLocaleString(), inline: true },
        { name: "Result", value: `\`${JSON.stringify(result)}\``, inline: false },
        { name: "Server Seed", value: `\`${record.serverSeed}\``, inline: false },
        { name: "Server Seed Hash (pre-committed)", value: `\`${record.serverSeedHash}\``, inline: false },
        { name: "Client Seed", value: `\`${record.clientSeed}\``, inline: true },
        { name: "Nonce", value: `\`${record.nonce}\``, inline: true },
        { name: "Fair Hash", value: `\`${record.fairHash}\``, inline: false },
        { name: "✅ Verification", value: verified
          ? "**VERIFIED** — The result matches the hash. This game was provably fair."
          : "❌ **FAILED** — Hash mismatch. Contact an admin.", inline: false },
      )
      .setFooter({ text: `Verify yourself: echo -n "${record.serverSeed}:${record.clientSeed}:${record.nonce}" | sha256sum` });

    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    console.error("[Verify Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong. Please try again.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong. Please try again.")], flags: 64 });
    } catch {}
  }
}
