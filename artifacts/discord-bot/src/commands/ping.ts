import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { baseEmbed } from "../utils/embed";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check if the bot is alive and see response time");

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    const sent = await interaction.deferReply({ fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = Math.round(interaction.client.ws.ping);
    const embed = baseEmbed(`\u2705 Pong!`)
      .setDescription(
        `\u2022 **Bot Latency:** \`${latency}ms\`\n` +
        `\u2022 **WebSocket:** \`${wsPing}ms\`\n` +
        `\u2022 **Uptime:** \`${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m\``
      );
    await interaction.editReply({ embeds: [embed] });
  } catch (err: any) {
    console.error("[Ping Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ content: "\u274c Something went wrong." });
      else await interaction.reply({ content: "\u274c Something went wrong.", flags: 64 });
    } catch {}
  }
}
