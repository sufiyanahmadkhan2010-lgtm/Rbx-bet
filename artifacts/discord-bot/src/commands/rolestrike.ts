import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { errorEmbed, baseEmbed, winEmbed, BOT_COLOR } from "../utils/embed";
import { checkOwnerInteraction } from "../utils/admin";

export interface RoleStrikeWatch {
  channelId: string;
  guildId: string;
  roleId: string;
  watchedBy: string;
  label: string;
}

// messageId -> watch config
export const roleStrikeWatches = new Map<string, RoleStrikeWatch>();

export const data = new SlashCommandBuilder()
  .setName("rolestrike")
  .setDescription("[Owner only] Strip all roles + assign a punishment role when someone reacts to a message")
  .addSubcommand(sub => sub
    .setName("watch")
    .setDescription("Start watching — react = lose all roles and get punishment role")
    .addStringOption(opt => opt.setName("message_id").setDescription("ID of the message to watch").setRequired(true))
    .addRoleOption(opt => opt.setName("role").setDescription("Role to assign after stripping (punishment role)").setRequired(true))
    .addStringOption(opt => opt.setName("channel_id").setDescription("Channel ID (defaults to current channel)").setRequired(false))
    .addStringOption(opt => opt.setName("label").setDescription("Label to identify this watch").setRequired(false))
  )
  .addSubcommand(sub => sub
    .setName("unwatch")
    .setDescription("Stop watching a message")
    .addStringOption(opt => opt.setName("message_id").setDescription("Message ID to stop watching").setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName("list")
    .setDescription("List all active rolestrike watches")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!(await checkOwnerInteraction(interaction))) {
      await interaction.reply({ content: "❌ This command is restricted to the bot owner.", flags: 64 });
      return;
    }
    if (!interaction.guild) {
      await interaction.reply({ content: "Must be used in a server.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand();

    if (sub === "watch") {
      const messageId = interaction.options.getString("message_id", true).trim();
      const role = interaction.options.getRole("role", true);
      const channelId = interaction.options.getString("channel_id")?.trim() ?? interaction.channelId;
      const label = interaction.options.getString("label")?.trim() || messageId;

      if (roleStrikeWatches.has(messageId)) {
        await interaction.editReply({ embeds: [errorEmbed(`Message \`${messageId}\` is already being watched for rolestrike.`)] });
        return;
      }

      roleStrikeWatches.set(messageId, {
        channelId,
        guildId: interaction.guild.id,
        roleId: role.id,
        watchedBy: interaction.user.id,
        label,
      });

      await interaction.editReply({
        embeds: [winEmbed("🎭 Rolestrike Watch Started", [
          `Anyone who reacts to message \`${messageId}\` in <#${channelId}> will:`,
          `  • Have **all their roles stripped**`,
          `  • Receive <@&${role.id}> instead`,
          ``,
          `**Label:** ${label}`,
          `**Punishment role:** <@&${role.id}>`,
          ``,
          `Use \`/rolestrike unwatch ${messageId}\` to stop.`,
        ].join("\n"))],
      });

    } else if (sub === "unwatch") {
      const messageId = interaction.options.getString("message_id", true).trim();
      if (!roleStrikeWatches.has(messageId)) {
        await interaction.editReply({ embeds: [errorEmbed(`Message \`${messageId}\` is not being watched.`)] });
        return;
      }
      roleStrikeWatches.delete(messageId);
      await interaction.editReply({
        embeds: [baseEmbed("✅ Rolestrike Watch Removed").setDescription(`Message \`${messageId}\` is no longer watched.`)],
      });

    } else if (sub === "list") {
      if (roleStrikeWatches.size === 0) {
        await interaction.editReply({
          embeds: [baseEmbed("🎭 Rolestrike Watches").setDescription("No active rolestrike watches.")],
        });
        return;
      }
      const lines = [...roleStrikeWatches.entries()].map(([id, w]) =>
        `• \`${id}\` — **${w.label}** in <#${w.channelId}> → punishment: <@&${w.roleId}>`
      );
      await interaction.editReply({
        embeds: [baseEmbed(`🎭 ${roleStrikeWatches.size} Active Rolestrike Watch(es)`).setDescription(lines.join("\n"))],
      });
    }

  } catch (err: any) {
    console.error("[Rolestrike Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], flags: 64 });
    } catch {}
  }
}
