import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import { errorEmbed, baseEmbed, winEmbed, BOT_COLOR } from "../utils/embed";

const OWNER_IDS = (process.env.BOT_OWNER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);

async function isOwner(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (OWNER_IDS.includes(interaction.user.id)) return true;
  // Fallback 1: check permissions from interaction member object (no fetch needed)
  const perms = interaction.member?.permissions;
  if (perms && (perms as any).has?.(PermissionFlagsBits.Administrator)) return true;
  // Fallback 2: fetch member from guild
  const member = interaction.guild?.members.cache.get(interaction.user.id)
    ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  return member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
}

// Global map of watched messages: messageId -> { channelId, guildId, watchedBy }
export const watchedMessages = new Map<string, { channelId: string; guildId: string; watchedBy: string; label: string }>();

export const data = new SlashCommandBuilder()
  .setName("autoban")
  .setDescription("[Owner only] Auto-ban anyone who reacts to a watched message")
  .addSubcommand(sub => sub
    .setName("watch")
    .setDescription("Start auto-banning anyone who reacts to a message")
    .addStringOption(opt => opt.setName("message_id").setDescription("Message ID to watch").setRequired(true))
    .addStringOption(opt => opt.setName("channel_id").setDescription("Channel ID (defaults to current channel)").setRequired(false))
    .addStringOption(opt => opt.setName("label").setDescription("Label to identify this watch (e.g. 'bot-trap')").setRequired(false))
  )
  .addSubcommand(sub => sub
    .setName("unwatch")
    .setDescription("Stop watching a message")
    .addStringOption(opt => opt.setName("message_id").setDescription("Message ID to stop watching").setRequired(true))
  )
  .addSubcommand(sub => sub
    .setName("list")
    .setDescription("List all currently watched messages")
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    if (!(await isOwner(interaction))) {
      await interaction.reply({ content: "❌ No permission.", flags: 64 });
      return;
    }

    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand();

    if (sub === "watch") {
      const messageId = interaction.options.getString("message_id", true).trim();
      const channelId = interaction.options.getString("channel_id")?.trim() ?? interaction.channelId;
      const label = interaction.options.getString("label")?.trim() ?? messageId;
      const guildId = interaction.guild?.id;

      if (!guildId) { await interaction.editReply({ content: "Must be used in a server." }); return; }
      if (watchedMessages.has(messageId)) {
        await interaction.editReply({ embeds: [errorEmbed(`Message \`${messageId}\` is already being watched.`)] });
        return;
      }

      watchedMessages.set(messageId, { channelId, guildId, watchedBy: interaction.user.id, label });

      await interaction.editReply({
        embeds: [winEmbed("👁️ Watch Started", [
          `Anyone who reacts to message \`${messageId}\` in <#${channelId}> will be **instantly banned**.`,
          `Label: **${label}**`,
          ``,
          `Use \`/autoban unwatch ${messageId}\` to stop.`,
        ].join("\n"))],
      });

    } else if (sub === "unwatch") {
      const messageId = interaction.options.getString("message_id", true).trim();
      if (!watchedMessages.has(messageId)) {
        await interaction.editReply({ embeds: [errorEmbed(`Message \`${messageId}\` is not being watched.`)] });
        return;
      }
      watchedMessages.delete(messageId);
      await interaction.editReply({ embeds: [baseEmbed("✅ Stopped Watching").setDescription(`Message \`${messageId}\` is no longer watched.`)] });

    } else if (sub === "list") {
      if (watchedMessages.size === 0) {
        await interaction.editReply({ embeds: [baseEmbed("👁️ Watched Messages").setDescription("No messages are currently being watched.")] });
        return;
      }
      const lines = [...watchedMessages.entries()].map(([id, w]) =>
        `• \`${id}\` — **${w.label}** in <#${w.channelId}>`
      );
      await interaction.editReply({ embeds: [baseEmbed(`👁️ Watching ${watchedMessages.size} message(s)`).setDescription(lines.join("\n"))] });
    }
  } catch (err: any) {
    console.error("[AutoBan Error]", err?.message ?? err);
    try {
      if (interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Something went wrong.")] });
      else await interaction.reply({ embeds: [errorEmbed("Something went wrong.")], flags: 64 });
    } catch {}
  }
}
